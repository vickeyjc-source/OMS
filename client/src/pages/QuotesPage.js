// client/src/pages/QuotesPage.js
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge, DaysBadge, fmtDateTime } from '../utils/helpers';
import { printDoc, generateQuotePDF } from '../utils/pdfUtils';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STATUS_FILTERS = ['all', 'active', 'superseded', 'order_created', 'returned_to_sourcing', 'closed'];
const STATUS_PRIORITY = ['active', 'returned_to_sourcing', 'order_created', 'superseded', 'closed'];

function QuoteDetailModal({ quote, customers, enquiries, onClose, onRefresh }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Tab index: 0=Line Items, 1=Details, 2=Customer Response
  const [tabIdx, setTabIdx] = useState(0);
  // Details tab — editable fields
  const [zohoQuote,       setZohoQuote]       = useState(quote.zoho_quote_no || '');
  const [validUntil,      setValidUntil]       = useState(quote.valid_until   || '');
  const [sentToCustomer,  setSentToCustomer]   = useState(!!(quote.sent_to_customer));
  // Response tab — selected (pending) value; only saved on OK
  const [pendingResponse, setPendingResponse]  = useState('');
  // Init from saved notes so locked view shows them when modal is reopened
  const [responseNotes,   setResponseNotes]    = useState(quote.customer_response_notes || '');
  const [savedResponse,   setSavedResponse]    = useState(quote.customer_response || '');
  // Track whether details have been saved — Next → Customer Response only enabled after Save
  const [detailsSavedOnce, setDetailsSavedOnce] = useState(!!(quote.zoho_quote_no && quote.valid_until && quote.sent_to_customer));
  const [confirmRevision, setConfirmRevision] = useState(false);
  const [confirmCreateOrder, setConfirmCreateOrder] = useState(false);

  // Sync editable fields when parent passes updated quote data (after save+refresh)
  useEffect(() => {
    setZohoQuote(quote.zoho_quote_no || '');
    setValidUntil(quote.valid_until   || '');
    setSentToCustomer(!!(quote.sent_to_customer));
    setSavedResponse(quote.customer_response || '');
    setResponseNotes(quote.customer_response_notes || '');
    setDetailsSavedOnce(!!(quote.zoho_quote_no && quote.valid_until && quote.sent_to_customer));
  }, [quote.id, quote.zoho_quote_no, quote.valid_until, quote.sent_to_customer, quote.customer_response, quote.customer_response_notes]);

  // Linked enquiry — tells us if source is still re-pricing (returned_to_sourcing)
  const linkedEnq = (enquiries||[]).find(e => e.id === quote.enquiry_id) || null;
  const enquiryAwaitingRevision = linkedEnq?.status === 'returned_to_sourcing';

  // Parent quote — for showing previous customer response context in V2+
  const { data: allQuotes=[] } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => api.get('/quotes').then(r => r.data),
    staleTime: 30000,
  });
  const parentQuote = quote.parent_quote_id
    ? allQuotes.find(q => q.id === quote.parent_quote_id)
    : null;

  const custObj = customers.find(c => c.id === quote.customer_id);

  const { data: lineData } = useQuery({
    queryKey: ['quote-lines', quote.id],
    queryFn: () => api.get('/quotes/' + quote.id + '/lineitems').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: d => api.put('/quotes/' + quote.id, d).then(r => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries(['quotes']);
      onRefresh();
      toast.success('Saved');
      // Mark details as saved when zoho_quote_no is part of the payload (Details tab save)
      if (vars.zoho_quote_no !== undefined) setDetailsSavedOnce(true);
    },
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
      const lineItems = items.map((li, i) => ({
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
        line_status:      savedResponse === 'accepted' ? 'confirmed' : 'negotiating',
        tax_rate:         Number(li.tax_rate) || 0,
      }));

      if (quote.existing_order_id) {
        // Revision flow — update the existing order's line items and quote reference
        const existingOrder = await api.get('/orders/' + quote.existing_order_id).then(r => r.data).catch(() => null);
        navigate('/orders/new', { state: { prefill: {
          customer_id:      quote.customer_id,
          enquiry_id:       quote.enquiry_id || '',
          enquiry_no:       quote.enquiry_id || '',
          quote_id:         quote.id,
          quote_no:         quote.quote_no,
          // Pre-fill existing order fields
          existing_order_id: quote.existing_order_id,
          po_number:         existingOrder?.po_number || '',
          delivery_address:  existingOrder?.delivery_address || '',
          tentative_date:    existingOrder?.tentative_date || '',
          notes:             existingOrder?.notes || '',
          customer_ref:      existingOrder?.customer_ref || '',
          lineItems,
        }}});
      } else {
        navigate('/orders/new', { state: { prefill: {
          customer_id:  quote.customer_id,
          enquiry_id:   quote.enquiry_id || '',
          enquiry_no:   quote.enquiry_id || '',
          quote_id:     quote.id,
          quote_no:     quote.quote_no,
          lineItems,
        }}});
      }
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  // Cannot create order if sourcing is still re-pricing (ENQ in returned_to_sourcing)
  const canCreateOrder = savedResponse === 'accepted' && quote.status === 'active' && !enquiryAwaitingRevision;

  const items = lineData?.items || [];

  // Tab order: items → details → response
  const tabs = [
    { k: 'items',    l: '📦 Line Items' },
    { k: 'details',  l: '📋 Details' },
    { k: 'response', l: '💬 Customer Response' },
  ];

  const detailsAllFilled = quote.status === 'active' && !!zohoQuote.trim() && !!validUntil &&
    (savedResponse === 'negotiating' || sentToCustomer);

  // Confirm → save details → create order
  const handleCreateOrder = () => setConfirmCreateOrder(true);
  const doCreateOrder = () => {
    setConfirmCreateOrder(false);
    saveMutation.mutate(
      { zoho_quote_no: zohoQuote.trim(), valid_until: validUntil, sent_to_customer: 1 },
      { onSuccess: () => createOrderMutation.mutate() }
    );
  };

  // Auto-save response (Customer Response is last tab — no advance needed)
  const handleNextFromResponse = () => {
    if (!pendingResponse) { toast.error('Please select a customer response'); return; }
    if (['negotiating', 'rejected'].includes(pendingResponse) && !responseNotes.trim()) {
      toast.error(`Notes are required when response is "${pendingResponse === 'negotiating' ? 'Negotiating' : 'Rejected'}"`);
      return;
    }
    if (pendingResponse === savedResponse) { toast.success('Response already saved'); return; }
    saveMutation.mutate(
      { customer_response: pendingResponse, customer_response_notes: responseNotes },
      { onSuccess: () => { setSavedResponse(pendingResponse); toast.success('Response saved'); } }
    );
  };


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
            <button className="btn btn-xs" style={{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600,fontSize:12,padding:'4px 12px'}}
              onClick={()=>printDoc(generateQuotePDF(quote, custObj))}>⬇ Download PDF</button>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Tab step indicators — NOT clickable; use Next/Back buttons to navigate */}
        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',padding:'0 20px'}}>
          {tabs.map((t, i) => (
            <div key={t.k}
              style={{padding:'10px 16px',border:'none',background:'transparent',
                fontSize:13,fontWeight:tabIdx===i?700:400,
                borderBottom:tabIdx===i?'2px solid var(--accent)':'2px solid transparent',
                color:tabIdx===i?'var(--accent)':i<tabIdx?'var(--green)':'var(--text3)',
                display:'flex',alignItems:'center',gap:5,cursor:'default',userSelect:'none'}}>
              {i < tabIdx && <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                <path d="M1 5L4.5 8.5L11 1" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>}
              {t.l}
            </div>
          ))}
        </div>

        <div className="modal-body">

          {/* Tab 0: Line Items */}
          {tabIdx === 0 && (
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
                        <th style={{color:'var(--teal,#0d9488)'}}>Del. Date</th>
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
                              <td style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:600,whiteSpace:'nowrap'}}>
                                {li.preferred_delivery_date ? `📅 ${li.preferred_delivery_date}` : <span style={{color:'var(--text3)'}}>—</span>}
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

          {/* Tab 1: Details */}
          {tabIdx === 1 && (
            <div>
              {/* ── Sent-to-revision lock banner ── */}
              {enquiryAwaitingRevision && (
                <div style={{marginBottom:16,padding:'12px 16px',borderRadius:10,
                  border:'2px solid var(--amber,#d97706)',background:'var(--amber-lt,#fffbeb)',
                  display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:20}}>⏳</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)'}}>
                      Sent to Revision — View Only
                    </div>
                    <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>
                      This quote is being re-priced by Sourcing. Details cannot be edited until Sourcing returns the updated quote.
                    </div>
                  </div>
                </div>
              )}
              {/* Read-only info strip */}
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16,padding:'10px 14px',
                background:'var(--surface2)',borderRadius:8,fontSize:12}}>
                {[
                  {l:'Quote No.',  v:quote.quote_no,      mono:true},
                  {l:'Status',     v:quote.status?.replace(/_/g,' ')},
                  {l:'Revision',   v:quote.revision||1},
                  {l:'Enquiry',    v:quote.enquiry_id||'—', mono:true},
                  {l:'Created',    v:fmtDateTime(quote.created_at)},
                  {l:'Last Updated', v:fmtDateTime(quote.updated_at||quote.created_at)||'—'},
                ].map(f=>(
                  <div key={f.l} style={{minWidth:100}}>
                    <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:2}}>{f.l.toUpperCase()}</div>
                    <div style={{fontWeight:600,fontFamily:f.mono?'monospace':'inherit',color:'var(--text)'}}>{f.v}</div>
                  </div>
                ))}
              </div>
              {/* Editable fields — locked while awaiting revision */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:14}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Zoho Quote No. <span className="req">*</span></label>
                  <input className="input" value={zohoQuote}
                    onChange={e => setZohoQuote(e.target.value)}
                    placeholder="e.g. ZQ-2024-001"
                    disabled={quote.status !== 'active' || enquiryAwaitingRevision}
                    style={{fontFamily:'monospace',outline:(!zohoQuote.trim()&&!enquiryAwaitingRevision)?'1.5px solid var(--red)':'',opacity:(quote.status!=='active'||enquiryAwaitingRevision)?0.6:1}}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Valid Until (Delivery) <span className="req">*</span></label>
                  <input className="input" type="date" value={validUntil}
                    onChange={e => setValidUntil(e.target.value)}
                    disabled={quote.status !== 'active' || enquiryAwaitingRevision}
                    style={{outline:(!validUntil&&!enquiryAwaitingRevision)?'1.5px solid var(--red)':'',opacity:(quote.status!=='active'||enquiryAwaitingRevision)?0.6:1}}/>
                </div>
              </div>
              {/* Sent to customer tick — hidden while awaiting revision */}
              {savedResponse !== 'negotiating' && !enquiryAwaitingRevision && (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:8,letterSpacing:.5}}>
                  SEND TO CUSTOMER <span style={{color:'var(--red)',marginLeft:2}}>*</span>
                </div>
                <label style={{display:'inline-flex',alignItems:'center',gap:10,cursor:'pointer',
                  padding:'10px 16px',borderRadius:8,
                  border:`1.5px solid ${sentToCustomer?'var(--green)':'var(--red)'}`,
                  background:sentToCustomer?'var(--green-lt)':'var(--red-lt,#fff5f5)',
                  transition:'all .15s'}}>
                  <span style={{width:20,height:20,borderRadius:5,flexShrink:0,display:'flex',
                    alignItems:'center',justifyContent:'center',
                    border:`2px solid ${sentToCustomer?'var(--green)':'var(--red)'}`,
                    background:sentToCustomer?'var(--green)':'transparent',transition:'all .15s'}}>
                    {sentToCustomer && <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
                  </span>
                  <input type="checkbox" checked={sentToCustomer} onChange={e=>setSentToCustomer(e.target.checked)}
                    style={{position:'absolute',opacity:0,width:0,height:0}}/>
                  <span style={{fontSize:13,fontWeight:sentToCustomer?600:400,
                    color:sentToCustomer?'var(--green)':'var(--red)'}}>
                    {sentToCustomer ? '✓ Sent to customer' : 'Mark as sent to customer (required)'}
                  </span>
                </label>
                {!sentToCustomer && (
                  <div style={{marginTop:6,fontSize:11,color:'var(--red)',fontWeight:500}}>
                    This field is mandatory before saving details.
                  </div>
                )}
              </div>
              )}
              {quote.notes && (
                <div style={{padding:'10px 14px',background:'var(--surface2)',borderRadius:8,fontSize:12,marginBottom:14}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:4}}>NOTES</div>
                  <div style={{whiteSpace:'pre-wrap',color:'var(--text)'}}>{quote.notes}</div>
                </div>
              )}
              {quote.status !== 'active' && !enquiryAwaitingRevision && (
                <div style={{marginTop:10,fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>
                  Only active quotes can be updated.
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Customer Response */}
          {tabIdx === 2 && (
            <div>
              {/* ── Sourcing re-pricing warning — blocks all response actions ── */}
              {enquiryAwaitingRevision && (
                <div style={{marginBottom:16,padding:'14px 16px',borderRadius:10,
                  border:'2px solid var(--amber,#d97706)',background:'var(--amber-lt,#fffbeb)',
                  display:'flex',alignItems:'flex-start',gap:12}}>
                  <span style={{fontSize:22,flexShrink:0}}>⏳</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)',marginBottom:4}}>
                      Waiting for Sourcing to re-price
                    </div>
                    <div style={{fontSize:12,color:'var(--text2)'}}>
                      This quote has been sent back to Sourcing for revised pricing.
                      Customer response and order creation are disabled until Sourcing returns the updated quote.
                    </div>
                  </div>
                </div>
              )}
              {/* ── Previous response context (shown in V2+ when response not yet saved) ── */}
              {!savedResponse && parentQuote?.customer_response && (
                <div style={{marginBottom:14,padding:'10px 14px',borderRadius:8,
                  background:'var(--surface2)',border:'1px solid var(--border)',
                  display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:13}}>📋</span>
                  <div style={{fontSize:12,color:'var(--text2)'}}>
                    <span style={{fontWeight:700,color:'var(--text3)',marginRight:4}}>Previous response (V{(quote.revision||1)-1}):</span>
                    <span style={{fontWeight:600,
                      color:parentQuote.customer_response==='accepted'?'var(--green)':parentQuote.customer_response==='rejected'?'var(--red)':'var(--amber,#d97706)'}}>
                      {parentQuote.customer_response === 'accepted' ? '✓ Accepted' : parentQuote.customer_response === 'rejected' ? '✗ Rejected' : '⟳ Negotiating'}
                    </span>
                    {parentQuote.customer_response_notes && (
                      <span style={{color:'var(--text3)',marginLeft:6,fontSize:11}}>— {parentQuote.customer_response_notes}</span>
                    )}
                  </div>
                </div>
              )}
              {/* ── LOCKED view once saved ── */}
              {savedResponse ? (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18}}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="var(--text3)" strokeWidth="1.5"/>
                      <path d="M4.5 6V4a2.5 2.5 0 0 1 5 0v2" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span style={{fontSize:11,color:'var(--text3)',fontWeight:600,letterSpacing:.4}}>RESPONSE LOCKED — CANNOT BE MODIFIED</span>
                  </div>
                  {/* Saved response badge */}
                  <div style={{marginBottom:18,padding:'12px 18px',borderRadius:10,fontSize:14,fontWeight:700,
                    display:'inline-flex',alignItems:'center',gap:10,
                    background:savedResponse==='accepted'?'var(--green-lt)':savedResponse==='rejected'?'var(--red-lt,#fef2f2)':'var(--amber-lt,#fffbeb)',
                    border:`1.5px solid ${savedResponse==='accepted'?'var(--green)':savedResponse==='rejected'?'var(--red)':'var(--amber,#d97706)'}`,
                    color:savedResponse==='accepted'?'var(--green)':savedResponse==='rejected'?'var(--red)':'var(--amber,#d97706)'}}>
                    {savedResponse==='accepted' ? '✓ Accepted' : savedResponse==='rejected' ? '✗ Rejected' : '⟳ Negotiating'}
                  </div>
                  {/* Saved notes read-only */}
                  {responseNotes && (
                    <div style={{padding:'10px 14px',background:'var(--surface2)',borderRadius:8,fontSize:13}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',marginBottom:4}}>NOTES</div>
                      <div style={{whiteSpace:'pre-wrap',color:'var(--text)'}}>{responseNotes}</div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Editable view — choose response (starts blank each time modal opens) ── */
                <div style={{opacity: enquiryAwaitingRevision ? 0.4 : 1, pointerEvents: enquiryAwaitingRevision ? 'none' : 'auto'}}>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:10,letterSpacing:.5}}>
                      SELECT CUSTOMER RESPONSE <span style={{color:'var(--red)',marginLeft:2}}>*</span>
                    </div>
                    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                      {[
                        {val:'accepted',    label:'Accepted',    color:'var(--green)'},
                        {val:'rejected',    label:'Rejected',    color:'var(--red)'},
                        {val:'negotiating', label:'Negotiating', color:'var(--amber,#d97706)'},
                      ].map(opt => {
                        const isSelected = pendingResponse === opt.val;
                        const isDisabled = !!pendingResponse && !isSelected;
                        return (
                          <button key={opt.val}
                            disabled={isDisabled}
                            onClick={() => setPendingResponse(isSelected ? '' : opt.val)}
                            style={{display:'inline-flex',alignItems:'center',gap:8,cursor:isDisabled?'not-allowed':'pointer',
                              padding:'10px 18px',borderRadius:8,border:'none',
                              outline:`1.5px solid ${isSelected?opt.color:'var(--border)'}`,
                              background:isSelected?opt.color+'22':isDisabled?'var(--surface2)':'var(--surface2)',
                              opacity:isDisabled?0.45:1,
                              transition:'all .15s'}}>
                            <span style={{width:19,height:19,borderRadius:4,flexShrink:0,
                              border:`2px solid ${isSelected?opt.color:'var(--border)'}`,
                              background:isSelected?opt.color:'transparent',
                              display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s'}}>
                              {isSelected && <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>}
                            </span>
                            <span style={{fontSize:13,fontWeight:isSelected?700:400,
                              color:isSelected?opt.color:'var(--text2)',
                              textDecoration:isDisabled?'line-through':'none'}}>
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!pendingResponse && (
                      <div style={{marginTop:8,fontSize:11,color:'var(--red)',fontWeight:500}}>
                        Please select a response before proceeding.
                      </div>
                    )}
                  </div>
                  <div className="form-group" style={{marginBottom:12}}>
                    <label className="label">
                      Notes
                      {['negotiating','rejected'].includes(pendingResponse) && (
                        <span className="req" style={{marginLeft:4}}>* Required</span>
                      )}
                    </label>
                    <textarea className="input" rows={3} value={responseNotes}
                      onChange={e => setResponseNotes(e.target.value)}
                      placeholder={['negotiating','rejected'].includes(pendingResponse) ? 'Required — explain customer feedback or reason for rejection…' : 'Customer feedback, conditions, etc.'}
                      style={{outline: ['negotiating','rejected'].includes(pendingResponse) && !responseNotes.trim() ? '1.5px solid var(--red)' : ''}}/>
                    {['negotiating','rejected'].includes(pendingResponse) && !responseNotes.trim() && (
                      <div style={{marginTop:4,fontSize:11,color:'var(--red)',fontWeight:500}}>
                        Notes are required for {pendingResponse === 'negotiating' ? 'Negotiating' : 'Rejected'} response.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Unified bottom nav bar — shown on ALL tabs ── */}
          <div style={{marginTop:20,paddingTop:14,borderTop:'1px solid var(--border)',
            display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>

            {/* Left: Back */}
            {tabIdx > 0 && (
              <button className="btn" onClick={() => setTabIdx(t => t - 1)} style={{fontWeight:500}}>← Back</button>
            )}

            {/* Centre: action buttons */}

            {/* Details tab (tab 1) — Save Details + Send to Revision */}
            {tabIdx === 1 && !canCreateOrder && detailsAllFilled && !enquiryAwaitingRevision && (
              <button className="btn btn-primary"
                disabled={saveMutation.isPending}
                style={{fontWeight:600}}
                onClick={() => saveMutation.mutate(
                  { zoho_quote_no: zohoQuote.trim(), valid_until: validUntil, sent_to_customer: 1 },
                  { onSuccess: () => toast.success('Details saved') }
                )}>
                {saveMutation.isPending ? 'Saving…' : 'Save Details'}
              </button>
            )}
            {tabIdx === 1 && quote.status === 'active' && savedResponse === 'negotiating' && !enquiryAwaitingRevision && (
              <button className="btn"
                style={{background:'var(--amber,#d97706)',color:'#fff',
                  borderColor:'var(--amber,#d97706)',fontWeight:600}}
                disabled={reviseMutation.isPending}
                onClick={() => setConfirmRevision(true)}>
                {reviseMutation.isPending ? 'Sending…' : '↩ Send to Revision'}
              </button>
            )}

            {/* Customer Response tab (tab 2) — Create Order button appears after response saved */}
            {tabIdx === 2 && canCreateOrder && (
              <button className="btn btn-primary"
                style={{background:'var(--green)',borderColor:'var(--green)',fontWeight:700}}
                disabled={saveMutation.isPending || createOrderMutation.isPending}
                onClick={handleCreateOrder}>
                {(saveMutation.isPending || createOrderMutation.isPending) ? 'Processing…' : '➕ Create Order from Quote'}
              </button>
            )}

            {/* Spacer */}
            <span style={{flex:1}}/>

            {/* Right: Close + Next */}
            <button className="btn" onClick={onClose} style={{fontWeight:500}}>✕ Close</button>
            {tabIdx === 0 && (
              <button className="btn btn-primary" onClick={() => setTabIdx(1)} style={{fontWeight:600}}>
                Next → Details
              </button>
            )}
            {tabIdx === 1 && (
              <button className="btn btn-primary"
                disabled={!detailsSavedOnce || enquiryAwaitingRevision}
                title={enquiryAwaitingRevision ? 'Waiting for Sourcing to return revised quote' : !detailsSavedOnce ? 'Save Details first before proceeding' : ''}
                onClick={() => setTabIdx(2)}
                style={{fontWeight:600, opacity: (detailsSavedOnce && !enquiryAwaitingRevision) ? 1 : 0.45, cursor: (detailsSavedOnce && !enquiryAwaitingRevision) ? 'pointer' : 'not-allowed'}}>
                Next → Customer Response
              </button>
            )}
            {tabIdx === 2 && (
              savedResponse
                ? (!canCreateOrder &&
                    <button className="btn btn-primary" onClick={onClose} style={{fontWeight:600,background:'var(--green)',borderColor:'var(--green)'}}>
                      ✓ Done
                    </button>
                  )
                : (() => {
                    const notesRequired = ['negotiating','rejected'].includes(pendingResponse) && !responseNotes.trim();
                    const btnDisabled = !pendingResponse || saveMutation.isPending || enquiryAwaitingRevision || notesRequired;
                    return (
                      <button className="btn btn-primary"
                        disabled={btnDisabled}
                        title={notesRequired ? 'Notes are required for this response' : ''}
                        style={{opacity: btnDisabled ? 0.45 : 1, fontWeight:600}}
                        onClick={handleNextFromResponse}>
                        {saveMutation.isPending ? 'Saving…' : 'Save Response'}
                      </button>
                    );
                  })()
            )}
          </div>

        </div>
      </div>

      {/* Create Order confirm modal */}
      {confirmCreateOrder && (
        <div className="overlay" style={{zIndex:600}} onClick={() => setConfirmCreateOrder(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()} style={{maxWidth:420}}>
            <div className="modal-header">
              <h2 style={{fontSize:16}}>Create Order</h2>
              <button className="close-x" onClick={() => setConfirmCreateOrder(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{fontSize:13, color:'var(--text2)', lineHeight:1.6}}>
                Are you sure you want to create an order from this quote? This will save the details and open the new order form.
              </div>
            </div>
            <div className="modal-footer" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn" onClick={() => setConfirmCreateOrder(false)}>Cancel</button>
              <button className="btn btn-primary"
                style={{fontWeight:700}}
                onClick={doCreateOrder}>
                Create Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send to Revision confirm modal */}
      {confirmRevision && (
        <div className="overlay" style={{zIndex:600}} onClick={() => setConfirmRevision(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()} style={{maxWidth:420}}>
            <div className="modal-header">
              <h2 style={{fontSize:16}}>Send to Revision</h2>
              <button className="close-x" onClick={() => setConfirmRevision(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{fontSize:13, color:'var(--text2)', lineHeight:1.6}}>
                Send this quote back to Sourcing for re-pricing? The current quote will be superseded and a new revision created.
              </div>
            </div>
            <div className="modal-footer" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn" onClick={() => setConfirmRevision(false)}>Cancel</button>
              <button className="btn"
                disabled={reviseMutation.isPending}
                style={{background:'var(--amber,#d97706)', borderColor:'var(--amber,#d97706)', color:'#fff', fontWeight:700}}
                onClick={() => { setConfirmRevision(false); reviseMutation.mutate(); }}>
                {reviseMutation.isPending ? 'Sending…' : '↩ Send to Revision'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function QuotesPage() {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();
  const [seenQuotes, setSeenQuotes] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('seen_quotes')||'[]')); } catch(_) { return new Set(); }
  });
  const markSeen = (id) => {
    setSeenQuotes(prev => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem('seen_quotes', JSON.stringify([...next]));
      window.dispatchEvent(new Event('seen-updated'));
      return next;
    });
  };

  const { data: quotes=[], refetch }   = useQuery({ queryKey:['quotes'],    queryFn:()=>api.get('/quotes').then(r=>r.data) });
  const { data: customers=[] }         = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: enquiries=[] }         = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data).catch(()=>[]), staleTime:60000 });

  const custName = id => customers.find(c => c.id === id)?.name || id;

  // Group all quotes by enquiry_id — show one row per enquiry (the current/latest quote)
  const enquiryGroups = useMemo(() => {
    const groups = {};
    quotes.forEach(q => {
      const key = q.enquiry_id || String(q.id);
      if (!groups[key]) groups[key] = [];
      groups[key].push(q);
    });
    return Object.values(groups).map(group => {
      let primary = null;
      for (const status of STATUS_PRIORITY) {
        const byStatus = group.filter(q => q.status === status);
        if (byStatus.length > 0) {
          // Among same-priority status, pick the highest revision
          primary = byStatus.sort((a, b) => (b.revision||1) - (a.revision||1))[0];
          break;
        }
      }
      if (!primary) primary = group[0];
      return { ...primary, _totalVersions: group.length };
    });
  }, [quotes]);

  const filtered = enquiryGroups.filter(q => {
    const matchFilter = filter === 'all' || q.status === filter;
    const s = search.toLowerCase();
    const matchSearch = !search
      || q.quote_no.toLowerCase().includes(s)
      || custName(q.customer_id).toLowerCase().includes(s)
      || (q.enquiry_id||'').toLowerCase().includes(s);
    return matchFilter && matchSearch;
  }).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

  const counts = {
    all:                   enquiryGroups.length,
    active:                enquiryGroups.filter(q=>q.status==='active').length,
    superseded:            enquiryGroups.filter(q=>q.status==='superseded').length,
    order_created:         enquiryGroups.filter(q=>q.status==='order_created').length,
    returned_to_sourcing:  enquiryGroups.filter(q=>q.status==='returned_to_sourcing').length,
    closed:                enquiryGroups.filter(q=>q.status==='closed').length,
  };

  const filterLabels = {
    all:                  `All (${counts.all})`,
    active:               `Active (${counts.active})`,
    superseded:           `Superseded (${counts.superseded})`,
    order_created:        `Order Created (${counts.order_created})`,
    returned_to_sourcing: `Sent to Revision (${counts.returned_to_sourcing})`,
    closed:               `Closed (${counts.closed})`,
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
                <th>Valid Until</th><th>Created</th><th style={{textAlign:'center'}}>Days in Stage</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(q => {
                  const isUnseen = q.status === 'active' && !seenQuotes.has(q.id);
                  return (
                  <tr key={q.id} style={{cursor:'pointer',background:isUnseen?'var(--accent-lt)':undefined}} onClick={() => { setSelected(q); markSeen(q.id); }}>
                    <td className="mono bold" style={{color:'var(--accent)'}}>
                      {isUnseen && <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:'var(--accent)',marginRight:5,verticalAlign:'middle'}}/>}
                      {q.quote_no}</td>
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
                        : q.sent_to_customer
                          ? <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,fontWeight:600,
                              background:'var(--accent-lt)',color:'var(--accent)',border:'1px solid var(--accent)'}}>
                              ⏳ Awaiting confirmation
                            </span>
                          : <span style={{color:'var(--text3)',fontSize:11}}>—</span>}
                    </td>
                    <td style={{textAlign:'center'}}>
                      {q.revision||1}
                      {q._totalVersions > 1 && (
                        <span style={{fontSize:10,color:'var(--text3)',marginLeft:5,fontWeight:400}}>
                          ({q._totalVersions} ver.)
                        </span>
                      )}
                    </td>
                    <td style={{fontSize:12,color:'var(--text2)'}}>{q.valid_until||'—'}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{fmtDateTime(q.created_at)}</td>
                    <td><DaysBadge updatedAt={q.updated_at||q.created_at} /></td>
                    <td style={{textAlign:'right'}}>
                      <button className="btn btn-xs btn-primary" onClick={e=>{e.stopPropagation();setSelected(q);markSeen(q.id);}}>
                        View
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      }

      {selected && (
        <QuoteDetailModal
          quote={selected}
          customers={customers}
          enquiries={enquiries}
          onClose={() => setSelected(null)}
          onRefresh={async () => { const res = await refetch(); setSelected(q => (res.data||[]).find(x=>x.id===q?.id)||null); }}
        />
      )}
    </div>
  );
}
