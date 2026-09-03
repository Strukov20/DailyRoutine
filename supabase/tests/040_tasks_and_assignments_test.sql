-- Tests: tasks RLS + integrity, task_assignments workflow.
begin;
select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'task-owner-a@test.local', 'task-adult-b@test.local', 'task-outsider-c@test.local', 'task-owner-d@test.local'
]) as email;

select id as owner_a_id from auth.users where email = 'task-owner-a@test.local' \gset
select id as adult_b_id from auth.users where email = 'task-adult-b@test.local' \gset
select id as outsider_c_id from auth.users where email = 'task-outsider-c@test.local' \gset
select id as owner_d_id from auth.users where email = 'task-owner-d@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Task Family Alpha', :'owner_a_id', :'owner_a_id')
returning id as family_alpha_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Task Family Beta', :'owner_d_id', :'owner_d_id')
returning id as family_beta_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_alpha_id', 'adult', 'owner', :'owner_a_id', 'Owner A', :'owner_a_id')
returning id as owner_a_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_alpha_id', 'adult', 'adult', :'adult_b_id', 'Adult B', :'owner_a_id')
returning id as adult_b_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_beta_id', 'adult', 'owner', :'owner_d_id', 'Owner D', :'owner_d_id')
returning id as owner_d_member_id \gset

-- ---------------------------------------------------------------------------
-- Integrity: cross-family assignment is rejected at the database level
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.tasks (owner_profile_id, family_id, title, visibility, assignee_member_id, created_by)
       values (%L, %L, 'Cross-family task', 'family', %L, %L) $$,
    :'owner_a_id', :'family_alpha_id', :'owner_d_member_id', :'owner_a_id'
  ),
  '23503',
  null,
  'assigning a task to a member of a different family violates the composite FK'
);

-- ---------------------------------------------------------------------------
-- Integrity: a private task cannot be assigned to anyone but its owner
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.tasks (owner_profile_id, family_id, title, visibility, assignee_member_id, created_by)
       values (%L, %L, 'Private but assigned to someone else', 'private', %L, %L) $$,
    :'owner_a_id', :'family_alpha_id', :'adult_b_member_id', :'owner_a_id'
  ),
  '23514',
  null,
  'a private task assigned to a non-owner is rejected by assert_task_integrity'
);

-- ---------------------------------------------------------------------------
-- Integrity: a personal (family_id null) task cannot carry an assignee
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.tasks (owner_profile_id, title, assignee_member_id, created_by)
       values (%L, 'Personal task with assignee', %L, %L) $$,
    :'owner_a_id', :'adult_b_member_id', :'owner_a_id'
  ),
  '23514',
  null,
  'a personal task (family_id null) with an assignee violates tasks_personal_no_assignment'
);

-- ---------------------------------------------------------------------------
-- Create real tasks for RLS + workflow assertions
-- ---------------------------------------------------------------------------
insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_a_id', :'family_alpha_id', 'Family-visible task', 'family', :'owner_a_id')
returning id as family_task_id \gset

insert into public.tasks (id, owner_profile_id, family_id, title, visibility, created_by)
values (gen_random_uuid(), :'owner_a_id', :'family_alpha_id', 'Private family-linked task', 'private', :'owner_a_id')
returning id as private_task_id \gset

insert into public.tasks (id, owner_profile_id, title, created_by)
values (gen_random_uuid(), :'owner_a_id', 'Owner A''s personal task', :'owner_a_id')
returning id as personal_task_id \gset

-- ---------------------------------------------------------------------------
-- RLS: visibility
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.tasks where id = :'family_task_id'),
  1,
  'adult B (same family) sees the family-visible task via the base table'
);

select is(
  (select count(*)::int from public.tasks where id = :'private_task_id'),
  0,
  'adult B cannot see owner A''s private task via the base table'
);

select is(
  (select count(*)::int from public.tasks where id = :'personal_task_id'),
  0,
  'adult B cannot see owner A''s personal (non-family) task'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_c_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.tasks where family_id = :'family_alpha_id'),
  0,
  'outsider C sees zero of Family Alpha''s tasks, family-visible included'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_a_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.tasks where owner_profile_id = :'owner_a_id'),
  3,
  'owner A sees all 3 of their own tasks regardless of visibility'
);

-- Phase 4: authenticated has no direct UPDATE grant on tasks at all anymore
-- (every mutation is a SECURITY DEFINER RPC — see
-- supabase/migrations/20260904120000_personal_task_management.sql), so a
-- raw client-facing UPDATE fails on the grant before it would ever reach
-- the composite FK. This is a stricter, not weaker, guarantee than the
-- FK-violation this test originally asserted: it used to prove a
-- cross-family assignee_member_id specifically couldn't be written via
-- UPDATE; it now proves *no* field can be written via UPDATE at all.
select throws_ok(
  format(
    $$ update public.tasks set assignee_member_id = %L where id = %L $$,
    :'owner_d_member_id', :'family_task_id'
  ),
  '42501',
  null,
  'no direct UPDATE grant on tasks at all (Phase 4) — a fortiori, no cross-family assignee via UPDATE'
);

-- ---------------------------------------------------------------------------
-- task_assignments workflow
-- ---------------------------------------------------------------------------
-- Owner A assigns the family-visible task to adult B.
select lives_ok(
  format(
    $$ insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
       values (%L, %L, %L, 'assigned') $$,
    :'family_task_id', :'adult_b_member_id', :'owner_a_member_id'
  ),
  'owner A (an existing family member) can assign the task to adult B'
);

select is(
  (select assignment_status from public.tasks where id = :'family_task_id'),
  'pending_acceptance',
  'assigning sets assignment_status to pending_acceptance, not an automatic accept'
);

select is(
  (select assignee_member_id from public.tasks where id = :'family_task_id'),
  :'adult_b_member_id',
  'the task''s assignee snapshot reflects the new assignment'
);

-- Wrong user (outsider) cannot accept an assignment addressed to adult B.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format(
    $$ insert into public.task_assignments (task_id, assigned_to_member_id, action)
       values (%L, %L, 'accepted') $$,
    :'family_task_id', :'adult_b_member_id'
  ),
  '42501',
  null,
  'an outsider cannot even see/insert against this family''s task_assignments row (grant/RLS blocks it)'
);

-- The actual assignee (adult B) accepts.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format(
    $$ insert into public.task_assignments (task_id, assigned_to_member_id, action)
       values (%L, %L, 'accepted') $$,
    :'family_task_id', :'adult_b_member_id'
  ),
  'adult B can accept an assignment addressed to themselves'
);

select is(
  (select assignment_status from public.tasks where id = :'family_task_id'),
  'accepted',
  'the task''s assignment_status reflects the acceptance'
);

-- adult B cannot fabricate an "accepted" action addressed to someone else.
select throws_ok(
  format(
    $$ insert into public.task_assignments (task_id, assigned_to_member_id, action)
       values (%L, %L, 'accepted') $$,
    :'private_task_id', :'owner_a_member_id'
  ),
  '42501',
  null,
  'adult B cannot record an acceptance addressed to owner A (not their own member row)'
);

-- ---------------------------------------------------------------------------
-- task_assignments is append-only: no UPDATE/DELETE grant exists
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.task_assignments set action = 'declined' where task_id = %L $$, :'family_task_id'),
  '42501',
  null,
  'task_assignments rows cannot be UPDATEd by anyone — append-only by construction'
);

select throws_ok(
  format($$ delete from public.task_assignments where task_id = %L $$, :'family_task_id'),
  '42501',
  null,
  'task_assignments rows cannot be DELETEd by anyone — append-only by construction'
);

-- ---------------------------------------------------------------------------
-- RLS: anonymous
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from public.tasks $$,
  '42501',
  null,
  'anonymous has no grant on tasks at all'
);

select throws_ok(
  $$ select count(*) from public.task_assignments $$,
  '42501',
  null,
  'anonymous has no grant on task_assignments at all'
);

select * from finish();
rollback;
