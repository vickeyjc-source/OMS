// server/index.js  –  Ciflux OMS v2
require('dotenv').config();           // loads .env from project root
const express  = require('express');

// DEBUG: catch any silent crash
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});
const fs       = require('fs');
const path     = require('path');

// ── Logging system — 24hr rotation, captures everything ─────────────────────
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_SERVER_ALL  = path.join(LOG_DIR, 'server.log');
const LOG_SERVER_ERR  = path.join(LOG_DIR, 'server-errors.log');
const LOG_CLIENT_ERR  = path.join(LOG_DIR, 'client-errors.log');

// Rotate a log file if it's older than 24 hours (overwrite with fresh file)
function rotateIfOld(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
      if (ageHours >= 24) {
        fs.writeFileSync(filePath,
          `[${new Date().toISOString()}] ── Log rotated (24hr) ──\n`);
      }
    }
  } catch(_) {}
}

// Rotate all logs on startup
rotateIfOld(LOG_SERVER_ALL);
rotateIfOld(LOG_SERVER_ERR);
rotateIfOld(LOG_CLIENT_ERR);

// Schedule rotation check every hour
setInterval(() => {
  rotateIfOld(LOG_SERVER_ALL);
  rotateIfOld(LOG_SERVER_ERR);
  rotateIfOld(LOG_CLIENT_ERR);
}, 3600000);

function writeLog(filePath, text) {
  try { fs.appendFileSync(filePath, text); } catch(_) {}
}

function logError(context, err) {
  const line = `[${new Date().toISOString()}] ${context}\n  ${err?.stack || err}\n\n`;
  writeLog(LOG_SERVER_ERR, line);
  writeLog(LOG_SERVER_ALL, line);
  console.error('[ERROR]', context, err?.message || err);
}

// Patch console.error → also write to error log
const _origErr = console.error.bind(console);
console.error = (...args) => {
  _origErr(...args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog(LOG_SERVER_ERR, `[${new Date().toISOString()}] ${msg}\n`);
  writeLog(LOG_SERVER_ALL, `[${new Date().toISOString()}] [ERR] ${msg}\n`);
};

// Patch console.log → write to server.log (full log)
const _origLog = console.log.bind(console);
console.log = (...args) => {
  _origLog(...args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog(LOG_SERVER_ALL, `[${new Date().toISOString()}] ${msg}\n`);
};
const cors     = require('cors');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { v4: uuid } = require('uuid');
const os   = require('os');
const { initDb, all, run, get, allAsync, runAsync, getAsync, saveNow, nextId, nextIdAsync, assembleOrder, assembleEnquiry } = require('./db');

const app    = express();
const PORT   = Number(process.env.BACKEND_PORT || process.env.PORT || 8081);
const SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || true;
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction || process.env.FORCE_SECURE_COOKIES === 'true';

if (!SECRET) {
  console.error('Missing required environment variable: JWT_SECRET');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// ── Request logger — every request captured to server.log ────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)\n`;
    writeLog(LOG_SERVER_ALL, line);
    if (res.statusCode >= 400) writeLog(LOG_SERVER_ERR, line);
  });
  next();
});
app.use(express.json({ limit: '10mb' }));
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('Missing required environment variable: SESSION_SECRET');
  process.exit(1);
}
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 8*60*60*1000,
    httpOnly: true,
    sameSite: useSecureCookies ? 'none' : 'lax',
    secure: useSecureCookies
  }
}));

const BUILD = path.join(__dirname, '..', 'client', 'build');
const PORTAL = path.join(__dirname, '..', 'portal', 'index.html');

// Serve the portal landing page at the root URL
if (fs.existsSync(PORTAL)) {
  app.get('/', (req, res) => res.sendFile(PORTAL));
}

if (fs.existsSync(BUILD)) {
  // index.html must never be cached — always re-fetch so new deploys take effect
  const noCache = (req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
    next();
  };
  app.use('/app', noCache, express.static(BUILD));
  app.use(noCache, express.static(BUILD));
}

app.use((req, res, next) => {
  if (req.path.startsWith('/app/api')) {
    req.url = req.url.replace(/^\/app/, '');
  }
  next();
});

// ── Disable caching for ALL /api routes ──────────────────────────────────────
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.get('/api/ping', (req, res) => {
  res.json({ ok: true, host: req.hostname, path: req.path, time: new Date().toISOString() });
});

// ── Helpers ──────────────────────────────────────────────────
function auth(req, res, next) {
  if (req.session?.user) return next();
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(h.slice(7), SECRET);
      getAsync('SELECT id,name,username,email,role,department,status FROM users WHERE id=?', [decoded.id])
        .then(fresh => {
          if (!fresh || fresh.status !== 'active') {
            console.log(`[AUTH] BEARER FAILED path=${req.path} id=${decoded.id || 'unknown'} status=${fresh?.status || 'missing'}`);
            return res.status(401).json({ error: 'Unauthorized' });
          }
          req.session.user = { id: fresh.id, name: fresh.name, role: fresh.role, department: fresh.department, username: fresh.username };
          next();
        })
        .catch(err => {
          console.log(`[AUTH] BEARER ERROR path=${req.path} err=${err?.message || 'unknown'}`);
          res.status(401).json({ error: 'Unauthorized' });
        });
      return;
    } catch (err) {
      console.log(`[AUTH] BEARER PARSE FAILED path=${req.path} err=${err?.message || 'invalid token'}`);
    }
  }
  console.log(`[AUTH] UNAUTHORIZED path=${req.path} user=${req.session?.user?.id || 'none'} authHeader=${!!h}`);
  return res.status(401).json({ error: 'Unauthorized' });
}
function adminOnly(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!['admin','manager'].includes(req.session.user.role)) return res.status(403).json({ error: 'Admin only' });
  next();
}
const nowStr   = () => new Date().toISOString().slice(0,16).replace('T',' ');
const nowFull  = () => new Date().toISOString().slice(0,19).replace('T',' ');  // incl. seconds
const todayStr = () => new Date().toISOString().slice(0,10);

// Append one immutable row to the audit log. `by` is the session user.
async function logActivity(entry, by) {
  try {
    await runAsync(
      `INSERT INTO activity_log(id,action,area,module,label,entity_type,entity_id,entity_name,entity_email,entity_username,row_count,performed_by,performed_by_name,performed_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['log'+uuid().slice(0,12), entry.action, entry.area, entry.module||'', entry.label||'',
       entry.entity_type||'', entry.entity_id||'', entry.entity_name||'', entry.entity_email||'', entry.entity_username||'',
       entry.row_count||0, by?.username||'', by?.name||'', nowFull()]
    );
  } catch(e) { console.warn('[activity_log] failed:', e.message); }
}

const FILE_UPLOAD_LIMIT_MB = Number(process.env.FILE_UPLOAD_LIMIT_MB || 25);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_UPLOAD_LIMIT_MB * 1024 * 1024 },
});

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Convert empty-string / undefined / null → null for numeric DB columns
// Prevents "invalid input syntax for type numeric: ''" errors
function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function safeFileName(name) {
  return path.basename(name || 'file')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180) || 'file';
}

let azureContainerClient = null;
let azureSharedKeyCredential = null;
function getAzureContainerClient() {
  if (azureContainerClient) return azureContainerClient;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || process.env.AZURE_BLOB_CONTAINER || 'oms-files';
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    azureContainerClient = service.getContainerClient(containerName);
    return azureContainerClient;
  }
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey  = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw new Error('Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY.');
  }
  azureSharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  const service = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, azureSharedKeyCredential);
  azureContainerClient = service.getContainerClient(containerName);
  return azureContainerClient;
}

function fileDto(row) {
  if (!row) return null;
  return {
    ...row,
    download_url: `/api/files/${row.id}/download`,
  };
}

const SECTION_DEFINITIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'new-enquiry', label: 'New Enquiry' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'orders', label: 'All Orders' },
  { key: 'new-order', label: 'New Order' },
  { key: 'sourcing-bin', label: 'Sourcing Bin' },
  { key: 'procurement-bin', label: 'Procurement Bin' },
  { key: 'delivery-hub', label: 'Delivery Hub' },
  { key: 'inventory', label: 'Stock Inventory' },
  { key: 'closed-bin', label: 'Closed Bin' },
  { key: 'deleted-bin', label: 'Recycle Bin', adminOnly: true, locked: true },
  { key: 'danger-zone', label: 'Danger Zone', adminOnly: true, locked: true },
  { key: 'finance', label: 'Finance' },
  { key: 'customers', label: 'Customers' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'linecards', label: 'Line Cards' },
  { key: 'users', label: 'User Management', adminOnly: true },
  { key: 'approvals', label: 'Approvals' },
  { key: 'settings', label: 'Settings', adminOnly: true },
  { key: 'tax-settings', label: 'Tax Settings', adminOnly: true },
  { key: 'reports', label: 'Reports' },
];
const SECTION_KEYS = SECTION_DEFINITIONS.map(s => s.key);
const ADMIN_SECTION_KEYS = SECTION_DEFINITIONS.filter(s => s.adminOnly).map(s => s.key);

async function getAllowedSections(user) {
  if (!user) return [];
  if (user.role === 'admin') return SECTION_KEYS;
  const rows = await allAsync(
    'SELECT section_key FROM section_permissions WHERE role=? AND department=? AND enabled=1',
    [user.role || 'user', user.department || 'sales']
  );
  return rows.map(r => r.section_key);
}

async function userDto(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email || '',
    role: user.role,
    department: user.department,
    status: user.status,
    perms: getPerms(user),
    allowedSections: await getAllowedSections(user),
  };
}

async function canAccessSection(user, sectionKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_SECTION_KEYS.includes(sectionKey)) return false;
  return (await getAllowedSections(user)).includes(sectionKey);
}

function sectionGate(sectionKey) {
  return async (req, res, next) => {
    try {
      if (!(await canAccessSection(req.session.user, sectionKey))) {
        return res.status(403).json({ error: 'Section access denied' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

function sectionGateAny(sectionKeys) {
  return async (req, res, next) => {
    try {
      for (const sectionKey of sectionKeys) {
        if (await canAccessSection(req.session.user, sectionKey)) return next();
      }
      return res.status(403).json({ error: 'Section access denied' });
    } catch (e) {
      next(e);
    }
  };
}

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
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { username: rawUsername, password: rawPassword } = req.body;
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) {
    console.log(`[AUTH] LOGIN FAILED reason=MissingCredentials body=${JSON.stringify({ username: !!username, password: !!password })}`);
    return res.status(400).json({ error: 'Required' });
  }

  const user = await getAsync("SELECT * FROM users WHERE (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)) AND status='active'", [username, username]);
  console.log(`[AUTH] LOOKUP username=${JSON.stringify(username)} found=${!!user} dbUsername=${user?.username||'none'} dbEmail=${user?.email||'none'} status=${user?.status||'none'}`);
  if (!user) {
    console.log(`[AUTH] LOGIN FAILED username=${username} reason=UserNotFound`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const pwMatch = bcrypt.compareSync(password, user.password);
  console.log(`[AUTH] PASSWORD CHECK username=${username} match=${pwMatch}`);
  if (!pwMatch) {
    console.log(`[AUTH] LOGIN FAILED username=${username} reason=WrongPassword`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const payload = { id: user.id, name: user.name, role: user.role, department: user.department, username: user.username };
  req.session.user = payload;
  console.log(`[AUTH] LOGIN SUCCESS id=${user.id} username=${username} role=${user.role}`);
  return res.json({ ...(await userDto(user)), token: jwt.sign(payload, SECRET, { expiresIn: '8h' }) });
}));
app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// Verify a manager/admin username+password — used to unlock locked quote/order edits
app.post('/api/auth/verify-manager', auth, asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  // Look up by provided username (must be manager/admin), fallback to session user
  const user = username
    ? await getAsync("SELECT * FROM users WHERE (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)) AND status='active'", [username, username])
    : await getAsync('SELECT * FROM users WHERE id=?', [req.session.user.id]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!['admin','manager'].includes(user.role)) return res.status(403).json({ error: 'Only managers or admins can unlock' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ ok: true, name: user.name, role: user.role });
}));
app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const u = await getAsync('SELECT id,name,username,email,role,department,status FROM users WHERE id=?', [req.session.user.id]);
  console.log(`[AUTH] ME SUCCESS id=${req.session.user.id} path=${req.path}`);
  res.json(u ? await userDto(u) : { ...req.session.user, allowedSections: await getAllowedSections(req.session.user) });
}));

// ── FILES / AZURE BLOB STORAGE ─────────────────────────────────────────────
app.post('/api/files', auth, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const entityType = (req.body.entity_type || '').trim();
  const entityId   = (req.body.entity_id || '').trim();
  const fieldName  = (req.body.field_name || '').trim();
  const fileName   = safeFileName(req.file.originalname);
  const container  = getAzureContainerClient();
  await container.createIfNotExists();

  const blobName = [
    entityType || 'general',
    entityId || 'unassigned',
    `${Date.now()}-${uuid()}-${fileName}`,
  ].join('/');
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(req.file.buffer, {
    blobHTTPHeaders: {
      blobContentType: req.file.mimetype || 'application/octet-stream',
    },
    metadata: {
      originalName: fileName,
      uploadedBy: req.session.user.id,
      entityType: entityType || 'general',
      entityId: entityId || '',
      fieldName: fieldName || '',
    },
  });

  const id = uuid();
  await runAsync(`INSERT INTO app_files(id,original_name,mime_type,size_bytes,storage_provider,
       container_name,blob_name,entity_type,entity_id,field_name,uploaded_by,uploaded_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fileName, req.file.mimetype || '', req.file.size || 0, 'azure',
     container.containerName, blobName, entityType, entityId, fieldName,
     req.session.user.id, nowStr()]);
  saveNow();
  res.status(201).json(fileDto(await getAsync('SELECT * FROM app_files WHERE id=?', [id])));
}));

app.get('/api/files', auth, asyncRoute(async (req, res) => {
  const { entity_type, entity_id, field_name } = req.query || {};
  const where = [];
  const params = [];
  if (entity_type) { where.push('entity_type=?'); params.push(entity_type); }
  if (entity_id)   { where.push('entity_id=?');   params.push(entity_id); }
  if (field_name)  { where.push('field_name=?');  params.push(field_name); }
  const sql = 'SELECT * FROM app_files' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY uploaded_at DESC';
  res.json((await allAsync(sql, params)).map(fileDto));
}));

app.get('/api/files/:id', auth, asyncRoute(async (req, res) => {
  const f = await getAsync('SELECT * FROM app_files WHERE id=?', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'File not found' });
  res.json(fileDto(f));
}));

app.get('/api/files/:id/download', auth, asyncRoute(async (req, res) => {
  const f = await getAsync('SELECT * FROM app_files WHERE id=?', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'File not found' });

  const container = getAzureContainerClient();
  const blob = container.getBlockBlobClient(f.blob_name);
  const exists = await blob.exists();
  if (!exists) return res.status(404).json({ error: 'Stored blob not found' });

  res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(f.original_name)}"`);
  const download = await blob.download();
  download.readableStreamBody.pipe(res);
}));

app.get('/api/files/:id/sas', auth, asyncRoute(async (req, res) => {
  const f = await getAsync('SELECT * FROM app_files WHERE id=?', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'File not found' });
  if (!azureSharedKeyCredential) getAzureContainerClient();
  if (!azureSharedKeyCredential) {
    return res.status(400).json({ error: 'SAS URLs require AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY. Use /download when configured by connection string.' });
  }
  const expiresOn = new Date(Date.now() + 10 * 60 * 1000);
  const sas = generateBlobSASQueryParameters({
    containerName: f.container_name,
    blobName: f.blob_name,
    permissions: BlobSASPermissions.parse('r'),
    expiresOn,
  }, azureSharedKeyCredential).toString();
  const container = getAzureContainerClient();
  const blob = container.getBlockBlobClient(f.blob_name);
  res.json({ url: `${blob.url}?${sas}`, expires_on: expiresOn.toISOString() });
}));

app.delete('/api/files/:id', auth, asyncRoute(async (req, res) => {
  const f = await getAsync('SELECT * FROM app_files WHERE id=?', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'File not found' });
  const canDelete = f.uploaded_by === req.session.user.id || ['admin','manager'].includes(req.session.user.role);
  if (!canDelete) return res.status(403).json({ error: 'Only uploader or manager can delete this file' });

  const container = getAzureContainerClient();
  await container.getBlockBlobClient(f.blob_name).deleteIfExists();
  await runAsync('DELETE FROM app_files WHERE id=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));

// ── USERS ────────────────────────────────────────────────────
app.get('/api/users', auth, asyncRoute(async (req, res) => {
  const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
  const where = includeDeleted ? '' : "WHERE status != 'deleted'";
  res.json(await allAsync(`SELECT id,name,username,email,role,department,status,created,plain_password FROM users ${where} ORDER BY department,name`));
}));
app.post('/api/users', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.name || !d.username || !d.password) return res.status(400).json({ error: 'Required' });
  if (await getAsync('SELECT id FROM users WHERE username=?', [d.username])) return res.status(409).json({ error: 'Username exists' });
  const id = 'u' + uuid().slice(0,8);
  await runAsync('INSERT INTO users(id,name,username,email,password,department,role,status,created,plain_password) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id, d.name, d.username, d.email||'', bcrypt.hashSync(d.password,10), d.department||'sales', d.role||'user', d.status||'active', todayStr(), d.password]);
  saveNow(); res.json({ id });
}));
app.put('/api/users/:id', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  const u = await getAsync('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  await runAsync('UPDATE users SET name=?,username=?,email=?,password=?,department=?,role=?,status=?,plain_password=? WHERE id=?',
    [d.name||u.name, d.username||u.username, d.email||u.email,
     d.password ? bcrypt.hashSync(d.password,10) : u.password,
     d.department||u.department, d.role||u.role, d.status||u.status,
     d.password ? d.password : (u.plain_password||''),
     req.params.id]);
  saveNow(); res.json({ ok: true });
}));
app.delete('/api/users/:id', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  // Soft delete — move to Recycle Bin instead of removing from the database.
  const u = await getAsync('SELECT id,name,email,username,status FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.id === req.session.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  await runAsync('UPDATE users SET status=? WHERE id=?', ['deleted', req.params.id]);
  await logActivity({ action:'delete', area:'recycle', module:'users', label:'Users', entity_type:'user', entity_id:u.id, entity_name:u.name, entity_email:u.email, entity_username:u.username, row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));
app.post('/api/users/:id/restore', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  const u = await getAsync('SELECT id,name,email,username,status FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.status !== 'deleted') return res.status(400).json({ error: 'User is not in the Recycle Bin' });
  await runAsync('UPDATE users SET status=? WHERE id=?', ['active', req.params.id]);
  await logActivity({ action:'restore', area:'recycle', module:'users', label:'Users', entity_type:'user', entity_id:u.id, entity_name:u.name, entity_email:u.email, entity_username:u.username, row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));

// ── SECTION PERMISSIONS ──────────────────────────────────────
app.get('/api/section-permissions', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  const { role = 'user', department = 'sales' } = req.query || {};
  const rows = await allAsync(
    'SELECT role,department,section_key,enabled,updated_at,updated_by FROM section_permissions WHERE role=? AND department=? ORDER BY section_key',
    [role, department]
  );
  const byKey = Object.fromEntries(rows.map(r => [r.section_key, Number(r.enabled) === 1]));
  res.json({
    role,
    department,
    sections: SECTION_DEFINITIONS.map(s => ({ ...s, enabled: Boolean(byKey[s.key]) })),
  });
}));

app.put('/api/section-permissions', adminOnly, sectionGate('users'), asyncRoute(async (req, res) => {
  const { role = 'user', department = 'sales', sections = [] } = req.body || {};
  if (!['user','manager','admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!department) return res.status(400).json({ error: 'Department required' });
  if (!Array.isArray(sections)) return res.status(400).json({ error: 'Sections must be a list' });
  const requested = new Map(sections.map(s => [s.key, Boolean(s.enabled)]));
  const now = nowStr();
  for (const section of SECTION_DEFINITIONS) {
    // Locked sections (Recycle Bin, Danger Zone) are hard admin-only — never grantable.
    const enabled = section.locked ? false : (requested.has(section.key) ? requested.get(section.key) : false);
    await runAsync(
      `INSERT INTO section_permissions(role,department,section_key,enabled,updated_at,updated_by)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(role,department,section_key) DO UPDATE SET
         enabled=EXCLUDED.enabled,
         updated_at=EXCLUDED.updated_at,
         updated_by=EXCLUDED.updated_by`,
      [role, department, section.key, enabled ? 1 : 0, now, req.session.user.id]
    );
  }
  saveNow();
  res.json({ ok: true, role, department });
}));

app.get('/api/sections', adminOnly, sectionGate('users'), (req, res) => {
  res.json(SECTION_DEFINITIONS);
});

const SECTION_API_ACCESS = {
  customers: ['customers', 'dashboard', 'enquiries', 'new-enquiry', 'quotes', 'orders', 'new-order', 'sourcing-bin', 'procurement-bin', 'delivery-hub', 'inventory', 'finance', 'closed-bin', 'reports'],
  linecards: ['linecards', 'enquiries', 'new-enquiry', 'suppliers', 'inventory'],
  suppliers: ['suppliers', 'enquiries', 'new-enquiry', 'orders', 'new-order', 'sourcing-bin', 'procurement-bin', 'delivery-hub', 'inventory', 'finance', 'closed-bin', 'reports'],
  enquiries: ['enquiries', 'new-enquiry', 'quotes', 'orders', 'new-order', 'sourcing-bin', 'procurement-bin', 'reports'],
  quotes: ['quotes', 'orders', 'new-order', 'sourcing-bin', 'reports'],
  orders: ['orders', 'new-order', 'quotes', 'procurement-bin', 'delivery-hub', 'finance', 'closed-bin', 'reports', 'dashboard'],
  approvals: ['approvals'],
  inventory: ['inventory', 'sourcing-bin', 'procurement-bin', 'finance'],
  settings: ['settings', 'procurement-bin', 'finance'],
  finance: ['finance', 'reports'],
};

app.use('/api/customers', auth, sectionGateAny(SECTION_API_ACCESS.customers));
app.use('/api/linecards', auth, sectionGateAny(SECTION_API_ACCESS.linecards));
app.use('/api/suppliers', auth, sectionGateAny(SECTION_API_ACCESS.suppliers));
app.use('/api/enquiries', auth, sectionGateAny(SECTION_API_ACCESS.enquiries));
app.use('/api/quotes', auth, sectionGateAny(SECTION_API_ACCESS.quotes));
app.use('/api/orders', auth, sectionGateAny(SECTION_API_ACCESS.orders));
app.use('/api/approvals', auth, sectionGateAny(SECTION_API_ACCESS.approvals));
app.use('/api/inventory', auth, sectionGateAny(SECTION_API_ACCESS.inventory));
app.use('/api/settings', auth, sectionGateAny(SECTION_API_ACCESS.settings));
app.use('/api/finance', auth, sectionGateAny(SECTION_API_ACCESS.finance));
app.use('/api/finance-queue', auth, sectionGateAny(SECTION_API_ACCESS.finance));

// ── CUSTOMERS ────────────────────────────────────────────────
app.get('/api/customers', auth, asyncRoute(async (req, res) => {
  const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
  const where = includeDeleted ? '' : "WHERE status != 'deleted'";
  const rows = await allAsync(`SELECT * FROM customers ${where} ORDER BY created DESC`);
  const counts = await Promise.all(rows.map(c => getAsync('SELECT COUNT(*) as n FROM orders WHERE customer_id=?', [c.id])));
  res.json(rows.map((c, i) => ({ ...c, orders: (counts[i] || {n:0}).n })));
}));
app.post('/api/customers', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  const userId = req.session?.user?.id || 'unknown';
  if (!d.name) {
    console.log(`[CUSTOMER CREATE] FAILED user=${userId} reason=Name required`);
    return res.status(400).json({ error: 'Name required' });
  }
  const id = await nextIdAsync('customers','CFCUST',4);
  await runAsync('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.name,d.contact||'',d.email||'',d.phone||'',d.city||'',d.state||'',d.country||'India',d.gstin||'',d.status||'active',todayStr()]);
  // Extended fields
  const ext = buildCustomerExt(d);
  await runAsync('UPDATE customers SET ' + ext.sets + ' WHERE id=?', [...ext.vals, id]);
  saveNow();
  console.log(`[CUSTOMER CREATE] SUCCESS user=${userId} id=${id} name=${d.name}`);
  res.json({ id });
}));
app.put('/api/customers/:id', auth, asyncRoute(async (req, res) => {
  const c = await getAsync('SELECT * FROM customers WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  await runAsync('UPDATE customers SET name=?,contact=?,email=?,phone=?,city=?,state=?,country=?,gstin=?,status=? WHERE id=?',
    [d.name||c.name,d.contact||c.contact,d.email||c.email,d.phone||c.phone,d.city||c.city,d.state||c.state,d.country||c.country,d.gstin||c.gstin,d.status||c.status,req.params.id]);
  const ext = buildCustomerExt(d);
  await runAsync('UPDATE customers SET ' + ext.sets + ' WHERE id=?', [...ext.vals, req.params.id]);
  saveNow(); res.json({ ok: true });
}));

function buildCustomerExt(d) {
  const fields = [
    'customer_type','salutation','first_name','last_name','mobile','pan',
    'gstin_type','place_of_supply','payment_terms','currency','customer_scope',
    'billing_attention','billing_street1','billing_street2','billing_pincode','billing_phone',
    'shipping_attention','shipping_street1','shipping_street2','shipping_city','shipping_state','shipping_country','shipping_pincode','shipping_phone',
    'bank_account_name','bank_account_no','bank_ifsc','bank_name','bank_branch',
    'bank_swift','bank_iban','bank_aba','bank_country','bank_currency',
    'contact_persons','remarks',
    'customer_no','vat_number','shipping_addresses',
    'billing_city','billing_state','billing_country'
  ];
  const sets = fields.map(f => f + '=?').join(',');
  const vals = fields.map(f => {
    if (f === 'contact_persons') return JSON.stringify(d[f] || []);
    if (f === 'shipping_addresses') return JSON.stringify(d[f] || []);
    return d[f] !== undefined ? d[f] : '';
  });
  return { sets, vals };
}
app.delete('/api/customers/:id', auth, asyncRoute(async (req, res) => {
  // Soft delete — move to the Recycle Bin instead of removing from the database.
  const c = await getAsync('SELECT id,name,email FROM customers WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  await runAsync('UPDATE customers SET status=? WHERE id=?', ['deleted', req.params.id]);
  await logActivity({ action:'delete', area:'recycle', module:'customers', label:'Customers', entity_type:'customer', entity_id:c.id, entity_name:c.name, entity_email:c.email||'', row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));
app.post('/api/customers/:id/restore', auth, asyncRoute(async (req, res) => {
  const c = await getAsync('SELECT id,name,email,status FROM customers WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'deleted') return res.status(400).json({ error: 'Customer is not in the Recycle Bin' });
  await runAsync('UPDATE customers SET status=? WHERE id=?', ['active', req.params.id]);
  await logActivity({ action:'restore', area:'recycle', module:'customers', label:'Customers', entity_type:'customer', entity_id:c.id, entity_name:c.name, entity_email:c.email||'', row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));
// Customer template download
app.get('/api/customers/template', auth, (req, res) => {
  const headers = [
    'company_name*','first_name','last_name','email','phone','mobile',
    'customer_scope','country','city','state','street1','pincode',
    'gstin','pan','vat_number','payment_terms','currency',
    'bank_account_name','bank_account_no','bank_name','bank_ifsc',
    'bank_swift','bank_iban','remarks'
  ];
  const example1 = [
    'Acme Corp','John','Doe','john@acme.com','+91-9876543210','+91-9876543210',
    'domestic','India','Mumbai','Maharashtra','123 Main Street','400001',
    '22AAAAA0000A1Z5','ABCDE1234F','','Net 30','INR',
    'John Doe','1234567890','HDFC Bank','HDFC0001234',
    '','','Sample domestic customer'
  ];
  const example2 = [
    'Global Inc','Jane','Smith','jane@global.com','+1-555-123-4567','+1-555-123-4567',
    'international','USA','New York','New York','456 Park Avenue','10001',
    '','','US123456789','Net 60','USD',
    'Jane Smith','987654321','Bank of America','',
    'BOFAUS3N','GB29NWBK60161331926819','Sample international customer'
  ];
  const csv = [headers, example1, example2].map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ciflux_customer_template.csv"');
  res.send(csv);
});
// Bulk import customers
app.post('/api/customers/bulk', auth, asyncRoute(async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });
  const created = [], errors = [];
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    if (!d.name) { errors.push(`Row ${i+2}: Company name missing`); continue; }
    try {
      const id = await nextIdAsync('customers','CFCUST',4);
      await runAsync('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [id,d.name,d.contact||'',d.email||'',d.phone||'',d.city||'',d.state||'',d.country||'India',d.gstin||'',d.status||'active',todayStr()]);
      const ext = buildCustomerExt(d);
      await runAsync('UPDATE customers SET ' + ext.sets + ' WHERE id=?', [...ext.vals, id]);
      created.push(id);
    } catch(e) { errors.push(`Row ${i+2}: ${e.message}`); }
  }
  saveNow();
  res.json({ created: created.length, errors });
}));

// ── LINECARDS ────────────────────────────────────────────────
app.get('/api/linecards', auth, asyncRoute(async (req, res) => {
  res.json(await allAsync('SELECT l.*, (SELECT COUNT(*) FROM supplier_linecards sl WHERE sl.linecard_id=l.id) as supplier_count FROM linecards l ORDER BY category,name'));
}));
app.post('/api/linecards', auth, asyncRoute(async (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = await nextIdAsync('linecards','LC');
  await runAsync('INSERT INTO linecards VALUES(?,?,?,?,?)', [id,d.name,d.category||'Other',d.description||'',todayStr()]);
  saveNow(); res.json({ id });
}));
app.put('/api/linecards/:id', auth, asyncRoute(async (req, res) => {
  const lc = await getAsync('SELECT * FROM linecards WHERE id=?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  await runAsync('UPDATE linecards SET name=?,category=?,description=? WHERE id=?', [d.name||lc.name,d.category||lc.category,d.description||lc.description,req.params.id]);
  saveNow(); res.json({ ok: true });
}));
app.delete('/api/linecards/:id', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM linecards WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
}));

// ── TAX RATES ────────────────────────────────────────────────
app.get('/api/tax-rates', auth, asyncRoute(async (req, res) => {
  const rows = await allAsync('SELECT * FROM tax_rates ORDER BY region, currency');
  res.json(rows.map(r => ({ ...r, rates: JSON.parse(r.rates) })));
}));
app.post('/api/tax-rates', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.currency || !d.country || !d.region || !Array.isArray(d.rates))
    return res.status(400).json({ error: 'currency, country, region, rates required' });
  const cur = d.currency.toUpperCase();
  const existing = await getAsync('SELECT 1 FROM tax_rates WHERE currency=?', [cur]);
  if (existing) return res.status(409).json({ error: `Currency ${cur} already exists — use Edit to modify it` });
  const now = new Date().toISOString();
  await runAsync(
    'INSERT INTO tax_rates(currency,country,region,rates,vat_label,updated_at) VALUES(?,?,?,?,?,?)',
    [cur, d.country, d.region, JSON.stringify(d.rates), d.vat_label||'VAT', now]
  );
  res.json({ ok: true });
}));
app.put('/api/tax-rates/:currency', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  const cur = req.params.currency.toUpperCase();
  const existing = await getAsync('SELECT * FROM tax_rates WHERE currency=?', [cur]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString();
  await runAsync(
    'UPDATE tax_rates SET country=?,region=?,rates=?,vat_label=?,updated_at=? WHERE currency=?',
    [d.country||existing.country, d.region||existing.region,
     JSON.stringify(d.rates||JSON.parse(existing.rates)),
     d.vat_label||existing.vat_label, now, cur]
  );
  res.json({ ok: true });
}));
app.delete('/api/tax-rates/:currency', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM tax_rates WHERE currency=?', [req.params.currency.toUpperCase()]);
  res.json({ ok: true });
}));

// ── SUPPLIERS ────────────────────────────────────────────────
app.get('/api/suppliers', auth, asyncRoute(async (req, res) => {
  // Single query for suppliers, single query for all linecards — no nesting
  const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
  const where = includeDeleted ? '' : "WHERE status != 'deleted'";
  const sups = await allAsync(`SELECT * FROM suppliers ${where} ORDER BY created DESC`);
  const allLinecards = await allAsync('SELECT supplier_id, linecard_id FROM supplier_linecards');
  res.json(sups.map(s => ({
    ...s,
    linecards: allLinecards.filter(l => l.supplier_id === s.id).map(l => l.linecard_id)
  })));
}));
app.post('/api/suppliers', auth, asyncRoute(async (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = await nextIdAsync('suppliers','CFSUP',4);
  const supNo = id;
  const postTermsText  = d.payment_terms||'Net 30';
  const postParsedTerms= parsePaymentTerms(postTermsText);
  await runAsync('INSERT INTO suppliers(id,name,type,contact,email,phone,website,city,state,country,gstin,payment_terms,currency,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.name,d.type||'domestic',d.contact||'',d.email||'',d.phone||'',d.website||'',
     d.billing_city||d.city||'',d.billing_state||d.state||'',
     d.billing_country||d.country||'India',d.gstin||'',
     postTermsText,d.currency||'INR',d.status||'active',d.notes||'',todayStr()]);
  const extS = buildSupplierExt(d, supNo);
  await runAsync('UPDATE suppliers SET ' + extS.sets + ' WHERE id=?', [...extS.vals, id]);
  // Save derived payment term type fields
  await runAsync('UPDATE suppliers SET payment_terms_type=?,payment_net_days=?,payment_advance_pct=? WHERE id=?',
    [postParsedTerms.payment_terms_type,postParsedTerms.payment_net_days,postParsedTerms.payment_advance_pct,id]);
  for (const lcid of (d.linecards||[])) {
    if (!(await getAsync('SELECT 1 FROM supplier_linecards WHERE supplier_id=? AND linecard_id=?',[id,lcid])))
      await runAsync('INSERT INTO supplier_linecards VALUES(?,?)',[id,lcid]);
  }
  saveNow(); res.json({ id });
}));
app.put('/api/suppliers/:id', auth, asyncRoute(async (req, res) => {
  const s = await getAsync('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  const newTermsText = d.payment_terms||s.payment_terms;
  const parsedTerms  = parsePaymentTerms(newTermsText);
  await runAsync('UPDATE suppliers SET name=?,type=?,contact=?,email=?,phone=?,website=?,city=?,state=?,country=?,gstin=?,payment_terms=?,currency=?,status=?,notes=?,payment_terms_type=?,payment_net_days=?,payment_advance_pct=? WHERE id=?',
    [d.name||s.name,d.type||s.type,d.contact||s.contact,d.email||s.email,d.phone||s.phone,
     d.website||s.website,d.billing_city||d.city||s.city,d.billing_state||d.state||s.state,
     d.billing_country||d.country||s.country,d.gstin||s.gstin,
     newTermsText,d.currency||s.currency,d.status||s.status,d.notes||s.notes,
     parsedTerms.payment_terms_type,parsedTerms.payment_net_days,parsedTerms.payment_advance_pct,
     req.params.id]);
  const extS = buildSupplierExt(d, s.supplier_no || s.id);
  await runAsync('UPDATE suppliers SET ' + extS.sets + ' WHERE id=?', [...extS.vals, req.params.id]);
  if (d.linecards !== undefined) {
    await runAsync('DELETE FROM supplier_linecards WHERE supplier_id=?', [req.params.id]);
    for (const lcid of d.linecards) {
      if (!(await getAsync('SELECT 1 FROM supplier_linecards WHERE supplier_id=? AND linecard_id=?',[req.params.id,lcid])))
        await runAsync('INSERT INTO supplier_linecards VALUES(?,?)',[req.params.id,lcid]);
    }
  }
  saveNow(); res.json({ ok: true });
}));
app.delete('/api/suppliers/:id', auth, asyncRoute(async (req, res) => {
  // Soft delete — move to the Recycle Bin instead of removing from the database.
  const s = await getAsync('SELECT id,name,email FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  await runAsync('UPDATE suppliers SET status=? WHERE id=?', ['deleted', req.params.id]);
  await logActivity({ action:'delete', area:'recycle', module:'suppliers', label:'Suppliers', entity_type:'supplier', entity_id:s.id, entity_name:s.name, entity_email:s.email||'', row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));
app.post('/api/suppliers/:id/restore', auth, asyncRoute(async (req, res) => {
  const s = await getAsync('SELECT id,name,email,status FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.status !== 'deleted') return res.status(400).json({ error: 'Supplier is not in the Recycle Bin' });
  await runAsync('UPDATE suppliers SET status=? WHERE id=?', ['active', req.params.id]);
  await logActivity({ action:'restore', area:'recycle', module:'suppliers', label:'Suppliers', entity_type:'supplier', entity_id:s.id, entity_name:s.name, entity_email:s.email||'', row_count:1 }, req.session.user);
  saveNow(); res.json({ ok: true });
}));
// Supplier template download
app.get('/api/suppliers/template', auth, (req, res) => {
  const headers = [
    'name*','type','first_name','last_name','email','phone','mobile',
    'website','city','state','country','gstin','pan','vat_number',
    'payment_terms','currency',
    'bank_account_name','bank_account_no','bank_name','bank_ifsc',
    'bank_swift','bank_iban','notes'
  ];
  const example1 = [
    'Relia Components','domestic','Rajesh','Kumar','rajesh@relia.com',
    '+91-9876543210','+91-9876543210','www.relia.com','Delhi','Delhi','India',
    '07AAAAA0000A1Z1','PQRDE5678F','','Net 30','INR',
    'Rajesh Kumar','9876543210','SBI','SBIN0001234',
    '','','Reliable component supplier'
  ];
  const example2 = [
    'Tech Parts USA','international','Bob','Johnson','bob@techparts.com',
    '+1-555-987-6543','+1-555-987-6543','www.techparts.com','Chicago','Illinois','USA',
    '','','US987654321','Net 60','USD',
    'Bob Johnson','5678901234','Chase Bank','',
    'CHASUS33','US12345678901234567890','US electronics supplier'
  ];
  const csv = [headers, example1, example2].map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ciflux_supplier_template.csv"');
  res.send(csv);
});
// Bulk import suppliers
app.post('/api/suppliers/bulk', auth, asyncRoute(async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows)||!rows.length) return res.status(400).json({ error:'No rows' });
  const created=[], errors=[];
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    if (!d.name) { errors.push('Row '+(i+2)+': Name missing'); continue; }
    try {
      const id = await nextIdAsync('suppliers','CFSUP',4);
      await runAsync('INSERT INTO suppliers(id,name,type,contact,email,phone,website,city,state,country,gstin,payment_terms,currency,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id,d.name,d.type||'domestic',d.contact||'',d.email||'',d.phone||'',d.website||'',
         d.city||'',d.state||'',d.country||'India',d.gstin||'',
         d.payment_terms||'Net 30',d.currency||'INR',d.status||'active',d.notes||'',todayStr()]);
      const extS = buildSupplierExt(d, id);
      await runAsync('UPDATE suppliers SET ' + extS.sets + ' WHERE id=?', [...extS.vals, id]);
      created.push(id);
    } catch(e) { errors.push('Row '+(i+2)+': '+e.message); }
  }
  saveNow(); res.json({ created: created.length, errors });
}));

function buildSupplierExt(d, supNo) {
  const fields = [
    'supplier_no','salutation','first_name','last_name','mobile','pan',
    'gstin_type','vat_number','place_of_supply',
    'billing_attention','billing_street1','billing_street2','billing_city','billing_state','billing_country','billing_pincode','billing_phone',
    'shipping_addresses',
    'bank_account_name','bank_account_no','bank_ifsc','bank_name','bank_branch',
    'bank_swift','bank_iban','bank_aba','bank_country','bank_currency',
    'contact_persons','remarks'
  ];
  const sets = fields.map(f=>f+'=?').join(',');
  const vals = fields.map(f => {
    if (f==='supplier_no') return supNo||d.supplier_no||'';
    if (f==='shipping_addresses') return JSON.stringify(d[f]||[]);
    if (f==='contact_persons')    return JSON.stringify(d[f]||[]);
    return d[f]!==undefined ? d[f] : '';
  });
  return { sets, vals };
}

// ── SHIPPERS ─────────────────────────────────────────────────
app.get('/api/shippers', auth, asyncRoute(async (req, res) => res.json(await allAsync("SELECT * FROM shippers WHERE status='active' ORDER BY type,name"))));
app.post('/api/shippers', auth, asyncRoute(async (req, res) => {
  const d = req.body; if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  await runAsync('INSERT INTO shippers VALUES(?,?,?,?,?,?)', [id,d.name,d.type||'international',d.tracking_url||'','active',todayStr()]);
  saveNow(); res.json({ id });
}));
app.put('/api/shippers/:id', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  await runAsync('UPDATE shippers SET name=?,type=?,tracking_url=?,status=? WHERE id=?',
    [d.name,d.type,d.tracking_url||'',d.status||'active',req.params.id]);
  saveNow(); res.json({ ok: true });
}));

// ── ENQUIRIES ────────────────────────────────────────────────
app.get('/api/enquiries', auth, asyncRoute(async (req, res) => {
  const u = req.session.user;
  const perms = getPerms(u);
  let enqs;
  if (perms.canSeeAll || ['sourcing','procurement'].includes(u.department)) {
    enqs = await allAsync('SELECT * FROM enquiries ORDER BY created_at DESC');
  } else {
    enqs = await allAsync('SELECT * FROM enquiries WHERE created_by=? OR assigned_to=? ORDER BY created_at DESC', [u.id, u.id]);
  }
  res.json(await Promise.all(enqs.map(e => assembleEnquiry(e))));
}));
app.get('/api/enquiries/:id', auth, asyncRoute(async (req, res) => {
  const e = await getAsync('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json(await assembleEnquiry(e));
}));
app.post('/api/enquiries', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.customer_id) return res.status(400).json({ error: 'Customer required' });
  const id  = await nextEnqNoAsync();
  const now = nowStr();
  const initStatus = ['sourcing','draft'].includes(d.status) ? d.status : 'new';
  const initSourNo = initStatus === 'sourcing' ? await nextSourNoAsync() : '';
  await runAsync('INSERT INTO enquiries(id,customer_id,created_by,assigned_to,status,priority,notes,sourcing_no,buying_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [id, d.customer_id, req.session.user.id, d.assigned_to||null, initStatus, d.priority||'normal', d.notes||'', initSourNo, d.buying_type||'', now, now]);
  if (initStatus === 'sourcing') {
    await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),id,'Submitted to Sourcing — '+initSourNo,req.session.user.name,now]);
  }
  for (let idx = 0; idx < (d.items||[]).length; idx++) {
    const item = d.items[idx];
    await runAsync('INSERT INTO enquiry_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuid(),id,item.component||'',item.linecard_id||null,item.ipn||'',item.manufacturer||'',
       item.target_price||null,item.target_currency||'INR',item.quantity||0,
       item.preferred_delivery_date||'',item.date_code||'',idx+1,item.tax_rate||0]);
  }
  await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),id,'Enquiry created',req.session.user.name,now]);
  saveNow(); res.json({ id });
}));
// Parse payment_terms text string → { payment_terms_type, payment_net_days, payment_advance_pct }
function parsePaymentTerms(termsText) {
  if (!termsText) return { payment_terms_type:'net', payment_net_days:30, payment_advance_pct:0 };
  const t = termsText.toLowerCase();
  // Advance / prepayment patterns
  if (t.includes('advance') || t.includes('prepay') || t.includes('before shipment') ||
      t.includes('before dispatch') || t.includes('cash in advance') || t.includes('cia') ||
      t.includes('cbs') || t.includes('cash before')) {
    // Check for partial/split advance
    const pctMatch = t.match(/(\d+)%.*upfront|upfront.*?(\d+)%/);
    if (pctMatch) {
      const pct = parseInt(pctMatch[1]||pctMatch[2]);
      return { payment_terms_type:'split', payment_net_days:0, payment_advance_pct:pct };
    }
    return { payment_terms_type:'advance', payment_net_days:0, payment_advance_pct:100 };
  }
  // Net days patterns
  const netMatch = t.match(/net\s*(\d+)/);
  if (netMatch) return { payment_terms_type:'net', payment_net_days:parseInt(netMatch[1]), payment_advance_pct:0 };
  // COD/CAD
  if (t.includes('cod') || t.includes('cash on delivery') || t.includes('cad')) {
    return { payment_terms_type:'net', payment_net_days:0, payment_advance_pct:0 };
  }
  // Default
  return { payment_terms_type:'net', payment_net_days:30, payment_advance_pct:0 };
}

// Financial year string: Apr–Mar cycle → e.g. May 2025 → "2526", Feb 2025 → "2425"
function financialYear() {
  const now = new Date();
  const m = now.getMonth() + 1; // 1-indexed
  const y = now.getFullYear();
  const start = m >= 4 ? y : y - 1;
  return String(start).slice(2) + String(start + 1).slice(2);
}

// Generate next ENQ number: ENQ-2425-0001
async function nextEnqNoAsync() {
  const fy = financialYear();
  const prefix = `ENQ-${fy}-`;
  const rows = await allAsync("SELECT id FROM enquiries WHERE id LIKE ?", [prefix + '%']);
  const nums = rows.map(r => parseInt((r.id||'').slice(prefix.length))).filter(n => !isNaN(n) && n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(4, '0');
}

// Generate next internal PO number CFPO0001+
async function nextPoNoAsync() {
  const rows = await allAsync("SELECT internal_po_no FROM supplier_orders WHERE internal_po_no IS NOT NULL AND internal_po_no != ''");
  const nums = rows.map(r => parseInt((r.internal_po_no||'').replace(/[^0-9]/g,''))).filter(n=>!isNaN(n)&&n>0);
  const next  = nums.length ? Math.max(...nums) + 1 : 1;
  return 'CFPO' + String(next).padStart(4,'0');
}

// Generate next SRC number: SRC-2425-0001
async function nextSourNoAsync() {
  const fy = financialYear();
  const prefix = `SRC-${fy}-`;
  const rows = await allAsync("SELECT sourcing_no FROM enquiries WHERE sourcing_no LIKE ?", [prefix + '%']);
  const nums = rows.map(r => parseInt((r.sourcing_no||'').slice(prefix.length))).filter(n => !isNaN(n) && n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(4, '0');
}

app.put('/api/enquiries/:id', auth, asyncRoute(async (req, res) => {
  const e = await getAsync('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const d   = req.body;
  const now = nowStr();
  // Assign sourcing_no when status first moves to 'sourcing'
  let sourNo = e.sourcing_no || '';
  if (d.status === 'sourcing' && !sourNo) {
    sourNo = await nextSourNoAsync();
  }
  const newCharges = d.charges !== undefined ? JSON.stringify(d.charges) : e.charges;
  // Persist existing_order_id when provided (set when order triggers enquiry revision)
  const newExistingOrderId = d.existing_order_id !== undefined ? (d.existing_order_id || null) : (e.existing_order_id || null);
  try { await runAsync('ALTER TABLE enquiries ADD COLUMN existing_order_id TEXT DEFAULT NULL'); } catch(_) {}
  try { await runAsync('ALTER TABLE enquiries ADD COLUMN send_to_enq_note TEXT DEFAULT NULL'); } catch(_) {}
  // If enquiry is being set to 'quoted' but a live order already exists for it, keep it as 'ordered'
  let resolvedStatus = d.status || e.status;
  if (resolvedStatus === 'quoted') {
    const liveOrder = await getAsync("SELECT id FROM orders WHERE enquiry_id=? AND status NOT IN ('deleted','cancelled') LIMIT 1", [req.params.id]);
    if (liveOrder) resolvedStatus = 'ordered';
  }
  const newSendToEnqNote = d.send_to_enq_note !== undefined ? (d.send_to_enq_note || null) : (e.send_to_enq_note || null);
  // Clear notes and modify_reason when submitted back to sourcing
  const clearOnSourcing  = resolvedStatus === 'sourcing' || resolvedStatus === 'returned_to_sourcing';
  const resolvedSendToEnqNote = clearOnSourcing ? null : newSendToEnqNote;
  const resolvedModifyReason  = clearOnSourcing ? null : (e.modify_reason || null);
  await runAsync('UPDATE enquiries SET status=?,assigned_to=?,priority=?,notes=?,sourcing_no=?,buying_type=?,charges=?,existing_order_id=?,send_to_enq_note=?,modify_reason=?,updated_at=? WHERE id=?',
    [resolvedStatus, d.assigned_to??e.assigned_to, d.priority||e.priority, d.notes??e.notes, sourNo,
     d.buying_type!==undefined ? d.buying_type : (e.buying_type||''), newCharges, newExistingOrderId, resolvedSendToEnqNote, resolvedModifyReason, now, req.params.id]);
  if (d.items !== undefined) {
    await runAsync('DELETE FROM enquiry_items WHERE enquiry_id=?', [req.params.id]);
    for (let idx = 0; idx < d.items.length; idx++) {
      const item = d.items[idx];
      await runAsync('INSERT INTO enquiry_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [item.id||uuid(),req.params.id,item.component||'',item.linecard_id||null,item.ipn||'',item.manufacturer||'',
         item.target_price||null,item.target_currency||'INR',item.quantity||0,
         item.preferred_delivery_date||'',item.date_code||'',idx+1,item.tax_rate||0]);
    }
    // When items are updated and sent back to sourcing, mark any active quote as
    // returned_to_sourcing so it doesn't appear as the current active quote and
    // a proper new revision is generated after sourcing re-prices.
    if (d.status === 'sourcing' || d.status === 'returned_to_sourcing') {
      const activeQuotes = await allAsync("SELECT id, quote_no FROM quotes WHERE enquiry_id=? AND status='active'", [req.params.id]);
      for (const q of activeQuotes) {
        await runAsync("UPDATE quotes SET status='returned_to_sourcing' WHERE id=?", [q.id]);
        try {
          await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
            [uuid(), req.params.id, 'Quote ' + q.quote_no + ' returned to sourcing for re-pricing', req.session.user.name, now]);
        } catch(_) {}
      }
    }
  }
  // When enquiry moves to 'sourcing' or 'returned_to_sourcing', clear sent_to_enquiry flags
  // and mark any active quote as returned_to_sourcing (handles modify_reason flow without items change)
  if (clearOnSourcing) {
    await runAsync(
      "UPDATE enquiry_sourcing SET sent_to_enquiry=0, sent_to_enquiry_note=NULL WHERE enquiry_id=?",
      [req.params.id]
    );
    const activeQs = await allAsync("SELECT id, quote_no FROM quotes WHERE enquiry_id=? AND status='active'", [req.params.id]);
    for (const q of activeQs) {
      await runAsync("UPDATE quotes SET status='returned_to_sourcing' WHERE id=?", [q.id]);
      try {
        await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
          [uuid(), req.params.id, 'Quote ' + q.quote_no + ' returned to sourcing — ENQ re-submitted after modify', req.session.user.name, now]);
      } catch(_) {}
    }
  }
  if (d.sourcing !== undefined) {
    for (const s of d.sourcing) {
      try {
        // Flag-only rows (Send to ENQ) — only update the flag, never touch sourcing data
        if (s._flagOnly || (s.supplier_id === undefined && s.sourced_price === undefined)) {
          if (s.id) {
            await runAsync(
              'UPDATE enquiry_sourcing SET sent_to_enquiry=?, sent_to_enquiry_note=?, updated_at=? WHERE id=?',
              [s.sent_to_enquiry ? 1 : 0, s.sent_to_enquiry_note || null, now, s.id]
            );
          } else if (s.enquiry_item_id && s.sent_to_enquiry) {
            // No existing row yet — only insert if actually flagging (skip no-op resets)
            await runAsync(
              `INSERT INTO enquiry_sourcing(id,enquiry_id,enquiry_item_id,supplier_id,sourced_currency,sent_to_enquiry,sent_to_enquiry_note,updated_by,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET sent_to_enquiry=EXCLUDED.sent_to_enquiry, sent_to_enquiry_note=EXCLUDED.sent_to_enquiry_note, updated_at=EXCLUDED.updated_at`,
              [uuid(), req.params.id, s.enquiry_item_id, '', 'INR', 1, s.sent_to_enquiry_note || null, req.session.user.id, now]
            );
          }
          continue;
        }
        // Full sourcing data UPSERT
        await runAsync(`INSERT INTO enquiry_sourcing(id,enquiry_id,enquiry_item_id,supplier_id,sourced_price,sourced_currency,src_price_foreign,exchange_rate,hsn_code,freight_pct,insurance_pct,duty_pct,cess_pct,bank_fixed_usd,clearance_fixed_inr,margin_pct,freight_inr,insurance_inr,duty_inr,cess_inr,bank_inr,clearance_inr,margin_inr,availability,lead_time,notes,sent_to_enquiry,sent_to_enquiry_note,quote_price,quote_currency,tax_rate,updated_by,updated_at,sourcing_revision_notes,sales_comment,src_dc,delivery_promise_date)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               sourced_price=EXCLUDED.sourced_price, sourced_currency=EXCLUDED.sourced_currency,
               src_price_foreign=EXCLUDED.src_price_foreign, exchange_rate=EXCLUDED.exchange_rate,
               hsn_code=EXCLUDED.hsn_code,
               freight_pct=EXCLUDED.freight_pct, insurance_pct=EXCLUDED.insurance_pct,
               duty_pct=EXCLUDED.duty_pct, cess_pct=EXCLUDED.cess_pct,
               bank_fixed_usd=EXCLUDED.bank_fixed_usd, clearance_fixed_inr=EXCLUDED.clearance_fixed_inr,
               margin_pct=EXCLUDED.margin_pct,
               freight_inr=EXCLUDED.freight_inr, insurance_inr=EXCLUDED.insurance_inr,
               duty_inr=EXCLUDED.duty_inr, cess_inr=EXCLUDED.cess_inr,
               bank_inr=EXCLUDED.bank_inr, clearance_inr=EXCLUDED.clearance_inr,
               margin_inr=EXCLUDED.margin_inr,
               availability=EXCLUDED.availability, lead_time=EXCLUDED.lead_time,
               notes=EXCLUDED.notes, sent_to_enquiry=EXCLUDED.sent_to_enquiry, sent_to_enquiry_note=EXCLUDED.sent_to_enquiry_note,
               quote_price=EXCLUDED.quote_price,
               quote_currency=EXCLUDED.quote_currency, tax_rate=EXCLUDED.tax_rate,
               updated_by=EXCLUDED.updated_by,
               updated_at=EXCLUDED.updated_at,
               sourcing_revision_notes=EXCLUDED.sourcing_revision_notes,
               sales_comment=COALESCE(enquiry_sourcing.sales_comment, EXCLUDED.sales_comment),
               src_dc=EXCLUDED.src_dc,
               delivery_promise_date=EXCLUDED.delivery_promise_date`,
          [s.id||uuid(), req.params.id, s.enquiry_item_id, s.supplier_id||'',
           toNum(s.sourced_price), s.sourced_currency||'INR',
           toNum(s.src_price_foreign), toNum(s.exchange_rate),
           s.hsn_code||'',
           toNum(s.freight_pct),    toNum(s.insurance_pct),
           toNum(s.duty_pct),       toNum(s.cess_pct),
           toNum(s.bank_fixed_usd), toNum(s.clearance_fixed_inr),
           toNum(s.margin_pct),
           toNum(s.freight_inr),   toNum(s.insurance_inr), toNum(s.duty_inr),   toNum(s.cess_inr),
           toNum(s.bank_inr),      toNum(s.clearance_inr), toNum(s.margin_inr),
           s.availability||'', s.lead_time||'', s.notes||'',
           s.sent_to_enquiry ? 1 : 0, s.sent_to_enquiry_note || null,
           toNum(s.quote_price),
           s.quote_currency||'INR',
           toNum(s.tax_rate),
           req.session.user.id, now,
           s.sourcing_revision_notes||null, s.sales_comment||null,
           s.src_dc||'', s.delivery_promise_date||'']);
        // Also update preferred_delivery_date on the enquiry item if provided
        if (s.preferred_delivery_date !== undefined && s.enquiry_item_id) {
          await runAsync('UPDATE enquiry_items SET preferred_delivery_date=? WHERE id=?',
            [s.preferred_delivery_date || '', s.enquiry_item_id]);
        }
      } catch(e) {
        console.error('[sourcing save error] row:', JSON.stringify({id:s.id,qp:s.quote_price}), 'err:', e.message);
      }
    }
  }
  // Atomically create the quote row when the enquiry is sent to the Quote Bin.
  // Previously the client made a separate POST /quotes call after this PUT; if that
  // second request failed in production the enquiry was left marked 'quoted' with no
  // quote row, so nothing appeared in the Quote Bin. Doing it here keeps the two
  // writes atomic and consistent with the status change.
  let createdQuoteNo = null;
  if (resolvedStatus === 'quoted' && d._action === 'Sent to Quote Bin') {
    const existingActive = await getAsync(
      "SELECT id FROM quotes WHERE enquiry_id=? AND status IN ('active','returned_to_sourcing')",
      [req.params.id]
    );
    if (!existingActive) {
      const fy = financialYear();
      const prefix = `QT-${fy}-`;
      const qrows = await allAsync("SELECT quote_no FROM quotes WHERE quote_no LIKE ?", [prefix + '%']);
      const qnums = qrows.map(r => parseInt((r.quote_no||'').slice(prefix.length))).filter(n => !isNaN(n) && n > 0);
      // Find next free number, skipping any collisions
      let next = (qnums.length ? Math.max(...qnums) : 0) + 1;
      let quoteNo = prefix + String(next).padStart(4, '0');
      while (await getAsync('SELECT id FROM quotes WHERE quote_no=?', [quoteNo])) {
        next += 1; quoteNo = prefix + String(next).padStart(4, '0');
      }
      try { await runAsync('ALTER TABLE quotes ADD COLUMN existing_order_id TEXT DEFAULT NULL'); } catch(_) {}
      const quoteId = uuid();
      await runAsync('INSERT INTO quotes(id,enquiry_id,customer_id,quote_no,zoho_quote_no,file_ref,status,valid_until,created_by,created_at,notes,existing_order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [quoteId, req.params.id, e.customer_id, quoteNo, '', '', 'active', '', req.session.user.id, now, d.quote_notes || '', newExistingOrderId]);
      try {
        await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
          [uuid(), req.params.id, `Quote ${quoteNo} created`, req.session.user.name, now]);
      } catch(_) {}
      createdQuoteNo = quoteNo;
    }
  }
  await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),req.params.id, d._action||'Enquiry updated', req.session.user.name, now]);
  saveNow();
  const updated = await getAsync('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  const out = await assembleEnquiry(updated);
  if (createdQuoteNo) out._created_quote_no = createdQuoteNo;
  res.json(out);
}));

// ── QUOTES ───────────────────────────────────────────────────
// Returns next QT number: QT-2425-0001
app.get('/api/next-quote-no', auth, asyncRoute(async (req, res) => {
  const fy = financialYear();
  const prefix = `QT-${fy}-`;
  const rows = await allAsync("SELECT quote_no FROM quotes WHERE quote_no LIKE ?", [prefix + '%']);
  const nums = rows.map(r => parseInt((r.quote_no||'').slice(prefix.length))).filter(n => !isNaN(n) && n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  res.json({ quote_no: prefix + String(next).padStart(4, '0') });
}));
app.get('/api/quotes', auth, asyncRoute(async (req, res) => res.json(await allAsync('SELECT * FROM quotes ORDER BY created_at DESC'))));
app.post('/api/quotes', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.customer_id || !d.quote_no) return res.status(400).json({ error: 'customer_id and quote_no required' });
  if (await getAsync('SELECT id FROM quotes WHERE quote_no=?', [d.quote_no])) return res.status(409).json({ error: 'Quote number exists' });
  const id = uuid();
  // Resolve existing_order_id: use provided value, or look up from linked enquiry
  let existingOrderId = d.existing_order_id || null;
  if (!existingOrderId && d.enquiry_id) {
    const enqRow = await getAsync('SELECT existing_order_id FROM enquiries WHERE id=?', [d.enquiry_id]);
    if (enqRow?.existing_order_id) existingOrderId = enqRow.existing_order_id;
  }
  try { await runAsync('ALTER TABLE quotes ADD COLUMN existing_order_id TEXT DEFAULT NULL'); } catch(_) {}
  await runAsync('INSERT INTO quotes(id,enquiry_id,customer_id,quote_no,zoho_quote_no,file_ref,status,valid_until,created_by,created_at,notes,existing_order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [id,d.enquiry_id||null,d.customer_id,d.quote_no,d.zoho_quote_no||'',d.file_ref||'','active',d.valid_until||'',req.session.user.id,nowStr(),d.notes||'',existingOrderId]);
  if (d.enquiry_id) {
    await runAsync('UPDATE enquiries SET status=?,updated_at=? WHERE id=?', ['quoted',nowStr(),d.enquiry_id]);
    await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)', [uuid(),d.enquiry_id,`Quote ${d.quote_no} created`,req.session.user.name,nowStr()]);
  }
  saveNow(); res.json({ id });
}));
// Modify request — order section signals ENQ needs changes before order is created
app.post('/api/enquiries/:id/modify-request', auth, asyncRoute(async (req, res) => {
  const enq = await getAsync('SELECT * FROM enquiries WHERE id=?', [req.params.id]);
  if (!enq) return res.status(404).json({ error: 'Enquiry not found' });
  const now = nowStr();
  const reason = (req.body?.reason || '').trim() || null;
  await runAsync("UPDATE enquiries SET status='modify_requested', modify_reason=?, updated_at=? WHERE id=?", [reason, now, req.params.id]);
  try {
    const histNote = reason
      ? `Modify requested from Order — ${reason}`
      : 'Modify requested from Order — ENQ opened for editing';
    await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
      [uuid(), req.params.id, histNote, req.session.user.name, now]);
  } catch(_) {}
  res.json({ ok: true });
}));

// Returns enquiry line items with quote_price for order creation
// Create a revision of an existing quote
app.post('/api/quotes/:id/revise', auth, asyncRoute(async (req, res) => {
  const parent = await getAsync('SELECT * FROM quotes WHERE id=?', [req.params.id]);
  if (!parent) return res.status(404).json({ error: 'Quote not found' });
  const now = nowStr();
  const d   = req.body || {};

  // Strip any existing -V suffix to get the root quote number
  const baseNo = parent.quote_no.replace(/-V\d+$/, '');

  // Find all existing revisions to determine next version number
  const allRevisions = await allAsync(
    "SELECT revision, quote_no FROM quotes WHERE quote_no LIKE ? OR quote_no=?",
    [baseNo + '-V%', baseNo]
  );
  const maxRev = allRevisions.reduce((m, r) => Math.max(m, r.revision||1), 1);

  // Find next truly unique quote_no — increment until no collision
  let attempt = maxRev + 1;
  let newQuoteNo = baseNo + '-V' + attempt;
  while (await getAsync('SELECT id FROM quotes WHERE quote_no=?', [newQuoteNo])) {
    attempt++;
    newQuoteNo = baseNo + '-V' + attempt;
  }

  // Build sales revision notes (per-item comments from d.item_comments object)
  const salesNotes = d.sales_revision_notes || '';

  const newId = uuid();
  // Carry existing_order_id forward to revision quote so "Update Order" flow works
  const parentExistingOrderId = parent.existing_order_id || null;
  await runAsync(`INSERT INTO quotes(id,enquiry_id,customer_id,quote_no,zoho_quote_no,file_ref,status,
       valid_until,created_by,created_at,notes,parent_quote_id,revision,
       customer_response,customer_response_date,customer_response_notes,customer_response_by,
       sales_revision_notes,existing_order_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)`,
    [newId, parent.enquiry_id, parent.customer_id, newQuoteNo,
     parent.zoho_quote_no||'', '', 'active', parent.valid_until||'', req.session.user.id, now,
     parent.notes||'', parent.id, attempt, salesNotes, parentExistingOrderId]);

  // Mark the parent as superseded
  await runAsync("UPDATE quotes SET status='superseded' WHERE id=?", [parent.id]);

  // Save per-item sales comments to enquiry_sourcing so sourcing can see them
  if (d.item_comments && parent.enquiry_id) {
    for (const [itemId, comment] of Object.entries(d.item_comments)) {
      if (!comment) continue;
      try {
        await runAsync(`UPDATE enquiry_sourcing SET sales_comment=? WHERE enquiry_id=? AND enquiry_item_id=?`,
          [comment, parent.enquiry_id, itemId]);
      } catch(_) {}
    }
  }

  // Move enquiry back to sourcing for re-pricing — use returned_to_sourcing so Sourcing Bin shows it under Revision Needed
  if (parent.enquiry_id) {
    await runAsync("UPDATE enquiries SET status='returned_to_sourcing', updated_at=? WHERE id=?", [now, parent.enquiry_id]);
    // Unlock all sourcing rows so sourcing can edit supplier/price freely on revision
    await runAsync("UPDATE enquiry_sourcing SET sent_to_enquiry=0, sent_to_enquiry_note=NULL WHERE enquiry_id=?", [parent.enquiry_id]);
    // Remove blank flag-only rows (supplier_id='') that duplicate real sourcing rows — keeps one row per item
    await runAsync(`DELETE FROM enquiry_sourcing WHERE enquiry_id=? AND (supplier_id='' OR supplier_id IS NULL) AND enquiry_item_id IN (SELECT enquiry_item_id FROM enquiry_sourcing WHERE enquiry_id=? AND supplier_id!='' AND supplier_id IS NOT NULL)`, [parent.enquiry_id, parent.enquiry_id]);
    try {
      await runAsync('INSERT INTO enquiry_history VALUES(?,?,?,?,?)',
        [uuid(), parent.enquiry_id,
         'Returned to Sourcing for revision — ' + newQuoteNo + (salesNotes ? ': ' + salesNotes : ''),
         req.session.user.name, now]);
    } catch(_) {}
  }

  try {
    await runAsync('INSERT INTO quote_history VALUES(?,?,?,?,?)', [uuid(), newId,
      'Revision V' + attempt + ' created from ' + parent.quote_no + (salesNotes ? ' — ' + salesNotes : ''),
      req.session.user.name, now]);
  } catch(_) {}

  saveNow();
  res.json({ id: newId, quote_no: newQuoteNo, revision: attempt });
}));

app.get('/api/quotes/:id/lineitems', auth, asyncRoute(async (req, res) => {
  const q = await getAsync('SELECT * FROM quotes WHERE id=?', [req.params.id]);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (!q.enquiry_id) return res.json({ items: [] });

  const items   = await allAsync('SELECT * FROM enquiry_items WHERE enquiry_id=? ORDER BY sort_order', [q.enquiry_id]);
  const sourcing= await allAsync('SELECT * FROM enquiry_sourcing WHERE enquiry_id=?', [q.enquiry_id]);

  // Parse quote prices from the notes field as fallback
  // Notes format: "ComponentName: Quote CUR 245 | Src CUR 220 | Qty 10\n..."
  const notePrices = {};
  (q.notes || '').split('\n').forEach(line => {
    // Match: "COMPONENT: Quote INR 245 | ..."  or  "COMPONENT: Quote INR 245.50 | ..."
    const m = line.match(/^([^:]+):\s*Quote\s+([A-Z]+)\s+([\d.]+)/i);
    if (m) notePrices[m[1].trim().toLowerCase()] = { price: parseFloat(m[3]), currency: m[2] };
  });

  const lineItems = items.map(item => {
    const srcRows = sourcing.filter(s => s.enquiry_item_id === item.id);
    const src = srcRows.find(s => s.quote_price) || srcRows[0] || {};

    // Use DB quote_price first; fallback to parsed notes
    let qp  = src.quote_price  || null;
    let qc  = src.quote_currency|| null;
    if (!qp) {
      const np = notePrices[item.component.toLowerCase()];
      if (np) { qp = np.price; qc = np.currency; }
    }

    return {
      id:           item.id,
      component:    item.component,
      manufacturer: item.manufacturer || '',
      ipn:          item.ipn          || '',
      quantity:     item.quantity     || 0,
      target_price: item.target_price || '',
      target_currency: item.target_currency || 'INR',
      preferred_delivery_date: item.preferred_delivery_date || '',
      quote_price:   qp,
      quote_currency:qc || item.target_currency || 'INR',
      sourced_price: src.sourced_price || null,
      supplier_id:   src.supplier_id   || '',
      margin_inr:  src.margin_inr  != null ? Number(src.margin_inr)  : null,
      margin_pct:  src.margin_pct  != null ? Number(src.margin_pct)  : null,
      // FIX 2: return tax_rate from enquiry_sourcing (set by Sourcing team)
      // fallback to enquiry_items.tax_rate if sourcing row has none
      tax_rate: (src.tax_rate != null && src.tax_rate !== '') ? Number(src.tax_rate)
               : (item.tax_rate != null ? Number(item.tax_rate) : 0),
    };
  });

  res.json({ enquiry_id: q.enquiry_id, items: lineItems });
}));

app.put('/api/quotes/:id', auth, asyncRoute(async (req, res) => {
  const d   = req.body;
  const old = await getAsync('SELECT * FROM quotes WHERE id=?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Quote not found' });
  // If status is being set to 'active' but a live order already exists for this quote's enquiry, use 'order_created' instead
  let resolvedQuoteStatus = d.status ?? old.status ?? 'active';
  if (resolvedQuoteStatus === 'active' && old.enquiry_id) {
    const liveOrder = await getAsync("SELECT id FROM orders WHERE (quote_id=? OR enquiry_id=?) AND status NOT IN ('deleted','cancelled') LIMIT 1", [req.params.id, old.enquiry_id]);
    if (liveOrder) resolvedQuoteStatus = 'order_created';
  }
  await runAsync(`UPDATE quotes SET
       quote_no=?, zoho_quote_no=?, file_ref=?, status=?, valid_until=?, notes=?,
       customer_response=?, customer_response_date=?, customer_response_notes=?, customer_response_by=?,
       sent_to_customer=?,
       revision=COALESCE(revision,1),
       updated_at=?
       WHERE id=?`,
    [
      d.quote_no      ?? old.quote_no,
      d.zoho_quote_no ?? old.zoho_quote_no ?? '',
      d.file_ref      ?? old.file_ref      ?? '',
      resolvedQuoteStatus,
      d.valid_until   ?? old.valid_until   ?? '',
      d.notes         ?? old.notes         ?? '',
      d.customer_response       ?? old.customer_response       ?? null,
      d.customer_response       != null ? (new Date().toISOString().slice(0,10)) : (old.customer_response_date ?? null),
      d.customer_response_notes ?? old.customer_response_notes ?? null,
      d.customer_response_by    ?? old.customer_response_by    ?? null,
      d.sent_to_customer != null ? (d.sent_to_customer ? 1 : 0) : (old.sent_to_customer ?? 0),
      nowStr(),
      req.params.id,
    ]);
  saveNow(); res.json({ ok: true });
}));

// ── ORDERS ───────────────────────────────────────────────────
app.get('/api/orders/next-id', auth, asyncRoute(async (req, res) => {
  const row = await getAsync("SELECT id FROM orders WHERE id LIKE 'CFOR%' ORDER BY id DESC LIMIT 1");
  let next = 1;
  if (row) {
    const num = parseInt(row.id.replace('CFOR', ''), 10);
    if (!isNaN(num)) next = num + 1;
  }
  res.json({ id: 'CFOR' + String(next).padStart(4, '0') });
}));

app.get('/api/orders', auth, asyncRoute(async (req, res) => {
  const u = req.session.user;
  const perms = getPerms(u);
  const canUseProcurementBin = await canAccessSection(u, 'procurement-bin');
  const orders = (perms.canSeeAll || canUseProcurementBin)
    ? await allAsync('SELECT * FROM orders ORDER BY created_at DESC')
    : await allAsync('SELECT * FROM orders WHERE created_by=? ORDER BY created_at DESC', [u.id]);
  res.json(await Promise.all(orders.map(o => assembleOrder(o).then(a => stripSensitive(a, u)))));
}));
app.get('/api/orders/:id', auth, asyncRoute(async (req, res) => {
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(stripSensitive(await assembleOrder(o), req.session.user));
}));
app.post('/api/orders', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.id || !d.customer_id) return res.status(400).json({ error: 'id and customer_id required' });
  const isDraft = d.status === 'draft';
  if (!isDraft && !d.po_number) return res.status(400).json({ error: 'PO number is mandatory' });
  if (await getAsync('SELECT id FROM orders WHERE id=?', [d.id])) return res.status(409).json({ error: 'Order ID exists' });
  const orderStatus = d.status || 'open';
  await runAsync('INSERT INTO orders(id,customer_ref,customer_id,enquiry_id,quote_id,po_number,po_file_ref,enquiry_no,quote_no,tentative_date,status,created_by,created_at,closed_at,notes,delivery_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [d.id,d.customer_ref||'',d.customer_id,d.enquiry_id||null,d.quote_id||null,
     d.po_number||'',d.po_file_ref||'',d.enquiry_no||'',d.quote_no||'',
     d.tentative_date||'',orderStatus,req.session.user.id,todayStr(),null,d.notes||'',
     d.delivery_address||'']);
  const supMap = {};
  for (let idx = 0; idx < (d.lineItems||[]).length; idx++) {
    const item = d.lineItems[idx];
    const lid = uuid(); // always generate server-side — client ids like li1/li2 clash across orders
    // FIX 3a: added tax_rate as 15th column (requires order_items.tax_rate column — added in startup migration)
    const lineStatus = ['negotiating','confirmed','procurement','payment','shipped','delivered'].includes(item.line_status)
      ? item.line_status : 'confirmed';
    await runAsync('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [lid,d.id,item.component,item.manufacturer||'',item.ipn||'',item.qty||0,
       item.unit_price||0,item.procurement_price||0,item.currency||'INR',
       item.order_date||'',item.delivery_date||'',item.supplier_id||'',lineStatus,idx+1,
       item.tax_rate||0]);
    if (item.supplier_id) { if (!supMap[item.supplier_id]) supMap[item.supplier_id]=[]; supMap[item.supplier_id].push(lid); }
  }
  for (const [sid, iids] of Object.entries(supMap)) {
    const soid = uuid().slice(0,8);
    await runAsync('INSERT INTO supplier_orders VALUES(?,?,?,?,?,?,?)', [soid,d.id,sid,'','pending',null,'']);
    for (const iid of iids) await runAsync('INSERT INTO supplier_order_items VALUES(?,?)', [soid,iid]);
  }
  await runAsync('INSERT INTO customer_shipping VALUES(?,?,?,?,?,?)', [d.id,'pending',null,'','','']);
  await runAsync('INSERT INTO order_documents VALUES(?,?,?,?,?,?,?)', [d.id,'','','','',d.po_file_ref||'','']);
  // Remove any orphaned app_files linked to this order ID that were NOT explicitly uploaded for this order.
  // This prevents files from abandoned NewOrderPage sessions (or race conditions) appearing in this order.
  const validFileIds = (d.po_file_ref || '').split(',').map(s=>s.trim()).filter(Boolean);
  try {
    const existingFiles = await allAsync("SELECT id, blob_name FROM app_files WHERE entity_type='order' AND entity_id=?", [d.id]);
    for (const f of existingFiles) {
      if (!validFileIds.includes(f.id)) {
        try { await getAzureContainerClient().getBlockBlobClient(f.blob_name).deleteIfExists(); } catch(_) {}
        await runAsync('DELETE FROM app_files WHERE id=?', [f.id]);
      }
    }
  } catch(_) {}
  await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)', [uuid(),d.id,'Order created',req.session.user.name,'',nowStr()]);
  // Mark the linked quote as order_created so it can't be re-ordered
  if (d.quote_id) {
    try {
      await runAsync('UPDATE quotes SET status=? WHERE id=?', ['order_created', d.quote_id]);
    } catch(_) {}
  }
  // Mark the linked enquiry as ordered
  if (d.enquiry_id) {
    try {
      await runAsync('UPDATE enquiries SET status=? WHERE id=?', ['ordered', d.enquiry_id]);
    } catch(_) {}
  }
  saveNow(); res.json({ id: d.id });
}));
app.put('/api/orders/:id', auth, asyncRoute(async (req, res) => {
  const oid = req.params.id;
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [oid]);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const u = req.session.user;
  const perms = getPerms(u);
  // Only creator, admin, or procurement can edit
  const canEdit = o.created_by === u.id || ['admin','manager'].includes(u.role) || await canAccessSection(u, 'procurement-bin');
  if (!canEdit) return res.status(403).json({ error: 'Only the order creator or procurement bin users can edit orders' });

  const d = req.body;

  // Prevent closing if any line item undelivered
  if (d.status === 'closed') {
    const undelivered = await allAsync("SELECT id FROM order_items WHERE order_id=? AND line_status != 'delivered'", [oid]);
    if (undelivered.length > 0) return res.status(400).json({ error: `Cannot close order: ${undelivered.length} line item(s) not yet delivered` });
    const docs = await getAsync('SELECT * FROM order_documents WHERE order_id=?', [oid]);
    if (!docs?.delivery_slip || !docs?.packing_list || !docs?.invoice) {
      return res.status(400).json({ error: 'Cannot close: Delivery Slip, Packing List, and Invoice are required' });
    }
    // E-way bill check for Indian orders > 50000 INR
    const items = await allAsync('SELECT * FROM order_items WHERE order_id=?', [oid]);
    const totalInr = items.filter(i => i.currency==='INR').reduce((s,i)=>s+(i.qty*i.unit_price),0);
    const cust = await getAsync('SELECT country FROM customers WHERE id=?', [o.customer_id]);
    if (cust?.country === 'India' && totalInr > 50000 && !docs?.eway_bill) {
      return res.status(400).json({ error: 'E-way Bill required for Indian deliveries above ₹50,000' });
    }
  }

  await runAsync('UPDATE orders SET customer_ref=?,enquiry_no=?,quote_no=?,tentative_date=?,status=?,po_number=?,notes=?,delivery_address=? WHERE id=?',
    [d.customer_ref??o.customer_ref, d.enquiry_no??o.enquiry_no, d.quote_no??o.quote_no,
     d.tentative_date??o.tentative_date, d.status??o.status,
     d.po_number??o.po_number, d.notes??o.notes,
     d.delivery_address!==undefined?d.delivery_address:(o.delivery_address||''),
     oid]);
  // Payment terms override for this order
  if (d.payment_terms !== undefined) {
    try { await runAsync('ALTER TABLE orders ADD COLUMN payment_terms TEXT DEFAULT \'\''); } catch(_) {}
    await runAsync('UPDATE orders SET payment_terms=? WHERE id=?', [d.payment_terms||'', oid]);
  }

  if (d.status === 'closed') {
    await runAsync('UPDATE orders SET closed_at=? WHERE id=?', [nowStr(), oid]);
    if (o.enquiry_id) {
      await runAsync("UPDATE enquiries SET status='closed', updated_at=? WHERE id=?", [nowStr(), o.enquiry_id]);
    }
    if (o.quote_id) {
      await runAsync("UPDATE quotes SET status='closed' WHERE id=?", [o.quote_id]);
    } else if (o.enquiry_id) {
      await runAsync("UPDATE quotes SET status='closed' WHERE enquiry_id=? AND status NOT IN ('superseded')", [o.enquiry_id]);
    }
  }

  if (d.lineItems !== undefined) {
    await runAsync('DELETE FROM order_items WHERE order_id=?', [oid]);
    await runAsync('DELETE FROM supplier_orders WHERE order_id=?', [oid]);
    const supMap = {};
    for (let idx = 0; idx < d.lineItems.length; idx++) {
      const item = d.lineItems[idx];
      const lid = uuid(); // always generate server-side — client ids like li1/li2 clash across orders
      // FIX 3b: added tax_rate as 15th column
      await runAsync('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [lid,oid,item.component,item.manufacturer||'',item.ipn||'',item.qty||0,
         item.unit_price||0,item.procurement_price||0,item.currency||'INR',
         item.order_date||'',item.delivery_date||'',item.supplier_id||'',item.line_status||'negotiating',idx+1,
         item.tax_rate||0]);
      if (item.supplier_id) { if (!supMap[item.supplier_id]) supMap[item.supplier_id]=[]; supMap[item.supplier_id].push(lid); }
    }
    for (const [sid, iids] of Object.entries(supMap)) {
      const existSo = await getAsync('SELECT * FROM supplier_orders WHERE order_id=? AND supplier_id=?', [oid, sid]);
      const soid = existSo?.id || uuid().slice(0,8);
      await runAsync('INSERT INTO supplier_orders VALUES(?,?,?,?,?,?,?)',
        [soid,oid,sid,existSo?.po_no||'',existSo?.shipping_status||'pending',existSo?.shipper_id||null,existSo?.tracking_no||'']);
      for (const iid of iids) {
        if (!(await getAsync('SELECT 1 FROM supplier_order_items WHERE supplier_order_id=? AND item_id=?',[soid,iid])))
          await runAsync('INSERT INTO supplier_order_items VALUES(?,?)',[soid,iid]);
      }
    }
  }
  if (d.lineItemStatus !== undefined) {
    const { item_id, line_status } = d.lineItemStatus;
    await runAsync('UPDATE order_items SET line_status=? WHERE id=? AND order_id=?', [line_status, item_id, oid]);
  }
  if (d.supplierOrders !== undefined) {
    for (const so of d.supplierOrders) {
      await runAsync(`UPDATE supplier_orders SET
         po_no=?,status=?,confirmed_price=?,confirmed_currency=?,
         promised_delivery_date=?,supplier_ref=?,shipping_status=?,
         shipper_id=?,tracking_no=?,notes=?
         WHERE id=?`,
        [so.po_no||'',so.status||'draft',so.confirmed_price||null,so.confirmed_currency||'INR',
         so.promised_delivery_date||'',so.supplier_ref||'',so.shipping_status||'pending',
         so.shipper_id||null,so.tracking_no||'',so.notes||'',so.id]);
    }
  }
  if (d.customerShipping !== undefined) {
    const cs = d.customerShipping;
    await runAsync('INSERT OR REPLACE INTO customer_shipping VALUES(?,?,?,?,?,?)',
      [oid,cs.status||'pending',cs.shipper_id||null,cs.tracking_no||'',cs.delivery_date||'',cs.comments||'']);
  }
  if (d.documents !== undefined) {
    const doc = d.documents;
    await runAsync('INSERT OR REPLACE INTO order_documents VALUES(?,?,?,?,?,?,?)',
      [oid,doc.delivery_slip||'',doc.packing_list||'',doc.invoice||'',doc.eway_bill||'',doc.po_file||'',doc.comments||'']);
  }
  await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(),oid,d._action||'Order updated',u.name,d._comment||'',nowStr()]);
  // Mark the linked quote as order_created so it can't be re-ordered
  if (d.quote_id) {
    await runAsync("UPDATE quotes SET status='order_created' WHERE id=?", [d.quote_id]);
  }
  saveNow();
  const updatedOrder = await getAsync('SELECT * FROM orders WHERE id=?', [oid]);
  res.json(stripSensitive(await assembleOrder(updatedOrder), u));
}));
app.delete('/api/orders/:id', adminOnly, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM orders WHERE id=?', [req.params.id]); saveNow(); res.json({ ok: true });
}));

// ── APPROVAL WORKFLOWS ───────────────────────────────────────
app.get('/api/approvals/workflows', auth, asyncRoute(async (req, res) => res.json(await allAsync("SELECT * FROM approval_workflows WHERE active=1"))));
app.post('/api/approvals/workflows', adminOnly, asyncRoute(async (req, res) => {
  const d = req.body;
  const id = uuid();
  await runAsync('INSERT INTO approval_workflows VALUES(?,?,?,?,?,?)',
    [id,d.name,d.entity_type,JSON.stringify(d.steps),1,nowStr()]);
  saveNow(); res.json({ id });
}));
app.put('/api/approvals/workflows/:id', adminOnly, asyncRoute(async (req, res) => {
  const d = req.body;
  await runAsync('UPDATE approval_workflows SET name=?,steps=?,active=? WHERE id=?',
    [d.name,JSON.stringify(d.steps),d.active?1:0,req.params.id]);
  saveNow(); res.json({ ok: true });
}));
app.get('/api/approvals/requests', auth, asyncRoute(async (req, res) => {
  const reqs = await allAsync('SELECT * FROM approval_requests ORDER BY requested_at DESC');
  const withActions = await Promise.all(reqs.map(async r => ({
    ...r,
    actions: await allAsync('SELECT * FROM approval_actions WHERE request_id=? ORDER BY step', [r.id])
  })));
  res.json(withActions);
}));
app.post('/api/approvals/requests', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  const id = uuid();
  await runAsync('INSERT INTO approval_requests VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id,d.workflow_id,d.entity_type,d.entity_id,0,'pending',req.session.user.id,nowStr(),null,d.notes||'']);
  saveNow(); res.json({ id });
}));
app.post('/api/approvals/requests/:id/action', auth, asyncRoute(async (req, res) => {
  const r = await getAsync('SELECT * FROM approval_requests WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { action, comment } = req.body;
  await runAsync('INSERT INTO approval_actions VALUES(?,?,?,?,?,?)',
    [uuid(),r.id,r.current_step,action,req.session.user.id,comment||'']);
  const newStatus = action === 'approve' ? (r.current_step + 1 >= 3 ? 'approved' : 'pending') : 'rejected';
  await runAsync('UPDATE approval_requests SET status=?,current_step=?,resolved_at=? WHERE id=?',
    [newStatus, r.current_step + 1, newStatus !== 'pending' ? nowStr() : null, r.id]);
  saveNow(); res.json({ ok: true, status: newStatus });
}));

// ── ADMIN: MASTER DELETE (admin-only, logged) ────────────────────────────────
const DELETABLE_MODULES = {
  orders:    { label:'All Orders',        tables:['shipment_items','shipments','grn_records','order_history','order_documents','customer_shipping','supplier_order_items','supplier_orders','order_items','orders','customer_payments','supplier_net_payment_logs','finance_queue','po_requests','app_files'] },
  enquiries: { label:'All Enquiries',     tables:['enquiry_history','enquiry_sourcing','enquiry_items','enquiries'] },
  quotes:    { label:'All Quotes',        tables:['quotes'] },
  sourcing:  { label:'All Sourcing Data', tables:['enquiry_sourcing'] },
  approvals: { label:'All Approvals',     tables:['approval_actions','approval_requests','approval_workflows'] },
  finance:   { label:'All Finance Data',  tables:['customer_payments','supplier_net_payment_logs','finance_queue','po_requests'] },
  inventory: { label:'All Inventory',     tables:['stock_inventory'] },
};

// Modules surfaced in the Recycle Bin grid. "users" is handled by per-record
// soft delete (status='deleted'), not the snapshot store, so it's listed
// separately on the client. The keys here mirror the Danger Zone cards.
const DELETED_BIN_MODULES = Object.fromEntries(
  Object.entries(DELETABLE_MODULES).map(([k,v]) => [k, v.label])
);

async function deleteBlobsForFiles(fileRows) {
  if (!fileRows || !fileRows.length) return;
  const container = getAzureContainerClient();
  await Promise.all(fileRows.map(f => container.getBlockBlobClient(f.blob_name).deleteIfExists().catch(()=>{})));
}

async function safeDeleteTables(tables, blobCleanup) {
  if (blobCleanup) {
    const files = await allAsync('SELECT blob_name FROM app_files').catch(()=>[]);
    await deleteBlobsForFiles(files);
  }
  let deleted = 0;
  for (const t of tables) {
    try {
      const n = (await getAsync('SELECT COUNT(*) as n FROM '+t)||{n:0}).n;
      await runAsync('DELETE FROM '+t);
      deleted += Number(n);
    } catch(_) {}
  }
  return deleted;
}

// Snapshot every row of the given tables into a trash batch, then delete them.
// Returns { id, deleted } where id is the deleted_bin batch (null if nothing deleted).
async function softDeleteTables(module, label, tables, deletedBy) {
  const payload = {};
  let total = 0;
  for (const t of tables) {
    try {
      const rows = await allAsync('SELECT * FROM '+t);
      if (rows && rows.length) { payload[t] = rows; total += rows.length; }
    } catch(_) {}
  }
  if (total === 0) return { id: null, deleted: 0 };
  // Delete live rows (tables already ordered children-first by the module def).
  for (const t of tables) {
    try { await runAsync('DELETE FROM '+t); } catch(_) {}
  }
  const id = 'bin' + uuid().slice(0,10);
  await runAsync(
    'INSERT INTO deleted_bin(id,module,label,payload,row_count,deleted_by,deleted_at) VALUES(?,?,?,?,?,?,?)',
    [id, module, label, JSON.stringify(payload), total, deletedBy||'', nowStr()]
  );
  return { id, deleted: total };
}

// Re-insert every snapshotted row, parents first (reverse of delete order).
async function restoreBatch(batch) {
  const payload = typeof batch.payload === 'string' ? JSON.parse(batch.payload) : batch.payload;
  const tables = Object.keys(payload).reverse();
  let restored = 0;
  for (const t of tables) {
    const rows = payload[t] || [];
    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map(()=>'?').join(',');
      const sql = `INSERT INTO ${t}(${cols.join(',')}) VALUES(${placeholders}) ON CONFLICT DO NOTHING`;
      try { await runAsync(sql, cols.map(c=>row[c])); restored++; } catch(_) {}
    }
  }
  return restored;
}

app.delete('/api/admin/delete/:module', adminOnly, asyncRoute(async (req, res) => {
  const mod = DELETABLE_MODULES[req.params.module];
  if (!mod) return res.status(400).json({ error:'Unknown module' });
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error:'Only admin role can do this' });
  const { deleted } = await softDeleteTables(req.params.module, mod.label, mod.tables, req.session.user.username);
  await logActivity({ action:'delete', area:'danger', module:req.params.module, label:mod.label, entity_type:'section', row_count:deleted }, req.session.user);
  saveNow();
  console.log('[ADMIN SOFT-DELETE]', req.session.user.username, 'sent module to Recycle Bin:', req.params.module, 'rows:', deleted);
  res.json({ ok:true, module:req.params.module, label:mod.label, deleted });
}));

// List trash batches (newest first), grouped by module on the client.
app.get('/api/admin/deleted-bin', adminOnly, asyncRoute(async (req, res) => {
  const rows = await allAsync('SELECT id,module,label,row_count,deleted_by,deleted_at FROM deleted_bin ORDER BY deleted_at DESC');
  res.json(rows);
}));

// Audit log. Optional ?area=danger|recycle filter.
app.get('/api/admin/activity-log', adminOnly, asyncRoute(async (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error:'Only admin role can do this' });
  const { area } = req.query || {};
  const where = (area === 'danger' || area === 'recycle') ? 'WHERE area=?' : '';
  const params = where ? [area] : [];
  const rows = await allAsync(`SELECT * FROM activity_log ${where} ORDER BY performed_at DESC LIMIT 500`, params);
  res.json(rows);
}));

// Restore one batch back into the live tables, then remove it from the bin.
app.post('/api/admin/deleted-bin/:id/restore', adminOnly, asyncRoute(async (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error:'Only admin role can do this' });
  const batch = await getAsync('SELECT * FROM deleted_bin WHERE id=?', [req.params.id]);
  if (!batch) return res.status(404).json({ error:'Batch not found' });
  const restored = await restoreBatch(batch);
  await runAsync('DELETE FROM deleted_bin WHERE id=?', [req.params.id]);
  await logActivity({ action:'restore', area:'recycle', module:batch.module, label:batch.label, entity_type: batch.module==='master'?'master':'section', row_count:restored }, req.session.user);
  saveNow();
  console.log('[ADMIN RESTORE]', req.session.user.username, 'restored batch:', batch.module, 'rows:', restored);
  res.json({ ok:true, module:batch.module, label:batch.label, restored });
}));

// Permanently purge one batch (frees the data for real).
app.delete('/api/admin/deleted-bin/:id', adminOnly, asyncRoute(async (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error:'Only admin role can do this' });
  const batch = await getAsync('SELECT * FROM deleted_bin WHERE id=?', [req.params.id]);
  if (!batch) return res.status(404).json({ error:'Batch not found' });
  await runAsync('DELETE FROM deleted_bin WHERE id=?', [req.params.id]);
  await logActivity({ action:'purge', area:'recycle', module:batch.module, label:batch.label, entity_type:'section', row_count:batch.row_count }, req.session.user);
  saveNow();
  res.json({ ok:true });
}));

app.delete('/api/admin/delete-all', adminOnly, asyncRoute(async (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error:'Only admin role can do this' });
  if (req.body?.confirm_text !== 'DELETE ALL DATA') return res.status(400).json({ error:'Confirmation text mismatch' });
  const tables = ['shipment_items','shipments','grn_records',
    'order_history','order_documents','customer_shipping','supplier_order_items',
    'supplier_orders','order_items','orders','enquiry_history','enquiry_sourcing',
    'enquiry_items','enquiries','quotes','approval_actions','approval_requests','approval_workflows',
    'customer_payments','supplier_net_payment_logs','finance_queue','po_requests','app_files','stock_inventory'];
  // Soft master delete — snapshot everything into one restorable batch instead of
  // hard-wiping. Blobs are kept so uploaded files survive a restore.
  const { deleted } = await softDeleteTables('master', 'Master Delete', tables, req.session.user.username);
  await logActivity({ action:'master_delete', area:'danger', module:'master', label:'Master Delete', entity_type:'master', row_count:deleted }, req.session.user);
  saveNow();
  console.warn('[MASTER DELETE]', req.session.user.username, 'sent ALL data to Recycle Bin. Rows:', deleted);
  res.json({ ok:true, deleted });
}));

// ── ADMIN: DATA HEAL ─────────────────────────────────────────────────────────
app.post('/api/admin/heal', adminOnly, asyncRoute(async (req, res) => {
  const fixes = [];
  // Fix enquiries stuck at 'ordered'/'order_created' whose linked order is now 'closed'
  try {
    const r = await runAsync(`UPDATE enquiries SET status='closed', updated_at=NOW() WHERE id IN (SELECT enquiry_id FROM orders WHERE status='closed' AND enquiry_id IS NOT NULL) AND status NOT IN ('closed')`);
    if (r && r.rowCount) fixes.push(`${r.rowCount} enquiries marked closed`);
  } catch(e) { fixes.push('enquiry-close heal failed: ' + e.message); }
  // Fix quotes whose linked order is closed but quote not yet marked closed
  try {
    const r1 = await runAsync(`UPDATE quotes SET status='closed' WHERE id IN (SELECT quote_id FROM orders WHERE status='closed' AND quote_id IS NOT NULL) AND status NOT IN ('superseded','closed')`);
    const r2 = await runAsync(`UPDATE quotes SET status='closed' WHERE enquiry_id IN (SELECT enquiry_id FROM orders WHERE status='closed' AND enquiry_id IS NOT NULL) AND status NOT IN ('superseded','closed')`);
    const n = (r1?.rowCount||0) + (r2?.rowCount||0);
    if (n) fixes.push(`${n} quotes marked closed`);
  } catch(e) { fixes.push('quote-close heal failed: ' + e.message); }
  // Fix orders with payments >= total but stuck at payment_approval
  try {
    const r = await runAsync(`UPDATE orders SET customer_payment_status='payment_recorded' WHERE customer_payment_status='paid' AND status='payment_approval'`);
    if (r && r.rowCount) fixes.push(`${r.rowCount} orders reverted from paid→payment_recorded`);
  } catch(e) { fixes.push('payment heal failed: ' + e.message); }
  // Fix enquiries stuck at 'returned_to_sourcing' or 'quoted' when a live order exists → mark 'ordered'
  // Note: 'modify_requested' is intentional — do NOT auto-fix it
  try {
    const r = await runAsync(`UPDATE enquiries SET status='ordered', updated_at=NOW() WHERE status IN ('returned_to_sourcing','quoted') AND id IN (SELECT enquiry_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND enquiry_id IS NOT NULL)`);
    if (r && r.rowCount) fixes.push(`${r.rowCount} enquiries fixed: returned_to_sourcing/quoted → ordered`);
  } catch(e) { fixes.push('enquiry revision heal failed: ' + e.message); }
  // Fix quotes stuck at 'returned_to_sourcing' or 'active' when a live order exists → mark 'order_created'
  try {
    const r = await runAsync(`UPDATE quotes SET status='order_created' WHERE status IN ('returned_to_sourcing','active') AND (id IN (SELECT quote_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND quote_id IS NOT NULL) OR enquiry_id IN (SELECT enquiry_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND enquiry_id IS NOT NULL))`);
    if (r && r.rowCount) fixes.push(`${r.rowCount} quotes fixed: returned_to_sourcing/active → order_created`);
  } catch(e) { fixes.push('quote revision heal failed: ' + e.message); }
  res.json({ ok: true, fixes });
}));

// ── GLOBAL SEARCH ────────────────────────────────────────────────────────────
app.get('/api/search', auth, asyncRoute(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ orders:[], enquiries:[], items:[] });
  const like = '%' + q.toLowerCase() + '%';
  // Orders — match on id, po_number, customer_ref, customer name
  const orderRows = await allAsync(`
    SELECT DISTINCT o.id, o.status, o.customer_id, o.po_number, o.customer_ref, o.created_at
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status NOT IN ('deleted')
      AND (LOWER(o.id) LIKE ? OR LOWER(o.po_number) LIKE ? OR LOWER(o.customer_ref) LIKE ? OR LOWER(c.name) LIKE ?)
    LIMIT 8`, [like, like, like, like]);

  // Order items — match on component, manufacturer, ipn
  const itemRows = await allAsync(`
    SELECT DISTINCT oi.order_id, oi.component, oi.manufacturer, oi.ipn, oi.line_status,
           o.status as order_status, o.customer_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('deleted')
      AND (LOWER(oi.component) LIKE ? OR LOWER(oi.manufacturer) LIKE ? OR LOWER(oi.ipn) LIKE ?)
    LIMIT 10`, [like, like, like]);

  // Enquiry items — match component/manufacturer/ipn
  const enqRows = await allAsync(`
    SELECT DISTINCT ei.enquiry_id, ei.component, ei.manufacturer, ei.ipn,
           e.status as enq_status, e.customer_id
    FROM enquiry_items ei
    JOIN enquiries e ON e.id = ei.enquiry_id
    WHERE LOWER(ei.component) LIKE ? OR LOWER(ei.manufacturer) LIKE ? OR LOWER(ei.ipn) LIKE ?
    LIMIT 8`, [like, like, like]);

  // Suppliers
  const supRows = await allAsync(`
    SELECT DISTINCT s.id, s.name, so.order_id
    FROM suppliers s
    JOIN supplier_orders so ON so.supplier_id = s.id
    WHERE LOWER(s.name) LIKE ? AND s.status != 'deleted'
    LIMIT 5`, [like]);

  const customers = await allAsync(`SELECT id, name FROM customers WHERE LOWER(name) LIKE ? AND status != 'deleted' LIMIT 5`, [like]);

  res.json({ orders: orderRows, items: itemRows, enquiries: enqRows, suppliers: supRows, customers });
}));

// ── REPORTS ──────────────────────────────────────────────────
app.get('/api/reports/summary', auth, asyncRoute(async (req, res) => {
  const g = async q => Number((await getAsync(q)||{c:0}).c) || 0;
  const finSupAdvance  = await g("SELECT COUNT(*) as c FROM finance_queue WHERE status='pending'");
  const finCustAdvance = await g("SELECT COUNT(*) as c FROM orders WHERE status='payment_approval' AND (customer_payment_status IS NULL OR customer_payment_status NOT IN ('paid'))");
  const finCustNet     = await g("SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('closed','cancelled','deleted','payment_approval') AND (customer_payment_status IS NULL OR customer_payment_status NOT IN ('paid')) AND payment_terms NOT LIKE 'Advance%' AND payment_terms LIKE 'Net%'");
  const finSupNet      = await g("SELECT COUNT(*) as c FROM supplier_orders WHERE payment_terms_type='net' AND status NOT IN ('paid','cancelled') AND (payment_blocked IS NULL OR payment_blocked=0)");
  const finPORequests  = await g("SELECT COUNT(*) as c FROM po_requests WHERE status='pending'");
  res.json({
    total:         await g("SELECT COUNT(*) as c FROM orders"),
    open:          await g("SELECT COUNT(*) as c FROM orders WHERE status='open'"),
    closed:        await g("SELECT COUNT(*) as c FROM orders WHERE status='closed'"),
    delivered:     await g("SELECT COUNT(*) as c FROM orders WHERE status='delivered'"),
    failed:        await g("SELECT COUNT(*) as c FROM orders WHERE status='failed'"),
    hold:          await g("SELECT COUNT(*) as c FROM orders WHERE status='hold'"),
    delayed:       await g("SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('delivered','failed','closed') AND tentative_date<date('now') AND tentative_date!=''"),
    customers:     await g("SELECT COUNT(*) as c FROM customers"),
    suppliers:     await g("SELECT COUNT(*) as c FROM suppliers"),
    domestic:      await g("SELECT COUNT(*) as c FROM suppliers WHERE type='domestic'"),
    international: await g("SELECT COUNT(*) as c FROM suppliers WHERE type='international'"),
    linecards:     await g("SELECT COUNT(*) as c FROM linecards"),
    enquiries:     await g("SELECT COUNT(*) as c FROM enquiries"),
    enq_new:       await g("SELECT COUNT(*) as c FROM enquiries WHERE status IN ('new','modify_requested')"),
    enq_sourcing:  await g("SELECT COUNT(*) as c FROM enquiries WHERE status IN ('sourcing','returned_to_sourcing','modify_requested')"),
    enq_quoted:    await g("SELECT COUNT(*) as c FROM enquiries WHERE status='quoted'"),
    sourcing:      await g("SELECT COUNT(*) as c FROM orders WHERE status='open'"),
    procurement:      await g("SELECT COUNT(*) as c FROM orders WHERE status='procurement'"),
    in_transit:       await g("SELECT COUNT(*) as c FROM order_items WHERE line_status='shipped'"),
    finance_sup_advance:  finSupAdvance,
    finance_cust_advance: finCustAdvance,
    finance_cust_net:     finCustNet,
    finance_sup_net:      finSupNet,
    finance_po_requests:  finPORequests,
    finance_pending:      finSupAdvance + finCustAdvance + finCustNet + finSupNet + finPORequests,
    delivery_hub:    await g("SELECT COUNT(*) as c FROM orders WHERE status IN ('delivery_hub','transit_hub','partial_hub')"),
    quote_bin:       await g("SELECT COUNT(*) as c FROM quotes WHERE status='active'"),
    orders_new:      await g("SELECT COUNT(*) as c FROM orders WHERE status IN ('open','draft')"),
  });
}));



// ── STOCK INVENTORY ──────────────────────────────────────────────────────────
app.get('/api/inventory', auth, asyncRoute(async (req, res) => {
  const rows = await allAsync('SELECT si.*, c.name AS customer_name FROM stock_inventory si LEFT JOIN customers c ON c.id = si.holder_id ORDER BY si.added_at DESC');
  res.json(rows.map(r => ({
    ...r,
    holder_display: r.holder_type === 'customer'
      ? (r.customer_name || r.holder_name || r.holder_id)
      : r.holder_type === 'supplier'
        ? (r.holder_name || r.holder_id || 'Supplier')
        : (r.holder_name || 'Our Warehouse'),
  })));
}));

// Search inventory by component/manufacturer/ipn — used by Sourcing Bin auto-check
app.get('/api/inventory/search', auth, asyncRoute(async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json([]);
  const like = '%' + q + '%';
  const rows = await allAsync(
    `SELECT si.*, c.name AS customer_name FROM stock_inventory si
     LEFT JOIN customers c ON c.id = si.holder_id
     WHERE (LOWER(si.component) LIKE ? OR LOWER(si.ipn) LIKE ? OR LOWER(si.manufacturer) LIKE ?)
       AND si.quantity_available > 0
     ORDER BY si.quantity_available DESC`,
    [like, like, like]
  );
  res.json(rows.map(r => ({
    ...r,
    holder_display: r.holder_type === 'customer'
      ? (r.customer_name || r.holder_name || r.holder_id)
      : r.holder_type === 'supplier'
        ? (r.holder_name || r.holder_id || 'Supplier')
        : (r.holder_name || 'Our Warehouse'),
  })));
}));

app.post('/api/inventory', auth, asyncRoute(async (req, res) => {
  const d   = req.body;
  if (!d.component) return res.status(400).json({ error: 'Component name required' });
  const id  = 'INV-' + uuid().slice(0,8).toUpperCase();
  const now = nowStr();
  await runAsync(`INSERT INTO stock_inventory(id,component,ipn,manufacturer,linecard_id,date_code,
       quantity_total,quantity_available,target_currency,target_price,
       holder_type,holder_id,holder_name,reference_order_id,notes,added_by,added_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, d.component, d.ipn||'', d.manufacturer||'', d.linecard_id||null,
     d.date_code||'',
     parseInt(d.quantity_total)||0, parseInt(d.quantity_available||d.quantity_total)||0,
     d.target_currency||'INR', d.target_price||null,
     d.holder_type||'warehouse', d.holder_id||'', d.holder_name||'',
     d.reference_order_id||'', d.notes||'',
     req.session.user.name, now]);
  saveNow();
  res.json({ id });
}));

app.post('/api/inventory/bulk', auth, asyncRoute(async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });
  const created = [], errors = [];
  const now = nowStr();
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    if (!d.component) { errors.push(`Row ${i+2}: Component name missing`); continue; }
    try {
      const id = 'INV-' + uuid().slice(0,8).toUpperCase();
      await runAsync(`INSERT INTO stock_inventory(id,component,ipn,manufacturer,linecard_id,date_code,
           quantity_total,quantity_available,target_currency,target_price,
           holder_type,holder_id,holder_name,reference_order_id,notes,added_by,added_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, d.component, d.ipn||'', d.manufacturer||'', d.linecard_id||null,
         d.date_code||'',
         parseInt(d.quantity_available||d.quantity_total)||0, parseInt(d.quantity_available||d.quantity_total)||0,
         d.target_currency||'INR', d.target_price||null,
         d.holder_type||'warehouse', d.holder_id||'', d.holder_name||'',
         d.reference_order_id||'', d.notes||'',
         req.session.user.name, now]);
      created.push(id);
    } catch(e) { errors.push(`Row ${i+2}: ${e.message}`); }
  }
  saveNow();
  res.json({ created: created.length, errors });
}));

// ── GET /api/inventory/holds — returns on-hold qty per inventory item ────────
// Must be defined BEFORE /:id route so Express doesn't treat "holds" as an ID.
// An item is "on hold" when an enquiry sourcing row references __inv__<id>
// and the enquiry is not yet delivered/closed/cancelled.
app.get('/api/inventory/holds', auth, asyncRoute(async (req, res) => {
  const srcRows = await allAsync(
    `SELECT es.supplier_id, ei.quantity, e.status
     FROM enquiry_sourcing es
     JOIN enquiry_items ei ON ei.id = es.enquiry_item_id
     JOIN enquiries e ON e.id = es.enquiry_id
     LEFT JOIN orders o ON o.enquiry_id = e.id AND o.status NOT IN ('deleted','cancelled')
     WHERE es.supplier_id LIKE '__inv__%'
       AND e.status NOT IN ('closed','cancelled','deleted')
       AND (o.id IS NULL OR o.status NOT IN ('delivery_hub','partial_hub','transit_customer','partial_dispatched','closed'))`
  );
  const holds = {};
  for (const row of srcRows) {
    const invId = row.supplier_id.slice(7);
    const qty   = parseInt(row.quantity) || 0;
    holds[invId] = (holds[invId] || 0) + qty;
  }
  res.json(holds);
}));

app.put('/api/inventory/:id', auth, asyncRoute(async (req, res) => {
  const inv = await getAsync('SELECT * FROM stock_inventory WHERE id=?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const d = req.body;
  await runAsync(`UPDATE stock_inventory SET
       component=?,ipn=?,manufacturer=?,linecard_id=?,date_code=?,
       quantity_total=?,quantity_available=?,target_currency=?,target_price=?,
       holder_type=?,holder_id=?,holder_name=?,reference_order_id=?,notes=?
       WHERE id=?`,
    [d.component||inv.component, d.ipn??inv.ipn, d.manufacturer??inv.manufacturer,
     d.linecard_id??inv.linecard_id,
     d.date_code??inv.date_code,
     d.quantity_total!=null?parseInt(d.quantity_total):inv.quantity_total,
     d.quantity_available!=null?parseInt(d.quantity_available):inv.quantity_available,
     d.target_currency||inv.target_currency, d.target_price??inv.target_price,
     d.holder_type||inv.holder_type, d.holder_id??inv.holder_id,
     d.holder_name??inv.holder_name, d.reference_order_id??inv.reference_order_id,
     d.notes??inv.notes,
     req.params.id]);
  saveNow();
  res.json({ ok: true });
}));

app.delete('/api/inventory/:id', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM stock_inventory WHERE id=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));

// ── START ────────────────────────────────────────────────────
function getLanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) { if (net.family === 'IPv4' && !net.internal) return net.address; }
  }
  return '127.0.0.1';
}

const MAX_PORT_TRIES = 10;
const startListening = (port, triesLeft) => {
  console.log('[STARTUP] PORT =', port);
  const server = app.listen(port, '0.0.0.0', () => {
    const ip = getLanIp();
    console.log('\n' + '═'.repeat(52));
    console.log('  ⚡  CIFLUX OMS v2  –  Electronic Components');
    console.log('═'.repeat(52));
    console.log(`  Local  →  http://localhost:${port}`);
    console.log(`  LAN    →  http://${ip}:${port}`);
    console.log('═'.repeat(52) + '\n');
  });

  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE' && triesLeft > 0) {
      const nextPort = port + 1;
      console.error(`[STARTUP] Port ${port} is busy. Retrying on ${nextPort}...`);
      return startListening(nextPort, triesLeft - 1);
    }
    throw err;
  });
};

// Azure Health Check Probe
app.get('/api/health', (req, res) => {
  res.send('API is running');
});

// START SERVER FIRST (Non-blocking)
startListening(PORT, MAX_PORT_TRIES);

// THEN CONNECT TO DB
initDb().then(async () => {
  console.log('[STARTUP] DB ready — registering routes...');
  // Backfill: mark enquiries as closed if their linked order is closed
  try {
    const r = await runAsync(`UPDATE enquiries SET status='closed', updated_at=NOW() WHERE id IN (SELECT enquiry_id FROM orders WHERE status='closed' AND enquiry_id IS NOT NULL) AND status != 'closed'`);
    if (r && r.rowCount) console.log('[STARTUP] Backfilled', r.rowCount, 'enquiries → closed');
  } catch(e) { console.error('[STARTUP] Enquiry close backfill failed:', e.message); }
  // Backfill: mark quotes as closed if their linked order is closed
  try {
    const r = await runAsync(`UPDATE quotes SET status='closed' WHERE id IN (SELECT quote_id FROM orders WHERE status='closed' AND quote_id IS NOT NULL) AND status NOT IN ('superseded','closed')`);
    if (r && r.rowCount) console.log('[STARTUP] Backfilled', r.rowCount, 'quotes → closed');
  } catch(e) { console.error('[STARTUP] Quote close backfill failed:', e.message); }
  try {
    const r = await runAsync(`UPDATE quotes SET status='closed' WHERE enquiry_id IN (SELECT enquiry_id FROM orders WHERE status='closed' AND enquiry_id IS NOT NULL) AND status NOT IN ('superseded','closed')`);
    if (r && r.rowCount) console.log('[STARTUP] Backfilled', r.rowCount, 'quotes → closed (via enquiry)');
  } catch(e) { console.error('[STARTUP] Quote close backfill (enquiry) failed:', e.message); }
  // Fix: enquiries stuck at 'returned_to_sourcing' or 'quoted' that already have a live order → mark 'ordered'
  try {
    const r = await runAsync(`UPDATE enquiries SET status='ordered', updated_at=NOW() WHERE status IN ('returned_to_sourcing','quoted') AND id IN (SELECT enquiry_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND enquiry_id IS NOT NULL)`);
    if (r && r.rowCount) console.log('[STARTUP] Fixed', r.rowCount, 'enquiries stuck in returned_to_sourcing/quoted → ordered');
  } catch(e) { console.error('[STARTUP] Enquiry revision heal failed:', e.message); }
  // Fix: quotes stuck at 'returned_to_sourcing' or 'active' that already have a live order → mark 'order_created'
  try {
    const r = await runAsync(`UPDATE quotes SET status='order_created' WHERE status IN ('returned_to_sourcing','active') AND (id IN (SELECT quote_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND quote_id IS NOT NULL) OR enquiry_id IN (SELECT enquiry_id FROM orders WHERE status NOT IN ('deleted','cancelled') AND enquiry_id IS NOT NULL))`);
    if (r && r.rowCount) console.log('[STARTUP] Fixed', r.rowCount, 'quotes stuck in returned_to_sourcing/active → order_created');
  } catch(e) { console.error('[STARTUP] Quote revision heal failed:', e.message); }
  // Fix: revert orders incorrectly auto-healed to customer_payment_status='paid' without going through
  // the Release step. A properly released order has status='open' (set by customer-release endpoint).
  // If status is still 'payment_approval', the payment was never formally released — revert to 'payment_recorded'.
  try {
    await runAsync(`UPDATE orders SET customer_payment_status='payment_recorded' WHERE customer_payment_status='paid' AND status='payment_approval'`);
  } catch(_) {}
  // Migrations handled by db.js initDb() via pool.query() — no migrate() calls here
  // customer_payments table created by db.js initDb() via pool.query()
  // ─────────────────────────────────────────────────────────────────────────────
  // ── PURCHASE ORDER (Supplier PO) routes ──────────────────────────────────────

// Raise a new PO for an order → supplier
app.post('/api/orders/:id/po', auth, asyncRoute(async (req, res) => {
  const d     = req.body;
  const order = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!d.supplier_id) return res.status(400).json({ error: 'Supplier required' });
  const now = nowStr();

  // ── Check if a draft PO already exists for this supplier on this order ──────
  // If yes, update it instead of creating a duplicate
  const existingSO = await getAsync(
    "SELECT * FROM supplier_orders WHERE order_id=? AND supplier_id=? AND status='draft'",
    [req.params.id, d.supplier_id]
  );

  let poId, poNo;

  if (existingSO) {
    // Update existing draft PO
    poId = existingSO.id;
    poNo = existingSO.internal_po_no;
    const systemPoRef = order.finance_po_no || order.po_number || '';
    if (!existingSO.po_no && systemPoRef) {
      await runAsync('UPDATE supplier_orders SET po_no=? WHERE id=?', [systemPoRef, poId]);
    }
    // Remove old item links so we can re-link cleanly
    await runAsync('DELETE FROM supplier_order_items WHERE supplier_order_id=?', [poId]);
  } else {
    // Create fresh PO
    poId = uuid().slice(0,8);
    poNo = await nextPoNoAsync();
    await runAsync(`INSERT INTO supplier_orders(id,order_id,supplier_id,internal_po_no,po_no,status,
         confirmed_price,confirmed_currency,promised_delivery_date,supplier_ref,
         shipping_status,notes,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
       [poId, req.params.id, d.supplier_id, poNo, d.po_no||order.finance_po_no||order.po_number||'',
       'draft', d.confirmed_price||null, d.confirmed_currency||'INR',
       d.promised_delivery_date||'', d.supplier_ref||'',
       'pending', d.notes||'', now]);
  }

  // Link line items to this supplier order
  for (const iid of (d.item_ids||[])) {
    try { await runAsync('INSERT INTO supplier_order_items VALUES(?,?)', [poId, iid]); } catch(_) {}
  }

  // Calculate payment due date for Net terms
  let paymentDueDate = '';
  let paymentBlocked = 0;
  const netDays = parseInt(d.payment_net_days)||30;
  if (d.payment_terms_type === 'net') {
    const due = new Date();
    due.setDate(due.getDate() + netDays);
    paymentDueDate = due.toISOString().slice(0,10);
  } else if (d.payment_terms_type === 'advance') {
    paymentBlocked = 1;
  }

  // Update with payment fields
  await runAsync(`UPDATE supplier_orders SET payment_terms_type=?,payment_net_days=?,
       payment_advance_pct=?,payment_due_date=?,zoho_po_number=?,payment_blocked=?,notes=?
       WHERE id=?`,
    [d.payment_terms_type||'net', netDays,
     d.payment_advance_pct||0, paymentDueDate,
     d.zoho_po_number||'', paymentBlocked, d.notes||'', poId]);

  // If advance payment required → create finance queue item
  // FIX B: check for existing pending entry before inserting to prevent duplicates
  if (paymentBlocked === 1) {  // create finance_queue even if confirmed_price not yet set
    // Set order status to sup_payment_update so it's visible across the system
    await runAsync("UPDATE orders SET status='sup_payment_update' WHERE id=? AND status NOT IN ('closed','cancelled','payment_approval','cust_payment_update')", [req.params.id]);
    const existingFQ = await getAsync(
      "SELECT id FROM finance_queue WHERE supplier_order_id=? AND status='pending'",
      [poId]
    );
    if (existingFQ) {
      await runAsync('UPDATE finance_queue SET amount=?,currency=?,payment_terms=? WHERE id=?',
        [d.confirmed_price, d.confirmed_currency||'INR',
         (d.payment_advance_pct||100)+'% Advance required', existingFQ.id]);
    } else {
      const fqId = uuid();
      await runAsync(`INSERT INTO finance_queue(id,supplier_order_id,order_id,supplier_id,amount,
           currency,payment_terms,due_date,status,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [fqId, poId, req.params.id, d.supplier_id,
         d.confirmed_price, d.confirmed_currency||'INR',
         (d.payment_advance_pct||100)+'% Advance required',
         '', 'pending', now]);
    }
  }

  try {
    await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
      [uuid(), req.params.id,
       `PO raised: ${poNo} → ${d.supplier_id}${paymentBlocked?' [BLOCKED - Advance required]':''}`,
       req.session.user.name, '', now]);
  } catch(_) {}

  saveNow();
  res.json({ id: poId, internal_po_no: poNo, payment_blocked: paymentBlocked });
}));

// Update a supplier PO (status, confirmed price, tracking etc.)
app.put('/api/supplier-orders/:id', auth, asyncRoute(async (req, res) => {
  const d  = req.body;
  const so = await getAsync('SELECT * FROM supplier_orders WHERE id=?', [req.params.id]);
  if (!so) return res.status(404).json({ error: 'PO not found' });
  const now = nowStr();

  const newStatus       = d.status ?? so.status;
  const confirmedAt     = newStatus === 'confirmed' && so.status !== 'confirmed' ? now : (so.confirmed_at||null);
  const receivedAt      = newStatus === 'received'  && so.status !== 'received'  ? now : (so.received_at||null);

  await runAsync(`UPDATE supplier_orders SET
       po_no=?, status=?, confirmed_price=?, confirmed_currency=?,
       promised_delivery_date=?, supplier_ref=?, shipping_status=?,
       shipper_id=?, tracking_no=?, notes=?,
       zoho_po_number=?, payment_terms_type=?, payment_net_days=?,
       payment_advance_pct=?, payment_due_date=?,
       confirmed_at=?, received_at=?
       WHERE id=?`,
    [d.po_no ?? so.po_no ?? '',
     newStatus,
     d.confirmed_price    ?? so.confirmed_price    ?? null,
     d.confirmed_currency ?? so.confirmed_currency ?? 'INR',
     d.promised_delivery_date ?? so.promised_delivery_date ?? '',
     d.supplier_ref       ?? so.supplier_ref       ?? '',
     d.shipping_status    ?? so.shipping_status    ?? 'pending',
     d.shipper_id         ?? so.shipper_id         ?? null,
     d.tracking_no        ?? so.tracking_no        ?? '',
     d.notes              ?? so.notes              ?? '',
     d.zoho_po_number     ?? so.zoho_po_number     ?? '',
     d.payment_terms_type ?? so.payment_terms_type ?? 'net',
     d.payment_net_days   ?? so.payment_net_days   ?? 30,
     d.payment_advance_pct?? so.payment_advance_pct?? 0,
     d.payment_due_date   ?? so.payment_due_date   ?? '',
     confirmedAt, receivedAt,
     req.params.id]);

  // Log status change
  if (d.status && d.status !== so.status) {
    try {
      const ordHistory = await getAsync('SELECT id FROM orders WHERE id=?', [so.order_id]);
      if (ordHistory) {
        await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
          [uuid(), so.order_id,
           `PO ${so.internal_po_no||so.id}: ${so.status} → ${d.status}`,
           req.session.user.name, d.notes||'', now]);
      }
    } catch(_) {}
  }

  // When PO → in_transit, set parent order to transit_hub so it shows in Delivery Hub
  if (newStatus === 'in_transit' && so.status !== 'in_transit') {
    await runAsync("UPDATE orders SET status='transit_hub' WHERE id=? AND status NOT IN ('delivery_hub','partial_hub','partial_dispatched','transit_customer','closed','cancelled')", [so.order_id]);
  }

  // When PO is received → update linked order line items to 'delivered_hub'
  if (newStatus === 'received' && so.status !== 'received') {
    const linkedItems = await allAsync('SELECT item_id FROM supplier_order_items WHERE supplier_order_id=?', [req.params.id]);
    for (const li of linkedItems) {
      await runAsync("UPDATE order_items SET line_status='delivered_hub' WHERE id=?", [li.item_id]);
    }
    // FIX: if ALL POs for this order are now received, set order status to delivery_hub
    const allPOs = await allAsync('SELECT status FROM supplier_orders WHERE order_id=?', [so.order_id]);
    const allReceived = allPOs.every(p => p.status === 'received' || p.id === req.params.id);
    if (allReceived) {
      await runAsync("UPDATE orders SET status='delivery_hub' WHERE id=? AND status NOT IN ('closed','cancelled')", [so.order_id]);
    }
  }

  saveNow();
  res.json({ ok: true });
}));

// Delete a PO
app.delete('/api/supplier-orders/:id', auth, asyncRoute(async (req, res) => {
  const so = await getAsync('SELECT * FROM supplier_orders WHERE id=?', [req.params.id]);
  if (!so) return res.status(404).json({ error: 'Not found' });
  await runAsync('DELETE FROM supplier_order_items WHERE supplier_order_id=?', [req.params.id]);
  await runAsync('DELETE FROM supplier_orders WHERE id=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));

// Sync ALL draft POs for an order to their supplier's current payment terms
app.post('/api/orders/:id/sync-po-terms', auth, asyncRoute(async (req, res) => {
  const sos = await allAsync("SELECT so.*, s.payment_terms_type as sup_type, s.payment_net_days as sup_days, s.payment_advance_pct as sup_pct FROM supplier_orders so LEFT JOIN suppliers s ON so.supplier_id=s.id WHERE so.order_id=$1 AND so.status='draft'", [req.params.id]);
  let synced = 0;
  for (const so of sos) {
    if (!so.sup_type) continue;
    const now = nowStr();
    let paymentDueDate = '';
    let paymentBlocked = 0;
    if (so.sup_type === 'net') {
      const due = new Date(); due.setDate(due.getDate() + (so.sup_days||30));
      paymentDueDate = due.toISOString().slice(0,10);
    } else if (so.sup_type === 'advance' || so.sup_type === 'split') {
      paymentBlocked = 1;
    }
    await runAsync('UPDATE supplier_orders SET payment_terms_type=?,payment_net_days=?,payment_advance_pct=?,payment_due_date=?,payment_blocked=? WHERE id=?',
      [so.sup_type, so.sup_days||30, so.sup_pct||0, paymentDueDate, paymentBlocked, so.id]);
    // Create finance queue entry if now blocked and not already there
    if (paymentBlocked) {
      const existing = await getAsync("SELECT id FROM finance_queue WHERE supplier_order_id=? AND status='pending'", [so.id]);
      if (!existing && so.confirmed_price) {
        await runAsync('INSERT INTO finance_queue(id,supplier_order_id,order_id,supplier_id,amount,currency,payment_terms,due_date,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [uuid(), so.id, req.params.id, so.supplier_id, so.confirmed_price, so.confirmed_currency||'INR',
           (so.sup_pct||100)+'% Advance required', '', 'pending', now]);
      }
    }
    synced++;
  }
  saveNow();
  res.json({ ok:true, synced });
}));

// Deduplicate draft POs for an order — keeps the latest per supplier, deletes older duplicates
app.post('/api/orders/:id/deduplicate-pos', auth, asyncRoute(async (req, res) => {
  const oid  = req.params.id;
  const sos  = await allAsync("SELECT * FROM supplier_orders WHERE order_id=? AND status='draft' ORDER BY rowid ASC", [oid]);
  // Group by supplier_id — keep last, delete earlier ones
  const seen = {};
  const toDelete = [];
  // Iterate in reverse so we keep the LATEST (highest rowid) per supplier
  [...sos].reverse().forEach(so => {
    if (seen[so.supplier_id]) {
      toDelete.push(so.id);
    } else {
      seen[so.supplier_id] = so.id;
    }
  });
  for (const id of toDelete) {
    await runAsync('DELETE FROM supplier_order_items WHERE supplier_order_id=?', [id]);
    await runAsync('DELETE FROM supplier_orders WHERE id=?', [id]);
  }
  saveNow();
  res.json({ ok: true, removed: toDelete.length });
}));

// ── APP SETTINGS ─────────────────────────────────────────────────────────────
app.get('/api/settings', auth, asyncRoute(async (req, res) => {
  const rows = await allAsync('SELECT key, value FROM app_settings');
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
}));
app.put('/api/settings', auth, asyncRoute(async (req, res) => {
  const u = req.session.user;
  if (!['admin','manager'].includes(u.role)) return res.status(403).json({ error: 'Admin only' });
  const d   = req.body;
  const now = nowStr();
  for (const [key, value] of Object.entries(d)) {
    const existing = await getAsync('SELECT key FROM app_settings WHERE key=?', [key]);
    if (existing) {
      await runAsync('UPDATE app_settings SET value=?, updated_at=? WHERE key=?', [String(value), now, key]);
    } else {
      await runAsync('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)', [key, String(value), now]);
    }
  }
  saveNow();
  res.json({ ok: true });
}));

// ── PO TEMPLATES ──────────────────────────────────────────────────────────────
app.get('/api/po-templates', auth, asyncRoute(async (req, res) => {
  res.json(await allAsync('SELECT * FROM po_templates ORDER BY is_default DESC, name ASC'));
}));
app.post('/api/po-templates', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  await runAsync('INSERT INTO po_templates(id,name,type,is_default,config,created_at) VALUES(?,?,?,?,?,?)',
    [id, d.name, d.type||'standard', d.is_default?1:0,
     typeof d.config==='string'?d.config:JSON.stringify(d.config), nowStr()]);
  if (d.is_default) await runAsync('UPDATE po_templates SET is_default=0 WHERE id!=?', [id]);
  saveNow();
  res.json({ id });
}));
app.put('/api/po-templates/:id', auth, asyncRoute(async (req, res) => {
  const d = req.body;
  await runAsync('UPDATE po_templates SET name=?,type=?,is_default=?,config=? WHERE id=?',
    [d.name, d.type||'standard', d.is_default?1:0,
     typeof d.config==='string'?d.config:JSON.stringify(d.config), req.params.id]);
  if (d.is_default) await runAsync('UPDATE po_templates SET is_default=0 WHERE id!=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));
app.delete('/api/po-templates/:id', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM po_templates WHERE id=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));

// ── FINANCE QUEUE ─────────────────────────────────────────────────────────────
// ── Repair: single SQL INSERT for any missing finance_queue entries ───────────
app.post('/api/finance-queue/repair', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM finance_queue WHERE supplier_order_id NOT IN (SELECT id FROM supplier_orders)');
  saveNow();
  res.json({ ok: true });
}));

app.get('/api/finance-queue', auth, asyncRoute(async (req, res) => {
  const entries = await allAsync('SELECT * FROM finance_queue ORDER BY created_at DESC');
  res.json(entries);
}));

// Finance pays a blocked PO → release it
app.put('/api/finance-queue/:id', auth, asyncRoute(async (req, res) => {
  const d  = req.body;
  const fq = await getAsync('SELECT * FROM finance_queue WHERE id=?', [req.params.id]);
  if (!fq) return res.status(404).json({ error: 'Not found' });
  const now = nowStr();
  await runAsync(`UPDATE finance_queue SET status=?,payment_ref=?,payment_date=?,
       paid_amount=?,paid_by=?,notes=?,paid_at=? WHERE id=?`,
    [d.status||'paid', d.payment_ref||'', d.payment_date||now.slice(0,10),
     d.paid_amount||fq.amount, req.session.user.name,
     d.notes||'', now, req.params.id]);

  // Release the PO block
  if (d.status==='paid' || d.status==='released') {
    await runAsync('UPDATE supplier_orders SET payment_blocked=0, status=? WHERE id=?',
      ['sent', fq.supplier_order_id]);
    try {
      const soRow = await getAsync('SELECT internal_po_no FROM supplier_orders WHERE id=?', [fq.supplier_order_id]);
      await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
        [uuid(), fq.order_id,
         'Finance released PO ' + (soRow?.internal_po_no||fq.supplier_order_id),
         req.session.user.name, d.notes||'', now]);
    } catch(_) {}
  }
  saveNow();
  res.json({ ok: true });
}));

// ── Update PO to include payment terms + Zoho PO + finance queue trigger ─────
// (Override the existing PUT /api/supplier-orders/:id to handle payment blocking)

// ── Client-side error logging endpoint ───────────────────────────────────────
app.post('/api/log-client-error', (req, res) => {
  const { message, stack, component, url, time } = req.body || {};
  const entry = `[${time||new Date().toISOString()}] [CLIENT]\n  URL:      ${url||'unknown'}\n  Message:  ${message||'unknown'}\n  Stack:    ${(stack||'none').split('\n')[0]}\n${'─'.repeat(60)}\n`;
  writeLog(LOG_CLIENT_ERR, entry);
  writeLog(LOG_SERVER_ALL, entry);
  console.error('[CLIENT ERROR]', message);
  res.json({ ok: true });
});

// ── Global error handler — catches unhandled route errors ────────────────────
app.use((err, req, res, next) => {
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Serve logs directory for easy access ─────────────────────────────────────
app.use('/logs', (req, res, next) => {
  // Only allow .log files
  if (!req.path.endsWith('.log')) return res.status(403).send('Forbidden');
  next();
}, express.static(path.join(__dirname, '..', 'logs')));

// ── FINANCE ROUTES ────────────────────────────────────────────────────────────

function isAdvanceTerms(t) {
  if (!t) return false;
  const l = t.toLowerCase();
  return l.includes('advance') || l.includes('cia') || l.includes('cash in advance') ||
         l.includes('cash before shipment') || l.includes('cbs') || l.includes('100%');
}
function isPartialAdvanceTerms(t) {
  if (!t) return false;
  return t.toLowerCase().includes('partial advance');
}
function isNetTerms(t) {
  if (!t) return false;
  const l = t.toLowerCase();
  return l.includes('net ') || l.includes('eom') || l.includes('net30') ||
         l.includes('deferred') || l.includes('consignment');
}

function normalizedFinanceDocNo(prefix, orderId, existingValue) {
  const year = new Date().getFullYear();
  const normalized = `CIFLUX-${prefix}-${orderId}-${year}`;
  if (!existingValue) return normalized;
  return existingValue.startsWith(`CIFLUX-${prefix}-`) ? existingValue : normalized;
}

// GET /api/finance/customer-queue
app.get('/api/finance/customer-queue', auth, asyncRoute(async (req, res) => {
  const orders = await allAsync("SELECT * FROM orders WHERE status NOT IN ('closed','cancelled','deleted') ORDER BY created_at DESC");
  const customers = await allAsync('SELECT id, name, email, phone, gstin, vat_number, customer_scope, customer_no, billing_attention, billing_street1, billing_street2, billing_city, billing_state, billing_country, billing_pincode, billing_phone FROM customers');
  let payments = [];
  try { payments = await allAsync('SELECT * FROM customer_payments ORDER BY recorded_at DESC'); } catch(_) {}
  const custMap = {};
  customers.forEach(c => { custMap[c.id] = c; });
  const filtered = orders.filter(o => {
    if (o.customer_payment_status === 'paid') return false;
    const SUPPLIER_ONLY_STATUSES = ['procurement', 'sup_payment_update', 'sourcing', 'enquiry', 'quote'];
    if (SUPPLIER_ONLY_STATUSES.includes(o.status)) return false;
    if (o.status === 'payment_approval' || o.status === 'waiting_for_payment' || o.status === 'cust_payment_update') return true;
    return (o.payment_terms || '').length > 0;
  });
  // Fetch all order items in one query then group by order_id
  const orderIds = filtered.map(o => o.id);
  let allItems = [];
  if (orderIds.length) {
    allItems = await allAsync(`SELECT order_id, unit_price, qty, tax_rate FROM order_items WHERE order_id IN (${orderIds.map(()=>'?').join(',')})`, orderIds);
  }
  const itemsByOrder = {};
  allItems.forEach(li => { (itemsByOrder[li.order_id] = itemsByOrder[li.order_id] || []).push(li); });
  const enriched = filtered.map(o => {
    const items = itemsByOrder[o.id] || [];
    const total = items.reduce((s, li) => {
      const base = (li.qty||0)*(li.unit_price||0);
      return s + base + base*((li.tax_rate||0)/100);
    }, 0);
    const orderPayments = payments.filter(p => p.order_id === o.id && p.status === 'paid');
    const paid = orderPayments.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
    return {
      ...o,
      customer: custMap[o.customer_id] || null,
      order_total: parseFloat(total.toFixed(2)),
      total_paid:  parseFloat(paid.toFixed(2)),
      balance_due: parseFloat(Math.max(0, total - paid).toFixed(2)),
      payment_type: isAdvanceTerms(o.payment_terms) ? 'full_advance'
        : isPartialAdvanceTerms(o.payment_terms) ? 'partial_advance'
        : isNetTerms(o.payment_terms) ? 'net' : 'other',
      last_payment: orderPayments[0] || null,
      _computed_total: total,
      _computed_paid: paid,
    };
  });
  // Auto-heal: if actual payments already fully cover the total but status is still payment_approval
  // (e.g. legacy data or test records), bump it to payment_recorded so Finance sees the Release button
  // instead of a dead "Record Payment" that errors with "already fully paid".
  // Do NOT set 'paid' here — that only happens when Finance explicitly clicks Release.
  const healPromises = [];
  for (const o of enriched) {
    if (o._computed_total > 0 && o._computed_paid >= o._computed_total && o.customer_payment_status === 'payment_approval') {
      healPromises.push(runAsync("UPDATE orders SET customer_payment_status='payment_recorded' WHERE id=?", [o.id]).catch(()=>{}));
    }
  }
  if (healPromises.length) await Promise.all(healPromises);
  const result = enriched.map(({ _computed_total, _computed_paid, ...o }) => {
    // Reflect healed status in response immediately without waiting for next request
    if (_computed_total > 0 && _computed_paid >= _computed_total && o.customer_payment_status === 'payment_approval') {
      return { ...o, customer_payment_status: 'payment_recorded' };
    }
    return o;
  });
  res.json(result);
}));

// POST /api/finance/pi/:order_id
app.post('/api/finance/pi/:order_id', auth, asyncRoute(async (req, res) => {
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.order_id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const now = nowStr();
  const piNo = normalizedFinanceDocNo('PI', req.params.order_id, o.pi_no);
  await runAsync('UPDATE orders SET pi_no=?, pi_sent_at=? WHERE id=?', [piNo, now, req.params.order_id]);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), req.params.order_id, 'PI generated: '+piNo, req.session.user.name, '', now]); } catch(_) {}

  const orderItems = await allAsync('SELECT id, supplier_id FROM order_items WHERE order_id=?', [req.params.order_id]);
  const bySupplier = {};
  orderItems.forEach(li => {
    if (!li?.supplier_id) return;
    if (!bySupplier[li.supplier_id]) bySupplier[li.supplier_id] = [];
    bySupplier[li.supplier_id].push(li.id);
  });

  const autoCreated = [];
  for (const [supplierId, itemIds] of Object.entries(bySupplier)) {
    const existing = await getAsync('SELECT id, internal_po_no FROM supplier_orders WHERE order_id=? AND supplier_id=? LIMIT 1',
      [req.params.order_id, supplierId]);
    if (existing) continue;

    const poId = uuid().slice(0,8);
    const poNo = nextPoNo();
    await runAsync(`INSERT INTO supplier_orders(id,order_id,supplier_id,internal_po_no,po_no,status,
         confirmed_price,confirmed_currency,promised_delivery_date,supplier_ref,
         shipping_status,notes,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [poId, req.params.order_id, supplierId, poNo, o.po_number||'',
       'draft', null, 'INR', '', '', 'pending', 'Auto-created from PI generation', now]);

    for (const itemId of itemIds) {
      try { await runAsync('INSERT INTO supplier_order_items VALUES(?,?)', [poId, itemId]); } catch(_) {}
    }
    autoCreated.push({ id: poId, internal_po_no: poNo, supplier_id: supplierId });
  }

  if (autoCreated.length > 0) {
    try {
      await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
        [uuid(), req.params.order_id,
         `Auto-created ${autoCreated.length} PO(s) from PI generation`,
         req.session.user.name, '', now]);
    } catch(_) {}
  }

  saveNow();
  res.json({ ok: true, pi_no: piNo, auto_pos: autoCreated });
}));

// POST /api/finance/po/:order_id
app.post('/api/finance/po/:order_id', auth, asyncRoute(async (req, res) => {
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.order_id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const now = nowStr();
  const poNo = normalizedFinanceDocNo('PO', req.params.order_id, o.finance_po_no);

  await runAsync('UPDATE orders SET finance_po_no=?, po_generated_at=? WHERE id=?', [poNo, now, req.params.order_id]);
  try {
    await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
      [uuid(), req.params.order_id, 'Finance PO generated: ' + poNo, req.session.user.name, '', now]);
  } catch(_) {}

  saveNow();
  res.json({ ok: true, po_no: poNo });
}));

// POST /api/finance/customer-pay/:order_id
app.post('/api/finance/customer-pay/:order_id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.order_id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const now = nowStr();
  const items = await allAsync('SELECT unit_price, qty, tax_rate FROM order_items WHERE order_id=?', [req.params.order_id]);
  const total = items.reduce((s,li)=>{const b=(li.qty||0)*(li.unit_price||0);return s+b+b*((li.tax_rate||0)/100);},0);
  let prevPaid = 0;
  let prevRows = [];
  try {
    prevRows = await allAsync("SELECT amount FROM customer_payments WHERE order_id=? AND status='paid'", [req.params.order_id]);
    prevPaid = prevRows.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  } catch(_) {}
  const incomingAmount = parseFloat(d.amount)||0;
  if (total > 0 && incomingAmount > total) {
    return res.status(400).json({ error: `Payment amount (${incomingAmount.toFixed(2)}) exceeds order total (${total.toFixed(2)}). Please check the amount.` });
  }
  if (total > 0 && prevPaid >= total) {
    return res.status(400).json({ error: `Order is already fully paid (paid: ${prevPaid.toFixed(2)}, total: ${total.toFixed(2)}). Use the Edit option to correct any wrong payment.` });
  }
  const newPaid  = prevPaid + incomingAmount;
  const balance  = parseFloat(Math.max(0,total-newPaid).toFixed(2));
  await runAsync(`INSERT INTO customer_payments(
        id, order_id, customer_po_no, finance_po_no, pi_no, pi_sent_at,
        payment_type, amount, currency, payment_method, payment_ref,
        payment_date, advance_pct, balance_due, status, recorded_by, recorded_at, notes
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uuid(), req.params.order_id, d.customer_po_no||o.po_number||'', d.finance_po_no||o.finance_po_no||'',
     d.pi_no||o.pi_no||'', d.pi_sent_at||'',
     d.payment_type||'advance', parseFloat(d.amount)||0, d.currency||'INR',
     d.payment_method||'', d.payment_ref||'', d.payment_date||now.slice(0,10),
     parseFloat(d.advance_pct)||0, balance, 'paid',
     req.session.user.id, now, d.notes||'']);
  await runAsync('UPDATE orders SET customer_payment_status=? WHERE id=?', ['payment_recorded', req.params.order_id]);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), req.params.order_id, 'Customer payment recorded: '+(d.currency||'INR')+' '+d.amount, req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true, balance_due: balance, status: 'payment_recorded' });
}));

// POST /api/finance/customer-release/:order_id — confirm and release payment to procurement
app.post('/api/finance/customer-release/:order_id', auth, asyncRoute(async (req, res) => {
  const o = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.order_id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const now = nowStr();
  await runAsync("UPDATE orders SET status='open', customer_payment_status='paid' WHERE id=?", [req.params.order_id]);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), req.params.order_id, 'Customer payment released to procurement', req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// ── PO REQUESTS (Procurement → Finance workflow for Supplier PI + Zoho PO) ───

// GET /api/po-requests
app.get('/api/po-requests', auth, asyncRoute(async (req, res) => {
  const rows = await allAsync("SELECT * FROM po_requests ORDER BY requested_at DESC");
  res.json(rows);
}));

// POST /api/po-requests — Procurement requests Finance fill in PI + Zoho PO
app.post('/api/po-requests', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  if (!d.order_id || !d.supplier_id) return res.status(400).json({ error: 'order_id and supplier_id are required' });
  const now = nowStr();
  try {
    const existing = await getAsync("SELECT id FROM po_requests WHERE order_id=? AND supplier_id=? AND status='pending'",
      [d.order_id, d.supplier_id]);
    if (existing) return res.json({ ok: true, id: existing.id, already_exists: true });
  } catch(_) {}
  // ensure payment_terms_type column exists
  try { await runAsync("ALTER TABLE po_requests ADD COLUMN payment_terms_type TEXT DEFAULT 'net'"); } catch(_) {}
  const id = uuid();
  await runAsync(`INSERT INTO po_requests(id,order_id,supplier_order_id,supplier_id,supplier_name,order_ref,
       status,requested_by,requested_at,notes,fulfilled_by,fulfilled_at,supplier_ref,zoho_po_number,payment_terms_type)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, d.order_id, d.supplier_order_id||'', d.supplier_id,
     d.supplier_name||'', d.order_ref||'',
     'pending', req.session.user.name, now,
     d.notes||'', '', '', '', '', d.payment_terms_type||'net']);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), d.order_id, 'PO request sent to Finance for supplier: '+(d.supplier_name||d.supplier_id),
     req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true, id });
}));

// PUT /api/po-requests/:id — Finance fulfills request with supplier_ref + zoho_po_number
app.put('/api/po-requests/:id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const pr = await getAsync('SELECT * FROM po_requests WHERE id=?', [req.params.id]);
  if (!pr) return res.status(404).json({ error: 'Request not found' });
  const isAdvance = (pr.payment_terms_type==='advance'||pr.payment_terms_type==='split');
  if (!d.zoho_po_number?.trim())
    return res.status(400).json({ error: 'Zoho PO number is required' });
  if (isAdvance && !d.supplier_ref?.trim())
    return res.status(400).json({ error: 'Supplier PI number is required for advance payment terms' });
  const now = nowStr();
  const supplierRef = d.supplier_ref?.trim() || '';
  await runAsync(`UPDATE po_requests SET status='fulfilled', fulfilled_by=?, fulfilled_at=?,
       supplier_ref=?, zoho_po_number=? WHERE id=?`,
    [req.session.user.name, now, supplierRef, d.zoho_po_number.trim(), req.params.id]);
  if (pr.supplier_order_id) {
    try {
      await runAsync('UPDATE supplier_orders SET supplier_ref=?, zoho_po_number=? WHERE id=?',
        [supplierRef, d.zoho_po_number.trim(), pr.supplier_order_id]);
    } catch(_) {}
  }
  const histNote = isAdvance
    ? 'Finance fulfilled PO request — PI: '+supplierRef+' | Zoho PO: '+d.zoho_po_number.trim()
    : 'Finance fulfilled PO request — Zoho PO: '+d.zoho_po_number.trim();
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), pr.order_id, histNote, req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// DELETE /api/po-requests/:id — cancel a pending request
app.delete('/api/po-requests/:id', auth, asyncRoute(async (req, res) => {
  await runAsync('DELETE FROM po_requests WHERE id=?', [req.params.id]);
  saveNow();
  res.json({ ok: true });
}));


app.put('/api/finance/customer-pay/:payment_id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const pmt = await getAsync('SELECT * FROM customer_payments WHERE id=?', [req.params.payment_id]);
  if (!pmt) return res.status(404).json({ error: 'Payment not found' });
  if (!d.approver_username || !d.approver_password)
    return res.status(400).json({ error: 'Manager approval required' });
  const approver = await getAsync("SELECT * FROM users WHERE (username=? OR email=?) AND status='active'",
    [d.approver_username, d.approver_username]);
  if (!approver) return res.status(401).json({ error: 'Approver not found' });
  if (!['admin','manager'].includes(approver.role))
    return res.status(403).json({ error: 'Only managers or admins can approve edits' });
  if (!bcrypt.compareSync(d.approver_password, approver.password))
    return res.status(401).json({ error: 'Incorrect password' });
  const now = nowStr();
  await runAsync(`UPDATE customer_payments SET amount=?,currency=?,payment_method=?,payment_ref=?,
       payment_date=?,notes=?,recorded_by=? WHERE id=?`,
    [parseFloat(d.amount)||pmt.amount, d.currency||pmt.currency,
     d.payment_method||pmt.payment_method, d.payment_ref||pmt.payment_ref,
     d.payment_date||pmt.payment_date, d.notes||pmt.notes,
     req.session.user.id, req.params.payment_id]);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), pmt.order_id,
     'Payment edited by '+req.session.user.name+' — approved by '+approver.name,
     req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// GET /api/finance/customer-pay/:order_id — get payment records for an order
app.get('/api/finance/customer-pay/:order_id', auth, asyncRoute(async (req, res) => {
  const pmts = await allAsync('SELECT * FROM customer_payments WHERE order_id=? ORDER BY recorded_at DESC',
    [req.params.order_id]);
  res.json(pmts);
}));

// GET /api/finance/supplier-queue
app.get('/api/finance/supplier-queue', auth, asyncRoute(async (req, res) => {
  let advRows = [];
  try { advRows = await allAsync("SELECT fq.*, so.payment_terms_type, so.payment_advance_pct, so.confirmed_price, so.confirmed_currency, so.zoho_po_number, so.internal_po_no FROM finance_queue fq LEFT JOIN supplier_orders so ON so.id=fq.supplier_order_id WHERE fq.status='pending'"); } catch(_) {}
  const netRows = await allAsync("SELECT so.* FROM supplier_orders so WHERE so.payment_terms_type='net' AND so.status NOT IN ('paid','cancelled') AND (so.payment_blocked IS NULL OR so.payment_blocked=0)");
  const suppliers = await allAsync('SELECT id, name, type, bank_account_name, bank_account_no, bank_ifsc, bank_name, bank_branch, bank_swift, bank_iban, bank_aba, bank_country, bank_currency FROM suppliers');
  const supMap = {}; suppliers.forEach(s => { supMap[s.id] = s; });
  res.json({
    advance: advRows.map(r => ({ ...r, supplier: supMap[r.supplier_id]||null })),
    net:     netRows.map(r => ({ ...r, supplier: supMap[r.supplier_id]||null })),
  });
}));

// PUT /api/finance/supplier-pay/:fq_id
app.put('/api/finance/supplier-pay/:fq_id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const fq = await getAsync('SELECT * FROM finance_queue WHERE id=?', [req.params.fq_id]);
  if (!fq) return res.status(404).json({ error: 'Not found' });

  let bankEntity = null;
  if (fq.supplier_id && fq.supplier_id.startsWith('__inv__')) {
    const invId = fq.supplier_id.slice(7);
    const inv = await getAsync('SELECT holder_type, holder_id FROM stock_inventory WHERE id=?', [invId]);
    if (inv?.holder_type === 'customer') {
      bankEntity = await getAsync('SELECT id, bank_account_name, bank_account_no, bank_ifsc, bank_swift FROM customers WHERE id=?', [inv.holder_id]);
    } else if (inv?.holder_type === 'supplier') {
      bankEntity = await getAsync('SELECT id, type, bank_account_name, bank_account_no, bank_ifsc, bank_swift FROM suppliers WHERE id=?', [inv.holder_id]);
    }
  } else {
    bankEntity = await getAsync('SELECT id, type, bank_account_name, bank_account_no, bank_ifsc, bank_swift FROM suppliers WHERE id=?', [fq.supplier_id]);
  }

  if (!bankEntity) return res.status(400).json({ error: 'Payee not found — add bank details first' });
  const baseBankOk = !!(bankEntity.bank_account_name && bankEntity.bank_account_no);
  const bankReady = bankEntity.type === 'international'
    ? (baseBankOk && !!bankEntity.bank_swift)
    : (baseBankOk && !!(bankEntity.bank_ifsc || bankEntity.bank_swift));
  if (!bankReady) return res.status(400).json({ error: 'Bank details are required before marking paid' });

  const zohoPo = (d.zoho_po_number || '').trim();
  const supplierRef = (d.supplier_ref || '').trim();
  if (!zohoPo || !supplierRef) return res.status(400).json({ error: 'Zoho PO Number and Supplier PI Number are required' });

  const now = nowStr();
  await runAsync('UPDATE finance_queue SET status=?,payment_ref=?,payment_date=?,paid_by=?,paid_at=?,notes=? WHERE id=?',
    ['paid', d.payment_ref||'', d.payment_date||now.slice(0,10), req.session.user.id, now, d.notes||'', req.params.fq_id]);
  await runAsync('UPDATE supplier_orders SET payment_blocked=0, status=?, zoho_po_number=?, supplier_ref=? WHERE id=?', ['po_issued', zohoPo, supplierRef, fq.supplier_order_id]);
  const remainingBlocked = await getAsync(
    "SELECT COUNT(*) as c FROM supplier_orders WHERE order_id=? AND payment_blocked=1",
    [fq.order_id]
  );
  if (parseInt(remainingBlocked?.c || 0) === 0) {
    const ord = await getAsync('SELECT status FROM orders WHERE id=?', [fq.order_id]);
    if (ord?.status === 'sup_payment_update') {
      await runAsync("UPDATE orders SET status='procurement' WHERE id=?", [fq.order_id]);
    }
  }
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), fq.order_id, 'Supplier paid | Ref: '+(d.payment_ref||'—')+' | PO unblocked → back to Procurement', req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// PUT /api/finance/supplier-net-pay/:so_id — record net-term settlement against a supplier order
app.put('/api/finance/supplier-net-pay/:so_id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const so = await getAsync('SELECT * FROM supplier_orders WHERE id=?', [req.params.so_id]);
  if (!so) return res.status(404).json({ error: 'Supplier order not found' });

  const zohoPo    = (d.zoho_po_number || '').trim();
  const supplierRef = (d.supplier_ref || '').trim();
  if (!zohoPo || !supplierRef) return res.status(400).json({ error: 'Zoho PO Number and Supplier PI Number are required' });
  if (!d.payment_ref || !String(d.payment_ref).trim()) return res.status(400).json({ error: 'UTR / Ref No. is required' });
  if (!d.payment_method) return res.status(400).json({ error: 'Payment method is required' });

  // Add columns if they don't exist yet
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_payment_ref TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_payment_date TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_payment_method TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_paid_by TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_paid_at TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_payment_notes TEXT DEFAULT ''"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_payment_amount NUMERIC DEFAULT NULL"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_orders ADD COLUMN net_total_paid NUMERIC DEFAULT 0"); } catch(_) {}
  // Log table — one row per payment installment
  try { await runAsync(`CREATE TABLE IF NOT EXISTS supplier_net_payment_logs (
    id TEXT PRIMARY KEY, supplier_order_id TEXT, order_id TEXT,
    amount NUMERIC, currency TEXT, payment_ref TEXT, payment_date TEXT,
    payment_method TEXT, zoho_po_number TEXT, supplier_ref TEXT,
    notes TEXT, paid_by TEXT, paid_at TEXT,
    total_paid_snapshot NUMERIC, remaining_snapshot NUMERIC, grand_total NUMERIC
  )`); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_net_payment_logs ADD COLUMN total_paid_snapshot NUMERIC DEFAULT 0"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_net_payment_logs ADD COLUMN remaining_snapshot NUMERIC DEFAULT 0"); } catch(_) {}
  try { await runAsync("ALTER TABLE supplier_net_payment_logs ADD COLUMN grand_total NUMERIC DEFAULT 0"); } catch(_) {}

  const thisPayment  = parseFloat(d.amount) || 0;
  const prevPaid     = parseFloat(so.net_total_paid) || 0;
  const newTotalPaid = prevPaid + thisPayment;
  const total        = parseFloat(so.confirmed_price) || 0;
  const isFullyPaid  = total > 0 ? newTotalPaid >= total : true;
  const newStatus    = isFullyPaid ? 'paid' : 'partial_paid';
  const remaining    = Math.max(0, total - newTotalPaid);
  const now = nowStr();

  // Save this installment to the log — snapshots capture exact state at time of payment
  await runAsync(
    `INSERT INTO supplier_net_payment_logs(id,supplier_order_id,order_id,amount,currency,payment_ref,payment_date,payment_method,zoho_po_number,supplier_ref,notes,paid_by,paid_at,total_paid_snapshot,remaining_snapshot,grand_total)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uuid(), so.id, so.order_id, thisPayment, so.confirmed_currency||'INR',
     d.payment_ref||'', d.payment_date||now.slice(0,10), d.payment_method||'',
     zohoPo, supplierRef, d.notes||'', req.session.user.id, now,
     newTotalPaid, remaining, total]
  );

  // Update supplier order with latest payment info + cumulative total
  await runAsync(
    `UPDATE supplier_orders SET status=?, zoho_po_number=?, supplier_ref=?,
       net_payment_ref=?, net_payment_date=?, net_payment_method=?,
       net_paid_by=?, net_paid_at=?, net_payment_notes=?, net_payment_amount=?, net_total_paid=? WHERE id=?`,
    [newStatus, zohoPo, supplierRef, d.payment_ref||'', d.payment_date||now.slice(0,10),
     d.payment_method||'', req.session.user.id, now, d.notes||'', thisPayment, newTotalPaid, so.id]
  );

  const histMsg = isFullyPaid
    ? `Supplier net payment FULLY settled (${newTotalPaid.toFixed(2)}) | Ref: ${d.payment_ref||'—'} | PO: ${zohoPo}`
    : `Partial payment ${thisPayment.toFixed(2)} recorded — ${remaining.toFixed(2)} still remaining | Ref: ${d.payment_ref||'—'} | PO: ${zohoPo}`;
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), so.order_id, histMsg, req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true, total_paid: newTotalPaid, remaining, status: newStatus });
}));

console.log('[STARTUP] Finance routes registered');
// ── GRN ROUTES ───────────────────────────────────────────────────────────────
// POST /api/orders/:id/grn — record goods receipt
app.post('/api/orders/:id/grn', auth, asyncRoute(async (req, res) => {
  const { records = [], credit_note_no: cnNoInput } = req.body;
  const order = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const now = nowStr();

  let grnNo;
  let grnSeq = 1;
  try {
    const existing = await allAsync('SELECT DISTINCT id FROM grn_records WHERE order_id=?', [req.params.id]);
    grnSeq = existing.length + 1;
    grnNo = 'GRN-' + req.params.id + '-' + String(grnSeq).padStart(2,'0');
  } catch(_) { grnSeq = 1; grnNo = 'GRN-' + req.params.id + '-01'; }

  let allFull = true;
  let anyReceived = false;
  let anyShort = false;
  for (const r of records) {
    const li = await getAsync('SELECT * FROM order_items WHERE id=?', [r.order_item_id]);
    if (!li) continue;
    const qty = parseInt(r.qty_received) || 0;
    if (qty > 0) anyReceived = true;
    const totalRecSoFar = await getAsync('SELECT COALESCE(SUM(qty_received),0) as t FROM grn_records WHERE order_item_id=?', [r.order_item_id]);
    const prevRcvd = parseInt(totalRecSoFar?.t || 0);
    if (prevRcvd + qty < li.qty) anyShort = true;
    try {
      await runAsync(`INSERT INTO grn_records(id,order_id,order_item_id,supplier_id,coo,date_code,lot_number,weight_kg,qty_received,condition,arrived_date,notes,recorded_by,recorded_at,credit_note_no)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), req.params.id, r.order_item_id, r.supplier_id||'', r.coo||'',
         r.date_code||'', r.lot_number||'', r.weight_kg||null, qty,
         r.condition||'good', r.arrived_date||now.slice(0,10), r.notes||'',
         req.session.user.id, now, cnNoInput||'']);
    } catch(_) {}
    if (qty > 0) {
      const totalRecRow = await getAsync('SELECT COALESCE(SUM(qty_received),0) as t FROM grn_records WHERE order_item_id=?', [r.order_item_id]);
      const totalRec = parseInt(totalRecRow?.t || 0);
      if (totalRec < li.qty) allFull = false;
      const lineStatus = totalRec >= li.qty ? 'ready_to_ship' : 'grn_partial';
      await runAsync('UPDATE order_items SET line_status=? WHERE id=?', [lineStatus, r.order_item_id]);
    } else {
      allFull = false;
    }
  }

  const newOrderStatus = allFull && anyReceived ? 'delivery_hub' : anyReceived ? 'partial_hub' : order.status;
  await runAsync("UPDATE orders SET status=? WHERE id=?", [newOrderStatus, req.params.id]);

  const affectedItemIds = records.map(r => r.order_item_id).filter(Boolean);
  let affectedSOIds = [];
  if (affectedItemIds.length) {
    const soRows = await allAsync(`SELECT DISTINCT supplier_order_id FROM supplier_order_items WHERE item_id IN (${affectedItemIds.map(()=>'?').join(',')})`, affectedItemIds);
    affectedSOIds = soRows.map(r => r.supplier_order_id);
  }
  for (const soId of affectedSOIds) {
    const soRow = await getAsync('SELECT * FROM supplier_orders WHERE id=?', [soId]);
    if (!soRow || soRow.status === 'cancelled') continue;
    const poItemRows = await allAsync('SELECT item_id FROM supplier_order_items WHERE supplier_order_id=?', [soId]);
    const poItemIds = poItemRows.map(r => r.item_id);
    let poAllFull = true, poAnyReceived = false;
    for (const itemId of poItemIds) {
      const li = await getAsync('SELECT qty FROM order_items WHERE id=?', [itemId]);
      if (!li) continue;
      const totalRecRow = await getAsync('SELECT COALESCE(SUM(qty_received),0) as t FROM grn_records WHERE order_item_id=?', [itemId]);
      const totalRec = parseInt(totalRecRow?.t || 0);
      if (totalRec > 0) poAnyReceived = true;
      if (totalRec < li.qty) poAllFull = false;
    }
    const newPoStatus = poAllFull && poAnyReceived ? 'received' : poAnyReceived ? 'partially_received' : soRow.status;
    if (newPoStatus !== soRow.status) {
      await runAsync('UPDATE supplier_orders SET status=? WHERE id=?', [newPoStatus, soId]);
    }
  }

  // ── Auto-deduct stock inventory when sourcing used internal stock ─────────
  // For each GRN record, check if the order item was sourced from stock (__inv__)
  // by looking up the enquiry_sourcing row. If yes, decrement quantity_available.
  try {
    const enquiryRow = await getAsync('SELECT enquiry_id FROM orders WHERE id=?', [req.params.id]);
    if (enquiryRow?.enquiry_id) {
      for (const r of records) {
        const qty = parseInt(r.qty_received) || 0;
        if (!qty) continue;
        // Find sourcing row for this order item's component
        const li = await getAsync('SELECT * FROM order_items WHERE id=?', [r.order_item_id]);
        if (!li) continue;
        // Match enquiry_sourcing by enquiry + component name
        const srcRow = await getAsync(
          `SELECT es.supplier_id FROM enquiry_sourcing es
           JOIN enquiry_items ei ON ei.id = es.enquiry_item_id
           WHERE es.enquiry_id=? AND LOWER(ei.component)=LOWER(?) AND es.supplier_id LIKE '__inv__%'
           LIMIT 1`,
          [enquiryRow.enquiry_id, li.component || '']
        );
        if (srcRow?.supplier_id?.startsWith('__inv__')) {
          const invId = srcRow.supplier_id.slice(7);
          const inv = await getAsync('SELECT quantity_available, quantity_total FROM stock_inventory WHERE id=?', [invId]);
          if (inv) {
            const newAvail = Math.max(0, (parseInt(inv.quantity_available) || 0) - qty);
            const newTotal = Math.max(0, (parseInt(inv.quantity_total) || 0) - qty);
            await runAsync('UPDATE stock_inventory SET quantity_available=?, quantity_total=? WHERE id=?', [newAvail, newTotal, invId]);
          }
        }
      }
    }
  } catch(stockErr) {
    console.error('[GRN] Stock deduction error:', stockErr.message);
  }

  const cnNo = cnNoInput || (anyShort ? 'CN-' + req.params.id + '-' + String(grnSeq).padStart(2,'0') : '');
  const histNote = (allFull?'Full':'Partial')+' GRN recorded — '+grnNo+(cnNo?' | CN: '+cnNo:'');
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), req.params.id, histNote, req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true, grn_no: grnNo, credit_note_no: cnNo, order_status: newOrderStatus });
}));

// POST /api/orders/:id/shipments — create outbound shipment from Delivery Hub
app.post('/api/orders/:id/shipments', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const order = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!d.shipper_id) return res.status(400).json({ error: 'Carrier is required' });
  if (!d.tracking_no) return res.status(400).json({ error: 'AWB / Tracking number is required' });
  if (!Array.isArray(d.items) || d.items.length === 0) return res.status(400).json({ error: 'Shipment items are required' });

  const allItems = await allAsync('SELECT * FROM order_items WHERE order_id=?', [req.params.id]);
  const selectedIds = d.items.map(i => i.order_item_id).filter(Boolean);
  const selectedItems = allItems.filter(li => selectedIds.includes(li.id));
  if (selectedItems.length === 0) return res.status(400).json({ error: 'No valid shipment items found' });

  const shipmentId = uuid();
  const lastShip = await getAsync('SELECT COALESCE(MAX(shipment_no), 0) AS n FROM shipments WHERE order_id=?', [req.params.id]);
  const shipmentNo = Number(lastShip?.n || 0) + 1;
  const now = nowStr();

  await runAsync(`INSERT INTO shipments(
        id, order_id, shipment_no, type, status, shipper_id, tracking_no,
        invoice_ref, invoice_file, eway_bill, delivery_slip, packing_list,
        notes, created_by, created_at, dispatched_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        shipmentId, req.params.id, shipmentNo, d.type || 'full', 'dispatched',
        d.shipper_id, d.tracking_no, d.invoice_ref || '', d.invoice_file || '',
        d.eway_bill || '', d.delivery_slip || '', d.packing_list || '',
        d.notes || '', req.session.user.id, now, now,
      ]);

  for (const item of d.items) {
    if (!item?.order_item_id) continue;
    await runAsync('INSERT INTO shipment_items(id, shipment_id, order_item_id, qty_shipped) VALUES(?,?,?,?)', [
      uuid(), shipmentId, item.order_item_id, parseInt(item.qty_shipped) || 0,
    ]);
    const liData = allItems.find(a => a.id === item.order_item_id);
    const orderedQty = liData?.qty || 0;
    const tsRow = await getAsync('SELECT COALESCE(SUM(qty_shipped),0) as t FROM shipment_items WHERE order_item_id=?', [item.order_item_id]);
    const totalShipped = parseInt(tsRow?.t || 0);
    const newLineStatus = orderedQty > 0 && totalShipped >= orderedQty ? 'shipped' : 'partial_shipped';
    await runAsync('UPDATE order_items SET line_status=? WHERE id=?', [newLineStatus, item.order_item_id]);
  }

  await runAsync('INSERT INTO customer_shipping(order_id,status,shipper_id,tracking_no,delivery_date,comments) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=EXCLUDED.status,shipper_id=EXCLUDED.shipper_id,tracking_no=EXCLUDED.tracking_no,delivery_date=EXCLUDED.delivery_date,comments=EXCLUDED.comments', [
    req.params.id, 'shipped', d.shipper_id, d.tracking_no, '', d.notes || '',
  ]);

  const refreshedItems = await allAsync('SELECT * FROM order_items WHERE order_id=?', [req.params.id]);
  const allShipped = refreshedItems.length > 0 && refreshedItems.every(li => ['shipped', 'delivered'].includes(li.line_status));
  const nextOrderStatus = allShipped ? 'transit_customer' : 'partial_dispatched';
  await runAsync('UPDATE orders SET status=? WHERE id=?', [nextOrderStatus, req.params.id]);

  try {
    await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)', [
      uuid(), req.params.id,
      `Shipment ${shipmentNo} dispatched via ${d.shipper_id} | AWB: ${d.tracking_no}`,
      req.session.user.name, d.notes || '', now,
    ]);
  } catch (_) {}

  saveNow();
  res.json({ ok: true, id: shipmentId, shipment_no: shipmentNo, order_status: nextOrderStatus });
}));

// PUT /api/shipments/:id — update shipment delivery status
app.put('/api/shipments/:id', auth, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const shipment = await getAsync('SELECT * FROM shipments WHERE id=?', [req.params.id]);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  const now = nowStr();
  const nextStatus = d.status || shipment.status || 'dispatched';
  const deliveredAt = d.delivered_at || shipment.delivered_at || '';

  await runAsync('UPDATE shipments SET status=?, pod_ref=?, notes=?, delivered_at=? WHERE id=?', [
    nextStatus, d.pod_ref || shipment.pod_ref || '',
    d.notes || shipment.notes || '', deliveredAt, req.params.id,
  ]);

  if (nextStatus === 'delivered') {
    const shipItems = await allAsync('SELECT order_item_id FROM shipment_items WHERE shipment_id=?', [req.params.id]);
    for (const row of shipItems) {
      await runAsync("UPDATE order_items SET line_status='delivered' WHERE id=?", [row.order_item_id]);
    }

    const orderId = shipment.order_id;
    const allShipments = await allAsync('SELECT status FROM shipments WHERE order_id=?', [orderId]);
    const allDelivered = allShipments.length > 0 && allShipments.every(s => s.status === 'delivered');
    await runAsync('INSERT INTO customer_shipping(order_id,status,shipper_id,tracking_no,delivery_date,comments) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=EXCLUDED.status,shipper_id=EXCLUDED.shipper_id,tracking_no=EXCLUDED.tracking_no,delivery_date=EXCLUDED.delivery_date,comments=EXCLUDED.comments', [
      orderId, allDelivered ? 'delivered' : 'partial_delivered',
      shipment.shipper_id || '', shipment.tracking_no || '',
      deliveredAt || now.slice(0,10), d.notes || '',
    ]);
    await runAsync('UPDATE orders SET status=? WHERE id=?', [allDelivered ? 'closed' : 'partial_dispatched', orderId]);

    try {
      await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)', [
        uuid(), orderId,
        `Shipment ${shipment.shipment_no} delivered${d.pod_ref ? ' | POD: ' + d.pod_ref : ''}`,
        req.session.user.name, d.notes || '', now,
      ]);
    } catch (_) {}
  }

  saveNow();
  res.json({ ok: true });
}));

// POST /api/orders/:id/escalate — mark order as overdue / escalated
app.post('/api/orders/:id/escalate', auth, asyncRoute(async (req, res) => {
  const { level = 1, new_date = '' } = req.body;
  const order = await getAsync('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const now = nowStr();
  await runAsync('UPDATE orders SET escalation_level=?, escalated_at=? WHERE id=?', [level, now, req.params.id]);
  if (new_date) await runAsync('UPDATE orders SET tentative_date=? WHERE id=?', [new_date, req.params.id]);
  try { await runAsync('INSERT INTO order_history VALUES(?,?,?,?,?,?)',
    [uuid(), req.params.id,
     'Escalation L'+level+' — '+(new_date?'Delivery rescheduled to '+new_date:'Overdue flagged'),
     req.session.user.name, '', now]); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// DELETE /api/finance/history — clear all paid history (manager only)
app.delete('/api/finance/history', auth, asyncRoute(async (req, res) => {
  if (!['admin','manager'].includes(req.session.user.role))
    return res.status(403).json({ error: 'Manager access required' });
  try { await runAsync("DELETE FROM customer_payments"); } catch(_) {}
  try { await runAsync("DELETE FROM finance_queue WHERE status='paid'"); } catch(_) {}
  saveNow();
  res.json({ ok: true });
}));

// GET /api/finance/history
app.get('/api/finance/history', auth, asyncRoute(async (req, res) => {
  let custPmts = [];
  try {
    custPmts = await allAsync(`SELECT cp.*, COALESCE(cp.customer_po_no, o.po_number) AS po_number,
                           COALESCE(cp.finance_po_no, o.finance_po_no) AS finance_po_no,
                           o.customer_id, c.name AS customer_name
                    FROM customer_payments cp
                    LEFT JOIN orders o ON o.id=cp.order_id
                    LEFT JOIN customers c ON c.id=o.customer_id
                    ORDER BY cp.recorded_at DESC`);
  } catch(_) {}

  let supPmts  = [];
  try {
    supPmts  = await allAsync(`SELECT fq.*, so.internal_po_no, so.po_no, so.supplier_ref,
                           so.confirmed_currency, so.confirmed_price,
                           so.order_id AS linked_order_id, s.name AS supplier_name,
                           'advance' AS payment_kind
                    FROM finance_queue fq
                    LEFT JOIN supplier_orders so ON so.id=fq.supplier_order_id
                    LEFT JOIN suppliers s ON s.id=so.supplier_id
                    WHERE fq.status='paid'
                    ORDER BY fq.paid_at DESC`);
  } catch(_) {}

  let netPmts = [];
  try {
    netPmts = await allAsync(`SELECT
                          l.id, l.paid_at, l.paid_by, l.amount, l.currency,
                          l.payment_ref, l.payment_date, l.payment_method, l.notes,
                          l.zoho_po_number, l.supplier_ref,
                          l.total_paid_snapshot, l.remaining_snapshot, l.grand_total,
                          so.internal_po_no, so.po_no, so.order_id AS linked_order_id,
                          so.supplier_id, so.confirmed_currency,
                          s.name AS supplier_name,
                          'net' AS payment_kind
                   FROM supplier_net_payment_logs l
                   LEFT JOIN supplier_orders so ON so.id=l.supplier_order_id
                   LEFT JOIN suppliers s ON s.id=so.supplier_id
                   ORDER BY l.paid_at DESC`);
  } catch(_) {}

  const allSupPmts = [...supPmts, ...netPmts].sort((a,b)=>{
    const da = a.paid_at||''; const db = b.paid_at||'';
    return db.localeCompare(da);
  });

  res.json({ customer: custPmts, supplier: allSupPmts });
}));

  console.log('[STARTUP] All routes registered.');

// ── CATCH-ALL inside .then — registers AFTER all API routes ─────────────────
  app.get('*', (req, res) => {
    const idx = path.join(__dirname, '..', 'client', 'build', 'index.html');
    if (fs.existsSync(idx)) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.sendFile(idx);
    } else {
      res.json({ message: 'Ciflux OMS v2 API running. Build client first.' });
    }
  });

}).catch(err => { 
  console.error('Database connection or initialization failed:', err); 
});
