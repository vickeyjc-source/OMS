// client/src/utils/helpers.js  v2
export const initials = n => n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
export const maskName = n => {
  if (!n) return '—';
  const first = n.split(' ')[0];
  return first[0] + '...';
};
export const fmt = n => new Intl.NumberFormat('en-IN').format(n||0);
export const fmtCur = (n, c='INR') => c==='USD'?`$${fmt(n)}`:c==='EUR'?`€${fmt(n)}`:c==='GBP'?`£${fmt(n)}`:`₹${fmt(n)}`;
export const today = () => new Date().toISOString().slice(0,10);
// Server stores timestamps as UTC in "YYYY-MM-DD HH:MM[:SS]" form (no Z).
// Parse those as UTC, then always render in IST (Asia/Kolkata).
export const parseUtc = (s) => {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s);
  // Bare "YYYY-MM-DD HH:MM..." (no timezone) → treat as UTC by appending Z.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(str) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) {
    return new Date(str.replace(' ', 'T') + 'Z');
  }
  return new Date(str);
};

export const toDateStrIST = (dateObj) => {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateObj);
};
export const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = parseUtc(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
};
// Date-only render in IST (for timestamp fields shown without time).
export const fmtDate = (s) => {
  if (!s) return '—';
  const d = parseUtc(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });
};
export const orderTotal = o => (o.lineItems||[]).reduce((s,i)=>s+(i.qty*i.unit_price),0);
export const isDelayed = o => {
  if (['delivered','failed','closed','cancelled'].includes(o.status)) return false;
  return o.tentative_date && new Date(o.tentative_date) < new Date();
};

// Departments
export const DEPARTMENTS = ['sales','sourcing','procurement','accounts','logistics','approvers','management'];
export const DEPT_LABEL  = { sales:'Sales', sourcing:'Sourcing', procurement:'Procurement', accounts:'Accounts', logistics:'Logistics', approvers:'Approvers', management:'Management' };
export const DEPT_COLOR  = { sales:'badge-teal', sourcing:'badge-purple', procurement:'badge-blue', accounts:'badge-amber', logistics:'badge-orange', approvers:'badge-green', management:'badge-red' };

// Order statuses (main)
export const ORDER_STATUSES = [
  {v:'open',       l:'Open'},
  {v:'closed',     l:'Closed'},
  {v:'delivered',  l:'Delivered'},
  {v:'hold',       l:'Hold'},
];

// Line item statuses
export const LINE_STATUSES = [
  {v:'negotiating', l:'Negotiating'},
  {v:'procurement', l:'Procurement'},
  {v:'payment',     l:'Payment'},
  {v:'shipped',     l:'Shipped'},
  {v:'delivered',   l:'Delivered'},
];

// Enquiry statuses
export const ENQ_STATUSES = [
  {v:'new',      l:'New'},
  {v:'sourcing', l:'Sourcing'},
  {v:'modify_requested', l:'Sent to Enquiry'},
  {v:'quoted',   l:'Quoted'},
  {v:'ordered',  l:'Ordered'},
  {v:'closed',   l:'Closed'},
];

export const STATUS_BADGE = {
  // Order — main statuses
  open:                  ['badge-blue',   'Open'],
  draft:                 ['badge-gray',   'Draft'],
  closed:                ['badge-green',  'Closed'],
  delivered:             ['badge-green',  'Delivered'],
  failed:                ['badge-red',    'Failed'],
  hold:                  ['badge-amber',  '⏸ On Hold'],
  cancelled:             ['badge-red',    'Cancelled'],
  // Order — procurement / payment flow
  procurement:           ['badge-blue',   'Procurement'],
  payment_approval:      ['badge-amber',  'Customer Payment Approval'],
  waiting_for_payment:   ['badge-amber',  'Customer Payment Approval'],
  cust_payment_update:   ['badge-amber',  'Customer Payment Approval'],
  sup_payment_update:    ['badge-orange', 'Supplier Payment Approval'],
  // Order — shipping / hub flow
  transit_hub:           ['badge-teal',   'Transit to Hub'],
  transit_customer:      ['badge-teal',   'Transit to Customer'],
  delivery_hub:          ['badge-teal',   'Delivery Hub'],
  partial_hub:           ['badge-teal',   'Partial at Hub'],
  partial_dispatched:    ['badge-teal',   'Partial Dispatched'],
  delivered_hub:         ['badge-green',  'At Hub'],
  delivered_customer:    ['badge-green',  'Delivered'],
  // Line item statuses
  negotiating:           ['badge-purple', 'Confirmed'],
  confirmed:             ['badge-purple', 'Confirmed'],
  payment:               ['badge-amber',  'Payment'],
  shipped:               ['badge-teal',   'Shipped'],
  partial_shipped:       ['badge-teal',   'Partial Shipped'],
  ready_to_ship:         ['badge-green',  'Ready to Ship'],
  grn_partial:           ['badge-amber',  'GRN Partial'],
  grn_rejected:          ['badge-red',    'GRN Rejected'],
  // Enquiry statuses
  new:                   ['badge-gray',   'New'],
  sourcing:              ['badge-purple', 'Sourcing'],
  returned_to_sourcing:  ['badge-orange', 'Revision'],
  quoted:                ['badge-orange', 'Quoted'],
  modify_requested:      ['badge-amber',  'Sent to Enquiry'],
  ordered:               ['badge-blue',   'Ordered'],
  order_created:         ['badge-blue',   'Order Created'],
  merged:                ['badge-gray',   'Merged'],
  // Quote statuses
  active:                ['badge-blue',   'Active'],
  superseded:            ['badge-gray',   'Superseded'],
  // Generic
  pending:               ['badge-gray',   'Pending'],
  received:              ['badge-green',  'Received'],
  paid:                  ['badge-green',  'Paid'],
  partial_paid:          ['badge-amber',  'Partial Paid'],
  payment_recorded:      ['badge-purple', 'Payment Recorded'],
  rejected:              ['badge-red',    'Rejected'],
  approved:              ['badge-green',  'Approved'],
  'in-transit':          ['badge-teal',   'In Transit'],
};

export const StatusBadge = ({ s }) => {
  if (s === 'hold') {
    return <HoldBadge />;
  }
  const [cls, lbl] = STATUS_BADGE[s] || ['badge-gray', s||'Unknown'];
  return <span className={`badge ${cls}`}>{lbl}</span>;
};
export const ShipBadge = ({ s }) => {
  const map = { pending:['badge-gray','Pending'], 'in-transit':['badge-teal','In Transit'], received:['badge-green','Received'], failed:['badge-red','Failed'] };
  const [cls, lbl] = map[s] || ['badge-gray', s];
  return <span className={`badge ${cls}`}>{lbl}</span>;
};
export const RoleBadge = ({ role }) => {
  const labels = { admin:'Administrator', manager:'Manager', user:'User' };
  return <span className={`role-${role}`}>{labels[role]||role}</span>;
};

// ── Days-in-stage helper ──────────────────────────────────────────────────────
// Calculates how many days an item has been sitting in its current stage
// using updated_at (falls back to created_at if not available)
export const daysInStage = (updatedAt) => {
  if (!updatedAt) return null;
  const d = parseUtc(updatedAt);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

// Color-coded badge: green 0-2d, amber 3-7d, red 8+d
export const DaysBadge = ({ updatedAt }) => {
  const d = daysInStage(updatedAt);
  if (d === null) return null;
  const color = d <= 2 ? 'var(--green)' : d <= 7 ? 'var(--amber)' : 'var(--red)';
  const bg    = d <= 2 ? 'var(--green-lt)' : d <= 7 ? 'var(--amber-lt)' : 'var(--red-lt)';
  return (
    <div style={{display:'flex', justifyContent:'center', alignItems:'center'}}>
      <span title={`${d} day${d!==1?'s':''} in this stage`} style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        width:46, height:28, borderRadius:5, fontSize:13, fontWeight:800,
        background:bg, color, border:`1px solid ${color}44`, whiteSpace:'nowrap',
      }}>
        {d}d
      </span>
    </div>
  );
};
export const DeptBadge = ({ dept }) => (
  <span className={`badge ${DEPT_COLOR[dept]||'badge-gray'}`}>{DEPT_LABEL[dept]||dept}</span>
);

export const HoldBadge = () => (
  <span style={{
    display:'inline-flex',alignItems:'center',gap:4,
    padding:'2px 8px',borderRadius:999,fontSize:10,fontWeight:800,
    background:'var(--amber-lt,#fffbeb)',color:'var(--amber,#d97706)',
    border:'1.5px solid var(--amber,#d97706)',letterSpacing:.4,
    boxShadow:'0 1px 3px rgba(217,119,6,0.15)'
  }}>
    <span>⏸</span> ON HOLD
  </span>
);

export const HoldNoteCallout = ({ reason, holdBy, holdAt, compact = false }) => {
  if (!reason && !holdBy) return null;
  return (
    <div style={{
      marginTop: compact ? 3 : 5,
      padding: compact ? '2px 8px' : '4px 10px',
      borderRadius: 'var(--r, 6px)',
      background: 'var(--amber-lt, #fffbeb)',
      border: '1px solid var(--amber, #d97706)55',
      fontSize: compact ? 11 : 12,
      color: '#92400e',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap'
    }}>
      <span>⏸ <strong>Hold Note:</strong> "{reason || 'No note'}"</span>
      {(holdBy || holdAt) && (
        <span style={{ fontSize: 10, color: '#b45309', opacity: 0.9 }}>
          • by {holdBy || 'User'} {holdAt ? `(${holdAt})` : ''}
        </span>
      )}
    </div>
  );
};
