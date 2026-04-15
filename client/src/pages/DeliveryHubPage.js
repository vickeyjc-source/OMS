// client/src/pages/DeliveryHubPage.js
// Stage 7 — Inbound Delivery Hub: receive goods, GRN, move to Logistics
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

function fmtM(n,c='INR'){const s={INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};return(s[c]||c+' ')+(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}

// ── GRN Modal — confirm quantities, flag shortages ───────────────────────────
function GRNModal({ order, suppliers, onClose, onSaved }) {
  const qc = useQueryClient();
  const supName = id => suppliers.find(s=>s.id===id)?.name||id;
  const today = new Date().toISOString().slice(0,10);

  const [grn, setGrn] = useState(() => {
    const g = {};
    (order.lineItems||[]).forEach(li => {
      const po = (order.supplierOrders||[]).find(so=>(so.items||[]).includes(li.id));
      g[li.id] = {
        qty_received: String(li.qty),
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
  const setG = (id,k,v) => setGrn(g=>({...g,[id]:{...g[id],[k]:v}}));

  const items = order.lineItems||[];

  // ── Summary calculations ──────────────────────────────────────────────────
  const summary = items.reduce((acc, li) => {
    const qty = parseInt(grn[li.id]?.qty_received) || 0;
    acc.totalOrdered += li.qty;
    acc.totalReceived += qty;
    if (qty >= li.qty && li.qty > 0) acc.full++;
    else if (qty > 0) acc.partial++;
    else acc.pending++;
    return acc;
  }, { full:0, partial:0, pending:0, totalOrdered:0, totalReceived:0 });
  const overallPct = summary.totalOrdered > 0
    ? Math.round((summary.totalReceived / summary.totalOrdered) * 100) : 0;
  const allFull     = summary.full === items.length && items.length > 0;
  const anyFilled   = summary.full + summary.partial > 0;
  const hasShortage = items.some(li => (parseInt(grn[li.id]?.qty_received)||0) < li.qty);
  const hasDamaged  = Object.values(grn).some(r=>r.condition==='damaged'||r.condition==='rejected');

  const buildRecords = () => items.map(li => {
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

  const handleGRN = async (partialSave=false) => {
    setSaving(true);
    try {
      const records = buildRecords();
      const res = await api.post('/orders/'+order.id+'/grn', { records, partial: partialSave });
      const partialMsg = res.data.order_status === 'partial_hub' ? ' — Partial, balance still expected' : '';
      const grnLabel = res.data.grn_no ? res.data.grn_no + ' recorded!' : 'GRN recorded!';
      toast.success('✅ ' + grnLabel + partialMsg);
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
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
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
          {(order.supplierOrders||[]).length>0 && (
            <div style={{marginBottom:14,display:'flex',gap:8,flexWrap:'wrap'}}>
              {(order.supplierOrders||[]).map(so=>(
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
                <th style={{textAlign:'right'}}>Ordered</th>
                <th style={{textAlign:'right'}}>Received</th>
                <th style={{width:100}}>Receipt %</th>
                <th>Condition</th>
                <th style={{color:'var(--teal,#0d9488)'}}>COO</th>
                <th style={{color:'var(--teal,#0d9488)'}}>Date Code</th>
                <th style={{color:'var(--teal,#0d9488)'}}>LOT</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((li,i) => {
                const row    = grn[li.id]||{};
                const qty    = parseInt(row.qty_received)||0;
                const pct    = li.qty > 0 ? Math.round((qty/li.qty)*100) : 0;
                const isFull = qty >= li.qty && li.qty > 0;
                const isPartial = qty > 0 && !isFull;
                const shortage  = qty < li.qty;
                const dotColor  = isFull ? '#1D9E75' : isPartial ? '#BA7517' : 'var(--border)';
                const inputBorderColor = isFull ? '#1D9E75' : isPartial ? '#BA7517' : 'var(--border)';
                const barColor  = isFull ? '#1D9E75' : '#BA7517';
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
                    {/* Ordered qty */}
                    <td style={{textAlign:'right',fontWeight:600}}>{li.qty}</td>
                    {/* Received qty input */}
                    <td style={{textAlign:'right'}}>
                      <input className="input" type="number" min="0" max={li.qty*2}
                        value={row.qty_received}
                        onChange={e=>setG(li.id,'qty_received',e.target.value)}
                        style={{width:72,textAlign:'center',fontWeight:700,
                          borderColor: inputBorderColor}}/>
                      {shortage && qty>0 && (
                        <div style={{fontSize:10,color:'#BA7517',fontWeight:600,marginTop:2}}>
                          ⚠ Short by {li.qty - qty}
                        </div>
                      )}
                    </td>
                    {/* Progress bar */}
                    <td>
                      <div style={{width:80,height:4,background:'var(--surface2)',borderRadius:2}}>
                        <div style={{width:pct+'%',height:4,borderRadius:2,
                          background:qty>0?barColor:'transparent',transition:'width .2s'}}/>
                      </div>
                      <div style={{fontSize:10,color:'var(--text3)',marginTop:3,fontFamily:'monospace'}}>
                        {qty>0?pct+'%':'—'}
                      </div>
                    </td>
                    {/* Condition */}
                    <td>
                      <select className="input" value={row.condition}
                        onChange={e=>setG(li.id,'condition',e.target.value)}
                        style={{fontSize:11,
                          borderColor:row.condition==='damaged'||row.condition==='rejected'?'var(--red)':
                          row.condition==='good'&&isFull?'#1D9E75':undefined}}>
                        <option value="good">✅ Good</option>
                        <option value="partial">⚠ Partial damage</option>
                        <option value="damaged">❌ Damaged</option>
                        <option value="rejected">🚫 Rejected</option>
                      </select>
                    </td>
                    {/* COO */}
                    <td><input className="input" value={row.coo||''}
                      onChange={e=>setG(li.id,'coo',e.target.value)}
                      placeholder="CN" style={{fontSize:11,width:55}}/></td>
                    {/* Date Code */}
                    <td><input className="input" value={row.date_code||''}
                      onChange={e=>setG(li.id,'date_code',e.target.value)}
                      placeholder="2345" style={{fontSize:11,width:60}}/></td>
                    {/* LOT */}
                    <td><input className="input" value={row.lot_number||''}
                      onChange={e=>setG(li.id,'lot_number',e.target.value)}
                      placeholder="Batch/LOT" style={{fontSize:11,width:80}}/></td>
                    {/* Notes */}
                    <td><input className="input" value={row.notes}
                      onChange={e=>setG(li.id,'notes',e.target.value)}
                      placeholder="Optional remarks"
                      style={{fontSize:11}}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── Summary bar ── */}
          <div style={{display:'flex',alignItems:'center',gap:20,
            background:'var(--surface2)',border:'1px solid var(--border)',
            borderRadius:8,padding:'12px 18px',margin:'14px 0'}}>
            {[
              {label:'Line Items',        val:items.length,       color:'var(--text)'},
              {label:'Fully Received',    val:summary.full,       color:'#1D9E75'},
              {label:'Partially Received',val:summary.partial,    color:'#BA7517'},
              {label:'Not Yet Received',  val:summary.pending,    color:'var(--text3)'},
              {label:'Overall Receipt',   val:overallPct+'%',     color:overallPct===100?'#1D9E75':overallPct>0?'#BA7517':'var(--text3)'},
            ].map((s,i,arr)=>(
              <React.Fragment key={s.label}>
                <div style={{textAlign:'center'}}>
                  <div style={{fontFamily:'monospace',fontSize:20,fontWeight:500,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.5,marginTop:2}}>{s.label}</div>
                </div>
                {i<arr.length-1&&<div style={{width:1,height:36,background:'var(--border)'}}/>}
              </React.Fragment>
            ))}
          </div>

          {/* Discrepancy warning */}
          {(hasShortage||hasDamaged) && (
            <div style={{padding:'10px 14px',borderRadius:'var(--r)',
              background:'var(--amber-lt,#fffbeb)',border:'2px solid var(--amber,#d97706)'}}>
              <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)',marginBottom:4}}>⚠ Discrepancies Found</div>
              {hasShortage && <div style={{fontSize:12}}>• Short shipment detected — balance stays pending in hub</div>}
              {hasDamaged  && <div style={{fontSize:12}}>• Damaged/rejected items — raise RMA or insurance claim</div>}
              <div style={{fontSize:12,marginTop:4,color:'var(--text3)'}}>Order will proceed with received items. Remaining items flagged for follow-up.</div>
            </div>
          )}
        </div>

        {/* ── Footer: Save Partial + Submit Full ── */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          {/* P2: Separate partial save and full submit buttons */}
          <button className="btn"
            style={{background:'#FAEEDA',color:'#633806',borderColor:'#EF9F27',fontWeight:600}}
            disabled={saving || !anyFilled || allFull}
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


// ── DS / PL HTML generators ───────────────────────────────────────────────────
function generateDSHtml(order, selectedItems, shipmentNo, shipperName, awb, custName) {
  const today = new Date().toLocaleDateString('en-IN');
  const rows = selectedItems.map(li =>
    `<tr><td>${li.component}</td><td>${li.manufacturer||'—'}</td><td>${li.ipn||'—'}</td><td style="text-align:center">${li.qty}</td><td></td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><title>Delivery Slip — ${order.id}</title>
  <style>body{font-family:Arial,sans-serif;padding:32px;font-size:13px}h2{margin:0}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{background:#f3f4f6;padding:8px;border:1px solid #d1d5db;text-align:left}
  td{padding:7px 8px;border:1px solid #d1d5db}
  .sig{margin-top:40px;display:flex;gap:60px}.sig-box{border-top:1px solid #000;padding-top:6px;min-width:160px;font-size:11px}
  @media print{.no-print{display:none}}</style></head><body>
  <div class="no-print" style="background:#3b82f6;color:#fff;padding:10px 16px;margin-bottom:20px;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
    <span>📄 Delivery Slip Preview — Shipment ${shipmentNo}</span>
    <button onclick="window.print()" style="background:#fff;color:#3b82f6;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print / Save PDF</button>
  </div>
  <h2>DELIVERY CHALLAN — Shipment ${shipmentNo}</h2>
  <p>Date: ${today} | Order: ${order.id} | Customer PO: ${order.po_number||'—'} | Carrier: ${shipperName||'—'} | AWB: ${awb||'TBD'}</p>
  <p><strong>Ship To:</strong> ${custName} — ${order.delivery_address||''}</p>
  <table><thead><tr><th>Component / Description</th><th>Manufacturer</th><th>IPN</th><th style="text-align:center">Qty</th><th>Remarks</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="sig"><div class="sig-box">Prepared By</div><div class="sig-box">Authorised Signatory</div><div class="sig-box">Received By (Customer)</div></div>
  </body></html>`;
}

function generatePLHtml(order, selectedItems, grnRecords, shipmentNo, custName) {
  const today = new Date().toLocaleDateString('en-IN');
  const rows = selectedItems.map(li => {
    const grn = (grnRecords||[]).find(g=>g.order_item_id===li.id)||{};
    return `<tr><td>${li.component}</td><td>${li.manufacturer||'—'}</td><td>${li.ipn||'—'}</td>
    <td style="text-align:center">${li.qty}</td><td>${grn.date_code||'—'}</td>
    <td>${grn.lot_number||'—'}</td><td>${grn.coo||'—'}</td><td>${grn.weight_kg||'—'}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><title>Packing List — ${order.id}</title>
  <style>body{font-family:Arial,sans-serif;padding:32px;font-size:12px}h2{margin:0}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{background:#f3f4f6;padding:7px;border:1px solid #d1d5db;text-align:left;font-size:11px}
  td{padding:6px 7px;border:1px solid #d1d5db}
  @media print{.no-print{display:none}}</style></head><body>
  <div class="no-print" style="background:#0d9488;color:#fff;padding:10px 16px;margin-bottom:20px;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
    <span>📦 Packing List Preview — Shipment ${shipmentNo}</span>
    <button onclick="window.print()" style="background:#fff;color:#0d9488;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print / Save PDF</button>
  </div>
  <h2>PACKING LIST — Shipment ${shipmentNo} · ${today}</h2>
  <p>Order: ${order.id} | Customer PO: ${order.po_number||'—'} | Ship To: ${custName} — ${order.delivery_address||''}</p>
  <table><thead><tr><th>Component</th><th>Manufacturer</th><th>IPN</th><th>Qty</th><th>Date Code</th><th>LOT</th><th>COO</th><th>Weight(kg)</th></tr></thead>
  <tbody>${rows}</tbody></table>
  </body></html>`;
}

// ── CreateShipmentModal ───────────────────────────────────────────────────────
function CreateShipmentModal({ order, customers, shippers, onClose, onSaved }) {
  const qc = useQueryClient();
  const custObj  = customers.find(c=>c.id===order.customer_id)||{};
  const custName = custObj.name||order.customer_id;
  const allItems = (order.lineItems||[]).filter(li=>['ready_to_ship','grn_partial','delivered_hub'].includes(li.line_status));
  const existingShipNos = (order.shipments||[]).length;
  const [step, setStep]         = useState(1);
  const [saving, setSaving]     = useState(false);
  const [selected, setSelected] = useState(()=>{ const s={}; allItems.forEach(li=>{s[li.id]=true;}); return s; });
  const [dsReviewed, setDsReviewed] = useState(false);
  const [plReviewed, setPlReviewed] = useState(false);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceB64, setInvoiceB64]   = useState('');
  const [ewayBill, setEwayBill]   = useState('');
  const [shipperId, setShipperId] = useState('');
  const [awb,       setAwb]       = useState('');
  const [notes,     setNotes]     = useState('');
  const selectedItems  = allItems.filter(li=>selected[li.id]);
  const shipNo         = existingShipNos + 1;
  const shipperName    = shippers.find(s=>s.id===shipperId)?.name||'';
  const orderValINR    = selectedItems.reduce((s,li)=>li.currency==='INR'?s+(li.qty||0)*(li.unit_price||0):s,0);
  const ewayRequired   = custObj.country==='India' && orderValINR>50000;
  const subtotal       = selectedItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
  const taxTotal       = selectedItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0)*((li.tax_rate||0)/100),0);
  const grandTotal     = subtotal+taxTotal;
  const handleInvoiceFile = (e) => {
    const file = e.target.files[0]; if(!file) return;
    setInvoiceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setInvoiceB64(ev.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  };
  const previewDS = () => { const w=window.open('','_blank'); w.document.write(generateDSHtml(order,selectedItems,shipNo,shipperName,awb,custName)); w.document.close(); };
  const previewPL = () => { const w=window.open('','_blank'); w.document.write(generatePLHtml(order,selectedItems,order.grnRecords||[],shipNo,custName)); w.document.close(); };
  const canProceed2 = dsReviewed && plReviewed && invoiceRef.trim() && (!ewayRequired||ewayBill.trim());
  const canProceed3 = awb.trim() && shipperId;
  const handleDispatch = async () => {
    setSaving(true);
    try {
      await api.post('/orders/'+order.id+'/shipments', {
        type: selectedItems.length===allItems.length?'full':'partial',
        shipper_id:shipperId, tracking_no:awb, invoice_ref:invoiceRef,
        invoice_file:invoiceB64, eway_bill:ewayBill, delivery_slip:'generated', packing_list:'generated', notes,
        items: selectedItems.map(li=>({order_item_id:li.id,qty_shipped:li.qty})),
      });
      toast.success(`✅ Shipment ${shipNo} dispatched!`);
      qc.invalidateQueries(['orders']); onSaved();
    } catch(e) { toast.error(e.response?.data?.error||'Dispatch failed'); }
    finally { setSaving(false); }
  };
  const STEPS = ['Select Items','Documents','Shipping','Confirm'];
  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div><h2>📦 Create Shipment — {order.id}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>Shipment {shipNo} · {custName}</div></div>
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
            <table className="li-table"><thead><tr><th>✓</th><th>Component</th><th>Manufacturer</th><th>IPN</th><th>Qty</th><th>Status</th></tr></thead>
            <tbody>{allItems.map(li=>(
              <tr key={li.id} style={{background:selected[li.id]?'var(--accent-lt)':undefined}}>
                <td><input type="checkbox" checked={!!selected[li.id]} onChange={e=>setSelected(p=>({...p,[li.id]:e.target.checked}))}/></td>
                <td style={{fontWeight:600}}>{li.component}</td><td>{li.manufacturer||'—'}</td>
                <td className="mono" style={{fontSize:11}}>{li.ipn||'—'}</td><td>{li.qty}</td>
                <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:li.line_status==='ready_to_ship'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',color:li.line_status==='ready_to_ship'?'var(--green)':'var(--amber,#d97706)',fontWeight:600}}>{li.line_status==='ready_to_ship'?'✅ Ready':'⚠ Partial'}</span></td>
              </tr>
            ))}</tbody></table>
            {selectedItems.length>0&&(
              <div style={{marginTop:16,padding:'12px 16px',background:'var(--surface2)',borderRadius:'var(--r)',fontSize:12}}>
                <div style={{fontWeight:700,marginBottom:8,color:'var(--text2)'}}>💰 Shipment Value (for your reference — not printed on documents)</div>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{borderBottom:'1px solid var(--border)'}}><th style={{padding:'4px 8px',textAlign:'left',fontSize:11}}>Component</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Qty</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Unit Price</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Tax%</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Tax Amt</th><th style={{padding:'4px 8px',textAlign:'right',fontSize:11}}>Line Total</th></tr></thead>
                  <tbody>{selectedItems.map(li=>{const base=(li.qty||0)*(li.unit_price||0);const tax=base*((li.tax_rate||0)/100);return(<tr key={li.id} style={{borderBottom:'0.5px solid var(--border)'}}><td style={{padding:'4px 8px'}}>{li.component}</td><td style={{padding:'4px 8px',textAlign:'right'}}>{li.qty}</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmtM(li.unit_price,li.currency)}</td><td style={{padding:'4px 8px',textAlign:'right'}}>{li.tax_rate||0}%</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmtM(tax,li.currency)}</td><td style={{padding:'4px 8px',textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmtM(base+tax,li.currency)}</td></tr>);})}</tbody>
                  <tfoot><tr style={{borderTop:'2px solid var(--border)'}}><td colSpan={4} style={{padding:'6px 8px',fontWeight:700,textAlign:'right'}}>Subtotal + Tax</td><td style={{padding:'6px 8px',textAlign:'right'}}>{fmtM(taxTotal)}</td><td style={{padding:'6px 8px',textAlign:'right',fontWeight:700}}>{fmtM(subtotal)}</td></tr>
                  <tr style={{background:'var(--accent-lt)'}}><td colSpan={5} style={{padding:'6px 8px',fontWeight:800,textAlign:'right',color:'var(--accent)'}}>Grand Total (incl. tax)</td><td style={{padding:'6px 8px',textAlign:'right',fontWeight:800,color:'var(--accent)',fontFamily:'monospace'}}>{fmtM(grandTotal)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </div>)}
          {step===2&&(<div style={{display:'grid',gap:16}}>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>📄 Delivery Slip</div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={previewDS}>👁 Preview DS</button>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                  <input type="checkbox" checked={dsReviewed} onChange={e=>setDsReviewed(e.target.checked)} style={{accentColor:'var(--green)'}}/>
                  ✅ DS reviewed and correct
                </label>
              </div>
            </div>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>📦 Packing List</div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={previewPL}>👁 Preview PL</button>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                  <input type="checkbox" checked={plReviewed} onChange={e=>setPlReviewed(e.target.checked)} style={{accentColor:'var(--green)'}}/>
                  ✅ PL reviewed and correct
                </label>
              </div>
            </div>
            <div style={{padding:'14px 16px',borderRadius:'var(--r)',border:`1px solid ${invoiceRef?'var(--green)':'var(--amber,#d97706)'}`,background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>🧾 Invoice <span style={{color:'var(--red)'}}>*</span></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Zoho Invoice Number *</label>
                  <input className="input" value={invoiceRef} onChange={e=>setInvoiceRef(e.target.value)} placeholder="e.g. INV-2026-00123" style={{borderColor:invoiceRef?'var(--green)':'var(--amber,#d97706)'}}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Upload Invoice PDF (optional)</label>
                  <input type="file" accept=".pdf,.PDF" className="input" onChange={handleInvoiceFile} style={{padding:'6px'}}/>
                  {invoiceFile&&<div style={{fontSize:11,color:'var(--green)',marginTop:2}}>✅ {invoiceFile.name}</div>}
                </div>
              </div>
            </div>
            {ewayRequired&&(<div style={{padding:'14px 16px',borderRadius:'var(--r)',border:`1px solid ${ewayBill?'var(--green)':'var(--red)'}`,background:'var(--surface2)'}}>
              <div style={{fontWeight:700,marginBottom:10}}>🚛 E-way Bill * <span style={{fontSize:11,color:'var(--red)',marginLeft:8}}>Required — India &gt; ₹50,000</span></div>
              <input className="input" value={ewayBill} onChange={e=>setEwayBill(e.target.value)} placeholder="e.g. EWB-123456789012" style={{borderColor:ewayBill?'var(--green)':'var(--red)'}}/>
            </div>)}
          </div>)}
          {step===3&&(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Carrier *</label>
              <select className="input" value={shipperId} onChange={e=>setShipperId(e.target.value)} style={{borderColor:shipperId?'var(--green)':'var(--amber,#d97706)'}}>
                <option value="">— Select carrier —</option>
                {shippers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">AWB / Tracking Number *</label>
              <input className="input" value={awb} onChange={e=>setAwb(e.target.value)} placeholder="Enter outbound AWB" style={{borderColor:awb?'var(--green)':'var(--amber,#d97706)'}}/>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
            </div>
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
            <button className="btn btn-primary" disabled={(step===1&&selectedItems.length===0)||(step===2&&!canProceed2)||(step===3&&!canProceed3)} onClick={()=>setStep(s=>s+1)}>Next →</button>
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
    setSaving(true);
    try {
      await api.put('/shipments/'+shipment.id, {
        status:        'delivered',
        pod_ref:       form.pod_ref,
        notes:         form.notes,
        delivered_at:  form.delivery_date,
      });
      toast.success('✅ Shipment marked as delivered!');
      qc.invalidateQueries(['orders']);
      onSaved();
    } catch(e) { toast.error(e.response?.data?.error||'Failed to confirm delivery'); }
    finally { setSaving(false); }
  };

  const shipItems = (shipment.items||[]).map(si =>
    (order.lineItems||[]).find(li=>li.id===si.order_item_id)
  ).filter(Boolean);

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-md">
        <div className="modal-header">
          <div>
            <h2>✅ Confirm Delivery — Shipment {shipment.shipment_no}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              {order.id} · AWB: {shipment.tracking_no||'—'}
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Items in this shipment */}
          {shipItems.length > 0 && (
            <div style={{marginBottom:16,padding:'10px 14px',background:'var(--accent-lt)',
              borderRadius:'var(--r-sm)',fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:6,color:'var(--accent)'}}>📦 Items in this shipment</div>
              {shipItems.map(li=>(
                <div key={li.id} style={{display:'flex',justifyContent:'space-between',
                  padding:'3px 0',borderBottom:'0.5px solid var(--border)'}}>
                  <span style={{fontWeight:600}}>{li.component}</span>
                  <span style={{color:'var(--text2)'}}>Qty: {li.qty}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{display:'grid',gap:12}}>
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
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={form.notes}
                onChange={e=>set('notes',e.target.value)}
                placeholder="e.g. Delivered to warehouse manager John"/>
            </div>
          </div>
          {/* Auto-close notice */}
          {(order.shipments||[]).filter(s=>s.id!==shipment.id&&s.status!=='delivered').length===0 && (
            <div style={{marginTop:12,padding:'10px 14px',borderRadius:'var(--r)',
              background:'var(--green-lt)',border:'1px solid var(--green)33',fontSize:12,
              color:'var(--green)',fontWeight:600}}>
              ✅ This is the last shipment — confirming delivery will automatically close the order.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            style={{background:'var(--green)',borderColor:'var(--green)',fontWeight:700}}
            disabled={saving} onClick={handleConfirm}>
            {saving?'Confirming…':'✅ Confirm Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeliveryHubPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected,   setSelected]   = useState(null);
  const [escalating, setEscalating] = useState(null); // { order, newDate }
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('all');
  const [dispatch,   setDispatch]   = useState(null);
  const [confirming, setConfirming] = useState(null);

  const { data: orders    = [], isLoading } = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>r.data).catch(()=>[]),    refetchInterval:20000 });
  const { data: suppliers = [] }            = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data).catch(()=>[]) });
  const { data: customers = [] }            = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: shippers  = [] }            = useQuery({ queryKey:['shippers'],  queryFn:()=>api.get('/shippers').then(r=>r.data).catch(()=>[]) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;

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
    if (filter==='pending-grn')   list=list.filter(o=>!['delivery_hub','in_hub','partial_hub','partial_dispatched','transit_customer'].includes(o.status));
    if (filter==='ready')         list=list.filter(o=>['delivery_hub','in_hub','partial_hub'].includes(o.status));
    if (filter==='in-transit')    list=list.filter(o=>['partial_dispatched','transit_customer'].includes(o.status));
    return list;
  }, [hubOrders, search, filter]);

  // Stats
  const pendingGRN     = hubOrders.filter(o=>!['delivery_hub','in_hub','partial_hub','partial_dispatched','transit_customer'].includes(o.status)).length;
  const readyToShip    = hubOrders.filter(o=>['delivery_hub','in_hub','partial_hub'].includes(o.status)).length;
  const inTransitCust  = hubOrders.filter(o=>['partial_dispatched','transit_customer'].includes(o.status)).length;
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
          const grnDone        = ['delivery_hub','in_hub','partial_hub'].includes(order.status);
          const isInTransit    = ['partial_dispatched','transit_customer'].includes(order.status);
          const shipmentList   = order.shipments||[];
          const orderVal   = allItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
          const hasPartial = allItems.some(li=>li.line_status==='grn_partial');
          const hasReject  = allItems.some(li=>li.line_status==='grn_rejected');

          return (
            <div key={order.id} className="card" style={{
              marginBottom:0,
              borderLeft:`3px solid ${isInTransit?'var(--teal,#0d9488)':grnDone?'var(--green)':hasReject?'var(--red)':hasPartial?'var(--amber,#d97706)':'var(--accent)'}`,
            }}>
              <div className="flex-between" style={{marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span className="mono bold" style={{fontSize:14}}>{order.id}</span>
                  <StatusBadge s={order.status}/>
                  {isInTransit && <span style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700,padding:'2px 8px',borderRadius:999,background:'var(--teal-lt,#f0fdfa)'}}>🚚 In Transit to Customer</span>}
                  {grnDone && !isInTransit && <span className="badge badge-green">✅ GRN Done — Ready for Outbound</span>}
                  {!grnDone && !isInTransit && <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⏳ Pending GRN</span>}
                  {hasPartial && <span className="badge" style={{background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)'}}>⚠ Short Shipment</span>}
                  {hasReject  && <span className="badge badge-red">❌ Rejected Items</span>}
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
                  {isInTransit ? (
                    <button className="btn btn-xs"
                      style={{background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700}}
                      onClick={()=>setConfirming(order)}>
                      ✅ Mark Received by Customer
                    </button>
                  ) : !grnDone ? (
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-xs btn-primary" onClick={()=>setSelected(order)}>
                        📋 Record GRN
                      </button>
                      {/* P3: Escalation button — shown when overdue */}
                      {(()=>{
                        const today = new Date().toISOString().slice(0,10);
                        const isOverdue = order.tentative_date && order.tentative_date < today;
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
                    </div>
                  ) : (
                    <button className="btn btn-xs btn-primary"
                      style={{background:'var(--teal,#0d9488)',borderColor:'var(--teal,#0d9488)',fontWeight:700}}
                      onClick={()=>setDispatch(order)}>
                      📦 Create Shipment →
                    </button>
                  )}
                </div>
              </div>

              <div style={{display:'flex',gap:20,flexWrap:'wrap',fontSize:12,marginBottom:10}}>
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>CUSTOMER</div><div style={{fontWeight:600}}>{custName(order.customer_id)}</div></div>
                {order.po_number&&<div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>CUST PO</div><div className="mono" style={{fontWeight:600}}>{order.po_number}</div></div>}
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>ORDER VALUE</div><div style={{fontWeight:700,color:'var(--accent)'}}>{fmtM(orderVal)}</div></div>
                <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>ITEMS</div><div style={{fontWeight:600}}>{allItems.length} line item{allItems.length!==1?'s':''}</div></div>
                {order.delivery_address && (
                  <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>SHIP TO</div><div style={{fontWeight:600,maxWidth:200,fontSize:11}}>{order.delivery_address}</div></div>
                )}
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
                          {ship.invoice_ref&&<span style={{color:'var(--text2)',marginLeft:8}}>INV: {ship.invoice_ref}</span>}
                          <span style={{marginLeft:8,fontSize:11,padding:'1px 7px',borderRadius:999,fontWeight:600,
                            background:ship.status==='delivered'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',
                            color:ship.status==='delivered'?'var(--green)':'var(--amber,#d97706)'}}>
                            {ship.status==='delivered'?'✅ Delivered':'🚚 In Transit'}
                          </span>
                          {ship.delivered_at&&<span style={{color:'var(--text3)',marginLeft:8,fontSize:11}}>on {ship.delivered_at.slice(0,10)}</span>}
                        </div>
                        {ship.status!=='delivered'&&(
                          <button className="btn btn-xs"
                            style={{background:'var(--green)',color:'#fff',borderColor:'var(--green)',fontWeight:600}}
                            onClick={()=>setConfirming({order, shipment:ship})}>
                            ✅ Mark Delivered
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Line items summary — shown for non-transit orders */}
              {!isInTransit && (
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {allItems.map(li=>{
                  const statusColor = {
                    delivered_hub:  'var(--teal,#0d9488)',
                    ready_to_ship:  'var(--green)',
                    grn_partial:    'var(--amber,#d97706)',
                    grn_rejected:   'var(--red)',
                  }[li.line_status] || 'var(--text3)';
                  const statusLabel = {
                    delivered_hub: '📦 At Hub',
                    ready_to_ship: '✅ Ready',
                    grn_partial:   '⚠ Partial',
                    grn_rejected:  '❌ Rejected',
                  }[li.line_status] || li.line_status;
                  return (
                    <div key={li.id} style={{padding:'4px 10px',borderRadius:'var(--r-sm)',fontSize:11,
                      background:'var(--surface2)',border:`1px solid ${statusColor}33`,fontWeight:600}}>
                      <span style={{color:statusColor}}>{statusLabel}</span>
                      <span style={{marginLeft:5}}>{li.component}</span>
                      <span style={{color:'var(--text3)',marginLeft:4}}>×{li.qty}</span>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <GRNModal order={selected} suppliers={suppliers}
          onClose={()=>setSelected(null)}
          onSaved={()=>{ setSelected(null); qc.invalidateQueries(['orders']); }}/>
      )}

      {/* P3: Escalation modal */}
      {escalating && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setEscalating(null)}>
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
        <CreateShipmentModal order={dispatch} customers={customers} shippers={shippers}
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
