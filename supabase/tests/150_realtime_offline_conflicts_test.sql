-- Tests: Phase 9 — Realtime Broadcast Authorization on realtime.messages
-- (profile/family topic RLS, malformed-topic/anon/outsider/removed-member
-- denial, generic content-free payloads), offline-queue idempotency
-- (client_operation_id replay, cross-user isolation, stale-write 40001),
-- and list_family_conflicts (all 8 conflict categories, privacy
-- redaction of another member's private entities, outsider rejection).
begin;
select plan(47);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'rt9-owner@test.local', 'rt9-spouse@test.local', 'rt9-child-guardian@test.local',
  'rt9-outsider@test.local', 'rt9-removed@test.local'
]) as email;

select id as owner_id from auth.users where email = 'rt9-owner@test.local' \gset
select id as spouse_id from auth.users where email = 'rt9-spouse@test.local' \gset
select id as outsider_id from auth.users where email = 'rt9-outsider@test.local' \gset
select id as removed_id from auth.users where email = 'rt9-removed@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Phase 9 Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'spouse_id', 'Spouse', :'owner_id')
returning id as spouse_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, removed_at, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'removed_id', 'Removed', now(), :'owner_id')
returning id as removed_member_id \gset

-- ---------------------------------------------------------------------------
-- Realtime Broadcast Authorization on realtime.messages.
--
-- realtime.topic() reads the `realtime.topic` GUC, which the *real*
-- Realtime server sets per subscription attempt before evaluating these
-- policies — simulated here the same way, via set_config, matching
-- exactly how the real WebSocket authorization flow drives this table's
-- RLS (confirmed by direct testing before writing these assertions; a
-- plain SELECT with no `realtime.topic` set evaluates every policy to
-- false, which would have made every assertion below trivially pass for
-- the wrong reason).
-- ---------------------------------------------------------------------------

insert into realtime.messages (topic, extension, event, payload, private)
values
  ('profile:' || :'owner_id', 'broadcast', 'invalidate', '{"version":1,"scope":"profile","entity":"tasks","operation":"changed"}', true),
  ('profile:' || :'spouse_id', 'broadcast', 'invalidate', '{"version":1,"scope":"profile","entity":"tasks","operation":"changed"}', true),
  ('family:' || :'family_id', 'broadcast', 'invalidate', '{"version":1,"scope":"family","entity":"tasks","operation":"changed"}', true),
  ('family:00000000-0000-0000-0000-000000000000', 'broadcast', 'invalidate', '{"version":1,"scope":"family","entity":"tasks","operation":"changed"}', true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- Scoped to entity='tasks' (this test's own marker) throughout, since the
-- real family_members inserts above already fired real entity='members'
-- broadcasts to some of these same topics — counting all entities would
-- conflate "RLS lets this row through" with "how many rows happen to
-- exist," which isn't what these assertions are checking.
select set_config('realtime.topic', 'profile:' || :'owner_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'profile:' || :'owner_id' and payload->>'entity' = 'tasks'),
  1,
  'owner can read their own profile topic'
);

select set_config('realtime.topic', 'profile:' || :'spouse_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'profile:' || :'spouse_id'),
  0,
  'owner cannot read another profile''s topic'
);

select set_config('realtime.topic', 'family:' || :'family_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:' || :'family_id' and payload->>'entity' = 'tasks'),
  1,
  'an active family member can read their family topic'
);

select set_config('realtime.topic', 'family:00000000-0000-0000-0000-000000000000', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:00000000-0000-0000-0000-000000000000'),
  0,
  'a family member cannot read an unrelated family topic'
);

-- Outsider (no membership anywhere) denied on both topic kinds.
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);
select set_config('realtime.topic', 'family:' || :'family_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:' || :'family_id'),
  0,
  'an outsider cannot read a family topic they do not belong to'
);
select set_config('realtime.topic', 'profile:' || :'owner_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'profile:' || :'owner_id'),
  0,
  'an outsider cannot read another profile''s topic'
);

-- A removed member cannot open a *new* subscription — the same
-- is_family_member() check every other family-scoped policy uses already
-- filters removed_at is null.
select set_config('request.jwt.claims', json_build_object('sub', :'removed_id', 'role', 'authenticated')::text, true);
select set_config('realtime.topic', 'family:' || :'family_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:' || :'family_id'),
  0,
  'a removed member cannot create a new subscription to their former family topic'
);

-- Malformed topics fail closed, never error.
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
select set_config('realtime.topic', 'family:not-a-uuid', true);
select lives_ok(
  $$ select count(*) from realtime.messages where topic = 'family:not-a-uuid' $$,
  'a malformed family topic never raises'
);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:not-a-uuid'),
  0,
  'a malformed family topic denies access rather than erroring'
);
select set_config('realtime.topic', 'profile:not-a-uuid', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'profile:not-a-uuid'),
  0,
  'a malformed profile topic denies access rather than erroring'
);
select set_config('realtime.topic', 'unrelated:' || :'owner_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'unrelated:' || :'owner_id'),
  0,
  'an unrecognized topic prefix is denied'
);

reset role;

-- anon is denied outright — no policy targets anon at all.
set local role anon;
select set_config('realtime.topic', 'profile:' || :'owner_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'profile:' || :'owner_id'),
  0,
  'anon cannot read a profile topic'
);
select set_config('realtime.topic', 'family:' || :'family_id', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'family:' || :'family_id'),
  0,
  'anon cannot read a family topic'
);
reset role;

-- No client INSERT/send permission on realtime.messages at all.
select throws_ok(
  $$ set local role authenticated; insert into realtime.messages (topic, extension, event, payload) values ('profile:x', 'broadcast', 'invalidate', '{}') $$,
  '42501',
  null,
  'authenticated cannot INSERT into realtime.messages directly'
);
select throws_ok(
  $$ set local role anon; insert into realtime.messages (topic, extension, event, payload) values ('profile:x', 'broadcast', 'invalidate', '{}') $$,
  '42501',
  null,
  'anon cannot INSERT into realtime.messages directly'
);

-- ---------------------------------------------------------------------------
-- Broadcast payloads are generic — never row content — verified against
-- the *real* trigger-fired rows from the family setup above (family_members
-- inserts above already fired broadcast_family_member_change for real).
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from realtime.messages
    where payload::text ilike '%Owner%' or payload::text ilike '%Spouse%' or payload::text ilike '%Removed%'
  ),
  'no broadcast payload ever contains a family member''s display name'
);
select ok(
  (select bool_and(payload ?& array['version','scope','entity','operation'])
   from realtime.messages where topic like 'profile:%' or topic like 'family:%'),
  'every generated invalidation payload carries exactly the documented generic keys (plus realtime.send''s own message id)'
);

-- ---------------------------------------------------------------------------
-- Offline-queue idempotency: create replay, cross-user isolation.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_task(
  p_title := 'Offline-created task',
  p_client_operation_id := '99999999-9999-9999-9999-999999999901'
) as create_first_id \gset

select public.create_personal_task(
  p_title := 'Offline-created task (replay)',
  p_client_operation_id := '99999999-9999-9999-9999-999999999901'
) as create_replay_id \gset

select is(:'create_first_id'::text, :'create_replay_id'::text, 'replaying the same client_operation_id returns the original task id');
select is(
  (select count(*)::int from public.tasks where client_operation_id = '99999999-9999-9999-9999-999999999901'),
  1,
  'replaying the same client_operation_id never creates a second row'
);

-- Cross-user isolation: the *same* client_operation_id from a different
-- profile is a distinct operation, not a collision (the unique index is
-- scoped per owner_profile_id).
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select public.create_personal_task(
  p_title := 'Spouse''s own offline task',
  p_client_operation_id := '99999999-9999-9999-9999-999999999901'
) as spouse_create_id \gset
select isnt(:'create_first_id'::text, :'spouse_create_id'::text, 'the same client_operation_id from a different profile creates a distinct task, not a cross-user collision');

-- ---------------------------------------------------------------------------
-- Stale-write detection (update + schedule).
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
select updated_at from public.tasks where id = :'create_first_id' \gset original_

select lives_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Fresh edit', p_expected_updated_at := %L::timestamptz) $$, :'create_first_id', :'original_updated_at'),
  'update_personal_task succeeds when p_expected_updated_at matches the current row'
);

-- now() is frozen for the lifetime of this whole test's enclosing
-- transaction (a real, worth-recording Postgres semantic — see
-- docs/DECISIONS.md, "Phase 9"), so a second RPC call within the same
-- transaction can never observe updated_at having actually advanced.
-- Simulating "changed on another device" instead means directly forcing
-- a distinguishable updated_at (as postgres, bypassing RLS, standing in
-- for a real concurrent commit from elsewhere) rather than relying on
-- wall-clock progression this test transaction will never see.
-- set_tasks_updated_at (BEFORE UPDATE) unconditionally overwrites
-- updated_at with now() on every UPDATE, which would silently clobber the
-- explicit value below right back to the same frozen timestamp — disabled
-- for just this one simulated-concurrent-write, matching a real
-- already-committed change from elsewhere.
set local role postgres;
alter table public.tasks disable trigger set_tasks_updated_at;
update public.tasks set updated_at = :'original_updated_at'::timestamptz + interval '1 minute'
where id = :'create_first_id'
returning updated_at \gset bumped_
alter table public.tasks enable trigger set_tasks_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Stale edit', p_expected_updated_at := %L::timestamptz) $$, :'create_first_id', :'original_updated_at'),
  '40001',
  null,
  'update_personal_task raises 40001 when p_expected_updated_at no longer matches (stale offline snapshot)'
);
select lives_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Correctly-based edit', p_expected_updated_at := %L::timestamptz) $$, :'create_first_id', :'bumped_updated_at'),
  'update_personal_task succeeds again once p_expected_updated_at is based on the row''s real current value'
);

select public.create_personal_task(p_title := 'Schedule stale-write test') as sched_task_id \gset
select updated_at from public.tasks where id = :'sched_task_id' \gset sched_

set local role postgres;
alter table public.tasks disable trigger set_tasks_updated_at;
update public.tasks set updated_at = :'sched_updated_at'::timestamptz + interval '1 minute'
where id = :'sched_task_id';
alter table public.tasks enable trigger set_tasks_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.schedule_personal_task(%L, '2026-11-02', p_expected_updated_at := %L::timestamptz) $$, :'sched_task_id', :'sched_updated_at'),
  '40001',
  null,
  'schedule_personal_task raises 40001 when p_expected_updated_at no longer matches'
);
select updated_at from public.tasks where id = :'sched_task_id' \gset resched_
select lives_ok(
  format($$ select public.schedule_personal_task(%L, '2026-11-03', p_expected_updated_at := %L::timestamptz) $$, :'sched_task_id', :'resched_updated_at'),
  'schedule_personal_task succeeds when p_expected_updated_at is based on the row''s real current value'
);

-- Omitting p_expected_updated_at (every online edit) still applies
-- unconditionally, exactly as before this phase.
select lives_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Online edit, no precondition') $$, :'create_first_id'),
  'update_personal_task with no p_expected_updated_at still applies unconditionally (online-edit behavior unchanged)'
);

-- A permanent authorization failure never involves 40001 — a genuinely
-- different, non-retryable error class. Switches to a different profile
-- first — this must fail on ownership grounds, not because the caller
-- already owns the row.
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.update_personal_task(%L, p_title := 'not mine') $$, :'sched_task_id'),
  '42501',
  null,
  'updating another profile''s task still raises 42501 (unrelated to stale-write handling)'
) ;

-- ---------------------------------------------------------------------------
-- list_family_conflicts: outsider rejection, then all 8 conflict categories.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select * from public.list_family_conflicts(%L, '2026-01-01'::timestamptz, '2027-01-01'::timestamptz) $$, :'family_id'),
  '42501',
  null,
  'an outsider cannot call list_family_conflicts for a family they do not belong to'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- 1. event x event, same member.
select public.create_personal_event('Event A', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'UTC', p_visibility := 'private', p_family_id := :'family_id') as evt_a \gset
select public.create_personal_event('Event B', '2026-10-05T10:30:00Z', '2026-10-05T11:30:00Z', 'UTC', p_visibility := 'private', p_family_id := :'family_id') as evt_b \gset

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event'),
  1,
  'type 1 (event x event, same member) is detected'
);

-- Sanitization: the owner (who owns both private events) sees navigable ids...
select is(
  (select primary_entity_id is not null from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event' limit 1),
  true,
  'the owner of both private events sees navigable entity ids for their own event_event conflict'
);
-- ...but the spouse (a different member) sees the conflict exists, with the type/member/time, and no navigable id into either private event.
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event'),
  1,
  'a different family member still sees that the event_event conflict exists'
);
select is(
  (select primary_entity_id from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event' limit 1),
  null,
  'a different family member never receives a navigable id into another member''s private event'
);
select is(
  (select safe_message_code from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event' limit 1),
  'conflicts.event_event',
  'the safe_message_code is a generic translation key, never event content'
);
select ok(
  (select safe_message_params::text from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event' limit 1) not ilike '%Event A%'
  and (select safe_message_params::text from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'event_event' limit 1) not ilike '%Event B%',
  'safe_message_params never contains either event''s title'
);

select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- 2. task x event, same member.
select public.create_personal_task('Timed task', p_date := '2026-10-06', p_start_time := '09:00', p_duration_minutes := 45, p_timezone := 'UTC') as t2_task \gset
select public.create_personal_event('Event C', '2026-10-06T09:30:00Z', '2026-10-06T10:00:00Z', 'UTC', p_visibility := 'private', p_family_id := :'family_id') as t2_evt \gset
select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'task_event'),
  1,
  'type 2 (timed task x event, same member) is detected'
);

-- 3. task x task, same member.
select public.create_personal_task('Task X', p_date := '2026-10-07', p_start_time := '14:00', p_duration_minutes := 60, p_timezone := 'UTC') as t3_a \gset
select public.create_personal_task('Task Y', p_date := '2026-10-07', p_start_time := '14:30', p_duration_minutes := 60, p_timezone := 'UTC') as t3_b \gset
select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'task_task'),
  1,
  'type 3 (timed task x timed task, same member) is detected'
);

-- 6. Unassigned/declined drop-off. No exposed RPC creates a bare,
-- never-assigned responsibility row directly (create_bare_responsibility
-- is an internal-only helper create_child_event calls only when an
-- assignee is given) — the only externally-reachable "needs attention"
-- state is assign-then-decline, which list_family_conflicts' own
-- `status in ('unassigned', 'declined')` check already treats
-- identically to a still-unassigned row.
select public.create_child_profile(:'family_id', 'Kid') as child_member_id \gset
select public.create_child_event(
  :'family_id', :'child_member_id', 'Practice', '2026-10-08T15:00:00Z', '2026-10-08T16:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'spouse_member_id'
) as c_evt \gset
select id as unassigned_dropoff_id from public.responsibilities where event_id = :'c_evt' and type = 'drop_off' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select public.decline_event_responsibility(:'unassigned_dropoff_id');
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'unassigned_dropoff_pickup'),
  1,
  'type 6 (unassigned drop-off/pick-up) is detected'
);
-- Both adults (owner, spouse) are free at that time, so this is NOT also
-- an escalated "no available adult" conflict.
select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'no_available_adult'),
  0,
  'type 7 does not fire when at least one adult is actually free'
);

-- 7. No available adult — its own dedicated window (17:00-18:00),
-- separate from type 6's (15:00-16:00), so the two scenarios' events
-- never overlap each other and contaminate each other's counts. A
-- dedicated still-unassigned/declined responsibility, plus both adults
-- independently busy via their own separate accepted responsibilities in
-- that same window.
-- Self-assignment (assignee = the creating member) auto-collapses straight
-- to 'accepted' (see set_responsibility_assignment's own CASE — the same
-- pattern established for task self-claim) — no separate accept call
-- needed, and one would fail ("no longer valid") since it's not left in
-- pending_acceptance to begin with.
select public.create_child_event(
  :'family_id', :'child_member_id', 'Type7 needs a ride', '2026-10-08T17:00:00Z', '2026-10-08T18:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'spouse_member_id'
) as type7_evt \gset
select id as type7_resp from public.responsibilities where event_id = :'type7_evt' and type = 'drop_off' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select public.decline_event_responsibility(:'type7_resp');
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'no_available_adult'),
  0,
  'type 7 does not fire when at least one adult is actually free'
);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Owner busy (type 7)', '2026-10-08T17:00:00Z', '2026-10-08T18:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'owner_member_id'
) as busy_evt_owner \gset

select public.create_child_event(
  :'family_id', :'child_member_id', 'Spouse busy (type 7)', '2026-10-08T17:00:00Z', '2026-10-08T18:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'spouse_member_id'
) as busy_evt_spouse \gset
select id as spouse_busy_resp from public.responsibilities where event_id = :'busy_evt_spouse' and type = 'drop_off' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'spouse_id', 'role', 'authenticated')::text, true);
select public.accept_event_responsibility(:'spouse_busy_resp');
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'no_available_adult'),
  1,
  'type 7 (no available active adult) fires once every adult is accounted-for busy'
);
select is(
  (select severity from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'no_available_adult' limit 1),
  'critical',
  'type 7 is reported at critical severity, strictly worse than the plain unassigned case'
);

-- 4. responsibility_busy — its own dedicated window (19:00-20:00). The
-- owner's accepted drop-off overlaps their own separately-scheduled
-- personal event.
select public.create_child_event(
  :'family_id', :'child_member_id', 'Type4 pickup', '2026-10-08T19:00:00Z', '2026-10-08T20:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'owner_member_id'
) as type4_evt \gset
select public.create_personal_event('Owner personal clash', '2026-10-08T19:15:00Z', '2026-10-08T19:45:00Z', 'UTC', p_visibility := 'private', p_family_id := :'family_id') as busy_personal_evt \gset
-- Narrowed to this scenario's own window: by this point the family also
-- has an unrelated owner-accepted responsibility at 17:00-18:00 (type 7's
-- setup above) which, since every child event in this test is created by
-- the same "owner" profile, itself owns *every* child event record —
-- realistic (one parent typically enters the family calendar) but means a
-- family-wide query at this point in the test also picks that up. A
-- window scoped to exactly this scenario's own hour isolates it.
select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-08T19:00:00Z'::timestamptz, '2026-10-08T20:00:00Z'::timestamptz) where type = 'responsibility_busy' and member_id = :'owner_member_id'),
  1,
  'type 4 (accepted responsibility overlaps the assignee''s own other commitment) is detected'
);

-- 5. responsibility_responsibility — its own dedicated window
-- (21:00-22:00). The owner accepts two distinct child events' drop-offs
-- at the same time.
select public.create_child_event(
  :'family_id', :'child_member_id', 'Type5 first pickup', '2026-10-08T21:00:00Z', '2026-10-08T22:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'owner_member_id'
) as type5_evt_a \gset
select public.create_child_event(
  :'family_id', :'child_member_id', 'Type5 second pickup', '2026-10-08T21:00:00Z', '2026-10-08T22:00:00Z', 'UTC',
  p_drop_off_assignee_member_id := :'owner_member_id'
) as type5_evt_b \gset

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) where type = 'responsibility_responsibility'),
  1,
  'type 5 (two accepted responsibilities require the same adult simultaneously) is detected'
);

-- 8. Recurring occurrence creates a real overlap — folded into task_task
-- via member_timed_items, not a separate code path (see the migration's
-- own comment).
select public.create_recurring_personal_task(
  'Daily standup', '2026-10-09', 'UTC', 'daily',
  p_start_time := '09:00', p_duration_minutes := 30
) as recurring_task_id \gset
select public.generate_task_occurrences('2026-10-09');
select public.create_personal_task('Clashes with standup', p_date := '2026-10-09', p_start_time := '09:15', p_duration_minutes := 30, p_timezone := 'UTC') as occ_clash_task \gset

select is(
  (select count(*)::int from public.list_family_conflicts(:'family_id', '2026-10-09'::timestamptz, '2026-10-10'::timestamptz) where type = 'task_task'),
  1,
  'type 8 (recurring occurrence overlaps a timed task) is detected via the shared task_task path'
);

-- conflict_id stability: calling the function twice for the same window
-- with no data change returns the identical set of ids (dedupable by the
-- client across refetches).
select is(
  (select array_agg(conflict_id order by conflict_id) from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz)),
  (select array_agg(conflict_id order by conflict_id) from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz)),
  'conflict_id is stable/deterministic across repeated calls with unchanged data'
);

-- ---------------------------------------------------------------------------
-- Secret-marker sweep: no title/description ever appears in a broadcast
-- payload or a conflict row, across everything created this test.
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1 from realtime.messages
    where payload::text ilike any (array[
      '%Offline-created%', '%Event A%', '%Event B%', '%Event C%', '%Timed task%',
      '%Task X%', '%Task Y%', '%Practice%', '%Daily standup%', '%Sibling event%'
    ])
  ),
  'secret-marker sweep: no broadcast payload generated in this test contains any task/event title'
);
select ok(
  not exists (
    select 1 from public.list_family_conflicts(:'family_id', '2026-10-01'::timestamptz, '2026-10-10'::timestamptz) c
    where c.safe_message_params::text ilike any (array[
      '%Offline-created%', '%Event A%', '%Event B%', '%Event C%', '%Timed task%',
      '%Task X%', '%Task Y%', '%Practice%', '%Daily standup%', '%Sibling event%'
    ])
  ),
  'secret-marker sweep: no conflict row''s safe_message_params contains any task/event title'
);

select * from finish();
rollback;
