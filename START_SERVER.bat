@echo off
cd /d C:\ciflux-oms
echo.
echo Checking deasync...
node -e "require('deasync'); console.log('deasync OK')" 2>&1
echo.
echo Checking pg...
node -e "require('pg'); console.log('pg OK')" 2>&1
echo.
echo Checking dotenv...
node -e "require('dotenv'); console.log('dotenv OK')" 2>&1
echo.
echo All checks done. Starting server...
echo.
node server\index.js
pause
