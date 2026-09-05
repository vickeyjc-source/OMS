// client/src/pages/AnalysisLineDetailPage.js
// Full-page supplier comparison for exactly ONE RFQ line. Currency
// Normalization & Landed Cost: every quote's original price/currency is
// preserved and shown alongside its value normalized into the chosen
// comparison currency; additional per-supplier costs (lab, freight,
// customs, etc.) can be layered in and compared as landed cost. On Award,
// the full calculation (quotes, costs, FX rates, comparison currency,
// results) is frozen into an award snapshot so later edits or FX drift
// never retroactively change an already-decided line.
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { rankLine, paymentLabel, fmt, CURRENCIES, COST_TYPES, costTypeLabel, convert, rankBg } from '../utils/rfqScoring';
import { useResizableGrid, ColResizeHandle, RowResizeHandle, resizableGridCSS, GRID_ROW_DEFAULT as ROW_DEFAULT } from '../hooks/useResizableGrid';

const COL_DEFAULT_LABEL = 170, COL_DEFAULT = 150;

function AddQuoteModal({ line, suppliers, onClose, initialSupplierId }) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState(initialSupplierId || '');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [qty, setQty] = useState(line.quantity || '');
  const [lead, setLead] = useState('');
  const usedIds = new Set((line.quotes || []).map(q => q.supplier_id));
  const available = suppliers.filter(s => !usedIds.has(s.id));

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
            <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">— Select a supplier —</option>
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

function CifluxIntelligenceModal({ line, onClose, onAddSupplier }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ciflux-history', line.component, line.manufacturer],
    queryFn: () => api.get(`/rfq/ciflux-history?component=${encodeURIComponent(line.component || '')}&manufacturer=${encodeURIComponent(line.manufacturer || '')}`).then(r => r.data),
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

export default function AnalysisLineDetailPage() {
  const { lineId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [showCifluxModal, setShowCifluxModal] = useState(false);
  const [intelPresetSupplier, setIntelPresetSupplier] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [compareCurrency, setCompareCurrency] = useState(null); 
  const [priority, setPriority] = useState(['price', 'lead', 'terms']);
  const [manualRates, setManualRates] = useState({}); 
  const tableRef = useRef(null);
  const { colWidths, rowHeights, startColDrag, startRowDrag, autoFitColumn } = useResizableGrid();

  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparisonFingerprint, setComparisonFingerprint] = useState(null);
  const [isStale, setIsStale] = useState(false);

  const { data: line, isLoading } = useQuery({ queryKey: ['rfq-line', lineId], queryFn: () => api.get(`/rfq/${lineId}`).then(r => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/customers').then(r => r.data) });
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings').then(r => r.data) });
  const suppliersById = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const effectiveCompareCurrency = CURRENCIES.includes(compareCurrency)
    ? compareCurrency
    : CURRENCIES.includes(settings.default_comparison_currency) ? settings.default_comparison_currency
      : CURRENCIES.includes(line?.target_currency) ? line.target_currency : 'INR';

  const neededCurrencies = useMemo(() => {
    if (!line) return [];
    const set = new Set();
    (line.quotes || []).forEach(q => {
      if (q.currency && q.currency !== effectiveCompareCurrency) set.add(q.currency);
    });
    return [...set];
  }, [line, effectiveCompareCurrency]);

  const { data: fetchedRates = {} } = useQuery({
    queryKey: ['fx-rates', neededCurrencies.join(','), effectiveCompareCurrency],
    queryFn: async () => {
      const results = await Promise.all(neededCurrencies.map(from =>
        api.get(`/fx-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(effectiveCompareCurrency)}`)
          .then(r => [from, { rate: r.data.rate, source: r.data.source, rate_date: r.data.rate_date, stale: r.data.stale }])
          .catch(() => [from, null])
      ));
      return Object.fromEntries(results);
    },
    enabled: neededCurrencies.length > 0,
  });

  const rates = {};
  neededCurrencies.forEach(c => {
    if (manualRates[c] != null) rates[c] = manualRates[c];
    else if (fetchedRates[c]?.rate != null) rates[c] = fetchedRates[c].rate;
  });

  const quotesFingerprint = JSON.stringify(
    (line?.quotes || []).map(q => ({
      id: q.id, price: q.price, currency: q.currency, available_qty: q.available_qty, lead_days: q.lead_days
    }))
  ) + '|' + effectiveCompareCurrency;

  useEffect(() => {
    if (comparisonFingerprint !== null && quotesFingerprint !== comparisonFingerprint) setIsStale(true);
  }, [quotesFingerprint]);

  const saveComparison = async resultToSave => {
    await api.post(`/rfq/${line.id}/save-comparison`, {
      comparison_currency: effectiveCompareCurrency,
      comparison_priority: priority,
      fx_rates_used: rates,
      quotes_snapshot: (line.quotes || []).map(q => ({ id: q.id, supplier_id: q.supplier_id, price: q.price, currency: q.currency, available_qty: q.available_qty, lead_days: q.lead_days })),
      computed_results: { ranked: resultToSave.ranked.map(r => ({ supplier_id: r.supplier_id, combined: r.combined, normalizedPrice: r.normalizedPrice, normalizedTotalCost: r.normalizedTotalCost, rank: r.rank })), bestPrice: resultToSave.bestPrice, bestPriceSupplierId: resultToSave.bestPriceSupplierId, bestTotalCost: resultToSave.bestTotalCost, bestTotalCostSupplierId: resultToSave.bestTotalCostSupplierId },
    });
  };

  const runComparison = async () => {
    if (!line) return;
    const result = rankLine(line.quotes, suppliersById, { compareCurrency: effectiveCompareCurrency, rates, priority, qty: Number(line.quantity) || 0 });
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

  if (isLoading) return <div className="loading-center">Loading…</div>;
  if (!line) return <div className="empty-state"><div className="empty-state-text">Line not found.</div></div>;

  const customerName = customers.find(c => c.id === line.customer_id)?.name || line.customer_id;
  const req = Number(line.quantity) || 0;
  const emptyResult = { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, reason: 'Not yet compared' };
  const { ranked, reason } = comparisonResult || emptyResult;
  const rankByQuoteId = Object.fromEntries(ranked.map(r => [r.id, r.rank]));
  const canRunComparison = (line.quotes || []).length >= 2;

  const deleteQuote = async (quoteId, supplierName) => {
    try {
      await api.delete(`/rfq/${line.id}/quotes/${quoteId}`);
      qc.invalidateQueries({ queryKey: ['rfq-line', line.id] });
      qc.invalidateQueries({ queryKey: ['rfq'] });
      toast.success('Supplier removed from comparison');
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to remove supplier'); }
  };

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/rfq-analysis')}>← Back to RFQ Analysis</button>

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
          {line.target_price && Number(line.target_price) > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label" style={{ color: 'var(--text3)' }}>Target Price:</span>
              <span className="mono bold" style={{ fontSize: 14 }}>{line.target_currency} {fmt(line.target_price)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card-title" style={{ marginBottom: 6 }}><span>Supplier Comparison</span></div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        {['1st', '2nd', '3rd'].map((label, idx) => (
          <div key={idx}>
            <label className="label" style={{ display: 'block', marginBottom: 3 }}>{label} Priority ({idx === 0 ? '40%' : '30%'})</label>
            <select className="input" value={priority[idx]} onChange={e => {
              const val = e.target.value;
              const newP = [...priority];
              for (let i = 0; i < 3; i++) {
                if (i !== idx && newP[i] === val && val !== '') newP[i] = '';
              }
              newP[idx] = val;
              setPriority(newP);
            }} style={{ fontWeight: 600, color: 'var(--accent)' }}>
              <option value="">--</option>
              <option value="price">Unit Price</option>
              <option value="lead">Lead Time</option>
              <option value="terms">Payment Terms</option>
            </select>
          </div>
        ))}
        <div>
          <label className="label" style={{ display: 'block', marginBottom: 3 }}>Base Currency (Default)</label>
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
      </div>

      {!canRunComparison && (
        <div className="empty-state-text" style={{ marginBottom: 10 }}>
          Add a second supplier quote before running a comparison — one supplier alone has nothing to compare against.
        </div>
      )}
      {comparisonResult && isStale && (
        <div style={{ background: 'var(--amber-lt, #fff2cf)', color: 'var(--amber, #9c6500)', border: '1px solid #f0dca0', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          ⚠ Comparison out of date — prices or costs changed since the last run. Click "Check & Save Comparison" to refresh.
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

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginLeft: 16 }}>
        <style>{`
          ${resizableGridCSS('rfq-cmp-table')}
          .rfq-cmp-table { font-size: 12.5px; }
          .rfq-cmp-table th, .rfq-cmp-table td { text-align: center !important; padding: 5px 10px !important; border: 1px solid var(--border); }
          .rfq-cmp-table th { background: var(--surface2); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; color: var(--text2); }
          .rfq-cmp-table td > div, .rfq-cmp-table td > span { margin: 0 auto; }
          .rfq-cmp-table input, .rfq-cmp-table select { text-align: center; margin: 0 auto; }
          .rfq-cmp-table .rfq-row-label { text-align: left !important; font-weight: 600; color: var(--text3); font-size: 11px; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: sticky; left: 0; background: var(--surface2); z-index: 2; }
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
                  const s = suppliersById[q.supplier_id];
                  const rank = rankByQuoteId[q.id];
                  const bg = rankBg(rank);
                  return (
                    <th key={q.id} className="bold" data-col-key={q.id} style={{ background: bg }}>
                      {(
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteTarget({ id: q.id, name: s?.name }); }}
                          title="Remove this supplier from the comparison"
                          style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, lineHeight: '14px', textAlign: 'center', padding: 0, border: '1px solid var(--border)', borderRadius: '50%', background: 'var(--surface)', color: 'var(--text3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', zIndex: 4 }}
                        >✕</button>
                      )}
                      {s?.name || q.supplier_id}{rank ? <div style={{ fontSize: 10, fontWeight: 400 }}>#{rank}</div> : null}
                      <ColResizeHandle onDragStart={e => startColDrag(e, q.id, colWidths[q.id] || COL_DEFAULT)} onAutoFit={() => autoFitColumn(tableRef, q.id)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr style={{ height: rowHeights.exchange_rate || ROW_DEFAULT, background: 'var(--surface2)' }}>
                <td className="rfq-row-label" data-col-key="label" style={{ borderBottom: '2px solid var(--border)' }}>
                  Exchange Rate (to {effectiveCompareCurrency})
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'exchange_rate', rowHeights.exchange_rate || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const c = q.currency;
                  if (c === effectiveCompareCurrency) {
                    return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank), borderBottom: '2px solid var(--border)' }} className="mono">1.0000</td>;
                  }
                  const fetched = fetchedRates[c];
                  return (
                    <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank), borderBottom: '2px solid var(--border)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>1 {c} =</span>
                          <input className="input" type="number" min="0" step="0.0001" style={{ width: 75, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                            value={manualRates[c] ?? fetched?.rate ?? ''}
                            onChange={e => { let v = e.target.value; if (v !== '' && Number(v) < 0) v = '0'; setManualRates(m => ({ ...m, [c]: v === '' ? undefined : Number(v) })); }}
                          />
                        </div>
                        {fetched && <span style={{ fontSize: 9, color: 'var(--text3)' }} title={`${fetched.source} · ${fetched.rate_date}`}>
                          {manualRates[c] != null ? 'manual' : 'auto'}
                        </span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
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
              <tr style={{ height: rowHeights.payment_terms || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Payment Terms
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'payment_terms', rowHeights.payment_terms || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const s = suppliersById[q.supplier_id];
                  const rank = rankByQuoteId[q.id];
                  return <td key={q.id} data-col-key={q.id} style={{ background: rankBg(rank) }}>{paymentLabel(s)}</td>;
                })}
              </tr>
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
              <tr style={{ height: rowHeights.total_amount || ROW_DEFAULT }}>
                <td className="rfq-row-label" data-col-key="label">
                  Total Amount ({effectiveCompareCurrency})
                  <RowResizeHandle onDragStart={e => startRowDrag(e, 'total_amount', rowHeights.total_amount || ROW_DEFAULT)} />
                </td>
                {line.quotes.map(q => {
                  const rank = rankByQuoteId[q.id];
                  const normalizedPrice = convert(q.price, q.currency, effectiveCompareCurrency, rates);
                  const actualQty = Number(q.available_qty) || req;
                  const totalAmount = (normalizedPrice !== null && actualQty > 0) ? normalizedPrice * actualQty : null;
                  return <td key={q.id} data-col-key={q.id} className="mono bold" style={{ background: rankBg(rank) }}>{totalAmount !== null ? fmt(totalAmount) : <span style={{ color: 'var(--red)' }}>—</span>}</td>;
                })}
              </tr>

            </tbody>
          </table>
        )}
      </div>

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
              {line.award_snapshots.filter(s => s.kind !== 'award').map(s => (
                <div key={s.id} style={{ 
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', 
                  background: 'var(--surface2)', borderRadius: 6, fontSize: 12 
                }}>
                  <div className="badge badge-amber">v{s.version}</div>
                  <div style={{ flex: 1 }}>
                    Saved comparison in <strong>{s.comparison_currency}</strong>
                  </div>
                  <div style={{ color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>👤 {s.created_by}</span>
                    <span>🕒 {String(s.created_at).slice(0, 16).replace('T', ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddQuote && <AddQuoteModal line={line} suppliers={suppliers} initialSupplierId={intelPresetSupplier} onClose={() => { setShowAddQuote(false); setIntelPresetSupplier(null); }} />}
      {deleteTarget && <ConfirmDeleteModal
        label={`${deleteTarget.name || 'this supplier'}'s quote`}
        message={<>Remove <strong>{deleteTarget.name || 'this supplier'}'s quote</strong> from this line?<br /><span style={{ fontSize: 12, color: 'var(--text3)' }}>Any costs added under it will also be removed.</span></>}
        onConfirm={async () => { await deleteQuote(deleteTarget.id, deleteTarget.name); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
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
