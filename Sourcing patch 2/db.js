// server/db.js  –  Ciflux OMS v2  (sql.js, no compilation needed)
const initSqlJs = require('sql.js');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '..', 'ciflux_oms.db');
let _db = null, _dirty = false;

function saveNow() {
  if (_db) { fs.writeFileSync(DB_PATH, Buffer.from(_db.export())); _dirty = false; }
}
function startAutosave() {
  setInterval(() => { if (_dirty && _db) saveNow(); }, 2000);
}
function getDb() {
  if (!_db) throw new Error('DB not ready');
  return _db;
}
function all(sql, params) {
  const stmt = getDb().prepare(sql);
  if (params?.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function run(sql, params) { getDb().run(sql, params || []); _dirty = true; }
function get(sql, params) { const r = all(sql, params); return r.length ? r[0] : null; }

async function initDb() {
  const SQL = await initSqlJs();
  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  _db.run('PRAGMA foreign_keys = ON;');

  _db.run(`
    -- USERS (department-based roles)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL,
      email TEXT, password TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT 'sales',
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL
    );

    -- CUSTOMERS
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, email TEXT,
      phone TEXT, city TEXT, state TEXT, country TEXT DEFAULT 'India',
      gstin TEXT, status TEXT DEFAULT 'active', created TEXT NOT NULL
    );

    -- LINECARDS
    CREATE TABLE IF NOT EXISTS linecards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      description TEXT, created TEXT NOT NULL
    );

    -- SUPPLIERS
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'domestic',
      contact TEXT, email TEXT, phone TEXT, website TEXT,
      city TEXT, state TEXT, country TEXT DEFAULT 'India', gstin TEXT,
      payment_terms TEXT DEFAULT 'Net 30', currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'active', notes TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplier_linecards (
      supplier_id TEXT NOT NULL, linecard_id TEXT NOT NULL,
      PRIMARY KEY (supplier_id, linecard_id)
    );

    -- SHIPPERS (dropdown for shipping)
    CREATE TABLE IF NOT EXISTS shippers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'international',
      tracking_url TEXT, status TEXT DEFAULT 'active', created TEXT NOT NULL
    );

    -- ENQUIRIES
    CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT DEFAULT 'normal',
      notes TEXT,
      quote_no TEXT,
      zoho_quote_no TEXT,
      file_ref TEXT,
      valid_until TEXT,
      quote_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiry_items (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT NOT NULL,
      component TEXT NOT NULL,
      linecard_id TEXT,
      ipn TEXT,
      manufacturer TEXT,
      target_price REAL,
      target_currency TEXT DEFAULT 'INR',
      quantity INTEGER DEFAULT 0,
      preferred_delivery_date TEXT,
      date_code TEXT,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS enquiry_sourcing (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT NOT NULL,
      enquiry_item_id TEXT NOT NULL,
      supplier_id TEXT,
      sourced_price REAL,
      sourced_currency TEXT DEFAULT 'USD',
      quote_price REAL,
      quote_currency TEXT DEFAULT 'INR',
      availability TEXT,
      lead_time TEXT,
      notes TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiry_charges (
      enquiry_id TEXT PRIMARY KEY,
      customs REAL DEFAULT 0,
      handling REAL DEFAULT 0,
      freight REAL DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS enquiry_history (
      id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL,
      action TEXT NOT NULL, by_user TEXT, ts TEXT NOT NULL
    );

    -- QUOTES
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT,
      customer_id TEXT NOT NULL,
      quote_no TEXT UNIQUE NOT NULL,
      zoho_quote_no TEXT,
      file_ref TEXT,
      status TEXT DEFAULT 'draft',
      valid_until TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      notes TEXT
    );

    -- ORDERS
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_ref TEXT,
      customer_id TEXT NOT NULL,
      enquiry_id TEXT,
      quote_id TEXT,
      po_number TEXT,
      po_file_ref TEXT,
      enquiry_no TEXT,
      quote_no TEXT,
      tentative_date TEXT,
      status TEXT DEFAULT 'open',
      created_by TEXT,
      created_at TEXT NOT NULL,
      closed_at TEXT,
      notes TEXT
    );

    -- ORDER LINE ITEMS (with per-line status)
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      component TEXT NOT NULL,
      manufacturer TEXT,
      ipn TEXT,
      qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      procurement_price REAL DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      order_date TEXT,
      delivery_date TEXT,
      supplier_id TEXT,
      line_status TEXT DEFAULT 'negotiating',
      sort_order INTEGER DEFAULT 0
    );

    -- SUPPLIER PURCHASE ORDERS per order
    CREATE TABLE IF NOT EXISTS supplier_orders (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      po_no TEXT,
      shipping_status TEXT DEFAULT 'pending',
      shipper_id TEXT,
      tracking_no TEXT
    );
    CREATE TABLE IF NOT EXISTS supplier_order_items (
      supplier_order_id TEXT NOT NULL, item_id TEXT NOT NULL,
      PRIMARY KEY (supplier_order_id, item_id)
    );

    -- CUSTOMER SHIPPING
    CREATE TABLE IF NOT EXISTS customer_shipping (
      order_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      shipper_id TEXT,
      tracking_no TEXT,
      delivery_date TEXT,
      comments TEXT
    );

    -- ORDER DOCUMENTS
    CREATE TABLE IF NOT EXISTS order_documents (
      order_id TEXT PRIMARY KEY,
      delivery_slip TEXT, packing_list TEXT,
      invoice TEXT, eway_bill TEXT, po_file TEXT, comments TEXT
    );

    -- ORDER HISTORY / AUDIT LOG
    CREATE TABLE IF NOT EXISTS order_history (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
      action TEXT NOT NULL, by_user TEXT, comment TEXT, ts TEXT NOT NULL
    );

    -- APPROVAL WORKFLOW
    CREATE TABLE IF NOT EXISTS approval_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      steps TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS approval_actions (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      action TEXT NOT NULL,
      by_user TEXT NOT NULL,
      comment TEXT,
      ts TEXT NOT NULL
    );
  `);

  const c = get('SELECT COUNT(*) as n FROM users');
  if (!c || Number(c.n) === 0) seedData();
  saveNow();
  startAutosave();
  process.on('exit', saveNow);
  process.on('SIGINT',  () => { saveNow(); process.exit(0); });
  process.on('SIGTERM', () => { saveNow(); process.exit(0); });
  return _db;
}

function seedData() {
  const today = new Date().toISOString().slice(0,10);
  const now   = new Date().toISOString().slice(0,16).replace('T',' ');

  // Users - all departments
  [
    ['u1','Admin User','admin','admin@ciflux.com',bcrypt.hashSync('admin123',10),'management','admin','active',today],
    ['u2','Priya Sharma','manager','priya@ciflux.com',bcrypt.hashSync('pass123',10),'management','manager','active',today],
    ['u3','Ravi Kumar','sales1','ravi@ciflux.com',bcrypt.hashSync('pass123',10),'sales','user','active',today],
    ['u4','Anita Patel','ops1','anita@ciflux.com',bcrypt.hashSync('pass123',10),'logistics','user','active',today],
    ['u5','Vikram Singh','sourcing1','vikram@ciflux.com',bcrypt.hashSync('pass123',10),'sourcing','user','active',today],
    ['u6','Meena Nair','procure1','meena@ciflux.com',bcrypt.hashSync('pass123',10),'procurement','user','active',today],
    ['u7','Arjun Das','accounts1','arjun@ciflux.com',bcrypt.hashSync('pass123',10),'accounts','user','active',today],
    ['u8','Sunita Rao','approver1','sunita@ciflux.com',bcrypt.hashSync('pass123',10),'approvers','user','active',today],
  ].forEach(u => run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)', u));

  // Customers
  [
    ['C001','TechBridge Electronics','Suresh Nair','suresh@techbridge.in','+91 98400 12345','Bangalore','Karnataka','India','29ABCDE1234F1Z5','active',today],
    ['C002','Microtek Solutions','Kavya Reddy','kavya@microtek.co.in','+91 98765 43210','Mumbai','Maharashtra','India','27FGHIJ5678K2L6','active',today],
    ['C003','Precision Circuits Ltd','Ajay Mehta','ajay@precisionc.in','+91 97654 32109','Delhi','Delhi','India','07MNOPQ9012R3S7','active',today],
  ].forEach(c => run('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)', c));

  // Linecards
  [
    ['LC001','Texas Instruments','Semiconductors','Analog ICs, Embedded Processors',today],
    ['LC002','STMicroelectronics','Semiconductors','MCUs, Power, Sensors',today],
    ['LC003','Murata Manufacturing','Passive Components','Capacitors, Inductors, Filters',today],
    ['LC004','Vishay','Passive Components','Resistors, Capacitors, Diodes',today],
    ['LC005','Molex','Connectors','Connectors and Interconnect Solutions',today],
    ['LC006','TE Connectivity','Connectors','Connectors, Sensors, Assemblies',today],
    ['LC007','NXP Semiconductors','Semiconductors','Automotive, IoT, Security ICs',today],
    ['LC008','Infineon Technologies','Power','Power Semiconductors, MCUs',today],
  ].forEach(l => run('INSERT INTO linecards VALUES(?,?,?,?,?)', l));

  // Suppliers
  [
    ['S001','Arrow Electronics India','domestic','Kiran Bhat','kiran@arrow.in','+91 80 4567 8901','arrow.com','Bangalore','Karnataka','India','29AAAAA0000A1Z5','Net 30','INR','active','',today],
    ['S002','Avnet Asia Pacific','international','James Lee','james@avnet.com.sg','+65 6222 3333','avnet.com','Singapore','','Singapore','','Net 45','USD','active','',today],
    ['S003','Future Electronics','international','Mike Chan','mike@future.com','+1 514 694 7710','futureelectronics.com','Montreal','','USA','','Net 30','USD','active','',today],
    ['S004','Ruchika Distributors','domestic','Ramesh Gupta','ramesh@ruchika.co.in','+91 11 2345 6789','','Delhi','Delhi','India','07BBBBB1111B2Z6','Net 15','INR','active','',today],
  ].forEach(s => run('INSERT INTO suppliers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', s));

  [['S001','LC001'],['S001','LC002'],['S002','LC003'],['S002','LC005'],['S003','LC007'],['S003','LC008']]
    .forEach(([s,l]) => run('INSERT INTO supplier_linecards VALUES(?,?)', [s,l]));

  // Shippers
  [
    [uuid(),'DHL Express','international','https://www.dhl.com/track?id=','active',today],
    [uuid(),'FedEx','international','https://www.fedex.com/track?tracknumbers=','active',today],
    [uuid(),'UPS','international','https://www.ups.com/track?tracknum=','active',today],
    [uuid(),'TNT','international','https://www.tnt.com/go/en_/site/home/tracking.html?cons=','active',today],
    [uuid(),'Aramex','international','https://www.aramex.com/us/en/track/shipments?id=','active',today],
    [uuid(),'Blue Dart','domestic','https://www.bluedart.com/tracking','active',today],
    [uuid(),'DTDC','domestic','https://www.dtdc.in/trace-tracking.asp','active',today],
    [uuid(),'Delhivery','domestic','https://www.delhivery.com/track/package/','active',today],
    [uuid(),'India Post','domestic','https://www.indiapost.gov.in/track','active',today],
    [uuid(),'Ecom Express','domestic','https://ecomexpress.in/tracking/','active',today],
  ].forEach(s => run('INSERT INTO shippers VALUES(?,?,?,?,?,?)', s));

  // Sample enquiry
  const enqId = 'ENQ-001';
  run('INSERT INTO enquiries VALUES(?,?,?,?,?,?,?,?,?)',
    [enqId,'C001','u3','u5','sourcing','normal','Urgent requirement for production',now,now]);
  run('INSERT INTO enquiry_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [uuid(),enqId,'STM32F103C8T6','LC002','IPN-001','STMicroelectronics',180,'INR',500,'2024-06-01','2023+',1]);
  run('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
    [uuid(),enqId,'Enquiry created','Ravi Kumar',now]);

  // Sample order
  run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['CFX-001','TB-2024-001','C001',enqId,null,'PO-TB-001','po_tb_001.pdf','ENQ-001','QT-001','2024-04-30','open','u3','2024-04-01',null,'']);
  run('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['li1','CFX-001','STM32F103C8T6','STMicroelectronics','IPN-001',500,185,160,'INR','2024-04-02','2024-04-25','S001','procurement',1]);
  run('INSERT INTO supplier_orders VALUES(?,?,?,?,?,?,?)',
    ['so1','CFX-001','S001','PO-S001-001','pending',null,'']);
  run('INSERT INTO supplier_order_items VALUES(?,?)', ['so1','li1']);
  run('INSERT INTO customer_shipping VALUES(?,?,?,?,?,?)', ['CFX-001','pending',null,'','','']);
  run('INSERT INTO order_documents VALUES(?,?,?,?,?,?,?)', ['CFX-001','','','','','po_tb_001.pdf','']);
  run('INSERT INTO order_history VALUES(?,?,?,?,?,?)', [uuid(),'CFX-001','Order created','Ravi Kumar','',now]);

  saveNow();
  console.log('  DB seeded  →  v2 demo data loaded');
}

function nextId(table, prefix) {
  const rows = all(`SELECT id FROM ${table}`);
  const nums = rows.map(r => parseInt((r.id.match(/\d+$/) || ['0'])[0])).filter(n => !isNaN(n));
  return `${prefix}${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(3,'0')}`;
}

function assembleOrder(order) {
  const o = { ...order };
  o.lineItems = all('SELECT * FROM order_items WHERE order_id=? ORDER BY sort_order', [o.id]);
  const sos   = all('SELECT * FROM supplier_orders WHERE order_id=?', [o.id]);
  o.supplierOrders = sos.map(so => ({
    ...so,
    items: all('SELECT item_id FROM supplier_order_items WHERE supplier_order_id=?', [so.id]).map(r => r.item_id)
  }));
  o.customerShipping = get('SELECT * FROM customer_shipping WHERE order_id=?', [o.id])
    || { status:'pending', shipper_id:'', tracking_no:'', delivery_date:'', comments:'' };
  o.documents = get('SELECT * FROM order_documents WHERE order_id=?', [o.id])
    || { delivery_slip:'', packing_list:'', invoice:'', eway_bill:'', po_file:'', comments:'' };
  o.history = all('SELECT * FROM order_history WHERE order_id=? ORDER BY ts DESC', [o.id]);
  return o;
}

function assembleEnquiry(enq) {
  const e = { ...enq };
  e.items   = all('SELECT * FROM enquiry_items WHERE enquiry_id=? ORDER BY sort_order', [e.id]);
  e.sourcing= all('SELECT * FROM enquiry_sourcing WHERE enquiry_id=?', [e.id]);
  e.charges = get('SELECT * FROM enquiry_charges WHERE enquiry_id=?', [e.id]) || { customs:0, handling:0, freight:0, currency:'INR', notes:'' };
  e.history = all('SELECT * FROM enquiry_history WHERE enquiry_id=? ORDER BY ts DESC', [e.id]);
  return e;
}

module.exports = { initDb, all, run, get, saveNow, nextId, assembleOrder, assembleEnquiry };
