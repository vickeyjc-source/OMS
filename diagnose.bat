@echo off
cd /d C:\ciflux-oms
echo === Search for initDb ===
findstr /n "initDb\|app.listen\|}).catch\|loopWhile\|deasync" C:\ciflux-oms\server\index.js
echo.
pause
