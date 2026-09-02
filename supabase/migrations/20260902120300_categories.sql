-- categories: system defaults (family_id null) + family-scoped custom ones.
-- See docs/DATA_MODEL.md, "categories".

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  name text not null check (length(trim(both from name)) > 0),
  -- References a token key in src/theme/tokens.ts's categoryColors, never a
  -- raw hex value (see docs/ARCHITECTURE.md) — enforced client-side by the
  -- theme module; the DB only guarantees non-empty.
  color_token text not null check (length(trim(both from color_token)) > 0),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),

  constraint categories_system_has_no_family check (
    (is_system and family_id is null) or (not is_system and family_id is not null)
  ),
  constraint categories_system_has_no_creator check (
    not (is_system and created_by is not null)
  )
);

comment on table public.categories is
  'System defaults (is_system, family_id null) plus family-scoped custom categories. '
  'Personal (non-family) custom categories are deferred — see docs/DATA_MODEL.md.';

create trigger set_categories_updated_at
  before update on public.categories
  for each row
  execute function public.set_updated_at();

create unique index categories_unique_name_per_scope
  on public.categories (coalesce(family_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create index categories_family_id_idx on public.categories (family_id)
  where family_id is not null;

alter table public.categories enable row level security;
alter table public.categories force row level security;
revoke all on public.categories from anon, authenticated;

-- System categories are readable by anyone authenticated; family categories
-- only by that family's members.
create policy "categories_select_system_or_family"
  on public.categories
  for select
  to authenticated
  using (is_system or public.is_family_member(family_id));

create policy "categories_family_owner_manages_custom"
  on public.categories
  for all
  to authenticated
  using (not is_system and public.is_family_owner(family_id))
  with check (not is_system and public.is_family_owner(family_id));

grant select on public.categories to authenticated;
