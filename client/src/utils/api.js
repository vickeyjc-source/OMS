// client/src/utils/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15000,
});

// DO NOT redirect on 401 here — let AuthContext handle it
// Redirecting in the interceptor causes infinite reload loops
api.interceptors.response.use(
  r => r,
  err => Promise.reject(err)
);

export default api;
