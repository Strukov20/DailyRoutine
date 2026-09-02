# Roadmap

Three horizons. MVP is defined in full in [MVP_SCOPE.md](MVP_SCOPE.md); this file focuses on
V2/V3 and how the current architecture leaves room for them without a rewrite.

## MVP

See [MVP_SCOPE.md](MVP_SCOPE.md).

## V2 — not implemented, architecturally anticipated

| Feature                                      | Where the architecture leaves room                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Calendar / Apple Calendar integration | `events` will gain an `external_source` + `external_id` pair (nullable) so a synced event is distinguishable from a native one without a new table. Sync itself would be a Supabase Edge Function, not client code, to keep provider tokens off the device.                           |
| Week and Month calendar views                | The Calendar screen already renders from a date range, not a single hardcoded day; adding view modes is a UI-layer change over the same query shape.                                                                                                                                  |
| Conflict detection                           | Needs events + responsibilities to already be queryable per member per time range — the separate `events`/`event_participants`/`responsibilities` tables (DATA_MODEL.md) are exactly the shape this requires. Actual detection is a Postgres function or Edge Function, run on write. |
| Subtasks                                     | `tasks.parent_task_id` (nullable, self-referencing) is the anticipated column; not added now to avoid an unused foreign key in the MVP schema.                                                                                                                                        |
| Attachments                                  | A `task_attachments` / `event_attachments` table referencing Supabase Storage objects, with RLS mirroring the parent record's visibility.                                                                                                                                             |
| Shared shopping lists                        | Likely its own `lists` + `list_items` pair rather than overloading `tasks` — a shopping item isn't a task (no assignee-accept workflow, no priority). Decide at design time, not now.                                                                                                 |
| Widgets                                      | Native, platform-specific; needs a lightweight read API (a Postgres view) that a widget extension can hit without pulling in the full app bundle.                                                                                                                                     |
| Comments                                     | A `comments` table polymorphic on (entity_type, entity_id), RLS mirroring the parent entity's visibility rule.                                                                                                                                                                        |
| Advanced offline sync                        | See "Offline behavior" below — this is the biggest architectural lift in V2 and deserves its own design pass before implementation.                                                                                                                                                   |
| Statistics                                   | Derived entirely from existing tables via read-only aggregate queries/views; no new write-path tables needed.                                                                                                                                                                         |

### Offline behavior: MVP vs. V2

**MVP**: cached read access to the last successfully loaded data (TanStack Query's cache,
persisted — see ARCHITECTURE.md), a visible offline indicator, safe retries on reconnect, and
optimistic updates only where a rollback is trivial and safe (e.g., toggling a task's
completion — never a multi-step operation like accepting an assignment). The MVP does **not**
claim full offline-first sync. Nothing in the codebase should describe itself that way unless
it has actually been implemented and tested against real conflict scenarios.

**V2 conflict-resolution rules (to design before building, not to build now)**:

- Every mutable row needs a monotonic `updated_at` (already planned — see DATA_MODEL.md,
  "Audit-relevant timestamps") and ideally a `version` integer for optimistic concurrency.
- Default rule: last-write-wins on `updated_at`, **except** for fields with product-specific
  semantics where last-write-wins is actively wrong — e.g., two people marking a shared task
  "complete" concurrently should not race; a completion should be idempotent (first one wins,
  second is a no-op, not an overwrite).
- Assignment Accept/Decline is not a field to merge — it is an audit-logged event (see
  DATA_MODEL.md, "task_assignments"), so "who decided last" is always reconstructable even
  if two clients raced.
- Client-side conflict UI (e.g., "this was changed elsewhere, keep yours or theirs?") is a V2
  UX design task, not something to improvise inside a mutation hook.

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
