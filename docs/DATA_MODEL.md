# Data Model

Status: **implemented** in `supabase/migrations/` (Phase 2), against a local Supabase
project only — no hosted/production project is connected. This document is the normative
description; the migrations are the source of truth for exact syntax. See
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for the RLS design layered on top of it,
and [DECISIONS.md](DECISIONS.md) ("Phase 2" section) for schema refinements made during
implementation that go beyond what's described below.

Naming: tables are `snake_case`, plural. Every table has `id uuid primary key default
gen_random_uuid()` unless noted. Every mutable table has the audit columns described at the
bottom of this document.

## Implementation refinements beyond this document's original design

Made while writing `supabase/migrations/`, each documented in full in
[DECISIONS.md](DECISIONS.md):

- **Denormalized `family_id`** added to `task_assignments`, `event_participants`, and
  `responsibilities` (auto-populated from the parent row by a trigger, never client-writable)
  — not present in the original table lists below, added to enable a composite-FK "same
  family" integrity check and non-recursive RLS.
- **`timezone` columns** added to `events` (`NOT NULL`), `tasks` (nullable, required when
  `start_time` is set), and `recurrence_rules` (`NOT NULL`) — needed to resolve
  `date`/`start_time` into an unambiguous instant and to compute recurrence across DST.
- **No native Postgres `ENUM` types** — every status/type/role column below is `text` with a
  `CHECK` constraint instead, for evolvability. See DECISIONS.md.
- **`families.owner_id` consistency** is enforced by a validating trigger + a partial unique
  index on `family_members`, not by a value computed automatically from `family_members` —
  see DECISIONS.md, "Family ownership integrity."

## Entity overview

```text
profiles ──< family_members >── families
   │             │                  │
   │             │                  └──< family_invitations
   │             ├──< responsibilities (assignee)
   │             │
   ├──< tasks ──< task_assignments
   │       │
   │       └──< reminders
   │       └──> recurrence_rules
   │       └──> categories
   │
   ├──< events ──< event_participants
   │       │            │
   │       │            └──> responsibilities (per participant, e.g. drop-off/pickup)
   │       └──> recurrence_rules
   │
   └──< notification_tokens
```

`>` / `<` show the "many" side. A `family_members` row represents a person _in the context of
one family_ — for an adult it links to a `profiles` row; for a child it may not (see below).

## profiles

One row per authenticated user (1:1 with `auth.users`). **Owned by the user.**

| column                   | type | notes                                                                                                                |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                     | uuid | = `auth.users.id`, not a separate generated id                                                                       |
| `display_name`           | text | required                                                                                                             |
| `avatar_url`             | text | nullable                                                                                                             |
| `preferred_language`     | text | `'en' \| 'uk'`, defaults from device locale at signup (see `src/i18n`)                                               |
| `preferred_color_scheme` | text | `'system' \| 'light' \| 'dark'`, mirrors `useUIStore` default, persisted server-side only once the user is signed in |

## families

**Owned by the family** (see "Ownership and authorization" below).

| column     | type                 | notes                                                                                              |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `id`       | uuid                 |                                                                                                    |
| `name`     | text                 | required                                                                                           |
| `owner_id` | uuid → `profiles.id` | the creating adult; ownership can be transferred later (V2), never deleted-with-cascade implicitly |

## family_members

The unified membership table. **Owned by the family.** One row per person (adult or child)
in a given family. This is the "child profiles or unified family-member profiles" decision
point called out in the brief — resolved as: **one table, two shapes**, distinguished by
`member_type`, rather than a separate `children` table. Rationale in
[DECISIONS.md](DECISIONS.md).

| column          | type                           | notes                                                                                                                                                                                                                                    |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid                           |                                                                                                                                                                                                                                          |
| `family_id`     | uuid → `families.id`           | required                                                                                                                                                                                                                                 |
| `member_type`   | text                           | `'adult' \| 'child'`                                                                                                                                                                                                                     |
| `profile_id`    | uuid → `profiles.id`, nullable | **required when `member_type = 'adult'`**; nullable for a child. This nullable FK is the deliberate seam for "a child profile can be linked to a real account in the future" — linking is just setting this column, no migration needed. |
| `role`          | text                           | `'owner' \| 'adult' \| 'child'` — `owner` is a role, not a separate member type, so ownership transfer is a role update, not a row move                                                                                                  |
| `display_name`  | text                           | required; for a child this is the only name on record (no `profiles` row to read it from)                                                                                                                                                |
| `avatar_url`    | text                           | nullable                                                                                                                                                                                                                                 |
| `date_of_birth` | date                           | nullable; child profiles only, optional                                                                                                                                                                                                  |
| `invited_by`    | uuid → `profiles.id`, nullable | who added this member                                                                                                                                                                                                                    |

Constraint (enforced in the migration, not just documented): `member_type = 'adult'` requires
`profile_id is not null`; `member_type = 'child'` requires `profile_id is null OR` a future
verified-link flag — that flag doesn't exist yet and is intentionally deferred.

## family_invitations

**Owned by the family** — direct `SELECT` is owner-only (the family's own "invitations I've
sent" list). Nobody else queries this table directly: an invitee reaches an invitation
exclusively through `get_family_invitation_preview(token)`, a sanitized RPC that returns the
family name, inviter, status, and validity — never a member list, never `invited_email`, never
the token itself. See [DECISIONS.md](DECISIONS.md), "Phase 3", for why (no email provider —
invitations are delivered as a shareable link, not addressed to a verified inbox — so
acceptance is validated by token possession, not by matching the caller's email).

| column          | type                 | notes                                                                                                                   |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid                 |                                                                                                                         |
| `family_id`     | uuid → `families.id` |                                                                                                                         |
| `invited_email` | text                 | the owner's own label for who this was meant for — informational only, never used for access control                    |
| `invited_by`    | uuid → `profiles.id` |                                                                                                                         |
| `token_hash`    | text                 | SHA-256 hex digest of a one-time token; the raw token is never stored, only returned once by `create_family_invitation` |
| `status`        | text                 | `'pending' \| 'accepted' \| 'declined' \| 'expired' \| 'revoked'`                                                       |
| `responded_at`  | timestamptz          | nullable                                                                                                                |
| `expires_at`    | timestamptz          | required — invitations are not open-ended (default 7 days, see `create_family_invitation`)                              |

Mutations are RPC-only: `create_family_invitation` (owner), `get_family_invitation_preview`
(any authenticated user holding the token), `accept_family_invitation` /
`decline_family_invitation` (the token holder), `revoke_family_invitation` (owner). See
`supabase/migrations/20260903120000_family_management.sql`.

## categories

Defaults (Work, Family, Home, Shopping, Health, Other) are seeded as **system categories**
(`family_id IS NULL`, `is_system = true`), readable by everyone, not owned by any one family.
A custom category is **owned by the family** (or, for a purely personal task, could be scoped
by `owner_profile_id` instead — MVP ships family-scoped custom categories only; personal
custom categories are a V2 nice-to-have, not blocked by this schema).

| column        | type                           | notes                                                                               |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `id`          | uuid                           |                                                                                     |
| `family_id`   | uuid → `families.id`, nullable | null = system default                                                               |
| `name`        | text                           | required                                                                            |
| `color_token` | text                           | references a token in `src/theme/tokens.ts`'s `categoryColors`, not a raw hex value |
| `is_system`   | boolean                        | default false                                                                       |

## tasks

**Owned by a user** (personal) **or a family** (shared) — never both; see "Ownership and
authorization." Only `title` is required, matching `src/domain/tasks/schemas.ts`. Every
mutation is RPC-only (`create_personal_task` and friends —
`supabase/migrations/20260904120000_personal_task_management.sql`); `authenticated` has no
direct `INSERT`/`UPDATE`/`DELETE` grant. See [DECISIONS.md, "Phase
4"](DECISIONS.md) for why.

| column               | type                                   | notes                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | uuid                                   |                                                                                                                                                                                                                                        |
| `owner_profile_id`   | uuid → `profiles.id`                   | who created it — never a parameter to any RPC, always the caller                                                                                                                                                                       |
| `family_id`          | uuid → `families.id`, nullable         | null = personal task                                                                                                                                                                                                                   |
| `title`              | text                                   | **required, only mandatory field**                                                                                                                                                                                                     |
| `description`        | text                                   | nullable                                                                                                                                                                                                                               |
| `date`               | date                                   | nullable — null means "Inbox"                                                                                                                                                                                                          |
| `start_time`         | time                                   | nullable — a task can have a date without a time, but not the reverse (`tasks_time_requires_date` CHECK, Phase 4)                                                                                                                      |
| `duration_minutes`   | integer                                | nullable; `1`–`1440` (one day) when set — `tasks_duration_minutes_bounded` CHECK, Phase 4                                                                                                                                              |
| `priority`           | text                                   | `'normal' \| 'important' \| 'critical'` — matches `src/domain/tasks/priority.ts` exactly; that module's ordering logic is the client-side mirror of this column, not a redefinition of it                                              |
| `category_id`        | uuid → `categories.id`, nullable       |                                                                                                                                                                                                                                        |
| `recurrence_rule_id` | uuid → `recurrence_rules.id`, nullable | not settable via any RPC this phase — see "Recurrence" below                                                                                                                                                                           |
| `visibility`         | text                                   | `'private' \| 'family'` — meaningless (ignored) when `family_id IS NULL`                                                                                                                                                               |
| `completed_at`       | timestamptz                            | nullable; presence = completed. Not a boolean, so "when" is never lost. Toggled by `complete_personal_task`/`restore_personal_task`, both idempotent                                                                                   |
| `deleted_at`         | timestamptz                            | nullable; soft delete/archive (Phase 4) — set only by `delete_or_archive_personal_task`, idempotent. Excluded from the owner's own `SELECT` policy and from `family_task_board`, not just filtered client-side; no undelete this phase |
| `assignee_member_id` | uuid → `family_members.id`, nullable   | current assignee, family tasks only — not settable via any personal-task RPC this phase                                                                                                                                                |
| `assignment_status`  | text                                   | `'unassigned' \| 'pending_acceptance' \| 'accepted' \| 'declined'` — see `task_assignments` for the auditable history this field is a snapshot of                                                                                      |

### Recurrence — deliberately not exposed this phase

`recurrence_rules` has zero grants/policies for `authenticated` (see that table's own section
below) and no personal-task RPC accepts a `recurrence_rule_id` parameter — the read/write
surface is fully closed, not just unused by the UI. A correct implementation needs to preserve
completion history per occurrence and prevent duplicate "next occurrence" generation, which the
current schema (one `tasks` row per recurring series, sharing a `recurrence_rule_id`) cannot do
without generating a new task row per occurrence — a schema change, not just new UI. See
[ROADMAP.md](ROADMAP.md) for the concrete proposal.

### Reminders — data layer only, no notification scheduling

`reminders` rows can be created (the table's grants are already safe — see
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)), but nothing in this phase schedules an
actual Expo notification from one. The task editor does not expose reminder controls this
phase, specifically to avoid implying a reminder does anything once saved — see
[ROADMAP.md](ROADMAP.md).

## task_assignments

Append-mostly audit trail. **Owned by the family** the task belongs to. This is what makes
assignment history real instead of inferred from `tasks.assignment_status` alone.

| column                  | type                                 | notes                                                                                            |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `id`                    | uuid                                 |                                                                                                  |
| `task_id`               | uuid → `tasks.id`                    |                                                                                                  |
| `assigned_to_member_id` | uuid → `family_members.id`           |                                                                                                  |
| `assigned_by_member_id` | uuid → `family_members.id`, nullable | null when the action was "Take task" (self-claim) rather than an assignment by someone else      |
| `action`                | text                                 | `'assigned' \| 'took' \| 'accepted' \| 'declined' \| 'unassigned' \| 'reassigned'`               |
| `created_at`            | timestamptz                          | when this action happened — this table has no `updated_at`; rows are never edited, only appended |

## reminders

**Owned by the user** who owns the parent task (family membership does not grant reminder
access to someone else's reminder — a shared task can have per-person reminders).

| column                  | type                 | notes                                                                                                       |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                    | uuid                 |                                                                                                             |
| `task_id`               | uuid → `tasks.id`    |                                                                                                             |
| `profile_id`            | uuid → `profiles.id` | whose reminder this is                                                                                      |
| `remind_at`             | timestamptz          | resolved, absolute time (computed client- or server-side from the task's date/time + an offset at creation) |
| `offset_minutes_before` | integer              | nullable; the authored offset, kept so editing the task's time can recompute `remind_at`                    |
| `delivered_at`          | timestamptz          | nullable; set once `expo-notifications` confirms delivery                                                   |

## recurrence_rules

Shared by tasks and events. **Owned by whatever references it** — no independent ownership
model; RLS is enforced via the referencing row.

| column       | type    | notes                                                                                                 |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| `id`         | uuid    |                                                                                                       |
| `frequency`  | text    | `'daily' \| 'weekly' \| 'monthly'` (MVP set — `RRULE`-style expressiveness is a V2 concern if needed) |
| `interval`   | integer | e.g. every 2 weeks                                                                                    |
| `by_weekday` | int[]   | nullable, ISO weekday numbers                                                                         |
| `until`      | date    | nullable — open-ended if null                                                                         |

Recurrence **generates** task/event instances rather than every instance being a stored row
forever; the exact materialization strategy (generate N ahead vs. generate on read) is an
implementation detail for the MVP build phase, not fixed here.

## events

**Owned by a user** (personal) **or a family** (shared) — same personal/family split as
`tasks`. An event is never a responsibility carrier — see "Responsibilities" below. Writes
are **RPC-only** (Phase 7 — see "Implemented in Phase 7" below); `SELECT` remains direct/
RLS-governed.

| column               | type                                   | notes                                                                                                                      |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid                                    |                                                                                                                             |
| `owner_profile_id`    | uuid → `profiles.id`                    |                                                                                                                             |
| `family_id`           | uuid → `families.id`, nullable          | null = personal event                                                                                                       |
| `title`               | text                                    | required                                                                                                                     |
| `description`         | text                                    | nullable                                                                                                                     |
| `location`            | text                                    | nullable                                                                                                                     |
| `starts_at`           | timestamptz                             | required — an unambiguous instant (UTC internally); see "Timezone handling" below                                            |
| `ends_at`             | timestamptz                             | required; `ends_at > starts_at` enforced at both the RPC and `CHECK`-constraint level                                        |
| `timezone`            | text                                    | required — IANA zone captured at creation/edit time, for correct local rendering and day-boundary queries                    |
| `visibility`          | text                                    | `'private' \| 'family'` — an event with any `responsibilities` row cannot be `'private'` (Phase 7 trigger; see below)         |
| `recurrence_rule_id`  | uuid → `recurrence_rules.id`, nullable  |                                                                                                                             |
| `deleted_at`          | timestamptz                             | nullable (Phase 7) — soft cancel via `cancel_event()`, idempotent, no restore this phase (same convention as `tasks.deleted_at`) |

## event_participants

Who/what the event is _about_ — e.g., "this swimming event is for Son." This is distinct
from responsibility (who has to act). **Owned by the family** the event belongs to (or
implicitly personal if the event has no `family_id`). Writes are RPC-only (Phase 7) — the
MVP `create_child_event` RPC creates exactly one participant row per event (one primary
subject), but the table itself is a proper many-to-many join and does not prevent a future
phase from attaching more.

| column             | type                       | notes                                           |
| ------------------ | -------------------------- | ----------------------------------------------- |
| `id`               | uuid                       |                                                 |
| `event_id`         | uuid → `events.id`         |                                                 |
| `family_member_id` | uuid → `family_members.id` | the person (adult or child) this event concerns |

## responsibilities

**This is the table that encodes the "event ≠ responsibility" rule from
[PRODUCT.md](PRODUCT.md).** A responsibility is a discrete, assignable duty tied to an event,
never a text field on the event itself. Writes are RPC-only (Phase 7); a responsibility can
only be attached to a `visibility = 'family'` event (trigger-enforced — its assignee needs
read access to the event to know about their own duty, the same reasoning as `tasks`'
private+non-owner-assignee constraint).

| column               | type                                 | notes                                                                                     |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `id`                 | uuid                                 |                                                                                           |
| `event_id`           | uuid → `events.id`                   |                                                                                           |
| `type`               | text                                 | e.g. `'drop_off' \| 'pick_up' \| 'supervise' \| 'custom'` — `custom` pairs with a `label` |
| `label`              | text                                 | nullable; required when `type = 'custom'` (e.g., "Bring snacks")                          |
| `assignee_member_id` | uuid → `family_members.id`, nullable | who is on the hook; nullable = unassigned, mirroring `tasks.assignee_member_id`           |
| `status`             | text                                 | `'unassigned' \| 'pending_acceptance' \| 'accepted' \| 'declined' \| 'done'` — the audit history this snapshot derives from is `responsibility_assignments` (below), mirroring `task_assignments` |

Worked example matching PRODUCT.md's swimming scenario: one `events` row ("Swimming",
17:00–18:00) + one `event_participants` row (Son) + two `responsibilities` rows
(`drop_off` → Mom, `pick_up` → Dad). Editing who does pickup never touches the event row —
proven directly: renaming the event or moving its time leaves both responsibility rows'
`assignee_member_id`/`status` completely untouched (`due_at`, exposed via
`family_responsibilities` below, is *derived* from the event's own `starts_at`/`ends_at` at
read time, so it moves automatically with the event without any separate update).

## responsibility_assignments

**Implemented in Phase 7.** Append-only audit trail for responsibility assignment actions —
mirrors `task_assignments` exactly, kept as a separate table (not reused from
`task_assignments`) since a responsibility and a task are different domain concepts with
different owning tables. `responsibilities.assignee_member_id`/`status` are a snapshot
maintained by a trigger reacting to inserts here, the same relationship
`apply_task_assignment_action` has to `task_assignments`.

| column                  | type                                 | notes                                                                                       |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                     | uuid                                  |                                                                                                |
| `responsibility_id`      | uuid → `responsibilities.id`          | `on delete cascade` — see `remove_event_responsibility` below for when that applies             |
| `assigned_to_member_id`  | uuid → `family_members.id`            |                                                                                                |
| `assigned_by_member_id`  | uuid → `family_members.id`, nullable  | null when the action was "Take" (self-claim)                                                    |
| `action`                 | text                                  | `'assigned' \| 'took' \| 'accepted' \| 'declined' \| 'unassigned' \| 'reassigned'`              |
| `created_at`             | timestamptz                           | append-only, no `updated_at`                                                                    |

`SELECT` is granted to `authenticated` (same-family, RLS-scoped) — unlike `notifications.outbox`
(Section "notifications schema" above), this is client-relevant audit history, not internal
dispatcher state, so it follows `task_assignments`' own read-access pattern rather than being
fully closed.

## Sanitized calendar read views (Phase 7)

Alongside `family_schedule` (now excluding soft-deleted events and exposing a
`participant_member_id` column — see "Availability" below), a second view provides the
drop-off/pick-up read model:

**`family_responsibilities`** — joins `responsibilities` with their parent `events` row,
scoped to the caller's current family membership. Never needs `family_schedule`'s
title/description sanitization, because a responsibility can only exist on a
`visibility = 'family'` event in the first place (the trigger above) — by the time a
responsibility exists for an event, that event's content is already fully visible to every
family member. Exposes a derived `due_at` (`starts_at` for `drop_off`, `ends_at` for
`pick_up`/others) computed at read time, never stored.

## Deterministic conflict detection (Phase 7)

`has_member_schedule_conflict(p_member_id, p_starts_at, p_ends_at, p_exclude_responsibility_id)`
— a read-only `SECURITY DEFINER` function, not a table. Returns **a bare boolean only**,
never which event/task it conflicted with or any of its content — the privacy-safe design
this function exists specifically to guarantee (see
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)). Checks three sources for the given
member and half-open interval `[starts_at, ends_at)`: their own events (private or family),
a timed family task assigned to them, or another `accepted` responsibility. The caller must
be a member of the same family as `p_member_id`.

## Timezone handling (Phase 7)

`events.starts_at`/`ends_at` are `timestamptz` — an unambiguous UTC instant by construction,
not an ambiguous local timestamp. `timezone` (IANA) is stored alongside purely for correct
*rendering* and for computing local-day query boundaries client-side (`starts_at >=
dayStart AND starts_at < dayNext`) — see `src/domain/calendar/dateUtils.ts`'s
`localDayBoundsUtc`, which goes through the local `Date` constructor (DST-correct) rather
than a fixed UTC-offset calculation. The MVP Day Calendar has no all-day/date-only event
concept — date + start + end are always required this phase; deferred rather than modeled
ambiguously (see [ROADMAP.md](ROADMAP.md)).

## notification_tokens

**Owned by the user.** Expo push tokens, one row per installed device.

| column            | type                 | notes                                                                                                                                                                 |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | uuid                 |                                                                                                                                                                       |
| `profile_id`       | uuid → `profiles.id` | always the caller — `register_notification_token` reassigns an existing token row to whoever re-registers it (device resale/reinstall), never a parameter          |
| `expo_push_token`  | text                 | required, unique                                                                                                                                                      |
| `device_platform`  | text                 | `'ios' \| 'android'`                                                                                                                                                  |
| `last_seen_at`     | timestamptz          | updated on each successful send/refresh, used to prune stale tokens                                                                                                   |
| `deactivated_at`   | timestamptz          | nullable (Phase 6). Set on logout (client-initiated, best-effort) or by the dispatcher when Expo reports `DeviceNotRegistered` for this token. A deactivated token is excluded from delivery but the row itself is kept, not deleted — re-registering the same token string clears it |

## notification_preferences

**Owned by the user** (Phase 6). One row per profile; a missing row means "notifications
enabled" (the default), matching `notification_preference_enabled()`'s own server-side
default — so a user who never opens the Settings screen is still notified.

| column                             | type                 | notes             |
| ----------------------------------- | -------------------- | ------------------ |
| `profile_id`                        | uuid → `profiles.id` | primary key       |
| `assignment_notifications_enabled`  | boolean              | default `true`    |

## The `notifications` schema — outbox and deliveries (Phase 6)

Unlike every table above, `notifications.outbox` and `notifications.deliveries` are **not
reachable via the client API surface at all** — the `notifications` schema is absent from
`supabase/config.toml`'s `[api] schemas` list, so PostgREST exposes zero endpoint for it to
any role, including `service_role`. This is a routing-level restriction, not a grants/RLS
one; every function and table inside the schema also carries an explicit `revoke all ...
from public, anon, authenticated` as defense-in-depth, but the schema's absence from the API
config is what actually makes it unreachable. See
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for the full rationale and
`supabase/tests/110_notification_outbox_test.sql` for the assertions that verify this (both
`SELECT` and every internal function, for both `authenticated` and `anon`). The only way in
is a direct Postgres connection using `SUPABASE_DB_URL` — used by the
`dispatch-notifications` Edge Function (`supabase/functions/_shared/db.ts`) and by
`scripts/e2e-notifications.sh`, never by the mobile client.

**`notifications.outbox`** — one row per notification-worthy event, written transactionally
by an `AFTER INSERT` trigger on `task_assignments` (`enqueue_task_assignment_notification()`,
alongside the pre-existing `apply_task_assignment_action` trigger, not folded into it — this
keeps "apply the assignment mutation" and "decide who to notify" as separate concerns). Key
columns: `event_type` (one of the four below), `family_id`, `task_id`, `task_assignment_id`,
`actor_member_id`, `recipient_member_id`, `payload` (jsonb — the notification-tap deep-link
payload, see `src/domain/notifications/payload.ts`), `status`
(`pending | processing | sent | failed | skipped`), `attempts`, `next_attempt_at` (bounded
exponential backoff, capped 30 minutes), `idempotency_key` (unique — derived from the
triggering `task_assignments.id` as `task_assignment:<id>`, so a replayed trigger or a retried
RPC can never produce a duplicate notification).

Event types and recipient derivation (never the actor — no self-notification):

| Event                                | Fires on `task_assignments.action` | Recipient                          |
| ------------------------------------- | ----------------------------------- | ------------------------------------ |
| `family_task.assignment_requested.v1` | `assigned` or `reassigned`          | the new assignee (`assigned_to_member_id`) |
| `family_task.assignment_accepted.v1`  | `accepted`                          | the assigner (`assigned_by_member_id`), if any |
| `family_task.assignment_declined.v1`  | `declined`                          | the assigner (`assigned_by_member_id`), if any |
| `family_task.assignment_taken.v1`     | `took`                              | the task's prior assigner if known, else the family owner |

No row is enqueued at all when the recipient would be the actor (e.g., assigning to oneself,
which `set_task_assignment` already collapses straight to `accepted`), when the recipient has
since left the family, or — checked at dispatch time, not enqueue time — when the recipient
has disabled `notification_preferences.assignment_notifications_enabled`. Completion and
restoration never enqueue a notification this phase (see [ROADMAP.md](ROADMAP.md)).

**`notifications.deliveries`** — one row per `(outbox_id, notification_token_id)` pair,
created by the dispatcher just before sending so even a mid-send crash leaves a traceable
per-device row. `status` (`pending | ticket_ok | ticket_error | receipt_ok | receipt_error |
permanent_failure`) tracks Expo's own two-phase send → ticket → (later) receipt flow;
`expo_ticket_id`/`expo_receipt_status`/`error_code` mirror Expo's response fields directly. A
`DeviceNotRegistered` ticket or receipt deactivates the corresponding `notification_tokens`
row (`notifications.deactivate_notification_token`), not just this one delivery.

## Availability / "Busy" representation

**Not a table.** Implemented as the `family_schedule` **Postgres view** over `events`, never
as a client-side filter of full event rows — see
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for the exact mechanism, this is the
piece that prevents private event details from ever leaving the database for a non-owner in
the first place. **Implemented in Phase 7**: excludes soft-deleted (`deleted_at`) events and
adds a `participant_member_id` column (the event's primary participant, e.g. which child —
sanitized to `null` for a private item the same way `title`/`description` are).

## Audit-relevant timestamps and actors

Every table above except `task_assignments`/`responsibility_assignments` (append-only by
design, so `created_at` alone is their "audit" story) gets:

| column       | type                 | notes                                                                                    |
| ------------ | -------------------- | ---------------------------------------------------------------------------------------- |
| `created_at` | timestamptz          | default `now()`                                                                          |
| `updated_at` | timestamptz          | maintained by a trigger, not application code — see DECISIONS.md                         |
| `created_by` | uuid → `profiles.id` | who performed the insert, for tables where this isn't already implied by an owner column |

## Ownership and authorization summary

| Table                                                        | Owned by                           | Who can read                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                                                   | the user                           | self; other family members see only what `family_members.display_name`/`avatar_url` expose (not the full profile row)                        |
| `families`, `family_members`                                 | the family                         | family adults (and children, for `family_members`)                                                                                           |
| `family_invitations`                                         | the family                         | direct table access: owner only. Anyone else: only the sanitized `get_family_invitation_preview(token)` RPC — never a table read             |
| `categories`                                                 | family, or system                  | family members; system categories are public                                                                                                 |
| `tasks`, `events`                                            | user (personal) or family (shared) | owner always; family members only if `visibility = 'family'`, and only sanitized fields if the item is private (see SECURITY_AND_PRIVACY.md) |
| `task_assignments`, `responsibility_assignments`, `event_participants`, `responsibilities` | the family | family adults                                                                                                                                |
| `reminders`                                                  | the user                           | owner only — never visible to other family members, even for a shared task                                                                   |
| `notification_tokens`, `notification_preferences`            | the user                           | owner only; never exposed to any other user, including family members                                                                        |
| `notifications.outbox`, `notifications.deliveries`           | n/a — not a client-facing table    | nobody, via the client API — the schema itself is absent from PostgREST's routing config; reachable only via a direct `SUPABASE_DB_URL` connection (server-side/scripts only) |

This table describes **reads**, governed by RLS `SELECT` policies on both tables alike. Writes
diverge: `tasks` is RPC-only (Phase 4, see above); `events`/`event_participants`/
`responsibilities` are RPC-only as of Phase 7 (an audit finding — see
[DECISIONS.md, "Phase 7"](DECISIONS.md) — closed the same class of gap Phase 4 found for
`tasks`).

This table is the plain-language summary; the enforceable version is Postgres RLS policies,
designed in [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) and written before any
migration lands.
