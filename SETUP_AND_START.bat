@echo off
title Ciflux OMS – PostgreSQL Setup
color 0A
echo.
echo  =========================================
echo   CIFLUX OMS  –  PostgreSQL Setup + Start
echo  =========================================
echo.

:: ── Step 1: Find PostgreSQL service ──────────────────────────────────────────
echo [1/5] Checking PostgreSQL service...
set PG_SERVICE=
for /f "tokens=1" %%s in ('sc query type^= service state^= all ^| findstr /i "postgresql"') do (
    if not defined PG_SERVICE set PG_SERVICE=%%s
)

if not defined PG_SERVICE (
    echo.
    echo  ERROR: PostgreSQL service not found!
    echo  Please install PostgreSQL from:
    echo  https://www.postgresql.org/download/windows/
    echo.
    pause
    exit /b 1
)

echo  Found service: %PG_SERVICE%

:: ── Step 2: Start PostgreSQL if not running ───────────────────────────────────
echo [2/5] Starting PostgreSQL service...
net start %PG_SERVICE% >nul 2>&1
sc query %PG_SERVICE% | findstr "RUNNING" >nul
if errorlevel 1 (
    echo  ERROR: Could not start PostgreSQL service.
    echo  Try running this script as Administrator.
    pause
    exit /b 1
)
echo  PostgreSQL is running.

:: ── Step 3: Find psql.exe ─────────────────────────────────────────────────────
echo [3/5] Looking for psql.exe...
set PSQL=
for /d %%d in ("C:\Program Files\PostgreSQL\*") do (
    if exist "%%d\bin\psql.exe" set PSQL=%%d\bin\psql.exe
)
if not defined PSQL (
    echo  WARNING: psql.exe not found in C:\Program Files\PostgreSQL\
    echo  Skipping database creation – do it manually if needed.
    goto install_deps
)
echo  Found: %PSQL%

:: ── Step 4: Create DB and user (safe to run multiple times) ──────────────────
echo [4/5] Creating database and user (if not exists)...
echo  (You may be prompted for the postgres superuser password)
echo.

"%PSQL%" -U postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ciflux') THEN CREATE USER ciflux WITH PASSWORD 'ciflux_pass'; END IF; END $$;"
"%PSQL%" -U postgres -c "SELECT 'already exists' FROM pg_database WHERE datname='ciflux_oms'" | findstr "already exists" >nul
if errorlevel 1 (
    "%PSQL%" -U postgres -c "CREATE DATABASE ciflux_oms OWNER ciflux;"
    echo  Database ciflux_oms created.
) else (
    echo  Database ciflux_oms already exists – skipping.
)
"%PSQL%" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ciflux_oms TO ciflux;"

:: ── Step 5: Create .env if missing ───────────────────────────────────────────
if not exist ".env" (
    echo PG_HOST=localhost>  .env
    echo PG_PORT=5432>>      .env
    echo PG_DB=ciflux_oms>>  .env
    echo PG_USER=ciflux>>    .env
    echo PG_PASSWORD=ciflux_pass>> .env
    echo  Created .env file.
) else (
    echo  .env already exists – keeping it.
)

:install_deps
:: ── Step 6: npm install ───────────────────────────────────────────────────────
echo [5/5] Installing Node dependencies...
call npm install
if errorlevel 1 (
    echo  ERROR: npm install failed.
    pause
    exit /b 1
)

:: ── Start the server ──────────────────────────────────────────────────────────
echo.
echo  =========================================
echo   Starting Ciflux OMS server...
echo  =========================================
echo.
node server/index.js
pause
