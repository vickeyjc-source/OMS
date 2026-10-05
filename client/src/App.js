// client/src/App.js  v2

import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import KeyboardProvider from './components/KeyboardProvider';
import { canAccessSection } from './utils/sections';

const Layout = lazy(()=>import('./components/Layout'));
const LoginPage = lazy(()=>import('./pages/LoginPage'));
const DashboardPage = lazy(()=>import('./pages/DashboardPage'));
const EnquiriesPage = lazy(()=>import('./pages/EnquiriesPage'));
const NewEnquiryPage = lazy(()=>import('./pages/NewEnquiryPage'));
const EnquiryDetailPage = lazy(()=>import('./pages/EnquiryDetailPage'));
const QuotesPage = lazy(()=>import('./pages/QuotesPage'));
const OrdersPage = lazy(()=>import('./pages/OrdersPage'));
const NewOrderPage = lazy(()=>import('./pages/NewOrderPage'));
const CustomersPage = lazy(()=>import('./pages/CustomersPage'));
const SuppliersPage = lazy(()=>import('./pages/SuppliersPage'));
const LineCardsPage = lazy(()=>import('./pages/LineCardsPage'));
const UsersPage = lazy(()=>import('./pages/UsersPage'));
const SettingsPage = lazy(()=>import('./pages/SettingsPage'));
const DeliveryHubPage = lazy(()=>import('./pages/DeliveryHubPage'));
const ApprovalsPage = lazy(()=>import('./pages/ApprovalsPage'));
const ReportsPage = lazy(()=>import('./pages/ReportsPage'));
const SourcingBinDrawerPage = lazy(()=>import('./pages/SourcingBinDrawerPage'));
const ProcurementBinPage = lazy(()=>import('./pages/ProcurementBinPage'));
const ClosedBinPage = lazy(()=>import('./pages/ClosedBinPage'));
const AuditBinPage = lazy(()=>import('./pages/AuditBinPage'));
const DeletedBinPage = lazy(()=>import('./pages/DeletedBinPage'));
const DangerZonePage = lazy(()=>import('./pages/DangerZonePage'));
const FinancePage = lazy(()=>import('./pages/FinancePage'));
const TaxSettingsPage = lazy(()=>import('./pages/TaxSettingsPage'));
const InventoryPage = lazy(()=>import('./pages/InventoryPage'));
const AnalysisPage = lazy(()=>import('./pages/AnalysisPage'));
const AnalysisLineDetailPage = lazy(()=>import('./pages/AnalysisLineDetailPage'));

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

function RequireSection({ section, children, adminOnly, strictAdmin }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  // strictAdmin = hard admin-only (Recycle Bin, Danger Zone) — managers excluded too.
  if (strictAdmin && user.role !== 'admin') return <Navigate to="/" replace />;
  if (adminOnly && !['admin','manager'].includes(user.role)) return <Navigate to="/" replace />;
  if (!canAccessSection(user, section)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return (
    <Suspense fallback={<Spinner/>}><Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<RequireSection section="dashboard"><DashboardPage /></RequireSection>} />
        <Route path="enquiries" element={<RequireSection section="enquiries"><EnquiriesPage /></RequireSection>} />
        <Route path="enquiries/new" element={<RequireSection section="new-enquiry"><NewEnquiryPage /></RequireSection>} />
        <Route path="enquiries/:id" element={<RequireSection section="enquiries"><EnquiryDetailPage /></RequireSection>} />
        <Route path="quotes" element={<RequireSection section="quotes"><QuotesPage /></RequireSection>} />
        <Route path="orders" element={<RequireSection section="orders"><OrdersPage /></RequireSection>} />
        <Route path="orders/new" element={<RequireSection section="new-order"><NewOrderPage /></RequireSection>} />
        <Route path="customers" element={<RequireSection section="customers"><CustomersPage /></RequireSection>} />
        <Route path="suppliers" element={<RequireSection section="suppliers"><SuppliersPage /></RequireSection>} />
        <Route path="linecards" element={<RequireSection section="linecards"><LineCardsPage /></RequireSection>} />
        <Route path="users" element={<RequireSection section="users" adminOnly><UsersPage /></RequireSection>} />
        <Route path="settings" element={<RequireSection section="settings" adminOnly><SettingsPage /></RequireSection>} />
        <Route path="tax-settings" element={<RequireSection section="tax-settings" adminOnly><TaxSettingsPage /></RequireSection>} />
        <Route path="delivery-hub" element={<RequireSection section="delivery-hub"><DeliveryHubPage /></RequireSection>} />
        <Route path="approvals" element={<RequireSection section="approvals"><ApprovalsPage /></RequireSection>} />
        <Route path="reports" element={<RequireSection section="reports"><ReportsPage /></RequireSection>} />
        <Route path="sourcing-bin" element={<RequireSection section="sourcing-bin"><SourcingBinDrawerPage /></RequireSection>} />
        <Route path="procurement-bin" element={<RequireSection section="procurement-bin"><ProcurementBinPage /></RequireSection>} />
        <Route path="closed-bin" element={<RequireSection section="closed-bin"><ClosedBinPage /></RequireSection>} />
        <Route path="audit-bin" element={<RequireSection section="audit-bin"><AuditBinPage /></RequireSection>} />
        <Route path="audit-bin/:orderId" element={<RequireSection section="audit-bin"><AuditBinPage /></RequireSection>} />
        <Route path="deleted-bin" element={<RequireSection section="deleted-bin" strictAdmin><DeletedBinPage /></RequireSection>} />
        <Route path="danger-zone" element={<RequireSection section="danger-zone" strictAdmin><DangerZonePage /></RequireSection>} />
        <Route path="finance" element={<RequireSection section="finance"><FinancePage /></RequireSection>} />
        <Route path="inventory" element={<RequireSection section="inventory"><InventoryPage /></RequireSection>} />
        <Route path="rfq-analysis" element={<RequireSection section="rfq-analysis"><AnalysisPage /></RequireSection>} />
        <Route path="rfq-analysis/:lineId" element={<RequireSection section="rfq-analysis"><AnalysisLineDetailPage /></RequireSection>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes></Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/app">
        <KeyboardProvider>
          <AppRoutes />
          <Toaster position="bottom-right" toastOptions={{ duration: 3500, style: { fontSize: 13 } }} />
        </KeyboardProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
