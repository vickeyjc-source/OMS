export const SECTION_DEFINITIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', group: 'Overview' },
  { key: 'enquiries', label: 'Enquiries', path: '/enquiries', group: 'Enquiries' },
  { key: 'new-enquiry', label: 'New Enquiry', path: '/enquiries/new', group: 'Enquiries' },
  { key: 'quotes', label: 'Quotes', path: '/quotes', group: 'Enquiries' },
  { key: 'orders', label: 'All Orders', path: '/orders', group: 'Orders' },
  { key: 'new-order', label: 'New Order', path: '/orders/new', group: 'Orders' },
  { key: 'sourcing-bin', label: 'Sourcing Bin', path: '/sourcing-bin', group: 'Bins' },
  { key: 'procurement-bin', label: 'Procurement Bin', path: '/procurement-bin', group: 'Bins' },
  { key: 'delivery-hub', label: 'Delivery Hub', path: '/delivery-hub', group: 'Bins' },
  { key: 'inventory', label: 'Stock Inventory', path: '/inventory', group: 'Bins' },
  { key: 'closed-bin', label: 'Closed Bin', path: '/closed-bin', group: 'Bins' },
  { key: 'deleted-bin', label: 'Deleted Bin', path: '/deleted-bin', group: 'Bins' },
  { key: 'finance', label: 'Finance', path: '/finance', group: 'Finance' },
  { key: 'customers', label: 'Customers', path: '/customers', group: 'Onboarding' },
  { key: 'suppliers', label: 'Suppliers', path: '/suppliers', group: 'Onboarding' },
  { key: 'linecards', label: 'Line Cards', path: '/linecards', group: 'Onboarding' },
  { key: 'users', label: 'User Management', path: '/users', group: 'Admin', adminOnly: true },
  { key: 'approvals', label: 'Approvals', path: '/approvals', group: 'Admin', adminOnly: true },
  { key: 'settings', label: 'Settings', path: '/settings', group: 'Admin', adminOnly: true },
  { key: 'tax-settings', label: 'Tax Settings', path: '/tax-settings', group: 'Reports & Tax', adminOnly: true },
  { key: 'reports', label: 'Reports', path: '/reports', group: 'Reports & Tax' },
];

export const SECTION_LABELS = Object.fromEntries(SECTION_DEFINITIONS.map(s => [s.key, s.label]));
export const ALL_SECTION_KEYS = SECTION_DEFINITIONS.map(s => s.key);

export function canAccessSection(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const allowed = user.allowedSections || user.allowed_sections;
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(key);
}
