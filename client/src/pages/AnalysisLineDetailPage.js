// client/src/pages/AnalysisLineDetailPage.js
// Full-page supplier comparison for exactly ONE RFQ line. Currency
// Normalization & Landed Cost: every quote's original price/currency is
// preserved and shown alongside its value normalized into the chosen
// comparison currency; additional per-supplier costs (lab, freight,
// customs, etc.) can be layered in and compared as landed cost. On Award,
// the full calculation (quotes, costs, FX rates, comparison currency,
// results) is frozen into an award snapshot so later edits or FX drift
// never retroactively change an already-decided line.
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { rankLine, paymentLabel, fmt, CURRENCIES, COST_TYPES, costTypeLabel, convert, rankBg } from '../utils/rfqScoring';
import { useResizableGrid, ColResizeHandle, RowResizeHandle, resizableGridCSS, GRID_ROW_DEFAULT as ROW_DEFAULT } from '../hooks/useResizableGrid';

const COL_DEFAULT_LABEL = 170, COL_DEFAULT = 150;

// ─── ADD QUOTE MODAL ────────────────────────────────────────────────────────
function AddQuoteModal({ line, suppliers, inventoryItems = [], onClose, initialSupplierId }) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState(initialSupplierId || '');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [qty, setQty] = useState(line.quantity || '');
  const [lead, setLead] = useState('');
  const usedIds = new Set((line.quotes || []).map(q => q.supplier_id));
  const available = suppliers.filter(s => !usedIds.has(s.id));

  const _comp = (line.component || '').toLowerCase().trim();
  const _mfr = (line.manufacturer || '').toLowerCase().trim();
  const itemStockHits = (() => {
    const map = {};
    inventoryItems.forEach(inv => {
      const ic = (inv.component || '').toLowerCase().trim();
      const im = (inv.manufacturer || '').toLowerCase().trim();
      if (ic === _comp && im === _mfr) map[inv.id] = inv;
    });
    return Object.values(map);
  })();
  const availableStock = itemStockHits.filter(h => !usedIds.has('__inv__' + h.id));

  const save = async () => {
    if (!supplierId) return toast.error('Pick a supplier');
    try {
      await api.post(`/rfq/${line.id}/quotes`, {
        supplier_id: supplierId, price: price === '' ? null : Number(price), currency,
        available_qty: qty === '' ? null : Number(qty), lead_days: lead === '' ? null : Number(lead),
      });
      qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
      qc.invalidateQueries({ queryKey: ['rfq'] });
      toast.success('Quote added');
      onClose();
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to add quote'); }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header"><h2>Add Supplier Quote</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-group">
            <label className="label">Supplier</label>
            <select className="input" value={supplierId} onChange={e => {
              setSupplierId(e.target.value);
              if (e.target.value.startsWith('__inv__')) {
                const hit = inventoryItems.find(h => h.id === e.target.value.slice(7));
                if (hit) {
                  if (hit.target_price) setPrice(hit.target_price);
                  if (hit.target_currency) setCurrency(hit.target_currency);
                  if (hit.quantity_available) setQty(hit.quantity_available);
                }
              }
            }}>
              <option value="">— Select a supplier —</option>
              {availableStock.length > 0 && (
                <optgroup label="📦 IN STOCK">
                  {availableStock.map(h => (
                    <option key={'__inv__' + h.id} value={'__inv__' + h.id}>
                      {h.holder_type === 'customer' ? '👤' : h.holder_type === 'supplier' ? '🏢' : '🏭'} {h.holder_display || h.holder_name || 'Warehouse'}
                      {h.target_price ? ' — ' + (h.target_currency || 'INR') + ' ' + Number(h.target_price).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''} ({h.quantity_available} pcs)
                    </option>
                  ))}
                </optgroup>
              )}
              {availableStock.length > 0 && <option disabled>──────────</option>}
              {available.map(s => <option key={s.id} value={s.id}>{s.name} ({paymentLabel(s)})</option>)}
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><label className="label">Unit Price</label><input className="input" type="number" min="0" step="0.01" value={price} onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; setPrice(v); }} /></div>
            <div style={{ width: 110 }}><label className="label">Unit Currency</label>
              <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label className="label">Available Qty</label><input className="input" type="number" min="0" max={line.quantity} value={qty} onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; if (line.quantity && v !== '' && Number(v) > line.quantity) v = String(line.quantity); setQty(v); }} /></div>
          <div className="form-group"><label className="label">Lead Days</label><input className="input" type="number" min="0" value={lead} onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; setLead(v); }} /></div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={save}>Add Supplier Quote</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD CHARGE MODAL ────────────────────────────────────────────────────────
// ─── ADD CHARGE MODAL (multi-select, auto-currency) ─────────────────────────
function AddChargeModal({ line, compareCurrency, onClose, onSaved }) {
  // selected: Set of charge type values (strings)
  const [selected, setSelected] = useState(new Set());
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (val) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };

  const hasOther = selected.has('other');
  const canSave = selected.size > 0 && (!hasOther || customName.trim());

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // Build list of charges to add
      const toAdd = [];
      for (const val of selected) {
        if (val === 'other') {
          toAdd.push({ charge_name: customName.trim(), charge_type: 'other' });
        } else {
          const ct = COST_TYPES.find(c => c.value === val);
          if (ct) toAdd.push({ charge_name: ct.label, charge_type: val });
        }
      }
      // Add all in parallel
      await Promise.all(toAdd.map(ch =>
        api.post(`/rfq/${line.id}/charges`, {
          charge_name: ch.charge_name,
          charge_type: ch.charge_type,
          currency: compareCurrency,
          total_amount: 0,
        })
      ));
      toast.success(toAdd.length === 1 ? `"${toAdd[0].charge_name}" added` : `${toAdd.length} charges added`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to add charges');
    } finally {
      setSaving(false);
    }
  };

  // Separate predefined from Other
  const predefined = COST_TYPES.filter(ct => ct.value !== 'other');

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 500, maxWidth: '95vw' }}>
        <div className="modal-header">
          <h2>Additional Charges</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
            Select one or more charge types — amounts will be entered per-supplier in the table.
            Currency: <strong>{compareCurrency}</strong> (same as base comparison currency).
          </p>

          {/* Predefined charge types — checkbox grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {predefined.map(ct => (
              <label key={ct.value} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                borderRadius: 6, cursor: 'pointer', userSelect: 'none',
                background: selected.has(ct.value) ? 'var(--surface2)' : 'transparent',
                border: selected.has(ct.value) ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                transition: 'all 0.12s',
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(ct.value)}
                  onChange={() => toggle(ct.value)}
                  style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, fontWeight: selected.has(ct.value) ? 700 : 400, color: selected.has(ct.value) ? 'var(--accent)' : 'var(--text)' }}>
                  {ct.label}
                </span>
              </label>
            ))}

            {/* Other — inline with text input */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
              borderRadius: 6, cursor: 'pointer', userSelect: 'none',
              background: hasOther ? 'var(--surface2)' : 'transparent',
              border: hasOther ? '1.5px solid var(--accent)' : '1.5px solid transparent',
              transition: 'all 0.12s',
            }}>
              <input
                type="checkbox"
                checked={hasOther}
                onChange={() => toggle('other')}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, fontWeight: hasOther ? 700 : 400, color: hasOther ? 'var(--accent)' : 'var(--text)', flexShrink: 0 }}>
                Other:
              </span>
              {hasOther && (
                <input
                  className="input"
                  style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                  placeholder="Enter charge name…"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              )}
            </label>
          </div>

          {selected.size > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px', border: '1px solid var(--border)' }}>
              {selected.size} charge{selected.size > 1 ? 's' : ''} selected — will use <strong>{compareCurrency}</strong> as amount currency
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={save}
            disabled={saving || !canSave}
          >
            {saving ? 'Adding…' : `➕ Add${selected.size > 1 ? ` ${selected.size} Charges` : ' Charge'}`}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── QUOTE PRICE CELL ─────────────────────────────────────────────────────────
function QuotePriceCell({ q, lineId, lineOpen }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(q.price ?? '');
  const [currency, setCurrency] = useState(q.currency || 'INR');
  const save = async (field, value) => {
    try {
      await api.post(`/rfq/${lineId}/quotes`, {
        id: q.id, supplier_id: q.supplier_id,
        price: field === 'price' ? (value === '' ? null : Number(value)) : q.price,
        currency: field === 'currency' ? value : q.currency,
        available_qty: q.available_qty, lead_days: q.lead_days,
      });
      qc.invalidateQueries({ queryKey: ['rfq-line', lineId] });
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to save'); }
  };
  if (!lineOpen) return <span className="mono">{q.currency} {fmt(q.price)}</span>;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <select className="input" style={{ width: 65 }} value={currency} onChange={e => { setCurrency(e.target.value); save('currency', e.target.value); }}>
        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="input" type="number" min="0" step="0.01" style={{ width: 80 }} value={price} onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; setPrice(v); }} onBlur={e => save('price', e.target.value)} />
    </div>
  );
}

// ─── QUOTE QTY / LEAD CELL ────────────────────────────────────────────────────
function QuoteQtyLeadCell({ q, field, lineId, lineOpen, width, suffix, style, req }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(field === 'qty' ? (q.available_qty ?? '') : (q.lead_days ?? ''));
  const save = async (value) => {
    try {
      await api.post(`/rfq/${lineId}/quotes`, {
        id: q.id, supplier_id: q.supplier_id, price: q.price, currency: q.currency,
        available_qty: field === 'qty' ? (value === '' ? null : Number(value)) : q.available_qty,
        lead_days: field === 'lead' ? (value === '' ? null : Number(value)) : q.lead_days,
      });
      qc.invalidateQueries({ queryKey: ['rfq-line', lineId] });
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to save'); }
  };
  if (!lineOpen) return <span style={style}>{val === '' ? '—' : val}{suffix || ''}</span>;
  return <input className="input" type="number" min="0" max={field === 'qty' ? req : undefined} style={{ width: width || 70, ...style }} value={val} onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; if (field === 'qty' && req && v !== '' && Number(v) > req) v = String(req); setVal(v); }} onBlur={e => save(e.target.value)} />;
}

// ─── CHARGE AMOUNT CELL (per-supplier inline edit) ───────────────────────────
function ChargeAmountCell({ charge, supplierId, lineId, onSaved }) {
  const existingEntry = (charge.supplier_amounts || []).find(sa => sa.supplier_id === supplierId);
  const [val, setVal] = useState(existingEntry ? String(existingEntry.amount ?? 0) : '0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const entry = (charge.supplier_amounts || []).find(sa => sa.supplier_id === supplierId);
    setVal(entry ? String(entry.amount ?? 0) : '0');
  }, [charge.supplier_amounts, supplierId]);

  const save = async (value) => {
    setSaving(true);
    try {
      await api.post(`/rfq/${lineId}/charges/${charge.id}/supplier-amount`, {
        supplier_id: supplierId,
        amount: value === '' ? 0 : Number(value),
      });
      if (onSaved) onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save charge amount');
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      className="input"
      type="number"
      min="0"
      step="0.01"
      style={{ width: 90, textAlign: 'center', fontSize: 12, opacity: saving ? 0.6 : 1 }}
      value={val}
      onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; setVal(v); }}
      onBlur={e => save(e.target.value)}
      title={'Enter ' + charge.charge_name + ' for this supplier (' + charge.currency + ')'}
    />
  );
}

// ─── CIFLUX INTELLIGENCE MODAL ────────────────────────────────────────────────
function CifluxIntelligenceModal({ line, onClose, onAddSupplier }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ciflux-history', line.component, line.manufacturer],
    queryFn: () => api.get('/rfq/ciflux-history?component=' + encodeURIComponent(line.component || '') + '&manufacturer=' + encodeURIComponent(line.manufacturer || '')).then(r => r.data),
  });

  return (
    <div className="overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 600, background: 'var(--surface)', borderRadius: 12, border: 'none', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ background: 'linear-gradient(135deg, #10b981, #3b82f6)', padding: '16px 20px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>✨ Ciflux Intelligence</h2>
          <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', lineHeight: 1 }} onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: 20 }}>
          <p style={{ margin: '0 0 16px 0', fontSize: 14, color: 'var(--text2)' }}>
            Checking previous purchases for Exact Part Number <strong>{line.component}</strong> and Manufacturer <strong>{line.manufacturer}</strong>...
          </p>
          {isLoading ? (
            <div className="empty-state-text">Scanning database...</div>
          ) : (!data || data.length === 0) ? (
            <div className="empty-state-text" style={{ padding: 40, border: '1px dashed var(--border)', borderRadius: 8 }}>
              No purchase this item same simple.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.map(item => (
                <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text1)', fontSize: 15, marginBottom: 4 }}>{item.supplierName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                      Date: <span style={{color: 'var(--text2)'}}>{item.awardedAt}</span> &nbsp;|&nbsp;
                      Qty: <span style={{color: 'var(--text2)'}}>{item.quantity}</span> &nbsp;|&nbsp;
                      Price: <span style={{color: 'var(--text2)', fontWeight: 600}}>{item.currency} {fmt(item.price)} / unit</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Do you want to use this same supplier in current line item?</span>
                    <button className="btn btn-sm btn-primary" style={{ background: '#3b82f6', borderColor: '#3b82f6' }} onClick={() => onAddSupplier(item.supplierId)}>
                      Yes, Use Supplier
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function AnalysisLineDetailPage() {
  const { lineId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showCifluxModal, setShowCifluxModal] = useState(false);
  const [intelPresetSupplier, setIntelPresetSupplier] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteChargeTarget, setDeleteChargeTarget] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [compareCurrency, setCompareCurrency] = useState(null);
  const [priority, setPriority] = useState(['total_cost', 'lead', 'terms']);
  const [comparisonMode, setComparisonMode] = useState('total_cost');
  const [manualRates, setManualRates] = useState({});
  const [isFetchingLive, setIsFetchingLive] = useState(false);
  const tableRef = useRef(null);
  const { colWidths, rowHeights, startColDrag, startRowDrag, autoFitColumn } = useResizableGrid();

  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparisonFingerprint, setComparisonFingerprint] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const { data: line, isLoading } = useQuery({ queryKey: ['rfq-line', lineId], queryFn: () => api.get('/rfq/' + lineId).then(r => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/customers').then(r => r.data) });
  const { data: inventoryItems = [] } = useQuery({ queryKey: ['inventory'], queryFn: () => api.get('/inventory').then(r => r.data) });
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings').then(r => r.data) });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then(r => r.data).catch(() => []) });
  const suppliersById = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const additionalCharges = line ? (line.additional_charges || []) : [];

  const effectiveCompareCurrency = CURRENCIES.includes(compareCurrency)
    ? compareCurrency
    : CURRENCIES.includes(line && line.comparison_currency ? line.comparison_currency : null)
      ? line.comparison_currency
      : CURRENCIES.includes(settings.default_comparison_currency)
        ? settings.default_comparison_currency
        : CURRENCIES.includes(line && line.target_currency ? line.target_currency : null) ? line.target_currency : 'INR';

  useEffect(() => {
    if (line) {
      if (line.comparison_currency && CURRENCIES.includes(line.comparison_currency)) {
        setCompareCurrency(line.comparison_currency);
      }
      if (line.comparison_priority && Array.isArray(line.comparison_priority) && line.comparison_priority.length === 3) {
        setPriority(line.comparison_priority.map(p => (p === 'price' ? 'total_cost' : p)));
      }
      if (line.comparison_mode && (line.comparison_mode === 'unit_price' || line.comparison_mode === 'total_cost')) {
        setComparisonMode('total_cost');
      }
      // Populate saved FX rates from database so previous rates are preserved!
      const savedRates = line.saved_fx_rates || (line.award_snapshots && line.award_snapshots[0]?.fx_rates_used ? (() => {
        try {
          return typeof line.award_snapshots[0].fx_rates_used === 'string'
            ? JSON.parse(line.award_snapshots[0].fx_rates_used)
            : line.award_snapshots[0].fx_rates_used;
        } catch(_) { return null; }
      })() : null);
      if (savedRates && typeof savedRates === 'object' && Object.keys(savedRates).length > 0) {
        setManualRates(savedRates);
      }
    }
  }, [line ? line.id : null, line ? line.comparison_completed_at : null, line ? line.comparison_currency : null, JSON.stringify(line ? line.comparison_priority : null), line ? line.comparison_mode : null]);

  const hasSavedRates = useMemo(() => {
    const s = line?.saved_fx_rates || (line?.award_snapshots && line.award_snapshots[0]?.fx_rates_used);
    if (!s) return false;
    try {
      const parsed = typeof s === 'string' ? JSON.parse(s) : s;
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    } catch (_) {
      return false;
    }
  }, [line]);

  const neededCurrencies = useMemo(() => {
    if (!line) return [];
    const set = new Set();
    (line.quotes || []).forEach(q => {
      if (q.currency && q.currency !== effectiveCompareCurrency) set.add(q.currency);
    });
    additionalCharges.forEach(charge => {
      if (charge.currency && charge.currency !== effectiveCompareCurrency) set.add(charge.currency);
    });
    return [...set];
  }, [line, effectiveCompareCurrency, additionalCharges]);

  const otherCurrencies = useMemo(() => {
    return CURRENCIES.filter(c => c !== effectiveCompareCurrency);
  }, [effectiveCompareCurrency]);

  const fetchLiveRates = async () => {
    setIsFetchingLive(true);
    try {
      const updated = { ...manualRates };
      for (const cur of otherCurrencies) {
        const res = await api.get('/fx-rate', { params: { from: cur, to: effectiveCompareCurrency } });
        if (res.data && res.data.rate) {
          updated[cur] = Number(res.data.rate);
        }
      }
      setManualRates(updated);
      qc.invalidateQueries({ queryKey: ['fx-rates'] });
      toast.success(`Live rates refreshed for ${effectiveCompareCurrency}`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to fetch live FX rates');
    } finally {
      setIsFetchingLive(false);
    }
  };

  const { data: fetchedRates = {} } = useQuery({
    queryKey: ['fx-rates', otherCurrencies, effectiveCompareCurrency],
    queryFn: async () => {
      const results = {};
      for (const cur of otherCurrencies) {
        try {
          const res = await api.get('/fx-rate', { params: { from: cur, to: effectiveCompareCurrency } });
          results[cur] = res.data;
        } catch (_) {}
      }
      return results;
    },
    // Only auto-fetch live rates if no rates were previously saved in DB!
    enabled: otherCurrencies.length > 0 && !hasSavedRates,
  });

  const rates = {};
  otherCurrencies.forEach(c => {
    if (manualRates[c] != null) rates[c] = manualRates[c];
    else if (fetchedRates[c] && fetchedRates[c].rate != null) rates[c] = fetchedRates[c].rate;
  });

  const quotesFingerprint = JSON.stringify(
    (line ? line.quotes || [] : []).map(q => ({
      id: q.id, price: q.price, currency: q.currency, available_qty: q.available_qty, lead_days: q.lead_days
    }))
  ) + '|' + effectiveCompareCurrency + '|' + JSON.stringify(priority)
    + '|' + JSON.stringify(additionalCharges.map(c => ({ id: c.id, supplier_amounts: c.supplier_amounts })));

  useEffect(() => {
    if (comparisonFingerprint !== null && quotesFingerprint !== comparisonFingerprint) setIsStale(true);
  }, [quotesFingerprint, comparisonFingerprint]);

  useEffect(() => {
    if (line && line.comparison_complete && comparisonResult === null && (line.quotes || []).length >= 2) {
      const allRatesReady = neededCurrencies.every(c => manualRates[c] != null || (fetchedRates[c] && fetchedRates[c].rate != null));
      if (allRatesReady) {
        const curPriority = (priority && priority.length === 3 && priority.every(Boolean))
          ? priority.map(p => (p === 'price' ? 'total_cost' : p))
          : (line.comparison_priority ? line.comparison_priority.map(p => (p === 'price' ? 'total_cost' : p)) : ['total_cost', 'lead', 'terms']);
        const result = rankLine(line.quotes, suppliersById, {
          compareCurrency: effectiveCompareCurrency,
          rates,
          priority: curPriority,
          qty: Number(line.quantity) || 0,
          additionalCharges,
        });
        if (result.ranked && result.ranked.length > 0) {
          setComparisonResult(result);
          setComparisonFingerprint(quotesFingerprint);
          setIsStale(false);
        }
      }
    }
  }, [line ? line.id : null, line ? line.comparison_complete : null, Boolean(comparisonResult), neededCurrencies.length, Object.keys(fetchedRates).length, effectiveCompareCurrency, priority, quotesFingerprint]);

  const saveComparison = async resultToSave => {
    const cleanPriority = priority.map(p => (p === 'price' ? 'total_cost' : p));
    await api.post('/rfq/' + line.id + '/save-comparison', {
      comparison_currency: effectiveCompareCurrency,
      comparison_priority: cleanPriority,
      comparison_mode: 'total_cost',
      fx_rates_used: rates,
      quotes_snapshot: (line.quotes || []).map(q => ({ id: q.id, supplier_id: q.supplier_id, price: q.price, currency: q.currency, available_qty: q.available_qty, lead_days: q.lead_days })),
      computed_results: {
        ranked: resultToSave.ranked.map(r => ({
          id: r.id, supplier_id: r.supplier_id, combined: r.combined, score: r.score,
          scoreBreakdown: r.scoreBreakdown,
          normalizedPrice: r.normalizedPrice, normalizedTotalCost: r.normalizedTotalCost, rank: r.rank
        })),
        bestPrice: resultToSave.bestPrice,
        bestPriceSupplierId: resultToSave.bestPriceSupplierId,
        bestTotalCost: resultToSave.bestTotalCost,
        bestTotalCostSupplierId: resultToSave.bestTotalCostSupplierId
      },
    });
  };

  const runComparison = async () => {
    if (!line) return;
    const cleanPriority = priority.map(p => (p === 'price' ? 'total_cost' : p));
    const result = rankLine(line.quotes, suppliersById, {
      compareCurrency: effectiveCompareCurrency,
      rates,
      priority: cleanPriority,
      qty: Number(line.quantity) || 0,
      additionalCharges,
    });
    if (!result.ranked.length) return toast.error(result.reason);
    setComparisonResult(result);
    setComparisonFingerprint(quotesFingerprint);
    setIsStale(false);
    try {
      await saveComparison(result);
      qc.invalidateQueries({ queryKey: ['fx-rates'] });
      qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
      qc.invalidateQueries({ queryKey: ['rfq'] });
      toast.success('Comparison checked and saved');
    } catch (e) { toast.error(e?.response?.data?.error || 'Comparison checked but could not be saved'); }
  };

  const deleteCharge = async (chargeId, chargeName) => {
    try {
      await api.delete('/rfq/' + line.id + '/charges/' + chargeId);
      qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
      toast.success('"' + chargeName + '" removed');
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to remove charge'); }
  };

  const invalidateLine = useCallback(() => {
    if (line) qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
  }, [qc, line ? line.id : null]);

  if (isLoading) return <div className="loading-center">Loading…</div>;
  if (!line) return <div className="empty-state"><div className="empty-state-text">Line not found.</div></div>;

  const customerName = (customers.find(c => c.id === line.customer_id) || {}).name || line.customer_id;
  const req = Number(line.quantity) || 0;
  const emptyResult = { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, reason: 'Not yet compared' };
  const { ranked, reason } = comparisonResult || emptyResult;
  const rankByQuoteId = Object.fromEntries(ranked.map(r => [r.id, r.rank]));
  const scoreByQuoteId = Object.fromEntries(ranked.map(r => [r.id, { score: r.score, breakdown: r.scoreBreakdown }]));
  const canRunComparison = (line.quotes || []).length >= 2;
  const showTotalCostRow = comparisonMode === 'total_cost';

  const deleteQuote = async (quoteId, supplierName) => {
    try {
      await api.delete('/rfq/' + line.id + '/quotes/' + quoteId);
      qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
      qc.invalidateQueries({ queryKey: ['rfq'] });
      toast.success('Supplier removed from comparison');
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to remove supplier'); }
  };

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/rfq-analysis')}>← Back to RFQ Analysis</button>

      {/* Line Info */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', gap: 24, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ color: 'var(--text3)' }}>ENQ:</span>
            <span className="mono bold" style={{ fontSize: 14 }}>{line.enquiry_no}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ color: 'var(--text3)' }}>Date:</span>
            <span className="bold" style={{ fontSize: 14 }}>{String(line.enquiry_created_at || line.created_at || '').slice(0, 10)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ color: 'var(--text3)' }}>Customer:</span>
            <span className="bold" style={{ fontSize: 14 }}>{customerName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ color: 'var(--text3)' }}>Part Number:</span>
            <span className="mono bold" style={{ fontSize: 14 }}>{line.component}</span>
            {line.ipn ? <span style={{ color: 'var(--text3)', fontSize: 12 }}> ({line.ipn})</span> : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ color: 'var(--text3)' }}>Required Qty:</span>
            <span className="bold" style={{ fontSize: 14 }}>{line.quantity}</span>
          </div>
          {line.manufacturer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label" style={{ color: 'var(--text3)' }}>Manufacturer:</span>
              <span style={{ fontSize: 14 }}>{line.manufacturer}</span>
            </div>
          )}
          {line.date_code && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label" style={{ color: 'var(--text3)' }}>Date Code:</span>
              <span style={{ fontSize: 14 }}>{line.date_code}</span>
            </div>
          )}
          {line.comparison_completed_at ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label" style={{ color: 'var(--text3)' }}>Compared:</span>
              <span className="badge badge-blue" style={{ fontSize: 12, fontWeight: 700 }}>
                ✓ {String(line.comparison_completed_at).slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label" style={{ color: 'var(--text3)' }}>Status:</span>
              <span className="badge badge-amber" style={{ fontSize: 12, fontWeight: 700 }}>
                Pending Comparison
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card-title" style={{ marginBottom: 6 }}><span>Supplier Comparison</span></div>

      {/* Controls Row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        {['1st', '2nd', '3rd'].map((label, idx) => {
          const weightPct = idx === 0 ? '40%' : '30%';
          const curVal = priority[idx] === 'price' ? 'total_cost' : priority[idx];
          return (
            <div key={idx}>
              <label className="label" style={{ display: 'block', marginBottom: 3 }}>{label} Priority ({weightPct})</label>
              <select className="input" value={curVal} onChange={e => {
                const newVal = e.target.value;
                const newP = [...priority.map(p => (p === 'price' ? 'total_cost' : p))];
                for (let i = 0; i < 3; i++) {
                  if (i !== idx && newP[i] === newVal && newVal !== '') {
                    newP[i] = newP[idx]; // swap cleanly
                  }
                }
                newP[idx] = newVal;
                setPriority(newP);
              }} style={{ fontWeight: 600, color: 'var(--accent)' }}>
                <option value="">--</option>
                <option value="total_cost">Total Cost</option>
                <option value="lead">Lead Time</option>
                <option value="terms">Payment Terms</option>
              </select>
            </div>
          );
        })}

        <div>
          <label className="label" style={{ display: 'block', marginBottom: 3 }}>Base Currency</label>
          <select className="input" value={effectiveCompareCurrency} onChange={e => setCompareCurrency(e.target.value)} style={{ fontWeight: 600, color: 'var(--accent)' }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <button className="btn btn-sm btn-primary" onClick={runComparison} disabled={!canRunComparison}
          title={!canRunComparison ? 'Add at least 2 supplier quotes to compare' : 'Compute the ranking from current prices/costs'}
          style={!canRunComparison ? { opacity: .5, cursor: 'not-allowed' } : {}}>
          ✓ Check &amp; Save Comparison
        </button>
        <button className="btn btn-sm" style={{ fontWeight: 700, borderWidth: 2, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => setShowAddQuote(true)}>+ Add Supplier Quote</button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowAddCharge(true)}
          style={{ fontWeight: 700, borderWidth: 2, borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          ➕ Additional Charges
        </button>
      </div>

      {/* Currency Exchange Rates Bar (outside table) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        padding: '8px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>💱</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Exchange Rates (to {effectiveCompareCurrency}):</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {otherCurrencies.map(c => {
            const fetched = fetchedRates[c];
            const isUsed = neededCurrencies.includes(c);
            return (
              <div key={c} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--surface2)',
                padding: '4px 10px',
                borderRadius: 6,
                border: isUsed ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: isUsed ? 'var(--accent)' : 'var(--text)' }}>
                  1 {c} =
                </span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Rate"
                  style={{
                    width: 85,
                    padding: '3px 6px',
                    fontSize: 12,
                    textAlign: 'center',
                    fontWeight: 700,
                    background: 'var(--surface)',
                  }}
                  value={manualRates[c] != null ? manualRates[c] : (fetched ? fetched.rate : '')}
                  onChange={e => {
                    let v = e.target.value;
                    if (v !== '' && Number(v) < 0) v = '0';
                    setManualRates(m => Object.assign({}, m, { [c]: v === '' ? undefined : Number(v) }));
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>{effectiveCompareCurrency}</span>
                {fetched && (
                  <span
                    style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}
                    title={fetched.source + ' · ' + fetched.rate_date}
                  >
                    ({manualRates[c] != null ? 'manual' : 'auto'})
                  </span>
                )}
                {isUsed && (
                  <span style={{ fontSize: 9, color: '#fff', background: 'var(--accent)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                    in use
                  </span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="btn btn-sm"
            onClick={fetchLiveRates}
            disabled={isFetchingLive}
            title="Fetch latest live exchange rates from API"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              padding: '4px 10px',
              fontWeight: 700,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              cursor: isFetchingLive ? 'wait' : 'pointer',
              marginLeft: 4,
            }}
          >
            <span style={{ display: 'inline-block', transform: isFetchingLive ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s' }}>
              🔄
            </span>
            {isFetchingLive ? 'Fetching…' : 'Refresh Rates'}
          </button>
        </div>
      </div>

      {/* Scoring Weightage Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontWeight: 600 }}>
          🧮 Scoring Weightage: 1st ({priority[0] === 'lead' ? 'Lead Time' : priority[0] === 'terms' ? 'Payment Terms' : 'Total Cost'} 40%) + 2nd ({priority[1] === 'lead' ? 'Lead Time' : priority[1] === 'terms' ? 'Payment Terms' : 'Total Cost'} 30%) + 3rd ({priority[2] === 'lead' ? 'Lead Time' : priority[2] === 'terms' ? 'Payment Terms' : 'Total Cost'} 30%) = 100%
        </span>
      </div>

      {!canRunComparison && (
        <div className="empty-state-text" style={{ marginBottom: 10 }}>
          Add a second supplier quote before running a comparison — one supplier alone has nothing to compare against.
        </div>
      )}
      {comparisonResult && isStale && (
        <div style={{ background: 'var(--amber-lt, #fff2cf)', color: 'var(--amber, #9c6500)', border: '1px solid #f0dca0', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          ⚠ Comparison out of date — prices or costs changed since the last run. Click "Check &amp; Save Comparison" to refresh.
        </div>
      )}

      <div className="empty-state-text" style={{ marginBottom: 10 }}>
        Qty is an eligibility check, not part of the score — cells in red don't meet the required quantity.
      </div>

      {ranked.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, fontWeight: 600, alignItems: 'center' }}>
          <span style={{ color: 'var(--text3)' }}>Ranking Legend:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, background: 'var(--green-lt, #c6efce)', border: '1px solid var(--green, #0a7a3d)', borderRadius: 3 }}></div>
            <span>1st Choice (Best)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, background: 'var(--amber-lt, #ffeb9c)', border: '1px solid var(--amber, #9c6500)', borderRadius: 3 }}></div>
            <span>2nd Choice</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, background: 'var(--blue-lt, #cfe2ff)', border: '1px solid #9ec5fe', borderRadius: 3 }}></div>
            <span>3rd Choice</span>
          </div>
        </div>
      )}

      {/* Comparison Table */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginLeft: 16 }}>
        <style>{`
          ${resizableGridCSS('rfq-cmp-table')}
          .rfq-cmp-table { font-size: 12.5px; }
          .rfq-cmp-table th, .rfq-cmp-table td { text-align: center !important; padding: 5px 10px !important; border: 1px solid var(--border); }
          .rfq-cmp-table th { background: var(--surface2); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; color: var(--text2); }
          .rfq-cmp-table td > div, .rfq-cmp-table td > span { margin: 0 auto; }
          .rfq-cmp-table input, .rfq-cmp-table select { text-align: center; margin: 0 auto; }
          .rfq-cmp-table .rfq-row-label { text-align: left !important; font-weight: 600; color: var(--text3); font-size: 11px; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: sticky; left: 0; background: var(--surface2); z-index: 2; }
          .rfq-cmp-table .charge-row-label { text-align: left !important; font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: sticky; left: 0; background: var(--surface2); z-index: 2; color: var(--accent); }
          .rfq-cmp-table .total-cost-label { text-align: left !important; font-weight: 800; font-size: 12px; white-space: nowrap; position: sticky; left: 0; background: var(--surface2); z-index: 2; color: var(--accent); border-top: 2px solid var(--border) !important; }
        `}</style>
        {(!line.quotes || line.quotes.length === 0) ? (
          <div className="empty-state-text" style={{ padding: 16, textAlign: 'center' }}>No quotes yet on this line.</div>
        ) : (
          <table ref={tableRef} className="rfq-cmp-table" style={{ marginBottom: 0 }}>
            <colgroup>
              <col style={{ width: colWidths.label || COL_DEFAULT_LABEL }} />
              {line.quotes.map(q => <col key={q.id} style={{ width: colWidths[q.id] || COL_DEFAULT }} />)}
            </colgroup>
            <thead>
              <tr style={{ height: rowHeights.header || ROW_DEFAULT }}>
                <th className="rfq-row-label" data-col-key="label">
                  Supplier
                  <ColResizeHandle onDragStart={e => startColDrag(e, 'label', colWidths.label || COL_DEFAULT_LABEL)} onAutoFit={() => autoFitColumn(tableRef, 'label')} />
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'header', rowHeights.header || ROW_DEFAULT)} />
                </th>
                {line.quotes.map(q => {
                  const isInvStock = q.supplier_id && q.supplier_id.startsWith('__inv__');
                  const invStockHit = isInvStock ? inventoryItems.find(h => h.id === q.supplier_id.slice(7)) : null;
                  const s = isInvStock ? null : suppliersById[q.supplier_id];
                  const supName = isInvStock ? (((invStockHit && (invStockHit.holder_display || invStockHit.holder_name)) || 'Warehouse') + ' (Stock)') : ((s && s.name) || q.supplier_id);
                  const rank = rankByQuoteId[q.id];
                  const bg = rankBg(rank);
                  return (
                    <th key={q.id} className="bold" data-col-key={q.id} style={{ background: bg, position: 'relative' }}>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget({ id: q.id, name: supName }); }}
                        title="Remove this supplier from the comparison"
                        style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, lineHeight: '14px', textAlign: 'center', padding: 0, border: '1px solid var(--border)', borderRadius: '50%', background: 'var(--surface)', color: 'var(--text3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', zIndex: 4 }}
                      >✕</button>
                      <div style={{ wordBreak: 'break-word', paddingRight: 16 }}>{supName}</div>
                      {rank ? (
                        <div style={{ marginTop: 4 }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: rank === 1 ? 'var(--green, #0a7a3d)' : rank === 2 ? '#b8860b' : rank === 3 ? '#2563eb' : 'var(--surface2)',
                            color: rank <= 3 ? '#fff' : 'var(--text)',
                            boxShadow: rank === 1 ? '0 1px 4px rgba(10,122,61,0.25)' : 'none',
                            letterSpacing: '0.02em',
                          }}>
                            #{rank}{scoreByQuoteId[q.id]?.score !== undefined ? ` · ${scoreByQuoteId[q.id].score}/100` : ''}
                          </span>
                        </div>
                      ) : null}
                      <ColResizeHandle onDragStart={e => startColDrag(e, q.id, colWidths[q.id] || COL_DEFAULT)} onAutoFit={() => autoFitColumn(tableRef, q.id)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Unit Price */}
              <tr style={{ height: rowHeights.original_quote || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Unit Price
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'original_quote', rowHeights.original_quote || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank) }}><QuotePriceCell q={q} lineId={line.id} lineOpen /></td>;
                })}
              </tr>

              {/* Available Qty */}
              <tr style={{ height: rowHeights.available_qty || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Available Qty
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'available_qty', rowHeights.available_qty || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const shortQty = q.available_qty !== null && q.available_qty !== '' && Number(q.available_qty) < req;
                  return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank) }}><QuoteQtyLeadCell q={q} field="qty" req={req} lineId={line.id} lineOpen style={shortQty ? { color: 'var(--red)', fontWeight: 700, borderColor: 'var(--red)' } : {}} /></td>;
                })}
              </tr>

              {/* Lead Time */}
              <tr style={{ height: rowHeights.lead_time || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Lead Time
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'lead_time', rowHeights.lead_time || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank) }}><QuoteQtyLeadCell q={q} field="lead" lineId={line.id} lineOpen suffix=" days" /></td>;
                })}
              </tr>

              {/* Payment Terms */}
              <tr style={{ height: rowHeights.payment_terms || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Payment Terms
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'payment_terms', rowHeights.payment_terms || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const isInvStock = q.supplier_id && q.supplier_id.startsWith('__inv__');
                  const s = isInvStock ? null : suppliersById[q.supplier_id];
                  const rank = rankByQuoteId[q.id];
                  return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank) }}>{isInvStock ? 'Internal' : paymentLabel(s)}</td>;
                })}
              </tr>

              {/* Normalized Unit Price */}
              <tr style={{ height: rowHeights.normalized || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Unit Price ({effectiveCompareCurrency})
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'normalized', rowHeights.normalized || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const normalizedPrice = convert(q.price, q.currency, effectiveCompareCurrency, rates);
                  return <td key={q.id} data-col-key={q.id} className="mono bold" style={{ background: rankBg(rank) }}>{normalizedPrice !== null ? fmt(normalizedPrice) : <span style={{ color: 'var(--red)' }}>rate needed</span>}</td>;
                })}
              </tr>

              {/* Additional Charges section header */}
              {additionalCharges.length > 0 && (
                <tr style={{ height: 24 }}>
                  <td colSpan={1 + line.quotes.length} style={{
                    background: 'var(--surface2)', padding: '4px 10px', borderTop: '2px solid var(--border)',
                    fontSize: 10, fontWeight: 800, color: 'var(--text2)', textAlign: 'left',
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                  }}>
                    ⚡ Additional Charges — enter per-supplier amounts ({effectiveCompareCurrency})
                  </td>
                </tr>
              )}

              {/* Per-charge rows */}
              {additionalCharges.map(charge => (
                <tr key={charge.id} style={{ height: rowHeights['charge_' + charge.id] || ROW_DEFAULT, background: 'var(--surface)' }}>
                  <td className="charge-row-label" data-col-key="label" style={{ paddingLeft: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>• {charge.charge_name}</span>
                      <button
                        type="button"
                        onClick={() => setDeleteChargeTarget({ id: charge.id, name: charge.charge_name })}
                        style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}
                        title="Remove charge"
                      >✕</button>
                    </div>
                    <RowResizeHandle onDragStart={e => startRowDrag(e, 'charge_' + charge.id, rowHeights['charge_' + charge.id] || ROW_DEFAULT)} />
                  </td>
                  {line.quotes.map(q => {
                    const rank = rankByQuoteId[q.id];
                    const bg = rankBg(rank);
                    return (
                      <td key={q.id} data-col-key={q.id} style={{ background: bg || 'var(--surface)' }}>
                        <ChargeAmountCell
                          charge={charge}
                          supplierId={q.supplier_id}
                          lineId={line.id}
                          onSaved={invalidateLine}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Total Cost row */}
              <tr style={{ height: rowHeights.total_cost || ROW_DEFAULT }}>
                <td className="total-cost-label" data-col-key="label" style={{ paddingLeft: 10 }}>
                  Total Cost ({effectiveCompareCurrency})
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'total_cost', rowHeights.total_cost || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const normalizedPrice = convert(q.price, q.currency, effectiveCompareCurrency, rates);
                  const actualQty = Number(q.available_qty) || req;
                  let chargesSum = 0;
                  let chargesOk = true;
                  for (var i = 0; i < additionalCharges.length; i++) {
                    var charge = additionalCharges[i];
                    var saEntry = (charge.supplier_amounts || []).find(sa => sa.supplier_id === q.supplier_id);
                    var chargeAmt = saEntry ? Number(saEntry.amount) || 0 : 0;
                    var convertedCharge = convert(chargeAmt, charge.currency || effectiveCompareCurrency, effectiveCompareCurrency, rates);
                    if (convertedCharge === null) { chargesOk = false; break; }
                    chargesSum += convertedCharge;
                  }
                  const chargesPerUnit = actualQty > 0 ? chargesSum / actualQty : chargesSum;
                  const totalCostPerUnit = (normalizedPrice !== null && chargesOk) ? normalizedPrice + chargesPerUnit : null;
                  const totalCostAll = totalCostPerUnit !== null ? totalCostPerUnit * actualQty : null;
                  return (
                    <td key={q.id} data-col-key={q.id} className="mono bold" style={{
                      background: rankBg(rank) || 'var(--surface2)',
                      borderTop: '2px solid var(--border)',
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {totalCostPerUnit !== null ? (
                        <div>
                          <div style={{ fontWeight: 700 }}>{fmt(totalCostPerUnit)}<span style={{ fontSize: 9, fontWeight: 400 }}>/unit</span></div>
                          {actualQty > 1 && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Total: {fmt(totalCostAll)}</div>}
                        </div>
                      ) : <span style={{ color: 'var(--red)' }}>—</span>}
                    </td>
                  );
                })}
              </tr>

              {/* Overall Score row (100 max) */}
              <tr style={{ height: rowHeights.overall_score || ROW_DEFAULT, background: 'var(--surface2)' }}>
                <td className="total-cost-label" data-col-key="label" style={{ paddingLeft: 10, color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                  Overall Score (100 max)
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'overall_score', rowHeights.overall_score || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const scoreData = scoreByQuoteId[q.id];
                  const score = scoreData ? scoreData.score : null;
                  const bd = scoreData ? scoreData.breakdown : null;
                  return (
                    <td key={q.id} data-col-key={q.id} style={{
                      background: rankBg(rank) || 'var(--surface2)',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '6px 8px',
                      borderTop: '1px solid var(--border)',
                    }}>
                      {score !== null && score !== undefined ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <span style={{
                              fontSize: 15,
                              fontWeight: 800,
                              color: rank === 1 ? 'var(--green, #0a7a3d)' : 'var(--text)',
                            }}>
                              {score}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>/ 100</span>
                          </div>
                          {bd && (
                            <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2 }} title={`Cost: ${bd.cost}/${bd.weights.cost} · Lead: ${bd.lead}/${bd.weights.lead} · Terms: ${bd.terms}/${bd.weights.terms}`}>
                              Cost: {bd.cost} · Lead: {bd.lead} · Terms: {bd.terms}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Audit History */}
      {line.award_snapshots && line.award_snapshots.filter(s => s.kind !== 'award').length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowHistory(value => !value)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: showHistory ? 'var(--surface2)' : 'transparent',
              border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, color: 'var(--text)',
              borderBottom: showHistory ? '1px solid var(--border)' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📋</span> Audit History ({line.award_snapshots.filter(s => s.kind !== 'award').length})
            </div>
            <span style={{ transition: 'transform 0.2s', transform: showHistory ? 'rotate(180deg)' : 'none' }}>▼</span>
          </button>
          {showHistory && (
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {line.award_snapshots.filter(s => s.kind !== 'award').map(s => {
                const u = users.find(x => x.id === s.created_by || x.username === s.created_by);
                const displayName = s.user_name || (u && (u.name || u.username)) || s.created_by || '—';
                const displayRole = s.user_role || (u && u.role);
                const displayEmail = s.user_email || (u && u.email);
                return (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    background: 'var(--surface2)', borderRadius: 6, fontSize: 12
                  }}>
                    <div className="badge badge-amber">v{s.version}</div>
                    <div style={{ flex: 1 }}>Saved comparison in <strong>{s.comparison_currency}</strong></div>
                    <div style={{ color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span title={displayEmail ? displayName + ' (' + displayEmail + ')' : displayName} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>👤</span>
                        <strong style={{ color: 'var(--text)' }}>{displayName}</strong>
                        {displayRole && <span className="badge" style={{ fontSize: 10, padding: '1px 6px', textTransform: 'capitalize' }}>{displayRole}</span>}
                        {displayEmail && <span style={{ fontSize: 11, color: 'var(--text3)' }}>({displayEmail})</span>}
                      </span>
                      <span>🕒 {String(s.created_at).slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAddQuote && <AddQuoteModal line={line} suppliers={suppliers} inventoryItems={inventoryItems} initialSupplierId={intelPresetSupplier} onClose={() => { setShowAddQuote(false); setIntelPresetSupplier(null); }} />}
      {showAddCharge && <AddChargeModal line={line} compareCurrency={effectiveCompareCurrency} onClose={() => setShowAddCharge(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['rfq-line', line.id] }); }} />}
      {deleteTarget && <ConfirmDeleteModal
        label={(deleteTarget.name || 'this supplier') + "'s quote"}
        message={<>Remove <strong>{deleteTarget.name || 'this supplier'}'s quote</strong> from this line?<br /><span style={{ fontSize: 12, color: 'var(--text3)' }}>Any costs added under it will also be removed.</span></>}
        onConfirm={async () => { await deleteQuote(deleteTarget.id, deleteTarget.name); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />}
      {deleteChargeTarget && <ConfirmDeleteModal
        label={'"' + deleteChargeTarget.name + '" charge'}
        message={<>Remove the <strong>{deleteChargeTarget.name}</strong> charge from this line?<br /><span style={{ fontSize: 12, color: 'var(--text3)' }}>All per-supplier amounts for this charge will be deleted.</span></>}
        onConfirm={async () => { await deleteCharge(deleteChargeTarget.id, deleteChargeTarget.name); setDeleteChargeTarget(null); }}
        onCancel={() => setDeleteChargeTarget(null)}
      />}
      {showCifluxModal && (
        <CifluxIntelligenceModal
          line={line}
          onClose={() => setShowCifluxModal(false)}
          onAddSupplier={supplierId => {
            setIntelPresetSupplier(supplierId);
            setShowAddQuote(true);
            setShowCifluxModal(false);
          }}
        />
      )}

      {/* Floating Ciflux Intelligence Button */}
      <button
        onClick={() => setShowCifluxModal(true)}
        style={{
          position: 'fixed', bottom: 40, right: 40,
          width: 60, height: 60, borderRadius: '50%',
          background: 'linear-gradient(135deg, #10b981, #3b82f6)',
          color: 'white', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, zIndex: 1000, transition: 'transform 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        title="Ciflux Intelligence"
      >
        ✨
      </button>
    </div>
  );
}
