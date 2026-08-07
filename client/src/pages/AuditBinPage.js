// client/src/pages/AuditBinPage.js
// Audit Bin — simple view: Sourcing total estimate vs what was actually paid
// (Customer Paid, Supplier Paid from Finance), plus a plain manual-entry form
// for the real final amounts. No percentages, no formulas — just numbers in,
// numbers out.
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const FIELDS = [
  { key:'material',  label:'Material' },
  { key:'freight',   label:'Freight' },
  { key:'insurance', label:'Insurance' },
  { key:'bcd',       label:'BCD' },
  { key:'sws',       label:'SWS' },
  { key:'cess',      label:'CESS' },
  { key:'bank',      label:'Bank Charges' },
  { key:'clearing',  label:'Clearing' },
  { key:'margin',    label:'Margin' },
];

function fmtM(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Click-to-edit Customer Paid / Supplier Paid amount — shows the computed
// Finance total (or an override once one's been entered) with a pencil to
// open a plain number field. Saving writes to order_cost_audits' own
// customer_paid_override / supplier_paid_override column — it never touches
// the real Finance payment records, so editing here is always safe.
function EditablePaid({ auditId, field, value, isOverride, color, onSaved, stopPropagation }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (e) => {
    if (stopPropagation) e.stopPropagation();
    setDraft(value ? String(value) : '');
    setEditing(true);
  };
  const cancel = (e) => { if (stopPropagation) e.stopPropagation(); setEditing(false); };
  const save = async (e) => {
    if (stopPropagation) e.stopPropagation();
    setSaving(true);
    try {
      await api.put(`/audit-bin/${auditId}/paid`, { [field]: draft === '' ? null : draft });
      toast.success('Amount saved');
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save amount');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:4 }} onClick={e=>stopPropagation && e.stopPropagation()}>
        <input type="number" step="0.01" autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
          style={{ width:100, fontSize:12, padding:'3px 6px', borderRadius:6, border:'1px solid var(--border)' }}
          onKeyDown={e=>{ if(e.key==='Enter') save(e); if(e.key==='Escape') cancel(e); }}/>
        <button className="btn btn-xs btn-primary" disabled={saving} onClick={save} style={{padding:'2px 6px'}}>{saving?'…':'✓'}</button>
        <button className="btn btn-xs" disabled={saving} onClick={cancel} style={{padding:'2px 6px'}}>×</button>
      </div>
    );
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>{fmtM(value)}</span>
      {isOverride && <span title="Manually entered — overrides the computed Finance total" style={{fontSize:9,color:'var(--text3)'}}>✏ manual</span>}
      <button className="btn btn-xs" title="Enter amount" onClick={startEdit} style={{padding:'1px 8px',fontSize:11,whiteSpace:'nowrap'}}>✏ Edit</button>
    </div>
  );
}

// ── Per-supplier-PO card — plain amount fields, all blank by default ─────────
function AuditItemCard({ item, onSaved }) {
  const [form, setForm] = useState(() => {
    const f = {};
    FIELDS.forEach(({key}) => { f[key] = item['act_'+key] ?? ''; });
    f.notes = item.notes || '';
    return f;
  });
  const [charges, setCharges] = useState(() => {
    try {
      const p = item.act_extra_charges_detail ? (typeof item.act_extra_charges_detail==='string' ? JSON.parse(item.act_extra_charges_detail) : item.act_extra_charges_detail) : [];
      return Array.isArray(p) ? p : [];
    } catch(_) { return []; }
  });
  const [saving, setSaving] = useState(false);

  const chargesTotal = charges.reduce((s,c) => s + (Number(c.amount)||0), 0);
  const actTotal = FIELDS.reduce((s,{key}) => s + (Number(form[key])||0), 0) + chargesTotal;

  const addCharge = () => setCharges(c => [...c, { name:'', amount:'' }]);
  const updCharge = (i,k,v) => setCharges(c => c.map((x,j) => j===i ? {...x,[k]:v} : x));
  const removeCharge = (i) => setCharges(c => c.filter((_,j) => j!==i));

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {};
      FIELDS.forEach(({key}) => { payload['act_'+key] = Number(form[key])||0; });
      payload.act_extra_charges_detail = charges.filter(c => c.name || Number(c.amount)>0);
      payload.notes = form.notes || '';
      await api.put(`/audit-items/${item.id}`, payload);
      toast.success('Actual amount saved');
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden',marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',
        background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>
        <span style={{fontWeight:700,fontSize:13}}>{item.supplier_name || item.supplier_id || '—'}</span>
        <button className="btn btn-sm btn-primary" disabled={saving} onClick={submit}>
          {saving ? 'Saving…' : '💾 Submit'}
        </button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr'}}>
        <div style={{padding:'14px 16px',borderRight:'1px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px 14px'}}>
            {FIELDS.map(({key,label}) => (
              <div key={key} className="form-group" style={{marginBottom:0}}>
                <label className="label">{label}</label>
                <input className="input" type="number" step="0.01" value={form[key]}
                  onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder="₹ Amount"/>
              </div>
            ))}
          </div>

          <div className="form-group" style={{marginTop:14,marginBottom:0}}>
            <label className="label">Additional Charges</label>
            {charges.map((c,i) => (
              <div key={i} style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}>
                <input className="input" style={{flex:2}} placeholder="Charge name"
                  value={c.name||''} onChange={e=>updCharge(i,'name',e.target.value)}/>
                <input className="input" style={{flex:1}} type="number" step="0.01" min="0" placeholder="₹ Amount"
                  value={c.amount??''} onChange={e=>updCharge(i,'amount',e.target.value)}/>
                <button type="button" className="btn btn-xs btn-danger" onClick={()=>removeCharge(i)}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-success" onClick={addCharge} style={{display:'inline-flex',width:'auto',alignSelf:'flex-start'}}>+ Add Charge</button>
          </div>

          <div className="form-group" style={{marginTop:14,marginBottom:0}}>
            <label className="label">Notes</label>
            <input className="input" value={form.notes}
              onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. reason for variance"/>
          </div>
        </div>

        <div style={{padding:'14px 16px',background:'#0f172a'}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',color:'rgba(255,255,255,.4)',marginBottom:10}}>
            Actual Total
          </div>
          {chargesTotal > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:11.5,fontWeight:600,color:'rgba(255,255,255,.65)'}}>
              <span>+ Additional Charges</span><span style={{fontFamily:'monospace'}}>{fmtM(chargesTotal)}</span>
            </div>
          )}
          <div style={{borderTop:'1px solid rgba(255,255,255,.1)',margin:'6px 0'}}/>
          <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:14,fontWeight:800,color:'#4ade80'}}>
            <span>Total</span>
            <span style={{fontFamily:'monospace'}}>{fmtM(actTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Order detail modal ────────────────────────────────────────────────────────
function AuditDetailModal({ order, onClose, onSaved }) {
  const qc = useQueryClient();
  const { data: audit, isLoading } = useQuery({
    queryKey: ['audit', order.id],
    queryFn: () => api.get(`/orders/${order.id}/audit`).then(r=>r.data),
  });

  const items = audit?.items || [];

  const refresh = () => { qc.invalidateQueries(['audit', order.id]); qc.invalidateQueries(['audit-bin']); onSaved(); };

  return (
    <div className="overlay" style={{zIndex:60}}>
      <div className="modal modal-xl" style={{width:'92vw',maxWidth:1200,height:'92vh',maxHeight:'92vh'}}>
        <div className="modal-header">
          <div>
            <h2>📋 Audit — {order.id}</h2>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{overflowY:'auto'}}>
          {isLoading && <div className="loading-center">Loading…</div>}
          {!isLoading && items.length===0 && (
            <div className="empty-state"><div className="empty-icon">📋</div>
              <div className="empty-state-text">No purchase orders found on this order.</div>
            </div>
          )}
          {!isLoading && items.length > 0 && (<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,
              padding:'10px 16px',borderRadius:'var(--r)',background:'var(--surface2)',border:'1px solid var(--border)',flexWrap:'wrap',gap:10}}>
              <div style={{fontSize:12,display:'flex',alignItems:'center',gap:8}}>Customer Paid:
                {audit && <EditablePaid auditId={audit.id} field="customer_paid_override" value={audit.customer_paid_total}
                  isOverride={audit.customer_paid_is_override} color="var(--green)" onSaved={refresh}/>}
              </div>
              <div style={{fontSize:12,display:'flex',alignItems:'center',gap:8}}>Supplier Paid:
                {audit && <EditablePaid auditId={audit.id} field="supplier_paid_override" value={audit.supplier_paid_total}
                  isOverride={audit.supplier_paid_is_override} color="var(--red)" onSaved={refresh}/>}
              </div>
            </div>
            {items.map(item => (
              <AuditItemCard key={item.id} item={item} onSaved={refresh}/>
            ))}
          </>)}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Audit Bin page ───────────────────────────────────────────────────────
export default function AuditBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Orders that were already in Closed Bin before this Audit Bin feature
  // existed never got an order_cost_audits row created for them (it's only
  // ever created at the moment an order transitions TO closed). This lets an
  // admin/manager backfill those older closed orders into Audit Bin on demand.
  const canSync = ['admin','manager'].includes(user?.role);
  const runSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/audit-bin/backfill');
      qc.invalidateQueries(['audit-bin']);
      toast.success(data.created > 0
        ? `✅ Added ${data.created} closed order(s) to Audit Bin`
        : 'Everything in Closed Bin is already in Audit Bin');
    } catch(e) {
      toast.error(e.response?.data?.error || 'Failed to sync Audit Bin');
    } finally {
      setSyncing(false);
    }
  };

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['audit-bin'],
    queryFn: () => api.get('/audit-bin').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]),
    refetchInterval: 20000,
  });
  const { data: customers = [] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>{ const d=r.data; return Array.isArray(d)?d:[]; }).catch(()=>[]) });
  const custName = id => customers.find(c=>c.id===id)?.name || (user?.perms?.canSeeCustomer===false?'[Restricted]':id);

  const filtered = useMemo(() => {
    if (!search) return audits;
    const q = search.toLowerCase();
    return audits.filter(a =>
      (a.order_id||'').toLowerCase().includes(q) ||
      (a.order?.po_number||'').toLowerCase().includes(q) ||
      custName(a.order?.customer_id).toLowerCase().includes(q)
    );
  }, [audits, search, customers]);

  const totalAudits = audits.length;
  const totalCustomerPaid = audits.reduce((s,a) => s + (Number(a.customer_paid_total)||0), 0);
  const totalSupplierPaid = audits.reduce((s,a) => s + (Number(a.supplier_paid_total)||0), 0);

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Total Audits', val:totalAudits, color:'var(--accent)'},
          {label:'Customer Paid', val:fmtM(totalCustomerPaid), color:'var(--green)'},
          {label:'Supplier Paid', val:fmtM(totalSupplierPaid), color:'var(--red)'},
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{borderLeft:`3px solid ${s.color}`}}>
            <div className="stat-label" style={{fontSize:10}}>{s.label}</div>
            <div className="stat-val" style={{fontSize:22,color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search order, PO, customer…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {canSync && (
          <button className="btn btn-sm" disabled={syncing} onClick={runSync} title="Pull in any Closed Bin order that's missing from Audit Bin">
            {syncing ? 'Syncing…' : '🔄 Sync from Closed Bin'}
          </button>
        )}
      </div>

      {isLoading && <div className="loading-center">Loading…</div>}
      {!isLoading && filtered.length===0 && (
        <div className="empty-state"><div className="empty-icon">📋</div>
          <div className="empty-state-text">{audits.length===0?'No orders have been audited yet — audits appear here automatically once an order is fully delivered and closed.':'No orders match your search'}</div>
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 160px 160px 100px',
            gap:0,background:'var(--surface2)',borderBottom:'1px solid var(--border)',
            padding:'7px 12px',fontSize:11,fontWeight:700,color:'var(--text2)',letterSpacing:.4}}>
            <div>ORDER / CUSTOMER</div>
            <div>CUSTOMER PAID</div>
            <div>SUPPLIER PAID</div>
            <div style={{textAlign:'right'}}>ACTION</div>
          </div>
          {filtered.map(a => (
              <div key={a.id} style={{display:'grid',gridTemplateColumns:'1fr 160px 160px 100px',
                gap:0,padding:'10px 12px',borderBottom:'1px solid var(--border)',alignItems:'center',cursor:'pointer'}}
                onClick={()=>setSelected(a)}>
                <div>
                  <span className="mono bold" style={{fontSize:13,color:'var(--accent)'}}>{a.order_id}</span>
                  {a.order?.po_number && <span className="mono" style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>PO:{a.order.po_number}</span>}
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>{custName(a.order?.customer_id)}</div>
                </div>
                <div onClick={e=>e.stopPropagation()}>
                  <EditablePaid auditId={a.id} field="customer_paid_override" value={a.customer_paid_total}
                    isOverride={a.customer_paid_is_override} color="var(--green)" stopPropagation
                    onSaved={()=>qc.invalidateQueries(['audit-bin'])}/>
                </div>
                <div onClick={e=>e.stopPropagation()}>
                  <EditablePaid auditId={a.id} field="supplier_paid_override" value={a.supplier_paid_total}
                    isOverride={a.supplier_paid_is_override} color="var(--red)" stopPropagation
                    onSaved={()=>qc.invalidateQueries(['audit-bin'])}/>
                </div>
                <div style={{textAlign:'right'}} onClick={e=>e.stopPropagation()}>
                  <button className="btn btn-xs btn-primary" onClick={()=>setSelected(a)}>👁 View</button>
                </div>
              </div>
          ))}
        </div>
      )}

      {selected && (
        <AuditDetailModal order={selected.order || {id:selected.order_id}}
          onClose={()=>setSelected(null)}
          onSaved={()=>qc.invalidateQueries(['audit-bin'])}/>
      )}
    </div>
  );
}
