-- Phase 3: family creation, invitations (hashed-token based), member
-- removal, and child profiles — all as narrowly scoped SECURITY DEFINER
-- RPCs. See docs/DECISIONS.md, "Phase 3: RPC-only family mutations" for the
-- full rationale summarized here:
--
--   families/family_members have never had an INSERT/UPDATE/DELETE grant for
--   `authenticated` beyond the single owner-name-rename case (Phase 2). That
--   was deliberate — see docs/ROADMAP.md — and this migration keeps it that
--   way. Every mutation that used to be "a policy that would match if there
--   were a grant" is replaced here by a SECURITY DEFINER RPC that enforces
--   the actual business invariant (owner-orphan prevention, child-only
--   fields, token validity) in one place, instead of relying on RLS alone to
--   express rules RLS can't express well (e.g. "not the last owner").
--
--   The two dead policies this replaces (family_members_owner_manages_roster,
--   family_invitations_owner_manages) were both `for all` policies with no
--   matching grant, so they never actually matched anything — dropped here
--   for clarity, not because they were unsafe.
--
--   family_invitations previously let an invitee discover their invitation
--   by direct SELECT when their JWT email matched invited_email. That model
--   doesn't fit link/token delivery (no email provider exists — invitations
--   are shared via deep link, native Share, or copy-link) and handed back
--   family_id/invited_by/status outside any controlled interface. It is
--   replaced by: owners can SELECT their own family's invitations (for a
--   management list); everyone else reaches an invitation exclusively
--   through get_family_invitation_preview(token), which returns only a
--   sanitized projection.

-- ---------------------------------------------------------------------------
-- Regression fix: anon has EXECUTE on every function in this schema
-- ---------------------------------------------------------------------------
-- Supabase's local/hosted Postgres runs `alter default privileges in schema
-- public grant execute on functions to anon, authenticated, service_role`
-- as part of its own role bootstrap — every function gets EXECUTE granted
-- directly to `anon` and `authenticated` *at creation time*, as separate ACL
-- entries from the PUBLIC pseudo-role. `revoke all on function ... from
-- public` (used throughout Phase 2 and, before this fix, throughout this
-- file) only removes the PUBLIC entry — it does not touch those two
-- already-granted role-specific entries. Confirmed by inspecting
-- pg_proc.proacl on a real local instance: every SECURITY DEFINER helper
-- from Phase 2 (is_family_member, is_family_owner, current_family_ids)
-- still carries `anon=X/postgres` despite its "revoke ... from public;
-- grant ... to authenticated" statements.
--
-- For those three this was harmless in practice (auth.uid() is null for
-- anon, so every one of them safely returns false/empty) but was never the
-- intended grant — closed here for defense in depth. For two of this file's
-- own new RPCs it was not harmless: get_family_invitation_preview has no
-- internal auth check (by design — the preview doesn't need to know who is
-- asking), so anon could preview any guessed/leaked token with zero
-- authentication; decline_family_invitation likewise never checks auth.uid()
-- (declining doesn't need to), so anon could decline someone else's pending
-- invitation as a griefing vector. Every `revoke all ... from public` below
-- is therefore `revoke all ... from public, anon` instead, and the three
-- Phase 2 helpers get the same revoke here. See docs/DECISIONS.md.
revoke all on function public.is_family_member(uuid, uuid) from anon;
revoke all on function public.is_family_owner(uuid, uuid) from anon;
revoke all on function public.current_family_ids() from anon;

-- ---------------------------------------------------------------------------
-- family_invitations: add hashed-token support
-- ---------------------------------------------------------------------------
-- The raw token is generated inside create_family_invitation, returned to
-- the caller exactly once (to build the deep link), and never stored or
-- logged anywhere. Only its SHA-256 hash is persisted. Two concatenated
-- gen_random_uuid() values give 244 bits of randomness — plenty for a
-- one-time capability token — without needing the pgcrypto extension
-- (sha256() on bytea is a PostgreSQL core builtin since v13, unlike
-- digest(), which does need pgcrypto).
alter table public.family_invitations
  add column token_hash text;

update public.family_invitations
  set token_hash = encode(sha256(convert_to(id::text, 'utf8')), 'hex')
  where token_hash is null;

alter table public.family_invitations
  alter column token_hash set not null,
  add constraint family_invitations_token_hash_uniq unique (token_hash);

comment on column public.family_invitations.token_hash is
  'SHA-256 hex digest of the one-time invitation token. The raw token is never stored — '
  'see create_family_invitation(). The backfill above only covers pre-existing rows '
  '(none in any real environment yet); it is not a usable token for those rows.';

-- Replace the invitee-by-email direct-access policy with owner-only access.
-- Direct table access to family_invitations is now exclusively for the
-- owner's own "invitations I've sent" list.
drop policy if exists "family_invitations_select_family_or_invitee" on public.family_invitations;
drop policy if exists "family_invitations_owner_manages" on public.family_invitations;

create policy "family_invitations_select_owner_only"
  on public.family_invitations
  for select
  to authenticated
  using (public.is_family_owner(family_id));

-- Column-level SELECT excludes token_hash as defense in depth: nothing in
-- the app ever needs to read it back (invitation lookups go by token, not
-- by listing), so it is simplest not to expose it at all, even hashed.
revoke select on public.family_invitations from authenticated;
grant select (
  id, family_id, invited_email, invited_by, status, responded_at, expires_at, created_at, updated_at
) on public.family_invitations to authenticated;

-- family_members no longer needs its dead "for all" policy — all writes now
-- go through the RPCs below.
drop policy if exists "family_members_owner_manages_roster" on public.family_members;

-- ---------------------------------------------------------------------------
-- create_family_with_owner: the only way to create a family
-- ---------------------------------------------------------------------------
create function public.create_family_with_owner(p_name text)
returns table (family_id uuid, family_member_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_display_name text;
  v_family_id uuid;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if length(trim(both from coalesce(p_name, ''))) = 0 then
    raise exception 'family name must not be blank' using errcode = '22023';
  end if;

  select p.display_name into v_display_name from public.profiles p where p.id = v_profile_id;

  insert into public.families (name, owner_id, created_by)
  values (trim(both from p_name), v_profile_id, v_profile_id)
  returning id into v_family_id;

  insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
  values (v_family_id, 'adult', 'owner', v_profile_id, coalesce(v_display_name, 'Owner'), v_profile_id)
  returning id into v_member_id;

  return query select v_family_id, v_member_id;
end;
$$;

comment on function public.create_family_with_owner(text) is
  'Atomically creates a family and its single owner family_members row. The only way to '
  'create a family — families/family_members have no direct INSERT grant. See '
  'docs/DECISIONS.md.';

revoke all on function public.create_family_with_owner(text) from public, anon;
grant execute on function public.create_family_with_owner(text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_family_invitation
-- ---------------------------------------------------------------------------
create function public.create_family_invitation(
  p_family_id uuid,
  p_invited_email text,
  p_expires_in_hours integer default 168
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(both from coalesce(p_invited_email, '')));
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_expires_at timestamptz;
begin
  if not public.is_family_owner(p_family_id) then
    raise exception 'only the family owner can send invitations' using errcode = '42501';
  end if;

  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invited_email is not a valid email address' using errcode = '22023';
  end if;

  if p_expires_in_hours is null or p_expires_in_hours <= 0 or p_expires_in_hours > 24 * 30 then
    raise exception 'p_expires_in_hours must be between 1 and 720' using errcode = '22023';
  end if;

  -- Superseding an existing pending invitation to the same email keeps the
  -- owner's invitation list free of duplicate live invites for one person.
  update public.family_invitations
    set status = 'revoked', responded_at = now()
    where family_id = p_family_id
      and invited_email = v_email
      and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := encode(sha256(convert_to(v_token, 'utf8')), 'hex');
  v_expires_at := now() + make_interval(hours => p_expires_in_hours);

  insert into public.family_invitations (
    family_id, invited_email, invited_by, token_hash, expires_at, created_by
  ) values (
    p_family_id, v_email, auth.uid(), v_token_hash, v_expires_at, auth.uid()
  )
  returning id into v_invitation_id;

  return query select v_invitation_id, v_token, v_expires_at;
end;
$$;

comment on function public.create_family_invitation(uuid, text, integer) is
  'Owner-only. Generates a one-time invitation token, stores only its hash, and returns '
  'the raw token exactly once for the caller to build a deep link / Share sheet payload. '
  'Never logs or persists the raw token.';

revoke all on function public.create_family_invitation(uuid, text, integer) from public, anon;
grant execute on function public.create_family_invitation(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_family_invitation_preview: the only way anyone but the owner learns
-- anything about an invitation
-- ---------------------------------------------------------------------------
create function public.get_family_invitation_preview(p_token text)
returns table (
  family_name text,
  invited_by_display_name text,
  status text,
  expires_at timestamptz,
  is_valid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
begin
  return query
  select
    f.name,
    p.display_name,
    fi.status,
    fi.expires_at,
    (fi.status = 'pending' and fi.expires_at > now())
  from public.family_invitations fi
  join public.families f on f.id = fi.family_id
  join public.profiles p on p.id = fi.invited_by
  where fi.token_hash = v_token_hash;
end;
$$;

comment on function public.get_family_invitation_preview(text) is
  'Sanitized preview for an invitation recipient: family name, inviter display name, and '
  'validity — never a member list, never an email address, never the token or its hash. '
  'Returns zero rows for an unknown token (never an error), so an invalid/guessed token '
  'is indistinguishable from a valid-but-expired one at this layer.';

revoke all on function public.get_family_invitation_preview(text) from public, anon;
grant execute on function public.get_family_invitation_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_family_invitation
-- ---------------------------------------------------------------------------
create function public.accept_family_invitation(p_token text)
returns table (family_id uuid, family_member_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  v_invitation record;
  v_profile_id uuid := auth.uid();
  v_display_name text;
  v_member_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.family_invitations
  where token_hash = v_token_hash
  for update;

  if not found or v_invitation.status <> 'pending' or v_invitation.expires_at <= now() then
    raise exception 'invitation is not valid' using errcode = '22023';
  end if;

  if public.is_family_member(v_invitation.family_id, v_profile_id) then
    raise exception 'already a member of this family' using errcode = '23505';
  end if;

  select p.display_name into v_display_name from public.profiles p where p.id = v_profile_id;

  insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
  values (v_invitation.family_id, 'adult', 'adult', v_profile_id, coalesce(v_display_name, 'Family member'), v_profile_id)
  returning id into v_member_id;

  update public.family_invitations
    set status = 'accepted', responded_at = now()
    where id = v_invitation.id;

  return query select v_invitation.family_id, v_member_id;
end;
$$;

comment on function public.accept_family_invitation(text) is
  'Validated purely by token possession + pending status + not-expired — invitations are '
  'shared by link/Share/copy, not addressed to a verified email, so acceptance never '
  'checks the caller''s email against invited_email. Row-locked (FOR UPDATE) so two '
  'concurrent accepts of the same token cannot both succeed.';

revoke all on function public.accept_family_invitation(text) from public, anon;
grant execute on function public.accept_family_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- decline_family_invitation
-- ---------------------------------------------------------------------------
create function public.decline_family_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  v_updated integer;
begin
  update public.family_invitations
    set status = 'declined', responded_at = now()
    where token_hash = v_token_hash
      and status = 'pending'
      and expires_at > now();

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'invitation is not valid' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.decline_family_invitation(text) from public, anon;
grant execute on function public.decline_family_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_family_invitation
-- ---------------------------------------------------------------------------
create function public.revoke_family_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_updated integer;
begin
  select family_id into v_family_id from public.family_invitations where id = p_invitation_id;

  if v_family_id is null or not public.is_family_owner(v_family_id) then
    raise exception 'only the family owner can revoke this invitation' using errcode = '42501';
  end if;

  update public.family_invitations
    set status = 'revoked', responded_at = now()
    where id = p_invitation_id
      and status = 'pending';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'invitation is not pending' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.revoke_family_invitation(uuid) from public, anon;
grant execute on function public.revoke_family_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_child_profile / update_child_profile: adult-or-owner managed,
-- minimal fields only, never a profile_id (children are unlinked this phase)
-- ---------------------------------------------------------------------------
create function public.create_child_profile(
  p_family_id uuid,
  p_display_name text,
  p_date_of_birth date default null,
  p_avatar_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  if not public.is_family_member(p_family_id) then
    raise exception 'only a family member can add a child profile' using errcode = '42501';
  end if;

  if length(trim(both from coalesce(p_display_name, ''))) = 0 then
    raise exception 'display_name must not be blank' using errcode = '22023';
  end if;

  if p_date_of_birth is not null and p_date_of_birth > current_date then
    raise exception 'date_of_birth cannot be in the future' using errcode = '22023';
  end if;

  insert into public.family_members (
    family_id, member_type, role, profile_id, display_name, date_of_birth, avatar_url, created_by
  ) values (
    p_family_id, 'child', 'child', null, trim(both from p_display_name), p_date_of_birth, p_avatar_url, auth.uid()
  )
  returning id into v_member_id;

  return v_member_id;
end;
$$;

comment on function public.create_child_profile(uuid, text, date, text) is
  'Any adult member (owner or adult role) may add a child profile. Minimal fields only — '
  'no sensitive data is ever collected for a child. Children are never linked to a '
  'profile_id this phase, so they cannot be independently discovered or contacted.';

revoke all on function public.create_child_profile(uuid, text, date, text) from public, anon;
grant execute on function public.create_child_profile(uuid, text, date, text) to authenticated;

create function public.update_child_profile(
  p_member_id uuid,
  p_display_name text default null,
  p_date_of_birth date default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_member_type text;
begin
  select family_id, member_type into v_family_id, v_member_type
  from public.family_members
  where id = p_member_id;

  if v_family_id is null or v_member_type <> 'child' then
    raise exception 'no such child profile' using errcode = '22023';
  end if;

  if not public.is_family_member(v_family_id) then
    raise exception 'only a family member can edit this child profile' using errcode = '42501';
  end if;

  if p_date_of_birth is not null and p_date_of_birth > current_date then
    raise exception 'date_of_birth cannot be in the future' using errcode = '22023';
  end if;

  update public.family_members
    set display_name = coalesce(nullif(trim(both from p_display_name), ''), display_name),
        date_of_birth = coalesce(p_date_of_birth, date_of_birth),
        avatar_url = case when p_clear_avatar then null else coalesce(p_avatar_url, avatar_url) end
    where id = p_member_id;
end;
$$;

revoke all on function public.update_child_profile(uuid, text, date, text, boolean) from public, anon;
grant execute on function public.update_child_profile(uuid, text, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_family_member: owner-only, owner-orphan-safe
-- ---------------------------------------------------------------------------
create function public.remove_family_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_role text;
begin
  select family_id, role into v_family_id, v_role
  from public.family_members
  where id = p_member_id;

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

  delete from public.family_members where id = p_member_id;
end;
$$;

comment on function public.remove_family_member(uuid) is
  'Owner-only, and refuses to ever remove the owner row itself — this is the DB-level '
  'guard against creating an ownerless family. Ownership transfer and "owner leaves the '
  'family" are intentionally out of scope this phase — see docs/ROADMAP.md.';

revoke all on function public.remove_family_member(uuid) from public, anon;
grant execute on function public.remove_family_member(uuid) to authenticated;
