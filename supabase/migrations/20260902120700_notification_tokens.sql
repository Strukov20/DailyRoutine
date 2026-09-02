-- notification_tokens: Expo push tokens, owner-only. See docs/DATA_MODEL.md.

create table public.notification_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null,
  device_platform text not null check (device_platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_tokens_unique_token unique (expo_push_token)
);

comment on table public.notification_tokens is
  'One row per installed device. Owner-only — never exposed to any other user, including '
  'family members. See docs/SECURITY_AND_PRIVACY.md.';

create trigger set_notification_tokens_updated_at
  before update on public.notification_tokens
  for each row
  execute function public.set_updated_at();

create index notification_tokens_profile_id_idx on public.notification_tokens (profile_id);

alter table public.notification_tokens enable row level security;
alter table public.notification_tokens force row level security;
revoke all on public.notification_tokens from anon, authenticated;

create policy "notification_tokens_owner_only"
  on public.notification_tokens
  for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update, delete on public.notification_tokens to authenticated;
