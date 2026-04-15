@echo off
cd /d C:\ciflux-oms

echo [1] Killing node...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2] Checking files in C:\ciflux-oms...
dir C:\ciflux-oms\patch_server.js 2>nul && echo patch_server.js EXISTS || echo patch_server.js MISSING
dir C:\ciflux-oms\index.js 2>nul && echo index.js EXISTS || echo index.js MISSING

echo [3] Patching server\index.js directly with Node...
node -e "var fs=require('fs'),f='server/index.js',s=fs.readFileSync(f,'utf8'),n=(s.match(/  migrate\(/g)||[]).length;if(n===0){console.log('Already clean')}else{s=s.replace(/\/\/ ── startup migrations[\s\S]*?Migrations done'\);/,\"  console.log('[STARTUP] DB ready');\");s=s.split('\n').filter(l=>!l.trim().startsWith('migrate(')&&!l.trim().startsWith('const migrate =')&&l.trim()!=\"console.log('[STARTUP] Migrations done');\").join('\n');fs.writeFileSync(f,s);console.log('Patched: removed '+n+' migrate calls')}"

echo [4] Verifying...
findstr /c:"  migrate(" C:\ciflux-oms\server\index.js >nul 2>&1 && echo BAD: migrate still there || echo GOOD: migrate removed
find /c /v "" C:\ciflux-oms\server\index.js

echo [5] Building client...
cd client
call npm install
call npm run build
if errorlevel 1 ( echo Build FAILED & pause & exit /b 1 )
cd ..

echo [6] Killing port 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING" 2^>nul') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo [7] Starting server...
node server\index.js
pause
