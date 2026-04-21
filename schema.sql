-- =====================================================================
-- DSR Platform schema — ADDITIVE MIGRATION
-- Safe to run on an existing rss_revenue database that already contains:
--   locations (PK: location_id), daily_revenue, daily_cabinet_revenue,
--   machines, revenue_records, etc.
-- This script only ADDS the auth/workflow tables and augments the two
-- revenue tables with a submission_id column so approved DSRs can be
-- linked back to the submission row.
-- Safe to re-run; every statement is idempotent.
-- =====================================================================

-- -------------------------------------------------
-- USERS: admins + one account per venue (venues reference locations.location_id)
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
  CONSTRAINT fk_users_location FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE SET NULL,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- SUBMISSIONS: one row per DSR submission.
-- Full JSON payload + status + review metadata.
-- Revenue tables are only written on approval.
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
  CONSTRAINT fk_sub_location FOREIGN KEY (location_id) REFERENCES locations(location_id),
  CONSTRAINT fk_sub_user     FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_sub_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_location_date (location_id, report_date),
  INDEX idx_sub_status (status),
  INDEX idx_sub_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- Augment existing revenue tables with a link back to the submission.
-- MySQL proper doesn't support `IF NOT EXISTS` on ADD COLUMN (that's a
-- MariaDB extension), so we do conditional ALTERs via prepared statements.
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

-- -------------------------------------------------
-- daily_sales_summary: holds the non-game-revenue DSR fields
-- (bar/kitchen/retail sales, taxes, tips, deposits, etc.) that the
-- existing revenue tables don't cover. Populated on approval.
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
-- NOTE: the `locations` table already exists (PK: location_id) and
-- is seeded with your 19 venues. This script does NOT touch it.
-- -------------------------------------------------
