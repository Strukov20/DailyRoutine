# Phase 8 production-surface cleanup: remove the temporary dev-diagnostics route

**Date:** 2026-09-08
**Branch:** `feature/recurring-tasks-reminders` (same branch as the rest of Phase 8).

## Context

The prior validation pass added `app/dev-diagnostics.tsx`, a `__DEV__`-only screen used to
obtain real on-device notification evidence without depending on the broken
`react-native-paper` `<Menu>` (see
[`2026-09-08-phase8-final-validation.md`](2026-09-08-phase8-final-validation.md)). This pass
removes it before merge, confirms its absence from every production surface, and preserves the
evidence it produced as a historical record rather than a claim that the screen still exists.

## What was removed

- `app/dev-diagnostics.tsx` deleted outright.
- `app/_layout.tsx`'s conditional route registration
  (`{__DEV__ ? <Stack.Screen name="dev-diagnostics" ... /> : null}`) removed.
- Confirmed via `grep -rn "dev-diagnostics"` across `app/`, `src/`, and `app.config.ts`: zero
  remaining references.

## What was preserved untouched

Every production function the diagnostic screen called lives in its own file, independent of
the screen: `requestNotificationPermission`/`getNotificationPermissionStatus`
(`src/lib/notifications/notificationService.ts`), `reconcileReminders`
(`src/lib/reminders/reminderReconciliation.ts`), `expoLocalScheduler`
(`src/lib/reminders/localNotificationScheduler.ts`), and `useReminderNotificationActions`
(Snooze/Done/tap handling, `src/lib/reminders/useReminderNotificationActions.ts`). None of them
imported from or depended on the diagnostic screen — it only ever called them. Removing the
screen touched none of these files.

## Documentation: evidence preserved, existence corrected

`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STRATEGY.md`, and the wiki pages
(`engineering/recurring-tasks-and-reminders.md`, `engineering/testing-strategy.md`) all
described the diagnostic screen in present tense, as something that existed. Each was edited to
state plainly that the screen was **temporary** and has **since been removed before merge**,
while keeping the actual evidence list (permission grant, push-token independence, scheduled-
key/fire-time proof, delivery observed twice, reschedule, delete, past-skip) intact — the
findings are still true and still worth recording; only the "screen still exists" implication
was corrected. `knowledge/raw/` entries and `knowledge/wiki/log.md` entries are append-only by
this repository's own convention (immutable evidence / never edit a past log entry) — the prior
raw session file describing the diagnostic screen's creation was left as-is (it accurately
describes what was true at the time), and this cleanup gets its own new raw file and log entry
instead of retroactively rewriting that one.

## Verification that the removal is real, not just source-level

Ran both production exports and checked each of the four surfaces the brief asked for:

1. **Expo Router route output** — `npx expo config --type public --json | grep -i diagnostic`
   and inspection of the route manifest: no `dev-diagnostics` route exists (the file is gone,
   so expo-router's file-based routing has nothing to discover).
2. **Generated bundles** — `npx expo export --platform ios` and `--platform android`, then
   `grep -r "dev-diagnostics"` and `grep -r "DevDiagnostics"` across both output directories:
   zero matches in either the JS bundle or `metadata.json`.
3. **Source references reachable from production** — `grep -rn "dev-diagnostics"` across `app/`
   and `src/`: zero matches (the only remaining matches repo-wide are in `docs/`/`knowledge/`,
   which are documentation, not shipped code).
4. **Public Expo config** — `npx expo config --type public`: no scheme entry, deep-link route,
   or plugin configuration references it (it was never registered there in the first place —
   expo-router discovers routes from the filesystem, not from `app.config.ts`).

## Verified

`npm run verify`: lint/typecheck clean, Jest (count and suite total re-confirmed clean of the
removed screen — no test imported it), `wiki:lint` clean. `npx supabase db reset && npx
supabase test db`: 461/461 (unchanged — no schema touched this pass). `deno test
supabase/functions/dispatch-notifications`: 11/11 (unchanged). `npm run e2e:recurrence`: 23/23.
`npx expo-doctor`: see the dependency-drift note below — not fixed here. Both `npx expo export`
platforms succeed with the route gone. `git diff --check`: no whitespace errors. `git status`:
clean after commit.

## Deferred: expo-doctor dependency drift, not fixed this pass

`npx expo-doctor` reports `expo` (`57.0.20` installed vs. `~57.0.21` expected) and `expo-router`
(`57.0.19` vs. `~57.0.20` expected) — new patch versions published upstream since the last
check, unrelated to any change in this session (first surfaced in the prior validation pass, at
`20/21`, still `20/21` here). Deliberately not bumped: this repository pins tooling versions
deliberately (`docs/DECISIONS.md`'s TypeScript/ESLint pinning rationale) and treats a dependency
bump as requiring its own explicit check, not something to chase incidentally while cleaning up
an unrelated dev-only screen. Left for a dedicated dependency-update pass.

## Responsible agent

Claude (Sonnet 5, via Claude Code).
