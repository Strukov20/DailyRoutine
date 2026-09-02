-- profiles: one row per authenticated user, 1:1 with auth.users.
-- See docs/DATA_MODEL.md, "profiles".

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'uk')),
  preferred_color_scheme text not null default 'system'
    check (preferred_color_scheme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. id == auth.users.id (not a separately generated key).';

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile for every new auth.users row
-- ---------------------------------------------------------------------------
-- Per docs/DECISIONS.md: minimal, idempotent, fixed search_path, never trusts
-- user-supplied metadata for anything authorization-relevant (display_name is
-- cosmetic only), fails safe (a malformed display_name falls back to a safe
-- default rather than blocking sign-up).
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := nullif(trim(both from (new.raw_user_meta_data ->> 'display_name')), '');

  insert into public.profiles (id, display_name)
  values (new.id, coalesce(v_display_name, split_part(new.email, '@', 1), 'New user'))
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Idempotently creates a profiles row for every new auth.users row. display_name is '
  'sourced from user-supplied signup metadata but is purely cosmetic — it is never used '
  'for any authorization decision, so trusting client-supplied metadata here is safe.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on public.profiles from anon, authenticated;

-- A user can read their own profile in full. Other family members read only
-- the sanitized (display_name, avatar_url) projection exposed via
-- family_members — never the full profiles row of someone else. See
-- docs/DATA_MODEL.md, "Ownership and authorization summary".
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- Users may edit their own display name / avatar / preferences — never `id`
-- (immutable, it's the PK and == auth.users.id, which Postgres already
-- prevents changing via the primary key's implicit uniqueness + FK — but the
-- WITH CHECK below makes the intent explicit and would catch any future
-- column added without matching review).
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, insert, update on public.profiles to authenticated;
