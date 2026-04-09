// client/src/pages/DeletedBinPage.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const fmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';

export default function DeletedBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = ['admin','manager'].includes(user.role);
  const [tab, setTab] = useState('enquiries');
  const [restoring, setRestoring] = useState(null);

  const { data: enquiries=[], isLoading: eLoad } = useQuery({
    queryKey:['deleted-enquiries'],
    queryFn:()=>api.get('/enquiries').then(r=>r.data.filter(e=>e.status==='deleted')),
    refetchInterval:30000,
  });
  const { data: orders=[], isLoading: oLoad } = useQuery({
    queryKey:['deleted-orders'],
    queryFn:()=>api.get('/orders').then(r=>r.data.filter(o=>o.status==='deleted')),
    refetchInterval:30000,
  });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;

  const restoreEnq = useMutation({
    mutationFn: id => api.put('/enquiries/'+id, { status:'new', _action:'Restored from Deleted Bin' }),
    onSuccess: () => { qc.invalidateQueries(['deleted-enquiries']); qc.invalidateQueries(['enquiries']); toast.success('Enquiry restored'); setRestoring(null); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });
  const restoreOrder = useMutation({
    mutationFn: id => api.put('/orders/'+id, { status:'open', _action:'Restored from Deleted Bin' }),
    onSuccess: () => { qc.invalidateQueries(['deleted-orders']); qc.invalidateQueries(['orders']); toast.success('Order restored'); setRestoring(null); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const tabStyle = active => ({
    padding:'7px 18px', fontSize:13, fontWeight:active?600:400,
    color: active ? 'var(--accent)' : 'var(--text2)',
    cursor:'pointer', background:'none', border:'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  });

  return (
    <div style={{maxWidth:1100}}>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:4}}>
          <span style={{fontSize:20}}>🗑️</span>
          <div>
            <div className="card-title" style={{marginBottom:0}}>Deleted Bin</div>
            <div style={{fontSize:12,color:'var(--text3)'}}>Soft-deleted enquiries and orders. Restore or permanently remove.</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:16,marginTop:12}}>
          <button style={tabStyle(tab==='enquiries')} onClick={()=>setTab('enquiries')}>
            Enquiries {enquiries.length>0 && <span className="nav-badge" style={{marginLeft:6}}>{enquiries.length}</span>}
          </button>
          <button style={tabStyle(tab==='orders')} onClick={()=>setTab('orders')}>
            Orders {orders.length>0 && <span className="nav-badge" style={{marginLeft:6}}>{orders.length}</span>}
          </button>
        </div>

        {/* ── Enquiries Tab ── */}
        {tab==='enquiries' && (
          eLoad ? <div className="text-muted">Loading…</div> :
          enquiries.length===0 ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>
              <div>No deleted enquiries</div>
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>Enquiry ID</th><th>Customer</th><th>Created</th><th>Notes</th>
                {isAdmin && <th style={{textAlign:'right'}}>Actions</th>}
              </tr></thead>
              <tbody>
                {enquiries.map(e=>(
                  <tr key={e.id}>
                    <td><span className="mono">{e.id}</span></td>
                    <td>{custName(e.customer_id)}</td>
                    <td>{fmt(e.created_at)}</td>
                    <td style={{color:'var(--text3)',fontSize:12}}>{e.notes||'—'}</td>
                    {isAdmin && (
                      <td style={{textAlign:'right'}}>
                        <button className="btn btn-xs" style={{marginRight:6}}
                          disabled={restoring===e.id}
                          onClick={()=>{setRestoring(e.id);restoreEnq.mutate(e.id);}}>
                          ↩ Restore
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ── Orders Tab ── */}
        {tab==='orders' && (
          oLoad ? <div className="text-muted">Loading…</div> :
          orders.length===0 ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>
              <div>No deleted orders</div>
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>Order ID</th><th>Customer</th><th>PO Number</th><th>Created</th>
                {isAdmin && <th style={{textAlign:'right'}}>Actions</th>}
              </tr></thead>
              <tbody>
                {orders.map(o=>(
                  <tr key={o.id}>
                    <td><span className="mono">{o.id}</span></td>
                    <td>{custName(o.customer_id)}</td>
                    <td>{o.po_number||'—'}</td>
                    <td>{fmt(o.created_at)}</td>
                    {isAdmin && (
                      <td style={{textAlign:'right'}}>
                        <button className="btn btn-xs" style={{marginRight:6}}
                          disabled={restoring===o.id}
                          onClick={()=>{setRestoring(o.id);restoreOrder.mutate(o.id);}}>
                          ↩ Restore
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
