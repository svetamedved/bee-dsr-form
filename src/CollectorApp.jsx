// Collector dashboard — lists the third-party venues the signed-in collector
// has been assigned by an admin. Clicking a venue opens the collection form
// for that venue on a date the collector picks (collections are not daily,
// so the collector chooses when they do them).
//
// The actual collection form (CollectionForm.jsx) is a later task; for now this
// dashboard routes to a placeholder so the user flow can be validated.
import React, { useEffect, useState, useCallback } from 'react';
import { api, clearToken } from './auth.js';

function fmtDate(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#FFF4D6', bd: '#C98A1B', fg: '#6B4A0A', label: 'PENDING'  },
    approved: { bg: '#E6F5DC', bd: '#4A7A2D', fg: '#234A12', label: 'APPROVED' },
    rejected: { bg: '#FFE8E8', bd: '#A03030', fg: '#6B1818', label: 'REJECTED' },
  }[status] || { bg: '#EEE', bd: '#888', fg: '#333', label: status?.toUpperCase() || '—' };
  return <span style={{padding:'3px 9px',borderRadius:12,background:map.bg,border:`1.5px solid ${map.bd}`,
    color:map.fg,fontSize:10,fontWeight:900,letterSpacing:1}}>{map.label}</span>;
}

function splitLabel(v) {
  if (v.collection_split_type === 'big_easy') return 'Big Easy $2500';
  if (v.collection_split_type === 'percentage') return `${Number(v.split_percentage)}% split`;
  return '—';
}

export default function CollectorApp({ user, onLogout }) {
  const [venues, setVenues] = useState(user.assigned_venues || []);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // venue being collected

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, h] = await Promise.all([
        api('/api/my-venues'),
        api('/api/collections').catch(() => []), // endpoint may not exist yet
      ]);
      setVenues(v || []);
      setHistory(Array.isArray(h) ? h : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (active) {
    return <CollectionPlaceholder venue={active} user={user} onBack={() => { setActive(null); load(); }}/>;
  }

  return (
    <div style={wrap}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
      <div className="collector-topbar" style={topbar}>
        <div style={{fontSize:14,fontWeight:900,fontFamily:"'Fraunces',serif"}}>Collections</div>
        <div style={{flex:1,fontSize:11,color:'#FAD6A5',opacity:0.9,paddingLeft:14}}>
          Signed in as <b>{user.name || user.email}</b>
        </div>
        <button onClick={() => { clearToken(); onLogout(); }} style={signoutBtn}>Sign out</button>
      </div>

      <div style={body}>
        <div style={card}>
          <div style={cardHeader}>My venues</div>
          {loading ? (
            <div style={{padding:20,color:'#6B5A4E'}}>Loading…</div>
          ) : venues.length === 0 ? (
            <div style={{padding:20,color:'#6B5A4E',fontStyle:'italic'}}>
              No venues assigned yet. Ask an admin to assign you to a third-party venue in the Venue Manager.
            </div>
          ) : (
            <div style={{padding:16,display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))'}}>
              {venues.map(v => {
                const cabinets = v.cabinet_count ?? (() => {
                  try { return JSON.parse(v.cabinet_config_json || '[]').length || null; } catch { return null; }
                })();
                return (
                  <div key={v.id} style={venueCard}>
                    <div style={{fontSize:15,fontWeight:900,fontFamily:"'Fraunces',serif",marginBottom:4}}>{v.name}</div>
                    <div style={{fontSize:11,color:'#6B5A4E',fontWeight:700,letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>
                      {splitLabel(v)} · {cabinets ? `${cabinets} cabinet${cabinets === 1 ? '' : 's'}` : 'no cabinets configured'}
                    </div>
                    {v.address_line1 && (
                      <div style={{fontSize:12,color:'#3D2E1F',marginBottom:4}}>
                        {v.address_line1}{v.city ? `, ${v.city}` : ''}{v.state ? `, ${v.state}` : ''}
                      </div>
                    )}
                    {v.contact_name && (
                      <div style={{fontSize:12,color:'#6B5A4E',marginBottom:10}}>
                        Contact: {v.contact_name}{v.contact_phone ? ` · ${v.contact_phone}` : ''}
                      </div>
                    )}
                    <button onClick={() => setActive(v)} style={{...primaryBtn,width:'100%',marginTop:'auto'}}>
                      Start collection
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={card}>
          <div style={cardHeader}>My recent collections</div>
          {history.length === 0 ? (
            <div style={{padding:20,color:'#6B5A4E',fontStyle:'italic'}}>No collections yet.</div>
          ) : (
            <div className="table-wrap">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'#FBF2D8',textAlign:'left'}}>
                    <th style={th}>Date</th>
                    <th style={th}>Venue</th>
                    <th style={th}>Status</th>
                    <th style={th}>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} style={{borderTop:'1px solid #F5EBE0'}}>
                      <td style={td}><b>{fmtDate(h.report_date)}</b></td>
                      <td style={td}>{h.location_name}</td>
                      <td style={td}><StatusBadge status={h.status}/></td>
                      <td style={{...td,color:'#6B5A4E',fontSize:12}}>{h.submitted_at ? new Date(h.submitted_at).toLocaleString() : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Placeholder until the actual CollectionForm is built. Shows what the form
// WILL contain based on the venue's config, so the collector flow can be
// validated end-to-end.
function CollectionPlaceholder({ venue, user, onBack }) {
  const cabinets = (() => {
    try {
      const cfg = JSON.parse(venue.cabinet_config_json || '[]');
      if (Array.isArray(cfg) && cfg.length) return cfg;
    } catch {}
    const n = venue.cabinet_count || 0;
    return Array.from({ length: n }, (_, i) => ({ label: String(i + 1), type: 'redplum' }));
  })();
  return (
    <div style={wrap}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
      <div className="collector-topbar" style={topbar}>
        <button onClick={onBack} style={signoutBtn}>← Back</button>
        <div style={{flex:1,fontSize:14,fontWeight:900,paddingLeft:14,fontFamily:"'Fraunces',serif"}}>{venue.name}</div>
      </div>
      <div style={body}>
        <div style={card}>
          <div style={cardHeader}>Collection form (coming next)</div>
          <div style={{padding:20,display:'flex',flexDirection:'column',gap:12,fontSize:13,color:'#3D2E1F'}}>
            <div>
              The collection form UI is the next piece of work. Here's what it will render
              for <b>{venue.name}</b> based on the venue's config:
            </div>
            <div style={{padding:12,background:'#FBF2D8',border:'2px solid #000',borderRadius:8}}>
              <div><b>Collector:</b> {user.name || user.email} (auto-stamped from login)</div>
              <div><b>Split:</b> {splitLabel(venue)}</div>
              <div><b>Cabinets:</b> {cabinets.length || 'not configured yet'}</div>
            </div>
            {cabinets.length > 0 && (
              <table style={{borderCollapse:'collapse',fontSize:13,background:'#FFF',border:'2px solid #000',borderRadius:8,overflow:'hidden'}}>
                <thead>
                  <tr style={{background:'#FAD6A5'}}>
                    <th style={th}>Cabinet</th>
                    <th style={th}>Type</th>
                    <th style={th}>IN</th>
                    <th style={th}>OUT</th>
                  </tr>
                </thead>
                <tbody>
                  {cabinets.map((c, i) => (
                    <tr key={i} style={{borderTop:'1px solid #F5EBE0'}}>
                      <td style={td}><b>{c.label || i + 1}</b></td>
                      <td style={td}>{c.type === 'cardinal' ? 'Cardinal' : 'Redplum'}</td>
                      <td style={{...td,color:'#6B5A4E',fontStyle:'italic'}}>—</td>
                      <td style={{...td,color:'#6B5A4E',fontStyle:'italic'}}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{fontSize:12,color:'#6B5A4E',fontStyle:'italic'}}>
              Once the form is built, this page will render the full input grid with
              totals, deposit fields, photo uploads, and a Submit button.
            </div>
            <button onClick={onBack} style={{...primaryBtn,alignSelf:'flex-start'}}>Back to venues</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const wrap = {minHeight:'100vh',background:'linear-gradient(180deg,#4A3B5C 0%,#8B6F8E 25%,#D89AA5 55%,#F5B88B 85%,#FCE8C8 100%)',fontFamily:"'DM Sans',-apple-system,sans-serif"};
const topbar = {display:'flex',alignItems:'center',gap:10,padding:'10px 20px',background:'#000',color:'#FAD6A5',borderBottom:'4px solid #FAD6A5'};
const body = {padding:20,maxWidth:1200,margin:'0 auto',display:'flex',flexDirection:'column',gap:20};
const card = {background:'#FFFDF9',border:'2px solid #000',borderRadius:12,boxShadow:'4px 4px 0 #000',overflow:'hidden'};
const cardHeader = {padding:'12px 16px',background:'#FAD6A5',borderBottom:'2px solid #000',fontSize:13,fontWeight:900,letterSpacing:2,textTransform:'uppercase'};
const venueCard = {background:'#FFF',border:'2px solid #000',borderRadius:10,padding:14,boxShadow:'3px 3px 0 #000',display:'flex',flexDirection:'column'};
const primaryBtn = {padding:'8px 14px',fontSize:11,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',border:'2px solid #000',borderRadius:7,background:'#000',color:'#FAD6A5',cursor:'pointer',boxShadow:'2px 2px 0 #000'};
const signoutBtn = {padding:'5px 11px',fontSize:10,fontWeight:900,border:'2px solid #FAD6A5',background:'transparent',color:'#FAD6A5',borderRadius:6,cursor:'pointer'};
const th = {padding:'10px 14px',fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#3D2E1F',textAlign:'left'};
const td = {padding:'10px 14px',verticalAlign:'top'};
