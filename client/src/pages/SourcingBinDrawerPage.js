// client/src/pages/SourcingBinDrawerPage.js
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, DaysBadge, fmtDateTime, maskName } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { ALL_CURRENCIES, fmtC } from '../utils/currencies';
import { getTaxRatesForCurrency, seedTaxRateCache } from '../utils/taxRates';

const getTaxRates = (currency) => {
  const entry = getTaxRatesForCurrency(currency);
  return (entry.rates || []).map(r => ({ label: `GST ${r}%`, rate: r }));
};

const fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);
const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── per-item cost calc ────────────────────────────────────────────────────────
function calcRow(src, item) {
  const qty       = Number(item.quantity) || 1;
  const srcINR    = Number(src.sourced_price) || 0;
  const supType   = src._supType || 'domestic';
  const isIntl    = supType === 'international';
  const marginAmt = Number(src.margin_pct) || 0;
  let freight, insurance, duty, cess, bank, clearance;
  if (isIntl) {
    freight   = srcINR * (Number(src.freight_pct)    || 0) / 100;
    insurance = srcINR * (Number(src.insurance_pct)  || 0) / 100;
    duty      = srcINR * (Number(src.duty_pct)       || 0) / 100;
    cess      = srcINR * (Number(src.cess_pct)       || 0) / 100;
    bank      = srcINR * (Number(src.bank_fixed_foreign ?? src.bank_fixed_usd) || 0) / 100;
    clearance = srcINR * (Number(src.clearance_fixed_inr) || 0) / 100;
  } else {
    freight   = Number(src.freight_pct) || 0;
    insurance = 0; duty = 0; cess = 0; bank = 0; clearance = 0;
  }
  const totalCost = srcINR + freight + insurance + duty + cess + bank + clearance;
  const marginPct = srcINR > 0 ? (marginAmt / srcINR * 100) : 0;
  const quoteCalc = srcINR > 0 ? totalCost + marginAmt : 0;
  const totalAmt  = quoteCalc * qty;
  return { freight, insurance, duty, cess, bank, clearance, margin: marginAmt, marginPct, quoteCalc, totalCost, totalAmt, isIntl };
}

// ── landed cost calc — modes is a per-field object, each key is 'pct'|'amt' ───
// fields: freight, insurance, transport, packaging, bcd, sws, cess, clearing, bank, margin, buffer
const DEFAULT_MODES = { freight:'amt', insurance:'amt', transport:'amt', packaging:'amt', bcd:'amt', sws:'amt', cess:'amt', clearing:'amt', bank:'amt', margin:'amt', buffer:'amt' };

function calcLanded(src, item, modes = {}) {
  const m = { ...DEFAULT_MODES, ...modes };
  const qty        = Number(item?.quantity) || 1;
  const supType    = src._supType || 'domestic';
  const isIntl     = supType === 'international';
  const srcUnit    = Number(src.sourced_price) || 0;
  const materialValue = srcUnit * qty;

  const raw = (v) => Number(v || 0);
  const applyMode = (mode, rawVal, base) => mode === 'pct' ? base * rawVal / 100 : rawVal;

  const freightINR   = applyMode(m.freight,   raw(src.freight_pct),   materialValue);
  const insuranceINR = isIntl ? applyMode(m.insurance, raw(src.insurance_pct), materialValue) : 0;
  const transportINR = applyMode(m.transport, raw(src._transport),    materialValue);
  const packagingINR = applyMode(m.packaging, raw(src._packaging),    materialValue);
  const cifValue     = materialValue + freightINR + insuranceINR;

  const bcdRaw      = raw(src.duty_pct);
  const swsRaw      = raw(src.cess_pct);
  const cessRaw     = raw(src.bank_fixed_foreign ?? (src.bank_fixed_usd || 0));
  const clearingRaw = raw(src.clearance_fixed_inr);
  let bcdAmount, swsAmount, cessAmount, clearingINR;
  if (!isIntl) {
    bcdAmount = 0; swsAmount = 0; cessAmount = 0; clearingINR = 0;
  } else {
    bcdAmount   = applyMode(m.bcd,      bcdRaw,      cifValue);
    swsAmount   = applyMode(m.sws,      swsRaw,      m.sws === 'pct' ? bcdAmount : 1);
    cessAmount  = applyMode(m.cess,     cessRaw,     cifValue);
    clearingINR = applyMode(m.clearing, clearingRaw, cifValue);
  }
  const importCost = cifValue + bcdAmount + swsAmount + cessAmount;

  const bankINR   = applyMode(m.bank,   raw(src.bank_fixed_inr), importCost);
  const bufferINR = applyMode(m.buffer, raw(src._buffer),        importCost);

  const landedBeforeMargin = importCost + clearingINR + transportINR + packagingINR + bankINR;
  const marginAmt = applyMode(m.margin, raw(src.margin_pct),     landedBeforeMargin);
  const finalCost      = landedBeforeMargin + marginAmt + bufferINR;
  const unitLandedCost = qty > 0 ? finalCost / qty : 0;
  const gstPct    = Number(src._gst_pct || 0);
  const gstAmount = finalCost * gstPct / 100;
  const grandTotal = finalCost + gstAmount;
  return {
    materialValue, freightINR, insuranceINR, transportINR, packagingINR, cifValue,
    bcdAmount, swsAmount, cessAmount, importCost,
    clearingINR, bankINR, landedBeforeMargin,
    marginAmt, bufferINR, finalCost, unitLandedCost,
    gstPct, gstAmount, grandTotal, isIntl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM DRAWER  — right-side drawer for a single item's detailed fields
// ─────────────────────────────────────────────────────────────────────────────
function ItemDrawer({ enq, item, itemIdx, srcRow, qRow, suppliers, inventoryItems, isReadOnly,
                      onClose, onApply }) {
  const [row,  setRow]  = useState({ ...srcRow, _transport: srcRow._transport || '', _packaging: srcRow._packaging || '', _buffer: srcRow._buffer || '', _gst_pct: srcRow._gst_pct || '' });
  const [qrow, setQrow] = useState({ ...qRow });

  const isInvStock  = !!row.supplier_id?.startsWith('__inv__');
  const invStockHit = isInvStock ? inventoryItems.find(h => h.id === row.supplier_id.slice(7)) : null;
  const invIsIntl   = isInvStock && invStockHit && (invStockHit.target_currency || 'INR') !== 'INR';
  const supType = isInvStock ? (invIsIntl ? 'international' : 'domestic') : (suppliers.find(s => s.id === row.supplier_id)?.type || 'domestic');
  const isIntl  = supType === 'international';

  // per-field modes — default 'amt'
  const [modes, setModes] = useState(() => ({ ...DEFAULT_MODES, ...(srcRow._fieldModes || {}) }));

  const cur = row.sourced_currency || (isIntl ? 'USD' : 'INR');
  const lc  = calcLanded({ ...row, _supType: supType }, item, modes);
  const qty = Number(item.quantity) || 1;

  const updRow  = (k, v) => {
    setRow(p => {
      const updated = { ...p, [k]: v };
      const lc2 = calcLanded({ ...updated, _supType: supType }, item, modes);
      if (lc2.unitLandedCost > 0) setQrow(q => ({ ...q, quote_price: lc2.unitLandedCost.toFixed(2) }));
      return updated;
    });
  };
  const updQrow = (k, v) => setQrow(p => ({ ...p, [k]: v }));

  const recalcQuote = (newRow, newModes) => {
    const lc2 = calcLanded({ ...newRow, _supType: supType }, item, newModes);
    if (lc2.unitLandedCost > 0) setQrow(q => ({ ...q, quote_price: lc2.unitLandedCost.toFixed(2) }));
  };

  const handleRateChange = (field, val) => {
    setRow(p => {
      const updated = { ...p, [field]: val };
      const intl = isIntl;
      if ((field === 'src_price_foreign' || field === 'exchange_rate') && intl) {
        const fp = field === 'src_price_foreign' ? val : p.src_price_foreign;
        const er = field === 'exchange_rate' ? val : p.exchange_rate;
        updated.sourced_price = (Number(fp) > 0 && Number(er) > 0) ? String((Number(fp) * Number(er)).toFixed(4)) : '';
      }
      const lc2 = calcLanded({ ...updated, _supType: supType }, item, modes);
      if (lc2.unitLandedCost > 0) setQrow(q => ({ ...q, quote_price: lc2.unitLandedCost.toFixed(2) }));
      else if (!Number(updated.sourced_price)) setQrow(q => ({ ...q, quote_price: '' }));
      return updated;
    });
  };

  const handleToggle = (field) => {
    const newModes = { ...modes, [field]: modes[field] === 'pct' ? 'amt' : 'pct' };
    setModes(newModes);
    recalcQuote(row, newModes);
  };

  const LBL = { fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 3 };
  const roBox = (col, bg, bdr) => ({
    height: 36, fontSize: 12, padding: '3px 8px',
    background: bg || 'var(--surface2)', color: col || 'var(--text2)',
    border: `1.5px solid ${bdr || 'var(--border)'}`, borderRadius: 'var(--r-sm)',
    fontWeight: 700, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
  });
  const u = (field) => modes[field] === 'pct' ? '%' : '₹';
  // FieldLabel: label text left, toggle right, perfectly aligned
  const FL = ({ label, field, required }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3, minHeight: 18 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>{label}{required ? ' *' : ''}</span>
      <UnitToggle mode={modes[field]} onToggle={() => handleToggle(field)} disabled={isReadOnly} />
    </div>
  );

  return (
    <>
      <style>{DRAWER_CSS}</style>
      <div className="id-overlay" onClick={onClose} />
      <div className="id-drawer">

        {/* Header */}
        <div className="id-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>
              Item #{itemIdx + 1} — {enq.id}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em', marginBottom: 4 }}>
              {item.component}
              {item.manufacturer && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginLeft: 8 }}>{item.manufacturer}</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-lt)', padding: '1px 8px', borderRadius: 4, border: '1px solid var(--accent)33', marginLeft: 8 }}>×{qty} pcs</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 12 }}>
              {item.ipn && <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>IPN: {item.ipn}</span>}
              {item.preferred_delivery_date && (
                <span style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <span>📅</span>
                  {new Date(item.preferred_delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
              {Number(item.target_price) > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 4, background: '#dcfce7', color: '#16a34a', border: '1px solid #86efac', whiteSpace: 'nowrap' }}>
                  🎯 Target: {item.target_currency || 'INR'} {item.target_price} / unit
                </span>
              )}
              <input className="input" value={row.notes || ''} placeholder="Notes…" disabled={isReadOnly}
                onChange={e => updRow('notes', e.target.value)}
                style={{ flex: 1, height: 28, fontSize: 12, minWidth: 0 }} />
            </div>
          </div>
          <button className="close-x" style={{ flexShrink: 0 }} onClick={onClose}>×</button>
        </div>

        {/* Body: form (left) + summary (right) */}
        <div className="id-body">

          {/* ══ FORM ══ */}
          <div className="id-form">

            {/* GROUP 0: Supplier — locked display, chosen from card */}
            <div className="id-grp">
              <div className="id-grp-title">SUPPLIER</div>
              {isInvStock ? (() => {
                const hit = invStockHit;
                if (!hit) return null;
                const holderCurrency = hit.target_currency || 'INR';
                const holderIcon = hit.holder_type === 'customer' ? '👤' : hit.holder_type === 'supplier' ? '🏢' : '🏭';
                const holderLabel = hit.holder_type === 'customer' ? 'Customer' : hit.holder_type === 'supplier' ? 'Supplier' : 'Warehouse';
                return (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: invIsIntl ? '#eff6ff' : '#f0fdf4',
                    border: `1.5px solid ${invIsIntl ? '#3b82f6' : '#22c55e'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>📦</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: invIsIntl ? '#1d4ed8' : '#15803d' }}>
                        Stock — {invIsIntl ? '🌐 International' : '🇮🇳 Domestic'}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: invIsIntl ? '#dbeafe' : '#dcfce7', color: invIsIntl ? '#1e40af' : '#15803d',
                        border: `1px solid ${invIsIntl ? '#93c5fd' : '#86efac'}` }}>
                        {invIsIntl ? '🌐 INTL STOCK' : '🇮🇳 DOM STOCK'}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', letterSpacing: .4, marginBottom: 2 }}>HOLDER</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                          {holderIcon} {hit.holder_display || hit.holder_name || 'Stock'}
                          <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginLeft: 4 }}>({holderLabel})</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', letterSpacing: .4, marginBottom: 2 }}>QTY AVAILABLE</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#15803d' }}>{hit.quantity_available} pcs</div>
                      </div>
                      {hit.target_price && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', letterSpacing: .4, marginBottom: 2 }}>STOCK PRICE</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: invIsIntl ? '#1d4ed8' : '#374151' }}>
                            {holderCurrency} {Number(hit.target_price).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                            {invIsIntl && <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>(enter exchange rate below)</span>}
                          </div>
                        </div>
                      )}
                      {hit.date_code && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', letterSpacing: .4, marginBottom: 2 }}>DATE CODE</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{hit.date_code}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 8, fontStyle: 'italic' }}>🔒 Supplier locked — change from the main card</div>
                  </div>
                );
              })() : (() => {
                const sup = suppliers.find(s => s.id === row.supplier_id);
                if (!sup) return null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 8,
                    background: isIntl ? '#eff6ff' : '#f0fdf4',
                    border: `1.5px solid ${isIntl ? '#3b82f6' : '#22c55e'}`,
                  }}>
                    <span style={{ fontSize: 18 }}>{isIntl ? '🌐' : '🇮🇳'}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, color: isIntl ? '#1d4ed8' : '#15803d' }}>{sup.name}</div>
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{isIntl ? 'International Supplier' : 'Domestic Supplier'}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: isIntl ? '#dbeafe' : '#dcfce7', color: isIntl ? '#1e40af' : '#15803d',
                      border: `1px solid ${isIntl ? '#93c5fd' : '#86efac'}` }}>
                      {isIntl ? '🌐 INTL' : '🇮🇳 DOM'}
                    </span>
                    <div style={{ fontSize: 10, color: '#6b7280', marginLeft: 4, fontStyle: 'italic' }}>🔒 Locked</div>
                  </div>
                );
              })()}
            </div>

            {/* GROUP 1: Material Details — single row */}
            <div className="id-grp">
              <div className="id-grp-title">1. Material Details</div>
              {/* Row 1: HSN | Lead Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0 10px', alignItems: 'end', marginBottom: 8 }}>
                <div className="id-fg">
                  <label style={LBL}>HSN Code</label>
                  <input className="input" style={{ height: 34, fontSize: 12 }} value={row.hsn_code || ''} onChange={e => updRow('hsn_code', e.target.value)} disabled={isReadOnly} />
                </div>
                <div className="id-fg">
                  <label style={LBL}>Lead Time *</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input className="input" style={{ flex: 1, height: 34, fontSize: 12, minWidth: 0 }} type="number" min="1"
                      value={(row.lead_time || '').replace(/[^0-9]/g, '')} disabled={isReadOnly}
                      onChange={e => { const u = (row.lead_time || '').replace(/[0-9]/g, '').trim() || 'Days'; updRow('lead_time', e.target.value ? e.target.value + ' ' + u : ''); }} />
                    <select className="input" style={{ width: 72, height: 34, fontSize: 11 }}
                      value={(row.lead_time || '').replace(/[0-9]/g, '').trim() || 'Days'} disabled={isReadOnly}
                      onChange={e => { const n = (row.lead_time || '').replace(/[^0-9]/g, '') || ''; updRow('lead_time', n ? n + ' ' + e.target.value : ''); }}>
                      <option>Days</option><option>Weeks</option><option>Months</option>
                    </select>
                  </div>
                </div>
              </div>
              {/* Source Price row */}
              {(() => {
                const srcINR = Number(row.sourced_price) || 0;
                const target = Number(item.target_price) || 0;
                const aboveTarget = srcINR > 0 && target > 0 && srcINR > target;
                return (
                  <div style={{ marginTop: 10 }}>
                    {isIntl ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 10px', alignItems: 'end' }}>
                        <div className="id-fg">
                          <label style={LBL}>Currency</label>
                          <select className="input" style={{ height: 34, fontSize: 12 }} value={cur} disabled={isReadOnly} onChange={e => updRow('sourced_currency', e.target.value)}>
                            {ALL_CURRENCIES.filter(c => c !== 'INR').map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="id-fg">
                          <label style={LBL}>Exchange Rate (1 {cur} = ₹)</label>
                          <input className="input" style={{ height: 34, fontSize: 12 }} type="number" step="0.01" min="0" value={row.exchange_rate || ''} disabled={isReadOnly} onChange={e => handleRateChange('exchange_rate', e.target.value)} />
                        </div>
                        <div className="id-fg">
                          <label style={LBL}>Source Price ({cur})</label>
                          <input className="input" style={{ height: 34, fontSize: 12 }} type="number" step="0.0001" min="0" value={row.src_price_foreign || ''} disabled={isReadOnly} onChange={e => handleRateChange('src_price_foreign', e.target.value)} />
                        </div>
                        <div className="id-fg">
                          <label style={{ ...LBL, color: aboveTarget ? 'var(--red)' : srcINR > 0 ? 'var(--green)' : 'var(--text3)' }}>
                            = Source Price (₹){aboveTarget ? ' ⚠ Above target' : ''}
                          </label>
                          <div style={roBox(aboveTarget ? 'var(--red)' : srcINR > 0 ? 'var(--green)' : undefined, aboveTarget ? '#fee2e2' : srcINR > 0 ? 'var(--green-lt)' : undefined, aboveTarget ? 'var(--red)' : srcINR > 0 ? 'var(--green)' : undefined)}>
                            {srcINR > 0 ? `₹${fmt(srcINR)}` : '—'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="id-fg">
                        <label style={{ ...LBL, color: aboveTarget ? 'var(--red)' : 'var(--text2)' }}>
                          Source Price ₹ *{aboveTarget ? <span style={{ fontWeight: 700, marginLeft: 6 }}>⚠ Above target (₹{fmt(target)})</span> : ''}
                        </label>
                        <input className="input" style={{ height: 34, fontSize: 12, borderColor: aboveTarget ? 'var(--red)' : undefined, background: aboveTarget ? '#fee2e2' : undefined }} type="number" step="0.01" min="0" value={row.sourced_price || ''} disabled={isReadOnly} onChange={e => handleRateChange('sourced_price', e.target.value)} />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* GROUP 2: Freight & Logistics */}
            <div className="id-grp">
              <div className="id-grp-title">2. Freight &amp; Logistics</div>
              <div className="id-grid2">
                {[
                  { field: 'freight',   label: 'Freight',   v: row.freight_pct  ?? '', onChange: e => handleRateChange('freight_pct', e.target.value),   perUnit: lc.freightINR / qty },
                  ...(isIntl ? [{ field: 'insurance', label: 'Insurance', v: row.insurance_pct ?? '', onChange: e => handleRateChange('insurance_pct', e.target.value), perUnit: lc.insuranceINR / qty }] : []),
                  { field: 'transport', label: 'Transport', v: row._transport   ?? '', onChange: e => updRow('_transport', e.target.value),               perUnit: lc.transportINR / qty },
                  { field: 'packaging', label: 'Packaging', v: row._packaging   ?? '', onChange: e => updRow('_packaging', e.target.value),               perUnit: lc.packagingINR / qty },
                ].map(f => (
                  <div className="id-fg" key={f.field}>
                    <FL label={`${f.label} (${u(f.field)})`} field={f.field} />
                    <input className="input" style={{ height: 34, fontSize: 12 }} type="number" step="0.001" min="0" value={f.v} disabled={isReadOnly} onChange={f.onChange} />
                    {f.perUnit > 0 && <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>₹{fmt(f.perUnit)} / unit</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* GROUP 3: Import Charges (intl only) */}
            {isIntl && (
              <div className="id-grp">
                <div className="id-grp-title">3. Import Charges</div>
                <div className="id-grid2">
                  {[
                    { field: 'bcd',      label: 'BCD',      v: row.duty_pct          ?? '', onChange: e => handleRateChange('duty_pct', e.target.value),           perUnit: lc.bcdAmount / qty },
                    { field: 'sws',      label: 'SWS',      v: row.cess_pct          ?? '', onChange: e => handleRateChange('cess_pct', e.target.value),           perUnit: lc.swsAmount / qty },
                    { field: 'cess',     label: 'CESS',     v: row.bank_fixed_foreign ?? '', onChange: e => handleRateChange('bank_fixed_foreign', e.target.value), perUnit: lc.cessAmount / qty },
                    { field: 'clearing', label: 'Clearing', v: row.clearance_fixed_inr ?? '', onChange: e => handleRateChange('clearance_fixed_inr', e.target.value), perUnit: lc.clearingINR / qty },
                  ].map(f => (
                    <div className="id-fg" key={f.field}>
                      <FL label={`${f.label} (${u(f.field)})`} field={f.field} />
                      <input className="input" style={{ height: 34, fontSize: 12 }} type="number" step="0.001" min="0" value={f.v} disabled={isReadOnly} onChange={f.onChange} />
                      {f.perUnit > 0 && <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>₹{fmt(f.perUnit)} / unit</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GROUP 4: Financial */}
            <div className="id-grp">
              <div className="id-grp-title">{isIntl ? '4.' : '3.'} Financial</div>
              <div className="id-grid2">
                {[
                  { field: 'bank',   label: 'Bank Charges', v: row.bank_fixed_inr ?? '', onChange: e => updRow('bank_fixed_inr', e.target.value),           perUnit: lc.bankINR / qty },
                  { field: 'margin', label: 'Margin',       v: row.margin_pct     ?? '', onChange: e => handleRateChange('margin_pct', e.target.value),     perUnit: lc.marginAmt / qty },
                  { field: 'buffer', label: 'Buffer',       v: row._buffer        ?? '', onChange: e => updRow('_buffer', e.target.value),                  perUnit: lc.bufferINR / qty },
                ].map(f => (
                  <div className="id-fg" key={f.field}>
                    <FL label={`${f.label} (${u(f.field)})`} field={f.field} />
                    <input className="input" style={{ height: 34, fontSize: 12 }} type="number" step="0.001" min="0" value={f.v} disabled={isReadOnly} onChange={f.onChange} />
                    {f.perUnit > 0 && <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>₹{fmt(f.perUnit)} / unit</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* GROUP 5: Quote Pricing */}
            <div className="id-grp">
              <div className="id-grp-title">{isIntl ? '5.' : '4.'} Quote Pricing</div>
              <div className="id-grid2">
                <div className="id-fg">
                  <label style={LBL}>Quote Currency</label>
                  <select className="input" style={{ height: 36, fontSize: 12 }} value={qrow.quote_currency || 'INR'} onChange={e => updQrow('quote_currency', e.target.value)} disabled={isReadOnly}>
                    {ALL_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="id-fg">
                  <label style={{ ...LBL, color: (!qrow.tax_rate && qrow.tax_rate !== 0) ? 'var(--red)' : undefined }}>GST / Tax *</label>
                  <select className="input" value={qrow.tax_rate ?? ''} onChange={e => updQrow('tax_rate', e.target.value)} disabled={isReadOnly}
                    style={{ height: 36, fontSize: 12, borderColor: (!qrow.tax_rate && qrow.tax_rate !== 0) ? 'var(--red)' : undefined }}>
                    <option value="">— None —</option>
                    {getTaxRates('INR').map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                  </select>
                </div>
                <div className="id-fg">
                  <label style={{ ...LBL, color: qrow.quote_price ? 'var(--green)' : undefined }}>Quote Price / Unit *</label>
                  <input className="input" style={{ height: 36, fontSize: 12, fontWeight: 700, background: qrow.quote_price ? 'var(--green-lt)' : undefined, borderColor: qrow.quote_price ? 'var(--green)' : undefined }}
                    type="number" step="0.01" min="0" value={qrow.quote_price || ''} disabled={isReadOnly}
                    onChange={e => updQrow('quote_price', e.target.value)} />
                </div>
                {(() => {
                  const qp = Number(qrow.quote_price) || 0;
                  const tax = Number(qrow.tax_rate);
                  const withGST = (qp > 0 && tax > 0) ? qp * (1 + tax / 100) : null;
                  return (
                    <div className="id-fg">
                      <label style={{ ...LBL, color: withGST ? 'var(--accent)' : 'var(--text3)' }}>Price w/ GST (auto)</label>
                      <div style={roBox(withGST ? 'var(--accent)' : undefined, withGST ? 'var(--accent-lt)' : undefined, withGST ? 'var(--accent)' : undefined)}>
                        {withGST ? `${qrow.quote_currency === 'INR' ? '₹' : ''}${fmt(withGST)}` : '—'}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

          </div>{/* end id-form */}

          {/* ══ SUMMARY PANEL ══ */}
          <div className="id-summary-col">
            <div className="id-summary-heading">Calculation Summary</div>
            <div className="id-summary-card">
              <div className="id-summary-item-title">
                {item.component} <span style={{ fontWeight: 400, opacity: .5, fontSize: 11 }}>×{qty}</span>
              </div>
              {!Number(row.sourced_price) ? (
                <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.3)', padding: '24px 0' }}>
                  Enter source price to see calculation
                </div>
              ) : <>
                <SumRow label="Material Value"         val={lc.materialValue} />
                <SumRow label={`+ Freight (${row.freight_pct || 0}${u('freight')})`}   val={lc.freightINR} />
                {isIntl && <SumRow label={`+ Insurance (${row.insurance_pct || 0}${u('insurance')})`} val={lc.insuranceINR} />}
                <SumRow label="= CIF Value"            val={lc.cifValue} bold />
                <Divider />
                {isIntl && <>
                  <SumRow label={`+ BCD (${row.duty_pct || 0}${u('bcd')})`}              val={lc.bcdAmount} />
                  <SumRow label={`+ SWS (${row.cess_pct || 0}${u('sws')})`}              val={lc.swsAmount} />
                  <SumRow label={`+ CESS (${row.bank_fixed_foreign || 0}${u('cess')})`}  val={lc.cessAmount} />
                  <SumRow label="= Import Cost"        val={lc.importCost} bold />
                  <Divider />
                </>}
                {lc.clearingINR > 0  && <SumRow label={`+ Clearing (${row.clearance_fixed_inr || 0}${u('clearing')})`} val={lc.clearingINR} />}
                {lc.transportINR > 0 && <SumRow label={`+ Transport (${row._transport || 0}${u('transport')})`}         val={lc.transportINR} />}
                {lc.packagingINR > 0 && <SumRow label={`+ Packaging (${row._packaging || 0}${u('packaging')})`}         val={lc.packagingINR} />}
                {lc.bankINR > 0      && <SumRow label={`+ Bank Charges (${row.bank_fixed_inr || 0}${u('bank')})`}       val={lc.bankINR} />}
                <SumRow label="= Landed Before Margin" val={lc.landedBeforeMargin} bold />
                <Divider />
                <SumRow label={`+ Margin (${row.margin_pct || 0}${u('margin')})`} val={lc.marginAmt} />
                {lc.bufferINR > 0 && <SumRow label={`+ Buffer (${row._buffer || 0}${u('buffer')})`} val={lc.bufferINR} />}
                <SumRow label="= Final Cost"           val={lc.finalCost} bold />
                <SumRow label={`Unit Landed Cost (÷${qty})`}             val={lc.unitLandedCost} />
                <Divider />
                <SumRow label={`+ GST (${lc.gstPct}%)`}                 val={lc.gstAmount} />
                <SumRow label="Grand Total"            val={lc.grandTotal} highlight />
                {Number(qrow.quote_price) > 0 && (() => {
                  const qp = Number(qrow.quote_price);
                  const gstPct = Number(qrow.tax_rate) || 0;
                  const qTotal = qp * qty;
                  const gstAmt = gstPct > 0 ? qTotal * gstPct / 100 : 0;
                  const qTotalWithGST = qTotal + gstAmt;
                  return <>
                    <Divider />
                    <SumRow label="Quote Price / Unit"          val={qp} bold />
                    <SumRow label={`Quote Total (×${qty})`}    val={qTotal} bold />
                    {gstPct > 0 && <SumRow label={`+ GST (${gstPct}%)`} val={gstAmt} />}
                    {gstPct > 0 && <SumRow label={`Quote Total + GST`}  val={qTotalWithGST} highlight />}
                    {gstPct === 0 && <SumRow label={`Quote Total`}       val={qTotal} highlight />}
                  </>;
                })()}
              </>}
            </div>
          </div>

        </div>{/* end id-body */}

        {/* Footer */}
        <div className="id-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          {!isReadOnly && (
            <button className="btn btn-primary" onClick={() => { onApply({ row: { ...row, _fieldModes: modes }, qrow }); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              ✓ Apply to Item
            </button>
          )}
        </div>

      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCING MODAL  — full-screen modal, same as old design but items use
//                   new card-table row with Calculate button at the end
// ─────────────────────────────────────────────────────────────────────────────
function SourcingModal({ enq, suppliers, customers, users, quotes, onClose, onSaved, onSavedDraft, forceReadOnly = false }) {
  const { user } = useAuth();

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api.get('/inventory').then(r => Array.isArray(r.data) ? r.data : []),
    staleTime: 60000,
  });

  const [srcRows, setSrcRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      if (ex) {
        const supType = suppliers.find(s => s.id === ex.supplier_id)?.type || 'domestic';
        const isIntl  = supType === 'international';
        const hasData = Number(ex.sourced_price) > 0;
        return {
          ...ex,
          supplier_id: ex.supplier_id || '',
          // Strip migration defaults — only use numeric values when real data was entered
          freight_pct:         hasData ? (ex.freight_pct  ?? '') : '',
          insurance_pct:       hasData ? (ex.insurance_pct ?? '') : '',
          duty_pct:            hasData ? (ex.duty_pct     ?? '') : '',
          cess_pct:            hasData ? (ex.cess_pct     ?? '') : '',
          clearance_fixed_inr: hasData ? (ex.clearance_fixed_inr ?? '') : '',
          margin_pct:          hasData ? (ex.margin_pct   ?? '') : '',
          bank_fixed_foreign:  isIntl  ? (ex.bank_fixed_usd ?? '') : '',
          bank_fixed_inr:     !isIntl  ? (ex.bank_fixed_usd ?? '') : '',
          // ALWAYS preserve sent_to_enquiry flag regardless of supplier
          sent_to_enquiry:     ex.sent_to_enquiry ? 1 : 0,
          sent_to_enquiry_note: ex.sent_to_enquiry_note || '',
          preferred_delivery_date: ex.preferred_delivery_date || item.preferred_delivery_date || '',
          _transport: ex._transport || '', _packaging: ex._packaging || '',
          _buffer: ex._buffer || '', _gst_pct: ex._gst_pct || '',
          src_dc: ex.src_dc || '', delivery_promise_date: ex.delivery_promise_date || '',
        };
      }
      // No sourcing row in DB yet — blank slate
      return { id: null, enquiry_item_id: item.id, supplier_id: '', sourced_price: '', sourced_currency: 'INR', src_price_foreign: '', exchange_rate: '', hsn_code: '', availability: '', lead_time: '', notes: '', freight_pct: '', insurance_pct: '', duty_pct: '', cess_pct: '', bank_fixed_foreign: '', bank_fixed_inr: '', clearance_fixed_inr: '', margin_pct: '', preferred_delivery_date: item.preferred_delivery_date || '', _transport: '', _packaging: '', _buffer: '', _gst_pct: '', src_dc: '', delivery_promise_date: '', sent_to_enquiry: 0, sent_to_enquiry_note: '' };
    })
  );

  const [quoteRows, setQuoteRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      return { enquiry_item_id: item.id, quote_price: ex?.quote_price || '', quote_currency: ex?.quote_currency || item.target_currency || 'INR', tax_rate: ex?.tax_rate ?? '' };
    })
  );

  const [sendInProgress, setSendInProgress] = useState(false);

  const [charges, setCharges] = useState({ customs: enq.charges?.customs || '', handling: enq.charges?.handling || '', freight: enq.charges?.freight || '', bank: enq.charges?.bank || '', insurance: enq.charges?.insurance || '', duty: enq.charges?.duty || '', cess: enq.charges?.cess || '', clearance: enq.charges?.clearance || '', currency: enq.charges?.currency || 'INR', notes: enq.charges?.notes || '' });

  const [assignTo, setAssignTo]   = useState(enq.assigned_to || '');
  const [saving, setSaving]       = useState(false);
  const [saveMode, setSaveMode]   = useState('');
  const [srcRevNotes, setSrcRevNotes] = useState({});
  const [drawerItemIdx, setDrawerItemIdx] = useState(null);
  const [domesticMarginMode, setDomesticMarginMode] = useState({});
  const [notePopover, setNotePopover] = useState(null);
  const [notePopoverPos, setNotePopoverPos] = useState({ top: 0, left: 0 });
  // Send-to-ENQ reason modal
  const [sendModal, setSendModal] = useState(null); // { itemIdx: null|number, label: string }
  const [sendNote, setSendNote] = useState('');

  const custName   = id => customers.find(c => c.id === id)?.name || id;
  const srcingUsers = users.filter(u => u.department === 'sourcing');

  const updSrc   = (idx, k, v) => setSrcRows(p  => p.map((r, i) => i === idx ? { ...r, [k]: v } : r));
  const updQuote = (idx, k, v) => setQuoteRows(p => p.map((r, i) => i === idx ? { ...r, [k]: v } : r));

  const pendingRevision = enq.status === 'returned_to_sourcing'
    ? ((quotes || []).find(q => q.enquiry_id === enq.id && q.status === 'active' && (q.revision || 1) > 1) || null)
    : null;
  const isRevision = !!pendingRevision;
  const isQuoted   = enq.status === 'quoted' && !pendingRevision;
  // isWholeEnquirySent: all items have sent_to_enquiry flag AND status is still modify_requested
  // Used only for footer banner — not for isReadOnly (rowLocked handles per-item locking)
  const isWholeEnquirySent = enq.status === 'modify_requested' && srcRows.length > 0 && srcRows.every(r => Boolean(r.sent_to_enquiry));
  // isReadOnly: only for completed/quoted states — NOT for modify_requested (rowLocked handles that per-item)
  const isReadOnly = forceReadOnly || isQuoted || ['ordered', 'order_created'].includes(enq.status);

  const marginData = useMemo(() => {
    const rows = (enq.items || []).map((item, idx) => {
      const src  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const qty  = Number(item.quantity) || 0;
      const isInvRowMd = !!src.supplier_id?.startsWith('__inv__');
      const invHitMd   = isInvRowMd ? inventoryItems.find(h => h.id === src.supplier_id.slice(7)) : null;
      const supType = isInvRowMd ? ((invHitMd?.target_currency || 'INR') !== 'INR' ? 'international' : 'domestic') : (suppliers.find(s => s.id === src.supplier_id)?.type || 'domestic');
      const savedModes = src._fieldModes || {};
      const lc  = calcLanded({ ...src, _supType: supType }, item, savedModes);
      const srcUnit   = Number(src.sourced_price) || 0;
      const quoteUnit = Number(qrow.quote_price)  || 0;
      const target    = Number(item.target_price) || 0;
      const srcForeign = Number(src.src_price_foreign) || 0;
      const exchangeRate = Number(src.exchange_rate) || 1;
      const srcCurrency  = src.sourced_currency || 'INR';
      const srcTotal   = srcUnit * qty;
      const quoteTotal = quoteUnit * qty;
      const grossMarginUnit  = quoteUnit - srcUnit;
      const grossMarginTotal = quoteTotal - srcTotal;
      const aboveTarget = target > 0 && (srcUnit > target || quoteUnit > target);
      // addl cost per item = all charges (freight, insurance, transport, packaging, bcd, sws, cess, clearing, bank, buffer)
      const addlCostItem = lc.freightINR + lc.insuranceINR + lc.transportINR + lc.packagingINR +
                           lc.bcdAmount + lc.swsAmount + lc.cessAmount + lc.clearingINR + lc.bankINR + lc.bufferINR;
      return { srcUnit, quoteUnit, srcTotal, quoteTotal, grossMarginUnit, grossMarginTotal, target, qty, aboveTarget, exchangeRate, srcCurrency, srcForeign, lc, addlCostItem, quoteAbove: target > 0 && quoteUnit > target };
    });
    const totalSrcValue    = rows.reduce((s, r) => s + r.srcTotal, 0);
    const totalQuoteValue  = rows.reduce((s, r) => s + r.quoteTotal, 0);
    const totalGrossMargin = totalQuoteValue - totalSrcValue;
    const rowAddlCost      = rows.reduce((s, r) => s + r.addlCostItem, 0);
    const enquiryAddlCost  = ['customs','handling','freight','bank','insurance','duty','cess','clearance'].reduce((s, k) => s + (Number(charges[k]) || 0), 0);
    const addlCost         = rowAddlCost + enquiryAddlCost;
    const totalNetMargin   = totalGrossMargin - addlCost;
    const netMarginPct     = totalSrcValue > 0 ? (totalNetMargin / totalSrcValue * 100) : 0;
    return { rows, totalSrcValue, totalQuoteValue, totalGrossMargin, addlCost, totalNetMargin, netMarginPct };
  }, [srcRows, quoteRows, charges, enq.items, suppliers, inventoryItems]);

  const allFieldsFilled = useMemo(() => {
    return (enq.items || []).every((item, idx) => {
      const row  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const isInvRow = !!row.supplier_id?.startsWith('__inv__');
      const invHitRow = isInvRow ? inventoryItems.find(h => h.id === row.supplier_id.slice(7)) : null;
      const supType   = isInvRow ? ((invHitRow?.target_currency || 'INR') !== 'INR' ? 'international' : 'domestic') : (suppliers.find(s => s.id === row.supplier_id)?.type || 'domestic');
      const isIntlSup = supType === 'international';
      const lt = (row.lead_time || '').toString().trim();
      return !!row.supplier_id && Number(row.sourced_price) > 0
        && lt && lt !== '0' && lt !== '0 Days' && lt !== '0 Weeks' && lt !== '0 Months'
        && Number(qrow.quote_price) > 0
        && (!isIntlSup || Number(row.exchange_rate) > 0)
        && (!isIntlSup || Number(row.src_price_foreign) > 0)
        && (qrow.tax_rate !== '' && qrow.tax_rate != null);
    });
  }, [srcRows, quoteRows, enq.items, suppliers, inventoryItems]);

  const handleSave = async (mode) => {
    if (mode === 'quote' || mode === 'return_revision') {
      for (let i = 0; i < srcRows.length; i++) {
        const item = enq.items?.[i];
        const lt = (srcRows[i].lead_time || '').toString().trim();
        if (!lt || lt === '0' || lt === '0 Days' || lt === '0 Weeks' || lt === '0 Months') { toast.error(`Lead Time is required for "${item?.component || 'item ' + (i + 1)}"`); return; }
        if ((quoteRows[i] || {}).tax_rate === '' || (quoteRows[i] || {}).tax_rate == null) { toast.error(`GST / Tax is required for "${item?.component || 'item ' + (i + 1)}"`); return; }
      }
    }
    setSaving(true); setSaveMode(mode);
    try {
      const rowsToSave = srcRows.map(r => {
        const qrow = quoteRows.find(q => q.enquiry_item_id === r.enquiry_item_id) || quoteRows[0];
        const item = enq.items?.find(i => i.id === r.enquiry_item_id);
        const isInvHolder = r.supplier_id?.startsWith('__inv__');
        const invHit = isInvHolder ? inventoryItems.find(h => h.id === r.supplier_id.slice(7)) : null;
        const invNote = isInvHolder ? ((invHit?.holder_display || invHit?.holder_name || 'Internal Stock') + (invHit?.date_code ? ' DC:' + invHit.date_code : '')) : '';
        const resolved = isInvHolder ? { ...r, notes: [r.notes, invNote].filter(Boolean).join(' | ') } : r;
        const supType = isInvHolder ? ((invHit?.target_currency || 'INR') !== 'INR' ? 'international' : 'domestic') : (suppliers.find(s => s.id === resolved.supplier_id)?.type || 'domestic');
        const normalized = supType === 'international' ? resolved : { ...resolved, insurance_pct: '0', duty_pct: '0', cess_pct: '0', bank_fixed_foreign: '0', bank_fixed_inr: '0', clearance_fixed_inr: '0' };
        const calc = calcRow({ ...normalized, _supType: supType }, item || { quantity: 1 });
        const bankFixedUsd = supType === 'international' ? ((normalized.bank_fixed_foreign !== '' && normalized.bank_fixed_foreign != null) ? normalized.bank_fixed_foreign : (normalized.bank_fixed_usd ?? null)) : '0';
        return { ...normalized, id: r.id || ('src_' + r.enquiry_item_id + '_' + Date.now()), bank_fixed_usd: bankFixedUsd, quote_price: (qrow?.quote_price !== '' && qrow?.quote_price != null) ? qrow.quote_price : null, quote_currency: qrow?.quote_currency || 'INR', tax_rate: (qrow?.tax_rate !== '' && qrow?.tax_rate != null) ? Number(qrow.tax_rate) : null, sourcing_revision_notes: srcRevNotes[r.enquiry_item_id] || null, freight_inr: calc.freight || null, insurance_inr: calc.insurance || null, duty_inr: calc.duty || null, cess_inr: calc.cess || null, bank_inr: calc.bank || null, clearance_inr: calc.clearance || null, margin_inr: calc.margin || null };
      });
      const newStatus = (mode === 'quote' || mode === 'return_revision') ? 'quoted' : 'sourcing';
      const action    = mode === 'quote' ? 'Sent to Quote Bin' : mode === 'draft' ? 'Saved as draft in Sourcing' : 'Sourcing saved';
      await api.put(`/enquiries/${enq.id}`, { sourcing: rowsToSave, charges, status: newStatus, assigned_to: assignTo || null, _action: action });
      if (mode === 'quote' || mode === 'return_revision') {
        const srcSummary = rowsToSave.map((r, idx) => { const item = enq.items?.find(i => i.id === r.enquiry_item_id) || enq.items?.[idx]; if (!item) return null; const srcDisplay = (r.src_price_foreign && r.exchange_rate) ? `${r.sourced_currency} ${r.src_price_foreign} (=₹${r.sourced_price || '—'} @ rate ${r.exchange_rate})` : `₹ ${r.sourced_price || '—'}`; return `${item.component}: Quote ${r.quote_currency} ${r.quote_price || '—'} | Src ${srcDisplay} | Qty ${item.quantity}${srcRevNotes[r.enquiry_item_id] ? ' | Note: ' + srcRevNotes[r.enquiry_item_id] : ''}`; }).filter(Boolean).join('\n');
        const addlTotal = ['customs','handling','freight','bank','insurance','duty','cess','clearance'].reduce((s, k) => s + (Number(charges[k]) || 0), 0);
        const fullNotes = srcSummary + (addlTotal > 0 ? `\nAdditional charges: ${JSON.stringify(charges)}` : '');
        if (mode === 'return_revision' && pendingRevision) {
          try { await api.put('/quotes/' + pendingRevision.id, { quote_no: pendingRevision.quote_no, zoho_quote_no: pendingRevision.zoho_quote_no || '', file_ref: pendingRevision.file_ref || '', valid_until: pendingRevision.valid_until || '', status: 'active', notes: fullNotes }); toast.success('✅ Prices updated — ' + pendingRevision.quote_no + ' returned to Quote Bin!'); }
          catch (e) { toast.error('Failed to update revision quote: ' + (e.response?.data?.error || e.message)); }
        } else {
          let quoteNo = '';
          try { const res = await api.get('/next-quote-no'); quoteNo = res.data.quote_no; }
          catch (_) { const y = new Date().getFullYear(), m = new Date().getMonth() + 1, s = m >= 4 ? y : y - 1; quoteNo = `QT-${String(s).slice(2)}${String(s+1).slice(2)}-${String((quotes||[]).length+1).padStart(4,'0')}`; }
          try { await api.post('/quotes', { enquiry_id: enq.id, customer_id: enq.customer_id, quote_no: quoteNo, zoho_quote_no: '', file_ref: '', valid_until: '', status: 'active', notes: fullNotes, existing_order_id: enq.existing_order_id || null }); toast.success('✅ Sent to Quote Bin! Quote ' + quoteNo + ' created.'); }
          catch (qErr) { console.warn('Quote auto-create skipped:', qErr.response?.data?.error); toast.success('Sourcing saved — check Quote Bin'); }
        }
      } else if (mode === 'draft') { toast.success('Saved as draft'); }
      else { toast.success('Sourcing saved'); }
      if (mode === 'quote' || mode === 'return_revision' || mode === 'draft') { onSaved(); }
      else if (onSavedDraft) { onSavedDraft(); }
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); setSaveMode(''); }
  };

  const handleSendToEnquiry = (itemIdx = null) => {
    const item = itemIdx === null ? null : enq.items[itemIdx];
    const label = item ? `"${item.component}"` : 'full enquiry';
    setSendNote('');
    setSendModal({ itemIdx, label });
  };

  const handleSendConfirm = async () => {
    if (!sendNote.trim()) return;
    const { itemIdx } = sendModal;
    const item = itemIdx === null ? null : enq.items[itemIdx];
    const note = sendNote.trim();
    setSendModal(null);
    setSendInProgress(true);
    try {
      // Update local state to show locks immediately
      const updatedRows = itemIdx === null
        ? srcRows.map(r => ({ ...r, sent_to_enquiry: 1, sent_to_enquiry_note: null }))
        : srcRows.map((r, idx) => idx === itemIdx ? { ...r, sent_to_enquiry: 1, sent_to_enquiry_note: note } : r);
      setSrcRows(updatedRows);

      // Only send the sent_to_enquiry flag — NOT the sourcing data (prices, supplier etc)
      // Unsaved field edits are discarded; only "Save as Draft" persists sourcing data
      const flagRowsOnly = itemIdx === null
        ? (enq.sourcing || []).map(s => ({ _flagOnly: true, id: s.id, enquiry_item_id: s.enquiry_item_id, sent_to_enquiry: 1, sent_to_enquiry_note: null }))
        : (() => {
            const srcItem = enq.items[itemIdx];
            const existing = (enq.sourcing || []).find(s => s.enquiry_item_id === srcItem.id);
            return [{ _flagOnly: true, id: existing?.id || null, enquiry_item_id: srcItem.id, sent_to_enquiry: 1, sent_to_enquiry_note: note }];
          })();

      const actionText = itemIdx === null
        ? `Sent full enquiry back to Enquiry: ${note}`
        : `Sent item "${item.component}" back to Enquiry: ${note}`;

      await api.put(`/enquiries/${enq.id}`, {
        sourcing: flagRowsOnly,
        status: 'modify_requested',
        assigned_to: assignTo || null,
        ...(itemIdx === null ? { send_to_enq_note: note } : {}),
        _action: actionText,
      });
      toast.success(itemIdx === null ? '✅ Enquiry sent back to Enquiry section.' : `✅ "${item.component}" sent back to Enquiry section.`);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Send to Enquiry failed');
    } finally {
      setSendInProgress(false);
    }
  };

  const md = marginData;

  // When drawer Apply is clicked, merge the edited row/qrow back into state
  const handleDrawerApply = (idx, { row, qrow }) => {
    setSrcRows(p => p.map((r, i) => i === idx ? { ...r, ...row } : r));
    setQuoteRows(p => p.map((r, i) => i === idx ? { ...r, ...qrow } : r));
  };

  return (
    <div className="overlay" style={{ padding: '16px', alignItems: 'stretch' }}>
      <div className="modal" style={{ width: '100%', maxWidth: '100%', margin: '0', borderRadius: 12, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 10px)', maxHeight: 'calc(100vh - 10px)' }}>

        {/* Modal Header */}
        <div className="modal-header" style={{ padding: '12px 20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)' }}>📩 {enq.id}</span>
              {enq.sourcing_no && <>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-lt)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--accent)33', fontWeight: 600 }}>🔍 {enq.sourcing_no}</span>
              </>}
              {pendingRevision && <>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--amber,#d97706)', background: 'var(--amber-lt,#fffbeb)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--amber,#d97706)44', fontWeight: 700 }}>📄 {pendingRevision.quote_no}</span>
              </>}
            </div>
            <h2 style={{ marginBottom: 0 }}>🔍 {maskName(custName(enq.customer_id))}</h2>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {enq.items?.length || 0} component{enq.items?.length !== 1 ? 's' : ''} · Priority: <strong style={{ color: enq.priority === 'urgent' ? 'var(--red)' : enq.priority === 'high' ? 'var(--amber)' : 'inherit' }}>{enq.priority}</strong> · Created {fmtDateTime(enq.created_at)}
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status} />
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 20px' }} onClick={() => setNotePopover(null)}>

          {/* Whole-ENQ sent-to-ENQ banner — single note for whole enquiry */}
          {isWholeEnquirySent && enq.send_to_enq_note && (
            <div style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 'var(--r)', border: '2px solid #d97706', background: '#fffbeb', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>📨</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706', marginBottom: 4 }}>Full Enquiry sent to Enquiry section</div>
                <div style={{ fontSize: 12, color: '#92400e', fontStyle: 'italic' }}>Reason: "{enq.send_to_enq_note}"</div>
              </div>
            </div>
          )}

          {/* Revision banners */}
          {isRevision && pendingRevision.sales_revision_notes && (
            <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 'var(--r)', border: '2px solid var(--amber,#d97706)', background: 'var(--amber-lt,#fffbeb)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--amber,#d97706)' }}>Quote Revision Requested — {pendingRevision.quote_no}</div><div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>Sales has sent this back for re-pricing. Update the quote prices below and return to Quote Bin.</div></div>
              </div>
              <div style={{ padding: '8px 12px', background: '#fff', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--text)', fontStyle: 'italic', border: '1px solid var(--amber,#d97706)33' }}>💬 Sales note: "{pendingRevision.sales_revision_notes}"</div>
            </div>
          )}
          {isRevision && !pendingRevision.sales_revision_notes && (
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--r)', border: '2px solid var(--amber,#d97706)', background: 'var(--amber-lt,#fffbeb)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📝</span>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--amber,#d97706)' }}>Quote Revision {pendingRevision.quote_no} is pending — update prices and return to Quote Bin.</div>
            </div>
          )}

          {/* Enquiry info bar */}
          <div style={{ background: 'var(--accent-lt)', border: '1px solid rgba(27,79,158,.2)', borderRadius: 'var(--r-sm)', padding: '9px 14px', marginBottom: 14, fontSize: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span>📋 <strong>Customer:</strong> {maskName(custName(enq.customer_id))}</span>
            {enq.notes && <span>📝 <strong>Notes:</strong> {enq.notes}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="label" style={{ margin: 0 }}>Assigned:</label>
              <select className="input" style={{ padding: '3px 8px', fontSize: 12, minWidth: 140 }} value={assignTo} onChange={e => setAssignTo(e.target.value)} disabled={isReadOnly}>
                <option value="">— Unassigned —</option>
                {srcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </span>
          </div>

          {/* ── Per-Item Cards ── */}
          <div className="card card-sm" style={{ marginBottom: 0, overflowX: 'auto' }}>
            <div className="card-title" style={{ marginBottom: 8 }}>
              <span>📦 Components — Sourcing &amp; Quote Pricing</span>
            </div>

            {/* Single unified grid — heading always visible, same columns always */}
            {/* Columns: # | MPN | Manufacturer | Supplier | Qty | HSN | Lead Time | Src Price | Margin | Quote/Unit | Quote Total | GST | Quote+GST | action */}
            <div style={{ display:'grid', gridTemplateColumns:'24px 1fr 0.5fr 1.2fr 44px 0.6fr 0.9fr 0.8fr 1fr 0.8fr 0.8fr 0.7fr 1fr 56px', gap:'0 6px', padding:'6px 14px', background:'#1e293b', borderRadius:'6px 6px 0 0' }}>
              {[
                {l:'#',          align:'center'},
                {l:'MPN',        align:'center'},
                {l:'Mfr',        align:'center'},
                {l:'Supplier',   align:'center'},
                {l:'Qty',        align:'center'},
                {l:'HSN',        align:'center'},
                {l:'Lead Time',  align:'center'},
                {l:'Src Price',  align:'center'},
                {l:'Margin/Unit',align:'center'},
                {l:'Quote/Unit', align:'center'},
                {l:'Quote Total',align:'center'},
                {l:'GST',        align:'center'},
                {l:'Quote+GST',  align:'center'},
                {l:'',           align:'center'},
              ].map((h,i) => (
                <div key={i} style={{ fontSize:10, fontWeight:700, color:'#fff', textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap', textAlign:h.align }}>{h.l}</div>
              ))}
            </div>

            {(enq.items || []).map((item, idx) => {
              const row   = srcRows[idx]   || {};
              const qrow  = quoteRows[idx] || {};
              const mrow  = md.rows[idx]   || {};
              const isInvStock  = !!row.supplier_id?.startsWith('__inv__');
              const invStockHit = isInvStock ? inventoryItems.find(h => h.id === row.supplier_id.slice(7)) : null;
              const invIsIntl   = isInvStock && invStockHit && (invStockHit.target_currency || 'INR') !== 'INR';
              const supType    = isInvStock ? (invIsIntl ? 'international' : 'domestic') : (suppliers.find(s => s.id === row.supplier_id)?.type || 'domestic');
              const isIntlItem = supType === 'international';
              const isDomestic = !isIntlItem && !!row.supplier_id;
              const qty           = Number(item.quantity) || 1;
              const gstRate       = Number(qrow.tax_rate) || 0;
              const quoteUnit     = Number(qrow.quote_price) || 0;
              const quoteTotal    = quoteUnit * qty;
              const quoteTotalGST = gstRate > 0 ? quoteTotal * (1 + gstRate / 100) : quoteTotal;
              const srcUnit       = Number(row.sourced_price) || 0;
              const marginMode    = domesticMarginMode[idx] || 'amt';
              const aboveTarget   = Number(item.target_price) > 0 && srcUnit > 0 && srcUnit > Number(item.target_price);

              const calcDomesticQuote = (sp, mv, mm) => {
                const s = Number(sp)||0, m = Number(mv)||0;
                if (!s) return '';
                return (mm === 'pct' ? s*(1+m/100) : s+m).toFixed(2);
              };

              const handleSupChange = (supId) => {
                if (!supId) {
                  updSrc(idx,'supplier_id','');
                  setDomesticMarginMode(p => { const n={...p}; delete n[idx]; return n; });
                  return;
                }
                if (supId.startsWith('__inv__')) {
                  const hit = inventoryItems.find(h => h.id === supId.slice(7));
                  const stCur = hit?.target_currency || 'INR';
                  const isStockIntl = stCur !== 'INR';
                  const price = hit?.target_price ? String(hit.target_price) : '';
                  if (isStockIntl) {
                    setSrcRows(p => p.map((r,i) => i===idx ? {...r, supplier_id:supId, sourced_currency:stCur, src_price_foreign:price, exchange_rate:'', sourced_price:'', margin_pct:'', freight_pct:'', lead_time:'', hsn_code:'', notes:''} : r));
                  } else {
                    setSrcRows(p => p.map((r,i) => i===idx ? {...r, supplier_id:supId, sourced_currency:'INR', sourced_price:price, src_price_foreign:'', exchange_rate:'', insurance_pct:'', duty_pct:'', cess_pct:'', bank_fixed_foreign:'', bank_fixed_inr:'', clearance_fixed_inr:'', margin_pct:'', freight_pct:'', lead_time:'', hsn_code:'', notes:''} : r));
                  }
                  setQuoteRows(p => p.map((r,i) => i===idx ? {...r, quote_currency:'INR', quote_price:'', tax_rate:''} : r));
                  setDomesticMarginMode(p => { const n={...p}; delete n[idx]; return n; });
                  return;
                }
                const sup = suppliers.find(s => s.id === supId);
                const st  = sup?.type || 'domestic';
                if (st === 'international') {
                  setSrcRows(p => p.map((r,i) => i===idx ? {...r, supplier_id:supId, sourced_currency:sup?.currency&&sup.currency!=='INR'?sup.currency:'USD', sourced_price:'', src_price_foreign:'', exchange_rate:'', margin_pct:'', freight_pct:'', lead_time:'', hsn_code:'', notes:''} : r));
                } else {
                  setSrcRows(p => p.map((r,i) => i===idx ? {...r, supplier_id:supId, sourced_currency:'INR', src_price_foreign:'', exchange_rate:'', insurance_pct:'', duty_pct:'', cess_pct:'', bank_fixed_foreign:'', bank_fixed_inr:'', clearance_fixed_inr:'', sourced_price:'', margin_pct:'', freight_pct:'', lead_time:'', hsn_code:'', notes:''} : r));
                }
                setQuoteRows(p => p.map((r,i) => i===idx ? {...r, quote_currency:'INR', quote_price:'', tax_rate:''} : r));
                setDomesticMarginMode(p => { const n={...p}; delete n[idx]; return n; });
              };

              const handleSrcPrice = (val) => {
                updSrc(idx,'sourced_price',val);
                updQuote(idx,'quote_price', calcDomesticQuote(val, row.margin_pct, marginMode));
              };
              const handleMargin = (val) => {
                updSrc(idx,'margin_pct',val);
                const qp = calcDomesticQuote(row.sourced_price, val, marginMode);
                if (qp) updQuote(idx,'quote_price',qp);
              };
              const toggleMarginMode = () => {
                const nm = marginMode==='pct'?'amt':'pct';
                setDomesticMarginMode(p=>({...p,[idx]:nm}));
                const qp = calcDomesticQuote(row.sourced_price, row.margin_pct, nm);
                if (qp) updQuote(idx,'quote_price',qp);
              };

              const _comp = (item.component||'').toLowerCase().trim();
              const _mfr  = (item.manufacturer||'').toLowerCase().trim();
              const itemStockHits = (() => {
                const map = {};
                inventoryItems.forEach(inv => {
                  if ((inv.quantity_available||0)<=0) return;
                  const c=(inv.component||'').toLowerCase().trim(), m=(inv.manufacturer||'').toLowerCase().trim();
                  if (!c) return;
                  if (m) { const k=c+'|'+m; if (!map[k]) map[k]=[]; map[k].push(inv); }
                  const k0=c+'|'; if (!map[k0]) map[k0]=[]; map[k0].push(inv);
                });
                return _mfr?(map[_comp+'|'+_mfr]||[]):(map[_comp+'|']||[]);
              })();

              const inp = { className:'input', style:{ height:32, fontSize:13, width:'100%', textAlign:'center' } };

              // Lock based purely on sent_to_enquiry flag from DB.
              // Server clears this flag when ENQ resubmits to sourcing → item unlocks automatically.
              const rowLocked = Boolean(row.sent_to_enquiry);
              const sentNote = row.sent_to_enquiry_note ? row.sent_to_enquiry_note.trim() : '';
              return (
                <div key={item.id} style={{ borderTop:'1px solid var(--border)', background: rowLocked ? '#f8fafc' : mrow.aboveTarget ? '#fff5f5' : '#fff' }}>

                  {/* ── Main row grid ── */}
                  <div style={{ display:'grid', gridTemplateColumns:'24px 1fr 0.5fr 1.2fr 44px 0.6fr 0.9fr 0.8fr 1fr 0.8fr 0.8fr 0.7fr 1fr 56px', gap:'0 6px', padding:'6px 14px', alignItems:'center' }}>

                    {/* # */}
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--text3)', textAlign:'center' }}>{idx+1}</div>

                    {/* MPN */}
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontWeight:800, fontSize:13, color:'var(--accent)', letterSpacing:'-.01em' }}>{item.component}</div>
                      {item.ipn && <div style={{ fontSize:9, fontFamily:'monospace', color:'#9ca3af' }}>IPN: {item.ipn}</div>}
                    </div>

                    {/* Manufacturer */}
                    <div style={{ fontSize:13, color:'var(--text2)', textAlign:'center' }}>{item.manufacturer||'—'}</div>

                    {/* Supplier dropdown — always */}
                    <select {...inp} value={row.supplier_id||''} disabled={isReadOnly || rowLocked}
                      style={{ height:32, fontSize:13, width:'100%', textAlign:'left', fontWeight:row.supplier_id?600:400, borderColor:row.supplier_id?.startsWith('__inv__')?'#86efac':undefined, color:row.supplier_id?.startsWith('__inv__')?'#15803d':undefined }}
                      onChange={e=>handleSupChange(e.target.value)}>
                      <option value="">— Select —</option>
                      {itemStockHits.length>0 && <optgroup label="📦 IN STOCK">{itemStockHits.map(h=><option key={'__inv__'+h.id} value={'__inv__'+h.id}>{h.holder_type==='customer'?'👤':h.holder_type==='supplier'?'🏢':'🏭'} {h.holder_display||h.holder_name||'Warehouse'}{h.target_price?' — '+(h.target_currency||'INR')+' '+Number(h.target_price).toLocaleString('en-IN',{maximumFractionDigits:2}):''} ({h.quantity_available} pcs)</option>)}</optgroup>}
                      {itemStockHits.length>0 && <option disabled>──────────</option>}
                      {suppliers.map(s=><option key={s.id} value={s.id}>{s.name} {s.type==='domestic'?'🇮🇳':'🌐'}</option>)}
                    </select>

                    {/* Qty */}
                    <div style={{ textAlign:'center', fontWeight:700, fontSize:13 }}>{item.quantity}</div>

                    {/* HSN */}
                    {isDomestic
                      ? <input {...inp} value={row.hsn_code||''} disabled={isReadOnly || rowLocked} onChange={e=>updSrc(idx,'hsn_code',e.target.value)} />
                      : <div style={{ textAlign:'center', color:row.hsn_code?'var(--text2)':'var(--text3)', fontSize:13 }}>{row.hsn_code||'—'}</div>}

                    {/* Lead Time */}
                    {isDomestic
                      ? <div style={{ display:'flex', gap:3 }}>
                          <input className="input" style={{ flex:1, height:32, fontSize:13, textAlign:'center', minWidth:0 }} type="number" min="1"
                            value={(row.lead_time||'').replace(/[^0-9]/g,'')} disabled={isReadOnly || rowLocked}
                            onChange={e=>{ const u=(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days'; updSrc(idx,'lead_time',e.target.value?e.target.value+' '+u:''); }} />
                          <select className="input" style={{ flex:'1 1 0', height:32, fontSize:12, minWidth:0, cursor:'pointer' }}
                            value={(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days'}
                            disabled={isReadOnly || rowLocked}
                            onChange={e=>{ const n=(row.lead_time||'').replace(/[^0-9]/g,'')||''; updSrc(idx,'lead_time',n?n+' '+e.target.value:''); }}>
                            <option value="Days">Days</option><option value="Weeks">Weeks</option><option value="Months">Months</option>
                          </select>
                        </div>
                      : <div style={{ textAlign:'center', color:row.lead_time?'var(--text2)':'var(--text3)', fontSize:13 }}>{row.lead_time||'—'}</div>}

                    {/* Source Price (INR) */}
                    {isDomestic
                      ? <input {...inp} type="number" step="0.01" min="0" value={row.sourced_price||''} disabled={isReadOnly || rowLocked}
                          style={{ height:32, fontSize:13, width:'100%', textAlign:'center', borderColor:aboveTarget?'var(--red)':undefined, background:aboveTarget?'#fee2e2':undefined }}
                          onChange={e=>{ if(Number(e.target.value)<0) return; handleSrcPrice(e.target.value); }} />
                      : <div style={{ textAlign:'center', fontWeight:700, color:srcUnit>0?'var(--text)':'var(--text3)', fontSize:13 }}>
                          {srcUnit>0 ? <>
                            <div>{`₹${fmt(srcUnit)}`}</div>
                            {row.src_price_foreign && row.sourced_currency && row.sourced_currency!=='INR' &&
                              <div style={{ fontSize:9, color:'var(--text3)', fontWeight:500 }}>{row.sourced_currency} {fmt(row.src_price_foreign)}</div>}
                          </> : '—'}
                        </div>}

                    {/* Margin/Unit */}
                    {isDomestic
                      ? <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                          <input className="input" type="number" step="0.01" min="0" value={row.margin_pct||''} disabled={isReadOnly || rowLocked}
                            style={{ flex:1, height:32, fontSize:13, minWidth:0, textAlign:'center' }}
                            onChange={e=>{ if(Number(e.target.value)<0) return; handleMargin(e.target.value); }} />
                          <UnitToggle mode={marginMode} onToggle={toggleMarginMode} disabled={isReadOnly || rowLocked} />
                        </div>
                      : (() => {
                          const mAmt = mrow.lc?.marginAmt;
                          const hasMargin = mAmt != null && Number(mAmt) !== 0;
                          return (
                            <div style={{ textAlign:'center', fontSize:13, color: hasMargin?'#7c3aed':'var(--text3)', fontWeight: hasMargin?700:400 }}>
                              {hasMargin ? `₹${fmt(mAmt)}` : '—'}
                            </div>
                          );
                        })()}

                    {/* Quote/Unit — input if domestic, value or dash otherwise */}
                    {isDomestic
                      ? <input {...inp} type="number" step="0.01" min="0" value={qrow.quote_price||''} disabled={isReadOnly || rowLocked}
                          style={{ height:32, fontSize:13, width:'100%', textAlign:'center', fontWeight:700, background:qrow.quote_price?'var(--green-lt)':undefined, borderColor:qrow.quote_price?'var(--green)':undefined }}
                          onChange={e=>{ if(Number(e.target.value)<0) return; updQuote(idx,'quote_price',e.target.value); }} />
                      : <div style={{ textAlign:'center', fontWeight:700, color:quoteUnit>0?'var(--green)':'var(--text3)', fontSize:13 }}>{quoteUnit>0?`₹${fmt(quoteUnit)}`:'—'}</div>}

                    {/* Quote Total (×qty) — always read-only */}
                    <div style={{ textAlign:'center', fontWeight:700, fontSize:13, color:quoteTotal>0?'#7c3aed':'var(--text3)' }}>{quoteTotal>0?`₹${fmt(quoteTotal)}`:'—'}</div>

                    {/* GST — select if domestic, display value for intl */}
                    {isDomestic
                      ? <select {...inp} value={qrow.tax_rate??''} disabled={isReadOnly || rowLocked}
                          style={{ height:32, fontSize:13, width:'100%', textAlign:'center', borderColor:(!qrow.tax_rate&&qrow.tax_rate!==0)?'#ef4444':undefined }}
                          onChange={e=>updQuote(idx,'tax_rate',e.target.value)}>
                          <option value="">—GST—</option>
                          {getTaxRates('INR').map(t=><option key={t.label} value={t.rate}>{t.label}</option>)}
                        </select>
                      : <div style={{ textAlign:'center', color:gstRate>0?'var(--text2)':'var(--text3)', fontSize:13 }}>{gstRate>0?`${gstRate}%`:'—'}</div>}

                    {/* Quote+GST — always read-only */}
                    <div style={{ textAlign:'center', fontWeight:800, fontSize:13, color:quoteTotalGST>0&&gstRate>0?'#16a34a':quoteTotalGST>0?'var(--text)':'var(--text3)' }}>
                      {quoteTotalGST>0
                        ? <><div>{`₹${fmt(quoteTotalGST)}`}</div>{gstRate>0&&<div style={{ fontSize:9, fontWeight:600, color:'#6b7280' }}>incl. {gstRate}% GST</div>}</>
                        : '—'}
                    </div>

                    {/* Action col: Calculate button for intl only + send-to-enquiry action */}
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, justifyContent:'center', minWidth:0 }}>
                      {isIntlItem && !rowLocked && !isReadOnly && <button className="btn btn-xs btn-primary" onClick={()=>setDrawerItemIdx(idx)} style={{ display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap', padding:'4px 10px' }}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>
                        Calculate
                      </button>}
                      {!isReadOnly && (!rowLocked ? (
                        <button className="btn btn-xs btn-secondary" onClick={() => handleSendToEnquiry(idx)} style={{ display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap', padding:'4px 10px' }}>
                          Send to ENQ
                        </button>
                      ) : (
                        <div style={{ display:'inline-flex', alignItems:'center', gap:4 }} onClick={e => e.stopPropagation()}>
                          {/* Status chip */}
                          <div style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:999, background:'#fffbeb', border:'1.5px solid #d97706', fontWeight:700, fontSize:11, color:'#92400e', whiteSpace:'nowrap' }}>
                            Send to ENQ
                          </div>
                          {/* Info icon — only if there's a note */}
                          {sentNote && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                if (notePopover === idx) { setNotePopover(null); return; }
                                const r = e.currentTarget.getBoundingClientRect();
                                setNotePopoverPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
                                setNotePopover(idx);
                              }}
                              style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:18, height:18, borderRadius:'50%', border:'1.5px solid #d97706', background: notePopover === idx ? '#d97706' : '#fffbeb', color: notePopover === idx ? '#fff' : '#92400e', cursor:'pointer', fontSize:11, fontWeight:900, flexShrink:0, padding:0, lineHeight:1 }}
                              title="View note"
                            >i</button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Revision notes — span full width */}
                    {isRevision && (() => { const sc=(enq.sourcing||[]).find(s=>s.enquiry_item_id===item.id)?.sales_comment; return sc?<div style={{ gridColumn:'1/-1', padding:'4px 0', background:'#fffbeb', fontSize:10, color:'#b45309', fontWeight:600 }}>💬 Sales: "{sc}"</div>:null; })()}
                    {isRevision && <div style={{ gridColumn:'1/-1' }}><input className="input" value={srcRevNotes[item.id]||''} onChange={e=>setSrcRevNotes(n=>({...n,[item.id]:e.target.value}))} placeholder="Your note to Sales (optional)…" style={{ fontSize:10, width:'100%', height:26 }} /></div>}

                  </div>{/* end main row grid */}

                  {/* ── Stock Holder info row — shown when __inv__ selected in main table ── */}
                  {row.supplier_id?.startsWith('__inv__') && (() => {
                    const hit = inventoryItems.find(h => h.id === row.supplier_id.slice(7));
                    if (!hit) return null;
                    const holderCurrency = hit.target_currency || 'INR';
                    const isHolderIntl   = holderCurrency !== 'INR';
                    const holderIcon     = hit.holder_type === 'customer' ? '👤' : hit.holder_type === 'supplier' ? '🏢' : '🏭';
                    return (
                      <div style={{
                        gridColumn: '1/-1',
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '5px 14px 7px',
                        borderTop: '1px dashed #e5e7eb',
                        background: isHolderIntl ? '#eff6ff' : '#f0fdf4',
                      }}>
                        <span style={{ fontSize: 13 }}>📦</span>
                        <span style={{
                          fontSize: 11, fontWeight: 800,
                          color: isHolderIntl ? '#1d4ed8' : '#15803d',
                        }}>
                          {isHolderIntl ? '🌐 International Stock' : '🇮🇳 Domestic Stock'}
                        </span>
                        <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>
                          {holderIcon} {hit.holder_display || hit.holder_name || 'Stock'} — {hit.quantity_available} pcs avail
                          {hit.target_price ? ` @ ${holderCurrency} ${Number(hit.target_price).toLocaleString('en-IN', { maximumFractionDigits: 4 })}` : ''}
                        </span>
                        {hit.date_code && <span style={{ fontSize: 10, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>DC: {hit.date_code}</span>}
                        <span style={{
                          marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                          padding: '2px 10px', borderRadius: 999,
                          background: isHolderIntl ? '#dbeafe' : '#dcfce7',
                          color: isHolderIntl ? '#1e40af' : '#15803d',
                          border: `1px solid ${isHolderIntl ? '#93c5fd' : '#86efac'}`,
                        }}>
                          {isHolderIntl ? '🌐 Click Calculate to fill intl fields →' : '🇮🇳 Fill Src Price, Lead Time & GST'}
                        </span>
                      </div>
                    );
                  })()}

                  {/* ── Domestic sub-row: only shown after supplier selected ── */}
                  {isDomestic && row.supplier_id && (
                    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'5px 14px 7px', borderTop:'1px dashed #e5e7eb', background:'#fafafa' }}>

                      {/* Line Note — label + field inline */}
                      <span style={{ fontSize:10, fontWeight:700, color:'#6b7280', letterSpacing:.4, whiteSpace:'nowrap', flexShrink:0 }}>LINE NOTE</span>
                      <input className="input" value={row.notes||''} placeholder="Note to team…"
                        onChange={e=>updSrc(idx,'notes',e.target.value)} disabled={isReadOnly || rowLocked}
                        style={{ flex:'1 1 0', minWidth:100, maxWidth:320, height:28, fontSize:11, padding:'2px 8px' }}/>

                      {/* right-side chips — label + chip inline, pushed to far right */}
                      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>

                        {Number(item.target_price) > 0 && <>
                          <span style={{ fontSize:10, fontWeight:700, color:'#6b7280', letterSpacing:.4, whiteSpace:'nowrap' }}>TARGET PRICE</span>
                          <div style={{
                            height:28, fontSize:11, padding:'2px 10px',
                            background: mrow.aboveTarget ? '#fee2e2' : '#dcfce7',
                            border: `1px solid ${mrow.aboveTarget ? '#fca5a5' : '#86efac'}`,
                            borderRadius:'var(--r-sm)', fontWeight:700,
                            color: mrow.aboveTarget ? '#dc2626' : '#16a34a',
                            display:'flex', alignItems:'center', whiteSpace:'nowrap',
                          }}>
                            🎯 {item.target_currency||'INR'} {item.target_price}{mrow.aboveTarget?' ⚠':''}
                          </div>
                        </>}

                        {item.date_code && <>
                          <span style={{ fontSize:10, fontWeight:700, color:'#6b7280', letterSpacing:.4, whiteSpace:'nowrap' }}>DC</span>
                          <div style={{ height:28, fontSize:11, padding:'2px 10px', background:'#f3f4f6', border:'1px solid #d1d5db', borderRadius:'var(--r-sm)', fontWeight:700, color:'#374151', display:'flex', alignItems:'center', whiteSpace:'nowrap' }}>
                            {item.date_code}
                          </div>
                        </>}

                        {item.preferred_delivery_date && <>
                          <span style={{ fontSize:10, fontWeight:700, color:'#6b7280', letterSpacing:.4, whiteSpace:'nowrap' }}>PROMISE DATE</span>
                          <div style={{ height:28, fontSize:11, padding:'2px 10px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'var(--r-sm)', fontWeight:700, color:'#1d4ed8', display:'flex', alignItems:'center', whiteSpace:'nowrap' }}>
                            📅 {new Date(item.preferred_delivery_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                          </div>
                        </>}

                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>

        </div>

        {/* ── Margin Summary — fixed above footer, always visible ── */}
        <div style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
          <div className="card card-sm" style={{ margin: '0', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
            <div className="card-title" style={{ padding: '8px 18px 0' }}>📊 Margin Summary</div>
            <div style={{ padding: '8px 18px 10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                {(() => {
                  const hasSrc = md.totalSrcValue > 0;
                  return [
                    { label: 'Total Source Value (₹ INR)', val: md.totalSrcValue,    cur: 'INR', color: 'var(--accent)',                              show: md.totalSrcValue > 0 },
                    { label: 'Total Quote Value',           val: md.totalQuoteValue,  cur: quoteRows[0]?.quote_currency || 'INR', color: 'var(--green)', show: hasSrc && md.totalQuoteValue > 0 },
                    { label: 'Gross Margin (Quote − Source)', val: md.totalGrossMargin, cur: 'INR', color: md.totalGrossMargin >= 0 ? 'var(--green)' : 'var(--red)', show: hasSrc && md.totalQuoteValue > 0 },
                    { label: 'Net Margin (after all charges)', val: md.totalNetMargin, cur: 'INR', color: md.totalNetMargin >= 0 ? 'var(--teal,#0d9488)' : 'var(--red)', sub: hasSrc && md.totalQuoteValue > 0 ? (md.addlCost > 0 ? `Addl. costs: −₹${fmt(md.addlCost)}` : 'No addl. costs') : null, show: hasSrc && md.totalQuoteValue > 0 },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 'var(--r)', padding: '10px 14px', borderLeft: `3px solid ${s.show ? s.color : 'var(--border)'}`, boxShadow: `0 0 0 1px ${s.show ? s.color + '22' : 'transparent'}` }}>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, fontWeight: 700, letterSpacing: .2 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.show ? s.color : 'var(--text3)', letterSpacing: '-.03em', lineHeight: 1.1 }}>{s.show ? fmtC(s.val, s.cur) : '—'}</div>
                      {s.sub && <div style={{ fontSize: 11, color: s.color, marginTop: 3, fontWeight: 700, opacity: .85 }}>{s.sub}</div>}
                    </div>
                  ));
                })()}
              </div>

              {/* Per-item margin table */}
              {md.rows.some(r => r.srcUnit > 0 && r.quoteUnit > 0) && (
                <div style={{ marginTop: 10, overflowX: 'auto' }}>
                  <table className="li-table">
                    <thead>
                      <tr><th>Component</th><th>Qty</th><th>Source/Unit</th><th>Quote/Unit</th><th>Gross Margin/Unit</th><th>Gross Margin Total</th><th>vs Target</th></tr>
                    </thead>
                    <tbody>
                      {(enq.items || []).map((item, idx) => {
                        const m   = md.rows[idx] || {};
                        const src = srcRows[idx]   || {};
                        const q   = quoteRows[idx] || {};
                        if (!m.srcUnit && !m.quoteUnit) return null;
                        const isIntlRow  = m.srcCurrency && m.srcCurrency !== 'INR' && m.exchangeRate > 1;
                        const foreignSrc = isIntlRow ? m.srcForeign : 0;
                        const marginForeign = (isIntlRow && m.exchangeRate > 1) ? (m.grossMarginUnit / m.exchangeRate) : null;
                        return (
                          <tr key={item.id}>
                            <td className="bold" style={{ fontSize: 12 }}>{item.component}</td>
                            <td>{item.quantity}</td>
                            <td className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{m.srcUnit ? (isIntlRow ? <span>{fmtC(foreignSrc, m.srcCurrency)}<span style={{ color: 'var(--text3)', fontSize: 9, display: 'block' }}>=₹{fmt(m.srcUnit)}</span></span> : fmtC(m.srcUnit, 'INR')) : '—'}</td>
                            <td className="mono" style={{ color: 'var(--green)', fontSize: 11 }}>{m.quoteUnit ? fmtC(m.quoteUnit, q.quote_currency || 'INR') : '—'}</td>
                            <td className="mono bold" style={{ fontSize: 11, color: m.grossMarginUnit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {m.grossMarginUnit ? <span>{m.grossMarginUnit >= 0 ? '+' : ''}{fmtC(m.grossMarginUnit, 'INR')}{Number(src.sourced_price) > 0 && Number(src.margin_pct) > 0 && <span style={{ display: 'block', fontSize: 9, fontWeight: 700, opacity: .8 }}>{(Number(src.margin_pct) / Number(src.sourced_price) * 100).toFixed(1)}%</span>}{marginForeign != null && <span style={{ color: 'var(--text3)', fontSize: 9, display: 'block' }}>{marginForeign >= 0 ? '+' : ''}{fmtC(marginForeign, m.srcCurrency)}</span>}</span> : '—'}
                            </td>
                            <td className="mono bold" style={{ fontSize: 11, color: m.grossMarginTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{m.grossMarginTotal ? `${m.grossMarginTotal >= 0 ? '+' : ''}${fmtC(m.grossMarginTotal, 'INR')}` : '—'}</td>
                            <td>{Number(item.target_price) > 0 ? <span style={{ background: m.aboveTarget ? 'var(--red)' : 'var(--green-lt)', color: m.aboveTarget ? '#fff' : 'var(--green)', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600 }}>{m.aboveTarget ? '⚠ Above' : '✓ Within'} {item.target_currency} {item.target_price}</span> : <span className="muted">—</span>}</td>
                          </tr>
                        );
                      }).filter(Boolean)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '14px 24px' }}>
          <button className="btn" style={{ padding:'10px 24px', fontSize:14 }} onClick={onClose}>Close</button>
          {isReadOnly ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--green-lt,#f0fdf4)', border: '1px solid var(--green,#16a34a)', borderRadius: 'var(--r)', fontSize: 14, color: 'var(--green,#16a34a)', fontWeight: 600 }}>
              <span style={{ fontSize: 18 }}>✅</span>Sourcing completed — view only
            </div>
          ) : isWholeEnquirySent ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#fffbeb', border: '1.5px solid #d97706', borderRadius: 'var(--r)', fontSize: 14, color: '#92400e', fontWeight: 600 }}>
              📨 All items sent to Enquiry — waiting for ENQ update
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn" disabled={saving} onClick={() => handleSave('draft')} style={{ display: 'flex', alignItems: 'center', gap: 7, padding:'10px 24px', fontSize:14 }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 2v5h6V2"/><rect x="9" y="2" width="2" height="3"/></svg>
                {saving && saveMode === 'draft' ? 'Saving…' : 'Save as Draft'}
              </button>
              <button className="btn btn-secondary" disabled={sendInProgress || isWholeEnquirySent} onClick={() => handleSendToEnquiry(null)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding:'10px 24px', fontSize:14, background: isWholeEnquirySent ? 'var(--surface2)' : undefined, borderColor: isWholeEnquirySent ? 'var(--border)' : undefined, color: isWholeEnquirySent ? 'var(--text3)' : undefined }}>
                {sendInProgress ? 'Sending…' : isWholeEnquirySent ? 'Sent to Enquiry' : 'Send full enquiry to ENQ'}
              </button>
              {isRevision ? (
                <button className="btn btn-primary" disabled={saving || !allFieldsFilled} onClick={() => handleSave('return_revision')}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding:'10px 28px', fontSize:14, background: allFieldsFilled ? 'var(--amber,#d97706)' : 'var(--border)', borderColor: allFieldsFilled ? 'var(--amber,#d97706)' : 'var(--border)', color: allFieldsFilled ? '#fff' : 'var(--text3)', cursor: allFieldsFilled ? 'pointer' : 'not-allowed', opacity: allFieldsFilled ? 1 : 0.6 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                  {saving && saveMode === 'return_revision' ? 'Returning…' : '↩ Return to Quote Bin — ' + (pendingRevision?.quote_no || 'Revision')}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={saving || !allFieldsFilled} onClick={() => handleSave('quote')}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding:'10px 28px', fontSize:14, background: allFieldsFilled ? 'var(--accent)' : 'var(--border)', borderColor: allFieldsFilled ? 'var(--accent)' : 'var(--border)', color: allFieldsFilled ? '#fff' : 'var(--text3)', cursor: allFieldsFilled ? 'pointer' : 'not-allowed', opacity: allFieldsFilled ? 1 : 0.6 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                  {saving && saveMode === 'quote' ? 'Sending...' : 'Send to Quote Bin →'}
                </button>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Send-to-ENQ reason modal */}
      {sendModal && (
        <div className="overlay" style={{ zIndex: 600 }} onClick={() => setSendModal(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16 }}>Send to Enquiry</h2>
              <button className="close-x" onClick={() => setSendModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                Sending <strong style={{ color: 'var(--text)' }}>{sendModal.label}</strong> back to Enquiry section.
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label" style={{ fontWeight: 700 }}>Reason / Note <span style={{ color: 'var(--red)' }}>*</span></label>
                <textarea
                  className="input"
                  rows={3}
                  autoFocus
                  placeholder="e.g. Target price changed, quantity updated, wrong spec…"
                  value={sendNote}
                  onChange={e => setSendNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendConfirm(); }}
                  style={{ resize: 'vertical', fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Ctrl+Enter to confirm</div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setSendModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!sendNote.trim() || sendInProgress}
                onClick={handleSendConfirm}
                style={{ background: '#d97706', borderColor: '#d97706' }}
              >
                {sendInProgress ? 'Sending…' : '📨 Send to ENQ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note popover — fixed position so it always renders above everything */}
      {notePopover !== null && (() => {
        const note = notePopover === 'whole'
          ? (enq.send_to_enq_note || '').trim()
          : ((srcRows[notePopover] || {}).sent_to_enquiry_note || '').trim();
        if (!note) return null;
        return (
          <div style={{ position:'fixed', top: notePopoverPos.top, right: notePopoverPos.right, zIndex:9999, width:300, background:'#fff', border:'1.5px solid #d97706', borderRadius:10, boxShadow:'0 6px 24px rgba(0,0,0,.18)', padding:'14px 16px', boxSizing:'border-box' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:10, fontWeight:800, color:'#d97706', textTransform:'uppercase', letterSpacing:.6, marginBottom:8 }}>Reason from Sourcing</div>
            <div style={{ fontSize:13, color:'#92400e', lineHeight:1.7, wordBreak:'break-word', whiteSpace:'pre-wrap' }}>"{note}"</div>
            <button onClick={() => setNotePopover(null)} style={{ marginTop:12, fontSize:11, color:'#92400e', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>✕ Close</button>
          </div>
        );
      })()}

      {/* Per-item drawer — slides over the modal */}
      {drawerItemIdx !== null && enq.items?.[drawerItemIdx] && (
        <ItemDrawer
          enq={enq}
          item={enq.items[drawerItemIdx]}
          itemIdx={drawerItemIdx}
          srcRow={srcRows[drawerItemIdx] || {}}
          qRow={quoteRows[drawerItemIdx] || {}}
          suppliers={suppliers}
          inventoryItems={inventoryItems}
          isReadOnly={isReadOnly}
          onClose={() => setDrawerItemIdx(null)}
          onApply={(data) => handleDrawerApply(drawerItemIdx, data)}
        />
      )}
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────
function UnitToggle({ mode, onToggle, disabled }) {
  return (
    <button onClick={onToggle} disabled={disabled} title="Toggle % / ₹"
      style={{ display: 'inline-flex', alignItems: 'center', height: 20, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden', cursor: disabled ? 'default' : 'pointer', padding: 0, flexShrink: 0 }}>
      {['pct', 'amt'].map(m => (
        <span key={m} style={{ padding: '0 7px', fontSize: 10, fontWeight: 700, lineHeight: '20px', background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text3)', transition: 'background .15s' }}>{m === 'pct' ? '%' : '₹'}</span>
      ))}
    </button>
  );
}

function SumRow({ label, val, show = true, bold, highlight }) {
  if (!show) return null;
  return (
    <div className={['id-sum-row', bold ? 'id-sum-row--bold' : '', highlight ? 'id-sum-row--hi' : ''].filter(Boolean).join(' ')}>
      <span>{label}</span>
      <span className="id-sum-val">{money(val)}</span>
    </div>
  );
}
function Divider() { return <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', margin: '6px 0' }} />; }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE  (identical table to old SourcingBinPage)
// ─────────────────────────────────────────────────────────────────────────────
export default function SourcingBinDrawerPage() {
  const qc = useQueryClient();
  const [selected, setSelected]             = useState(null);
  const [search, setSearch]                 = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter]     = useState('all');
  const [markedForDelete, setMarkedForDelete] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const { user } = useAuth();
  const isAdmin = ['admin', 'manager'].includes(user?.role);

  const { data: enquiries = [], isLoading } = useQuery({ queryKey: ['enquiries'], queryFn: () => api.get('/enquiries').then(r => r.data), refetchInterval: 20000 });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'],  queryFn: () => api.get('/customers').then(r => r.data).catch(() => []) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'],  queryFn: () => api.get('/suppliers').then(r => r.data) });
  const { data: users = [] }     = useQuery({ queryKey: ['users'],      queryFn: () => api.get('/users').then(r => r.data) });
  const { data: quotes = [] }    = useQuery({ queryKey: ['quotes'],     queryFn: () => api.get('/quotes').then(r => r.data) });
  const { data: orders = [] }    = useQuery({ queryKey: ['orders'],     queryFn: () => api.get('/orders').then(r => r.data).catch(() => []) });
  useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get('/tax-rates').then(r => { seedTaxRateCache(r.data); return r.data; }), staleTime: 5*60*1000 });

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const userName = id => users.find(u => u.id === id)?.name || 'Unassigned';

  const hasRevisionReturned = enq => !!(quotes || []).find(q => q.enquiry_id === enq.id && q.status === 'active');
  const hasDownstreamOrder  = enq => (orders || []).some(o => o.enquiry_id === enq.id && !['cancelled', 'deleted'].includes((o.status || '').toLowerCase()));
  const isCompleted = e => ['ordered', 'order_created', 'closed'].includes(e.status) || hasDownstreamOrder(e);

  const visibleEnquiries = enquiries;

  const binEnqs = enquiries.filter(e => {
    if (statusFilter === 'sourcing')             return e.status === 'sourcing' && !hasRevisionReturned(e);
    if (statusFilter === 'quoted')               return e.status === 'quoted';
    if (statusFilter === 'returned_to_sourcing') return e.status === 'returned_to_sourcing';
    if (statusFilter === 'modify_requested')     return e.status === 'modify_requested';
    if (statusFilter === 'completed')            return isCompleted(e);
    return (e.status === 'sourcing' && !hasRevisionReturned(e)) || e.status === 'quoted' || e.status === 'returned_to_sourcing' || e.status === 'modify_requested' || ['ordered', 'order_created'].includes(e.status) || hasDownstreamOrder(e);
  });

  const filtered = binEnqs.filter(e => {
    const q = search.toLowerCase();
    return (!search || e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q)) && (priorityFilter === 'all' || e.priority === priorityFilter);
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const total      = binEnqs.length;
  const urgent     = binEnqs.filter(e => e.priority === 'urgent').length;
  const high       = binEnqs.filter(e => e.priority === 'high').length;
  const unassigned = binEnqs.filter(e => !e.assigned_to).length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 13, marginBottom: 18 }}>
        {[
          { label: 'In Sourcing Bin', val: total,      color: 'var(--accent)',  sub: 'enquiries to process' },
          { label: 'Urgent',          val: urgent,     color: 'var(--red)',     sub: 'need immediate action' },
          { label: 'High Priority',   val: high,       color: 'var(--amber)',   sub: 'process next' },
          { label: 'Unassigned',      val: unassigned, color: 'var(--purple)',  sub: 'not yet assigned' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft: `3px solid ${s.color}` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.color }}>{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search sourcing bin…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-row" style={{ marginBottom: 0 }}>
          {[
            { v: 'all',                   l: `All (${visibleEnquiries.filter(e => (e.status === 'sourcing' && !hasRevisionReturned(e)) || e.status === 'quoted' || e.status === 'returned_to_sourcing' || e.status === 'modify_requested' || ['ordered','order_created'].includes(e.status) || hasDownstreamOrder(e)).length})` },
            { v: 'sourcing',              l: `New (${visibleEnquiries.filter(e => e.status === 'sourcing' && !hasRevisionReturned(e)).length})` },
            { v: 'modify_requested',      l: `Sent to ENQ (${visibleEnquiries.filter(e => e.status === 'modify_requested').length})` },
            { v: 'quoted',                l: `Moved to Quote (${visibleEnquiries.filter(e => e.status === 'quoted').length})` },
            { v: 'returned_to_sourcing',  l: `Revision Needed (${visibleEnquiries.filter(e => e.status === 'returned_to_sourcing').length})` },
            { v: 'completed',             l: `Completed (${visibleEnquiries.filter(isCompleted).length})` },
          ].map(f => <span key={f.v} className={`fchip ${statusFilter === f.v ? 'active' : ''}`} onClick={() => setStatusFilter(f.v)}>{f.l}</span>)}
        </div>
        <div className="filter-row" style={{ marginBottom: 0 }}>
          {['all', 'urgent', 'high', 'normal'].map(p => <span key={p} className={`fchip ${priorityFilter === p ? 'active' : ''}`} onClick={() => setPriorityFilter(p)}>{p === 'all' ? 'All Priority' : p.charAt(0).toUpperCase() + p.slice(1)}</span>)}
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading sourcing bin…</div>}

      {/* Admin delete bar */}
      {isAdmin && markedForDelete.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 8, background: 'var(--red-lt)', borderRadius: 'var(--r)', border: '1px solid var(--red)33' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>{markedForDelete.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmBulkDelete(true)}>🗑 Delete Selected</button>
          <button className="btn btn-xs" onClick={() => setMarkedForDelete(new Set())}>Cancel</button>
        </div>
      )}
      {confirmBulkDelete && (
        <ConfirmDeleteModal
          message={`Are you sure you want to delete ${markedForDelete.size} enquir${markedForDelete.size > 1 ? 'ies' : 'y'}? This cannot be undone.`}
          onConfirm={async () => {
            setConfirmBulkDelete(false);
            try {
              await api.request({ method: 'DELETE', url: '/enquiries', data: { ids: [...markedForDelete] } });
              toast.success(`Deleted ${markedForDelete.size} enquir${markedForDelete.size > 1 ? 'ies' : 'y'}`);
              setMarkedForDelete(new Set());
              qc.invalidateQueries(['enquiries']); qc.invalidateQueries(['summary']);
            } catch { toast.error('Delete failed'); }
          }}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {/* Table */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {isAdmin && <th style={{ width: 28 }} />}
              <th>ENQ / SOUR</th><th>Customer</th><th>Items</th><th>Buying Type</th>
              <th>Priority</th><th>Sourcing Progress</th><th style={{ textAlign: 'center' }}>Days in Stage</th>
              <th>Status</th><th>Assigned To</th><th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin ? 11 : 10}>
                <div className="empty-state"><div className="empty-icon">🔍</div><div>{binEnqs.length === 0 ? 'Sourcing bin is empty — no enquiries sent to sourcing yet.' : 'No enquiries match your filter'}</div></div>
              </td></tr>
            )}
            {filtered.map(enq => {
              const srcDone  = (enq.sourcing || []).filter(s => s.sourced_price).length;
              const srcTotal = (enq.items || []).length;
              const srcPct   = srcTotal ? Math.round(srcDone / srcTotal * 100) : 0;
              const isUrgent = enq.priority === 'urgent';
              const isHigh   = enq.priority === 'high';
              const hasMarginData = (enq.sourcing || []).some(s => s.sourced_price && s.quote_price);
              const quickSrc   = (enq.sourcing || []).reduce((sum, s) => sum + (Number(s.sourced_price) || 0) * ((enq.items || []).find(i => i.id === s.enquiry_item_id)?.quantity || 0), 0);
              const quickQuote = (enq.sourcing || []).reduce((sum, s) => sum + (Number(s.quote_price) || 0) * ((enq.items || []).find(i => i.id === s.enquiry_item_id)?.quantity || 0), 0);
              const quickGross = quickQuote - quickSrc;
              return (
                <tr key={enq.id} className="clickable" style={{ borderLeft: isUrgent ? '3px solid var(--red)' : isHigh ? '3px solid var(--amber)' : undefined }} onClick={() => setSelected(enq)}>
                  {isAdmin && (
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={markedForDelete.has(enq.id)} onChange={() => setMarkedForDelete(prev => { const n = new Set(prev); n.has(enq.id) ? n.delete(enq.id) : n.add(enq.id); return n; })} style={{ accentColor: 'var(--red)', cursor: 'pointer', width: 14, height: 14 }} />
                    </td>
                  )}
                  <td>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text3)' }}>{enq.id}</div>
                    {enq.sourcing_no && <div style={{ marginTop: 2 }}><span className="mono bold" style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-lt)', padding: '1px 6px', borderRadius: 999, border: '1px solid var(--accent)33' }}>🔍 {enq.sourcing_no}</span></div>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{maskName(custName(enq.customer_id))}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="badge badge-blue">{srcTotal}</span>
                      {(enq.items || []).slice(0, 2).map(i => <span key={i.id} style={{ fontSize: 11, color: 'var(--text2)' }}>{i.component}</span>)}
                      {srcTotal > 2 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>+{srcTotal - 2} more</span>}
                    </div>
                  </td>
                  <td>{enq.buying_type ? <span className="badge badge-purple">{enq.buying_type}</span> : <span className="muted">—</span>}</td>
                  <td><span className={`badge ${isUrgent ? 'badge-red' : isHigh ? 'badge-amber' : 'badge-gray'}`}>{enq.priority}</span></td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{srcDone}/{srcTotal} priced</span>
                      <span style={{ fontWeight: 600, color: srcPct === 100 ? 'var(--green)' : 'inherit' }}>{srcPct}%</span>
                    </div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${srcPct}%`, background: srcPct === 100 ? 'var(--green)' : srcPct > 50 ? 'var(--accent)' : 'var(--amber)' }} /></div>
                    {hasMarginData && <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3, color: quickGross >= 0 ? 'var(--green)' : 'var(--red)' }}>{quickGross >= 0 ? '+' : ''}{fmt(quickGross)} margin</div>}
                  </td>
                  <td><DaysBadge updatedAt={enq.updated_at || enq.created_at} /></td>
                  <td><StatusBadge s={enq.status} /></td>
                  <td style={{ fontSize: 12 }}>{userName(enq.assigned_to)}</td>
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-xs btn-primary" onClick={() => setSelected(enq)}>
                      {(enq.status === 'quoted' || ['ordered', 'order_created'].includes(enq.status) || hasDownstreamOrder(enq)) ? 'View' : enq.status === 'returned_to_sourcing' ? 'Review Revision' : enq.status === 'modify_requested' ? 'View (Sent to ENQ)' : srcPct === 0 ? 'Start' : srcPct === 100 ? 'Review' : 'Continue'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <SourcingModal
          enq={selected}
          suppliers={suppliers}
          customers={customers}
          users={users}
          quotes={quotes}
          forceReadOnly={hasDownstreamOrder(selected) || ['ordered', 'order_created'].includes(selected.status)}
          onClose={() => setSelected(null)}
          onSaved={() => { qc.invalidateQueries(['enquiries']); qc.invalidateQueries(['quotes']); qc.invalidateQueries(['summary']); setSelected(null); }}
          onSavedDraft={() => { qc.invalidateQueries(['enquiries']); qc.invalidateQueries(['quotes']); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS — item drawer only (modal uses existing project .overlay/.modal styles)
// ─────────────────────────────────────────────────────────────────────────────
const DRAWER_CSS = `
.id-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 400;
}
.id-drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 940px;
  max-width: calc(100vw - 12px);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  z-index: 401;
  box-shadow: -8px 0 40px rgba(0,0,0,.22);
  overflow: hidden;
}
.id-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px 18px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 10px;
}
.id-body {
  display: grid;
  grid-template-columns: 58fr 42fr;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.id-form {
  overflow-y: auto;
  padding: 16px 18px;
  border-right: 1px solid var(--border);
  min-width: 0;
}
.id-grp { margin-bottom: 14px; }
.id-grp-title {
  font-size: 11px; font-weight: 800; text-transform: uppercase;
  letter-spacing: .05em; color: var(--text);
  padding: 0 0 6px; margin-bottom: 10px;
  border-bottom: 2px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.id-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.id-fg { display: flex; flex-direction: column; gap: 4px; }
.id-summary-col {
  overflow-y: auto;
  padding: 14px 14px;
  background: #0f172a;
  display: flex;
  flex-direction: column;
}
.id-summary-heading {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .1em; color: rgba(255,255,255,.4); margin-bottom: 12px;
}
.id-summary-card { color: #fff; }
.id-summary-item-title {
  font-size: 14px; font-weight: 700; color: #fff;
  margin-bottom: 14px; padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,.12);
}
.id-sum-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 3px 0; font-size: 11px; color: rgba(255,255,255,.65); gap: 6px;
}
.id-sum-row--bold { color: #fff; font-weight: 700; font-size: 11.5px; }
.id-sum-row--hi   { color: #4ade80; font-weight: 800; font-size: 14px; padding: 4px 0 2px; }
.id-sum-val { font-family:'DM Mono',monospace; white-space:nowrap; font-size:11px; }
.id-sum-row--hi .id-sum-val  { font-size: 14px; }
.id-sum-row--bold .id-sum-val { font-size: 11.5px; }
.id-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 18px; border-top: 1px solid var(--border);
  flex-shrink: 0; background: var(--surface);
}
.id-form input[type=number]::-webkit-inner-spin-button,
.id-form input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.id-form input[type=number] { -moz-appearance: textfield; }
@media (max-width: 800px) {
  .id-drawer { width: 100vw; }
  .id-body   { grid-template-columns: 1fr; }
  .id-summary-col { border-top: 1px solid var(--border); max-height: 280px; }
}
`;
