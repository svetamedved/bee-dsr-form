// =====================================================================
// DSR Platform API
// Auth (JWT) + admin-gated approval workflow + QuickBooks IIF export.
//
// Revenue tables (daily_revenue, daily_cabinet_revenue, daily_sales_summary)
// are ONLY populated when an admin approves a submission.
// =====================================================================
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_TTL    = process.env.JWT_TTL    || '12h';

const dbConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'rss_revenue',
  waitForConnections: true,
  connectionLimit: 10,
};
if (process.env.DB_SSL === 'true') dbConfig.ssl = { rejectUnauthorized: true };
const pool = mysql.createPool(dbConfig);

// ---------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function getLocationName(id) {
  if (!id) return null;
  const [rows] = await pool.execute('SELECT location_name FROM locations WHERE location_id=?', [id]);
  return rows[0]?.location_name || null;
}
function toNum(x) { return Number(x) || 0; }

// Format YYYY-MM-DD -> MM/DD/YYYY for IIF
function formatIIFDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-');
  return `${m}/${d}/${y}`;
}

// Build the QuickBooks IIF from a submission payload.
// Kept in lockstep with the original client-side logic in App.jsx so the
// export on approval matches what the venue saw at submit time.
function buildIIF(payload, locationName) {
  const d   = payload;
  const loc = locationName || d.location || 'Unknown';
  const dt  = formatIIFDate(d.report_date);
  const L   = [];

  L.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  L.push('!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  L.push('!ENDTRNS');

  const gcDeposit = toNum(d.actual_gc_deposit);
  if (gcDeposit) {
    L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${gcDeposit.toFixed(2)}\tGC Deposit - ${loc}`);
    L.push(`SPL\tDEPOSIT\t${dt}\tSweepstakes Revenue\t\t${loc}\t${(-gcDeposit).toFixed(2)}\tGC Deposit`);
    L.push('ENDTRNS');
  }
  const skillDep = toNum(d.skill_deposit);
  if (skillDep) {
    L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${skillDep.toFixed(2)}\tSkill Deposit - ${loc}`);
    L.push(`SPL\tDEPOSIT\t${dt}\tSkill Game Revenue\t\t${loc}\t${(-skillDep).toFixed(2)}\tSkill Deposit`);
    L.push('ENDTRNS');
  }
  const bar = toNum(d.sales_bar), kitchen = toNum(d.sales_kitchen);
  if (bar || kitchen) {
    const tcd = toNum(d.total_cash_deposit) || (bar + kitchen);
    L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${tcd.toFixed(2)}\tCash Deposit - ${loc}`);
    if (bar)     L.push(`SPL\tDEPOSIT\t${dt}\tBar Sales\t\t${loc}\t${(-bar).toFixed(2)}\tBar Sales`);
    if (kitchen) L.push(`SPL\tDEPOSIT\t${dt}\tKitchen Sales\t\t${loc}\t${(-kitchen).toFixed(2)}\tKitchen Sales`);
    const ccTotal = toNum(d.total_credit_cards) + toNum(d.bar_credit_cards);
    if (ccTotal)       L.push(`SPL\tDEPOSIT\t${dt}\tCredit Card Clearing\t\t${loc}\t${ccTotal.toFixed(2)}\tCredit Cards`);
    if (toNum(d.sales_comps)) L.push(`SPL\tDEPOSIT\t${dt}\tComps Expense\t\t${loc}\t${toNum(d.sales_comps).toFixed(2)}\tComps`);
    if (toNum(d.total_taxes)) L.push(`SPL\tDEPOSIT\t${dt}\tSales Tax Payable\t\t${loc}\t${(-toNum(d.total_taxes)).toFixed(2)}\tTaxes`);
    if (toNum(d.total_tips))  L.push(`SPL\tDEPOSIT\t${dt}\tTips Payable\t\t${loc}\t${(-toNum(d.total_tips)).toFixed(2)}\tTips`);
    L.push('ENDTRNS');
  }
  const epTotal = toNum(d.ep_total);
  if (epTotal) {
    L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${epTotal.toFixed(2)}\tCOAMs - ${loc}`);
    L.push(`SPL\tDEPOSIT\t${dt}\tCOAM Revenue\t\t${loc}\t${(-epTotal).toFixed(2)}\tCOAMs`);
    L.push('ENDTRNS');
  }
  return L.join('\r\n') + '\r\n';
}

// Write the approval records into daily_revenue / daily_cabinet_revenue /
// daily_sales_summary. Called only from the approval handler inside a transaction.
async function materializeSubmission(conn, submission, payload, locationName) {
  const d   = payload;
  const loc = locationName;

  // Wipe any prior approved rows for this submission (re-approval safety)
  await conn.execute('DELETE FROM daily_revenue         WHERE submission_id=?', [submission.id]);
  await conn.execute('DELETE FROM daily_cabinet_revenue WHERE submission_id=?', [submission.id]);
  await conn.execute('DELETE FROM daily_sales_summary   WHERE submission_id=?', [submission.id]);

  const vendors = [
    { name: 'Maverick',      type: 'sweepstakes', i: toNum(d.maverick_in),      o: toNum(d.maverick_out) },
    { name: 'Rimfire',       type: 'sweepstakes', i: toNum(d.rimfire_in),       o: toNum(d.rimfire_out) },
    { name: 'Riversweep',    type: 'sweepstakes', i: toNum(d.riversweep_in),    o: toNum(d.riversweep_out) },
    { name: 'Golden Dragon', type: 'sweepstakes', i: toNum(d.golden_dragon_in), o: toNum(d.golden_dragon_out) },
  ];
  // daily_revenue.game_type ENUM is ('sweepstakes','skill','coam') — COAMs get their own class.
  if (toNum(d.ep_total)) vendors.push({ name: 'COAMs', type: 'coam', i: toNum(d.ep_total), o: 0 });
  if (toNum(d.cardinal_in) || toNum(d.cardinal_out)) vendors.push({ name: 'Cardinal Xpress', type: 'skill', i: toNum(d.cardinal_in), o: toNum(d.cardinal_out) });
  if (toNum(d.redplum_in)  || toNum(d.redplum_out))  vendors.push({ name: 'Red Plum',        type: 'skill', i: toNum(d.redplum_in),  o: toNum(d.redplum_out) });

  for (const v of vendors) {
    if (!v.i && !v.o) continue;
    await conn.execute(
      `INSERT INTO daily_revenue (submission_id, location, report_date, manager, vendor_name, game_type, total_in, total_out, net_revenue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [submission.id, loc, d.report_date, d.manager || null, v.name, v.type, v.i, v.o, v.i - v.o]
    );
  }

  const insertCabs = async (vendor, cabs) => {
    for (const cab of (cabs || [])) {
      if (!toNum(cab.in) && !toNum(cab.out)) continue;
      await conn.execute(
        `INSERT INTO daily_cabinet_revenue (submission_id, location, report_date, vendor, cabinet_name, terminal_id, serial_num, total_in, total_out, net_revenue, skill_deposit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [submission.id, loc, d.report_date, vendor, cab.name || null, cab.tid || null, cab.serial || null,
         toNum(cab.in), toNum(cab.out), toNum(cab.in) - toNum(cab.out), toNum(d.skill_deposit)]
      );
    }
  };
  await insertCabs('Cardinal', d.cardinal_cabinets);
  await insertCabs('Red Plum', d.redplum_cabinets);

  await conn.execute(
    `INSERT INTO daily_sales_summary
      (submission_id, location, report_date, manager,
       sales_bar, sales_kitchen, sales_retail, sales_gc, sales_comps, sales_discounts, sales_spills,
       sales_ep_card, sales_ep_credits, net_sales,
       credit_cards, bar_credit_cards, non_cash_fees, taxes, tips,
       recoveries, gc_redemptions, gc_conversions, pool_drop,
       actual_gc_deposit, skill_deposit, total_cash_deposit, total_deposit, notes)
     VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       submission_id=VALUES(submission_id), manager=VALUES(manager),
       sales_bar=VALUES(sales_bar), sales_kitchen=VALUES(sales_kitchen),
       sales_retail=VALUES(sales_retail), sales_gc=VALUES(sales_gc),
       sales_comps=VALUES(sales_comps), sales_discounts=VALUES(sales_discounts),
       sales_spills=VALUES(sales_spills), sales_ep_card=VALUES(sales_ep_card),
       sales_ep_credits=VALUES(sales_ep_credits), net_sales=VALUES(net_sales),
       credit_cards=VALUES(credit_cards), bar_credit_cards=VALUES(bar_credit_cards),
       non_cash_fees=VALUES(non_cash_fees), taxes=VALUES(taxes), tips=VALUES(tips),
       recoveries=VALUES(recoveries), gc_redemptions=VALUES(gc_redemptions),
       gc_conversions=VALUES(gc_conversions), pool_drop=VALUES(pool_drop),
       actual_gc_deposit=VALUES(actual_gc_deposit), skill_deposit=VALUES(skill_deposit),
       total_cash_deposit=VALUES(total_cash_deposit), total_deposit=VALUES(total_deposit),
       notes=VALUES(notes)`,
    [
      submission.id, loc, d.report_date, d.manager || null,
      toNum(d.sales_bar), toNum(d.sales_kitchen), toNum(d.sales_retail), toNum(d.sales_gc),
      toNum(d.sales_comps), toNum(d.sales_discounts), toNum(d.sales_spills),
      toNum(d.sales_ep_card), toNum(d.sales_ep_credits), toNum(d.net_sales),
      toNum(d.total_credit_cards), toNum(d.bar_credit_cards), toNum(d.non_cash_fees),
      toNum(d.total_taxes), toNum(d.total_tips),
      toNum(d.recoveries), toNum(d.gc_redemptions), toNum(d.gc_conversions), toNum(d.pool_drop),
      toNum(d.actual_gc_deposit), toNum(d.skill_deposit), toNum(d.total_cash_deposit), toNum(d.total_deposit),
      d.notes || null,
    ]
  );
}

// =====================================================================
// AUTH
// =====================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
    const [rows] = await pool.execute(
      `SELECT u.*, l.location_name AS location_name
       FROM users u LEFT JOIN locations l ON l.location_id = u.location_id
       WHERE u.email=? AND u.active=1`,
      [email.toLowerCase().trim()]
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    await pool.execute('UPDATE users SET last_login_at=NOW() WHERE id=?', [u.id]);
    const token = jwt.sign(
      { id: u.id, email: u.email, role: u.role, location_id: u.location_id },
      JWT_SECRET, { expiresIn: JWT_TTL }
    );
    res.json({
      token,
      user: {
        id: u.id, email: u.email, name: u.name,
        role: u.role, location_id: u.location_id,
        location_name: u.location_name,
        must_change_password: !!u.must_change_password,
      },
    });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.location_id, u.must_change_password, l.location_name AS location_name
     FROM users u LEFT JOIN locations l ON l.location_id = u.location_id WHERE u.id=?`,
    [req.user.id]
  );
  res.json({ user: rows[0] });
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(current_password || '', rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [hash, req.user.id]);
  res.json({ success: true });
});

// =====================================================================
// LOCATIONS
// =====================================================================
app.get('/api/locations', authRequired, async (req, res) => {
  // Map the existing DB's location_id/location_name to {id,name} for the frontend.
  const [rows] = await pool.execute(
    `SELECT location_id AS id, location_name AS name, location_status
     FROM locations ORDER BY location_name`
  );
  res.json(rows);
});

// =====================================================================
// ADMIN — User management
// =====================================================================
app.get('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.location_id, u.last_login_at, l.location_name AS location_name
     FROM users u LEFT JOIN locations l ON l.location_id = u.location_id
     ORDER BY u.role DESC, u.email`
  );
  res.json(rows);
});

app.post('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  try {
    const { email, name, password, role, location_id } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (!['admin','venue'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (role === 'venue' && !location_id) return res.status(400).json({ error: 'venue accounts need a location_id' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.execute(
      `INSERT INTO users (email, name, password_hash, role, location_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [email.toLowerCase().trim(), name || null, hash, role, role === 'venue' ? location_id : null]
    );
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email already exists' });
    console.error(e); res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  const { active, name, location_id, reset_password } = req.body || {};
  const sets = [], vals = [];
  if (active   !== undefined) { sets.push('active=?');      vals.push(active ? 1 : 0); }
  if (name     !== undefined) { sets.push('name=?');        vals.push(name); }
  if (location_id !== undefined) { sets.push('location_id=?'); vals.push(location_id); }
  if (reset_password) {
    const hash = await bcrypt.hash(reset_password, 10);
    sets.push('password_hash=?', 'must_change_password=1'); vals.push(hash);
  }
  if (!sets.length) return res.json({ success: true });
  vals.push(req.params.id);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, vals);
  res.json({ success: true });
});

// =====================================================================
// SUBMISSIONS — venue side
// =====================================================================

// Venue submits (or resubmits) their DSR. Stays in 'pending' until admin approves.
app.post('/api/submissions', authRequired, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.report_date) return res.status(400).json({ error: 'report_date required' });

    // Venue users may only submit for their own location.
    let locationId = payload.location_id;
    if (req.user.role === 'venue') {
      if (!req.user.location_id) return res.status(403).json({ error: 'No location assigned' });
      locationId = req.user.location_id;
    } else {
      // Admins can submit on behalf of a location
      if (!locationId) return res.status(400).json({ error: 'location_id required' });
    }

    // If a pending or rejected submission already exists for this (location, date), update it.
    // If approved, reject with 409 (admin can un-approve manually if needed).
    const [existing] = await pool.execute(
      'SELECT id, status FROM submissions WHERE location_id=? AND report_date=?',
      [locationId, payload.report_date]
    );
    const loc = await getLocationName(locationId);
    const fullPayload = { ...payload, location: loc, location_id: locationId };

    if (existing.length) {
      const sub = existing[0];
      if (sub.status === 'approved') return res.status(409).json({ error: 'Already approved; contact admin' });
      await pool.execute(
        `UPDATE submissions
         SET user_id=?, status='pending', payload=?, admin_notes=NULL, reviewed_at=NULL, reviewed_by=NULL, submitted_at=NOW()
         WHERE id=?`,
        [req.user.id, JSON.stringify(fullPayload), sub.id]
      );
      return res.json({ id: sub.id, status: 'pending', resubmitted: true });
    }
    const [r] = await pool.execute(
      `INSERT INTO submissions (location_id, user_id, report_date, status, payload)
       VALUES (?, ?, ?, 'pending', ?)`,
      [locationId, req.user.id, payload.report_date, JSON.stringify(fullPayload)]
    );
    res.json({ id: r.insertId, status: 'pending' });
  } catch (e) {
    console.error('submit error', e);
    res.status(500).json({ error: e.message });
  }
});

// Venue: list my submissions (most recent first)
app.get('/api/submissions', authRequired, async (req, res) => {
  try {
    let sql, params;
    if (req.user.role === 'admin') {
      const status = req.query.status;
      sql = `SELECT s.id, s.report_date, s.status, s.submitted_at, s.reviewed_at, s.admin_notes,
                    l.location_name AS location_name, u.email AS submitter_email
             FROM submissions s
             JOIN locations l ON l.location_id=s.location_id
             JOIN users u ON u.id=s.user_id
             ${status ? 'WHERE s.status=?' : ''}
             ORDER BY s.submitted_at DESC LIMIT 500`;
      params = status ? [status] : [];
    } else {
      sql = `SELECT s.id, s.report_date, s.status, s.submitted_at, s.reviewed_at, s.admin_notes,
                    l.location_name AS location_name
             FROM submissions s JOIN locations l ON l.location_id=s.location_id
             WHERE s.location_id=?
             ORDER BY s.report_date DESC LIMIT 200`;
      params = [req.user.location_id];
    }
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// Get a single submission (including payload).
app.get('/api/submissions/:id', authRequired, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT s.*, l.location_name AS location_name, u.email AS submitter_email
     FROM submissions s JOIN locations l ON l.location_id=s.location_id JOIN users u ON u.id=s.user_id
     WHERE s.id=?`,
    [req.params.id]
  );
  const sub = rows[0];
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && sub.location_id !== req.user.location_id)
    return res.status(403).json({ error: 'Forbidden' });
  sub.payload = JSON.parse(sub.payload);
  res.json(sub);
});

// Fetch today's submission for the current venue (for prefilling the form).
app.get('/api/submissions/by-date/:date', authRequired, async (req, res) => {
  const locationId = req.user.role === 'venue'
    ? req.user.location_id
    : parseInt(req.query.location_id);
  if (!locationId) return res.status(400).json({ error: 'location_id required' });
  const [rows] = await pool.execute(
    `SELECT id, status, admin_notes, payload FROM submissions
     WHERE location_id=? AND report_date=?`,
    [locationId, req.params.date]
  );
  if (!rows[0]) return res.json(null);
  const r = rows[0];
  r.payload = JSON.parse(r.payload);
  res.json(r);
});

// =====================================================================
// ADMIN — approval workflow
// =====================================================================
app.post('/api/admin/submissions/:id/approve', authRequired, adminRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT s.*, l.location_name AS location_name FROM submissions s JOIN locations l ON l.location_id=s.location_id WHERE s.id=? FOR UPDATE`,
      [req.params.id]
    );
    const sub = rows[0];
    if (!sub) { await conn.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const payload = typeof sub.payload === 'string' ? JSON.parse(sub.payload) : sub.payload;
    await materializeSubmission(conn, sub, payload, sub.location_name);
    const iif = buildIIF(payload, sub.location_name);
    await conn.execute(
      `UPDATE submissions SET status='approved', reviewed_at=NOW(), reviewed_by=?, iif_content=?, admin_notes=?
       WHERE id=?`,
      [req.user.id, iif, req.body?.notes || null, sub.id]
    );
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error('approve error', e);
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/submissions/:id/reject', authRequired, adminRequired, async (req, res) => {
  const notes = (req.body?.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'Rejection note is required' });
  const [r] = await pool.execute(
    `UPDATE submissions SET status='rejected', reviewed_at=NOW(), reviewed_by=?, admin_notes=?
     WHERE id=? AND status='pending'`,
    [req.user.id, notes, req.params.id]
  );
  if (!r.affectedRows) return res.status(409).json({ error: 'Not pending or not found' });
  res.json({ success: true });
});

// Admin: download IIF for a single approved submission
app.get('/api/admin/submissions/:id/iif', authRequired, adminRequired, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT s.iif_content, s.report_date, l.location_name AS location_name
     FROM submissions s JOIN locations l ON l.location_id=s.location_id
     WHERE s.id=? AND s.status='approved'`,
    [req.params.id]
  );
  const sub = rows[0];
  if (!sub || !sub.iif_content) return res.status(404).json({ error: 'No approved IIF' });
  const fname = `DSR_${sub.location_name.replace(/\s+/g,'_')}_${sub.report_date.toISOString ? sub.report_date.toISOString().slice(0,10) : sub.report_date}.iif`;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(sub.iif_content);
});

// Admin: batch IIF for a date range (concatenated)
app.get('/api/admin/export/batch.iif', authRequired, adminRequired, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });
  const [rows] = await pool.execute(
    `SELECT s.iif_content FROM submissions s
     WHERE s.status='approved' AND s.report_date BETWEEN ? AND ?
     ORDER BY s.report_date, s.location_id`,
    [start, end]
  );
  if (!rows.length) return res.status(404).json({ error: 'No approved submissions in range' });
  // Emit header once, then strip headers from subsequent files
  const [first, ...rest] = rows.map(r => r.iif_content || '');
  let out = first;
  for (const body of rest) {
    const withoutHeader = body.split(/\r?\n/).filter(l => !l.startsWith('!')).join('\r\n');
    out += withoutHeader;
  }
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="DSR_batch_${start}_to_${end}.iif"`);
  res.send(out);
});

// =====================================================================
// Legacy summary endpoint (approved revenue rows)
// =====================================================================
app.get('/api/reports', authRequired, adminRequired, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT location, report_date, vendor_name, game_type, total_in, total_out, net_revenue
     FROM daily_revenue ORDER BY report_date DESC, location LIMIT 500`
  );
  res.json(rows);
});

// =====================================================================
// Frontend fallback (SPA)
// =====================================================================
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`DSR Platform running on port ${PORT}`));
