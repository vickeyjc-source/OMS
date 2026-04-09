// client/src/context/AuthContext.js  v2
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../utils/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);
  const checkedRef = useRef(false);
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    api.get('/auth/me').then(r => { if (r.data?.id) setUser(r.data); else setUser(null); })
      .catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  const login = async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    setUser(r.data); return r.data;
  };
  const logout = async () => { try { await api.post('/auth/logout'); } catch {} setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
