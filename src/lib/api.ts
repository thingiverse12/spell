import { supabase } from './supabase';
import { sha256Hex, uid } from './utils';
import type { Profile, Interest, Community, Connection, Conversation, Message, Post, Comment, Notification, ModerationResult, Policy, TestCase, ConfigRow, Decision } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function q<T = any>(promise: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || 'Databasfel');
  return data as T;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke<T = any>(name: string, body: any): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || 'Tjänsten svarade inte.';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        msg = j.error || j.message || msg;
      }
    } catch { /* keep original */ }
    throw new Error(msg);
  }
  return data as T;
}
export async function me(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Inte inloggad.');
  return user.id;
}

// ---------------------------------------------------------------- auth
export const auth = {
  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },
  signOut: async () => { await supabase.auth.signOut(); },
  session: () => supabase.auth.getSession(),
  onState: (cb: (s: any) => void) => supabase.auth.onAuthStateChange((_e, s) => cb(s)),
  resetPassword: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------- profile / config
export async function getProfile(id: string): Promise<Profile | null> {
  const rows = await q<Profile[]>(supabase.from('nexa_profiles').select('*').eq('id', id).maybeSingle());
  return Array.isArray(rows) ? rows[0] ?? null : (rows as unknown as Profile) ?? null;
}
export async function myProfile(): Promise<Profile | null> {
  const id = await me();
  return getProfile(id);
}
export async function saveProfile(patch: Partial<Profile>): Promise<void> {
  const id = await me();
  if (typeof patch.username === 'string' && patch.username.trim()) {
    const r = await moderateText(patch.username.trim(), 'profile');
    if (r.decision === 'BLOCK' || r.decision === 'ESCALATE') {
      throw new Error(r.explanation || 'Användarnamnet tillåts inte av säkerhetsmotorn.');
    }
  }
  if (typeof patch.bio === 'string' && patch.bio.trim()) {
    const r = await moderateText(patch.bio.trim(), 'bio');
    if (r.decision === 'BLOCK' || r.decision === 'ESCALATE') {
      throw new Error(r.explanation || 'Profiltexten blockerades av säkerhetsmotorn.');
    }
  }
  const allowed = ['username', 'bio', 'avatar_url', 'interests', 'discoverable', 'show_online',
    'allow_requests', 'friend_pref', 'locale', 'onboarding_complete', 'last_seen_at'] as const;
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (k in patch) clean[k] = (patch as any)[k];
  await q(supabase.from('nexa_profiles').update(clean).eq('id', id));
}
export async function getInterests(): Promise<Interest[]> {
  return q<Interest[]>(supabase.from('nexa_interests').select('*').order('label_sv'));
}
export async function getConfig(): Promise<Record<string, any>> {
  const rows = await q<ConfigRow[]>(supabase.from('nexa_config').select('*'));
  const out: Record<string, any> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setConfig(key: string, value: unknown): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_config').upsert({ key, value, updated_by: id, updated_at: new Date().toISOString() }));
}
export async function verifyAge(birthDate: string): Promise<any> {
  return invoke('nexa-verify-age', { birth_date: birthDate });
}
export async function myAgeStatus(): Promise<any> {
  const id = await me();
  const rows = await q<any[]>(supabase.from('nexa_age_verifications').select('method,status,age_group,verified_at,identity_document_stored,biometric_data_stored').eq('user_id', id));
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

// ---------------------------------------------------------------- moderation
export async function moderateText(text: string, contentType: string, context: string[] = []): Promise<ModerationResult> {
  return invoke<ModerationResult>('nexa-moderate', { text, content_type: contentType, context });
}
export async function moderateMedia(mediaId: string): Promise<any> {
  return invoke('nexa-moderate-media', { media_id: mediaId });
}
export async function myDecisions(): Promise<any[]> {
  const id = await me();
  return q<any[]>(supabase.from('nexa_moderation_decisions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50));
}

// ---------------------------------------------------------------- discovery
export async function getDiscoverProfiles(ageGroup?: string | null): Promise<Profile[]> {
  const id = await me();
  let query = supabase.from('nexa_profiles').select('*').eq('discoverable', true).neq('id', id);
  if (ageGroup) query = query.eq('age_group', ageGroup);
  const rows = await q<Profile[]>(query.order('last_seen_at', { ascending: false }).limit(80));
  return rows ?? [];
}
export async function getMutualCommunityMap(): Promise<Record<string, string[]>> {
  const id = await me();
  const rows = await q<any[]>(supabase.from('nexa_community_members').select('community_id,user_id')) ?? [];
  const mine = new Set(rows.filter((r) => r.user_id === id).map((r) => r.community_id));
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.user_id !== id && mine.has(r.community_id)) {
      (out[r.user_id] ||= []).push(r.community_id);
    }
  }
  return out;
}
export async function getProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (!ids.length) return [];
  return q<Profile[]>(supabase.from('nexa_profiles').select('*').in('id', ids)) ?? [];
}
export async function getConnections(): Promise<Connection[]> {
  const id = await me();
  return q<Connection[]>(supabase.from('nexa_connections').select('*').or(`requester_id.eq.${id},addressee_id.eq.${id}`).order('created_at', { ascending: false })) ?? [];
}
export async function sendConnection(otherId: string, kind: 'friend' | 'romance' = 'friend'): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_connections').insert({ requester_id: id, addressee_id: otherId, kind }));
}
export async function respondConnection(connectionId: string, status: 'accepted' | 'declined'): Promise<void> {
  await q(supabase.from('nexa_connections').update({ status }).eq('id', connectionId));
}
export async function getCommunityMemberCounts(): Promise<Record<string, number>> {
  const rows = await q<any[]>(supabase.from('nexa_community_members').select('community_id'));
  const out: Record<string, number> = {};
  for (const r of rows ?? []) out[r.community_id] = (out[r.community_id] || 0) + 1;
  return out;
}
export async function getMutualCommunities(otherId: string): Promise<string[]> {
  const id = await me();
  const mine = await q<any[]>(supabase.from('nexa_community_members').select('community_id').eq('user_id', id));
  const theirs = await q<any[]>(supabase.from('nexa_community_members').select('community_id').eq('user_id', otherId));
  const set = new Set((theirs ?? []).map((x) => x.community_id));
  return (mine ?? []).map((x) => x.community_id).filter((c) => set.has(c));
}

// ---------------------------------------------------------------- chat
export async function getConversations(): Promise<Conversation[]> {
  const convs = await q<Conversation[]>(supabase.from('nexa_conversations').select('*').order('created_at', { ascending: false })) ?? [];
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const members = await q<any[]>(supabase.from('nexa_conversation_members').select('conversation_id,user_id').in('conversation_id', ids)) ?? [];
  return convs.map((c) => ({ ...c, members: members.filter((m) => m.conversation_id === c.id).map((m) => m.user_id) }));
}
export async function startDirectConversation(otherId: string): Promise<string> {
  return q<string>(supabase.rpc('nexa_start_direct_conversation', { p_other: otherId }));
}
export async function createGroupConversation(title: string, members: string[]): Promise<string> {
  return q<string>(supabase.rpc('nexa_create_group_conversation', { p_title: title, p_members: members }));
}
export async function getMessages(conversationId: string): Promise<Message[]> {
  return q<Message[]>(supabase.from('nexa_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(250)) ?? [];
}
export async function sendTextMessage(conversationId: string, body: string, context: string[] = []): Promise<{ decision: Decision; explanation: string }> {
  const id = await me();
  const decision = await moderateText(body, 'message', context);
  if (decision.decision === 'BLOCK' || decision.decision === 'ESCALATE') {
    throw new Error(decision.explanation || 'Meddelandet blockerades av säkerhetsmotorn.');
  }
  const hash = await sha256Hex(body);
  await q(supabase.from('nexa_messages').insert({
    conversation_id: conversationId, sender_id: id, kind: 'text', body,
    content_hash: hash, moderation_decision_id: decision.id,
  }));
  return { decision: decision.decision, explanation: decision.explanation };
}
export function subscribeMessages(conversationId: string, cb: (m: Message) => void) {
  const ch = supabase.channel(`nexa-msg-${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nexa_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => cb(payload.new as Message))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}
export async function uploadMedia(file: File, kind: 'image' | 'voice'): Promise<any> {
  const id = await me();
  const ext = (file.name.split('.').pop() || (kind === 'image' ? 'png' : 'webm')).replace(/[^a-z0-9]/gi, '');
  const path = `${id}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from('nexa-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  const row = await q<any>(supabase.from('nexa_media').insert({ owner_id: id, bucket_path: path, mime: file.type, kind }).select().single());
  await moderateMedia(row.id);
  return row;
}
export async function sendMediaMessage(conversationId: string, mediaId: string, kind: 'image' | 'voice'): Promise<void> {
  const id = await me();
  const hash = await sha256Hex(mediaId);
  await q(supabase.from('nexa_messages').insert({
    conversation_id: conversationId, sender_id: id, kind, body: '', media_id: mediaId,
    content_hash: hash,
  }));
}
export async function mediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('nexa-media').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
export async function getMediaByIds(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  return q<any[]>(supabase.from('nexa_media').select('*').in('id', ids)) ?? [];
}
export async function requestVideoCall(conversationId: string, approverId: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_video_call_requests').insert({ conversation_id: conversationId, requester_id: id, approver_id: approverId }));
}

// ---------------------------------------------------------------- communities
export async function getCommunities(ageGroup?: string | null): Promise<Community[]> {
  const id = await me();
  let commQuery = supabase.from('nexa_communities').select('*');
  if (ageGroup) commQuery = commQuery.eq('age_group', ageGroup);
  const [rows, myMemberships, counts] = await Promise.all([
    q<Community[]>(commQuery.order('name')),
    q<any[]>(supabase.from('nexa_community_members').select('community_id,role').eq('user_id', id)),
    getCommunityMemberCounts(),
  ]);
  const joined = new Map((myMemberships ?? []).map((m) => [m.community_id, m.role]));
  return (rows ?? []).map((c) => ({ ...c, joined: joined.has(c.id), member_count: counts[c.id] || 0 }));
}
export async function getCommunity(id: string): Promise<Community | null> {
  const rows = await q<Community[]>(supabase.from('nexa_communities').select('*').eq('id', id).maybeSingle());
  return Array.isArray(rows) ? rows[0] ?? null : (rows as unknown as Community) ?? null;
}
export async function createCommunity(input: { name: string; description: string; topic: string; rules: string; accent: string }): Promise<Community> {
  const id = await me();
  const profile = await myProfile();
  if (!profile?.age_group) throw new Error('Åldersverifiering krävs.');
  const check = await moderateText(`${input.name}\n${input.description}\n${input.rules}`, 'community');
  if (check.decision === 'BLOCK' || check.decision === 'ESCALATE') {
    throw new Error(check.explanation || 'Communitytexten blockerades av säkerhetsmotorn.');
  }
  const slug = `${input.name.toLowerCase().replace(/[^a-z0-9åäö]/g, '-').replace(/-+/g, '-').slice(0, 24)}-${uid().slice(0, 6)}`;
  const created = await q<Community>(supabase.from('nexa_communities').insert({ ...input, slug, age_group: profile.age_group, created_by: id }).select().single());
  await q(supabase.from('nexa_community_members').insert({ community_id: created.id, user_id: id, role: 'owner' }));
  return { ...created, joined: true, member_count: 1 };
}
export async function joinCommunity(communityId: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_community_members').insert({ community_id: communityId, user_id: id, role: 'member' }));
}
export async function leaveCommunity(communityId: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_community_members').delete().eq('community_id', communityId).eq('user_id', id));
}
export async function followTopic(topic: string, follow: boolean): Promise<void> {
  const id = await me();
  if (follow) await q(supabase.from('nexa_topic_follows').upsert({ user_id: id, topic }, { onConflict: 'user_id,topic' }));
  else await q(supabase.from('nexa_topic_follows').delete().eq('user_id', id).eq('topic', topic));
}
export async function myTopics(): Promise<string[]> {
  const id = await me();
  const rows = await q<any[]>(supabase.from('nexa_topic_follows').select('topic').eq('user_id', id));
  return (rows ?? []).map((r) => r.topic);
}
export async function getPosts(communityId?: string): Promise<Post[]> {
  let query = supabase.from('nexa_posts').select('*').order('created_at', { ascending: false }).limit(80);
  if (communityId) query = query.eq('community_id', communityId);
  return q<Post[]>(query) ?? [];
}
export async function createPost(communityId: string, body: string): Promise<{ decision: Decision; explanation: string }> {
  const id = await me();
  const decision = await moderateText(body, 'post');
  if (decision.decision === 'BLOCK' || decision.decision === 'ESCALATE') throw new Error(decision.explanation);
  const hash = await sha256Hex(body);
  await q(supabase.from('nexa_posts').insert({ community_id: communityId, author_id: id, body, content_hash: hash, moderation_decision_id: decision.id }));
  return { decision: decision.decision, explanation: decision.explanation };
}
export async function getComments(postIds: string[]): Promise<Comment[]> {
  if (!postIds.length) return [];
  return q<Comment[]>(supabase.from('nexa_comments').select('*').in('post_id', postIds).order('created_at')) ?? [];
}
export async function createComment(postId: string, body: string): Promise<{ decision: Decision; explanation: string }> {
  const id = await me();
  const decision = await moderateText(body, 'comment');
  if (decision.decision === 'BLOCK' || decision.decision === 'ESCALATE') throw new Error(decision.explanation);
  const hash = await sha256Hex(body);
  await q(supabase.from('nexa_comments').insert({ post_id: postId, author_id: id, body, content_hash: hash, moderation_decision_id: decision.id }));
  return { decision: decision.decision, explanation: decision.explanation };
}
export async function getReactions(postIds: string[]): Promise<any[]> {
  if (!postIds.length) return [];
  return q<any[]>(supabase.from('nexa_reactions').select('*').in('post_id', postIds)) ?? [];
}
export async function toggleReaction(postId: string, emoji: string): Promise<void> {
  const id = await me();
  const existing = await q<any[]>(supabase.from('nexa_reactions').select('id').eq('post_id', postId).eq('user_id', id).eq('emoji', emoji));
  if (existing?.length) await q(supabase.from('nexa_reactions').delete().eq('id', existing[0].id));
  else await q(supabase.from('nexa_reactions').insert({ post_id: postId, user_id: id, emoji }));
}

// ---------------------------------------------------------------- safety
export async function reportContent(targetType: string, targetId: string, reason: string, details = ''): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_reports').insert({ reporter_id: id, target_type: targetType, target_id: targetId, reason, details }));
}
export async function blockUser(blockedId: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_blocks').insert({ blocker_id: id, blocked_id: blockedId }));
}
export async function unblockUser(blockedId: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_blocks').delete().eq('blocker_id', id).eq('blocked_id', blockedId));
}
export async function getBlocks(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_blocks').select('*')) ?? [];
}
export async function getMyReports(): Promise<any[]> {
  const id = await me();
  return q<any[]>(supabase.from('nexa_reports').select('*').eq('reporter_id', id).order('created_at', { ascending: false })) ?? [];
}
export async function getAppeals(): Promise<any[]> {
  const id = await me();
  return q<any[]>(supabase.from('nexa_appeals').select('*').eq('user_id', id).order('created_at', { ascending: false })) ?? [];
}
export async function createAppeal(decisionId: string, reason: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_appeals').insert({ user_id: id, decision_id: decisionId, reason }));
}
export async function getMyRestrictions(): Promise<any[]> {
  const id = await me();
  return q<any[]>(supabase.from('nexa_account_restrictions').select('*').eq('user_id', id).order('created_at', { ascending: false })) ?? [];
}

// ---------------------------------------------------------------- notifications
export async function getNotifications(): Promise<Notification[]> {
  return q<Notification[]>(supabase.from('nexa_notifications').select('*').order('created_at', { ascending: false }).limit(100)) ?? [];
}
export async function markNotificationRead(id: string): Promise<void> {
  await q(supabase.from('nexa_notifications').update({ read: true }).eq('id', id));
}
export async function markAllNotificationsRead(): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_notifications').update({ read: true }).eq('user_id', id).eq('read', false));
}
export async function getPrefs(): Promise<any> {
  const id = await me();
  const rows = await q<any[]>(supabase.from('nexa_notification_preferences').select('*').eq('user_id', id));
  const r = Array.isArray(rows) ? rows[0] ?? {} : rows;
  // Normalize the DB column names to the UI preference keys.
  return {
    friend_requests: r.friend_requests ?? true, messages: r.messages ?? true,
    community_activity: r.community ?? true, mentions: r.mentions ?? true,
    safety_warnings: r.safety ?? true, security: r.security ?? true,
  };
}
export async function savePrefs(patch: Record<string, boolean>): Promise<void> {
  const id = await me();
  const map: Record<string, string> = { community_activity: 'community', safety_warnings: 'safety' };
  const db: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(patch)) db[map[k] || k] = v;
  await q(supabase.from('nexa_notification_preferences').upsert({ user_id: id, ...db }, { onConflict: 'user_id' }));
}
export function subscribeNotifications(userId: string, cb: (n: Notification) => void) {
  const ch = supabase.channel(`nexa-notes-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nexa_notifications', filter: `user_id=eq.${userId}` },
      (payload) => cb(payload.new as Notification))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// ---------------------------------------------------------------- account
export async function exportData(): Promise<any> {
  return q<any>(supabase.rpc('nexa_export_my_data'));
}
export async function deleteAccount(): Promise<void> {
  await q(supabase.rpc('nexa_delete_my_account'));
  await supabase.auth.signOut();
}
export async function touchPresence(): Promise<void> {
  try { await saveProfile({ last_seen_at: new Date().toISOString() } as any); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- moderators
export async function moderatorRole(): Promise<string | null> {
  const id = await me();
  const rows = await q<any[]>(supabase.from('nexa_moderators').select('role').eq('user_id', id));
  return rows?.[0]?.role ?? null;
}
export async function bootstrapModerator(): Promise<void> {
  await q(supabase.rpc('nexa_bootstrap_moderator'));
}
export const mfa = {
  level: async () => { try { return await (supabase.auth as any).mfa.getAssuranceLevel(); } catch { return { data: { currentLevel: 'aal1' }, error: null }; } },
  list: () => supabase.auth.mfa.listFactors(),
  enroll: () => supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'NEXA moderator' }),
  challenge: (factorId: string) => supabase.auth.mfa.challenge({ factorId }),
  verify: (factorId: string, challengeId: string, code: string) => supabase.auth.mfa.verify({ factorId, challengeId, code }),
};
export async function getReports(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_reports').select('*').order('created_at', { ascending: false }).limit(100)) ?? [];
}
export async function getReviewQueue(): Promise<{ decisions: any[]; media: any[]; held: any[] }> {
  const [decisions, media, heldMessages, heldPosts] = await Promise.all([
    q<any[]>(supabase.from('nexa_moderation_decisions').select('*').or('human_review.eq.true,decision.eq.HOLD_FOR_REVIEW,decision.eq.ESCALATE').order('created_at', { ascending: false }).limit(60)),
    q<any[]>(supabase.from('nexa_media').select('*').in('status', ['pending', 'held']).order('created_at', { ascending: false }).limit(40)),
    q<any[]>(supabase.from('nexa_messages').select('*').eq('status', 'held').limit(40)),
    q<any[]>(supabase.from('nexa_posts').select('*').eq('status', 'held').limit(40)),
  ]);
  return {
    decisions: decisions ?? [],
    media: media ?? [],
    held: [
      ...(heldMessages ?? []).map((m) => ({ ...m, _contentKind: 'message' })),
      ...(heldPosts ?? []).map((p) => ({ ...p, _contentKind: 'post' })),
    ],
  };
}
export async function logSensitiveAction(action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_audit_logs').insert({ actor_id: id, action, target_type: targetType, target_id: targetId, metadata }));
}
export async function getReportEvidence(report: any): Promise<any> {
  await logSensitiveAction('EVIDENCE_REVIEW', report.target_type, report.target_id, { report_id: report.id, reason: report.reason });
  const t = report.target_type;
  let target: any = null;
  try {
    if (t === 'message') target = await q(supabase.from('nexa_messages').select('*').eq('id', report.target_id).maybeSingle());
    else if (t === 'post') target = await q(supabase.from('nexa_posts').select('*').eq('id', report.target_id).maybeSingle());
    else if (t === 'comment') target = await q(supabase.from('nexa_comments').select('*').eq('id', report.target_id).maybeSingle());
    else if (t === 'user') target = await q(supabase.from('nexa_profiles').select('id,username,age_group,bio,status,is_demo,created_at').eq('id', report.target_id).maybeSingle());
  } catch { /* keep report metadata */ }
  return { report, target };
}
export async function getModeratorOverrides(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_moderator_overrides').select('*').order('created_at', { ascending: false }).limit(100)) ?? [];
}
export async function setContentStatus(kind: 'message' | 'post' | 'comment', id: string, status: 'visible' | 'removed'): Promise<void> {
  const table = kind === 'message' ? 'nexa_messages' : kind === 'post' ? 'nexa_posts' : 'nexa_comments';
  await q(supabase.from(table).update({ status }).eq('id', id));
  await logSensitiveAction(status === 'visible' ? 'CONTENT_APPROVED' : 'CONTENT_REMOVED', kind, id);
}
export async function getSuspiciousUsers(): Promise<any[]> {
  const decisions = await q<any[]>(supabase.from('nexa_moderation_decisions').select('user_id,category,decision,created_at').neq('decision', 'ALLOW').order('created_at', { ascending: false }).limit(200));
  const counts: Record<string, number> = {};
  for (const d of decisions ?? []) if (d.user_id) counts[d.user_id] = (counts[d.user_id] || 0) + 1;
  const ids = Object.keys(counts).slice(0, 30);
  const profiles = ids.length ? await q<any[]>(supabase.from('nexa_profiles').select('id,username,age_group,status,is_demo').in('id', ids)) : [];
  return (profiles ?? []).map((p) => ({ ...p, incidents: counts[p.id] }));
}
export async function getUserHistory(userId: string): Promise<any> {
  await logSensitiveAction('USER_HISTORY_REVIEW', 'user', userId);
  const [decisions, restrictions, messages, reports] = await Promise.all([
    q<any[]>(supabase.from('nexa_moderation_decisions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)),
    q<any[]>(supabase.from('nexa_account_restrictions').select('*').eq('user_id', userId).order('created_at', { ascending: false })),
    q<any[]>(supabase.from('nexa_messages').select('*').eq('sender_id', userId).order('created_at', { ascending: false }).limit(20)),
    q<any[]>(supabase.from('nexa_reports').select('*').eq('reporter_id', userId).limit(20)),
  ]);
  return { decisions, restrictions, messages, reports };
}
export async function getIncidents(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_safety_incidents').select('*').order('created_at', { ascending: false }).limit(100)) ?? [];
}
export async function getAppealsAdmin(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_appeals').select('*').order('created_at', { ascending: false }).limit(100)) ?? [];
}
export async function getAuditLogs(): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_audit_logs').select('*').order('created_at', { ascending: false }).limit(150)) ?? [];
}
export async function getAllDecisions(limit = 500): Promise<any[]> {
  return q<any[]>(supabase.from('nexa_moderation_decisions').select('*').order('created_at', { ascending: false }).limit(limit)) ?? [];
}
export async function getPolicies(): Promise<Policy[]> {
  const rows = await q<any[]>(supabase.from('nexa_moderation_policies').select('*').order('key')) ?? [];
  // signal_type is derived from the pattern (regex vs phrase); the table stores
  // the raw rule text in `pattern` and a `description` for moderators.
  return rows.map((r) => ({ ...r, signal_type: r.signal_type || (String(r.pattern).startsWith('regex:') ? 'regex' : 'phrase') })) as Policy[];
}
export async function upsertPolicy(p: Partial<Policy>): Promise<void> {
  const id = await me();
  const row: Record<string, unknown> = { ...p, updated_by: id, updated_at: new Date().toISOString() };
  delete row.signal_type;
  await q(supabase.from('nexa_moderation_policies').upsert(row, { onConflict: 'key' }));
}
export async function getTestCases(): Promise<TestCase[]> {
  const rows = await q<any[]>(supabase.from('nexa_moderation_test_cases').select('*').order('label')) ?? [];
  return rows.map((r) => ({ ...r, active: r.active ?? true })) as TestCase[];
}
export async function addTestCase(tc: Partial<TestCase>): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_moderation_test_cases').insert({ ...tc, created_by: id }));
}
export async function deleteTestCase(id: string): Promise<void> {
  await q(supabase.from('nexa_moderation_test_cases').delete().eq('id', id));
}
export async function runEvaluation(cases: TestCase[]): Promise<{ runId: string; rows: any[] }> {
  const runId = uid();
  const rows: any[] = [];
  for (const tc of cases.filter((c) => c.active)) {
    let actual: Decision = 'HOLD_FOR_REVIEW';
    let confidence = 0; let category = 'none'; let provider = 'builtin-engine'; let latency = 0;
    try {
      const r = await moderateText(tc.text, 'test');
      actual = r.decision; confidence = r.confidence; category = r.category; provider = r.provider; latency = r.latency_ms;
    } catch { /* counted as false negative/positive below */ }
    const fp = !tc.harmful && actual !== 'ALLOW';
    const fn = tc.harmful && actual === 'ALLOW';
    const passed = !fp && !fn;
    const row = {
      run_id: runId, test_case_id: tc.id, actual_decision: actual, expected_decision: tc.expected_decision,
      category, confidence, passed, false_positive: fp, false_negative: fn,
      provider, language: tc.language, obfuscation_type: tc.obfuscation_type, latency_ms: latency,
    };
    rows.push(row);
    await q(supabase.from('nexa_moderation_evaluations').insert(row));
  }
  return { runId, rows };
}
export async function getEvaluations(runId?: string): Promise<any[]> {
  let query = supabase.from('nexa_moderation_evaluations').select('*').order('created_at', { ascending: false }).limit(300);
  if (runId) query = query.eq('run_id', runId);
  return q<any[]>(query) ?? [];
}
export async function warnUser(userId: string, reason: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_account_restrictions').insert({ user_id: userId, kind: 'warning', reason, issued_by: id }));
}
export async function restrictUser(userId: string, hours: number, reason: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_account_restrictions').insert({
    user_id: userId, kind: 'temporary_restriction', reason, issued_by: id,
    expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
  }));
}
export async function escalateIncident(incidentId: string): Promise<void> {
  await q(supabase.from('nexa_safety_incidents').update({ status: 'escalated' }).eq('id', incidentId));
}
export async function resolveIncident(incidentId: string): Promise<void> {
  await q(supabase.from('nexa_safety_incidents').update({ status: 'resolved' }).eq('id', incidentId));
}
export async function resolveAppeal(appealId: string, status: 'approved' | 'rejected', note: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_appeals').update({ status, resolution_note: note, reviewed_by: id, resolved_at: new Date().toISOString() }).eq('id', appealId));
}
export async function recordOverride(decisionId: string, corrected: Decision, note: string): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_moderator_overrides').insert({ decision_id: decisionId, moderator_id: id, corrected_decision: corrected, note }));
  await q(supabase.from('nexa_moderation_decisions').update({ decision: corrected, human_review: false } as any).eq('id', decisionId));
}
export async function approveMedia(mediaId: string, approve: boolean): Promise<void> {
  await q(supabase.from('nexa_media').update({ status: approve ? 'approved' : 'rejected' }).eq('id', mediaId));
}
export async function resolveReport(reportId: string, status: 'resolved' | 'dismissed' | 'in_review'): Promise<void> {
  const id = await me();
  await q(supabase.from('nexa_reports').update({ status, handled_by: id }).eq('id', reportId));
}
export async function removeContent(kind: 'message' | 'post' | 'comment', id: string): Promise<void> {
  const table = kind === 'message' ? 'nexa_messages' : kind === 'post' ? 'nexa_posts' : 'nexa_comments';
  await q(supabase.from(table).update({ status: 'removed' }).eq('id', id));
}
