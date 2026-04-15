# ⚡ Ciflux OMS — Order Management System
### Electronic Component Trading · React + Node.js + SQLite

---

## What Is This?

A full-stack, multi-user Order Management System built for electronic component trading companies.
Runs entirely on your **local LAN** — no internet required after setup.

**Tech Stack:**
| Layer    | Technology                        |
|----------|-----------------------------------|
| Frontend | React 18, React Router, TanStack Query |
| Backend  | Node.js + Express                 |
| Database | SQLite (via `better-sqlite3`)     |
| Auth     | Express Sessions + bcrypt         |

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

## Prerequisites

You need **Node.js** installed on the server PC. Nothing else.

1. Go to **https://nodejs.org**
2. Download the **LTS** version (e.g. v20.x)
3. Install it — tick **"Add to PATH"** during installation
4. Verify: open Command Prompt → type `node --version`

---

## Installation & First Run

### Windows

```
1. Copy the entire "ciflux-oms" folder to your PC
   e.g. C:\CifluxOMS\

2. Double-click:  START_SERVER.bat

   First run will:
   - Install Node.js packages (~1 min)
   - Build the React app (~2 min)
   - Start the server

3. Open browser → http://localhost:8080
```

### Linux / Mac

```bash
cd ciflux-oms
chmod +x start.sh
./start.sh
```

### Manual (any OS)

```bash
# Step 1 — Install all packages
npm install
cd client && npm install && cd ..

# Step 2 — Build React frontend
cd client && npm run build && cd ..

# Step 3 — Start the server
node server/index.js
```

---

## LAN Access (Multi-User)

Once the server is running on one PC, **all other computers on the same network** can use it.

### Find your server PC's IP address

**Windows:**
```
Press Win+R → type cmd → press Enter
Type: ipconfig
Look for: IPv4 Address . . . . . : 192.168.x.x
```

**Linux/Mac:**
```bash
hostname -I
# or
ip addr show
```

### Share with your team

Tell everyone to open their browser and go to:
```
http://192.168.1.10:8080
```
(replace with your actual IP)

| Device | Works? |
|--------|--------|
| Windows PC | ✅ Chrome, Edge, Firefox |
| Mac | ✅ Chrome, Safari, Firefox |
| Android phone | ✅ Chrome |
| iPhone | ✅ Safari, Chrome |
| Linux | ✅ Any browser |

### Windows Firewall

The first time you run the server, Windows will ask:
> *"Do you want to allow Node.js through the firewall?"*

Click **"Allow Access"** — this lets other LAN users connect.

If you missed it:
```
Control Panel → Windows Defender Firewall
→ Allow an app through firewall
→ Add: node.exe (usually C:\Program Files\nodejs\node.exe)
→ Check both Private and Public
```

---

## Default Login Accounts

| Username | Password  | Role        | Access |
|----------|-----------|-------------|--------|
| admin    | admin123  | Admin       | Full access + user management |
| manager  | pass123   | Manager     | All orders, create/edit |
| sales    | pass123   | Sales       | Own orders only, create/edit |
| ops      | pass123   | Operations  | Own orders, update shipping |

> ⚠️ **Change passwords after first login** via User Management → Edit User

---

## Auto-Start on Boot (Windows)

To have the server start automatically when the PC turns on:

1. Press `Win + R` → type `shell:startup` → press Enter
2. Right-click in the folder → **New → Shortcut**
3. Location: `C:\CifluxOMS\START_SERVER.bat`
4. Name it: `Ciflux OMS`
5. Click Finish

Now it starts automatically every time Windows boots.

---

## Database

The database is a single file: `ciflux_oms.db` in the project root.

**It is created automatically on first run.**

| Action | How |
|--------|-----|
| **Backup** | Copy `ciflux_oms.db` to a USB / Google Drive |
| **Restore** | Replace `ciflux_oms.db` with your backup copy |
| **Reset/Fresh start** | Delete `ciflux_oms.db` — it will be recreated with demo data |
| **View raw data** | Use [DB Browser for SQLite](https://sqlitebrowser.org) (free) |

**Recommended: Back up `ciflux_oms.db` daily.**

---

## Project Structure

```
ciflux-oms/
│
├── server/
│   ├── index.js          ← Express API server (all routes)
│   └── db.js             ← SQLite schema, seed data, helpers
│
├── client/
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── pages/
│       │   ├── DashboardPage.js
│       │   ├── OrdersPage.js      ← Order list + full detail modal
│       │   ├── NewOrderPage.js    ← Create order wizard
│       │   ├── CustomersPage.js
│       │   ├── SuppliersPage.js   ← With line card assignment
│       │   ├── LineCardsPage.js
│       │   ├── UsersPage.js
│       │   ├── ReportsPage.js
│       │   └── LoginPage.js
│       ├── components/
│       │   └── Layout.js          ← Sidebar + navigation
│       ├── context/
│       │   └── AuthContext.js     ← Login state management
│       └── utils/
│           ├── api.js             ← Axios API client
│           └── helpers.js         ← Formatters, badges, constants
│
├── ciflux_oms.db          ← SQLite database (auto-created)
├── package.json           ← Server dependencies
├── START_SERVER.bat        ← Windows one-click launcher
└── start.sh               ← Linux/Mac launcher
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
| `node` not found | Install Node.js from nodejs.org, restart CMD |
| Port 8080 in use | Edit `server/index.js` line `const PORT = 8080` → change to 3000 or 9090 |
| LAN users can't connect | Check Windows Firewall — allow Node.js |
| White screen / blank page | Run `cd client && npm run build` again |
| "Cannot find module" | Run `npm install` in project root and in `client/` |
| DB errors | Delete `ciflux_oms.db` and restart — fresh DB will be created |
| Slow first load | Normal — React build loads once, then cached |

---

## Changing the Port

Edit `server/index.js`:
```js
const PORT = process.env.PORT || 8080;  // change 8080 to any free port
```

---

## Support & Customisation

The code is fully open and modifiable:
- Add new fields to any form → edit the relevant page in `client/src/pages/`
- Add new API routes → edit `server/index.js`
- Change the database schema → edit `server/db.js`
- Reskin the UI → edit `client/src/index.css`

---

*Built with React · Node.js · SQLite · Runs on any LAN*
"# updatedOMS" 
"# updatedOMS" 
