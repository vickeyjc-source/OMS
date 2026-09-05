// client/src/hooks/useResizableGrid.js
// Drop-in Excel-style column/row resizing for any <table>. Each call to
// useResizableGrid() is fully independent — call it once per table/grid
// instance and its sizes never affect any other grid on the page or app.
//
// Usage:
//   const { colWidths, rowHeights, startColDrag, startRowDrag, autoFitColumn } = useResizableGrid();
//   const tableRef = useRef(null);
//   <table ref={tableRef}>
//     <colgroup>
//       <col style={{ width: colWidths.someKey || DEFAULT }} />
//     </colgroup>
//     <thead><tr style={{ height: rowHeights.header || ROW_DEFAULT }}>
//       <th data-col-key="someKey">
//         Label
//         <ColResizeHandle onDragStart={e => startColDrag(e, 'someKey', colWidths.someKey || DEFAULT)} onAutoFit={() => autoFitColumn(tableRef, 'someKey')} />
//       </th>
//     </tr></thead>
//     ...
import { useState, useRef } from 'react';

export const GRID_COL_MIN = 60, GRID_COL_MAX = 420, GRID_COL_DEFAULT = 150;
export const GRID_ROW_MIN = 26, GRID_ROW_MAX = 220, GRID_ROW_DEFAULT = 34;

export function useResizableGrid(opts = {}) {
  const colMin = opts.colMin ?? GRID_COL_MIN, colMax = opts.colMax ?? GRID_COL_MAX;
  const rowMin = opts.rowMin ?? GRID_ROW_MIN, rowMax = opts.rowMax ?? GRID_ROW_MAX;
  const [colWidths, setColWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const dragRef = useRef(null);

  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === 'col') {
      const next = Math.min(colMax, Math.max(colMin, d.startSize + (e.clientX - d.startPos)));
      setColWidths(prev => ({ ...prev, [d.key]: next }));
    } else {
      const next = Math.min(rowMax, Math.max(rowMin, d.startSize + (e.clientY - d.startPos)));
      setRowHeights(prev => ({ ...prev, [d.key]: next }));
    }
  };
  const onMouseUp = () => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
  const startColDrag = (e, key, currentWidth) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { type: 'col', key, startPos: e.clientX, startSize: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const startRowDrag = (e, key, currentHeight) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { type: 'row', key, startPos: e.clientY, startSize: currentHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const autoFitColumn = (tableRef, key) => {
    if (!tableRef.current) return;
    const cells = tableRef.current.querySelectorAll(`[data-col-key="${CSS.escape(String(key))}"]`);
    let max = colMin;
    cells.forEach(cell => { max = Math.max(max, cell.scrollWidth + 24); });
    setColWidths(prev => ({ ...prev, [key]: Math.min(colMax, Math.max(colMin, max)) }));
  };
  const autoFitRow = (containerRef, key) => {
    if (!containerRef.current) return;
    const row = containerRef.current.querySelector(`[data-row-key="${CSS.escape(String(key))}"]`);
    if (!row) return;
    // clear any override so the row can settle to its natural content height, then lock that in
    setRowHeights(prev => { const n = { ...prev }; delete n[key]; return n; });
    requestAnimationFrame(() => {
      const natural = row.scrollHeight;
      setRowHeights(prev => ({ ...prev, [key]: Math.min(rowMax, Math.max(rowMin, natural)) }));
    });
  };
  const resetColumn = (key) => setColWidths(prev => { const n = { ...prev }; delete n[key]; return n; });
  const resetRow = (key) => setRowHeights(prev => { const n = { ...prev }; delete n[key]; return n; });

  return { colWidths, rowHeights, startColDrag, startRowDrag, autoFitColumn, autoFitRow, resetColumn, resetRow };
}

export function ColResizeHandle({ onDragStart, onAutoFit }) {
  return (
    <div
    className="resizable-col-handle"
    onMouseDown={onDragStart}
    title="Drag left or right to resize"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 3 }}
    />
  );
}

export function RowResizeHandle({ onDragStart, onAutoFit }) {
  return (
    <div
      className="resizable-row-handle"
      onMouseDown={onDragStart}
      title="Drag up or down to resize"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, cursor: 'row-resize', zIndex: 3 }}
    />
  );
}

// Shared base CSS for any table using this hook — include once per table via
// a <style> tag, scoped to a class name you choose (pass it as `tableClass`).
export function resizableGridCSS(tableClass) {
  return `
    .${tableClass} { width: auto !important; table-layout: fixed !important; border-collapse: collapse; }
    .${tableClass} th, .${tableClass} td { position: relative; overflow: hidden; text-overflow: ellipsis; }
    .resizable-col-handle:hover { background: var(--accent); opacity: .55; box-shadow: 1px 0 0 var(--accent); }
    .resizable-row-handle:hover { background: var(--accent); opacity: .55; box-shadow: 0 1px 0 var(--accent); }
  `;
}
