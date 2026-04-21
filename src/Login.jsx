import React, { useState } from 'react';
import { api, setToken } from './auth.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setToken(res.token);
      onLogin(res.user);
    } catch (ex) {
      setErr(ex.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',
      background:'linear-gradient(180deg,#4A3B5C 0%,#8B6F8E 25%,#D89AA5 55%,#F5B88B 85%,#FCE8C8 100%)',
      fontFamily:"'DM Sans',-apple-system,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
      <form onSubmit={submit} style={{background:'#FFFDF9',padding:32,borderRadius:16,boxShadow:'6px 6px 0 #000',
        border:'2px solid #000',width:360,maxWidth:'90vw'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#F5B88B,#D89AA5)',
            display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:900,
            border:'2px solid #000',boxShadow:'2px 2px 0 #000'}}>S</div>
          <div>
            <div style={{fontSize:18,fontWeight:900,fontFamily:"'Fraunces',serif"}}>DSR Platform</div>
            <div style={{fontSize:9,letterSpacing:2,color:'#6B5A4E',fontWeight:700}}>DAILY SALES REPORT</div>
          </div>
        </div>
        <label style={{display:'block',fontSize:11,fontWeight:800,letterSpacing:1,textTransform:'uppercase',marginBottom:4}}>Email</label>
        <input value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="username"
          style={inp} placeholder="you@venue.com"/>
        <label style={{display:'block',fontSize:11,fontWeight:800,letterSpacing:1,textTransform:'uppercase',margin:'14px 0 4px'}}>Password</label>
        <input value={password} onChange={e=>setPassword(e.target.value)} type="password" required autoComplete="current-password"
          style={inp}/>
        {err && <div style={{marginTop:12,padding:'8px 10px',background:'#FFE8E8',border:'1.5px solid #A03030',
          borderRadius:7,fontSize:12,color:'#A03030',fontWeight:700}}>{err}</div>}
        <button type="submit" disabled={busy}
          style={{marginTop:18,width:'100%',padding:'11px 0',borderRadius:8,border:'2px solid #000',
            background:busy?'#888':'#000',color:'#FAD6A5',fontSize:12,fontWeight:900,letterSpacing:2,
            cursor:busy?'wait':'pointer',boxShadow:'3px 3px 0 #000'}}>
          {busy ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
        <div style={{marginTop:14,fontSize:11,color:'#6B5A4E',textAlign:'center'}}>
          Need an account? Contact your administrator.
        </div>
      </form>
    </div>
  );
}
const inp = {width:'100%',padding:'9px 11px',border:'2px solid #B8A99E',borderRadius:7,fontSize:14,
  boxSizing:'border-box',background:'#FFF',color:'#1A1A1A',fontWeight:500,fontFamily:'inherit'};
