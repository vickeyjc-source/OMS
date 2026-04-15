// client/src/pages/SourcingBinPage.js  v3
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { StatusBadge, ENQ_STATUSES } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

const ALL_CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF',
  'CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK',
  'HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR',
  'KMF','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA',
  'MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO',
  'NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD',
  'RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLL','SOS','SRD','STN','SYP',
  'SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU',
  'UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW','ZWL'
];

// ── Tax rates by currency ─────────────────────────────────────────────────────
const TAX_RATES_INR = [
  { label:'GST 0%',  rate:0  },
  { label:'GST 5%',  rate:5  },
  { label:'GST 12%', rate:12 },
  { label:'GST 18%', rate:18 },
  { label:'GST 28%', rate:28 },
];
const TAX_RATES_INTL = [
  { label:'No Tax (0%)', rate:0  },
  { label:'VAT 5%',      rate:5  },
  { label:'VAT 7%',      rate:7  },
  { label:'VAT 10%',     rate:10 },
  { label:'VAT 15%',     rate:15 },
  { label:'VAT 20%',     rate:20 },
  { label:'VAT 21%',     rate:21 },
];
const getTaxRates = (currency) => currency === 'INR' ? TAX_RATES_INR : TAX_RATES_INTL;


const fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);
const fmtC = (n, c) => {
  const sym = { INR:'₹', USD:'$', EUR:'€', GBP:'£', SGD:'S$', AED:'د.إ', JPY:'¥', CNY:'¥', AUD:'A$', CAD:'C$' };
  return `${sym[c] || c + ' '}${fmt(n)}`;
};

// ── SourcingModal ────────────────────────────────────────────
function SourcingModal({ enq, suppliers, customers, users, quotes, onClose, onSaved }) {
  const { user } = useAuth();

  // Sourcing rows — one per item
  const [srcRows, setSrcRows] = useState(() =>
    (enq.items || []).map(item => {
      const ex = (enq.sourcing || []).find(s => s.enquiry_item_id === item.id);
      return ex
        ? { ...ex }
        : { id: null, enquiry_item_id: item.id, supplier_id: '', sourced_price: '', sourced_currency: 'INR', availability: '', lead_time: '', notes: '' };
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
    customs:  enq.charges?.customs  || '',
    handling: enq.charges?.handling || '',
    freight:  enq.charges?.freight  || '',
    bank:     enq.charges?.bank     || '',
    currency: enq.charges?.currency || 'INR',
    notes:    enq.charges?.notes    || '',
  });

  const [assignTo, setAssignTo] = useState(enq.assigned_to || '');
  const [saving, setSaving]     = useState(false);
  const [saveMode, setSaveMode] = useState('');

  const custName = id => customers.find(c => c.id === id)?.name || id;
  const supName  = id => suppliers.find(s => s.id === id)?.name || '—';
  const srcingUsers = users.filter(u => u.department === 'sourcing' || ['admin','manager'].includes(u.role));

  const updSrc   = (idx, k, v) => setSrcRows(p  => p.map((r,i) => i===idx ? {...r,[k]:v} : r));
  const updQuote = (idx, k, v) => setQuoteRows(p => p.map((r,i) => i===idx ? {...r,[k]:v} : r));

  // ── Margin calculations ──────────────────────────────────
  const marginData = useMemo(() => {
    const rows = (enq.items || []).map((item, idx) => {
      const src  = srcRows[idx]   || {};
      const qrow = quoteRows[idx] || {};
      const qty  = Number(item.quantity) || 0;

      const srcUnit   = Number(src.sourced_price)   || 0;
      const quoteUnit = Number(qrow.quote_price)     || 0;
      const target    = Number(item.target_price)    || 0;

      const srcTotal   = srcUnit * qty;
      const quoteTotal = quoteUnit * qty;
      const grossMarginUnit = quoteUnit - srcUnit;
      const grossMarginTotal = quoteTotal - srcTotal;

      const aboveTarget = target > 0 && (srcUnit > target || quoteUnit > target);
      const srcAbove   = target > 0 && srcUnit > target;
      const quoteAbove = target > 0 && quoteUnit > target;

      return { srcUnit, quoteUnit, srcTotal, quoteTotal, grossMarginUnit, grossMarginTotal, target, qty, srcAbove, quoteAbove, aboveTarget };
    });

    const totalSrcValue    = rows.reduce((s, r) => s + r.srcTotal, 0);
    const totalQuoteValue  = rows.reduce((s, r) => s + r.quoteTotal, 0);
    const totalGrossMargin = totalQuoteValue - totalSrcValue;
    const grossMarginPct   = totalSrcValue > 0 ? ((totalGrossMargin / totalSrcValue) * 100) : 0;

    const addlCost = (Number(charges.customs)||0) + (Number(charges.handling)||0) + (Number(charges.freight)||0) + (Number(charges.bank)||0);
    const totalNetMargin = totalQuoteValue - totalSrcValue - addlCost;
    const netMarginPct   = totalSrcValue > 0 ? ((totalNetMargin / totalSrcValue) * 100) : 0;

    return { rows, totalSrcValue, totalQuoteValue, totalGrossMargin, grossMarginPct, addlCost, totalNetMargin, netMarginPct };
  }, [srcRows, quoteRows, charges, enq.items]);

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
        return {
          ...r,
          id: r.id || ('src_' + r.enquiry_item_id + '_' + Date.now()),
          quote_price:             (qp !== '' && qp != null) ? qp : null,
          quote_currency:          qrow?.quote_currency || 'INR',
          tax_rate:                (qrow?.tax_rate !== '' && qrow?.tax_rate != null) ? Number(qrow.tax_rate) : null,
          sourcing_revision_notes: srcRevNotes[r.enquiry_item_id] || null,
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
            const srcNote = srcRevNotes[r.enquiry_item_id] ? ` | Note: ${srcRevNotes[r.enquiry_item_id]}` : '';
            return `${item.component}: Quote ${qc} ${qp || '—'} | Src ${r.sourced_currency} ${r.sourced_price || '—'} | Qty ${item.quantity}${srcNote}`;
          })
          .filter(Boolean)
          .join('\n');

        const addlNote = (Number(charges.customs)||0) + (Number(charges.handling)||0) + (Number(charges.freight)||0) > 0
          ? `\nAdditional charges: Customs ${charges.customs||0}, Handling ${charges.handling||0}, Freight ${charges.freight||0}, Bank ${charges.bank||0} ${charges.currency||'INR'}`
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
          // Standard workflow: create a new Quote record
          // FIX: replaced timestamp suffix (collision-prone) with sequential counter per enquiry
          // quotes prop is in scope — count existing quotes for this enquiry to get next seq
          const existingForEnq = (quotes||[]).filter(q => q.enquiry_id === enq.id);
          const nextSeq = existingForEnq.length + 1;
          const enqNum  = enq.id.replace(/[^0-9]/g, '').padStart(3, '0');
          const quoteNo = 'QT-' + enqNum + '-' + String(nextSeq).padStart(3, '0');
          try {
            await api.post('/quotes', {
              enquiry_id:    enq.id,
              customer_id:   enq.customer_id,
              quote_no:      quoteNo,
              zoho_quote_no: '',
              file_ref:      '',
              valid_until:   '',
              status:        'active',
              notes:         fullNotes,
            });
            toast.success('✅ Sent to Quote Bin! Quote ' + quoteNo + ' created.');
          } catch (qErr) {
            console.warn('Quote auto-create skipped:', qErr.response?.data?.error);
            toast.success('Sourcing saved — check Quote Bin');
          }
        }
      } else if (mode === 'draft') {
        toast.success('Saved as draft — stays in Sourcing Bin');
      } else {
        toast.success('Sourcing saved');
      }
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false); setSaveMode('');
    }
  };

  const md = marginData;

  // Find if there's a pending revision for this enquiry
  const pendingRevision = (quotes||[]).find(q =>
    q.enquiry_id === enq.id && q.status === 'returned_to_sourcing'
  ) || null;
  const isRevision = !!pendingRevision;

  // Sourcing comment per item state (for revision workflow)
  const [srcRevNotes, setSrcRevNotes] = useState({});  // item_id → note

  return (
    <div className="overlay">
      <div className="modal modal-xl">
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
              Created {enq.created_at}
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
              <select className="input" style={{ padding:'3px 8px', fontSize:18, minWidth:140 }} value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                <option value="">— Unassigned —</option>
                {srcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </span>
          </div>

          {/* ── Per-Item Sourcing + Quote Pricing ─────────── */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title" style={{ marginBottom:12 }}>
              <span>📦 Components — Sourcing &amp; Quote Pricing</span>
            </div>

            {(enq.items || []).map((item, idx) => {
              const row   = srcRows[idx]   || {};
              const qrow  = quoteRows[idx] || {};
              const mrow  = md.rows[idx]   || {};
              const hasTarget = Number(item.target_price) > 0;

              return (
                <div
                  key={item.id}
                  style={{
                    border: `1px solid ${mrow.aboveTarget ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 'var(--r)',
                    padding: '14px 18px',
                    marginBottom: 12,
                    background: mrow.aboveTarget ? 'var(--red-lt)' : 'var(--surface2)',
                  }}
                >
                  {/* Item header */}
                  <div className="flex-between" style={{ marginBottom:10 }}>
                    <div>
                      <span className="bold" style={{ fontSize:18 }}>{item.component}</span>
                      {item.manufacturer && <span style={{ fontSize:15, color:'var(--accent2)', marginLeft:8 }}>{item.manufacturer}</span>}
                      {item.ipn && <span className="mono" style={{ fontSize:19, color:'var(--text3)', marginLeft:8 }}>IPN: {item.ipn}</span>}
                      <input
                        className="input"
                        value={row.notes||''}
                        placeholder="Notes: MOQ, terms…"
                        onChange={e=>updSrc(idx,'notes',e.target.value)}
                        onClick={e=>e.stopPropagation()}
                        style={{marginLeft:12,flex:1,minWidth:160,maxWidth:320,fontSize:12,
                          padding:'3px 9px',height:28,background:'var(--surface)',
                          border:'1px solid var(--border)',borderRadius:'var(--r-sm)',
                          color:'var(--text2)'}}
                      />
                    </div>
                    <div className="flex gap-8">
                      <span className="badge badge-blue">{item.quantity} pcs</span>
                      {hasTarget && (
                        <span
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                            background: mrow.aboveTarget ? 'var(--red-lt)' : 'var(--green-lt)',
                            color: mrow.aboveTarget ? 'var(--red)' : 'var(--green)',
                            border: mrow.aboveTarget ? '1px solid var(--red)' : '1px solid var(--green)',
                          }}
                          title={mrow.aboveTarget ? 'Price exceeds target' : 'Within target'}
                        >
                          {mrow.aboveTarget ? '⚠ ' : '🎯 '}Target: {item.target_currency} {item.target_price}
                        </span>
                      )}
                      {item.date_code && <span className="badge badge-gray">DC: {item.date_code}</span>}
                      {item.preferred_delivery_date && <span className="badge badge-teal">Del: {item.preferred_delivery_date}</span>}
                    </div>
                  </div>

                  {/* ── All fields in one inline row ── */}
                  <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'nowrap', overflowX:'auto', paddingBottom:4 }}>

                    {/* Supplier */}
                    <div style={{ flex:'2 1 130px', minWidth:120 }}>
                      <label className="label" style={{ whiteSpace:'nowrap' }}>Supplier</label>
                      <select className="input" value={row.supplier_id||''} onChange={e=>updSrc(idx,'supplier_id',e.target.value)}>
                        <option value="">— Select —</option>
                        {suppliers.map(s=><option key={s.id} value={s.id}>{s.name} ({s.type==='domestic'?'🇮🇳':'🌐'})</option>)}
                      </select>
                    </div>

                    {/* Manufacturer — read-only from item */}
                    <div style={{ flex:'1.2 1 100px', minWidth:90 }}>
                      <label className="label" style={{ whiteSpace:'nowrap' }}>Manufacturer</label>
                      <div className="input" style={{ background:'var(--surface2)', color:'var(--text2)',
                        fontSize:12, padding:'5px 8px', cursor:'default', whiteSpace:'nowrap',
                        overflow:'hidden', textOverflow:'ellipsis' }}>
                        {item.manufacturer || '—'}
                      </div>
                    </div>

                    {/* Sourcing Unit Price */}
                    <div style={{ flex:'1 1 80px', minWidth:72 }}>
                      <label className="label" style={{ whiteSpace:'nowrap' }}>
                        Src Price {mrow.srcAbove && <span style={{ color:'var(--red)' }}>↑</span>}
                      </label>
                      <input className="input" type="number" step="0.01"
                        value={row.sourced_price||''} placeholder="0.00"
                        style={{ borderColor: mrow.srcAbove ? 'var(--red)' : undefined }}
                        onChange={e=>updSrc(idx,'sourced_price',e.target.value)} />
                    </div>

                    {/* Sourcing Currency */}
                    <div style={{ flex:'0.7 1 65px', minWidth:60 }}>
                      <label className="label">Cur.</label>
                      <select className="input" value={row.sourced_currency||'USD'} onChange={e=>updSrc(idx,'sourced_currency',e.target.value)}>
                        {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* Lead Time */}
                    <div style={{ flex:'1.2 1 110px', minWidth:90 }}>
                      <label className="label">Lead Time</label>
                      <div style={{display:'flex',gap:4}}>
                        <input className="input" type="number" min="1" style={{width:60,flex:'0 0 60px'}}
                          value={(row.lead_time||'').replace(/[^0-9]/g,'')}
                          placeholder="0"
                          onChange={e=>{
                            const unit=(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days';
                            updSrc(idx,'lead_time',(e.target.value?e.target.value+' '+unit:''));
                          }} />
                        <select className="input" style={{flex:1}}
                          value={(row.lead_time||'').replace(/[0-9]/g,'').trim()||'Days'}
                          onChange={e=>{
                            const num=(row.lead_time||'').replace(/[^0-9]/g,'')||'';
                            updSrc(idx,'lead_time',num?(num+' '+e.target.value):'');
                          }}>
                          <option>Days</option>
                          <option>Weeks</option>
                          <option>Months</option>
                        </select>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ flex:'0 0 1px', alignSelf:'stretch', background:'var(--border)', margin:'0 4px' }} />

                    {/* Quote Price + Currency GROUP */}
<div style={{ flex:'1.8 1 120px', minWidth:110 }}>
  
  {/* 🔼 LABEL MOVED HERE (YOUR GREEN BOX POSITION) */}
  <label className="label" style={{ whiteSpace:'nowrap' }}>
    Quote Price {mrow.quoteAbove && <span style={{ color:'var(--red)' }}>↑</span>}
  </label>

  <div style={{ display:'flex', gap:6 }}>
    <input
      className="input"
      type="number"
      step="0.01"
      value={qrow.quote_price||''}
      placeholder="0.00"
      style={{ borderColor: mrow.quoteAbove ? 'var(--red)' : undefined }}
      onChange={e=>updQuote(idx,'quote_price',e.target.value)}
    />

    <select
      className="input"
      value={qrow.quote_currency||'INR'}
      onChange={e=>updQuote(idx,'quote_currency',e.target.value)}
      style={{ width:70 }}
    >
      {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
    </select>
  </div>
</div>

                    {/* GST / VAT Tax */}
                    <div style={{ flex:'1 1 95px', minWidth:88 }}>
                      <label className="label">
                        {(qrow.quote_currency||'INR') === 'INR' ? 'GST' : 'VAT / Tax'}
                      </label>
                      <select className="input"
                        value={qrow.tax_rate ?? ''}
                        onChange={e => updQuote(idx, 'tax_rate', e.target.value)}>
                        <option value="">— None —</option>
                        {getTaxRates(qrow.quote_currency || 'INR').map(t => (
                          <option key={t.label} value={t.rate}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Quote Total + Margin — read-only */}
                    {qrow.quote_price && (
                      <div style={{ flex:'0 0 auto', alignSelf:'flex-end', paddingBottom:6, whiteSpace:'nowrap', fontSize:11 }}>
                        = <strong style={{ color:'var(--green)' }}>{fmtC(Number(qrow.quote_price)*Number(item.quantity), qrow.quote_currency)}</strong>
                        {mrow.srcUnit > 0 && mrow.quoteUnit > 0 && (
                          <span style={{
                            marginLeft:8, padding:'2px 7px', borderRadius:999, fontSize:10, fontWeight:700,
                            background: mrow.grossMarginUnit >= 0 ? 'var(--green-lt)' : 'var(--red-lt)',
                            color:      mrow.grossMarginUnit >= 0 ? 'var(--green)'    : 'var(--red)',
                          }}>
                            {mrow.grossMarginUnit >= 0 ? '+' : ''}{fmtC(mrow.grossMarginUnit, qrow.quote_currency||'INR')}/u
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Target comparison bar */}
                  {hasTarget && mrow.srcUnit > 0 && mrow.quoteUnit > 0 && (
                    <div style={{ marginTop:10, padding:'7px 10px', borderRadius:'var(--r-sm)', background: mrow.aboveTarget?'var(--red-lt)':'var(--green-lt)', fontSize:11, color: mrow.aboveTarget?'var(--red)':'var(--green)' }}>
                      {mrow.srcAbove && `⚠ Source price ${item.target_currency} ${mrow.srcUnit} is above target ${item.target_price}`}
                      {mrow.srcAbove && mrow.quoteAbove && ' · '}
                      {mrow.quoteAbove && `⚠ Quote price ${qrow.quote_currency} ${mrow.quoteUnit} is above target ${item.target_price}`}
                      {!mrow.aboveTarget && `✅ Both prices within target (${item.target_currency} ${item.target_price})`}
                    </div>
                  )}
                  {/* ── Sales comment (from revision) — shown to sourcing ── */}
                  {isRevision && (() => {
                    const srcRow = (enq.sourcing||[]).find(s => s.enquiry_item_id === item.id);
                    const salesComment = srcRow?.sales_comment;
                    return salesComment ? (
                      <div style={{marginTop:8,padding:'7px 10px',borderRadius:'var(--r-sm)',
                        background:'var(--amber-lt,#fffbeb)',border:'1px solid var(--amber,#d97706)44',
                        fontSize:11,color:'var(--amber,#d97706)',fontWeight:600}}>
                        💬 Sales: "{salesComment}"
                      </div>
                    ) : null;
                  })()}

                  {/* ── Sourcing revision note (sourcing's response) ── */}
                  {isRevision && (
                    <div style={{marginTop:8}}>
                      <label className="label" style={{fontSize:11,fontWeight:700,color:'var(--text2)'}}>
                        Your note to Sales (optional)
                      </label>
                      <input className="input"
                        value={srcRevNotes[item.id]||''}
                        onChange={e=>setSrcRevNotes(n=>({...n,[item.id]:e.target.value}))}
                        placeholder="e.g. Best price ₹215 from supplier ABC, lead time 4 weeks"
                        style={{fontSize:12}}/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Additional Charges ────────────────────────── */}
          <div className="card card-sm" style={{ marginBottom:14 }}>
            <div className="card-title">
              <span>🧾 Additional Approx. Costs (Entire Enquiry)</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr) 1fr 1.5fr', gap:10, alignItems:'end' }}>
              {[
                { key:'customs',  label:'Customs Charges' },
                { key:'handling', label:'Handling Charges' },
                { key:'freight',  label:'Freight Charges' },
                { key:'bank',     label:'Bank Charges' },
              ].map(({key, label}) => (
                <div key={key} className="form-group" style={{ marginBottom:0 }}>
                  <label className="label" style={{fontWeight:700,color:'var(--text)'}}>{label}</label>
                  <input className="input" type="number" step="0.01"
                    value={charges[key]} placeholder="0.00"
                    onChange={e=>setCharges(c=>({...c,[key]:e.target.value}))}/>
                </div>
              ))}
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label" style={{fontWeight:700,color:'var(--text)'}}>Currency</label>
                <select className="input" value={charges.currency} onChange={e=>setCharges(c=>({...c,currency:e.target.value}))}>
                  {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label" style={{fontWeight:700,color:'var(--text)'}}>Notes</label>
                <input className="input" value={charges.notes} onChange={e=>setCharges(c=>({...c,notes:e.target.value}))} placeholder="e.g. Air freight estimate"/>
              </div>
            </div>
          </div>

          {/* ── Margin Summary ────────────────────────────── */}
          <div className="card card-sm" style={{ marginBottom:0, border:'1px solid rgba(27,79,158,.2)' }}>
            <div className="card-title">📊 Margin Summary</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { label:'Total Source Value',      val: md.totalSrcValue,    cur: srcRows[0]?.sourced_currency||'USD',  color:'var(--accent)' },
                { label:'Total Quote Value',        val: md.totalQuoteValue,  cur: quoteRows[0]?.quote_currency||'INR',  color:'var(--green)' },
                {
                  label:'Gross Margin (Quote − Source)',
                  val:  md.totalGrossMargin,
                  cur:  quoteRows[0]?.quote_currency||'INR',
                  color: md.totalGrossMargin >= 0 ? 'var(--green)' : 'var(--red)',
                  sub:  `${md.grossMarginPct >= 0 ? '+' : ''}${md.grossMarginPct.toFixed(1)}%`
                },
                {
                  label:'Net Margin (Quote − Source − Charges)',
                  val:  md.totalNetMargin,
                  cur:  quoteRows[0]?.quote_currency||'INR',
                  color: md.totalNetMargin >= 0 ? 'var(--teal)' : 'var(--red)',
                  sub:  `Addl. costs: ${fmtC(md.addlCost, charges.currency||'INR')} · ${md.netMarginPct >= 0 ? '+' : ''}${md.netMarginPct.toFixed(1)}%`
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
                      return (
                        <tr key={item.id}>
                          <td className="bold" style={{ fontSize:18 }}>{item.component}</td>
                          <td>{item.quantity}</td>
                          <td className="mono" style={{ color:'var(--accent)', fontSize:11 }}>{m.srcUnit ? fmtC(m.srcUnit, src.sourced_currency||'USD') : '—'}</td>
                          <td className="mono" style={{ color:'var(--green)', fontSize:11 }}>{m.quoteUnit ? fmtC(m.quoteUnit, q.quote_currency||'INR') : '—'}</td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginUnit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginUnit ? `${m.grossMarginUnit >= 0?'+':''}${fmtC(m.grossMarginUnit, q.quote_currency||'INR')}` : '—'}
                          </td>
                          <td className="mono bold" style={{ fontSize:11, color: m.grossMarginTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {m.grossMarginTotal ? `${m.grossMarginTotal >= 0?'+':''}${fmtC(m.grossMarginTotal, q.quote_currency||'INR')}` : '—'}
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
        <div className="modal-footer" style={{ justifyContent:'space-between' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <div className="flex gap-8">
            {/* Save — stays in Sourcing Bin */}
            <button
              className="btn"
              disabled={saving}
              onClick={() => handleSave('save')}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h9l3 3v9H2z"/><rect x="5" y="9" width="6" height="5"/><rect x="5" y="2" width="5" height="3"/></svg>
              {saving && saveMode==='save' ? 'Saving…' : 'Save'}
            </button>

            {/* Save as Draft — stays in Sourcing Bin */}
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
                disabled={saving}
                onClick={() => handleSave('return_revision')}
                style={{ display:'flex', alignItems:'center', gap:6,
                  background:'var(--amber,#d97706)', borderColor:'var(--amber,#d97706)' }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                {saving && saveMode==='return_revision'
                  ? 'Returning…'
                  : '↩ Return to Quote Bin — ' + (pendingRevision?.quote_no||'Revision')}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => handleSave('quote')}
                style={{ display:'flex', alignItems:'center', gap:6 }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h12v13H2zM5 5h6M5 8h4M11 8l3 3-3 3"/></svg>
                {saving && saveMode==='quote' ? 'Sending…' : 'Send to Quote Bin →'}
              </button>
            )}
          </div>
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
  const [expandedCards, setExpandedCards] = useState(new Set());
  const { user } = useAuth();
  const isAdmin = ['admin','manager'].includes(user?.role);

  const { data: enquiries=[], isLoading } = useQuery({ queryKey:['enquiries'], queryFn:()=>api.get('/enquiries').then(r=>r.data), refetchInterval:20000 });
  const { data: customers=[] }  = useQuery({ queryKey:['customers'],  queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: suppliers=[] }  = useQuery({ queryKey:['suppliers'],  queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: users=[] }      = useQuery({ queryKey:['users'],      queryFn:()=>api.get('/users').then(r=>r.data) });
  const { data: quotes=[] }     = useQuery({ queryKey:['quotes'],     queryFn:()=>api.get('/quotes').then(r=>r.data) });

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
  // CHANGED: binEnqs includes sourcing + quoted + returned_to_sourcing (revision needed)
  const binEnqs = enquiries.filter(e => {
    if (statusFilter === 'sourcing')             return e.status === 'sourcing' && !hasRevisionReturned(e);
    if (statusFilter === 'quoted')               return e.status === 'quoted';
    if (statusFilter === 'returned_to_sourcing') return e.status === 'returned_to_sourcing';
    // 'all': sourcing + quoted + returned_to_sourcing
    return (e.status === 'sourcing' && !hasRevisionReturned(e))
        || e.status === 'quoted'
        || e.status === 'returned_to_sourcing';
  });

  const filtered = binEnqs.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.id.toLowerCase().includes(q) || custName(e.customer_id).toLowerCase().includes(q);
    const matchPri = priorityFilter === 'all' || e.priority === priorityFilter;
    return matchSearch && matchPri;
  });

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
            { v:'all',                   l:`All (${enquiries.filter(e=>(e.status==='sourcing'&&!hasRevisionReturned(e))||e.status==='quoted'||e.status==='returned_to_sourcing').length})` },
            { v:'sourcing',              l:`New (${enquiries.filter(e=>e.status==='sourcing'&&!hasRevisionReturned(e)).length})` },
            { v:'quoted',                l:`Moved to Quote (${enquiries.filter(e=>e.status==='quoted').length})` },
            { v:'returned_to_sourcing',  l:`Revision Needed (${enquiries.filter(e=>e.status==='returned_to_sourcing').length})` },
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
          <button className="btn btn-sm btn-danger" onClick={async()=>{
            try{
              await api.request({method:'DELETE',url:'/enquiries',data:{ids:[...markedForDelete]}});
              toast.success(`Deleted ${markedForDelete.size} enquir${markedForDelete.size>1?'ies':'y'}`);
              setMarkedForDelete(new Set());
              qc.invalidateQueries(['enquiries']);qc.invalidateQueries(['summary']);
            }catch(e){toast.error('Delete failed');}
          }}>🗑 Delete Selected</button>
          <button className="btn btn-xs" onClick={()=>setMarkedForDelete(new Set())}>Cancel</button>
        </div>
      )}

      {/* Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:14 }}>
        {filtered.map(enq => {
          const srcDone  = (enq.sourcing||[]).filter(s => s.sourced_price).length;
          const srcTotal = (enq.items||[]).length;
          const srcPct   = srcTotal ? Math.round(srcDone / srcTotal * 100) : 0;
          const isUrgent = enq.priority === 'urgent';
          const isHigh   = enq.priority === 'high';

          // Quick margin summary on card
          const hasMarginData = (enq.sourcing||[]).some(s => s.sourced_price && s.quote_price);
          const quickSrc   = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.sourced_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
          const quickQuote = (enq.sourcing||[]).reduce((sum,s) => sum + (Number(s.quote_price)||0) * ((enq.items||[]).find(i=>i.id===s.enquiry_item_id)?.quantity||0), 0);
          const quickGross = quickQuote - quickSrc;

          return (
            <div
              key={enq.id}
              className="card"
              style={{
                marginBottom:0, cursor:'pointer',
                borderLeft: isUrgent ? '3px solid var(--red)' : isHigh ? '3px solid var(--amber)' : '1px solid var(--border)',
              }}
              onClick={() => setSelected(enq)}
            >
              <div className="flex-between" style={{ marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  {isAdmin && (
                    <input type="checkbox"
                      checked={markedForDelete.has(enq.id)}
                      onClick={e=>e.stopPropagation()}
                      onChange={e=>{e.stopPropagation();setMarkedForDelete(prev=>{const n=new Set(prev);n.has(enq.id)?n.delete(enq.id):n.add(enq.id);return n;});}}
                      style={{accentColor:'var(--red)',cursor:'pointer',width:14,height:14}}/>
                  )}
                  <span className="mono" style={{ fontSize:12, color:'var(--text3)' }}>{enq.id}</span>
                  {enq.sourcing_no && (
                    <>
                      <span style={{ fontSize:11, color:'var(--text3)' }}>→</span>
                      <span className="mono bold" style={{ fontSize:14, color:'var(--accent)',
                        background:'var(--accent-lt)', padding:'2px 8px', borderRadius:999,
                        border:'1px solid var(--accent)33' }}>
                        {enq.sourcing_no}
                      </span>
                    </>
                  )}
                  {isUrgent && <span className="badge badge-red" style={{ fontSize:9 }}>Urgent</span>}
                  {isHigh   && <span className="badge badge-amber" style={{ fontSize:9 }}>High</span>}
                </div>
                <StatusBadge s={enq.status}/>
              </div>

              <div style={{ fontSize:13, fontWeight:600, marginBottom:3 }}>{custName(enq.customer_id)}</div>

              {/* Component list — show 5, collapsible for more */}
              {(()=>{
                const allItems = enq.items || [];
                const SHOW = 5;
                const isExpanded = expandedCards.has(enq.id);
                const visible = allItems.length > SHOW && !isExpanded ? allItems.slice(0, SHOW) : allItems;
                const hiddenCount = allItems.length > SHOW ? allItems.length - SHOW : 0;
                return (
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:8, lineHeight:1.6 }}>
                    {visible.map((i) => (
                      <div key={i.id} style={{ display:'flex', justifyContent:'space-between', borderBottom:'0.5px solid var(--border)', padding:'3px 0' }}>
                        <span><strong>{i.component}</strong>{i.manufacturer ? ` · ${i.manufacturer}` : ''}</span>
                        <span style={{ color:'var(--text3)', flexShrink:0, marginLeft:8 }}>
                          {i.quantity} pcs
                          {i.target_price ? ` · Target: ${i.target_currency} ${i.target_price}` : ''}
                        </span>
                      </div>
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        onClick={e=>{e.stopPropagation();setExpandedCards(prev=>{const n=new Set(prev);n.has(enq.id)?n.delete(enq.id):n.add(enq.id);return n;});}}
                        style={{marginTop:4,background:'none',border:'1px dashed var(--border)',
                          borderRadius:'var(--r-sm)',padding:'3px 8px',cursor:'pointer',
                          fontSize:10,color:'var(--accent)',fontWeight:600,width:'100%',textAlign:'center'}}>
                        {isExpanded ? '▲ Show less' : `▼ Show ${hiddenCount} more`}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Progress */}
              <div style={{ marginBottom:8 }}>
                <div className="flex-between" style={{ fontSize:10, color:'var(--text2)', marginBottom:3 }}>
                  <span>Sourcing progress</span>
                  <span style={{ fontWeight:600, color:srcPct===100?'var(--green)':'inherit' }}>{srcDone}/{srcTotal} priced</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width:`${srcPct}%`, background:srcPct===100?'var(--green)':srcPct>50?'var(--accent)':'var(--amber)' }}/>
                </div>
              </div>

              {/* Quick margin on card */}
              {hasMarginData && (
                <div style={{
                  padding:'6px 10px', borderRadius:'var(--r-sm)', fontSize:11, marginBottom:8,
                  background: quickGross >= 0 ? 'var(--green-lt)' : 'var(--red-lt)',
                  color: quickGross >= 0 ? 'var(--green)' : 'var(--red)',
                  display:'flex', justifyContent:'space-between'
                }}>
                  <span>Gross Margin</span>
                  <strong>{quickGross >= 0 ? '+' : ''}{fmt(quickGross)}</strong>
                </div>
              )}

              <div className="flex-between" style={{ fontSize:10, color:'var(--text3)', marginBottom:10 }}>
                <span>📅 {enq.created_at}</span>
                <span>👤 {userName(enq.assigned_to)}</span>
              </div>

              <button
                className="btn btn-primary btn-sm"
                style={{ width:'100%', justifyContent:'center', display:'flex' }}
                onClick={e => { e.stopPropagation(); setSelected(enq); }}
              >
                {srcPct === 0 ? 'Start Sourcing' : srcPct === 100 ? 'Review & Send to Quote' : 'Continue Sourcing'}
              </button>
            </div>
          );
        })}
      </div>

      {selected && (
        <SourcingModal
          enq={selected}
          suppliers={suppliers}
          customers={customers}
          users={users}
          quotes={quotes}
          onClose={() => setSelected(null)}
          onSaved={() => {
            qc.invalidateQueries(['enquiries']);
            qc.invalidateQueries(['quotes']);
            qc.invalidateQueries(['summary']);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
