---
title: Personal planning
status: current
updated: 2026-09-08
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/ARCHITECTURE.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
tags: [domain, personal, tasks, phase8]
---

## Confirmed

Every adult user has a personal planner: Today, Tomorrow, Inbox (date-less tasks), tasks
(with/without a scheduled time), reminders (one or more per task), recurring tasks,
categories, priorities, and a Private/Family visibility flag per item. Calendar events remain
out of scope through Phase 4 — see [MVP scope](../product/mvp-definition.md).

**Task fields**: title, description, date, start time, duration, priority, category,
visibility, completion status (`completed_at`), soft-delete (`deleted_at`, Phase 4), plus
recurrence (`recurrence_rule_id`) and reminders since Phase 8 — see
[recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md). **Only title
is mandatory** — enforced both
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

## Reminders and recurrence — built in Phase 8

Both were MVP-scope items long documented here as "deliberately not built this phase" — now
delivered. A personal task can carry a recurrence rule (Daily/Weekly/Monthly/Yearly/Custom,
generating real `task_occurrences` rows into a rolling horizon, never a rewrite of the same
row's date on completion — that would destroy occurrence history) and one or more reminder
definitions (absolute or relative, scheduled as a device-local `expo-notifications` entry, not
a server dispatch). Full design, the bounded-materialized-occurrences architecture, the
reconciliation model, and a genuine `<Menu>` interaction limitation confirmed via live
on-device testing: [recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md).

## See also

- [Recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md) — the full
  Phase 8 design
- [Tasks and assignments](tasks-and-assignments.md) — the family-facing half of task
  behavior (assignment, Take Task) — still not built; personal tasks never set
  `assignee_member_id`/`assignment_status` via any Phase 4 RPC
- [Privacy and availability](privacy-and-availability.md) — what Private visibility means,
  including the secret-marker regression proof extended to personal tasks in Phase 4
- [System architecture](../engineering/system-architecture.md) — the optimistic-completion
  rule and why only completion (not create/schedule/delete) uses it
