// client/src/pages/QuotesPage.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge } from '../utils/helpers';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STATUS_FILTERS = ['all', 'active', 'superseded', 'order_created', 'returned_to_sourcing'];

function QuoteDetailModal({ quote, customers, onClose, onRefresh }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('items');
  // Details tab — editable fields
  const [zohoQuote,       setZohoQuote]       = useState(quote.zoho_quote_no || '');
  const [validUntil,      setValidUntil]       = useState(quote.valid_until   || '');
  const [sentToCustomer,  setSentToCustomer]   = useState(!!(quote.sent_to_customer));
  // Response tab — tick state
  const [respAccepted,    setRespAccepted]     = useState(quote.customer_response === 'accepted');
  const [respRejected,    setRespRejected]     = useState(quote.customer_response === 'rejected');
  const [respNegotiating, setRespNegotiating]  = useState(quote.customer_response === 'negotiating');
  const [responseNotes,   setResponseNotes]    = useState(quote.customer_response_notes || '');
  const [savedResponse,   setSavedResponse]    = useState(quote.customer_response || '');

  const custObj = customers.find(c => c.id === quote.customer_id);

  const { data: lineData } = useQuery({
    queryKey: ['quote-lines', quote.id],
    queryFn: () => api.get('/quotes/' + quote.id + '/lineitems').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: d => api.put('/quotes/' + quote.id, d).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['quotes']); onRefresh(); toast.success('Saved'); },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const reviseMutation = useMutation({
    mutationFn: () => api.post('/quotes/' + quote.id + '/revise', {
      sales_revision_notes: responseNotes || '',
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries(['quotes']);
      toast.success('Sent to revision — Sourcing will re-price');
      onRefresh();
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error || 'Revision failed'),
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get('/quotes/' + quote.id + '/lineitems');
      const { items } = res.data;
      navigate('/orders/new', { state: { prefill: {
        customer_id:  quote.customer_id,
        enquiry_id:   quote.enquiry_id || '',
        enquiry_no:   quote.enquiry_id || '',
        quote_id:     quote.id,
        quote_no:     quote.quote_no,
        lineItems:    items.map((li, i) => ({
          id:               'li' + i + Date.now(),
          component:        li.component    || '',
          manufacturer:     li.manufacturer || '',
          ipn:              li.ipn          || '',
          qty:              String(li.quantity || ''),
          unit_price:       li.quote_price  != null ? String(li.quote_price) : '',
          quoted_price:     li.quote_price  != null ? String(li.quote_price) : '',
          target_price:     li.target_price != null ? String(li.target_price) : '',
          procurement_price:li.sourced_price!= null ? String(li.sourced_price) : '',
          currency:         li.quote_currency || li.target_currency || 'INR',
          order_date:       new Date().toISOString().slice(0,10),
          delivery_date:    li.preferred_delivery_date || '',
          line_status:      'negotiating',
          tax_rate:         Number(li.tax_rate) || 0,
        })),
      }}});
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const items = lineData?.items || [];

  const tabs = [
    { k: 'items',    l: '📦 Line Items' },
    { k: 'details',  l: '📋 Details' },
    { k: 'response', l: '💬 Customer Response' },
  ];

  const responseValue  = respAccepted ? 'accepted' : respRejected ? 'rejected' : respNegotiating ? 'negotiating' : '';
  const canCreateOrder = savedResponse === 'accepted' && quote.status === 'active';

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:1110,width:'94vw'}}>
        <div className="modal-header" style={{padding:'12px 18px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontFamily:'monospace',fontWeight:700,fontSize:15,color:'var(--accent)'}}>{quote.quote_no}</span>
            {quote.revision > 1 && <span style={{fontSize:11,padding:'1px 7px',borderRadius:99,background:'var(--accent-lt)',color:'var(--accent)',fontWeight:600}}>Rev {quote.revision}</span>}
            <StatusBadge s={quote.status}/>
            {sentToCustomer && <span style={{fontSize:11,padding:'1px 8px',borderRadius:99,background:'var(--green-lt)',color:'var(--green)',fontWeight:600}}>✓ Sent to customer</span>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'var(--text2)'}}>{custObj?.name || quote.customer_id}</span>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',padding:'0 20px'}}>
          {tabs.map(t => (
            <button key={t.k} onClick={() => setActiveTab(t.k)}
              style={{padding:'10px 16px',border:'none',background:'transparent',cursor:'pointer',
                fontSize:13,fontWeight:activeTab===t.k?700:400,
                borderBottom:activeTab===t.k?'2px solid var(--accent)':'2px solid transparent',
                color:activeTab===t.k?'var(--accent)':'var(--text2)'}}>
              {t.l}
            </button>
          ))}
        </div>

        <div className="modal-body">

          {/* Tab: Line Items */}
          {activeTab === 'items' && (
            <div>
              {items.length === 0
                ? <div style={{padding:30,textAlign:'center',color:'var(--text3)'}}>Loading items…</div>
                : <div style={{overflowX:'auto'}}>
                    <table className="table">
                      <thead><tr>
                        <th style={{fontSize:11}}>#</th>
                        <th>Component</th>
                        <th>Manufacturer</th>
                        <th>IPN</th>
                        <th style={{textAlign:'right',color:'var(--amber,#d97706)'}}>Target Price</th>
                        <th style={{textAlign:'right'}}>Qty</th>
                        <th style={{textAlign:'right'}}>Quote Price</th>
                        <th style={{textAlign:'right'}}>Tax %</th>
                        <th style={{textAlign:'right'}}>Base Value</th>
                        <th style={{textAlign:'right',color:'var(--green)'}}>Total</th>
                      </tr></thead>
                      <tbody>
                        {items.map((li, i) => {
                          const base = (li.quantity||0) * (li.quote_price||0);
                          const tax  = Number(li.tax_rate)||0;
                          const tot  = base + base*tax/100;
                          return (
                            <tr key={li.id||i}>
                              <td style={{color:'var(--text3)',fontSize:11,textAlign:'center'}}>{i+1}</td>
                              <td style={{fontWeight:600}}>{li.component}</td>
                              <td style={{fontSize:12,color:'var(--text2)'}}>{li.manufacturer||'—'}</td>
                              <td style={{fontFamily:'monospace',fontSize:11,color:'var(--text3)'}}>{li.ipn||'—'}</td>
                              <td style={{textAlign:'right',color:'var(--amber,#d97706)',fontFamily:'monospace'}}>
                                {li.target_price ? fmtCur(li.target_price, li.target_currency) : '—'}
                              </td>
                              <td style={{textAlign:'right',fontWeight:500}}>{fmt(li.quantity)}</td>
                              <td style={{textAlign:'right',fontWeight:700,fontFamily:'monospace'}}>
                                {li.quote_price ? fmtCur(li.quote_price, li.quote_currency) : '—'}
                              </td>
                              <td style={{textAlign:'right',color:tax>0?'var(--teal,#0d9488)':'var(--text3)',fontWeight:tax>0?600:400}}>{tax}%</td>
                              <td style={{textAlign:'right',fontWeight:600,color:'var(--text)',fontFamily:'monospace'}}>
                                {base ? fmtCur(base, li.quote_currency) : '—'}
                              </td>
                              <td style={{textAlign:'right',fontWeight:700,color:tax>0?'var(--green)':'var(--text)',fontFamily:'monospace'}}>
                                {base ? fmtCur(tot, li.quote_currency) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              }
            </div>
          )}

          {/* Tab: Details */}
          {activeTab === 'details' && (
            <div>
              {/* Read-only info strip */}
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16,padding:'10px 14px',
                background:'var(--surface2)',borderRadius:8,fontSize:12}}>
                {[
                  {l:'Quote No.',  v:quote.quote_no,      mono:true},
                  {l:'Status',     v:quote.status?.replace(/_/g,' ')},
                  {l:'Revision',   v:quote.revision||1},
                  {l:'Enquiry',    v:quote.enquiry_id||'—', mono:true},
                  {l:'Created',    v:(quote.created_at||'').slice(0,10)},
                ].map(f=>(
                  <div key={f.l} style={{minWidth:100}}>
                    <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>{f.l.toUpperCase()}</div>
                    <div style={{fontWeight:600,fontFamily:f.mono?'monospace':'inherit',color:'var(--text)'}}>{f.v}</div>
                  </div>
                ))}
              </div>
              {/* Editable fields */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:14}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Zoho Quote No. <span className="req">*</span></label>
                  <input className="input" value={zohoQuote}
                    onChange={e => setZohoQuote(e.target.value)}
                    placeholder="e.g. ZQ-2024-001"
                    style={{fontFamily:'monospace'}}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Valid Until</label>
                  <input className="input" type="date" value={validUntil}
                    onChange={e => setValidUntil(e.target.value)}/>
                </div>
              </div>
              {/* Sent to customer tick */}
              <div style={{marginBottom:16}}>
                <label style={{display:'inline-flex',alignItems:'center',gap:10,cursor:'pointer',
                  padding:'10px 16px',borderRadius:8,
                  border:`1.5px solid ${sentToCustomer?'var(--green)':'var(--border)'}`,
                  background:sentToCustomer?'var(--green-lt)':'var(--surface2)',
                  transition:'all .15s'}}>
                  <span style={{width:20,height:20,borderRadius:5,flexShrink:0,display:'flex',
                    alignItems:'center',justifyContent:'center',
                    border:`2px solid ${sentToCustomer?'var(--green)':'var(--border)'}`,
                    background:sentToCustomer?'var(--green)':'transparent',transition:'all .15s'}}>
                    {sentToCustomer && <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
                  </span>
                  <input type="checkbox" checked={sentToCustomer} onChange={e=>setSentToCustomer(e.target.checked)}
                    style={{position:'absolute',opacity:0,width:0,height:0}}/>
                  <span style={{fontSize:13,fontWeight:sentToCustomer?600:400,
                    color:sentToCustomer?'var(--green)':'var(--text2)'}}>
                    Sent to customer
                  </span>
                </label>
              </div>
              {quote.notes && (
                <div style={{padding:'10px 14px',background:'var(--surface2)',borderRadius:8,fontSize:12}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:4}}>NOTES</div>
                  <div style={{whiteSpace:'pre-wrap',color:'var(--text)'}}>{quote.notes}</div>
                </div>
              )}
              <div style={{marginTop:14,display:'flex',gap:8}}>
                {/* CHANGE: Save Details only active when quote is active + both fields filled */}
                <button className="btn btn-primary"
                  disabled={quote.status !== 'active' || !zohoQuote.trim() || !validUntil}
                  style={{opacity:(quote.status !== 'active' || !zohoQuote.trim() || !validUntil)?0.45:1}}
                  onClick={() => {
                    if (quote.status !== 'active') { toast.error('Quote must be active to save details'); return; }
                    if (!zohoQuote.trim()) { toast.error('Zoho Quote No. is required'); return; }
                    if (!validUntil)       { toast.error('Valid Until date is required'); return; }
                    saveMutation.mutate({
                      zoho_quote_no:    zohoQuote.trim(),
                      valid_until:      validUntil,
                      sent_to_customer: sentToCustomer ? 1 : 0,
                    }, { onSuccess: () => toast.success('Details saved') });
                  }}>
                  Save Details
                </button>
                {quote.status !== 'active' && (
                  <span style={{fontSize:11,color:'var(--text3)',alignSelf:'center'}}>
                    Only active quotes can be updated
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tab: Customer Response */}
          {activeTab === 'response' && (
            <div>
              {savedResponse && (
                <div style={{marginBottom:16,padding:'10px 14px',borderRadius:8,fontSize:13,fontWeight:600,
                  background:savedResponse==='accepted'?'var(--green-lt)':savedResponse==='rejected'?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)',
                  color:savedResponse==='accepted'?'var(--green)':savedResponse==='rejected'?'var(--red)':'var(--amber,#d97706)'}}>
                  {savedResponse==='accepted'?'✓ Customer accepted':savedResponse==='rejected'?'✗ Customer rejected':'Negotiating'}
                </div>
              )}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:10,letterSpacing:.5}}>CUSTOMER RESPONSE</div>
                <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                  {[
                    {val:'accepted',    label:'Accepted',    color:'var(--green)', state:respAccepted},
                    {val:'rejected',    label:'Rejected',    color:'var(--red)',   state:respRejected},
                    {val:'negotiating', label:'Negotiating', color:'var(--amber,#d97706)', state:respNegotiating},
                  ].map(opt => (
                    <label key={opt.val} style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',
                      padding:'9px 16px',borderRadius:8,
                      border:`1.5px solid ${opt.state?opt.color:'var(--border)'}`,
                      background:opt.state?opt.color+'18':'var(--surface2)',
                      transition:'all .15s'}}>
                      <span style={{width:18,height:18,borderRadius:4,flexShrink:0,
                        border:`2px solid ${opt.state?opt.color:'var(--border)'}`,
                        background:opt.state?opt.color:'transparent',
                        display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s'}}>
                        {opt.state && <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>}
                      </span>
                      <input type="checkbox" checked={opt.state}
                        onChange={() => {
                          setRespAccepted(opt.val==='accepted'?!opt.state:false);
                          setRespRejected(opt.val==='rejected'?!opt.state:false);
                          setRespNegotiating(opt.val==='negotiating'?!opt.state:false);
                        }}
                        style={{position:'absolute',opacity:0,width:0,height:0}}/>
                      <span style={{fontSize:13,fontWeight:opt.state?600:400,color:opt.state?opt.color:'var(--text2)'}}>
                        {opt.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="label">Notes</label>
                <textarea className="input" rows={3} value={responseNotes}
                  onChange={e => setResponseNotes(e.target.value)}
                  placeholder="Customer feedback, conditions, etc."/>
              </div>
              <button className="btn btn-primary" style={{marginTop:8}}
                onClick={() => {
                  saveMutation.mutate({ customer_response: responseValue, customer_response_notes: responseNotes },
                    { onSuccess: () => { toast.success('Response saved'); setSavedResponse(responseValue); }});
                }}>
                Save Response
              </button>
            </div>
          )}

        </div>

        <div className="modal-footer">
          {canCreateOrder && (
            <button className="btn btn-primary"
              style={{background:'var(--green)',borderColor:'var(--green)',fontWeight:700}}
              onClick={() => createOrderMutation.mutate()}>
              ➕ Create Order from Quote
            </button>
          )}
          {/* ADDED: Send to Revision — shown when active + customer rejected or negotiating */}
          {quote.status === 'active' && (respRejected || respNegotiating) && (
            <button className="btn"
              style={{background:'var(--amber,#d97706)',color:'#fff',
                borderColor:'var(--amber,#d97706)',fontWeight:600}}
              disabled={reviseMutation.isPending}
              onClick={() => {
                if (!window.confirm('Send this quote back to Sourcing for re-pricing? The current quote will be superseded and a new revision created.')) return;
                reviseMutation.mutate();
              }}>
              {reviseMutation.isPending ? 'Sending…' : '↩ Send to Revision'}
            </button>
          )}
          {!canCreateOrder && quote.status === 'active' && savedResponse !== 'accepted' && !respRejected && !respNegotiating && (
            <span style={{fontSize:12,color:'var(--text3)'}}>Save customer acceptance to create order</span>
          )}
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function QuotesPage() {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: quotes=[], refetch }   = useQuery({ queryKey:['quotes'],    queryFn:()=>api.get('/quotes').then(r=>r.data) });
  const { data: customers=[] }         = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });

  const custName = id => customers.find(c => c.id === id)?.name || id;

  const filtered = quotes.filter(q => {
    const matchFilter = filter === 'all' || q.status === filter;
    const s = search.toLowerCase();
    const matchSearch = !search
      || q.quote_no.toLowerCase().includes(s)
      || custName(q.customer_id).toLowerCase().includes(s)
      || (q.enquiry_id||'').toLowerCase().includes(s);
    return matchFilter && matchSearch;
  });

  const counts = {
    all:                   quotes.length,
    active:                quotes.filter(q=>q.status==='active').length,
    superseded:            quotes.filter(q=>q.status==='superseded').length,
    order_created:         quotes.filter(q=>q.status==='order_created').length,
    returned_to_sourcing:  quotes.filter(q=>q.status==='returned_to_sourcing').length,
  };

  const filterLabels = {
    all:                  `All (${counts.all})`,
    active:               `Active (${counts.active})`,
    superseded:           `Superseded (${counts.superseded})`,
    order_created:        `Order Created (${counts.order_created})`,
    returned_to_sourcing: `Sent to Revision (${counts.returned_to_sourcing})`,
  };

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:13,marginBottom:18}}>
        {[
          {label:'Total Quotes',   val:counts.all,           color:'var(--accent)'},
          {label:'Active',         val:counts.active,         color:'var(--green)'},
          {label:'Order Created',  val:counts.order_created,  color:'var(--teal,#0d9488)'},
          {label:'In Revision',    val:counts.returned_to_sourcing, color:'var(--amber,#d97706)'},
        ].map(s => (
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search quote no., customer, enquiry…"
            value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <div className="filter-row" style={{marginBottom:0}}>
          {STATUS_FILTERS.map(f => (
            <span key={f} className={`fchip ${filter===f?'active':''}`} onClick={() => setFilter(f)}>
              {filterLabels[f]}
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0
        ? <div className="empty-state"><div className="empty-icon">📋</div>
            <div className="empty-state-text">{quotes.length===0?'No quotes yet — send an enquiry to sourcing first.':'No quotes match your filter.'}</div>
          </div>
        : <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Quote No.</th><th>Customer</th><th>Enquiry</th>
                <th>Status</th><th>Response</th><th>Revision</th>
                <th>Valid Until</th><th>Created</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(q => (
                  <tr key={q.id} style={{cursor:'pointer'}} onClick={() => setSelected(q)}>
                    <td className="mono bold" style={{color:'var(--accent)'}}>{q.quote_no}</td>
                    <td style={{fontWeight:500}}>{custName(q.customer_id)}</td>
                    <td className="mono" style={{fontSize:11,color:'var(--text3)'}}>{q.enquiry_id||'—'}</td>
                    <td><StatusBadge s={q.status}/></td>
                    <td>
                      {q.customer_response
                        ? <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,fontWeight:600,
                            background:q.customer_response==='accepted'?'var(--green-lt)':q.customer_response==='rejected'?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)',
                            color:q.customer_response==='accepted'?'var(--green)':q.customer_response==='rejected'?'var(--red)':'var(--amber,#d97706)'}}>
                            {q.customer_response}
                          </span>
                        : <span style={{color:'var(--text3)',fontSize:11}}>—</span>}
                    </td>
                    <td style={{textAlign:'center'}}>{q.revision||1}</td>
                    <td style={{fontSize:12,color:'var(--text2)'}}>{q.valid_until||'—'}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{(q.created_at||'').slice(0,10)}</td>
                    <td style={{textAlign:'right'}}>
                      <button className="btn btn-xs btn-primary" onClick={e=>{e.stopPropagation();setSelected(q)}}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }

      {selected && (
        <QuoteDetailModal
          quote={selected}
          customers={customers}
          onClose={() => setSelected(null)}
          onRefresh={() => { refetch(); setSelected(q => quotes.find(x=>x.id===q?.id)||null); }}
        />
      )}
    </div>
  );
}
