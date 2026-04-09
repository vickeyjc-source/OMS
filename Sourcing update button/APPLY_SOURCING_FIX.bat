@echo off
title Ciflux OMS - Sourcing Save Fix
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Sourcing Update Fix
echo   Fixes: Save Sourcing button not saving
echo   when logged in as sourcing department
echo  ============================================
echo.

set INSTALL=
if exist "C:\ciflux-oms\server\index.js"                                          set INSTALL=C:\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Desktop\ciflux-oms\server\index.js"    set INSTALL=%USERPROFILE%\Desktop\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Downloads\ciflux-oms\server\index.js"  set INSTALL=%USERPROFILE%\Downloads\ciflux-oms

if "%INSTALL%"=="" (
    echo  Could not auto-detect install folder.
    set /p INSTALL=  Type full path to ciflux-oms folder: 
)

if not exist "%INSTALL%\server\index.js" (
    echo  [ERROR] Not a valid ciflux-oms folder: %INSTALL%
    pause & exit /b 1
)
echo  [OK] Found at: %INSTALL%
echo.

set DIR=%~dp0

if not exist "%DIR%EnquiriesPage.js" (
    echo  [ERROR] EnquiriesPage.js not found next to this bat file.
    echo  Put EnquiriesPage.js, index.js and this bat in the same folder.
    pause & exit /b 1
)
if not exist "%DIR%index.js" (
    echo  [ERROR] index.js not found next to this bat file.
    pause & exit /b 1
)

echo  [COPYING] Patching EnquiriesPage.js (frontend fix)...
copy /Y "%DIR%EnquiriesPage.js" "%INSTALL%\client\src\pages\EnquiriesPage.js" >nul
if %errorlevel% neq 0 ( echo  [ERROR] Copy failed & pause & exit /b 1 )

echo  [COPYING] Patching server index.js (backend fix)...
copy /Y "%DIR%index.js" "%INSTALL%\server\index.js" >nul
if %errorlevel% neq 0 ( echo  [ERROR] Copy failed & pause & exit /b 1 )

echo  [OK] Files copied.
echo.
echo  [BUILDING] Rebuilding frontend (~30 sec)...
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 ( echo  [ERROR] Build failed & pause & exit /b 1 )

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   FIXED! Sourcing save now works correctly.
echo  ============================================
echo.
echo   What was wrong:
echo    1. State update function was creating
echo       duplicate rows instead of updating
echo    2. Server was not finding existing rows
echo       on first save (no ID yet)
echo    3. Supplier field was not being saved
echo.
echo   To apply:
echo    1. Restart server (Ctrl+C + START_SERVER.bat)
echo    2. Press Ctrl+Shift+R in browser
echo    3. Login as sourcing1 / pass123
echo    4. Open enquiry, edit sourcing, Save
echo  ============================================
echo.
pause
