# Roadmap

Three horizons. MVP is defined in full in [MVP_SCOPE.md](MVP_SCOPE.md); this file focuses on
V2/V3 and how the current architecture leaves room for them without a rewrite.

## MVP

See [MVP_SCOPE.md](MVP_SCOPE.md).

### MVP-scope items delivered in Phase 8

Both **recurring tasks** and **reminder scheduling** — previously listed here as "not yet
built, with a concrete plan" — were delivered in Phase 8 (personal tasks only; see
[DATA_MODEL.md](DATA_MODEL.md), "task_occurrences (Phase 8)" and "Reminders (Phase 8)," and
[DECISIONS.md](DECISIONS.md), "Phase 8," for the architecture actually built). Reminder
delivery is a **device-local** `expo-notifications` schedule, not a route through Phase 6's
server push outbox — see the "Push notification scope" note below for what that distinction
means for reminders specifically.

### Push notification scope not covered by Phase 6/7

Phase 6 built shared-task assignment push notifications; Phase 7 extended the same outbox to
event-responsibility (drop-off/pick-up/etc.) assignment events (see
[ARCHITECTURE.md](ARCHITECTURE.md), "Push notifications" and "Family calendar"). Deliberately
still out of scope, not forgotten:

- Notifications for recurring-task changes, task completion, or task restoration.
- **Task reminder delivery specifically stays off this outbox** — it is a device-local
  `expo-notifications` schedule instead (Phase 8; see [ARCHITECTURE.md](ARCHITECTURE.md),
  "Recurring tasks and local reminder scheduling"), deliberately, since the content/timing are
  fully known on-device and a server round-trip would only add latency and a network
  dependency a reminder shouldn't have.
- Digests/summaries, quiet hours, or any per-notification-type scheduling beyond immediate
  delivery.
- AI-driven notification content or timing.
- Email/SMS delivery — Expo push only.
- A full in-app notification inbox/history screen — a tap navigates straight to the task/event;
  there is no list of past notifications to revisit.
- Notifications for general event content changes (a title/time edit) or child-profile
  activity unrelated to a responsibility assignment.
- Notifications around family ownership transfer (not built at all yet — see the "Family
  ownership transfer" row in the V2 table below).
- Direct APNs/FCM integration — Expo Push Service only, deliberately not bypassed.

### Calendar scope not covered by Phase 7

Per the brief's own explicit non-goals: Week/Month calendar views, recurring **events** (Phase 8
added recurrence to personal *tasks* only — `events`/`event_participants` gained no recurrence
support), reminder delivery/snooze **for events** (Phase 8's reminder/snooze model is
task-scoped only — an event has no `reminders` row), Google/Apple Calendar integration, travel-time
calculation, maps/locations, *automatic* conflict resolution (detection only — see
[ARCHITECTURE.md](ARCHITECTURE.md)), AI planning, automatic rescheduling, drag-and-drop
calendar editing, attachments, event ownership transfer, a full offline write queue, and
all-day/date-only events (see [DECISIONS.md](DECISIONS.md), "Phase 7," for why the last one
was deferred rather than modeled ambiguously).

Also not deployed (built, not wired up — see [DECISIONS.md](DECISIONS.md) for the exact
manual step): the Database Webhook / `pg_cron` invocation of `dispatch-notifications`, and any
EAS/Apple/Firebase configuration needed for a real device to receive a push at all. No real
push has been sent or received in this phase — every test uses a fake `PushTransport`.

## V2 — not implemented, architecturally anticipated

| Feature                                      | Where the architecture leaves room                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Calendar / Apple Calendar integration | `events` will gain an `external_source` + `external_id` pair (nullable) so a synced event is distinguishable from a native one without a new table. Sync itself would be a Supabase Edge Function, not client code, to keep provider tokens off the device.                                                                                                                                                                                                                                                                     |
| Week and Month calendar views                | The Calendar screen already renders from a date range, not a single hardcoded day (Phase 7); adding view modes is a UI-layer change over the same query shape.                                                                                                                                                                                                                                                                                                                                                                            |
| Conflict *resolution* (AI-assisted or otherwise) | Deterministic *detection* (a boolean, privacy-safe, per-member overlap check) is implemented as of Phase 7 — see `has_member_schedule_conflict` in [DATA_MODEL.md](DATA_MODEL.md). What's still V2: anything that acts on a detected conflict beyond showing a generic warning — suggesting an alternative, auto-resolving it, or blocking a save (this phase deliberately never blocks a save on a conflict, only warns).                                                                                                                                                                                                                                           |
| Subtasks                                     | `tasks.parent_task_id` (nullable, self-referencing) is the anticipated column; not added now to avoid an unused foreign key in the MVP schema.                                                                                                                                                                                                                                                                                                                                                                                  |
| Attachments                                  | A `task_attachments` / `event_attachments` table referencing Supabase Storage objects, with RLS mirroring the parent record's visibility.                                                                                                                                                                                                                                                                                                                                                                                       |
| Shared shopping lists                        | Likely its own `lists` + `list_items` pair rather than overloading `tasks` — a shopping item isn't a task (no assignee-accept workflow, no priority). Decide at design time, not now.                                                                                                                                                                                                                                                                                                                                           |
| Widgets                                      | Native, platform-specific; needs a lightweight read API (a Postgres view) that a widget extension can hit without pulling in the full app bundle.                                                                                                                                                                                                                                                                                                                                                                               |
| Comments                                     | A `comments` table polymorphic on (entity_type, entity_id), RLS mirroring the parent entity's visibility rule.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Advanced offline sync                        | A bounded subset (persisted read cache, a queue for six safe personal-task operations, stale-write detection) was implemented in Phase 9 — see "Offline behavior" below. Still V2: offline editing for family/shared/event/responsibility/recurrence-series/reminder-definition data, and a full manual conflict-resolution UI (only detection + a generic "Sync issue" surfaces today).                                                                                                                                                                                                                                                                                                                                                                                             |
| Statistics                                   | Derived entirely from existing tables via read-only aggregate queries/views; no new write-path tables needed.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Family ownership transfer / owner leaves     | `remove_family_member` refuses to ever remove the `role = 'owner'` row (see DATA_MODEL.md, "family_members," and DECISIONS.md, "Phase 3"). A `transfer_family_ownership` RPC — atomically re-pointing `families.owner_id` and swapping the two `family_members` rows' roles inside `assert_family_owner_consistency`'s existing invariant — is the anticipated shape; not built this phase because no product flow for it has been specified yet (does the outgoing owner become a plain adult, or leave the family entirely?). |

### Offline behavior: implemented (Phase 9) vs. still V2

**Implemented, Phase 9** — pulled forward from the "V2, design before building" note this
section used to carry, because the Phase 9 brief specified this exact design explicitly (see
[DECISIONS.md, "Phase 9"](DECISIONS.md)): a persisted, profile-partitioned read cache; a
visible sync-status indicator (Synced/Syncing/Pending changes: N/Sync issue); a bounded,
idempotent offline mutation queue for the six safe personal-task operations, with
FIFO/bounded-retry replay on reconnect; and real stale-write **detection** — an
`expectedUpdatedAt` precondition on `update_personal_task`/`schedule_personal_task` that
raises a distinguishable conflict (errcode `40001`) rather than silently overwriting a change
made elsewhere. Optimistic updates remain limited to where a rollback is trivial and safe
(completion/restoration, plus the equivalent offline-queued case) — never a multi-step
operation like accepting an assignment, and never any family/shared mutation, which stays
disabled offline entirely.

**Still V2 (not built this phase)** — conflict *resolution*, as opposed to detection: Section
11's full manual-resolution UX ("Sync conflict — this task changed on another device," with
Reload server version / Review my pending change / Discard my change / Retry actions) is not
implemented. Today a stale-write conflict surfaces only as the shared sync-status indicator's
generic "Sync issue" + Retry — enough to guarantee the app never silently overwrites a
change, but not yet a dedicated resolution flow. Also still V2: last-write-wins as a *default*
rule for fields with no explicit precondition, and a `version` integer beyond the
`updated_at`-based precondition already in place. Assignment Accept/Decline remains an
audit-logged event, not a field to merge (see DATA_MODEL.md, "task_assignments") — unaffected
by this phase, since assignment mutations are not offline-queueable at all.

## V3 — not implemented, architecturally anticipated

- Natural-language task creation.
- "Plan My Day."
- AI scheduling.
- Automatic rescheduling **with user confirmation** — the product brief is explicit that AI
  must act as a planning engine that proposes changes, not one that silently rewrites a
  family's schedule. Any V3 design must keep a human-confirmation step in the write path.
- Family conflict resolution (AI-assisted, distinct from the V2 conflict _detection_ above).
- AI family planning.

Architectural note for V3: because `events`, `responsibilities`, and `tasks` are already
separate, normalized entities (not a single blob a model would have to parse), an AI planner
can read/propose against structured queries instead of reverse-engineering free text. This is
the main reason the "event ≠ responsibility" rule in [PRODUCT.md](PRODUCT.md) matters now,
years before AI planning is built.
