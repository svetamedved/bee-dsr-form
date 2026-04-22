// Bulk-seed venues into the `locations` table. Reads a plain-text file
// with one venue name per line. Blank lines and lines starting with #
// are ignored. Idempotent: existing rows (matched by location_name)
// are left untouched; only new names are inserted.
//
// Usage:
//   node scripts/seed-locations.js <path-to-.env> <path-to-venues.txt>
import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath, namesPath] = process.argv;
if (!envPath || !namesPath) {
  console.error('Usage: node scripts/seed-locations.js <env-file> <venues.txt>');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const names = fs.readFileSync(namesPath, 'utf8')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('#'));

console.log(`Loaded ${names.length} venue name(s) from ${namesPath}`);

const conn = await mysql.createConnection({
  host: env.DB_HOST, port: parseInt(env.DB_PORT)||3306,
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  ssl: env.DB_SSL==='true' ? { minVersion:'TLSv1.2', rejectUnauthorized:true } : undefined,
});

let added = 0, skipped = 0;
for (const name of names) {
  const [existing] = await conn.execute('SELECT location_id FROM locations WHERE location_name=?', [name]);
  if (existing.length) {
    skipped++;
    continue;
  }
  await conn.execute(
    "INSERT INTO locations (location_name, location_status) VALUES (?, 'active')",
    [name]
  );
  added++;
  console.log(`+ ${name}`);
}

console.log(`\nDone. Added ${added}, skipped ${skipped} (already existed).`);

const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM locations');
console.log(`Total locations now: ${total}`);

await conn.end();
