#!/bin/bash
set -e

echo ""
echo "============================================"
echo "  Ciflux OMS  -  Electronic Components OMS"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " [ERROR] Node.js not found!"
    echo " Install from: https://nodejs.org (LTS version)"
    exit 1
fi

echo " [OK] Node $(node --version) found"

# Install deps if needed
if [ ! -d "node_modules" ]; then
    echo " [SETUP] Installing server dependencies..."
    npm install
fi

if [ ! -d "client/node_modules" ]; then
    echo " [SETUP] Installing client dependencies..."
    cd client && npm install && cd ..
fi

# Build React if needed
if [ ! -d "client/build" ]; then
    echo " [SETUP] Building React app (first time, ~2 min)..."
    cd client && npm run build && cd ..
    echo " [OK] Build complete"
fi

echo ""
echo "============================================"
echo "  Starting server on port 8080..."
echo "  Open: http://localhost:8080"
echo "  LAN:  http://$(hostname -I | awk '{print $1}'):8080"
echo "  Login: admin / admin123"
echo "  Ctrl+C to stop"
echo "============================================"
echo ""

node server/index.js
