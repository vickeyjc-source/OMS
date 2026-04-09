// client/src/App.js  v2
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EnquiriesPage from './pages/EnquiriesPage';
import NewEnquiryPage from './pages/NewEnquiryPage';
import QuotesPage from './pages/QuotesPage';
import OrdersPage from './pages/OrdersPage';
import NewOrderPage from './pages/NewOrderPage';
import CustomersPage from './pages/CustomersPage';
import SuppliersPage from './pages/SuppliersPage';
import LineCardsPage from './pages/LineCardsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import DeliveryHubPage from './pages/DeliveryHubPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ReportsPage from './pages/ReportsPage';
import SourcingBinPage from './pages/SourcingBinPage';
import ProcurementBinPage from './pages/ProcurementBinPage';
import ClosedBinPage from './pages/ClosedBinPage';
import DeletedBinPage from './pages/DeletedBinPage';

function Spinner() {
  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#f0ede8',gap:14,color:'#6a6760',fontSize:14}}>
      <div style={{width:36,height:36,border:'3px solid #e0ddd8',borderTop:'3px solid #1b4f9e',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      Loading Ciflux OMS…
    </div>
  );
}

function RequireAuth({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !['admin','manager'].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="enquiries" element={<EnquiriesPage />} />
        <Route path="enquiries/new" element={<NewEnquiryPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="linecards" element={<LineCardsPage />} />
        <Route path="users" element={<RequireAuth adminOnly><UsersPage /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth adminOnly><SettingsPage /></RequireAuth>} />
        <Route path="delivery-hub" element={<DeliveryHubPage />} />
        <Route path="approvals" element={<RequireAuth adminOnly><ApprovalsPage /></RequireAuth>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="sourcing-bin" element={<SourcingBinPage />} />
        <Route path="procurement-bin" element={<ProcurementBinPage />} />
        <Route path="closed-bin" element={<ClosedBinPage />} />
        <Route path="deleted-bin" element={<DeletedBinPage />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="bottom-right" toastOptions={{ duration: 3500, style: { fontSize: 13 } }} />
      </BrowserRouter>
    </AuthProvider>
  );
}
