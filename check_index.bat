@echo off
echo === Checking server\index.js ===
echo.
echo --- Line count ---
find /c /v "" C:\ciflux-oms\server\index.js
echo.
echo --- migrate() calls present? ---
findstr /c:"migrate(" C:\ciflux-oms\server\index.js && echo "BAD: migrate() still present" || echo "GOOD: no migrate() calls"
echo.
echo --- Any run() calls at top level of .then()? ---
findstr /n /c:"  migrate\b\|^  run(\|^  get(\|^  all(" C:\ciflux-oms\server\index.js | head
echo.
echo --- Date ---
dir C:\ciflux-oms\server\index.js | findstr "index.js"
pause
