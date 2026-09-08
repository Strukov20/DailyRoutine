-- Phase 8: Recurring Tasks, Scheduled Reminders, and Snooze.
--
-- Architecture decided in docs/DECISIONS.md, "Phase 8" before any RPC here
-- was written: bounded materialized occurrences (task_occurrences, one row
-- per generated occurrence) generated on-demand by generate_task_occurrences
-- into a 45-day rolling horizon — never an unbounded background job, never
-- a purely virtual/computed-on-read model. recurrence_rules (Phase 2) is
-- evolved, not replaced: 'yearly' frequency, a count end-condition, and a
-- stopped_at flag are added to the existing table.
--
-- Audit finding (same class as every prior phase's own audit-before-build
-- step): `reminders` (Phase 2) already granted raw INSERT/UPDATE/DELETE to
-- `authenticated` under a single `for all` RLS policy — closed the same way
-- Phase 4 closed it for `tasks` and Phase 7 closed it for
-- events/responsibilities: grants revoked, the dead policy replaced with a
-- select-only one, every mutation moved to a narrowly scoped RPC.
--
-- Every function here: SECURITY DEFINER, `set search_path = public`,
-- explicit `revoke ... from public, anon` (not just `public`), and
-- `select ... for update` on the row being mutated so concurrent calls
-- serialize instead of racing — the same conventions established since
-- Phase 3.

-- ---------------------------------------------------------------------------
-- recurrence_rules: evolved for 'yearly', a count end-condition, and a
-- manual-stop flag. Still fully locked down at the table level — never
-- queried directly by a client, only read internally by the RPCs below.
-- ---------------------------------------------------------------------------
alter table public.recurrence_rules
  drop constraint recurrence_rules_frequency_check,
  add constraint recurrence_rules_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  add column count integer check (count is null or count > 0),
  add column stopped_at timestamptz,
  add constraint recurrence_rules_until_count_exclusive
    check (not (until is not null and count is not null));

comment on column public.recurrence_rules.count is
  'End condition: stop after this many occurrences have been generated. Mutually exclusive '
  'with `until` (recurrence_rules_until_count_exclusive) — null/null means "never ends".';
comment on column public.recurrence_rules.stopped_at is
  'Set by stop_recurring_series(). Once set, generate_task_occurrences() never creates another '
  'occurrence for this rule, regardless of until/count. Historical occurrences are untouched.';

-- ---------------------------------------------------------------------------
-- task_occurrences — one row per generated occurrence of a recurring
-- personal task. A one-off task (recurrence_rule_id is null) never gets a
-- row here at all; its `tasks` row remains the sole source of truth exactly
-- as before Phase 8. See docs/DECISIONS.md, "Phase 8" for the full
-- rationale, in particular why this carries no title/description/priority/
-- category override columns (every content field lives on the series'
-- `tasks` row; "edit this occurrence" is reschedule/complete/restore/skip
-- only).
-- ---------------------------------------------------------------------------
create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Denormalized from tasks.owner_profile_id at generation time — enables
  -- simple, non-recursive RLS with no join, same rationale as family_id on
  -- task_assignments/responsibility_assignments.
  owner_profile_id uuid not null references public.profiles (id),

  -- The date this occurrence would fall on per the recurrence rule alone —
  -- immutable, and the true idempotency/concurrency key alongside task_id
  -- (see the unique constraint below). Never changed by reschedule.
  original_date date not null,

  -- The *current* scheduled values — default to what generation computed,
  -- mutable via reschedule_task_occurrence().
  occurrence_date date not null,
  start_time time,
  duration_minutes integer check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440)),
  timezone text,

  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'skipped')),
  completed_at timestamptz,

  -- True once occurrence_date/start_time diverge from what generation
  -- produced — the "this occurrence was moved" indicator, and also what
  -- excludes an occurrence from being silently regenerated/reinterpreted
  -- by a series-wide update (see update_recurring_series below).
  rescheduled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_occurrences_unique_natural_slot unique (task_id, original_date),
  constraint task_occurrences_time_requires_timezone check (start_time is null or timezone is not null),
  constraint task_occurrences_duration_requires_time check (duration_minutes is null or start_time is not null)
);

comment on table public.task_occurrences is
  'One row per generated occurrence of a recurring personal task. Bounded — generated lazily '
  'by generate_task_occurrences() into a 45-day rolling horizon, never unbounded. See '
  'docs/DECISIONS.md, "Phase 8."';

create trigger set_task_occurrences_updated_at
  before update on public.task_occurrences
  for each row
  execute function public.set_updated_at();

create index task_occurrences_task_id_idx on public.task_occurrences (task_id);
create index task_occurrences_owner_date_idx
  on public.task_occurrences (owner_profile_id, occurrence_date)
  where status = 'scheduled';

alter table public.task_occurrences enable row level security;
alter table public.task_occurrences force row level security;
revoke all on public.task_occurrences from anon, authenticated;

create policy "task_occurrences_select_own"
  on public.task_occurrences
  for select
  to authenticated
  using (owner_profile_id = auth.uid());

grant select on public.task_occurrences to authenticated;

-- ---------------------------------------------------------------------------
-- personal_task_occurrences — the unified read model Today/Tomorrow/Calendar
-- query instead of `tasks` directly, so they display occurrences, not the
-- hidden recurring series template (the brief's own explicit requirement).
-- One-off tasks (recurrence_rule_id is null) pass through unchanged, straight
-- from `tasks.date` — this phase adds a path alongside the old one, never
-- rewrites it. Not security_invoker (same reasoning as family_schedule,
-- Phase 2): an ordinary view bypasses the querying role's RLS by
-- construction, so its own WHERE clause is the sole authorization check,
-- explicit here exactly like every other sanitized view in this codebase.
-- ---------------------------------------------------------------------------
create view public.personal_task_occurrences as
select
  t.id as task_id,
  null::uuid as occurrence_id,
  t.owner_profile_id,
  t.family_id,
  t.title,
  t.description,
  t.priority,
  t.category_id,
  t.visibility,
  t.date as occurrence_date,
  t.date as original_date,
  t.start_time,
  t.duration_minutes,
  t.timezone,
  case when t.completed_at is not null then 'completed' else 'scheduled' end as status,
  t.completed_at,
  false as rescheduled,
  false as is_recurring
from public.tasks t
where
  t.deleted_at is null
  and t.recurrence_rule_id is null
  and t.owner_profile_id = auth.uid()

union all

select
  o.task_id,
  o.id as occurrence_id,
  o.owner_profile_id,
  t.family_id,
  t.title,
  t.description,
  t.priority,
  t.category_id,
  t.visibility,
  o.occurrence_date,
  o.original_date,
  o.start_time,
  o.duration_minutes,
  o.timezone,
  o.status,
  o.completed_at,
  o.rescheduled,
  true as is_recurring
from public.task_occurrences o
join public.tasks t on t.id = o.task_id
where
  t.deleted_at is null
  and o.owner_profile_id = auth.uid();

comment on view public.personal_task_occurrences is
  'Read model for Today/Tomorrow/Calendar: one-off tasks (straight from tasks.date, unchanged '
  'since before Phase 8) unioned with recurring-task occurrences (from task_occurrences). '
  'Callers must call generate_task_occurrences() first for any date range that needs recurring '
  'occurrences populated — this view never generates as a side effect of being read (a plain '
  'view cannot safely perform a write). See docs/DECISIONS.md, "Phase 8."';

revoke all on public.personal_task_occurrences from anon, authenticated;
grant select on public.personal_task_occurrences to authenticated;

-- ---------------------------------------------------------------------------
-- compute_next_occurrence_date — internal, zero grants. Dispatches by
-- frequency. Monthly/yearly deliberately SKIP a month/year where the
-- anchor day doesn't exist (e.g. the 31st, or Feb 29 in a non-leap year)
-- rather than silently moving to that month's last day — the brief's own
-- explicit preference, applied identically to both frequencies.
-- ---------------------------------------------------------------------------
create function public.compute_next_occurrence_date(
  p_anchor_date date,
  p_after date,
  p_frequency text,
  p_interval integer,
  p_by_weekday integer[]
)
returns date
language plpgsql
immutable
as $$
declare
  v_candidate date;
  v_anchor_day integer;
  v_anchor_month integer;
  v_year integer;
  v_month integer;
  v_last_day_of_month integer;
  v_guard integer := 0;
begin
  if p_frequency = 'daily' then
    return p_after + (p_interval || ' days')::interval;
  end if;

  if p_frequency = 'weekly' then
    -- Step day-by-day (bounded — the 45-day horizon caps total iterations
    -- across a whole generation run) until a selected weekday is hit, in
    -- p_interval-week jumps once a full week boundary has been crossed
    -- since p_anchor_date's own week.
    v_candidate := p_after + 1;
    loop
      v_guard := v_guard + 1;
      exit when v_guard > 400; -- safety valve, never expected to trigger
      if extract(dow from v_candidate)::integer = any(p_by_weekday) then
        -- Only accept weeks that land on an interval-week boundary from
        -- the anchor's own week (interval=1 accepts every matching week).
        -- date_trunc(...)::date gives a plain date, so the subtraction is
        -- a direct integer day count, not an interval.
        if (
          (date_trunc('week', v_candidate)::date - date_trunc('week', p_anchor_date)::date)
          / 7
        ) % p_interval = 0 then
          return v_candidate;
        end if;
      end if;
      v_candidate := v_candidate + 1;
    end loop;
    return null;
  end if;

  if p_frequency = 'monthly' then
    v_anchor_day := extract(day from p_anchor_date)::integer;
    v_year := extract(year from p_after)::integer;
    v_month := extract(month from p_after)::integer;
    loop
      v_guard := v_guard + 1;
      exit when v_guard > 60; -- 5 years of monthly skips, generous safety valve
      v_month := v_month + p_interval;
      while v_month > 12 loop
        v_month := v_month - 12;
        v_year := v_year + 1;
      end loop;
      v_last_day_of_month := extract(
        day from (make_date(v_year, v_month, 1) + interval '1 month - 1 day')
      )::integer;
      if v_anchor_day <= v_last_day_of_month then
        return make_date(v_year, v_month, v_anchor_day);
      end if;
      -- Anchor day doesn't exist this month (e.g. the 31st) — skip it and
      -- try the next interval-month step, never fall back to the last day.
    end loop;
    return null;
  end if;

  if p_frequency = 'yearly' then
    v_anchor_month := extract(month from p_anchor_date)::integer;
    v_anchor_day := extract(day from p_anchor_date)::integer;
    v_year := extract(year from p_after)::integer;
    loop
      v_guard := v_guard + 1;
      exit when v_guard > 40; -- 40 years of leap-day skips, generous safety valve
      v_year := v_year + p_interval;
      v_last_day_of_month := extract(
        day from (make_date(v_year, v_anchor_month, 1) + interval '1 month - 1 day')
      )::integer;
      if v_anchor_day <= v_last_day_of_month then
        return make_date(v_year, v_anchor_month, v_anchor_day);
      end if;
      -- Feb 29 anchor, non-leap target year — skip, same rule as monthly.
    end loop;
    return null;
  end if;

  raise exception 'unknown recurrence frequency %', p_frequency using errcode = '22023';
end;
$$;

comment on function public.compute_next_occurrence_date(date, date, text, integer, integer[]) is
  'Pure/immutable — no table access, safe to unit-test directly via pgTAP. Monthly/yearly skip '
  'a period where the anchor day does not exist rather than clamping to the last day.';

revoke all on function public.compute_next_occurrence_date(date, date, text, integer, integer[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- generate_task_occurrences — the only place task_occurrences rows are
-- created. Idempotent (unique constraint + ON CONFLICT DO NOTHING) and
-- concurrency-safe (row-locks each series while extending it). Clamps the
-- requested horizon to the documented 45-day cap regardless of what the
-- caller asks for.
-- ---------------------------------------------------------------------------
create function public.generate_task_occurrences(p_through_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_horizon_cap date := current_date + 45;
  v_through date;
  v_task record;
  v_rule record;
  v_last_date date;
  v_next_date date;
  v_generated_count integer;
  v_iterations integer;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_through := least(coalesce(p_through_date, v_horizon_cap), v_horizon_cap);

  for v_task in
    select t.id, t.date, t.start_time, t.duration_minutes, t.timezone, t.recurrence_rule_id
    from public.tasks t
    where t.owner_profile_id = v_profile_id
      and t.deleted_at is null
      and t.recurrence_rule_id is not null
    order by t.id
  loop
    select r.* into v_rule
    from public.recurrence_rules r
    where r.id = v_task.recurrence_rule_id
    for update;

    if v_rule.stopped_at is not null then
      continue; -- series manually stopped — never generate anything new for it
    end if;

    select max(original_date) into v_last_date
    from public.task_occurrences
    where task_id = v_task.id;

    select count(*)::integer into v_generated_count
    from public.task_occurrences
    where task_id = v_task.id;

    v_next_date := coalesce(v_last_date, null);
    v_iterations := 0;

    loop
      v_iterations := v_iterations + 1;
      exit when v_iterations > 200; -- safety valve — 45-day horizon never needs this many

      if v_next_date is null then
        -- First occurrence. For daily/monthly/yearly the anchor date is
        -- trivially valid by definition (monthly/yearly's "day of month/
        -- year" pattern IS the anchor). Weekly is the one case where the
        -- anchor itself might not fall on a selected weekday (e.g. a task
        -- created on a Tuesday, repeating Mon/Wed/Fri) — snap forward to
        -- the first matching weekday on or after the anchor, never before.
        if v_rule.frequency = 'weekly' then
          v_next_date := v_task.date;
          while not (extract(dow from v_next_date)::integer = any(v_rule.by_weekday)) loop
            v_next_date := v_next_date + 1;
          end loop;
        else
          v_next_date := v_task.date;
        end if;
      else
        v_next_date := public.compute_next_occurrence_date(
          v_task.date, v_next_date, v_rule.frequency, v_rule.interval, v_rule.by_weekday
        );
      end if;

      exit when v_next_date is null; -- no further valid date exists (e.g. exhausted skip search)
      exit when v_next_date > v_through;
      exit when v_rule.until is not null and v_next_date > v_rule.until;
      exit when v_rule.count is not null and v_generated_count >= v_rule.count;

      insert into public.task_occurrences (
        task_id, owner_profile_id, original_date, occurrence_date,
        start_time, duration_minutes, timezone
      ) values (
        v_task.id, v_profile_id, v_next_date, v_next_date,
        v_task.start_time, v_task.duration_minutes, v_task.timezone
      )
      on conflict (task_id, original_date) do nothing;

      if found then
        v_generated_count := v_generated_count + 1;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.generate_task_occurrences(date) is
  'Extends every one of the caller''s active recurring tasks'' occurrences up to a 45-day '
  'rolling horizon (clamped regardless of the requested date). Call before reading '
  'personal_task_occurrences for a recurring-task-inclusive result — see '
  'docs/DECISIONS.md, "Phase 8," for why this is a separate mutation-shaped call rather than a '
  'side effect of the read.';

revoke all on function public.generate_task_occurrences(date) from public, anon;
grant execute on function public.generate_task_occurrences(date) to authenticated;

-- ---------------------------------------------------------------------------
-- create_recurring_personal_task — p_date/p_timezone/p_frequency are
-- required (unlike create_personal_task): an Inbox task with no date must
-- never recur until scheduled with an explicit valid start (brief, Section
-- 13). Generates the first occurrences immediately so one exists without an
-- extra round trip.
-- ---------------------------------------------------------------------------
create function public.create_recurring_personal_task(
  p_title text,
  p_date date,
  p_timezone text,
  p_frequency text,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_interval integer default 1,
  p_by_weekday integer[] default null,
  p_until date default null,
  p_count integer default null,
  p_description text default null,
  p_priority text default 'normal',
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_recurrence_id uuid;
  v_task_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'invalid recurrence frequency' using errcode = '22023';
  end if;
  if p_interval is null or p_interval <= 0 or p_interval > 365 then
    raise exception 'recurrence interval must be between 1 and 365' using errcode = '22023';
  end if;
  if p_frequency = 'weekly' and (p_by_weekday is null or array_length(p_by_weekday, 1) is null) then
    raise exception 'weekly recurrence requires at least one weekday' using errcode = '22023';
  end if;
  if p_until is not null and p_count is not null then
    raise exception 'until and count end conditions are mutually exclusive' using errcode = '22023';
  end if;
  if p_count is not null and (p_count <= 0 or p_count > 1000) then
    raise exception 'occurrence count must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_until is not null and p_until < p_date then
    raise exception 'until date cannot be before the recurrence start date' using errcode = '22023';
  end if;

  insert into public.recurrence_rules (frequency, interval, by_weekday, until, count, timezone, created_by)
  values (p_frequency, p_interval, p_by_weekday, p_until, p_count, p_timezone, v_profile_id)
  returning id into v_recurrence_id;

  insert into public.tasks (
    owner_profile_id, title, description, date, start_time, duration_minutes, timezone,
    priority, category_id, recurrence_rule_id, created_by
  ) values (
    v_profile_id, p_title, p_description, p_date, p_start_time, p_duration_minutes, p_timezone,
    coalesce(p_priority, 'normal'), p_category_id, v_recurrence_id, v_profile_id
  )
  returning id into v_task_id;

  perform public.generate_task_occurrences(current_date + 45);

  return v_task_id;
end;
$$;

comment on function public.create_recurring_personal_task(text, date, text, text, time, integer, integer, integer[], date, integer, text, text, uuid) is
  'The only way to create a recurring personal task. Recurring family-shared tasks are out of '
  'scope this phase (see docs/DECISIONS.md, "Phase 8") — this never accepts a family_id.';

revoke all on function public.create_recurring_personal_task(text, date, text, text, time, integer, integer, integer[], date, integer, text, text, uuid) from public, anon;
grant execute on function public.create_recurring_personal_task(text, date, text, text, time, integer, integer, integer[], date, integer, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_recurring_series — series-wide content/rule edits. Never touches
-- completed or already-individually-rescheduled occurrences; deletes only
-- eligible future ones (still 'scheduled', never rescheduled, on or after
-- today) so they regenerate fresh with the new parameters on the next
-- generate_task_occurrences() call.
-- ---------------------------------------------------------------------------
create function public.update_recurring_series(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_clear_description boolean default false,
  p_priority text default null,
  p_category_id uuid default null,
  p_clear_category boolean default false,
  p_start_time time default null,
  p_clear_start_time boolean default false,
  p_duration_minutes integer default null,
  p_frequency text default null,
  p_interval integer default null,
  p_by_weekday integer[] default null,
  p_until date default null,
  p_clear_until boolean default false,
  p_count integer default null,
  p_clear_count boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select owner_profile_id, recurrence_rule_id into v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null
  for update;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is null then
    raise exception 'task % is not a recurring series', p_task_id using errcode = '22023';
  end if;

  if p_frequency is not null and p_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'invalid recurrence frequency' using errcode = '22023';
  end if;
  if p_interval is not null and (p_interval <= 0 or p_interval > 365) then
    raise exception 'recurrence interval must be between 1 and 365' using errcode = '22023';
  end if;
  if p_until is not null and p_count is not null then
    raise exception 'until and count end conditions are mutually exclusive' using errcode = '22023';
  end if;

  update public.tasks set
    title = coalesce(p_title, title),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    priority = coalesce(p_priority, priority),
    category_id = case when p_clear_category then null else coalesce(p_category_id, category_id) end,
    start_time = case when p_clear_start_time then null else coalesce(p_start_time, start_time) end,
    duration_minutes = coalesce(p_duration_minutes, duration_minutes)
  where id = p_task_id;

  update public.recurrence_rules set
    frequency = coalesce(p_frequency, frequency),
    interval = coalesce(p_interval, interval),
    by_weekday = coalesce(p_by_weekday, by_weekday),
    until = case when p_clear_until then null else coalesce(p_until, until) end,
    count = case when p_clear_count then null else coalesce(p_count, count) end
  where id = v_recurrence_id;

  delete from public.task_occurrences
  where task_id = p_task_id
    and status = 'scheduled'
    and rescheduled = false
    and original_date >= current_date;
end;
$$;

comment on function public.update_recurring_series(uuid, text, text, boolean, text, uuid, boolean, time, boolean, integer, text, integer, integer[], date, boolean, integer, boolean) is
  'Series-wide edit. Completed occurrences and individually-rescheduled future occurrences are '
  'never touched or regenerated — only eligible (untouched, future, still-scheduled) '
  'occurrences are deleted so generate_task_occurrences() rebuilds them with the new rule.';

revoke all on function public.update_recurring_series(uuid, text, text, boolean, text, uuid, boolean, time, boolean, integer, text, integer, integer[], date, boolean, integer, boolean) from public, anon;
grant execute on function public.update_recurring_series(uuid, text, text, boolean, text, uuid, boolean, time, boolean, integer, text, integer, integer[], date, boolean, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- stop_recurring_series — idempotent. Marks the rule stopped (generation
-- refuses it forever after) and skips every future not-yet-completed
-- occurrence so Today/Tomorrow/Calendar reflect the stop immediately.
-- Historical completions are untouched.
-- ---------------------------------------------------------------------------
create function public.stop_recurring_series(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select owner_profile_id, recurrence_rule_id into v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null
  for update;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is null then
    raise exception 'task % is not a recurring series', p_task_id using errcode = '22023';
  end if;

  update public.recurrence_rules set stopped_at = coalesce(stopped_at, now())
  where id = v_recurrence_id;

  update public.task_occurrences set status = 'skipped'
  where task_id = p_task_id and status = 'scheduled';
end;
$$;

comment on function public.stop_recurring_series(uuid) is
  'Idempotent. No restore RPC this phase, same "no undelete" convention as '
  'delete_or_archive_personal_task (Phase 4) / cancel_event (Phase 7).';

revoke all on function public.stop_recurring_series(uuid) from public, anon;
grant execute on function public.stop_recurring_series(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Individual occurrence actions — complete/restore/skip/reschedule. Every
-- one is owner-scoped via task_occurrences.owner_profile_id directly (no
-- join needed, thanks to the denormalized column) and row-locked.
-- ---------------------------------------------------------------------------
create function public.complete_task_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select o.owner_profile_id into v_owner
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such occurrence' using errcode = '42501';
  end if;

  update public.task_occurrences
  set status = 'completed', completed_at = now()
  where id = p_occurrence_id and status = 'scheduled';
end;
$$;

comment on function public.complete_task_occurrence(uuid) is
  'Idempotent — a repeat call on an already-completed occurrence matches zero rows. Completing '
  'one occurrence never affects any other occurrence of the same series (the next one stays '
  'open).';

revoke all on function public.complete_task_occurrence(uuid) from public, anon;
grant execute on function public.complete_task_occurrence(uuid) to authenticated;

create function public.restore_task_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select o.owner_profile_id into v_owner
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such occurrence' using errcode = '42501';
  end if;

  update public.task_occurrences
  set status = 'scheduled', completed_at = null
  where id = p_occurrence_id and status = 'completed';
end;
$$;

revoke all on function public.restore_task_occurrence(uuid) from public, anon;
grant execute on function public.restore_task_occurrence(uuid) to authenticated;

create function public.skip_task_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select o.owner_profile_id, o.status into v_owner, v_status
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such occurrence' using errcode = '42501';
  end if;
  if v_status = 'completed' then
    raise exception 'cannot skip a completed occurrence — restore it first' using errcode = '22023';
  end if;

  update public.task_occurrences set status = 'skipped'
  where id = p_occurrence_id and status = 'scheduled';
end;
$$;

comment on function public.skip_task_occurrence(uuid) is
  '"Skip/delete this occurrence" (brief, Section 5). Idempotent for an already-skipped '
  'occurrence; refuses a completed one (restore it first — same "can''t skip a state" shape as '
  'remove_event_responsibility, Phase 7).';

revoke all on function public.skip_task_occurrence(uuid) from public, anon;
grant execute on function public.skip_task_occurrence(uuid) to authenticated;

create function public.reschedule_task_occurrence(
  p_occurrence_id uuid,
  p_date date,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_clear_start_time boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
  v_timezone text;
begin
  select o.owner_profile_id, o.status, o.timezone into v_owner, v_status, v_timezone
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such occurrence' using errcode = '42501';
  end if;
  if v_status <> 'scheduled' then
    raise exception 'only a scheduled occurrence can be rescheduled' using errcode = '22023';
  end if;
  if p_start_time is not null and v_timezone is null then
    raise exception 'this occurrence has no timezone to anchor a start time to' using errcode = '22023';
  end if;

  update public.task_occurrences set
    occurrence_date = p_date,
    start_time = case when p_clear_start_time then null else coalesce(p_start_time, start_time) end,
    duration_minutes = coalesce(p_duration_minutes, duration_minutes),
    rescheduled = true
  where id = p_occurrence_id;
end;
$$;

comment on function public.reschedule_task_occurrence(uuid, date, time, integer, boolean) is
  'Moves exactly one occurrence — never touches the recurrence rule or any other occurrence. '
  'Sets rescheduled=true, which excludes this row from update_recurring_series'' bulk '
  'regeneration (see that function''s own comment).';

revoke all on function public.reschedule_task_occurrence(uuid, date, time, integer, boolean) from public, anon;
grant execute on function public.reschedule_task_occurrence(uuid, date, time, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- A recurring series' own `tasks` row is a template, not a completable
-- item — complete_personal_task/restore_personal_task/schedule_personal_task
-- must refuse it (use the *_task_occurrence RPCs above instead), so a
-- misdirected client call can never bypass server-authoritative occurrence
-- tracking. delete_or_archive_personal_task/update_personal_task are
-- deliberately NOT restricted this way — soft-deleting or renaming the
-- series is still meaningful (see docs/DECISIONS.md, "Phase 8").
-- ---------------------------------------------------------------------------
create or replace function public.complete_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select owner_profile_id, recurrence_rule_id into v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task cannot be completed directly — complete a specific occurrence instead'
      using errcode = '22023';
  end if;

  update public.tasks set completed_at = now() where id = p_task_id and completed_at is null;
end;
$$;

create or replace function public.restore_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select owner_profile_id, recurrence_rule_id into v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task cannot be restored directly — restore a specific occurrence instead'
      using errcode = '22023';
  end if;

  update public.tasks set completed_at = null where id = p_task_id and completed_at is not null;
end;
$$;

create or replace function public.schedule_personal_task(
  p_task_id uuid,
  p_date date,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
begin
  if p_date is null then
    raise exception 'p_date is required — use move_task_to_inbox to clear scheduling'
      using errcode = '22023';
  end if;

  select owner_profile_id, recurrence_rule_id into v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task''s schedule is edited via update_recurring_series, not schedule_personal_task'
      using errcode = '22023';
  end if;

  update public.tasks set
    date = p_date,
    start_time = p_start_time,
    duration_minutes = p_duration_minutes,
    timezone = p_timezone
  where id = p_task_id;
end;
$$;

-- (revoke/grant already applied to these three functions by the Phase 4
-- migration — re-CREATE OR REPLACE preserves the existing signature and
-- therefore the existing ACL entries; no new revoke/grant statements
-- needed here.)

-- ---------------------------------------------------------------------------
-- reminders: RPC-only writes from here on — SELECT stays direct/RLS-
-- governed. Schema evolved for Phase 8: remind_at becomes nullable (a
-- relative reminder on a recurring task has no single fixed instant — it is
-- computed per-occurrence entirely client-side, never stored server-side),
-- occurrence_id lets a reminder scope itself to exactly one occurrence
-- (used by snooze), and is_snooze distinguishes a one-time snooze reminder
-- from a standing reminder definition.
-- ---------------------------------------------------------------------------
alter table public.reminders
  alter column remind_at drop not null,
  add column occurrence_id uuid references public.task_occurrences (id) on delete cascade,
  add column is_snooze boolean not null default false,
  add column label text,
  add constraint reminders_exactly_one_time
    check ((remind_at is not null) <> (offset_minutes_before is not null));

comment on column public.reminders.occurrence_id is
  'Null for a standing reminder definition (applies to every occurrence of the series, or to a '
  'one-off task''s single occurrence). Set only for a one-time snooze reminder scoped to '
  'exactly one occurrence — see snooze_task_occurrence().';
comment on column public.reminders.is_snooze is
  'True only for a one-time snooze reminder. A snooze never modifies the original recurrence '
  'rule or any standing reminder definition (brief, Section 11).';

drop policy if exists "reminders_owner_only" on public.reminders;
revoke insert, update, delete on public.reminders from authenticated;

create policy "reminders_select_own"
  on public.reminders
  for select
  to authenticated
  using (profile_id = auth.uid());

grant select on public.reminders to authenticated;

-- ---------------------------------------------------------------------------
-- create_task_reminder / update_task_reminder / delete_task_reminder
-- ---------------------------------------------------------------------------
create function public.create_task_reminder(
  p_task_id uuid,
  p_offset_minutes_before integer default null,
  p_remind_at timestamptz default null,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_task_owner uuid;
  v_start_time time;
  v_reminder_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if (p_offset_minutes_before is not null) = (p_remind_at is not null) then
    raise exception 'exactly one of p_offset_minutes_before or p_remind_at is required'
      using errcode = '22023';
  end if;

  select owner_profile_id, start_time into v_task_owner, v_start_time
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_task_owner is null or v_task_owner <> v_profile_id then
    raise exception 'no such task' using errcode = '42501';
  end if;

  if p_offset_minutes_before is not null then
    if p_offset_minutes_before < 0 then
      raise exception 'offset_minutes_before cannot be negative' using errcode = '22023';
    end if;
    if v_start_time is null then
      raise exception 'a relative reminder requires a timed task (start_time must be set)'
        using errcode = '22023';
    end if;
  end if;

  if p_remind_at is not null and p_remind_at < now() then
    raise exception 'p_remind_at cannot be in the past' using errcode = '22023';
  end if;

  insert into public.reminders (task_id, profile_id, remind_at, offset_minutes_before, label)
  values (p_task_id, v_profile_id, p_remind_at, p_offset_minutes_before, p_label)
  returning id into v_reminder_id;

  return v_reminder_id;
end;
$$;

comment on function public.create_task_reminder(uuid, integer, timestamptz, text) is
  'A relative reminder (p_offset_minutes_before) requires the task itself to have a start_time '
  '— it is meaningless without one to be relative to, whether the task is recurring or not '
  '(brief, Section 7). An absolute reminder (p_remind_at) is allowed on any task, including an '
  'Anytime one — never silently defaulted, always an explicit caller-chosen instant.';

revoke all on function public.create_task_reminder(uuid, integer, timestamptz, text) from public, anon;
grant execute on function public.create_task_reminder(uuid, integer, timestamptz, text) to authenticated;

create function public.update_task_reminder(
  p_reminder_id uuid,
  p_offset_minutes_before integer default null,
  p_remind_at timestamptz default null,
  p_clear_and_set_offset boolean default false,
  p_clear_and_set_absolute boolean default false,
  p_label text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_owner uuid;
  v_task_id uuid;
  v_start_time time;
begin
  select profile_id, task_id into v_owner, v_task_id
  from public.reminders
  where id = p_reminder_id
  for update;

  if v_owner is null or v_owner <> v_profile_id then
    raise exception 'no such reminder' using errcode = '42501';
  end if;

  if p_clear_and_set_offset and p_clear_and_set_absolute then
    raise exception 'cannot switch to both a relative and an absolute reminder at once' using errcode = '22023';
  end if;

  if p_clear_and_set_offset then
    if p_offset_minutes_before is null or p_offset_minutes_before < 0 then
      raise exception 'a valid non-negative p_offset_minutes_before is required' using errcode = '22023';
    end if;
    select start_time into v_start_time from public.tasks where id = v_task_id;
    if v_start_time is null then
      raise exception 'a relative reminder requires a timed task' using errcode = '22023';
    end if;
    update public.reminders set remind_at = null, offset_minutes_before = p_offset_minutes_before
    where id = p_reminder_id;
  elsif p_clear_and_set_absolute then
    if p_remind_at is null or p_remind_at < now() then
      raise exception 'a valid future p_remind_at is required' using errcode = '22023';
    end if;
    update public.reminders set offset_minutes_before = null, remind_at = p_remind_at
    where id = p_reminder_id;
  end if;

  if p_label is not null then
    update public.reminders set label = p_label where id = p_reminder_id;
  end if;
end;
$$;

revoke all on function public.update_task_reminder(uuid, integer, timestamptz, boolean, boolean, text) from public, anon;
grant execute on function public.update_task_reminder(uuid, integer, timestamptz, boolean, boolean, text) to authenticated;

create function public.delete_task_reminder(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner
  from public.reminders
  where id = p_reminder_id;

  if v_owner is null then
    return; -- idempotent: already gone is a safe no-op
  end if;
  if v_owner <> auth.uid() then
    raise exception 'no such reminder' using errcode = '42501';
  end if;

  delete from public.reminders where id = p_reminder_id;
end;
$$;

comment on function public.delete_task_reminder(uuid) is
  'Hard delete (reminders are lightweight definitions, not audit history — unlike '
  'task_assignments/responsibility_assignments, there is nothing here worth preserving once '
  'deliberately removed). Idempotent.';

revoke all on function public.delete_task_reminder(uuid) from public, anon;
grant execute on function public.delete_task_reminder(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- snooze_task_occurrence — creates a one-time reminder scoped to exactly
-- one occurrence (or, for a one-off task, the task itself — occurrence_id
-- stays null, task_id alone already identifies it). Never modifies the
-- original recurrence rule or any standing reminder definition.
-- ---------------------------------------------------------------------------
create function public.snooze_task_occurrence(
  p_task_id uuid,
  p_occurrence_id uuid default null,
  p_minutes integer default null,
  p_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_task_owner uuid;
  v_occurrence_owner uuid;
  v_remind_at timestamptz;
  v_reminder_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if (p_minutes is not null) = (p_until is not null) then
    raise exception 'exactly one of p_minutes or p_until is required' using errcode = '22023';
  end if;

  select owner_profile_id into v_task_owner from public.tasks where id = p_task_id and deleted_at is null;
  if v_task_owner is null or v_task_owner <> v_profile_id then
    raise exception 'no such task' using errcode = '42501';
  end if;

  if p_occurrence_id is not null then
    select owner_profile_id into v_occurrence_owner
    from public.task_occurrences
    where id = p_occurrence_id and task_id = p_task_id;
    if v_occurrence_owner is null or v_occurrence_owner <> v_profile_id then
      raise exception 'no such occurrence' using errcode = '42501';
    end if;
  end if;

  if p_minutes is not null then
    if p_minutes <= 0 or p_minutes > 1440 then
      raise exception 'snooze minutes must be between 1 and 1440' using errcode = '22023';
    end if;
    v_remind_at := now() + (p_minutes || ' minutes')::interval;
  else
    if p_until <= now() then
      raise exception 'p_until must be in the future' using errcode = '22023';
    end if;
    v_remind_at := p_until;
  end if;

  insert into public.reminders (task_id, profile_id, occurrence_id, remind_at, is_snooze)
  values (p_task_id, v_profile_id, p_occurrence_id, v_remind_at, true)
  returning id into v_reminder_id;

  return v_reminder_id;
end;
$$;

comment on function public.snooze_task_occurrence(uuid, uuid, integer, timestamptz) is
  'Snooze is always a fresh, additive one-time reminder — it never edits an existing reminder '
  'or the recurrence rule (brief, Section 11). "Tonight"/"Tomorrow" presets resolve to a '
  'concrete p_until client-side (see docs/DECISIONS.md, "Phase 8," for the documented default '
  'times) — this RPC itself has no opinion on what those mean, only that p_until is a real '
  'future instant.';

revoke all on function public.snooze_task_occurrence(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.snooze_task_occurrence(uuid, uuid, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- has_member_schedule_conflict (Phase 7) — extended to see a member's own
-- recurring task occurrences, per this brief's explicit requirement.
-- Closing this surfaced a related, pre-existing gap in the same function:
-- a member's own *one-off* timed personal task was never checked either
-- (only a *shared* task assigned to them was) — closed alongside, same
-- shape of check, since leaving it out while adding the recurring case
-- would have been an inconsistent half-fix. CREATE OR REPLACE preserves
-- the function's existing signature/grants (see 20260907120000), so no new
-- revoke/grant statements are needed here.
-- ---------------------------------------------------------------------------
create or replace function public.has_member_schedule_conflict(
  p_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_responsibility_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_member_profile_id uuid;
  v_conflict boolean;
begin
  select family_id, profile_id into v_family_id, v_member_profile_id
  from public.family_members
  where id = p_member_id and removed_at is null;

  if v_family_id is null then
    raise exception 'no such family member' using errcode = '42501';
  end if;
  if not public.is_family_member(v_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if v_member_profile_id is null then
    return false;
  end if;

  select exists (
    select 1 from public.events e
    where e.owner_profile_id = v_member_profile_id
      and e.deleted_at is null
      and e.starts_at < p_ends_at
      and e.ends_at > p_starts_at

    union all

    select 1 from public.tasks t
    where t.assignee_member_id = p_member_id
      and t.deleted_at is null
      and t.date is not null
      and t.start_time is not null
      and t.timezone is not null
      and (t.date + t.start_time) at time zone t.timezone < p_ends_at
      and (t.date + t.start_time) at time zone t.timezone
        + make_interval(mins => coalesce(t.duration_minutes, 0)) > p_starts_at

    union all

    select 1 from public.responsibilities r
    join public.events e on e.id = r.event_id
    where r.assignee_member_id = p_member_id
      and r.status = 'accepted'
      and (p_exclude_responsibility_id is null or r.id <> p_exclude_responsibility_id)
      and e.deleted_at is null
      and e.starts_at < p_ends_at
      and e.ends_at > p_starts_at

    union all

    -- The member's own recurring personal-task occurrences (Phase 8).
    select 1 from public.task_occurrences o
    join public.tasks t2 on t2.id = o.task_id
    where t2.owner_profile_id = v_member_profile_id
      and t2.deleted_at is null
      and o.status = 'scheduled'
      and o.start_time is not null
      and o.timezone is not null
      and (o.occurrence_date + o.start_time) at time zone o.timezone < p_ends_at
      and (o.occurrence_date + o.start_time) at time zone o.timezone
        + make_interval(mins => coalesce(o.duration_minutes, 0)) > p_starts_at

    union all

    -- The member's own one-off timed personal task (Phase 8 — closes the
    -- same-shaped gap this function had for the non-recurring case too).
    select 1 from public.tasks t3
    where t3.owner_profile_id = v_member_profile_id
      and t3.deleted_at is null
      and t3.recurrence_rule_id is null
      and t3.completed_at is null
      and t3.date is not null
      and t3.start_time is not null
      and t3.timezone is not null
      and (t3.date + t3.start_time) at time zone t3.timezone < p_ends_at
      and (t3.date + t3.start_time) at time zone t3.timezone
        + make_interval(mins => coalesce(t3.duration_minutes, 0)) > p_starts_at
  ) into v_conflict;

  return v_conflict;
end;
$$;

comment on function public.has_member_schedule_conflict(uuid, timestamptz, timestamptz, uuid) is
  'Deterministic, privacy-safe: returns only a boolean, never which event/task/occurrence it '
  'conflicted with or any of its content. Caller must be a member of the same family as '
  'p_member_id. Half-open interval overlap ([starts_at, ends_at)) throughout. Extended in '
  'Phase 8 to see a member''s own recurring occurrences and one-off timed personal tasks, not '
  'just assigned shared tasks/events/responsibilities.';
