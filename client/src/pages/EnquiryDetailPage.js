// client/src/pages/EnquiryDetailPage.js
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { StatusBadge } from '../utils/helpers';
import { printDoc, generateEnquiryPDF } from '../utils/pdfUtils';
import toast from 'react-hot-toast';

export default function EnquiryDetailPage() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const submitToSourcing = async () => {
    if (!window.confirm('Submit this draft enquiry to Sourcing?')) return;
    setSubmitting(true);
    try {
      await api.put('/enquiries/' + id, { status: 'sourcing', _action: 'Submitted to Sourcing' });
      qc.invalidateQueries(['enquiry', id]);
      qc.invalidateQueries(['enquiries']);
      qc.invalidateQueries(['summary']);
      toast.success('✅ Enquiry submitted to Sourcing!');
      navigate('/sourcing-bin');
    } catch(e) {
      toast.error(e.response?.data?.error || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const { data: enq,       isLoading } = useQuery({ queryKey:['enquiry', id], queryFn:()=>api.get('/enquiries/'+id).then(r=>r.data) });
  const { data: customers=[] }         = useQuery({ queryKey:['customers'],   queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: suppliers=[] }         = useQuery({ queryKey:['suppliers'],   queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: linecards=[] }         = useQuery({ queryKey:['linecards'],   queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const { data: users=[] }             = useQuery({ queryKey:['users'],       queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName = cid => customers.find(c => c.id === cid)?.name || cid;
  const supName  = sid => suppliers.find(s => s.id === sid)?.name || sid;
  const lcName   = lid => linecards.find(l => l.id === lid)?.name || lid;

  const fmtC = (n, c) => {
    const sym = {INR:'₹',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AED:'د.إ'};
    return `${sym[c]||(c+' ')}${parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  };

  if (isLoading || !enq) {
    return (
      <div style={{padding:'48px 24px',textAlign:'center',color:'var(--text3)'}}>
        {isLoading ? 'Loading enquiry…' : 'Enquiry not found.'}
      </div>
    );
  }

  const hasSourcing = enq.sourcing && enq.sourcing.length > 0 && enq.sourcing.some(s => s.supplier_id || s.sourced_price || s.quote_price);
  const charges     = enq.charges || {};
  const hasCharges  = (Number(charges.customs)||0)+(Number(charges.handling)||0)+(Number(charges.freight)||0)+(Number(charges.bank)||0) > 0;
  const customer    = customers.find(c => c.id === enq.customer_id);

  return (
    <div style={{maxWidth:1400}}>

      {/* ── Page Header ── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button className="btn btn-sm" onClick={()=>navigate('/enquiries')}
            style={{fontSize:13,padding:'6px 14px'}}>
            ← Back to Enquiries
          </button>
          <div>
            <h1 style={{margin:0,fontSize:20,fontWeight:800,color:'var(--text)',lineHeight:1.2}}>
              {enq.id}
              {enq.sourcing_no && (
                <span className="mono" style={{
                  marginLeft:10,fontSize:13,color:'var(--accent)',
                  background:'var(--accent-lt)',padding:'2px 8px',
                  borderRadius:999,border:'1px solid var(--accent)33',fontWeight:600
                }}>
                  {enq.sourcing_no}
                </span>
              )}
            </h1>
            <div style={{fontSize:13,color:'var(--text3)',marginTop:3}}>
              <strong style={{color:'var(--text)'}}>{custName(enq.customer_id)}</strong>
              {' · '}Created {enq.created_at}
              {' · '}Priority: <strong>{enq.priority}</strong>
              {enq.buying_type && <> · Type: <strong style={{color:'var(--accent)'}}>{enq.buying_type}</strong></>}
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <StatusBadge s={enq.status} />
          <button className="btn btn-sm"
            onClick={()=>printDoc(generateEnquiryPDF(enq, customer))}
            style={{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600}}>
            ⬇ Download PDF
          </button>
        </div>
      </div>

      {/* ── Customer / Assigned Info Strip ── */}
      {customer && (
        <div style={{display:'flex',gap:20,flexWrap:'wrap',alignItems:'center',
          background:'var(--accent-lt)',border:'1px solid var(--accent)33',
          borderRadius:'var(--r-sm)',padding:'10px 16px',marginBottom:16,fontSize:13}}>
          <div>
            <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>CUSTOMER</span>
            <div style={{fontWeight:700,color:'var(--text)'}}>{customer.name}</div>
          </div>
          {customer.customer_no && (
            <div>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>CUST NO.</span>
              <div className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{customer.customer_no}</div>
            </div>
          )}
          {enq.buying_type && (
            <div>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>BUYING TYPE</span>
              <div><span className="badge badge-purple">{enq.buying_type}</span></div>
            </div>
          )}
          {enq.assigned_to && (
            <div>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>ASSIGNED TO</span>
              <div style={{fontWeight:600}}>{users.find(u=>u.id===enq.assigned_to)?.name||enq.assigned_to}</div>
            </div>
          )}
          {enq.notes && (
            <div style={{flex:'1 1 200px'}}>
              <span style={{fontSize:11,color:'var(--text3)',fontWeight:600}}>NOTES</span>
              <div style={{fontWeight:500,color:'var(--text2)',fontSize:12}}>{enq.notes}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Line Items ── */}
      <div className="card card-sm" style={{marginBottom:16}}>
        <div className="card-title"><span>📋 Enquiry Items ({enq.items?.length || 0})</span></div>
        <div style={{overflowX:'auto'}}>
          <table className="li-table">
            <thead>
              <tr>
                <th>#</th><th>Component</th><th>IPN</th><th>Manufacturer</th>
                <th>Line Card</th><th>Qty</th><th>Target Price</th>
                <th>Pref. Delivery</th><th>Date Code</th>
              </tr>
            </thead>
            <tbody>
              {enq.items?.length === 0 && (
                <tr><td colSpan={9} style={{textAlign:'center',color:'var(--text3)',padding:'24px',fontSize:13}}>No items</td></tr>
              )}
              {enq.items?.map((li, i) => (
                <tr key={li.id}>
                  <td>{i+1}</td>
                  <td className="bold">{li.component}</td>
                  <td className="mono">{li.ipn||'—'}</td>
                  <td>{li.manufacturer||'—'}</td>
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

      {/* ── Sourcing Updates — read-only, shown once past new/draft ── */}
      {!['new','draft'].includes(enq.status) && (
        <div className="card card-sm" style={{marginBottom:16}}>
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
                      <th>#</th><th>Component</th><th>Manufacturer</th><th>Supplier</th>
                      <th>Src Price</th><th>Lead Time</th><th>Quote Price</th>
                      <th>GST / VAT</th><th>Quote Total</th><th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enq.items?.map((item, i) => {
                      const src    = enq.sourcing?.find(s => s.enquiry_item_id === item.id);
                      const qty    = Number(item.quantity) || 0;
                      const qp     = Number(src?.quote_price) || 0;
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

      {/* ── History ── */}
      <div className="card card-sm">
        <div
          className="card-title"
          onClick={() => setHistoryOpen(o => !o)}
          style={{cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center',
            justifyContent:'space-between',marginBottom:0}}
        >
          <span>🕐 History</span>
          <span style={{
            fontSize:13, display:'inline-block',
            transform: historyOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition:'transform 0.2s'
          }}>▼</span>
        </div>
        {historyOpen && (
          <div style={{maxHeight:260,overflowY:'auto',marginTop:10}}>
            <div className="timeline">
              {enq.history?.length ? enq.history.map((h, i) => (
                <div key={h.id} className="tl-row">
                  <div className="tl-dot-wrap">
                    <div className={`tl-dot ${i===0?'td-active':'td-done'}`}>
                      <div className="tl-dot-inner"/>
                    </div>
                  </div>
                  <div className="tl-content">
                    <div className="tl-title">{h.action}</div>
                    <div className="tl-sub">by {h.by_user}</div>
                    <div className="tl-ts">{h.ts}</div>
                  </div>
                </div>
              )) : (
                <div style={{padding:'16px 0',textAlign:'center',color:'var(--text3)',fontSize:12}}>
                  No history yet
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modify Requested action bar — ENQ opened for editing by Order section ── */}
      {enq.status === 'modify_requested' && (
        <div style={{marginTop:20,padding:'16px 20px',borderRadius:'var(--r)',
          background:'var(--amber-lt,#fffbeb)',border:'2px solid var(--amber,#d97706)',
          display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>✏</span>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)'}}>Modification Requested from Order</div>
              <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Edit the enquiry items, then submit to Sourcing for re-pricing. Quote and Sourcing sections are locked until you submit.</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn"
              onClick={() => navigate('/enquiries/new', { state: { editEnquiry: enq } })}
              style={{fontWeight:600,fontSize:13}}>
              ✏ Edit Enquiry
            </button>
            <button className="btn btn-primary"
              disabled={submitting}
              onClick={submitToSourcing}
              style={{fontWeight:700,fontSize:13,background:'var(--amber,#d97706)',
                borderColor:'var(--amber,#d97706)',color:'#fff'}}>
              {submitting ? 'Submitting…' : '📤 Submit to Sourcing'}
            </button>
          </div>
        </div>
      )}

      {/* ── Draft action bar — only shown when ENQ is still a draft ── */}
      {enq.status === 'draft' && (
        <div style={{marginTop:20,padding:'16px 20px',borderRadius:'var(--r)',
          background:'var(--amber-lt,#fffbeb)',border:'2px solid var(--amber,#d97706)',
          display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>💾</span>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)'}}>This enquiry is saved as a Draft</div>
              <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Edit to add details, then submit to Sourcing when ready.</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn"
              onClick={() => navigate('/enquiries/new', { state: { editEnquiry: enq } })}
              style={{fontWeight:600,fontSize:13}}>
              ✏ Edit Draft
            </button>
            <button className="btn btn-primary"
              disabled={submitting}
              onClick={submitToSourcing}
              style={{fontWeight:700,fontSize:13,background:'var(--amber,#d97706)',
                borderColor:'var(--amber,#d97706)',color:'#fff'}}>
              {submitting ? 'Submitting…' : '📤 Submit to Sourcing'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
