// client/src/pages/EnquiriesPage.js
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES, DEPARTMENTS, DEPT_LABEL } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

function EnquiryDetailModal({ enq, onClose, customers, suppliers, linecards, users }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isSourcing = user.department === 'sourcing' || ['admin','manager'].includes(user.role);
  const [editSection, setEditSection] = useState(null);
  const [statusVal, setStatusVal]     = useState(enq.status);
  const [assignTo, setAssignTo]       = useState(enq.assigned_to || '');
  const [srcRows, setSrcRows]         = useState(enq.sourcing || []);

  const mutation = useMutation({
    mutationFn: d => api.put(`/enquiries/${enq.id}`, d).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['enquiries']); toast.success('Saved'); setEditSection(null); },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || id;
  const lcName   = id => linecards.find(l => l.id === id)?.name || id;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>{enq.id} — {custName(enq.customer_id)}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>Created {enq.created_at} · Priority: <strong>{enq.priority}</strong></div>
          </div>
          <div className="flex gap-8"><StatusBadge s={enq.status} /><button className="close-x" onClick={onClose}>×</button></div>
        </div>
        <div className="modal-body">

          {/* Line Items */}
          <div className="card card-sm">
            <div className="card-title"><span>📋 Enquiry Items ({enq.items?.length || 0})</span></div>
            <div style={{overflowX:'auto'}}>
              <table className="li-table">
                <thead><tr><th>#</th><th>Component</th><th>IPN</th><th>Manufacturer</th><th>Line Card</th><th>Qty</th><th>Target Price</th><th>Pref. Delivery</th><th>Date Code</th></tr></thead>
                <tbody>
                  {enq.items?.map((li, i) => (
                    <tr key={li.id}>
                      <td>{i+1}</td><td className="bold">{li.component}</td>
                      <td className="mono">{li.ipn||'—'}</td><td>{li.manufacturer||'—'}</td>
                      <td>{li.linecard_id ? lcName(li.linecard_id) : '—'}</td>
                      <td>{li.quantity}</td>
                      <td className="mono">{li.target_price ? `${li.target_currency} ${li.target_price}` : '—'}</td>
                      <td>{li.preferred_delivery_date||'—'}</td>
                      <td>{li.date_code||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sourcing Updates — only shown once enquiry is in sourcing or beyond */}
          {isSourcing && !['new','draft'].includes(enq.status) && (
            <div className="card card-sm">
              <div className="card-title">
                <span>🔍 Sourcing Updates</span>
                <button className="btn btn-xs btn-primary" onClick={() => setEditSection(editSection==='sourcing'?null:'sourcing')}>
                  {editSection==='sourcing'?'Cancel':'Edit Sourcing'}
                </button>
              </div>
              {editSection === 'sourcing' ? (
                <div>
                  {enq.items?.map(item => {
                    const src = srcRows.find(s => s.enquiry_item_id === item.id) || { id: null, enquiry_item_id: item.id, supplier_id: '', sourced_price: '', sourced_currency: 'USD', availability: '', lead_time: '', notes: '' };
                    const idx = srcRows.findIndex(s => s.enquiry_item_id === item.id);
                    const update = (k, v) => {
                      const copy = [...srcRows];
                      if (idx >= 0) copy[idx] = {...copy[idx],[k]:v};
                      else copy.push({...src, id: `src_${Date.now()}`, [k]: v});
                      setSrcRows(copy);
                    };
                    return (
                      <div key={item.id} className="sup-block" style={{marginBottom:10}}>
                        <div className="bold mb-8" style={{marginBottom:8,fontSize:12}}>{item.component} — Qty: {item.quantity}</div>
                        <div className="form-grid-3" style={{marginBottom:8}}>
                          <div className="form-group"><label className="label">Supplier</label>
                            <select className="input" value={src.supplier_id} onChange={e=>update('supplier_id',e.target.value)}>
                              <option value="">— Select —</option>
                              {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                          <div className="form-group"><label className="label">Sourced Price</label>
                            <input className="input" type="number" value={src.sourced_price} onChange={e=>update('sourced_price',e.target.value)} />
                          </div>
                          <div className="form-group"><label className="label">Currency</label>
                            <select className="input" value={src.sourced_currency} onChange={e=>update('sourced_currency',e.target.value)}>
                              {['USD','INR','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="form-grid-3">
                          <div className="form-group"><label className="label">Availability</label><input className="input" value={src.availability} onChange={e=>update('availability',e.target.value)} placeholder="In stock / 4 weeks" /></div>
                          <div className="form-group"><label className="label">Lead Time</label><input className="input" value={src.lead_time} onChange={e=>update('lead_time',e.target.value)} placeholder="e.g. 4 weeks" /></div>
                          <div className="form-group"><label className="label">Notes</label><input className="input" value={src.notes} onChange={e=>update('notes',e.target.value)} /></div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex gap-8 mt-12" style={{marginTop:10}}>
                    <button className="btn btn-sm" onClick={()=>setEditSection(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={()=>mutation.mutate({sourcing: srcRows, status: enq.status==='new'?'sourcing':enq.status, _action:'Sourcing updated'})}>Save Sourcing</button>
                  </div>
                </div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table className="li-table">
                    <thead><tr><th>Component</th><th>Supplier</th><th>Price</th><th>Availability</th><th>Lead Time</th><th>Notes</th></tr></thead>
                    <tbody>
                      {enq.items?.map(item => {
                        const src = enq.sourcing?.find(s => s.enquiry_item_id === item.id);
                        return (
                          <tr key={item.id}>
                            <td className="bold">{item.component}</td>
                            <td>{src ? supName(src.supplier_id) : <span className="muted">—</span>}</td>
                            <td className="mono">{src?.sourced_price ? `${src.sourced_currency} ${src.sourced_price}` : '—'}</td>
                            <td>{src?.availability||'—'}</td>
                            <td>{src?.lead_time||'—'}</td>
                            <td>{src?.notes||'—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Status + Assignment */}
          <div className="grid-2">
            <div className="card card-sm" style={{marginBottom:0}}>
              <div className="card-title">📌 Status &amp; Assignment</div>
              <div className="form-group"><label className="label">Status</label>
                <select className="input" value={statusVal} onChange={e=>setStatusVal(e.target.value)}>
                  {ENQ_STATUSES.filter(s=>s.v!=='new').map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">Assign To (Sourcing)</label>
                <select className="input" value={assignTo} onChange={e=>setAssignTo(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {users.filter(u=>u.department==='sourcing'||['admin','manager'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={()=>mutation.mutate({status:statusVal,assigned_to:assignTo||null,_action:`Status set to ${statusVal}`})}>Update Status</button>
                {enq.status==='new'&&(
                  <button className="btn btn-primary btn-sm"
                    style={{background:'var(--green)',borderColor:'var(--green)'}}
                    onClick={()=>mutation.mutate({status:'sourcing',assigned_to:assignTo||null,_action:'Submitted to Sourcing'},{
                      onSuccess:()=>{ window.location.href='/sourcing-bin'; }
                    })}>
                    🔍 Submit to Sourcing
                  </button>
                )}
              </div>
            </div>
            <div className="card card-sm" style={{marginBottom:0}}>
              <div className="card-title">🕐 History</div>
              <div className="timeline">
                {enq.history?.map((h,i)=>(
                  <div key={h.id} className="tl-row">
                    <div className="tl-dot-wrap"><div className={`tl-dot ${i===0?'td-active':'td-done'}`}><div className="tl-dot-inner"/></div></div>
                    <div className="tl-content"><div className="tl-title">{h.action}</div><div className="tl-sub">by {h.by_user}</div><div className="tl-ts">{h.ts}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EnquiriesPage() {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');
  const [selected, setSelected] = useState(null);
  const { data: enqs=[] }       = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data) });
  const { data: customers=[] }  = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: suppliers=[] }  = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: linecards=[] }  = useQuery({ queryKey:['linecards'], queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const { data: users=[] }      = useQuery({ queryKey:['users'],     queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const FILTERS = ['all','draft','new','sourcing','quoted','ordered','closed'];
  const filtered = enqs.filter(e => {
    if (filter!=='all' && e.status!==filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
  });

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const deleteSelected = async () => {
    if (!selected.size) return;
    try {
      await api.request({ method:'DELETE', url:'/enquiries', data:{ ids:[...selected] } });
      toast.success(`Deleted ${selected.size} enquir${selected.size>1?'ies':'y'}`);
      setSelected(new Set());
      qc.invalidateQueries(['enquiries']); qc.invalidateQueries(['summary']);
    } catch(e) { toast.error('Delete failed'); }
  };

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search enquiries…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={()=>window.location.href='/enquiries/new'}>+ New Enquiry</button>
      </div>
      <div className="filter-row">
        {FILTERS.map(f=><span key={f} className={`fchip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>{f==='all'?'All':f.charAt(0).toUpperCase()+f.slice(1)}</span>)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Enquiry ID</th><th>Customer</th><th>Items</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>Created</th></tr></thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">📋</div><div>No enquiries found</div></div></td></tr>}
            {filtered.map(e=>(
              <tr key={e.id} className="clickable" onClick={()=>setSelected(e)}>
                <td>
                  <span className="mono" style={{fontSize:12,color:'var(--text3)'}}>{e.id}</span>
                  {e.sourcing_no && (
                    <span style={{display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                      <span style={{fontSize:10,color:'var(--text3)'}}>→</span>
                      <span className="mono bold" style={{fontSize:12,color:'var(--accent)',
                        background:'var(--accent-lt)',padding:'1px 6px',borderRadius:999,
                        border:'1px solid var(--accent)33'}}>
                        {e.sourcing_no}
                      </span>
                    </span>
                  )}
                </td>
                <td>{custName(e.customer_id)}</td>
                <td><span className="badge badge-blue">{e.items?.length||0}</span></td>
                <td><span className={`badge ${e.priority==='urgent'?'badge-red':e.priority==='high'?'badge-amber':'badge-gray'}`}>{e.priority}</span></td>
                <td><StatusBadge s={e.status} /></td>
                <td>{e.assigned_to ? users.find(u=>u.id===e.assigned_to)?.name||'—' : <span className="muted">Unassigned</span>}</td>
                <td>{e.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <EnquiryDetailModal enq={selected} onClose={()=>setSelected(null)} customers={customers} suppliers={suppliers} linecards={linecards} users={users} />}
    </div>
  );
}
