import React, { useState } from 'react';
import { api } from './auth.js';

export default function ChangePassword({ user, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: next }) });
      onDone();
    } catch (ex) { setErr(ex.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',
      background:'linear-gradient(180deg,#4A3B5C 0%,#D89AA5 50%,#FCE8C8 100%)',fontFamily:"'DM Sans',sans-serif"}}>
      <form onSubmit={submit} style={{background:'#FFFDF9',padding:30,borderRadius:14,border:'2px solid #000',boxShadow:'6px 6px 0 #000',width:380,maxWidth:'90vw'}}>
        <div style={{fontSize:16,fontWeight:900,marginBottom:6}}>Change your password</div>
        <div style={{fontSize:12,color:'#6B5A4E',marginBottom:16}}>
          Your administrator set a temporary password for <b>{user.email}</b>. Please choose a new one.
        </div>
        <label style={lab}>Current password</label>
        <input style={inp} type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password"/>
        <label style={lab}>New password</label>
        <input style={inp} type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} autoComplete="new-password"/>
        <label style={lab}>Confirm new password</label>
        <input style={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password"/>
        {err && <div style={{marginTop:10,padding:'8px 10px',background:'#FFE8E8',border:'1.5px solid #A03030',borderRadius:7,color:'#A03030',fontWeight:700,fontSize:12}}>{err}</div>}
        <button type="submit" disabled={busy} style={{marginTop:16,width:'100%',padding:'10px 0',border:'2px solid #000',borderRadius:8,background:busy?'#888':'#000',color:'#FAD6A5',fontWeight:900,letterSpacing:2,cursor:busy?'wait':'pointer',boxShadow:'3px 3px 0 #000'}}>
          {busy ? 'SAVING…' : 'CHANGE PASSWORD'}
        </button>
      </form>
    </div>
  );
}
const lab = {display:'block',fontSize:11,fontWeight:800,letterSpacing:1,textTransform:'uppercase',marginTop:12,marginBottom:4};
const inp = {width:'100%',padding:'9px 11px',border:'2px solid #B8A99E',borderRadius:7,fontSize:14,boxSizing:'border-box',background:'#FFF',color:'#1A1A1A',fontWeight:500,fontFamily:'inherit'};
