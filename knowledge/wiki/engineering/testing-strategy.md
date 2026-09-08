---
title: Testing strategy
status: current
updated: 2026-09-08
sources:
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-05-phase5-shared-family-tasks.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
  - ../../raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md
  - ../../raw/sessions/2026-09-08-phase7-followup-audit.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
  - ../../raw/sessions/2026-09-08-phase8-final-validation.md
tags: [engineering, testing, phase8]
---

## Confirmed / current

- **Domain logic** (`src/domain/**`) — plain Jest, no React/I/O.
  `src/domain/tasks/{priority,schemas,mappers,dateUtils,sections,errorMessages}.test.ts`,
  `src/domain/auth/errorMessages.test.ts`, `src/domain/family/{errorMessages,mappers}.test.ts`,
  `src/domain/categories/mappers.test.ts`. `dateUtils.test.ts` is the one with the most at
  stake — deterministic coverage for UTC/Europe-Kyiv/negative-offset/DST/midnight-boundary
  cases, per this phase's brief; see "A real Jest/TZ quirk" below.
- **Components** — Jest + React Native Testing Library, rendered wrapped in
  `<AppThemeProvider>` (not mocked). `src/components/ui/EmptyState.test.tsx`,
  `src/components/tasks/{TaskRow,QuickAddInput}.test.tsx` (accessibility state, double-submit
  and duplicate-tap prevention). **Phase 5** adds
  `src/components/tasks/{AssigneeLabel,AssigneePicker,FamilyTaskRow,FamilyTaskBoard}.test.tsx`
  — 172 Jest tests total across 28 suites, up from 144. Two RN Testing Library environment
  limits found and worked around here, not in production code:
  - **`react-native-paper`'s `<Menu>` never mounts its Portal content under
    `react-test-renderer`** (no native layout engine to satisfy its internal
    `measureInWindow`-driven `rendered` state) — confirmed a hard cutoff, not a slow render,
    via direct experiment. `AssigneePicker.test.tsx` is scoped to what's reliably observable
    (the trigger button and its `disabled` state) rather than asserting on opened-menu
    content; no other component in this codebase drives a `Menu` open in tests either.
  - **`SectionList` (`VirtualizedList`) never expands its render window past the initial
    batch** under the same missing-layout-engine constraint — `FamilyTaskBoard.test.tsx`
    mocks `react-native/Libraries/Lists/SectionList` to render every row unconditionally
    rather than bumping a production `initialNumToRender` (tried and reverted — it only
    existed to satisfy Jest). Full evidence and reasoning:
    [DECISIONS.md, "Phase 5"](../../../docs/DECISIONS.md).
  - **Phase 7 follow-up** adds `src/components/calendar/{ResponsibilityRow,EventEditorForm,
    CalendarScreen}.test.tsx` — mandatory per a later, more detailed brief, overriding the
    original Phase 7 pass's deferral of exactly this coverage. Same `<Menu>` constraint above
    applies to `EventEditorForm.test.tsx` (trigger buttons/disabled state/validation/
    submission payloads tested, opened-menu content not). 264 Jest tests total across 37
    suites, up from 233.
  - **Phase 8** adds `RecurrencePicker.test.tsx` (8), `ReminderEditorSection.test.tsx` (7),
    `useReminderNotificationActions.test.tsx` (15, after a final-validation-pass fix — see
    below), `reminderReconciliation.test.ts` (15, a fake-scheduler suite exercising the
    *production* `reconcileReminders()` function, never a reimplementation),
    `domain/recurrence/schemas.test.ts` (20), and (final validation pass)
    `TaskEditorForm.test.tsx` (6, new — the component had no test file before) plus 4 new tests
    in `notificationService.test.ts`. 342 Jest tests total across 43 suites, up from 264, stable
    across 3 consecutive full runs. **The `<Menu>` limitation above is not Jest-only** — Phase 8
    reproduced it live via Maestro on a real simulator too; see "Live-Maestro confirmation"
    below. `ReminderEditorSection.test.tsx`'s two original Menu-driven tests were also found
    genuinely flaky at full-suite scale (passed alone, intermittently failed among 42 suites) —
    fixed by extracting the pure `existingReminderOffsets()` function and testing that directly
    instead of driving the Menu open at all.
- **Localization** — `src/i18n/i18n.test.ts` checks i18next initializes, a key translates
  differently per locale, and every namespace has matching keys across `en`/`uk`.
- **Auth/config** — Jest with `@/lib/supabase/client`/`@/lib/env` mocked at the module
  boundary. `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`,
  `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`.
- **Repositories/services and selection hooks** (Phase 3 pattern, confirmed again in Phase 4)
  — `src/lib/{family,tasks,categories}/*Service.test.ts` mock `@/lib/supabase/client`'s
  `.from()`/`.rpc()` chains to test row-mapping and SQLSTATE normalization;
  `src/domain/{family,tasks}/hooks.test.tsx` use RNTL's `renderHook` (which is `async` — must
  be awaited, unlike `render`/`fireEvent` which merely _return_ promises) with a
  `QueryClientProvider` wrapper. `src/domain/tasks/hooks.test.tsx` specifically proves
  `useCompletePersonalTask`'s optimistic update rolls back **deterministically to the exact
  pre-mutation cache state** on a simulated server failure — the concrete test the
  optimistic-update architecture rule (see [system-architecture](system-architecture.md))
  requires before any hook is allowed to use one.
- **RLS/privacy tests** — pgTAP via `supabase test db`, against a real local Postgres
  instance with RLS enabled. `supabase/tests/*.sql` (14 files, 461 assertions total: 192
    through Phase 4, +71 in Phase 5's `100_shared_family_tasks_test.sql`, +30 in Phase 6's
    `110_notification_outbox_test.sql`, +92 in Phase 7's `120_family_calendar_test.sql`
    (88 original + 4 added in the Phase 7 follow-up audit, closing a gap where the
    `declined`/`taken` notification event types had no direct assertion), +6 in Phase 6.1's
    `130_security_regression_test.sql`, +70 in Phase 8's new
    `140_recurring_tasks_reminders_test.sql`), including a dedicated secret-marker
    privacy-regression test (`060_privacy_regression_test.sql`), the full
    family/invitation/child-profile RPC suite (`080_family_management_test.sql`), the
    personal-task RPC suite (`090_personal_task_management_test.sql`, itself extending the
    secret-marker sweep to the new RPC-only task write path), the shared-task assignment
    suite (`100_shared_family_tasks_test.sql`) — creation/outsider-rejection, the full
    assignment state machine, stale-acceptance-after-reassignment, Take Task concurrency proxy,
    completion permissions, member-removal resolution (both pending and accepted), and every new
    RPC's anon/authenticated privilege check — the notification outbox suite
    (`110_notification_outbox_test.sql`, Phase 6) — every event type, self-notification/
    removed-member/disabled-preference suppression, dedup via idempotency key, RPC-replay
    safety, and complete `notifications`-schema inaccessibility (every table/function, both
    `authenticated` and `anon`) — the family calendar suite
    (`120_family_calendar_test.sql`, Phase 7) — event/responsibility creation authorization,
    the event ≠ responsibility rule proven directly (renaming/rescheduling an event leaves its
    responsibilities' assignees untouched and `due_at` derives without drifting), the full
    responsibility assignment state machine, Busy-block privacy for a private family-linked
    event, `has_member_schedule_conflict`'s half-open interval semantics, member-removal
    resolution extended to responsibilities, and the notification outbox extension — (Phase
    6.1) `130_security_regression_test.sql`, a schema-driven (never hardcoded) invariant check
    that anon/PUBLIC has no `EXECUTE` on any non-trigger function in `public`/`notifications`
    beyond a short reviewed whitelist, meant to durably close the anon-EXECUTE-grant finding
    class rather than catch it manually again next time — and (Phase 8)
    `140_recurring_tasks_reminders_test.sql`, covering occurrence generation/idempotency,
    monthly-missing-day and weekly-anchor-snapping recurrence rules, the full occurrence
    lifecycle RPCs (including the soft-deleted-parent-series check added after the audit found
    it missing), reminder CRUD and the `remind_at`-xor-`offset_minutes_before` CHECK, snooze,
    and the extended conflict-detection function.
    **Verified: all 461 assertions pass** against a real local instance (`supabase db reset &&
supabase test db`), plus real curl-driven multi-user flows for Family Space, personal
    tasks, shared tasks, notifications, the calendar, and recurrence (real `auth.users`
    accounts, not simulated `set local role`) — see
    [`knowledge/raw/sessions/2026-09-03-phase3-family-space.md`](../../raw/sessions/2026-09-03-phase3-family-space.md),
    [`knowledge/raw/sessions/2026-09-03-phase4-personal-tasks.md`](../../raw/sessions/2026-09-03-phase4-personal-tasks.md),
    [`knowledge/raw/sessions/2026-09-06-phase6-push-notifications.md`](../../raw/sessions/2026-09-06-phase6-push-notifications.md),
    [`knowledge/raw/sessions/2026-09-07-phase7-family-calendar.md`](../../raw/sessions/2026-09-07-phase7-family-calendar.md),
    [`knowledge/raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md`](../../raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md),
    [`knowledge/raw/sessions/2026-09-08-phase7-followup-audit.md`](../../raw/sessions/2026-09-08-phase7-followup-audit.md),
    and
    [`knowledge/raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md`](../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md).
    Running the Phase 2 suite for real surfaced and fixed one migration-ordering bug and two
    test-assertion bugs; the Phase 3 audit surfaced a real `anon`-EXECUTE-grant gap, the
    Phase 4 audit surfaced a real `tasks`-direct-`UPDATE` gap, the Phase 6 audit surfaced
    the same anon-EXECUTE gap recurring on two new functions, the Phase 7 audit surfaced
    the same direct-grant gap Phase 4 found, now for `events`/`event_participants`/
    `responsibilities`, and Phase 8's own direct testing (against real Postgres, before pgTAP
    was written) surfaced a weekly-interval timestamp/date-cast bug, a weekly-anchor-snapping
    gap, a missing soft-deleted-series check across four occurrence RPCs, and a real
    timezone-mixing bug in the conflict-detection test itself (see
    [security-model](security-model.md), [recurring-tasks-and-reminders](recurring-tasks-and-reminders.md)) —
    none of these were caught by static review alone, which is exactly why Phase 6.1 built an
    automated guard instead of relying on the next phase's author remembering to check manually
    again. CI's `database` job also runs them on every push/PR.
- **Edge Function tests (Phase 6)** — Deno's own test runner (`deno test`), not Jest — the
  `dispatch-notifications` Edge Function is a separate Deno module tree
  (`supabase/functions/`), explicitly excluded from `tsconfig.json`/`eslint.config.js`/
  `jest.config.js` so the Node tooling never tries to parse Deno-specific syntax (`npm:`
  imports, a global `Deno`, `import.meta.main`). `dispatch-notifications/index.test.ts` runs
  `dispatchNotifications()` against a *real* local Postgres connection (via `npm:postgres`)
  with a fully fake, network-free `PushTransport` — 11 test steps, all passing, covering
  claim/send/classify/receipt-check and the token-deactivation path. See [Push
  notifications](push-notifications.md).
- **Build/bundle smoke test** — `npx expo export --platform ios|android`, `npx expo config`,
  `npx expo-doctor`; catches what lint/typecheck can't (see the `expo-router` vs.
  `@react-navigation/native` case in [system-architecture](system-architecture.md)). Wired
  into `.github/workflows/ci.yml`. `expo-doctor` currently reports 21/21 — a Phase 5 patch-level
  drift on `expo`/`expo-router`/`expo-notifications` (lockfile frozen at initial-install
  versions, not a pinning decision) was resolved via `npx expo install --fix` plus a full
  native rebuild; see [DECISIONS.md, "Phase 5"](../../../docs/DECISIONS.md).

- **E2E (Maestro)** — Maestro 2.10.0, installed user-scoped (official curl installer, no
  sudo) with its JVM dependency via the Homebrew **formula** `brew install openjdk` (not the
  `--cask temurin`, which needs sudo). Three flows under `.maestro/`, run against the iOS
  Simulator: `personal_task_smoke.yaml` (sign in → quick-add → schedule for today → complete
  → restore), `family_task_workflow.yaml` (User A creates an unassigned shared task → signs
  out → User B takes and completes it), `assignment_decline.yaml` (User A assigns to User B →
  User B declines → User A sees it back unassigned after a fresh sign-in). Final verification
  (per-flow invocations): 3 consecutive full runs of all three flows from a fresh `db reset` +
  `e2e:seed` each time (9 flow completions, cross-checked against real database state after
  each run — not just the terminal summary); every completion passed, every conditional retry
  evaluated `SKIPPED` (0 actually triggered), and 1 genuine hang occurred (required a full flow
  restart). Separately, running the literal `npm run e2e:ios` command (all three flows in one
  combined invocation) caught a real gap the hardening initially missed (the task-actions
  menu-open step lacked the same retry pattern as the mutation after it — fixed), and then hit
  two more hangs in the two re-verification attempts that followed the fix — see "Retry
  hardening" below for the full, honest numbers.
  `scripts/e2e-seed.sh` provisions the two Maestro fixture users in one shared family and
  writes their member ids to the gitignored `.maestro/.env.local` (both users' display names
  default to the same placeholder text, so the assignee picker can only be targeted reliably
  by member id — `scripts/e2e-ios.sh` forwards these via `maestro test -e`). Run via `npm run
e2e:seed` then `npm run e2e:ios`. Tab bar items get a real testID via
  `options.tabBarButtonTestID` on each `Tabs.Screen` (`app/(app)/_layout.tsx`) — note the exact
  prop name, since the more commonly documented `tabBarTestID` silently does nothing on this
  Expo Router/React Navigation version. Full writeup of every environment issue worked around
  (password text-injection on a `tapOn` right after typing, iOS merging a compound
  `Pressable`'s children into one `accessibilityText` — needs dedicated testIDs, the
  leftmost/rightmost tab bar items' _taps_ not landing even with a confirmed-correct testID —
  worked around with a coordinate tap, an unreliable `checked` selector attribute, and a real
  `TaskEditorForm` stale-closure bug found and fixed) plus two flow-logic bugs found in the
  flows themselves (a blind recovery retry that could double-submit a task, a blind
  double-tap trigger that could self-assign one): [DECISIONS.md, "Phase
  5"](../../../docs/DECISIONS.md). **Known technical debt, treated as significant, not
  rare**: genuine Maestro/XCUITest hangs and silent no-op taps (`COMPLETED` reported, no
  effect — observed ~2-in-10 on ordinary elements during investigation) are a real tool-level
  failure mode on this exact Simulator/Maestro combination, not fixable from flow engineering.
  Every mutating or navigating tap now carries a bounded, state-verified conditional retry
  (proves the original tap did NOT succeed before ever retrying — never a blind repeat of an
  action that can create/mutate data); Reduce Motion is also enabled on the Simulator via
  `scripts/e2e-ios.sh` (Maestro itself has no such built-in option — confirmed by searching its
  bundled jars) as a genuine but unproven stabilization attempt, since the root cause was
  isolated to touch delivery, not an animation race. A hang, unlike a silent no-op, cannot be
  retried around within a flow at all. **Not extended to Phase 6 (push notifications), Phase 7
  (family calendar), or Phase 8 (recurrence/reminders)** — deliberately, given the established
  non-determinism above and each phase's own already-large scope;
  `scripts/e2e-notifications.sh`/`e2e-calendar.sh`/`e2e-recurrence.sh` are the real-backend
  coverage that exists for those instead.
  - **Live-Maestro confirmation of the `<Menu>` limitation, on a real device build (Phase
    8)**: ad hoc Maestro/`simctl` investigation (not a checked-in flow) against a real
    `npx expo run:ios` build reproduced the Jest-documented `<Menu>` failure live. Six tap
    strategies against `ReminderEditorSection`'s anchor button all reported `COMPLETED` in
    Maestro's own output with no visible state change; a `maestro hierarchy` dump taken
    immediately after a tap showed zero menu content anywhere in the tree; `ffmpeg` (installed
    for this purpose) extracted a screen recording frame-by-frame and showed the button's own
    pressed-state highlight firing correctly with no menu content in any frame — a genuine
    non-open, not a flash-open-close race. A second, independent `<Menu>` on the same screen
    (the Category picker) failed identically, narrowing the cause to "any `<Menu>` whose anchor
    lives on a screen presented via `presentation: 'modal'`," not a component-specific bug.
    Full evidence: [DECISIONS.md, "Phase 8"](../../../docs/DECISIONS.md).
  - **Worked around with a `__DEV__`-only diagnostic screen, not left blocked (Phase 8 final
    validation pass)**: `app/dev-diagnostics.tsx` calls the exact production functions the
    broken Menu items would have (`requestNotificationPermission`, `reconcileReminders`,
    `expoLocalScheduler.listScheduled`), letting real permission-grant/scheduling/delivery/
    reschedule/cancellation be directly observed on device despite the Menu never opening. Tap-
    to-navigate and the Snooze/Done notification *actions* remained unverified for a distinct,
    structural reason: they need cross-process iOS system UI (lock screen/Notification Center)
    that Maestro can't drive for an `appId`-scoped flow, except the one specially-supported
    permission-alert case (which did work). See [DECISIONS.md, "Phase
    8"](../../../docs/DECISIONS.md) for the full evidence and
    [recurring-tasks-and-reminders](recurring-tasks-and-reminders.md).
  - **A real Tonight/Tomorrow snooze-ordering bug, found only because a test happened to run
    near midnight (Phase 8 final validation pass)**: a test asserting `SNOOZE_TONIGHT` always
    resolves sooner than `SNOOZE_TOMORROW` had never actually been exercised late enough in the
    day to hit the bug — rolling a passed 20:00 anchor forward 24h landed *after* tomorrow's
    fixed 09:00 anchor. Fixed in both the production fallback (`now + 1 hour` instead of the
    same hour next day) and the test (`jest.useFakeTimers().setSystemTime(...)`, with a
    dedicated late-night case). General lesson recorded in
    [`docs/TEST_STRATEGY.md`](../../../docs/TEST_STRATEGY.md): a test reading real wall-clock
    time with no fixed system clock is a real flakiness source, not just a theoretical one.

## Conventions to follow in new tests

- **A bash helper function that appends to an array must not do so when called via command
  substitution (Phase 7)** — `OWNER_ID=$(some_function ...)` runs `some_function`'s body in a
  **subshell**; an array mutation inside it (`SOME_ARRAY+=(...)`) is silently discarded the
  instant that subshell exits, never reaching the parent shell. `e2e-notifications.sh`'s
  `admin_create_user` had exactly this bug and had been leaking test `auth.users` accounts
  since Phase 6 without any visible error — found only by directly querying the database for
  accumulated `e2e-*` accounts while building `e2e-calendar.sh`. Fix: append at the call site
  (`OWNER_ID=$(admin_create_user ...); CREATED_USER_IDS+=("$OWNER_ID")`), never inside a
  function invoked this way. See [DECISIONS.md, "Phase 7"](../../../docs/DECISIONS.md).
- **A regression guard must be proven to fail before it's trusted to pass (Phase 6.1)** —
  writing an invariant test and watching it pass against already-correct code proves nothing
  about whether it would actually catch the bug it's meant to prevent. Before trusting
  `130_security_regression_test.sql`, the exact bug it guards against was reintroduced
  temporarily (re-granting `anon` `EXECUTE` on a real function), the test was re-run and
  confirmed to fail with the expected assertion, then the grant was reverted and the test
  re-confirmed passing. Do this for any new regression guard, not just this one.
- **A screen's test file must never live inside `app/`, even co-located with the screen it
  tests (Phase 7 follow-up)** — Expo Router's Metro bundler treats every file under `app/` as
  a route candidate by filename-independent convention, not just recognized route patterns.
  `app/(app)/calendar.test.tsx` passed under Jest but broke `npx expo export --platform ios`
  outright, bundling `@testing-library/react-native` into the production app and failing on an
  unresolvable `console` import inside the testing library. This is the actual reason no other
  screen in this codebase has a test file, not an oversight. Fix: put the test in `src/`
  instead (e.g. `src/components/calendar/CalendarScreen.test.tsx`) and import the screen via a
  relative path — Jest doesn't go through Metro, so this is invisible to the production
  bundle. See [DECISIONS.md, "Phase 7 follow-up"](../../../docs/DECISIONS.md).
- **`render()` and `fireEvent.*()` are async in the installed RNTL version — always
  `await` them.** (See [`docs/DECISIONS.md`](../../../docs/DECISIONS.md).) Skipping this
  either trips `@typescript-eslint/no-floating-promises` or asserts before the
  render/interaction finished.
- Validation schemas (`src/domain/*/schemas.ts`) carry no translated strings — Zod `message`s
  are internal tokens; components map them to translated text. Keeps schemas testable
  without any i18n setup.
- Jest's `transformIgnorePatterns` is left to the `jest-expo` preset — don't hand-roll it
  (see `docs/DECISIONS.md` for the `standard-navigation` breakage this caused once already).
- **Modules with load-time side effects** (`env.ts` computes `env` eagerly at import) — test
  with `jest.resetModules()` + `require()` per case, not `import()` (this Babel/CJS Jest
  setup can't resolve a throwing dynamic `import()` to a rejected promise).
- **Firing a captured external callback** (e.g. Supabase's `onAuthStateChange` mock) must be
  wrapped in `act()` from `@testing-library/react-native`.
- **pgTAP fixtures** are inserted directly as `postgres` (bypasses RLS); a specific user is
  simulated via `set local role authenticated;` + `set_config('request.jwt.claims', ...)`;
  expect exact Postgres SQLSTATEs (`23503`/`23505`/`23514`/`42501`) with `throws_ok`. Full
  convention: [`docs/TEST_STRATEGY.md`, "RLS test-writing conventions"](../../../docs/TEST_STRATEGY.md).
- **A real Jest/TZ quirk (Phase 4)**: `process.env.TZ` reassignment at runtime changes
  `Date`'s local-time output in plain Node (confirmed) but is **not** reliably honored inside
  this project's `jest-expo` test environment. Write timezone-dependent code to take "now" as
  an explicit already-local `Date` (built via the local constructor) rather than reading
  ambient timezone state, and it won't matter either way — see
  `src/domain/tasks/dateUtils.ts`/`.test.ts`.
- **Wrap an imperative call on a `renderHook` result in `act(async () => {...})`** — e.g.
  `result.current.mutate(...)` — or a subsequent `waitFor` can fail to observe the state
  update. See `src/domain/tasks/hooks.test.tsx`.
- **A `renderHook`/mutation test that seems to hang in a piped or backgrounded shell often
  isn't** — this project has repeatedly seen a suite finish internally in well under a second,
  then take much longer to report completion, printing Jest's own "did not exit one second
  after the test run" warning. Check for the suite's actual pass/fail summary before assuming
  a real deadlock. **Phase 5 root-caused the specific single-file-invocation version of this**:
  it's a real crash-on-teardown race between React 19's deferred `act()` flush and Jest's
  per-file module-registry teardown, triggered by `react-native-paper` components that lazily
  construct an `Animated.Value`. `--detectOpenHandles` does not surface it. The full suite
  (`npm test`) is unaffected and is the authoritative check — never add `--forceExit` to it or
  to CI; a one-off manual `--forceExit` during ad hoc single-file debugging is fine. Full
  bisection and evidence: [DECISIONS.md, "Phase 5, known technical
  debt"](../../../docs/DECISIONS.md).

- **`act(() => {...})` (sync) after an `await renderHook(...)` can corrupt React's act-scope
  for the *next* test's `renderHook` in the same file (Phase 6)** — observed as a mock's call
  history mysteriously empty on every test after the one that used a bare `act()`, even though
  each test's own `renderHook` looked normal in isolation. Always `await act(async () => {
  ... })`, even with nothing to `await` inside the callback; `unmount()` from RNTL 14's
  `renderHook` result is also async and needs the same treatment. Root-caused via an isolated
  two-test repro, not guessed. See `src/lib/notifications/notificationResponseRouter.test.ts`.
- **Mocking a plain boolean/data export a test needs to mutate per-test needs a live getter,
  not a plain data property (Phase 6)** — `jest.mock('expo-device', () => ({ isDevice: true
  }))` plus `(Device as any).isDevice = false` in a test looks correct but doesn't work:
  each file's own `import * as Device` gets its own ESM-interop-wrapped copy (Babel's
  `_interopRequireWildcard` snapshots a plain data property's *value*), so the test's mutation
  never reaches the copy the code under test reads. Fix: back it with a module-level `let` and
  expose a getter (`get isDevice() { return mockIsDevice; }`) — a getter descriptor survives
  the interop copy as a live accessor. Confirmed via an isolated repro comparing `import * as
  X` against a direct `require()`. See `src/lib/notifications/notificationService.test.ts`.

## Running

```bash
npm run test        # jest
npm run db:test      # pgTAP — needs the local Supabase stack running
npm run wiki:lint    # validates this wiki's structure
npm run verify       # lint + typecheck + test + wiki:lint
```

## See also

- [Security model](security-model.md) — why RLS tests can't be mocked
- [Authentication](authentication.md) — what the auth test suite covers
- [Development workflow](development-workflow.md) — CI wiring
- [Family calendar](family-calendar.md) — what's covered and explicitly deferred for Phase 7
- [Recurring tasks and reminders](recurring-tasks-and-reminders.md) — the fake-scheduler
  suite, and the full live-Maestro `<Menu>` diagnostic evidence
