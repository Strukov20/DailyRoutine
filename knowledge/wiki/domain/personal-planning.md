---
title: Personal planning
status: current
updated: 2026-09-03
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/ARCHITECTURE.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
tags: [domain, personal, tasks]
---

## Confirmed

Every adult user has a personal planner: Today, Tomorrow, Inbox (date-less tasks), tasks
(with/without a scheduled time), reminders (one or more per task), recurring tasks,
categories, priorities, and a Private/Family visibility flag per item. Calendar events remain
out of scope through Phase 4 — see [MVP scope](../product/mvp-definition.md).

**Task fields**: title, description, date, start time, duration, priority, category,
visibility, completion status (`completed_at`), soft-delete (`deleted_at`, Phase 4). Reminder
and recurrence fields exist in the schema but are not editable from the UI this phase — see
"Reminder and recurrence boundaries" below. **Only title is mandatory** — enforced both
client-side (`src/domain/tasks/schemas.ts`'s `taskEditorSchema`) and at the database layer
(`tasks.title NOT NULL`).

**Priorities**: `Normal | Important | Critical`. The client-side ordering logic
(`src/domain/tasks/priority.ts` — `getPriorityWeight`, `comparePriorityDescending`) is a
pure-function mirror of the `tasks.priority` column; keep them in sync if either changes.
`src/domain/tasks/sections.ts`'s Anytime-bucket sort uses this ordering directly.

**Default categories**: Work, Family, Home, Shopping, Health, Other — seeded as system rows
(`categories.is_system = true`, `family_id NULL`). Basic custom-category creation is
implemented (owner-only, via `create_custom_category` RPC — see
[data-model](../engineering/data-model.md)); a category's _identity_ for color/translation
lookup is `color_token`, never the stored `name` (which is plain English display text, shown
as-is only for custom categories that have no translation key).

## Current implementation (Phase 4 — complete)

Full personal-task lifecycle, entirely via `SECURITY DEFINER` RPCs (no direct
`INSERT`/`UPDATE`/`DELETE` grant on `tasks` — see
[security model](../engineering/security-model.md)): `create_personal_task`,
`update_personal_task` (content fields only), `complete_personal_task`/
`restore_personal_task` (both idempotent), `schedule_personal_task` (also how "move to
Today"/"move to Tomorrow"/manual reschedule work — it wholesale-replaces the schedule, never
merges), `move_task_to_inbox`, `delete_or_archive_personal_task` (soft delete via
`deleted_at`, idempotent, no undelete this phase).

Screens: `app/(app)/inbox.tsx` (quick-add + full editor, active/completed sections),
`app/(app)/today.tsx` (overdue / timed / anytime / completed sections, sorted per
`src/domain/tasks/sections.ts`), `app/tomorrow.tsx` (a nested top-level route reachable from
Today's header, not a sixth tab — see
[system-architecture](../engineering/system-architecture.md)). Reusable components live in
`src/components/tasks/` (`TaskRow`, `TaskSectionList`, `QuickAddInput`, `TaskEditorForm`,
`DateTimeField`, `PriorityIndicator`, `CategoryBadge`, `OverdueIndicator`,
`CompletionCheckbox`, `TaskActionMenu`).

Layering: screens → `src/domain/tasks/hooks.ts` (TanStack Query) →
`src/lib/tasks/taskService.ts` (the only module calling `supabase.rpc`/`supabase.from` for
this feature) → the Supabase client — the same pattern Phase 3 established for families. Every
personal-task list query (`listInboxTasks`/`listTasksForDate`/`listOverdueTasks`) explicitly
filters `owner_profile_id`, on top of RLS — without that filter, a family-visible task
belonging to _another_ family member would also appear in the current user's own
Inbox/Today/Tomorrow, since the base-table `SELECT` policy's `OR` branch doesn't care whose
task it is.

## Date-only tasks: the correctness rule

`tasks.date` is a plain `date` with no timezone (per the original schema design) — it stays
whatever local calendar date the client sends, never converted. `src/domain/tasks/dateUtils.ts`
exists specifically to keep it that way: every function builds/reads `Date` objects via the
local 4-argument constructor and local getters only, and never calls `new
Date(dateOnlyString)` or `.toISOString()` — both of those round-trip through UTC, which shifts
the calendar day in any non-zero-UTC-offset timezone near midnight. See
[data-model](../engineering/data-model.md) and
[DECISIONS.md, "Phase 4"](../../../docs/DECISIONS.md) for the full write-up, including a real
`jest-expo` environment quirk found while testing this (`process.env.TZ` doesn't reliably
change `Date`'s output inside Jest the way it does in plain Node).

## Reminder and recurrence boundaries — deliberately not built this phase

- **Reminders**: `reminders` rows can be created safely (existing grants are fine — see
  [security model](../engineering/security-model.md)), but nothing schedules an actual Expo
  notification from one yet. The task editor has no reminder control this phase, specifically
  so it never implies a reminder does something it doesn't.
- **Recurrence**: `recurrence_rules` has zero grants/policies, and no personal-task RPC
  accepts a `recurrence_rule_id`. A correct implementation needs per-occurrence completion
  history and duplicate-generation prevention, which the current one-row-per-series schema
  can't provide without a schema change (a `task_occurrences` table is the anticipated shape).
  **Explicitly not implemented as "rewrite the same row's date on completion"** — that
  destroys occurrence history, which is unacceptable by the brief's own explicit instruction.

Both are MVP-scope items (per `docs/MVP_SCOPE.md`), not deferred to V2 — see
[roadmap](../product/roadmap.md), "MVP-scope items not yet built," for the concrete
implementation proposal for each.

## See also

- [Tasks and assignments](tasks-and-assignments.md) — the family-facing half of task
  behavior (assignment, Take Task) — still not built; personal tasks never set
  `assignee_member_id`/`assignment_status` via any Phase 4 RPC
- [Privacy and availability](privacy-and-availability.md) — what Private visibility means,
  including the secret-marker regression proof extended to personal tasks in Phase 4
- [System architecture](../engineering/system-architecture.md) — the optimistic-completion
  rule and why only completion (not create/schedule/delete) uses it
