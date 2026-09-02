---
title: Roadmap (V2/V3)
status: current
updated: 2026-09-02
sources:
  - ../../../docs/ROADMAP.md
tags: [product, roadmap, v2, v3]
---

## Confirmed

**V2 (not implemented, architecturally anticipated):** Google/Apple Calendar integration,
Week/Month calendar views, conflict detection, subtasks, attachments, shared shopping lists,
widgets, comments, advanced offline sync, statistics. Each has a specific anticipated schema
seam noted in [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) (e.g. subtasks →
`tasks.parent_task_id`, not yet added).

**V3 (not implemented, architecturally anticipated):** natural-language task creation, "Plan
My Day," AI scheduling, automatic rescheduling **with user confirmation** (explicit brief
requirement — AI must never silently rewrite a schedule), family conflict resolution, AI
family planning. The normalized `events`/`responsibilities`/`tasks` split (see
[events-and-responsibilities](../domain/events-and-responsibilities.md)) exists partly _for_
V3 — structured data an AI planner can query, not text it has to parse.

## Offline behavior: current vs. V2

**Current (MVP-era) scope:** cached reads of last-loaded data, visible offline state, safe
retries, optimistic updates only where rollback is trivial. Not full offline-first sync —
`docs/ARCHITECTURE.md` is explicit that this isn't implemented yet and the codebase must not
claim otherwise.

**V2 conflict-resolution design (not yet built)**: monotonic `updated_at` (+ possibly a
`version` column) per row; last-write-wins as the default _except_ where it's actively wrong
(e.g. concurrent task completion must be idempotent, not last-write-wins); Accept/Decline is
an audit-logged event, not a mergeable field. Full detail in `docs/ROADMAP.md`.

## Unresolved

None recorded yet beyond what's already flagged inline in `docs/ROADMAP.md` (e.g. exact
shopping-list schema shape is explicitly "decide at design time, not now").

## See also

- [MVP definition](mvp-definition.md)
