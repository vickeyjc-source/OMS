// client/src/pages/ProcurementBinPage.js  v3
// Full P2P: Sourcing context · Allocation matrix · Payment terms · Finance queue · PO mode toggle
import React, { useState, useMemo, useEffect } from 'react';
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
  paid:                 { label:'Paid / In Transit',     color:'var(--blue,#2563eb)',   bg:'var(--blue-lt,#eff6ff)',  icon:'🚚', step:5 },
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
        const isCur   = s===status || (s==='po_issued'&&status==='sent') || (s==='received'&&status==='partially_received') || (s==='in_transit'&&status==='paid');
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

function fmtM(n){
  const v=parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';

  // Keep precision up to 4 decimals but strip trailing zeros (e.g. 90.0000 -> 90)
  const normalized = v.toFixed(4).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
  const [ip, dp] = normalized.split('.');
  const intFmt = Number(ip).toLocaleString('en-IN');
  return '₹' + (dp ? `${intFmt}.${dp}` : intFmt);
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
                const isAdv = a.payment_terms_type==='advance'||a.payment_terms_type==='split';
                const missingField = isAdv ? !a.supplier_ref : !a.zoho_po_number;
                if (hasPending && missingField) next[itemId] = 'sent';
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
              if (!fr) return;
              const isAdv = a.payment_terms_type==='advance'||a.payment_terms_type==='split';
              const newRef = fr.supplier_ref || a.supplier_ref;
              const newZoho = fr.zoho_po_number || a.zoho_po_number;
              // update if either field changed
              if ((isAdv && fr.supplier_ref && a.supplier_ref !== fr.supplier_ref) ||
                  (fr.zoho_po_number && a.zoho_po_number !== fr.zoho_po_number)) {
                next[itemId] = { ...a, supplier_ref: newRef, zoho_po_number: newZoho };
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          // Clear awaiting state for items whose expected field is now filled
          setPoRequests(prev => {
            const next = { ...prev };
            let changed = false;
            Object.entries(allocRef.current).forEach(([itemId, a]) => {
              const isAdv = a.payment_terms_type==='advance'||a.payment_terms_type==='split';
              const filled = isAdv ? !!a.supplier_ref : !!a.zoho_po_number;
              if (filled && next[itemId] === 'sent') {
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

  const buildSupplierPayload = (supplierId, itemIds) => {
    const rows = itemIds.map(itemId => ({ itemId, row: alloc[itemId] })).filter(x => x.row);
    if (rows.length === 0) return null;

    const firstRow = rows[0].row;
    const currencies = [...new Set(rows.map(({ row }) => row.confirmed_currency || 'INR'))];
    const confirmedCurrency = currencies[0] || 'INR';
    const confirmedPrice = rows.reduce((sum, { row }) => sum + (parseFloat(row.confirmed_price) || 0), 0);

    const unitPrices = rows
      .map(({ row }) => parseFloat(row.buying_price_per_unit))
      .filter(price => Number.isFinite(price) && price > 0);
    const uniqueUnitPrices = [...new Set(unitPrices.map(price => price.toFixed(6)))];
    const buyingPricePerUnit = uniqueUnitPrices.length === 1 ? unitPrices[0] : '';

    return {
      ...firstRow,
      supplier_id: supplierId,
      item_ids: itemIds,
      buying_price_per_unit: buyingPricePerUnit,
      confirmed_price: confirmedPrice > 0 ? confirmedPrice.toFixed(2) : '',
      confirmed_currency: confirmedCurrency,
    };
  };

  const sendFinanceRequest = async (itemId, data) => {
    const supplierItemIds = Object.entries(alloc)
      .filter(([, row])=>row.supplier_id===data.supplier_id)
      .map(([id])=>id);
    const supplierPayload = buildSupplierPayload(data.supplier_id, supplierItemIds);
    if (!supplierPayload) {
      toast.error('No supplier items selected');
      return;
    }
    setPoRequests(r=>supplierItemIds.reduce((next, id)=>({...next,[id]:'sending'}), r));
    try {
      const poNotes = supplierPayload.payment_terms_change_reason
        ? `[Payment terms changed: ${supplierPayload.payment_terms_change_reason}]${supplierPayload.notes ? '\n' + supplierPayload.notes : ''}`
        : supplierPayload.notes || '';
      const po = await api.post('/orders/'+order.id+'/po', {
        ...supplierPayload,
        supplier_name: supName(data.supplier_id),
        notes: poNotes,
      });
      await api.post('/po-requests', {
        order_id: order.id,
        supplier_id: data.supplier_id,
        supplier_order_id: po.data?.id || data._existing_po_id || '',
        supplier_name: supName(data.supplier_id),
        order_ref: order.po_number || order.id,
        payment_terms_type: supplierPayload.payment_terms_type||'net',
      });
      setPoRequests(r=>supplierItemIds.reduce((next, id)=>({...next,[id]:'sent'}), r));
      qc.invalidateQueries(['orders']);
      toast.success(
        supplierPayload.payment_terms_type==='advance'||supplierPayload.payment_terms_type==='split'
          ? 'PO Request and Supplier Advance sent to Finance.'
          : 'PO Request sent to Finance.'
      );
    } catch(e) {
      setPoRequests(r=>supplierItemIds.reduce((next, id)=>({...next,[id]:'idle'}), r));
      toast.error(e.response?.data?.error||'Failed to send request');
    }
  };

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
        if (!bySupplier[row.supplier_id]) bySupplier[row.supplier_id] = [];
        bySupplier[row.supplier_id].push(itemId);
      });
      // ADDED: collect responses to check if any PO is advance-blocked
      let anyBlocked = false;
      for (const [supplierId, itemIds] of Object.entries(bySupplier)) {
        const data = buildSupplierPayload(supplierId, itemIds);
        if (!data) continue;
        const poNotes = data.payment_terms_change_reason
          ? `[Payment terms changed: ${data.payment_terms_change_reason}]${data.notes ? '\n' + data.notes : ''}`
          : data.notes || '';
        const r = await api.post('/orders/'+order.id+'/po', { ...data, supplier_id: supplierId, notes: poNotes });
        if (r.data?.payment_blocked === 1) anyBlocked = true;
      }
      qc.invalidateQueries(['orders']);
      onSaved();
      if (anyBlocked) {
        toast.success('✅ PO raised — Advance payment required. Finance team notified.');
      } else {
        toast.success(`✅ ${Object.keys(bySupplier).length} PO(s) raised!`);
      }
    } catch(e) { toast.error(e.response?.data?.error||'Failed'); }
    finally { setSaving(false); }
  };

  const items = order.lineItems||[];

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl" style={{width:'98vw',maxWidth:1920,height:'94vh',maxHeight:'94vh'}}>
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
  {fmtM(li.unit_price)}
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
                          ? fmtM((li.qty||0)*(li.unit_price||0)*((li.tax_rate||0)/100))
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
                      {/* Supplier PI (advance) / Zoho PO (net/split) */}
                      <td style={{minWidth:160}}>
                        <div>
                          {(a.payment_terms_type==='advance'||a.payment_terms_type==='split') ? (
                            <>
                              <input className="input" value={a.supplier_ref||''} readOnly
                                placeholder="Supplier PI No. *"
                                style={{fontSize:11,borderColor:!a.supplier_ref?'var(--amber,#d97706)':'var(--green)',background:'var(--surface2)',cursor:'not-allowed'}}/>
                              {!a.supplier_ref&&<div style={{fontSize:10,color:'var(--amber,#d97706)',marginTop:2}}>⚠ Supplier PI required</div>}
                              {a.supplier_id && !a.supplier_ref && (
                                poRequests[li.id]==='sent'
                                  ? <div style={{marginTop:4,fontSize:10,color:'var(--accent)',fontWeight:600}}>⏳ Waiting for Finance…</div>
                                  : <button className="btn btn-xs"
                                      style={{marginTop:4,fontSize:10,background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}
                                      disabled={poRequests[li.id]==='sending'}
                                      onClick={()=>sendFinanceRequest(li.id, a)}>
                                      {poRequests[li.id]==='sending' ? '⏳ Sending…' : '📋 Send PO Request'}
                                    </button>
                              )}
                            </>
                          ) : (
                            <>
                              {a.zoho_po_number
                                ? <span className="mono" style={{fontSize:11,color:'var(--green)',fontWeight:600}}>✓ {a.zoho_po_number}</span>
                                : <span style={{fontSize:10,color:'var(--text3)'}}>Zoho PO via Finance</span>}
                              {a.supplier_id && !a.zoho_po_number && (
                                poRequests[li.id]==='sent'
                                  ? <div style={{marginTop:4,fontSize:10,color:'var(--accent)',fontWeight:600}}>⏳ Waiting for Finance…</div>
                                  : <button className="btn btn-xs"
                                      style={{marginTop:4,fontSize:10,background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}
                                      disabled={poRequests[li.id]==='sending'}
                                      onClick={()=>sendFinanceRequest(li.id, a)}>
                                      {poRequests[li.id]==='sending' ? '⏳ Sending…' : '📋 Send PO Request'}
                                    </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      {/* Payment terms — read-only display */}
                      <td style={{minWidth:140}}>
                        <select className="input" value={a.payment_terms_type||'net'}
                          disabled
                          style={{fontSize:11,marginBottom:4,background:'var(--surface2)',color:'var(--text2)',cursor:'not-allowed'}}>
                          {PAYMENT_TERM_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                        {a.payment_terms_type==='net'&&(
                          <div style={{fontSize:10,color:'var(--text3)'}}>Net {a.payment_net_days||30} days</div>
                        )}
                        {a.payment_terms_type==='advance'&&(
                          <div style={{fontSize:10,color:'var(--amber,#d97706)',fontWeight:600,marginTop:2}}>
                            ⚠ Finance must pay before release
                          </div>
                        )}
                        {a.payment_terms_type==='split'&&(
                          <div style={{fontSize:10,color:'var(--text2)',marginTop:2}}>
                            {a.payment_advance_pct||50}% advance
                          </div>
                        )}
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
            {!readOnly && (() => {
              const missingPI = (order.lineItems||[]).some(li => {
                const a = alloc[li.id];
                if (!a?.supplier_id) return false;
                const isAdv = a.payment_terms_type==='advance'||a.payment_terms_type==='split';
                return isAdv && !a.supplier_ref;
              });
              return (
                <button className="btn btn-primary"
                  disabled={saving || Object.keys(grouped).length === 0 || missingPI}
                  title={missingPI ? 'Supplier PI required for all assigned rows — send PO request to Finance' : undefined}
                  onClick={handleSave}>
                  {saving ? 'Saving POs…' : `📤 ${Object.keys(grouped).length > 0 ? 'Save' : 'Generate'} PO Allocation`}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Carrier Combo: search + manual entry + preset list ───────────────────────
function CarrierCombo({ value, carrierOptions, onChange }) {
  const [query, setQuery] = React.useState('');
  const [manualMode, setManualMode] = React.useState(false);
  const [manualVal, setManualVal] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = carrierOptions.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));

  const displayLabel = React.useMemo(() => {
    if (!value) return '';
    const found = carrierOptions.find(c => c.id === value || c.name === value);
    return found ? found.name : value;
  }, [value, carrierOptions]);

  if (manualMode) {
    return (
      <div className="form-group" style={{marginBottom:0}}>
        <label className="label">Carrier</label>
        <div style={{display:'flex',gap:4}}>
          <input className="input" value={manualVal} placeholder="Type carrier name"
            onChange={e=>setManualVal(e.target.value)}
            onBlur={()=>{ if(manualVal.trim()) onChange(manualVal.trim()); }}
            style={{flex:1}}/>
          <button type="button" className="btn btn-xs" onClick={()=>{setManualMode(false);setManualVal('');}}>↩</button>
        </div>
        <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>
          Press Tab/click outside to confirm
        </div>
      </div>
    );
  }

  return (
    <div className="form-group" style={{marginBottom:0,position:'relative'}} ref={ref}>
      <label className="label">Carrier</label>
      <div style={{display:'flex',gap:4}}>
        <div style={{flex:1,position:'relative'}}>
          <input className="input" placeholder={displayLabel || 'Search carrier…'}
            value={open ? query : displayLabel}
            onFocus={()=>{setOpen(true);setQuery('');}}
            onChange={e=>{setQuery(e.target.value);setOpen(true);}}
            style={{width:'100%'}}/>
          {open && (
            <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',
              border:'1px solid var(--border)',borderRadius:'var(--r-sm)',zIndex:200,
              boxShadow:'0 4px 12px rgba(0,0,0,.12)',maxHeight:180,overflowY:'auto'}}>
              {filtered.length===0 && (
                <div style={{padding:'8px 12px',fontSize:12,color:'var(--text3)'}}>No match</div>
              )}
              {filtered.map(c=>(
                <div key={c.id} style={{padding:'7px 12px',cursor:'pointer',fontSize:12,
                  background: value===c.id||value===c.name ? 'var(--accent-lt)' : undefined,
                  fontWeight: value===c.id||value===c.name ? 700 : 400}}
                  onMouseDown={e=>{e.preventDefault();onChange(c.id);setOpen(false);setQuery('');}}>
                  {c.name}
                </div>
              ))}
              <div style={{borderTop:'1px solid var(--border)',padding:'7px 12px',cursor:'pointer',
                fontSize:12,color:'var(--accent)',fontWeight:600}}
                onMouseDown={e=>{e.preventDefault();setOpen(false);setManualMode(true);}}>
                + Add manually
              </div>
            </div>
          )}
        </div>
        <button type="button" className="btn btn-xs" title="Enter carrier manually"
          onClick={()=>setManualMode(true)}>✏</button>
      </div>
      {value && (
        <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>
          Selected: <strong>{displayLabel}</strong>
          <span style={{marginLeft:8,cursor:'pointer',color:'var(--red)'}}
            onClick={()=>onChange('')}>✕ clear</span>
        </div>
      )}
    </div>
  );
}

// ── Manage PO Modal ───────────────────────────────────────────────────────────
function ManagePOModal({ po, order, enquiry, suppliers, inventoryItems, shippers, poMode, onClose, onSaved, readOnly=false }) {
  const qc = useQueryClient();
  const poGrnRecs = (order?.grnRecords||[]).filter(g=>(po.items||[]).includes(g.order_item_id));
  const poItemsForGrn = (po.items||[]).map(id=>(order?.lineItems||[]).find(li=>li.id===id)).filter(Boolean);
  const hasAnyPoGrn = poGrnRecs.length > 0;
  const allPoGrnFull = hasAnyPoGrn && poItemsForGrn.every(li => {
    const rcvd = poGrnRecs.filter(g=>g.order_item_id===li.id).reduce((s,g)=>s+(g.qty_received||0),0);
    return rcvd >= (li.qty||0);
  });
  const effectivePoStatus = allPoGrnFull ? 'received'
    : hasAnyPoGrn ? 'partially_received'
    : (po.status||'draft');
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
    shipping_status:        po.shipping_status==='pending'?'scheduled':(po.shipping_status||'scheduled'),
    shipper_id:             po.shipper_id||'',
    tracking_no:            po.tracking_no||'',
    ship_load_date:         po.ship_load_date||'',
    notes:                  po.notes||''
  });
  const [saving,    setSaving]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [financeSent, setFinanceSent] = useState(() => {
    try { return typeof window !== 'undefined' && sessionStorage.getItem(`po_finance_notified_${po.id}`) === '1'; }
    catch (_) { return false; }
  });
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
  const totalQty = poItems.reduce((s,li)=>s+(li.qty||0),0);
  const totalPurchasePrice = (() => {
    const confirmedTotal = parseFloat(form.confirmed_price);
    if (Number.isFinite(confirmedTotal) && confirmedTotal > 0) return confirmedTotal;
    const bpu = parseFloat(form.buying_price_per_unit);
    if (Number.isFinite(bpu) && bpu > 0) return bpu * totalQty;
    const sourceTotal = poItems.reduce((sum, li) => {
      const enqItem = (enquiry?.items||[]).find(i=>i.id===li.id || i.component===li.component);
      const srcRow = (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===li.id)
        || (enqItem ? (enquiry?.sourcing||[]).find(s=>s.enquiry_item_id===enqItem.id) : null);
      return sum + ((parseFloat(srcRow?.sourced_price) || 0) * (li.qty||0));
    }, 0);
    return sourceTotal;
  })();
  const isBlocked=po.payment_blocked===1||po.payment_blocked===true;
  const markFinanceSent = () => {
    setFinanceSent(true);
    try { if (typeof window !== 'undefined') sessionStorage.setItem(`po_finance_notified_${po.id}`, '1'); } catch (_) {}
    toast('💰 Finance team has been notified. Check Finance tab for payment status.');
  };
  const canEditPaymentTerms = !readOnly && po.finance_returned === true && po.status === 'draft' && !isBlocked;
  const carrierOptions = (shippers && shippers.length)
    ? shippers
    : [
        { id:'dhl', name:'DHL' },
        { id:'fedex', name:'FedEx' },
        { id:'ups', name:'UPS' },
        { id:'bluedart', name:'Blue Dart' },
        { id:'delhivery', name:'Delhivery' },
      ];
  useEffect(() => {
    if (!form.promised_delivery_date) return;
    setForm(prev => {
      if (prev.ship_load_date) return prev;
      const d = new Date(prev.promised_delivery_date);
      if (Number.isNaN(d.getTime())) return prev;
      d.setDate(d.getDate() - 14);
      const autoDate = d.toISOString().slice(0,10);
      return { ...prev, ship_load_date: autoDate };
    });
  }, [form.promised_delivery_date]);

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
    // AWB is mandatory when shipping details section is visible (confirmed or beyond)
    if (['confirmed','in_transit','partially_received','received'].includes(form.status) && !form.tracking_no?.trim()) {
      toast.error('AWB / Tracking number is required');
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
                disabled={financeSent}
                style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',fontWeight:700,opacity:financeSent?0.65:1,cursor:financeSent?'not-allowed':'pointer'}}
                onClick={markFinanceSent}>
                {financeSent ? '✅ Already Sent to Finance' : '💰 Send to Finance'}
              </button>
            )}
            <POStatusBadge status={effectivePoStatus}/>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body">
          <fieldset disabled={readOnly || effectivePoStatus === 'received'} style={{border:'none',margin:0,padding:0,minWidth:0}}>
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
          {/* PO Status — progress tracker only, action buttons moved to footer */}
          <div className="form-group">
            <label className="label" style={{fontWeight:700}}>PO Status</label>
            <POProgressTracker status={effectivePoStatus} paymentTermsType={form.payment_terms_type}/>
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
              <label className="label">Total Purchase Price</label>
              <input className="input"
                value={fmtM(totalPurchasePrice)}
                disabled
                style={{background:'var(--surface2)',color:'var(--text)',fontWeight:700}}/>
              {form.promised_delivery_date && (
                <div style={{marginTop:4,fontSize:11,color:'var(--text2)'}}>
                  Expected delivery by {form.promised_delivery_date}
                </div>
              )}
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Expected Delivery Date</label>
              {(() => {
                const todayStr = new Date().toISOString().slice(0,10);
                return (
                  <input className="input" type="date" value={form.promised_delivery_date}
                    min={todayStr}
                    onChange={e=>set('promised_delivery_date',e.target.value)}/>
                );
              })()}
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
              {canEditPaymentTerms && (
                <div style={{fontSize:10,color:'var(--amber,#d97706)',fontWeight:700,marginBottom:4}}>
                  Returned by Finance: update terms and save. Advance/split terms will be sent back to Finance automatically.
                </div>
              )}
              <select className="input" value={form.payment_terms_type} disabled={!canEditPaymentTerms}
                onChange={e=>set('payment_terms_type',e.target.value)}
                style={{background:canEditPaymentTerms?'var(--surface)':'var(--surface2)',color:'var(--text2)'}}>
                {PAYMENT_TERM_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              {form.payment_terms_type==='net'&&(
                <select className="input" style={{marginTop:4,background:canEditPaymentTerms?'var(--surface)':'var(--surface2)',color:'var(--text2)'}} value={form.payment_net_days} disabled={!canEditPaymentTerms}
                  onChange={e=>set('payment_net_days',parseInt(e.target.value))}>
                  {NET_DAYS_OPTIONS.map(d=><option key={d} value={d}>Net {d} days</option>)}
                </select>
              )}
              {form.payment_terms_type==='split'&&(
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                  <input className="input" type="number" min="0" max="100" value={form.payment_advance_pct} disabled={!canEditPaymentTerms}
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
          {['confirmed','in_transit','partial','received','paid','partially_received'].includes(form.status)&&(
            <div style={{marginTop:13,padding:'12px 14px',background:'var(--surface2)',borderRadius:'var(--r-sm)'}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:10,color:'var(--text2)'}}>🚚 Shipping</div>
              {effectivePoStatus === 'received' ? (
                /* Read-only shipping summary when GRN is done */
                <div style={{display:'flex',gap:20,flexWrap:'wrap',fontSize:12}}>
                  {form.shipper_id && <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>CARRIER</div><div style={{fontWeight:600}}>{form.shipper_id}</div></div>}
                  {form.tracking_no && <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>TRACKING / AWB</div><div style={{fontWeight:700,fontFamily:'monospace',color:'var(--teal,#0d9488)'}}>{form.tracking_no}</div></div>}
                  {form.shipping_status && <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>SHIPPING STATUS</div><div style={{fontWeight:600}}>{form.shipping_status}</div></div>}
                  {form.ship_load_date && <div><div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>SHIP LOAD DATE</div><div style={{fontWeight:600}}>{form.ship_load_date}</div></div>}
                </div>
              ) : (
                <>
                  {(!shippers || shippers.length===0) && (
                    <div style={{fontSize:11,color:'var(--amber,#d97706)',marginBottom:8,fontWeight:600}}>
                      ⚠ No active shippers configured. Showing common carrier list fallback.
                    </div>
                  )}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                    <div className="form-group" style={{marginBottom:0}}><label className="label">Shipping Status</label>
                      <select className="input" value={form.shipping_status} onChange={e=>set('shipping_status',e.target.value)}>
                        {[
                          {v:'scheduled', l:'scheduled'},
                          {v:'in-transit', l:'in-transit'},
                          {v:'partially-received', l:'partially-received'},
                          {v:'received', l:'received'},
                          {v:'failed', l:'failed'},
                        ].map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
                      </select></div>
                    <CarrierCombo value={form.shipper_id} carrierOptions={carrierOptions} onChange={v=>set('shipper_id',v)}/>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Ship Load Date <span style={{fontSize:10,color:'var(--text3)',fontWeight:400}}>(date supplier dispatched)</span></label>
                      {(() => {
                        const todayStr2 = new Date().toISOString().slice(0,10);
                        const maxDate = form.promised_delivery_date || undefined;
                        return (
                          <input className="input" type="date" value={form.ship_load_date}
                            min={todayStr2 > (form.ship_load_date || todayStr2) ? todayStr2 : undefined}
                            max={maxDate}
                            onChange={e=>set('ship_load_date',e.target.value)}/>
                        );
                      })()}
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr',gap:10,marginTop:8}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="label">Tracking / AWB <span style={{color:'var(--red)',marginLeft:2}}>*</span></label>
                      <input className="input" value={form.tracking_no}
                        onChange={e=>{
                          set('tracking_no',e.target.value);
                          if (e.target.value.trim() && form.status==='confirmed') {
                            set('status','in_transit');
                          }
                        }}
                        placeholder="AWB / Tracking number (required)"
                        style={{borderColor: form.tracking_no?'var(--green)':'var(--red)'}}/>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {/* Next step guidance — only when NOT yet received */}
          {form.tracking_no && form.shipper_id && effectivePoStatus !== 'received' && (
            <div style={{marginTop:10,padding:'10px 14px',borderRadius:'var(--r)',
              background:'var(--accent-lt)',border:'2px solid var(--accent)',fontSize:12}}>
              <div style={{fontWeight:700,color:'var(--accent)',marginBottom:4}}>
                🚚 Shipping details captured — what's next?
              </div>
              <ol style={{margin:'0 0 0 16px',padding:0,color:'var(--text2)',lineHeight:1.8}}>
                <li><strong>Save PO</strong> below — order will move to <strong>Transit – Hub</strong> status</li>
                <li>Go to <a href="/app/delivery-hub" style={{color:'var(--accent)',fontWeight:600}}>Delivery Hub →</a> to record GRN when goods arrive</li>
              </ol>
            </div>
          )}

          <div className="form-group" style={{marginTop:13,marginBottom:0}}><label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)}/></div>
          </fieldset>
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          {!readOnly && effectivePoStatus !== 'received' ? <button className="btn btn-danger" onClick={del} style={{fontSize:12}}>🗑 Delete</button> : <span/>}
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
            {/* Send to Delivery Hub — only when confirmed/paid + shipping details filled + GRN not yet done */}
            {!readOnly && ['confirmed','paid'].includes(po.status) && effectivePoStatus !== 'received' && form.tracking_no?.trim() && form.shipper_id?.trim() && (
              <button type="button" className="btn" disabled={saving}
                style={{background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700,fontSize:12}}
                onClick={async()=>{
                  setSaving(true);
                  try {
                    await api.put('/supplier-orders/'+po.id,{...form,status:'in_transit'});
                    qc.invalidateQueries(['orders']);
                    toast.success('📦 PO sent to Delivery Hub! Go to Delivery Hub to record GRN when goods arrive.');
                    onSaved();
                    onClose();
                  } catch(e){ toast.error(e.response?.data?.error||'Failed'); setSaving(false); }
                }}>
                📦 Send to Delivery Hub →
              </button>
            )}
            {/* Already in transit — show label only when not yet received */}
            {['in_transit','paid'].includes(po.status) && effectivePoStatus !== 'received' && (
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',
                background:'var(--blue-lt,#eff6ff)',color:'var(--blue,#2563eb)',
                fontWeight:700,border:'1px solid var(--blue,#2563eb)44'}}>
                🚚 In Transit — awaiting GRN at Delivery Hub
              </span>
            )}
            {/* Partially received — show status + allow re-sending balance to hub */}
            {effectivePoStatus==='partially_received' && (
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',
                background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',
                fontWeight:700,border:'1px solid var(--amber,#d97706)44'}}>
                ⚠ Partially Received — balance still at supplier
              </span>
            )}
            {!readOnly && effectivePoStatus==='partially_received' && form.tracking_no?.trim() && form.shipper_id?.trim() && (
              <button type="button" className="btn" disabled={saving}
                style={{background:'var(--teal,#0d9488)',color:'#fff',borderColor:'var(--teal,#0d9488)',fontWeight:700,fontSize:12}}
                onClick={async()=>{
                  setSaving(true);
                  try {
                    await api.put('/supplier-orders/'+po.id,{...form,status:'in_transit'});
                    qc.invalidateQueries(['orders']);
                    toast.success('📦 Balance shipment sent to Delivery Hub!');
                    onSaved();
                    onClose();
                  } catch(e){ toast.error(e.response?.data?.error||'Failed'); setSaving(false); }
                }}>
                📦 Send Balance to Delivery Hub →
              </button>
            )}
            {/* Fully received — shown when GRN is done (order at delivery_hub or beyond) */}
            {effectivePoStatus==='received' && (
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
  const qc = useQueryClient();
  const [showAlloc,  setShowAlloc]  = useState(false);
  const [managingPO, setManagingPO] = useState(null);
  const [paymentBreakdownOpen, setPaymentBreakdownOpen] = useState(true);
  const [lineItemsOpen, setLineItemsOpen] = useState(true);
  const [financeSent, setFinanceSent] = useState(() => {
    try { return typeof window !== 'undefined' && sessionStorage.getItem(`order_finance_notified_${order.id}`) === '1'; }
    catch (_) { return false; }
  });
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
  const orderTaxVal=allItems.reduce((s,li)=>{
    const base=(li.qty||0)*(li.unit_price||0);
    return s + base*((li.tax_rate||0)/100);
  },0);
  const customerTotal=orderVal+orderTaxVal;
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
  const blockedPOs=soList.filter(so=>so.payment_blocked===1||so.payment_blocked===true);
  const allocationLocked = readOnly || soList.length > 0 || blockedPOs.length > 0 || order.status === 'sup_payment_update';
  const sourcingRows = enquiry?.sourcing || [];
  const enquiryItems = enquiry?.items || [];
  const supplierSummaries = soList.map(so => {
    const soItems = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
    const itemBreakdown = soItems.map(li => {
      const enqItem = enquiryItems.find(ei => ei.id===li.id || ei.component===li.component);
      const srcRow = sourcingRows.find(s=>s.enquiry_item_id===li.id)
        || (enqItem ? sourcingRows.find(s=>s.enquiry_item_id===enqItem.id) : null);
      const unitSource = parseFloat(srcRow?.sourced_price) || parseFloat(so.buying_price_per_unit) || 0;
      const lineSourceTotal = unitSource * (li.qty||0);
      return {
        component: li.component,
        qty: li.qty||0,
        unitSource,
        lineSourceTotal,
        currency: srcRow?.sourced_currency || so.confirmed_currency || li.currency || 'INR',
      };
    });
    const sourceTotal = itemBreakdown.reduce((sum, item) => sum + item.lineSourceTotal, 0);
    return {
      id: so.id,
      supplierName: supName(so.supplier_id),
      sourceTotal,
      items: itemBreakdown,
    };
  });
  const markFinanceSent = () => {
    setFinanceSent(true);
    try { if (typeof window !== 'undefined') sessionStorage.setItem(`order_finance_notified_${order.id}`, '1'); } catch (_) {}
    toast('💰 Finance team has been notified. Check Finance tab for payment status.');
  };

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl" style={{width:'98vw',maxWidth:1920,height:'94vh',maxHeight:'94vh'}}>
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
                disabled={financeSent}
                style={{background:'var(--red)',color:'#fff',borderColor:'var(--red)',
                  fontWeight:700,whiteSpace:'nowrap',flexShrink:0,opacity:financeSent?0.65:1,cursor:financeSent?'not-allowed':'pointer'}}
                onClick={markFinanceSent}>
                {financeSent ? '✅ Already Sent to Finance' : '💰 Send to Finance'}
              </button>
            </div>
          )}
          <div className="card card-sm" style={{marginBottom:14}}>
            <button
              type="button"
              onClick={()=>setPaymentBreakdownOpen(v=>!v)}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,background:'transparent',border:'none',padding:0,cursor:'pointer'}}
            >
              <div className="card-title" style={{marginBottom:0}}><span>₹ Payment Breakdown</span></div>
              <span style={{fontSize:16,color:'var(--text3)',fontWeight:700,lineHeight:1}}>{paymentBreakdownOpen ? '▾' : '▸'}</span>
            </button>
            {paymentBreakdownOpen&&(
              <>
                <div style={{display:'grid',gridTemplateColumns:'1.15fr 1fr',gap:14}}>
                  <div style={{padding:'12px 14px',border:'1px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--surface2)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:8}}>CUSTOMER RECEIVES</div>
                    <div style={{display:'grid',gap:6,fontSize:12}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
                        <span>Base value</span><strong>{fmtM(orderVal)}</strong>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
                        <span>Tax</span><strong>{fmtM(orderTaxVal)}</strong>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',gap:12,paddingTop:6,borderTop:'1px solid var(--border)',fontSize:13}}>
                        <span>Total incl. tax</span><strong style={{color:'var(--green)'}}>{fmtM(customerTotal)}</strong>
                      </div>
                    </div>
                  </div>
                  <div style={{padding:'12px 14px',border:'1px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--surface2)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:8}}>SUPPLIER PAYABLE</div>
                    <div style={{display:'grid',gap:6,fontSize:12}}>
                      {supplierSummaries.map(summary=>(
                        <div key={summary.id} style={{display:'flex',justifyContent:'space-between',gap:12}}>
                          <span>{summary.supplierName}</span>
                          <strong>{fmtM(summary.sourceTotal)}</strong>
                        </div>
                      ))}
                      <div style={{display:'flex',justifyContent:'space-between',gap:12,paddingTop:6,borderTop:'1px solid var(--border)',fontSize:13}}>
                        <span>Total source cost</span><strong style={{color:'var(--accent)'}}>{fmtM(supplierSummaries.reduce((sum, s)=>sum+s.sourceTotal,0))}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                {supplierSummaries.length>0&&(
                  <div style={{display:'grid',gap:10,marginTop:12}}>
                    {supplierSummaries.map(summary=>(
                      <div key={summary.id} style={{padding:'10px 12px',border:'1px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--surface)'}}>
                        <div style={{fontWeight:700,fontSize:12,marginBottom:6}}>{summary.supplierName}</div>
                        <div style={{display:'grid',gap:4,fontSize:12}}>
                          {summary.items.map(item=>(
                            <div key={`${summary.id}_${item.component}`} style={{display:'flex',justifyContent:'space-between',gap:12}}>
                              <span>{item.component}: {item.qty} x {fmtM(item.unitSource)}</span>
                              <strong>{fmtM(item.lineSourceTotal)}</strong>
                            </div>
                          ))}
                          <div style={{display:'flex',justifyContent:'space-between',gap:12,paddingTop:6,borderTop:'1px solid var(--border)'}}>
                            <span>Supplier total</span>
                            <strong style={{color:'var(--accent)'}}>{fmtM(summary.sourceTotal)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {/* Line Items + sourcing context */}
          <div className="card card-sm" style={{marginBottom:14}}>
            <button
              type="button"
              onClick={()=>setLineItemsOpen(v=>!v)}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,background:'transparent',border:'none',padding:0,cursor:'pointer'}}
            >
              <div className="card-title" style={{marginBottom:0}}>
                <span>📦 Line Items ({allItems.length})</span>
                {unPOd.length>0&&<span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⚠ {unPOd.length} without PO</span>}
              </div>
              <span style={{fontSize:16,color:'var(--text3)',fontWeight:700,lineHeight:1}}>{lineItemsOpen ? '▾' : '▸'}</span>
            </button>
            {lineItemsOpen&&(
            <table className="li-table" style={{tableLayout:'fixed',width:'100%'}}>
              <colgroup>
                <col style={{width:30}}/>{/* # */}
                <col style={{width:170}}/>{/* Component */}
                <col style={{width:55}}/>{/* Qty */}
                <col style={{width:150}}/>{/* Sourced From */}
                <col style={{width:95}}/>{/* Sourced Price */}
                <col style={{width:110}}/>{/* Source Total */}
                <col style={{width:95}}/>{/* Customer Price */}
                <col style={{width:60}}/>{/* Tax % */}
                <col style={{width:90}}/>{/* Tax Amt */}
                <col style={{width:110}}/>{/* Customer Total */}
                <col style={{width:90}}/>{/* PO Assigned */}
                <col style={{width:90}}/>{/* Status */}
                <col style={{width:100}}/>{/* Gross Margin */}
              </colgroup>
              <thead>
                <tr>
                  <th>#</th><th>Component</th><th>Qty</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>★ Sourced From</th>
                  <th style={{color:'var(--teal,#0d9488)'}}>Source Price</th>
                  <th style={{textAlign:'right'}}>Source Total</th>
                  <th>Customer Price</th>
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax %</th>
                  <th style={{color:'var(--teal,#0d9488)',textAlign:'right'}}>Tax Amt</th>
                  <th style={{textAlign:'right'}}>Customer Total</th>
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
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace',fontWeight:700}}>
                        {(() => {
                          const srcPrice = Number(srcRow?.sourced_price) || 0;
                          const base = srcPrice * (li.qty||0);
                          return base ? <div>{fmtM(base, srcRow?.sourced_currency||li.currency)}</div> : <span style={{color:'var(--text3)'}}>—</span>;
                        })()}
                      </td>
                      <td className="mono" style={{fontWeight:600}}>{fmtM(li.unit_price, li.currency)}</td>
                      <td style={{textAlign:'right',fontSize:12}}>
                        {Number(li.tax_rate)||0}%
                      </td>
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace',fontWeight:700}}>
                        {(() => {
                          const customerBase = (Number(li.unit_price)||0) * (li.qty||0);
                          const taxAmt = customerBase * ((Number(li.tax_rate)||0) / 100);
                          return taxAmt ? <div>{fmtM(taxAmt, li.currency)}</div> : <span style={{color:'var(--text3)'}}>—</span>;
                        })()}
                      </td>
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace',fontWeight:700}}>
                        {(() => {
                          const customerBase = (Number(li.unit_price)||0) * (li.qty||0);
                          const total = customerBase + (customerBase * ((Number(li.tax_rate)||0) / 100));
                          return customerBase ? <div>{fmtM(total, li.currency)}</div> : <span style={{color:'var(--text3)'}}>—</span>;
                        })()}
                      </td>
                      <td>
                        {so
                          ? <>
                              {(() => {
                                const poAssignedRef = so.zoho_po_number || so.supplier_ref || so.po_no || so.internal_po_no;
                                if (poAssignedRef) {
                                  return (
                                    <span style={{fontSize:11,fontWeight:700,color:'var(--green)',display:'inline-flex',alignItems:'center',gap:4}}>
                                      ✓ <span className="mono">{poAssignedRef}</span>
                                    </span>
                                  );
                                }
                                return (
                                  <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
                                    color:so.status==='draft'?'var(--amber,#d97706)':(PO_STATUS[so.status]?.color||'var(--text3)'),
                                    background:so.status==='draft'?'var(--amber-lt,#fffbeb)':(PO_STATUS[so.status]?.bg||'var(--surface2)'),
                                    border:`1px solid ${so.status==='draft'?'var(--amber,#d97706)':(PO_STATUS[so.status]?.color||'var(--text3)')}33`}}>
                                    {so.status==='draft' ? '⏳ Pending' : `${PO_STATUS[so.status]?.icon||'•'} ${PO_STATUS[so.status]?.label||so.status}`}
                                  </span>
                                );
                              })()}
                              {(so.payment_blocked===1||so.payment_blocked===true)&&
                                <span style={{fontSize:10,color:'var(--red)',marginLeft:4}}>🔒</span>}
                            </>
                          : (srcSup
                              ? <span style={{fontSize:11,color:'var(--accent)',fontWeight:600}}>Assigned: {supName(srcSup)}</span>
                              : <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>⚠ No PO</span>)
                        }
                      </td>
                      <td><span style={{fontSize:11,fontWeight:600,color:'var(--text2)'}}>{li.line_status==='negotiating'?'Confirmed':li.line_status}</span></td>
                      <td>{(()=>{
                        const srcPrice   = Number(srcRow?.sourced_price) || 0;
                        const quotePrice = Number(srcRow?.quote_price)   || 0;
                        if (!srcPrice || !quotePrice) return <span style={{color:'var(--text3)'}}>—</span>;
                        const grossUnit  = quotePrice - srcPrice;
                        const grossTotal = grossUnit * (li.qty||0);
                        const grossPct   = quotePrice > 0 ? (grossUnit / quotePrice * 100) : 0;
                        const col = grossPct < 0  ? '#dc2626'
                                  : grossPct <= 10 ? '#d97706'
                                  : grossPct <= 15 ? '#16a34a'
                                  : '#ca8a04';
                        return (
                          <div style={{fontWeight:800,color:col,fontSize:13,textAlign:'right'}}>
                            {grossPct.toFixed(1)}%
                            <div style={{fontSize:10,fontWeight:500,color:'var(--text3)',marginTop:1}}>
                              +{fmtM(grossTotal, li.currency)}
                            </div>
                          </div>
                        );
                      })()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
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
              const soGrnRecs = (order.grnRecords||[]).filter(g=>(so.items||[]).includes(g.order_item_id));
              const soItemsForGrn = (so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
              const hasAnyGrn = soGrnRecs.length > 0;
              const allGrnFull = hasAnyGrn && soItemsForGrn.every(li => {
                const rcvd = soGrnRecs.filter(g=>g.order_item_id===li.id).reduce((s,g)=>s+(g.qty_received||0),0);
                return rcvd >= (li.qty||0);
              });
              const effectiveSoStatus = allGrnFull ? 'received'
                : hasAnyGrn ? 'partially_received'
                : so.status;
              const cfg=PO_STATUS[effectiveSoStatus]||PO_STATUS.draft;
              const soItems=(so.items||[]).map(id=>allItems.find(li=>li.id===id)).filter(Boolean);
              const late=so.promised_delivery_date&&so.promised_delivery_date<today&&!['received','delivery_hub','partial_hub','transit_hub','transit_customer','closed'].includes(effectiveSoStatus);
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
                  <POProgressTracker status={effectiveSoStatus} paymentTermsType={so.payment_terms_type||'net'}/>
                  {/* GRN receipt summary — show when GRN has been recorded for this PO */}
                  {(()=>{
                    const soGrnRecs = (order.grnRecords||[]).filter(g=>(so.items||[]).includes(g.order_item_id));
                    const hasGrn = soGrnRecs.length > 0;
                    if (!hasGrn && !['partially_received','received'].includes(effectiveSoStatus)) return null;
                    const allFull = soItems.every(li => {
                      const rcvd = soGrnRecs.filter(g=>g.order_item_id===li.id).reduce((s,g)=>s+(g.qty_received||0),0);
                      return rcvd >= (li.qty||0);
                    });
                    return (
                      <div style={{marginTop:8,padding:'8px 12px',borderRadius:'var(--r-sm)',fontSize:11,
                        background: allFull?'var(--green-lt)':'var(--amber-lt,#fffbeb)',
                        border:`1px solid ${allFull?'var(--green)':'var(--amber,#d97706)'}33`}}>
                        <div style={{fontWeight:700,color:allFull?'var(--green)':'var(--amber,#d97706)',marginBottom:4}}>
                          {allFull?'✅ Fully Received':'⚠ Partially Received — balance pending from supplier'}
                        </div>
                        {soItems.map(li => {
                          const rcvd = soGrnRecs.filter(g=>g.order_item_id===li.id).reduce((s,g)=>s+(g.qty_received||0),0);
                          const ordered = li.qty||0;
                          const isFull = rcvd >= ordered;
                          const hasAny = rcvd > 0;
                          const recColor = isFull ? 'var(--green)' : hasAny ? 'var(--amber,#d97706)' : 'var(--text3)';
                          return (
                            <div key={li.id} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',borderTop:'0.5px solid var(--border)'}}>
                              <span style={{fontWeight:600}}>{li.component}</span>
                              <span style={{color:recColor,fontWeight:700}}>
                                {hasAny
                                  ? (isFull ? `✅ Received: ${rcvd}/${ordered}` : `⚠ Received: ${rcvd}/${ordered}`)
                                  : `Pending: 0/${ordered}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
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
  const [previewOrder,  setPreviewOrder]  = useState(null);
  const [search,        setSearch]        = useState('');
  const [poFilter,      setPoFilter]      = useState('all');
  const [seenProc, setSeenProc] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('seen_procurement')||'[]')); } catch(_) { return new Set(); } });
  const markProcSeen = (id) => {
    setSeenProc(prev => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem('seen_procurement', JSON.stringify([...next]));
      window.dispatchEvent(new Event('seen-updated'));
      return next;
    });
  };
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

  // Procurement status breakdown across all POs
  const poStatusCounts = allSOs.reduce((acc,so)=>{
    const key = so.status||'draft';
    acc[key]=(acc[key]||0)+1;
    return acc;
  },{});
  const procStatusBreakdown = [
    { key:'draft',                 label:'Draft',              color:'var(--text3)',         bg:'var(--surface2)', icon:'📝' },
    { key:'pending_payment',       label:'Pending Payment',    color:'var(--red)',            bg:'var(--red-lt,#fef2f2)', icon:'🔒' },
    { key:'po_issued',             label:'PO Issued',          color:'var(--accent)',         bg:'var(--accent-lt)', icon:'📤' },
    { key:'sent',                  label:'PO Issued',          color:'var(--accent)',         bg:'var(--accent-lt)', icon:'📤' },
    { key:'awaiting_confirmation', label:'Awaiting Confirm',   color:'var(--amber,#d97706)', bg:'var(--amber-lt,#fffbeb)', icon:'⏳' },
    { key:'confirmed',             label:'Confirmed',          color:'var(--teal,#0d9488)',  bg:'var(--teal-lt,#f0fdfa)', icon:'✅' },
    { key:'in_transit',            label:'In Transit',         color:'var(--blue,#2563eb)',  bg:'var(--blue-lt,#eff6ff)', icon:'🚚' },
    { key:'paid',                  label:'Paid/In Transit',    color:'var(--blue,#2563eb)',  bg:'var(--blue-lt,#eff6ff)', icon:'🚚' },
    { key:'partially_received',    label:'Partial Rcvd',       color:'var(--amber,#d97706)', bg:'var(--amber-lt,#fffbeb)', icon:'⚠' },
    { key:'received',              label:'Received',           color:'var(--green)',          bg:'var(--green-lt)', icon:'📦' },
    { key:'cancelled',             label:'Cancelled',          color:'var(--red)',            bg:'var(--red-lt,#fef2f2)', icon:'❌' },
  ].map(s=>({...s, count:(poStatusCounts[s.key]||0)})).filter(s=>s.count>0);

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

      {/* Procurement Status Breakdown */}
      {procStatusBreakdown.length>0&&(
        <div style={{marginBottom:16,padding:'12px 16px',borderRadius:'var(--r)',
          background:'var(--surface)',border:'1px solid var(--border)'}}>
          <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',letterSpacing:.4,marginBottom:10}}>
            PROCUREMENT STATUS — ALL POs
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {procStatusBreakdown.map(s=>(
              <div key={s.key} style={{display:'flex',alignItems:'center',gap:6,
                padding:'5px 12px',borderRadius:999,
                background:s.bg,border:`1px solid ${s.color}33`}}>
                <span style={{fontSize:13}}>{s.icon}</span>
                <span style={{fontSize:12,fontWeight:700,color:s.color}}>{s.count}</span>
                <span style={{fontSize:11,color:s.color,fontWeight:600}}>{s.label}</span>
              </div>
            ))}
            <div style={{marginLeft:'auto',fontSize:11,color:'var(--text3)',fontWeight:600}}>
              {allSOs.length} total PO{allSOs.length!==1?'s':''}
            </div>
          </div>
        </div>
      )}

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
          const delayed     = isDelayed(order);
          const isUnseen    = !seenProc.has(order.id);

          // Row accent colour
          const accentCol = hasBlocked?'var(--red)':hasOverdue?'var(--amber,#d97706)':allRcvd?'var(--green)':unPOd.length>0?'var(--amber,#d97706)':'var(--accent)';
          const rowBg     = isUnseen?'#f0f7ff':rowIdx%2===0?'var(--surface)':'var(--surface2)';

          return (
            <React.Fragment key={order.id}>

              {/* ── Summary row ── */}
              <div style={{display:'grid',gridTemplateColumns:'28px 1fr 160px 120px 110px 110px 110px 90px 120px',
                gap:0,padding:'10px 12px',borderBottom:'1px solid var(--border)',
                background:rowBg,
                borderLeft:`3px solid ${accentCol}`,cursor:'pointer',alignItems:'center'}}
                onClick={()=>{ markProcSeen(order.id); setPreviewOrder(order); }}>

                {/* Expand toggle */}
                <div style={{fontSize:13,color:'var(--accent)',fontWeight:700,userSelect:'none'}}>
                  ▸
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
                    onClick={()=>{ if(rowBlocked) return; markProcSeen(order.id); setSelected(order); }}>
                    {rowReadOnly ? '👁 View' : '✏ Manage'}
                  </button>
                    );
                  })()}
                </div>
              </div>

            </React.Fragment>
          );
        })}
      </div>

      {previewOrder&&<OrderProcurementModal
        order={previewOrder} suppliers={suppliers} inventoryItems={inventoryItems} customers={customers} shippers={shippers}
        enquiry={findEnquiry(previewOrder.enquiry_id, previewOrder.enquiry_no)} poMode={poMode}
        readOnly={true}
        onClose={()=>setPreviewOrder(null)}
        onSaved={()=>{ qc.invalidateQueries(['orders']); }}
      />}
      {selected&&<OrderProcurementModal
        order={selected} suppliers={suppliers} inventoryItems={inventoryItems} customers={customers} shippers={shippers}
        readOnly={READ_ONLY_STATUSES.includes(selected.status)}
        enquiry={findEnquiry(selected.enquiry_id, selected.enquiry_no)} poMode={poMode}
        onClose={()=>setSelected(null)} onSaved={()=>{qc.invalidateQueries(['orders']);api.get('/orders/'+selected.id).then(r=>setSelected(r.data)).catch(()=>{});}}/>}
    </div>
  );
}
