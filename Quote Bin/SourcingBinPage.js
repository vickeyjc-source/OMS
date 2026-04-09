// client/src/pages/SourcingBinPage.js  v3
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

const ALL_CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF',
  'CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK',
  'HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR',
  'KMF','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA',
  'MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO',
  'NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD',
  'RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLL','SOS','SRD','STN','SYP',
  'SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU',
  'UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW','ZWL'
];

const fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);
const fmtC = (n, c) => {
  const sym = { INR:'₹', USD:'$', EUR:'€', GBP:'£', SGD:'S$', AED:'د.إ', JPY:'¥', CNY:'¥', AUD:'A$', CAD:'C$' };
  return `${sym[c] || c + ' '}${fmt(n)}`;
};

// ── SourcingModal ────────────────────────────────────────────
function SourcingModal({ enq, suppliers, customers, users, onClose, onSaved }) {
  const { user } = useAuth();

  // Sourcing rows — one per item
  const [srcRows, setSrcRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      return ex
        ? { ...ex }
        : { id: null, enquiry_item_id: item.id, supplier_id: '', sourced_price: '', sourced_currency: 'USD', availability: '', lead_time: '', notes: '' };
    })
  );

  // Quote prices — one per item
  const [quoteRows, setQuoteRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      return { enquiry_item_id: item.id, quote_price: ex?.quote_price || '', quote_currency: ex?.quote_currency || item.target_currency || 'INR' };
    })
  );

  // Additional charges for whole enquiry
  const [charges, setCharges] = useState({
    customs:   enq.charges?.customs   || '',
    handling:  enq.charges?.handling  || '',
    freight:   enq.charges?.freight   || '',
    currency:  enq.charges?.currency  || 'INR',
    notes:     enq.charges?.notes     || '',
  });

  const [assignTo, setAssignTo] = useState(enq.assigned_to || '');
  const [saving, setSaving]     = useState(false);
  const [saveMode, setSaveMode] = useState('');

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || '—';
  const srcingUsers = users.filter(u => u.department === 'sourcing' || ['admin','manager'].includes(u.role));

  const updSrc   = (idx, k, v) => setSrcRows(p  => p.map((r,i) => i===idx ? {...r,[k]:v} : r));
  const updQuote = (idx, k, v) => setQuoteRows(p => p.map((r,i) => i===idx ? {...r,[k]:v} : r));

  // ── Margin calculations ──────────────────────────────────
  const marginData = useMemo(() => {
    const rows = (enq.items || []).map((item, idx) => {
      const src  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const qty  = Number(item.quantity) || 0;

      const srcUnit   = Number(src.sourced_price)   || 0;
      const quoteUnit = Number(qrow.quote_price)     || 0;
      const target    = Number(item.target_price)    || 0;

      const srcTotal   = srcUnit * qty;
      const quoteTotal = quoteUnit * qty;
      const grossMarginUnit = quoteUnit - srcUnit;
      const grossMarginTotal = quoteTotal - srcTotal;

      const aboveTarget = target > 0 && (srcUnit > target || quoteUnit > target);
      const srcAbove   = target > 0 && srcUnit > target;
      const quoteAbove = target > 0 && quoteUnit > target;

      return { srcUnit, quoteUnit, srcTotal, quoteTotal, grossMarginUnit, grossMarginTotal, target, qty, srcAbove, quoteAbove, aboveTarget };
    });

    const totalSrcValue    = rows.reduce((s, r) => s + r.srcTotal, 0);
    const totalQuoteValue  = rows.reduce((s, r) => s + r.quoteTotal, 0);
    const totalGrossMargin = totalQuoteValue - totalSrcValue;
    const grossMarginPct   = totalSrcValue > 0 ? ((totalGrossMargin / totalSrcValue) * 100) : 0;

    const addlCost = (Number(charges.customs) || 0) + (Number(charges.handling) || 0) + (Number(charges.freight) || 0);
    const totalNetMargin = totalQuoteValue - totalSrcValue - addlCost;
    const netMarginPct   = totalSrcValue > 0 ? ((totalNetMargin / totalSrcValue) * 100) : 0;

    return { rows, totalSrcValue, totalQuoteValue, totalGrossMargin, grossMarginPct, addlCost, totalNetMargin, netMarginPct };
  }, [srcRows, quoteRows, charges, enq.items]);

  const handleSave = async (mode) => {
    setSaving(true); setSaveMode(mode);
    try {
      const rowsToSave = srcRows.map((r, idx) => ({
        ...r,
        id: r.id || ('src_' + r.enquiry_item_id + '_' + Date.now()),
        quote_price:    quoteRows[idx]?.quote_price    || null,
        quote_currency: quoteRows[idx]?.quote_currency || 'INR',
      }));

      const newStatus = mode === 'quote' ? 'quoted' : mode === 'draft' ? 'sourcing' : 'sourcing';
      const action    = mode === 'quote' ? 'Sent to Quote Bin' : mode === 'draft' ? 'Saved as draft in Sourcing' : 'Sourcing saved';

      await api.put(`/enquiries/${enq.id}`, {
        sourcing:    rowsToSave,
        charges,
        status:      newStatus,
        assigned_to: assignTo || null,
        _action:     action,
      });

      if (mode === 'quote') {
        toast.success('Sent to Quote Bin!');
      } else if (mode === 'draft') {
        toast.success('Saved as draft — stays in Sourcing Bin');
      } else {
        toast.success('Sourcing saved');
      }
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false); setSaveMode('');
    }
  };

  const md = marginData;

  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>🔍 {enq.id} — {custName(enq.customer_id)}</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
              {enq.items?.length || 0} component{enq.items?.length !== 1 ? 's' : ''} ·
              Priority: <strong style={{ color: enq.priority==='urgent'?'var(--red)':enq.priority==='high'?'var(--amber)':'inherit' }}>{enq.priority}</strong> ·
              Created {enq.created_at}
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status}/>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">

          {/* Enquiry Info + Notes */}
          <div style={{ background:'var(--accent-lt)', border:'1px solid rgba(27,79,158,.2)', borderRadius:'var(--r-sm)', padding:'9px 14px', marginBottom:14, fontSize:12, display:'flex', gap:20, flexWrap:'wrap' }}>
            <span>📋 <strong>Customer:</strong> {custName(enq.customer_id)}</span>
            {enq.notes && <span>📝 <strong>Notes:</strong> {enq.notes}</span>}
            <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
              <label className="label" style={{ margin:0 }}>Assigned:</label>
              <select className="input" style={{ padding:'3px 8px', fontSize:12, minWidth:140 }} value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                <option value="">— Unassigned —</option>
                {srcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </span>
          </div>

          {/* ── Per-Item Sourcing + Quote Pricing ─────────── */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title" style={{ marginBottom:12 }}>
              <span>📦 Components — Sourcing &amp; Quote Pricing</span>
            </div>

            {(enq.items || []).map((item, idx) => {
              const row   = srcRows[idx]   || {};
              const qrow  = quoteRows[idx] || {};
              const mrow  = md.rows[idx]   || {};
              const hasTarget = Number(item.target_price) > 0;

              return (
                <div
                  key={item.id}
                  style={{
                    border: `1px solid ${mrow.aboveTarget ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 'var(--r)',
                    padding: '12px 14px',
                    marginBottom: 12,
                    background: mrow.aboveTarget ? 'var(--red-lt)' : 'var(--surface2)',
                  }}
                >
                  {/* Item header */}
                  <div className="flex-between" style={{ marginBottom:10 }}>
                    <div>
                      <span className="bold" style={{ fontSize:13 }}>{item.component}</span>
                      {item.manufacturer && <span style={{ fontSize:12, color:'var(--text2)', marginLeft:8 }}>{item.manufacturer}</span>}
                      {item.ipn && <span className="mono" style={{ fontSize:10, color:'var(--text3)', marginLeft:8 }}>IPN: {item.ipn}</span>}
                    </div>
                    <div className="flex gap-8">
                      <span className="badge badge-blue">{item.quantity} pcs</span>
                      {hasTarget && (
                        <span
                          className={`badge ${mrow.quoteAbove ? 'badge-red' : mrow.srcAbove ? 'badge-amber' : 'badge-gray'}`}
                          title={mrow.aboveTarget ? 'Price exceeds target' : 'Within target'}
                        >
                          {mrow.aboveTarget ? '⚠ ' : ''}Target: {item.target_currency} {item.target_price}
                        </span>
                      )}
                      {item.date_code && <span className="badge badge-gray">DC: {item.date_code}</span>}
                      {item.preferred_delivery_date && <span className="badge badge-teal">Del: {item.preferred_delivery_date}</span>}
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    {/* LEFT: Sourcing price */}
                    <div style={{ background:'#fff', borderRadius:'var(--r-sm)', padding:'10px 12px', border:`1px solid ${mrow.srcAbove?'var(--red)':'var(--border)'}` }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--accent)', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                        🏭 Sourcing Price
                        {mrow.srcAbove && <span className="badge badge-red" style={{ fontSize:9 }}>Above Target</span>}
                      </div>
                      <div className="form-grid-3" style={{ marginBottom:8 }}>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Supplier</label>
                          <select className="input" value={row.supplier_id||''} onChange={e=>updSrc(idx,'supplier_id',e.target.value)}>
                            <option value="">— Select —</option>
                            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name} ({s.type==='domestic'?'🇮🇳':'🌐'})</option>)}
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Unit Price</label>
                          <input className="input" type="number" step="0.01" value={row.sourced_price||''} onChange={e=>updSrc(idx,'sourced_price',e.target.value)} placeholder="0.00" style={{ borderColor: mrow.srcAbove?'var(--red)':undefined }}/>
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Currency</label>
                          <select className="input" value={row.sourced_currency||'USD'} onChange={e=>updSrc(idx,'sourced_currency',e.target.value)}>
                            {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="form-grid-3">
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Availability</label>
                          <input className="input" value={row.availability||''} onChange={e=>updSrc(idx,'availability',e.target.value)} placeholder="In stock / 4 wks"/>
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Lead Time</label>
                          <input className="input" value={row.lead_time||''} onChange={e=>updSrc(idx,'lead_time',e.target.value)} placeholder="e.g. 4 weeks"/>
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Notes</label>
                          <input className="input" value={row.notes||''} onChange={e=>updSrc(idx,'notes',e.target.value)} placeholder="MOQ, terms…"/>
                        </div>
                      </div>
                      {row.sourced_price && row.sourced_currency && (
                        <div style={{ marginTop:8, fontSize:11, color:'var(--text2)' }}>
                          Total: <strong>{fmtC(Number(row.sourced_price)*Number(item.quantity), row.sourced_currency)}</strong>
                        </div>
                      )}
                    </div>

                    {/* RIGHT: Quote price */}
                    <div style={{ background:'#fff', borderRadius:'var(--r-sm)', padding:'10px 12px', border:`1px solid ${mrow.quoteAbove?'var(--red)':'var(--border)'}` }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--green)', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                        💰 Quote Price (to Customer)
                        {mrow.quoteAbove && <span className="badge badge-red" style={{ fontSize:9 }}>Above Target</span>}
                      </div>
                      <div className="form-grid-2" style={{ marginBottom:8 }}>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Unit Quote Price</label>
                          <input className="input" type="number" step="0.01" value={qrow.quote_price||''} onChange={e=>updQuote(idx,'quote_price',e.target.value)} placeholder="0.00" style={{ borderColor: mrow.quoteAbove?'var(--red)':undefined }}/>
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="label">Currency</label>
                          <select className="input" value={qrow.quote_currency||'INR'} onChange={e=>updQuote(idx,'quote_currency',e.target.value)}>
                            {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Margin per item */}
                      {(mrow.srcUnit > 0 || mrow.quoteUnit > 0) && (
                        <div style={{ marginTop:8 }}>
                          {qrow.quote_price && (
                            <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>
                              Total: <strong>{fmtC(Number(qrow.quote_price)*Number(item.quantity), qrow.quote_currency)}</strong>
                            </div>
                          )}
                          {mrow.srcUnit > 0 && mrow.quoteUnit > 0 && (
                            <div style={{
                              padding:'5px 8px', borderRadius:'var(--r-sm)', fontSize:11, fontWeight:600,
                              background: mrow.grossMarginUnit >= 0 ? 'var(--green-lt)' : 'var(--red-lt)',
                              color: mrow.grossMarginUnit >= 0 ? 'var(--green)' : 'var(--red)',
                            }}>
                              Gross margin: {fmtC(mrow.grossMarginUnit, qrow.quote_currency||'INR')}/unit
                              {' · '}Total: {fmtC(mrow.grossMarginTotal, qrow.quote_currency||'INR')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Target comparison bar */}
                  {hasTarget && mrow.srcUnit > 0 && mrow.quoteUnit > 0 && (
                    <div style={{ marginTop:10, padding:'7px 10px', borderRadius:'var(--r-sm)', background: mrow.aboveTarget?'var(--red-lt)':'var(--green-lt)', fontSize:11, color: mrow.aboveTarget?'var(--red)':'var(--green)' }}>
                      {mrow.srcAbove && `⚠ Source price ${item.target_currency} ${mrow.srcUnit} is above target ${item.target_price}`}
                      {mrow.srcAbove && mrow.quoteAbove && ' · '}
                      {mrow.quoteAbove && `⚠ Quote price ${qrow.quote_currency} ${mrow.quoteUnit} is above target ${item.target_price}`}
                      {!mrow.aboveTarget && `✅ Both prices within target (${item.target_currency} ${item.target_price})`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Additional Charges ────────────────────────── */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title">
              <span>🧾 Additional Approx. Costs (Entire Enquiry)</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr) 1fr', gap:12, alignItems:'end' }}>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Customs Charges</label>
                <input className="input" type="number" step="0.01" value={charges.customs} onChange={e=>setCharges(c=>({...c,customs:e.target.value}))} placeholder="0.00"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Handling Charges</label>
                <input className="input" type="number" step="0.01" value={charges.handling} onChange={e=>setCharges(c=>({...c,handling:e.target.value}))} placeholder="0.00"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Freight Charges</label>
                <input className="input" type="number" step="0.01" value={charges.freight} onChange={e=>setCharges(c=>({...c,freight:e.target.value}))} placeholder="0.00"/>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Currency</label>
                <select className="input" value={charges.currency} onChange={e=>setCharges(c=>({...c,currency:e.target.value}))}>
                  {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Notes</label>
                <input className="input" value={charges.notes} onChange={e=>setCharges(c=>({...c,notes:e.target.value}))} placeholder="e.g. Air freight estimate"/>
              </div>
            </div>
          </div>

          {/* ── Margin Summary ────────────────────────────── */}
          <div className="card card-sm" style={{ marginBottom:0, border:'1px solid rgba(27,79,158,.2)' }}>
            <div className="card-title">📊 Margin Summary</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { label:'Total Source Value',      val: md.totalSrcValue,    cur: srcRows[0]?.sourced_currency||'USD',  color:'var(--accent)' },
                { label:'Total Quote Value',        val: md.totalQuoteValue,  cur: quoteRows[0]?.quote_currency||'INR',  color:'var(--green)' },
                {
                  label:'Gross Margin (Quote − Source)',
                  val:  md.totalGrossMargin,
                  cur:  quoteRows[0]?.quote_currency||'INR',
                  color: md.totalGrossMargin >= 0 ? 'var(--green)' : 'var(--red)',
                  sub:  `${md.grossMarginPct >= 0 ? '+' : ''}${md.grossMarginPct.toFixed(1)}%`
                },
                {
                  label:'Net Margin (Quote − Source − Charges)',
                  val:  md.totalNetMargin,
                  cur:  quoteRows[0]?.quote_currency||'INR',
                  color: md.totalNetMargin >= 0 ? 'var(--teal)' : 'var(--red)',
                  sub:  `Addl. costs: ${fmtC(md.addlCost, charges.currency||'INR')} · ${md.netMarginPct >= 0 ? '+' : ''}${md.netMarginPct.toFixed(1)}%`
                },
              ].map(s => (
                <div key={s.label} style={{ background:'var(--surface2)', borderRadius:'var(--r)', padding:'12px 14px', borderLeft:`3px solid ${s.color}` }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:5, fontWeight:500 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:s.color, letterSpacing:'-.02em' }}>
                    {s.val !== 0 ? fmtC(s.val, s.cur) : '—'}
                  </div>
                  {s.sub && <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Per-item margin table */}
            {md.rows.some(r => r.srcUnit > 0 && r.quoteUnit > 0) && (
              <div style={{ marginTop:14, overflowX:'auto' }}>
                <table className="li-table">
                  <thead>
                    <tr>
                      <th>Component</th><th>Qty</th>
                      <th>Source/Unit</th><th>Quote/Unit</th>
                      <th>Gross Margin/Unit</th><th>Gross Margin Total</th>
                      <th>vs Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(enq.items||[]).map((item, idx) => {
                      const m   = md.rows[idx] || {};
                      const src = srcRows[idx]   || {};
                      const q   = quoteRows[idx] || {};
                      if (!m.srcUnit && !m.quoteUnit) return null;
                      return (
                        <tr key={item.id}>
                          <td className="bold" style={{ fontSize:11 }}>{item.component}</td>
                          <td>{item.quantity}</td>
                          <td className="mono" style={{ color:'var(--accent)', fontSize:11 }}>{m.srcUnit ? fmtC(m.srcUnit, src.sourced_currency||'USD') : '—'}</td>
                          <td className="mono" style={{ color:'var(--green)', fontSize:11 }}>{m.quoteUnit ? fmtC(m.quoteUnit, q.quote_currency||'INR') : '—'}</td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginUnit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginUnit ? `${m.grossMarginUnit >= 0?'+':''}${fmtC(m.grossMarginUnit, q.quote_currency||'INR')}` : '—'}
                          </td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginTotal ? `${m.grossMarginTotal >= 0?'+':''}${fmtC(m.grossMarginTotal, q.quote_currency||'INR')}` : '—'}
                          </td>
                          <td>
                            {Number(item.target_price) > 0 ? (
                              <span style={{
                                background: m.aboveTarget ? 'var(--red)' : 'var(--green-lt)',
                                color: m.aboveTarget ? '#fff' : 'var(--green)',
                                padding:'2px 8px', borderRadius:999, fontSize:10, fontWeight:600
                              }}>
                                {m.aboveTarget ? '⚠ Above' : '✓ Within'} {item.target_currency} {item.target_price}
                              </span>
                            ) : <span className="muted">—</span>}
                          </td>
                        </tr>
                      );
                    }).filter(Boolean)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer buttons ────────────────────────────── */}
        <div className="modal-footer" style={{ justifyContent:'space-between' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <div className="flex gap-8">
            {/* Save — stays in Sourcing Bin */}
            <button
              className="btn"
              disabled={saving}
              onClick={() => handleSave('save')}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h9l3 3v9H2z"/><rect x="5" y="9" width="6" height="5"/><rect x="5" y="2" width="5" height="3"/></svg>
              {saving && saveMode==='save' ? 'Saving…' : 'Save'}
            </button>

            {/* Save as Draft — stays in Sourcing Bin */}
            <button
              className="btn"
              disabled={saving}
              onClick={() => handleSave('draft')}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 2v5h6V2"/><rect x="9" y="2" width="2" height="3"/></svg>
              {saving && saveMode==='draft' ? 'Saving…' : 'Save as Draft'}
            </button>

            {/* Send to Quote Bin */}
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={() => handleSave('quote')}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
              {saving && saveMode==='quote' ? 'Sending…' : 'Send to Quote Bin →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Sourcing Bin Page ───────────────────────────────────
export default function SourcingBinPage() {
  const qc = useQueryClient();
  const [selected, setSelected]         = useState(null);
  const [search, setSearch]             = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const { data: enquiries=[], isLoading } = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data), refetchInterval:20000 });
  const { data: customers=[] }  = useQuery({ queryKey:['customers'],  queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: suppliers=[] }  = useQuery({ queryKey:['suppliers'],  queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: users=[] }      = useQuery({ queryKey:['users'],      queryFn:()=>api.get('/users').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const userName = id => users.find(u=>u.id===id)?.name || 'Unassigned';

  const binEnqs = enquiries.filter(e => e.status === 'sourcing');

  const filtered = binEnqs.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
    const matchPri = priorityFilter === 'all' || e.priority === priorityFilter;
    return matchSearch && matchPri;
  });

  const total      = binEnqs.length;
  const urgent     = binEnqs.filter(e=>e.priority==='urgent').length;
  const high       = binEnqs.filter(e=>e.priority==='high').length;
  const unassigned = binEnqs.filter(e=>!e.assigned_to).length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:13, marginBottom:18 }}>
        {[
          { label:'In Sourcing Bin', val:total,       color:'var(--accent)',  sub:'enquiries to process' },
          { label:'Urgent',          val:urgent,      color:'var(--red)',     sub:'need immediate action' },
          { label:'High Priority',   val:high,        color:'var(--amber)',   sub:'process next' },
          { label:'Unassigned',      val:unassigned,  color:'var(--purple)',  sub:'not yet assigned' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft:`3px solid ${s.color}` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color:s.color }}>{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Search + filter — NO New Enquiry button */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search sourcing bin…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div className="filter-row" style={{ marginBottom:0 }}>
          {['all','urgent','high','normal'].map(p => (
            <span key={p} className={`fchip ${priorityFilter===p?'active':''}`} onClick={()=>setPriorityFilter(p)}>
              {p === 'all' ? 'All Priority' : p.charAt(0).toUpperCase()+p.slice(1)}
            </span>
          ))}
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading sourcing bin…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-state-text">
            {binEnqs.length === 0
              ? 'Sourcing bin is empty — no enquiries sent to sourcing yet.'
              : 'No enquiries match your filter'}
          </div>
        </div>
      )}

      {/* Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:14 }}>
        {filtered.map(enq => {
          const srcDone  = (enq.sourcing||[]).filter(s => s.sourced_price).length;
          const srcTotal = (enq.items||[]).length;
          const srcPct   = srcTotal ? Math.round(srcDone / srcTotal * 100) : 0;
          const isUrgent = enq.priority === 'urgent';
          const isHigh   = enq.priority === 'high';

          // Quick margin summary on card
          const hasMarginData = (enq.sourcing||[]).some(s => s.sourced_price && s.quote_price);
          const quickSrc   = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.sourced_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
          const quickQuote = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.quote_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
          const quickGross = quickQuote - quickSrc;

          return (
            <div
              key={enq.id}
              className="card"
              style={{
                marginBottom:0, cursor:'pointer',
                borderLeft: isUrgent ? '3px solid var(--red)' : isHigh ? '3px solid var(--amber)' : '1px solid var(--border)',
              }}
              onClick={() => setSelected(enq)}
            >
              <div className="flex-between" style={{ marginBottom:8 }}>
                <div>
                  <span className="mono bold" style={{ fontSize:13 }}>{enq.id}</span>
                  {isUrgent && <span className="badge badge-red" style={{ marginLeft:7, fontSize:9 }}>Urgent</span>}
                  {isHigh   && <span className="badge badge-amber" style={{ marginLeft:7, fontSize:9 }}>High</span>}
                </div>
                <StatusBadge s={enq.status}/>
              </div>

              <div style={{ fontSize:13, fontWeight:600, marginBottom:3 }}>{custName(enq.customer_id)}</div>

              {/* Component list */}
              <div style={{ fontSize:11, color:'var(--text2)', marginBottom:8, lineHeight:1.6 }}>
                {(enq.items||[]).map((i,n) => (
                  <div key={i.id} style={{ display:'flex', justifyContent:'space-between', borderBottom:'0.5px solid var(--border)', padding:'3px 0' }}>
                    <span><strong>{i.component}</strong>{i.manufacturer ? ` · ${i.manufacturer}` : ''}</span>
                    <span style={{ color:'var(--text3)', flexShrink:0, marginLeft:8 }}>
                      {i.quantity} pcs
                      {i.target_price ? ` · Target: ${i.target_currency} ${i.target_price}` : ''}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress */}
              <div style={{ marginBottom:8 }}>
                <div className="flex-between" style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>
                  <span>Sourcing progress</span>
                  <span style={{ fontWeight:600, color:srcPct===100?'var(--green)':'inherit' }}>{srcDone}/{srcTotal} priced</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width:`${srcPct}%`, background:srcPct===100?'var(--green)':srcPct>50?'var(--accent)':'var(--amber)' }}/>
                </div>
              </div>

              {/* Quick margin on card */}
              {hasMarginData && (
                <div style={{
                  padding:'6px 10px', borderRadius:'var(--r-sm)', fontSize:11, marginBottom:8,
                  background: quickGross >= 0 ? 'var(--green-lt)' : 'var(--red-lt)',
                  color: quickGross >= 0 ? 'var(--green)' : 'var(--red)',
                  display:'flex', justifyContent:'space-between'
                }}>
                  <span>Gross Margin</span>
                  <strong>{quickGross >= 0 ? '+' : ''}{fmt(quickGross)}</strong>
                </div>
              )}

              <div className="flex-between" style={{ fontSize:10, color:'var(--text3)', marginBottom:10 }}>
                <span>📅 {enq.created_at}</span>
                <span>👤 {userName(enq.assigned_to)}</span>
              </div>

              <button
                className="btn btn-primary btn-sm"
                style={{ width:'100%', justifyContent:'center', display:'flex' }}
                onClick={e => { e.stopPropagation(); setSelected(enq); }}
              >
                {srcPct === 0 ? 'Start Sourcing' : srcPct === 100 ? 'Review & Send to Quote' : 'Continue Sourcing'}
              </button>
            </div>
          );
        })}
      </div>

      {selected && (
        <SourcingModal
          enq={selected}
          suppliers={suppliers}
          customers={customers}
          users={users}
          onClose={() => setSelected(null)}
          onSaved={() => {
            qc.invalidateQueries(['enquiries']);
            qc.invalidateQueries(['summary']);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
