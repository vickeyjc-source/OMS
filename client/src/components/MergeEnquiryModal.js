// client/src/components/MergeEnquiryModal.js
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';

export const MERGEABLE_ENQ_STATUSES = ['draft', 'new', 'modify_requested', 'sourcing'];

// ── Merge picker + preview modal ──────────────────────────────────────────────
// enq: the enquiry the modal was opened from (always the survivor — the caller
// picks whichever has the highest enquiry number). preselectedOtherIds: one or
// more enquiries to absorb into it, already known from the list-screen checkbox
// picker. The survivor is never chosen here — it's always the latest number.
export default function MergeEnquiryModal({ enq, customers, preselectedOtherIds, onClose, onMerged }) {
  const qc = useQueryClient();
  const [otherId, setOtherId] = useState(preselectedOtherIds?.length === 1 ? preselectedOtherIds[0] : '');
  const pickedIds = preselectedOtherIds || (otherId ? [otherId] : []);
  // The survivor is always the highest enquiry number among everything in play,
  // regardless of which one the modal happened to be opened from.
  const allIds      = [enq.id, ...pickedIds];
  const survivorId  = allIds.reduce((max, id) => id > max ? id : max, allIds[0]);
  const otherIds    = allIds.filter(id => id !== survivorId);
  const isMultiWay  = otherIds.length > 1;
  const [combinePairs, setCombinePairs] = useState({}); // "otherId|a_item_id|b_item_id" -> true

  const { data: candidates=[] } = useQuery({
    queryKey: ['enquiries'],
    queryFn: () => api.get('/enquiries').then(r => r.data),
    select: list => list.filter(e =>
      e.id !== enq.id && e.customer_id === enq.customer_id &&
      !e.merged_into && MERGEABLE_ENQ_STATUSES.includes(e.status)),
    enabled: !preselectedOtherIds,
  });

  // One preview per absorbed enquiry — each is still a pairwise call against the
  // survivor, just fired for every id in the batch.
  const previewQueries = useQuery({
    queryKey: ['enquiry-merge-preview-batch', survivorId, otherIds],
    queryFn: async () => {
      const results = await Promise.all(otherIds.map(id =>
        api.get(`/enquiries/${survivorId}/merge-preview?other_id=${id}`).then(r => r.data)));
      return results;
    },
    enabled: otherIds.length > 0,
  });
  const previews = previewQueries.data || [];
  const previewLoading = previewQueries.isFetching;

  React.useEffect(() => { setCombinePairs({}); }, [otherIds.join(',')]);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      // Sequential — each absorbed enquiry is folded into the same survivor one
      // at a time, reusing the exact pairwise logic that's already proven safe.
      for (const preview of previews) {
        const absorbedEnq = preview.enquiry_a.id === survivorId ? preview.enquiry_b : preview.enquiry_a;
        const pairs = (preview.duplicate_pairs || [])
          .filter(p => combinePairs[absorbedEnq.id + '|' + p.a_item_id + '|' + p.b_item_id])
          .map(p => {
            const absorbedItemId = preview.enquiry_a.id === absorbedEnq.id ? p.a_item_id : p.b_item_id;
            const survivorItemId = preview.enquiry_a.id === absorbedEnq.id ? p.b_item_id : p.a_item_id;
            return { absorbed_item_id: absorbedItemId, survivor_item_id: survivorItemId, qty: p.combined_qty, delivery_date: p.combined_delivery };
          });
        await api.post('/enquiries/merge', { survivor_id: survivorId, absorbed_id: absorbedEnq.id, combine_pairs: pairs });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(['enquiries']);
      qc.invalidateQueries(['enquiry']);
      qc.invalidateQueries(['summary']);
      toast.success(otherIds.length > 1 ? `✅ ${otherIds.length} enquiries merged into ${survivorId}` : '✅ Enquiries merged');
      onMerged();
    },
    onError: e => toast.error(e.response?.data?.error || 'Merge failed'),
  });

  const custName = id => customers.find(c => c.id === id)?.name || id;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2>🔗 Merge Enquir{otherIds.length > 1 ? 'ies' : 'y'}</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              Fold {otherIds.length > 1 ? 'duplicate enquiries' : 'a duplicate enquiry'} from {custName(enq.customer_id)} into the latest one. Nothing is deleted — absorbed enquiries stay, marked as merged.
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!preselectedOtherIds && (
            <div className="form-group">
              <label className="label">Merge with which enquiry?</label>
              <select className="input" value={otherId} onChange={e => setOtherId(e.target.value)}>
                <option value="">— Select an enquiry —</option>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.id} · {c.items?.length||0} item{c.items?.length===1?'':'s'} · {c.status}</option>)}
              </select>
              {!candidates.length && (
                <div style={{fontSize:11.5,color:'var(--text3)',marginTop:4}}>No other pre-Quote enquiry found for this customer.</div>
              )}
            </div>
          )}

          {otherIds.length > 0 && previewLoading && <div style={{padding:'20px 0',textAlign:'center',color:'var(--text3)',fontSize:12}}>Loading preview…</div>}

          {previews.length > 0 && (
            <>
              <div className="form-group" style={{padding:'8px 12px',background:'var(--accent-lt)',border:'1px solid var(--accent)33',borderRadius:'var(--r-sm)'}}>
                <div style={{fontSize:12}}>
                  Surviving enquiry (latest number, always kept): <span className="mono bold" style={{color:'var(--accent)'}}>{survivorId}</span>
                </div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>
                  {otherIds.length === 1
                    ? <>Absorbed: <span className="mono bold">{otherIds[0]}</span> — its items move here, and it stays visible marked "merged into {survivorId}".</>
                    : <>Absorbed: {otherIds.map((id,i) => <React.Fragment key={id}>{i>0 && ', '}<span className="mono bold">{id}</span></React.Fragment>)} — each stays visible marked "merged into {survivorId}".</>
                  }
                </div>
              </div>

              {previews.flatMap(p => p.warnings||[]).length > 0 && (
                <div style={{padding:'8px 12px',background:'#fffbeb',border:'1px solid #d97706',
                  borderRadius:'var(--r-sm)',fontSize:12,marginBottom:12}}>
                  {previews.flatMap(p => p.warnings||[]).map((w,i) => <div key={i} style={{color:'#92400e'}}>⚠ {w}</div>)}
                </div>
              )}

              {!isMultiWay && previews[0].duplicate_pairs?.length > 0 && (
                <div className="form-group">
                  <label className="label">Duplicate components found — combine quantities?</label>
                  {previews[0].duplicate_pairs.map(p => {
                    const absorbedEnq = previews[0].enquiry_a.id === survivorId ? previews[0].enquiry_b : previews[0].enquiry_a;
                    const key = absorbedEnq.id + '|' + p.a_item_id + '|' + p.b_item_id;
                    return (
                      <label key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',
                        border:'1px solid var(--border)',borderRadius:'var(--r-sm)',marginBottom:6,fontSize:12,cursor:'pointer'}}>
                        <input type="checkbox" checked={!!combinePairs[key]}
                          onChange={e=>setCombinePairs(c=>({...c,[key]:e.target.checked}))} />
                        <span className="bold">{p.component}</span>
                        <span style={{color:'var(--text3)'}}>{p.manufacturer}</span>
                        <span style={{marginLeft:'auto',color:'var(--text2)'}}>
                          {p.a_qty} + {p.b_qty} → <strong>{p.combined_qty}</strong>
                        </span>
                      </label>
                    );
                  })}
                  <div style={{fontSize:11,color:'var(--text3)'}}>Unchecked pairs are kept as separate line items on the surviving enquiry.</div>
                </div>
              )}
              {isMultiWay && previews.some(p => p.duplicate_pairs?.length > 0) && (
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:12}}>
                  Duplicate components were found across these enquiries — with 3+ enquiries merged at once, quantities aren't auto-combined; all items move over as separate lines and can be tidied up afterwards on {survivorId}.
                </div>
              )}

              <div className="form-group" style={{marginBottom:0}}>
                <label className="label">Items moving to {survivorId}</label>
                <div style={{overflowX:'auto'}}>
                  <table className="li-table">
                    <thead><tr><th>Component</th><th>Manufacturer</th><th>Qty</th><th>From</th></tr></thead>
                    <tbody>
                      {previews.flatMap(p => {
                        const absorbedEnq = p.enquiry_a.id === survivorId ? p.enquiry_b : p.enquiry_a;
                        return (absorbedEnq.items||[]).map(it => (
                          <tr key={absorbedEnq.id + '_' + it.id}>
                            <td className="bold">{it.component}</td>
                            <td>{it.manufacturer||'—'}</td>
                            <td>{it.quantity}</td>
                            <td className="mono">{absorbedEnq.id}</td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!previews.length || mergeMutation.isPending}
            onClick={()=>mergeMutation.mutate()}>
            {mergeMutation.isPending ? 'Merging…' : '🔗 Merge Enquiries'}
          </button>
        </div>
      </div>
    </div>
  );
}
