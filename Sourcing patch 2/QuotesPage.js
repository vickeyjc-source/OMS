// client/src/pages/QuotesPage.js  v3
// Shows enquiries with status='quoted', with full sourcing + quote price details
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge } from '../utils/helpers';

const fmt  = n  => new Intl.NumberFormat('en-IN', { maximumFractionDigits:2 }).format(n || 0);
const fmtC = (n, c) => {
  const sym = { INR:'₹', USD:'$', EUR:'€', GBP:'£', SGD:'S$', AED:'د.إ', JPY:'¥', CNY:'¥', AUD:'A$', CAD:'C$' };
  return `${sym[c] || (c + ' ')}${fmt(n)}`;
};

// ── Quote Detail Modal — shows full sourcing+quote info ──────
function QuoteDetailModal({ enq, customers, suppliers, onClose }) {
  const qc = useQueryClient();
  const [zohоNo,  setZohoNo]   = useState(enq.zoho_quote_no  || '');
  const [fileRef,  setFileRef] = useState(enq.file_ref       || '');
  const [quoteNo,  setQuoteNo] = useState(enq.quote_no       || '');
  const [validUntil, setValid] = useState(enq.valid_until    || '');
  const [notes, setNotes]      = useState(enq.quote_notes    || '');
  const [saving, setSaving]    = useState(false);

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || '—';

  // Margin calculations
  const totalSrc   = (enq.sourcing||[]).reduce((sum, s) => {
    const item = (enq.items||[]).find(i => i.id === s.enquiry_item_id);
    return sum + (Number(s.sourced_price)||0) * (Number(item?.quantity)||0);
  }, 0);
  const totalQuote = (enq.sourcing||[]).reduce((sum, s) => {
    const item = (enq.items||[]).find(i => i.id === s.enquiry_item_id);
    return sum + (Number(s.quote_price)||0) * (Number(item?.quantity)||0);
  }, 0);
  const addlCost  = (Number(enq.charges?.customs)||0) + (Number(enq.charges?.handling)||0) + (Number(enq.charges?.freight)||0);
  const grossMargin = totalQuote - totalSrc;
  const netMargin   = totalQuote - totalSrc - addlCost;
  const grossPct    = totalSrc > 0 ? (grossMargin / totalSrc * 100) : 0;
  const netPct      = totalSrc > 0 ? (netMargin   / totalSrc * 100) : 0;

  const handleSaveZoho = async () => {
    setSaving(true);
    try {
      await api.put(`/enquiries/${enq.id}`, {
        zoho_quote_no: zohоNo,
        file_ref:      fileRef,
        quote_no:      quoteNo,
        valid_until:   validUntil,
        quote_notes:   notes,
        _action: 'Quote details updated'
      });
      qc.invalidateQueries(['enquiries']);
      toast.success('Quote details saved');
    } catch(e) {
      toast.error('Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>📄 Quote — {enq.id}</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
              {custName(enq.customer_id)} · Created {enq.created_at}
              {enq.quote_no && <span> · Quote No: <strong>{enq.quote_no}</strong></span>}
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status}/>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">
          {/* Zoho + Quote reference fields */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title">📎 Quote Reference Details</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:12 }}>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Internal Quote No.</label>
                <input className="input" value={quoteNo} onChange={e=>setQuoteNo(e.target.value)} placeholder="QT-001"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Zoho Quote No.</label>
                <input className="input" value={zohоNo} onChange={e=>setZohoNo(e.target.value)} placeholder="ZOHO-1234"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Quote File Reference</label>
                <input className="input" value={fileRef} onChange={e=>setFileRef(e.target.value)} placeholder="quote.pdf"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Valid Until</label>
                <input className="input" type="date" value={validUntil} onChange={e=>setValid(e.target.value)}/>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom:10 }}>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
            </div>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSaveZoho}>
              {saving ? 'Saving…' : 'Save Quote Details'}
            </button>
          </div>

          {/* Line items with sourcing + quote pricing */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title">📦 Line Items — Sourcing &amp; Quote Prices</div>
            <div style={{ overflowX:'auto' }}>
              <table className="li-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Component</th>
                    <th>Manufacturer</th>
                    <th>IPN</th>
                    <th>Qty</th>
                    <th>Target Price</th>
                    <th>Supplier</th>
                    <th style={{ background:'#e8f0fb' }}>Source Price</th>
                    <th style={{ background:'#e8f0fb' }}>Source Total</th>
                    <th style={{ background:'#e4f3ec' }}>Quote Price</th>
                    <th style={{ background:'#e4f3ec' }}>Quote Total</th>
                    <th>Availability</th>
                    <th>Lead Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(enq.items||[]).map((item, i) => {
                    const src = (enq.sourcing||[]).find(s => s.enquiry_item_id === item.id) || {};
                    const qty = Number(item.quantity) || 0;
                    const srcUnit   = Number(src.sourced_price) || 0;
                    const quoteUnit = Number(src.quote_price)   || 0;
                    const target    = Number(item.target_price) || 0;
                    const srcAbove   = target > 0 && srcUnit   > target;
                    const quoteAbove = target > 0 && quoteUnit > target;
                    return (
                      <tr key={item.id}>
                        <td>{i+1}</td>
                        <td className="bold">{item.component}</td>
                        <td>{item.manufacturer||'—'}</td>
                        <td className="mono" style={{ fontSize:10 }}>{item.ipn||'—'}</td>
                        <td>{qty}</td>
                        <td className="mono" style={{ fontSize:11 }}>{target ? `${item.target_currency} ${item.target_price}` : '—'}</td>
                        <td style={{ fontSize:11 }}>{src.supplier_id ? supName(src.supplier_id) : <span className="muted">—</span>}</td>
                        <td
                          className="mono"
                          style={{
                            background:'#f0f5ff', fontWeight:600,
                            color: srcAbove ? 'var(--red)' : 'var(--accent)',
                          }}
                        >
                          {srcUnit ? (
                            <span title={srcAbove ? 'Above target price' : ''}>
                              {srcAbove && '⚠ '}{fmtC(srcUnit, src.sourced_currency||'USD')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="mono" style={{ background:'#f0f5ff', fontSize:11, color:'var(--accent)' }}>
                          {srcUnit ? fmtC(srcUnit * qty, src.sourced_currency||'USD') : '—'}
                        </td>
                        <td
                          className="mono"
                          style={{
                            background:'#f0faf5', fontWeight:600,
                            color: quoteAbove ? 'var(--red)' : 'var(--green)',
                          }}
                        >
                          {quoteUnit ? (
                            <span title={quoteAbove ? 'Above target price' : ''}>
                              {quoteAbove && '⚠ '}{fmtC(quoteUnit, src.quote_currency||'INR')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="mono" style={{ background:'#f0faf5', fontSize:11, color:'var(--green)' }}>
                          {quoteUnit ? fmtC(quoteUnit * qty, src.quote_currency||'INR') : '—'}
                        </td>
                        <td style={{ fontSize:11 }}>{src.availability||'—'}</td>
                        <td style={{ fontSize:11 }}>{src.lead_time||'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Additional Charges */}
          {enq.charges && (Number(enq.charges.customs)||0 + Number(enq.charges.handling)||0 + Number(enq.charges.freight)||0) > 0 && (
            <div className="card card-sm" style={{ marginBottom:14 }}>
              <div className="card-title">🧾 Additional Charges</div>
              <div style={{ display:'flex', gap:20, fontSize:12 }}>
                {Number(enq.charges.customs)  > 0 && <div><span style={{ color:'var(--text2)' }}>Customs:</span> <strong>{fmtC(enq.charges.customs, enq.charges.currency)}</strong></div>}
                {Number(enq.charges.handling) > 0 && <div><span style={{ color:'var(--text2)' }}>Handling:</span> <strong>{fmtC(enq.charges.handling, enq.charges.currency)}</strong></div>}
                {Number(enq.charges.freight)  > 0 && <div><span style={{ color:'var(--text2)' }}>Freight:</span> <strong>{fmtC(enq.charges.freight, enq.charges.currency)}</strong></div>}
                <div><span style={{ color:'var(--text2)' }}>Total Addl.:</span> <strong>{fmtC(addlCost, enq.charges.currency)}</strong></div>
                {enq.charges.notes && <div style={{ color:'var(--text3)' }}>{enq.charges.notes}</div>}
              </div>
            </div>
          )}

          {/* Margin Summary */}
          <div className="card card-sm" style={{ border:'1px solid rgba(27,79,158,.15)' }}>
            <div className="card-title">📊 Margin Summary</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { label:'Total Source Value',    val:totalSrc,    color:'var(--accent)' },
                { label:'Total Quote Value',      val:totalQuote,  color:'var(--green)' },
                {
                  label:'Gross Margin',
                  val: grossMargin,
                  sub: `${grossPct >= 0 ? '+' : ''}${grossPct.toFixed(1)}% · Quote − Source`,
                  color: grossMargin >= 0 ? 'var(--green)' : 'var(--red)'
                },
                {
                  label:'Net Margin',
                  val: netMargin,
                  sub: `${netPct >= 0 ? '+' : ''}${netPct.toFixed(1)}% · After addl. costs ${fmtC(addlCost, enq.charges?.currency||'INR')}`,
                  color: netMargin >= 0 ? 'var(--teal)' : 'var(--red)'
                },
              ].map(s => (
                <div key={s.label} style={{ borderLeft:`3px solid ${s.color}`, padding:'10px 13px', background:'var(--surface2)', borderRadius:'var(--r)' }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4, fontWeight:500 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:s.color }}>{s.val ? fmtC(s.val, 'INR') : '—'}</div>
                  {s.sub && <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{s.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Quotes Page ──────────────────────────────────────────────
export default function QuotesPage() {
  const [selected, setSelected] = useState(null);
  const [search, setSearch]     = useState('');

  // Load quoted enquiries directly instead of a separate quotes table
  const { data: enquiries=[] } = useQuery({
    queryKey: ['enquiries'],
    queryFn:  () => api.get('/enquiries').then(r => r.data)
  });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: suppliers=[] } = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data) });

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || '—';

  // Quote bin = all enquiries with status = quoted
  const quoted = enquiries.filter(e => e.status === 'quoted').filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
  });

  const totalQuotedValue = quoted.reduce((sum, enq) => {
    return sum + (enq.sourcing||[]).reduce((s2, src) => {
      const item = (enq.items||[]).find(i => i.id === src.enquiry_item_id);
      return s2 + (Number(src.quote_price)||0) * (Number(item?.quantity)||0);
    }, 0);
  }, 0);

  return (
    <div>
      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:13, marginBottom:18 }}>
        <div className="stat-card" style={{ borderLeft:'3px solid var(--accent)' }}>
          <div className="stat-label">Quotes in Bin</div>
          <div className="stat-val">{quoted.length}</div>
          <div className="stat-sub">awaiting customer order</div>
        </div>
        <div className="stat-card" style={{ borderLeft:'3px solid var(--green)' }}>
          <div className="stat-label">Total Quoted Value (INR)</div>
          <div className="stat-val" style={{ color:'var(--green)', fontSize:20 }}>₹{fmt(totalQuotedValue)}</div>
          <div className="stat-sub">combined quote value</div>
        </div>
        <div className="stat-card" style={{ borderLeft:'3px solid var(--purple)' }}>
          <div className="stat-label">Ready for Ordering</div>
          <div className="stat-val" style={{ color:'var(--purple)' }}>{quoted.length}</div>
          <div className="stat-sub">create order when PO received</div>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
          </svg>
          <input className="search-input" placeholder="Search quote bin…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{ fontSize:12, color:'var(--text2)' }}>
          Enquiries move here automatically when sent from the Sourcing Bin
        </div>
      </div>

      {quoted.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <div className="empty-state-text">No quotes yet — send an enquiry from the Sourcing Bin to populate this view</div>
        </div>
      )}

      {/* Quote cards */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {quoted.map(enq => {
          const srcRows = enq.sourcing || [];
          const itemsWithSrc   = srcRows.filter(s => s.sourced_price).length;
          const itemsWithQuote = srcRows.filter(s => s.quote_price).length;
          const itemCount      = (enq.items||[]).length;

          const totalSrc   = srcRows.reduce((sum, s) => {
            const item = (enq.items||[]).find(i => i.id === s.enquiry_item_id);
            return sum + (Number(s.sourced_price)||0) * (Number(item?.quantity)||0);
          }, 0);
          const totalQuote = srcRows.reduce((sum, s) => {
            const item = (enq.items||[]).find(i => i.id === s.enquiry_item_id);
            return sum + (Number(s.quote_price)||0) * (Number(item?.quantity)||0);
          }, 0);
          const addlCost  = (Number(enq.charges?.customs)||0) + (Number(enq.charges?.handling)||0) + (Number(enq.charges?.freight)||0);
          const grossMgn  = totalQuote - totalSrc;
          const netMgn    = totalQuote - totalSrc - addlCost;
          const grossPct  = totalSrc > 0 ? (grossMgn / totalSrc * 100) : 0;
          const netPct    = totalSrc > 0 ? (netMgn   / totalSrc * 100) : 0;

          const hasAbove  = srcRows.some(s => {
            const item = (enq.items||[]).find(i => i.id === s.enquiry_item_id);
            const t = Number(item?.target_price)||0;
            return t > 0 && (Number(s.sourced_price) > t || Number(s.quote_price) > t);
          });

          return (
            <div key={enq.id} className="card" style={{ marginBottom:0 }}>
              {/* Header */}
              <div className="flex-between" style={{ marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <span className="mono bold" style={{ fontSize:14 }}>{enq.id}</span>
                  <StatusBadge s={enq.status}/>
                  {enq.quote_no && <span className="badge badge-blue" style={{ fontSize:10 }}>Quote: {enq.quote_no}</span>}
                  {enq.zoho_quote_no && <span className="badge badge-purple" style={{ fontSize:10 }}>Zoho: {enq.zoho_quote_no}</span>}
                  {hasAbove && <span className="badge badge-red" style={{ fontSize:10 }}>⚠ Price above target</span>}
                </div>
                <button className="btn btn-xs btn-primary" onClick={() => setSelected(enq)}>
                  View Details
                </button>
              </div>

              {/* Customer + counts */}
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>{custName(enq.customer_id)}</div>

              {/* Line items summary */}
              <div style={{ overflowX:'auto', marginBottom:12 }}>
                <table className="li-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Manufacturer</th>
                      <th>Qty</th>
                      <th>Target</th>
                      <th style={{ background:'#e8f0fb' }}>Source Price</th>
                      <th style={{ background:'#e4f3ec' }}>Quote Price</th>
                      <th>Supplier</th>
                      <th>Avail.</th>
                      <th>Lead Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(enq.items||[]).map(item => {
                      const s = srcRows.find(r => r.enquiry_item_id === item.id) || {};
                      const t = Number(item.target_price)||0;
                      const srcAbove   = t > 0 && Number(s.sourced_price) > t;
                      const quoteAbove = t > 0 && Number(s.quote_price)   > t;
                      return (
                        <tr key={item.id}>
                          <td className="bold">{item.component}</td>
                          <td>{item.manufacturer||'—'}</td>
                          <td>{item.quantity}</td>
                          <td className="mono" style={{ fontSize:11 }}>{t ? `${item.target_currency} ${item.target_price}` : '—'}</td>
                          <td style={{ background:'#f5f8ff', fontFamily:'monospace', fontWeight:600, color: srcAbove?'var(--red)':'var(--accent)', fontSize:11 }}>
                            {s.sourced_price ? `${srcAbove?'⚠ ':''}${fmtC(s.sourced_price, s.sourced_currency||'USD')}` : <span className="muted">—</span>}
                          </td>
                          <td style={{ background:'#f5fff8', fontFamily:'monospace', fontWeight:600, color: quoteAbove?'var(--red)':'var(--green)', fontSize:11 }}>
                            {s.quote_price ? `${quoteAbove?'⚠ ':''}${fmtC(s.quote_price, s.quote_currency||'INR')}` : <span className="muted">—</span>}
                          </td>
                          <td style={{ fontSize:11 }}>{s.supplier_id ? supName(s.supplier_id) : <span className="muted">—</span>}</td>
                          <td style={{ fontSize:11 }}>{s.availability||'—'}</td>
                          <td style={{ fontSize:11 }}>{s.lead_time||'—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals + margin strip */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
                <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'8px 12px' }}>
                  <div style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>Sourced ({itemsWithSrc}/{itemCount})</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--accent)', fontFamily:'monospace' }}>{totalSrc ? fmtC(totalSrc,'INR') : '—'}</div>
                </div>
                <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'8px 12px' }}>
                  <div style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>Quote Total ({itemsWithQuote}/{itemCount})</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--green)', fontFamily:'monospace' }}>{totalQuote ? fmtC(totalQuote,'INR') : '—'}</div>
                </div>
                {addlCost > 0 && (
                  <div style={{ background:'var(--amber-lt)', borderRadius:'var(--r-sm)', padding:'8px 12px' }}>
                    <div style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>Addl. Charges</div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--amber)', fontFamily:'monospace' }}>{fmtC(addlCost, enq.charges?.currency||'INR')}</div>
                  </div>
                )}
                <div style={{ background: grossMgn >= 0 ? 'var(--green-lt)' : 'var(--red-lt)', borderRadius:'var(--r-sm)', padding:'8px 12px', borderLeft:`3px solid ${grossMgn>=0?'var(--green)':'var(--red)'}` }}>
                  <div style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>Gross Margin</div>
                  <div style={{ fontSize:13, fontWeight:700, color: grossMgn>=0?'var(--green)':'var(--red)', fontFamily:'monospace' }}>
                    {grossMgn ? `${grossMgn>=0?'+':''}${fmtC(grossMgn,'INR')}` : '—'}
                    {totalSrc > 0 && <span style={{ fontSize:10, marginLeft:5 }}>({grossPct>=0?'+':''}{grossPct.toFixed(1)}%)</span>}
                  </div>
                </div>
                <div style={{ background: netMgn >= 0 ? 'var(--teal-lt,var(--green-lt))' : 'var(--red-lt)', borderRadius:'var(--r-sm)', padding:'8px 12px', borderLeft:`3px solid ${netMgn>=0?'var(--teal)':'var(--red)'}` }}>
                  <div style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>Net Margin</div>
                  <div style={{ fontSize:13, fontWeight:700, color: netMgn>=0?'var(--teal)':'var(--red)', fontFamily:'monospace' }}>
                    {netMgn ? `${netMgn>=0?'+':''}${fmtC(netMgn,'INR')}` : '—'}
                    {totalSrc > 0 && <span style={{ fontSize:10, marginLeft:5 }}>({netPct>=0?'+':''}{netPct.toFixed(1)}%)</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <QuoteDetailModal
          enq={selected}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
