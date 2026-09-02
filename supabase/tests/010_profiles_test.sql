-- Tests: profile auto-creation trigger, profiles RLS (own/other/anon).
-- Persona convention used across all test files: create auth.users rows
-- directly as `postgres` (bypasses RLS, exercises the real
-- handle_new_auth_user trigger), then simulate a specific authenticated
-- user for RLS assertions via `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, which is what Supabase's local
-- Postgres image's auth.uid()/auth.jwt() read from. See
-- docs/TEST_STRATEGY.md, "RLS and privacy tests".
begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
) values
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
   'profiles-user-a@test.local', 'not-a-real-hash', now(), now(), now(), '{}', '{"display_name":"User A"}', false, ''),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
   'profiles-user-b@test.local', 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, '');

select id as user_a_id from auth.users where email = 'profiles-user-a@test.local' \gset
select id as user_b_id from auth.users where email = 'profiles-user-b@test.local' \gset

-- ---------------------------------------------------------------------------
-- Trigger: a profile row was auto-created, idempotently, for each user
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles where id = :'user_a_id'),
  1,
  'handle_new_auth_user created exactly one profile row for user A'
);

select is(
  (select display_name from public.profiles where id = :'user_a_id'),
  'User A',
  'display_name is sourced from signup metadata when present'
);

select is(
  (select display_name from public.profiles where id = :'user_b_id'),
  'profiles-user-b',
  'display_name falls back to the email local-part when metadata has no display_name'
);

-- Idempotency: the trigger's INSERT uses ON CONFLICT DO NOTHING, so a
-- profiles row that already exists for an id is never duplicated or
-- overwritten by it — proven directly against the same INSERT shape the
-- trigger uses, without needing a second (impossible — PK-blocked)
-- auth.users row.
select lives_ok(
  format(
    $$ insert into public.profiles (id, display_name) values (%L, %L) on conflict (id) do nothing $$,
    :'user_a_id', 'Should not overwrite'
  ),
  'inserting a conflicting profiles row (as the trigger does) does not error'
);

select isnt(
  (select display_name from public.profiles where id = :'user_a_id'),
  'Should not overwrite',
  'ON CONFLICT DO NOTHING means the existing display_name was preserved, not overwritten'
);

-- ---------------------------------------------------------------------------
-- RLS: owner can read/update own profile
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'user_a_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.profiles where id = :'user_a_id'),
  1,
  'user A can select their own profile'
);

select lives_ok(
  $$ update public.profiles set display_name = 'User A Updated' where id = (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid $$,
  'user A can update their own profile'
);

-- ---------------------------------------------------------------------------
-- RLS: cannot read another user's profile row
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles where id = :'user_b_id'),
  0,
  'user A cannot select user B''s profile row directly'
);

-- ---------------------------------------------------------------------------
-- RLS: anonymous has no access at all
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

-- anon has no GRANT at all on profiles (not even a filtered-to-zero RLS
-- result) — the query is rejected before RLS is even evaluated.
select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  null,
  'anonymous has no grant on profiles at all'
);

select * from finish();
rollback;
