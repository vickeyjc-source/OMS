// client/src/pages/ClosedBinPage.js
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const fmt    = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtNum = n => new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n||0);

export default function ClosedBinPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  const { data: orders=[], isLoading } = useQuery({
    queryKey:['closed-orders'],
    queryFn:()=>api.get('/orders').then(r=>r.data.filter(o=>o.status==='closed')),
    refetchInterval:60000,
  });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    return !q || o.id.toLowerCase().includes(q) || (o.po_number||'').toLowerCase().includes(q) || custName(o.customer_id).toLowerCase().includes(q);
  });

  // Summary stats
  const totalValue = orders.reduce((sum, o) => {
    const inrItems = (o.lineItems||[]).filter(li=>li.currency==='INR');
    return sum + inrItems.reduce((s,li)=>s+(li.qty*li.unit_price),0);
  }, 0);

  return (
    <div style={{maxWidth:1100}}>
      {/* Stats strip */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
        {[
          { label:'Total Closed Orders', value: orders.length, icon:'✅' },
          { label:'Total INR Value',      value: '₹'+fmtNum(totalValue), icon:'💰' },
          { label:'This Month',           value: orders.filter(o=>o.closed_at && o.closed_at.slice(0,7)===new Date().toISOString().slice(0,7)).length, icon:'📅' },
        ].map(s=>(
          <div key={s.label} className="card" style={{padding:'14px 18px',marginBottom:0}}>
            <div style={{fontSize:22,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:22,fontWeight:700,color:'var(--accent)'}}>{s.value}</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
          <span style={{fontSize:20}}>📦</span>
          <div style={{flex:1}}>
            <div className="card-title" style={{marginBottom:0}}>Closed Orders</div>
            <div style={{fontSize:12,color:'var(--text3)'}}>Successfully completed and closed orders</div>
          </div>
          <input className="input" placeholder="Search orders…" value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{width:220,fontSize:13}} />
        </div>

        {isLoading ? <div className="text-muted">Loading…</div> :
         filtered.length===0 ? (
          <div style={{textAlign:'center',padding:'40px 0',color:'var(--text3)'}}>
            <div style={{fontSize:32,marginBottom:8}}>{search ? '🔍' : '📭'}</div>
            <div>{search ? 'No orders match your search' : 'No closed orders yet'}</div>
          </div>
         ) : (
          <table className="table">
            <thead><tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>PO Number</th>
              <th>Enquiry / Quote</th>
              <th>Closed On</th>
              <th>Created By</th>
              <th>Items</th>
            </tr></thead>
            <tbody>
              {filtered.map(o=>(
                <tr key={o.id}>
                  <td>
                    <span className="mono" style={{color:'var(--accent)',fontWeight:600}}>{o.id}</span>
                  </td>
                  <td>{custName(o.customer_id)}</td>
                  <td><span className="mono">{o.po_number||'—'}</span></td>
                  <td style={{fontSize:12,color:'var(--text3)'}}>
                    {o.enquiry_no && <div>ENQ: {o.enquiry_no}</div>}
                    {o.quote_no   && <div>QT: {o.quote_no}</div>}
                    {!o.enquiry_no && !o.quote_no && '—'}
                  </td>
                  <td>
                    <span style={{display:'inline-flex',alignItems:'center',gap:5,
                      background:'var(--green-lt)',color:'var(--green)',
                      borderRadius:999,padding:'2px 9px',fontSize:11,fontWeight:600}}>
                      ✓ {fmt(o.closed_at)}
                    </span>
                  </td>
                  <td style={{fontSize:12}}>{o.created_by||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{(o.lineItems||[]).length} line(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
         )
        }
      </div>
    </div>
  );
}
