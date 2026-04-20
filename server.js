import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'dist')));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rss_revenue',
  waitForConnections: true,
  connectionLimit: 10,
};

if (process.env.DB_SSL === 'true') {
  dbConfig.ssl = { rejectUnauthorized: true };
}

const pool = mysql.createPool(dbConfig);

app.post('/api/reports', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const d = req.body;
    const vendors = [
      { name: 'Maverick', type: 'sweepstakes', i: d.maverick_in, o: d.maverick_out },
      { name: 'Rimfire', type: 'sweepstakes', i: d.rimfire_in, o: d.rimfire_out },
      { name: 'Phoenix', type: 'sweepstakes', i: d.phoenix_in, o: d.phoenix_out },
      { name: 'Riversweep', type: 'sweepstakes', i: d.riversweep_in, o: d.riversweep_out },
      { name: 'Golden Dragon', type: 'sweepstakes', i: d.golden_dragon_in, o: d.golden_dragon_out },
    ];
    if (d.ep_total || d.ep_no_fp || d.ep_fp) {
      vendors.push({ name: 'Easy Play', type: 'coam', i: d.ep_total, o: 0 });
    }
    for (const v of vendors) {
      if (!v.i && !v.o) continue;
      await conn.execute(
        `INSERT INTO daily_revenue (location, report_date, manager, vendor_name, game_type, total_in, total_out, net_revenue) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.location, d.report_date, d.manager, v.name, v.type, v.i || 0, v.o || 0, (v.i || 0) - (v.o || 0)]
      );
    }
    if (d.cabinets && d.cabinets.length) {
      for (const cab of d.cabinets) {
        if (!cab.in && !cab.out) continue;
        await conn.execute(
          `INSERT INTO daily_cabinet_revenue (location, report_date, cabinet_name, terminal_id, serial_num, total_in, total_out, net_revenue, skill_deposit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.location, d.report_date, cab.name, cab.tid || null, cab.serial || null, cab.in || 0, cab.out || 0, (cab.in || 0) - (cab.out || 0), d.skill_deposit || 0]
        );
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    console.error('Error saving report:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    conn.release();
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT location, report_date, vendor_name, game_type, total_in, total_out, net_revenue FROM daily_revenue ORDER BY report_date DESC, location LIMIT 200`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/export/iif', (req, res) => {
  const d = req.body;
  const date = formatIIFDate(d.report_date);
  const loc = d.location || 'Unknown';
  const lines = [];
  lines.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  lines.push('!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tMEMO');
  lines.push('!ENDTRNS');
  const gcDeposit = d.actual_gc_deposit || 0;
  if (gcDeposit) {
    lines.push(`TRNS\tDEPOSIT\t${date}\tChecking Account\t\t${loc}\t${gcDeposit}\tGC Deposit - ${loc}`);
    lines.push(`SPL\tDEPOSIT\t${date}\tSweepstakes Revenue\t\t${loc}\t${-gcDeposit}\tGC Deposit`);
    lines.push('ENDTRNS');
  }
  const skillDep = d.skill_deposit || 0;
  if (skillDep) {
    lines.push(`TRNS\tDEPOSIT\t${date}\tChecking Account\t\t${loc}\t${skillDep}\tSkill Deposit - ${loc}`);
    lines.push(`SPL\tDEPOSIT\t${date}\tSkill Game Revenue\t\t${loc}\t${-skillDep}\tSkill Deposit`);
    lines.push('ENDTRNS');
  }
  const barSales = d.sales_bar || 0;
  const kitchenSales = d.sales_kitchen || 0;
  if (barSales || kitchenSales) {
    const totalSales = barSales + kitchenSales;
    lines.push(`TRNS\tDEPOSIT\t${date}\tChecking Account\t\t${loc}\t${d.total_cash_deposit || totalSales}\tCash Deposit - ${loc}`);
    if (barSales) lines.push(`SPL\tDEPOSIT\t${date}\tBar Sales\t\t${loc}\t${-barSales}\tBar Sales`);
    if (kitchenSales) lines.push(`SPL\tDEPOSIT\t${date}\tKitchen Sales\t\t${loc}\t${-kitchenSales}\tKitchen Sales`);
    const ccTotal = (d.total_credit_cards || 0) + (d.bar_credit_cards || 0);
    if (ccTotal) lines.push(`SPL\tDEPOSIT\t${date}\tCredit Card Clearing\t\t${loc}\t${ccTotal}\tCredit Cards`);
    if (d.sales_comps) lines.push(`SPL\tDEPOSIT\t${date}\tComps Expense\t\t${loc}\t${d.sales_comps}\tComps`);
    if (d.total_taxes) lines.push(`SPL\tDEPOSIT\t${date}\tSales Tax Payable\t\t${loc}\t${-(d.total_taxes)}\tTaxes`);
    if (d.total_tips) lines.push(`SPL\tDEPOSIT\t${date}\tTips Payable\t\t${loc}\t${-(d.total_tips)}\tTips`);
    lines.push('ENDTRNS');
  }
  if (d.ep_total) {
    lines.push(`TRNS\tDEPOSIT\t${date}\tChecking Account\t\t${loc}\t${d.ep_total}\tEasy Play - ${loc}`);
    lines.push(`SPL\tDEPOSIT\t${date}\tCOAM Revenue\t\t${loc}\t${-d.ep_total}\tEasy Play`);
    lines.push('ENDTRNS');
  }
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="DSR_${loc.replace(/\s/g,'_')}_${d.report_date}.iif"`);
  res.send(lines.join('\n'));
});

function formatIIFDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DSR API running on port ${PORT}`);
});
