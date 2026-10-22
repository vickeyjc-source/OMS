// client/src/pages/AuditBinPage.js
// Audit Bin — post-delivery hub. Compares the Sourcing estimate with the actual cost
// (BOE / local invoice) and shows variance and net profit.
//
//   List page  : one row per audited order (Customer Paid / Supplier Paid as before)
//   Order view : ＋ Add BOE / ＋ Add Local Invoice → step 1 (tick MPNs) → step 2 (enter actuals)
//   Review     : order value, variance, estimated vs net profit → Submit & close (locks)
//   History    : who changed what (written by the server)
//
// All numbers are calculated by the server (GET /audit-bin/:id/workspace); this file only
// shows them and sends what the user typed. Nothing here recalculates the Sourcing estimate.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

// ── helpers ──────────────────────────────────────────────────────────────────
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pn = s => { if (s === null || s === undefined) return null; const t = String(s).replace(/,/g, '').trim(); if (t === '') return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
const inr = n => Math.round(n).toLocaleString('en-IN');
const rs = n => (n < 0 ? '−' : '') + '₹' + inr(Math.abs(n));
const sg = n => (Math.abs(n) < 0.5 ? '₹0' : (n > 0 ? '+' : '−') + '₹' + inr(Math.abs(n)));
const pc = (a, e) => (e ? ((a - e) / e * 100 > 0 ? '+' : '') + ((a - e) / e * 100).toFixed(1) + '%' : '');
const cl = d => (Math.abs(d) < 0.5 ? '' : d > 0 ? 'ab-red' : 'ab-grn');   // cost going up = bad
const fmtM = n => { const v = parseFloat(n); return Number.isFinite(v) ? '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '₹0'; };
const fd = s => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const fdt = s => { if (!s) return ''; const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T')); return isNaN(d) ? String(s) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const initials = n => String(n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

const CSYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', SGD: 'S$', AED: 'AED ', JPY: '¥', CNY: 'CN¥' };
const csym = c => (CSYM[c] !== undefined ? CSYM[c] : (c ? c + ' ' : '₹'));
// amount held in INR, shown in `ccy` (divided by the rate frozen when the audit was closed)
const mon = (inrAmt, ccy, rate) => { const v = ccy === 'INR' ? inrAmt : inrAmt / (rate || 1); return (v < 0 ? '−' : '') + csym(ccy) + Math.round(Math.abs(v)).toLocaleString(ccy === 'INR' ? 'en-IN' : 'en-US'); };

const NAME = { boe: 'BOE', local: 'Local invoice' };
const HEADS = { boe: { LH: ['mat', 'bcd', 'sws', 'cess'], SH: ['frt', 'ins', 'clr', 'bank'] }, local: { LH: ['mat'], SH: ['frt', 'bank'] } };
const LBL = t => ({ mat: 'Material (supplier invoice)', bcd: 'BCD', sws: 'SWS', cess: 'CESS', frt: t === 'local' ? 'Freight / transport' : 'Freight', ins: 'Insurance', clr: 'Clearing', bank: 'Bank charges' });
const modeIsPct = m => /pct|percent|%/i.test(String(m || ''));

// "As priced in Sourcing" chips for one MPN (read-only; the ₹ values are the frozen Sourcing estimate)
function srcChips(l) {
  const sc = l.sourcing || {}, fm = sc.field_modes || {}, raw = sc.raw || {};
  const out = [['Price', '₹' + inr(num(sc.unit_price)) + ' /pc']];
  [['freight', 'Freight', 'frt'], ['insurance', 'Insurance', 'ins'], ['bcd', 'BCD', 'bcd'], ['sws', 'SWS', 'sws'],
   ['cess', 'CESS', 'cess'], ['clearing', 'Clearing', 'clr'], ['bank', 'Bank', 'bank']].forEach(([rk, lab, ek]) => {
    const e = num(l.est[ek]); if (!e && !num(raw[rk])) return;
    out.push([lab, (modeIsPct(fm[rk]) && num(raw[rk]) ? num(raw[rk]) + '% = ' : '') + '₹' + inr(e)]);
  });
  return out;
}

const CSS = `
.ab2{--ab-line:var(--border,#e3e8ef);--ab-mut:var(--text3,#6b7686);--ab-sub:var(--surface2,#f0f3f8);--ab-card:var(--surface,#fff);
  --ab-navy:var(--accent,#1e3a8a);--ab-red:var(--red,#c0262d);--ab-grn:var(--green,#0f7b4b);
  --ab-amb:#9a6200;--ab-ambbg:#fff4de;--ab-grnbg:#e5f6ee;--ab-redbg:#fdecec;--ab-inp:#fffdf4;font-size:13.5px}
.ab2 .ab-card{background:var(--ab-card);border:1px solid var(--ab-line);border-radius:10px;margin-bottom:12px;overflow:hidden}
.ab2 .ab-pad{padding:12px 14px}
.ab2 .mut,.ab2 .note{color:var(--ab-mut)}.ab2 .note{font-size:12px}
.ab2 .ab-red{color:var(--ab-red)}.ab2 .ab-grn{color:var(--ab-grn)}
.ab2 .chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:700;white-space:nowrap}
.ab2 .c-red{background:var(--ab-redbg);color:var(--ab-red)}.ab2 .c-grn{background:var(--ab-grnbg);color:var(--ab-grn)}
.ab2 .c-amb{background:var(--ab-ambbg);color:var(--ab-amb)}.ab2 .c-mut{background:var(--ab-sub);color:var(--ab-mut)}
.ab2 .kpis{display:grid;grid-template-columns:repeat(5,1fr)}
.ab2 .kpis>div{padding:10px 14px;border-right:1px solid var(--ab-line)}.ab2 .kpis>div:last-child{border:0}
.ab2 .kpis small{display:block;font-size:10.5px;color:var(--ab-mut);text-transform:uppercase;letter-spacing:.04em}
.ab2 .kpis .v{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;display:block}.ab2 .kpis .s{font-size:11.5px;display:block}
.ab2 .sec{display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;gap:8px;flex-wrap:wrap}.ab2 .sec b{font-size:14.5px}
.ab2 .tools{display:flex;gap:8px;flex-wrap:wrap}
.ab2 table{width:100%;border-collapse:collapse}
.ab2 th{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ab-mut);text-align:right;padding:8px 12px;border-bottom:1px solid var(--ab-line);font-weight:700}
.ab2 td{padding:7px 12px;border-bottom:1px solid var(--ab-line);text-align:right;font-variant-numeric:tabular-nums;vertical-align:middle}
.ab2 th:first-child,.ab2 td:first-child,.ab2 td.l,.ab2 th.l{text-align:left}
.ab2 td.est{color:var(--ab-mut)}.ab2 td .h{display:block;font-size:11px;color:var(--ab-mut);text-align:left;font-weight:400}
.ab2 td input[type=text].ab-in{width:128px;text-align:right;padding:6px 8px;border:1px solid var(--ab-line);border-radius:6px;background:var(--ab-inp);font:inherit;color:inherit}
.ab2 td input.asm{font-style:italic;color:var(--ab-mut);border-style:dashed;background:var(--ab-card)}
.ab2 td input.nm{width:170px;text-align:left}
.ab2 tr.sub td{background:var(--ab-sub);font-weight:700}
.ab2 tr.tot td{background:var(--ab-navy);color:#fff;font-weight:700}.ab2 tr.tot td.ab-red,.ab2 tr.tot td.ab-grn{color:#fff}
.ab2 tr.grp td{background:var(--ab-sub);text-align:left;font-weight:700}
.ab2 tr.dis td{opacity:.45}
.ab2 .vr{font-weight:600}
.ab2 .src{display:flex;flex-wrap:wrap;gap:4px}
.ab2 .src span{font-size:11px;background:var(--ab-sub);border:1px solid var(--ab-line);border-radius:5px;padding:1px 7px;white-space:nowrap}
.ab2 .src span b{color:var(--ab-mut);font-weight:600;margin-right:3px}
.ab2 .ban{padding:10px 14px;background:var(--ab-ambbg);color:var(--ab-amb);border-radius:10px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ab2 .ban span{flex:1 1 300px}
.ab2 .lock{padding:10px 14px;background:var(--ab-grnbg);color:var(--ab-grn);border-radius:10px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ab2 .lock span{flex:1}
.ab2 .steps{display:flex;gap:8px;align-items:center;margin:4px 0 14px;flex-wrap:wrap}
.ab2 .steps .s{display:flex;align-items:center;gap:8px;color:var(--ab-mut)}
.ab2 .steps .n{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--ab-line);display:grid;place-items:center;font-size:11.5px;font-weight:700}
.ab2 .steps .on{color:inherit;font-weight:600}.ab2 .steps .on .n{background:var(--ab-navy);color:#fff;border-color:var(--ab-navy)}
.ab2 .steps .bar{width:34px;height:2px;background:var(--ab-line)}
.ab2 .f{display:flex;flex-wrap:wrap;gap:10px 16px;padding:12px 14px;align-items:flex-end}
.ab2 .f label{display:block;font-size:10.5px;color:var(--ab-mut);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
.ab2 .f input[type=text],.ab2 .f input[type=date]{padding:7px 10px;border:1px solid var(--ab-line);border-radius:6px;background:var(--ab-card);font:inherit;color:inherit;width:190px}
.ab2 .foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap}
.ab2 .chk li{margin:3px 0;list-style:none}.ab2 .chk ul{margin:6px 0 0;padding:0}
.ab2 .okc{color:var(--ab-grn);font-weight:700}.ab2 .nok{color:var(--ab-red);font-weight:700}
.ab2 .x{border:0;background:none;color:var(--ab-mut);cursor:pointer;font-size:16px}
.ab2 .hi{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--ab-line)}.ab2 .hi:last-child{border:0}
.ab2 .av{flex:none;width:28px;height:28px;border-radius:50%;background:var(--ab-navy);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
.ab2 .hi ul{margin:4px 0 0;padding-left:18px}.ab2 .hi li{margin:2px 0;font-size:12.5px}
.ab2 .hscroll{max-height:420px;overflow:auto}
.ab2 .empty{padding:26px 14px;text-align:center;color:var(--ab-mut)}
.ab2 input[type=checkbox]{width:16px;height:16px;cursor:pointer}
.ab2 textarea.rm{width:100%;margin-top:8px;padding:8px 10px;border:1px solid var(--ab-line);border-radius:8px;background:var(--ab-card);color:inherit;font:inherit}
@media(max-width:780px){.ab2 .kpis{grid-template-columns:1fr 1fr}.ab2 .hs{display:none}.ab2 td input[type=text].ab-in{width:92px}}
`;

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ history }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <div
        className="sec"
        style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--ab-mut)', display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <b>History</b>
          <span className="note">({history.length} event{history.length === 1 ? '' : 's'})</span>
        </div>
        <span className="note" style={{ fontSize: 12 }}>{open ? 'Collapse ▲' : 'Expand ▼'}</span>
      </div>
      {open && (
        <div className="ab-card hscroll" style={{ marginTop: 6 }}>
          {history.length === 0 && <div className="empty">No changes recorded yet.</div>}
          {history.map(h => {
            const userDisplay = h.by_name || h.by_email || 'System';
            const emailDisplay = h.by_email && h.by_name && h.by_email !== h.by_name ? `(${h.by_email})` : '';
            return (
              <div className="hi" key={h.id}>
                <span className="av">{h.by_name && h.by_name !== 'System' ? initials(h.by_name) : '⚙'}</span>
                <div style={{ flex: 1 }}>
                  <b>{userDisplay}</b>{emailDisplay ? <span className="note" style={{ marginLeft: 5, marginRight: 5, fontWeight: 500 }}>{emailDisplay}</span> : ' '}
                  {h.action} <span className="note">· {fdt(h.at)}</span>
                  {Array.isArray(h.details) && h.details.length > 0 && <ul>{h.details.map((d, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 1 — tick the MPNs covered by this document ───────────────────────────
function Step1({ ws, draft, setDraft, onCancel, onNext }) {
  const T = draft.type;
  const itemById = useMemo(() => Object.fromEntries(ws.items.map(i => [i.id, i])), [ws]);
  const docById = useMemo(() => Object.fromEntries(ws.documents.map(d => [d.id, d])), [ws]);
  const supKey = l => { const it = itemById[l.item_id] || {}; return it.supplier_id || it.supplier_name || l.item_id; };
  const supName = l => (itemById[l.item_id] || {}).supplier_name || 'Supplier';
  const groups = useMemo(() => {
    const m = new Map();
    ws.lines.forEach(l => { const k = supKey(l); if (!m.has(k)) m.set(k, { key: k, name: supName(l), lines: [] }); m.get(k).lines.push(l); });
    return [...m.values()];
  }, [ws]); // eslint-disable-line
  const toggle = (l, on) => setDraft(d => {
    const sel = d.sel.filter(x => x !== l.id); if (on) sel.push(l.id);
    return { ...d, sel, supKey: sel.length ? supKey(ws.lines.find(x => x.id === sel[0])) : null };
  });
  const toggleAll = (g, on) => setDraft(d => {
    let sel = d.sel.filter(id => !g.lines.some(l => l.id === id));
    if (on) sel = [...sel, ...g.lines.filter(l => l.doc_type_needed === T && !l.document_id).map(l => l.id)];
    return { ...d, sel, supKey: sel.length ? g.key : null };
  });
  return (
    <>
      <div className="sec"><b>Add {NAME[T]}</b><button className="btn" onClick={onCancel}>Cancel</button></div>
      <div className="steps"><div className="s on"><span className="n">1</span>Choose items</div><span className="bar"/><div className="s"><span className="n">2</span>Enter actuals</div></div>
      <p className="note" style={{ margin: '0 0 8px' }}>
        {T === 'boe' ? 'Tick the imported items covered by this Bill of Entry. One BOE covers one supplier — tick the supplier header if the whole order came from a single source.'
                      : 'Tick the locally sourced items covered by this invoice. One invoice covers one supplier.'}
        {' '}Values shown are exactly as priced in Sourcing.
      </p>
      <div className="ab-card">
        <table>
          <thead><tr><th style={{ width: 34 }}/><th className="l">Item</th><th>Qty</th><th className="l">As priced in Sourcing</th><th className="l">Status</th></tr></thead>
          <tbody>
            {groups.map(g => {
              const avail = g.lines.filter(l => l.doc_type_needed === T && !l.document_id);
              const blocked = draft.supKey && draft.supKey !== g.key;
              const allOn = avail.length > 0 && avail.every(l => draft.sel.includes(l.id));
              return (
                <React.Fragment key={g.key}>
                  <tr className="grp">
                    <td><input type="checkbox" checked={allOn} disabled={!avail.length || blocked} onChange={e => toggleAll(g, e.target.checked)}/></td>
                    <td colSpan={4}>{g.name} <span className="note">· {g.lines.length} item{g.lines.length > 1 ? 's' : ''}{avail.length > 1 ? ' · tick to select all' : ''}</span></td>
                  </tr>
                  {g.lines.map(l => {
                    const doc = l.document_id ? docById[l.document_id] : null;
                    const wrong = l.doc_type_needed !== T;
                    const off = !!doc || blocked || wrong;
                    return (
                      <tr key={l.id} className={off ? 'dis' : ''}>
                        <td><input type="checkbox" checked={draft.sel.includes(l.id)} disabled={off} onChange={e => toggle(l, e.target.checked)}/></td>
                        <td className="l"><b>{l.mpn}</b> {l.doc_type_needed === 'local' && <span className="chip c-amb">Local</span>}
                          <span className="h">{l.manufacturer || '—'}</span></td>
                        <td>{l.qty}</td>
                        <td className="l"><div className="src">{srcChips(l).map(([k, v]) => <span key={k}><b>{k}</b>{v}</span>)}</div></td>
                        <td className="l">{doc ? <span className="chip c-grn">{NAME[doc.doc_type]} {doc.doc_no}</span>
                          : wrong ? <span className="note">{l.doc_type_needed === 'local' ? 'Local — use Add Local Invoice' : 'Import — use Add BOE'}</span>
                          : blocked ? <span className="note">other supplier</span> : <span className="chip c-mut">Awaiting</span>}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="foot">
        <span className="note">{draft.sel.length ? `${draft.sel.length} item(s) selected` : 'Nothing selected'}</span>
        <button className="btn btn-primary" disabled={!draft.sel.length} onClick={onNext}>Next →</button>
      </div>
    </>
  );
}

// ── Step 2 — enter actuals (Sourcing estimates pre-filled as "assumed") ───────────────
function Step2({ ws, draft, setDraft, auditId, saving, onCancel, onBack, onSave }) {
  const T = draft.type, LB = LBL(T);
  const lineById = useMemo(() => Object.fromEntries(ws.lines.map(l => [l.id, l])), [ws]);
  const L = draft.sel.map(id => lineById[id]).filter(Boolean);
  const multi = L.length > 1;
  const H = HEADS[T];
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const keys = [...L.flatMap(l => H.LH.map(h => l.id + ':' + h)), ...H.SH];
  const estOf = k => k.includes(':') ? num((lineById[k.split(':')[0]].est || {})[k.split(':')[1]]) : L.reduce((s, l) => s + num(l.est[k]), 0);
  const has = k => pn(draft.act[k]) !== null;
  const A = k => has(k) ? pn(draft.act[k]) : estOf(k);

  const setAct = (k, raw) => setDraft(d => {
    const s = raw.replace(/,/g, ''), act = { ...d.act };
    if (s.trim() === '') delete act[k]; else if (/^-?\d*\.?\d*$/.test(s)) act[k] = s;
    return { ...d, act };
  });
  const setEx = (i, patch) => setDraft(d => ({ ...d, ex: d.ex.map((r, j) => j === i ? { ...r, ...patch } : r) }));
  const setExAmt = (i, raw) => { const s = raw.replace(/,/g, ''); if (s.trim() === '') setEx(i, { a: null }); else if (/^-?\d*\.?\d*$/.test(s)) setEx(i, { a: s }); };
  const exHas = r => pn(r.a) !== null;
  const exAct = r => exHas(r) ? pn(r.a) : num(r.est);

  const confirmAll = () => setDraft(d => {
    const act = {}; keys.forEach(k => { act[k] = String(Math.round(estOf(k) * 100) / 100); });
    return { ...d, act, ex: d.ex.map(r => r.added ? r : { ...r, a: String(num(r.est)) }) };
  });

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('entity_type', 'audit_document'); fd.append('entity_id', auditId); fd.append('field_name', T);
      const { data } = await api.post('/files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const f = data.file || data;
      setDraft(d => ({ ...d, file: { id: f.id, original_name: f.original_name || file.name } }));
      toast.success('PDF attached');
    } catch (e) { toast.error(e.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const estRows = draft.ex.filter(r => !r.added);
  const confirmed = keys.filter(has).length + estRows.filter(exHas).length;
  const total = keys.length + estRows.length;
  const eT = keys.reduce((s, k) => s + estOf(k), 0) + estRows.reduce((s, r) => s + num(r.est), 0);
  const aT = keys.reduce((s, k) => s + A(k), 0) + draft.ex.reduce((s, r) => s + exAct(r), 0);
  const cif = (f) => L.reduce((s, l) => s + f(l.id + ':mat'), 0) + f('frt') + f('ins');

  const row = (k, label, sub) => {
    const e = estOf(k), actVal = A(k);
    const diff = actVal - e;
    return (
      <tr key={k}>
        <td className="l">{label}{sub ? <span className="h">{sub}</span> : null}</td>
        <td className="est hs">{rs(e)}</td>
        <td><input type="text" inputMode="decimal" className="ab-in" value={draft.act[k] !== undefined && draft.act[k] !== null ? draft.act[k] : inr(e)}
          onFocus={ev => ev.target.select()} onChange={ev => setAct(k, ev.target.value)}/></td>
        <td className={'vr ' + cl(diff)}>{sg(diff)}</td>
      </tr>
    );
  };

  const rows = [];
  L.forEach(l => rows.push(row(l.id + ':mat', (multi ? l.mpn + ' · ' : '') + LB.mat, l.qty + ' pcs')));
  rows.push(row('frt', LB.frt, multi ? 'whole document' : ''));
  if (T === 'boe') {
    rows.push(row('ins', LB.ins, ''));
    const eC = cif(estOf), aC = cif(A);
    rows.push(<tr className="sub" key="cif"><td className="l">CIF value</td><td className="hs">{rs(eC)}</td><td>{rs(aC)}</td><td className={cl(aC - eC)}>{sg(aC - eC)}</td></tr>);
    L.forEach(l => ['bcd', 'sws', 'cess'].forEach(h => rows.push(row(l.id + ':' + h, (multi ? l.mpn + ' · ' : '') + LB[h], h === 'bcd' ? 'keyed from the BOE' : ''))));
    rows.push(row('clr', LB.clr, ''));
  }
  rows.push(row('bank', LB.bank, ''));

  const lbl = T === 'boe' ? 'BOE' : 'Invoice';
  return (
    <>
      <div className="sec"><b>{draft.id ? 'Edit' : 'Add'} {NAME[T]} · {draft.supName}</b><button className="btn" onClick={onCancel}>Cancel</button></div>
      <div className="steps"><div className="s"><span className="n">✓</span>Choose items</div><span className="bar"/><div className="s on"><span className="n">2</span>Enter actuals</div></div>
      <div className="ab-card">
        <div className="f">
          <div><label>{lbl} number</label><input type="text" value={draft.no} placeholder={T === 'boe' ? 'e.g. 5410872' : 'e.g. INV-2210'} onChange={e => setDraft(d => ({ ...d, no: e.target.value }))}/></div>
          <div><label>{lbl} date</label><input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}/></div>
          <div><label>{lbl} document (PDF)</label>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => upload(e.target.files[0])}/>
            <button className="btn" disabled={uploading} onClick={() => fileRef.current && fileRef.current.click()}>{uploading ? 'Uploading…' : draft.file ? '⬆ Replace' : '⬆ Upload PDF'}</button>
            {draft.file && <a href={`/api/files/${draft.file.id}/download`} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 12 }}>📎 {draft.file.original_name || 'file'}</a>}
          </div>
          <div style={{ marginLeft: 'auto' }} className="note">{L.map(l => l.mpn).join(', ')}</div>
        </div>
      </div>
      <div className="ban"><span><b>Values below are pre-filled from Sourcing estimates.</b> Overwrite only what differs on the {T === 'boe' ? 'BOE' : 'invoice'}. Variance defaults to ₹0 and updates automatically as you enter actuals.</span>
        <button className="btn" onClick={confirmAll}>Reset to estimates (₹0 variance)</button></div>
      <div className="ab-card" style={{ padding: '4px 0' }}>
        {L.map(l => (
          <div key={l.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--ab-line)' }}>
            <b>{l.mpn}</b> <span className="note">{l.manufacturer || ''} · {l.qty} pcs — as priced in Sourcing</span>
            <div className="src" style={{ marginTop: 4 }}>{srcChips(l).map(([k, v]) => <span key={k}><b>{k}</b>{v}</span>)}</div>
          </div>
        ))}
      </div>
      <div className="ab-card">
        <table>
          <thead><tr><th className="l">Cost head</th><th className="hs">Sourcing estimate</th><th>Actual (₹)</th><th>Variance ₹</th></tr></thead>
          <tbody>
            {rows}
            <tr className="grp"><td colSpan={4}>Additional charges <span className="note">· estimated ones come from Sourcing; add any extra charge that was actually paid</span></td></tr>
            {draft.ex.map((r, i) => {
              const h = exHas(r), a = exAct(r);
              const diff = r.added ? a : (a - num(r.est));
              return (
                <tr key={i}>
                  <td className="l">{r.added
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="text" className="ab-in nm" placeholder="Charge name" value={r.n} onChange={e => setEx(i, { n: e.target.value })}/>
                        <button className="x" title="Remove" onClick={() => setDraft(d => ({ ...d, ex: d.ex.filter((_, j) => j !== i) }))}>×</button>
                      </div>
                    : <>{r.n}<span className="h">from Sourcing</span></>}</td>
                  <td className="est hs">{rs(num(r.est))}</td>
                  <td><input type="text" inputMode="decimal" className="ab-in"
                    value={r.a !== null && r.a !== undefined ? r.a : (r.added ? '' : inr(num(r.est)))} placeholder={r.added ? '0' : ''}
                    onFocus={e => e.target.select()} onChange={e => setExAmt(i, e.target.value)}/></td>
                  <td className={'vr ' + (r.added && !h ? '' : cl(diff))}>{r.added ? (h ? sg(a) : '—') : sg(diff)}</td>
                </tr>
              );
            })}
            <tr><td className="l" colSpan={4}><button className="btn" onClick={() => setDraft(d => ({ ...d, ex: [...d.ex, { n: '', est: 0, a: null, added: true }] }))}>＋ Add charge</button></td></tr>
            <tr className="tot"><td className="l">{NAME[T]} total</td><td className="hs">{rs(eT)}</td><td>{rs(aT)}</td><td>{sg(aT - eT)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="foot">
        <button className="btn" onClick={onBack} style={draft.id ? { visibility: 'hidden' } : null}>← Back</button>
        <span className="note">All values pre-filled from Sourcing estimates · Edit any values that differ</span>
        <button className="btn btn-primary" disabled={saving || uploading} onClick={onSave}>{saving ? 'Saving…' : `Save ${NAME[T]}`}</button>
      </div>
    </>
  );
}

// ── Review & submit ───────────────────────────────────────────────────────────
function byHead(ws) {
  const lineById = Object.fromEntries(ws.lines.map(l => [l.id, l]));
  const NAMES = { mat: 'Material', frt: 'Freight', ins: 'Insurance', bcd: 'BCD', sws: 'SWS', cess: 'CESS', clr: 'Clearing', bank: 'Bank charges', ext: 'Additional charges' };
  const m = {}; Object.keys(NAMES).forEach(k => { m[k] = { n: NAMES[k], e: 0, a: 0 }; });
  ws.documents.forEach(d => {
    const t = d.doc_type, L = d.line_ids.map(id => lineById[id]).filter(Boolean), act = d.entries.act || {};
    ['mat', 'bcd', 'sws', 'cess'].forEach(h => L.forEach(l => { const e = num(l.est[h]); m[h].e += e; m[h].a += (HEADS[t].LH.includes(h) && (l.id + ':' + h) in act) ? num(act[l.id + ':' + h]) : e; }));
    ['frt', 'ins', 'clr', 'bank'].forEach(h => { const e = L.reduce((s, l) => s + num(l.est[h]), 0); m[h].e += e; m[h].a += (HEADS[t].SH.includes(h) && h in act) ? num(act[h]) : e; });
    (d.entries.ex || []).forEach(r => { m.ext.e += num(r.est); m.ext.a += (r.a !== null && r.a !== undefined) ? num(r.a) : num(r.est); });
  });
  const rowsArr = Object.values(m);
  const se = rowsArr.reduce((s, x) => s + x.e, 0), sa = rowsArr.reduce((s, x) => s + x.a, 0);
  const oe = ws.totals.est_cost - se, oa = ws.totals.act_cost - sa;       // PO extras not on a document + Finance charges
  if (Math.abs(oe) >= 0.5 || Math.abs(oa) >= 0.5) rowsArr.push({ n: 'Other (PO extras / Finance charges)', e: oe, a: oa });
  return rowsArr.filter(x => x.e || x.a);
}

function Review({ ws, remarks, setRemarks, submitting, onBack, onSubmit }) {
  const lineById = Object.fromEntries(ws.lines.map(l => [l.id, l]));
  const [ok, setOk] = useState(false);
  const cur = ws.currency || { code: 'INR', rate: 1 };
  const foreign = cur.code !== 'INR';
  const startRate = cur.missing ? (cur.suggested ? cur.suggested.rate : (cur.rate !== 1 ? cur.rate : '')) : cur.rate;
  const [fx, setFx] = useState(foreign && startRate ? String(startRate) : '');
  const fxNum = foreign ? (pn(fx) || 0) : 1;
  // revenue is converted at the rate in the box; every cost is already ₹
  const t = useMemo(() => {
    const T = ws.totals; if (!foreign || !fxNum || !T.fx_rate_to_inr) return T;
    const k = fxNum / T.fx_rate_to_inr, rev = T.revenue_ex_gst * k, ep = rev - T.est_cost, np = rev - T.act_cost;
    return { ...T, revenue_ex_gst: rev, revenue_incl_gst: T.revenue_incl_gst * k, est_profit: ep, net_profit: np, profit_variance: np - ep,
             est_margin_pct: rev ? ep / rev * 100 : 0, net_margin_pct: rev ? np / rev * 100 : 0, fx_rate_to_inr: fxNum };
  }, [ws, foreign, fxNum]);
  const cv = t.cost_variance, cvp = t.cost_variance_pct, pv = t.profit_variance;
  const need = Math.abs(cvp) > (ws.readiness.variance_limit_pct ?? 5) || pv < -0.5;
  const H = useMemo(() => byHead(ws), [ws]);
  const drivers = H.map(x => ({ ...x, d: x.a - x.e })).filter(x => Math.abs(x.d) >= 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
  const canSubmit = ok && (!need || remarks.trim().length > 2) && !submitting && (!foreign || fxNum > 0);
  const em = t.est_margin_pct, am = t.net_margin_pct;
  return (
    <>
      <div className="sec"><b>Review &amp; submit audit</b><button className="btn" onClick={onBack}>← Back to edit</button></div>
      <div className="steps"><div className="s"><span className="n">✓</span>Entries</div><span className="bar"/><div className="s on"><span className="n">2</span>Review &amp; submit</div></div>
      {foreign && (
        <div className="ban"><span><b>This order is billed in {cur.code}.</b> Costs are in ₹, so order value is converted at the rate below and the rate is saved with the audit. Profit is then shown in ₹ and in {cur.code}.
          {cur.suggested ? <> Suggested: ₹{cur.suggested.rate.toFixed(2)} ({cur.suggested.source}, {fd(cur.suggested.date)}{cur.suggested.stale ? ', last known' : ''}).</> : null}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>1 {cur.code} = ₹ <input type="text" inputMode="decimal" value={fx} onChange={e => setFx(e.target.value.replace(/[^0-9.]/g, ''))}
            style={{ width: 90, padding: '6px 8px', border: '1px solid var(--ab-line)', borderRadius: 6, background: 'var(--ab-card)', color: 'inherit', font: 'inherit', textAlign: 'right' }}/></label></div>)}
      <div className="ab-card ab-pad"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
        <div><div className="note">ORDER VALUE (EX-GST)</div><div style={{ fontSize: 19, fontWeight: 700 }}>{rs(t.revenue_ex_gst)}</div><div className="note">GST-incl. {rs(t.revenue_incl_gst)}</div></div>
        <div><div className="note">COST — ACTUAL</div><div style={{ fontSize: 19, fontWeight: 700 }}>{rs(t.act_cost)}</div><div className="note">est. {rs(t.est_cost)}</div></div>
        <div><div className="note">COST VARIANCE</div><div className={cl(cv)} style={{ fontSize: 19, fontWeight: 700 }}>{sg(cv)}</div><div className={'note ' + cl(cv)}>{cvp > 0 ? '+' : ''}{cvp.toFixed(1)}% vs estimate</div></div>
        <div><div className="note">NET PROFIT</div><div className={t.net_profit < 0 ? 'ab-red' : 'ab-grn'} style={{ fontSize: 19, fontWeight: 700 }}>{rs(t.net_profit)}</div><div className="note">{am.toFixed(1)}% margin · est. {rs(t.est_profit)} ({em.toFixed(1)}%)</div>
          {foreign && fxNum > 0 && <div className="note">≈ {mon(t.net_profit, cur.code, fxNum)} at ₹{fxNum}/{cur.code}</div>}</div>
      </div></div>
      <div className="ab-card ab-pad"><b>Profit reconciliation</b>
        <table style={{ marginTop: 6 }}><thead><tr><th/><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead><tbody>
          <tr><td>Order value (ex-GST)</td><td className="est">{rs(t.revenue_ex_gst)}</td><td>{rs(t.revenue_ex_gst)}</td><td>₹0</td></tr>
          <tr><td>Total cost</td><td className="est">{rs(t.est_cost)}</td><td>{rs(t.act_cost)}</td><td className={'vr ' + cl(cv)}>{sg(cv)}</td></tr>
          <tr className="sub"><td>Profit</td><td>{rs(t.est_profit)}</td><td>{rs(t.net_profit)}</td><td className={cl(-pv)}>{sg(pv)}</td></tr>
          <tr><td>Margin</td><td className="est">{em.toFixed(1)}%</td><td>{am.toFixed(1)}%</td><td className={'vr ' + cl(-(am - em))}>{am - em > 0 ? '+' : ''}{(am - em).toFixed(1)} pts</td></tr>
        </tbody></table>
        <p className="note" style={{ margin: '10px 0 0' }}>{drivers.length
          ? <><b>Biggest movers:</b> {drivers.map((d, i) => <span key={i}>{i ? ' · ' : ' '}{d.n} <span className={cl(d.d)}>{sg(d.d)}</span></span>)}</>
          : 'Actuals match the estimate.'}</p>
      </div>
      <div className="ab-card ab-pad"><b>Variance by cost head</b>
        <table style={{ marginTop: 6 }}><thead><tr><th className="l">Head</th><th>Estimated</th><th>Actual</th><th>Variance ₹</th></tr></thead><tbody>
          {H.map(x => <tr key={x.n}><td>{x.n}</td><td className="est">{rs(x.e)}</td><td>{rs(x.a)}</td><td className={'vr ' + cl(x.a - x.e)}>{sg(x.a - x.e)}</td></tr>)}
          <tr className="tot"><td>Total</td><td>{rs(t.est_cost)}</td><td>{rs(t.act_cost)}</td><td>{sg(cv)}</td></tr>
        </tbody></table>
      </div>
      <div className="ab-card ab-pad"><b>By document and MPN</b>
        <table style={{ marginTop: 6 }}><thead><tr><th className="l">Document / MPN</th><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead><tbody>
          {ws.documents.map(d => (
            <React.Fragment key={d.id}>
              <tr className="sub"><td className="l">{NAME[d.doc_type]} {d.doc_no || '(no number)'} · {d.supplier_name}</td><td>{rs(d.est_total)}</td><td>{rs(d.act_total)}</td><td className={cl(d.act_total - d.est_total)}>{sg(d.act_total - d.est_total)}</td></tr>
              {d.per_line.map(p => <tr key={p.line_id}><td className="l" style={{ paddingLeft: 28 }}>{(lineById[p.line_id] || {}).mpn}</td><td className="est">{rs(p.est)}</td><td>{rs(p.act)}</td><td className={cl(p.act - p.est)}>{sg(p.act - p.est)}</td></tr>)}
            </React.Fragment>
          ))}
        </tbody></table>
      </div>
      <div className="ab-card ab-pad"><b>Reviewer remarks</b> <span className="note">{need ? '— required: cost variance is beyond ±' + t_limit(ws) + '% or profit is below plan' : '— optional'}</span>
        <textarea className="rm" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. Freight higher due to air shipment; BCD per BOE assessment"/>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)}/> I have checked these figures against the BOEs and invoices.</label>
      </div>
      <div className="foot">
        <button className="btn" onClick={onBack}>← Back to edit</button>
        <span className="note">{canSubmit ? '' : (foreign && !(fxNum > 0)) ? 'Enter the ' + cur.code + ' → INR rate' : !ok ? 'Tick the confirmation to submit' : 'Add remarks to submit'}</span>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={() => onSubmit(foreign ? fxNum : null)}>{submitting ? 'Submitting…' : 'Submit & close audit'}</button>
      </div>
    </>
  );
}
const t_limit = ws => ws.readiness.variance_limit_pct ?? 5;

// ── Order workspace (modal) ───────────────────────────────────────────────────
function AuditWorkspace({ audit, onClose, onChanged }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const auditId = audit.id;
  const key = ['audit-ws', auditId];
  const { data: ws, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get(`/audit-bin/${auditId}/workspace`).then(r => r.data) });
  const [mode, setMode] = useState('order');          // order | step1 | step2 | review
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [remarks, setRemarks] = useState('');

  const apply = (data) => { qc.setQueryData(key, data); onChanged(); };
  const fail = (e, msg) => toast.error(e.response?.data?.error || msg);
  const canReopen = ['admin', 'manager'].includes(user?.role);

  const lineById = useMemo(() => Object.fromEntries((ws?.lines || []).map(l => [l.id, l])), [ws]);
  const itemById = useMemo(() => Object.fromEntries((ws?.items || []).map(i => [i.id, i])), [ws]);

  if (isLoading) return <Shell onClose={onClose} title={audit.order_id}><div className="loading-center">Loading…</div></Shell>;
  if (error || !ws) return <Shell onClose={onClose} title={audit.order_id}><div className="empty-state"><div className="empty-state-text">{error?.response?.data?.error || 'Could not load this audit.'}</div></div></Shell>;

  const closed = ws.audit.closed;
  const t = ws.totals, ready = ws.readiness.ready;
  const freeBoe = ws.lines.filter(l => !l.document_id && l.doc_type_needed === 'boe').length;
  const freeLoc = ws.lines.filter(l => !l.document_id && l.doc_type_needed === 'local').length;

  const startAdd = type => { setDraft({ id: null, type, supKey: null, supName: '', sel: [], no: '', date: '', file: null, act: {}, ex: [] }); setMode('step1'); };
  const startEdit = d => {
    setDraft({ id: d.id, type: d.doc_type, supKey: null, supName: d.supplier_name, sel: [...d.line_ids], no: d.doc_no, date: d.doc_date, file: d.file && d.file.id ? d.file : null,
      act: Object.fromEntries(Object.entries(d.entries.act || {}).map(([k, v]) => [k, String(v)])),
      ex: (d.entries.ex || []).map(r => ({ n: r.n, est: num(r.est), a: r.a === null || r.a === undefined ? null : String(r.a), added: !!r.added, src_item: r.src_item, src_idx: r.src_idx })) });
    setMode('step2');
  };
  const toStep2 = () => {
    const L = draft.sel.map(id => lineById[id]);
    const itemIds = [...new Set(L.map(l => l.item_id))];
    const ex = [];
    itemIds.forEach(iid => { const it = itemById[iid]; if (!it || it.est_extras_carried_by) return;
      (it.est_extras || []).forEach(c => ex.push({ n: c.n, est: num(c.est), a: inr(num(c.est)), added: false, src_item: iid, src_idx: c.src_idx })); });
    const H = HEADS[draft.type];
    const keys = [...L.flatMap(l => H.LH.map(h => l.id + ':' + h)), ...H.SH];
    const estOf = k => k.includes(':') ? num((lineById[k.split(':')[0]].est || {})[k.split(':')[1]]) : L.reduce((s, l) => s + num(l.est[k]), 0);
    const act = {};
    keys.forEach(k => { act[k] = inr(estOf(k)); });
    setDraft(d => ({ ...d, supName: (itemById[L[0].item_id] || {}).supplier_name || '', act: { ...act, ...d.act }, ex }));
    setMode('step2');
  };
  const save = async () => {
    const L = draft.sel.map(id => lineById[id]);
    const H = HEADS[draft.type];
    const keys = [...L.flatMap(l => H.LH.map(h => l.id + ':' + h)), ...H.SH];
    const estOf = k => k.includes(':') ? num((lineById[k.split(':')[0]].est || {})[k.split(':')[1]]) : L.reduce((s, l) => s + num(l.est[k]), 0);
    const actEntries = {};
    keys.forEach(k => {
      const v = draft.act[k];
      actEntries[k] = (v !== undefined && v !== null && pn(v) !== null) ? pn(v) : Math.round(estOf(k) * 100) / 100;
    });
    const body = {
      doc_type: draft.type, line_ids: draft.sel, doc_no: draft.no, doc_date: draft.date, file_id: draft.file ? draft.file.id : null,
      act: actEntries,
      ex: draft.ex.filter(r => !r.added || r.n.trim() || pn(r.a) !== null)
        .map(r => r.added ? { added: true, n: r.n, a: pn(r.a) || 0 } : { src_item: r.src_item, src_idx: r.src_idx, a: (r.a !== null && r.a !== undefined && pn(r.a) !== null) ? pn(r.a) : num(r.est) }),
    };
    setSaving(true);
    try {
      const { data } = draft.id ? await api.put(`/audit-documents/${draft.id}`, body) : await api.post(`/audit-bin/${auditId}/documents`, body);
      apply(data); toast.success(`${NAME[draft.type]} saved`); setMode('order'); setDraft(null);
    } catch (e) { fail(e, 'Failed to save'); }
    finally { setSaving(false); }
  };
  const remove = async d => {
    if (!window.confirm(`Remove ${NAME[d.doc_type]} ${d.doc_no || '(no number)'}? Its items go back to "awaiting".`)) return;
    try { const { data } = await api.delete(`/audit-documents/${d.id}`); apply(data); toast.success('Removed'); } catch (e) { fail(e, 'Failed to remove'); }
  };
  const submit = async (fxRate) => {
    setSaving(true);
    try { const { data } = await api.post(`/audit-bin/${auditId}/submit`, { remarks, fx_rate: fxRate || undefined }); apply(data); toast.success('Audit submitted and closed'); setMode('order'); }
    catch (e) { fail(e, 'Failed to submit'); }
    finally { setSaving(false); }
  };
  const reopen = async () => {
    const reason = window.prompt('Reason for reopening this audit?'); if (reason === null) return;
    try { const { data } = await api.post(`/audit-bin/${auditId}/reopen`, { reason }); apply(data); toast.success('Audit reopened'); } catch (e) { fail(e, 'Failed to reopen'); }
  };

  // KPI strip
  const PV = t.profit_variance;
  const kpis = (
    <div className="ab-card kpis" style={{ marginBottom: 0 }}>
      <div><small>Revenue (ex-GST)</small><span className="v">{rs(t.revenue_ex_gst)}</span><span className="s mut">GST-incl. {rs(t.revenue_incl_gst)}</span></div>
      <div><small>Estimated profit</small><span className="v">{rs(t.est_profit)}</span><span className="s mut">{t.est_margin_pct.toFixed(1)}% margin · cost {rs(t.est_cost)}</span></div>
      <div><small>Actual cost</small><span className="v">{rs(t.act_cost)}</span><span className="s mut">{ws.lines.filter(l => l.document_id).length} of {ws.lines.length} MPNs covered</span></div>
      <div><small>Net profit</small><span className={'v ' + (t.net_profit < 0 ? 'ab-red' : 'ab-grn')}>{rs(t.net_profit)}</span>
        {ws.currency && ws.currency.code !== 'INR' && <span className="s mut">≈ {mon(t.net_profit, ws.currency.code, ws.currency.rate)}{ws.currency.missing ? ' (rate not confirmed)' : ''}</span>}
        <span className="s">{t.net_margin_pct.toFixed(1)}% margin {closed ? <span className="chip c-grn">Final · Closed</span> : ready ? <span className="chip c-grn">Ready to close</span> : <span className="chip c-amb">Provisional</span>}</span></div>
      <div><small>Profit vs plan</small><span className={'v ' + cl(-PV)}>{sg(PV)}</span>
        <span className="s">{Math.abs(PV) < 0.5 ? <span className="chip c-amb">On plan</span> : PV < 0 ? <span className="chip c-red">Below plan</span> : <span className="chip c-grn">Above plan</span>}</span></div>
    </div>
  );

  let body;
  if (mode === 'step1') body = <Step1 ws={ws} draft={draft} setDraft={setDraft} onCancel={() => { setMode('order'); setDraft(null); }} onNext={toStep2}/>;
  else if (mode === 'step2') body = <Step2 ws={ws} draft={draft} setDraft={setDraft} auditId={auditId} saving={saving}
    onCancel={() => { setMode('order'); setDraft(null); }} onBack={() => setMode('step1')} onSave={save}/>;
  else if (mode === 'review') body = <Review ws={ws} remarks={remarks} setRemarks={setRemarks} submitting={saving} onBack={() => setMode('order')} onSubmit={submit}/>;
  else {
    const docOf = Object.fromEntries(ws.documents.map(d => [d.id, d]));
    const perLine = {}; ws.documents.forEach(d => d.per_line.forEach(p => { perLine[p.line_id] = p; }));
    let rowE = 0, rowA = 0;
    const lineRows = ws.lines.map(l => {
      const d = l.document_id ? docOf[l.document_id] : null, p = perLine[l.id];
      const base = Object.values(l.est).reduce((s, v) => s + num(v), 0);
      const e = p ? p.est : base, a = p ? p.act : base; rowE += e; rowA += a;
      return { l, d, e, a };
    });
    const otherE = t.est_cost - rowE, otherA = t.act_cost - rowA;
    body = (
      <>
        {closed && <div className="lock"><span><b>Audit submitted and closed.</b> {ws.audit.closed_by_name ? `Submitted by ${ws.audit.closed_by_name}${ws.audit.closed_by_email ? ` (${ws.audit.closed_by_email})` : ''}${ws.audit.closed_at ? ' on ' + fdt(ws.audit.closed_at) : ''}. ` : ''}Entries are locked.
          {ws.audit.review_remarks ? <><br/><i>Remarks: {ws.audit.review_remarks}</i></> : null}</span>
          {canReopen && <button className="btn" onClick={reopen}>Reopen</button>}</div>}
        <div className="sec"><b>BOEs and invoices</b>
          <div className="tools">
            <button className="btn btn-primary" disabled={closed || !freeBoe} onClick={() => startAdd('boe')}>＋ Add BOE <span style={{ opacity: .8, fontWeight: 400 }}>(import)</span></button>
            <button className="btn btn-primary" disabled={closed || !freeLoc} onClick={() => startAdd('local')}>＋ Add Local Invoice</button>
          </div></div>
        <div className="ab-card">
          {ws.documents.length ? (
            <table><thead><tr><th className="l">Document</th><th className="l hs">Supplier</th><th className="l">MPNs</th><th>Estimated</th><th>Actual</th><th>Variance</th><th/></tr></thead><tbody>
              {ws.documents.map(d => (
                <tr key={d.id}>
                  <td className="l"><span className={'chip ' + (d.doc_type === 'boe' ? 'c-mut' : 'c-amb')}>{NAME[d.doc_type]}</span> <b>{d.doc_no || '(no number)'}</b>
                    <span className="h">{fd(d.doc_date)} · edited by {d.updated_by_name || '—'}{d.updated_at ? ', ' + fdt(d.updated_at) : ''}</span></td>
                  <td className="l hs">{d.supplier_name}</td>
                  <td className="l">{d.line_ids.map(id => (lineById[id] || {}).mpn).join(', ')}
                    <span className="h">{d.confirmed_heads === d.total_heads ? <span className="ab-grn">✓ all heads confirmed</span> : <span style={{ color: 'var(--ab-amb)' }}>{d.total_heads - d.confirmed_heads} head(s) still assumed</span>}
                      {d.file && d.file.id ? <> · <a href={`/api/files/${d.file.id}/download`} target="_blank" rel="noreferrer">📎 PDF</a></> : null}</span></td>
                  <td className="est">{rs(d.est_total)}</td><td>{rs(d.act_total)}</td>
                  <td className={'vr ' + cl(d.act_total - d.est_total)}>{sg(d.act_total - d.est_total)}<span className="h" style={{ textAlign: 'right' }}>{pc(d.act_total, d.est_total)}</span></td>
                  <td>{closed ? '' : <><button className="btn" onClick={() => startEdit(d)}>Edit</button> <button className="btn" onClick={() => remove(d)}>Remove</button></>}</td>
                </tr>))}
            </tbody></table>
          ) : <div className="empty"><b>Nothing added yet</b><br/>Imported items: <b>＋ Add BOE</b> when the Bill of Entry is generated. Locally sourced items: <b>＋ Add Local Invoice</b>.<br/>Until then every line counts at its Sourcing estimate.</div>}
        </div>

        <div className="sec"><b>MPN-wise status</b></div>
        <div className="ab-card"><table><thead><tr><th className="l">MPN · Supplier</th><th className="l hs">Source document</th><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead><tbody>
          {lineRows.map(({ l, d, e, a }) => (
            <tr key={l.id}>
              <td className="l">{l.mpn} <span className="mut">· {l.qty} pcs</span> {l.doc_type_needed === 'local' && <span className="chip c-amb">Local</span>}<span className="h">{(itemById[l.item_id] || {}).supplier_name} · {l.manufacturer || '—'}</span></td>
              <td className="l hs">{d ? <span className="chip c-grn">{NAME[d.doc_type]} {d.doc_no || ''}</span> : <span className="chip c-mut">Awaiting — at Sourcing estimate</span>}</td>
              <td className="est">{rs(e)}</td><td>{rs(a)}</td><td className={'vr ' + cl(a - e)}>{sg(a - e)}</td>
            </tr>))}
          {(Math.abs(otherE) >= 0.5 || Math.abs(otherA) >= 0.5) && (
            <tr><td className="l">Other charges<span className="h">PO extras not yet on a document · Finance pre-paid PO charges (read-only)</span></td><td className="hs"/><td className="est">{rs(otherE)}</td><td>{rs(otherA)}</td><td className={'vr ' + cl(otherA - otherE)}>{sg(otherA - otherE)}</td></tr>)}
          <tr className="tot"><td className="l">Order total</td><td className="hs"/><td>{rs(t.est_cost)}</td><td>{rs(t.act_cost)}</td><td>{sg(t.cost_variance)}</td></tr>
        </tbody></table></div>

        <div className="ab-card ab-pad"><b>Net profit</b>
          <table style={{ marginTop: 6 }}><thead><tr><th/><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead><tbody>
            <tr><td>Revenue (ex-GST)</td><td className="est">{rs(t.revenue_ex_gst)}</td><td>{rs(t.revenue_ex_gst)}</td><td>₹0</td></tr>
            <tr><td>Total cost</td><td className="est">{rs(t.est_cost)}</td><td>{rs(t.act_cost)}</td><td className={'vr ' + cl(t.cost_variance)}>{sg(t.cost_variance)}</td></tr>
            <tr className="sub"><td>Net profit</td><td>{rs(t.est_profit)}</td><td>{rs(t.net_profit)}</td><td className={cl(-PV)}>{sg(PV)}</td></tr>
          </tbody></table></div>

        {!closed && (
          <div className="ab-card ab-pad chk"><b>Review &amp; close</b> <span className="note">— available only when every MPN is entered and every head is confirmed</span>
            <ul>{ws.lines.map(l => {
              const d = l.document_id ? docOf[l.document_id] : null, ok = d && d.confirmed_heads === d.total_heads;
              return <li key={l.id}><span className={ok ? 'okc' : 'nok'}>{ok ? '✓' : '✗'}</span> {l.mpn} <span className="mut">— {!d ? 'no ' + (l.doc_type_needed === 'local' ? 'local invoice' : 'BOE') + ' yet' : ok ? NAME[d.doc_type] + ' ' + (d.doc_no || '') + ' · all heads confirmed' : (d.total_heads - d.confirmed_heads) + ' head(s) still assumed on ' + NAME[d.doc_type] + ' ' + (d.doc_no || '')}</span></li>;
            })}</ul>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!ready} onClick={() => setMode('review')}>Review &amp; submit →</button>
              <span className="note">{ready ? 'Everything is entered — review and submit.' : ws.readiness.pending.length + ' item(s) pending'}</span></div>
          </div>)}

        <HistoryPanel history={ws.history}/>
      </>
    );
  }

  return (
    <Shell onClose={onClose}
      title={<>{ws.order?.id || audit.order_id}{ws.order?.po_number ? <span className="mono" style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>PO:{ws.order.po_number}</span> : null}
      {ws.order?.customer_name ? <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 10, fontWeight: 400 }}>{ws.order.customer_name}</span> : null}</>}
      kpis={<div className="ab2"><style>{CSS}</style>{kpis}</div>}>
      <div className="ab2"><style>{CSS}</style>{body}</div>
    </Shell>
  );
}

function Shell({ title, kpis, onClose, children }) {
  return (
    <div className="overlay" style={{ zIndex: 60 }}>
      <div className="modal modal-xl" style={{ width: '96vw', maxWidth: 1360, height: '96vh', maxHeight: '96vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div><h2>📋 Audit — {title}</h2></div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        {kpis && (
          <div style={{ padding: '12px 20px 8px', background: 'var(--surface, #fff)', borderBottom: '1px solid var(--border, #e3e8ef)', flexShrink: 0 }}>
            {kpis}
          </div>
        )}
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '14px 20px' }}>
          {children}
        </div>
        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Closed audits tab ──────────────────────────────────────────────────────────
// Reads the figures frozen at submit (final_*), so nothing is recalculated here.
function ClosedTab({ audits, custName, search, onOpen }) {
  const rows = useMemo(() => audits.filter(a => a.closed_at).map(a => {
    const rev = num(a.final_revenue_ex_gst), est = num(a.final_est_profit), net = num(a.final_net_profit);
    const ccy = a.order_currency || 'INR', rate = num(a.fx_rate_to_inr) || 1;
    const estM = rev ? est / rev * 100 : 0, netM = rev ? net / rev * 100 : 0;
    return { a, rev, est, net, estCost: num(a.final_est_cost), actCost: num(a.final_act_cost), ccy, rate, estM, netM, pv: netM - estM };
  }).sort((x, y) => String(y.a.closed_at).localeCompare(String(x.a.closed_at))), [audits]);

  const list = useMemo(() => {
    const q = (search || '').toLowerCase();
    return rows.filter(r => !q || (r.a.order_id || '').toLowerCase().includes(q) || (r.a.order?.po_number || '').toLowerCase().includes(q) || custName(r.a.order?.customer_id).toLowerCase().includes(q));
  }, [rows, search]); // eslint-disable-line

  const M = (r, v) => mon(v, r.ccy, r.rate);
  const other = (r, v) => r.ccy === 'INR' ? '' : mon(v, 'INR', 1);

  return (
    <div className="ab2"><style>{CSS}</style>
      <div className="ab-card">
        <table>
          <thead>
            <tr>
              <th className="l" style={{ width: '22%' }}>Order / Customer</th>
              <th className="l" style={{ width: '22%' }}>Closed</th>
              <th>Order Value (ex-GST)</th>
              <th>Total Cost</th>
              <th>Net Profit</th>
              <th>Margin %</th>
              <th>vs Plan</th>
              <th style={{ width: 80, textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => {
              const bad = r.pv < -0.05;
              const byUser = r.a.closed_by_email
                ? (r.a.closed_by_name && r.a.closed_by_name !== r.a.closed_by_email ? `${r.a.closed_by_name} (${r.a.closed_by_email})` : r.a.closed_by_email)
                : (r.a.closed_by_name || '—');
              return (
                <tr key={r.a.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.a)}>
                  <td className="l">
                    <b style={{ color: 'var(--ab-navy)', fontFamily: 'monospace' }}>{r.a.order_id}</b>{' '}
                    {r.a.order?.po_number && <span className="note">PO:{r.a.order.po_number}</span>}
                    <span className="h">{custName(r.a.order?.customer_id)}</span>
                  </td>
                  <td className="l">
                    <b>{fd(r.a.closed_at)}</b>
                    <span className="h">by {byUser}</span>
                  </td>
                  <td>{M(r, r.rev)}</td>
                  <td>{M(r, r.actCost)}</td>
                  <td>
                    <span style={{ fontWeight: 700, fontSize: 15 }} className={r.net < 0 ? 'ab-red' : 'ab-grn'}>{M(r, r.net)}</span>
                    {other(r, r.net) ? <span className="h">{other(r, r.net)}</span> : null}
                  </td>
                  <td>
                    <span style={{ display: 'inline-block', width: 44, height: 6, borderRadius: 4, background: 'var(--ab-sub)', verticalAlign: 'middle', marginRight: 6, overflow: 'hidden' }}>
                      <i style={{ display: 'block', height: '100%', width: Math.max(4, Math.min(100, Math.abs(r.netM) * 3)) + '%', background: r.netM < 0 ? 'var(--ab-red)' : 'var(--ab-grn)' }}/>
                    </span>
                    <b>{r.netM.toFixed(1)}%</b>
                  </td>
                  <td><span className={'chip ' + (bad ? 'c-red' : 'c-grn')}>{!bad && r.pv >= 0.05 ? '+' : ''}{r.pv.toFixed(1)} pts</span></td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-xs btn-primary" onClick={() => onOpen(r.a)}>👁 View</button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={8} className="l note" style={{ padding: 24 }}>{rows.length ? 'No closed audits match.' : 'No audit has been closed yet. Submit an audit from the Open tab and it appears here.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Audit Bin page ───────────────────────────────────────────────────────
export default function AuditBinPage() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState('open');

  // Orders closed before the Audit Bin existed never got an audit row; an admin/manager can backfill them.
  const canSync = ['admin', 'manager'].includes(user?.role);
  const runSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/audit-bin/backfill');
      qc.invalidateQueries(['audit-bin']);
      toast.success(data.created > 0 ? `✅ Added ${data.created} closed order(s) to Audit Bin` : 'Everything in Closed Bin is already in Audit Bin');
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to sync Audit Bin'); }
    finally { setSyncing(false); }
  };

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['audit-bin'],
    queryFn: () => api.get('/audit-bin').then(r => { const d = r.data; return Array.isArray(d) ? d : []; }).catch(() => []),
    refetchInterval: 20000,
  });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/customers').then(r => { const d = r.data; return Array.isArray(d) ? d : []; }).catch(() => []) });
  const custName = id => customers.find(c => c.id === id)?.name || (user?.perms?.canSeeCustomer === false ? '[Restricted]' : id);

  const openAudits = useMemo(() => audits.filter(a => !a.closed_at), [audits]);
  const closedCount = audits.length - openAudits.length;

  useEffect(() => {
    if (orderId && audits.length && !selected) {
      const match = audits.find(a => (a.order_id || '').toLowerCase() === orderId.toLowerCase() || a.id === orderId);
      if (match) setSelected(match);
    }
  }, [orderId, audits, selected]);

  const filtered = useMemo(() => {
    if (!search) return openAudits;
    const q = search.toLowerCase();
    return openAudits.filter(a =>
      (a.order_id || '').toLowerCase().includes(q) ||
      (a.order?.po_number || '').toLowerCase().includes(q) ||
      custName(a.order?.customer_id).toLowerCase().includes(q));
  }, [openAudits, search, customers]); // eslint-disable-line

  const tabBtn = (k, label, n) => (
    <button key={k} onClick={() => setTab(k)} style={{ padding: '9px 16px', border: 0, background: 'none', font: 'inherit', cursor: 'pointer', fontWeight: 600,
      color: tab === k ? 'var(--text)' : 'var(--text3)', borderBottom: '2.5px solid ' + (tab === k ? 'var(--accent)' : 'transparent'), marginBottom: -1 }}>
      {label} <span style={{ marginLeft: 6, fontSize: 11.5, background: 'var(--surface2)', padding: '1px 8px', borderRadius: 99 }}>{n}</span></button>);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {tabBtn('open', 'Open audits', openAudits.length)}
          {tabBtn('closed', 'Closed audits', closedCount)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
          <div className="search-wrap" style={{ width: 280 }}>
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
            <input className="search-input" placeholder="Search order, PO, customer…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          {canSync && (
            <button className="btn btn-sm" disabled={syncing} onClick={runSync} title="Pull in any Closed Bin order that's missing from Audit Bin">
              {syncing ? 'Syncing…' : '🔄 Sync from Closed Bin'}
            </button>
          )}
        </div>
      </div>

      {isLoading && <div className="loading-center">Loading…</div>}

      {tab === 'closed' && !isLoading && <ClosedTab audits={audits} custName={custName} search={search} onOpen={setSelected}/>}

      {tab === 'open' && !isLoading && filtered.length === 0 && (
        <div className="empty-state"><div className="empty-icon">📋</div>
          <div className="empty-state-text">{audits.length === 0 ? 'No orders have been audited yet — audits appear here automatically once an order is fully delivered and closed.'
            : openAudits.length === 0 ? 'Every audit is closed — see the Closed audits tab.' : 'No orders match your search'}</div>
        </div>
      )}

      {tab === 'open' && filtered.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px 140px 90px', gap: 0, background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
            padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', letterSpacing: .4 }}>
            <div>ORDER / CUSTOMER</div><div>PO NUMBER</div><div>ITEMS</div><div>STATUS</div><div style={{ textAlign: 'right' }}>ACTION</div>
          </div>
          {filtered.map(a => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px 140px 90px', gap: 0, padding: '10px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setSelected(a)}>
              <div>
                <span className="mono bold" style={{ fontSize: 13, color: 'var(--accent)' }}>{a.order_id}</span>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{custName(a.order?.customer_id)}</div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>
                {a.order?.po_number ? a.order.po_number : <span style={{ color: 'var(--text3)' }}>—</span>}
              </div>
              <div>
                <span className="chip c-mut" style={{ fontSize: 11 }}>
                  {a.items?.length || 0} {(a.items?.length === 1) ? 'item' : 'items'}
                </span>
              </div>
              <div>
                <span className={'chip ' + (a.status === 'submitted' ? 'c-grn' : 'c-amb')} style={{ fontSize: 11 }}>
                  {a.status === 'submitted' ? 'Submitted' : 'Pending Audit'}
                </span>
              </div>
              <div style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-xs btn-primary" onClick={() => setSelected(a)}>👁 View</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <AuditWorkspace audit={selected} onClose={() => setSelected(null)} onChanged={() => qc.invalidateQueries(['audit-bin'])}/>
      )}
    </div>
  );
}
