// client/src/pages/UsersPage.js  v2
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { initials, DEPARTMENTS, DEPT_LABEL, DEPT_COLOR, DeptBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';

function UserModal({ u, onClose }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isNew = !u?.id;
  const [form, setForm] = useState(u||{name:'',username:'',email:'',password:'',department:'sales',role:'user',status:'active'});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/users',d) : api.put(`/users/${u.id}`,d),
    onSuccess: ()=>{ qc.invalidateQueries(['users']); toast.success('User saved'); onClose(); },
    onError: e=>toast.error(e.response?.data?.error||'Failed'),
  });
  const del = useMutation({
    mutationFn: ()=>api.delete(`/users/${u.id}`),
    onSuccess: ()=>{ qc.invalidateQueries(['users']); toast.success('Deleted'); onClose(); },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header"><h2>{isNew?'Add User':'Edit User'}</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-group"><label className="label">Full Name <span className="req">*</span></label><input className="input" value={form.name} onChange={e=>set('name',e.target.value)} /></div>
          <div className="form-grid-2">
            <div className="form-group"><label className="label">Username <span className="req">*</span></label><input className="input" value={form.username} onChange={e=>set('username',e.target.value)} /></div>
            <div className="form-group"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="label">Password {u?'(blank = keep)':''} <span className="req">*</span></label><input className="input" type="password" value={form.password||''} onChange={e=>set('password',e.target.value)} /></div>
          <div className="form-grid-2">
            <div className="form-group"><label className="label">Department <span className="req">*</span></label>
              <select className="input" value={form.department} onChange={e=>set('department',e.target.value)}>
                {DEPARTMENTS.map(d=><option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Role</label>
              <select className="input" value={form.role} onChange={e=>set('role',e.target.value)}>
                <option value="user">User</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label className="label">Status</label>
            <select className="input" value={form.status} onChange={e=>set('status',e.target.value)}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          {!isNew&&u.id!==me.id&&<button className="btn btn-danger btn-sm" style={{marginRight:'auto'}} onClick={()=>setConfirmDelete(true)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate(form)}>{mutation.isPending?'Saving…':'Save'}</button>
        </div>
      </div>
    </div>
    {confirmDelete && (
      <ConfirmDeleteModal
        label={u?.name}
        onConfirm={() => { setConfirmDelete(false); del.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
        loading={del.isPending}
      />
    )}
    </>
  );
}


// ── DangerZone ────────────────────────────────────────────────────────────────
const MODULES = [
  { key:'orders',    label:'All Orders',        icon:'📦', desc:'Deletes all orders, line items, supplier POs, shipping records and order history.',   color:'var(--red)' },
  { key:'enquiries', label:'All Enquiries',      icon:'📋', desc:'Deletes all enquiries, enquiry items, sourcing data and enquiry history.',             color:'var(--red)' },
  { key:'quotes',    label:'All Quotes',         icon:'📄', desc:'Deletes all quote records from the Quote Bin.',                                        color:'var(--red)' },
  { key:'sourcing',  label:'Sourcing Data Only', icon:'🔍', desc:'Deletes only sourcing rows (supplier prices/availability) — keeps enquiries intact.',  color:'var(--amber,#d97706)' },
  { key:'approvals', label:'All Approvals',      icon:'✅', desc:'Deletes all approval workflows, requests and actions.',                                color:'var(--amber,#d97706)' },
];

function DangerZone() {
  const qc = useQueryClient();
  const [confirmMod,   setConfirmMod]   = React.useState(null);   // module key for single delete
  const [confirmAll,   setConfirmAll]   = React.useState(false);   // master delete dialog
  const [masterText,   setMasterText]   = React.useState('');      // typed confirmation
  const [loading,      setLoading]      = React.useState(false);
  const [lastResult,   setLastResult]   = React.useState(null);

  const doModuleDelete = async (key) => {
    setLoading(true);
    try {
      const res = await api.delete('/admin/delete/' + key);
      setLastResult({ type:'module', label:res.data.label, deleted:res.data.deleted });
      qc.invalidateQueries();
      toast.success(res.data.label + ' deleted — ' + res.data.deleted + ' rows removed');
    } catch(e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    } finally { setLoading(false); setConfirmMod(null); }
  };

  const doMasterDelete = async () => {
    if (masterText !== 'DELETE ALL DATA') { toast.error('Type the confirmation text exactly'); return; }
    setLoading(true);
    try {
      const res = await api.delete('/admin/delete-all', { data:{ confirm_text:'DELETE ALL DATA' } });
      setLastResult({ type:'all', deleted:res.data.deleted });
      qc.invalidateQueries();
      toast.success('All data wiped — ' + res.data.deleted + ' rows deleted');
    } catch(e) {
      toast.error(e.response?.data?.error || 'Master delete failed');
    } finally { setLoading(false); setConfirmAll(false); setMasterText(''); }
  };

  return (
    <>
      <div style={{marginTop:32,border:'2px solid var(--red)',borderRadius:'var(--r)',overflow:'hidden'}}>
        {/* Header */}
        <div style={{background:'var(--red)',padding:'12px 20px',display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:'#fff'}}>Danger Zone — Data Management</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.8)',marginTop:2}}>These actions are <strong>irreversible</strong>. Only Admin accounts can access this section.</div>
          </div>
        </div>

        <div style={{padding:'20px',background:'#fff8f8'}}>

          {/* Last result banner */}
          {lastResult && (
            <div style={{marginBottom:16,padding:'10px 14px',background:'var(--green-lt)',border:'1px solid var(--green)',borderRadius:'var(--r-sm)',fontSize:13,color:'var(--green)',fontWeight:600}}>
              ✅ {lastResult.type==='all' ? 'Master Delete complete' : lastResult.label + ' deleted'} — {lastResult.deleted} rows removed
              <button onClick={()=>setLastResult(null)} style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'var(--green)',fontSize:16}}>×</button>
            </div>
          )}

          {/* Module delete cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:20}}>
            {MODULES.map(mod=>(
              <div key={mod.key} style={{border:'1px solid var(--border)',borderRadius:'var(--r-sm)',padding:'14px 16px',background:'#fff'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                  <span style={{fontSize:20}}>{mod.icon}</span>
                  <span style={{fontWeight:700,fontSize:13,color:mod.color}}>{mod.label}</span>
                </div>
                <div style={{fontSize:12,color:'var(--text2)',marginBottom:12,lineHeight:1.5}}>{mod.desc}</div>
                <button
                  className="btn btn-sm btn-danger"
                  style={{width:'100%',background:mod.color,borderColor:mod.color,color:'#fff'}}
                  onClick={()=>setConfirmMod(mod.key)}
                  disabled={loading}>
                  🗑 Delete {mod.label}
                </button>
              </div>
            ))}
          </div>

          {/* Master delete */}
          <div style={{border:'2px dashed var(--red)',borderRadius:'var(--r-sm)',padding:'18px 20px',background:'#fff0f0'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
              <span style={{fontSize:24}}>💣</span>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:'var(--red)'}}>Master Delete — Wipe Everything</div>
                <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Deletes ALL Orders, Enquiries, Quotes, Sourcing data and Approvals in one shot. Customers, Suppliers and Users are kept.</div>
              </div>
            </div>
            <button
              className="btn btn-danger"
              style={{fontWeight:700,padding:'10px 24px'}}
              onClick={()=>setConfirmAll(true)}
              disabled={loading}>
              💣 Master Delete — Wipe All Data
            </button>
          </div>
        </div>
      </div>

      {/* ── Single Module Confirm Dialog ── */}
      {confirmMod && (() => {
        const mod = MODULES.find(m=>m.key===confirmMod);
        return (
          <div className="overlay">
            <div className="modal modal-sm">
              <div className="modal-header" style={{background:'var(--red-lt)'}}>
                <h2 style={{color:'var(--red)'}}>⚠️ Confirm Delete</h2>
                <button className="close-x" onClick={()=>setConfirmMod(null)}>×</button>
              </div>
              <div className="modal-body">
                <div style={{textAlign:'center',padding:'8px 0'}}>
                  <div style={{fontSize:40,marginBottom:12}}>{mod.icon}</div>
                  <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Delete {mod.label}?</div>
                  <div style={{fontSize:13,color:'var(--text2)',marginBottom:16,lineHeight:1.6}}>{mod.desc}</div>
                  <div style={{background:'var(--red-lt)',border:'1px solid var(--red)',borderRadius:'var(--r-sm)',padding:'10px 14px',fontSize:12,color:'var(--red)',fontWeight:600}}>
                    ⚠️ This action cannot be undone. There is no restore.
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={()=>setConfirmMod(null)} disabled={loading}>Cancel</button>
                <button className="btn btn-danger" disabled={loading} onClick={()=>doModuleDelete(confirmMod)}>
                  {loading ? 'Deleting…' : '🗑 Yes, Delete ' + mod.label}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Master Delete Confirm Dialog ── */}
      {confirmAll && (
        <div className="overlay">
          <div className="modal modal-sm">
            <div className="modal-header" style={{background:'#1a0000'}}>
              <h2 style={{color:'#ff4444'}}>💣 MASTER DELETE</h2>
              <button className="close-x" style={{color:'#fff'}} onClick={()=>{setConfirmAll(false);setMasterText('');}}>×</button>
            </div>
            <div className="modal-body">
              <div style={{textAlign:'center',padding:'8px 0'}}>
                <div style={{fontSize:48,marginBottom:12}}>💣</div>
                <div style={{fontWeight:800,fontSize:16,color:'var(--red)',marginBottom:8}}>This will wipe ALL operational data</div>
                <div style={{fontSize:13,color:'var(--text2)',marginBottom:20,lineHeight:1.7}}>
                  All <strong>Orders</strong>, <strong>Enquiries</strong>, <strong>Quotes</strong>, <strong>Sourcing</strong> and <strong>Approval</strong> records will be <strong>permanently deleted</strong>.
                  <br/>Customers, Suppliers, Line Cards and Users will <strong>not</strong> be affected.
                </div>
                <div style={{marginBottom:8,fontSize:12,fontWeight:600,color:'var(--text2)'}}>
                  Type <code style={{background:'var(--surface2)',padding:'2px 6px',borderRadius:4,color:'var(--red)',fontWeight:800}}>DELETE ALL DATA</code> to confirm:
                </div>
                <input
                  className="input"
                  value={masterText}
                  onChange={e=>setMasterText(e.target.value)}
                  placeholder="DELETE ALL DATA"
                  style={{textAlign:'center',fontWeight:700,letterSpacing:1,
                    borderColor: masterText==='DELETE ALL DATA' ? 'var(--green)' : masterText ? 'var(--red)' : undefined}}
                />
                {masterText==='DELETE ALL DATA' && (
                  <div style={{marginTop:8,fontSize:12,color:'var(--green)',fontWeight:600}}>✅ Confirmation text matches — you may proceed</div>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{justifyContent:'space-between'}}>
              <button className="btn" onClick={()=>{setConfirmAll(false);setMasterText('');}} disabled={loading}>Cancel — Keep Data</button>
              <button
                className="btn btn-danger"
                disabled={loading || masterText!=='DELETE ALL DATA'}
                style={{fontWeight:700,opacity: masterText==='DELETE ALL DATA'?1:0.4}}
                onClick={doMasterDelete}>
                {loading ? 'Deleting…' : '💣 Confirm Master Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [modal, setModal] = useState(null);
  const [deptFilter, setDeptFilter] = useState('all');
  const { data: users=[] } = useQuery({ queryKey:['users'], queryFn:()=>api.get('/users').then(r=>r.data) });
  if (!['admin','manager'].includes(me.role)) return <div className="empty-state"><div className="empty-icon">🔒</div><div>Admin access required</div></div>;

  const filtered = deptFilter==='all' ? users : users.filter(u=>u.department===deptFilter);

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div className="flex gap-8">
          <span style={{fontSize:13,color:'var(--text2)'}}>{users.length} users</span>
          <div className="filter-row" style={{marginBottom:0}}>
            <span className={`fchip ${deptFilter==='all'?'active':''}`} onClick={()=>setDeptFilter('all')}>All</span>
            {DEPARTMENTS.map(d=><span key={d} className={`fchip ${deptFilter===d?'active':''}`} onClick={()=>setDeptFilter(d)}>{DEPT_LABEL[d]}</span>)}
          </div>
        </div>
        <button className="btn btn-primary" onClick={()=>setModal({})}>+ Add User</button>
      </div>
      <div className="table-wrap" style={{marginBottom:18}}>
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map(u=>(
              <tr key={u.id}>
                <td><div className="flex gap-8"><div className="avatar" style={{width:26,height:26,fontSize:10}}>{initials(u.name)}</div><span className="bold">{u.name}</span></div></td>
                <td className="mono">{u.username}</td>
                <td>{u.email}</td>
                <td><DeptBadge dept={u.department} /></td>
                <td><span className={`role-${u.role}`}>{u.role}</span></td>
                <td>{u.status==='active'?<span className="badge badge-green">Active</span>:<span className="badge badge-gray">Inactive</span>}</td>
                <td>{u.id!==me.id?<button className="btn btn-xs" onClick={()=>setModal(u)}>Edit</button>:<span style={{fontSize:11,color:'var(--text3)'}}>(you)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{maxWidth:700}}>
        <div className="card-title">Department Permissions</div>
        <table>
          <thead><tr><th>Department</th><th>See All Orders</th><th>Procurement Prices</th><th>Customer Details</th><th>Can Approve</th></tr></thead>
          <tbody>
            {[
              ['management','✅','✅','✅','✅'],
              ['sales','Own only','❌','✅','❌'],
              ['sourcing','Assigned','✅','❌','❌'],
              ['procurement','Assigned','✅','❌','❌'],
              ['accounts','✅','✅','✅','❌'],
              ['logistics','Assigned','❌','❌','❌'],
              ['approvers','✅','✅','✅','✅'],
            ].map(([dept,...perms])=>(
              <tr key={dept}><td><DeptBadge dept={dept} /></td>{perms.map((p,i)=><td key={i}>{p}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal!==null&&<UserModal u={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)} />}
      {me.role==='admin'&&<DangerZone />}
    </div>
  );
}
