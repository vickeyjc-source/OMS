// client/src/components/Layout.js  v2
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials, DEPT_LABEL } from '../utils/helpers';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { canAccessSection } from '../utils/sections';

const Icon = ({ d }) => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d={d}/></svg>;

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showKb, setShowKb] = useState(false);
  const { data: summary = {} } = useQuery({ queryKey:['summary'], queryFn:()=>api.get('/reports/summary').then(r=>r.data), refetchInterval:30000 });

  const dept = user.department || 'sales';
  const canSeeCustomers = user.perms?.canSeeCustomer ?? true;
  const can = key => canAccessSection(user, key);

  return (
    <div className="app-layout">
      <a href="#main-content" className="skip-to-content">Skip to content</a>
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
          {can('dashboard') && <NavLink to="/" end className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 1.5h5.5v5.5H1.5zM9 1.5h5.5v5.5H9zM1.5 9h5.5v5.5H1.5zM9 9h5.5v5.5H9z"/>Dashboard
          </NavLink>}

          <div className="sb-section">Enquiries</div>
          {can('enquiries') && <NavLink to="/enquiries" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 2h12v13H2zM5 5.5h6M5 8.5h6M5 11.5h3.5"/>
            Enquiries
            {(summary.enq_new||0) > 0 && <span className="nav-badge">{summary.enq_new}</span>}
          </NavLink>}
          {can('new-enquiry') && <NavLink to="/enquiries/new" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M8 1.5a6.5 6.5 0 100 13A6.5 6.5 0 008 1.5zM8 5v6M5 8h6"/>
            New Enquiry
          </NavLink>}
          {can('quotes') && <NavLink to="/quotes" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 2h12v13H2zM5 5h6M5 8h4"/>
            Quotes
            {(summary.quote_bin||0) > 0 && <span className="nav-badge" style={{background:'var(--purple,#7c3aed)',color:'#fff'}}>{summary.quote_bin}</span>}
          </NavLink>}

          <div className="sb-section">Orders</div>
          {can('orders') && <NavLink to="/orders" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 3h14v11H1zM5 3V1.5a1 1 0 011-1h4a1 1 0 011 1V3M8 7v3M6.5 8.5h3"/>
            All Orders
            {(summary.open||0) > 0 && <span className="nav-badge">{summary.open}</span>}
          </NavLink>}
          {can('new-order') && <NavLink to="/orders/new" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M8 1.5a6.5 6.5 0 100 13A6.5 6.5 0 008 1.5zM8 5v6M5 8h6"/>
            New Order
          </NavLink>}
          <div className="sb-section">Bins</div>
          {can('sourcing-bin') && <NavLink to="/sourcing-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M3 3h10l1 9H2L3 3zM6 3V2a2 2 0 014 0v1M6 7h4"/>
            Sourcing Bin
            {(summary.enq_sourcing||0) > 0 && <span className="nav-badge">{summary.enq_sourcing}</span>}
          </NavLink>}
          {can('procurement-bin') && <NavLink to="/procurement-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 5h14v9H1zM5 5V3.5a1 1 0 011-1h4a1 1 0 011 1V5M8 8v3M6.5 9.5h3"/>
            Procurement Bin
            {(summary.procurement||0) > 0 && <span className="nav-badge">{summary.procurement}</span>}
          </NavLink>}

          {can('delivery-hub') && (
            <NavLink to="/delivery-hub" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M1 8h14M1 8l4-4M1 8l4 4M10 4l4 4-4 4"/>
              Delivery Hub
              {(summary.delivery_hub||0) > 0 && <span className="nav-badge" style={{background:'var(--teal,#0d9488)',color:'#fff'}}>{summary.delivery_hub}</span>}
            </NavLink>
          )}
          {can('inventory') && <NavLink to="/inventory" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 4h14v10H1zM1 8h14M5 4v10M9 4v10"/>
            Stock Inventory
          </NavLink>}
          {can('closed-bin') && <NavLink to="/closed-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M2 8l4 4 8-8"/>
            Closed Bin
            {(summary.closed||0) > 0 && <span className="nav-badge" style={{background:'var(--green)',color:'#fff'}}>{summary.closed}</span>}
          </NavLink>}
          {can('deleted-bin') && <NavLink to="/deleted-bin" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.667 9.333A1 1 0 005.66 14h4.68a1 1 0 00.993-.667L12 4"/>
            Deleted Bin
          </NavLink>}
          {can('finance') && (
            <NavLink to="/finance" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M2 4h12v8H2zM2 8h12M6 12v2M10 12v2M5 14h6"/>
              Finance
            </NavLink>
          )}

          <div className="sb-section">Onboarding</div>
          {can('customers') && canSeeCustomers && (
            <NavLink to="/customers" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M8 2a3 3 0 100 6 3 3 0 000-6zM2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>Customers
            </NavLink>
          )}
          {can('suppliers') && <NavLink to="/suppliers" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1 5h14v9H1zM5 5V3.5a1 1 0 011-1h4a1 1 0 011 1V5M8 8v3M6.5 9.5h3"/>Suppliers
          </NavLink>}
          {can('linecards') && <NavLink to="/linecards" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 2h13v12H1.5zM1.5 7h13M4.5 2v5"/>Line Cards
          </NavLink>}

          {(can('users') || can('approvals')) && <>
            <div className="sb-section">Admin</div>
            {can('users') && <NavLink to="/users" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M6 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM1 13c0-2.8 2.2-5 5-5s5 2.2 5 5M12 4a2 2 0 110 4M15 13c0-1.7-1.3-3-3-3"/>Users
            </NavLink>}
            {can('approvals') && <NavLink to="/approvals" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M2 8l4 4 8-8"/>Approvals
            </NavLink>}
          </>}

          <div className="sb-section">Reports &amp; Tax</div>
          {can('reports') && <NavLink to="/reports" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
            <Icon d="M1.5 1.5h13v13H1.5zM1.5 11l3.5-4 2.5 2 3.5-5 3 3"/>Reports
          </NavLink>}
          {can('tax-settings') && (
            <NavLink to="/tax-settings" className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8s2.9 6.5 6.5 6.5 6.5-2.9 6.5-6.5S11.6 1.5 8 1.5zM8 4v8M6 6h4M6 10h4"/>Tax Settings
            </NavLink>
          )}

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
            <button
              className="btn btn-xs"
              title="Keyboard shortcuts"
              onClick={() => setShowKb(v => !v)}
              style={{fontWeight:500,gap:5,display:'flex',alignItems:'center'}}
            >
              <span style={{fontSize:14}}>⌨</span> Shortcuts
            </button>
            <div className="flex gap-8" style={{padding:'5px 11px 5px 5px',borderRadius:999,background:'var(--surface2)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)'}}>
              <div className="avatar avatar-sm">{initials(user.name)}</div>
              {user.name} · <span style={{color:'var(--accent)'}}>{DEPT_LABEL[dept]}</span>
            </div>
          </div>
        </header>
        <main id="main-content" className="page-content"><Outlet /></main>
      </div>
      {showKb && <KeyboardShortcutsPanel onClose={() => setShowKb(false)} />}
      <div style={{position:'fixed',bottom:10,right:16,fontSize:10,color:'var(--text3)',opacity:0.6,pointerEvents:'none',userSelect:'none',zIndex:9999}}>
        Powered by Sencilla Tec Solutions &nbsp;|&nbsp; All rights reserved
      </div>
    </div>
  );
}

function PageTitle() {
  const map = {'/':'Dashboard','/enquiries':'Enquiries','/enquiries/new':'New Enquiry','/quotes':'Quotes','/orders':'Orders','/orders/new':'New Order','/sourcing-bin':'Sourcing Bin','/procurement-bin':'Procurement Bin','/closed-bin':'Closed Bin','/deleted-bin':'Deleted Bin','/customers':'Customers','/suppliers':'Suppliers','/linecards':'Line Cards','/users':'User Management','/settings':'Settings','/tax-settings':'Tax Settings','/delivery-hub':'Delivery Hub','/approvals':'Approval Workflows','/reports':'Reports','/finance':'Finance','/inventory':'Stock Inventory'};
  return map[window.location.pathname] || 'Ciflux OMS';
}

// ── Keyboard Shortcuts Panel ──────────────────────────────────────────────────
const KB_SECTIONS = [
  {
    title: '⌨ Form Fields',
    rows: [
      [['Tab'],             'Move to next field'],
      [['Shift','Tab'],     'Move to previous field'],
      [['Enter'],           'Confirm / submit form'],
      [['Space'],           'Toggle checkbox / expand accordion'],
      [['Esc'],             'Clear field / cancel inline edit'],
    ],
  },
  {
    title: '🔍 Search & Navigation',
    rows: [
      [['/'],               'Focus the search bar from anywhere'],
      [['↑','↓'],           'Move through list rows / dropdown options'],
      [['Enter'],           'Open selected row / select option'],
      [['Esc'],             'Close dropdown / clear search'],
    ],
  },
  {
    title: '🗂 Modals & Dialogs',
    rows: [
      [['Tab'],             'Cycle through all buttons & inputs inside modal'],
      [['Shift','Tab'],     'Cycle backwards inside modal'],
      [['Esc'],             'Close modal without saving'],
      [['Enter'],           'Activate focused button (Save / Confirm)'],
    ],
  },
  {
    title: '📋 Tables & Lists',
    rows: [
      [['↑','↓'],           'Move between rows'],
      [['Enter'],           'Open / edit the focused row'],
      [['Tab'],             'Jump to next interactive column cell'],
    ],
  },
  {
    title: '🗔 Page-level',
    rows: [
      [['Alt','←'],         'Go back (browser history)'],
      [['Alt','→'],         'Go forward (browser history)'],
    ],
  },
];

function KeyboardShortcutsPanel({ onClose }) {
  return (
    <div
      className="overlay"
      style={{zIndex:1200}}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{maxWidth:600,maxHeight:'90vh'}}>
        <div className="modal-header">
          <h2 style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:20}}>⌨</span> Keyboard Shortcuts</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{overflowY:'auto',paddingBottom:24}}>
          {KB_SECTIONS.map(sec => (
            <div key={sec.title} style={{marginBottom:20}}>
              <div style={{
                fontWeight:700, fontSize:12, color:'var(--text2)',
                textTransform:'uppercase', letterSpacing:'0.06em',
                marginBottom:8, paddingBottom:5,
                borderBottom:'1px solid var(--border)',
              }}>
                {sec.title}
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <tbody>
                  {sec.rows.map(([keys, desc], i) => (
                    <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={{padding:'7px 0',width:'42%',verticalAlign:'middle'}}>
                        <span style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                          {keys.map((k, ki) => (
                            <React.Fragment key={ki}>
                              <kbd style={{
                                display:'inline-block',
                                padding:'2px 7px',
                                borderRadius:5,
                                background:'var(--surface2)',
                                border:'1px solid var(--border-md)',
                                boxShadow:'0 1px 0 var(--border-md)',
                                fontSize:12,
                                fontFamily:'DM Mono,monospace',
                                fontWeight:600,
                                color:'var(--text)',
                                whiteSpace:'nowrap',
                              }}>{k}</kbd>
                              {ki < keys.length - 1 && (
                                <span style={{fontSize:10,color:'var(--text3)',fontWeight:600}}>+</span>
                              )}
                            </React.Fragment>
                          ))}
                        </span>
                      </td>
                      <td style={{padding:'7px 0 7px 16px',fontSize:13,color:'var(--text)',verticalAlign:'middle'}}>
                        {desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div style={{
            marginTop:12,padding:'10px 14px',borderRadius:'var(--r-sm)',
            background:'var(--accent-lt)',border:'1px solid var(--accent)33',
            fontSize:12,color:'var(--text2)',lineHeight:1.6,
          }}>
            💡 <strong>Tip:</strong> Focus rings are shown on all interactive elements. Use <kbd style={{padding:'1px 5px',borderRadius:4,background:'var(--surface2)',border:'1px solid var(--border-md)',fontSize:11,fontFamily:'DM Mono,monospace'}}>Tab</kbd> to navigate field-by-field through any form without touching the mouse.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
