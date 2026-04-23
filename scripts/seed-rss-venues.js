// Seed the 68 RSS third-party venues on prod + apply the 4 pre-configured
// venue settings. Idempotent: adds a UNIQUE index on location_name first so
// INSERT IGNORE actually dedupes on re-runs, then falls back to INSERT IGNORE
// for the 68 RSS rows.
//
// Usage:
//   node scripts/seed-rss-venues.js ~/Downloads/bee-dsr-form.env

import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) {
  console.error('Usage: node scripts/seed-rss-venues.js <env-file>');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const RSS = [
  'B B Wings BBQ', 'Bar 529', 'Bethany', 'Bing Bass Bingo', 'Bracken Creekside',
  'Broad Street Billiards', 'Buc s Bar Grill', 'Capital O Hotel', 'Cardinal Sweepstakes',
  'Champs Sports Bar', "Christie's", 'Crazy Horse', 'Creedmoor Grocery',
  'Dead Kat Tattoo 1', 'Double Daves Pizza', 'Easy Street', 'El 915 Bar',
  'El Rey', 'Evolution Tattoo', 'FIASCO', 'Gallinas Locas Bar', "Goodfellow's",
  'Grab Axxes', 'Hard 90 Sports Bar', 'Herman Marshall', 'High Horse',
  'High Society 1 Jasper', 'High Society 2 Stan', 'High Society 3 Temple',
  'Hitching Post', "Kathy's", 'La Pasadita 349', 'Loaded Daiquiris',
  'Lucky Dragon', 'Lucky Lion', "Lucky's", 'Mayan Taqueria', "McNeal's Galveston",
  "McNeal's Tavern", 'Midtown Meetup', 'MoBetter Bar', "Mr. D's Cardinal",
  "Mr. D's Redplum", "Mr. Jim's", 'Old 181 Bar', 'On The River', 'Pressbox',
  'Rikenjaks', "Rocco's Hot Wings", 'Rodeo 4', 'Shamrock', 'Smoking Jacket',
  "Solano's", 'The Players Lounge', 'The Ready Room', 'The Society Barbershop',
  'The Spot', 'The Trio Club', 'The Underpass', 'The Vintage Hangout',
  'Time To Spare', "Trickler's Deli", 'Turn Around Bar', 'Two Rivers',
  'Vegas Texas', 'Wetmore Beach House', 'WhiskeyTA Club', "Woody's",
];

console.log(`→ Target: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);

const conn = await mysql.createConnection({
  host:     env.DB_HOST,
  port:     parseInt(env.DB_PORT) || 3306,
  user:     env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl:      env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

// -----------------------------------------------------------------
// 1. Ensure UNIQUE index on location_name (safety net so INSERT IGNORE
//    truly dedupes on repeat runs).
// -----------------------------------------------------------------
const [[{ hasUniq }]] = await conn.query(
  `SELECT COUNT(*) AS hasUniq FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations'
       AND INDEX_NAME='uniq_location_name'`
);
if (!hasUniq) {
  // Before adding UNIQUE, check for existing dupes that would block it.
  const [dupes] = await conn.query(
    `SELECT location_name, COUNT(*) AS n FROM locations
       GROUP BY location_name HAVING n > 1`
  );
  if (dupes.length) {
    console.log(`⚠ Cannot add UNIQUE index — ${dupes.length} duplicate name(s):`);
    for (const d of dupes) console.log(`    "${d.location_name}" (×${d.n})`);
    console.log('  Resolve manually and re-run.');
    await conn.end();
    process.exit(1);
  }
  await conn.query('ALTER TABLE locations ADD UNIQUE KEY uniq_location_name (location_name)');
  console.log('✓ Added UNIQUE KEY uniq_location_name.');
} else {
  console.log('✓ UNIQUE KEY uniq_location_name already exists.');
}

// -----------------------------------------------------------------
// 2. INSERT IGNORE the 68 RSS venues.
// -----------------------------------------------------------------
const placeholders = RSS.map(() => "(?, 'active', 'third_party')").join(',');
const [ins] = await conn.query(
  `INSERT IGNORE INTO locations (location_name, location_status, location_type) VALUES ${placeholders}`,
  RSS
);
console.log(`✓ INSERT IGNORE: ${ins.affectedRows} of ${RSS.length} RSS venues inserted (rest already present).`);

// -----------------------------------------------------------------
// 3. Apply the 4 pre-configured venue settings (idempotent — WHERE IS NULL).
// -----------------------------------------------------------------
const preConfigs = [
  {
    name: 'Buc s Bar Grill',
    split: 'big_easy',
    pct: null,
    count: 4,
    config: JSON.stringify(
      Array.from({ length: 4 }, (_, i) => ({ label: String(i + 1), type: 'redplum' }))
    ),
  },
  {
    name: 'The Ready Room',
    split: 'percentage',
    pct: 50.00,
    count: 6,
    config: JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ label: String(i + 1), type: 'redplum' }))
    ),
  },
  {
    name: 'Lucky Dragon',
    split: 'big_easy',
    pct: null,
    count: 22,
    config: JSON.stringify(
      Array.from({ length: 22 }, (_, i) => ({
        label: String(i + 1),
        type: i < 10 ? 'redplum' : 'cardinal',
      }))
    ),
  },
  {
    name: "Kathy's",
    split: 'percentage',
    pct: 50.00,
    count: 6,
    config: JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ label: String(i + 1), type: 'cardinal' }))
    ),
  },
];

for (const v of preConfigs) {
  const [r] = await conn.query(
    `UPDATE locations
        SET collection_split_type=?, split_percentage=?, cabinet_count=?, cabinet_config_json=?
      WHERE location_name=? AND collection_split_type IS NULL`,
    [v.split, v.pct, v.count, v.config, v.name]
  );
  console.log(`  ${v.name}: ${r.affectedRows === 0 ? '(already configured or not present)' : 'configured'}`);
}

// -----------------------------------------------------------------
// 4. Final snapshot.
// -----------------------------------------------------------------
const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM locations');
const [dist] = await conn.query(
  "SELECT location_type, COUNT(*) AS n FROM locations GROUP BY location_type ORDER BY location_type"
);
console.log(`\n── FINAL ──`);
console.log(`Total locations: ${total}`);
for (const r of dist) console.log(`  ${r.location_type}: ${r.n}`);

const [configured] = await conn.query(
  `SELECT location_name, collection_split_type, split_percentage, cabinet_count
     FROM locations
    WHERE location_name IN ('Buc s Bar Grill','The Ready Room','Lucky Dragon','Kathy''s')
    ORDER BY location_name`
);
console.log('Pre-configured venues:');
for (const r of configured) {
  console.log(`  ${r.location_name}: split=${r.collection_split_type} pct=${r.split_percentage} cabinets=${r.cabinet_count}`);
}

await conn.end();
console.log('\nDone. Reload the site — third-party venues should appear now.');
