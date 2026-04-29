#!/usr/bin/env node
// Dumps the tables we need to reconcile against the Cardinal QuickBooks export.
// Reads connection from .env. Writes one JSON file you upload to chat.
//
// USAGE (from project root):
//   node scripts/dump-for-reconcile.js
//
// Output: ./cardinal-recon-dump.json
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

const out = { db: process.env.DB_NAME, dumpedAt: new Date().toISOString() };

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
console.log('Connected to', process.env.DB_HOST + ':' + (process.env.DB_PORT || 3306), 'db=' + process.env.DB_NAME);

async function safe(label, q) {
  try {
    const [rows] = await conn.query(q);
    out[label] = rows;
    console.log('  ✓ ' + label + ' — ' + rows.length + ' rows');
  } catch (e) {
    out[label] = { error: e.message };
    console.log('  ✗ ' + label + ' — ' + e.message);
  }
}

// 1. All tables in the DB
const [tables] = await conn.query('SHOW TABLES');
out.tables = tables.map(r => Object.values(r)[0]);
console.log('Tables:', out.tables.join(', '));

// 2. Locations (full table — small)
await safe('locations_all', 'SELECT * FROM locations');

// 3. daily_cabinet_revenue schema + a sample
if (out.tables.includes('daily_cabinet_revenue')) {
  await safe('dcr_columns', 'SHOW COLUMNS FROM daily_cabinet_revenue');
  await safe('dcr_sample', 'SELECT * FROM daily_cabinet_revenue ORDER BY report_date DESC LIMIT 20');

  // 4. Distinct vendors + counts (helps us know if 'cardinal' exists)
  await safe('dcr_vendors', `
    SELECT vendor, COUNT(*) AS rows_count, MIN(report_date) AS earliest, MAX(report_date) AS latest
      FROM daily_cabinet_revenue
     GROUP BY vendor
     ORDER BY rows_count DESC
  `).catch(() => {}); // vendor column may not exist
}

// 5. daily_revenue schema + sample (for completeness)
if (out.tables.includes('daily_revenue')) {
  await safe('dr_columns', 'SHOW COLUMNS FROM daily_revenue');
  await safe('dr_sample', 'SELECT * FROM daily_revenue ORDER BY report_date DESC LIMIT 5');
}

// 6. Aggregated revenue per location per quarter, 2025+Q1 2026
//    We try several column-name shapes; the working one will succeed.
const REV_COLS = ['gross_revenue','revenue','daily_revenue','amount','gross','net_revenue','total','daily_total','total_amount'];
const LOC_COLS = ['location_id','location','location_name'];

if (out.tables.includes('daily_cabinet_revenue')) {
  const [colsRaw] = await conn.query('SHOW COLUMNS FROM daily_cabinet_revenue');
  const cols = colsRaw.map(c => c.Field);
  const revCol = REV_COLS.find(c => cols.includes(c));
  const locCol = LOC_COLS.find(c => cols.includes(c));
  out.detected = { revenueColumn: revCol, locationColumn: locCol, allColumns: cols };

  if (revCol && locCol && cols.includes('report_date')) {
    const filter = cols.includes('vendor') ? "AND LOWER(vendor) = 'cardinal'" : '';
    const joinClause = locCol === 'location_id'
      ? 'JOIN locations l ON l.location_id = dcr.location_id'
      : `JOIN locations l ON l.location_name = dcr.${locCol}`;
    await safe('cardinal_revenue_by_venue_quarter', `
      SELECT l.location_id, l.location_name, l.location_type,
             YEAR(dcr.report_date) AS yr,
             QUARTER(dcr.report_date) AS qtr,
             COUNT(*) AS days,
             ROUND(SUM(dcr.${revCol}), 2) AS gross_revenue
        FROM daily_cabinet_revenue dcr
        ${joinClause}
       WHERE dcr.report_date BETWEEN '2025-01-01' AND '2026-03-31'
         ${filter}
       GROUP BY l.location_id, l.location_name, l.location_type, yr, qtr
       ORDER BY l.location_name, yr, qtr
    `);
    // Also no-vendor version for comparison
    if (cols.includes('vendor')) {
      await safe('all_cabinet_revenue_by_venue_quarter', `
        SELECT l.location_id, l.location_name, l.location_type,
               YEAR(dcr.report_date) AS yr,
               QUARTER(dcr.report_date) AS qtr,
               COUNT(*) AS days,
               ROUND(SUM(dcr.${revCol}), 2) AS gross_revenue
          FROM daily_cabinet_revenue dcr
          ${joinClause}
         WHERE dcr.report_date BETWEEN '2025-01-01' AND '2026-03-31'
         GROUP BY l.location_id, l.location_name, l.location_type, yr, qtr
         ORDER BY l.location_name, yr, qtr
      `);
    }
  } else {
    out.aggregation_skipped = `Need rev column + loc column + report_date. Found rev=${revCol} loc=${locCol} cols=${cols.join(',')}`;
  }
}

// 7. Total record counts for every table — sanity check on what's populated
out.row_counts = {};
for (const t of out.tables) {
  try {
    const [[r]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
    out.row_counts[t] = r.c;
  } catch (e) {
    out.row_counts[t] = 'error: ' + e.message;
  }
}
console.log('\nRow counts:', out.row_counts);

writeFileSync('cardinal-recon-dump.json', JSON.stringify(out, null, 2));
console.log('\n✓ Wrote cardinal-recon-dump.json');
console.log('\n→ Drag that file into the chat. I will do the rest.');

await conn.end();
