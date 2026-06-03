// client/src/pages/DangerZonePage.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import ActivityLog from '../components/ActivityLog';

const MODULES = [
  { key:'orders',    label:'All Orders',        icon:'📦', desc:'Deletes all orders, line items, supplier POs, shipping records, order history, customer payments, finance queue, PO requests and uploaded files.',   color:'var(--red)' },
  { key:'enquiries', label:'All Enquiries',      icon:'📋', desc:'Deletes all enquiries, enquiry items, sourcing data and enquiry history.',             color:'var(--red)' },
  { key:'quotes',    label:'All Quotes',         icon:'📄', desc:'Deletes all quote records from the Quote Bin.',                                        color:'var(--red)' },
  { key:'sourcing',  label:'Sourcing Data Only', icon:'🔍', desc:'Deletes only sourcing rows (supplier prices/availability) — keeps enquiries intact.',  color:'var(--amber,#d97706)' },
  { key:'approvals', label:'All Approvals',      icon:'✅', desc:'Deletes all approval workflows, requests and actions.',                                color:'var(--amber,#d97706)' },
  { key:'finance',   label:'All Finance Data',   icon:'💰', desc:'Deletes all customer payments, supplier finance queue entries and PO requests — keeps orders intact.',  color:'var(--amber,#d97706)' },
  { key:'inventory', label:'All Inventory',       icon:'🏭', desc:'Deletes all stock inventory records — warehouse and customer-held stock entries.',                         color:'var(--amber,#d97706)' },
];

function GlobalTab() {
  const qc = useQueryClient();
  const [confirmMod, setConfirmMod] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [masterText, setMasterText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const doModuleDelete = async (key) => {
    setLoading(true);
    try {
      const res = await api.delete('/admin/delete/' + key);
      setLastResult({ type:'module', label:res.data.label, deleted:res.data.deleted });
      qc.invalidateQueries();
      toast.success(res.data.label + ' moved to Recycle Bin — ' + res.data.deleted + ' rows (restorable)');
    } catch(e) { toast.error(e.response?.data?.error || 'Delete failed'); }
    finally { setLoading(false); setConfirmMod(null); }
  };

  const doMasterDelete = async () => {
    if (masterText !== 'DELETE ALL DATA') { toast.error('Type the confirmation text exactly'); return; }
    setLoading(true);
    try {
      const res = await api.delete('/admin/delete-all', { data:{ confirm_text:'DELETE ALL DATA' } });
      setLastResult({ type:'all', deleted:res.data.deleted });
      qc.invalidateQueries();
      toast.success('All data moved to Recycle Bin — ' + res.data.deleted + ' rows (restorable)');
    } catch(e) { toast.error(e.response?.data?.error || 'Master delete failed'); }
    finally { setLoading(false); setConfirmAll(false); setMasterText(''); }
  };

  return (
    <>
      <div style={{border:'2px solid var(--red)',borderRadius:'var(--r)',overflow:'hidden'}}>
        <div style={{background:'var(--red)',padding:'12px 20px',display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:'#fff'}}>Danger Zone — Data Management</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.8)',marginTop:2}}>Deletes move each section to the <strong>Recycle Bin</strong> where they can be restored. Only Admin accounts can access this section.</div>
          </div>
        </div>

        <div style={{padding:'20px',background:'#fff8f8'}}>
          {lastResult && (
            <div style={{marginBottom:16,padding:'10px 14px',background:'var(--green-lt)',border:'1px solid var(--green)',borderRadius:'var(--r-sm)',fontSize:13,color:'var(--green)',fontWeight:600}}>
              ✅ {lastResult.type==='all' ? 'Master Delete — moved to Recycle Bin' : lastResult.label + ' moved to Recycle Bin'} — {lastResult.deleted} rows (restorable)
              <button onClick={()=>setLastResult(null)} style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'var(--green)',fontSize:16}}>×</button>
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:20}}>
            {MODULES.map(mod=>(
              <div key={mod.key} style={{border:'1px solid var(--border)',borderRadius:'var(--r-sm)',padding:'14px 16px',background:'#fff'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                  <span style={{fontSize:20}}>{mod.icon}</span>
                  <span style={{fontWeight:700,fontSize:13,color:mod.color}}>{mod.label}</span>
                </div>
                <div style={{fontSize:12,color:'var(--text2)',marginBottom:12,lineHeight:1.5}}>{mod.desc}</div>
                <button className="btn btn-sm btn-danger"
                  style={{width:'100%',background:mod.color,borderColor:mod.color,color:'#fff'}}
                  onClick={()=>setConfirmMod(mod.key)} disabled={loading}>
                  🗑 Delete {mod.label}
                </button>
              </div>
            ))}
          </div>

          <div style={{border:'2px dashed var(--red)',borderRadius:'var(--r-sm)',padding:'18px 20px',background:'#fff0f0'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
              <span style={{fontSize:24}}>💣</span>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:'var(--red)'}}>Master Delete — Wipe Everything</div>
                <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Deletes ALL Orders, Enquiries, Quotes, Sourcing data, Approvals and Inventory in one shot. Customers, Suppliers and Users are kept.</div>
              </div>
            </div>
            <button className="btn btn-danger" style={{fontWeight:700,padding:'10px 24px'}}
              onClick={()=>setConfirmAll(true)} disabled={loading}>
              💣 Master Delete — Wipe All Data
            </button>
          </div>
        </div>
      </div>

      {confirmMod && (() => {
        const mod = MODULES.find(m=>m.key===confirmMod);
        return (
          <div className="overlay">
            <div className="modal modal-sm">
              <div className="modal-header" style={{background:'var(--red-lt)'}}>
                <h2 style={{color:'var(--red)'}}>⚠️ Confirm Delete</h2>
                <button className="close-x" onClick={()=>setConfirmMod(null)}>×</button>
              </div>
              <div className="modal-body">
                <div style={{textAlign:'center',padding:'8px 0'}}>
                  <div style={{fontSize:40,marginBottom:12}}>{mod.icon}</div>
                  <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Delete {mod.label}?</div>
                  <div style={{fontSize:13,color:'var(--text2)',marginBottom:16,lineHeight:1.6}}>{mod.desc}</div>
                  <div style={{background:'var(--green-lt)',border:'1px solid var(--green)',borderRadius:'var(--r-sm)',padding:'10px 14px',fontSize:12,color:'var(--green)',fontWeight:600}}>
                    ↩ This is reversible — the section moves to the Recycle Bin and can be restored.
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={()=>setConfirmMod(null)} disabled={loading}>Cancel</button>
                <button className="btn btn-danger" disabled={loading} onClick={()=>doModuleDelete(confirmMod)}>
                  {loading ? 'Deleting…' : '🗑 Yes, Delete ' + mod.label}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmAll && (
        <div className="overlay">
          <div className="modal modal-sm">
            <div className="modal-header" style={{background:'#1a0000'}}>
              <h2 style={{color:'#ff4444'}}>💣 MASTER DELETE</h2>
              <button className="close-x" style={{color:'#fff'}} onClick={()=>{setConfirmAll(false);setMasterText('');}}>×</button>
            </div>
            <div className="modal-body">
              <div style={{textAlign:'center',padding:'8px 0'}}>
                <div style={{fontSize:48,marginBottom:12}}>💣</div>
                <div style={{fontWeight:800,fontSize:16,color:'var(--red)',marginBottom:8}}>This will wipe ALL operational data</div>
                <div style={{fontSize:13,color:'var(--text2)',marginBottom:20,lineHeight:1.7}}>
                  All <strong>Orders</strong>, <strong>Enquiries</strong>, <strong>Quotes</strong>, <strong>Sourcing</strong>, <strong>Approval</strong> and <strong>Inventory</strong> records will be moved to the <strong>Recycle Bin</strong> — restorable in one shot from the Master Delete card.
                  <br/>Customers, Suppliers, Line Cards and Users will <strong>not</strong> be affected.
                </div>
                <div style={{marginBottom:8,fontSize:12,fontWeight:600,color:'var(--text2)'}}>
                  Type <code style={{background:'var(--surface2)',padding:'2px 6px',borderRadius:4,color:'var(--red)',fontWeight:800}}>DELETE ALL DATA</code> to confirm:
                </div>
                <input className="input" value={masterText} onChange={e=>setMasterText(e.target.value)}
                  placeholder="DELETE ALL DATA"
                  style={{textAlign:'center',fontWeight:700,letterSpacing:1,
                    borderColor: masterText==='DELETE ALL DATA' ? 'var(--green)' : masterText ? 'var(--red)' : undefined}} />
                {masterText==='DELETE ALL DATA' && (
                  <div style={{marginTop:8,fontSize:12,color:'var(--green)',fontWeight:600}}>✅ Confirmation text matches — you may proceed</div>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{justifyContent:'space-between'}}>
              <button className="btn" onClick={()=>{setConfirmAll(false);setMasterText('');}} disabled={loading}>Cancel — Keep Data</button>
              <button className="btn btn-danger" disabled={loading || masterText!=='DELETE ALL DATA'}
                style={{fontWeight:700,opacity: masterText==='DELETE ALL DATA'?1:0.4}}
                onClick={doMasterDelete}>
                {loading ? 'Deleting…' : '💣 Confirm Master Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const tabStyle = active => ({
  padding:'8px 18px', fontSize:13, fontWeight:active?700:500,
  color: active ? 'var(--accent)' : 'var(--text2)',
  cursor:'pointer', background:'none', border:'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
});

export default function DangerZonePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('global');
  if (user.role !== 'admin') {
    return <div className="empty-state"><div className="empty-icon">🔒</div><div>Admin access required</div></div>;
  }
  return (
    <div>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:16}}>
        <button style={tabStyle(tab==='global')} onClick={()=>setTab('global')}>Global</button>
        <button style={tabStyle(tab==='logs')} onClick={()=>setTab('logs')}>Logs</button>
      </div>
      {tab==='global' ? <GlobalTab /> : <ActivityLog area="danger" />}
    </div>
  );
}
