// Shared PDF utilities — CIFLUX Electronic Private Limited
// All PDFs use printDoc(html) → window.open → window.print

const CO = {
  name:    'CIFLUX Electronic Private Limited',
  gstin:   '29AANCC4989N1ZI',
  website: 'www.cifluxelectronic.com',
  phone:   '+91 8042087864',
  email:   'Sales@cifluxelectronic.com',
  address: '#203, 1st Floor, Oxford Tower, Kodihalli, Old Airport Road, Bengaluru – 560008, Karnataka, India',
};

/** Open a new tab and print */
export function printDoc(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to open the document.'); return; }
  w.document.write(html);
  w.document.close();
}

/** Shared CSS injected into every PDF */
export const PDF_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#fff;
    padding:20px 24px;display:flex;flex-direction:column;min-height:calc(100vh - 40px)}
  h1,h2,h3{margin:0}
  table{width:100%;border-collapse:collapse}
  th{background:#1b3a6b;color:#fff;padding:6px 6px;font-size:9px;text-align:left;border:1px solid #1b3a6b}
  td{padding:5px 6px;border:1px solid #d1d5db;vertical-align:top;font-size:9.5px}
  .label{font-weight:700;background:#f3f4f6;color:#374151}
  .accent{color:#1b3a6b;font-weight:700}
  .mono{font-family:monospace}
  .right{text-align:right}
  .center{text-align:center}
  .total-row td{background:#eff6ff;font-weight:700;font-size:10px;border:1px solid #1b3a6b}
  .section-title{background:#1b3a6b;color:#fff;font-weight:700;font-size:9px;letter-spacing:.4px;
    padding:5px 8px;margin:10px 0 0 0}
  .no-print{background:#1b3a6b;color:#fff;padding:8px 16px;margin-bottom:18px;border-radius:6px;
    display:flex;align-items:center;justify-content:space-between}
  .no-print button{background:#fff;color:#1b3a6b;border:none;padding:5px 14px;
    border-radius:4px;cursor:pointer;font-weight:700;font-size:12px}
  .sig-area{margin-top:28px;display:flex;justify-content:flex-end}
  .sig-box{text-align:center;min-width:160px}
  .sig-line{border-top:1px solid #000;padding-top:4px;margin-top:32px;font-size:8.5px}
  .page-footer{margin-top:auto}
  .footer-bar{padding:8px 0;border-top:1px solid #d1d5db;
    font-size:8px;color:#6b7280;text-align:center;line-height:1.6}
  @media print{
    .no-print{display:none}
    body{display:block;padding:105px 24px 48px !important;margin:0}
    .page-header{position:fixed;top:0;left:0;right:0;background:#fff;
      padding:12px 24px 0;z-index:999}
    .page-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;
      padding:0 24px 6px;margin-top:0;z-index:999}
  }
`;

/** Branded company header block (logo left, details right) */
export function companyHeader(docTitle) {
  return `
  <div class="page-header">
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
    <tr>
      <td style="width:110px;padding:0 12px 0 0;border:none;vertical-align:middle">
        <img src="/logo.png" style="height:56px;width:auto;display:block" alt="CIFLUX Logo"
          onerror="this.style.display='none'" />
      </td>
      <td style="border:none;vertical-align:top">
        <div style="font-size:14px;font-weight:800;color:#1b3a6b">${CO.name}</div>
        <div style="font-size:8.5px;color:#4b5563;line-height:1.7;margin-top:2px">
          ${CO.address}<br/>
          GSTIN: ${CO.gstin} &nbsp;|&nbsp; Phone: ${CO.phone} &nbsp;|&nbsp; Email: ${CO.email} &nbsp;|&nbsp; ${CO.website}
        </div>
      </td>
      <td style="border:none;text-align:right;vertical-align:middle;min-width:170px">
        <div style="background:#1b3a6b;color:#fff;font-size:14px;font-weight:800;
          padding:8px 16px;border-radius:4px;display:inline-block;letter-spacing:.5px">
          ${docTitle}
        </div>
      </td>
    </tr>
  </table>
  <hr style="border:none;border-top:2px solid #1b3a6b;margin-bottom:10px"/>
  </div>`;
}

/** Branded footer */
export function companyFooter(docNo) {
  return `
  <div class="page-footer"><div class="footer-bar">
    ${CO.name} &nbsp;|&nbsp; GSTIN: ${CO.gstin} &nbsp;|&nbsp; ${CO.email} &nbsp;|&nbsp; ${CO.phone} &nbsp;|&nbsp; ${CO.website}<br/>
    ${docNo ? `Document: ${docNo} &nbsp;|&nbsp; ` : ''}Generated on ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})} by CIFLUX OMS
  </div></div>`;
}

function inr(n) { return '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function cur(n, c) {
  const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£', SGD: 'S$', AED: 'د.إ' };
  return (sym[c] || (c + ' ')) + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function today() { return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

function buildCustAddr(c) {
  if (!c) return '—';
  const parts = [
    c.billing_attention,
    c.billing_street1,
    c.billing_street2,
    c.billing_city,
    c.billing_state,
    c.billing_pincode,
    c.billing_country,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : (c.city ? [c.city, c.state, c.country].filter(Boolean).join(', ') : '—');
}

function buildSupAddr(s) {
  if (!s) return '—';
  const parts = [
    s.billing_attention,
    s.billing_street1,
    s.billing_street2,
    s.billing_city || s.city,
    s.billing_state || s.state,
    s.billing_pincode,
    s.billing_country || s.country,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

// ─── 1. ORDER SUMMARY PDF ────────────────────────────────────────────────────
export function generateOrderPDF(order, customer) {
  const items = order.lineItems || [];
  const baseTotal = items.reduce((s, li) => s + (li.qty || 0) * (li.unit_price || 0), 0);
  const rows = items.map((li, i) => {
    const base = (li.qty || 0) * (li.unit_price || 0);
    const c = li.currency || 'INR';
    return `<tr>
      <td class="center">${i + 1}</td>
      <td>${li.component || '—'}${li.manufacturer ? '<br/><span style="color:#6b7280;font-size:8.5px">' + li.manufacturer + '</span>' : ''}${li.ipn ? '<br/><span class="mono" style="font-size:8px">' + li.ipn + '</span>' : ''}</td>
      <td class="center">${li.qty || 0}</td>
      <td class="right">${cur(li.unit_price, c)}</td>
      <td class="right">${cur(base, c)}</td>
      <td class="center">${li.tax_rate || 0}%</td>
      <td class="center">${li.line_status || order.status || '—'}</td>
    </tr>`;
  }).join('');

  const custAddr = buildCustAddr(customer);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Order Summary — ${order.id}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>📋 Order Summary — ${order.id}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('ORDER SUMMARY')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="width:50%;border:none;padding:0 8px 0 0;vertical-align:top">
        <div class="section-title">ORDER DETAILS</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Order ID</td><td class="accent mono">${order.id}</td></tr>
          <tr><td class="label">Status</td><td>${order.status || '—'}</td></tr>
          <tr><td class="label">Enquiry No.</td><td>${order.enquiry_no || '—'}</td></tr>
          <tr><td class="label">Quote No.</td><td>${order.quote_no || '—'}</td></tr>
          <tr><td class="label">Customer PO</td><td>${order.po_number || '—'}</td></tr>
          <tr><td class="label">Due Date</td><td>${order.tentative_date || '—'}</td></tr>
          <tr><td class="label">Created</td><td>${(order.created_at || '').slice(0, 10)}</td></tr>
        </table>
      </td>
      <td style="width:50%;border:none;padding:0 0 0 8px;vertical-align:top">
        <div class="section-title">CUSTOMER</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Name</td><td style="font-weight:700">${customer?.name || order.customer_id}</td></tr>
          <tr><td class="label">GSTIN</td><td>${customer?.gstin || '—'}</td></tr>
          <tr><td class="label">Phone</td><td>${customer?.mobile || customer?.phone || '—'}</td></tr>
          <tr><td class="label">Email</td><td>${customer?.email || '—'}</td></tr>
          <tr><td class="label">Billing Address</td><td>${custAddr}</td></tr>
          <tr><td class="label">Delivery To</td><td>${order.delivery_address || custAddr || '—'}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">LINE ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th class="center" style="width:4%">#</th>
      <th style="width:35%">Component / Description</th>
      <th class="center" style="width:6%">Qty</th>
      <th class="right" style="width:12%">Unit Price</th>
      <th class="right" style="width:12%">Amount</th>
      <th class="center" style="width:8%">Tax %</th>
      <th class="center" style="width:14%">Stage</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4" class="right">TOTAL</td>
        <td class="right">${inr(baseTotal)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  ${order.notes ? `<div class="section-title">NOTES</div><div style="padding:8px;border:1px solid #d1d5db;font-size:9.5px">${order.notes}</div>` : ''}

  <div class="sig-area">
    <div class="sig-box">
      <div style="font-size:9px;font-weight:700">For ${CO.name}</div>
      <div class="sig-line">Authorised Signatory</div>
    </div>
  </div>
  ${companyFooter(order.id)}
  </body></html>`;
}

// ─── 2. ENQUIRY PDF ──────────────────────────────────────────────────────────
export function generateEnquiryPDF(enq, customer) {
  const items = enq.items || [];
  const sourcing = enq.sourcing || [];
  const rows = items.map((it, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td>${it.component || '—'}${it.manufacturer ? '<br/><span style="color:#6b7280;font-size:8.5px">' + it.manufacturer + '</span>' : ''}</td>
    <td class="mono" style="font-size:8.5px">${it.ipn || '—'}</td>
    <td class="center">${it.qty || 0}</td>
    <td class="right">${it.target_price ? inr(it.target_price) : '—'}</td>
    <td class="center">${it.pref_delivery || '—'}</td>
    <td class="center">${it.date_code || '—'}</td>
  </tr>`).join('');

  const srcRows = sourcing.map((s, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td>${(items.find(it => it.id === s.enquiry_item_id) || {}).component || '—'}</td>
    <td>${s.supplier_name || '—'}</td>
    <td class="right">${s.sourced_price ? inr(s.sourced_price) : '—'}</td>
    <td class="right">${s.quote_price ? inr(s.quote_price) : '—'}</td>
    <td class="center">${s.availability || '—'}</td>
    <td class="center">${s.lead_time || '—'}</td>
    <td>${s.notes || ''}</td>
  </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Enquiry — ${enq.id}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>📩 Enquiry — ${enq.id}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('ENQUIRY DETAILS')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="width:50%;border:none;padding:0 8px 0 0;vertical-align:top">
        <div class="section-title">ENQUIRY INFO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Enquiry ID</td><td class="accent mono">${enq.id}</td></tr>
          <tr><td class="label">Status</td><td>${enq.status || '—'}</td></tr>
          <tr><td class="label">Sourcing No.</td><td>${enq.sourcing_no || '—'}</td></tr>
          <tr><td class="label">Buying Type</td><td>${enq.buying_type || '—'}</td></tr>
          <tr><td class="label">Priority</td><td>${enq.priority || '—'}</td></tr>
          <tr><td class="label">Assigned To</td><td>${enq.assigned_to || '—'}</td></tr>
          <tr><td class="label">Created</td><td>${(enq.created_at || '').slice(0, 10)}</td></tr>
        </table>
      </td>
      <td style="width:50%;border:none;padding:0 0 0 8px;vertical-align:top">
        <div class="section-title">CUSTOMER</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Name</td><td style="font-weight:700">${customer?.name || enq.customer_id}</td></tr>
          <tr><td class="label">GSTIN</td><td>${customer?.gstin || '—'}</td></tr>
          <tr><td class="label">Phone</td><td>${customer?.mobile || customer?.phone || '—'}</td></tr>
          <tr><td class="label">Email</td><td>${customer?.email || '—'}</td></tr>
          <tr><td class="label">Address</td><td>${buildCustAddr(customer)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">LINE ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th class="center" style="width:4%">#</th><th style="width:28%">Component</th>
      <th style="width:10%">IPN</th><th class="center" style="width:7%">Qty</th>
      <th class="right" style="width:12%">Target Price</th>
      <th class="center" style="width:12%">Pref. Delivery</th>
      <th class="center" style="width:10%">Date Code</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#6b7280">No items</td></tr>'}</tbody>
  </table>

  ${sourcing.length > 0 ? `
  <div class="section-title" style="margin-top:12px">SOURCING DATA</div>
  <table style="margin-top:0">
    <thead><tr>
      <th class="center" style="width:4%">#</th><th style="width:20%">Component</th>
      <th style="width:18%">Supplier</th><th class="right">Src Price</th>
      <th class="right">Quote Price</th><th class="center">Availability</th>
      <th class="center">Lead Time</th><th>Notes</th>
    </tr></thead>
    <tbody>${srcRows}</tbody>
  </table>` : ''}

  ${enq.notes ? `<div class="section-title">NOTES</div><div style="padding:8px;border:1px solid #d1d5db;font-size:9.5px">${enq.notes}</div>` : ''}
  ${companyFooter(enq.id)}
  </body></html>`;
}

// ─── 3. QUOTE PDF ────────────────────────────────────────────────────────────
export function generateQuotePDF(quote, customer) {
  const items = quote.items || [];
  const charges = (() => { try { return JSON.parse(quote.charges || '[]'); } catch (_) { return []; } })();
  const baseTotal = items.reduce((s, li) => s + (li.qty || 0) * (li.unit_price || 0), 0);
  const chargesTotal = charges.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const gstTotal = items.reduce((s, li) => { const b = (li.qty || 0) * (li.unit_price || 0); return s + b * ((li.tax_rate || 0) / 100); }, 0);
  const grandTotal = baseTotal + chargesTotal + gstTotal;

  const rows = items.map((li, i) => {
    const base = (li.qty || 0) * (li.unit_price || 0);
    const gst = base * ((li.tax_rate || 0) / 100);
    return `<tr>
      <td class="center">${i + 1}</td>
      <td>${li.component || '—'}${li.manufacturer ? '<br/><span style="color:#6b7280;font-size:8.5px">' + li.manufacturer + '</span>' : ''}${li.ipn ? '<br/><span class="mono" style="font-size:8px">' + li.ipn + '</span>' : ''}</td>
      <td class="center">${li.hsn_code || '—'}</td>
      <td class="center">${li.qty || 0}</td>
      <td class="right">${inr(li.unit_price)}</td>
      <td class="right">${inr(base)}</td>
      <td class="center">${li.tax_rate || 0}%</td>
      <td class="right">${inr(gst)}</td>
      <td class="right">${inr(base + gst)}</td>
    </tr>`;
  }).join('');

  const chargeRows = charges.map(c => `<tr>
    <td colspan="5" class="right" style="font-style:italic">${c.name || 'Charge'}</td>
    <td colspan="4" class="right">${inr(c.amount)}</td>
  </tr>`).join('');

  const custAddr = buildCustAddr(customer);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quote — ${quote.quote_no}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>📄 Quote — ${quote.quote_no}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('QUOTATION')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="width:55%;border:none;padding:0 10px 0 0;vertical-align:top">
        <div class="section-title">BILL TO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:35%">Customer</td><td style="font-weight:700">${customer?.name || quote.customer_id}</td></tr>
          <tr><td class="label">Address</td><td>${custAddr}</td></tr>
          <tr><td class="label">GSTIN</td><td>${customer?.gstin || '—'}</td></tr>
          <tr><td class="label">Contact</td><td>${customer?.mobile || customer?.phone || '—'}</td></tr>
          <tr><td class="label">Email</td><td>${customer?.email || '—'}</td></tr>
        </table>
      </td>
      <td style="width:45%;border:none;padding:0 0 0 10px;vertical-align:top">
        <div class="section-title">QUOTE DETAILS</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:45%">Quote No.</td><td class="accent mono">${quote.quote_no}</td></tr>
          <tr><td class="label">Revision</td><td>Rev ${quote.revision || 1}</td></tr>
          <tr><td class="label">Date</td><td>${(quote.created_at || '').slice(0, 10) || today()}</td></tr>
          <tr><td class="label">Valid Until</td><td>${quote.valid_until || '—'}</td></tr>
          <tr><td class="label">Enquiry Ref.</td><td class="mono">${quote.enquiry_id || '—'}</td></tr>
          <tr><td class="label">Status</td><td>${quote.status || '—'}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">LINE ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th class="center" style="width:4%">Sl</th>
      <th style="width:30%">Component / Description</th>
      <th class="center" style="width:8%">HSN</th>
      <th class="center" style="width:5%">Qty</th>
      <th class="right" style="width:11%">Unit Price</th>
      <th class="right" style="width:11%">Amount</th>
      <th class="center" style="width:6%">GST%</th>
      <th class="right" style="width:10%">GST</th>
      <th class="right" style="width:12%">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    ${chargeRows ? `<tbody>${chargeRows}</tbody>` : ''}
    <tfoot>
      <tr class="total-row">
        <td colspan="5" class="right">GRAND TOTAL</td>
        <td class="right">${inr(baseTotal)}</td>
        <td></td>
        <td class="right">${inr(gstTotal)}</td>
        <td class="right accent">${inr(grandTotal)}</td>
      </tr>
    </tfoot>
  </table>

  ${quote.notes ? `<div class="section-title">NOTES / TERMS</div><div style="padding:8px;border:1px solid #d1d5db;font-size:9.5px">${quote.notes}</div>` : `
  <div class="section-title">TERMS &amp; CONDITIONS</div>
  <div style="padding:8px;border:1px solid #d1d5db;font-size:9px;line-height:1.7">
    1) All orders are accepted on NCNR (Non-Cancellable, Non-Returnable).<br/>
    2) Payment Terms: 100% advance against this Proforma Invoice.<br/>
    3) Lead Time: 1–2 Weeks from payment confirmation.<br/>
    4) Goods once sold will not be taken back.<br/>
    5) This quote is valid until ${quote.valid_until || 'the date mentioned above'}.
  </div>`}

  <div class="sig-area">
    <div class="sig-box">
      <div style="font-size:9px;font-weight:700">For ${CO.name}</div>
      <div class="sig-line">Authorised Signatory</div>
    </div>
  </div>
  ${companyFooter(quote.quote_no)}
  </body></html>`;
}

// ─── 4. SUPPLIER PO PDF ──────────────────────────────────────────────────────
export function generateSupplierPOPDF(po, order, supplier, enquiry) {
  const allItems = order?.lineItems || [];
  const poItemIds = po.items || [];
  const lineItems = poItemIds.map(id => allItems.find(li => li.id === id)).filter(Boolean);
  const poTotal = lineItems.reduce((s, li) => {
    const bpu = parseFloat(po.buying_price_per_unit || 0);
    return s + bpu * (li.qty || 0);
  }, 0);

  const rows = lineItems.map((li, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td>${li.component || '—'}${li.manufacturer ? '<br/><span style="color:#6b7280;font-size:8.5px">' + li.manufacturer + '</span>' : ''}${li.ipn ? '<br/><span class="mono" style="font-size:8px">' + li.ipn + '</span>' : ''}</td>
    <td class="center">${li.qty || 0}</td>
    <td class="right">${inr(po.buying_price_per_unit)}</td>
    <td class="right">${inr((li.qty || 0) * parseFloat(po.buying_price_per_unit || 0))}</td>
    <td class="center">${li.date_code || '—'}</td>
  </tr>`).join('');

  const supAddr = buildSupAddr(supplier);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Order — ${po.internal_po_no || po.id}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>🛒 Purchase Order — ${po.internal_po_no || po.id}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('PURCHASE ORDER')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="width:55%;border:none;padding:0 10px 0 0;vertical-align:top">
        <div class="section-title">SUPPLIER DETAILS</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:38%">Supplier</td><td style="font-weight:700">${supplier?.name || '—'}</td></tr>
          <tr><td class="label">Address</td><td>${supAddr}</td></tr>
          <tr><td class="label">GSTIN</td><td>${supplier?.gstin || '—'}</td></tr>
          <tr><td class="label">Contact</td><td>${supplier?.contact_name || '—'}</td></tr>
          <tr><td class="label">Phone</td><td>${supplier?.phone || '—'}</td></tr>
          <tr><td class="label">Email</td><td>${supplier?.email || '—'}</td></tr>
        </table>
      </td>
      <td style="width:45%;border:none;padding:0 0 0 10px;vertical-align:top">
        <div class="section-title">PO DETAILS</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:42%">PO Number</td><td class="accent mono">${po.internal_po_no || po.id}</td></tr>
          <tr><td class="label">Zoho PO No.</td><td>${po.zoho_po_number || '—'}</td></tr>
          <tr><td class="label">Order Ref.</td><td>${order?.id || '—'}</td></tr>
          <tr><td class="label">Date</td><td>${today()}</td></tr>
          <tr><td class="label">Promised Delivery</td><td>${po.promised_delivery_date || '—'}</td></tr>
          <tr><td class="label">Payment Terms</td><td>${po.payment_terms_type === 'advance' ? '100% Advance' : po.payment_terms_type === 'net' ? `Net ${po.payment_net_days} Days` : po.payment_terms_type === 'split' ? `${po.payment_advance_pct}% Advance + Balance on Delivery` : po.payment_terms_type || '—'}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th class="center" style="width:4%">#</th>
      <th style="width:38%">Component / Description</th>
      <th class="center" style="width:7%">Qty</th>
      <th class="right" style="width:15%">Unit Price</th>
      <th class="right" style="width:15%">Amount</th>
      <th class="center" style="width:12%">Date Code</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#6b7280">No items assigned</td></tr>'}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4" class="right">TOTAL</td>
        <td class="right accent">${inr(poTotal)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  ${po.notes ? `<div class="section-title">NOTES</div><div style="padding:8px;border:1px solid #d1d5db;font-size:9.5px">${po.notes}</div>` : ''}

  <div class="section-title">TERMS &amp; CONDITIONS</div>
  <div style="padding:8px;border:1px solid #d1d5db;font-size:9px;line-height:1.7">
    1) Please confirm receipt and acceptance of this PO by return email within 24 hours.<br/>
    2) All goods must be supplied as per specifications and date codes mentioned above.<br/>
    3) Delivery must be made by the Promised Delivery Date. Late deliveries must be notified in advance.<br/>
    4) Invoice must reference this PO Number.
  </div>

  <div class="sig-area">
    <div class="sig-box">
      <div style="font-size:9px;font-weight:700">For ${CO.name}</div>
      <div class="sig-line">Authorised Signatory</div>
    </div>
  </div>
  ${companyFooter(po.internal_po_no || po.id)}
  </body></html>`;
}

// ─── 5. DELIVERY SLIP PDF ────────────────────────────────────────────────────
export function generateDeliverySlipPDF(order, selectedItems, shipmentNo, shipperName, awb, invoiceRef, custName) {
  const rows = selectedItems.map(li =>
    `<tr><td>${li.component}</td><td>${li.manufacturer || '—'}</td><td class="mono">${li.ipn || '—'}</td><td class="center">${li.qty}</td><td></td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Delivery Slip — ${order.id}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>📄 Delivery Slip — Shipment ${shipmentNo}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('DELIVERY CHALLAN')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="border:none;vertical-align:top;padding:0 10px 0 0;width:50%">
        <div class="section-title">SHIPMENT INFO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Shipment No.</td><td class="accent mono">${shipmentNo}</td></tr>
          <tr><td class="label">Order ID</td><td>${order.id}</td></tr>
          <tr><td class="label">Customer PO</td><td>${order.po_number || '—'}</td></tr>
          <tr><td class="label">Invoice No.</td><td>${invoiceRef || '—'}</td></tr>
          <tr><td class="label">Date</td><td>${today()}</td></tr>
          <tr><td class="label">Carrier</td><td>${shipperName || '—'}</td></tr>
          <tr><td class="label">AWB No.</td><td>${awb || 'TBD'}</td></tr>
        </table>
      </td>
      <td style="border:none;vertical-align:top;padding:0 0 0 10px;width:50%">
        <div class="section-title">SHIP TO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Customer</td><td style="font-weight:700">${custName}</td></tr>
          <tr><td class="label">Address</td><td>${order.delivery_address || '—'}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th style="width:32%">Component / Description</th>
      <th style="width:18%">Manufacturer</th>
      <th style="width:14%">IPN</th>
      <th class="center" style="width:8%">Qty</th>
      <th style="width:28%">Remarks</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table style="margin-top:28px">
    <tr>
      <td style="border:none;width:33%;padding-top:32px;border-top:1px solid #000;text-align:center;font-size:8.5px">Prepared By</td>
      <td style="border:none;width:34%;padding-top:32px;border-top:1px solid #000;text-align:center;font-size:8.5px">Authorised Signatory</td>
      <td style="border:none;width:33%;padding-top:32px;border-top:1px solid #000;text-align:center;font-size:8.5px">Received By (Customer)</td>
    </tr>
  </table>
  ${companyFooter(shipmentNo)}
  </body></html>`;
}

// ─── 6. PACKING LIST PDF ─────────────────────────────────────────────────────
export function generatePackingListPDF(order, selectedItems, grnRecords, shipmentNo, custName) {
  const rows = selectedItems.map(li => {
    const grn = (grnRecords || []).find(g => g.order_item_id === li.id) || {};
    return `<tr>
      <td>${li.component}</td><td>${li.manufacturer || '—'}</td>
      <td class="mono">${li.ipn || '—'}</td><td class="center">${li.qty}</td>
      <td class="center">${grn.date_code || '—'}</td><td class="center">${grn.lot_number || '—'}</td>
      <td class="center">${grn.coo || '—'}</td><td class="right">${grn.weight_kg || '—'}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Packing List — ${order.id}</title>
  <style>${PDF_CSS}</style></head><body>
  <div class="no-print">
    <span>📦 Packing List — Shipment ${shipmentNo}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader('PACKING LIST')}

  <table style="margin-bottom:10px">
    <tr>
      <td style="border:none;padding:0 10px 0 0;width:50%;vertical-align:top">
        <div class="section-title">SHIPMENT INFO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Shipment No.</td><td class="accent mono">${shipmentNo}</td></tr>
          <tr><td class="label">Order ID</td><td>${order.id}</td></tr>
          <tr><td class="label">Customer PO</td><td>${order.po_number || '—'}</td></tr>
          <tr><td class="label">Date</td><td>${today()}</td></tr>
        </table>
      </td>
      <td style="border:none;padding:0 0 0 10px;width:50%;vertical-align:top">
        <div class="section-title">DELIVER TO</div>
        <table style="margin-top:0">
          <tr><td class="label" style="width:40%">Customer</td><td style="font-weight:700">${custName}</td></tr>
          <tr><td class="label">Address</td><td>${order.delivery_address || '—'}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section-title">ITEMS</div>
  <table style="margin-top:0">
    <thead><tr>
      <th style="width:24%">Component</th><th style="width:16%">Manufacturer</th>
      <th style="width:12%">IPN</th><th class="center" style="width:6%">Qty</th>
      <th class="center" style="width:10%">Date Code</th><th class="center" style="width:10%">LOT</th>
      <th class="center" style="width:8%">COO</th><th class="right" style="width:10%">Weight (kg)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${companyFooter(shipmentNo)}
  </body></html>`;
}

// ─── 7. REPORT LIST PDF ──────────────────────────────────────────────────────
export function generateReportPDF(title, rows, columns) {
  const headerCells = columns.map(c => `<th>${c.label}</th>`).join('');
  const dataRows = rows.map(row =>
    `<tr>${columns.map(c => `<td class="${c.align || ''}">${c.render ? c.render(row) : (row[c.key] || '—')}</td>`).join('')}</tr>`
  ).join('') || `<tr><td colspan="${columns.length}" style="text-align:center;color:#6b7280">No data</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>${PDF_CSS}
    table{font-size:9px}th{font-size:8.5px}
    tr:nth-child(even) td{background:#f9fafb}
  </style></head><body>
  <div class="no-print">
    <span>📊 ${title}</span>
    <button onclick="window.print()">🖨 Download / Print PDF</button>
  </div>
  ${companyHeader(title.toUpperCase())}
  <div style="font-size:9px;color:#6b7280;margin-bottom:8px">
    Generated: ${today()} &nbsp;|&nbsp; Total records: ${rows.length}
  </div>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  ${companyFooter('')}
  </body></html>`;
}
