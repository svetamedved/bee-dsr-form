// Apply schema.sql against a remote DB. Idempotent — safe to re-run.
// Usage:
//   node scripts/apply-schema.js <path-to-.env>
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const [, , envPath] = process.argv;
if (!envPath) {
  console.error('Usage: node scripts/apply-schema.js <env-file>');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

console.log(`→ Target: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT || 3306}/${env.DB_NAME} (SSL=${env.DB_SSL})`);

const conn = await mysql.createConnection({
  host:     env.DB_HOST,
  port:     parseInt(env.DB_PORT) || 3306,
  user:     env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl:      env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  multipleStatements: true,
});

console.log('→ Connected. Applying schema.sql …');
const sql = fs.readFileSync(path.resolve('schema.sql'), 'utf8');
await conn.query(sql);
console.log('✓ Schema applied.');

const [tbls] = await conn.query(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA=? AND TABLE_NAME IN
   ('users','submissions','submission_images','daily_sales_summary','locations')
   ORDER BY TABLE_NAME`,
  [env.DB_NAME]
);
console.log('✓ Tables present:', tbls.map(r => r.TABLE_NAME).join(', '));

await conn.end();
console.log('Done.');
