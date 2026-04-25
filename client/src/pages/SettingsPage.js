// client/src/pages/SettingsPage.js — Admin Settings (PO Mode, Templates)
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';

export default function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: settings={} } = useQuery({ queryKey:['settings'], queryFn:()=>api.get('/settings').then(r=>r.data) });
  const { data: templates=[] } = useQuery({ queryKey:['po-templates'], queryFn:()=>api.get('/po-templates').then(r=>r.data) });

  const [poMode, setPoMode] = useState(null); // null = use settings value
  const [editTmpl, setEditTmpl] = useState(null);
  const [newTmpl, setNewTmpl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteTmpl, setConfirmDeleteTmpl] = useState(null); // template id to delete

  const effectiveMode = poMode ?? settings.po_mode ?? 'external';

  const saveSetting = async (key, value) => {
    setSaving(true);
    try {
      await api.put('/settings', { [key]: value });
      qc.invalidateQueries(['settings']);
      toast.success('Setting saved');
    } catch(e) { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  const saveTemplate = async (data) => {
    try {
      if (data.id) {
        await api.put('/po-templates/'+data.id, data);
      } else {
        await api.post('/po-templates', data);
      }
      qc.invalidateQueries(['po-templates']);
      toast.success('Template saved');
      setEditTmpl(null); setNewTmpl(null);
    } catch(e) { toast.error('Failed'); }
  };

  const deleteTemplate = async (id) => {
    try {
      await api.delete('/po-templates/'+id);
      qc.invalidateQueries(['po-templates']);
      toast.success('Deleted');
    } catch(e) { toast.error('Failed'); }
  };

  return (
    <div style={{maxWidth:900}}>
      <h1 style={{fontSize:22,fontWeight:800,marginBottom:4}}>⚙ Settings</h1>
      <p style={{color:'var(--text2)',fontSize:13,marginBottom:24}}>Admin configuration — only managers and admins can change these settings.</p>

      {/* ── PO Mode ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">🛒 Purchase Order Mode</div>
        <p style={{fontSize:13,color:'var(--text2)',marginBottom:16}}>
          Choose how Purchase Orders are created. You can only use one mode at a time.
          Switching modes does not affect existing POs — only new ones.
        </p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
          {/* External Mode */}
          <div onClick={()=>setPoMode('external')} style={{cursor:'pointer',padding:20,borderRadius:'var(--r)',
            border:`2px solid ${effectiveMode==='external'?'var(--accent)':'var(--border)'}`,
            background:effectiveMode==='external'?'var(--accent-lt)':'var(--surface2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:20,height:20,borderRadius:'50%',border:`2px solid ${effectiveMode==='external'?'var(--accent)':'var(--border)'}`,
                background:effectiveMode==='external'?'var(--accent)':'transparent',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                {effectiveMode==='external'&&<div style={{width:8,height:8,borderRadius:'50%',background:'#fff'}}/>}
              </div>
              <span style={{fontWeight:700,fontSize:14,color:effectiveMode==='external'?'var(--accent)':'var(--text)'}}>
                📤 External (Zoho)
              </span>
            </div>
            <p style={{fontSize:12,color:'var(--text2)',margin:0,lineHeight:1.5}}>
              Purchase Orders are created and sent in Zoho. Ciflux captures the Zoho PO number for reference and tracking.
              The "Generate PO" button is hidden. The "Zoho PO Number" field is shown.
            </p>
          </div>

          {/* Platform Mode */}
          <div onClick={()=>setPoMode('platform')} style={{cursor:'pointer',padding:20,borderRadius:'var(--r)',
            border:`2px solid ${effectiveMode==='platform'?'var(--accent)':'var(--border)'}`,
            background:effectiveMode==='platform'?'var(--accent-lt)':'var(--surface2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:20,height:20,borderRadius:'50%',border:`2px solid ${effectiveMode==='platform'?'var(--accent)':'var(--border)'}`,
                background:effectiveMode==='platform'?'var(--accent)':'transparent',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                {effectiveMode==='platform'&&<div style={{width:8,height:8,borderRadius:'50%',background:'#fff'}}/>}
              </div>
              <span style={{fontWeight:700,fontSize:14,color:effectiveMode==='platform'?'var(--accent)':'var(--text)'}}>
                🖨 Platform (Ciflux)
              </span>
            </div>
            <p style={{fontSize:12,color:'var(--text2)',margin:0,lineHeight:1.5}}>
              Purchase Orders are generated as PDFs directly from Ciflux using templates.
              The "Zoho PO Number" field is hidden. Templates are selected at PO creation.
            </p>
          </div>
        </div>

        {poMode && poMode !== settings.po_mode && (
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',
            borderRadius:'var(--r-sm)',background:'var(--amber-lt,#fffbeb)',
            border:'1px solid var(--amber,#d97706)44',marginBottom:12}}>
            <span style={{fontSize:13,color:'var(--amber,#d97706)',fontWeight:600}}>
              ⚠ You've selected <strong>{poMode==='external'?'External (Zoho)':'Platform (Ciflux)'}</strong> mode.
              This will apply to all new POs going forward.
            </span>
            <button className="btn btn-sm btn-primary" disabled={saving}
              onClick={()=>{ saveSetting('po_mode', poMode); }}>
              {saving?'Saving…':'✅ Confirm Change'}
            </button>
            <button className="btn btn-xs" onClick={()=>setPoMode(null)}>Cancel</button>
          </div>
        )}

        <div style={{fontSize:12,color:'var(--text3)'}}>
          Current mode: <strong style={{color:'var(--accent)'}}>{settings.po_mode==='platform'?'🖨 Platform (Ciflux)':'📤 External (Zoho)'}</strong>
        </div>
      </div>

      {/* ── PO Templates (only relevant in Platform mode) ── */}
      <div className="card">
        <div className="card-title">
          <span>📄 PO Templates {effectiveMode==='external'&&<span style={{fontSize:11,color:'var(--text3)',fontWeight:400,marginLeft:6}}>(used when switched to Platform mode)</span>}</span>
          <button className="btn btn-xs btn-primary" onClick={()=>setNewTmpl({
            name:'',type:'standard',is_default:false,
            config:JSON.stringify({show_logo:true,show_gstin:true,show_incoterms:false,
              columns:['component','manufacturer','qty','unit_price','total'],
              footer_text:'Payment due as per agreed terms.',
              terms_text:'Subject to standard terms and conditions.'})
          })}>+ New Template</button>
        </div>
        <p style={{fontSize:13,color:'var(--text2)',marginBottom:14}}>
          Templates define the layout of generated PO PDFs. You can create templates for different scenarios
          (domestic, international, advance payment). The default template is used when no specific template is selected.
        </p>

        {templates.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No templates yet. Create one to use Platform PO generation.</div>}

        {templates.map(t=>{
          const cfg = (() => { try { return JSON.parse(t.config); } catch(_) { return {}; } })();
          return (
            <div key={t.id} style={{marginBottom:12,padding:'14px 16px',borderRadius:'var(--r)',
              border:`2px solid ${t.is_default?'var(--accent)':'var(--border)'}`,
              background:t.is_default?'var(--accent-lt)':'var(--surface2)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>
                    {t.name}
                    {t.is_default&&<span style={{marginLeft:8,fontSize:11,color:'var(--accent)',background:'var(--accent-lt)',
                      padding:'1px 7px',borderRadius:999,border:'1px solid var(--accent)33'}}>Default</span>}
                  </div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:3}}>
                    Type: {t.type} · Columns: {(cfg.columns||[]).join(', ')||'standard'}
                  </div>
                  {cfg.footer_text&&<div style={{fontSize:11,color:'var(--text3)',marginTop:2,fontStyle:'italic'}}>
                    Footer: "{cfg.footer_text}"
                  </div>}
                </div>
                <div style={{display:'flex',gap:7}}>
                  <button className="btn btn-xs" onClick={()=>setEditTmpl(t)}>✏ Edit</button>
                  {!t.is_default&&<button className="btn btn-xs btn-danger" onClick={()=>setConfirmDeleteTmpl(t.id)}>🗑</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Template editor modal */}
      {(editTmpl||newTmpl)&&<TemplateEditorModal
        tmpl={editTmpl||newTmpl}
        onClose={()=>{setEditTmpl(null);setNewTmpl(null);}}
        onSave={saveTemplate}/>}
      {confirmDeleteTmpl && (
        <ConfirmDeleteModal
          message={"Are you sure you want to delete this PO template? This cannot be undone."}
          onConfirm={() => { deleteTemplate(confirmDeleteTmpl); setConfirmDeleteTmpl(null); }}
          onCancel={() => setConfirmDeleteTmpl(null)}
        />
      )}
    </div>
  );
}

function TemplateEditorModal({ tmpl, onClose, onSave }) {
  const [form, setForm] = useState({
    id:         tmpl.id||'',
    name:       tmpl.name||'',
    type:       tmpl.type||'standard',
    is_default: tmpl.is_default||false,
    config:     (() => { try { return JSON.parse(tmpl.config||'{}'); } catch(_) { return {}; } })(),
  });
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const setCfg=(k,v)=>setForm(f=>({...f,config:{...f.config,[k]:v}}));
  const COLS=['component','manufacturer','qty','unit_price','total','hs_code','date_code','delivery_date'];

  const toggleCol=col=>setCfg('columns',(form.config.columns||[]).includes(col)
    ?(form.config.columns||[]).filter(c=>c!==col)
    :[...(form.config.columns||[]),col]);

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-md">
        <div className="modal-header">
          <h2>{tmpl.id?'Edit Template':'New Template'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13}}>
            <div className="form-group"><label className="label">Template Name <span className="req">*</span></label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. International PO"/></div>
            <div className="form-group"><label className="label">Type</label>
              <select className="input" value={form.type} onChange={e=>set('type',e.target.value)}>
                {['standard','international','advance','domestic'].map(t=><option key={t}>{t}</option>)}
              </select></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:13}}>
            {[['show_logo','Show Logo'],['show_gstin','Show GSTIN/Tax ID'],['show_incoterms','Show Incoterms']].map(([k,l])=>(
              <label key={k} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13}}>
                <input type="checkbox" checked={!!form.config[k]} onChange={e=>setCfg(k,e.target.checked)}
                  style={{accentColor:'var(--accent)',width:15,height:15}}/>
                {l}
              </label>
            ))}
          </div>
          <div className="form-group"><label className="label" style={{fontWeight:700}}>Columns to Show</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {COLS.map(col=>(
                <label key={col} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',
                  padding:'4px 10px',borderRadius:'var(--r-sm)',fontSize:12,fontWeight:600,
                  background:(form.config.columns||[]).includes(col)?'var(--accent-lt)':'var(--surface2)',
                  border:`1px solid ${(form.config.columns||[]).includes(col)?'var(--accent)':'var(--border)'}`}}>
                  <input type="checkbox" checked={(form.config.columns||[]).includes(col)}
                    onChange={()=>toggleCol(col)} style={{accentColor:'var(--accent)'}}/>
                  {col}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group"><label className="label">Footer Text</label>
            <textarea className="input" rows={2} value={form.config.footer_text||''}
              onChange={e=>setCfg('footer_text',e.target.value)} placeholder="Payment due as per agreed terms…"/></div>
          <div className="form-group" style={{marginBottom:0}}><label className="label">Terms & Conditions Text</label>
            <textarea className="input" rows={2} value={form.config.terms_text||''}
              onChange={e=>setCfg('terms_text',e.target.value)} placeholder="Subject to standard T&Cs…"/></div>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginTop:12,fontSize:13,fontWeight:600}}>
            <input type="checkbox" checked={form.is_default} onChange={e=>set('is_default',e.target.checked)}
              style={{accentColor:'var(--accent)',width:15,height:15}}/>
            Set as default template
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={()=>onSave({...form,config:JSON.stringify(form.config)})}>
            {tmpl.id?'Save Changes':'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
