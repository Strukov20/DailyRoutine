-- Phase 9 final security/concurrency pass — removes a task-existence
-- oracle the prior completion-pass migration
-- (20260910120000_sync_issues_resolution.sql, commit 47df0e7) introduced by
-- mistake.
--
-- That migration split "the row doesn't exist" (P0002) from "the row
-- exists but isn't yours" (42501) so the Sync Issues screen could show a
-- more specific message. The problem: an *authenticated* caller can pass
-- any UUID to these RPCs, not just their own tasks' ids. Distinguishing
-- P0002 from 42501 lets that caller learn, for any UUID, whether a task
-- with that id exists anywhere in the system at all — regardless of who
-- owns it. That is a genuine cross-user information leak (a UUID-existence
-- oracle), not a cosmetic detail: it turns "not found" into a working
-- probe for enumerating or confirming other users' task ids.
--
-- Fix: collapse "doesn't exist," "exists but belongs to another profile,"
-- and "exists but is no longer visible to the caller" (soft-deleted) back
-- into exactly one outcome — errcode 42501, one sanitized message per
-- function — externally indistinguishable, matching this migration's own
-- reasoning for reusing 40001/42501 rather than inventing per-case codes.
-- 42501 remains reserved for "the caller is not authorized" in the general
-- sense; a transition-specific rule the caller IS authorized to know about
-- (e.g. "a recurring task cannot be completed directly," 22023) is
-- unaffected — those checks only run once the existence+ownership check
-- above has already passed, i.e. only for a task the caller is genuinely
-- authorized to know exists.
--
-- Every function below is `create or replace` with its existing exact
-- signature — no new parameter, no re-grant needed.

create or replace function public.update_personal_task(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_clear_description boolean default false,
  p_priority text default null,
  p_category_id uuid default null,
  p_clear_category boolean default false,
  p_visibility text default null,
  p_family_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_family_id uuid;
  v_assignment_status text;
  v_updated_at timestamptz;
begin
  select owner_profile_id, family_id, assignment_status, updated_at
    into v_owner, v_family_id, v_assignment_status, v_updated_at
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'task unavailable' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated_at then
    raise exception 'task changed on another device since the offline snapshot was taken'
      using errcode = '40001', hint = 'stale_write';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if v_assignment_status <> 'unassigned' then
    if p_visibility = 'private' then
      raise exception
        'a task with an active assignment cannot become Private — unassign it first'
        using errcode = '22023';
    end if;
    if p_family_id is not null and p_family_id <> v_family_id then
      raise exception
        'a task with an active assignment cannot be moved to another family — unassign it first'
        using errcode = '22023';
    end if;
  end if;

  update public.tasks set
    title = coalesce(p_title, title),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    priority = coalesce(p_priority, priority),
    category_id = case when p_clear_category then null else coalesce(p_category_id, category_id) end,
    visibility = coalesce(p_visibility, visibility),
    family_id = coalesce(p_family_id, family_id)
  where id = p_task_id;
end;
$$;
comment on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid, timestamptz) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately '
  'indistinguishable (both 42501, same message) — see docs/DECISIONS.md, "Phase 9," '
  'for why the earlier P0002 split was a cross-user existence oracle and was removed.';

create or replace function public.schedule_personal_task(
  p_task_id uuid,
  p_date date,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_recurrence_id uuid;
  v_updated_at timestamptz;
begin
  if p_date is null then
    raise exception 'p_date is required — use move_task_to_inbox to clear scheduling'
      using errcode = '22023';
  end if;

  select owner_profile_id, recurrence_rule_id, updated_at
    into v_owner, v_recurrence_id, v_updated_at
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'task unavailable' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated_at then
    raise exception 'task changed on another device since the offline snapshot was taken'
      using errcode = '40001', hint = 'stale_write';
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
comment on function public.schedule_personal_task(uuid, date, time, integer, text, timestamptz) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable, same as '
  'update_personal_task — see docs/DECISIONS.md, "Phase 9."';

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
    raise exception 'task unavailable' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task cannot be completed directly — complete a specific occurrence instead'
      using errcode = '22023';
  end if;

  update public.tasks set completed_at = now() where id = p_task_id and completed_at is null;
end;
$$;
comment on function public.complete_personal_task(uuid) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable — see '
  'docs/DECISIONS.md, "Phase 9."';

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
    raise exception 'task unavailable' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task cannot be restored directly — restore a specific occurrence instead'
      using errcode = '22023';
  end if;

  update public.tasks set completed_at = null where id = p_task_id and completed_at is not null;
end;
$$;
comment on function public.restore_personal_task(uuid) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable — see '
  'docs/DECISIONS.md, "Phase 9."';

create or replace function public.complete_task_occurrence(p_occurrence_id uuid)
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
    raise exception 'occurrence unavailable' using errcode = '42501';
  end if;

  update public.task_occurrences
  set status = 'completed', completed_at = now()
  where id = p_occurrence_id and status = 'scheduled';
end;
$$;
comment on function public.complete_task_occurrence(uuid) is
  'Idempotent — a repeat call on an already-completed occurrence matches zero rows. Completing '
  'one occurrence never affects any other occurrence of the same series (the next one stays '
  'open). Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable '
  '(both 42501) — see docs/DECISIONS.md, "Phase 9."';

create or replace function public.restore_task_occurrence(p_occurrence_id uuid)
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
    raise exception 'occurrence unavailable' using errcode = '42501';
  end if;

  update public.task_occurrences
  set status = 'scheduled', completed_at = null
  where id = p_occurrence_id and status = 'completed';
end;
$$;
comment on function public.restore_task_occurrence(uuid) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable (both '
  '42501) — see docs/DECISIONS.md, "Phase 9."';
