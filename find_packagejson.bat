@echo off
echo Looking for package.json files in C:\ciflux-oms...
echo.
dir C:\ciflux-oms\package.json 2>nul && echo FOUND: C:\ciflux-oms\package.json
dir C:\ciflux-oms\server\package.json 2>nul && echo FOUND: C:\ciflux-oms\server\package.json
dir C:\ciflux-oms\client\package.json 2>nul && echo FOUND: C:\ciflux-oms\client\package.json
echo.
echo Folder structure:
dir C:\ciflux-oms /b
echo.
echo Server folder:
dir C:\ciflux-oms\server /b
pause
