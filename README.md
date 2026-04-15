# ⚡ Ciflux OMS — Order Management System
### Electronic Component Trading · React + Node.js + PostgreSQL

---

## What Is This?

A full-stack, multi-user Order Management System built for electronic component trading companies.
Runs entirely on your **local LAN** — no internet required after setup.

**Tech Stack:**
| Layer    | Technology                             |
|----------|----------------------------------------|
| Frontend | React 18, React Router, TanStack Query |
| Backend  | Node.js + Express                      |
| Database | PostgreSQL                             |
| Auth     | Express Sessions + JWT + bcrypt        |

---

## Features

| Module | What it does |
|--------|-------------|
| **Dashboard** | Live stats, pipeline chart, delayed order alerts |
| **Orders** | Full order lifecycle from sourcing → delivered |
| **New Order** | Auto ID generation, multi-line items, multi-supplier |
| **Order Detail** | 7-stage flow tracker, all sections editable |
| **Customers** | Onboarding with GSTIN, location, contact |
| **Suppliers** | Domestic 🇮🇳 & International 🌐, payment terms, currency |
| **Line Cards** | Manufacturer brands, grouped by category |
| **Line Card Assignment** | Assign multiple brands per supplier |
| **User Management** | Roles: Admin, Manager, Sales, Ops, Viewer |
| **Reports** | Pending, Delayed, Delivered, Failed tabs |
| **Documents** | Delivery slip, packing list, invoice tracking |
| **Shipping Tracking** | Supplier → Ciflux → Customer with status & dates |

---

## Developer Setup (After Cloning)

### Prerequisites

| Tool | Mac | Windows |
|------|-----|---------|
| Node.js v18+ | https://nodejs.org | https://nodejs.org (tick "Add to PATH") |
| PostgreSQL v14+ | `brew install postgresql@14` | https://postgresql.org |

---

### Mac

```bash
# 1. Start PostgreSQL
brew services start postgresql@14

# 2. Create DB (run once)
psql postgres -c "CREATE USER ciflux WITH PASSWORD 'ciflux_pass';"
psql postgres -c "CREATE DATABASE ciflux_oms OWNER ciflux;"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE ciflux_oms TO ciflux;"

# 3. Create .env file in project root
echo "PORT=8080
PG_HOST=localhost
PG_PORT=5432
PG_DB=ciflux_oms
PG_USER=ciflux
PG_PASSWORD=ciflux_pass" > .env

# 4. Install dependencies
npm install && cd client && npm install && cd ..

# 5. Build frontend
cd client && npm run build && cd ..

# 6. Start
npm run dev
```

Open → **http://localhost:8080**

---

### Windows

Open **Command Prompt** (or PowerShell) and run:

```bat
REM 1. Create DB (run once, PostgreSQL must be running)
psql -U postgres -c "CREATE USER ciflux WITH PASSWORD 'ciflux_pass';"
psql -U postgres -c "CREATE DATABASE ciflux_oms OWNER ciflux;"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ciflux_oms TO ciflux;"
```

Create a file `.env` in the project root:
```
PORT=8080
PG_HOST=localhost
PG_PORT=5432
PG_DB=ciflux_oms
PG_USER=ciflux
PG_PASSWORD=ciflux_pass
```

Then:
```bat
npm install
cd client && npm install && cd ..
cd client && npm run build && cd ..
npm run dev
```

Open → **http://localhost:8080**

---

## Commands

```bash
npm run dev        # ▶  Start backend + frontend together
npm run stop       # ■  Stop everything
npm run backend    # ▶  Backend only  → http://localhost:8080
npm run ui         # ▶  Frontend only → http://localhost:3000  (hot reload)
```

---

## Default Login Accounts

> Created automatically on first run. **Change passwords after first login.**

| Username | Password | Role | Department |
|----------|----------|------|------------|
| `admin` | `admin123` | Admin | Management |
| `manager` | `pass123` | Manager | Management |
| `sales1` | `pass123` | User | Sales |
| `sourcing1` | `pass123` | User | Sourcing |
| `procure1` | `pass123` | User | Procurement |
| `accounts1` | `pass123` | User | Accounts |
| `approver1` | `pass123` | User | Approvers |

---

## Reset Database (Clean Slate)

```bash
npm run stop

psql postgres -c "DROP DATABASE IF EXISTS ciflux_oms;"
psql postgres -c "DROP USER IF EXISTS ciflux;"
psql postgres -c "CREATE USER ciflux WITH PASSWORD 'ciflux_pass';"
psql postgres -c "CREATE DATABASE ciflux_oms OWNER ciflux;"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE ciflux_oms TO ciflux;"

npm run dev   # schema + demo data seeded automatically
```

---

## LAN Access (Multi-User)

Once the server is running, all PCs on the same network can use it.

**Find your IP:**
- Mac/Linux: `ipconfig getifaddr en0`
- Windows: `ipconfig` → look for IPv4 Address

Tell teammates to open: `http://YOUR-IP:8080`

---

## Project Structure

```
ciflux-oms/
├── server/
│   ├── index.js        ← Express API (all routes)
│   └── db.js           ← PostgreSQL schema, seed data, helpers
│
├── client/
│   └── src/
│       ├── pages/      ← All page components
│       ├── components/ ← Layout, ErrorBoundary
│       ├── context/    ← AuthContext
│       └── utils/
│           ├── api.js      ← Axios client
│           └── helpers.js  ← Formatters, constants
│
├── .env                ← Create this manually (not in git)
├── package.json        ← Server deps + npm scripts
└── client/package.json ← Frontend deps
```

---

## API Reference

All endpoints require login (session cookie).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET  | `/api/auth/me` | Current user |
| GET  | `/api/orders` | List orders (role-filtered) |
| GET  | `/api/orders/:id` | Order detail |
| POST | `/api/orders` | Create order |
| PUT  | `/api/orders/:id` | Update order / status / items / shipping / docs |
| GET  | `/api/customers` | List customers |
| POST | `/api/customers` | Add customer |
| PUT  | `/api/customers/:id` | Update customer |
| GET  | `/api/suppliers` | List suppliers (with line cards) |
| POST | `/api/suppliers` | Add supplier |
| PUT  | `/api/suppliers/:id` | Update supplier + line cards |
| GET  | `/api/linecards` | List line cards |
| POST | `/api/linecards` | Add line card |
| PUT  | `/api/linecards/:id` | Update line card |
| GET  | `/api/users` | List users (admin only) |
| POST | `/api/users` | Add user (admin only) |
| PUT  | `/api/users/:id` | Update user (admin only) |
| GET  | `/api/reports/summary` | Dashboard counts |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `pg_isready` fails | `brew services start postgresql@14` (Mac) |
| `ECONNREFUSED` on start | PostgreSQL not running — start it first |
| `invalid credentials` on login | DB not seeded — see Reset section above |
| Port 8080 in use | `npm run stop` then retry |
| `deasync` error | `npm rebuild deasync` from project root |
| White screen | `cd client && npm run build && cd ..` |
| `Cannot find module` | `npm install` in root and `cd client && npm install` |
| Port changed | Edit `.env` → `PORT=9090` |

---

## Customisation

| What | Where |
|------|-------|
| Add/edit a page | `client/src/pages/` |
| Add API routes | `server/index.js` |
| Change DB schema | `server/db.js` → `createSchema()` |
| Reskin UI | `client/src/index.css` |
| Change port | `.env` → `PORT=9090` |

---

*Built with React · Node.js · PostgreSQL*
