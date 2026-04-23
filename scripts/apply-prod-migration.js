// Apply schema-prod-migration.sql against the production TiDB Cloud DB.
// This is schema.sql with the INSERT IGNORE seed blocks stripped, because
// rss_revenue already has the 87 venues and location_name has no UNIQUE key
// (INSERT IGNORE would create duplicates).
//
// Usage:
//   node scripts/apply-prod-migration.js <path-to-.env>
//
// Example (from the repo root on the user's Mac):
//   node scripts/apply-prod-migration.js ~/Downloads/bee-dsr-form.env
//
// The script is idempotent — safe to run repeatedly. It verifies the 6 new
// locations columns exist afterward and reports row counts so you can tell
// at a glance whether anything worked.

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const [, , envPath] = process.argv;
if (!envPath) {
  console.error('Usage: node scripts/apply-prod-migration.js <env-file>');
  process.exit(1);
}

// Parse env file (simple KEY=VALUE — no quotes, no interpolation).
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

for (const k of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!env[k]) { console.error(`Missing ${k} in ${envPath}`); process.exit(1); }
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

console.log('→ Connected.');

// Snapshot BEFORE state so the delta is obvious.
const [beforeCols] = await conn.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations'
      AND COLUMN_NAME IN ('location_type','collection_split_type','split_percentage',
                          'split_config_json','cabinet_count','cabinet_config_json')
    ORDER BY COLUMN_NAME`
);
console.log(`→ BEFORE: locations has ${beforeCols.length}/6 migration columns`);

console.log('→ Applying schema-prod-migration.sql …');
const sql = fs.readFileSync(path.resolve('schema-prod-migration.sql'), 'utf8');
await conn.query(sql);
console.log('✓ Migration applied.');

// Snapshot AFTER state.
const [afterCols] = await conn.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations'
      AND COLUMN_NAME IN ('location_type','collection_split_type','split_percentage',
                          'split_config_json','cabinet_count','cabinet_config_json')
    ORDER BY COLUMN_NAME`
);
console.log(`✓ AFTER: locations has ${afterCols.length}/6 migration columns:`,
  afterCols.map(c => c.COLUMN_NAME).join(', '));

const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM locations');
console.log(`✓ locations total rows: ${n}`);

const [[{ company }]] = await conn.query(
  "SELECT COUNT(*) AS company FROM locations WHERE location_type='company_owned'"
);
const [[{ third }]] = await conn.query(
  "SELECT COUNT(*) AS third FROM locations WHERE location_type='third_party'"
);
console.log(`✓ company_owned=${company}  third_party=${third}`);

// Sanity-check the 4 pre-configured venues
const [configured] = await conn.query(
  `SELECT location_name, collection_split_type, split_percentage, cabinet_count
     FROM locations
    WHERE location_name IN ('Buc s Bar Grill','The Ready Room','Lucky Dragon','Kathy''s')
    ORDER BY location_name`
);
console.log('✓ Pre-configured venues:');
for (const r of configured) {
  console.log(`    ${r.location_name}: split=${r.collection_split_type} pct=${r.split_percentage} cabinets=${r.cabinet_count}`);
}

// Verify users.role has the collector enum value
const [[userRole]] = await conn.query(
  `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'`
);
console.log(`✓ users.role type: ${userRole?.COLUMN_TYPE}`);

await conn.end();
console.log('\nDone. Reload https://svetaisthebestanddeservesaraise.com/ — the 500s on Venues/Users should be gone.');
