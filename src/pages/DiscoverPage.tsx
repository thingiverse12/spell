import React, { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, MessageCircle, Flag, Ban, Heart, Sparkles, Users, RefreshCw, MapPinOff, X } from 'lucide-react';
import { Button, Card, Avatar, Badge, Chip, PageHeader, Spinner, EmptyState, ErrorState, Modal, Select, Textarea, Stat } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Profile, Connection, Interest } from '../lib/types';
import { isOnline } from '../lib/utils';

export function DiscoverPage({ navigate }: { navigate: (r: string, data?: any) => void }) {
  const { profile, config, showToast } = useApp();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('alla');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Profile | null>(null);
  const [reportTarget, setReportTarget] = useState<Profile | null>(null);
  const [reportReason, setReportReason] = useState('Olämpligt beteende');
  const [reportDetails, setReportDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [mutual, setMutual] = useState<string[]>([]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [p, c, i] = await Promise.all([api.getDiscoverProfiles(), api.getConnections(), api.getInterests()]);
      setProfiles(p); setConnections(c); setInterests(i);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [profile?.id]);

  const interestLabel = (slug: string) => interests.find((i) => i.slug === slug)?.label_sv || slug;
  const shared = (p: Profile) => (p.interests || []).filter((x) => (profile?.interests || []).includes(x));
  const connFor = (id: string) => connections.find((c) => (c.requester_id === id || c.addressee_id === id));
  const romanceAvailable = profile?.age_group === '15-17' && config.romance_enabled === true;

  const filtered = useMemo(() => profiles.filter((p) => {
    if (query && !(`${p.username} ${p.bio} ${(p.interests || []).map(interestLabel).join(' ')}`.toLowerCase().includes(query.toLowerCase()))) return false;
    if (filter === 'delade' && shared(p).length === 0) return false;
    if (filter === 'hobbies' && (p.interests || []).length < 3) return false;
    if (filter === 'communities' && !(p as any)._hasCommunity) return true;
    if (filter === 'romantik' && !romanceAvailable) return false;
    return true;
  }).sort((a, b) => shared(b).length - shared(a).length), [profiles, query, filter, interests, profile, romanceAvailable]);

  const sendRequest = async (p: Profile, kind: 'friend' | 'romance' = 'friend') => {
    setBusy(true);
    try { await api.sendConnection(p.id, kind); await load(); showToast(`Förfrågan skickad till ${p.username}.`); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const openChat = async (p: Profile) => {
    setBusy(true);
    try { const cid = await api.startDirectConversation(p.id); navigate('chatt', { conversationId: cid }); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const block = async (p: Profile) => {
    try { await api.blockUser(p.id); await load(); showToast(`${p.username} är blockerad.`, 'info'); setDetail(null); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const report = async () => {
    if (!reportTarget) return;
    setBusy(true);
    try { await api.reportContent('user', reportTarget.id, reportReason, reportDetails); showToast('Rapporten skickades till moderatorerna.'); setReportTarget(null); setReportDetails(''); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const openDetail = async (p: Profile) => {
    setDetail(p); setMutual([]);
    try { setMutual(await api.getMutualCommunities(p.id)); } catch { /* */ }
  };

  if (loading) return <><PageHeader title="Upptäck" subtitle="Hitta nya vänner med samma intressen." /><Spinner /></>;
  if (error) return <><PageHeader title="Upptäck" /><ErrorState message={error} onRetry={load} /></>;

  return <>
    <PageHeader title="Upptäck" subtitle={`Personer i din åldersgrupp · ${profile?.age_group || 'ej verifierad'}`}
      right={<Button variant="outline" icon={<RefreshCw size={15} />} onClick={load}>Uppdatera</Button>} />

    <Card className="discover-hero">
      <div className="discover-hero-text"><Sparkles size={20} /><div><strong>Hitta dina människor</strong><span>Matchningen tar alltid hänsyn till åldersgrupp och säkerhetsregler först – sedan delade intressen.</span></div></div>
      <div className="discover-stats"><Stat label="I din grupp" value={profiles.length} /><Stat label="Delade intressen" value={profiles.filter((p) => shared(p).length > 0).length} tone="#B45CFF" /><Stat label="Vänner" value={connections.filter((c) => c.status === 'accepted').length} tone="#3FCF8E" /></div>
    </Card>

    <div className="search-bar"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök på namn eller intresse…" />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</div>
    <div className="chip-row scroll-x">
      <Chip active={filter === 'alla'} onClick={() => setFilter('alla')}>Alla</Chip>
      <Chip active={filter === 'vanner'} onClick={() => setFilter('vanner')}><UserPlus size={14} /> Hitta vänner</Chip>
      <Chip active={filter === 'delade'} onClick={() => setFilter('delade')}><Sparkles size={14} /> Delade intressen</Chip>
      <Chip active={filter === 'hobbies'} onClick={() => setFilter('hobbies')}>Liknande hobbies</Chip>
      <Chip active={filter === 'communities'} onClick={() => setFilter('communities')}><Users size={14} /> Communities</Chip>
      {profile?.age_group === '15-17' && <Chip active={filter === 'romantik'} onClick={() => romanceAvailable ? setFilter('romantik') : showToast('Romantiskt intresse är avstängt tills juridisk och barnsäkerhetsgranskning är klar.', 'info')}><Heart size={14} /> Romantik {!romanceAvailable && '(låst)'}</Chip>}
    </div>

    {filtered.length === 0 ? <EmptyState icon={<Search size={26} />} title="Inga profiler hittades" description="Prova ett annat filter eller en annan sökning. Du ser bara personer i din egen åldersgrupp." action={<Button variant="outline" onClick={() => { setQuery(''); setFilter('alla'); }}>Rensa filter</Button>} /> :
      <div className="profile-grid">{filtered.map((p) => {
        const c = connFor(p.id); const sh = shared(p);
        return <Card key={p.id} className="profile-card">
          <div className="profile-card-top"><Avatar name={p.username} url={p.avatar_url} id={p.id} size={62} online={isOnline(p)} />
            {p.is_demo && <Badge tone="amber" className="demo-tag">DEMO</Badge>}
          </div>
          <div className="profile-card-name"><strong>@{p.username}</strong><span>{p.age} år</span></div>
          <div className="profile-card-badges">{isOnline(p) && <Badge tone="green">Online</Badge>}<Badge tone="violet">{p.age_group}</Badge></div>
          <p className="profile-card-bio">{p.bio || 'Ingen presentation ännu.'}</p>
          <div className="profile-interests">{sh.slice(0, 3).map((s) => <span key={s} className="mini-chip active">✨ {interestLabel(s)}</span>)}{(p.interests || []).filter((s) => !sh.includes(s)).slice(0, 2).map((s) => <span key={s} className="mini-chip">{interestLabel(s)}</span>)}</div>
          <div className="profile-card-actions">
            {c?.status === 'accepted' ? <Button size="sm" icon={<MessageCircle size={15} />} onClick={() => openChat(p)} disabled={busy}>Chatta</Button>
              : c?.status === 'pending' ? <Button size="sm" variant="soft" disabled>Förfrågan skickad</Button>
                : <Button size="sm" icon={<UserPlus size={15} />} onClick={() => sendRequest(p)} disabled={busy}>Skicka förfrågan</Button>}
            <Button size="sm" variant="outline" onClick={() => openDetail(p)}>Visa</Button>
          </div>
        </Card>;
      })}</div>}

    <div className="privacy-note"><MapPinOff size={16} /> NEXA visar aldrig exakt plats, skola, hemadress eller live-position.</div>

    <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `@${detail.username}` : ''}>
      {detail && <>
        <div className="detail-head"><Avatar name={detail.username} url={detail.avatar_url} id={detail.id} size={84} /><div><h3>@{detail.username}</h3><p>{detail.age} år · {detail.age_group} · {isOnline(detail) ? 'Online' : 'Offline'}</p></div></div>
        <p className="detail-bio">{detail.bio || 'Ingen presentation ännu.'}</p>
        <h4>Intressen</h4><div className="chip-row">{(detail.interests || []).map((s) => <span key={s} className="mini-chip">{interestLabel(s)}</span>)}</div>
        <h4>Gemensamma communities</h4><p className="muted">{mutual.length ? `${mutual.length} gemensamma communities` : 'Inga gemensamma communities ännu.'}</p>
        <div className="detail-actions">
          <Button variant="outline" icon={<Ban size={15} />} onClick={() => block(detail)}>Blockera</Button>
          <Button variant="ghost" icon={<Flag size={15} />} onClick={() => { setReportTarget(detail); setDetail(null); }}>Rapportera</Button>
        </div>
      </>}
    </Modal>

    <Modal open={!!reportTarget} onClose={() => setReportTarget(null)} title="Rapportera">
      {reportTarget && <>
        <p className="muted">Rapportera @{reportTarget.username}. En mänsklig moderator granskar ärendet.</p>
        <Select label="Anledning" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
          {['Olämpligt beteende', 'Mobbning eller hot', 'Sexuellt innehåll', 'Delar privata uppgifter', 'Falskt konto', 'Spam', 'Annat'].map((r) => <option key={r}>{r}</option>)}
        </Select>
        <Textarea label="Beskrivning (valfritt)" rows={3} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} />
        <Button full icon={<Flag size={15} />} onClick={report} loading={busy}>Skicka rapport</Button>
      </>}
    </Modal>
  </>;
}
