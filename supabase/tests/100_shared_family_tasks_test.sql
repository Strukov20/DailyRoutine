-- Tests: the shared-family-task assignment state machine (create, take,
-- assign, reassign, unassign, accept, decline, complete, restore), the
-- member-removal assignment-resolution fix, and the two new
-- update_personal_task guards. Concurrency: pgTAP runs sequentially inside
-- one transaction, so a true two-simultaneous-transaction race is proven
-- in the real curl-driven E2E script (Section 16) instead — here we prove
-- the state-check logic each RPC relies on for that safety (a second
-- sequential call against an already-resolved task is correctly rejected),
-- which is the same code path a concurrent second transaction would hit
-- after the first one commits and releases its row lock.
begin;
select plan(71);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'sft-owner@test.local', 'sft-adult-b@test.local', 'sft-adult-c@test.local', 'sft-outsider@test.local'
]) as email;

select id as owner_id from auth.users where email = 'sft-owner@test.local' \gset
select id as adult_b_id from auth.users where email = 'sft-adult-b@test.local' \gset
select id as adult_c_id from auth.users where email = 'sft-adult-c@test.local' \gset
select id as outsider_id from auth.users where email = 'sft-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Shared Task Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Family', :'outsider_id', :'outsider_id')
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
values (gen_random_uuid(), :'family_id', 'child', 'child', 'Kid', :'owner_id')
returning id as child_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'other_family_id', 'adult', 'owner', :'outsider_id', 'Outsider Owner', :'outsider_id')
returning id as outsider_member_id \gset

-- ---------------------------------------------------------------------------
-- create_shared_family_task
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_shared_family_task(:'family_id', 'Unassigned shared task') as unassigned_task_id \gset

select is(
  (select visibility from public.tasks where id = :'unassigned_task_id'),
  'family',
  'a shared task is always created with visibility=family'
);
select is(
  (select family_id from public.tasks where id = :'unassigned_task_id')::text,
  :'family_id',
  'family_id is set to the requested family'
);
select is(
  (select assignment_status from public.tasks where id = :'unassigned_task_id'),
  'unassigned',
  'a task created with no assignee starts unassigned'
);
select is(
  (select created_by from public.tasks where id = :'unassigned_task_id')::text,
  :'owner_id',
  'created_by is always the caller'
);

-- outsider rejection
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_shared_family_task(%L, 'Not allowed') $$, :'family_id'),
  '42501',
  null,
  'an outsider cannot create a shared task for a family they do not belong to'
);

select is(
  (select count(*)::int from public.tasks where id = :'unassigned_task_id'),
  0,
  'an outsider cannot even see the family task via the base table'
);

-- cross-family assignee rejection
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_shared_family_task(%L, 'Bad assignee', null, null, null, null, null, 'normal', null, %L) $$, :'family_id', :'outsider_member_id'),
  '42501',
  null,
  'assigning to a member of a different family is rejected at creation'
);

-- assignment to a child rejected
select throws_ok(
  format($$ select public.create_shared_family_task(%L, 'Bad assignee', null, null, null, null, null, 'normal', null, %L) $$, :'family_id', :'child_member_id'),
  '22023',
  null,
  'assigning to a child profile is rejected at creation'
);

-- assignment to self is immediate acceptance
select public.create_shared_family_task(:'family_id', 'Self-assigned task', null, null, null, null, null, 'normal', null, :'owner_member_id') as self_assigned_task_id \gset

select is(
  (select assignment_status from public.tasks where id = :'self_assigned_task_id'),
  'accepted',
  'assigning to yourself at creation is immediate acceptance'
);
select is(
  (select action from public.task_assignments where task_id = :'self_assigned_task_id'),
  'accepted',
  'the audit row for a self-assignment is action=accepted, not assigned'
);

-- assignment to another adult creates a pending assignment
select public.create_shared_family_task(:'family_id', 'Assigned to B', null, null, null, null, null, 'normal', null, :'adult_b_member_id') as pending_task_id \gset

select is(
  (select assignment_status from public.tasks where id = :'pending_task_id'),
  'pending_acceptance',
  'assigning to another adult at creation is pending, not automatic acceptance'
);

-- ---------------------------------------------------------------------------
-- accept_task_assignment
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'pending_task_id'),
  '42501',
  null,
  'a total outsider cannot accept an assignment'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'pending_task_id'),
  '40001',
  null,
  'a same-family adult who is not the pending recipient cannot accept it'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'pending_task_id'),
  'the correct pending recipient can accept'
);

select is(
  (select assignment_status from public.tasks where id = :'pending_task_id'),
  'accepted',
  'the task is now accepted'
);

select throws_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'pending_task_id'),
  '40001',
  null,
  'accepting an already-accepted task again fails (not pending anymore)'
);

-- ---------------------------------------------------------------------------
-- decline_task_assignment
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_shared_family_task(:'family_id', 'To be declined', null, null, null, null, null, 'normal', null, :'adult_c_member_id') as decline_task_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.decline_task_assignment(%L) $$, :'decline_task_id'),
  'the pending recipient can decline'
);

select is(
  (select assignment_status from public.tasks where id = :'decline_task_id'),
  'unassigned',
  'declining resolves the task to unassigned, per the documented state machine'
);
select is(
  (select assignee_member_id from public.tasks where id = :'decline_task_id'),
  null,
  'declining clears the assignee'
);
select is(
  (select count(*)::int from public.task_assignments where task_id = :'decline_task_id' and action = 'declined'),
  1,
  'the declined action is a permanent audit entry'
);

-- ---------------------------------------------------------------------------
-- stale acceptance: reassigned away before the original recipient accepts
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_shared_family_task(:'family_id', 'Reassign race', null, null, null, null, null, 'normal', null, :'adult_b_member_id') as stale_task_id \gset

select lives_ok(
  format($$ select public.reassign_family_task(%L, %L) $$, :'stale_task_id', :'adult_c_member_id'),
  'the creator can reassign a pending task to a different adult'
);

select is(
  (select assignment_status from public.tasks where id = :'stale_task_id'),
  'pending_acceptance',
  'reassigning keeps the task pending, now for the new recipient'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'stale_task_id'),
  '40001',
  null,
  'the original (now stale) recipient cannot accept after being reassigned away'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'stale_task_id'),
  'the new (current) recipient can accept normally'
);

-- ---------------------------------------------------------------------------
-- assign_family_task vs reassign_family_task boundaries
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.assign_family_task(%L, %L) $$, :'stale_task_id', :'adult_b_member_id'),
  '40001',
  null,
  'assign_family_task refuses a task that is already assigned — use reassign instead'
);

select throws_ok(
  format($$ select public.reassign_family_task(%L, %L) $$, :'unassigned_task_id', :'adult_b_member_id'),
  '40001',
  null,
  'reassign_family_task refuses a task that is not currently assigned — use assign instead'
);

select lives_ok(
  format($$ select public.assign_family_task(%L, %L) $$, :'unassigned_task_id', :'adult_b_member_id'),
  'assign_family_task succeeds on a genuinely unassigned task'
);

-- ---------------------------------------------------------------------------
-- unassign_family_task
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select public.unassign_family_task(%L) $$, :'unassigned_task_id'),
  'the creator can unassign a pending task'
);
select is(
  (select assignment_status from public.tasks where id = :'unassigned_task_id'),
  'unassigned',
  'the task is unassigned again'
);
select lives_ok(
  format($$ select public.unassign_family_task(%L) $$, :'unassigned_task_id'),
  'unassigning an already-unassigned task is a safe idempotent no-op'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.unassign_family_task(%L) $$, :'stale_task_id'),
  '42501',
  null,
  'a same-family adult who is neither creator nor owner cannot unassign someone else''s task'
);

-- ---------------------------------------------------------------------------
-- take_family_task
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_shared_family_task(:'family_id', 'Up for grabs') as take_task_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.take_family_task(%L) $$, :'take_task_id'),
  'an adult can take an unassigned task'
);
select is(
  (select assignment_status from public.tasks where id = :'take_task_id'),
  'accepted',
  'taking a task is immediate acceptance'
);
select is(
  (select action from public.task_assignments where task_id = :'take_task_id' order by created_at desc limit 1),
  'took',
  'the audit action is ''took'', distinct from ''assigned''/''accepted'''
);

-- "concurrent" take: a second sequential attempt against the now-taken
-- task proves the same state-check a real concurrent second transaction
-- hits after the first commits and releases its FOR UPDATE lock (see file
-- header) — exactly one active assignment ever exists.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.take_family_task(%L) $$, :'take_task_id'),
  '40001',
  null,
  'a second Take attempt on an already-taken task fails — no duplicate active assignment'
);

select is(
  (select count(*)::int from public.task_assignments where task_id = :'take_task_id' and action in ('took', 'accepted')),
  1,
  'exactly one active-assignment audit row exists for the taken task'
);

-- ---------------------------------------------------------------------------
-- completion permissions
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.complete_shared_task(%L) $$, :'take_task_id'),
  '42501',
  null,
  'an adult who is neither creator nor the accepted assignee cannot complete the task'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.complete_shared_task(%L) $$, :'take_task_id'),
  'the accepted assignee can complete their own task'
);
select ok(
  (select completed_at from public.tasks where id = :'take_task_id') is not null,
  'completed_at was set'
);
select lives_ok(
  format($$ select public.complete_shared_task(%L) $$, :'take_task_id'),
  'completing an already-completed task is idempotent'
);

-- Reassigning requires creator/owner authorization, checked before the
-- completed-task guard — switch to the creator (owner) to isolate the
-- guard this assertion is actually about.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.reassign_family_task(%L, %L) $$, :'take_task_id', :'adult_c_member_id'),
  '22023',
  null,
  'a completed task cannot be reassigned without restoring it first'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.restore_shared_task(%L) $$, :'take_task_id'),
  'the accepted assignee can restore their own completed task'
);
select is(
  (select completed_at from public.tasks where id = :'take_task_id'),
  null,
  'completed_at was cleared'
);

-- creator can also complete (their own task, regardless of assignee)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.complete_shared_task(%L) $$, :'take_task_id'),
  'the task creator can also complete it directly'
);

-- ---------------------------------------------------------------------------
-- archived-task rejection
-- ---------------------------------------------------------------------------
select public.create_shared_family_task(:'family_id', 'Will be archived') as archived_task_id \gset
select public.delete_or_archive_personal_task(:'archived_task_id');

select throws_ok(
  format($$ select public.take_family_task(%L) $$, :'archived_task_id'),
  '22023',
  null,
  'an archived task is explicitly rejected by take_family_task, not silently treated as not-found'
);

-- ---------------------------------------------------------------------------
-- update_personal_task guards for actively-assigned shared tasks
-- ---------------------------------------------------------------------------
select public.create_shared_family_task(:'family_id', 'Guard test', null, null, null, null, null, 'normal', null, :'owner_member_id') as guarded_task_id \gset

select throws_ok(
  format($$ select public.update_personal_task(%L, null, null, false, null, null, false, 'private') $$, :'guarded_task_id'),
  '22023',
  null,
  'an actively-assigned task cannot become Private via update_personal_task'
);

select throws_ok(
  format($$ select public.update_personal_task(%L, null, null, false, null, null, false, null, %L) $$, :'guarded_task_id', :'other_family_id'),
  '42501',
  null,
  'the owner is not even a member of the other family, so this fails on membership first'
);

-- ---------------------------------------------------------------------------
-- update_personal_task never lets a client move an actively-assigned task
-- to a *different* family the caller *does* belong to either
-- ---------------------------------------------------------------------------
-- families has no direct INSERT grant (RPC-only, Phase 3) — use the real
-- RPC rather than bypassing to postgres, since this fixture specifically
-- needs the owner to be a genuinely authorized member of the second family.
select * from public.create_family_with_owner('Owner''s Second Family') \gset owner_second_

select throws_ok(
  format($$ select public.update_personal_task(%L, null, null, false, null, null, false, null, %L) $$, :'guarded_task_id', :'owner_second_family_id'),
  '22023',
  null,
  'an actively-assigned task cannot be moved to another family the caller does belong to either'
);

-- ---------------------------------------------------------------------------
-- member removal resolves pending and accepted assignments atomically
-- ---------------------------------------------------------------------------
select public.create_shared_family_task(:'family_id', 'Pending on B', null, null, null, null, null, 'normal', null, :'adult_b_member_id') as removal_pending_task_id \gset
select public.create_shared_family_task(:'family_id', 'Accepted by B') as removal_accepted_task_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);
select public.take_family_task(:'removal_accepted_task_id');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.remove_family_member(%L) $$, :'adult_b_member_id'),
  'the owner can remove a member who has active task assignments — no FK violation'
);

select is(
  (select assignment_status from public.tasks where id = :'removal_pending_task_id'),
  'unassigned',
  'a pending assignment is resolved to unassigned when the recipient is removed'
);
select is(
  (select assignment_status from public.tasks where id = :'removal_accepted_task_id'),
  'unassigned',
  'an accepted assignment is resolved to unassigned when the assignee is removed'
);
select is(
  (select count(*)::int from public.task_assignments where task_id = :'removal_accepted_task_id' and action = 'unassigned'),
  1,
  'the removal-triggered unassignment is a permanent audit entry'
);
select is(
  (select removed_at is not null from public.family_members where id = :'adult_b_member_id'),
  true,
  'the removed member''s row is soft-deleted, not hard-deleted'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

-- authenticated still has a SELECT grant on tasks (unchanged) — RLS is
-- what filters this to zero rows, not the grant itself, same as the
-- outsider case earlier in this file.
select is(
  (select count(*)::int from public.tasks where family_id = :'family_id'),
  0,
  'a removed member loses task access immediately (is_family_member now excludes them)'
);

select throws_ok(
  format($$ select public.take_family_task(%L) $$, :'unassigned_task_id'),
  '42501',
  null,
  'a removed member cannot call any shared-task RPC for their former family anymore'
);

-- personal tasks are unaffected by another member's removal
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_task('Untouched personal task') as untouched_personal_task_id \gset

select ok(
  (select count(*)::int from public.tasks where id = :'untouched_personal_task_id') = 1,
  'the owner''s own personal task is unaffected by removing a different family member'
);

-- ---------------------------------------------------------------------------
-- sanitized family_task_board: assignee is visible for a Family-visible
-- task (collaborative — not the private-task sanitization case, already
-- covered by 090's secret-marker sweep)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select ok(
  (select assignee_member_id from public.family_task_board where id = :'removal_pending_task_id') is null,
  'a same-family adult sees the resolved (now null) assignee on the family board'
);

-- ---------------------------------------------------------------------------
-- anon: no EXECUTE on any of the new RPCs
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  format($$ select public.create_shared_family_task(%L, 'x') $$, :'family_id'),
  '42501', null, 'anon cannot call create_shared_family_task'
);
select throws_ok(
  format($$ select public.assign_family_task(%L, %L) $$, :'unassigned_task_id', :'adult_c_member_id'),
  '42501', null, 'anon cannot call assign_family_task'
);
select throws_ok(
  format($$ select public.reassign_family_task(%L, %L) $$, :'unassigned_task_id', :'adult_c_member_id'),
  '42501', null, 'anon cannot call reassign_family_task'
);
select throws_ok(
  format($$ select public.unassign_family_task(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call unassign_family_task'
);
select throws_ok(
  format($$ select public.take_family_task(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call take_family_task'
);
select throws_ok(
  format($$ select public.accept_task_assignment(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call accept_task_assignment'
);
select throws_ok(
  format($$ select public.decline_task_assignment(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call decline_task_assignment'
);
select throws_ok(
  format($$ select public.complete_shared_task(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call complete_shared_task'
);
select throws_ok(
  format($$ select public.restore_shared_task(%L) $$, :'unassigned_task_id'),
  '42501', null, 'anon cannot call restore_shared_task'
);
select throws_ok(
  format($$ select public.current_member_id(%L) $$, :'family_id'),
  '42501', null, 'anon cannot call current_member_id'
);
select throws_ok(
  format($$ select public.set_task_assignment(%L, %L, 'assigned') $$, :'unassigned_task_id', :'adult_c_member_id'),
  '42501', null, 'anon cannot call the internal set_task_assignment helper either'
);

-- authenticated cannot call the internal helper directly (only via the two public wrappers)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.set_task_assignment(%L, %L, 'assigned') $$, :'unassigned_task_id', :'adult_c_member_id'),
  '42501', null, 'set_task_assignment is not directly callable even by an authenticated family owner'
);

-- ---------------------------------------------------------------------------
-- append-only: task_assignments still has no UPDATE/DELETE grant (Phase 2,
-- reconfirmed unaffected by Phase 5)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.task_assignments set action = 'declined' where task_id = %L $$, :'take_task_id'),
  '42501', null, 'task_assignments rows still cannot be UPDATEd by anyone'
);
select throws_ok(
  format($$ delete from public.task_assignments where task_id = %L $$, :'take_task_id'),
  '42501', null, 'task_assignments rows still cannot be DELETEd by anyone'
);

select * from finish();
rollback;
