@echo off
cd /d C:\ciflux-oms
echo Killing node...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo Copying index.js...
copy /Y C:\ciflux-oms\index.js C:\ciflux-oms\server\index.js
echo.
echo Verifying...
findstr /c:"migrate(" C:\ciflux-oms\server\index.js | findstr /v "//" && echo WARNING: migrate present || echo GOOD: no migrate
find /c /v "" C:\ciflux-oms\server\index.js
echo.
echo Starting...
node server\index.js
pause
