import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, UserPlus, MessageCircle, ShieldAlert, Users, AtSign, LockKeyhole, Settings2, Inbox } from 'lucide-react';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorState, Toggle, Badge, Section } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Notification } from '../lib/types';
import { timeAgo } from '../lib/utils';

const ICONS: Record<string, any> = {
  friend_request: UserPlus, friend_accepted: UserPlus, message: MessageCircle,
  community: Users, mention: AtSign, safety: ShieldAlert, security: LockKeyhole,
};

export function NotificationsPage() {
  const { notifications, refreshNotifications, showToast } = useApp();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'alla' | 'olasta'>('alla');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try { const [p] = await Promise.all([api.getPrefs(), refreshNotifications()]); setPrefs(p || {}); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const list = tab === 'olasta' ? notifications.filter((n) => !n.read) : notifications;
  const markAll = async () => {
    setBusy(true);
    try { await api.markAllNotificationsRead(); await refreshNotifications(); showToast('Alla notiser markerade som lästa.'); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const setPref = async (key: string, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    try { await api.savePrefs({ [key]: value }); }
    catch (e: any) { showToast(e.message, 'error'); setPrefs((p) => ({ ...p, [key]: !value })); }
  };

  if (loading) return <><PageHeader title="Notiser" /><Spinner /></>;
  if (error) return <><PageHeader title="Notiser" /><ErrorState message={error} onRetry={load} /></>;

  return <>
    <PageHeader title="Notiser" subtitle="Vänförfrågningar, meddelanden och säkerhetsvarningar."
      right={<Button variant="outline" icon={<CheckCheck size={15} />} onClick={markAll} loading={busy}>Markera alla lästa</Button>} />
    <div className="chip-row"><button className={`chip ${tab === 'alla' ? 'active' : ''}`} onClick={() => setTab('alla')}>Alla</button><button className={`chip ${tab === 'olasta' ? 'active' : ''}`} onClick={() => setTab('olasta')}>Olästa ({notifications.filter((n) => !n.read).length})</button></div>
    <Card className="notification-list">
      {list.length === 0 ? <EmptyState icon={<Inbox size={26} />} title="Inga notiser" description="När något händer i NEXA dyker det upp här." /> : list.map((n) => {
        const Icon = ICONS[n.type] || Bell;
        return <button key={n.id} className={`notification-item ${n.read ? '' : 'unread'}`} onClick={async () => { if (!n.read) { await api.markNotificationRead(n.id); await refreshNotifications(); } }}>
          <span className={`notification-icon ${n.type === 'safety' || n.type === 'security' ? 'danger' : ''}`}><Icon size={18} /></span>
          <span className="notification-text"><strong>{n.title}</strong><span>{n.body}</span><small>{timeAgo(n.created_at)}</small></span>
          {!n.read && <span className="unread-dot" />}
        </button>;
      })}
    </Card>
    <Section title="Notisinställningar" description="Välj vad du vill bli påmind om.">
      <Card className="settings-card">
        <Toggle label="Vänförfrågningar och accepterade kopplingar" checked={prefs.friend_requests !== false} onChange={(v) => setPref('friend_requests', v)} />
        <Toggle label="Nya meddelanden" checked={prefs.messages !== false} onChange={(v) => setPref('messages', v)} />
        <Toggle label="Aktivitet i communities" checked={prefs.community_activity !== false} onChange={(v) => setPref('community_activity', v)} />
        <Toggle label="Omnämnanden" checked={prefs.mentions !== false} onChange={(v) => setPref('mentions', v)} />
        <Toggle label="Säkerhetsvarningar" description="Kan inte stängas av helt." checked={prefs.safety_warnings !== false} onChange={(v) => setPref('safety_warnings', v)} />
        <Toggle label="Kontosäkerhet" checked={prefs.security !== false} onChange={(v) => setPref('security', v)} />
      </Card>
    </Section>
  </>;
}
