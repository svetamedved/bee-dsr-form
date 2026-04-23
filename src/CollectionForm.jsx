// CollectionForm — matches the paper form the active collector (David) uses
// for third-party venues. Two layouts sharing one submit path:
//
//   big_easy venues  — 2 × $2,500 waterfall (BE fills first tranche, Location
//                      fills second, remainder splits per percentage). Venues
//                      like Buc's BNG use this.
//   percentage venues — flat percentage split on net cash.
//
// The paper form has these sections (top → bottom):
//   1. Header (date, venue, collector auto)
//   2. Total IN / Total OUT / Net Cash  (single aggregate, not per-cabinet —
//      collectors add up the cabinet tapes on paper and bring one IN / OUT)
//   3. Bills Collected — 6 denominations ($10, $50, $100, $1, $5, $20)
//   4. CRT Says/Actual/Added/Final — 4 rows ($1, $5, $20, $20) with totals
//   5. Reject Tray Says / Actual
//   6. Added or Exchanged toggle + note
//   7. Waterfall tracker (big_easy only) — prior tranches + this collection's
//      contribution to each + remaining after
//   8. Split result (BE this pickup / Location this pickup)
//   9. Deposit Ask / Actual + diff
//  10. Notes + Photos
//  11. Submit
//
// Waterfall math (verified against Buc's BNG 4/12/26 and 4/19/26):
//   t1_cap = 2500, t2_cap = 2500
//   to_t1 = min(net, t1_cap - prior_t1)              // 100% to BE
//   to_t2 = min(net - to_t1, t2_cap - prior_t2)      // 100% to Location
//   remainder = net - to_t1 - to_t2
//   be_from_split       = remainder * pct / 100
//   location_from_split = remainder - be_from_split
//   be_total       = to_t1 + be_from_split
//   location_total = to_t2 + location_from_split
//
// Percentage math: be_total = net * pct / 100; location_total = net - be_total.
//
// Submit POSTs to /api/collections with split_override (when set) and a
// `payload` that contains the frozen derived totals so admin + IIF export work
// from the snapshot rather than recomputing.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { api } from './auth.js';

const TRANCHE_CAP = 2500;

const money = n => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(x) {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

// Default split for a venue — used unless the collector overrides.
function defaultSplit(venue) {
  if (venue.collection_split_type === 'big_easy') {
    return { type: 'big_easy', percentage: Number(venue.split_percentage) || 50 };
  }
  return { type: 'percentage', percentage: Number(venue.split_percentage) || 50 };
}

// 6-denomination bill breakdown (paper form order).
const BILL_DENOMS = [
  { key: 'd10',  value: 10,  label: '$10'  },
  { key: 'd50',  value: 50,  label: '$50'  },
  { key: 'd100', value: 100, label: '$100' },
  { key: 'd1',   value: 1,   label: '$1'   },
  { key: 'd5',   value: 5,   label: '$5'   },
  { key: 'd20',  value: 20,  label: '$20'  },
];

// CRT reconciliation rows. Paper form has two $20 rows (one per $20 cassette).
const CRT_ROWS = [
  { key: 'c1',  label: '$1'  },
  { key: 'c5',  label: '$5'  },
  { key: 'c20a', label: '$20 (A)' },
  { key: 'c20b', label: '$20 (B)' },
];

export default function CollectionForm({ venue, user, onDone, onCancel }) {
  const [reportDate, setReportDate] = useState(todayISO());

  // Aggregate cabinet readings (paper form doesn't go per-cabinet at submit).
  const [totalInStr, setTotalInStr] = useState('');
  const [totalOutStr, setTotalOutStr] = useState('');

  // Bills collected breakdown — count of bills, not $.
  const [bills, setBills] = useState(() =>
    Object.fromEntries(BILL_DENOMS.map(b => [b.key, '']))
  );

  // CRT reconciliation — 4 rows × 4 columns. Stored as cents/dollars (actual $).
  const [crt, setCrt] = useState(() =>
    Object.fromEntries(CRT_ROWS.map(r => [r.key, { says: '', actual: '', added: '', final: '' }]))
  );

  // Reject tray
  const [rejectSays, setRejectSays] = useState('');
  const [rejectActual, setRejectActual] = useState('');

  // Added-or-exchanged toggle + note
  const [addedOrExchanged, setAddedOrExchanged] = useState('none'); // 'none' | 'added' | 'exchanged'
  const [addedExchangedNote, setAddedExchangedNote] = useState('');

  // Waterfall (big_easy) prior-state: what's already been paid toward each
  // tranche this month before this collection.
  //
  // Each calendar month is a clean slate for big_easy venues — any balance
  // left over at end of month drops (confirmed with Sveta). So "prior paid"
  // is auto-loaded by summing to_t1 / to_t2 from pending+approved collections
  // at this venue in the same YYYY-MM as the selected report date.
  const [priorT1, setPriorT1] = useState('');
  const [priorT2, setPriorT2] = useState('');
  const [priorAutoLoaded, setPriorAutoLoaded] = useState(null); // { t1_paid, t2_paid, collections }
  const [priorLoading, setPriorLoading] = useState(false);
  const [priorOverride, setPriorOverride] = useState(false); // let admin/collector override the auto value

  // Deposit
  const [depositAsk, setDepositAsk] = useState('');
  const [depositActual, setDepositActual] = useState('');

  // Notes + photos
  const [notes, setNotes] = useState('');
  const [imageIds, setImageIds] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Split override (one-off)
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideSplit, setOverrideSplit] = useState(() => defaultSplit(venue));
  const [overrideReason, setOverrideReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (text, kind = 'ok') => {
    setToast({ text, kind });
    if (showToast._t) clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 3000);
  };

  const activeSplit = overrideOn ? overrideSplit : defaultSplit(venue);
  const isBigEasyEffective = activeSplit.type === 'big_easy';

  // Auto-load prior tranche state whenever (venue, report month) changes and
  // we're in big_easy mode. On the 1st of a new month this returns 0/0, which
  // is the "clean slate" the user expects.
  useEffect(() => {
    if (!isBigEasyEffective) return;
    if (priorOverride) return; // user took manual control
    if (!reportDate) return;
    const month = reportDate.slice(0, 7); // YYYY-MM
    let cancelled = false;
    setPriorLoading(true);
    api(`/api/collections/prior?location_id=${venue.id}&month=${month}`)
      .then(resp => {
        if (cancelled) return;
        setPriorAutoLoaded(resp);
        setPriorT1(String(resp.t1_paid ?? 0));
        setPriorT2(String(resp.t2_paid ?? 0));
      })
      .catch(() => {
        if (cancelled) return;
        // Endpoint might not be deployed yet — fall back to manual entry.
        setPriorAutoLoaded(null);
      })
      .finally(() => { if (!cancelled) setPriorLoading(false); });
    return () => { cancelled = true; };
  }, [venue.id, reportDate, isBigEasyEffective, priorOverride]);

  // All derived values — recomputed every render, never stored.
  const derived = useMemo(() => {
    const totalIn = num(totalInStr);
    const totalOut = num(totalOutStr);
    const net = totalIn - totalOut;

    // Bills total
    const billsTotal = BILL_DENOMS.reduce(
      (s, b) => s + num(bills[b.key]) * b.value, 0
    );

    // CRT totals by column
    const crtTotals = { says: 0, actual: 0, added: 0, final: 0 };
    for (const r of CRT_ROWS) {
      crtTotals.says   += num(crt[r.key].says);
      crtTotals.actual += num(crt[r.key].actual);
      crtTotals.added  += num(crt[r.key].added);
      crtTotals.final  += num(crt[r.key].final);
    }
    // CRT over/short: Actual vs Says (positive = over, negative = short)
    const crtDiff = crtTotals.actual - crtTotals.says;

    // Reject over/short
    const rejectDiff = num(rejectActual) - num(rejectSays);

    // Waterfall / split
    const pct = Number(activeSplit.percentage) || 0;
    let waterfall = null;
    let beTotal = 0;
    let locationTotal = 0;

    if (activeSplit.type === 'big_easy') {
      const t1Prior = num(priorT1);
      const t2Prior = num(priorT2);
      const t1Remaining = Math.max(0, TRANCHE_CAP - t1Prior);
      const t2Remaining = Math.max(0, TRANCHE_CAP - t2Prior);
      const toT1 = Math.max(0, Math.min(net, t1Remaining));
      const netAfterT1 = Math.max(0, net - toT1);
      const toT2 = Math.max(0, Math.min(netAfterT1, t2Remaining));
      const remainder = Math.max(0, netAfterT1 - toT2);
      const beFromSplit = remainder * pct / 100;
      const locationFromSplit = remainder - beFromSplit;
      beTotal = toT1 + beFromSplit;
      locationTotal = toT2 + locationFromSplit;

      waterfall = {
        t1_prior: t1Prior,
        t2_prior: t2Prior,
        t1_remaining_before: t1Remaining,
        t2_remaining_before: t2Remaining,
        to_t1: toT1,
        to_t2: toT2,
        remainder,
        be_from_split: beFromSplit,
        location_from_split: locationFromSplit,
        t1_paid_after: t1Prior + toT1,
        t2_paid_after: t2Prior + toT2,
        t1_remaining_after: Math.max(0, TRANCHE_CAP - (t1Prior + toT1)),
        t2_remaining_after: Math.max(0, TRANCHE_CAP - (t2Prior + toT2)),
      };
    } else {
      // percentage
      beTotal = net * pct / 100;
      locationTotal = net - beTotal;
    }

    const depositDiff = num(depositActual) - num(depositAsk);

    return {
      totalIn, totalOut, net,
      billsTotal, crtTotals, crtDiff,
      rejectDiff,
      waterfall, beTotal, locationTotal,
      depositDiff,
    };
  }, [totalInStr, totalOutStr, bills, crt, rejectSays, rejectActual,
      priorT1, priorT2, depositAsk, depositActual, activeSplit]);

  const setCrtCell = (row, col, val) => {
    setCrt(c => ({ ...c, [row]: { ...c[row], [col]: val } }));
  };
  const setBill = (k, val) => setBills(b => ({ ...b, [k]: val }));

  const handlePhotoChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('image', f);
        const tok = localStorage.getItem('bee_token');
        const res = await fetch('/api/images', {
          method: 'POST',
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json();
        setImageIds(prev => [...prev, j.id]);
        setImagePreviews(prev => [...prev, { id: j.id, name: f.name }]);
      }
    } catch (ex) {
      showToast('Photo upload failed: ' + ex.message, 'err');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = id => {
    setImageIds(prev => prev.filter(x => x !== id));
    setImagePreviews(prev => prev.filter(x => x.id !== id));
  };

  const canSubmit = () => {
    if (!reportDate) return false;
    if (!totalInStr && !totalOutStr) return false;
    return true;
  };

  const submit = async () => {
    if (submitting) return;
    if (!canSubmit()) { showToast('Enter Total IN / OUT and date', 'err'); return; }
    if (overrideOn && !overrideReason.trim()) {
      showToast('Split override needs a reason', 'err'); return;
    }
    setSubmitting(true);
    try {
      const body = {
        location_id: venue.id,
        report_date: reportDate,
        notes,
        split_override: overrideOn
          ? { type: overrideSplit.type, percentage: Number(overrideSplit.percentage), reason: overrideReason.trim() }
          : null,
        payload: {
          total_in: derived.totalIn,
          total_out: derived.totalOut,
          net_cash: derived.net,
          bills: Object.fromEntries(BILL_DENOMS.map(b => [b.key, num(bills[b.key])])),
          bills_total: derived.billsTotal,
          crt: Object.fromEntries(CRT_ROWS.map(r => [r.key, {
            says: num(crt[r.key].says),
            actual: num(crt[r.key].actual),
            added: num(crt[r.key].added),
            final: num(crt[r.key].final),
          }])),
          crt_totals: derived.crtTotals,
          crt_diff: derived.crtDiff,
          reject: {
            says: num(rejectSays),
            actual: num(rejectActual),
            diff: derived.rejectDiff,
          },
          added_or_exchanged: {
            mode: addedOrExchanged,
            note: addedExchangedNote.trim(),
          },
          deposit: {
            ask: num(depositAsk),
            actual: num(depositActual),
            diff: derived.depositDiff,
          },
          waterfall: derived.waterfall,
          waterfall_prior_override: priorOverride,   // true if collector edited prior-paid manually
          waterfall_prior_autoloaded: priorAutoLoaded // snapshot of what server returned for audit
            ? { t1_paid: priorAutoLoaded.t1_paid, t2_paid: priorAutoLoaded.t2_paid, collection_count: priorAutoLoaded.collections?.length ?? 0 }
            : null,
          split_used: activeSplit,
          be_total: derived.beTotal,
          location_total: derived.locationTotal,
          image_ids: imageIds,
        },
      };
      await api('/api/collections', { method: 'POST', body: JSON.stringify(body) });
      showToast('✓ Collection submitted for review');
      setTimeout(() => onDone && onDone(), 700);
    } catch (ex) {
      showToast('Submit failed: ' + ex.message, 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const isBigEasy = isBigEasyEffective;

  return (
    <div style={wrap}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
      <div style={topbar}>
        <button onClick={onCancel} style={signoutBtn}>← Back</button>
        <div style={{flex:1,fontSize:14,fontWeight:900,paddingLeft:14,fontFamily:"'Fraunces',serif"}}>
          {venue.name} · Collection
        </div>
        <div style={{fontSize:11,color:'#FAD6A5',opacity:0.9}}>Collector: <b>{user.name || user.email}</b></div>
      </div>

      <div style={body}>
        {toast && (
          <div style={{
            padding:'10px 14px', borderRadius:8, fontSize:13, fontWeight:700,
            background: toast.kind === 'err' ? '#FDEDED' : '#EAF5DC',
            border: `2px solid ${toast.kind === 'err' ? '#A03030' : '#4A7A2D'}`,
            color:   toast.kind === 'err' ? '#A03030' : '#234A12',
          }}>{toast.text}</div>
        )}

        {/* 1. Header */}
        <div style={card}>
          <div style={cardHeader}>Collection details</div>
          <div style={{padding:16,display:'grid',gap:14,gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))'}}>
            <Field label="Date of collection">
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} style={input}/>
            </Field>
            <Field label="Venue">
              <div style={{...readonly, background:'#FBF2D8'}}>{venue.name}</div>
            </Field>
            <Field label="Split in effect">
              <div style={{...readonly, background:'#FBF2D8'}}>
                {isBigEasy ? `Big Easy · 2×${money(TRANCHE_CAP)} waterfall then ${activeSplit.percentage}%` : `${activeSplit.percentage}% split`}
                {overrideOn && <span style={{marginLeft:8,color:'#A03030',fontWeight:900}}>(OVERRIDDEN)</span>}
              </div>
            </Field>
          </div>
        </div>

        {/* 2. Aggregate IN / OUT / Net */}
        <div style={card}>
          <div style={cardHeader}>Total IN / OUT</div>
          <div style={{padding:16,display:'grid',gap:14,gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))'}}>
            <Field label="Total IN (cabinets 1–n)">
              <input type="number" step="0.01" inputMode="decimal" value={totalInStr}
                onChange={e => setTotalInStr(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Total OUT (cabinets 1–n)">
              <input type="number" step="0.01" inputMode="decimal" value={totalOutStr}
                onChange={e => setTotalOutStr(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Net Cash">
              <div style={{...readonly, background:'#FBF2D8', fontWeight:900, fontSize:16, fontFamily:"'Fraunces',serif",
                color: derived.net < 0 ? '#A03030' : '#234A12'}}>
                {money(derived.net)}
              </div>
            </Field>
          </div>
        </div>

        {/* 3. Bills Collected */}
        <div style={card}>
          <div style={cardHeader}>Bills collected (count by denomination)</div>
          <div style={{padding:16}}>
            <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))'}}>
              {BILL_DENOMS.map(b => (
                <Field key={b.key} label={`${b.label} × count`}>
                  <input type="number" min="0" step="1" value={bills[b.key]}
                    onChange={e => setBill(b.key, e.target.value)} style={input} placeholder="0"/>
                  <div style={{fontSize:10,color:'#6B5A4E',marginTop:2,fontWeight:700}}>
                    = {money(num(bills[b.key]) * b.value)}
                  </div>
                </Field>
              ))}
            </div>
            <div style={{marginTop:14,padding:'10px 14px',background:'#FBF2D8',border:'2px solid #000',borderRadius:7,
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase'}}>Bills total</span>
              <span style={{fontSize:18,fontWeight:900,fontFamily:"'Fraunces',serif"}}>{money(derived.billsTotal)}</span>
            </div>
          </div>
        </div>

        {/* 4. CRT reconciliation */}
        <div style={card}>
          <div style={cardHeader}>CRT: Says / Actual / Added / Final</div>
          <div style={{padding:16,overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:560}}>
              <thead>
                <tr style={{background:'#FAD6A5'}}>
                  <th style={{...th,textAlign:'left'}}>Denom</th>
                  <th style={{...th,textAlign:'right'}}>CRT Says</th>
                  <th style={{...th,textAlign:'right'}}>Actual</th>
                  <th style={{...th,textAlign:'right'}}>Added</th>
                  <th style={{...th,textAlign:'right'}}>Final</th>
                </tr>
              </thead>
              <tbody>
                {CRT_ROWS.map(r => (
                  <tr key={r.key} style={{borderTop:'1px solid #F5EBE0'}}>
                    <td style={td}><b>{r.label}</b></td>
                    {['says','actual','added','final'].map(col => (
                      <td key={col} style={td}>
                        <input type="number" step="0.01" inputMode="decimal"
                          value={crt[r.key][col]}
                          onChange={e => setCrtCell(r.key, col, e.target.value)}
                          style={{...input,textAlign:'right',width:'100%'}} placeholder="0.00"/>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:'#FBF2D8',borderTop:'2px solid #000'}}>
                  <td style={{...td,fontWeight:900}}>Totals</td>
                  <td style={{...td,textAlign:'right',fontWeight:900}}>{money(derived.crtTotals.says)}</td>
                  <td style={{...td,textAlign:'right',fontWeight:900}}>{money(derived.crtTotals.actual)}</td>
                  <td style={{...td,textAlign:'right',fontWeight:900}}>{money(derived.crtTotals.added)}</td>
                  <td style={{...td,textAlign:'right',fontWeight:900}}>{money(derived.crtTotals.final)}</td>
                </tr>
                <tr style={{background:'#FFF'}}>
                  <td style={{...td,fontWeight:700,color:'#6B5A4E'}}>Over / Short</td>
                  <td style={td}></td>
                  <td style={{...td,textAlign:'right',fontWeight:900,
                    color: derived.crtDiff < 0 ? '#A03030' : derived.crtDiff > 0 ? '#234A12' : '#3D2E1F'}} colSpan={3}>
                    {derived.crtDiff >= 0 ? '+' : ''}{money(derived.crtDiff)}
                    <span style={{fontSize:10,color:'#6B5A4E',marginLeft:6,fontWeight:700,fontStyle:'italic'}}>
                      (Actual − Says)
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 5. Reject tray */}
        <div style={card}>
          <div style={cardHeader}>Reject tray</div>
          <div style={{padding:16,display:'grid',gap:14,gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))'}}>
            <Field label="Reject says">
              <input type="number" step="0.01" inputMode="decimal" value={rejectSays}
                onChange={e => setRejectSays(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Reject actual">
              <input type="number" step="0.01" inputMode="decimal" value={rejectActual}
                onChange={e => setRejectActual(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Over / Short">
              <div style={{...readonly,
                color: derived.rejectDiff < 0 ? '#A03030' : derived.rejectDiff > 0 ? '#234A12' : '#3D2E1F',
                background: '#FBF2D8', fontWeight:900}}>
                {derived.rejectDiff >= 0 ? '+' : ''}{money(derived.rejectDiff)}
              </div>
            </Field>
          </div>
        </div>

        {/* 6. Added or Exchanged */}
        <div style={card}>
          <div style={cardHeader}>Added or Exchanged</div>
          <div style={{padding:16,display:'flex',flexDirection:'column',gap:12}}>
            <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
              {[
                { v: 'none', l: 'Neither' },
                { v: 'added', l: 'Added' },
                { v: 'exchanged', l: 'Exchanged' },
              ].map(o => (
                <label key={o.v} style={{display:'flex',gap:6,alignItems:'center',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                  <input type="radio" name="aox" value={o.v}
                    checked={addedOrExchanged === o.v}
                    onChange={e => setAddedOrExchanged(e.target.value)}/>
                  {o.l}
                </label>
              ))}
            </div>
            {addedOrExchanged !== 'none' && (
              <Field label={`${addedOrExchanged === 'added' ? 'Added' : 'Exchanged'} note`}>
                <textarea value={addedExchangedNote} onChange={e => setAddedExchangedNote(e.target.value)} rows={2}
                  placeholder={`What was ${addedOrExchanged}? (denom, amount, reason)`}
                  style={{...input,width:'100%',resize:'vertical',minHeight:50}}/>
              </Field>
            )}
          </div>
        </div>

        {/* 7 + 8. Waterfall / split result */}
        {isBigEasy ? (
          <div style={card}>
            <div style={cardHeader}>Big Easy waterfall — 2 × {money(TRANCHE_CAP)} then {activeSplit.percentage}%</div>
            <div style={{padding:16,display:'flex',flexDirection:'column',gap:14}}>
              <div style={{fontSize:12,color:'#6B5A4E',lineHeight:1.5}}>
                <b>Monthly clean slate.</b> Prior paid auto-loads from this venue's earlier collections in <b>{reportDate.slice(0,7)}</b>.
                New month → both reset to $0 even if last month wasn't fully paid.
                {priorLoading && <span style={{marginLeft:6,fontStyle:'italic'}}>Loading prior state…</span>}
                {priorAutoLoaded && priorAutoLoaded.collections.length > 0 && !priorOverride && (
                  <span style={{marginLeft:6}}>
                    · Loaded from {priorAutoLoaded.collections.length} earlier collection{priorAutoLoaded.collections.length === 1 ? '' : 's'} this month.
                  </span>
                )}
              </div>
              <div style={{display:'grid',gap:14,gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))'}}>
                <Field label={`Prior paid — Tranche 1 (BE, cap ${money(TRANCHE_CAP)})`}>
                  {priorOverride ? (
                    <input type="number" step="0.01" inputMode="decimal" value={priorT1}
                      onChange={e => setPriorT1(e.target.value)} style={input} placeholder="0.00"/>
                  ) : (
                    <div style={{...readonly, background:'#FBF2D8', fontWeight:900}}>
                      {money(num(priorT1))}
                    </div>
                  )}
                </Field>
                <Field label={`Prior paid — Tranche 2 (Location, cap ${money(TRANCHE_CAP)})`}>
                  {priorOverride ? (
                    <input type="number" step="0.01" inputMode="decimal" value={priorT2}
                      onChange={e => setPriorT2(e.target.value)} style={input} placeholder="0.00"/>
                  ) : (
                    <div style={{...readonly, background:'#FBF2D8', fontWeight:900}}>
                      {money(num(priorT2))}
                    </div>
                  )}
                </Field>
              </div>
              <label style={{display:'flex',gap:8,alignItems:'center',fontSize:12,fontWeight:700,cursor:'pointer',color:'#6B5A4E'}}>
                <input type="checkbox" checked={priorOverride}
                  onChange={e => setPriorOverride(e.target.checked)}/>
                Manually override prior-paid values (use only if auto-load is wrong)
              </label>

              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginTop:6}}>
                <thead>
                  <tr style={{background:'#FAD6A5'}}>
                    <th style={th}>Step</th>
                    <th style={{...th,textAlign:'right'}}>BE</th>
                    <th style={{...th,textAlign:'right'}}>Location</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderTop:'1px solid #F5EBE0'}}>
                    <td style={td}>
                      <b>Tranche 1</b>
                      <div style={{fontSize:11,color:'#6B5A4E'}}>100% to BE until {money(TRANCHE_CAP)} paid</div>
                    </td>
                    <td style={{...td,textAlign:'right',fontWeight:900,color:'#234A12'}}>
                      {money(derived.waterfall?.to_t1 || 0)}
                    </td>
                    <td style={{...td,textAlign:'right',color:'#6B5A4E'}}>—</td>
                  </tr>
                  <tr style={{borderTop:'1px solid #F5EBE0'}}>
                    <td style={td}>
                      <b>Tranche 2</b>
                      <div style={{fontSize:11,color:'#6B5A4E'}}>100% to Location until {money(TRANCHE_CAP)} paid</div>
                    </td>
                    <td style={{...td,textAlign:'right',color:'#6B5A4E'}}>—</td>
                    <td style={{...td,textAlign:'right',fontWeight:900,color:'#234A12'}}>
                      {money(derived.waterfall?.to_t2 || 0)}
                    </td>
                  </tr>
                  <tr style={{borderTop:'1px solid #F5EBE0'}}>
                    <td style={td}>
                      <b>Remainder split</b>
                      <div style={{fontSize:11,color:'#6B5A4E'}}>
                        {money(derived.waterfall?.remainder || 0)} × {activeSplit.percentage}% / {100 - activeSplit.percentage}%
                      </div>
                    </td>
                    <td style={{...td,textAlign:'right',fontWeight:900}}>
                      {money(derived.waterfall?.be_from_split || 0)}
                    </td>
                    <td style={{...td,textAlign:'right',fontWeight:900}}>
                      {money(derived.waterfall?.location_from_split || 0)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{background:'#FBF2D8',borderTop:'2px solid #000'}}>
                    <td style={{...td,fontWeight:900,textTransform:'uppercase',letterSpacing:1}}>This pickup</td>
                    <td style={{...td,textAlign:'right',fontWeight:900,fontSize:16,fontFamily:"'Fraunces',serif"}}>
                      {money(derived.beTotal)}
                    </td>
                    <td style={{...td,textAlign:'right',fontWeight:900,fontSize:16,fontFamily:"'Fraunces',serif"}}>
                      {money(derived.locationTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',marginTop:6}}>
                <SummaryStat label="T1 paid after (BE)"
                  value={money(derived.waterfall?.t1_paid_after || 0)}
                  sub={`${money(derived.waterfall?.t1_remaining_after || 0)} still owed`}/>
                <SummaryStat label="T2 paid after (Location)"
                  value={money(derived.waterfall?.t2_paid_after || 0)}
                  sub={`${money(derived.waterfall?.t2_remaining_after || 0)} still owed`}/>
              </div>
            </div>
          </div>
        ) : (
          <div style={card}>
            <div style={cardHeader}>Split — {activeSplit.percentage}% BE</div>
            <div style={{padding:16,display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))'}}>
              <SummaryStat label="BE this pickup" value={money(derived.beTotal)} emphasis="pos"/>
              <SummaryStat label="Location this pickup" value={money(derived.locationTotal)} emphasis="pos"/>
            </div>
          </div>
        )}

        {/* 9. Deposit */}
        <div style={card}>
          <div style={cardHeader}>Deposit</div>
          <div style={{padding:16,display:'grid',gap:14,gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))'}}>
            <Field label="Deposit ASK">
              <input type="number" step="0.01" inputMode="decimal" value={depositAsk}
                onChange={e => setDepositAsk(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Deposit actual">
              <input type="number" step="0.01" inputMode="decimal" value={depositActual}
                onChange={e => setDepositActual(e.target.value)} style={input} placeholder="0.00"/>
            </Field>
            <Field label="Deposit over / short">
              <div style={{...readonly, background:'#FBF2D8', fontWeight:900,
                color: derived.depositDiff < 0 ? '#A03030' : derived.depositDiff > 0 ? '#234A12' : '#3D2E1F'}}>
                {derived.depositDiff >= 0 ? '+' : ''}{money(derived.depositDiff)}
              </div>
            </Field>
          </div>
        </div>

        {/* Split override */}
        <div style={card}>
          <div style={cardHeader}>Split override (one-off)</div>
          <div style={{padding:16,display:'flex',flexDirection:'column',gap:12,fontSize:13}}>
            <label style={{display:'flex',gap:10,alignItems:'center',cursor:'pointer',fontWeight:700}}>
              <input type="checkbox" checked={overrideOn} onChange={e => setOverrideOn(e.target.checked)}/>
              Use a different split just for this collection
            </label>
            {overrideOn && (
              <>
                <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))'}}>
                  <Field label="Split type">
                    <select value={overrideSplit.type}
                      onChange={e => setOverrideSplit(s => ({...s, type: e.target.value}))} style={input}>
                      <option value="percentage">Percentage</option>
                      <option value="big_easy">Big Easy (waterfall)</option>
                    </select>
                  </Field>
                  <Field label="BE percentage">
                    <input type="number" min="0" max="100" step="0.01" value={overrideSplit.percentage}
                      onChange={e => setOverrideSplit(s => ({...s, percentage: e.target.value}))} style={input}/>
                  </Field>
                  <Field label="Reason (required)">
                    <input type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                      style={input} placeholder="e.g. promo, renegotiated terms"/>
                  </Field>
                </div>
                <div style={{fontSize:12,color:'#6B5A4E',fontStyle:'italic'}}>
                  This override only affects this submission. The venue's default stays <b>
                  {defaultSplit(venue).type === 'big_easy' ? 'Big Easy' : 'Percentage'} · {defaultSplit(venue).percentage}%</b>.
                </div>
              </>
            )}
          </div>
        </div>

        {/* Photos */}
        <div style={card}>
          <div style={cardHeader}>Photos</div>
          <div style={{padding:16,display:'flex',flexDirection:'column',gap:12}}>
            <div style={{fontSize:12,color:'#6B5A4E'}}>
              CRT display photos, before/after-fill photos, reject-tray photo, deposit slip — anything that backs the numbers.
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoChange} style={{fontSize:13}}/>
            {uploading && <div style={{fontSize:12,color:'#6B5A4E'}}>Uploading…</div>}
            {imagePreviews.length > 0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {imagePreviews.map(p => (
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',background:'#FBF2D8',border:'1.5px solid #000',borderRadius:6,fontSize:12}}>
                    <span>{p.name}</span>
                    <button onClick={() => removeImage(p.id)} style={{border:'none',background:'transparent',cursor:'pointer',color:'#A03030',fontWeight:900}}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div style={card}>
          <div style={cardHeader}>Notes</div>
          <div style={{padding:16}}>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="Anything the admin should know before approving this collection"
              style={{...input, width:'100%', resize:'vertical', minHeight:80}}/>
          </div>
        </div>

        {/* Submit */}
        <div style={{display:'flex',gap:12,justifyContent:'flex-end',paddingBottom:30}}>
          <button onClick={onCancel} style={secondaryBtn} disabled={submitting}>Cancel</button>
          <button onClick={submit} style={primaryBtn} disabled={submitting || !canSubmit()}>
            {submitting ? 'Submitting…' : 'Submit collection'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:12,fontWeight:700}}>
      <span style={{fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#3D2E1F'}}>{label}</span>
      {children}
    </label>
  );
}

function SummaryStat({ label, value, emphasis, sub }) {
  const color = emphasis === 'neg' ? '#A03030' : emphasis === 'pos' ? '#234A12' : '#3D2E1F';
  return (
    <div style={{background:'#FFF',border:'2px solid #000',borderRadius:8,padding:'10px 12px',boxShadow:'2px 2px 0 #000'}}>
      <div style={{fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#6B5A4E'}}>{label}</div>
      <div style={{fontSize:18,fontWeight:900,color,fontFamily:"'Fraunces',serif"}}>{value}</div>
      {sub && <div style={{fontSize:10,color:'#6B5A4E',fontStyle:'italic',marginTop:2}}>{sub}</div>}
    </div>
  );
}

const wrap = {minHeight:'100vh',background:'linear-gradient(180deg,#4A3B5C 0%,#8B6F8E 25%,#D89AA5 55%,#F5B88B 85%,#FCE8C8 100%)',fontFamily:"'DM Sans',-apple-system,sans-serif"};
const topbar = {display:'flex',alignItems:'center',gap:10,padding:'10px 20px',background:'#000',color:'#FAD6A5',borderBottom:'4px solid #FAD6A5'};
const body = {padding:20,maxWidth:1200,margin:'0 auto',display:'flex',flexDirection:'column',gap:20};
const card = {background:'#FFFDF9',border:'2px solid #000',borderRadius:12,boxShadow:'4px 4px 0 #000',overflow:'hidden'};
const cardHeader = {padding:'12px 16px',background:'#FAD6A5',borderBottom:'2px solid #000',fontSize:13,fontWeight:900,letterSpacing:2,textTransform:'uppercase'};
const input = {padding:'8px 10px',fontSize:13,border:'2px solid #000',borderRadius:6,background:'#FFF',fontFamily:"'DM Sans',sans-serif",outline:'none'};
const readonly = {padding:'8px 10px',fontSize:13,border:'2px solid #000',borderRadius:6,background:'#F5EBE0',fontWeight:700};
const primaryBtn = {padding:'10px 18px',fontSize:12,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',border:'2px solid #000',borderRadius:7,background:'#000',color:'#FAD6A5',cursor:'pointer',boxShadow:'2px 2px 0 #000'};
const secondaryBtn = {padding:'10px 18px',fontSize:12,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',border:'2px solid #000',borderRadius:7,background:'#FFF',color:'#000',cursor:'pointer',boxShadow:'2px 2px 0 #000'};
const signoutBtn = {padding:'5px 11px',fontSize:10,fontWeight:900,border:'2px solid #FAD6A5',background:'transparent',color:'#FAD6A5',borderRadius:6,cursor:'pointer'};
const th = {padding:'10px 14px',fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#3D2E1F',textAlign:'left'};
const td = {padding:'10px 14px',verticalAlign:'middle'};
