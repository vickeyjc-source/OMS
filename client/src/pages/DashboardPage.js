// client/src/pages/DashboardPage.js  v2
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { fmt, orderTotal, isDelayed, StatusBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

function fmtVal(n,c){const sym={INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};return`${sym[c]||c}${new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(n||0)}`;}
function computeValues(orders){const t={};orders.forEach(o=>(o.lineItems||[]).forEach(li=>{const c=li.currency||'INR';t[c]=(t[c]||0)+(li.qty*li.unit_price);}));return t;}
function ValuePills({totals,size=13}){const e=Object.entries(totals||{}).filter(([,v])=>v>0);if(!e.length)return<span style={{color:'var(--text3)',fontSize:12}}>—</span>;const clr={INR:'#1a6b40',USD:'#1b4f9e',EUR:'#5c3b9a',SGD:'#0b6b6b',GBP:'#8c3d00'};return<div style={{display:'flex',flexWrap:'wrap',gap:5}}>{e.map(([c,v])=><span key={c} style={{background:clr[c]||'#444',color:'#fff',padding:'2px 9px',borderRadius:999,fontSize:size-1,fontWeight:600,fontFamily:'DM Mono,monospace'}}>{fmtVal(v,c)}</span>)}</div>;}
function filterByRange(orders,range){const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());if(range==='today')return orders.filter(o=>new Date(o.created_at)>=today);if(range==='month')return orders.filter(o=>new Date(o.created_at)>=new Date(now.getFullYear(),now.getMonth(),1));if(range==='year')return orders.filter(o=>new Date(o.created_at)>=new Date(now.getFullYear(),0,1));return orders;}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = ['admin','manager'].includes(user.role);
  const { data: summary={} } = useQuery({ queryKey:['summary'], queryFn:()=>api.get('/reports/summary').then(r=>r.data), refetchInterval:15000 });
  const { data: orders=[] }  = useQuery({ queryKey:['orders'],  queryFn:()=>api.get('/orders').then(r=>r.data) });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const canSeeCustomer = user.perms?.canSeeCustomer !== false;
  const custName = id => canSeeCustomer ? (customers.find(c=>c.id===id)?.name||id) : '[Restricted]';

  const openOrders = orders.filter(o=>o.status==='open');
  const openValues = useMemo(()=>computeValues(openOrders),[openOrders]);
  const allValues  = useMemo(()=>computeValues(orders),[orders]);
  const shippedOrders = orders.filter(o=>(o.lineItems||[]).some(li=>['shipped'].includes(li.line_status)));

  const pipeline = [
    {s:'open',       label:'Open',        count:summary.open||0},
    {s:'delivered',  label:'Delivered',   count:summary.delivered||0},
    {s:'closed',     label:'Closed',      count:summary.closed||0},
    {s:'hold',       label:'Hold',        count:summary.hold||0},
    {s:'failed',     label:'Failed',      count:summary.failed||0},
  ];
  const maxPipe = Math.max(...pipeline.map(p=>p.count),1);

  const fin = useMemo(()=>{
    if (!isAdmin) return null;
    return {today:{orders:filterByRange(orders,'today'),values:computeValues(filterByRange(orders,'today'))},month:{orders:filterByRange(orders,'month'),values:computeValues(filterByRange(orders,'month'))},year:{orders:filterByRange(orders,'year'),values:computeValues(filterByRange(orders,'year'))},all:{orders,values:computeValues(orders)}};
  },[orders,isAdmin]);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card stat-accent"><div className="stat-label">Total Orders</div><div className="stat-val">{summary.total||0}</div><div className="stat-sub">{summary.customers||0} customers · {summary.enquiries||0} enquiries</div></div>
        <div className="stat-card stat-amber"><div className="stat-label">Open Orders</div><div className="stat-val" style={{color:'var(--amber)'}}>{summary.open||0}</div><div className="stat-sub">{summary.delayed||0} delayed past due date</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid var(--teal)'}}><div className="stat-label">In Shipping</div><div className="stat-val" style={{color:'var(--teal)'}}>{shippedOrders.length}</div><div className="stat-sub">Line items with Shipped status</div></div>
        <div className="stat-card stat-green"><div className="stat-label">Delivered</div><div className="stat-val" style={{color:'var(--green)'}}>{summary.delivered||0}</div><div className="stat-sub">{summary.total?Math.round(summary.delivered/summary.total*100):0}% success rate</div></div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:14}}>
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title" style={{marginBottom:10}}><span>💼 Portfolio Value</span></div><ValuePills totals={allValues} size={14}/><div style={{fontSize:11,color:'var(--text3)',marginTop:7}}>Across all {orders.length} orders</div></div>
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title" style={{marginBottom:10}}><span>🔓 Open Orders Value</span></div><ValuePills totals={openValues} size={14}/><div style={{fontSize:11,color:'var(--text3)',marginTop:7}}>{openOrders.length} active orders</div></div>
        <div className="card card-sm" style={{marginBottom:0}}>
          <div className="card-title" style={{marginBottom:10}}><span>📩 Enquiry Pipeline</span></div>
          <div style={{display:'flex',gap:10}}>
            {[{l:'New',v:summary.enq_new||0,c:'var(--text3)'},{l:'Sourcing',v:summary.enq_sourcing||0,c:'var(--purple)'},{l:'Quoted',v:summary.enq_quoted||0,c:'var(--amber)'}].map(s=>(
              <div key={s.l} style={{flex:1,textAlign:'center'}}><div style={{fontSize:22,fontWeight:700,color:s.c}}>{s.v}</div><div style={{fontSize:11,color:'var(--text2)'}}>{s.l}</div></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{marginBottom:14}}>
        <div className="card" style={{marginBottom:0}}>
          <div className="card-title"><span>Recent Orders</span><button className="btn btn-sm" onClick={()=>navigate('/orders')}>View All</button></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order ID</th>{canSeeCustomer&&<th>Customer</th>}<th>PO</th><th>Status</th><th>Value</th><th>Due</th></tr></thead>
              <tbody>
                {orders.length===0&&<tr><td colSpan={6} style={{textAlign:'center',color:'var(--text3)',padding:24}}>No orders yet</td></tr>}
                {orders.slice(0,8).map(o=>{
                  const oVals=computeValues([o]);
                  const delayed=isDelayed(o);
                  return(<tr key={o.id} className="clickable" onClick={()=>navigate('/orders')}>
                    <td className="mono bold" style={{fontSize:12}}>{o.id}</td>
                    {canSeeCustomer&&<td style={{maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{custName(o.customer_id)}</td>}
                    <td className="mono" style={{fontSize:11}}>{o.po_number||'—'}</td>
                    <td><StatusBadge s={o.status}/></td>
                    <td><ValuePills totals={oVals} size={11}/></td>
                    <td style={{fontSize:12,color:delayed?'var(--red)':'var(--text2)',fontWeight:delayed?600:400}}>{o.tentative_date||'—'}{delayed?' ⚠':''}</td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{marginBottom:0}}>
          <div className="card-title">Order Pipeline</div>
          {pipeline.map(p=>(
            <div key={p.s} style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <div style={{width:98,flexShrink:0}}><StatusBadge s={p.s}/></div>
              <div className="progress-bar" style={{flex:1}}><div className="progress-fill" style={{width:`${p.count/maxPipe*100}%`,background:p.s==='delivered'||p.s==='closed'?'var(--green)':p.s==='failed'?'var(--red)':p.s==='hold'?'var(--amber)':'var(--accent)'}}/></div>
              <div style={{fontSize:12,fontWeight:700,minWidth:20,textAlign:'right'}}>{p.count}</div>
            </div>
          ))}
          <hr className="divider"/>
          <div style={{fontSize:12,color:'var(--text2)',fontWeight:600,marginBottom:8}}>Line Item Statuses</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {[{l:'Negotiating',v:(summary.procurement||0)+'',c:'var(--purple)'},{l:'In Procurement',v:summary.procurement||0,c:'var(--accent)'},{l:'Shipped',v:summary.in_transit||0,c:'var(--teal)'},{l:'Delayed',v:summary.delayed||0,c:'var(--red)'}].map(s=>(
              <div key={s.l} style={{flex:1,background:'var(--surface2)',borderRadius:'var(--r)',padding:'8px 10px',textAlign:'center',minWidth:60}}>
                <div style={{fontSize:18,fontWeight:700,color:s.c}}>{s.v}</div>
                <div style={{fontSize:10,color:'var(--text2)',marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isAdmin && fin && (
        <div className="card" style={{marginBottom:14,border:'1px solid rgba(27,79,158,.2)'}}>
          <div className="card-title">
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              <span style={{background:'var(--accent)',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:999}}>ADMIN</span>
              <span>📊 Financial Dashboard</span>
            </div>
            <span style={{fontSize:11,color:'var(--text3)'}}>Order values by period</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
            {[{label:'Today',key:'today',icon:'📅',color:'var(--teal)'},{label:'This Month',key:'month',icon:'🗓️',color:'var(--accent)'},{label:'This Year',key:'year',icon:'📆',color:'var(--purple)'},{label:'All Time',key:'all',icon:'🏆',color:'var(--green)'}].map(({label,key,icon,color})=>(
              <div key={key} style={{background:'var(--surface2)',borderRadius:'var(--r)',padding:'14px 16px',borderLeft:`3px solid ${color}`}}>
                <div style={{fontSize:12,color:'var(--text2)',marginBottom:6,fontWeight:600}}>{icon} {label}</div>
                <div style={{fontSize:20,fontWeight:700,color,marginBottom:4}}>{fin[key].orders.length}<span style={{fontSize:11,fontWeight:400,color:'var(--text3)',marginLeft:5}}>orders</span></div>
                <ValuePills totals={fin[key].values} size={12}/>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text2)',marginBottom:8}}>All-time value by currency</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Currency</th><th>Total Value</th><th>Open</th><th>Delivered</th><th>Closed</th><th>Failed/Hold</th></tr></thead>
              <tbody>
                {(()=>{
                  const curs=[...new Set(orders.flatMap(o=>(o.lineItems||[]).map(li=>li.currency||'INR')))].sort();
                  if(!curs.length)return<tr><td colSpan={6} style={{textAlign:'center',color:'var(--text3)',padding:18}}>No data</td></tr>;
                  return curs.map(cur=>{
                    const val=grp=>grp.reduce((s,o)=>s+(o.lineItems||[]).filter(li=>(li.currency||'INR')===cur).reduce((ss,li)=>ss+(li.qty*li.unit_price),0),0);
                    const total=val(orders);
                    if(!total)return null;
                    return<tr key={cur}>
                      <td><span className="mono bold">{cur}</span></td>
                      <td className="mono bold">{fmtVal(total,cur)}</td>
                      <td className="mono" style={{color:'var(--amber)'}}>{fmtVal(val(orders.filter(o=>o.status==='open')),cur)}</td>
                      <td className="mono" style={{color:'var(--green)'}}>{fmtVal(val(orders.filter(o=>o.status==='delivered')),cur)}</td>
                      <td className="mono" style={{color:'var(--teal)'}}>{fmtVal(val(orders.filter(o=>o.status==='closed')),cur)}</td>
                      <td className="mono" style={{color:'var(--red)'}}>{fmtVal(val(orders.filter(o=>['failed','hold'].includes(o.status))),cur)}</td>
                    </tr>;
                  }).filter(Boolean);
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-3">
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title">Suppliers</div><div className="stat-val" style={{fontSize:28}}>{summary.suppliers||0}</div><div style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>{summary.domestic||0} domestic · {summary.international||0} international</div></div>
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title">Delayed Orders</div><div className="stat-val" style={{fontSize:28,color:'var(--amber)'}}>{summary.delayed||0}</div><div style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>Past tentative delivery date</div></div>
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title">Line Cards</div><div className="stat-val" style={{fontSize:28}}>{summary.linecards||0}</div><div style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>Manufacturer brands tracked</div></div>
      </div>
    </div>
  );
}
