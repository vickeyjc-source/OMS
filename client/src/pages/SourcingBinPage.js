// client/src/pages/SourcingBinPage.js  v3
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES, DaysBadge, fmtDateTime } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { ALL_CURRENCIES, fmtC } from '../utils/currencies';
import { getTaxRatesForCurrency } from '../utils/taxRates';

// ── Get tax rates for currency (maps rates to dropdown format) ────────────────
const getTaxRates = (currency) => {
  const { rates, country } = getTaxRatesForCurrency(currency);
  const isGST = currency === 'INR';
  const label = isGST ? 'GST' : 'VAT';
  return rates.map(rate => ({
    label: `${label} ${rate}%`,
    rate: rate,
    country: country,
  }));
};


const fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);

// ── SourcingModal ────────────────────────────────────────────
function SourcingModal({ enq, suppliers, customers, users, quotes, onClose, onSaved, onSavedDraft, forceReadOnly=false }) {
  const { user } = useAuth();

  // ── Stock Inventory check — fetch all inventory once for this modal ──────
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api.get('/inventory').then(r => Array.isArray(r.data) ? r.data : []),
    staleTime: 60000,
  });

  // Build a lookup: component+manufacturer composite key → matching inventory rows
  const stockByComponent = useMemo(() => {
    const map = {};
    inventoryItems.forEach(inv => {
      if ((inv.quantity_available || 0) <= 0) return;
      const comp = (inv.component || '').toLowerCase().trim();
      const mfr  = (inv.manufacturer || '').toLowerCase().trim();
      if (!comp) return;
      // key with manufacturer
      if (mfr) {
        const key = comp + '|' + mfr;
        if (!map[key]) map[key] = [];
        map[key].push(inv);
      }
      // key without manufacturer (fallback)
      const key0 = comp + '|';
      if (!map[key0]) map[key0] = [];
      map[key0].push(inv);
    });
    return map;
  }, [inventoryItems]);

  // Sourcing rows — one per item
  const [srcRows, setSrcRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      if (ex) {
        // Normalise: DB stores bank charge as bank_fixed_usd for both intl & domestic
        // Populate the correct UI field so the form displays saved values on re-open
        const supType = suppliers.find(s => s.id === ex.supplier_id)?.type || 'domestic';
        const isIntl  = supType === 'international';
        return {
          ...ex,
          bank_fixed_foreign: isIntl  ? (ex.bank_fixed_usd ?? '') : '',
          bank_fixed_inr:     !isIntl ? (ex.bank_fixed_usd ?? '') : '',
        };
      }
      return { id: null, enquiry_item_id: item.id, supplier_id: '', sourced_price: '',
               sourced_currency: 'INR', src_price_foreign: '', exchange_rate: '',
               hsn_code: '', availability: '', lead_time: '', notes: '',
               freight_pct: '', insurance_pct: '', duty_pct: '',
               cess_pct: '', bank_fixed_foreign: '', bank_fixed_inr: '',
               clearance_fixed_inr: '', margin_pct: '' };
    })
  );

  // Quote prices — one per item
  const [quoteRows, setQuoteRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      return { enquiry_item_id: item.id, quote_price: ex?.quote_price || '', quote_currency: ex?.quote_currency || item.target_currency || 'INR', tax_rate: ex?.tax_rate ?? '' };
    })
  );

  // Additional charges for whole enquiry
  const [charges, setCharges] = useState({
    customs:   enq.charges?.customs   || '',
    handling:  enq.charges?.handling  || '',
    freight:   enq.charges?.freight   || '',
    bank:      enq.charges?.bank      || '',
    insurance: enq.charges?.insurance || '',
    duty:      enq.charges?.duty      || '',
    cess:      enq.charges?.cess      || '',
    clearance: enq.charges?.clearance || '',
    currency:  enq.charges?.currency  || 'INR',
    notes:     enq.charges?.notes     || '',
  });

  const [assignTo, setAssignTo] = useState(enq.assigned_to || '');
  const [saving, setSaving]     = useState(false);
  const [saveMode, setSaveMode] = useState('');

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => {
    if (!id) return '—';
    if (id.startsWith('__inv__')) {
      const h = inventoryItems.find(h => h.id === id.slice(7));
      return '📦 ' + (h?.holder_display || h?.holder_name || 'Internal Stock');
    }
    return suppliers.find(s => s.id === id)?.name || '—';
  };
  const srcingUsers = users.filter(u => u.department === 'sourcing' || ['admin','manager'].includes(u.role));

  const updSrc   = (idx, k, v) => setSrcRows(p  => p.map((r,i) => i===idx ? {...r,[k]:v} : r));
  const updQuote = (idx, k, v) => setQuoteRows(p => p.map((r,i) => i===idx ? {...r,[k]:v} : r));

  // ── Per-item auto calculation ─────────────────────────────
  // Returns calculated breakdown for one item row
  const calcRow = (src, item) => {
    const qty        = Number(item.quantity) || 1;
    const srcINR     = Number(src.sourced_price) || 0;    // always INR
    const rate       = Number(src.exchange_rate) || 0;    // 0 = not entered yet
    const supType    = src._supType || 'domestic';
    const isIntl     = supType === 'international';
    const freightPct = Number(src.freight_pct) || 0;
    const insPct     = isIntl ? (Number(src.insurance_pct) || 0) : 0;
    const dutyPct    = isIntl ? (Number(src.duty_pct) || 0) : 0;
    const cessPct    = isIntl ? (Number(src.cess_pct) || 0) : 0;
    // support legacy field name bank_fixed_usd as fallback
    const bankForeign = isIntl ? (Number(src.bank_fixed_foreign ?? src.bank_fixed_usd) || 0) : 0;
    const bankINR    = isIntl ? 0 : 0;
    const clearINR   = isIntl ? (Number(src.clearance_fixed_inr) || 0) : 0;
    const marginPct  = Number(src.margin_pct) || 0;

    // Freight: srcINR × freight_pct% (both intl and domestic)
    const freight    = srcINR * freightPct / 100;
    // Insurance: srcINR × insurance_pct% (both)
    const insurance  = srcINR * insPct / 100;
    // Duty = (source + freight + insurance) × duty_pct% (both)
    const duty       = (srcINR + freight + insurance) * dutyPct / 100;
    // Cess = duty × cess_pct% (both)
    const cess       = duty * cessPct / 100;
    // Bank intl: bank_amount(foreign currency) × exchange_rate ÷ qty → ₹/unit
    // Bank domestic: bank_amount(₹) ÷ qty
    // Only calculate if both bank amount and rate (for intl) are entered
    const bank       = isIntl
      ? (rate > 0 ? (bankForeign * rate) / qty : 0)
      : (bankINR / qty);
    // Clearance = clearance_fixed_inr / qty (both)
    const clearance  = clearINR / qty;
    // Total cost per unit INR
    const totalCost  = srcINR + freight + insurance + duty + cess + bank + clearance;
    // Margin = totalCost × margin_pct%
    const margin     = totalCost * marginPct / 100;
    // Quote = totalCost + margin
    const quoteCalc  = totalCost + margin;

    return { freight, insurance, duty, cess, bank, clearance, margin, quoteCalc, totalCost, isIntl };
  };

  // ── Margin calculations ──────────────────────────────────
  const marginData = useMemo(() => {
    const rows = (enq.items || []).map((item, idx) => {
      const src  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const qty  = Number(item.quantity) || 0;

      const supType      = suppliers.find(s => s.id === src.supplier_id)?.type || 'domestic';
      const srcWithType  = { ...src, _supType: supType };
      const calc         = calcRow(srcWithType, item);

      const srcUnit   = Number(src.sourced_price)   || 0;  // always INR
      const quoteUnit = Number(qrow.quote_price)     || 0;
      const target    = Number(item.target_price)    || 0;
      const exchangeRate = Number(src.exchange_rate) || 1;
      const srcCurrency  = src.sourced_currency || 'INR';
      const srcForeign   = Number(src.src_price_foreign) || 0;

      const srcTotal   = srcUnit * qty;
      const quoteTotal = quoteUnit * qty;
      const grossMarginUnit = quoteUnit - srcUnit;
      const grossMarginTotal = quoteTotal - srcTotal;

      const aboveTarget = target > 0 && (srcUnit > target || quoteUnit > target);
      const srcAbove   = target > 0 && srcUnit > target;
      const quoteAbove = target > 0 && quoteUnit > target;

      return { srcUnit, quoteUnit, srcTotal, quoteTotal, grossMarginUnit, grossMarginTotal,
               target, qty, srcAbove, quoteAbove, aboveTarget, exchangeRate, srcCurrency,
               srcForeign, calc };
    });

    const totalSrcValue    = rows.reduce((s, r) => s + r.srcTotal, 0);
    const totalQuoteValue  = rows.reduce((s, r) => s + r.quoteTotal, 0);
    const totalGrossMargin = totalQuoteValue - totalSrcValue;
    const grossMarginPct   = totalSrcValue > 0 ? ((totalGrossMargin / totalSrcValue) * 100) : 0;

    const addlCost = ['customs','handling','freight','bank','insurance','duty','cess','clearance']
      .reduce((s, k) => s + (Number(charges[k])||0), 0);
    const totalNetMargin = totalQuoteValue - totalSrcValue - addlCost;
    const netMarginPct   = totalSrcValue > 0 ? ((totalNetMargin / totalSrcValue) * 100) : 0;

    return { rows, totalSrcValue, totalQuoteValue, totalGrossMargin, grossMarginPct, addlCost, totalNetMargin, netMarginPct };
  }, [srcRows, quoteRows, charges, enq.items, suppliers]);

  const handleSave = async (mode) => {
    // Validate lead time mandatory when sending to Quote Bin
    if (mode === 'quote' || mode === 'return_revision') {
      for (let i = 0; i < srcRows.length; i++) {
        const item = enq.items?.[i];
        const lt = (srcRows[i].lead_time || '').toString().trim();
        if (!lt || lt === '0' || lt === '0 Days' || lt === '0 Weeks' || lt === '0 Months') {
          toast.error(`Lead Time is required for "${item?.component || 'item ' + (i+1)}"`);
          return;
        }
      }
    }
    setSaving(true); setSaveMode(mode);
    try {
      const rowsToSave = srcRows.map((r) => {
        // Match by enquiry_item_id — not by array index — to avoid mismatch
        const qrow = quoteRows.find(q => q.enquiry_item_id === r.enquiry_item_id)
                  || quoteRows.find(q => !q.enquiry_item_id); // fallback single-item
        const qp = qrow?.quote_price;
        const item = enq.items?.find(i => i.id === r.enquiry_item_id);
        // Keep inventory-backed selections persisted as supplier_id so downstream
        // procurement can reopen the exact sourced choice.
        const isInvHolder = r.supplier_id?.startsWith('__inv__');
        const invHit = isInvHolder
          ? inventoryItems.find(h => h.id === r.supplier_id.slice(7))
          : null;
        const invHolderNote = isInvHolder
          ? (invHit?.holder_display || invHit?.holder_name || 'Internal Stock') + (invHit?.date_code ? ' DC:' + invHit.date_code : '')
          : '';
        const resolvedRow = isInvHolder
          ? {
              ...r,
              notes: [r.notes, invHolderNote].filter(Boolean).join(' | '),
            }
          : r;
        const supType = suppliers.find(s => s.id === resolvedRow.supplier_id)?.type || 'domestic';
        const normalizedRow = supType === 'international'
          ? resolvedRow
          : {
              ...resolvedRow,
              insurance_pct: '0',
              duty_pct: '0',
              cess_pct: '0',
              bank_fixed_foreign: '0',
              bank_fixed_inr: '0',
              clearance_fixed_inr: '0',
            };
        const calc = calcRow({ ...normalizedRow, _supType: supType }, item || { quantity: 1 });
        // Map UI fields bank_fixed_foreign (intl) / bank_fixed_inr (domestic) → DB column bank_fixed_usd
        const bankFixedUsd = supType === 'international'
          ? ((normalizedRow.bank_fixed_foreign !== '' && normalizedRow.bank_fixed_foreign != null)
              ? normalizedRow.bank_fixed_foreign
              : (normalizedRow.bank_fixed_usd ?? null))
          : '0';
        return {
          ...normalizedRow,
          id: r.id || ('src_' + r.enquiry_item_id + '_' + Date.now()),
          bank_fixed_usd:          bankFixedUsd,
          quote_price:             (qp !== '' && qp != null) ? qp : null,
          quote_currency:          qrow?.quote_currency || 'INR',
          tax_rate:                (qrow?.tax_rate !== '' && qrow?.tax_rate != null) ? Number(qrow.tax_rate) : null,
          sourcing_revision_notes: srcRevNotes[r.enquiry_item_id] || null,
          freight_inr:   calc.freight   || null,
          insurance_inr: calc.insurance || null,
          duty_inr:      calc.duty      || null,
          cess_inr:      calc.cess      || null,
          bank_inr:      calc.bank      || null,
          clearance_inr: calc.clearance || null,
          margin_inr:    calc.margin    || null,
        };
      });

      const newStatus = (mode === 'quote' || mode === 'return_revision') ? 'quoted' : mode === 'draft' ? 'sourcing' : 'sourcing';
      const action    = mode === 'quote' ? 'Sent to Quote Bin' : mode === 'draft' ? 'Saved as draft in Sourcing' : 'Sourcing saved';

      // 1. Save sourcing data back to the enquiry
      await api.put(`/enquiries/${enq.id}`, {
        sourcing:    rowsToSave,
        charges,
        status:      newStatus,
        assigned_to: assignTo || null,
        _action:     action,
      });

      // 2. When sending to Quote Bin
      if (mode === 'quote' || mode === 'return_revision') {
        // Build notes summary with sourcing details
        const srcSummary = rowsToSave
          .map((r, idx) => {
            const item = enq.items?.find(i => i.id === r.enquiry_item_id) || enq.items?.[idx];
            if (!item) return null;
            const qp = r.quote_price;
            const qc = r.quote_currency || 'INR';
            const srcDisplay = (r.src_price_foreign && r.exchange_rate)
              ? `${r.sourced_currency} ${r.src_price_foreign} (=₹${r.sourced_price||'—'} @ rate ${r.exchange_rate})`
              : `₹ ${r.sourced_price || '—'}`;
            const srcNote = srcRevNotes[r.enquiry_item_id] ? ` | Note: ${srcRevNotes[r.enquiry_item_id]}` : '';
            return `${item.component}: Quote ${qc} ${qp || '—'} | Src ${srcDisplay} | Qty ${item.quantity}${srcNote}`;
          })
          .filter(Boolean)
          .join('\n');

        const addlCostTotal = ['customs','handling','freight','bank','insurance','duty','cess','clearance'].reduce((s,k) => s+(Number(charges[k])||0), 0);
        const addlNote = addlCostTotal > 0
          ? `\nAdditional charges (₹): Customs ${charges.customs||0}, Handling ${charges.handling||0}, Freight ${charges.freight||0}, Bank ${charges.bank||0}, Insurance ${charges.insurance||0}, Duty ${charges.duty||0}, Cess ${charges.cess||0}, Clearance ${charges.clearance||0} ${charges.currency||'INR'}`
          : '';

        const fullNotes = srcSummary + addlNote;

        if (mode === 'return_revision' && pendingRevision) {
          // Revision workflow: update the existing revision quote with new pricing notes
          try {
            await api.put('/quotes/' + pendingRevision.id, {
              quote_no:      pendingRevision.quote_no,
              zoho_quote_no: pendingRevision.zoho_quote_no || '',
              file_ref:      pendingRevision.file_ref || '',
              valid_until:   pendingRevision.valid_until || '',
              status:        'active',
              notes:         fullNotes,
            });
            toast.success('✅ Prices updated — ' + pendingRevision.quote_no + ' returned to Quote Bin!');
          } catch(e) {
            toast.error('Failed to update revision quote: ' + (e.response?.data?.error || e.message));
          }
        } else {
          // Standard workflow: create a new Quote record with FY-based sequential number
          let quoteNo = '';
          try {
            const nextRes = await api.get('/next-quote-no');
            quoteNo = nextRes.data.quote_no;
          } catch(_) {
            const y = new Date().getFullYear(); const m = new Date().getMonth() + 1;
            const s = m >= 4 ? y : y - 1;
            const fy = String(s).slice(2) + String(s+1).slice(2);
            quoteNo = `QT-${fy}-${String((quotes||[]).length + 1).padStart(4,'0')}`;
          }
          try {
            await api.post('/quotes', {
              enquiry_id:       enq.id,
              customer_id:      enq.customer_id,
              quote_no:         quoteNo,
              zoho_quote_no:    '',
              file_ref:         '',
              valid_until:      '',
              status:           'active',
              notes:            fullNotes,
              existing_order_id: enq.existing_order_id || null,
            });
            toast.success('✅ Sent to Quote Bin! Quote ' + quoteNo + ' created.');
          } catch (qErr) {
            console.warn('Quote auto-create skipped:', qErr.response?.data?.error);
            toast.success('Sourcing saved — check Quote Bin');
          }
        }
      } else if (mode === 'draft') {
        toast.success('Saved as draft');
      } else {
        toast.success('Sourcing saved');
      }
      // Draft and quote/revision all close the modal
      if (mode === 'quote' || mode === 'return_revision' || mode === 'draft') {
        onSaved();
      } else {
        // 'save' mode (not used now) — refresh quietly without closing
        if (onSavedDraft) onSavedDraft();
      }
    } catch(e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false); setSaveMode('');
    }
  };

  const md = marginData;

  // Find the pending revision quote for this enquiry:
  // After "Send to Revision" in quotes page, a new V2+ quote is created as 'active'
  // and the ENQ is moved to 'returned_to_sourcing'. Source bin needs to re-price V2.
  const pendingRevision = enq.status === 'returned_to_sourcing'
    ? ((quotes||[]).find(q =>
        q.enquiry_id === enq.id && q.status === 'active' && (q.revision||1) > 1
      ) || null)
    : null;
  const isRevision = !!pendingRevision;

  // Sourcing comment per item state (for revision workflow)
  const [srcRevNotes, setSrcRevNotes] = useState({});  // item_id → note

  // Once sent to Quote Bin or moved downstream to order/procurement → read-only
  const isQuoted = enq.status === 'quoted' && !pendingRevision;
  const isReadOnly = forceReadOnly || isQuoted || ['ordered','order_created'].includes(enq.status);

  // ── Validate all required fields are filled for every item ──────────────
  const allFieldsFilled = useMemo(() => {
    return (enq.items || []).every((item, idx) => {
      const row  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const supType    = suppliers.find(s => s.id === row.supplier_id)?.type || 'domestic';
      const isIntlSup  = supType === 'international';
      const hasSupplier   = !!row.supplier_id;      const hasSrcPrice   = row.sourced_price !== '' && row.sourced_price != null && Number(row.sourced_price) > 0;
      const hasLeadTime   = !!(row.lead_time || '').toString().trim() &&
                            (row.lead_time || '').toString().trim() !== '0' &&
                            (row.lead_time || '').toString().trim() !== '0 Days' &&
                            (row.lead_time || '').toString().trim() !== '0 Weeks' &&
                            (row.lead_time || '').toString().trim() !== '0 Months';
      const hasQuotePrice = qrow.quote_price !== '' && qrow.quote_price != null && Number(qrow.quote_price) > 0;
      const hasExchRate   = !isIntlSup || (row.exchange_rate !== '' && row.exchange_rate != null && Number(row.exchange_rate) > 0);
      const hasForeignPx  = !isIntlSup || (row.src_price_foreign !== '' && row.src_price_foreign != null && Number(row.src_price_foreign) > 0);
      return hasSupplier && hasSrcPrice && hasLeadTime && hasQuotePrice && hasExchRate && hasForeignPx;
    });
  }, [srcRows, quoteRows, enq.items, suppliers]);

  return (
    <div className="overlay">
      <div className="modal" style={{ width:'calc(100vw - 24px)', maxWidth:'calc(100vw - 24px)', margin:'12px auto' }}>
        <div className="modal-header">
          <div>
            {/* ── Trail breadcrumb: ENQ → SOUR → QUOTE ── */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:4}}>
              <span className="mono" style={{fontSize:11,color:'var(--text3)',background:'var(--surface2)',
                padding:'2px 8px',borderRadius:999,border:'1px solid var(--border)'}}>
                📩 {enq.id}
              </span>
              {enq.sourcing_no && <>
                <span style={{fontSize:11,color:'var(--text3)'}}>→</span>
                <span className="mono" style={{fontSize:11,color:'var(--accent)',background:'var(--accent-lt)',
                  padding:'2px 8px',borderRadius:999,border:'1px solid var(--accent)33',fontWeight:600}}>
                  🔍 {enq.sourcing_no}
                </span>
              </>}
              {pendingRevision && <>
                <span style={{fontSize:11,color:'var(--text3)'}}>→</span>
                <span className="mono" style={{fontSize:11,color:'var(--amber,#d97706)',
                  background:'var(--amber-lt,#fffbeb)',padding:'2px 8px',borderRadius:999,
                  border:'1px solid var(--amber,#d97706)44',fontWeight:700}}>
                  📄 {pendingRevision.quote_no}
                </span>
              </>}
            </div>
            <h2 style={{marginBottom:0}}>🔍 {custName(enq.customer_id)}</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
              {enq.items?.length || 0} component{enq.items?.length !== 1 ? 's' : ''} ·
              Priority: <strong style={{ color: enq.priority==='urgent'?'var(--red)':enq.priority==='high'?'var(--amber)':'inherit' }}>{enq.priority}</strong> ·
              Created {fmtDateTime(enq.created_at)}
            </div>
          </div>
          <div className="flex gap-8">
            <StatusBadge s={enq.status}/>
            <button className="close-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">

          {/* ── Revision Banner — shown when a revision is pending ── */}
          {isRevision && pendingRevision.sales_revision_notes && (
            <div style={{marginBottom:14,padding:'14px 16px',borderRadius:'var(--r)',
              border:'2px solid var(--amber,#d97706)',background:'var(--amber-lt,#fffbeb)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <span style={{fontSize:20}}>⚠️</span>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:'var(--amber,#d97706)'}}>
                    Quote Revision Requested — {pendingRevision.quote_no}
                  </div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>
                    Sales has sent this back for re-pricing. Update the quote prices below and return to Quote Bin.
                  </div>
                </div>
              </div>
              <div style={{padding:'8px 12px',background:'#fff',borderRadius:'var(--r-sm)',
                fontSize:12,color:'var(--text)',fontStyle:'italic',
                border:'1px solid var(--amber,#d97706)33'}}>
                💬 Sales note: "{pendingRevision.sales_revision_notes}"
              </div>
            </div>
          )}
          {isRevision && !pendingRevision.sales_revision_notes && (
            <div style={{marginBottom:14,padding:'10px 14px',borderRadius:'var(--r)',
              border:'2px solid var(--amber,#d97706)',background:'var(--amber-lt,#fffbeb)',
              display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:18}}>📝</span>
              <div style={{fontWeight:600,fontSize:12,color:'var(--amber,#d97706)'}}>
                Quote Revision {pendingRevision.quote_no} is pending — update prices and return to Quote Bin.
              </div>
            </div>
          )}

          {/* Enquiry Info + Notes */}
          <div style={{ background:'var(--accent-lt)', border:'1px solid rgba(27,79,158,.2)', borderRadius:'var(--r-sm)', padding:'9px 14px', marginBottom:14, fontSize:12, display:'flex', gap:20, flexWrap:'wrap' }}>
            <span>📋 <strong>Customer:</strong> {custName(enq.customer_id)}</span>
            {enq.notes && <span>📝 <strong>Notes:</strong> {enq.notes}</span>}
            <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
              <label className="label" style={{ margin:0 }}>Assigned:</label>
              <select className="input" style={{ padding:'3px 8px', fontSize:18, minWidth:140 }} value={assignTo} onChange={e => setAssignTo(e.target.value)} disabled={isReadOnly}>
                <option value="">— Unassigned —</option>
                {srcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </span>
          </div>

          {/* ── Per-Item Sourcing + Quote Pricing ─────────── */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title" style={{ marginBottom:8 }}>
              <span>📦 Components — Sourcing &amp; Quote Pricing</span>
            </div>

            {(enq.items || []).map((item, idx) => {
              const row   = srcRows[idx]   || {};
              const qrow  = quoteRows[idx] || {};
              const mrow  = md.rows[idx]   || {};
              const hasTarget = Number(item.target_price) > 0;
              const supType = suppliers.find(s => s.id === row.supplier_id)?.type || 'domestic';
              const isIntl  = supType === 'international';
              const domesticZeroLocked = ['insurance_pct', 'duty_pct', 'cess_pct', 'bank_fixed_inr', 'clearance_fixed_inr'];
              const calc    = calcRow({ ...row, _supType: supType }, item);
              const cur     = row.sourced_currency || (isIntl ? 'USD' : 'INR');
              const supplierTaxCurrency = isIntl ? cur : 'INR';

              // shared label style
              const LBL = { display:'block', fontSize:10, fontWeight:600, color:'var(--text3)',
                letterSpacing:.2, lineHeight:1.4, marginBottom:3, whiteSpace:'nowrap' };
              // shared r/o field
              const roStyle = (color='var(--text2)', bg='var(--surface2)') => ({
                height:32, fontSize:12, padding:'3px 8px', background:bg, color,
                border:'1px solid var(--border)', borderRadius:'var(--r-sm)',
                fontWeight:700, cursor:'default', display:'flex', alignItems:'center',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              });

              const handleRateChange = (field, val) => {
                setSrcRows(p => p.map((r2, i) => {
                  if (i !== idx) return r2;
                  const updated = { ...r2, [field]: val };
                  if ((field === 'src_price_foreign' || field === 'exchange_rate') && isIntl) {
                    const fp = field === 'src_price_foreign' ? val : r2.src_price_foreign;
                    const er = field === 'exchange_rate' ? val : r2.exchange_rate;
                    if (Number(fp) > 0 && Number(er) > 0)
                      updated.sourced_price = String((Number(fp)*Number(er)).toFixed(4));
                  }
                  const c2 = calcRow({ ...updated, _supType: supType }, item);
                  if (c2.quoteCalc > 0) setQuoteRows(p2 => p2.map((q2, qi) => qi !== idx ? q2 : { ...q2, quote_price: c2.quoteCalc.toFixed(2) }));
                  return updated;
                }));
              };

              const doAutoFillQuote = (r) => {
                const c2 = calcRow({ ...r, _supType: supType }, item);
                if (c2.quoteCalc > 0) updQuote(idx, 'quote_price', c2.quoteCalc.toFixed(2));
              };


              // ── stock hits for this item (used in supplier dropdown + banner)
              const _comp = (item.component||'').toLowerCase().trim();
              const _mfr  = (item.manufacturer||'').toLowerCase().trim();
              const stockHits = _mfr
                ? (stockByComponent[_comp + '|' + _mfr] || [])
                : (stockByComponent[_comp + '|'] || []);

              return (
                <div key={item.id} style={{
                  border: `2px solid ${mrow.aboveTarget ? '#fca5a5' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '12px 14px 14px',
                  marginBottom: 12,
                  background: mrow.aboveTarget ? '#fff5f5' : '#fff',
                  boxShadow: '0 2px 8px rgba(0,0,0,.07)',
                }}>

                  {/* ── Row 1: Component info banner ── */}
                  <div style={{ display:'flex', alignItems:'center', gap:0,
                    borderBottom:'1.5px solid var(--border)', paddingBottom:8, marginBottom:10 }}>

                    {/* LEFT: Supplier select */}
                    <div style={{flex:'0 0 240px'}}>
                      <span style={LBL}>Supplier</span>
                      <select className="input" value={row.supplier_id||''}
                        disabled={isReadOnly}
                        style={{width:240,height:32,fontSize:12,padding:'3px 6px',
                          borderColor: row.supplier_id?.startsWith('__inv__') ? '#86efac' : undefined,
                          color: row.supplier_id?.startsWith('__inv__') ? '#15803d' : undefined,
                        }}
                        onChange={e=>{
                          const supId=e.target.value;
                          // ── Internal stock holder selected ──
                          if (supId.startsWith('__inv__')) {
                            const invId = supId.slice(7);
                            const hit = stockHits.find(h => h.id === invId);
                            if (!hit) return;
                            const price = hit.target_price ? String(hit.target_price) : '';
                            const cur   = hit.target_currency || 'INR';
                            setSrcRows(p => p.map((r2,i) => i!==idx ? r2 : {
                              ...r2,
                              supplier_id: supId,
                              sourced_price: price,
                              sourced_currency: cur,
                              src_price_foreign: '',
                              exchange_rate: '',
                              insurance_pct:'0', duty_pct:'0', cess_pct:'0',
                              bank_fixed_foreign:'0', bank_fixed_inr:'0', clearance_fixed_inr:'0',
                            }));
                            if (price) {
                              const fakeRow = { sourced_price: price, sourced_currency: cur, src_price_foreign:'', exchange_rate:'', insurance_pct:'0', duty_pct:'0', cess_pct:'0', bank_fixed_foreign:'0', bank_fixed_inr:'0', clearance_fixed_inr:'0', freight_pct: row.freight_pct||'', margin_pct: row.margin_pct||'', _supType:'domestic' };
                              const c2 = calcRow(fakeRow, item);
                              if (c2.quoteCalc > 0) setQuoteRows(p=>p.map((q2,qi)=>qi!==idx?q2:{...q2,quote_currency:cur,quote_price:c2.quoteCalc.toFixed(2)}));
                            }
                            return;
                          }
                          // ── Normal supplier selected ──
                          const sup=suppliers.find(s=>s.id===supId);
                          const st=sup?.type||'domestic';
                          setSrcRows(p=>p.map((r2,i)=>{
                            if(i!==idx)return r2;
                            if(st==='domestic') return {
                              ...r2,
                              supplier_id:supId,
                              sourced_currency:'INR',
                              src_price_foreign:'',
                              exchange_rate:'',
                              sourced_price:'',
                              insurance_pct:'0',
                              duty_pct:'0',
                              cess_pct:'0',
                              bank_fixed_foreign:'0',
                              bank_fixed_inr:'0',
                              clearance_fixed_inr:'0',
                            };
                            const dc=(sup?.currency&&sup.currency!=='INR')?sup.currency:'USD';
                            return {...r2,supplier_id:supId,sourced_currency:dc,sourced_price:'',src_price_foreign:'',exchange_rate:''};
                          }));
                          setQuoteRows(p=>p.map((r2,i)=>i!==idx?r2:{...r2,quote_currency:'INR'}));
                        }}>
                        <option value="">— Select Supplier —</option>
                        {stockHits.length > 0 && (
                          <optgroup label="📦 IN STOCK">
                            {stockHits.map(h => (
                              <option key={'__inv__'+h.id} value={'__inv__'+h.id}>
                                {h.holder_type==='customer'?'👤':h.holder_type==='supplier'?'🏢':'🏭'}{' '}
                                {h.holder_display||h.holder_name||'Warehouse'}
                                {h.target_price ? ' — '+( h.target_currency||'INR')+' '+Number(h.target_price).toLocaleString('en-IN',{maximumFractionDigits:2}) : ''}
                                {' ('+h.quantity_available+' pcs)'}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {stockHits.length > 0 && <option disabled>──────────</option>}
                        {suppliers.map(s=><option key={s.id} value={s.id}>{s.name} {s.type==='domestic'?'🇮🇳':'🌐'}</option>)}
                      </select>
                    </div>

                    {/* MIDDLE: Component identity */}
                    <div style={{flex:1,display:'flex',alignItems:'center',gap:10,paddingLeft:12}}>
                      <span style={{fontWeight:800,fontSize:14,color:'var(--accent)',letterSpacing:-.2}}>
                        {item.component}
                      </span>
                      {item.manufacturer && (
                        <span style={{fontSize:12,color:'var(--text2)',fontWeight:500}}>{item.manufacturer}</span>
                      )}
                      {item.ipn && (
                        <span style={{fontSize:10,color:'#9ca3af',fontFamily:'monospace',background:'#f3f4f6',
                          padding:'1px 5px',borderRadius:3}}>IPN: {item.ipn}</span>
                      )}
                      <span style={{fontSize:11,fontWeight:700,color:'var(--accent2)',background:'#eff6ff',
                        padding:'1px 7px',borderRadius:3,border:'1px solid #bfdbfe'}}>
                        ×{item.quantity} pcs
                      </span>
                    </div>

                    {/* RIGHT: Target / DC / Delivery / Notes — pinned to right corner */}
                    <div style={{display:'flex',alignItems:'center',gap:6,paddingLeft:10,flexShrink:0}}>
                      {hasTarget && (
                        <span style={{
                          fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:700,
                          background: mrow.aboveTarget?'#fee2e2':'#dcfce7',
                          color: mrow.aboveTarget?'#dc2626':'#16a34a',
                          border:`1px solid ${mrow.aboveTarget?'#fca5a5':'#86efac'}`,
                          whiteSpace:'nowrap',
                        }}>
                          🎯 Target: {item.target_currency} {item.target_price}
                          {mrow.aboveTarget && ' ⚠'}
                        </span>
                      )}
                      {item.date_code && (
                        <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,
                          background:'#f3f4f6',color:'#6b7280',border:'1px solid #d1d5db',
                          fontWeight:600,whiteSpace:'nowrap'}}>DC: {item.date_code}</span>
                      )}
                      {item.preferred_delivery_date && (
                        <span style={{fontSize:10,padding:'2px 8px',borderRadius:4,
                          background:'#f0fdfa',color:'#0f766e',border:'1px solid #99f6e4',
                          fontWeight:600,whiteSpace:'nowrap'}}>📅 {item.preferred_delivery_date}</span>
                      )}
                      <input className="input" value={row.notes||''} placeholder="Notes…"
                        onChange={e=>updSrc(idx,'notes',e.target.value)} disabled={isReadOnly}
                        style={{width:180,height:32,fontSize:11,padding:'3px 8px',
                          background:'var(--surface)',color:'var(--text2)'}}/>
                    </div>
                  </div>

                  {/* ── Stock Check Banner (info only) ── */}
                  {stockHits.length > 0 && !row.supplier_id?.startsWith('__inv__') && (
                    <div style={{ marginBottom:8, padding:'5px 10px', background:'#f0fdf4',
                      border:'1.5px solid #86efac', borderRadius:'var(--r-sm)',
                      display:'flex', alignItems:'center', gap:8, fontSize:11 }}>
                      <span>📦</span>
                      <span style={{fontWeight:700,color:'#15803d'}}>In Stock:</span>
                      {stockHits.map(h=>(
                        <span key={h.id} style={{color:'#15803d',fontWeight:600}}>
                          {h.holder_type==='customer'?'👤':h.holder_type==='supplier'?'🏢':'🏭'}{' '}
                          {h.holder_display||h.holder_name||'Warehouse'} — {h.quantity_available} pcs
                          {h.target_price ? ' @ '+(h.target_currency||'INR')+' '+Number(h.target_price).toLocaleString('en-IN',{maximumFractionDigits:2}) : ''}
                        </span>
                      ))}
                      <span style={{color:'#16a34a',marginLeft:4}}>↑ Select from supplier dropdown above</span>
                    </div>
                  )}

                  {/* ── ROW 1: All Input Fields — flex, fills full width ── */}
                  <div style={{
                    display:'flex', alignItems:'flex-end', gap:6,
                    width:'100%', overflowX:'auto', paddingBottom:2,
                  }}>

                    {/* HSN */}
                    <div style={{flex:'1 1 60px',minWidth:52}}>
                      <span style={LBL}>HSN Code</span>
                      <input className="input" value={row.hsn_code||''} placeholder="HSN"
                        onChange={e=>updSrc(idx,'hsn_code',e.target.value)} disabled={isReadOnly}
                        style={{width:'100%',height:32,fontSize:12,padding:'3px 7px'}}/>
                    </div>

                    {/* Lead Time */}
                    <div style={{flex:'1 1 100px',minWidth:94}}>
                      <span style={LBL}>Lead Time</span>
                      <div style={{display:'flex',gap:3}}>
                        <input className="input" type="number" min="1"
                          value={(row.lead_time||'').replace(/[^0-9]/g,'')} placeholder="0"
                          disabled={isReadOnly}
                          onChange={e=>{const u=(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days';updSrc(idx,'lead_time',e.target.value?e.target.value+' '+u:'');}}
                          style={{width:42,height:32,fontSize:12,padding:'3px 5px'}}/>
                        <select className="input"
                          value={(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days'}
                          disabled={isReadOnly}
                          onChange={e=>{const n=(row.lead_time||'').replace(/[^0-9]/g,'')||'';updSrc(idx,'lead_time',n?n+' '+e.target.value:'');}}
                          style={{width:56,height:32,fontSize:12,padding:'3px 4px'}}>
                          <option>Days</option><option>Weeks</option><option>Months</option>
                        </select>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{flex:'0 0 1px',alignSelf:'stretch',background:'var(--border)',margin:'0 1px'}}/>

                    {isIntl ? (<>
                      {/* CCY */}
                      <div style={{flex:'1 1 52px',minWidth:46}}>
                        <span style={LBL}>CCY</span>
                        <select className="input" value={cur} disabled={isReadOnly}
                          onChange={e=>updSrc(idx,'sourced_currency',e.target.value)}
                          style={{width:'100%',height:32,fontSize:12,padding:'3px 4px'}}>
                          {ALL_CURRENCIES.filter(c=>c!=='INR').map(c=><option key={c}>{c}</option>)}
                        </select>
                      </div>

                      {/* Src Price foreign */}
                      <div style={{flex:'1 1 70px',minWidth:65}}>
                        <span style={LBL}>Src Price ({cur})</span>
                        <input className="input" type="number" step="0.0001" min="0"
                          value={row.src_price_foreign||''} placeholder="0.00" disabled={isReadOnly}
                          onChange={e=>handleRateChange('src_price_foreign',e.target.value)}
                          style={{width:'100%',height:32,fontSize:12,padding:'3px 7px'}}/>
                      </div>

                      {/* 1CCY=₹ Rate */}
                      <div style={{flex:'1 1 65px',minWidth:60}}>
                        <span style={LBL}>1{cur}=₹</span>
                        <input className="input" type="number" step="0.01" min="0"
                          value={row.exchange_rate||''} placeholder="e.g. 95" disabled={isReadOnly}
                          onChange={e=>handleRateChange('exchange_rate',e.target.value)}
                          style={{width:'100%',height:32,fontSize:12,padding:'3px 7px',fontWeight:700}}/>
                      </div>

                      {/* Src ₹ INR — auto read-only */}
                      <div style={{flex:'1 1 68px',minWidth:60}}>
                        <span style={{...LBL,color:Number(row.sourced_price)>0?'#15803d':'var(--text3)'}}>Src ₹ INR</span>
                        <div style={{...roStyle(Number(row.sourced_price)>0?'#15803d':'var(--text3)',Number(row.sourced_price)>0?'#f0fdf4':'var(--surface2)'),
                          width:'100%',height:32,border:`1.5px solid ${Number(row.sourced_price)>0?'#86efac':'var(--border)'}`}}>
                          {Number(row.sourced_price)>0?`₹${fmt(Number(row.sourced_price))}`:'—'}
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{flex:'0 0 1px',alignSelf:'stretch',background:'var(--border)',margin:'0 1px'}}/>

                      {/* Intl rate fields */}
                      {[
                        {k:'freight_pct',        l:'Frgt%'},
                        {k:'insurance_pct',      l:'Ins%'},
                        {k:'duty_pct',           l:'Duty%'},
                        {k:'cess_pct',           l:'Cess%'},
                        {k:'bank_fixed_foreign', l:`Bank(${cur})`},
                        {k:'clearance_fixed_inr',l:'Clr₹'},
                        {k:'margin_pct',         l:'Mgn%'},
                      ].map(({k,l})=>(
                        <div key={k} style={{flex:'1 1 46px',minWidth:42}}>
                          <span style={LBL}>{l}</span>
                          <input className="input" type="number" step="0.001"
                            value={row[k]??''} placeholder="0" disabled={isReadOnly}
                            onChange={e=>handleRateChange(k,e.target.value)}
                            style={{width:'100%',height:32,fontSize:12,padding:'3px 6px'}}/>
                        </div>
                      ))}

                    </>) : (<>

                      {/* Src Price ₹ — domestic */}
                      <div style={{flex:'1 1 80px',minWidth:75}}>
                        <span style={LBL}>Src Price ₹</span>
                        <input className="input" type="number" step="0.01"
                          value={row.sourced_price||''} placeholder="₹ 0.00" disabled={isReadOnly}
                          onChange={e=>handleRateChange('sourced_price',e.target.value)}
                          style={{width:'100%',height:32,fontSize:12,padding:'3px 7px'}}/>
                      </div>

                      {/* Divider */}
                      <div style={{flex:'0 0 1px',alignSelf:'stretch',background:'var(--border)',margin:'0 1px'}}/>

                      {/* Domestic rate fields — same as intl, bank in ₹, no exchange rate */}
                      {[
                        {k:'freight_pct',        l:'Frgt%'},
                        {k:'insurance_pct',      l:'Ins%'},
                        {k:'duty_pct',           l:'Duty%'},
                        {k:'cess_pct',           l:'Cess%'},
                        {k:'bank_fixed_inr',     l:'Bank₹'},
                        {k:'clearance_fixed_inr',l:'Clr₹'},
                        {k:'margin_pct',         l:'Mgn%'},
                      ].map(({k,l})=>(
                        <div key={k} style={{flex:'1 1 46px',minWidth:42}}>
                          <span style={LBL}>{l}</span>
                          <input className="input" type="number" step="0.001"
                            value={domesticZeroLocked.includes(k) ? '0' : (row[k]??'')} placeholder="0"
                            disabled={isReadOnly || domesticZeroLocked.includes(k)}
                            onChange={e=>handleRateChange(k,e.target.value)}
                            style={{
                              width:'100%',height:32,fontSize:12,padding:'3px 6px',
                              background: domesticZeroLocked.includes(k) ? 'var(--surface2)' : undefined,
                              color: domesticZeroLocked.includes(k) ? 'var(--text3)' : undefined,
                            }}/>
                        </div>
                      ))}

                    </>)}

                    {/* Divider before quote fields */}
                    <div style={{flex:'0 0 1px',alignSelf:'stretch',background:'var(--border)',margin:'0 1px'}}/>

                    {/* Quote Currency */}
                    <div style={{flex:'1 1 55px',minWidth:48}}>
                      <span style={LBL}>Q.Cur</span>
                      <select className="input" value={qrow.quote_currency||'INR'}
                        onChange={e=>updQuote(idx,'quote_currency',e.target.value)}
                        disabled={isReadOnly}
                        title={`Select quote currency - ${getTaxRatesForCurrency(qrow.quote_currency||'INR').country}`}
                        style={{width:'100%',height:32,fontSize:12,padding:'3px 4px'}}>
                        {ALL_CURRENCIES.map(c=><option key={c} title={getTaxRatesForCurrency(c).country}>{c}</option>)}
                      </select>
                    </div>

                    {/* Quote Price */}
                    <div style={{flex:'1 1 88px',minWidth:80}}>
                      <span style={{...LBL,color:qrow.quote_price?'#15803d':'var(--text3)'}}>Quote Price</span>
                      <input className="input" type="number" step="0.01"
                        value={qrow.quote_price||''} placeholder="0.00" disabled={isReadOnly}
                        onChange={e=>updQuote(idx,'quote_price',e.target.value)}
                        style={{width:'100%',height:32,fontSize:12,padding:'3px 7px',fontWeight:700,
                          background:qrow.quote_price?'#f0fdf4':'',
                          borderColor:mrow.quoteAbove?'#ef4444':qrow.quote_price?'#22c55e':undefined,
                          borderWidth:qrow.quote_price?1.5:1}}/>
                    </div>

                    {/* GST */}
                    <div style={{flex:'1 1 82px',minWidth:75}}>
                      <span style={LBL}>{supplierTaxCurrency==='INR'?'GST':'Tax/VAT'}</span>
                      <select className="input" value={qrow.tax_rate??''}
                        onChange={e=>updQuote(idx,'tax_rate',e.target.value)} disabled={isReadOnly}
                        title={`Tax from supplier currency (${supplierTaxCurrency}) - ${getTaxRatesForCurrency(supplierTaxCurrency).country}`}
                        style={{width:'100%',height:32,fontSize:12,padding:'3px 4px'}}>
                        <option value="">—None—</option>
                        {getTaxRates(supplierTaxCurrency).map(t=>(
                          <option key={t.label} value={t.rate}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Price with GST — auto read-only */}
                    {(() => {
                      const qp  = Number(qrow.quote_price) || 0;
                      const tax = Number(qrow.tax_rate);
                      const withGST = (qp > 0 && tax > 0) ? qp * (1 + tax / 100) : null;
                      return (
                        <div style={{flex:'1 1 88px',minWidth:80}}>
                          <span style={{...LBL,color: withGST ? 'var(--accent)' : '#9ca3af'}}>
                            Price w/ {supplierTaxCurrency==='INR'?'GST':'Tax'}
                          </span>
                          <div style={{
                            height:32, fontSize:12, padding:'3px 8px',
                            background: withGST ? 'var(--accent-lt)' : 'var(--surface2)',
                            border: `1.5px solid ${withGST ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius:'var(--r-sm)', fontWeight:700,
                            color: withGST ? 'var(--accent)' : 'var(--text3)',
                            display:'flex', alignItems:'center', whiteSpace:'nowrap',
                          }}>
                            {withGST ? `${qrow.quote_currency==='INR'?'₹':''}${fmt(withGST)}` : '—'}
                          </div>
                        </div>
                      );
                    })()}

                  </div>{/* end ROW 1 flex */}

                  {/* ── ROW 2: Auto-calculated breakdown strip ── */}
                  {Number(row.sourced_price) > 0 && (
                    <div style={{
                      display:'flex', gap:0, marginTop:8,
                      background:'var(--surface)',
                      border:'1.5px solid var(--border)',
                      borderRadius:6, overflow:'hidden',
                    }}>
                      {/* Label tab */}
                      <div style={{padding:'0 10px',display:'flex',alignItems:'center',
                        background:'var(--surface2)', borderRight:'1.5px solid var(--border)',
                        flexShrink:0}}>
                        <span style={{fontSize:9,fontWeight:800,letterSpacing:.8,
                          color:'var(--text3)',whiteSpace:'nowrap'}}>
                          AUTO CALC
                        </span>
                      </div>

                      {/* Breakdown tiles */}
                      {[
                        { l:'Freight ₹',    v:calc.freight   },
                        { l:'Insurance ₹',  v:calc.insurance },
                        { l:'Duty ₹',       v:calc.duty      },
                        { l:'Cess ₹',       v:calc.cess      },
                        { l:'Bank ₹',       v:calc.bank      },
                        { l:'Clearance ₹',  v:calc.clearance },
                        { l:'Margin ₹',     v:calc.margin,   col:'#7c3aed' },
                      ].map(({l,v,col},ci,arr)=>(
                        <div key={l} style={{
                          flex:1, padding:'5px 10px',
                          borderRight: ci<arr.length-1 ? '1px solid var(--border)' : 'none',
                          display:'flex',flexDirection:'column',gap:2,minWidth:58,
                        }}>
                          <span style={{fontSize:9,color:'var(--text3)',letterSpacing:.3,fontWeight:600,textTransform:'uppercase'}}>{l}</span>
                          <span style={{fontSize:12,fontWeight:700,color: v>0 ? (col||'var(--text)') : 'var(--border2)'}}>
                            {v>0 ? `₹${fmt(v)}` : '—'}
                          </span>
                        </div>
                      ))}

                      {/* = Quote / Unit */}
                      {calc.quoteCalc > 0 && (
                        <div style={{
                          padding:'5px 14px', flexShrink:0,
                          display:'flex',flexDirection:'column',gap:2,
                          background:'var(--accent-lt)',
                          borderLeft:'1.5px solid var(--accent)',
                        }}>
                          <span style={{fontSize:9,color:'var(--accent)',letterSpacing:.3,fontWeight:700,textTransform:'uppercase'}}>= Quote / Unit</span>
                          <span style={{fontSize:14,fontWeight:800,color:'var(--accent)',whiteSpace:'nowrap'}}>
                            ₹{fmt(calc.quoteCalc)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Revision chat icon inline if needed */}
                  {isRevision && (() => {
                    const sc = (enq.sourcing||[]).find(s=>s.enquiry_item_id===item.id)?.sales_comment;
                    return sc ? (
                      <div style={{marginTop:4,padding:'4px 8px',borderRadius:4,
                        background:'#fffbeb',border:'1px solid #fde68a',
                        fontSize:10,color:'#b45309',fontWeight:600}}>
                        💬 Sales: "{sc}"
                      </div>
                    ) : null;
                  })()}
                  {isRevision && (
                    <input className="input" value={srcRevNotes[item.id]||''}
                      onChange={e=>setSrcRevNotes(n=>({...n,[item.id]:e.target.value}))}
                      placeholder="Your note to Sales (optional)…"
                      style={{marginTop:4,fontSize:11,width:'100%',height:26}}/>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Margin Summary ────────────────────────────── */}
          <div className="card card-sm" style={{ marginBottom:0, border:'1px solid rgba(27,79,158,.2)' }}>
            <div className="card-title">📊 Margin Summary</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { label:'Total Source Value (₹ INR)', val: md.totalSrcValue,   cur: 'INR', color:'var(--accent)' },
                { label:'Total Quote Value',          val: md.totalQuoteValue, cur: quoteRows[0]?.quote_currency||'INR', color:'var(--green)' },
                {
                  label:'Gross Margin (Quote − Source)',
                  val:  md.totalGrossMargin,
                  cur:  'INR',
                  color: md.totalGrossMargin >= 0 ? 'var(--green)' : 'var(--red)',
                  sub:  `${md.grossMarginPct >= 0 ? '+' : ''}${md.grossMarginPct.toFixed(1)}%`
                },
                {
                  label:'Net Margin (after all charges)',
                  val:  md.totalNetMargin,
                  cur:  'INR',
                  color: md.totalNetMargin >= 0 ? 'var(--teal)' : 'var(--red)',
                  sub:  `Addl. costs: ₹${fmt(md.addlCost)} · ${md.netMarginPct >= 0 ? '+' : ''}${md.netMarginPct.toFixed(1)}%`
                },
              ].map(s => (
                <div key={s.label} style={{ background:'var(--surface2)', borderRadius:'var(--r)', padding:'14px 16px', borderLeft:`4px solid ${s.color}`, boxShadow:`0 0 0 1px ${s.color}22` }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:6, fontWeight:700, letterSpacing:.2 }}>{s.label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color:s.color, letterSpacing:'-.03em', lineHeight:1.1 }}>
                    {s.val !== 0 ? fmtC(s.val, s.cur) : '—'}
                  </div>
                  {s.sub && <div style={{ fontSize:12, color:s.color, marginTop:5, fontWeight:700, opacity:.85 }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Per-item margin table */}
            {md.rows.some(r => r.srcUnit > 0 && r.quoteUnit > 0) && (
              <div style={{ marginTop:14, overflowX:'auto' }}>
                <table className="li-table">
                  <thead>
                    <tr>
                      <th>Component</th><th>Qty</th>
                      <th>Source/Unit</th><th>Quote/Unit</th>
                      <th>Gross Margin/Unit</th><th>Gross Margin Total</th>
                      <th>vs Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(enq.items||[]).map((item, idx) => {
                      const m   = md.rows[idx] || {};
                      const src = srcRows[idx]   || {};
                      const q   = quoteRows[idx] || {};
                      if (!m.srcUnit && !m.quoteUnit) return null;
                      const isIntlRow   = m.srcCurrency && m.srcCurrency !== 'INR' && m.exchangeRate > 1;
                      const foreignSrc  = isIntlRow ? m.srcForeign : 0;
                      const marginForeign = (isIntlRow && m.exchangeRate > 1) ? (m.grossMarginUnit / m.exchangeRate) : null;
                      return (
                        <tr key={item.id}>
                          <td className="bold" style={{ fontSize:18 }}>{item.component}</td>
                          <td>{item.quantity}</td>
                          <td className="mono" style={{ color:'var(--accent)', fontSize:11 }}>
                            {m.srcUnit ? (
                              isIntlRow ? (
                                <span>
                                  {fmtC(foreignSrc, m.srcCurrency)}
                                  <span style={{color:'var(--text3)',fontSize:9,display:'block'}}>=₹{fmt(m.srcUnit)}</span>
                                </span>
                              ) : fmtC(m.srcUnit, 'INR')
                            ) : '—'}
                          </td>
                          <td className="mono" style={{ color:'var(--green)', fontSize:11 }}>{m.quoteUnit ? fmtC(m.quoteUnit, q.quote_currency||'INR') : '—'}</td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginUnit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginUnit ? (
                              <span>
                                {m.grossMarginUnit >= 0?'+':''}{fmtC(m.grossMarginUnit, 'INR')}
                                {marginForeign != null && <span style={{color:'var(--text3)',fontSize:9,display:'block'}}>{marginForeign >= 0?'+':''}{fmtC(marginForeign, m.srcCurrency)}</span>}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginTotal ? `${m.grossMarginTotal >= 0?'+':''}${fmtC(m.grossMarginTotal, 'INR')}` : '—'}
                          </td>
                          <td>
                            {Number(item.target_price) > 0 ? (
                              <span style={{
                                background: m.aboveTarget ? 'var(--red)' : 'var(--green-lt)',
                                color: m.aboveTarget ? '#fff' : 'var(--green)',
                                padding:'2px 8px', borderRadius:999, fontSize:10, fontWeight:600
                              }}>
                                {m.aboveTarget ? '⚠ Above' : '✓ Within'} {item.target_currency} {item.target_price}
                              </span>
                            ) : <span className="muted">—</span>}
                          </td>
                        </tr>
                      );
                    }).filter(Boolean)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer buttons ────────────────────────────── */}
        <div className="modal-footer" style={{ justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <button className="btn" onClick={onClose}>Close</button>

          {isReadOnly ? (
            /* ── Read-only banner: already sent to Quote Bin ── */
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px',
              background:'var(--green-lt,#f0fdf4)', border:'1px solid var(--green,#16a34a)',
              borderRadius:'var(--r)', fontSize:12, color:'var(--green,#16a34a)', fontWeight:600 }}>
              <span style={{fontSize:16}}>✅</span>
              Sourcing completed — view only
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div className="flex gap-8">

                {/* Save as Draft — saves data and closes modal */}
                <button
                  className="btn"
                  disabled={saving}
                  onClick={() => handleSave('draft')}
                  style={{ display:'flex', alignItems:'center', gap:6 }}
                >
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 2v5h6V2"/><rect x="9" y="2" width="2" height="3"/></svg>
                  {saving && saveMode==='draft' ? 'Saving…' : 'Save as Draft'}
                </button>

                {/* Conditional: Revision → Return to Quote Bin | Normal → Send to Quote Bin */}
                {isRevision ? (
                  <button
                    className="btn btn-primary"
                    disabled={saving || !allFieldsFilled}
                    onClick={() => handleSave('return_revision')}
                    title={!allFieldsFilled ? 'Fill Supplier, Src Price, Lead Time and Quote Price for all items first' : ''}
                    style={{ display:'flex', alignItems:'center', gap:6,
                      background: allFieldsFilled ? 'var(--amber,#d97706)' : 'var(--border)',
                      borderColor: allFieldsFilled ? 'var(--amber,#d97706)' : 'var(--border)',
                      color: allFieldsFilled ? '#fff' : 'var(--text3)',
                      cursor: allFieldsFilled ? 'pointer' : 'not-allowed',
                      opacity: allFieldsFilled ? 1 : 0.6 }}
                  >
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                    {saving && saveMode==='return_revision'
                      ? 'Returning…'
                      : '↩ Return to Quote Bin — ' + (pendingRevision?.quote_no||'Revision')}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    disabled={saving || !allFieldsFilled}
                    onClick={() => handleSave('quote')}
                    title={!allFieldsFilled ? 'Fill Supplier, Src Price, Lead Time and Quote Price for all items first' : ''}
                    style={{ display:'flex', alignItems:'center', gap:6,
                      background: allFieldsFilled ? 'var(--accent)' : 'var(--border)',
                      borderColor: allFieldsFilled ? 'var(--accent)' : 'var(--border)',
                      color: allFieldsFilled ? '#fff' : 'var(--text3)',
                      cursor: allFieldsFilled ? 'pointer' : 'not-allowed',
                      opacity: allFieldsFilled ? 1 : 0.6 }}
                  >
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                    {saving && saveMode==='quote' ? 'Sending...' : 'Send to Quote Bin ->'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Sourcing Bin Page ───────────────────────────────────
export default function SourcingBinPage() {
  const qc = useQueryClient();
  const [selected, setSelected]         = useState(null);
  const [search, setSearch]             = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  // ADDED: status filter — All / New (sourcing) / Moved to Quote (quoted)
  const [statusFilter, setStatusFilter]     = useState('all');
  const [markedForDelete, setMarkedForDelete] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const { user } = useAuth();
  const isAdmin = ['admin','manager'].includes(user?.role);

  const { data: enquiries=[], isLoading } = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data), refetchInterval:20000 });
  const { data: customers=[] }  = useQuery({ queryKey:['customers'],  queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: suppliers=[] }  = useQuery({ queryKey:['suppliers'],  queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: users=[] }      = useQuery({ queryKey:['users'],      queryFn:()=>api.get('/users').then(r=>r.data) });
  const { data: quotes=[] }     = useQuery({ queryKey:['quotes'],     queryFn:()=>api.get('/quotes').then(r=>r.data) });
  const { data: orders=[] }     = useQuery({ queryKey:['orders'],     queryFn:()=>api.get('/orders').then(r=>r.data).catch(()=>[]) });

  const custName = id => customers.find(c=>c.id===id)?.name || id;
  const userName = id => users.find(u=>u.id===id)?.name || 'Unassigned';

  // Hide enquiries whose revision has already been returned to Quote Bin by sourcing.
  // An enquiry is "done" in sourcing if: status='sourcing' BUT a revision quote
  // (revision > 1) exists and is 'active' — sourcing has already sent it back.
  const hasRevisionReturned = (enq) => {
    const rev = (quotes||[]).find(q =>
      q.enquiry_id === enq.id && q.status === 'active'
    );
    return !!rev;
  };

  // If enquiry is already converted into an order, it must not stay editable in sourcing bin.
  const hasDownstreamOrder = (enq) => {
    return (orders || []).some(o =>
      o.enquiry_id === enq.id && !['cancelled', 'deleted'].includes((o.status || '').toLowerCase())
    );
  };
  // CHANGED: binEnqs includes sourcing + quoted + returned_to_sourcing + completed(old sourcing)
  const binEnqs = enquiries.filter(e => {
    if (statusFilter === 'sourcing')             return e.status === 'sourcing' && !hasRevisionReturned(e);
    if (statusFilter === 'quoted')               return e.status === 'quoted';
    if (statusFilter === 'returned_to_sourcing') return e.status === 'returned_to_sourcing';
    if (statusFilter === 'completed')            return ['ordered','order_created'].includes(e.status) || hasDownstreamOrder(e);
    // 'all': sourcing + quoted + returned_to_sourcing + completed
    return (e.status === 'sourcing' && !hasRevisionReturned(e))
        || e.status === 'quoted'
        || e.status === 'returned_to_sourcing'
        || ['ordered','order_created'].includes(e.status)
        || hasDownstreamOrder(e);
  });

  const visibleEnquiries = enquiries;

  const filtered = binEnqs.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
    const matchPri = priorityFilter === 'all' || e.priority === priorityFilter;
    return matchSearch && matchPri;
  }).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

  const total      = binEnqs.length;
  const urgent     = binEnqs.filter(e=>e.priority==='urgent').length;
  const high       = binEnqs.filter(e=>e.priority==='high').length;
  const unassigned = binEnqs.filter(e=>!e.assigned_to).length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:13, marginBottom:18 }}>
        {[
          { label:'In Sourcing Bin', val:total,       color:'var(--accent)',  sub:'enquiries to process' },
          { label:'Urgent',          val:urgent,      color:'var(--red)',     sub:'need immediate action' },
          { label:'High Priority',   val:high,        color:'var(--amber)',   sub:'process next' },
          { label:'Unassigned',      val:unassigned,  color:'var(--purple)',  sub:'not yet assigned' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft:`3px solid ${s.color}` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color:s.color }}>{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Search + filter — NO New Enquiry button */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search sourcing bin…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {/* ADDED: status filter chips — All / New / Moved to Quote / Revision */}
        <div className="filter-row" style={{ marginBottom:0 }}>
          {[
            { v:'all',                   l:`All (${visibleEnquiries.filter(e=>(e.status==='sourcing'&&!hasRevisionReturned(e))||e.status==='quoted'||e.status==='returned_to_sourcing'||['ordered','order_created'].includes(e.status)||hasDownstreamOrder(e)).length})` },
            { v:'sourcing',              l:`New (${visibleEnquiries.filter(e=>e.status==='sourcing'&&!hasRevisionReturned(e)).length})` },
            { v:'quoted',                l:`Moved to Quote (${visibleEnquiries.filter(e=>e.status==='quoted').length})` },
            { v:'returned_to_sourcing',  l:`Revision Needed (${visibleEnquiries.filter(e=>e.status==='returned_to_sourcing').length})` },
            { v:'completed',             l:`Completed (${visibleEnquiries.filter(e=>['ordered','order_created'].includes(e.status)||hasDownstreamOrder(e)).length})` },
          ].map(f => (
            <span key={f.v} className={`fchip ${statusFilter===f.v?'active':''}`} onClick={()=>setStatusFilter(f.v)}>
              {f.l}
            </span>
          ))}
        </div>
        <div className="filter-row" style={{ marginBottom:0 }}>
          {['all','urgent','high','normal'].map(p => (
            <span key={p} className={`fchip ${priorityFilter===p?'active':''}`} onClick={()=>setPriorityFilter(p)}>
              {p === 'all' ? 'All Priority' : p.charAt(0).toUpperCase()+p.slice(1)}
            </span>
          ))}
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading sourcing bin…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-state-text">
            {binEnqs.length === 0
              ? 'Sourcing bin is empty — no enquiries sent to sourcing yet.'
              : 'No enquiries match your filter'}
          </div>
        </div>
      )}

      {/* Admin delete bar */}
      {isAdmin && markedForDelete.size>0 && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
          marginBottom:8,background:'var(--red-lt,#fef2f2)',borderRadius:'var(--r)',
          border:'1px solid var(--red)33'}}>
          <span style={{fontSize:13,fontWeight:600,color:'var(--red)'}}>
            {markedForDelete.size} enquir{markedForDelete.size>1?'ies':'y'} selected
          </span>
          <button className="btn btn-sm btn-danger" onClick={()=>setConfirmBulkDelete(true)}>🗑 Delete Selected</button>
          <button className="btn btn-xs" onClick={()=>setMarkedForDelete(new Set())}>Cancel</button>
        </div>
      )}

      {confirmBulkDelete && (
        <ConfirmDeleteModal
          message={`Are you sure you want to delete ${markedForDelete.size} enquir${markedForDelete.size>1?'ies':'y'}? This cannot be undone.`}
          onConfirm={async()=>{
            setConfirmBulkDelete(false);
            try{
              await api.request({method:'DELETE',url:'/enquiries',data:{ids:[...markedForDelete]}});
              toast.success(`Deleted ${markedForDelete.size} enquir${markedForDelete.size>1?'ies':'y'}`);
              setMarkedForDelete(new Set());
              qc.invalidateQueries(['enquiries']);qc.invalidateQueries(['summary']);
            }catch(e){toast.error('Delete failed');}
          }}
          onCancel={()=>setConfirmBulkDelete(false)}
        />
      )}

      {/* Cards */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {isAdmin && <th style={{width:28}}/>}
              <th>ENQ / SOUR</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Buying Type</th>
              <th>Priority</th>
              <th>Sourcing Progress</th>
              <th style={{textAlign:'center'}}>Days in Stage</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th style={{textAlign:'right'}}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin ? 11 : 10}>
                <div className="empty-state">
                  <div className="empty-icon">🔍</div>
                  <div>{binEnqs.length === 0 ? 'Sourcing bin is empty — no enquiries sent to sourcing yet.' : 'No enquiries match your filter'}</div>
                </div>
              </td></tr>
            )}
            {filtered.map(enq => {
              const srcDone  = (enq.sourcing||[]).filter(s => s.sourced_price).length;
              const srcTotal = (enq.items||[]).length;
              const srcPct   = srcTotal ? Math.round(srcDone / srcTotal * 100) : 0;
              const isUrgent = enq.priority === 'urgent';
              const isHigh   = enq.priority === 'high';
              const hasMarginData = (enq.sourcing||[]).some(s => s.sourced_price && s.quote_price);
              const quickSrc   = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.sourced_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
              const quickQuote = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.quote_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
              const quickGross = quickQuote - quickSrc;

              return (
                <tr
                  key={enq.id}
                  className="clickable"
                  style={{ borderLeft: isUrgent ? '3px solid var(--red)' : isHigh ? '3px solid var(--amber)' : undefined }}
                  onClick={() => setSelected(enq)}
                >
                  {isAdmin && (
                    <td onClick={e=>e.stopPropagation()}>
                      <input type="checkbox"
                        checked={markedForDelete.has(enq.id)}
                        onChange={e=>{setMarkedForDelete(prev=>{const n=new Set(prev);n.has(enq.id)?n.delete(enq.id):n.add(enq.id);return n;});}}
                        style={{accentColor:'var(--red)',cursor:'pointer',width:14,height:14}}/>
                    </td>
                  )}
                  {/* ENQ / SOUR */}
                  <td>
                    <div className="mono" style={{fontSize:12,color:'var(--text3)'}}>{enq.id}</div>
                    {enq.sourcing_no && (
                      <div style={{marginTop:2}}>
                        <span className="mono bold" style={{fontSize:11,color:'var(--accent)',
                          background:'var(--accent-lt)',padding:'1px 6px',borderRadius:999,
                          border:'1px solid var(--accent)33'}}>
                          🔍 {enq.sourcing_no}
                        </span>
                      </div>
                    )}
                  </td>
                  {/* Customer */}
                  <td style={{fontWeight:600}}>{custName(enq.customer_id)}</td>
                  {/* Items */}
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span className="badge badge-blue">{srcTotal}</span>
                      {(enq.items||[]).slice(0,2).map(i=>(
                        <span key={i.id} style={{fontSize:11,color:'var(--text2)'}}>{i.component}</span>
                      ))}
                      {srcTotal > 2 && <span style={{fontSize:11,color:'var(--text3)'}}>+{srcTotal-2} more</span>}
                    </div>
                  </td>
                  {/* Buying Type */}
                  <td>
                    {enq.buying_type
                      ? <span className="badge badge-purple">{enq.buying_type}</span>
                      : <span className="muted">—</span>}
                  </td>
                  {/* Priority */}
                  <td>
                    <span className={`badge ${isUrgent?'badge-red':isHigh?'badge-amber':'badge-gray'}`}>
                      {enq.priority}
                    </span>
                  </td>
                  {/* Sourcing Progress */}
                  <td style={{minWidth:120}}>
                    <div style={{fontSize:11,color:'var(--text2)',marginBottom:3,display:'flex',justifyContent:'space-between'}}>
                      <span>{srcDone}/{srcTotal} priced</span>
                      <span style={{fontWeight:600,color:srcPct===100?'var(--green)':'inherit'}}>{srcPct}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{width:`${srcPct}%`,background:srcPct===100?'var(--green)':srcPct>50?'var(--accent)':'var(--amber)'}}/>
                    </div>
                    {hasMarginData && (
                      <div style={{fontSize:10,fontWeight:700,marginTop:3,
                        color:quickGross>=0?'var(--green)':'var(--red)'}}>
                        {quickGross>=0?'+':''}{fmt(quickGross)} margin
                      </div>
                    )}
                  </td>
                  {/* Days in Stage */}
                  <td><DaysBadge updatedAt={enq.updated_at||enq.created_at} /></td>
                  {/* Status */}
                  <td><StatusBadge s={enq.status}/></td>
                  {/* Assigned To */}
                  <td style={{fontSize:12}}>{userName(enq.assigned_to)}</td>
                  {/* Action */}
                  <td style={{textAlign:'right'}} onClick={e=>e.stopPropagation()}>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => setSelected(enq)}
                    >
                      {(enq.status === 'quoted' || ['ordered','order_created'].includes(enq.status) || hasDownstreamOrder(enq))
                        ? 'View'
                        : enq.status === 'returned_to_sourcing'
                          ? 'Review Revision'
                          : srcPct === 0
                            ? 'Start'
                            : srcPct === 100
                              ? 'Review'
                              : 'Continue'}
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
          forceReadOnly={hasDownstreamOrder(selected) || ['ordered','order_created'].includes(selected.status)}
          onClose={() => setSelected(null)}
          onSaved={() => {
            qc.invalidateQueries(['enquiries']);
            qc.invalidateQueries(['quotes']);
            qc.invalidateQueries(['summary']);
            setSelected(null);
          }}
          onSavedDraft={() => {
            // Refresh data quietly in background — modal stays open, ENQ stays in bin
            qc.invalidateQueries(['enquiries']);
            qc.invalidateQueries(['quotes']);
          }}
        />
      )}
    </div>
  );
}
