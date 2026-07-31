// client/src/pages/EnquiriesPage.js
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { StatusBadge, DaysBadge, fmtDateTime } from '../utils/helpers';
import { printDoc, generateEnquiryPDF } from '../utils/pdfUtils';
import MergeEnquiryModal, { MERGEABLE_ENQ_STATUSES } from '../components/MergeEnquiryModal';

function EnquiryDetailModal({ enq, onClose, customers, suppliers, linecards, users }) {
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || id;
  const lcName   = id => linecards.find(l => l.id === id)?.name || id;

  const hasSourcing = enq.sourcing && enq.sourcing.length > 0 && enq.sourcing.some(s => s.supplier_id || s.sourced_price || s.quote_price);
  const charges    = enq.charges || {};
  const hasCharges = (Number(charges.customs)||0)+(Number(charges.handling)||0)+(Number(charges.freight)||0)+(Number(charges.bank)||0) > 0;
  const fmtC = (n, c) => { const sym={INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'}; return `${sym[c]||(c+' ')}${parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`; };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>{enq.id} — {custName(enq.customer_id)}</h2>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:4}}>
              <span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,padding:'2px 8px',borderRadius:6,background:'var(--accent-lt)',color:'var(--accent)',border:'1px solid var(--accent)33'}}>ENQ: {enq.id}</span>
              {enq.sourcing_no && <><span style={{fontSize:11,color:'var(--text3)'}}>→</span><span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,padding:'2px 8px',borderRadius:6,background:'var(--surface2)',color:'var(--text2)',border:'1px solid var(--border)'}}>SRC: {enq.sourcing_no}</span></>}
            </div>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>
              Created {fmtDateTime(enq.created_at)} · Priority: <strong>{enq.priority}</strong>
              {enq.buying_type && <> · Type: <strong style={{color:'var(--accent)'}}>{enq.buying_type}</strong></>}
            </div>
          </div>
          <div className="flex gap-8"><StatusBadge s={enq.status} /><button className="close-x" onClick={onClose}>×</button></div>
        </div>
        <div className="modal-body">

          {/* Line Items */}
          <div className="card card-sm">
            <div className="card-title"><span>📋 Enquiry Items ({enq.items?.length || 0})</span></div>
            <div style={{overflowX:'auto'}}>
              <table className="li-table">
                <thead><tr><th>#</th><th>Component</th><th>IPN</th><th>Manufacturer</th><th>Line Card</th><th>Qty</th><th>Target Price</th><th>Pref. Delivery</th><th>Date Code</th></tr></thead>
                <tbody>
                  {enq.items?.map((li, i) => (
                    <tr key={li.id}>
                      <td>{i+1}</td><td className="bold">{li.component}</td>
                      <td className="mono">{li.ipn||'—'}</td><td>{li.manufacturer||'—'}</td>
                      <td>{li.linecard_id ? lcName(li.linecard_id) : '—'}</td>
                      <td>{li.quantity}</td>
                      <td className="mono">{li.target_price ? `${li.target_currency} ${li.target_price}` : '—'}</td>
                      <td>{li.preferred_delivery_date||'—'}</td>
                      <td>{li.date_code||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sourcing Updates — read-only, always visible once past new/draft */}
          {!['new','draft'].includes(enq.status) && (
            <div className="card card-sm">
              <div className="card-title">
                <span>🔍 Sourcing Updates</span>
                <span style={{fontSize:11,color:'var(--text3)',fontWeight:400,marginLeft:8}}>Read-only · Edit from Sourcing Bin</span>
              </div>

              {!hasSourcing ? (
                <div style={{padding:'24px 0',textAlign:'center',color:'var(--text3)',fontSize:12}}>
                  <div style={{fontSize:28,marginBottom:8}}>🔍</div>
                  <div style={{fontWeight:600,marginBottom:4}}>No sourcing data yet</div>
                  <div>Sourcing team hasn't filled details for this enquiry yet.</div>
                </div>
              ) : (
                <>
                  <div style={{overflowX:'auto'}}>
                    <table className="li-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Component</th>
                          <th>Manufacturer</th>
                          <th>Supplier</th>
                          <th>Src Price</th>
                          <th>Lead Time</th>
                          <th>Quote Price</th>
                          <th>GST / VAT</th>
                          <th>Quote Total</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enq.items?.map((item, i) => {
                          const src = enq.sourcing?.find(s => s.enquiry_item_id === item.id);
                          const qty = Number(item.quantity) || 0;
                          const qp  = Number(src?.quote_price) || 0;
                          const qTotal = qp * qty;
                          return (
                            <tr key={item.id}>
                              <td>{i+1}</td>
                              <td className="bold">{item.component}</td>
                              <td>{item.manufacturer||'—'}</td>
                              <td>{src?.supplier_id ? supName(src.supplier_id) : <span className="muted">—</span>}</td>
                              <td className="mono">
                                {src?.sourced_price
                                  ? <span style={{color:'var(--accent)',fontWeight:600}}>{fmtC(src.sourced_price, src.sourced_currency||'USD')}</span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td>
                                {src?.lead_time
                                  ? <span style={{fontWeight:600}}>{src.lead_time}</span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td className="mono">
                                {src?.quote_price
                                  ? <span style={{color:'var(--green)',fontWeight:700}}>{fmtC(src.quote_price, src.quote_currency||'INR')}</span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td>
                                {src?.tax_rate != null && src.tax_rate !== ''
                                  ? <span className="badge badge-gray">{src.tax_rate}%</span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td className="mono">
                                {qTotal > 0
                                  ? <span style={{fontWeight:700}}>{fmtC(qTotal, src?.quote_currency||'INR')}</span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td style={{color:'var(--text2)',fontSize:11}}>{src?.notes||'—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Additional Charges */}
                  {hasCharges && (
                    <div style={{marginTop:12,padding:'10px 14px',background:'var(--surface2)',
                      borderRadius:'var(--r-sm)',border:'1px solid var(--border)',fontSize:12}}>
                      <div style={{fontWeight:700,color:'var(--text)',marginBottom:6}}>🧾 Additional Charges</div>
                      <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                        {charges.customs   > 0 && <span><span style={{color:'var(--text3)'}}>Customs:</span> <strong>{fmtC(charges.customs,   charges.currency||'INR')}</strong></span>}
                        {charges.handling  > 0 && <span><span style={{color:'var(--text3)'}}>Handling:</span> <strong>{fmtC(charges.handling,  charges.currency||'INR')}</strong></span>}
                        {charges.freight   > 0 && <span><span style={{color:'var(--text3)'}}>Freight:</span> <strong>{fmtC(charges.freight,   charges.currency||'INR')}</strong></span>}
                        {charges.bank      > 0 && <span><span style={{color:'var(--text3)'}}>Bank:</span> <strong>{fmtC(charges.bank,      charges.currency||'INR')}</strong></span>}
                        {charges.notes        && <span style={{color:'var(--text2)',fontStyle:'italic'}}>📝 {charges.notes}</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* History — expandable accordion */}
          <div className="card card-sm" style={{marginBottom:0}}>
            <div
              className="card-title"
              onClick={() => setHistoryOpen(o => !o)}
              style={{cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:0}}
            >
              <span>🕐 History</span>
              <span style={{
                fontSize:13,
                display:'inline-block',
                transform: historyOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition:'transform 0.2s'
              }}>▼</span>
            </div>
            {historyOpen && (
              <div style={{maxHeight:260,overflowY:'auto',marginTop:10}}>
                <div className="timeline">
                  {enq.history?.length ? enq.history.map((h,i)=>(
                    <div key={h.id} className="tl-row">
                      <div className="tl-dot-wrap"><div className={`tl-dot ${i===0?'td-active':'td-done'}`}><div className="tl-dot-inner"/></div></div>
                      <div className="tl-content"><div className="tl-title">{h.action}</div><div className="tl-sub">by {h.by_user}</div><div className="tl-ts">{h.ts}</div></div>
                    </div>
                  )) : (
                    <div style={{padding:'16px 0',textAlign:'center',color:'var(--text3)',fontSize:12}}>No history yet</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{justifyContent:'flex-end'}}>
          <button className="btn" style={{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}
            onClick={()=>printDoc(generateEnquiryPDF(enq, customers.find(c=>c.id===enq.customer_id)))}>⬇ Download PDF</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// An enquiry can be picked for merging only while it's still pre-Quote and
// hasn't already been merged into (or out of) something else.
const isMergeableEnq = e => !e.merged_into && MERGEABLE_ENQ_STATUSES.includes(e.status);

export default function EnquiriesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [mergeSelection, setMergeSelection] = useState([]); // 2+ enquiry ids, all same customer
  const [showMerge, setShowMerge] = useState(false);
  const { data: enqs=[] }       = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data) });
  const { data: customers=[] }  = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: users=[] }      = useQuery({ queryKey:['users'],     queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const FILTERS = ['all','draft','new','modify_requested','sourcing','quoted','ordered','closed'];
  const FILTER_LABELS = { modify_requested: 'Sent to Enquiry' };
  const filtered = enqs.filter(e => {
    if (filter!=='all' && e.status!==filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
  }).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

  const toggleMergeSelect = (id) => {
    setMergeSelection(sel => sel.includes(id) ? sel.filter(x=>x!==id) : [...sel, id]);
  };
  const selectedEnqs   = mergeSelection.map(id => enqs.find(e=>e.id===id)).filter(Boolean);
  const mergeCustomerId = selectedEnqs[0]?.customer_id || null;
  // Once one enquiry is picked, only same-customer checkboxes stay visible —
  // merging only ever makes sense within one customer's enquiries.
  const canShowCheckbox = e => isMergeableEnq(e) && (!mergeCustomerId || e.customer_id === mergeCustomerId);
  // Survivor is always the highest enquiry number among everything picked —
  // no manual choice, the rest all get absorbed into it in one go.
  const sortedSelected  = [...selectedEnqs].sort((a,b)=>b.id.localeCompare(a.id));
  const mergeEnq        = sortedSelected[0];
  const mergeOtherIds   = sortedSelected.slice(1).map(e=>e.id);

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search enquiries…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {mergeSelection.length > 0 && (
            <>
              <span style={{fontSize:12,color:'var(--text3)'}}>{mergeSelection.length} selected to merge</span>
              <button className="btn btn-sm" onClick={()=>setMergeSelection([])}>Clear</button>
              <button className="btn btn-sm btn-primary" disabled={mergeSelection.length<2}
                onClick={()=>setShowMerge(true)}>🔗 Merge Selected</button>
            </>
          )}
          <button className="btn btn-primary" onClick={()=>navigate('/enquiries/new')}>+ New Enquiry</button>
        </div>
      </div>
      <div className="filter-row">
        {FILTERS.map(f=><span key={f} className={`fchip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>{f==='all'?'All':(FILTER_LABELS[f]||f.charAt(0).toUpperCase()+f.slice(1))}</span>)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th style={{width:30}}></th><th>Enquiry ID</th><th>Customer</th><th>Items</th><th>Buying Type</th><th>Priority</th><th>Status</th><th style={{textAlign:'center'}}>Days in Stage</th><th>Assigned To</th><th>Created</th></tr></thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">📋</div><div>No enquiries found</div></div></td></tr>}
            {filtered.map(e=>{
              const showCheckbox = canShowCheckbox(e);
              const checked      = mergeSelection.includes(e.id);
              return (
              <tr key={e.id} className="clickable" onClick={()=>navigate('/enquiries/'+e.id)}>
                <td onClick={ev=>ev.stopPropagation()}>
                  {showCheckbox && (
                    <input type="checkbox" checked={checked} onChange={()=>toggleMergeSelect(e.id)}
                      title="Select for merge" style={{cursor:'pointer'}} />
                  )}
                </td>
                <td>
                  <span className="mono" style={{fontSize:12,color:'var(--text3)'}}>{e.id}</span>
                  {e.sourcing_no && (
                    <span style={{display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                      <span style={{fontSize:10,color:'var(--text3)'}}>→</span>
                      <span className="mono bold" style={{fontSize:12,color:'var(--accent)',
                        background:'var(--accent-lt)',padding:'1px 6px',borderRadius:999,
                        border:'1px solid var(--accent)33'}}>
                        {e.sourcing_no}
                      </span>
                    </span>
                  )}
                  {e.merged_into && (
                    <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>
                      🔗 merged with <span className="mono bold">{e.merged_into}</span>
                    </div>
                  )}
                </td>
                <td>{custName(e.customer_id)}</td>
                <td><span className="badge badge-blue">{e.items?.length||0}</span></td>
                <td>{e.buying_type ? <span className="badge badge-purple">{e.buying_type}</span> : <span className="muted">—</span>}</td>
                <td><span className={`badge ${e.priority==='urgent'?'badge-red':e.priority==='high'?'badge-amber':'badge-gray'}`}>{e.priority}</span></td>
                <td><StatusBadge s={e.status} /></td>
                <td><DaysBadge updatedAt={e.updated_at||e.created_at} /></td>
                <td>{e.assigned_to ? users.find(u=>u.id===e.assigned_to)?.name||'—' : <span className="muted">Unassigned</span>}</td>
                <td>{fmtDateTime(e.created_at)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showMerge && mergeEnq && mergeOtherIds.length > 0 && (
        <MergeEnquiryModal
          enq={mergeEnq}
          customers={customers}
          preselectedOtherIds={mergeOtherIds}
          onClose={()=>setShowMerge(false)}
          onMerged={()=>{ setShowMerge(false); setMergeSelection([]); }}
        />
      )}
    </div>
  );
}
