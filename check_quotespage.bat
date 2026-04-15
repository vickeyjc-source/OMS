@echo off
echo === Checking QuotesPage.js ===
echo.
echo --- Line count ---
find /c /v "" C:\ciflux-oms\client\src\pages\QuotesPage.js
echo.
echo --- Is it the correct file (fetches /quotes not /orders)? ---
findstr /c:"api.get('/quotes')" C:\ciflux-oms\client\src\pages\QuotesPage.js && echo "GOOD: fetches /quotes" || echo "BAD: wrong file — still fetching orders"
findstr /c:"export default function OrdersPage" C:\ciflux-oms\client\src\pages\QuotesPage.js && echo "BAD: still OrdersPage copy" || echo "GOOD: not OrdersPage copy"
findstr /c:"export default function QuotesPage" C:\ciflux-oms\client\src\pages\QuotesPage.js && echo "GOOD: correct QuotesPage" || echo "BAD: QuotesPage function missing"
echo.
echo --- Date modified ---
dir C:\ciflux-oms\client\src\pages\QuotesPage.js
echo.
echo --- Was client rebuilt after QuotesPage was replaced? ---
dir C:\ciflux-oms\client\build\assets\*.js
echo.
pause
