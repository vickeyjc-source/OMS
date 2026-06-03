// client/src/components/ActivityLog.js
// Shared audit-log table used by both Recycle Bin and Danger Zone.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

const fmt = d => {
  if (!d) return '—';
  // performed_at is "YYYY-MM-DD HH:MM:SS" (UTC). Show date + time incl. seconds.
  const dt = new Date(String(d).replace(' ', 'T') + 'Z');
  if (isNaN(dt)) return d;
  return dt.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
};

const ACTION_STYLE = {
  delete:        { label:'Deleted',       color:'var(--red)',   bg:'var(--red-lt)' },
  master_delete: { label:'Master Delete', color:'#fff',          bg:'var(--red)' },
  restore:       { label:'Restored',      color:'var(--green)', bg:'var(--green-lt)' },
  purge:         { label:'Purged',        color:'var(--red)',   bg:'var(--red-lt)' },
};

export default function ActivityLog({ area }) {  // area: 'recycle' | 'danger' | undefined (all)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['activity-log', area || 'all'],
    queryFn: () => api.get('/admin/activity-log' + (area ? ('?area=' + area) : '')).then(r => r.data),
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="text-muted">Loading…</div>;
  if (!rows.length) return (
    <div style={{textAlign:'center',padding:'40px 0',color:'var(--text3)'}}>
      <div style={{fontSize:32,marginBottom:8}}>📋</div>
      <div>No activity logged yet</div>
    </div>
  );

  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>
          <th>When (date · time)</th>
          <th>Action</th>
          <th>Section / Item</th>
          <th>Deleted item details</th>
          <th>Rows</th>
          <th>By</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const a = ACTION_STYLE[r.action] || { label:r.action, color:'var(--text2)', bg:'var(--surface2)' };
            const isRecord = ['user','customer','supplier'].includes(r.entity_type);
            return (
              <tr key={r.id}>
                <td className="mono" style={{whiteSpace:'nowrap',fontSize:12}}>{fmt(r.performed_at)}</td>
                <td><span style={{background:a.bg,color:a.color,padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700}}>{a.label}</span></td>
                <td style={{fontSize:12}}>{r.label || r.module || '—'}{r.entity_type && <span style={{color:'var(--text3)'}}> · {r.entity_type}</span>}</td>
                <td style={{fontSize:12}}>
                  {isRecord ? (
                    <div>
                      <div className="bold">{r.entity_name || '—'}</div>
                      <div style={{color:'var(--text3)',fontSize:11}}>
                        {r.entity_username ? '@'+r.entity_username+' · ' : ''}{r.entity_email || (r.entity_id ? r.entity_id : '')}
                      </div>
                    </div>
                  ) : <span style={{color:'var(--text3)'}}>—</span>}
                </td>
                <td className="mono" style={{fontSize:12}}>{Number(r.row_count)||0}</td>
                <td style={{fontSize:12}}>
                  <div className="bold">{r.performed_by_name || r.performed_by || '—'}</div>
                  {r.performed_by_name && r.performed_by && <div style={{color:'var(--text3)',fontSize:11}}>@{r.performed_by}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
