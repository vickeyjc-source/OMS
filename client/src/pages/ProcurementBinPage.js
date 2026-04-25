// client/src/pages/ProcurementBinPage.js  v3
// Full P2P: Sourcing context · Allocation matrix · Payment terms · Finance queue · PO mode toggle
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge, isDelayed, DaysBadge } from '../utils/helpers';
import { printDoc, generateSupplierPOPDF } from '../utils/pdfUtils';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';

const PO_STATUS = {
  draft:                { label:'Draft',                 color:'var(--text3)',          bg:'var(--surface2)',          icon:'📝', step:0 },
  pending_payment:      { label:'Pending Payment',       color:'var(--red)',             bg:'var(--red-lt,#fef2f2)',    icon:'🔒', step:1 },
  po_issued:            { label:'PO Issued',             color:'var(--accent)',          bg:'var(--accent-lt)',         icon:'📤', step:2 },
  awaiting_confirmation:{ label:'Awaiting Confirmation', color:'var(--amber,#d97706)',  bg:'var(--amber-lt,#fffbeb)', icon:'⏳', step:3 },
  confirmed:            { label:'Confirmed',             color:'var(--teal,#0d9488)',   bg:'var(--teal-lt,#f0fdfa)',  icon:'✅', step:4 },
  in_transit:           { label:'In Transit',            color:'var(--blue,#2563eb)',   bg:'var(--blue-lt,#eff6ff)',  icon:'🚚', step:5 },
  partially_received:   { label:'Partially Received',    color:'var(--amber,#d97706)',  bg:'var(--amber-lt,#fffbeb)', icon:'⚠', step:6 },
  received:             { label:'Received',              color:'var(--green)',           bg:'var(--green-lt)',          icon:'📦', step:6 },
  cancelled:            { label:'Cancelled',             color:'var(--red)',             bg:'var(--red-lt,#fef2f2)',    icon:'❌', step:-1 },
  // Legacy aliases
  sent:                 { label:'PO Issued',             color:'var(--accent)',          bg:'var(--accent-lt)',         icon:'📤', step:2 },
  partial:              { label:'Partially Received',    color:'var(--amber,#d97706)',  bg:'var(--amber-lt,#fffbeb)', icon:'⚠', step:6 },
};

// Progress steps for the tracker
const PO_STEPS_NET      = ['draft','po_issued','awaiting_confirmation','confirmed','in_transit','received'];
const PO_STEPS_ADVANCE  = ['draft','pending_payment','po_issued','awaiting_confirmation','confirmed','in_transit','received'];
const PO_STEP_LABELS    = {
  draft:'Draft', pending_payment:'Pending Payment', po_issued:'PO Issued',
  awaiting_confirmation:'Awaiting Confirm', confirmed:'Confirmed',
  in_transit:'In Transit', received:'Received'
};
const PAYMENT_TERM_OPTIONS = [
  { v:'net',     l:'Net (pay later)' },
  { v:'advance', l:'Advance (pay before shipping)' },
  { v:'split',   l:'Split (% advance + % on delivery)' },
];
const NET_DAYS_OPTIONS = [7,10,14,15,21,30,45,60,90];

function POStatusBadge({ status }) {
  const s = PO_STATUS[status] || { label:status||'—', color:'var(--text3)', bg:'var(--surface2)', icon:'•' };
  return <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
    color:s.color,background:s.bg,border:`1px solid ${s.color}33`}}>{s.icon} {s.label}</span>;
}
function POProgressTracker({ status, paymentTermsType }) {
  const isAdvance = paymentTermsType==='advance'||paymentTermsType==='split';
  const steps     = isAdvance ? PO_STEPS_ADVANCE : PO_STEPS_NET;
  const cfg       = PO_STATUS[status] || PO_STATUS.draft;
  const curStep   = cfg.step ?? 0;
  const cancelled = status === 'cancelled';

  if (cancelled) return (
    <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--red)',fontWeight:600}}>
      ❌ Cancelled
    </div>
  );

  return (
    <div style={{display:'flex',alignItems:'center',gap:0,marginTop:8}}>
      {steps.map((s,i) => {
        const sCfg    = PO_STATUS[s]||PO_STATUS.draft;
        const isDone  = sCfg.step < curStep;
        const isCur   = s===status || (s==='po_issued'&&status==='sent') || (s==='received'&&status==='partially_received');
        const label   = PO_STEP_LABELS[s]||s;
        return (
          <React.Fragment key={s}>
            {i>0&&<div style={{flex:1,height:2,background:isDone?'var(--green)':'var(--border)',minWidth:12}}/>}
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{
                width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',
                justifyContent:'center',fontSize:10,fontWeight:700,
                background:isCur?sCfg.color:isDone?'var(--green)':'var(--border)',
                color:isCur||isDone?'#fff':'var(--text3)',
                border:`2px solid ${isCur?sCfg.color:isDone?'var(--green)':'var(--border)'}`,
                boxShadow:isCur?`0 0 0 3px ${sCfg.color}33`:undefined
              }}>
                {isDone?'✓':isCur?sCfg.icon.replace(/[^-]/g,'●'):''}
              </div>
              <div style={{fontSize:9,color:isCur?sCfg.color:isDone?'var(--green)':'var(--text3)',
                fontWeight:isCur?700:400,textAlign:'center',whiteSpace:'pre',lineHeight:1.2}}>
                {label}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function fmtM(n,c='INR'){
  const s={INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£',AED:'AED '};
  const v=parseFloat(n);
  if (!Number.isFinite(v)) return (s[c]||c+' ') + '0';

  // Keep precision up to 4 decimals but strip trailing zeros (e.g. 90.0000 -> 90)
  const normalized = v.toFixed(4).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
  const [ip, dp] = normalized.split('.');
  const intFmt = Number(ip).toLocaleString('en-IN');
  return (s[c]||c+' ') + (dp ? `${intFmt}.${dp}` : intFmt);
}

function getSourcedSupplierId(lineItem, enquiry) {
  const enqItems = enquiry?.items || [];
  const enqSourcing = enquiry?.sourcing || [];
  const enqItem = enqItems.find(i => i.id === lineItem.id || i.component === lineItem.component);
  const srcRow = enqSourcing.find(s => s.enquiry_item_id === lineItem.id)
    || (enqItem ? enqSourcing.find(s => s.enquiry_item_id === enqItem.id) : null);
  return srcRow?.supplier_id || lineItem.supplier_id || '';
}

function getInventoryLabel(inv) {
  if (!inv) return 'Inventory Stock';
  const icon = inv.holder_type === 'customer' ? '👤' : inv.holder_type === 'supplier' ? '🏢' : '📦';
  return icon + ' ' + (inv.holder_display || inv.holder_name || inv.component || 'Inventory Stock');
}

function buildInventoryMap(inventoryItems) {
  const map = {};
  (inventoryItems || []).forEach(inv => {
    if ((inv.quantity_available || 0) <= 0) return;
    const comp = (inv.component || '').toLowerCase().trim();
    const mfr = (inv.manufacturer || '').toLowerCase().trim();
    if (!comp) return;
    if (mfr) {
      const keyed = comp + '|' + mfr;
      if (!map[keyed]) map[keyed] = [];
      map[keyed].push(inv);
    }
    const fallback = comp + '|';
    if (!map[fallback]) map[fallback] = [];
    map[fallback].push(inv);
  });
  return map;
}

function getInventoryHitsForLineItem(lineItem, inventoryMap) {
  const comp = (lineItem.component || '').toLowerCase().trim();
  const mfr = (lineItem.manufacturer || '').toLowerCase().trim();
  if (!comp) return [];
  return mfr ? (inventoryMap[comp + '|' + mfr] || []) : (inventoryMap[comp + '|'] || []);
}
const inputStyle = {
  fontSize:11,
  height:28,
  padding:'4px 6px'
};
// ── Allocation Matrix Modal ───────────────────────────────────────────────────
function AllocationModal({ order, suppliers, inventoryItems, customers=[], enquiry, poMode, onClose, onSaved, readOnly=false }) {
  const qc = useQueryClient();
  const [poRequests, setPoRequests] = React.useState({}); // lineItemId → 'idle'|'sending'|'sent'
  const allocRef = React.useRef({});
  // Fulfilled PO requests for this order — fetched on mount so defaultAlloc can pre-fill
  const [fulfilledPOReqs, setFulfilledPOReqs] = React.useState([]);

  React.useEffect(() => {
    api.get('/po-requests').then(resp => {
      const rows = resp.data || [];
      const forOrder = rows.filter(r => r.order_id === order.id);
      // Pre-fill fulfilled PI values
      setFulfilledPOReqs(forOrder.filter(r => r.status === 'fulfilled'));
      // Restore "waiting" state for requests that were already sent but not yet fulfilled
      const pending = forOrder.filter(r => r.status === 'pending');
      if (pending.length) {
        // We need alloc to map supplier_id → itemId — defer until alloc initialises
        setTimeout(() => {
          setAlloc(prev => {
            setPoRequests(prq => {
              const next = { ...prq };
              Object.entries(prev).forEach(([itemId, a]) => {
                if (!a.supplier_id) return;
                const hasPending = pending.some(r => r.supplier_id === a.supplier_id);
                if (hasPending && !a.supplier_ref) next[itemId] = 'sent';
              });
              return next;
            });
            return prev; // alloc unchanged
          });
        }, 500);
      }
    }).catch(()=>{});
  }, [order.id]);

  // Poll for PO requests: auto-fill alloc when Finance fulfills (only for THIS session's sent requests)
  React.useEffect(() => {
    const tick = async () => {
      try {
        const resp = await api.get('/po-requests');
        const rows = resp.data || [];
        const forOrder = rows.filter(r => r.order_id === order.id);

        // Only auto-fill alloc from fulfilled requests — do NOT touch button state from old DB records
        const fulfilled = forOrder.filter(r => r.status === 'fulfilled');
        setFulfilledPOReqs(fulfilled);
        if (fulfilled.length) {
          setAlloc(prev => {
            let changed = false;
            const next = { ...prev };
            Object.entries(next).forEach(([itemId, a]) => {
              const fr = fulfilled.find(r => r.supplier_id === a.supplier_id);
              if (fr && fr.supplier_ref && a.supplier_ref !== fr.supplier_ref) {
                next[itemId] = { ...a, supplier_ref: fr.supplier_ref, zoho_po_number: fr.zoho_po_number || a.zoho_po_number };
                // Clear the awaiting state — data is now here, button will hide
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          // Clear awaiting state for items whose supplier_ref is now filled
          setPoRequests(prev => {
            const next = { ...prev };
            let changed = false;
            Object.entries(allocRef.current).forEach(([itemId, a]) => {
              if (a.supplier_ref && next[itemId] === 'sent') {
                delete next[itemId];
                changed = true;
              }
            });
            return changed ? next : prev;
          });
        }
      } catch(_) {}
    };
    const t = setInterval(tick, 5000);
    // Delay first tick — don't run on open (defaultAlloc not yet synced)
    const init = setTimeout(tick, 3000);
    return () => { clearInterval(t); clearTimeout(init); };
  }, [order.id]);
  // alloc[item_id] = { supplier_id, zoho_po_number, confirmed_price, confirmed_currency,
  //                    promised_delivery_date, payment_terms_type, payment_net_days,
  //                    payment_advance_pct, supplier_ref, notes }
  // Helper: get live payment terms from supplier or customer record (always fresh)
  const getSupplierTerms = (supplierId) => {
    if (supplierId?.startsWith('__inv__')) {
      const inv = (inventoryItems||[]).find(i=>i.id===supplierId.slice(7));
      if (inv?.holder_type === 'customer') {
        const cust = (customers||[]).find(c=>c.id===inv.holder_id);
        if (cust) return {
          payment_terms_type:  cust.payment_terms_type  || 'net',
          payment_net_days:    cust.payment_net_days     || 30,
          payment_advance_pct: cust.payment_advance_pct  || 0,
        };
      }
      if (inv?.holder_type === 'supplier') {
        const sup = suppliers.find(s=>s.id===inv.holder_id);
        if (sup) return {
          payment_terms_type:  sup.payment_terms_type  || 'net',
          payment_net_days:    sup.payment_net_days     || 30,
          payment_advance_pct: sup.payment_advance_pct  || 0,
        };
      }
      return { payment_terms_type:'net', payment_net_days:30, payment_advance_pct:0 };
    }
    const sup = suppliers.find(s=>s.id===supplierId);
    if (!sup) return { payment_terms_type:'net', payment_net_days:30, payment_advance_pct:0 };
    return {
      payment_terms_type:  sup.payment_terms_type  || 'net',
      payment_net_days:    sup.payment_net_days     || 30,
      payment_advance_pct: sup.payment_advance_pct  || 0,
    };
  };

  // Build default alloc — recomputes whenever suppliers list changes (live terms)
  const defaultAlloc = useMemo(() => {
    const a = {};
    (order.lineItems||[]).forEach(li => {
      const existing = (order.supplierOrders||[]).find(so=>(so.items||[]).includes(li.id));
      const enqItem  = (enquiry?.items||[]).find(i=>i.id===li.id || i.component===li.component);
      const srcRow   = (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===li.id)
                    || (enqItem ? (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===enqItem.id) : null);
      const resolvedSupplierId = existing?.supplier_id || srcRow?.supplier_id || '';
      const systemPoRef = order?.finance_po_no || order?.po_number || '';
      // ALWAYS read payment terms from live supplier record
      const liveSup   = suppliers.find(s=>s.id===resolvedSupplierId);
      const liveTerms = {
        payment_terms_type:  liveSup?.payment_terms_type  || 'net',
        payment_net_days:    liveSup?.payment_net_days     || 30,
        payment_advance_pct: liveSup?.payment_advance_pct  || 0,
      };
      // Auto-fill from latest fulfilled PO request for this supplier
      const prevFulfilled = fulfilledPOReqs
        .filter(fr => fr.supplier_id === resolvedSupplierId)
        .sort((a,b) => new Date(b.fulfilled_at||0) - new Date(a.fulfilled_at||0))[0];
      a[li.id] = {
        supplier_id:            resolvedSupplierId,
        zoho_po_number:         existing?.zoho_po_number || prevFulfilled?.zoho_po_number || '',
        buying_price_per_unit:  existing?.buying_price_per_unit || srcRow?.sourced_price || '',
        confirmed_price:        existing?.confirmed_price ||
                                  (srcRow?.sourced_price && li.qty
                                    ? (parseFloat(srcRow.sourced_price)*li.qty).toFixed(2)
                                    : ''),
        confirmed_currency:     existing?.confirmed_currency || srcRow?.sourced_currency || 'INR',
        promised_delivery_date: existing?.promised_delivery_date || '',
        ...liveTerms,
        supplier_ref:           existing?.supplier_ref || prevFulfilled?.supplier_ref || '',
        notes:                  existing?.notes || '',
        _orig_payment_terms_type: liveTerms.payment_terms_type,
        _sourced_price:         srcRow?.sourced_price,
        _sourced_currency:      srcRow?.sourced_currency,
        _sourced_supplier_id:   srcRow?.supplier_id,
        _existing_po_id:        existing?.id,
      };
    });
    return a;
  }, [suppliers, order, enquiry, fulfilledPOReqs]);

  const [alloc, setAlloc] = useState({});

  // Keep allocRef in sync so the polling effect can read current alloc without stale closure
  React.useEffect(() => { allocRef.current = alloc; }, [alloc]);

  // Sync alloc when defaultAlloc updates (i.e. when suppliers loads/changes)
  // Only update items the user hasn't manually changed
  React.useEffect(() => {
    setAlloc(prev => {
      const merged = { ...defaultAlloc };
      // Preserve any manual overrides the user has made this session
      Object.keys(prev).forEach(itemId => {
        if (prev[itemId]._userEdited) {
          merged[itemId] = prev[itemId];
        }
      });
      return merged;
    });
  }, [defaultAlloc]);
  const [saving, setSaving] = useState(false);
  const inventoryMap = useMemo(() => buildInventoryMap(inventoryItems), [inventoryItems]);
  const inventoryById = useMemo(() => {
    const map = {};
    (inventoryItems || []).forEach(inv => { map[inv.id] = inv; });
    return map;
  }, [inventoryItems]);
  const supName = id => {
    if (!id) return '—';
    if (id.startsWith('__inv__')) return getInventoryLabel(inventoryById[id.slice(7)]);
    return suppliers.find(s=>s.id===id)?.name || id;
  };

  const setA = (itemId, k, v) => setAlloc(a=>({...a,[itemId]:{...a[itemId],[k]:v,_userEdited:true}}));

  // Group items by supplier for preview
  const grouped = useMemo(() => {
    const g = {};
    Object.entries(alloc).forEach(([itemId, row]) => {
      if (!row.supplier_id) return;
      if (!g[row.supplier_id]) g[row.supplier_id] = [];
      g[row.supplier_id].push(itemId);
    });
    return g;
  }, [alloc]);

  const handleSave = async () => {
    if (readOnly) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      // Group by supplier and create/update one PO per supplier
      const bySupplier = {};
      Object.entries(alloc).forEach(([itemId, row]) => {
        if (!row.supplier_id) return;
        if (!bySupplier[row.supplier_id]) bySupplier[row.supplier_id] = { ...row, item_ids: [] };
        bySupplier[row.supplier_id].item_ids.push(itemId);
      });
      // ADDED: collect responses to check if any PO is advance-blocked
      let anyBlocked = false;
      for (const [supplierId, data] of Object.entries(bySupplier)) {
        const poNotes = data.payment_terms_change_reason
          ? `[Payment terms changed: ${data.payment_terms_change_reason}]${data.notes ? '\n' + data.notes : ''}`
          : data.notes || '';
        const r = await api.post('/orders/'+order.id+'/po', { ...data, supplier_id: supplierId, notes: poNotes });
        if (r.data?.payment_blocked === 1) anyBlocked = true;
      }
      qc.invalidateQueries(['orders']);
      onSaved();
      if (anyBlocked) {
        // ADDED: supplier advance terms → navigate to Finance (same pattern as customer advance in OrdersPage)
        toast.success('✅ PO raised — Advance payment required. Sending to Finance...');
        setTimeout(() => { window.location.href = '/finance?tab=sup-advance'; }, 1500);
      } else {
        toast.success(`✅ ${Object.keys(bySupplier).length} PO(s) raised!`);
      }
    } catch(e) { toast.error(e.response?.data?.error||'Failed'); }
    finally { setSaving(false); }
  };

  const items = order.lineItems||[];

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div><h2>{readOnly ? '👁 PO Allocation (View) — ' : '📋 PO Allocation — '}{order.id}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              Assign each component to a supplier. One PO will be raised per supplier automatically.
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <fieldset disabled={readOnly} style={{border:'none',margin:0,padding:0,minWidth:0}}>
        <div className="modal-body">
          {/* Preview of PO split */}
          {Object.keys(grouped).length > 0 && (
            <div style={{marginBottom:14,padding:'10px 14px',background:'var(--accent-lt)',
              borderRadius:'var(--r-sm)',fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:6,color:'var(--accent)'}}>📊 PO Split Preview</div>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                {Object.entries(grouped).map(([supId,ids])=>(
                  <div key={supId} style={{padding:'4px 10px',borderRadius:'var(--r-sm)',
                    background:'#fff',border:'1px solid var(--accent)33',fontWeight:600}}>
                    {supName(supId)}: {ids.length} item{ids.length!==1?'s':''}
                  </div>
                ))}
                {(order.lineItems||[]).filter(li=>!alloc[li.id]?.supplier_id).length > 0 && (
                  <div style={{padding:'4px 10px',borderRadius:'var(--r-sm)',
                    background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)33',
                    fontWeight:600,color:'var(--amber,#d97706)'}}>
                    ⚠ {(order.lineItems||[]).filter(li=>!alloc[li.id]?.supplier_id).length} unassigned
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Allocation table */}
          <div style={{overflowX:'auto'}}>
            {/* FIX 1: Removed orphaned thead — added missing <table> wrapper */}
            <table className="li-table">
              <thead>
                <tr>
                  <th>#</th><th>Component</th><th>Qty</th>
                  <th>Cust. Price</th>
                  <th style={{color:'var(--text2)'}}>Target Price</th>
                  {/* FIX 2: Added Tax headers to match Tax cells in tbody */}
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax %</th>
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax Amt</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>★ Sourced From</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>Sourced Price</th>
                  <th>Assign Supplier <span style={{color:'var(--red)'}}>*</span></th>
                  <th>Supplier PI / Zoho PO</th>
                  <th>Payment Terms</th>
                  <th>Promised Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((li,i)=>{
                  const a = alloc[li.id]||{};
                  const srcSupplier = a._sourced_supplier_id;
                  const stockHits = getInventoryHitsForLineItem(li, inventoryMap);
                  const custTotal = (li.qty||0)*(li.unit_price||0);
                  const cost = parseFloat(a.confirmed_price)||0;
                  const margin = custTotal - cost;
                  return (
                    <tr key={li.id} style={{background:a.supplier_id?'transparent':'var(--amber-lt,#fffbeb)'}}>
                      <td style={{color:'var(--text3)',fontSize:11}}>{i+1}</td>
                      <td>
                        <div style={{fontWeight:600}}>{li.component}</div>
                        <div style={{fontSize:11,color:'var(--text3)'}}>{li.manufacturer||''}</div>
                      </td>
                      <td style={{textAlign:'right',fontWeight:600}}>{li.qty}</td>
                      <td className="mono" style={{textAlign:'right'}}>
  {fmtCur(li.unit_price,li.currency)}
</td>
                      {/* Target price */}
                      <td style={{fontSize:11}}>
                        {li.target_price
                          ? <span style={{fontWeight:600,color:(a._sourced_price&&parseFloat(a._sourced_price)>parseFloat(li.target_price))?'var(--red)':'var(--text2)'}}>
                              {fmtM(li.target_price, li.target_currency||li.currency||'INR')}
                            </span>
                          : <span style={{color:'var(--text3)'}}>—</span>
                        }
                      </td>
                      {/* FIX 3: Fixed indentation — content unchanged */}
                      <td style={{textAlign:'right',fontSize:12}}>
                        {Number(li.tax_rate)||0}%
                      </td>
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace'}}>
                        {Number(li.tax_rate)>0
                          ? fmtCur((li.qty||0)*(li.unit_price||0)*((li.tax_rate||0)/100), li.currency)
                          : <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                      {/* Sourcing context */}
                      <td>
                        {srcSupplier
                          ? <div>
                              <div style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700}}>
                                ★ {supName(srcSupplier)}
                              </div>
                              <div style={{fontSize:10,color:'var(--text3)'}}>Originally sourced</div>
                            </div>
                          : <span style={{color:'var(--text3)',fontSize:11}}>—</span>
                        }
                      </td>
                      <td style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700}}>
                        {a._sourced_price ? fmtM(a._sourced_price,a._sourced_currency||'INR') : <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                      {/* Supplier select */}
                      <td style={{minWidth:160}}>
                        <select className="input" value={a.supplier_id||''}
                          onChange={e=>{
                            const newSupId = e.target.value;
                            setAlloc(prev => {
                              const liveTerms = newSupId.startsWith('__inv__')
                                ? { payment_terms_type:'net', payment_net_days:30, payment_advance_pct:0 }
                                : getSupplierTerms(newSupId);
                              return { ...prev, [li.id]: { ...prev[li.id],
                                supplier_id: newSupId, ...liveTerms, _userEdited: true }};
                            });
                          }}
                          style={{fontSize:11,borderColor:!a.supplier_id?'var(--amber,#d97706)':undefined}}>
                          <option value="">— Select —</option>
                          {stockHits.length > 0 && (
                            <optgroup label="Available In Stock">
                              {stockHits.map(inv => (
                                <option key={'__inv__' + inv.id} value={'__inv__' + inv.id}>
                                  {getInventoryLabel(inv)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {stockHits.length > 0 && suppliers.length > 0 && <option disabled>──────────</option>}
                          {suppliers.map(s=>(
                            <option key={s.id} value={s.id}>
                              {s.id===srcSupplier?'★ '+s.name+' (Sourced)':s.name}
                            </option>
                          ))}
                        </select>
                        {srcSupplier && a.supplier_id!==srcSupplier && (
                          <div style={{fontSize:10,color:'var(--amber,#d97706)',marginTop:2}}>
                            ★ Originally sourced from {supName(srcSupplier)}
                          </div>
                        )}
                      </td>
                      {/* Supplier PI / PO request + Buying Price */}
                      <td style={{minWidth:160}}>
                        <div>
                          <input className="input" value={a.supplier_ref||''}
                            onChange={e=>setA(li.id,'supplier_ref',e.target.value)}
                            placeholder="Supplier PI No. *"
                            style={{fontSize:11,borderColor:!a.supplier_ref?'var(--amber,#d97706)':undefined}}/>
                          {!a.supplier_ref&&<div style={{fontSize:10,color:'var(--amber,#d97706)',marginTop:2}}>⚠ Supplier PI required</div>}
                          {a.supplier_id && !a.supplier_ref && (
                            poRequests[li.id]==='sent' ? (
                              <div style={{marginTop:4,fontSize:10,color:'var(--accent)',fontWeight:600,
                                padding:'4px 8px',borderRadius:4,background:'var(--accent-lt)',
                                border:'1px solid var(--accent)33'}}>
                                ⏳ Waiting for Finance…
                              </div>
                            ) : (
                              <button
                                className="btn btn-xs"
                                style={{marginTop:4,fontSize:10,background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}
                                disabled={poRequests[li.id]==='sending'}
                                onClick={async()=>{
                                  setPoRequests(r=>({...r,[li.id]:'sending'}));
                                  try {
                                    const existingPO = (order.supplierOrders||[]).find(so=>so.supplier_id===a.supplier_id);
                                    await api.post('/po-requests', {
                                      order_id: order.id,
                                      supplier_id: a.supplier_id,
                                      supplier_order_id: existingPO?.id || a._existing_po_id || '',
                                      supplier_name: supName(a.supplier_id),
                                      order_ref: order.po_number || order.id,
                                    });
                                    setPoRequests(r=>({...r,[li.id]:'sent'}));
                                    toast.success('📋 Request sent to Finance team!');
                                  } catch(e) {
                                    setPoRequests(r=>({...r,[li.id]:'idle'}));
                                    toast.error('Failed to send request');
                                  }
                                }}>
                                {poRequests[li.id]==='sending' ? '⏳ Sending…' : '📋 Request PO Info from Finance'}
                              </button>
                            )
                          )}
                        </div>
                      </td>
                      {/* Payment terms */}
                      <td style={{minWidth:140}}>
                        <select className="input" value={a.payment_terms_type||'net'}
                          onChange={e=>setA(li.id,'payment_terms_type',e.target.value)}
                          style={{fontSize:11,marginBottom:4}}>
                          {PAYMENT_TERM_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                        {a.payment_terms_type==='net'&&(
                          <select className="input" value={a.payment_net_days||30}
                            onChange={e=>setA(li.id,'payment_net_days',parseInt(e.target.value))}
                            style={{fontSize:11}}>
                            {NET_DAYS_OPTIONS.map(d=><option key={d} value={d}>Net {d}</option>)}
                          </select>
                        )}
                        {a.payment_terms_type==='advance'&&(
                          <div style={{fontSize:10,color:'var(--amber,#d97706)',fontWeight:600,marginTop:2}}>
                            ⚠ Will be blocked — Finance must pay before release
                          </div>
                        )}
                        {a.payment_terms_type==='split'&&(
                          <div style={{display:'flex',alignItems:'center',gap:4,marginTop:4}}>
                            <input className="input" type="number" min="0" max="100"
                              value={a.payment_advance_pct||50}
                              onChange={e=>setA(li.id,'payment_advance_pct',parseInt(e.target.value))}
                              style={{fontSize:11,width:55}}/>
                            <span style={{fontSize:11,color:'var(--text2)'}}>% advance</span>
                          </div>
                        )}
                        {a.payment_terms_type !== a._orig_payment_terms_type && (
                          <div style={{marginTop:4}}>
                            <input className="input" value={a.payment_terms_change_reason||''}
                              onChange={e=>setA(li.id,'payment_terms_change_reason',e.target.value)}
                              placeholder="Reason for change…"
                              style={{fontSize:11,borderLeft:'3px solid var(--amber,#d97706)',paddingLeft:6}}/>
                          </div>
                        )}
                      </td>
                      {/* Date */}
                      <td style={{minWidth:120}}>
                        <input className="input" type="date" value={a.promised_delivery_date||''}
                          onChange={e=>setA(li.id,'promised_delivery_date',e.target.value)}
                          style={{fontSize:11}}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </fieldset>
        <div className="modal-footer" style={{justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:12,color:'var(--text2)'}}>
            {Object.keys(grouped).length > 0
              ? `Will generate ${Object.keys(grouped).length} PO${Object.keys(grouped).length!==1?'s':''} — one per supplier`
              : 'Assign at least one component to a supplier to proceed'
            }
            {(order.lineItems||[]).filter(li=>!alloc[li.id]?.supplier_id).length > 0 && (
              <span style={{color:'var(--amber,#d97706)',marginLeft:8,fontWeight:600}}>
                ⚠ {(order.lineItems||[]).filter(li=>!alloc[li.id]?.supplier_id).length} unassigned
              </span>
            )}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" onClick={onClose}>{readOnly?'Close':'Cancel'}</button>
            {/* Refresh — useful after Finance fills in PI/Zoho PO via PO Requests */}
            <button className="btn btn-sm" title="Refresh data from Finance"
              onClick={()=>qc.invalidateQueries(['orders'])}>
              🔄 Refresh
            </button>
            {/* Removed: Go to Finance before save was misleading — auto-navigates after Save */}
            {!readOnly && <button className="btn btn-primary" disabled={saving||Object.keys(grouped).length===0} onClick={handleSave}>
              {saving?'Saving POs…':`📤 ${Object.keys(grouped).length>0?'Save':'Generate'} PO Allocation`}
            </button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Manage PO Modal ───────────────────────────────────────────────────────────
function ManagePOModal({ po, order, enquiry, suppliers, inventoryItems, shippers, poMode, onClose, onSaved, poList=[], poIndex=0, onNavigate, readOnly=false }) {
  const qc = useQueryClient();
  const systemPoRef = order?.finance_po_no || order?.po_number || '';
  const [form, setForm] = useState({
    status:                 po.status||'draft',
    zoho_po_number:         po.zoho_po_number||'',
    po_no:                  po.po_no||systemPoRef,
    supplier_ref:           po.supplier_ref||'',
    buying_price_per_unit:  po.buying_price_per_unit || (() => {
                              // Auto-populate from sourcing price if not yet saved on PO
                              const firstItemId = (po.items||[])[0];
                              if (!firstItemId) return '';
                              const orderItem = (order.lineItems||[]).find(li=>li.id===firstItemId);
                              const enqItem   = (enquiry?.items||[]).find(i=>i.id===firstItemId || i.component===orderItem?.component);
                              const srcRow    = (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===firstItemId)
                                             || (enqItem ? (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===enqItem.id) : null);
                              return srcRow?.sourced_price || '';
                            })(),
    confirmed_price:        po.confirmed_price||'',
    confirmed_currency:     po.confirmed_currency||'INR',
    promised_delivery_date: po.promised_delivery_date||'',
    payment_terms_type:     po.payment_terms_type||'net',
    payment_net_days:       po.payment_net_days||30,
    payment_advance_pct:    po.payment_advance_pct||0,
    payment_due_date:       po.payment_due_date||'',
    shipping_status:        po.shipping_status||'pending',
    shipper_id:             po.shipper_id||'',
    tracking_no:            po.tracking_no||'',
    ship_load_date:         po.ship_load_date||'',
    notes:                  po.notes||''
  });
  const [saving,    setSaving]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm]     = useState({
    payment_ref:'', payment_date:new Date().toISOString().slice(0,10),
    paid_amount:po.confirmed_price||'', notes:''
  });
  const [submitting, setSubmitting] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(
    // Pre-set confirmed if payment was already recorded (payment_blocked cleared)
    (po.payment_blocked===0||po.payment_blocked===false) && (po.payment_terms_type==='advance'||po.payment_terms_type==='split')
  );
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const inventoryById = React.useMemo(() => {
    const map = {};
    (inventoryItems || []).forEach(inv => { map[inv.id] = inv; });
    return map;
  }, [inventoryItems]);
  const supName=id=>{
    if (!id) return '—';
    if (id.startsWith('__inv__')) return getInventoryLabel(inventoryById[id.slice(7)]);
    return suppliers.find(s=>s.id===id)?.name||id;
  };
  const isAdvanceOrSplit = form.payment_terms_type==='advance'||form.payment_terms_type==='split';
  const poItems=(po.items||[]).map(id=>(order.lineItems||[]).find(li=>li.id===id)).filter(Boolean);
  const custTotal=poItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
  const cost=parseFloat(form.confirmed_price)||0;
  const margin=custTotal-cost;
  const isBlocked=po.payment_blocked===1||po.payment_blocked===true;
  const carrierOptions = (shippers && shippers.length)
    ? shippers
    : [
        { id:'dhl', name:'DHL' },
        { id:'fedex', name:'FedEx' },
        { id:'ups', name:'UPS' },
        { id:'bluedart', name:'Blue Dart' },
        { id:'delhivery', name:'Delhivery' },
      ];

  const setStatusAndSave = async (nextStatus) => {
    const prevStatus = form.status;
    const nextForm = { ...form, status: nextStatus };
    setForm(nextForm);
    setSaving(true);
    try {
      await api.put('/supplier-orders/' + po.id, nextForm);
      toast.success('Status updated: ' + (PO_STATUS[nextStatus]?.label || nextStatus));
      qc.invalidateQueries(['orders']);
      onSaved();
    } catch (e) {
      setForm(f => ({ ...f, status: prevStatus }));
      toast.error(e.response?.data?.error || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const save=async()=>{
    // Validate PI mandatory for advance/split
    if (isAdvanceOrSplit && !form.supplier_ref?.trim()) {
      toast.error('Supplier PI Number is required for advance/split payment terms');
      return;
    }
    setSaving(true);
    try{
      await api.put('/supplier-orders/'+po.id,form);
      toast.success('PO updated');
      qc.invalidateQueries(['orders']);
      onSaved();
    }catch(e){toast.error(e.response?.data?.error||'Failed');}
    finally{setSaving(false);}
  };
  const del=async()=>{
    setConfirmDelete(true);
  };
  const doDelete=async()=>{
    try{await api.delete('/supplier-orders/'+po.id);toast.success('Deleted');qc.invalidateQueries(['orders']);onSaved();}
    catch(e){toast.error('Delete failed');}
  };

  return (
    <>
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div><h2>🛒 {po.internal_po_no||po.id}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{supName(po.supplier_id)} · {order.id}</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {readOnly&&<span style={{fontSize:11,fontWeight:700,color:'var(--accent)',
              background:'var(--accent-lt)',padding:'2px 9px',borderRadius:999,
              border:'1px solid var(--accent)44'}}>👁 View Only</span>}
            {isBlocked&&<span style={{fontSize:11,fontWeight:700,color:'var(--red)',
              background:'var(--red-lt,#fef2f2)',padding:'2px 9px',borderRadius:999,
              border:'1px solid var(--red)44'}}>🔒 Payment Blocked</span>}
            {/* ADDED: Go to Finance button in ManagePO header when blocked */}
            {isBlocked&&(
              <button className="btn btn-sm"
                style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',fontWeight:700}}
                onClick={()=>window.location.href='/finance'}>
                💰 Go to Finance →
              </button>
            )}
            <POStatusBadge status={form.status}/>
            {poList.length>1&&onNavigate&&(
              <div style={{display:'flex',gap:4,alignItems:'center'}}>
                <button className="btn btn-xs" disabled={poIndex===0}
                  onClick={()=>onNavigate(poIndex-1)}
                  title="Previous PO">‹ Prev</button>
                <span style={{fontSize:11,color:'var(--text3)'}}>{poIndex+1}/{poList.length}</span>
                <button className="btn btn-xs" disabled={poIndex===poList.length-1}
                  onClick={()=>onNavigate(poIndex+1)}
                  title="Next PO">Next ›</button>
              </div>
            )}
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body">
          <fieldset disabled={readOnly} style={{border:'none',margin:0,padding:0,minWidth:0}}>
          {(isBlocked||paymentConfirmed)&&(
            <div style={{padding:'12px 14px',borderRadius:'var(--r)',
              background: paymentConfirmed ? 'var(--green-lt)' : 'var(--red-lt,#fef2f2)',
              border: paymentConfirmed ? '2px solid var(--green)' : '2px solid var(--red)',
              marginBottom:14}}>
              {paymentConfirmed ? (
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:13,fontWeight:700,color:'var(--green)'}}>✅ Advance Payment Confirmed</span>
                </div>
              ) : (
              <><div style={{fontSize:12,color:'var(--red)',fontWeight:600,marginBottom:10}}>
                🔒 Advance payment required before supplier can be notified
              </div>
              {/* Bank details */}
              {(()=>{
                const sup=suppliers.find(s=>s.id===po.supplier_id);
                return (sup?.bank_name||sup?.bank_account)?(<div style={{padding:'8px 10px',background:'#fff',
                  borderRadius:'var(--r-sm)',fontSize:12,marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:11,color:'var(--text3)',marginBottom:4}}>🏦 PAY TO:</div>
                  <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                    {sup.bank_name&&<span><strong>{sup.bank_name}</strong></span>}
                    {sup.bank_account&&<span>Acc: <strong>{sup.bank_account}</strong></span>}
                    {sup.bank_ifsc&&<span>IFSC: <strong>{sup.bank_ifsc}</strong></span>}
                    {sup.bank_swift&&<span>SWIFT: <strong>{sup.bank_swift}</strong></span>}
                  </div>
                </div>):<div style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600,marginBottom:10}}>
                  ⚠ No bank details on file — add in Suppliers page.
                </div>;
              })()}
              {!showPayForm?(
                <button className="btn btn-sm" onClick={()=>setShowPayForm(true)}
                  style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',fontWeight:700}}>
                  💳 Record Payment & Release PO
                </button>
              ):(
                <div style={{padding:'12px',background:'#fff',borderRadius:'var(--r-sm)'}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--green)'}}>
                    Record Payment — {fmtM(po.confirmed_price,po.confirmed_currency||'INR')}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Payment Ref / UTR <span className="req">*</span></label>
                      <input className="input" value={payForm.payment_ref}
                        onChange={e=>setPayForm(f=>({...f,payment_ref:e.target.value}))}
                        placeholder="UTR / NEFT / SWIFT ref"/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Payment Date</label>
                      <input className="input" type="date" value={payForm.payment_date}
                        onChange={e=>setPayForm(f=>({...f,payment_date:e.target.value}))}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Amount Paid</label>
                      <input className="input" type="number" value={payForm.paid_amount}
                        onChange={e=>setPayForm(f=>({...f,paid_amount:e.target.value}))}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Note</label>
                      <input className="input" value={payForm.notes}
                        onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))}
                        placeholder="e.g. Paid via HDFC Net Banking"/>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-primary"
                      style={{background:'var(--green)',borderColor:'var(--green)',fontWeight:700}}
                      disabled={submitting}
                      onClick={async()=>{
                        if(!payForm.payment_ref.trim()){toast.error('Payment reference required');return;}
                        setSubmitting(true);
                        try{
                          await api.put('/supplier-orders/'+po.id,{status:'sent',payment_blocked:0});
                          toast.success('✅ Payment recorded — PO released!');
                          setPaymentConfirmed(true);
                          setShowPayForm(false);
                          qc.invalidateQueries(['orders']);
                          onSaved();
                        }catch(e){toast.error('Failed: '+(e.response?.data?.error||e.message));}
                        finally{setSubmitting(false);}
                      }}>
                      {submitting?'Processing…':'✅ Confirm & Release PO'}
                    </button>
                    <button className="btn btn-xs" onClick={()=>setShowPayForm(false)}>Cancel</button>
                  </div>
                </div>
              )}
              </>
            )}
            </div>
          )}
          {poItems.length>0&&(
            <div style={{marginBottom:14,padding:'10px 14px',background:'var(--accent-lt)',borderRadius:'var(--r-sm)',fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:6,color:'var(--accent)'}}>📦 Components</div>
              {poItems.map(li=>(
                <div key={li.id} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:'0.5px solid var(--border)'}}>
                  <span style={{fontWeight:600}}>{li.component}</span>
                  <span style={{color:'var(--text2)'}}>Qty: {li.qty} · {fmtCur(li.unit_price,li.currency)}</span>
                </div>
              ))}
              {cost>0&&custTotal>0&&(
                <div style={{marginTop:6,fontWeight:700,fontSize:11,color:margin>=0?'var(--green)':'var(--red)'}}>
                  Margin: {fmtM(margin,form.confirmed_currency)} ({custTotal>0?(margin/custTotal*100).toFixed(1):0}%)
                </div>
              )}
            </div>
          )}
          {/* PO Status — progress tracker only, action buttons moved to footer */}
          <div className="form-group">
            <label className="label" style={{fontWeight:700}}>PO Status</label>
            <POProgressTracker status={form.status} paymentTermsType={form.payment_terms_type}/>
            {form.status==='confirmed'&&(
              <div style={{fontSize:11,color:'var(--text2)',fontStyle:'italic',marginTop:8}}>
                💡 Enter tracking number below to auto-advance to In Transit
              </div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13}}>
            {/* PO reference fields */}
            {poMode==='external'?(
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">
                  Zoho PO Number <span className="req">*</span>
                  {form.zoho_po_number && <span style={{marginLeft:6,fontSize:10,color:'var(--green)',fontWeight:700}}>✓ Saved</span>}
                </label>
                <input className="input" value={form.zoho_po_number}
                  onChange={e=>set('zoho_po_number',e.target.value)}
                  placeholder="e.g. PO-20001"
                  style={{
                    borderColor: form.zoho_po_number ? 'var(--green)' : 'var(--amber,#d97706)',
                    background:  form.zoho_po_number ? 'var(--green-lt)' : undefined,
                  }}/>
              </div>
            ):(
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Internal PO Ref</label>
                <input className="input" value={po.internal_po_no||po.id} disabled style={{opacity:.6}}/>
              </div>
            )}
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">
                {isAdvanceOrSplit ? <>Supplier PI Number <span className="req">*</span></> : 'Supplier Quotation Ref'}
                {form.supplier_ref && <span style={{marginLeft:6,fontSize:10,color:'var(--green)',fontWeight:700}}>✓ Saved</span>}
              </label>
              <input className="input" value={form.supplier_ref}
                onChange={e=>set('supplier_ref',e.target.value)}
                placeholder={isAdvanceOrSplit ? 'Enter PI number from supplier' : 'Quotation ref'}
                style={{
                  borderColor: isAdvanceOrSplit && !form.supplier_ref ? 'var(--amber,#d97706)' : form.supplier_ref ? 'var(--green)' : undefined,
                  background:  form.supplier_ref ? 'var(--green-lt)' : undefined,
                }}/>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Buying Price Per Unit</label>
              <div style={{display:'flex',gap:6}}>
                <input className="input" type="number" step="0.01"
                  value={form.buying_price_per_unit !== '' && form.buying_price_per_unit != null ? parseFloat(form.buying_price_per_unit)||'' : ''}
                  disabled
                  onChange={e=>{
                    const bpu = parseFloat(e.target.value)||0;
                    const totalQty = poItems.reduce((s,li)=>s+(li.qty||0),0);
                    const total = bpu * totalQty;
                    set('buying_price_per_unit', e.target.value);
                    set('confirmed_price', total>0?total.toFixed(2):'');
                  }}
                  placeholder="0.00 per unit" style={{flex:1,background:'var(--surface2)',color:'var(--text2)'}}/>
                <select className="input" style={{width:80}} value={form.confirmed_currency}
                  disabled
                  onChange={e=>set('confirmed_currency',e.target.value)}>
                  {['INR','USD','EUR','SGD','GBP','AED'].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              {/* Show auto-calculated total */}
              {(form.buying_price_per_unit>0||form.confirmed_price>0)&&(()=>{
                const bpu = parseFloat(form.buying_price_per_unit)||0;
                const totalQty = poItems.reduce((s,li)=>s+(li.qty||0),0);
                const total = bpu>0 ? bpu*totalQty : parseFloat(form.confirmed_price)||0;
                const perUnit = bpu>0 ? bpu : (totalQty>0?total/totalQty:0);
                return (
                  <div style={{marginTop:4,fontSize:11,color:'var(--text2)'}}>
                    Total PO Cost: <strong>{fmtM(total,form.confirmed_currency)}</strong>
                    {totalQty>0&&perUnit>0&&<> ({totalQty} units × {fmtM(perUnit,form.confirmed_currency)}/unit)</>}
                  </div>
                );
              })()}
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Promised Delivery Date</label>
              <input className="input" type="date" value={form.promised_delivery_date} onChange={e=>set('promised_delivery_date',e.target.value)}/>
            </div>
            {/* Payment Terms — show live supplier default for reference */}
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label" style={{fontWeight:700}}>Payment Terms</label>
              {(() => {
                const liveSup = suppliers.find(s=>s.id===po.supplier_id);
                const liveType = liveSup?.payment_terms_type || 'net';
                const liveChanged = liveType !== (po.payment_terms_type||'net');
                return liveChanged ? (
                  <div style={{marginBottom:6,padding:'5px 10px',borderRadius:'var(--r-sm)',
                    background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)44',
                    fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>
                    ⚠ Supplier default has changed to <strong>{liveType==='advance'?'Advance':liveType==='split'?'Split':'Net '+liveSup?.payment_net_days}</strong>.
                  </div>
                ) : null;
              })()}
              <select className="input" value={form.payment_terms_type} disabled onChange={e=>set('payment_terms_type',e.target.value)} style={{background:'var(--surface2)',color:'var(--text2)'}}>
                {PAYMENT_TERM_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              {form.payment_terms_type==='net'&&(
                <select className="input" style={{marginTop:4,background:'var(--surface2)',color:'var(--text2)'}} value={form.payment_net_days} disabled
                  onChange={e=>set('payment_net_days',parseInt(e.target.value))}>
                  {NET_DAYS_OPTIONS.map(d=><option key={d} value={d}>Net {d} days</option>)}
                </select>
              )}
              {form.payment_terms_type==='split'&&(
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                  <input className="input" type="number" min="0" max="100" value={form.payment_advance_pct} disabled
                    onChange={e=>set('payment_advance_pct',parseInt(e.target.value))} style={{width:70}}/>
                  <span style={{fontSize:12,color:'var(--text2)'}}>% advance, rest on delivery</span>
                </div>
              )}
            </div>
            {form.payment_due_date&&(
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Payment Due Date</label>
                <input className="input" type="date" value={form.payment_due_date} onChange={e=>set('payment_due_date',e.target.value)}/>
              </div>
            )}
          </div>
          {/* Shipping — only show after supplier confirmed */}
          {['confirmed','in_transit','partial','received'].includes(form.status)&&(
            <div style={{marginTop:13,padding:'12px 14px',background:'var(--surface2)',borderRadius:'var(--r-sm)'}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:10,color:'var(--text2)'}}>🚚 Shipping</div>
              {(!shippers || shippers.length===0) && (
                <div style={{fontSize:11,color:'var(--amber,#d97706)',marginBottom:8,fontWeight:600}}>
                  ⚠ No active shippers configured. Showing common carrier list fallback.
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div className="form-group" style={{marginBottom:0}}><label className="label">Shipping Status</label>
                  <select className="input" value={form.shipping_status} onChange={e=>set('shipping_status',e.target.value)}>
                    {['pending','in-transit','partially-received','received','failed'].map(s=><option key={s}>{s}</option>)}
                  </select></div>
                <div className="form-group" style={{marginBottom:0}}><label className="label">Carrier</label>
                  <select className="input" value={form.shipper_id} onChange={e=>set('shipper_id',e.target.value)}>
                    <option value="">— Select —</option>
                    {carrierOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Ship Load Date <span style={{fontSize:10,color:'var(--text3)',fontWeight:400}}>(date supplier dispatched)</span></label>
                  <input className="input" type="date" value={form.ship_load_date}
                    onChange={e=>set('ship_load_date',e.target.value)}/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr',gap:10,marginTop:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Tracking / AWB</label>
                  <input className="input" value={form.tracking_no}
                    onChange={e=>{
                      set('tracking_no',e.target.value);
                      // Auto-advance to in_transit when AWB entered on a confirmed PO
                      if (e.target.value.trim() && form.status==='confirmed') {
                        set('status','in_transit');
                      }
                    }}
                    placeholder="AWB / Tracking number"
                    style={{borderColor: form.tracking_no?'var(--green)':undefined}}/>
                </div>
              </div>
            </div>
          )}
          {/* Next step guidance after AWB is entered */}
          {form.tracking_no && form.shipper_id && (
            <div style={{marginTop:10,padding:'10px 14px',borderRadius:'var(--r)',
              background:'var(--accent-lt)',border:'2px solid var(--accent)',fontSize:12}}>
              <div style={{fontWeight:700,color:'var(--accent)',marginBottom:4}}>
                🚚 Shipping details captured — what's next?
              </div>
              <ol style={{margin:'0 0 0 16px',padding:0,color:'var(--text2)',lineHeight:1.8}}>
                <li><strong>Save PO</strong> below — order will move to <strong>Transit – Hub</strong> status</li>
                <li>Go to <a href="/delivery-hub" style={{color:'var(--accent)',fontWeight:600}}>Delivery Hub →</a> to record GRN when goods arrive</li>
              </ol>
            </div>
          )}

          <div className="form-group" style={{marginTop:13,marginBottom:0}}><label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)}/></div>
          </fieldset>
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          {!readOnly ? <button className="btn btn-danger" onClick={del} style={{fontSize:12}}>🗑 Delete</button> : <span/>}
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn" onClick={onClose}>Cancel</button>

            {/* Status action buttons — one at a time based on current status */}
            {!readOnly && form.status==='draft' && (
              <button type="button" className="btn btn-primary" disabled={saving}
                style={{fontSize:12,
                  background: isAdvanceOrSplit && form.supplier_ref?.trim() ? 'var(--green)' : undefined,
                  borderColor: isAdvanceOrSplit && form.supplier_ref?.trim() ? 'var(--green)' : undefined,
                  fontWeight:700}}
                onClick={()=>setStatusAndSave('po_issued')}>
                {isAdvanceOrSplit && form.supplier_ref?.trim() ? '✅ PI Received — Mark PO Issued →' : '📤 Mark as PO Issued'}
              </button>
            )}
            {!readOnly && (form.status==='po_issued'||form.status==='sent') && (
              <button type="button" className="btn btn-primary" disabled={saving}
                style={{fontSize:12}}
                onClick={()=>setStatusAndSave('awaiting_confirmation')}>
                ⏳ Awaiting Supplier Confirmation
              </button>
            )}
            {!readOnly && form.status==='awaiting_confirmation' && (
              <button type="button" className="btn btn-primary" disabled={saving}
                style={{background:'var(--teal,#0d9488)',borderColor:'var(--teal,#0d9488)',fontSize:12}}
                onClick={()=>setStatusAndSave('confirmed')}>
                ✅ Supplier Confirmed
              </button>
            )}
            {/* Send to Delivery Hub — only when confirmed + shipping details filled, not after already sent */}
            {!readOnly && po.status==='confirmed' && form.tracking_no?.trim() && form.shipper_id?.trim() && (
              <button type="button" className="btn" disabled={saving}
                style={{background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700,fontSize:12}}
                onClick={async()=>{
                  setSaving(true); // disables button immediately
                  try {
                    await api.put('/supplier-orders/'+po.id,{...form,status:'in_transit'});
                    qc.invalidateQueries(['orders']);
                    toast.success('📦 PO sent to Delivery Hub!');
                    onSaved();
                    window.location.href='/delivery-hub?order='+encodeURIComponent(order.id)+'&po='+encodeURIComponent(po.id);
                  } catch(e){ toast.error(e.response?.data?.error||'Failed'); setSaving(false); }
                }}>
                📦 Send to Delivery Hub →
              </button>
            )}
            {/* Already in transit — just show a label, no button */}
            {po.status==='in_transit' && (
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',
                background:'var(--blue-lt,#eff6ff)',color:'var(--blue,#2563eb)',
                fontWeight:700,border:'1px solid var(--blue,#2563eb)44'}}>
                🚚 In Transit — awaiting GRN at Delivery Hub
              </span>
            )}
            {/* Partially received — show status + allow re-sending balance to hub */}
            {form.status==='partially_received' && (
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',
                background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',
                fontWeight:700,border:'1px solid var(--amber,#d97706)44'}}>
                ⚠ Partially Received — balance still at supplier
              </span>
            )}
            {!readOnly && form.status==='partially_received' && form.tracking_no?.trim() && form.shipper_id?.trim() && (
              <button type="button" className="btn" disabled={saving}
                style={{background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700,fontSize:12}}
                onClick={async()=>{
                  setSaving(true);
                  try {
                    await api.put('/supplier-orders/'+po.id,{...form,status:'in_transit'});
                    qc.invalidateQueries(['orders']);
                    toast.success('📦 Balance shipment sent to Delivery Hub!');
                    onSaved();
                    window.location.href='/delivery-hub?order='+encodeURIComponent(order.id)+'&po='+encodeURIComponent(po.id);
                  } catch(e){ toast.error(e.response?.data?.error||'Failed'); setSaving(false); }
                }}>
                📦 Send Balance to Delivery Hub →
              </button>
            )}
            {/* Fully received */}
            {form.status==='received' && (
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',
                background:'var(--green-lt)',color:'var(--green)',
                fontWeight:700,border:'1px solid var(--green)44'}}>
                ✅ Fully Received at Delivery Hub
              </span>
            )}
            {/* Cancel PO — secondary danger action */}
            {!readOnly && ['po_issued','sent','awaiting_confirmation','pending_payment'].includes(form.status) && (
              <button type="button" className="btn" disabled={saving}
                style={{fontSize:12,color:'var(--red)',borderColor:'var(--red)'}}
                onClick={()=>setStatusAndSave('cancelled')}>
                ❌ Cancel PO
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    {confirmDelete && (
      <ConfirmDeleteModal
        label={po.internal_po_no || po.id}
        onConfirm={() => { setConfirmDelete(false); doDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    )}
    </>
  );
}


// ── Order Procurement Detail Modal ────────────────────────────────────────────
function OrderProcurementModal({ order, suppliers, inventoryItems, customers, shippers, enquiry, poMode, onClose, onSaved, readOnly=false }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showAlloc,  setShowAlloc]  = useState(false);
  const [managingPO, setManagingPO] = useState(null);
  const custName=id=>customers.find(c=>c.id===id)?.name||id;
  const inventoryById = useMemo(() => {
    const map = {};
    (inventoryItems || []).forEach(inv => { map[inv.id] = inv; });
    return map;
  }, [inventoryItems]);
  const supName=id=>{
    if (!id) return '—';
    if (id.startsWith('__inv__')) return getInventoryLabel(inventoryById[id.slice(7)]);
    return suppliers.find(s=>s.id===id)?.name||id;
  };
  const today=new Date().toISOString().slice(0,10);
  const allItems=order.lineItems||[];
  const soList=order.supplierOrders||[];
  const poItemIds=soList.flatMap(so=>so.items||[]);
  const unPOd=allItems.filter(li=>!poItemIds.includes(li.id) && !getSourcedSupplierId(li, enquiry));
  const orderVal=allItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
  // Use buying_price_per_unit × qty if available, else confirmed_price
  const procVal = soList.reduce((s,so) => {
    const bpu = parseFloat(so.buying_price_per_unit);
    if (bpu > 0) {
      const soItems2 = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
      const totalQty = soItems2.reduce((q,li)=>q+(li.qty||0),0);
      return s + bpu * totalQty;
    }
    const cp = parseFloat(so.confirmed_price);
    if (cp > 0) return s + cp;
    return s;
  }, 0);
  const hasConfirmedPrices = procVal > 0;
  const margin=orderVal-procVal;
  const blockedPOs=soList.filter(so=>so.payment_blocked===1||so.payment_blocked===true);
  const allocationLocked = readOnly || soList.length > 0 || blockedPOs.length > 0 || order.status === 'sup_payment_update';

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header" style={{alignItems:'flex-start'}}>
          <div>
            <div style={{display:'flex',alignItems:'baseline',gap:10}}>
              <h2 style={{marginBottom:0}}>🛒 {order.id}</h2>
              {order.po_number&&<span className="mono" style={{fontSize:13,color:'var(--text3)'}}>{order.po_number}</span>}
            </div>
            <div style={{fontSize:15,fontWeight:700,marginTop:4}}>{custName(order.customer_id)}</div>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>
              {order.enquiry_no&&`ENQ: ${order.enquiry_no}`} {order.quote_no&&`· Quote: ${order.quote_no}`} · Due: {order.tentative_date||'—'}
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Detect when supplier terms differ from saved PO terms */}
          {(()=>{
            const mismatched = soList.filter(so=>{
              if (so.status!=='draft') return false;
              const liveSup = suppliers.find(s=>s.id===so.supplier_id);
              if (!liveSup) return false;
              return liveSup.payment_terms_type && liveSup.payment_terms_type !== (so.payment_terms_type||'net');
            });
            return mismatched.length > 0 ? (
              <div style={{padding:'10px 14px',borderRadius:'var(--r)',background:'var(--amber-lt,#fffbeb)',
                border:'2px solid var(--amber,#d97706)',marginBottom:14,
                display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--amber,#d97706)'}}>
                  ⚠ {mismatched.length} PO{mismatched.length!==1?'s have':' has'} outdated payment terms.
                  Supplier terms have changed since these POs were created.
                </div>
                <button className="btn btn-sm"
                  style={{background:'var(--amber,#d97706)',color:'#fff',borderColor:'var(--amber,#d97706)',fontWeight:600,whiteSpace:'nowrap'}}
                  onClick={async()=>{
                    try{
                      const r = await api.post('/orders/'+order.id+'/sync-po-terms',{});
                      toast.success(`✅ Synced ${r.data.synced} PO(s) to current supplier terms`);
                      qc.invalidateQueries(['orders']);
                      qc.invalidateQueries(['finance-queue']);
                      onSaved();
                    }catch(e){toast.error('Sync failed');}
                  }}>
                  🔄 Sync Terms Now
                </button>
              </div>
            ) : null;
          })()}
          {blockedPOs.length>0&&(
            <div style={{padding:'10px 14px',borderRadius:'var(--r)',background:'var(--red-lt,#fef2f2)',
              border:'2px solid var(--red)',marginBottom:14,fontSize:12,color:'var(--red)',fontWeight:600,
              display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <span>🔒 {blockedPOs.length} PO{blockedPOs.length!==1?'s are':' is'} blocked pending advance payment.
              Finance team must record payment to release.</span>
              {/* ADDED: Go to Finance button — same pattern as customer advance in OrdersPage */}
              <button className="btn btn-sm"
                style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',
                  fontWeight:700,whiteSpace:'nowrap',flexShrink:0}}
                onClick={()=>window.location.href='/finance'}>
                💰 Go to Finance →
              </button>
            </div>
          )}
          {/* Line Items + sourcing context */}
          <div className="card card-sm" style={{marginBottom:14}}>
            <div className="card-title">
              <span>📦 Line Items ({allItems.length})</span>
              {unPOd.length>0&&<span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⚠ {unPOd.length} without PO</span>}
            </div>
            {/* ADDED: tableLayout fixed + colgroup for column alignment */}
            <table className="li-table" style={{tableLayout:'fixed',width:'100%'}}>
              <colgroup>
                <col style={{width:30}}/>{/* # */}
                <col style={{width:140}}/>{/* Component */}
                <col style={{width:45}}/>{/* Qty */}
                <col style={{width:90}}/>{/* Cust Price */}
                <col style={{width:90}}/>{/* Target Price */}
                <col style={{width:55}}/>{/* Tax % */}
                <col style={{width:80}}/>{/* Tax Amt */}
                <col style={{width:140}}/>{/* Sourced From */}
                <col style={{width:90}}/>{/* Sourced Price */}
                <col style={{width:90}}/>{/* PO Assigned */}
                <col style={{width:90}}/>{/* Status */}
                <col style={{width:100}}/>{/* Gross Margin */}
              </colgroup>
              <thead>
                <tr>
                  <th>#</th><th>Component</th><th>Qty</th>
                  <th>Cust. Price</th>
                  <th style={{color:'var(--text2)'}}>Target Price</th>
                  {/* FIX 2: Added Tax headers to match Tax cells in tbody */}
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax %</th>
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax Amt</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>★ Sourced From</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>Sourced Price</th>
                  <th>PO Assigned</th><th>Status</th><th style={{color:'var(--green)',textAlign:'right'}}>Gross Margin</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((li,i)=>{
                  const so=soList.find(s=>(s.items||[]).includes(li.id));
                  const enqItem=(enquiry?.items||[]).find(i=>i.id===li.id||i.component===li.component);
                  const srcRow=(enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===li.id)
                    ||(enqItem?(enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===enqItem.id):null);
                  const srcSup=srcRow?.supplier_id;
                  return (
                    <tr key={li.id}>
                      <td>{i+1}</td>
                      <td className="bold">
                        {li.component}
                        <div style={{fontSize:10,color:'var(--text3)'}}>{li.manufacturer}</div>
                      </td>
                      <td>{fmt(li.qty)}</td>
                      {/* Customer price */}
                      <td className="mono" style={{fontWeight:600}}>{fmtCur(li.unit_price,li.currency)}</td>
                      {/* Target price from enquiry item */}
                      <td style={{fontSize:11,color:'var(--text2)'}}>
                        {(() => {
                          const enqItem=(enquiry?.items||[]).find(ei=>ei.id===li.id||(ei.component&&ei.component===li.component));
                          return enqItem?.target_price
                            ? <span style={{fontWeight:600,color:(srcRow?.sourced_price&&parseFloat(srcRow.sourced_price)>parseFloat(enqItem.target_price))?'var(--red)':'var(--text2)'}}>
                                {fmtM(enqItem.target_price, enqItem.target_currency||li.currency)}
                                {srcRow?.sourced_price&&parseFloat(srcRow.sourced_price)>parseFloat(enqItem.target_price)&&
                                  <span style={{fontSize:9,color:'var(--red)',marginLeft:4}}>↑ above target</span>}
                              </span>
                            : <span style={{color:'var(--text3)'}}>—</span>;
                        })()}
                      </td>
                      {/* ADDED: Tax % and Tax Amt tds to match thead — reads from order_items.tax_rate */}
                      <td style={{textAlign:'right',fontSize:12}}>
                        {Number(li.tax_rate)||0}%
                      </td>
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace',color:'var(--teal,#0d9488)'}}>
                        {Number(li.tax_rate)>0
                          ? fmtCur((li.qty||0)*(li.unit_price||0)*((li.tax_rate||0)/100), li.currency)
                          : <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                      {/* Sourced from */}
                      <td>
                        {srcSup
                          ? <div>
                              <div style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700}}>★ {supName(srcSup)}</div>
                              {srcRow?.availability&&<div style={{fontSize:10,color:'var(--text3)'}}>{srcRow.availability}</div>}
                              {srcRow?.lead_time&&<div style={{fontSize:10,color:'var(--text3)'}}>Lead: {srcRow.lead_time}</div>}
                            </div>
                          : <span style={{color:'var(--text3)'}}>—</span>
                        }
                      </td>
                      {/* Sourced price */}
                      <td style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700}}>
                        {srcRow?.sourced_price
                          ? fmtM(srcRow.sourced_price, srcRow.sourced_currency||li.currency)
                          : <span style={{color:'var(--text3)'}}>—</span>
                        }
                      </td>
                      <td>
                        {so
                          ? <><POStatusBadge status={so.status}/>
                              {(so.payment_blocked===1||so.payment_blocked===true)&&
                                <span style={{fontSize:10,color:'var(--red)',marginLeft:4}}>🔒</span>}
                            </>
                          : (srcSup
                              ? <span style={{fontSize:11,color:'var(--accent)',fontWeight:600}}>Assigned: {supName(srcSup)}</span>
                              : <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⚠ No PO</span>)
                        }
                      </td>
                      <td><span style={{fontSize:11,fontWeight:600,color:'var(--text2)'}}>{li.line_status}</span></td>
                      <td>{(()=>{
                        // Gross Margin = ((Cust Price × QTY) − (Sourced Price × QTY)) / (Cust Price × QTY) × 100
                        const custTotal = (li.qty||0) * (li.unit_price||0);
                        const srcTotal  = (li.qty||0) * (parseFloat(srcRow?.sourced_price)||0);
                        if (!srcRow?.sourced_price || custTotal===0) return <span style={{color:'var(--text3)'}}>—</span>;
                        const grossAmt = custTotal - srcTotal;
                        const grossPct = (grossAmt / custTotal) * 100;
                        const col = grossPct < 0  ? '#dc2626'
                                  : grossPct <= 10 ? '#d97706'
                                  : grossPct <= 15 ? '#16a34a'
                                  : '#ca8a04';
                        return (
                          <div style={{fontWeight:800,color:col,fontSize:13,textAlign:'right'}}>
                            {grossPct.toFixed(1)}%
                            <div style={{fontSize:10,fontWeight:500,color:'var(--text3)',marginTop:1}}>
                              {fmtM(grossAmt, li.currency)}
                            </div>
                          </div>
                        );
                      })()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* POs */}
          <div className="card card-sm">
            {/* Detect duplicates: multiple draft POs with same supplier */}
            {(() => {
              const supplierCounts = {};
              soList.filter(so=>so.status==='draft').forEach(so=>{
                supplierCounts[so.supplier_id]=(supplierCounts[so.supplier_id]||0)+1;
              });
              const hasDups = Object.values(supplierCounts).some(c=>c>1);
              return hasDups ? (
                <div style={{marginBottom:10,padding:'10px 14px',borderRadius:'var(--r)',
                  background:'var(--red-lt,#fef2f2)',border:'2px solid var(--red)',
                  display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--red)'}}>
                    ⚠ Duplicate POs detected — same supplier has multiple draft POs.
                    This usually happens from clicking "Save" multiple times.
                  </div>
                  <button className="btn btn-sm"
                    style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',fontWeight:600,whiteSpace:'nowrap'}}
                    onClick={async()=>{
                      try {
                        const r = await api.post('/orders/'+order.id+'/deduplicate-pos',{});
                        toast.success(`Cleaned up ${r.data.removed} duplicate PO(s)`);
                        qc.invalidateQueries(['orders']);
                        onSaved();
                      } catch(e){ toast.error('Cleanup failed'); }
                    }}>
                    🗑 Clean Up Duplicates
                  </button>
                </div>
              ) : null;
            })()}
            <div className="card-title">
              <span>🛒 Purchase Orders ({soList.length})</span>
              <button
                className="btn btn-xs btn-primary"
                onClick={()=>setShowAlloc(true)}
                title={allocationLocked ? 'PO already allocated. View only.' : 'Manage PO allocation'}>
                {allocationLocked ? '👁 View' : '📋 Manage'}
              </button>
            </div>
            {soList.length===0&&<div style={{color:'var(--text3)',fontSize:13,padding:'8px 0'}}>No POs raised. Click "Manage" to assign components to suppliers.</div>}
            {soList.map(so=>{
              const cfg=PO_STATUS[so.status]||PO_STATUS.draft;
              const soItems=(so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
              const late=so.promised_delivery_date&&so.promised_delivery_date<today&&so.status!=='received';
              const blocked=so.payment_blocked===1||so.payment_blocked===true;
              return (
                <div key={so.id} style={{marginBottom:12,padding:'14px 16px',borderRadius:'var(--r)',
                  border:`2px solid ${blocked?'var(--red)':cfg.color}44`,
                  background:blocked?'var(--red-lt,#fef2f2)':cfg.bg}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span className="mono bold" style={{fontSize:14,color:blocked?'var(--red)':cfg.color}}>{so.internal_po_no||so.id}</span>
                        <POStatusBadge status={so.status}/>
                        {blocked&&<span style={{fontSize:10,fontWeight:700,color:'var(--red)',background:'var(--red-lt,#fef2f2)',padding:'2px 7px',borderRadius:999,border:'1px solid var(--red)44'}}>🔒 Blocked</span>}
                        {late&&!blocked&&<span style={{fontSize:10,color:'var(--red)',fontWeight:700,background:'var(--red-lt,#fef2f2)',padding:'2px 7px',borderRadius:999}}>⚠ Overdue</span>}
                      </div>
                      <div style={{fontSize:12,color:'var(--text2)',marginTop:3}}>
                        {supName(so.supplier_id)}
                        {(so.zoho_po_number || so.po_no)&&<> · PO Ref: <strong>{so.zoho_po_number || so.po_no}</strong></>}
                        {so.supplier_ref&&<> · Ref: <strong>{so.supplier_ref}</strong></>}
                        {so.payment_terms_type==='net'&&<> · Net {so.payment_net_days} days{so.payment_due_date&&` (due ${so.payment_due_date})`}</>}
                        {so.payment_terms_type==='advance'&&<> · <span style={{color:'var(--red)'}}>Advance required</span></>}
                        {so.payment_terms_type==='split'&&<> · {so.payment_advance_pct}% advance</>}
                      </div>
                    </div>
                    <button className="btn btn-xs"
                      disabled={(so.payment_blocked===1||so.payment_blocked===true)}
                      title={(so.payment_blocked===1||so.payment_blocked===true)?'Supplier advance payment pending — Finance must pay first':''}
                      style={{opacity:((so.payment_blocked===1||so.payment_blocked===true))?0.4:1,
                        cursor:((so.payment_blocked===1||so.payment_blocked===true))?'not-allowed':'pointer'}}
                      onClick={()=>{ if((so.payment_blocked===1||so.payment_blocked===true)) return; setManagingPO(so); }}>✏ Manage</button>
                  </div>
                  <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12}}>
                    <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>COMPONENTS</div>
                      <div style={{fontWeight:600}}>{soItems.map(li=>li.component).join(', ')||'—'}</div></div>
                    {so.confirmed_price&&<div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>PRICE</div>
                      <div style={{fontWeight:700,color:cfg.color}}>{fmtM(so.confirmed_price,so.confirmed_currency)}</div></div>}
                    {/* Promised Delivery Date */}
                    {so.promised_delivery_date ? (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>PROMISED DELIVERY</div>
                        <div style={{fontWeight:600,color:late?'var(--red)':'var(--green)',display:'flex',alignItems:'center',gap:4}}>
                          {so.promised_delivery_date}{late?' ⚠':''}
                          <span style={{fontSize:10,fontWeight:600,color:late?'var(--red)':'var(--green)',
                            background:late?'var(--red-lt,#fef2f2)':'var(--green-lt)',
                            padding:'1px 6px',borderRadius:99,border:`1px solid ${late?'var(--red)':'var(--green)'}44`}}>
                            {late ? 'Overdue' : 'Confirmed'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>PROMISED DELIVERY</div>
                        <div style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                          <span style={{background:'var(--amber-lt,#fffbeb)',padding:'1px 7px',borderRadius:99,
                            border:'1px solid var(--amber,#d97706)44'}}>
                            ⏳ Awaiting date from supplier
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Ship Load Date — date supplier dispatched goods */}
                    {so.ship_load_date && (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>SHIP LOAD DATE</div>
                        <div style={{fontWeight:600,color:'var(--accent)',display:'flex',alignItems:'center',gap:4}}>
                          📦 {so.ship_load_date}
                          <span style={{fontSize:10,color:'var(--accent)',fontWeight:600,
                            background:'var(--accent-lt)',padding:'1px 6px',borderRadius:99,
                            border:'1px solid var(--accent)44'}}>
                            Dispatched
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Shipping details — show once carrier/tracking is set */}
                    {(so.tracking_no || so.shipper_id) && (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text3)'}}>SHIPPING</div>
                        <div style={{fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                          {so.shipper_id && <span style={{fontSize:11}}>{so.shipper_id}</span>}
                          {so.tracking_no && <span className="mono" style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:700}}>🚚 {so.tracking_no}</span>}
                          {so.shipping_status && so.shipping_status !== 'pending' && (
                            <span style={{fontSize:10,padding:'1px 7px',borderRadius:99,fontWeight:700,
                              background: so.shipping_status==='received'?'var(--green-lt)': so.shipping_status==='in-transit'?'var(--accent-lt)':'var(--amber-lt,#fffbeb)',
                              color: so.shipping_status==='received'?'var(--green)': so.shipping_status==='in-transit'?'var(--accent)':'var(--amber,#d97706)',
                              border:`1px solid ${so.shipping_status==='received'?'var(--green)': so.shipping_status==='in-transit'?'var(--accent)':'var(--amber,#d97706)'}44`}}>
                              {so.shipping_status}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Progress tracker */}
                  <POProgressTracker status={so.status} paymentTermsType={so.payment_terms_type||'net'}/>
                  {/* GRN receipt summary for partially_received / received */}
                  {['partially_received','received'].includes(so.status) && soItems.length > 0 && (
                    <div style={{marginTop:8,padding:'8px 12px',borderRadius:'var(--r-sm)',fontSize:11,
                      background: so.status==='received'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',
                      border:`1px solid ${so.status==='received'?'var(--green)':'var(--amber,#d97706)'}33`}}>
                      <div style={{fontWeight:700,color:so.status==='received'?'var(--green)':'var(--amber,#d97706)',marginBottom:4}}>
                        {so.status==='received'?'✅ Fully Received':'⚠ Partially Received — balance pending from supplier'}
                      </div>
                      {soItems.map(li => {
                        const lineStatus = li.line_status||'';
                        const recLabel = {
                          ready_to_ship:   '✅ Ready to ship',
                          grn_partial:     '⚠ Partial',
                          delivered_hub:   '📦 At hub',
                          partial_shipped: '🔄 Balance pending',
                          shipped:         '🚚 Shipped',
                        }[lineStatus] || lineStatus;
                        const recColor = {
                          ready_to_ship:   'var(--green)',
                          grn_partial:     'var(--amber,#d97706)',
                          delivered_hub:   'var(--teal,#0d9488)',
                          partial_shipped: 'var(--purple,#7c3aed)',
                          shipped:         'var(--text3)',
                        }[lineStatus] || 'var(--text3)';
                        return (
                          <div key={li.id} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',borderTop:'0.5px solid var(--border)'}}>
                            <span style={{fontWeight:600}}>{li.component}</span>
                            <span style={{color:recColor,fontWeight:700}}>{recLabel} ×{li.qty}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Net terms payment due date alert */}
                  {so.payment_terms_type==='net'&&so.payment_due_date&&!['received','cancelled'].includes(so.status)&&(()=>{
                    const daysLeft=Math.ceil((new Date(so.payment_due_date)-new Date())/(1000*60*60*24));
                    if(daysLeft>7) return null;
                    return <div style={{marginTop:6,padding:'4px 10px',borderRadius:'var(--r-sm)',fontSize:11,fontWeight:600,
                      background:daysLeft<=0?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)',
                      color:daysLeft<=0?'var(--red)':'var(--amber,#d97706)',border:`1px solid ${daysLeft<=0?'var(--red)':'var(--amber,#d97706)'}33`}}>
                      💳 Net {so.payment_net_days} — Payment {daysLeft<=0?`overdue by ${Math.abs(daysLeft)} days`:`due in ${daysLeft} days`} ({so.payment_due_date})
                    </div>;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-footer"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
      {showAlloc&&<AllocationModal order={order} suppliers={suppliers} inventoryItems={inventoryItems} customers={customers} enquiry={enquiry} poMode={poMode} readOnly={allocationLocked}
        onClose={()=>setShowAlloc(false)} onSaved={()=>{setShowAlloc(false);qc.invalidateQueries(['orders']);onSaved();}}/>}
      {managingPO&&<ManagePOModal po={managingPO} order={order} enquiry={enquiry} suppliers={suppliers} inventoryItems={inventoryItems} shippers={shippers} poMode={poMode}
        readOnly={false}
        poList={soList} poIndex={soList.findIndex(s=>s.id===managingPO.id)}
        onNavigate={(idx)=>setManagingPO(soList[idx])}
        onClose={()=>setManagingPO(null)} onSaved={()=>{setManagingPO(null);qc.invalidateQueries(['orders']);onSaved();}}/>}
    </div>
  );
}

// ── Main Procurement Bin ──────────────────────────────────────────────────────
export default function ProcurementBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected,      setSelected]      = useState(null);
  const [search,        setSearch]        = useState('');
  const [poFilter,      setPoFilter]      = useState('all');
  const [expandedRows,  setExpandedRows]  = useState(new Set());
  const toggleRow = (id) => setExpandedRows(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const today = new Date().toISOString().slice(0,10);

  const { data: orders    = [], isLoading } = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]),    refetchInterval:20000 });
  const { data: suppliers = [] }            = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const { data: inventoryItems = [] }       = useQuery({ queryKey:['inventory'], queryFn:()=>api.get('/inventory').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const { data: customers = [] }            = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const { data: shippers  = [] }            = useQuery({ queryKey:['shippers'],  queryFn:()=>api.get('/shippers').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const { data: enquiries = [] }            = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const { data: settings  = {} }  = useQuery({ queryKey:['settings'],      queryFn:()=>api.get('/settings').then(r=>r.data).catch(()=>({})) });

  const poMode      = settings.po_mode || 'external';
  const custName    = id=>customers.find(c=>c.id===id)?.name||(user.perms?.canSeeCustomer===false?'[Restricted]':id);
  const inventoryByIdMain = useMemo(() => { const m={}; (inventoryItems||[]).forEach(inv=>{m[inv.id]=inv;}); return m; }, [inventoryItems]);
  const supName = id => {
    if (!id) return '—';
    if (id.startsWith('__inv__')) return getInventoryLabel(inventoryByIdMain[id.slice(7)]);
    return suppliers.find(s=>s.id===id)?.name||id;
  };
  const findEnquiry = (id, no) => {
    if (!id && !no) return null;
    return enquiries.find(e=>e.id===id) || enquiries.find(e=>e.id===no) || null;
  };

  const safeOrders = Array.isArray(orders) ? orders : [];
  const READ_ONLY_STATUSES = ['delivery_hub','partial_hub','transit_hub','partial_dispatched','transit_customer','closed'];
  const procOrders = safeOrders.filter(o =>
    ['procurement','sup_payment_update', ...READ_ONLY_STATUSES].includes(o.status) &&
    (o.lineItems||[]).some(li=>!['delivered','closed'].includes(li.line_status))
  );

  const filteredOrders = useMemo(() => {
    let list = procOrders.filter(o => {
      if (!search) return true;
      const q = search.toLowerCase();
      return o.id.toLowerCase().includes(q)||
             (o.po_number||'').toLowerCase().includes(q)||
             custName(o.customer_id).toLowerCase().includes(q)||
             (o.lineItems||[]).some(li=>(li.component||'').toLowerCase().includes(q));
    });
    if (poFilter==='no-po')  list=list.filter(o=>{
      const ids=(o.supplierOrders||[]).flatMap(so=>so.items||[]);
      const rowEnquiry = findEnquiry(o.enquiry_id, o.enquiry_no);
      return (o.lineItems||[]).some(li=>!ids.includes(li.id) && !getSourcedSupplierId(li, rowEnquiry));
    });
    if (poFilter==='overdue')list=list.filter(o=>(o.supplierOrders||[]).some(so=>so.promised_delivery_date&&so.promised_delivery_date<today&&so.status!=='received'));
    if (poFilter==='blocked')list=list.filter(o=>(o.supplierOrders||[]).some(so=>so.payment_blocked===1||so.payment_blocked===true));
    return list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  }, [procOrders,search,poFilter]);

  const totalOrders=procOrders.length;
  const noPO=procOrders.filter(o=>{
    const ids=(o.supplierOrders||[]).flatMap(so=>so.items||[]);
    const rowEnquiry = findEnquiry(o.enquiry_id, o.enquiry_no);
    return (o.lineItems||[]).some(li=>!ids.includes(li.id) && !getSourcedSupplierId(li, rowEnquiry));
  }).length;
  const overdue=procOrders.filter(o=>(o.supplierOrders||[]).some(so=>so.promised_delivery_date&&so.promised_delivery_date<today&&so.status!=='received')).length;
  const blocked=procOrders.filter(o=>(o.supplierOrders||[]).some(so=>so.payment_blocked===1||so.payment_blocked===true)).length;
  const allSOs=procOrders.flatMap(o=>o.supplierOrders||[]);
  const confirmed=allSOs.filter(so=>so.status==='confirmed').length;
  const received=allSOs.filter(so=>so.status==='received').length;

  return (
    <div>
      {/* PO Mode indicator */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div style={{fontSize:12,color:'var(--text3)',display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontWeight:600}}>PO Mode:</span>
          <span style={{fontWeight:700,color:'var(--accent)',background:'var(--accent-lt)',
            padding:'2px 10px',borderRadius:999,border:'1px solid var(--accent)33'}}>
            {poMode==='external'?'📤 External (Zoho)':'🖨 Platform (Ciflux)'}
          </span>
          <span style={{color:'var(--text3)',fontSize:11}}>Change in Admin → Settings</span>
        </div>

      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'In Procurement', val:totalOrders, color:'var(--accent)'},
          {label:'⚠ No PO',        val:noPO,        color:'var(--amber,#d97706)'},
          {label:'⏰ Overdue',      val:overdue,     color:'var(--red)'},
          {label:'🔒 Blocked',      val:blocked,     color:'var(--red)'},
          {label:'✅ Confirmed',    val:confirmed,   color:'var(--green)'},
          {label:'📦 Received',     val:received,    color:'var(--teal,#0d9488)'},
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label" style={{fontSize:10}}>{s.label}</div>
            <div className="stat-val" style={{fontSize:22,color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search order, PO, customer, component…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div className="filter-row" style={{marginBottom:0}}>
          {[{v:'all',l:`All (${totalOrders})`},{v:'no-po',l:`⚠ No PO (${noPO})`},{v:'overdue',l:`⏰ Overdue (${overdue})`},{v:'blocked',l:`🔒 Blocked (${blocked})`}].map(f=>(
            <span key={f.v} className={`fchip ${poFilter===f.v?'active':''}`} onClick={()=>setPoFilter(f.v)}>{f.l}</span>
          ))}
        </div>
      </div>

      {isLoading&&<div className="loading-center">Loading…</div>}
      {!isLoading&&filteredOrders.length===0&&(
        <div className="empty-state"><div className="empty-icon">🛒</div>
          <div className="empty-state-text">{procOrders.length===0?'Procurement bin is empty.':'No orders match your filter'}</div>
        </div>
      )}

      {/* ── Full-width expandable table layout ── */}
      <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden'}}>
        {/* Table header */}
        <div style={{display:'grid',gridTemplateColumns:'28px 1fr 160px 120px 110px 110px 110px 90px 120px',
          gap:0,background:'var(--surface2)',borderBottom:'1px solid var(--border)',
          padding:'7px 12px',fontSize:11,fontWeight:700,color:'var(--text2)',letterSpacing:.4}}>
          <div/>
          <div>ORDER / CUSTOMER</div>
          <div>STATUS</div>
          <div>ORDER VALUE</div>
          <div>PROC. COST</div>
          <div>MARGIN</div>
          <div>DUE DATE</div>
          <div style={{textAlign:'center'}}>DAYS IN STAGE</div>
          <div style={{textAlign:'right'}}>ACTIONS</div>
        </div>

        {filteredOrders.length===0&&(
          <div className="empty-state" style={{padding:'40px 0'}}>
            <div className="empty-icon">🛒</div>
            <div className="empty-state-text">{procOrders.length===0?'Procurement bin is empty.':'No orders match your filter'}</div>
          </div>
        )}

        {filteredOrders.map((order,rowIdx)=>{
          const soList      = order.supplierOrders||[];
          const allItems    = order.lineItems||[];
          const poItemIds   = soList.flatMap(so=>so.items||[]);
          const rowEnquiry  = findEnquiry(order.enquiry_id, order.enquiry_no);
          const unPOd       = allItems.filter(li=>!poItemIds.includes(li.id) && !getSourcedSupplierId(li, rowEnquiry));
          const hasBlocked  = soList.some(so=>so.payment_blocked===1||so.payment_blocked===true);
          const hasOverdue  = soList.some(so=>so.promised_delivery_date&&so.promised_delivery_date<today&&so.status!=='received');
          const allRcvd     = soList.length>0&&soList.every(so=>so.status==='received');
          const orderVal    = allItems.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
          const procVal     = soList.reduce((s,so)=>{
            const bpu=parseFloat(so.buying_price_per_unit);
            if(bpu>0){
              const qty=(so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean).reduce((q,li)=>q+(li.qty||0),0);
              return s+bpu*qty;
            }
            return s;
          },0);
          const hasBuyingPrice = soList.some(so=>parseFloat(so.buying_price_per_unit)>0);
          const margin      = orderVal-procVal;
          const isExpanded  = expandedRows.has(order.id);
          const delayed     = isDelayed(order);

          // Row accent colour
          const accentCol = hasBlocked?'var(--red)':hasOverdue?'var(--amber,#d97706)':allRcvd?'var(--green)':unPOd.length>0?'var(--amber,#d97706)':'var(--accent)';
          const rowBg     = rowIdx%2===0?'var(--surface)':'var(--surface2)';

          return (
            <React.Fragment key={order.id}>

              {/* ── Summary row ── */}
              <div style={{display:'grid',gridTemplateColumns:'28px 1fr 160px 120px 110px 110px 110px 90px 120px',
                gap:0,padding:'10px 12px',borderBottom:'1px solid var(--border)',
                background:isExpanded?'var(--accent-lt)':rowBg,
                borderLeft:`3px solid ${accentCol}`,cursor:'pointer',alignItems:'center'}}
                onClick={()=>toggleRow(order.id)}>

                {/* Expand toggle */}
                <div style={{fontSize:13,color:'var(--accent)',fontWeight:700,userSelect:'none'}}>
                  {isExpanded?'▾':'▸'}
                </div>

                {/* Order + Customer */}
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                    <span className="mono bold" style={{fontSize:13,color:'var(--accent)'}}>{order.id}</span>
                    {order.po_number&&<span className="mono" style={{fontSize:11,color:'var(--text3)'}}>PO:{order.po_number}</span>}
                    {hasBlocked&&<span className="badge badge-red" style={{fontSize:9}}>🔒 Blocked</span>}
                    {hasOverdue&&!hasBlocked&&<span className="badge badge-red" style={{fontSize:9}}>⏰ Overdue</span>}
                    {allRcvd&&<span className="badge badge-green" style={{fontSize:9}}>✅ All Rcvd</span>}
                    {unPOd.length>0&&<span style={{fontSize:10,color:'var(--amber,#d97706)',fontWeight:600}}>⚠{unPOd.length} no PO</span>}
                  </div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>{custName(order.customer_id)}</div>
                </div>

                {/* Status */}
                <div><StatusBadge s={order.status}/></div>

                {/* Order Value */}
                <div style={{fontSize:12,fontWeight:700,color:'var(--accent)'}}>{fmtM(orderVal)}</div>

                {/* Proc Cost */}
                <div style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>
                  {hasBuyingPrice&&procVal>0 ? fmtM(procVal) : <span style={{color:'var(--text3)'}}>—</span>}
                </div>

                {/* Margin */}
                <div>
                  {hasBuyingPrice&&procVal>0 ? (()=>{
                    const pct=orderVal>0?(margin/orderVal*100):0;
                    const col=pct<0?'var(--red)':pct<=10?'var(--amber,#d97706)':pct<=15?'var(--green)':'#ca8a04';
                    return <span style={{fontSize:12,fontWeight:800,color:col}}>{pct.toFixed(1)}%</span>;
                  })() : <span style={{color:'var(--text3)',fontSize:12}}>—</span>}
                </div>

                {/* Due Date */}
                <div style={{fontSize:12,color:delayed?'var(--red)':'var(--text2)',fontWeight:delayed?700:400}}>
                  {order.tentative_date||'—'}{delayed&&' ⚠'}
                </div>

                {/* Days in Stage */}
                <div><DaysBadge updatedAt={order.updated_at||order.created_at} /></div>

                {/* Actions */}
                <div style={{display:'flex',gap:6,justifyContent:'flex-end'}} onClick={e=>e.stopPropagation()}>
                  {(() => {
                    const rowReadOnly = READ_ONLY_STATUSES.includes(order.status);
                    const rowBlocked = order.status==='sup_payment_update'||order.status==='payment_approval';
                    return (
                  <button className="btn btn-xs btn-primary"
                    disabled={rowBlocked}
                    title={rowBlocked?'Finance action pending':''}
                    style={{opacity:rowBlocked?0.4:1,
                      cursor:rowBlocked?'not-allowed':'pointer'}}
                    onClick={()=>{ if(rowBlocked) return; setSelected(order); }}>
                    {rowReadOnly ? '👁 View' : '✏ Manage'}
                  </button>
                    );
                  })()}
                </div>
              </div>

              {/* ── Expanded detail panel ── */}
              {isExpanded&&(
                <div style={{background:'var(--surface2)',borderBottom:'2px solid var(--border)',
                  padding:'12px 20px 14px 40px'}}>

                  {/* Alerts */}
                  {hasBlocked&&(
                    <div style={{marginBottom:10,padding:'8px 12px',borderRadius:'var(--r-sm)',
                      background:'var(--red-lt,#fef2f2)',border:'1px solid var(--red)33',
                      fontSize:12,color:'var(--red)',fontWeight:600,
                      display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                      <span>🔒 Waiting for Finance to pay:&nbsp;
                      {soList.filter(so=>so.payment_blocked===1||so.payment_blocked===true).map(so=>(
                        <strong key={so.id} style={{marginRight:8}}>
                          {so.internal_po_no} ({supName(so.supplier_id)})
                        </strong>
                      ))}</span>
                      <button className="btn btn-sm"
                        style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',
                          fontWeight:700,whiteSpace:'nowrap',flexShrink:0}}
                        onClick={()=>window.location.href='/finance'}>
                        💰 Go to Finance →
                      </button>
                    </div>
                  )}
                  {allRcvd&&(
                    <div style={{marginBottom:10,padding:'8px 12px',borderRadius:'var(--r-sm)',
                      background:'var(--green-lt)',border:'1px solid var(--green)33',
                      display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                      <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>
                        ✅ All POs received — goods at hub. Ready for GRN and outbound.
                      </span>
                      <a href="/delivery-hub" style={{fontSize:11,fontWeight:700,color:'var(--green)',
                        background:'#fff',padding:'3px 10px',borderRadius:999,
                        border:'1px solid var(--green)44',textDecoration:'none',whiteSpace:'nowrap'}}>
                        Go to Delivery Hub →
                      </a>
                    </div>
                  )}

                  {/* ── Per-supplier PO sections ── */}
                  {(()=>{
                    // Build received/shipped maps from order data
                    const grnMap = (order.grnRecords||[]).reduce((m,r)=>{
                      m[r.order_item_id]=(m[r.order_item_id]||0)+(parseInt(r.qty_received)||0);
                      return m;
                    },{});
                    const shipMap = (order.shipments||[]).flatMap(s=>s.items||[]).reduce((m,si)=>{
                      m[si.order_item_id]=(m[si.order_item_id]||0)+(parseInt(si.qty_shipped)||0);
                      return m;
                    },{});

                    // Items with no PO
                    const unPoedItems = allItems.filter(li=>!soList.some(so=>(so.items||[]).includes(li.id)));

                    return (
                      <div style={{display:'flex',flexDirection:'column',gap:10}}>
                        {soList.map(so=>{
                          const cfg   = PO_STATUS[so.status]||PO_STATUS.draft;
                          const blk   = so.payment_blocked===1||so.payment_blocked===true;
                          const late  = so.promised_delivery_date&&so.promised_delivery_date<today&&!['received','cancelled'].includes(so.status);
                          const soItems = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);

                          // Totals for this PO
                          const totOrdered  = soItems.reduce((s,li)=>s+(li.qty||0),0);
                          const totReceived = soItems.reduce((s,li)=>s+(grnMap[li.id]||0),0);
                          const totShipped  = soItems.reduce((s,li)=>s+(shipMap[li.id]||0),0);
                          const totPending  = totOrdered - totReceived;

                          const borderCol = blk?'var(--red)':['received'].includes(so.status)?'var(--green)':['partially_received'].includes(so.status)?'var(--amber,#d97706)':cfg.color;

                          return (
                            <div key={so.id} style={{border:`2px solid ${borderCol}33`,borderRadius:'var(--r)',overflow:'hidden'}}>
                              {/* PO header */}
                              <div style={{padding:'8px 12px',background:`${borderCol}11`,
                                display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                  <span className="mono" style={{fontWeight:700,fontSize:13,color:borderCol}}>
                                    {so.internal_po_no||so.id}
                                  </span>
                                  <span style={{fontWeight:700,fontSize:13}}>
                                    {supName(so.supplier_id)}
                                  </span>
                                  <POStatusBadge status={so.status}/>
                                  {blk&&<span style={{fontSize:10,fontWeight:700,color:'var(--red)',padding:'2px 7px',borderRadius:999,background:'var(--red-lt,#fef2f2)',border:'1px solid var(--red)44'}}>🔒 Blocked</span>}
                                  {late&&!blk&&<span style={{fontSize:10,fontWeight:700,color:'var(--red)',padding:'2px 7px',borderRadius:999,background:'var(--red-lt,#fef2f2)'}}>⏰ Overdue</span>}
                                  {(so.zoho_po_number||so.po_no)&&<span style={{fontSize:11,color:'var(--text3)'}}>Ref: {so.zoho_po_number||so.po_no}</span>}
                                  {so.promised_delivery_date&&<span style={{fontSize:11,color:late?'var(--red)':'var(--text3)'}}>Due: {so.promised_delivery_date}</span>}
                                  {so.tracking_no&&<span style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:600}}>🚚 {so.tracking_no}</span>}
                                </div>
                                {/* Summary pills */}
                                <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                  <span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text2)',fontWeight:600}}>
                                    Ordered: {totOrdered}
                                  </span>
                                  {totReceived>0&&<span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:'var(--green-lt)',color:'var(--green)',fontWeight:700,border:'1px solid var(--green)44'}}>
                                    ✅ Rcvd: {totReceived}
                                  </span>}
                                  {totPending>0&&<span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',fontWeight:700,border:'1px solid var(--amber,#d97706)44'}}>
                                    ⏳ Pending: {totPending}
                                  </span>}
                                  {totShipped>0&&<span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:'var(--teal-lt,#f0fdfa)',color:'var(--teal,#0d9488)',fontWeight:700,border:'1px solid var(--teal,#0d9488)44'}}>
                                    🚚 Shipped: {totShipped}
                                  </span>}
                                </div>
                              </div>

                              {/* Per-item rows */}
                              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                <thead>
                                  <tr style={{background:'var(--surface)',borderBottom:'1px solid var(--border)'}}>
                                    <th style={{padding:'5px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text2)'}}>COMPONENT</th>
                                    <th style={{padding:'5px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text2)'}}>MANUFACTURER</th>
                                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10,fontWeight:700,color:'var(--text2)'}}>ORDERED</th>
                                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10,fontWeight:700,color:'var(--green)'}}>RECEIVED</th>
                                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10,fontWeight:700,color:'var(--amber,#d97706)'}}>PENDING</th>
                                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10,fontWeight:700,color:'var(--teal,#0d9488)'}}>SHIPPED OUT</th>
                                    <th style={{padding:'5px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text2)'}}>ITEM STATUS</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {soItems.map(li=>{
                                    const rcvd    = grnMap[li.id]||0;
                                    const shipped = shipMap[li.id]||0;
                                    const pending = (li.qty||0) - rcvd;
                                    const LINE_STATUS_LABEL = {
                                      negotiating:     {l:'Negotiating',    c:'var(--text3)'},
                                      procurement:     {l:'Procurement',    c:'var(--accent)'},
                                      shipped:         {l:'🚚 Shipped',     c:'var(--teal,#0d9488)'},
                                      ready_to_ship:   {l:'✅ Ready',       c:'var(--green)'},
                                      grn_partial:     {l:'⚠ Partial GRN',  c:'var(--amber,#d97706)'},
                                      delivered_hub:   {l:'📦 At Hub',      c:'var(--teal,#0d9488)'},
                                      partial_shipped: {l:'🔄 Bal. Pending', c:'var(--purple,#7c3aed)'},
                                      delivered:       {l:'✅ Delivered',   c:'var(--green)'},
                                    };
                                    const ls = LINE_STATUS_LABEL[li.line_status]||{l:li.line_status||'—',c:'var(--text3)'};
                                    return (
                                      <tr key={li.id} style={{borderBottom:'0.5px solid var(--border)'}}>
                                        <td style={{padding:'7px 10px',fontWeight:600,color:'var(--accent)'}}>{li.component}</td>
                                        <td style={{padding:'7px 10px',color:'var(--text2)'}}>{li.manufacturer||'—'}</td>
                                        <td style={{padding:'7px 8px',textAlign:'center',fontWeight:600}}>{li.qty}</td>
                                        <td style={{padding:'7px 8px',textAlign:'center',fontWeight:700,color:rcvd>0?'var(--green)':'var(--text3)'}}>
                                          {rcvd>0?rcvd:'—'}
                                        </td>
                                        <td style={{padding:'7px 8px',textAlign:'center',fontWeight:700,color:pending>0?'var(--amber,#d97706)':'var(--green)'}}>
                                          {pending>0?pending:<span style={{fontSize:11}}>✓</span>}
                                        </td>
                                        <td style={{padding:'7px 8px',textAlign:'center',fontWeight:600,color:shipped>0?'var(--teal,#0d9488)':'var(--text3)'}}>
                                          {shipped>0?shipped:'—'}
                                        </td>
                                        <td style={{padding:'7px 10px'}}>
                                          <span style={{fontSize:11,fontWeight:700,color:ls.c}}>{ls.l}</span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}

                        {/* Items with no PO */}
                        {unPoedItems.length>0&&(
                          <div style={{border:'2px solid var(--amber,#d97706)33',borderRadius:'var(--r)',overflow:'hidden'}}>
                            <div style={{padding:'8px 12px',background:'var(--amber-lt,#fffbeb)',fontSize:12,fontWeight:700,color:'var(--amber,#d97706)'}}>
                              ⚠ {unPoedItems.length} item{unPoedItems.length>1?'s':''} with no PO assigned
                            </div>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                              <tbody>
                                {unPoedItems.map(li=>(
                                  <tr key={li.id} style={{borderBottom:'0.5px solid var(--border)'}}>
                                    <td style={{padding:'7px 10px',fontWeight:600,color:'var(--amber,#d97706)'}}>{li.component}</td>
                                    <td style={{padding:'7px 10px',color:'var(--text2)'}}>{li.manufacturer||'—'}</td>
                                    <td style={{padding:'7px 8px',textAlign:'center',fontWeight:600}}>{li.qty}</td>
                                    <td style={{padding:'7px 10px',color:'var(--text3)',fontSize:11}}>No PO raised</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {selected&&<OrderProcurementModal
        order={selected} suppliers={suppliers} inventoryItems={inventoryItems} customers={customers} shippers={shippers}
        readOnly={READ_ONLY_STATUSES.includes(selected.status)}
        enquiry={findEnquiry(selected.enquiry_id, selected.enquiry_no)} poMode={poMode}
        onClose={()=>setSelected(null)} onSaved={()=>{qc.invalidateQueries(['orders']);api.get('/orders/'+selected.id).then(r=>setSelected(r.data)).catch(()=>{});}}/>}
    </div>
  );
}
