-- Phase 6: durable transactional outbox for shared-family-task assignment
-- push notifications. See docs/DECISIONS.md, "Phase 6" for the full design
-- rationale; summarized here.
--
-- Audit of the existing notification_tokens table (Phase 2,
-- supabase/migrations/20260902120700_notification_tokens.sql), before
-- designing anything new: owner-only RLS (force RLS + explicit revoke +
-- narrow grant, the established pattern), direct client CRUD (no RPC layer
-- — safe because every row is already scoped to profile_id = auth.uid()),
-- unique(expo_push_token) across ALL users (a push token identifies a
-- device+install, not a user). Extended here with `deactivated_at`
-- (nullable timestamptz, matching the completed_at/deleted_at/removed_at
-- "presence = state" convention already used everywhere else in this
-- schema) rather than replaced — nothing about it was wrong, it just never
-- had a lifecycle beyond "exists."
--
-- Outbox/delivery tables live in a NEW, non-public `notifications` schema,
-- not `public` — supabase/config.toml's `[api] schemas` is `["public",
-- "graphql_public"]` (confirmed by reading the file), so anything in
-- `notifications` gets no PostgREST endpoint at all, on top of the usual
-- revoke/RLS belt-and-suspenders. Only SECURITY DEFINER functions owned by
-- `postgres` (this migration's role) and the Edge Function's service_role
-- connection (which bypasses grants/RLS entirely, same as
-- scripts/e2e-backend.sh already relies on) can reach these tables.
--
-- The enqueue step is a second AFTER INSERT trigger on task_assignments,
-- alongside the existing apply_task_assignment_action (Phase 2) — not
-- folded into the RPCs (assign_family_task, take_family_task, etc.)
-- themselves, so every current and future way of inserting a
-- task_assignments row gets notification coverage automatically, and the
-- recipient-derivation logic lives in exactly one place. This is what
-- satisfies "notification outbox row in the same transaction" — it is a
-- plain local INSERT inside the same trigger chain as the assignment
-- mutation, never a network call.

-- ---------------------------------------------------------------------------
-- notification_tokens: add a lifecycle
-- ---------------------------------------------------------------------------
alter table public.notification_tokens add column deactivated_at timestamptz;

comment on column public.notification_tokens.deactivated_at is
  'Nullable — presence means this token is no longer used for delivery (logout, '
  'DeviceNotRegistered from Expo, or superseded by a newer registration for the same '
  'device). Rows are never deleted, so delivery history stays traceable.';

-- register_notification_token: SECURITY DEFINER rather than a plain client
-- upsert, because a push token identifies a *device*, not a permanently-
-- owned row. Two real scenarios a plain `insert ... on conflict
-- (expo_push_token) do update` cannot handle under RLS: (1) the same
-- physical device is later used to sign in as a different profile (shared
-- device, or reinstall+different account) — the existing row is owned by
-- the *previous* profile, so RLS's `using (profile_id = auth.uid())` hides
-- it from the new caller entirely, and the unique constraint on
-- expo_push_token then rejects a plain INSERT outright; (2) a token that
-- was deactivated (logout) needs reactivating on next sign-in. This
-- function deliberately reassigns the token to the calling profile in
-- either case — a device belongs to whoever is currently signed into it,
-- and doing this here means a stale previous-account registration on a
-- reused device stops being deliverable the moment someone else claims it,
-- which is the safe default, not an edge case to special-case around.
create function public.register_notification_token(
  p_expo_push_token text,
  p_device_platform text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_token_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_device_platform not in ('ios', 'android') then
    raise exception 'unsupported device platform' using errcode = '22023';
  end if;

  if p_expo_push_token is null or length(trim(both from p_expo_push_token)) = 0 then
    raise exception 'expo_push_token is required' using errcode = '22023';
  end if;

  insert into public.notification_tokens (profile_id, expo_push_token, device_platform, last_seen_at, deactivated_at)
  values (v_profile_id, p_expo_push_token, p_device_platform, now(), null)
  on conflict (expo_push_token) do update set
    profile_id = excluded.profile_id,
    device_platform = excluded.device_platform,
    last_seen_at = now(),
    deactivated_at = null
  returning id into v_token_id;

  return v_token_id;
end;
$$;

comment on function public.register_notification_token(text, text) is
  'Idempotent upsert on expo_push_token, always reassigning the row to the caller and '
  'clearing deactivated_at — a push token belongs to whoever is currently signed in on '
  'that device, not permanently to its first registrant. See the migration header for why '
  'this cannot be a plain client-side upsert under RLS.';

revoke all on function public.register_notification_token(text, text) from public, anon;
grant execute on function public.register_notification_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- notification_preferences: one row per profile, lazily created. A missing
-- row means "default enabled" everywhere this is read (see
-- notification_preference_enabled below) so there is no migration/backfill
-- step needed for existing profiles.
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  assignment_notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'One row per profile, created lazily on first write. Owner-only. A missing row means '
  '"all defaults enabled" — read through notification_preference_enabled(), never assume a '
  'row exists.';

create trigger set_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row
  execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
revoke all on public.notification_preferences from anon, authenticated;

create policy "notification_preferences_owner_only"
  on public.notification_preferences
  for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update on public.notification_preferences to authenticated;

create function public.notification_preference_enabled(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select np.assignment_notifications_enabled
     from public.notification_preferences np
     where np.profile_id = p_profile_id),
    true
  );
$$;

comment on function public.notification_preference_enabled(uuid) is
  'true if p_profile_id wants assignment notifications - defaults true when no preference '
  'row exists yet (opt-out, not opt-in, matching "database preference defaults may be '
  'enabled" from the brief; delivery is still gated on OS permission + a registered token, '
  'which this function knows nothing about).';

revoke all on function public.notification_preference_enabled(uuid) from public, anon;
grant execute on function public.notification_preference_enabled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- notifications schema: private. Not in supabase/config.toml's [api]
-- schemas list, so PostgREST exposes no endpoint here regardless of grants
-- — confirmed by reading that file before writing this. Grants/RLS below
-- are still explicit belt-and-suspenders, not relied on alone (same
-- discipline as every other SECURITY DEFINER surface in this codebase).
-- ---------------------------------------------------------------------------
create schema notifications;
revoke all on schema notifications from public, anon, authenticated;

create table notifications.outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_type text not null
    check (event_type in (
      'family_task.assignment_requested.v1',
      'family_task.assignment_accepted.v1',
      'family_task.assignment_declined.v1',
      'family_task.assignment_taken.v1'
    )),
  family_id uuid not null references public.families (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  task_assignment_id uuid references public.task_assignments (id) on delete set null,
  actor_member_id uuid not null references public.family_members (id),
  recipient_member_id uuid not null references public.family_members (id),
  -- Minimal, versioned, privacy-safe navigation payload — schemaVersion,
  -- eventType, familyId, taskId only. Never a title/description/name; see
  -- docs/SECURITY_AND_PRIVACY.md, Mechanism 4.
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table notifications.outbox is
  'One row per logical notification event, written in the same transaction as the '
  'triggering task_assignments insert (see enqueue_task_assignment_notification below). '
  'idempotency_key is derived from task_assignments.id, so replaying the RPC that produced '
  'that row can never duplicate the logical event (a real replay either fails the '
  'assignment state machine''s own validation or produces a genuinely new '
  'task_assignments row, which is a new logical event by construction) and re-processing '
  'this same outbox row (a retried webhook/worker invocation) is a plain unique-constraint '
  'no-op via ON CONFLICT DO NOTHING at insert time. Never queried or written by any '
  'client role - service_role (the Edge Function) and this schema''s own SECURITY DEFINER '
  'functions only.';

create index outbox_pending_idx on notifications.outbox (next_attempt_at)
  where status = 'pending';
create index outbox_family_id_idx on notifications.outbox (family_id);
create index outbox_recipient_member_id_idx on notifications.outbox (recipient_member_id);

create trigger set_outbox_updated_at
  before update on notifications.outbox
  for each row
  execute function public.set_updated_at();

alter table notifications.outbox enable row level security;
alter table notifications.outbox force row level security;
revoke all on notifications.outbox from public, anon, authenticated;
-- Deliberately no policy at all: force row level security + zero grants
-- means even a hypothetical future grant to `authenticated` would still
-- see zero rows (no permissive policy exists to allow any). This mirrors
-- set_task_assignment's "revoke from every role, no exceptions" pattern.

create table notifications.deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references notifications.outbox (id) on delete cascade,
  notification_token_id uuid not null references public.notification_tokens (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'ticket_ok', 'ticket_error', 'receipt_ok', 'receipt_error', 'permanent_failure')),
  expo_ticket_id text,
  expo_receipt_status text,
  error_code text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deliveries_unique_outbox_token unique (outbox_id, notification_token_id)
);

comment on table notifications.deliveries is
  'Per-device delivery tracking - one outbox event fans out to one row per active '
  'notification_token the recipient has at claim time. error_code is Expo''s own ticket/'
  'receipt error code (e.g. DeviceNotRegistered, MessageTooBig), used to classify '
  'retryable vs. permanent and to deactivate invalid tokens. Never contains the raw push '
  'token itself or any secret.';

create index deliveries_outbox_id_idx on notifications.deliveries (outbox_id);
create index deliveries_pending_ticket_idx on notifications.deliveries (status)
  where status = 'ticket_ok';

create trigger set_deliveries_updated_at
  before update on notifications.deliveries
  for each row
  execute function public.set_updated_at();

alter table notifications.deliveries enable row level security;
alter table notifications.deliveries force row level security;
revoke all on notifications.deliveries from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enqueue_task_assignment_notification: the outbox writer. Fires for every
-- task_assignments insert, alongside the pre-existing
-- apply_task_assignment_action trigger (Phase 2) - same table, same event,
-- deliberately a second trigger rather than merged into that one, so the
-- "update the tasks snapshot" and "decide whether to notify someone"
-- concerns stay independently readable and testable.
-- ---------------------------------------------------------------------------
create function notifications.enqueue_task_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, notifications
as $$
declare
  v_event_type text;
  v_actor_member_id uuid;
  v_recipient_member_id uuid;
  v_recipient_profile_id uuid;
  v_recipient_removed_at timestamptz;
  v_preference_enabled boolean;
  v_idempotency_key text;
begin
  -- Only the four events the brief asks for this phase. 'unassigned' rows
  -- (manual unassign, decline's own resolution is recorded as 'declined'
  -- not 'unassigned', and member-removal's cross-task resolution) never
  -- notify - explicitly out of scope.
  if new.action = 'assigned' or new.action = 'reassigned' then
    v_event_type := 'family_task.assignment_requested.v1';
    v_actor_member_id := new.assigned_by_member_id;
    v_recipient_member_id := new.assigned_to_member_id;
  elsif new.action = 'took' then
    v_event_type := 'family_task.assignment_taken.v1';
    v_actor_member_id := new.assigned_to_member_id;
    -- Recipient is the task's creator, resolved to their family_members
    -- row in this family - not assigned_by_member_id, which is always
    -- null for a self-claim.
    select fm.id into v_recipient_member_id
    from public.tasks t
    join public.family_members fm
      on fm.family_id = t.family_id
     and fm.profile_id = t.owner_profile_id
     and fm.removed_at is null
    where t.id = new.task_id;
  elsif new.action = 'accepted' or new.action = 'declined' then
    v_event_type := case new.action
      when 'accepted' then 'family_task.assignment_accepted.v1'
      when 'declined' then 'family_task.assignment_declined.v1'
    end;
    v_actor_member_id := new.assigned_to_member_id;
    -- Recipient is whoever most recently assigned/reassigned this task -
    -- not on this row itself (accept/decline's own assigned_by_member_id
    -- is always null, since the assignee performs those, not an
    -- assigner). Excluding new.id (not a time comparison) is the safe
    -- tiebreaker even if two rows share a created_at timestamp.
    select ta.assigned_by_member_id into v_recipient_member_id
    from public.task_assignments ta
    where ta.task_id = new.task_id
      and ta.action in ('assigned', 'reassigned')
      and ta.id <> new.id
    order by ta.created_at desc, ta.id desc
    limit 1;
  else
    return new;
  end if;

  -- No recipient resolved (e.g. a removed creator for 'took'; should not
  -- happen for 'assigned'/'reassigned'/'accepted'/'declined' given the
  -- state machine, but never assume), or self-notification (assigning to
  -- or self-claiming your own task, or - defensively, in case a future
  -- change ever produces this - a resolved recipient that happens to be
  -- the same member as the actor).
  if v_recipient_member_id is null or v_recipient_member_id = v_actor_member_id then
    return new;
  end if;

  select fm.profile_id, fm.removed_at
    into v_recipient_profile_id, v_recipient_removed_at
  from public.family_members fm
  where fm.id = v_recipient_member_id;

  -- Recipient is no longer a current member of this family (removed
  -- between the original assignment and this action, or the 'took'
  -- creator lookup above already excluded removed rows and found none).
  if v_recipient_profile_id is null or v_recipient_removed_at is not null then
    return new;
  end if;

  if not public.notification_preference_enabled(v_recipient_profile_id) then
    return new;
  end if;

  v_idempotency_key := 'task_assignment:' || new.id::text;

  insert into notifications.outbox (
    idempotency_key, event_type, family_id, task_id, task_assignment_id,
    actor_member_id, recipient_member_id, payload
  )
  values (
    v_idempotency_key,
    v_event_type,
    new.family_id,
    new.task_id,
    new.id,
    v_actor_member_id,
    v_recipient_member_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'eventType', v_event_type,
      'familyId', new.family_id,
      'taskId', new.task_id
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

comment on function notifications.enqueue_task_assignment_notification() is
  'Derives event_type/actor/recipient entirely from authoritative database state - never '
  'from anything the client submitted - and enqueues at most one notifications.outbox row '
  'per task_assignments row, in the same transaction. Skips silently (never raises) for '
  'self-actions, removed recipients, and disabled preferences, so a notification-side '
  'decision can never fail the underlying assignment mutation. See docs/DECISIONS.md, '
  '"Phase 6" for the full event/recipient mapping table.';

create trigger task_assignments_enqueue_notification
  after insert on public.task_assignments
  for each row
  execute function notifications.enqueue_task_assignment_notification();

-- A `returns trigger` function isn't directly callable via SQL in any
-- useful way (Postgres rejects "trigger functions can only be called as
-- triggers" outside a trigger context), but the brief's own rule is
-- unconditional - every SECURITY DEFINER function gets an explicit revoke,
-- no exceptions reasoned around. Confirmed via pg_proc.proacl (same
-- verification method as the Phase 3 finding this rule exists because of)
-- that Supabase's role bootstrap had granted EXECUTE to both anon and
-- authenticated here by default, same as every function in this codebase
-- unless explicitly revoked.
revoke all on function notifications.enqueue_task_assignment_notification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal worker-facing functions - never granted to anon/authenticated.
-- Called from the Edge Function over its service_role connection, which
-- bypasses grants/RLS entirely (same trust boundary
-- scripts/e2e-backend.sh already relies on for local verification) - these
-- exist for atomicity (claim) and to keep the retry/backoff/deactivation
-- arithmetic in one reviewable place rather than duplicated per caller.
-- ---------------------------------------------------------------------------

-- Atomically claims up to p_limit pending, due outbox rows for this
-- worker. FOR UPDATE SKIP LOCKED is the standard safe-concurrent-worker
-- pattern: a second worker calling this concurrently never blocks on rows
-- the first already claimed, and never re-claims them either.
create function notifications.claim_pending_outbox(p_worker_id text, p_limit integer default 20)
returns setof notifications.outbox
language plpgsql
security definer
set search_path = public, notifications
as $$
begin
  return query
    update notifications.outbox o
    set status = 'processing', claimed_at = now(), claimed_by = p_worker_id, attempts = o.attempts + 1
    where o.id in (
      select id from notifications.outbox
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit p_limit
      for update skip locked
    )
    returning o.*;
end;
$$;

revoke all on function notifications.claim_pending_outbox(text, integer) from public, anon, authenticated;

-- Bounded exponential backoff: 1m, 2m, 4m, 8m, 16m, capped at 30m: matches
-- "bounded retry with backoff" - never an unbounded/immediate-retry loop.
create function notifications.backoff_interval(p_attempts integer)
returns interval
language sql
immutable
as $$
  select least(30, power(2, greatest(p_attempts - 1, 0))::int) * interval '1 minute';
$$;

revoke all on function notifications.backoff_interval(integer) from public, anon, authenticated;

-- Records the outcome of a claimed outbox row. p_status is the outbox's
-- own next status: 'sent' (all deliveries dispatched, tickets requested
-- successfully - receipt processing is separate and does not change this),
-- 'pending' (a retryable failure - attempts/backoff already reflected via
-- claim_pending_outbox's own increment, this just reschedules),
-- 'failed' (explicit permanent failure - e.g. zero active tokens found, or
-- attempts exhausted), 'skipped' (recipient became ineligible between
-- enqueue and claim - not a failure).
create function notifications.finish_outbox_attempt(
  p_outbox_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, notifications
as $$
declare
  v_attempts integer;
begin
  if p_status not in ('sent', 'pending', 'failed', 'skipped') then
    raise exception 'invalid outbox status %', p_status using errcode = '22023';
  end if;

  select attempts into v_attempts from notifications.outbox where id = p_outbox_id;

  update notifications.outbox
  set
    status = p_status,
    last_error = p_error,
    next_attempt_at = case
      when p_status = 'pending' then now() + notifications.backoff_interval(v_attempts)
      else next_attempt_at
    end,
    claimed_at = null,
    claimed_by = null
  where id = p_outbox_id;
end;
$$;

revoke all on function notifications.finish_outbox_attempt(uuid, text, text) from public, anon, authenticated;

-- Deactivates a token (e.g. Expo's DeviceNotRegistered) - idempotent.
create function notifications.deactivate_notification_token(p_token_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_tokens
  set deactivated_at = now()
  where id = p_token_id and deactivated_at is null;
$$;

revoke all on function notifications.deactivate_notification_token(uuid) from public, anon, authenticated;
