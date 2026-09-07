-- Phase 7: Family Calendar, Child Events, and Responsibilities.
--
-- Audit finding, found before any new RPC was written (same class of gap as
-- Phase 4's tasks finding, Phase 5's set_task_assignment finding, and Phase
-- 6's anon-EXECUTE finding — see docs/DECISIONS.md, "Phase 7"):
-- `events`/`event_participants`/`responsibilities` (Phase 2) granted raw
-- INSERT/UPDATE/DELETE to `authenticated`. In particular,
-- "responsibilities_owner_manages" let the event owner UPDATE a
-- responsibility's `status`/`assignee_member_id` directly via a plain
-- PATCH — bypassing the accept/decline/take state machine and its audit
-- trail entirely, the exact same shape of gap Phase 4 found and closed for
-- `tasks`. Closed the same way: revoke the three grants, drop the now-dead
-- policies, replace every mutation with a narrowly scoped SECURITY DEFINER
-- RPC. SELECT stays direct/RLS-governed throughout.
--
-- Schema evolution, not replacement: `events`/`event_participants`/
-- `responsibilities` (Phase 2) are reused as designed — only a `deleted_at`
-- column (soft delete, mirroring tasks) is added to `events`. A new
-- `responsibility_assignments` audit table is added, mirroring
-- `task_assignments` exactly (append-only, one row per state transition) —
-- NOT reused from `task_assignments` itself, since a responsibility and a
-- task are different domain concepts with different owning tables (event vs
-- task) and mixing them would make "every assignment this member ever had"
-- ambiguous between the two. `responsibilities.status`'s existing vocabulary
-- (unassigned | pending_acceptance | accepted | declined | done) is kept
-- as-is — it already matches tasks.assignment_status, so no renaming.
--
-- Every function here: SECURITY DEFINER, `set search_path = public`,
-- explicit `revoke ... from public, anon` (not just `public` — Phase 3's
-- finding that Supabase's role bootstrap grants EXECUTE to anon/
-- authenticated directly, separate from PUBLIC), `select ... for update` on
-- the row being mutated so concurrent calls serialize instead of racing.

-- ---------------------------------------------------------------------------
-- events: soft delete + a same-family-membership guard event_participants/
-- responsibilities were missing (the FK only checked family match, not
-- removed_at — a removed member could still be attached as a participant or
-- assignee since Phase 2 predates the removed_at column entirely).
-- ---------------------------------------------------------------------------
alter table public.events add column deleted_at timestamptz;

comment on column public.events.deleted_at is
  'Soft delete / cancel. Set only by cancel_event(). No restore RPC this phase — same '
  'convention as tasks.deleted_at (Phase 4): "no undelete this phase," not an oversight.';

-- A private event cannot carry a responsibility — a responsibility's
-- assignee needs read access to the event to know about their own duty
-- (the same reasoning as tasks_assert_integrity's private+non-owner-assignee
-- rejection, Phase 2). Enforced as a trigger (not a CHECK, which can't
-- reference another table) on responsibilities insert/update.
create function public.assert_responsibility_event_is_family_visible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visibility text;
begin
  select visibility into v_visibility from public.events where id = new.event_id;

  if v_visibility <> 'family' then
    raise exception 'a responsibility cannot be attached to a private event' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger responsibilities_assert_event_family_visible
  before insert or update of event_id on public.responsibilities
  for each row
  execute function public.assert_responsibility_event_is_family_visible();

-- ---------------------------------------------------------------------------
-- responsibility_assignments — append-only audit trail, mirrors
-- task_assignments exactly (see docs/DATA_MODEL.md, "task_assignments").
-- ---------------------------------------------------------------------------
create table public.responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  responsibility_id uuid not null references public.responsibilities (id) on delete cascade,
  -- Denormalized from responsibilities.family_id by the trigger below —
  -- same rationale as task_assignments.family_id.
  family_id uuid not null,
  assigned_to_member_id uuid not null,
  assigned_by_member_id uuid,
  action text not null
    check (action in ('assigned', 'took', 'accepted', 'declined', 'unassigned', 'reassigned')),
  created_at timestamptz not null default now(),

  constraint responsibility_assignments_to_same_family
    foreign key (assigned_to_member_id, family_id)
    references public.family_members (id, family_id),
  constraint responsibility_assignments_by_same_family
    foreign key (assigned_by_member_id, family_id)
    references public.family_members (id, family_id)
);

comment on table public.responsibility_assignments is
  'Append-only: every responsibility assignment action is a new row, never edited. '
  'responsibilities.assignee_member_id / status are a snapshot maintained by '
  'apply_responsibility_assignment_action(). Deleted (cascade) if the responsibility itself '
  'is removed via remove_event_responsibility() — see that function''s own comment for why '
  'losing history at that point is acceptable (unlike task_assignments, nothing else '
  'references this row once its own responsibility is gone).';

create index responsibility_assignments_responsibility_id_idx
  on public.responsibility_assignments (responsibility_id);
create index responsibility_assignments_family_id_idx
  on public.responsibility_assignments (family_id);

create function public.set_responsibility_assignment_family_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select r.family_id into new.family_id
  from public.responsibilities r
  where r.id = new.responsibility_id;

  if new.family_id is null then
    raise exception 'cannot record a responsibility assignment for an unknown responsibility %', new.responsibility_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger responsibility_assignments_set_family_id
  before insert on public.responsibility_assignments
  for each row
  execute function public.set_responsibility_assignment_family_id();

create function public.apply_responsibility_assignment_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.responsibilities
  set
    assignee_member_id = case new.action
      when 'declined' then null
      when 'unassigned' then null
      else new.assigned_to_member_id
    end,
    status = case new.action
      when 'assigned' then 'pending_acceptance'
      when 'reassigned' then 'pending_acceptance'
      when 'took' then 'accepted'
      when 'accepted' then 'accepted'
      when 'declined' then 'unassigned'
      when 'unassigned' then 'unassigned'
    end
  where id = new.responsibility_id;

  return new;
end;
$$;

create trigger responsibility_assignments_apply_action
  after insert on public.responsibility_assignments
  for each row
  execute function public.apply_responsibility_assignment_action();

-- ---------------------------------------------------------------------------
-- events / event_participants / responsibilities: RPC-only writes from here
-- on — SELECT stays direct/RLS-governed, same convention as tasks (Phase 4).
-- ---------------------------------------------------------------------------
drop policy if exists "events_insert_own" on public.events;
drop policy if exists "events_update_own" on public.events;
drop policy if exists "events_delete_own" on public.events;

drop policy if exists "events_select_owner_or_family_visible" on public.events;
create policy "events_select_owner_or_family_visible"
  on public.events
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      owner_profile_id = auth.uid()
      or (visibility = 'family' and family_id in (select public.current_family_ids()))
    )
  );

revoke insert, update, delete on public.events from authenticated;

drop policy if exists "event_participants_owner_manages" on public.event_participants;
revoke insert, update, delete on public.event_participants from authenticated;

drop policy if exists "responsibilities_owner_manages" on public.responsibilities;
revoke insert, update, delete on public.responsibilities from authenticated;

-- responsibility_assignments: append-only. SELECT is granted (same-family,
-- read-only) so a client can read its own audit history directly — mirrors
-- task_assignments_select_family (Phase 2) exactly. INSERT stays fully
-- closed (unlike task_assignments, which still carries a direct-INSERT
-- policy from Phase 2, predating the RPC-only convention) — every write
-- here goes exclusively through the RPCs below, which run as the table
-- owner and so need no grant of their own. No UPDATE/DELETE grant either
-- way — history is permanent.
alter table public.responsibility_assignments enable row level security;
alter table public.responsibility_assignments force row level security;
revoke all on public.responsibility_assignments from anon, authenticated;

create policy "responsibility_assignments_select_family"
  on public.responsibility_assignments
  for select
  to authenticated
  using (public.is_family_member(family_id));

grant select on public.responsibility_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- family_schedule: evolved to exclude soft-deleted events and to expose the
-- primary participant (MVP: one primary subject/member per event — see
-- docs/DECISIONS.md, "Phase 7," for why the schema still supports more).
-- ---------------------------------------------------------------------------
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
  case when e.visibility = 'family' then e.location else null end as location,
  case when e.visibility = 'family' then (
    select ep.family_member_id
    from public.event_participants ep
    where ep.event_id = e.id
    order by ep.created_at
    limit 1
  ) else null end as participant_member_id
from public.events e
where
  e.deleted_at is null
  and e.family_id is not null
  and e.family_id in (
    select fm.family_id from public.family_members fm
    where fm.profile_id = auth.uid() and fm.removed_at is null
  );

comment on view public.family_schedule is
  'Family-visible schedule: full content for visibility=family events (including their '
  'primary participant, e.g. which child), sanitized (owner/start/end only — "Busy") for '
  'private ones. Excludes soft-deleted events (Phase 7). Authorization lives entirely in '
  'this view''s WHERE clause — not security_invoker, see the Phase 2 migration''s header '
  'comment for why.';

revoke all on public.family_schedule from anon, authenticated;
grant select on public.family_schedule to authenticated;

-- ---------------------------------------------------------------------------
-- family_responsibilities: the drop-off/pick-up read model. Never needs
-- title/description sanitization — a responsibility can only exist on a
-- visibility='family' event (assert_responsibility_event_is_family_visible
-- above), so its parent event's content is already fully visible to every
-- family member by the time a responsibility exists for it at all.
-- ---------------------------------------------------------------------------
create view public.family_responsibilities as
select
  r.id,
  r.event_id,
  r.family_id,
  r.type,
  r.label,
  r.assignee_member_id,
  r.status,
  e.starts_at as event_starts_at,
  e.ends_at as event_ends_at,
  e.title as event_title,
  -- drop_off is due at the event's start, pick_up at its end — derived, '
  -- never stored, so it can never drift when the event's own time changes
  -- (see docs/DECISIONS.md, "Phase 7").
  case r.type when 'drop_off' then e.starts_at else e.ends_at end as due_at
from public.responsibilities r
join public.events e on e.id = r.event_id
where
  e.deleted_at is null
  and r.family_id in (
    select fm.family_id from public.family_members fm
    where fm.profile_id = auth.uid() and fm.removed_at is null
  );

comment on view public.family_responsibilities is
  'Family-visible drop-off/pick-up (and supervise/custom) responsibilities, joined with '
  'their parent event''s always-visible fields (see this view''s own header comment for why '
  'no sanitization is needed here). due_at is derived from the event''s own starts_at/ends_at '
  '— never a stored, driftable copy.';

revoke all on public.family_responsibilities from anon, authenticated;
grant select on public.family_responsibilities to authenticated;

-- ---------------------------------------------------------------------------
-- create_personal_event / create_family_event / create_child_event
-- ---------------------------------------------------------------------------
create function public.create_personal_event(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_description text default null,
  p_location text default null,
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
  v_event_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_visibility not in ('private', 'family') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if p_visibility = 'family' and p_family_id is null then
    raise exception 'a family-visible event requires a family' using errcode = '22023';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'ends_at must be after starts_at' using errcode = '22023';
  end if;

  insert into public.events (
    owner_profile_id, family_id, title, description, location,
    starts_at, ends_at, timezone, visibility, created_by
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_location,
    p_starts_at, p_ends_at, p_timezone, p_visibility, v_profile_id
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.create_personal_event(text, timestamptz, timestamptz, text, text, text, text, uuid) is
  'A single adult''s own event. Defaults to Private — becoming Family-visible requires '
  'p_family_id (the caller''s own membership is revalidated, never trusted from the client).';

revoke all on function public.create_personal_event(text, timestamptz, timestamptz, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_personal_event(text, timestamptz, timestamptz, text, text, text, text, uuid) to authenticated;

create function public.create_family_event(
  p_family_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_description text default null,
  p_location text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_event_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'ends_at must be after starts_at' using errcode = '22023';
  end if;

  insert into public.events (
    owner_profile_id, family_id, title, description, location,
    starts_at, ends_at, timezone, visibility, created_by
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_location,
    p_starts_at, p_ends_at, p_timezone, 'family', v_profile_id
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.create_family_event(uuid, text, timestamptz, timestamptz, text, text, text) is
  'Always visibility=family. The creator remains owner_profile_id (see docs/DECISIONS.md, '
  '"Phase 7" for why ownership transfer / co-ownership is out of scope this phase).';

revoke all on function public.create_family_event(uuid, text, timestamptz, timestamptz, text, text, text) from public, anon;
grant execute on function public.create_family_event(uuid, text, timestamptz, timestamptz, text, text, text) to authenticated;

create function public.create_child_event(
  p_family_id uuid,
  p_child_member_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_description text default null,
  p_location text default null,
  p_drop_off_assignee_member_id uuid default null,
  p_pick_up_assignee_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_creator_member_id uuid;
  v_child_type text;
  v_event_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_creator_member_id := public.current_member_id(p_family_id);
  if v_creator_member_id is null then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  select member_type into v_child_type
  from public.family_members
  where id = p_child_member_id and family_id = p_family_id and removed_at is null;

  if v_child_type is null then
    raise exception 'child is not a current member of this family' using errcode = '42501';
  end if;
  if v_child_type <> 'child' then
    raise exception 'p_child_member_id must be a child profile — use create_family_event for an adult-concerning event' using errcode = '22023';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'ends_at must be after starts_at' using errcode = '22023';
  end if;

  insert into public.events (
    owner_profile_id, family_id, title, description, location,
    starts_at, ends_at, timezone, visibility, created_by
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_location,
    p_starts_at, p_ends_at, p_timezone, 'family', v_profile_id
  )
  returning id into v_event_id;

  insert into public.event_participants (event_id, family_member_id)
  values (v_event_id, p_child_member_id);

  if p_drop_off_assignee_member_id is not null then
    perform public.set_responsibility_assignment(
      public.create_bare_responsibility(v_event_id, 'drop_off', null),
      p_drop_off_assignee_member_id,
      'assigned'
    );
  end if;

  if p_pick_up_assignee_member_id is not null then
    perform public.set_responsibility_assignment(
      public.create_bare_responsibility(v_event_id, 'pick_up', null),
      p_pick_up_assignee_member_id,
      'assigned'
    );
  end if;

  return v_event_id;
end;
$$;

comment on function public.create_child_event(uuid, uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid) is
  'Always visibility=family. Creates exactly one event_participants row (the child) — MVP '
  'optimizes for one primary subject; the schema (event_participants is a proper many-to-many '
  'table) does not prevent adding more participants later. Optional drop_off/pick_up '
  'assignees are created atomically via the same self-assign-is-immediate-acceptance shortcut '
  'as create_shared_family_task.';

revoke all on function public.create_child_event(uuid, uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_child_event(uuid, uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_event / cancel_event
-- ---------------------------------------------------------------------------
create function public.update_event(
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
  v_family_id uuid;
  v_has_responsibility boolean;
begin
  select owner_profile_id, starts_at, ends_at, family_id
    into v_owner, v_starts_at, v_ends_at, v_family_id
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
  'update needed and no drift is possible.';

revoke all on function public.update_event(uuid, text, text, boolean, text, boolean, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.update_event(uuid, text, text, boolean, text, boolean, timestamptz, timestamptz, text, text) to authenticated;

create function public.cancel_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_profile_id into v_owner
  from public.events
  where id = p_event_id and deleted_at is null;

  if v_owner is null then
    -- Idempotent: already-cancelled (or never-existed-for-this-caller) is a
    -- safe no-op, same convention as delete_or_archive_personal_task.
    return;
  end if;

  if v_owner <> auth.uid() then
    raise exception 'only the event owner may cancel it' using errcode = '42501';
  end if;

  update public.events set deleted_at = now() where id = p_event_id;
end;
$$;

comment on function public.cancel_event(uuid) is
  'Owner-only soft delete, idempotent. No restore RPC this phase — same convention as '
  'delete_or_archive_personal_task (Phase 4).';

revoke all on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_bare_responsibility — internal only, zero grants (mirrors
-- set_task_assignment's "never granted directly" pattern). Inserts an
-- unassigned responsibility row and returns its id, for
-- set_responsibility_assignment (below) to then assign atomically.
-- ---------------------------------------------------------------------------
create function public.create_bare_responsibility(
  p_event_id uuid,
  p_type text,
  p_label text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_responsibility_id uuid;
begin
  insert into public.responsibilities (event_id, type, label, created_by)
  values (p_event_id, p_type, p_label, auth.uid())
  returning id into v_responsibility_id;

  return v_responsibility_id;
end;
$$;

revoke all on function public.create_bare_responsibility(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_responsibility_assignment: shared internal logic for assign/reassign,
-- mirrors set_task_assignment exactly — never granted to any role.
-- ---------------------------------------------------------------------------
create function public.set_responsibility_assignment(
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
  v_event_id uuid;
  v_event_owner_profile_id uuid;
  v_status text;
  v_assignee_type text;
  v_creator_member_id uuid;
begin
  select r.family_id, r.event_id, r.status, e.owner_profile_id
    into v_family_id, v_event_id, v_status, v_event_owner_profile_id
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
  'shortcut.';

revoke all on function public.set_responsibility_assignment(uuid, uuid, text) from public, anon, authenticated;

create function public.assign_event_responsibility(p_responsibility_id uuid, p_assignee_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.set_responsibility_assignment(p_responsibility_id, p_assignee_member_id, 'assigned');
end;
$$;

revoke all on function public.assign_event_responsibility(uuid, uuid) from public, anon;
grant execute on function public.assign_event_responsibility(uuid, uuid) to authenticated;

create function public.reassign_event_responsibility(p_responsibility_id uuid, p_assignee_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.set_responsibility_assignment(p_responsibility_id, p_assignee_member_id, 'reassigned');
end;
$$;

revoke all on function public.reassign_event_responsibility(uuid, uuid) from public, anon;
grant execute on function public.reassign_event_responsibility(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- take_event_responsibility — concurrency-sensitive, mirrors
-- take_family_task exactly.
-- ---------------------------------------------------------------------------
create function public.take_event_responsibility(p_responsibility_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select r.family_id, r.status
    into v_family_id, v_status
  from public.responsibilities r
  where r.id = p_responsibility_id
  for update of r;

  if v_family_id is null then
    raise exception 'no such responsibility' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_status <> 'unassigned' then
    raise exception 'responsibility has already been taken' using errcode = '40001';
  end if;

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_responsibility_id, v_member_id, null, 'took');
end;
$$;

comment on function public.take_event_responsibility(uuid) is
  'Self-claim of an unassigned responsibility. SELECT ... FOR UPDATE on the responsibility '
  'row is what makes concurrent Take attempts safe — same pattern as take_family_task.';

revoke all on function public.take_event_responsibility(uuid) from public, anon;
grant execute on function public.take_event_responsibility(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_event_responsibility / decline_event_responsibility
-- ---------------------------------------------------------------------------
create function public.accept_event_responsibility(p_responsibility_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_current_assignee uuid;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select r.family_id, r.status, r.assignee_member_id
    into v_family_id, v_status, v_current_assignee
  from public.responsibilities r
  where r.id = p_responsibility_id
  for update of r;

  if v_family_id is null then
    raise exception 'no such responsibility' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_status <> 'pending_acceptance' or v_current_assignee <> v_member_id then
    raise exception 'this assignment is no longer valid for you' using errcode = '40001';
  end if;

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_responsibility_id, v_member_id, null, 'accepted');
end;
$$;

revoke all on function public.accept_event_responsibility(uuid) from public, anon;
grant execute on function public.accept_event_responsibility(uuid) to authenticated;

create function public.decline_event_responsibility(p_responsibility_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_family_id uuid;
  v_status text;
  v_current_assignee uuid;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select r.family_id, r.status, r.assignee_member_id
    into v_family_id, v_status, v_current_assignee
  from public.responsibilities r
  where r.id = p_responsibility_id
  for update of r;

  if v_family_id is null then
    raise exception 'no such responsibility' using errcode = '42501';
  end if;

  v_member_id := public.current_member_id(v_family_id);
  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_status <> 'pending_acceptance' or v_current_assignee <> v_member_id then
    raise exception 'this assignment is no longer valid for you' using errcode = '40001';
  end if;

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  values (p_responsibility_id, v_member_id, null, 'declined');
end;
$$;

comment on function public.decline_event_responsibility(uuid) is
  'Declining always resolves to Unassigned (apply_responsibility_assignment_action''s '
  '''declined'' -> assignee_member_id null / status unassigned mapping) — the ''declined'' '
  'responsibility_assignments row is the permanent record that this happened.';

revoke all on function public.decline_event_responsibility(uuid) from public, anon;
grant execute on function public.decline_event_responsibility(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_event_responsibility — deletes the requirement itself (not just
-- unassigns it). Only when unassigned or declined, so an active pending/
-- accepted commitment can't be silently erased out from under its assignee
-- — unassign first, same "can't skip a state" shape as
-- reassign_family_task requiring restore before reassigning a completed
-- task.
-- ---------------------------------------------------------------------------
create function public.remove_event_responsibility(p_responsibility_id uuid)
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
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select r.family_id, r.status, e.owner_profile_id
    into v_family_id, v_status, v_event_owner_profile_id
  from public.responsibilities r
  join public.events e on e.id = r.event_id
  where r.id = p_responsibility_id
  for update of r;

  if v_family_id is null then
    -- Idempotent: already removed is a safe no-op.
    return;
  end if;

  if v_event_owner_profile_id <> v_profile_id and not public.is_family_owner(v_family_id) then
    raise exception 'only the event owner or family owner may remove this responsibility' using errcode = '42501';
  end if;

  if v_status not in ('unassigned', 'declined') then
    raise exception 'cannot remove an active responsibility — unassign it first' using errcode = '22023';
  end if;

  delete from public.responsibilities where id = p_responsibility_id;
end;
$$;

revoke all on function public.remove_event_responsibility(uuid) from public, anon;
grant execute on function public.remove_event_responsibility(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_family_member: extended to also resolve responsibility_assignments
-- — the same class of gap Phase 5 fixed for task_assignments (a removed
-- member must never stay pointing at a responsibility they can no longer
-- see either).
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

  v_acting_member_id := public.current_member_id(v_family_id);

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  select t.id, t.assignee_member_id, v_acting_member_id, 'unassigned'
  from public.tasks t
  where t.family_id = v_family_id
    and t.assignee_member_id = p_member_id
    and t.assignment_status in ('pending_acceptance', 'accepted')
    and t.deleted_at is null
  for update of t;

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  select r.id, r.assignee_member_id, v_acting_member_id, 'unassigned'
  from public.responsibilities r
  join public.events e on e.id = r.event_id
  where r.family_id = v_family_id
    and r.assignee_member_id = p_member_id
    and r.status in ('pending_acceptance', 'accepted')
    and e.deleted_at is null
  for update of r;

  -- Soft delete: the row survives for the audit trails above.
  update public.family_members set removed_at = now() where id = p_member_id;
end;
$$;

comment on function public.remove_family_member(uuid) is
  'Owner-only, refuses to ever remove the owner row, soft-deletes (removed_at). Every task '
  'AND every event responsibility currently assigned to the removed member is atomically '
  'unassigned first (Phase 7 extended this to responsibilities — previously task-only), so '
  'nothing is left pointing at an inaccessible member.';

-- ---------------------------------------------------------------------------
-- has_member_schedule_conflict — read-only, deterministic, privacy-safe
-- conflict check. Returns a boolean only (never a title/description of
-- whatever it conflicted with) — see docs/SECURITY_AND_PRIVACY.md, Mechanism
-- 4b. Half-open interval semantics throughout: [starts_at, ends_at) — an
-- item ending exactly when the checked range begins (or vice versa) is not
-- a conflict.
-- ---------------------------------------------------------------------------
create function public.has_member_schedule_conflict(
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

  -- A child member (profile_id null) is never a responsibility assignee —
  -- no conflict surface applies to them.
  if v_member_profile_id is null then
    return false;
  end if;

  select exists (
    -- The member's own events (private or family — either way, it's real
    -- time on their calendar).
    select 1 from public.events e
    where e.owner_profile_id = v_member_profile_id
      and e.deleted_at is null
      and e.starts_at < p_ends_at
      and e.ends_at > p_starts_at

    union all

    -- A timed family task assigned to them.
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

    -- Another accepted responsibility for the same member (excluding the
    -- one being checked, so editing an existing responsibility's own time
    -- doesn't flag itself).
    select 1 from public.responsibilities r
    join public.events e on e.id = r.event_id
    where r.assignee_member_id = p_member_id
      and r.status = 'accepted'
      and (p_exclude_responsibility_id is null or r.id <> p_exclude_responsibility_id)
      and e.deleted_at is null
      and e.starts_at < p_ends_at
      and e.ends_at > p_starts_at
  ) into v_conflict;

  return v_conflict;
end;
$$;

comment on function public.has_member_schedule_conflict(uuid, timestamptz, timestamptz, uuid) is
  'Deterministic, privacy-safe: returns only a boolean, never which event/task it '
  'conflicted with or any of its content. Caller must be a member of the same family as '
  'p_member_id. Half-open interval overlap ([starts_at, ends_at)) throughout — a boundary '
  'touch (one item ending exactly when another begins) is not a conflict.';

revoke all on function public.has_member_schedule_conflict(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.has_member_schedule_conflict(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notification outbox: extended for event-responsibility events, not a
-- second notification system — per the Phase 7 brief's own instruction.
-- notifications.outbox.task_id/task_assignment_id become nullable, with a
-- new event_id/responsibility_id pair alongside them; exactly one of the
-- two pairs is set, enforced by a CHECK keyed off event_type's own prefix
-- rather than trusting the writer to get it right.
-- ---------------------------------------------------------------------------
alter table notifications.outbox
  alter column task_id drop not null,
  add column event_id uuid references public.events (id) on delete cascade,
  add column responsibility_id uuid references public.responsibilities (id) on delete set null;

alter table notifications.outbox
  drop constraint outbox_event_type_check,
  add constraint outbox_event_type_check check (event_type in (
    'family_task.assignment_requested.v1',
    'family_task.assignment_accepted.v1',
    'family_task.assignment_declined.v1',
    'family_task.assignment_taken.v1',
    'event_responsibility.assignment_requested.v1',
    'event_responsibility.assignment_accepted.v1',
    'event_responsibility.assignment_declined.v1',
    'event_responsibility.assignment_taken.v1'
  )),
  add constraint outbox_exactly_one_source check (
    (task_id is not null and event_id is null)
    or (task_id is null and event_id is not null)
  );

comment on column notifications.outbox.event_id is
  'Set only for event_responsibility.* rows (Phase 7) — mutually exclusive with task_id, '
  'enforced by outbox_exactly_one_source. Points at the event, not the responsibility, '
  'since the notification-tap destination is the event detail screen (see '
  'src/lib/notifications/notificationResponseRouter.ts) — the same "navigate to where the '
  'recipient already has real, RLS-checked access" design as taskId.';

create index outbox_event_id_idx on notifications.outbox (event_id) where event_id is not null;

-- ---------------------------------------------------------------------------
-- enqueue_event_responsibility_notification: mirrors
-- enqueue_task_assignment_notification exactly (same recipient-derivation
-- discipline, same silent-skip-never-raise contract) — fires for every
-- responsibility_assignments insert, alongside the pre-existing
-- apply_responsibility_assignment_action trigger.
-- ---------------------------------------------------------------------------
create function notifications.enqueue_event_responsibility_notification()
returns trigger
language plpgsql
security definer
set search_path = public, notifications
as $$
declare
  v_event_type text;
  v_actor_member_id uuid;
  v_recipient_member_id uuid;
  v_recipient_profile_id uuid;
  v_recipient_removed_at timestamptz;
  v_event_id uuid;
  v_idempotency_key text;
begin
  select r.event_id into v_event_id
  from public.responsibilities r
  where r.id = new.responsibility_id;

  if new.action = 'assigned' or new.action = 'reassigned' then
    v_event_type := 'event_responsibility.assignment_requested.v1';
    v_actor_member_id := new.assigned_by_member_id;
    v_recipient_member_id := new.assigned_to_member_id;
  elsif new.action = 'took' then
    v_event_type := 'event_responsibility.assignment_taken.v1';
    v_actor_member_id := new.assigned_to_member_id;
    -- Recipient is the event's creator, resolved to their family_members
    -- row in this family — mirrors the task 'took' case exactly.
    select fm.id into v_recipient_member_id
    from public.events e
    join public.family_members fm
      on fm.family_id = e.family_id
     and fm.profile_id = e.owner_profile_id
     and fm.removed_at is null
    where e.id = v_event_id;
  elsif new.action = 'accepted' or new.action = 'declined' then
    v_event_type := case new.action
      when 'accepted' then 'event_responsibility.assignment_accepted.v1'
      when 'declined' then 'event_responsibility.assignment_declined.v1'
    end;
    v_actor_member_id := new.assigned_to_member_id;
    select ra.assigned_by_member_id into v_recipient_member_id
    from public.responsibility_assignments ra
    where ra.responsibility_id = new.responsibility_id
      and ra.action in ('assigned', 'reassigned')
      and ra.id <> new.id
    order by ra.created_at desc, ra.id desc
    limit 1;
  else
    return new;
  end if;

  if v_recipient_member_id is null or v_recipient_member_id = v_actor_member_id then
    return new;
  end if;

  select fm.profile_id, fm.removed_at
    into v_recipient_profile_id, v_recipient_removed_at
  from public.family_members fm
  where fm.id = v_recipient_member_id;

  if v_recipient_profile_id is null or v_recipient_removed_at is not null then
    return new;
  end if;

  if not public.notification_preference_enabled(v_recipient_profile_id) then
    return new;
  end if;

  v_idempotency_key := 'responsibility_assignment:' || new.id::text;

  insert into notifications.outbox (
    idempotency_key, event_type, family_id, event_id, responsibility_id,
    actor_member_id, recipient_member_id, payload
  )
  values (
    v_idempotency_key,
    v_event_type,
    new.family_id,
    v_event_id,
    new.responsibility_id,
    v_actor_member_id,
    v_recipient_member_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'eventType', v_event_type,
      'familyId', new.family_id,
      'eventId', v_event_id
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

comment on function notifications.enqueue_event_responsibility_notification() is
  'Derives event_type/actor/recipient entirely from authoritative database state — never '
  'from anything the client submitted — and enqueues at most one notifications.outbox row '
  'per responsibility_assignments row, in the same transaction. Skips silently (never '
  'raises) for self-actions, removed recipients, and disabled preferences — mirrors '
  'enqueue_task_assignment_notification (Phase 6) exactly.';

revoke all on function notifications.enqueue_event_responsibility_notification() from public, anon, authenticated;

create trigger responsibility_assignments_enqueue_notification
  after insert on public.responsibility_assignments
  for each row
  execute function notifications.enqueue_event_responsibility_notification();
