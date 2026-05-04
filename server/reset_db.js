// server/reset_db.js
// Clears operational OMS data while keeping customers, suppliers, and users.
// Usage:  node server/reset_db.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB       || 'ciflux_oms',
  user:     process.env.PG_USER     || 'ciflux',
  password: process.env.PG_PASSWORD || 'ciflux_pass',
});

// Tables to clear — ordered so FK constraints are respected (children first).
const TABLES = [
  'shipment_items',
  'shipments',
  'app_files',
  'grn_records',
  'stock_inventory',
  'approval_actions',
  'approval_requests',
  'approval_workflows',
  'order_history',
  'order_documents',
  'customer_shipping',
  'supplier_order_items',
  'supplier_orders',
  'order_items',
  'orders',
  'customer_payments',
  'finance_queue',
  'quote_history',
  'quotes',
  'enquiry_history',
  'enquiry_sourcing',
  'enquiry_items',
  'enquiries',
  'po_requests',
  'supplier_linecards',
  'linecards',
  'shippers',
  'app_settings',
  'po_templates',
];

const KEPT = [
  'customers',
  'suppliers',
  'users',
];

async function main() {
  console.log('\n=== Ciflux OMS — Operational Data Clean ===\n');
  console.log('KEEPING:', KEPT.join(', '));
  console.log('CLEARING:', TABLES.join(', '), '\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'TRUNCATE ' + TABLES.map(t => '"' + t + '"').join(', ') + ' RESTART IDENTITY CASCADE'
    );
    await client.query('COMMIT');
    console.log('✓  ' + TABLES.length + ' tables cleared.');
    console.log('✓  Customers, Suppliers, and Users were kept.');
    console.log('✓  Purchase orders and all other operational data were removed.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗  Clean FAILED (rolled back):', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
