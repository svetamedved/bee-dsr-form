import React, { useEffect, useState, useCallback } from 'react';
import DSRForm from './DSRForm.jsx';
import { api, clearToken } from './auth.js';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#FFF4D6', bd: '#C98A1B', fg: '#6B4A0A', label: 'PENDING'  },
    approved: { bg: '#E6F5DC', bd: '#4A7A2D', fg: '#234A12', label: 'APPROVED' },
    rejected: { bg: '#FFE8E8', bd: '#A03030', fg: '#6B1818', label: 'REJECTED' },
  }[status] || { bg: '#EEE', bd: '#888', fg: '#333', label: status?.toUpperCase() || '—' };
  return (
    <span style={{padding:'3px 9px',borderRadius:12,background:map.bg,border:`1.5px solid ${map.bd}`,
      color:map.fg,fontSize:10,fontWeight:900,letterSpacing:1}}>{map.label}</span>
  );
}

export default function VenueApp({ user, onLogout }) {
  const today = new Date().toISOString().slice(0, 10);
  const [loadedSubmission, setLoadedSubmission] = useState(null); // submission being edited/viewed
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [formKey, setFormKey] = useState(0); // bump to remount form when switching submissions

  const loadHistory = useCallback(async () => {
    try {
      const rows = await api('/api/submissions');
      setHistory(rows);
    } catch (e) { console.error(e); }
  }, []);

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const sub = await api(`/api/submissions/by-date/${today}`);
      setLoadedSubmission(sub || null);
    } catch (e) { console.error(e); setLoadedSubmission(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadHistory();
    loadToday();
  }, [loadHistory, loadToday]);

  const editSubmission = async (id) => {
    try {
      const sub = await api(`/api/submissions/${id}`);
      setLoadedSubmission(sub);
      setFormKey(k => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { alert(e.message); }
  };

  const onSubmitted = async () => {
    await Promise.all([loadHistory(), loadToday()]);
    setFormKey(k => k + 1);
  };

  if (loading) {
    return <div style={wrap}><div style={{color:'#FFF4EC',padding:40}}>Loading…</div></div>;
  }

  return (
    <div>
      <div className="venue-topbar" style={topbar}>
        <div className="venue-user" style={{fontSize:11,fontWeight:700,color:'#3D2E1F'}}>
          Signed in as <b>{user.email}</b> · <b>{user.location_name || '—'}</b>
        </div>
        <button onClick={() => { clearToken(); onLogout(); }} style={btn}>Sign out</button>
      </div>

      <DSRForm
        key={formKey}
        user={user}
        defaultDate={loadedSubmission?.payload?.report_date || today}
        initialSubmission={loadedSubmission}
        onSubmitted={onSubmitted}
      />

      {/* History */}
      <div style={{maxWidth:900,margin:'24px auto',padding:'0 12px'}}>
        <div style={{background:'#FFFDF9',border:'2px solid #000',borderRadius:12,boxShadow:'4px 4px 0 #000',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',background:'#FAD6A5',borderBottom:'2px solid #000',fontSize:13,fontWeight:900,letterSpacing:2,textTransform:'uppercase'}}>
            My recent submissions
          </div>
          {history.length === 0 ? (
            <div style={{padding:20,color:'#6B5A4E',fontStyle:'italic'}}>No submissions yet.</div>
          ) : (
            <div className="table-wrap">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'#FBF2D8',textAlign:'left'}}>
                    <th style={th}>Date</th>
                    <th style={th}>Status</th>
                    <th style={th}>Submitted</th>
                    <th style={th}>Notes</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} style={{borderTop:'1px solid #F5EBE0'}}>
                      <td style={td}><b>{fmtDate(h.report_date)}</b></td>
                      <td style={td}><StatusBadge status={h.status}/></td>
                      <td style={{...td,color:'#6B5A4E',fontSize:12}}>{h.submitted_at ? new Date(h.submitted_at).toLocaleString() : ''}</td>
                      <td style={{...td,fontSize:12,color:'#6B1818',maxWidth:260}}>
                        {h.status === 'rejected' && h.admin_notes ? h.admin_notes : ''}
                      </td>
                      <td style={{...td,textAlign:'right'}}>
                        <button onClick={() => editSubmission(h.id)} style={linkBtn}>
                          {h.status === 'approved' ? 'View' : 'Edit'}
                        </button>
                      </td>
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

const wrap = {minHeight:'100vh',background:'linear-gradient(180deg,#4A3B5C 0%,#D89AA5 50%,#FCE8C8 100%)',fontFamily:"'DM Sans',-apple-system,sans-serif"};
const topbar = {display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 18px',background:'#000',color:'#FAD6A5',fontSize:11,fontWeight:700,letterSpacing:1};
const btn = {padding:'4px 10px',fontSize:10,fontWeight:900,letterSpacing:1,background:'#FAD6A5',color:'#000',border:'2px solid #FAD6A5',borderRadius:6,cursor:'pointer'};
const th = {padding:'10px 14px',fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#3D2E1F'};
const td = {padding:'10px 14px',verticalAlign:'top'};
const linkBtn = {padding:'5px 11px',fontSize:11,fontWeight:800,border:'2px solid #000',borderRadius:6,background:'#FFFDF9',color:'#000',cursor:'pointer',boxShadow:'2px 2px 0 #000'};
