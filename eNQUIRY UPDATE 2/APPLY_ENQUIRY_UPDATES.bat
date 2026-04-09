@echo off
title Ciflux OMS - Enquiry Updates
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Enquiry Form Updates
echo  ============================================
echo.

set INSTALL=
if exist "C:\ciflux-oms\server\index.js"                                         set INSTALL=C:\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Desktop\ciflux-oms\server\index.js"   set INSTALL=%USERPROFILE%\Desktop\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Downloads\ciflux-oms\server\index.js" set INSTALL=%USERPROFILE%\Downloads\ciflux-oms
if "%INSTALL%"=="" ( set /p INSTALL=  Enter full path to ciflux-oms folder: )
if not exist "%INSTALL%\server\index.js" ( echo  [ERROR] Invalid folder & pause & exit /b 1 )
echo  [OK] Found at: %INSTALL%
echo.

set DIR=%~dp0
for %%F in (NewEnquiryPage.js EnquiriesPage.js index.js) do (
    if not exist "%DIR%%%F" ( echo  [ERROR] %%F not found next to bat file & pause & exit /b 1 )
)

echo  [COPYING] Installing 3 updated files...
copy /Y "%DIR%NewEnquiryPage.js"  "%INSTALL%\client\src\pages\NewEnquiryPage.js"  >nul
copy /Y "%DIR%EnquiriesPage.js"   "%INSTALL%\client\src\pages\EnquiriesPage.js"   >nul
copy /Y "%DIR%index.js"           "%INSTALL%\server\index.js"                     >nul
echo  [OK] Done.
echo.

echo  [BUILDING] Rebuilding frontend (~30 sec)...
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 ( echo  [ERROR] Build failed & pause & exit /b 1 )

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   ALL DONE!
echo  ============================================
echo.
echo   What changed:
echo.
echo   NEW ENQUIRY FORM:
echo    - All world currencies in target price
echo      (160+ currencies: AED, AFN, AUD, BRL,
echo       CAD, CHF, CNY, EUR, GBP, HKD, INR,
echo       JPY, KWD, SAR, SGD, USD, ZAR...)
echo    - Two action buttons at the bottom:
echo      [Save as Draft]  - saves with status=new
echo                         stays in Enquiries list
echo                         does NOT go to Sourcing Bin
echo      [Send to Sourcing Bin]  - sets status=sourcing
echo                         immediately appears in
echo                         the Sourcing Bin
echo    - Edit mode: clicking Edit on any enquiry
echo      opens the form pre-filled with all data
echo      to edit and re-submit to Sourcing
echo.
echo   ENQUIRY LIST (All Enquiries page):
echo    - Sourcing Updates column REMOVED
echo    - Shows: ID, Customer, Components preview,
echo      Priority, Status, Assigned To, Notes, Date
echo    - Two buttons per row: [View] [Edit]
echo    - Filter chips show counts per status
echo    - "New" status relabelled as "Draft"
echo.
echo   ENQUIRY DETAIL MODAL:
echo    - Shows components read-only
echo    - Status + Assignment management
echo    - [Re-send to Sourcing Bin] button
echo    - [Edit and Re-submit] button
echo    - No more Sourcing Updates section here
echo      (that stays in the Sourcing Bin)
echo.
echo   1. Restart server (Ctrl+C + START_SERVER.bat)
echo   2. Ctrl+Shift+R in browser
echo  ============================================
echo.
pause
