import React, { useEffect, useState, useCallback } from 'react';
import DSRForm from './DSRForm.jsx';
import { api, apiBlob, downloadBlob, clearToken } from './auth.js';

const TABS = ['Pending', 'All submissions', 'Users', 'Exports'];

function fmtDate(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#FFF4D6', bd: '#C98A1B', fg: '#6B4A0A', label: 'PENDING' },
    approved: { bg: '#E6F5DC', bd: '#4A7A2D', fg: '#234A12', label: 'APPROVED' },
    rejected: { bg: '#FFE8E8', bd: '#A03030', fg: '#6B1818', label: 'REJECTED' },
  }[status] || { bg: '#EEE', bd: '#888', fg: '#333', label: status?.toUpperCase() };
  return (
    <span style={{padding:'3px 9px',borderRadius:12,background:map.bg,border:`1.5px solid ${map.bd}`,
      color:map.fg,fontSize:10,fontWeight:900,letterSpacing:1}}>{map.label}</span>
  );
}

export default function AdminApp({ user, onLogout }) {
  const [tab, setTab] = useState('Pending');
  const [reviewing, setReviewing] = useState(null); // submission being reviewed
  const [refresh, setRefresh] = useState(0);

  return (
    <div style={{minHeight:'100vh',background:'#F5EBE0',fontFamily:"'DM Sans',-apple-system,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
      <div style={{background:'#000',color:'#FAD6A5',padding:'10px 20px',display:'flex',alignItems:'center',gap:14,borderBottom:'4px solid #FAD6A5'}}>
        <div style={{fontSize:18,fontWeight:900,fontFamily:"'Fraunces',serif"}}>DSR Admin</div>
        <div style={{flex:1,display:'flex',gap:4}}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{padding:'7px 14px',fontSize:11,fontWeight:900,letterSpacing:1,textTransform:'uppercase',
                border:'none',borderRadius:6,cursor:'pointer',
                background: tab === t ? '#FAD6A5' : 'transparent',
                color: tab === t ? '#000' : '#FAD6A5'}}>{t}</button>
          ))}
        </div>
        <div style={{fontSize:11,opacity:0.85}}>{user.email}</div>
        <button onClick={() => { clearToken(); onLogout(); }}
          style={{padding:'5px 11px',fontSize:10,fontWeight:900,border:'2px solid #FAD6A5',background:'transparent',color:'#FAD6A5',borderRadius:6,cursor:'pointer'}}>
          Sign out
        </button>
      </div>

      {!reviewing ? (
        <div style={{padding:20,maxWidth:1200,margin:'0 auto'}}>
          {tab === 'Pending' && <SubmissionList status="pending" onReview={setReviewing} refresh={refresh}/>}
          {tab === 'All submissions' && <SubmissionList onReview={setReviewing} refresh={refresh}/>}
          {tab === 'Users' && <UserManager/>}
          {tab === 'Exports' && <ExportPanel/>}
        </div>
      ) : (
        <ReviewSubmission user={user} submission={reviewing}
          onDone={() => { setReviewing(null); setRefresh(r => r + 1); }}/>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Submission list (pending queue / all)
// ---------------------------------------------------------------------
function SubmissionList({ status, onReview, refresh }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/submissions' + (status ? `?status=${status}` : ''))
      .then(setRows)
      .catch(e => setErr(e.message));
  }, [status, refresh]);
  return (
    <div style={card}>
      <div style={cardHeader}>{status ? `${status[0].toUpperCase()}${status.slice(1)} submissions` : 'All submissions'}</div>
      {err && <div style={{padding:14,color:'#A03030'}}>{err}</div>}
      {rows.length === 0 ? (
        <div style={{padding:20,color:'#6B5A4E',fontStyle:'italic'}}>Nothing here.</div>
      ) : (
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'#FBF2D8',textAlign:'left'}}>
              <th style={th}>Date</th>
              <th style={th}>Location</th>
              <th style={th}>Submitter</th>
              <th style={th}>Status</th>
              <th style={th}>Submitted at</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{borderTop:'1px solid #F5EBE0'}}>
                <td style={td}><b>{fmtDate(r.report_date)}</b></td>
                <td style={td}>{r.location_name}</td>
                <td style={{...td,fontSize:12,color:'#6B5A4E'}}>{r.submitter_email}</td>
                <td style={td}><StatusBadge status={r.status}/></td>
                <td style={{...td,fontSize:12,color:'#6B5A4E'}}>{r.submitted_at && new Date(r.submitted_at).toLocaleString()}</td>
                <td style={{...td,textAlign:'right'}}>
                  <button style={linkBtn} onClick={() => onReview(r)}>Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Review a single submission — loads the form read-only + approve/reject actions
// ---------------------------------------------------------------------
function ReviewSubmission({ user, submission, onDone }) {
  const [full, setFull] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api(`/api/submissions/${submission.id}`).then(setFull).catch(e => setErr(e.message));
  }, [submission.id]);

  const approve = async () => {
    setBusy(true); setErr('');
    try {
      await api(`/api/admin/submissions/${submission.id}/approve`, {
        method: 'POST', body: JSON.stringify({}),
      });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!rejectNotes.trim()) { setErr('Please write a rejection note'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/api/admin/submissions/${submission.id}/reject`, {
        method: 'POST', body: JSON.stringify({ notes: rejectNotes }),
      });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const downloadIIF = async () => {
    try {
      const { blob, filename } = await apiBlob(`/api/admin/submissions/${submission.id}/iif`);
      downloadBlob(blob, filename);
    } catch (e) { setErr(e.message); }
  };

  if (err && !full) return <div style={{padding:40,color:'#A03030'}}>{err}</div>;
  if (!full) return <div style={{padding:40,color:'#6B5A4E'}}>Loading…</div>;

  const isPending = full.status === 'pending';
  return (
    <div>
      <div style={{position:'sticky',top:0,zIndex:99,background:'#FFFDF9',borderBottom:'2px solid #000',padding:'10px 20px',
        display:'flex',alignItems:'center',gap:12,boxShadow:'0 3px 12px #0002'}}>
        <button onClick={onDone} style={linkBtn}>← Back</button>
        <div style={{flex:1,fontSize:14,fontWeight:800}}>
          Review: <b>{full.location_name}</b> · {fmtDate(full.report_date)} · {full.submitter_email} <StatusBadge status={full.status}/>
        </div>
        {full.status === 'approved' && (
          <button onClick={downloadIIF} style={{...linkBtn,background:'#FAD6A5'}}>Download IIF</button>
        )}
        {isPending && (
          <>
            <button onClick={() => setShowReject(s => !s)} disabled={busy}
              style={{...linkBtn,background:'#FFE8E8',borderColor:'#A03030',color:'#A03030'}}>Reject</button>
            <button onClick={approve} disabled={busy}
              style={{...linkBtn,background:'#4A7A2D',color:'#FFF'}}>Approve</button>
          </>
        )}
      </div>
      {showReject && isPending && (
        <div style={{background:'#FFE8E8',padding:'12px 20px',borderBottom:'2px solid #A03030',display:'flex',gap:8,alignItems:'flex-start'}}>
          <textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
            placeholder="Why is this being rejected? This note is shown to the venue."
            style={{flex:1,minHeight:60,padding:8,border:'2px solid #A03030',borderRadius:6,fontSize:13,fontFamily:'inherit'}}/>
          <button onClick={reject} disabled={busy}
            style={{...linkBtn,background:'#A03030',color:'#FFF',borderColor:'#A03030'}}>Confirm reject</button>
        </div>
      )}
      {err && <div style={{padding:'8px 20px',background:'#FFE8E8',color:'#A03030',fontWeight:700}}>{err}</div>}

      {/* Read-only view of what the venue submitted. Approve/reject via the
          sticky header above; admins don't edit submissions in place. */}
      <div style={{pointerEvents: 'none', userSelect: 'text'}}>
        <DSRForm user={user} initialSubmission={full} onSubmitted={() => {}}/>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// User manager
// ---------------------------------------------------------------------
function UserManager() {
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'venue', location_id: '' });

  const load = useCallback(() => {
    Promise.all([api('/api/admin/users'), api('/api/locations')])
      .then(([u, l]) => { setUsers(u); setLocations(l); })
      .catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({
        ...form,
        location_id: form.role === 'venue' ? parseInt(form.location_id) : null,
      })});
      setMsg(`Created ${form.email}`);
      setForm({ email: '', name: '', password: '', role: 'venue', location_id: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  const toggleActive = async (u) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
      load();
    } catch (e) { setErr(e.message); }
  };

  const resetPassword = async (u) => {
    const pw = prompt(`New temporary password for ${u.email}? (Minimum 8 characters)`);
    if (!pw || pw.length < 8) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ reset_password: pw }) });
      alert(`Password reset. Give ${u.email} the password: ${pw}`);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{display:'grid',gap:20,gridTemplateColumns:'minmax(280px,380px) 1fr'}}>
      <div style={card}>
        <div style={cardHeader}>Create user</div>
        <form onSubmit={create} style={{padding:16,display:'flex',flexDirection:'column',gap:8}}>
          <L>Email</L><input style={inp} type="email" required value={form.email}     onChange={e => setForm(f => ({...f, email: e.target.value}))}/>
          <L>Name</L><input style={inp} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
          <L>Temporary password</L><input style={inp} type="text" required minLength={8} value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="min 8 chars"/>
          <L>Role</L>
          <select style={inp} value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
            <option value="venue">Venue</option>
            <option value="admin">Admin</option>
          </select>
          {form.role === 'venue' && (
            <>
              <L>Location</L>
              <select style={inp} required value={form.location_id} onChange={e => setForm(f => ({...f, location_id: e.target.value}))}>
                <option value="">Select location…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </>
          )}
          <button type="submit" style={{...linkBtn,marginTop:8,padding:'8px 14px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>Create user</button>
          {msg && <div style={{color:'#4A7A2D',fontSize:12,fontWeight:700}}>{msg}</div>}
          {err && <div style={{color:'#A03030',fontSize:12,fontWeight:700}}>{err}</div>}
        </form>
      </div>

      <div style={card}>
        <div style={cardHeader}>All users</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'#FBF2D8',textAlign:'left'}}>
              <th style={th}>Email</th><th style={th}>Role</th><th style={th}>Location</th>
              <th style={th}>Active</th><th style={th}>Last login</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{borderTop:'1px solid #F5EBE0'}}>
                <td style={td}><b>{u.email}</b>{u.name ? <span style={{color:'#6B5A4E'}}> · {u.name}</span> : null}</td>
                <td style={td}>{u.role}</td>
                <td style={td}>{u.location_name || '—'}</td>
                <td style={td}>
                  <button onClick={() => toggleActive(u)}
                    style={{padding:'3px 8px',fontSize:10,fontWeight:800,border:'2px solid #000',borderRadius:6,
                      background: u.active ? '#B8D4A8' : '#FFE8E8', cursor:'pointer'}}>
                    {u.active ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td style={{...td,fontSize:12,color:'#6B5A4E'}}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
                <td style={{...td,textAlign:'right'}}>
                  <button style={linkBtn} onClick={() => resetPassword(u)}>Reset PW</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Batch IIF export
// ---------------------------------------------------------------------
function ExportPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(weekAgo);
  const [end, setEnd] = useState(today);
  const [msg, setMsg] = useState('');

  const download = async () => {
    setMsg('');
    try {
      const { blob, filename } = await apiBlob(`/api/admin/export/batch.iif?start=${start}&end=${end}`);
      downloadBlob(blob, filename);
      setMsg(`Downloaded ${filename}`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
  };

  return (
    <div style={card}>
      <div style={cardHeader}>Batch IIF export for QuickBooks</div>
      <div style={{padding:18,display:'flex',flexDirection:'column',gap:10,maxWidth:460}}>
        <div style={{fontSize:12,color:'#6B5A4E'}}>
          Concatenates the IIF file for every approved submission in the selected date range,
          suitable for a single QuickBooks import.
        </div>
        <L>Start date</L><input style={inp} type="date" value={start} onChange={e => setStart(e.target.value)}/>
        <L>End date</L><input style={inp} type="date" value={end} onChange={e => setEnd(e.target.value)}/>
        <button onClick={download} style={{...linkBtn,padding:'9px 14px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>Download batch IIF</button>
        {msg && <div style={{fontSize:12,fontWeight:700,color: msg.startsWith('Error') ? '#A03030' : '#4A7A2D'}}>{msg}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
const card = {background:'#FFFDF9',border:'2px solid #000',borderRadius:12,boxShadow:'4px 4px 0 #000',overflow:'hidden'};
const cardHeader = {padding:'12px 16px',background:'#FAD6A5',borderBottom:'2px solid #000',fontSize:13,fontWeight:900,letterSpacing:2,textTransform:'uppercase'};
const th = {padding:'10px 14px',fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:'uppercase',color:'#3D2E1F'};
const td = {padding:'10px 14px',verticalAlign:'top'};
const linkBtn = {padding:'6px 12px',fontSize:11,fontWeight:900,border:'2px solid #000',borderRadius:6,background:'#FFFDF9',color:'#000',cursor:'pointer',boxShadow:'2px 2px 0 #000'};
const inp = {padding:'8px 10px',border:'2px solid #B8A99E',borderRadius:6,fontSize:13,fontFamily:'inherit',background:'#FFF',color:'#1A1A1A',fontWeight:500};
const L = ({children}) => <div style={{fontSize:10,fontWeight:900,letterSpacing:1,textTransform:'uppercase',color:'#3D2E1F',marginBottom:-4,marginTop:2}}>{children}</div>;
