-- Phase 4: personal task lifecycle (Inbox/Today/Tomorrow), soft delete, and a
-- small custom-category RPC — all as narrowly scoped SECURITY DEFINER RPCs,
-- following the exact pattern established in
-- 20260903120000_family_management.sql. See docs/DECISIONS.md, "Phase 4"
-- for the full rationale; summarized here:
--
--   Audit finding: `tasks` granted raw INSERT/UPDATE/DELETE to
--   `authenticated`. The UPDATE policy's WITH CHECK only pinned
--   owner_profile_id = auth.uid() — nothing stopped a client from directly
--   rewriting family_id, assignee_member_id, or assignment_status on their
--   own task via a plain PATCH, bypassing the task_assignments audit trail
--   entirely, and nothing revalidated is_family_member(family_id) on
--   UPDATE the way the INSERT policy did. Closed by revoking all three
--   grants and replacing every mutation with an RPC below. The three now-
--   dead INSERT/UPDATE/DELETE policies are dropped for clarity, same as
--   Phase 3's cleanup of family_members'/family_invitations' dead policies.
--
--   Two real data-integrity gaps, also closed here as CHECK constraints
--   (enforced regardless of write path, not just re-implemented per RPC):
--   a task could have start_time set with no date at all (meaningless —
--   which day does that time belong to?), and duration_minutes had no
--   upper bound. NOT changed: DATA_MODEL.md already documents
--   `visibility = 'family'` with `family_id IS NULL` as an intentional
--   "ignored, not invalid" state — no constraint added against it.
--
--   `categories` already had a dead `"for all"` policy with zero backing
--   grant (custom category creation never actually worked) — replaced with
--   create_custom_category(), owner-only, mirroring the existing
--   family-administrative-action convention.
--
--   Every function here explicitly revokes from `public, anon` (not just
--   `public`) per the Phase 3 finding that Supabase's own role bootstrap
--   grants `anon` EXECUTE directly, separate from the PUBLIC pseudo-role.

-- ---------------------------------------------------------------------------
-- tasks: soft delete + two new integrity constraints
-- ---------------------------------------------------------------------------
alter table public.tasks add column deleted_at timestamptz;

comment on column public.tasks.deleted_at is
  'Soft delete / archive. Set only by delete_or_archive_personal_task(). A deleted task is '
  'excluded from the owner-facing SELECT policy and from family_task_board — RPCs that read '
  'it back for further mutation (update/complete/restore/schedule/move-to-inbox) also treat '
  'it as gone, except delete_or_archive_personal_task itself, which is idempotent.';

alter table public.tasks
  drop constraint tasks_duration_minutes_check,
  add constraint tasks_duration_minutes_bounded
    check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440)),
  add constraint tasks_time_requires_date
    check (start_time is null or date is not null);

-- ---------------------------------------------------------------------------
-- tasks: RPC-only writes from here on — SELECT stays direct/RLS-governed
-- ---------------------------------------------------------------------------
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;

drop policy if exists "tasks_select_owner_or_family_visible" on public.tasks;
create policy "tasks_select_owner_or_family_visible"
  on public.tasks
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      owner_profile_id = auth.uid()
      or (visibility = 'family' and family_id in (select public.current_family_ids()))
    )
  );

revoke insert, update, delete on public.tasks from authenticated;

-- family_task_board must exclude soft-deleted tasks too — recreated with
-- the same column list and sanitization as before, plus the new filter.
create or replace view public.family_task_board as
select
  t.id,
  t.family_id,
  t.owner_profile_id,
  t.date,
  t.start_time,
  t.duration_minutes,
  t.timezone,
  t.visibility,
  t.assignment_status,
  case when t.visibility = 'family' then t.title else null end as title,
  case when t.visibility = 'family' then t.description else null end as description,
  case when t.visibility = 'family' then t.priority else null end as priority,
  case when t.visibility = 'family' then t.category_id else null end as category_id,
  case when t.visibility = 'family' then t.assignee_member_id else null end as assignee_member_id
from public.tasks t
where
  t.deleted_at is null
  and t.family_id is not null
  and t.family_id in (
    select fm.family_id from public.family_members fm where fm.profile_id = auth.uid()
  );

comment on view public.family_task_board is
  'Family-visible task board, mirroring family_schedule''s sanitization approach for '
  'private family-linked tasks. assignee_member_id is sanitized too, since it would '
  'otherwise leak who a private task is delegated to. Excludes soft-deleted tasks (Phase 4).';

-- ---------------------------------------------------------------------------
-- create_personal_task
-- ---------------------------------------------------------------------------
create function public.create_personal_task(
  p_title text,
  p_description text default null,
  p_date date default null,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null,
  p_priority text default 'normal',
  p_category_id uuid default null,
  p_visibility text default 'private',
  p_family_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_task_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  insert into public.tasks (
    owner_profile_id, family_id, title, description, date, start_time, duration_minutes,
    timezone, priority, category_id, visibility, created_by
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_date, p_start_time, p_duration_minutes,
    p_timezone, coalesce(p_priority, 'normal'), p_category_id, coalesce(p_visibility, 'private'),
    v_profile_id
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

comment on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid) is
  'The only way to create a task. owner_profile_id is always the caller — never a parameter. '
  'Title-only creation (Inbox quick-add) and full creation (with schedule) are the same call, '
  'differing only in which optional parameters are supplied.';

revoke all on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid) from public, anon;
grant execute on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_personal_task — content fields only; scheduling goes through
-- schedule_personal_task / move_task_to_inbox below.
-- ---------------------------------------------------------------------------
create function public.update_personal_task(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_clear_description boolean default false,
  p_priority text default null,
  p_category_id uuid default null,
  p_clear_category boolean default false,
  p_visibility text default null,
  p_family_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
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

comment on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid) is
  'Unsupplied (null) parameters leave the corresponding field unchanged — "editing does not '
  'overwrite unchanged fields". description/category_id use an explicit clear flag because '
  'null already means "unchanged" for them. Never accepts owner_profile_id, '
  'assignee_member_id, or assignment_status — those are not parameters at all.';

revoke all on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid) from public, anon;
grant execute on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_personal_task / restore_personal_task — both idempotent
-- ---------------------------------------------------------------------------
create function public.complete_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  update public.tasks set completed_at = now() where id = p_task_id and completed_at is null;
end;
$$;

comment on function public.complete_personal_task(uuid) is
  'Idempotent: completing an already-completed task is a silent no-op, not an error (the '
  'WHERE completed_at is null simply matches zero rows on a repeat call).';

revoke all on function public.complete_personal_task(uuid) from public, anon;
grant execute on function public.complete_personal_task(uuid) to authenticated;

create function public.restore_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  update public.tasks set completed_at = null where id = p_task_id and completed_at is not null;
end;
$$;

comment on function public.restore_personal_task(uuid) is
  'Undoes completion (clears completed_at). Idempotent, mirroring complete_personal_task. '
  'Not to be confused with un-archiving — there is no undelete this phase, by design '
  '(see docs/DECISIONS.md, "Phase 4").';

revoke all on function public.restore_personal_task(uuid) from public, anon;
grant execute on function public.restore_personal_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- schedule_personal_task / move_task_to_inbox
-- ---------------------------------------------------------------------------
create function public.schedule_personal_task(
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
begin
  if p_date is null then
    raise exception 'p_date is required — use move_task_to_inbox to clear scheduling'
      using errcode = '22023';
  end if;

  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  -- Wholesale replacement, not a merge: one call fully defines the new
  -- schedule, so "Today, Anytime" -> "Today, 14:00 for 30m" -> "Tomorrow,
  -- Anytime" are each a single atomic call with no intermediate invalid
  -- state (e.g. a stale start_time surviving a date-only reschedule).
  update public.tasks set
    date = p_date,
    start_time = p_start_time,
    duration_minutes = p_duration_minutes,
    timezone = p_timezone
  where id = p_task_id;
end;
$$;

comment on function public.schedule_personal_task(uuid, date, time, integer, text) is
  'Sets date (required) and replaces start_time/duration_minutes/timezone wholesale — also '
  'used for "move to Today", "move to Tomorrow", and manual reschedule (the client just '
  'passes the target date). See move_task_to_inbox() for clearing scheduling entirely.';

revoke all on function public.schedule_personal_task(uuid, date, time, integer, text) from public, anon;
grant execute on function public.schedule_personal_task(uuid, date, time, integer, text) to authenticated;

create function public.move_task_to_inbox(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  update public.tasks set date = null, start_time = null, duration_minutes = null, timezone = null
  where id = p_task_id;
end;
$$;

revoke all on function public.move_task_to_inbox(uuid) from public, anon;
grant execute on function public.move_task_to_inbox(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_or_archive_personal_task — soft delete, idempotent
-- ---------------------------------------------------------------------------
create function public.delete_or_archive_personal_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- Deliberately does not filter deleted_at is null here (unlike every
  -- other RPC above) — archiving an already-archived task is a safe no-op,
  -- not a 42501, so a duplicate tap/retry never surfaces a confusing error.
  select owner_profile_id into v_owner
  from public.tasks
  where id = p_task_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
  end if;

  update public.tasks set deleted_at = now() where id = p_task_id and deleted_at is null;
end;
$$;

comment on function public.delete_or_archive_personal_task(uuid) is
  'Soft delete only — sets deleted_at. There is no hard-delete RPC or UI this phase (see '
  'docs/DECISIONS.md, "Phase 4").';

revoke all on function public.delete_or_archive_personal_task(uuid) from public, anon;
grant execute on function public.delete_or_archive_personal_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_custom_category — closes the dead-policy gap; owner-only
-- ---------------------------------------------------------------------------
drop policy if exists "categories_family_owner_manages_custom" on public.categories;

create function public.create_custom_category(
  p_family_id uuid,
  p_name text,
  p_color_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_family_owner(p_family_id) then
    raise exception 'only the family owner can create a custom category' using errcode = '42501';
  end if;

  insert into public.categories (family_id, name, color_token, is_system, created_by)
  values (p_family_id, p_name, p_color_token, false, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_custom_category(uuid, text, text) is
  'The only way to create a custom category — categories never had a working direct-INSERT '
  'path (the Phase 2 policy for it had no backing grant). Owner-only, mirroring the existing '
  'family-administrative-action convention. No update/delete RPC this phase — deferred.';

revoke all on function public.create_custom_category(uuid, text, text) from public, anon;
grant execute on function public.create_custom_category(uuid, text, text) to authenticated;
