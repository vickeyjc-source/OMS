// client/src/pages/ProcurementBinPage.js
// Shows all orders with line items in procurement/negotiating status — the Procurement team's work queue
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { fmt, fmtCur, StatusBadge } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

const LINE_STATUS_COLOR = {
  negotiating: 'var(--purple)',
  procurement: 'var(--accent)',
  payment:     'var(--amber)',
  shipped:     'var(--teal)',
  delivered:   'var(--green)',
};
const LINE_STATUS_LABEL = {
  negotiating: 'Negotiating',
  procurement: 'Procurement',
  payment:     'Payment',
  shipped:     'Shipped',
  delivered:   'Delivered',
};

function LineStatusBadge({ s }) {
  return (
    <span className="badge" style={{ background: `${LINE_STATUS_COLOR[s]}20`, color: LINE_STATUS_COLOR[s] }}>
      {LINE_STATUS_LABEL[s] || s}
    </span>
  );
}

export default function ProcurementBinPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected]   = useState(null);
  const [search, setSearch]       = useState('');
  const [lineFilter, setLineFilter] = useState('active'); // active | all

  const { data: orders    = [], isLoading } = useQuery({ queryKey:['orders'],    queryFn:()=>api.get('/orders').then(r=>r.data),    refetchInterval:20000 });
  const { data: suppliers = [] }            = useQuery({ queryKey:['suppliers'], queryFn:()=>api.get('/suppliers').then(r=>r.data) });
  const { data: customers = [] }            = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data).catch(()=>[]) });
  const { data: shippers  = [] }            = useQuery({ queryKey:['shippers'],  queryFn:()=>api.get('/shippers').then(r=>r.data) });

  const custName = id => customers.find(c=>c.id===id)?.name || (user.perms?.canSeeCustomer===false?'[Restricted]':id);
  const supName  = id => suppliers.find(s=>s.id===id)?.name || '—';

  // Procurement bin = open orders that have at least one line item NOT delivered
  const procOrders = orders.filter(o =>
    o.status === 'open' &&
    (o.lineItems||[]).some(li => ['negotiating','procurement','payment','shipped'].includes(li.line_status))
  );

  const filteredOrders = procOrders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.id.toLowerCase().includes(q) ||
           (o.po_number||'').toLowerCase().includes(q) ||
           custName(o.customer_id).toLowerCase().includes(q);
  });

  // Stats
  const totalOrders    = procOrders.length;
  const allItems       = procOrders.flatMap(o => o.lineItems||[]);
  const negotiating    = allItems.filter(i=>i.line_status==='negotiating').length;
  const inProcurement  = allItems.filter(i=>i.line_status==='procurement').length;
  const inPayment      = allItems.filter(i=>i.line_status==='payment').length;
  const shipped        = allItems.filter(i=>i.line_status==='shipped').length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:13, marginBottom:18 }}>
        {[
          { label:'Open Orders',    val:totalOrders, color:'var(--accent)' },
          { label:'Negotiating',    val:negotiating, color:'var(--purple)' },
          { label:'In Procurement', val:inProcurement, color:'var(--blue, var(--accent))' },
          { label:'In Payment',     val:inPayment,   color:'var(--amber)' },
          { label:'Shipped',        val:shipped,     color:'var(--teal)' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeft:`3px solid ${s.color}` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ fontSize:24, color:s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex-between" style={{ marginBottom:14 }}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/>
          </svg>
          <input className="search-input" placeholder="Search by order ID, PO, customer…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <button className="btn btn-primary" onClick={()=>window.location.href='/orders/new'}>+ New Order</button>
      </div>

      {/* Orders list */}
      {isLoading && <div className="loading-center">Loading procurement bin…</div>}

      {!isLoading && filteredOrders.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <div className="empty-state-text">
            {procOrders.length === 0 ? 'Procurement bin is empty — all line items are delivered!' : 'No orders match your search'}
          </div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {filteredOrders.map(order => {
          const activeItems  = (order.lineItems||[]).filter(li=>li.line_status!=='delivered');
          const doneItems    = (order.lineItems||[]).filter(li=>li.line_status==='delivered');
          const totalItems   = (order.lineItems||[]).length;
          const pct          = totalItems ? Math.round(doneItems.length/totalItems*100) : 0;
          const isDelayed    = order.tentative_date && new Date(order.tentative_date) < new Date();

          return (
            <div key={order.id} className="card" style={{ marginBottom:0 }}>
              {/* Order header */}
              <div className="flex-between" style={{ marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <span className="mono bold" style={{ fontSize:14 }}>{order.id}</span>
                  <StatusBadge s={order.status}/>
                  {isDelayed && <span className="badge badge-red">⚠ Delayed</span>}
                  {order.po_number && <span style={{ fontSize:12, color:'var(--text2)' }}>PO: <strong>{order.po_number}</strong></span>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:12, color:'var(--text2)' }}>
                    {doneItems.length}/{totalItems} delivered
                    {order.tentative_date && <span style={{ color:isDelayed?'var(--red)':'var(--text3)', marginLeft:8 }}>Due: {order.tentative_date}</span>}
                  </span>
                  <button className="btn btn-xs btn-primary" onClick={()=>setSelected(order)}>
                    Manage
                  </button>
                </div>
              </div>

              {/* Progress */}
              <div style={{ marginBottom:12 }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{
                    width:`${pct}%`,
                    background: pct===100?'var(--green)':pct>50?'var(--accent)':'var(--amber)'
                  }}/>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>{pct}% complete · {activeItems.length} item{activeItems.length!==1?'s':''} pending</div>
              </div>

              {/* Line items table */}
              <div style={{ overflowX:'auto' }}>
                <table className="li-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Component</th>
                      <th>Manufacturer</th>
                      <th>Qty</th>
                      <th>Supplier</th>
                      <th>Cust. Price</th>
                      {user.perms?.canSeeProcurementPrice !== false && <th>Proc. Price</th>}
                      <th>Delivery Date</th>
                      <th>Status</th>
                      <th>Update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.lineItems||[]).map((li, i) => (
                      <tr key={li.id} style={{ opacity: li.line_status==='delivered' ? 0.5 : 1 }}>
                        <td>{i+1}</td>
                        <td className="bold">{li.component}</td>
                        <td>{li.manufacturer||'—'}</td>
                        <td>{fmt(li.qty)}</td>
                        <td>{li.supplier_id ? <span style={{ fontSize:11, color:'var(--teal)', fontWeight:600 }}>{supName(li.supplier_id)}</span> : <span className="muted">—</span>}</td>
                        <td className="mono">{fmtCur(li.unit_price, li.currency)}</td>
                        {user.perms?.canSeeProcurementPrice !== false && (
                          <td className="mono">{li.procurement_price ? fmtCur(li.procurement_price, li.currency) : '—'}</td>
                        )}
                        <td style={{ color: li.delivery_date && new Date(li.delivery_date)<new Date()?'var(--red)':'inherit' }}>
                          {li.delivery_date || '—'}
                        </td>
                        <td><LineStatusBadge s={li.line_status}/></td>
                        <td>
                          <select
                            className="input"
                            style={{ fontSize:11, padding:'2px 6px', minWidth:110 }}
                            value={li.line_status}
                            onChange={async e => {
                              try {
                                await api.put(`/orders/${order.id}`, {
                                  lineItemStatus: { item_id: li.id, line_status: e.target.value },
                                  _action: `${li.component} → ${e.target.value}`,
                                  _comment: ''
                                });
                                qc.invalidateQueries(['orders']);
                                toast.success(`${li.component} updated to ${e.target.value}`);
                              } catch(err) {
                                toast.error(err.response?.data?.error || 'Update failed');
                              }
                            }}
                          >
                            {['negotiating','procurement','payment','shipped','delivered'].map(s => (
                              <option key={s} value={s}>{LINE_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Supplier PO summary */}
              {(order.supplierOrders||[]).length > 0 && (
                <div style={{ marginTop:12, display:'flex', gap:10, flexWrap:'wrap' }}>
                  {order.supplierOrders.map(so => {
                    const sup = suppliers.find(s=>s.id===so.supplier_id);
                    const shipper = shippers.find(s=>s.id===so.shipper_id);
                    return (
                      <div key={so.id} style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'7px 12px', fontSize:12 }}>
                        <span className="bold">{sup?.name||so.supplier_id}</span>
                        {so.po_no && <span style={{ color:'var(--text2)', marginLeft:8 }}>PO: {so.po_no}</span>}
                        <span style={{ marginLeft:8 }}>
                          <span className={`badge ${so.shipping_status==='received'?'badge-green':so.shipping_status==='in-transit'?'badge-teal':'badge-gray'}`} style={{ fontSize:10 }}>
                            {so.shipping_status}
                          </span>
                        </span>
                        {so.tracking_no && <span style={{ color:'var(--text3)', marginLeft:8 }}>🚚 {so.tracking_no}</span>}
                        {shipper && <span style={{ color:'var(--text3)', marginLeft:6 }}>via {shipper.name}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Full order detail modal - reuse from OrdersPage */}
      {selected && (
        <ProcurementOrderModal
          order={selected}
          suppliers={suppliers}
          customers={customers}
          shippers={shippers}
          onClose={() => setSelected(null)}
          onSaved={() => { qc.invalidateQueries(['orders']); setSelected(null); }}
        />
      )}
    </div>
  );
}

function ProcurementOrderModal({ order, suppliers, customers, shippers, onClose, onSaved }) {
  const { user } = useAuth();
  const [soList, setSoList] = useState((order.supplierOrders||[]).map(so=>({...so})));
  const [saving, setSaving] = useState(false);
  const supName  = id => suppliers.find(s=>s.id===id)?.name || id;
  const upd = (idx,k,v) => setSoList(p=>p.map((so,i)=>i===idx?{...so,[k]:v}:so));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/orders/${order.id}`, {
        supplierOrders: soList,
        _action: 'Supplier POs updated from Procurement Bin',
        _comment: ''
      });
      toast.success('Procurement details saved');
      onSaved();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>🛒 Procurement — {order.id}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ background:'var(--accent-lt)', borderRadius:'var(--r-sm)', padding:'8px 14px', marginBottom:16, fontSize:12 }}>
            <strong>PO:</strong> {order.po_number} &nbsp;·&nbsp;
            <strong>Customer Ref:</strong> {order.customer_ref||'—'} &nbsp;·&nbsp;
            <strong>Due:</strong> {order.tentative_date||'—'}
          </div>

          <div className="section-divider">Supplier Purchase Orders</div>
          {soList.map((so, idx) => (
            <div key={so.id} className="sup-block" style={{ marginBottom:12 }}>
              <div className="bold" style={{ marginBottom:10, fontSize:13 }}>
                {supName(so.supplier_id)}
              </div>
              <div className="form-grid-2" style={{ marginBottom:8 }}>
                <div className="form-group">
                  <label className="label">Supplier PO Number</label>
                  <input className="input" value={so.po_no||''} onChange={e=>upd(idx,'po_no',e.target.value)} placeholder="PO-SUP-001"/>
                </div>
                <div className="form-group">
                  <label className="label">Shipping Status</label>
                  <select className="input" value={so.shipping_status||'pending'} onChange={e=>upd(idx,'shipping_status',e.target.value)}>
                    {['pending','in-transit','received','failed'].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {(so.shipping_status==='in-transit'||so.shipping_status==='received') && (
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="label">Shipper</label>
                    <select className="input" value={so.shipper_id||''} onChange={e=>upd(idx,'shipper_id',e.target.value)}>
                      <option value="">— Select Shipper —</option>
                      {['international','domestic'].map(type => {
                        const grp = shippers.filter(s=>s.type===type);
                        if (!grp.length) return null;
                        return <optgroup key={type} label={type==='international'?'🌐 International':'🇮🇳 Domestic'}>
                          {grp.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>;
                      })}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Tracking / AWB Number</label>
                    <input className="input" value={so.tracking_no||''} onChange={e=>upd(idx,'tracking_no',e.target.value)} placeholder="AWB / Tracking ID"/>
                  </div>
                </div>
              )}
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>
                Items: {so.items?.map(id=>{const li=order.lineItems?.find(l=>l.id===id);return li?.component||id;}).join(', ')}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : '💾 Save Procurement'}
          </button>
        </div>
      </div>
    </div>
  );
}
