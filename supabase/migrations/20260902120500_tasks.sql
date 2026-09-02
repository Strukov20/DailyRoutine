-- tasks, task_assignments, reminders. See docs/DATA_MODEL.md.

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id),
  family_id uuid references public.families (id) on delete cascade,

  title text not null check (length(trim(both from title)) > 0),
  description text,

  -- A task may have: no date (Inbox), a date only, or a date + start_time.
  -- date is an explicit local date (no ambiguity — see docs/DECISIONS.md,
  -- "Timezone handling"); start_time + timezone together anchor a real
  -- instant for reminder computation.
  date date,
  start_time time,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  timezone text,

  priority text not null default 'normal'
    check (priority in ('normal', 'important', 'critical')),
  category_id uuid references public.categories (id),
  recurrence_rule_id uuid references public.recurrence_rules (id),

  visibility text not null default 'private'
    check (visibility in ('private', 'family')),

  completed_at timestamptz,

  assignee_member_id uuid,
  assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned', 'pending_acceptance', 'accepted', 'declined')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),

  -- A start_time needs a timezone to be an unambiguous instant; a duration
  -- without a start_time is meaningless.
  constraint tasks_time_requires_timezone check (start_time is null or timezone is not null),
  constraint tasks_duration_requires_time check (duration_minutes is null or start_time is not null),

  -- Assignment only makes sense for family-shared tasks.
  constraint tasks_personal_no_assignment check (
    family_id is not null or (assignee_member_id is null and assignment_status = 'unassigned')
  ),
  -- Closes the MATCH SIMPLE gap on the composite FK below: an assignee
  -- without a family_id would otherwise silently skip the FK check.
  constraint tasks_assignee_requires_family check (
    assignee_member_id is null or family_id is not null
  ),

  -- "assignment to someone outside the relevant family" is prevented at the
  -- database level: the assignee must be a family_members row belonging to
  -- this exact family_id (composite FK against family_members' (id, family_id)
  -- unique constraint — see docs/DECISIONS.md).
  constraint tasks_assignee_same_family
    foreign key (assignee_member_id, family_id)
    references public.family_members (id, family_id)
);

comment on table public.tasks is
  'Personal (family_id null) or family-shared tasks. Only title is required. See '
  'docs/DATA_MODEL.md and src/domain/tasks/schemas.ts (the client-side mirror of the '
  '"only title required" rule).';

create trigger set_tasks_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

create index tasks_owner_profile_id_idx on public.tasks (owner_profile_id);
create index tasks_family_id_idx on public.tasks (family_id) where family_id is not null;
create index tasks_family_date_idx on public.tasks (family_id, date) where family_id is not null;
create index tasks_assignee_member_id_idx on public.tasks (assignee_member_id)
  where assignee_member_id is not null;

-- ---------------------------------------------------------------------------
-- A private task cannot be assigned to anyone but its own owner (you can't
-- assign work to someone whose RLS-granted access excludes the task itself —
-- see docs/SECURITY_AND_PRIVACY.md, Mechanism 1), and a task's category must
-- be a system category or belong to the task's own family. Both checks need
-- a lookup, so they're a trigger rather than a CHECK constraint.
-- ---------------------------------------------------------------------------
create function public.assert_task_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignee_profile_id uuid;
  v_category_family_id uuid;
  v_category_is_system boolean;
begin
  if new.assignee_member_id is not null and new.visibility = 'private' then
    select fm.profile_id into v_assignee_profile_id
    from public.family_members fm
    where fm.id = new.assignee_member_id;

    if v_assignee_profile_id is distinct from new.owner_profile_id then
      raise exception
        'a private task cannot be assigned to anyone other than its owner (task %)', new.id
        using errcode = '23514';
    end if;
  end if;

  if new.category_id is not null then
    select c.family_id, c.is_system into v_category_family_id, v_category_is_system
    from public.categories c
    where c.id = new.category_id;

    if not v_category_is_system and v_category_family_id is distinct from new.family_id then
      raise exception
        'task % category % does not belong to the task''s family', new.id, new.category_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_assert_integrity
  before insert or update on public.tasks
  for each row
  execute function public.assert_task_integrity();

-- ---------------------------------------------------------------------------
-- task_assignments — append-only audit trail. See docs/DATA_MODEL.md.
-- ---------------------------------------------------------------------------
create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Denormalized from tasks.family_id by the trigger below — enables the
  -- composite-FK same-family check without a subquery CHECK (Postgres CHECK
  -- constraints can't reference other tables) and non-recursive RLS.
  family_id uuid not null,
  assigned_to_member_id uuid not null,
  assigned_by_member_id uuid,
  action text not null
    check (action in ('assigned', 'took', 'accepted', 'declined', 'unassigned', 'reassigned')),
  created_at timestamptz not null default now(),

  constraint task_assignments_to_same_family
    foreign key (assigned_to_member_id, family_id)
    references public.family_members (id, family_id),
  constraint task_assignments_by_same_family
    foreign key (assigned_by_member_id, family_id)
    references public.family_members (id, family_id)
);

comment on table public.task_assignments is
  'Append-only: every assignment action is a new row, never edited. tasks.assignee_member_id '
  '/ assignment_status are a snapshot maintained by apply_task_assignment_action().';

create index task_assignments_task_id_idx on public.task_assignments (task_id);
create index task_assignments_family_id_idx on public.task_assignments (family_id);

create function public.set_task_assignment_family_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select t.family_id into new.family_id
  from public.tasks t
  where t.id = new.task_id;

  if new.family_id is null then
    raise exception 'cannot record an assignment for a personal (non-family) task %', new.task_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger task_assignments_set_family_id
  before insert on public.task_assignments
  for each row
  execute function public.set_task_assignment_family_id();

create function public.apply_task_assignment_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tasks
  set
    assignee_member_id = case new.action
      when 'declined' then null
      when 'unassigned' then null
      else new.assigned_to_member_id
    end,
    assignment_status = case new.action
      when 'assigned' then 'pending_acceptance'
      when 'reassigned' then 'pending_acceptance'
      when 'took' then 'accepted'
      when 'accepted' then 'accepted'
      when 'declined' then 'unassigned'
      when 'unassigned' then 'unassigned'
    end
  where id = new.task_id;

  return new;
end;
$$;

create trigger task_assignments_apply_action
  after insert on public.task_assignments
  for each row
  execute function public.apply_task_assignment_action();

-- ---------------------------------------------------------------------------
-- reminders — always owner-only, never shared (see docs/DATA_MODEL.md).
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  remind_at timestamptz not null,
  offset_minutes_before integer check (offset_minutes_before is null or offset_minutes_before >= 0),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reminders is
  'Always owner-only (profile_id), even for a shared task — see '
  'docs/SECURITY_AND_PRIVACY.md, Mechanism 4.';

create trigger set_reminders_updated_at
  before update on public.reminders
  for each row
  execute function public.set_updated_at();

create index reminders_task_id_idx on public.reminders (task_id);
create index reminders_profile_id_idx on public.reminders (profile_id);

-- ---------------------------------------------------------------------------
-- RLS: tasks
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
revoke all on public.tasks from anon, authenticated;

-- Non-owners only ever see a task through the base table when it is
-- explicitly family-visible — a private task is invisible to everyone but
-- its owner at the base-table level. Busy-block visibility for private
-- family-linked tasks is provided by the sanitized view in a later
-- migration, never by widening this policy. See
-- docs/SECURITY_AND_PRIVACY.md, Mechanism 1 & 2.
create policy "tasks_select_owner_or_family_visible"
  on public.tasks
  for select
  to authenticated
  using (
    owner_profile_id = auth.uid()
    or (visibility = 'family' and family_id in (select public.current_family_ids()))
  );

create policy "tasks_insert_own"
  on public.tasks
  for insert
  to authenticated
  with check (
    owner_profile_id = auth.uid()
    and (family_id is null or public.is_family_member(family_id))
  );

-- Only the owner may edit task content. Assignment-status changes go
-- through task_assignments (see apply_task_assignment_action above), which
-- runs as SECURITY DEFINER — an assignee never needs direct UPDATE access
-- to someone else's task row.
create policy "tasks_update_own"
  on public.tasks
  for update
  to authenticated
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy "tasks_delete_own"
  on public.tasks
  for delete
  to authenticated
  using (owner_profile_id = auth.uid());

grant select, insert, update, delete on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: task_assignments
-- ---------------------------------------------------------------------------
alter table public.task_assignments enable row level security;
alter table public.task_assignments force row level security;
revoke all on public.task_assignments from anon, authenticated;

create policy "task_assignments_select_family"
  on public.task_assignments
  for select
  to authenticated
  using (public.is_family_member(family_id));

-- See docs/DATA_MODEL.md "Assignment workflow": assigning is not automatic
-- acceptance, "took" is a self-claim, and only the addressed member may
-- accept/decline their own pending assignment.
create policy "task_assignments_insert_authorized"
  on public.task_assignments
  for insert
  to authenticated
  with check (
    public.is_family_member(family_id)
    and (
      assigned_by_member_id is null
      or exists (
        select 1 from public.family_members fm
        where fm.id = assigned_by_member_id and fm.profile_id = auth.uid()
      )
    )
    and (
      action not in ('took', 'accepted', 'declined')
      or exists (
        select 1 from public.family_members fm
        where fm.id = assigned_to_member_id and fm.profile_id = auth.uid()
      )
    )
    and (
      action <> 'took'
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.assignee_member_id is null
      )
    )
    and (
      action not in ('accepted', 'declined')
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.assignee_member_id = assigned_to_member_id
      )
    )
  );

grant select, insert on public.task_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: reminders
-- ---------------------------------------------------------------------------
alter table public.reminders enable row level security;
alter table public.reminders force row level security;
revoke all on public.reminders from anon, authenticated;

create policy "reminders_owner_only"
  on public.reminders
  for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update, delete on public.reminders to authenticated;
