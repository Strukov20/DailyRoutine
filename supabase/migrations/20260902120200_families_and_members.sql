-- families, family_members, family_invitations.
-- See docs/DATA_MODEL.md, "families" / "family_members" / "family_invitations",
-- and docs/DECISIONS.md for the ownership-integrity design below.

-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(both from name)) > 0),
  -- Denormalized for fast "who owns this family" reads without a join.
  -- Kept consistent with family_members' single 'owner' row by the
  -- validation trigger below (assert_family_owner_consistency) — not by a
  -- syncing trigger, because ownership assignment always happens by writing
  -- both rows together (this phase: only via test fixtures / migrations;
  -- Phase 3's create-family RPC must do the same). See docs/DECISIONS.md.
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id)
);

comment on table public.families is
  'A Family Space. owner_id is a denormalized pointer to the single family_members row '
  'with role = ''owner'' for this family — see assert_family_owner_consistency().';

create trigger set_families_updated_at
  before update on public.families
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- family_members
-- ---------------------------------------------------------------------------
-- Unified adult+child table (docs/DECISIONS.md, "unified family_members
-- table, not a separate children table"). profile_id is nullable — required
-- for adults, optional for children (nullable until a child profile is
-- linked to a real account, per docs/PRODUCT.md).
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  member_type text not null check (member_type in ('adult', 'child')),
  role text not null check (role in ('owner', 'adult', 'child')),
  profile_id uuid references public.profiles (id),
  display_name text not null check (length(trim(both from display_name)) > 0),
  avatar_url text,
  date_of_birth date,
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),

  -- An 'adult'/'owner' row must be linked to a real account; a 'child' row
  -- may or may not be (see docs/PRODUCT.md — "may be linked in the future").
  constraint family_members_role_matches_type check (
    (member_type = 'adult' and role in ('owner', 'adult') and profile_id is not null)
    or
    (member_type = 'child' and role = 'child')
  ),

  -- Enables the composite-FK "assignee must belong to the same family" trick
  -- used by tasks/responsibilities/event_participants below.
  constraint family_members_id_family_uniq unique (id, family_id)
);

comment on table public.family_members is
  'One row per person (adult or child) in a family. Adults are linked to profiles; '
  'children may be unlinked. See docs/DATA_MODEL.md and docs/DECISIONS.md.';

create trigger set_family_members_updated_at
  before update on public.family_members
  for each row
  execute function public.set_updated_at();

-- No duplicate *adult* membership in one family (children may share a
-- display name / lack profile_id, so this only constrains linked members).
create unique index family_members_unique_adult_per_family
  on public.family_members (family_id, profile_id)
  where profile_id is not null;

-- At most one 'owner' row per family — this is the DB-level guard against
-- "direct creation of a second family Owner without an approved
-- ownership-transfer flow" called out in the brief.
create unique index family_members_one_owner_per_family
  on public.family_members (family_id)
  where role = 'owner';

create index family_members_family_id_idx on public.family_members (family_id);
create index family_members_profile_id_idx on public.family_members (profile_id)
  where profile_id is not null;

-- ---------------------------------------------------------------------------
-- Owner consistency: families.owner_id must match the single 'owner' row's
-- profile_id (when one exists). A validating (not syncing) trigger — see the
-- comment on families.owner_id for why write-ordering makes this safe
-- without a chicken-and-egg problem.
-- ---------------------------------------------------------------------------
create function public.assert_family_owner_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_owner uuid;
begin
  if new.role = 'owner' then
    select f.owner_id into v_expected_owner
    from public.families f
    where f.id = new.family_id;

    if v_expected_owner is null or v_expected_owner <> new.profile_id then
      raise exception
        'family_members row with role=owner (profile %) does not match families.owner_id (%) for family %',
        new.profile_id, v_expected_owner, new.family_id
        using errcode = '23514'; -- check_violation
    end if;
  end if;

  return new;
end;
$$;

comment on function public.assert_family_owner_consistency() is
  'Guards against families.owner_id drifting from the single family_members role=owner '
  'row. families.owner_id must be set (to the creator''s own id) before that owner''s '
  'family_members row is inserted — see docs/DECISIONS.md.';

create trigger family_members_assert_owner_consistency
  before insert or update on public.family_members
  for each row
  execute function public.assert_family_owner_consistency();

-- ---------------------------------------------------------------------------
-- family_invitations
-- ---------------------------------------------------------------------------
create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  invited_email text not null check (invited_email = lower(invited_email)),
  invited_by uuid not null references public.profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  responded_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),

  constraint family_invitations_expires_after_created check (expires_at > created_at),
  constraint family_invitations_responded_only_when_resolved check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

comment on table public.family_invitations is
  'Pending/resolved invitations for an adult to join a family. UI for sending/accepting '
  'these is out of scope for this phase (see docs/MVP_SCOPE.md) — the table and RLS exist '
  'so the schema is ready per docs/DATA_MODEL.md.';

create trigger set_family_invitations_updated_at
  before update on public.family_invitations
  for each row
  execute function public.set_updated_at();

create index family_invitations_family_id_idx on public.family_invitations (family_id);
create index family_invitations_invited_email_idx on public.family_invitations (invited_email)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS: families
-- ---------------------------------------------------------------------------
alter table public.families enable row level security;
alter table public.families force row level security;
revoke all on public.families from anon, authenticated;

create policy "families_select_member"
  on public.families
  for select
  to authenticated
  using (public.is_family_member(id));

-- Family creation is deferred to Phase 3 (no family-creation RPC yet — see
-- docs/DATA_MODEL.md addendum and docs/ROADMAP.md); INSERT is intentionally
-- not granted to `authenticated` yet. Only name may ever be updated by an
-- owner directly — owner_id changes are guarded implicitly since the owner
-- consistency trigger above will reject any owner_id that doesn't have a
-- matching family_members role=owner row, and there is no policy allowing
-- authenticated users to write family_members role=owner rows either.
create policy "families_update_owner_name_only"
  on public.families
  for update
  to authenticated
  using (public.is_family_owner(id))
  with check (public.is_family_owner(id));

grant select, update on public.families to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: family_members
-- ---------------------------------------------------------------------------
alter table public.family_members enable row level security;
alter table public.family_members force row level security;
revoke all on public.family_members from anon, authenticated;

-- Members see the roster of every family they belong to (adults + children).
-- Uses the SECURITY DEFINER helper, not a self-join, to avoid recursion.
create policy "family_members_select_same_family"
  on public.family_members
  for select
  to authenticated
  using (public.is_family_member(family_id));

-- Row-level write policies exist for completeness/tests, but INSERT/UPDATE
-- are not granted to `authenticated` this phase — membership changes (invite
-- acceptance, child creation, ownership transfer) are Phase 3 (family UI)
-- work and belong behind reviewed RPCs, not raw table writes. See
-- docs/ROADMAP.md.
create policy "family_members_owner_manages_roster"
  on public.family_members
  for all
  to authenticated
  using (public.is_family_owner(family_id))
  with check (public.is_family_owner(family_id));

grant select on public.family_members to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: family_invitations
-- ---------------------------------------------------------------------------
alter table public.family_invitations enable row level security;
alter table public.family_invitations force row level security;
revoke all on public.family_invitations from anon, authenticated;

create policy "family_invitations_select_family_or_invitee"
  on public.family_invitations
  for select
  to authenticated
  using (
    public.is_family_member(family_id)
    or invited_email = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

create policy "family_invitations_owner_manages"
  on public.family_invitations
  for all
  to authenticated
  using (public.is_family_owner(family_id))
  with check (public.is_family_owner(family_id));

grant select on public.family_invitations to authenticated;
