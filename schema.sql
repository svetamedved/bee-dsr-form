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
