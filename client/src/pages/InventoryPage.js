// client/src/pages/InventoryPage.js  v2
import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmtDateTime } from '../utils/helpers';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { ALL_CURRENCIES } from '../utils/currencies';
import { ManufacturerField, AddLinecardModal } from './NewEnquiryPage';
import { CustomerModal } from './CustomersPage';
import { SupplierModal } from './SuppliersPage';

const fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────
function BulkUploadModal({ onClose, onImport }) {
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState('');

  const downloadSample = () => {
    const header = 'component,ipn,manufacturer,date_code,quantity_available,target_currency,target_price,holder_type,holder_name,notes';
    const sample = [
      'LM358,IPN-001,Texas Instruments,ANY,200,INR,12.00,customer,Acme Corp,Customer returned stock',
      'BC547,IPN-002,Fairchild,2022+,500,INR,3.50,supplier,XYZ Electronics,Supplier excess stock',
      'PIC16F877A,IPN-003,Microchip,2024,150,USD,2.15,customer,Globex Systems,Reserved customer stock',
    ].join('\n');
    const blob = new Blob([header + '\n' + sample], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventory_bulk_upload_sample.csv';
    a.click();
  };

  // Proper RFC-4180 CSV line parser — handles quoted fields with embedded commas/newlines
  const parseCSVLine = (line) => {
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }  // escaped quote
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { vals.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
    }
    vals.push(cur.trim());
    return vals;
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // Normalise line endings (Windows \r\n, old Mac \r, Unix \n)
        const text = ev.target.result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) { setError('File must have a header row and at least one data row'); return; }
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
        if (!headers.includes('component')) { setError('Missing required column: component'); return; }
        if (!headers.includes('quantity_available')) { setError('Missing required column: quantity_available'); return; }
        const parsed = lines.slice(1).map(line => {
          const vals = parseCSVLine(line);
          const row = {};
          headers.forEach((h, i) => row[h] = (vals[i] || '').trim());
          return row;
        }).filter(r => r.component && r.component !== '');
        if (!parsed.length) { setError('No valid rows found — make sure component column is filled'); return; }
        // Validate each row has quantity_available
        const invalid = parsed.filter(r => !r.quantity_available || isNaN(Number(r.quantity_available)));
        if (invalid.length) {
          setError(invalid.length + ' row(s) missing valid quantity_available (e.g. row: ' + invalid[0].component + ')');
          return;
        }
        setError('');
        setRows(parsed);
      } catch (e) { setError('Failed to parse file: ' + e.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2>📋 Bulk Upload Inventory</h2>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Upload a CSV with multiple stock items</div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--accent-lt)', borderRadius: 'var(--r-sm)', border: '1px solid rgba(27,79,158,.12)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Step 1 — Download sample CSV template</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.6 }}>
              <strong>Required columns:</strong> <code>component</code>, <code>quantity_available</code><br />
              <strong>Optional columns:</strong> ipn, manufacturer, date_code, target_currency, target_price,<br />
              &nbsp;&nbsp;&nbsp;<code>holder_type</code> → <strong>customer</strong> / <strong>supplier</strong><br />
              &nbsp;&nbsp;&nbsp;<code>holder_name</code> → name of the holder (customer/supplier name), notes
            </div>
            <button className="btn btn-sm" onClick={downloadSample}>⬇ Download Sample CSV</button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Step 2 — Upload your filled CSV</div>
            <input type="file" accept=".csv,.txt"
              style={{ display: 'block', padding: 8, border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', width: '100%', cursor: 'pointer' }}
              onChange={handleFile} />
            {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6, fontWeight: 600 }}>❌ {error}</div>}
          </div>
          {rows.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--green)' }}>
                ✅ {rows.length} item{rows.length !== 1 ? 's' : ''} ready to import
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                <table className="li-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Component</th>
                      <th>IPN</th>
                      <th>Manufacturer</th>
                      <th>Date Code</th>
                      <th style={{ color: '#15803d' }}>Qty Available</th>
                      <th>Sell Price</th>
                      <th>Held By</th>
                      <th>Holder Name</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const holderType = (r.holder_type || 'customer').toLowerCase();
                      const holderIcon = holderType === 'supplier' ? '🏢' : '👤';
                      return (
                        <tr key={i}>
                          <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                          <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{r.component}</td>
                          <td style={{ color: 'var(--text3)', fontFamily: 'monospace' }}>{r.ipn || '—'}</td>
                          <td>{r.manufacturer || '—'}</td>
                          <td>
                            {r.date_code
                              ? <span style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, color: '#6b7280', fontWeight: 600 }}>{r.date_code}</span>
                              : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{r.quantity_available || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{r.target_price ? (r.target_currency || 'INR') + ' ' + r.target_price : '—'}</td>
                          <td>{holderIcon} {holderType}</td>
                          <td style={{ fontWeight: 600 }}>{r.holder_name || '—'}</td>
                          <td style={{ color: 'var(--text2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!rows.length}
            onClick={() => { onImport(rows); onClose(); }}>
            📋 Import {rows.length} Item{rows.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
function ItemModal({ item, customers, suppliers, linecards, onClose, onSaved, onAddCustomer, onAddSupplier }) {
  const isEdit = !!item?.id;
  const [addLcModal, setAddLcModal] = useState({ open: false, prefill: '' });
  const [form, setForm] = useState(() => ({
    component:          item?.component          || '',
    ipn:                item?.ipn                || '',
    manufacturer:       item?.manufacturer       || '',
    date_code:          item?.date_code          || '',
    quantity_available: item?.quantity_available  ?? '',
    target_currency:    item?.target_currency    || 'INR',
    target_price:       item?.target_price        ?? '',
    holder_type:        item?.holder_type        || '',
    holder_id:          item?.holder_id          || '',
    holder_name:        item?.holder_name        || '',
    reference_order_id: item?.reference_order_id || '',
    notes:              item?.notes              || '',
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: d => isEdit ? api.put('/inventory/' + item.id, d) : api.post('/inventory', d),
    onSuccess: () => {
      qc.invalidateQueries(['inventory']);
      toast.success(isEdit ? 'Stock item updated' : 'Stock item added');
      onSaved && onSaved();
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.component.trim()) { toast.error('Component name required'); return; }
    if (form.quantity_available === '' || form.quantity_available === null) {
      toast.error('Available quantity required'); return;
    }
    const qty = parseInt(form.quantity_available) || 0;
    const d = {
      ...form,
      quantity_total:     qty,
      quantity_available: qty,
      target_price: form.target_price !== '' ? parseFloat(form.target_price) : null,
    };
    if (!d.holder_type) {
      toast.error('Choose who holds this stock');
      return;
    }
    if (!d.holder_id) {
      toast.error((d.holder_type === 'supplier' ? 'Supplier' : 'Customer') + ' selection required');
      return;
    }
    if (d.holder_type === 'customer' && d.holder_id) {
      const cust = customers.find(c => c.id === d.holder_id);
      d.holder_name = cust?.name || d.holder_name;
    } else if (d.holder_type === 'supplier' && d.holder_id) {
      const sup = suppliers.find(s => s.id === d.holder_id);
      d.holder_name = sup?.name || d.holder_name;
    }
    mutation.mutate(d);
  };

  const holderColors = {
    customer:  { bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
    supplier:  { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
  };
  const hc = holderColors[form.holder_type] || { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' };

  useEffect(() => {
    const handleHolderCreated = (event) => {
      const { type, id } = event.detail || {};
      if (!type || !id) return;
      if (type === 'customer') {
        const cust = customers.find(c => c.id === id);
        set('holder_type', 'customer');
        set('holder_id', id);
        set('holder_name', cust?.name || '');
      }
      if (type === 'supplier') {
        const sup = suppliers.find(s => s.id === id);
        set('holder_type', 'supplier');
        set('holder_id', id);
        set('holder_name', sup?.name || '');
      }
    };

    window.addEventListener('inventory-holder-created', handleHolderCreated);
    return () => window.removeEventListener('inventory-holder-created', handleHolderCreated);
  }, [customers, suppliers]);

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <h2>{isEdit ? '✏️ Edit Stock Item' : '+ Add Stock Item'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">

          {/* Row 1: Component + IPN + Manufacturer combo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Component / Part No. <span className="req">*</span></label>
              <input className="input" value={form.component} onChange={e => set('component', e.target.value)}
                placeholder="e.g. STM32F103C8T6" autoFocus />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">IPN (Internal Part No.)</label>
              <input className="input" value={form.ipn} onChange={e => set('ipn', e.target.value)}
                placeholder="e.g. IPN-001" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Manufacturer</label>
              <ManufacturerField
                value={form.manufacturer}
                onChange={v => set('manufacturer', v)}
                linecards={linecards}
                onAddNew={name => setAddLcModal({ open: true, prefill: name })}
              />
            </div>
          </div>

          {/* Row 2: Date Code + Available Qty + Currency + Sell Price */}
          <div style={{ display: 'grid', gridTemplateColumns: '130px 170px 110px 1fr', gap: 10, marginBottom: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Date Code</label>
              <input className="input" value={form.date_code} onChange={e => set('date_code', e.target.value)}
                placeholder="e.g. 2023+" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Qty Available / To Sell <span className="req">*</span></label>
              <input className="input" type="number" min="0" value={form.quantity_available}
                onChange={e => set('quantity_available', e.target.value)}
                placeholder="0" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Currency</label>
              <select className="input" value={form.target_currency} onChange={e => set('target_currency', e.target.value)}>
                {ALL_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Sell Price / Unit</label>
              <input className="input" type="number" step="0.0001" min="0" value={form.target_price}
                onChange={e => set('target_price', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Row 3: Holder section */}
          <div style={{
            padding: '12px 14px', borderRadius: 'var(--r-sm)', marginBottom: 10,
            background: hc.bg, border: '1.5px solid ' + hc.border,
          }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: hc.text }}>
              📦 Stock Holder — Who has this stock?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="label">Held By</label>
                <select className="input" value={form.holder_type} onChange={e => {
                  set('holder_type', e.target.value);
                  set('holder_id', '');
                  set('holder_name', '');
                }}>
                  <option value="">-- Choose Holder --</option>
                  <option value="customer">👤 Customer</option>
                  <option value="supplier">🏢 Supplier</option>
                </select>
              </div>

              {form.holder_type === 'customer' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="label">Customer <span className="req">*</span></label>
                  <select className="input" value={form.holder_id}
                      onChange={e => {
                        const cust = customers.find(c => c.id === e.target.value);
                        set('holder_id', e.target.value);
                        set('holder_name', cust?.name || '');
                      }}>
                    <option value="">-- Select Customer --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ' (' + c.city + ')' : ''}</option>)}
                  </select>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-xs" onClick={onAddCustomer}>+ New Customer</button>
                  </div>
                </div>
              )}

              {form.holder_type === 'supplier' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="label">Supplier <span className="req">*</span></label>
                  <select className="input" value={form.holder_id}
                      onChange={e => {
                        const sup = suppliers.find(s => s.id === e.target.value);
                        set('holder_id', e.target.value);
                        set('holder_name', sup?.name || '');
                      }}>
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.city ? ' (' + s.city + ')' : ''}</option>)}
                  </select>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-xs" onClick={onAddSupplier}>+ New Supplier</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Reference + Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Reference Order (optional)</label>
              <input className="input" value={form.reference_order_id}
                onChange={e => set('reference_order_id', e.target.value)}
                placeholder="e.g. ORD-001, ENQ-0012…" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Notes</label>
              <input className="input" value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any additional notes…" />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={handleSubmit}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update Item' : 'Add to Inventory'}
          </button>
        </div>
      </div>
      {addLcModal.open && (
        <AddLinecardModal
          prefillName={addLcModal.prefill}
          onClose={() => setAddLcModal({ open: false, prefill: '' })}
          onSaved={(_id, name) => { set('manufacturer', name); setAddLcModal({ open: false, prefill: '' }); }}
        />
      )}
    </div>
  );
}

// ── Holder type badge ─────────────────────────────────────────────────────────
function HolderBadge({ type }) {
  const cfg = {
    customer: { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: '👤 Customer' },
    supplier: { bg: '#f0fdf4', color: '#15803d', border: '#86efac', label: '🏢 Supplier' },
  }[type] || { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: '👤 Customer' };
  return (
    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, fontWeight: 600,
      background: cfg.bg, color: cfg.color, border: '1px solid ' + cfg.border }}>
      {cfg.label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const qc = useQueryClient();
  const [search, setSearch]         = useState('');
  const [holderFilter, setHolderFilter] = useState('');
  const [editItem, setEditItem]     = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [showBulk, setShowBulk]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api.get('/inventory').then(r => Array.isArray(r.data) ? r.data : []),
    refetchInterval: 30000,
  });

  const { data: holdsMap = {} } = useQuery({
    queryKey: ['inventory-holds'],
    queryFn: () => api.get('/inventory/holds').then(r => r.data || {}),
    refetchInterval: 30000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then(r => Array.isArray(r.data) ? r.data : []),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then(r => Array.isArray(r.data) ? r.data : []),
  });

  const { data: linecards = [] } = useQuery({
    queryKey: ['linecards'],
    queryFn: () => api.get('/linecards').then(r => Array.isArray(r.data) ? r.data : []),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete('/inventory/' + id),
    onSuccess: () => { qc.invalidateQueries(['inventory']); toast.success('Item removed'); setDeleteTarget(null); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const bulkMutation = useMutation({
    mutationFn: rows => api.post('/inventory/bulk', { rows }),
    onSuccess: r => {
      qc.invalidateQueries(['inventory']);
      toast.success('Imported ' + r.data.created + ' item(s)' + (r.data.errors?.length ? ' (' + r.data.errors.length + ' errors)' : ''));
    },
    onError: e => toast.error(e.response?.data?.error || 'Bulk import failed'),
  });

  const filtered = useMemo(() => {
    let rows = inventory;
    if (holderFilter) rows = rows.filter(r => r.holder_type === holderFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.component.toLowerCase().includes(q) ||
        (r.ipn || '').toLowerCase().includes(q) ||
        (r.manufacturer || '').toLowerCase().includes(q) ||
        (r.holder_display || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [inventory, search, holderFilter]);

  const totalItems     = inventory.length;
  const totalAvailable = inventory.reduce((s, r) => s + (r.quantity_available || 0), 0);
  const totalOnHold    = inventory.reduce((s, r) => s + (holdsMap[r.id] || 0), 0);
  const totalFree      = Math.max(0, totalAvailable - totalOnHold);
  const customerCount  = inventory.filter(r => r.holder_type === 'customer').length;
  const supplierCount  = inventory.filter(r => r.holder_type === 'supplier').length;

  const CARDS = [
    { label: 'Total Items',         value: totalItems,           color: 'var(--accent)', bg: 'var(--accent-lt)' },
    { label: 'Total Available Qty', value: fmt(totalAvailable),  color: '#15803d',       bg: '#f0fdf4' },
    { label: 'On Hold (Active Orders)', value: fmt(totalOnHold), color: '#d97706',       bg: '#fffbeb' },
    { label: 'Free (Ready to Source)', value: fmt(totalFree),    color: '#2563eb',       bg: '#eff6ff' },
  ];

  const modalProps = {
    customers,
    suppliers,
    linecards,
    onAddCustomer: () => setShowAddCustomer(true),
    onAddSupplier: () => setShowAddSupplier(true),
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">📦 Stock Inventory</h1>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Track available stock held by customers or suppliers — auto-checked during sourcing
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-sm" onClick={() => setShowBulk(true)}>📋 Bulk Upload</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Stock</button>
        </div>
      </div>

      {/* Summary cards — big */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        {CARDS.map(c => (
          <div key={c.label} style={{
            background: c.bg, borderRadius: 'var(--r)', padding: '18px 22px',
            border: '1.5px solid ' + c.color + '28', minWidth: 0,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search component, IPN, manufacturer, holder…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: 175 }} value={holderFilter} onChange={e => setHolderFilter(e.target.value)}>
          <option value="">All Holders</option>
          <option value="customer">👤 Customer</option>
          <option value="supplier">🏢 Supplier</option>
        </select>
        {(search || holderFilter) && (
          <button className="btn btn-sm" onClick={() => { setSearch(''); setHolderFilter(''); }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
          {filtered.length} of {totalItems} items
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No stock items found</div>
          <div style={{ fontSize: 13 }}>Add your first stock item using the button above.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="li-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Component</th>
                <th>IPN</th>
                <th>Manufacturer</th>
                <th>Date Code</th>
                <th style={{ color: '#15803d' }}>Available Qty</th>
                <th style={{ color: '#d97706' }}>On Hold</th>
                <th style={{ color: '#2563eb' }}>Free Qty</th>
                <th>Sell Price</th>
                <th>Type</th>
                <th>Holder</th>
                <th>Ref Order</th>
                <th>Notes</th>
                <th>Added At</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const onHold = holdsMap[row.id] || 0;
                const freeQty = Math.max(0, (row.quantity_available || 0) - onHold);
                return (
                  <tr key={row.id}>
                    <td style={{ color: 'var(--text3)', fontSize: 11 }}>{idx + 1}</td>
                    <td><span style={{ fontWeight: 700, color: 'var(--accent)' }}>{row.component}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{row.ipn || '—'}</td>
                    <td style={{ fontSize: 12 }}>{row.manufacturer || '—'}</td>
                    <td style={{ fontSize: 11 }}>
                      {row.date_code
                        ? <span style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 3, color: '#6b7280', fontWeight: 600, fontSize: 11 }}>{row.date_code}</span>
                        : '—'}
                    </td>
                    {/* Available Qty */}
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        fontWeight: 800, fontSize: 13,
                        color: row.quantity_available > 0 ? '#15803d' : '#dc2626',
                        background: row.quantity_available > 0 ? '#dcfce7' : '#fee2e2',
                        padding: '2px 8px', borderRadius: 999,
                        border: '1px solid ' + (row.quantity_available > 0 ? '#86efac' : '#fca5a5'),
                      }}>
                        {fmt(row.quantity_available)}
                      </span>
                    </td>
                    {/* On Hold */}
                    <td style={{ textAlign: 'right' }}>
                      {onHold > 0 ? (
                        <span style={{
                          fontWeight: 700, fontSize: 12,
                          color: '#d97706', background: '#fffbeb',
                          padding: '2px 8px', borderRadius: 999,
                          border: '1px solid #fde68a',
                        }}>
                          🔒 {fmt(onHold)}
                        </span>
                      ) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                    {/* Free Qty */}
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        fontWeight: 700, fontSize: 12,
                        color: freeQty > 0 ? '#2563eb' : '#dc2626',
                        background: freeQty > 0 ? '#eff6ff' : '#fee2e2',
                        padding: '2px 8px', borderRadius: 999,
                        border: '1px solid ' + (freeQty > 0 ? '#bfdbfe' : '#fca5a5'),
                      }}>
                        {fmt(freeQty)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600 }}>
                      {row.target_price ? row.target_currency + ' ' + fmt(row.target_price) : '—'}
                    </td>
                    <td><HolderBadge type={row.holder_type} /></td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{row.holder_display || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{row.reference_order_id || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDateTime(row.added_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-xs" title="Edit" onClick={() => setEditItem(row)}>✏️</button>
                        <button className="btn btn-xs btn-danger" title="Delete" onClick={() => setDeleteTarget(row)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <ItemModal {...modalProps} onClose={() => setShowAdd(false)} onSaved={() => {}} />
      )}
      {editItem && (
        <ItemModal item={editItem} {...modalProps} onClose={() => setEditItem(null)} onSaved={() => {}} />
      )}
      {showBulk && (
        <BulkUploadModal
          onClose={() => setShowBulk(false)}
          onImport={rows => bulkMutation.mutate(rows)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteModal
          title="Remove Stock Item"
          message={'Remove "' + deleteTarget.component + '" (' + deleteTarget.quantity_available + ' available) from inventory?'}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteMutation.isPending}
        />
      )}
      {showAddCustomer && (
        <CustomerModal
          onClose={() => { setShowAddCustomer(false); qc.invalidateQueries(['customers']); }}
          onSaved={data => {
            if (data?.id && (showAdd || editItem)) {
              window.dispatchEvent(new CustomEvent('inventory-holder-created', {
                detail: { type: 'customer', id: data.id }
              }));
            }
          }}
        />
      )}
      {showAddSupplier && (
        <SupplierModal
          linecards={linecards}
          onClose={() => { setShowAddSupplier(false); qc.invalidateQueries(['suppliers']); }}
          onSaved={data => {
            if (data?.id && (showAdd || editItem)) {
              window.dispatchEvent(new CustomEvent('inventory-holder-created', {
                detail: { type: 'supplier', id: data.id }
              }));
            }
          }}
        />
      )}
    </div>
  );
}
