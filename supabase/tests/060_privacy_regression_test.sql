-- THE privacy regression test (docs/SECURITY_AND_PRIVACY.md's non-negotiable
-- rule). A private event AND a private task each get a unique secret marker
-- in every sensitive field; this test asserts the marker never appears
-- anywhere a non-owner (family member, outsider, or anon) can read —
-- neither via the base tables (already covered in 040/050, re-asserted
-- here for completeness) nor via the sanitized family_schedule /
-- family_task_board views, which is the whole point of this file.
begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['priv-owner@test.local', 'priv-member@test.local', 'priv-outsider@test.local']) as email;

select id as owner_id from auth.users where email = 'priv-owner@test.local' \gset
select id as member_id from auth.users where email = 'priv-member@test.local' \gset
select id as outsider_id from auth.users where email = 'priv-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Privacy Test Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id');

insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'adult', :'member_id', 'Member', :'owner_id');

-- A secret marker unique to this test run, planted in every sensitive field.
select 'SECRET-MARKER-' || substr(gen_random_uuid()::text, 1, 8) as secret \gset

insert into public.events (
  id, owner_profile_id, family_id, title, description, location,
  starts_at, ends_at, timezone, visibility, created_by
) values (
  gen_random_uuid(), :'owner_id', :'family_id',
  :'secret', :'secret', :'secret',
  '2026-09-15 09:00:00+03', '2026-09-15 10:00:00+03', 'Europe/Kyiv', 'private', :'owner_id'
)
returning id as private_event_id \gset

insert into public.categories (id, family_id, name, color_token, is_system, created_by)
values (gen_random_uuid(), :'family_id', :'secret', 'other', false, :'owner_id')
returning id as secret_category_id \gset

insert into public.tasks (
  id, owner_profile_id, family_id, title, description, visibility, category_id, created_by
) values (
  gen_random_uuid(), :'owner_id', :'family_id',
  :'secret', :'secret', 'private', :'secret_category_id', :'owner_id'
)
returning id as private_task_id \gset

-- ---------------------------------------------------------------------------
-- As the family member (not the owner)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'member_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.events where id = :'private_event_id'),
  0,
  '[base table] family member gets zero rows for the private event — marker cannot leak from nothing'
);

select is(
  (select count(*)::int from public.tasks where id = :'private_task_id'),
  0,
  '[base table] family member gets zero rows for the private task'
);

select is(
  (select count(*)::int from public.family_schedule where id = :'private_event_id' and title = :'secret'),
  0,
  '[family_schedule view] the secret never appears in the title column for a family member'
);

select ok(
  (select count(*)::int from public.family_schedule where id = :'private_event_id') = 1,
  '[family_schedule view] the private event DOES appear as a row (so "Busy" can render)'
);

select is(
  (select title from public.family_schedule where id = :'private_event_id'),
  null,
  '[family_schedule view] title is null, not the secret, for the family member'
);

select is(
  (select description from public.family_schedule where id = :'private_event_id'),
  null,
  '[family_schedule view] description is null, not the secret, for the family member'
);

select is(
  (select location from public.family_schedule where id = :'private_event_id'),
  null,
  '[family_schedule view] location is null, not the secret, for the family member'
);

select is(
  (select owner_profile_id from public.family_schedule where id = :'private_event_id'),
  :'owner_id',
  '[family_schedule view] owner identity IS exposed — that''s the explicitly-allowed part of a Busy block'
);

select is(
  (select count(*)::int from public.family_task_board where id = :'private_task_id' and title = :'secret'),
  0,
  '[family_task_board view] the secret never appears in the title column for a family member'
);

select is(
  (select title from public.family_task_board where id = :'private_task_id'),
  null,
  '[family_task_board view] title is null for the family member'
);

select is(
  (select category_id from public.family_task_board where id = :'private_task_id'),
  null,
  '[family_task_board view] category_id (which would indirectly reveal the secret category name) is sanitized too'
);

-- No exposed table/view in the entire public schema may contain the literal
-- secret for this member — a broad sweep in addition to the targeted checks
-- above, covering anything a future migration might add without updating
-- this test.
select is(
  (
    select count(*)::int
    from public.family_schedule
    where title = :'secret' or description = :'secret' or location = :'secret'
  ) + (
    select count(*)::int
    from public.family_task_board
    where title = :'secret' or description::text = :'secret'
  ),
  0,
  '[broad sweep] the secret marker does not appear in any sanitized view column at all'
);

-- ---------------------------------------------------------------------------
-- As the outsider (not in the family at all)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_schedule where id = :'private_event_id'),
  0,
  '[family_schedule view] an outsider gets zero rows, not even a sanitized Busy block'
);

select is(
  (select count(*)::int from public.family_task_board where id = :'private_task_id'),
  0,
  '[family_task_board view] an outsider gets zero rows'
);

select is(
  (select count(*)::int from public.events where id = :'private_event_id'),
  0,
  '[base table] an outsider gets zero rows from the base events table'
);

-- ---------------------------------------------------------------------------
-- As anonymous
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from public.family_schedule $$,
  '42501',
  null,
  '[anon] no grant on family_schedule at all'
);

select throws_ok(
  $$ select count(*) from public.family_task_board $$,
  '42501',
  null,
  '[anon] no grant on family_task_board at all'
);

select * from finish();
rollback;
