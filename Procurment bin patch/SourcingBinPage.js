// client/src/pages/SourcingBinPage.js
// Shows all enquiries currently in "sourcing" status — the Sourcing team's work queue
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

export default function SourcingBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [search, setSearch]     = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const { data: enquiries = [], isLoading } = useQuery({
    queryKey: ['enquiries'],
    queryFn: () => api.get('/enquiries').then(r => r.data),
    refetchInterval: 20000
  });
  const { data: customers  = [] } = useQuery({ queryKey:['customers'],  queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: suppliers  = [] } = useQuery({ queryKey:['suppliers'],  queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: linecards  = [] } = useQuery({ queryKey:['linecards'],  queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const { data: users      = [] } = useQuery({ queryKey:['users'],      queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const supName  = id => suppliers.find(s=>s.id===id)?.name || id;
  const lcName   = id => linecards.find(l=>l.id===id)?.name || '—';
  const userName = id => users.find(u=>u.id===id)?.name || 'Unassigned';

  // Sourcing bin = new + sourcing status enquiries
  const binEnqs = enquiries.filter(e => ['new','sourcing'].includes(e.status));

  const filtered = binEnqs.filter(e => {
    const matchSearch = !search ||
      e.id.toLowerCase().includes(search.toLowerCase()) ||
      custName(e.customer_id).toLowerCase().includes(search.toLowerCase());
    const matchPriority = priorityFilter === 'all' || e.priority === priorityFilter;
    return matchSearch && matchPriority;
  });

  // Stats
  const total    = binEnqs.length;
  const urgent   = binEnqs.filter(e=>e.priority==='urgent').length;
  const high     = binEnqs.filter(e=>e.priority==='high').length;
  const unassigned = binEnqs.filter(e=>!e.assigned_to).length;

  return (
    <div>
      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:13, marginBottom:18 }}>
        {[
          { label:'In Sourcing Bin', val:total,      color:'var(--accent)',  sub:'enquiries to process' },
          { label:'Urgent',          val:urgent,     color:'var(--red)',     sub:'need immediate action' },
          { label:'High Priority',   val:high,       color:'var(--amber)',   sub:'process next' },
          { label:'Unassigned',      val:unassigned, color:'var(--purple)',  sub:'not yet assigned' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft:`3px solid ${s.color}` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ fontSize:26, color:s.color }}>{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex-between" style={{ marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
            </svg>
            <input className="search-input" placeholder="Search enquiries…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="filter-row" style={{ marginBottom:0 }}>
            {['all','urgent','high','normal'].map(p => (
              <span key={p} className={`fchip ${priorityFilter===p?'active':''}`} onClick={()=>setPriorityFilter(p)}>
                {p === 'all' ? 'All Priority' : p.charAt(0).toUpperCase()+p.slice(1)}
              </span>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={()=>window.location.href='/enquiries/new'}>
          + New Enquiry
        </button>
      </div>

      {/* Kanban-style cards for sourcing */}
      {isLoading && <div className="loading-center">Loading sourcing bin…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-state-text">
            {binEnqs.length === 0 ? 'Sourcing bin is empty — all enquiries are processed!' : 'No enquiries match your filter'}
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:14 }}>
        {filtered.map(enq => {
          const isUrgent  = enq.priority === 'urgent';
          const isHigh    = enq.priority === 'high';
          const srcDone   = (enq.sourcing||[]).filter(s=>s.sourced_price).length;
          const srcTotal  = (enq.items||[]).length;
          const srcPct    = srcTotal ? Math.round(srcDone/srcTotal*100) : 0;

          return (
            <div
              key={enq.id}
              className="card"
              style={{
                marginBottom:0, cursor:'pointer',
                borderLeft: isUrgent ? '3px solid var(--red)' : isHigh ? '3px solid var(--amber)' : '1px solid var(--border)',
                transition:'box-shadow .15s'
              }}
              onClick={() => setSelected(enq)}
              onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
            >
              {/* Header */}
              <div className="flex-between" style={{ marginBottom:10 }}>
                <div>
                  <span className="mono bold" style={{ fontSize:13 }}>{enq.id}</span>
                  {isUrgent && <span className="badge badge-red" style={{ marginLeft:8 }}>🔴 Urgent</span>}
                  {isHigh   && <span className="badge badge-amber" style={{ marginLeft:8 }}>🟡 High</span>}
                </div>
                <StatusBadge s={enq.status}/>
              </div>

              {/* Customer */}
              <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>
                {custName(enq.customer_id)}
              </div>

              {/* Items summary */}
              <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10 }}>
                {srcTotal} component{srcTotal!==1?'s':''} ·{' '}
                {enq.items?.slice(0,2).map(i=>i.component).join(', ')}
                {(enq.items?.length||0) > 2 && ` +${enq.items.length-2} more`}
              </div>

              {/* Sourcing progress */}
              <div style={{ marginBottom:10 }}>
                <div className="flex-between" style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>
                  <span>Sourcing progress</span>
                  <span style={{ fontWeight:600, color: srcPct===100?'var(--green)':'var(--text2)' }}>{srcDone}/{srcTotal} priced</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{
                    width:`${srcPct}%`,
                    background: srcPct===100 ? 'var(--green)' : srcPct>50 ? 'var(--accent)' : 'var(--amber)'
                  }}/>
                </div>
              </div>

              {/* Footer */}
              <div className="flex-between" style={{ fontSize:11, color:'var(--text3)' }}>
                <span>📅 {enq.created_at}</span>
                <span>👤 {userName(enq.assigned_to)}</span>
              </div>

              {/* Action button */}
              <div style={{ marginTop:12, borderTop:'1px solid var(--border)', paddingTop:10 }}>
                <button
                  className="btn btn-primary btn-sm w-full"
                  style={{ width:'100%', justifyContent:'center' }}
                  onClick={e => { e.stopPropagation(); setSelected(enq); }}
                >
                  {srcPct === 0 ? '🔍 Start Sourcing' : srcPct === 100 ? '✅ Review & Complete' : '📝 Continue Sourcing'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sourcing detail modal */}
      {selected && (
        <SourcingModal
          enq={selected}
          suppliers={suppliers}
          linecards={linecards}
          customers={customers}
          users={users}
          onClose={() => setSelected(null)}
          onSaved={() => { qc.invalidateQueries(['enquiries']); setSelected(null); }}
        />
      )}
    </div>
  );
}

function SourcingModal({ enq, suppliers, linecards, customers, users, onClose, onSaved }) {
  const { user } = useAuth();
  const [srcRows, setSrcRows] = useState(() =>
    (enq.items||[]).map(item => {
      const existing = (enq.sourcing||[]).find(s => s.enquiry_item_id === item.id);
      return existing
        ? { ...existing }
        : { id:null, enquiry_item_id:item.id, supplier_id:'', sourced_price:'', sourced_currency:'USD', availability:'', lead_time:'', notes:'' };
    })
  );
  const [statusVal, setStatusVal] = useState(enq.status);
  const [assignTo, setAssignTo]   = useState(enq.assigned_to || '');
  const [saving, setSaving]       = useState(false);

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const lcName   = id => linecards.find(l=>l.id===id)?.name || '—';
  const upd = (idx, k, v) => setSrcRows(prev => prev.map((row,i) => i===idx ? {...row,[k]:v} : row));

  const handleSave = async () => {
    setSaving(true);
    try {
      const rowsToSave = srcRows.map(r => ({
        ...r,
        id: r.id || ('src_' + r.enquiry_item_id + '_' + Date.now())
      }));
      await api.put(`/enquiries/${enq.id}`, {
        sourcing: rowsToSave,
        status: statusVal,
        assigned_to: assignTo || null,
        _action: 'Sourcing updated from Sourcing Bin'
      });
      toast.success('Sourcing saved');
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const sourcingUsers = users.filter(u => u.department==='sourcing' || ['admin','manager'].includes(u.role));

  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>🔍 Sourcing — {enq.id}</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
              {custName(enq.customer_id)} · {enq.items?.length || 0} component{enq.items?.length!==1?'s':''} · Created {enq.created_at}
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status}/>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">
          {/* Assignment + Status row */}
          <div className="grid-2" style={{ marginBottom:16 }}>
            <div className="form-group">
              <label className="label">Assigned To</label>
              <select className="input" value={assignTo} onChange={e=>setAssignTo(e.target.value)}>
                <option value="">— Unassigned —</option>
                {sourcingUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Enquiry Status</label>
              <select className="input" value={statusVal} onChange={e=>setStatusVal(e.target.value)}>
                {ENQ_STATUSES.map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
          </div>

          {/* Per-item sourcing */}
          {(enq.items||[]).map((item, idx) => {
            const row = srcRows[idx] || {};
            const hasPrice = row.sourced_price && row.supplier_id;
            return (
              <div
                key={item.id}
                className="sup-block"
                style={{
                  marginBottom:12,
                  borderLeft: hasPrice ? '3px solid var(--green)' : '3px solid var(--border-md)'
                }}
              >
                {/* Item header */}
                <div className="flex-between" style={{ marginBottom:10 }}>
                  <div>
                    <span className="bold" style={{ fontSize:13 }}>{item.component}</span>
                    {item.manufacturer && <span style={{ fontSize:12, color:'var(--text2)', marginLeft:8 }}>{item.manufacturer}</span>}
                    {item.ipn && <span className="mono" style={{ fontSize:11, color:'var(--text3)', marginLeft:8 }}>IPN: {item.ipn}</span>}
                  </div>
                  <div className="flex gap-8">
                    <span className="badge badge-blue">{item.quantity} pcs</span>
                    {item.linecard_id && <span className="badge badge-purple">{lcName(item.linecard_id)}</span>}
                    {item.target_price && <span className="badge badge-gray">Target: {item.target_currency} {item.target_price}</span>}
                    {item.date_code && <span className="badge badge-gray">DC: {item.date_code}</span>}
                    {hasPrice && <span className="badge badge-green">✓ Sourced</span>}
                  </div>
                </div>

                {/* Sourcing fields */}
                <div className="form-grid-3" style={{ marginBottom:8 }}>
                  <div className="form-group">
                    <label className="label">Supplier <span className="req">*</span></label>
                    <select className="input" value={row.supplier_id||''} onChange={e=>upd(idx,'supplier_id',e.target.value)}>
                      <option value="">— Select Supplier —</option>
                      {suppliers.map(s=>(
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.type==='domestic'?'🇮🇳 India':'🌐 '+s.country})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Sourced Price <span className="req">*</span></label>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      value={row.sourced_price||''}
                      onChange={e=>upd(idx,'sourced_price',e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Currency</label>
                    <select className="input" value={row.sourced_currency||'USD'} onChange={e=>upd(idx,'sourced_currency',e.target.value)}>
                      {['USD','INR','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="label">Availability</label>
                    <input className="input" value={row.availability||''} onChange={e=>upd(idx,'availability',e.target.value)} placeholder="In stock / 4–6 weeks"/>
                  </div>
                  <div className="form-group">
                    <label className="label">Lead Time</label>
                    <input className="input" value={row.lead_time||''} onChange={e=>upd(idx,'lead_time',e.target.value)} placeholder="e.g. 4 weeks"/>
                  </div>
                  <div className="form-group">
                    <label className="label">Notes</label>
                    <input className="input" value={row.notes||''} onChange={e=>upd(idx,'notes',e.target.value)} placeholder="MOQ, special terms…"/>
                  </div>
                </div>

                {/* Price comparison vs target */}
                {row.sourced_price && item.target_price && (
                  <div style={{
                    marginTop:8, padding:'6px 10px', borderRadius:'var(--r-sm)', fontSize:12,
                    background: Number(row.sourced_price) <= Number(item.target_price) ? 'var(--green-lt)' : 'var(--amber-lt)',
                    color: Number(row.sourced_price) <= Number(item.target_price) ? 'var(--green)' : 'var(--amber)',
                  }}>
                    {Number(row.sourced_price) <= Number(item.target_price)
                      ? `✅ Within target (${item.target_currency} ${item.target_price})`
                      : `⚠️ Above target by ${item.target_currency} ${(Number(row.sourced_price)-Number(item.target_price)).toFixed(2)}`
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : '💾 Save Sourcing'}
          </button>
        </div>
      </div>
    </div>
  );
}
