-- Phase 9: Secure Realtime Sync, Offline Resilience, and Conflict Center.
--
-- Three independent additions in one migration (kept together because all
-- three build on the same "generic invalidation, refetch through RLS"
-- principle — see docs/DECISIONS.md, "Phase 9"):
--
-- 1. Realtime Broadcast Authorization: private `profile:<uuid>`/
--    `family:<uuid>` topics on `realtime.messages`, RLS-gated, carrying
--    only a generic {version, scope, entity, operation} payload — never a
--    row. Database trigger functions emit these after committed domain
--    mutations on the tables Section 4 of the brief lists, coalesced per
--    the documented decisions below (never a separate trigger for a table
--    whose every write is already transactionally coupled to a table that
--    already has one).
-- 2. Offline-queue idempotency support: `tasks.client_operation_id` for
--    idempotent create-replay, and an optional expected-`updated_at`
--    precondition on `update_personal_task`/`schedule_personal_task` for
--    stale-write detection — see docs/DECISIONS.md, "Phase 9," for why no
--    new operations-log table was needed (the queue itself is client-side
--    persisted state; only the *idempotency guarantee* needs server
--    support, and existing complete/restore/archive RPCs were already
--    idempotent).
-- 3. `list_family_conflicts`: a new, privacy-safe, deterministically
--    computed (never stored) read model over the same sources
--    `has_member_schedule_conflict` (Phase 7/8) already checks, expanded
--    to the 8 conflict categories Section 13 requires and returning
--    structured, sanitized records instead of a bare boolean.

-- =============================================================================
-- 1. Realtime Broadcast Authorization
-- =============================================================================

-- Returns NULL instead of raising on an invalid UUID literal — used so a
-- malformed topic (`family:not-a-uuid`) fails the RLS predicate closed
-- (the comparison against a NULL never matches) instead of raising a
-- runtime error that could otherwise surface as a 500 to a client probing
-- topics.
create or replace function public.try_cast_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;
revoke all on function public.try_cast_uuid(text) from public, anon, authenticated;
grant execute on function public.try_cast_uuid(text) to authenticated;
comment on function public.try_cast_uuid(text) is
  'Safe text->uuid cast for use inside RLS predicates on realtime.messages — returns null '
  '(never raises) on a malformed topic segment, so an invalid topic fails the policy closed '
  'rather than erroring. See docs/DECISIONS.md, "Phase 9."';

-- realtime.messages already ships with RLS enabled and zero policies (a
-- default-deny starting point for every role except the ones the realtime
-- extension itself uses internally to insert). These two policies are the
-- *only* access authenticated users get, and both are SELECT-only —
-- clients never get INSERT/send on this table; every broadcast goes
-- through `public.emit_invalidation()` below, called only from
-- SECURITY DEFINER trigger functions.
drop policy if exists "own_profile_topic_select" on realtime.messages;
create policy "own_profile_topic_select"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'profile:%'
  and public.try_cast_uuid(split_part(realtime.topic(), ':', 2)) is not null
  and public.try_cast_uuid(split_part(realtime.topic(), ':', 2)) = auth.uid()
);

drop policy if exists "active_family_topic_select" on realtime.messages;
create policy "active_family_topic_select"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'family:%'
  and public.try_cast_uuid(split_part(realtime.topic(), ':', 2)) is not null
  and public.is_family_member(public.try_cast_uuid(split_part(realtime.topic(), ':', 2)))
);

comment on policy "own_profile_topic_select" on realtime.messages is
  'A profile:<uuid> topic is readable only by that exact profile — split_part avoids casting '
  'an attacker-controlled topic string directly, try_cast_uuid makes a malformed uuid segment '
  'fail closed instead of raising. Phase 9.';
comment on policy "active_family_topic_select" on realtime.messages is
  'A family:<uuid> topic is readable only by a current (removed_at is null) member of that '
  'family, via the same is_family_member() helper every other family-scoped RLS policy in '
  'this codebase uses — a member removed after subscribing loses read access to *future* '
  'inserts the instant their next SELECT is evaluated; Realtime may still hold their socket '
  'briefly (see docs/SECURITY_AND_PRIVACY.md, "Mechanism 6", for why payload content-freeness '
  'is what actually closes this window, not subscription teardown timing). Phase 9.';

-- No INSERT/UPDATE/DELETE grant to authenticated/anon anywhere in this
-- migration — confirmed absent by 130_security_regression_test.sql's own
-- schema-driven sweep (extended below to cover realtime.messages) and by
-- 150_realtime_test.sql's explicit assertion.

-- The one and only place a broadcast is ever sent from. Swallows its own
-- failure (see the `exception when others` block) so a Realtime outage
-- can never roll back the domain mutation that triggered it — Section 4's
-- explicit requirement ("Domain writes must not become fragile because
-- Realtime is temporarily unavailable"). `private = true` is realtime.send's
-- own third positional default already, passed explicitly here for
-- clarity since it's the entire reason these topics are unreadable to
-- anyone without a matching RLS policy above.
create or replace function public.emit_invalidation(p_topic text, p_entity text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'version', 1,
      'scope', split_part(p_topic, ':', 1),
      'entity', p_entity,
      'operation', 'changed'
    ),
    'invalidate',
    p_topic,
    true
  );
exception when others then
  raise warning 'emit_invalidation failed for topic % (entity %): %', p_topic, p_entity, sqlerrm;
end;
$$;
revoke all on function public.emit_invalidation(text, text) from public, anon, authenticated;
comment on function public.emit_invalidation(text, text) is
  'The only caller of realtime.send in this codebase. Payload is always the generic '
  '{version, scope, entity, operation} shape — never row content (see docs/SECURITY_AND_PRIVACY.md, '
  '"Mechanism 6"). Never raises: a Realtime failure must never roll back the domain mutation '
  'whose trigger called this. Phase 9.';

-- ---------------------------------------------------------------------------
-- Trigger functions, one per table Section 4 requires *direct* coverage
-- for. Coalescing decisions (documented once here, not per-table):
--
-- - `task_assignments` gets no trigger of its own: every insert into it
--   happens inside the same transaction as the `tasks` row UPDATE that
--   changes `assignee_member_id`/`assignment_status` (see
--   apply_task_assignment_action, Phase 5) — the tasks-table broadcast
--   below already covers it, and a second broadcast for the same logical
--   mutation would be exactly the "duplicate broadcast storm" Section 4
--   warns against.
-- - `responsibility_assignments` gets no trigger for the identical reason,
--   relative to `responsibilities`.
-- - `event_participants` gets no trigger: every row is inserted inside
--   `create_family_event`/child-event creation, in the same transaction
--   as the `events` INSERT — the events-table broadcast covers it. No
--   RPC in this codebase mutates `event_participants` on its own.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_family uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_profile_id;
    v_family := old.family_id;
  else
    v_owner := new.owner_profile_id;
    v_family := new.family_id;
  end if;

  perform public.emit_invalidation('profile:' || v_owner, 'tasks');
  if v_family is not null then
    perform public.emit_invalidation('family:' || v_family, 'tasks');
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_task_change() from public, anon, authenticated;

drop trigger if exists broadcast_task_change_trigger on public.tasks;
create trigger broadcast_task_change_trigger
after insert or update or delete on public.tasks
for each row execute function public.broadcast_task_change();

create or replace function public.broadcast_task_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  v_owner := coalesce(new.owner_profile_id, old.owner_profile_id);
  perform public.emit_invalidation('profile:' || v_owner, 'recurrence');
  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_task_occurrence_change() from public, anon, authenticated;

drop trigger if exists broadcast_task_occurrence_change_trigger on public.task_occurrences;
create trigger broadcast_task_occurrence_change_trigger
after insert or update or delete on public.task_occurrences
for each row execute function public.broadcast_task_occurrence_change();

create or replace function public.broadcast_reminder_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  v_profile := coalesce(new.profile_id, old.profile_id);
  perform public.emit_invalidation('profile:' || v_profile, 'reminders');
  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_reminder_change() from public, anon, authenticated;

drop trigger if exists broadcast_reminder_change_trigger on public.reminders;
create trigger broadcast_reminder_change_trigger
after insert or update or delete on public.reminders
for each row execute function public.broadcast_reminder_change();

create or replace function public.broadcast_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_family uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_profile_id;
    v_family := old.family_id;
  else
    v_owner := new.owner_profile_id;
    v_family := new.family_id;
  end if;

  perform public.emit_invalidation('profile:' || v_owner, 'events');
  if v_family is not null then
    perform public.emit_invalidation('family:' || v_family, 'events');
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_event_change() from public, anon, authenticated;

drop trigger if exists broadcast_event_change_trigger on public.events;
create trigger broadcast_event_change_trigger
after insert or update or delete on public.events
for each row execute function public.broadcast_event_change();

create or replace function public.broadcast_responsibility_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
begin
  v_family := coalesce(new.family_id, old.family_id);
  perform public.emit_invalidation('family:' || v_family, 'responsibilities');
  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_responsibility_change() from public, anon, authenticated;

drop trigger if exists broadcast_responsibility_change_trigger on public.responsibilities;
create trigger broadcast_responsibility_change_trigger
after insert or update or delete on public.responsibilities
for each row execute function public.broadcast_responsibility_change();

create or replace function public.broadcast_family_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_profile uuid;
begin
  v_family := coalesce(new.family_id, old.family_id);
  v_profile := coalesce(new.profile_id, old.profile_id);

  perform public.emit_invalidation('family:' || v_family, 'members');
  -- Also tell the member's own other devices — relevant when their own
  -- role/removal status changes, so their client's own family list
  -- refreshes rather than staying stale until the next unrelated refetch.
  if v_profile is not null then
    perform public.emit_invalidation('profile:' || v_profile, 'members');
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_family_member_change() from public, anon, authenticated;

drop trigger if exists broadcast_family_member_change_trigger on public.family_members;
create trigger broadcast_family_member_change_trigger
after insert or update or delete on public.family_members
for each row execute function public.broadcast_family_member_change();

create or replace function public.broadcast_category_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
begin
  v_family := coalesce(new.family_id, old.family_id);
  -- System categories (family_id null) are seed data, never mutated by
  -- any RPC — nothing to broadcast for them.
  if v_family is not null then
    perform public.emit_invalidation('family:' || v_family, 'categories');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_category_change() from public, anon, authenticated;

drop trigger if exists broadcast_category_change_trigger on public.categories;
create trigger broadcast_category_change_trigger
after insert or update or delete on public.categories
for each row execute function public.broadcast_category_change();

-- =============================================================================
-- 2. Offline-queue idempotency support
-- =============================================================================

-- Idempotent create-replay: a client-generated id lets a retried "create
-- Inbox task" operation (network dropped after the server committed but
-- before the client saw the response) return the *original* task instead
-- of creating a duplicate. Nullable + a partial unique index (most rows —
-- every online create — never set this at all).
alter table public.tasks add column if not exists client_operation_id uuid;
create unique index if not exists tasks_owner_client_operation_id_uniq
  on public.tasks (owner_profile_id, client_operation_id)
  where client_operation_id is not null;
comment on column public.tasks.client_operation_id is
  'Client-generated idempotency key for the offline task-creation queue (Phase 9) — null for '
  'every task created online. Never exposed to another profile (the unique index is scoped '
  'per owner_profile_id, and RLS already prevents reading another profile''s own tasks by id '
  'this column could collide with).';

-- Adding a parameter changes a function's argument-type identity in
-- Postgres — CREATE OR REPLACE with a different parameter list creates an
-- *additional* overload rather than replacing the original, silently
-- leaving both the old 10-arg and new 11-arg versions callable side by
-- side. Explicit drops of the exact prior signatures below avoid that for
-- all three functions this migration extends.
drop function if exists public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid);

create or replace function public.create_personal_task(
  p_title text,
  p_description text default null,
  p_date date default null,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null,
  p_priority text default 'normal',
  p_category_id uuid default null,
  p_visibility text default 'private',
  p_family_id uuid default null,
  p_client_operation_id uuid default null
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

  if p_client_operation_id is not null then
    select id into v_task_id
    from public.tasks
    where owner_profile_id = v_profile_id and client_operation_id = p_client_operation_id;

    if v_task_id is not null then
      -- Replay of an already-applied offline create — return the
      -- original id, never a second row (Section 10's "duplicate
      -- delivery does not create duplicate tasks").
      return v_task_id;
    end if;
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  insert into public.tasks (
    owner_profile_id, family_id, title, description, date, start_time, duration_minutes,
    timezone, priority, category_id, visibility, created_by, client_operation_id
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_date, p_start_time, p_duration_minutes,
    p_timezone, coalesce(p_priority, 'normal'), p_category_id, coalesce(p_visibility, 'private'),
    v_profile_id, p_client_operation_id
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;
comment on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid, uuid) is
  'p_client_operation_id (Phase 9) makes a replayed offline-queue create idempotent: a second '
  'call with the same (caller, client_operation_id) returns the original task id instead of '
  'inserting a duplicate row. Omit it (the default) for every online create.';
revoke all on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid, uuid) to authenticated;

-- Stale-write detection: an optional expected-updated_at precondition.
-- errcode '40001' (serialization_failure) is a real, standard Postgres
-- code already meaning "another transaction changed what you were
-- reading, retry" — reused here deliberately rather than inventing a
-- bespoke code, so client error handling can treat this class of
-- conflict uniformly. See docs/DECISIONS.md, "Phase 9," for the full
-- stale-write policy (never silently last-write-wins).
drop function if exists public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid);

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
    raise exception 'no such task' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated_at then
    raise exception 'task changed on another device since the offline snapshot was taken'
      using errcode = '40001', hint = 'stale_write';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  -- Preserved from Phase 5 (docs/DECISIONS.md) — an actively assigned
  -- shared task can't silently become Private or hop to another family
  -- out from under its assignee.
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
  'p_expected_updated_at (Phase 9): when provided and it no longer matches the row''s current '
  'updated_at, raises 40001 (serialization_failure) instead of overwriting — the offline-queue '
  'stale-write guard. Omit it (the default) for every online edit, which always applies '
  'unconditionally as before.';
revoke all on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid, timestamptz) from public, anon;
grant execute on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid, timestamptz) to authenticated;

drop function if exists public.schedule_personal_task(uuid, date, time, integer, text);

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
    raise exception 'no such task' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated_at then
    raise exception 'task changed on another device since the offline snapshot was taken'
      using errcode = '40001', hint = 'stale_write';
  end if;

  -- Preserved from Phase 8 (docs/DECISIONS.md) — a recurring series'
  -- schedule is edited through update_recurring_series, never here.
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
  'p_expected_updated_at (Phase 9): same stale-write guard as update_personal_task, applied to '
  'reschedule — an offline "move to tomorrow" replayed against a task whose time already '
  'changed elsewhere raises 40001 instead of clobbering the newer schedule.';
revoke all on function public.schedule_personal_task(uuid, date, time, integer, text, timestamptz) from public, anon;
grant execute on function public.schedule_personal_task(uuid, date, time, integer, text, timestamptz) to authenticated;

-- =============================================================================
-- 3. Conflict Center read model
-- =============================================================================

-- Deterministically computed on every call, never stored (Section 14: "Prefer
-- deterministic computation over stale stored conflict state") — the same
-- design choice Phase 7's has_member_schedule_conflict() already made, now
-- extended from "does this candidate range conflict, yes/no" to "list every
-- current conflict in this family, structured and sanitized."
--
-- Privacy rule applied uniformly: an entity reference (primary/secondary
-- type+id) is only ever returned when navigating to it is safe — i.e. the
-- caller owns it, or it isn't privately-visibility-scoped. A conflict whose
-- only entity on one side is another member's *private* item still reports
-- that a conflict exists (with a generic safe_message_code) but nulls that
-- side's entity id, so the client can never construct a link into someone
-- else's private event/task (Section 15's explicit requirement). conflict_id
-- is derived from the real underlying ids before that redaction, so it stays
-- stable/dedupable even when the id it was derived from is hidden in the
-- output.
create or replace function public.list_family_conflicts(
  p_family_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  conflict_id uuid,
  family_id uuid,
  conflict_date date,
  type text,
  severity text,
  member_id uuid,
  primary_entity_type text,
  primary_entity_id uuid,
  secondary_entity_type text,
  secondary_entity_id uuid,
  safe_message_code text,
  safe_message_params jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  return query
  with caller as (
    select auth.uid() as profile_id
  ),
  -- Every family member's own events (personal or family-visible) in range.
  member_events as (
    select fm.id as member_id, e.id as event_id, e.starts_at, e.ends_at,
           (e.visibility = 'family' or e.owner_profile_id = (select profile_id from caller)) as navigable
    from public.family_members fm
    join public.events e on e.owner_profile_id = fm.profile_id
    where fm.family_id = p_family_id and fm.removed_at is null and fm.profile_id is not null
      and e.deleted_at is null and e.starts_at < p_to and e.ends_at > p_from
  ),
  -- Every family member's own timed task-like items (one-off tasks and
  -- recurring occurrences alike — folds Section 13 item 8 into items 2/3
  -- rather than a separate code path) in range.
  member_timed_items as (
    select fm.id as member_id, t.id as item_id, 'task'::text as item_type,
           (t.date + t.start_time) at time zone t.timezone as starts_at,
           (t.date + t.start_time) at time zone t.timezone
             + make_interval(mins => coalesce(t.duration_minutes, 0)) as ends_at,
           (t.visibility = 'family' or t.owner_profile_id = (select profile_id from caller)) as navigable
    from public.family_members fm
    join public.tasks t
      on t.deleted_at is null
      and t.completed_at is null
      and (t.assignee_member_id = fm.id or t.owner_profile_id = fm.profile_id)
    where fm.family_id = p_family_id and fm.removed_at is null
      -- A recurring series' own template row is represented by its
      -- occurrences (the union branch below), never by itself here — a
      -- real double-count bug found by direct testing before pgTAP was
      -- written (see docs/DECISIONS.md, "Phase 9"): the template row still
      -- carries the anchor date/start_time, so without this exclusion it
      -- was picked up as if it were *also* a plain one-off task.
      and t.recurrence_rule_id is null
      and t.date is not null and t.start_time is not null and t.timezone is not null
      and (t.date + t.start_time) at time zone t.timezone < p_to
      and (t.date + t.start_time) at time zone t.timezone
        + make_interval(mins => coalesce(t.duration_minutes, 0)) > p_from

    union all

    select fm.id as member_id, o.id as item_id, 'occurrence'::text as item_type,
           (o.occurrence_date + o.start_time) at time zone o.timezone as starts_at,
           (o.occurrence_date + o.start_time) at time zone o.timezone
             + make_interval(mins => coalesce(o.duration_minutes, 0)) as ends_at,
           (t2.owner_profile_id = (select profile_id from caller)) as navigable
    from public.family_members fm
    join public.tasks t2 on t2.owner_profile_id = fm.profile_id and t2.deleted_at is null
    join public.task_occurrences o on o.task_id = t2.id and o.status = 'scheduled'
    where fm.family_id = p_family_id and fm.removed_at is null
      and o.start_time is not null and o.timezone is not null
      and (o.occurrence_date + o.start_time) at time zone o.timezone < p_to
      and (o.occurrence_date + o.start_time) at time zone o.timezone
        + make_interval(mins => coalesce(o.duration_minutes, 0)) > p_from
  ),
  member_responsibilities as (
    select r.assignee_member_id as member_id, r.id as resp_id, r.event_id, r.type, r.status,
           e.starts_at, e.ends_at
    from public.responsibilities r
    join public.events e on e.id = r.event_id
    where r.family_id = p_family_id and e.deleted_at is null
      and e.starts_at < p_to and e.ends_at > p_from
  ),
  active_adults as (
    select fm.id as member_id
    from public.family_members fm
    where fm.family_id = p_family_id and fm.removed_at is null and fm.member_type = 'adult'
  ),

  -- Every CTE column below that would otherwise share a name with this
  -- function's own OUT parameters (conflict_id, type, severity, member_id)
  -- is prefixed c_ — plpgsql's own `type`/`severity` etc. OUT-parameter
  -- variables would otherwise shadow the plain column reference inside
  -- these CTEs (a real "column reference is ambiguous" error caught by
  -- direct testing before pgTAP was written — see docs/DECISIONS.md,
  -- "Phase 9"). Only the very last SELECT maps c_-prefixed columns onto
  -- the function's actual declared output names.

  -- 1. Event overlaps another event for the same member.
  c_event_event as (
    select
      md5('event_event:' || a.member_id || ':' || least(a.event_id, b.event_id) || ':'
          || greatest(a.event_id, b.event_id))::uuid as c_id,
      a.member_id as c_member, greatest(a.starts_at, b.starts_at)::date as c_date,
      'event_event'::text as c_type, 'warning'::text as c_sev,
      'event'::text as primary_type, a.event_id as primary_id, a.navigable as primary_navigable,
      'event'::text as secondary_type, b.event_id as secondary_id, b.navigable as secondary_navigable,
      to_char(greatest(a.starts_at, b.starts_at) at time zone 'UTC', 'HH24:MI') as msg_time
    from member_events a
    join member_events b on a.member_id = b.member_id and a.event_id < b.event_id
      and a.starts_at < b.ends_at and a.ends_at > b.starts_at
  ),

  -- 2. Timed task overlaps an event for the same member.
  c_task_event as (
    select
      md5('task_event:' || i.member_id || ':' || i.item_id || ':' || e.event_id)::uuid as c_id,
      i.member_id as c_member, greatest(i.starts_at, e.starts_at)::date as c_date,
      'task_event'::text as c_type, 'warning'::text as c_sev,
      i.item_type as primary_type, i.item_id as primary_id, i.navigable as primary_navigable,
      'event'::text as secondary_type, e.event_id as secondary_id, e.navigable as secondary_navigable,
      to_char(greatest(i.starts_at, e.starts_at) at time zone 'UTC', 'HH24:MI') as msg_time
    from member_timed_items i
    join member_events e on i.member_id = e.member_id
      and i.starts_at < e.ends_at and i.ends_at > e.starts_at
  ),

  -- 3. Timed task overlaps another timed task for the same member
  --    (includes recurring occurrences via member_timed_items — item 8).
  c_task_task as (
    select
      md5('task_task:' || a.member_id || ':' || least(a.item_id, b.item_id) || ':'
          || greatest(a.item_id, b.item_id))::uuid as c_id,
      a.member_id as c_member, greatest(a.starts_at, b.starts_at)::date as c_date,
      'task_task'::text as c_type, 'warning'::text as c_sev,
      a.item_type as primary_type, a.item_id as primary_id, a.navigable as primary_navigable,
      b.item_type as secondary_type, b.item_id as secondary_id, b.navigable as secondary_navigable,
      to_char(greatest(a.starts_at, b.starts_at) at time zone 'UTC', 'HH24:MI') as msg_time
    from member_timed_items a
    join member_timed_items b on a.member_id = b.member_id and a.item_id < b.item_id
      and a.starts_at < b.ends_at and a.ends_at > b.starts_at
  ),

  -- 4. An accepted responsibility occurs while the assignee is otherwise
  --    busy (their own event, their own timed task, or another accepted
  --    responsibility).
  c_responsibility_busy as (
    select
      md5('resp_busy:' || r.member_id || ':' || r.resp_id || ':' || busy.busy_id)::uuid as c_id,
      r.member_id as c_member, greatest(r.starts_at, busy.starts_at)::date as c_date,
      'responsibility_busy'::text as c_type, 'warning'::text as c_sev,
      'responsibility'::text as primary_type, r.resp_id as primary_id, true as primary_navigable,
      busy.busy_type as secondary_type, busy.busy_id as secondary_id, busy.navigable as secondary_navigable,
      to_char(greatest(r.starts_at, busy.starts_at) at time zone 'UTC', 'HH24:MI') as msg_time
    from member_responsibilities r
    join lateral (
      -- Excludes the responsibility's own parent event (r.event_id) — a
      -- responsibility trivially, meaninglessly "overlaps" the event it
      -- was created on, which isn't a real conflict (a real bug found by
      -- direct testing before pgTAP was written — see docs/DECISIONS.md,
      -- "Phase 9").
      select e.event_id as busy_id, 'event'::text as busy_type, e.starts_at, e.ends_at, e.navigable
      from member_events e
      where e.member_id = r.member_id and e.event_id <> r.event_id
        and e.starts_at < r.ends_at and e.ends_at > r.starts_at
      union all
      select i.item_id, i.item_type, i.starts_at, i.ends_at, i.navigable
      from member_timed_items i
      where i.member_id = r.member_id and i.starts_at < r.ends_at and i.ends_at > r.starts_at
    ) busy on true
    where r.status = 'accepted' and r.member_id is not null
  ),

  -- 5. Two accepted responsibilities require the same adult simultaneously.
  c_responsibility_responsibility as (
    select
      md5('resp_resp:' || a.member_id || ':' || least(a.resp_id, b.resp_id) || ':'
          || greatest(a.resp_id, b.resp_id))::uuid as c_id,
      a.member_id as c_member, greatest(a.starts_at, b.starts_at)::date as c_date,
      'responsibility_responsibility'::text as c_type, 'warning'::text as c_sev,
      'responsibility'::text as primary_type, a.resp_id as primary_id, true as primary_navigable,
      'responsibility'::text as secondary_type, b.resp_id as secondary_id, true as secondary_navigable,
      to_char(greatest(a.starts_at, b.starts_at) at time zone 'UTC', 'HH24:MI') as msg_time
    from member_responsibilities a
    join member_responsibilities b on a.member_id = b.member_id and a.resp_id < b.resp_id
      and a.starts_at < b.ends_at and a.ends_at > b.starts_at
    where a.status = 'accepted' and b.status = 'accepted' and a.member_id is not null
  ),

  -- 6. A required drop-off/pick-up is unassigned or declined.
  c_unassigned_dropoff as (
    select
      md5('unassigned_dropoff:' || r.resp_id)::uuid as c_id,
      null::uuid as c_member, r.starts_at::date as c_date,
      'unassigned_dropoff_pickup'::text as c_type, 'warning'::text as c_sev,
      'responsibility'::text as primary_type, r.resp_id as primary_id, true as primary_navigable,
      null::text as secondary_type, null::uuid as secondary_id, true as secondary_navigable,
      to_char(r.starts_at at time zone 'UTC', 'HH24:MI') as msg_time
    from member_responsibilities r
    where r.type in ('drop_off', 'pick_up') and r.status in ('unassigned', 'declined')
  ),

  -- 7. An unassigned transport responsibility has no available active
  --    adult at all — a strictly more severe escalation of #6, additive
  --    (both rows are emitted; the client shows the worse one first via
  --    severity ordering).
  c_no_available_adult as (
    select
      md5('no_available_adult:' || r.resp_id)::uuid as c_id,
      null::uuid as c_member, r.starts_at::date as c_date,
      'no_available_adult'::text as c_type, 'critical'::text as c_sev,
      'responsibility'::text as primary_type, r.resp_id as primary_id, true as primary_navigable,
      null::text as secondary_type, null::uuid as secondary_id, true as secondary_navigable,
      to_char(r.starts_at at time zone 'UTC', 'HH24:MI') as msg_time
    from member_responsibilities r
    where r.type in ('drop_off', 'pick_up') and r.status in ('unassigned', 'declined')
      and not exists (
        select 1 from active_adults aa
        where not exists (
          -- Excludes the responsibility's own parent event (r.event_id):
          -- an adult who merely owns/created that event record (e.g. the
          -- other parent) isn't thereby "busy" with it — same fix as
          -- c_responsibility_busy above.
          select 1 from member_events e
          where e.member_id = aa.member_id and e.event_id <> r.event_id
            and e.starts_at < r.ends_at and e.ends_at > r.starts_at
        )
        and not exists (
          select 1 from member_timed_items i
          where i.member_id = aa.member_id and i.starts_at < r.ends_at and i.ends_at > r.starts_at
        )
        and not exists (
          select 1 from member_responsibilities other
          where other.member_id = aa.member_id and other.status = 'accepted'
            and other.starts_at < r.ends_at and other.ends_at > r.starts_at
        )
      )
  ),

  unioned as (
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_event_event
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_task_event
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_task_task
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_responsibility_busy
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_responsibility_responsibility
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_unassigned_dropoff
    union all
    select c_id, c_member, c_date, c_type, c_sev,
           primary_type, primary_id, primary_navigable,
           secondary_type, secondary_id, secondary_navigable, msg_time
    from c_no_available_adult
  )
  select
    u.c_id,
    p_family_id,
    u.c_date,
    u.c_type,
    u.c_sev,
    u.c_member,
    u.primary_type,
    case when u.primary_navigable then u.primary_id else null end,
    u.secondary_type,
    case when u.secondary_navigable then u.secondary_id else null end,
    'conflicts.' || u.c_type,
    jsonb_build_object('time', u.msg_time)
  from unioned u
  order by u.c_date, u.c_sev desc, u.c_id;
end;
$$;
revoke all on function public.list_family_conflicts(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_family_conflicts(uuid, timestamptz, timestamptz) to authenticated;
comment on function public.list_family_conflicts(uuid, timestamptz, timestamptz) is
  'Deterministically computed, never stored (Section 14) — every current conflict in a family '
  'across the 8 categories Section 13 requires, half-open interval overlap throughout. An '
  'entity id is redacted to null (kept as a generic type only) whenever it belongs to another '
  'member''s private (visibility <> family) item, so the client can never construct a '
  'navigation link into someone else''s private event/task — conflict_id itself is still '
  'derived from the real underlying ids first, so it stays stable even when redacted. Callable '
  'only by a current member of p_family_id. See docs/DECISIONS.md, "Phase 9."';
