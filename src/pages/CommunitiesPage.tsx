import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Users, MessageCircle, Heart, Flag, Ban, ShieldCheck, Hash, BookOpen, ChevronLeft, Send, MoreHorizontal, Check, Sparkles } from 'lucide-react';
import { Button, Card, Avatar, Badge, Chip, PageHeader, Spinner, EmptyState, ErrorState, Modal, Input, Textarea, Select, IconButton } from '../components/ui';
import { useApp } from '../state/AppContext';
import * as api from '../lib/api';
import type { Community, Post, Comment, Profile } from '../lib/types';
import { timeAgo } from '../lib/utils';

const TOPICS = ['Gaming', 'Musik', 'Fotboll', 'Natur', 'Teknologi', 'Konst', 'Filmer', 'Skola', 'Böcker', 'Klimat'];

export function CommunitiesPage() {
  const { profile, showToast } = useApp();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selected, setSelected] = useState<Community | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [reactions, setReactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [topic, setTopic] = useState('Alla');
  const [followed, setFollowed] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', topic: 'Gaming', rules: '', accent: '#873BFA' });
  const [postBody, setPostBody] = useState('');
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: string; id: string } | null>(null);
  const [reportReason, setReportReason] = useState('Olämpligt innehåll');
  const [reportDetails, setReportDetails] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const loadCommunities = async () => {
    setLoading(true); setError('');
    try { const [c, f] = await Promise.all([api.getCommunities(profile?.age_group), api.myTopics()]); setCommunities(c); setFollowed(f); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { loadCommunities(); }, [profile?.id, profile?.age_group]);

  const loadPosts = async (communityId?: string) => {
    if (!communityId) { setPosts([]); return; }
    try {
      const p = await api.getPosts(communityId); setPosts(p);
      const ids = [...new Set(p.map((x) => x.author_id).concat())];
      const ps = await api.getProfilesByIds(ids);
      const map: Record<string, Profile> = {}; ps.forEach((x) => { map[x.id] = x; });
      const [cm, re] = await Promise.all([api.getComments(p.map((x) => x.id)), api.getReactions(p.map((x) => x.id))]);
      const grouped: Record<string, Comment[]> = {};
      for (const c of cm) { (grouped[c.post_id] ||= []).push(c); }
      for (const c of cm) if (!map[c.author_id]) { ids.push(c.author_id); }
      const extra = await api.getProfilesByIds([...new Set(ids)]);
      extra.forEach((x) => { map[x.id] = x; });
      setProfiles(map); setComments(grouped); setReactions(re);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { loadPosts(selected?.id); }, [selected?.id]);

  const filtered = useMemo(() => communities.filter((c) => topic === 'Alla' || c.topic === topic || (topic === 'Följda' && followed.includes(c.topic))), [communities, topic, followed]);
  const nameOf = (id: string) => profiles[id]?.username || 'Användare';

  const join = async (c: Community) => {
    try { await (c.joined ? api.leaveCommunity(c.id) : api.joinCommunity(c.id)); await loadCommunities(); showToast(c.joined ? 'Du lämnade communityn.' : 'Du gick med!'); if (selected?.id === c.id) setSelected({ ...c, joined: !c.joined, member_count: (c.member_count || 0) + (c.joined ? -1 : 1) }); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const follow = async (t: string) => {
    const on = !followed.includes(t);
    try { await api.followTopic(t, on); setFollowed((v) => on ? [...v, t] : v.filter((x) => x !== t)); showToast(on ? `Följer ämnet ${t}.` : `Slutade följa ${t}.`, 'info'); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const create = async () => {
    if (form.name.trim().length < 3 || form.description.trim().length < 10 || form.rules.trim().length < 10) { showToast('Namn (minst 3), beskrivning och regler (minst 10 tecken) krävs.', 'error'); return; }
    setBusy(true);
    try { const c = await api.createCommunity(form); await loadCommunities(); setSelected(c); setCreateOpen(false); setForm({ name: '', description: '', topic: 'Gaming', rules: '', accent: '#873BFA' }); showToast('Communityn skapades!'); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const submitPost = async () => {
    if (!selected || !postBody.trim()) return;
    setBusy(true); setNotice(null);
    try { const r = await api.createPost(selected.id, postBody.trim()); setPostBody(''); await loadPosts(selected.id); if (r.decision !== 'ALLOW') showToast(r.explanation, 'info'); }
    catch (e: any) { setNotice(e.message); showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const submitComment = async (postId: string) => {
    const body = (commentDraft[postId] || '').trim(); if (!body) return;
    try { await api.createComment(postId, body); setCommentDraft((d) => ({ ...d, [postId]: '' })); await loadPosts(selected?.id); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const react = async (postId: string) => {
    try { await api.toggleReaction(postId, '💜'); setReactions(await api.getReactions(posts.map((p) => p.id))); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const report = async () => {
    if (!reportTarget) return;
    try { await api.reportContent(reportTarget.type, reportTarget.id, reportReason, reportDetails); showToast('Rapporten skickades.'); setReportTarget(null); setReportDetails(''); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const blockAuthor = async (id: string) => {
    try { await api.blockUser(id); showToast('Användaren blockerad.', 'info'); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading) return <><PageHeader title="Communities" subtitle="Hitta dina grupper." /><Spinner /></>;
  if (error) return <><PageHeader title="Communities" /><ErrorState message={error} onRetry={loadCommunities} /></>;

  return <>
    <PageHeader title="Communities" subtitle={`Grupper för din åldersgrupp (${profile?.age_group || '–'})`}
      right={<Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>Skapa community</Button>} />
    <div className="community-topics">
      <div className="chip-row scroll-x"><Chip active={topic === 'Alla'} onClick={() => setTopic('Alla')}>Alla</Chip>{TOPICS.map((t) => <Chip key={t} active={topic === t} onClick={() => setTopic(t)}><Hash size={13} /> {t}</Chip>)}<Chip active={topic === 'Följda'} onClick={() => setTopic('Följda')}>Följda ämnen</Chip></div>
    </div>
    <div className="follow-row"><span>Följ ämnen:</span>{TOPICS.slice(0, 6).map((t) => <button key={t} className={`follow-pill ${followed.includes(t) ? 'on' : ''}`} onClick={() => follow(t)}>{followed.includes(t) ? <Check size={12} /> : <Plus size={12} />}{t}</button>)}</div>

    <div className="community-layout">
      <div className="community-grid">
        {filtered.length === 0 ? <EmptyState icon={<Users size={26} />} title="Inga communities här" description="Prova ett annat ämne eller skapa en egen." /> : filtered.map((c) => <Card key={c.id} className={`community-card ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)}>
          <div className="community-icon" style={{ background: `linear-gradient(135deg, ${c.accent}, #B45CFF)` }}><Hash size={20} /></div>
          <h3>{c.name}</h3><p>{c.description}</p>
          <div className="community-meta"><Badge tone="violet">{c.topic}</Badge><span><Users size={13} /> {c.member_count || 0}</span><Badge tone="blue">{c.age_group}</Badge></div>
          <Button size="sm" variant={c.joined ? 'soft' : 'outline'} onClick={(e) => { e.stopPropagation(); join(c); }}>{c.joined ? 'Lämna' : 'Gå med'}</Button>
        </Card>)}
      </div>

      <Card className="community-feed">
        {!selected ? <EmptyState icon={<Sparkles size={26} />} title="Välj en community" description="Klicka på en grupp för att se inlägg och diskussioner." /> : <>
          <div className="feed-head"><button className="back-btn" onClick={() => setSelected(null)}><ChevronLeft size={16} /></button><div><h3>{selected.name}</h3><p>{selected.member_count} medlemmar · {selected.topic}</p></div><Button size="sm" variant={selected.joined ? 'soft' : 'outline'} onClick={() => join(selected)}>{selected.joined ? 'Lämna' : 'Gå med'}</Button></div>
          <div className="rules-mini"><BookOpen size={15} /><span><strong>Regler:</strong> {selected.rules}</span></div>
          {selected.joined && <div className="post-composer"><Avatar name={profile?.username || '?'} id={profile?.id} size={34} /><Textarea rows={2} value={postBody} onChange={(e) => setPostBody(e.target.value)} placeholder="Dela något med gruppen…" /><Button size="sm" icon={<Send size={14} />} onClick={submitPost} loading={busy}>Publicera</Button></div>}
          {notice && <div className="form-error">{notice}</div>}
          {posts.length === 0 ? <EmptyState icon={<MessageCircle size={24} />} title="Inga inlägg ännu" description="Bli den första att skriva något!" /> : posts.map((p) => {
            const likes = reactions.filter((r) => r.post_id === p.id).length;
            return <article key={p.id} className="post-card">
              <div className="post-head"><Avatar name={nameOf(p.author_id)} id={p.author_id} size={34} /><div><strong>@{nameOf(p.author_id)}</strong><small>{timeAgo(p.created_at)}</small></div><div className="post-actions"><IconButton label="Rapportera" onClick={() => setReportTarget({ type: 'post', id: p.id })}><Flag size={14} /></IconButton><IconButton label="Blockera användare" onClick={() => blockAuthor(p.author_id)}><Ban size={14} /></IconButton></div></div>
              <p className="post-body">{p.body}</p>
              {p.status !== 'visible' && <Badge tone="amber">{p.status === 'held' ? 'Väntar på granskning' : p.status}</Badge>}
              <div className="post-reactions"><button className={likes ? 'liked' : ''} onClick={() => react(p.id)}><Heart size={15} /> {likes} 💜</button><span><MessageCircle size={15} /> {comments[p.id]?.length || 0} kommentarer</span></div>
              <div className="comments">{(comments[p.id] || []).map((c) => <div key={c.id} className="comment"><Avatar name={nameOf(c.author_id)} id={c.author_id} size={24} /><div><strong>@{nameOf(c.author_id)}</strong> {c.body}<small>{timeAgo(c.created_at)}</small></div></div>)}
                {selected.joined && <div className="comment-composer"><input value={commentDraft[p.id] || ''} onChange={(e) => setCommentDraft((d) => ({ ...d, [p.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') submitComment(p.id); }} placeholder="Skriv en kommentar…" /><IconButton label="Skicka" onClick={() => submitComment(p.id)}><Send size={14} /></IconButton></div>}
              </div>
            </article>;
          })}
        </>}
      </Card>
    </div>

    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Skapa community">
      <Input label="Namn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="t.ex. Pixelkonst" />
      <Textarea label="Beskrivning" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Select label="Ämne" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</Select>
      <Textarea label="Tydliga regler" rows={3} value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="Var schysst, dela inga privata uppgifter …" />
      <Button full loading={busy} icon={<Plus size={15} />} onClick={create}>Skapa community</Button>
      <p className="muted">Communityn skapas automatiskt i din åldersgrupp. Alla inlägg modereras.</p>
    </Modal>
    <Modal open={!!reportTarget} onClose={() => setReportTarget(null)} title="Rapportera innehåll">
      <Select label="Anledning" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>{['Olämpligt innehåll', 'Mobbning eller hot', 'Sexuellt innehåll', 'Privata uppgifter', 'Spam', 'Annat'].map((r) => <option key={r}>{r}</option>)}</Select>
      <Textarea label="Beskrivning" rows={3} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} />
      <Button full icon={<Flag size={15} />} onClick={report}>Skicka rapport</Button>
    </Modal>
  </>;
}
