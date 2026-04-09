@echo off
title Ciflux OMS Server
color 0A

echo.
echo  ============================================
echo   Ciflux OMS  -  Electronic Components OMS
echo  ============================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Download from: https://nodejs.org  (LTS version)
    pause
    exit /b 1
)
echo  [OK] Node.js found:
node --version

if not exist "node_modules" (
    echo.
    echo  [SETUP] Installing server dependencies...
    call npm install
)

if not exist "client\node_modules" (
    echo.
    echo  [SETUP] Installing client dependencies...
    cd client
    call npm install
    cd ..
)

if not exist "client\build" (
    echo.
    echo  [SETUP] Building React app (first time only, ~1 min)...
    cd client
    call npm run build
    cd ..
    echo  [OK] Build complete
)

echo.
echo  ============================================
echo   Starting Ciflux OMS...
echo  ============================================
echo.
echo  Open your browser:   http://localhost:8080
echo  Other LAN users:     http://YOUR-IP:8080
echo  (run ipconfig to find your IP)
echo.
echo  Login: admin / admin123
echo  Press Ctrl+C to stop
echo  ============================================
echo.

node server/index.js
pause
