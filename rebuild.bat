@echo off
echo ================================================
echo   CIFLUX OMS - Rebuild and Restart
echo ================================================
echo.

cd /d C:\ciflux-oms

echo [1/3] Stopping any running server...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Building client...
cd client
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Build failed! Check errors above.
    pause
    exit /b 1
)
cd ..

echo.
echo [3/3] Starting server...
echo.
echo ================================================
echo   BUILD COMPLETE - Server starting on :8080
echo ================================================
echo.
start "Ciflux OMS Server" cmd /k "node server/index.js"

timeout /t 3 /nobreak >nul
start http://localhost:8080/quotes

echo Done! Browser opening to Quotes page...
pause
