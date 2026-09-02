-- Extensions and shared helper functions used by every later migration.
--
-- gen_random_uuid() is a PostgreSQL core builtin since v17 (this project's target,
-- see supabase/config.toml [db].major_version) — no pgcrypto/uuid-ossp extension needed.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
-- Every mutable table (see docs/DATA_MODEL.md, "Audit-relevant timestamps and
-- actors") gets created_at/updated_at/created_by. updated_at must never be
-- writable by clients — it is maintained exclusively by this trigger.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at with now(). Attach to every mutable table.';

-- ---------------------------------------------------------------------------
-- Family-membership helpers (anti-recursion pattern for RLS)
-- ---------------------------------------------------------------------------
-- family_members' own RLS policies need to answer "is the current user a
-- member of family X?" — but a policy on family_members that subqueries
-- family_members directly recurses infinitely when Postgres evaluates it.
--
-- The fix: SECURITY DEFINER functions owned by the migration role (postgres,
-- which owns every table it creates) bypass RLS on tables that role owns when
-- executing their own internal queries. A SECURITY DEFINER function can
-- therefore safely query family_members from *inside* a family_members (or
-- any other) RLS policy without recursing. This is the standard Supabase
-- pattern for this problem — see docs/SECURITY_AND_PRIVACY.md and
-- docs/DECISIONS.md, "RLS anti-recursion helpers".
--
-- `stable` (not `immutable`) because the result depends on table contents,
-- not just arguments — lets Postgres cache the result once per statement
-- without allowing it to be folded away entirely.

create function public.current_profile_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid();
$$;

comment on function public.current_profile_id() is
  'The authenticated caller''s profile id (== auth.uid()). Thin wrapper for readability in policies.';

create function public.is_family_member(p_family_id uuid, p_profile_id uuid default auth.uid())
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
  );
$$;

comment on function public.is_family_member(uuid, uuid) is
  'True if p_profile_id (default: caller) is any member (adult or linked child) of p_family_id. '
  'SECURITY DEFINER to avoid recursive RLS — see comment above.';

create function public.is_family_owner(p_family_id uuid, p_profile_id uuid default auth.uid())
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
  );
$$;

comment on function public.is_family_owner(uuid, uuid) is
  'True if p_profile_id (default: caller) is the owner of p_family_id.';

create function public.current_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select fm.family_id
  from public.family_members fm
  where fm.profile_id = auth.uid();
$$;

comment on function public.current_family_ids() is
  'All family_id values the caller is an adult member of. Use as '
  '`family_id in (select public.current_family_ids())` in RLS policies instead of joining '
  'family_members directly, to avoid recursive policy evaluation.';

-- These are policy-support functions, not part of the public API surface —
-- lock them down to the two roles PostgREST actually authenticates as.
revoke all on function public.current_profile_id() from public;
revoke all on function public.is_family_member(uuid, uuid) from public;
revoke all on function public.is_family_owner(uuid, uuid) from public;
revoke all on function public.current_family_ids() from public;

grant execute on function public.current_profile_id() to authenticated, anon;
grant execute on function public.is_family_member(uuid, uuid) to authenticated;
grant execute on function public.is_family_owner(uuid, uuid) to authenticated;
grant execute on function public.current_family_ids() to authenticated;
