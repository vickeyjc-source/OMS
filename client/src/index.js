// client/src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

// Globally prevent negative values (minus sign) in ANY number input across the app
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
    if (e.key === '-') e.preventDefault();
  }
});
document.addEventListener('paste', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    if (paste.includes('-')) e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
