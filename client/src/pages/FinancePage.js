// client/src/pages/FinancePage.js
// Finance module — Customer receipts + Supplier payments
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

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
  const piNo = order.pi_no || ('CIFLUX-PI-' + order.id);
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
  const custAddr  = [customer?.billing_street1, customer?.billing_street2, customer?.billing_city, customer?.billing_state].filter(Boolean).join(', ') || '—';
  const custGstin = customer?.gstin || '—';
  const custPhone = customer?.mobile || customer?.phone || '—';
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

  const custAddr2 = [customer?.billing_city, customer?.billing_state, customer?.billing_country].filter(Boolean).join(', ') || '';

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

  <!-- HEADER: Company + PI details -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <tr>
      <td style="width:55%;vertical-align:top;padding:4px 8px 4px 0">
        <div class="co-name">${coName}</div>
        <div class="co-detail">${coAddr}</div>
        <div class="co-detail">${coAddr2}</div>
        <div class="co-detail">GSTIN: ${coGst}</div>
        <div class="co-detail">Email: ${coEmail} | Phone: ${coPhone}</div>
      </td>
      <td style="width:45%;vertical-align:top">
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
          <tr><td class="addr-label">GST No:</td><td>${custGstin}</td></tr>
          <tr><td class="addr-label">Contact No:</td><td>${custPhone}</td></tr>
        </table>
      </td>
      <td style="width:50%;padding-left:4px;vertical-align:top">
        <div class="section-header">SHIP TO</div>
        <table class="addr-table">
          <tr><td class="addr-label">Customer</td><td>${custName}</td></tr>
          <tr><td class="addr-label">Address</td><td>${custAddr}${custAddr2?'<br/>'+custAddr2:''}</td></tr>
          <tr><td class="addr-label">GST No:</td><td>${custGstin}</td></tr>
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

  <!-- TERMS & BANK -->
  <table class="tc-table" style="margin-top:8px">
    <tr>
      <td colspan="2" style="background:#374151;color:#fff;font-weight:700;text-align:center;padding:5px">TERMS AND CONDITIONS</td>
      <td colspan="2" style="background:#374151;color:#fff;font-weight:700;text-align:center;padding:5px">Bank Account Details</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:4px 8px">1) All orders are accepted on NCNR</td>
      <td style="font-weight:700;background:#f9fafb">Bank Name:</td><td>${coBankName}</td>
    </tr>
    <tr>
      <td colspan="2">2) Payment Terms: Payment against delivery</td>
      <td style="font-weight:700;background:#f9fafb">Account Number:</td><td>${coBankAcc}</td>
    </tr>
    <tr>
      <td colspan="2">3) Mode of Payment: 100% advance</td>
      <td style="font-weight:700;background:#f9fafb">Account Name:</td><td>${coBankHolder}</td>
    </tr>
    <tr>
      <td colspan="2">4) Lead time: 1 - 2 Weeks</td>
      <td style="font-weight:700;background:#f9fafb">Branch / IFSC Code:</td><td>${coBankIFSC}</td>
    </tr>
    <tr>
      <td colspan="2">5) Goods once sold will not be taken back</td>
      <td style="font-weight:700;background:#f9fafb">SWIFT Code:</td><td>${coBankSwift||'—'}</td>
    </tr>
  </table>

  <div class="sig-area">
    <div class="sig-box">
      <div style="font-size:9px;font-weight:700">For ${coName}</div>
      <div class="sig-line">Authorised Signatory</div>
    </div>
  </div>
  </body></html>`;
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
                    fontWeight:r.l==='Amount'?700:400}}>{r.v}</span>
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
                    onChange={e=>set('payment_date',e.target.value)}/>
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
  const [form, setForm] = useState({
    amount: type === 'customer' ? String(item.balance_due||item.order_total||'') : String(item.amount||''),
    currency: type === 'customer' ? 'INR' : (item.currency||'INR'),
    payment_method: '', payment_ref: '', payment_date: today(), notes: '',
    payment_type: isPartialAdvance(item.payment_terms) ? 'partial_advance' : 'advance',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const mutation = useMutation({
    mutationFn: d => type === 'customer'
      ? api.post('/finance/customer-pay/'+item.id, d)
      : type === 'supplier-advance'
        ? api.put('/finance/supplier-pay/'+item.id, d)
        : api.put('/finance/supplier-net-pay/'+item.supplier_order_id||item.id, d),
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

  const label = type === 'customer' ? (item.customer?.name||item.customer_id) : (item.supplier?.name||item.supplier_id);
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
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="label">Amount <span className="req">*</span></label>
              <input className="input" type="number" step="0.01" value={form.amount}
                onChange={e=>set('amount',e.target.value)} placeholder="0.00"/>
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
              <input className="input" type="date" value={form.payment_date} onChange={e=>set('payment_date',e.target.value)}/>
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
            disabled={mutation.isPending||!form.payment_method||!form.payment_ref||!form.amount}
            onClick={()=>mutation.mutate(form)}>
            {mutation.isPending ? 'Saving…' : '✅ Record Payment'}
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
  const [search, setSearch]   = useState('');

  const { data: custQueueRaw=[], isLoading: custLoading }   = useQuery({ queryKey:['finance-customer'], queryFn:()=>api.get('/finance/customer-queue').then(r=>r.data).catch(()=>[]), refetchInterval:30000 });
  const { data: supQueueRaw={advance:[],net:[]}, isLoading: supLoading } = useQuery({ queryKey:['finance-supplier'], queryFn:()=>api.get('/finance/supplier-queue').then(r=>r.data).catch(()=>({advance:[],net:[]})), refetchInterval:30000 });
  const { data: historyRaw={customer:[],supplier:[]} }      = useQuery({ queryKey:['finance-history'], queryFn:()=>api.get('/finance/history').then(r=>r.data).catch(()=>({customer:[],supplier:[]})) });
  // FIX: defensive guards — ensure arrays even if server returns error object before migrations run
  const custQueue = Array.isArray(custQueueRaw) ? custQueueRaw : [];
  const supQueue  = (supQueueRaw && typeof supQueueRaw === 'object' && !Array.isArray(supQueueRaw)) ? supQueueRaw : {advance:[],net:[]};
  const history   = (historyRaw && typeof historyRaw === 'object' && !Array.isArray(historyRaw)) ? historyRaw : {customer:[],supplier:[]};
  const { data: settings={} }                            = useQuery({ queryKey:['settings'], queryFn:()=>api.get('/settings').then(r=>r.data).catch(()=>({})) });

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
    { k:'sup-net',      l:`📅 Supplier Net (${supNet.length})` },
    { k:'history',      l:'✅ History' },
  ];

  const handleGeneratePI = async (order) => {
    try {
      const r = await api.post('/finance/pi/'+order.id);
      const pi_no = r.data.pi_no;
      // Fetch full order details for PI
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
                <th>Order</th><th>Customer</th><th>PO No.</th><th>Terms</th>
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
                    <td className="mono" style={{fontSize:11}}>{o.po_number||'—'}</td>
                    <td><TermsBadge terms={o.payment_terms}/></td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmtM(o.order_total)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace',color:'var(--green)',fontWeight:600}}>
                      {o.total_paid>0 ? fmtM(o.total_paid) : '—'}
                    </td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700,
                      color:o.balance_due>0?'var(--red)':'var(--green)'}}>
                      {o.balance_due<=0 ? '✅ Paid' : fmtM(o.balance_due)}
                    </td>
                    <td>
                      {o.pi_no
                        ? <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:'var(--green-lt)',color:'var(--green)',fontWeight:600}}>✅ {o.pi_no}</span>
                        : <span style={{fontSize:11,color:'var(--text3)'}}>Not generated</span>}
                    </td>
                    <td>
                      <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,
                        background:o.status==='payment_approval'?'var(--amber-lt,#fffbeb)':'var(--green-lt)',
                        color:o.status==='payment_approval'?'var(--amber,#d97706)':'var(--green)',fontWeight:600}}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{textAlign:'right'}}>
                      <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                        <button className="btn btn-xs" onClick={()=>handleGeneratePI(o)}
                          style={{fontSize:11}}>📄 {o.pi_no?'Re-print PI':'Generate PI'}</button>
                        {/* FIX: show Record Payment based on status, not balance_due */}
                        {/* balance_due can be 0 due to junk data even when no real payment was made */}
                        {o.customer_payment_status !== 'paid' ? (
                          <button className="btn btn-xs btn-primary" onClick={()=>setPayModal({item:o,type:'customer'})}
                            style={{fontSize:11}}>💳 Record Payment</button>
                        ) : (
                          <button className="btn btn-xs" onClick={()=>setViewPayModal({item:o})}
                            style={{fontSize:11,opacity:0.7}}>👁 View Payment</button>
                        )}
                        {/* ADDED: Go to Order button — shown once payment is confirmed paid */}
                        {o.customer_payment_status === 'paid' && (
                          <button className="btn btn-xs"
                            style={{fontSize:11,background:'var(--green)',color:'#fff',
                              borderColor:'var(--green)',fontWeight:600}}
                            onClick={()=>window.location.href='/orders?q='+encodeURIComponent(o.id)}>
                            ✓ Go to Order →
                          </button>
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
                <th>Order</th><th>Customer</th><th>PO No.</th><th>Terms</th>
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
                      <td className="mono" style={{fontSize:11}}>{o.po_number||'—'}</td>
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
                      <td>
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,
                          background:o.customer_payment_status==='paid'?'var(--green-lt)':'var(--surface2)',
                          color:o.customer_payment_status==='paid'?'var(--green)':'var(--text3)',fontWeight:600}}>
                          {o.customer_payment_status||'pending'}
                        </span>
                      </td>
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
                  <tr key={r.id}>
                    <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{r.internal_po_no||r.supplier_order_id}</span></td>
                    <td style={{fontWeight:500}}>{r.supplier?.name||r.supplier_id}</td>
                    <td><span className="mono" style={{fontSize:11}}>{r.order_id}</span></td>
                    <td style={{fontSize:11,color:'var(--teal,#0d9488)',fontWeight:600}}>{r.supplier_ref||'—'}</td>
                    <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:'var(--red-lt,#fef2f2)',color:'var(--red)',fontWeight:700}}>
                      {r.payment_terms||'Advance'}
                    </span></td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:800,color:'var(--red)',fontSize:13}}>
                      {fmtM(r.amount, r.currency)}
                    </td>
                    <td style={{fontSize:11,color:'var(--text2)'}}>
                      {r.supplier?.bank_name && <div>{r.supplier.bank_name}</div>}
                      {r.supplier?.bank_account_no && <div className="mono">{r.supplier.bank_account_no}</div>}
                      {r.supplier?.bank_ifsc && <div style={{color:'var(--text3)'}}>{r.supplier.bank_ifsc}</div>}
                      {!r.supplier?.bank_account_no && <span style={{color:'var(--text3)'}}>No bank details</span>}
                    </td>
                    <td style={{textAlign:'right'}}>
                      <button className="btn btn-xs btn-primary"
                        onClick={()=>setPayModal({item:r,type:'supplier-advance'})}
                        style={{fontSize:11,background:'var(--green)',borderColor:'var(--green)'}}>
                        💸 Mark Paid
                      </button>
                    </td>
                  </tr>
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
          filterSup(supNet).length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>
              <div style={{fontSize:32,marginBottom:8}}>✅</div>No net-term supplier payments pending
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>PO No.</th><th>Supplier</th><th>Order</th><th>Terms</th>
                <th style={{textAlign:'right'}}>Amount</th>
                <th>Due Date</th><th>Status</th><th style={{textAlign:'right'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filterSup(supNet).map(r=>{
                  const daysLeft = r.payment_due_date ? daysDiff(r.payment_due_date) : null;
                  return (
                    <tr key={r.id} style={{background:daysLeft!==null&&daysLeft<0?'var(--red-lt,#fef2f2)':daysLeft!==null&&daysLeft<=7?'var(--amber-lt,#fffbeb)':'transparent'}}>
                      <td><span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{r.internal_po_no||r.id}</span></td>
                      <td style={{fontWeight:500}}>{r.supplier?.name||r.supplier_id}</td>
                      <td><span className="mono" style={{fontSize:11}}>{r.order_id}</span></td>
                      <td><TermsBadge terms={r.payment_terms||('Net '+r.payment_net_days)}/></td>
                      <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700}}>
                        {fmtM(r.confirmed_price, r.confirmed_currency)}
                      </td>
                      <td>
                        {r.payment_due_date ? (
                          <div>
                            <div style={{fontSize:12}}>{fmtDate(r.payment_due_date)}</div>
                            <DueBadge daysLeft={daysLeft}/>
                          </div>
                        ) : '—'}
                      </td>
                      <td>
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,
                          background:r.status==='paid'?'var(--green-lt)':'var(--surface2)',
                          color:r.status==='paid'?'var(--green)':'var(--text3)',fontWeight:600}}>
                          {r.status||'pending'}
                        </span>
                      </td>
                      <td style={{textAlign:'right'}}>
                        {r.status !== 'paid' && (
                          <button className="btn btn-xs btn-primary"
                            onClick={()=>setPayModal({item:{...r,supplier_order_id:r.id},type:'supplier-net'})}
                            style={{fontSize:11}}>💸 Record Settlement</button>
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

      {/* ── Tab: History ── */}
      {tab==='history' && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
            {/* Customer payments */}
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--accent)'}}>
                Customer Receipts ({history.customer?.length||0})
              </div>
              {(history.customer||[]).length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,padding:16}}>No customer payments recorded yet.</div>
              ) : (
                <div style={{display:'grid',gap:8}}>
                  {(history.customer||[]).slice(0,20).map(p=>(
                    <div key={p.id} style={{padding:'10px 14px',borderRadius:'var(--r-sm)',
                      border:'1px solid var(--border)',background:'var(--surface2)',fontSize:12}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                        <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{p.order_id}</span>
                        <span style={{fontWeight:800,color:'var(--green)'}}>{fmtM(p.amount, p.currency)}</span>
                      </div>
                      <div style={{color:'var(--text2)'}}>
                        {p.payment_method} · Ref: {p.payment_ref||'—'} · {fmtDate(p.payment_date)}
                      </div>
                      {p.pi_no && <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>PI: {p.pi_no}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Supplier payments */}
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'var(--teal,#0d9488)'}}>
                Supplier Payments ({history.supplier?.length||0})
              </div>
              {(history.supplier||[]).length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,padding:16}}>No supplier payments recorded yet.</div>
              ) : (
                <div style={{display:'grid',gap:8}}>
                  {(history.supplier||[]).slice(0,20).map(p=>(
                    <div key={p.id} style={{padding:'10px 14px',borderRadius:'var(--r-sm)',
                      border:'1px solid var(--border)',background:'var(--surface2)',fontSize:12}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                        <span className="mono" style={{fontWeight:700,color:'var(--teal,#0d9488)'}}>{p.internal_po_no||p.supplier_order_id}</span>
                        <span style={{fontWeight:800,color:'var(--green)'}}>{fmtM(p.paid_amount, p.confirmed_currency)}</span>
                      </div>
                      <div style={{color:'var(--text2)'}}>
                        Ref: {p.payment_ref||'—'} · {fmtDate(p.paid_at)}
                      </div>
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
    </div>
  );
}
