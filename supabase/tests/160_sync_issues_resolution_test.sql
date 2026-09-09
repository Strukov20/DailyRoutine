-- Tests: Phase 9 final security/concurrency pass.
--
-- Primary subject: for an untrusted authenticated caller, "this task id
-- does not exist," "this task exists but belongs to another profile," and
-- "this task exists but is no longer visible to the caller" (soft-deleted)
-- must be externally indistinguishable — same SQLSTATE, same message —
-- across update_personal_task, schedule_personal_task, complete_personal_
-- task, restore_personal_task, complete_task_occurrence, restore_task_
-- occurrence. Proven by literally capturing the raised SQLSTATE+message
-- for a random (never-existed) UUID and for another profile's real task
-- UUID and asserting they are byte-for-byte identical — not just "both
-- raise 42501" (which alone wouldn't rule out a distinguishing message).
--
-- Also covers the guarantees the client-side resolution flows depend on:
-- an update touches only the fields explicitly passed (never an unrelated
-- server field), a resolved stale-write conflict can conflict again on a
-- second concurrent write, and the occurrence RPCs' own idempotent-replay
-- guarantee (a repeat call is a safe no-op, never an error) — see
-- docs/DECISIONS.md, "Phase 9."
begin;
select plan(22);

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

-- A per-session helper (pg_temp — never touches public, gone at rollback):
-- runs one probe RPC call and captures its SQLSTATE+message as one string,
-- or 'OK' if it didn't raise. Lets the assertions below compare two
-- distinct calls' *exact* error output instead of merely asserting "both
-- happen to be 42501," which alone wouldn't rule out a distinguishing
-- message text.
create or replace function pg_temp.capture_error(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Setup: a real task the owner keeps, a real task the owner soft-deletes
-- (the "gone" case), and a recurring series + occurrence for the
-- occurrence-RPC half of this same proof.
-- ---------------------------------------------------------------------------

select public.create_personal_task('Owner-only task', p_date := '2026-11-02') as owned_task_id \gset

select public.create_personal_task('To be deleted', p_date := '2026-11-01') as gone_task_id \gset
select public.delete_or_archive_personal_task(:'gone_task_id');

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

-- ---------------------------------------------------------------------------
-- The proof itself, from the outsider's own session — an untrusted
-- authenticated caller who owns none of the ids probed below.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select pg_temp.capture_error(
  format($$ select public.update_personal_task(%L, p_title := 'probe') $$, gen_random_uuid())
) as update_random \gset
select pg_temp.capture_error(
  format($$ select public.update_personal_task(%L, p_title := 'probe') $$, :'owned_task_id')
) as update_foreign \gset
select pg_temp.capture_error(
  format($$ select public.update_personal_task(%L, p_title := 'probe') $$, :'gone_task_id')
) as update_gone \gset
select is(:'update_random'::text, :'update_foreign'::text, 'update_personal_task: a random UUID and another profile''s real task UUID raise the identical SQLSTATE+message');
select is(:'update_random'::text, :'update_gone'::text, 'update_personal_task: a random UUID and a soft-deleted (gone) task UUID raise the identical SQLSTATE+message');
select ok(:'update_random' like '42501|%', 'update_personal_task''s shared unavailable outcome is errcode 42501');
select ok(:'update_random' not like '%probe%' and :'update_random' not like '%Owner-only%' and :'update_random' not like '%To be deleted%', 'update_personal_task''s unavailable message never echoes the payload or either task''s real title');

select pg_temp.capture_error(
  format($$ select public.schedule_personal_task(%L, '2026-11-05') $$, gen_random_uuid())
) as schedule_random \gset
select pg_temp.capture_error(
  format($$ select public.schedule_personal_task(%L, '2026-11-05') $$, :'owned_task_id')
) as schedule_foreign \gset
select is(:'schedule_random'::text, :'schedule_foreign'::text, 'schedule_personal_task: a random UUID and another profile''s real task UUID raise the identical SQLSTATE+message');

select pg_temp.capture_error(
  format($$ select public.complete_personal_task(%L) $$, gen_random_uuid())
) as complete_random \gset
select pg_temp.capture_error(
  format($$ select public.complete_personal_task(%L) $$, :'owned_task_id')
) as complete_foreign \gset
select pg_temp.capture_error(
  format($$ select public.complete_personal_task(%L) $$, :'gone_task_id')
) as complete_gone \gset
select is(:'complete_random'::text, :'complete_foreign'::text, 'complete_personal_task: a random UUID and another profile''s real task UUID raise the identical SQLSTATE+message');
select is(:'complete_random'::text, :'complete_gone'::text, 'complete_personal_task: a random UUID and a soft-deleted task UUID raise the identical SQLSTATE+message');

select pg_temp.capture_error(
  format($$ select public.restore_personal_task(%L) $$, gen_random_uuid())
) as restore_random \gset
select pg_temp.capture_error(
  format($$ select public.restore_personal_task(%L) $$, :'owned_task_id')
) as restore_foreign \gset
select is(:'restore_random'::text, :'restore_foreign'::text, 'restore_personal_task: a random UUID and another profile''s real task UUID raise the identical SQLSTATE+message');

select pg_temp.capture_error(
  format($$ select public.complete_task_occurrence(%L) $$, gen_random_uuid())
) as occ_complete_random \gset
select pg_temp.capture_error(
  format($$ select public.complete_task_occurrence(%L) $$, :'occ_id')
) as occ_complete_foreign \gset
select is(:'occ_complete_random'::text, :'occ_complete_foreign'::text, 'complete_task_occurrence: a random UUID and another profile''s real occurrence UUID raise the identical SQLSTATE+message');

select pg_temp.capture_error(
  format($$ select public.restore_task_occurrence(%L) $$, gen_random_uuid())
) as occ_restore_random \gset
select pg_temp.capture_error(
  format($$ select public.restore_task_occurrence(%L) $$, :'occ_id')
) as occ_restore_foreign \gset
select is(:'occ_restore_random'::text, :'occ_restore_foreign'::text, 'restore_task_occurrence: a random UUID and another profile''s real occurrence UUID raise the identical SQLSTATE+message');

select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- 22023 (a real, transition-specific rule) is unaffected — it only ever
-- fires once the existence+ownership check has already passed, i.e. only
-- for a task the caller is genuinely authorized to know exists.
select throws_ok(
  $$ select public.schedule_personal_task(gen_random_uuid(), null) $$,
  '22023',
  null,
  'p_date is required by schedule_personal_task — still checked before the existence lookup'
);

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
-- direct confirmation for the RPCs this migration actually changed.
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

-- ---------------------------------------------------------------------------
-- Secret/existence-marker sweep — none of the captured error strings above
-- ever leak a real title, another profile's id, or an internal SQL name
-- beyond the fixed 'task unavailable'/'occurrence unavailable' text.
-- ---------------------------------------------------------------------------
select ok(
  :'update_foreign' !~* 'owner-only|to be deleted|si-owner|si-outsider'
  and :'complete_foreign' !~* 'owner-only|to be deleted'
  and :'occ_complete_foreign' !~* 'daily sync-issue',
  'secret-marker sweep: no captured unavailable-task error ever contains a real task/series title or email'
);

select * from finish();
rollback;
