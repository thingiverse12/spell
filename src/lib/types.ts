export type AgeGroup = '13-14' | '15-17';
export type Decision = 'ALLOW' | 'WARN' | 'HOLD_FOR_REVIEW' | 'BLOCK' | 'ESCALATE';

export interface Profile {
  id: string; username: string; age: number | null; age_group: AgeGroup | null;
  bio: string; avatar_url: string | null; interests: string[]; discoverable: boolean;
  show_online: boolean; allow_requests: 'everyone' | 'connections' | 'none';
  friend_pref: 'friends' | 'interests' | 'romance'; locale: string;
  onboarding_complete: boolean; status: string; is_demo: boolean;
  last_seen_at: string | null; created_at: string;
}
export interface Interest { slug: string; label_sv: string; label_en: string | null; category: string; emoji: string }
export interface Community { id: string; slug: string; name: string; description: string; topic: string; rules: string; accent: string; age_group: AgeGroup; created_by: string | null; created_at: string; member_count?: number; joined?: boolean }
export interface Connection { id: string; requester_id: string; addressee_id: string; kind: 'friend' | 'romance'; status: 'pending' | 'accepted' | 'declined'; created_at: string }
export interface Conversation { id: string; kind: 'direct' | 'group' | 'community'; title: string | null; created_by: string | null; created_at: string; members?: string[] }
export interface Message { id: string; conversation_id: string; sender_id: string; kind: 'text' | 'image' | 'voice' | 'system'; body: string; media_id: string | null; status: string; created_at: string }
export interface Post { id: string; community_id: string; author_id: string; body: string; status: string; created_at: string }
export interface Comment { id: string; post_id: string; author_id: string; body: string; status: string; created_at: string }
export interface Notification { id: string; type: string; title: string; body: string; data: any; read: boolean; created_at: string }
export interface ModerationResult {
  id: string | null; content_hash: string; content_type: string; decision: Decision;
  category: string; confidence: number; policy_rule: string | null; explanation: string;
  recommended_action: string; human_review: boolean; signals: any; provider: string; latency_ms: number;
}
export interface Policy { id: string; key: string; category: string; severity: number; pattern: string; signal_type: string; enabled: boolean; description: string; version: number }
export interface TestCase { id: string; label: string; language: string; text: string; expected_decision: Decision; expected_category: string; harmful: boolean; obfuscation_type: string; active: boolean }
export interface ConfigRow { key: string; value: any; description: string; sensitive: boolean }
