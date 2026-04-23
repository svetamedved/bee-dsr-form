// Diagnose + fix location_type classification on production.
//
// After the main migration, all 87 locations may be flagged as
// 'company_owned' if the business_unit column values didn't match the
// expected 'RSS'/'BEE'. This script classifies each row by matching
// location_name against the authoritative hardcoded lists (19 BEE
// company-owned + 68 RSS third-party) — no dependency on business_unit.
//
// Safe to run repeatedly. Reports before/after counts.
//
// Usage:
//   node scripts/fix-prod-venue-types.js ~/Downloads/bee-dsr-form.env

import mysql from 'mysql2/promise';
import fs from 'fs';

const [, , envPath] = process.argv;
if (!envPath) {
  console.error('Usage: node scripts/fix-prod-venue-types.js <env-file>');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Authoritative lists — same order/spelling as schema.sql.
const BEE = [
  'BE Station Brady', 'BES 2 Rockport', 'BES 4 Kingsbury', 'BES 6 Buchanan Dam',
  'BES 7 San Antonio', 'BES 8 Pflugerville', 'BES 10 - Crossroads Robstown',
  'BES Giddings', 'Icehouse in SA', 'Lucky Cosmos Buda', 'MT 4 Corsicana',
  'MT 5 Conroe', 'Music City', 'My Office Club', 'Skillzone 1 Porter',
  'Skillzone 2 Mt Pleasant', 'Speakeasy Lakeway', 'Starlite Saloon', 'Whiskey Room',
];

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
// Diagnose BEFORE state
// -----------------------------------------------------------------
const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM locations');
console.log(`\n── BEFORE ──`);
console.log(`Total locations: ${total}`);

const [typeDist] = await conn.query(
  "SELECT location_type, COUNT(*) AS n FROM locations GROUP BY location_type ORDER BY location_type"
);
console.log('location_type distribution:');
for (const r of typeDist) console.log(`  ${r.location_type}: ${r.n}`);

// Report business_unit values (if column exists) so we know what we're dealing with.
const [[{ hasBU }]] = await conn.query(
  `SELECT COUNT(*) AS hasBU FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='business_unit'`
);
if (hasBU) {
  const [buDist] = await conn.query(
    'SELECT business_unit, COUNT(*) AS n FROM locations GROUP BY business_unit ORDER BY business_unit'
  );
  console.log('business_unit distribution:');
  for (const r of buDist) console.log(`  ${r.business_unit ?? '(null)'}: ${r.n}`);
} else {
  console.log('business_unit column: (does not exist)');
}

// -----------------------------------------------------------------
// Apply classification by name (the authoritative strategy)
// -----------------------------------------------------------------
console.log('\n── APPLYING FIX ──');

// mysql2 `execute` with an array parameter needs IN (?) expansion; easiest
// path is a single UPDATE with a CASE + IN-list built from the arrays.
const beePlaceholders = BEE.map(() => '?').join(',');
const rssPlaceholders = RSS.map(() => '?').join(',');

const sql = `
  UPDATE locations
     SET location_type = CASE
       WHEN location_name IN (${beePlaceholders}) THEN 'company_owned'
       WHEN location_name IN (${rssPlaceholders}) THEN 'third_party'
       ELSE location_type
     END
`;
const [result] = await conn.query(sql, [...BEE, ...RSS]);
console.log(`✓ UPDATE matched ${result.affectedRows} rows, changed ${result.changedRows} rows.`);

// -----------------------------------------------------------------
// Diagnose AFTER state
// -----------------------------------------------------------------
console.log(`\n── AFTER ──`);
const [typeDistAfter] = await conn.query(
  "SELECT location_type, COUNT(*) AS n FROM locations GROUP BY location_type ORDER BY location_type"
);
for (const r of typeDistAfter) console.log(`  ${r.location_type}: ${r.n}`);

// Unmatched rows (neither on the BEE nor RSS list) — surface them so any
// venue added directly in prod since the migration isn't silently mis-typed.
const [unmatched] = await conn.query(
  `SELECT location_id, location_name, location_type FROM locations
     WHERE location_name NOT IN (${beePlaceholders})
       AND location_name NOT IN (${rssPlaceholders})
     ORDER BY location_name`,
  [...BEE, ...RSS]
);
if (unmatched.length) {
  console.log(`\n⚠ ${unmatched.length} unmatched row(s) (not on either hardcoded list):`);
  for (const r of unmatched) console.log(`    [${r.location_id}] "${r.location_name}"  → ${r.location_type}`);
} else {
  console.log('\n✓ All rows matched one of the two authoritative lists.');
}

await conn.end();
console.log('\nDone. Reload the site — third-party venues should appear now.');
