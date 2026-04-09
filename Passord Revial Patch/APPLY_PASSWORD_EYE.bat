@echo off
title Ciflux OMS - Password Eye Toggle
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Password Show/Hide Toggle
echo   Adds eye icon to all password fields:
echo    - Login page
echo    - User Management (add/edit user)
echo  ============================================
echo.

:: ── Auto-detect install path ──────────────────
set INSTALL=
if exist "C:\ciflux-oms\server\index.js"                                          set INSTALL=C:\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Desktop\ciflux-oms\server\index.js"    set INSTALL=%USERPROFILE%\Desktop\ciflux-oms
if "%INSTALL%"=="" if exist "%USERPROFILE%\Downloads\ciflux-oms\server\index.js"  set INSTALL=%USERPROFILE%\Downloads\ciflux-oms

if "%INSTALL%"=="" (
    echo  Could not auto-detect install folder.
    set /p INSTALL=  Type full path to ciflux-oms folder (e.g. C:\ciflux-oms): 
)

if not exist "%INSTALL%\server\index.js" (
    echo  [ERROR] Not a valid ciflux-oms folder: %INSTALL%
    pause
    exit /b 1
)

echo  [OK] Found installation at: %INSTALL%
echo.

:: ── Check the patch files are next to this bat ─
set DIR=%~dp0
set LOGIN_SRC=%DIR%LoginPage.js
set USERS_SRC=%DIR%UsersPage.js

if not exist "%LOGIN_SRC%" (
    echo  [ERROR] LoginPage.js not found next to this bat file.
    echo  Make sure LoginPage.js and UsersPage.js are in the same folder as this bat.
    pause
    exit /b 1
)
if not exist "%USERS_SRC%" (
    echo  [ERROR] UsersPage.js not found next to this bat file.
    pause
    exit /b 1
)

:: ── Copy the patched files ─────────────────────
echo  [COPYING] Installing patched LoginPage.js ...
copy /Y "%LOGIN_SRC%" "%INSTALL%\client\src\pages\LoginPage.js" >nul
if %errorlevel% neq 0 ( echo  [ERROR] Copy failed & pause & exit /b 1 )

echo  [COPYING] Installing patched UsersPage.js ...
copy /Y "%USERS_SRC%" "%INSTALL%\client\src\pages\UsersPage.js" >nul
if %errorlevel% neq 0 ( echo  [ERROR] Copy failed & pause & exit /b 1 )

echo  [OK] Files copied.
echo.

:: ── Rebuild ────────────────────────────────────
echo  [BUILDING] Rebuilding app (~30 seconds with Vite)...
echo.
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Build failed. See errors above.
    pause
    exit /b 1
)

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   SUCCESS - Eye toggle applied!
echo  ============================================
echo.
echo   What changed:
echo    - Login page       : eye icon on password
echo    - Add / Edit User  : eye icon on password
echo    - Click eye = show password as plain text
echo    - Click again = hide back to dots
echo.
echo   Next steps:
echo    1. Restart server  (close CMD + START_SERVER.bat)
echo    2. Hard refresh    (Ctrl + Shift + R in browser)
echo  ============================================
echo.
pause
