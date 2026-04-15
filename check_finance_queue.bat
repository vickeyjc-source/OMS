@echo off
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not exist %PSQL% set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
set DB=ciflux_oms
set U=postgres

echo === finance_queue pending entries ===
%PSQL% -U %U% -d %DB% -c "SELECT fq.id, fq.supplier_order_id, fq.order_id, fq.amount, fq.status, so.payment_blocked, so.payment_terms_type FROM finance_queue fq LEFT JOIN supplier_orders so ON so.id=fq.supplier_order_id WHERE fq.status='pending';"

echo.
echo === supplier_orders with payment_blocked=1 ===
%PSQL% -U %U% -d %DB% -c "SELECT so.id, so.order_id, so.supplier_id, so.payment_blocked, so.payment_terms_type, so.confirmed_price FROM supplier_orders so WHERE so.payment_blocked=1;"

echo.
echo === supplier_orders with advance terms but NO finance_queue entry ===
%PSQL% -U %U% -d %DB% -c "SELECT so.id, so.order_id, so.payment_terms_type, so.payment_blocked FROM supplier_orders so WHERE so.payment_terms_type='advance' AND NOT EXISTS (SELECT 1 FROM finance_queue fq WHERE fq.supplier_order_id=so.id AND fq.status='pending');"
echo.
pause
