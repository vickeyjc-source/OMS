// client/src/pages/NewOrderPage.js  v3
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { today } from '../utils/helpers';
import { PhoneField, CountrySelect, StateSelect, CitySelect } from '../components/AddressForm';

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
function POUpload({ files, onChange, orderId }) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({}); // filename → 0-100
  const inputRef = useRef();

  const processFiles = (incoming) => {
    const newFiles = Array.from(incoming).filter(f => !files.find(x => x.name === f.name));
    if (!newFiles.length) return;
    const pendingFiles = newFiles.map(f => ({
      tempId: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      file: f,
      status: 'uploading',
    }));
    onChange(prev => [...prev, ...pendingFiles]);

    newFiles.forEach(f => {
      setProgress(p => ({ ...p, [f.name]: 0 }));
      let pct = 5;
      const iv = setInterval(() => {
        pct = Math.min(90, pct + Math.floor(Math.random() * 18) + 7);
        setProgress(p => ({ ...p, [f.name]: pct }));
      }, 180);

      const pending = pendingFiles.find(x => x.file === f);
      const formData = new FormData();
      formData.append('file', f);
      formData.append('entity_type', 'order');
      formData.append('entity_id', orderId || 'unassigned');
      formData.append('field_name', 'po_file');

      api.post('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }).then(r => {
        clearInterval(iv);
        setProgress(p => ({ ...p, [f.name]: 100 }));
        onChange(prev => prev.map(x => x.tempId === pending.tempId
          ? { ...x, ...r.data, id: r.data.id, ref: r.data.id, status: 'uploaded', file: null }
          : x));
      }).catch(e => {
        clearInterval(iv);
        setProgress(p => ({ ...p, [f.name]: 0 }));
        onChange(prev => prev.map(x => x.tempId === pending.tempId
          ? { ...x, status: 'error', error: e.response?.data?.error || e.message }
          : x));
        toast.error('Upload failed: ' + f.name);
      });
    });
  };

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    processFiles(e.dataTransfer.files);
  }, [files]);

  const remove = file => onChange(files.filter(f => (f.id || f.tempId || f.name) !== (file.id || file.tempId || file.name)));

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
            <div key={f.id || f.tempId || f.name} style={{ background: 'var(--surface2)', borderRadius: 'var(--r-sm)', padding: '8px 12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: progress[f.name] < 100 ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📄</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: 10, color: f.status === 'error' ? 'var(--red)' : 'var(--text3)' }}>
                      {f.status === 'error' ? f.error : f.size ? (f.size / 1024).toFixed(1) + ' KB' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {f.status === 'error'
                    ? <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>Failed</span>
                    : (progress[f.name] ?? 100) >= 100 && f.status === 'uploaded'
                    ? <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Ready</span>
                    : <span style={{ fontSize: 11, color: 'var(--accent)' }}>{progress[f.name]}%</span>}
                  {f.download_url && (
                    <a href={f.download_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Download</a>
                  )}
                  <button onClick={() => remove(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
              </div>
              {f.status === 'uploading' && (
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

// ── Delivery Address Panel ────────────────────────────────────────────────────
function DeliveryAddressPanel({ customer, selectedAddress, onSelect, onCustomerUpdated, isIntl }) {
  const [editIdx, setEditIdx] = useState(null); // null | 'new' | number
  const [draft,   setDraft]   = useState({});
  const [saving,  setSaving]  = useState(false);

  const addresses = (() => {
    try { return JSON.parse(customer.shipping_addresses || '[]'); } catch(_) { return []; }
  })();

  const addrStr = a =>
    [a.attention, a.street1, a.street2, a.city, a.state, a.country, a.pincode].filter(Boolean).join(', ');

  const startEdit = idx => {
    setEditIdx(idx);
    setDraft(idx === 'new' ? { country: isIntl ? '' : 'India' } : { ...addresses[idx] });
  };
  const cancelEdit = () => { setEditIdx(null); setDraft({}); };

  const saveAddress = async () => {
    const newList = editIdx === 'new'
      ? [...addresses, draft]
      : addresses.map((a, i) => i === editIdx ? draft : a);
    setSaving(true);
    try {
      await api.put('/customers/' + customer.id, {
        ...customer,
        shipping_addresses: newList,
        contact_persons: (() => { try { return JSON.parse(customer.contact_persons || '[]'); } catch(_) { return []; } })(),
      });
      onCustomerUpdated(newList);
      const str = addrStr(draft);
      if (str) onSelect(str);
      cancelEdit();
      toast.success('Address saved & selected');
    } catch(e) {
      toast.error('Could not save address');
    } finally {
      setSaving(false);
    }
  };

  const setD = (k, v) => setDraft(d => {
    const n = { ...d, [k]: v };
    if (k === 'country') { n.state = ''; n.city = ''; }
    if (k === 'state')   { n.city = ''; }
    return n;
  });

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--text2)' }}>
          📦 Delivery Address
          <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>
            (synced with customer profile)
          </span>
        </div>
        {editIdx !== 'new' && (
          <button className="btn btn-xs btn-primary" onClick={() => startEdit('new')} style={{ fontSize:11 }}>
            + Add New Address
          </button>
        )}
      </div>

      {/* ── No addresses warning ── */}
      {addresses.length === 0 && editIdx !== 'new' && (
        <div style={{ padding:'8px 14px', borderRadius:'var(--r-sm)',
          background:'var(--amber-lt,#fffbeb)', border:'1px solid var(--amber,#d97706)44',
          fontSize:12, color:'var(--amber,#d97706)', fontWeight:600, marginBottom:10 }}>
          ⚠ No shipping addresses on file — click "+ Add New Address" above.
        </div>
      )}

      {/* ── Address Rows ── */}
      {addresses.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6,
          marginBottom: editIdx !== null ? 10 : 0 }}>
          {addresses.map((addr, i) => {
            const str        = addrStr(addr);
            const isSelected = selectedAddress === str;
            const isEditing  = editIdx === i;
            const oneLine    = [
              addr.attention,
              [addr.street1, addr.street2].filter(Boolean).join(', '),
              [addr.city, addr.state, addr.country, addr.pincode].filter(Boolean).join(', '),
            ].filter(Boolean).join('  •  ');
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'9px 14px', borderRadius:'var(--r)',
                border:`2px solid ${isEditing?'var(--accent)':isSelected?'var(--green,#16a34a)':'var(--border)'}`,
                background: isEditing?'var(--accent-lt)':isSelected?'var(--green-lt,#f0fdf4)':'var(--surface2)',
                transition:'border-color .15s,background .15s', cursor: isEditing?'default':'pointer',
              }}
                onClick={() => !isEditing && !isSelected && onSelect(str)}>
                {/* selection indicator */}
                <span style={{ fontSize:15, flexShrink:0 }}>
                  {isSelected ? '✅' : '○'}
                </span>
                {/* single-line address */}
                <span style={{ flex:1, fontSize:12, color:'var(--text)', overflow:'hidden',
                  textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight: isSelected?600:400 }}>
                  {oneLine || '(no address details)'}
                </span>
                {/* phone pill */}
                {addr.phone && (
                  <span style={{ fontSize:11, color:'var(--text3)', whiteSpace:'nowrap',
                    flexShrink:0, marginRight:4 }}>
                    📞 {addr.phone}
                  </span>
                )}
                {/* edit button */}
                {!isEditing && (
                  <button
                    onClick={e => { e.stopPropagation(); startEdit(i); }}
                    style={{ flexShrink:0, background:'var(--surface)', border:'1px solid var(--border-md)',
                      borderRadius:'var(--r-sm)', padding:'2px 10px', fontSize:11, cursor:'pointer',
                      color:'var(--text2)', lineHeight:1.6 }}>
                    ✏ Edit
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit / New form ── */}
      {editIdx !== null && (
        <div style={{ border:'1px solid var(--accent)', borderRadius:'var(--r)',
          padding:'16px 18px', background:'var(--surface)', marginTop:4 }}>
          <div style={{ fontWeight:700, fontSize:12, color:'var(--accent)', marginBottom:14 }}>
            {editIdx === 'new' ? '➕ New Delivery Address' : `✏ Edit Address ${editIdx + 1}`}
          </div>

          {/* Row 1: Attention | Phone | Street 1 | Street 2 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Attention / Name</label>
              <input className="input" value={draft.attention||''} placeholder="Contact person"
                onChange={e => setD('attention', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Phone</label>
              <PhoneField value={draft.phone||''} onChange={v => setD('phone', v)}
                domestic={!isIntl} excludeIndia={isIntl} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Street 1</label>
              <input className="input" value={draft.street1||''} placeholder="Street 1"
                onChange={e => setD('street1', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Street 2</label>
              <input className="input" value={draft.street2||''} placeholder="Street 2"
                onChange={e => setD('street2', e.target.value)} />
            </div>
          </div>

          {/* Row 2: Country | State | City | Pincode */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:16 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Country</label>
              <CountrySelect value={draft.country||''} onChange={v => setD('country', v)} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">State / Province</label>
              <StateSelect key={draft.country} country={draft.country||''} value={draft.state||''}
                onChange={v => setD('state', v)} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">City</label>
              <CitySelect key={`${draft.country}__${draft.state}`}
                country={draft.country||''} state={draft.state||''}
                value={draft.city||''} onChange={v => setD('city', v)} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="label">Pincode / Zip</label>
              <input className="input" value={draft.pincode||''} placeholder="Pincode"
                onChange={e => setD('pincode', e.target.value)} />
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-sm btn-primary" onClick={saveAddress} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save & Select'}
            </button>
            <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Selected summary (when form is closed) ── */}
      {editIdx === null && selectedAddress && (
        <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:10,
          padding:'8px 14px', borderRadius:'var(--r-sm)',
          background:'var(--green-lt,#f0fdf4)', border:'1px solid var(--green,#16a34a)44',
          fontSize:12 }}>
          <span style={{ color:'var(--green,#16a34a)', fontWeight:700 }}>✅ Selected:</span>
          <span style={{ color:'var(--text2)', flex:1 }}>{selectedAddress}</span>
          <button className="btn btn-xs" onClick={() => onSelect('')}
            style={{ color:'var(--red)', borderColor:'var(--red)', background:'transparent' }}>
            Clear
          </button>
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
    customer_id:      prefill?.customer_id || '',
    delivery_address: prefill?.delivery_address || '',
    customer_ref:     prefill?.customer_ref || '',
    enquiry_id:       prefill?.enquiry_id  || '',
    quote_id:         prefill?.quote_id    || '',
    enquiry_no:       prefill?.enquiry_no  || '',
    quote_no:         prefill?.quote_no    || '',
    po_number:        prefill?.po_number   || '',
    tentative_date:   prefill?.tentative_date || '',
    notes: prefill?.notes || (prefill?.quote_no ? 'From Quote ' + prefill.quote_no + (prefill.zoho_quote_no ? ' (Zoho: ' + prefill.zoho_quote_no + ')' : '') : ''),
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

  // Navigate to linked enquiry for editing, then back through sourcing → quote → order
  const handleEditViaEnquiry = () => {
    const enq = enquiries.find(e => e.id === form.enquiry_id);
    if (!enq) { toast.error('Linked enquiry not found — check enquiry ID'); return; }
    navigate('/enquiries/new', { state: { editEnquiry: enq, returnToOrder: true } });
  };

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
      console.log('[NET MARGIN DEBUG]', lineItems?.map(li => ({
        component: li.component,
        quote_price: li.quote_price,
        sourced_price: li.sourced_price,
        margin_inr: li.margin_inr,
        margin_pct: li.margin_pct,
      })));
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
          net_margin_amt:   li.margin_inr   != null ? li.margin_inr   : null,
          net_margin_pct:   li.margin_pct   != null ? li.margin_pct   : null,
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

  const existingOrderId = prefill?.existing_order_id || null;

  const mutation = useMutation({
    mutationFn: d => {
      if (existingOrderId) {
        // Update existing order with revised line items and new quote reference
        return api.put('/orders/' + existingOrderId, {
          ...d,
          quote_id:  d.quote_id  || form.quote_id,
          quote_no:  d.quote_no  || form.quote_no,
          lineItems: d.lineItems,
          _action: 'Order revised — items updated from ' + (d.quote_no || form.quote_no),
          _comment: '',
        });
      }
      return api.post('/orders', d);
    },
    onSuccess: r => {
      qc.invalidateQueries(['orders']);
      if (existingOrderId) {
        toast.success('✅ Order updated with revised items!');
      } else {
        toast.success('Order ' + r.data.id + ' created!');
      }
      navigate('/orders');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const buildPayload = (status) => {
    const valid = items.filter(i => i.component.trim());
    return {
      ...form,
      id: orderId,
      status,
      po_file_ref: poFiles.filter(f=>f.status === 'uploaded').map(f=>f.id).join(','),
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
    if (poFiles.some(f => f.status === 'uploading')) { toast.error('Please wait for file upload to finish'); return false; }
    if (poFiles.some(f => f.status === 'error')) { toast.error('Remove failed uploads and try again'); return false; }
    if (!isDraft && !form.tentative_date) { toast.error('Expected delivery date is required'); return false; }
    const valid = items.filter(i => i.component.trim());
    if (!valid.length) { toast.error('Add at least one line item'); return false; }
    return true;
  };

  const handleSaveDraft = () => { if (validate(true))  mutation.mutate(buildPayload('draft')); };
  const handleCreate    = () => { if (validate(false)) mutation.mutate(buildPayload('open')); };

  // Column defs for read-only line items (all from enquiry/quote — no editing here)
  const fmtMoney = (n, cur) => {
    const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'};
    return (sym[cur]||cur+' ') + Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  };
  const readCell = (val, opts={}) => (
    <div style={{
      padding:'7px 10px', fontSize: opts.mono?12:13,
      fontFamily: opts.mono?'DM Mono,monospace':'inherit',
      fontWeight: opts.bold?700:opts.mono?600:400,
      color: opts.color||'var(--text)',
      background: opts.bg||'transparent',
      borderRadius: opts.bg?'var(--r-sm)':0,
      border: opts.bg?'1px solid var(--border)':'none',
      textAlign: opts.right?'right':'left',
      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
    }}>
      {val || <span style={{color:'var(--text3)'}}>—</span>}
    </div>
  );
  const cols = [
    { key:'component',    label:'Component',     flex:'2 1 120px',
      render:(li)=>readCell(li.component,{bold:true}) },
    { key:'manufacturer', label:'Manufacturer',  flex:'1.3 1 95px',
      render:(li)=>readCell(li.manufacturer) },
    { key:'ipn',          label:'IPN',           flex:'0.85 1 70px',
      render:(li)=>readCell(li.ipn,{mono:true}) },
    { key:'qty',          label:'Qty',           flex:'0.5 1 50px',
      render:(li)=>readCell(li.qty,{right:true,bold:true}) },

    /* ── Quote Price — from sourcing (locked) ── */
    { key:'unit_price', label:'Quote Price / Unit', flex:'1.1 1 95px',
      render:(li)=>{
        const price = Number(li.quoted_price)||Number(li.unit_price)||0;
        if (!price) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        return (
          <div style={{padding:'7px 10px',background:'var(--green-lt)',borderRadius:'var(--r-sm)',
            color:'var(--green)',fontWeight:800,fontSize:13,border:'1px solid var(--green)44',
            textAlign:'right',whiteSpace:'nowrap',letterSpacing:'-.01em'}}>
            {fmtMoney(price, li.currency)}
          </div>
        );
      }
    },

    /* ── Target Price — read-only amber pill ── */
    { key:'target_price', label:'Target Price', flex:'0.95 1 80px',
      render:(li)=>{
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

    /* ── Net Margin ── */
    { key:'margin', label:'Net Margin', flex:'1.1 1 95px',
      render:(li)=>{
        const qty     = Number(li.qty) || 0;
        const quote   = Number(li.unit_price) || Number(li.quoted_price) || 0;
        const source  = Number(li.procurement_price) || 0;
        if (!qty || !quote || !source) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        const netAmt  = (quote - source) * qty;
        const pct     = ((quote - source) / source) * 100;
        const col = netAmt < 0 ? 'var(--red)'
          : pct <= 10 ? 'var(--amber,#d97706)'
          : 'var(--green,#16a34a)';
        const bg  = netAmt < 0 ? 'var(--red-lt,#fef2f2)'
          : pct <= 10 ? 'var(--amber-lt,#fffbeb)'
          : 'var(--green-lt,#f0fdf4)';
        return (
          <div style={{padding:'5px 8px',background:bg,borderRadius:'var(--r-sm)',
            border:`1px solid ${col}33`,textAlign:'right'}}>
            <div style={{fontWeight:700,fontSize:12,color:col,whiteSpace:'nowrap'}}>
              {netAmt<0?'-':'+'}₹{Math.abs(netAmt).toLocaleString('en-IN',{maximumFractionDigits:0})}
            </div>
            <div style={{fontSize:10,color:col,opacity:.8,marginTop:1}}>
              {pct>=0?'+':''}{pct.toFixed(1)}%
            </div>
          </div>
        );
      }
    },

    { key:'currency', label:'Cur.', flex:'0.55 1 52px',
      render:(li)=>readCell(li.currency,{mono:true,color:'var(--text2)'}) },

    /* ── Base Value = Unit Price × QTY ── */
    { key:'base_value', label:'Base Value', flex:'1 1 88px',
      render:(li)=>{
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
    /* ── Tax % ── */
    { key:'tax_pct', label:'Tax %', flex:'0.55 1 52px',
      render:(li)=>(
        <div style={{padding:'6px 8px',textAlign:'right',fontSize:12,
          color:Number(li.tax_rate)>0?'var(--teal,#0d9488)':'var(--text3)'}}>
          {Number(li.tax_rate)||0}%
        </div>
      )
    },
    /* ── Total Value = Base + Tax ── */
    { key:'total_value', label:'Total Value', flex:'1 1 88px',
      render:(li)=>{
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
          <div className="card-title" style={{ marginBottom:0 }}>{existingOrderId ? '✏ Update Order' : 'Create New Order'}</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {!existingOrderId && <>
              <span style={{ fontSize:11, color:'var(--text3)' }}>Order ID</span>
              <span style={{ fontFamily:'DM Mono,monospace', fontWeight:700, fontSize:15, color:'var(--accent)', background:'var(--accent-lt)', padding:'4px 12px', borderRadius:'var(--r-sm)' }}>{orderId}</span>
            </>}
          </div>
        </div>

        {/* ── Revision banner ── */}
        {existingOrderId && (
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
            background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)',
            borderRadius:'var(--r-sm)',marginBottom:14,fontSize:13}}>
            <span style={{fontSize:16}}>🔄</span>
            <div>
              <div style={{fontWeight:700,color:'var(--amber,#d97706)'}}>Revising existing order</div>
              <div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>
                Line items are updated from the revised quote. PO, delivery address and other details are pre-filled from the original order — change only what's needed, then click <strong>Update Order</strong>.
              </div>
            </div>
          </div>
        )}

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

        {/* ── Delivery Address Panel ── */}
        {selectedCustomer && (
          <DeliveryAddressPanel
            customer={selectedCustomer}
            selectedAddress={form.delivery_address}
            onSelect={str => setForm(f => ({ ...f, delivery_address: str }))}
            isIntl={selectedCustomer.customer_scope === 'international'}
            onCustomerUpdated={newAddresses => {
              qc.setQueryData(['customers'], prev =>
                (prev || []).map(c =>
                  c.id === selectedCustomer.id
                    ? { ...c, shipping_addresses: JSON.stringify(newAddresses) }
                    : c
                )
              );
            }}
          />
        )}

        {/* ── PO Upload ── */}
        <div className="section-divider">
          PO Document Upload <span className="req">*</span>
          <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>Mandatory — upload before creating the order</span>
        </div>
        <div style={{ marginBottom:16 }}>
          <POUpload files={poFiles} onChange={setPoFiles} orderId={orderId} />
        </div>

        {/* ── Line Items — read-only from enquiry/quote ── */}
        <div className="section-divider" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>Line Items <span style={{fontSize:11,fontWeight:400,color:'var(--text3)',marginLeft:6}}>Read-only · sourced from enquiry/quote</span></span>
          {form.enquiry_id && (
            <button className="btn btn-sm"
              onClick={handleEditViaEnquiry}
              style={{fontSize:12,fontWeight:600,color:'var(--accent)',borderColor:'var(--accent)',background:'var(--accent-lt)'}}>
              ✏ Modify Items via Enquiry
            </button>
          )}
        </div>

        {/* Header */}
        <div style={{ display:'flex', gap:6, alignItems:'center', padding:'0 6px 7px 6px', borderBottom:'1px solid var(--border)', marginBottom:4 }}>
          <div style={{ flex:'0 0 22px' }} />
          {cols.map(c=>(
            <div key={c.key} style={{ flex:c.flex, minWidth:0 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text2)', whiteSpace:'nowrap' }}>{c.label}</span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {items.map((li, idx) => (
          <div key={li.id} style={{ display:'flex', gap:6, alignItems:'center', padding:'4px 6px', borderRadius:'var(--r-sm)', marginBottom:3, background:idx%2===0?'transparent':'var(--surface2)' }}>
            <div style={{ flex:'0 0 22px', fontSize:11, fontWeight:600, color:'var(--text3)', textAlign:'center' }}>{idx+1}</div>
            {cols.map(c=>(
              <div key={c.key} style={{ flex:c.flex, minWidth:0 }}>{c.render(li,idx)}</div>
            ))}
          </div>
        ))}

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
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
            {busy ? (existingOrderId ? 'Updating…' : 'Creating…') : (existingOrderId ? '✅ Update Order' : '📋 Create Order')}
          </button>
        </div>
      </div>
    </div>
  );
}
