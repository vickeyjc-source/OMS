@echo off
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
set DB=ciflux_oms
set U=postgres

echo === Orphaned finance_queue entries (no matching supplier_order) ===
%PSQL% -U %U% -d %DB% -c "SELECT id, supplier_order_id, order_id, status FROM finance_queue WHERE supplier_order_id NOT IN (SELECT id FROM supplier_orders);"

echo.
echo Press any key to DELETE orphaned finance_queue entries...
pause

%PSQL% -U %U% -d %DB% -c "DELETE FROM finance_queue WHERE supplier_order_id NOT IN (SELECT id FROM supplier_orders);"
echo Done.
echo.
pause
