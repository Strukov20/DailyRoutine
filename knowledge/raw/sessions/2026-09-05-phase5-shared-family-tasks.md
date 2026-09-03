# Session: Phase 5 — Shared Family Tasks, assignment workflow, and native Maestro E2E foundation

Date: 2026-09-05 (session started; work continued into 2026-09-03 real time after a
conversation-compaction boundary — see "Note on dating" below). Branch:
`feature/shared-family-tasks`. Continues directly from the Phase 4 session
(`knowledge/raw/sessions/2026-09-03-phase4-personal-tasks.md`).

Note on dating: as with Phase 4's migration file, the new migration
(`supabase/migrations/20260905120000_shared_family_tasks.sql`) carries a Sep 5 timestamp for
sort-order continuity with the phase numbering, even though real elapsed time crossed into
Sep 3 of a later calendar cycle. Left as-is for the same reason as Phase 4: migration
timestamps only need to sort correctly relative to each other, and this one does.

This write-up covers the session through database/domain/UI implementation, UI test coverage,
and two test-infrastructure investigations. **It does not yet cover** the real multi-user
backend integration script or Maestro E2E flows — both still pending as of this write-up: see
"Status at this write-up" at the end.

## Brief

Full brief reproduced in `docs/DECISIONS.md`'s Phase 5 section is out of scope for this raw
file (see the wiki pages this file backs instead); in short: resolve the Phase 4
custom-category contradiction, security-audit the new shared-task surface before building on
it, implement the assignment state machine as atomic RPCs, build the Family task board UI and
its personal-planner integration, add pgTAP + Jest + Maestro coverage, run a real multi-user
backend verification, and update docs/wiki. Explicitly out of scope: calendar events, pickup/
drop-off, Realtime, push notifications, recurring generation, reminder scheduling, shopping
lists, AI planning.

## What was built

### Database (complete, 263/263 pgTAP passing — see "Verification" below for the fresh re-run)

`supabase/migrations/20260905120000_shared_family_tasks.sql`:

- `family_members.removed_at` (soft delete) + updated `is_family_member`/`is_family_owner`/
  `current_family_ids`/the two sanitized views to filter it, + `remove_family_member` rewritten
  to soft-delete and to resolve the removed member's pending/accepted assignments back to
  `unassigned` first (with its own audit row) — the fix for a real architectural gap: none of
  the FKs referencing `family_members` specify `ON DELETE`, and `task_assignments` rows are
  permanent, so a hard delete of a member ever referenced by assignment history would raise a
  raw FK violation.
- `current_member_id(family_id)` — the caller's own `family_members.id` in a family.
- `update_personal_task` gained two guards: reject `visibility='private'` while actively
  assigned, reject a `family_id` change while actively assigned.
- Nine new RPCs: `create_shared_family_task`, `assign_family_task`, `reassign_family_task`
  (both thin wrappers over `set_task_assignment`, which itself has **zero grants to any
  role** — function-to-function only), `unassign_family_task`, `take_family_task`,
  `accept_task_assignment`, `decline_task_assignment`, `complete_shared_task`,
  `restore_shared_task`. Every state-changing one locks the task row
  (`select ... for update`) and raises `40001` on a stale/already-resolved assumption.

A self-caught bug during authoring: the first draft of the migration was missing
`set_task_assignment`'s explicit revoke from `public, anon, authenticated` — the same
Supabase-default-privileges-grants-`EXECUTE`-directly lesson from Phase 3, caught by re-reading
the migration before applying it.

`supabase/tests/100_shared_family_tasks_test.sql` — 71 assertions covering the full state
machine, outsider/cross-family/child-assignee rejection, stale-acceptance-after-reassignment,
Take Task concurrency (sequential-second-call proxy — true concurrent transactions are pgTAP's
known limit, deferred to the real backend script), completion permissions, archived-task
rejection, member removal (both pending and accepted assignments resolved), sanitized-board
visibility, and every new RPC's anon-rejection/internal-helper-unreachability check.
`supabase/tests/080_family_management_test.sql` had one assertion updated (soft-delete, not
row-count-zero) to match the new removal semantics.

### Domain layer (complete, part of the 172 Jest tests below)

`src/domain/tasks/types.ts`/`mappers.ts` gained `assigneeMemberId`/`assignmentStatus`;
`src/domain/family/types.ts`/`mappers.ts` gained `removedAt`.
`src/domain/tasks/familyBoardSections.ts` — pure, mutually-exclusive board bucketing (priority
order: completed > awaiting-my-response > mine > unassigned > assigned-to-others), unit tested
including "every task appears in exactly one section." `src/lib/tasks/taskService.ts` gained
the nine RPC wrappers plus `listFamilyTasks`/`listPendingAssignments` and a new
`'conflict'` `TaskErrorCode` mapped from SQLSTATE `40001`. `src/domain/tasks/hooks.ts` gained
the matching TanStack Query hooks — assignment-state mutations are deliberately not optimistic
(no trivially-safe rollback for a state machine transition); completion/restore on a shared
task reuse the same optimistic pattern as personal-task completion.

### UI layer (complete)

New: `AssigneeLabel`, `AssigneePicker`, `FamilyTaskRow`, `FamilyTaskBoard`
(`src/components/tasks/`). `FamilyTaskBoard` renders five sections via `SectionList`, disables
every assignment-state action while offline (a separate `disabled` prop from `isBusy`, so an
offline board never implies a mutation is in-flight — this split was mid-flight across the
session's compaction boundary and was the first thing finished on resume), and surfaces
`TaskServiceError`'s `code` as a localized message (`conflict` gets a specific "pull to
refresh" message, everything else falls back to the generic one).

`TaskEditorForm` gained an optional `sharedFamilyId` prop rather than a parallel component:
when set, the Private/Family toggle is replaced with a static notice (never a misleading
Private option on a task that must stay shared), and — create mode only — an optional Adult
assignee picker appears, backed directly by `create_shared_family_task`'s atomic assignee
param (not a separate create-then-assign call). This also resolved the Phase 4
custom-category contradiction: `create_custom_category` was real and correctly family-owner-
scoped, just never wired into any UI — now available as an owner-gated "+ New category" item
in the shared editor's category menu, matching the RPC's own authorization rather than
offering an affordance that would fail server-side for a non-owner.

New route `app/family/task/new.tsx`; `app/task/[id]/edit.tsx` now passes `sharedFamilyId` when
editing an already-shared task; `app/(app)/family.tsx` gained a Members/Tasks segmented toggle
rendering `FamilyTaskBoard`; `app/(app)/_layout.tsx`'s Family tab shows a pending-assignment
count badge (`usePendingAssignments`). All new `tasks:board.*`/`tasks:editor.*`/
`tasks:errors.conflict`/`family:tabs.*` i18n keys added to both `en`/`uk` in parity.

Confirmed the new route bundles correctly via `npx expo export --platform ios` (2145 modules)
after wiring — not just typecheck/lint, per this project's own navigation/routing-change
verification rule.

## Two test-infrastructure investigations

### 1. `SectionList` doesn't expand past its initial render window in tests

Building `FamilyTaskBoard.test.tsx`'s bucketing test, tasks in the 4th/5th section never
appeared in the rendered tree. First fix attempt: `initialNumToRender={50}` added directly to
the production `SectionList`. Before keeping it, validated whether this was a real production
concern or purely a test artifact:

- Direct experiment: removed the prop, re-ran the same test with `waitFor(..., { timeout:
  8000 })` on real timers. The missing content **never appeared**, even after 8 real seconds —
  ruling out "just needs more time" and confirming a hard cutoff.
- Root cause: `SectionList`/`VirtualizedList` expands its render window in response to real
  `onLayout`/scroll events, which never fire under `react-test-renderer` (no native layout
  engine in this test environment). This is inherent to the test environment, not to list
  size — a real device's real layout system doesn't have this problem, and RN's default
  `initialNumToRender` of 10 already expands correctly there via real scrolling.
- Conclusion: `initialNumToRender={50}` was reverted from `FamilyTaskBoard.tsx` (it only
  existed to satisfy Jest, and would force a heavier synchronous initial render for a
  genuinely large real board for no corresponding benefit). Fixed in the test file instead:
  `FamilyTaskBoard.test.tsx` mocks `react-native/Libraries/Lists/SectionList` (the specific
  source module `SectionList`'s own lazy-`require` getter resolves — mocking the top-level
  `react-native` package instead broke jest-expo's own native-module setup, surfacing as a
  `TurboModuleRegistry.getEnforcing(...): 'DevMenu' could not be found` crash) with a version
  that renders every section/row unconditionally. This tests the app's own bucketing/wiring
  logic without re-proving `VirtualizedList`'s own windowing, which is a RN library concern
  and isn't meaningfully verifiable via `react-test-renderer` regardless of prop values.

Documented in `docs/DECISIONS.md`, "Phase 5" and `docs/TEST_STRATEGY.md`.

### 2. Single-file Jest invocations hang/crash on teardown; the full suite doesn't

Every attempt to run one test file in isolation (with or without `--runInBand`) hung
indefinitely once the tests themselves had already passed, with the terminal showing zero
output — initially indistinguishable from a genuine pre-render deadlock. Root-caused via
bisection, using `script -q <file>` to force line-buffered output (Node's non-TTY stdout
buffering was hiding all progress until process exit, which never came, making a legitimate
in-progress run look identical to total silence):

1. A trivial test with zero app imports (`expect(true).toBe(true)`) → clean exit, 0.447s.
   Rules out any jest-expo preset/global-setup-level cause.
2. `AppThemeProvider` alone (renders a bare `<Text>`) → clean exit. Rules out the theme/
   navigation/PaperProvider stack.
3. Bare `QueryClientProvider` alone (no theme, no RN Paper components) → clean exit. Rules out
   TanStack Query's `focusManager`/`onlineManager` listeners as the sole cause.
4. `QuickAddInput` (uses `react-native-paper`'s `TextInput`/`IconButton`, both of which
   internally do `React.useRef(new Animated.Value(...))`) mounted with both providers →
   **crashes** (not hangs) with `ReferenceError: You are trying to \`import\` a file after the
   Jest environment has been torn down`, thrown from inside `TextInput`'s `Animated.Value`
   construction, called from `Immediate._onImmediate` (a `setImmediate` callback).

Conclusion: React 19's concurrent scheduler queues a deferred `act()` flush
(`recursivelyFlushAsyncActWork`/`flushActQueue`) via `setImmediate` to finish work *after* the
test function itself has returned. In an isolated single-file run, nothing holds the process
open long enough for that callback to fire before Jest begins tearing down that file's module
registry — the callback then tries to lazily `require` `react-native`'s `Animated` export and
finds the registry gone. `--detectOpenHandles` was run per this session's own verification
requirement and reported nothing across multiple runs — consistent with the culprit being a
scheduled callback, not a standard timer/socket handle its `async_hooks`-based tracking is
built to catch. In the full 28-suite run, this apparently still resolves cleanly (or is masked
by `jest-worker`'s own child-process teardown, which kills workers regardless of what's still
pending inside them) — the full suite has never hung or crashed this way.

**Decision, per explicit instruction this session**: do not add `--forceExit` to `npm test`,
`npm run verify`, or CI — it would silently paper over a real future regression in this exact
area. A manual, uncommitted `--forceExit` is fine for one-off single-file debugging. Documented
as technical debt with full evidence in `docs/DECISIONS.md`, "Phase 5, known technical debt,"
and cross-linked from `docs/TEST_STRATEGY.md`'s pre-existing (less precise) note on the same
symptom family from Phase 4.

## Status at this write-up

Done: database/RPCs/pgTAP, domain layer, UI layer (board, editor, board-wiring, i18n), UI Jest
coverage (172 tests / 28 suites), both test-infrastructure investigations above, this doc/wiki
pass. **Not yet done**: full checkpoint verification re-run (Prettier/typecheck/lint/Jest/
wiki-lint/`db reset`+pgTAP/`expo config`+`expo-doctor`/iOS+Android export, all in one pass),
logical checkpoint commits (nothing committed yet on this branch), the real multi-user backend
integration script, Maestro installation and the three required flows, and the remaining
document updates (README/PRODUCT/MVP_SCOPE/ARCHITECTURE/DATA_MODEL/SECURITY_AND_PRIVACY/
ROADMAP). This wiki update is intentionally not the final one for this phase — a further
update is planned once the backend integration and Maestro flows have actually run, per this
session's own explicit instruction not to treat this pass as complete.
