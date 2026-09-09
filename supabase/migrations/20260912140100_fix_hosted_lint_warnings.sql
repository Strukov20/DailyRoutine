-- ---------------------------------------------------------------------------
-- Phase 10B corrective pass — three findings from `supabase db lint` against
-- the linked hosted staging project (ref ocurkeddkqkeitjfbcbe). All three are
-- narrow and behavior-preserving; see docs/DECISIONS.md, "Phase 10B
-- corrective pass," for the full root-cause analysis (verified empirically
-- against a real local Postgres instance, not assumed from the warning text
-- alone) and knowledge/wiki/engineering/data-model.md for the summary.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. set_responsibility_assignment — v_event_id was selected but never read.
--    r.event_id is still used in the join condition itself; only the unused
--    output column/variable pair is removed. No other behavior change.
-- ---------------------------------------------------------------------------
create or replace function public.set_responsibility_assignment(
  p_responsibility_id uuid,
  p_assignee_member_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_event_owner_profile_id uuid;
  v_status text;
  v_assignee_type text;
  v_creator_member_id uuid;
begin
  select r.family_id, r.status, e.owner_profile_id
    into v_family_id, v_status, v_event_owner_profile_id
  from public.responsibilities r
  join public.events e on e.id = r.event_id
  where r.id = p_responsibility_id
  for update of r;

  if v_family_id is null then
    raise exception 'no such responsibility' using errcode = '42501';
  end if;

  if v_event_owner_profile_id <> v_profile_id and not public.is_family_owner(v_family_id) then
    raise exception 'only the event owner or family owner may assign this responsibility' using errcode = '42501';
  end if;

  if p_action = 'assigned' and v_status <> 'unassigned' then
    raise exception 'responsibility is already assigned — use reassign instead' using errcode = '40001';
  end if;
  if p_action = 'reassigned' and v_status not in ('pending_acceptance', 'accepted') then
    raise exception 'responsibility is not currently assigned' using errcode = '40001';
  end if;

  select member_type into v_assignee_type
  from public.family_members
  where id = p_assignee_member_id and family_id = v_family_id and removed_at is null;

  if v_assignee_type is null then
    raise exception 'assignee is not a current member of this family' using errcode = '42501';
  end if;
  if v_assignee_type <> 'adult' then
    raise exception 'responsibilities cannot be assigned to a child profile' using errcode = '22023';
  end if;

  v_creator_member_id := public.current_member_id(v_family_id);

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  values (
    p_responsibility_id,
    p_assignee_member_id,
    v_creator_member_id,
    case when p_assignee_member_id = v_creator_member_id then 'accepted' else p_action end
  );
end;
$$;

comment on function public.set_responsibility_assignment(uuid, uuid, text) is
  'Internal only — deliberately revoked from every role, including authenticated. Mirrors '
  'set_task_assignment (Phase 5) exactly, including the self-assign-is-immediate-acceptance '
  'shortcut. Phase 10B: dropped an unused v_event_id (r.event_id is still used in the join '
  'condition, just never selected out) — a hosted-lint finding, no behavior change.';

-- ---------------------------------------------------------------------------
-- 2. update_event — v_family_id was selected but never read (this RPC checks
--    ownership via owner_profile_id alone; it has no family-scoped branch
--    that needs the family id). family_id is dropped from the select list.
-- ---------------------------------------------------------------------------
create or replace function public.update_event(
  p_event_id uuid,
  p_title text default null,
  p_description text default null,
  p_clear_description boolean default false,
  p_location text default null,
  p_clear_location boolean default false,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_timezone text default null,
  p_visibility text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_has_responsibility boolean;
begin
  select owner_profile_id, starts_at, ends_at
    into v_owner, v_starts_at, v_ends_at
  from public.events
  where id = p_event_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such event' using errcode = '42501';
  end if;

  if p_visibility is not null and p_visibility not in ('private', 'family') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;

  if p_visibility = 'private' then
    select exists (select 1 from public.responsibilities where event_id = p_event_id)
      into v_has_responsibility;
    if v_has_responsibility then
      raise exception
        'an event with any responsibility cannot become Private — remove the responsibility first'
        using errcode = '22023';
    end if;
  end if;

  if (p_starts_at is not null or p_ends_at is not null)
     and coalesce(p_ends_at, v_ends_at) <= coalesce(p_starts_at, v_starts_at)
  then
    raise exception 'ends_at must be after starts_at' using errcode = '22023';
  end if;

  update public.events set
    title = coalesce(p_title, title),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    location = case when p_clear_location then null else coalesce(p_location, location) end,
    starts_at = coalesce(p_starts_at, starts_at),
    ends_at = coalesce(p_ends_at, ends_at),
    timezone = coalesce(p_timezone, timezone),
    visibility = coalesce(p_visibility, visibility)
  where id = p_event_id;
end;
$$;

comment on function public.update_event(uuid, text, text, boolean, text, boolean, timestamptz, timestamptz, text, text) is
  'Owner-only. Responsibility due times are derived from starts_at/ends_at (see '
  'family_responsibilities), so changing either here automatically moves them — no separate '
  'update needed and no drift is possible. Phase 10B: dropped an unused v_family_id (this RPC '
  'authorizes via owner_profile_id only) — a hosted-lint finding, no behavior change.';

-- ---------------------------------------------------------------------------
-- 3. compute_next_occurrence_date — declared IMMUTABLE but contained two
--    expressions Postgres's own planner classifies as STABLE:
--
--    a) Daily branch: `(p_interval || ' days')::interval` casts a computed
--       string to interval at runtime, invoking interval_in — which Postgres
--       marks STABLE (conservatively; interval *literal* syntax like
--       `interval '1 day'`, used elsewhere in this same function's
--       monthly/yearly branches, is parsed to a Const at parse time instead
--       and never hits this classification, which is why the linter didn't
--       flag those).
--    b) Weekly branch: `date_trunc('week', v_candidate)` where v_candidate
--       is `date`. No `date_trunc(text, date)` overload exists; Postgres's
--       overload resolver picks the "preferred" datetime-category type
--       (timestamptz — confirmed via pg_type.typispreferred) over the
--       non-preferred `timestamp` overload, silently routing through the
--       STABLE, session-timezone-dependent `date_trunc(text, timestamptz)`.
--
--    Both were verified empirically (against a real local Postgres
--    instance): the *values* produced today happen to be timezone-invariant
--    for both call sites (the round-trip through a session timezone is
--    self-consistent for whole-day arithmetic), but Postgres cannot prove
--    that statically, and an IMMUTABLE function calling a STABLE one is
--    "the programmer's responsibility" per Postgres's own docs — a future
--    caller relying on this being genuinely IMMUTABLE (an index, a
--    generated column, query-plan caching across a changed session
--    timezone) would be relying on an unproven, accidental invariant.
--
--    Fix: rewrite both call sites with genuinely immutable equivalents
--    rather than reclassifying the function as STABLE — STABLE would be
--    incorrect here (nothing in this function actually needs "the current
--    query's" timezone; a) is fixed with make_interval, which needs no
--    string parsing at all, and b) is fixed with an explicit ::timestamp
--    cast, forcing the immutable overload instead of letting the resolver
--    pick the preferred-but-wrong one). Both rewrites were confirmed to
--    produce byte-identical output to the prior expressions across every
--    case exercised by 140_recurring_tasks_reminders_test.sql and the new
--    190_hosted_lint_fixes_test.sql (below).
-- ---------------------------------------------------------------------------
create or replace function public.compute_next_occurrence_date(
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
    return p_after + make_interval(days => p_interval);
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
        -- The explicit ::timestamp cast forces date_trunc's immutable
        -- (text, timestamp) overload instead of letting Postgres's
        -- overload resolver silently prefer the STABLE (text, timestamptz)
        -- one for a bare `date` argument — see the function-level comment
        -- above. date_trunc(...)::date still gives a plain date, so the
        -- subtraction is a direct integer day count, not an interval.
        if (
          (date_trunc('week', v_candidate::timestamp)::date - date_trunc('week', p_anchor_date::timestamp)::date)
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
  'a period where the anchor day does not exist rather than clamping to the last day. Phase '
  '10B: rewrote the daily branch (make_interval, no runtime string-to-interval parse) and the '
  'weekly branch''s date_trunc calls (explicit ::timestamp cast) so the function is genuinely '
  'IMMUTABLE — not just observed to behave that way — per a hosted-lint finding that its '
  'prior form silently routed through two STABLE overloads.';
