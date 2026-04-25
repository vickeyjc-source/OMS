// client/src/pages/LoginPage.js
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 400, marginBottom: 0 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>⚡ Cif<span style={{ color: 'var(--accent)' }}>lux</span> OMS</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>Order Management System · Electronic Components</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="label">Username / Email</label>
            <input className="input" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} placeholder="Enter username" />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="label">Password</label>
            <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="Enter password" />
          </div>
          <button className="btn btn-primary w-full" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  );
}
