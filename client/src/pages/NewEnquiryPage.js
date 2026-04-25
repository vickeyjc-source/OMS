// client/src/pages/NewEnquiryPage.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { today } from '../utils/helpers';
import { ALL_MANUFACTURERS, MANUFACTURERS_BY_CAT, CATS } from './LineCardsPage';

const BUYING_TYPES = ['Shortage','Tactical','NPI','R&D','Production','Testing'];

// ── Quick Add Line Card modal ─────────────────────────────────────────────────
export function AddLinecardModal({ prefillName, onClose, onSaved }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ name:prefillName||'', category:'Semiconductors', description:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const suggestedMfrs = MANUFACTURERS_BY_CAT[form.category]||[];
  const mutation = useMutation({
    mutationFn: d => api.post('/linecards', d),
    onSuccess: r => {
      qc.invalidateQueries(['linecards']);
      toast.success('Line card added!');
      onSaved && onSaved(r.data.id, form.name);
      onClose();
    },
    onError: () => toast.error('Save failed'),
  });
  return (
    <div className="overlay" style={{zIndex:300}}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>+ Add New Line Card</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={e=>set('category',e.target.value)}>
              {CATS.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Manufacturer / Brand <span className="req">*</span></label>
            <input className="input" list="add-lc-mfr-list" value={form.name}
              onChange={e=>set('name',e.target.value)} placeholder="Select or type manufacturer…"/>
            <datalist id="add-lc-mfr-list">
              {suggestedMfrs.map(m=><option key={m} value={m}/>)}
            </datalist>
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={form.description}
              onChange={e=>set('description',e.target.value)} placeholder="Product lines, components…"/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate(form)}>
            {mutation.isPending?'Adding…':'Add Line Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manufacturer combo field ──────────────────────────────────────────────────
export function ManufacturerField({ value, onChange, linecards, onAddNew }) {
  const [open,    setOpen]    = React.useState(false);
  const [search,  setSearch]  = React.useState('');
  const [cursor,  setCursor]  = React.useState(-1);
  const inputRef  = React.useRef();
  const listRef   = React.useRef();

  const existingSet = React.useMemo(() =>
    new Set(linecards.map(l => l.name.toLowerCase())), [linecards]);

  const q = search.toLowerCase();
  const matchingLcs = React.useMemo(() =>
    linecards.filter(l => !q || l.name.toLowerCase().includes(q)).slice(0, 15),
    [linecards, q]);
  const matchingAll = React.useMemo(() =>
    ALL_MANUFACTURERS.filter(m => !existingSet.has(m.toLowerCase()) && (!q || m.toLowerCase().includes(q))).slice(0, 25),
    [existingSet, q]);

  const allItems = React.useMemo(() => [
    ...matchingLcs.map(l => ({ label: l.name, sub: l.category, type: 'lc' })),
    ...matchingAll.map(m => ({ label: m, type: 'all' })),
    { label: search ? `Add "${search}" as new Line Card` : 'Add new Line Card…', type: 'add' },
  ], [matchingLcs, matchingAll, search]);

  const select = (item) => {
    if (item.type === 'add') { onAddNew(search); }
    else { onChange(item.label); }
    setOpen(false); setSearch(''); setCursor(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); setCursor(0); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => { const n = Math.min(c + 1, allItems.length - 1); scrollToItem(n); return n; });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => { const n = Math.max(c - 1, 0); scrollToItem(n); return n; });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor >= 0 && cursor < allItems.length) select(allItems[cursor]);
      else if (search.trim()) { onChange(search.trim()); setOpen(false); setSearch(''); setCursor(-1); }
    } else if (e.key === 'Escape') {
      setOpen(false); setCursor(-1);
    } else if (e.key === 'Tab') {
      setOpen(false); setCursor(-1);
    }
  };

  const scrollToItem = (idx) => {
    if (!listRef.current) return;
    const item = listRef.current.querySelectorAll('[data-item]')[idx];
    item?.scrollIntoView({ block: 'nearest' });
  };

  const handleBlur = (e) => {
    if (!listRef.current?.contains(e.relatedTarget)) { setOpen(false); setCursor(-1); }
  };

  return (
    <div className="field-wrap" style={{position:'relative'}}>
      <div style={{display:'flex',border:'1px solid var(--border-md)',borderRadius:'var(--r-sm)',overflow:'hidden',background:'var(--surface)'}}>
        <input ref={inputRef} className="input"
          style={{border:'none',flex:1,borderRadius:0}}
          value={open ? search : value}
          placeholder="Type or select manufacturer…"
          autoComplete="off"
          onFocus={() => { setSearch(value || ''); setOpen(true); setCursor(-1); }}
          onBlur={handleBlur}
          onChange={e => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); setCursor(-1); }}
          onKeyDown={handleKeyDown}
        />
        {value && !open && (
          <button type="button" tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); onChange(''); setSearch(''); inputRef.current?.focus(); }}
            style={{background:'none',border:'none',padding:'0 8px',cursor:'pointer',color:'var(--text3)',fontSize:16,lineHeight:1}}>×</button>
        )}
        <button type="button" tabIndex={-1}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch(value||''); inputRef.current?.focus(); }}
          style={{background:'var(--surface2)',border:'none',borderLeft:'1px solid var(--border-md)',padding:'0 10px',cursor:'pointer',fontSize:11,color:'var(--text2)'}}>
          {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div ref={listRef}
          style={{position:'absolute',top:'calc(100% + 2px)',left:0,right:0,zIndex:300,
            background:'var(--surface)',border:'1px solid var(--border)',
            borderRadius:'var(--r-sm)',boxShadow:'0 6px 24px rgba(0,0,0,.13)',
            maxHeight:260,overflowY:'auto'}}>
          {matchingLcs.length > 0 && <>
            <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'var(--text3)',background:'var(--surface2)',letterSpacing:.5,position:'sticky',top:0}}>YOUR LINE CARDS</div>
            {matchingLcs.map((l, i) => { const hi = cursor === i; return (
              <div key={l.id} data-item tabIndex={-1}
                onMouseDown={e => { e.preventDefault(); select({ label:l.name, type:'lc' }); }}
                onMouseEnter={() => setCursor(i)}
                style={{padding:'7px 12px',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid var(--border)',background:hi?'var(--accent-lt)':'',color:hi?'var(--accent)':''}}>
                <span style={{fontWeight:600}}>{l.name}</span>
                <span style={{fontSize:10,color:hi?'var(--accent)':'var(--text3)'}}>{l.category}</span>
              </div>
            );})}
          </>}
          {matchingAll.length > 0 && <>
            <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'var(--text3)',background:'var(--surface2)',letterSpacing:.5,position:'sticky',top:0}}>ALL MANUFACTURERS</div>
            {matchingAll.map((m, i) => { const idx = matchingLcs.length + i; const hi = cursor === idx; return (
              <div key={m} data-item tabIndex={-1}
                onMouseDown={e => { e.preventDefault(); select({ label:m, type:'all' }); }}
                onMouseEnter={() => setCursor(idx)}
                style={{padding:'7px 12px',cursor:'pointer',fontSize:13,borderBottom:'1px solid var(--border)',background:hi?'var(--accent-lt)':'',color:hi?'var(--accent)':''}}>
                {m}
              </div>
            );})}
          </>}
          {(() => { const idx = matchingLcs.length + matchingAll.length; const hi = cursor === idx; return (
            <div data-item tabIndex={-1}
              onMouseDown={e => { e.preventDefault(); select({ type:'add' }); }}
              onMouseEnter={() => setCursor(idx)}
              style={{padding:'8px 12px',cursor:'pointer',fontSize:12,fontWeight:600,color:hi?'#fff':'var(--accent)',background:hi?'var(--accent)':'var(--accent-lt)',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6,position:'sticky',bottom:0}}>
              <span style={{fontSize:16}}>+</span>
              {search ? `Add "${search}" as new Line Card` : 'Add new Line Card…'}
            </div>
          );})()}
        </div>
      )}
    </div>
  );
}

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────
function BulkUploadModal({ onClose, onImport }) {
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState('');

  const downloadSample = () => {
    const header = 'component,ipn,manufacturer,quantity,target_currency,target_price,date_code,preferred_delivery_date';
    const sample = [
      'STM32F103C8T6,IPN-001,STMicroelectronics,100,INR,245.50,2023+,2025-06-30',
      'LM358,IPN-002,Texas Instruments,500,INR,12.00,ANY,2025-07-15',
      'ATmega328P,,Microchip,200,USD,1.85,2024+,2025-08-01',
    ].join('\n');
    const blob = new Blob([header+'\n'+sample], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'enquiry_bulk_upload_sample.csv';
    a.click();
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split('\n').filter(l=>l.trim());
        const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
        const parsed = lines.slice(1).map(line => {
          const vals = line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
          const row = {};
          headers.forEach((h,i) => row[h]=vals[i]||'');
          return row;
        }).filter(r=>r.component);
        if (!parsed.length) { setError('No valid rows found in file'); return; }
        setError('');
        setRows(parsed);
      } catch(e) { setError('Failed to parse file: '+e.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2>📋 Bulk Upload Components</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>Upload a CSV with multiple components</div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{marginBottom:16,padding:'12px 14px',background:'var(--accent-lt)',borderRadius:'var(--r-sm)'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>Step 1 — Download sample CSV template</div>
            <div style={{fontSize:12,color:'var(--text2)',marginBottom:8}}>
              Required columns: <strong>component, manufacturer, quantity, preferred_delivery_date</strong><br/>
              Optional: ipn, target_currency, target_price, date_code
            </div>
            <button className="btn btn-sm" onClick={downloadSample}>⬇ Download Sample CSV</button>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Step 2 — Upload your filled CSV</div>
            <input type="file" accept=".csv,.txt"
              style={{display:'block',padding:'8px',border:'2px dashed var(--border)',borderRadius:'var(--r-sm)',width:'100%',cursor:'pointer'}}
              onChange={handleFile}/>
            {error && <div style={{color:'var(--red)',fontSize:12,marginTop:6,fontWeight:600}}>❌ {error}</div>}
          </div>
          {rows.length > 0 && (
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'var(--green)'}}>
                ✅ {rows.length} component{rows.length!==1?'s':''} ready to import
              </div>
              <div style={{overflowX:'auto',maxHeight:220,overflowY:'auto'}}>
                <table className="li-table" style={{fontSize:11}}>
                  <thead><tr><th>#</th><th>Component</th><th>Manufacturer</th><th>Qty</th><th>Currency</th><th>Target Price</th><th>Date Code</th><th>Delivery Date</th></tr></thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={i}>
                        <td>{i+1}</td><td className="bold">{r.component}</td>
                        <td>{r.manufacturer||'—'}</td><td>{r.quantity||'—'}</td>
                        <td>{r.target_currency||'INR'}</td><td>{r.target_price||'—'}</td>
                        <td>{r.date_code||'—'}</td><td>{r.preferred_delivery_date||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!rows.length}
            onClick={()=>{ onImport(rows); onClose(); }}>
            📋 Import {rows.length} Component{rows.length!==1?'s':''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NewEnquiryPage() {
  const navigate = useNavigate();
  const location  = useLocation();
  const editEnq       = location.state?.editEnquiry || null;
  const returnToOrder = location.state?.returnToOrder || false;
  const existingOrder = location.state?.existingOrder || null;
  const qc = useQueryClient();
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: users=[] }     = useQuery({ queryKey:['users'],     queryFn:()=>api.get('/users').then(r=>r.data) });
  const { data: linecards=[] } = useQuery({ queryKey:['linecards'], queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const [addLcModal, setAddLcModal] = useState({ open:false, prefill:'' });
  const [showBulk,   setShowBulk]   = useState(false);

  const [form, setForm] = useState(() => ({
    customer_id:  editEnq?.customer_id  || '',
    assigned_to:  editEnq?.assigned_to  || '',
    priority:     editEnq?.priority     || 'normal',
    buying_type:  editEnq?.buying_type  || '',
    notes:        editEnq?.notes        || '',
  }));

  const [items, setItems] = useState(() => {
    if (editEnq?.items?.length) {
      return editEnq.items.map((it, i) => ({
        id: it.id || 'i' + (i+1),
        component:              it.component || '',
        ipn:                    it.ipn || '',
        manufacturer:           it.manufacturer || '',
        target_price:           it.target_price || '',
        target_currency:        it.target_currency || 'INR',
        quantity:               it.quantity || '',
        preferred_delivery_date:it.preferred_delivery_date || '',
        date_code:              it.date_code || '',
      }));
    }
    return [{ id:'i1', component:'', ipn:'', manufacturer:'', target_price:'', target_currency:'INR', quantity:'', preferred_delivery_date:'', date_code:'' }];
  });

  const addItem    = () => setItems(p=>[...p,{
    id:'i'+Date.now(), component:'', ipn:'', manufacturer:'',
    target_price:'', target_currency:'INR',
    quantity:'', preferred_delivery_date:'', date_code:'',
  }]);
  const removeItem = idx => setItems(p=>p.filter((_,i)=>i!==idx));
  const updateItem = (idx,k,v) => setItems(p=>p.map((it,i)=>i===idx?{...it,[k]:v}:it));

  // ── Bulk import handler ───────────────────────────────────────────────────
  const handleBulkImport = (rows) => {
    const newItems = rows.map((r,i) => ({
      id: 'bulk_'+Date.now()+'_'+i,
      component:               r.component || '',
      ipn:                     r.ipn || '',
      manufacturer:            r.manufacturer || '',
      target_price:            r.target_price || '',
      target_currency:         r.target_currency || 'INR',
      quantity:                r.quantity || '',
      preferred_delivery_date: r.preferred_delivery_date || '',
      date_code:               r.date_code || '',
    }));
    setItems(prev => {
      const hasData = prev.some(it=>it.component.trim());
      return hasData ? [...prev, ...newItems] : newItems;
    });
    toast.success(`✅ Imported ${newItems.length} component${newItems.length!==1?'s':''}`);
  };

  const validate = (mode) => {
    if (!form.customer_id) { toast.error('Select a customer'); return null; }
    const valid = items.filter(i=>i.component.trim());
    // Draft: allow saving with no items yet (just customer selected)
    if (mode === 'draft') return valid.length ? valid : [];
    if (!valid.length) { toast.error('Add at least one component'); return null; }
    if (mode === 'submit') {
      if (!form.buying_type) { toast.error('Buying Type is required'); return null; }
      for (let i = 0; i < valid.length; i++) {
        if (!valid[i].manufacturer.trim()) { toast.error('Item ' + (i+1) + ': Manufacturer is required'); return null; }
        if (!valid[i].quantity || Number(valid[i].quantity) <= 0) { toast.error('Item ' + (i+1) + ': Quantity is required'); return null; }
        if (!valid[i].preferred_delivery_date) { toast.error('Item ' + (i+1) + ': Delivery Date is required'); return null; }
      }
    }
    return valid;
  };

  const mutation = useMutation({
    mutationFn: d => {
      if (editEnq?.id && d.status === 'draft') return api.put('/enquiries/' + editEnq.id, d);
      if (editEnq?.id && d.status === 'sourcing') return api.put('/enquiries/' + editEnq.id, {
        ...d,
        existing_order_id: existingOrder?.id || null,
        _action: returnToOrder ? 'Revised & Resubmitted to Sourcing (from Order)' : 'Revised & Sent to Sourcing',
      });
      return api.post('/enquiries', d);
    },
    onSuccess: (_,vars) => {
      qc.invalidateQueries(['enquiries']);
      qc.invalidateQueries(['summary']);
      if (vars._submitMode === 'draft') {
        toast.success('💾 Saved as draft');
        navigate('/enquiries');
      } else if (returnToOrder) {
        toast.success('✅ Enquiry revised & sent to Sourcing. Once sourcing is done a new quote will appear — create the order from that quote.');
        navigate('/enquiries');
      } else {
        toast.success('✅ Enquiry submitted to Sourcing!');
        navigate('/sourcing-bin');
      }
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleDraft  = () => { const v = validate('draft');  if (v !== null) mutation.mutate({ ...form, status:'draft',    items:v, _submitMode:'draft'  }); };
  const handleSubmit = () => { const v = validate('submit'); if (v) mutation.mutate({ ...form, status:'sourcing', items:v, _submitMode:'submit' }); };

  const sourcingUsers = users.filter(u=>u.department==='sourcing'||['admin','manager'].includes(u.role));
  const busy = mutation.isPending;

  const cols = [
    { key:'component', label:'Component *', flex:'2 1 130px',
      render:(li,idx)=><input className="input" value={li.component} placeholder="e.g. STM32F103C8T6" onChange={e=>updateItem(idx,'component',e.target.value)} /> },
    { key:'ipn', label:'IPN', flex:'1 1 80px',
      render:(li,idx)=><input className="input" value={li.ipn} placeholder="IPN-001" onChange={e=>updateItem(idx,'ipn',e.target.value)} /> },
    { key:'manufacturer', label:'Manufacturer *', flex:'1.5 1 130px',
      render:(li,idx)=>(
        <ManufacturerField value={li.manufacturer} linecards={linecards}
          onChange={v=>updateItem(idx,'manufacturer',v)}
          onAddNew={name=>setAddLcModal({open:true,prefill:name,itemIdx:idx})}/>
      ),
    },
    { key:'quantity', label:'Qty *', flex:'0.6 1 55px',
      render:(li,idx)=><input className="input" type="number" value={li.quantity} placeholder="0" onChange={e=>updateItem(idx,'quantity',e.target.value)} /> },
    { key:'target_currency', label:'Cur.', flex:'0.6 1 58px',
      render:(li,idx)=><select className="input" value={li.target_currency} onChange={e=>updateItem(idx,'target_currency',e.target.value)}>{['INR','USD','EUR','SGD'].map(c=><option key={c}>{c}</option>)}</select> },
    { key:'target_price', label:'Target Price', flex:'1 1 80px',
      render:(li,idx)=><input className="input" type="number" step="0.01" value={li.target_price} placeholder="0.00" onChange={e=>updateItem(idx,'target_price',e.target.value)} /> },
    { key:'date_code', label:'Date Code', flex:'0.8 1 70px',
      render:(li,idx)=><input className="input" value={li.date_code} placeholder="2023+" onChange={e=>updateItem(idx,'date_code',e.target.value)} /> },
    { key:'preferred_delivery_date', label:'Delivery Date *', flex:'1.1 1 110px',
      render:(li,idx)=><input className="input" type="date" value={li.preferred_delivery_date} onChange={e=>updateItem(idx,'preferred_delivery_date',e.target.value)} /> },

    { key:'base_value', label:'Base Value', flex:'1 1 88px',
      render:(li)=>{
        const qty = Number(li.quantity)||0;
        const up  = Number(li.target_price)||0;
        if (!qty || !up) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        const sym = {INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};
        const s   = sym[li.target_currency]||li.target_currency+' ';
        const val = qty * up;
        return (
          <div style={{padding:'5px 8px',background:'var(--surface2)',borderRadius:'var(--r-sm)',
            fontWeight:600,fontSize:12,textAlign:'right',whiteSpace:'nowrap',
            border:'1px solid var(--border)',color:'var(--text)'}}>
            {s}{val.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
          </div>
        );
      },
    },
    { key:'total_price', label:'Total Value', flex:'1.1 1 95px',
      render:(li)=>{
        const qty  = Number(li.quantity)||0;
        const up   = Number(li.target_price)||0;
        if (!qty || !up) return <span style={{color:'var(--text3)',fontSize:11,padding:'5px 8px',display:'block'}}>—</span>;
        const sym  = {INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};
        const s    = sym[li.target_currency]||li.target_currency+' ';
        const total= qty * up;
        return (
          <div style={{padding:'5px 8px',background:'var(--surface2)',
            borderRadius:'var(--r-sm)',fontWeight:700,fontSize:12,textAlign:'right',
            whiteSpace:'nowrap',border:'1px solid var(--border)',
            color:'var(--text)'}}>
            {s}{total.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
          </div>
        );
      },
    },
  ];

  const rowStyle = idx => ({
    display:'flex', gap:5, alignItems:'center', padding:'4px 6px',
    borderRadius:'var(--r-sm)', marginBottom:2,
    background: idx%2===0 ? 'transparent' : 'var(--surface2)',
  });

  return (
    <>
    <div style={{maxWidth:1500}}>
      <div className="card">
        <div className="card-title">
          {editEnq
            ? returnToOrder
              ? `🔄 Modify Enquiry — ${editEnq.id} (Revising for Order)`
              : `✏ Edit Enquiry — ${editEnq.id}`
            : 'New Customer Enquiry'}
        </div>

        {/* ── Return-to-Order banner ── */}
        {returnToOrder && (
          <div style={{padding:'10px 14px',borderRadius:'var(--r-sm)',marginBottom:14,
            background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)44',
            fontSize:13,display:'flex',alignItems:'flex-start',gap:10}}>
            <span style={{fontSize:18,lineHeight:1.2,flexShrink:0}}>ℹ️</span>
            <div>
              <div style={{fontWeight:700,color:'var(--amber,#d97706)',marginBottom:3}}>Modifying from Order Creation</div>
              <div style={{color:'var(--text2)',lineHeight:1.5}}>
                You can add, remove, or update component requirements below.
                After clicking <strong>Submit to Sourcing →</strong>, sourcing will re-price the items
                and generate a new quote. Come back to <strong>Quotes</strong> to create the order from the updated quote.
              </div>
            </div>
          </div>
        )}

        <div className="section-divider">Customer Details</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:13,marginBottom:13}}>
          <div className="form-group">
            <label className="label">Customer <span className="req">*</span></label>
            <select className="input" value={form.customer_id} onChange={e=>setForm(f=>({...f,customer_id:e.target.value}))}
              disabled={!!(editEnq?.customer_id)}
              style={editEnq?.customer_id ? {opacity:0.7,cursor:'not-allowed',background:'var(--surface2)'} : {}}>
              <option value="">— Select Customer —</option>
              {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Assign to Sourcing</label>
            <select className="input" value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))}>
              <option value="">— Auto-assign —</option>
              {sourcingUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Buying Type <span className="req">*</span></label>
            <select className="input" value={form.buying_type} onChange={e=>setForm(f=>({...f,buying_type:e.target.value}))}>
              <option value="">— Select Type —</option>
              {BUYING_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Notes / Special Instructions</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
        </div>

        <div className="section-divider" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>Component Requirements</span>
          <button className="btn btn-xs" onClick={()=>setShowBulk(true)}
            style={{fontWeight:600,fontSize:11}}>
            📋 Bulk Upload CSV
          </button>
        </div>

        {/* Header */}
        <div style={{display:'flex',gap:5,alignItems:'center',padding:'0 6px 6px 6px',borderBottom:'1px solid var(--border)',marginBottom:4}}>
          <div style={{flex:'0 0 22px'}} />
          {cols.map(c=>(
            <div key={c.key} style={{flex:c.flex,minWidth:0}}>
              <span style={{fontSize:11,fontWeight:600,color:'var(--text2)',whiteSpace:'nowrap'}}>{c.label}</span>
            </div>
          ))}
          <div style={{flex:'0 0 26px'}} />
        </div>

        {/* Rows */}
        {items.map((li,idx)=>(
          <div key={li.id} style={rowStyle(idx)}>
            <div style={{flex:'0 0 22px',fontSize:11,fontWeight:600,color:'var(--text3)',textAlign:'center',userSelect:'none'}}>{idx+1}</div>
            {cols.map(c=>(
              <div key={c.key} style={{flex:c.flex,minWidth:0}}>{c.render(li,idx)}</div>
            ))}
            <div style={{flex:'0 0 26px',display:'flex',justifyContent:'center'}}>
              {items.length>1
                ? <button className="btn btn-xs btn-danger" title="Remove" style={{padding:'1px 7px',fontSize:15,lineHeight:1}} onClick={()=>removeItem(idx)}>×</button>
                : <span />}
            </div>
          </div>
        ))}

        <button className="btn btn-sm" onClick={addItem} style={{marginTop:10,marginBottom:16}}>+ Add Component</button>

        {/* Actions */}
        <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,borderTop:'1px solid var(--border)',paddingTop:16}}>
          <button className="btn" onClick={()=>navigate('/enquiries')} disabled={busy}>Cancel</button>
          <button className="btn" onClick={handleDraft} disabled={busy}
            style={{color:'var(--text2)',borderColor:'var(--border-md)'}}>
            {busy ? '…' : '💾 Save as Draft'}
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit Sourcing →'}
          </button>
        </div>
      </div>
    </div>

    {addLcModal.open && (
      <AddLinecardModal
        prefillName={addLcModal.prefill}
        onClose={()=>setAddLcModal({open:false,prefill:''})}
        onSaved={(_id, name)=>{
          if (addLcModal.itemIdx !== undefined) updateItem(addLcModal.itemIdx,'manufacturer',name);
        }}
      />
    )}

    {showBulk && (
      <BulkUploadModal
        onClose={()=>setShowBulk(false)}
        onImport={handleBulkImport}
      />
    )}
    </>
  );
}
