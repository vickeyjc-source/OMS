// client/src/pages/ReportsPage.js  v3 — Role-based + Export
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { fmt, orderTotal, isDelayed, StatusBadge, DaysBadge } from '../utils/helpers';
import { printDoc, generateReportPDF, generateOrderPDF, generateEnquiryPDF, generateQuotePDF } from '../utils/pdfUtils';
import { useAuth } from '../context/AuthContext';

function inr(n) { return '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_PRIORITY = ['active', 'returned_to_sourcing', 'order_created', 'superseded'];

// Role → which top-level sections they can see
const ROLE_SECTIONS = {
  admin:       ['overview','orders','enquiries','quotes','sourcing','procurement','finance'],
  manager:     ['overview','orders','enquiries','quotes','sourcing','procurement','finance'],
  sales:       ['overview','enquiries','quotes','orders'],
  sourcing:    ['enquiries','sourcing'],
  procurement: ['orders','procurement'],
  finance:     ['finance','orders'],
};

const SECTION_LABELS = {
  overview:    '📊 Overview',
  orders:      '📋 Orders',
  enquiries:   '📩 Enquiries',
  quotes:      '📄 Quotes',
  sourcing:    '🔍 Sourcing',
  procurement: '🛒 Procurement',
  finance:     '💰 Finance',
};

const SECTION_ROUTE = {
  orders:      '/orders',
  enquiries:   '/enquiries',
  quotes:      '/quotes',
  sourcing:    '/sourcing-bin',
  procurement: '/procurement-bin',
  finance:     '/finance',
};

// ── Export-to-CSV helper ──────────────────────────────────────────────────────
function exportCSV(rows, columns, filename) {
  const header = columns.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => columns.map(c => {
    const v = c.render ? c.render(r) : (r[c.key] || '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color }) {
  return (
    <div className="stat-card" style={{ borderLeft: `3px solid ${color || 'var(--accent)'}` }}>
      <div className="stat-label">{label}</div>
      <div className="stat-val" style={{ color: color || 'var(--accent)' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Section: Overview ─────────────────────────────────────────────────────────
function OverviewSection({ summary, orders, enquiries, quotes }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Stat label="Total Orders"    value={summary.total || 0}     color="var(--accent)" sub={`${summary.closed || 0} closed`} />
        <Stat label="Open Orders"     value={summary.open || 0}      color="var(--amber,#d97706)" sub={`${summary.delayed || 0} past due`} />
        <Stat label="Delayed"         value={summary.delayed || 0}   color="var(--red)" sub="Past tentative date" />
        <Stat label="Delivered"       value={summary.delivered || 0} color="var(--green)" sub={`${summary.total ? Math.round(summary.delivered / summary.total * 100) : 0}% rate`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Stat label="Total Enquiries"  value={summary.enquiries || 0}     color="var(--purple,#7c3aed)" sub={`${summary.enq_new || 0} new`} />
        <Stat label="Sourcing"        value={summary.enq_sourcing || 0}  color="var(--accent)" />
        <Stat label="Quoted"          value={summary.enq_quoted || 0}    color="var(--amber,#d97706)" />
        <Stat label="Finance Pending" value={summary.finance_pending || 0} color="var(--red)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Orders by status */}
        <div className="card card-sm">
          <div className="card-title">📋 Orders by Stage</div>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Status</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
            <tbody>
              {[
                { s: 'open', label: 'Open' }, { s: 'procurement', label: 'Procurement' },
                { s: 'delivery_hub', label: 'Delivery Hub' }, { s: 'transit_customer', label: 'In Transit' },
                { s: 'delivered', label: 'Delivered' }, { s: 'closed', label: 'Closed' },
                { s: 'hold', label: 'On Hold' }, { s: 'failed', label: 'Failed/Cancelled' },
              ].map(r => {
                const c = orders.filter(o => o.status === r.s).length;
                return c > 0 ? (
                  <tr key={r.s}>
                    <td><StatusBadge s={r.s} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{c}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
        {/* Enquiry pipeline */}
        <div className="card card-sm">
          <div className="card-title">📩 Enquiry Pipeline</div>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Stage</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
            <tbody>
              {[
                { s: 'new', label: 'New' }, { s: 'sourcing', label: 'Sourcing' },
                { s: 'quoted', label: 'Quoted' }, { s: 'converted', label: 'Converted' },
                { s: 'closed', label: 'Closed' }, { s: 'lost', label: 'Lost' },
              ].map(r => {
                const c = enquiries.filter(e => e.status === r.s).length;
                return c > 0 ? (
                  <tr key={r.s}>
                    <td><StatusBadge s={r.s} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{c}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Detail View Modal (read-only) ─────────────────────────────────────────────
function ReportDetailModal({ record, type, onClose, customers, orders }) {
  const navigate  = useNavigate();
  const custName  = id => customers.find(c => c.id === id)?.name || id;
  const inrFmt    = n => '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleDownload = () => {
    const cust = customers.find(c => c.id === record.customer_id);
    if (type === 'order' || type === 'procurement') {
      printDoc(generateOrderPDF(record, cust));
    } else if (type === 'enquiry' || type === 'sourcing') {
      printDoc(generateEnquiryPDF(record, cust));
    } else if (type === 'quote') {
      printDoc(generateQuotePDF(record, cust));
    } else {
      const cols = [
        { key: 'order_id', label: 'Order ID',  render: r => r.order_id },
        { key: 'type',     label: 'Type',       render: r => r.type || '—' },
        { key: 'amount',   label: 'Amount',     render: r => r.amount ? inrFmt(r.amount) : '—' },
        { key: 'status',   label: 'Status',     render: r => r.status },
      ];
      printDoc(generateReportPDF('Finance Queue Item', [record], cols));
    }
  };

  const title = record.id || record.order_id || record.quote_no || 'Detail';

  // ── Order / Procurement detail ──────────────────────────────────────────
  let content = null;
  if (type === 'order' || type === 'procurement') {
    const items = record.lineItems || [];
    const total = items.reduce((s, li) => s + (li.qty || 0) * (li.unit_price || 0), 0);
    const cust  = customers.find(c => c.id === record.customer_id) || {};
    const pos   = record.supplierOrders || [];
    content = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="card card-sm">
            <div className="card-title">📋 Order Details</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Order ID</td><td><span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{record.id}</span></td></tr>
                <tr><td className="label">Status</td><td><StatusBadge s={record.status} /></td></tr>
                <tr><td className="label">PO Number</td><td>{record.po_number || '—'}</td></tr>
                <tr><td className="label">Enquiry No.</td><td>{record.enquiry_no || '—'}</td></tr>
                <tr><td className="label">Quote No.</td><td>{record.quote_no || '—'}</td></tr>
                <tr><td className="label">Due Date</td><td style={{ color: isDelayed(record) ? 'var(--red)' : 'inherit', fontWeight: isDelayed(record) ? 700 : 400 }}>{record.tentative_date || '—'}{isDelayed(record) ? ' ⚠' : ''}</td></tr>
                <tr><td className="label">Created</td><td>{(record.created_at || '').slice(0, 10)}</td></tr>
                <tr><td className="label">Last Updated</td><td>{(record.updated_at || '').slice(0, 10)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card card-sm">
            <div className="card-title">👤 Customer</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Name</td><td><strong>{custName(record.customer_id)}</strong></td></tr>
                <tr><td className="label">GSTIN</td><td>{cust.gstin || '—'}</td></tr>
                <tr><td className="label">Phone</td><td>{cust.mobile || cust.phone || '—'}</td></tr>
                <tr><td className="label">Email</td><td>{cust.email || '—'}</td></tr>
                <tr><td className="label">Delivery Addr</td><td style={{ fontSize: 11 }}>{record.delivery_address || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-sm" style={{ marginBottom: 14 }}>
          <div className="card-title">📦 Line Items ({items.length}) — Total: <span style={{ color: 'var(--accent)' }} className="mono">{inrFmt(total)}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th><th>Component</th><th>Manufacturer</th>
                  <th style={{ textAlign: 'center' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'center' }}>Tax</th><th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={8}><span className="muted">No line items</span></td></tr>}
                {items.map((li, i) => (
                  <tr key={li.id || i}>
                    <td style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td><strong>{li.component || '—'}</strong>{li.ipn && <><br /><span className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{li.ipn}</span></>}</td>
                    <td>{li.manufacturer || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{li.qty || 0}</td>
                    <td style={{ textAlign: 'right' }} className="mono">{inrFmt(li.unit_price)}</td>
                    <td style={{ textAlign: 'right' }} className="mono">{inrFmt((li.qty || 0) * (li.unit_price || 0))}</td>
                    <td style={{ textAlign: 'center' }}>{li.tax_rate || 0}%</td>
                    <td>{li.line_status || record.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pos.length > 0 && (
          <div className="card card-sm" style={{ marginBottom: 14 }}>
            <div className="card-title">🛒 Supplier Purchase Orders ({pos.length})</div>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead><tr><th>PO No.</th><th>Supplier</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {pos.map((po, i) => (
                  <tr key={po.id || i}>
                    <td className="mono">{po.po_number || '—'}</td>
                    <td>{po.supplier_name || po.supplier_id || '—'}</td>
                    <td><StatusBadge s={po.status} /></td>
                    <td style={{ textAlign: 'right' }} className="mono">{po.amount ? inrFmt(po.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {record.notes && (
          <div className="card card-sm">
            <div className="card-title">📝 Notes</div>
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>{record.notes}</div>
          </div>
        )}
      </>
    );
  }

  // ── Enquiry / Sourcing detail ────────────────────────────────────────────
  if (type === 'enquiry' || type === 'sourcing') {
    const items   = record.items || [];
    const sourced = record.sourcing || [];
    const cust    = customers.find(c => c.id === record.customer_id) || {};
    content = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="card card-sm">
            <div className="card-title">📩 Enquiry Details</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>ID</td><td className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{record.id}</td></tr>
                <tr><td className="label">Status</td><td><StatusBadge s={record.status} /></td></tr>
                <tr><td className="label">Priority</td><td><span className={`badge ${record.priority === 'urgent' ? 'badge-red' : record.priority === 'high' ? 'badge-amber' : 'badge-gray'}`}>{record.priority || '—'}</span></td></tr>
                <tr><td className="label">Buying Type</td><td>{record.buying_type || '—'}</td></tr>
                <tr><td className="label">Sourcing No.</td><td>{record.sourcing_no || '—'}</td></tr>
                <tr><td className="label">Assigned To</td><td>{record.assigned_to || 'Unassigned'}</td></tr>
                <tr><td className="label">Created</td><td>{(record.created_at || '').slice(0, 10)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card card-sm">
            <div className="card-title">👤 Customer</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Name</td><td><strong>{custName(record.customer_id)}</strong></td></tr>
                <tr><td className="label">Phone</td><td>{cust.mobile || cust.phone || '—'}</td></tr>
                <tr><td className="label">Email</td><td>{cust.email || '—'}</td></tr>
                <tr><td className="label">GSTIN</td><td>{cust.gstin || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-sm" style={{ marginBottom: 14 }}>
          <div className="card-title">📋 Enquiry Items ({items.length})</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr><th style={{ width: 30 }}>#</th><th>Component</th><th>Manufacturer</th><th style={{ textAlign: 'center' }}>Qty</th><th>Target Price</th><th>Pref. Delivery</th><th>Date Code</th></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={7}><span className="muted">No items</span></td></tr>}
                {items.map((it, i) => (
                  <tr key={it.id || i}>
                    <td style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td><strong>{it.component || '—'}</strong></td>
                    <td>{it.manufacturer || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{it.qty || 0}</td>
                    <td>{it.target_price ? inrFmt(it.target_price) : '—'}</td>
                    <td>{it.pref_delivery || '—'}</td>
                    <td>{it.date_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {sourced.length > 0 && (
          <div className="card card-sm">
            <div className="card-title">🔍 Sourcing Results ({sourced.length})</div>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr><th>Component</th><th>Supplier</th><th style={{ textAlign: 'right' }}>Sourced Price</th><th style={{ textAlign: 'right' }}>Quote Price</th><th>Lead Time</th><th style={{ textAlign: 'center' }}>Qty</th></tr>
              </thead>
              <tbody>
                {sourced.map((s, i) => {
                  const matchItem = items.find(it => it.id === s.enquiry_item_id);
                  return (
                    <tr key={s.id || i}>
                      <td>{matchItem?.component || '—'}</td>
                      <td>{s.supplier_name || '—'}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{s.sourced_price ? inrFmt(s.sourced_price) : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{s.quote_price ? inrFmt(s.quote_price) : '—'}</td>
                      <td>{s.lead_time || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{s.qty || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  // ── Quote detail ─────────────────────────────────────────────────────────
  if (type === 'quote') {
    const items = record.line_items || record.lineItems || [];
    const cust  = customers.find(c => c.id === record.customer_id) || {};
    const total = items.reduce((s, li) => s + (li.qty || 0) * (li.unit_price || li.quote_price || 0), 0);
    content = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="card card-sm">
            <div className="card-title">📄 Quote Details</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Quote No.</td><td className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{record.quote_no}</td></tr>
                <tr><td className="label">Status</td><td><StatusBadge s={record.status} /></td></tr>
                <tr><td className="label">Enquiry Ref</td><td>{record.enquiry_id || '—'}</td></tr>
                <tr><td className="label">Revision</td><td>Rev {record.revision || 1}</td></tr>
                <tr><td className="label">Valid Until</td><td>{record.valid_until || '—'}</td></tr>
                <tr><td className="label">Cust. Response</td><td>{record.customer_response || 'Pending'}</td></tr>
                <tr><td className="label">Created</td><td>{(record.created_at || '').slice(0, 10)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card card-sm">
            <div className="card-title">👤 Customer</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Name</td><td><strong>{custName(record.customer_id)}</strong></td></tr>
                <tr><td className="label">GSTIN</td><td>{cust.gstin || '—'}</td></tr>
                <tr><td className="label">Phone</td><td>{cust.mobile || cust.phone || '—'}</td></tr>
                <tr><td className="label">Email</td><td>{cust.email || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-sm">
          <div className="card-title">📦 Quote Line Items ({items.length}) — Total: <span style={{ color: 'var(--accent)' }} className="mono">{inrFmt(total)}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr><th style={{ width: 30 }}>#</th><th>Component</th><th>Manufacturer</th><th style={{ textAlign: 'center' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit Price</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'center' }}>Tax</th></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={7}><span className="muted">No line items</span></td></tr>}
                {items.map((li, i) => {
                  const price = li.unit_price || li.quote_price || 0;
                  return (
                    <tr key={li.id || i}>
                      <td style={{ textAlign: 'center' }}>{i + 1}</td>
                      <td><strong>{li.component || '—'}</strong></td>
                      <td>{li.manufacturer || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{li.qty || 0}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{inrFmt(price)}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{inrFmt((li.qty || 0) * price)}</td>
                      <td style={{ textAlign: 'center' }}>{li.tax_rate || 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--blue-lt,#eff6ff)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right' }}>TOTAL</td>
                  <td style={{ textAlign: 'right' }} className="mono">{inrFmt(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </>
    );
  }

  // ── Finance detail ───────────────────────────────────────────────────────
  if (type === 'finance') {
    const relOrder = orders.find(o => o.id === record.order_id);
    content = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card card-sm">
          <div className="card-title">💰 Finance Queue Item</div>
          <table className="table" style={{ fontSize: 12 }}>
            <tbody>
              <tr><td className="label" style={{ width: '40%' }}>Order ID</td><td className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{record.order_id}</td></tr>
              <tr><td className="label">Type</td><td>{record.type || '—'}</td></tr>
              <tr><td className="label">Amount</td><td className="mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{record.amount ? inrFmt(record.amount) : '—'}</td></tr>
              <tr><td className="label">Status</td><td><StatusBadge s={record.status} /></td></tr>
              <tr><td className="label">Reference</td><td>{record.reference || '—'}</td></tr>
              <tr><td className="label">Due Date</td><td>{record.due_date || '—'}</td></tr>
              <tr><td className="label">Created</td><td>{(record.created_at || '').slice(0, 10)}</td></tr>
              {record.notes && <tr><td className="label">Notes</td><td>{record.notes}</td></tr>}
            </tbody>
          </table>
        </div>
        {relOrder && (
          <div className="card card-sm">
            <div className="card-title">📋 Related Order</div>
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr><td className="label" style={{ width: '40%' }}>Customer</td><td><strong>{custName(relOrder.customer_id)}</strong></td></tr>
                <tr><td className="label">Status</td><td><StatusBadge s={relOrder.status} /></td></tr>
                <tr><td className="label">PO Number</td><td>{relOrder.po_number || '—'}</td></tr>
                <tr><td className="label">Due Date</td><td>{relOrder.tentative_date || '—'}</td></tr>
                <tr><td className="label">Line Items</td><td>{relOrder.lineItems?.length || 0}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2 style={{ textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</h2>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {SECTION_LABELS[type] || type} &nbsp;·&nbsp; Read-only view
            </div>
          </div>
          <div className="flex gap-8">
            {SECTION_ROUTE[type] && (
              <button className="btn btn-sm"
                style={{ background: 'var(--green,#16a34a)', color: '#fff', borderColor: 'var(--green,#16a34a)', fontWeight: 600 }}
                onClick={() => { onClose(); navigate(SECTION_ROUTE[type]); }}>
                ↗ Go to {SECTION_LABELS[type]?.replace(/^\S+\s/, '') || 'Page'}
              </button>
            )}
            <button className="btn btn-sm"
              style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
              onClick={handleDownload}>⬇ Download PDF</button>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body">
          {content || <div style={{ padding: 24, color: 'var(--text3)' }}>No detail view available for this record type.</div>}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="btn"
            style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
            onClick={handleDownload}>⬇ Download PDF</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Reusable table section with filter + export ───────────────────────────────
function TableSection({ title, rows, columns, exportName, searchKeys = [], onRowClick, navPath, navLabel }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => searchKeys.some(k => String(r[k] || '').toLowerCase().includes(q)));
  }, [rows, search, searchKeys]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {title} <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>({filtered.length} records)</span>
        </div>
        {searchKeys.length > 0 && (
          <div className="search-wrap" style={{ minWidth: 200 }}>
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="14.5" y2="14.5" /></svg>
            <input className="search-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}
        <button className="btn btn-sm"
          style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => printDoc(generateReportPDF(title, filtered, columns))}>
          ⬇ PDF
        </button>
        <button className="btn btn-sm"
          style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportCSV(filtered, columns, `${exportName}.csv`)}>
          ⬇ CSV
        </button>
        {navPath && (
          <button className="btn btn-sm"
            style={{ background: 'var(--green,#16a34a)', color: '#fff', borderColor: 'var(--green,#16a34a)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => navigate(navPath)}>
            ↗ {navLabel || 'Open Page'}
          </button>
        )}
      </div>
      <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={columns.length}>
                <div className="empty-state"><div className="empty-icon">📊</div><div>No records</div></div>
              </td></tr>
            )}
            {filtered.map((r, i) => (
              <tr key={r.id || i}
                onClick={() => onRowClick && onRowClick(r)}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                className={onRowClick ? 'tr-hover' : ''}>
                {columns.map(c => (
                  <td key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left' }}>
                    {c.component ? c.component(r) : (c.render ? c.render(r) : (r[c.key] || '—'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuth();
  const role = user?.role || 'sales';
  const dept = user?.department || '';

  const allowedSections = ROLE_SECTIONS[role] || ROLE_SECTIONS[dept] || ['orders'];
  const [section, setSection] = useState(allowedSections[0]);
  const [orderFilter, setOrderFilter] = useState('all');
  const [detailRow,  setDetailRow]  = useState(null);
  const [detailType, setDetailType] = useState(null);

  const openDetail = type => row => { setDetailType(type); setDetailRow(row); };
  const closeDetail = () => { setDetailRow(null); setDetailType(null); };

  const { data: orders    = [] } = useQuery({ queryKey: ['orders'],    queryFn: () => api.get('/orders').then(r => r.data).catch(() => []) });
  const { data: enquiries = [] } = useQuery({ queryKey: ['enquiries'], queryFn: () => api.get('/enquiries').then(r => r.data).catch(() => []) });
  const { data: quotes    = [] } = useQuery({ queryKey: ['quotes'],    queryFn: () => api.get('/quotes').then(r => r.data).catch(() => []) });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/customers').then(r => r.data).catch(() => []) });
  const { data: summary   = {} } = useQuery({ queryKey: ['summary'],   queryFn: () => api.get('/reports/summary').then(r => r.data).catch(() => ({})) });
  const { data: financeQ  = [] } = useQuery({ queryKey: ['finance'],   queryFn: () => api.get('/finance-queue').then(r => r.data).catch(() => []) });

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const today = new Date();

  // ── Group quotes by enquiry_id — one row per enquiry (latest/primary) ──
  const quotesGrouped = useMemo(() => {
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
          primary = byStatus.sort((a, b) => (b.revision||1) - (a.revision||1))[0];
          break;
        }
      }
      if (!primary) primary = group[0];
      return { ...primary, _totalVersions: group.length };
    });
  }, [quotes]);

  // ── Orders filtered list ──────────────────────────────────────────────────
  const ordersFiltered = useMemo(() => {
    if (orderFilter === 'all')       return orders;
    if (orderFilter === 'delayed')   return orders.filter(o => isDelayed(o));
    return orders.filter(o => o.status === orderFilter);
  }, [orders, orderFilter]);

  const ORDER_FILTER_OPTS = [
    { v: 'all', l: `All (${orders.length})` },
    { v: 'open', l: `Open (${orders.filter(o => o.status === 'open').length})` },
    { v: 'delayed', l: `Delayed (${orders.filter(o => isDelayed(o)).length})` },
    { v: 'procurement', l: `Procurement (${orders.filter(o => o.status === 'procurement').length})` },
    { v: 'delivery_hub', l: `Delivery Hub (${orders.filter(o => o.status === 'delivery_hub').length})` },
    { v: 'delivered', l: `Delivered (${orders.filter(o => o.status === 'delivered').length})` },
    { v: 'closed', l: `Closed (${orders.filter(o => o.status === 'closed').length})` },
    { v: 'hold', l: `On Hold (${orders.filter(o => o.status === 'hold').length})` },
    { v: 'failed', l: `Failed (${orders.filter(o => o.status === 'failed').length})` },
  ];

  // ── Column definitions ───────────────────────────────────────────────────
  const orderCols = [
    { key: 'id',             label: 'Order ID',    render: r => r.id },
    { key: 'customer',       label: 'Customer',    render: r => custName(r.customer_id) },
    { key: 'po_number',      label: 'PO No.',      render: r => r.po_number || '—' },
    { key: 'items',          label: 'Items',       render: r => (r.lineItems?.length || 0),
      component: r => <span className="badge badge-blue">{r.lineItems?.length || 0}</span> },
    { key: 'status',         label: 'Status',
      render: r => r.status,
      component: r => <StatusBadge s={r.status} /> },
    { key: 'tentative_date', label: 'Due Date',    render: r => r.tentative_date || '—',
      component: r => <span style={{ color: isDelayed(r) ? 'var(--red)' : 'inherit', fontWeight: isDelayed(r) ? 700 : 400 }}>{r.tentative_date || '—'}{isDelayed(r) ? ' ⚠' : ''}</span> },
    { key: 'value',          label: 'Value', align: 'right', render: r => inr(orderTotal(r)),
      component: r => <span className="mono">{inr(orderTotal(r))}</span> },
    { key: 'days',           label: 'Days in Stage',
      render: r => { const d = r.updated_at || r.created_at; return d ? Math.floor((Date.now() - new Date(d.replace(' ','T'))) / 86400000) + 'd' : '—'; },
      component: r => <DaysBadge updatedAt={r.updated_at || r.created_at} /> },
    { key: 'created_at',     label: 'Created',     render: r => (r.created_at || '').slice(0, 10) },
  ];

  const enquiryCols = [
    { key: 'id',          label: 'Enquiry ID',   render: r => r.id },
    { key: 'customer',    label: 'Customer',     render: r => custName(r.customer_id) },
    { key: 'sourcing_no', label: 'Sourcing No.', render: r => r.sourcing_no || '—' },
    { key: 'buying_type', label: 'Buying Type',  render: r => r.buying_type || '—' },
    { key: 'priority',    label: 'Priority',     render: r => r.priority || '—' },
    { key: 'items',       label: 'Items', render: r => (r.items?.length || 0),
      component: r => <span className="badge badge-blue">{r.items?.length || 0}</span> },
    { key: 'status',      label: 'Status',       render: r => r.status,
      component: r => <StatusBadge s={r.status} /> },
    { key: 'assigned_to', label: 'Assigned To',  render: r => r.assigned_to || '—' },
    { key: 'days',        label: 'Days in Stage',
      render: r => { const d = r.updated_at || r.created_at; return d ? Math.floor((Date.now() - new Date(d.replace(' ','T'))) / 86400000) + 'd' : '—'; },
      component: r => <DaysBadge updatedAt={r.updated_at || r.created_at} /> },
    { key: 'created_at',  label: 'Created',      render: r => (r.created_at || '').slice(0, 10) },
  ];

  const quoteCols = [
    { key: 'quote_no',    label: 'Quote No.',    render: r => r.quote_no },
    { key: 'customer',    label: 'Customer',     render: r => custName(r.customer_id) },
    { key: 'enquiry_id',  label: 'Enquiry',      render: r => r.enquiry_id || '—' },
    { key: 'revision',    label: 'Rev',          render: r => r.revision || 1 },
    { key: 'status',      label: 'Status',       render: r => r.status,
      component: r => <StatusBadge s={r.status} /> },
    { key: 'customer_response', label: 'Response', render: r => r.customer_response || '—' },
    { key: 'valid_until', label: 'Valid Until',  render: r => r.valid_until || '—' },
    { key: 'days',        label: 'Days in Stage',
      render: r => { const d = r.updated_at || r.created_at; return d ? Math.floor((Date.now() - new Date(d.replace(' ','T'))) / 86400000) + 'd' : '—'; },
      component: r => <DaysBadge updatedAt={r.updated_at || r.created_at} /> },
    { key: 'created_at',  label: 'Created',      render: r => (r.created_at || '').slice(0, 10) },
  ];

  const srcEnqs = enquiries.filter(e => ['sourcing', 'quoted'].includes(e.status));
  const sourcingCols = [
    { key: 'id',          label: 'Enquiry ID',   render: r => r.id },
    { key: 'customer',    label: 'Customer',     render: r => custName(r.customer_id) },
    { key: 'sourcing_no', label: 'Sourcing No.', render: r => r.sourcing_no || '—' },
    { key: 'buying_type', label: 'Buying Type',  render: r => r.buying_type || '—' },
    { key: 'items',       label: 'Items', render: r => r.items?.length || 0 },
    { key: 'sourcing',    label: 'Sourced', render: r => r.sourcing?.length || 0,
      component: r => {
        const total = r.items?.length || 0;
        const done  = r.sourcing?.length || 0;
        const pct   = total > 0 ? Math.round(done / total * 100) : 0;
        const col   = pct === 100 ? 'var(--green)' : pct > 0 ? 'var(--amber,#d97706)' : 'var(--text3)';
        return <span style={{ fontWeight: 700, color: col }}>{done}/{total} ({pct}%)</span>;
      }
    },
    { key: 'status',      label: 'Status',       render: r => r.status, component: r => <StatusBadge s={r.status} /> },
    { key: 'assigned_to', label: 'Assigned To',  render: r => r.assigned_to || '—' },
    { key: 'days',        label: 'Days in Stage', render: r => '—', component: r => <DaysBadge updatedAt={r.updated_at || r.created_at} /> },
  ];

  const procOrders = orders.filter(o => ['open','procurement','delivery_hub','transit_customer','partial_hub','transit_hub'].includes(o.status));
  const procCols = [
    { key: 'id',             label: 'Order ID',   render: r => r.id },
    { key: 'customer',       label: 'Customer',   render: r => custName(r.customer_id) },
    { key: 'po_number',      label: 'PO No.',     render: r => r.po_number || '—' },
    { key: 'status',         label: 'Status',     render: r => r.status, component: r => <StatusBadge s={r.status} /> },
    { key: 'pos',            label: 'POs Raised', render: r => r.supplierOrders?.length || 0,
      component: r => <span className="badge badge-blue">{r.supplierOrders?.length || 0}</span> },
    { key: 'tentative_date', label: 'Due Date',   render: r => r.tentative_date || '—',
      component: r => <span style={{ color: isDelayed(r) ? 'var(--red)' : 'inherit', fontWeight: isDelayed(r) ? 700 : 400 }}>{r.tentative_date || '—'}{isDelayed(r) ? ' ⚠' : ''}</span> },
    { key: 'value',          label: 'Value', align: 'right', render: r => inr(orderTotal(r)) },
    { key: 'days',           label: 'Days in Stage', render: r => '—', component: r => <DaysBadge updatedAt={r.updated_at || r.created_at} /> },
  ];

  const financeCols = [
    { key: 'order_id',     label: 'Order ID',    render: r => r.order_id },
    { key: 'customer',     label: 'Customer',    render: r => custName(r.customer_id || orders.find(o => o.id === r.order_id)?.customer_id) },
    { key: 'type',         label: 'Type',        render: r => r.type || '—' },
    { key: 'amount',       label: 'Amount', align: 'right', render: r => r.amount ? inr(r.amount) : '—' },
    { key: 'status',       label: 'Status',      render: r => r.status, component: r => <StatusBadge s={r.status} /> },
    { key: 'created_at',   label: 'Created',     render: r => (r.created_at || '').slice(0, 10) },
  ];

  return (
    <div>
      {/* Section tabs */}
      <div className="tab-bar" style={{ marginBottom: 18 }}>
        {allowedSections.map(s => (
          <button key={s} className={`tab-btn ${section === s ? 'active' : ''}`}
            onClick={() => setSection(s)}>
            {SECTION_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {section === 'overview' && (
        <OverviewSection summary={summary} orders={orders} enquiries={enquiries} quotes={quotes} />
      )}

      {/* ── Orders ── */}
      {section === 'orders' && (
        <div>
          <div className="filter-row" style={{ marginBottom: 14 }}>
            {ORDER_FILTER_OPTS.map(f => (
              <span key={f.v} className={`fchip ${orderFilter === f.v ? 'active' : ''}`}
                onClick={() => setOrderFilter(f.v)}>{f.l}</span>
            ))}
          </div>
          <TableSection
            title={`Order List — ${ORDER_FILTER_OPTS.find(f => f.v === orderFilter)?.l || ''}`}
            rows={ordersFiltered}
            columns={orderCols}
            exportName={`orders_${orderFilter}`}
            searchKeys={['id', 'po_number']}
            onRowClick={openDetail('order')}
            navPath={SECTION_ROUTE.orders}
            navLabel="Orders"
          />
        </div>
      )}

      {/* ── Enquiries ── */}
      {section === 'enquiries' && (
        <TableSection
          title="Enquiry Report"
          rows={enquiries}
          columns={enquiryCols}
          exportName="enquiries"
          searchKeys={['id', 'sourcing_no', 'buying_type']}
          onRowClick={openDetail('enquiry')}
          navPath={SECTION_ROUTE.enquiries}
          navLabel="Enquiries"
        />
      )}

      {/* ── Quotes ── */}
      {section === 'quotes' && (
        <TableSection
          title="Quotes Report"
          rows={quotesGrouped}
          columns={quoteCols}
          exportName="quotes"
          searchKeys={['quote_no', 'enquiry_id']}
          onRowClick={openDetail('quote')}
          navPath={SECTION_ROUTE.quotes}
          navLabel="Quotes"
        />
      )}

      {/* ── Sourcing ── */}
      {section === 'sourcing' && (
        <TableSection
          title="Sourcing Bin Report"
          rows={srcEnqs}
          columns={sourcingCols}
          exportName="sourcing"
          searchKeys={['id', 'sourcing_no']}
          onRowClick={openDetail('sourcing')}
          navPath={SECTION_ROUTE.sourcing}
          navLabel="Sourcing Bin"
        />
      )}

      {/* ── Procurement ── */}
      {section === 'procurement' && (
        <TableSection
          title="Procurement Report"
          rows={procOrders}
          columns={procCols}
          exportName="procurement"
          searchKeys={['id', 'po_number']}
          onRowClick={openDetail('procurement')}
          navPath={SECTION_ROUTE.procurement}
          navLabel="Procurement Bin"
        />
      )}

      {/* ── Finance ── */}
      {section === 'finance' && (
        <TableSection
          title="Finance Queue Report"
          rows={financeQ}
          columns={financeCols}
          exportName="finance_queue"
          searchKeys={['order_id']}
          onRowClick={openDetail('finance')}
          navPath={SECTION_ROUTE.finance}
          navLabel="Finance"
        />
      )}

      {detailRow && (
        <ReportDetailModal
          record={detailRow}
          type={detailType}
          onClose={closeDetail}
          customers={customers}
          orders={orders}
        />
      )}
    </div>
  );
}
