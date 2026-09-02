---
title: Events and responsibilities
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [domain, events, responsibilities, critical-rule]
---

## The critical domain rule

**An event and a responsibility are not the same thing.** This is the single most important
domain rule in the product — read this page before adding or changing anything event-shaped.

```text
Event:
  Swimming — Child: Son — 17:00–18:00

Responsibilities (separate records, not text on the event):
  Drop off → Mom
  Pick up  → Dad
```

An **event** answers "what, when, where" (and, via `event_participants`, "about whom" — e.g.
which child). A **responsibility** answers "who is on the hook for a specific part of it."
**Never implement drop-off/pickup as a plain text field on an event.** Doing so would make
"does anyone actually have pickup covered today?" require parsing free text instead of
running a structured query — and that query is exactly what V2 conflict detection and V3 AI
planning both depend on (see [roadmap](../product/roadmap.md)).

## Schema: implemented

Three tables, not one:

- `events` — title, description, location, `starts_at`/`ends_at`, `timezone` (required),
  `visibility`, owner or family, optional `recurrence_rule_id`.
- `event_participants` — who/what the event is _about_ (e.g. "this event concerns Son") —
  references `family_members` (composite FK to the same family), distinct from
  responsibility.
- `responsibilities` — the assignable duty: `type: drop_off | pick_up | supervise | custom`
  (+ `label` when custom), `assignee_member_id` (nullable = unassigned, same shape as task
  assignment, same same-family composite FK), `status: unassigned | pending_acceptance |
accepted | declined | done`.

Worked example matching the swimming scenario above — implemented exactly as designed and
proven by `supabase/tests/050_events_and_responsibilities_test.sql`: one `events` row + one
`event_participants` row (Son) + two `responsibilities` rows (`drop_off` → Mom, `pick_up` →
Dad). **Editing the event's own fields (tested directly: renaming it) leaves both
responsibility rows completely untouched.** Full column list:
[`docs/DATA_MODEL.md`, "events" / "event_participants" /
"responsibilities"](../../../docs/DATA_MODEL.md#events).

## Current implementation

**Schema, RLS, and integrity constraints exist** (cross-family responsibility assignment is
blocked at the database level; a `custom`-type responsibility requires a label). **UI still
doesn't** — no event/responsibility creation screens exist yet; this remains Phase 3+ work
(see [roadmap](../product/roadmap.md)).

## See also

- [Tasks and assignments](tasks-and-assignments.md) — a structurally similar but _separate_
  assignment concept; don't conflate task assignment with responsibility assignment
- [Privacy and availability](privacy-and-availability.md) — private events still contribute
  a Busy block via this same `events` table
- [Data model](../engineering/data-model.md) — the denormalized `family_id` refinement that
  enables the composite-FK same-family checks on `event_participants`/`responsibilities`
