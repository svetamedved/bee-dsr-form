// Create or reset the initial admin user.
// Usage:
//   node scripts/create-admin.js admin@example.com "ChangeMe123!"
// Relies on the same .env the server uses.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const [, , email, password, name] = process.argv;
if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password> [name]');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'rss_revenue',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

const hash = await bcrypt.hash(password, 10);
const lower = email.toLowerCase().trim();

const [existing] = await conn.execute('SELECT id FROM users WHERE email=?', [lower]);
if (existing.length) {
  await conn.execute(
    'UPDATE users SET password_hash=?, role="admin", active=1, must_change_password=0 WHERE email=?',
    [hash, lower]
  );
  console.log(`Updated existing user "${lower}" — now admin, password reset.`);
} else {
  await conn.execute(
    'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, "admin")',
    [lower, name || 'Admin', hash]
  );
  console.log(`Created admin user "${lower}".`);
}
await conn.end();
