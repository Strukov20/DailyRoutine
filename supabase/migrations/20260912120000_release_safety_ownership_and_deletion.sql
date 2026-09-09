-- Phase 10 (MVP Stabilization) — mandatory release-safety functionality:
-- family ownership transfer, an owner's ability to leave or delete a
-- family, and self-service account deletion. None of this existed before
-- this migration (confirmed by audit: no transfer/delete/leave/account-
-- deletion RPC anywhere in prior migrations) — docs/ROADMAP.md and
-- docs/DATA_MODEL.md both explicitly deferred ownership transfer, and
-- remove_family_member() has always hard-refused to remove an owner row
-- ("ownership transfer is not supported yet").
--
-- Design summary (full rationale in docs/DECISIONS.md, "Phase 10"):
--
--  * families gains `deleted_at` — soft delete, same convention as
--    tasks.deleted_at/events.deleted_at/family_members.removed_at. A
--    deleted family is not hard-removed (its historical tasks/events/
--    responsibilities/audit trail remain in place for any still-relevant
--    reference), it simply becomes unreachable: is_family_member/
--    is_family_owner/current_family_ids (the three choke-point helpers
--    every RLS policy on family-scoped tables goes through) now also
--    exclude a deleted family, so access falls away everywhere in one
--    place rather than needing every policy touched individually.
--  * profiles gains `deleted_at` — same reasoning, for account deletion.
--    auth.users is never deleted by this migration (see
--    request_account_deletion()'s own comment for why: hard-deleting
--    auth.users would cascade-fail against tasks.owner_profile_id/
--    events.owner_profile_id/families.owner_id, none of which are
--    ON DELETE CASCADE, by design, so every one of those rows would need
--    to be deleted or reassigned first — a much larger, riskier change
--    than this phase's brief calls for. Anonymize-in-place instead;
--    actually removing the auth.users row is documented as a follow-up
--    Edge Function using the Admin API, not deployed by this migration).
--  * `families`/`profiles` UPDATE grants are narrowed to an explicit
--    column list that excludes `deleted_at` — otherwise a client could
--    soft-delete their own family or account via a raw PostgREST UPDATE,
--    bypassing every safety check the RPCs below enforce (most
--    importantly: "never orphan a family without an owner").
--  * transfer_family_ownership / delete_family / leave_family all share
--    one internal helper, _remove_or_leave_family_member(), which is the
--    exact same unassign-then-soft-remove logic remove_family_member()
--    already uses — refactored out so self-service leave/account-deletion
--    can reuse it instead of duplicating it.

-- ---------------------------------------------------------------------------
-- Schema: soft-delete columns
-- ---------------------------------------------------------------------------

alter table public.families add column deleted_at timestamptz;
comment on column public.families.deleted_at is
  'Soft delete — see is_family_member()/is_family_owner()/current_family_ids(), which all '
  'exclude a deleted family. Set only by delete_family(). No restore RPC this phase, same '
  '"no undelete this phase" convention as tasks.deleted_at/events.deleted_at.';

alter table public.profiles add column deleted_at timestamptz;
comment on column public.profiles.deleted_at is
  'Set by request_account_deletion() — the profile row is anonymized in place, never '
  'hard-deleted (see this migration''s own header comment for why). A profile with '
  'deleted_at set is not reachable via profiles_select_own for anyone but a service role; '
  'existing family-shared content it still owns remains valid and visible to the family.';

-- Narrow both tables' UPDATE grants to exclude deleted_at (and, for
-- families, owner_id — already effectively unwritable via the existing
-- consistency trigger, made explicit here) so a raw client UPDATE can never
-- bypass the safety checks in the RPCs below.
revoke update on public.families from authenticated;
grant update (name) on public.families to authenticated;

revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, preferred_language, preferred_color_scheme)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Choke-point helpers: exclude a deleted family everywhere at once
-- ---------------------------------------------------------------------------

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
    join public.families f on f.id = fm.family_id
    where fm.family_id = p_family_id
      and fm.profile_id = p_profile_id
      and fm.removed_at is null
      and f.deleted_at is null
  );
$$;

comment on function public.is_family_member(uuid, uuid) is
  'True if p_profile_id (default: caller) is a *current* member (adult or linked child, '
  'removed_at is null) of p_family_id, and that family has not been deleted. SECURITY '
  'DEFINER to avoid recursive RLS. Phase 10: now also excludes a deleted family — the '
  'single choke point every family-scoped RLS policy already goes through.';

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
    join public.families f on f.id = fm.family_id
    where fm.family_id = p_family_id
      and fm.profile_id = p_profile_id
      and fm.role = 'owner'
      and fm.removed_at is null
      and f.deleted_at is null
  );
$$;

comment on function public.is_family_owner(uuid, uuid) is
  'True if p_profile_id (default: caller) is the *current* owner of p_family_id, and that '
  'family has not been deleted.';

create or replace function public.current_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select fm.family_id
  from public.family_members fm
  join public.families f on f.id = fm.family_id
  where fm.profile_id = auth.uid()
    and fm.removed_at is null
    and f.deleted_at is null;
$$;

comment on function public.current_family_ids() is
  'All family_id values the caller is a *current* adult member of, excluding a deleted '
  'family. Use as `family_id in (select public.current_family_ids())` in RLS policies '
  'instead of joining family_members directly, to avoid recursive policy evaluation.';

-- ---------------------------------------------------------------------------
-- Append-only audit trail for ownership transfers — same "insert-only,
-- never update/delete" convention as task_assignments/
-- responsibility_assignments (Phase 5/7).
-- ---------------------------------------------------------------------------

create table public.family_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  previous_owner_member_id uuid not null references public.family_members (id),
  new_owner_member_id uuid not null references public.family_members (id),
  transferred_by uuid not null references public.profiles (id),
  transferred_at timestamptz not null default now()
);

comment on table public.family_ownership_transfers is
  'Append-only audit trail — one row per transfer_family_ownership() call. Never updated or '
  'deleted, same convention as task_assignments/responsibility_assignments.';

alter table public.family_ownership_transfers enable row level security;
alter table public.family_ownership_transfers force row level security;
revoke all on public.family_ownership_transfers from anon, authenticated;

create policy "family_ownership_transfers_select_member"
  on public.family_ownership_transfers
  for select
  to authenticated
  using (public.is_family_member(family_id));

grant select on public.family_ownership_transfers to authenticated;
-- No INSERT/UPDATE/DELETE grant at all — every row is written exclusively
-- by transfer_family_ownership() below, running as SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- Internal helper: the shared "unassign this member's active work, then
-- soft-remove them" logic. Previously inlined only in remove_family_member;
-- factored out here so leave_family() and request_account_deletion() can
-- reuse it exactly rather than re-implementing (and risking drift from) the
-- same unassign-before-remove guarantee. Never granted EXECUTE to any
-- client role — callable only from another SECURITY DEFINER function in
-- this schema.
-- ---------------------------------------------------------------------------

create function public._remove_or_leave_family_member(p_member_id uuid, p_acting_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id
  from public.family_members
  where id = p_member_id and removed_at is null;

  if v_family_id is null then
    return; -- already removed — safe no-op, matches remove_family_member's own idempotency
  end if;

  insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action)
  select t.id, t.assignee_member_id, p_acting_member_id, 'unassigned'
  from public.tasks t
  where t.family_id = v_family_id
    and t.assignee_member_id = p_member_id
    and t.assignment_status in ('pending_acceptance', 'accepted')
    and t.deleted_at is null
  for update of t;

  insert into public.responsibility_assignments (responsibility_id, assigned_to_member_id, assigned_by_member_id, action)
  select r.id, r.assignee_member_id, p_acting_member_id, 'unassigned'
  from public.responsibilities r
  join public.events e on e.id = r.event_id
  where r.family_id = v_family_id
    and r.assignee_member_id = p_member_id
    and r.status in ('pending_acceptance', 'accepted')
    and e.deleted_at is null
  for update of r;

  update public.family_members set removed_at = now() where id = p_member_id;
end;
$$;

comment on function public._remove_or_leave_family_member(uuid, uuid) is
  'Internal only (no EXECUTE grant to any client role) — the unassign-then-soft-remove '
  'logic shared by remove_family_member, leave_family, and request_account_deletion.';

-- Supabase's own default-privilege bootstrap grants EXECUTE on every new
-- function to anon/authenticated at creation time, as separate ACL entries
-- from PUBLIC (see docs/DECISIONS.md, "Phase 3," for the first time this
-- bit the codebase) — an explicit revoke is required even for a function
-- meant to be callable by nothing outside this file.
revoke all on function public._remove_or_leave_family_member(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- remove_family_member — re-pointed at the shared helper; behavior
-- unchanged (still owner-only, still refuses to remove the owner row —
-- transfer_family_ownership/delete_family are the sanctioned ways to
-- resolve an owner now, so the old "not supported yet" wording is updated).
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
      'the family owner cannot be removed — transfer ownership or delete the family instead'
      using errcode = '22023';
  end if;

  v_acting_member_id := public.current_member_id(v_family_id);
  perform public._remove_or_leave_family_member(p_member_id, v_acting_member_id);
end;
$$;

comment on function public.remove_family_member(uuid) is
  'Owner-only, and refuses to ever remove the owner row itself — transfer_family_ownership '
  'or delete_family are the sanctioned ways to resolve an owner. Phase 10: re-pointed at '
  'the shared _remove_or_leave_family_member() helper; behavior unchanged.';

-- ---------------------------------------------------------------------------
-- transfer_family_ownership
-- ---------------------------------------------------------------------------
-- Ordering matters and is deliberate (see docs/DECISIONS.md for the full
-- trace): families.owner_id is updated *first*, then the old owner's row is
-- demoted, then the new owner's row is promoted. assert_family_owner_
-- consistency (fires on family_members insert/update) only checks the
-- invariant when a row's role is being set *to* 'owner', and requires
-- families.owner_id to already match at that point — so owner_id must move
-- first. The unique partial index on (family_id) where role='owner' means
-- there can never be two owner rows at once; demoting before promoting
-- keeps every intermediate statement within this single transaction valid
-- too (zero owner rows briefly, never two).
create function public.transfer_family_ownership(p_family_id uuid, p_new_owner_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_old_owner_member_id uuid;
  v_new_owner_family_id uuid;
  v_new_owner_profile_id uuid;
  v_new_owner_member_type text;
  v_new_owner_removed_at timestamptz;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_family_owner(p_family_id, v_caller_id) then
    raise exception 'only the family owner can transfer ownership' using errcode = '42501';
  end if;

  select id into v_old_owner_member_id
  from public.family_members
  where family_id = p_family_id and role = 'owner' and removed_at is null;

  -- Deliberately the same "unavailable" outcome (42501) regardless of
  -- whether p_new_owner_member_id doesn't exist, belongs to another family,
  -- or was already removed — never a distinguishable error that would let
  -- the caller probe for another family's member ids. See
  -- docs/DECISIONS.md, "Phase 9," for why this codebase treats that class
  -- of distinction as an information leak, not a UX nicety.
  select family_id, profile_id, member_type, removed_at
    into v_new_owner_family_id, v_new_owner_profile_id, v_new_owner_member_type, v_new_owner_removed_at
  from public.family_members
  where id = p_new_owner_member_id;

  if v_new_owner_family_id is null or v_new_owner_family_id <> p_family_id or v_new_owner_removed_at is not null then
    raise exception 'target member unavailable' using errcode = '42501';
  end if;

  if p_new_owner_member_id = v_old_owner_member_id then
    raise exception 'this member already owns the family' using errcode = '22023';
  end if;

  -- Authorized to know it exists (same family) but not eligible — a real,
  -- transition-specific rule, so 22023 (not the 42501 "unavailable" above).
  if v_new_owner_member_type <> 'adult' or v_new_owner_profile_id is null then
    raise exception 'ownership can only be transferred to an active adult member' using errcode = '22023';
  end if;

  update public.families set owner_id = v_new_owner_profile_id where id = p_family_id;
  update public.family_members set role = 'adult' where id = v_old_owner_member_id;
  update public.family_members set role = 'owner' where id = p_new_owner_member_id;

  insert into public.family_ownership_transfers
    (family_id, previous_owner_member_id, new_owner_member_id, transferred_by)
  values (p_family_id, v_old_owner_member_id, p_new_owner_member_id, v_caller_id);
end;
$$;

comment on function public.transfer_family_ownership(uuid, uuid) is
  'Owner-only. Atomically re-points families.owner_id and swaps the two family_members '
  'roles; the previous owner becomes a plain adult member (never removed — they may '
  'leave_family() afterward if they want to). Child profiles can never become owners '
  '(member_type must be ''adult'', profile_id not null). Records an append-only audit row.';

revoke all on function public.transfer_family_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_family_ownership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_family — owner-only, soft delete. Revokes every pending invitation
-- in the same transaction (rather than relying on every invitation-reading
-- path to separately check the family isn't deleted).
-- ---------------------------------------------------------------------------
create function public.delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_family_owner(p_family_id) then
    raise exception 'only the family owner can delete the family' using errcode = '42501';
  end if;

  update public.family_invitations
  set status = 'revoked', responded_at = now()
  where family_id = p_family_id and status = 'pending';

  update public.families set deleted_at = now() where id = p_family_id;
end;
$$;

comment on function public.delete_family(uuid) is
  'Owner-only, soft delete (families.deleted_at) — is_family_member/is_family_owner/'
  'current_family_ids all exclude a deleted family immediately, so every member (including '
  'the former owner) loses access in the same instant, everywhere, via that one choke '
  'point. Tasks/events/responsibilities/assignment-audit rows/notification outbox rows are '
  'never deleted — they remain as historical data, simply unreachable once membership can '
  'no longer be established. Every pending invitation is revoked in the same transaction. '
  'See docs/DECISIONS.md, "Phase 10," for the full per-table lifecycle writeup.';

revoke all on function public.delete_family(uuid) from public, anon;
grant execute on function public.delete_family(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- leave_family — self-service, non-owner adult members only. An owner must
-- transfer_family_ownership or delete_family first; this deliberately never
-- accepts a role='owner' caller, so "owner leaves" is always an explicit
-- two-step action (transfer or delete, then optionally leave), never a
-- single ambiguous one.
-- ---------------------------------------------------------------------------
create function public.leave_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_member_id uuid;
  v_role text;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select id, role into v_member_id, v_role
  from public.family_members
  where family_id = p_family_id and profile_id = v_caller_id and removed_at is null;

  if v_member_id is null then
    raise exception 'not a member of this family' using errcode = '42501';
  end if;

  if v_role = 'owner' then
    raise exception
      'the family owner must transfer ownership or delete the family before leaving'
      using errcode = '22023';
  end if;

  perform public._remove_or_leave_family_member(v_member_id, v_member_id);
end;
$$;

comment on function public.leave_family(uuid) is
  'Self-service — any active non-owner adult member may leave their own family at any '
  'time. An owner is blocked (22023) until they transfer_family_ownership or delete_family '
  '— "owner leaves" is always an explicit two-step action, never implicit.';

revoke all on function public.leave_family(uuid) from public, anon;
grant execute on function public.leave_family(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- request_account_deletion — self-service. See this migration's own header
-- comment for why auth.users itself is never deleted here.
-- ---------------------------------------------------------------------------
create function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_owned_family_count integer;
  v_member record;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Never orphan a family: every family this caller currently owns must
  -- already have been transferred or deleted before the account can go.
  select count(*) into v_owned_family_count
  from public.family_members fm
  join public.families f on f.id = fm.family_id
  where fm.profile_id = v_caller_id and fm.role = 'owner' and fm.removed_at is null and f.deleted_at is null;

  if v_owned_family_count > 0 then
    raise exception
      'transfer ownership or delete every family you own before deleting your account'
      using errcode = '22023';
  end if;

  -- Leave every remaining (non-owner) family membership — same unassign-
  -- then-soft-remove guarantee as leave_family(), applied to all of them.
  for v_member in
    select fm.id
    from public.family_members fm
    join public.families f on f.id = fm.family_id
    where fm.profile_id = v_caller_id and fm.removed_at is null and f.deleted_at is null
  loop
    perform public._remove_or_leave_family_member(v_member.id, v_member.id);
  end loop;

  -- Private content is this account's alone — soft-delete it. Family-
  -- shared (visibility = 'family') content this account still owns is
  -- deliberately left in place: another family member may depend on it
  -- (an assigned shared task, a shared event with responsibilities), and
  -- the owning profile row still exists (anonymized below, never
  -- hard-deleted), so it stays valid and visible rather than orphaned.
  update public.tasks
  set deleted_at = now()
  where owner_profile_id = v_caller_id and visibility = 'private' and deleted_at is null;

  update public.events
  set deleted_at = now()
  where owner_profile_id = v_caller_id and visibility = 'private' and deleted_at is null;

  -- Every pending invitation this account sent (from any family, including
  -- ones already left above) is revoked — never left dangling.
  update public.family_invitations
  set status = 'revoked', responded_at = now()
  where invited_by = v_caller_id and status = 'pending';

  -- Device tokens: deactivate rather than delete (mirrors
  -- deactivateCurrentDeviceToken()'s own soft-deactivation convention;
  -- notification_preferences has no client-visible content worth erasing).
  update public.notification_tokens
  set deactivated_at = now()
  where profile_id = v_caller_id and deactivated_at is null;

  -- Anonymize in place — never a hard delete of this row (see header
  -- comment). preferred_language/preferred_color_scheme are left as-is
  -- (not personal data worth erasing); display_name/avatar_url are.
  update public.profiles
  set display_name = 'Deleted user', avatar_url = null, deleted_at = now()
  where id = v_caller_id;
end;
$$;

comment on function public.request_account_deletion() is
  'Self-service account deletion. Blocks if the caller currently owns any non-deleted '
  'family (transfer or delete it first). Leaves every other family membership (same '
  'unassign-then-soft-remove guarantee as leave_family()). Soft-deletes the caller''s own '
  'private tasks/events; leaves family-shared ones in place rather than orphaning them for '
  'other members. Deactivates device tokens, revokes pending invitations, and anonymizes '
  '(never hard-deletes) the profile row. auth.users itself is never touched by this '
  'function — see this migration''s header comment for why, and docs/DECISIONS.md, '
  '"Phase 10," for the documented (not deployed) Edge Function follow-up that would '
  'actually purge it via the Admin API once this RPC has succeeded and the client has '
  'signed out.';

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
