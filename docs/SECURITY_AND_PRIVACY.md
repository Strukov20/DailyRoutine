# Security & Privacy Design

Status: **implemented** in `supabase/migrations/` (Phase 2) and proven by the pgTAP suite in
`supabase/tests/`, most directly `060_privacy_regression_test.sql`. This document was
originally written _before_ any migration existed, per the project brief's instruction to
design the security approach first — implementing it surfaced one real gap in the original
Mechanism 2 design, corrected below and recorded in
[DECISIONS.md](DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design).

## The rule

For a **private** event or task (`visibility = 'private'`, see [DATA_MODEL.md](DATA_MODEL.md)),
a family member who is not the owner may learn only:

- who owns it (which family member);
- its start time;
- its end time;
- the literal fact "Busy."

They must never receive title, description, category, notes, attachments, or any other
field — **through any channel**: a direct PostgREST/API query, a Supabase Realtime event, a
push notification, a server or client log line, or a client-side filter. "Client-side
filter" is called out explicitly because it is the failure mode that is easiest to ship by
accident: fetching the full private row and simply not _rendering_ the title in the UI is
not privacy — the data already left the database and sits in the device's memory, a network
log, or a crash report. **The database must never return the sensitive columns to a
non-owner in the first place.**

## Mechanism 1 — RLS blocks the base tables entirely for non-owners

`events` and `tasks` get a `SELECT` policy of roughly:

```sql
create policy "owner or family-visible" on events
  for select
  using (
    owner_profile_id = auth.uid()
    or (
      visibility = 'family'
      and family_id in (select family_id from family_members where profile_id = auth.uid())
    )
  );
```

The critical property: **there is no branch of this policy that lets a non-owner select a
row where `visibility = 'private'`.** Not a restricted set of columns — the row itself is
unreachable via the base table. Postgres RLS is row-level, not column-level, so column-level
redaction has to happen elsewhere (Mechanism 2). This policy only has to get one thing right:
never return a private row's `owner_profile_id ≠ auth.uid()` case, full stop.

The same shape applies to `tasks`, `reminders` (owner-only, no family branch at all —
reminders are never shared, see DATA_MODEL.md), and `notification_tokens` (owner-only).

**Constraint this implies**: a task cannot be both `visibility = 'private'` and have
`assignee_member_id` set to someone other than the owner — you cannot assign work to someone
the RLS policy prevents from reading the task. This is enforced with a `CHECK` constraint (or
a trigger, if the check needs a subquery) in the migration, not left as an application-layer
assumption.

## Mechanism 2 — a sanitized view is the _only_ way to read someone else's item

Family members never query `events`/`tasks` directly for other members' data. They query
`family_schedule` / `family_task_board`
(`supabase/migrations/20260902120800_sanitized_availability.sql`):

```sql
create view public.family_schedule as
select
  e.id, e.family_id, e.owner_profile_id, e.starts_at, e.ends_at, e.visibility,
  case when e.visibility = 'family' then e.title       else null end as title,
  case when e.visibility = 'family' then e.description else null end as description,
  case when e.visibility = 'family' then e.location    else null end as location
from public.events e
where e.family_id is not null
  and e.family_id in (select fm.family_id from public.family_members fm where fm.profile_id = auth.uid());
```

**This view is deliberately _not_ `security_invoker`.** That's a correction to this
document's original design, made while implementing it — see
[DECISIONS.md](DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design)
for the full reasoning. In short: `events`' own base-table RLS (Mechanism 1) already hides a
private row from non-owners entirely. A `security_invoker` view runs with the querying user's
own RLS, so it would inherit that same block and could never show a Busy block for a private
item — the opposite of what this view exists to do. As an ordinary (owner-executed) view, it
bypasses the querying user's RLS on `events` by construction, which means **the view's own
`WHERE` clause is the entire authorization check** — there is no second, independent RLS
layer behind it for this view. That's why the `WHERE` clause and the sanitizing `CASE`
expressions are reviewed together, in this one file, rather than assumed to be backed by
table RLS as well.

The sanitizing `CASE` is the column-level mechanism: a private row still appears as a row (so
"Busy" renders at the right time), but its `title`/`description`/`location` are `NULL` **in
the query result itself** — not hidden by the client. Querying this view with `select *` from
a REST client, a debugger, or a bug in the mobile app can never surface more than the allowed
fields, because the disallowed fields are never computed into the row.

The client only ever queries `events`/`tasks` (the base tables) for its own data
(`owner_profile_id = auth.uid()`); it queries `family_schedule`/`family_task_board` for
anyone else's. `family_task_board` mirrors this exact pattern for tasks, including
sanitizing `assignee_member_id` (which would otherwise reveal who a private task is
delegated to).

Proven end to end — a private event/task planted with a unique secret marker in every
sensitive field, asserted absent from both views for a family member, and both views empty
for an outsider/anonymous — by `supabase/tests/060_privacy_regression_test.sql`.

## Mechanism 3 — Realtime never re-broadcasts the raw row

**Implemented, Phase 9** (`supabase/migrations/20260909120000_realtime_offline_conflicts.sql`)
— the design below supersedes an earlier Phase-2-era plan in this same section that proposed
broadcasting a *sanitized* row (the `family_schedule` view's own redacted shape). What was
actually built goes further than that plan: broadcasts carry **no row content at all**, not
even sanitized content.

Supabase Realtime's `postgres_changes` on the base `events`/`tasks`/`responsibilities` tables
is **never used** for cross-device/cross-member updates, even though modern Supabase Realtime
is RLS-aware, because it broadcasts the full `NEW`/`OLD` row payload to the change-detection
layer before RLS narrows _visibility_ of the row — RLS controls whether a subscriber sees the
change event at all, not whether the payload is column-redacted.

Instead: **Broadcast**, over two kinds of private channel, each gated by its own RLS policy
on `realtime.messages` (never `USING (true)`):

- `profile:<profile_id>` — only `auth.uid() = profile_id` may `select`/listen (the malformed-
  topic and non-UUID-suffix cases fail closed via `public.try_cast_uuid`, which never raises,
  only returns `null`).
- `family:<family_id>` — only a *current, active* (`removed_at is null`) member of that
  family may listen; a removed member's existing subscription may persist for the life of
  their already-established Realtime connection (Supabase may cache per-connection channel
  authorization) — payloads must therefore remain content-free regardless, since revocation
  of *new* subscriptions is not the same guarantee as revocation of an open one.
- Clients only ever get `select` (listen) on `realtime.messages` — never `insert` (send);
  every broadcast is emitted server-side, from `public.emit_invalidation`, a
  `security definer` function that is the *only* caller of `realtime.send(...)`.

**The payload is a fixed, generic, content-free shape** —
`{version: 1, scope: 'profile'|'family', entity: 'tasks'|'events'|'responsibilities'|'members'|
'categories'|'reminders'|'recurrence', operation: 'changed'}` — never the changed row, never a
title/description/category/participant/assignment detail, never a token. Seven narrowly scoped
trigger functions (one per table: `tasks`, `task_occurrences`, `reminders`, `events`,
`responsibilities`, `family_members`, `categories`) fire `after insert or update or delete ...
for each row`, each with a fixed `search_path`, schema-qualified calls, and explicit
`revoke ... from public, anon` (covered by the Phase 6.1 anon-execute regression guard). A
`DELETE` uses the row's own prior `owner_profile_id`/`family_id` (`OLD`, not `NEW`) so a
deletion never broadcasts to the wrong scope. Junction tables (`task_assignments`,
`event_participants`, `responsibility_assignments`) get no broadcast trigger of their own —
every write to them is transactionally coupled to a write on their parent table within the
same RPC call, which already has one, avoiding duplicate broadcast storms.

On receipt, the client (`src/lib/realtime/useRealtimeSync.ts`) validates the payload (zod
`safeParse`, silently ignoring anything malformed or carrying an unrecognized version/entity),
maps `entity` to a fixed set of query-key prefixes
(`src/lib/realtime/invalidationMap.ts`), and calls `invalidateQueries` — it is never written
directly into the query cache as trusted data, and a broadcast is never treated as
authorization for anything. Bursts within a 300ms window coalesce into one invalidation pass
per affected query-key prefix, and the current device receiving its own broadcast is harmless
(the same idempotent invalidate-then-refetch-through-RLS path either way).

## Mechanism 4 — notifications

Reminders (`reminders` table) are owner-only by construction (`profile_id`) — a reminder for
a private task never has another recipient, so there is no cross-user leak path to design
against. Task reminders are delivered as **device-local** notifications (Phase 8 —
`expo-notifications` scheduled entirely on-device, never routed through the server outbox
below), so unlike the push mechanisms in this section, the content never leaves the device or
crosses the network at all; the privacy question for reminders is purely "what does this
device's own lock screen show," covered in Mechanism 4c below.

**Implemented in Phase 6** for shared family task assignment events, **extended in Phase 7**
to event-responsibility assignment events (drop-off/pick-up/etc.) — never personal tasks (a
personal task has no other family member to notify) — this section's push-outbox mechanisms
never fire for a reminder; see Mechanism 4c for personal-task reminder notifications
specifically. Both surfaces share the same constraint that makes this safe: shared family tasks
are the only task shape that reaches `task_assignments` at all, and a responsibility can only
exist on a `visibility = 'family'` event (Phase 7's trigger — see
[DATA_MODEL.md](DATA_MODEL.md)); either way, a recipient already has read access to the full
task/event via `family_task_board`/`family_schedule` by the time the notification arrives —
the notification itself never needs to (and does not) carry task/event content.

**The push payload never contains task/event/user content — only ids.** See
`src/domain/notifications/payload.ts`: a discriminated union of
`{schemaVersion, eventType, familyId, taskId}` (task-assignment events) and
`{schemaVersion, eventType, familyId, eventId}` (event-responsibility events, Phase 7) — never
both, never neither. No title, no assignee name, no free text of any kind — the same "log ids,
not content" rule as Mechanism 5, applied to a channel that leaves the database entirely
(Apple/Google's push infrastructure, not FamilyFlow's own). The on-device notification's
visible title/body are static, privacy-safe strings the dispatcher itself chooses from
`event_type` (`supabase/functions/dispatch-notifications/index.ts`'s
`NOTIFICATION_BODY_BY_EVENT`, e.g. "New family task assigned" / "New event responsibility
assigned") — never interpolated from row content. Tapping the notification navigates to the
real task editor route or event detail route (`src/lib/notifications/notificationResponseRouter.ts`
picks the route from which field the parsed payload actually carries), which re-fetches
through the authenticated Supabase client + RLS — the push payload is never trusted as
content or as authorization, only as a hint of where to navigate.

**The recipient list is derived entirely server-side, from database state, inside the same
transaction as the mutation** (`notifications.enqueue_task_assignment_notification()` on
`task_assignments`; `notifications.enqueue_event_responsibility_notification()` on
`responsibility_assignments`, Phase 7 — the same trigger shape, a second table) — never from
a client-supplied recipient. This closes the same class of gap Mechanism 4 originally worried
about in the abstract: a compromised or buggy client cannot get an arbitrary push sent to an
arbitrary user, because the client never supplies a recipient at all, only the action it
performed (assign/accept/decline/take), and the trigger computes who (if anyone) should be
told from `family_members`/`task_assignments`/`responsibility_assignments` state at insert
time. The actor is never notified about their own action (no self-notification), and a member
who has since left the family is never enqueued as a recipient (checked at enqueue time
against current `family_members` state).

### Mechanism 4a — the `notifications` schema is unreachable from the client API surface

`notifications.outbox` and `notifications.deliveries` (the durable transactional outbox and
per-device delivery ledger — see [DATA_MODEL.md](DATA_MODEL.md)) hold `payload`/error/status
fields that are internal implementation detail, not something the client should ever read
directly. Rather than relying on RLS/grants alone (Mechanism 1's usual approach), this phase
adds a **schema-level** restriction: `notifications` is absent from `supabase/config.toml`'s
`[api] schemas` list, so PostgREST does not expose a single endpoint for anything inside it,
**to any role, including `service_role`** — a routing-level restriction that grants cannot
override, unlike every other mechanism in this document. Every table/function inside the
schema also carries an explicit `revoke all ... from public, anon, authenticated` as
defense-in-depth (in case the schema were ever added to the API config by a future change),
but the schema's absence from that config is the actual, currently-operative control. The
only legitimate access path is a direct Postgres connection via `SUPABASE_DB_URL` (a
server-only secret, never `EXPO_PUBLIC_*`, never in the mobile bundle) — used by the
`dispatch-notifications` Edge Function and by `scripts/e2e-notifications.sh`.

Verified two ways: `supabase/tests/110_notification_outbox_test.sql` asserts every table and
function in the schema is inaccessible (`SELECT`, every internal function, both
`authenticated` and `anon`) at the database-grants level; `scripts/e2e-notifications.sh`
separately confirms the schema is unreachable **at the API layer** by hitting
`$API_URL/rest/v1/outbox` with the `service_role` key and asserting a 4xx (PostgREST doesn't
recognize the path at all, since the schema was never registered) — a check the pgTAP suite
cannot perform, since pgTAP runs inside Postgres, not through PostgREST.

### Mechanism 4b — conflict detection returns a boolean, never what it conflicted with

`has_member_schedule_conflict(p_member_id, p_starts_at, p_ends_at, p_exclude_responsibility_id)`
(Phase 7) checks whether a member is busy against three private-content-bearing sources
(their own events, a timed task assignment, another accepted responsibility) but returns
**only `true`/`false`** — never the conflicting item's id, title, or any other field. The
client renders a fixed, generic string ("{name} is busy at this time") regardless of which
source triggered it. Verified both ways: `supabase/tests/120_family_calendar_test.sql`
asserts the function's SQL return type is a bare boolean; `scripts/e2e-calendar.sh` asserts
the raw HTTP response body from a real RPC call contains no secret-marker text and no
recognizable field name (`title`/`description`) at all — the strongest test this mechanism
allows, short of exhaustively enumerating every possible leak shape.

### Mechanism 4c — local reminder notification content is a preference, decided at build time (Phase 8)

A task reminder never leaves the device (see above), so the risk here isn't a network leak —
it's a task title (potentially sensitive: a medical appointment, a surprise gift) sitting on a
lock screen where anyone glancing at the phone can read it. **"Show task titles in
notifications" (`notification_preferences.reminder_titles_enabled`) defaults to `false`.** When
disabled, `reminderReconciliation.ts`'s `buildContent()` never passes the task's title/body to
`expo-notifications` at all — the notification's title/body are the fixed generic strings
"FamilyFlow" / "Task reminder" regardless of the actual task, decided at the moment the
notification content is *built*, not filtered afterward at *display* time. This is the same
privacy-is-a-data-layer-guarantee discipline as the rest of this document, applied to a payload
that happens to never touch the network: the task's own title is simply never read into the
notification content object when the preference is off, the same way a sanitized view never
selects a column it shouldn't return.

## Mechanism 5 — logs

Application logs go through `src/lib/logger/logger.ts`, whose contract (documented in that
file and enforced by convention/review, not by a runtime filter) is: log identifiers and
metadata, never free-text content fields (`title`, `description`, `notes`). The
`ErrorBoundary` (`src/components/ErrorBoundary.tsx`) follows the same rule — it logs the
error message and component stack, never component props/state, which is exactly where a
private task's title would otherwise end up. Supabase/Postgres-side logs (Edge Functions,
database logs) must follow the same rule once they exist: log row ids, not row content.

## Mechanism 6 — family lifecycle and account deletion (Phase 10)

Three server-authoritative RPCs, all `SECURITY DEFINER`, all narrowly scoped (see
DATA_MODEL.md, "family_ownership_transfers," and
`supabase/migrations/20260912120000_release_safety_ownership_and_deletion.sql` for the exact
implementation):

- **`transfer_family_ownership`** — owner-only. `families.owner_id` and the two affected
  `family_members.role` values are updated inside one transaction (never observable as
  "two owners" or "zero owners" from outside it — the unique partial index on
  `family_members (family_id) where role = 'owner'` enforces this at the database level, not
  just in application logic). A target member id that doesn't exist, belongs to another
  family, or was already removed all raise the identical `42501` — the same no-existence-
  oracle discipline established in Phase 9 (see that section above) applied to family
  members, not just tasks.
- **`delete_family`** — owner-only, soft delete (`families.deleted_at`). `is_family_member`/
  `is_family_owner`/`current_family_ids` — the one choke point essentially every family-scoped
  RLS policy in this schema already goes through — exclude a deleted family immediately, so
  every member, including the former owner, loses read/write access to everything
  family-scoped in the same instant. Tasks/events/responsibilities/assignment audit rows/
  notification outbox rows for that family are **never deleted** — they remain in the
  database as historical data, simply unreachable through any RLS-gated path once membership
  can no longer be established. Every pending invitation is revoked in the same transaction.
- **`request_account_deletion`** — self-service, blocked (`22023`) if the caller currently
  owns any non-deleted family (must transfer or delete it first — a family can never be left
  ownerless by this path). On success: every other family membership is left (soft-removed,
  the same unassign-then-remove guarantee `remove_family_member` already provided); the
  caller's own **private** tasks/events are soft-deleted; **family-shared** tasks/events the
  caller still owns are left in place, since another family member may depend on them (an
  assigned shared task, a shared event with responsibilities) and deleting them would orphan
  that content for someone still using it; every device token is deactivated; every pending
  invitation the caller sent is revoked; the `profiles` row is anonymized in place
  (`display_name` → "Deleted user", `avatar_url` → null) and marked `deleted_at`.
  **`auth.users` is never touched by this RPC** — a full cascading hard delete would need to
  first delete or reassign every `tasks.owner_profile_id`/`events.owner_profile_id`/
  `families.owner_id` row referencing that profile (none of those foreign keys cascade, by
  design, so the row can't simply be dropped), which is a substantially larger, riskier change
  than anonymize-in-place; a documented (not deployed) Edge Function using the Supabase Admin
  API is the anticipated follow-up for actually purging the `auth.users` row once this RPC has
  succeeded — see DECISIONS.md, "Phase 10."

**What an operator can access**: the hosted Postgres database directly (for support/incident
response), same as any Supabase project — this document has never claimed otherwise. What
changes with Phase 10: a "deleted" account's row is anonymized, not gone, so an operator
querying `profiles` directly would still see the row (with `deleted_at` set and PII cleared)
rather than nothing at all; this is a deliberate tradeoff for auditability/data-integrity
(see "auth.users is never touched," above) over "leaves literally no trace."

**No analytics, advertising, or third-party tracking SDK is present in this codebase** — every
network call the mobile app makes goes to this project's own Supabase project or the Expo
Push Service (for push delivery only, ids only — Mechanism 4). This remains true as of Phase
10; introducing any such SDK requires explicit approval (see DECISIONS.md, "Phase 10," "Stop
conditions").

## Implementation status

- ✅ RLS policies for every table in DATA_MODEL.md's ownership table exist in
  `supabase/migrations/` — not just `events`/`tasks`.
- ✅ Tests assert a non-owner **cannot** read a private row's sensitive columns via the base
  table or via the sanitized views — `supabase/tests/060_privacy_regression_test.sql`, run
  against a real local Postgres instance with RLS enabled (`supabase test db`), not mocked.
  See [TEST_STRATEGY.md](TEST_STRATEGY.md), "RLS and privacy tests."
- ✅ Every table has `REVOKE ALL ... FROM anon, authenticated` followed by narrow explicit
  `GRANT`s — no table relies on RLS alone while leaving broad default privileges in place.
  `service_role` is never referenced by the mobile app (`src/lib/supabase/client.ts` only
  ever uses the anon key — see `docs/DECISIONS.md`, "Never place a service_role key...").
- ✅ **Implemented in Phase 9**: Realtime (Mechanism 3) — see that section above.
- ✅ **Implemented in Phase 9**: the persisted offline read cache
  (`src/lib/query/persistedQueryClient.ts`) writes to on-device AsyncStorage, partitioned per
  authenticated profile id and cleared on real sign-out. This is **app-sandbox storage, not
  hardware-encrypted storage** — iOS/Android sandbox each app's files from other apps, but
  that is a different guarantee from at-rest encryption; this document must never claim the
  cache is encrypted, because it isn't. Only an explicit allowlist persists (task/calendar/
  family/conflict/category *lists*, never auth tokens, invitation tokens, notification
  tokens, mutation error payloads, raw Realtime messages, or the offline queue's own rows —
  `shouldDehydrateQuery` rejects anything outside that allowlist). The offline mutation queue
  (`src/lib/offline/`) is a **separate** persisted store, same per-profile partitioning and
  logout-clearing, bounded to 200 operations, holding only the eight safe personal-task/
  occurrence operations in Section 9's scope (never family/shared mutations, never auth
  material) — see [DECISIONS.md, "Phase 9"](DECISIONS.md) for the idempotency/stale-write
  design.
- ✅ **Implemented, Phase 9 completion pass**: the Sync Issues screens (`app/sync-issues/`)
  never render a raw Postgres error, SQLSTATE, stack trace, RPC payload, or internal SQL
  identifier — every failure is mapped, at the transport layer
  (`offlineQueueReplay.ts`'s `toSafeErrorCode`), to one of four generic
  `OfflineSafeErrorCode` values before it ever reaches a component, and the comparison screen
  fetches the server side of a stale-write conflict through the same authenticated,
  RLS-governed `getTask()` read every online screen uses — never a cached/trusted snapshot.
  Covered by a dedicated Jest assertion (`SyncIssueCard.test.tsx`, `SyncIssuesScreen.test.tsx`)
  that greps the rendered tree for PostgREST/SQLSTATE-shaped strings and asserts none appear.
- ✅ **Fixed, Phase 9 final security pass**: `update_personal_task`, `schedule_personal_task`,
  `complete_personal_task`, `restore_personal_task`, `complete_task_occurrence`, and
  `restore_task_occurrence` deliberately raise the exact same errcode (`42501`) and message
  for "this task/occurrence id doesn't exist," "it exists but belongs to another profile,"
  and "it exists but is no longer visible to the caller" (soft-deleted) — an *authenticated*
  caller can pass any UUID, not just their own tasks' ids, so distinguishing these (as an
  earlier completion-pass commit briefly did via a separate `P0002` code) let that caller
  learn, for any UUID, whether a task with that id exists anywhere in the system at all — a
  genuine cross-user task-existence oracle, not a cosmetic detail. `160_sync_issues_
  resolution_test.sql` proves indistinguishability directly: it captures the exact
  SQLSTATE+message a random (never-existed) UUID and another profile's real task UUID each
  raise and asserts they are byte-for-byte identical, for every affected RPC. See
  [DECISIONS.md, "Phase 9"](DECISIONS.md) for the full writeup.
- ✅ **Implemented in Phase 6, extended in Phase 7**: shared family task and event-
  responsibility assignment notifications (Mechanism 4) — content-free push payloads (ids
  only), server-derived recipients inside the same transaction as the mutation, the
  `notifications` schema's own API-layer isolation (Mechanism 4a), and (Phase 7) a
  privacy-safe deterministic conflict-detection function returning a boolean only
  (Mechanism 4b). **Implemented in Phase 8**: personal-task reminder notifications, as a
  device-local `expo-notifications` schedule (never the push outbox above), with a
  content-shown-or-not preference decided at build time (Mechanism 4c). **Still not
  implemented**: notifications for task completion/restoration, and any reminder/recurrence
  notification for calendar events — see [ROADMAP.md](ROADMAP.md).
- ⚠️ **Function EXECUTE grants are a separate mechanism from table grants — audited in Phase
  3, fixed where it mattered.** The "REVOKE ALL ... FROM anon, authenticated" bullet above is
  about _tables_ and remains accurate. _Functions_ are different: Supabase's own role bootstrap
  grants `anon`/`authenticated` EXECUTE on every new function directly (not via the `PUBLIC`
  pseudo-role), so `revoke all on function ... from public` alone never actually revokes it —
  confirmed by inspecting `pg_proc.proacl` on a real local instance. Every
  `SECURITY DEFINER` function in this codebase (Phase 2's `is_family_member`/`is_family_owner`/
  `current_family_ids` and Phase 3's family/invitation/child RPCs) now explicitly revokes from
  `anon` too — see [DECISIONS.md](DECISIONS.md), "Phase 3," for the full writeup and which two
  functions this was a real (not just theoretical) gap for. **Before adding any new
  `SECURITY DEFINER` function**, confirm its ACL with a query like the one in that entry
  rather than trusting a `revoke ... from public` statement alone.
- ⚠️ **`tasks` had a direct-`UPDATE` gap, closed in Phase 4 by moving to RPC-only writes.**
  The Phase 2 `UPDATE` policy's `WITH CHECK` protected `owner_profile_id` but nothing else —
  a client could rewrite `family_id`/`assignee_member_id`/`assignment_status` on their own
  task directly, bypassing the `task_assignments` audit trail and (since the sanitized view's
  authorization is the _viewer's_ membership, not the _owner's_) potentially exposing a task
  to a family the owner was never actually part of. `INSERT`/`UPDATE`/`DELETE` on `tasks` are
  now revoked entirely for `authenticated`; every mutation goes through a `SECURITY DEFINER`
  RPC in `supabase/migrations/20260904120000_personal_task_management.sql`. See
  [DECISIONS.md, "Phase 4"](DECISIONS.md) for the full writeup — the same audit-then-fix
  workflow as the entry above, applied to a different mechanism (grants, not RLS policies or
  function ACLs).
- ⚠️ **`events`/`event_participants`/`responsibilities` had the same direct-grant gap as
  `tasks`, closed in Phase 7.** These three tables (Phase 2) granted raw INSERT/UPDATE/DELETE
  to `authenticated` from the start — in particular, `responsibilities`' owner-manages policy
  let the event owner `UPDATE` a responsibility's `status`/`assignee_member_id` directly via a
  plain PATCH, bypassing the accept/decline/take state machine and its audit trail entirely.
  Closed the same way as the `tasks` finding: the three grants revoked, every mutation
  replaced by a narrowly scoped RPC. See [DECISIONS.md, "Phase 7"](DECISIONS.md).
- ⚠️ **`reminders` moved to RPC-only writes in Phase 8, pre-emptively rather than as an audit
  finding.** Unlike the `tasks`/`events` gaps above, `reminders`' direct grants were never
  shown to be exploitable — but Phase 8 needed a validation point for the new
  `reminders_exactly_one_time` CHECK and the `occurrence_id`/`is_snooze` invariants (a snooze
  row must reference a real occurrence it can be scoped to) that a bare `CHECK` constraint
  alone can express but a raw client `INSERT` could still technically satisfy while violating
  the *intent* (e.g., setting `is_snooze = true` on a reminder the user never actually
  snoozed). Converted to `create_task_reminder`/`update_task_reminder`/`delete_task_reminder`
  before shipping, matching the RPC-only pattern established for every other mutable table in
  this codebase. See [DECISIONS.md, "Phase 8"](DECISIONS.md).

## Non-goals for MVP

- End-to-end encryption of event/task content. Supabase (Postgres + RLS) is a trusted-server
  model, consistent with the rest of the product; this document's guarantees are about
  _which authenticated family members_ see _which fields_, not about hiding data from
  FamilyFlow's own backend.
- Anonymizing _who_ owns a busy block. The product brief explicitly allows the owner's
  identity in a Busy block ("owner, start, end, Busy") — only content is redacted.
