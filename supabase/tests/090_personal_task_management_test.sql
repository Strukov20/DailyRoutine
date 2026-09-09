-- Tests: the personal-task RPC lifecycle (create/update/complete/restore/
-- schedule/move-to-inbox/delete-or-archive), the two new CHECK constraints
-- (time requires date, duration bounded), the regression that tasks has no
-- direct write grant at all anymore, cross-family/outsider/ownership
-- rejection, soft-delete exclusion from every read path (including the
-- owner's own), and a secret-marker sweep proving family_task_board still
-- never leaks a private task's content. Mirrors the conventions in
-- 040_tasks_and_assignments_test.sql / 060_privacy_regression_test.sql /
-- 080_family_management_test.sql.
begin;
select plan(56);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'pt-owner@test.local', 'pt-adult@test.local', 'pt-outsider@test.local'
]) as email;

select id as owner_id from auth.users where email = 'pt-owner@test.local' \gset
select id as adult_id from auth.users where email = 'pt-adult@test.local' \gset
select id as outsider_id from auth.users where email = 'pt-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Task Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Family', :'outsider_id', :'outsider_id')
returning id as other_family_id \gset

insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id');
insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'adult', :'adult_id', 'Adult', :'owner_id');
insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'other_family_id', 'adult', 'owner', :'outsider_id', 'Outsider Owner', :'outsider_id');

-- ---------------------------------------------------------------------------
-- Regression: no direct write grant on tasks at all
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format(
    $$ insert into public.tasks (owner_profile_id, title, created_by) values (%L, 'Direct insert', %L) $$,
    :'owner_id', :'owner_id'
  ),
  '42501',
  null,
  'authenticated has no direct INSERT grant on tasks — must go through create_personal_task'
);

-- ---------------------------------------------------------------------------
-- create_personal_task
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_personal_task('   ') $$,
  '23514',
  null,
  'a blank title is rejected (tasks_title_check)'
);

select public.create_personal_task('Inbox task') as inbox_task_id \gset

select is(
  (select date from public.tasks where id = :'inbox_task_id'),
  null,
  'a title-only task lands in the Inbox (date is null)'
);

select is(
  (select owner_profile_id from public.tasks where id = :'inbox_task_id'),
  :'owner_id',
  'owner_profile_id is always the caller, never a parameter'
);

-- date without time
select public.create_personal_task('Anytime today', null, current_date) as anytime_task_id \gset

select ok(
  (select date from public.tasks where id = :'anytime_task_id') = current_date
  and (select start_time from public.tasks where id = :'anytime_task_id') is null,
  'a task can be scheduled with a date and no time (Anytime)'
);

-- date with time
select public.create_personal_task(
  'Timed today', null, current_date, '14:00', 30, 'Europe/Kyiv'
) as timed_task_id \gset

select ok(
  (select start_time from public.tasks where id = :'timed_task_id') = '14:00'::time
  and (select duration_minutes from public.tasks where id = :'timed_task_id') = 30,
  'a task can be scheduled with a date, start time, and duration'
);

-- invalid: time without date
select throws_ok(
  $$ select public.create_personal_task('Bad', null, null, '14:00', null, 'Europe/Kyiv') $$,
  '23514',
  null,
  'a start_time without a date is rejected (tasks_time_requires_date)'
);

-- invalid: time without timezone
select throws_ok(
  format($$ select public.create_personal_task('Bad', null, %L, '14:00') $$, current_date),
  '23514',
  null,
  'a start_time without a timezone is rejected (tasks_time_requires_timezone)'
);

-- invalid: duration too large
select throws_ok(
  format(
    $$ select public.create_personal_task('Bad', null, %L, '14:00', 1500, 'Europe/Kyiv') $$,
    current_date
  ),
  '23514',
  null,
  'a duration over 1440 minutes is rejected (tasks_duration_minutes_bounded)'
);

-- invalid: duration without start_time
select throws_ok(
  format($$ select public.create_personal_task('Bad', null, %L, null, 30) $$, current_date),
  '23514',
  null,
  'a duration without a start_time is rejected (tasks_duration_requires_time)'
);

-- cross-family: creating a task attached to a family the caller isn't in
select throws_ok(
  format($$ select public.create_personal_task('Bad', null, null, null, null, null, 'normal', null, 'private', %L) $$, :'other_family_id'),
  '42501',
  null,
  'creating a task attached to a family the caller does not belong to is rejected'
);

-- ---------------------------------------------------------------------------
-- update_personal_task
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select public.update_personal_task(%L, 'Renamed inbox task', null, false, 'important') $$, :'inbox_task_id'),
  'the owner can update their own task'
);

select is(
  (select title from public.tasks where id = :'inbox_task_id'),
  'Renamed inbox task',
  'the title was updated'
);

select is(
  (select priority from public.tasks where id = :'inbox_task_id'),
  'important',
  'the priority was updated'
);

-- Unsupplied fields are left unchanged.
select lives_ok(
  format($$ select public.update_personal_task(%L) $$, :'inbox_task_id'),
  'calling update with no fields supplied leaves the row unchanged'
);

select is(
  (select title from public.tasks where id = :'inbox_task_id'),
  'Renamed inbox task',
  'the title is still the previously-updated value — an empty update did not clobber it'
);

-- description clear flag
select lives_ok(
  format($$ select public.update_personal_task(%L, null, 'Has a description') $$, :'inbox_task_id'),
  'setting a description succeeds'
);
select lives_ok(
  format($$ select public.update_personal_task(%L, null, null, true) $$, :'inbox_task_id'),
  'clearing a description via p_clear_description succeeds'
);
select is(
  (select description from public.tasks where id = :'inbox_task_id'),
  null,
  'the description was actually cleared'
);

-- Ownership: another family member cannot update someone else's personal task
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_personal_task(%L, 'Hijacked') $$, :'inbox_task_id'),
  '42501',
  null,
  'a same-family adult cannot update another member''s personal task'
);

select throws_ok(
  format($$ select public.complete_personal_task(%L) $$, :'inbox_task_id'),
  '42501',
  null,
  'a same-family adult cannot complete another member''s personal task'
);

select throws_ok(
  format($$ select public.delete_or_archive_personal_task(%L) $$, :'inbox_task_id'),
  '42501',
  null,
  'a same-family adult cannot archive another member''s personal task'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_personal_task(%L, 'Hijacked') $$, :'inbox_task_id'),
  '42501',
  null,
  'a total outsider cannot update someone else''s personal task either'
);

select is(
  (select count(*)::int from public.tasks where id = :'inbox_task_id'),
  0,
  'an outsider gets zero rows for the task via the base table (RLS)'
);

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
  format($$ select public.update_personal_task(%L, 'Hijacked') $$, :'inbox_task_id'),
  '42501',
  null,
  'anonymous cannot call update_personal_task'
);

select throws_ok(
  $$ select public.create_personal_task('anon task') $$,
  '42501',
  null,
  'anonymous cannot call create_personal_task'
);

-- ---------------------------------------------------------------------------
-- complete / restore — idempotent
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.complete_personal_task(%L) $$, :'inbox_task_id'),
  'the owner can complete their own task'
);

select ok(
  (select completed_at from public.tasks where id = :'inbox_task_id') is not null,
  'completed_at was set'
);

select lives_ok(
  format($$ select public.complete_personal_task(%L) $$, :'inbox_task_id'),
  'completing an already-completed task is a safe no-op (idempotent)'
);

select lives_ok(
  format($$ select public.restore_personal_task(%L) $$, :'inbox_task_id'),
  'the owner can undo completion'
);

select is(
  (select completed_at from public.tasks where id = :'inbox_task_id'),
  null,
  'completed_at was cleared'
);

select lives_ok(
  format($$ select public.restore_personal_task(%L) $$, :'inbox_task_id'),
  'restoring an already-active task is a safe no-op (idempotent)'
);

-- ---------------------------------------------------------------------------
-- schedule_personal_task / move_task_to_inbox
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.schedule_personal_task(gen_random_uuid(), null) $$,
  '22023',
  null,
  'p_date is required by schedule_personal_task'
);

select lives_ok(
  format(
    $$ select public.schedule_personal_task(%L, current_date + 1, '09:00', 15, 'Europe/Kyiv') $$,
    :'inbox_task_id'
  ),
  'scheduling an Inbox task for tomorrow, timed, succeeds'
);

select ok(
  (select date from public.tasks where id = :'inbox_task_id') = current_date + 1
  and (select start_time from public.tasks where id = :'inbox_task_id') = '09:00'::time
  and (select duration_minutes from public.tasks where id = :'inbox_task_id') = 15,
  'date/start_time/duration were all set atomically'
);

select lives_ok(
  format($$ select public.schedule_personal_task(%L, current_date) $$, :'inbox_task_id'),
  'rescheduling to a date-only (Anytime) slot succeeds'
);

select ok(
  (select start_time from public.tasks where id = :'inbox_task_id') is null
  and (select duration_minutes from public.tasks where id = :'inbox_task_id') is null,
  'rescheduling to date-only wholesale-replaces the old start_time/duration (no stale leftovers)'
);

select lives_ok(
  format($$ select public.move_task_to_inbox(%L) $$, :'inbox_task_id'),
  'moving back to the Inbox succeeds'
);

select ok(
  (select date from public.tasks where id = :'inbox_task_id') is null
  and (select start_time from public.tasks where id = :'inbox_task_id') is null
  and (select duration_minutes from public.tasks where id = :'inbox_task_id') is null
  and (select timezone from public.tasks where id = :'inbox_task_id') is null,
  'date/start_time/duration/timezone are all cleared'
);

-- ---------------------------------------------------------------------------
-- delete_or_archive_personal_task — idempotent soft delete, disappears
-- from every normal read path including the owner's own
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select public.delete_or_archive_personal_task(%L) $$, :'inbox_task_id'),
  'the owner can archive their own task'
);

select is(
  (select count(*)::int from public.tasks where id = :'inbox_task_id'),
  0,
  'the archived task no longer appears even to its own owner via the base table SELECT'
);

select lives_ok(
  format($$ select public.delete_or_archive_personal_task(%L) $$, :'inbox_task_id'),
  'archiving an already-archived task is a safe no-op (idempotent)'
);

-- Phase 9 final security pass ("Sync Issues" — see docs/DECISIONS.md): a
-- soft-deleted task raises the same 42501 "unavailable" every other RPC
-- caller sees for a task they don't own — deliberately indistinguishable,
-- never a distinct P0002 (that earlier split was a cross-user existence
-- oracle, removed).
select throws_ok(
  format($$ select public.complete_personal_task(%L) $$, :'inbox_task_id'),
  '42501',
  null,
  'an archived task is treated as unavailable by every other RPC (cannot complete it)'
);

select throws_ok(
  format($$ select public.update_personal_task(%L, 'Nope') $$, :'inbox_task_id'),
  '42501',
  null,
  'an archived task cannot be updated either'
);

-- ---------------------------------------------------------------------------
-- Private-content secret-marker sweep through family_task_board (mirrors
-- 060_privacy_regression_test.sql's pattern for the new RPC-only write path)
-- ---------------------------------------------------------------------------
select 'SECRET-MARKER-' || substr(gen_random_uuid()::text, 1, 8) as secret \gset

select public.create_personal_task(
  :'secret', :'secret', current_date, null, null, null, 'normal', null, 'private', :'family_id'
) as private_family_task_id \gset

select public.create_personal_task(
  :'secret', :'secret', current_date, null, null, null, 'normal', null, 'family', :'family_id'
) as family_visible_task_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.tasks where id = :'private_family_task_id'),
  0,
  '[base table] a same-family adult gets zero rows for the private task'
);

select ok(
  (select count(*)::int from public.family_task_board where id = :'private_family_task_id') = 1,
  '[family_task_board] the private task DOES appear as a row (Busy-equivalent)'
);

select is(
  (select title from public.family_task_board where id = :'private_family_task_id'),
  null,
  '[family_task_board] title is null, not the secret, for a same-family adult'
);

select is(
  (select title from public.family_task_board where id = :'family_visible_task_id'),
  :'secret',
  '[family_task_board] a Family-visibility task exposes its real title'
);

select is(
  (
    select count(*)::int from public.family_task_board
    where title = :'secret' or description::text = :'secret'
  ),
  1,
  '[broad sweep] the secret appears in exactly one row of family_task_board — the '
  'Family-visible task, never the private one'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_task_board where id = :'private_family_task_id'),
  0,
  '[family_task_board] an outsider gets zero rows for the private task, not even a Busy row'
);

select is(
  (select count(*)::int from public.family_task_board where id = :'family_visible_task_id'),
  0,
  '[family_task_board] an outsider gets zero rows for the Family-visible task either'
);

-- ---------------------------------------------------------------------------
-- create_custom_category
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ insert into public.categories (family_id, name, color_token, created_by) values (%L, 'Direct insert', 'work', %L) $$, :'family_id', :'owner_id'),
  '42501',
  null,
  'authenticated has no direct INSERT grant on categories — must go through create_custom_category'
);

select public.create_custom_category(:'family_id', 'Errands', 'work') as custom_category_id \gset

select is(
  (select is_system from public.categories where id = :'custom_category_id'),
  false,
  'the created category is not a system category'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_custom_category(%L, 'Not allowed', 'home') $$, :'family_id'),
  '42501',
  null,
  'a non-owner adult cannot create a custom category'
);

-- A task can reference the custom category (owner, same family).
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format(
    $$ select public.create_personal_task('Errand', null, null, null, null, null, 'normal', %L, 'private', %L) $$,
    :'custom_category_id', :'family_id'
  ),
  'a task can use the family''s custom category'
);

select * from finish();
rollback;
