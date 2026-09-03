---
title: Roadmap (V2/V3)
status: current
updated: 2026-09-03
sources:
  - ../../../docs/ROADMAP.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
tags: [product, roadmap, v2, v3]
---

## Confirmed

**MVP-scope, not V2 — recurrence and reminders (Phase 4 update)**: both are in
[MVP definition](mvp-definition.md)'s in-scope list, not deferred to V2, but neither is built
yet. Recurrence needs a schema change (`recurrence_rules` currently has zero grants/policies;
a `task_occurrences` table is the anticipated shape, to preserve per-occurrence completion
history — explicitly **not** "rewrite the same task row's date on completion," which would
destroy that history). Reminders need a scheduling mechanism (a background job/Edge Function
calling Expo's push API) — `reminders` rows can already be created safely, `notification_tokens`
exists unused. Neither is exposed in the Phase 4 task editor, on purpose, so as not to imply
either does something it doesn't. See `docs/ROADMAP.md`, "MVP-scope items not yet built," for
the full proposal.

**Also still open**: family ownership transfer / an owner leaving their own family has no RPC
(`remove_family_member` unconditionally refuses to remove the `role = 'owner'` row) — see
[Family Spaces](../domain/family-spaces.md).

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

**Current (MVP-era) scope — implemented in Phase 4:** TanStack Query's `onlineManager` wired
to real connectivity (`@react-native-community/netinfo`, `src/lib/query/onlineManager.ts` —
the official React Native integration recipe) so queries pause instead of retrying against a
dead network and refetch automatically on reconnect; a visible offline banner
(`src/components/ui/OfflineBanner.tsx`) on Inbox/Today/Tomorrow; optimistic updates only for
task completion, which has a trivially safe rollback (see
[personal-planning](../domain/personal-planning.md)). Cached reads of last-loaded data are
TanStack Query's default in-memory behavior, unchanged. **Not** full offline-first sync — no
`persistQueryClient`/AsyncStorage persistence of the query cache exists yet, so cached data
does not survive an app restart; `docs/ARCHITECTURE.md` is explicit about this boundary and
the codebase must not claim otherwise.

**V2 conflict-resolution design (not yet built)**: monotonic `updated_at` (+ possibly a
`version` column) per row; last-write-wins as the default _except_ where it's actively wrong
(e.g. concurrent task completion must be idempotent, not last-write-wins); Accept/Decline is
an audit-logged event, not a mergeable field. Full detail in `docs/ROADMAP.md`.

## Unresolved

None recorded yet beyond what's already flagged inline in `docs/ROADMAP.md` (e.g. exact
shopping-list schema shape is explicitly "decide at design time, not now").

## See also

- [MVP definition](mvp-definition.md)
