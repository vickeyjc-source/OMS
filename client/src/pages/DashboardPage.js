// client/src/pages/DashboardPage.js  v2
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
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

  // ── Global Search ──────────────────────────────────────────────────────────
  const [searchQ,      setSearchQ]      = useState('');
  const [searchRes,    setSearchRes]    = useState(null);
  const [searchLoading,setSearchLoading]= useState(false);
  const [searchOpen,   setSearchOpen]   = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // ── Financial Dashboard State ──────────────────────────────────────────────
  const [finExpanded, setFinExpanded] = useState(true);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchRes(null); setSearchOpen(false); return; }
    setSearchLoading(true);
    try {
      const r = await api.get('/search?q=' + encodeURIComponent(q));
      setSearchRes(r.data);
      setSearchOpen(true);
    } catch(_) {}
    finally { setSearchLoading(false); }
  }, []);

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchQ(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const totalResults = searchRes ? (searchRes.orders?.length||0)+(searchRes.items?.length||0)+(searchRes.enquiries?.length||0)+(searchRes.suppliers?.length||0)+(searchRes.customers?.length||0) : 0;
  const { data: summary={} } = useQuery({ queryKey:['summary'], queryFn:()=>api.get('/reports/summary').then(r=>r.data), refetchInterval:15000 });
  const { data: orders=[] }  = useQuery({ queryKey:['orders'],  queryFn:()=>api.get('/orders').then(r=>r.data) });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const canSeeCustomer = user.perms?.canSeeCustomer !== false;
  const custName = id => canSeeCustomer ? (customers.find(c=>c.id===id)?.name||id) : '[Restricted]';

  const openOrders = orders.filter(o => (o.status || '').toLowerCase() !== 'closed');
  const allValues  = useMemo(()=>computeValues(orders),[orders]);
  const shippedOrders = orders.filter(o=>(o.lineItems||[]).some(li=>['shipped'].includes(li.line_status)));

  const pipeline = [
    {s:'open',       label:'Open',        count:openOrders.length},
    {s:'delivered',  label:'Delivered',   count:summary.delivered||0},
    {s:'closed',     label:'Closed',      count:summary.closed||0},
    {s:'hold',       label:'Hold',        count:summary.hold||0},
    {s:'failed',     label:'Failed',      count:summary.failed||0},
  ];
  const totalPipe = pipeline.reduce((sum, p) => sum + p.count, 0);
  const pipelineSegments = [
    { key:'open',      label:'Open',      count:openOrders.length,    color:'var(--accent)' },
    { key:'delivered', label:'Delivered', count:summary.delivered||0, color:'var(--green)' },
    { key:'closed',    label:'Closed',    count:summary.closed||0,    color:'var(--teal)' },
    { key:'hold',      label:'Hold',      count:summary.hold||0,      color:'var(--amber)' },
    { key:'failed',    label:'Failed',    count:summary.failed||0,    color:'var(--red)' },
  ];
  const pipelineRing = useMemo(() => {
    if (!totalPipe) return 'conic-gradient(var(--surface2) 0deg 360deg)';
    let start = 0;
    const slices = pipelineSegments
      .filter(seg => seg.count > 0)
      .map(seg => {
        const deg = (seg.count / totalPipe) * 360;
        const end = start + deg;
        const out = `${seg.color} ${start}deg ${end}deg`;
        start = end;
        return out;
      });
    if (start < 360) slices.push(`var(--surface2) ${start}deg 360deg`);
    return `conic-gradient(${slices.join(',')})`;
  }, [pipelineSegments, totalPipe]);

  const lineItemStatus = useMemo(() => {
    return orders.reduce((acc, order) => {
      (order.lineItems || []).forEach((li) => {
        const s = (li.line_status || '').toLowerCase();
        if (s) acc[s] = (acc[s] || 0) + 1;
      });
      return acc;
    }, {});
  }, [orders]);

  const fin = useMemo(()=>{
    if (!isAdmin) return null;
    return {today:{orders:filterByRange(orders,'today'),values:computeValues(filterByRange(orders,'today'))},month:{orders:filterByRange(orders,'month'),values:computeValues(filterByRange(orders,'month'))},year:{orders:filterByRange(orders,'year'),values:computeValues(filterByRange(orders,'year'))},all:{orders,values:computeValues(orders)}};
  },[orders,isAdmin]);

  return (
    <div>
      {/* ── Global Search Bar ──────────────────────────────────────────────── */}
      <div ref={searchRef} style={{position:'relative',marginBottom:18}}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
          background:'var(--surface2)',borderRadius:10,
          border:`1.5px solid ${searchOpen&&searchQ?'var(--accent)':'var(--border)'}`,
          transition:'border-color .15s'}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text3)" strokeWidth="2">
            <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
          </svg>
          <input
            value={searchQ}
            onChange={handleSearchChange}
            onFocus={()=>{ if(searchRes&&searchQ.length>=2) setSearchOpen(true); }}
            placeholder="Search by MPN, Component, Manufacturer, Order ID, Customer, Supplier…"
            style={{flex:1,border:'none',background:'transparent',
              fontSize:14,color:'var(--text)',fontFamily:'inherit'}}
          />
          {searchLoading && <span style={{fontSize:11,color:'var(--text3)'}}>Searching…</span>}
          {searchQ && <button onClick={()=>{setSearchQ('');setSearchRes(null);setSearchOpen(false);}}
            style={{border:'none',background:'transparent',cursor:'pointer',fontSize:16,
              color:'var(--text3)',lineHeight:1,padding:0}}>×</button>}
        </div>

        {/* Results dropdown */}
        {searchOpen && searchRes && totalResults === 0 && (
          <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,right:0,zIndex:100,
            background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,
            padding:'16px',textAlign:'center',color:'var(--text3)',fontSize:13,
            boxShadow:'0 4px 16px rgba(0,0,0,.1)'}}>
            No results for <strong>{searchQ}</strong>
          </div>
        )}

        {searchOpen && searchRes && totalResults > 0 && (
          <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,right:0,zIndex:100,
            background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,
            maxHeight:420,overflowY:'auto',
            boxShadow:'0 4px 16px rgba(0,0,0,.12)'}}>

            {/* Orders */}
            {(searchRes.orders||[]).length > 0 && (
              <div>
                <div style={{padding:'6px 14px',fontSize:10,fontWeight:700,color:'var(--text3)',
                  letterSpacing:.5,background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>ORDERS</div>
                {searchRes.orders.map(o=>(
                  <div key={o.id} onClick={()=>{navigate('/orders');setSearchOpen(false);setSearchQ('');}}
                    style={{padding:'9px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,
                      borderBottom:'1px solid var(--border)',transition:'background .1s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,color:'var(--accent)'}}>{o.id}</span>
                    <span style={{fontSize:11,color:'var(--text2)'}}>{canSeeCustomer?custName(o.customer_id):''}</span>
                    {o.po_number&&<span style={{fontSize:11,color:'var(--text3)'}}>PO: {o.po_number}</span>}
                    <span style={{marginLeft:'auto',fontSize:10,padding:'1px 7px',borderRadius:99,
                      background:'var(--surface2)',color:'var(--text3)',fontWeight:600}}>{o.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Items (MPN/Component/Manufacturer) */}
            {(searchRes.items||[]).length > 0 && (
              <div>
                <div style={{padding:'6px 14px',fontSize:10,fontWeight:700,color:'var(--text3)',
                  letterSpacing:.5,background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>COMPONENTS / MPN</div>
                {searchRes.items.map((li,i)=>(
                  <div key={i} onClick={()=>{navigate('/orders');setSearchOpen(false);setSearchQ('');}}
                    style={{padding:'9px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,
                      borderBottom:'1px solid var(--border)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>{li.component}</span>
                    {li.manufacturer&&<span style={{fontSize:11,color:'var(--text3)'}}>— {li.manufacturer}</span>}
                    {li.ipn&&<span style={{fontSize:11,fontFamily:'monospace',color:'var(--teal,#0d9488)'}}>{li.ipn}</span>}
                    <span style={{marginLeft:'auto',fontSize:10,fontFamily:'monospace',
                      color:'var(--accent)',fontWeight:600}}>{li.order_id}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Enquiries */}
            {(searchRes.enquiries||[]).length > 0 && (
              <div>
                <div style={{padding:'6px 14px',fontSize:10,fontWeight:700,color:'var(--text3)',
                  letterSpacing:.5,background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>ENQUIRIES</div>
                {searchRes.enquiries.map((e,i)=>(
                  <div key={i} onClick={()=>{navigate('/enquiries');setSearchOpen(false);setSearchQ('');}}
                    style={{padding:'9px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,
                      borderBottom:'1px solid var(--border)'}}
                    onMouseEnter={ev=>ev.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={ev=>ev.currentTarget.style.background=''}>
                    <span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,color:'var(--purple,#6d28d9)'}}>{e.enquiry_id}</span>
                    <span style={{fontSize:12,fontWeight:600}}>{e.component}</span>
                    {e.manufacturer&&<span style={{fontSize:11,color:'var(--text3)'}}>— {e.manufacturer}</span>}
                    <span style={{marginLeft:'auto',fontSize:10,padding:'1px 7px',borderRadius:99,
                      background:'var(--surface2)',color:'var(--text3)',fontWeight:600}}>{e.enq_status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Customers */}
            {(searchRes.customers||[]).length > 0 && (
              <div>
                <div style={{padding:'6px 14px',fontSize:10,fontWeight:700,color:'var(--text3)',
                  letterSpacing:.5,background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>CUSTOMERS</div>
                {searchRes.customers.map(c=>(
                  <div key={c.id} onClick={()=>{navigate('/customers');setSearchOpen(false);setSearchQ('');}}
                    style={{padding:'9px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,
                      borderBottom:'1px solid var(--border)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <span style={{fontSize:13,fontWeight:600}}>{c.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Suppliers */}
            {(searchRes.suppliers||[]).length > 0 && (
              <div>
                <div style={{padding:'6px 14px',fontSize:10,fontWeight:700,color:'var(--text3)',
                  letterSpacing:.5,background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>SUPPLIERS</div>
                {searchRes.suppliers.map((s,i)=>(
                  <div key={i} onClick={()=>{navigate('/suppliers');setSearchOpen(false);setSearchQ('');}}
                    style={{padding:'9px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,
                      borderBottom:'1px solid var(--border)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <span style={{fontSize:13,fontWeight:600}}>{s.name}</span>
                    <span style={{fontSize:11,color:'var(--text3)',marginLeft:'auto',fontFamily:'monospace'}}>{s.order_id}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-accent"><div className="stat-label">Total Orders</div><div className="stat-val">{summary.total||0}</div><div className="stat-sub">{summary.customers||0} customers · {summary.enquiries||0} enquiries</div></div>
        <div className="stat-card stat-amber"><div className="stat-label">Open Orders</div><div className="stat-val" style={{color:'var(--amber)'}}>{openOrders.length}</div><div className="stat-sub">Not closed orders · {summary.delayed||0} delayed</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid var(--teal)'}}><div className="stat-label">In Shipping</div><div className="stat-val" style={{color:'var(--teal)'}}>{shippedOrders.length}</div><div className="stat-sub">Line items with Shipped status</div></div>
        <div className="stat-card stat-green"><div className="stat-label">Delivered</div><div className="stat-val" style={{color:'var(--green)'}}>{summary.delivered||0}</div><div className="stat-sub">{summary.total?Math.round(summary.delivered/summary.total*100):0}% success rate</div></div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        <div className="card card-sm" style={{marginBottom:0}}><div className="card-title" style={{marginBottom:10}}><span>💼 Portfolio Value</span></div><ValuePills totals={allValues} size={14}/><div style={{fontSize:11,color:'var(--text3)',marginTop:7}}>Across all {orders.length} orders</div></div>
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
          <div style={{display:'grid',gridTemplateColumns:'160px 1fr',gap:14,alignItems:'center',marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'center'}}>
              <div style={{position:'relative',width:146,height:146,borderRadius:'50%',background:pipelineRing,display:'grid',placeItems:'center'}}>
                <div style={{width:96,height:96,borderRadius:'50%',background:'var(--surface)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--text)'}}>{totalPipe}</div>
                  <div style={{fontSize:10,color:'var(--text3)',fontWeight:600,letterSpacing:0.3}}>TOTAL ORDERS</div>
                </div>
              </div>
            </div>
            <div style={{display:'grid',gap:8}}>
              {pipelineSegments.map(seg => {
                const pct = totalPipe ? Math.round((seg.count / totalPipe) * 100) : 0;
                return (
                  <div key={seg.key} style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{width:10,height:10,borderRadius:'50%',background:seg.color,flexShrink:0}}/>
                    <span style={{fontSize:12,color:'var(--text2)',flex:1}}>{seg.label}</span>
                    <span className="mono" style={{fontSize:12,fontWeight:700,minWidth:28,textAlign:'right'}}>{seg.count}</span>
                    <span style={{fontSize:11,color:'var(--text3)',minWidth:34,textAlign:'right'}}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <hr className="divider"/>
          <div style={{fontSize:12,color:'var(--text2)',fontWeight:600,marginBottom:8}}>Line Item Statuses</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {[{l:'Negotiating',v:lineItemStatus.negotiating||0,c:'var(--purple)'},{l:'In Procurement',v:lineItemStatus.procurement||summary.procurement||0,c:'var(--accent)'},{l:'Shipped',v:lineItemStatus.shipped||summary.in_transit||0,c:'var(--teal)'},{l:'Delivered Hub',v:lineItemStatus.delivered_hub||summary.delivery_hub||0,c:'var(--green)'}].map(s=>(
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
          <div className="card-title" style={{cursor:'pointer'}} onClick={()=>setFinExpanded(!finExpanded)}>
            <div style={{display:'flex',alignItems:'center',gap:9,flex:1}}>
              <span style={{background:'var(--accent)',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:999}}>ADMIN</span>
              <span>📊 Financial Dashboard</span>
              <span style={{marginLeft:'auto',fontSize:16,transition:'transform .2s',transform:finExpanded?'rotate(0deg)':'rotate(-90deg)'}}>▼</span>
            </div>
            <span style={{fontSize:11,color:'var(--text3)'}}>Order values by period</span>
          </div>

          {finExpanded && (
            <>

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

                        const displayVal = (baseVal, baseCur) => fmtVal(baseVal, baseCur);

                        return<tr key={cur}>
                          <td><span className="mono bold">{cur}</span></td>
                          <td className="mono bold" style={{fontSize:13}}>{displayVal(total,cur)}</td>
                          <td className="mono" style={{color:'var(--amber)',fontSize:12}}>{displayVal(val(orders.filter(o=>(o.status||'').toLowerCase()!=='closed')),cur)}</td>
                          <td className="mono" style={{color:'var(--green)',fontSize:12}}>{displayVal(val(orders.filter(o=>o.status==='delivered')),cur)}</td>
                          <td className="mono" style={{color:'var(--teal)',fontSize:12}}>{displayVal(val(orders.filter(o=>o.status==='closed')),cur)}</td>
                          <td className="mono" style={{color:'var(--red)',fontSize:12}}>{displayVal(val(orders.filter(o=>['failed','hold'].includes(o.status))),cur)}</td>
                        </tr>;
                      }).filter(Boolean);
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
