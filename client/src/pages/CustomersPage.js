// client/src/pages/CustomersPage.js  v3
import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmtDateTime } from '../utils/helpers';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { AddressForm, PhoneField, CountrySelect } from '../components/AddressForm';
import { State } from 'country-state-city';
import { ALL_CURRENCIES } from '../utils/currencies';

// ── India states (for Place of Supply dropdown) ───────────────────────────────
const _IN = State.getStatesOfCountry('IN');
const INDIA_STATES = _IN.map(s => s.name);


// ── Payment Terms — grouped by category ──────────────────────────────────────
const PAYMENT_TERMS_GROUPS = [
  {
    group: 'Advance Payment',
    terms: [
      'Advance Payment (AP) – Full payment before shipment',
      'Partial Advance – 30% upfront, 70% on delivery',
      'Partial Advance – 50% upfront, 50% on delivery',
      'Cash in Advance (CIA) – 100% before dispatch',
      'Cash Before Shipment (CBS) – Payment before goods ship',
    ]
  },
  {
    group: 'Delivery-Based',
    terms: [
      'Cash on Delivery (COD)',
      'Cash Against Delivery (CAD)',
    ]
  },
  {
    group: 'Letter of Credit (LC)',
    terms: [
      'Letter of Credit (LC)',
      'Irrevocable Letter of Credit',
      'Confirmed Letter of Credit',
      'Sight Letter of Credit – Payment on document submission',
      'Usance LC – 30 days',
      'Usance LC – 60 days',
      'Usance LC – 90 days',
    ]
  },
  {
    group: 'Documents & Bill of Exchange',
    terms: [
      'Documents Against Payment (D/P)',
      'Documents Against Acceptance (D/A)',
      'Bill of Exchange',
    ]
  },
  {
    group: 'Net Days',
    terms: [
      'Net 7 – Payment due in 7 days',
      'Net 15 – Payment due in 15 days',
      'Net 30 – Payment due in 30 days',
      'Net 45 – Payment due in 45 days',
      'Net 60 – Payment due in 60 days',
      'Net 90 – Payment due in 90 days',
      'End of Month (EOM)',
      'Net 30 EOM – 30 days after end of invoice month',
    ]
  },
  {
    group: 'Early Payment Discount',
    terms: [
      '2/10 Net 30 – 2% discount if paid in 10 days',
      '1/15 Net 45 – 1% discount if paid in 15 days',
    ]
  },
  {
    group: 'Progress / Milestone',
    terms: [
      'Progress Payment – As work progresses',
      'Milestone-Based Payment',
      'Stage Payment – Defined stages',
      'Retention Payment – Portion held until completion',
    ]
  },
  {
    group: 'Deferred / Consignment',
    terms: [
      'Consignment – Payment after goods are sold',
      'Sale or Return – Buyer can return unsold goods',
      'Deferred Payment – Postponed to agreed date',
    ]
  },
  {
    group: 'Recurring',
    terms: [
      'Monthly Payment',
      'Quarterly Payment',
      'Annual Prepaid – Full year upfront',
    ]
  },
];
// Flat list for legacy usage
const PAYMENT_TERMS = PAYMENT_TERMS_GROUPS.flatMap(g => g.terms);
const SALUTATIONS = ['Mr.','Ms.','Mrs.','Dr.','Prof.'];
const GST_TREATMENTS = ['Registered Business – Regular','Registered Business – Composition','Unregistered Business','Consumer','Overseas','Special Economic Zone'];

// ── Helpers ───────────────────────────────────────────────────────────────────
// Step wizard progress bar — numbered circles connected by a line. Click to
// jump back to any earlier step; forward steps stay locked until the ones
// before them are complete (see canReach in CustomerModal/SupplierModal).
function StepProgress({ steps, activeKey, onJump, canReach }) {
  return (
    <div style={{display:'flex',paddingBottom:16,marginBottom:14,borderBottom:'1px solid var(--border)',flexShrink:0}}>
      {steps.map((s,i) => {
        const isActive = s.key === activeKey;
        const isDone = s.done && !isActive;
        const reachable = canReach(s.key);
        return (
          <React.Fragment key={s.key}>
            <div style={{flex:1,textAlign:'center',cursor:reachable?'pointer':'not-allowed',opacity:reachable?1:0.4}}
              onClick={() => { if (reachable) onJump(s.key); else toast('Complete the earlier steps first'); }}>
              <div style={{width:26,height:26,borderRadius:'50%',margin:'0 auto 6px',display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:11.5,fontWeight:700,
                background: isActive ? 'var(--accent-lt)' : (isDone ? 'var(--accent)' : 'var(--surface)'),
                border: `2px solid ${isActive||isDone ? 'var(--accent)' : 'var(--border-md)'}`,
                color: isActive ? 'var(--accent)' : (isDone ? '#fff' : 'var(--text3)')}}>
                {isDone ? '✓' : i+1}
              </div>
              <div style={{fontSize:11,fontWeight:600,whiteSpace:'nowrap',
                color:isActive?'var(--accent)':(reachable?'var(--text2)':'var(--text3)')}}>
                {s.label}{s.optional && <span style={{fontWeight:400,color:'var(--text3)'}}> (optional)</span>}
              </div>
            </div>
            {i<steps.length-1 && <div style={{flex:'0 0 30px',height:2,background:isDone?'var(--accent)':'var(--border-md)',marginTop:13}}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}


// ── Shipping Address Block ────────────────────────────────────────────────────
function ShippingAddressBlock({ addr, idx, onChange, onRemove, canDelete, editMode, onSave, onAskDelete, domestic, excludeIndia }) {
  const [tried, setTried] = useState(false);
  const set = (k,v) => onChange({...addr,[k]:v});
  const label = addr.attention || addr.city || `Shipping Address ${idx+1}`;
  const addrLine = [addr.street1, addr.street2, addr.city, addr.state, addr.country, addr.pincode].filter(Boolean).join(', ');
  const isNew = !!addr._isNew;
  const req = k => tried && !addr[k];
  const handleSave = () => {
    setTried(true);
    if (!addr.street1 || !addr.city || !addr.state || !addr.country || !addr.pincode) {
      toast.error('Fill all required fields');
      return;
    }
    setTried(false);
    onSave();
  };
  return (
    <div style={{border:`1px solid ${isNew?'var(--accent)':'var(--border)'}`,borderRadius:'var(--r)',marginBottom:10,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--surface2)'}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontWeight:600,fontSize:13}}>{isNew ? <span style={{color:'var(--accent)',fontStyle:'italic',fontSize:12}}>New address — fill & save</span> : label}</div>
          {!editMode && !isNew && addrLine && <div style={{fontSize:11,color:'var(--text3)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{addrLine}</div>}
        </div>
        <div style={{display:'flex',gap:6,flexShrink:0,marginLeft:10}}>
          {editMode
            ? <button className="btn btn-xs btn-primary" onClick={handleSave}>💾 Save</button>
            : <button className="btn btn-xs" onClick={onSave}>✏ Edit</button>
          }
          {isNew
            ? <button className="btn btn-xs" style={{color:'var(--red)',borderColor:'var(--red)',background:'transparent'}} onClick={e=>{e.stopPropagation();onRemove();}}>✕ Discard</button>
            : canDelete && <button className="btn btn-xs" style={{color:'var(--red)',borderColor:'var(--red)',background:'transparent'}} onClick={e=>{e.stopPropagation();onAskDelete();}}>Delete</button>
          }
        </div>
      </div>
      {editMode && (
        <div style={{padding:'14px'}}>
          <AddressForm
            value={addr}
            onChange={onChange}
            required={['street1','city','state','country','pincode']}
            tried={tried}
            domestic={domestic}
            excludeIndia={excludeIndia}
          />
        </div>
      )}
    </div>
  );
}

// ── Bulk Upload Widget ────────────────────────────────────────────────────────
function BulkUpload({ onClose, onDone }) {
  const [file,    setFile]    = useState(null);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const inputRef = useRef();

  const parseExcel = async (f) => {
    setLoading(true);
    try {
      const XLSX = await import('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').catch(()=>null);
      // Use FileReader + manual CSV fallback since XLSX CDN may not work here
      const text = await f.text().catch(()=>null);
      if (text) {
        // CSV parsing
        const lines = text.split('\n').filter(l=>l.trim());
        const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,'_').replace(/\s*\*$/,''));
        const dataRows = lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h,i) => { obj[h] = (vals[i]||'').trim().replace(/^"|"$/g,''); });
          return obj;
        }).filter(r=>r.company_name||r['company name']);
        setRows(dataRows);
        setFile(f);
      }
    } catch(e) {
      toast.error('Could not parse file. Please use the CSV export of the template.');
    } finally { setLoading(false); }
  };

  const upload = async () => {
    if (!rows.length) { toast.error('No data rows found'); return; }
    setLoading(true);
    try {
      const res = await api.post('/customers/bulk', { rows: rows.map(r=>({
        name: r.company_name || r['company name'] || '',
        first_name: r.first_name||'', last_name: r.last_name||'',
        email: r.email||'', phone: r.phone||'', mobile: r.mobile||'',
        customer_scope: r.customer_scope||'domestic',
        country: r.country||'India', city: r.city||'', state: r.state||'',
        billing_pincode: r.pincode||'', billing_street1: r.street1||'',
        gstin: r.gstin||'', pan: r.pan||'', vat_number: r.vat_number||'',
        payment_terms: r.payment_terms||'Net 30', currency: r.currency||'INR',
        bank_account_name: r.bank_account_name||'', bank_account_no: r.bank_account_no||'',
        bank_name: r.bank_name||'', bank_ifsc: r.bank_ifsc||'',
        bank_swift: r.bank_swift||'', bank_iban: r.bank_iban||'',
        remarks: r.remarks||'', status:'active',
      }))});
      setResult(res.data);
      onDone();
    } catch(e) { toast.error(e.response?.data?.error||'Upload failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay">
      <div className="modal modal-md">
        <div className="modal-header"><h2>📤 Bulk Import Customers</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {!result ? (
            <>
              <div style={{background:'var(--accent-lt)',borderRadius:'var(--r-sm)',padding:'10px 14px',marginBottom:16,fontSize:12}}>
                <strong>How to use:</strong> Download the CSV template, fill in your customers (one per row), then upload here.
                Columns marked <strong>*</strong> are required.
                <div style={{marginTop:8}}>
                  <a href="/api/customers/template" download style={{color:'var(--accent)',fontWeight:600,textDecoration:'none'}}>
                    ⬇ Download Customer Template (CSV)
                  </a>
                </div>
                <div style={{marginTop:6,color:'var(--text3)'}}>
                  Columns: company_name*, first_name, last_name, email, phone, mobile, customer_scope (domestic/international), country, city, state, street1, pincode, gstin, pan, vat_number, payment_terms, currency, bank_account_name, bank_account_no, bank_name, bank_ifsc, bank_swift, bank_iban, remarks
                </div>
              </div>
              <div onClick={()=>inputRef.current.click()} style={{border:'2px dashed var(--border-md)',borderRadius:'var(--r)',padding:'24px',textAlign:'center',cursor:'pointer',background:'var(--surface2)',marginBottom:16}}>
                <div style={{fontSize:28,marginBottom:6}}>📂</div>
                <div style={{fontWeight:600,color:'var(--text2)'}}>Click to select CSV file</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>Save the Excel template as CSV, then upload</div>
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
                  onChange={e=>{if(e.target.files[0])parseExcel(e.target.files[0]);}} />
              </div>
              {loading && <div style={{textAlign:'center',color:'var(--text2)'}}>Parsing file…</div>}
              {rows.length>0 && (
                <div>
                  <div style={{marginBottom:10,fontSize:13,fontWeight:600,color:'var(--green)'}}>
                    ✅ {rows.length} customer{rows.length!==1?'s':''} ready to import
                  </div>
                  <div style={{maxHeight:160,overflowY:'auto',border:'1px solid var(--border)',borderRadius:'var(--r-sm)'}}>
                    <table className="table" style={{fontSize:11}}>
                      <thead><tr><th>#</th><th>Company</th><th>Email</th><th>Scope</th></tr></thead>
                      <tbody>
                        {rows.slice(0,10).map((r,i)=>(
                          <tr key={i}>
                            <td>{i+1}</td>
                            <td>{r.company_name||'—'}</td>
                            <td>{r.email||'—'}</td>
                            <td>{r.customer_scope||'domestic'}</td>
                          </tr>
                        ))}
                        {rows.length>10&&<tr><td colSpan={4} style={{textAlign:'center',color:'var(--text3)'}}>…and {rows.length-10} more</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)',marginBottom:8}}>Import Complete!</div>
              <div style={{fontSize:13,color:'var(--text2)'}}>{result.created} customer{result.created!==1?'s':''} created</div>
              {result.errors?.length>0&&<div style={{marginTop:10,color:'var(--red)',fontSize:12}}>{result.errors.join('\n')}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{result?'Close':'Cancel'}</button>
          {!result && rows.length>0 && (
            <button className="btn btn-primary" disabled={loading} onClick={upload}>
              {loading?'Importing…':'📤 Import '+rows.length+' Customers'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Customer Modal ─────────────────────────────────────────────────────────────
export function CustomerModal({ customer, onClose, onSaved }) {
  const qc  = useQueryClient();
  const isNew = !customer;
  const isIntl = (f) => f.customer_scope === 'international';

  const blank = {
    customer_type:'business', salutation:'', first_name:'', last_name:'',
    name:'', contact:'', email:'', phone:'', mobile:'', status:'active',
    customer_scope:'domestic', customer_no:'',
    pan:'', gstin:'', gstin_type:'regular', place_of_supply:'', vat_number:'',
    payment_terms:'Net 30', currency:'INR', city:'', state:'', country:'India',
    billing_attention:'', billing_street1:'', billing_street2:'',
    billing_city:'', billing_state:'', billing_country:'India', billing_pincode:'', billing_phone:'',
    shipping_addresses:[],
    bank_account_name:'', bank_account_no:'', bank_ifsc:'', bank_name:'',
    bank_branch:'', bank_swift:'', bank_iban:'', bank_aba:'',
    bank_country:'India', bank_currency:'INR',
    contact_persons:[], remarks:'',
    allow_partial_shipment: 0, shipment_notes: '',
  };

  const [form, setForm] = useState(() => {
    if (!customer) return blank;
    let cp=[], sa=[];
    try { cp = JSON.parse(customer.contact_persons||'[]'); } catch(_){}
    try {
      let p = JSON.parse(customer.shipping_addresses||'[]');
      if (typeof p === 'string') p = JSON.parse(p);
      sa = Array.isArray(p) ? p : [];
    } catch(_){}
    return {...blank,...customer, contact_persons:cp, shipping_addresses:sa};
  });

  // Safety: always keep shipping_addresses as array in form
  const safeAddresses = (f) => {
    if (Array.isArray(f.shipping_addresses)) return f.shipping_addresses;
    try { return JSON.parse(f.shipping_addresses||'[]'); } catch(_){ return []; }
  };

  const set = (k,v) => setForm(f => {
    const next = {...f, [k]:v};
    if (k === 'shipping_addresses' && !Array.isArray(v)) {
      try { next.shipping_addresses = JSON.parse(v||'[]'); } catch(_){ next.shipping_addresses = []; }
    }
    return next;
  });

  const [tab, setTab] = useState('basics');
  const [tried, setTried] = useState(false);
  const [billingEditMode, setBillingEditMode] = useState(() => !(customer?.billing_city || customer?.billing_street1));
  const [billingTried, setBillingTried] = useState(false);
  const [shippingEditModes, setShippingEditModes] = useState({});
  // Track if user has manually edited address attention/phone — if not, mirror top section live
  const [billingAttentionEdited, setBillingAttentionEdited] = useState(!!(customer?.billing_attention));
  const [billingPhoneEdited, setBillingPhoneEdited] = useState(!!(customer?.billing_phone));

  // Shipping addresses helpers
  const addShipping = () => {
    const sa = safeAddresses(form);
    const newIdx = sa.length;
    set('shipping_addresses',[...sa,{_isNew:true,attention:'',street1:'',street2:'',city:'',state:'',country:'India',pincode:'',phone:''}]);
    setShippingEditModes(m => ({...m, [newIdx]: true}));
  };
  const updShipping = (i,addr) => set('shipping_addresses', safeAddresses(form).map((a,j)=>j===i?addr:a));
  const delShipping = i => set('shipping_addresses', safeAddresses(form).filter((_,j)=>j!==i));
  const addShippingFromBilling = () => {
    const sa = safeAddresses(form);
    const newAddr = {
      attention:form.billing_attention, street1:form.billing_street1, street2:form.billing_street2,
      city:form.billing_city, state:form.billing_state, country:form.billing_country,
      pincode:form.billing_pincode, phone:form.billing_phone,
    };
    const key = [newAddr.attention,newAddr.street1,newAddr.city,newAddr.state,newAddr.country,newAddr.pincode].map(v=>(v||'').trim()).filter(Boolean).join('|');
    const exists = sa.some(a =>
      [a.attention,a.street1,a.city,a.state,a.country,a.pincode].map(v=>(v||'').trim()).filter(Boolean).join('|') === key
    );
    if (exists) { toast('This address is already in the list'); return; }
    const newIdx = sa.length;
    set('shipping_addresses',[...sa, {...newAddr, _isNew:true}]);
    setShippingEditModes(m => ({...m, [newIdx]: true}));
  };
  const copyShippingToBilling = () => {
    const sa = safeAddresses(form);
    const src = sa[0];
    if (!src) return;
    setForm(f => ({...f,
      billing_attention: src.attention||'', billing_street1: src.street1||'', billing_street2: src.street2||'',
      billing_city: src.city||'', billing_state: src.state||'', billing_country: src.country||'India',
      billing_pincode: src.pincode||'', billing_phone: src.phone||'',
    }));
    setBillingEditMode(false);
    toast.success('Billing address copied from shipping');
  };

  // Contact persons
  const addContact = () => set('contact_persons',[...form.contact_persons,{salutation:'',first_name:'',last_name:'',email:'',work_phone:'',mobile:'',email_notify:true,sms_notify:false}]);
  const updContact = (i,k,v) => set('contact_persons', form.contact_persons.map((c,j)=>j===i?{...c,[k]:v}:c));
  const delContact = i => set('contact_persons', form.contact_persons.filter((_,j)=>j!==i));

  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/customers',d) : api.put('/customers/'+customer.id,d),
    onSuccess: (res) => {
      qc.invalidateQueries(['customers']);
      toast.success('Customer saved');
      onSaved && onSaved(res?.data);
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error||'Save failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete('/customers/'+customer.id),
    onSuccess: () => { qc.invalidateQueries(['customers']); qc.invalidateQueries(['deleted-customers']); toast.success('Moved to Recycle Bin'); onClose(); },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [confirmShipDel, setConfirmShipDel] = useState(null);

  const shippingMutation = useMutation({
    mutationFn: (addresses) => api.put('/customers/'+customer.id, {
      ...form,
      shipping_addresses: addresses,
      name: form.name || [form.first_name, form.last_name].filter(Boolean).join(' '),
    }),
    onSuccess: () => { qc.invalidateQueries(['customers']); toast.success('Address saved'); },
    onError: e => toast.error(e.response?.data?.error||'Save failed'),
  });

  const saveShipping = (i) => {
    const sa = safeAddresses(form);
    const cleaned = sa.map(({_isNew,...rest})=>rest);
    const updated = sa.map((a,j) => j===i ? {...a, _isNew:false} : a);
    setForm(f => ({...f, shipping_addresses: updated}));
    setShippingEditModes(m => ({...m, [i]: false}));
    if (!isNew) {
      shippingMutation.mutate(cleaned);
    }
  };

  const toggleShippingEdit = (i) => {
    setShippingEditModes(m => ({...m, [i]: !m[i]}));
  };

  const billingHasData = !!(form.billing_street1 || form.billing_city || form.billing_pincode);
  const shippingList = safeAddresses(form);
  const totalAddresses = (billingHasData ? 1 : 0) + shippingList.length;

  const _topNameC = [form.first_name, form.last_name].filter(Boolean).join(' ');
  const billingLiveAttention = billingAttentionEdited ? form.billing_attention : (_topNameC || form.billing_attention);
  const billingLivePhone = billingPhoneEdited ? form.billing_phone : (form.mobile || form.billing_phone);
  const intl = isIntl(form);

  // ── Wizard steps — Bank Details & Remarks are optional and never block
  // Continue/Save; every other step is mandatory before moving forward. ──
  const mobileDigits = (form.mobile||'').replace(/^\+\d+\s?/,'').trim();
  const nameOk = form.customer_type==='individual' ? !!form.first_name : !!form.name;
  const basicsDone  = nameOk && !!mobileDigits && !!form.currency;
  const detailsDone = intl ? !!form.payment_terms : !!(form.place_of_supply && form.gstin && form.pan && form.payment_terms);
  const addressDone = !!(form.billing_street1 && form.billing_city && form.billing_state && form.billing_country && form.billing_pincode);
  const STEPS = [
    { key:'basics',   label:'Basics',           done: basicsDone },
    { key:'details',  label:'Tax & Terms',      done: detailsDone },
    { key:'address',  label:'Address',          done: addressDone },
    { key:'contacts', label:'Contact Persons',  done: form.contact_persons.length>0 },
    { key:'bank',     label:'Bank Details',     done: !!form.bank_account_no, optional:true },
    { key:'remarks',  label:'Remarks',          done: !!form.remarks, optional:true },
  ];
  const stepReachable = { basics:true, details:basicsDone, address:basicsDone&&detailsDone,
    contacts:basicsDone&&detailsDone&&addressDone, bank:basicsDone&&detailsDone&&addressDone, remarks:basicsDone&&detailsDone&&addressDone };
  const canReach = (key) => !isNew || stepReachable[key];
  const stepIdx = STEPS.findIndex(s=>s.key===tab);
  const isLastStep = stepIdx === STEPS.length-1;

  const goNext = () => {
    if (tab==='basics'  && !basicsDone)  { setTried(true); toast.error('Fill required fields to continue'); return; }
    if (tab==='details' && !detailsDone) { setTried(true); toast.error('Fill required fields to continue'); return; }
    if (tab==='address' && !addressDone) { setBillingTried(true); setBillingEditMode(true); toast.error('Billing address is incomplete'); return; }
    if (stepIdx < STEPS.length-1) setTab(STEPS[stepIdx+1].key);
  };
  const goBack = () => { if (stepIdx>0) setTab(STEPS[stepIdx-1].key); };

  const save = () => {
    setTried(true);
    setBillingTried(true);
    // Required — mirrors the step gates above; Bank Details & Remarks are
    // intentionally excluded, they're optional and never block saving.
    if (!basicsDone)  { toast.error('Fill required fields in Basics'); setTab('basics'); return; }
    if (!detailsDone) { toast.error('Fill required fields in Tax & Terms'); setTab('details'); return; }
    if (!addressDone) { toast.error('Billing address is incomplete — fill all required fields'); setTab('address'); setBillingEditMode(true); return; }
    const topName = [form.first_name, form.last_name].filter(Boolean).join(' ');
    const finalAttention = billingAttentionEdited ? form.billing_attention : (topName || form.billing_attention);
    const finalPhone = billingPhoneEdited ? form.billing_phone : (form.mobile || form.billing_phone);
    const cleanAddresses = safeAddresses(form).map(({_isNew, ...rest}) => rest);
    mutation.mutate({
      ...form,
      billing_attention: finalAttention,
      billing_phone: finalPhone,
      shipping_addresses: cleanAddresses,
      name: form.name || topName,
      contact: [form.salutation,form.first_name,form.last_name].filter(Boolean).join(' ')||form.contact,
      city: form.billing_city||form.city, state: form.billing_state||form.state,
      country: form.billing_country||form.country,
    });
  };

  return (
    <>
    <div className="overlay">
      <div className="modal" style={{maxWidth:'98vw',width:'98vw',maxHeight:'98vh',padding:0}}>
        <div className="modal-header">
          <div>
            <h2>{isNew?'New Customer':'Edit Customer'}</h2>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2,display:'flex',alignItems:'center',gap:10}}>
              {customer?.customer_no && <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{customer.customer_no}</span>}
              {customer?.id && <span className="mono">{customer.id}</span>}
              <span>{intl?'🌐 International':'🇮🇳 Domestic'}</span>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{padding:'16px 24px 0 24px', display:'flex', flexDirection:'column', minHeight:0}}>

          <StepProgress steps={STEPS} activeKey={tab} onJump={setTab} canReach={canReach} />

          {/* ── Step: Basics ── */}
          {tab==='basics' && (<>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:13}}>
            <div className="form-group">
              <label className="label">Customer Type</label>
              <div style={{display:'flex',gap:20,paddingTop:8}}>
                {['business','individual'].map(t=>(
                  <label key={t} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="radio" checked={form.customer_type===t} onChange={()=>set('customer_type',t)} style={{accentColor:'var(--accent)'}}/>{t.charAt(0).toUpperCase()+t.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="label">Customer Scope</label>
              <div style={{display:'flex',gap:20,paddingTop:8}}>
                {['domestic','international'].map(t=>(
                  <label key={t} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="radio" checked={form.customer_scope===t} onChange={()=>{set('customer_scope',t);if(t==='domestic')set('currency','INR');}} style={{accentColor:'var(--accent)'}}/>{t==='domestic'?'🇮🇳 Domestic':'🌐 International'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Customer Number — auto-generated for new, shown for existing */}
          {!isNew && form.customer_no && (
            <div style={{background:'var(--accent-lt)',border:'1px solid var(--accent)33',borderRadius:'var(--r-sm)',padding:'7px 12px',marginBottom:13,display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:11,color:'var(--text2)'}}>Customer Number</span>
              <span style={{fontFamily:'DM Mono,monospace',fontWeight:700,fontSize:14,color:'var(--accent)'}}>{form.customer_no}</span>
              <span style={{fontSize:11,color:'var(--text3)',marginLeft:'auto'}}>Auto-generated</span>
            </div>
          )}

          <div className="form-group" style={{marginBottom:13}}>
            <label className="label">Primary Contact {(form.customer_type==='individual') && <span className="req">*</span>}</label>
            <div style={{display:'flex',gap:8}}>
              <select className="input" style={{width:90}} value={form.salutation} onChange={e=>set('salutation',e.target.value)}>
                <option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}
              </select>
              <input className="input" value={form.first_name} onChange={e=>{set('first_name',e.target.value);setBillingAttentionEdited(false);}} placeholder="First Name" style={{flex:1, ...(tried && form.customer_type==='individual' && !form.first_name ? {borderColor:'var(--red)'} : {})}}/>
              <input className="input" value={form.last_name}  onChange={e=>{set('last_name',e.target.value);setBillingAttentionEdited(false);}}  placeholder="Last Name"  style={{flex:1}}/>
            </div>
          </div>
          {form.customer_type==='business' && (
            <div className="form-group" style={{marginBottom:13}}>
              <label className="label">Company Name <span className="req">*</span></label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Company / Organisation Name"
                style={tried && !form.name ? {borderColor:'var(--red)'} : {}} />
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:13,marginBottom:13}}>
            <div className="form-group"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></div>
            <div className="form-group"><label className="label">Work Phone</label>
              <PhoneField value={form.phone} onChange={v=>set('phone',v)} domestic={!intl} excludeIndia={intl} />
            </div>
            <div className="form-group">
              <label className="label">Mobile <span className="req">*</span></label>
              <PhoneField value={form.mobile} onChange={v=>{set('mobile',v);setBillingPhoneEdited(false);}} domestic={!intl} excludeIndia={intl} />
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:4}}>
            <div className="form-group">
              <label className="label">Currency <span className="req">*</span></label>
              {intl ? (
                <select className="input" value={form.currency} onChange={e=>set('currency',e.target.value)}
                  style={tried && !form.currency ? {borderColor:'var(--red)'} : {}}>
                  <option value="">— Select Currency —</option>
                  {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              ) : (
                <input className="input" value="INR" readOnly style={{background:'var(--surface2)',cursor:'not-allowed',color:'var(--text2)'}} />
              )}
            </div>
            <div className="form-group"><label className="label">Status</label>
              <select className="input" value={form.status} onChange={e=>set('status',e.target.value)}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          </>)}

          <div style={{flex:1,overflowY:'auto',minHeight:0}}>

          {/* ── Step: Tax & Terms ── */}
          {tab==='details' && (
            <div style={{paddingTop:16}}>
              {!intl ? (
                <>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GST Treatment <span className="req">*</span></label>
                      <select className="input" value={form.gstin_type} onChange={e=>set('gstin_type',e.target.value)}>
                        {GST_TREATMENTS.map(g=><option key={g} value={g.toLowerCase().replace(/[^a-z0-9]/g,'_')}>{g}</option>)}
                      </select>
                    </div>
                    <div className="form-group"><label className="label">Place of Supply <span className="req">*</span></label>
                      <select className="input" value={form.place_of_supply} onChange={e=>set('place_of_supply',e.target.value)}
                        style={tried && !form.place_of_supply ? {borderColor:'var(--red)'} : {}}>
                        <option value="">— Select State —</option>{INDIA_STATES.map(s=><option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GSTIN <span className="req">*</span></label>
                      <input className="input" value={form.gstin} onChange={e=>set('gstin',e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15}
                        style={tried && !form.gstin ? {borderColor:'var(--red)'} : {}}/>
                    </div>
                    <div className="form-group"><label className="label">PAN <span className="req">*</span></label>
                      <input className="input" value={form.pan} onChange={e=>set('pan',e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10}
                        style={tried && !form.pan ? {borderColor:'var(--red)'} : {}}/>
                    </div>
                  </div>
                </>
              ) : (
                <div className="form-grid-2">
                  <div className="form-group"><label className="label">VAT Number</label>
                    <input className="input" value={form.vat_number} onChange={e=>set('vat_number',e.target.value)} placeholder="e.g. GB123456789"/>
                  </div>
                  <div style={{padding:'10px 14px',borderRadius:'var(--r-sm)',background:'var(--surface2)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)',alignSelf:'center'}}>
                    🌐 International customer — GST fields disabled
                  </div>
                </div>
              )}
              <div className="form-grid-2">
                <div className="form-group"><label className="label">Payment Terms <span className="req">*</span></label>
                  <select className="input" value={form.payment_terms} onChange={e=>set('payment_terms',e.target.value)}
                    style={tried && !form.payment_terms ? {borderColor:'var(--red)'} : {}}>
                    <option value="">— Select Payment Terms —</option>
                    {PAYMENT_TERMS_GROUPS.map(g=>(
                      <optgroup key={g.group} label={g.group}>
                        {g.terms.map(t=><option key={t} value={t}>{t}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Step: Address ── */}
          {tab==='address' && (
            <div style={{paddingTop:16}}>
              {/* ── Billing Address ── */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>🏢 Billing Address <span className="req">*</span></div>
                {billingHasData && !billingEditMode && (
                  <button className="btn btn-xs" onClick={() => setBillingEditMode(true)}>✏ Edit</button>
                )}
              </div>
              {!billingHasData && !billingEditMode ? (
                <div>
                  <button className="btn btn-sm" style={{marginBottom:8}} onClick={() => setBillingEditMode(true)}>
                    + Add Billing Address
                  </button>
                  {billingTried && <div style={{fontSize:12,color:'var(--red)',marginBottom:12}}>Billing address is required</div>}
                </div>
              ) : billingEditMode ? (
                <div>
                  <AddressForm
                    value={{
                      attention: billingLiveAttention,
                      phone: billingLivePhone,
                      street1: form.billing_street1,
                      street2: form.billing_street2,
                      country: form.billing_country,
                      state: form.billing_state,
                      city: form.billing_city,
                      pincode: form.billing_pincode,
                    }}
                    onChange={a => {
                      if (a.attention !== billingLiveAttention) setBillingAttentionEdited(true);
                      if (a.phone !== billingLivePhone) setBillingPhoneEdited(true);
                      setForm(f => ({...f,
                        billing_attention: a.attention || '',
                        billing_phone: a.phone || '',
                        billing_street1: a.street1 || '',
                        billing_street2: a.street2 || '',
                        billing_country: a.country || 'India',
                        billing_state: a.state || '',
                        billing_city: a.city || '',
                        billing_pincode: a.pincode || '',
                      }));
                    }}
                    required={['street1','city','state','country','pincode']}
                    tried={billingTried}
                    domestic={!intl}
                    excludeIndia={intl}
                  />
                  <div style={{marginTop:12,marginBottom:16,textAlign:'right'}}>
                    <button className="btn btn-xs btn-primary" onClick={() => setBillingEditMode(false)}>✓ Done</button>
                  </div>
                </div>
              ) : (
                <div style={{padding:'10px 14px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface2)',marginBottom:16,fontSize:13}}>
                  <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {[form.billing_attention,form.billing_street1,form.billing_street2,form.billing_city,form.billing_state,form.billing_country,form.billing_pincode].filter(Boolean).join(', ')}
                    {form.billing_phone && <span style={{fontSize:11,color:'var(--text3)',marginLeft:10}}>📞 {form.billing_phone}</span>}
                  </div>
                </div>
              )}

              {/* ── Shipping Addresses ── */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:4,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>🚚 Shipping Addresses</div>
                <div style={{display:'flex',gap:8}}>
                  {billingHasData && (
                    <button className="btn btn-xs" onClick={addShippingFromBilling} style={{fontSize:11}}>⇒ Copy from Billing</button>
                  )}
                  <button className="btn btn-xs btn-primary" onClick={addShipping}>+ Add Shipping Address</button>
                </div>
              </div>
              {shippingList.length === 0 ? (
                <div style={{textAlign:'center',padding:'16px',color:'var(--text3)',fontSize:12,background:'var(--surface2)',borderRadius:'var(--r-sm)',border:'1px dashed var(--border-md)'}}>
                  No shipping addresses — click "+ Add Shipping Address" above
                </div>
              ) : (
                shippingList.map((addr,i) => (
                  <ShippingAddressBlock key={i} addr={addr} idx={i}
                    onChange={a => updShipping(i,a)}
                    onRemove={() => delShipping(i)}
                    canDelete={shippingList.filter(a=>!a._isNew).length > 1}
                    editMode={!!(shippingEditModes[i])}
                    onSave={() => shippingEditModes[i] ? saveShipping(i) : toggleShippingEdit(i)}
                    onAskDelete={() => setConfirmShipDel(i)}
                    domestic={!intl}
                    excludeIndia={intl}
                  />
                ))
              )}
            </div>
          )}
          {confirmShipDel !== null && (
            <ConfirmDeleteModal
              label={shippingList[confirmShipDel]?.attention || shippingList[confirmShipDel]?.city || `Shipping Address ${confirmShipDel+1}`}
              onConfirm={() => { delShipping(confirmShipDel); setConfirmShipDel(null); }}
              onCancel={() => setConfirmShipDel(null)}
            />
          )}

          {/* ── Step: Contact Persons ── */}
          {tab==='contacts' && (
            <div style={{paddingTop:16}}>
              <div style={{overflowX:'auto'}}>
                <table className="table">
                  <thead><tr><th>Sal.</th><th>First Name</th><th>Last Name</th><th>Email</th><th>Work Phone</th><th>Mobile</th><th>✉</th><th>📱</th><th width={28}></th></tr></thead>
                  <tbody>
                    {form.contact_persons.length===0&&<tr><td colSpan={9} style={{textAlign:'center',color:'var(--text3)',padding:16}}>No contacts — click Add below</td></tr>}
                    {form.contact_persons.map((cp,i)=>(
                      <tr key={i}>
                        <td><select className="input" style={{fontSize:12,padding:'3px 6px',width:70}} value={cp.salutation||''} onChange={e=>updContact(i,'salutation',e.target.value)}><option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}</select></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.first_name||''} onChange={e=>updContact(i,'first_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.last_name||''} onChange={e=>updContact(i,'last_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} type="email" value={cp.email||''} onChange={e=>updContact(i,'email',e.target.value)}/></td>
                        <td><PhoneField value={cp.work_phone||''} onChange={v=>updContact(i,'work_phone',v)} domestic={!intl} excludeIndia={intl} /></td>
                        <td><PhoneField value={cp.mobile||''} onChange={v=>updContact(i,'mobile',v)} domestic={!intl} excludeIndia={intl} /></td>
                        <td style={{textAlign:'center'}}><input type="checkbox" checked={!!cp.email_notify} onChange={e=>updContact(i,'email_notify',e.target.checked)} style={{accentColor:'var(--accent)'}}/></td>
                        <td style={{textAlign:'center'}}><input type="checkbox" checked={!!cp.sms_notify} onChange={e=>updContact(i,'sms_notify',e.target.checked)} style={{accentColor:'var(--accent)'}}/></td>
                        <td><button onClick={()=>delContact(i)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:16}}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-sm" onClick={addContact} style={{marginTop:10}}>⊕ Add Contact Person</button>
            </div>
          )}

          {/* ── Step: Bank Details (optional) ── */}
          {tab==='bank' && (
            <div style={{paddingTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏦 {intl?'Primary Bank':'Indian Bank Details'}</div>
                <div className="form-group"><label className="label">Account Holder Name</label><input className="input" value={form.bank_account_name} onChange={e=>set('bank_account_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Account Number</label><input className="input" value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></div>
                <div className="form-group"><label className="label">Bank Name</label><input className="input" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Branch</label><input className="input" value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)}/></div>
                {!intl && <div className="form-group"><label className="label">IFSC Code</label><input className="input" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())} placeholder="HDFC0001234"/></div>}
                <div className="form-grid-2">
                  <div className="form-group"><label className="label">Currency</label>
                    <select className="input" value={form.bank_currency} onChange={e=>set('bank_currency',e.target.value)}>{ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}</select>
                  </div>
                  <div className="form-group"><label className="label">Bank Country</label>
                    <CountrySelect value={form.bank_country} onChange={v=>set('bank_country',v)}/>
                  </div>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🌐 International Wire</div>
                <div className="form-group"><label className="label">SWIFT / BIC Code</label><input className="input" value={form.bank_swift} onChange={e=>set('bank_swift',e.target.value.toUpperCase())} placeholder="HDFCINBBXXX"/></div>
                <div className="form-group"><label className="label">IBAN</label><input className="input" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value.toUpperCase())} placeholder="GB29 NWBK 6016 1331 9268 19"/></div>
                <div className="form-group"><label className="label">ABA / Routing (USA)</label><input className="input" value={form.bank_aba} onChange={e=>set('bank_aba',e.target.value)} placeholder="021000021"/></div>
              </div>
            </div>
          )}

          {/* ── Step: Remarks (optional) ── */}
          {tab==='remarks' && (
            <div style={{paddingTop:16}}>
              <div className="form-group"><label className="label">Internal Remarks / Notes</label>
                <textarea className="input" rows={4} value={form.remarks} onChange={e=>set('remarks',e.target.value)} placeholder="Internal notes about this customer…"/>
              </div>
              {/* ── Shipment Preference (isolated addition) ─────────────── */}
              <div style={{marginTop:16,padding:'14px 16px',borderRadius:'var(--r)',
                background:'var(--surface2)',border:'1px solid var(--border)'}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:'var(--text)'}}>
                  📦 Shipment Preference
                </div>
                <div className="form-group" style={{marginBottom:12}}>
                  <label className="label">Default Shipment Mode</label>
                  <div style={{display:'flex',gap:24,marginTop:6,flexWrap:'wrap'}}>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      <input type="radio" name={`partial_${customer?.id||'new'}`}
                        checked={!form.allow_partial_shipment}
                        onChange={()=>set('allow_partial_shipment',0)}
                        style={{accentColor:'var(--accent)'}}/>
                      <span>📦 Full Order Only</span>
                      <span style={{fontSize:11,color:'var(--text3)'}}>— ship everything together</span>
                    </label>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      <input type="radio" name={`partial_${customer?.id||'new'}`}
                        checked={!!form.allow_partial_shipment}
                        onChange={()=>set('allow_partial_shipment',1)}
                        style={{accentColor:'var(--teal,#0d9488)'}}/>
                      <span>📦 Partial Shipments OK</span>
                      <span style={{fontSize:11,color:'var(--text3)'}}>— can ship available items first</span>
                    </label>
                  </div>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Shipment Notes</label>
                  <input className="input" value={form.shipment_notes||''}
                    onChange={e=>set('shipment_notes',e.target.value)}
                    placeholder="e.g. Always confirm before partial dispatch, max 2 shipments"/>
                </div>
              </div>
            </div>
          )}

          </div>{/* end tab scroll wrapper */}
        </div>
        <div className="modal-footer">
          <div style={{display:'flex',gap:8,marginRight:'auto',alignItems:'center'}}>
            {stepIdx>0 && <button className="btn" onClick={goBack}>← Back</button>}
            {!isNew && <button className="btn btn-danger btn-sm" onClick={()=>setConfirmDelete(true)}>Delete</button>}
          </div>
          <button className="btn" onClick={onClose}>Cancel</button>
          {isLastStep ? (
            <button className="btn btn-primary" disabled={mutation.isPending} onClick={save}>{mutation.isPending?'Saving…':'Save Customer'}</button>
          ) : (
            <button className="btn btn-primary" onClick={goNext}>Continue →</button>
          )}
        </div>
      </div>
    </div>
    {confirmDelete && (
      <ConfirmDeleteModal
        label={customer?.name || customer?.company_name}
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
        loading={deleteMutation.isPending}
      />
    )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const [search,    setSearch]    = useState('');
  const [modal,     setModal]     = useState(null);
  const [showBulk,  setShowBulk]  = useState(false);
  const qc = useQueryClient();
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });

  const filtered = customers.filter(c =>
    !search ||
    (c.name||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.contact||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.email||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.gstin||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.customer_no||'').toLowerCase().includes(search.toLowerCase())
  ).sort((a,b)=>(b.created||b.created_at||'').localeCompare(a.created||a.created_at||''));

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search by name, CFCUST no., email, GSTIN…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div style={{display:'flex',gap:8}}>
          <a href="/api/customers/template" download style={{textDecoration:'none'}}>
            <button className="btn" style={{fontSize:12}}>⬇ Download Template</button>
          </a>
          <button className="btn" onClick={()=>setShowBulk(true)} style={{fontSize:12}}>📤 Bulk Import</button>
          <button className="btn btn-primary" onClick={()=>setModal({})}>+ Add Customer</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Cust. No.</th><th>Company / Name</th><th>Scope</th>
            <th>Contact</th><th>Email</th><th>Location</th>
            <th>GSTIN / VAT</th><th>Cur.</th><th>Orders</th><th>Status</th><th>Created</th>
            <th style={{textAlign:'right',whiteSpace:'nowrap'}}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={12}><div className="empty-state"><div className="empty-icon">👤</div><div>No customers yet</div></div></td></tr>}
            {filtered.map(c=>(
              <tr key={c.id}>
                <td>
                  <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{c.customer_no||c.id}</span>
                </td>
                <td>
                  <div className="bold">{c.name}</div>
                  {(c.first_name||c.last_name)&&<div style={{fontSize:11,color:'var(--text3)'}}>{[c.salutation,c.first_name,c.last_name].filter(Boolean).join(' ')}</div>}
                </td>
                <td>
                  {c.customer_scope==='international'
                    ? <span className="badge badge-blue">🌐 Intl</span>
                    : <span className="badge badge-green">🇮🇳 Dom</span>}
                </td>
                <td>{c.contact||'—'}</td>
                <td style={{color:'var(--accent)'}}>{c.email||'—'}</td>
                <td>{[c.city,c.state].filter(Boolean).join(', ')||'—'}</td>
                <td className="mono">{c.gstin||c.vat_number||<span style={{color:'var(--text3)'}}>—</span>}</td>
                <td>{c.currency||'INR'}</td>
                <td><span className="badge badge-blue">{c.orders||0}</span></td>
                <td>{c.status==='active'?<span className="badge badge-green">Active</span>:<span className="badge badge-gray">Inactive</span>}</td>
                <td style={{color:'var(--text3)',whiteSpace:'nowrap'}}>{fmtDateTime(c.created||c.created_at)}</td>
                <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                  <button className="btn btn-xs btn-primary" onClick={()=>setModal(c)}>✏ Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal!==null && <CustomerModal customer={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)} />}
      {showBulk && <BulkUpload onClose={()=>setShowBulk(false)} onDone={()=>{qc.invalidateQueries(['customers']);}} />}
    </div>
  );
}
