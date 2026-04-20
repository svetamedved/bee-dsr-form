import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'rss_revenue',
  waitForConnections: true,
  connectionLimit: 10,
});
app.post('/api/reports', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const d = req.body;
    const vendors = [
      { name:'Maverick', type:'sweepstakes', i:d.maverick_in, o:d.maverick_out },
      { name:'Rimfire', type:'sweepstakes', i:d.rimfire_in, o:d.rimfire_out },
      { name:'Phoenix', type:'sweepstakes', i:d.phoenix_in, o:d.phoenix_out },
      { name:'Riversweep', type:'sweepstakes', i:d.riversweep_in, o:d.riversweep_out },
      { name:'Golden Dragon', type:'sweepstakes', i:d.golden_dragon_in, o:d.golden_dragon_out },
    ];
    if (d.ep_total) vendors.push({ name:'Easy Play', type:'coam', i:d.ep_total, o:0 });
    for (const v of vendors) {
      if (!v.i && !v.o) continue;
      await conn.execute(
        'INSERT INTO daily_revenue (location,report_date,manager,vendor_name,game_type,total_in,total_out,net_revenue) VALUES (?,?,?,?,?,?,?,?)',
        [d.location, d.report_date, d.manager, v.name, v.type, v.i||0, v.o||0, (v.i||0)-(v.o||0)]
      );
    }
    if (d.cabinets?.length) {
      for (const cab of d.cabinets) {
        if (!cab.in && !cab.out) continue;
        await conn.execute(
          'INSERT INTO daily_cabinet_revenue (location,report_date,cabinet_name,terminal_id,serial_num,total_in,total_out,net_revenue,skill_deposit) VALUES (?,?,?,?,?,?,?,?,?)',
          [d.location, d.report_date, cab.name, cab.tid||null, cab.serial||null, cab.in||0, cab.out||0, (cab.in||0)-(cab.out||0), d.skill_deposit||0]
        );
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  } finally { conn.release(); }
});
app.get('/api/reports', async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM daily_revenue ORDER BY report_date DESC LIMIT 200');
  res.json(rows);
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('DSR API on port ' + PORT));
