@echo off
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
set DB=ciflux_oms
set U=postgres

echo === Supplier order a5d9639d ===
%PSQL% -U %U% -d %DB% -c "SELECT * FROM supplier_orders WHERE id='a5d9639d';"
echo.
pause
