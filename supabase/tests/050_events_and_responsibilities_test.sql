-- Tests: events / event_participants / responsibilities RLS + integrity.
-- Exercises the "Swimming — Son — drop_off:Mom / pick_up:Dad" example from
-- docs/PRODUCT.md directly.
begin;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'evt-mom@test.local', 'evt-dad@test.local', 'evt-outsider@test.local', 'evt-owner-d@test.local'
]) as email;

select id as mom_id from auth.users where email = 'evt-mom@test.local' \gset
select id as dad_id from auth.users where email = 'evt-dad@test.local' \gset
select id as outsider_id from auth.users where email = 'evt-outsider@test.local' \gset
select id as owner_d_id from auth.users where email = 'evt-owner-d@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Swim Family', :'mom_id', :'mom_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Family', :'owner_d_id', :'owner_d_id')
returning id as other_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'mom_id', 'Mom', :'mom_id')
returning id as mom_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'dad_id', 'Dad', :'mom_id')
returning id as dad_member_id \gset

insert into public.family_members (id, family_id, member_type, role, display_name, date_of_birth, created_by)
values (gen_random_uuid(), :'family_id', 'child', 'child', 'Son', '2019-05-01', :'mom_id')
returning id as son_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'other_family_id', 'adult', 'owner', :'owner_d_id', 'Owner D', :'owner_d_id')
returning id as owner_d_member_id \gset

-- ---------------------------------------------------------------------------
-- The worked example: one event, one participant, two responsibilities
-- ---------------------------------------------------------------------------
insert into public.events (id, owner_profile_id, family_id, title, starts_at, ends_at, timezone, visibility, created_by)
values (
  gen_random_uuid(), :'mom_id', :'family_id', 'Swimming',
  '2026-09-10 17:00:00+03', '2026-09-10 18:00:00+03', 'Europe/Kyiv', 'family', :'mom_id'
)
returning id as swim_event_id \gset

select lives_ok(
  format($$ insert into public.event_participants (event_id, family_member_id) values (%L, %L) $$, :'swim_event_id', :'son_member_id'),
  'Son can be recorded as the event''s participant'
);

select lives_ok(
  format(
    $$ insert into public.responsibilities (event_id, type, assignee_member_id, created_by) values (%L, 'drop_off', %L, %L) $$,
    :'swim_event_id', :'mom_member_id', :'mom_id'
  ),
  'drop-off responsibility can be assigned to Mom, as its own row'
);

select lives_ok(
  format(
    $$ insert into public.responsibilities (event_id, type, assignee_member_id, created_by) values (%L, 'pick_up', %L, %L) $$,
    :'swim_event_id', :'dad_member_id', :'mom_id'
  ),
  'pick-up responsibility can be assigned to Dad, as a *separate* row from drop-off'
);

select is(
  (select count(*)::int from public.responsibilities where event_id = :'swim_event_id'),
  2,
  'the event has exactly two responsibility rows — drop-off and pick-up are never merged'
);

select is(
  (select count(distinct type)::int from public.responsibilities where event_id = :'swim_event_id'),
  2,
  'drop_off and pick_up are distinct responsibility types, not fields on the event'
);

-- Editing the event itself never touches responsibilities (the core domain
-- rule): changing the event's title must not cascade into responsibility
-- rows at all.
update public.events set title = 'Swimming (rescheduled)' where id = :'swim_event_id';

select is(
  (select count(*)::int from public.responsibilities where event_id = :'swim_event_id'),
  2,
  'editing the event''s own fields leaves both responsibility rows completely untouched'
);

-- ---------------------------------------------------------------------------
-- Integrity: a responsibility cannot be assigned to a member of a different family
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.responsibilities (event_id, type, assignee_member_id, created_by) values (%L, 'supervise', %L, %L) $$,
    :'swim_event_id', :'owner_d_member_id', :'mom_id'
  ),
  '23503',
  null,
  'assigning a responsibility to a member of a different family violates the composite FK'
);

select throws_ok(
  format(
    $$ insert into public.responsibilities (event_id, type, label, created_by) values (%L, 'custom', null, %L) $$,
    :'swim_event_id', :'mom_id'
  ),
  '23514',
  null,
  'a custom-type responsibility without a label is rejected'
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'dad_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.events where id = :'swim_event_id'),
  1,
  'Dad (family member) can see the family-visible Swimming event'
);

select is(
  (select count(*)::int from public.responsibilities where event_id = :'swim_event_id'),
  2,
  'Dad can see both responsibility rows for the event'
);

select is(
  (select count(*)::int from public.event_participants where event_id = :'swim_event_id'),
  1,
  'Dad can see the event''s participant (Son)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.events where id = :'swim_event_id'),
  0,
  'an outsider sees nothing about the Swimming event'
);

select is(
  (select count(*)::int from public.responsibilities where event_id = :'swim_event_id'),
  0,
  'an outsider cannot see the responsibilities either (no source event to join through)'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from public.events $$,
  '42501',
  null,
  'anonymous has no grant on events at all'
);

select throws_ok(
  $$ select count(*) from public.responsibilities $$,
  '42501',
  null,
  'anonymous has no grant on responsibilities at all'
);

select * from finish();
rollback;
