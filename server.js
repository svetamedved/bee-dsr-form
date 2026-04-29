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
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';

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
//
// A DSR day produces up to FOUR separate DEPOSIT transactions so each physical
// deposit slip can be reconciled independently in QuickBooks:
//
//   1. GC / FP (sweepstakes cash)     — from actual_gc_deposit
//   2. Skill vending                   — from skill_deposit
//   3. Semnox EP deposit               — from ep_deposit   (only when venue uses Semnox)
//   4. Union Sales deposit             — from sales_deposit (only when venue uses Union)
//
// When a venue has BOTH Semnox and Union (the BES 8 / MT Corsicana / MT Conroe case),
// entries 3 AND 4 are both emitted — one per physical deposit slip. That's what
// the accounting team asked for ("2 separate entries for 2 deposits").
//
// For backward compatibility with older submissions that predate the sem_/un_ fields,
// if those are missing we fall back to the legacy sales_bar/sales_kitchen logic.
function buildIIF(payload, locationName) {
  const d   = payload;
  const loc = locationName || d.location || 'Unknown';
  const dt  = formatIIFDate(d.report_date);
  const L   = [];

  L.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  L.push('!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  L.push('!ENDTRNS');

  // Helper: emit one DEPOSIT transaction + splits. Returns early if the deposit is 0
  // and none of the split amounts are non-zero.
  const writeDeposit = (amount, memo, splits) => {
    const hasSplits = splits.some(s => toNum(s.amount));
    if (!amount && !hasSplits) return;
    L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${amount.toFixed(2)}\t${memo}`);
    for (const s of splits) {
      const v = toNum(s.amount);
      if (v) L.push(`SPL\tDEPOSIT\t${dt}\t${s.accnt}\t\t${loc}\t${(-v).toFixed(2)}\t${s.memo || memo}`);
    }
    L.push('ENDTRNS');
  };

  // --- 1. GC / FP deposit ---
  const gcDeposit = toNum(d.actual_gc_deposit);
  writeDeposit(gcDeposit, `GC Deposit - ${loc}`, [
    { accnt: 'Sweepstakes Revenue', amount: gcDeposit, memo: 'GC Deposit' },
  ]);

  // --- 2. Skill vending deposit ---
  const skillDep = toNum(d.skill_deposit);
  writeDeposit(skillDep, `Skill Deposit - ${loc}`, [
    { accnt: 'Skill Game Revenue', amount: skillDep, memo: 'Skill Deposit' },
  ]);

  // --- 3. Semnox EP deposit ---
  // Prefer explicit ep_deposit; fall back to ep_total for submissions predating the refactor.
  const epDep  = toNum(d.ep_deposit);
  const hasSem = epDep || toNum(d.sem_ep_card) || toNum(d.sem_arcade_credits)
              || toNum(d.sem_arcade_time) || toNum(d.sem_gc_cert_sales);
  if (hasSem) {
    writeDeposit(epDep || toNum(d.sem_deposit_hint), `EP Deposit - ${loc}`, [
      { accnt: 'Easy Play Card Sales',        amount:  toNum(d.sem_ep_card),            memo: 'Easy Play Card' },
      { accnt: 'Easy Play Credits',           amount:  toNum(d.sem_arcade_credits),     memo: 'Easy Play Credits' },
      { accnt: 'Arcade Time Revenue',         amount:  toNum(d.sem_arcade_time),        memo: 'Arcade Time' },
      { accnt: 'Gift Certificate Sales',      amount:  toNum(d.sem_gc_cert_sales),      memo: 'Gift Certificate Sales' },
      { accnt: 'Sales Comps',                 amount: -toNum(d.sem_comps),              memo: 'Comps (contra)' },
      { accnt: 'Sales Discounts',             amount: -toNum(d.sem_discounts),          memo: 'Discounts (contra)' },
      { accnt: 'Sales Tax Payable',           amount:  toNum(d.sem_taxes),              memo: 'Taxes' },
      { accnt: 'Tips Payable',                amount:  toNum(d.sem_tips),               memo: 'Tips' },
      { accnt: 'Credit Card Clearing',        amount: -toNum(d.sem_credit_cards),       memo: 'Semnox CC (contra)' },
      { accnt: 'Credit Card Fees',            amount:  toNum(d.sem_cc_fees),            memo: 'Semnox CC Fees' },
      { accnt: 'Gift Certificate Redemptions', amount:  toNum(d.sem_gc_cert_redemptions), memo: 'GC Cert Redemptions' },
      { accnt: 'Gift Certificate Conversions', amount: -toNum(d.sem_gc_cert_conversions), memo: 'GC Cert Conversions (contra)' },
    ]);
  } else if (toNum(d.ep_total)) {
    // Legacy: older submissions only had ep_total on the Semnox COAMs block
    writeDeposit(toNum(d.ep_total), `COAMs - ${loc}`, [
      { accnt: 'COAM Revenue', amount: toNum(d.ep_total), memo: 'COAMs' },
    ]);
  }

  // --- 4. Union Sales deposit ---
  // Prefer explicit sales_deposit; fall back to the old total_cash_deposit for legacy payloads.
  const salesDep = toNum(d.sales_deposit);
  const hasUn = salesDep || toNum(d.un_bar) || toNum(d.un_kitchen)
             || toNum(d.un_retail) || toNum(d.un_gc_activations);
  if (hasUn) {
    writeDeposit(salesDep || toNum(d.un_deposit_hint), `Sales Deposit - ${loc}`, [
      { accnt: 'Bar Sales',              amount:  toNum(d.un_bar),            memo: 'Bar Sales' },
      { accnt: 'Kitchen Sales',          amount:  toNum(d.un_kitchen),        memo: 'Kitchen Sales' },
      { accnt: 'Gift Card Activations',  amount:  toNum(d.un_gc_activations), memo: 'Gift Card Activations' },
      { accnt: 'Retail Sales',           amount:  toNum(d.un_retail),         memo: 'Retail Sales' },
      { accnt: 'Sales Comps',            amount: -toNum(d.un_comps),          memo: 'Comps (contra)' },
      { accnt: 'Sales Discounts',        amount: -toNum(d.un_discounts),      memo: 'Discounts (contra)' },
      { accnt: 'Spills',                 amount: -toNum(d.un_spills),         memo: 'Spills (contra)' },
      { accnt: 'Sales Tax Payable',      amount:  toNum(d.un_taxes),          memo: 'Taxes' },
      { accnt: 'Tips Payable',           amount:  toNum(d.un_tips),           memo: 'Tips' },
      { accnt: 'Credit Card Clearing',   amount: -toNum(d.un_credit_cards),   memo: 'Union CC (contra)' },
      { accnt: 'Bar Credit Cards',       amount: -toNum(d.un_bar_cc),         memo: 'Bar CC (contra)' },
      { accnt: 'Non-Cash Adj Fees',      amount:  toNum(d.un_non_cash_fees),  memo: 'Non-Cash Adj Fees' },
      { accnt: 'Recoveries',             amount:  toNum(d.un_recoveries),     memo: 'Recoveries' },
      { accnt: 'Gift Card Redemptions',  amount:  toNum(d.un_gc_redemptions), memo: 'GC Redemptions' },
      { accnt: 'Gift Card Voids',        amount: -toNum(d.un_gc_voids),       memo: 'GC Voids (contra)' },
      { accnt: 'Gift Card Conversions',  amount: -toNum(d.un_gc_conversions), memo: 'GC Conversions (contra)' },
    ]);
  } else {
    // Legacy path: older submissions used sales_bar/sales_kitchen on a single aggregate line.
    const bar = toNum(d.sales_bar), kitchen = toNum(d.sales_kitchen);
    if (bar || kitchen) {
      const tcd = toNum(d.total_cash_deposit) || (bar + kitchen);
      L.push(`TRNS\tDEPOSIT\t${dt}\tChecking Account\t\t${loc}\t${tcd.toFixed(2)}\tCash Deposit - ${loc}`);
      if (bar)     L.push(`SPL\tDEPOSIT\t${dt}\tBar Sales\t\t${loc}\t${(-bar).toFixed(2)}\tBar Sales`);
      if (kitchen) L.push(`SPL\tDEPOSIT\t${dt}\tKitchen Sales\t\t${loc}\t${(-kitchen).toFixed(2)}\tKitchen Sales`);
      const ccTotal = toNum(d.total_credit_cards) + toNum(d.bar_credit_cards);
      if (ccTotal)              L.push(`SPL\tDEPOSIT\t${dt}\tCredit Card Clearing\t\t${loc}\t${ccTotal.toFixed(2)}\tCredit Cards`);
      if (toNum(d.sales_comps)) L.push(`SPL\tDEPOSIT\t${dt}\tComps Expense\t\t${loc}\t${toNum(d.sales_comps).toFixed(2)}\tComps`);
      if (toNum(d.total_taxes)) L.push(`SPL\tDEPOSIT\t${dt}\tSales Tax Payable\t\t${loc}\t${(-toNum(d.total_taxes)).toFixed(2)}\tTaxes`);
      if (toNum(d.total_tips))  L.push(`SPL\tDEPOSIT\t${dt}\tTips Payable\t\t${loc}\t${(-toNum(d.total_tips)).toFixed(2)}\tTips`);
      L.push('ENDTRNS');
    }
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
    // Collectors get their list of assigned third-party venues at login so the
    // frontend can route them to the collector dashboard immediately.
    let assigned_venues = [];
    if (u.role === 'collector') {
      const [av] = await pool.execute(
        `SELECT l.location_id AS id, l.location_name AS name, l.location_type,
                l.collection_split_type, l.split_percentage, l.split_config_json,
                l.cabinet_count, l.cabinet_config_json
         FROM user_venues uv
         JOIN locations l ON l.location_id = uv.location_id
         WHERE uv.user_id = ?
         ORDER BY l.location_name`,
        [u.id]
      );
      assigned_venues = av;
    }
    res.json({
      token,
      user: {
        id: u.id, email: u.email, name: u.name,
        role: u.role, location_id: u.location_id,
        location_name: u.location_name,
        must_change_password: !!u.must_change_password,
        assigned_venues,
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
  const user = rows[0];
  if (user && user.role === 'collector') {
    const [av] = await pool.execute(
      `SELECT l.location_id AS id, l.location_name AS name, l.location_type,
              l.collection_split_type, l.split_percentage, l.split_config_json,
              l.cabinet_count, l.cabinet_config_json
       FROM user_venues uv JOIN locations l ON l.location_id = uv.location_id
       WHERE uv.user_id = ? ORDER BY l.location_name`,
      [user.id]
    );
    user.assigned_venues = av;
  }
  res.json({ user });
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
  // Optional ?type=company_owned|third_party filter so admin screens can show one
  // list at a time. Returns the full venue config (split + cabinet) so the admin
  // UI and collector form can render without extra round-trips.
  const type = req.query.type;
  const params = [];
  let where = '';
  if (type === 'company_owned' || type === 'third_party') {
    where = ' WHERE location_type = ?';
    params.push(type);
  }
  try {
    const [rows] = await pool.query(
      `SELECT location_id AS id, location_name AS name, location_status,
              location_type, collection_split_type, split_percentage,
              split_config_json, cabinet_count, cabinet_config_json,
              address_line1, city, state, zip_code,
              contact_name, contact_phone, contact_email, notes
       FROM locations${where} ORDER BY location_name`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /api/locations failed:', e.code, e.message, '| sqlState:', e.sqlState);
    res.status(500).json({ error: e.code || 'query_failed', message: e.message });
  }
});

// Collector's view: the venues admin has assigned to them. Returns the same
// shape as /api/locations so the frontend can re-use the same card component.
app.get('/api/my-venues', authRequired, async (req, res) => {
  if (req.user.role !== 'collector') {
    return res.status(403).json({ error: 'Collector only' });
  }
  const [rows] = await pool.execute(
    `SELECT l.location_id AS id, l.location_name AS name, l.location_status,
            l.location_type, l.collection_split_type, l.split_percentage,
            l.split_config_json, l.cabinet_count, l.cabinet_config_json,
            l.address_line1, l.city, l.state, l.zip_code,
            l.contact_name, l.contact_phone, l.contact_email, l.notes,
            uv.assigned_at
     FROM user_venues uv
     JOIN locations l ON l.location_id = uv.location_id
     WHERE uv.user_id = ?
     ORDER BY l.location_name`,
    [req.user.id]
  );
  res.json(rows);
});

// =====================================================================
// ADMIN — Venue management (create / update / delete / assign collectors)
// =====================================================================
// Shared helper: coerce a split config body into DB-safe values. For
// percentage splits we require 0 <= split_percentage <= 100. For big_easy
// (the $2500 monthly waterfall) we ignore split_percentage entirely.
function normalizeVenueBody(b) {
  const out = {};
  if (b.location_name !== undefined) out.location_name = String(b.location_name).trim();
  if (b.location_status !== undefined) out.location_status = String(b.location_status);
  if (b.location_type !== undefined) {
    if (!['company_owned','third_party'].includes(b.location_type))
      throw new Error('invalid location_type');
    out.location_type = b.location_type;
  }
  if (b.collection_split_type !== undefined) {
    if (b.collection_split_type === null || b.collection_split_type === '') {
      out.collection_split_type = null;
    } else if (!['big_easy','percentage'].includes(b.collection_split_type)) {
      throw new Error('invalid collection_split_type');
    } else {
      out.collection_split_type = b.collection_split_type;
    }
  }
  if (b.split_percentage !== undefined) {
    if (b.split_percentage === null || b.split_percentage === '') {
      out.split_percentage = null;
    } else {
      const n = Number(b.split_percentage);
      if (!Number.isFinite(n) || n < 0 || n > 100)
        throw new Error('split_percentage must be between 0 and 100');
      out.split_percentage = n;
    }
  }
  if (b.split_config_json !== undefined) {
    out.split_config_json = b.split_config_json === null ? null
      : typeof b.split_config_json === 'string'
        ? b.split_config_json
        : JSON.stringify(b.split_config_json);
  }
  if (b.cabinet_count !== undefined) {
    if (b.cabinet_count === null || b.cabinet_count === '') {
      out.cabinet_count = null;
    } else {
      const n = parseInt(b.cabinet_count);
      if (!Number.isFinite(n) || n < 0) throw new Error('cabinet_count must be >= 0');
      out.cabinet_count = n;
    }
  }
  if (b.cabinet_config_json !== undefined) {
    out.cabinet_config_json = b.cabinet_config_json === null ? null
      : typeof b.cabinet_config_json === 'string'
        ? b.cabinet_config_json
        : JSON.stringify(b.cabinet_config_json);
  }
  for (const k of ['address_line1','city','state','zip_code','contact_name','contact_phone','contact_email','notes']) {
    if (b[k] !== undefined) out[k] = b[k] || null;
  }
  return out;
}

app.post('/api/admin/venues', authRequired, adminRequired, async (req, res) => {
  try {
    const body = normalizeVenueBody(req.body || {});
    if (!body.location_name) return res.status(400).json({ error: 'location_name is required' });
    if (!body.location_type) body.location_type = 'company_owned';
    if (!body.location_status) body.location_status = 'active';
    // Third-party venues need a split type so collections can be exported to QB.
    if (body.location_type === 'third_party' && !body.collection_split_type) {
      return res.status(400).json({ error: 'third_party venues require collection_split_type' });
    }
    if (body.collection_split_type === 'percentage' && body.split_percentage == null) {
      return res.status(400).json({ error: 'percentage split requires split_percentage' });
    }
    const cols = Object.keys(body);
    const vals = cols.map(k => body[k]);
    const [r] = await pool.execute(
      `INSERT INTO locations (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,
      vals
    );
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'location_name already exists' });
    console.error('create venue', e); res.status(400).json({ error: e.message });
  }
});

app.patch('/api/admin/venues/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = normalizeVenueBody(req.body || {});
    const cols = Object.keys(body);
    if (!cols.length) return res.json({ success: true });
    const sets = cols.map(c => `${c}=?`);
    const vals = cols.map(c => body[c]);
    vals.push(id);
    await pool.execute(`UPDATE locations SET ${sets.join(', ')} WHERE location_id=?`, vals);
    res.json({ success: true });
  } catch (e) {
    console.error('update venue', e); res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/venues/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Guard: refuse if the venue has submissions, collections, or user accounts
    // attached — audit history matters. Admin should flip location_status to
    // 'inactive' instead.
    const [[sub]] = await pool.execute('SELECT COUNT(*) AS n FROM submissions WHERE location_id=?', [id]);
    const [[col]] = await pool.execute('SELECT COUNT(*) AS n FROM collections WHERE location_id=?', [id]);
    const [[usr]] = await pool.execute('SELECT COUNT(*) AS n FROM users WHERE location_id=?', [id]);
    if (sub.n || col.n || usr.n) {
      return res.status(409).json({
        error: `venue has ${sub.n} submission(s), ${col.n} collection(s), ${usr.n} user(s) on record — set status=inactive instead to preserve history`,
        submissions: sub.n, collections: col.n, users: usr.n,
      });
    }
    // Clean up any collector assignments for the venue first.
    await pool.execute('DELETE FROM user_venues WHERE location_id=?', [id]);
    await pool.execute('DELETE FROM locations WHERE location_id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete venue', e); res.status(500).json({ error: e.message });
  }
});

// List collectors assigned to a venue (admin UI chip list).
app.get('/api/admin/venues/:id/collectors', authRequired, adminRequired, async (req, res) => {
  const id = parseInt(req.params.id);
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, uv.assigned_at
     FROM user_venues uv JOIN users u ON u.id = uv.user_id
     WHERE uv.location_id = ? AND u.role = 'collector' AND u.active = 1
     ORDER BY u.name, u.email`,
    [id]
  );
  res.json(rows);
});

// Assign a collector to a venue. Idempotent — duplicate assignments are ignored.
app.post('/api/admin/venues/:id/collectors', authRequired, adminRequired, async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const userId = parseInt(req.body?.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const [[u]] = await pool.execute("SELECT role FROM users WHERE id=? AND active=1", [userId]);
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (u.role !== 'collector') return res.status(400).json({ error: 'user is not a collector' });
    await pool.execute(
      `INSERT IGNORE INTO user_venues (user_id, location_id, assigned_by) VALUES (?, ?, ?)`,
      [userId, locationId, req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('assign collector', e); res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/venues/:id/collectors/:userId', authRequired, adminRequired, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM user_venues WHERE location_id=? AND user_id=?',
      [parseInt(req.params.id), parseInt(req.params.userId)]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('unassign collector', e); res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// ADMIN — User management
// =====================================================================
app.get('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  // Optional ?role=admin|venue|collector filter so the Venue Manager can pull
  // collectors for the assignment dropdown without extra client-side filtering.
  const role = req.query.role;
  const params = [];
  let where = '';
  if (['admin','venue','collector'].includes(role)) {
    where = ' WHERE u.role = ?';
    params.push(role);
  }
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.location_id, u.last_login_at, l.location_name AS location_name
     FROM users u LEFT JOIN locations l ON l.location_id = u.location_id${where}
     ORDER BY u.role DESC, u.email`,
    params
  );
  res.json(rows);
});

app.post('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  try {
    const { email, name, password, role, location_id, venue_ids } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    if (!['admin','venue','collector'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (role === 'venue' && !location_id) return res.status(400).json({ error: 'venue accounts need a location_id' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.execute(
      `INSERT INTO users (email, name, password_hash, role, location_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [email.toLowerCase().trim(), name || null, hash, role, role === 'venue' ? location_id : null]
    );
    // For collectors, optionally seed their assignments in the same call so
    // admins can create "Alice: Buc's + Ready Room + Lucky Dragon" in one step.
    if (role === 'collector' && Array.isArray(venue_ids) && venue_ids.length) {
      const values = venue_ids.map(() => '(?, ?, ?)').join(',');
      const params = [];
      for (const vid of venue_ids) { params.push(r.insertId, parseInt(vid), req.user.id); }
      await pool.execute(
        `INSERT IGNORE INTO user_venues (user_id, location_id, assigned_by) VALUES ${values}`,
        params
      );
    }
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email already exists' });
    console.error(e); res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const { active, name, email, location_id, role, reset_password } = req.body || {};
    const targetId = parseInt(req.params.id);
    const sets = [], vals = [];
    if (active      !== undefined) { sets.push('active=?');      vals.push(active ? 1 : 0); }
    if (name        !== undefined) { sets.push('name=?');        vals.push(name); }
    if (location_id !== undefined) { sets.push('location_id=?'); vals.push(location_id); }
    if (email       !== undefined) {
      const e = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'invalid email' });
      sets.push('email=?'); vals.push(e);
    }
    if (role !== undefined) {
      if (!['admin','venue','collector'].includes(role)) return res.status(400).json({ error: 'invalid role' });
      // Protect against admins demoting themselves and locking out the system.
      if (targetId === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'you cannot demote yourself' });
      }
      sets.push('role=?'); vals.push(role);
    }
    if (reset_password) {
      if (String(reset_password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
      const hash = await bcrypt.hash(reset_password, 10);
      sets.push('password_hash=?', 'must_change_password=1'); vals.push(hash);
    }
    if (!sets.length) return res.json({ success: true });
    vals.push(targetId);
    await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email already in use' });
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// Delete a user. Refuses if the user has submissions (to preserve audit history)
// — admin should use the Disable toggle instead. Also refuses to delete self.
app.delete('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'you cannot delete your own account' });
    }
    const [[user]] = await pool.execute('SELECT id, email, role FROM users WHERE id=?', [targetId]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const [[subCount]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM submissions WHERE user_id=? OR reviewed_by=?',
      [targetId, targetId]
    );
    const [[colCount]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM collections WHERE user_id=? OR reviewed_by=?',
      [targetId, targetId]
    );
    if (subCount.n > 0 || colCount.n > 0) {
      return res.status(409).json({
        error: `user has ${subCount.n} submission(s) and ${colCount.n} collection(s) on record — disable the account instead so audit history is preserved`,
        submissions: subCount.n,
        collections: colCount.n,
      });
    }
    // Clean up collector venue assignments — safe even if there are none.
    await pool.execute('DELETE FROM user_venues WHERE user_id=?', [targetId]);
    // If this is the last active admin, refuse.
    if (user.role === 'admin') {
      const [[{ n: activeAdmins }]] = await pool.execute(
        "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id != ?",
        [targetId]
      );
      if (activeAdmins === 0) {
        return res.status(400).json({ error: 'cannot delete the last active admin' });
      }
    }
    await pool.execute('DELETE FROM users WHERE id=?', [targetId]);
    res.json({ success: true, deleted: user.email });
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// COLLECTIONS — list endpoint (stub until CollectionForm lands)
// =====================================================================
// Returns collections scoped to the caller: collectors see only their own,
// admins see everything (filtered by ?status=pending|approved|rejected if
// provided). The POST /api/collections endpoint + IIF export live with the
// full collection form feature and haven't been wired yet.
app.get('/api/collections', authRequired, async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.user.role === 'collector') {
      where.push('c.user_id = ?');
      params.push(req.user.id);
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (req.query.status && ['pending','approved','rejected'].includes(req.query.status)) {
      where.push('c.status = ?');
      params.push(req.query.status);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT c.id, c.location_id, c.user_id, c.report_date, c.status,
              c.admin_notes, c.submitted_at, c.reviewed_at,
              l.location_name, u.email AS submitter_email
       FROM collections c
       LEFT JOIN locations l ON l.location_id = c.location_id
       LEFT JOIN users u ON u.id = c.user_id
       ${whereSql}
       ORDER BY c.report_date DESC, c.submitted_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error('collections list', e);
    res.status(500).json({ error: e.message });
  }
});

// Collector submits a new collection. Collectors are restricted to venues in
// their user_venues join; admins can submit for any location. If a collection
// for (location, date) already exists and is pending/rejected, we overwrite it
// (same pattern as submissions). Approved collections are locked — admin has
// to un-approve first.
app.post('/api/collections', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const { location_id, report_date, notes, split_override, payload } = body;
    if (!location_id) return res.status(400).json({ error: 'location_id required' });
    if (!report_date)  return res.status(400).json({ error: 'report_date required' });
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload required' });

    // Collectors must be assigned to this venue. Admin bypasses the check.
    if (req.user.role === 'collector') {
      const [[row]] = await pool.query(
        'SELECT 1 FROM user_venues WHERE user_id=? AND location_id=? LIMIT 1',
        [req.user.id, location_id]
      );
      if (!row) return res.status(403).json({ error: 'Not assigned to this venue' });
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const storedPayload = {
      ...payload,
      notes: notes || payload.notes || '',
      split_override: split_override || null,
    };

    const [existing] = await pool.execute(
      'SELECT id, status FROM collections WHERE location_id=? AND report_date=?',
      [location_id, report_date]
    );
    if (existing.length) {
      const c = existing[0];
      if (c.status === 'approved') {
        return res.status(409).json({ error: 'Already approved; contact admin' });
      }
      await pool.execute(
        `UPDATE collections
            SET user_id=?, status='pending', payload=?, admin_notes=NULL,
                reviewed_at=NULL, reviewed_by=NULL, submitted_at=NOW()
          WHERE id=?`,
        [req.user.id, JSON.stringify(storedPayload), c.id]
      );
      return res.json({ id: c.id, status: 'pending', resubmitted: true });
    }

    const [r] = await pool.execute(
      `INSERT INTO collections (location_id, user_id, report_date, status, payload)
       VALUES (?, ?, ?, 'pending', ?)`,
      [location_id, req.user.id, report_date, JSON.stringify(storedPayload)]
    );
    res.json({ id: r.insertId, status: 'pending' });
  } catch (e) {
    console.error('collections create', e);
    res.status(500).json({ error: e.message });
  }
});

// Prior-tranche state for the big_easy waterfall. Given a venue and a month,
// sums up to_t1 / to_t2 across all pending+approved collections that month so
// the next collection form can auto-populate "prior paid" without the
// collector having to track it by hand.
//
// Rule: each calendar month is a clean slate — on the 1st, prior = 0 even if
// last month's tranches weren't fully paid (any unpaid balance drops).
// Query params:
//   location_id (required)
//   month=YYYY-MM (required) — e.g. 2026-04
// Collectors are restricted to venues in their user_venues; admins see all.
app.get('/api/collections/prior', authRequired, async (req, res) => {
  try {
    const locationId = req.query.location_id;
    const month = String(req.query.month || '');
    if (!locationId) return res.status(400).json({ error: 'location_id required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    if (req.user.role === 'collector') {
      const [[row]] = await pool.query(
        'SELECT 1 FROM user_venues WHERE user_id=? AND location_id=? LIMIT 1',
        [req.user.id, locationId]
      );
      if (!row) return res.status(403).json({ error: 'Not assigned to this venue' });
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const [rows] = await pool.execute(
      `SELECT id, report_date, status, payload
         FROM collections
        WHERE location_id = ?
          AND report_date >= ?
          AND report_date <  ?
          AND status IN ('pending','approved')
        ORDER BY report_date ASC, submitted_at ASC`,
      [locationId, monthStart, nextMonth]
    );

    let t1 = 0, t2 = 0;
    const summary = [];
    for (const r of rows) {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {});
      const w = p.waterfall || null;
      const toT1 = w ? Number(w.to_t1) || 0 : 0;
      const toT2 = w ? Number(w.to_t2) || 0 : 0;
      t1 += toT1;
      t2 += toT2;
      summary.push({
        id: r.id,
        report_date: r.report_date,
        status: r.status,
        to_t1: toT1,
        to_t2: toT2,
      });
    }
    // Cap at the tranche ceiling (defensive — shouldn't happen if submits used
    // the same waterfall math, but guards against bad payloads).
    t1 = Math.min(t1, 2500);
    t2 = Math.min(t2, 2500);
    res.json({
      location_id: Number(locationId),
      month,
      t1_paid: t1,
      t2_paid: t2,
      t1_remaining: Math.max(0, 2500 - t1),
      t2_remaining: Math.max(0, 2500 - t2),
      collections: summary,
    });
  } catch (e) {
    console.error('collections prior', e);
    res.status(500).json({ error: e.message });
  }
});

// Single collection fetch with full payload. Collectors can only see their
// own; admins can see any.
app.get('/api/collections/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.*, l.location_name, l.collection_split_type, l.split_percentage,
              l.cabinet_config_json, u.email AS submitter_email, u.name AS submitter_name
         FROM collections c
         LEFT JOIN locations l ON l.location_id = c.location_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = ?`,
      [req.params.id]
    );
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'collector' && c.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    c.payload = typeof c.payload === 'string' ? JSON.parse(c.payload) : c.payload;
    res.json(c);
  } catch (e) {
    console.error('collections get', e);
    res.status(500).json({ error: e.message });
  }
});

// Admin: approve a collection. IIF export build is stubbed — the proper
// QuickBooks chart-of-accounts mapping for third-party venues is a separate
// piece of work, so for now we stamp the collection as approved and hold the
// IIF file slot open (iif_content stays NULL until an explicit export runs).
app.post('/api/admin/collections/:id/approve', authRequired, adminRequired, async (req, res) => {
  try {
    const [r] = await pool.execute(
      `UPDATE collections
          SET status='approved', reviewed_at=NOW(), reviewed_by=?, admin_notes=?
        WHERE id=? AND status <> 'approved'`,
      [req.user.id, req.body?.notes || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found or already approved' });
    res.json({ success: true });
  } catch (e) {
    console.error('approve collection', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/collections/:id/reject', authRequired, adminRequired, async (req, res) => {
  try {
    const notes = (req.body?.notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'Rejection note is required' });
    const [r] = await pool.execute(
      `UPDATE collections
          SET status='rejected', reviewed_at=NOW(), reviewed_by=?, admin_notes=?
        WHERE id=? AND status='pending'`,
      [req.user.id, notes, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found or not pending' });
    res.json({ success: true });
  } catch (e) {
    console.error('reject collection', e);
    res.status(500).json({ error: e.message });
  }
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

    // Optionally attach uploaded images to this submission.
    const imageIds = Array.isArray(payload.image_ids)
      ? payload.image_ids.filter(n => Number.isInteger(+n)).map(n => +n)
      : [];

    if (existing.length) {
      const sub = existing[0];
      if (sub.status === 'approved') return res.status(409).json({ error: 'Already approved; contact admin' });
      await pool.execute(
        `UPDATE submissions
         SET user_id=?, status='pending', payload=?, admin_notes=NULL, reviewed_at=NULL, reviewed_by=NULL, submitted_at=NOW()
         WHERE id=?`,
        [req.user.id, JSON.stringify(fullPayload), sub.id]
      );
      if (imageIds.length) {
        await pool.query(
          'UPDATE submission_images SET submission_id=? WHERE id IN (?) AND user_id=?',
          [sub.id, imageIds, req.user.id]
        );
      }
      return res.json({ id: sub.id, status: 'pending', resubmitted: true });
    }
    const [r] = await pool.execute(
      `INSERT INTO submissions (location_id, user_id, report_date, status, payload)
       VALUES (?, ?, ?, 'pending', ?)`,
      [locationId, req.user.id, payload.report_date, JSON.stringify(fullPayload)]
    );
    if (imageIds.length) {
      await pool.query(
        'UPDATE submission_images SET submission_id=? WHERE id IN (?) AND user_id=?',
        [r.insertId, imageIds, req.user.id]
      );
    }
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
  // Sanitize filename: strip non-ASCII (e.g. em-dashes) — Node rejects them in Content-Disposition.
  const safeName = sub.location_name.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_');
  const dateStr = sub.report_date.toISOString ? sub.report_date.toISOString().slice(0,10) : sub.report_date;
  const fname = `DSR_${safeName}_${dateStr}.iif`;
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
// =====================================================================
// Terminal-report photo upload + Claude Vision OCR
//
// Venues photograph the paper receipts from the terminals (Semnox drawer
// report, Union POS shift report, Riversweeps, Red Plum vending detail,
// EP TIME summary) and upload them. Each upload is passed to Claude
// Vision with a structured-extraction prompt; the parsed JSON is returned
// to the client, which auto-fills the matching DSR fields.
//
// Bytes are stored in submission_images.image_bytes (LONGBLOB) so the
// photos remain available for audit. OCR raw text + parsed_json are
// stored alongside so we never have to re-run OCR for the same image.
// =====================================================================
const REPORT_TYPES = {
  semnox_terminal: {
    label: 'Semnox Terminal Drawer Report',
    prompt: `This is a Semnox / EP TIME terminal "Drawer Report" (or "Terminal Report"). Extract the totals from the "Money totals" section and any cash count.
Fields to extract (all dollar amounts as numbers, null if missing or blank):
- opening: Opening
- fills: Fills
- bleeds: Bleeds
- cash_in: Cash In
- cash_out: Cash Out
- current_cash: Current Cash
- free_credits_awarded: Free credits awarded
- sweepstakes_entries: Free sweepstakes entries
- comp_credits: Comp credits
- promotional_points: Promotional points
- donation_points: Total Donation Points issued
- ep_time_total: the overall EP TIME total if shown
Respond with JSON only.`,
  },
  union_pos: {
    label: 'Union POS Shift Report',
    prompt: `This is a Union POS "Shift Report - Close Shift". Extract the payment totals and taxable/non-taxable sales.
Fields (numbers, null if absent):
- cash: Cash total (prefer "Net Shift" column if present, else "System")
- credit_card: Credit Card total
- debit: Debit total (if separate)
- game_card: Game Card total
- cheques: Cheques
- coupons: Coupons
- taxable_sale_amount: Taxable Sale amount
- taxable_sale_tax: Taxable Sale tax
- non_taxable_sale_amount: Non-Taxable Sale amount
- non_taxable_sale_tax: Non-Taxable Sale tax
- discount_taxable: Disc. On Taxable (amount, negative sign as shown)
- discount_non_taxable: Disc. On Non-Taxable
- net_sale_amount: Net Sale amount
- net_sale_tax: Net Sale tax
- tips: Tips (if present in the report)
- bar_sales: Bar Sales (if separately categorized)
- kitchen_sales: Kitchen Sales (if separately categorized)
- retail_sales: Retail Sales (if separately categorized)
Respond with JSON only.`,
  },
  riversweeps: {
    label: 'Riversweeps Close Shift',
    prompt: `This is a Riversweeps terminal "CLOSE SHIFT" report. Extract the shift totals.
Fields (numbers, null if absent):
- shift_open_register: Shift open register
- cash_added: Cash added
- cash_bleed: Cash bleed
- bill_in: Bill In
- bill_in_count: Bill In count
- bill_out: Bill Out
- bill_out_count: Bill Out count
- shift_close_register: Shift close register
- shift_profit: Shift profit
- shift_shortage: Shift shortage
- bounceback: Bounceback
- bounceback_count: Bounceback count
- promo: Promo
- promo_count: Promo count
- free_play_issued: Free Play issued
Respond with JSON only.`,
  },
  red_plum: {
    label: 'Red Plum Skill Vending Detail',
    prompt: `This is a Red Plum Skill Vending Cabinets Detail page. Extract the "In" and "Out" dollar totals per cabinet, and the overall "Net RP" if shown.
Return JSON with:
- cabinets: array of { name, tid, serial, in, out, net } - one object per cabinet row
- net_rp: overall Net RP total
Respond with JSON only.`,
  },
  cardinal_collect: {
    label: 'Cardinal Xpress Terminal Audit Report',
    prompt: `This is a thermal-printer Cardinal Xpress Terminal Audit Report from a single cabinet. The header reads "CARDINAL XPRESS TERMINAL AUDIT REPORT". Extract the cabinet identity and the period-side numbers (NOT lifetime).

Schema (numbers as numbers, strings as strings, null if missing):
- vendor: literal "cardinal"
- venue_name_raw: the venue token from the Location line, e.g. "LUCKY DRAGON 20" → "LUCKY DRAGON"
- cabinet_label_raw: the cabinet number/suffix from the Location line, e.g. "LUCKY DRAGON 20" → "20"
- hardware_id: the Serial No, e.g. "GEN-07643"
- report_date: ISO date the receipt was printed (YYYY-MM-DD)
- period_start: ISO date the period started
- period_days: integer number of days the period covers
- gameplay_period_in: ==GAMEPLAY== "IN" Period column (number)
- gameplay_period_paid: ==GAMEPLAY== "PAID" Period column
- gameplay_period_net_win: ==GAMEPLAY== "NET WIN" Period column
- gameplay_period_out_device: ==GAMEPLAY== "OUT (DEVICE)" Period column
- gameplay_period_out_attend: ==GAMEPLAY== "OUT (ATTEND)" Period column
- collect_in_total: ==COLLECT IN== Total Amount (this is the cabinet total IN for the form)
- collect_in_qty: ==COLLECT IN== Total Qty
- collect_out_ticket_amount: ==COLLECT OUT== TICKET Amount (this is the cabinet total OUT)
- collect_out_ticket_qty: ==COLLECT OUT== TICKET Qty
- bills: object with numeric Qty per denomination, all six required (use 0 if absent):
  - d1: $1 row Qty
  - d2: $2 row Qty
  - d5: $5 row Qty
  - d10: $10 row Qty
  - d20: $20 row Qty
  - d50: $50 row Qty
  - d100: $100 row Qty

Sanity checks (for your own reasoning, do NOT include in output):
- bills.d1*1 + d2*2 + d5*5 + d10*10 + d20*20 + d50*50 + d100*100 should equal collect_in_total
- collect_in_total - collect_out_ticket_amount should equal gameplay_period_out_device

Respond with JSON only.`,
  },
  redplum_collect: {
    label: 'Red Plum Cabinet Daily Summary',
    prompt: `This is a thermal-printer Red Plum Games daily summary from a single cabinet. The header reads "REDPLUM GAMES" with a venue name above it (e.g. "BETHANY 3"). Three columns are shown: ARCHIVE, WEEKLY, DAILY. Always extract the DAILY column values.

Schema (numbers as numbers, strings as strings, null if missing):
- vendor: literal "redplum"
- venue_name_raw: the venue token from the line above "REDPLUM GAMES", e.g. "BETHANY 3" → "BETHANY"
- cabinet_label_raw: the trailing number from that line, e.g. "BETHANY 3" → "3"
- hardware_id: the hex string at the very top, e.g. "48FF74673830"
- report_date: ISO date from the title line
- period_start: ISO from the LSTCLRDT row, DAILY column
- period_end: ISO of report_date
- daily_in: $IN > DAILY column (this is the cabinet total IN for the form)
- daily_paid_out: $PAID OUT > DAILY column (this is the cabinet total OUT)
- daily_held: $HELD > DAILY column
- daily_pts_played: PTS PLAYED > DAILY column
- daily_points_won: POINTS WON > DAILY column
- daily_pts_earned: PTS EARNED > DAILY column
- daily_games_pld: GAMES PLD > DAILY column (integer)
- daily_games_won: GAMES WON > DAILY column (integer)
- daily_hit_pct: HIT % DAILY column (number, e.g. 17.22)
- to_collect: "TO COLLECT: $X" line (number)
- bills: object with numeric COUNT per denomination, six fields required (0 if absent):
  - d1: $1.00 row COUNT
  - d5: $5.00 row COUNT
  - d10: $10.00 row COUNT
  - d20: $20.00 row COUNT
  - d50: $50.00 row COUNT
  - d100: $100.00 row COUNT
  (Red Plum does not print a $2 row; omit it.)

Sanity check (do not include in output):
- bills.d1*1 + d5*5 + d10*10 + d20*20 + d50*50 + d100*100 should equal to_collect

Respond with JSON only.`,
  },
  ep_time: {
    label: 'EP TIME (Semnox FP) Summary',
    prompt: `This is an EP TIME / Free Points summary. Extract vendor-level points-in / prizes-out / net.
Fields (numbers, null if absent):
- maverick_in: Maverick Points In
- maverick_out: Maverick Prizes Out
- maverick_net: Net FP - Maverick
- rimfire_in: Rimfire Points In
- rimfire_out: Rimfire Prizes Out
- rimfire_net: Net FP - Rimfire
- river_in: River Points In
- river_out: River Prizes Out
- river_net: Net FP - River
- golden_dragon_in: Golden Dragon Points In
- golden_dragon_out: Golden Dragon Prizes Out
- golden_dragon_net: Net FP - Golden Dragon
- net_fp_total: Net (FP) overall
- ep_time_fp_total: EP TIME (FP) Total
Respond with JSON only.`,
  },
};

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB max phone photo
});

// Strip markdown fences and pull the first JSON object from a model response.
function extractJson(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('model did not return JSON');
  return JSON.parse(m[0]);
}

async function runGeminiVisionOCR(imageBytes, mimeType, reportType) {
  const spec = REPORT_TYPES[reportType];
  if (!spec) throw new Error('Unknown report_type');
  const model = geminiClient.getGenerativeModel({
    model: process.env.GEMINI_OCR_MODEL || 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });
  const resp = await model.generateContent([
    { inlineData: { data: imageBytes.toString('base64'), mimeType } },
    { text: `${spec.prompt}\n\nReturn ONLY a JSON object, no prose, no markdown fences.` },
  ]);
  const raw = resp.response.text();
  return { raw, parsed: extractJson(raw) };
}

async function runClaudeVisionOCR(imageBytes, mimeType, reportType) {
  const spec = REPORT_TYPES[reportType];
  if (!spec) throw new Error('Unknown report_type');
  const msg = await anthropicClient.messages.create({
    model: process.env.ANTHROPIC_OCR_MODEL || 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBytes.toString('base64') } },
        { type: 'text', text: `${spec.prompt}\n\nReturn ONLY a JSON object, no prose, no markdown fences.` },
      ],
    }],
  });
  const raw = (msg.content || []).map(b => b.type === 'text' ? b.text : '').join('').trim();
  return { raw, parsed: extractJson(raw) };
}

// Pick whichever backend is configured. Gemini preferred (free tier),
// Anthropic as fallback. Throws a helpful error if neither is set.
async function runOCR(imageBytes, mimeType, reportType) {
  if (geminiClient)    return runGeminiVisionOCR(imageBytes, mimeType, reportType);
  if (anthropicClient) return runClaudeVisionOCR(imageBytes, mimeType, reportType);
  throw new Error('No OCR backend configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY on the server.');
}

// Upload one photo. Runs OCR inline, returns parsed JSON + image id.
app.post('/api/images', authRequired, imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image file required' });
    const { report_type, report_date, submission_id } = req.body || {};
    if (!report_type || !REPORT_TYPES[report_type]) {
      return res.status(400).json({ error: 'valid report_type required' });
    }

    // Determine location: venues are pinned to their own, admins can pass one.
    let locationId = req.body.location_id ? parseInt(req.body.location_id) : null;
    if (req.user.role === 'venue') locationId = req.user.location_id || null;

    // Content hash for duplicate detection. Same user + same date + same image
    // bytes = duplicate. Return the existing row instead of re-uploading + re-OCR.
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const [dupes] = await pool.execute(
      `SELECT id, report_type, ocr_status, parsed_json, ocr_error, filename, created_at
         FROM submission_images
        WHERE user_id=? AND sha256=?
          AND (report_date <=> ?)
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, sha256, report_date || null]
    );
    if (dupes.length) {
      const dup = dupes[0];
      return res.json({
        id: dup.id,
        report_type: dup.report_type,
        ocr_status: dup.ocr_status,
        parsed: dup.parsed_json ? JSON.parse(dup.parsed_json) : null,
        error: dup.ocr_error || null,
        label: REPORT_TYPES[dup.report_type]?.label || dup.report_type,
        duplicate: true,
        duplicate_of: dup.id,
        duplicate_uploaded_at: dup.created_at,
      });
    }

    const [ins] = await pool.execute(
      `INSERT INTO submission_images
         (submission_id, user_id, location_id, report_date, report_type,
          filename, mime_type, byte_size, image_bytes, sha256, ocr_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')`,
      [
        submission_id ? parseInt(submission_id) : null,
        req.user.id,
        locationId,
        report_date || null,
        report_type,
        req.file.originalname || null,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        sha256,
      ]
    );
    const imageId = ins.insertId;

    // Inline OCR
    try {
      const { raw, parsed } = await runOCR(
        req.file.buffer, req.file.mimetype, report_type
      );
      await pool.execute(
        `UPDATE submission_images
           SET ocr_status='parsed', ocr_raw=?, parsed_json=?, ocr_error=NULL
         WHERE id=?`,
        [raw, JSON.stringify(parsed), imageId]
      );
      return res.json({
        id: imageId,
        report_type,
        ocr_status: 'parsed',
        parsed,
        label: REPORT_TYPES[report_type].label,
      });
    } catch (ocrErr) {
      console.error('OCR error', ocrErr);
      await pool.execute(
        `UPDATE submission_images
           SET ocr_status='failed', ocr_error=?
         WHERE id=?`,
        [String(ocrErr.message || ocrErr).slice(0, 2000), imageId]
      );
      return res.status(200).json({
        id: imageId,
        report_type,
        ocr_status: 'failed',
        error: String(ocrErr.message || ocrErr),
        label: REPORT_TYPES[report_type].label,
      });
    }
  } catch (e) {
    console.error('image upload error', e);
    res.status(500).json({ error: e.message });
  }
});

// List images for a submission (or for the current draft context).
// Admins can query by submission_id or user_id+date; venues get their own only.
app.get('/api/images', authRequired, async (req, res) => {
  try {
    const { submission_id, report_date, location_id } = req.query;
    const where = [];
    const params = [];
    if (submission_id) { where.push('submission_id=?'); params.push(parseInt(submission_id)); }
    if (report_date)   { where.push('report_date=?');   params.push(report_date); }
    if (req.user.role === 'venue') {
      where.push('user_id=?'); params.push(req.user.id);
      if (req.user.location_id) { where.push('(location_id=? OR location_id IS NULL)'); params.push(req.user.location_id); }
    } else if (location_id) {
      where.push('location_id=?'); params.push(parseInt(location_id));
    }
    const sql = `SELECT id, submission_id, user_id, location_id, report_date, report_type,
                        filename, mime_type, byte_size, ocr_status, parsed_json, ocr_error, created_at
                 FROM submission_images
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC LIMIT 200`;
    const [rows] = await pool.execute(sql, params);
    res.json(rows.map(r => ({ ...r, parsed_json: r.parsed_json ? JSON.parse(r.parsed_json) : null })));
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// Serve raw image bytes for thumbnail / lightbox view.
app.get('/api/images/:id/raw', authRequired, async (req, res) => {
  try {
    const [[row]] = await pool.execute(
      'SELECT user_id, location_id, mime_type, image_bytes FROM submission_images WHERE id=?',
      [parseInt(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'venue' && row.user_id !== req.user.id &&
        row.location_id !== req.user.location_id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(row.image_bytes);
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// Delete an image. Venues can only delete their own and only before the
// submission is approved.
app.delete('/api/images/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[row]] = await pool.execute(
      `SELECT si.user_id, si.submission_id, s.status
       FROM submission_images si
       LEFT JOIN submissions s ON s.id=si.submission_id
       WHERE si.id=?`, [id]
    );
    if (!row) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin') {
      if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
      if (row.status === 'approved')   return res.status(409).json({ error: 'submission approved; ask admin' });
    }
    await pool.execute('DELETE FROM submission_images WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

// Re-run OCR on an existing image (e.g. after prompt tweak).
app.post('/api/images/:id/reparse', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[row]] = await pool.execute(
      'SELECT user_id, location_id, mime_type, image_bytes, report_type FROM submission_images WHERE id=?',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'venue' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await pool.execute("UPDATE submission_images SET ocr_status='processing' WHERE id=?", [id]);
    try {
      const { raw, parsed } = await runOCR(row.image_bytes, row.mime_type, row.report_type);
      await pool.execute(
        "UPDATE submission_images SET ocr_status='parsed', ocr_raw=?, parsed_json=?, ocr_error=NULL WHERE id=?",
        [raw, JSON.stringify(parsed), id]
      );
      res.json({ id, ocr_status: 'parsed', parsed });
    } catch (e) {
      await pool.execute(
        "UPDATE submission_images SET ocr_status='failed', ocr_error=? WHERE id=?",
        [String(e.message || e).slice(0, 2000), id]
      );
      res.status(200).json({ id, ocr_status: 'failed', error: String(e.message || e) });
    }
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

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
// Express 5 global error handler — catches any unhandled throw from any route
app.use((err, req, res, _next) => {
  console.error(`✗ ${req.method} ${req.originalUrl}:`, err.code || '', err.message);
  res.status(500).json({ error: err.code || 'internal', message: err.message });
});

app.listen(PORT, () => console.log(`DSR Platform running on port ${PORT}`));
