// client/src/pages/UsersPage.js  v2  (with password eye toggle)
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { initials, DEPARTMENTS, DEPT_LABEL, DEPT_COLOR, DeptBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

// ── Eye toggle button ────────────────────────────────────────
function EyeBtn({ show, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={show ? 'Hide password' : 'Show password'}
      style={{
        position:'absolute', right:10, top:'50%',
        transform:'translateY(-50%)',
        background:'none', border:'none', cursor:'pointer',
        color:'var(--text3)', fontSize:18, lineHeight:1,
        padding:'2px', display:'flex', alignItems:'center'
      }}
    >
      {show ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );
}

// ── Password field with eye toggle ───────────────────────────
function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position:'relative' }}>
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="new-password"
        style={{ paddingRight:42 }}
      />
      <EyeBtn show={show} onToggle={() => setShow(p => !p)} />
    </div>
  );
}

function UserModal({ u, onClose }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isNew = !u?.id;
  const [form, setForm] = useState(u || { name:'', username:'', email:'', password:'', department:'sales', role:'user', status:'active' });
  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/users', d) : api.put(`/users/${u.id}`, d),
    onSuccess: () => { qc.invalidateQueries(['users']); toast.success('User saved'); onClose(); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/users/${u.id}`),
    onSuccess: () => { qc.invalidateQueries(['users']); toast.success('Deleted'); onClose(); },
  });

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{isNew ? 'Add User' : 'Edit User'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="label">Full Name <span className="req">*</span></label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="label">Username <span className="req">*</span></label>
              <input className="input" value={form.username} onChange={e => set('username', e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="label">
              Password {u ? <span style={{ fontWeight:400, color:'var(--text3)' }}>(leave blank to keep current)</span> : <span className="req">*</span>}
            </label>
            <PasswordInput
              value={form.password || ''}
              onChange={e => set('password', e.target.value)}
              placeholder={u ? 'Enter new password…' : 'Set password'}
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="label">Department <span className="req">*</span></label>
              <select className="input" value={form.department} onChange={e => set('department', e.target.value)}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
                <option value="user">User</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="modal-footer">
          {!isNew && u.id !== me.id && (
            <button className="btn btn-danger btn-sm" style={{ marginRight:'auto' }}
              onClick={() => { if (window.confirm('Delete this user?')) del.mutate(); }}>
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending}
            onClick={() => mutation.mutate(form)}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [modal, setModal]       = useState(null);
  const [deptFilter, setDeptFilter] = useState('all');
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data)
  });

  if (!['admin','manager'].includes(me.role)) {
    return <div className="empty-state"><div className="empty-icon">🔒</div><div>Admin access required</div></div>;
  }

  const filtered = deptFilter === 'all' ? users : users.filter(u => u.department === deptFilter);

  return (
    <div>
      <div className="flex-between" style={{ marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:'var(--text2)' }}>{users.length} users</span>
          <div className="filter-row" style={{ marginBottom:0 }}>
            <span className={`fchip ${deptFilter==='all'?'active':''}`} onClick={() => setDeptFilter('all')}>All</span>
            {DEPARTMENTS.map(d => (
              <span key={d} className={`fchip ${deptFilter===d?'active':''}`} onClick={() => setDeptFilter(d)}>
                {DEPT_LABEL[d]}
              </span>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ Add User</button>
      </div>

      <div className="table-wrap" style={{ marginBottom:18 }}>
        <table>
          <thead>
            <tr><th>Name</th><th>Username</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <div className="flex gap-8">
                    <div className="avatar" style={{ width:26, height:26, fontSize:10 }}>{initials(u.name)}</div>
                    <span className="bold">{u.name}</span>
                  </div>
                </td>
                <td className="mono">{u.username}</td>
                <td>{u.email}</td>
                <td><DeptBadge dept={u.department} /></td>
                <td><span className={`role-${u.role}`}>{u.role}</span></td>
                <td>{u.status === 'active'
                  ? <span className="badge badge-green">Active</span>
                  : <span className="badge badge-gray">Inactive</span>}
                </td>
                <td>
                  {u.id !== me.id
                    ? <button className="btn btn-xs" onClick={() => setModal(u)}>Edit</button>
                    : <span style={{ fontSize:11, color:'var(--text3)' }}>(you)</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ maxWidth:700 }}>
        <div className="card-title">Department Permissions</div>
        <table>
          <thead>
            <tr><th>Department</th><th>See All Orders</th><th>Procurement Prices</th><th>Customer Details</th><th>Can Approve</th></tr>
          </thead>
          <tbody>
            {[
              ['management', '✅', '✅', '✅', '✅'],
              ['sales',      'Own only', '❌', '✅', '❌'],
              ['sourcing',   'Assigned', '✅', '❌', '❌'],
              ['procurement','Assigned', '✅', '❌', '❌'],
              ['accounts',   '✅', '✅', '✅', '❌'],
              ['logistics',  'Assigned', '❌', '❌', '❌'],
              ['approvers',  '✅', '✅', '✅', '✅'],
            ].map(([dept, ...perms]) => (
              <tr key={dept}>
                <td><DeptBadge dept={dept} /></td>
                {perms.map((p, i) => <td key={i}>{p}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <UserModal
          u={Object.keys(modal).length ? modal : null}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
