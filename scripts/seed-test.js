// Seed ONE test location + ONE test venue user for end-to-end smoke testing.
// Usage:
//   node scripts/seed-test.js <path-to-.env>
// Idempotent: re-running updates the existing test rows.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) { console.error('Usage: node scripts/seed-test.js <env-file>'); process.exit(1); }

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
const TEST_PASSWORD = 'SmokeTest1!';

// Upsert the test location
const [existingLoc] = await conn.execute('SELECT location_id FROM locations WHERE location_name=?', [TEST_LOCATION_NAME]);
let locationId;
if (existingLoc.length) {
  locationId = existingLoc[0].location_id;
  console.log(`✓ Test location already exists: id=${locationId}`);
} else {
  const [ins] = await conn.execute(
    "INSERT INTO locations (location_name, location_status) VALUES (?, 'active')",
    [TEST_LOCATION_NAME]
  );
  locationId = ins.insertId;
  console.log(`✓ Test location created: id=${locationId}`);
}

// Upsert the test venue user, linked to the test location
const hash = await bcrypt.hash(TEST_PASSWORD, 10);
const [existingUser] = await conn.execute('SELECT id FROM users WHERE email=?', [TEST_EMAIL]);
if (existingUser.length) {
  await conn.execute(
    "UPDATE users SET password_hash=?, role='venue', active=1, must_change_password=0, location_id=? WHERE email=?",
    [hash, locationId, TEST_EMAIL]
  );
  console.log(`✓ Test venue user updated: ${TEST_EMAIL}`);
} else {
  await conn.execute(
    "INSERT INTO users (email, name, password_hash, role, location_id) VALUES (?, 'Smoke Test Venue', ?, 'venue', ?)",
    [TEST_EMAIL, hash, locationId]
  );
  console.log(`✓ Test venue user created: ${TEST_EMAIL}`);
}

console.log('\nReady to smoke test:');
console.log(`  URL:      https://svetaisthebestanddeservesaraise.com`);
console.log(`  Email:    ${TEST_EMAIL}`);
console.log(`  Password: ${TEST_PASSWORD}`);
console.log(`  Location: ${TEST_LOCATION_NAME} (id=${locationId})`);

await conn.end();
