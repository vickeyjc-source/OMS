// Reusable delete confirmation modal
// Usage:
//   const [deleteTarget, setDeleteTarget] = useState(null);
//   <button onClick={() => setDeleteTarget({ id, label: 'Customer "Acme"' })}>Delete</button>
//   {deleteTarget && (
//     <ConfirmDeleteModal
//       label={deleteTarget.label}
//       onConfirm={() => { doDelete(deleteTarget.id); setDeleteTarget(null); }}
//       onCancel={() => setDeleteTarget(null)}
//     />
//   )}

import React from 'react';

export default function ConfirmDeleteModal({ label, message, onConfirm, onCancel, loading }) {
  return (
    <div className="overlay" style={{ zIndex: 400 }} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal-sm" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--red-lt, #fef2f2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0
            }}>🗑</span>
            <h2 style={{ margin: 0 }}>Confirm Delete</h2>
          </div>
          <button className="close-x" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body" style={{ paddingTop: 18, paddingBottom: 18 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
            {message || (
              <>
                Are you sure you want to delete{' '}
                {label ? <strong>"{label}"</strong> : 'this item'}?
                <br />
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>This action cannot be undone.</span>
              </>
            )}
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={loading}
            style={{ minWidth: 80 }}
          >
            {loading ? 'Deleting…' : '🗑 Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
