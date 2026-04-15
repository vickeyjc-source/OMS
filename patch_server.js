// patch_server.js — removes migrate() deadlock block from server\index.js
// Run once: node patch_server.js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server', 'index.js');

let src = fs.readFileSync(file, 'utf8');
const before = (src.match(/migrate\(/g)||[]).length;

if (before === 0) {
  console.log('✅ Already clean — no migrate() calls found');
  process.exit(0);
}

// Remove the entire migrate block
const migrateBlock = /\/\/ ── startup migrations[\s\S]*?console\.log\('\[STARTUP\] Migrations done'\);/;
src = src.replace(migrateBlock,
  "  console.log('[STARTUP] DB ready — registering routes...');\n  // Migrations handled by db.js initDb() via pool.query()");

// Also remove any standalone migrate() lines that remain
src = src.split('\n').filter(line => {
  const t = line.trim();
  return !(t.startsWith('migrate(') || t.startsWith('const migrate =') || t === "console.log('[STARTUP] Migrations done');");
}).join('\n');

const after = (src.match(/  migrate\(/g)||[]).filter(l => !l.includes('//')).length;
fs.writeFileSync(file, src, 'utf8');
console.log(`✅ Patched: removed ${before} migrate() calls (${after} remaining)`);
