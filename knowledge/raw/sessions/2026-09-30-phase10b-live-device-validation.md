# 2026-09-30 — Phase 10B: live device validation (three real bugs, one UI gap)

Continuation on `release/mvp-beta`, three weeks after the last session on this branch. The
repo owner had, in the interim and outside any agent session, manually applied the Staging
project's Auth Site URL/redirect allowlist via the Supabase Dashboard (the concrete "Next
Stage B step" the Phase 10B Auth audit had identified) and begun exercising the app live on a
real iOS Simulator, pointed at the linked Staging Supabase project (`.env.local`'s
`EXPO_PUBLIC_SUPABASE_URL=https://ocurkeddkqkeitjfbcbe.supabase.co`, confirmed by the repo
owner directly, not read from the file). This is the first genuine device-level exercise of
the app this phase has had. Conducted as live, interactive debugging (a real console error
pasted, back-and-forth diagnosis) rather than a scoped audit brief.

## What this session found and fixed

1. **A real cache crash, root-caused from a pasted console error alone** (no device log
   access): `TypeError: undefined is not a function` at `patchTaskInCache`
   (`src/domain/tasks/hooks.ts:120`) when marking any task complete from Today.
   `queryClient.getQueriesData({ queryKey: ['tasks'] })` matches by prefix, so it also returns
   `taskKeys.detail(taskId)` entries — a single `Task` object from `useTask()`, not a `Task[]`
   — whenever the user had recently viewed that task's own edit screen; `data.map(...)` then
   throws on the non-array. The `<Task[]>` generic is compile-time only and doesn't change
   runtime behavior; a cached single object is truthy, so the pre-existing `if (!data)
   continue` guard never caught it. Fixed all three affected helpers
   (`patchTaskInCache`/`removeTaskFromCache`/`findCachedTask`) with `Array.isArray(data)`.
   Added a regression test seeding a `taskKeys.detail` entry alongside a list query — no
   existing test had ever done this. Commit `0619bf8`.
2. **Two follow-up reports that turned out to be correct, by-design behavior, not bugs** —
   traced via code/docs rather than assumed either way: "Calendar shows nothing, Today/Inbox
   only show items created this session" was the Staging project's own empty database (no
   seed data — all old test data lived in the local Docker stack, a different database
   entirely), combined with a real architectural asymmetry (Today/Inbox insert optimistically
   on create, Calendar's event-create mutations don't); "a task created on Today doesn't show
   in Calendar" is the MVP's deliberate tasks-vs-events separation (`useOwnDayEvents` reads
   only `events`, never `tasks`); "can't assign a child a responsibility in Family calendar" is
   an intentional two-layer rule (UI picker sources only `adults`; the RPC raises `22023` for a
   non-adult assignee) — a child has no account and can't accept/decline.
3. **A real, confirmed-live functional bug**: swiping back natively on `EventEditorForm`/
   `TaskEditorForm` with unsaved changes made the "unsaved changes?" dialog's Cancel and
   Discard buttons behave identically (form closed either way) — reported directly by the
   user after a targeted question ("swipe gesture specifically, or the header back button?").
   Root cause: native-stack can finish removing a screen at the native layer before the JS
   `beforeRemove` listener's `event.preventDefault()` ever runs for a swipe gesture
   specifically — a documented React Navigation limitation, not fixable by the listener alone.
   Fixed by disabling the gesture itself while the form is dirty
   (`navigation.setOptions({ gestureEnabled: !isDirty })`), closing the race before it starts.
   Found, in the process, that both test files' `useNavigation` mocks were missing
   `setOptions` entirely — added it, fixing all 16 existing tests in both files that the new
   code broke, plus 2 new regression tests. Commit `9f09ff7`.
4. **A real UI gap, found by the user asking "as how do I revoke [a lost invitation link]?"**:
   `revoke_family_invitation`/`useRevokeFamilyInvitation` had existed and been tested since
   Phase 3, but no screen ever called the hook — `app/(app)/family.tsx`'s pending-invitations
   list was read-only. Added a trailing icon-button revoke action per row, following this
   screen's own existing `Alert.alert`-confirmation pattern exactly (destructive style, no-op
   Cancel, safe error message). New en/uk i18n keys, 3 new tests. Commit `cb22684`.

## Documentation debt closed this same session (requested explicitly, after initially skipped)

The three live fixes above were committed without an accompanying docs/wiki pass at the time
— a real miss against this repo's own "after any material task, update the wiki before
reporting done" rule, caught only when the user later asked for a general status check. Closed
retroactively: new `docs/DECISIONS.md` "Phase 10B live device validation" section; a new
"Conventions established" bullet in `docs/TEST_STRATEGY.md` about the
`getQueriesData`-prefix-match test gap; `docs/RELEASE_CHECKLIST.md`'s Auth Site URL row and
stale Jest test count both corrected; `docs/DEPLOYMENT.md`'s "0a" section updated from "not yet
applied" to "now applied" (the repo owner's own manual Dashboard action); this wiki page and
`domain/family-spaces.md` updated; this raw record and the `log.md` entry below.

## Deliberately not done this session

- No further Stage B action (iOS credentials, a real build, TestFlight) — still blocked on an
  Apple Developer Program membership, unchanged from prior sessions.
- No fix attempted for "tasks and events don't merge in Calendar" or "children can't be
  assigned responsibilities" — both confirmed intentional product scope, not bugs, and neither
  was requested as a change.

## Verification

`npm run verify` — 65 suites / 582 tests (up from 576 before this session's three fixes),
lint/typecheck/wiki:lint all clean. Each of the three fixes was verified in isolation
(targeted `jest` runs) before every full-suite re-run. No migration or RPC changed this
session — all fixes are client-only.
