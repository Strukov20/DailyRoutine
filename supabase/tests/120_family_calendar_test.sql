-- Tests: personal/family/child events, the event ≠ responsibility rule,
-- the responsibility assignment state machine (mirroring
-- 100_shared_family_tasks_test.sql's own structure for task_assignments),
-- privacy (Busy blocks for private events), the conflict-detection
-- function, member-removal resolution extended to responsibilities, and
-- that every new SECURITY DEFINER function is unreachable by anon.
begin;
select plan(88);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'fc-owner@test.local', 'fc-adult-b@test.local', 'fc-adult-c@test.local', 'fc-outsider@test.local'
]) as email;

select id as owner_id from auth.users where email = 'fc-owner@test.local' \gset
select id as adult_b_id from auth.users where email = 'fc-adult-b@test.local' \gset
select id as adult_c_id from auth.users where email = 'fc-adult-c@test.local' \gset
select id as outsider_id from auth.users where email = 'fc-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Calendar Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Calendar Family', :'outsider_id', :'outsider_id')
returning id as other_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adult_b_id', 'Adult B', :'owner_id')
returning id as adult_b_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adult_c_id', 'Adult C', :'owner_id')
returning id as adult_c_member_id \gset

insert into public.family_members (id, family_id, member_type, role, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'child', 'child', 'Artem', :'owner_id')
returning id as child_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'other_family_id', 'adult', 'owner', :'outsider_id', 'Outsider Owner', :'outsider_id')
returning id as outsider_member_id \gset

-- ---------------------------------------------------------------------------
-- create_personal_event
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_event(
  'Dentist', '2026-09-10 14:00:00+00', '2026-09-10 15:00:00+00', 'Europe/Kyiv'
) as private_event_id \gset

select is(
  (select visibility from public.events where id = :'private_event_id'),
  'private',
  'a personal event defaults to Private'
);
select is(
  (select family_id from public.events where id = :'private_event_id'),
  null,
  'a personal event with no family_id stays purely personal'
);

select throws_ok(
  $$ select public.create_personal_event('Bad range', '2026-09-10 15:00:00+00', '2026-09-10 14:00:00+00', 'Europe/Kyiv') $$,
  '22023', null, 'ends_at must be after starts_at'
);

select throws_ok(
  format($$ select public.create_personal_event('Bad visibility', '2026-09-10 14:00:00+00', '2026-09-10 15:00:00+00', 'Europe/Kyiv', null, null, 'family') $$),
  '22023', null, 'visibility=family with no family_id is rejected'
);

select throws_ok(
  format($$ select public.create_personal_event('Cross-family', '2026-09-10 14:00:00+00', '2026-09-10 15:00:00+00', 'Europe/Kyiv', null, null, 'family', %L) $$, :'other_family_id'),
  '42501', null, 'a personal event cannot claim a family the caller does not belong to'
);

-- ---------------------------------------------------------------------------
-- create_family_event
-- ---------------------------------------------------------------------------
select public.create_family_event(
  :'family_id', 'Family dinner', '2026-09-10 18:00:00+00', '2026-09-10 19:00:00+00', 'Europe/Kyiv'
) as family_event_id \gset

select is(
  (select visibility from public.events where id = :'family_event_id'),
  'family',
  'create_family_event always creates visibility=family'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_family_event(%L, 'Not allowed', '2026-09-10 18:00:00+00', '2026-09-10 19:00:00+00', 'Europe/Kyiv') $$, :'family_id'),
  '42501', null, 'an outsider cannot create a family event for a family they do not belong to'
);

-- ---------------------------------------------------------------------------
-- create_child_event — the central event ≠ responsibility scenario
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format(
    $$ select public.create_child_event(%L, %L, 'Swimming', '2026-09-10 17:00:00+00', '2026-09-10 18:00:00+00', 'Europe/Kyiv') $$,
    :'family_id', :'adult_b_member_id'
  ),
  '22023', null, 'create_child_event rejects an adult as p_child_member_id'
);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Swimming',
  '2026-09-10 17:00:00+00', '2026-09-10 18:00:00+00', 'Europe/Kyiv',
  null, null, :'adult_b_member_id', :'adult_c_member_id'
) as swim_event_id \gset

select is(
  (select count(*)::int from public.event_participants where event_id = :'swim_event_id' and family_member_id = :'child_member_id'),
  1,
  'the child is recorded as the event''s participant'
);
select is(
  (select count(*)::int from public.responsibilities where event_id = :'swim_event_id'),
  2,
  'exactly two responsibility rows exist — drop_off and pick_up — never text on the event'
);
select is(
  (select assignee_member_id from public.responsibilities where event_id = :'swim_event_id' and type = 'drop_off'),
  :'adult_b_member_id',
  'drop_off is assigned to adult B as requested at creation'
);
select is(
  (select status from public.responsibilities where event_id = :'swim_event_id' and type = 'pick_up'),
  'pending_acceptance',
  'pick_up assigned to a different adult (not the creator) starts pending_acceptance'
);

-- Renaming the event must leave both responsibility rows completely untouched.
select public.update_event(:'swim_event_id', 'Swimming (pool B)');
select is(
  (select assignee_member_id from public.responsibilities where event_id = :'swim_event_id' and type = 'drop_off'),
  :'adult_b_member_id',
  'renaming the event leaves the drop_off responsibility''s assignee untouched'
);

-- due_at derives from the event, never drifts independently
select public.update_event(:'swim_event_id', null, null, false, null, false, '2026-09-10 17:30:00+00', '2026-09-10 18:30:00+00');
select ok(
  (select due_at from public.family_responsibilities where event_id = :'swim_event_id' and type = 'drop_off')
    = '2026-09-10 17:30:00+00'::timestamptz,
  'drop_off''s due_at moves automatically with the event''s own starts_at — never stored separately'
);
select ok(
  (select due_at from public.family_responsibilities where event_id = :'swim_event_id' and type = 'pick_up')
    = '2026-09-10 18:30:00+00'::timestamptz,
  'pick_up''s due_at tracks the event''s ends_at the same way'
);

-- ---------------------------------------------------------------------------
-- Responsibility assignment state machine
-- ---------------------------------------------------------------------------
select id as pickup_responsibility_id from public.responsibilities
  where event_id = :'swim_event_id' and type = 'pick_up' \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_event_responsibility(%L) $$, :'pickup_responsibility_id'),
  '42501', null, 'a total outsider cannot accept a responsibility'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_event_responsibility(%L) $$, :'pickup_responsibility_id'),
  '40001', null, 'a same-family adult who is not the pending recipient cannot accept it'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.accept_event_responsibility(%L) $$, :'pickup_responsibility_id'),
  'the correct pending recipient can accept'
);
select is(
  (select status from public.responsibilities where id = :'pickup_responsibility_id'),
  'accepted',
  'the responsibility is now accepted'
);

-- decline, on a freshly created responsibility
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Piano lesson',
  '2026-09-11 16:00:00+00', '2026-09-11 17:00:00+00', 'Europe/Kyiv',
  null, null, null, :'adult_b_member_id'
) as piano_event_id \gset

select id as piano_pickup_id from public.responsibilities
  where event_id = :'piano_event_id' and type = 'pick_up' \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.decline_event_responsibility(%L) $$, :'piano_pickup_id'),
  'the pending recipient can decline'
);
select is(
  (select status from public.responsibilities where id = :'piano_pickup_id'),
  'unassigned',
  'declining resolves the responsibility back to unassigned'
);
select is(
  (select assignee_member_id from public.responsibilities where id = :'piano_pickup_id'),
  null,
  'declining clears the assignee'
);
select is(
  (select count(*)::int from public.responsibility_assignments where responsibility_id = :'piano_pickup_id' and action = 'declined'),
  1,
  'the declined action is a permanent audit entry'
);

-- take an unassigned responsibility
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.take_event_responsibility(%L) $$, :'piano_pickup_id'),
  'an adult can take an unassigned responsibility'
);
select is(
  (select status from public.responsibilities where id = :'piano_pickup_id'),
  'accepted',
  'taking a responsibility is immediate acceptance'
);
select throws_ok(
  format($$ select public.take_event_responsibility(%L) $$, :'piano_pickup_id'),
  '40001', null, 'a second Take attempt on an already-taken responsibility fails'
);

-- assign vs reassign boundaries
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.assign_event_responsibility(%L, %L) $$, :'piano_pickup_id', :'adult_b_member_id'),
  '40001', null, 'assign_event_responsibility refuses an already-assigned responsibility'
);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Chess club',
  '2026-09-12 15:00:00+00', '2026-09-12 16:00:00+00', 'Europe/Kyiv'
) as chess_event_id \gset

-- create_bare_responsibility is internal-only — not directly callable, even
-- by the family owner (mirrors set_task_assignment's own boundary test).
select throws_ok(
  format($$ select public.create_bare_responsibility(%L, 'drop_off', null) $$, :'chess_event_id'),
  '42501', null, 'create_bare_responsibility is not directly callable by authenticated'
);

-- reassign a responsibility that has no assignee yet is rejected too
select public.reassign_event_responsibility(:'piano_pickup_id', :'adult_b_member_id');
select is(
  (select status from public.responsibilities where id = :'piano_pickup_id'),
  'pending_acceptance',
  'reassigning an accepted responsibility to a different adult moves it back to pending_acceptance'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_event_responsibility(%L) $$, :'piano_pickup_id'),
  '40001', null, 'the stale (just-superseded) recipient cannot accept after being reassigned away'
);

-- ---------------------------------------------------------------------------
-- remove_event_responsibility
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.remove_event_responsibility(%L) $$, :'piano_pickup_id'),
  '22023', null, 'an active (pending) responsibility cannot be removed directly — unassign first'
);

-- create_bare_responsibility is internal-only (revoked from authenticated
-- too) — this fixture row is inserted as the test's own postgres role, same
-- convention as every other file's "fixtures bypass RLS, only assertions
-- simulate a persona" rule.
reset role;
select public.create_bare_responsibility(:'chess_event_id', 'pick_up', null);
select id as chess_pickup_id from public.responsibilities where event_id = :'chess_event_id' and type = 'pick_up' \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.remove_event_responsibility(%L) $$, :'chess_pickup_id'),
  'an unassigned responsibility can be removed by the event owner'
);
select is(
  (select count(*)::int from public.responsibilities where id = :'chess_pickup_id'),
  0,
  'the removed responsibility row is gone'
);
select lives_ok(
  format($$ select public.remove_event_responsibility(%L) $$, :'chess_pickup_id'),
  'removing an already-removed responsibility is a safe idempotent no-op'
);

-- ---------------------------------------------------------------------------
-- Privacy: a private event is a Busy block to other family members, full
-- detail to its owner (secret-marker style assertion — mirrors
-- 060_privacy_regression_test.sql's convention)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_event(
  'SECRET-MARKER-therapy', '2026-09-13 09:00:00+00', '2026-09-13 10:00:00+00', 'Europe/Kyiv',
  'SECRET-MARKER-notes', 'SECRET-MARKER-location', 'private', :'family_id'
) as private_family_linked_event_id \gset

select is(
  (select title from public.events where id = :'private_family_linked_event_id'),
  'SECRET-MARKER-therapy',
  'the owner sees the full title via the base table'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.events where id = :'private_family_linked_event_id'),
  0,
  'a private event is completely invisible to another family member via the base table'
);
select is(
  (select title from public.family_schedule where id = :'private_family_linked_event_id'),
  null,
  'the sanitized family_schedule view nulls the title for a private event'
);
select ok(
  not exists (
    select 1 from public.family_schedule
    where id = :'private_family_linked_event_id'
      and (title ilike '%SECRET-MARKER%' or description ilike '%SECRET-MARKER%' or location ilike '%SECRET-MARKER%')
  ),
  'no secret-marker text leaks through family_schedule in any column, for any family member'
);
select is(
  (select starts_at from public.family_schedule where id = :'private_family_linked_event_id'),
  '2026-09-13 09:00:00+00'::timestamptz,
  'the Busy block still carries the correct start time'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_schedule where id = :'private_family_linked_event_id'),
  0,
  'an outsider (not in this family at all) sees nothing for this event, not even a Busy block'
);

-- family_schedule exposes the primary participant for a family-visible event
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select is(
  (select participant_member_id from public.family_schedule where id = :'swim_event_id'),
  :'child_member_id',
  'family_schedule exposes the child as the primary participant for a family-visible child event'
);

-- events with no responsibility can freely become private; one that has an
-- active responsibility cannot
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_event(%L, null, null, false, null, false, null, null, null, 'private') $$, :'swim_event_id'),
  '22023', null, 'an event with an active responsibility cannot become Private'
);

-- ---------------------------------------------------------------------------
-- A responsibility cannot be attached to a private event at all — tests the
-- trigger itself, so this runs as the test's own postgres role (bypassing
-- the authenticated-grant revoke, which would otherwise mask the trigger's
-- 23514 behind a 42501 permission error before the function body ever ran).
-- ---------------------------------------------------------------------------
reset role;

select throws_ok(
  format($$ select public.create_bare_responsibility(%L, 'drop_off', null) $$, :'private_event_id'),
  '23514', null, 'a responsibility cannot be attached to a private personal event (trigger-level rejection)'
);

-- ---------------------------------------------------------------------------
-- cancel_event
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_event(
  'To be cancelled', '2026-09-14 10:00:00+00', '2026-09-14 11:00:00+00', 'Europe/Kyiv'
) as cancel_event_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.cancel_event(%L) $$, :'cancel_event_id'),
  '42501', null, 'a non-owner cannot cancel someone else''s event'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.cancel_event(%L) $$, :'cancel_event_id'),
  'the owner can cancel their own event'
);
select is(
  (select count(*)::int from public.events where id = :'cancel_event_id'),
  0,
  'a cancelled event is excluded from the owner-facing SELECT policy too'
);
select lives_ok(
  format($$ select public.cancel_event(%L) $$, :'cancel_event_id'),
  'cancelling an already-cancelled event is a safe idempotent no-op'
);

-- ---------------------------------------------------------------------------
-- has_member_schedule_conflict
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

-- Adult B has a private event 2026-09-15 17:00-18:00. A responsibility due
-- exactly at 17:00-18:00 the same day must be flagged; one at 18:00-19:00
-- (half-open boundary touch) must not.
select public.create_personal_event(
  'Busy block', '2026-09-15 17:00:00+00', '2026-09-15 18:00:00+00', 'Europe/Kyiv'
) as conflict_source_event_id \gset

-- Adult B is the owner of the private event above, so they must be able to
-- check their own conflict (the function only requires same-family
-- membership with the *target* member, not ownership of the checked event).
select ok(
  public.has_member_schedule_conflict(:'adult_b_member_id', '2026-09-15 17:00:00+00'::timestamptz, '2026-09-15 18:00:00+00'::timestamptz),
  'an overlapping private event on the assignee''s own calendar is flagged as a conflict'
);
select ok(
  not public.has_member_schedule_conflict(:'adult_b_member_id', '2026-09-15 18:00:00+00'::timestamptz, '2026-09-15 19:00:00+00'::timestamptz),
  'a range starting exactly when the conflicting event ends is NOT a conflict (half-open interval)'
);
select ok(
  not public.has_member_schedule_conflict(:'adult_b_member_id', '2026-09-15 16:00:00+00'::timestamptz, '2026-09-15 17:00:00+00'::timestamptz),
  'a range ending exactly when the conflicting event starts is NOT a conflict (half-open interval)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.has_member_schedule_conflict(%L, '2026-09-15 17:00:00+00'::timestamptz, '2026-09-15 18:00:00+00'::timestamptz) $$, :'adult_b_member_id'),
  '42501', null, 'an outsider cannot probe another family''s member for a schedule conflict'
);

-- Two accepted responsibilities for the same adult at overlapping times
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Overlap check A',
  '2026-09-16 10:00:00+00', '2026-09-16 11:00:00+00', 'Europe/Kyiv',
  null, null, :'adult_c_member_id'
) as overlap_event_id \gset

select id as overlap_dropoff_id from public.responsibilities
  where event_id = :'overlap_event_id' and type = 'drop_off' \gset

select public.create_child_event(
  :'family_id', :'child_member_id', 'Overlap check B',
  '2026-09-16 10:15:00+00', '2026-09-16 11:15:00+00', 'Europe/Kyiv',
  null, null, :'adult_c_member_id'
) as overlap_event_b_id \gset

select id as overlap_dropoff_b_id from public.responsibilities
  where event_id = :'overlap_event_b_id' and type = 'drop_off' \gset

-- Both assigned to adult C by the owner (not a self-assign), so both start
-- pending_acceptance, same as every other assignment in this file — adult C
-- must accept the first one before it counts as a real conflict source
-- (the second is intentionally left pending, to isolate "an ACCEPTED
-- responsibility conflicts" from "a merely-pending one does not").
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);
select public.accept_event_responsibility(:'overlap_dropoff_id');

select ok(
  public.has_member_schedule_conflict(:'adult_c_member_id', '2026-09-16 10:15:00+00'::timestamptz, '2026-09-16 11:15:00+00'::timestamptz),
  'an accepted responsibility at an overlapping time is flagged for the same assignee'
);
select ok(
  not public.has_member_schedule_conflict(:'adult_c_member_id', '2026-09-16 10:15:00+00'::timestamptz, '2026-09-16 11:15:00+00'::timestamptz, :'overlap_dropoff_id'),
  'excluding the conflicting responsibility itself (p_exclude_responsibility_id) avoids a false self-conflict when re-checking that exact responsibility''s own new time'
);
select ok(
  not public.has_member_schedule_conflict(:'adult_c_member_id', '2026-09-16 12:00:00+00'::timestamptz, '2026-09-16 12:30:00+00'::timestamptz),
  'a merely-pending (not yet accepted) responsibility is never itself counted as a conflict source'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- remove_family_member resolves active responsibility assignments too
-- ---------------------------------------------------------------------------
select is(
  (select status from public.responsibilities where id = :'overlap_dropoff_id'),
  'accepted',
  'sanity: the overlap drop_off is accepted before removal'
);

select lives_ok(
  format($$ select public.remove_family_member(%L) $$, :'adult_c_member_id'),
  'the owner can remove a member who has active responsibility assignments — no FK violation'
);
select is(
  (select status from public.responsibilities where id = :'overlap_dropoff_id'),
  'unassigned',
  'an accepted responsibility is resolved to unassigned when the assignee is removed'
);
select is(
  (select count(*)::int from public.responsibility_assignments where responsibility_id = :'overlap_dropoff_id' and action = 'unassigned'),
  1,
  'the removal-triggered unassignment is a permanent audit entry'
);

-- ---------------------------------------------------------------------------
-- Notification outbox extension (Phase 7): event_responsibility.* events.
-- Direct psql inspection of notifications.outbox (not reachable via any
-- client role — see below) is legitimate here since this whole test file
-- already runs as the database owner outside RLS for its own fixture setup,
-- same convention 110_notification_outbox_test.sql itself uses.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Notification check',
  '2026-09-17 09:00:00+00', '2026-09-17 10:00:00+00', 'Europe/Kyiv',
  null, null, :'adult_b_member_id'
) as notif_event_id \gset

select id as notif_dropoff_id from public.responsibilities
  where event_id = :'notif_event_id' and type = 'drop_off' \gset

reset role;

select is(
  (select event_type from notifications.outbox where responsibility_id = :'notif_dropoff_id'),
  'event_responsibility.assignment_requested.v1',
  'assigning a responsibility to a different adult enqueues a requested-event outbox row'
);
select is(
  (select event_id from notifications.outbox where responsibility_id = :'notif_dropoff_id'),
  :'notif_event_id',
  'the outbox row points at the event (navigation target), mutually exclusive with task_id'
);
select is(
  (select task_id from notifications.outbox where responsibility_id = :'notif_dropoff_id'),
  null,
  'task_id stays null for a responsibility-triggered outbox row (outbox_exactly_one_source)'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);
select public.accept_event_responsibility(:'notif_dropoff_id');

reset role;
select is(
  (select count(*)::int from notifications.outbox where responsibility_id = :'notif_dropoff_id' and event_type = 'event_responsibility.assignment_accepted.v1'),
  1,
  'accepting enqueues an accepted-event outbox row for the assigner'
);

-- Self-notification suppression: the owner assigning a responsibility to
-- themself must never enqueue an outbox row.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_child_event(
  :'family_id', :'child_member_id', 'Self-assign notification check',
  '2026-09-18 09:00:00+00', '2026-09-18 10:00:00+00', 'Europe/Kyiv',
  null, null, :'owner_member_id'
) as self_notif_event_id \gset

reset role;
select is(
  (select count(*)::int from notifications.outbox where event_id = :'self_notif_event_id'),
  0,
  'the owner assigning a responsibility to themself never enqueues an outbox row'
);

-- notifications schema stays completely inaccessible after the Phase 7
-- schema evolution (new columns/constraint didn't loosen anything) — must
-- run as authenticated, not the test's own postgres role, which bypasses
-- grants/RLS entirely and would trivially succeed either way.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select * from notifications.outbox $$,
  '42501', null, 'notifications.outbox remains inaccessible to authenticated (re-checked after Phase 7''s schema changes)'
);

-- ---------------------------------------------------------------------------
-- anon: no EXECUTE on any new RPC, and the internal helpers stay unreachable
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select public.create_personal_event('x', '2026-09-20 10:00:00+00', '2026-09-20 11:00:00+00', 'Europe/Kyiv') $$,
  '42501', null, 'anon cannot call create_personal_event'
);
select throws_ok(
  format($$ select public.create_family_event(%L, 'x', '2026-09-20 10:00:00+00', '2026-09-20 11:00:00+00', 'Europe/Kyiv') $$, :'family_id'),
  '42501', null, 'anon cannot call create_family_event'
);
select throws_ok(
  format($$ select public.create_child_event(%L, %L, 'x', '2026-09-20 10:00:00+00', '2026-09-20 11:00:00+00', 'Europe/Kyiv') $$, :'family_id', :'child_member_id'),
  '42501', null, 'anon cannot call create_child_event'
);
select throws_ok(
  format($$ select public.update_event(%L, 'x') $$, :'private_event_id'),
  '42501', null, 'anon cannot call update_event'
);
select throws_ok(
  format($$ select public.cancel_event(%L) $$, :'private_event_id'),
  '42501', null, 'anon cannot call cancel_event'
);
select throws_ok(
  format($$ select public.assign_event_responsibility(%L, %L) $$, :'piano_pickup_id', :'adult_b_member_id'),
  '42501', null, 'anon cannot call assign_event_responsibility'
);
select throws_ok(
  format($$ select public.reassign_event_responsibility(%L, %L) $$, :'piano_pickup_id', :'adult_b_member_id'),
  '42501', null, 'anon cannot call reassign_event_responsibility'
);
select throws_ok(
  format($$ select public.take_event_responsibility(%L) $$, :'piano_pickup_id'),
  '42501', null, 'anon cannot call take_event_responsibility'
);
select throws_ok(
  format($$ select public.accept_event_responsibility(%L) $$, :'piano_pickup_id'),
  '42501', null, 'anon cannot call accept_event_responsibility'
);
select throws_ok(
  format($$ select public.decline_event_responsibility(%L) $$, :'piano_pickup_id'),
  '42501', null, 'anon cannot call decline_event_responsibility'
);
select throws_ok(
  format($$ select public.remove_event_responsibility(%L) $$, :'piano_pickup_id'),
  '42501', null, 'anon cannot call remove_event_responsibility'
);
select throws_ok(
  format($$ select public.has_member_schedule_conflict(%L, '2026-09-20 10:00:00+00'::timestamptz, '2026-09-20 11:00:00+00'::timestamptz) $$, :'adult_b_member_id'),
  '42501', null, 'anon cannot call has_member_schedule_conflict'
);
select throws_ok(
  format($$ select public.set_responsibility_assignment(%L, %L, 'assigned') $$, :'piano_pickup_id', :'adult_b_member_id'),
  '42501', null, 'anon cannot call the internal set_responsibility_assignment helper either'
);
select throws_ok(
  format($$ select public.create_bare_responsibility(%L, 'drop_off', null) $$, :'piano_event_id'),
  '42501', null, 'anon cannot call the internal create_bare_responsibility helper either'
);
select throws_ok(
  $$ select * from public.family_schedule $$,
  '42501', null, 'anon has no SELECT on family_schedule'
);
select throws_ok(
  $$ select * from public.family_responsibilities $$,
  '42501', null, 'anon has no SELECT on family_responsibilities'
);
select throws_ok(
  $$ select * from public.responsibility_assignments $$,
  '42501', null, 'anon has no SELECT on responsibility_assignments (append-only audit, no direct access at all)'
);

-- authenticated cannot call the internal helpers directly either (only via
-- their public wrappers) — mirrors set_task_assignment's own boundary test.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.set_responsibility_assignment(%L, %L, 'assigned') $$, :'piano_pickup_id', :'adult_b_member_id'),
  '42501', null, 'set_responsibility_assignment is not directly callable even by an authenticated family owner'
);

-- ---------------------------------------------------------------------------
-- append-only: responsibility_assignments has no UPDATE/DELETE grant
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.responsibility_assignments set action = 'declined' where responsibility_id = %L $$, :'piano_pickup_id'),
  '42501', null, 'responsibility_assignments rows cannot be UPDATEd by anyone'
);
select throws_ok(
  format($$ delete from public.responsibility_assignments where responsibility_id = %L $$, :'piano_pickup_id'),
  '42501', null, 'responsibility_assignments rows cannot be DELETEd by anyone'
);

-- ---------------------------------------------------------------------------
-- raw base-table mutation grants stay revoked
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.events (owner_profile_id, title, starts_at, ends_at, timezone, created_by) values (%L, 'x', now(), now() + interval '1 hour', 'UTC', %L) $$,
    :'owner_id', :'owner_id'
  ),
  '42501', null, 'authenticated cannot INSERT into events directly — RPC only'
);
select throws_ok(
  format($$ update public.events set title = 'hacked' where id = %L $$, :'swim_event_id'),
  '42501', null, 'authenticated cannot UPDATE events directly — RPC only'
);
select throws_ok(
  format($$ insert into public.responsibilities (event_id, type) values (%L, 'drop_off') $$, :'swim_event_id'),
  '42501', null, 'authenticated cannot INSERT into responsibilities directly — RPC only'
);
select throws_ok(
  format($$ update public.responsibilities set status = 'accepted' where id = %L $$, :'pickup_responsibility_id'),
  '42501', null, 'authenticated cannot UPDATE responsibilities directly — the accept/decline/take state machine cannot be bypassed'
);

select * from finish();
rollback;
