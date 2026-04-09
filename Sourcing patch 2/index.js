// server/index.js  –  Ciflux OMS v2
const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { initDb, all, run, get, saveNow, nextId, assembleOrder, assembleEnquiry } = require('./db');

const app    = express();
const PORT   = process.env.PORT || 8080;
const SECRET = 'ciflux-jwt-2024';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: 'ciflux-session-2024',
  resave: false, saveUninitialized: false, rolling: true,
  cookie: { maxAge: 8*60*60*1000, httpOnly: true, sameSite: 'lax', secure: false }
}));

const BUILD = path.join(__dirname, '..', 'client', 'build');
if (fs.existsSync(BUILD)) app.use(express.static(BUILD));

// ── Helpers ──────────────────────────────────────────────────
function auth(req, res, next) {
  if (req.session?.user) return next();
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try { req.session.user = jwt.verify(h.slice(7), SECRET); return next(); } catch {}
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
function adminOnly(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!['admin','manager'].includes(req.session.user.role)) return res.status(403).json({ error: 'Admin only' });
  next();
}
const nowStr   = () => new Date().toISOString().slice(0,16).replace('T',' ');
const todayStr = () => new Date().toISOString().slice(0,10);

// Dept permissions
const DEPT_PERMS = {
  management:  { canSeeAll: true,  canSeeProcurementPrice: true,  canSeeCustomer: true,  canApprove: true  },
  sales:       { canSeeAll: false, canSeeProcurementPrice: false, canSeeCustomer: true,  canApprove: false },
  sourcing:    { canSeeAll: false, canSeeProcurementPrice: true,  canSeeCustomer: false, canApprove: false },
  procurement: { canSeeAll: false, canSeeProcurementPrice: true,  canSeeCustomer: false, canApprove: false },
  accounts:    { canSeeAll: false, canSeeProcurementPrice: true,  canSeeCustomer: true,  canApprove: false },
  logistics:   { canSeeAll: false, canSeeProcurementPrice: false, canSeeCustomer: false, canApprove: false },
  approvers:   { canSeeAll: true,  canSeeProcurementPrice: true,  canSeeCustomer: true,  canApprove: true  },
};
function getPerms(user) { return DEPT_PERMS[user.department] || DEPT_PERMS.sales; }

// Strip procurement prices for sales/logistics
function stripSensitive(order, user) {
  const perms = getPerms(user);
  if (!perms.canSeeProcurementPrice) {
    return {
      ...order,
      lineItems: (order.lineItems||[]).map(li => ({ ...li, procurement_price: undefined })),
      supplierOrders: perms.canSeeCustomer ? order.supplierOrders : []
    };
  }
  if (!perms.canSeeCustomer) {
    return { ...order, customer_id: '***', customer_ref: '***' };
  }
  return order;
}

// ── AUTH ─────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Required' });
  const user = get("SELECT * FROM users WHERE (username=? OR email=?) AND status='active'", [username, username]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const payload = { id: user.id, name: user.name, role: user.role, department: user.department, username: user.username };
  req.session.user = payload;
  res.json({ ...payload, email: user.email, token: jwt.sign(payload, SECRET, { expiresIn: '8h' }) });
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/auth/me', auth, (req, res) => {
  const u = get('SELECT id,name,username,email,role,department,status FROM users WHERE id=?', [req.session.user.id]);
  res.json(u ? { ...u, perms: getPerms(u) } : req.session.user);
});

// ── USERS ────────────────────────────────────────────────────
app.get('/api/users', auth, (req, res) => {
  res.json(all('SELECT id,name,username,email,role,department,status,created FROM users ORDER BY department,name'));
});
app.post('/api/users', adminOnly, (req, res) => {
  const d = req.body;
  if (!d.name || !d.username || !d.password) return res.status(400).json({ error: 'Required' });
  if (get('SELECT id FROM users WHERE username=?', [d.username])) return res.status(409).json({ error: 'Username exists' });
  const id = 'u' + uuid().slice(0,8);
  run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)',
    [id, d.name, d.username, d.email||'', bcrypt.hashSync(d.password,10), d.department||'sales', d.role||'user', d.status||'active', todayStr()]);
  saveNow(); res.json({ id });
});
app.put('/api/users/:id', adminOnly, (req, res) => {
  const u = get('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  run('UPDATE users SET name=?,username=?,email=?,password=?,department=?,role=?,status=? WHERE id=?',
    [d.name||u.name, d.username||u.username, d.email||u.email,
     d.password ? bcrypt.hashSync(d.password,10) : u.password,
     d.department||u.department, d.role||u.role, d.status||u.status, req.params.id]);
  saveNow(); res.json({ ok: true });
});
app.delete('/api/users/:id', adminOnly, (req, res) => {
  run('DELETE FROM users WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
});

// ── CUSTOMERS ────────────────────────────────────────────────
app.get('/api/customers', auth, (req, res) => {
  const perms = getPerms(req.session.user);
  if (!perms.canSeeCustomer) return res.status(403).json({ error: 'Access denied' });
  const rows = all('SELECT * FROM customers ORDER BY created DESC');
  res.json(rows.map(c => ({ ...c, orders: (get('SELECT COUNT(*) as n FROM orders WHERE customer_id=?',[c.id])||{n:0}).n })));
});
app.post('/api/customers', auth, (req, res) => {
  const d = req.body;
  if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = nextId('customers','C');
  run('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.name,d.contact||'',d.email||'',d.phone||'',d.city||'',d.state||'',d.country||'India',d.gstin||'',d.status||'active',todayStr()]);
  saveNow(); res.json({ id });
});
app.put('/api/customers/:id', auth, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  run('UPDATE customers SET name=?,contact=?,email=?,phone=?,city=?,state=?,country=?,gstin=?,status=? WHERE id=?',
    [d.name||c.name,d.contact||c.contact,d.email||c.email,d.phone||c.phone,d.city||c.city,d.state||c.state,d.country||c.country,d.gstin||c.gstin,d.status||c.status,req.params.id]);
  saveNow(); res.json({ ok: true });
});
app.delete('/api/customers/:id', auth, (req, res) => {
  run('DELETE FROM customers WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
});

// ── LINECARDS ────────────────────────────────────────────────
app.get('/api/linecards', auth, (req, res) => {
  res.json(all('SELECT l.*, (SELECT COUNT(*) FROM supplier_linecards sl WHERE sl.linecard_id=l.id) as supplier_count FROM linecards l ORDER BY category,name'));
});
app.post('/api/linecards', auth, (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = nextId('linecards','LC');
  run('INSERT INTO linecards VALUES(?,?,?,?,?)', [id,d.name,d.category||'Other',d.description||'',todayStr()]);
  saveNow(); res.json({ id });
});
app.put('/api/linecards/:id', auth, (req, res) => {
  const lc = get('SELECT * FROM linecards WHERE id=?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  run('UPDATE linecards SET name=?,category=?,description=? WHERE id=?', [d.name||lc.name,d.category||lc.category,d.description||lc.description,req.params.id]);
  saveNow(); res.json({ ok: true });
});
app.delete('/api/linecards/:id', auth, (req, res) => {
  run('DELETE FROM linecards WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
});

// ── SUPPLIERS ────────────────────────────────────────────────
app.get('/api/suppliers', auth, (req, res) => {
  const sups = all('SELECT * FROM suppliers ORDER BY created DESC');
  res.json(sups.map(s => ({ ...s, linecards: all('SELECT linecard_id FROM supplier_linecards WHERE supplier_id=?',[s.id]).map(r=>r.linecard_id) })));
});
app.post('/api/suppliers', auth, (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = nextId('suppliers','S');
  run('INSERT INTO suppliers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.name,d.type||'domestic',d.contact||'',d.email||'',d.phone||'',d.website||'',d.city||'',d.state||'',d.country||'India',d.gstin||'',d.payment_terms||'Net 30',d.currency||'INR',d.status||'active',d.notes||'',todayStr()]);
  (d.linecards||[]).forEach(lcid => { if (!get('SELECT 1 FROM supplier_linecards WHERE supplier_id=? AND linecard_id=?',[id,lcid])) run('INSERT INTO supplier_linecards VALUES(?,?)',[id,lcid]); });
  saveNow(); res.json({ id });
});
app.put('/api/suppliers/:id', auth, (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  run('UPDATE suppliers SET name=?,type=?,contact=?,email=?,phone=?,website=?,city=?,state=?,country=?,gstin=?,payment_terms=?,currency=?,status=?,notes=? WHERE id=?',
    [d.name||s.name,d.type||s.type,d.contact||s.contact,d.email||s.email,d.phone||s.phone,d.website||s.website,d.city||s.city,d.state||s.state,d.country||s.country,d.gstin||s.gstin,d.payment_terms||s.payment_terms,d.currency||s.currency,d.status||s.status,d.notes||s.notes,req.params.id]);
  if (d.linecards !== undefined) {
    run('DELETE FROM supplier_linecards WHERE supplier_id=?', [req.params.id]);
    d.linecards.forEach(lcid => { if (!get('SELECT 1 FROM supplier_linecards WHERE supplier_id=? AND linecard_id=?',[req.params.id,lcid])) run('INSERT INTO supplier_linecards VALUES(?,?)',[req.params.id,lcid]); });
  }
  saveNow(); res.json({ ok: true });
});
app.delete('/api/suppliers/:id', auth, (req, res) => {
  run('DELETE FROM suppliers WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
});

// ── SHIPPERS ─────────────────────────────────────────────────
app.get('/api/shippers', auth, (req, res) => res.json(all("SELECT * FROM shippers WHERE status='active' ORDER BY type,name")));
app.post('/api/shippers', auth, (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  run('INSERT INTO shippers VALUES(?,?,?,?,?,?)', [id,d.name,d.type||'international',d.tracking_url||'','active',todayStr()]);
  saveNow(); res.json({ id });
});
app.put('/api/shippers/:id', auth, (req, res) => {
  const d = req.body;
  run('UPDATE shippers SET name=?,type=?,tracking_url=?,status=? WHERE id=?',
    [d.name,d.type,d.tracking_url||'',d.status||'active',req.params.id]);
  saveNow(); res.json({ ok: true });
});

// ── ENQUIRIES ────────────────────────────────────────────────
app.get('/api/enquiries', auth, (req, res) => {
  const u = req.session.user;
  const perms = getPerms(u);
  let enqs;
  if (perms.canSeeAll || ['sourcing','procurement'].includes(u.department)) {
    enqs = all('SELECT * FROM enquiries ORDER BY created_at DESC');
  } else {
    enqs = all('SELECT * FROM enquiries WHERE created_by=? OR assigned_to=? ORDER BY created_at DESC', [u.id, u.id]);
  }
  res.json(enqs.map(e => assembleEnquiry(e)));
});
app.get('/api/enquiries/:id', auth, (req, res) => {
  const e = get('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json(assembleEnquiry(e));
});
app.post('/api/enquiries', auth, (req, res) => {
  const d = req.body;
  if (!d.customer_id) return res.status(400).json({ error: 'Customer required' });
  const id  = nextId('enquiries','ENQ-');
  const now = nowStr();
  run('INSERT INTO enquiries VALUES(?,?,?,?,?,?,?,?,?)',
    [id, d.customer_id, req.session.user.id, d.assigned_to||null, d.status||'new', d.priority||'normal', d.notes||'', now, now]);
  (d.items||[]).forEach((item, idx) => {
    run('INSERT INTO enquiry_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuid(),id,item.component||'',item.linecard_id||null,item.ipn||'',item.manufacturer||'',
       item.target_price||null,item.target_currency||'INR',item.quantity||0,
       item.preferred_delivery_date||'',item.date_code||'',idx+1]);
  });
  run('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),id,'Enquiry created',req.session.user.name,now]);
  saveNow(); res.json({ id });
});
app.put('/api/enquiries/:id', auth, (req, res) => {
  const e = get('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const d   = req.body;
  const now = nowStr();
  run('UPDATE enquiries SET status=?,assigned_to=?,priority=?,notes=?,quote_no=?,zoho_quote_no=?,file_ref=?,valid_until=?,quote_notes=?,updated_at=? WHERE id=?',
    [d.status||e.status, d.assigned_to??e.assigned_to, d.priority||e.priority, d.notes??e.notes,
     d.quote_no??e.quote_no??'', d.zoho_quote_no??e.zoho_quote_no??'', d.file_ref??e.file_ref??'',
     d.valid_until??e.valid_until??'', d.quote_notes??e.quote_notes??'', now, req.params.id]);
  if (d.items !== undefined) {
    run('DELETE FROM enquiry_items WHERE enquiry_id=?', [req.params.id]);
    d.items.forEach((item, idx) => {
      run('INSERT INTO enquiry_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [item.id||uuid(),req.params.id,item.component||'',item.linecard_id||null,item.ipn||'',item.manufacturer||'',
         item.target_price||null,item.target_currency||'INR',item.quantity||0,
         item.preferred_delivery_date||'',item.date_code||'',idx+1]);
    });
  }
  if (d.sourcing !== undefined) {
    d.sourcing.forEach(s => {
      if (!s.enquiry_item_id) return; // skip rows with no item reference
      const sid = s.id || uuid();
      // Try to find by id OR by enquiry_id + enquiry_item_id (handles first-time saves)
      const byId      = s.id ? get('SELECT id FROM enquiry_sourcing WHERE id=?', [s.id]) : null;
      const byItemId  = get('SELECT id FROM enquiry_sourcing WHERE enquiry_id=? AND enquiry_item_id=?', [req.params.id, s.enquiry_item_id]);
      const existing  = byId || byItemId;
      if (existing) {
        run('UPDATE enquiry_sourcing SET supplier_id=?,sourced_price=?,sourced_currency=?,quote_price=?,quote_currency=?,availability=?,lead_time=?,notes=?,updated_by=?,updated_at=? WHERE id=?',
          [s.supplier_id||null,s.sourced_price||null,s.sourced_currency||'USD',s.quote_price||null,s.quote_currency||'INR',s.availability||'',s.lead_time||'',s.notes||'',req.session.user.id,now,existing.id]);
      } else {
        run('INSERT INTO enquiry_sourcing VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [sid,req.params.id,s.enquiry_item_id,s.supplier_id||null,s.sourced_price||null,s.sourced_currency||'USD',s.quote_price||null,s.quote_currency||'INR',s.availability||'',s.lead_time||'',s.notes||'',req.session.user.id,now]);
      }
    });
  }
  // Save additional charges if provided
  if (d.charges !== undefined) {
    const ch = d.charges;
    const existCh = get('SELECT enquiry_id FROM enquiry_charges WHERE enquiry_id=?', [req.params.id]);
    if (existCh) {
      run('UPDATE enquiry_charges SET customs=?,handling=?,freight=?,currency=?,notes=? WHERE enquiry_id=?',
        [ch.customs||0, ch.handling||0, ch.freight||0, ch.currency||'INR', ch.notes||'', req.params.id]);
    } else {
      run('INSERT INTO enquiry_charges VALUES(?,?,?,?,?,?)',
        [req.params.id, ch.customs||0, ch.handling||0, ch.freight||0, ch.currency||'INR', ch.notes||'']);
    }
  }
  run('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),req.params.id, d._action||'Enquiry updated', req.session.user.name, now]);
  saveNow(); res.json(assembleEnquiry(get('SELECT * FROM enquiries WHERE id=?', [req.params.id])));
});

// ── QUOTES ───────────────────────────────────────────────────
app.get('/api/quotes', auth, (req, res) => res.json(all('SELECT * FROM quotes ORDER BY created_at DESC')));
app.post('/api/quotes', auth, (req, res) => {
  const d = req.body;
  if (!d.customer_id || !d.quote_no) return res.status(400).json({ error: 'customer_id and quote_no required' });
  if (get('SELECT id FROM quotes WHERE quote_no=?', [d.quote_no])) return res.status(409).json({ error: 'Quote number exists' });
  const id = uuid();
  run('INSERT INTO quotes VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.enquiry_id||null,d.customer_id,d.quote_no,d.zoho_quote_no||'',d.file_ref||'','active',d.valid_until||'',req.session.user.id,nowStr(),d.notes||'']);
  if (d.enquiry_id) {
    run('UPDATE enquiries SET status=?,updated_at=? WHERE id=?', ['quoted',nowStr(),d.enquiry_id]);
    run('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),d.enquiry_id,`Quote ${d.quote_no} created`,req.session.user.name,nowStr()]);
  }
  saveNow(); res.json({ id });
});
app.put('/api/quotes/:id', auth, (req, res) => {
  const d = req.body;
  run('UPDATE quotes SET quote_no=?,zoho_quote_no=?,file_ref=?,status=?,valid_until=?,notes=? WHERE id=?',
    [d.quote_no,d.zoho_quote_no||'',d.file_ref||'',d.status||'active',d.valid_until||'',d.notes||'',req.params.id]);
  saveNow(); res.json({ ok: true });
});

// ── ORDERS ───────────────────────────────────────────────────
app.get('/api/orders', auth, (req, res) => {
  const u = req.session.user;
  const perms = getPerms(u);
  const orders = perms.canSeeAll
    ? all('SELECT * FROM orders ORDER BY created_at DESC')
    : all('SELECT * FROM orders WHERE created_by=? ORDER BY created_at DESC', [u.id]);
  res.json(orders.map(o => stripSensitive(assembleOrder(o), u)));
});
app.get('/api/orders/:id', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(stripSensitive(assembleOrder(o), req.session.user));
});
app.post('/api/orders', auth, (req, res) => {
  const d = req.body;
  if (!d.id || !d.customer_id) return res.status(400).json({ error: 'id and customer_id required' });
  if (!d.po_number) return res.status(400).json({ error: 'PO number is mandatory' });
  if (get('SELECT id FROM orders WHERE id=?', [d.id])) return res.status(409).json({ error: 'Order ID exists' });
  run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [d.id,d.customer_ref||'',d.customer_id,d.enquiry_id||null,d.quote_id||null,
     d.po_number,d.po_file_ref||'',d.enquiry_no||'',d.quote_no||'',
     d.tentative_date||'','open',req.session.user.id,todayStr(),null,d.notes||'']);
  const supMap = {};
  (d.lineItems||[]).forEach((item, idx) => {
    const lid = item.id || uuid().slice(0,8);
    run('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [lid,d.id,item.component,item.manufacturer||'',item.ipn||'',item.qty||0,
       item.unit_price||0,item.procurement_price||0,item.currency||'INR',
       item.order_date||'',item.delivery_date||'',item.supplier_id||'','negotiating',idx+1]);
    if (item.supplier_id) { if (!supMap[item.supplier_id]) supMap[item.supplier_id]=[]; supMap[item.supplier_id].push(lid); }
  });
  Object.entries(supMap).forEach(([sid, iids]) => {
    const soid = uuid().slice(0,8);
    run('INSERT INTO supplier_orders VALUES(?,?,?,?,?,?,?)', [soid,d.id,sid,'','pending',null,'']);
    iids.forEach(iid => run('INSERT INTO supplier_order_items VALUES(?,?)', [soid,iid]));
  });
  run('INSERT INTO customer_shipping VALUES(?,?,?,?,?,?)', [d.id,'pending',null,'','','']);
  run('INSERT INTO order_documents VALUES(?,?,?,?,?,?,?)', [d.id,'','','','',d.po_file_ref||'','']);
  run('INSERT INTO order_history VALUES(?,?,?,?,?,?)', [uuid(),d.id,'Order created',req.session.user.name,'',nowStr()]);
  saveNow(); res.json({ id: d.id });
});
app.put('/api/orders/:id', auth, (req, res) => {
  const oid = req.params.id;
  const o = get('SELECT * FROM orders WHERE id=?', [oid]);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const u = req.session.user;
  const perms = getPerms(u);
  // Only creator, admin, or procurement can edit
  const canEdit = o.created_by === u.id || ['admin','manager'].includes(u.role) || u.department === 'procurement';
  if (!canEdit) return res.status(403).json({ error: 'Only the order creator or procurement team can edit orders' });

  const d = req.body;

  // Prevent closing if any line item undelivered
  if (d.status === 'closed') {
    const undelivered = all("SELECT id FROM order_items WHERE order_id=? AND line_status != 'delivered'", [oid]);
    if (undelivered.length > 0) return res.status(400).json({ error: `Cannot close order: ${undelivered.length} line item(s) not yet delivered` });
    const docs = get('SELECT * FROM order_documents WHERE order_id=?', [oid]);
    if (!docs?.delivery_slip || !docs?.packing_list || !docs?.invoice) {
      return res.status(400).json({ error: 'Cannot close: Delivery Slip, Packing List, and Invoice are required' });
    }
    // E-way bill check for Indian orders > 50000 INR
    const items = all('SELECT * FROM order_items WHERE order_id=?', [oid]);
    const totalInr = items.filter(i => i.currency==='INR').reduce((s,i)=>s+(i.qty*i.unit_price),0);
    const cust = get('SELECT country FROM customers WHERE id=?', [o.customer_id]);
    if (cust?.country === 'India' && totalInr > 50000 && !docs?.eway_bill) {
      return res.status(400).json({ error: 'E-way Bill required for Indian deliveries above ₹50,000' });
    }
  }

  run('UPDATE orders SET customer_ref=?,enquiry_no=?,quote_no=?,tentative_date=?,status=?,po_number=?,notes=? WHERE id=?',
    [d.customer_ref??o.customer_ref, d.enquiry_no??o.enquiry_no, d.quote_no??o.quote_no,
     d.tentative_date??o.tentative_date, d.status??o.status,
     d.po_number??o.po_number, d.notes??o.notes, oid]);

  if (d.status === 'closed') run('UPDATE orders SET closed_at=? WHERE id=?', [nowStr(), oid]);

  if (d.lineItems !== undefined) {
    run('DELETE FROM order_items WHERE order_id=?', [oid]);
    run('DELETE FROM supplier_orders WHERE order_id=?', [oid]);
    const supMap = {};
    d.lineItems.forEach((item, idx) => {
      const lid = item.id || uuid().slice(0,8);
      run('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [lid,oid,item.component,item.manufacturer||'',item.ipn||'',item.qty||0,
         item.unit_price||0,item.procurement_price||0,item.currency||'INR',
         item.order_date||'',item.delivery_date||'',item.supplier_id||'',item.line_status||'negotiating',idx+1]);
      if (item.supplier_id) { if (!supMap[item.supplier_id]) supMap[item.supplier_id]=[]; supMap[item.supplier_id].push(lid); }
    });
    Object.entries(supMap).forEach(([sid, iids]) => {
      const existSo = get('SELECT * FROM supplier_orders WHERE order_id=? AND supplier_id=?', [oid, sid]);
      const soid = existSo?.id || uuid().slice(0,8);
      run('INSERT INTO supplier_orders VALUES(?,?,?,?,?,?,?)',
        [soid,oid,sid,existSo?.po_no||'',existSo?.shipping_status||'pending',existSo?.shipper_id||null,existSo?.tracking_no||'']);
      iids.forEach(iid => { if (!get('SELECT 1 FROM supplier_order_items WHERE supplier_order_id=? AND item_id=?',[soid,iid])) run('INSERT INTO supplier_order_items VALUES(?,?)',[soid,iid]); });
    });
  }
  if (d.lineItemStatus !== undefined) {
    const { item_id, line_status } = d.lineItemStatus;
    run('UPDATE order_items SET line_status=? WHERE id=? AND order_id=?', [line_status, item_id, oid]);
  }
  if (d.supplierOrders !== undefined) {
    d.supplierOrders.forEach(so => run('UPDATE supplier_orders SET po_no=?,shipping_status=?,shipper_id=?,tracking_no=? WHERE id=?',
      [so.po_no||'',so.shipping_status||'pending',so.shipper_id||null,so.tracking_no||'',so.id]));
  }
  if (d.customerShipping !== undefined) {
    const cs = d.customerShipping;
    run('INSERT OR REPLACE INTO customer_shipping VALUES(?,?,?,?,?,?)',
      [oid,cs.status||'pending',cs.shipper_id||null,cs.tracking_no||'',cs.delivery_date||'',cs.comments||'']);
  }
  if (d.documents !== undefined) {
    const doc = d.documents;
    run('INSERT OR REPLACE INTO order_documents VALUES(?,?,?,?,?,?,?)',
      [oid,doc.delivery_slip||'',doc.packing_list||'',doc.invoice||'',doc.eway_bill||'',doc.po_file||'',doc.comments||'']);
  }
  run('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(),oid,d._action||'Order updated',u.name,d._comment||'',nowStr()]);
  saveNow();
  res.json(stripSensitive(assembleOrder(get('SELECT * FROM orders WHERE id=?',[oid])), u));
});
app.delete('/api/orders/:id', adminOnly, (req, res) => {
  run('DELETE FROM orders WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
});

// ── APPROVAL WORKFLOWS ───────────────────────────────────────
app.get('/api/approvals/workflows', auth, (req, res) => res.json(all("SELECT * FROM approval_workflows WHERE active=1")));
app.post('/api/approvals/workflows', adminOnly, (req, res) => {
  const d = req.body;
  const id = uuid();
  run('INSERT INTO approval_workflows VALUES(?,?,?,?,?,?)',
    [id,d.name,d.entity_type,JSON.stringify(d.steps),1,nowStr()]);
  saveNow(); res.json({ id });
});
app.put('/api/approvals/workflows/:id', adminOnly, (req, res) => {
  const d = req.body;
  run('UPDATE approval_workflows SET name=?,steps=?,active=? WHERE id=?',
    [d.name,JSON.stringify(d.steps),d.active?1:0,req.params.id]);
  saveNow(); res.json({ ok: true });
});
app.get('/api/approvals/requests', auth, (req, res) => {
  const reqs = all('SELECT * FROM approval_requests ORDER BY requested_at DESC');
  res.json(reqs.map(r => ({
    ...r,
    actions: all('SELECT * FROM approval_actions WHERE request_id=? ORDER BY step', [r.id])
  })));
});
app.post('/api/approvals/requests', auth, (req, res) => {
  const d = req.body;
  const id = uuid();
  run('INSERT INTO approval_requests VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id,d.workflow_id,d.entity_type,d.entity_id,0,'pending',req.session.user.id,nowStr(),null,d.notes||'']);
  saveNow(); res.json({ id });
});
app.post('/api/approvals/requests/:id/action', auth, (req, res) => {
  const r = get('SELECT * FROM approval_requests WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { action, comment } = req.body;
  run('INSERT INTO approval_actions VALUES(?,?,?,?,?,?)',
    [uuid(),r.id,r.current_step,action,req.session.user.id,comment||'']);
  const newStatus = action === 'approve' ? (r.current_step + 1 >= 3 ? 'approved' : 'pending') : 'rejected';
  run('UPDATE approval_requests SET status=?,current_step=?,resolved_at=? WHERE id=?',
    [newStatus, r.current_step + 1, newStatus !== 'pending' ? nowStr() : null, r.id]);
  saveNow(); res.json({ ok: true, status: newStatus });
});

// ── REPORTS ──────────────────────────────────────────────────
app.get('/api/reports/summary', auth, (req, res) => {
  const g = q => (get(q)||{c:0}).c;
  res.json({
    total:         g("SELECT COUNT(*) as c FROM orders"),
    open:          g("SELECT COUNT(*) as c FROM orders WHERE status='open'"),
    closed:        g("SELECT COUNT(*) as c FROM orders WHERE status='closed'"),
    delivered:     g("SELECT COUNT(*) as c FROM orders WHERE status='delivered'"),
    failed:        g("SELECT COUNT(*) as c FROM orders WHERE status='failed'"),
    hold:          g("SELECT COUNT(*) as c FROM orders WHERE status='hold'"),
    delayed:       g("SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('delivered','failed','closed') AND tentative_date<date('now') AND tentative_date!=''"),
    customers:     g("SELECT COUNT(*) as c FROM customers"),
    suppliers:     g("SELECT COUNT(*) as c FROM suppliers"),
    domestic:      g("SELECT COUNT(*) as c FROM suppliers WHERE type='domestic'"),
    international: g("SELECT COUNT(*) as c FROM suppliers WHERE type='international'"),
    linecards:     g("SELECT COUNT(*) as c FROM linecards"),
    enquiries:     g("SELECT COUNT(*) as c FROM enquiries"),
    enq_new:       g("SELECT COUNT(*) as c FROM enquiries WHERE status='new'"),
    enq_sourcing:  g("SELECT COUNT(*) as c FROM enquiries WHERE status='sourcing'"),
    enq_quoted:    g("SELECT COUNT(*) as c FROM enquiries WHERE status='quoted'"),
    sourcing:      g("SELECT COUNT(*) as c FROM orders WHERE status='open'"),
    procurement:   g("SELECT COUNT(*) as c FROM order_items WHERE line_status='procurement'"),
    in_transit:    g("SELECT COUNT(*) as c FROM order_items WHERE line_status='shipped'"),
  });
});

// ── CATCH-ALL ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  const idx = path.join(__dirname, '..', 'client', 'build', 'index.html');
  fs.existsSync(idx) ? res.sendFile(idx) : res.json({ message: 'Ciflux OMS v2 API running. Build client first.' });
});

// ── START ────────────────────────────────────────────────────
function getLanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) { if (net.family === 'IPv4' && !net.internal) return net.address; }
  }
  return '127.0.0.1';
}
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLanIp();
    console.log('\n' + '═'.repeat(52));
    console.log('  ⚡  CIFLUX OMS v2  –  Electronic Components');
    console.log('═'.repeat(52));
    console.log(`  Local  →  http://localhost:${PORT}`);
    console.log(`  LAN    →  http://${ip}:${PORT}`);
    console.log('═'.repeat(52));
    console.log('  admin/admin123  ·  sales1/pass123');
    console.log('  sourcing1/pass123  ·  procure1/pass123');
    console.log('═'.repeat(52) + '\n');
  });
}).catch(err => { console.error('Start failed:', err); process.exit(1); });
