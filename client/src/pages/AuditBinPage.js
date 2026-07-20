// client/src/pages/AuditBinPage.js
// Audit Bin — estimate vs actual landed cost, per supplier PO, once an order closes.
// Auto-populated server-side (see createCostAudit() in server/index.js) the moment
// an order's status becomes 'closed'. Never locked: actuals can be viewed and
// re-edited at any time via the same view/edit toggle pattern used in Procurement's
// split dialog.
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { printDoc, generateAuditReportPDF } from '../utils/pdfUtils';
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

function SumRow({ label, val, bold, highlight }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',
      fontSize:highlight?14:bold?11.5:11,fontWeight:highlight?800:bold?700:400,gap:6,
      color:highlight?'#4ade80':bold?'#fff':'rgba(255,255,255,.65)'}}>
      <span>{label}</span>
      <span style={{fontFamily:'monospace',whiteSpace:'nowrap'}}>{fmtM(val)}</span>
    </div>
  );
}
const SumDivider = () => <div style={{borderTop:'1px solid rgba(255,255,255,.1)',margin:'6px 0'}}/>;

// ── Per-PO estimate vs actual card ────────────────────────────────────────────
function AuditItemCard({ item, viewOnly, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => {
    const f = {};
    FIELDS.forEach(({key}) => { f[key] = item['act_'+key] ?? ''; });
    f.notes = item.notes || '';
    return f;
  });

  const actTotal = FIELDS.reduce((s,{key}) => s + (Number(form[key])||0), 0);
  const estTotal = Number(item.est_total) || 0;
  const hasActual = FIELDS.some(({key}) => item['act_'+key] !== null && item['act_'+key] !== undefined);
  const variance = hasActual || editing ? actTotal - estTotal : null;

  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      FIELDS.forEach(({key}) => { payload['act_'+key] = Number(form[key])||0; });
      payload.notes = form.notes || '';
      await api.put(`/audit-items/${item.id}`, payload);
      toast.success('Actual cost saved');
      setEditing(false);
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const locked = viewOnly && !editing;

  return (
    <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden',marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',
        background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>
        <div>
          <span style={{fontWeight:700,fontSize:13}}>{item.supplier_name || item.supplier_id || '—'}</span>
          <span style={{marginLeft:8,fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
            color:item.scope==='international'?'var(--accent)':'var(--green)',
            background:item.scope==='international'?'var(--accent-lt)':'var(--green-lt)',
            border:`1px solid ${item.scope==='international'?'var(--accent)':'var(--green)'}44`}}>
            {item.scope==='international' ? '🌐 International' : '🇮🇳 Domestic'}
          </span>
        </div>
        {!locked && (
          <button className="btn btn-sm btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
        )}
        {locked && (
          <button className="btn btn-sm" style={{color:'var(--accent)',borderColor:'var(--accent)'}}
            onClick={()=>setEditing(true)}>
            ✏ Edit
          </button>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr'}}>
        {/* Left — editable actuals, estimate shown inline as reference */}
        <div style={{padding:'14px 16px',borderRight:'1px solid var(--border)'}}>
          <div className="id-grp">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px 14px'}}>
              {FIELDS.map(({key,label}) => (
                <div key={key} className="form-group" style={{marginBottom:0}}>
                  <label className="label" style={{display:'flex',justifyContent:'space-between'}}>
                    <span>{label}</span>
                    <span style={{color:'var(--text3)',fontWeight:600}}>Est: {fmtM(item['est_'+key])}</span>
                  </label>
                  <fieldset disabled={locked} style={{border:'none',margin:0,padding:0}}>
                    <input className="input" type="number" step="0.01" value={form[key]}
                      onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder="0.00"/>
                  </fieldset>
                </div>
              ))}
            </div>
          </div>
          <div className="form-group" style={{marginTop:12,marginBottom:0}}>
            <label className="label">Notes</label>
            <fieldset disabled={locked} style={{border:'none',margin:0,padding:0}}>
              <input className="input" value={form.notes}
                onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. reason for variance"/>
            </fieldset>
          </div>
        </div>

        {/* Right — live summary */}
        <div style={{padding:'14px 16px',background:'#0f172a'}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',color:'rgba(255,255,255,.4)',marginBottom:10}}>
            Estimate vs Actual
          </div>
          <SumRow label="Estimated Total" val={estTotal}/>
          <SumRow label="Actual Total" val={actTotal} bold/>
          <SumDivider/>
          <SumRow label={variance===null?'Variance':(variance>0?'⚠ Over Estimate':'✅ Under Estimate')}
            val={variance===null?0:Math.abs(variance)} highlight/>
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
  const estTotal = items.reduce((s,it)=>s+(Number(it.est_total)||0),0);
  const actTotal = items.reduce((s,it)=>{
    const hasActual = FIELDS.some(({key})=>it['act_'+key]!==null && it['act_'+key]!==undefined);
    return s + (hasActual ? (Number(it.act_total)||0) : 0);
  },0);

  const refresh = () => { qc.invalidateQueries(['audit', order.id]); qc.invalidateQueries(['audit-bin']); onSaved(); };

  const genReport = () => {
    printDoc(generateAuditReportPDF(order, audit, items, null));
  };

  return (
    <div className="overlay" style={{zIndex:60}}>
      <div className="modal modal-xl" style={{width:'92vw',maxWidth:1400,height:'92vh',maxHeight:'92vh'}}>
        <div className="modal-header">
          <div>
            <h2>📋 Audit — {order.id}</h2>
            <div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>
              Status: <span style={{textTransform:'capitalize',fontWeight:700}}>{audit?.status||'pending'}</span>
              {audit?.submitted_by && <> · Last updated by {audit.submitted_by}</>}
            </div>
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
              padding:'10px 16px',borderRadius:'var(--r)',background:'var(--surface2)',border:'1px solid var(--border)'}}>
              <div style={{fontSize:12,color:'var(--text2)'}}>
                <b>{items.length}</b> supplier PO{items.length!==1?'s':''} on this order
              </div>
              <div style={{display:'flex',gap:18,alignItems:'center'}}>
                <div style={{fontSize:12}}>Estimate: <b style={{color:'var(--accent)'}}>{fmtM(estTotal)}</b></div>
                <div style={{fontSize:12}}>Actual: <b style={{color:'var(--green)'}}>{fmtM(actTotal)}</b></div>
                <button className="btn btn-sm" onClick={genReport}>📄 Generate Report</button>
              </div>
            </div>
            {items.map(item => (
              <AuditItemCard key={item.id} item={item} viewOnly onSaved={refresh}/>
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
  const pending = audits.filter(a=>a.status==='pending').length;
  const submitted = audits.filter(a=>a.status==='submitted').length;
  const totalVariance = audits.reduce((sum,a) => {
    const items = a.items || [];
    const est = items.reduce((s,it)=>s+(Number(it.est_total)||0),0);
    const act = items.reduce((s,it)=>{
      const hasActual = FIELDS.some(({key})=>it['act_'+key]!==null && it['act_'+key]!==undefined);
      return s + (hasActual ? (Number(it.act_total)||0) : (Number(it.est_total)||0));
    },0);
    return sum + (act - est);
  }, 0);

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Total Audits', val:totalAudits, color:'var(--accent)'},
          {label:'⏳ Pending Review', val:pending, color:'var(--amber,#d97706)'},
          {label:'✅ Reviewed', val:submitted, color:'var(--green)'},
          {label:'Net Variance', val:fmtM(totalVariance), color:totalVariance>0?'var(--red)':'var(--green)'},
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
      </div>

      {isLoading && <div className="loading-center">Loading…</div>}
      {!isLoading && filtered.length===0 && (
        <div className="empty-state"><div className="empty-icon">📋</div>
          <div className="empty-state-text">{audits.length===0?'No orders have been audited yet — audits appear here automatically once an order is fully delivered and closed.':'No orders match your search'}</div>
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 160px 120px 120px 120px 100px',
            gap:0,background:'var(--surface2)',borderBottom:'1px solid var(--border)',
            padding:'7px 12px',fontSize:11,fontWeight:700,color:'var(--text2)',letterSpacing:.4}}>
            <div>ORDER / CUSTOMER</div>
            <div>STATUS</div>
            <div>ESTIMATE</div>
            <div>ACTUAL</div>
            <div>VARIANCE</div>
            <div style={{textAlign:'right'}}>ACTION</div>
          </div>
          {filtered.map(a => {
            const items = a.items || [];
            const est = items.reduce((s,it)=>s+(Number(it.est_total)||0),0);
            const hasAnyActual = items.some(it=>FIELDS.some(({key})=>it['act_'+key]!==null && it['act_'+key]!==undefined));
            const act = items.reduce((s,it)=>s+(Number(it.act_total)||0),0);
            const variance = act - est;
            const varColor = !hasAnyActual ? 'var(--text3)' : variance>0 ? 'var(--red)' : variance<0 ? 'var(--green)' : 'var(--text2)';
            return (
              <div key={a.id} style={{display:'grid',gridTemplateColumns:'1fr 160px 120px 120px 120px 100px',
                gap:0,padding:'10px 12px',borderBottom:'1px solid var(--border)',alignItems:'center',cursor:'pointer'}}
                onClick={()=>setSelected(a)}>
                <div>
                  <span className="mono bold" style={{fontSize:13,color:'var(--accent)'}}>{a.order_id}</span>
                  {a.order?.po_number && <span className="mono" style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>PO:{a.order.po_number}</span>}
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>{custName(a.order?.customer_id)}</div>
                </div>
                <div>
                  <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,textTransform:'capitalize',
                    color:a.status==='submitted'?'var(--green)':'var(--amber,#d97706)',
                    background:a.status==='submitted'?'var(--green-lt)':'var(--amber-lt,#fffbeb)',
                    border:`1px solid ${a.status==='submitted'?'var(--green)':'var(--amber,#d97706)'}44`}}>
                    {a.status==='submitted'?'✅ Reviewed':'⏳ Pending'}
                  </span>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--accent)'}}>{fmtM(est)}</div>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>{hasAnyActual?fmtM(act):<span style={{color:'var(--text3)'}}>—</span>}</div>
                <div style={{fontSize:12,fontWeight:800,color:varColor}}>{hasAnyActual?(variance>0?'+':'')+fmtM(variance):'—'}</div>
                <div style={{textAlign:'right'}} onClick={e=>e.stopPropagation()}>
                  <button className="btn btn-xs btn-primary" onClick={()=>setSelected(a)}>👁 View</button>
                </div>
              </div>
            );
          })}
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
