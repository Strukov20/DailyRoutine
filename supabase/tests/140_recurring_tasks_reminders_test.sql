-- Tests: recurring personal tasks (daily/weekly/monthly/yearly, interval,
-- until/count end conditions, monthly-missing-day and yearly-leap-day
-- rules), task_occurrences identity/lifecycle (complete/restore/skip/
-- reschedule), bounded+idempotent generation, series update/stop, the
-- reminders RPC-only conversion, snooze, cross-user rejection, raw
-- mutation grants revoked, and the Phase 7 conflict-detection extension.
begin;
select plan(70);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['rt-owner@test.local', 'rt-outsider@test.local', 'rt-member@test.local']) as email;

select id as owner_id from auth.users where email = 'rt-owner@test.local' \gset
select id as outsider_id from auth.users where email = 'rt-outsider@test.local' \gset
select id as member_id from auth.users where email = 'rt-member@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Recurrence Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'member_id', 'Member', :'owner_id')
returning id as member_member_id \gset

-- ---------------------------------------------------------------------------
-- One-off tasks remain unchanged: no task_occurrences row, personal_task_occurrences
-- passes it through straight from tasks.date.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_personal_task('One-off errand', p_date := '2026-09-10') as oneoff_id \gset

select is(
  (select count(*)::int from public.task_occurrences where task_id = :'oneoff_id'),
  0,
  'a one-off task never gets a task_occurrences row'
);
select is(
  (select occurrence_date::text from public.personal_task_occurrences where task_id = :'oneoff_id'),
  '2026-09-10',
  'a one-off task appears in personal_task_occurrences straight from tasks.date'
);
select is(
  (select is_recurring from public.personal_task_occurrences where task_id = :'oneoff_id'),
  false,
  'a one-off task is flagged is_recurring=false'
);

-- ---------------------------------------------------------------------------
-- create_recurring_personal_task validation
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_recurring_personal_task('Bad freq', '2026-09-10', 'Europe/Kyiv', 'hourly') $$,
  '22023', null, 'an invalid frequency is rejected'
);
select throws_ok(
  $$ select public.create_recurring_personal_task('No weekday', '2026-09-10', 'Europe/Kyiv', 'weekly') $$,
  '22023', null, 'weekly recurrence requires at least one weekday'
);
select throws_ok(
  format($$ select public.create_recurring_personal_task('Both end', '2026-09-10', 'Europe/Kyiv', 'daily', p_until := %L, p_count := 5) $$, '2026-12-01'::date),
  '22023', null, 'until and count end conditions are mutually exclusive'
);

-- ---------------------------------------------------------------------------
-- Daily recurrence + interval
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Vitamins', '2026-09-01', 'Europe/Kyiv', 'daily', p_interval := 3, p_start_time := '08:00'
) as daily_task_id \gset

select is(
  (select array_agg(occurrence_date::text order by occurrence_date) from public.task_occurrences where task_id = :'daily_task_id' and occurrence_date <= '2026-09-10'),
  array['2026-09-01', '2026-09-04', '2026-09-07', '2026-09-10'],
  'daily recurrence with interval=3 generates every third day'
);

-- ---------------------------------------------------------------------------
-- Weekly selected weekdays — anchor on a Tuesday, weekdays Mon/Wed/Fri: the
-- first generated occurrence must snap forward to a selected weekday, never
-- use the raw (non-matching) anchor date.
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Gym', '2026-09-08', 'Europe/Kyiv', 'weekly', p_by_weekday := array[1, 3, 5]
) as weekly_task_id \gset

select is(
  (select array_agg(occurrence_date::text order by occurrence_date) from public.task_occurrences where task_id = :'weekly_task_id' and occurrence_date <= '2026-09-14'),
  array['2026-09-09', '2026-09-11', '2026-09-14'],
  'weekly recurrence on Mon/Wed/Fri snaps the first occurrence forward from a non-matching Tuesday anchor'
);
select is(
  (select bool_and(extract(dow from occurrence_date)::int = any(array[1,3,5])) from public.task_occurrences where task_id = :'weekly_task_id'),
  true,
  'every generated weekly occurrence falls on a selected weekday, with no exceptions'
);

-- ---------------------------------------------------------------------------
-- Monthly missing-day rule: the 31st skips a month that has no 31st (e.g.
-- February), rather than clamping to that month's last day.
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Pay rent', '2026-01-31', 'Europe/Kyiv', 'monthly'
) as monthly_task_id \gset

select is(
  (select array_agg(occurrence_date::text order by occurrence_date) from public.task_occurrences where task_id = :'monthly_task_id' and occurrence_date <= '2026-04-30'),
  array['2026-01-31', '2026-03-31'],
  'monthly recurrence on the 31st skips February entirely rather than landing on the 28th'
);

-- ---------------------------------------------------------------------------
-- Yearly leap-day rule: Feb 29 skips non-leap years, next occurrence is the
-- next leap year.
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Leap day thing', '2028-02-29', 'Europe/Kyiv', 'yearly'
) as yearly_task_id \gset

select is(
  (select count(*)::int from public.task_occurrences where task_id = :'yearly_task_id' and occurrence_date > '2028-02-29' and occurrence_date < '2032-01-01'),
  0,
  'a Feb 29 yearly anchor produces nothing in the non-leap years between two leap years'
);

-- ---------------------------------------------------------------------------
-- until-date boundary
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Short course', '2026-09-01', 'Europe/Kyiv', 'daily', p_until := '2026-09-05'
) as until_task_id \gset

select is(
  (select max(occurrence_date) from public.task_occurrences where task_id = :'until_task_id'),
  '2026-09-05'::date,
  'a daily series with an until date never generates past it'
);
select is(
  (select count(*)::int from public.task_occurrences where task_id = :'until_task_id'),
  5,
  'exactly 5 occurrences exist for a 5-day until-bounded daily series'
);

-- ---------------------------------------------------------------------------
-- count boundary
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Count-bounded', '2026-09-01', 'Europe/Kyiv', 'daily', p_count := 3
) as count_task_id \gset

select is(
  (select count(*)::int from public.task_occurrences where task_id = :'count_task_id'),
  3,
  'a count=3 daily series generates exactly 3 occurrences, not one more even with a long horizon'
);

-- ---------------------------------------------------------------------------
-- Bounded generation: requesting far beyond the 45-day horizon is clamped.
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Long runner', '2026-09-01', 'Europe/Kyiv', 'daily'
) as unbounded_task_id \gset

select public.generate_task_occurrences(current_date + 3650); -- 10 years requested

select ok(
  (select max(occurrence_date) from public.task_occurrences where task_id = :'unbounded_task_id') <= current_date + 45,
  'generation is clamped to the 45-day rolling horizon regardless of the requested through-date'
);

-- ---------------------------------------------------------------------------
-- Stable occurrence identity + idempotent/concurrency-safe regeneration:
-- calling generate_task_occurrences again must never create duplicates or
-- change existing occurrence ids.
-- ---------------------------------------------------------------------------
select array_agg(id order by occurrence_date) as ids_before from public.task_occurrences where task_id = :'daily_task_id' \gset
select public.generate_task_occurrences(current_date + 45);
select array_agg(id order by occurrence_date) as ids_after from public.task_occurrences where task_id = :'daily_task_id' \gset

select is(:'ids_before'::text, :'ids_after'::text, 'a second generate_task_occurrences call produces the exact same set of occurrence ids — no duplicates, no id churn');

-- ---------------------------------------------------------------------------
-- Individual complete / restore
-- ---------------------------------------------------------------------------
select id as complete_occ_id from public.task_occurrences where task_id = :'daily_task_id' order by occurrence_date limit 1 \gset

select public.complete_task_occurrence(:'complete_occ_id');
select is(
  (select status from public.task_occurrences where id = :'complete_occ_id'),
  'completed',
  'the targeted occurrence is now completed'
);
select is(
  (select status from public.task_occurrences where task_id = :'daily_task_id' and id <> :'complete_occ_id' order by occurrence_date limit 1),
  'scheduled',
  'completing one occurrence leaves the next occurrence of the same series open'
);
select public.complete_task_occurrence(:'complete_occ_id');
select is(
  (select count(*)::int from public.task_occurrences where id = :'complete_occ_id' and status = 'completed'),
  1,
  'completing an already-completed occurrence is a safe idempotent no-op'
);
select public.restore_task_occurrence(:'complete_occ_id');
select is(
  (select status from public.task_occurrences where id = :'complete_occ_id'),
  'scheduled',
  'restoring the occurrence clears its completion'
);

-- ---------------------------------------------------------------------------
-- Individual skip (and cannot skip a completed occurrence)
-- ---------------------------------------------------------------------------
select id as skip_occ_id from public.task_occurrences where task_id = :'daily_task_id' order by occurrence_date offset 1 limit 1 \gset
select public.skip_task_occurrence(:'skip_occ_id');
select is(
  (select status from public.task_occurrences where id = :'skip_occ_id'),
  'skipped',
  'skipping an occurrence marks it skipped'
);
select public.complete_task_occurrence(:'complete_occ_id');
select throws_ok(
  format($$ select public.skip_task_occurrence(%L) $$, :'complete_occ_id'),
  '22023', null, 'a completed occurrence cannot be skipped directly — restore it first'
);
select public.restore_task_occurrence(:'complete_occ_id');

-- ---------------------------------------------------------------------------
-- Individual reschedule
-- ---------------------------------------------------------------------------
select id as resched_occ_id from public.task_occurrences where task_id = :'daily_task_id' order by occurrence_date offset 2 limit 1 \gset
select original_date as resched_original from public.task_occurrences where id = :'resched_occ_id' \gset
select public.reschedule_task_occurrence(:'resched_occ_id', '2026-10-15', '14:00');
select is(
  (select occurrence_date::text from public.task_occurrences where id = :'resched_occ_id'),
  '2026-10-15',
  'reschedule moves the occurrence_date'
);
select is(
  (select original_date::text from public.task_occurrences where id = :'resched_occ_id'),
  :'resched_original',
  'reschedule never changes original_date — the natural-slot identity anchor stays put'
);
select is(
  (select rescheduled from public.task_occurrences where id = :'resched_occ_id'),
  true,
  'reschedule sets the rescheduled indicator flag'
);
select throws_ok(
  format($$ select public.reschedule_task_occurrence(%L, '2026-11-01') $$, :'skip_occ_id'),
  '22023', null, 'a skipped occurrence cannot be rescheduled'
);

-- ---------------------------------------------------------------------------
-- Entire-series update: content + rule change, preserving completed history
-- and individually-rescheduled occurrences, regenerating eligible future ones.
-- ---------------------------------------------------------------------------
select public.create_recurring_personal_task(
  'Standup', '2026-09-01', 'Europe/Kyiv', 'daily', p_start_time := '09:00'
) as update_task_id \gset

select id as history_occ_id from public.task_occurrences where task_id = :'update_task_id' order by occurrence_date limit 1 \gset
select public.complete_task_occurrence(:'history_occ_id');

select id as manual_occ_id from public.task_occurrences where task_id = :'update_task_id' order by occurrence_date offset 1 limit 1 \gset
select public.reschedule_task_occurrence(:'manual_occ_id', '2026-11-20', '11:00');

select public.update_recurring_series(:'update_task_id', p_title := 'Standup (renamed)', p_start_time := '10:00');
select public.generate_task_occurrences(current_date + 45);

select is(
  (select title from public.tasks where id = :'update_task_id'),
  'Standup (renamed)',
  'update_recurring_series renames the series'
);
select is(
  (select status from public.task_occurrences where id = :'history_occ_id'),
  'completed',
  'a historical completion survives a series-wide update untouched'
);
select is(
  (select occurrence_date::text from public.task_occurrences where id = :'manual_occ_id'),
  '2026-11-20',
  'an individually-rescheduled occurrence is never silently overwritten by a series-wide update'
);
select ok(
  (select count(*)::int from public.task_occurrences where task_id = :'update_task_id' and start_time = '10:00:00') > 0,
  'eligible future occurrences are regenerated with the new start_time after a series update'
);

-- ---------------------------------------------------------------------------
-- Series stop: idempotent, skips future not-yet-completed occurrences,
-- preserves history, generation never creates anything new afterward.
-- ---------------------------------------------------------------------------
select public.stop_recurring_series(:'update_task_id');
select is(
  (select status from public.task_occurrences where id = :'history_occ_id'),
  'completed',
  'stopping the series does not touch the already-completed historical occurrence'
);
select ok(
  (select bool_and(status = 'skipped') from public.task_occurrences where task_id = :'update_task_id' and id <> :'history_occ_id'),
  'stopping the series marks every other (non-completed) occurrence skipped'
);
select lives_ok(
  format($$ select public.stop_recurring_series(%L) $$, :'update_task_id'),
  'stopping an already-stopped series is a safe idempotent no-op'
);
select public.generate_task_occurrences(current_date + 45);
select is(
  (select count(*)::int from public.task_occurrences where task_id = :'update_task_id' and status = 'scheduled'),
  0,
  'generation never creates a new occurrence for a stopped series, even when asked to extend the horizon'
);

-- ---------------------------------------------------------------------------
-- Reminders: RPC-only, ownership, multiple per task, relative requires a
-- timed task.
-- ---------------------------------------------------------------------------
select public.create_task_reminder(:'daily_task_id', p_offset_minutes_before := 15) as reminder1_id \gset
select public.create_task_reminder(:'daily_task_id', p_offset_minutes_before := 60) as reminder2_id \gset

select is(
  (select count(*)::int from public.reminders where task_id = :'daily_task_id'),
  2,
  'a task can carry multiple reminder definitions'
);

select public.create_personal_task('Anytime, no time', p_date := '2026-09-20') as anytime_task_id \gset
select throws_ok(
  format($$ select public.create_task_reminder(%L, p_offset_minutes_before := 15) $$, :'anytime_task_id'),
  '22023', null, 'a relative reminder is rejected for an Anytime task with no start_time'
);
select lives_ok(
  format($$ select public.create_task_reminder(%L, p_remind_at := %L) $$, :'anytime_task_id', (now() + interval '1 day')::text),
  'an absolute reminder is allowed on an Anytime task'
);

select throws_ok(
  $$ select public.create_task_reminder(gen_random_uuid(), p_offset_minutes_before := 15) $$,
  '42501', null, 'creating a reminder on a nonexistent/inaccessible task is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_task_reminder(%L, p_offset_minutes_before := 15) $$, :'daily_task_id'),
  '42501', null, 'an outsider cannot create a reminder on another user''s task'
);
select is(
  (select count(*)::int from public.reminders where task_id = :'daily_task_id'),
  0,
  'an outsider cannot see the owner''s reminders (RLS)'
);
select throws_ok(
  format($$ select public.delete_task_reminder(%L) $$, :'reminder1_id'),
  '42501', null, 'an outsider cannot delete the owner''s reminder'
);
select throws_ok(
  format($$ select public.complete_task_occurrence(%L) $$, :'complete_occ_id'),
  '42501', null, 'an outsider cannot complete another user''s occurrence'
);
select throws_ok(
  format($$ select public.reschedule_task_occurrence(%L, '2026-12-01') $$, :'complete_occ_id'),
  '42501', null, 'an outsider cannot reschedule another user''s occurrence'
);
select throws_ok(
  format($$ select public.update_recurring_series(%L, p_title := 'hacked') $$, :'daily_task_id'),
  '42501', null, 'an outsider cannot update another user''s recurring series'
);
select throws_ok(
  format($$ select public.stop_recurring_series(%L) $$, :'daily_task_id'),
  '42501', null, 'an outsider cannot stop another user''s recurring series'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.delete_task_reminder(:'reminder1_id');
select is(
  (select count(*)::int from public.reminders where id = :'reminder1_id'),
  0,
  'the owner can delete their own reminder'
);
select lives_ok(
  format($$ select public.delete_task_reminder(%L) $$, :'reminder1_id'),
  'deleting an already-deleted reminder is a safe idempotent no-op'
);

-- ---------------------------------------------------------------------------
-- Snooze: creates a one-time, occurrence-scoped reminder; never edits the
-- recurrence rule or a standing definition.
-- ---------------------------------------------------------------------------
select id as snooze_target_occ from public.task_occurrences where task_id = :'weekly_task_id' order by occurrence_date limit 1 \gset
select public.snooze_task_occurrence(:'weekly_task_id', :'snooze_target_occ', p_minutes := 15) as snooze_id \gset

select is(
  (select is_snooze from public.reminders where id = :'snooze_id'),
  true,
  'snooze creates a reminder flagged is_snooze'
);
select is(
  (select occurrence_id from public.reminders where id = :'snooze_id'),
  :'snooze_target_occ',
  'the snooze reminder is scoped to exactly the targeted occurrence'
);
select ok(
  (select remind_at > now() from public.reminders where id = :'snooze_id'),
  'the snooze reminder''s remind_at is a real future instant'
);
-- recurrence_rules has zero grants even for its own owner (unchanged from
-- Phase 2) — read as the test's own postgres role, same convention as
-- every other fixture-only read against a fully locked-down table.
reset role;
select is(
  (select frequency from public.recurrence_rules r join public.tasks t on t.recurrence_rule_id = r.id where t.id = :'weekly_task_id'),
  'weekly',
  'snoozing an occurrence never modifies the series'' own recurrence rule'
);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.snooze_task_occurrence(%L, %L, p_minutes := 20000) $$, :'weekly_task_id', :'snooze_target_occ'),
  '22023', null, 'an out-of-range snooze duration is rejected'
);

-- ---------------------------------------------------------------------------
-- Raw mutation grants stay revoked
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.task_occurrences (task_id, owner_profile_id, original_date, occurrence_date) values (%L, %L, current_date, current_date) $$,
    :'daily_task_id', :'owner_id'
  ),
  '42501', null, 'authenticated cannot INSERT into task_occurrences directly — RPC only'
);
select throws_ok(
  format($$ update public.task_occurrences set status = 'completed' where id = %L $$, :'skip_occ_id'),
  '42501', null, 'authenticated cannot UPDATE task_occurrences directly — RPC only'
);
select throws_ok(
  format($$ delete from public.task_occurrences where id = %L $$, :'skip_occ_id'),
  '42501', null, 'authenticated cannot DELETE from task_occurrences directly — RPC only'
);
select throws_ok(
  format(
    $$ insert into public.reminders (task_id, profile_id, offset_minutes_before) values (%L, %L, 15) $$,
    :'daily_task_id', :'owner_id'
  ),
  '42501', null, 'authenticated cannot INSERT into reminders directly — RPC only'
);
select throws_ok(
  format($$ update public.reminders set offset_minutes_before = 5 where id = %L $$, :'reminder2_id'),
  '42501', null, 'authenticated cannot UPDATE reminders directly — RPC only'
);
select throws_ok(
  format($$ delete from public.reminders where id = %L $$, :'reminder2_id'),
  '42501', null, 'authenticated cannot DELETE from reminders directly — RPC only'
);
select throws_ok(
  $$ select count(*) from public.recurrence_rules $$,
  '42501', null, 'recurrence_rules stays fully inaccessible to authenticated, even indirectly via a direct SELECT'
);

-- ---------------------------------------------------------------------------
-- anon: no EXECUTE on any new RPC
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select public.create_recurring_personal_task('x', '2026-09-10', 'Europe/Kyiv', 'daily') $$,
  '42501', null, 'anon cannot call create_recurring_personal_task'
);
select throws_ok(
  $$ select public.generate_task_occurrences() $$,
  '42501', null, 'anon cannot call generate_task_occurrences'
);
select throws_ok(
  format($$ select public.complete_task_occurrence(%L) $$, :'skip_occ_id'),
  '42501', null, 'anon cannot call complete_task_occurrence'
);
select throws_ok(
  format($$ select public.create_task_reminder(%L, p_offset_minutes_before := 15) $$, :'daily_task_id'),
  '42501', null, 'anon cannot call create_task_reminder'
);
select throws_ok(
  format($$ select public.snooze_task_occurrence(%L, p_minutes := 15) $$, :'daily_task_id'),
  '42501', null, 'anon cannot call snooze_task_occurrence'
);
select throws_ok(
  $$ select * from public.task_occurrences $$,
  '42501', null, 'anon has no SELECT on task_occurrences'
);
select throws_ok(
  $$ select * from public.personal_task_occurrences $$,
  '42501', null, 'anon has no SELECT on personal_task_occurrences'
);
select throws_ok(
  $$ select * from public.reminders $$,
  '42501', null, 'anon has no SELECT on reminders'
);

-- ---------------------------------------------------------------------------
-- Phase 7 conflict detection sees recurring occurrences (and, closing the
-- same-shaped pre-existing gap, one-off personal tasks too).
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'member_id', 'role', 'authenticated')::text, true);

select public.create_recurring_personal_task(
  'Member''s standing meeting', '2026-09-14', 'Europe/Kyiv', 'weekly',
  p_start_time := '10:00', p_duration_minutes := 60, p_by_weekday := array[1]
) as member_recurring_id \gset

-- Local Kyiv wall time -> timestamptz via `at time zone`, never a
-- hand-computed UTC offset (Kyiv is UTC+3 in September/EEST — exactly the
-- kind of manual-offset mistake this codebase's own DST discipline exists
-- to avoid).
select ok(
  public.has_member_schedule_conflict(
    :'member_member_id',
    '2026-09-14 10:00:00'::timestamp at time zone 'Europe/Kyiv',
    '2026-09-14 11:00:00'::timestamp at time zone 'Europe/Kyiv'
  ),
  'has_member_schedule_conflict sees the member''s own recurring task occurrence'
);
select ok(
  not public.has_member_schedule_conflict(
    :'member_member_id',
    '2026-09-14 11:00:00'::timestamp at time zone 'Europe/Kyiv',
    '2026-09-14 12:00:00'::timestamp at time zone 'Europe/Kyiv'
  ),
  'a range starting exactly when the recurring occurrence ends is NOT a conflict (half-open interval)'
);

select public.create_personal_task(
  'Member''s one-off appointment', p_date := '2026-09-15', p_start_time := '15:00',
  p_duration_minutes := 30, p_timezone := 'Europe/Kyiv'
) as member_oneoff_id \gset

select ok(
  public.has_member_schedule_conflict(
    :'member_member_id',
    '2026-09-15 15:00:00'::timestamp at time zone 'Europe/Kyiv',
    '2026-09-15 15:30:00'::timestamp at time zone 'Europe/Kyiv'
  ),
  'has_member_schedule_conflict also sees the member''s own one-off timed personal task (a pre-existing gap closed alongside)'
);

select * from finish();
rollback;
