// client/src/utils/helpers.js  v2
export const initials = n => n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
export const fmt = n => new Intl.NumberFormat('en-IN').format(n||0);
export const fmtCur = (n, c='INR') => c==='USD'?`$${fmt(n)}`:c==='EUR'?`€${fmt(n)}`:c==='GBP'?`£${fmt(n)}`:`₹${fmt(n)}`;
export const today = () => new Date().toISOString().slice(0,10);
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
export const DeptBadge = ({ dept }) => (
  <span className={`badge ${DEPT_COLOR[dept]||'badge-gray'}`}>{DEPT_LABEL[dept]||dept}</span>
);
