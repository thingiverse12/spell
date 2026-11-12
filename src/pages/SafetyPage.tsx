import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Ban, Flag, Scale, LockKeyhole, Eye, FileText, Heart, ArrowRight, BookOpen, AlertTriangle, Info, Check, MessageSquareWarning, UserX } from 'lucide-react';
import { Button, Card, PageHeader, Section, Badge, Spinner, EmptyState, Modal, Textarea, Select, Avatar, Stat } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import { DECISION_LABELS, CATEGORY_LABELS } from '../lib/i18n';
import { timeAgo } from '../lib/utils';

export function SafetyPage({ navigate }: { navigate: (r: string) => void }) {
  const { profile, config, showToast } = useApp();
  const [blocks, setBlocks] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [restrictions, setRestrictions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [b, r, a, d, x] = await Promise.all([api.getBlocks(), api.getMyReports(), api.getAppeals(), api.myDecisions(), api.getMyRestrictions()]);
      setBlocks(b); setReports(r); setAppeals(a); setDecisions(d); setRestrictions(x);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [profile?.id]);

  const unblock = async (id: string) => {
    try { await api.unblockUser(id); await load(); showToast('Blockeringen togs bort.', 'info'); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const submitAppeal = async () => {
    if (!selectedDecision || appealReason.trim().length < 10) { showToast('Beskriv varför du överklagar (minst 10 tecken).', 'error'); return; }
    setBusy(true);
    try { await api.createAppeal(selectedDecision, appealReason); showToast('Överklagandet skickades till en mänsklig moderator.'); setAppealOpen(false); setAppealReason(''); await load(); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  return <>
    <PageHeader title="Säkerhetscenter" subtitle="Din trygghet, dina val och dina rättigheter." right={<Badge tone="green"><ShieldCheck size={13} /> Alltid tillgängligt</Badge>} />
    <Card className="safety-hero">
      <div className="safety-hero-icon"><ShieldCheck size={34} /></div>
      <div><h2>Trygghet är en funktion, inte ett löfte</h2>
        <p>Alla meddelanden, inlägg, kommentarer, bilder och profiltexter går igenom NEXA:s säkerhetsmotor innan de sparas. Osäkra bedömningar hamnar hos en utbildad mänsklig moderator – aldrig i en automatisk permanent avstängning.</p>
        <div className="safety-hero-chips"><Badge tone="violet">Åldersseparering i databasen</Badge><Badge tone="blue">Kontextuell AI-moderation</Badge><Badge tone="green">Mänsklig granskning</Badge><Badge tone="amber">Rätt att överklaga</Badge></div>
      </div>
    </Card>

    <div className="safety-stats"><Card><Stat label="Mina rapporter" value={reports.length} /></Card><Card><Stat label="Blockeringar" value={blocks.length} tone="#B45CFF" /></Card><Card><Stat label="Modereringsbeslut" value={decisions.length} tone="#3FCF8E" /></Card><Card><Stat label="Överklaganden" value={appeals.length} tone="#F5A524" /></Card></div>

    <Section title="Hur säkerhetsmotorn fungerar" description="Transparens om automatisk behandling av ditt innehåll.">
      <div className="info-grid">
        <Card className="info-card"><Eye size={20} /><h3>Vad analyseras</h3><p>Text normaliseras (Unicode, homoglyfer, skiljetecken, mellanrum, upprepade tecken, leetspeak och fonetiska stavningar), sätts i kontext med tidigare meddelanden och jämförs med policyregler. Bilder och röst kräver OCR-/transkriberingsleverantör; saknas den granskas de manuellt.</p></Card>
        <Card className="info-card"><ShieldAlert size={20} /><h3>Vad som händer</h3><p>Beslut: <strong>ALLOW, WARN, HOLD_FOR_REVIEW, BLOCK, ESCALATE</strong>. Låg risk ger en utbildande varning, upprepade försök ger tillfälliga begränsningar och allvarliga fall eskaleras till moderatorer. Varje beslut loggas med kategori, konfidens och förklaring.</p></Card>
        <Card className="info-card"><LockKeyhole size={20} /><h3>Vad vi inte gör</h3><p>Inga ID-handlingar eller biometriska data sparas. Ingen exakt plats, skola eller hemadress visas. Inga privata samtal spelas in. Vi påstår inte end-to-end-kryptering eftersom servern läser innehållet för moderering.</p></Card>
        <Card className="info-card"><Scale size={20} /><h3>Dina rättigheter</h3><p>Du kan se beslut om ditt eget innehåll, överklaga, begära ut dina data och radera kontot. Juridisk efterlevnad (GDPR, DSA, svensk rätt och EU:s regler för minderåriga) kräver separat juridisk granskning och DPIA före skarp lansering.</p></Card>
      </div>
    </Section>

    <Section title="Åldersgrupper" description="Servern tillämpar separationen – appen kan inte kringgå den.">
      <Card className="settings-card">
        <div className="age-band-row"><Badge tone="violet">13–14</Badge><span>Kan bara upptäcka, kontakta och kommunicera med andra i 13–14. Romantiskt intresse är alltid avstängt.</span></div>
        <div className="age-band-row"><Badge tone="blue">15–17</Badge><span>Kan bara upptäcka, kontakta och kommunicera med andra i 15–17. Romantiskt intresse är avstängt tills juridisk och barnsäkerhetsgranskning är klar.</span></div>
        <div className="age-band-row"><Badge tone="grey">Din grupp</Badge><strong>{profile?.age_group || 'Inte verifierad'}</strong></div>
      </Card>
    </Section>

    <Section title="Blockerade användare" description="Blockerade personer kan inte kontakta dig eller se dig i Upptäck.">
      {loading ? <Spinner /> : blocks.length === 0 ? <EmptyState icon={<UserX size={24} />} title="Inga blockeringar" description="Du kan blockera någon från en profil eller chatt." /> :
        <Card className="settings-card">{blocks.map((b) => <div key={b.id} className="list-row"><Avatar name={b.blocked_id.slice(0, 6)} id={b.blocked_id} size={34} /><span><strong>Användare {b.blocked_id.slice(0, 8)}</strong><small>{timeAgo(b.created_at)}</small></span><Button size="sm" variant="outline" onClick={() => unblock(b.blocked_id)}>Häv</Button></div>)}</Card>}
    </Section>

    <Section title="Mina rapporter" description="Status för ärenden du skickat till moderatorerna.">
      {reports.length === 0 ? <EmptyState icon={<Flag size={24} />} title="Inga rapporter" description="Rapportera olämpligt innehåll direkt där du ser det." /> :
        <Card className="settings-card">{reports.map((r) => <div key={r.id} className="list-row"><MessageSquareWarning size={18} /><span><strong>{r.reason}</strong><small>{r.target_type} · {timeAgo(r.created_at)}</small></span><Badge tone={r.status === 'resolved' ? 'green' : r.status === 'dismissed' ? 'grey' : 'amber'}>{r.status}</Badge></div>)}</Card>}
    </Section>

    <Section title="Beslut om mitt innehåll" description="Varje automatiskt beslut kan överklagas till en mänsklig moderator.">
      {decisions.length === 0 ? <EmptyState icon={<FileText size={24} />} title="Inga beslut ännu" description="När du skriver något visas bedömningen här." /> :
        <Card className="decision-list">{decisions.slice(0, 12).map((d) => <div key={d.id} className="decision-row">
          <div><div className="decision-row-head"><Badge tone={d.decision === 'ALLOW' ? 'green' : d.decision === 'WARN' ? 'amber' : 'red'}>{DECISION_LABELS[d.decision] || d.decision}</Badge><strong>{CATEGORY_LABELS[d.category] || d.category}</strong><span>{Math.round((d.confidence || 0) * 100)}% konfidens</span></div>
            <p>{d.explanation}</p><small>{d.policy_rule || '–'} · {d.provider} · {timeAgo(d.created_at)}</small></div>
          <Button size="sm" variant="outline" icon={<Scale size={13} />} onClick={() => { setSelectedDecision(d.id); setAppealOpen(true); }}>Överklaga</Button>
        </div>)}</Card>}
    </Section>

    <Section title="Begränsningar och överklaganden" description="Gradvisa åtgärder – aldrig permanent avstängning på osäker AI ensam.">
      <Card className="settings-card">
        {restrictions.length === 0 && appeals.length === 0 && <p className="muted">Inga begränsningar eller överklaganden.</p>}
        {restrictions.map((r) => <div key={r.id} className="list-row"><ShieldAlert size={17} /><span><strong>{r.kind === 'warning' ? 'Varning' : 'Tillfällig begränsning'}</strong><small>{r.reason} · {timeAgo(r.created_at)}</small></span></div>)}
        {appeals.map((a) => <div key={a.id} className="list-row"><Scale size={17} /><span><strong>Överklagande</strong><small>{a.reason.slice(0, 70)} · {timeAgo(a.created_at)}</small></span><Badge tone={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}>{a.status}</Badge></div>)}
      </Card>
    </Section>

    <Section title="Behöver du hjälp?" description="Vid akut fara, kontakta alltid en vuxen du litar på eller myndighet.">
      <Card className="help-card"><div><BookOpen size={22} /><div><strong>Gemenskapsregler</strong><p>Var schysst, dela aldrig privata uppgifter, flytta inte samtal till andra appar och rapportera det som känns fel.</p></div></div>
        <Button variant="outline" icon={<ArrowRight size={15} />} onClick={() => navigate('installningar')}>Till inställningar</Button></Card>
    </Section>

    <Modal open={appealOpen} onClose={() => setAppealOpen(false)} title="Överklaga beslut">
      <p className="muted">En utbildad mänsklig moderator granskar innehållet och beslutet. Beskriv varför du tycker att bedömningen blev fel.</p>
      <Textarea rows={4} label="Ditt överklagande" value={appealReason} onChange={(e) => setAppealReason(e.target.value)} />
      <Button full icon={<Scale size={15} />} loading={busy} onClick={submitAppeal}>Skicka överklagande</Button>
    </Modal>
  </>;
}
