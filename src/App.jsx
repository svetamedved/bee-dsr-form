import React, { useEffect, useState } from 'react';
import Login from './Login.jsx';
import VenueApp from './VenueApp.jsx';
import AdminApp from './AdminApp.jsx';
import CollectorApp from './CollectorApp.jsx';
import ChangePassword from './ChangePassword.jsx';
import { api, getToken, clearToken } from './auth.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const tok = getToken();
    if (!tok) { setBootstrapping(false); return; }
    api('/api/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => { clearToken(); })
      .finally(() => setBootstrapping(false));

    const onLogout = () => setUser(null);
    window.addEventListener('dsr-logout', onLogout);
    return () => window.removeEventListener('dsr-logout', onLogout);
  }, []);

  if (bootstrapping) {
    return <div style={{padding:40,textAlign:'center',color:'#6B5A4E',fontFamily:'sans-serif'}}>Loading…</div>;
  }
  if (!user) return <Login onLogin={setUser}/>;
  if (user.must_change_password) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, must_change_password: false })}/>;
  }
  if (user.role === 'admin') return <AdminApp user={user} onLogout={() => setUser(null)}/>;
  if (user.role === 'collector') return <CollectorApp user={user} onLogout={() => setUser(null)}/>;
  return <VenueApp user={user} onLogout={() => setUser(null)}/>;
}
