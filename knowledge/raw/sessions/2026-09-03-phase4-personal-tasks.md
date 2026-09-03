# Session: Phase 4 — Personal Tasks, Inbox, Today, Tomorrow

Date: 2026-09-03. Branch: `feature/personal-tasks` off `develop` (which contains Phase 2 +
Phase 3, merged via GitHub PR #2 outside this session — confirmed via `git log --oneline
--decorate -20` and `git branch -vv` before any edits). Continues directly from the Phase 3
session.

Note on dating: the migration file added this session is named
`supabase/migrations/20260904120000_personal_task_management.sql` (a Sep 4 timestamp) even
though the actual session date is Sep 3 — caught after the migration was already applied and
tested. Left as-is rather than renamed: migration timestamps only need to sort correctly
(this one still sorts after Phase 3's `20260903120000_family_management.sql`), and renaming
an already-applied, already-tested migration for a cosmetic date mismatch would be unnecessary
rework/risk for zero functional benefit. Every wiki/doc date this session uses the real date,
2026-09-03.

## Brief

"Continue working on the existing FamilyFlow repository. This is Phase 4: Personal Tasks,
Inbox, Today, and Tomorrow." Goal: make the app genuinely useful as a personal planner before
shared family tasks/calendar events. Explicitly out of scope: shared task assignment, Family
Today, event UI, Realtime, push notifications, shopping lists, AI planning, recurring-task
generation unless fully approved, actual notification scheduling, subtasks, attachments. Full
brief covered, in order: a security audit of the existing task schema before any UI; the full
personal-task field/lifecycle scope; evaluating direct-table-mutation safety and building RPCs
where needed; delete/soft-delete semantics; Inbox/Today/Tomorrow screen behavior; a reusable
task editor; categories (system + basic custom); date/timezone correctness with deterministic
tests; a recurrence boundary decision; a reminder boundary decision; screens/hooks/repository
architecture with TanStack Query and scoped optimistic updates; reusable, accessible UI
components; pgTAP + Jest test matrices; a real local multi-user verification flow; a native
runtime smoke test if available; doc/wiki updates; commits; a final report. Final instruction:
"Begin with repository and Wiki inspection and present a concise execution plan before
editing."

## Section 1 — security audit (performed before any new code)

- Confirmed `recurrence_rules` already has zero grants/policies (Phase 2 design) — Section
  11's "keep recurrence hidden" requirement is already true at the DB level, nothing to fix.
- Confirmed `reminders`' existing grants are already safe (`WITH CHECK profile_id =
  auth.uid()` on every operation) — no gap there.
- **Real finding**: `tasks` granted raw `INSERT`/`UPDATE`/`DELETE` to `authenticated`. The
  `UPDATE` policy's `WITH CHECK` protected only `owner_profile_id` — nothing stopped a client
  from directly rewriting `family_id`/`assignee_member_id`/`assignment_status` on their own
  task, bypassing the `task_assignments` audit trail, and nothing revalidated
  `is_family_member` on `UPDATE` the way `INSERT` did (an owner could attach their task to a
  family they don't belong to; since `family_task_board`'s authorization is the *viewer's*
  membership, not the *owner's*, that family's real members would then see it). Fixed by
  revoking all three grants and replacing every mutation with an RPC, continuing the Phase 3
  pattern.
- **Real finding**: no `CHECK` tied `start_time` to `date` — a task could have a time with no
  date at all (ambiguous). Fixed with `tasks_time_requires_date`.
- **Minor finding**: `duration_minutes` had no upper bound. Fixed with
  `tasks_duration_minutes_bounded` (1–1440).
- **Real finding**: `categories_family_owner_manages_custom` was a dead `for all` policy with
  zero backing grant (same dead-policy pattern Phase 3 found for `family_members`/
  `family_invitations`) — custom category creation never actually worked. Fixed with
  `create_custom_category`.
- **Explicitly not changed**: `DATA_MODEL.md` already documents `visibility = 'family'` with
  `family_id IS NULL` as intentional "ignored, not invalid" — no constraint added against it,
  to avoid silently overriding a prior, deliberate design decision.
- No `deleted_at`/soft-delete concept existed yet on `tasks` — added per the brief's own
  "prefer soft deletion" guidance.

## Sections 2–4 — schema and RPCs

One migration, `supabase/migrations/20260904120000_personal_task_management.sql`:
`create_personal_task` (accepts the full optional field set including an initial schedule —
covers both quick-add and full create in one call), `update_personal_task` (content fields
only — title/description/priority/category/visibility/family_id; unsupplied parameters leave
the field unchanged; `description`/`category_id` use an explicit clear flag, same pattern as
Phase 3's `update_child_profile`), `complete_personal_task`/`restore_personal_task` (both
idempotent), `schedule_personal_task` (requires `date`; wholesale-replaces
`start_time`/`duration_minutes`/`timezone` rather than merging — also how "move to
Today"/"move to Tomorrow"/manual reschedule all work, the client just picks the date),
`move_task_to_inbox`, `delete_or_archive_personal_task` (soft delete, idempotent, no undelete
this phase), and `create_custom_category`. None of the task RPCs ever accept
`owner_profile_id`, `assignee_member_id`, or `assignment_status` as a parameter.

`supabase/tests/090_personal_task_management_test.sql` (56 assertions) covers every RPC's
success/failure paths per persona (owner, same-family non-owner, outsider, anon), the two new
CHECK constraints, idempotency of complete/restore/archive, soft-delete exclusion from every
read path including the owner's own, cross-family rejection, and a secret-marker sweep through
`family_task_board` extending `060_privacy_regression_test.sql`'s pattern to the new RPC write
path. One real bug caught while writing it: the "family visibility + custom category" test
initially omitted `p_family_id`, tripping `assert_task_integrity`'s category-must-belong-to-
the-task's-own-family check — correctly caught the trigger doing its job, not a trigger bug.

`npx supabase db reset && npx supabase test db`: **192/192 assertions pass** (136 Phase 2+3 +
56 Phase 4), against a real local Postgres instance. One pre-existing Phase 2 pgTAP assertion
(`040_tasks_and_assignments_test.sql`'s cross-family-assignee-via-UPDATE test) was updated to
expect `42501` instead of `23503` — a strictly stronger guarantee (no field at all can be
written via direct `UPDATE` now, not just that one), documented inline at the change site.

## Sections 5–9, 13–14 — application layer

`src/domain/tasks/{types,mappers,dateUtils,sections,schemas,errorMessages,hooks}.ts` +
`src/lib/tasks/taskService.ts`, plus `src/domain/categories/*` + `src/lib/categories/
categoryService.ts`, mirroring the Phase 3 family-feature pattern exactly.
`src/domain/tasks/dateUtils.ts` is dependency-free and never round-trips a date-only value
through `Date`'s UTC-based ISO parsing/formatting — every function builds/reads `Date`s via
the local 4-argument constructor and local getters only; "YYYY-MM-DD" strings are compared
lexicographically where possible instead of being parsed at all. `src/domain/tasks/
sections.ts` is pure bucketing/sorting logic (`buildDaySections`/`buildTodaySections`) kept
fully separate from both the transport layer and presentation components.

Query invalidation (`invalidateTaskLists()`) is scoped to exactly the four lists the UI
mounts (Inbox, today's overdue bucket, today's date, tomorrow's date), not the whole cache.
Only `useCompletePersonalTask`/`useRestorePersonalTask` are optimistic — `onMutate` snapshots
every mounted task-list query and patches the target task, `onError` restores that exact
snapshot; every other mutation waits for server confirmation.

UI: `app/(app)/inbox.tsx` (quick-add + FAB-launched full editor, active/completed sections),
`app/(app)/today.tsx` rewritten (overdue/timed/anytime/completed, sorted per `sections.ts`,
plus a header link to Tomorrow), `app/tomorrow.tsx` (a new top-level route, not a sixth
bottom-nav tab, reachable from Today's header — registered in `app/_layout.tsx`'s signed-in
`Stack.Protected` block like `task/new`), `app/task/new.tsx` rewritten and `app/task/[id]/
edit.tsx` added, both rendering a shared `src/components/tasks/TaskEditorForm.tsx` (react-
hook-form + `taskEditorSchema`, unsaved-change confirmation via `useNavigation().addListener
('beforeRemove', ...)` — imported from `expo-router`, not `@react-navigation/native`, per this
project's own navigation-import rule). Reusable components in `src/components/tasks/`: `TaskRow`,
`TaskSectionList`, `QuickAddInput`, `DateTimeField`, `PriorityIndicator`, `CategoryBadge`,
`OverdueIndicator`, `CompletionCheckbox`, `TaskActionMenu`. Priority/overdue indicators are
icon+text, never color-only (accessibility requirement). `CompletionCheckbox` has a 44×44
touch target regardless of its visible icon size and `accessibilityRole="checkbox"` +
`accessibilityState.checked`.

Two native modules added via `npx expo install`: `@react-native-community/datetimepicker`
(task editor date/time fields — needed a manual `app.config.ts` plugin entry, since `expo
install` couldn't write to the dynamic TypeScript config automatically) and `@react-native-
community/netinfo` (real connectivity for a visible offline banner and for TanStack Query's
`onlineManager`, wired per the official React Native integration recipe in `src/lib/query/
onlineManager.ts`). Both need a native rebuild before they're testable on-device — not done
this session, same situation as `expo-clipboard` in Phase 3.

## Sections 15–16 — test coverage

pgTAP: covered above (192/192). Jest: 21 new/changed test files across domain logic
(`dateUtils`, `sections`, `schemas`, `mappers`, `errorMessages` for both tasks and
categories), services (`taskService`, `categoryService`), hooks (`useCompletePersonalTask`'s
optimistic update **and its deterministic rollback on a simulated server failure**), and
components (`TaskRow`, `QuickAddInput` — accessibility state, duplicate-tap and double-submit
prevention). Full suite: **127/127 Jest tests, 23 suites**, plus lint/typecheck/wiki:lint all
clean.

Two real environment quirks surfaced and now recorded in `docs/TEST_STRATEGY.md`:

- `process.env.TZ` reassignment at runtime reliably changes `Date`'s local-time output in
  plain Node (confirmed via `node -e`) but is **not** reliably honored inside this project's
  `jest-expo` test environment. Since every `dateUtils` function takes "now" as an explicit
  already-local `Date` rather than reading ambient timezone state, this doesn't affect
  correctness — the per-zone test wrappers guard against a future implementation that does
  start reading ambient state.
- A `renderHook` test that appears to hang in a piped/backgrounded shell often isn't actually
  hung — this session repeatedly saw a suite finish internally in under a second, then take
  much longer to report completion, printing Jest's own "did not exit one second after the
  test run" warning. Wasted real time chasing this three separate times before recognizing the
  pattern; recorded explicitly so it isn't re-chased next phase. One genuine fix was needed
  along the way: wrapping an imperative `result.current.mutate(...)` call in `act(async () =>
  {...})`, without which a subsequent `waitFor` could fail to observe the state update.

## Section 17 — real multi-user verification

A curl-driven script against the live local stack created two real `auth.users` accounts
(owner, member — same family, via the Phase 3 RPCs), signed each in for a real JWT, and drove
the full personal-task lifecycle through PostgREST: create (title-only) → appears in Inbox →
schedule for Today with no time (Anytime) → add a time+duration (moves to timed) → edit
title+priority → complete → restore → move to Tomorrow → return to Inbox → archive → confirmed
gone from the owner's own active queries → confirmed a same-family member gets zero rows for
the owner's private task via the base table → confirmed an anonymous request is rejected (both
a raw `SELECT` and a `create_personal_task` call) → confirmed a same-family member cannot
obtain a private task's secret-marker title via `family_task_board` (row still appears,
Busy-equivalent) → confirmed a Family-visible task exposes its real title.
**20/20 checks passed** (one initial test-script assertion mistake corrected along the way:
`schedule_personal_task` returns `void`, so PostgREST answers `204`, not `200` like
`create_personal_task`, which returns a `uuid` — a PostgREST convention, not an app bug). The
local DB was reset afterward to discard the ephemeral E2E accounts and reconfirm the pgTAP
suite passes clean on the migrations alone.

## Section 18 — native runtime smoke test

Not performed this session — see the final report for the explicit reason (no simulator/
device check was run; `expo export`/`expo-doctor` were run and are explicitly not a substitute,
per the brief's own instruction not to claim native verification from `expo export` alone).

## Section 19 — docs/wiki updates (this pass)

`docs/DECISIONS.md` (new "Phase 4" section, nine entries covering both audit findings and
every architectural choice), `docs/DATA_MODEL.md` (`tasks` table additions, new "Recurrence"/
"Reminders" subsections, ownership-summary read/write split), `docs/SECURITY_AND_PRIVACY.md`
(new Implementation-status bullet for the `tasks` UPDATE-grant finding),
`docs/ARCHITECTURE.md` (state-management boundary bullets refreshed — `pendingInviteToken` was
already stale from Phase 3 and got fixed here too — plus a new optimistic-updates rule),
`docs/ROADMAP.md` (new "MVP-scope items not yet built" section for recurrence/reminders, with
concrete proposals), `docs/TEST_STRATEGY.md` (new test rows + three new conventions),
`docs/PRODUCT.md` (stale "implemented as placeholders" navigation line fixed), `README.md`
(Phase 3 was missing from "Current state" entirely — added retroactively — plus Phase 4).
Wiki: `domain/personal-planning.md` rewritten (no longer describes placeholder screens),
`domain/tasks-and-assignments.md`, `domain/privacy-and-availability.md`,
`engineering/security-model.md`, `engineering/data-model.md`,
`engineering/system-architecture.md`, `engineering/testing-strategy.md`,
`product/roadmap.md`, `product/mvp-definition.md`, and `product/glossary.md` updated; this
file and the `log.md` entry are new.

## Outcome

Sections 1–17 completed and verified for real (pgTAP + real curl E2E), not reasoned through.
Section 18 (native smoke test) explicitly not performed and reported as such, not claimed.
Deferred and explicitly recorded rather than silently dropped: recurring-task generation and
reminder scheduling (both MVP-scope, concrete proposals recorded), native on-device testing of
the two new native modules (needs a rebuild), personal (non-family) custom categories, family
ownership transfer (carried over from Phase 3), and everything the brief itself scoped out.
