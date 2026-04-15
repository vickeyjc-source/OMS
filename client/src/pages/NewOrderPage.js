// client/src/pages/NewOrderPage.js  v3
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { today } from '../utils/helpers';

const PAYMENT_TERMS_GROUPS = [
  { group:'Advance Payment', terms:['Advance Payment (AP) – Full payment before shipment','Partial Advance – 30% upfront, 70% on delivery','Partial Advance – 50% upfront, 50% on delivery','Cash in Advance (CIA) – 100% before dispatch','Cash Before Shipment (CBS) – Payment before goods ship','Cash on Delivery (COD)','Cash Against Delivery (CAD)'] },
  { group:'Letter of Credit (LC)', terms:['Letter of Credit (LC)','Irrevocable Letter of Credit','Confirmed Letter of Credit','Sight Letter of Credit – Payment on document submission','Usance LC – 30 days','Usance LC – 60 days','Usance LC – 90 days'] },
  { group:'Documents & Bill of Exchange', terms:['Documents Against Payment (D/P)','Documents Against Acceptance (D/A)','Bill of Exchange'] },
  { group:'Net Days', terms:['Net 7 – Payment due in 7 days','Net 15 – Payment due in 15 days','Net 30 – Payment due in 30 days','Net 45 – Payment due in 45 days','Net 60 – Payment due in 60 days','Net 90 – Payment due in 90 days','End of Month (EOM)','Net 30 EOM – 30 days after end of invoice month'] },
  { group:'Early Payment Discount', terms:['2/10 Net 30 – 2% discount if paid in 10 days','1/15 Net 45 – 1% discount if paid in 15 days'] },
  { group:'Progress / Milestone', terms:['Progress Payment – As work progresses','Milestone-Based Payment','Stage Payment – Defined stages','Retention Payment – Portion held until completion'] },
  { group:'Deferred / Consignment', terms:['Consignment – Payment after goods are sold','Sale or Return – Buyer can return unsold goods','Deferred Payment – Postponed to agreed date'] },
  { group:'Recurring', terms:['Monthly Payment','Quarterly Payment','Annual Prepaid – Full year upfront'] },
];
const ALL_PAYMENT_TERMS = PAYMENT_TERMS_GROUPS.flatMap(g=>g.terms);
// ── PO Upload Widget ──────────────────────────────────────────────────────────
function POUpload({ files, onChange }) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({}); // filename → 0-100
  const inputRef = useRef();

  const processFiles = (incoming) => {
    const newFiles = Array.from(incoming).filter(f => !files.find(x => x.name === f.name));
    if (!newFiles.length) return;
    // Simulate upload progress per file
    newFiles.forEach(f => {
      setProgress(p => ({ ...p, [f.name]: 0 }));
      let pct = 0;
      const iv = setInterval(() => {
        pct += Math.floor(Math.random() * 25) + 10;
        if (pct >= 100) { pct = 100; clearInterval(iv); }
        setProgress(p => ({ ...p, [f.name]: pct }));
      }, 150);
    });
    onChange([...files, ...newFiles.map(f => ({ name: f.name, size: f.size, file: f, ref: f.name }))]);
  };

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    processFiles(e.dataTransfer.files);
  }, [files]);

  const remove = name => onChange(files.filter(f => f.name !== name));

  return (
    <div>
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border-md)'}`,
          borderRadius: 'var(--r)', padding: '18px 16px', cursor: 'pointer',
          background: dragging ? 'var(--accent-lt)' : 'var(--surface2)',
          textAlign: 'center', transition: 'all .15s',
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: dragging ? 'var(--accent)' : 'var(--text2)' }}>
          {dragging ? 'Drop files here' : 'Click or drag & drop PO files'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>PDF, PNG, JPG, DOCX — multiple files allowed</div>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
          onChange={e => { processFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* File list + progress bars */}
      {files.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map(f => (
            <div key={f.name} style={{ background: 'var(--surface2)', borderRadius: 'var(--r-sm)', padding: '8px 12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: progress[f.name] < 100 ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📄</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{f.size ? (f.size / 1024).toFixed(1) + ' KB' : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {(progress[f.name] ?? 100) >= 100
                    ? <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Ready</span>
                    : <span style={{ fontSize: 11, color: 'var(--accent)' }}>{progress[f.name]}%</span>}
                  <button onClick={() => remove(f.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
              </div>
              {(progress[f.name] ?? 100) < 100 && (
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: progress[f.name] + '%', background: 'var(--accent)', transition: 'width .15s', borderRadius: 2 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NewOrderPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const qc        = useQueryClient();
  const prefill   = location.state?.prefill || null;

  const { data: customers=[] } = useQuery({ queryKey:['customers'],  queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: suppliers=[] } = useQuery({ queryKey:['suppliers'],  queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: orders=[] }    = useQuery({ queryKey:['orders'],     queryFn:()=>api.get('/orders').then(r=>r.data) });
  const { data: enquiries=[] } = useQuery({ queryKey:['enquiries'],  queryFn:()=>api.get('/enquiries').then(r=>r.data) });
  const { data: quotes=[] }    = useQuery({ queryKey:['quotes'],     queryFn:()=>api.get('/quotes').then(r=>r.data) });

  const [form, setForm] = useState(() => ({
    customer_id:        prefill?.customer_id || '',
    delivery_address:   '',
    customer_ref:   '',
    enquiry_id:     prefill?.enquiry_id  || '',
    quote_id:       prefill?.quote_id    || '',
    enquiry_no:     prefill?.enquiry_no  || '',
    quote_no:       prefill?.quote_no    || '',
    po_number:      '',
    tentative_date: '',
    notes: prefill?.quote_no ? 'From Quote ' + prefill.quote_no + (prefill.zoho_quote_no ? ' (Zoho: ' + prefill.zoho_quote_no + ')' : '') : '',
  }));

  const [items, setItems] = useState(() => {
    if (prefill?.lineItems?.length) {
      return prefill.lineItems.map((li, i) => ({
        id:           'li' + (i+1),
        component:    li.component    || '',
        manufacturer: li.manufacturer || '',
        ipn:          li.ipn          || '',
        qty:          String(li.qty   || ''),
        unit_price:   li.unit_price   || li.quoted_price || '',
        quoted_price: li.quoted_price || li.unit_price   || '',
        target_price: li.target_price || '',
        currency:     li.currency     || 'INR',
        order_date:   today(),
        delivery_date:li.delivery_date || '',
        line_status:  'negotiating',
        // ADDED: carry tax_rate from quote/sourcing so order line items show correct tax
        tax_rate:     Number(li.tax_rate) || 0,
      }));
    }
    return [{ id:'li1', component:'', manufacturer:'', ipn:'', qty:'', unit_price:'', quoted_price:'', target_price:'', currency:'INR', order_date:today(), delivery_date:'', line_status:'negotiating' }];
  });

  const [poFiles, setPoFiles]   = useState([]);
  const [orderId, setOrderId]   = useState(() => {
    // Auto-generate immediately
    const next = (orders.length || 0) + 1;
    return 'CFOR' + String(next).padStart(4, '0');
  });

  // Recalculate orderId once orders loads
  React.useEffect(() => {
    if (orders.length > 0) {
      const next = orders.length + 1;
      setOrderId('CFOR' + String(next).padStart(4, '0'));
    }
  }, [orders.length]);

  const addItem    = () => setItems(p=>[...p,{ id:'li'+Date.now(), component:'', manufacturer:'', ipn:'', qty:'', unit_price:'', quoted_price:'', target_price:'', currency:'INR', order_date:today(), delivery_date:'', line_status:'negotiating' }]);
  const removeItem = idx => setItems(p=>p.filter((_,i)=>i!==idx));
  const upd = (idx,k,v) => setItems(p=>p.map((it,i)=>i===idx?{...it,[k]:v}:it));

  // Derived customer info
  const selectedCustomer = customers.find(c => c.id === form.customer_id) || null;
  const customerPayTerms = selectedCustomer?.payment_terms || '';
  const isFullAdvance    = t => t && (t.toLowerCase().includes('advance payment') || t.toLowerCase().includes('cash in advance') || t.toLowerCase().includes('100%'));
  const isPartialAdvance = t => t && t.toLowerCase().includes('partial advance');

  const handleEnquirySelect = enqId => {
    const enq = enquiries.find(e=>e.id===enqId);
    if (!enq) { setForm(f=>({...f,enquiry_id:'',enquiry_no:''})); return; }
    setForm(f=>({...f,enquiry_id:enqId,enquiry_no:enqId,customer_id:enq.customer_id}));
    if (enq.items?.length) {
      setItems(enq.items.map((li,i)=>({ id:'li'+i+Date.now(), component:li.component, manufacturer:li.manufacturer||'', ipn:li.ipn||'', qty:li.quantity||'', unit_price:'', quoted_price:'', target_price:li.target_price||'', currency:li.target_currency||'INR', order_date:today(), delivery_date:li.preferred_delivery_date||'', line_status:'negotiating' })));
    }
  };
  const handleQuoteSelect = async (qid) => {
    const q = quotes.find(x => x.id === qid);
    if (!q) return;
    setForm(f => ({...f, quote_id:qid, quote_no:q.quote_no, customer_id:q.customer_id, enquiry_id:q.enquiry_id||'', enquiry_no:q.enquiry_id||''}));

    try {
      // Use dedicated endpoint that returns items pre-enriched with quote_price
      const res = await api.get('/quotes/' + qid + '/lineitems');
      const { items: lineItems } = res.data;
      if (lineItems?.length) {
        setItems(lineItems.map((li, i) => ({
          id:               'li' + i + Date.now(),
          component:        li.component    || '',
          manufacturer:     li.manufacturer || '',
          ipn:              li.ipn          || '',
          qty:              String(li.quantity || ''),
          unit_price:       li.quote_price  != null ? String(li.quote_price) : '',
          quoted_price:     li.quote_price  != null ? String(li.quote_price) : '',
          target_price:     li.target_price != null ? String(li.target_price): '',
          procurement_price:li.sourced_price!= null ? String(li.sourced_price): '',
          currency:         li.quote_currency || li.target_currency || 'INR',
          order_date:       today(),
          delivery_date:    li.preferred_delivery_date || '',
          line_status:      'negotiating',
          // ADDED: carry tax_rate from sourcing via quote lineitems endpoint
          tax_rate:         Number(li.tax_rate) || 0,
        })));
      }
    } catch(e) {
      toast.error('Could not load quote line items: ' + (e.response?.data?.error || e.message));
    }
  };

  const mutation = useMutation({
    mutationFn: d => api.post('/orders', d),
    onSuccess: r => { qc.invalidateQueries(['orders']); toast.success('Order ' + r.data.id + ' created!'); navigate('/orders'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const buildPayload = (status) => {
    const valid = items.filter(i => i.component.trim());
    return {
      ...form,
      id: orderId,
      status,
      po_file_ref: poFiles.map(f=>f.name).join(', '),
      lineItems: valid.map((i,idx) => ({ ...i, qty:Number(i.qty)||0, unit_price:Number(i.unit_price)||Number(i.quoted_price)||0, quoted_price:Number(i.quoted_price)||0, target_price:Number(i.target_price)||0, tax_rate:Number(i.tax_rate)||0, sort_order:idx+1 })),
      notes: form.notes,
      // FIX 1: save customer payment terms so Finance page can detect advance orders
      payment_terms: customerPayTerms || '',
    };
  };

  const validate = (isDraft) => {
    if (!form.customer_id)   { toast.error('Select a customer'); return false; }
    // CHANGE 2: customer_ref is no longer mandatory — removed validation
    if (!isDraft && !form.po_number) { toast.error('PO Number is mandatory'); return false; }
    if (!isDraft && poFiles.length === 0) { toast.error('Please upload at least one PO file'); return false; }
    if (!isDraft && !form.tentative_date) { toast.error('Expected delivery date is required'); return false; }
    const valid = items.filter(i => i.component.trim());
    if (!valid.length) { toast.error('Add at least one line item'); return false; }
    return true;
  };

  const handleSaveDraft = () => { if (validate(true))  mutation.mutate(buildPayload('draft')); };
  const handleCreate    = () => { if (validate(false)) mutation.mutate(buildPayload('open')); };

  // Column defs for inline line items
  const fmtMoney = (n, cur) => {
    const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'};
    return (sym[cur]||cur+' ') + Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  };
  const cols = [
    { key:'component',    label:'Component *',  flex:'2 1 120px',
      render:(li,idx)=><input className="input" value={li.component} onChange={e=>upd(idx,'component',e.target.value)} placeholder="e.g. STM32F103"/> },
    { key:'manufacturer', label:'Manufacturer', flex:'1.3 1 95px',
      render:(li,idx)=><input className="input" value={li.manufacturer} onChange={e=>upd(idx,'manufacturer',e.target.value)} placeholder="e.g. ST"/> },
    { key:'ipn',          label:'IPN',          flex:'0.85 1 70px',
      render:(li,idx)=><input className="input" value={li.ipn} onChange={e=>upd(idx,'ipn',e.target.value)} placeholder="IPN-001"/> },
    { key:'qty',          label:'Qty',          flex:'0.5 1 50px',
      render:(li,idx)=><input className="input" type="number" value={li.qty} onChange={e=>upd(idx,'qty',e.target.value)} placeholder="0"/> },

    /* ── Quoted Price — populated from sourcing, editable as fallback ── */
    { key:'unit_price', label:'Quote Price / Unit', flex:'1.1 1 95px',
      render:(li,idx)=>{
        const hasLocked = !!li.quoted_price;
        return hasLocked
          ? /* Locked from sourcing — show read-only green pill */
            <div style={{padding:'7px 10px',background:'var(--green-lt)',borderRadius:'var(--r-sm)',
              color:'var(--green)',fontWeight:800,fontSize:13,border:'1px solid var(--green)44',
              textAlign:'right',whiteSpace:'nowrap',letterSpacing:'-.01em'}}>
              {fmtMoney(li.quoted_price, li.currency)}
            </div>
          : /* Manual order — editable */
            <input className="input" type="number" step="0.01"
              value={li.unit_price} onChange={e=>upd(idx,'unit_price',e.target.value)}
              placeholder="0.00"/>;
      }
    },

    /* ── Target Price — read-only amber pill ── */
    { key:'target_price', label:'Target Price', flex:'0.95 1 80px',
      render:(li,idx)=>{
        const tp = li.target_price;
        return tp
          ? <div style={{padding:'5px 8px',background:'var(--amber-lt,#fffbeb)',borderRadius:'var(--r-sm)',
              color:'var(--amber,#d97706)',fontWeight:700,fontSize:12,
              border:'1px solid var(--amber,#d97706)44',textAlign:'right',whiteSpace:'nowrap'}}>
              🎯 {fmtMoney(tp, li.currency)}
            </div>
          : <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
      }
    },

    /* ── CHANGE 4: Margin % = ((Quoted×QTY - Sourced×QTY) / Quoted×QTY) × 100 ── */
    { key:'margin', label:'Margin %', flex:'0.75 1 65px',
      render:(li,idx)=>{
        const qty       = Number(li.qty)||0;
        const quoted    = Number(li.unit_price)||Number(li.quoted_price)||0;
        const sourced   = Number(li.procurement_price)||0;
        const qRev      = quoted * qty;
        if (!qRev || !sourced) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        const sRev      = sourced * qty;
        const pct       = ((qRev - sRev) / qRev * 100).toFixed(1);
        const col = Number(pct) < 0  ? 'var(--red)'
          : Number(pct) <= 10 ? 'var(--amber,#d97706)'
          : Number(pct) <= 15 ? 'var(--green)'
          : '#ca8a04';
        const bg = Number(pct) < 0  ? 'var(--red-lt,#fef2f2)'
          : Number(pct) <= 10 ? 'var(--amber-lt,#fffbeb)'
          : Number(pct) <= 15 ? 'var(--green-lt)'
          : '#fefce8';
        return (
          <div style={{padding:'5px 8px',background:bg,borderRadius:'var(--r-sm)',
            fontWeight:700,fontSize:11,textAlign:'right',
            color:col,border:`1px solid ${col}33`}}>
            {Number(pct)>=0?'+':''}{pct}%
          </div>
        );
      }
    },

    { key:'currency',      label:'Cur.',                flex:'0.55 1 52px',
      render:(li,idx)=><select className="input" value={li.currency} onChange={e=>upd(idx,'currency',e.target.value)}>
        {['INR','USD','EUR','SGD','GBP','AED'].map(c=><option key={c}>{c}</option>)}
      </select>
    },
    // CHANGE 3: Promised Delivery Date removed from line items view
    // (delivery_date still saved in state and sent in payload — only hidden from UI)
    // CHANGE 5: Status col removed from New Order view
    // (line_status still initialised as 'negotiating' in state and sent in payload)

    /* ── CHANGE 6: Base Value = Unit Price × QTY ── */
    { key:'base_value', label:'Base Value', flex:'1 1 88px',
      render:(li,idx)=>{
        const qty = Number(li.qty)||0;
        const up  = Number(li.unit_price)||Number(li.quoted_price)||0;
        if (!qty || !up) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        return (
          <div style={{padding:'6px 10px',background:'var(--surface2)',borderRadius:'var(--r-sm)',
            fontWeight:700,fontSize:13,textAlign:'right',whiteSpace:'nowrap',
            border:'1px solid var(--border)',color:'var(--text)'}}>
            {fmtMoney(qty*up, li.currency)}
          </div>
        );
      }
    },
    /* ── CHANGE 7: Tax % — from sourcing for this line item ── */
    { key:'tax_pct', label:'Tax %', flex:'0.55 1 52px',
      render:(li,idx)=>(
        <div style={{padding:'6px 8px',textAlign:'right',fontSize:12,
          color:Number(li.tax_rate)>0?'var(--teal,#0d9488)':'var(--text3)'}}>
          {Number(li.tax_rate)||0}%
        </div>
      )
    },
    /* ── CHANGE 8: Total Value = Base Value + Tax ── */
    { key:'total_value', label:'Total Value', flex:'1 1 88px',
      render:(li,idx)=>{
        const qty  = Number(li.qty)||0;
        const up   = Number(li.unit_price)||Number(li.quoted_price)||0;
        const base = qty * up;
        const tax  = Number(li.tax_rate)||0;
        const tot  = base + (base * tax / 100);
        if (!base) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        return (
          <div style={{padding:'6px 10px',background:tax>0?'var(--green-lt)':'var(--surface2)',
            borderRadius:'var(--r-sm)',fontWeight:700,fontSize:13,textAlign:'right',
            whiteSpace:'nowrap',border:'1px solid var(--border)',
            color:tax>0?'var(--green)':'var(--text)'}}>
            {fmtMoney(tot, li.currency)}
            {tax>0&&<span style={{fontSize:9,marginLeft:4,fontWeight:600,opacity:.7}}>+{tax}%</span>}
          </div>
        );
      }
    },
  ];

  const busy = mutation.isPending;

  return (
    <div style={{ maxWidth: 1500 }}>
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <div className="card-title" style={{ marginBottom:0 }}>Create New Order</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:11, color:'var(--text3)' }}>Order ID</span>
            <span style={{ fontFamily:'DM Mono,monospace', fontWeight:700, fontSize:15, color:'var(--accent)', background:'var(--accent-lt)', padding:'4px 12px', borderRadius:'var(--r-sm)' }}>{orderId}</span>
          </div>
        </div>

        {/* ── Linked Enquiry / Quote — read-only reference, hidden when empty ── */}
        {(form.enquiry_id || form.quote_id) && (
          <div style={{display:'flex',gap:16,alignItems:'center',padding:'8px 14px',
            background:'var(--accent-lt)',border:'1px solid var(--accent)22',
            borderRadius:'var(--r-sm)',marginBottom:13,fontSize:12}}>
            {form.enquiry_id && (
              <span>📋 Enquiry: <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{form.enquiry_id}</span></span>
            )}
            {form.quote_id && (
              <span>📄 Quote: <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{form.quote_no}</span></span>
            )}
          </div>
        )}

        {/* ── Order Details ── */}
        <div className="section-divider">Order Details</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:13, marginBottom:13 }}>
          <div className="form-group">
            <label className="label">Customer <span className="req">*</span></label>
            {/* CHANGE 1: lock customer when prefilled from enquiry/quote */}
            {form.customer_id && (form.enquiry_id || form.quote_id)
              ? <div style={{padding:'8px 12px',background:'var(--surface2)',borderRadius:'var(--r-sm)',
                  border:'1px solid var(--border)',fontWeight:600,fontSize:13,
                  color:'var(--text)',display:'flex',alignItems:'center',gap:6}}>
                  🔒 {customers.find(c=>c.id===form.customer_id)?.name||form.customer_id}
                </div>
              : <select className="input" value={form.customer_id} onChange={e=>setForm(f=>({...f,customer_id:e.target.value}))}>
                  <option value="">— Select Customer —</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            }
          </div>
          <div className="form-group">
            {/* CHANGE 2: Customer Ref made non-mandatory */}
            <label className="label">Customer Ref / Order No.</label>
            <input className="input" value={form.customer_ref} onChange={e=>setForm(f=>({...f,customer_ref:e.target.value}))} placeholder="e.g. TB-2024-045" />
          </div>
          <div className="form-group">
            <label className="label">PO Number <span className="req">*</span></label>
            <input className="input" value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))} placeholder="PO-TB-001" />
          </div>
          <div className="form-group">
            <label className="label">Expected Delivery Date <span className="req">*</span></label>
            <input className="input" type="date" value={form.tentative_date} onChange={e=>setForm(f=>({...f,tentative_date:e.target.value}))} />
          </div>
        </div>

        {/* ── Customer Info Strip ── */}
        {selectedCustomer && (
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'center',
            background:'var(--accent-lt)', border:'1px solid var(--accent)33',
            borderRadius:'var(--r-sm)', padding:'10px 16px', marginBottom:14, fontSize:13 }}>
            <div>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>CUSTOMER</span>
              <div style={{fontWeight:700,color:'var(--text)'}}>{selectedCustomer.name}</div>
            </div>
            {selectedCustomer.customer_no && (
              <div>
                <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>CUST NO.</span>
                <div className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{selectedCustomer.customer_no}</div>
              </div>
            )}
            <div>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>DEFAULT PAYMENT TERMS</span>
              <div style={{fontWeight:600,color: isFullAdvance(customerPayTerms)||isPartialAdvance(customerPayTerms) ? 'var(--amber,#d97706)' : 'var(--text)'}}>
                {customerPayTerms || '—'}
              </div>
            </div>
            {selectedCustomer.currency && (
              <div>
                <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>CURRENCY</span>
                <div style={{fontWeight:600}}>{selectedCustomer.currency}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Delivery (Shipping) Address — live from customer record ── */}
        {selectedCustomer && (() => {
          let shippingAddresses = [];
          try {
            const raw = JSON.parse(selectedCustomer.shipping_addresses||'[]');
            // Deduplicate by stringified address content
            const seen = new Set();
            shippingAddresses = raw.filter(addr => {
              const key = [addr.attention,addr.street1,addr.street2,addr.city,addr.state,addr.country,addr.pincode].filter(Boolean).join('|');
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          } catch(_) {}
          const hasShipping = shippingAddresses.length > 0;
          return (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--text2)',marginBottom:6}}>
                📦 Delivery Address
                <span style={{fontSize:11,fontWeight:400,color:'var(--text3)',marginLeft:8}}>
                  (live from customer profile)
                </span>
              </div>
              {!hasShipping ? (
                <div style={{padding:'8px 14px',borderRadius:'var(--r-sm)',
                  background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)44',
                  fontSize:12,color:'var(--amber,#d97706)',fontWeight:600}}>
                  ⚠ No shipping addresses on file for this customer.
                  <a href="/customers" style={{marginLeft:8,color:'var(--accent)'}}>Add in Customers →</a>
                </div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10}}>
                  {shippingAddresses.map((addr,i)=>{
                    const addrStr = [addr.attention,addr.street1,addr.street2,addr.city,addr.state,addr.country,addr.pincode].filter(Boolean).join(', ');
                    const isSelected = form.delivery_address === addrStr;
                    return (
                      <div key={i} onClick={()=>setForm(f=>({...f,delivery_address:isSelected?'':addrStr}))}
                        style={{cursor:'pointer',padding:'10px 14px',borderRadius:'var(--r)',
                          border:`2px solid ${isSelected?'var(--accent)':'var(--border)'}`,
                          background:isSelected?'var(--accent-lt)':'var(--surface2)'}}>
                        {addr.attention&&<div style={{fontWeight:700,fontSize:13}}>{addr.attention}</div>}
                        <div style={{fontSize:12,color:isSelected?'var(--accent)':'var(--text2)',lineHeight:1.5}}>
                          {[addr.street1,addr.street2].filter(Boolean).join(', ')}<br/>
                          {[addr.city,addr.state,addr.country,addr.pincode].filter(Boolean).join(', ')}
                          {addr.phone&&<div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>📞 {addr.phone}</div>}
                        </div>
                        {isSelected&&<div style={{fontSize:11,color:'var(--accent)',fontWeight:700,marginTop:4}}>✅ Selected</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {form.delivery_address&&(
                <div style={{marginTop:6,fontSize:11,color:'var(--text3)'}}>
                  Selected: <strong style={{color:'var(--accent)'}}>{form.delivery_address}</strong>
                  <button className="btn btn-xs" style={{marginLeft:8}} onClick={()=>setForm(f=>({...f,delivery_address:''}))}>Clear</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── PO Upload ── */}
        <div className="section-divider">
          PO Document Upload <span className="req">*</span>
          <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>Mandatory — upload before creating the order</span>
        </div>
        <div style={{ marginBottom:16 }}>
          <POUpload files={poFiles} onChange={setPoFiles} />
        </div>

        {/* ── Line Items ── */}
        <div className="section-divider">Line Items</div>

        {/* Header */}
        <div style={{ display:'flex', gap:6, alignItems:'center', padding:'0 6px 7px 6px', borderBottom:'1px solid var(--border)', marginBottom:4 }}>
          <div style={{ flex:'0 0 22px' }} />
          {cols.map(c=>(
            <div key={c.key} style={{ flex:c.flex, minWidth:0 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text2)', whiteSpace:'nowrap' }}>{c.label}</span>
            </div>
          ))}
          <div style={{ flex:'0 0 26px' }} />
        </div>

        {/* Rows */}
        {items.map((li, idx) => (
          <div key={li.id} style={{ display:'flex', gap:6, alignItems:'center', padding:'4px 6px', borderRadius:'var(--r-sm)', marginBottom:3, background:idx%2===0?'transparent':'var(--surface2)' }}>
            <div style={{ flex:'0 0 22px', fontSize:11, fontWeight:600, color:'var(--text3)', textAlign:'center' }}>{idx+1}</div>
            {cols.map(c=>(
              <div key={c.key} style={{ flex:c.flex, minWidth:0 }}>{c.render(li,idx)}</div>
            ))}
            <div style={{ flex:'0 0 26px', display:'flex', justifyContent:'center' }}>
              {items.length > 1
                ? <button className="btn btn-xs btn-danger" style={{ padding:'1px 7px', fontSize:15, lineHeight:1 }} onClick={()=>removeItem(idx)}>×</button>
                : <span />}
            </div>
          </div>
        ))}

        <button className="btn btn-sm" onClick={addItem} style={{ marginTop:10, marginBottom:10 }}>+ Add Line Item</button>

        {/* ── Order Total Summary ── */}
        {(() => {
          const allItems = items.filter(i => i.component.trim() && i.qty);
          if (!allItems.length) return null;
          const fmt = (n, cur) => {
            const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'};
            return (sym[cur]||cur+' ') + n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
          };
          // Quoted total (from sourcing)
          const quotedByCur = {};
          allItems.forEach(li => {
            const qp = Number(li.quoted_price); if (!qp) return;
            const c = li.currency||'INR';
            quotedByCur[c] = (quotedByCur[c]||0) + qp*(Number(li.qty)||0);
          });
          // Confirmed total (user-entered)
          const confirmedByCur = {};
          allItems.forEach(li => {
            const up = Number(li.unit_price); if (!up) return;
            const c = li.currency||'INR';
            confirmedByCur[c] = (confirmedByCur[c]||0) + up*(Number(li.qty)||0);
          });
          const hasQuoted    = Object.keys(quotedByCur).length > 0;
          const hasConfirmed = Object.keys(confirmedByCur).length > 0;
          if (!hasQuoted && !hasConfirmed) return null;
          return (
            <div style={{display:'flex',gap:16,alignItems:'center',justifyContent:'flex-end',
              padding:'12px 16px',marginBottom:16,borderRadius:'var(--r)',
              background:'var(--surface2)',border:'1px solid var(--border)'}}>
              <span style={{fontSize:12,color:'var(--text2)',fontWeight:600}}>
                {allItems.length} line item{allItems.length!==1?'s':''}
              </span>
              <span style={{color:'var(--border)',fontSize:18}}>|</span>
              {hasQuoted && (
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:2}}>QUOTED VALUE</div>
                  {Object.entries(quotedByCur).map(([cur,val])=>(
                    <span key={cur} style={{fontSize:16,fontWeight:800,color:'var(--green)',letterSpacing:'-.02em'}}>{fmt(val,cur)}</span>
                  ))}
                </div>
              )}
              {hasQuoted && hasConfirmed && Object.keys(confirmedByCur).some(c=>confirmedByCur[c]!==quotedByCur[c]) && (
                <>
                  <span style={{color:'var(--border)',fontSize:18}}>→</span>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:2}}>CONFIRMED VALUE</div>
                    {Object.entries(confirmedByCur).map(([cur,val])=>(
                      <span key={cur} style={{fontSize:16,fontWeight:800,color:'var(--accent)',letterSpacing:'-.02em'}}>{fmt(val,cur)}</span>
                    ))}
                  </div>
                </>
              )}
              {!hasQuoted && hasConfirmed && (
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:2}}>ORDER TOTAL</div>
                  {Object.entries(confirmedByCur).map(([cur,val])=>(
                    <span key={cur} style={{fontSize:16,fontWeight:800,color:'var(--accent)',letterSpacing:'-.02em'}}>{fmt(val,cur)}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <div className="form-group">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
        </div>

        {/* ── Actions ── */}
        <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, borderTop:'1px solid var(--border)', paddingTop:16 }}>
          <button className="btn" onClick={()=>navigate('/orders')} disabled={busy}>Cancel</button>
          <button className="btn" onClick={handleSaveDraft} disabled={busy}
            style={{ color:'var(--text2)', borderColor:'var(--border-md)' }}>
            {busy ? '…' : '💾 Save Draft'}
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
            {busy ? 'Creating…' : '📋 Create Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
