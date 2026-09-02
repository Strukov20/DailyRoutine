---
title: Events and responsibilities
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
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

## Proposal (not yet implemented)

Three tables, not one:

- `events` — title, description, location, `starts_at`/`ends_at`, `visibility`, owner or
  family, optional `recurrence_rule_id`.
- `event_participants` — who/what the event is _about_ (e.g. "this event concerns Son") —
  references `family_members`, distinct from responsibility.
- `responsibilities` — the assignable duty: `type: drop_off | pick_up | supervise | custom`
  (+ `label` when custom), `assignee_member_id` (nullable = unassigned, same shape as task
  assignment), `status: unassigned | pending_acceptance | accepted | declined | done`.

Worked example matching the swimming scenario above: one `events` row + one
`event_participants` row (Son) + two `responsibilities` rows (`drop_off` → Mom, `pick_up` →
Dad). **Editing who does pickup never touches the event row.** Full column list:
[`docs/DATA_MODEL.md`, "events" / "event_participants" /
"responsibilities"](../../../docs/DATA_MODEL.md#events).

## Current implementation

Not implemented — no event/responsibility UI or persistence exists yet (foundation phase
only). This page documents the _design contract_ the first implementation must follow.

## See also

- [Tasks and assignments](tasks-and-assignments.md) — a structurally similar but _separate_
  assignment concept; don't conflate task assignment with responsibility assignment
- [Privacy and availability](privacy-and-availability.md) — private events still contribute
  a Busy block via this same `events` table
