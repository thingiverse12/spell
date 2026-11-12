import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Layout, PAGE_TITLES } from './components/Layout';
import { Logo } from './components/Logo';
import { Spinner, Button, Badge } from './components/ui';
import { AuthPage, Onboarding } from './pages/AuthPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { ChatPage } from './pages/ChatPage';
import { CommunitiesPage } from './pages/CommunitiesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SafetyPage } from './pages/SafetyPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

const ROUTES = ['upptack', 'chatt', 'communities', 'notiser', 'profil', 'sakerhet', 'installningar', 'admin'];

function Router() {
  const { session, profile, loading, configured, error, toast, demoMode } = useApp();
  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '');
    return ROUTES.includes(h) ? h : 'upptack';
  });
  const [navData, setNavData] = useState<any>(null);

  useEffect(() => {
    const onHash = () => { const h = window.location.hash.replace(/^#\/?/, ''); if (ROUTES.includes(h)) setRoute(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (r: string, data: any = null) => {
    setRoute(r); setNavData(data); window.location.hash = `#/${r}`;
  };

  if (!configured) return <div className="fatal"><Logo size={54} /><h2>NEXA är inte konfigurerat</h2><p>Sätt <code>VITE_SUPABASE_URL</code> och <code>VITE_SUPABASE_ANON_KEY</code> som miljövariabler i Vercel och bygg om.</p>{error && <div className="form-error">{error}</div>}</div>;
  if (loading) return <div className="splash"><div className="splash-glow" /><Logo size={64} /><div className="splash-tag">Connect. Talk. Belong.</div><Spinner label="Startar NEXA…" /></div>;
  if (!session) return <><AuthPage />{toast && <div className={`toast toast-${toast.tone}`}>{toast.message}</div>}</>;
  if (!profile?.onboarding_complete || !profile?.age_group) return <><Onboarding />{toast && <div className={`toast toast-${toast.tone}`}>{toast.message}</div>}</>;

  let page: React.ReactNode;
  switch (route) {
    case 'chatt': page = <ChatPage navigate={navigate} navData={navData} />; break;
    case 'communities': page = <CommunitiesPage />; break;
    case 'notiser': page = <NotificationsPage />; break;
    case 'profil': page = <ProfilePage navigate={navigate} />; break;
    case 'sakerhet': page = <SafetyPage navigate={navigate} />; break;
    case 'installningar': page = <SettingsPage navigate={navigate} />; break;
    case 'admin': page = <AdminPage />; break;
    default: page = <DiscoverPage navigate={navigate} />;
  }
  return <>
    <Layout route={route} navigate={navigate}>{page}</Layout>
    {toast && <div className={`toast toast-${toast.tone}`} onClick={() => {}}>{toast.message}</div>}
  </>;
}

export default function App() {
  return <AppProvider><Router /></AppProvider>;
}
