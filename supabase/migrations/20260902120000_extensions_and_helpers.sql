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

revoke all on function public.current_profile_id() from public;
grant execute on function public.current_profile_id() to authenticated, anon;

-- The family-membership anti-recursion helpers (is_family_member,
-- is_family_owner, current_family_ids) live in
-- 20260902120200_families_and_members.sql instead of here, right after
-- the family_members table they query — PostgreSQL resolves table
-- references inside a LANGUAGE SQL function body at CREATE FUNCTION time
-- (confirmed against a real local Postgres instance: defining them here,
-- before family_members exists, fails with "relation ... does not exist"),
-- so they cannot be defined before their table exists.
