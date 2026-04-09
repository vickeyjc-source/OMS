@echo off
title Ciflux OMS - Sourcing + Quotes Full Update
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Sourcing + Quote Bin Update
echo  ============================================
echo.

set INSTALL=
if exist "C:\ciflux-oms\server\index.js"                                          set INSTALL=C:\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Desktop\ciflux-oms\server\index.js"    set INSTALL=%USERPROFILE%\Desktop\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Downloads\ciflux-oms\server\index.js"  set INSTALL=%USERPROFILE%\Downloads\ciflux-oms
if "%INSTALL%"=="" ( set /p INSTALL=  Enter full path to ciflux-oms folder: )
if not exist "%INSTALL%\server\index.js" ( echo  [ERROR] Invalid folder & pause & exit /b 1 )
echo  [OK] Found at: %INSTALL%
echo.

set DIR=%~dp0
for %%F in (SourcingBinPage.js QuotesPage.js index.js db.js) do (
    if not exist "%DIR%%%F" ( echo  [ERROR] %%F not found next to bat & pause & exit /b 1 )
)

echo  [COPYING] Installing 4 updated files...
copy /Y "%DIR%SourcingBinPage.js"  "%INSTALL%\client\src\pages\SourcingBinPage.js"  >nul
copy /Y "%DIR%QuotesPage.js"       "%INSTALL%\client\src\pages\QuotesPage.js"       >nul
copy /Y "%DIR%index.js"            "%INSTALL%\server\index.js"                      >nul
copy /Y "%DIR%db.js"               "%INSTALL%\server\db.js"                         >nul
echo  [OK] All copied.
echo.

echo  [!] IMPORTANT: Delete old database so new columns are created
echo.
if exist "%INSTALL%\ciflux_oms.db" (
    echo  Found existing database. Backing up first...
    copy /Y "%INSTALL%\ciflux_oms.db" "%INSTALL%\ciflux_oms.db.bak" >nul
    del "%INSTALL%\ciflux_oms.db"
    echo  [OK] Old DB backed up to ciflux_oms.db.bak and deleted.
    echo       New DB will be created with fresh schema on restart.
) else (
    echo  [OK] No existing database found.
)
echo.

echo  [BUILDING] Rebuilding frontend (~30 sec)...
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 ( echo  [ERROR] Build failed & pause & exit /b 1 )

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   DONE!
echo  ============================================
echo.
echo   SOURCING BIN changes:
echo    - Full enquiry details in modal (all components,
echo      notes, customer, priority, date code, delivery)
echo    - No New Enquiry button
echo    - Each item has BOTH Sourcing Price AND Quote Price
echo    - All world currencies on both price fields
echo    - Additional Charges section (Customs/Handling/Freight)
echo      for the whole enquiry
echo    - Real-time margin calculation per item
echo    - Gross Margin = Quote Total - Source Total
echo    - Net Margin   = Quote - Source - Extra Charges
echo    - Source or Quote above target = red border + badge
echo    - THREE footer buttons:
echo        [Save]         - saves, stays in Sourcing Bin
echo        [Save as Draft]- saves, stays in Sourcing Bin
echo        [Send to Quote Bin] - sets status=quoted,
echo                              moves to Quote Bin
echo    - Sourcing card shows quick gross margin preview
echo.
echo   QUOTE BIN changes:
echo    - Shows ALL enquiries with status=quoted
echo    - Full line item table with Source + Quote prices
echo    - Source price highlighted in blue
echo    - Quote price highlighted in green
echo    - Red with warning badge if price above target
echo    - Gross Margin and Net Margin shown per enquiry
echo    - Additional charges shown
echo    - Click View Details for full modal with Zoho
echo      quote number, file reference, validity date
echo.
echo   IMPORTANT: Database was reset. Re-enter your data.
echo   Old data backed up in ciflux_oms.db.bak
echo.
echo   1. Start server (START_SERVER.bat)
echo   2. Ctrl+Shift+R in browser
echo  ============================================
echo.
pause
