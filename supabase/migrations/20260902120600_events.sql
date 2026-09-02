-- events, event_participants, responsibilities.
--
-- The single most important domain rule in this schema: an event and a
-- responsibility are separate tables. Drop-off/pick-up are rows in
-- `responsibilities`, never text fields on `events`. See docs/PRODUCT.md and
-- knowledge/wiki/domain/events-and-responsibilities.md.

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id),
  family_id uuid references public.families (id) on delete cascade,

  title text not null check (length(trim(both from title)) > 0),
  description text,
  location text,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Events always carry a time, so (unlike tasks) timezone is required —
  -- needed to compute recurring instances correctly across DST. See
  -- docs/DECISIONS.md, "Timezone handling".
  timezone text not null,

  visibility text not null default 'private'
    check (visibility in ('private', 'family')),
  recurrence_rule_id uuid references public.recurrence_rules (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),

  constraint events_ends_after_starts check (ends_at > starts_at)
);

comment on table public.events is
  'Personal or family-shared calendar events. Never carries responsibility fields — see '
  'the responsibilities table below.';

create trigger set_events_updated_at
  before update on public.events
  for each row
  execute function public.set_updated_at();

create index events_owner_profile_id_idx on public.events (owner_profile_id);
create index events_family_id_idx on public.events (family_id) where family_id is not null;
create index events_family_starts_at_idx on public.events (family_id, starts_at) where family_id is not null;

-- ---------------------------------------------------------------------------
-- event_participants — who/what the event is about (e.g. "this concerns
-- Son"). Distinct from responsibility ("who has to act"). See
-- docs/DATA_MODEL.md.
-- ---------------------------------------------------------------------------
create table public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Denormalized from events.family_id — see the family_id-population
  -- trigger below and docs/DECISIONS.md.
  family_id uuid not null,
  family_member_id uuid not null,
  created_at timestamptz not null default now(),

  constraint event_participants_same_family
    foreign key (family_member_id, family_id)
    references public.family_members (id, family_id),
  constraint event_participants_unique unique (event_id, family_member_id)
);

create index event_participants_event_id_idx on public.event_participants (event_id);
create index event_participants_family_id_idx on public.event_participants (family_id);

-- ---------------------------------------------------------------------------
-- responsibilities — the assignable duty tied to an event. THE table that
-- encodes "event ≠ responsibility". See docs/DATA_MODEL.md worked example
-- (Swimming event + drop_off → Mom + pick_up → Dad, as three separate rows).
-- ---------------------------------------------------------------------------
create table public.responsibilities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  family_id uuid not null,

  type text not null check (type in ('drop_off', 'pick_up', 'supervise', 'custom')),
  label text,

  assignee_member_id uuid,
  status text not null default 'unassigned'
    check (status in ('unassigned', 'pending_acceptance', 'accepted', 'declined', 'done')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),

  constraint responsibilities_custom_requires_label check (
    type <> 'custom' or (label is not null and length(trim(both from label)) > 0)
  ),
  constraint responsibilities_assignee_same_family
    foreign key (assignee_member_id, family_id)
    references public.family_members (id, family_id)
);

comment on table public.responsibilities is
  'A discrete, assignable duty tied to an event — never a text field on the event itself. '
  'See docs/PRODUCT.md, "Critical domain rule".';

create trigger set_responsibilities_updated_at
  before update on public.responsibilities
  for each row
  execute function public.set_updated_at();

create index responsibilities_event_id_idx on public.responsibilities (event_id);
create index responsibilities_family_id_idx on public.responsibilities (family_id);
create index responsibilities_assignee_member_id_idx on public.responsibilities (assignee_member_id)
  where assignee_member_id is not null;

-- ---------------------------------------------------------------------------
-- Auto-populate the denormalized family_id from the parent event on both
-- child tables — always correct by construction, never trusted from the
-- client. Same rationale as task_assignments.set_task_assignment_family_id.
-- ---------------------------------------------------------------------------
create function public.set_event_child_family_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select e.family_id into new.family_id
  from public.events e
  where e.id = new.event_id;

  if new.family_id is null then
    raise exception 'cannot attach % to a personal (non-family) event %', tg_table_name, new.event_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger event_participants_set_family_id
  before insert on public.event_participants
  for each row
  execute function public.set_event_child_family_id();

create trigger responsibilities_set_family_id
  before insert or update of event_id on public.responsibilities
  for each row
  execute function public.set_event_child_family_id();

-- ---------------------------------------------------------------------------
-- RLS: events (same shape as tasks — see that migration's comment)
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.events force row level security;
revoke all on public.events from anon, authenticated;

create policy "events_select_owner_or_family_visible"
  on public.events
  for select
  to authenticated
  using (
    owner_profile_id = auth.uid()
    or (visibility = 'family' and family_id in (select public.current_family_ids()))
  );

create policy "events_insert_own"
  on public.events
  for insert
  to authenticated
  with check (
    owner_profile_id = auth.uid()
    and (family_id is null or public.is_family_member(family_id))
  );

create policy "events_update_own"
  on public.events
  for update
  to authenticated
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy "events_delete_own"
  on public.events
  for delete
  to authenticated
  using (owner_profile_id = auth.uid());

grant select, insert, update, delete on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: event_participants
-- ---------------------------------------------------------------------------
alter table public.event_participants enable row level security;
alter table public.event_participants force row level security;
revoke all on public.event_participants from anon, authenticated;

create policy "event_participants_select_visible_event"
  on public.event_participants
  for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (e.owner_profile_id = auth.uid() or (e.visibility = 'family' and public.is_family_member(e.family_id)))
    )
  );

create policy "event_participants_owner_manages"
  on public.event_participants
  for all
  to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id = auth.uid()));

grant select, insert, update, delete on public.event_participants to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: responsibilities
-- ---------------------------------------------------------------------------
alter table public.responsibilities enable row level security;
alter table public.responsibilities force row level security;
revoke all on public.responsibilities from anon, authenticated;

create policy "responsibilities_select_visible_event"
  on public.responsibilities
  for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (e.owner_profile_id = auth.uid() or (e.visibility = 'family' and public.is_family_member(e.family_id)))
    )
  );

-- Event owner manages responsibility rows (create/edit/delete). Accept/decline
-- semantics for responsibilities mirror task_assignments and are deferred to
-- Phase 3 (family/calendar UI) — see docs/ROADMAP.md; the schema and this
-- owner-manages policy are ready for it.
create policy "responsibilities_owner_manages"
  on public.responsibilities
  for all
  to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id = auth.uid()));

grant select, insert, update, delete on public.responsibilities to authenticated;
