// client/src/pages/SuppliersPage.js  v3 — geo data from country-state-city package only
import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmtDateTime } from '../utils/helpers';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { AddressForm, PhoneField, CountrySelect, StateSelect, CitySelect } from '../components/AddressForm';
import { ALL_CURRENCIES } from '../utils/currencies';
const SALUTATIONS = ['Mr.','Ms.','Mrs.','Dr.','Prof.'];
const GST_TREATMENTS = ['Registered Business – Regular','Registered Business – Composition','Unregistered Business','Overseas','Special Economic Zone'];

const PAYMENT_TERMS_GROUPS = [
  { group:'Advance Payment', terms:['Advance Payment (AP) – Full payment before shipment','Partial Advance – 30% upfront, 70% on delivery','Partial Advance – 50% upfront, 50% on delivery','Cash in Advance (CIA) – 100% before dispatch','Cash Before Shipment (CBS) – Payment before goods ship'] },
  { group:'Delivery-Based', terms:['Cash on Delivery (COD)','Cash Against Delivery (CAD)'] },
  { group:'Letter of Credit (LC)', terms:['Letter of Credit (LC)','Irrevocable Letter of Credit','Confirmed Letter of Credit','Sight Letter of Credit – Payment on document submission','Usance LC – 30 days','Usance LC – 60 days','Usance LC – 90 days'] },
  { group:'Documents & Bill of Exchange', terms:['Documents Against Payment (D/P)','Documents Against Acceptance (D/A)','Bill of Exchange'] },
  { group:'Net Days', terms:['Net 7 – Payment due in 7 days','Net 15 – Payment due in 15 days','Net 30 – Payment due in 30 days','Net 45 – Payment due in 45 days','Net 60 – Payment due in 60 days','Net 90 – Payment due in 90 days','End of Month (EOM)','Net 30 EOM – 30 days after end of invoice month'] },
  { group:'Early Payment Discount', terms:['2/10 Net 30 – 2% discount if paid in 10 days','1/15 Net 45 – 1% discount if paid in 15 days'] },
  { group:'Progress / Milestone', terms:['Progress Payment – As work progresses','Milestone-Based Payment','Stage Payment – Defined stages','Retention Payment – Portion held until completion'] },
  { group:'Deferred / Consignment', terms:['Consignment – Payment after goods are sold','Sale or Return – Buyer can return unsold goods','Deferred Payment – Postponed to agreed date'] },
  { group:'Recurring', terms:['Monthly Payment','Quarterly Payment','Annual Prepaid – Full year upfront'] },
];

// ── Shared UI components ──────────────────────────────────────────────────────
const Tab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{
    padding:'9px 18px', fontSize:13, fontWeight:active?600:400, background:'none', border:'none',
    borderBottom:active?'2px solid var(--accent)':'2px solid transparent',
    color:active?'var(--accent)':'var(--text2)', cursor:'pointer', whiteSpace:'nowrap',
  }}>{label}</button>
);

// ── Shipping Address Block (matches customer UX) ─────────────────────────────
function ShippingBlock({ addr, idx, onChange, onRemove, domestic, excludeIndia }) {
  const [open, setOpen] = React.useState(idx === 0);
  const label = addr.attention || addr.city || `Delivery Address ${idx + 1}`;
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',marginBottom:10,overflow:'hidden'}}>
      <div role="button" tabIndex={0}
        style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--surface2)',cursor:'pointer'}}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:16}}>{open ? '▾' : '▸'}</span>
          <span style={{fontWeight:600,fontSize:13}}>{label}</span>
          {addr.city && <span style={{fontSize:11,color:'var(--text3)'}}>{[addr.city,addr.state,addr.country].filter(Boolean).join(', ')}</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:18,lineHeight:1}}>×</button>
      </div>
      {open && (
        <div style={{padding:'14px'}}>
          <AddressForm value={addr} onChange={onChange} domestic={domestic} excludeIndia={excludeIndia} />
        </div>
      )}
    </div>
  );
}


// ── Bulk Upload ───────────────────────────────────────────────────────────────
function BulkUpload({ onClose, onDone }) {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const inputRef = useRef();

  const parse = async (f) => {
    setLoading(true);
    try {
      const text = await f.text();
      const lines = text.split('\n').filter(l=>l.trim());
      const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,'_').replace(/\*$/,''));
      const data = lines.slice(1).map(line=>{
        const vals = line.split(',');
        const obj = {};
        headers.forEach((h,i)=>{ obj[h]=(vals[i]||'').trim().replace(/^"|"$/g,''); });
        return obj;
      }).filter(r=>r.name||r.supplier_name);
      setRows(data);
    } catch(e) { toast.error('Could not parse file'); }
    finally { setLoading(false); }
  };

  const upload = async () => {
    setLoading(true);
    try {
      const res = await api.post('/suppliers/bulk', { rows: rows.map(r=>({
        name:r.name||r.supplier_name||'', type:r.type||'domestic',
        contact:r.contact||'', email:r.email||'', phone:r.phone||'',
        website:r.website||'', city:r.city||'', state:r.state||'',
        country:r.country||'India', gstin:r.gstin||'', vat_number:r.vat_number||'',
        payment_terms:r.payment_terms||'Net 30', currency:r.currency||'INR',
        notes:r.notes||'', status:'active',
      }))});
      setResult(res.data); onDone();
    } catch(e) { toast.error(e.response?.data?.error||'Upload failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay">
      <div className="modal modal-md">
        <div className="modal-header"><h2>📤 Bulk Import Suppliers</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {!result ? (
            <>
              <div style={{background:'var(--accent-lt)',borderRadius:'var(--r-sm)',padding:'10px 14px',marginBottom:16,fontSize:12}}>
                <strong>How to use:</strong> Download the CSV template, fill in your suppliers (one per row), then upload here.
                Columns marked <strong>*</strong> are required.
                <div style={{marginTop:8}}>
                  <a href="/api/suppliers/template" download style={{color:'var(--accent)',fontWeight:600,textDecoration:'none'}}>
                    ⬇ Download Supplier Template (CSV)
                  </a>
                </div>
                <div style={{marginTop:6,color:'var(--text3)'}}>
                  Columns: name*, type (domestic/international), first_name, last_name, email, phone, mobile, website, city, state, country, gstin, pan, vat_number, payment_terms, currency, bank_account_name, bank_account_no, bank_name, bank_ifsc, bank_swift, bank_iban, notes
                </div>
              </div>
              <div onClick={()=>inputRef.current.click()} style={{border:'2px dashed var(--border-md)',borderRadius:'var(--r)',padding:'24px',textAlign:'center',cursor:'pointer',background:'var(--surface2)',marginBottom:16}}>
                <div style={{fontSize:28,marginBottom:6}}>📂</div>
                <div style={{fontWeight:600,color:'var(--text2)'}}>Click to select CSV file</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>Fill the downloaded template, then upload here</div>
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}} onChange={e=>{if(e.target.files[0])parse(e.target.files[0]);}}/>
              </div>
              {loading && <div style={{textAlign:'center'}}>Parsing…</div>}
              {rows.length>0 && (
                <div style={{marginBottom:10,fontSize:13,fontWeight:600,color:'var(--green)'}}>✅ {rows.length} supplier{rows.length!==1?'s':''} ready to import</div>
              )}
            </>
          ) : (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>{result.created} supplier{result.created!==1?'s':''} created!</div>
              {result.errors?.length>0&&<div style={{marginTop:8,color:'var(--red)',fontSize:12}}>{result.errors.join('\n')}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{result?'Close':'Cancel'}</button>
          {!result&&rows.length>0&&<button className="btn btn-primary" disabled={loading} onClick={upload}>{loading?'Importing…':'📤 Import '+rows.length}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Supplier Modal ─────────────────────────────────────────────────────────────
export function SupplierModal({ supplier, linecards, onClose, onSaved }) {
  const qc = useQueryClient();
  const isNew = !supplier?.id;
  const isIntl = (f) => f.type === 'international';

  const blank = {
    type:'domestic', salutation:'', first_name:'', last_name:'',
    name:'', contact:'', email:'', phone:'', mobile:'', website:'',
    status:'active', supplier_no:'',
    pan:'', gstin:'', gstin_type:'regular', place_of_supply:'', vat_number:'',
    payment_terms:'Net 30', currency:'INR',
    billing_attention:'', billing_street1:'', billing_street2:'',
    billing_city:'', billing_state:'', billing_country:'India',
    billing_pincode:'', billing_phone:'',
    shipping_addresses:[],
    bank_account_name:'', bank_account_no:'', bank_ifsc:'', bank_name:'',
    bank_branch:'', bank_swift:'', bank_iban:'', bank_aba:'',
    bank_country:'India', bank_currency:'INR',
    contact_persons:[], linecards:[], notes:'', remarks:'',
  };

  const [form, setForm] = useState(() => {
    if (!supplier?.id) return blank;
    let cp=[], sa=[];
    try { cp = JSON.parse(supplier.contact_persons||'[]'); } catch(_){}
    try { sa = JSON.parse(supplier.shipping_addresses||'[]'); } catch(_){}
    return {...blank,...supplier, contact_persons:cp, shipping_addresses:sa, linecards:supplier.linecards||[]};
  });
  const [tab, setTab] = useState('details');
  const [lcSearch, setLcSearch] = useState('');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const intl = isIntl(form);

  const addShipping = () => set('shipping_addresses',[...form.shipping_addresses,{attention:'',street1:'',street2:'',city:'',state:'',country: intl ? '' : 'India',pincode:'',phone:''}]);
  const addFromBilling = () => set('shipping_addresses',[...form.shipping_addresses,{
    attention:form.billing_attention, street1:form.billing_street1, street2:form.billing_street2,
    city:form.billing_city, state:form.billing_state, country:form.billing_country,
    pincode:form.billing_pincode, phone:form.billing_phone,
  }]);
  const updShipping = (i,a) => set('shipping_addresses',form.shipping_addresses.map((x,j)=>j===i?a:x));
  const delShipping = i => set('shipping_addresses',form.shipping_addresses.filter((_,j)=>j!==i));

  const addContact = () => set('contact_persons',[...form.contact_persons,{salutation:'',first_name:'',last_name:'',email:'',work_phone:'',mobile:'',email_notify:true,sms_notify:false}]);
  const updContact = (i,k,v) => set('contact_persons',form.contact_persons.map((c,j)=>j===i?{...c,[k]:v}:c));
  const delContact = i => set('contact_persons',form.contact_persons.filter((_,j)=>j!==i));

  const selectedLcs  = form.linecards||[];
  const availableLcs = linecards.filter(l=>!selectedLcs.includes(l.id)&&(!lcSearch||l.name.toLowerCase().includes(lcSearch.toLowerCase())));
  const addLc    = id => set('linecards',[...selectedLcs,id]);
  const removeLc = id => set('linecards',selectedLcs.filter(x=>x!==id));
  const lcName   = id => linecards.find(l=>l.id===id)?.name||id;

  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/suppliers',d) : api.put('/suppliers/'+supplier.id,d),
    onSuccess: (res) => {
      qc.invalidateQueries(['suppliers']);
      toast.success('Supplier saved');
      onSaved && onSaved(res?.data);
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error||'Save failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete('/suppliers/'+supplier.id),
    onSuccess: () => { qc.invalidateQueries(['suppliers']); toast.success('Deleted'); onClose(); },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    if (!form.name) { toast.error('Supplier name is required'); return; }
    mutation.mutate({
      ...form,
      contact:[form.salutation,form.first_name,form.last_name].filter(Boolean).join(' ')||form.contact,
      city:form.billing_city||form.city, state:form.billing_state||form.state,
      country:form.billing_country||form.country,
    });
  };

  return (
    <>
    <div className="overlay">
      <div className="modal" style={{maxWidth:'98vw',width:'98vw',maxHeight:'98vh',padding:0}}>
        <div className="modal-header">
          <div>
            <h2>{isNew?'New Supplier':'Edit Supplier'}</h2>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2,display:'flex',alignItems:'center',gap:10}}>
              {form.supplier_no&&<span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{form.supplier_no}</span>}
              {supplier?.id&&<span className="mono">{supplier.id}</span>}
              <span>{intl?'🌐 International':'🇮🇳 Domestic'}</span>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{paddingBottom:0, padding:'20px 28px 0 28px'}}>

          {/* ── Top fields ── */}
          <div className="form-group" style={{marginBottom:13}}>
            <label className="label">Supplier Type</label>
            <div style={{display:'flex',gap:20,paddingTop:8}}>
              {[['domestic','🇮🇳 Domestic (India)'],['international','🌐 International']].map(([v,l])=>(
                <label key={v} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                  <input type="radio" checked={form.type===v} onChange={()=>{set('type',v);if(v==='domestic'){set('billing_country','India');set('bank_country','India');set('currency','INR');}}} style={{accentColor:'var(--accent)'}}/>{l}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group" style={{marginBottom:13}}>
            <label className="label">Primary Contact</label>
            <div style={{display:'flex',gap:8}}>
              <select className="input" style={{width:90}} value={form.salutation} onChange={e=>set('salutation',e.target.value)}>
                <option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}
              </select>
              <input className="input" value={form.first_name} onChange={e=>set('first_name',e.target.value)} placeholder="First Name" style={{flex:1}}/>
              <input className="input" value={form.last_name}  onChange={e=>set('last_name',e.target.value)}  placeholder="Last Name"  style={{flex:1}}/>
            </div>
          </div>

          <div className="form-group" style={{marginBottom:13}}>
            <label className="label">Supplier / Company Name <span className="req">*</span></label>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Supplier company name"/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:13,marginBottom:13}}>
            <div className="form-group"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></div>
            <div className="form-group"><label className="label">Work Phone</label>
              <PhoneField value={form.phone} onChange={v=>set('phone',v)} domestic={!intl} excludeIndia={intl}/>
            </div>
            <div className="form-group"><label className="label">Mobile</label>
              <PhoneField value={form.mobile||''} onChange={v=>set('mobile',v)} domestic={!intl} excludeIndia={intl}/>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:13,marginBottom:4}}>
            <div className="form-group"><label className="label">Website</label><input className="input" value={form.website} onChange={e=>set('website',e.target.value)} placeholder="example.com"/></div>
            <div className="form-group"><label className="label">Currency</label>
              {intl ? (
                <select className="input" value={form.currency} onChange={e=>set('currency',e.target.value)}>{ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}</select>
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

          {/* ── Tabs ── */}
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginTop:10,overflowX:'auto'}}>
            {[['details','Other Details'],['address','Address'],['contacts','Contact Persons'],['linecards','Line Cards'],['bank','Bank Details'],['remarks','Remarks']].map(([k,l])=>(
              <Tab key={k} label={l} active={tab===k} onClick={()=>setTab(k)}/>
            ))}
          </div>

          {/* ── Other Details ── */}
          {tab==='details' && (
            <div style={{paddingTop:16}}>
              {!intl ? (
                <>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GST Treatment</label>
                      <select className="input" value={form.gstin_type} onChange={e=>set('gstin_type',e.target.value)}>
                        {GST_TREATMENTS.map(g=><option key={g} value={g.toLowerCase().replace(/[^a-z0-9]/g,'_')}>{g}</option>)}
                      </select>
                    </div>
                    <div className="form-group"><label className="label">Place of Supply</label>
                      <StateSelect country="India" value={form.place_of_supply} onChange={v=>set('place_of_supply',v)}/>
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GSTIN</label>
                      <input className="input" value={form.gstin} onChange={e=>set('gstin',e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15}/>
                    </div>
                    <div className="form-group"><label className="label">PAN</label>
                      <input className="input" value={form.pan} onChange={e=>set('pan',e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10}/>
                    </div>
                  </div>
                </>
              ) : (
                <div className="form-grid-2" style={{marginBottom:13}}>
                  <div className="form-group"><label className="label">VAT Number</label>
                    <input className="input" value={form.vat_number} onChange={e=>set('vat_number',e.target.value)} placeholder="e.g. GB123456789"/>
                  </div>
                  <div style={{padding:'10px 14px',borderRadius:'var(--r-sm)',background:'var(--surface2)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)',alignSelf:'center'}}>
                    🌐 International supplier — GST fields disabled
                  </div>
                </div>
              )}
              <div className="form-grid-2">
                <div className="form-group"><label className="label">Payment Terms</label>
                  <select className="input" value={form.payment_terms} onChange={e=>set('payment_terms',e.target.value)}>
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

          {/* ── Address ── */}
          {tab==='address' && (
            <div style={{paddingTop:16}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏢 Office / Billing Address</div>
              <AddressForm
                value={{
                  attention: form.billing_attention,
                  phone: form.billing_phone,
                  street1: form.billing_street1,
                  street2: form.billing_street2,
                  country: form.billing_country,
                  state: form.billing_state,
                  city: form.billing_city,
                  pincode: form.billing_pincode,
                }}
                onChange={a => setForm(f => ({...f,
                  billing_attention: a.attention || '',
                  billing_phone: a.phone || '',
                  billing_street1: a.street1 || '',
                  billing_street2: a.street2 || '',
                  billing_country: a.country || 'India',
                  billing_state: a.state || '',
                  billing_city: a.city || '',
                  billing_pincode: a.pincode || '',
                }))}
                domestic={!intl}
                excludeIndia={intl}
              />

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13}}>🚚 Dispatch / Warehouse Addresses</div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-xs" onClick={addFromBilling} style={{fontSize:11}}>⇒ Add from Office</button>
                  <button className="btn btn-xs btn-primary" onClick={addShipping}>+ Add Address</button>
                </div>
              </div>
              {form.shipping_addresses.length===0 && (
                <div style={{textAlign:'center',padding:'14px',color:'var(--text3)',fontSize:12,background:'var(--surface2)',borderRadius:'var(--r-sm)',border:'1px dashed var(--border-md)'}}>
                  No dispatch addresses — click "+ Add Address" above
                </div>
              )}
              {form.shipping_addresses.map((a,i)=>(
                <ShippingBlock key={i} addr={a} idx={i} onChange={x=>updShipping(i,x)} onRemove={()=>delShipping(i)} domestic={!intl} excludeIndia={intl}/>
              ))}
            </div>
          )}

          {/* ── Contact Persons ── */}
          {tab==='contacts' && (
            <div style={{paddingTop:16}}>
              <div style={{overflowX:'auto'}}>
                <table className="table">
                  <thead><tr><th>Sal.</th><th>First Name</th><th>Last Name</th><th>Email</th><th>Work Phone</th><th>Mobile</th><th>✉</th><th>📱</th><th width={28}></th></tr></thead>
                  <tbody>
                    {form.contact_persons.length===0&&<tr><td colSpan={9} style={{textAlign:'center',color:'var(--text3)',padding:16}}>No contacts yet</td></tr>}
                    {form.contact_persons.map((cp,i)=>(
                      <tr key={i}>
                        <td><select className="input" style={{fontSize:12,padding:'3px 6px',width:70}} value={cp.salutation||''} onChange={e=>updContact(i,'salutation',e.target.value)}><option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}</select></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.first_name||''} onChange={e=>updContact(i,'first_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.last_name||''} onChange={e=>updContact(i,'last_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} type="email" value={cp.email||''} onChange={e=>updContact(i,'email',e.target.value)}/></td>
                        <td><PhoneField value={cp.work_phone||''} onChange={v=>updContact(i,'work_phone',v)} domestic={!intl} excludeIndia={intl}/></td>
                        <td><PhoneField value={cp.mobile||''} onChange={v=>updContact(i,'mobile',v)} domestic={!intl} excludeIndia={intl}/></td>
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

          {/* ── Line Cards ── */}
          {tab==='linecards' && (
            <div style={{paddingTop:16}}>
              <div style={{display:'flex',flexWrap:'wrap',gap:4,minHeight:44,padding:10,border:'1px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--surface2)',marginBottom:12}}>
                {selectedLcs.length===0&&<span style={{fontSize:12,color:'var(--text3)'}}>No line cards assigned — search below</span>}
                {selectedLcs.map(lid=>(
                  <span key={lid} className="lc-chip">{lcName(lid)}<button className="lc-chip-x" onClick={()=>removeLc(lid)}>×</button></span>
                ))}
              </div>
              <div className="form-group">
                <label className="label">Search &amp; Add Line Card</label>
                <input className="input" placeholder="Type brand / manufacturer name…" value={lcSearch} onChange={e=>setLcSearch(e.target.value)}/>
              </div>
              {lcSearch&&availableLcs.length>0&&(
                <div style={{border:'1px solid var(--border)',borderRadius:'var(--r-sm)',maxHeight:200,overflowY:'auto',background:'var(--surface)'}}>
                  {availableLcs.map(lc=>(
                    <div key={lc.id} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,borderBottom:'1px solid var(--border)'}} onClick={()=>{addLc(lc.id);setLcSearch('');}}>
                      <span className="bold">{lc.name}</span> <span style={{fontSize:11,color:'var(--text3)'}}>{lc.category}</span>
                    </div>
                  ))}
                </div>
              )}
              {lcSearch&&availableLcs.length===0&&<div style={{fontSize:12,color:'var(--text3)',marginTop:6}}>No matching line cards found</div>}
            </div>
          )}

          {/* ── Bank Details ── */}
          {tab==='bank' && (
            <div style={{paddingTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏦 {intl?'Primary Bank':'Indian Bank Details'}</div>
                <div className="form-group"><label className="label">Account Holder Name {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_name} onChange={e=>set('bank_account_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Account Number {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></div>
                <div className="form-group"><label className="label">Bank Name</label><input className="input" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Branch</label><input className="input" value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)}/></div>
                {!intl&&<div className="form-group"><label className="label">IFSC Code <span className="req">*</span></label><input className="input" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())} placeholder="HDFC0001234"/></div>}
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
                <div className="form-group"><label className="label">SWIFT / BIC Code {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_swift} onChange={e=>set('bank_swift',e.target.value.toUpperCase())} placeholder="HDFCINBBXXX"/></div>
                <div className="form-group"><label className="label">IBAN {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value.toUpperCase())} placeholder="GB29 NWBK 6016 1331 9268 19"/></div>
                <div className="form-group"><label className="label">ABA / Routing (USA)</label><input className="input" value={form.bank_aba} onChange={e=>set('bank_aba',e.target.value)} placeholder="021000021"/></div>
              </div>
            </div>
          )}

          {/* ── Remarks ── */}
          {tab==='remarks' && (
            <div style={{paddingTop:16}}>
              <div className="form-group"><label className="label">Internal Notes</label>
                <textarea className="input" rows={3} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Notes visible to your team…"/>
              </div>
              <div className="form-group"><label className="label">Remarks</label>
                <textarea className="input" rows={4} value={form.remarks} onChange={e=>set('remarks',e.target.value)} placeholder="Internal remarks about this supplier…"/>
              </div>
            </div>
          )}

        </div>
        <div className="modal-footer">
          {!isNew&&<button className="btn btn-danger btn-sm" style={{marginRight:'auto'}} onClick={()=>setConfirmDelete(true)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={save}>{mutation.isPending?'Saving…':'Save Supplier'}</button>
        </div>
      </div>
    </div>
    {confirmDelete && (
      <ConfirmDeleteModal
        label={supplier?.name}
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
        loading={deleteMutation.isPending}
      />
    )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function SuppliersPage() {
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [modal,    setModal]    = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const qc = useQueryClient();
  const { data: suppliers=[] } = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: linecards=[] } = useQuery({ queryKey:['linecards'], queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const lcName = id => linecards.find(l=>l.id===id)?.name||id;

  const filtered = suppliers.filter(s => {
    if (filter!=='all'&&s.type!==filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.name||'').toLowerCase().includes(q) ||
           (s.contact||'').toLowerCase().includes(q) ||
           (s.supplier_no||'').toLowerCase().includes(q) ||
           (s.email||'').toLowerCase().includes(q) ||
           (s.gstin||'').toLowerCase().includes(q);
  }).sort((a,b)=>(b.created||b.created_at||'').localeCompare(a.created||a.created_at||''));

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
            <input className="search-input" placeholder="Search by name, CFSUP no., email, GSTIN…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {['all','domestic','international'].map(f=>(
            <span key={f} className={`fchip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>
              {f==='all'?'All':f==='domestic'?'🇮🇳 India':'🌐 International'}
            </span>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <a href="/api/suppliers/template" download style={{textDecoration:'none'}}>
            <button className="btn" style={{fontSize:12}}>⬇ Download Template</button>
          </a>
          <button className="btn" onClick={()=>setShowBulk(true)} style={{fontSize:12}}>📤 Bulk Import</button>
          <button className="btn btn-primary" onClick={()=>setModal({})}>+ Add Supplier</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Sup. No.</th><th>Supplier Name</th><th>Type</th>
            <th>Contact</th><th>Location</th><th>GSTIN / VAT</th>
            <th>Currency</th><th>Line Cards</th><th>Terms</th><th>Status</th><th>Created</th>
            <th style={{textAlign:'right'}}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={11}><div className="empty-state"><div className="empty-icon">🏭</div><div>No suppliers found</div></div></td></tr>}
            {filtered.map(s=>(
              <tr key={s.id}>
                <td><span className="mono" style={{fontWeight:700,color:'var(--accent)',fontSize:12}}>{s.supplier_no||s.id}</span></td>
                <td>
                  <div className="bold">{s.name}</div>
                  {s.website&&<div style={{fontSize:11,color:'var(--text3)'}}>{s.website}</div>}
                </td>
                <td>{s.type==='domestic'?<span className="badge badge-green">🇮🇳 Dom</span>:<span className="badge badge-blue">🌐 Intl</span>}</td>
                <td><div style={{fontSize:12}}>{s.contact||'—'}</div><div style={{fontSize:11,color:'var(--text3)'}}>{s.email||''}</div></td>
                <td style={{fontSize:12}}>{[s.city,s.country].filter(Boolean).join(', ')||'—'}</td>
                <td className="mono" style={{fontSize:11}}>{s.gstin||s.vat_number||<span style={{color:'var(--text3)'}}>—</span>}</td>
                <td style={{fontSize:12}}>{s.currency||'INR'}</td>
                <td style={{maxWidth:180}}>
                  {(s.linecards||[]).slice(0,3).map(lid=><span key={lid} className="lc-chip" style={{margin:1}}>{lcName(lid)}</span>)}
                  {(s.linecards||[]).length>3&&<span className="badge badge-gray">+{s.linecards.length-3}</span>}
                  {!(s.linecards||[]).length&&<span className="muted">—</span>}
                </td>
                <td style={{fontSize:11,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.payment_terms||'—'}</td>
                <td>{s.status==='active'?<span className="badge badge-green">Active</span>:<span className="badge badge-gray">Inactive</span>}</td>
                <td style={{fontSize:11,color:'var(--text3)',whiteSpace:'nowrap'}}>{fmtDateTime(s.created||s.created_at)}</td>
                <td style={{textAlign:'right'}}>
                  <button className="btn btn-xs btn-primary" onClick={()=>setModal(s)}>✏ Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal!==null&&<SupplierModal supplier={Object.keys(modal).length?modal:null} linecards={linecards} onClose={()=>setModal(null)}/>}
      {showBulk&&<BulkUpload onClose={()=>setShowBulk(false)} onDone={()=>{qc.invalidateQueries(['suppliers']);setShowBulk(false);}}/>}
    </div>
  );
}
