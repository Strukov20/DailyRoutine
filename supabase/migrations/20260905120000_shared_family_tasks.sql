-- Phase 5: shared family tasks, the assignment state machine, and a
-- member-removal fix required to make either of those safe. See
-- docs/DECISIONS.md, "Phase 5" for the full rationale; summarized here:
--
--   Audit finding, found before any new RPC was written: none of the
--   family_members-referencing foreign keys (tasks.assignee_member_id,
--   task_assignments.assigned_to_member_id/assigned_by_member_id,
--   event_participants, responsibilities) specify ON DELETE, so they
--   default to NO ACTION. task_assignments.assigned_to_member_id is
--   NOT NULL and rows are permanent audit history (never deleted) — which
--   means remove_family_member's Phase 3 `DELETE FROM family_members`
--   would raise a raw foreign-key violation the instant it targeted anyone
--   who had ever been part of a task assignment. This was latent (no
--   reachable feature exercised it before this phase) and is fixed here by
--   converting family_members removal to a soft delete (`removed_at`) —
--   the row survives for referential/audit integrity, and every place that
--   means "is a *current* member" (the three SECURITY DEFINER helpers, and
--   the two sanitized views' inline subqueries, which query family_members
--   directly rather than through the helpers) is updated to exclude
--   removed rows. remove_family_member now also resolves any pending or
--   accepted assignment atomically before soft-removing, so a task can
--   never stay assigned to someone who has lost access.
--
--   Every new function here follows the Phase 3/4 pattern: SECURITY
--   DEFINER, `set search_path = public`, explicit `revoke ... from
--   public, anon`, `grant execute ... to authenticated` only. State-
--   changing RPCs `select ... for update` the task row first, so
--   concurrent calls (two adults both calling take_family_task, or an
--   accept racing a reassign) serialize on that row instead of racing.
--
--   Custom-category resolution (brief Section 1): create_custom_category
--   (Phase 4) is real, tested, and correctly family-scoped — no personal-
--   category schema path exists, and none was added here either, per the
--   brief's own "avoid expanding category functionality beyond what's
--   needed for shared family tasks." The actual bug was that nothing in
--   the app ever called it — fixed at the application layer (the shared
--   task editor gets a minimal "new category" affordance), not here.

-- ---------------------------------------------------------------------------
-- family_members: soft delete instead of hard delete
-- ---------------------------------------------------------------------------
alter table public.family_members add column removed_at timestamptz;

comment on column public.family_members.removed_at is
  'Soft delete — set only by remove_family_member(). The row is never hard-deleted: '
  'task_assignments.assigned_to_member_id (audit history) is NOT NULL and every '
  'family_members-referencing FK has no ON DELETE clause, so a hard delete would raise a '
  'foreign-key violation for anyone who has ever been part of a task assignment. '
  'is_family_member()/is_family_owner()/current_family_ids() and the sanitized views all '
  'exclude removed_at IS NOT NULL rows, so a removed member loses access immediately even '
  'though their row still exists.';

create or replace function public.is_family_member(p_family_id uuid, p_profile_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.profile_id = p_profile_id
      and fm.removed_at is null
  );
$$;

create or replace function public.is_family_owner(p_family_id uuid, p_profile_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.profile_id = p_profile_id
      and fm.role = 'owner'
      and fm.removed_at is null
  );
$$;

create or replace function public.current_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select fm.family_id
  from public.family_members fm
  where fm.profile_id = auth.uid()
    and fm.removed_at is null;
$$;

-- Resolves the caller's own family_members.id within a family — used by
-- every shared-task RPC below to record "who did this" without repeating
-- this lookup inline each time.
create function public.current_member_id(p_family_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select fm.id
  from public.family_members fm
  where fm.family_id = p_family_id
    and fm.profile_id = auth.uid()
    and fm.removed_at is null;
$$;

comment on function public.current_member_id(uuid) is
  'The caller''s own family_members.id in p_family_id, or null if they are not a current '
  'member. A profile can never resolve to a child row here (children have no profile_id '
  'this phase — see create_child_profile), so this doubles as "current adult/owner member".';

revoke all on function public.current_member_id(uuid) from public, anon;
grant execute on function public.current_member_id(uuid) to authenticated;

create or replace view public.family_schedule as
select
  e.id,
  e.family_id,
  e.owner_profile_id,
  e.starts_at,
  e.ends_at,
  e.visibility,
  case when e.visibility = 'family' then e.title else null end as title,
  case when e.visibility = 'family' then e.description else null end as description,
  case when e.visibility = 'family' then e.location else null end as location
from public.events e
where
  e.family_id is not null
  and e.family_id in (
    select fm.family_id from public.family_members fm
    where fm.profile_id = auth.uid() and fm.removed_at is null
  );

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
    select fm.family_id from public.family_members fm
    where fm.profile_id = auth.uid() and fm.removed_at is null
  );

comment on view public.family_task_board is
  'Family-visible task board, mirroring family_schedule''s sanitization approach for '
  'private family-linked tasks. assignee_member_id is sanitized too, since it would '
  'otherwise leak who a private task is delegated to. Excludes soft-deleted tasks (Phase 4) '
  'and, via the inline family_members subquery, excludes removed members'' families (Phase 5) '
  '— though the latter is moot in practice since a removed member has no family_id to match.';

-- ---------------------------------------------------------------------------
-- remove_family_member: soft delete + atomic assignment resolution
-- ---------------------------------------------------------------------------
create or replace function public.remove_family_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_role text;
  v_acting_member_id uuid;
begin
  select family_id, role into v_family_id, v_role
  from public.family_members
  where id = p_member_id and removed_at is null;

  if v_family_id is null then
    raise exception 'no such family member' using errcode = '22023';
  end if;

  if not public.is_family_owner(v_family_id) then
    raise exception 'only the family owner can remove a member' using errcode = '42501';
  end if;

  if v_role = 'owner' then
    raise exception
      'the family owner cannot be removed — ownership transfer is not supported yet'
      using errcode = '22023';
  end if;

  -- Resolve every pending/accepted assignment atomically before the member
  -- loses access, so no task is left pointing at someone who can no longer
  -- see it. The audit trail records who actually did this (the owner
  -- performing the removal), not the removed member themselves.
  v_acting_member_id := public.current_member_id(v_family_id);

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  select t.id, t.assignee_member_id, v_acting_member_id, 'unassigned'
  from public.tasks t
  where t.family_id = v_family_id
    and t.assignee_member_id = p_member_id
    and t.assignment_status in ('pending_acceptance', 'accepted')
    and t.deleted_at is null
  for update of t;

  -- Soft delete: the row survives for the audit trail above (and any prior
  -- task_assignments history) — see the removed_at column comment.
  update public.family_members set removed_at = now() where id = p_member_id;
end;
$$;

comment on function public.remove_family_member(uuid) is
  'Owner-only, refuses to ever remove the owner row, and now soft-deletes (removed_at) '
  'instead of hard-deleting — see the removed_at column comment for why a hard delete is '
  'unsafe once task_assignments audit history exists. Every task currently assigned to the '
  'removed member is atomically unassigned first (audited as an ''unassigned'' action '
  'attributed to the owner performing the removal), so no task is left pointing at an '
  'inaccessible member.';

-- ---------------------------------------------------------------------------
-- update_personal_task: two new guards for tasks that are also shared
-- (Phase 5) — reused as-is for shared-task content editing otherwise, per
-- "never be converted into another family's task through an update" and
-- "never become Private while remaining a shared family task."
-- ---------------------------------------------------------------------------
create or replace function public.update_personal_task(
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
  v_family_id uuid;
  v_assignment_status text;
begin
  select owner_profile_id, family_id, assignment_status
    into v_owner, v_family_id, v_assignment_status
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'no such task' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- create_shared_family_task
-- ---------------------------------------------------------------------------
create function public.create_shared_family_task(
  p_family_id uuid,
  p_title text,
  p_description text default null,
  p_date date default null,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null,
  p_priority text default 'normal',
  p_category_id uuid default null,
  p_assignee_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_creator_member_id uuid;
  v_assignee_type text;
  v_task_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_creator_member_id := public.current_member_id(p_family_id);
  if v_creator_member_id is null then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if p_assignee_member_id is not null then
    select member_type into v_assignee_type
    from public.family_members
    where id = p_assignee_member_id and family_id = p_family_id and removed_at is null;

    if v_assignee_type is null then
      raise exception 'assignee is not a current member of this family' using errcode = '42501';
    end if;
    if v_assignee_type <> 'adult' then
      raise exception 'tasks cannot be assigned to a child profile' using errcode = '22023';
    end if;
  end if;

  insert into public.tasks (
    owner_profile_id, family_id, title, description, date, start_time, duration_minutes,
    timezone, priority, category_id, visibility, created_by
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_date, p_start_time, p_duration_minutes,
    p_timezone, coalesce(p_priority, 'normal'), p_category_id, 'family', v_profile_id
  )
  returning id into v_task_id;

  if p_assignee_member_id is not null then
    insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
    values (
      v_task_id,
      p_assignee_member_id,
      v_creator_member_id,
      case when p_assignee_member_id = v_creator_member_id then 'accepted' else 'assigned' end
    );
  end if;

  return v_task_id;
end;
$$;

comment on function public.create_shared_family_task(uuid, text, text, date, time, integer, text, text, uuid, uuid) is
  'The only way to create a shared task — always visibility=family, family_id required '
  '(never inferred/optional). owner_profile_id/created_by are always the caller. Optional '
  'assignee must be a current adult member of the same family; assigning to yourself is '
  'immediate acceptance (a single ''accepted'' audit row), assigning to someone else creates '
  'a ''assigned'' (pending_acceptance) audit row.';

revoke all on function public.create_shared_family_task(uuid, text, text, date, time, integer, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_shared_family_task(uuid, text, text, date, time, integer, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_task_assignment: shared internal logic for assign/reassign — never
-- granted directly (no client can call it as an RPC), only invoked from
-- assign_family_task/reassign_family_task below, which run as the same
-- (postgres) owner and so need no separate grant to call it.
-- ---------------------------------------------------------------------------
create function public.set_task_assignment(
  p_task_id uuid,
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
  v_creator_profile_id uuid;
  v_status text;
  v_completed_at timestamptz;
  v_deleted_at timestamptz;
  v_creator_member_id uuid;
  v_assignee_type text;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, owner_profile_id, assignment_status, completed_at, deleted_at
    into v_family_id, v_creator_profile_id, v_status, v_completed_at, v_deleted_at
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  if v_creator_profile_id <> v_profile_id and not public.is_family_owner(v_family_id) then
    raise exception 'only the task creator or family owner may assign this task' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;
  if v_completed_at is not null then
    raise exception 'completed tasks cannot be reassigned without restoring them first' using errcode = '22023';
  end if;

  if p_action = 'assigned' and v_status <> 'unassigned' then
    raise exception 'task is already assigned — use reassign instead' using errcode = '40001';
  end if;
  if p_action = 'reassigned' and v_status not in ('pending_acceptance', 'accepted') then
    raise exception 'task is not currently assigned' using errcode = '40001';
  end if;

  select member_type into v_assignee_type
  from public.family_members
  where id = p_assignee_member_id and family_id = v_family_id and removed_at is null;

  if v_assignee_type is null then
    raise exception 'assignee is not a current member of this family' using errcode = '42501';
  end if;
  if v_assignee_type <> 'adult' then
    raise exception 'tasks cannot be assigned to a child profile' using errcode = '22023';
  end if;

  v_creator_member_id := public.current_member_id(v_family_id);

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  values (
    p_task_id,
    p_assignee_member_id,
    v_creator_member_id,
    case when p_assignee_member_id = v_creator_member_id then 'accepted' else p_action end
  );
end;
$$;

comment on function public.set_task_assignment(uuid, uuid, text) is
  'Internal only — deliberately revoked from every role, including authenticated. Callable '
  'from assign_family_task/reassign_family_task because they run SECURITY DEFINER as the '
  'same owner, which does not require an EXECUTE grant to call a function it owns from '
  'within another of its own functions. See docs/DECISIONS.md, "Phase 3," for why this '
  'revoke has to name every role explicitly rather than trusting the default — Supabase''s '
  'role bootstrap grants EXECUTE to anon/authenticated directly at creation time, separate '
  'from the PUBLIC pseudo-role.';

revoke all on function public.set_task_assignment(uuid, uuid, text) from public, anon, authenticated;

create function public.assign_family_task(p_task_id uuid, p_assignee_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.set_task_assignment(p_task_id, p_assignee_member_id, 'assigned');
end;
$$;

comment on function public.assign_family_task(uuid, uuid) is
  'Requires the task to be currently unassigned — see reassign_family_task for an '
  'already-assigned task. Assigning to yourself is immediate acceptance.';

revoke all on function public.assign_family_task(uuid, uuid) from public, anon;
grant execute on function public.assign_family_task(uuid, uuid) to authenticated;

create function public.reassign_family_task(p_task_id uuid, p_assignee_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.set_task_assignment(p_task_id, p_assignee_member_id, 'reassigned');
end;
$$;

comment on function public.reassign_family_task(uuid, uuid) is
  'Requires the task to currently be pending_acceptance or accepted — see assign_family_task '
  'for an unassigned task. A stale previous recipient cannot accept afterwards (see '
  'accept_task_assignment: it re-checks the current assignee, not who was asked first).';

revoke all on function public.reassign_family_task(uuid, uuid) from public, anon;
grant execute on function public.reassign_family_task(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- unassign_family_task
-- ---------------------------------------------------------------------------
create function public.unassign_family_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_creator_profile_id uuid;
  v_status text;
  v_completed_at timestamptz;
  v_deleted_at timestamptz;
  v_current_assignee uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, owner_profile_id, assignment_status, completed_at, deleted_at, assignee_member_id
    into v_family_id, v_creator_profile_id, v_status, v_completed_at, v_deleted_at, v_current_assignee
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  if v_creator_profile_id <> v_profile_id and not public.is_family_owner(v_family_id) then
    raise exception 'only the task creator or family owner may unassign this task' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;
  if v_completed_at is not null then
    raise exception 'completed tasks cannot be unassigned without restoring them first' using errcode = '22023';
  end if;

  -- Idempotent: already-unassigned is a safe no-op (see complete/restore in Phase 4).
  if v_status = 'unassigned' then
    return;
  end if;

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_task_id, v_current_assignee, public.current_member_id(v_family_id), 'unassigned');
end;
$$;

revoke all on function public.unassign_family_task(uuid) from public, anon;
grant execute on function public.unassign_family_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- take_family_task — the concurrency-sensitive one
-- ---------------------------------------------------------------------------
create function public.take_family_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_completed_at timestamptz;
  v_deleted_at timestamptz;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- FOR UPDATE serializes concurrent Take attempts on the same task: the
  -- second transaction blocks here until the first commits, then re-reads
  -- v_status as it now stands (no longer 'unassigned') and correctly
  -- rejects instead of racing.
  select family_id, assignment_status, completed_at, deleted_at
    into v_family_id, v_status, v_completed_at, v_deleted_at
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;
  if v_completed_at is not null then
    raise exception 'task is already completed' using errcode = '22023';
  end if;
  if v_status <> 'unassigned' then
    raise exception 'task has already been taken' using errcode = '40001';
  end if;

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_task_id, v_member_id, null, 'took');
end;
$$;

comment on function public.take_family_task(uuid) is
  'Self-claim of an unassigned task — immediate acceptance (action=''took'', '
  'assigned_by_member_id null). SELECT ... FOR UPDATE on the task row is what makes '
  'concurrent Take attempts safe: exactly one commits successfully.';

revoke all on function public.take_family_task(uuid) from public, anon;
grant execute on function public.take_family_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_task_assignment / decline_task_assignment
-- ---------------------------------------------------------------------------
create function public.accept_task_assignment(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_deleted_at timestamptz;
  v_current_assignee uuid;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, assignment_status, deleted_at, assignee_member_id
    into v_family_id, v_status, v_deleted_at, v_current_assignee
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;

  -- Re-checks the *current* assignee, not "whoever was asked first" — a
  -- stale recipient (reassigned away between their fetch and this call)
  -- fails here rather than accepting an assignment that no longer exists.
  if v_status <> 'pending_acceptance' or v_current_assignee <> v_member_id then
    raise exception 'this assignment is no longer valid for you' using errcode = '40001';
  end if;

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_task_id, v_member_id, null, 'accepted');
end;
$$;

revoke all on function public.accept_task_assignment(uuid) from public, anon;
grant execute on function public.accept_task_assignment(uuid) to authenticated;

create function public.decline_task_assignment(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_deleted_at timestamptz;
  v_current_assignee uuid;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, assignment_status, deleted_at, assignee_member_id
    into v_family_id, v_status, v_deleted_at, v_current_assignee
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;

  if v_status <> 'pending_acceptance' or v_current_assignee <> v_member_id then
    raise exception 'this assignment is no longer valid for you' using errcode = '40001';
  end if;

  -- The apply_task_assignment_action trigger resolves the resulting task
  -- state to assignee_member_id=null, assignment_status='unassigned' —
  -- the declined action row itself is the permanent audit entry.
  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_task_id, v_member_id, null, 'declined');
end;
$$;

comment on function public.decline_task_assignment(uuid) is
  'Declining always resolves to Unassigned (apply_task_assignment_action''s existing '
  '''declined'' -> assignee_member_id null / assignment_status unassigned mapping) — the '
  '''declined'' task_assignments row is the permanent record that this happened.';

revoke all on function public.decline_task_assignment(uuid) from public, anon;
grant execute on function public.decline_task_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_shared_task / restore_shared_task — creator or the currently
-- ACCEPTED assignee only (not merely "assigned"); unlike
-- complete_personal_task/restore_personal_task (Phase 4), which remain
-- owner-only and still work fine for a creator completing their own
-- family task, these two exist specifically so a non-creator accepted
-- assignee can also complete/restore.
-- ---------------------------------------------------------------------------
create function public.complete_shared_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_creator_profile_id uuid;
  v_status text;
  v_current_assignee uuid;
  v_deleted_at timestamptz;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, owner_profile_id, assignment_status, assignee_member_id, deleted_at
    into v_family_id, v_creator_profile_id, v_status, v_current_assignee, v_deleted_at
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);

  if v_creator_profile_id <> v_profile_id
     and (v_member_id is null or v_current_assignee <> v_member_id or v_status <> 'accepted')
  then
    raise exception 'only the task creator or its accepted assignee may complete it' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;

  update public.tasks set completed_at = now() where id = p_task_id and completed_at is null;
end;
$$;

revoke all on function public.complete_shared_task(uuid) from public, anon;
grant execute on function public.complete_shared_task(uuid) to authenticated;

create function public.restore_shared_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_creator_profile_id uuid;
  v_status text;
  v_current_assignee uuid;
  v_deleted_at timestamptz;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select family_id, owner_profile_id, assignment_status, assignee_member_id, deleted_at
    into v_family_id, v_creator_profile_id, v_status, v_current_assignee, v_deleted_at
  from public.tasks
  where id = p_task_id
  for update;

  if v_family_id is null then
    raise exception 'no such shared task' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);

  if v_creator_profile_id <> v_profile_id
     and (v_member_id is null or v_current_assignee <> v_member_id or v_status <> 'accepted')
  then
    raise exception 'only the task creator or its accepted assignee may restore it' using errcode = '42501';
  end if;

  if v_deleted_at is not null then
    raise exception 'task is archived' using errcode = '22023';
  end if;

  update public.tasks set completed_at = null where id = p_task_id and completed_at is not null;
end;
$$;

revoke all on function public.restore_shared_task(uuid) from public, anon;
grant execute on function public.restore_shared_task(uuid) to authenticated;
