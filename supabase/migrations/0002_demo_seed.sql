-- Clearly marked DEMO data. Every demo account has is_demo = true and a
-- demo_ username; production must remove this seed.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','11111111-1111-4111-8111-111111111111','authenticated','authenticated','demo_alva@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
 ('00000000-0000-0000-0000-000000000000','22222222-2222-4222-8222-222222222222','authenticated','authenticated','demo_noah@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
 ('00000000-0000-0000-0000-000000000000','33333333-3333-4333-8333-333333333333','authenticated','authenticated','demo_mira@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
 ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-8444-444444444444','authenticated','authenticated','demo_elis@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
 ('00000000-0000-0000-0000-000000000000','55555555-5555-4555-8555-555555555555','authenticated','authenticated','demo_leo@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
 ('00000000-0000-0000-0000-000000000000','66666666-6666-4666-8666-666666666666','authenticated','authenticated','demo_saga@nexa.demo', extensions.crypt('Demo1234!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now())
on conflict (id) do nothing;

insert into public.nexa_notification_preferences (user_id)
select id from auth.users where email like 'demo_%@nexa.demo' on conflict (user_id) do nothing;

update public.nexa_profiles p set
  username = v.username, age = v.age, age_group = v.age_group, bio = v.bio,
  interests = v.interests, discoverable = true, show_online = true,
  onboarding_complete = true, is_demo = true,
  last_seen_at = now() - (v.minutes::text || ' minutes')::interval
from (values
 ('11111111-1111-4111-8111-111111111111','demo_alva',13,'13-14','Spelar fotboll och ritar. Letar efter nya kompisar! 🎨', array['football','art','music']::text[], 2),
 ('22222222-2222-4222-8222-222222222222','demo_noah',14,'13-14','Minecraft, kodning och allt som har med teknik att göra.', array['gaming','coding','tech']::text[], 8),
 ('33333333-3333-4333-8333-333333333333','demo_mira',13,'13-14','Musik, böcker och långa promenader i skogen. 🌿', array['music','books','nature']::text[], 1),
 ('44444444-4444-4444-8444-444444444444','demo_elis',15,'15-17','Fotograf och filmnörd. Startar gärna en ny spellista.', array['photography','movies','music']::text[], 4),
 ('55555555-5555-4555-8555-555555555555','demo_leo',16,'15-17','Bygger små spel och gillar esports. Hör av dig!', array['gaming','coding','tech']::text[], 3),
 ('66666666-6666-4666-8666-666666666666','demo_saga',17,'15-17','Klimatfrågor, konst och att baka till kompisar.', array['climate','art','baking']::text[], 12)
) as v(id, username, age, age_group, bio, interests, minutes)
where p.id = v.id::uuid;

insert into public.nexa_age_verifications (user_id, method, status, birth_date, age_group, age, identity_document_stored, biometric_data_stored)
select p.id, 'self_declared_demo', 'demo',
       make_date(extract(year from now())::int - p.age, 6, 15), p.age_group, p.age, false, false
from public.nexa_profiles p where p.is_demo = true
on conflict (user_id) do nothing;

insert into public.nexa_community_members (community_id, user_id, role)
select c.id, p.id, 'member' from public.nexa_communities c
join public.nexa_profiles p on p.age_group = c.age_group and p.is_demo = true
where c.slug in ('gaming-13','musik-13','fotboll-13','natur-13','konst-13','gaming-15','musik-15','teknik-15','konst-15','klimat-15')
on conflict do nothing;

insert into public.nexa_connections (requester_id, addressee_id, status)
values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','accepted'),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','accepted'),
 ('44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','accepted'),
 ('44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','accepted')
on conflict do nothing;

insert into public.nexa_conversations (id, kind, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','direct','11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;
insert into public.nexa_conversation_members (conversation_id, user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222')
on conflict do nothing;

-- Server-generated ALLOW decisions are required before any message can be inserted.
insert into public.nexa_moderation_decisions (id, user_id, content_hash, content_type, decision, category, confidence, explanation, recommended_action, provider)
values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001','11111111-1111-4111-8111-111111111111', public.nexa_sha256('Hej Noah! Ska vi spela fotboll på lördag?'), 'message','ALLOW','none',0.95,'Demodata: harmlös text analyserad av säkerhetsmotorn.','publicera','builtin-engine'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002','22222222-2222-4222-8222-222222222222', public.nexa_sha256('Absolut! Jag tar med bollen ⚽'), 'message','ALLOW','none',0.95,'Demodata: harmlös text analyserad av säkerhetsmotorn.','publicera','builtin-engine'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003','11111111-1111-4111-8111-111111111111', public.nexa_sha256('Vi ses vid parken vid tre!'), 'message','ALLOW','none',0.95,'Demodata: harmlös text analyserad av säkerhetsmotorn.','publicera','builtin-engine')
on conflict (id) do nothing;

insert into public.nexa_messages (id, conversation_id, sender_id, kind, body, content_hash, moderation_decision_id, created_at)
values
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','text','Hej Noah! Ska vi spela fotboll på lördag?', public.nexa_sha256('Hej Noah! Ska vi spela fotboll på lördag?'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001', now() - interval '50 minutes'),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','text','Absolut! Jag tar med bollen ⚽', public.nexa_sha256('Absolut! Jag tar med bollen ⚽'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', now() - interval '45 minutes'),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','text','Vi ses vid parken vid tre!', public.nexa_sha256('Vi ses vid parken vid tre!'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003', now() - interval '40 minutes')
on conflict (id) do nothing;

-- Community posts (also require real moderation decisions).
insert into public.nexa_moderation_decisions (id, user_id, content_hash, content_type, decision, category, confidence, explanation, recommended_action, provider)
values
 ('dddddddd-dddd-4ddd-8ddd-ddddddddd001','22222222-2222-4222-8222-222222222222', public.nexa_sha256('Någon som vill bygga en server tillsammans i helgen? 🎮'), 'post','ALLOW','none',0.95,'Demodata: harmlös text.','publicera','builtin-engine'),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddd002','33333333-3333-4333-8333-333333333333', public.nexa_sha256('Delade en ny spellista med lugn musik till pluggandet, tipsa gärna om fler!'), 'post','ALLOW','none',0.95,'Demodata: harmlös text.','publicera','builtin-engine'),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddd003','55555555-5555-4555-8555-555555555555', public.nexa_sha256('Har någon testat att bygga ett eget litet spel i Godot?'), 'post','ALLOW','none',0.95,'Demodata: harmlös text.','publicera','builtin-engine')
on conflict (id) do nothing;

insert into public.nexa_posts (id, community_id, author_id, body, content_hash, moderation_decision_id, created_at)
select ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee' || v.n)::uuid, c.id, v.author::uuid, v.body, public.nexa_sha256(v.body), v.dec::uuid, now() - (v.mins::text || ' minutes')::interval
from (values
 ('1','22222222-2222-4222-8222-222222222222','Någon som vill bygga en server tillsammans i helgen? 🎮','gaming-13','dddddddd-dddd-4ddd-8ddd-ddddddddd001',120),
 ('2','33333333-3333-4333-8333-333333333333','Delade en ny spellista med lugn musik till pluggandet, tipsa gärna om fler!','musik-13','dddddddd-dddd-4ddd-8ddd-ddddddddd002',90),
 ('3','55555555-5555-4555-8555-555555555555','Har någon testat att bygga ett eget litet spel i Godot?','gaming-15','dddddddd-dddd-4ddd-8ddd-ddddddddd003',60)
) as v(n, author, body, slug, dec, mins)
join public.nexa_communities c on c.slug = v.slug
on conflict (id) do nothing;

insert into public.nexa_reactions (post_id, user_id, emoji)
select p.id, u.id::uuid, '💜' from public.nexa_posts p
cross join (values ('11111111-1111-4111-8111-111111111111'),('44444444-4444-4444-8444-444444444444')) as u(id)
where p.id::text like 'eeeeeeee%' on conflict do nothing;
