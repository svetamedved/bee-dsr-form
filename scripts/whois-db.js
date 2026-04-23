// Diagnostic: connects to the DB using the exact same credentials the
// server uses, then prints which MySQL instance it actually reached
// and whether the `locations` table has the post-migration columns.
import mysql from 'mysql2/promise';
import fs from 'fs';

// Load .env the way the server does (dotenvx or plain)
const envTxt = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

console.log('→ Using .env values:', {
  DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT,
  DB_USER: env.DB_USER, DB_NAME: env.DB_NAME,
});

const conn = await mysql.createConnection({
  host:     env.DB_HOST,
  port:     parseInt(env.DB_PORT) || 3306,
  user:     env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

const [[who]] = await conn.query(
  'SELECT DATABASE() AS db, @@hostname AS host, @@port AS port, @@version AS version, @@socket AS socket'
);
console.log('→ Connected to:', who);

const [cols] = await conn.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations'
      AND COLUMN_NAME IN ('location_type','collection_split_type','split_percentage',
                          'split_config_json','cabinet_count','cabinet_config_json')
    ORDER BY COLUMN_NAME`
);
console.log(`→ locations has ${cols.length}/6 migration columns:`,
  cols.map(c => c.COLUMN_NAME).join(', ') || '(none)');

const [[cnt]] = await conn.query('SELECT COUNT(*) AS n FROM locations');
console.log(`→ locations row count: ${cnt.n}`);

await conn.end();
