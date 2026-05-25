// client/src/pages/FinancePage.js
// Finance module — Customer receipts + Supplier payments
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../utils/helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtM = (n, c='INR') => {
  const sym = {INR:'₹',USD:'$',EUR:'€',SGD:'S$',GBP:'£'};
  return (sym[c]||c+' ')+(parseFloat(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
};
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const today   = () => new Date().toISOString().slice(0,10);
const daysDiff = d => d ? Math.floor((new Date(d)-new Date())/(1000*86400)) : null;

const isAdvanceTerms = t => {
  if (!t) return false;
  const l = t.toLowerCase();
  return l.includes('advance') || l.includes('cia') || l.includes('cash in advance') ||
         l.includes('cash before shipment') || l.includes('cbs') || l.includes('100%');
};
const isPartialAdvance = t => t && t.toLowerCase().includes('partial advance');
const isNetTerms = t => {
  if (!t) return false;
  const l = t.toLowerCase();
  return l.includes('net ') || l.includes('eom') || l.includes('deferred') ||
         l.includes('consignment') || l.includes('lc') || l.includes('d/p') ||
         l.includes('d/a') || l.includes('bill of exchange');
};

const PAYMENT_METHODS = ['Bank Transfer','NEFT / RTGS','SWIFT / Wire Transfer','UPI','Cheque','Cash','Bank Remittance'];

const isSupplierBankReady = (s) => {
  if (!s) return false;
  const hasBase = !!(s.bank_account_name && s.bank_account_no);
  if (!hasBase) return false;
  return s.type === 'international' ? !!s.bank_swift : !!s.bank_ifsc;
};

// ── PI HTML Generator ─────────────────────────────────────────────────────────
function numToWords(n) {
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function iw(n){if(n<20)return a[n];if(n<100)return b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');if(n<1000)return a[Math.floor(n/100)]+' Hundred'+(n%100?' '+iw(n%100):'');if(n<100000)return iw(Math.floor(n/1000))+' Thousand'+(n%1000?' '+iw(n%1000):'');if(n<10000000)return iw(Math.floor(n/100000))+' Lakh'+(n%100000?' '+iw(n%100000):'');return iw(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+iw(n%10000000):'');}
  const[ip,dp]=n.toFixed(2).split('.');
  return 'INR '+iw(parseInt(ip))+' Rupees'+(parseInt(dp)>0?' and '+iw(parseInt(dp))+' Paise':'')+' Only';
}

function inr(n){return '₹'+parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}

function generatePIHtml(order, customer, settings) {
  const now = new Date().toLocaleDateString('en-IN');
  const piNo = order.pi_no || ('CIFLUX-PI-' + order.id + '-' + new Date().getFullYear());
  const items = (order.lineItems||[]);
  const coName    = (settings||{}).company_name    || 'Ciflux Electronic Pvt Ltd';
  const coGst     = (settings||{}).company_gstin   || '29AANCC4989N1ZI';
  const coAddr    = (settings||{}).company_address || 'Unit No 203, Oxford Towers, Old Airport Road, Kodihalli';
  const coAddr2   = 'HAL 2nd Stage, Bangalore Karnataka 560008';
  const coEmail   = (settings||{}).company_email   || 'sahitya@cifluxelectronic.com';
  const coPhone   = (settings||{}).company_phone   || '+91 9187675479';
  const coBankName = (settings||{}).bank_name       || 'IDFC First Bank';
  const coBankAcc  = (settings||{}).bank_account_no || '89620003006';
  const coBankHolder=(settings||{}).company_name    || 'Ciflux Electronic Pvt Ltd';
  const coBankIFSC = (settings||{}).bank_ifsc       || 'IDFB0080174';
  const coBankSwift= (settings||{}).bank_swift      || '';
  const custName  = customer?.name || '—';
  const custAddr  = [customer?.billing_attention, customer?.billing_street1, customer?.billing_street2].filter(Boolean).join(', ') || '—';
  const isIntl = (customer?.customer_scope || '').toLowerCase() === 'international';
  const custTaxLabel = isIntl ? 'VAT No:' : 'GST No:';
  const custTaxNo = isIntl ? (customer?.vat_number || '—') : (customer?.gstin || '—');
  const custPhone = customer?.work_phone || customer?.mobile || customer?.phone || customer?.billing_phone || '—';
  const total     = items.reduce((s,li)=>{const b=(li.qty||0)*(li.unit_price||0);return s+b+b*((li.tax_rate||0)/100);},0);
  const baseTotal = items.reduce((s,li)=>s+(li.qty||0)*(li.unit_price||0),0);
  const gstTotal  = total - baseTotal;

  const itemRows = items.map((li,i) => {
    const base = (li.qty||0)*(li.unit_price||0);
    const gst  = base*((li.tax_rate||0)/100);
    const desc = [li.component, li.manufacturer?'— '+li.manufacturer:'', li.ipn?'('+li.ipn+')':''].filter(Boolean).join(' ');
    return `<tr>
      <td style="text-align:center">${i+1}</td>
      <td>${desc}</td>
      <td style="text-align:center">${li.hsn_code||''}</td>
      <td style="text-align:center">${li.qty||0}</td>
      <td style="text-align:right">${inr(li.unit_price)}</td>
      <td style="text-align:right">${inr(base)}</td>
      <td style="text-align:center">${li.tax_rate||18}%</td>
      <td style="text-align:right">${inr(gst)}</td>
      <td style="text-align:right">${inr(base+gst)}</td>
    </tr>`;
  }).join('');

  const custAddr2 = [customer?.billing_city, customer?.billing_state, customer?.billing_pincode, customer?.billing_country].filter(Boolean).join(', ') || '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Proforma Invoice — ${piNo}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:10px;color:#111;padding:24px;background:#fff}
    .no-print{background:#1b4f9e;color:#fff;padding:8px 14px;margin-bottom:16px;border-radius:4px;display:flex;align-items:center;justify-content:space-between}
    .pi-header{width:100%;border-collapse:collapse;margin-bottom:0}
    .pi-header td{padding:3px 6px;vertical-align:top}
    .pi-title{font-size:15px;font-weight:800;color:#1b4f9e;background:#eff6ff;text-align:center;padding:8px;border:1px solid #bfdbfe}
    .co-name{font-size:12px;font-weight:800;color:#1b4f9e}
    .co-detail{font-size:8.5px;color:#4b5563;line-height:1.5}
    .ref-table{width:100%;border-collapse:collapse}
    .ref-table td{padding:2px 6px;font-size:9px;border:1px solid #d1d5db}
    .ref-label{font-weight:700;background:#f9fafb;width:40%}
    .section-header{background:#374151;color:#fff;font-weight:700;text-align:center;padding:5px;font-size:9px}
    .addr-table{width:100%;border-collapse:collapse;border:1px solid #d1d5db}
    .addr-table td{padding:3px 8px;font-size:9px;border:1px solid #d1d5db;vertical-align:top}
    .addr-label{font-weight:700;background:#f9fafb;width:22%}
    .items-table{width:100%;border-collapse:collapse;margin-top:8px}
    .items-table th{background:#374151;color:#fff;padding:6px 4px;border:1px solid #000;font-size:8.5px;text-align:center}
    .items-table td{padding:5px 4px;border:1px solid #d1d5db;font-size:9px;vertical-align:top}
    .total-row td{background:#eff6ff;font-weight:700;font-size:10px;border:1px solid #000}
    .words-row{background:#f9fafb;font-style:italic;font-weight:700;font-size:8.5px;padding:5px 8px;border:1px solid #d1d5db}
    .tc-table{width:100%;border-collapse:collapse;margin-top:8px}
    .tc-table td{padding:3px 8px;font-size:8.5px;border:1px solid #d1d5db;vertical-align:top}
    .sig-area{margin-top:24px;display:flex;justify-content:flex-end}
    .sig-box{text-align:center;min-width:160px}
    .sig-line{border-top:1px solid #000;padding-top:4px;margin-top:32px;font-size:8.5px}
    @media print{.no-print{display:none}body{padding:12px}}
  </style></head><body>
  <div class="no-print">
    <span>📄 Proforma Invoice — ${piNo}</span>
    <button onclick="window.print()" style="background:#fff;color:#1b4f9e;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print / Save PDF</button>
  </div>

  <!-- HEADER: Logo + Company + PI details -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <tr>
      <td style="width:72px;padding:0 10px 0 0;border:none;vertical-align:middle">
        <img src="/logo.png" style="height:52px;width:auto;display:block" alt="CIFLUX"
          onerror="this.style.display='none'" />
      </td>
      <td style="width:55%;vertical-align:top;padding:4px 8px 4px 0;border:none">
        <div class="co-name">${coName}</div>
        <div class="co-detail">${coAddr}</div>
        <div class="co-detail">${coAddr2}</div>
        <div class="co-detail">GSTIN: ${coGst}</div>
        <div class="co-detail">Email: ${coEmail} | Phone: ${coPhone}</div>
      </td>
      <td style="width:45%;vertical-align:top;border:none">
        <div class="pi-title">PROFORMA INVOICE</div>
        <table class="ref-table" style="margin-top:4px">
          <tr><td class="ref-label">Proforma Invoice</td><td class="ref-label">PI No.</td><td style="font-weight:700;color:#1b4f9e">${piNo}</td></tr>
          <tr><td class="ref-label">Proforma Date</td><td class="ref-label">Date</td><td>${now}</td></tr>
          <tr><td class="ref-label">Purchase Order</td><td class="ref-label">PO No.</td><td>${order.po_number||'—'}</td></tr>
          <tr><td class="ref-label">PO Date</td><td class="ref-label"></td><td>${now}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- BILL TO / SHIP TO -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <tr>
      <td style="width:50%;padding-right:4px;vertical-align:top">
        <div class="section-header">BILL TO</div>
        <table class="addr-table">
          <tr><td class="addr-label">Customer</td><td>${custName}</td></tr>
          <tr><td class="addr-label">Address</td><td>${custAddr}${custAddr2?'<br/>'+custAddr2:''}</td></tr>
          <tr><td class="addr-label">${custTaxLabel}</td><td>${custTaxNo}</td></tr>
          <tr><td class="addr-label">Contact No:</td><td>${custPhone}</td></tr>
        </table>
      </td>
      <td style="width:50%;padding-left:4px;vertical-align:top">
        <div class="section-header">SHIP TO</div>
        <table class="addr-table">
          <tr><td class="addr-label">Customer</td><td>${custName}</td></tr>
          <tr><td class="addr-label">Address</td><td>${custAddr}${custAddr2?'<br/>'+custAddr2:''}</td></tr>
          <tr><td class="addr-label">${custTaxLabel}</td><td>${custTaxNo}</td></tr>
          <tr><td class="addr-label">Contact No:</td><td>${custPhone}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- LINE ITEMS -->
  <table class="items-table">
    <thead><tr>
      <th style="width:4%">Sl</th>
      <th style="width:32%">Component / Description</th>
      <th style="width:9%">HSN Code</th>
      <th style="width:5%">Qty</th>
      <th style="width:11%">Unit Price</th>
      <th style="width:11%">Total Price</th>
      <th style="width:6%">GST %</th>
      <th style="width:10%">GST</th>
      <th style="width:12%">Total Amount</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="5" style="text-align:right;padding-right:8px">TOTAL</td>
        <td style="text-align:right">${inr(baseTotal)}</td>
        <td></td>
        <td style="text-align:right">${inr(gstTotal)}</td>
        <td style="text-align:right;color:#1b4f9e">${inr(total)}</td>
      </tr>
    </tfoot>
  </table>
  <div class="words-row">Amount in Words: ${numToWords(total)}</div>

  <!-- BANK DETAILS -->
  <table class="tc-table" style="margin-top:8px;width:50%;margin-left:auto">
    <tr>
      <td colspan="2" style="background:#374151;color:#fff;font-weight:700;text-align:center;padding:5px">Bank Account Details</td>
    </tr>
    <tr><td style="font-weight:700;background:#f9fafb">Bank Name:</td><td>${coBankName}</td></tr>
    <tr><td style="font-weight:700;background:#f9fafb">Account Number:</td><td>${coBankAcc}</td></tr>
    <tr><td style="font-weight:700;background:#f9fafb">Account Name:</td><td>${coBankHolder}</td></tr>
    <tr><td style="font-weight:700;background:#f9fafb">Branch / IFSC Code:</td><td>${coBankIFSC}</td></tr>
    ${coBankSwift ? `<tr><td style="font-weight:700;background:#f9fafb">SWIFT Code:</td><td>${coBankSwift}</td></tr>` : ''}
  </table>

  <div class="sig-area">
    <div class="sig-box">
      <div style="font-size:9px;font-weight:700">For ${coName}</div>
      <div class="sig-line">Authorised Signatory</div>
    </div>
  </div>
  </body></html>`;
}

function HistoryDetailModal({ detail, onClose }) {
  if (!detail) return null;
  const item = detail.item || {};
  const type = detail.type;

  const rows = type === 'customer'
    ? [
        ['Order', item.order_id || '—'],
        ['Customer', item.customer_name || item.customer_id || '—'],
        ['Customer PO Number', item.po_number || '—'],
        ['PI Number', item.pi_no || '—'],
        ['Amount', fmtM(item.amount, item.currency)],
        ['Method', item.payment_method || '—'],
        ['Reference', item.payment_ref || '—'],
        ['Payment Date', fmtDate(item.payment_date)],
        ['Recorded At', fmtDate(item.recorded_at)],
        ['Status', item.status || '—'],
        ['Notes', item.notes || '—'],
      ]
    : [
        ['Order', item.linked_order_id || item.order_id || '—'],
        ['Supplier', item.supplier_name || item.supplier_id || '—'],
        ['Internal PO', item.internal_po_no || item.supplier_order_id || '—'],
        ['Customer PO Ref', item.po_no || '—'],
        ['Supplier PI / Ref', item.supplier_ref || '—'],
        ['Amount', fmtM(item.paid_amount || item.amount, item.confirmed_currency || item.currency || 'INR')],
        ['Reference', item.payment_ref || '—'],
        ['Payment Date', fmtDate(item.payment_date)],
        ['Paid At', fmtDate(item.paid_at)],
        ['Status', item.status || '—'],
        ['Notes', item.notes || '—'],
      ];

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{type === 'customer' ? '🧾 Customer Receipt Details' : '💸 Supplier Payment Details'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{display:'grid',gap:8}}>
          {rows.map(([k, v]) => (
            <div key={k} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
              <span style={{fontSize:12,color:'var(--text3)',fontWeight:600}}>{k}</span>
              <span style={{fontSize:12,fontWeight:600,textAlign:'right'}}>{v}</span>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── View Payment Modal — read-only with manager-approved edit ─────────────────
function ViewPaymentModal({ item, onClose, onSaved }) {
  const qc = useQueryClient();
  const [editMode, setEditMode]   = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalErr, setApprovalErr] = useState('');
  const pmt = item.last_payment || null;

  const [form, setForm] = useState({
    amount:         String(pmt?.amount || ''),
    currency:       pmt?.currency      || 'INR',
    payment_method: pmt?.payment_method|| '',
    payment_ref:    pmt?.payment_ref   || '',
    payment_date:   pmt?.payment_date  || '',
    notes:          pmt?.notes         || '',
    approver_username: '',
    approver_password: '',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const editMutation = useMutation({
    mutationFn: d => api.put('/finance/customer-pay/'+pmt.id, d),
    onSuccess: () => {
      toast.success('Payment updated');
      qc.invalidateQueries(['finance-customer']);
      onSaved();
    },
    onError: e => {
      setApprovalErr(e.response?.data?.error || 'Failed');
      setApproving(false);
    },
  });

  if (!pmt) return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header"><h2>Payment Details</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body" style={{padding:24,textAlign:'center',color:'var(--text3)'}}>No payment recorded yet.</div>
        <div className="modal-footer"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );

  const rows = [
    {l:'Customer PO Number', v: item.po_number || '—', mono:true},
    {l:'PI Number',      v: item.pi_no || '—', mono:true, highlight: !!item.pi_no},
    {l:'Amount',         v: fmtM(pmt.amount, pmt.currency)},
    {l:'Method',         v: pmt.payment_method || '—'},
    {l:'UTR / Ref',      v: pmt.payment_ref    || '—', mono:true},
    {l:'Payment Date',   v: fmtDate(pmt.payment_date)},
    {l:'Recorded By',    v: pmt.recorded_by    || '—'},
    {l:'Recorded At',    v: fmtDate(pmt.recorded_at)},
    {l:'Notes',          v: pmt.notes          || '—'},
  ];

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{editMode ? '✏ Edit Payment' : '💳 Payment Details'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Order ref strip */}
          <div style={{padding:'8px 12px',borderRadius:6,background:'var(--accent-lt)',
            fontSize:12,marginBottom:14,fontWeight:600,color:'var(--accent)'}}>
            {item.id} · {item.customer?.name || ''}
          </div>

          {!editMode ? (
            /* ── VIEW mode ── */
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {rows.map(r=>(
                <div key={r.l} style={{display:'flex',justifyContent:'space-between',
                  padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{fontSize:12,color:'var(--text3)',fontWeight:600}}>{r.l}</span>
                  <span style={{fontSize:13,fontFamily:r.mono?'monospace':'inherit',
                    fontWeight:r.l==='Amount'||r.highlight?700:400,
                    color:r.highlight?'var(--green)':undefined}}>{r.v}</span>
                </div>
              ))}
            </div>
          ) : (
            /* ── EDIT mode ── */
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Amount</label>
                  <input className="input" type="number" step="0.01" value={form.amount}
                    onChange={e=>set('amount',e.target.value)}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Currency</label>
                  <select className="input" value={form.currency} onChange={e=>set('currency',e.target.value)}>
                    {['INR','USD','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Method</label>
                  <select className="input" value={form.payment_method} onChange={e=>set('payment_method',e.target.value)}>
                    <option value="">— Select —</option>
                    {['NEFT','RTGS','IMPS','Cheque','SWIFT','Cash','UPI','Card','Wire Transfer'].map(m=><option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Payment Date</label>
                  <input className="input" type="date" value={form.payment_date}
                    max={today()} onChange={e=>set('payment_date',e.target.value)}/>
                </div>
                <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
                  <label className="label">UTR / Ref No.</label>
                  <input className="input" value={form.payment_ref}
                    onChange={e=>set('payment_ref',e.target.value)}/>
                </div>
                <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
                  <label className="label">Notes</label>
                  <input className="input" value={form.notes} onChange={e=>set('notes',e.target.value)}/>
                </div>
              </div>
              {/* Manager approval section */}
              <div style={{padding:'12px',borderRadius:8,background:'var(--surface2)',
                border:'1px solid var(--border)',marginTop:4}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:10,letterSpacing:.5}}>
                  FINANCE MANAGER APPROVAL REQUIRED
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">Manager Username</label>
                    <input className="input" value={form.approver_username}
                      onChange={e=>set('approver_username',e.target.value)}
                      placeholder="username or email"
                      autoComplete="off"/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="label">Password</label>
                    <input className="input" type="password" value={form.approver_password}
                      onChange={e=>set('approver_password',e.target.value)}
                      autoComplete="new-password"/>
                  </div>
                </div>
                {approvalErr && (
                  <div style={{marginTop:8,fontSize:12,color:'var(--red)',fontWeight:600}}>
                    ✗ {approvalErr}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!editMode ? (
            <>
              <button className="btn btn-sm" style={{marginRight:'auto'}}
                onClick={()=>{ setEditMode(true); setApprovalErr(''); }}>
                ✏ Edit Payment
              </button>
              <button className="btn" onClick={onClose}>Close</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={()=>{ setEditMode(false); setApprovalErr(''); }}>
                Cancel
              </button>
              <button className="btn btn-primary"
                disabled={editMutation.isPending || !form.approver_username || !form.approver_password}
                onClick={()=>{ setApprovalErr(''); editMutation.mutate(form); }}>
                {editMutation.isPending ? 'Verifying…' : '✅ Save with Approval'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Record Payment Modal ──────────────────────────────────────────────────────
function RecordPaymentModal({ item, type, onClose, onSaved }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const netAmount = type === 'supplier-net'
    ? String(Math.max(0, (parseFloat(item.confirmed_price)||0) - (parseFloat(item.net_total_paid)||0)) || item.confirmed_price || '')
    : '';
  const custDefaultAmt = type === 'customer'
    ? String(Math.min(parseFloat(item.balance_due)||0, parseFloat(item.order_total)||0) || parseFloat(item.order_total)||'')
    : '';
  const [form, setForm] = useState({
    amount: type === 'customer' ? custDefaultAmt : type === 'supplier-net' ? netAmount : String(item.amount||''),
    currency: type === 'customer' ? 'INR' : (item.confirmed_currency||item.currency||'INR'),
    payment_method: '', payment_ref: '', payment_date: today(), notes: '',
    customer_po_no: type === 'customer' ? (item.po_number || '') : '',
    zoho_po_number: item.zoho_po_number || '',
    supplier_ref: item.supplier_ref || '',
    payment_type: isPartialAdvance(item.payment_terms) ? 'partial_advance' : 'advance',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const mutation = useMutation({
    mutationFn: d => type === 'customer'
      ? api.post('/finance/customer-pay/'+item.id, d)
      : type === 'supplier-advance'
        ? api.put('/finance/supplier-pay/'+item.id, d)
        : api.put('/finance/supplier-net-pay/'+(item.supplier_order_id||item.id), d),
    onSuccess: () => {
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-supplier']);
      qc.invalidateQueries(['finance-history']);
      toast.success('✅ Payment recorded!');
      onSaved();
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error||'Failed'),
  });

  const label = type === 'customer' ? (item.customer?.name||item.customer_id) : (item._resolvedName || item.supplier?.name || item.supplier_id);
  const refNo = type === 'customer' ? item.id : (item.internal_po_no||item.supplier_order_id||item.id);

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>💳 Record Payment</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{padding:'10px 14px',borderRadius:'var(--r-sm)',background:'var(--accent-lt)',
            border:'1px solid var(--accent)33',fontSize:12,marginBottom:14}}>
            <div style={{fontWeight:700}}>{label}</div>
            <div style={{color:'var(--text2)',marginTop:2}}>Ref: {refNo} · Terms: {item.payment_terms||item.terms||'—'}</div>
          </div>

          {type === 'customer' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Customer PO Number</label>
                <input className="input" value={form.customer_po_no}
                  onChange={e=>set('customer_po_no', e.target.value)}
                  placeholder="Enter customer PO manually"/>
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Order ID</label>
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',
                  borderRadius:'var(--r-sm)',background:'var(--surface2)',
                  border:'1px solid var(--border)',fontSize:13,fontFamily:'DM Mono,monospace',fontWeight:700}}>
                  {item.id || '—'}
                </div>
              </div>
            </div>
          )}

          {type !== 'customer' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Zoho PO Number <span className="req">*</span></label>
                <input className="input" value={form.zoho_po_number}
                  onChange={e=>set('zoho_po_number', e.target.value)}
                  placeholder="Enter Zoho PO number"
                  style={{borderColor:!form.zoho_po_number?.trim()?'var(--amber,#d97706)':undefined}}/>
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Supplier PI Number <span className="req">*</span></label>
                <input className="input" value={form.supplier_ref}
                  onChange={e=>set('supplier_ref', e.target.value)}
                  placeholder="Enter supplier PI / reference"
                  style={{borderColor:!form.supplier_ref?.trim()?'var(--amber,#d97706)':undefined}}/>
              </div>
            </div>
          )}

          {/* PI Number — auto-fetched, read-only, customer payments only */}
          {type === 'customer' && (
            <div className="form-group" style={{marginBottom:12}}>
              <label className="label">PI Number</label>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',
                borderRadius:'var(--r-sm)',background:'var(--surface2)',
                border:'1px solid var(--border)',fontSize:13}}>
                {item.pi_no
                  ? <><span style={{fontFamily:'DM Mono,monospace',fontWeight:700,color:'var(--green)',letterSpacing:'0.02em'}}>{item.pi_no}</span>
                      <span style={{fontSize:11,color:'var(--green)',fontWeight:600}}>✅ PI Generated</span></>                  
                  : <span style={{color:'var(--amber,#d97706)',fontWeight:600,fontSize:12}}>⚠ PI not yet generated — generate PI before recording payment</span>
                }
              </div>
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Amount <span className="req">*</span></label>
              {(type === 'customer' || type === 'supplier-net') ? (
                <div style={{padding:'8px 12px',borderRadius:'var(--r-sm)',background:'var(--surface2)',
                  border:'1px solid var(--border)',fontSize:13,fontFamily:'DM Mono,monospace',fontWeight:700}}>
                  {fmtM(parseFloat(form.amount)||0, form.currency)}
                </div>
              ) : (
                <input className="input" type="number" step="0.01" value={form.amount}
                  onChange={e=>set('amount',e.target.value)} placeholder="0.00"/>
              )}
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Currency</label>
              <select className="input" value={form.currency} onChange={e=>set('currency',e.target.value)}>
                {['INR','USD','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Payment Method <span className="req">*</span></label>
              <select className="input" value={form.payment_method} onChange={e=>set('payment_method',e.target.value)}
                style={{borderColor:!form.payment_method?'var(--amber,#d97706)':undefined}}>
                <option value="">— Select —</option>
                {PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Payment Date</label>
              <input className="input" type="date" value={form.payment_date} max={today()} onChange={e=>set('payment_date',e.target.value)}/>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
              <label className="label">UTR / Ref No. <span className="req">*</span></label>
              <input className="input" value={form.payment_ref} onChange={e=>set('payment_ref',e.target.value)}
                placeholder="UTR / Cheque No / SWIFT Ref"
                style={{borderColor:!form.payment_ref?'var(--amber,#d97706)':undefined}}/>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1',marginBottom:0}}>
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={e=>set('notes',e.target.value)}
                placeholder="e.g. NEFT confirmation received"/>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            disabled={mutation.isPending||!form.payment_method||!form.payment_ref||!form.amount||(type!=='customer'&&(!form.zoho_po_number?.trim()||!form.supplier_ref?.trim()))}
            onClick={()=>mutation.mutate({
              ...form,
              finance_po_no: '',
            })}>
            {mutation.isPending ? 'Saving…' : '✅ Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomerBankDetailsModal({ customer, onClose, onSaved }) {
  const qc = useQueryClient();
  const intl = customer?.type === 'international';
  const [form, setForm] = useState({
    bank_account_name: customer?.bank_account_name || '',
    bank_account_no:   customer?.bank_account_no   || '',
    bank_ifsc:         customer?.bank_ifsc         || '',
    bank_name:         customer?.bank_name         || '',
    bank_branch:       customer?.bank_branch       || '',
    bank_swift:        customer?.bank_swift        || '',
    bank_iban:         customer?.bank_iban         || '',
    bank_aba:          customer?.bank_aba          || '',
    bank_country:      customer?.bank_country      || 'India',
    bank_currency:     customer?.bank_currency     || 'INR',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const custListRes = await api.get('/customers');
      const fullCustomer = (custListRes.data || []).find(c => c.id === customer.id);
      if (!fullCustomer) throw new Error('Customer not found');
      await api.put('/customers/' + customer.id, { ...fullCustomer, ...form });
    },
    onSuccess: () => {
      qc.invalidateQueries(['customers']);
      qc.invalidateQueries(['finance-supplier']);
      toast.success('Bank details saved for customer');
      onSaved?.();
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to save bank details'),
  });

  const missingRequired = !form.bank_account_name?.trim() || !form.bank_account_no?.trim() || (!intl && !form.bank_ifsc?.trim());

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:920,width:'96vw'}}>
        <div className="modal-header">
          <h2>🏦 Bank Details — {customer?.name || 'Customer'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏦 {intl?'Primary Bank':'Indian Bank Details'}</div>
            <div className="form-group"><label className="label">Account Holder Name <span className="req">*</span></label><input className="input" value={form.bank_account_name} onChange={e=>set('bank_account_name',e.target.value)}/></div>
            <div className="form-group"><label className="label">Account Number <span className="req">*</span></label><input className="input" value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></div>
            <div className="form-group"><label className="label">Bank Name</label><input className="input" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></div>
            <div className="form-group"><label className="label">Branch</label><input className="input" value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)}/></div>
            {!intl&&<div className="form-group"><label className="label">IFSC Code <span className="req">*</span></label><input className="input" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())} placeholder="HDFC0001234"/></div>}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div className="form-group"><label className="label">Currency</label>
                <select className="input" value={form.bank_currency} onChange={e=>set('bank_currency',e.target.value)}>
                  {['INR','USD','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">Bank Country</label>
                <input className="input" value={form.bank_country} onChange={e=>set('bank_country',e.target.value)} placeholder="India"/>
              </div>
            </div>
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🌐 International Wire</div>
            <div className="form-group"><label className="label">SWIFT / BIC Code</label><input className="input" value={form.bank_swift} onChange={e=>set('bank_swift',e.target.value.toUpperCase())} placeholder="HDFCINBBXXX"/></div>
            <div className="form-group"><label className="label">IBAN</label><input className="input" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value.toUpperCase())}/></div>
            <div className="form-group"><label className="label">ABA / Routing (USA)</label><input className="input" value={form.bank_aba} onChange={e=>set('bank_aba',e.target.value)}/></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending || missingRequired} onClick={()=>mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save Bank Details'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SupplierBankDetailsModal({ supplier, onClose, onSaved }) {
  const qc = useQueryClient();
  const intl = supplier?.type === 'international';
  const [form, setForm] = useState({
    bank_account_name: supplier?.bank_account_name || '',
    bank_account_no: supplier?.bank_account_no || '',
    bank_ifsc: supplier?.bank_ifsc || '',
    bank_name: supplier?.bank_name || '',
    bank_branch: supplier?.bank_branch || '',
    bank_swift: supplier?.bank_swift || '',
    bank_iban: supplier?.bank_iban || '',
    bank_aba: supplier?.bank_aba || '',
    bank_country: supplier?.bank_country || (intl ? '' : 'India'),
    bank_currency: supplier?.bank_currency || (intl ? (supplier?.currency || 'USD') : 'INR'),
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      // Try suppliers first; fall back to customers (inventory-customer sources)
      const supListRes = await api.get('/suppliers');
      const fullSupplier = (supListRes.data || []).find(s => s.id === supplier.id);
      if (fullSupplier) {
        await api.put('/suppliers/' + supplier.id, { ...fullSupplier, ...form });
      } else {
        const custListRes = await api.get('/customers');
        const fullCustomer = (custListRes.data || []).find(c => c.id === supplier.id);
        if (!fullCustomer) throw new Error('Entity not found — cannot save bank details');
        await api.put('/customers/' + supplier.id, { ...fullCustomer, ...form });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(['suppliers']);
      qc.invalidateQueries(['customers']);
      qc.invalidateQueries(['finance-supplier']);
      toast.success('Bank details saved');
      onSaved?.();
      onClose();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to save bank details'),
  });

  const missingRequired = !form.bank_account_name?.trim() || !form.bank_account_no?.trim() || (!intl && !form.bank_ifsc?.trim()) || (intl && !form.bank_swift?.trim());

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:920,width:'96vw'}}>
        <div className="modal-header">
          <h2>🏦 Add Bank Details</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏦 {intl?'Primary Bank':'Indian Bank Details'}</div>
            <div className="form-group"><label className="label">Account Holder Name {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_name} onChange={e=>set('bank_account_name',e.target.value)}/></div>
            <div className="form-group"><label className="label">Account Number {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></div>
            <div className="form-group"><label className="label">Bank Name</label><input className="input" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></div>
            <div className="form-group"><label className="label">Branch</label><input className="input" value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)}/></div>
            {!intl&&<div className="form-group"><label className="label">IFSC Code <span className="req">*</span></label><input className="input" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())} placeholder="HDFC0001234"/></div>}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div className="form-group"><label className="label">Currency</label>
                <select className="input" value={form.bank_currency} onChange={e=>set('bank_currency',e.target.value)}>
                  {['INR','USD','EUR','SGD','GBP'].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">Bank Country</label>
                <input className="input" value={form.bank_country} onChange={e=>set('bank_country',e.target.value)} placeholder="India"/>
              </div>
            </div>
          </div>

          <div>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🌐 International Wire</div>
            <div className="form-group"><label className="label">SWIFT / BIC Code {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_swift} onChange={e=>set('bank_swift',e.target.value.toUpperCase())} placeholder="HDFCINBBXXX"/></div>
            <div className="form-group"><label className="label">IBAN {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value.toUpperCase())} placeholder="GB29 NWBK 6016 1331 9268 19"/></div>
            <div className="form-group"><label className="label">ABA / Routing (USA)</label><input className="input" value={form.bank_aba} onChange={e=>set('bank_aba',e.target.value)} placeholder="021000021"/></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending || missingRequired} onClick={()=>mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save Bank Details'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status badge helpers ───────────────────────────────────────────────────────
function DueBadge({ daysLeft }) {
  if (daysLeft === null) return null;
  if (daysLeft < 0)  return <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:700,background:'var(--red-lt,#fef2f2)',color:'var(--red)'}}>⚠ {Math.abs(daysLeft)}d overdue</span>;
  if (daysLeft <= 7) return <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:700,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)'}}>Due in {daysLeft}d</span>;
  return <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'var(--surface2)',color:'var(--text2)'}}>Due in {daysLeft}d</span>;
}

function TermsBadge({ terms }) {
  const color = isAdvanceTerms(terms) ? 'var(--red)' : isPartialAdvance(terms) ? 'var(--amber,#d97706)' : isNetTerms(terms) ? 'var(--accent)' : 'var(--text3)';
  const bg    = isAdvanceTerms(terms) ? 'var(--red-lt,#fef2f2)' : isPartialAdvance(terms) ? 'var(--amber-lt,#fffbeb)' : isNetTerms(terms) ? 'var(--accent-lt)' : 'var(--surface2)';
  return <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:bg,color}}>{terms||'—'}</span>;
}

// ── PO Requests Tab — Finance fills in Supplier PI + Zoho PO for Procurement ──
function PORequestsTab({ requests, onRefresh }) {
  const qc = useQueryClient();
  const [fulfillModal, setFulfillModal] = useState(null); // the po_request row
  const pending   = requests.filter(r => r.status === 'pending');
  const fulfilled = requests.filter(r => r.status === 'fulfilled');

  return (
    <div>
      <div style={{marginBottom:10,fontSize:12,color:'var(--text3)'}}>
        Procurement has requested PO details for these orders. For advance payment terms, both Supplier PI and Zoho PO are required. For other terms, only Zoho PO is required.
        Submit — details will auto-populate in Procurement's PO Allocation.
      </div>
      {pending.length === 0 ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
          <div style={{fontSize:32,marginBottom:8}}>✅</div>No pending PO requests
        </div>
      ) : (
        <table className="table">
          <thead><tr>
            <th>Order</th><th>Supplier</th><th>PO Ref</th>
            <th>Requested By</th><th>Requested At</th>
            <th style={{textAlign:'right'}}>Actions</th>
          </tr></thead>
          <tbody>
            {pending.map(r => (
              <tr key={r.id}>
                <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{r.order_id}</span></td>
                <td style={{fontWeight:500}}>{r.supplier_name||r.supplier_id}</td>
                <td style={{fontSize:11,color:'var(--text3)'}}>{r.order_ref||'—'}</td>
                <td style={{fontSize:11}}>{r.requested_by||'—'}</td>
                <td style={{fontSize:11}}>{fmtDate(r.requested_at)}</td>
                <td style={{textAlign:'right'}}>
                  <button className="btn btn-xs btn-primary"
                    style={{fontSize:11}}
                    onClick={()=>setFulfillModal(r)}>
                    ✏ Fill in Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {fulfilled.length > 0 && (
        <div style={{marginTop:24}}>
          {(() => {
            // Deduplicate: keep only the latest fulfilled entry per order+supplier
            const dedupMap = {};
            fulfilled.forEach(r => {
              const key = (r.order_id||'') + '_' + (r.supplier_id||r.supplier_name||'');
              if (!dedupMap[key] || new Date(r.fulfilled_at||0) > new Date(dedupMap[key].fulfilled_at||0)) {
                dedupMap[key] = r;
              }
            });
            const deduped = Object.values(dedupMap).sort((a,b) => new Date(b.fulfilled_at||0) - new Date(a.fulfilled_at||0));
            return (
          <>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'var(--green)'}}>
            ✅ Fulfilled Requests ({deduped.length})
          </div>
          <table className="table">
            <thead><tr>
              <th>Order</th><th>Supplier</th><th>Supplier PI</th><th>Zoho PO</th>
              <th>Fulfilled By</th><th>Date</th>
            </tr></thead>
            <tbody>
              {deduped.slice(0,50).map(r=>(
                <tr key={r.id}>
                  <td><span className="mono" style={{fontSize:11,color:'var(--accent)'}}>{r.order_id}</span></td>
                  <td>{r.supplier_name||r.supplier_id}</td>
                  <td><span className="mono" style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:600}}>{r.supplier_ref||'—'}</span></td>
                  <td><span className="mono" style={{fontSize:11,fontWeight:600}}>{r.zoho_po_number||'—'}</span></td>
                  <td style={{fontSize:11}}>{r.fulfilled_by||'—'}</td>
                  <td style={{fontSize:11}}>{fmtDate(r.fulfilled_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
            );
          })()}
        </div>
      )}

      {/* Fulfill Modal */}
      {fulfillModal && (
        <FulfillPORequestModal
          request={fulfillModal}
          onClose={()=>setFulfillModal(null)}
          onSaved={()=>{ setFulfillModal(null); qc.invalidateQueries(['po-requests']); onRefresh(); }}
        />
      )}
    </div>
  );
}

function FulfillPORequestModal({ request, onClose, onSaved }) {
  const isAdvance = (request.payment_terms_type==='advance'||request.payment_terms_type==='split');
  const [form, setForm] = useState({ supplier_ref: '', zoho_po_number: '' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const mutation = useMutation({
    mutationFn: d => api.put('/po-requests/' + request.id, d),
    onSuccess: () => { toast.success('✅ Details saved — Procurement will see them automatically!'); onSaved(); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const canSubmit = isAdvance
    ? !mutation.isPending && form.supplier_ref.trim() && form.zoho_po_number.trim()
    : !mutation.isPending && form.zoho_po_number.trim();

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>📋 Fill PO Details</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{padding:'10px 14px',borderRadius:6,background:'var(--accent-lt)',
            fontSize:12,marginBottom:16,fontWeight:600}}>
            <div>{request.order_id} · {request.supplier_name||request.supplier_id}</div>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>
              Requested by {request.requested_by} on {fmtDate(request.requested_at)}
            </div>
          </div>
          {isAdvance && (
            <div className="form-group">
              <label className="label">Supplier PI Number <span className="req">*</span></label>
              <input className="input" value={form.supplier_ref}
                onChange={e=>set('supplier_ref',e.target.value)}
                placeholder="e.g. PI-2026-00123"
                style={{borderColor:!form.supplier_ref?'var(--amber,#d97706)':undefined}}/>
              <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>
                The Proforma Invoice number provided by the supplier
              </div>
            </div>
          )}
          <div className="form-group" style={{marginBottom:0}}>
            <label className="label">Zoho PO Number <span className="req">*</span></label>
            <input className="input" value={form.zoho_po_number}
              onChange={e=>set('zoho_po_number',e.target.value)}
              placeholder="e.g. PO-20001"
              style={{borderColor:!form.zoho_po_number?'var(--amber,#d97706)':undefined}}/>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>
              The PO number from Zoho Books
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            disabled={!canSubmit}
            onClick={()=>mutation.mutate(form)}>
            {mutation.isPending ? 'Saving…' : '✅ Save & Send to Procurement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Finance Page ─────────────────────────────────────────────────────────
export default function FinancePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // BUG2 FIX: read ?tab from URL so Procurement can land on sup-advance directly
  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('tab');
    return p || 'cust-advance';
  });
  const [payModal,     setPayModal]     = useState(null);  // { item, type }
  const [viewPayModal, setViewPayModal] = useState(null); // { item } — view/edit recorded payment
  const [bankModal, setBankModal] = useState(null); // { supplier }
  const [customerBankModal, setCustomerBankModal] = useState(null); // customer object
  const [releaseConfirm, setReleaseConfirm] = useState(null); // order to release
  const [search, setSearch]   = useState('');
  const [historyDetail, setHistoryDetail] = useState(null);
  const [historyFilter, setHistoryFilter] = useState({ query:'', method:'all', from:'', to:'' });

  const releaseMutation = useMutation({
    mutationFn: orderId => api.post('/finance/customer-release/' + orderId),
    onSuccess: () => {
      qc.invalidateQueries(['finance-customer']);
      qc.invalidateQueries(['finance-history']);
      toast.success('✅ Payment released — order moved to procurement');
      setReleaseConfirm(null);
      setTab('history');
    },
    onError: e => toast.error(e.response?.data?.error || 'Release failed'),
  });

  const { data: custQueueRaw=[], isLoading: custLoading }   = useQuery({ queryKey:['finance-customer'], queryFn:()=>api.get('/finance/customer-queue').then(r=>r.data).catch(()=>[]), refetchInterval:30000 });
  const { data: supQueueRaw={advance:[],net:[]}, isLoading: supLoading } = useQuery({ queryKey:['finance-supplier'], queryFn:()=>api.get('/finance/supplier-queue').then(r=>r.data).catch(()=>({advance:[],net:[]})), refetchInterval:30000 });
  const { data: historyRaw={customer:[],supplier:[]} }      = useQuery({ queryKey:['finance-history'], queryFn:()=>api.get('/finance/history').then(r=>r.data).catch(()=>({customer:[],supplier:[]})) });
  const { data: poRequestsRaw=[] }                          = useQuery({ queryKey:['po-requests'], queryFn:()=>api.get('/po-requests').then(r=>r.data).catch(()=>[]), refetchInterval:15000 });
  // FIX: defensive guards — ensure arrays even if server returns error object before migrations run
  const custQueue = Array.isArray(custQueueRaw) ? custQueueRaw : [];
  const supQueue  = (supQueueRaw && typeof supQueueRaw === 'object' && !Array.isArray(supQueueRaw)) ? supQueueRaw : {advance:[],net:[]};
  const history   = (historyRaw && typeof historyRaw === 'object' && !Array.isArray(historyRaw)) ? historyRaw : {customer:[],supplier:[]};
  const poRequests = Array.isArray(poRequestsRaw) ? poRequestsRaw : [];
  const pendingPORequests = poRequests.filter(r => r.status === 'pending');
  const { data: settings={} }                            = useQuery({ queryKey:['settings'], queryFn:()=>api.get('/settings').then(r=>r.data).catch(()=>({})) });
  const { data: suppliers=[] }                           = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data).catch(()=>[]) });
  const { data: customers=[] }                           = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: inventoryItems=[] }                      = useQuery({ queryKey:['inventory'],  queryFn:()=>api.get('/inventory').then(r=>r.data).catch(()=>[]) });

  // Resolve the real entity (customer or supplier) behind a supplier_id (including __inv__ ones)
  const resolveFinanceSupplier = (supplierId) => {
    if (!supplierId) return { entity: null, entityType: 'supplier', displayName: '—' };
    if (supplierId.startsWith('__inv__')) {
      const inv = inventoryItems.find(i => i.id === supplierId.slice(7));
      if (inv?.holder_type === 'customer') {
        const cust = customers.find(c => c.id === inv.holder_id);
        return { entity: cust || { id: inv.holder_id, name: inv.holder_name || supplierId }, entityType: 'customer', displayName: cust?.name || inv.holder_name || supplierId };
      }
      if (inv?.holder_type === 'supplier') {
        const sup = suppliers.find(s => s.id === inv.holder_id);
        return { entity: sup || { id: inv.holder_id, name: inv.holder_name || supplierId }, entityType: 'supplier', displayName: sup?.name || inv.holder_name || supplierId };
      }
      return { entity: null, entityType: 'supplier', displayName: supplierId };
    }
    const sup = suppliers.find(s => s.id === supplierId);
    return { entity: sup || null, entityType: 'supplier', displayName: sup?.name || supplierId };
  };

  // Separate customer queue by type
  // FIX 4: also include payment_approval status orders even if payment_terms not yet saved
  const custAdvance = custQueue.filter(o =>
    o.status === 'payment_approval' ||
    isAdvanceTerms(o.payment_terms) ||
    isPartialAdvance(o.payment_terms)
  );
  const custNet     = custQueue.filter(o =>
    o.status !== 'payment_approval' &&
    !isAdvanceTerms(o.payment_terms) &&
    !isPartialAdvance(o.payment_terms) &&
    isNetTerms(o.payment_terms)
  );
  const custOther   = custQueue.filter(o =>
    o.status !== 'payment_approval' &&
    !isAdvanceTerms(o.payment_terms) &&
    !isPartialAdvance(o.payment_terms) &&
    !isNetTerms(o.payment_terms) &&
    o.payment_terms
  );
  const supAdvance  = supQueue.advance || [];
  const supNet      = supQueue.net || [];

  // Stat cards
  const stats = [
    { label:'Customer Advance Due',    val: custAdvance.filter(o=>o.customer_payment_status!=='paid').length,  color:'var(--red)' },
    { label:'Customer Net Due',        val: custNet.filter(o=>o.customer_payment_status!=='paid').length,      color:'var(--amber,#d97706)' },
    { label:'Supplier Advance Blocked',val: supAdvance.length,                                                  color:'var(--red)' },
    { label:'Supplier Net Due',        val: supNet.filter(r=>r.days_due!==null&&r.days_due<=30).length,        color:'var(--amber,#d97706)' },
  ];

  const TABS = [
    { k:'cust-advance', l:`🧾 Customer Advance (${custAdvance.length})` },
    { k:'cust-net',     l:`📅 Customer Net/Other (${custNet.length + custOther.length})` },
    { k:'sup-advance',  l:`💸 Supplier Advance (${supAdvance.length})` },
    { k:'sup-net',      l:`📅 Supplier Net (${supNet.filter(r=>r.status!=='paid').length})` },
    { k:'po-requests',  l:`📋 PO Requests (${pendingPORequests.length})` },
    { k:'history',      l:'✅ History' },
  ];

  const handleGeneratePI = async (order) => {
    try {
      const r = await api.post('/finance/pi/'+order.id);
      const pi_no = r.data.pi_no;
      const full = await api.get('/orders/'+order.id);
      const cust = order.customer;
      const html = generatePIHtml({...full.data, pi_no, payment_terms:order.payment_terms}, cust, settings);
      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();

      qc.invalidateQueries(['finance-customer']);
      toast.success('PI generated — ' + pi_no);
    } catch(e) { toast.error(e.response?.data?.error||'PI generation failed'); }
  };

  const inDateRange = (d) => {
    if (!d) return !historyFilter.from && !historyFilter.to;
    const dt = new Date(d);
    if (historyFilter.from && dt < new Date(historyFilter.from)) return false;
    if (historyFilter.to) {
      const to = new Date(historyFilter.to);
      to.setHours(23,59,59,999);
      if (dt > to) return false;
    }
    return true;
  };

  const hq = (historyFilter.query || '').toLowerCase();
  const filteredCustomerHistory = useMemo(() => {
    return (history.customer || []).filter(p => {
      if (historyFilter.method !== 'all' && (p.payment_method || '').toLowerCase() !== historyFilter.method.toLowerCase()) return false;
      if (!inDateRange(p.payment_date || p.recorded_at)) return false;
      if (!hq) return true;
      return [p.order_id, p.customer_name, p.customer_id, p.po_number, p.finance_po_no, p.pi_no, p.payment_ref, p.payment_method]
        .map(v => (v || '').toLowerCase())
        .some(v => v.includes(hq));
    });
  }, [history.customer, historyFilter, hq]);

  const filteredSupplierHistory = useMemo(() => {
    return (history.supplier || []).filter(p => {
      if (historyFilter.method !== 'all' && (p.payment_method || '').toLowerCase() !== historyFilter.method.toLowerCase()) return false;
      if (!inDateRange(p.payment_date || p.paid_at)) return false;
      if (!hq) return true;
      return [p.linked_order_id, p.order_id, p.supplier_name, p.supplier_id, p.internal_po_no, p.po_no, p.supplier_ref, p.payment_ref]
        .map(v => (v || '').toLowerCase())
        .some(v => v.includes(hq));
    });
  }, [history.supplier, historyFilter, hq]);

  const sq = search.toLowerCase();
  const filterCust = arr => !search ? arr : arr.filter(o =>
    (o.id||'').toLowerCase().includes(sq) ||
    (o.customer?.name||'').toLowerCase().includes(sq) ||
    (o.po_number||'').toLowerCase().includes(sq)
  );
  const filterSup = arr => !search ? arr : arr.filter(r =>
    (r.supplier?.name||'').toLowerCase().includes(sq) ||
    (r.internal_po_no||'').toLowerCase().includes(sq) ||
    (r.order_id||'').toLowerCase().includes(sq)
  );

  return (
    <div>
      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {stats.map(s=>(
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{fontSize:24,color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{marginBottom:12}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
          </svg>
          <input className="search-input" placeholder="Search order ID, customer, PO, supplier…"
            value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:16,flexWrap:'wrap'}}>
        {TABS.map(t=>(
          <div key={t.k} onClick={()=>setTab(t.k)} style={{
            padding:'9px 16px',fontSize:12,fontWeight:600,cursor:'pointer',
            borderBottom:tab===t.k?'2px solid var(--accent)':'2px solid transparent',
            color:tab===t.k?'var(--accent)':'var(--text3)'}}>
            {t.l}
          </div>
        ))}
      </div>

      {/* ── Tab: Customer Advance ── */}
      {tab==='cust-advance' && (
        <div>
          <div style={{marginBottom:10,fontSize:12,color:'var(--text3)'}}>
            Orders with Advance / Partial Advance payment terms — PI must be generated and customer must pay before order is released to Procurement.
          </div>
          {custLoading ? <div style={{padding:30,textAlign:'center',color:'var(--text3)'}}>Loading…</div> :
          filterCust(custAdvance).length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>No pending advance payments
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>Order</th><th>Customer</th><th>PO Context</th><th>Terms</th>
                <th style={{textAlign:'right'}}>Order Total</th>
                <th style={{textAlign:'right'}}>Paid</th>
                <th style={{textAlign:'right'}}>Balance Due</th>
                <th>PI Status</th><th>Order Status</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filterCust(custAdvance).map(o=>(
                  <tr key={o.id}>
                    <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{o.id}</span></td>
                    <td style={{fontWeight:500}}>{o.customer?.name||o.customer_id}</td>
                    <td style={{fontSize:11}}>
                      <div className="mono" style={{fontWeight:700}}>{o.po_number||'—'}</div>
                      <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>Customer PO</div>
                    </td>
                    <td><TermsBadge terms={o.payment_terms}/></td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmtM(o.order_total)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace',color:'var(--green)',fontWeight:600}}>
                      {o.total_paid > 0 ? fmtM(o.total_paid) : '—'}
                    </td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700,
                      color:o.customer_payment_status==='paid'?'var(--green)':o.balance_due>0?'var(--red)':'var(--text3)'}}>
                      {o.customer_payment_status==='paid' ? '✅ Paid' : fmtM(o.balance_due)}
                    </td>
                    <td>
                      {o.pi_no
                        ? <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:'var(--green-lt)',color:'var(--green)',fontWeight:600}}>✅ {o.pi_no}</span>
                        : <span style={{fontSize:11,color:'var(--text3)'}}>Not generated</span>}
                    </td>
                    <td><StatusBadge s={o.status}/></td>
                    <td style={{textAlign:'right'}}>
                      <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                        <button className="btn btn-xs" onClick={()=>handleGeneratePI(o)}
                          style={{fontSize:11}}>📄 {o.pi_no?'Re-print PI':'Generate PI'}</button>
                        {o.customer_payment_status === 'payment_recorded' ? (
                          <>
                            <button className="btn btn-xs" onClick={()=>setViewPayModal({item:o})}
                              style={{fontSize:11}}>👁 View</button>
                            <button className="btn btn-xs"
                              style={{fontSize:11,background:'var(--green)',color:'#fff',
                                borderColor:'var(--green)',fontWeight:600}}
                              onClick={()=>setReleaseConfirm(o)}>
                              🚀 Release
                            </button>
                          </>
                        ) : (
                          <button className="btn btn-xs btn-primary"
                            onClick={()=>setPayModal({item:o,type:'customer'})}
                            disabled={!o.pi_no || o.balance_due <= 0}
                            title={!o.pi_no ? 'Generate PI first before recording payment' : o.balance_due <= 0 ? 'Order is fully paid — use History to view payments' : ''}
                            style={{fontSize:11,opacity:(o.pi_no && o.balance_due > 0)?1:0.45,cursor:(o.pi_no && o.balance_due > 0)?'pointer':'not-allowed'}}>💳 Record Payment</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Customer Net/Other ── */}
      {tab==='cust-net' && (
        <div>
          <div style={{marginBottom:10,fontSize:12,color:'var(--text3)'}}>
            Orders with Net / LC / Deferred / other payment terms — track due dates and record settlements.
          </div>
          {custLoading ? <div style={{padding:30,textAlign:'center',color:'var(--text3)'}}>Loading…</div> :
          filterCust([...custNet,...custOther]).length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>No pending net-term payments
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>Order</th><th>Customer</th><th>PO Context</th><th>Terms</th>
                <th style={{textAlign:'right'}}>Order Total</th>
                <th style={{textAlign:'right'}}>Balance Due</th>
                <th>Due Date</th><th>Status</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filterCust([...custNet,...custOther]).map(o=>{
                  const daysLeft = o.computed_due_date ? daysDiff(o.computed_due_date) : null;
                  return (
                    <tr key={o.id} style={{background:daysLeft!==null&&daysLeft<0?'var(--red-lt,#fef2f2)':daysLeft!==null&&daysLeft<=7?'var(--amber-lt,#fffbeb)':'transparent'}}>
                      <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{o.id}</span></td>
                      <td style={{fontWeight:500}}>{o.customer?.name||o.customer_id}</td>
                      <td style={{fontSize:11}}>
                        <div className="mono" style={{fontWeight:700}}>{o.po_number||'—'}</div>
                        <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>Customer PO</div>
                      </td>
                      <td><TermsBadge terms={o.payment_terms}/></td>
                      <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmtM(o.order_total)}</td>
                      <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700,
                        color:o.balance_due<=0?'var(--green)':'var(--text)'}}>
                        {o.balance_due<=0?'✅ Settled':fmtM(o.balance_due)}
                      </td>
                      <td>
                        {o.computed_due_date ? (
                          <div>
                            <div style={{fontSize:12}}>{fmtDate(o.computed_due_date)}</div>
                            <DueBadge daysLeft={daysLeft}/>
                          </div>
                        ) : '—'}
                      </td>
                      <td><StatusBadge s={o.customer_payment_status||'pending'}/></td>
                      <td style={{textAlign:'right'}}>
                        {o.balance_due > 0 && (
                          <button className="btn btn-xs btn-primary"
                            onClick={()=>setPayModal({item:o,type:'customer'})}
                            style={{fontSize:11}}>💳 Record Payment</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Supplier Advance ── */}
      {tab==='sup-advance' && (
        <div>
          <div style={{marginBottom:10,fontSize:12,color:'var(--text3)'}}>
            Supplier POs blocked pending advance payment. Pay to release PO for supplier to ship.
          </div>
          {supLoading ? <div style={{padding:30,textAlign:'center',color:'var(--text3)'}}>Loading…</div> :
          filterSup(supAdvance).length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>No blocked supplier payments
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>PO No.</th><th>Supplier</th><th>Order</th>
                <th>PI / Ref No.</th><th>Terms</th>
                <th style={{textAlign:'right'}}>Amount Due</th>
                <th>Bank Details</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filterSup(supAdvance).map(r=>(
                  (() => {
                    const { entity: fullEntity, entityType, displayName } = resolveFinanceSupplier(r.supplier_id);
                    const hasBank = isSupplierBankReady(fullEntity);
                    return (
                  <tr key={r.id}>
                    <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{r.internal_po_no||r.supplier_order_id}</span></td>
                    <td style={{fontWeight:500}}>
                      {displayName}
                      {entityType==='customer'&&<span style={{marginLeft:4,fontSize:10,padding:'1px 5px',borderRadius:99,background:'var(--teal-lt,#f0fdfa)',color:'var(--teal,#0d9488)',fontWeight:700}}>Customer</span>}
                    </td>
                    <td><span className="mono" style={{fontSize:11}}>{r.order_id}</span></td>
                    <td style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:600}}>{r.supplier_ref||'—'}</td>
                    <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:'var(--red-lt,#fef2f2)',color:'var(--red)',fontWeight:700}}>
                      {r.payment_terms||'Advance'}
                    </span></td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:800,color:'var(--red)',fontSize:13}}>
                      {fmtM(r.amount, r.currency)}
                    </td>
                    <td style={{fontSize:11,color:'var(--text2)'}}>
                      {fullEntity?.bank_name && <div>{fullEntity.bank_name}</div>}
                      {fullEntity?.bank_account_no && <div className="mono">{fullEntity.bank_account_no}</div>}
                      {fullEntity?.bank_ifsc && <div style={{color:'var(--text3)'}}>{fullEntity.bank_ifsc}</div>}
                      {fullEntity?.bank_swift && <div style={{color:'var(--text3)'}}>{fullEntity.bank_swift}</div>}
                      {!hasBank && <span style={{color:'var(--text3)'}}>No bank details</span>}
                    </td>
                    <td style={{textAlign:'right'}}>
                      <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                        {!hasBank && (
                          <button className="btn btn-xs"
                            onClick={()=>{
                              if (entityType==='customer') setCustomerBankModal(fullEntity || { id: r.supplier_id });
                              else setBankModal({ supplier: fullEntity || { id: r.supplier_id, name: displayName, type: 'domestic' } });
                            }}
                            style={{fontSize:11}}>
                            🏦 Add Bank Details
                          </button>
                        )}
                        <button className="btn btn-xs btn-primary"
                          onClick={()=>setPayModal({item:{...r, _resolvedName: displayName},type:'supplier-advance'})}
                          disabled={!hasBank}
                          style={{fontSize:11,background:'var(--green)',borderColor:'var(--green)',opacity:hasBank?1:0.55,cursor:hasBank?'pointer':'not-allowed'}}
                          title={hasBank ? '' : 'Add bank details first'}>
                          💸 Mark Paid
                        </button>
                      </div>
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Supplier Net ── */}
      {tab==='sup-net' && (
        <div>
          <div style={{marginBottom:10,fontSize:12,color:'var(--text3)'}}>
            Supplier POs on net payment terms — track due dates and record settlements.
          </div>
          {supLoading ? <div style={{padding:30,textAlign:'center',color:'var(--text3)'}}>Loading…</div> :
          filterSup(supNet.filter(r=>r.status!=='paid')).length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>No net-term supplier payments pending
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>PO No.</th><th>Supplier</th><th>Order</th><th>Terms</th>
                <th style={{textAlign:'right'}}>Total Amount</th>
                <th style={{textAlign:'right'}}>Paid</th>
                <th style={{textAlign:'right'}}>Balance</th>
                <th>Due Date</th><th>Status</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filterSup(supNet.filter(r=>r.status!=='paid')).map(r=>{
                  const { entity: fullEntity, entityType, displayName } = resolveFinanceSupplier(r.supplier_id);
                  const daysLeft = r.payment_due_date ? daysDiff(r.payment_due_date) : null;
                  const isPaid = r.status === 'paid';
                  const isPartial = r.status === 'partial_paid';
                  const total   = parseFloat(r.confirmed_price)||0;
                  const paid    = parseFloat(r.net_total_paid)||0;
                  const balance = Math.max(0, total - paid);
                  return (
                    <tr key={r.id} style={{background:isPartial?'var(--amber-lt,#fffbeb)':daysLeft!==null&&daysLeft<0?'var(--red-lt,#fef2f2)':daysLeft!==null&&daysLeft<=7?'var(--amber-lt,#fffbeb)':'transparent'}}>
                      <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{r.internal_po_no||r.id}</span></td>
                      <td style={{fontWeight:500}}>
                        {displayName}
                        {entityType==='customer'&&<span style={{marginLeft:4,fontSize:10,padding:'1px 5px',borderRadius:99,background:'var(--teal-lt,#f0fdfa)',color:'var(--teal,#0d9488)',fontWeight:700}}>Customer</span>}
                      </td>
                      <td><span className="mono" style={{fontSize:11}}>{r.order_id}</span></td>
                      <td><TermsBadge terms={r.payment_terms||('Net '+r.payment_net_days)}/></td>
                      <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700}}>
                        {fmtM(total, r.confirmed_currency)}
                      </td>
                      <td style={{textAlign:'right',fontFamily:'monospace',color:paid>0?'var(--green)':'var(--text3)'}}>
                        {paid > 0 ? fmtM(paid, r.confirmed_currency) : '—'}
                      </td>
                      <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700,
                        color:balance>0?'var(--amber,#d97706)':'var(--green)'}}>
                        {balance > 0 ? fmtM(balance, r.confirmed_currency) : '✓ Nil'}
                      </td>
                      <td>
                        {r.payment_due_date ? (
                          <div>
                            <div style={{fontSize:12}}>{fmtDate(r.payment_due_date)}</div>
                            <DueBadge daysLeft={daysLeft}/>
                          </div>
                        ) : '—'}
                      </td>
                      <td><StatusBadge s={r.status||'pending'}/></td>
                      <td style={{textAlign:'right'}}>
                        <button className="btn btn-xs btn-primary"
                          onClick={()=>setPayModal({item:{...r,supplier_order_id:r.id},type:'supplier-net'})}
                          style={{fontSize:11}}>
                          {isPartial ? `💸 Pay Remaining (${fmtM(balance, r.confirmed_currency)})` : '💸 Record Settlement'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: PO Requests ── */}
      {tab==='po-requests' && (
        <PORequestsTab
          requests={poRequests}
          onRefresh={()=>qc.invalidateQueries(['po-requests'])}
        />
      )}

      {/* ── Tab: History ── */}
      {tab==='history' && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
            <div style={{gridColumn:'1 / -1',display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:10,marginBottom:2}}>
              <input className="input" placeholder="Search order, customer/supplier, PO, PI, ref..."
                value={historyFilter.query}
                onChange={e=>setHistoryFilter(f=>({...f, query:e.target.value}))}/>
              <select className="input" value={historyFilter.method}
                onChange={e=>setHistoryFilter(f=>({...f, method:e.target.value}))}>
                <option value="all">All Methods</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className="input" type="date" value={historyFilter.from}
                onChange={e=>setHistoryFilter(f=>({...f, from:e.target.value}))}/>
              <input className="input" type="date" value={historyFilter.to}
                onChange={e=>setHistoryFilter(f=>({...f, to:e.target.value}))}/>
            </div>
            {/* Customer payments */}
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--accent)'}}>
                Customer Receipts ({filteredCustomerHistory.length})
              </div>
              {filteredCustomerHistory.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,padding:16}}>No customer payments recorded yet.</div>
              ) : (
                <div style={{display:'grid',gap:8}}>
                  {filteredCustomerHistory.slice(0,50).map(p=>(
                    <div key={p.id} style={{padding:'10px 14px',borderRadius:'var(--r-sm)',
                      border:'1px solid var(--border)',background:'var(--surface2)',fontSize:12,cursor:'pointer'}}
                      onClick={()=>setHistoryDetail({ type:'customer', item:p })}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                        <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{p.order_id}</span>
                        <span style={{fontWeight:800,color:'var(--green)'}}>{fmtM(p.amount, p.currency)}</span>
                      </div>
                      <div style={{color:'var(--text2)'}}>
                        {p.payment_method} · Ref: {p.payment_ref||'—'} · {fmtDate(p.payment_date)}
                      </div>
                      {p.po_number && <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>Customer PO: {p.po_number}</div>}
                      {p.pi_no && <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>PI: {p.pi_no}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Supplier payments */}
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--teal,#0d9488)'}}>
                Supplier Payments ({filteredSupplierHistory.length})
              </div>
              {filteredSupplierHistory.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,padding:16}}>No supplier payments recorded yet.</div>
              ) : (
                <div style={{display:'grid',gap:8}}>
                  {filteredSupplierHistory.slice(0,50).map(p=>(
                    <div key={p.id} style={{padding:'10px 14px',borderRadius:'var(--r-sm)',
                      border:'1px solid var(--border)',background:'var(--surface2)',fontSize:12,cursor:'pointer'}}
                      onClick={()=>setHistoryDetail({ type:'supplier', item:p })}>
                      {(() => {
                        const cur       = p.confirmed_currency || p.currency || 'INR';
                        const thisAmt   = parseFloat(p.amount) || 0;
                        const grandTotal= parseFloat(p.grand_total) || 0;
                        const remaining = parseFloat(p.remaining_snapshot) ?? Math.max(0, grandTotal - thisAmt);
                        const isPartial = p.payment_kind === 'net' && remaining > 0;
                        return (<>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                            <span className="mono" style={{fontWeight:700,color:'var(--teal,#0d9488)'}}>{p.internal_po_no||p.supplier_order_id}</span>
                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                              {isPartial
                                ? <span style={{fontSize:10,padding:'1px 7px',borderRadius:99,background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',fontWeight:700}}>partial</span>
                                : p.payment_kind==='net' && <span style={{fontSize:10,padding:'1px 7px',borderRadius:99,background:'var(--green-lt)',color:'var(--green)',fontWeight:700}}>settled</span>
                              }
                              <span style={{fontWeight:800,color:'var(--green)',fontSize:14}}>{fmtM(thisAmt, cur)}</span>
                            </div>
                          </div>
                          {p.supplier_name && <div style={{fontWeight:600,color:'var(--text2)',marginBottom:2}}>{p.supplier_name}</div>}
                          <div style={{color:'var(--text2)'}}>Ref: {p.payment_ref||'—'} · {fmtDate(p.paid_at||p.payment_date)}</div>
                          {p.payment_kind === 'net' && grandTotal > 0 && (
                            <div style={{marginTop:6,padding:'5px 8px',borderRadius:4,
                              background: remaining > 0 ? 'var(--amber-lt,#fffbeb)' : 'var(--green-lt)',
                              display:'flex',gap:16,flexWrap:'wrap'}}>
                              <span style={{fontSize:11,color:'var(--text2)'}}>
                                Total due: <strong>{fmtM(grandTotal, cur)}</strong>
                              </span>
                              <span style={{fontSize:11,color:'var(--green)',fontWeight:700}}>
                                Paid: {fmtM(parseFloat(p.total_paid_snapshot)||thisAmt, cur)}
                              </span>
                              {remaining > 0
                                ? <span style={{fontSize:11,color:'var(--amber,#d97706)',fontWeight:700}}>Still needed: {fmtM(remaining, cur)}</span>
                                : <span style={{fontSize:11,color:'var(--green)',fontWeight:700}}>✓ Fully settled</span>
                              }
                            </div>
                          )}
                          {p.supplier_ref && <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>PI: {p.supplier_ref}{p.zoho_po_number ? ` · Zoho: ${p.zoho_po_number}` : ''}</div>}
                        </>);
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payModal && (
        <RecordPaymentModal
          item={payModal.item}
          type={payModal.type}
          onClose={()=>setPayModal(null)}
          onSaved={()=>{ qc.invalidateQueries(['finance-customer']); qc.invalidateQueries(['finance-supplier']); }}
        />
      )}
      {viewPayModal && (
        <ViewPaymentModal
          item={viewPayModal.item}
          onClose={()=>setViewPayModal(null)}
          onSaved={()=>{ qc.invalidateQueries(['finance-customer']); setViewPayModal(null); }}
        />
      )}
      {/* Release Payment Confirmation */}
      {releaseConfirm && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setReleaseConfirm(null)}>
          <div className="modal modal-sm">
            <div className="modal-header">
              <h2>🚀 Release</h2>
              <button className="close-x" onClick={()=>setReleaseConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{fontSize:14,marginBottom:10}}>
                Are you sure you want to release payment for order{' '}
                <strong style={{color:'var(--accent)'}}>{releaseConfirm.id}</strong>?
              </div>
              <div style={{fontSize:12,color:'var(--text3)',padding:'10px 12px',borderRadius:6,
                background:'var(--surface2)',border:'1px solid var(--border)'}}>
                Customer: <strong>{releaseConfirm.customer?.name || releaseConfirm.customer_id}</strong><br/>
                Amount Paid: <strong style={{color:'var(--green)'}}>{fmtM(releaseConfirm.total_paid)}</strong>
              </div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:10}}>
                This will mark the payment as fully released and move the order to procurement.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setReleaseConfirm(null)}>Cancel</button>
              <button className="btn btn-primary"
                style={{background:'var(--green)',borderColor:'var(--green)'}}
                disabled={releaseMutation.isPending}
                onClick={()=>releaseMutation.mutate(releaseConfirm.id)}>
                {releaseMutation.isPending ? 'Releasing…' : '✅ Yes, Release'}
              </button>
            </div>
          </div>
        </div>
      )}
      {historyDetail && (
        <HistoryDetailModal detail={historyDetail} onClose={()=>setHistoryDetail(null)} />
      )}
      {bankModal?.supplier && (
        <SupplierBankDetailsModal
          supplier={bankModal.supplier}
          onClose={()=>setBankModal(null)}
          onSaved={()=>setBankModal(null)}
        />
      )}
      {customerBankModal && (
        <CustomerBankDetailsModal
          customer={customerBankModal}
          onClose={()=>setCustomerBankModal(null)}
          onSaved={()=>{ qc.invalidateQueries(['customers']); setCustomerBankModal(null); }}
        />
      )}
    </div>
  );
}
