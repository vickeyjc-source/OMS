// client/src/pages/OrdersPage.js  v2
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, orderTotal, isDelayed, StatusBadge, DaysBadge, fmtDateTime, HoldBadge, HoldNoteCallout } from '../utils/helpers';
import { printDoc, generateOrderPDF } from '../utils/pdfUtils';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { canAccessSection } from '../utils/sections';

const LINE_STATUS_BADGE = { negotiating:'badge-purple', confirmed:'badge-purple', procurement:'badge-blue', payment:'badge-amber', shipped:'badge-teal', partial_shipped:'badge-teal', delivered_hub:'badge-teal', ready_to_ship:'badge-green', grn_partial:'badge-amber', grn_rejected:'badge-red', delivered:'badge-green', delivered_customer:'badge-green' };

const PAYMENT_TERMS_GROUPS = [
  { group:'Advance Payment', terms:['Advance Payment (AP) – Full payment before shipment','Partial Advance – 30% upfront, 70% on delivery','Partial Advance – 50% upfront, 50% on delivery','Cash in Advance (CIA) – 100% before dispatch','Cash Before Shipment (CBS) – Payment before goods ship','Cash on Delivery (COD)','Cash Against Delivery (CAD)'] },
  { group:'Letter of Credit (LC)', terms:['Letter of Credit (LC)','Irrevocable Letter of Credit','Confirmed Letter of Credit','Sight Letter of Credit','Usance LC – 30 days','Usance LC – 60 days','Usance LC – 90 days'] },
  { group:'Documents & Bill of Exchange', terms:['Documents Against Payment (D/P)','Documents Against Acceptance (D/A)','Bill of Exchange'] },
  { group:'Net Days', terms:['Net 7','Net 15','Net 30','Net 45','Net 60','Net 90','End of Month (EOM)','Net 30 EOM'] },
  { group:'Progress / Milestone', terms:['Progress Payment','Milestone-Based Payment','Stage Payment','Retention Payment'] },
  { group:'Deferred / Consignment', terms:['Consignment','Sale or Return','Deferred Payment'] },
  { group:'Recurring', terms:['Monthly Payment','Quarterly Payment','Annual Prepaid'] },
];

const isFullAdvance = t => t && (
  t.toLowerCase().includes('advance payment') ||
  t.toLowerCase().includes('cash in advance') ||
  t.toLowerCase().includes('cash before shipment') ||
  t.toLowerCase().includes('100%')
);
const isPartialAdvance = t => t && t.toLowerCase().includes('partial advance');

const PAYMENT_METHODS = ['Bank Transfer','Cash','Bank Remittance','NEFT / RTGS','SWIFT / Wire Transfer','UPI','Cheque'];
const BALANCE_TIMINGS = ['On Delivery','Before Delivery','Post Delivery','After 7 Days of Delivery','After 15 Days of Delivery','After 30 Days of Delivery','Against Documents','On Acceptance'];
const LINE_STATUS_LABEL = { negotiating:'Confirmed', confirmed:'Confirmed', procurement:'Procurement', payment:'Payment', shipped:'Shipped', partial_shipped:'Partial Shipped', delivered_hub:'At Hub', ready_to_ship:'Ready to Ship', grn_partial:'GRN Partial', grn_rejected:'GRN Rejected', delivered:'Delivered', delivered_customer:'Delivered' };
const LineStatusBadge = ({ s }) => <span className={`badge ${LINE_STATUS_BADGE[s]||'badge-gray'}`}>{LINE_STATUS_LABEL[s]||s}</span>;

const quoteItemKeys = q => {
  const keys = new Set();
  (q?.notes || '').split('\n').forEach(line => {
    const m = line.match(/^([^:]+):\s*Quote\s+/i);
    if (m) keys.add(m[1].trim().toLowerCase());
  });
  return keys;
};

const setsOverlap = (a, b) => {
  if (!a.size || !b.size) return false;
  for (const key of a) if (b.has(key)) return true;
  return false;
};

function ShipperSelect({ value, onChange, shippers }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('international');
  const qc = useQueryClient();
  const addMutation = useMutation({
    mutationFn: d => api.post('/shippers', d),
    onSuccess: () => { qc.invalidateQueries(['shippers']); setAdding(false); setNewName(''); toast.success('Shipper added'); },
  });
  return (
    <div>
      {adding ? (
        <div className="flex gap-8" style={{marginBottom:6}}>
          <input className="input" placeholder="Shipper name" value={newName} onChange={e=>setNewName(e.target.value)} />
          <select className="input" style={{width:130}} value={newType} onChange={e=>setNewType(e.target.value)}>
            <option value="international">International</option>
            <option value="domestic">Domestic</option>
          </select>
          <button className="btn btn-xs btn-primary" onClick={()=>addMutation.mutate({name:newName,type:newType})}>Add</button>
          <button className="btn btn-xs" onClick={()=>setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <div className="flex gap-8">
          <select className="input" value={value} onChange={e=>onChange(e.target.value)}>
            <option value="">— Select Shipper —</option>
            {['international','domestic'].map(type=>{
              const grp = shippers.filter(s=>s.type===type);
              if (!grp.length) return null;
              return <optgroup key={type} label={type==='international'?'🌐 International':'🇮🇳 Domestic'}>{grp.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>;
            })}
          </select>
          <button className="btn btn-xs" onClick={()=>setAdding(true)}>+ New</button>
        </div>
      )}
    </div>
  );
}

function OrderDetailModal({ order, onClose, suppliers, customers, shippers, enquiries, onRefresh }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const perms = user.perms || {};
  const canEdit = order.created_by === user.id || ['admin','manager'].includes(user.role) || canAccessSection(user, 'procurement-bin');
  const canSeeProcPrice = perms.canSeeProcurementPrice !== false;
  const [editSection, setEditSection] = useState(null);

  const { data: orderFiles=[] } = useQuery({
    queryKey: ['files', 'order', order.id],
    queryFn: () => api.get('/files', { params: { entity_type:'order', entity_id:order.id } }).then(r => r.data),
    staleTime: 0,
    refetchOnMount: true,
  });

  // Customer payments recorded in Finance — used to surface additional charges + grand total
  const { data: customerPayments=[] } = useQuery({
    queryKey: ['customer-pay', order.id],
    queryFn: () => api.get('/finance/customer-pay/' + order.id).then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
    staleTime: 0,
  });
  const paymentCharges = (() => {
    const out = [];
    for (const p of (customerPayments || [])) {
      let charges = [];
      try {
        const raw = p.additional_charges;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
        if (Array.isArray(parsed)) charges = parsed;
      } catch(_) {}
      if (charges.length || p.amount_change_note) {
        out.push({
          paymentId: p.id,
          amount: parseFloat(p.amount) || 0,
          currency: p.currency || 'INR',
          charges,
          chargesTotal: charges.reduce((s,c)=>s+(parseFloat(c.amount)||0),0),
          actualAmount: (p.actual_amount !== undefined && p.actual_amount !== null) ? parseFloat(p.actual_amount) : null,
          note: p.amount_change_note || '',
          ref: p.payment_ref || '',
        });
      }
    }
    return out;
  })();

  const [infoForm, setInfoForm] = useState({ enquiry_no:order.enquiry_no||'', quote_no:order.quote_no||'', tentative_date:order.tentative_date||'', po_number:order.po_number||'', notes:order.notes||'', delivery_address:order.delivery_address||'', allow_partial_shipment:order.allow_partial_shipment||0 });
  const [statusVal, setStatusVal] = useState(order.status);
  const [comment, setComment]     = useState('');
  const [docsForm, setDocsForm]   = useState({...order.documents});
  const [shipForm, setShipForm]   = useState({...order.customerShipping});

  // Payment state for this order
  const [payment, setPayment] = useState(() => {
    try { return JSON.parse(order.notes?.match(/\[PAYMENT:(.*?)\]/)?.[1] || 'null') || {}; } catch(_) { return {}; }
  });
  const [holdDuration, setHoldDuration] = useState({ value:'', unit:'Days' });
  const [showHold, setShowHold]             = useState(false);
  const [showCancel, setShowCancel]         = useState(false);
  const [showProcurement, setShowProcurement] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isOnHold = !!(order.is_on_hold || order.status === 'hold');
  const isOrderClosed = !!(order.closed_at || ['closed', 'cancelled', 'failed', 'delivered'].includes((order.status || '').toLowerCase()));
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdReasonInput, setHoldReasonInput] = useState('');
  const [showUnholdConfirm, setShowUnholdConfirm] = useState(false);

  const [cancelReason, setCancelReason] = useState('');
  const [paymentSaved, setPaymentSaved] = useState(
    order.status !== 'cust_payment_update' && !!order.payment_terms
  );
  const setP = (k,v) => setPayment(p=>({...p,[k]:v}));

  // Customer info
  const custObj  = customers.find(c=>c.id===order.customer_id) || null;
  const custTerms = custObj?.payment_terms || '';
  // Effective terms for this order: stored override or customer default
  const [orderTerms, setOrderTerms]         = useState(order.payment_terms || '');
  const [savedOrderTerms, setSavedOrderTerms] = useState(order.payment_terms || '');
  const [orderTermsComment, setOrderTermsComment] = useState('');
  const effectiveTerms = orderTerms || custTerms;
  const savedEffectiveTerms = savedOrderTerms || custTerms;
  const paymentTermsDirty = orderTerms !== savedOrderTerms;
  const termsChanged   = orderTerms && orderTerms !== custTerms;
  const hasAdvanceTerms = isFullAdvance(savedEffectiveTerms) || isPartialAdvance(savedEffectiveTerms);
  // Once the order has progressed to procurement or beyond, the advance-collection workflow is over.
  // It must NOT be possible to "Send to Finance" again (that would pull the order back out of
  // procurement). Anything that is not a pre-procurement payment stage counts as "past order stage".
  const preOrderStatuses = ['draft','open','payment_approval','waiting_for_payment','cust_payment_update','payment_pending'];
  const isPastOrderStage = !preOrderStatuses.includes(order.status);
  const customerAdvanceReleased = !!order.advance_released || (hasAdvanceTerms &&
    order.status === 'open' &&
    !!order.pi_no &&
    ['pending','paid'].includes(order.customer_payment_status));
  const customerAdvanceComplete = order.customer_payment_status === 'paid';
  const customerAdvancePendingRelease = order.customer_payment_status === 'payment_recorded';
  const customerAdvanceFinanceLocked = order.status === 'payment_approval' || customerAdvancePendingRelease || customerAdvanceReleased || !!order.advance_released || customerAdvanceComplete || isPastOrderStage;

  const mutation = useMutation({
    mutationFn: d => api.put(`/orders/${order.id}`, d).then(r=>r.data),
    onSuccess: () => {
      qc.invalidateQueries(['orders']);
      qc.invalidateQueries(['finance-customer']);
      setEditSection(null);
      toast.success('Saved');
      onRefresh();
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const holdMutation = useMutation({
    mutationFn: reason => api.post(`/orders/${order.id}/hold`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries(['orders']);
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-supplier']);
      toast.success('Order placed on hold');
      setShowHoldModal(false);
      setHoldReasonInput('');
      onRefresh();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to place order on hold')
  });

  const unholdMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/unhold`),
    onSuccess: () => {
      qc.invalidateQueries(['orders']);
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-supplier']);
      toast.success('Order unheld successfully');
      setShowUnholdConfirm(false);
      onRefresh();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to unhold order')
  });

  const cancelMutation = useMutation({
    mutationFn: (reason) => api.post(`/orders/${order.id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries(['orders']);
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-supplier']);
      qc.invalidateQueries(['procurement-bin']);
      toast.success('Order cancelled successfully');
      setShowCancel(false);
      setCancelReason('');
      onClose();
      onRefresh();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to cancel order')
  });

  const [itemCancelModal, setItemCancelModal] = useState(null);
  const [cancelReasonModal, setCancelReasonModal] = useState(null);
  const [itemCancelReason, setItemCancelReason] = useState('');

  const itemCancelMutation = useMutation({
    mutationFn: ({ itemId, reason }) => api.post(`/orders/${order.id}/items/${itemId}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries(['orders']);
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-supplier']);
      qc.invalidateQueries(['procurement-bin']);
      toast.success('Item cancelled');
      setItemCancelModal(null);
      setItemCancelReason('');
      onRefresh();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to cancel item')
  });

  const sup = id => suppliers.find(s=>s.id===id);
  const custName = id => customers.find(c=>c.id===id)?.name || (perms.canSeeCustomer===false?'[Restricted]':id);
  const shipperName = id => shippers.find(s=>s.id===id)?.name || '—';

  // Check e-way bill requirement
  const cust = customers.find(c=>c.id===order.customer_id);
  const totalInr = (order.lineItems||[]).filter(i=>i.currency==='INR').reduce((s,i)=>s+(i.qty*i.unit_price),0);
  const needsEway = cust?.country==='India' && totalInr > 50000;
  const enquiry = enquiries.find(e => e.id === order.enquiry_id) || null;
  const enquiryItems = enquiry?.items || [];
  const sourcingRows = enquiry?.sourcing || [];

  // Compute base value and total value per currency across all line items
  const fmtAmt = (n, cur) => {
    const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'};
    return (sym[cur]||cur+' ') + (Math.round(n*100)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  };
  const getSourceContext = (li) => {
    const so = (order.supplierOrders||[]).find(s => (s.items||[]).includes(li.id));
    const enqItem = enquiryItems.find(ei => ei.id === li.id || ei.component === li.component);
    const srcRow = sourcingRows.find(s => s.enquiry_item_id === li.id)
      || (enqItem ? sourcingRows.find(s => s.enquiry_item_id === enqItem.id) : null);
    const unitSource = Number(srcRow?.sourced_price) || Number(li.procurement_price) || Number(so?.buying_price_per_unit) || 0;
    return { so, srcRow, unitSource };
  };
  const liSourceByCur = {};
  const liBaseByCur = {};
  const liTaxByCur = {};
  const liTotalByCur = {};
  const cancelledByCur = {};
  (order.lineItems||[]).forEach(li => {
    const qty  = Number(li.qty)||0;
    const up   = Number(li.unit_price)||0;
    const tax  = Number(li.tax_rate)||0;
    const base = qty * up;
    const taxAmt = base * tax / 100;
    const tot  = base + taxAmt;
    const c    = li.currency || 'INR';
    if (li.line_status === 'cancelled') {
      cancelledByCur[c] = (cancelledByCur[c] || 0) + tot;
      return;
    }
    const { unitSource } = getSourceContext(li);
    const srcTotal = qty * unitSource;
    liSourceByCur.INR = (liSourceByCur.INR || 0) + srcTotal;
    liBaseByCur[c]  = (liBaseByCur[c] ||0) + base;
    liTaxByCur[c]   = (liTaxByCur[c]  ||0) + taxAmt;
    liTotalByCur[c] = (liTotalByCur[c]||0) + tot;
  });
  const hasTax = Object.keys(liTotalByCur).some(c => Math.abs(liTotalByCur[c]-liBaseByCur[c]) > 0.001);

  const flowNodes = [
    {key:'enquiry',     label:'Enquiry',          icon:'📩'},
    {key:'quote',       label:'Quote',             icon:'📄'},
    {key:'order',       label:'Order',             icon:'📋'},
    {key:'procurement', label:'Procurement',       icon:'🛒'},
    {key:'shipped',     label:'Shipped',           icon:'🚢'},
    {key:'delivered_hub',label:'Delivered Hub',   icon:'🏭'},
    {key:'delivered',   label:'Delivered Customer',icon:'✅'},
    {key:'closed',      label:'Closed',            icon:'🔒'},
  ];
  const nc = key => {
    const s = order.status;
    if (key==='enquiry'    && order.enquiry_no) return 'fn-done';
    if (key==='quote'      && order.quote_no)   return 'fn-done';
    // Order node — active once order exists (always, since we're viewing it)
    if (key==='order') return ['procurement','shipped','delivered_hub','delivered','closed'].includes(s)?'fn-done':s==='hold'?'fn-warn':s==='failed'?'fn-fail':'fn-active';
    const allProcured = (order.lineItems||[]).every(l=>['procurement','payment','shipped','delivered'].includes(l.line_status));
    if (key==='procurement') return s==='closed'||s==='delivered'?'fn-done':s==='procurement'?'fn-active':allProcured?'fn-done':'';
    const allShipped = (order.lineItems||[]).every(l=>['shipped','delivered'].includes(l.line_status));
    if (key==='shipped')      return allShipped?'fn-done':allProcured&&s==='procurement'?'fn-active':'';
    if (key==='delivered_hub')return ['delivered_hub','delivered','closed'].includes(s)?'fn-done':allShipped?'fn-active':'';
    if (key==='delivered')    return ['delivered','closed'].includes(s)?'fn-done':s==='delivered_hub'?'fn-active':s==='failed'?'fn-fail':'';
    if (key==='closed')       return s==='closed'?'fn-done':'';
    return '';
  };

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <div style={{display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}>
              <h2 style={{marginBottom:0}}>{order.id}</h2>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:4}}>
              {order.enquiry_no && <><span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,padding:'2px 8px',borderRadius:6,background:'var(--surface2)',color:'var(--text2)',border:'1px solid var(--border)'}}>ENQ: {order.enquiry_no}</span><span style={{fontSize:11,color:'var(--text3)'}}>→</span></>}
              {order.quote_no && <><span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,padding:'2px 8px',borderRadius:6,background:'var(--surface2)',color:'var(--text2)',border:'1px solid var(--border)'}}>QT: {order.quote_no}</span><span style={{fontSize:11,color:'var(--text3)'}}>→</span></>}
              <span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,padding:'2px 8px',borderRadius:6,background:'var(--accent-lt)',color:'var(--accent)',border:'1px solid var(--accent)33'}}>Order: {order.id}</span>
              {order.po_number && <><span style={{fontSize:11,color:'var(--text3)'}}>· PO:</span><span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,color:'var(--text2)'}}>{order.po_number}</span></>}
            </div>
            {perms.canSeeCustomer!==false && (
              <div style={{marginTop:4,display:'flex',alignItems:'baseline',gap:8}}>
                <span style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>{custName(order.customer_id)}</span>
                <span style={{fontSize:11,color:'var(--text3)'}}>· Created {fmtDateTime(order.created_at)}</span>
              </div>
            )}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,marginRight:14}}>
            <StatusBadge s={order.status}/>
          </div>
        </div>
        <div className="modal-body">

          {/* Prominent On-Hold Alert Banner */}
          {isOnHold && (
            <div style={{
              background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
              border: '1.5px solid var(--amber, #d97706)',
              borderRadius: 'var(--r, 8px)',
              padding: '14px 18px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              boxShadow: '0 2px 10px rgba(217, 119, 6, 0.12)'
            }}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>⏸</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#92400e', fontSize: 15, letterSpacing: '.2px' }}>THIS ORDER IS ON HOLD</strong>
                  <span style={{
                    fontSize: 10,
                    background: 'var(--amber, #d97706)',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontWeight: 800,
                    letterSpacing: 0.5
                  }}>LOCKED</span>
                </div>
                <div style={{ marginTop: 5, fontSize: 13, color: '#78350f', fontWeight: 600 }}>
                  <strong>Why on Hold:</strong> "{order.hold_reason || 'No reason specified'}"
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#b45309' }}>
                  Placed on hold by <strong>{order.hold_by || 'Admin'}</strong> {order.hold_at ? `on ${fmtDateTime(order.hold_at) || order.hold_at}` : ''} • Previous Status: <strong>{order.hold_prev_status || 'Open'}</strong>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#92400e', fontStyle: 'italic' }}>
                  All operations in Procurement, Delivery Hub, and Finance are locked for this order. Click "Unhold Order" below to resume normal operations.
                </div>
              </div>
            </div>
          )}

          {/* Order Cancelled banner */}
          {order.status === 'cancelled' && (
            <div style={{
              background: 'var(--red-lt, #fef2f2)',
              border: '2px solid var(--red, #dc2626)',
              borderRadius: 'var(--r, 8px)',
              padding: '12px 16px',
              marginBottom: 14,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start'
            }}>
              <div style={{ fontSize: 24, lineHeight: 1 }}>🚫</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--red, #dc2626)' }}>
                    ORDER CANCELLED
                  </span>
                  <span style={{
                    fontSize: 10,
                    background: 'var(--red, #dc2626)',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontWeight: 800,
                    letterSpacing: 0.5
                  }}>CANCELLED</span>
                </div>
                <div style={{ marginTop: 5, fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
                  <strong>Why Cancelled:</strong> "{order.cancel_reason || 'No cancellation reason specified'}"
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c' }}>
                  Cancelled by <strong>{order.cancelled_by || 'Admin'}</strong> {order.cancelled_at ? `on ${fmtDateTime(order.cancelled_at) || order.cancelled_at}` : ''}
                  {order.settlement_status === 'pending' && (
                    <span style={{ marginLeft: 8, padding: '1px 6px', background: '#fee2e2', borderRadius: 4, fontWeight: 700 }}>
                      💳 Finance Settlement Pending (₹{(parseFloat(order.unsettled_amount)||0).toFixed(2)})
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#7f1d1d', fontStyle: 'italic' }}>
                  This entire order has been cancelled and stopped across Procurement, Delivery Hub, and Finance.
                </div>
              </div>
            </div>
          )}

          {/* Flow tracker */}
          <div className="flow-track">
            {flowNodes.map(n=><div key={n.key} className={`flow-node ${nc(n.key)}`}><div className="fn-icon">{n.icon}</div><div>{n.label}</div></div>)}
          </div>

          {/* ── Customer Info Strip ── */}
          {custObj && (
            <div style={{display:'flex',gap:20,flexWrap:'wrap',alignItems:'center',
              background:'var(--accent-lt)',border:'1px solid var(--accent)33',
              borderRadius:'var(--r-sm)',padding:'10px 16px',marginBottom:10,fontSize:13}}>
              <div>
                <div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>CUSTOMER</div>
                <div style={{fontWeight:700}}>{custObj.name}</div>
              </div>
              {custObj.customer_no&&(
                <div>
                  <div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>CUST NO.</div>
                  <div className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{custObj.customer_no}</div>
                </div>
              )}
              <div>
                <div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>DEFAULT PAYMENT TERMS</div>
                <div style={{fontWeight:600,color:isFullAdvance(custTerms)||isPartialAdvance(custTerms)?'var(--amber,#d97706)':'var(--text)'}}>{custTerms||'—'}</div>
              </div>
              {order.po_number&&<div><div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>PO</div><div className="mono" style={{fontWeight:600}}>{order.po_number}</div></div>}
              {order.enquiry_no&&<div><div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>ENQUIRY</div><div className="mono">{order.enquiry_no}</div></div>}
              {order.quote_no&&<div><div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>QUOTE</div><div className="mono">{order.quote_no}</div></div>}
              {order.tentative_date&&<div><div style={{fontSize:10,color:'var(--text3)',fontWeight:700}}>DUE DATE</div><div style={{fontWeight:600,color:isDelayed(order)?'var(--red)':'inherit'}}>{order.tentative_date}{isDelayed(order)?' ⚠':''}</div></div>}
            </div>
          )}

          {/* ── Payment Terms for this Order ── */}
          {canEdit && (
            <div className="card card-sm" style={{marginBottom:14}}>
              <div className="card-title">
                <span>💳 Payment Terms{paymentSaved&&savedEffectiveTerms?<span style={{marginLeft:8,fontSize:11,color:'var(--green)',fontWeight:600}}>✅ Saved — {savedEffectiveTerms}</span>:''}</span>
                <span style={{fontSize:13,color:'var(--text3)'}}>{paymentSaved?'🔒 Locked':'▾'}</span>
              </div>
              {paymentSaved && effectiveTerms ? null : <>
              <div style={{display:'grid',gridTemplateColumns:'2fr 2fr',gap:12,marginBottom:effectiveTerms?12:0}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Terms for this Order
                    {custTerms&&!orderTerms&&<span style={{marginLeft:8,fontSize:11,color:'var(--text3)'}}>Using customer default</span>}
                  </label>
                  <select className="input" value={orderTerms} onChange={e=>setOrderTerms(e.target.value)}>
                    <option value="">— Use Customer Default ({custTerms||'None'}) —</option>
                    {PAYMENT_TERMS_GROUPS.map(g=>(
                      <optgroup key={g.group} label={g.group}>
                        {g.terms.map(t=><option key={t} value={t}>{t}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <div style={{fontSize:10,color:'var(--text3)',marginTop:4}}>
                    Applies only to this order. Customer default remains unchanged.
                  </div>
                </div>
                {termsChanged&&(
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label" style={{color:'var(--amber,#d97706)',fontWeight:700}}>Override note (optional)</label>
                    <input className="input" value={orderTermsComment} onChange={e=>setOrderTermsComment(e.target.value)}
                      placeholder="e.g. Customer requested extended terms…"
                      style={{borderColor:'var(--amber,#d97706)'}}/>
                  </div>
                )}
              </div>

              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
                <button className="btn btn-sm btn-primary"
                  disabled={mutation.isPending || !paymentTermsDirty}
                  onClick={async()=>{
                    const previousSavedTerms = savedOrderTerms;
                    setSavedOrderTerms(orderTerms);
                    setPaymentSaved(true);
                    try {
                      const effectiveOrderTerms = orderTerms || custTerms || '';
                      await mutation.mutateAsync({
                        payment_terms: effectiveOrderTerms,
                        _action: 'Customer payment terms updated',
                        _comment: orderTermsComment.trim(),
                      });
                    } catch(_) {
                      setSavedOrderTerms(previousSavedTerms);
                      setPaymentSaved(false);
                    }
                  }}>
                  {mutation.isPending ? 'Saving…' : paymentTermsDirty ? '💾 Save Payment Terms' : '✅ Terms Saved'}
                </button>
              </div>
            </>}

              {/* OPTION A: Advance/Partial payment panels moved to Finance page */}
              {/* Original full + partial advance panels preserved below as comments — DO NOT DELETE */}
              {(isFullAdvance(savedEffectiveTerms)||isPartialAdvance(savedEffectiveTerms)) && (
                <div style={{marginTop:8,padding:'12px 16px',borderRadius:'var(--r)',
                  background: (customerAdvanceReleased || customerAdvanceComplete) ? 'var(--green-lt,#f0fdf4)' : customerAdvancePendingRelease ? 'var(--purple-lt,#f5f3ff)' : 'var(--amber-lt,#fffbeb)',
                  border: `2px solid ${(customerAdvanceReleased || customerAdvanceComplete) ? 'var(--green)' : customerAdvancePendingRelease ? 'var(--purple,#7c3aed)' : 'var(--amber,#d97706)'}`,
                  display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:(customerAdvanceReleased || customerAdvanceComplete) ? 'var(--green)' : customerAdvancePendingRelease ? 'var(--purple,#7c3aed)' : 'var(--amber,#d97706)'}}>
                      {(customerAdvanceReleased || customerAdvanceComplete)
                        ? '✅ Advance Payment Released'
                        : customerAdvancePendingRelease
                        ? '⏳ Payment Recorded — Awaiting Finance Release'
                        : '💰 Advance Payment Required'}
                    </div>
                    <div style={{fontSize:12,color:'var(--text2)',marginTop:3}}>
                      {(customerAdvanceReleased || customerAdvanceComplete)
                        ? `Advance payment has been verified and released by Finance. Order is ready to proceed to Procurement.${customerAdvanceReleased && order.customer_payment_status !== 'paid' ? ' Remaining balance will be collected on delivery.' : ''}`
                        : customerAdvancePendingRelease
                        ? 'Customer payment has been recorded in Finance and is awaiting release confirmation before moving to Procurement.'
                        : `${isFullAdvance(savedEffectiveTerms) ? 'Full advance payment' : 'Partial advance payment'} must be collected before this order goes to Procurement. Go to the Finance page to raise a PI and record payment.`}
                    </div>
                  </div>
                  <button className="btn btn-sm"
                    disabled={paymentTermsDirty || customerAdvanceFinanceLocked}
                    style={{
                      background: (customerAdvanceReleased || customerAdvanceComplete) ? 'var(--green)' : customerAdvancePendingRelease ? 'var(--purple,#7c3aed)' : 'var(--amber,#d97706)',
                      color:'#fff',
                      borderColor: (customerAdvanceReleased || customerAdvanceComplete) ? 'var(--green)' : customerAdvancePendingRelease ? 'var(--purple,#7c3aed)' : 'var(--amber,#d97706)',
                      fontWeight:700,whiteSpace:'nowrap',
                      opacity:(paymentTermsDirty || customerAdvanceFinanceLocked) ? 0.6 : 1,
                      cursor:(paymentTermsDirty || customerAdvanceFinanceLocked) ? 'not-allowed' : 'pointer'}}
                    title={paymentTermsDirty ? 'Save payment terms first' : customerAdvanceReleased ? 'Advance released by Finance' : customerAdvanceComplete ? 'Payment already received' : customerAdvancePendingRelease ? 'Payment recorded in Finance — awaiting release' : order.status === 'payment_approval' ? 'Already sent to Finance' : ''}
                    onClick={async()=>{
                      if (paymentTermsDirty || customerAdvanceFinanceLocked) return;
                      try {
                        await mutation.mutateAsync({
                          status:                  'payment_approval',
                          payment_terms:           savedEffectiveTerms || '',
                          customer_payment_status: 'pending',
                          _action: 'Sent to Finance for advance payment collection',
                          _comment: '',
                        });
                      } catch(_) {}
                    }}>
                    {(customerAdvanceReleased || customerAdvanceComplete)
                      ? '✅ Released by Finance'
                      : customerAdvancePendingRelease
                      ? '⏳ Awaiting Release'
                      : order.status === 'payment_approval'
                      ? '💰 Sent to Finance'
                      : '💰 Send to Finance'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Line Items */}
          <div className="card card-sm">
            <div className="card-title">
              <span>📦 Line Items ({order.lineItems?.length||0})</span>
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="li-table">
                <thead>
                  <tr>
                    <th>#</th><th>Component</th><th>IPN</th><th>Manufacturer</th>
                    <th>Qty</th>
                    {canSeeProcPrice&&<th>Source Price</th>}
                    {canSeeProcPrice&&<th style={{textAlign:'right'}}>Source Total</th>}
                    <th>Customer Price</th>
                    <th style={{textAlign:'right'}}>Cust. Base Value</th>
                    <th style={{textAlign:'right',color:'var(--teal,#0d9488)'}}>Tax %</th>
                    <th style={{textAlign:'right',color:'var(--teal,#0d9488)'}}>Tax Amt</th>
                    <th style={{textAlign:'right'}}>Customer Total</th>
                    <th>Delivery Date</th><th>Status</th>
                    {canEdit && !isOrderClosed && !isOnHold && <th style={{textAlign:'right'}}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems?.map((li,i)=>{
                    const isCancelled = li.line_status === 'cancelled';
                    const { unitSource } = getSourceContext(li);
                    const sourceTotal = (Number(li.qty)||0) * unitSource;
                    const base = (Number(li.qty)||0) * (Number(li.unit_price)||0);
                    const taxRate = Number(li.tax_rate)||0;
                    const taxAmt = base * (taxRate / 100);
                    const tot = base + taxAmt;
                    return (
                    <tr key={li.id} style={{
                      background: isCancelled ? 'var(--red-lt, #fef2f2)' : undefined,
                      opacity: isCancelled ? 0.85 : 1
                    }}>
                      <td>{i+1}</td>
                      <td className="bold" style={{textDecoration: isCancelled ? 'line-through' : 'none', color: isCancelled ? 'var(--text3)' : 'inherit'}}>
                        {li.component}
                      </td>
                      <td className="mono" style={{textDecoration: isCancelled ? 'line-through' : 'none'}}>{li.ipn||'—'}</td>
                      <td style={{textDecoration: isCancelled ? 'line-through' : 'none'}}>{li.manufacturer||'—'}</td>
                      <td style={{textDecoration: isCancelled ? 'line-through' : 'none'}}>{fmt(li.qty)}</td>
                      {canSeeProcPrice&&<td className="mono">{unitSource ? fmtAmt(unitSource, 'INR') : '—'}</td>}
                      {canSeeProcPrice&&(
                        <td style={{textAlign:'right'}}>
                          {sourceTotal
                            ? <span style={{fontWeight:600,fontSize:12,textDecoration: isCancelled ? 'line-through' : 'none'}}>{fmtAmt(sourceTotal, 'INR')}</span>
                            : <span style={{color:'var(--text3)'}}>—</span>}
                        </td>
                      )}
                      <td className="mono" style={{textDecoration: isCancelled ? 'line-through' : 'none'}}>{fmtCur(li.unit_price,li.currency)}</td>
                      <td style={{textAlign:'right',fontFamily:'monospace',textDecoration: isCancelled ? 'line-through' : 'none'}}>
                        {base ? fmtAmt(base, li.currency) : '—'}
                      </td>
                      <td style={{textAlign:'right',fontSize:12}}>
                        {taxRate}%
                      </td>
                      <td style={{textAlign:'right',fontSize:12,fontFamily:'monospace',color:'var(--teal,#0d9488)'}}>
                        {taxRate>0
                          ? <span style={{textDecoration: isCancelled ? 'line-through' : 'none'}}>{fmtAmt(taxAmt, li.currency)}</span>
                          : <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {(() => {
                          if (!base) return <span style={{color:'var(--text3)'}}>—</span>;
                          return (
                            <div style={{padding:'2px 6px',background:isCancelled?'#fee2e2':taxRate>0?'var(--green-lt)':'transparent',
                              borderRadius:'var(--r-sm)',fontWeight:700,fontSize:12,
                              textDecoration: isCancelled ? 'line-through' : 'none',
                              color:isCancelled?'var(--red,#dc2626)':taxRate>0?'var(--green)':'var(--text)'}}>
                              {fmtAmt(tot,li.currency)}
                            </div>
                          );
                        })()}
                      </td>
                      <td>{li.delivery_date||'—'}</td>
                      <td>
                        <div style={{display:'inline-flex',alignItems:'center',gap:4}}>
                          <LineStatusBadge s={li.line_status}/>
                          {isCancelled && (
                            <button type="button" className="btn btn-xs"
                              style={{padding:'1px 5px',borderRadius:99,fontSize:10,background:'#fee2e2',color:'var(--red,#dc2626)',borderColor:'var(--red,#dc2626)',fontWeight:800,cursor:'pointer'}}
                              onClick={(e)=>{e.stopPropagation();setCancelReasonModal(li);}}
                              title="Click to view cancellation reason">
                              ℹ️
                            </button>
                          )}
                        </div>
                      </td>
                      {canEdit && !isOrderClosed && !isOnHold && (
                        <td style={{textAlign:'right'}}>
                          {!isCancelled && (
                            <button className="btn btn-xs"
                              style={{color:'var(--red)',borderColor:'var(--red-lt,#fef2f2)',background:'var(--red-lt,#fef2f2)',fontWeight:600}}
                              onClick={()=>setItemCancelModal({ item: li })}
                              title="Cancel this item">
                              ✕ Cancel
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                  <tr style={{background:'var(--surface2)',fontWeight:700}}>
                    <td colSpan={canSeeProcPrice?6:5} style={{textAlign:'right',fontSize:12,color:'var(--text2)'}}>TOTALS (Active Items)</td>
                    {canSeeProcPrice&&(
                      <td style={{textAlign:'right'}}>
                        {Object.entries(liSourceByCur).map(([c,v])=>(
                          <div key={c} style={{fontSize:14,fontWeight:800,color:'var(--accent)'}}>{fmtAmt(v,c)}</div>
                        ))}
                      </td>
                    )}
                    <td/>
                    <td style={{textAlign:'right'}}>
                      {Object.entries(liBaseByCur).map(([c,v])=>(
                        <div key={c} style={{fontSize:14,fontWeight:800,color:'var(--text)'}}>{fmtAmt(v,c)}</div>
                      ))}
                    </td>
                    <td/>
                    <td style={{textAlign:'right'}}>
                      {Object.entries(liTaxByCur).map(([c,v])=>(
                        <div key={c} style={{fontSize:13,fontWeight:700,color:'var(--teal,#0d9488)'}}>{fmtAmt(v,c)}</div>
                      ))}
                    </td>
                    <td style={{textAlign:'right'}}>
                      {Object.entries(liTotalByCur).map(([c,v])=>(
                        <div key={c} style={{fontSize:14,fontWeight:800,
                          color:hasTax?'var(--green)':'var(--accent)',
                          background:hasTax?'var(--green-lt)':'transparent',
                          padding:hasTax?'3px 6px':'0',borderRadius:'var(--r-sm)'}}>{fmtAmt(v,c)}</div>
                      ))}
                    </td>
                    <td colSpan={canEdit && !isOrderClosed && !isOnHold ? 3 : 2}/>
                  </tr>
                  {Object.keys(cancelledByCur).length > 0 && (
                    <tr style={{background:'var(--red-lt,#fef2f2)',fontSize:11,color:'var(--red,#dc2626)'}}>
                      <td colSpan={canSeeProcPrice?11:8} style={{textAlign:'right',fontWeight:600}}>
                        🚫 Cancelled Items Excluded:
                      </td>
                      <td style={{textAlign:'right',fontWeight:700,fontFamily:'monospace'}}>
                        {Object.entries(cancelledByCur).map(([c,v])=>(
                          <span key={c} style={{textDecoration:'line-through',marginLeft:6}}>{fmtAmt(v,c)}</span>
                        ))}
                      </td>
                      <td colSpan={canEdit && !isOrderClosed && !isOnHold ? 3 : 2}/>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Additional Charges (recorded with customer payment in Finance) ── */}
          {paymentCharges.length > 0 && (
            <div className="card card-sm">
              <div className="card-title">
                <span>💰 Additional Charges &amp; Grand Total</span>
              </div>
              <div style={{display:'grid',gap:10}}>
                {paymentCharges.map((pc,idx)=>(
                  <div key={pc.paymentId||idx} style={{padding:'10px 12px',border:'1px solid var(--border)',
                    borderRadius:'var(--r-sm)',background:'var(--surface2)',fontSize:12}}>
                    {pc.ref && <div style={{fontSize:11,color:'var(--text3)',marginBottom:6}}>Payment Ref: {pc.ref}</div>}
                    <div style={{display:'flex',justifyContent:'space-between',gap:12,marginBottom:4}}>
                      <span>Base amount</span>
                      <strong style={{fontFamily:'monospace'}}>{fmtAmt(pc.amount - pc.chargesTotal, pc.currency)}</strong>
                    </div>
                    {pc.charges.map((c,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',gap:12,color:'var(--amber,#d97706)',fontWeight:600,marginBottom:2}}>
                        <span>+ {c.name}</span>
                        <span style={{fontFamily:'monospace'}}>{fmtAmt(c.amount, pc.currency)}</span>
                      </div>
                    ))}
                    <div style={{display:'flex',justifyContent:'space-between',gap:12,paddingTop:6,marginTop:4,
                      borderTop:'1px solid var(--border)',fontSize:13}}>
                      <span style={{fontWeight:700}}>{pc.chargesTotal > 0 ? 'Grand total (incl. charges)' : 'Total'}</span>
                      <strong style={{color:'var(--green)',fontFamily:'monospace'}}>{fmtAmt(pc.amount, pc.currency)}</strong>
                    </div>
                    {pc.actualAmount !== null && Math.abs(pc.actualAmount - pc.amount) > 0.009 && (
                      <div style={{display:'flex',justifyContent:'space-between',gap:12,marginTop:4}}>
                        <span style={{color:'var(--green)'}}>Actual received</span>
                        <strong style={{color:'var(--green)',fontFamily:'monospace'}}>{fmtAmt(pc.actualAmount, pc.currency)}</strong>
                      </div>
                    )}
                    {pc.note && (
                      <div style={{marginTop:4,fontSize:11,color:'var(--red)',fontStyle:'italic'}}>
                        Note: {pc.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Order Info — single horizontal strip ── */}
          <div className="card card-sm" style={{marginBottom:14}}>
            <div className="card-title">
              <span>📋 Order Info</span>
              {canEdit && !isOnHold && <button className="btn btn-xs" onClick={()=>setEditSection(editSection==='info'?null:'info')}>{editSection==='info'?'Cancel':'Edit'}</button>}
              {canEdit && isOnHold && <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>🔒 Locked (On Hold)</span>}
            </div>
            {editSection==='info' ? (
              <div>
                {order.customer_payment_status !== 'paid' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,marginBottom:10}}>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">PO Number</label>
                    <input className="input" value={infoForm.po_number} disabled style={{opacity:.72,background:'var(--surface2)'}}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">Enquiry No.</label>
                    <input className="input" value={infoForm.enquiry_no} disabled style={{opacity:.72,background:'var(--surface2)'}}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">Quote No.</label>
                    <input className="input" value={infoForm.quote_no} disabled style={{opacity:.72,background:'var(--surface2)'}}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}><label className="label">Expected Delivery Date</label><input className="input" type="date" value={infoForm.tentative_date} onChange={e=>setInfoForm(f=>({...f,tentative_date:e.target.value}))}/></div>
                </div>
                )}
                {order.customer_payment_status !== 'paid' && (
                <div className="form-group" style={{marginBottom:10}}><label className="label">Notes</label><textarea className="input" rows={2} value={infoForm.notes} onChange={e=>setInfoForm(f=>({...f,notes:e.target.value}))}/></div>
                )}
                {/* Delivery address — pick from customer's shipping addresses */}
                {(()=>{
                  let addrs=[];
                  try{addrs=JSON.parse(custObj?.shipping_addresses||'[]');}catch(_){}
                  return addrs.length>0&&(
                    <div className="form-group" style={{marginBottom:10}}>
                      <label className="label">Delivery Address</label>
                      <select className="input" value={infoForm.delivery_address||''}
                        onChange={e=>setInfoForm(f=>({...f,delivery_address:e.target.value}))}>
                        <option value="">— Select shipping address —</option>
                        {addrs.map((a,i)=>{
                          const str=[a.attention,a.street1,a.city,a.state,a.pincode].filter(Boolean).join(', ');
                          return <option key={i} value={str}>{str}</option>;
                        })}
                      </select>
                    </div>
                  );
                })()}
                {/* Shipment mode toggle — isolated addition */}
                {order.customer_payment_status !== 'paid' && (
                <div style={{padding:'12px 14px',borderRadius:'var(--r-sm)',
                  background:'var(--surface2)',border:'1px solid var(--border)',marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text2)'}}>📦 Shipment Mode</div>
                  <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                    <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12}}>
                      <input type="radio" name={`shipmode_${order.id}`}
                        checked={!infoForm.allow_partial_shipment}
                        onChange={()=>setInfoForm(f=>({...f,allow_partial_shipment:0}))}
                        style={{accentColor:'var(--accent)'}}/>
                      Full Order Only
                    </label>
                    <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12}}>
                      <input type="radio" name={`shipmode_${order.id}`}
                        checked={!!infoForm.allow_partial_shipment}
                        onChange={()=>setInfoForm(f=>({...f,allow_partial_shipment:1}))}
                        style={{accentColor:'var(--teal,#0d9488)'}}/>
                      Partial Shipments OK
                    </label>
                  </div>
                </div>
                )}
                <div className="flex gap-8"><button className="btn btn-sm" onClick={()=>setEditSection(null)}>Cancel</button><button className="btn btn-sm btn-primary" onClick={()=>mutation.mutate({...infoForm,_action:'Order info updated',_comment:''})}>Save</button></div>
              </div>
            ) : (
              <div style={{display:'flex',flexWrap:'wrap',gap:24,alignItems:'center'}}>
                {[
                  {l:'PO Number',  v:order.po_number,     mono:true, bold:true},
                  {l:'Enquiry',    v:order.enquiry_no,    mono:true},
                  {l:'Quote',      v:order.quote_no,      mono:true},
                  {l:'Delivery',   v:order.tentative_date,color:isDelayed(order)?'var(--red)':undefined, suffix:isDelayed(order)?' ⚠':''},
                  {l:'Status',     v:null, badge:true},
                  {l:'Created',    v:fmtDateTime(order.created_at)},
                ].map(f=>(
                  <div key={f.l}>
                    <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:2}}>{f.l.toUpperCase()}</div>
                    {f.badge
                      ? <StatusBadge s={order.status}/>
                      : <div style={{fontSize:13,fontWeight:f.bold?700:500,fontFamily:f.mono?'DM Mono,monospace':'inherit',color:f.color||'var(--text)'}}>{f.v||'—'}{f.suffix||''}</div>
                    }
                  </div>
                ))}
                {/* Delivery address — live check against current customer addresses */}
                {(()=>{
                  const savedAddr = order.delivery_address;
                  let addrs=[];
                  try{addrs=JSON.parse(custObj?.shipping_addresses||'[]');}catch(_){}
                  // Check if saved address still exists in customer record
                  const addrStillValid = !savedAddr || addrs.some(a=>{
                    const str=[a.attention,a.street1,a.city,a.state,a.pincode].filter(Boolean).join(', ');
                    return str===savedAddr;
                  });
                  return (
                    <div style={{minWidth:200}}>
                      <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:2}}>DELIVERY ADDRESS</div>
                      {savedAddr
                        ? <div style={{fontSize:12,fontWeight:500,color:addrStillValid?'var(--text)':'var(--red)'}}>
                            {savedAddr}
                            {!addrStillValid&&<div style={{fontSize:10,color:'var(--red)',fontWeight:600}}>⚠ Address removed from customer — please update</div>}
                          </div>
                        : <div style={{fontSize:12,color:'var(--text3)'}}>—
                            {addrs.length>0&&<span style={{fontSize:10,color:'var(--accent)',marginLeft:6,cursor:'pointer'}}
                              onClick={()=>setEditSection('info')}>(Edit to add)</span>}
                          </div>
                      }
                    </div>
                  );
                })()}
              </div>
            )}
          </div>


          {/* Stored files */}
          <div className="card card-sm">
            <div className="card-title"><span>📎 Stored Files</span></div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {orderFiles.map(f => (
                <div key={f.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--surface2)'}}>
                  <span style={{fontSize:14}}>📄</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.original_name}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{f.field_name || 'file'} · {f.size_bytes ? (Number(f.size_bytes)/1024).toFixed(1)+' KB' : '—'}</div>
                  </div>
                  <a className="btn btn-xs" href={f.download_url} target="_blank" rel="noreferrer">Download</a>
                  <button className="btn btn-xs" style={{color:'var(--red)',borderColor:'var(--red)',fontWeight:600}}
                    onClick={async()=>{
                      if (!window.confirm(`Delete "${f.original_name}"?`)) return;
                      try {
                        await api.delete('/files/' + f.id);
                        qc.invalidateQueries({ queryKey: ['files','order',order.id] });
                        toast.success('File deleted');
                      } catch(e) { toast.error(e.response?.data?.error||'Delete failed'); }
                    }}>🗑 Delete</button>
                </div>
              ))}
              {orderFiles.length === 0 && <div style={{fontSize:12,color:'var(--text3)',padding:'6px 0'}}>No files uploaded yet.</div>}
              {/* Upload new file */}
              {!isOnHold && (
                <div style={{marginTop:6}}>
                  <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,
                  padding:'6px 12px',borderRadius:'var(--r-sm)',border:'1.5px dashed var(--border)',
                  background:'var(--surface)',color:'var(--text2)',fontWeight:500}}>
                  <span>📤 Upload File</span>
                  <input type="file" style={{display:'none'}}
                    onChange={async e => {
                      const file = e.target.files[0]; if (!file) return;
                      const duplicate = orderFiles.find(f => f.original_name === file.name);
                      if (duplicate) { toast.error(`A file named "${file.name}" already exists. Rename it before uploading.`); e.target.value=''; return; }
                      const formData = new FormData();
                      formData.append('file', file);
                      formData.append('entity_type', 'order');
                      formData.append('entity_id', order.id);
                      formData.append('field_name', 'po_file');
                      try {
                        await api.post('/files', formData, { headers:{'Content-Type':'multipart/form-data'}, timeout:120000 });
                        qc.invalidateQueries({ queryKey: ['files','order',order.id] });
                        toast.success('File uploaded');
                      } catch(err) { toast.error(err.response?.data?.error||'Upload failed'); }
                      e.target.value = '';
                    }}/>
                </label>
              </div>
              )}
            </div>
          </div>

                    {/* History */}
          <div className="card card-sm">
            <div className="card-title" onClick={()=>setShowHistory(h=>!h)}
              style={{cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center'}}>
              <span>🕐 Audit History</span>
              <span style={{marginLeft:'auto',fontSize:12,color:'var(--text3)',
                display:'inline-block',transition:'transform .2s',
                transform:showHistory?'rotate(90deg)':'rotate(0deg)'}}>▶</span>
            </div>
            {showHistory && (
              <div className="timeline" style={{maxHeight:260,overflowY:'auto',paddingRight:4}}>
                {order.history?.map((h,i)=>(
                  <div key={h.id} className="tl-row">
                    <div className="tl-dot-wrap"><div className={`tl-dot ${i===0?'td-active':'td-done'}`}><div className="tl-dot-inner"/></div></div>
                    <div className="tl-content">
                      <div className="tl-title">{h.action}</div>
                      {h.comment&&<div style={{fontSize:11,color:'var(--text2)',marginTop:1,fontStyle:'italic'}}>"{h.comment}"</div>}
                      <div className="tl-sub">by {h.by_user}</div>
                      <div className="tl-ts">{h.ts}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{borderTop:'1px solid var(--border)',padding:'14px 20px',background:'var(--surface)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>

          {/* Left: Hold / Unhold + Cancel */}
          {canEdit && !isOrderClosed && (
            <>
              {!isOnHold ? (
                <button className="btn"
                  style={{background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',border:'1.5px solid var(--amber,#d97706)',fontWeight:700}}
                  onClick={()=>setShowHoldModal(true)}>
                  ⏸ Hold
                </button>
              ) : (
                <button className="btn"
                  style={{background:'var(--green-lt,#f0fdf4)',color:'var(--green,#16a34a)',border:'1.5px solid var(--green,#16a34a)',fontWeight:700}}
                  onClick={()=>setShowUnholdConfirm(true)}>
                  ▶️ Unhold Order
                </button>
              )}
              {!isOnHold && (
                <button className="btn btn-danger" style={{fontWeight:600}} onClick={()=>setShowCancel(true)}>
                  🚫 Cancel Order
                </button>
              )}
            </>
          )}

          <div style={{flex:1}}/>

          {/* Right: Save + Send to Procurement + Back to Enquiry + Close */}
          {canEdit && (
            <>
              {/* Save order info changes */}
              {!isOnHold ? (
                <button className="btn btn-primary" style={{fontWeight:600}}
                  onClick={()=>mutation.mutate({...infoForm,_action:'Order saved',_comment:comment||''})}>
                  💾 Save
                </button>
              ) : (
                <button className="btn" disabled style={{opacity:0.55,cursor:'not-allowed',fontWeight:600}} title="Order is on hold. Unhold to save changes.">
                  🔒 Order Locked
                </button>
              )}

              {/* Send to Procurement — gated: hidden until advance paid (if applicable) and not on hold */}
              {!isOnHold &&
               ['open','draft','payment_pending','payment_approval','waiting_for_payment','cust_payment_update'].includes(order.status) &&
               !paymentTermsDirty &&
               !showProcurement &&
               (!hasAdvanceTerms || customerAdvanceReleased || customerAdvanceComplete || order.customer_payment_status === 'paid' || !!order.advance_released) && (
                <button className="btn"
                  style={{background:'var(--green)',color:'#fff',borderColor:'var(--green)',fontWeight:700,padding:'8px 18px'}}
                  onClick={()=>setShowProcurement(true)}>
                  🛒 Send to Procurement
                </button>
              )}
              {showProcurement && (
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',
                  borderRadius:'var(--r)',background:'var(--green-lt)',border:'2px solid var(--green)'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--green)'}}>
                    🛒 Move this order to the Procurement Bin?
                  </span>
                  <button className="btn btn-sm"
                    style={{background:'var(--green)',color:'#fff',borderColor:'var(--green)',fontWeight:700}}
                    onClick={async()=>{
                      try {
                        await api.put('/orders/' + order.id, {status:'procurement',_action:'Sent to Procurement Bin',_comment:''});
                        toast.success('✅ Order moved to Procurement Bin!');
                        qc.invalidateQueries(['orders']);
                        onClose();
                      } catch(e) { toast.error(e.response?.data?.error||'Failed to send'); }
                    }}>
                    Yes, Send
                  </button>
                  <button className="btn btn-xs" onClick={()=>setShowProcurement(false)}>Cancel</button>
                </div>
              )}
            </>
          )}

          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" style={{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}
            onClick={()=>printDoc(generateOrderPDF(order, custObj))}>⬇ Download PDF</button>
        </div>
      </div>

      {/* Hold Modal */}
      {showHoldModal && (
        <div className="overlay" style={{ zIndex: 1200 }} onClick={() => setShowHoldModal(false)}>
          <div className="modal" style={{ maxWidth: 480, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⏸</span> Put Order on Hold
              </h2>
              <button className="close-x" onClick={() => setShowHoldModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.5 }}>
                Enter the reason for placing this order on hold. The hold tag, note, and author will be visible across the entire admin panel (Orders, Procurement, Delivery Hub, Finance) and all operations will be locked.
              </p>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label">Hold Reason / Note <span className="req">*</span></label>
                <textarea
                  className="input"
                  rows={3}
                  value={holdReasonInput}
                  onChange={e => setHoldReasonInput(e.target.value)}
                  placeholder="Enter why this order is on hold (required)…"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { setShowHoldModal(false); setHoldReasonInput(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--amber,#d97706)', borderColor: 'var(--amber,#d97706)', fontWeight: 700 }}
                disabled={holdMutation.isPending || !holdReasonInput.trim()}
                onClick={() => {
                  if (!holdReasonInput.trim()) {
                    toast.error('Please enter a reason for holding the order');
                    return;
                  }
                  holdMutation.mutate(holdReasonInput.trim());
                }}>
                {holdMutation.isPending ? 'Holding…' : '⏸ Confirm Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unhold Confirmation Modal */}
      {showUnholdConfirm && (
        <div className="overlay" style={{ zIndex: 1200 }} onClick={() => setShowUnholdConfirm(false)}>
          <div className="modal" style={{ maxWidth: 440, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>▶️</span> Unhold Order
              </h2>
              <button className="close-x" onClick={() => setShowUnholdConfirm(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                Are you sure you want to unhold order <strong style={{ color: 'var(--accent)' }}>{order.id}</strong>?
                <br /><br />
                It will be restored to its previous status (<strong>{order.hold_prev_status || 'open'}</strong>) and all operations across Procurement, Delivery Hub, and Finance will be unlocked.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowUnholdConfirm(false)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--green,#16a34a)', color: '#fff', borderColor: 'var(--green,#16a34a)', fontWeight: 700 }}
                disabled={unholdMutation.isPending}
                onClick={() => unholdMutation.mutate()}>
                {unholdMutation.isPending ? 'Unholding…' : '▶️ Yes, Unhold Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {showCancel && (
        <div className="overlay" style={{ zIndex: 1200 }} onClick={() => { setShowCancel(false); setCancelReason(''); }}>
          <div className="modal" style={{ maxWidth: 480, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red, #dc2626)' }}>
                <span>🚫</span> Cancel Order
              </h2>
              <button className="close-x" onClick={() => { setShowCancel(false); setCancelReason(''); }}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.5 }}>
                Enter the reason for cancelling order <strong style={{ color: 'var(--accent)' }}>{order.id}</strong>:
              </p>
              <div style={{
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5
              }}>
                <div style={{fontWeight: 700, color: 'var(--text)', marginBottom: 4}}>Automatic Payment Adjustments on Cancellation:</div>
                <div>💳 <strong>Credit Line:</strong> Unpaid credit line obligations are released, instantly restoring available limit.</div>
                <div>💰 <strong>Wallet:</strong> Funds paid from customer prepaid wallet are automatically refunded to wallet balance.</div>
                <div>🏦 <strong>Bank Transfer / Cash:</strong> Real cash paid will be flagged for Finance settlement (bank refund or order transfer).</div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label">Cancellation Reason <span className="req">*</span></label>
                <textarea
                  className="input"
                  rows={3}
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Enter why this order is being cancelled (required)…"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { setShowCancel(false); setCancelReason(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                style={{ fontWeight: 700 }}
                disabled={cancelMutation.isPending || !cancelReason.trim()}
                onClick={() => {
                  if (!cancelReason.trim()) {
                    toast.error('Cancellation reason is required');
                    return;
                  }
                  cancelMutation.mutate(cancelReason.trim());
                }}>
                {cancelMutation.isPending ? 'Cancelling…' : '🚫 Confirm Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Item Cancellation Modal */}
      {itemCancelModal && (
        <div className="overlay" style={{ zIndex: 1300 }} onClick={() => setItemCancelModal(null)}>
          <div className="modal" style={{ maxWidth: 480, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
                <span>🚫</span> Cancel Line Item
              </h2>
              <button className="close-x" onClick={() => setItemCancelModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Are you sure you want to cancel item <strong>{itemCancelModal.item?.component}</strong>
                {itemCancelModal.item?.ipn ? ` (${itemCancelModal.item.ipn})` : ''}?
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label">Cancellation Reason <span className="req">*</span></label>
                <textarea
                  className="input"
                  rows={3}
                  value={itemCancelReason}
                  onChange={e => setItemCancelReason(e.target.value)}
                  placeholder="Enter reason for cancelling this item (required)…"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => { setItemCancelModal(null); setItemCancelReason(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={itemCancelMutation.isPending || !itemCancelReason.trim()}
                onClick={() => itemCancelMutation.mutate({ itemId: itemCancelModal.item.id, reason: itemCancelReason.trim() })}>
                {itemCancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancel Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Reason Info Modal */}
      {cancelReasonModal && (
        <div className="overlay" style={{ zIndex: 1300 }} onClick={() => setCancelReasonModal(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color: 'var(--red, #dc2626)', display: 'flex', alignItems: 'center', gap: 6 }}>
                🚫 Item Cancellation Reason
              </h2>
              <button className="close-x" onClick={() => setCancelReasonModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8, fontWeight: 700 }}>
                {cancelReasonModal.component} {cancelReasonModal.ipn ? `(${cancelReasonModal.ipn})` : ''}
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>
                  Reason:
                </div>
                <div style={{ fontWeight: 600, color: 'var(--red, #dc2626)', wordBreak: 'break-word', fontSize: 13 }}>
                  "{cancelReasonModal.cancellation_reason || 'No reason specified'}"
                </div>
                {cancelReasonModal.cancelled_by && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    Cancelled by: <strong>{cancelReasonModal.cancelled_by}</strong>
                    {cancelReasonModal.cancelled_at && ` on ${fmtDateTime(cancelReasonModal.cancelled_at) || cancelReasonModal.cancelled_at}`}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm btn-primary" onClick={() => setCancelReasonModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditLineItems({ order, suppliers, canSeeProcPrice, onSave, onCancel }) {
  const [items, setItems] = useState(order.lineItems?.map(li=>({...li}))||[]);
  const add = () => setItems(p=>[...p,{id:'new_'+Date.now(),component:'',manufacturer:'',ipn:'',qty:0,unit_price:0,procurement_price:0,currency:'INR',order_date:'',delivery_date:'',supplier_id:'',line_status:'confirmed'}]);
  const rm  = idx => setItems(p=>p.filter((_,i)=>i!==idx));
  const upd = (idx,k,v) => setItems(p=>p.map((it,i)=>i===idx?{...it,[k]:v}:it));
  return (
    <div style={{borderTop:'1px solid var(--border)',paddingTop:14,marginTop:14}}>
      {items.map((li,idx)=>(
        <div key={li.id} className="sup-block" style={{marginBottom:10}}>
          <div className="flex-between" style={{marginBottom:8}}><span className="bold" style={{fontSize:12}}>Item {idx+1}</span><button className="btn btn-xs btn-danger" onClick={()=>rm(idx)}>Remove</button></div>
          <div className="form-grid-3" style={{marginBottom:8}}>
            <div className="form-group"><label className="label">Component</label><input className="input" value={li.component} onChange={e=>upd(idx,'component',e.target.value)} /></div>
            <div className="form-group"><label className="label">Manufacturer</label><input className="input" value={li.manufacturer} onChange={e=>upd(idx,'manufacturer',e.target.value)} /></div>
            <div className="form-group"><label className="label">IPN</label><input className="input" value={li.ipn||''} onChange={e=>upd(idx,'ipn',e.target.value)} /></div>
          </div>
          <div className="form-grid-4">
            <div className="form-group"><label className="label">Qty</label><input className="input" type="number" value={li.qty} onChange={e=>upd(idx,'qty',Number(e.target.value))} /></div>
            <div className="form-group"><label className="label">Customer Price</label><input className="input" type="number" step="0.01" value={li.unit_price} onChange={e=>upd(idx,'unit_price',Number(e.target.value))} /></div>
            {canSeeProcPrice&&<div className="form-group"><label className="label">Procurement Price</label><input className="input" type="number" step="0.01" value={li.procurement_price||''} onChange={e=>upd(idx,'procurement_price',Number(e.target.value))} /></div>}
            <div className="form-group"><label className="label">Currency</label><select className="input" value={li.currency} onChange={e=>upd(idx,'currency',e.target.value)}>{['INR','USD','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}</select></div>
          </div>
          <div className="form-grid-3">
            <div className="form-group"><label className="label">Supplier</label>
              <select className="input" value={li.supplier_id} onChange={e=>upd(idx,'supplier_id',e.target.value)}>
                <option value="">— Select —</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Delivery Date</label><input className="input" type="date" value={li.delivery_date||''} onChange={e=>upd(idx,'delivery_date',e.target.value)} /></div>
            <div className="form-group"><label className="label">Line Status</label>
              <select className="input" value={li.line_status} onChange={e=>upd(idx,'line_status',e.target.value)}>
                {['negotiating','procurement','payment','shipped','delivered'].map(s=><option key={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-8" style={{marginTop:8}}>
        <button className="btn btn-sm" onClick={add}>+ Add Item</button>
        <div style={{flex:1}}/>
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={()=>onSave({lineItems:items.filter(i=>i.component)})}>Save Items</button>
      </div>
    </div>
  );
}

function EditSupplierOrders({ order, shippers, onSave, onCancel }) {
  const [soList, setSoList] = useState(order.supplierOrders?.map(so=>({...so}))||[]);
  const upd = (idx,k,v) => setSoList(p=>p.map((so,i)=>i===idx?{...so,[k]:v}:so));
  return (
    <div style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:12}}>
      {soList.map((so,idx)=>(
        <div key={so.id} style={{marginBottom:12}}>
          <div className="bold" style={{fontSize:12,marginBottom:8}}>Supplier {idx+1}</div>
          <div className="form-grid-2" style={{marginBottom:8}}>
            <div className="form-group"><label className="label">PO Number</label><input className="input" value={so.po_no||''} onChange={e=>upd(idx,'po_no',e.target.value)} /></div>
            <div className="form-group"><label className="label">Shipping Status</label>
              <select className="input" value={so.shipping_status||'pending'} onChange={e=>upd(idx,'shipping_status',e.target.value)}>
                {['pending','in-transit','received','failed'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {(so.shipping_status==='in-transit'||so.shipping_status==='received')&&(
            <div className="form-grid-2">
              <div className="form-group"><label className="label">Shipper</label>
                <ShipperSelect value={so.shipper_id||''} onChange={v=>upd(idx,'shipper_id',v)} shippers={shippers} />
              </div>
              <div className="form-group"><label className="label">Tracking ID</label><input className="input" value={so.tracking_no||''} onChange={e=>upd(idx,'tracking_no',e.target.value)} placeholder="AWB / Tracking number" /></div>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-8"><button className="btn btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-sm btn-primary" onClick={()=>onSave({supplierOrders:soList})}>Save</button></div>
    </div>
  );
}


export default function OrdersPage() {
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [selected, setSelected] = useState(null);

  const [seenOrders, setSeenOrders] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('seen_orders')||'[]')); } catch(_) { return new Set(); }
  });
  const markOrderSeen = (id) => {
    setSeenOrders(prev => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem('seen_orders', JSON.stringify([...next]));
      window.dispatchEvent(new Event('seen-updated'));
      return next;
    });
  };
  const [expanded, setExpanded] = useState({});       // order id → bool
  const [sortCol,  setSortCol]  = useState('created_at');
  const [sortDir,  setSortDir]  = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orders=[], refetch }  = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>r.data) });
  const { data: suppliers=[] }        = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: customers=[] }        = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: shippers=[] }         = useQuery({ queryKey:['shippers'],  queryFn:()=>api.get('/shippers').then(r=>r.data) });
  const { data: enquiries=[] }        = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data).catch(()=>[]), staleTime:60000 });
  const { data: allQuotes=[] }        = useQuery({ queryKey:['quotes'],    queryFn:()=>api.get('/quotes').then(r=>r.data).catch(()=>[]), staleTime:60000 });
  const { user } = useAuth();
  const canSeeCustomer = user.perms?.canSeeCustomer !== false;
  const custName = id => canSeeCustomer ? (customers.find(c=>c.id===id)?.name||id) : '[Restricted]';

  const fmtMoney = (n, cur) => {
    const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$'};
    return (sym[cur]||cur+' ') + (n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  };

  const orderValues = (o) => {
    const byCur = {}; const tByCur = {};
    (o.lineItems||[]).forEach(li=>{
      if (li.line_status === 'cancelled') return;
      const base = (Number(li.qty)||0)*(Number(li.unit_price)||0);
      const tot  = base + base*(Number(li.tax_rate)||0)/100;
      const c = li.currency||'INR';
      byCur[c]  = (byCur[c] ||0)+base;
      tByCur[c] = (tByCur[c]||0)+tot;
    });
    return { base:byCur, total:tByCur };
  };

  const FILTERS = ['all','draft','open','procurement','waiting_for_payment','closed','delivered','hold','cancelled'];
  const FILTER_LABEL = { all:'All', draft:'Draft', open:'Open', procurement:'Procurement', waiting_for_payment:'Waiting Payment', closed:'Closed', delivered:'Delivered', hold:'Hold', cancelled:'Cancelled' };

  // ── Order ageing ─────────────────────────────────────────────────────────
  const todayStr   = new Date().toISOString().slice(0,10);
  const in10Str    = new Date(Date.now()+10*24*60*60*1000).toISOString().slice(0,10);
  const doneStatus = ['closed','delivered','failed','cancelled'];
  const beyondSchedule = orders.filter(o =>
    o.tentative_date && o.tentative_date < todayStr && !doneStatus.includes(o.status)
  );
  const dueSoon = orders.filter(o =>
    o.tentative_date && o.tentative_date >= todayStr && o.tentative_date <= in10Str && !doneStatus.includes(o.status)
  );

  // Sort helper
  const doSort = (col) => {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  const SortIcon = ({col}) => (
    <span style={{marginLeft:4,opacity:sortCol===col?1:0.3,fontSize:10}}>
      {sortCol===col ? (sortDir==='asc'?'▲':'▼') : '▲'}
    </span>
  );
  const ThSort = ({col,children,style}) => (
    <th style={{cursor:'pointer',userSelect:'none',...style}} onClick={()=>doSort(col)}>
      {children}<SortIcon col={col}/>
    </th>
  );

  const filtered = useMemo(()=>{
    let list = [...orders];
    if (filter==='beyond_schedule') list = [...beyondSchedule];
    else if (filter==='due_soon')   list = [...dueSoon];
    else if (filter==='open')       list = list.filter(o=>(o.status||'').toLowerCase()!=='closed');
    else if (filter!=='all')        list = list.filter(o=>o.status===filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o=>
        o.id.toLowerCase().includes(q)||
        (o.enquiry_no||'').toLowerCase().includes(q)||
        (o.quote_no||'').toLowerCase().includes(q)||
        (o.customer_ref||'').toLowerCase().includes(q)||
        (o.po_number||'').toLowerCase().includes(q)||
        (o.lineItems||[]).some(li=>(li.component||'').toLowerCase().includes(q)||(li.manufacturer||'').toLowerCase().includes(q))
      );
    }
    if (dateFrom) list = list.filter(o=>(o.created_at||'')>=dateFrom);
    if (dateTo)   list = list.filter(o=>(o.created_at||'')<=dateTo+'T23:59');
    const isOpen = s => ['open','draft'].includes(s);
    list.sort((a,b)=>{
      // open/draft always first unless user is sorting by status
      if (sortCol !== 'status') {
        const ap = isOpen(a.status) ? 0 : 1;
        const bp = isOpen(b.status) ? 0 : 1;
        if (ap !== bp) return ap - bp;
      }
      let av='', bv='';
      if (sortCol==='id')           { av=a.id; bv=b.id; }
      else if (sortCol==='enquiry') { av=a.enquiry_no||''; bv=b.enquiry_no||''; }
      else if (sortCol==='quote')   { av=a.quote_no||''; bv=b.quote_no||''; }
      else if (sortCol==='delivery'){ av=a.tentative_date||''; bv=b.tentative_date||''; }
      else if (sortCol==='status')  { av=a.status||''; bv=b.status||''; }
      else if (sortCol==='created_at'){ av=a.created_at||''; bv=b.created_at||''; }
      else if (sortCol==='base')    {
        const ga=orderValues(a).base; const gb=orderValues(b).base;
        const va=Object.values(ga)[0]||0; const vb=Object.values(gb)[0]||0;
        return sortDir==='asc'?va-vb:vb-va;
      }
      return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
    });
    return list;
  }, [orders,filter,search,dateFrom,dateTo,sortCol,sortDir]);

  const toggleExpand = (id,e) => { e.stopPropagation(); setExpanded(x=>({...x,[id]:!x[id]})); };

  return (
    <div>
      {/* ── Top bar ── */}
      <div className="flex-between" style={{marginBottom:10}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
            <input className="search-input" placeholder="Search orders, ENQ, components…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          {/* Date filter */}
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
            <span style={{color:'var(--text3)',fontWeight:600}}>From</span>
            <input type="date" className="input" style={{width:130,fontSize:12}} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
            <span style={{color:'var(--text3)',fontWeight:600}}>To</span>
            <input type="date" className="input" style={{width:130,fontSize:12}} value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
            {(dateFrom||dateTo)&&<button className="btn btn-xs" onClick={()=>{setDateFrom('');setDateTo('');}}>✕ Clear</button>}
          </div>
        </div>

      </div>

      {/* ── Order Ageing cards ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
        {/* Beyond Schedule */}
        <div
          className="stat-card"
          onClick={()=>setFilter(filter==='beyond_schedule'?'all':'beyond_schedule')}
          style={{borderLeft:'3px solid var(--red)',cursor:'pointer',
            background: filter==='beyond_schedule'?'var(--red-lt,#fef2f2)':undefined,
            outline: filter==='beyond_schedule'?'2px solid var(--red)':undefined}}>
          <div className="stat-label" style={{color:'var(--red)',fontWeight:700}}>🔴 Beyond Schedule</div>
          <div className="stat-val" style={{color:'var(--red)',fontSize:28}}>{beyondSchedule.length}</div>
          <div className="stat-sub">orders past promised date</div>
        </div>
        {/* Due ≤ 10 Days */}
        <div
          className="stat-card"
          onClick={()=>setFilter(filter==='due_soon'?'all':'due_soon')}
          style={{borderLeft:'3px solid var(--amber,#d97706)',cursor:'pointer',
            background: filter==='due_soon'?'var(--amber-lt,#fffbeb)':undefined,
            outline: filter==='due_soon'?'2px solid var(--amber,#d97706)':undefined}}>
          <div className="stat-label" style={{color:'var(--amber,#d97706)',fontWeight:700}}>🟡 Due ≤ 10 Days</div>
          <div className="stat-val" style={{color:'var(--amber,#d97706)',fontSize:28}}>{dueSoon.length}</div>
          <div className="stat-sub">orders due within 10 days</div>
        </div>
        {/* All active */}
        <div
          className="stat-card"
          onClick={()=>setFilter('all')}
          style={{borderLeft:'3px solid var(--accent)',cursor:'pointer',
            background: filter==='all'?'var(--accent-lt)':undefined,
            outline: filter==='all'?'2px solid var(--accent)':undefined}}>
          <div className="stat-label" style={{color:'var(--accent)',fontWeight:700}}>📋 All Orders</div>
          <div className="stat-val" style={{color:'var(--accent)',fontSize:28}}>{orders.length}</div>
          <div className="stat-sub">total on record</div>
        </div>
      </div>

      {/* ── Status filter chips ── */}
      <div className="filter-row" style={{marginBottom:12}}>
        {FILTERS.map(f=><span key={f} className={`fchip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>
          {f==='all'?`All (${orders.length})`:FILTER_LABEL[f]||f}
        </span>)}
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{width:28}}/>
              <ThSort col="id">Order No.</ThSort>
              <ThSort col="enquiry">Enq No.</ThSort>
              <ThSort col="quote">Quote No.</ThSort>
              <th>MPN / Component</th>
              <ThSort col="base">Base Value</ThSort>
              <th>Total Value</th>
              <ThSort col="delivery">Promised Date</ThSort>
              <ThSort col="status">Status</ThSort>
              <th style={{textAlign:'center'}}>Days in Stage</th>
              <ThSort col="created_at">Created</ThSort>
              <th style={{textAlign:'right'}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && (
              <tr><td colSpan={12}>
                <div className="empty-state"><div className="empty-icon">📋</div><div>No orders found</div></div>
              </td></tr>
            )}
            {filtered.map(o=>{
              const vals    = orderValues(o);
              const items   = o.lineItems||[];
              const isOpen  = !!expanded[o.id];
              const delayed = isDelayed(o);
              const multiItem = items.length > 1;
              const firstItem = items[0];
              const isUnseen = ['open','draft'].includes(o.status) && !seenOrders.has(o.id);
              const canEdit = o.created_by === user.id || ['admin','manager'].includes(user.role) || canAccessSection(user, 'procurement-bin');

              return (
                <React.Fragment key={o.id}>
                  {/* ── Main row ── */}
                  <tr style={{background: isOpen?'var(--accent-lt)':isUnseen?'#f0f7ff':undefined}}>
                    {/* Expand toggle */}
                    <td style={{textAlign:'center',padding:'4px 6px'}}>
                      {multiItem && (
                        <button onClick={e=>toggleExpand(o.id,e)}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:14,color:'var(--accent)',fontWeight:700,padding:'2px 4px'}}>
                          {isOpen?'▾':'▸'}
                        </button>
                      )}
                    </td>
                    {/* Order No */}
                    <td>
                      <div className="mono bold" style={{color:'var(--accent)',fontSize:12,cursor:'pointer'}}
                        onClick={()=>{setSelected(o);markOrderSeen(o.id);}}>{o.id}</div>
                      {canSeeCustomer && <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>{custName(o.customer_id)}</div>}
                      {o.po_number && <div style={{fontSize:10,color:'var(--text3)'}}>PO: {o.po_number}</div>}
                      {/* Show revision version if quote_no has -V2 / -V3 suffix */}
                      {(() => {
                        const m = (o.quote_no||'').match(/-V(\d+)$/);
                        if (!m) return null;
                        return (
                          <div style={{marginTop:2,display:'inline-flex',alignItems:'center',
                            padding:'0px 5px',borderRadius:99,fontSize:9,fontWeight:800,
                            background:'var(--purple-lt,#f5f3ff)',color:'var(--purple,#7c3aed)',
                            border:'1px solid var(--purple,#7c3aed)',letterSpacing:.3}}>
                            REV V{m[1]}
                          </div>
                        );
                      })()}
                    </td>
                    {/* Enq No */}
                    <td className="mono" style={{fontSize:12}}>{o.enquiry_no||'—'}</td>
                    {/* Quote No */}
                    <td className="mono" style={{fontSize:12}}>{o.quote_no||'—'}</td>
                    {/* MPN / Component */}
                    <td>
                      {items.length===0 ? <span style={{color:'var(--text3)'}}>—</span> : (
                        <div>
                          <div style={{fontWeight:600,fontSize:12}}>{firstItem?.component||'—'}</div>
                          {firstItem?.manufacturer && <div style={{fontSize:11,color:'var(--text3)'}}>{firstItem.manufacturer}</div>}
                          {firstItem?.ipn && <div style={{fontSize:10,color:'var(--text3)',fontFamily:'monospace'}}>{firstItem.ipn}</div>}
                          {multiItem && !isOpen && (
                            <div style={{fontSize:10,color:'var(--accent)',fontWeight:600,marginTop:2}}>
                              +{items.length-1} more — click ▸ to expand
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    {/* Base Value */}
                    <td style={{textAlign:'right'}}>
                      {Object.entries(vals.base).map(([c,v])=>(
                        <div key={c} style={{fontWeight:700,fontSize:12,color:'var(--accent)'}}>{fmtMoney(v,c)}</div>
                      ))}
                      {Object.keys(vals.base).length===0 && <span style={{color:'var(--text3)'}}>—</span>}
                    </td>
                    {/* Total Value */}
                    <td style={{textAlign:'right'}}>
                      {Object.entries(vals.total).map(([c,v])=>(
                        <div key={c} style={{fontWeight:700,fontSize:12,
                          color:JSON.stringify(vals.total)!==JSON.stringify(vals.base)?'var(--green)':'var(--accent)'}}>
                          {fmtMoney(v,c)}
                        </div>
                      ))}
                      {Object.keys(vals.total).length===0 && <span style={{color:'var(--text3)'}}>—</span>}
                    </td>
                    {/* Promised Date */}
                    <td style={{fontSize:12,color:delayed?'var(--red)':'inherit',fontWeight:delayed?600:400}}>
                      {o.tentative_date||'—'}{delayed?' ⚠':''}
                    </td>
                    {/* Status + pickup date */}
                    <td>
                      {(o.is_on_hold || o.status === 'hold') ? (
                        <HoldBadge />
                      ) : (
                        <StatusBadge s={o.status}/>
                      )}
                      {/* Show revision sub-stage only when this order's own quote is being revised.
                          Split enquiries can leave other items in sourcing; that should not mark
                          already-created orders from separate split quotes as re-sourcing. */}
                      {o.enquiry_id && (() => {
                        const enq = enquiries.find(e => e.id === o.enquiry_id);
                        if (!enq) return null;
                        const orderQuote = allQuotes.find(q => q.id === o.quote_id || q.quote_no === o.quote_no) || null;
                        const orderQuoteKeys = quoteItemKeys(orderQuote);
                        const matchesOrderQuote = q => {
                          if (!orderQuote) return false;
                          if (q.id === orderQuote.id || q.parent_quote_id === orderQuote.id) return true;
                          return setsOverlap(orderQuoteKeys, quoteItemKeys(q));
                        };
                        const matchingReturned = allQuotes.some(q =>
                          q.enquiry_id === o.enquiry_id && q.status === 'returned_to_sourcing' && matchesOrderQuote(q)
                        );
                        const matchingActiveRevision = allQuotes.some(q =>
                          q.enquiry_id === o.enquiry_id && q.status === 'active' && (q.revision||1) > 1 && matchesOrderQuote(q)
                        );
                        let badge = null;
                        if (enq.status === 'returned_to_sourcing' && matchingReturned) {
                          badge = { label: '🔄 Revising · Source Bin', color: 'var(--amber,#d97706)', bg: 'var(--amber-lt,#fffbeb)' };
                        } else if (enq.status === 'sourcing' && matchingActiveRevision) {
                          badge = { label: '🔄 Re-Sourcing', color: 'var(--amber,#d97706)', bg: 'var(--amber-lt,#fffbeb)' };
                        } else if (enq.status === 'quoted' && matchingActiveRevision) {
                          badge = { label: '🔄 Revising · In Quote', color: 'var(--purple,#7c3aed)', bg: '#f5f3ff' };
                        }
                        if (!badge) return null;
                        return (
                          <div style={{marginTop:3,display:'inline-flex',alignItems:'center',gap:4,
                            padding:'1px 7px',borderRadius:99,fontSize:10,fontWeight:700,
                            background:badge.bg,color:badge.color,
                            border:`1px solid ${badge.color}`}}>
                            {badge.label}
                          </div>
                        );
                      })()}
                      {o.tentative_date && (
                        <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>
                          📅 {o.tentative_date}
                        </div>
                      )}
                    </td>
                    {/* Days in Stage */}
                    <td><DaysBadge updatedAt={o.updated_at||o.created_at} /></td>
                    {/* Created */}
                    <td style={{fontSize:11,color:'var(--text3)'}}>{fmtDateTime(o.created_at)}</td>
                    {/* Actions */}
                    <td style={{textAlign:'right'}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex',gap:5,justifyContent:'flex-end',alignItems:'center'}}>
                        {o.status==='draft' && (
                          <span style={{fontSize:10,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',
                            border:'1px solid var(--amber,#d97706)',borderRadius:999,padding:'2px 7px',fontWeight:700}}>DRAFT</span>
                        )}
                        <button className="btn btn-xs btn-primary"
                          onClick={()=>{setSelected(o);markOrderSeen(o.id);}}>
                          ✏ Manage
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* ── Expanded line items ── */}
                  {isOpen && items.map((li,liIdx)=>(
                    <tr key={li.id||liIdx} style={{background:'var(--accent-lt)',fontSize:12}}>
                      <td/>
                      <td colSpan={2} style={{paddingLeft:28,color:'var(--text3)',fontSize:11}}>
                        └ Item {liIdx+1}
                      </td>
                      <td/>
                      <td>
                        <div style={{fontWeight:600}}>{li.component}</div>
                        {li.manufacturer&&<div style={{fontSize:11,color:'var(--text3)'}}>{li.manufacturer}</div>}
                        {li.ipn&&<div style={{fontSize:10,fontFamily:'monospace',color:'var(--text3)'}}>{li.ipn}</div>}
                        <div style={{fontSize:11,color:'var(--text2)',marginTop:1}}>Qty: <strong>{li.qty}</strong></div>
                      </td>
                      <td style={{textAlign:'right'}}>
                        {li.unit_price ? <span style={{fontWeight:600,color:'var(--accent)'}}>{fmtMoney((li.qty||0)*(li.unit_price||0),li.currency||'INR')}</span> : '—'}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {li.unit_price ? (()=>{
                          const base=(li.qty||0)*(li.unit_price||0);
                          const tot=base+base*(Number(li.tax_rate)||0)/100;
                          return <span style={{fontWeight:600,color:Number(li.tax_rate)>0?'var(--green)':'var(--accent)'}}>{fmtMoney(tot,li.currency||'INR')}</span>;
                        })() : '—'}
                      </td>
                      <td style={{fontSize:12}}>{li.delivery_date||'—'}</td>
                      <td><LineStatusBadge s={li.line_status}/></td>
                      <td colSpan={2}/>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected&&<OrderDetailModal order={orders.find(o=>o.id===selected.id)||selected} onClose={()=>setSelected(null)} suppliers={suppliers} customers={customers} shippers={shippers} enquiries={enquiries}
        onRefresh={()=>{refetch().then(r=>{const up=r.data?.find(o=>o.id===selected.id);if(up)setSelected(up);}); }} />}
    </div>
  );
}
