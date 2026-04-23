import React, { useEffect, useState, useCallback } from 'react';
import DSRForm from './DSRForm.jsx';
import { api, apiBlob, downloadBlob, clearToken } from './auth.js';

const TABS = ['Pending', 'All submissions', 'Users', 'Venues', 'Exports'];

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
      <div className="admin-topbar" style={{background:'#000',color:'#FAD6A5',padding:'10px 20px',display:'flex',alignItems:'center',gap:14,borderBottom:'4px solid #FAD6A5'}}>
        <div style={{fontSize:18,fontWeight:900,fontFamily:"'Fraunces',serif"}}>DSR Admin</div>
        <div className="admin-tabs" style={{flex:1,display:'flex',gap:4}}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{padding:'7px 14px',fontSize:11,fontWeight:900,letterSpacing:1,textTransform:'uppercase',
                border:'none',borderRadius:6,cursor:'pointer',
                background: tab === t ? '#FAD6A5' : 'transparent',
                color: tab === t ? '#000' : '#FAD6A5'}}>{t}</button>
          ))}
        </div>
        <div className="admin-user-email" style={{fontSize:11,opacity:0.85}}>{user.email}</div>
        <button onClick={() => { clearToken(); onLogout(); }}
          style={{padding:'5px 11px',fontSize:10,fontWeight:900,border:'2px solid #FAD6A5',background:'transparent',color:'#FAD6A5',borderRadius:6,cursor:'pointer'}}>
          Sign out
        </button>
      </div>

      {!reviewing ? (
        <div className="admin-body" style={{padding:20,maxWidth:1200,margin:'0 auto'}}>
          {tab === 'Pending' && <SubmissionList status="pending" onReview={setReviewing} refresh={refresh}/>}
          {tab === 'All submissions' && <SubmissionList onReview={setReviewing} refresh={refresh}/>}
          {tab === 'Users' && <UserManager/>}
          {tab === 'Venues' && <VenueManager/>}
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
        <div className="table-wrap">
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
        </div>
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
      <div className="review-header" style={{position:'sticky',top:0,zIndex:99,background:'#FFFDF9',borderBottom:'2px solid #000',padding:'10px 20px',
        display:'flex',alignItems:'center',gap:12,boxShadow:'0 3px 12px #0002'}}>
        <button onClick={onDone} style={linkBtn}>← Back</button>
        <div className="review-title" style={{flex:1,fontSize:14,fontWeight:800}}>
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
          sticky header above; admins don't edit submissions in place.
          Photos card stays interactive so admin can click thumbnails to
          enlarge and verify OCR numbers against the original receipt. */}
      <style>{`
        .admin-review-readonly { user-select: text; }
        .admin-review-readonly input, .admin-review-readonly textarea,
        .admin-review-readonly select, .admin-review-readonly button {
          pointer-events: none;
        }
        .admin-review-readonly .card-photos,
        .admin-review-readonly .card-photos * {
          pointer-events: auto !important;
        }
      `}</style>
      <div className="admin-review-readonly">
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
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'venue', location_id: '', venue_ids: [] });
  const [editing, setEditing] = useState(null); // user object being edited

  const load = useCallback(() => {
    Promise.all([api('/api/admin/users'), api('/api/locations')])
      .then(([u, l]) => { setUsers(u); setLocations(l); })
      .catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Third-party venues are the only ones collectors can be assigned to.
  const thirdPartyVenues = locations.filter(l => l.location_type === 'third_party');

  const create = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      const body = {
        email: form.email, name: form.name, password: form.password, role: form.role,
      };
      if (form.role === 'venue') body.location_id = parseInt(form.location_id);
      if (form.role === 'collector') body.venue_ids = form.venue_ids.map(Number);
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      setMsg(`Created ${form.email}`);
      setForm({ email: '', name: '', password: '', role: 'venue', location_id: '', venue_ids: [] });
      load();
    } catch (e) { setErr(e.message); }
  };

  const toggleActive = async (u) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
      load();
    } catch (e) { setErr(e.message); }
  };

  const deleteUser = async (u) => {
    if (!confirm(`Delete ${u.email}?\n\nThis permanently removes the account. If they have any submissions, deletion will be blocked and you should disable the account instead.`)) return;
    setErr(''); setMsg('');
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      setMsg(`Deleted ${u.email}`);
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setErr(''); setMsg('');
    const body = {
      name: editing.name || null,
      email: editing.email,
      role: editing.role,
      location_id: editing.role === 'venue' ? (editing.location_id ? parseInt(editing.location_id) : null) : null,
    };
    if (editing.newPassword) {
      if (editing.newPassword.length < 8) { setErr('Password must be at least 8 characters'); return; }
      body.reset_password = editing.newPassword;
    }
    try {
      await api(`/api/admin/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg(editing.newPassword ? `Saved · password reset for ${editing.email}` : `Saved ${editing.email}`);
      setEditing(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="user-grid" style={{display:'grid',gap:20,gridTemplateColumns:'minmax(280px,380px) 1fr'}}>
      <div style={card}>
        <div style={cardHeader}>Create user</div>
        <form onSubmit={create} style={{padding:16,display:'flex',flexDirection:'column',gap:8}}>
          <L>Email</L><input style={inp} type="email" required value={form.email}     onChange={e => setForm(f => ({...f, email: e.target.value}))}/>
          <L>Name</L><input style={inp} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
          <L>Temporary password</L><input style={inp} type="text" required minLength={8} value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="min 8 chars"/>
          <L>Role</L>
          <select style={inp} value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
            <option value="venue">Venue (GM)</option>
            <option value="collector">Collector</option>
            <option value="admin">Admin</option>
          </select>
          {form.role === 'venue' && (
            <>
              <L>Location</L>
              <select style={inp} required value={form.location_id} onChange={e => setForm(f => ({...f, location_id: e.target.value}))}>
                <option value="">Select location…</option>
                {locations.filter(l => l.location_type !== 'third_party').map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </>
          )}
          {form.role === 'collector' && (
            <>
              <L>Assign third-party venues</L>
              <div style={{border:'2px solid #B8A99E',borderRadius:6,padding:8,background:'#FFF',maxHeight:160,overflowY:'auto'}}>
                {thirdPartyVenues.length === 0 && (
                  <div style={{fontSize:12,color:'#6B5A4E',fontStyle:'italic'}}>
                    No third-party venues yet — add some in the Venues tab first, then assign them.
                  </div>
                )}
                {thirdPartyVenues.map(v => (
                  <label key={v.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,padding:'3px 0',cursor:'pointer'}}>
                    <input type="checkbox" checked={form.venue_ids.includes(v.id)}
                      onChange={e => setForm(f => ({ ...f,
                        venue_ids: e.target.checked ? [...f.venue_ids, v.id] : f.venue_ids.filter(id => id !== v.id)
                      }))}/>
                    {v.name}
                  </label>
                ))}
              </div>
            </>
          )}
          <button type="submit" style={{...linkBtn,marginTop:8,padding:'8px 14px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>Create user</button>
          {msg && <div style={{color:'#4A7A2D',fontSize:12,fontWeight:700}}>{msg}</div>}
          {err && <div style={{color:'#A03030',fontSize:12,fontWeight:700}}>{err}</div>}
        </form>
      </div>

      <div style={card}>
        <div style={cardHeader}>All users</div>
        <div className="table-wrap">
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
                  <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                    <button style={linkBtn} onClick={() => setEditing({ ...u, location_id: u.location_id || '', newPassword: '' })}>Edit</button>
                    <button style={{...linkBtn,borderColor:'#A03030',color:'#A03030'}} onClick={() => deleteUser(u)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div onClick={() => setEditing(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{...card,maxWidth:460,width:'100%'}}>
            <div style={cardHeader}>Edit user</div>
            <div style={{padding:16,display:'flex',flexDirection:'column',gap:8}}>
              <L>Email</L>
              <input style={inp} type="email" value={editing.email} onChange={e => setEditing(v => ({...v, email: e.target.value}))}/>
              <L>Name</L>
              <input style={inp} value={editing.name || ''} onChange={e => setEditing(v => ({...v, name: e.target.value}))}/>
              <L>Role</L>
              <select style={inp} value={editing.role} onChange={e => setEditing(v => ({...v, role: e.target.value}))}>
                <option value="venue">Venue (GM)</option>
                <option value="collector">Collector</option>
                <option value="admin">Admin</option>
              </select>
              {editing.role === 'venue' && (
                <>
                  <L>Location</L>
                  <select style={inp} value={editing.location_id || ''} onChange={e => setEditing(v => ({...v, location_id: e.target.value}))}>
                    <option value="">Select location…</option>
                    {locations.filter(l => l.location_type !== 'third_party').map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </>
              )}
              {editing.role === 'collector' && (
                <div style={{fontSize:11,color:'#6B5A4E',fontStyle:'italic'}}>
                  Manage this collector's venue assignments on the Venues tab (select a venue to see its collectors).
                </div>
              )}
              <L>New password (optional)</L>
              <input style={inp} type="text" value={editing.newPassword || ''} placeholder="Leave blank to keep current password" onChange={e => setEditing(v => ({...v, newPassword: e.target.value}))}/>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button onClick={saveEdit} style={{...linkBtn,flex:1,padding:'8px 14px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>Save</button>
                <button onClick={() => setEditing(null)} style={{...linkBtn,padding:'8px 14px'}}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Venue manager — list + create/edit company-owned and third-party venues,
// configure cabinets and splits, and assign collectors to third-party venues.
// ---------------------------------------------------------------------
function parseJSON(s, fallback) {
  if (!s) return fallback;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return fallback; }
}
const BLANK_VENUE = {
  location_name: '', location_type: 'company_owned', location_status: 'active',
  collection_split_type: '', split_percentage: '', split_config_json: '',
  cabinet_count: '', cabinet_config: [],
  address_line1: '', city: '', state: '', zip_code: '',
  contact_name: '', contact_phone: '', contact_email: '', notes: '',
};

function VenueManager() {
  const [venues, setVenues] = useState([]);
  const [filter, setFilter] = useState('all'); // all | company_owned | third_party
  const [editing, setEditing] = useState(null); // venue object being edited (or BLANK_VENUE for create)
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api('/api/locations').then(setVenues).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = venues.filter(v => filter === 'all' ? true : v.location_type === filter);

  const startCreate = () => setEditing({ ...BLANK_VENUE });
  const startEdit = (v) => setEditing({
    ...v,
    cabinet_config: parseJSON(v.cabinet_config_json, []),
    split_percentage: v.split_percentage ?? '',
    cabinet_count: v.cabinet_count ?? '',
    collection_split_type: v.collection_split_type || '',
  });

  const save = async () => {
    setErr(''); setMsg('');
    const e = editing;
    if (!e.location_name?.trim()) { setErr('Name is required'); return; }
    if (e.location_type === 'third_party' && !e.collection_split_type) {
      setErr('Third-party venues need a split type'); return;
    }
    if (e.collection_split_type === 'percentage' && (e.split_percentage === '' || e.split_percentage == null)) {
      setErr('Percentage split requires a percentage (0–100)'); return;
    }
    const body = {
      location_name: e.location_name.trim(),
      location_type: e.location_type,
      location_status: e.location_status || 'active',
      collection_split_type: e.collection_split_type || null,
      split_percentage: e.split_percentage === '' ? null : Number(e.split_percentage),
      cabinet_count: e.cabinet_count === '' ? null : parseInt(e.cabinet_count),
      cabinet_config_json: e.cabinet_config && e.cabinet_config.length ? JSON.stringify(e.cabinet_config) : null,
      address_line1: e.address_line1 || null, city: e.city || null, state: e.state || null, zip_code: e.zip_code || null,
      contact_name: e.contact_name || null, contact_phone: e.contact_phone || null, contact_email: e.contact_email || null,
      notes: e.notes || null,
    };
    try {
      if (e.id) {
        await api(`/api/admin/venues/${e.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        setMsg(`Saved ${body.location_name}`);
      } else {
        await api('/api/admin/venues', { method: 'POST', body: JSON.stringify(body) });
        setMsg(`Created ${body.location_name}`);
      }
      setEditing(null); load();
    } catch (ex) { setErr(ex.message); }
  };

  const del = async (v) => {
    if (!confirm(`Delete ${v.name}?\n\nRefused automatically if the venue has submissions, collections, or users attached — disable (status=inactive) instead to preserve history.`)) return;
    try {
      await api(`/api/admin/venues/${v.id}`, { method: 'DELETE' });
      setMsg(`Deleted ${v.name}`); load();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={card}>
        <div style={{...cardHeader,display:'flex',alignItems:'center',gap:10}}>
          <span style={{flex:1}}>Venues</span>
          <select style={{...inp,padding:'4px 8px',fontSize:11,background:'#FFFDF9'}} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All venues</option>
            <option value="company_owned">Company-owned only</option>
            <option value="third_party">Third-party only</option>
          </select>
          <button onClick={startCreate} style={{...linkBtn,padding:'6px 12px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>+ Add venue</button>
        </div>
        {msg && <div style={{padding:'8px 16px',color:'#4A7A2D',fontSize:12,fontWeight:700}}>{msg}</div>}
        {err && <div style={{padding:'8px 16px',color:'#A03030',fontSize:12,fontWeight:700}}>{err}</div>}
        <div className="table-wrap">
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#FBF2D8',textAlign:'left'}}>
                <th style={th}>Name</th>
                <th style={th}>Type</th>
                <th style={th}>Split</th>
                <th style={th}>Cabinets</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(v => (
                <tr key={v.id} style={{borderTop:'1px solid #F5EBE0'}}>
                  <td style={td}><b>{v.name}</b></td>
                  <td style={td}>{v.location_type === 'third_party' ? '3rd-party' : 'Company'}</td>
                  <td style={td}>
                    {v.collection_split_type === 'big_easy'   && <span>Big Easy $2500</span>}
                    {v.collection_split_type === 'percentage' && <span>{Number(v.split_percentage)}% split</span>}
                    {!v.collection_split_type && <span style={{color:'#6B5A4E'}}>—</span>}
                  </td>
                  <td style={td}>{v.cabinet_count ?? '—'}</td>
                  <td style={td}>{v.location_status}</td>
                  <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                    <button style={linkBtn} onClick={() => startEdit(v)}>Edit</button>
                    <button style={{...linkBtn,borderColor:'#A03030',color:'#A03030'}} onClick={() => del(v)}>Delete</button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} style={{...td,color:'#6B5A4E',fontStyle:'italic'}}>No venues match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <VenueEditor
          venue={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => { setEditing(null); setErr(''); }}
          allVenues={venues}
          onReload={load}
        />
      )}
    </div>
  );
}

// Modal editor used for both create and edit. Handles cabinet builder and
// (for third-party venues that already exist) collector assignment.
function VenueEditor({ venue: e, onChange, onSave, onCancel, onReload }) {
  const [collectors, setCollectors] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [pickUser, setPickUser] = useState('');
  const isThird = e.location_type === 'third_party';
  const isExisting = !!e.id;

  useEffect(() => {
    if (!isExisting || !isThird) return;
    Promise.all([
      api(`/api/admin/venues/${e.id}/collectors`),
      api('/api/admin/users?role=collector'),
    ]).then(([a, c]) => { setAssigned(a); setCollectors(c); }).catch(() => {});
  }, [e.id, isExisting, isThird]);

  const assignableCollectors = collectors.filter(c => c.active && !assigned.some(a => a.id === c.id));

  const assign = async () => {
    if (!pickUser) return;
    try {
      await api(`/api/admin/venues/${e.id}/collectors`, { method: 'POST', body: JSON.stringify({ user_id: parseInt(pickUser) }) });
      const [a] = await Promise.all([api(`/api/admin/venues/${e.id}/collectors`)]);
      setAssigned(a); setPickUser('');
    } catch {}
  };
  const unassign = async (userId) => {
    try {
      await api(`/api/admin/venues/${e.id}/collectors/${userId}`, { method: 'DELETE' });
      setAssigned(prev => prev.filter(x => x.id !== userId));
    } catch {}
  };

  const addCabinet = () => onChange({ ...e, cabinet_config: [...(e.cabinet_config || []), { label: String((e.cabinet_config?.length || 0) + 1), type: 'redplum' }] });
  const updateCabinet = (idx, patch) => onChange({ ...e, cabinet_config: e.cabinet_config.map((c, i) => i === idx ? { ...c, ...patch } : c) });
  const removeCabinet = (idx) => onChange({ ...e, cabinet_config: e.cabinet_config.filter((_, i) => i !== idx) });

  return (
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:1000,padding:20,overflowY:'auto'}}>
      <div onClick={ev => ev.stopPropagation()} style={{...card,maxWidth:680,width:'100%',marginTop:20,marginBottom:20}}>
        <div style={cardHeader}>{isExisting ? `Edit venue: ${e.location_name}` : 'New venue'}</div>
        <div style={{padding:16,display:'flex',flexDirection:'column',gap:8}}>
          <L>Name</L>
          <input style={inp} value={e.location_name} onChange={ev => onChange({ ...e, location_name: ev.target.value })}/>

          <L>Type</L>
          <select style={inp} value={e.location_type} onChange={ev => onChange({ ...e, location_type: ev.target.value, collection_split_type: ev.target.value === 'third_party' ? (e.collection_split_type || 'percentage') : '' })}>
            <option value="company_owned">Company-owned (DSR submitter)</option>
            <option value="third_party">Third-party (collected by collector)</option>
          </select>

          <L>Status</L>
          <select style={inp} value={e.location_status} onChange={ev => onChange({ ...e, location_status: ev.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          {isThird && (
            <>
              <L>Split type</L>
              <select style={inp} value={e.collection_split_type} onChange={ev => onChange({ ...e, collection_split_type: ev.target.value })}>
                <option value="">Select split…</option>
                <option value="big_easy">Big Easy $2500 waterfall</option>
                <option value="percentage">Fixed percentage</option>
              </select>
              {e.collection_split_type === 'percentage' && (
                <>
                  <L>RSS share % (e.g. 50 for 50/50)</L>
                  <input style={inp} type="number" min="0" max="100" step="0.01" value={e.split_percentage} onChange={ev => onChange({ ...e, split_percentage: ev.target.value })}/>
                </>
              )}
            </>
          )}

          <L>Cabinet count</L>
          <input style={inp} type="number" min="0" value={e.cabinet_count} onChange={ev => onChange({ ...e, cabinet_count: ev.target.value })} placeholder="e.g. 4"/>

          <L>Cabinets</L>
          <div style={{border:'2px solid #B8A99E',borderRadius:6,padding:8,background:'#FFF'}}>
            {(e.cabinet_config || []).map((c, i) => (
              <div key={i} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                <input style={{...inp,flex:'0 0 90px'}} placeholder="Label" value={c.label || ''} onChange={ev => updateCabinet(i, { label: ev.target.value })}/>
                <select style={{...inp,flex:1}} value={c.type || 'redplum'} onChange={ev => updateCabinet(i, { type: ev.target.value })}>
                  <option value="redplum">Redplum</option>
                  <option value="cardinal">Cardinal</option>
                </select>
                <button onClick={() => removeCabinet(i)} style={{...linkBtn,padding:'4px 8px',borderColor:'#A03030',color:'#A03030'}}>Remove</button>
              </div>
            ))}
            <button onClick={addCabinet} style={{...linkBtn,padding:'5px 10px',marginTop:4}}>+ Add cabinet</button>
            {(e.cabinet_config || []).length === 0 && (
              <div style={{fontSize:11,color:'#6B5A4E',fontStyle:'italic',marginTop:4}}>
                Leave blank if you just want N generic rows on the form (set Cabinet count above). Add rows here only if you want specific labels/types per cabinet.
              </div>
            )}
          </div>

          {isThird && isExisting && (
            <>
              <L>Assigned collectors</L>
              <div style={{border:'2px solid #B8A99E',borderRadius:6,padding:8,background:'#FFF'}}>
                {assigned.length === 0 && <div style={{fontSize:12,color:'#6B5A4E',fontStyle:'italic'}}>No collectors assigned yet.</div>}
                {assigned.map(a => (
                  <div key={a.id} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'3px 8px',margin:'2px 4px 2px 0',background:'#FAD6A5',border:'2px solid #000',borderRadius:12,fontSize:12}}>
                    <span><b>{a.name || a.email}</b></span>
                    <button onClick={() => unassign(a.id)} style={{background:'transparent',border:'none',cursor:'pointer',fontWeight:900,fontSize:12,color:'#A03030'}}>×</button>
                  </div>
                ))}
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  <select style={{...inp,flex:1}} value={pickUser} onChange={ev => setPickUser(ev.target.value)}>
                    <option value="">Select collector to add…</option>
                    {assignableCollectors.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
                  </select>
                  <button onClick={assign} disabled={!pickUser} style={linkBtn}>Assign</button>
                </div>
              </div>
            </>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:4}}>
            <div><L>Address</L><input style={inp} value={e.address_line1 || ''} onChange={ev => onChange({ ...e, address_line1: ev.target.value })}/></div>
            <div><L>City</L><input style={inp} value={e.city || ''} onChange={ev => onChange({ ...e, city: ev.target.value })}/></div>
            <div><L>State</L><input style={inp} value={e.state || ''} onChange={ev => onChange({ ...e, state: ev.target.value })}/></div>
            <div><L>ZIP</L><input style={inp} value={e.zip_code || ''} onChange={ev => onChange({ ...e, zip_code: ev.target.value })}/></div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><L>Contact name</L><input style={inp} value={e.contact_name || ''} onChange={ev => onChange({ ...e, contact_name: ev.target.value })}/></div>
            <div><L>Contact phone</L><input style={inp} value={e.contact_phone || ''} onChange={ev => onChange({ ...e, contact_phone: ev.target.value })}/></div>
          </div>
          <L>Contact email</L>
          <input style={inp} type="email" value={e.contact_email || ''} onChange={ev => onChange({ ...e, contact_email: ev.target.value })}/>

          <L>Notes</L>
          <textarea style={{...inp,minHeight:60,fontFamily:'inherit'}} value={e.notes || ''} onChange={ev => onChange({ ...e, notes: ev.target.value })}/>

          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={onSave} style={{...linkBtn,flex:1,padding:'8px 14px',background:'#000',color:'#FAD6A5',borderColor:'#000'}}>
              {isExisting ? 'Save changes' : 'Create venue'}
            </button>
            <button onClick={onCancel} style={{...linkBtn,padding:'8px 14px'}}>Cancel</button>
          </div>
        </div>
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
