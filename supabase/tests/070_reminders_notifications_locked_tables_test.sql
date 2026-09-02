-- Tests: reminders (owner-only, never shared even for a shared task),
-- notification_tokens (owner-only), recurrence_rules (fully locked down —
-- no direct client access at all this phase).
begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['rem-owner@test.local', 'rem-adult@test.local']) as email;

select id as owner_id from auth.users where email = 'rem-owner@test.local' \gset
select id as adult_id from auth.users where email = 'rem-adult@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Reminder Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id');
insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'adult', :'adult_id', 'Adult', :'owner_id');

insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Shared task with a reminder', 'family', :'owner_id')
returning id as shared_task_id \gset

insert into public.reminders (id, task_id, profile_id, remind_at)
values (gen_random_uuid(), :'shared_task_id', :'owner_id', now() + interval '1 hour')
returning id as reminder_id \gset

insert into public.notification_tokens (id, profile_id, expo_push_token, device_platform)
values (gen_random_uuid(), :'owner_id', 'ExponentPushToken[test-token-owner]', 'ios')
returning id as token_id \gset

insert into public.recurrence_rules (id, frequency, timezone, created_by)
values (gen_random_uuid(), 'weekly', 'Europe/Kyiv', :'owner_id')
returning id as recurrence_id \gset

-- ---------------------------------------------------------------------------
-- reminders: owner-only, even though the underlying task is family-visible
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.reminders where id = :'reminder_id'),
  1,
  'the owner can see their own reminder'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.reminders where task_id = :'shared_task_id'),
  0,
  'another family member cannot see the owner''s reminder on a shared task they can otherwise see'
);

select throws_ok(
  format(
    $$ insert into public.reminders (task_id, profile_id, remind_at) values (%L, %L, now()) $$,
    :'shared_task_id', :'owner_id'
  ),
  '42501',
  null,
  'another family member cannot create a reminder on the owner''s behalf either'
);

-- ---------------------------------------------------------------------------
-- notification_tokens: owner-only, never exposed to anyone else
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notification_tokens where profile_id = :'owner_id'),
  0,
  'a family member cannot see the owner''s push notification token'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.notification_tokens where id = :'token_id'),
  1,
  'the owner can see their own notification token'
);

-- ---------------------------------------------------------------------------
-- recurrence_rules: no direct access at all this phase (see that migration)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select count(*) from public.recurrence_rules $$,
  '42501',
  null,
  'an authenticated user (even the row''s creator) has zero direct grant on recurrence_rules'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select count(*) from public.recurrence_rules $$,
  '42501',
  null,
  'no authenticated user has direct access to recurrence_rules'
);

-- ---------------------------------------------------------------------------
-- anonymous
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from public.reminders $$,
  '42501',
  null,
  'anonymous has no grant on reminders at all'
);

select throws_ok(
  $$ select count(*) from public.notification_tokens $$,
  '42501',
  null,
  'anonymous has no grant on notification_tokens at all'
);

select * from finish();
rollback;
