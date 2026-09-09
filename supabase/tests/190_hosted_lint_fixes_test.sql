-- Tests: Phase 10B corrective pass (hosted `supabase db lint` findings
-- against the linked staging project, ref ocurkeddkqkeitjfbcbe).
--
-- compute_next_occurrence_date was declared IMMUTABLE but silently routed
-- two expressions through STABLE overloads (see docs/DECISIONS.md, "Phase
-- 10B corrective pass," for the full root-cause analysis). This file proves
-- the rewritten function: (a) still produces the exact same values as
-- before for every frequency, including the monthly/yearly skip-invalid-
-- anchor rule and the weekly interval-week-boundary rule; (b) is now
-- genuinely timezone-invariant, not just observed to be; (c) is
-- deterministic across repeated calls; and (d) its real caller
-- (generate_task_occurrences, via create_recurring_personal_task) still
-- produces correct occurrences end-to-end.
--
-- update_event and set_responsibility_assignment only lost an unused local
-- variable each — their full behavior is already covered by
-- 050_events_and_responsibilities_test.sql and 120_family_calendar_test.sql
-- (both re-run, unchanged, as part of the same `supabase test db` pass);
-- this file adds one direct smoke assertion each for locality.
begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- compute_next_occurrence_date has zero grants (revoke all from public,
-- anon, authenticated) — called directly here as the test's own postgres
-- role, same "fixtures/pure-function calls bypass grants, only assertions
-- simulate a persona" convention 120_family_calendar_test.sql already
-- establishes for create_bare_responsibility.
-- ---------------------------------------------------------------------------

-- Deterministic repeated calls -----------------------------------------
select is(
  public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null),
  public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null),
  'calling compute_next_occurrence_date twice with identical inputs returns identical output'
);

-- Daily — touched by the make_interval rewrite ---------------------------
select is(
  public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null),
  '2026-01-08'::date,
  'daily: interval=3 adds exactly three days (make_interval, not string-parsed interval)'
);
select is(
  public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 1, null),
  '2026-01-06'::date,
  'daily: interval=1 adds exactly one day'
);

-- Weekly — touched by the date_trunc(::timestamp) rewrite -----------------
select is(
  public.compute_next_occurrence_date('2026-09-08'::date, '2026-09-08'::date, 'weekly', 1, array[1,3,5]),
  '2026-09-09'::date,
  'weekly: interval=1 snaps a Tuesday anchor forward to the next selected weekday (Wednesday)'
);
select is(
  public.compute_next_occurrence_date('2026-09-07'::date, '2026-09-14'::date, 'weekly', 2, array[1]),
  '2026-09-21'::date,
  'weekly: interval=2, requested one week before the next matching cycle, returns that matching Monday'
);
select is(
  public.compute_next_occurrence_date('2026-09-07'::date, '2026-09-21'::date, 'weekly', 2, array[1]),
  '2026-10-05'::date,
  'weekly: interval=2, requested exactly on a matching Monday, returns the NEXT one two cycles later (never the date itself)'
);

-- Monthly anchors ----------------------------------------------------------
select is(
  public.compute_next_occurrence_date('2026-01-31'::date, '2026-01-31'::date, 'monthly', 1, null),
  '2026-03-31'::date,
  'monthly: the 31st skips February (no 31st) rather than clamping to the 28th'
);
select is(
  public.compute_next_occurrence_date('2026-01-15'::date, '2026-01-15'::date, 'monthly', 2, null),
  '2026-03-15'::date,
  'monthly: interval=2 advances two calendar months for an anchor day every month has'
);

-- Yearly / leap-year anchors -------------------------------------------
select is(
  public.compute_next_occurrence_date('2024-02-29'::date, '2024-02-29'::date, 'yearly', 1, null),
  '2028-02-29'::date,
  'yearly: a Feb 29 anchor skips every non-leap year and lands on the next leap year'
);
select is(
  public.compute_next_occurrence_date('2024-02-29'::date, '2028-02-29'::date, 'yearly', 1, null),
  '2032-02-29'::date,
  'yearly: repeating from an already-leap "after" date still advances to the next leap year'
);

-- Multiple PostgreSQL session timezones — the actual property the prior
-- STABLE-routed form could not guarantee: identical inputs, identical
-- output, regardless of session timezone. UTC, the most extreme positive
-- offset (UTC+14), and the most extreme negative offset (UTC-12).
-- ---------------------------------------------------------------------------
set local timezone = 'UTC';
select is(
  public.compute_next_occurrence_date('2026-09-08'::date, '2026-09-08'::date, 'weekly', 2, array[1]),
  '2026-09-21'::date,
  'weekly result under UTC session timezone'
);
select is(
  public.compute_next_occurrence_date('2026-01-31'::date, '2026-01-31'::date, 'monthly', 1, null),
  '2026-03-31'::date,
  'monthly result under UTC session timezone'
);

set local timezone = 'Pacific/Kiritimati'; -- UTC+14
select is(
  public.compute_next_occurrence_date('2026-09-08'::date, '2026-09-08'::date, 'weekly', 2, array[1]),
  '2026-09-21'::date,
  'identical weekly result under UTC+14 (Pacific/Kiritimati) session timezone'
);
select is(
  public.compute_next_occurrence_date('2026-01-31'::date, '2026-01-31'::date, 'monthly', 1, null),
  '2026-03-31'::date,
  'identical monthly result under UTC+14 session timezone'
);

set local timezone = 'Etc/GMT+12'; -- UTC-12 (Etc zone signs are inverted)
select is(
  public.compute_next_occurrence_date('2026-09-08'::date, '2026-09-08'::date, 'weekly', 2, array[1]),
  '2026-09-21'::date,
  'identical weekly result under UTC-12 (Etc/GMT+12) session timezone'
);
select is(
  public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null),
  '2026-01-08'::date,
  'identical daily result under UTC-12 session timezone'
);
select is(
  public.compute_next_occurrence_date('2024-02-29'::date, '2024-02-29'::date, 'yearly', 1, null),
  '2028-02-29'::date,
  'identical yearly leap-day result under UTC-12 session timezone'
);
reset timezone;

-- No caller-facing grant regression: still zero-grants, same as before this
-- pass rewrote the function body.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'lint-fix-owner@test.local', 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
);
select id as owner_id from auth.users where email = 'lint-fix-owner@test.local' \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null) $$,
  '42501', null, 'authenticated still cannot call compute_next_occurrence_date directly'
);

set local role anon;
select throws_ok(
  $$ select public.compute_next_occurrence_date('2026-01-01'::date, '2026-01-05'::date, 'daily', 3, null) $$,
  '42501', null, 'anon still cannot call compute_next_occurrence_date directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- Existing caller continues to work: generate_task_occurrences (called via
-- create_recurring_personal_task, the real production RPC) still produces
-- correct occurrences for the two frequencies whose arithmetic changed.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_recurring_personal_task(
  'Pay rent', '2026-01-31', 'Europe/Kyiv', 'monthly'
) as monthly_task_id \gset

select is(
  (select array_agg(occurrence_date::text order by occurrence_date) from public.task_occurrences where task_id = :'monthly_task_id' and occurrence_date <= '2026-04-30'),
  array['2026-01-31', '2026-03-31'],
  'end-to-end via create_recurring_personal_task: monthly 31st-anchor still skips February'
);

select public.create_recurring_personal_task(
  'Leap day thing', '2028-02-29', 'Europe/Kyiv', 'yearly'
) as yearly_task_id \gset

select is(
  (select count(*)::int from public.task_occurrences where task_id = :'yearly_task_id' and occurrence_date > '2028-02-29' and occurrence_date < '2032-01-01'),
  0,
  'end-to-end via create_recurring_personal_task: a Feb 29 yearly anchor still skips the non-leap years in between'
);

select public.create_recurring_personal_task(
  'Gym', '2026-09-08', 'Europe/Kyiv', 'weekly', p_by_weekday := array[1, 3, 5]
) as weekly_task_id \gset

select is(
  (select array_agg(occurrence_date::text order by occurrence_date) from public.task_occurrences where task_id = :'weekly_task_id' and occurrence_date <= '2026-09-14'),
  array['2026-09-09', '2026-09-11', '2026-09-14'],
  'end-to-end via create_recurring_personal_task: weekly Mon/Wed/Fri still snaps forward from a Tuesday anchor'
);

-- ---------------------------------------------------------------------------
-- update_event / set_responsibility_assignment: one direct smoke assertion
-- each, confirming the unused-variable removal changed nothing observable.
-- Full behavior remains covered by 050_/120_family_calendar_test.sql.
--
-- Fixture rows bypass RLS/grants as the test's own postgres role, same
-- convention as every other file here — only the RPC calls under test
-- simulate the authenticated persona.
-- ---------------------------------------------------------------------------
reset role;
insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Lint Fix Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.create_family_event(
  :'family_id', 'Piano', '2026-09-10 18:00:00+00', '2026-09-10 19:00:00+00', 'Europe/Kyiv'
) as event_id \gset

select public.update_event(:'event_id', p_title := 'Piano lesson');
select is(
  (select title from public.events where id = :'event_id'),
  'Piano lesson',
  'update_event still updates the title correctly after dropping the unused v_family_id'
);

-- create_bare_responsibility is internal-only (revoked from authenticated
-- too) — same "fixtures bypass grants" convention as 120's own use of it.
reset role;
select public.create_bare_responsibility(:'event_id', 'drop_off', null) as drop_off_id \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select public.assign_event_responsibility(:'drop_off_id', :'owner_member_id');
select is(
  (select status from public.responsibilities where id = :'drop_off_id'),
  'accepted',
  'assign_event_responsibility (via set_responsibility_assignment) still self-assigns as immediate acceptance after dropping the unused v_event_id'
);
reset role;

select * from finish();
rollback;
