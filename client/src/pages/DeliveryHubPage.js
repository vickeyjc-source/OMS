// client/src/pages/DeliveryHubPage.js
// Stage 7 — Inbound Delivery Hub: receive goods, GRN, move to Logistics
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge, DaysBadge } from '../utils/helpers';
import { printDoc, generateDeliverySlipPDF, generatePackingListPDF } from '../utils/pdfUtils';
import { ISO3_COUNTRIES } from '../utils/isoCountryCodes';
import { useAuth } from '../context/AuthContext';

function fmtM(n,c='INR'){const s={INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};return(s[c]||c+' ')+(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}

// ── GRN Modal — confirm quantities, flag shortages ───────────────────────────
function GRNModal({ order, suppliers, onClose, onSaved, filterPoId }) {
  const qc = useQueryClient();
  const supName = id => suppliers.find(s=>s.id===id)?.name||id;
  const today = new Date().toISOString().slice(0,10);
  const cooNameByCode = useMemo(
    () => Object.fromEntries(ISO3_COUNTRIES.map(c => [c.code, c.name])),
    []
  );

  const [grn, setGrn] = useState(() => {
    const g = {};
    (order.lineItems||[]).forEach(li => {
      const po = (order.supplierOrders||[]).find(so=>(so.items||[]).includes(li.id));
      g[li.id] = {
        qty_received: '0',
        condition:    'good',
        notes:        '',
        supplier_id:  po?.supplier_id || '',
        coo:          '',
        date_code:    '',
        lot_number:   '',
        weight_kg:    '',
        arrived_date: today,
      };
    });
    return g;
  });
  const [saving, setSaving] = useState(false);
  const [cooOpenFor, setCooOpenFor] = useState(null);
  const [cooQueryByItem, setCooQueryByItem] = useState({});
  const cooWrapRefs = useRef({});
  const setG = (id,k,v) => setGrn(g=>({...g,[id]:{...g[id],[k]:v}}));

  // Auto-generate CN number for partial GRNs (seq matches server GRN seq: total records + 1)
  const nextGrnSeq = (order.grnRecords||[]).length + 1;
  const autoGenCN = 'CN-' + order.id + '-' + String(nextGrnSeq).padStart(2,'0');
  const [creditNoteNo, setCreditNoteNo] = useState(autoGenCN);
  const [creditNoteAmount, setCreditNoteAmount] = useState('');

  useEffect(() => {
    if (!cooOpenFor) return;
    const onDocMouseDown = (e) => {
      const wrap = cooWrapRefs.current[cooOpenFor];
      if (wrap && !wrap.contains(e.target)) setCooOpenFor(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [cooOpenFor]);

  const items = filterPoId
    ? (order.lineItems||[]).filter(li => {
        const targetPo = (order.supplierOrders||[]).find(so => so.id === filterPoId);
        return targetPo ? (targetPo.items||[]).includes(li.id) : true;
      })
    : (order.lineItems||[]);
  const poSummary = filterPoId
    ? (order.supplierOrders||[]).filter(so => so.id === filterPoId)
    : (order.supplierOrders||[]);

  // ── Previously received (cumulative from all past GRN records) ─────────
  const prevRcvdMap = (order.grnRecords||[]).reduce((m,r)=>{
    m[r.order_item_id]=(m[r.order_item_id]||0)+(parseInt(r.qty_received)||0);
    return m;
  },{});
  const latestGrnByItem = (order.grnRecords||[]).reduce((m,r)=>{
    if ((parseInt(r.qty_received)||0) > 0) m[r.order_item_id] = r;
    return m;
  },{});

  // ── Summary calculations ──────────────────────────────────────────────────
  const summary = items.reduce((acc, li) => {
    const qty = parseInt(grn[li.id]?.qty_received) || 0;
    const prevRcvd = prevRcvdMap[li.id] || 0;
    acc.totalOrdered += li.qty;
    acc.totalReceived += prevRcvd + qty;
    if (prevRcvd + qty >= li.qty && li.qty > 0) acc.full++;
    else if (prevRcvd + qty > 0) acc.partial++;
    else acc.pending++;
    return acc;
  }, { full:0, partial:0, pending:0, totalOrdered:0, totalReceived:0 });
  const overallPct = summary.totalOrdered > 0
    ? Math.round((summary.totalReceived / summary.totalOrdered) * 100) : 0;
  const allFull     = summary.full === items.length && items.length > 0;
  const anyFilled   = items.some(li => (parseInt(grn[li.id]?.qty_received)||0) > 0);
  const hasShortage = items.some(li => {
    const pending = Math.max(0, li.qty - (prevRcvdMap[li.id]||0));
    return pending > 0 && (parseInt(grn[li.id]?.qty_received)||0) < pending;
  });
  const hasDamaged  = Object.values(grn).some(r=>r.condition==='damaged'||r.condition==='rejected');

  const buildRecords = () => items.filter(li => {
    const pending = Math.max(0, li.qty - (prevRcvdMap[li.id]||0));
    return pending > 0 && (parseInt(grn[li.id]?.qty_received)||0) > 0;
  }).map(li => {
    const row = grn[li.id]||{};
    return {
      order_item_id: li.id,
      qty_received:  parseInt(row.qty_received)||0,
      condition:     row.condition||'good',
      notes:         row.notes||'',
      supplier_id:   row.supplier_id||'',
      coo:           row.coo||'',
      date_code:     row.date_code||'',
      lot_number:    row.lot_number||'',
      weight_kg:     row.weight_kg ? parseFloat(row.weight_kg) : null,
      arrived_date:  row.arrived_date||'',
    };
  });

  const canSaveCreditOnlyPartial = !!(creditNoteNo.trim() && creditNoteAmount !== '');

  const handleGRN = async (partialSave=false) => {
    if (!anyFilled && !(partialSave && canSaveCreditOnlyPartial)) {
      return toast.error('Enter a received quantity or save a credit-note partial');
    }
    setSaving(true);
    try {
      const records = buildRecords();
      const isPartial = partialSave || hasShortage;
      const res = await api.post('/orders/'+order.id+'/grn', {
        records,
        partial: partialSave || !records.length,
        filter_po_id: filterPoId || '',
        credit_note_no: isPartial ? creditNoteNo.trim() : '',
        credit_note_amount: isPartial ? creditNoteAmount : '',
      });
      const partialMsg = res.data.order_status === 'partial_hub' ? ' — Partial, balance still expected' : '';
      const grnLabel = res.data.grn_no ? res.data.grn_no + ' recorded!' : 'GRN recorded!';
      const cnMsg = res.data.credit_note_no ? ' | CN: ' + res.data.credit_note_no : '';
      toast.success('✅ ' + grnLabel + partialMsg + cnMsg);
      qc.invalidateQueries(['orders']);
      onSaved();
    } catch(e) { toast.error(e.response?.data?.error||'GRN failed'); }
    finally { setSaving(false); }
  };

  // Status badge label
  const grnBadge = allFull ? {label:'Ready to submit', bg:'#E1F5EE', color:'#085041'}
    : anyFilled ? {label:'Partial entry', bg:'#FEF3C7', color:'#92400E'}
    : {label:'Pending GRN', bg:'var(--surface2)', color:'var(--text3)'};

  return (
    <div className="overlay">
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>📋 Goods Receipt Note — {order.id}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2,display:'flex',gap:8,alignItems:'center'}}>
              <span>Confirm what was physically received.</span>
              <span style={{padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:600,
                background:grnBadge.bg,color:grnBadge.color}}>{grnBadge.label}</span>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* PO summary */}
          {poSummary.length>0 && (
            <div style={{marginBottom:14,display:'flex',gap:8,flexWrap:'wrap'}}>
              {poSummary.map(so=>(
                <div key={so.id} style={{padding:'5px 12px',borderRadius:'var(--r-sm)',
                  background:'var(--accent-lt)',border:'1px solid var(--accent)33',fontSize:12,fontWeight:600}}>
                  {so.internal_po_no||so.id} · {supName(so.supplier_id)}
                  {so.tracking_no && <span style={{color:'var(--text3)',marginLeft:6}}>🚚 {so.tracking_no}</span>}
                </div>
              ))}
            </div>
          )}

          {/* ── UPGRADED GRN table with progress bars ── */}
          <table className="li-table">
            <thead>
              <tr>
                <th style={{width:20}}></th>
                <th>Part / Description</th>
                <th style={{textAlign:'center',color:'var(--text2)'}}>Ordered</th>
                <th style={{textAlign:'center',color:'var(--green)'}}>Prev Rcvd</th>
                <th style={{textAlign:'center',color:'var(--purple,#7c3aed)'}}>Pending</th>
                <th style={{textAlign:'center',color:'var(--accent)',fontWeight:800}}>Receiving Now</th>
                <th>Condition</th>
                <th style={{color:'var(--teal,#0d9488)'}}>COO</th>
                <th style={{color:'var(--teal,#0d9488)'}}>Date Code</th>
                <th style={{color:'var(--teal,#0d9488)'}}>LOT</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((li,i) => {
                const row      = grn[li.id]||{};
                const qty      = parseInt(row.qty_received)||0;
                const prevRcvd = prevRcvdMap[li.id]||0;
                const pending  = Math.max(0, li.qty - prevRcvd);
                const isComplete = pending === 0;
                const savedGrn = latestGrnByItem[li.id]||{};
                const isFull   = (prevRcvd + qty) >= li.qty && li.qty > 0;
                const isPartial= qty > 0 && !isFull;
                const shortage  = qty < pending;
                const dotColor  = isFull ? '#1D9E75' : isPartial ? '#BA7517' : 'var(--border)';
                const inputBorderColor = isFull ? '#1D9E75' : isPartial ? '#BA7517' : 'var(--border)';
                return (
                  <tr key={li.id} style={{background:
                    row.condition==='rejected'?'var(--red-lt,#fef2f2)':
                    row.condition==='damaged'?'#FFF7ED':
                    shortage&&qty>0?'var(--amber-lt,#fffbeb)':'transparent'}}>
                    {/* Row status dot */}
                    <td>
                      <span style={{width:8,height:8,borderRadius:'50%',display:'inline-block',
                        background:dotColor}}/>
                    </td>
                    {/* Component */}
                    <td className="bold">
                      {li.component}
                      {li.manufacturer&&<div style={{fontSize:10,color:'var(--text3)'}}>{li.manufacturer}</div>}
                    </td>
                    {/* Ordered */}
                    <td style={{textAlign:'center',fontWeight:600,color:'var(--text2)'}}>{li.qty}</td>
                    {/* Previously received */}
                    <td style={{textAlign:'center',fontWeight:700,color:prevRcvd>0?'var(--green)':'var(--text3)'}}>
                      {prevRcvd>0 ? prevRcvd : <span style={{opacity:.4}}>—</span>}
                    </td>
                    {/* Still pending */}
                    <td style={{textAlign:'center',fontWeight:700,
                      color:pending>0?'var(--purple,#7c3aed)':'var(--green)'}}>
                      {pending>0
                        ? <span style={{padding:'1px 7px',borderRadius:999,background:'#f5f3ff',border:'1px solid #c4b5fd'}}>{pending}</span>
                        : <span style={{color:'var(--green)',fontSize:13}}>✓</span>}
                    </td>
                    {/* Receiving now (input) */}
                    <td style={{textAlign:'center'}}>
                      {isComplete ? (
                        <span style={{fontSize:11,fontWeight:700,color:'var(--green)',whiteSpace:'nowrap'}}>Completed</span>
                      ) : (
                        <input className="input" type="number" min="0" max={pending}
                          value={row.qty_received}
                          onChange={e=>{
                            const value = e.target.value;
                            setG(li.id,'qty_received',value === '' ? '' : String(Math.min(pending, Math.max(0, parseInt(value)||0))));
                          }}
                          style={{width:72,textAlign:'center',fontWeight:800,fontSize:14,
                            borderColor: inputBorderColor,
                            background: qty>0?'#f0fdf4':undefined}}/>
                      )}
                      {qty>0&&qty<pending&&(
                        <div style={{fontSize:10,color:'#BA7517',fontWeight:600,marginTop:2}}>
                          ⚠ {pending-qty} short
                        </div>
                      )}
                      {qty>0&&qty>=pending&&pending>0&&(
                        <div style={{fontSize:10,color:'var(--green)',fontWeight:600,marginTop:2}}>
                          ✅ Full
                        </div>
                      )}
                    </td>
                    {/* Condition */}
                    <td>
                      {isComplete ? <span style={{fontSize:11,fontWeight:600,color:'var(--green)',textTransform:'capitalize'}}>{savedGrn.condition||'good'}</span> : <select className="input" value={row.condition}
                        onChange={e=>setG(li.id,'condition',e.target.value)}
                        style={{fontSize:11,
                          borderColor:row.condition==='damaged'||row.condition==='rejected'?'var(--red)':
                          row.condition==='good'&&isFull?'#1D9E75':undefined}}>
                        <option value="good">✅ Good</option>
                        <option value="partial">⚠ Partial damage</option>
                        <option value="damaged">❌ Damaged</option>
                        <option value="rejected">🚫 Rejected</option>
                      </select>}
                    </td>
                    {/* COO */}
                    <td>
                      {isComplete ? <span style={{fontSize:11,fontWeight:600}}>{savedGrn.coo||'—'}</span> : <div
                        ref={el => { cooWrapRefs.current[li.id] = el; }}
                        style={{position:'relative',width:220}}
                      >
                        <input
                          className="input"
                          value={cooQueryByItem[li.id] ?? row.coo ?? ''}
                          onFocus={() => {
                            setCooOpenFor(li.id);
                            setCooQueryByItem(prev => ({ ...prev, [li.id]: row.coo || '' }));
                          }}
                          onChange={e => {
                            const raw = e.target.value || '';
                            setCooQueryByItem(prev => ({ ...prev, [li.id]: raw }));
                            const code = raw.trim().toUpperCase().slice(0,3);
                            setG(li.id, 'coo', code);
                            setCooOpenFor(li.id);
                          }}
                          placeholder="IND"
                          maxLength={3}
                          title={row.coo && cooNameByCode[row.coo] ? `${row.coo} - ${cooNameByCode[row.coo]}` : ''}
                          style={{fontSize:11,width:'100%',textTransform:'uppercase'}}
                        />
                        {cooOpenFor === li.id && (
                          <div style={{
                            position:'absolute',
                            top:'calc(100% + 4px)',
                            left:0,
                            minWidth:'100%',
                            width:380,
                            maxWidth:'min(70vw, 520px)',
                            zIndex:60,
                            maxHeight:260,
                            overflowY:'auto',
                            overflowX:'auto',
                            overscrollBehavior:'contain',
                            WebkitOverflowScrolling:'touch',
                            border:'1px solid var(--border)',
                            borderRadius:8,
                            background:'var(--surface,#fff)',
                            boxShadow:'0 8px 20px rgba(0,0,0,0.12)',
                            scrollbarColor:'#111827 #e5e7eb'
                          }}
                          onWheel={e => e.stopPropagation()}>
                            {ISO3_COUNTRIES
                              .filter(c => {
                                const q = (cooQueryByItem[li.id] || '').trim().toLowerCase();
                                if (!q) return true;
                                return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                              })
                              .map(c => (
                                <div
                                  key={c.code}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setG(li.id, 'coo', c.code);
                                    setCooQueryByItem(prev => ({ ...prev, [li.id]: c.code }));
                                    setCooOpenFor(null);
                                  }}
                                  style={{
                                    padding:'7px 9px',
                                    fontSize:11,
                                    cursor:'pointer',
                                    whiteSpace:'nowrap',
                                    textOverflow:'clip',
                                    overflow:'visible',
                                    borderBottom:'1px solid var(--border)'
                                  }}
                                  title={`${c.code} - ${c.name}`}
                                >
                                  <strong>{c.code}</strong> - {c.name}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>}
                    </td>
                    {/* Date Code */}
                    <td>{isComplete ? <span style={{fontSize:11,fontWeight:600}}>{savedGrn.date_code||'—'}</span> : <input className="input" value={row.date_code||''}
                      onChange={e=>setG(li.id,'date_code',e.target.value)}
                      maxLength={30} placeholder="2345" style={{fontSize:11,width:60}}/>}</td>
                    {/* LOT */}
                    <td>{isComplete ? <span style={{fontSize:11,fontWeight:600}}>{savedGrn.lot_number||'—'}</span> : <input className="input" value={row.lot_number||''}
                      onChange={e=>setG(li.id,'lot_number',e.target.value)}
                      maxLength={100} placeholder="Batch/LOT" style={{fontSize:11,width:80}}/>}</td>
                    {/* Notes */}
                    <td>{isComplete ? <span style={{fontSize:11,color:'var(--text2)'}} title={savedGrn.notes||'Already received'}>{savedGrn.notes||'Already received'}</span> : <input className="input" value={row.notes}
                      onChange={e=>setG(li.id,'notes',e.target.value)}
                      maxLength={500}
                      placeholder="Optional remarks"
                      style={{fontSize:11}}/>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* ── Summary bar ── */}
          <div style={{display:'flex',alignItems:'center',gap:20,
            background:'var(--surface2)',border:'1px solid var(--border)',
            borderRadius:8,padding:'12px 18px',margin:'14px 0'}}>
            {(()=>{
              const totPrevRcvd = items.reduce((s,li)=>s+(prevRcvdMap[li.id]||0),0);
              const totPending  = items.reduce((s,li)=>s+Math.max(0,li.qty-(prevRcvdMap[li.id]||0)),0);
              const totNow      = items.reduce((s,li)=>s+(parseInt(grn[li.id]?.qty_received)||0),0);
              return [
                {label:'Ordered',       val:summary.totalOrdered, color:'var(--text2)'},
                {label:'Prev Received', val:totPrevRcvd,          color:'var(--green)'},
                {label:'Pending', val:totPending,           color:'var(--purple,#7c3aed)'},
                {label:'Receiving Now', val:totNow,               color:'var(--accent)', bold:true},
              ];
            })().map((s,i,arr)=>(

              <React.Fragment key={s.label}>
                <div style={{textAlign:'center'}}>
                  <div style={{fontFamily:'monospace',fontSize:20,fontWeight:s.bold?800:500,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.5,marginTop:2}}>{s.label}</div>
                </div>
                {i<arr.length-1&&<div style={{width:1,height:36,background:'var(--border)'}}/>}
              </React.Fragment>
            ))}
          </div>

          {/* Discrepancy warning + Credit Note */}
          {(hasShortage||hasDamaged) && (
            <div style={{padding:'10px 14px',borderRadius:'var(--r)',
              background:'var(--amber-lt,#fffbeb)',border:'2px solid var(--amber,#d97706)'}}>
              <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)',marginBottom:4}}>⚠ Discrepancies Found</div>
              {hasShortage && <div style={{fontSize:12}}>• Short shipment detected — balance stays pending in hub</div>}
              {hasDamaged  && <div style={{fontSize:12}}>• Damaged/rejected items — raise RMA or insurance claim</div>}
              <div style={{fontSize:12,marginTop:4,color:'var(--text3)'}}>Order will proceed with received items. Remaining items flagged for follow-up.</div>
              {hasShortage && (
                <div style={{marginTop:10,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--amber,#d97706)',whiteSpace:'nowrap'}}>
                    📄 Credit Note No:
                  </label>
                  <input
                    className="input"
                    value={creditNoteNo}
                    onChange={e=>setCreditNoteNo(e.target.value)}
                    placeholder={autoGenCN}
                    style={{width:200,fontWeight:700,fontSize:12,
                      borderColor:'var(--amber,#d97706)',background:'#fff'}}
                  />
                  <label style={{fontSize:12,fontWeight:700,color:'var(--amber,#d97706)',whiteSpace:'nowrap'}}>
                    Amount:
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={creditNoteAmount}
                    onChange={e=>setCreditNoteAmount(e.target.value)}
                    placeholder="0.00"
                    style={{width:140,fontWeight:700,fontSize:12,borderColor:'var(--amber,#d97706)',background:'#fff'}}
                  />
                  <span style={{fontSize:11,color:'var(--text3)'}}>Auto-generated — edit if needed</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer: Save Partial + Submit Full ── */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          {/* P2: Separate partial save and full submit buttons */}
          <button className="btn"
            style={{background:'#FAEEDA',color:'#633806',borderColor:'#EF9F27',fontWeight:600}}
            disabled={saving || allFull || (!anyFilled && !canSaveCreditOnlyPartial)}
            onClick={()=>handleGRN(true)}>
            {saving?'Saving…':'⚠ Save Partial GRN'}
          </button>
          <button className="btn btn-primary"
            style={{background:allFull?'#1D9E75':undefined,borderColor:allFull?'#1D9E75':undefined,fontWeight:700}}
            disabled={saving || !allFull}
            onClick={()=>handleGRN(false)}>
            {saving?'Submitting…':'✅ Submit Full GRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Delivery Hub Page ────────────────────────────────────────────────────

// ── CreateShipmentModal ───────────────────────────────────────────────────────
function CreateShipmentModal({ order, soId, customers, shippers, onClose, onSaved }) {
  const qc = useQueryClient();
  const custObj  = customers.find(c=>c.id===order.customer_id)||{};
  const custName = custObj.name||order.customer_id;
  const soScope = soId ? (order.supplierOrders||[]).find(so=>so.id===soId) : null;
  const scopedIds = soScope ? new Set(soScope.items||[]) : null;
  const allItems = (order.lineItems||[])
    .filter(li=>['ready_to_ship','grn_partial','delivered_hub'].includes(li.line_status))
    .filter(li=>!scopedIds || scopedIds.has(li.id));
  const existingShipNos = (order.shipments||[]).length;
  const [step, setStep]         = useState(1);
  const [saving, setSaving]     = useState(false);
  const [selected, setSelected] = useState(()=>{ const s={}; allItems.forEach(li=>{s[li.id]=true;}); return s; });
  const [dsPreviewed, setDsPreviewed] = useState(false);
  const [plPreviewed, setPlPreviewed] = useState(false);
  const [dsGenerated, setDsGenerated] = useState(false);
  const [plGenerated, setPlGenerated] = useState(false);
  const [dsReviewed, setDsReviewed] = useState(false);
  const [plReviewed, setPlReviewed] = useState(false);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceFileRef, setInvoiceFileRef] = useState('');
  const [invoiceUploadStatus, setInvoiceUploadStatus] = useState('');
  const [ewayBill, setEwayBill]   = useState('');
  const [shipperId, setShipperId] = useState('');
  const [otherCarrierName, setOtherCarrierName] = useState('');
  const [awb,       setAwb]       = useState('');
  const [notes,     setNotes]     = useState('');
  const selectedItems  = allItems.filter(li=>selected[li.id]);
  const shipNo         = existingShipNos + 1;
  // GRN received qty per line item (cumulative across all GRN records)
  const grnQtyMap = (order.grnRecords||[]).reduce((m,r)=>{
    m[r.order_item_id] = (m[r.order_item_id]||0) + (parseInt(r.qty_received)||0);
    return m;
  }, {});
  // Already shipped qty per line item (cumulative across all past shipments)
  const shippedQtyMap = (order.shipments||[]).flatMap(s=>s.items||[]).reduce((m,si)=>{
    m[si.order_item_id] = (m[si.order_item_id]||0) + (parseInt(si.qty_shipped)||0);
    return m;
  }, {});
  // Available at hub = received - already shipped (what's ready to dispatch NOW)
  const availableQty = (li) => Math.max(0, (grnQtyMap[li.id]||0) - (shippedQtyMap[li.id]||0));
  const BUILTIN_CARRIERS = [
    'DHL', 'UPS', 'FedEx', 'Aramex', 'TNT Express', 'Maersk',
    'MSC (Mediterranean Shipping Company)', 'CMA CGM', 'COSCO Shipping', 'Hapag-Lloyd',
    'Kuehne + Nagel', 'DB Schenker', 'DSV', 'Expeditors', 'Nippon Express',
    'Delhivery', 'Blue Dart', 'DTDC', 'Ecom Express', 'XpressBees', 'India Post',
    'Porter', 'Dunzo', 'Borzo', 'Shadowfax', 'Swiggy Genie',
    'TCI (Transport Corporation of India)', 'Safexpress', 'Mahindra Logistics',
    'Allcargo Logistics', 'Gati'
  ];
  const toId = (name='') => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const builtinOptions = BUILTIN_CARRIERS.map(name => ({ id: toId(name), name }));
  const customOptions = (shippers || []).map(s => ({ id: s.id || toId(s.name || ''), name: s.name || s.id || '' })).filter(s => s.name);
  const mergedByName = {};
  [...builtinOptions, ...customOptions].forEach(s => {
    const k = (s.name || '').toLowerCase();
    if (!mergedByName[k]) mergedByName[k] = s;
  });
  const carrierOptions = Object.values(mergedByName).sort((a,b) => a.name.localeCompare(b.name));
  const shipperName = shipperId === 'others'
    ? otherCarrierName.trim()
    : (carrierOptions.find(s=>s.id===shipperId)?.name || '');
  const selectedCarrierForSave = shipperId === 'others' ? otherCarrierName.trim() : shipperName;
  const orderValINR    = selectedItems.reduce((s,li)=>li.currency==='INR'?s+availableQty(li)*(li.unit_price||0):s,0);
  const ewayRequired   = custObj.country==='India' && orderValINR>50000;
  const subtotal       = selectedItems.reduce((s,li)=>s+availableQty(li)*(li.unit_price||0),0);
  const taxTotal       = selectedItems.reduce((s,li)=>s+availableQty(li)*(li.unit_price||0)*((li.tax_rate||0)/100),0);
  const grandTotal     = subtotal+taxTotal;
  const handleInvoiceFile = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    setInvoiceFile(file);
    setInvoiceFileRef('');
    setInvoiceUploadStatus('uploading');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', 'order');
    formData.append('entity_id', order.id);
    formData.append('field_name', 'invoice_file');
    try {
      const res = await api.post('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setInvoiceFileRef(res.data.id);
      setInvoiceUploadStatus('uploaded');
      toast.success('Invoice uploaded');
    } catch(e) {
      setInvoiceUploadStatus('error');
      toast.error('Invoice upload failed: ' + (e.response?.data?.error || e.message));
    }
  };
  const generateDS = () => {
    if (!invoiceRef.trim()) { toast.error('Enter invoice number first'); return; }
    setDsGenerated(true);
    setDsPreviewed(false);
    setDsReviewed(false);
  };
  const previewDS = () => {
    printDoc(generateDeliverySlipPDF(order, selectedItems, shipNo, shipperName, awb, invoiceRef, custName));
    setDsPreviewed(true);
  };
  const generatePL = () => {
    if (!invoiceRef.trim()) { toast.error('Enter invoice number first'); return; }
    setPlGenerated(true);
    setPlPreviewed(false);
    setPlReviewed(false);
  };
  const previewPL = () => {
    printDoc(generatePackingListPDF(order, selectedItems, order.grnRecords||[], shipNo, custName, invoiceRef));
    setPlPreviewed(true);
  };
  const canProceedShipping = awb.trim() && shipperId && (shipperId !== 'others' || otherCarrierName.trim());
  const canProceedDocuments = dsReviewed && plReviewed && invoiceRef.trim() && invoiceUploadStatus==='uploaded' && (!ewayRequired||ewayBill.trim());
  const handleDispatch = async () => {
    setSaving(true);
    try {
      await api.post('/orders/'+order.id+'/shipments', {
        type: selectedItems.length===allItems.length?'full':'partial',
        shipper_id:selectedCarrierForSave, tracking_no:awb, invoice_ref:invoiceRef,
        invoice_file:invoiceFileRef, eway_bill:ewayBill, delivery_slip:'generated', packing_list:'generated', notes,
        items: selectedItems.map(li=>({order_item_id:li.id,qty_shipped:availableQty(li)})),
      });
      toast.success(`✅ Shipment ${shipNo} dispatched!`);
      qc.invalidateQueries(['orders']); onSaved();
    } catch(e) { toast.error(e.response?.data?.error||'Dispatch failed'); }
    finally { setSaving(false); }
  };
  const STEPS = ['Select Items','Shipping','Documents','Confirm'];
  return (
    <div className="overlay">
      <div className="modal modal-xl">
        <div className="modal-header">
          <div><h2>📦 Create Shipment — {order.id}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              Shipment {shipNo} · {custName}
              {soScope && <span style={{marginLeft:8,color:'var(--accent)',fontWeight:700}}>· PO {soScope.internal_po_no||soScope.id}</span>}
            </div></div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',padding:'0 20px'}}>
          {STEPS.map((s,i)=>(
            <div key={s} style={{padding:'12px 20px',fontSize:12,fontWeight:600,
              borderBottom:step===i+1?'2px solid var(--accent)':'2px solid transparent',
              color:step===i+1?'var(--accent)':step>i+1?'var(--green)':'var(--text3)'}}>
              {step>i+1?'✓ ':''}{s}
            </div>
          ))}
        </div>
        <div className="modal-body">
          {step===1&&(<div>
            <div style={{fontWeight:700,marginBottom:12}}>Select items for this shipment:</div>
            <table className="li-table"><thead><tr><th>✓</th><th>Component</th><th>Manufacturer</th><th>IPN</th><th>Ordered</th><th>GRN Recv'd</th><th>Status</th></tr></thead>
            <tbody>{allItems.map(li=>(
              <tr key={li.id} style={{background:selected[li.id]?'var(--accent-lt)':undefined}}>
                <td><input type="checkbox" checked={!!selected[li.id]} onChange={e=>setSelected(p=>({...p,[li.id]:e.target.checked}))}/></td>
                <td style={{fontWeight:600}}>{li.component}</td><td>{li.manufacturer||'—'}</td>
                <td className="mono" style={{fontSize:11}}>{li.ipn||'—'}</td>
                <td style={{color:'var(--text3)'}}>{li.qty}</td>
                <td style={{fontWeight:700,color:availableQty(li)<li.qty?'var(--amber,#d97706)':'var(--green)'}}>{availableQty(li)}{availableQty(li)<li.qty?<span style={{fontSize:10,marginLeft:4}}>⚠ short</span>:null}</td>
                <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:li.line_status==='ready_to_ship'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',color:li.line_status==='ready_to_ship'?'var(--green)':'var(--amber,#d97706)',fontWeight:600}}>{li.line_status==='ready_to_ship'?'✅ Ready':'⚠ Partial'}</span></td>
              </tr>
            ))}</tbody></table>
            {selectedItems.length>0&&(
              <div style={{marginTop:16,padding:'12px 16px',background:'var(--surface2)',borderRadius:'var(--r)',fontSize:12}}>
                <div style={{fontWeight:700,marginBottom:8,color:'var(--text2)'}}>💰 Shipment Value (for your reference — not printed on documents)</div>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{borderBottom:'1px solid var(--border)'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:11}}>Component</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Qty</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Unit Price</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Tax%</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Tax Amt</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Line Total</th></tr></thead>
                  <tbody>{selectedItems.map(li=>{const qty=availableQty(li);const base=qty*(li.unit_price||0);const tax=base*((li.tax_rate||0)/100);return(<tr key={li.id} style={{borderBottom:'0.5px solid var(--border)'}}><td style={{padding:'4px 8px'}}>{li.component}</td><td style={{padding:'4px 8px',textAlign:'right'}}>{qty}</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmtM(li.unit_price,li.currency)}</td><td style={{padding:'4px 8px',textAlign:'right'}}>{li.tax_rate||0}%</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmtM(tax,li.currency)}</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmtM(base+tax,li.currency)}</td></tr>);})}</tbody>
                  <tfoot><tr style={{borderTop:'2px solid var(--border)'}}><td colSpan={4} style={{padding:'6px 8px',fontWeight:700,textAlign:'right'}}>Subtotal + Tax</td><td style={{padding:'6px 8px',textAlign:'right'}}>{fmtM(taxTotal)}</td><td style={{padding:'6px 8px',textAlign:'right',fontWeight:700}}>{fmtM(subtotal)}</td></tr>
                  <tr style={{background:'var(--accent-lt)'}}><td colSpan={5} style={{padding:'6px 8px',fontWeight:800,textAlign:'right',color:'var(--accent)'}}>Grand Total (incl. tax)</td><td style={{padding:'6px 8px',textAlign:'right',fontWeight:800,color:'var(--accent)',fontFamily:'monospace'}}>{fmtM(grandTotal)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </div>)}
          {step===2&&(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'end'}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Carrier *</label>
              {(!shippers || shippers.length===0) && (
                <div style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600,marginBottom:6}}>
                  ⚠ No active shippers configured. Showing common carrier list fallback.
                </div>
              )}
              <select className="input" value={shipperId} onChange={e=>setShipperId(e.target.value)} style={{borderColor:shipperId?'var(--green)':'var(--amber,#d97706)'}}>
                <option value="">— Select carrier —</option>
                {carrierOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="others">Others</option>
              </select>
            </div>
            {shipperId === 'others' && (
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Enter Carrier Name *</label>
                <input
                  className="input"
                  value={otherCarrierName}
                  onChange={e=>setOtherCarrierName(e.target.value)}
                  placeholder="Enter carrier manually"
                  style={{borderColor:otherCarrierName.trim()?'var(--green)':'var(--amber,#d97706)'}}
                />
              </div>
            )}
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">AWB / Tracking Number *</label>
              <input className="input" value={awb} onChange={e=>setAwb(e.target.value)} placeholder="Enter outbound AWB" style={{borderColor:awb?'var(--green)':'var(--amber,#d97706)'}}/>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
            </div>
          </div>)}
          {step===3&&(<div style={{display:'grid',gap:16}}>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:`1px solid ${invoiceRef&&invoiceFile?'var(--green)':'var(--amber,#d97706)'}`,background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>🧾 Invoice <span style={{color:'var(--red)'}}>*</span></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Zoho Invoice Number *</label>
                  <input className="input" value={invoiceRef} onChange={e=>{
                    setInvoiceRef(e.target.value);
                    setDsGenerated(false);
                    setDsPreviewed(false);
                    setDsReviewed(false);
                    setPlGenerated(false);
                    setPlPreviewed(false);
                    setPlReviewed(false);
                  }} placeholder="e.g. INV-2026-00123" style={{borderColor:invoiceRef?'var(--green)':'var(--amber,#d97706)'}}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Upload Invoice PDF *</label>
                  <input type="file" accept=".pdf,.PDF" className="input" onChange={handleInvoiceFile} style={{padding:'6px',borderColor:invoiceFile?(invoiceUploadStatus==='error'?'var(--red)':'var(--green)'):'var(--amber,#d97706)'}}/>
                  {invoiceFile&&<div style={{fontSize:11,color:invoiceUploadStatus==='error'?'var(--red)':invoiceUploadStatus==='uploading'?'var(--accent)':'var(--green)',marginTop:2}}>
                    {invoiceUploadStatus==='uploading'?'Uploading…':invoiceUploadStatus==='error'?'Upload failed:':'✅ Uploaded:'} {invoiceFile.name}
                  </div>}
                </div>
              </div>
            </div>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:6}}>📄 Delivery Slip</div>
              {invoiceRef.trim() && <div style={{fontSize:12,color:'var(--text3)',marginBottom:10}}>Invoice: {invoiceRef}</div>}
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={generateDS} disabled={!invoiceRef.trim()} title={!invoiceRef.trim()?'Enter invoice number first':''}>⚙ Generate DS</button>
                {dsGenerated && <button className="btn btn-sm" onClick={previewDS}>👁 Preview DS</button>}
                {dsGenerated && (
                  <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="checkbox" checked={dsReviewed} disabled={!dsPreviewed} onChange={e=>setDsReviewed(e.target.checked)} style={{accentColor:'var(--green)'}}/>
                    ✅ DS reviewed and correct
                  </label>
                )}
                {dsGenerated && !dsPreviewed && <span style={{fontSize:11,color:'var(--text3)'}}>Preview required before tick</span>}
              </div>
            </div>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:6}}>📦 Packing List</div>
              {invoiceRef.trim() && <div style={{fontSize:12,color:'var(--text3)',marginBottom:10}}>Invoice: {invoiceRef}</div>}
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={generatePL}>⚙ Generate PL</button>
                {plGenerated && <button className="btn btn-sm" onClick={previewPL}>👁 Preview PL</button>}
                {plGenerated && (
                  <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="checkbox" checked={plReviewed} disabled={!plPreviewed} onChange={e=>setPlReviewed(e.target.checked)} style={{accentColor:'var(--green)'}}/>
                    ✅ PL reviewed and correct
                  </label>
                )}
                {plGenerated && !plPreviewed && <span style={{fontSize:11,color:'var(--text3)'}}>Preview required before tick</span>}
              </div>
            </div>
            {ewayRequired&&(<div style={{padding:'14px 16px',borderRadius:'var(--r)',border:`1px solid ${ewayBill?'var(--green)':'var(--red)'}`,background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>🚛 E-way Bill * <span style={{fontSize:11,color:'var(--red)',marginLeft:8}}>Required — India &gt; ₹50,000</span></div>
              <input className="input" value={ewayBill} onChange={e=>setEwayBill(e.target.value)} placeholder="e.g. EWB-123456789012" style={{borderColor:ewayBill?'var(--green)':'var(--red)'}}/>
            </div>)}
          </div>)}
          {step===4&&(<div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:16,color:'var(--accent)'}}>Review and confirm dispatch</div>
            <div style={{display:'grid',gap:10,fontSize:13}}>
              {[{l:'Items',v:`${selectedItems.length} of ${allItems.length}`},{l:'Type',v:selectedItems.length<allItems.length?'⚠ Partial':'✅ Full'},{l:'Invoice ref',v:invoiceRef},{l:'Carrier',v:shipperName},{l:'AWB',v:awb},{l:'E-way Bill',v:ewayBill||'N/A'},{l:'DS / PL',v:'✅ Generated & reviewed'}].map(row=>(
                <div key={row.l} style={{display:'flex',gap:12,padding:'8px 12px',borderRadius:'var(--r-sm)',background:'var(--surface2)'}}>
                  <span style={{fontWeight:700,color:'var(--text2)',minWidth:120}}>{row.l}</span><span>{row.v}</span>
                </div>
              ))}
              <div style={{padding:'10px 12px',borderRadius:'var(--r-sm)',background:'var(--accent-lt)',border:'1px solid var(--accent)33'}}>
                <div style={{fontWeight:700,color:'var(--accent)'}}>Grand Total: {fmtM(grandTotal)}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>Subtotal: {fmtM(subtotal)} + Tax: {fmtM(taxTotal)}</div>
              </div>
            </div>
          </div>)}
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn" onClick={step===1?onClose:()=>setStep(s=>s-1)}>{step===1?'Cancel':'← Back'}</button>
          {step<4?(
            <button className="btn btn-primary" disabled={(step===1&&selectedItems.length===0)||(step===2&&!canProceedShipping)||(step===3&&!canProceedDocuments)} onClick={()=>setStep(s=>s+1)}>Next →</button>
          ):(
            <button className="btn btn-primary" style={{background:'var(--teal,#0d9488)',borderColor:'var(--teal,#0d9488)',fontWeight:700}} disabled={saving} onClick={handleDispatch}>{saving?'Dispatching…':'🚚 Confirm Dispatch'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ConfirmDeliveryModal — Mark shipment as received by customer ──────────────
function ConfirmDeliveryModal({ order, shipment, onClose, onSaved }) {
  const qc = useQueryClient();
  const [form, setForm]   = useState({
    delivery_date: new Date().toISOString().slice(0,10),
    pod_ref:       '',
    notes:         '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleConfirm = async () => {
    if (!form.delivery_date) { toast.error('Delivery date is required'); return; }
    if (!shipment?.id) { toast.error('No active shipment found'); return; }
    setSaving(true);
    try {
      await api.put('/shipments/' + shipment.id, {
        status:       'delivered',
        pod_ref:      form.pod_ref,
        notes:        form.notes,
        delivered_at: form.delivery_date,
      });
      toast.success('✅ Shipment marked as delivered!');
      qc.invalidateQueries(['orders']);
      onSaved();
    } catch(e) { toast.error(e.response?.data?.error||'Failed to confirm delivery'); }
    finally { setSaving(false); }
  };

  const allItems = order.lineItems || [];
  const grnQtyByItem = (order.grnRecords || []).reduce((m, r) => {
    m[r.order_item_id] = (m[r.order_item_id] || 0) + (parseInt(r.qty_received, 10) || 0);
    return m;
  }, {});
  const shippedQtyByItem = (order.shipments || []).flatMap(s => s.items || []).reduce((m, si) => {
    m[si.order_item_id] = (m[si.order_item_id] || 0) + (parseInt(si.qty_shipped, 10) || 0);
    return m;
  }, {});
  const supplierSections = (order.supplierOrders || []).map(so => {
    const items = (so.items || []).map(id => allItems.find(li => li.id === id)).filter(Boolean);
    const ordered = items.reduce((sum, li) => sum + (li.qty || 0), 0);
    const received = items.reduce((sum, li) => sum + (grnQtyByItem[li.id] || 0), 0);
    const shipped = items.reduce((sum, li) => sum + (shippedQtyByItem[li.id] || 0), 0);
    const pending = Math.max(0, ordered - received);
    return { so, items, ordered, received, shipped, pending };
  }).filter(section => section.items.length > 0);
  const orderOrdered = supplierSections.reduce((sum, section) => sum + section.ordered, 0);
  const orderReceived = supplierSections.reduce((sum, section) => sum + section.received, 0);
  const orderPending = supplierSections.reduce((sum, section) => sum + section.pending, 0);
  const orderShipped = supplierSections.reduce((sum, section) => sum + section.shipped, 0);

  return (
    <div className="overlay">
      <div className="modal" style={{width:'min(1120px, 96vw)', maxWidth:'96vw', maxHeight:'92vh'}}>
        <div className="modal-header">
          <div>
            <h2>✅ Mark Received by Customer</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              {order.id} · Shipment {shipment?.shipment_no || shipment?.id}
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{marginBottom:16,padding:'12px 14px',background:'var(--accent-lt)',borderRadius:'var(--r-sm)',fontSize:12}}>
            <div style={{fontWeight:700,marginBottom:8,color:'var(--accent)'}}>📦 Delivery Summary</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4, minmax(120px, 1fr))',gap:10}}>
              <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>ORDERED</div><div style={{fontWeight:800,fontSize:20}}>{orderOrdered}</div></div>
              <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>GRN RECEIVED</div><div style={{fontWeight:800,fontSize:20,color:'var(--green)'}}>{orderReceived}</div></div>
              <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>PENDING</div><div style={{fontWeight:800,fontSize:20,color:'var(--purple,#7c3aed)'}}>{orderPending}</div></div>
              <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>SHIPPED TO CUSTOMER</div><div style={{fontWeight:800,fontSize:20,color:'var(--teal,#0d9488)'}}>{orderShipped}</div></div>
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:16}}>
            {supplierSections.map(section => {
              const supplierName = section.so.supplier_name || section.so.supplier_id || section.so.supplier || 'Supplier';
              return (
                <div key={section.so.id} style={{border:'1px solid var(--border)',borderRadius:'var(--r-sm)',overflow:'hidden',background:'var(--surface)'}}>
                  <div style={{padding:'10px 14px',background:'var(--accent-lt)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                      <div style={{fontWeight:800,color:'var(--accent)'}}>📦 {supplierName}</div>
                      <div className="mono" style={{fontSize:11,color:'var(--text3)'}}>{section.so.internal_po_no || section.so.id}</div>
                    </div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#fff',border:'1px solid var(--border)',fontWeight:700,color:'var(--text2)'}}>Ordered: {section.ordered}</span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'var(--green-lt)',border:'1px solid var(--green)33',fontWeight:700,color:'var(--green)'}}>Rcvd: {section.received}</span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#f5f3ff',border:'1px solid #c4b5fd',fontWeight:700,color:'var(--purple,#7c3aed)'}}>Pending: {section.pending}</span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'var(--teal-lt,#f0fdfa)',border:'1px solid var(--teal,#0d9488)33',fontWeight:700,color:'var(--teal,#0d9488)'}}>Shipped: {section.shipped}</span>
                    </div>
                  </div>

                  {section.so.credit_note_no && (
                    <div style={{padding:'8px 14px',background:'var(--amber-lt,#fffbeb)',borderTop:'1px solid #f59e0b33',display:'flex',gap:18,flexWrap:'wrap',fontSize:11}}>
                      <div style={{fontWeight:700,color:'var(--amber,#92400e)'}}>Credit Note: <span className="mono">{section.so.credit_note_no}</span></div>
                      <div style={{fontWeight:700,color:'var(--amber,#92400e)'}}>Amount: {fmtM(Number(section.so.credit_note_amount) || 0)}</div>
                      <div style={{fontWeight:600,color:'var(--text2)'}}>Date: {section.so.credit_note_date || '—'}</div>
                    </div>
                  )}

                  <div style={{display:'grid',gridTemplateColumns:'1.5fr 90px 90px 90px 100px',padding:'8px 14px',background:'var(--surface2)',fontSize:10,fontWeight:700,color:'var(--text3)',letterSpacing:.3}}>
                    <span>COMPONENT</span>
                    <span style={{textAlign:'right'}}>ORDERED</span>
                    <span style={{textAlign:'right'}}>RECEIVED</span>
                    <span style={{textAlign:'right'}}>PENDING</span>
                    <span style={{textAlign:'right'}}>SHIPPED</span>
                  </div>
                  {section.items.map(li => (
                    <div key={li.id} style={{display:'grid',gridTemplateColumns:'1.5fr 90px 90px 90px 100px',padding:'8px 14px',borderTop:'1px solid var(--border)',fontSize:12,alignItems:'center'}}>
                      <div>
                        <div style={{fontWeight:700}}>{li.component}</div>
                        <div style={{fontSize:11,color:'var(--text3)'}}>{li.manufacturer || '—'}</div>
                      </div>
                      <div style={{textAlign:'right',fontWeight:700}}>{li.qty || 0}</div>
                      <div style={{textAlign:'right',fontWeight:700,color:'var(--green)'}}>{grnQtyByItem[li.id] || 0}</div>
                      <div style={{textAlign:'right',fontWeight:700,color:'var(--purple,#7c3aed)'}}>{Math.max(0, (li.qty || 0) - (grnQtyByItem[li.id] || 0))}</div>
                      <div style={{textAlign:'right',fontWeight:700,color:'var(--teal,#0d9488)'}}>{shippedQtyByItem[li.id] || 0}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Actual Delivery Date <span className="req">*</span></label>
              <input className="input" type="date" value={form.delivery_date}
                onChange={e=>set('delivery_date',e.target.value)}
                style={{borderColor:'var(--green)'}}/>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">POD Reference (Proof of Delivery)</label>
              <input className="input" value={form.pod_ref}
                onChange={e=>set('pod_ref',e.target.value)}
                placeholder="e.g. Signed delivery receipt number, customer ref"/>
            </div>
          </div>
          <div style={{display:'grid',gap:12,marginTop:12}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={form.notes}
                onChange={e=>set('notes',e.target.value)}
                placeholder="e.g. Delivered to warehouse manager John"/>
            </div>
          </div>
          <div style={{marginTop:12,padding:'10px 14px',borderRadius:'var(--r)',
            background:'var(--green-lt)',border:'1px solid var(--green)33',fontSize:12,
            color:'var(--green)',fontWeight:600}}>
            ✅ Confirming this will mark this shipment delivered. The order closes automatically once every shipment on it has been marked delivered.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            style={{background:'var(--green)',borderColor:'var(--green)',fontWeight:700}}
            disabled={saving} onClick={handleConfirm}>
            {saving?'Confirming…':'✅ Mark Received by Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeliveryHubPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected,         setSelected]         = useState(null);
  const [selectedPoId,     setSelectedPoId]     = useState(null);
  const [escalating,       setEscalating]       = useState(null);
  const [search,           setSearch]           = useState('');
  const [filter,           setFilter]           = useState('all');
  const [dispatch,         setDispatch]         = useState(null);
  const [confirming,       setConfirming]       = useState(null);
  const [editDelivery,     setEditDelivery]     = useState(null); // { soId, field, value }
  const [savingDelivery,   setSavingDelivery]   = useState(false);
  const [collapsedHubSections, setCollapsedHubSections] = useState({});

  const isHubSectionOpen = (key) => collapsedHubSections[key] !== false;
  const toggleHubSection = (key) => setCollapsedHubSections(prev => ({ ...prev, [key]: prev[key] === false ? true : false }));

  const saveDeliveryDate = async () => {
    if (!editDelivery) return;
    setSavingDelivery(true);
    try {
      await api.put(`/supplier-orders/${editDelivery.soId}`, { [editDelivery.field]: editDelivery.value });
      qc.invalidateQueries(['orders']);
      toast.success('Date updated');
      setEditDelivery(null);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Failed to update');
    } finally {
      setSavingDelivery(false);
    }
  };

  const { data: orders    = [], isLoading } = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>r.data).catch(()=>[]),    refetchInterval:20000 });
  const { data: suppliers = [] }            = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data).catch(()=>[]) });
  const { data: customers = [] }            = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: shippers  = [] }            = useQuery({ queryKey:['shippers'],  queryFn:()=>api.get('/shippers').then(r=>r.data).catch(()=>[]) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;

  // Auto-open order from URL param ?order=<id> (e.g. navigated from Procurement Send to Hub)
  useEffect(() => {
    if (!orders.length) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    const poId    = params.get('po');
    if (!orderId) return;
    const target = orders.find(o => o.id === orderId);
    if (target) {
      setSelected(target);
      if (poId) setSelectedPoId(poId);
      // Clean the URL so refreshing doesn't re-open
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [orders]);
  const isInTransitToCustomer = (o) => ['partial_dispatched','transit_customer'].includes(o.status);
  const hasGRNProgress = (o) => {
    const items = o.lineItems || [];
    const byLine = items.some(li => ['ready_to_ship','grn_partial','grn_rejected'].includes(li.line_status));
    const byStatus = ['in_hub','partial_hub'].includes(o.status);
    return byLine || byStatus;
  };

  // Delivery Hub = orders where ALL POs are received (line items at delivered_hub or ready_to_ship)
  // OR orders with status='delivery_hub'
  const hubOrders = orders.filter(o => {
    if (o.status === 'delivery_hub') return true;
    if (o.status === 'transit_hub')        return true;  // AWB entered — in transit to hub
    if (o.status === 'partial_hub')        return true;  // partial GRN done
    if (o.status === 'partial_dispatched') return true;  // some shipments sent
    if (o.status === 'transit_customer')   return true;  // all dispatched — awaiting delivery
    if (o.status === 'payment_approval')   return false; // still waiting for payment
    if (!['procurement','open'].includes(o.status)) return false;
    const items = o.lineItems||[];
    const soList = o.supplierOrders||[];
    if (soList.length === 0) return false;
    // All POs received
    const allReceived = soList.every(so=>so.status==='received');
    // At least one item at delivered_hub
    const hasHubItems = items.some(li=>['delivered_hub','ready_to_ship','grn_partial'].includes(li.line_status));
    return allReceived || hasHubItems;
  });

  const filtered = useMemo(() => {
    let list = hubOrders.filter(o=>{
      if (!search) return true;
      const q = search.toLowerCase();
      return o.id.toLowerCase().includes(q) ||
             custName(o.customer_id).toLowerCase().includes(q) ||
             (o.lineItems||[]).some(li=>(li.component||'').toLowerCase().includes(q));
    });
    if (filter==='pending-grn')   list=list.filter(o=>!hasGRNProgress(o)&&!isInTransitToCustomer(o));
    if (filter==='ready')         list=list.filter(o=>hasGRNProgress(o)&&!isInTransitToCustomer(o));
    if (filter==='in-transit')    list=list.filter(o=>isInTransitToCustomer(o));
    return list.sort((a,b)=>(b.created_at||b.updated_at||'').localeCompare(a.created_at||a.updated_at||''));
  }, [hubOrders, search, filter]);

  // Stats
  const pendingGRN     = hubOrders.filter(o=>!hasGRNProgress(o)&&!isInTransitToCustomer(o)).length;
  const readyToShip    = hubOrders.filter(o=>hasGRNProgress(o)&&!isInTransitToCustomer(o)).length;
  const inTransitCust  = hubOrders.filter(o=>isInTransitToCustomer(o)).length;
  const totalItems  = hubOrders.flatMap(o=>o.lineItems||[]).filter(li=>['delivered_hub','ready_to_ship'].includes(li.line_status)).length;

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:13,marginBottom:18}}>
        {[
          {label:'Orders at Hub',       val:hubOrders.length,  color:'var(--accent)'},
          {label:'⏳ Pending GRN',       val:pendingGRN,        color:'var(--amber,#d97706)'},
          {label:'✅ GRN Done',          val:readyToShip,       color:'var(--green)'},
          {label:'📦 Items at Hub',      val:totalItems,        color:'var(--teal,#0d9488)'},
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{fontSize:24,color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search by order, customer, component…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div className="filter-row" style={{marginBottom:0}}>
          {[
            {v:'all',         l:`All (${hubOrders.length})`},
            {v:'pending-grn', l:`⏳ Pending GRN (${pendingGRN})`},
            {v:'ready',       l:`✅ In Hub (${readyToShip})`},
            {v:'in-transit',  l:`🚚 In Transit to Customer (${inTransitCust})`},
          ].map(f=>(
            <span key={f.v} className={`fchip ${filter===f.v?'active':''}`} onClick={()=>setFilter(f.v)}>{f.l}</span>
          ))}
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading delivery hub…</div>}

      {!isLoading && filtered.length===0 && (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <div className="empty-state-text">
            {hubOrders.length===0
              ? 'No orders at the Delivery Hub yet — goods appear here once all POs are marked Received in Procurement.'
              : 'No orders match your filter'}
          </div>
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        {filtered.map(order => {
          const allItems   = order.lineItems||[];
          const soList     = order.supplierOrders||[];
          const grnDone        = hasGRNProgress(order);
          const isInTransit    = isInTransitToCustomer(order);
          const shipmentList   = order.shipments||[];
          const orderVal   = allItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
          const hasPartial = allItems.some(li=>li.line_status==='grn_partial');
          const hasReject  = allItems.some(li=>li.line_status==='grn_rejected');
          // Balance tracking
          const grnQtyByItem = (order.grnRecords||[]).reduce((m,r)=>{m[r.order_item_id]=(m[r.order_item_id]||0)+(parseInt(r.qty_received)||0);return m;},{});
          const partialShippedItems = allItems.filter(li=>li.line_status==='partial_shipped');
          const readyToShipItems    = allItems.filter(li=>['ready_to_ship','grn_partial','delivered_hub'].includes(li.line_status));
          const hasBalance     = partialShippedItems.length > 0;
          const hasReadyItems  = readyToShipItems.length > 0;
          // Each segment kept separate (rather than one joined string) so the
          // ENQ/QT reference numbers can be bolded/highlighted independently.
          const metaSegments = [
            order.enquiry_no ? { label:'ENQ', value:order.enquiry_no, strong:true }  : null,
            order.quote_no   ? { label:'QT',  value:order.quote_no,   strong:true }  : null,
            order.po_number  ? { label:'PO',  value:order.po_number,  strong:false } : null,
          ].filter(Boolean);
          const shippedQtyByItem = (shipmentList || []).flatMap(s => s.items || []).reduce((m, si) => {
            m[si.order_item_id] = (m[si.order_item_id] || 0) + (parseInt(si.qty_shipped, 10) || 0);
            return m;
          }, {});
          const allOpenShipments = shipmentList.filter(s => s.status !== 'delivered');
          const hasCustomerShipmentInFlight = allOpenShipments.length > 0;
          // Per-PO reason this order isn't ready, so the disabled button can tell
          // you exactly which supplier PO is blocking it (and why) instead of a
          // generic "wait" message.
          const blockingSOs = soList.filter(so => {
            const soItems = (so.items || []).map(id => allItems.find(li => li.id === id)).filter(Boolean);
            if (!soItems.length) return true;
            const fullyShipped = soItems.every(li => ['shipped', 'delivered'].includes(li.line_status));
            if (fullyShipped) return false;
            if (!so.credit_note_no) return true;
            return !soItems.every(li => (shippedQtyByItem[li.id] || 0) >= (grnQtyByItem[li.id] || 0));
          });
          const supplierDeliveryReady = soList.length > 0 && blockingSOs.length === 0;
          const canMarkCustomerReceived = hasCustomerShipmentInFlight && supplierDeliveryReady;
          const blockReason = !hasCustomerShipmentInFlight
            ? 'No open shipment to confirm'
            : soList.length === 0
              ? 'No supplier PO linked to this order yet'
              : blockingSOs.length > 0
                ? `Waiting on ${blockingSOs.map(so => `${so.internal_po_no||so.id}${so.credit_note_no ? '' : ' (needs credit note for short shipment)'}`).join(', ')}`
                : '';

          // Single, always-correct "what to do next" for this specific order —
          // same stage order as the diagnostic check, but folded straight into
          // the card instead of a separate popup: GRN → Ship Now → Shipped →
          // Customer Confirm → (nothing left, order closes on its own).
          const nextAction = (() => {
            const shortItems = allItems.filter(li => {
              const rcvd = grnQtyByItem[li.id] || 0;
              if (rcvd >= (li.qty||0)) return false;
              const so = soList.find(s => (s.items||[]).includes(li.id));
              return !(so && so.credit_note_no);
            });
            if (shortItems.length) {
              return { icon:'📋', label:'Next: Record GRN', color:'var(--purple,#7c3aed)', bg:'#f5f3ff',
                detail: `Pending for ${shortItems.map(li=>li.component).join(', ')}` };
            }
            const atHubItems = allItems.filter(li => (grnQtyByItem[li.id]||0) > (shippedQtyByItem[li.id]||0));
            if (atHubItems.length) {
              return { icon:'📦', label:'Next: Ship Now', color:'var(--teal,#0d9488)', bg:'var(--teal-lt,#f0fdfa)',
                detail: `Ready to dispatch: ${atHubItems.map(li=>li.component).join(', ')}` };
            }
            if (!hasCustomerShipmentInFlight && soList.length && allItems.every(li=>['shipped','delivered'].includes(li.line_status))) {
              return null; // fully shipped, no open shipment left to confirm — nothing pending on this order
            }
            if (hasCustomerShipmentInFlight) {
              return { icon:'✅', label:'Next: Confirm Received by Customer', color:'var(--accent)', bg:'var(--accent-lt)',
                detail: blockReason && !canMarkCustomerReceived ? blockReason : 'Ready to confirm' };
            }
            return null;
          })();
          const shipperNameFor = (value) => {
            if (!value) return '';
            return shippers.find(s => s.id === value)?.name || value;
          };

          return (
            <div key={order.id} className="card" style={{
              marginBottom:0,
              borderLeft:`3px solid ${isInTransit?'var(--teal,#0d9488)':grnDone?'var(--green)':hasReject?'var(--red)':hasPartial?'var(--amber,#d97706)':'var(--accent)'}`,
            }}>
              <div className="flex-between" style={{marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span className="mono bold" style={{fontSize:14}}>{order.id}</span>
                  {metaSegments.map((seg, i) => (
                    <span key={seg.label} style={{fontSize:12,display:'inline-flex',alignItems:'center',gap:4}}>
                      {i>0 && <span style={{color:'var(--text3)',marginRight:4}}>·</span>}
                      <span style={{color:'var(--text3)',fontWeight:600}}>{seg.label}</span>
                      <span className="mono" style={{
                        fontWeight: seg.strong ? 800 : 600,
                        color: seg.strong ? 'var(--accent)' : 'var(--text3)',
                      }}>{seg.value}</span>
                    </span>
                  ))}
                  <StatusBadge s={order.status}/>
                  {nextAction && (
                    <span title={nextAction.detail} style={{
                      fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
                      color:nextAction.color, background:nextAction.bg, border:`1px solid ${nextAction.color}44`,
                    }}>{nextAction.icon} {nextAction.label}</span>
                  )}
                  {isInTransit && <span style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700,padding:'2px 8px',borderRadius:999,background:'var(--teal-lt,#f0fdfa)'}}>🚚 In Transit to Customer</span>}
                  {grnDone && !isInTransit && !hasBalance && <span className="badge badge-green">✅ GRN Done — Ready for Outbound</span>}
                  {!grnDone && !isInTransit && !hasBalance && <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⏳ Pending GRN</span>}
                  {hasBalance && <span style={{fontSize:11,color:'var(--purple,#7c3aed)',fontWeight:700,padding:'2px 8px',borderRadius:999,background:'#f5f3ff'}}>⏳ Balance Pending from Supplier</span>}
                  {hasPartial && <span className="badge" style={{background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)'}}>⚠ Short Shipment</span>}
                  {hasReject  && <span className="badge badge-red">❌ Rejected Items</span>}
                  <DaysBadge updatedAt={order.updated_at||order.created_at} />
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  {/* P3: Overdue detection + escalation */}
                  {(()=>{
                    if (!order.tentative_date) return null;
                    const today = new Date().toISOString().slice(0,10);
                    const isOverdue = order.tentative_date < today && !['transit_customer','partial_dispatched','closed'].includes(order.status);
                    const level = order.escalation_level || 0;
                    return (
                      <span style={{fontSize:12,
                        color: isOverdue ? (level>=2?'var(--red)':'var(--amber,#d97706)') : 'var(--text3)',
                        fontWeight: isOverdue ? 700 : 400,
                        display:'flex',alignItems:'center',gap:4}}>
                        {level>=2 && <span style={{color:'var(--red)',fontSize:14}}>★</span>}
                        Due: <strong>{order.tentative_date}</strong>
                        {isOverdue && <span style={{fontSize:10,padding:'1px 6px',borderRadius:99,
                          background:level>=2?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)',
                          color:level>=2?'var(--red)':'var(--amber,#d97706)'}}>
                          {level>=2?'🔴 Escalated':'⚠ Overdue'}
                        </span>}
                      </span>
                    );
                  })()}
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    {/* Overdue escalation */}
                    {(()=>{
                      const today = new Date().toISOString().slice(0,10);
                      const isOverdue = order.tentative_date && order.tentative_date < today && !isInTransit;
                      if (!isOverdue) return null;
                      const level = order.escalation_level || 0;
                      return (
                        <button className="btn btn-xs"
                          style={{color:'var(--amber,#d97706)',borderColor:'var(--amber,#d97706)',fontSize:11}}
                          onClick={()=>setEscalating({order, newDate:''})}>
                          {level>=1?'🔴 Re-escalate':'⚠ Escalate'}
                        </button>
                      );
                    })()}
                    {/* Mark Received: only shown when there's exactly one open shipment —
                        with multiple open shipments, use the per-shipment "Confirm" button
                        below instead, so confirming one never silently also completes others. */}
                    {hasCustomerShipmentInFlight && allOpenShipments.length === 1 && (
                      <button className="btn btn-xs"
                        style={canMarkCustomerReceived
                          ? {background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700}
                          : {background:'var(--surface2)',color:'var(--text3)',borderColor:'var(--border)',fontWeight:700,cursor:'not-allowed'}}
                        disabled={!canMarkCustomerReceived}
                        title={blockReason}
                        onClick={()=>{
                          if (!canMarkCustomerReceived) {
                            toast.error(blockReason || 'Wait until all supplier GRN and shipment lines are completed');
                            return;
                          }
                          setConfirming({ order, shipment: allOpenShipments[0] });
                        }}>
                        ✅ Mark Received by Customer
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))',gap:14,fontSize:12,marginBottom:10,alignItems:'flex-start'}}>
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>CUSTOMER</div><div style={{fontWeight:600}}>{custName(order.customer_id)}</div></div>
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>ORDER VALUE</div><div style={{fontWeight:700,color:'var(--accent)'}}>{fmtM(orderVal)}</div></div>
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>ITEMS</div><div style={{fontWeight:600}}>{allItems.length} line item{allItems.length!==1?'s':''}</div></div>
                {order.delivery_address && (
                  <div style={{gridColumn:'span 2'}}><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>SHIP TO</div><div style={{fontWeight:600,maxWidth:260,fontSize:11}}>{order.delivery_address}</div></div>
                )}
                {(order.supplierOrders||[]).map(so => (
                  <React.Fragment key={so.id}>
                    {so.promised_delivery_date && (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>
                          📅 PROMISE DATE{(order.supplierOrders||[]).length>1 && <span style={{color:'var(--accent)'}}> ({so.internal_po_no||so.id})</span>}
                        </div>
                        <div style={{fontWeight:700,color:'var(--text)'}}>{so.promised_delivery_date}</div>
                      </div>
                    )}
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>
                        🚚 ACTUAL DELIVERY{(order.supplierOrders||[]).length>1 && <span style={{color:'var(--accent)'}}> ({so.internal_po_no||so.id})</span>}
                      </div>
                      {editDelivery?.soId===so.id && editDelivery?.field==='actual_delivery_date' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                          <input type="date" className="input"
                            style={{height:24,padding:'0 4px',fontSize:11,width:130}}
                            value={editDelivery.value}
                            onChange={e=>setEditDelivery(d=>({...d,value:e.target.value}))}
                            onKeyDown={e=>{if(e.key==='Enter')saveDeliveryDate();if(e.key==='Escape')setEditDelivery(null);}}
                            autoFocus/>
                          <button className="btn btn-sm btn-primary" disabled={savingDelivery} onClick={saveDeliveryDate}
                            style={{fontSize:10,padding:'1px 7px',height:24,fontWeight:700}}>{savingDelivery?'…':'✓'}</button>
                          <button className="btn btn-sm" onClick={()=>setEditDelivery(null)}
                            style={{fontSize:10,padding:'1px 5px',height:24}}>✕</button>
                        </span>
                      ) : (
                        <div style={{display:'flex',alignItems:'center',gap:5}}>
                          <span style={{fontWeight:700,color:so.actual_delivery_date?'var(--green)':'var(--text3)'}}>
                            {so.actual_delivery_date||'—'}
                          </span>
                          <span
                            onClick={()=>setEditDelivery({soId:so.id,field:'actual_delivery_date',value:so.actual_delivery_date||''})}
                            style={{cursor:'pointer',fontSize:11,color:'var(--accent)',opacity:.75}}
                            title="Set actual delivery date">✎</span>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Shipments list for in-transit orders */}
              {isInTransit && shipmentList.length > 0 && (
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--text2)',marginBottom:6}}>📦 Shipments</div>
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {shipmentList.map(ship=>(
                      <div key={ship.id} style={{padding:'8px 12px',borderRadius:'var(--r-sm)',
                        background:ship.status==='delivered'?'var(--green-lt)':'var(--accent-lt)',
                        border:`1px solid ${ship.status==='delivered'?'var(--green)':'var(--accent)'}33`,
                        display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                        <div style={{fontSize:12}}>
                              <span style={{fontWeight:700}}>Shipment {ship.shipment_no}</span>
                              <span style={{color:'var(--text3)',marginLeft:8}}>{ship.tracking_no||'No AWB'}</span>
                              {ship.shipper_id && <span style={{color:'var(--accent)',marginLeft:8,fontWeight:600}}>{shipperNameFor(ship.shipper_id)}</span>}
                              {ship.invoice_ref&&<span style={{color:'var(--text2)',marginLeft:8}}>INV: {ship.invoice_ref}</span>}
                          <span style={{marginLeft:8,fontSize:11,padding:'1px 7px',borderRadius:999,fontWeight:600,
                            background:ship.status==='delivered'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',
                            color:ship.status==='delivered'?'var(--green)':'var(--amber,#d97706)'}}>
                            {ship.status==='delivered'?'✅ Delivered':'🚚 In Transit'}
                          </span>
                          {ship.delivered_at&&<span style={{color:'var(--text3)',marginLeft:8,fontSize:11}}>on {ship.delivered_at.slice(0,10)}</span>}
                        </div>
                        {ship.status!=='delivered' && (
                          <button className="btn btn-xs"
                            style={canMarkCustomerReceived
                              ? {background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700}
                              : {background:'var(--surface2)',color:'var(--text3)',borderColor:'var(--border)',fontWeight:700,cursor:'not-allowed'}}
                            disabled={!canMarkCustomerReceived}
                            title={blockReason}
                            onClick={()=>{
                              if (!canMarkCustomerReceived) { toast.error(blockReason || 'Wait until all supplier GRN and shipment lines are completed'); return; }
                              setConfirming({ order, shipment: ship });
                            }}>
                            ✅ Confirm
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* ── Per-supplier PO breakdown ── */}
              {(()=>{
                const shippedQtyMap = (order.shipments||[]).flatMap(s=>s.items||[]).reduce((m,si)=>{
                  m[si.order_item_id]=(m[si.order_item_id]||0)+(parseInt(si.qty_shipped)||0);
                  return m;
                },{});
                const HUB_PO_STATUSES = ['in_transit', 'partially_received', 'received'];
                const HUB_LINE_STATUSES = ['delivered_hub', 'ready_to_ship', 'grn_partial', 'grn_rejected', 'partial_shipped', 'shipped'];
                // An order only ever reaches Delivery Hub once at least one PO/line
                // is hub-side — but that doesn't mean every PO on it is. A PO that's
                // still stuck pre-GRN (e.g. never received) must stay visible here
                // too, since it's exactly the one blocking "Mark Received by
                // Customer" — hiding it made the blocker invisible in this view.
                const visibleSoList = soList.filter(so => {
                  if (HUB_PO_STATUSES.includes(so.status)) return true;
                  const soItems = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
                  if (soItems.some(li => HUB_LINE_STATUSES.includes(li.line_status))) return true;
                  return soItems.some(li => (grnQtyByItem[li.id]||0) < (li.qty||0));
                });
                const LINE_ICON = {
                  delivered_hub:   {ic:'📦',l:'At Hub',        c:'var(--teal,#0d9488)'},
                  ready_to_ship:   {ic:'✅',l:'Ready',          c:'var(--green)'},
                  grn_partial:     {ic:'⚠', l:'Partial GRN',   c:'var(--amber,#d97706)'},
                  grn_rejected:    {ic:'❌',l:'Rejected',       c:'var(--red)'},
                  partial_shipped: {ic:'🔄',l:'Bal. Pending',   c:'var(--purple,#7c3aed)'},
                  shipped:         {ic:'🚚',l:'Shipped Out',    c:'var(--text3)'},
                  procurement:     {ic:'🛒',l:'Procurement',    c:'var(--text3)'},
                  negotiating:     {ic:'🚚',l:'In Transit',     c:'var(--accent)'},
                  in_transit:      {ic:'🚚',l:'In Transit',     c:'var(--accent)'},
                };

                // Only show standalone items that have actually reached hub-side statuses.
                const unPoedItems = allItems.filter(li =>
                  HUB_LINE_STATUSES.includes(li.line_status) &&
                  !visibleSoList.some(so => (so.items||[]).includes(li.id))
                );

                return (
                  <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:4}}>
                    {visibleSoList.map(so=>{
                      const soItems = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
                      if (!soItems.length) return null;
                      const totOrdered  = soItems.reduce((s,li)=>s+(li.qty||0),0);
                      const totRcvd     = soItems.reduce((s,li)=>s+(grnQtyByItem[li.id]||0),0);
                      const totPending  = totOrdered - totRcvd;
                      const totShipped  = soItems.reduce((s,li)=>s+(shippedQtyMap[li.id]||0),0);
                      const totBalShip  = Math.max(0, totRcvd - totShipped); // received but not yet shipped to customer
                      const supName     = suppliers.find(s=>s.id===so.supplier_id)?.name||'—';
                      const poStatus    = so.status;
                      const headerBg    = poStatus==='received'?'var(--green-lt)':totPending>0?'#f5f3ff':'var(--surface2)';
                      const headerBord  = poStatus==='received'?'var(--green)':totPending>0?'#c4b5fd':'var(--border)';
                      const headerCol   = poStatus==='received'?'var(--green)':totPending>0?'var(--purple,#7c3aed)':'var(--text2)';
                      const sectionKey  = `${order.id}:${so.id}`;
                      const sectionOpen = isHubSectionOpen(sectionKey);
                      return (
                        <div key={so.id} style={{borderRadius:'var(--r-sm)',border:`1.5px solid ${headerBord}`,overflow:'hidden'}}>
                          {/* Supplier header row */}
                          <div style={{padding:'7px 12px',background:headerBg,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                              <span style={{fontWeight:700,fontSize:12,color:headerCol}}>
                                {poStatus==='received'?'✅':'⏳'} {supName}
                              </span>
                              <span className="mono" style={{fontSize:11,color:'var(--text3)'}}>
                                {so.internal_po_no||so.id}
                              </span>
                              {so.shipper_id&&<span style={{fontSize:13,color:'var(--accent)',fontWeight:800,letterSpacing:'0.03em',textTransform:'uppercase',padding:'2px 8px',borderRadius:6,background:'var(--accent-lt)',border:'1px solid var(--accent)44'}}>🚚 {shipperNameFor(so.shipper_id)}</span>}
                              {so.tracking_no&&<span style={{fontSize:13,color:'var(--teal,#0d9488)',fontWeight:800,fontFamily:'monospace',padding:'2px 8px',borderRadius:6,background:'var(--teal-lt,#f0fdfa)',border:'1px solid var(--teal,#0d9488)44'}}>AWB {so.tracking_no}</span>}
                              {so.ship_load_date&&<span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>Load {so.ship_load_date}</span>}
                            </div>
                            <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                              <span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text2)',fontWeight:600}}>Ordered: {totOrdered}</span>
                              {totRcvd>0&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'var(--green-lt)',color:'var(--green)',fontWeight:700,border:'1px solid var(--green)44'}}>✅ Rcvd: {totRcvd}</span>}
                              {totPending>0&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'#f5f3ff',color:'var(--purple,#7c3aed)',fontWeight:700,border:'1px solid #c4b5fd'}}>⏳ Pending: {totPending}</span>}
                              {totBalShip>0&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',fontWeight:700,border:'1px solid var(--amber,#d97706)44'}}>📦 At Hub: {totBalShip}</span>}
                              {totShipped>0&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'var(--teal-lt,#f0fdfa)',color:'var(--teal,#0d9488)',fontWeight:700,border:'1px solid var(--teal,#0d9488)44'}}>🚚 Shipped: {totShipped}</span>}
                              {so.credit_note_no && <span style={{fontSize:10,padding:'2px 7px',borderRadius:999,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#92400e)',fontWeight:700,border:'1px solid #f59e0b44'}}>📄 CN {so.credit_note_no}</span>}
                              {/* Per-supplier action buttons */}
                              {(()=>{
                                const needsGRN = totPending > 0 || soItems.some(li=>['delivered_hub','grn_partial','partial_shipped'].includes(li.line_status));
                                const canShip  = totBalShip > 0;
                                return (
                                  <div style={{display:'flex',gap:4,marginLeft:4}}>
                                    {needsGRN && (
                                      <button className="btn btn-xs btn-primary"
                                        style={{fontSize:10,padding:'2px 8px'}}
                                        onClick={()=>{ setSelected(order); setSelectedPoId(so.id); }}>
                                        📋 {totRcvd>0&&totPending>0 ? 'Balance GRN' : 'Record GRN'}
                                      </button>
                                    )}
                                    {canShip && (
                                      <button className="btn btn-xs"
                                        style={{fontSize:10,padding:'2px 8px',
                                          background:'var(--teal,#0d9488)',color:'#fff',
                                          borderColor:'var(--teal,#0d9488)',fontWeight:700}}
                                        onClick={()=>setDispatch({ order, soId: so.id })}>
                                        📦 Ship Now →
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                              <button className="btn btn-xs"
                                style={{fontSize:10,padding:'2px 8px',fontWeight:700}}
                                onClick={()=>toggleHubSection(sectionKey)}>
                                {sectionOpen ? '▾ Hide' : '▸ Show'}
                              </button>
                            </div>
                          </div>
                          {so.credit_note_no && (
                            <div style={{padding:'8px 12px',background:'var(--amber-lt,#fffbeb)',borderTop:'1px solid #f59e0b33',display:'flex',gap:16,flexWrap:'wrap',fontSize:11}}>
                              <div style={{fontWeight:700,color:'var(--amber,#92400e)'}}>Credit Note: <span className="mono">{so.credit_note_no}</span></div>
                              <div style={{fontWeight:600,color:'var(--amber,#92400e)'}}>Amount: {fmtM(Number(so.credit_note_amount)||0)}</div>
                              <div style={{fontWeight:600,color:'var(--text2)'}}>Date: {so.credit_note_date || '—'}</div>
                            </div>
                          )}
                          {/* Per-item detail rows */}
                          {sectionOpen && <div style={{background:'var(--surface)'}}>
                            {soItems.map((li,idx)=>{
                              const rcvd    = grnQtyByItem[li.id]||0;
                              const shipped = shippedQtyMap[li.id]||0;
                              const pending = (li.qty||0) - rcvd;
                              const atHub   = Math.max(0, rcvd - shipped);
                              const li_info = LINE_ICON[li.line_status]||{ic:'·',l:li.line_status||'—',c:'var(--text3)'};
                              return (
                                <div key={li.id} style={{
                                  display:'grid',
                                  gridTemplateColumns:'1fr 60px 60px 60px 60px 80px',
                                  gap:0,fontSize:11,padding:'5px 12px',
                                  borderTop: idx===0?'none':'0.5px solid var(--border)',
                                  alignItems:'center'}}>
                                  <span style={{fontWeight:600,color:'var(--accent)'}}>{li.component}</span>
                                  <span style={{textAlign:'center',color:'var(--text2)',fontWeight:600}}>×{li.qty}</span>
                                  <span style={{textAlign:'center',fontWeight:700,color:rcvd>0?'var(--green)':'var(--text3)'}}>{rcvd>0?rcvd:'—'}</span>
                                  <span style={{textAlign:'center',fontWeight:700,color:pending>0?'var(--purple,#7c3aed)':'var(--text3)'}}>{pending>0?pending:'✓'}</span>
                                  <span style={{textAlign:'center',fontWeight:700,color:atHub>0?'var(--amber,#d97706)':'var(--text3)'}}>{atHub>0?atHub:'—'}</span>
                                  <span style={{textAlign:'right',fontWeight:600,color:li_info.c,fontSize:10}}>{li_info.ic} {li_info.l}</span>
                                </div>
                              );
                            })}
                            {/* Column label row */}
                            <div style={{display:'grid',gridTemplateColumns:'1fr 60px 60px 60px 60px 80px',
                              gap:0,padding:'3px 12px',background:'var(--surface2)',
                              borderTop:'0.5px solid var(--border)',fontSize:9,fontWeight:700,color:'var(--text3)',letterSpacing:.4}}>
                              <span>COMPONENT</span>
                              <span style={{textAlign:'center'}}>ORDERED</span>
                              <span style={{textAlign:'center',color:'var(--green)'}}>RCVD</span>
                              <span style={{textAlign:'center',color:'var(--purple,#7c3aed)'}}>PENDING</span>
                              <span style={{textAlign:'center',color:'var(--amber,#d97706)'}}>AT HUB</span>
                              <span style={{textAlign:'right'}}>STATUS</span>
                            </div>
                          </div>}
                        </div>
                      );
                    })}
                    {/* Items with no PO */}
                    {unPoedItems.length>0&&(
                      <div style={{borderRadius:'var(--r-sm)',border:'1.5px solid var(--border)',overflow:'hidden'}}>
                        <div style={{padding:'6px 12px',background:'var(--surface2)',fontSize:11,fontWeight:700,color:'var(--text3)'}}>
                          ⚠ Items not yet assigned to a supplier PO
                        </div>
                        {unPoedItems.map((li,idx)=>(
                          <div key={li.id} style={{display:'flex',gap:10,fontSize:11,padding:'5px 12px',
                            borderTop:idx===0?'none':'0.5px solid var(--border)',alignItems:'center'}}>
                            <span style={{fontWeight:600}}>{li.component}</span>
                            <span style={{color:'var(--text3)'}}>×{li.qty}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {selected && (
        <GRNModal order={selected} suppliers={suppliers} filterPoId={selectedPoId}
          onClose={()=>{ setSelected(null); setSelectedPoId(null); }}
          onSaved={()=>{ setSelected(null); setSelectedPoId(null); qc.invalidateQueries(['orders']); }}/>
      )}

      {/* P3: Escalation modal */}
      {escalating && (
        <div className="overlay">
          <div className="modal modal-sm">
            <div className="modal-header">
              <h2>⚠ Escalate Overdue Delivery</h2>
              <button className="close-x" onClick={()=>setEscalating(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{marginBottom:14,fontSize:13,color:'var(--text2)'}}>
                Order <strong>{escalating.order.id}</strong> is overdue.
                {(escalating.order.escalation_level||0) >= 1 && (
                  <span style={{color:'var(--red)',fontWeight:700}}> (Previously escalated {escalating.order.escalation_level}×)</span>
                )}
              </div>
              <div className="form-group">
                <label className="label">Reschedule Delivery Date (optional)</label>
                <input className="input" type="date"
                  value={escalating.newDate}
                  onChange={e=>setEscalating(s=>({...s,newDate:e.target.value}))}/>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>Leave blank to flag without rescheduling.</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setEscalating(null)}>Cancel</button>
              <button className="btn btn-primary"
                style={{background:'var(--amber,#d97706)',borderColor:'var(--amber,#d97706)'}}
                onClick={async()=>{
                  const level = (escalating.order.escalation_level||0) + 1;
                  try {
                    await api.post('/orders/'+escalating.order.id+'/escalate',
                      { level, new_date: escalating.newDate });
                    toast.success('Escalation L'+level+' recorded'+(escalating.newDate?' — rescheduled to '+escalating.newDate:''));
                    qc.invalidateQueries(['orders']);
                    setEscalating(null);
                  } catch(e){ toast.error('Failed'); }
                }}>
                {(escalating.order.escalation_level||0)>=1?'🔴 Re-escalate':'⚠ Escalate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {dispatch && (
        <CreateShipmentModal order={dispatch.order} soId={dispatch.soId} customers={customers} shippers={shippers}
          onClose={()=>setDispatch(null)}
          onSaved={()=>setDispatch(null)}/>
      )}
      {confirming && (
        <ConfirmDeliveryModal
          order={confirming.order}
          shipment={confirming.shipment}
          onClose={()=>setConfirming(null)}
          onSaved={()=>setConfirming(null)}/>
      )}
    </div>
  );
}
