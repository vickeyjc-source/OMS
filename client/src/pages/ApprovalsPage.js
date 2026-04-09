// client/src/pages/ApprovalsPage.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { DEPARTMENTS, DEPT_LABEL } from '../utils/helpers';

function WorkflowModal({ wf, onClose }) {
  const qc = useQueryClient();
  const isNew = !wf?.id;
  const [name, setName]       = useState(wf?.name||'');
  const [entity, setEntity]   = useState(wf?.entity_type||'order');
  const [steps, setSteps]     = useState(wf?.steps ? JSON.parse(wf.steps) : [{ dept:'approvers', label:'Manager Approval' }]);
  const addStep = () => setSteps(p=>[...p,{dept:'management',label:'Final Approval'}]);
  const removeStep = i => setSteps(p=>p.filter((_,j)=>j!==i));
  const updStep = (i,k,v) => setSteps(p=>p.map((s,j)=>j===i?{...s,[k]:v}:s));
  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/approvals/workflows',d) : api.put(`/approvals/workflows/${wf.id}`,d),
    onSuccess: ()=>{ qc.invalidateQueries(['workflows']); toast.success('Saved'); onClose(); },
    onError: ()=>toast.error('Save failed'),
  });
  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-md">
        <div className="modal-header"><h2>{isNew?'New Workflow':'Edit Workflow'}</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-grid-2">
            <div className="form-group"><label className="label">Workflow Name</label><input className="input" value={name} onChange={e=>setName(e.target.value)} /></div>
            <div className="form-group"><label className="label">Applies To</label>
              <select className="input" value={entity} onChange={e=>setEntity(e.target.value)}>
                <option value="order">Order</option>
                <option value="enquiry">Enquiry</option>
                <option value="quote">Quote</option>
              </select>
            </div>
          </div>
          <div className="section-divider">Approval Steps</div>
          {steps.map((step,i)=>(
            <div key={i} className="sup-block" style={{marginBottom:8}}>
              <div className="flex-between" style={{marginBottom:6}}>
                <span className="bold" style={{fontSize:12}}>Step {i+1}</span>
                {steps.length>1&&<button className="btn btn-xs btn-danger" onClick={()=>removeStep(i)}>Remove</button>}
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="label">Department</label>
                  <select className="input" value={step.dept} onChange={e=>updStep(i,'dept',e.target.value)}>
                    {DEPARTMENTS.map(d=><option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="label">Step Label</label><input className="input" value={step.label} onChange={e=>updStep(i,'label',e.target.value)} /></div>
              </div>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addStep}>+ Add Step</button>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate({name,entity_type:entity,steps,active:true})}>Save Workflow</button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const [modal, setModal] = useState(null);
  const { data: workflows=[] } = useQuery({ queryKey:['workflows'], queryFn:()=>api.get('/approvals/workflows').then(r=>r.data) });
  const { data: requests=[] }  = useQuery({ queryKey:['requests'],  queryFn:()=>api.get('/approvals/requests').then(r=>r.data) });

  return (
    <div>
      <div className="grid-2" style={{marginBottom:16}}>
        <div className="card" style={{marginBottom:0}}>
          <div className="card-title">
            <span>⚙️ Approval Workflows</span>
            <button className="btn btn-xs btn-primary" onClick={()=>setModal({})}>+ New</button>
          </div>
          {workflows.length===0&&<div className="empty-state" style={{padding:24}}><div className="empty-icon">⚙️</div><div>No workflows configured</div></div>}
          {workflows.map(wf=>{
            let steps=[];try{steps=JSON.parse(wf.steps);}catch{}
            return(
              <div key={wf.id} className="sup-block" style={{marginBottom:8}}>
                <div className="flex-between" style={{marginBottom:5}}>
                  <span className="bold">{wf.name}</span>
                  <div className="flex gap-8">
                    <span className="badge badge-blue">{wf.entity_type}</span>
                    <button className="btn btn-xs" onClick={()=>setModal(wf)}>Edit</button>
                  </div>
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {steps.map((s,i)=><span key={i} style={{fontSize:11,background:'var(--surface3)',padding:'2px 8px',borderRadius:999,color:'var(--text2)'}}>{i+1}. {s.label} ({DEPT_LABEL[s.dept]||s.dept})</span>)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card" style={{marginBottom:0}}>
          <div className="card-title">📋 Pending Approval Requests</div>
          {requests.filter(r=>r.status==='pending').length===0&&<div className="empty-state" style={{padding:24}}><div>No pending approvals</div></div>}
          {requests.filter(r=>r.status==='pending').map(r=>(
            <div key={r.id} className="sup-block" style={{marginBottom:8}}>
              <div className="flex-between" style={{marginBottom:5}}>
                <div><span className="bold" style={{fontSize:12}}>{r.entity_type}: {r.entity_id}</span><div style={{fontSize:11,color:'var(--text3)'}}>Requested {r.requested_at}</div></div>
                <span className="badge badge-amber">Step {r.current_step + 1}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {modal!==null&&<WorkflowModal wf={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)} />}
    </div>
  );
}
