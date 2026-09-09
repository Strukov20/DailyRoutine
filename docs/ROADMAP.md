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
- Notifications around family ownership transfer, family deletion, or a member leaving —
  `transfer_family_ownership`/`delete_family`/`leave_family` (Phase 10) broadcast a Realtime
  `members` invalidation to affected devices so the UI updates promptly, but none of them
  enqueue a push notification the way a task assignment does; a push here remains V2.
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
| Advanced offline sync                        | A bounded subset (persisted read cache, a queue for eight safe personal-task/occurrence operations, stale-write detection *and* a full manual resolution UX — Sync Issues) was implemented across Phase 9 and its completion pass — see "Offline behavior" below. Still V2: offline editing for family/shared/event/responsibility/recurrence-series/reminder-definition data.                                                                                                                                                                                                                                                                                                                                                                                             |
| Statistics                                   | Derived entirely from existing tables via read-only aggregate queries/views; no new write-path tables needed.                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Offline behavior: implemented (Phase 9 + completion pass) vs. still V2

**Implemented, Phase 9** — pulled forward from the "V2, design before building" note this
section used to carry, because the Phase 9 brief specified this exact design explicitly (see
[DECISIONS.md, "Phase 9"](DECISIONS.md)): a persisted, profile-partitioned read cache; a
bounded, idempotent offline mutation queue for eight safe personal-task/occurrence
operations, with FIFO/bounded-retry replay on reconnect; and real stale-write **detection** —
an `expectedUpdatedAt` precondition on `update_personal_task`/`schedule_personal_task` that
raises a distinguishable conflict (errcode `40001`) rather than silently overwriting a change
made elsewhere. Optimistic updates remain limited to where a rollback is trivial and safe
(completion/restoration, plus the equivalent offline-queued case) — never a multi-step
operation like accepting an assignment, and never any family/shared mutation, which stays
disabled offline entirely.

**Implemented, Phase 9 completion pass** — conflict *resolution*: the **Sync Issues** screens
(`/sync-issues`, `/sync-issues/[operationId]`), deliberately a separate domain from the
schedule-conflict Conflict Center. Every failed offline operation gets one of four statuses
(Waiting to retry / Needs review / Cannot be synchronized / Task no longer available) and the
exact action set the brief specifies per failure type — a stale-write conflict never offers a
bare Retry, only Review changes (a real field-level local-vs-server comparison, fetched
through the authenticated repository) and Reload/Apply/Discard. Apply my change reuses the
original operation id and reapplies only the fields the original patch touched, never a
derived or full-row payload; Keep server version/Discard is terminal (never replays again).
The shared sync-status indicator now reads Synced/Syncing/Pending changes: N/Sync issues: N,
tapping through to the list. See [DECISIONS.md, "Phase 9"](DECISIONS.md) for the full
state-machine and resolution-semantics writeup.

**Still V2** — last-write-wins as a *default* rule for fields with no explicit precondition,
and a `version` integer beyond the `updated_at`-based precondition already in place. Assignment
Accept/Decline remains an audit-logged event, not a field to merge (see DATA_MODEL.md,
"task_assignments") — unaffected by either Phase 9 pass, since assignment mutations are not
offline-queueable at all. Real device network-interruption testing and native account-switch-
no-flash observation are deferred to a Phase 10 manual beta-validation matrix — not blocking,
and not claimed as observed (see docs/RELEASE_CHECKLIST.md).

### Family ownership, family deletion, and account deletion: implemented (Phase 10)

The `transfer_family_ownership`/`delete_family`/`leave_family`/`request_account_deletion` RPCs
close the gap the V2 table above used to carry — every family now has a way to change or
resolve its owner, and every account has a discoverable, self-service deletion path, both
mandatory before a real family could safely beta-test this app. See
[DECISIONS.md, "Phase 10"](DECISIONS.md) for the full design (including why account deletion
anonymizes the profile row in place rather than hard-deleting `auth.users`) and
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for what happens to each table's data.
Still V2/out of scope: an audit trail for family *deletion* itself (only ownership transfer
gets a dedicated append-only table — `family_ownership_transfers`; a deleted family's
`deleted_at` timestamp is itself a form of record, but there's no separate log of *who*
deleted it beyond that they were the owner at the time), and any UI for an operator to review
or reverse a deletion (there is no restore path this phase, same "no undelete" convention as
`tasks.deleted_at`/`events.deleted_at`).

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
