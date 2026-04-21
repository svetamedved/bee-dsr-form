// Remove the smoke-test data created by seed-test.js.
// Deletes the test user, the SMOKE TEST location, and any submissions
// (+ approved daily_sales_summary rows) tied to them.
//
// Usage:
//   node scripts/teardown-test.js <path-to-.env>
import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) { console.error('Usage: node scripts/teardown-test.js <env-file>'); process.exit(1); }

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

const TEST_LOCATION_NAME = 'SMOKE TEST — DELETE ME';
const TEST_EMAIL = 'smoketest@bee-dsr.test';

// Resolve the test location id (if it exists)
const [locRows] = await conn.execute(
  'SELECT location_id FROM locations WHERE location_name=?', [TEST_LOCATION_NAME]
);
const locationId = locRows[0]?.location_id ?? null;

// Delete submissions tied to the test location (approved rows + pending)
let submissionsDeleted = 0;
let dssDeleted = 0;
if (locationId != null) {
  const [dss] = await conn.execute('DELETE FROM daily_sales_summary WHERE location=?', [TEST_LOCATION_NAME]);
  dssDeleted = dss.affectedRows;
  const [subs] = await conn.execute('DELETE FROM submissions WHERE location_id=?', [locationId]);
  submissionsDeleted = subs.affectedRows;
}

// Delete the test user
const [u] = await conn.execute('DELETE FROM users WHERE email=?', [TEST_EMAIL]);

// Delete the test location
let locDeleted = 0;
if (locationId != null) {
  const [l] = await conn.execute('DELETE FROM locations WHERE location_id=?', [locationId]);
  locDeleted = l.affectedRows;
}

console.log(`✓ Deleted ${u.affectedRows} user row(s) (${TEST_EMAIL})`);
console.log(`✓ Deleted ${submissionsDeleted} submission row(s)`);
console.log(`✓ Deleted ${dssDeleted} daily_sales_summary row(s)`);
console.log(`✓ Deleted ${locDeleted} location row(s) (${TEST_LOCATION_NAME})`);

await conn.end();
