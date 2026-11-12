import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Image as ImageIcon, Mic, Square, Phone, ShieldCheck, Flag, Ban, Plus, Users, RefreshCw, Loader2, Video, AlertTriangle, X } from 'lucide-react';
import { Button, Card, Avatar, Badge, Modal, Spinner, EmptyState, ErrorState, IconButton, Select, Textarea } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Conversation, Message, Profile, Connection } from '../lib/types';
import { timeAgo, clock } from '../lib/utils';

export function ChatPage({ navigate, navData }: { navigate: (r: string, data?: any) => void; navData: any }) {
  const { profile, config, showToast } = useApp();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(navData?.conversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [reportMsg, setReportMsg] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('Olämpligt meddelande');
  const [reportDetails, setReportDetails] = useState('');
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [videoInfo, setVideoInfo] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [c, conns] = await Promise.all([api.getConversations(), api.getConnections()]);
      setConvs(c); setConnections(conns);
      const ids = [...new Set(c.flatMap((x) => x.members || []))];
      const ps = await api.getProfilesByIds(ids);
      const map: Record<string, Profile> = {}; ps.forEach((p) => { map[p.id] = p; }); setProfiles(map);
      if (!activeId && c.length) setActiveId(c[0].id);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [profile?.id]);
  useEffect(() => { if (navData?.conversationId) setActiveId(navData.conversationId); }, [navData?.conversationId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let alive = true;
    setMessages([]);
    api.getMessages(activeId).then((m) => { if (alive) setMessages(m); }).catch((e) => setError(e.message));
    const off = api.subscribeMessages(activeId, (m) => setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    return () => { alive = false; off(); };
  }, [activeId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  useEffect(() => {
    const mediaIds = [...new Set(messages.filter((m) => m.media_id).map((m) => m.media_id!))];
    if (!mediaIds.length) return;
    api.getMediaByIds(mediaIds).then(async (rows) => {
      const out: Record<string, string> = {};
      for (const r of rows) { const u = await api.mediaUrl(r.bucket_path); if (u) out[r.id] = u; }
      setMediaUrls(out);
    }).catch(() => {});
  }, [messages]);

  const nameOf = (id: string) => profiles[id]?.username || (id === profile?.id ? 'Du' : 'Användare');
  const convName = (c: Conversation) => c.kind === 'group' ? (c.title || 'Gruppchatt') : nameOf((c.members || []).find((m) => m !== profile?.id) || '');
  const friends = useMemo(() => connections.filter((c) => c.status === 'accepted').map((c) => c.requester_id === profile?.id ? c.addressee_id : c.requester_id), [connections, profile?.id]);

  const send = async () => {
    const body = text.trim(); if (!body || !activeId || sending) return;
    setSending(true); setNotice(null);
    try {
      const context = messages.slice(-4).filter((m) => m.kind === 'text').map((m) => m.body);
      const r = await api.sendTextMessage(activeId, body, context);
      setText('');
      if (r.decision !== 'ALLOW') showToast(r.explanation, 'info');
    } catch (e: any) { setNotice(e.message); showToast(e.message, 'error'); }
    finally { setSending(false); }
  };
  const onFile = async (f: File) => {
    if (!activeId) return;
    setSending(true); setNotice(null);
    try {
      const row = await api.uploadMedia(f, 'image');
      const fresh = await api.getMediaByIds([row.id]);
      if (fresh[0]?.status === 'approved') { await api.sendMediaMessage(activeId, row.id, 'image'); showToast('Bilden skickades.'); }
      else setNotice('Bilden är uppladdad men väntar på säkerhetsgranskning. Den blir synlig för andra först när en moderator godkänt den (OCR-/bildleverantör ej konfigurerad).');
    } catch (e: any) { setNotice(e.message); showToast(e.message, 'error'); } finally { setSending(false); }
  };
  const startRecording = async () => {
    if (!activeId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const file = new File([blob], 'rost.webm', { type: blob.type });
        try {
          const row = await api.uploadMedia(file, 'voice');
          const fresh = await api.getMediaByIds([row.id]);
          if (fresh[0]?.status === 'approved') { await api.sendMediaMessage(activeId, row.id, 'voice'); showToast('Röstmeddelandet skickades.'); }
          else setNotice('Röstmeddelandet väntar på transkribering/granskning. Ingen transkriberingsleverantör är konfigurerad, så en moderator måste godkänna det.');
        } catch (e: any) { setNotice(e.message); }
      };
      rec.start(); recorderRef.current = rec; setRecording(true);
    } catch { showToast('Mikrofonen kunde inte nås.', 'error'); }
  };
  const stopRecording = () => { recorderRef.current?.stop(); setRecording(false); };
  const startDirect = async (otherId: string) => {
    try { const cid = await api.startDirectConversation(otherId); await load(); setActiveId(cid); setNewChat(false); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const createGroup = async () => {
    if (groupTitle.trim().length < 2 || groupMembers.length < 1) { showToast('Ange ett namn och välj minst en vän.', 'error'); return; }
    try { const cid = await api.createGroupConversation(groupTitle, groupMembers); await load(); setActiveId(cid); setNewChat(false); setGroupTitle(''); setGroupMembers([]); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const blockOther = async () => {
    const c = convs.find((x) => x.id === activeId);
    const other = c?.members?.find((m) => m !== profile?.id);
    if (!other) return;
    try { await api.blockUser(other); showToast('Användaren är blockerad.', 'info'); await load(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const report = async () => {
    if (!reportMsg) return;
    try { await api.reportContent('message', reportMsg.id, reportReason, reportDetails); showToast('Meddelandet rapporterades.'); setReportMsg(null); setReportDetails(''); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return <div className="chat-layout">
    <Card className="chat-list">
      <div className="chat-list-head"><h3>Konversationer</h3><div><IconButton label="Uppdatera" onClick={load}><RefreshCw size={15} /></IconButton><IconButton label="Ny chatt" onClick={() => setNewChat(true)}><Plus size={17} /></IconButton></div></div>
      {convs.length === 0 ? <div className="chat-empty">Inga chattar ännu. Skicka en vänförfrågan i Upptäck!</div> : convs.map((c) => {
        const other = (c.members || []).find((m) => m !== profile?.id);
        return <button key={c.id} className={`conv-item ${activeId === c.id ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
          <Avatar name={convName(c)} url={c.kind === 'direct' ? profiles[other || '']?.avatar_url : null} id={other || c.id} size={42} />
          <span className="conv-text"><strong>{convName(c)}</strong><small>{c.kind === 'group' ? `${c.members?.length || 0} deltagare` : `Åldersgrupp ${profiles[other || '']?.age_group || ''}`}</small></span>
          <span className="conv-time">{timeAgo(c.created_at)}</span>
        </button>;
      })}
    </Card>

    <Card className="chat-thread">
      {!activeId ? <EmptyState icon={<Users size={26} />} title="Välj en konversation" description="Eller starta en ny chatt med en vän." action={<Button icon={<Plus size={15} />} onClick={() => setNewChat(true)}>Ny chatt</Button>} /> : <>
        <div className="thread-head">
          <Avatar name={convName(convs.find((c) => c.id === activeId)!)} id={activeId} size={38} />
          <div><strong>{convName(convs.find((c) => c.id === activeId)!)}</strong><small><ShieldCheck size={12} /> Skyddad av NEXA säkerhetsmotor</small></div>
          <div className="thread-actions">
            <IconButton label="Videosamtal" onClick={() => setVideoInfo(true)}><Video size={17} /></IconButton>
            <IconButton label="Blockera" onClick={blockOther}><Ban size={17} /></IconButton>
          </div>
        </div>
        <div className="thread-messages">
          {messages.length === 0 && <div className="thread-empty">Inga meddelanden ännu. Säg hej! 👋</div>}
          {messages.map((m) => {
            const mine = m.sender_id === profile?.id;
            return <div key={m.id} className={`msg-row ${mine ? 'mine' : ''} ${m.status !== 'visible' ? 'held' : ''}`}>
              {!mine && <Avatar name={nameOf(m.sender_id)} id={m.sender_id} size={30} />}
              <div className="msg-bubble">
                {m.kind === 'text' && <span>{m.body}</span>}
                {m.kind === 'image' && (mediaUrls[m.media_id!] ? <img className="msg-image" src={mediaUrls[m.media_id!]} alt="Delad bild" /> : <span className="muted">Bild väntar på granskning</span>)}
                {m.kind === 'voice' && (mediaUrls[m.media_id!] ? <audio controls src={mediaUrls[m.media_id!]} /> : <span className="muted">Röstmeddelande väntar på granskning</span>)}
                <div className="msg-meta"><span>{clock(m.created_at)}</span>{m.status === 'held' && <Badge tone="amber">Granskas</Badge>}{m.status === 'removed' && <Badge tone="red">Borttagen</Badge>}
                  {!mine && <button className="msg-report" onClick={() => setReportMsg(m)} title="Rapportera"><Flag size={12} /></button>}
                </div>
              </div>
            </div>;
          })}
          <div ref={bottomRef} />
        </div>
        {notice && <div className="thread-notice"><AlertTriangle size={15} /><span>{notice}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}
        <div className="composer">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
          <IconButton label="Skicka bild" onClick={() => fileRef.current?.click()}><ImageIcon size={18} /></IconButton>
          <IconButton label={recording ? 'Stoppa inspelning' : 'Spela in röstmeddelande'} onClick={recording ? stopRecording : startRecording} className={recording ? 'recording' : ''}>{recording ? <Square size={16} /> : <Mic size={18} />}</IconButton>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Skriv ett meddelande…" maxLength={1000} />
          <Button size="sm" onClick={send} loading={sending} icon={<Send size={15} />}>Skicka</Button>
        </div>
        <div className="thread-foot"><ShieldCheck size={13} /> Meddelanden analyseras automatiskt. Inga privata samtal spelas in. Videosamtal är avstängda tills säkerhetsarkitekturen är granskad.</div>
      </>}
    </Card>

    <Modal open={newChat} onClose={() => setNewChat(false)} title="Ny konversation">
      <div className="chip-row"><button className={`chip ${!groupMode ? 'active' : ''}`} onClick={() => setGroupMode(false)}>Direktchatt</button><button className={`chip ${groupMode ? 'active' : ''}`} onClick={() => setGroupMode(true)}>Gruppchatt</button></div>
      {groupMode && <><label className="field"><span className="field-label">Gruppnamn</span><input className="input" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="t.ex. Fredagsgänget" /></label>
        <p className="muted">Välj vänner (alla måste vara i din åldersgrupp):</p>
        <div className="friend-list">{friends.map((id) => <label key={id} className="check-row"><input type="checkbox" checked={groupMembers.includes(id)} onChange={(e) => setGroupMembers((v) => e.target.checked ? [...v, id] : v.filter((x) => x !== id))} /><Avatar name={nameOf(id)} id={id} size={30} /><span>@{nameOf(id)}</span></label>)}</div>
        {friends.length === 0 && <p className="muted">Du har inga accepterade vänner ännu.</p>}
        <Button full icon={<Users size={15} />} onClick={createGroup}>Skapa gruppchatt</Button></>}
      {!groupMode && <><p className="muted">Du kan bara chatta med accepterade vänner i din åldersgrupp.</p>
        {friends.length === 0 ? <EmptyState title="Inga vänner ännu" description="Skicka en förfrågan i Upptäck först." action={<Button variant="outline" onClick={() => { setNewChat(false); navigate('upptack'); }}>Till Upptäck</Button>} /> :
          <div className="friend-list">{friends.map((id) => <button key={id} className="friend-row" onClick={() => startDirect(id)}><Avatar name={nameOf(id)} id={id} size={38} /><span><strong>@{nameOf(id)}</strong><small>{profiles[id]?.age_group}</small></span><Send size={15} /></button>)}</div>}
      </>}
    </Modal>

    <Modal open={!!reportMsg} onClose={() => setReportMsg(null)} title="Rapportera meddelande">
      <Select label="Anledning" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>{['Olämpligt meddelande', 'Mobbning eller hot', 'Sexuellt innehåll', 'Privata uppgifter', 'Spam', 'Annat'].map((r) => <option key={r}>{r}</option>)}</Select>
      <Textarea label="Beskrivning" rows={3} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} />
      <Button full icon={<Flag size={15} />} onClick={report}>Skicka rapport</Button>
    </Modal>

    <Modal open={videoInfo} onClose={() => setVideoInfo(false)} title="Videosamtal">
      <div className="video-info"><Video size={34} /><h3>Avstängt av säkerhetsskäl</h3><p>Videosamtal är inaktiverade tills säkerhetsarkitekturen har testats och granskats juridiskt. Inga slumpmässiga eller oönskade samtal tillåts, och privata samtal spelas aldrig in.</p>
        <div className="ob-note"><Badge tone="amber">BEROENDE</Badge> Kräver en hanterad WebRTC-leverantör, ömsesidigt godkännande och aktiverad flagg <code>video_calls_enabled</code>. Status: <strong>{config.video_calls_enabled === true ? 'aktiverad' : 'avstängd'}</strong>.</div>
        <Button variant="outline" full onClick={async () => { try { await api.requestVideoCall(activeId!, convs.find((c) => c.id === activeId)?.members?.find((m) => m !== profile?.id) || profile!.id); showToast('Förfrågan om ömsesidigt godkännande sparad (samtalet förblir avstängt).', 'info'); setVideoInfo(false); } catch (e: any) { showToast(e.message, 'error'); } }}>Begär ömsesidigt godkännande (sparas)</Button>
      </div>
    </Modal>
  </div>;
}
