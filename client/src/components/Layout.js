// client/src/components/Layout.js  v2
import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials, DEPT_LABEL } from '../utils/helpers';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

const Icon = ({ d }) => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d={d}/></svg>;

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: summary = {} } = useQuery({ queryKey:['summary'], queryFn:()=>api.get('/reports/summary').then(r=>r.data), refetchInterval:30000 });

  const dept = user.department || 'sales';
  const isAdmin = ['admin','manager'].includes(user.role);
  const isSourcing    = dept === 'sourcing'    || isAdmin;
  const isProcurement = dept === 'procurement' || isAdmin;
  const isDelivery    = dept === 'delivery'    || isAdmin;
  const canSeeCustomers = user.perms?.canSeeCustomer ?? true;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sb-logo">
          <div className="sb-logo-mark">⚡ Cif<span>lux</span> OMS</div>
          <div className="sb-logo-sub">Electronic Components v2</div>
        </div>
        <div className="sb-user">
          <div className="avatar">{initials(user.name)}</div>
          <div>
            <div style={{fontSize:12,fontWeight:600}}>{user.name}</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>{DEPT_LABEL[dept]||dept}</div>
          </div>
        </div>
        <nav className="sb-nav">
          <div className="sb-section">Overview</div>
          <NavLink to="/" end className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 1.5h5.5v5.5H1.5zM9 1.5h5.5v5.5H9zM1.5 9h5.5v5.5H1.5zM9 9h5.5v5.5H9z"/>Dashboard
          </NavLink>

          <div className="sb-section">Enquiries</div>
          <NavLink to="/enquiries" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 2h12v13H2zM5 5.5h6M5 8.5h6M5 11.5h3.5"/>
            Enquiries
            {(summary.enq_new||0) > 0 && <span className="nav-badge">{summary.enq_new}</span>}
          </NavLink>
          <NavLink to="/enquiries/new" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M8 1.5a6.5 6.5 0 100 13A6.5 6.5 0 008 1.5zM8 5v6M5 8h6"/>
            New Enquiry
          </NavLink>
          <NavLink to="/quotes" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 2h12v13H2zM5 5h6M5 8h4"/>
            Quotes
            {(summary.quote_bin||0) > 0 && <span className="nav-badge" style={{background:'var(--purple,#7c3aed)',color:'#fff'}}>{summary.quote_bin}</span>}
          </NavLink>

          <div className="sb-section">Orders</div>
          <NavLink to="/orders" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 3h14v11H1zM5 3V1.5a1 1 0 011-1h4a1 1 0 011 1V3M8 7v3M6.5 8.5h3"/>
            All Orders
            {(summary.open||0) > 0 && <span className="nav-badge">{summary.open}</span>}
          </NavLink>
          <NavLink to="/orders/new" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M8 1.5a6.5 6.5 0 100 13A6.5 6.5 0 008 1.5zM8 5v6M5 8h6"/>
            New Order
          </NavLink>

          <div className="sb-section">Bins</div>
          <NavLink to="/sourcing-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M3 3h10l1 9H2L3 3zM6 3V2a2 2 0 014 0v1M6 7h4"/>
            Sourcing Bin
            {(summary.enq_sourcing||0) > 0 && <span className="nav-badge">{summary.enq_sourcing}</span>}
          </NavLink>
          <NavLink to="/procurement-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 5h14v9H1zM5 5V3.5a1 1 0 011-1h4a1 1 0 011 1V5M8 8v3M6.5 9.5h3"/>
            Procurement Bin
            {(summary.procurement||0) > 0 && <span className="nav-badge">{summary.procurement}</span>}
          </NavLink>

          {(isDelivery||isProcurement) && (
            <NavLink to="/delivery-hub" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M1 8h14M1 8l4-4M1 8l4 4M10 4l4 4-4 4"/>
              Delivery Hub
              {(summary.delivery_hub||0) > 0 && <span className="nav-badge" style={{background:'var(--teal,#0d9488)',color:'#fff'}}>{summary.delivery_hub}</span>}
            </NavLink>
          )}
          <NavLink to="/closed-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 8l4 4 8-8"/>
            Closed Bin
            {(summary.closed||0) > 0 && <span className="nav-badge" style={{background:'var(--green)',color:'#fff'}}>{summary.closed}</span>}
          </NavLink>
          <NavLink to="/deleted-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.667 9.333A1 1 0 005.66 14h4.68a1 1 0 00.993-.667L12 4"/>
            Deleted Bin
          </NavLink>

          <div className="sb-section">Onboarding</div>
          {canSeeCustomers && (
            <NavLink to="/customers" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M8 2a3 3 0 100 6 3 3 0 000-6zM2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>Customers
            </NavLink>
          )}
          <NavLink to="/suppliers" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 5h14v9H1zM5 5V3.5a1 1 0 011-1h4a1 1 0 011 1V5M8 8v3M6.5 9.5h3"/>Suppliers
          </NavLink>
          <NavLink to="/linecards" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 2h13v12H1.5zM1.5 7h13M4.5 2v5"/>Line Cards
          </NavLink>

          {isAdmin && <>
            <div className="sb-section">Admin</div>
            <NavLink to="/users" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M6 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM1 13c0-2.8 2.2-5 5-5s5 2.2 5 5M12 4a2 2 0 110 4M15 13c0-1.7-1.3-3-3-3"/>Users
            </NavLink>
            <NavLink to="/approvals" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M2 8l4 4 8-8"/>Approvals
            </NavLink>
          </>}

          <div className="sb-section">Reports</div>
          <NavLink to="/reports" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 1.5h13v13H1.5zM1.5 11l3.5-4 2.5 2 3.5-5 3 3"/>Reports
          </NavLink>

          <div style={{borderTop:'1px solid var(--border)',marginTop:8,paddingTop:4}}>
            <div className="nav-item" onClick={async()=>{await logout();navigate('/login');}}>
              <Icon d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M10 11l4-3-4-3M14 8H6"/>Sign Out
            </div>
          </div>
        </nav>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div style={{fontWeight:600,fontSize:15}}><PageTitle /></div>
          <div className="flex gap-8">
            <div className="flex gap-8" style={{padding:'5px 11px 5px 5px',borderRadius:999,background:'var(--surface2)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)'}}>
              <div className="avatar avatar-sm">{initials(user.name)}</div>
              {user.name} · <span style={{color:'var(--accent)'}}>{DEPT_LABEL[dept]}</span>
            </div>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
		<div style={{
  position: 'fixed',
  bottom: '8px',
  right: '12px',
  fontSize: '10px',
  color: 'rgba(0,0,0,0.5)',
  zIndex: 9999,
  pointerEvents: 'none'
}}>
  Powered by Sencilla Tec Solutions · All Rights Reserved
</div>
      </div>
    </div>
  );
}

function PageTitle() {
  const map = {'/':'Dashboard','/enquiries':'Enquiries','/enquiries/new':'New Enquiry','/quotes':'Quotes','/orders':'Orders','/orders/new':'New Order','/sourcing-bin':'Sourcing Bin','/procurement-bin':'Procurement Bin','/closed-bin':'Closed Bin','/deleted-bin':'Deleted Bin','/customers':'Customers','/suppliers':'Suppliers','/linecards':'Line Cards','/users':'User Management','/settings':'Settings','/delivery-hub':'Delivery Hub','/approvals':'Approval Workflows','/reports':'Reports'};
  return map[window.location.pathname] || 'Ciflux OMS';
}
