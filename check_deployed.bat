@echo off
echo === Checking what is actually in server\index.js ===
echo.
echo --- Line count ---
find /c /v "" C:\ciflux-oms\server\index.js
echo.
echo --- Looking for our fixes ---
findstr /c:"POST /api/quotes] Created" C:\ciflux-oms\server\index.js && echo "GOOD: Quote logging present" || echo "BAD: Quote logging MISSING — old file still deployed"
findstr /c:"migrate(" C:\ciflux-oms\server\index.js && echo "BAD: migrate() calls still present — will deadlock" || echo "GOOD: migrate() removed"
findstr /c:"STARTUP] DB ready" C:\ciflux-oms\server\index.js && echo "GOOD: startup log present" || echo "BAD: startup log missing"
echo.
echo === Date modified ===
dir C:\ciflux-oms\server\index.js
echo.
pause
