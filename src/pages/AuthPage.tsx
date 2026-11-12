import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, Check, LockKeyhole, Mail, Sparkles, ShieldCheck, Users, MessageCircle, Loader2, Camera } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Button, Card, Input, Badge, Toggle, Avatar } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Interest } from '../lib/types';

const DEMO_ACCOUNTS = [
  { label: 'Demokonto · 13–14 år (@demo_alva)', email: 'demo_alva@nexa.demo', password: 'Demo1234!' },
  { label: 'Demokonto · 15–17 år + Moderator (@demo_elis)', email: 'demo_elis@nexa.demo', password: 'Demo1234!' },
];

export function AuthPage() {
  const { showToast } = useApp();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [sentReset, setSentReset] = useState(false);

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Ange en giltig e-postadress.';
    if (password.length < 8) return 'Lösenordet måste vara minst 8 tecken.';
    if (!/\d/.test(password)) return 'Lösenordet måste innehålla minst en siffra.';
    return '';
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const v = validate(); if (v) { setError(v); return; }
    setBusy(true); setError('');
    try {
      if (mode === 'signup') { await api.auth.signUp(email, password); showToast('Kontot skapades. Nu sätter vi upp din profil.'); }
      else { await api.auth.signIn(email, password); showToast('Välkommen tillbaka!'); }
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };
  const demoLogin = async (d: typeof DEMO_ACCOUNTS[number]) => {
    setBusy(true); setError('');
    try { await api.auth.signIn(d.email, d.password); showToast('Inloggad med tydligt märkt demokonto.', 'info'); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!email) { setError('Skriv din e-postadress först.'); return; }
    setBusy(true); setError('');
    try { await api.auth.resetPassword(email); setSentReset(true); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return <div className="auth-page">
    <div className="auth-art">
      <div className="auth-art-inner">
        <Logo size={54} />
        <h1>Connect.<br /><span>Talk.</span><br />Belong.</h1>
        <p>En tryggare plats att hitta nya vänner, prata om det du gillar och vara en del av en community.</p>
        <div className="auth-features">
          <div><div className="auth-feature-icon"><Users size={20} /></div><div><strong>Hitta dina människor</strong><small>Matchning på intressen – aldrig på exakt plats.</small></div></div>
          <div><div className="auth-feature-icon"><MessageCircle size={20} /></div><div><strong>Prata tryggt</strong><small>Alla meddelanden analyseras av säkerhetsmotorn.</small></div></div>
          <div><div className="auth-feature-icon"><ShieldCheck size={20} /></div><div><strong>Två åldersgrupper</strong><small>13–14 och 15–17 hålls helt separerade i databasen.</small></div></div>
        </div>
        <div className="auth-art-footer"><Badge tone="green">Säkerhet först</Badge><Badge tone="violet">Svenska</Badge><Badge tone="blue">Mobil & desktop</Badge></div>
      </div>
      <div className="auth-glow auth-glow-1" /><div className="auth-glow auth-glow-2" />
    </div>
    <div className="auth-form-side">
      <Card className="auth-card">
        <div className="auth-mobile-logo"><Logo size={38} /></div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Logga in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Skapa konto</button>
        </div>
        <h2>{mode === 'login' ? 'Välkommen tillbaka' : 'Bli en del av NEXA'}</h2>
        <p className="auth-sub">{mode === 'login' ? 'Logga in för att fortsätta där du slutade.' : 'NEXA är till för dig som är 13–17 år.'}</p>
        <form onSubmit={submit}>
          <Input label="E-post" type="email" autoComplete="email" placeholder="du@exempel.se" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Lösenord" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="Minst 8 tecken och en siffra" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="form-error">{error}</div>}
          <Button type="submit" full loading={busy} icon={mode === 'signup' ? <Sparkles size={16} /> : <ArrowRight size={16} />}>
            {mode === 'login' ? 'Logga in' : 'Skapa konto'}
          </Button>
        </form>
        {mode === 'login' && <button className="link-btn" onClick={reset}>Glömt lösenordet?</button>}
        {sentReset && <div className="form-success"><Check size={15} /> Återställningslänk skickad om kontot finns.</div>}
        <div className="auth-divider"><span>eller prova med demokonto</span></div>
        <div className="demo-accounts">
          {DEMO_ACCOUNTS.map((d) => <button key={d.email} className="demo-account" onClick={() => demoLogin(d)} disabled={busy}>
            <Badge tone="amber">DEMO</Badge><span>{d.label}</span><ArrowRight size={15} />
          </button>)}
        </div>
        <p className="auth-legal">Genom att fortsätta godkänner du våra <button className="inline-link" onClick={() => showToast('Säkerhetsreglerna visas efter inloggning i Säkerhetscenter.', 'info')}>gemenskapsregler</button> och <button className="inline-link" onClick={() => showToast('Personuppgifter behandlas enligt dataminimering. Se Säkerhetscenter.', 'info')}>integritetspolicy</button>. Juridisk granskning krävs före skarp lansering.</p>
      </Card>
    </div>
  </div>;
}

// ---------------------------------------------------------------- onboarding
const STEPS = ['Välkommen', 'Ålder', 'Profil', 'Intressen', 'Integritet', 'Regler'];
export function Onboarding() {
  const { profile, refreshProfile, showToast, demoMode } = useApp();
  const [step, setStep] = useState(0);
  const [birthDate, setBirthDate] = useState('');
  const [ageResult, setAgeResult] = useState<any>(null);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [interestList, setInterestList] = useState<Interest[]>([]);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [discoverable, setDiscoverable] = useState(true);
  const [showOnline, setShowOnline] = useState(false);
  const [allowRequests, setAllowRequests] = useState<'everyone' | 'connections' | 'none'>('everyone');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => { api.getInterests().then(setInterestList).catch(() => {}); }, []);
  React.useEffect(() => { if (profile?.age_group) setAgeResult({ age_group: profile.age_group, demo: true }); }, [profile?.age_group]);

  const verify = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) { setError('Välj ett giltigt födelsedatum.'); return; }
    setBusy(true); setError('');
    try { const r = await api.verifyAge(birthDate); setAgeResult(r); await refreshProfile(); showToast('Åldersgrupp fastställd på servern.'); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const uploadAvatar = async (file: File) => {
    setBusy(true); setError('');
    try { const row = await api.uploadMedia(file, 'image'); setAvatarPath('storage:' + row.bucket_path); showToast('Bilden laddades upp och skickades till säkerhetsgranskning.'); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const finish = async () => {
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { setError('Användarnamn: 3–20 tecken, små bokstäver, siffror eller understreck.'); return; }
    if (interests.length < 3) { setError('Välj minst tre intressen.'); return; }
    if (!accepted) { setError('Du behöver godkänna gemenskapsreglerna.'); return; }
    setBusy(true); setError('');
    try {
      await api.saveProfile({
        username, bio, interests, discoverable, show_online: showOnline,
        allow_requests: allowRequests, avatar_url: avatarPath, onboarding_complete: true, locale: 'sv',
      });
      await refreshProfile(); showToast('Klart! Välkommen till NEXA.');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const next = async () => {
    setError('');
    if (step === 1 && !ageResult) { setError('Verifiera din ålder först.'); return; }
    if (step === STEPS.length - 1) { await finish(); return; }
    setStep(step + 1);
  };

  return <div className="onboarding">
    <div className="onboarding-top"><Logo size={40} />{demoMode && <Badge tone="amber">DEMOLÄGE</Badge>}</div>
    <div className="onboarding-progress">{STEPS.map((s, i) => <div key={s} className={`ob-step ${i <= step ? 'done' : ''} ${i === step ? 'current' : ''}`}><span>{i < step ? <Check size={13} /> : i + 1}</span><small>{s}</small></div>)}</div>
    <Card className="onboarding-card">
      {step === 0 && <>
        <div className="ob-icon"><ShieldCheck size={30} /></div>
        <h2>Välkommen till NEXA</h2>
        <p>Vi bygger en plats där du kan vara dig själv utan att känna dig osäker. Därför finns några viktiga regler från start:</p>
        <ul className="ob-list">
          <li><Check size={16} /> Du kan bara se och prata med personer i din egen åldersgrupp.</li>
          <li><Check size={16} /> Alla meddelanden, inlägg och bilder går igenom säkerhetsmotorn.</li>
          <li><Check size={16} /> Vi visar aldrig exakt plats, skola eller hemadress.</li>
          <li><Check size={16} /> Du kan alltid blockera, rapportera och överklaga ett beslut.</li>
        </ul>
        {demoMode && <div className="ob-note"><Badge tone="amber">DEMO</Badge> I demoläget är åldern självdeklarerad. I skarp drift används en integritetsskyddande åldersverifierare.</div>}
      </>}
      {step === 1 && <>
        <div className="ob-icon"><LockKeyhole size={30} /></div>
        <h2>Hur gammal är du?</h2>
        <p>Vi behöver bara veta vilken åldersgrupp du tillhör: <strong>13–14</strong> eller <strong>15–17</strong>. Åldersgruppen sätts på servern och kan inte ändras i appen.</p>
        <Input label="Födelsedatum" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <Button variant="outline" onClick={verify} loading={busy} icon={<ShieldCheck size={16} />}>Verifiera ålder</Button>
        {ageResult && <div className="ob-success"><Check size={16} /> Åldersgrupp: <strong>{ageResult.age_group}</strong> · {ageResult.demo ? 'självdeklarerad (demo)' : 'verifierad av leverantör'}</div>}
        <div className="ob-note"><ShieldCheck size={15} /> Inga ID-handlingar eller biometriska data sparas. Exakta födelsedatum är endast synliga för dig.</div>
      </>}
      {step === 2 && <>
        <div className="ob-icon"><Camera size={30} /></div>
        <h2>Skapa din profil</h2>
        <div className="ob-avatar-row"><Avatar name={username || '?'} url={avatarPath} size={76} id={profile?.id} />
          <label className="avatar-upload">Välj profilbild<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} /></label>
        </div>
        <Input label="Användarnamn" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="t.ex. stjarnhimmel" hint="3–20 tecken: a–z, 0–9 och _" />
        <label className="field"><span className="field-label">Kort presentation</span><textarea className="input textarea" rows={3} maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Berätta kort om dig och dina intressen" /><span className="field-hint">{bio.length}/160 · analyseras av säkerhetsmotorn</span></label>
      </>}
      {step === 3 && <>
        <div className="ob-icon"><Sparkles size={30} /></div>
        <h2>Vad gillar du?</h2>
        <p>Välj minst tre. Vi använder dem för att föreslå vänner och communities med samma intressen.</p>
        <div className="interest-grid">{interestList.map((i) => <button key={i.slug} className={`interest-pill ${interests.includes(i.slug) ? 'active' : ''}`} onClick={() => setInterests((v) => v.includes(i.slug) ? v.filter((x) => x !== i.slug) : [...v, i.slug])}>
          <span>{i.emoji}</span>{i.label_sv}{interests.includes(i.slug) && <Check size={14} />}
        </button>)}</div>
        <div className="ob-count">Valda: {interests.length} / minst 3</div>
      </>}
      {step === 4 && <>
        <div className="ob-icon"><LockKeyhole size={30} /></div>
        <h2>Dina integritetsval</h2>
        <p>Du kan ändra detta när som helst under Inställningar.</p>
        <Toggle checked={discoverable} onChange={setDiscoverable} label="Synlig i Upptäck" description="Andra i din åldersgrupp kan hitta din profil." />
        <Toggle checked={showOnline} onChange={setShowOnline} label="Visa online-status" description="Visar bara om du varit aktiv nyligen – aldrig en plats." />
        <div className="field"><span className="field-label">Vem får skicka förfrågningar?</span>
          <div className="chip-row">
            {([['everyone', 'Alla i min grupp'], ['connections', 'Bara vänner'], ['none', 'Ingen']] as const).map(([v, l]) => <button key={v} className={`chip ${allowRequests === v ? 'active' : ''}`} onClick={() => setAllowRequests(v)}>{l}</button>)}
          </div>
        </div>
      </>}
      {step === 5 && <>
        <div className="ob-icon"><ShieldCheck size={30} /></div>
        <h2>Gemenskapsregler</h2>
        <div className="rules-box">
          <p>1. Var schysst. Ingen mobbning, hot, hat eller sexuella inviter.</p>
          <p>2. Dela aldrig privata uppgifter: adress, skola, lösenord, personnummer eller exakt plats.</p>
          <p>3. Försök inte flytta samtal till andra appar eller kringgå säkerhetsmotorn.</p>
          <p>4. Rapportera sådant som känns fel. En mänsklig moderator granskar allvarliga ärenden.</p>
          <p>5. NEXA är för 13–17 år, uppdelat i två helt separerade åldersgrupper.</p>
        </div>
        <label className="check-row"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>Jag har läst och godkänner reglerna och förstår hur modereringen fungerar.</span></label>
        <div className="ob-note"><Badge tone="blue">Info</Badge> Vi påstår inte juridisk efterlevnad. GDPR, DSA och svensk rätt kräver separat juridisk och barnsäkerhetsgranskning före lansering.</div>
      </>}
      {error && <div className="form-error">{error}</div>}
      <div className="ob-actions">
        {step > 0 && <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => { setError(''); setStep(step - 1); }}>Tillbaka</Button>}
        <Button onClick={next} loading={busy} icon={step === STEPS.length - 1 ? <Check size={16} /> : <ArrowRight size={16} />}>
          {step === STEPS.length - 1 ? 'Slutför och börja' : 'Fortsätt'}
        </Button>
      </div>
    </Card>
    <div className="onboarding-foot"><Mail size={14} /> Behöver du hjälp? Säkerhetscenter finns alltid i profilen.</div>
  </div>;
}
