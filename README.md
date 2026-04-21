# Bee DSR Platform

A daily-sales-report platform for multiple venues. Each location has its own login, submits their DSR daily, and an admin reviews and approves. On approval the revenue data is written to the database and a QuickBooks `.iif` file is generated for import.

## Features

- **Email + password authentication** (JWT, bcrypt)
- **Admin-provisioned accounts** — admins create venue logins one per location
- **Venue dashboard** — today's DSR form, submission history with status badges, rejection feedback, edit-and-resubmit
- **Admin dashboard** — pending queue, approve/reject-with-notes, user management, batch IIF export
- **Approval-gated writes** — revenue tables (`daily_revenue`, `daily_cabinet_revenue`, `daily_sales`) are only populated when a submission is approved
- **IIF export** — generated server-side at approval time, downloadable per submission or as a batch for any date range

## Stack

- Vite + React 19 (front-end)
- Express 5 + mysql2 + bcryptjs + jsonwebtoken (API)
- MySQL/MariaDB

## Setup

```bash
# 1. install deps
npm install

# 2. configure .env (see .env file)

# 3. run the schema (creates users, locations, submissions + seeds 19 locations)
mysql -u$DB_USER -p$DB_PASSWORD $DB_NAME < schema.sql

# 4. create the first admin
node scripts/create-admin.js admin@example.com "StrongAdminPassword!" "Admin"

# 5. start everything (dev)
npm run dev        # front-end (Vite, port 5173, proxies /api to :3001)
node server.js     # back-end (port 3001)

# 6. build for production
npm run build
node server.js     # serves the built front-end + API on $PORT
```

Log in at http://localhost:5173 with the admin credentials you set in step 4, then create venue accounts in the **Users** tab.

## Workflow

1. **Admin** signs in, creates a venue account from the Users tab (email + temp password + location).
2. Admin hands credentials to the venue manager. On first login the venue is forced to change their password.
3. **Venue** fills in the DSR form and clicks SUBMIT — the submission is saved as **pending**. Nothing is written to the revenue tables yet.
4. **Admin** reviews the pending queue. For each submission they can:
   - **Approve** — the payload is written to `daily_revenue`, `daily_cabinet_revenue`, `daily_sales`, and an IIF file is generated and stored on the submission.
   - **Reject with notes** — the venue sees the note on their dashboard, edits the report, and resubmits (status flips back to pending).
5. **Admin** downloads IIF files either per-submission (from the review screen) or in bulk (from the Exports tab, by date range) for QuickBooks import.

## Security notes

- Change `JWT_SECRET` in `.env` to a long random value before running in production (e.g. `openssl rand -hex 32`).
- Passwords are hashed with bcrypt (10 rounds).
- Venue accounts can only submit for their own location; the server enforces this regardless of what the client sends.
- The unique `(location_id, report_date)` index on `submissions` prevents duplicate reports.
