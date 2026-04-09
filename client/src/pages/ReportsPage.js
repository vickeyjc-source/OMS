// client/src/pages/ReportsPage.js  v2
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { fmt, orderTotal, isDelayed, StatusBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

export default function ReportsPage() {
  const [tab, setTab] = useState('open');
  const { user } = useAuth();
  const { data: orders=[] }    = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>r.data) });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: summary={} }   = useQuery({ queryKey:['summary'],   queryFn:()=>api.get('/reports/summary').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name||id;
  const today = new Date();
  const sets = {
    open:      orders.filter(o=>o.status==='open'),
    delayed:   orders.filter(o=>isDelayed(o)),
    delivered: orders.filter(o=>o.status==='delivered'),
    closed:    orders.filter(o=>o.status==='closed'),
    failed:    orders.filter(o=>o.status==='failed'),
    hold:      orders.filter(o=>o.status==='hold'),
    all:       orders,
  };
  const TABS = [{key:'open',label:'Open'},{key:'delayed',label:'Delayed'},{key:'delivered',label:'Delivered'},{key:'closed',label:'Closed'},{key:'failed',label:'Failed'},{key:'hold',label:'Hold'},{key:'all',label:'All Orders'}];
  const list = sets[tab]||[];

  return (
    <div>
      <div className="stats-grid" style={{marginBottom:18}}>
        <div className="stat-card stat-amber"><div className="stat-label">Open Orders</div><div className="stat-val" style={{color:'var(--amber)'}}>{summary.open||0}</div><div className="stat-sub">{summary.delayed||0} past due date</div></div>
        <div className="stat-card stat-red"><div className="stat-label">Delayed</div><div className="stat-val" style={{color:'var(--red)'}}>{summary.delayed||0}</div><div className="stat-sub">Past tentative date</div></div>
        <div className="stat-card stat-green"><div className="stat-label">Delivered</div><div className="stat-val" style={{color:'var(--green)'}}>{summary.delivered||0}</div><div className="stat-sub">{summary.total?Math.round(summary.delivered/summary.total*100):0}% rate</div></div>
        <div className="stat-card stat-accent"><div className="stat-label">Total Orders</div><div className="stat-val">{summary.total||0}</div><div className="stat-sub">{summary.closed||0} closed</div></div>
      </div>

      <div style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Enquiry Pipeline</div>
        <div style={{display:'flex',gap:10}}>
          {[{l:'New',v:summary.enq_new||0,c:'var(--text3)'},{l:'Sourcing',v:summary.enq_sourcing||0,c:'var(--purple)'},{l:'Quoted',v:summary.enq_quoted||0,c:'var(--amber)'},{l:'Total',v:summary.enquiries||0,c:'var(--accent)'}].map(s=>(
            <div key={s.l} style={{background:'var(--surface2)',borderRadius:'var(--r)',padding:'10px 16px',textAlign:'center',minWidth:80}}>
              <div style={{fontSize:20,fontWeight:700,color:s.c}}>{s.v}</div>
              <div style={{fontSize:11,color:'var(--text2)',marginTop:3}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(t=><button key={t.key} className={`tab-btn ${tab===t.key?'active':''}`} onClick={()=>setTab(t.key)}>{t.label} <span style={{fontSize:11,opacity:.7}}>({sets[t.key]?.length||0})</span></button>)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order ID</th><th>Customer</th><th>PO No.</th><th>Items</th><th>Status</th><th>Due Date</th>{tab==='delivered'&&<th>Delivered On</th>}{tab==='delayed'&&<th>Days Late</th>}<th>Value</th></tr></thead>
          <tbody>
            {list.length===0&&<tr><td colSpan={8}><div className="empty-state"><div className="empty-icon">📊</div><div>No orders</div></div></td></tr>}
            {list.map(o=>{
              const late=isDelayed(o);
              const daysLate=late?Math.round((today-new Date(o.tentative_date))/(1000*3600*24)):0;
              return(
                <tr key={o.id}>
                  <td className="mono bold">{o.id}</td>
                  <td>{custName(o.customer_id)}</td>
                  <td className="mono">{o.po_number||'—'}</td>
                  <td><span className="badge badge-blue">{o.lineItems?.length||0}</span></td>
                  <td><StatusBadge s={o.status}/></td>
                  <td style={{color:late&&tab!=='delivered'?'var(--red)':'inherit',fontWeight:late?600:400}}>{o.tentative_date||'—'}</td>
                  {tab==='delivered'&&<td className="bold" style={{color:'var(--green)'}}>{o.customerShipping?.delivery_date||'—'}</td>}
                  {tab==='delayed'&&<td><span className="badge badge-red">{daysLate}d</span></td>}
                  <td className="mono">₹{fmt(orderTotal(o))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
