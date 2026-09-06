-- Tests: the Phase 6 notification outbox — event/recipient derivation for
-- assignment_requested/accepted/declined/taken, no self-notification, no
-- event for a removed member, disabled-preference suppression,
-- deduplication, RPC-replay safety, the notifications schema's total
-- inaccessibility to any client role, and notification_tokens/
-- notification_preferences ownership isolation (extending the read-only
-- isolation already covered in 070 with UPDATE/DELETE isolation and the
-- new deactivation lifecycle).
begin;
select plan(30);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'notif-owner@test.local', 'notif-adultb@test.local', 'notif-adultc@test.local', 'notif-outsider@test.local'
]) as email;

select id as owner_id from auth.users where email = 'notif-owner@test.local' \gset
select id as adultb_id from auth.users where email = 'notif-adultb@test.local' \gset
select id as adultc_id from auth.users where email = 'notif-adultc@test.local' \gset
select id as outsider_id from auth.users where email = 'notif-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Notif Outbox Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset
insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adultb_id', 'Adult B', :'owner_id')
returning id as adultb_member_id \gset
insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adultc_id', 'Adult C', :'owner_id')
returning id as adultc_member_id \gset

-- ---------------------------------------------------------------------------
-- Fixture tasks, created directly (bypassing RPCs, as postgres) so each
-- scenario below can drive its own task_assignments inserts precisely.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 1 - assign/accept', 'family', :'owner_id')
returning id as task1_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 2 - assign/decline', 'family', :'owner_id')
returning id as task2_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 3 - taken by adultB', 'family', :'owner_id')
returning id as task3_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 4 - self take by owner', 'family', :'owner_id')
returning id as task4_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'adultc_id', :'family_id', 'Task 5 - created by adultC, taken after removal', 'family', :'adultc_id')
returning id as task5_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 6 - disabled preference', 'family', :'owner_id')
returning id as task6_id \gset
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_id', :'family_id', 'Task 7 - dedup/replay', 'family', :'owner_id')
returning id as task7_id \gset

-- ---------------------------------------------------------------------------
-- 1) assignment_requested: owner assigns task 1 to adultB
-- ---------------------------------------------------------------------------
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task1_id', :'adultb_member_id', :'owner_member_id', 'assigned');

select results_eq(
  format($$ select event_type, actor_member_id, recipient_member_id from notifications.outbox where task_id = %L $$, :'task1_id'),
  format($$ values (%L::text, %L::uuid, %L::uuid) $$, 'family_task.assignment_requested.v1', :'owner_member_id', :'adultb_member_id'),
  'assigning task 1 enqueues assignment_requested.v1, actor=owner, recipient=adultB'
);

-- ---------------------------------------------------------------------------
-- 2) assignment_accepted: adultB accepts task 1 -> owner is recipient
-- ---------------------------------------------------------------------------
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task1_id', :'adultb_member_id', null, 'accepted');

select results_eq(
  format($$ select event_type, actor_member_id, recipient_member_id from notifications.outbox where task_id = %L and event_type = 'family_task.assignment_accepted.v1' $$, :'task1_id'),
  format($$ values (%L::text, %L::uuid, %L::uuid) $$, 'family_task.assignment_accepted.v1', :'adultb_member_id', :'owner_member_id'),
  'adultB accepting task 1 enqueues assignment_accepted.v1, actor=adultB, recipient=owner (the original assigner)'
);

select is(
  (select count(*)::int from notifications.outbox where task_id = :'task1_id'),
  2,
  'task 1 has exactly two outbox rows total (requested + accepted), not more'
);

-- ---------------------------------------------------------------------------
-- 3) assignment_declined: owner assigns task 2 to adultB, adultB declines
-- ---------------------------------------------------------------------------
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task2_id', :'adultb_member_id', :'owner_member_id', 'assigned');
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task2_id', :'adultb_member_id', null, 'declined');

select results_eq(
  format($$ select event_type, actor_member_id, recipient_member_id from notifications.outbox where task_id = %L and event_type = 'family_task.assignment_declined.v1' $$, :'task2_id'),
  format($$ values (%L::text, %L::uuid, %L::uuid) $$, 'family_task.assignment_declined.v1', :'adultb_member_id', :'owner_member_id'),
  'adultB declining task 2 enqueues assignment_declined.v1, actor=adultB, recipient=owner'
);

-- ---------------------------------------------------------------------------
-- 4) assignment_taken: adultB takes unassigned task 3 (created by owner)
-- ---------------------------------------------------------------------------
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task3_id', :'adultb_member_id', null, 'took');

select results_eq(
  format($$ select event_type, actor_member_id, recipient_member_id from notifications.outbox where task_id = %L $$, :'task3_id'),
  format($$ values (%L::text, %L::uuid, %L::uuid) $$, 'family_task.assignment_taken.v1', :'adultb_member_id', :'owner_member_id'),
  'adultB taking task 3 enqueues assignment_taken.v1, actor=adultB, recipient=the task creator (owner)'
);

-- ---------------------------------------------------------------------------
-- 5) No self-notification: owner takes their own unassigned task 4
-- ---------------------------------------------------------------------------
insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task4_id', :'owner_member_id', null, 'took');

select is(
  (select count(*)::int from notifications.outbox where task_id = :'task4_id'),
  0,
  'owner taking their own task never enqueues a notification (actor = recipient)'
);

-- ---------------------------------------------------------------------------
-- 6) No event for a removed/inactive family member: adultC (task 5's
-- creator) is removed, then adultB takes task 5 - the 'took' recipient
-- lookup joins on removed_at is null and finds nothing.
-- ---------------------------------------------------------------------------
update public.family_members set removed_at = now() where id = :'adultc_member_id';

insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task5_id', :'adultb_member_id', null, 'took');

select is(
  (select count(*)::int from notifications.outbox where task_id = :'task5_id'),
  0,
  'taking a task created by a now-removed member never enqueues a notification'
);

-- ---------------------------------------------------------------------------
-- 7) Disabled preference: adultB opts out, owner assigns task 6 to adultB
-- ---------------------------------------------------------------------------
insert into public.notification_preferences (profile_id, assignment_notifications_enabled)
values (:'adultb_id', false);

insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task6_id', :'adultb_member_id', :'owner_member_id', 'assigned');

select is(
  (select count(*)::int from notifications.outbox where task_id = :'task6_id'),
  0,
  'assigning to a recipient who disabled assignment notifications enqueues nothing'
);

select is(
  public.notification_preference_enabled(:'owner_id'),
  true,
  'a profile with no notification_preferences row at all defaults to enabled'
);

-- ---------------------------------------------------------------------------
-- 8) Deterministic deduplication: the same idempotency_key can never
-- produce two rows, even inserted directly (bypassing the trigger) as postgres.
-- ---------------------------------------------------------------------------
-- Re-enable adultB's preference first - section 7 deliberately disabled it,
-- and this section (dedup/replay) is not about preferences.
update public.notification_preferences set assignment_notifications_enabled = true where profile_id = :'adultb_id';

insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
values (:'task7_id', :'adultb_member_id', :'owner_member_id', 'assigned')
returning id as task7_assignment_id \gset

select is(
  (select count(*)::int from notifications.outbox where task_assignment_id = :'task7_assignment_id'),
  1,
  'task 7''s assignment produced exactly one outbox row'
);

insert into notifications.outbox (idempotency_key, event_type, family_id, task_id, task_assignment_id, actor_member_id, recipient_member_id, payload)
values (
  'task_assignment:' || :'task7_assignment_id',
  'family_task.assignment_requested.v1', :'family_id', :'task7_id', :'task7_assignment_id',
  :'owner_member_id', :'adultb_member_id', '{}'::jsonb
)
on conflict (idempotency_key) do nothing;

select is(
  (select count(*)::int from notifications.outbox where task_assignment_id = :'task7_assignment_id'),
  1,
  'directly re-inserting the same idempotency_key is a no-op — still exactly one row'
);

-- ---------------------------------------------------------------------------
-- 9) RPC replay safety: re-assigning an already-assigned task is rejected
-- by the state machine itself (40001), so it can never produce a second
-- logical event for the same transition.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.assign_family_task(%L, %L) $$, :'task7_id', :'adultb_member_id'),
  '40001',
  null,
  'replaying assign_family_task on an already-assigned task is rejected by the state machine'
);

reset role;

select is(
  (select count(*)::int from notifications.outbox where task_id = :'task7_id'),
  1,
  'the rejected replay left exactly one outbox row for task 7 — no duplicate'
);

-- ---------------------------------------------------------------------------
-- 10) The notifications schema is completely inaccessible to any client role
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select count(*) from notifications.outbox $$,
  '42501',
  null,
  'an authenticated user has no SELECT grant on notifications.outbox at all'
);

select throws_ok(
  format(
    $$ insert into notifications.outbox (idempotency_key, event_type, family_id, task_id, actor_member_id, recipient_member_id, payload)
       values ('forged', 'family_task.assignment_requested.v1', %L, %L, %L, %L, '{}'::jsonb) $$,
    :'family_id', :'task1_id', :'owner_member_id', :'owner_member_id'
  ),
  '42501',
  null,
  'an authenticated user cannot forge an outbox row (no INSERT grant, no client-facing RPC accepts an arbitrary recipient)'
);

select throws_ok(
  $$ select count(*) from notifications.deliveries $$,
  '42501',
  null,
  'an authenticated user has no SELECT grant on notifications.deliveries at all'
);

select throws_ok(
  format($$ select notifications.claim_pending_outbox('forged-worker', 100) $$),
  '42501',
  null,
  'an authenticated user cannot execute the internal claim function'
);

select throws_ok(
  format($$ select notifications.deactivate_notification_token(%L) $$, gen_random_uuid()),
  '42501',
  null,
  'an authenticated user cannot execute the internal token-deactivation function directly'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from notifications.outbox $$,
  '42501',
  null,
  'anonymous has no access to notifications.outbox'
);

select throws_ok(
  $$ select notifications.claim_pending_outbox('forged-worker', 100) $$,
  '42501',
  null,
  'anonymous cannot execute the internal claim function'
);

select throws_ok(
  $$ select notifications.backoff_interval(1) $$,
  '42501',
  null,
  'anonymous cannot execute the internal backoff helper'
);

reset role;

-- ---------------------------------------------------------------------------
-- 11) notification_tokens: ownership isolation beyond SELECT (070 already
-- covers SELECT) — UPDATE/DELETE, plus the deactivation/reactivation
-- lifecycle via register_notification_token.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.register_notification_token('ExponentPushToken[owner-device-1]', 'ios') as owner_token_id \gset

select is(
  (select deactivated_at from public.notification_tokens where id = :'owner_token_id'),
  null,
  'a freshly registered token starts active (deactivated_at is null)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adultb_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ update public.notification_tokens set deactivated_at = now() where id = %L $$, :'owner_token_id'),
  'adultB updating the owner''s token affects zero rows, not an error (RLS hides it, not a thrown exception)'
);

select is(
  (select count(*)::int from public.notification_tokens where id = :'owner_token_id' and profile_id = :'adultb_id'),
  0,
  'adultB cannot see the owner''s token to claim it as their own'
);

select lives_ok(
  format($$ delete from public.notification_tokens where id = %L $$, :'owner_token_id'),
  'adultB attempting to delete the owner''s token affects zero rows, not an error (RLS hides it)'
);

select is(
  (select deactivated_at from public.notification_tokens where id = :'owner_token_id'),
  null,
  'the owner''s token still exists and is still active after adultB''s no-op delete attempt'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

update public.notification_tokens set deactivated_at = now() where id = :'owner_token_id' and profile_id = :'owner_id';

select isnt(
  (select deactivated_at from public.notification_tokens where id = :'owner_token_id'),
  null,
  'the owner can deactivate their own token directly (logout)'
);

select public.register_notification_token('ExponentPushToken[owner-device-1]', 'ios') as owner_token_id_2 \gset

select is(
  :'owner_token_id_2'::uuid,
  :'owner_token_id'::uuid,
  'registering the same expo_push_token again reuses the same row (upsert on token, not a new id)'
);

select is(
  (select deactivated_at from public.notification_tokens where id = :'owner_token_id'),
  null,
  'registering the token again reactivates it (deactivated_at cleared)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adultb_id', 'role', 'authenticated')::text, true);

select public.register_notification_token('ExponentPushToken[owner-device-1]', 'ios') as reassigned_token_id \gset

select is(
  (select profile_id from public.notification_tokens where id = :'reassigned_token_id'),
  :'adultb_id',
  'a device token re-registered under a different profile is reassigned to the new caller'
);

reset role;

select * from finish();
rollback;
