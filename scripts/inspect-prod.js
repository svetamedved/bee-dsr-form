// Dump a diagnostic snapshot of what's in the prod DB.
// Usage: node scripts/inspect-prod.js <path-to-.env>
import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) { console.error('Usage: node scripts/inspect-prod.js <env-file>'); process.exit(1); }

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const conn = await mysql.createConnection({
  host: env.DB_HOST, port: parseInt(env.DB_PORT)||3306,
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  ssl: env.DB_SSL==='true' ? { minVersion:'TLSv1.2', rejectUnauthorized:true } : undefined,
});

console.log(`DB: ${env.DB_NAME} @ ${env.DB_HOST}\n`);

const [tables] = await conn.query(
  'SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
  [env.DB_NAME]
);
console.log(`Tables (${tables.length}):`);
for (const t of tables) console.log(`  ${t.TABLE_NAME}  (~${t.TABLE_ROWS} rows)`);

console.log('\nlocations columns:');
try {
  const [cols] = await conn.query(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
    [env.DB_NAME, 'locations']
  );
  if (!cols.length) console.log('  (no locations table)');
  for (const c of cols) console.log(`  ${c.COLUMN_NAME}  ${c.COLUMN_TYPE}  null=${c.IS_NULLABLE}  key=${c.COLUMN_KEY}`);
} catch (e) { console.log('  error:', e.message); }

console.log('\nlocations row count:');
try {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM locations');
  console.log('  ', n);
} catch (e) { console.log('  error:', e.message); }

for (const tbl of ['daily_revenue', 'daily_cabinet_revenue']) {
  console.log(`\n${tbl} columns:`);
  const [cols] = await conn.query(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
    [env.DB_NAME, tbl]
  );
  for (const c of cols) console.log(`  ${c.COLUMN_NAME}  ${c.COLUMN_TYPE}  null=${c.IS_NULLABLE}  key=${c.COLUMN_KEY}`);
}

await conn.end();
