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

## Status at this write-up (superseded — see "Continuation" below)

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

## Continuation: checkpoint verification, commits, backend integration, Maestro (same phase)

This section covers everything the "Not yet done" list above named, completed in a later
continuation of this same session/branch. Nothing in the sections above was revised; this is
additive, per this project's append-only convention for raw evidence.

### Checkpoint verification — all green

Full re-run: Prettier check, `tsc --noEmit`, `eslint .`, full Jest (172/172, 28 suites, same
count as before — no regressions from the work below), `wiki:lint`, `supabase db reset` +
`supabase test db` (263/263 pgTAP), `npx expo config`, `npx expo-doctor` (20/21 — one
pre-existing, unrelated patch-version drift between installed and SDK-expected Expo/
expo-router/expo-notifications versions, out of scope to fix here given this repo's
deliberate dependency-pinning philosophy — see DECISIONS.md), `npx expo export
--platform ios` and `--platform android` (both succeeded, produced valid bundles).

### Git commits (branch `feature/shared-family-tasks`, nothing pushed or merged)

Three new commits on top of the seven from the prior write-up:

1. `fix: avoid spurious unsaved-changes prompt after a successful task save` —
   `TaskEditorForm.tsx`'s `beforeRemove` race fix (see DECISIONS.md for the full root cause).
2. `test: add stable testIDs and screenId disambiguation for E2E automation` — testID/
   screenId additions across ~15 source files, plus the sign-in password show/hide toggle and
   `onSubmitEditing` wiring.
3. `test: add Maestro E2E flows for personal and shared family task workflows` —
   `.maestro/*.yaml`, `scripts/e2e-seed.sh`, `scripts/e2e-ios.sh`, the two new npm scripts.

(The testID additions were deliberately split from the `TaskEditorForm.tsx` bug fix into two
commits even though both touch the same file, since one is a real behavior fix and the other
is test instrumentation — kept separable in history.)

### Real multi-user backend integration

Ran the ad hoc bash + curl + jq script (not committed, matching Phase 3/4 precedent) against a
real local Supabase stack: two real `auth.users` accounts (admin-API created, since local
email confirmation is on and blocks the public signup flow) plus a genuine outsider account
and an anonymous request. **32/32 checks passed** — family creation/invite/accept, shared task
creation, assign/accept/decline, real concurrent Take Task (parallel `curl`, not simulated),
self- and other-target reassignment, completion/restore, member removal resolving assignments
across two tasks simultaneously, privacy isolation, and full audit-trail sequence validation.
Three script bugs found and fixed along the way, all in the test script itself, not the app —
see DECISIONS.md, "Phase 5" for the full list (bash subshell scoping, a 204-vs-200 status
check, a self-reassignment audit-row-collapse assertion).

### Maestro E2E: installed, three flows, all passing

Maestro 2.10.0 installed user-scoped (curl installer, no sudo) with its JVM dependency via
`brew install openjdk` (the Homebrew formula, not the `--cask temurin`, which needs sudo).
Wrote three flows under `.maestro/` and, for each, iterated until reaching **two consecutive
fully clean, unattended runs** (verified via each run's own `commands.json` — every command
`COMPLETED`, nothing `FAILED` — and cross-checked against real database state):

- `personal_task_smoke.yaml`
- `family_task_workflow.yaml`
- `assignment_decline.yaml`

Getting there surfaced a long chain of real, evidenced findings — each investigated with
`maestro hierarchy` (the live accessibility-tree dump), failure screenshots, and/or direct
database queries rather than guessed at, and each either fixed at its root cause or recorded
as unresolved technical debt: password/text-injection on a `tapOn` right after typing; iOS
merging a compound `Pressable`'s children into one `accessibilityText` (needs dedicated
testIDs); the leftmost/rightmost tab bar items being unmatchable by text *or* testID at all
(worked around with a coordinate tap, derived from the tab bar's own reported bounds); the
`checked` selector attribute always reporting `false` for a custom checkbox regardless of
actual state (matched real state via `text`/`value` instead); a real `TaskEditorForm`
stale-closure race causing a spurious "Discard changes?" dialog after an already-successful
save (found via Maestro, fixed at the source, independent of Maestro); and two bugs in the
flow logic itself rather than the app — a blind recovery retry that could double-submit a
task (confirmed via two rows ~2.5s apart in the database), and a blind double-tap trigger on
`AssigneePicker` that could self-assign instead of assigning to the intended member (confirmed
via a screenshot showing "Assigned to you"). Full writeup with evidence for each:
`docs/DECISIONS.md`, "Phase 5" (the individual `####`-level entries after "Maestro E2E:
installed 2.10.0..."). Genuine Maestro/XCUITest hangs (confirmed twice, different commands, no
further log output) were encountered and are documented as real, rare, tool-level flakiness —
not something flow engineering can fix — which is why "two clean runs" was the bar, not
pursued toward some larger number, per the brief's own explicit allowance to document the
exact gap rather than chase indefinite reliability.

`scripts/e2e-seed.sh` provisions the fixture users and family, additionally exporting both
members' `family_members.id`s to the gitignored `.maestro/.env.local` — needed because a
freshly-seeded member's `display_name` always falls back to the same hardcoded placeholder
(`'Owner'`/`'Family member'`), so `AssigneePicker`'s menu items can't be told apart by visible
text, only by member id. `scripts/e2e-ios.sh` wraps `maestro test`, forwarding those ids via
`-e`, and works around macOS shipping a `/usr/bin/java` stub that exists on `PATH` but errors
at runtime (so `command -v java` alone can't detect a missing real JDK). New npm scripts:
`e2e:seed`, `e2e:ios`.

### Status at this write-up (final for this phase)

Everything from the Phase 5 brief is now done: database/RPCs/pgTAP, domain layer, UI layer,
Jest coverage, real multi-user backend integration, Maestro installation and all three
required flows, full checkpoint verification, logical git commits, and this doc/wiki pass.
Checked README, PRODUCT, ARCHITECTURE, DATA_MODEL, SECURITY_AND_PRIVACY, and ROADMAP for
Phase-5-driven staleness rather than assuming none existed: found and fixed one real
inconsistency in `docs/PRODUCT.md`'s "Assignment workflow" section, which claimed "the
recipient is notified" (contradicting `SECURITY_AND_PRIVACY.md`'s own accurate "Not yet
implemented: assignment/response notifications" line — only an in-app pending-count badge
exists this phase, not push notifications) and pointed to DATA_MODEL.md's `task_assignments`
shape as "proposed" when Phase 5 had since implemented it exactly as described there
(confirmed against the actual `action` check constraint in
`supabase/migrations/20260902120500_tasks.sql`). ARCHITECTURE, DATA_MODEL, and
SECURITY_AND_PRIVACY were otherwise already accurate to what Phase 5 built; README/MVP_SCOPE/
ROADMAP don't discuss testing infrastructure at a level Maestro would touch. Nothing pushed or
merged to `main`.

## Closure pass: Expo Doctor fix and Maestro tap hardening

A follow-up request asked for two specific hardening items before final close-out, plus a
consolidated report. Both are additive to everything above.

### Expo Doctor: real patch-version drift, resolved not pinned

`expo-doctor` was at 20/21 — `expo`/`expo-router`/`expo-notifications` a patch behind. Traced
via `git log` to this repo's very first commit (not introduced by Phase 5 or this branch); the
declared `~57.0.x` ranges already permitted the newer patches, `node_modules`/
`package-lock.json` were just frozen at initial-install versions. Confirmed via `npm view
<pkg> versions` that the expected versions genuinely exist and satisfy the existing ranges - a
pure lockfile refresh, not a new pin. Fixed via `npx expo install --fix`, followed by a real
native rebuild (`expo-router`/`expo-notifications` ship native code, so the JS-only `expo
export` alone wouldn't exercise it): `rm -rf ios/Pods ios/Podfile.lock && npx pod-install &&
npx expo run:ios`. Full re-verification after: Prettier, `tsc`, ESLint, 172/172 Jest,
`wiki:lint`, a fresh `db reset` + 263/263 pgTAP, both `expo export` platforms - all clean.
`expo-doctor` now 21/21.

### Maestro coordinate-tap hardening: a real semantic fix found, and its real limit proven

Attempted to replace the "Today"/"Profile" coordinate-tap workaround with a semantic selector,
per the follow-up request's explicit instructions. Found the actual bug in the earlier
investigation: `tabBarTestID` (tried and abandoned as "not respected by Expo Router") was
simply the wrong prop name - the real one, found by reading
`node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js`, is
`tabBarButtonTestID`. Added it to every `Tabs.Screen` in `app/(app)/_layout.tsx` and confirmed
via `maestro hierarchy` that it now genuinely reaches the native element (`resource-id:
"tab-<name>"`) for all five tabs, not just `accessibilityText`.

This is a real, valuable fix, kept in production: every middle tab (`Calendar`, `Inbox`,
`Family`) now matches by a stable id in all three flows instead of text reliant on the
accessibility-merging behavior documented elsewhere. But it does **not** fix the two boundary
tabs. With the confirmed-correct testID in hand, `tapOn: { id: "tab-profile" }` was run 3 times
in isolation - Maestro logged `COMPLETED` every time, and the screenshot taken immediately
after each run still showed the previous tab selected. This is conclusive: the element
resolves correctly by every selector tried (text, testID); the touch dispatched at its
resolved position simply doesn't register with the app. The one property "Today" (leftmost)
and "Profile" (rightmost) share that no middle tab does is their bounds sitting flush against
the screen's own edge on this iPhone 17 Pro / iOS 26.5 Simulator - a real Maestro/XCUITest
coordinate-delivery limitation for edge-flush elements, not a selector problem and not fixable
from this app's code.

Kept the percentage-based coordinate tap (not absolute pixels) for exactly these two spots
across the three flows, each now documented with this stronger, conclusive evidence rather
than the earlier, more speculative "plausible edge case" wording. A secondary finding from this
investigation: the identical "`COMPLETED`-but-silent-no-op" signature was also observed twice,
non-deterministically, on a genuine middle tab (`tab-inbox`) during repeated verification runs
- always clean on an immediate retry with no code change. This generalizes the existing
"genuine Maestro/XCUITest hangs" technical debt entry: the same rare tap-delivery failure mode
apparently doesn't always manifest as a hang with dead output: it can also manifest as a false
`COMPLETED`. Practical rate observed: near-100% at the two edge positions, roughly 2-in-10
elsewhere, never seen to survive a retry.

All three flows re-verified with two consecutive fully clean, unattended runs each after every
change in this pass (five additional full end-to-end runs total across the debugging and
verification process, on top of the two each already recorded above).
