-- =====================================================================
-- NEXA  |  Complete social platform schema
-- All objects live in public with the nexa_ prefix so PostgREST exposes
-- them without changing project-level schema settings. Other apps in the
-- project are untouched.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.nexa_interests (
  slug text primary key,
  label_sv text not null,
  label_en text,
  category text not null default 'ovrigt',
  emoji text not null default '✦'
);

create table if not exists public.nexa_config (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  sensitive boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.nexa_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  age int,
  age_group text check (age_group in ('13-14','15-17')),
  bio text not null default '',
  avatar_url text,
  interests text[] not null default '{}',
  discoverable boolean not null default true,
  show_online boolean not null default false,
  allow_requests text not null default 'everyone' check (allow_requests in ('everyone','connections','none')),
  friend_pref text not null default 'friends' check (friend_pref in ('friends','interests','romance')),
  locale text not null default 'sv',
  onboarding_complete boolean not null default false,
  status text not null default 'active' check (status in ('active','restricted','deleted')),
  is_demo boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nexa_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint nexa_age_range check (age is null or age between 13 and 17),
  constraint nexa_romance_age check (friend_pref <> 'romance' or age_group = '15-17')
);

create table if not exists public.nexa_age_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null default 'self_declared_demo',
  provider text,
  provider_ref text,
  status text not null default 'demo' check (status in ('demo','pending','verified','rejected')),
  birth_date date not null,
  age_group text not null check (age_group in ('13-14','15-17')),
  age int not null check (age between 13 and 17),
  identity_document_stored boolean not null default false,
  biometric_data_stored boolean not null default false,
  raw_provider_response jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists nexa_age_verification_user on public.nexa_age_verifications(user_id);

create table if not exists public.nexa_moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  content_hash text not null,
  content_type text not null,
  decision text not null check (decision in ('ALLOW','WARN','HOLD_FOR_REVIEW','BLOCK','ESCALATE')),
  category text not null default 'none',
  confidence numeric(5,4) not null default 0,
  policy_rule text,
  explanation text not null default '',
  recommended_action text not null default 'none',
  human_review boolean not null default false,
  signals jsonb not null default '{}'::jsonb,
  provider text not null default 'builtin-engine',
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists nexa_decisions_user_time on public.nexa_moderation_decisions(user_id, created_at desc);
create index if not exists nexa_decisions_hash on public.nexa_moderation_decisions(content_hash);

create table if not exists public.nexa_moderation_policies (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  category text not null,
  severity int not null default 2 check (severity between 1 and 5),
  pattern text not null,
  signal_type text not null default 'phrase' check (signal_type in ('phrase','regex','context','external_contact','pii','spam')),
  enabled boolean not null default true,
  description text not null default '',
  version int not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.nexa_moderation_test_cases (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  language text not null default 'sv',
  text text not null,
  expected_decision text not null check (expected_decision in ('ALLOW','WARN','HOLD_FOR_REVIEW','BLOCK','ESCALATE')),
  expected_category text not null default 'none',
  harmful boolean not null default false,
  obfuscation_type text not null default 'normal',
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_moderation_evaluations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  test_case_id uuid references public.nexa_moderation_test_cases(id) on delete cascade,
  actual_decision text not null,
  expected_decision text not null,
  category text,
  confidence numeric(5,4),
  passed boolean not null,
  false_positive boolean not null default false,
  false_negative boolean not null default false,
  provider text,
  language text,
  obfuscation_type text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists nexa_eval_run on public.nexa_moderation_evaluations(run_id);

create table if not exists public.nexa_moderator_overrides (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references public.nexa_moderation_decisions(id) on delete cascade,
  moderator_id uuid references auth.users(id),
  corrected_decision text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_enforcement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  decision_id uuid references public.nexa_moderation_decisions(id) on delete set null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('warning','temporary_restriction','content_restriction')),
  reason text not null default '',
  expires_at timestamptz,
  issued_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_safety_incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  category text not null default 'none',
  decision_id uuid references public.nexa_moderation_decisions(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','escalated','resolved')),
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid references public.nexa_moderation_decisions(id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open','approved','rejected')),
  resolution_note text,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.nexa_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'friend' check (kind in ('friend','romance')),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.nexa_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.nexa_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct','group','community')),
  title text,
  community_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_conversation_members (
  conversation_id uuid not null references public.nexa_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.nexa_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket_path text not null unique,
  mime text not null,
  kind text not null check (kind in ('image','voice')),
  duration_seconds int,
  moderation_decision_id uuid references public.nexa_moderation_decisions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','held')),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nexa_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','image','voice','system')),
  body text not null default '',
  media_id uuid references public.nexa_media(id) on delete set null,
  content_hash text not null,
  moderation_decision_id uuid unique references public.nexa_moderation_decisions(id) on delete set null,
  status text not null default 'visible' check (status in ('visible','held','removed')),
  created_at timestamptz not null default now()
);
create index if not exists nexa_messages_conv_time on public.nexa_messages(conversation_id, created_at);

create table if not exists public.nexa_video_call_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nexa_conversations(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  approver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined','disabled')),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_communities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  topic text not null default 'ovrigt',
  rules text not null default 'Var snäll, håll dig till ämnet och rapportera sådant som känns fel.',
  accent text not null default '#873BFA',
  age_group text not null check (age_group in ('13-14','15-17')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_community_members (
  community_id uuid not null references public.nexa_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.nexa_topic_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);

create table if not exists public.nexa_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.nexa_communities(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  content_hash text not null,
  moderation_decision_id uuid unique references public.nexa_moderation_decisions(id) on delete set null,
  status text not null default 'visible' check (status in ('visible','held','removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.nexa_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  content_hash text not null,
  moderation_decision_id uuid unique references public.nexa_moderation_decisions(id) on delete set null,
  status text not null default 'visible' check (status in ('visible','held','removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.nexa_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (post_id, user_id, emoji)
);

create table if not exists public.nexa_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('message','post','comment','user','media')),
  target_id uuid not null,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open','in_review','resolved','dismissed')),
  handled_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  friend_requests boolean not null default true,
  messages boolean not null default true,
  community boolean not null default true,
  mentions boolean not null default true,
  safety boolean not null default true,
  security boolean not null default true
);

create table if not exists public.nexa_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists nexa_notifications_user on public.nexa_notifications(user_id, created_at desc);

create table if not exists public.nexa_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'moderator' check (role in ('moderator','admin','safety_lead')),
  mfa_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.nexa_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nexa_audit_time on public.nexa_audit_logs(created_at desc);

-- NEXA_CHUNK_BREAK
-- =====================================================================
-- Helper functions (security definer => bypass RLS safely)
-- =====================================================================
create or replace function public.nexa_is_moderator(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select true from public.nexa_moderators m where m.user_id = uid), false);
$$;

create or replace function public.nexa_age_group_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select age_group from public.nexa_profiles p where p.id = uid;
$$;

create or replace function public.nexa_is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nexa_blocks x
    where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a));
$$;

create or replace function public.nexa_is_service()
returns boolean language plpgsql stable as $$
begin
  return coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or current_user in ('postgres','service_role','supabase_admin','supabase_auth_admin');
end;
$$;

create or replace function public.nexa_sha256(t text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(t,''), 'UTF8')), 'hex');
$$;

create or replace function public.nexa_check_moderation(p_decision_id uuid, p_hash text, p_user uuid, p_type text)
returns text language plpgsql stable security definer set search_path = public as $$
declare d public.nexa_moderation_decisions%rowtype;
begin
  if p_decision_id is null then
    raise exception 'MODERATION_REQUIRED: Innehållet måste analyseras av säkerhetsmotorn innan det sparas.';
  end if;
  select * into d from public.nexa_moderation_decisions m
   where m.id = p_decision_id and m.content_hash = p_hash and m.user_id = p_user and m.content_type = p_type;
  if not found then raise exception 'MODERATION_INVALID: Beslutet matchar inte innehållet.'; end if;
  if d.decision in ('BLOCK','ESCALATE') then raise exception 'MODERATION_BLOCKED: %', d.explanation; end if;
  if exists (select 1 from public.nexa_messages where moderation_decision_id = p_decision_id)
     or exists (select 1 from public.nexa_posts where moderation_decision_id = p_decision_id)
     or exists (select 1 from public.nexa_comments where moderation_decision_id = p_decision_id) then
    raise exception 'MODERATION_REUSED: Beslutet har redan använts.';
  end if;
  return d.decision;
end;
$$;

-- =====================================================================
-- Triggers: server-side enforcement
-- =====================================================================
create or replace function public.nexa_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.nexa_profiles (id, username)
  values (new.id, 'user_' || replace(substr(new.id::text,1,8),'-',''))
  on conflict (id) do nothing;
  insert into public.nexa_notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists nexa_on_auth_user_created on auth.users;
create trigger nexa_on_auth_user_created after insert on auth.users
for each row execute function public.nexa_handle_new_user();

create or replace function public.nexa_protect_profile()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if not public.nexa_is_service() then
    if new.age_group is distinct from old.age_group
       or new.age is distinct from old.age
       or new.is_demo is distinct from old.is_demo
       or new.id is distinct from old.id
       or new.status is distinct from old.status then
      raise exception 'Åldersgrupp, ålder, status och demomarkering sätts endast av servern.';
    end if;
    if new.friend_pref = 'romance' and old.age_group <> '15-17' then
      raise exception 'Romantiskt intresse är endast tillgängligt för 15–17 år.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_profiles_protect on public.nexa_profiles;
create trigger nexa_profiles_protect before update on public.nexa_profiles
for each row execute function public.nexa_protect_profile();

create or replace function public.nexa_validate_connection()
returns trigger language plpgsql security definer set search_path = public as $$
declare a1 text; a2 text;
begin
  a1 := public.nexa_age_group_of(new.requester_id);
  a2 := public.nexa_age_group_of(new.addressee_id);
  if a1 is null or a2 is null or a1 <> a2 then
    raise exception 'AGE_SEPARATION: Kontakt mellan åldersgrupper är inte tillåten.';
  end if;
  if public.nexa_is_blocked(new.requester_id, new.addressee_id) then
    raise exception 'BLOCKED: Kontakten är blockerad.';
  end if;
  if new.kind = 'romance' and a1 <> '15-17' then
    raise exception 'Åldersbegränsning: romantiskt intresse kräver 15–17 år och juridisk granskning.';
  end if;
  if exists (select 1 from public.nexa_profiles p where p.id = new.addressee_id and p.allow_requests = 'none' and p.id <> auth.uid()) then
    raise exception 'Användaren tar inte emot förfrågningar.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists nexa_connections_validate on public.nexa_connections;
create trigger nexa_connections_validate before insert or update on public.nexa_connections
for each row execute function public.nexa_validate_connection();

create or replace function public.nexa_validate_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare g text; n int;
begin
  g := public.nexa_age_group_of(new.user_id);
  if g is null then raise exception 'Åldersverifiering krävs innan chatt.'; end if;
  if exists (select 1 from public.nexa_conversation_members cm
             join public.nexa_profiles p on p.id = cm.user_id
             where cm.conversation_id = new.conversation_id and p.age_group <> g) then
    raise exception 'AGE_SEPARATION: Chatt mellan åldersgrupper är inte tillåten.';
  end if;
  if exists (select 1 from public.nexa_conversation_members cm
    where cm.conversation_id = new.conversation_id and public.nexa_is_blocked(cm.user_id, new.user_id)) then
    raise exception 'BLOCKED: En deltagare har blockerat kontakten.';
  end if;
  select count(*) into n from public.nexa_conversation_members where conversation_id = new.conversation_id;
  if n >= 20 then raise exception 'Gruppchatten är full (max 20).'; end if;
  return new;
end;
$$;
drop trigger if exists nexa_conv_members_validate on public.nexa_conversation_members;
create trigger nexa_conv_members_validate before insert on public.nexa_conversation_members
for each row execute function public.nexa_validate_conversation_member();

create or replace function public.nexa_validate_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; g text; c10 int; c60 int; blocked_count int;
begin
  if auth.uid() is not null and new.sender_id <> auth.uid() then
    raise exception 'Avsändaren måste vara den inloggade användaren.';
  end if;
  if not exists (select 1 from public.nexa_conversation_members cm
                 where cm.conversation_id = new.conversation_id and cm.user_id = new.sender_id) then
    raise exception 'Du är inte medlem i den här konversationen.';
  end if;
  g := public.nexa_age_group_of(new.sender_id);
  if g is null then raise exception 'Åldersverifiering krävs.'; end if;
  if exists (select 1 from public.nexa_conversation_members cm
             join public.nexa_profiles p on p.id = cm.user_id
             where cm.conversation_id = new.conversation_id and p.age_group <> g) then
    raise exception 'AGE_SEPARATION: Meddelanden mellan åldersgrupper blockeras.';
  end if;
  select count(*) into blocked_count from public.nexa_conversation_members cm
   where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
     and public.nexa_is_blocked(new.sender_id, cm.user_id);
  if blocked_count > 0 then raise exception 'BLOCKED: Kontakten är blockerad.'; end if;

  if new.kind = 'text' then
    d := public.nexa_check_moderation(new.moderation_decision_id, new.content_hash, new.sender_id, 'message');
  else
    if new.media_id is null then raise exception 'Media saknas.'; end if;
    if not exists (select 1 from public.nexa_media m where m.id = new.media_id and m.owner_id = new.sender_id and m.status = 'approved') then
      raise exception 'MEDIA_NOT_APPROVED: Bilden/rösten väntar på säkerhetsgranskning.';
    end if;
    d := 'ALLOW';
  end if;
  if d = 'HOLD_FOR_REVIEW' then new.status := 'held'; else new.status := 'visible'; end if;

  select count(*) into c10 from public.nexa_messages m
    where m.sender_id = new.sender_id and m.created_at > now() - interval '10 seconds';
  select count(*) into c60 from public.nexa_messages m
    where m.sender_id = new.sender_id and m.created_at > now() - interval '60 seconds';
  if c10 >= 8 or c60 >= 40 then raise exception 'RATE_LIMIT: För många meddelanden. Vänta en stund.'; end if;
  return new;
end;
$$;
drop trigger if exists nexa_messages_validate on public.nexa_messages;
create trigger nexa_messages_validate before insert on public.nexa_messages
for each row execute function public.nexa_validate_message();

create or replace function public.nexa_validate_community_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare cg text; g text;
begin
  select age_group into cg from public.nexa_communities where id = new.community_id;
  g := public.nexa_age_group_of(new.user_id);
  if cg is null or g is null or cg <> g then
    raise exception 'AGE_SEPARATION: Communityn tillhör en annan åldersgrupp.';
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_comm_members_validate on public.nexa_community_members;
create trigger nexa_comm_members_validate before insert on public.nexa_community_members
for each row execute function public.nexa_validate_community_member();

create or replace function public.nexa_validate_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; cg text; g text;
begin
  if auth.uid() is not null and new.author_id <> auth.uid() then raise exception 'Fel avsändare.'; end if;
  select age_group into cg from public.nexa_communities where id = new.community_id;
  g := public.nexa_age_group_of(new.author_id);
  if cg is null or g is null or cg <> g then raise exception 'AGE_SEPARATION: Inlägg i fel åldersgrupp blockeras.'; end if;
  if not exists (select 1 from public.nexa_community_members cm
                 where cm.community_id = new.community_id and cm.user_id = new.author_id) then
    raise exception 'Du måste vara medlem i communityn.';
  end if;
  d := public.nexa_check_moderation(new.moderation_decision_id, new.content_hash, new.author_id, 'post');
  if d = 'HOLD_FOR_REVIEW' then new.status := 'held'; else new.status := 'visible'; end if;
  return new;
end;
$$;
drop trigger if exists nexa_posts_validate on public.nexa_posts;
create trigger nexa_posts_validate before insert on public.nexa_posts
for each row execute function public.nexa_validate_post();

create or replace function public.nexa_validate_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; cg text; g text;
begin
  if auth.uid() is not null and new.author_id <> auth.uid() then raise exception 'Fel avsändare.'; end if;
  select c.age_group into cg from public.nexa_communities c
    join public.nexa_posts p on p.community_id = c.id where p.id = new.post_id;
  g := public.nexa_age_group_of(new.author_id);
  if cg is null or g is null or cg <> g then raise exception 'AGE_SEPARATION.'; end if;
  d := public.nexa_check_moderation(new.moderation_decision_id, new.content_hash, new.author_id, 'comment');
  if d = 'HOLD_FOR_REVIEW' then new.status := 'held'; else new.status := 'visible'; end if;
  return new;
end;
$$;
drop trigger if exists nexa_comments_validate on public.nexa_comments;
create trigger nexa_comments_validate before insert on public.nexa_comments
for each row execute function public.nexa_validate_comment();

create or replace function public.nexa_enforcement_after_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.user_id is null then return new; end if;
  if new.decision in ('ESCALATE','BLOCK') and new.category in ('grooming','sexual_minors','threat','self_harm','external_platform') then
    insert into public.nexa_safety_incidents (severity, category, decision_id, user_id, status, summary)
    values ('critical', new.category, new.id, new.user_id, 'open', new.explanation);
    insert into public.nexa_enforcement_events (user_id, decision_id, action, detail)
    values (new.user_id, new.id, 'immediate_content_restriction', new.explanation);
    if not exists (select 1 from public.nexa_account_restrictions r where r.user_id = new.user_id
                   and r.kind = 'content_restriction' and (r.expires_at is null or r.expires_at > now())) then
      insert into public.nexa_account_restrictions (user_id, kind, reason, expires_at)
      values (new.user_id, 'content_restriction', new.category || ': ' || new.explanation, now() + interval '24 hours');
    end if;
  elsif new.decision in ('WARN','HOLD_FOR_REVIEW','BLOCK','ESCALATE') then
    select count(*) into n from public.nexa_moderation_decisions d
      where d.user_id = new.user_id and d.decision in ('WARN','HOLD_FOR_REVIEW','BLOCK','ESCALATE')
        and d.created_at > now() - interval '7 days';
    insert into public.nexa_enforcement_events (user_id, decision_id, action, detail)
    values (new.user_id, new.id,
      case when n = 1 then 'educational_warning' when n >= 3 then 'temporary_restriction' else 'warning_count' end,
      'Incident ' || n || ' inom 7 dagar');
    if n >= 3 and not exists (select 1 from public.nexa_account_restrictions r where r.user_id = new.user_id
                   and r.kind = 'temporary_restriction' and (r.expires_at is null or r.expires_at > now())) then
      insert into public.nexa_account_restrictions (user_id, kind, reason, expires_at)
      values (new.user_id, 'temporary_restriction', 'Upprepade säkerhetsvarningar (' || n || ')', now() + interval '48 hours');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_decisions_enforcement on public.nexa_moderation_decisions;
create trigger nexa_decisions_enforcement after insert on public.nexa_moderation_decisions
for each row execute function public.nexa_enforcement_after_decision();

create or replace function public.nexa_notify(p_user uuid, p_pref text, p_type text, p_title text, p_body text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare enabled boolean;
begin
  if p_user is null then return; end if;
  execute format('select coalesce((select %I from public.nexa_notification_preferences where user_id = $1), true)', p_pref)
    into enabled using p_user;
  if enabled then
    insert into public.nexa_notifications (user_id, type, title, body, data)
    values (p_user, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public.nexa_after_connection()
returns trigger language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if tg_op = 'INSERT' then
    select username into u from public.nexa_profiles where id = new.requester_id;
    perform public.nexa_notify(new.addressee_id, 'friend_requests', 'friend_request', 'Ny förfrågan',
      coalesce(u,'Någon') || ' vill bli vän med dig.', jsonb_build_object('connection_id', new.id));
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    select username into u from public.nexa_profiles where id = new.addressee_id;
    perform public.nexa_notify(new.requester_id, 'friend_requests', 'connection_accepted', 'Förfrågan accepterad',
      coalesce(u,'Någon') || ' accepterade din förfrågan.', jsonb_build_object('connection_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_connections_notify on public.nexa_connections;
create trigger nexa_connections_notify after insert or update on public.nexa_connections
for each row execute function public.nexa_after_connection();

create or replace function public.nexa_after_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; u text;
begin
  select username into u from public.nexa_profiles where id = new.sender_id;
  for r in select cm.user_id from public.nexa_conversation_members cm
           where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id loop
    perform public.nexa_notify(r.user_id, 'messages', 'new_message', 'Nytt meddelande',
      coalesce(u,'Någon') || ': ' || left(coalesce(new.body,'[media]'), 60),
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id));
  end loop;
  return new;
end;
$$;
drop trigger if exists nexa_messages_notify on public.nexa_messages;
create trigger nexa_messages_notify after insert on public.nexa_messages
for each row execute function public.nexa_after_message();

create or replace function public.nexa_after_decision_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.decision in ('WARN','HOLD_FOR_REVIEW','BLOCK','ESCALATE') and new.user_id is not null then
    perform public.nexa_notify(new.user_id, 'safety', 'safety_warning', 'Säkerhetsmeddelande',
      new.explanation, jsonb_build_object('decision_id', new.id, 'decision', new.decision));
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_decisions_notify on public.nexa_moderation_decisions;
create trigger nexa_decisions_notify after insert on public.nexa_moderation_decisions
for each row execute function public.nexa_after_decision_notify();

create or replace function public.nexa_after_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid; u text;
begin
  select p.author_id into a from public.nexa_posts p where p.id = new.post_id;
  select username into u from public.nexa_profiles where id = new.author_id;
  if a is distinct from new.author_id then
    perform public.nexa_notify(a, 'community', 'community_comment', 'Ny kommentar',
      coalesce(u,'Någon') || ' kommenterade ditt inlägg.', jsonb_build_object('post_id', new.post_id));
  end if;
  return new;
end;
$$;
drop trigger if exists nexa_comments_notify on public.nexa_comments;
create trigger nexa_comments_notify after insert on public.nexa_comments
for each row execute function public.nexa_after_comment();

create or replace function public.nexa_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key', to_jsonb(new)->>'user_id', '');
  insert into public.nexa_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), tg_op || '_' || tg_table_name, tg_table_name, v_id, to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists nexa_restrictions_audit on public.nexa_account_restrictions;
create trigger nexa_restrictions_audit after insert or update on public.nexa_account_restrictions for each row execute function public.nexa_audit();
drop trigger if exists nexa_appeals_audit on public.nexa_appeals;
create trigger nexa_appeals_audit after insert or update on public.nexa_appeals for each row execute function public.nexa_audit();
drop trigger if exists nexa_policies_audit on public.nexa_moderation_policies;
create trigger nexa_policies_audit after insert or update on public.nexa_moderation_policies for each row execute function public.nexa_audit();
drop trigger if exists nexa_config_audit on public.nexa_config;
create trigger nexa_config_audit after insert or update on public.nexa_config for each row execute function public.nexa_audit();
drop trigger if exists nexa_moderators_audit on public.nexa_moderators;
create trigger nexa_moderators_audit after insert or update on public.nexa_moderators for each row execute function public.nexa_audit();
drop trigger if exists nexa_overrides_audit on public.nexa_moderator_overrides;
create trigger nexa_overrides_audit after insert on public.nexa_moderator_overrides for each row execute function public.nexa_audit();
drop trigger if exists nexa_reports_audit on public.nexa_reports;
create trigger nexa_reports_audit after insert or update on public.nexa_reports for each row execute function public.nexa_audit();

-- =====================================================================
-- RPCs (security definer, real server-side operations)
-- =====================================================================
create or replace function public.nexa_start_direct_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g text; og text; cid uuid;
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  if p_other = me then raise exception 'Du kan inte chatta med dig själv.'; end if;
  g := public.nexa_age_group_of(me); og := public.nexa_age_group_of(p_other);
  if g is null or og is null or g <> og then raise exception 'AGE_SEPARATION: Kontakt mellan åldersgrupper är inte tillåten.'; end if;
  if public.nexa_is_blocked(me, p_other) then raise exception 'BLOCKED: Kontakten är blockerad.'; end if;
  if not exists (select 1 from public.nexa_connections c where c.status = 'accepted'
      and ((c.requester_id = me and c.addressee_id = p_other) or (c.requester_id = p_other and c.addressee_id = me))) then
    raise exception 'Ni måste vara vänner innan ni kan chatta.';
  end if;
  select c.id into cid from public.nexa_conversations c
    join public.nexa_conversation_members a on a.conversation_id = c.id and a.user_id = me
    join public.nexa_conversation_members b on b.conversation_id = c.id and b.user_id = p_other
   where c.kind = 'direct' limit 1;
  if cid is not null then return cid; end if;
  insert into public.nexa_conversations (kind, created_by) values ('direct', me) returning id into cid;
  insert into public.nexa_conversation_members (conversation_id, user_id) values (cid, me), (cid, p_other);
  return cid;
end;
$$;

create or replace function public.nexa_create_group_conversation(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g text; cid uuid; m uuid;
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  if p_title is null or length(trim(p_title)) < 2 then raise exception 'Gruppnamnet är för kort.'; end if;
  if array_length(p_members,1) is null or array_length(p_members,1) < 1 then raise exception 'Välj minst en vän.'; end if;
  g := public.nexa_age_group_of(me);
  insert into public.nexa_conversations (kind, title, created_by) values ('group', trim(p_title), me) returning id into cid;
  insert into public.nexa_conversation_members (conversation_id, user_id, role) values (cid, me, 'admin');
  foreach m in array p_members loop
    if m <> me and public.nexa_age_group_of(m) = g and not public.nexa_is_blocked(me, m) then
      insert into public.nexa_conversation_members (conversation_id, user_id) values (cid, m) on conflict do nothing;
    end if;
  end loop;
  return cid;
end;
$$;

create or replace function public.nexa_bootstrap_moderator()
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  select count(*) into n from public.nexa_moderators;
  if n > 0 then raise exception 'Moderatorer finns redan. Kontakta en administratör för att få rollen.'; end if;
  insert into public.nexa_moderators (user_id, role) values (me, 'safety_lead');
  return 'safety_lead';
end;
$$;

create or replace function public.nexa_export_my_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.nexa_profiles p where p.id = me),
    'age_status', (select jsonb_build_object('age_group', v.age_group, 'method', v.method, 'status', v.status, 'verified_at', v.verified_at) from public.nexa_age_verifications v where v.user_id = me),
    'connections', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.nexa_connections c where c.requester_id = me or c.addressee_id = me),
    'messages', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.nexa_messages m where m.sender_id = me),
    'posts', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.nexa_posts p where p.author_id = me),
    'comments', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.nexa_comments c where c.author_id = me),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.nexa_notifications n where n.user_id = me),
    'moderation_decisions', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.nexa_moderation_decisions d where d.user_id = me),
    'appeals', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.nexa_appeals a where a.user_id = me),
    'reports', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.nexa_reports r where r.reporter_id = me)
  ) into out;
  return out;
end;
$$;

create or replace function public.nexa_delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  insert into public.nexa_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (me, 'ACCOUNT_DELETION_REQUEST', 'user', me::text, jsonb_build_object('at', now()));
  delete from public.nexa_messages where sender_id = me;
  delete from public.nexa_posts where author_id = me;
  delete from public.nexa_comments where author_id = me;
  delete from public.nexa_notifications where user_id = me;
  delete from public.nexa_conversation_members where user_id = me;
  delete from public.nexa_community_members where user_id = me;
  delete from public.nexa_connections where requester_id = me or addressee_id = me;
  delete from public.nexa_blocks where blocker_id = me or blocked_id = me;
  delete from public.nexa_reports where reporter_id = me;
  delete from public.nexa_appeals where user_id = me;
  update public.nexa_profiles set username = 'rad_' || replace(substr(id::text,1,8),'-',''), bio = '', avatar_url = null,
    interests = '{}', discoverable = false, onboarding_complete = false, last_seen_at = null where id = me;
  delete from auth.users where id = me;
end;
$$;

-- NEXA_CHUNK_BREAK
-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
create or replace function public.nexa_is_conversation_member(cid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nexa_conversation_members cm
                 where cm.conversation_id = cid and cm.user_id = uid);
$$;

do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'nexa_%' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to service_role', r.tablename);
  end loop;
end $$;

grant execute on function public.nexa_is_moderator(uuid) to authenticated, service_role;
grant execute on function public.nexa_age_group_of(uuid) to authenticated, service_role;
grant execute on function public.nexa_is_blocked(uuid,uuid) to authenticated, service_role;
grant execute on function public.nexa_is_service() to authenticated, service_role;
grant execute on function public.nexa_sha256(text) to authenticated, service_role;
grant execute on function public.nexa_check_moderation(uuid,text,uuid,text) to authenticated, service_role;
grant execute on function public.nexa_is_conversation_member(uuid,uuid) to authenticated, service_role;
grant execute on function public.nexa_start_direct_conversation(uuid) to authenticated;
grant execute on function public.nexa_create_group_conversation(text,uuid[]) to authenticated;
grant execute on function public.nexa_bootstrap_moderator() to authenticated;
grant execute on function public.nexa_export_my_data() to authenticated;
grant execute on function public.nexa_delete_my_account() to authenticated;

drop policy if exists nexa_profiles_select on public.nexa_profiles;
create policy nexa_profiles_select on public.nexa_profiles for select to authenticated using (
  id = auth.uid() or public.nexa_is_moderator(auth.uid())
  or (discoverable = true and status = 'active' and age_group is not null
      and age_group = public.nexa_age_group_of(auth.uid())
      and not public.nexa_is_blocked(id, auth.uid())));
drop policy if exists nexa_profiles_update on public.nexa_profiles;
create policy nexa_profiles_update on public.nexa_profiles for update to authenticated
  using (id = auth.uid() or public.nexa_is_moderator(auth.uid()))
  with check (id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_profiles_insert on public.nexa_profiles;
create policy nexa_profiles_insert on public.nexa_profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists nexa_age_select on public.nexa_age_verifications;
create policy nexa_age_select on public.nexa_age_verifications for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_config_select on public.nexa_config;
create policy nexa_config_select on public.nexa_config for select to authenticated using (true);
drop policy if exists nexa_config_write on public.nexa_config;
create policy nexa_config_write on public.nexa_config for all to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_interests_select on public.nexa_interests;
create policy nexa_interests_select on public.nexa_interests for select to authenticated using (true);
drop policy if exists nexa_policies_select on public.nexa_moderation_policies;
create policy nexa_policies_select on public.nexa_moderation_policies for select to authenticated using (true);
drop policy if exists nexa_policies_write on public.nexa_moderation_policies;
create policy nexa_policies_write on public.nexa_moderation_policies for all to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_cases_select on public.nexa_moderation_test_cases;
create policy nexa_cases_select on public.nexa_moderation_test_cases for select to authenticated using (true);
drop policy if exists nexa_cases_write on public.nexa_moderation_test_cases;
create policy nexa_cases_write on public.nexa_moderation_test_cases for all to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_eval_select on public.nexa_moderation_evaluations;
create policy nexa_eval_select on public.nexa_moderation_evaluations for select to authenticated
  using (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_eval_insert on public.nexa_moderation_evaluations;
create policy nexa_eval_insert on public.nexa_moderation_evaluations for insert to authenticated
  with check (public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_decisions_select on public.nexa_moderation_decisions;
create policy nexa_decisions_select on public.nexa_moderation_decisions for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_connections_select on public.nexa_connections;
create policy nexa_connections_select on public.nexa_connections for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_connections_insert on public.nexa_connections;
create policy nexa_connections_insert on public.nexa_connections for insert to authenticated
  with check (requester_id = auth.uid());
drop policy if exists nexa_connections_update on public.nexa_connections;
create policy nexa_connections_update on public.nexa_connections for update to authenticated
  using (addressee_id = auth.uid() or requester_id = auth.uid()) with check (true);

drop policy if exists nexa_blocks_select on public.nexa_blocks;
create policy nexa_blocks_select on public.nexa_blocks for select to authenticated
  using (blocker_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_blocks_insert on public.nexa_blocks;
create policy nexa_blocks_insert on public.nexa_blocks for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists nexa_blocks_delete on public.nexa_blocks;
create policy nexa_blocks_delete on public.nexa_blocks for delete to authenticated using (blocker_id = auth.uid());

drop policy if exists nexa_conv_select on public.nexa_conversations;
create policy nexa_conv_select on public.nexa_conversations for select to authenticated using (
  public.nexa_is_moderator(auth.uid()) or public.nexa_is_conversation_member(id, auth.uid()));
drop policy if exists nexa_conv_insert on public.nexa_conversations;
create policy nexa_conv_insert on public.nexa_conversations for insert to authenticated with check (created_by = auth.uid());
drop policy if exists nexa_conv_members_select on public.nexa_conversation_members;
create policy nexa_conv_members_select on public.nexa_conversation_members for select to authenticated using (
  public.nexa_is_moderator(auth.uid()) or user_id = auth.uid()
  or public.nexa_is_conversation_member(conversation_id, auth.uid()));
drop policy if exists nexa_conv_members_insert on public.nexa_conversation_members;
create policy nexa_conv_members_insert on public.nexa_conversation_members for insert to authenticated with check (
  user_id = auth.uid()
  or exists (select 1 from public.nexa_conversations c where c.id = conversation_id and c.created_by = auth.uid())
  or public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_messages_select on public.nexa_messages;
create policy nexa_messages_select on public.nexa_messages for select to authenticated using (
  public.nexa_is_moderator(auth.uid())
  or (public.nexa_is_conversation_member(conversation_id, auth.uid()) and (status = 'visible' or sender_id = auth.uid())));
drop policy if exists nexa_messages_insert on public.nexa_messages;
create policy nexa_messages_insert on public.nexa_messages for insert to authenticated with check (sender_id = auth.uid());
drop policy if exists nexa_messages_update on public.nexa_messages;
create policy nexa_messages_update on public.nexa_messages for update to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (true);

drop policy if exists nexa_media_select on public.nexa_media;
create policy nexa_media_select on public.nexa_media for select to authenticated
  using (owner_id = auth.uid() or status = 'approved' or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_media_insert on public.nexa_media;
create policy nexa_media_insert on public.nexa_media for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists nexa_media_update on public.nexa_media;
create policy nexa_media_update on public.nexa_media for update to authenticated
  using (public.nexa_is_moderator(auth.uid()) or owner_id = auth.uid()) with check (true);

drop policy if exists nexa_video_select on public.nexa_video_call_requests;
create policy nexa_video_select on public.nexa_video_call_requests for select to authenticated
  using (requester_id = auth.uid() or approver_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_video_insert on public.nexa_video_call_requests;
create policy nexa_video_insert on public.nexa_video_call_requests for insert to authenticated with check (requester_id = auth.uid());
drop policy if exists nexa_video_update on public.nexa_video_call_requests;
create policy nexa_video_update on public.nexa_video_call_requests for update to authenticated
  using (approver_id = auth.uid() or requester_id = auth.uid()) with check (true);

drop policy if exists nexa_communities_select on public.nexa_communities;
create policy nexa_communities_select on public.nexa_communities for select to authenticated
  using (age_group = public.nexa_age_group_of(auth.uid()) or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_communities_insert on public.nexa_communities;
create policy nexa_communities_insert on public.nexa_communities for insert to authenticated
  with check (created_by = auth.uid() and age_group = public.nexa_age_group_of(auth.uid()));
drop policy if exists nexa_communities_update on public.nexa_communities;
create policy nexa_communities_update on public.nexa_communities for update to authenticated
  using (created_by = auth.uid() or public.nexa_is_moderator(auth.uid())
    or exists (select 1 from public.nexa_community_members m where m.community_id = id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (true);
drop policy if exists nexa_comm_members_select on public.nexa_community_members;
create policy nexa_comm_members_select on public.nexa_community_members for select to authenticated using (true);
drop policy if exists nexa_comm_members_insert on public.nexa_community_members;
create policy nexa_comm_members_insert on public.nexa_community_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists nexa_comm_members_delete on public.nexa_community_members;
create policy nexa_comm_members_delete on public.nexa_community_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists nexa_comm_members_update on public.nexa_community_members;
create policy nexa_comm_members_update on public.nexa_community_members for update to authenticated
  using (public.nexa_is_moderator(auth.uid()) or exists (select 1 from public.nexa_community_members m
      where m.community_id = community_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (true);

drop policy if exists nexa_topics_select on public.nexa_topic_follows;
create policy nexa_topics_select on public.nexa_topic_follows for select to authenticated using (user_id = auth.uid());
drop policy if exists nexa_topics_write on public.nexa_topic_follows;
create policy nexa_topics_write on public.nexa_topic_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nexa_posts_select on public.nexa_posts;
create policy nexa_posts_select on public.nexa_posts for select to authenticated using (
  public.nexa_is_moderator(auth.uid()) or author_id = auth.uid()
  or (status = 'visible' and exists (select 1 from public.nexa_community_members cm
       where cm.community_id = community_id and cm.user_id = auth.uid())));
drop policy if exists nexa_posts_insert on public.nexa_posts;
create policy nexa_posts_insert on public.nexa_posts for insert to authenticated with check (author_id = auth.uid());
drop policy if exists nexa_posts_update on public.nexa_posts;
create policy nexa_posts_update on public.nexa_posts for update to authenticated
  using (public.nexa_is_moderator(auth.uid()) or author_id = auth.uid()
    or exists (select 1 from public.nexa_community_members m where m.community_id = community_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (true);

drop policy if exists nexa_comments_select on public.nexa_comments;
create policy nexa_comments_select on public.nexa_comments for select to authenticated using (
  public.nexa_is_moderator(auth.uid()) or status = 'visible' or author_id = auth.uid());
drop policy if exists nexa_comments_insert on public.nexa_comments;
create policy nexa_comments_insert on public.nexa_comments for insert to authenticated with check (author_id = auth.uid());
drop policy if exists nexa_reactions_select on public.nexa_reactions;
create policy nexa_reactions_select on public.nexa_reactions for select to authenticated using (true);
drop policy if exists nexa_reactions_write on public.nexa_reactions;
create policy nexa_reactions_write on public.nexa_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nexa_reports_select on public.nexa_reports;
create policy nexa_reports_select on public.nexa_reports for select to authenticated
  using (reporter_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_reports_insert on public.nexa_reports;
create policy nexa_reports_insert on public.nexa_reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists nexa_reports_update on public.nexa_reports;
create policy nexa_reports_update on public.nexa_reports for update to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (true);

drop policy if exists nexa_notifications_select on public.nexa_notifications;
create policy nexa_notifications_select on public.nexa_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists nexa_notifications_update on public.nexa_notifications;
create policy nexa_notifications_update on public.nexa_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists nexa_prefs_select on public.nexa_notification_preferences;
create policy nexa_prefs_select on public.nexa_notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists nexa_prefs_update on public.nexa_notification_preferences;
create policy nexa_prefs_update on public.nexa_notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nexa_moderators_select on public.nexa_moderators;
create policy nexa_moderators_select on public.nexa_moderators for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_audit_select on public.nexa_audit_logs;
create policy nexa_audit_select on public.nexa_audit_logs for select to authenticated
  using (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_audit_insert on public.nexa_audit_logs;
create policy nexa_audit_insert on public.nexa_audit_logs for insert to authenticated
  with check (public.nexa_is_moderator(auth.uid()) or actor_id = auth.uid());
drop policy if exists nexa_restrictions_select on public.nexa_account_restrictions;
create policy nexa_restrictions_select on public.nexa_account_restrictions for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_restrictions_insert on public.nexa_account_restrictions;
create policy nexa_restrictions_insert on public.nexa_account_restrictions for insert to authenticated
  with check (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_incidents_select on public.nexa_safety_incidents;
create policy nexa_incidents_select on public.nexa_safety_incidents for select to authenticated
  using (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_incidents_update on public.nexa_safety_incidents;
create policy nexa_incidents_update on public.nexa_safety_incidents for update to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (true);
drop policy if exists nexa_enforcement_select on public.nexa_enforcement_events;
create policy nexa_enforcement_select on public.nexa_enforcement_events for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_appeals_select on public.nexa_appeals;
create policy nexa_appeals_select on public.nexa_appeals for select to authenticated
  using (user_id = auth.uid() or public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_appeals_insert on public.nexa_appeals;
create policy nexa_appeals_insert on public.nexa_appeals for insert to authenticated with check (user_id = auth.uid());
drop policy if exists nexa_appeals_update on public.nexa_appeals;
create policy nexa_appeals_update on public.nexa_appeals for update to authenticated
  using (public.nexa_is_moderator(auth.uid())) with check (true);
drop policy if exists nexa_overrides_select on public.nexa_moderator_overrides;
create policy nexa_overrides_select on public.nexa_moderator_overrides for select to authenticated
  using (public.nexa_is_moderator(auth.uid()));
drop policy if exists nexa_overrides_insert on public.nexa_moderator_overrides;
create policy nexa_overrides_insert on public.nexa_moderator_overrides for insert to authenticated
  with check (public.nexa_is_moderator(auth.uid()));

-- NEXA_CHUNK_BREAK
-- =====================================================================
-- Realtime + private media storage
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['nexa_messages','nexa_notifications','nexa_posts','nexa_comments','nexa_connections','nexa_conversation_members','nexa_reactions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nexa-media','nexa-media',false,10485760,
        array['image/png','image/jpeg','image/webp','image/gif','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'])
on conflict (id) do nothing;

drop policy if exists nexa_storage_select on storage.objects;
create policy nexa_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'nexa-media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.nexa_is_moderator(auth.uid())
    or exists (select 1 from public.nexa_media m where m.bucket_path = name and m.status = 'approved')));
drop policy if exists nexa_storage_insert on storage.objects;
create policy nexa_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'nexa-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists nexa_storage_delete on storage.objects;
create policy nexa_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'nexa-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.nexa_is_moderator(auth.uid())));

-- =====================================================================
-- Seed: interests, config, policies, test cases, communities
-- =====================================================================
insert into public.nexa_interests (slug,label_sv,label_en,category,emoji) values
 ('gaming','Spel','Gaming','spel','🎮'),('music','Musik','Music','kultur','🎵'),
 ('football','Fotboll','Football','sport','⚽'),('nature','Natur','Nature','friluft','🌿'),
 ('tech','Teknik','Technology','teknik','💻'),('art','Konst','Art','kultur','🎨'),
 ('movies','Film','Movies','kultur','🎬'),('school','Skola','School','skola','📚'),
 ('dance','Dans','Dance','kultur','💃'),('books','Böcker','Books','kultur','📖'),
 ('baking','Bakning','Baking','skapande','🧁'),('photography','Foto','Photography','skapande','📷'),
 ('basketball','Basket','Basketball','sport','🏀'),('animals','Djur','Animals','friluft','🐾'),
 ('coding','Kodning','Coding','teknik','⌨️'),('fashion','Mode','Fashion','skapande','👟'),
 ('skiing','Skidor','Skiing','sport','⛷️'),('climate','Klimat','Climate','samhälle','🌍')
on conflict (slug) do nothing;

insert into public.nexa_config (key,value,description,sensitive) values
 ('demo_mode','true','Tydligt markerad demodrift: självdeklarerad ålder och demonstrativa användare.',false),
 ('age_verification_provider','{"name":"none","label":"Ingen extern leverantör (demo)","endpoint":"","status":"not_configured"}','Integritetsskyddande åldersverifiering. Kräver avtal med tredjepartsleverantör.',false),
 ('moderation_provider','{"name":"builtin","label":"NEXA inbyggda analysmotor","endpoint":"","status":"active"}','Extern AI-moderation (t.ex. OpenAI omni-moderation eller egen endpoint). Kräver API-nyckel.',false),
 ('vision_ocr_provider','{"name":"none","endpoint":"","status":"not_configured"}','OCR + bildanalys för uppladdade bilder. Kräver API-nyckel.',false),
 ('transcription_provider','{"name":"none","endpoint":"","status":"not_configured"}','Transkribering av röstmeddelanden. Kräver API-nyckel.',false),
 ('webrtc_provider','{"name":"none","endpoint":"","status":"not_configured"}','Hanterad WebRTC-leverantör för videosamtal.',false),
 ('video_calls_enabled','false','Videosamtal är avstängda tills säkerhetsarkitekturen är testad och juridiskt granskad.',false),
 ('romance_enabled','false','Romantiskt intresse för 15–17 år kräver juridisk och barnsäkerhetsgranskning.',false),
 ('legal_review_status','"not_reviewed"','GDPR/DSA och svensk rätt: juridisk granskning krävs före skarp lansering.',false),
 ('moderation_version','"1.0.0"','Aktiv version av säkerhetsmotorn.',false)
on conflict (key) do nothing;

insert into public.nexa_moderation_policies (key,category,severity,pattern,signal_type,description) values
 ('P-BULLY-01','bullying',3,'dum|idiot|loser|värdelös|fula|mobb','phrase','Kränkande tillmälen och mobbning.'),
 ('P-BULLY-02','bullying',4,'alla hatar dig|ingen vill ha dig|försvinn|skäms','phrase','Uteslutning och trakasserier.'),
 ('P-THREAT-01','threat',5,'döda|slå ihjäl|jag kommer och|hotar dig|kniv|hurt you|kill you','phrase','Hot och våld.'),
 ('P-HATE-01','hate',5,'neger|blatt|jävla invandrare|hata judar|nigger','phrase','Hets och diskriminerande tillmälen.'),
 ('P-SEX-01','sexual_harassment',5,'nakenbild|skicka naken|sexuellt|dick pic|röra vid dig|nude|send pics','phrase','Sexuella inviter och sexuellt innehåll.'),
 ('P-MINOR-SEX-01','sexual_minors',5,'träffas i hemlighet|håll det hemligt|säg inte till dina föräldrar|kom till mig|jag är äldre än jag sagt','phrase','Grooming-liknande beteende och hemlighetsmakeri kring möten.'),
 ('P-GROOM-01','grooming',5,'berätta inte för|gåva till dig|träffas ensam|hämta dig|don.t tell|keep it secret','phrase','Manipulativa mötesförfrågningar.'),
 ('P-PII-01','pii',4,'adress|hemadress|lösenord|personnummer|kortnummer|var bor du|vilken skola|skicka din plats|where do you live','phrase','Förfrågningar om privata uppgifter.'),
 ('P-EXT-01','external_platform',4,'snapchat|snap|instagram|tiktok|telegram|discord|whatsapp|kik|privat nummer|lägg till mig på','phrase','Försök att flytta minderåriga till osäkra externa plattformar.'),
 ('P-SCAM-01','scam',3,'gratis pengar|vinst|klicka här|crypto|gåva|betala i förskott|free money','phrase','Bedrägerier, spam och impersonering.'),
 ('P-DANGER-01','dangerous_challenge',4,'utmaning|svälj|hoppa från|håll andan|ta tabletter|challa|challenge','phrase','Farliga utmaningar och skadlig uppmuntran.'),
 ('P-EVADE-01','evasion',3,'skriv det baklänges|använd siffror|filtrera|moderering|censur|kom runt|bypass','phrase','Försök att kringgå säkerhetsrestriktioner.'),
 ('P-SPAM-01','spam',2,'(.)\1{6,}|https?://|www\.','regex','Upprepade tecken, länkar och automatiserat spam.'),
 ('P-CONTEXT-01','context',3,'du är äcklig|vad ska du göra med|var är du nu|är du ensam|are you alone','phrase','Kontextberoende misstänkta mönster.')
on conflict (key) do nothing;

insert into public.nexa_moderation_test_cases (label,language,text,expected_decision,expected_category,harmful,obfuscation_type) values
 ('Hälsning svenska','sv','Hej! Vill du spela fotboll i helgen?','ALLOW','none',false,'normal'),
 ('Hälsning engelska','en','Hey, do you want to join our gaming night?','ALLOW','none',false,'normal'),
 ('Harmlös liknande bokstav','sv','Vi åt glass i lördags, det var jättegott!','ALLOW','none',false,'false_friend'),
 ('Harmlös ordlek','sv','H-e-j allihopa! Ska vi baka?','ALLOW','none',false,'spacing'),
 ('Harmlös skolfråga','sv','Vilken läxa har vi i matte imorgon?','ALLOW','none',false,'normal'),
 ('Harmlös siffra','sv','Jag fyllde 3 i ett spel igår, haha','ALLOW','none',false,'leet'),
 ('Mobbning normal','sv','Du är en idiot och alla hatar dig','BLOCK','bullying',true,'normal'),
 ('Mobbning mellan bokstäver','sv','d u m i d i o t','BLOCK','bullying',true,'spacing'),
 ('Mobbning punktering','sv','d.u.m#i.d.i.o.t','BLOCK','bullying',true,'punctuation'),
 ('Mobbning leet','sv','1d10t','WARN','bullying',true,'leet'),
 ('Mobbning stavelser','sv','i-di-ot','WARN','bullying',true,'syllables'),
 ('Hot normalt','sv','Jag kommer och slår ihjäl dig imorgon','ESCALATE','threat',true,'normal'),
 ('Hot fonetiskt','sv','ja komr å slå ihjäl daj','ESCALATE','threat',true,'phonetic'),
 ('Hot engelska','en','im gonna hurt you after school','ESCALATE','threat',true,'normal'),
 ('Hets unicode','sv','n е g g е r','BLOCK','hate',true,'homoglyph'),
 ('Sexuell invit','sv','Skicka en nakenbild till mig','BLOCK','sexual_harassment',true,'normal'),
 ('Sexuell invit leet','sv','sk1ck4 n4k3nb1ld','BLOCK','sexual_harassment',true,'leet'),
 ('Grooming hemligt','sv','Träffas i hemlighet och säg inte till dina föräldrar','ESCALATE','grooming',true,'normal'),
 ('Grooming kontext','sv','Vi ses ensamma, berätta inte för någon','ESCALATE','grooming',true,'context'),
 ('Extern plattform','sv','Lägg till mig på snapchat istället','WARN','external_platform',true,'normal'),
 ('Extern plattform obfuskerad','sv','l ä g g  t i l l  m i g  p å  s n a p','WARN','external_platform',true,'spacing'),
 ('Privat info','sv','Vad har du för hemadress och personnummer?','BLOCK','pii',true,'normal'),
 ('Privat info fonetiskt','sv','var boor duu?','WARN','pii',true,'phonetic'),
 ('Bedrägeri','sv','Gratis pengar! Klicka här för att få din vinst','WARN','scam',true,'normal'),
 ('Farlig utmaning','sv','Hoppa från taket som en utmaning','BLOCK','dangerous_challenge',true,'normal'),
 ('Kringgående','sv','Skriv det baklänges så kommer du runt modereringen','WARN','evasion',true,'normal'),
 ('Spam upprepning','sv','hejhejhejhejhejhejhejhej','WARN','spam',true,'repeat'),
 ('Engelsk mobbning','en','you are such a loser, nobody likes you','BLOCK','bullying',true,'normal'),
 ('Engelskt hot med symboler','en','i.w.i.l.l.h.u.r.t.u','ESCALATE','threat',true,'punctuation'),
 ('Svensk-engelska kombination','mix','hey du är en loser, försvinn','BLOCK','bullying',true,'mixed_language'),
 ('Flerdelat meddelande 1','sv','Skriv första delen nu','ALLOW','none',false,'context'),
 ('Flerdelat meddelande 2','sv','och andra delen sen','ALLOW','none',false,'context'),
 ('Harmlös fråga om ålder','sv','Hur gammal är du? Vi är väl i samma grupp','ALLOW','none',false,'normal'),
 ('Harmlös emoji','sv','🎮⚽🎵 Ses i communityn!','ALLOW','none',false,'normal'),
 ('Harmlös länk till skola','sv','Kolla skolans hemsida för schemat','ALLOW','none',false,'false_friend'),
 ('Fonetisk harmlös','sv','de e gött å spela','ALLOW','none',false,'phonetic')
on conflict do nothing;

insert into public.nexa_communities (slug,name,description,topic,rules,accent,age_group) values
 ('gaming-13','Spelhörnan','Prata spel, dela tips och hitta co-op-vänner.','gaming','Var schysst, inga spoilers utan varning, dela aldrig privata uppgifter.','#873BFA','13-14'),
 ('musik-13','Musikrummet','Ny musik, spellistor och instrument.','music','Respektera andras smak och dela inte upphovsrättsskyddat material.','#B45CFF','13-14'),
 ('fotboll-13','Fotbollsplanen','Allt om fotboll, från Sunday league till VM.','football','Håll tonen schysst och heja på ditt lag utan att trycka ner andra.','#5B8CFF','13-14'),
 ('natur-13','Ut och utforska','Friluftsliv, djur och naturupptäckter.','nature','Dela aldrig exakta platser där du är ensam.','#3FCF8E','13-14'),
 ('teknik-13','Kod & prylar','Kodning, datorer och nya prylar.','tech','Dela inte lösenord, konton eller privat kod.','#FFB45C','13-14'),
 ('konst-13','Skaparverkstaden','Rita, måla och visa dina alster.','art','Ge konstruktiv feedback och respektera andras verk.','#FF6FA5','13-14'),
 ('film-13','Filmrutan','Filmer, serier och regissörer.','movies','Varning för spoilers, håll diskussionen åldersanpassad.','#9B7BFF','13-14'),
 ('skola-13','Plugghjälpen','Hjälp varandra med skolarbete.','school','Ge hints, inte färdiga svar. Inga privata skoluppgifter.','#D8B7FF','13-14'),
 ('gaming-15','Spelstudion','Gaming, turneringar och esports.','gaming','Schysst ton, inga privata konton i trådar.','#873BFA','15-17'),
 ('musik-15','Soundlab','Produktion, låtar och konserter.','music','Dela inte privat information om mötesplatser.','#B45CFF','15-17'),
 ('fotboll-15','Matchdag','Fotboll, analys och fantasy-lag.','football','Respektera motståndare och domare.','#5B8CFF','15-17'),
 ('teknik-15','Bygg & kod','Projekt, AI och hårdvara.','tech','Dela inte API-nycklar eller privat kod.','#FFB45C','15-17'),
 ('konst-15','Ateljén','Portfolio, design och feedback.','art','Konstruktiv kritik, inga privata bilder.','#FF6FA5','15-17'),
 ('klimat-15','Framtidsfrågor','Klimat, samhälle och engagemang.','climate','Källhänvisa och håll saklig ton.','#3FCF8E','15-17')
on conflict (slug) do nothing;

insert into public.nexa_profiles (id, username)
select u.id, 'user_' || replace(substr(u.id::text,1,8),'-','') from auth.users u
on conflict (id) do nothing;
insert into public.nexa_notification_preferences (user_id)
select u.id from auth.users u on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
