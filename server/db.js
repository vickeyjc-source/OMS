// server/db.js  –  Ciflux OMS v2  (PostgreSQL edition)
// Drop-in replacement for the sql.js version.
// All exports keep identical signatures — server/index.js needs ZERO changes.

const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');

// ── Connection pool ────────────────────────────────────────────────────────────
// Configure via environment variables or a .env file (see .env.example).

if (!process.env.PG_PASSWORD) {
  console.error('Missing required environment variable: PG_PASSWORD');
  process.exit(1);
}
const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB       || 'ciflux_oms',
  user:     process.env.PG_USER     || 'ciflux',
  password: process.env.PG_PASSWORD,
  ssl:      (process.env.PG_HOST || '').includes('azure') ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// ── SQLite ?-placeholder → PostgreSQL $N converter ────────────────────────────
function convertQuery(sql, params) {
  let i = 0;
  let q = sql.replace(/\?/g, () => `$${++i}`);

  // SQLite INSERT OR REPLACE → PostgreSQL upserts for the two tables that use it
  q = q.replace(
    /INSERT OR REPLACE INTO customer_shipping(?:\(order_id,status,shipper_id,tracking_no,delivery_date,comments\))? VALUES\(\$1,\$2,\$3,\$4,\$5,\$6\)/i,
    `INSERT INTO customer_shipping(order_id,status,shipper_id,tracking_no,delivery_date,comments)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(order_id) DO UPDATE SET
       status=EXCLUDED.status, shipper_id=EXCLUDED.shipper_id,
       tracking_no=EXCLUDED.tracking_no, delivery_date=EXCLUDED.delivery_date,
       comments=EXCLUDED.comments`
  );
  q = q.replace(
    /INSERT OR REPLACE INTO order_documents VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7\)/i,
    `INSERT INTO order_documents(order_id,delivery_slip,packing_list,invoice,eway_bill,po_file,comments)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(order_id) DO UPDATE SET
       delivery_slip=EXCLUDED.delivery_slip, packing_list=EXCLUDED.packing_list,
       invoice=EXCLUDED.invoice, eway_bill=EXCLUDED.eway_bill,
       po_file=EXCLUDED.po_file, comments=EXCLUDED.comments`
  );

  // SQLite date('now') → PostgreSQL CURRENT_DATE
  q = q.replace(/date\('now'\)/gi, 'CURRENT_DATE');

  // PostgreSQL cannot compare TEXT < DATE directly.
  // When any column ending in _date or named tentative_date etc is compared to
  // CURRENT_DATE, cast it with NULLIF(col,'')::date so empty strings don't crash.
  q = q.replace(/(\b[\w]*(?:date|_date)[\w]*\b)\s*(<|>|<=|>=)\s*CURRENT_DATE/gi,
    (_, col, op) => `NULLIF(${col},'')::date ${op} CURRENT_DATE`);

  return q;
}

// ── Sync bridge via Atomics.wait ──────────────────────────────────────────────
// deasync is broken on Node v23+ (Maximum call stack size exceeded).
// Atomics.wait with a 1 ms sleep drains the event loop between checks —
// zero native addons, works on every Node >= 10.4 with SharedArrayBuffer.
function syncify(asyncFn) {
  return function (...args) {
    let result, error, done = false;
    asyncFn(...args)
      .then(r  => { result = r; done = true; })
      .catch(e => { error  = e; done = true; });
    const flag = new Int32Array(new SharedArrayBuffer(4));
    while (!done) {
      Atomics.wait(flag, 0, 0, 1); // yields 1 ms to event loop each iteration
    }
    if (error) throw error;
    return result;
  };
}

// saveNow() is a no-op — PostgreSQL persists every write immediately.
function saveNow() {}

// ── Core helpers ───────────────────────────────────────────────────────────────
const allAsync = async (sql, params = []) => {
  const { rows } = await pool.query(convertQuery(sql), params);
  return rows;
};
const runAsync = async (sql, params = []) => {
  await pool.query(convertQuery(sql), params);
};
const getAsync = async (sql, params = []) => {
  const rows = await allAsync(sql, params);
  return rows.length ? rows[0] : null;
};

const all = syncify(allAsync);
const run = syncify(runAsync);
const get = syncify(getAsync);

// saveNow() is a no-op — PostgreSQL persists every write immediately.
function saveNow() {}

// ── nextId ────────────────────────────────────────────────────────────────────
function nextId(table, prefix, pad) {
  pad = pad || 3;
  const rows = all(`SELECT id FROM ${table}`);
  const nums = rows.map(r => parseInt((r.id.match(/\d+$/) || ['0'])[0])).filter(n => !isNaN(n));
  return `${prefix}${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(pad,'0')}`;
}

async function nextIdAsync(table, prefix, pad) {
  pad = pad || 3;
  const rows = await allAsync(`SELECT id FROM ${table}`);
  const nums = rows.map(r => parseInt((r.id.match(/\d+$/) || ['0'])[0])).filter(n => !isNaN(n));
  return `${prefix}${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(pad,'0')}`;
}

// ── assembleOrder / assembleEnquiry ───────────────────────────────────────────
async function assembleOrder(order) {
  const o = { ...order };
  o.lineItems = await allAsync('SELECT * FROM order_items WHERE order_id=? ORDER BY sort_order', [o.id]);
  const sos     = await allAsync('SELECT * FROM supplier_orders WHERE order_id=?', [o.id]);
  const soIds   = sos.map(s => s.id);
  const soItems = soIds.length
    ? await allAsync('SELECT supplier_order_id, item_id FROM supplier_order_items WHERE supplier_order_id IN (' + soIds.map(()=>'?').join(',') + ')', soIds)
    : [];
  const returnedFinance = soIds.length
    ? await allAsync("SELECT supplier_order_id FROM finance_queue WHERE status='returned_to_procurement' AND supplier_order_id IN (" + soIds.map(()=>'?').join(',') + ')', soIds)
    : [];
  const returnedPoIds = new Set(returnedFinance.map(r => r.supplier_order_id));
  // Advance-payment additional charges live on finance_queue; surface them per supplier order
  let fqCharges = [];
  try {
    fqCharges = soIds.length
      ? await allAsync('SELECT supplier_order_id, additional_charges, actual_amount, amount_change_note, paid_amount FROM finance_queue WHERE supplier_order_id IN (' + soIds.map(()=>'?').join(',') + ')', soIds)
      : [];
  } catch(_) { fqCharges = []; }
  const fqBySo = {};
  fqCharges.forEach(r => { fqBySo[r.supplier_order_id] = r; });
  o.supplierOrders = sos.map(so => {
    const fq = fqBySo[so.id] || {};
    return {
      ...so,
      finance_returned: returnedPoIds.has(so.id),
      // advance charges (finance_queue) — fall back to net charges already on the row
      advance_additional_charges: fq.additional_charges || null,
      advance_actual_amount: fq.actual_amount ?? null,
      advance_amount_change_note: fq.amount_change_note || null,
      advance_paid_amount: fq.paid_amount ?? null,
      items: soItems.filter(i => i.supplier_order_id === so.id).map(i => i.item_id)
    };
  });
  o.customerShipping = (await getAsync('SELECT * FROM customer_shipping WHERE order_id=?', [o.id]))
    || { status:'pending', shipper_id:'', tracking_no:'', delivery_date:'', comments:'' };
  o.documents = (await getAsync('SELECT * FROM order_documents WHERE order_id=?', [o.id]))
    || { delivery_slip:'', packing_list:'', invoice:'', eway_bill:'', po_file:'', comments:'' };
  o.history = await allAsync('SELECT * FROM order_history WHERE order_id=? ORDER BY ts DESC', [o.id]);
  const shipRows = await allAsync('SELECT * FROM shipments WHERE order_id=? ORDER BY shipment_no', [o.id]);
  const shipIds  = shipRows.map(s=>s.id);
  const shipItemRows = shipIds.length ? await allAsync('SELECT * FROM shipment_items WHERE shipment_id IN ('+shipIds.map(()=>'?').join(',')+')', shipIds) : [];
  o.shipments  = shipRows.map(s=>({...s, items: shipItemRows.filter(i=>i.shipment_id===s.id)}));
  o.grnRecords = await allAsync('SELECT * FROM grn_records WHERE order_id=? ORDER BY recorded_at', [o.id]);
  return o;
}

async function assembleEnquiry(enq) {
  const e = { ...enq };
  e.items   = await allAsync('SELECT * FROM enquiry_items WHERE enquiry_id=? ORDER BY sort_order', [e.id]);
  e.sourcing= await allAsync('SELECT * FROM enquiry_sourcing WHERE enquiry_id=?', [e.id]);
  e.history = await allAsync('SELECT * FROM enquiry_history WHERE enquiry_id=? ORDER BY ts DESC', [e.id]);
  if (e.charges && typeof e.charges === 'string') {
    try { e.charges = JSON.parse(e.charges); } catch(_) { e.charges = null; }
  }
  // Merge trail — absorbed_from lists enquiries folded into this one (still visible,
  // marked merged); merged_into (a plain column) points the other direction.
  e.absorbed_from = await allAsync('SELECT absorbed_id, merged_by, merged_at FROM enquiry_merges WHERE survivor_id=?', [e.id]);
  return e;
}

// ── Schema ────────────────────────────────────────────────────────────────────
async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL,
      email TEXT, password TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT 'sales',
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS section_permissions (
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      section_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT DEFAULT '',
      PRIMARY KEY (role, department, section_key)
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, email TEXT,
      phone TEXT, city TEXT, state TEXT, country TEXT DEFAULT 'India',
      gstin TEXT, status TEXT DEFAULT 'active', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS linecards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      description TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'domestic',
      contact TEXT, email TEXT, phone TEXT, website TEXT,
      city TEXT, state TEXT, country TEXT DEFAULT 'India', gstin TEXT,
      payment_terms TEXT DEFAULT 'Net 30', currency TEXT DEFAULT 'INR',
      payment_terms_type TEXT DEFAULT 'net',
      payment_net_days INTEGER DEFAULT 30,
      payment_advance_pct INTEGER DEFAULT 0,
      bank_name TEXT, bank_account TEXT, bank_ifsc TEXT, bank_swift TEXT,
      status TEXT DEFAULT 'active', notes TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplier_linecards (
      supplier_id TEXT NOT NULL, linecard_id TEXT NOT NULL,
      PRIMARY KEY (supplier_id, linecard_id)
    );
    CREATE TABLE IF NOT EXISTS quote_history (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, action TEXT NOT NULL,
      by_user TEXT, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shippers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'international',
      tracking_url TEXT, status TEXT DEFAULT 'active', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS app_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      size_bytes BIGINT DEFAULT 0,
      storage_provider TEXT NOT NULL DEFAULT 'azure',
      container_name TEXT NOT NULL,
      blob_name TEXT NOT NULL,
      entity_type TEXT DEFAULT '',
      entity_id TEXT DEFAULT '',
      field_name TEXT DEFAULT '',
      uploaded_by TEXT DEFAULT '',
      uploaded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_queue (
      id TEXT PRIMARY KEY, supplier_order_id TEXT NOT NULL, order_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL, amount NUMERIC, currency TEXT DEFAULT 'INR',
      payment_terms TEXT, due_date TEXT, status TEXT DEFAULT 'pending',
      payment_ref TEXT, payment_date TEXT, paid_amount NUMERIC,
      paid_by TEXT, notes TEXT, created_at TEXT, paid_at TEXT
    );
    CREATE TABLE IF NOT EXISTS po_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'standard',
      is_default INTEGER DEFAULT 0, config TEXT NOT NULL, created_at TEXT
    );
    -- ── Finance: customer payment receipts ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS customer_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      customer_po_no TEXT DEFAULT '',
      finance_po_no TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      pi_sent_at TEXT DEFAULT '',
      payment_type TEXT DEFAULT 'advance',
      amount NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      payment_method TEXT DEFAULT '',
      payment_ref TEXT DEFAULT '',
      payment_date TEXT DEFAULT '',
      advance_pct NUMERIC DEFAULT 0,
      balance_due NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending',
      recorded_by TEXT DEFAULT '',
      recorded_at TEXT NOT NULL,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS po_requests (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      supplier_order_id TEXT DEFAULT '',
      supplier_id TEXT NOT NULL,
      supplier_name TEXT DEFAULT '',
      order_ref TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      requested_by TEXT DEFAULT '',
      requested_at TEXT NOT NULL,
      notes TEXT DEFAULT '',
      fulfilled_by TEXT DEFAULT '',
      fulfilled_at TEXT DEFAULT '',
      supplier_ref TEXT DEFAULT '',
      zoho_po_number TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, created_by TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL DEFAULT 'new',
      priority TEXT DEFAULT 'normal', notes TEXT,
      sourcing_no TEXT DEFAULT '',
      buying_type TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiry_items (
      id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL, component TEXT NOT NULL,
      linecard_id TEXT, ipn TEXT, manufacturer TEXT,
      target_price NUMERIC, target_currency TEXT DEFAULT 'INR',
      quantity INTEGER DEFAULT 0, preferred_delivery_date TEXT,
      date_code TEXT, sort_order INTEGER DEFAULT 0, tax_rate NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS enquiry_sourcing (
      id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL,
      enquiry_item_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
      sourced_price NUMERIC, sourced_currency TEXT DEFAULT 'INR',
      availability TEXT, lead_time TEXT, notes TEXT,
      item_status TEXT DEFAULT 'ready',
      sent_to_enquiry INTEGER DEFAULT 0, sent_to_enquiry_note TEXT DEFAULT NULL,
      quote_price NUMERIC, quote_currency TEXT DEFAULT 'INR',
      updated_by TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiry_history (
      id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL,
      action TEXT NOT NULL, by_user TEXT, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiry_merges (
      id TEXT PRIMARY KEY, survivor_id TEXT NOT NULL, absorbed_id TEXT NOT NULL,
      merged_by TEXT, merged_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quote_history (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL,
      action TEXT NOT NULL, by_user TEXT, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY, enquiry_id TEXT, customer_id TEXT NOT NULL,
      quote_no TEXT UNIQUE NOT NULL, zoho_quote_no TEXT, file_ref TEXT,
      status TEXT DEFAULT 'draft', valid_until TEXT, created_by TEXT,
      created_at TEXT NOT NULL, notes TEXT,
      parent_quote_id TEXT DEFAULT NULL,
      revision INTEGER DEFAULT 1,
      customer_response TEXT DEFAULT NULL,
      customer_response_date TEXT DEFAULT NULL,
      customer_response_notes TEXT DEFAULT NULL,
      customer_response_by TEXT DEFAULT NULL,
      sales_revision_notes TEXT DEFAULT NULL,
      sent_to_customer INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, customer_ref TEXT, customer_id TEXT NOT NULL,
      enquiry_id TEXT, quote_id TEXT, po_number TEXT, po_file_ref TEXT,
      enquiry_no TEXT, quote_no TEXT, tentative_date TEXT,
      finance_po_no TEXT DEFAULT '',
      po_generated_at TEXT DEFAULT '',
      status TEXT DEFAULT 'open', created_by TEXT,
      created_at TEXT NOT NULL, closed_at TEXT, notes TEXT,
      delivery_address TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, component TEXT NOT NULL,
      manufacturer TEXT, ipn TEXT, qty INTEGER DEFAULT 0,
      unit_price NUMERIC DEFAULT 0, procurement_price NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'INR', order_date TEXT, delivery_date TEXT,
      supplier_id TEXT, line_status TEXT DEFAULT 'negotiating',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS supplier_orders (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
      po_no TEXT,
      internal_po_no TEXT,
      status TEXT DEFAULT 'draft',
      confirmed_price NUMERIC,
      confirmed_currency TEXT DEFAULT 'INR',
      promised_delivery_date TEXT,
      supplier_ref TEXT,
      shipping_status TEXT DEFAULT 'pending',
      shipper_id TEXT, tracking_no TEXT,
      credit_note_no TEXT DEFAULT '',
      credit_note_amount NUMERIC DEFAULT NULL,
      credit_note_date TEXT DEFAULT '',
      notes TEXT,
      created_at TEXT,
      confirmed_at TEXT,
      received_at TEXT
    );
    CREATE TABLE IF NOT EXISTS supplier_order_items (
      supplier_order_id TEXT NOT NULL, item_id TEXT NOT NULL,
      PRIMARY KEY (supplier_order_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS customer_shipping (
      order_id TEXT PRIMARY KEY, status TEXT DEFAULT 'pending',
      shipper_id TEXT, tracking_no TEXT, delivery_date TEXT, comments TEXT
    );
    CREATE TABLE IF NOT EXISTS order_documents (
      order_id TEXT PRIMARY KEY, delivery_slip TEXT, packing_list TEXT,
      invoice TEXT, eway_bill TEXT, po_file TEXT, comments TEXT
    );
    CREATE TABLE IF NOT EXISTS order_history (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
      action TEXT NOT NULL, by_user TEXT, comment TEXT, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, entity_type TEXT NOT NULL,
      steps TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      current_step INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
      requested_by TEXT NOT NULL, requested_at TEXT NOT NULL,
      resolved_at TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS approval_actions (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, step INTEGER NOT NULL,
      action TEXT NOT NULL, by_user TEXT NOT NULL, comment TEXT, ts TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grn_records (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_item_id TEXT NOT NULL,
      supplier_id TEXT DEFAULT '', coo TEXT DEFAULT '', date_code TEXT DEFAULT '',
      lot_number TEXT DEFAULT '', weight_kg NUMERIC, qty_received INTEGER DEFAULT 0,
      condition TEXT DEFAULT 'good', arrived_date TEXT DEFAULT '',
      notes TEXT DEFAULT '', recorded_by TEXT, recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_cost_audits (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL, submitted_at TEXT, submitted_by TEXT
    );

    CREATE TABLE IF NOT EXISTS order_cost_audit_items (
      id TEXT PRIMARY KEY, audit_id TEXT NOT NULL, order_id TEXT NOT NULL,
      supplier_order_id TEXT, supplier_id TEXT, supplier_name TEXT, scope TEXT DEFAULT 'domestic',
      customer_total NUMERIC DEFAULT 0,
      est_material NUMERIC DEFAULT 0, est_freight NUMERIC DEFAULT 0, est_insurance NUMERIC DEFAULT 0,
      est_bcd NUMERIC DEFAULT 0, est_sws NUMERIC DEFAULT 0, est_cess NUMERIC DEFAULT 0, est_bank NUMERIC DEFAULT 0,
      est_clearing NUMERIC DEFAULT 0, est_margin NUMERIC DEFAULT 0,
      -- Sourcing's own named charges (entered in Sourcing Bin at pricing time).
      est_extra_charges NUMERIC DEFAULT 0, est_extra_charges_detail TEXT DEFAULT NULL,
      -- Finance's actual-paid ad-hoc charges (entered during payment processing)
      -- — kept separate from Sourcing's, never blended: one is an estimate-time
      -- guess, the other is real money that has actually moved.
      est_finance_charges NUMERIC DEFAULT 0, est_finance_charges_detail TEXT DEFAULT NULL,
      est_total NUMERIC DEFAULT 0,
      act_material NUMERIC, act_freight NUMERIC, act_insurance NUMERIC,
      act_bcd NUMERIC, act_sws NUMERIC, act_cess NUMERIC, act_bank NUMERIC,
      act_clearing NUMERIC, act_margin NUMERIC, act_extra_charges NUMERIC,
      act_extra_charges_detail TEXT DEFAULT NULL, act_field_modes TEXT DEFAULT NULL, act_total NUMERIC,
      notes TEXT DEFAULT '', updated_by TEXT, updated_at TEXT
    );

    -- Per-line-item Estimate detail — mirrors Sourcing exactly: same field, same
    -- %/₹ mode, same raw value, plus the computed ₹ amount for this item's qty.
    -- One row per (audit_item, component) so a PO that bundles several enquiry
    -- items shows each one's own pricing basis, not a blended average.
    CREATE TABLE IF NOT EXISTS order_cost_audit_item_lines (
      id TEXT PRIMARY KEY, audit_item_id TEXT NOT NULL,
      component TEXT, manufacturer TEXT, qty NUMERIC DEFAULT 0,
      supplier_id TEXT, scope TEXT DEFAULT 'domestic',
      unit_price NUMERIC DEFAULT 0, sourced_currency TEXT DEFAULT 'INR',
      field_modes TEXT DEFAULT NULL,
      -- Raw values exactly as Sourcing stored them (a % value when mode='pct',
      -- otherwise a flat ₹ amount) — for display, matching Sourcing's own UI.
      freight_raw NUMERIC, insurance_raw NUMERIC, bcd_raw NUMERIC, sws_raw NUMERIC,
      cess_raw NUMERIC, bank_raw NUMERIC, clearing_raw NUMERIC, margin_raw NUMERIC,
      -- Computed ₹ amounts for this line's qty (what actually adds up into the
      -- audit item's aggregated est_* totals).
      freight_inr NUMERIC DEFAULT 0, insurance_inr NUMERIC DEFAULT 0, bcd_inr NUMERIC DEFAULT 0,
      sws_inr NUMERIC DEFAULT 0, cess_inr NUMERIC DEFAULT 0, bank_inr NUMERIC DEFAULT 0,
      clearing_inr NUMERIC DEFAULT 0, margin_inr NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, shipment_no INTEGER DEFAULT 1,
      type TEXT DEFAULT 'full', status TEXT DEFAULT 'preparing',
      shipper_id TEXT, tracking_no TEXT DEFAULT '', invoice_ref TEXT DEFAULT '',
      invoice_file TEXT DEFAULT '', eway_bill TEXT DEFAULT '',
      delivery_slip TEXT DEFAULT '', packing_list TEXT DEFAULT '',
      pod_ref TEXT DEFAULT '', dispatched_at TEXT, delivered_at TEXT,
      notes TEXT DEFAULT '', created_by TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipment_items (
      id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL, qty_shipped INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_inventory (
      id TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      ipn TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      linecard_id TEXT DEFAULT NULL,
      date_code TEXT DEFAULT '',
      quantity_total INTEGER DEFAULT 0,
      quantity_available INTEGER DEFAULT 0,
      target_currency TEXT DEFAULT 'INR',
      target_price NUMERIC DEFAULT NULL,
      holder_type TEXT DEFAULT 'warehouse',
      holder_id TEXT DEFAULT '',
      holder_name TEXT DEFAULT '',
      reference_order_id TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_by TEXT DEFAULT '',
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tax_rates (
      currency TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      region TEXT NOT NULL,
      rates TEXT NOT NULL,
      vat_label TEXT NOT NULL DEFAULT 'VAT',
      updated_at TEXT NOT NULL
    );
    -- Soft-delete snapshot store. Each row is one "Delete All <section>" batch.
    -- payload holds { tableName: [rows...] } so a Restore re-inserts everything.
    CREATE TABLE IF NOT EXISTS deleted_bin (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      label TEXT NOT NULL,
      payload JSONB NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      deleted_by TEXT DEFAULT '',
      deleted_at TEXT NOT NULL
    );
    -- Permanent audit log of every delete / restore / purge. Survives restore & purge.
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,            -- delete | restore | purge | master_delete
      area TEXT NOT NULL,              -- danger | recycle
      module TEXT DEFAULT '',          -- orders / users / customers / master ...
      label TEXT DEFAULT '',
      entity_type TEXT DEFAULT '',     -- user | customer | supplier | section | master
      entity_id TEXT DEFAULT '',
      entity_name TEXT DEFAULT '',
      entity_email TEXT DEFAULT '',
      entity_username TEXT DEFAULT '',
      row_count INTEGER DEFAULT 0,
      performed_by TEXT DEFAULT '',
      performed_by_name TEXT DEFAULT '',
      performed_at TEXT NOT NULL       -- full timestamp incl. seconds
    );
    CREATE TABLE IF NOT EXISTS rfq_lines (
      id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL, enquiry_item_id TEXT NOT NULL,
      customer_id TEXT NOT NULL, assigned_to TEXT, component TEXT DEFAULT '',
      ipn TEXT DEFAULT '', manufacturer TEXT DEFAULT '', date_code TEXT DEFAULT '',
      quantity NUMERIC DEFAULT 0, target_price NUMERIC, target_currency TEXT DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'open', awarded_supplier_id TEXT DEFAULT '',
      awarded_at TEXT DEFAULT '', notes TEXT DEFAULT '', comparison_completed_at TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rfq_quotes (
      id TEXT PRIMARY KEY, rfq_line_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
      price NUMERIC, currency TEXT DEFAULT 'INR', available_qty NUMERIC, lead_days NUMERIC,
      notes TEXT DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rfq_award_snapshots (
      id TEXT PRIMARY KEY, rfq_line_id TEXT NOT NULL, version INTEGER DEFAULT 1,
      kind TEXT DEFAULT 'saved', comparison_currency TEXT NOT NULL, comparison_mode TEXT DEFAULT 'price',
      awarded_supplier_id TEXT, fx_rates_used JSONB NOT NULL, quotes_snapshot JSONB NOT NULL,
      computed_results JSONB NOT NULL, created_by TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fx_rates (
      id TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
      rate NUMERIC NOT NULL, rate_date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'frankfurter.app',
      fetched_at TEXT NOT NULL, fetched_by TEXT
    );
    ALTER TABLE rfq_lines ADD COLUMN IF NOT EXISTS comparison_completed_at TEXT DEFAULT '';
  `);
}



// ── initDb ────────────────────────────────────────────────────────────────────
async function initDb() {
  try {
    await pool.query('SELECT 1');
    console.log('  PostgreSQL connected ✓');
  } catch (err) {
    console.error('\n  ✗  Cannot connect to PostgreSQL!');
    console.error(`     ${err.message}`);
    console.error('     Check PG_HOST / PG_USER / PG_PASSWORD / PG_DB env vars.\n');
    throw err;
  }
  console.log('[DB] Creating schema...');
  try {
    await createSchema();
    console.log('[DB] Schema done');
  } catch(err) {
    console.error('[DB] createSchema FAILED:', err.message);
    throw err;
  }
  // ── Migrate customers table — add extended fields if missing ──────────────
  const customerCols = [
    ['customer_type',     'TEXT DEFAULT \'business\''],
    ['salutation',        'TEXT DEFAULT \'\''],
    ['first_name',        'TEXT DEFAULT \'\''],
    ['last_name',         'TEXT DEFAULT \'\''],
    ['mobile',            'TEXT DEFAULT \'\''],
    ['pan',               'TEXT DEFAULT \'\''],
    ['gstin_type',        'TEXT DEFAULT \'regular\''],
    ['place_of_supply',   'TEXT DEFAULT \'\''],
    ['payment_terms',     'TEXT DEFAULT \'\''],
    ['currency',          'TEXT DEFAULT \'INR\''],
    ['customer_scope',    'TEXT DEFAULT \'domestic\''],
    ['billing_attention', 'TEXT DEFAULT \'\''],
    ['billing_street1',   'TEXT DEFAULT \'\''],
    ['billing_street2',   'TEXT DEFAULT \'\''],
    ['billing_pincode',   'TEXT DEFAULT \'\''],
    ['billing_phone',     'TEXT DEFAULT \'\''],
    ['shipping_attention','TEXT DEFAULT \'\''],
    ['shipping_street1',  'TEXT DEFAULT \'\''],
    ['shipping_street2',  'TEXT DEFAULT \'\''],
    ['shipping_city',     'TEXT DEFAULT \'\''],
    ['shipping_state',    'TEXT DEFAULT \'\''],
    ['shipping_country',  'TEXT DEFAULT \'India\''],
    ['shipping_pincode',  'TEXT DEFAULT \'\''],
    ['shipping_phone',    'TEXT DEFAULT \'\''],
    ['bank_account_name', 'TEXT DEFAULT \'\''],
    ['bank_account_no',   'TEXT DEFAULT \'\''],
    ['bank_ifsc',         'TEXT DEFAULT \'\''],
    ['bank_name',         'TEXT DEFAULT \'\''],
    ['bank_branch',       'TEXT DEFAULT \'\''],
    ['bank_swift',        'TEXT DEFAULT \'\''],
    ['bank_iban',         'TEXT DEFAULT \'\''],
    ['bank_aba',          'TEXT DEFAULT \'\''],
    ['bank_country',      'TEXT DEFAULT \'\''],
    ['bank_currency',     'TEXT DEFAULT \'INR\''],
    ['contact_persons',   'TEXT DEFAULT \'[]\''],
    ['remarks',           'TEXT DEFAULT \'\''],
    ['customer_no',       'TEXT DEFAULT \'\''],
    ['vat_number',        'TEXT DEFAULT \'\''],
    ['shipping_addresses','TEXT DEFAULT \'[]\''],
    ['billing_city',      'TEXT DEFAULT \'\''],
    ['billing_state',     'TEXT DEFAULT \'\''],
    ['billing_country',   'TEXT DEFAULT \'India\''],
  ];
  for (const [col, def] of customerCols) {
    try {
      await pool.query('ALTER TABLE customers ADD COLUMN ' + col + ' ' + def);
    } catch (_) { /* column already exists — ignore */ }
  }
  // ── Migrate suppliers table — add extended fields ─────────────────────────
  const supplierCols = [
    ['supplier_no',          'TEXT DEFAULT \'\''],
    ['salutation',           'TEXT DEFAULT \'\''],
    ['first_name',           'TEXT DEFAULT \'\''],
    ['last_name',            'TEXT DEFAULT \'\''],
    ['mobile',               'TEXT DEFAULT \'\''],
    ['pan',                  'TEXT DEFAULT \'\''],
    ['gstin_type',           'TEXT DEFAULT \'regular\''],
    ['vat_number',           'TEXT DEFAULT \'\''],
    ['place_of_supply',      'TEXT DEFAULT \'\''],
    ['billing_attention',    'TEXT DEFAULT \'\''],
    ['billing_street1',      'TEXT DEFAULT \'\''],
    ['billing_street2',      'TEXT DEFAULT \'\''],
    ['billing_city',         'TEXT DEFAULT \'\''],
    ['billing_state',        'TEXT DEFAULT \'\''],
    ['billing_country',      'TEXT DEFAULT \'India\''],
    ['billing_pincode',      'TEXT DEFAULT \'\''],
    ['billing_phone',        'TEXT DEFAULT \'\''],
    ['shipping_addresses',   'TEXT DEFAULT \'[]\''],
    ['bank_account_name',    'TEXT DEFAULT \'\''],
    ['bank_account_no',      'TEXT DEFAULT \'\''],
    ['bank_ifsc',            'TEXT DEFAULT \'\''],
    ['bank_name',            'TEXT DEFAULT \'\''],
    ['bank_branch',          'TEXT DEFAULT \'\''],
    ['bank_swift',           'TEXT DEFAULT \'\''],
    ['bank_iban',            'TEXT DEFAULT \'\''],
    ['bank_aba',             'TEXT DEFAULT \'\''],
    ['bank_country',         'TEXT DEFAULT \'India\''],
    ['bank_currency',        'TEXT DEFAULT \'INR\''],
    ['contact_persons',      'TEXT DEFAULT \'[]\''],
    ['remarks',              'TEXT DEFAULT \'\''],
  ];
  for (const [col, def] of supplierCols) {
    try {
      await pool.query('ALTER TABLE suppliers ADD COLUMN ' + col + ' ' + def);
    } catch (_) { /* column already exists — ignore */ }
  }
  // ── Migrate enquiries — add sourcing_no / buying_type ───────────────────────
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN sourcing_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN buying_type TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN charges TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN existing_order_id TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN send_to_enq_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN modify_reason TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN shipping_type TEXT DEFAULT 'DDP'"); } catch(_) {}
  // Tags the absorbed side of a merge so it stays visible but traceable forward.
  try { await pool.query("ALTER TABLE enquiries ADD COLUMN merged_into TEXT DEFAULT NULL"); } catch(_) {}
  // Tags a line item created by splitting one enquiry item across multiple
  // suppliers, mirroring order_items.split_from_item_id at the Procurement stage.
  try { await pool.query("ALTER TABLE enquiry_items ADD COLUMN split_from_item_id TEXT DEFAULT NULL"); } catch(_) {}
  // Free-form named charges (e.g. "Customs Inspection Fee") added on top of an
  // international sourcing row's landed cost — JSON array of {name, amount}.
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN extra_charges TEXT DEFAULT NULL"); } catch(_) {}
  // Audit Bin — Estimate side snapshots Sourcing's named extra charges (the fix
  // for the estimate/sourcing total mismatch); Actual side gets its own
  // independently-entered named charges plus %/₹ mode memory per field, mirroring
  // Sourcing's calcLanded() so a % entry computes the same way in both places.
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN est_extra_charges NUMERIC DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN est_extra_charges_detail TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN act_extra_charges NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN act_extra_charges_detail TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN act_field_modes TEXT DEFAULT NULL"); } catch(_) {}
  // Finance's actual-paid ad-hoc charges, kept separate from Sourcing's own —
  // never blended into one guess.
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN est_finance_charges NUMERIC DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audit_items ADD COLUMN est_finance_charges_detail TEXT DEFAULT NULL"); } catch(_) {}
  // Manual override for Customer Paid / Supplier Paid shown in Audit Bin — these
  // two figures are normally computed live by summing customer_payments and
  // finance_queue, but that sum can be missing/wrong (payment recorded outside
  // Finance's normal flow, older data, etc.). When set, the override is what's
  // shown instead of the computed sum; NULL means "use the computed total" —
  // this never touches the real Finance payment records.
  try { await pool.query("ALTER TABLE order_cost_audits ADD COLUMN customer_paid_override NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE order_cost_audits ADD COLUMN supplier_paid_override NUMERIC DEFAULT NULL"); } catch(_) {}
  // Per-line-item Estimate detail mirroring Sourcing exactly (see schema comment
  // on order_cost_audit_item_lines above).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_cost_audit_item_lines (
        id TEXT PRIMARY KEY, audit_item_id TEXT NOT NULL,
        component TEXT, manufacturer TEXT, qty NUMERIC DEFAULT 0,
        supplier_id TEXT, scope TEXT DEFAULT 'domestic',
        unit_price NUMERIC DEFAULT 0, sourced_currency TEXT DEFAULT 'INR',
        field_modes TEXT DEFAULT NULL,
        freight_raw NUMERIC, insurance_raw NUMERIC, bcd_raw NUMERIC, sws_raw NUMERIC,
        cess_raw NUMERIC, bank_raw NUMERIC, clearing_raw NUMERIC, margin_raw NUMERIC,
        freight_inr NUMERIC DEFAULT 0, insurance_inr NUMERIC DEFAULT 0, bcd_inr NUMERIC DEFAULT 0,
        sws_inr NUMERIC DEFAULT 0, cess_inr NUMERIC DEFAULT 0, bank_inr NUMERIC DEFAULT 0,
        clearing_inr NUMERIC DEFAULT 0, margin_inr NUMERIC DEFAULT 0
      );
    `);
  } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN tax_rate NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN item_status TEXT DEFAULT 'ready'"); } catch(_) {}
  // ── Migrate quotes — add approval tracking + revision columns ───────────────
  try { await pool.query("ALTER TABLE quotes ADD COLUMN parent_quote_id TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN revision INTEGER DEFAULT 1"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN customer_response TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN customer_response_date TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN customer_response_notes TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN customer_response_by TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN sales_revision_notes TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN sent_to_customer INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN existing_order_id TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE quotes ADD COLUMN updated_at TEXT DEFAULT NULL"); } catch(_) {}
  // Additional Charges — same free-form name+amount list Sourcing uses, but
  // scoped to this quote's own customer-facing total (not the Sourcing estimate).
  try { await pool.query("ALTER TABLE quotes ADD COLUMN additional_charges TEXT DEFAULT NULL"); } catch(_) {}
  // Per-quote-only item removal — hides an enquiry_item from THIS quote's line
  // items list without touching the underlying enquiry/sourcing data, since
  // items are shared live across every quote revision for the same enquiry.
  try { await pool.query("ALTER TABLE quotes ADD COLUMN excluded_item_ids TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN sourcing_revision_notes TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN sales_comment TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN exchange_rate NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN src_price_foreign NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN hsn_code TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN freight_pct NUMERIC DEFAULT 20"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN insurance_pct NUMERIC DEFAULT 1.125"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN duty_pct NUMERIC DEFAULT 7.5"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN cess_pct NUMERIC DEFAULT 10"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN bank_fixed_usd NUMERIC DEFAULT 15"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN clearance_fixed_inr NUMERIC DEFAULT 1800"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN margin_pct NUMERIC DEFAULT 15"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN freight_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN insurance_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN duty_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN cess_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN bank_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN clearance_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN margin_inr NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN field_modes TEXT DEFAULT NULL"); } catch(_) {}
  // ── Migrate users — add plain_password for admin visibility ─────────────────
  try { await pool.query("ALTER TABLE users ADD COLUMN plain_password TEXT DEFAULT ''"); } catch(_) {}
  // ── Migrate supplier_orders — add PO workflow columns ─────────────────────
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN internal_po_no TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN status TEXT DEFAULT 'draft'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN confirmed_price NUMERIC"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN confirmed_currency TEXT DEFAULT 'INR'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN promised_delivery_date TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_ref TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN notes TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN created_at TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN confirmed_at TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN received_at TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN payment_terms_type TEXT DEFAULT 'net'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN payment_net_days INTEGER DEFAULT 30"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN payment_advance_pct INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN payment_due_date TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN zoho_po_number TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN payment_blocked INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN buying_price_per_unit NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_subtotal NUMERIC DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_tax_rate NUMERIC DEFAULT 18"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ALTER COLUMN supplier_tax_rate SET DEFAULT 18"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_tax_amount NUMERIC DEFAULT 0"); } catch(_) {}
  try { await pool.query("UPDATE supplier_orders so SET supplier_tax_rate=0 FROM suppliers s WHERE s.id=so.supplier_id AND LOWER(COALESCE(s.type,''))='international'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN ship_load_date TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN actual_delivery_date TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN credit_note_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN credit_note_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN credit_note_date TEXT DEFAULT ''"); } catch(_) {}
  // ── Migrate orders — add delivery_address ────────────────────────────────────
  try { await pool.query("ALTER TABLE orders ADD COLUMN delivery_address TEXT DEFAULT ''"); } catch(_) {}
  // ── Ensure delivery_hub is a valid order status (no enum constraint in SQLite/PG, just docs) ──
  // order_items line_status valid values: negotiating, procurement, payment, shipped,
  // delivered_hub, ready_to_ship, grn_partial, grn_rejected, delivered

  // ── Backfill supplier PO totals from linked item source costs (legacy data repair) ──
  try {
    const poTotals = await pool.query(`
      SELECT
        so.id, so.supplier_tax_rate,
        ROUND(COALESCE(SUM(
          COALESCE(
            NULLIF(oi.procurement_price, 0),
            NULLIF(so.buying_price_per_unit, 0),
            NULLIF(src.sourced_price, 0),
            0
          ) * COALESCE(oi.qty, 0)
        ), 0)::numeric, 2) AS source_total
      FROM supplier_orders so
      JOIN orders o ON o.id = so.order_id
      LEFT JOIN supplier_order_items soi ON soi.supplier_order_id = so.id
      LEFT JOIN order_items oi ON oi.id = soi.item_id
      LEFT JOIN LATERAL (
        SELECT es.sourced_price
        FROM enquiry_items ei
        JOIN enquiry_sourcing es ON es.enquiry_item_id = ei.id
          AND es.enquiry_id = o.enquiry_id
        WHERE ei.enquiry_id = o.enquiry_id
          AND (
            ei.id = oi.id
            OR LOWER(COALESCE(ei.component, '')) = LOWER(COALESCE(oi.component, ''))
            OR (
              COALESCE(ei.ipn, '') <> ''
              AND COALESCE(oi.ipn, '') <> ''
              AND LOWER(ei.ipn) = LOWER(oi.ipn)
            )
          )
        -- Prefer a price quoted by the currently assigned supplier. If the item
        -- was reassigned and that supplier has no sourcing row, retain the
        -- original sourced price so the component is not dropped from PO totals.
        ORDER BY (es.supplier_id = so.supplier_id) DESC, es.updated_at DESC
        LIMIT 1
      ) src ON true
      GROUP BY so.id, so.supplier_tax_rate
    `);
    let repaired = 0;
    for (const row of poTotals.rows) {
      const sourceTotal = Number(row.source_total || 0);
      if (sourceTotal <= 0) continue;
      const taxRate = Number(row.supplier_tax_rate || 0);
      const taxAmount = Number((sourceTotal * taxRate / 100).toFixed(2));
      const payableTotal = Number((sourceTotal + taxAmount).toFixed(2));
      await pool.query(
        "UPDATE supplier_orders SET supplier_subtotal=$1,supplier_tax_amount=$2,confirmed_price=$3,confirmed_currency='INR' WHERE id=$4",
        [sourceTotal, taxAmount, payableTotal, row.id]
      );
      await pool.query(
        "UPDATE finance_queue SET amount=$1, currency='INR' WHERE supplier_order_id=$2",
        [payableTotal, row.id]
      );
      repaired++;
    }
    if (repaired > 0) {
      console.log('[db] Repaired supplier PO totals for ' + repaired + ' supplier orders');
    }
  } catch(e) { console.error('[db] Supplier PO total backfill error:', e.message); }

  // ── Backfill: create finance_queue entries for any blocked POs that have no queue entry ──
  try {
    const blockedPOs = await pool.query(
      "SELECT so.* FROM supplier_orders so " +
      "WHERE so.payment_blocked = 1 " +
      "AND NOT EXISTS (SELECT 1 FROM finance_queue fq WHERE fq.supplier_order_id = so.id)"
    );
    for (const po of blockedPOs.rows) {
      // Use timestamp + random suffix for unique ID
      const fqId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const advPct = po.payment_advance_pct || 100;
      await pool.query(
        "INSERT INTO finance_queue(id,supplier_order_id,order_id,supplier_id,amount,currency,payment_terms,due_date,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [fqId, po.id, po.order_id, po.supplier_id,
         po.confirmed_price || 0,
         po.confirmed_currency || 'INR',
         advPct + '% Advance required',
         '', 'pending',
         new Date().toISOString()]
      );
    }
    if (blockedPOs.rows.length > 0) {
      console.log('[db] Backfilled ' + blockedPOs.rows.length + ' finance queue entries for blocked POs');
    }
  } catch(e) { console.error('[db] Finance queue backfill error:', e.message); }
  // ── Migrate suppliers — add payment/bank columns ──────────────────────────
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN payment_terms_type TEXT DEFAULT 'net'"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN payment_net_days INTEGER DEFAULT 30"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN payment_advance_pct INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN bank_name TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN bank_account TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN bank_ifsc TEXT"); } catch(_) {}
  try { await pool.query("ALTER TABLE suppliers ADD COLUMN bank_swift TEXT"); } catch(_) {}
  // ── Backfill payment_terms_type from payment_terms text for all existing suppliers ──
  try {
    const sups = await pool.query("SELECT id, payment_terms FROM suppliers WHERE payment_terms_type IS NULL OR payment_terms_type = ''");
    for (const row of sups.rows) {
      const t = (row.payment_terms||'').toLowerCase();
      let type='net', days=30, pct=0;
      if (t.includes('advance')||t.includes('prepay')||t.includes('before shipment')||t.includes('cash in advance')||t.includes('cbs')) {
        const pm = t.match(/(\d+)%.*upfront|upfront.*?(\d+)%/);
        if (pm) { type='split'; days=0; pct=parseInt(pm[1]||pm[2]); }
        else { type='advance'; days=0; pct=100; }
      } else {
        const nm = t.match(/net\s*(\d+)/);
        if (nm) days=parseInt(nm[1]);
      }
      await pool.query(
        "UPDATE suppliers SET payment_terms_type=$1,payment_net_days=$2,payment_advance_pct=$3 WHERE id=$4",
        [type, days, pct, row.id]
      );
    }
  } catch(_) {}
  // ── Backfill payment_terms_type on existing supplier_orders from their supplier's current terms ──
  try {
    const sos = await pool.query(
      "SELECT so.id, s.payment_terms_type, s.payment_net_days, s.payment_advance_pct " +
      "FROM supplier_orders so " +
      "JOIN suppliers s ON so.supplier_id = s.id " +
      "WHERE so.payment_terms_type IS NULL OR so.payment_terms_type = '' OR so.payment_terms_type = 'net'"
    );
    for (const row of sos.rows) {
      if (!row.payment_terms_type || row.payment_terms_type === 'net') {
        // Only update if supplier has non-net terms (don't overwrite confirmed POs)
        if (row.payment_terms_type && row.payment_terms_type !== 'net') {
          await pool.query(
            "UPDATE supplier_orders SET payment_terms_type=$1, payment_net_days=$2, payment_advance_pct=$3 WHERE id=$4",
            [row.payment_terms_type, row.payment_net_days||30, row.payment_advance_pct||0, row.id]
          );
        }
      }
    }
    // Force-update ALL draft supplier_orders to match current supplier terms
    const draftSOs = await pool.query(
      "SELECT so.id, s.payment_terms_type, s.payment_net_days, s.payment_advance_pct, s.id as sup_id " +
      "FROM supplier_orders so " +
      "JOIN suppliers s ON so.supplier_id = s.id " +
      "WHERE so.status = 'draft'"
    );
    for (const row of draftSOs.rows) {
      await pool.query(
        "UPDATE supplier_orders SET payment_terms_type=$1, payment_net_days=$2, payment_advance_pct=$3 WHERE id=$4",
        [row.payment_terms_type||'net', row.payment_net_days||30, row.payment_advance_pct||0, row.id]
      );
    }
  } catch(_) {}
  // ── Migrate stock_inventory table ─────────────────────────────────────────────
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN linecard_id TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN ipn TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN date_code TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN quantity_total INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN quantity_available INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN target_currency TEXT DEFAULT 'INR'"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN target_price NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN holder_type TEXT DEFAULT 'warehouse'"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN holder_id TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN holder_name TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN reference_order_id TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN notes TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE stock_inventory ADD COLUMN added_by TEXT DEFAULT ''"); } catch(_) {}
  // ── Migrate enquiry_items — add tax_rate ────────────────────────────────────
  try { await pool.query("ALTER TABLE enquiry_items ADD COLUMN tax_rate NUMERIC DEFAULT 0"); } catch(_) {}
  // ── Migrate order_items — add tax_rate so it flows from sourcing through every stage ──
  try { await pool.query("ALTER TABLE order_items ADD COLUMN tax_rate NUMERIC DEFAULT 0"); } catch(_) {}
  // ── Migrate order_items — tag rows created by the Procurement split feature ──
  try { await pool.query("ALTER TABLE order_items ADD COLUMN split_from_item_id TEXT DEFAULT NULL"); } catch(_) {}
  // ── Migrate customers + orders — shipment preference ──────────────────────
  try { await pool.query("ALTER TABLE customers ADD COLUMN allow_partial_shipment INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE customers ADD COLUMN shipment_notes TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN allow_partial_shipment INTEGER DEFAULT 0"); } catch(_) {}
  // ── Migrate enquiry_sourcing — add quote_price / quote_currency ───────────
  for (const [col, def] of [['quote_price','NUMERIC'],['quote_currency',"TEXT DEFAULT 'INR'"]]) {
    try { await pool.query('ALTER TABLE enquiry_sourcing ADD COLUMN ' + col + ' ' + def); } catch(_) {}
  }
  // ── Finance: customer_payments table migration ──────────────────────────────
  try { await pool.query("ALTER TABLE orders ADD COLUMN pi_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN pi_sent_at TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN finance_po_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN po_generated_at TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE customer_payments ADD COLUMN customer_po_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE customer_payments ADD COLUMN finance_po_no TEXT DEFAULT ''"); } catch(_) {}
  // ── Finance: additional-charges columns (must exist at startup so /finance/history never breaks) ──
  try { await pool.query("ALTER TABLE customer_payments ADD COLUMN additional_charges TEXT DEFAULT '[]'"); } catch(_) {}
  try { await pool.query("ALTER TABLE customer_payments ADD COLUMN actual_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE customer_payments ADD COLUMN amount_change_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE finance_queue ADD COLUMN additional_charges TEXT DEFAULT '[]'"); } catch(_) {}
  try { await pool.query("ALTER TABLE finance_queue ADD COLUMN actual_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE finance_queue ADD COLUMN amount_change_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE finance_queue ADD COLUMN payment_method TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE finance_queue ADD COLUMN release_pending INTEGER DEFAULT 0"); } catch(_) {}
  // Per-installment log for supplier ADVANCE payments (so History shows every payment, not just the latest)
  try { await pool.query(`CREATE TABLE IF NOT EXISTS supplier_advance_payment_logs (
    id TEXT PRIMARY KEY, finance_queue_id TEXT, supplier_order_id TEXT, order_id TEXT,
    amount NUMERIC, currency TEXT, payment_ref TEXT, payment_date TEXT, payment_method TEXT,
    zoho_po_number TEXT, supplier_ref TEXT, notes TEXT, paid_by TEXT, paid_at TEXT,
    total_paid_snapshot NUMERIC, remaining_snapshot NUMERIC, grand_total NUMERIC,
    additional_charges TEXT DEFAULT '[]', actual_amount NUMERIC, amount_change_note TEXT
  )`); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN net_additional_charges TEXT DEFAULT '[]'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN net_actual_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN net_amount_change_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_net_payment_logs ADD COLUMN additional_charges TEXT DEFAULT '[]'"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_net_payment_logs ADD COLUMN actual_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_net_payment_logs ADD COLUMN amount_change_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN customer_payment_status TEXT DEFAULT 'pending'"); } catch(_) {}
  try { await pool.query("ALTER TABLE orders ADD COLUMN payment_due_date TEXT DEFAULT ''"); } catch(_) {}
  // ── Finance: supplier_orders Phase 2 fields ──────────────────────────────────
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_invoice_no TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN supplier_invoice_date TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE supplier_orders ADD COLUMN expected_ship_date TEXT DEFAULT ''"); } catch(_) {}
  // ── Migrate grn_records — add credit_note_no for partial GRN shortfalls ──────
  try { await pool.query("ALTER TABLE grn_records ADD COLUMN credit_note_no TEXT DEFAULT ''"); } catch(_) {}
  // ── Migrate enquiry_sourcing — add src_dc and delivery_promise_date ──────────
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN sent_to_enquiry INTEGER DEFAULT 0"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN sent_to_enquiry_note TEXT DEFAULT NULL"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN src_dc TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN delivery_promise_date TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN preferred_delivery_date TEXT DEFAULT ''"); } catch(_) {}
  try { await pool.query("ALTER TABLE enquiry_sourcing ADD COLUMN item_status TEXT DEFAULT 'ready'"); } catch(_) {}
  // ── Migrate tax_rates table ────────────────────────────────────────────────
  try { await pool.query("ALTER TABLE tax_rates ADD COLUMN vat_label TEXT NOT NULL DEFAULT 'VAT'"); } catch(_) {}
  // ── Seed tax_rates from built-in defaults if table is empty ───────────────
  const taxCount = await pool.query('SELECT COUNT(*) FROM tax_rates');
  if (parseInt(taxCount.rows[0].count) === 0) {
    const defaultRates = [
      ['AUD','Australia','Oceania',[0,10],'GST'],
      ['BDT','Bangladesh','Asia',[0,5,15],'VAT'],
      ['BND','Brunei','Asia',[0],'GST'],
      ['BTN','Bhutan','Asia',[0,5,10],'GST'],
      ['CNY','China','Asia',[0,6,13],'VAT'],
      ['FJD','Fiji','Oceania',[0,9,28],'VAT'],
      ['HKD','Hong Kong','Asia',[0],'GST'],
      ['IDR','Indonesia','Asia',[0,10],'VAT'],
      ['INR','India','Asia',[0,5,12,18,28],'GST'],
      ['JPY','Japan','Asia',[0,8,10],'CT'],
      ['KHR','Cambodia','Asia',[0,10],'VAT'],
      ['KRW','South Korea','Asia',[0,10],'VAT'],
      ['LAK','Laos','Asia',[0,10],'VAT'],
      ['LKR','Sri Lanka','Asia',[0,8,15],'VAT'],
      ['MMK','Myanmar','Asia',[0,5],'CT'],
      ['MNT','Mongolia','Asia',[0,10],'VAT'],
      ['MOP','Macau','Asia',[0],'N/A'],
      ['MYR','Malaysia','Asia',[0,6,8],'SST'],
      ['MVR','Maldives','Asia',[0,8,12],'GST'],
      ['NZD','New Zealand','Oceania',[0,15],'GST'],
      ['PHP','Philippines','Asia',[0,12],'VAT'],
      ['PKR','Pakistan','Asia',[0,17],'GST'],
      ['PGK','Papua New Guinea','Oceania',[0,10],'GST'],
      ['SGD','Singapore','Asia',[0,8,9],'GST'],
      ['SBD','Solomon Islands','Oceania',[0,10],'GST'],
      ['THB','Thailand','Asia',[0,7],'VAT'],
      ['TWD','Taiwan','Asia',[0,5],'VAT'],
      ['VND','Vietnam','Asia',[0,5,10],'VAT'],
      ['VUV','Vanuatu','Oceania',[0,12.5],'VAT'],
      ['WST','Samoa','Oceania',[0,15],'GST'],
      ['AED','United Arab Emirates','Middle East',[0,5],'VAT'],
      ['AFN','Afghanistan','Asia',[0],'N/A'],
      ['AZN','Azerbaijan','Asia',[0,18],'VAT'],
      ['BHD','Bahrain','Middle East',[0,10],'VAT'],
      ['GEL','Georgia','Asia',[0,18],'VAT'],
      ['ILS','Israel','Middle East',[0,17],'VAT'],
      ['IQD','Iraq','Middle East',[0],'N/A'],
      ['IRR','Iran','Middle East',[0,9],'VAT'],
      ['JOD','Jordan','Middle East',[0,5,10,16],'GST'],
      ['KGS','Kyrgyzstan','Asia',[0,12],'VAT'],
      ['KWD','Kuwait','Middle East',[0],'N/A'],
      ['KZT','Kazakhstan','Asia',[0,12],'VAT'],
      ['LBP','Lebanon','Middle East',[0,11],'VAT'],
      ['NPR','Nepal','Asia',[0,5,13],'VAT'],
      ['OMR','Oman','Middle East',[0,5],'VAT'],
      ['QAR','Qatar','Middle East',[0],'N/A'],
      ['SAR','Saudi Arabia','Middle East',[0,15],'VAT'],
      ['SYP','Syria','Middle East',[0],'N/A'],
      ['YER','Yemen','Middle East',[0,5],'GST'],
      ['TJS','Tajikistan','Asia',[0,18],'VAT'],
      ['TMT','Turkmenistan','Asia',[0,15],'VAT'],
      ['UZS','Uzbekistan','Asia',[0,12],'VAT'],
      ['AOA','Angola','Africa',[0,5,14],'IVA'],
      ['BIF','Burundi','Africa',[0,18],'VAT'],
      ['BWP','Botswana','Africa',[0,12],'VAT'],
      ['CDF','Democratic Republic of Congo','Africa',[0,16],'VAT'],
      ['CVE','Cape Verde','Africa',[0,15],'IVA'],
      ['DJF','Djibouti','Africa',[0,11],'VAT'],
      ['DZD','Algeria','Africa',[0,7,9,19],'TVA'],
      ['EGP','Egypt','Africa',[0,5,10,14],'VAT'],
      ['ERN','Eritrea','Africa',[0],'N/A'],
      ['ETB','Ethiopia','Africa',[0,15],'VAT'],
      ['GHS','Ghana','Africa',[0,12.5,15],'VAT'],
      ['GMD','Gambia','Africa',[0,15],'VAT'],
      ['GNF','Guinea','Africa',[0,18],'TVA'],
      ['KES','Kenya','Africa',[0,16],'VAT'],
      ['KMF','Comoros','Africa',[0,7],'TVA'],
      ['LRD','Liberia','Africa',[0],'N/A'],
      ['LSL','Lesotho','Africa',[0,14],'VAT'],
      ['LYD','Libya','Africa',[0],'N/A'],
      ['MAD','Morocco','Africa',[0,6,10,20],'TVA'],
      ['MGA','Madagascar','Africa',[0,20],'TVA'],
      ['MRU','Mauritania','Africa',[0,14],'TVA'],
      ['MUR','Mauritius','Africa',[0,15],'VAT'],
      ['MWK','Malawi','Africa',[0,16.5],'VAT'],
      ['MZN','Mozambique','Africa',[0,16],'IVA'],
      ['NAD','Namibia','Africa',[0,15],'VAT'],
      ['NGN','Nigeria','Africa',[0,7.5,15],'VAT'],
      ['RWF','Rwanda','Africa',[0,18],'VAT'],
      ['SCR','Seychelles','Africa',[0,15],'VAT'],
      ['SDG','Sudan','Africa',[0,17],'VAT'],
      ['SLL','Sierra Leone','Africa',[0,15],'GST'],
      ['SOS','Somalia','Africa',[0],'N/A'],
      ['STN','São Tomé and Príncipe','Africa',[0],'N/A'],
      ['SZL','Eswatini','Africa',[0,14],'VAT'],
      ['TND','Tunisia','Africa',[0,6,13,19],'TVA'],
      ['TZS','Tanzania','Africa',[0,18],'VAT'],
      ['UGX','Uganda','Africa',[0,18],'VAT'],
      ['ZAR','South Africa','Africa',[0,15],'VAT'],
      ['ZMW','Zambia','Africa',[0,16],'VAT'],
      ['ZWL','Zimbabwe','Africa',[0,15],'VAT'],
      ['ALL','Albania','Europe',[0,6,20],'VAT'],
      ['AMD','Armenia','Europe',[0,20],'VAT'],
      ['BAM','Bosnia and Herzegovina','Europe',[0,17],'PDV'],
      ['BGN','Bulgaria','Europe',[0,9,20],'VAT'],
      ['BYN','Belarus','Europe',[0,10,18],'VAT'],
      ['CHF','Switzerland','Europe',[0,2.6,3.8,8.1],'VAT'],
      ['CZK','Czech Republic','Europe',[0,12,21],'DPH'],
      ['DKK','Denmark','Europe',[0,25],'VAT'],
      ['EUR','Eurozone','Europe',[0,3,4,5,6,9,10,13,17,19,20,21,23,25,27],'VAT'],
      ['GBP','United Kingdom','Europe',[0,5,20],'VAT'],
      ['GIP','Gibraltar','Europe',[0,17.5],'VAT'],
      ['HRK','Croatia','Europe',[0,5,13,25],'PDV'],
      ['HUF','Hungary','Europe',[0,5,18,27],'AFA'],
      ['ISK','Iceland','Europe',[0,7,11,24],'VSK'],
      ['MDL','Moldova','Europe',[0,5,8,20],'TVA'],
      ['MKD','North Macedonia','Europe',[0,5,18],'DDV'],
      ['NOK','Norway','Europe',[0,6,12,15,25],'MVA'],
      ['PLN','Poland','Europe',[0,5,8,23],'VAT'],
      ['RON','Romania','Europe',[0,5,9,19],'TVA'],
      ['RSD','Serbia','Europe',[0,10,20],'PDV'],
      ['RUB','Russia','Europe',[0,10,18,20],'НДС'],
      ['SEK','Sweden','Europe',[0,6,12,25],'VAT'],
      ['TRY','Turkey','Europe',[0,8,18],'KDV'],
      ['UAH','Ukraine','Europe',[0,7,20],'VAT'],
      ['CAD','Canada','North America',[0,5,13,15],'GST/HST'],
      ['MXN','Mexico','North America',[0,16],'IVA'],
      ['USD','United States','North America',[0,5,7,8,9],'Tax'],
      ['ANG','Curaçao & Sint Maarten','Caribbean',[0,6],'OB'],
      ['AWG','Aruba','Caribbean',[0,6],'BBO'],
      ['BBD','Barbados','Caribbean',[0,15,17.5],'VAT'],
      ['BMD','Bermuda','Caribbean',[0,7],'GST'],
      ['BSD','Bahamas','Caribbean',[0,12],'VAT'],
      ['BZD','Belize','Central America',[0,12.5,15],'GST'],
      ['CRC','Costa Rica','Central America',[0,4,8,13],'IVA'],
      ['CUP','Cuba','Caribbean',[0],'N/A'],
      ['DOP','Dominican Republic','Caribbean',[0,12,18],'ITBIS'],
      ['FKP','Falkland Islands','Atlantic',[0,17.5],'VAT'],
      ['GTQ','Guatemala','Central America',[0,12],'IVA'],
      ['GYD','Guyana','South America',[0,16],'VAT'],
      ['HTG','Haiti','Caribbean',[0,10],'TVA'],
      ['HNL','Honduras','Central America',[0,12,15],'ISV'],
      ['JMD','Jamaica','Caribbean',[0,15],'GCT'],
      ['KYD','Cayman Islands','Caribbean',[0,10],'GST'],
      ['NIO','Nicaragua','Central America',[0,15],'IVA'],
      ['PAB','Panama','Central America',[0,7],'ITBM'],
      ['SHP','Saint Helena','Atlantic',[0,20],'VAT'],
      ['SRD','Suriname','South America',[0,9],'OB'],
      ['TTD','Trinidad and Tobago','Caribbean',[0,12.5],'VAT'],
      ['XCD','East Caribbean Dollar','Caribbean',[0,15],'VAT'],
      ['ARS','Argentina','South America',[0,10.5,21],'IVA'],
      ['BOB','Bolivia','South America',[0,13],'IVA'],
      ['BRL','Brazil','South America',[0,7,12,18],'ICMS'],
      ['CLP','Chile','South America',[0,19],'IVA'],
      ['COP','Colombia','South America',[0,5,19],'IVA'],
      ['PEN','Peru','South America',[0,18],'IGV'],
      ['PYG','Paraguay','South America',[0,5,10],'IVA'],
      ['UYU','Uruguay','South America',[0,10,22],'IVA'],
      ['VES','Venezuela','South America',[0,16],'IVA'],
      ['TOP','Tonga','Oceania',[0,15],'CT'],
      ['XAF','Central African CFA Franc','Africa',[0,19.25],'TVA'],
      ['XOF','West African CFA Franc','Africa',[0,18],'TVA'],
      ['XPF','CFP Franc','Oceania',[0,5.5],'TGC'],
    ];
    const now2 = new Date().toISOString();
    for (const [cur, country, region, rates, label] of defaultRates) {
      await pool.query(
        `INSERT INTO tax_rates(currency,country,region,rates,vat_label,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(currency) DO NOTHING`,
        [cur, country, region, JSON.stringify(rates), label, now2]
      );
    }
    console.log('[DB] Tax rates seeded (' + defaultRates.length + ' records)');
  }
  console.log('[DB] All migrations done');

  // ── Ensure the default admin user exists ─────────────────────────────────
  const today = new Date().toISOString().slice(0,10);
  const adminUser = ['uadmin001', 'Administrator', 'admin', 'admin@ciflux.com', 'admin123', 'management', 'admin', 'active', today];
  const [id, name, username, email, password, department, role, status, created] = adminUser;
  const hashedPassword = bcrypt.hashSync(password, 10);
  await pool.query(
    'INSERT INTO users(id,name,username,email,password,department,role,status,created,plain_password) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(username) DO NOTHING',
    [id, name, username, email, hashedPassword, department, role, status, created, password]
  );
  // ── Backfill plain_password for default admin if missing ─────────────────
  await pool.query(
    "UPDATE users SET plain_password=$1 WHERE username='admin' AND (plain_password IS NULL OR plain_password='')",
    [password]
  );


  const sections = [
    'dashboard','enquiries','new-enquiry','quotes','orders','new-order',
    'sourcing-bin','procurement-bin','delivery-hub','inventory','closed-bin',
    'deleted-bin','finance','customers','suppliers','linecards','users',
    'approvals','settings','tax-settings','reports',
  ];
  const departments = ['sales','sourcing','procurement','accounts','logistics','approvers','management'];
  const defaults = {
    sales: ['dashboard','enquiries','new-enquiry','quotes','orders','new-order','closed-bin','customers','suppliers','linecards','reports'],
    sourcing: ['dashboard','enquiries','sourcing-bin','closed-bin','suppliers','linecards','reports'],
    procurement: ['dashboard','orders','procurement-bin','delivery-hub','inventory','closed-bin','suppliers','linecards','reports'],
    accounts: ['dashboard','orders','finance','customers','suppliers','closed-bin','reports'],
    logistics: ['dashboard','orders','delivery-hub','closed-bin','reports'],
    approvers: ['dashboard','orders','approvals','closed-bin','reports'],
    management: sections,
  };
  const now = new Date().toISOString().slice(0,16).replace('T',' ');
  for (const role of ['user','manager','admin']) {
    for (const department of departments) {
      const allowed = role === 'user' ? (defaults[department] || defaults.sales) : sections;
      for (const section of sections) {
        await pool.query(
          `INSERT INTO section_permissions(role,department,section_key,enabled,updated_at,updated_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(role,department,section_key) DO NOTHING`,
          [role, department, section, allowed.includes(section) ? 1 : 0, now, 'system']
        );
      }
    }
  }

  return pool;
}

module.exports = { initDb, all, run, get, allAsync, runAsync, getAsync, saveNow, nextId, nextIdAsync, assembleOrder, assembleEnquiry };
