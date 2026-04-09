@echo off
title Ciflux OMS - Sourcing & Procurement Group
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Sourcing and Procurement
echo   Adds new sidebar group with:
echo    - Sourcing Bin  (enquiry work queue)
echo    - Procurement Bin  (order line items)
echo  ============================================
echo.

set INSTALL=
if exist "C:\ciflux-oms\server\index.js"                                          set INSTALL=C:\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Desktop\ciflux-oms\server\index.js"    set INSTALL=%USERPROFILE%\Desktop\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Downloads\ciflux-oms\server\index.js"  set INSTALL=%USERPROFILE%\Downloads\ciflux-oms
if "%INSTALL%"=="" (
    set /p INSTALL=  Enter full path to ciflux-oms folder: 
)
if not exist "%INSTALL%\server\index.js" (
    echo  [ERROR] Not a valid ciflux-oms folder: %INSTALL%
    pause & exit /b 1
)
echo  [OK] Found at: %INSTALL%
echo.

set DIR=%~dp0
set FILES=Layout.js App.js SourcingBinPage.js ProcurementBinPage.js
for %%F in (%FILES%) do (
    if not exist "%DIR%%%F" (
        echo  [ERROR] %%F not found in same folder as this bat file.
        pause & exit /b 1
    )
)

echo  [COPYING] Installing updated files...
copy /Y "%DIR%Layout.js"            "%INSTALL%\client\src\components\Layout.js"          >nul
copy /Y "%DIR%App.js"               "%INSTALL%\client\src\App.js"                        >nul
copy /Y "%DIR%SourcingBinPage.js"   "%INSTALL%\client\src\pages\SourcingBinPage.js"      >nul
copy /Y "%DIR%ProcurementBinPage.js" "%INSTALL%\client\src\pages\ProcurementBinPage.js"  >nul
echo  [OK] 4 files copied.
echo.

echo  [BUILDING] Rebuilding app (~30 seconds)...
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 ( echo  [ERROR] Build failed & pause & exit /b 1 )

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   DONE! Sourcing and Procurement groups added
echo  ============================================
echo.
echo   New sidebar section "Sourcing and Procurement":
echo.
echo   Sourcing Bin:
echo    - Card view of all enquiries in sourcing
echo    - Shows progress bar per enquiry
echo    - Click to open and update supplier prices
echo    - Price vs target comparison shown
echo    - Badge shows count of pending enquiries
echo.
echo   Procurement Bin:
echo    - All open orders with active line items
echo    - Update line item status per item
echo    - Manage supplier POs, tracking, shippers
echo    - Progress bar per order
echo    - Badge shows count
echo.
echo   1. Restart server  (Ctrl+C + START_SERVER.bat)
echo   2. Ctrl+Shift+R in browser
echo  ============================================
echo.
pause
