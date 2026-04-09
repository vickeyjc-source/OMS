// client/src/pages/EnquiriesPage.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

// ── Enquiry Detail / Edit Modal ──────────────────────────────
function EnquiryDetailModal({ enq, onClose, customers, users, onRefresh }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusVal, setStatusVal] = useState(enq.status);
  const [assignTo, setAssignTo]   = useState(enq.assigned_to || '');

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const sourcingUsers = users.filter(u => u.department === 'sourcing' || ['admin','manager'].includes(u.role));

  const mutation = useMutation({
    mutationFn: d => api.put(`/enquiries/${enq.id}`, d).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries(['enquiries']);
      qc.invalidateQueries(['summary']);
      toast.success('Saved');
      onRefresh?.();
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const sendToSourcing = () => {
    mutation.mutate({
      status: 'sourcing',
      assigned_to: assignTo || null,
      _action: 'Re-submitted to Sourcing Bin'
    }, {
      onSuccess: () => { toast.success('Sent to Sourcing Bin!'); onClose(); }
    });
  };

  const updateStatus = () => {
    mutation.mutate({
      status: statusVal,
      assigned_to: assignTo || null,
      _action: `Status updated to ${statusVal}`
    }, {
      onSuccess: () => { toast.success('Updated'); onClose(); }
    });
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2>{enq.id} — {custName(enq.customer_id)}</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
              Created {enq.created_at} · Priority: <strong>{enq.priority}</strong>
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status} />
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">
          {/* Line Items (read-only view) */}
          <div className="card card-sm">
            <div className="card-title">
              <span>📋 Components ({enq.items?.length || 0})</span>
              <button
                className="btn btn-xs btn-primary"
                onClick={() => {
                  onClose();
                  navigate('/enquiries/new', { state: { editEnquiry: enq } });
                }}
              >
                ✏️ Edit Enquiry
              </button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="li-table">
                <thead>
                  <tr>
                    <th>#</th><th>Component</th><th>IPN</th>
                    <th>Manufacturer</th><th>Qty</th>
                    <th>Target Price</th><th>Pref. Delivery</th><th>Date Code</th>
                  </tr>
                </thead>
                <tbody>
                  {enq.items?.map((li, i) => (
                    <tr key={li.id}>
                      <td>{i + 1}</td>
                      <td className="bold">{li.component}</td>
                      <td className="mono">{li.ipn || '—'}</td>
                      <td>{li.manufacturer || '—'}</td>
                      <td>{li.quantity}</td>
                      <td className="mono">
                        {li.target_price ? `${li.target_currency} ${li.target_price}` : '—'}
                      </td>
                      <td>{li.preferred_delivery_date || '—'}</td>
                      <td>{li.date_code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Status, Assignment, Actions */}
          <div className="grid-2">
            <div className="card card-sm" style={{ marginBottom:0 }}>
              <div className="card-title">📌 Status &amp; Assignment</div>
              <div className="form-group">
                <label className="label">Status</label>
                <select className="input" value={statusVal} onChange={e => setStatusVal(e.target.value)}>
                  {ENQ_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Assign To Sourcing</label>
                <select className="input" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {sourcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              {/* Action buttons */}
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={mutation.isPending}
                  onClick={sendToSourcing}
                  style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}
                >
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M1.5 3h13l-1.5 8H3L1.5 3z"/><path d="M6 3V2a1 1 0 012 0v1"/></svg>
                  {mutation.isPending ? 'Sending…' : 'Re-send to Sourcing Bin'}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={mutation.isPending}
                  onClick={updateStatus}
                  style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}
                >
                  Save Status Update
                </button>
              </div>
            </div>

            <div className="card card-sm" style={{ marginBottom:0 }}>
              <div className="card-title">🕐 History</div>
              <div className="timeline">
                {enq.history?.map((h, i) => (
                  <div key={h.id} className="tl-row">
                    <div className="tl-dot-wrap">
                      <div className={`tl-dot ${i === 0 ? 'td-active' : 'td-done'}`}>
                        <div className="tl-dot-inner"/>
                      </div>
                    </div>
                    <div className="tl-content">
                      <div className="tl-title">{h.action}</div>
                      <div className="tl-sub">by {h.by_user}</div>
                      <div className="tl-ts">{h.ts}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              navigate('/enquiries/new', { state: { editEnquiry: enq } });
            }}
          >
            ✏️ Edit &amp; Re-submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Enquiries List ───────────────────────────────────────────
export default function EnquiriesPage() {
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [selected, setSelected] = useState(null);
  const navigate = useNavigate();

  const { data: enqs=[], refetch } = useQuery({
    queryKey: ['enquiries'],
    queryFn: () => api.get('/enquiries').then(r => r.data)
  });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: users=[] }     = useQuery({ queryKey:['users'],     queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName  = id => customers.find(c => c.id === id)?.name || id;
  const userName  = id => users.find(u => u.id === id)?.name || null;

  const FILTERS = [
    { key:'all',      label:'All' },
    { key:'new',      label:'Draft' },
    { key:'sourcing', label:'In Sourcing' },
    { key:'quoted',   label:'Quoted' },
    { key:'ordered',  label:'Ordered' },
    { key:'closed',   label:'Closed' },
  ];

  const filtered = enqs.filter(e => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.id.toLowerCase().includes(q) ||
           custName(e.customer_id).toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="flex-between" style={{ marginBottom:14 }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
          </svg>
          <input
            className="search-input"
            placeholder="Search enquiries…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/enquiries/new')}>
          + New Enquiry
        </button>
      </div>

      <div className="filter-row">
        {FILTERS.map(f => (
          <span
            key={f.key}
            className={`fchip ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key !== 'all' && (
              <span style={{ marginLeft:5, fontSize:10, opacity:.7 }}>
                ({enqs.filter(e => e.status === f.key).length})
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Enquiry ID</th>
              <th>Customer</th>
              <th>Components</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>Notes</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div>No enquiries found</div>
                  </div>
                </td>
              </tr>
            )}
            {filtered.map(e => (
              <tr key={e.id} className="clickable" onClick={() => setSelected(e)}>
                <td className="mono bold">{e.id}</td>
                <td>{custName(e.customer_id)}</td>
                <td>
                  <span className="badge badge-blue">{e.items?.length || 0}</span>
                  {e.items?.length > 0 && (
                    <span style={{ fontSize:11, color:'var(--text3)', marginLeft:7 }}>
                      {e.items.slice(0,2).map(i => i.component).join(', ')}
                      {e.items.length > 2 ? ` +${e.items.length - 2}` : ''}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge ${e.priority === 'urgent' ? 'badge-red' : e.priority === 'high' ? 'badge-amber' : 'badge-gray'}`}>
                    {e.priority}
                  </span>
                </td>
                <td><StatusBadge s={e.status} /></td>
                <td>
                  {e.assigned_to
                    ? <span style={{ fontSize:12 }}>{userName(e.assigned_to) || '—'}</span>
                    : <span className="muted" style={{ fontSize:11 }}>Unassigned</span>
                  }
                </td>
                <td style={{ maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11, color:'var(--text2)' }}>
                  {e.notes || '—'}
                </td>
                <td style={{ fontSize:11 }}>{e.created_at}</td>
                <td onClick={ev => ev.stopPropagation()}>
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn btn-xs" onClick={() => setSelected(e)}>View</button>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => navigate('/enquiries/new', { state: { editEnquiry: e } })}
                      title="Edit and re-submit"
                    >Edit</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <EnquiryDetailModal
          enq={selected}
          onClose={() => setSelected(null)}
          customers={customers}
          users={users}
          onRefresh={() => {
            refetch().then(r => {
              const updated = r.data?.find(e => e.id === selected.id);
              if (updated) setSelected(updated);
            });
          }}
        />
      )}
    </div>
  );
}
