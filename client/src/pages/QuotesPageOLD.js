// client/src/pages/QuotesPage.js
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtM = (n,c='INR') => { const s={INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'}; return (s[c]||c+' ')+(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); };

// ── Quote Detail Modal ────────────────────────────────────────────────────────
function QuoteModal({ quote, customers, enquiries, onClose, onOrderCreated }) {
  const qc       = useNavigate ? useNavigate() : null;
  const navigate = useNavigate();
  const qClient  = useQueryClient();
  const { user } = useAuth();

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const enqNo    = id => enquiries.find(e=>e.id===id)?.id || id;

  const [tab, setTab]           = useState('items');
  const [saving, setSaving]     = useState(false);
  const [revNote, setRevNote]   = useState('');
  const [zohoRef, setZohoRef]   = useState(quote.zoho_quote_no||'');
  const [validUntil, setValid]  = useState(quote.valid_until||'');
  const [custResp, setCustResp] = useState(quote.customer_response||'');
  const [custRespNote, setCustRespNote] = useState(quote.customer_response_notes||'');
  const [custRespDate, setCustRespDate] = useState(quote.customer_response_date||new Date().toISOString().slice(0,10));
  const [savedResponse, setSavedResponse] = useState(quote.customer_response||'');

  // Fetch line items
  const { data: liData, isLoading: liLoading } = useQuery({
    queryKey: ['quote-lineitems', quote.id],
    queryFn:  () => api.get('/quotes/'+quote.id+'/lineitems').then(r=>r.data),
    enabled:  !!quote.enquiry_id,
  });
  const lineItems = liData?.items || [];

  const totalVal = lineItems.reduce((s,li)=>{
    const base = (li.quantity||0)*(li.quote_price||0);
    const tax  = base * ((li.tax_rate||0)/100);
    return s + base + tax;
  }, 0);

  const mutation = useMutation({
    mutationFn: d => api.put('/quotes/'+quote.id, d),
    onSuccess: (_, vars) => {
  qClient.invalidateQueries(['quotes']);
  toast.success('Quote updated');
  if (vars?.customer_response) setSavedResponse(vars.customer_response);
},
    onError:    e  => toast.error(e.response?.data?.error||'Update failed'),
  });

  const reviseMutation = useMutation({
    mutationFn: d => api.post('/quotes/'+quote.id+'/revise', d),
    onSuccess:  (r) => {
      qClient.invalidateQueries(['quotes']);
      toast.success('Sent back to Sourcing for revision');
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error||'Revise failed'),
  });

  const handleSaveDetails = () => {
    mutation.mutate({ zoho_quote_no: zohoRef, valid_until: validUntil });
  };

  const handleCustResponse = () => {
    if (!custResp) { toast.error('Select a response'); return; }
    mutation.mutate({
      customer_response:       custResp,
      customer_response_date:  custRespDate,
      customer_response_notes: custRespNote,
      customer_response_by:    user.name,
    });
  };

  const handleRevise = () => {
    if (!revNote.trim()) { toast.error('Enter revision notes for Sourcing'); return; }
    reviseMutation.mutate({ sales_revision_notes: revNote });
  };

  const handleCreateOrder = () => {
    navigate('/orders/new', { state: {
      prefill: {
        quote_id:      quote.id,
        quote_no:      quote.quote_no,
        zoho_quote_no: quote.zoho_quote_no,
        customer_id:   quote.customer_id,
        enquiry_id:    quote.enquiry_id,
        enquiry_no:    quote.enquiry_id,
        lineItems:     lineItems.map(li=>({
          component:         li.component,
          manufacturer:      li.manufacturer,
          ipn:               li.ipn,
          // FIX: renamed to match NewOrderPage useState initialiser field names
          qty:               li.quantity,
          unit_price:        li.quote_price,
          quoted_price:      li.quote_price,
          procurement_price: li.sourced_price,
          tax_rate:          li.tax_rate||0,
          target_price:      li.target_price,
          currency:          li.quote_currency||'INR',
          delivery_date:     li.preferred_delivery_date,
        })),
      }
    }});
    onClose();
  };

  const isActive    = quote.status === 'active';
  const isReturned  = quote.status === 'returned_to_sourcing';
  const isOrdered   = quote.status === 'order_created';
  const canRevise   = isActive;
  // CHANGE: Create Order only allowed when customer has explicitly approved (saved in DB)
  // quote.customer_response is the DB-saved value — not the unsaved local radio selection
  const customerApproved = quote.customer_response === 'accepted' || savedResponse === 'accepted';
  const canOrder    = isActive && lineItems.length > 0 && customerApproved;

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>📄 {quote.quote_no}
              {quote.revision > 1 && <span style={{fontSize:12,color:'var(--text3)',marginLeft:8}}>Rev {quote.revision}</span>}
            </h2>
            <div style={{display:'flex',gap:12,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
              <StatusBadge s={quote.status}/>
              <span style={{fontSize:12,color:'var(--text3)'}}>{custName(quote.customer_id)}</span>
              {quote.enquiry_id && <span style={{fontSize:12,color:'var(--text3)'}}>ENQ: <span className="mono">{quote.enquiry_id}</span></span>}
              <span style={{fontSize:12,color:'var(--text3)'}}>Created: {fmtDate(quote.created_at)}</span>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>

        {/* Sales revision notes banner */}
        {quote.sales_revision_notes && (
          <div style={{padding:'10px 20px',background:'var(--amber-lt,#fffbeb)',borderBottom:'1px solid var(--amber,#d97706)33',fontSize:12}}>
            <span style={{fontWeight:700,color:'var(--amber,#d97706)'}}>💬 Sales note to Sourcing: </span>
            {quote.sales_revision_notes}
          </div>
        )}

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid var(--border)',padding:'0 20px'}}>
          {[['items','Line Items'],['details','Details'],['response','Customer Response'],['revise','Send to Revision']].map(([k,l])=>(
            <div key={k} onClick={()=>setTab(k)} style={{padding:'10px 18px',fontSize:12,fontWeight:600,cursor:'pointer',
              borderBottom:tab===k?'2px solid var(--accent)':'2px solid transparent',
              color:tab===k?'var(--accent)':'var(--text3)'}}>
              {l}
            </div>
          ))}
        </div>

        <div className="modal-body">

          {/* ── Tab: Line Items ── */}
          {tab==='items' && (
            <div>
              {liLoading ? (
                <div style={{color:'var(--text3)',fontSize:13,padding:20}}>Loading items…</div>
              ) : lineItems.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:13,padding:20}}>No line items — enquiry not linked or not yet priced in Sourcing.</div>
              ) : (
                <>
                  <table className="li-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Component</th><th>Manufacturer</th><th>IPN</th>
                        <th style={{textAlign:'right'}}>Qty</th>
                        <th style={{textAlign:'right'}}>Quote Price</th>
                        <th style={{textAlign:'right'}}>Tax %</th>
                        <th style={{textAlign:'right'}}>Tax Amt</th>
                        <th style={{textAlign:'right'}}>Line Total</th>
                        <th>Delivery Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((li,i)=>{
                        const base = (li.quantity||0)*(li.quote_price||0);
                        const tax  = base*((li.tax_rate||0)/100);
                        return (
                          <tr key={li.id}>
                            <td>{i+1}</td>
                            <td style={{fontWeight:600}}>{li.component}</td>
                            <td>{li.manufacturer||'—'}</td>
                            <td className="mono" style={{fontSize:11}}>{li.ipn||'—'}</td>
                            <td style={{textAlign:'right',fontWeight:600}}>{fmt(li.quantity)}</td>
                            <td style={{textAlign:'right',fontFamily:'monospace'}}>
                              {li.quote_price ? fmtM(li.quote_price, li.quote_currency) : <span style={{color:'var(--text3)'}}>—</span>}
                            </td>
                            <td style={{textAlign:'right'}}>{li.tax_rate||0}%</td>
                            <td style={{textAlign:'right',fontFamily:'monospace'}}>{li.quote_price ? fmtM(tax, li.quote_currency) : '—'}</td>
                            <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700}}>{li.quote_price ? fmtM(base+tax, li.quote_currency) : '—'}</td>
                            <td style={{fontSize:11,color:'var(--text3)'}}>{li.preferred_delivery_date||'—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:'2px solid var(--border)',background:'var(--accent-lt)'}}>
                        <td colSpan={8} style={{padding:'8px',fontWeight:700,textAlign:'right',color:'var(--accent)'}}>Grand Total (incl. tax)</td>
                        <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'var(--accent)',fontFamily:'monospace',fontSize:14}}>
                          {fmtM(totalVal)}
                        </td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>

                  {/* Customer response summary if recorded */}
                  {quote.customer_response && (
                    <div style={{marginTop:14,padding:'10px 14px',borderRadius:'var(--r)',
                      background: quote.customer_response==='accepted' ? 'var(--green-lt)' : quote.customer_response==='rejected' ? 'var(--red-lt,#fef2f2)' : 'var(--amber-lt,#fffbeb)',
                      border:`1px solid ${quote.customer_response==='accepted'?'var(--green)':quote.customer_response==='rejected'?'var(--red)':'var(--amber,#d97706)'}33`,
                      fontSize:12}}>
                      <span style={{fontWeight:700}}>Customer Response: </span>
                      <span style={{textTransform:'capitalize',fontWeight:600}}>{quote.customer_response}</span>
                      {quote.customer_response_date && <span style={{color:'var(--text3)',marginLeft:8}}>on {fmtDate(quote.customer_response_date)}</span>}
                      {quote.customer_response_notes && <span style={{color:'var(--text2)',marginLeft:8}}>— {quote.customer_response_notes}</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tab: Details ── */}
          {tab==='details' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Zoho Quote Reference</label>
                <input className="input" value={zohoRef} onChange={e=>setZohoRef(e.target.value)}
                  placeholder="e.g. QT-2026-00123"/>
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Valid Until</label>
                <input className="input" type="date" value={validUntil} onChange={e=>setValid(e.target.value)}/>
              </div>
              <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
                <label className="label">Notes / Pricing Summary</label>
                <textarea className="input" rows={4} value={quote.notes||''} readOnly
                  style={{resize:'none',color:'var(--text2)',fontSize:12}}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSaveDetails}>
                  Save Details
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: Customer Response ── */}
          {tab==='response' && (
            <div style={{display:'grid',gap:14}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Customer Response</label>
                <div style={{display:'flex',gap:16,marginTop:6,flexWrap:'wrap'}}>
                  {['accepted','negotiating','rejected','no_response'].map(r=>(
                    <label key={r} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      <input type="radio" name="cust_resp" checked={custResp===r} onChange={()=>setCustResp(r)}
                        style={{accentColor: r==='accepted'?'var(--green)':r==='rejected'?'var(--red)':'var(--accent)'}}/>
                      <span style={{textTransform:'capitalize'}}>{r.replace('_',' ')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Response Date</label>
                  <input className="input" type="date" value={custRespDate} onChange={e=>setCustRespDate(e.target.value)}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Notes</label>
                  <input className="input" value={custRespNote} onChange={e=>setCustRespNote(e.target.value)}
                    placeholder="e.g. Customer wants ₹1,350/unit, delivery by May"/>
                </div>
              </div>
              <div>
                <button className="btn btn-primary btn-sm" onClick={handleCustResponse} disabled={mutation.isPending}>
                  Save Response
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: Send to Revision ── */}
          {tab==='revise' && (
            <div>
              {!canRevise ? (
                <div style={{color:'var(--text3)',fontSize:13}}>
                  {isOrdered ? '✅ Order already created from this quote.' : 'This quote cannot be sent for revision in its current status.'}
                </div>
              ) : (
                <div style={{display:'grid',gap:14}}>
                  <div style={{padding:'12px 14px',borderRadius:'var(--r)',background:'var(--amber-lt,#fffbeb)',
                    border:'1px solid var(--amber,#d97706)33',fontSize:12,color:'var(--amber,#d97706)',fontWeight:600}}>
                    ⚠ This will send the quote back to Sourcing for re-pricing. The quote status will change to "Returned to Sourcing".
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">Revision Notes for Sourcing <span style={{color:'var(--red)'}}>*</span></label>
                    <textarea className="input" rows={3} value={revNote} onChange={e=>setRevNote(e.target.value)}
                      placeholder="e.g. Customer wants better pricing on STM32. Target: ₹1,350/unit. Competitor quote attached."/>
                  </div>
                  <div>
                    <button className="btn btn-sm" style={{background:'var(--amber,#d97706)',color:'#fff',borderColor:'var(--amber,#d97706)'}}
                      disabled={reviseMutation.isPending||!revNote.trim()} onClick={handleRevise}>
                      {reviseMutation.isPending ? 'Sending…' : '↩ Send Back to Sourcing'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn" onClick={onClose}>Close</button>
          <div style={{display:'flex',gap:8}}>
            {/* CHANGE: button always visible when quote is active — disabled until customer approves */}
            {isActive && lineItems.length > 0 && (
              <button className="btn btn-primary" onClick={handleCreateOrder}
                disabled={!canOrder}
                title={!canOrder ? 'Go to the Customer Response tab and save \'Accepted\' first' : ''}
                style={{
                  background: canOrder ? 'var(--green)' : 'var(--surface2)',
                  borderColor: canOrder ? 'var(--green)' : 'var(--border)',
                  color: canOrder ? '#fff' : 'var(--text3)',
                  fontWeight:700,
                  cursor: canOrder ? 'pointer' : 'not-allowed',
                  opacity: canOrder ? 1 : 0.7,
                }}>
                {canOrder ? '✅ Create Order from Quote' : '🔒 Awaiting Customer Approval'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main QuotesPage ───────────────────────────────────────────────────────────
export default function QuotesPage() {
  const { user }   = useAuth();
  const qc         = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  const { data: quotes=[], isLoading } = useQuery({ queryKey:['quotes'],    queryFn:()=>api.get('/quotes').then(r=>r.data),    refetchInterval:20000 });
  const { data: customers=[] }         = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: enquiries=[] }         = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data).catch(()=>[]) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;

  // Stats
  const active   = quotes.filter(q=>q.status==='active').length;
  const returned = quotes.filter(q=>q.status==='returned_to_sourcing').length;
  const ordered  = quotes.filter(q=>q.status==='order_created').length;
  const responded = quotes.filter(q=>q.customer_response && q.customer_response!=='no_response').length;

  const filtered = useMemo(() => {
    let list = quotes;
    if (filter !== 'all') list = list.filter(q => q.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(qt =>
        qt.quote_no.toLowerCase().includes(q) ||
        custName(qt.customer_id).toLowerCase().includes(q) ||
        (qt.zoho_quote_no||'').toLowerCase().includes(q) ||
        (qt.enquiry_id||'').toLowerCase().includes(q) ||
        (qt.notes||'').toLowerCase().includes(q)
      );
    }
    if (dateFrom) list = list.filter(q => q.created_at >= dateFrom);
    if (dateTo)   list = list.filter(q => q.created_at <= dateTo + 'T23:59');
    return list;
  }, [quotes, filter, search, dateFrom, dateTo, customers]);

  const STATUS_FILTERS = [
    { v:'all',                   l:`All (${quotes.length})` },
    { v:'active',                l:`Active (${active})` },
    { v:'returned_to_sourcing',  l:`Returned to Sourcing (${returned})` },
    { v:'order_created',         l:`Order Created (${ordered})` },
    { v:'superseded',            l:`Superseded (${quotes.filter(q=>q.status==='superseded').length})` },
  ];

  const RESP_COLOR = { accepted:'var(--green)', rejected:'var(--red)', negotiating:'var(--amber,#d97706)', no_response:'var(--text3)' };

  return (
    <div>
      {/* ── Stat cards ── */}
      <div className="stats-grid" style={{marginBottom:20}}>
        {[
          { label:'Active Quotes',      val:active,    color:'var(--accent)' },
          { label:'Returned to Sourcing', val:returned, color:'var(--amber,#d97706)' },
          { label:'Orders Created',     val:ordered,   color:'var(--green)' },
          { label:'Customer Responded', val:responded, color:'var(--teal,#0d9488)' },
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{fontSize:24,color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* ── Search + date filter ── */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search by quote no, customer, Zoho ref, ENQ…"
            value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <label style={{fontSize:12,color:'var(--text3)',display:'flex',alignItems:'center',gap:6}}>
          From <input type="date" className="input" style={{width:140}} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
        </label>
        <label style={{fontSize:12,color:'var(--text3)',display:'flex',alignItems:'center',gap:6}}>
          To <input type="date" className="input" style={{width:140}} value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
        </label>
      </div>

      {/* ── Tabs ── */}
<div className="tabs-container">
  {STATUS_FILTERS.map(f => (
    <button
      key={f.v}
      className={`tab ${filter === f.v ? 'active' : ''}`}
      onClick={() => setFilter(f.v)}
    >
      {f.l}
    </button>
  ))}
</div>

      {/* ── Table ── */}
      {isLoading ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>Loading quotes…</div>
      ) : filtered.length === 0 ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
          <div style={{fontSize:32,marginBottom:8}}>📋</div>
          <div>No quotes found</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>QUOTE NO.</th>
              <th>ENQ NO.</th>
              <th>CUSTOMER</th>
              <th>ZOHO REF</th>
              <th>REVISION</th>
              <th>CUSTOMER RESPONSE</th>
              <th>VALID UNTIL</th>
              <th>STATUS</th>
              <th>CREATED</th>
              <th style={{textAlign:'right'}}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(q => (
              <tr key={q.id} onClick={()=>setSelected(q)} style={{cursor:'pointer'}}
                className="hover-row">
                <td>
                  <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{q.quote_no}</span>
                  {q.revision > 1 && <span style={{fontSize:10,color:'var(--text3)',marginLeft:4}}>v{q.revision}</span>}
                </td>
                <td><span className="mono" style={{fontSize:12}}>{q.enquiry_id||'—'}</span></td>
                <td style={{fontWeight:500}}>{custName(q.customer_id)}</td>
                <td style={{fontSize:12,color:'var(--text2)'}}>{q.zoho_quote_no||'—'}</td>
                <td style={{textAlign:'center'}}>{q.revision > 1 ? <span style={{fontSize:11,padding:'1px 8px',borderRadius:999,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',fontWeight:700}}>Rev {q.revision}</span> : '—'}</td>
                <td>
                  {q.customer_response ? (
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:999,fontWeight:600,
                      color:RESP_COLOR[q.customer_response]||'var(--text3)',
                      background: q.customer_response==='accepted'?'var(--green-lt)':q.customer_response==='rejected'?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)'}}>
                      {q.customer_response.replace('_',' ')}
                    </span>
                  ) : <span style={{color:'var(--text3)',fontSize:12}}>—</span>}
                </td>
                <td style={{fontSize:12,color:q.valid_until&&new Date(q.valid_until)<new Date()?'var(--red)':'var(--text2)'}}>
                  {q.valid_until ? fmtDate(q.valid_until) : '—'}
                </td>
                <td><StatusBadge s={q.status}/></td>
                <td style={{fontSize:12,color:'var(--text3)'}}>{fmtDate(q.created_at)}</td>
                <td style={{textAlign:'right'}}>
                  <button className="btn btn-xs btn-primary" onClick={e=>{e.stopPropagation();setSelected(q);}}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Modal ── */}
      {selected && (
        <QuoteModal
          quote={selected}
          customers={customers}
          enquiries={enquiries}
          onClose={()=>setSelected(null)}
          onOrderCreated={()=>setSelected(null)}
        />
      )}
    </div>
  );
}
