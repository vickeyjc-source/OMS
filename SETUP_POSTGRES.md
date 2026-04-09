# Setting up PostgreSQL for Ciflux OMS

## 1. Install PostgreSQL

**Windows:**
Download from https://www.postgresql.org/download/windows/
Install with default options. Remember the password you set for the `postgres` superuser.

**Ubuntu / Debian (Linux LAN server):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

---

## 2. Create the database and user

Open a PostgreSQL shell:

**Windows:** Open "SQL Shell (psql)" from the Start Menu
**Linux:** `sudo -u postgres psql`

Run these commands:

```sql
CREATE USER ciflux WITH PASSWORD 'ciflux_pass';
CREATE DATABASE ciflux_oms OWNER ciflux;
GRANT ALL PRIVILEGES ON DATABASE ciflux_oms TO ciflux;
\q
```

> Change `ciflux_pass` to something stronger for production use.
> Update `.env` to match whatever password you set.

---

## 3. Configure the app

```bash
cd ciflux-oms
cp .env.example .env
# Edit .env with your actual PG_PASSWORD (and PG_HOST if PostgreSQL is on a different machine)
```

---

## 4. Install dependencies

```bash
npm install
```

This installs `pg` (PostgreSQL driver) and `deasync` (sync bridge).
`sql.js` is no longer needed and has been removed.

---

## 5. Run the server

```bash
npm start
```

On first start the app will:
- Connect to PostgreSQL
- Create all tables automatically
- Seed demo data if the database is empty

---

## 6. LAN access

The server binds to `0.0.0.0:8080` so it is accessible from any machine on your network.

**Server machine:** note its LAN IP (e.g. `192.168.1.50`)
**Other machines:** open browser to `http://192.168.1.50:8080`

The startup console output will print the LAN URL automatically.

---

## 7. Migrating existing SQLite data (optional)

If you have real data in `ciflux_oms.db` you want to migrate:

1. Install `pgloader`:
   ```bash
   sudo apt install pgloader    # Ubuntu
   ```

2. Run:
   ```bash
   pgloader sqlite:///path/to/ciflux_oms.db postgresql://ciflux:ciflux_pass@localhost/ciflux_oms
   ```

This copies all rows from SQLite to PostgreSQL automatically.

---

## Firewall (for LAN access on Linux)

If other machines cannot reach the server:
```bash
sudo ufw allow 8080/tcp
```

For PostgreSQL remote access (if PostgreSQL is on a separate machine):
```bash
sudo ufw allow 5432/tcp
# Also edit /etc/postgresql/*/main/pg_hba.conf to allow LAN subnet
# and set listen_addresses = '*' in postgresql.conf
```

---

## Default login credentials

| Username    | Password   | Role        |
|-------------|------------|-------------|
| admin       | admin123   | Admin       |
| sales1      | pass123    | Sales       |
| sourcing1   | pass123    | Sourcing    |
| procure1    | pass123    | Procurement |

**Change these immediately in production via the Users page.**
