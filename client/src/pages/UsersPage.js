// client/src/pages/UsersPage.js  v2
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { initials, DEPARTMENTS, DEPT_LABEL, DEPT_COLOR, DeptBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { SECTION_DEFINITIONS } from '../utils/sections';

function UserModal({ u, onClose }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isNew = !u?.id;
  const [form, setForm] = useState(u
    ? { ...u, password: '' }
    : {name:'',username:'',email:'',password:'',department:'sales',role:'user',status:'active'});
  const [showPass, setShowPass] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const mutation = useMutation({
    mutationFn: d => {
      if (!isNew && !d.password) { const { password, ...rest } = d; return api.put(`/users/${u.id}`, rest); }
      return isNew ? api.post('/users', d) : api.put(`/users/${u.id}`, d);
    },
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
    <div className="overlay">
      <div className="modal modal-sm">
        <div className="modal-header"><h2>{isNew?'Add User':'Edit User'}</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-group"><label className="label">Full Name <span className="req">*</span></label><input className="input" value={form.name} onChange={e=>set('name',e.target.value)} /></div>
          <div className="form-grid-2">
            <div className="form-group"><label className="label">Username <span className="req">*</span></label><input className="input" value={form.username} onChange={e=>set('username',e.target.value)} /></div>
            <div className="form-group"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} /></div>
          </div>
          <div className="form-group">
            <label className="label">Password {isNew ? <span className="req">*</span> : <span style={{fontWeight:400,color:'var(--text3)',fontSize:12}}>(leave blank to keep current)</span>}</label>
            <div style={{position:'relative'}}>
              <input className="input" type={showPass?'text':'password'} value={form.password||''} onChange={e=>set('password',e.target.value)} style={{width:'100%',paddingRight:38}} placeholder={isNew ? '' : 'Enter new password to change'} />
              <button type="button" onClick={()=>setShowPass(v=>!v)}
                style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',
                  background:'none',border:'none',cursor:'pointer',padding:2,
                  color:'var(--text3)',display:'flex',alignItems:'center'}}>
                {showPass
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
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
  { key:'orders',    label:'All Orders',        icon:'📦', desc:'Deletes all orders, line items, supplier POs, shipping records, order history, customer payments, finance queue, PO requests and uploaded files.',   color:'var(--red)' },
  { key:'enquiries', label:'All Enquiries',      icon:'📋', desc:'Deletes all enquiries, enquiry items, sourcing data and enquiry history.',             color:'var(--red)' },
  { key:'quotes',    label:'All Quotes',         icon:'📄', desc:'Deletes all quote records from the Quote Bin.',                                        color:'var(--red)' },
  { key:'sourcing',  label:'Sourcing Data Only', icon:'🔍', desc:'Deletes only sourcing rows (supplier prices/availability) — keeps enquiries intact.',  color:'var(--amber,#d97706)' },
  { key:'approvals', label:'All Approvals',      icon:'✅', desc:'Deletes all approval workflows, requests and actions.',                                color:'var(--amber,#d97706)' },
  { key:'finance',   label:'All Finance Data',   icon:'💰', desc:'Deletes all customer payments, supplier finance queue entries and PO requests — keeps orders intact.',  color:'var(--amber,#d97706)' },
  { key:'inventory', label:'All Inventory',       icon:'🏭', desc:'Deletes all stock inventory records — warehouse and customer-held stock entries.',                         color:'var(--amber,#d97706)' },
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

  const doHeal = async () => {
    setLoading(true);
    try {
      const res = await api.post('/admin/heal');
      qc.invalidateQueries();
      const msg = res.data.fixes?.length ? res.data.fixes.join(', ') : 'Nothing to fix';
      toast.success('✅ Data healed: ' + msg);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Heal failed');
    } finally { setLoading(false); }
  };

  return (
    <>

      <div style={{marginTop:0,border:'2px solid var(--red)',borderRadius:'var(--r)',overflow:'hidden'}}>
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
                <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Deletes ALL Orders, Enquiries, Quotes, Sourcing data, Approvals and Inventory in one shot. Customers, Suppliers and Users are kept.</div>
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
                  All <strong>Orders</strong>, <strong>Enquiries</strong>, <strong>Quotes</strong>, <strong>Sourcing</strong>, <strong>Approval</strong> and <strong>Inventory</strong> records will be <strong>permanently deleted</strong>.
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

const ROLES = [
  { value: 'user', label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

function SectionPermissions() {
  const qc = useQueryClient();
  const [role, setRole] = useState('user');
  const [department, setDepartment] = useState('sales');
  const { data } = useQuery({
    queryKey: ['section-permissions', role, department],
    queryFn: () => api.get('/section-permissions', { params: { role, department } }).then(r => r.data),
  });
  const serverByKey = Object.fromEntries((data?.sections || []).map(s => [s.key, s]));
  const sections = SECTION_DEFINITIONS.map(s => ({ ...s, enabled: Boolean(serverByKey[s.key]?.enabled) }));
  const grouped = sections.reduce((acc, section) => {
    const group = section.group || 'Sections';
    acc[group] = acc[group] || [];
    acc[group].push(section);
    return acc;
  }, {});

  const save = useMutation({
    mutationFn: nextSections => api.put('/section-permissions', { role, department, sections: nextSections }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['section-permissions', role, department] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Section permissions synced');
    },
    onError: e => toast.error(e.response?.data?.error || 'Permission sync failed'),
  });

  const toggle = (key) => {
    const next = sections.map(s => s.key === key ? { ...s, enabled: !s.enabled } : s);
    save.mutate(next.map(({ key, enabled }) => ({ key, enabled })));
  };

  return (
    <div className="card" style={{marginTop:18}}>
      <div className="flex-between" style={{gap:16,alignItems:'flex-start',marginBottom:16}}>
        <div>
          <div className="card-title" style={{marginBottom:4}}>Section Permissions</div>
          <div style={{fontSize:13,color:'var(--text2)'}}>Choose role and department, then enable the sections that this team should access.</div>
        </div>
        <div className="form-grid-2" style={{maxWidth:520,margin:0}}>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="label">Choose Role</label>
            <select className="input" value={role} onChange={e=>setRole(e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="label">Department</label>
            <select className="input" value={department} onChange={e=>setDepartment(e.target.value)}>
              {DEPARTMENTS.map(d=><option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="section-permission-list">
        {Object.entries(grouped).map(([group, rows]) => (
          <div key={group} className="section-permission-group">
            <div className="section-permission-group-title">{group}</div>
            {rows.map(section => (
              <div key={section.key} className="section-permission-row">
                <div>
                  <div className="section-permission-name">{section.label}</div>
                  <div className="section-permission-path">{section.path}</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${section.enabled ? 'on' : ''}`}
                  aria-pressed={section.enabled}
                  onClick={() => toggle(section.key)}
                  disabled={save.isPending}
                  title={section.enabled ? 'Enabled' : 'Disabled'}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PasswordCell({ plain }) {
  const [show, setShow] = React.useState(false);
  if (!plain) return <span style={{color:'var(--text3)',fontSize:11}}>—</span>;
  return (
    <div style={{display:'flex',alignItems:'center',gap:5}}>
      <span style={{fontFamily:'monospace',fontSize:12,color:'var(--text2)',letterSpacing:show?0:2}}>
        {show ? plain : '••••••••'}
      </span>
      <button type="button" onClick={()=>setShow(v=>!v)}
        style={{background:'none',border:'none',cursor:'pointer',padding:2,
          color:'var(--text3)',display:'flex',alignItems:'center'}}>
        {show
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        }
      </button>
    </div>
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
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Department</th><th>Role</th><th>Password</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map(u=>(
              <tr key={u.id}>
                <td><div className="flex gap-8"><div className="avatar" style={{width:26,height:26,fontSize:10}}>{initials(u.name)}</div><span className="bold">{u.name}</span></div></td>
                <td className="mono">{u.username}</td>
                <td>{u.email}</td>
                <td><DeptBadge dept={u.department} /></td>
                <td><span className={`role-${u.role}`}>{u.role}</span></td>
                <td><PasswordCell plain={u.plain_password} /></td>
                <td>{u.status==='active'?<span className="badge badge-green">Active</span>:<span className="badge badge-gray">Inactive</span>}</td>
                <td><div style={{display:'flex',alignItems:'center',gap:6}}><button className="btn btn-xs" onClick={()=>setModal(u)}>Edit</button>{u.id===me.id&&<span style={{fontSize:11,color:'var(--text3)'}}>(you)</span>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionPermissions />
      {modal!==null&&<UserModal u={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)} />}
      {me.role==='admin'&&<DangerZone />}
    </div>
  );
}
