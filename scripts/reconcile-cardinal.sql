-- ============================================================================
-- Cardinal Skill Fee Reconciliation Helper
-- Run this in Sequel Ace against the rss_revenue (TiDB) database.
-- It produces 4 result sets in one go. Export each to CSV (or screenshot the
-- output panel) and send back so we can reconcile against the QuickBooks file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) Schema: which columns does daily_cabinet_revenue actually have?
-- We need this to know the right column to sum for revenue.
-- ----------------------------------------------------------------------------
SELECT 'SECTION 1 — daily_cabinet_revenue schema' AS section;

SHOW COLUMNS FROM daily_cabinet_revenue;

-- ----------------------------------------------------------------------------
-- (2) Every venue our DB believes has Cardinal cabinets.
-- ----------------------------------------------------------------------------
SELECT 'SECTION 2 — venues with Cardinal cabinets per locations.cabinet_config_json' AS section;

SELECT location_id,
       location_name,
       location_type,
       location_status,
       cabinet_count,
       cabinet_config_json
  FROM locations
 WHERE LOWER(cabinet_config_json) LIKE '%cardinal%'
 ORDER BY location_type, location_name;

-- ----------------------------------------------------------------------------
-- (3) All distinct vendor values present in daily_cabinet_revenue.
-- Helps us know if 'cardinal' is even populated, or if rows are NULL/legacy.
-- ----------------------------------------------------------------------------
SELECT 'SECTION 3 — distinct vendor values in daily_cabinet_revenue' AS section;

SELECT vendor, COUNT(*) AS rows_count, MIN(report_date) AS earliest, MAX(report_date) AS latest
  FROM daily_cabinet_revenue
 GROUP BY vendor
 ORDER BY rows_count DESC;

-- ----------------------------------------------------------------------------
-- (4) Sample 5 rows of daily_cabinet_revenue so we see the actual column names
-- and value ranges.
-- ----------------------------------------------------------------------------
SELECT 'SECTION 4 — daily_cabinet_revenue sample rows' AS section;

SELECT *
  FROM daily_cabinet_revenue
 ORDER BY report_date DESC
 LIMIT 5;

-- ----------------------------------------------------------------------------
-- (5) Sanity check on Lucky Cosmos and Speakeasy — Excel shows them in both
-- "owned" AND once in "3rd party" sheets, which suggests miscoding somewhere.
-- ----------------------------------------------------------------------------
SELECT 'SECTION 5 — Cosmos / Speakeasy / Porter / Buchanan Dam location records' AS section;

SELECT location_id, location_name, location_type, location_status,
       collection_split_type, cabinet_count
  FROM locations
 WHERE location_name LIKE '%Cosmos%'
    OR location_name LIKE '%Speakeasy%'
    OR location_name LIKE '%Porter%'
    OR location_name LIKE '%Buchanan%'
    OR location_name LIKE '%Brady%';

-- ============================================================================
-- After this runs, if Section 1 reveals the actual revenue column name (likely
-- something like `gross_revenue`, `revenue`, `daily_total`, etc.), we'll write
-- a follow-up that sums per-venue per-quarter and computes expected 25% fees
-- to compare against the Cardinal bills in the QuickBooks export.
-- ============================================================================
