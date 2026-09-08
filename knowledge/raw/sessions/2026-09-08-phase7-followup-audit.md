# Phase 7 follow-up: audit against a more detailed brief

**Date:** 2026-09-08
**Branch:** `feature/family-calendar`, based on `develop` at `e066d9f` (includes Phase 6.1).

## Context

A much more detailed Phase 7 brief ("# Phase 7 — Family Calendar, Child Events, and
Responsibilities", 22 sections) arrived after the original Phase 7 implementation had already
been built, committed (7 commits), and rebased cleanly onto `develop`'s post-Phase-6.1 tip in
the prior session. The new brief's own working rule ("Робоче правило") was explicit: investigate
the current implementation first, never assume names/config match the brief, and only change
what a concrete problem actually requires. Followed that rule rather than re-implementing.

## What was audited

Read the full migration (`supabase/migrations/20260907120000_family_calendar.sql`), the full
pgTAP suite (`supabase/tests/120_family_calendar_test.sql`), every client file
(`src/domain/calendar/**`, `src/lib/calendar/calendarService.ts`,
`src/components/calendar/{EventEditorForm,ResponsibilityRow}.tsx`, `app/(app)/calendar.tsx`,
`app/event/**`), `scripts/e2e-calendar.sh`, i18n locale parity, and cross-checked every section
of the new brief against what already existed line by line.

## Findings and fixes

1. **Trigger-function revoke consistency (not a live vulnerability).** Three of the four new
   trigger functions in the migration (`assert_responsibility_event_is_family_visible`,
   `set_responsibility_assignment_family_id`, `apply_responsibility_assignment_action`) had no
   explicit `revoke ... from public, anon, authenticated`, unlike the fourth
   (`notifications.enqueue_event_responsibility_notification`) and unlike Phase 6's own
   established precedent for this exact situation. The Phase 6.1 `130_security_regression_test.sql`
   guard already exempts trigger functions from its anon-EXECUTE check (Postgres itself refuses
   to invoke a `returns trigger` function outside trigger context, regardless of grant) — this
   was confirmed by re-running that test both before and after the fix, unchanged pass either
   way. Fixed for consistency/defense-in-depth, matching Phase 6's own stated reasoning, not
   because anything was actually reachable.

2. **`declined`/`taken` notification event types had no direct test assertion.** The brief lists
   all four `event_responsibility.*` event types as required coverage.
   `120_family_calendar_test.sql` only directly asserted `requested` and `accepted` (plan bumped
   88 → 92 with four new assertions covering `declined`/`taken` event type + correct
   `recipient_member_id`, reusing the existing `piano_pickup_id` fixture's decline-then-take
   history rather than new fixtures). `scripts/e2e-calendar.sh` had the same gap for `taken`
   specifically — worse, the original flow had the event *owner* take back their own
   responsibility, which is exactly the self-actor/self-recipient case Mechanism 4's
   self-notification suppression exists to catch, so no `taken` row would ever have existed to
   assert on. Changed the taker to the spouse (a distinct family member from the event's
   creator) and added the assertion; left a comment explaining why the actor had to change.

3. **The Day Calendar was missing conventions every comparable screen already has.**
   `app/(app)/calendar.tsx` had no `<OfflineBanner />` (present on `today.tsx`), no
   pull-to-refresh (present on `FamilyTaskBoard.tsx`, the closest existing precedent for a
   family-wide list screen), and no retry action wired to its `<ErrorState />`. All three are
   the brief's own explicit ask (Section 12) and pre-existing patterns, not new design — added
   by mirroring `FamilyTaskBoard.tsx`'s `RefreshControl`/`onRetry` implementation exactly.

4. **Mandatory Jest UI coverage, previously deferred, now built.** The original Phase 7 pass
   explicitly deferred component/screen tests for `EventEditorForm`, `ResponsibilityRow`, and
   `app/(app)/calendar.tsx`, citing scope and the Phase-5-documented `react-native-paper`
   `<Menu>` RNTL limitation. This brief's Section 16/18 explicitly overrides that ("deterministic
   Jest UI tests are mandatory and may not be deferred"). Built all three:
   - `src/components/calendar/ResponsibilityRow.test.tsx` (9 tests) — full interaction coverage,
     mirroring `FamilyTaskRow.test.tsx`'s established pattern exactly (no `<Menu>` in this
     component, so nothing scoped out).
   - `src/components/calendar/EventEditorForm.test.tsx` (10 tests) — scoped around the unchanged
     `<Menu>` constraint: trigger buttons, disabled state, validation errors, and submitted
     mutation payloads (per kind: personal/family/child, plus edit mode) are tested; content
     inside an opened `<Menu>` is not, consistent with `AssigneePicker.test.tsx`'s own scoping
     rationale. Required an explicit-factory mock for `@/lib/calendar/calendarService` (the real
     module transitively pulls in AsyncStorage via the Supabase client — the exact gotcha
     `docs/TEST_STRATEGY.md` already documents for this class of situation).
   - `src/components/calendar/CalendarScreen.test.tsx` (12 tests) — Personal/Family modes,
     selected-day chronological rendering, member filters, Busy-block non-navigability, a
     conflict warning proven to name only the assignee (never a private title), and FAB
     navigation, both bare and pre-scoped to the active family.

   **A genuinely new environment gotcha found while building the third of these.** The Calendar
   Day view's test was first written as `app/(app)/calendar.test.tsx`, co-located with the
   screen — the same convention every other test file in this codebase follows relative to its
   source. It passed under Jest, but broke `npx expo export --platform ios` outright: Expo
   Router's Metro bundler treats every file under `app/` as a route candidate regardless of its
   name, and tried to bundle `@testing-library/react-native` straight into the production app,
   failing on an unresolvable `console` import inside the testing library itself
   (`node_modules/@testing-library/react-native/dist/helpers/logger.js`). This is the actual,
   confirmed reason no other screen in this codebase has ever had a test file — not an oversight
   this session happened to fix, but a hard platform constraint now documented for the first
   time. Fixed by relocating the test to `src/components/calendar/CalendarScreen.test.tsx`,
   importing the screen component via a relative path (`../../../app/(app)/calendar`) — Jest
   never goes through Metro, so a `src/` test importing an `app/` file is invisible to the
   production bundle. Re-ran `npx expo export --platform ios` after the move to confirm the fix,
   not just to assume it.

## Verification (fresh, all real)

- `supabase db reset && supabase test db`: `Files=13, Tests=391` (387 + 4 new), all passing.
- `npm run verify`: lint clean, typecheck clean, 264/264 Jest across 37 suites (233 + 31 new:
  9 + 10 + 12), `wiki:lint` 17 articles.
- `deno test` (Edge Function): 11/11, unaffected.
- `npm run e2e:backend`: 32/32. `npm run e2e:notifications`: 24/24.
- `npm run e2e:calendar` run **twice consecutively without a DB reset in between**: 28/28 both
  times (27 original + 1 new `taken`-outbox assertion). Zero `e2e-*` residue in `auth.users`
  confirmed by direct query after both runs.
- Both `npx expo export --platform ios` / `--platform android` succeed (the `app/`-test-file
  bug above was caught by this exact check during the session, not assumed away afterward).
- `npx expo-doctor`: 21/21.
- Secret scan of the compiled iOS bundle (`grep -c` for `SERVICE_ROLE_KEY`,
  `NOTIFICATION_WORKER_SECRET`, `CLIENT_SECRET`) and the public Expo config: clean, 0 matches.

## Not done, by design

Maestro E2E coverage for the calendar remains deferred, unchanged from the original Phase 7
decision — the brief's own Section 18 explicitly keeps this non-mandatory ("Maestro may remain
non-blocking, but deterministic Jest UI tests are mandatory"), and nothing in this session's
audit found a reason to revisit that call. Week/Month views, recurring events, and every other
non-goal from the original Phase 7 brief remain out of scope, unchanged.

## Commits this session

1. `fix(calendar): explicit revoke on trigger functions + declined/taken notification coverage`
   — migration, pgTAP, e2e script.
2. `feat(calendar): add OfflineBanner and pull-to-refresh to the Day Calendar` —
   `app/(app)/calendar.tsx`.
3. `test(calendar): add mandatory Jest UI coverage for the Day Calendar, event editor, and
   responsibility controls` — the three new test files.
4. `docs: document the Phase 7 follow-up audit across docs and the LLM Wiki` — this file plus
   every canonical doc/wiki page it's linked from.

Nothing pushed. Nothing merged into `develop`/`main`.
