// client/src/pages/TaxSettingsPage.js
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';

const REGIONS = ['Africa','Asia','Atlantic','Caribbean','Central America','Europe','Middle East','North America','Oceania','South America'];

// ── Modal: Add or Edit a tax rate entry ──────────────────────────────────────
function TaxModal({ entry, onClose, existingCurrencies }) {
  const qc = useQueryClient();
  const isNew = !entry?.currency;

  const [form, setForm] = useState(() => {
    if (entry) return { ...entry, ratesStr: (entry.rates||[]).join(', ') };
    return { currency: '', country: '', region: 'Asia', vat_label: 'VAT', ratesStr: '0' };
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      setSaveError('');
      const rates = form.ratesStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      const payload = { currency: form.currency.toUpperCase(), country: form.country, region: form.region, vat_label: form.vat_label, rates };
      return isNew
        ? api.post('/tax-rates', payload)
        : api.put('/tax-rates/' + form.currency, payload);
    },
    onSuccess: () => { qc.invalidateQueries(['tax-rates']); toast.success(isNew ? 'Tax rate added' : 'Updated'); onClose(); },
    onError: (e) => {
      const msg = e?.response?.data?.error || 'Save failed';
      setSaveError(msg);
      toast.error(msg);
    },
  });

  const del = useMutation({
    mutationFn: () => api.delete('/tax-rates/' + form.currency),
    onSuccess: () => { qc.invalidateQueries(['tax-rates']); toast.success('Deleted'); onClose(); },
  });

  return (
    <>
    <div className="overlay">
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{isNew ? 'Add Tax Rate' : 'Edit Tax Rate'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {saveError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13, fontWeight: 500 }}>
              {saveError}
            </div>
          )}
          <div className="form-group">
            <label className="label">Currency Code <span className="req">*</span></label>
            <input className="input" value={form.currency}
              onChange={e => { setSaveError(''); set('currency', e.target.value.toUpperCase()); }}
              placeholder="e.g. INR" maxLength={6} disabled={!isNew} style={!isNew?{background:'var(--surface2)'}:{}} />
            {isNew && existingCurrencies.includes(form.currency) && (
              <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block', fontWeight: 600 }}>
                Currency code "{form.currency}" already exists — click the card to edit it
              </span>
            )}
          </div>
          <div className="form-group">
            <label className="label">Country / Zone <span className="req">*</span></label>
            <input className="input" value={form.country} onChange={e => set('country', e.target.value)} placeholder="e.g. India" />
          </div>
          <div className="form-group">
            <label className="label">Region <span className="req">*</span></label>
            <select className="input" value={form.region} onChange={e => set('region', e.target.value)}>
              {REGIONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Tax Label</label>
            <input className="input" value={form.vat_label} onChange={e => set('vat_label', e.target.value)} placeholder="VAT / GST / IVA …" />
          </div>
          <div className="form-group">
            <label className="label">Tax Rates (%) <span className="req">*</span></label>
            <input className="input" value={form.ratesStr} onChange={e => set('ratesStr', e.target.value)}
              placeholder="0, 5, 12, 18, 28" />
            <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'block' }}>
              Comma-separated — always include 0 for tax-exempt
            </span>
          </div>
          {/* Preview */}
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.ratesStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)).map(r => (
              <span key={r} style={{ padding: '3px 9px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: 'var(--teal)', border: '1px solid rgba(16,185,129,0.3)' }}>{r}%</span>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          {!isNew && <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending || !form.currency || !form.country || (isNew && existingCurrencies.includes(form.currency))} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
    {confirmDelete && (
      <ConfirmDeleteModal
        label={form.currency + ' — ' + form.country}
        onConfirm={() => { setConfirmDelete(false); del.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
        loading={del.isPending}
      />
    )}
    </>
  );
}

// ── Tax Rate Card ─────────────────────────────────────────────────────────────
function TaxRateCard({ item, onEdit }) {
  return (
    <div
      onClick={() => onEdit(item)}
      style={{
        border: '1px solid var(--border)', borderRadius: 8, padding: 14,
        backgroundColor: 'var(--surface1)', cursor: 'pointer',
        transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace', lineHeight: 1.05 }}>{item.currency}</div>
          <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 2 }}>{item.country}</div>
        </div>
        <div style={{ fontSize: 10, padding: '3px 8px', backgroundColor: 'var(--surface2)', color: 'var(--text1)', border: '1px solid var(--border)', borderRadius: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {item.region}
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tax Rates</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(item.rates || []).map((rate, i) => (
            <span key={i} style={{ padding: '4px 9px', background: 'rgba(16,185,129,0.1)', color: 'var(--teal)', borderRadius: 4, fontSize: 12, fontWeight: 600, border: '1px solid rgba(16,185,129,0.3)' }}>
              {rate}%
            </span>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)', fontStyle: 'italic' }}>
        ✓ {item.vat_label || 'VAT'} applicable
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TaxSettingsPage() {
  const qc = useQueryClient();
  const [regionFilter, setRegionFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | {} (new) | entry (edit)

  const { data: allRates = [], isLoading } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => api.get('/tax-rates').then(r => r.data),
  });

  const filtered = useMemo(() => {
    let d = allRates;
    if (regionFilter !== 'All') d = d.filter(r => r.region === regionFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      d = d.filter(r => r.currency.toLowerCase().includes(t) || r.country.toLowerCase().includes(t));
    }
    return d;
  }, [allRates, regionFilter, search]);

  const regionCounts = useMemo(() => {
    const m = {};
    allRates.forEach(r => { m[r.region] = (m[r.region] || 0) + 1; });
    return m;
  }, [allRates]);

  return (
    <div style={{ padding: '20px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text1)', margin: 0 }}>
          🌍 Global GST/VAT Tax Rates
        </h1>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ Add Tax Rate</button>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search currency or country…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '9px 14px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 6, minWidth: 240, flex: 1, color: 'var(--text1)', backgroundColor: 'var(--surface1)' }}
        />
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {['All', ...REGIONS].map(r => {
            const count = r === 'All' ? allRates.length : (regionCounts[r] || 0);
            if (r !== 'All' && count === 0) return null;
            return (
              <button
                key={r}
                onClick={() => setRegionFilter(r)}
                style={{
                  padding: '7px 13px', fontSize: 12, fontWeight: regionFilter === r ? 600 : 500,
                  border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                  backgroundColor: regionFilter === r ? 'var(--accent)' : 'var(--surface1)',
                  color: regionFilter === r ? '#fff' : 'var(--text1)',
                }}
              >{r} {count > 0 && <span style={{ opacity: 0.75 }}>({count})</span>}</button>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18, padding: '10px 14px', backgroundColor: 'var(--surface2)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
        Showing <strong>{filtered.length}</strong> of <strong>{allRates.length}</strong> currencies
        <span style={{ marginLeft: 12, color: 'var(--text3)', fontSize: 11 }}>Click any card to edit · Use + Add to create new</span>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text2)' }}>Loading tax rates…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text2)', fontSize: 16 }}>
          No currencies found{search ? ' matching your search' : ''}.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map(item => (
            <TaxRateCard key={item.currency} item={item} onEdit={entry => setModal(entry)} />
          ))}
        </div>
      )}

      {modal !== null && (
        <TaxModal
          entry={Object.keys(modal).length ? modal : null}
          onClose={() => setModal(null)}
          existingCurrencies={allRates.map(r => r.currency)}
        />
      )}
    </div>
  );
}
