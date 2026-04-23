// Diagnose what's in the users table on prod — surfaces existence, role,
// active flag, whether there's a password_hash, created/last_login timestamps.
// No writes. Safe to run anytime.
//
// Usage: node scripts/diag-users.js ~/Downloads/bee-dsr-form.env

import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) { console.error('Usage: node scripts/diag-users.js <env-file>'); process.exit(1); }

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const conn = await mysql.createConnection({
  host:     env.DB_HOST,
  port:     parseInt(env.DB_PORT) || 3306,
  user:     env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl:      env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

console.log(`→ ${env.DB_USER}@${env.DB_HOST}/${env.DB_NAME}\n`);

// Schema of users table
const [cols] = await conn.query(
  `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'
    ORDER BY ORDINAL_POSITION`
);
console.log(`users table columns (${cols.length}):`);
for (const c of cols) console.log(`  ${c.COLUMN_NAME}  ${c.COLUMN_TYPE}  null=${c.IS_NULLABLE}`);

// Row count
const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
console.log(`\nusers total rows: ${n}`);

// List all users (but redact the hash — just show whether one is present)
const [users] = await conn.query(
  `SELECT id, email, name, role, active, must_change_password,
          (password_hash IS NOT NULL AND LENGTH(password_hash)>0) AS has_hash,
          LENGTH(password_hash) AS hash_len,
          DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created,
          DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i') AS last_login
     FROM users ORDER BY id`
);
console.log('\nAll users:');
for (const u of users) {
  console.log(
    `  [${u.id}] ${u.email.padEnd(32)} role=${String(u.role).padEnd(10)} ` +
    `active=${u.active} must_change=${u.must_change_password} ` +
    `hash=${u.has_hash ? `yes(len=${u.hash_len})` : 'NO'} ` +
    `created=${u.created} last_login=${u.last_login || '(never)'}`
  );
}

// Spotlight the 2 emails we care about
for (const email of ['sveta@bigeasyent.com', 'kassie@bigeasyent.com']) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM users WHERE email = ?`, [email]
  );
  console.log(`\n"${email}": ${r.n ? 'EXISTS' : 'DOES NOT EXIST'}`);
}

await conn.end();
