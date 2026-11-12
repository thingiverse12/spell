import React from 'react';
import { Compass, MessageCircle, Users, Bell, UserRound, ShieldCheck, Settings2, ShieldAlert, LogOut, ChevronRight } from 'lucide-react';
import { Logo } from './Logo';
import { Avatar, Badge } from './ui';
import { useApp } from '../state/AppContext';

export const NAV = [
  { id: 'upptack', label: 'Upptäck', icon: Compass },
  { id: 'chatt', label: 'Chatt', icon: MessageCircle },
  { id: 'communities', label: 'Communities', icon: Users },
  { id: 'notiser', label: 'Notiser', icon: Bell },
  { id: 'profil', label: 'Profil', icon: UserRound },
];
const EXTRA = [
  { id: 'sakerhet', label: 'Säkerhetscenter', icon: ShieldCheck },
  { id: 'installningar', label: 'Inställningar', icon: Settings2 },
];
export const PAGE_TITLES: Record<string, string> = {
  upptack: 'Upptäck', chatt: 'Chatt', communities: 'Communities', notiser: 'Notiser', profil: 'Profil',
  sakerhet: 'Säkerhetscenter', installningar: 'Inställningar', admin: 'Moderatorpanel',
};

export function Layout({ route, navigate, children }: { route: string; navigate: (r: string) => void; children: React.ReactNode }) {
  const { profile, unread, moderator, demoMode, signOut, showToast } = useApp();
  const go = (r: string) => { navigate(r); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const extra = [...EXTRA];
  if (moderator) extra.push({ id: 'admin', label: 'Moderatorpanel', icon: ShieldAlert } as any);

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="sidebar-logo" onClick={() => go('upptack')}><Logo size={40} /></button>
      <nav className="side-nav">
        <span className="nav-label">MENY</span>
        {NAV.map((n) => <button key={n.id} className={`nav-item ${route === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <n.icon size={19} /><span>{n.label}</span>
          {n.id === 'notiser' && unread > 0 && <span className="nav-dot">{unread}</span>}
        </button>)}
        <span className="nav-label nav-label-gap">TRYGGHET</span>
        {extra.map((n: any) => <button key={n.id} className={`nav-item ${route === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <n.icon size={19} /><span>{n.label}</span>
        </button>)}
      </nav>
      <div className="sidebar-foot">
        {demoMode && <div className="demo-chip"><Badge tone="amber">DEMO</Badge><span>Tydligt märkt demodrift</span></div>}
        <button className="side-user" onClick={() => go('profil')}>
          <Avatar name={profile?.username || '?'} url={profile?.avatar_url} size={36} id={profile?.id} />
          <span className="side-user-text"><strong>{profile?.username || 'Min profil'}</strong><small>{profile?.age_group || 'Ålder ej satt'}</small></span>
          <ChevronRight size={16} />
        </button>
        <button className="nav-item logout" onClick={async () => { await signOut(); showToast('Du är utloggad.', 'info'); }}><LogOut size={18} /><span>Logga ut</span></button>
      </div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <button className="topbar-logo" onClick={() => go('upptack')}><Logo size={32} withWord={false} /></button>
        <h2>{PAGE_TITLES[route] || 'NEXA'}</h2>
        <div className="topbar-right">
          {demoMode && <Badge tone="amber">DEMO</Badge>}
          <button className="topbar-bell" onClick={() => go('notiser')} aria-label="Notiser"><Bell size={19} />{unread > 0 && <span className="bell-dot" />}</button>
          <button onClick={() => go('profil')}><Avatar name={profile?.username || '?'} url={profile?.avatar_url} size={34} id={profile?.id} /></button>
        </div>
      </header>
      {demoMode && <div className="demo-banner"><Badge tone="amber">DEMOLÄGE</Badge><span>Åldersverifiering är självdeklarerad och externa AI-/OCR-/WebRTC-leverantörer är inte anslutna. Inga ID-handlingar eller biometriska data sparas.</span></div>}
      <main className="page-content">{children}</main>
      <nav className="bottom-nav">
        {NAV.map((n) => <button key={n.id} className={`bottom-item ${route === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <span className="bottom-icon"><n.icon size={21} />{n.id === 'notiser' && unread > 0 && <i className="bottom-dot" />}</span>
          <span>{n.label}</span>
        </button>)}
      </nav>
    </div>
  </div>;
}
