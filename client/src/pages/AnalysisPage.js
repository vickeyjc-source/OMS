// client/src/pages/AnalysisPage.js
// RFQ Analysis — master list. Each line (part number) is its own independent
// RFQ; this screen only ever shows summary numbers per line — supplier
// comparison lives on the per-line detail page (AnalysisLineDetailPage.js).
// Core rule: Enquiry -> multiple Lines -> each Line = independent RFQ ->
// 1..N suppliers per Line -> individual score & recommendation. Never mixed.
import React, { useMemo, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { rankLine, fmt } from '../utils/rfqScoring';
import { useResizableGrid, ColResizeHandle, RowResizeHandle } from '../hooks/useResizableGrid';

// Fixed default pixel widths, not relative fr/minmax units — that was the
// root cause of columns drifting between header/body rows and one column's
// resize rippling into others. A real <table> + <colgroup> guarantees every
// row shares identical column tracks, exactly like the line-detail page.
const GRID_COL_DEFS = [
  ['line', 60, 'center'], ['part', 200, 'left'], ['mfr', 150, 'left'],
  ['qty', 70, 'center'], ['quotes', 70, 'center'], ['logic', 120, 'left'], ['first', 170, 'center'],
  ['second', 170, 'center'], ['third', 170, 'center'], ['status', 100, 'center'],
  ['action', 100, 'center'],
];
  const COL_LABELS = ['Line #', 'Part Number', 'Manufacturer', 'Qty', 'Quotes', 'Compare Logic', '1st Choice', '2nd Choice', '3rd Choice', 'Status', 'Action'];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'assigned', label: 'Assigned' },
];

const dateForOffset = offset => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};
const lineDate = line => String(line.enquiry_created_at || line.created_at || line.updated_at || '').slice(0, 10);

function EnquiryGroupGrid({ enqId, rows, allInEnq, customerName, suppliersById, ratesFor, navigate, isOpen, onToggle }) {
  const gridRef = useRef(null);
  const { colWidths, rowHeights, startColDrag, startRowDrag, autoFitColumn, autoFitRow } = useResizableGrid();
  const collapsed = !isOpen;

  return (
    <div className="card card-sm" style={{ marginBottom: 14, padding: 0, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
      <div
        style={{ padding: '12px 14px', background: 'var(--surface)', borderBottom: collapsed ? 'none' : '1px solid var(--border)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => onToggle(enqId)}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 28, flexShrink: 0, transition: 'transform .15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', color: 'var(--text3)', fontSize: 11 }}>▼</div>
          
          <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
            <span className="mono" style={{ color: 'var(--text1)' }}>{enqId}</span>
            {allInEnq[0]?.enquiry_no && allInEnq[0].enquiry_no !== enqId && <span className="mono badge badge-blue" style={{ fontSize: 10, alignSelf: 'flex-start' }}>↳ {allInEnq[0].enquiry_no}</span>}
          </div>

          <div style={{ width: 220, flexShrink: 0, fontSize: 13, paddingRight: 20 }}>
            <span style={{ color: 'var(--text1)' }}>{customerName(allInEnq[0]?.customer_id)}</span>
          </div>

          <div style={{ width: 80, flexShrink: 0, fontSize: 13 }}>
            <span className="badge badge-blue">{allInEnq.length}</span>
          </div>

          <div style={{ width: 100, flexShrink: 0, fontSize: 13 }}>
            {allInEnq[0]?.priority ? (
              <span className={`badge ${allInEnq[0].priority.toLowerCase() === 'high' ? 'badge-amber' : 'badge-green'}`} style={{ textTransform: 'capitalize' }}>
                {allInEnq[0].priority}
              </span>
            ) : (
              <span style={{ color: 'var(--text3)' }}>—</span>
            )}
          </div>

          <div style={{ width: 120, flexShrink: 0, fontSize: 13 }}>
            <span className="badge badge-green">
              {Math.max(0, Math.floor((Date.now() - new Date(allInEnq[0]?.enquiry_created_at || allInEnq[0]?.created_at).getTime()) / (1000 * 3600 * 24)))}d
            </span>
          </div>

          <div style={{ flex: 1, fontSize: 13 }}>
            <span style={{ color: 'var(--text1)' }}>
              {allInEnq[0]?.enquiry_created_at ? new Date(allInEnq[0].enquiry_created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : lineDate(allInEnq[0])}
            </span>
          </div>
        </div>
      </div>
      {!collapsed && (
      <div style={{ overflowX: 'auto' }}>
        <table ref={gridRef} className="rfq-master-table">
          <colgroup>
            {GRID_COL_DEFS.map(([key, def]) => <col key={key} style={{ width: colWidths[key] || def }} />)}
          </colgroup>
          <thead>
            <tr data-row-key="head" style={{ height: rowHeights.head || 40 }}>
              {GRID_COL_DEFS.map(([key, , align], i) => (
                <th key={key} data-col-key={key} style={{ textAlign: 'center' }}>
                  {COL_LABELS[i]}
                  <ColResizeHandle onDragStart={e => startColDrag(e, key, colWidths[key] || GRID_COL_DEFS.find(c => c[0] === key)[1])} onAutoFit={() => autoFitColumn(gridRef, key)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((line, idx) => {
              const priority = line.comparison_priority || ['price', 'lead', 'terms'];
              const { ranked } = rankLine(line.quotes, suppliersById, { compareCurrency: line.target_currency, rates: ratesFor(line.target_currency), priority, qty: line.quantity });
              const priorityLabel = p => p === 'price' ? 'Price' : p === 'lead' ? 'Lead' : p === 'terms' ? 'Terms' : '—';
              const first = ranked[0], second = ranked[1], third = ranked[2];
              const resizeRow = e => { e.stopPropagation(); startRowDrag(e, line.id, e.currentTarget.closest('tr').getBoundingClientRect().height); };
              const autoFitThisRow = e => { e.stopPropagation(); autoFitRow(gridRef, line.id); };
              const resizeColumn = (e, key) => { e.stopPropagation(); const definition = GRID_COL_DEFS.find(column => column[0] === key); startColDrag(e, key, colWidths[key] || definition[1]); };
              const columnHandle = key => <ColResizeHandle onDragStart={e => resizeColumn(e, key)} />;
              const choiceCell = (r, tone) => {
                if (!r) return <div className="rfq-choice rfq-choice-empty">—</div>;
                const sup = suppliersById[r.supplier_id];
                return (
                  <div className={`rfq-choice rfq-choice-${tone}`}>
                    <span className="rfq-choice-name">{sup?.name || r.supplier_id}</span>
                    <span className="rfq-choice-price">{line.target_currency} {fmt(r.normalizedPrice)}</span>
                  </div>
                );
              };
              return (
                <tr key={line.id} data-row-key={line.id} style={{ height: rowHeights[line.id] || 'auto' }}>
                  <td data-col-key="line" style={{ textAlign: 'center' }}>{idx + 1}{columnHandle('line')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="part" className="mono" style={{ textAlign: 'left' }}>{line.component}{line.ipn ? ` (${line.ipn})` : ''}{columnHandle('part')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="mfr" style={{ textAlign: 'left' }}>{line.manufacturer || '—'}{columnHandle('mfr')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="qty" style={{ textAlign: 'center' }}>{line.quantity}{columnHandle('qty')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="quotes" style={{ textAlign: 'center' }}>{(line.quotes || []).length}{columnHandle('quotes')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="logic" style={{ textAlign: 'left', fontSize: 11, color: 'var(--text2)', lineHeight: 1.4 }}>
                    {line.comparison_complete ? (
                      <>
                        <div style={{ whiteSpace: 'nowrap' }}>1st Priority: <span className="bold">{priorityLabel(priority[0])}</span></div>
                        <div style={{ whiteSpace: 'nowrap' }}>2nd Priority: <span className="bold">{priorityLabel(priority[1])}</span></div>
                        <div style={{ whiteSpace: 'nowrap' }}>3rd Priority: <span className="bold">{priorityLabel(priority[2])}</span></div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--text3)' }}>—</div>
                    )}
                    {columnHandle('logic')}
                    <RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} />
                  </td>
                  <td data-col-key="first" style={{ textAlign: 'center' }}>{choiceCell(first, 'green')}{columnHandle('first')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="second" style={{ textAlign: 'center' }}>{choiceCell(second, 'amber')}{columnHandle('second')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="third" style={{ textAlign: 'center' }}>{choiceCell(third, 'blue')}{columnHandle('third')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} /></td>
                  <td data-col-key="status" style={{ textAlign: 'center', position: 'relative' }}>
                    <span className={`badge ${line.comparison_complete ? 'badge-blue' : 'badge-amber'}`}>{line.comparison_complete ? 'Assigned' : 'Pending'}</span>
                    {columnHandle('status')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} />
                  </td>
                  <td data-col-key="action" style={{ textAlign: 'center' }}>
                    <button className="btn btn-xs btn-primary" onClick={e => { e.stopPropagation(); navigate(`/rfq-analysis/${line.id}`); }}>Compare</button>{columnHandle('action')}<RowResizeHandle onDragStart={resizeRow} onAutoFit={autoFitThisRow} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

export default function AnalysisPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [openEnquiryId, setOpenEnquiryId] = useState(undefined);

  const { data: lines = [], isLoading } = useQuery({ queryKey: ['rfq'], queryFn: () => api.get('/rfq').then(r => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/customers').then(r => r.data) });
  const suppliersById = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const customerName = id => customers.find(c => c.id === id)?.name || id;

  // Every line normalizes to its own target currency here (fixes comparing
  // raw numbers across currencies) — the full currency picker/override and
  // Total Cost mode live on the line-detail page where the real decision happens.
  const neededPairs = new Set();
  lines.forEach(l => (l.quotes || []).forEach(q => { if (q.currency && q.currency !== l.target_currency) neededPairs.add(`${q.currency}|${l.target_currency}`); }));
  const pairList = [...neededPairs];
  const rateQueries = useQuery({
    queryKey: ['fx-rates-batch', pairList.join(',')],
    queryFn: async () => {
      const results = await Promise.all(pairList.map(p => {
        const [from, to] = p.split('|');
        return api.get(`/fx-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(r => [p, r.data.rate]).catch(() => [p, null]);
      }));
      return Object.fromEntries(results);
    },
    enabled: pairList.length > 0,
  });
  const ratesByPair = rateQueries.data || {};
  const ratesFor = (targetCurrency) => {
    const out = {};
    pairList.forEach(p => {
      const [from, to] = p.split('|');
      if (to === targetCurrency && ratesByPair[p] != null) out[from] = ratesByPair[p];
    });
    return out;
  };

  // Group by enquiry first
  const byEnquiry = {};
  for (const l of lines) (byEnquiry[l.enquiry_id] ||= []).push(l);
  
  const allEnquiries = Object.keys(byEnquiry);
  const pendingEnquiries = new Set();
  const assignedEnquiries = new Set();
  
  allEnquiries.forEach(id => {
    const elines = byEnquiry[id];
    // An enquiry is completely assigned if EVERY line in it has comparison_complete
    const isAssigned = elines.every(l => Boolean(l.comparison_complete));
    if (isAssigned) assignedEnquiries.add(id);
    else pendingEnquiries.add(id);
  });

  const counts = { all: allEnquiries.length, pending: pendingEnquiries.size, assigned: assignedEnquiries.size };

  const filteredEnquiries = allEnquiries.filter(id => {
    const elines = byEnquiry[id];
    const term = search.trim().toLowerCase();
    const searchable = !term || elines.some(l => [l.enquiry_no, l.enquiry_id, l.component, l.ipn, l.manufacturer].some(v => String(v || '').toLowerCase().includes(term)));
    
    // Dates are inherited from the enquiry, so checking the first line is sufficient
    const date = lineDate(elines[0]);
    const quickDate = datePreset === 'today' ? date === dateForOffset(0) : datePreset === 'tomorrow' ? date === dateForOffset(1) : true;
    const inRange = (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    
    const assignment = filter === 'all' || (filter === 'assigned' ? assignedEnquiries.has(id) : pendingEnquiries.has(id));
    return searchable && quickDate && inRange && assignment;
  });

  const filteredByEnquiry = {};
  for (const id of filteredEnquiries) {
    filteredByEnquiry[id] = byEnquiry[id]; // Include ALL lines for the matching enquiries
  }

  const enquiryIds = filteredEnquiries.sort((a, b) => (a < b ? 1 : -1));
  const activeEnquiryId = openEnquiryId === undefined ? enquiryIds[0] : openEnquiryId;

  return (
    <div>
      <style>{`
        .rfq-master-table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        .rfq-master-table th, .rfq-master-table td { border: 1px solid var(--border, #d0d3d8); padding: 6px 10px; position: relative; overflow: hidden; text-overflow: ellipsis; text-align: center !important; }
        .rfq-master-table thead th { position: sticky; top: 0; z-index: 4; font-size: 10.5px; text-transform: uppercase; letter-spacing: .02em; color: var(--text3); background: var(--surface2); font-weight: 700; }
        .rfq-master-table tbody tr { font-size: 12.5px; }
        .rfq-master-table tbody tr:hover { background: var(--surface2); }
        .resizable-col-handle:hover { background: var(--accent); opacity: .6; box-shadow: 1px 0 0 var(--accent), -1px 0 0 var(--accent); }
        .resizable-row-handle:hover { background: var(--accent); opacity: .6; box-shadow: 0 1px 0 var(--accent), 0 -1px 0 var(--accent); }
        .rfq-choice { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px 8px; border-radius: 6px; line-height: 1.25; }
        .rfq-choice-green { background: var(--green-lt, #c6efce); color: var(--green, #0a7a3d); }
        .rfq-choice-amber { background: var(--amber-lt, #ffeb9c); color: var(--amber, #9c6500); }
        .rfq-choice-blue { background: var(--blue-lt, #cfe2ff); color: var(--blue, #084298); }
        .rfq-choice-empty { color: var(--text3); padding: 3px 8px; }
        .rfq-choice-name { font-weight: 700; font-size: 12px; }
        .rfq-choice-price { font-family: monospace; font-size: 11.5px; }
        .rfq-choice-score { font-size: 10px; opacity: .8; }
      `}</style>
      <div className="card card-sm" style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {FILTERS.map(f => (
            <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : ''}`} onClick={() => setFilter(f.key)}>{f.label} ({counts[f.key]})</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}><label className="label" style={{ margin: 0 }}>Date</label><select className="input" style={{ width: 112 }} value={datePreset} onChange={e => setDatePreset(e.target.value)}><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="all">All dates</option></select></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}><label className="label" style={{ margin: 0 }}>From</label><input className="input" style={{ width: 142 }} type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}><label className="label" style={{ margin: 0 }}>To</label><input className="input" style={{ width: 142 }} type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
        <div style={{ width: 220, flex: '0 0 220px' }}><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Enquiry number, component or MPN" /></div>
        <button className="btn btn-sm" onClick={() => { setSearch(''); setDatePreset('all'); setFromDate(''); setToDate(''); }}>Clear</button>
      </div>

      {isLoading && <div className="loading-center">Loading…</div>}
      {!isLoading && enquiryIds.length === 0 && <div className="empty-state"><div className="empty-state-text">No lines match this filter.</div></div>}

      {!isLoading && enquiryIds.length > 0 && (
        <div style={{ padding: '0 14px', marginBottom: 8, marginTop: 8, display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.03em' }}>
          <div style={{ width: 28, flexShrink: 0 }}></div>
          <div style={{ width: 220, flexShrink: 0 }}>Enquiry ID</div>
          <div style={{ width: 220, flexShrink: 0 }}>Customer</div>
          <div style={{ width: 80, flexShrink: 0 }}>Items</div>
          <div style={{ width: 100, flexShrink: 0 }}>Priority</div>
          <div style={{ width: 120, flexShrink: 0 }}>Days in Stage</div>
          <div style={{ flex: 1 }}>Created</div>
        </div>
      )}

      {enquiryIds.map(enqId => {
        const allInEnq = byEnquiry[enqId] || [];
        const rows = filteredByEnquiry[enqId] || [];
        return (
          <EnquiryGroupGrid
            key={enqId} enqId={enqId} rows={rows} allInEnq={allInEnq}
            customerName={customerName} suppliersById={suppliersById} ratesFor={ratesFor} navigate={navigate}
            isOpen={enqId === activeEnquiryId}
            onToggle={id => setOpenEnquiryId(activeEnquiryId === id ? null : id)}
          />
        );
      })}
    </div>
  );
}
