import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Flag, Users, ClipboardList, ShieldAlert, BarChart3, Scale,
  ScrollText, FlaskConical, SlidersHorizontal, Plus, Play, RefreshCw, Check,
  Trash2, Eye, UserSearch, Download, ShieldCheck, KeyRound, Activity, Pencil, Sparkles,
} from 'lucide-react';
import { Button, Card, Badge, PageHeader, Spinner, EmptyState, ErrorState, Modal, Input, Textarea, Select, Tabs, Stat, Toggle, Section } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { ModerationResult, Policy, TestCase } from '../lib/types';
import { DECISION_LABELS, CATEGORY_LABELS } from '../lib/i18n';
import { timeAgo, downloadJson } from '../lib/utils';

type Tab = 'overview' | 'reports' | 'queue' | 'users' | 'incidents' | 'stats' | 'appeals' | 'policies' | 'tests' | 'audit';

const SANDBOX_PRESETS = [
  { label: 'Harmlös svenska', text: 'Hej! Vill du spela fotboll eller Minecraft i helgen?', ctx: '' },
  { label: 'Mellanrum + påhopp', text: 'd u m   i d i o t', ctx: '' },
  { label: 'Leetspeak', text: 'du är en 1d10t', ctx: '' },
  { label: 'Homoglyfer (kyrilliska)', text: 'n е g g е r', ctx: '' },
  { label: 'Flytt till extern plattform', text: 'Lägg till mig på snapchat istället', ctx: '' },
  { label: 'Grooming / hemlighållande', text: 'Träffas i hemlighet och säg inte till dina föräldrar', ctx: 'Hur gammal är du?\nSkicka en bild på dig' },
  { label: 'Hot om våld', text: 'Jag kommer och slår ihjäl dig imorgon', ctx: '' },
];

export function AdminPage() {
  const { moderator, demoMode, refreshProfile, showToast, config } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [queueTab, setQueueTab] = useState<'decisions' | 'media' | 'held'>('decisions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [queue, setQueue] = useState<{ decisions: any[]; media: any[]; held: any[] }>({ decisions: [], media: [], held: [] });
  const [suspicious, setSuspicious] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [history, setHistory] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [evalRun, setEvalRun] = useState<{ runId: string; rows: any[] } | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [mfaLevel, setMfaLevel] = useState<string>('–');

  // Live AI Sandbox state
  const [sandboxText, setSandboxText] = useState('d u m   i d i o t');
  const [sandboxCtx, setSandboxCtx] = useState('');
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxRes, setSandboxRes] = useState<ModerationResult | null>(null);

  const load = async () => {
    if (!moderator) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [d, o, r, q, s, i, a, p, c, e, l] = await Promise.all([
        api.getAllDecisions(), api.getModeratorOverrides(), api.getReports(), api.getReviewQueue(),
        api.getSuspiciousUsers(), api.getIncidents(), api.getAppealsAdmin(), api.getPolicies(),
        api.getTestCases(), api.getEvaluations(), api.getAuditLogs(),
      ]);
      setDecisions(d); setOverrides(o); setReports(r); setQueue(q); setSuspicious(s);
      setIncidents(i); setAppeals(a); setPolicies(p); setCases(c); setEvaluations(e); setAudit(l);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    if (moderator) api.mfa.level().then(({ data }: any) => setMfaLevel(data?.currentLevel || '–')).catch(() => {});
  }, [moderator]);

  const stats = useMemo(() => {
    const total = decisions.length;
    const flagged = decisions.filter((d) => d.decision !== 'ALLOW').length;
    const held = decisions.filter((d) => d.decision === 'HOLD_FOR_REVIEW').length;
    const escalated = decisions.filter((d) => d.decision === 'ESCALATE').length;
    const categories: Record<string, number> = {};
    const evasion: Record<string, number> = {};
    decisions.forEach((d) => {
      if (d.decision !== 'ALLOW') categories[d.category] = (categories[d.category] || 0) + 1;
      for (const sig of d.signals?.obfuscation || []) evasion[sig] = (evasion[sig] || 0) + 1;
    });
    evaluations.forEach((ev) => {
      if (ev.obfuscation_type && ev.obfuscation_type !== 'plain') {
        evasion[ev.obfuscation_type] = (evasion[ev.obfuscation_type] || 0) + 1;
      }
    });
    const sv = evaluations.filter((e) => e.language === 'sv');
    const en = evaluations.filter((e) => e.language === 'en');
    const acc = (rows: any[]) => rows.length ? Math.round(rows.filter((r) => r.passed).length / rows.length * 100) : null;
    return {
      total, flagged, held, escalated, categories, evasion,
      overridesCount: overrides.length,
      svAccuracy: acc(sv), enAccuracy: acc(en),
      accuracy: acc(evaluations),
      fp: evaluations.filter((e) => e.false_positive).length,
      fn: evaluations.filter((e) => e.false_negative).length,
    };
  }, [decisions, evaluations, overrides]);

  const openModal = (kind: string, data: any = {}, initial: Record<string, any> = {}) => { setModal(kind); setModalData(data); setForm(initial); };

  const claimModerator = async () => {
    setBusy(true);
    try {
      const role = await api.bootstrapModerator();
      await refreshProfile();
      showToast(`Moderatorroll aktiverad (${role}). Åtgärden har revisionsloggats.`);
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const runSandbox = async () => {
    if (!sandboxText.trim()) return;
    setSandboxBusy(true);
    try {
      const ctx = sandboxCtx.split('\n').map((s) => s.trim()).filter(Boolean);
      const r = await api.moderateText(sandboxText, 'test', ctx);
      setSandboxRes(r);
    } catch (e: any) { showToast(e.message, 'error'); } finally { setSandboxBusy(false); }
  };

  const runEval = async () => {
    setEvalBusy(true);
    try {
      const r = await api.runEvaluation(cases);
      setEvalRun(r);
      setEvaluations(await api.getEvaluations());
      showToast(`Utvärdering klar: ${r.rows.length} fall kördes mot den riktiga motorn.`);
    } catch (e: any) { showToast(e.message, 'error'); } finally { setEvalBusy(false); }
  };
  const savePolicy = async () => {
    if (!form.key || !form.pattern) { showToast('Nyckel och mönster krävs.', 'error'); return; }
    setBusy(true);
    try {
      await api.upsertPolicy({
        ...(modalData?.id ? { id: modalData.id } : {}), key: form.key, category: form.category,
        severity: Number(form.severity), pattern: form.pattern, enabled: form.enabled !== false,
        description: form.description, version: (modalData?.version || 0) + 1,
      } as any);
      setPolicies(await api.getPolicies()); setModal(null); showToast('Policyn sparades. Säkerhetsmotorn läser den direkt, utan ombyggnad.');
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const saveCase = async () => {
    if (!form.label || !form.text) { showToast('Etikett och text krävs.', 'error'); return; }
    setBusy(true);
    try {
      await api.addTestCase({
        label: form.label, language: form.language, text: form.text,
        expected_decision: form.expected_decision, expected_category: form.expected_category,
        harmful: form.harmful === true, obfuscation_type: form.obfuscation_type, active: true,
      });
      setCases(await api.getTestCases()); setModal(null); showToast('Testfallet lades till.');
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const moderatorAction = async (kind: string) => {
    setBusy(true);
    try {
      if (kind === 'warn') await api.warnUser(modalData.id, form.reason);
      if (kind === 'restrict') await api.restrictUser(modalData.id, Number(form.hours) || 24, form.reason);
      if (kind === 'override') await api.recordOverride(modalData.id, form.corrected, form.note);
      if (kind === 'appeal') await api.resolveAppeal(modalData.id, form.status, form.note);
      if (kind === 'report') await api.resolveReport(modalData.id, form.status);
      if (kind === 'media') await api.approveMedia(modalData.id, form.approve === true);
      if (kind === 'incident') await (form.resolve ? api.resolveIncident(modalData.id) : api.escalateIncident(modalData.id));
      showToast('Åtgärden sparades och revisionsloggades.'); setModal(null); await load();
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const openEvidence = async (report: any) => {
    setBusy(true);
    try {
      const ev = await api.getReportEvidence(report);
      openModal('evidence', ev);
      setAudit(await api.getAuditLogs());
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const handleHeldContent = async (item: any, status: 'visible' | 'removed') => {
    setBusy(true);
    try {
      await api.setContentStatus(item._contentKind || 'message', item.id, status);
      showToast(status === 'visible' ? 'Innehållet godkändes.' : 'Innehållet togs bort.');
      await load();
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const viewHistory = async (userId: string) => {
    try { setHistory(await api.getUserHistory(userId)); setModal('history'); setAudit(await api.getAuditLogs()); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  if (!moderator) return <>
    <PageHeader title="Moderatorpanel" subtitle="Rollbaserad åtkomstkontroll (RBAC) kontrolleras på servern via PostgreSQL RLS." />
    <Card className="gate-card">
      <ShieldAlert size={34} />
      <h2>Moderatorbehörighet krävs</h2>
      <p>Endast konton i tabellen <code>nexa_moderators</code> (roller: <code>moderator</code>, <code>senior_moderator</code>, <code>safety_lead</code>, <code>admin</code>) har läs- och skrivåtkomst till rapporter, granskningskö, AI-statistik, policys och revisionsloggar.</p>
      {demoMode && <>
        <div className="ob-note"><Sparkles size={16} /><div><strong>Demoläge aktivt</strong> — Du kan logga in som <code>demo_elis@nexa.demo</code> (Safety Lead) eller tilldela ditt nuvarande konto moderatorroll för utvärdering. Rolländringen loggas i <code>nexa_audit_logs</code>.</div></div>
        <Button icon={<ShieldCheck size={16} />} loading={busy} onClick={claimModerator}>Aktivera moderatorroll (DEMO / Bootstrap)</Button>
      </>}
    </Card>
  </>;
  if (loading) return <><PageHeader title="Moderatorpanel" /><Spinner /></>;
  if (error) return <><PageHeader title="Moderatorpanel" /><ErrorState message={error} onRetry={load} /></>;

  const TABS: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'overview', label: 'Översikt', icon: LayoutDashboard },
    { id: 'reports', label: 'Rapporter', icon: Flag, count: reports.filter((r) => r.status === 'pending').length },
    { id: 'queue', label: 'Granskningskö', icon: ClipboardList, count: queue.decisions.length + queue.media.length + queue.held.length },
    { id: 'users', label: 'Misstänkta konton', icon: UserSearch, count: suspicious.length },
    { id: 'incidents', label: 'Säkerhetsincidenter', icon: ShieldAlert, count: incidents.filter((x) => x.status !== 'resolved').length },
    { id: 'stats', label: 'AI-statistik', icon: BarChart3 },
    { id: 'appeals', label: 'Överklaganden', icon: Scale, count: appeals.filter((a) => a.status === 'pending').length },
    { id: 'policies', label: 'Policys', icon: SlidersHorizontal },
    { id: 'tests', label: 'Test & förbättring', icon: FlaskConical },
    { id: 'audit', label: 'Revisionslogg', icon: ScrollText },
  ];

  return <>
    <PageHeader title="Moderatorpanel" subtitle={`Roll: ${moderator} · AAL: ${mfaLevel} · Åtkomst till bevis är begränsad och loggas`}
      right={<><Badge tone={mfaLevel === 'aal2' ? 'green' : 'amber'}><KeyRound size={13} /> {mfaLevel === 'aal2' ? 'MFA aktiv' : 'MFA rekommenderas'}</Badge><Button variant="outline" icon={<RefreshCw size={15} />} onClick={load}>Uppdatera</Button></>} />
    <div className="admin-tabs scroll-x">{TABS.map((x) => <button key={x.id} className={`admin-tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}><x.icon size={16} /><span>{x.label}</span>{!!x.count && <span className="tab-count">{x.count}</span>}</button>)}</div>

    {tab === 'overview' && <>
      <div className="safety-stats">
        <Card><Stat label="Analyserade innehåll" value={stats.total} /></Card>
        <Card><Stat label="Flaggade" value={stats.flagged} tone="#B45CFF" /></Card>
        <Card><Stat label="Väntar på granskning" value={stats.held} tone="#F5A524" /></Card>
        <Card><Stat label="Eskalerade" value={stats.escalated} tone="#FF6B6B" /></Card>
        <Card><Stat label="Öppna rapporter" value={reports.filter((r) => r.status === 'pending').length} tone="#3FCF8E" /></Card>
        <Card><Stat label="Överklaganden" value={appeals.filter((a) => a.status === 'pending').length} tone="#7AA2F7" /></Card>
      </div>
      <div className="two-col">
        <Section title="Senaste beslut" description="Live-flöde från säkerhetsmotorn." right={<Button size="sm" variant="ghost" onClick={() => setTab('stats')}>Visa alla</Button>}>
          <Card className="decision-list">{decisions.slice(0, 8).map((d) => <div key={d.id} className="decision-row"><div><div className="decision-row-head"><Badge tone={d.decision === 'ALLOW' ? 'green' : d.decision === 'WARN' ? 'amber' : 'red'}>{DECISION_LABELS[d.decision] || d.decision}</Badge><strong>{CATEGORY_LABELS[d.category] || d.category}</strong><span>{Math.round(d.confidence * 100)}%</span></div><p>{d.explanation}</p><small>{d.provider} · {timeAgo(d.created_at)}</small></div></div>)}</Card>
        </Section>
        <Section title="Kategorifördelning" description="Flaggade innehåll per kategori.">
          <Card className="chart-card">{Object.entries(stats.categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="bar-row"><span>{CATEGORY_LABELS[k] || k}</span><div className="bar"><i style={{ width: `${Math.min(100, (v / Math.max(1, stats.flagged)) * 100)}%` }} /></div><strong>{v}</strong></div>)}{Object.keys(stats.categories).length === 0 && <p className="muted">Inga flaggade beslut ännu.</p>}</Card>
        </Section>
      </div>
      <div className="provider-note"><Activity size={18} /><div><strong>Motorstatus</strong><p>Version {config.engine_version || '1.0.3'} · inbyggd kontextuell motor aktiv på Supabase Edge. Extern språkmodell: {config.moderation_provider?.status === 'active' ? 'ansluten' : 'ej konfigurerad'}. OCR/bild: {config.vision_ocr_provider?.status === 'active' ? 'ansluten' : 'saknas → manuell granskning'}. Transkribering: {config.transcription_provider?.status === 'active' ? 'ansluten' : 'saknas → manuell granskning'}.</p></div></div>
    </>}

    {tab === 'reports' && <Section title="Rapporter" description="Användarrapporter med begränsad och revisionsloggad åtkomst till bevis.">
      {reports.length === 0 ? <EmptyState icon={<Flag size={24} />} title="Inga rapporter" /> : <Card className="table-card">{reports.map((r) => <div key={r.id} className="table-row"><div><strong>{r.reason}</strong><small>{r.target_type} · {r.target_id?.slice(0, 8)} · {timeAgo(r.created_at)}</small><p>{r.details || '–'}</p></div><Badge tone={r.status === 'resolved' ? 'green' : r.status === 'dismissed' ? 'grey' : 'amber'}>{r.status}</Badge><div className="row-actions"><Button size="sm" variant="outline" icon={<Eye size={13} />} onClick={() => openEvidence(r)} disabled={busy}>Bevis</Button><Button size="sm" variant="ghost" icon={<Check size={13} />} onClick={() => openModal('report', r, { status: 'resolved' })}>Hantera</Button></div></div>)}</Card>}
    </Section>}

    {tab === 'queue' && <Section title="Granskningskö" description="Osäkra AI-beslut, media utan leverantör och hållet innehåll – alltid mänsklig bedömning.">
      <Tabs tabs={[{ id: 'decisions', label: 'AI-beslut', count: queue.decisions.length }, { id: 'media', label: 'Media', count: queue.media.length }, { id: 'held', label: 'Hållet innehåll', count: queue.held.length }]} active={queueTab} onChange={(id) => setQueueTab(id as any)} />
      {queueTab === 'decisions' && (queue.decisions.length === 0 ? <EmptyState icon={<Check size={24} />} title="Kön är tom" /> : <Card className="table-card">{queue.decisions.map((d) => <div key={d.id} className="table-row"><div><div className="decision-row-head"><Badge tone={d.decision === 'ESCALATE' ? 'red' : 'amber'}>{DECISION_LABELS[d.decision] || d.decision}</Badge><strong>{CATEGORY_LABELS[d.category] || d.category}</strong><span>{Math.round(d.confidence * 100)}%</span></div><p>{d.explanation}</p><small>Hash: {String(d.content_hash).slice(0, 16)}… · {d.provider} · {timeAgo(d.created_at)}</small></div><div className="row-actions"><Button size="sm" variant="outline" onClick={() => openModal('override', d, { corrected: 'ALLOW', note: '' })}>Korrigera AI</Button><Button size="sm" variant="ghost" onClick={() => d.user_id && viewHistory(d.user_id)}>Historik</Button></div></div>)}</Card>)}
      {queueTab === 'media' && (queue.media.length === 0 ? <EmptyState icon={<Check size={24} />} title="Inga media att granska" /> : <Card className="table-card">{queue.media.map((m) => <div key={m.id} className="table-row"><div><strong>{m.kind} · {m.mime}</strong><small>{m.bucket_path} · {timeAgo(m.created_at)}</small><p>Status: {m.status} – kräver mänsklig granskning när OCR/transkribering saknas.</p></div><div className="row-actions"><Button size="sm" variant="outline" onClick={() => openModal('media', m, { approve: true })}>Granska</Button></div></div>)}</Card>)}
      {queueTab === 'held' && (queue.held.length === 0 ? <EmptyState icon={<Check size={24} />} title="Inget hållet innehåll" /> : <Card className="table-card">{queue.held.map((h: any) => <div key={h.id} className="table-row"><div><strong>{h.body || 'Innehåll utan text'}</strong><small>{h._contentKind || 'innehåll'} · {timeAgo(h.created_at)}</small></div><Badge tone="amber">Hållt</Badge><div className="row-actions"><Button size="sm" variant="outline" icon={<Check size={13} />} onClick={() => handleHeldContent(h, 'visible')} disabled={busy}>Godkänn</Button><Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => handleHeldContent(h, 'removed')} disabled={busy}>Ta bort</Button></div></div>)}</Card>)}
    </Section>}

    {tab === 'users' && <Section title="Misstänkta konton" description="Konton med upprepade flaggade beslut. Inga privata konversationer används för automatisk träning.">
      {suspicious.length === 0 ? <EmptyState icon={<Users size={24} />} title="Inga misstänkta konton" /> : <Card className="table-card">{suspicious.map((u) => <div key={u.id} className="table-row"><div><strong>@{u.username}</strong><small>{u.age_group} · {u.status} {u.is_demo && '· DEMO'}</small></div><Badge tone="red">{u.incidents} incidenter</Badge><div className="row-actions"><Button size="sm" variant="outline" icon={<Eye size={13} />} onClick={() => viewHistory(u.id)}>Användarhistorik</Button><Button size="sm" variant="ghost" onClick={() => openModal('warn', u, { reason: '' })}>Varna</Button><Button size="sm" variant="ghost" onClick={() => openModal('restrict', u, { hours: 24, reason: '' })}>Begränsa</Button></div></div>)}</Card>}
    </Section>}

    {tab === 'incidents' && <Section title="Säkerhetsincidenter" description="Allvarliga händelser som kräver utbildad moderator.">
      {incidents.length === 0 ? <EmptyState icon={<ShieldCheck size={24} />} title="Inga incidenter" /> : <Card className="table-card">{incidents.map((i) => <div key={i.id} className="table-row"><div><strong>{CATEGORY_LABELS[i.category] || i.category}</strong><small>Allvarlighetsgrad {i.severity} · {timeAgo(i.created_at)}</small><p>{i.summary}</p></div><Badge tone={i.status === 'resolved' ? 'green' : i.status === 'escalated' ? 'red' : 'amber'}>{i.status}</Badge><Button size="sm" variant="outline" onClick={() => openModal('incident', i, { resolve: false })}>Hantera</Button></div>)}</Card>}
    </Section>}

    {tab === 'stats' && <Section title="AI-statistik & kvalitet" description="Träffsäkerhet, falska positiva/negativa, moderator-overrides, kringgåendemönster och svenska/engelska prestanda.">
      <div className="safety-stats">
        <Card><Stat label="Totala beslut" value={stats.total} /></Card>
        <Card><Stat label="Flaggade" value={stats.flagged} tone="#B45CFF" /></Card>
        <Card><Stat label="Träffsäkerhet (tester)" value={stats.accuracy === null ? '–' : `${stats.accuracy}%`} tone="#3FCF8E" /></Card>
        <Card><Stat label="Svenska / Engelska" value={`${stats.svAccuracy ?? '–'}% / ${stats.enAccuracy ?? '–'}%`} /></Card>
        <Card><Stat label="Falska pos / neg" value={`${stats.fp} / ${stats.fn}`} tone="#F5A524" /></Card>
        <Card><Stat label="Moderator-korrigeringar" value={stats.overridesCount} tone="#7AA2F7" /></Card>
      </div>
      <div className="two-col">
        <Card className="chart-card"><h3>Beslut</h3>{['ALLOW', 'WARN', 'HOLD_FOR_REVIEW', 'BLOCK', 'ESCALATE'].map((d) => { const n = decisions.filter((x) => x.decision === d).length; return <div key={d} className="bar-row"><span>{DECISION_LABELS[d]}</span><div className="bar"><i style={{ width: `${Math.min(100, n / Math.max(1, stats.total) * 100)}%` }} /></div><strong>{n}</strong></div>; })}</Card>
        <Card className="chart-card"><h3>Kategorier</h3>{Object.entries(stats.categories).map(([k, v]) => <div key={k} className="bar-row"><span>{CATEGORY_LABELS[k] || k}</span><div className="bar"><i style={{ width: `${Math.min(100, (v as number) / Math.max(1, stats.flagged) * 100)}%` }} /></div><strong>{v as number}</strong></div>)}{!Object.keys(stats.categories).length && <p className="muted">Inga flaggade kategorier ännu.</p>}</Card>
      </div>
      <Section title="Identifierade kringgåendemönster (obfuscation & evasion)" description="Mellanrum, leetspeak, Unicode-homoglyfer, stavelseuppdelning, skiljetecken och kontextsignaler.">
        <Card className="chart-card">
          {Object.entries(stats.evasion).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="bar-row"><span>{k}</span><div className="bar"><i style={{ width: `${Math.min(100, v * 12)}%` }} /></div><strong>{v}</strong></div>)}
          {!Object.keys(stats.evasion).length && <p className="muted">Kör utvärderingssviten eller live-testet för att samla mönsterstatistik.</p>}
        </Card>
      </Section>
    </Section>}

    {tab === 'appeals' && <Section title="Överklaganden" description="Ingen permanent avstängning får bygga enbart på osäker AI.">
      {appeals.length === 0 ? <EmptyState icon={<Scale size={24} />} title="Inga överklaganden" /> : <Card className="table-card">{appeals.map((a) => <div key={a.id} className="table-row"><div><strong>{a.reason}</strong><small>Beslut {a.decision_id?.slice(0, 8)} · {timeAgo(a.created_at)}</small>{a.resolution_note && <p>{a.resolution_note}</p>}</div><Badge tone={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}>{a.status}</Badge>{a.status === 'pending' && <Button size="sm" variant="outline" onClick={() => openModal('appeal', a, { status: 'approved', note: '' })}>Beslut</Button>}</div>)}</Card>}
    </Section>}

    {tab === 'policies' && <Section title="Policyhantering" description="Ändringar gäller direkt i motorn – ingen ombyggnad. Varje ändring revisionsloggas." right={<Button icon={<Plus size={15} />} onClick={() => openModal('policy', null, { key: `P-NY-${Date.now().toString().slice(-4)}`, category: 'bullying', severity: 3, pattern: '', description: '', enabled: true })}>Ny policy</Button>}>
      <Card className="table-card">{policies.map((p) => <div key={p.id} className="table-row"><div><strong>{p.key}</strong><small>{CATEGORY_LABELS[p.category] || p.category} · allvarlighet {p.severity} · v{p.version} · {p.signal_type}</small><p className="code-line">{p.pattern}</p></div><Badge tone={p.enabled ? 'green' : 'grey'}>{p.enabled ? 'Aktiv' : 'Av'}</Badge><div className="row-actions"><Button size="sm" variant="outline" icon={<Pencil size={13} />} onClick={() => openModal('policy', p, { key: p.key, category: p.category, severity: p.severity, pattern: p.pattern, description: p.description, enabled: p.enabled })}>Redigera</Button></div></div>)}</Card>
    </Section>}

    {tab === 'tests' && <>
      <Section title="Live AI-säkerhetstest (realtidsanalys)" description="Testa valfri text och konversationskontext direkt mot Supabase Edge-motorn och granska hela beslutsstrukturen.">
        <Card className="settings-card">
          <div className="chip-row">{SANDBOX_PRESETS.map((p) => <button key={p.label} className="chip" onClick={() => { setSandboxText(p.text); setSandboxCtx(p.ctx); }}>{p.label}</button>)}</div>
          <Textarea label="Meddelande / inlägg att analysera" rows={2} value={sandboxText} onChange={(e) => setSandboxText(e.target.value)} />
          <Textarea label="Tidigare meddelanden i konversationen (valfritt, en rad per meddelande för kontextanalys)" rows={2} value={sandboxCtx} onChange={(e) => setSandboxCtx(e.target.value)} placeholder="T.ex. Hur gammal är du?" />
          <Button icon={<Play size={15} />} loading={sandboxBusy} onClick={runSandbox}>Analysera med live-motorn</Button>
          {sandboxRes && <div className="eval-result">
            <div className="decision-row-head">
              <Badge tone={sandboxRes.decision === 'ALLOW' ? 'green' : sandboxRes.decision === 'WARN' ? 'amber' : 'red'}>{DECISION_LABELS[sandboxRes.decision] || sandboxRes.decision} ({sandboxRes.decision})</Badge>
              <strong>{CATEGORY_LABELS[sandboxRes.category] || sandboxRes.category}</strong>
              <span>Konfidens: {Math.round(sandboxRes.confidence * 100)}%</span>
              <span>Regel: <code>{sandboxRes.policy_rule}</code></span>
              <span>{sandboxRes.latency_ms} ms</span>
            </div>
            <p>{sandboxRes.explanation}</p>
            <small>Rekommenderad åtgärd: <strong>{sandboxRes.recommended_action}</strong> · Mänsklig granskning: <strong>{sandboxRes.human_review ? 'Ja' : 'Nej'}</strong> · Kringgåendesignaler: <strong>{(sandboxRes.signals?.obfuscation || []).join(', ') || 'inga'}</strong></small>
          </div>}
        </Card>
      </Section>

      <Section title="Kuraterad test- och förbättringsmiljö" description="Svenska, engelska och svengelska: normala, felstavade, slang, stavelser, specialtecken, Unicode-homoglyfer, mellanrum, kontext och adversariella fall. Ingen automatisk träning på privata samtal."
        right={<><Button variant="outline" icon={<Download size={15} />} onClick={() => downloadJson({ cases, evaluations }, 'nexa-eval-export.json')}>Exportera</Button><Button icon={<Plus size={15} />} onClick={() => openModal('case', null, { language: 'sv', expected_decision: 'BLOCK', expected_category: 'bullying', harmful: true, obfuscation_type: 'plain' })}>Nytt fall</Button><Button icon={<Play size={15} />} loading={evalBusy} onClick={runEval}>Kör hela sviten ({cases.length})</Button></>}>
        <div className="safety-stats"><Card><Stat label="Testfall" value={cases.length} /></Card><Card><Stat label="Körda bedömningar" value={evaluations.length} /></Card><Card><Stat label="Träffsäkerhet" value={stats.accuracy === null ? '–' : `${stats.accuracy}%`} tone="#3FCF8E" /></Card><Card><Stat label="Falska positiva" value={stats.fp} tone="#F5A524" /></Card><Card><Stat label="Falska negativa" value={stats.fn} tone="#FF6B6B" /></Card><Card><Stat label="Svenska / Engelska" value={`${stats.svAccuracy ?? '–'}% / ${stats.enAccuracy ?? '–'}%`} /></Card></div>
        {evalRun && <Card className="eval-result"><h3>Senaste körning {evalRun.runId.slice(0, 8)}</h3><p>{evalRun.rows.filter((r) => r.passed).length} av {evalRun.rows.length} korrekta ({Math.round(evalRun.rows.filter((r) => r.passed).length / Math.max(1, evalRun.rows.length) * 100)}%) · {evalRun.rows.filter((r) => r.false_positive).length} falska positiva · {evalRun.rows.filter((r) => r.false_negative).length} falska negativa</p></Card>}
        <Card className="table-card">{cases.map((c) => <div key={c.id} className="table-row"><div><strong>{c.label}</strong><small>{c.language} · {c.obfuscation_type} · {c.harmful ? 'skadligt' : 'harmlöst'} · förväntat {c.expected_decision}</small><p className="code-line">{c.text}</p></div><Badge tone={c.harmful ? 'red' : 'green'}>{c.harmful ? 'Skadligt' : 'Harmlöst'}</Badge><Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={async () => { try { await api.deleteTestCase(c.id); setCases(await api.getTestCases()); } catch (e: any) { showToast(e.message, 'error'); } }} /><div className="row-actions"><Button size="sm" variant="outline" icon={<Play size={13} />} onClick={async () => { try { const r = await api.moderateText(c.text, 'test'); showToast(`${c.label}: ${r.decision} (${CATEGORY_LABELS[r.category] || r.category}, ${Math.round(r.confidence * 100)}%)`, 'info'); } catch (e: any) { showToast(e.message, 'error'); } }}>Testa</Button></div></div>)}</Card>
        <div className="ob-note"><FlaskConical size={15} /> Endast auktoriserad, kuraterad träningsdata. Moderatorers korrigeringar och undantag sparas i <code>nexa_moderator_overrides</code> och utvärderingar i <code>nexa_moderation_evaluations</code>.</div>
      </Section>
    </>}

    {tab === 'audit' && <Section title="Revisionslogg" description="Alla känsliga moderatoråtgärder (inklusive bevisgranskning och historikåtkomst) loggas med aktör, mål och tid.">
      {audit.length === 0 ? <EmptyState icon={<ScrollText size={24} />} title="Inga loggade åtgärder ännu" /> : <Card className="table-card">{audit.map((a) => <div key={a.id} className="table-row"><div><strong>{a.action}</strong><small>{a.target_type} · {a.target_id?.slice(0, 8) || '–'} · {timeAgo(a.created_at)}</small><p className="code-line">{JSON.stringify(a.metadata || {}).slice(0, 180)}</p></div></div>)}</Card>}
    </Section>}

    {/* ------------------------------------------------ modals */}
    <Modal open={modal === 'policy'} onClose={() => setModal(null)} title={modalData ? 'Redigera policy' : 'Ny policy'} wide>
      <div className="form-grid"><Input label="Nyckel" value={form.key || ''} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        <Select label="Kategori" value={form.category || 'bullying'} onChange={(e) => setForm({ ...form, category: e.target.value })}>{['bullying', 'threat', 'hate', 'sexual_harassment', 'sexual_minors', 'grooming', 'pii', 'external_platform', 'scam', 'spam', 'dangerous_challenge', 'evasion'].map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}</Select></div>
      <Input label="Allvarlighet (1–5)" type="number" min={1} max={5} value={form.severity || 3} onChange={(e) => setForm({ ...form, severity: e.target.value })} />
      <Textarea label="Mönster (fraser separerade med | eller regex:…)" rows={3} value={form.pattern || ''} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
      <Textarea label="Beskrivning" rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Toggle label="Aktiv" checked={form.enabled !== false} onChange={(v) => setForm({ ...form, enabled: v })} />
      <Button full icon={<Check size={15} />} loading={busy} onClick={savePolicy}>Spara policy</Button>
    </Modal>
    <Modal open={modal === 'case'} onClose={() => setModal(null)} title="Nytt testfall">
      <Input label="Etikett" value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      <Textarea label="Text" rows={3} value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} />
      <div className="form-grid"><Select label="Språk" value={form.language || 'sv'} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="sv">Svenska</option><option value="en">English</option><option value="svengelska">Svengelska</option></Select>
        <Select label="Typ" value={form.obfuscation_type || 'plain'} onChange={(e) => setForm({ ...form, obfuscation_type: e.target.value })}>{['plain', 'misspelling', 'slang', 'syllables', 'special_chars', 'unicode', 'spacing', 'leet', 'context', 'adversarial'].map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
      <div className="form-grid"><Select label="Förväntat beslut" value={form.expected_decision || 'BLOCK'} onChange={(e) => setForm({ ...form, expected_decision: e.target.value })}>{['ALLOW', 'WARN', 'HOLD_FOR_REVIEW', 'BLOCK', 'ESCALATE'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select label="Förväntad kategori" value={form.expected_category || 'bullying'} onChange={(e) => setForm({ ...form, expected_category: e.target.value })}>{['none', 'bullying', 'threat', 'hate', 'sexual_harassment', 'grooming', 'pii', 'external_platform', 'spam', 'dangerous_challenge'].map((x) => <option key={x}>{x}</option>)}</Select></div>
      <Toggle label="Skadligt innehåll" checked={form.harmful === true} onChange={(v) => setForm({ ...form, harmful: v })} />
      <Button full icon={<Plus size={15} />} loading={busy} onClick={saveCase}>Lägg till</Button>
    </Modal>
    <Modal open={modal === 'override'} onClose={() => setModal(null)} title="Korrigera AI-beslut">
      <p className="muted">{modalData?.explanation}</p>
      <Select label="Korrigerat beslut" value={form.corrected || 'ALLOW'} onChange={(e) => setForm({ ...form, corrected: e.target.value })}>{['ALLOW', 'WARN', 'HOLD_FOR_REVIEW', 'BLOCK', 'ESCALATE'].map((x) => <option key={x}>{x}</option>)}</Select>
      <Textarea label="Motivering" rows={3} value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <Button full icon={<Check size={15} />} loading={busy} onClick={() => moderatorAction('override')}>Spara korrigering</Button>
    </Modal>
    <Modal open={modal === 'warn' || modal === 'restrict'} onClose={() => setModal(null)} title={modal === 'warn' ? 'Varna användare' : 'Tillfällig begränsning'}>
      <p className="muted">@{modalData?.username || modalData?.id?.slice?.(0, 8)}</p>
      {modal === 'restrict' && <Input label="Antal timmar" type="number" min={1} value={form.hours || 24} onChange={(e) => setForm({ ...form, hours: e.target.value })} />}
      <Textarea label="Orsak" rows={3} value={form.reason || ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      <Button full loading={busy} onClick={() => moderatorAction(modal === 'warn' ? 'warn' : 'restrict')}>Spara åtgärd</Button>
    </Modal>
    <Modal open={modal === 'appeal'} onClose={() => setModal(null)} title="Beslut om överklagande">
      <Select label="Beslut" value={form.status || 'approved'} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="approved">Godkänn</option><option value="rejected">Avslå</option></Select>
      <Textarea label="Motivering" rows={3} value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <Button full loading={busy} onClick={() => moderatorAction('appeal')}>Spara</Button>
    </Modal>
    <Modal open={modal === 'report'} onClose={() => setModal(null)} title="Hantera rapport">
      <Select label="Status" value={form.status || 'resolved'} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="in_review">Under granskning</option><option value="resolved">Åtgärdad</option><option value="dismissed">Avfärdad</option></Select>
      <Button full loading={busy} onClick={() => moderatorAction('report')}>Spara</Button>
    </Modal>
    <Modal open={modal === 'media'} onClose={() => setModal(null)} title="Granska media">
      <p className="muted">Fil: {modalData?.bucket_path}. Bevis nås endast via privat lagring med kortlivad signed URL och loggas.</p>
      <Select label="Beslut" value={form.approve === false ? 'reject' : 'approve'} onChange={(e) => setForm({ ...form, approve: e.target.value === 'approve' })}><option value="approve">Godkänn</option><option value="reject">Avvisa</option></Select>
      <Button full loading={busy} onClick={() => moderatorAction('media')}>Spara beslut</Button>
    </Modal>
    <Modal open={modal === 'incident'} onClose={() => setModal(null)} title="Hantera incident">
      <Toggle label="Markera som löst" checked={form.resolve === true} onChange={(v) => setForm({ ...form, resolve: v })} />
      <Button full loading={busy} onClick={() => moderatorAction('incident')}>Spara</Button>
    </Modal>
    <Modal open={modal === 'evidence'} onClose={() => setModal(null)} title="Bevis (begränsad & loggad åtkomst)" wide>
      <div className="evidence-box"><pre>{JSON.stringify(modalData || {}, null, 2)}</pre></div>
      {modalData?.report && ['message', 'post', 'comment'].includes(modalData.report.target_type) && (
        <Button variant="danger" icon={<Trash2 size={14} />} loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.setContentStatus(modalData.report.target_type, modalData.report.target_id, 'removed');
            await api.resolveReport(modalData.report.id, 'resolved');
            showToast('Rapporterat innehåll togs bort och rapporten markerades som åtgärdad.');
            setModal(null); await load();
          } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
        }}>Ta bort rapporterat innehåll</Button>
      )}
      <p className="muted">Åtkomsten till detta fönster har registrerats som <code>EVIDENCE_REVIEW</code> i revisionsloggen.</p>
    </Modal>
    <Modal open={modal === 'history'} onClose={() => setModal(null)} title="Användarhistorik" wide>
      {history && <div className="history-grid"><div><h4>Modereringsbeslut ({history.decisions?.length || 0})</h4>{history.decisions?.slice(0, 8).map((d: any) => <div key={d.id} className="history-row"><Badge tone={d.decision === 'ALLOW' ? 'green' : 'red'}>{d.decision}</Badge><span>{CATEGORY_LABELS[d.category] || d.category}</span><small>{timeAgo(d.created_at)}</small></div>)}</div>
        <div><h4>Begränsningar ({history.restrictions?.length || 0})</h4>{history.restrictions?.map((r: any) => <div key={r.id} className="history-row"><span>{r.kind}</span><small>{r.reason}</small></div>)}</div>
        <div><h4>Senaste meddelanden (bevis)</h4>{history.messages?.slice(0, 6).map((m: any) => <div key={m.id} className="history-row"><span>{m.body || '[media]'}</span><small>{timeAgo(m.created_at)}</small></div>)}</div>
        <div><h4>Rapporter</h4>{history.reports?.slice(0, 6).map((r: any) => <div key={r.id} className="history-row"><span>{r.reason}</span><small>{r.status}</small></div>)}</div></div>}
    </Modal>
  </>;
}
