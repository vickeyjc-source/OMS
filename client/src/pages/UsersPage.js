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
    onSuccess: ()=>{ qc.invalidateQueries(['users']); qc.invalidateQueries(['deleted-users']); toast.success('Moved to Recycle Bin'); onClose(); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
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
              <div key={section.key} className="section-permission-row" style={section.locked?{opacity:0.6}:undefined}>
                <div>
                  <div className="section-permission-name">
                    {section.label}
                    {section.locked && <span style={{marginLeft:8,fontSize:10,fontWeight:700,color:'var(--red)',background:'var(--red-lt)',padding:'1px 6px',borderRadius:999}}>🔒 ADMIN ONLY</span>}
                  </div>
                  <div className="section-permission-path">{section.locked ? 'Hard-coded — cannot be changed' : section.path}</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${section.enabled ? 'on' : ''}`}
                  aria-pressed={section.enabled}
                  onClick={() => !section.locked && toggle(section.key)}
                  disabled={save.isPending || section.locked}
                  title={section.locked ? 'Admin only — cannot be changed' : (section.enabled ? 'Enabled' : 'Disabled')}
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
    </div>
  );
}
