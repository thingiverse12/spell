import React, { useEffect, useState } from 'react';
import { Settings2, ShieldCheck, UserRound, Users, MessageCircle, Pencil, Check, Camera, LogOut, Download, Trash2, ChevronRight, Heart, Flag, Ban, LockKeyhole, Sparkles, Bell, X } from 'lucide-react';
import { Button, Card, Avatar, Badge, PageHeader, Spinner, EmptyState, Modal, Input, Textarea, Toggle, Select, Stat, Section } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Profile, Interest } from '../lib/types';
import { downloadJson } from '../lib/utils';

export function ProfilePage({ navigate }: { navigate: (r: string, data?: any) => void }) {
  const { profile, refreshProfile, signOut, showToast, demoMode } = useApp();
  const [edit, setEdit] = useState(false);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [form, setForm] = useState({ username: '', bio: '', interests: [] as string[], friend_pref: 'friends' as string, avatar_url: null as string | null });
  const [connections, setConnections] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [ageStatus, setAgeStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setForm({ username: profile.username, bio: profile.bio, interests: profile.interests || [], friend_pref: profile.friend_pref || 'friends', avatar_url: profile.avatar_url });
    Promise.all([api.getInterests(), api.getConnections(), api.getMyReports(), api.myAgeStatus()]).then(([i, c, r, a]) => {
      setInterests(i); setConnections(c); setReports(r); setAgeStatus(a);
    }).catch(() => {});
  }, [profile?.id, profile?.username]);

  const save = async () => {
    if (!/^[a-z0-9_]{3,20}$/.test(form.username)) { setError('Användarnamn: 3–20 tecken (a–z, 0–9, _).'); return; }
    setBusy(true); setError('');
    try { await api.saveProfile(form as any); await refreshProfile(); setEdit(false); showToast('Profilen sparades.'); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const upload = async (f: File) => {
    setBusy(true);
    try { const row = await api.uploadMedia(f, 'image'); await api.saveProfile({ avatar_url: 'storage:' + row.bucket_path }); await refreshProfile(); showToast('Profilbilden laddades upp och granskas.'); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const exportAll = async () => {
    try { const data = await api.exportData(); downloadJson(data, 'nexa-mina-data.json'); showToast('Dina data har laddats ner.'); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const del = async () => {
    setBusy(true);
    try { await api.deleteAccount(); showToast('Kontot raderades.', 'info'); await signOut(); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!profile) return <Spinner />;
  const label = (s: string) => interests.find((i) => i.slug === s)?.label_sv || s;
  const friends = connections.filter((c) => c.status === 'accepted');

  return <>
    <PageHeader title="Profil" subtitle="Din plats i NEXA." right={<Button variant="outline" icon={<Pencil size={15} />} onClick={() => setEdit(true)}>Redigera</Button>} />
    <Card className="profile-hero">
      <div className="profile-hero-bg" />
      <div className="profile-hero-inner">
        <div className="profile-avatar-wrap"><Avatar name={profile.username} url={profile.avatar_url} id={profile.id} size={96} />
          <label className="avatar-edit"><Camera size={14} /><input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} /></label>
        </div>
        <div className="profile-hero-text"><h2>@{profile.username} {profile.is_demo && <Badge tone="amber">DEMO</Badge>}</h2>
          <p>{profile.bio || 'Ingen presentation ännu.'}</p>
          <div className="chip-row"><Badge tone="violet">{profile.age} år · {profile.age_group}</Badge><Badge tone={profile.discoverable ? 'green' : 'grey'}>{profile.discoverable ? 'Synlig i Upptäck' : 'Privat profil'}</Badge>{profile.friend_pref === 'romance' && <Badge tone="blue">Romantik (15–17)</Badge>}</div>
        </div>
      </div>
      <div className="profile-stats"><Stat label="Vänner" value={friends.length} /><Stat label="Intressen" value={(profile.interests || []).length} tone="#B45CFF" /><Stat label="Rapporter" value={reports.length} tone="#F5A524" /></div>
    </Card>

    <div className="two-col">
      <Section title="Om mig" description="Det här visas för andra i din åldersgrupp.">
        <Card className="settings-card">
          <div className="info-line"><span>Användarnamn</span><strong>@{profile.username}</strong></div>
          <div className="info-line"><span>Åldersgrupp</span><strong>{profile.age_group}</strong></div>
          <div className="info-line"><span>Ålderverifiering</span><strong>{ageStatus?.status === 'demo' ? 'Självdeklarerad (demo)' : ageStatus?.status || '–'}</strong></div>
          <div className="info-line"><span>ID / biometri</span><strong>{ageStatus?.identity_document_stored ? 'Sparas' : 'Sparas inte'}</strong></div>
          <h4>Intressen</h4><div className="chip-row">{(profile.interests || []).map((s) => <span key={s} className="mini-chip">{label(s)}</span>)}</div>
          <h4>Vänskapspreferens</h4><p className="muted">{profile.friend_pref === 'romance' ? 'Åldersanpassat romantiskt intresse (endast 15–17, kräver juridisk granskning).' : profile.friend_pref === 'interests' ? 'Vänner med samma intressen.' : 'Nya vänner.'}</p>
        </Card>
      </Section>
      <Section title="Genvägar" description="Allt som hör till ditt konto.">
        <Card className="shortcut-list">
          {[
            { icon: ShieldCheck, title: 'Säkerhetscenter', desc: 'Blockeringar, rapporter, överklaganden och integritet', route: 'sakerhet' },
            { icon: Settings2, title: 'Inställningar', desc: 'Integritet, notiser, språk och externa tjänster', route: 'installningar' },
            { icon: Users, title: 'Upptäck', desc: 'Hitta nya vänner', route: 'upptack' },
            { icon: MessageCircle, title: 'Chatt', desc: 'Dina konversationer', route: 'chatt' },
          ].map((s) => <button key={s.route} className="shortcut" onClick={() => navigate(s.route)}><span className="shortcut-icon"><s.icon size={18} /></span><span><strong>{s.title}</strong><small>{s.desc}</small></span><ChevronRight size={16} /></button>)}
        </Card>
      </Section>
    </div>

    <Section title="Mina data" description="GDPR: tillgång, portabilitet och radering.">
      <Card className="settings-card">
        <div className="data-row"><div><strong>Ladda ner mina data</strong><p>Export av profil, meddelanden, beslut och inställningar som JSON.</p></div><Button variant="outline" icon={<Download size={15} />} onClick={exportAll}>Exportera</Button></div>
        <div className="data-row"><div><strong>Radera mitt konto</strong><p>Raderar eller anonymiserar personuppgifter enligt vår raderingsprocess.</p></div><Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>Radera</Button></div>
        <div className="data-row"><div><strong>Logga ut</strong><p>Avslutar sessionen på den här enheten.</p></div><Button variant="ghost" icon={<LogOut size={15} />} onClick={signOut}>Logga ut</Button></div>
      </Card>
    </Section>

    <Modal open={edit} onClose={() => setEdit(false)} title="Redigera profil">
      <Input label="Användarnamn" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
      <Textarea label="Kort presentation" rows={3} maxLength={160} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      <span className="field-label">Intressen</span>
      <div className="interest-grid small">{interests.map((i) => <button key={i.slug} className={`interest-pill ${form.interests.includes(i.slug) ? 'active' : ''}`} onClick={() => setForm({ ...form, interests: form.interests.includes(i.slug) ? form.interests.filter((x) => x !== i.slug) : [...form.interests, i.slug] })}>{i.emoji} {i.label_sv}</button>)}</div>
      <Select label="Jag vill hitta…" value={form.friend_pref} onChange={(e) => setForm({ ...form, friend_pref: e.target.value })}>
        <option value="friends">Nya vänner</option><option value="interests">Personer med samma intressen</option>
        {profile.age_group === '15-17' && <option value="romance">Romantiskt intresse (kräver juridisk granskning)</option>}
      </Select>
      {error && <div className="form-error">{error}</div>}
      <Button full icon={<Check size={15} />} onClick={save} loading={busy}>Spara ändringar</Button>
    </Modal>
    <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Radera kontot?">
      <p>Detta raderar ditt konto och dina personuppgifter enligt NEXA:s raderingsprocess. Åtgärden kan inte ångras.</p>
      <div className="modal-actions"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Avbryt</Button><Button variant="danger" icon={<Trash2 size={15} />} loading={busy} onClick={del}>Ja, radera</Button></div>
    </Modal>
  </>;
}
