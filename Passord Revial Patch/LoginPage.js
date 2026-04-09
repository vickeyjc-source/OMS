// client/src/pages/LoginPage.js
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm]   = useState({ username: 'admin', password: 'admin123' });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.username, form.password);
      navigate('/');
    } catch {
      toast.error('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div className="card" style={{ width:400, marginBottom:0 }}>
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:22, fontWeight:700, letterSpacing:'-.02em' }}>
            ⚡ Cif<span style={{ color:'var(--accent)' }}>lux</span> OMS
          </div>
          <div style={{ fontSize:13, color:'var(--text2)', marginTop:4 }}>
            Order Management System · Electronic Components
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="label">Username / Email</label>
            <input
              className="input"
              value={form.username}
              onChange={e => setForm(f => ({...f, username: e.target.value}))}
              placeholder="Enter username"
              autoComplete="username"
            />
          </div>

          <div className="form-group" style={{ marginBottom:20 }}>
            <label className="label">Password</label>
            <div style={{ position:'relative' }}>
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({...f, password: e.target.value}))}
                placeholder="Enter password"
                autoComplete="current-password"
                style={{ paddingRight:42 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                title={showPw ? 'Hide password' : 'Show password'}
                style={{
                  position:'absolute', right:10, top:'50%',
                  transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer',
                  color:'var(--text3)', fontSize:18, lineHeight:1,
                  padding:'2px', display:'flex', alignItems:'center'
                }}
              >
                {showPw ? (
                  /* Eye-off icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  /* Eye icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            className="btn btn-primary w-full"
            type="submit"
            disabled={loading}
            style={{ width:'100%', justifyContent:'center', padding:'10px' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <div style={{ marginTop:16, fontSize:11, color:'var(--text3)', textAlign:'center', lineHeight:1.8 }}>
          admin/admin123 · manager/pass123 · sales1/pass123 · sourcing1/pass123
        </div>
      </div>
    </div>
  );
}
