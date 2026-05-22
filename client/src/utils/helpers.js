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
export const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
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
  {v:'failed',     l:'Failed'},
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
  {v:'quoted',   l:'Quoted'},
  {v:'ordered',  l:'Ordered'},
  {v:'closed',   l:'Closed'},
];

export const STATUS_BADGE = {
  // Order
  open:        ['badge-blue',   'Open'],
  closed:      ['badge-green',  'Closed'],
  delivered:   ['badge-green',  'Delivered'],
  failed:      ['badge-red',    'Failed'],
  hold:        ['badge-amber',  'Hold'],
  // Line items
  negotiating: ['badge-purple', 'Negotiating'],
  procurement: ['badge-blue',   'Procurement'],
  payment:     ['badge-amber',  'Payment'],
  shipped:     ['badge-teal',   'Shipped'],
  // Enquiry
  draft:       ['badge-gray',   '💾 Draft'],
  new:         ['badge-gray',   'New'],
  sourcing:    ['badge-purple', 'Sourcing'],
  quoted:      ['badge-orange', 'Quoted'],
  ordered:     ['badge-blue',   'Ordered'],
  // Generic
  pending:     ['badge-gray',   'Pending'],
  'in-transit':['badge-teal',   'In Transit'],
  received:    ['badge-green',  'Received'],
  cancelled:   ['badge-red',    'Cancelled'],
};

export const StatusBadge = ({ s }) => {
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
  const d = new Date(updatedAt.replace(' ', 'T'));
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
