import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, UserPlus, MessageCircle, ShieldAlert, Users, AtSign, LockKeyhole, Inbox, Check } from 'lucide-react';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorState, Toggle, Section } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Connection } from '../lib/types';
import { timeAgo } from '../lib/utils';

const ICONS: Record<string, any> = {
  friend_request: UserPlus,
  friend_accepted: UserPlus,
  connection_accepted: UserPlus,
  message: MessageCircle,
  new_message: MessageCircle,
  community: Users,
  community_comment: Users,
  mention: AtSign,
  safety: ShieldAlert,
  safety_warning: ShieldAlert,
  security: LockKeyhole,
};

export function NotificationsPage() {
  const { profile, notifications, refreshNotifications, showToast } = useApp();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tab, setTab] = useState<'alla' | 'olasta'>('alla');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [p, c] = await Promise.all([api.getPrefs(), api.getConnections(), refreshNotifications()]);
      setPrefs(p || {});
      setConnections(c || []);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [profile?.id]);

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
  const respond = async (connId: string, status: 'accepted' | 'declined', noteId: string) => {
    setBusy(true);
    try {
      await api.respondConnection(connId, status);
      await api.markNotificationRead(noteId);
      await load();
      showToast(status === 'accepted' ? 'Vänförfrågan accepterad!' : 'Förfrågan avböjdes.', status === 'accepted' ? 'success' : 'info');
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
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
        const isDanger = n.type === 'safety' || n.type === 'safety_warning' || n.type === 'security';
        const pendingConn = n.type === 'friend_request' && n.data?.connection_id
          ? connections.find((c) => c.id === n.data.connection_id && c.status === 'pending' && c.addressee_id === profile?.id)
          : undefined;
        return <div key={n.id} className={`notification-item ${n.read ? '' : 'unread'}`} onClick={async () => { if (!n.read) { await api.markNotificationRead(n.id); await refreshNotifications(); } }}>
          <span className={`notification-icon ${isDanger ? 'danger' : ''}`}><Icon size={18} /></span>
          <span className="notification-text"><strong>{n.title}</strong><span>{n.body}</span><small>{timeAgo(n.created_at)}</small></span>
          {pendingConn && <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" icon={<Check size={13} />} onClick={() => respond(pendingConn.id, 'accepted', n.id)} disabled={busy}>Acceptera</Button>
            <Button size="sm" variant="ghost" onClick={() => respond(pendingConn.id, 'declined', n.id)} disabled={busy}>Avböj</Button>
          </div>}
          {!n.read && <span className="unread-dot" />}
        </div>;
      })}
    </Card>
    <Section title="Notisinställningar" description="Välj vad du vill bli påmind om.">
      <Card className="settings-card">
        <Toggle label="Vänförfrågningar och accepterade kopplingar" checked={prefs.friend_requests !== false} onChange={(v) => setPref('friend_requests', v)} />
        <Toggle label="Nya meddelanden" checked={prefs.messages !== false} onChange={(v) => setPref('messages', v)} />
        <Toggle label="Aktivitet i communities" checked={prefs.community_activity !== false} onChange={(v) => setPref('community_activity', v)} />
        <Toggle label="Omnämnanden" checked={prefs.mentions !== false} onChange={(v) => setPref('mentions', v)} />
        <Toggle label="Säkerhetsvarningar" description="Rekommenderas alltid att vara på." checked={prefs.safety_warnings !== false} onChange={(v) => setPref('safety_warnings', v)} />
        <Toggle label="Kontosäkerhet" checked={prefs.security !== false} onChange={(v) => setPref('security', v)} />
      </Card>
    </Section>
  </>;
}
