// client/src/components/ErrorBoundary.jsx
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    // Log to server
    const payload = {
      message:   error?.message || String(error),
      stack:     error?.stack   || '',
      component: info?.componentStack || '',
      url:       window.location.href,
      time:      new Date().toISOString(),
    };
    try {
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch(_) {}
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, maxWidth: 700, margin: '60px auto',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{
            background: '#fef2f2', border: '2px solid #ef4444',
            borderRadius: 10, padding: '24px 28px',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💥 Something went wrong</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#dc2626', marginBottom: 12 }}>
              {this.state.error?.message || 'Unknown error'}
            </div>
            <pre style={{
              background: '#fff', border: '1px solid #fca5a5',
              borderRadius: 6, padding: 12, fontSize: 11,
              overflowX: 'auto', whiteSpace: 'pre-wrap',
              color: '#374151', maxHeight: 300, overflowY: 'auto',
            }}>
              {this.state.error?.stack || ''}
              {'\n\nComponent tree:\n'}
              {this.state.info?.componentStack || ''}
            </pre>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button
                onClick={() => { this.setState({ error: null, info: null }); }}
                style={{
                  background: '#3b82f6', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '8px 18px', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13,
                }}>
                ↩ Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: '#e5e7eb', color: '#374151', border: 'none',
                  borderRadius: 6, padding: '8px 18px', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13,
                }}>
                🔄 Reload page
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
              This error has been logged to <code>logs/server-errors.log</code> and <code>logs/client-errors.log</code>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
