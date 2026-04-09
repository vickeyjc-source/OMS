@echo off
title Ciflux OMS - Enquiry Form Update
color 0A
echo.
echo  ============================================
echo   Ciflux OMS  -  Enquiry Form Update
echo   - Removes Line Card field from item form
echo   - Manufacturer becomes searchable dropdown
echo     with all major electronic brands
echo   - If brand not found: Add button opens
echo     Line Card popup to save new brand
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
if not exist "%DIR%NewEnquiryPage.js" (
    echo  [ERROR] NewEnquiryPage.js not found next to this bat file.
    pause & exit /b 1
)

echo  [COPYING] Installing NewEnquiryPage.js...
copy /Y "%DIR%NewEnquiryPage.js" "%INSTALL%\client\src\pages\NewEnquiryPage.js" >nul
if %errorlevel% neq 0 ( echo  [ERROR] Copy failed & pause & exit /b 1 )
echo  [OK] File copied.
echo.

echo  [BUILDING] Rebuilding app (~30 seconds)...
cd /d "%INSTALL%\client"
call npm run build
if %errorlevel% neq 0 ( echo  [ERROR] Build failed & pause & exit /b 1 )

cd /d "%INSTALL%"
echo.
echo  ============================================
echo   DONE! Enquiry form updated.
echo  ============================================
echo.
echo   What changed in New Enquiry form:
echo.
echo   - Line Card field REMOVED from items
echo.
echo   - Manufacturer = searchable dropdown
echo     with 150+ world electronic brands:
echo     TI, STMicro, NXP, Murata, Molex,
echo     Vishay, Infineon, Nordic, Espressif...
echo.
echo   - Type to search/filter brands live
echo.
echo   - If brand not in list, a button appears:
echo     [+ Add "XYZ" as new brand to Line Card]
echo     Click it and a popup form opens to:
echo     - Enter brand name (pre-filled)
echo     - Select category
echo     - Add description
echo     - Click Save -> brand is stored and
echo       auto-selected in the form
echo.
echo   1. Restart server  (Ctrl+C + START_SERVER.bat)
echo   2. Ctrl+Shift+R in browser
echo  ============================================
echo.
pause
