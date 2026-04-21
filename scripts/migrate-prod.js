// One-shot: apply schema.sql + create/reset admin against a remote DB.
// Usage:
//   node scripts/migrate-prod.js <path-to-.env> <admin-email> <admin-password> [name]
// Reads DB_* vars from the given env file (NOT the repo's local .env).
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const [, , envPath, email, password, name] = process.argv;
if (!envPath || !email || !password) {
  console.error('Usage: node scripts/migrate-prod.js <env-file> <email> <password> [name]');
  process.exit(1);
}

// Parse the env file (simple KEY=VALUE, no quotes needed for our values).
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

console.log(`→ Target DB: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT || 3306}/${env.DB_NAME} (SSL=${env.DB_SSL})`);

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

// Verify users table now exists.
const [tbls] = await conn.query(
  "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('users','submissions','daily_sales_summary')",
  [env.DB_NAME]
);
console.log('✓ Tables present:', tbls.map(r => r.TABLE_NAME));

// Create or reset the admin.
const hash = await bcrypt.hash(password, 10);
const lower = email.toLowerCase().trim();
const [existing] = await conn.execute('SELECT id FROM users WHERE email=?', [lower]);
if (existing.length) {
  await conn.execute(
    'UPDATE users SET password_hash=?, role="admin", active=1, must_change_password=0 WHERE email=?',
    [hash, lower]
  );
  console.log(`✓ Updated existing user "${lower}" — now admin, password reset.`);
} else {
  await conn.execute(
    'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, "admin")',
    [lower, name || 'Admin', hash]
  );
  console.log(`✓ Created admin user "${lower}".`);
}
await conn.end();
console.log('Done.');
