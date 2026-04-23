-- =====================================================================
-- DSR Platform schema — IDEMPOTENT, FK-FREE MIGRATION
-- Safe to run against any state of the rss_revenue DB (empty, partial,
-- or fully populated). Creates the auth/workflow tables, ensures a
-- `locations` table exists (even if empty), and augments the existing
-- daily_revenue / daily_cabinet_revenue tables with submission_id +
-- vendor so approved DSRs can be linked back to submissions.
-- Re-runnable: every CREATE is IF NOT EXISTS, every ALTER is conditional.
--
-- FKs are intentionally omitted. Referential integrity is enforced in
-- the application layer; keeping the DB FK-free avoids brittleness when
-- the parent table's state is uncertain (e.g. fresh prod, staging clone).
-- =====================================================================

-- -------------------------------------------------
-- LOCATIONS: venues. Minimal shape; admin UI seeds/edits rows.
-- Created IF NOT EXISTS so existing fully-populated locations tables
-- (local dev / legacy) are left untouched.
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  location_id INT AUTO_INCREMENT PRIMARY KEY,
  location_name VARCHAR(255) NOT NULL,
  location_status VARCHAR(50) DEFAULT 'active',
  address_line1 VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(50) NULL,
  zip_code VARCHAR(20) NULL,
  contact_name VARCHAR(255) NULL,
  contact_phone VARCHAR(50) NULL,
  contact_email VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loc_name (location_name),
  INDEX idx_loc_status (location_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- USERS: admins + one account per venue.
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role ENUM('admin','venue') NOT NULL DEFAULT 'venue',
  location_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  INDEX idx_users_role (role),
  INDEX idx_users_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- SUBMISSIONS: one row per DSR submission.
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NOT NULL,
  user_id INT NOT NULL,
  report_date DATE NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  payload LONGTEXT NOT NULL,
  iif_content LONGTEXT NULL,
  admin_notes TEXT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_location_date (location_id, report_date),
  INDEX idx_sub_status (status),
  INDEX idx_sub_date (report_date),
  INDEX idx_sub_location (location_id),
  INDEX idx_sub_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- SUBMISSION_IMAGES: photos of terminal/POS reports uploaded alongside
-- a DSR. Bytes stored directly in TiDB (LONGBLOB). Each image can be
-- linked to a submission once it exists; until then images are tied to
-- the uploader via user_id so drafts can accumulate photos before the
-- submission row is created.
--
-- OCR results land in parsed_json (the structured field extraction used
-- to auto-fill the form) and ocr_raw (full model output for debugging).
-- status tracks the async pipeline: pending -> processing -> parsed|failed.
-- -------------------------------------------------
-- Base table. sha256 + idx_si_dedup are added by conditional ALTERs below so
-- that CREATE TABLE IF NOT EXISTS doesn't reference columns that may not
-- exist in pre-existing installs (TiDB validates the new index definition
-- against the existing table even when it skips the CREATE).
CREATE TABLE IF NOT EXISTS submission_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NULL,
  user_id INT NOT NULL,
  location_id INT NULL,
  report_date DATE NULL,
  report_type VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  byte_size INT NOT NULL DEFAULT 0,
  image_bytes LONGBLOB NOT NULL,
  ocr_status ENUM('pending','processing','parsed','failed') NOT NULL DEFAULT 'pending',
  ocr_raw LONGTEXT NULL,
  parsed_json LONGTEXT NULL,
  ocr_error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_si_submission (submission_id),
  INDEX idx_si_user (user_id),
  INDEX idx_si_status (ocr_status),
  INDEX idx_si_loc_date (location_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add sha256 column (used for duplicate-photo detection).
SET @has_sha := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission_images' AND COLUMN_NAME='sha256');
SET @sql := IF(@has_sha=0,
  'ALTER TABLE submission_images ADD COLUMN sha256 CHAR(64) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add idx_si_dedup (depends on sha256 existing).
SET @has_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission_images' AND INDEX_NAME='idx_si_dedup');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE submission_images ADD INDEX idx_si_dedup (user_id, report_date, sha256)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- THIRD-PARTY VENUES — extend `locations` with collection-platform columns
-- =====================================================================
-- The 19 existing venues are company-owned and fill out the full DSR daily.
-- Third-party venues are visited by "collectors" who fill a simpler collection
-- form. Both types live in `locations` (single source of truth); `location_type`
-- distinguishes them. collection_split_type + split_percentage configure how
-- the collected cash is split with the location for third-party venues.
-- split_config_json is a catchall for venue-specific overrides when the two
-- standard split types don't fit (one-off payment terms, multi-tier waterfalls,
-- etc.) — keeps schema migrations cheap when a new oddball venue signs on.

-- locations.location_type
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='location_type');
SET @sql := IF(@has_col=0,
  "ALTER TABLE locations ADD COLUMN location_type ENUM('company_owned','third_party') NOT NULL DEFAULT 'company_owned' AFTER location_status",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- locations.collection_split_type
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='collection_split_type');
SET @sql := IF(@has_col=0,
  "ALTER TABLE locations ADD COLUMN collection_split_type ENUM('big_easy','percentage') NULL AFTER location_type",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- locations.split_percentage (e.g., 50.00 for a 50/50 split)
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='split_percentage');
SET @sql := IF(@has_col=0,
  'ALTER TABLE locations ADD COLUMN split_percentage DECIMAL(5,2) NULL AFTER collection_split_type',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- locations.split_config_json (venue-specific overrides)
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='split_config_json');
SET @sql := IF(@has_col=0,
  'ALTER TABLE locations ADD COLUMN split_config_json LONGTEXT NULL AFTER split_percentage',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- locations.cabinet_count — number of game cabinets at the venue, used to
-- render the right number of rows on the collection form.
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='cabinet_count');
SET @sql := IF(@has_col=0,
  'ALTER TABLE locations ADD COLUMN cabinet_count INT NULL AFTER split_config_json',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- locations.cabinet_config_json — JSON array describing each cabinet, e.g.
-- [{"label":"1","type":"redplum"},{"label":"2","type":"cardinal"}]. Keeps
-- mixed-cabinet venues (e.g., Lucky Dragon: 10 Redplum + 12 Cardinal) in one
-- column without a separate cabinets table.
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='cabinet_config_json');
SET @sql := IF(@has_col=0,
  'ALTER TABLE locations ADD COLUMN cabinet_config_json LONGTEXT NULL AFTER cabinet_count',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_loc_type for fast filtering of company vs third-party venues
SET @has_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND INDEX_NAME='idx_loc_type');
SET @sql := IF(@has_idx=0,
  'ALTER TABLE locations ADD INDEX idx_loc_type (location_type)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed the 19 company-owned venues idempotently (skipped if name already exists).
INSERT IGNORE INTO locations (location_name, location_status, location_type) VALUES
  ('BE Station Brady',         'active', 'company_owned'),
  ('BES 2 Rockport',           'active', 'company_owned'),
  ('BES 4 Kingsbury',          'active', 'company_owned'),
  ('BES 6 Buchanan Dam',       'active', 'company_owned'),
  ('BES 7 San Antonio',        'active', 'company_owned'),
  ('BES 8 Pflugerville',       'active', 'company_owned'),
  ('BES 10 - Crossroads Robstown', 'active', 'company_owned'),
  ('BES Giddings',             'active', 'company_owned'),
  ('Icehouse in SA',           'active', 'company_owned'),
  ('Lucky Cosmos Buda',        'active', 'company_owned'),
  ('MT 4 Corsicana',           'active', 'company_owned'),
  ('MT 5 Conroe',              'active', 'company_owned'),
  ('Music City',               'active', 'company_owned'),
  ('My Office Club',           'active', 'company_owned'),
  ('Skillzone 1 Porter',       'active', 'company_owned'),
  ('Skillzone 2 Mt Pleasant',  'active', 'company_owned'),
  ('Speakeasy Lakeway',        'active', 'company_owned'),
  ('Starlite Saloon',          'active', 'company_owned'),
  ('Whiskey Room',             'active', 'company_owned');

-- For any existing rows missing location_type (pre-migration installs), mark
-- them company_owned so nothing shows up as third-party by accident.
UPDATE locations SET location_type='company_owned' WHERE location_type IS NULL;

-- =====================================================================
-- COLLECTOR ROLE + user_venues assignment
-- =====================================================================
-- A collector visits many third-party venues. users.location_id is the
-- single-venue pointer used by GMs at company-owned locations; for collectors,
-- assignments live in user_venues (many-to-many). Both can coexist: a user
-- with role='collector' ignores location_id and uses user_venues; a user
-- with role='venue' uses location_id and ignores user_venues.

-- users.role: extend enum to include 'collector'. Must MODIFY the column type.
SET @cur_enum := (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role');
SET @sql := IF(@cur_enum LIKE '%collector%',
  'SELECT 1',
  "ALTER TABLE users MODIFY COLUMN role ENUM('admin','venue','collector') NOT NULL DEFAULT 'venue'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- user_venues: join table for collector-to-location assignments.
CREATE TABLE IF NOT EXISTS user_venues (
  user_id     INT NOT NULL,
  location_id INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INT NULL,
  PRIMARY KEY (user_id, location_id),
  INDEX idx_uv_user (user_id),
  INDEX idx_uv_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- COLLECTIONS — one row per collector visit to a third-party venue
-- =====================================================================
-- Parallels `submissions` for DSRs but with its own payload shape. Status
-- flow is identical (pending -> approved/rejected). Approved collections
-- produce their own IIF export format (different QuickBooks accounts).
CREATE TABLE IF NOT EXISTS collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NOT NULL,
  user_id INT NOT NULL,
  report_date DATE NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  payload LONGTEXT NOT NULL,
  iif_content LONGTEXT NULL,
  admin_notes TEXT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_col_status (status),
  INDEX idx_col_date (report_date),
  INDEX idx_col_location (location_id),
  INDEX idx_col_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- daily_sales_summary: holds the non-game-revenue DSR fields
-- (bar/kitchen/retail sales, taxes, tips, deposits, etc.). Populated
-- when a submission is approved.
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_sales_summary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NULL,
  location VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  manager VARCHAR(255),
  sales_bar DECIMAL(12,2) DEFAULT 0,
  sales_kitchen DECIMAL(12,2) DEFAULT 0,
  sales_retail DECIMAL(12,2) DEFAULT 0,
  sales_gc DECIMAL(12,2) DEFAULT 0,
  sales_comps DECIMAL(12,2) DEFAULT 0,
  sales_discounts DECIMAL(12,2) DEFAULT 0,
  sales_spills DECIMAL(12,2) DEFAULT 0,
  sales_ep_card DECIMAL(12,2) DEFAULT 0,
  sales_ep_credits DECIMAL(12,2) DEFAULT 0,
  net_sales DECIMAL(12,2) DEFAULT 0,
  credit_cards DECIMAL(12,2) DEFAULT 0,
  bar_credit_cards DECIMAL(12,2) DEFAULT 0,
  non_cash_fees DECIMAL(12,2) DEFAULT 0,
  taxes DECIMAL(12,2) DEFAULT 0,
  tips DECIMAL(12,2) DEFAULT 0,
  recoveries DECIMAL(12,2) DEFAULT 0,
  gc_redemptions DECIMAL(12,2) DEFAULT 0,
  gc_conversions DECIMAL(12,2) DEFAULT 0,
  pool_drop DECIMAL(12,2) DEFAULT 0,
  actual_gc_deposit DECIMAL(12,2) DEFAULT 0,
  skill_deposit DECIMAL(12,2) DEFAULT 0,
  total_cash_deposit DECIMAL(12,2) DEFAULT 0,
  total_deposit DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_dss_loc_date (location, report_date),
  INDEX idx_dss_submission (submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- Conditional ALTERs on existing revenue tables.
-- MySQL/TiDB don't support ADD COLUMN IF NOT EXISTS, so we check
-- INFORMATION_SCHEMA first and build the ALTER dynamically.
-- Each block is a no-op if the column/index already exists.
-- -------------------------------------------------

-- daily_revenue.submission_id
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_revenue' AND COLUMN_NAME = 'submission_id');
SET @sql := IF(@has_col = 0, 'ALTER TABLE daily_revenue ADD COLUMN submission_id INT NULL AFTER id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- daily_revenue.idx_dr_submission
SET @has_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_revenue' AND INDEX_NAME = 'idx_dr_submission');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE daily_revenue ADD INDEX idx_dr_submission (submission_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- daily_cabinet_revenue.submission_id
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_cabinet_revenue' AND COLUMN_NAME = 'submission_id');
SET @sql := IF(@has_col = 0, 'ALTER TABLE daily_cabinet_revenue ADD COLUMN submission_id INT NULL AFTER id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- daily_cabinet_revenue.vendor
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_cabinet_revenue' AND COLUMN_NAME = 'vendor');
SET @sql := IF(@has_col = 0, 'ALTER TABLE daily_cabinet_revenue ADD COLUMN vendor VARCHAR(100) NULL AFTER report_date', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- daily_cabinet_revenue.idx_dcr_submission
SET @has_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_cabinet_revenue' AND INDEX_NAME = 'idx_dcr_submission');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE daily_cabinet_revenue ADD INDEX idx_dcr_submission (submission_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
