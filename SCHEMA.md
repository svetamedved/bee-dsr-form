# DSR Platform — Database Schema

**Database:** `rss_revenue` (TiDB Cloud, MySQL-compatible)
**Engine:** InnoDB, utf8mb4
**FK policy:** no DB-level foreign keys — referential integrity enforced in the app layer so migrations stay cheap against prod.

## Architecture at a glance

```
users ── (role) ──► admin / venue / collector
  │                         │
  │                     user_venues (M:N for collectors)
  │                         │
  ▼                         ▼
locations ─────────► submissions  (daily DSRs from company-owned venues)
        └──────────► collections  (per-visit reports from third-party venues)
                         │
                         ├─► submission_images  (photos of terminal tapes)
                         │
                         └─► daily_sales_summary / daily_revenue /
                             daily_cabinet_revenue  (populated on approval)
```

## Tables

### `locations`
All venues — both company-owned and third-party. Single source of truth.

| Column | Type | Notes |
|---|---|---|
| `location_id` | INT PK | auto-increment |
| `location_name` | VARCHAR(255) | |
| `location_status` | VARCHAR(50) | `active` / `inactive` |
| `location_type` | ENUM | `company_owned` (19 BEE venues) / `third_party` (68 RSS venues) |
| `collection_split_type` | ENUM NULL | `big_easy` / `percentage` — only for third-party |
| `split_percentage` | DECIMAL(5,2) NULL | e.g. 50.00 for 50/50 |
| `split_config_json` | LONGTEXT NULL | catchall for odd deals |
| `cabinet_count` | INT NULL | number of game cabinets |
| `cabinet_config_json` | LONGTEXT NULL | `[{label,type}]` per cabinet (Redplum / Cardinal) |
| `address_line1`, `city`, `state`, `zip_code` | | |
| `contact_name`, `contact_phone`, `contact_email` | | |
| `notes` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMP | |

### `users`
Auth. One row per login.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `email` | VARCHAR(255) UNIQUE | |
| `password_hash` | VARCHAR(255) | bcrypt |
| `name` | VARCHAR(255) | |
| `role` | ENUM | `admin` / `venue` / `collector` |
| `location_id` | INT NULL | single-venue pointer for `venue` role |
| `active` | TINYINT(1) | |
| `must_change_password` | TINYINT(1) | force reset on first login |
| `created_at`, `last_login_at` | TIMESTAMP | |

### `user_venues`
M:N join table — collectors can be assigned to many third-party venues.

| Column | Type | Notes |
|---|---|---|
| `user_id` | INT | PK part 1 |
| `location_id` | INT | PK part 2 |
| `assigned_at` | TIMESTAMP | |
| `assigned_by` | INT NULL | admin user_id who made the assignment |

### `submissions`
One row per DSR (Daily Sales Report) from a company-owned venue. Unique on `(location_id, report_date)` — one DSR per venue per day.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `location_id` | INT | |
| `user_id` | INT | submitter |
| `report_date` | DATE | |
| `status` | ENUM | `pending` / `approved` / `rejected` |
| `payload` | LONGTEXT | full form JSON |
| `iif_content` | LONGTEXT NULL | QuickBooks IIF, generated on approval |
| `admin_notes` | TEXT NULL | rejection reason visible to submitter |
| `submitted_at`, `reviewed_at`, `updated_at` | TIMESTAMP | |
| `reviewed_by` | INT NULL | admin user_id |

### `collections`
One row per collector visit to a third-party venue. Same status flow as submissions, different payload shape (cabinet CRT counts, bill breakdown, Big Easy waterfall tranches). **Not unique on (location, date)** — a collector can legitimately hit the same venue twice in a month.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `location_id` | INT | |
| `user_id` | INT | collector |
| `report_date` | DATE | |
| `status` | ENUM | `pending` / `approved` / `rejected` |
| `payload` | LONGTEXT | cabinet CRTs, bill counts, tranche state |
| `iif_content` | LONGTEXT NULL | different QB accounts from DSR IIF |
| `admin_notes` | TEXT NULL | |
| `submitted_at`, `reviewed_at`, `updated_at` | TIMESTAMP | |
| `reviewed_by` | INT NULL | |

### `submission_images`
Photos of terminal/POS tapes that accompany a DSR. Bytes stored in-row as `LONGBLOB` (TiDB-friendly, no object store needed). OCR pipeline fills `parsed_json` used to auto-populate the form.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `submission_id` | INT NULL | linked after submission row exists |
| `user_id` | INT | uploader |
| `location_id`, `report_date` | | scoping before link |
| `report_type` | VARCHAR(50) | e.g. `redplum_terminal` |
| `filename`, `mime_type`, `byte_size` | | |
| `image_bytes` | LONGBLOB | |
| `sha256` | CHAR(64) NULL | dedup — `(user_id, report_date, sha256)` index |
| `ocr_status` | ENUM | `pending` / `processing` / `parsed` / `failed` |
| `ocr_raw`, `parsed_json`, `ocr_error` | LONGTEXT / TEXT | |
| `created_at` | TIMESTAMP | |

### `daily_sales_summary`
Non-game-revenue fields from the DSR (bar/kitchen/retail sales, taxes, tips, deposits). Populated **only on approval** — acts as the clean, query-ready warehouse table. Unique on `(location, report_date)`.

27 numeric columns covering net sales, credit cards, non-cash fees, GC redemptions/conversions, skill deposits, tips, taxes, etc.

### `daily_revenue` & `daily_cabinet_revenue` *(pre-existing)*
Legacy game-revenue tables. Schema augmented with:
- `submission_id` (links back to the approved submission that populated the row)
- `vendor` on `daily_cabinet_revenue` (Redplum / Cardinal)

## Status lifecycle (submissions & collections)

```
  pending ──► approved  (IIF generated, warehouse tables populated)
     │
     └─────► rejected   (admin_notes populated, submitter can resubmit)
```

## Monthly clean-slate rule (Big Easy waterfall)

For `location_type='third_party'` + `collection_split_type='big_easy'`, each calendar month is independent:

1. First $2,500 of net cash → 100% Big Easy
2. Next $2,500 → 100% Location
3. Remainder → percentage split (default 50/50)

Unpaid tranche balance at month-end is dropped on the 1st — enforced by `GET /api/collections/prior?location_id=X&month=YYYY-MM`, which sums `to_t1` / `to_t2` across that month's pending+approved collections only.

## Seeded data

- **19 company-owned venues** (BES sites, Icehouse SA, Lucky Cosmos Buda, etc.) — `INSERT IGNORE`.
- **68 third-party (RSS) venues** — `INSERT IGNORE`, pulled from live rss_revenue on 2026-04-22.
- **4 pre-configured third-party venues:** Buc's Bar & Grill, The Ready Room, Lucky Dragon, Kathy's — split type + cabinet config set from analyzed Monday.com exports.

## Files

- `schema.sql` — idempotent, full schema. Safe to re-run against any state.
- `schema-prod-migration.sql` — prod-only delta for the existing `rss_revenue` DB that already had `daily_revenue` / `daily_cabinet_revenue`.
