-- Phase 9 completion pass: Sync Issues resolution UX.
--
-- The offline queue itself needs no new server-side "operations" table
-- (see docs/DECISIONS.md, "Phase 9" — the queue is client-side persisted
-- state; only an idempotency/concurrency guarantee needs server support,
-- already in place via client_operation_id and expected_updated_at). This
-- migration adds exactly one thing the Sync Issues UX needs that the RPCs
-- didn't yet distinguish: "the row doesn't exist any more" (a real,
-- reachable case once an offline queue can replay against a task deleted
-- from another device) versus "the row exists but isn't yours" (42501,
-- generic forbidden). Both previously collapsed into the same 42501 —
-- correct for authorization purposes, but not enough for the Sync Issues
-- screen to show "This task no longer exists" instead of the generic
-- "You no longer have access" it would otherwise have to guess between.
--
-- P0002 (no_data_found) is a real, standard PL/pgSQL condition code —
-- reused deliberately, the same convention 40001 (stale-write) already
-- established in the prior Phase 9 migration, rather than inventing a
-- bespoke code.
--
-- Every function below is `create or replace` with its existing exact
-- signature (no parameter added or removed), so no DROP FUNCTION/re-grant
-- dance is needed this time — only update_personal_task/
-- schedule_personal_task/complete_personal_task/restore_personal_task/
-- complete_task_occurrence/restore_task_occurrence are touched, all of
-- which currently fold "not found" and "not yours" into one 42501 check.

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
  v_exists boolean;
  v_owner uuid;
  v_family_id uuid;
  v_assignment_status text;
  v_updated_at timestamptz;
begin
  select true, owner_profile_id, family_id, assignment_status, updated_at
    into v_exists, v_owner, v_family_id, v_assignment_status, v_updated_at
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_exists is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
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
  'Sync Issues completion pass: "not found" (P0002, the row is gone) is now distinguished from '
  '"not yours" (42501) — both previously raised the same 42501. See docs/DECISIONS.md, "Phase 9."';

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
  v_exists boolean;
  v_owner uuid;
  v_recurrence_id uuid;
  v_updated_at timestamptz;
begin
  if p_date is null then
    raise exception 'p_date is required — use move_task_to_inbox to clear scheduling'
      using errcode = '22023';
  end if;

  select true, owner_profile_id, recurrence_rule_id, updated_at
    into v_exists, v_owner, v_recurrence_id, v_updated_at
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_exists is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
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
  'Sync Issues completion pass: "not found" (P0002) distinguished from "not yours" (42501), same '
  'as update_personal_task. See docs/DECISIONS.md, "Phase 9."';

create or replace function public.complete_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select true, owner_profile_id, recurrence_rule_id into v_exists, v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_exists is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
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
  v_exists boolean;
  v_owner uuid;
  v_recurrence_id uuid;
begin
  select true, owner_profile_id, recurrence_rule_id into v_exists, v_owner, v_recurrence_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_exists is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;
  if v_recurrence_id is not null then
    raise exception 'a recurring task cannot be restored directly — restore a specific occurrence instead'
      using errcode = '22023';
  end if;

  update public.tasks set completed_at = null where id = p_task_id and completed_at is not null;
end;
$$;

create or replace function public.complete_task_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_owner uuid;
begin
  select true, o.owner_profile_id into v_exists, v_owner
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_exists is null then
    raise exception 'occurrence not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
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
  'open). Sync Issues completion pass: "not found" (P0002) distinguished from "not yours" '
  '(42501) — see docs/DECISIONS.md, "Phase 9."';

create or replace function public.restore_task_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_owner uuid;
begin
  select true, o.owner_profile_id into v_exists, v_owner
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id and t.deleted_at is null
  where o.id = p_occurrence_id
  for update of o;

  if v_exists is null then
    raise exception 'occurrence not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'no such occurrence' using errcode = '42501';
  end if;

  update public.task_occurrences
  set status = 'scheduled', completed_at = null
  where id = p_occurrence_id and status = 'completed';
end;
$$;
