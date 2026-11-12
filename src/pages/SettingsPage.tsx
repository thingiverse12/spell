import React, { useEffect, useState } from 'react';
import { Settings2, Globe, Bell, LockKeyhole, PlugZap, ShieldCheck, Eye, KeyRound, Save, AlertTriangle, Check, RefreshCw, Server, Sparkles, Download } from 'lucide-react';
import { Button, Card, PageHeader, Section, Badge, Toggle, Select, Input, Stat, Spinner } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import { t } from '../lib/i18n';

interface Provider { key: string; label: string; neededFor: string; secret: string; endpoint?: string; status: string; name?: string; model?: string; ageAssurance?: boolean }

const PROVIDERS: Provider[] = [
  { key: 'age_verification_provider', label: 'Åldersförsäkran', neededFor: 'Verifierar åldersband 13–14 / 15–17 utan att lagra ID eller biometri.', secret: 'NEXA_AGE_PROVIDER_KEY', status: 'not_configured', ageAssurance: true },
  { key: 'moderation_provider', label: 'AI-moderering (text)', neededFor: 'Extern språkmodell för kompletterande kontextuell bedömning. Den inbyggda motorn är alltid aktiv.', secret: 'NEXA_MODERATION_API_KEY', status: 'not_configured' },
  { key: 'vision_ocr_provider', label: 'Bildanalys & OCR', neededFor: 'Läser text i bilder och bedömer bildinnehåll. Utan denna hålls bilder för manuell granskning.', secret: 'NEXA_MEDIA_API_KEY', status: 'not_configured' },
  { key: 'transcription_provider', label: 'Rösttranskribering', neededFor: 'Transkriberar röstmeddelanden till text som säkerhetsmotorn kan analysera.', secret: 'NEXA_MEDIA_API_KEY', status: 'not_configured' },
  { key: 'webrtc_provider', label: 'Hanterad WebRTC', neededFor: 'Videosamtal efter ömsesidigt godkännande. Avstängt tills säkerhetsarkitekturen är testad.', secret: 'NEXA_WEBRTC_KEY', status: 'disabled' },
];
const FLAGS = [
  { key: 'romance_enabled', label: 'Åldersanpassat romantiskt intresse (15–17)', desc: 'Kräver juridisk granskning och barnsäkerhetsbedömning innan aktivering.' },
  { key: 'video_calls_enabled', label: 'Videosamtal', desc: 'Kräver ömsesidigt godkännande, WebRTC-leverantör och testad säkerhetsarkitektur.' },
  { key: 'demo_mode', label: 'Demoläge', desc: 'Visar tydlig demomärkning. Demodata är märkta med demo_ och is_demo.' },
  { key: 'voice_messages_enabled', label: 'Röstmeddelanden', desc: 'Kräver transkriberingsleverantör för automatisk moderering.' },
  { key: 'legal_review_complete', label: 'Juridisk granskning klar', desc: 'Sätts endast av behörig administratör efter DPIA och barnsäkerhetsgranskning.' },
];

export function SettingsPage({ navigate }: { navigate: (r: string) => void }) {
  const { profile, config, refreshConfig, refreshProfile, showToast, moderator } = useApp();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [privacy, setPrivacy] = useState({ discoverable: true, show_online: false, allow_requests: 'everyone', locale: 'sv' });
  const [providerForms, setProviderForms] = useState<Record<string, any>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [mfaLevel, setMfaLevel] = useState<string>('–');
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<any>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    if (!profile) return;
    setPrivacy({ discoverable: profile.discoverable, show_online: profile.show_online, allow_requests: profile.allow_requests, locale: profile.locale });
    api.getPrefs().then((p) => setPrefs(p || {})).catch(() => {});
  }, [profile?.id]);
  useEffect(() => {
    const f: Record<string, boolean> = {}; FLAGS.forEach((x) => { f[x.key] = config[x.key] === true; }); setFlags(f);
    const forms: Record<string, any> = {};
    PROVIDERS.forEach((p) => { forms[p.key] = config[p.key] || { name: '', endpoint: '', secret_name: p.secret, status: p.status, model: '' }; });
    setProviderForms(forms);
  }, [config]);
  useEffect(() => {
    if (!moderator) return;
    api.mfa.level().then(({ data }: any) => setMfaLevel(data?.currentLevel || '–')).catch(() => {});
    api.mfa.list().then(({ data }: any) => setMfaFactors(data?.totp || [])).catch(() => {});
  }, [moderator]);

  const savePrivacy = async (patch: Partial<typeof privacy>) => {
    setPrivacy((p) => ({ ...p, ...patch }));
    try { await api.saveProfile(patch as any); await refreshProfile(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const setPref = async (key: string, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    try { await api.savePrefs({ [key]: value }); } catch (e: any) { showToast(e.message, 'error'); }
  };
  const saveProvider = async (p: Provider) => {
    if (!moderator) { showToast('Endast moderatorer/administratörer kan spara leverantörskonfiguration (RBAC).', 'info'); return; }
    const v = providerForms[p.key];
    if (v.status === 'active' && (!v.name || !v.endpoint)) { showToast('Namn och endpoint krävs för att aktivera en leverantör.', 'error'); return; }
    setBusy(true);
    try { await api.setConfig(p.key, { ...v, secret_name: v.secret_name || p.secret }); await refreshConfig(); showToast('Leverantörskonfigurationen sparades.'); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const saveFlag = async (key: string, value: boolean) => {
    if (!moderator) { showToast('Endast moderatorer/administratörer kan ändra systemflaggor (RBAC).', 'info'); return; }
    setFlags((f) => ({ ...f, [key]: value }));
    try { await api.setConfig(key, value); await refreshConfig(); showToast('Flaggan uppdaterades.', 'info'); }
    catch (e: any) { showToast(e.message, 'error'); setFlags((f) => ({ ...f, [key]: !value })); }
  };
  const startEnroll = async () => {
    try { const { data, error } = await api.mfa.enroll(); if (error) throw error; setEnroll(data); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const verifyMfa = async () => {
    if (!enroll || mfaCode.length < 6) return;
    try {
      const { data: ch, error: ce } = await api.mfa.challenge(enroll.id); if (ce) throw ce;
      const { error: ve } = await api.mfa.verify(enroll.id, ch.id, mfaCode); if (ve) throw ve;
      showToast('Tvåfaktorsautentisering aktiverad.'); setEnroll(null); setMfaCode('');
      api.mfa.list().then(({ data }: any) => setMfaFactors(data?.totp || []));
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  return <>
    <PageHeader title="Inställningar" subtitle="Integritet, språk, notiser och externa tjänster." right={<Button variant="outline" icon={<RefreshCw size={15} />} onClick={refreshConfig}>Uppdatera</Button>} />

    <Section title="Integritet" description="Gäller direkt och kontrolleras av databasens RLS.">
      <Card className="settings-card">
        <Toggle label="Synlig i Upptäck" description="Bara personer i samma åldersgrupp kan se din profil." checked={privacy.discoverable} onChange={(v) => savePrivacy({ discoverable: v })} />
        <Toggle label="Visa online-status" description="Visar endast om du varit aktiv nyligen." checked={privacy.show_online} onChange={(v) => savePrivacy({ show_online: v })} />
        <div className="field"><span className="field-label">Vem får skicka förfrågningar?</span>
          <div className="chip-row">{[['everyone', 'Alla i min grupp'], ['connections', 'Bara vänner'], ['none', 'Ingen']].map(([v, l]) => <button key={v} className={`chip ${privacy.allow_requests === v ? 'active' : ''}`} onClick={() => savePrivacy({ allow_requests: v })}>{l}</button>)}</div>
        </div>
      </Card>
    </Section>

    <Section title="Språk & notiser" description="Svenska är standardspråket. Arkitekturen stöder fler språk.">
      <Card className="settings-card">
        <Select label="Språk" value={privacy.locale} onChange={(e) => savePrivacy({ locale: e.target.value })}><option value="sv">Svenska</option><option value="en">English (partial)</option></Select>
        <p className="muted small">Nycklar som saknas i en översättning faller tillbaka på svenska: <code>{t('safety', 'sv')}</code> / <code>{t('safety', 'en')}</code>.</p>
        <Toggle label="Vänförfrågningar" checked={prefs.friend_requests !== false} onChange={(v) => setPref('friend_requests', v)} />
        <Toggle label="Nya meddelanden" checked={prefs.messages !== false} onChange={(v) => setPref('messages', v)} />
        <Toggle label="Community-aktivitet" checked={prefs.community_activity !== false} onChange={(v) => setPref('community_activity', v)} />
        <Toggle label="Omnämnanden" checked={prefs.mentions !== false} onChange={(v) => setPref('mentions', v)} />
        <Toggle label="Säkerhetsvarningar" checked={prefs.safety_warnings !== false} onChange={(v) => setPref('safety_warnings', v)} />
      </Card>
    </Section>

    <Section title="Externa tjänster & API-nycklar" description="Alla beroenden listas öppet. Inga hemligheter sparas i webbläsaren eller i den här databastabellen.">
      {!moderator && <div className="ob-note"><LockKeyhole size={16} /><div><strong>Skrivskyddad vy (RBAC)</strong> — Endast användare i <code>nexa_moderators</code> kan ändra leverantörer och systemflaggor. <button className="link-btn" onClick={() => navigate('admin')}>Öppna Moderatorpanelen</button></div></div>}
      <div className="provider-note"><KeyRound size={18} /><div><strong>Så här kopplar du en leverantör</strong><p>Ange leverantörens namn, endpoint och status nedan. API-nyckeln läggs som en Supabase Edge Function-secret med exakt det angivna namnet (t.ex. <code>NEXA_MODERATION_API_KEY</code>). Aktivera först när nyckeln finns. För OpenAI moderation används <code>https://api.openai.com/v1/moderations</code> och modellen <code>omni-moderation-latest</code>.</p></div></div>
      <div className="provider-grid">{PROVIDERS.map((p) => {
        const v = providerForms[p.key] || {};
        return <Card key={p.key} className="provider-card">
          <div className="provider-head"><PlugZap size={18} /><h3>{p.label}</h3><Badge tone={v.status === 'active' ? 'green' : v.status === 'disabled' ? 'grey' : 'amber'}>{v.status === 'active' ? 'Ansluten' : v.status === 'disabled' ? 'Avstängd' : 'Ej konfigurerad'}</Badge></div>
          <p className="provider-desc">{p.neededFor}</p>
          <Input label="Leverantör / namn" value={v.name || ''} onChange={(e) => setProviderForms((f) => ({ ...f, [p.key]: { ...v, name: e.target.value } }))} placeholder={p.key.includes('moderation') ? 'OpenAI' : 'Leverantörens namn'} />
          <Input label="Endpoint" value={v.endpoint || ''} onChange={(e) => setProviderForms((f) => ({ ...f, [p.key]: { ...v, endpoint: e.target.value } }))} placeholder="https://…" />
          {p.key === 'moderation_provider' && <Input label="Modell" value={v.model || ''} onChange={(e) => setProviderForms((f) => ({ ...f, [p.key]: { ...v, model: e.target.value } }))} placeholder="omni-moderation-latest" />}
          <Input label="Secret-namn" value={v.secret_name || p.secret} onChange={(e) => setProviderForms((f) => ({ ...f, [p.key]: { ...v, secret_name: e.target.value } }))} />
          <Select label="Status" value={v.status || p.status} onChange={(e) => setProviderForms((f) => ({ ...f, [p.key]: { ...v, status: e.target.value } }))}><option value="not_configured">Ej konfigurerad</option><option value="active">Aktiv</option><option value="disabled">Avstängd</option></Select>
          <Button size="sm" variant="outline" icon={<Save size={14} />} onClick={() => saveProvider(p)} loading={busy}>Spara</Button>
        </Card>;
      })}</div>
    </Section>

    <Section title="Funktionsflaggor" description="Kritiska funktioner förblir avstängda tills granskning är klar.">
      <Card className="settings-card">{FLAGS.map((f) => <Toggle key={f.key} label={f.label} description={f.desc} checked={!!flags[f.key]} onChange={(v) => saveFlag(f.key, v)} />)}</Card>
    </Section>

    {moderator && <Section title="Moderatorkonto – MFA" description="Tvåfaktorsautentisering för känsliga moderatoråtgärder.">
      <Card className="settings-card">
        <div className="info-line"><span>AAL-nivå</span><strong>{mfaLevel}</strong></div>
        <div className="info-line"><span>Registrerade faktorer</span><strong>{mfaFactors.length}</strong></div>
        {mfaFactors.length === 0 && !enroll && <Button variant="outline" icon={<ShieldCheck size={15} />} onClick={startEnroll}>Aktivera TOTP</Button>}
        {enroll && <div className="mfa-enroll"><p> Skanna QR-koden med din autentiseringsapp, eller ange nyckeln manuellt:</p><code>{enroll.totp?.secret}</code><img src={enroll.totp?.qr_code} alt="TOTP QR" /><Input label="Engångskod" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" /><Button icon={<Check size={15} />} onClick={verifyMfa}>Verifiera</Button></div>}
      </Card>
    </Section>}

    <Section title="Kontosäkerhet" description="Säkerhetskopior, kryptering, revision och radering hanteras på servern.">
      <Card className="settings-card">
        <div className="info-line"><span>TLS / kryptering i vila</span><strong>Hanteras av Supabase</strong></div>
        <div className="info-line"><span>Privat medielagring</span><strong>nexa-media (RLS)</strong></div>
        <div className="info-line"><span>Alla känsliga moderatoråtgärder</span><strong>Revisionsloggas</strong></div>
        <div className="info-line"><span>End-to-end-kryptering</span><strong>Nej – moderation läser innehåll</strong></div>
        <div className="ob-note"><AlertTriangle size={15} /> Juridisk granskning, DPIA, barnsäkerhetsgranskning, incidenthantering och DSA-rapportering återstår före skarp lansering.</div>
      </Card>
    </Section>
  </>;
}
