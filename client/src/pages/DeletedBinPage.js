// client/src/pages/DeletedBinPage.js  — Recycle Bin (5 tabs)
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import ActivityLog from '../components/ActivityLog';

const fmt = d => d ? new Date(String(d).replace(' ','T')+'Z').toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

// Section cards (Global tab) — mirror the Danger Zone, restore wording.
const MODULES = [
  { key:'orders',    label:'All Orders',        icon:'📦', desc:'Restores all orders, line items, supplier POs, shipping records, order history, customer payments, finance queue, PO requests and uploaded files.', color:'var(--red)' },
  { key:'enquiries', label:'All Enquiries',     icon:'📋', desc:'Restores all enquiries, enquiry items, sourcing data and enquiry history.',                color:'var(--red)' },
  { key:'quotes',    label:'All Quotes',        icon:'📄', desc:'Restores all quote records back to the Quote Bin.',                                         color:'var(--red)' },
  { key:'sourcing',  label:'Sourcing Data Only',icon:'🔍', desc:'Restores only sourcing rows (supplier prices/availability).',                              color:'var(--amber,#d97706)' },
  { key:'approvals', label:'All Approvals',     icon:'✅', desc:'Restores all approval workflows, requests and actions.',                                   color:'var(--amber,#d97706)' },
  { key:'finance',   label:'All Finance Data',  icon:'💰', desc:'Restores all customer payments, supplier finance queue entries and PO requests.',           color:'var(--amber,#d97706)' },
  { key:'inventory', label:'All Inventory',     icon:'🏭', desc:'Restores all stock inventory records — warehouse and customer-held stock entries.',         color:'var(--amber,#d97706)' },
];

const tabStyle = active => ({
  padding:'8px 18px', fontSize:13, fontWeight:active?700:500,
  color: active ? 'var(--accent)' : 'var(--text2)',
  cursor:'pointer', background:'none', border:'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
});

export default function DeletedBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState('global');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: batches=[], isLoading: bLoad } = useQuery({
    queryKey:['deleted-bin'], queryFn:()=>api.get('/admin/deleted-bin').then(r=>r.data),
    refetchInterval:30000, enabled:isAdmin,
  });
  const { data: deletedUsers=[] } = useQuery({
    queryKey:['deleted-users'], queryFn:()=>api.get('/users?include_deleted=1').then(r=>r.data.filter(u=>u.status==='deleted')),
    refetchInterval:30000, enabled:isAdmin,
  });
  const { data: deletedCustomers=[] } = useQuery({
    queryKey:['deleted-customers'], queryFn:()=>api.get('/customers?include_deleted=1').then(r=>r.data.filter(c=>c.status==='deleted')),
    refetchInterval:30000, enabled:isAdmin,
  });
  const { data: deletedSuppliers=[] } = useQuery({
    queryKey:['deleted-suppliers'], queryFn:()=>api.get('/suppliers?include_deleted=1').then(r=>r.data.filter(s=>s.status==='deleted')),
    refetchInterval:30000, enabled:isAdmin,
  });

  const refresh = () => {
    ['deleted-bin','deleted-users','deleted-customers','deleted-suppliers','activity-log'].forEach(k=>qc.invalidateQueries([k]));
    ['orders','enquiries','quotes','approvals','inventory','users','customers','suppliers'].forEach(k=>qc.invalidateQueries([k]));
  };

  const restore = useMutation({
    mutationFn: id => api.post('/admin/deleted-bin/'+id+'/restore'),
    onSuccess: r => { refresh(); toast.success((r.data.label||'Data')+' restored — '+r.data.restored+' rows'); setConfirm(null); setBusy(false); },
    onError: e => { toast.error(e.response?.data?.error||'Restore failed'); setBusy(false); },
  });
  const purge = useMutation({
    mutationFn: id => api.delete('/admin/deleted-bin/'+id),
    onSuccess: () => { refresh(); toast.success('Permanently removed'); setConfirm(null); setBusy(false); },
    onError: e => { toast.error(e.response?.data?.error||'Failed'); setBusy(false); },
  });
  const restoreRecord = useMutation({
    mutationFn: ({type,id}) => api.post('/'+type+'/'+id+'/restore'),
    onSuccess: () => { refresh(); toast.success('Restored'); setConfirm(null); setBusy(false); },
    onError: e => { toast.error(e.response?.data?.error||'Failed'); setBusy(false); },
  });

  if (!isAdmin) return <div className="empty-state"><div className="empty-icon">🔒</div><div>Admin access required</div></div>;

  const batchesByModule = {};
  for (const b of batches) (batchesByModule[b.module]=batchesByModule[b.module]||[]).push(b);

  const sectionCard = (mod) => {
    const mBatches = batchesByModule[mod.key] || [];
    const totalRows = mBatches.reduce((s,b)=>s+Number(b.row_count||0),0);
    const has = mBatches.length>0;
    return (
      <div key={mod.key} style={{border:'1px solid var(--border)',borderRadius:'var(--r-sm)',padding:'14px 16px',background:'#fff',opacity:has?1:0.55}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
          <span style={{fontSize:20}}>{mod.icon}</span>
          <span style={{fontWeight:700,fontSize:13,color:mod.color}}>{mod.label}</span>
          {has && <span className="nav-badge" style={{marginLeft:'auto'}}>{totalRows} rows</span>}
        </div>
        <div style={{fontSize:12,color:'var(--text2)',marginBottom:12,lineHeight:1.5}}>{mod.desc}</div>
        {!has ? <div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'4px 0'}}>Nothing deleted</div>
        : mBatches.map(b=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <div style={{flex:1,fontSize:11,color:'var(--text3)'}}>{Number(b.row_count)} rows · {fmt(b.deleted_at)}{b.deleted_by?(' · by '+b.deleted_by):''}</div>
            <button className="btn btn-xs btn-primary" disabled={busy} onClick={()=>setConfirm({mode:'restore',batch:b,mod})}>↩ Restore</button>
            <button className="btn btn-xs" disabled={busy} title="Permanently remove" onClick={()=>setConfirm({mode:'purge',batch:b,mod})}>🗑</button>
          </div>
        ))}
      </div>
    );
  };

  const recordRows = (rows, type, primary, secondary) => (
    rows.length===0 ? (
      <div style={{textAlign:'center',padding:'40px 0',color:'var(--text3)'}}>
        <div style={{fontSize:32,marginBottom:8}}>✅</div><div>Nothing deleted</div>
      </div>
    ) : (
      <table className="table">
        <thead><tr><th>Name</th><th>Details</th><th style={{textAlign:'right'}}>Action</th></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td className="bold">{primary(r)}</td>
              <td className="mono" style={{color:'var(--text3)',fontSize:12}}>{secondary(r)}</td>
              <td style={{textAlign:'right'}}>
                <button className="btn btn-xs btn-primary" disabled={busy}
                  onClick={()=>setConfirm({mode:'restoreRecord',type,record:r})}>↩ Restore</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  );

  const TABS = [
    ['global','Global'],
    ['users','Users', deletedUsers.length],
    ['customers','Customers', deletedCustomers.length],
    ['suppliers','Suppliers', deletedSuppliers.length],
    ['logs','Logs'],
  ];

  return (
    <div>
      <div style={{border:'2px solid var(--accent)',borderRadius:'var(--r)',overflow:'hidden'}}>
        <div style={{background:'var(--accent)',padding:'12px 20px',display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:20}}>♻️</span>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:'#fff'}}>Recycle Bin</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.85)',marginTop:2}}>Restore deleted sections and records exactly as they were, or remove them permanently. Admin only.</div>
          </div>
        </div>

        <div style={{padding:'0 20px',borderBottom:'1px solid var(--border)',display:'flex',background:'#fff'}}>
          {TABS.map(([k,label,count])=>(
            <button key={k} style={tabStyle(tab===k)} onClick={()=>setTab(k)}>
              {label}{count>0 && <span className="nav-badge" style={{marginLeft:6}}>{count}</span>}
            </button>
          ))}
        </div>

        <div style={{padding:'20px',background:'var(--surface,#fafafa)'}}>
          {tab==='global' && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:20}}>
                {MODULES.map(sectionCard)}
              </div>
              {/* Master Delete restore — always visible; button disabled when nothing was master-deleted. */}
              {(() => {
                const masterBatches = batchesByModule['master'] || [];
                const has = masterBatches.length > 0;
                return (
                  <div style={{border:'2px dashed var(--red)',borderRadius:'var(--r-sm)',padding:'18px 20px',background:'#fff0f0',opacity:has?1:0.7}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                      <span style={{fontSize:24}}>💣</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15,color:'var(--red)'}}>Master Delete — Restore Everything</div>
                        <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Restores ALL Orders, Enquiries, Quotes, Sourcing data, Approvals, Finance and Inventory wiped by a Master Delete — in one shot.</div>
                      </div>
                    </div>
                    {!has ? (
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,fontSize:12,color:'var(--text3)'}}>Nothing deleted</div>
                        <button className="btn btn-sm btn-primary" disabled>↩ Restore Everything</button>
                      </div>
                    ) : masterBatches.map(b=>(
                      <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                        <div style={{flex:1,fontSize:12,color:'var(--text2)'}}>{Number(b.row_count)} rows · {fmt(b.deleted_at)}{b.deleted_by?(' · by '+b.deleted_by):''}</div>
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={()=>setConfirm({mode:'restore',batch:b,mod:{label:'Master Delete'}})}>↩ Restore Everything</button>
                        <button className="btn btn-sm" disabled={busy} title="Permanently remove" onClick={()=>setConfirm({mode:'purge',batch:b,mod:{label:'Master Delete'}})}>🗑</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {bLoad && <div className="text-muted" style={{marginTop:12}}>Loading…</div>}
            </>
          )}

          {tab==='users'     && recordRows(deletedUsers,     'users',     u=>u.name, u=>'@'+u.username+(u.email?(' · '+u.email):''))}
          {tab==='customers' && recordRows(deletedCustomers, 'customers', c=>c.name, c=>c.id+(c.email?(' · '+c.email):''))}
          {tab==='suppliers' && recordRows(deletedSuppliers, 'suppliers', s=>s.name, s=>s.id+(s.email?(' · '+s.email):''))}
          {tab==='logs'      && <ActivityLog area="recycle" />}
        </div>
      </div>

      {confirm && (
        <div className="overlay">
          <div className="modal modal-sm">
            <div className="modal-header" style={{background: confirm.mode==='purge'?'var(--red-lt)':'var(--accent-lt,#eef)'}}>
              <h2 style={{color: confirm.mode==='purge'?'var(--red)':'var(--accent)'}}>{confirm.mode==='purge'?'⚠️ Permanently Remove':'↩ Confirm Restore'}</h2>
              <button className="close-x" onClick={()=>!busy&&setConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{textAlign:'center',padding:'8px 0'}}>
                <div style={{fontSize:40,marginBottom:12}}>{confirm.mode==='purge'?'🗑️':'↩'}</div>
                {confirm.record ? (
                  <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Restore “{confirm.record.name}”?</div>
                ) : (
                  <>
                    <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>{confirm.mode==='purge'?'Permanently remove ':'Restore '}{confirm.mod.label}?</div>
                    <div style={{fontSize:13,color:'var(--text2)',marginBottom:12}}>{Number(confirm.batch.row_count)} rows · deleted {fmt(confirm.batch.deleted_at)}</div>
                  </>
                )}
                {confirm.mode==='purge' && (
                  <div style={{background:'var(--red-lt)',border:'1px solid var(--red)',borderRadius:'var(--r-sm)',padding:'10px 14px',fontSize:12,color:'var(--red)',fontWeight:600}}>
                    ⚠️ This cannot be undone. The data will be gone for good.
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button>
              <button className={'btn '+(confirm.mode==='purge'?'btn-danger':'btn-primary')} disabled={busy}
                onClick={()=>{
                  setBusy(true);
                  if (confirm.mode==='restore') restore.mutate(confirm.batch.id);
                  else if (confirm.mode==='purge') purge.mutate(confirm.batch.id);
                  else restoreRecord.mutate({ type:confirm.type, id:confirm.record.id });
                }}>
                {busy ? 'Working…' : (confirm.mode==='purge' ? 'Yes, Remove' : 'Yes, Restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
