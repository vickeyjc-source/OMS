@echo off
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\15\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\14\bin\psql.exe"
set DB=ciflux_oms
set U=postgres

echo.
echo === Current finance_queue entries ===
%PSQL% -U %U% -d %DB% -c "SELECT id, supplier_order_id, order_id, amount, status, created_at FROM finance_queue ORDER BY created_at DESC;"

echo.
echo === Duplicates — same supplier_order_id with multiple pending entries ===
%PSQL% -U %U% -d %DB% -c "SELECT supplier_order_id, COUNT(*) as cnt FROM finance_queue WHERE status='pending' GROUP BY supplier_order_id HAVING COUNT(*) > 1;"

echo.
echo Press any key to DELETE duplicates (keep only the latest per supplier_order_id)...
echo Press Ctrl+C to cancel.
pause

%PSQL% -U %U% -d %DB% -c "DELETE FROM finance_queue WHERE id NOT IN (SELECT DISTINCT ON (supplier_order_id) id FROM finance_queue ORDER BY supplier_order_id, created_at DESC);"

echo.
echo === Also remove finance_queue entries with no matching supplier_order ===
%PSQL% -U %U% -d %DB% -c "DELETE FROM finance_queue WHERE supplier_order_id NOT IN (SELECT id FROM supplier_orders);"

echo.
echo === Final state ===
%PSQL% -U %U% -d %DB% -c "SELECT id, supplier_order_id, order_id, amount, status, created_at FROM finance_queue ORDER BY created_at DESC;"
echo.
pause
