#!/usr/bin/env node
// v2 — pulls from revenue_records (the real historical fact table) instead of
// the platform's empty daily_cabinet_revenue. Also fixes the collation issue.
//
// USAGE:  node scripts/dump-for-reconcile-v2.js
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
console.log('Connected.');

async function safe(label, q, params) {
  try {
    const [rows] = await conn.query(q, params || []);
    out[label] = rows;
    console.log('  ✓ ' + label + ' — ' + rows.length + ' rows');
  } catch (e) {
    out[label] = { error: e.message, query: q.slice(0, 200) };
    console.log('  ✗ ' + label + ' — ' + e.message);
  }
}

// (1) revenue_records schema + sample
await safe('rr_columns', 'SHOW COLUMNS FROM revenue_records');
await safe('rr_sample', 'SELECT * FROM revenue_records ORDER BY report_date DESC LIMIT 10');

// (2) dim_vendor — full content (small)
await safe('dim_vendor_all', 'SELECT * FROM dim_vendor');

// (3) dim_revenue_agreement — full (small)
await safe('dim_revenue_agreement_all', 'SELECT * FROM dim_revenue_agreement');

// (4) dim_machine sample + structure
await safe('dim_machine_columns', 'SHOW COLUMNS FROM dim_machine');
await safe('dim_machine_sample', 'SELECT * FROM dim_machine LIMIT 10');

// (5) Distinct vendor names / values in revenue_records — to find Cardinal
await safe('rr_vendor_distribution', `
  SELECT
    COALESCE(vendor_name, vendor_id) AS vendor,
    COUNT(*) AS rows_count,
    MIN(report_date) AS earliest,
    MAX(report_date) AS latest,
    ROUND(SUM(net_revenue), 2) AS total_net_revenue
  FROM revenue_records
  GROUP BY vendor
  ORDER BY rows_count DESC
`).catch(async () => {
  // try another column shape
  await safe('rr_vendor_distribution', `
    SELECT * FROM revenue_records LIMIT 1
  `);
});

// (6) Try with just vendor_id + dim_vendor join
await safe('rr_by_vendor_dim', `
  SELECT v.vendor_name, COUNT(*) c, MIN(rr.report_date) mn, MAX(rr.report_date) mx,
         ROUND(SUM(rr.net_revenue), 2) total_net_rev
    FROM revenue_records rr
    LEFT JOIN dim_vendor v ON v.vendor_id = rr.vendor_id
   GROUP BY v.vendor_name
   ORDER BY c DESC
`);

// (7) Cardinal revenue by venue & quarter (from revenue_records)
//     Try multiple shapes so at least one works.
await safe('rr_cardinal_by_venue_quarter', `
  SELECT
    rr.location COLLATE utf8mb4_unicode_ci AS location_name,
    YEAR(rr.report_date) AS yr,
    QUARTER(rr.report_date) AS qtr,
    COUNT(*) AS days,
    ROUND(SUM(rr.net_revenue), 2) AS gross_revenue
  FROM revenue_records rr
  LEFT JOIN dim_vendor v ON v.vendor_id = rr.vendor_id
  WHERE (LOWER(v.vendor_name) LIKE '%cardinal%' OR LOWER(rr.vendor_name) LIKE '%cardinal%')
    AND rr.report_date BETWEEN '2025-01-01' AND '2026-03-31'
  GROUP BY rr.location, yr, qtr
  ORDER BY rr.location, yr, qtr
`);

// (8) Same but no vendor filter — gives total revenue per venue (sanity)
await safe('rr_all_by_venue_quarter', `
  SELECT
    rr.location COLLATE utf8mb4_unicode_ci AS location_name,
    YEAR(rr.report_date) AS yr,
    QUARTER(rr.report_date) AS qtr,
    COUNT(*) AS days,
    ROUND(SUM(rr.net_revenue), 2) AS gross_revenue
  FROM revenue_records rr
  WHERE rr.report_date BETWEEN '2025-01-01' AND '2026-03-31'
  GROUP BY rr.location, yr, qtr
  ORDER BY rr.location, yr, qtr
`);

// (9) revenue_records distinct locations — compares to locations table
await safe('rr_distinct_locations', `
  SELECT DISTINCT location, COUNT(*) c
    FROM revenue_records
   GROUP BY location
   ORDER BY c DESC
`);

// (10) views worth peeking at
await safe('vw_location_summary_sample', 'SELECT * FROM vw_location_summary LIMIT 5');
await safe('vw_location_summary_columns', 'SHOW COLUMNS FROM vw_location_summary');

writeFileSync('cardinal-recon-dump-v2.json', JSON.stringify(out, null, 2));
console.log('\n✓ Wrote cardinal-recon-dump-v2.json');

await conn.end();
