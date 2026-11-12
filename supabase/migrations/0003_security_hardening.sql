-- =====================================================================
-- 0003_security_hardening.sql
-- Fixes RLS column-shadowing bugs, tightens cross-age media/comment/reaction
-- isolation, enforces active account restrictions server-side, adds missing
-- RLS policies for decision overrides and notification preferences upsert,
-- and restricts media approval strictly to moderators / service_role.
-- =====================================================================

-- 1. Enforce active temporary/content restrictions on messages, posts, comments
create or replace function public.nexa_has_active_restriction(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select r.reason
  from public.nexa_account_restrictions r
  where r.user_id = uid
    and r.kind in ('temporary_restriction', 'content_restriction')
    and (r.expires_at is null or r.expires_at > now())
  order by r.created_at desc
  limit 1;
$$;

grant execute on function public.nexa_has_active_restriction(uuid) to authenticated, service_role;

create or replace function public.nexa_validate_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; g text; c10 int; c60 int; blocked_count int; restr text;
begin
  if auth.uid() is not null and new.sender_id <> auth.uid() then
    raise exception 'Avsändaren måste vara den inloggade användaren.';
  end if;
  restr := public.nexa_has_active_restriction(new.sender_id);
  if restr is not null then
    raise exception 'ACCOUNT_RESTRICTED: Ditt konto har en tillfällig begränsning (%). Du kan överklaga i Säkerhetscenter.', restr;
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

create or replace function public.nexa_validate_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; cg text; g text; restr text;
begin
  if auth.uid() is not null and new.author_id <> auth.uid() then raise exception 'Fel avsändare.'; end if;
  restr := public.nexa_has_active_restriction(new.author_id);
  if restr is not null then
    raise exception 'ACCOUNT_RESTRICTED: Ditt konto har en tillfällig begränsning (%).', restr;
  end if;
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

create or replace function public.nexa_validate_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; cg text; g text; restr text;
begin
  if auth.uid() is not null and new.author_id <> auth.uid() then raise exception 'Fel avsändare.'; end if;
  restr := public.nexa_has_active_restriction(new.author_id);
  if restr is not null then
    raise exception 'ACCOUNT_RESTRICTED: Ditt konto har en tillfällig begränsning (%).', restr;
  end if;
  select c.age_group into cg from public.nexa_communities c
    join public.nexa_posts p on p.community_id = c.id where p.id = new.post_id;
  g := public.nexa_age_group_of(new.author_id);
  if cg is null or g is null or cg <> g then raise exception 'AGE_SEPARATION.'; end if;
  d := public.nexa_check_moderation(new.moderation_decision_id, new.content_hash, new.author_id, 'comment');
  if d = 'HOLD_FOR_REVIEW' then new.status := 'held'; else new.status := 'visible'; end if;
  return new;
end;
$$;

-- 2. Strict RLS fixes: eliminate column shadowing and cross-age leaks
drop policy if exists nexa_communities_update on public.nexa_communities;
create policy nexa_communities_update on public.nexa_communities for update to authenticated
  using (
    created_by = auth.uid()
    or public.nexa_is_moderator(auth.uid())
    or exists (
      select 1 from public.nexa_community_members m
      where m.community_id = public.nexa_communities.id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (age_group = public.nexa_age_group_of(auth.uid()) or public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_comm_members_select on public.nexa_community_members;
create policy nexa_comm_members_select on public.nexa_community_members for select to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or user_id = auth.uid()
    or exists (
      select 1 from public.nexa_communities c
      where c.id = public.nexa_community_members.community_id
        and c.age_group = public.nexa_age_group_of(auth.uid())
    )
  );

drop policy if exists nexa_comm_members_update on public.nexa_community_members;
create policy nexa_comm_members_update on public.nexa_community_members for update to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or exists (
      select 1 from public.nexa_community_members m
      where m.community_id = public.nexa_community_members.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (true);

drop policy if exists nexa_posts_select on public.nexa_posts;
create policy nexa_posts_select on public.nexa_posts for select to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or author_id = auth.uid()
    or (
      status = 'visible'
      and not public.nexa_is_blocked(public.nexa_posts.author_id, auth.uid())
      and exists (
        select 1 from public.nexa_communities c
        where c.id = public.nexa_posts.community_id
          and c.age_group = public.nexa_age_group_of(auth.uid())
      )
    )
  );

drop policy if exists nexa_posts_update on public.nexa_posts;
create policy nexa_posts_update on public.nexa_posts for update to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or author_id = auth.uid()
    or exists (
      select 1 from public.nexa_community_members m
      where m.community_id = public.nexa_posts.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (true);

drop policy if exists nexa_comments_select on public.nexa_comments;
create policy nexa_comments_select on public.nexa_comments for select to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or author_id = auth.uid()
    or (
      status = 'visible'
      and not public.nexa_is_blocked(public.nexa_comments.author_id, auth.uid())
      and exists (
        select 1 from public.nexa_posts p
        join public.nexa_communities c on c.id = p.community_id
        where p.id = public.nexa_comments.post_id
          and c.age_group = public.nexa_age_group_of(auth.uid())
      )
    )
  );

drop policy if exists nexa_reactions_select on public.nexa_reactions;
create policy nexa_reactions_select on public.nexa_reactions for select to authenticated
  using (
    public.nexa_is_moderator(auth.uid())
    or user_id = auth.uid()
    or exists (
      select 1 from public.nexa_posts p
      join public.nexa_communities c on c.id = p.community_id
      where p.id = public.nexa_reactions.post_id
        and c.age_group = public.nexa_age_group_of(auth.uid())
    )
  );

-- 3. Tighten media select/update so owners cannot self-approve and media cannot cross age bands
drop policy if exists nexa_media_select on public.nexa_media;
create policy nexa_media_select on public.nexa_media for select to authenticated
  using (
    owner_id = auth.uid()
    or public.nexa_is_moderator(auth.uid())
    or (
      status = 'approved'
      and public.nexa_age_group_of(owner_id) = public.nexa_age_group_of(auth.uid())
      and not public.nexa_is_blocked(owner_id, auth.uid())
    )
  );

drop policy if exists nexa_media_update on public.nexa_media;
create policy nexa_media_update on public.nexa_media for update to authenticated
  using (public.nexa_is_moderator(auth.uid()))
  with check (public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_storage_select on storage.objects;
create policy nexa_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'nexa-media' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.nexa_is_moderator(auth.uid())
      or exists (
        select 1 from public.nexa_media m
        where m.bucket_path = storage.objects.name
          and m.status = 'approved'
          and public.nexa_age_group_of(m.owner_id) = public.nexa_age_group_of(auth.uid())
      )
    )
  );

-- 4. Missing policies for moderator decision overrides & notification preferences upsert
drop policy if exists nexa_decisions_update on public.nexa_moderation_decisions;
create policy nexa_decisions_update on public.nexa_moderation_decisions for update to authenticated
  using (public.nexa_is_moderator(auth.uid()))
  with check (public.nexa_is_moderator(auth.uid()));

drop policy if exists nexa_prefs_insert on public.nexa_notification_preferences;
create policy nexa_prefs_insert on public.nexa_notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

-- 5. Audit media updates as sensitive moderator actions
drop trigger if exists nexa_media_audit on public.nexa_media;
create trigger nexa_media_audit after update on public.nexa_media
  for each row execute function public.nexa_audit();

drop trigger if exists nexa_incidents_audit on public.nexa_safety_incidents;
create trigger nexa_incidents_audit after update on public.nexa_safety_incidents
  for each row execute function public.nexa_audit();

-- 6. Moderator bootstrap: allows first safety_lead when empty, or audited demo-mode testing
create or replace function public.nexa_bootstrap_moderator()
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n int;
  is_demo_env boolean := false;
begin
  if me is null then raise exception 'Inte inloggad.'; end if;
  if exists (select 1 from public.nexa_moderators where user_id = me) then
    return (select role from public.nexa_moderators where user_id = me);
  end if;
  select count(*) into n from public.nexa_moderators;
  select coalesce((value = 'true'::jsonb), false) into is_demo_env
    from public.nexa_config where key = 'demo_mode';
  if n > 0 and not is_demo_env then
    raise exception 'Moderatorer finns redan. Kontakta en administratör för att få rollen.';
  end if;
  insert into public.nexa_moderators (user_id, role)
  values (me, case when n = 0 then 'safety_lead' else 'moderator' end)
  on conflict (user_id) do nothing;
  insert into public.nexa_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (me, 'MODERATOR_ROLE_GRANTED', 'moderator', me::text,
    jsonb_build_object('demo_mode', is_demo_env, 'initial_bootstrap', n = 0));
  return case when n = 0 then 'safety_lead' else 'moderator' end;
end;
$$;

-- Seed demo_elis@nexa.demo (15-17 demo account) as a demo moderator so RBAC can be
-- tested immediately while demo_alva@nexa.demo remains a regular teen user.
insert into public.nexa_moderators (user_id, role, mfa_required)
values ('44444444-4444-4444-8444-444444444444', 'safety_lead', false)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
