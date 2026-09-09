-- Tests: Phase 9 completion pass (Sync Issues resolution UX) — the one
-- server-side change this pass makes: distinguishing "the row is gone"
-- (P0002) from "the row exists but isn't yours" (42501) across
-- update_personal_task, schedule_personal_task, complete_personal_task,
-- restore_personal_task, complete_task_occurrence, restore_task_occurrence.
-- Also covers the guarantees the client-side resolution flows depend on:
-- an update touches only the fields explicitly passed (never an unrelated
-- server field), a resolved stale-write conflict can conflict again on a
-- second concurrent write, and the occurrence RPCs' own idempotent-replay
-- guarantee (a repeat call is a safe no-op, never an error) — see
-- docs/DECISIONS.md, "Phase 9."
begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['si-owner@test.local', 'si-outsider@test.local']) as email;

select id as owner_id from auth.users where email = 'si-owner@test.local' \gset
select id as outsider_id from auth.users where email = 'si-outsider@test.local' \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- P0002 (not found) vs 42501 (not yours) — a deleted task's id genuinely
-- exists nowhere findable (soft-deleted rows are excluded by every RPC's
-- own `deleted_at is null` check), which is exactly the "gone" case the
-- Sync Issues screen needs to show "This task no longer exists" for.
-- ---------------------------------------------------------------------------

select public.create_personal_task('To be deleted', p_date := '2026-11-01') as gone_task_id \gset
select public.delete_or_archive_personal_task(:'gone_task_id');

select throws_ok(
  format($$ select public.update_personal_task(%L, p_title := 'edit') $$, :'gone_task_id'),
  'P0002',
  null,
  'update_personal_task raises P0002 for a soft-deleted (gone) task'
);
select throws_ok(
  format($$ select public.schedule_personal_task(%L, '2026-11-05') $$, :'gone_task_id'),
  'P0002',
  null,
  'schedule_personal_task raises P0002 for a gone task'
);
select throws_ok(
  format($$ select public.complete_personal_task(%L) $$, :'gone_task_id'),
  'P0002',
  null,
  'complete_personal_task raises P0002 for a gone task'
);
select throws_ok(
  format($$ select public.restore_personal_task(%L) $$, :'gone_task_id'),
  'P0002',
  null,
  'restore_personal_task raises P0002 for a gone task'
);

-- A genuinely nonexistent id (never created at all) hits the same P0002
-- path, not a generic 42501 — "not found" and "never existed" are the same
-- observable case to the caller.
select throws_ok(
  $$ select public.update_personal_task('00000000-0000-0000-0000-000000000099', p_title := 'edit') $$,
  'P0002',
  null,
  'update_personal_task raises P0002 for an id that never existed'
);

-- "Not yours" stays 42501, distinct from "gone" — the outsider's own task
-- is a genuinely existing row this caller was never authorized on.
select public.create_personal_task('Owner-only task', p_date := '2026-11-02') as owned_task_id \gset
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.update_personal_task(%L, p_title := 'not mine') $$, :'owned_task_id'),
  '42501',
  null,
  'update_personal_task raises 42501 (never P0002) for a task that exists but belongs to someone else'
);
select throws_ok(
  format($$ select public.complete_personal_task(%L) $$, :'owned_task_id'),
  '42501',
  null,
  'complete_personal_task raises 42501 for another profile''s task'
);
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Same P0002/42501 split for the occurrence RPCs.
-- ---------------------------------------------------------------------------

-- generate_task_occurrences clamps to a 45-day rolling horizon from the
-- real current_date regardless of the requested p_through_date (see its
-- own comment in 20260908120000_recurring_tasks_reminders.sql) — the
-- series must start within that horizon or nothing gets generated.
select public.create_recurring_personal_task(
  'Daily sync-issue test', current_date + 1, 'UTC', 'daily',
  p_start_time := '08:00', p_duration_minutes := 15
) as recurring_id \gset
select public.generate_task_occurrences(current_date + 7);
select id as occ_id from public.task_occurrences where task_id = :'recurring_id' order by occurrence_date limit 1 \gset

select throws_ok(
  $$ select public.complete_task_occurrence('00000000-0000-0000-0000-000000000098') $$,
  'P0002',
  null,
  'complete_task_occurrence raises P0002 for an occurrence id that does not exist'
);
select throws_ok(
  $$ select public.restore_task_occurrence('00000000-0000-0000-0000-000000000098') $$,
  'P0002',
  null,
  'restore_task_occurrence raises P0002 for an occurrence id that does not exist'
);

select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.complete_task_occurrence(%L) $$, :'occ_id'),
  '42501',
  null,
  'complete_task_occurrence raises 42501 (never P0002) for another profile''s occurrence'
);
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Occurrence RPCs are idempotent by construction (a WHERE status = ...
-- guard, no client_operation_id needed) — a repeat "Retry"/double-tap call
-- is a safe no-op, never a second error and never a second state change.
-- ---------------------------------------------------------------------------

select public.complete_task_occurrence(:'occ_id');
select status::text from public.task_occurrences where id = :'occ_id' \gset first_complete_
select is(:'first_complete_status'::text, 'completed', 'complete_task_occurrence transitions a scheduled occurrence to completed');

select lives_ok(
  format($$ select public.complete_task_occurrence(%L) $$, :'occ_id'),
  'a repeat complete_task_occurrence call on an already-completed occurrence never errors (idempotent retry/double-tap)'
);
select status::text from public.task_occurrences where id = :'occ_id' \gset second_complete_
select is(:'second_complete_status'::text, 'completed', 'a repeat complete_task_occurrence call leaves the occurrence completed, not double-applied');

select public.restore_task_occurrence(:'occ_id');
select lives_ok(
  format($$ select public.restore_task_occurrence(%L) $$, :'occ_id'),
  'a repeat restore_task_occurrence call on an already-scheduled occurrence never errors (idempotent)'
);

-- ---------------------------------------------------------------------------
-- "Apply my change" never overwrites a field outside the original patch —
-- update_personal_task with only p_title set must leave every other
-- column exactly as it was.
-- ---------------------------------------------------------------------------

select public.create_personal_task(
  'Untouched-fields task', p_description := 'Original description',
  p_priority := 'important', p_visibility := 'private'
) as fields_task_id \gset
select public.update_personal_task(:'fields_task_id', p_title := 'New title only');
select is(
  (select description from public.tasks where id = :'fields_task_id'),
  'Original description',
  'update_personal_task with only p_title set leaves description untouched'
);
select is(
  (select priority from public.tasks where id = :'fields_task_id'),
  'important',
  'update_personal_task with only p_title set leaves priority untouched'
);
select is(
  (select visibility::text from public.tasks where id = :'fields_task_id'),
  'private',
  'update_personal_task with only p_title set leaves visibility untouched'
);

-- ---------------------------------------------------------------------------
-- A resolved conflict can conflict again — Apply's own concurrency check
-- is re-armed on every attempt, never a one-shot allowance. Simulates a
-- second concurrent write the same way 150_realtime_offline_conflicts_test
-- does (now() is frozen for this transaction, so a real wall-clock retry
-- can never observe updated_at having advanced on its own).
-- ---------------------------------------------------------------------------

select public.create_personal_task('Repeat-conflict task', p_date := '2026-11-04') as repeat_task_id \gset
select updated_at from public.tasks where id = :'repeat_task_id' \gset rc_original_

set local role postgres;
alter table public.tasks disable trigger set_tasks_updated_at;
update public.tasks set updated_at = :'rc_original_updated_at'::timestamptz + interval '1 minute'
where id = :'repeat_task_id'
returning updated_at \gset rc_bumped_
alter table public.tasks enable trigger set_tasks_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- First "Apply" attempt, correctly based on the fresh server version, succeeds.
select public.update_personal_task(:'repeat_task_id', p_title := 'Applied once', p_expected_updated_at := :'rc_bumped_updated_at'::timestamptz);

-- A second concurrent write lands (simulating another device) before this
-- same client tries to "Apply" again with its now-stale expectation.
set local role postgres;
alter table public.tasks disable trigger set_tasks_updated_at;
update public.tasks set updated_at = :'rc_bumped_updated_at'::timestamptz + interval '2 minutes'
where id = :'repeat_task_id';
alter table public.tasks enable trigger set_tasks_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Applied again on stale base', p_expected_updated_at := %L::timestamptz) $$, :'repeat_task_id', :'rc_bumped_updated_at'),
  '40001',
  null,
  'a second concurrent update after a resolved conflict raises 40001 again — never silently allowed through'
);

-- ---------------------------------------------------------------------------
-- anon spot-check — already covered structurally by the schema-wide
-- anon-EXECUTE-grant guard (130_security_regression_test.sql), this is a
-- direct confirmation for the two RPCs this migration actually changed.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ set local role anon; select public.update_personal_task(%L, p_title := 'anon') $$, :'owned_task_id'),
  '42501',
  null,
  'anon cannot call update_personal_task at all'
);
select throws_ok(
  format($$ set local role anon; select public.complete_task_occurrence(%L) $$, :'occ_id'),
  '42501',
  null,
  'anon cannot call complete_task_occurrence at all'
);

select * from finish();
rollback;
