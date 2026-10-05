// client/src/pages/AuditBinPage.js
// Audit Bin — Revamped Sourcing-Identical 2-Way Cost & Budget Comparison
// Left = Sourcing Estimate (Baseline), Right = Actual Spent (Money Out)
// Exact parameters, % / ₹ UnitToggle, Dark Calculation Summary Card, and live Profit / Loss analysis.
import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

function money(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '₹0.00';
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtM(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const ALL_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'CNY', 'JPY'];
const DEFAULT_MODES = {
  freight: 'amt', insurance: 'amt', transport: 'amt', packaging: 'amt',
  bcd: 'amt', sws: 'amt', cess: 'amt', clearing: 'amt',
  bank: 'amt', margin: 'pct', buffer: 'amt'
};

// ── Sourcing-identical UnitToggle (% / ₹) ──────────────────────────────
function UnitToggle({ mode, onToggle, disabled }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled} title="Toggle % / ₹"
      style={{
        display: 'inline-flex', alignItems: 'center', height: 20, borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden',
        cursor: disabled ? 'default' : 'pointer', padding: 0, flexShrink: 0
      }}>
      {['pct', 'amt'].map(m => (
        <span key={m} style={{
          padding: '0 6px', fontSize: 10, fontWeight: 700, lineHeight: '20px',
          background: mode === m ? 'var(--accent)' : 'transparent',
          color: mode === m ? '#fff' : 'var(--text3)',
          transition: 'background .15s'
        }}>
          {m === 'pct' ? '%' : '₹'}
        </span>
      ))}
    </button>
  );
}

// ── Field Label with UnitToggle ───────────────────────────────────────
function FL({ label, mode, onToggle, locked = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 20, marginBottom: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {locked && <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 800 }}>🔒 Locked</span>}
      </span>
      {!locked ? (
        <UnitToggle mode={mode} onToggle={onToggle} />
      ) : (
        <span style={{
          display: 'inline-flex', alignItems: 'center', height: 18, borderRadius: 9,
          border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.12)',
          padding: '0 6px', fontSize: 9, fontWeight: 800, color: '#b45309'
        }}>
          {mode === 'pct' ? '%' : '₹'}
        </span>
      )}
    </div>
  );
}

// ── Dark Calculation Summary Rows (Matching Image 2 exactly) ─────────
function SumRow({ label, val, bold, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: highlight ? '5px 0 3px' : '3px 0',
      fontSize: highlight ? 13 : (bold ? 11.5 : 11),
      color: highlight ? '#4ade80' : (bold ? '#ffffff' : 'rgba(255,255,255,0.7)'),
      fontWeight: (bold || highlight) ? 800 : 400,
      gap: 6
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap',
        fontSize: highlight ? 14 : (bold ? 12 : 11),
        fontWeight: (bold || highlight) ? 800 : 600
      }}>
        {money(val)}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '6px 0' }} />;
}

// ── Exact Landed Calculation Engine (Reused from Sourcing calcLanded) ─
function runCalcLanded({
  materialValue = 0,
  qty = 1,
  modes = {},
  rates = {},
  extraCharges = [],
  gstPct = 0,
  quotePrice = 0,
  taxRate = 18,
}) {
  const m = { ...DEFAULT_MODES, ...modes };
  const raw = v => Number(v || 0);
  const applyMode = (mode, rawVal, base) => mode === 'pct' ? (base * rawVal / 100) : rawVal;

  const mat = raw(materialValue);
  const freightINR   = applyMode(m.freight,   raw(rates.freight),   mat);
  const insuranceINR = applyMode(m.insurance, raw(rates.insurance), mat);
  const transportINR = applyMode(m.transport, raw(rates.transport), mat);
  const packagingINR = applyMode(m.packaging, raw(rates.packaging), mat);
  const cifValue     = mat + freightINR + insuranceINR;

  const bcdAmount   = applyMode(m.bcd,      raw(rates.bcd),      cifValue);
  const swsAmount   = applyMode(m.sws,      raw(rates.sws),      m.sws === 'pct' ? bcdAmount : 1);
  const cessAmount  = applyMode(m.cess,     raw(rates.cess),     cifValue);
  const importCost  = cifValue + bcdAmount + swsAmount + cessAmount;

  const clearingINR = applyMode(m.clearing, raw(rates.clearing), cifValue);
  const bankINR     = applyMode(m.bank,     raw(rates.bank),     importCost > 0 ? importCost : mat);
  const bufferINR   = applyMode(m.buffer,   raw(rates.buffer),   importCost > 0 ? importCost : mat);

  const landedBeforeMargin = importCost + clearingINR + transportINR + packagingINR + bankINR;
  const marginAmt = m.margin === 'pct'
    ? (landedBeforeMargin * raw(rates.margin) / 100)
    : (raw(rates.margin) * qty);

  const extraChargesTotal = Array.isArray(extraCharges)
    ? extraCharges.reduce((sum, c) => sum + (Number(c?.amount) || 0), 0)
    : 0;

  const finalCost      = landedBeforeMargin + marginAmt + bufferINR + extraChargesTotal;
  const unitLandedCost = qty > 0 ? finalCost / qty : 0;
  const gstAmount      = finalCost * raw(gstPct) / 100;
  const grandTotal     = finalCost + gstAmount;

  const qp = raw(quotePrice);
  const qTotal = qp * qty;
  const qGstPct = raw(taxRate);
  const qGstAmt = qGstPct > 0 ? (qTotal * qGstPct / 100) : 0;
  const quoteTotalWithGst = qTotal + qGstAmt;

  return {
    materialValue: mat,
    freightINR, insuranceINR, transportINR, packagingINR,
    cifValue, bcdAmount, swsAmount, cessAmount, importCost,
    clearingINR, bankINR, bufferINR, landedBeforeMargin,
    marginAmt, extraChargesTotal, finalCost, unitLandedCost,
    gstPct, gstAmount, grandTotal,
    quotePrice: qp, quoteTotal: qTotal, qGstPct, qGstAmt, quoteTotalWithGst
  };
}

// ── 2-Way Item Audit Card (Exact Sourcing UI on both sides) ───────────
function AuditItemCard({ item, onSaved }) {
  const line = item.lines?.[0] || {};
  const qty = Number(line.qty) || Number(item.quantity) || 1;
  const compName = line.component || item.supplier_order_id || 'PO Item';

  // 1. Sourcing Modes & Rates (baseline from Sourcing)
  const srcModes = useMemo(() => {
    try {
      const sm = item.sourcing_modes || (line.field_modes ? (typeof line.field_modes === 'string' ? JSON.parse(line.field_modes) : line.field_modes) : {});
      return {
        freight: sm.freight || 'amt',
        insurance: sm.insurance || (item.scope === 'international' ? 'pct' : 'amt'),
        transport: sm.transport || 'amt',
        packaging: sm.packaging || 'amt',
        bcd: sm.bcd || (item.scope === 'international' ? 'pct' : 'amt'),
        sws: sm.sws || (item.scope === 'international' ? 'pct' : 'amt'),
        cess: sm.cess || (item.scope === 'international' ? 'pct' : 'amt'),
        clearing: sm.clearing || 'amt',
        bank: sm.bank || 'amt',
        margin: sm.margin || 'pct',
        buffer: sm.buffer || 'amt',
      };
    } catch (_) {
      return { ...DEFAULT_MODES };
    }
  }, [item, line]);

  const srcRates = useMemo(() => {
    const r = item.sourcing_rates || {};
    const getVal = (k, alt) => {
      const v = r[k] ?? line[alt];
      return (v !== null && v !== undefined && v !== '') ? Number(v) : null;
    };
    const estMat = Number(item.est_material) || 0;
    const cur = r.currency || line.sourced_currency || (item.scope === 'international' ? 'USD' : 'INR');
    const exRate = Number(r.exchange_rate) || 1;
    const srcForeign = Number(r.src_price_foreign) || (cur !== 'INR' && exRate > 0 && estMat > 0 ? (estMat / (exRate * qty)) : 0);
    const srcUnitInr = estMat > 0 ? (estMat / qty) : (Number(r.sourced_price) || 0);

    return {
      currency: cur,
      exchange_rate: exRate,
      src_price_foreign: srcForeign,
      sourced_price: srcUnitInr,
      freight: getVal('freight', 'freight_raw') ?? (Number(item.est_freight) || 0),
      insurance: getVal('insurance', 'insurance_raw') ?? (Number(item.est_insurance) || 0),
      transport: getVal('transport', 'transport_raw') ?? 0,
      packaging: getVal('packaging', 'packaging_raw') ?? 0,
      bcd: getVal('bcd', 'bcd_raw') ?? (Number(item.est_bcd) || 0),
      sws: getVal('sws', 'sws_raw') ?? (Number(item.est_sws) || 0),
      cess: getVal('cess', 'cess_raw') ?? (Number(item.est_cess) || 0),
      clearing: getVal('clearing', 'clearing_raw') ?? (Number(item.est_clearing) || 0),
      bank: getVal('bank', 'bank_raw') ?? (Number(item.est_bank) || 0),
      buffer: getVal('buffer', 'buffer_raw') ?? 0,
      margin: getVal('margin', 'margin_raw') ?? (
        estMat > 0 && Number(item.est_margin) > 0
          ? Math.round((Number(item.est_margin) / estMat) * 1000) / 10
          : (Number(item.est_margin) || 0)
      ),
      quote_currency: r.quote_currency || 'INR',
      quote_price: Number(r.quote_price) || (estMat > 0 ? (estMat / qty) : 0),
      tax_rate: Number(r.tax_rate) || 18,
    };
  }, [item, line, qty]);

  // Sourcing extra charges
  const estExtraCharges = useMemo(() => {
    try {
      const p = item.est_extra_charges_detail ? (typeof item.est_extra_charges_detail === 'string' ? JSON.parse(item.est_extra_charges_detail) : item.est_extra_charges_detail) : [];
      return Array.isArray(p) ? p : [];
    } catch (_) { return []; }
  }, [item.est_extra_charges_detail]);

  // Sourcing Landed Calculation
  const estCalc = useMemo(() => {
    const matVal = (Number(srcRates.sourced_price) || 0) * qty;
    return runCalcLanded({
      materialValue: matVal > 0 ? matVal : (Number(item.est_material) || 0),
      qty,
      modes: srcModes,
      rates: srcRates,
      extraCharges: estExtraCharges,
      gstPct: 0,
      quotePrice: srcRates.quote_price,
      taxRate: srcRates.tax_rate,
    });
  }, [srcRates, srcModes, estExtraCharges, qty, item.est_material]);

  const estTotal = estCalc.finalCost > 0 ? estCalc.finalCost : (Number(item.est_total) || 0);

  // 2. Actual Modes & Rates (User entry side)
  const savedAct = useMemo(() => {
    try {
      if (!item.act_field_modes) return null;
      return typeof item.act_field_modes === 'string' ? JSON.parse(item.act_field_modes) : item.act_field_modes;
    } catch (_) { return null; }
  }, [item.act_field_modes]);

  const [actModes, setActModes] = useState(() => ({
    ...srcModes,
    ...(savedAct?.modes || {}),
    margin: srcModes.margin, // Strictly locked
  }));

  const initialActMat = item.act_material !== null && item.act_material !== undefined && item.act_material !== ''
    ? Number(item.act_material)
    : (item.supplier_subtotal > 0
        ? Number(item.supplier_subtotal)
        : (item.finance_paid > 0 ? Number(item.finance_paid) : (Number(item.est_material) || 0)));

  const [actRates, setActRates] = useState(() => {
    const r = savedAct?.rates || {};
    const cur = savedAct?.currency || srcRates.currency;
    const exRate = savedAct?.exchange_rate ?? srcRates.exchange_rate;
    const srcUnitInr = initialActMat > 0 ? (initialActMat / qty) : srcRates.sourced_price;
    const srcForeign = savedAct?.src_price_foreign ?? (cur !== 'INR' && exRate > 0 ? (srcUnitInr / exRate) : srcRates.src_price_foreign);

    return {
      currency: cur,
      exchange_rate: exRate,
      src_price_foreign: srcForeign,
      sourced_price: srcUnitInr,
      freight: r.freight ?? (item.act_freight !== null && item.act_freight !== undefined ? item.act_freight : srcRates.freight),
      insurance: r.insurance ?? (item.act_insurance !== null && item.act_insurance !== undefined ? item.act_insurance : srcRates.insurance),
      transport: r.transport ?? (item.act_transport !== null && item.act_transport !== undefined ? item.act_transport : srcRates.transport),
      packaging: r.packaging ?? (item.act_packaging !== null && item.act_packaging !== undefined ? item.act_packaging : srcRates.packaging),
      bcd: r.bcd ?? (item.act_bcd !== null && item.act_bcd !== undefined ? item.act_bcd : srcRates.bcd),
      sws: r.sws ?? (item.act_sws !== null && item.act_sws !== undefined ? item.act_sws : srcRates.sws),
      cess: r.cess ?? (item.act_cess !== null && item.act_cess !== undefined ? item.act_cess : srcRates.cess),
      clearing: r.clearing ?? (item.act_clearing !== null && item.act_clearing !== undefined ? item.act_clearing : srcRates.clearing),
      bank: r.bank ?? (item.act_bank !== null && item.act_bank !== undefined ? item.act_bank : srcRates.bank),
      buffer: r.buffer ?? (item.act_buffer !== null && item.act_buffer !== undefined ? item.act_buffer : srcRates.buffer),
      margin: srcRates.margin, // Strictly locked
      quote_currency: savedAct?.quote_currency || srcRates.quote_currency,
      quote_price: savedAct?.quote_price ?? srcRates.quote_price,
      tax_rate: savedAct?.tax_rate ?? srcRates.tax_rate,
    };
  });

  const [actExtraCharges, setActExtraCharges] = useState(() => {
    try {
      const p = item.act_extra_charges_detail ? (typeof item.act_extra_charges_detail === 'string' ? JSON.parse(item.act_extra_charges_detail) : item.act_extra_charges_detail) : [];
      return Array.isArray(p) ? p : [];
    } catch (_) { return []; }
  });

  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const [isAuditedLocal, setIsAuditedLocal] = useState(Number(item.is_audited) === 1);
  useEffect(() => {
    setIsAuditedLocal(Number(item.is_audited) === 1);
  }, [item.is_audited]);

  // Live calculation of Actual side
  const actCalc = useMemo(() => {
    const matVal = (Number(actRates.sourced_price) || 0) * qty;
    return runCalcLanded({
      materialValue: matVal,
      qty,
      modes: actModes,
      rates: actRates,
      extraCharges: actExtraCharges,
      gstPct: 0,
      quotePrice: actRates.quote_price,
      taxRate: actRates.tax_rate,
    });
  }, [actRates, actModes, actExtraCharges, qty]);

  const actTotal = actCalc.finalCost;
  const variance = estTotal - actTotal;

  // Handlers for actual rates and modes
  const handleActRate = (key, val) => {
    if (key === 'margin') return; // LOCKED
    setActRates(r => {
      const next = { ...r, [key]: val };
      if (key === 'src_price_foreign' || key === 'exchange_rate') {
        const f = Number(key === 'src_price_foreign' ? val : r.src_price_foreign) || 0;
        const ex = Number(key === 'exchange_rate' ? val : r.exchange_rate) || 1;
        next.sourced_price = Math.round(f * ex * 100) / 100;
      }
      return next;
    });
  };

  const handleActMode = (key) => {
    if (key === 'margin') return; // LOCKED
    setActModes(m => ({ ...m, [key]: m[key] === 'pct' ? 'amt' : 'pct' }));
  };

  const addCharge = () => setActExtraCharges(c => [...c, { name: '', amount: '' }]);
  const updCharge = (i, k, v) => setActExtraCharges(c => c.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const removeCharge = (i) => setActExtraCharges(c => c.filter((_, j) => j !== i));

  // Clear Right-Side Actual Entries & Extra Charges
  const clearActuals = () => {
    setActRates(r => ({
      ...r,
      sourced_price: '',
      src_price_foreign: '',
      freight: '',
      insurance: '',
      transport: '',
      packaging: '',
      bcd: '',
      sws: '',
      cess: '',
      clearing: '',
      bank: '',
      buffer: '',
    }));
    setActExtraCharges([]);
    toast.success('Cleared right-side actual entries');
  };

  // Save Actual Budget to DB
  const saveActuals = async () => {
    setSaving(true);
    try {
      const payload = {
        act_material: actCalc.materialValue,
        act_freight: actCalc.freightINR,
        act_insurance: actCalc.insuranceINR,
        act_transport: actCalc.transportINR,
        act_packaging: actCalc.packagingINR,
        act_bcd: actCalc.bcdAmount,
        act_sws: actCalc.swsAmount,
        act_cess: actCalc.cessAmount,
        act_clearing: actCalc.clearingINR,
        act_bank: actCalc.bankINR,
        act_buffer: actCalc.bufferINR,
        act_margin: actCalc.marginAmt,
        act_extra_charges: actCalc.extraChargesTotal,
        act_extra_charges_detail: actExtraCharges.filter(c => c && (c.name || Number(c.amount) > 0)),
        act_field_modes: {
          modes: actModes,
          rates: actRates,
          currency: actRates.currency,
          exchange_rate: actRates.exchange_rate,
          src_price_foreign: actRates.src_price_foreign,
          quote_price: actRates.quote_price,
          tax_rate: actRates.tax_rate
        },
        act_total: actCalc.finalCost,
        notes: notes || '',
      };
      await api.put(`/audit-items/${item.id}`, payload);
      setIsAuditedLocal(true);
      toast.success('Actual spent saved successfully');
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save actual budget');
    } finally {
      setSaving(false);
    }
  };

  const isIntl = Boolean(
    (item.scope && item.scope.toLowerCase() === 'international') ||
    (line.scope && line.scope.toLowerCase() === 'international') ||
    (srcRates.currency && srcRates.currency !== 'INR') ||
    (Number(srcRates.exchange_rate) > 1 && srcRates.currency !== 'INR') ||
    (Number(srcRates.bcd) > 0 || Number(srcRates.sws) > 0 || Number(srcRates.cess) > 0 || Number(srcRates.clearing) > 0)
  );

  const stepNum = isIntl
    ? { material: 1, freight: 2, importCh: 3, financial: 4, additional: 5, quote: 6 }
    : { material: 1, freight: 2, importCh: null, financial: 3, additional: 4, quote: 5 };

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--r, 8px)',
      overflow: 'hidden',
      marginBottom: 16,
      background: 'var(--surface)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
    }}>
      {/* ── Item Header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap', gap: 8
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>
            🏢 {item.supplier_name || item.supplier_id || 'Supplier PO'}
          </span>
          {isAuditedLocal ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981',
              color: '#059669', padding: '2px 8px', borderRadius: 12,
              fontSize: 11, fontWeight: 800
            }}>
              ✓ Audited
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
              color: '#d97706', padding: '2px 8px', borderRadius: 12,
              fontSize: 11, fontWeight: 800
            }}>
              ⏳ Pending Audit
            </span>
          )}
          {item.supplier_order_id && (
            <span className="mono" style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4, color: 'var(--text2)' }}>
              PO: {item.supplier_order_id}
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase',
            background: isIntl ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
            color: isIntl ? '#3b82f6' : '#10b981'
          }}>
            {isIntl ? '🌐 INTERNATIONAL' : '🇮🇳 DOMESTIC'}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
            📦 {compName} <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 400 }}>×{qty}</span>
          </span>
          {item.settlement_status === 'settled' && (
            <span className="badge badge-green" style={{ fontSize: 10, fontWeight: 700 }}>✅ Settled</span>
          )}
        </div>

        {/* Right side status and action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {variance > 0.01 ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#10b981', padding: '3px 9px', borderRadius: 14, fontSize: 11, fontWeight: 700
            }}>
              🟢 +{money(variance)} Saved
            </span>
          ) : variance < -0.01 ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', padding: '3px 9px', borderRadius: 14, fontSize: 11, fontWeight: 700
            }}>
              🔴 -{money(Math.abs(variance))} Overrun
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
              color: '#3b82f6', padding: '3px 9px', borderRadius: 14, fontSize: 11, fontWeight: 700
            }}>
              🔵 Exact Budget Match
            </span>
          )}

          <button type="button" className="btn btn-xs btn-outline" onClick={clearActuals}
            title="Clear all right-side actual entries and added charges"
            style={{ fontSize: 11, padding: '3px 9px', color: 'var(--text3)' }}>
            ✕ Clear
          </button>

          <button type="button" className="btn btn-xs btn-primary" disabled={saving} onClick={saveActuals}
            style={{ fontSize: 11, padding: '3px 12px', fontWeight: 700 }}>
            {saving ? 'Saving…' : (isAuditedLocal ? '✓ Update Actuals' : '💾 Save Actuals')}
          </button>
        </div>
      </div>

      {/* ── 2-WAY VIEW: LEFT = SOURCING ESTIMATE, RIGHT = ACTUAL SPENT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>

        {/* ══════════════ LEFT SIDE: SOURCING ESTIMATE (BASELINE) ══════════════ */}
        <div style={{ borderRight: '1px solid var(--border)', background: 'rgba(59,130,246,0.015)', display: 'flex', flexDirection: 'column' }}>
          {/* Header Banner */}
          <div style={{
            padding: '8px 14px', background: 'rgba(59,130,246,0.06)', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>📋</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Sourcing Estimate (Baseline)
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>Planned Sourcing Sheet</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', flex: 1, minHeight: 0 }}>
            {/* Left Form (Sourcing Fields) */}
            <div style={{ padding: '12px 14px', overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
              
              {/* Group 1: Material Details */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.material}. Material Details
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isIntl ? '1fr 1.2fr 1fr 1.2fr' : '1fr', gap: 6, alignItems: 'end' }}>
                  {isIntl && (<>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Currency</label>
                      <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                        {srcRates.currency}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Exch Rate (₹)</label>
                      <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                        {srcRates.exchange_rate}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Price ({srcRates.currency})</label>
                      <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                        {srcRates.src_price_foreign}
                      </div>
                    </div>
                  </>)}
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>= Source Price (₹)</label>
                    <div style={{
                      height: 30, padding: '0 8px', fontSize: 11, fontWeight: 700,
                      background: 'var(--green-lt, #dcfce7)', border: '1px solid var(--green, #15803d)',
                      borderRadius: 6, color: 'var(--green, #15803d)', display: 'flex', alignItems: 'center'
                    }}>
                      ₹{fmt(srcRates.sourced_price)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Group 2: Freight & Logistics */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.freight}. Freight &amp; Logistics
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                  {[
                    { label: 'Freight', field: 'freight', val: srcRates.freight, calcAmt: estCalc.freightINR, show: true },
                    { label: 'Insurance', field: 'insurance', val: srcRates.insurance, calcAmt: estCalc.insuranceINR, show: isIntl || Number(srcRates.insurance) > 0 },
                    { label: 'Transport', field: 'transport', val: srcRates.transport, calcAmt: estCalc.transportINR, show: true },
                    { label: 'Packaging', field: 'packaging', val: srcRates.packaging, calcAmt: estCalc.packagingINR, show: true },
                  ].filter(f => f.show).map(f => (
                    <div key={f.field}>
                      <FL label={`${f.label} (${srcModes[f.field] === 'pct' ? '%' : '₹'})`} mode={srcModes[f.field]} locked />
                      <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                        {f.val || 0}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                        ₹{fmt(f.calcAmt / qty)} / unit
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group 3: Import Charges (ONLY FOR INTERNATIONAL) */}
              {isIntl && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                    {stepNum.importCh}. Import Charges
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                    {[
                      { label: 'BCD', field: 'bcd', val: srcRates.bcd, calcAmt: estCalc.bcdAmount },
                      { label: 'SWS', field: 'sws', val: srcRates.sws, calcAmt: estCalc.swsAmount },
                      { label: 'CESS', field: 'cess', val: srcRates.cess, calcAmt: estCalc.cessAmount },
                      { label: 'Clearing', field: 'clearing', val: srcRates.clearing, calcAmt: estCalc.clearingINR },
                    ].map(f => (
                      <div key={f.field}>
                        <FL label={`${f.label} (${srcModes[f.field] === 'pct' ? '%' : '₹'})`} mode={srcModes[f.field]} locked />
                        <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                          {f.val || 0}
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                          ₹{fmt(f.calcAmt / qty)} / unit
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Group: Financial */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.financial}. Financial
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                  {[
                    { label: 'Bank Charges', field: 'bank', val: srcRates.bank, calcAmt: estCalc.bankINR, show: isIntl || Number(srcRates.bank) > 0 },
                    { label: 'Margin', field: 'margin', val: srcRates.margin, calcAmt: estCalc.marginAmt, isMargin: true, show: true },
                    { label: 'Buffer', field: 'buffer', val: srcRates.buffer, calcAmt: estCalc.bufferINR, show: isIntl || Number(srcRates.buffer) > 0 },
                  ].filter(f => f.show).map(f => (
                    <div key={f.field}>
                      <FL label={`${f.label} (${srcModes[f.field] === 'pct' ? '%' : '₹'})`} mode={srcModes[f.field]} locked />
                      <div className="input" style={{
                        height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center',
                        color: f.isMargin ? 'var(--accent)' : 'inherit', fontWeight: f.isMargin ? 700 : 400
                      }}>
                        {f.val || 0}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                        ₹{fmt(f.calcAmt / qty)} / unit
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group: Additional Charges */}
              {estExtraCharges.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                    {stepNum.additional}. Additional Charges
                  </div>
                  {estExtraCharges.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: 'var(--text2)' }}>• {c.name || 'Extra Charge'}</span>
                      <span className="mono" style={{ fontWeight: 600 }}>{money(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Group: Quote Pricing */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.quote}. Quote Pricing
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text3)' }}>Quote Currency</label>
                    <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                      {srcRates.quote_currency}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text3)' }}>GST / Tax</label>
                    <div className="input" style={{ height: 30, fontSize: 11, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                      GST {srcRates.tax_rate}%
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>Quote Price / Unit *</label>
                    <div style={{
                      height: 30, padding: '0 8px', fontSize: 11, fontWeight: 700,
                      background: 'var(--green-lt, #dcfce7)', border: '1px solid var(--green, #15803d)',
                      borderRadius: 6, color: 'var(--green, #15803d)', display: 'flex', alignItems: 'center'
                    }}>
                      {fmt(srcRates.quote_price)}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>Price w/ GST (auto)</label>
                    <div style={{
                      height: 30, padding: '0 8px', fontSize: 11, fontWeight: 700,
                      background: 'rgba(59,130,246,0.1)', border: '1px solid var(--accent)',
                      borderRadius: 6, color: 'var(--accent)', display: 'flex', alignItems: 'center'
                    }}>
                      ₹{fmt(srcRates.quote_price * (1 + srcRates.tax_rate / 100))}
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Summary Panel (Dark Navy Panel from Image 2) */}
            <div style={{ background: '#0b1329', padding: '12px 14px', overflowY: 'auto' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                CALCULATION SUMMARY
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.12)', marginBottom: 8 }}>
                {compName} <span style={{ opacity: 0.5, fontSize: 11, fontWeight: 400 }}>×{qty}</span>
              </div>

              <SumRow label="Material Value" val={estCalc.materialValue} />
              {estCalc.freightINR > 0 && <SumRow label={`+ Freight (${srcRates.freight || 0}${srcModes.freight === 'pct' ? '%' : '₹'})`} val={estCalc.freightINR} />}
              {isIntl && estCalc.insuranceINR > 0 && <SumRow label={`+ Insurance (${srcRates.insurance || 0}${srcModes.insurance === 'pct' ? '%' : '₹'})`} val={estCalc.insuranceINR} />}
              {isIntl && <SumRow label="= CIF Value" val={estCalc.cifValue} bold />}
              {isIntl && <Divider />}

              {isIntl && (<>
                {estCalc.bcdAmount > 0 && <SumRow label={`+ BCD (${srcRates.bcd || 0}${srcModes.bcd === 'pct' ? '%' : '₹'})`} val={estCalc.bcdAmount} />}
                {estCalc.swsAmount > 0 && <SumRow label={`+ SWS (${srcRates.sws || 0}${srcModes.sws === 'pct' ? '%' : '₹'})`} val={estCalc.swsAmount} />}
                {estCalc.cessAmount > 0 && <SumRow label={`+ CESS (${srcRates.cess || 0}${srcModes.cess === 'pct' ? '%' : '₹'})`} val={estCalc.cessAmount} />}
                <SumRow label="= Import Cost" val={estCalc.importCost} bold />
                <Divider />
                {estCalc.clearingINR > 0 && <SumRow label={`+ Clearing (${srcRates.clearing || 0}${srcModes.clearing === 'pct' ? '%' : '₹'})`} val={estCalc.clearingINR} />}
              </>)}

              {estCalc.transportINR > 0 && <SumRow label={`+ Transport (${srcRates.transport || 0}${srcModes.transport === 'pct' ? '%' : '₹'})`} val={estCalc.transportINR} />}
              {estCalc.packagingINR > 0 && <SumRow label={`+ Packaging (${srcRates.packaging || 0}${srcModes.packaging === 'pct' ? '%' : '₹'})`} val={estCalc.packagingINR} />}
              {estCalc.bankINR > 0 && <SumRow label={`+ Bank Charges (${srcRates.bank || 0}${srcModes.bank === 'pct' ? '%' : '₹'})`} val={estCalc.bankINR} />}

              {(estCalc.freightINR > 0 || estCalc.transportINR > 0 || estCalc.packagingINR > 0 || estCalc.bankINR > 0 || isIntl) && (
                <SumRow label={isIntl ? "= Landed Before Margin" : "= Landed Cost (Before Margin)"} val={estCalc.landedBeforeMargin} bold />
              )}
              <Divider />

              <SumRow label={`+ Margin (${srcRates.margin || 0}${srcModes.margin === 'pct' ? '%' : '₹'})`} val={estCalc.marginAmt} />
              {estCalc.bufferINR > 0 && <SumRow label={`+ Buffer (${srcRates.buffer || 0}${srcModes.buffer === 'pct' ? '%' : '₹'})`} val={estCalc.bufferINR} />}
              {estExtraCharges.filter(c => Number(c?.amount) > 0).map((c, i) => (
                <SumRow key={i} label={`+ ${c.name || 'Extra Charge'}`} val={Number(c.amount)} />
              ))}
              <SumRow label="= Final Cost" val={estCalc.finalCost} bold />
              <SumRow label={`Unit Landed Cost (÷${qty})`} val={estCalc.unitLandedCost} />
              <Divider />

              <SumRow label="Grand Total" val={estCalc.grandTotal} highlight />

              {Number(srcRates.quote_price) > 0 && (<>
                <Divider />
                <SumRow label="Quote Price / Unit" val={estCalc.quotePrice} bold />
                <SumRow label={`Quote Total (×${qty})`} val={estCalc.quoteTotal} bold />
                {estCalc.qGstPct > 0 && <SumRow label={`+ GST (${estCalc.qGstPct}%)`} val={estCalc.qGstAmt} />}
                <SumRow label="Quote Total + GST" val={estCalc.quoteTotalWithGst} highlight />
              </>)}
            </div>
          </div>
        </div>

        {/* ══════════════ RIGHT SIDE: ACTUAL SPENT (MONEY OUT) ══════════════ */}
        <div style={{ background: 'rgba(16,185,129,0.015)', display: 'flex', flexDirection: 'column' }}>
          {/* Header Banner */}
          <div style={{
            padding: '8px 14px', background: 'rgba(16,185,129,0.06)', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>💰</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Actual Spent (Money Out)
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>Live Accounting Entry</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', flex: 1, minHeight: 0 }}>
            {/* Left Form (Actual Inputs with % / ₹ Toggles) */}
            <div style={{ padding: '12px 14px', overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
              
              {/* Group 1: Material Details */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{stepNum.material}. Material Details</span>
                  {Number(item.finance_paid) > 0 && (
                    <span style={{ fontSize: 9.5, color: 'var(--green)', fontWeight: 700 }}>
                      Paid: {fmtM(item.finance_paid)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isIntl ? '1fr 1.2fr 1fr 1.2fr' : '1fr', gap: 6, alignItems: 'end' }}>
                  {isIntl && (<>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Currency</label>
                      <select className="input" style={{ height: 30, fontSize: 11, padding: '2px 4px' }}
                        value={actRates.currency} onChange={e => handleActRate('currency', e.target.value)}>
                        {ALL_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Exch Rate (₹)</label>
                      <input className="input" type="number" step="0.01" min="0" style={{ height: 30, fontSize: 11 }}
                        value={actRates.exchange_rate || ''} onChange={e => handleActRate('exchange_rate', e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)' }}>Price ({actRates.currency})</label>
                      <input className="input" type="number" step="0.0001" min="0" style={{ height: 30, fontSize: 11 }}
                        value={actRates.src_price_foreign || ''} onChange={e => handleActRate('src_price_foreign', e.target.value)} />
                    </div>
                  </>)}
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>= Source Price (₹)</label>
                    <input className="input" type="number" step="0.01" min="0"
                      style={{
                        height: 30, fontSize: 11, fontWeight: 700,
                        background: 'var(--green-lt, #dcfce7)', borderColor: 'var(--green, #15803d)', color: 'var(--green, #15803d)'
                      }}
                      value={actRates.sourced_price || ''} onChange={e => handleActRate('sourced_price', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Group 2: Freight & Logistics */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.freight}. Freight &amp; Logistics
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                  {[
                    { label: 'Freight', field: 'freight', val: actRates.freight, calcAmt: actCalc.freightINR, show: true },
                    { label: 'Insurance', field: 'insurance', val: actRates.insurance, calcAmt: actCalc.insuranceINR, show: isIntl || Number(actRates.insurance) > 0 },
                    { label: 'Transport', field: 'transport', val: actRates.transport, calcAmt: actCalc.transportINR, show: true },
                    { label: 'Packaging', field: 'packaging', val: actRates.packaging, calcAmt: actCalc.packagingINR, show: true },
                  ].filter(f => f.show).map(f => (
                    <div key={f.field}>
                      <FL label={`${f.label} (${actModes[f.field] === 'pct' ? '%' : '₹'})`} mode={actModes[f.field]} onToggle={() => handleActMode(f.field)} />
                      <input className="input" type="number" step="0.001" min="0" style={{ height: 30, fontSize: 11 }}
                        value={f.val ?? ''} onChange={e => handleActRate(f.field, e.target.value)}
                        placeholder={actModes[f.field] === 'pct' ? '0.00%' : '₹0.00'} />
                      <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                        ₹{fmt(f.calcAmt / qty)} / unit
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group 3: Import Charges (ONLY FOR INTERNATIONAL) */}
              {isIntl && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                    {stepNum.importCh}. Import Charges
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                    {[
                      { label: 'BCD', field: 'bcd', val: actRates.bcd, calcAmt: actCalc.bcdAmount },
                      { label: 'SWS', field: 'sws', val: actRates.sws, calcAmt: actCalc.swsAmount },
                      { label: 'CESS', field: 'cess', val: actRates.cess, calcAmt: actCalc.cessAmount },
                      { label: 'Clearing', field: 'clearing', val: actRates.clearing, calcAmt: actCalc.clearingINR },
                    ].map(f => (
                      <div key={f.field}>
                        <FL label={`${f.label} (${actModes[f.field] === 'pct' ? '%' : '₹'})`} mode={actModes[f.field]} onToggle={() => handleActMode(f.field)} />
                        <input className="input" type="number" step="0.001" min="0" style={{ height: 30, fontSize: 11 }}
                          value={f.val ?? ''} onChange={e => handleActRate(f.field, e.target.value)}
                          placeholder={actModes[f.field] === 'pct' ? '0.00%' : '₹0.00'} />
                        <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                          ₹{fmt(f.calcAmt / qty)} / unit
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Group: Financial */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 4, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {stepNum.financial}. Financial
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: (isIntl || Number(actRates.bank) > 0) ? '1fr 1fr 1fr' : '1fr 1fr', gap: '8px 10px' }}>
                  {(isIntl || Number(actRates.bank) > 0) && (
                    <div>
                      <FL label={`Bank Charges (${actModes.bank === 'pct' ? '%' : '₹'})`} mode={actModes.bank} onToggle={() => handleActMode('bank')} />
                      <input className="input" type="number" step="0.001" min="0" style={{ height: 30, fontSize: 11 }}
                        value={actRates.bank ?? ''} onChange={e => handleActRate('bank', e.target.value)} />
                      <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                        ₹{fmt(actCalc.bankINR / qty)} / unit
                      </div>
                    </div>
                  )}
                  <div>
                    <FL label={`Margin (${actModes.margin === 'pct' ? '%' : '₹'})`} mode={actModes.margin} locked />
                    <div style={{
                      height: 30, padding: '0 8px', fontSize: 11, fontWeight: 700,
                      background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: 6, color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                      <span>{actModes.margin === 'pct' ? `${actRates.margin}%` : money(actRates.margin)}</span>
                      <span title="Margin is locked to agreed Sourcing margin">🔒</span>
                    </div>
                    <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                      ₹{fmt(actCalc.marginAmt / qty)} / unit
                    </div>
                  </div>
                  <div>
                    <FL label={`Buffer (${actModes.buffer === 'pct' ? '%' : '₹'})`} mode={actModes.buffer} onToggle={() => handleActMode('buffer')} />
                    <input className="input" type="number" step="0.001" min="0" style={{ height: 30, fontSize: 11 }}
                      value={actRates.buffer ?? ''} onChange={e => handleActRate('buffer', e.target.value)} />
                    <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                      ₹{fmt(actCalc.bufferINR / qty)} / unit
                    </div>
                  </div>
                </div>
              </div>

              {/* Group: Additional Charges */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {stepNum.additional}. Additional Charges
                  </span>
                  <button type="button" className="btn btn-xs" onClick={addCharge} style={{ padding: '1px 6px', fontSize: 10 }}>
                    + Add Charge
                  </button>
                </div>
                {actExtraCharges.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <input className="input" style={{ flex: 2, height: 28, fontSize: 11, padding: '2px 6px' }}
                      placeholder="Charge description" value={c.name || ''} onChange={e => updCharge(i, 'name', e.target.value)} />
                    <input className="input" type="number" step="0.01" min="0" style={{ flex: 1, height: 28, fontSize: 11, padding: '2px 6px' }}
                      placeholder="₹ Amount" value={c.amount ?? ''} onChange={e => updCharge(i, 'amount', e.target.value)} />
                    <button type="button" onClick={() => removeCharge(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16 }}>×</button>
                  </div>
                ))}
              </div>

              {/* Group: Notes */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>
                  Notes &amp; Actual Expense Reconciliation
                </label>
                <input className="input" style={{ height: 28, fontSize: 11, padding: '2px 8px', width: '100%' }}
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Invoice verified, transport paid directly" />
              </div>

            </div>

            {/* Right Summary Panel (Dark Navy Panel from Image 2) */}
            <div style={{ background: '#0b1329', padding: '12px 14px', overflowY: 'auto' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                CALCULATION SUMMARY
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.12)', marginBottom: 8 }}>
                {compName} <span style={{ opacity: 0.5, fontSize: 11, fontWeight: 400 }}>×{qty}</span>
              </div>

              <SumRow label="Material Value" val={actCalc.materialValue} />
              {actCalc.freightINR > 0 && <SumRow label={`+ Freight (${actRates.freight || 0}${actModes.freight === 'pct' ? '%' : '₹'})`} val={actCalc.freightINR} />}
              {isIntl && actCalc.insuranceINR > 0 && <SumRow label={`+ Insurance (${actRates.insurance || 0}${actModes.insurance === 'pct' ? '%' : '₹'})`} val={actCalc.insuranceINR} />}
              {isIntl && <SumRow label="= CIF Value" val={actCalc.cifValue} bold />}
              {isIntl && <Divider />}

              {isIntl && (<>
                {actCalc.bcdAmount > 0 && <SumRow label={`+ BCD (${actRates.bcd || 0}${actModes.bcd === 'pct' ? '%' : '₹'})`} val={actCalc.bcdAmount} />}
                {actCalc.swsAmount > 0 && <SumRow label={`+ SWS (${actRates.sws || 0}${actModes.sws === 'pct' ? '%' : '₹'})`} val={actCalc.swsAmount} />}
                {actCalc.cessAmount > 0 && <SumRow label={`+ CESS (${actRates.cess || 0}${actModes.cess === 'pct' ? '%' : '₹'})`} val={actCalc.cessAmount} />}
                <SumRow label="= Import Cost" val={actCalc.importCost} bold />
                <Divider />
                {actCalc.clearingINR > 0 && <SumRow label={`+ Clearing (${actRates.clearing || 0}${actModes.clearing === 'pct' ? '%' : '₹'})`} val={actCalc.clearingINR} />}
              </>)}

              {actCalc.transportINR > 0 && <SumRow label={`+ Transport (${actRates.transport || 0}${actModes.transport === 'pct' ? '%' : '₹'})`} val={actCalc.transportINR} />}
              {actCalc.packagingINR > 0 && <SumRow label={`+ Packaging (${actRates.packaging || 0}${actModes.packaging === 'pct' ? '%' : '₹'})`} val={actCalc.packagingINR} />}
              {actCalc.bankINR > 0 && <SumRow label={`+ Bank Charges (${actRates.bank || 0}${actModes.bank === 'pct' ? '%' : '₹'})`} val={actCalc.bankINR} />}

              {(actCalc.freightINR > 0 || actCalc.transportINR > 0 || actCalc.packagingINR > 0 || actCalc.bankINR > 0 || isIntl) && (
                <SumRow label={isIntl ? "= Landed Before Margin" : "= Landed Cost (Before Margin)"} val={actCalc.landedBeforeMargin} bold />
              )}
              <Divider />

              <SumRow label={`+ Margin (${actRates.margin || 0}${actModes.margin === 'pct' ? '%' : '₹'})`} val={actCalc.marginAmt} />
              {actCalc.bufferINR > 0 && <SumRow label={`+ Buffer (${actRates.buffer || 0}${actModes.buffer === 'pct' ? '%' : '₹'})`} val={actCalc.bufferINR} />}
              {actExtraCharges.filter(c => Number(c?.amount) > 0).map((c, i) => (
                <SumRow key={i} label={`+ ${c.name || 'Extra Charge'}`} val={Number(c.amount)} />
              ))}
              <SumRow label="= Final Cost" val={actCalc.finalCost} bold />
              <SumRow label={`Unit Landed Cost (÷${qty})`} val={actCalc.unitLandedCost} />
              <Divider />

              <SumRow label="Grand Total" val={actCalc.grandTotal} highlight />

              {Number(actRates.quote_price) > 0 && (<>
                <Divider />
                <SumRow label="Quote Price / Unit" val={actCalc.quotePrice} bold />
                <SumRow label={`Quote Total (×${qty})`} val={actCalc.quoteTotal} bold />
                {actCalc.qGstPct > 0 && <SumRow label={`+ GST (${actCalc.qGstPct}%)`} val={actCalc.qGstAmt} />}
                <SumRow label="Quote Total + GST" val={actCalc.quoteTotalWithGst} highlight />
              </>)}
            </div>
          </div>
        </div>

      </div>

      {/* ── BOTTOM OUTCOME COMPARISON BAR (PROFIT / LOSS) ── */}
      <div style={{
        padding: '10px 16px', background: 'var(--surface2)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Sourcing Estimate: </span>
            <span className="mono" style={{ fontWeight: 800, color: 'var(--accent)' }}>{money(estTotal)}</span>
          </div>
          <span style={{ color: 'var(--text3)' }}>vs</span>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Actual Spent: </span>
            <span className="mono" style={{ fontWeight: 800, color: 'var(--green)' }}>{money(actTotal)}</span>
          </div>
        </div>

        {/* Live Profit / Loss Badge */}
        <div>
          {variance > 0.01 ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
              color: '#10b981', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800
            }}>
              <span>🟢</span> <span>PROFIT / SAVED: +{money(variance)} ({estTotal > 0 ? Math.round((variance / estTotal) * 100) : 0}% saved)</span>
            </div>
          ) : variance < -0.01 ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#ef4444', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800
            }}>
              <span>🔴</span> <span>LOSS / OVERRUN: -{money(Math.abs(variance))} ({estTotal > 0 ? Math.round((Math.abs(variance) / estTotal) * 100) : 0}% over budget)</span>
            </div>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
              color: '#3b82f6', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800
            }}>
              <span>🔵</span> <span>EXACT BUDGET MATCH</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Full-Screen In-Page Workspace View (Clean Single-Line Header) ──────
function AuditDetailView({ orderId, initialOrder, initialAudit, onClose, onSaved }) {
  const qc = useQueryClient();
  const id = orderId || initialOrder?.id || initialAudit?.order_id;

  const { data: audit, isLoading } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api.get(`/orders/${id}/audit`).then(r => r.data),
    initialData: initialAudit,
    enabled: !!id,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then(r => r.data).catch(() => [])
  });

  const custName = cid => customers.find(c => c.id === cid)?.name || cid;

  const items = audit?.items || [];
  const auditedCount = items.filter(i => Number(i.is_audited) === 1).length;
  const isAllAudited = items.length > 0 && auditedCount === items.length;
  const refresh = () => {
    qc.invalidateQueries(['audit', id]);
    qc.invalidateQueries(['audit-bin']);
    onSaved();
  };

  const totalEstimate = items.reduce((s, i) => s + (Number(i.est_total) || 0), 0);
  const totalActual = items.reduce((s, i) => s + (Number(i.act_total) || 0), 0);
  const customerPaid = Number(audit?.customer_paid_total) || 0;
  const budgetVariance = totalEstimate - totalActual;
  const dealProfit = customerPaid - (totalActual > 0 ? totalActual : totalEstimate);

  const orderData = audit?.order || initialOrder || {};
  const isCustIntl = orderData.customer_scope === 'international';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Compact Slim Single-Line Top Header Bar (No 5 giant cards) ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r, 8px)'
      }}>
        {/* Left: Back & Order Identifiers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, padding: '5px 10px', height: 30 }}>
            <span>←</span> Back
          </button>
          <div style={{ height: 18, width: 1, background: 'var(--border)' }} />
          <span className="mono" style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 13, background: 'var(--accent-lt)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--accent)33' }}>
            {orderData.id || id}
          </span>
          {orderData.customer_id && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              {custName(orderData.customer_id)}
            </span>
          )}
          {orderData.po_number && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
              PO: {orderData.po_number}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: isCustIntl ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)',
            color: isCustIntl ? '#3b82f6' : '#10b981'
          }}>
            {isCustIntl ? '🌐 Intl Customer' : '🇮🇳 Domestic Customer'}
          </span>
          {items.length > 0 && (
            isAllAudited ? (
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(16,185,129,0.15)', color: '#059669', border: '1px solid #10b981',
                display: 'inline-flex', alignItems: 'center', gap: 4
              }}>
                ✓ All Suppliers Audited ({auditedCount}/{items.length})
              </span>
            ) : (
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(245,158,11,0.15)', color: '#d97706', border: '1px solid rgba(245,158,11,0.5)',
                display: 'inline-flex', alignItems: 'center', gap: 4
              }}>
                ⏳ Audit Pending ({auditedCount}/{items.length} Saved)
              </span>
            )
          )}
          {orderData.settlement_status === 'settled' && (
            <span className="badge badge-green" style={{ fontSize: 10, fontWeight: 700 }}>✅ Settled</span>
          )}
        </div>

        {/* Right: Simple 3-Metric Financial Bar + Budget Saved Tag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Customer Paid (In): </span>
            <span className="mono" style={{ fontWeight: 800, color: 'var(--green)' }}>{money(customerPaid)}</span>
          </div>
          <div style={{ height: 14, width: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Actual Cost (Out): </span>
            <span className="mono" style={{ fontWeight: 800, color: totalActual > 0 ? 'var(--purple, #a855f7)' : 'var(--text3)' }}>
              {totalActual > 0 ? money(totalActual) : 'Pending Actuals'}
            </span>
          </div>
          <div style={{ height: 14, width: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text3)' }}>Net Profit: </span>
            <span className="mono" style={{ fontWeight: 800, color: dealProfit >= 0 ? '#10b981' : '#ef4444' }}>
              {totalActual > 0 ? (dealProfit >= 0 ? `+${money(dealProfit)}` : `-${money(Math.abs(dealProfit))}`) : '—'}
            </span>
            {customerPaid > 0 && totalActual > 0 && (
              <span style={{ fontSize: 10, color: dealProfit >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, marginLeft: 4 }}>
                ({((dealProfit / customerPaid) * 100).toFixed(1)}%)
              </span>
            )}
          </div>
          <div style={{ height: 14, width: 1, background: 'var(--border)' }} />
          {/* Subtle Budget Saved Tag */}
          <div style={{
            fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
            background: totalActual === 0 ? 'var(--surface2)' : (budgetVariance >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'),
            color: totalActual === 0 ? 'var(--text3)' : (budgetVariance >= 0 ? '#10b981' : '#ef4444'),
            border: `1px solid ${totalActual === 0 ? 'var(--border)' : (budgetVariance >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)')}`
          }}>
            {totalActual === 0 ? (
              <span>Estimate Budget: {money(totalEstimate)}</span>
            ) : budgetVariance > 0.01 ? (
              <span>🟢 Saved {money(budgetVariance)} vs estimate</span>
            ) : budgetVariance < -0.01 ? (
              <span>🔴 Over budget by {money(Math.abs(budgetVariance))}</span>
            ) : (
              <span>🔵 On Budget ({money(totalEstimate)})</span>
            )}
          </div>
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading audit data…</div>}
      {!isLoading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-state-text">No purchase orders found on this order.</div>
        </div>
      )}

      {/* ── 2-Way Audit Cards for Each Item ── */}
      {!isLoading && items.length > 0 && items.map(item => (
        <AuditItemCard key={item.id} item={item} onSaved={refresh} />
      ))}
    </div>
  );
}

// ── Main Audit Bin Page ───────────────────────────────────────────────────────
export default function AuditBinPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState('pending'); // 'pending' | 'done'

  const canSync = ['admin', 'manager'].includes(user?.role);
  const runSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/audit-bin/backfill');
      qc.invalidateQueries(['audit-bin']);
      toast.success(data.created > 0
        ? `✅ Added ${data.created} closed order(s) to Audit Bin`
        : 'Everything in Closed Bin is already in Audit Bin');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to sync Audit Bin');
    } finally {
      setSyncing(false);
    }
  };

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['audit-bin'],
    queryFn: () => api.get('/audit-bin').then(r => { const d = r.data; return Array.isArray(d) ? d : []; }).catch(() => []),
    refetchInterval: 20000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then(r => { const d = r.data; return Array.isArray(d) ? d : []; }).catch(() => [])
  });

  const custName = id => customers.find(c => c.id === id)?.name || (user?.perms?.canSeeCustomer === false ? '[Restricted]' : id);

  const pendingAudits = useMemo(() => audits.filter(a => !a.is_all_audited), [audits]);
  const doneAudits = useMemo(() => audits.filter(a => !!a.is_all_audited), [audits]);

  const displayedAudits = useMemo(() => {
    const list = tab === 'pending' ? pendingAudits : doneAudits;
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(a =>
      (a.order_id || '').toLowerCase().includes(q) ||
      (a.order?.po_number || '').toLowerCase().includes(q) ||
      custName(a.order?.customer_id).toLowerCase().includes(q)
    );
  }, [tab, pendingAudits, doneAudits, search, customers]);

  const totalAudits = audits.length;
  const totalCustomerPaid = audits.reduce((s, a) => s + (Number(a.customer_paid_total) || 0), 0);
  const totalEstimateBudget = audits.reduce((s, a) => s + (Number(a.est_total) || 0), 0);
  const totalActualSpent = audits.reduce((s, a) => s + (Number(a.act_total) || 0), 0);
  const totalDealProfit = totalCustomerPaid - totalActualSpent;

  // If orderId is in URL or selected, show full workspace
  if (orderId || selected) {
    const activeOrder = selected || audits.find(a => a.order_id === orderId);
    return (
      <AuditDetailView
        orderId={orderId || selected?.order_id}
        initialOrder={activeOrder?.order || { id: orderId || selected?.order_id, po_number: activeOrder?.order?.po_number }}
        initialAudit={activeOrder}
        onClose={() => { setSelected(null); navigate('/audit-bin'); }}
        onSaved={() => {
          qc.invalidateQueries(['audit-bin']);
          if (orderId) qc.invalidateQueries(['audit', orderId]);
        }}
      />
    );
  }

  return (
    <div>
      {/* ── Compact Dashboard Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          {
            label: 'Total Audits',
            val: totalAudits,
            sub: `${pendingAudits.length} pending · ${doneAudits.length} done`,
            color: 'var(--accent)'
          },
          { label: 'Customer Paid (In)', val: fmtM(totalCustomerPaid), color: 'var(--green)' },
          { label: 'Actual Cost (Out)', val: fmtM(totalActualSpent), color: 'var(--purple, #a855f7)' },
          {
            label: 'Net Deal Profit',
            val: (totalActualSpent > 0 ? (totalDealProfit >= 0 ? `+${fmtM(totalDealProfit)}` : `-${fmtM(Math.abs(totalDealProfit))}`) : '—'),
            sub: totalActualSpent > 0 ? (totalEstimateBudget >= totalActualSpent ? `🟢 Saved ${fmtM(totalEstimateBudget - totalActualSpent)} vs budget` : `🔴 Over budget by ${fmtM(totalActualSpent - totalEstimateBudget)}`) : null,
            color: totalDealProfit >= 0 ? 'var(--green)' : 'var(--red)'
          },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft: `3px solid ${s.color}`, padding: '10px 14px' }}>
            <div className="stat-label" style={{ fontSize: 10 }}>{s.label}</div>
            <div className="stat-val" style={{ fontSize: 18, color: s.color }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── 2 Tabs: Pending Audit vs Audit Done ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setTab('pending')}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
            border: tab === 'pending' ? '1px solid var(--accent)' : '1px solid var(--border)',
            background: tab === 'pending' ? 'var(--accent)' : 'var(--surface)',
            color: tab === 'pending' ? '#fff' : 'var(--text2)',
            boxShadow: tab === 'pending' ? '0 2px 6px rgba(59,130,246,0.25)' : 'none',
            transition: 'all 0.15s ease'
          }}>
          <span>⏳ Pending Audit</span>
          <span style={{
            fontSize: 11, padding: '1px 8px', borderRadius: 10,
            background: tab === 'pending' ? 'rgba(255,255,255,0.25)' : 'var(--surface2)',
            color: tab === 'pending' ? '#fff' : 'var(--text3)',
            fontWeight: 800
          }}>
            {pendingAudits.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('done')}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
            border: tab === 'done' ? '1px solid #10b981' : '1px solid var(--border)',
            background: tab === 'done' ? '#10b981' : 'var(--surface)',
            color: tab === 'done' ? '#fff' : 'var(--text2)',
            boxShadow: tab === 'done' ? '0 2px 6px rgba(16,185,129,0.25)' : 'none',
            transition: 'all 0.15s ease'
          }}>
          <span>✅ Audit Done</span>
          <span style={{
            fontSize: 11, padding: '1px 8px', borderRadius: 10,
            background: tab === 'done' ? 'rgba(255,255,255,0.25)' : 'var(--surface2)',
            color: tab === 'done' ? '#fff' : 'var(--text3)',
            fontWeight: 800
          }}>
            {doneAudits.length}
          </span>
        </button>
      </div>

      {/* ── Search & Sync Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="14.5" y2="14.5" /></svg>
          <input className="search-input" placeholder="Search order, PO, customer…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {canSync && (
          <button className="btn btn-sm" disabled={syncing} onClick={runSync} title="Pull in any Closed Bin order that's missing from Audit Bin">
            {syncing ? 'Syncing…' : '🔄 Sync from Closed Bin'}
          </button>
        )}
      </div>

      {isLoading && <div className="loading-center">Loading…</div>}
      {!isLoading && displayedAudits.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">{tab === 'pending' ? '⏳' : '✅'}</div>
          <div className="empty-state-text">
            {tab === 'pending'
              ? (search ? 'No pending audits match your search' : 'No pending audits! All closed orders are fully audited.')
              : (search ? 'No completed audits match your search' : 'No audits completed yet. Save all supplier actuals in an order to complete its audit.')
            }
          </div>
        </div>
      )}

      {/* ── Table View ── */}
      {displayedAudits.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r, 8px)', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 150px 150px 150px 170px 100px',
            gap: 0, background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
            padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', letterSpacing: .4
          }}>
            <div>ORDER / CUSTOMER</div>
            <div>CUSTOMER PAID (IN)</div>
            <div>ACTUAL COST (OUT)</div>
            <div>NET PROFIT</div>
            <div>BUDGET STATUS</div>
            <div style={{ textAlign: 'right' }}>ACTION</div>
          </div>
          {displayedAudits.map(a => {
            const est = Number(a.est_total) || 0;
            const act = Number(a.act_total) || 0;
            const variance = est - act;
            const hasAct = act > 0;
            const profit = (Number(a.customer_paid_total) || 0) - (hasAct ? act : est);
            return (
              <div key={a.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 150px 150px 150px 170px 100px',
                gap: 0, padding: '10px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center', cursor: 'pointer'
              }}
                onClick={() => navigate('/audit-bin/' + a.order_id)}>
                <div>
                  <span className="mono bold" style={{ fontSize: 13, color: 'var(--accent)' }}>{a.order_id}</span>
                  {a.order?.po_number && <span className="mono" style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>PO:{a.order.po_number}</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{custName(a.order?.customer_id)}</span>
                    {a.total_items_count > 0 && (
                      a.is_all_audited ? (
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 10,
                          background: 'rgba(16,185,129,0.12)', color: '#059669', border: '1px solid rgba(16,185,129,0.3)',
                          display: 'inline-flex', alignItems: 'center', gap: 3
                        }}>
                          ✓ All {a.total_items_count} Audited
                        </span>
                      ) : a.audited_count > 0 ? (
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 10,
                          background: 'rgba(245,158,11,0.12)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)',
                          display: 'inline-flex', alignItems: 'center', gap: 3
                        }}>
                          ⏳ {a.audited_count}/{a.total_items_count} Audited
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 10,
                          background: 'var(--surface2)', color: 'var(--text3)', border: '1px solid var(--border)',
                          display: 'inline-flex', alignItems: 'center', gap: 3
                        }}>
                          ⏳ 0/{a.total_items_count} Audited
                        </span>
                      )
                    )}
                  </div>
                </div>

                <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                  {fmtM(a.customer_paid_total)}
                </div>

                <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: hasAct ? 'var(--purple, #a855f7)' : 'var(--text3)' }}>
                  {hasAct ? fmtM(act) : 'Pending Actuals'}
                </div>

                <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: profit >= 0 ? '#10b981' : '#ef4444' }}>
                  {hasAct ? (profit >= 0 ? `+${fmtM(profit)}` : `-${fmtM(Math.abs(profit))}`) : '—'}
                </div>

                <div>
                  {!hasAct ? (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Est Budget: {fmtM(est)}</span>
                  ) : variance >= 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: 12 }}>
                      🟢 Saved +{fmtM(variance)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', padding: '2px 8px', borderRadius: 12 }}>
                      🔴 Over -{fmtM(Math.abs(variance))}
                    </span>
                  )}
                </div>

                <div style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  <button className={`btn btn-xs ${a.is_all_audited ? 'btn-outline' : 'btn-primary'}`}
                    style={a.is_all_audited ? { borderColor: '#10b981', color: '#059669', fontWeight: 700 } : { fontWeight: 700 }}
                    onClick={() => navigate('/audit-bin/' + a.order_id)}>
                    {a.is_all_audited ? '✓ View' : '👁 Audit'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
