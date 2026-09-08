# Session: Phase 7 — Family Calendar, Child Events, and Responsibilities

Date: 2026-09-07. Branch: `feature/family-calendar`, based on `develop`'s tip after Phase 6's
PR was merged (confirmed via `git merge-base develop HEAD` == `git rev-parse develop`).
Continues directly from the Phase 6 session
(`knowledge/raw/sessions/2026-09-06-phase6-push-notifications.md`).

## Brief (condensed — full text in `docs/DECISIONS.md`'s Phase 7 section)

Implement the MVP Day Calendar: personal/family/child events; drop-off/pick-up
responsibilities as records separate from the event they attach to (the "event ≠
responsibility" rule); the responsibility assignment state machine (assign/reassign/take/
accept/decline); Busy-block privacy for private family-linked events; deterministic
privacy-safe conflict detection (warning only, never blocking a save); a Calendar Day view
with Personal/Family mode and member filters, doubling as Family Today; push notifications
extended (not duplicated) to responsibility events; pgTAP + real backend integration + docs/
wiki. Explicit non-goals: Week/Month views, recurring events, scheduled reminders, Google/
Apple Calendar sync, travel-time/maps, automatic conflict resolution, AI, drag-and-drop,
attachments, ownership transfer, a full offline write queue, all-day/date-only events.

## What was built

### Database (`supabase/migrations/20260907120000_family_calendar.sql`)

Audited `events`/`event_participants`/`responsibilities` (Phase 2) before writing anything
new — schema/RLS/constraints were sound and reused as-is; only additions were
`events.deleted_at` and a `responsibility_assignments` audit table. Found the same
direct-grant gap Phase 4 found for `tasks`: these three tables granted raw INSERT/UPDATE/
DELETE to `authenticated`, and `responsibilities_owner_manages` let the event owner bypass
the accept/decline/take state machine via a plain UPDATE. Closed by revoking the grants and
replacing every mutation with an RPC: `create_personal_event`/`create_family_event`/
`create_child_event`/`update_event`/`cancel_event`, and
`assign_event_responsibility`/`reassign_event_responsibility`/`take_event_responsibility`/
`accept_event_responsibility`/`decline_event_responsibility`/`remove_event_responsibility`
(the last two new — remove is a hard delete, only when unassigned/declined).
`set_responsibility_assignment`/`create_bare_responsibility` are internal-only, zero grants,
mirroring `set_task_assignment`. `remove_family_member` extended to also resolve active
responsibility assignments. A trigger rejects attaching a responsibility to a private event.
`has_member_schedule_conflict()` — read-only, three sources (own events, timed task, another
accepted responsibility), half-open interval semantics, returns a bare boolean only. Two
sanitized views: `family_schedule` (evolved — excludes soft-deleted, exposes
`participant_member_id`) and `family_responsibilities` (new).

Also extended the Phase 6 notification outbox (not a second system): `notifications.outbox`
gained nullable `event_id`/`responsibility_id` columns alongside `task_id`/
`task_assignment_id`, a CHECK enforcing exactly one source per row, and a second trigger
(`enqueue_event_responsibility_notification`) on `responsibility_assignments` mirroring the
task one. Updated `dispatch-notifications/index.ts`'s static body-text map and
`src/domain/notifications/payload.ts` (now a discriminated union: taskId-shaped or
eventId-shaped, never both/neither) and `notificationResponseRouter.ts` (routes to
`/task/[id]/edit` or `/event/[id]` depending on which the parsed payload carries).

`supabase/tests/120_family_calendar_test.sql` — 88 assertions. During authoring, manual
review (Docker was down for a long stretch mid-session, so tests were written and reviewed
before they could be run — see "Docker outage" below) caught and fixed several real bugs in
the test file itself before ever running it: two role-context bugs (an RPC call running under
the wrong persona so a throws_ok/lives_ok expectation was structurally wrong), a positional-
argument bug in a `create_child_event` call (an assignee id landing in the `description`
parameter slot instead), and a conflict-detection test that checked a responsibility against
itself rather than a genuinely separate overlapping one. Once Docker recovered, `db reset` +
`test db` surfaced 3 more real bugs on the first run (a `private`/`family` visibility mixup
in a fixture, an `assign_event_responsibility` state-check needing an actual pending→accepted
transition first) — all fixed, then 5 more on the next run (a wrong query scope catching an
unrelated responsibility's own legitimate notification, and a second-responsibility-needed
gap in the "two accepted responsibilities overlap" test) — fixed, then **381/381 (293
existing + 88 new) passed clean**.

Also found: `responsibility_assignments` was initially designed with zero client SELECT grant
at all (unlike `task_assignments`, which grants `select, insert`) — this broke the test file's
own audit-history assertions, which run as `authenticated`. Corrected to grant `select`
(same-family, RLS-scoped) while keeping `insert`/`update`/`delete` fully closed (a genuine
improvement over `task_assignments`' own still-open direct-INSERT policy, not just parity).

### Client (`src/domain/calendar/`, `src/lib/calendar/`, `src/components/calendar/`, `app/event/`)

Mirrors the established `taskService.ts`/`TaskEditorForm.tsx` pattern exactly:
`calendarService.ts` (the only module calling `supabase.rpc`/`.from` for this feature),
`domain/calendar/{types,dateUtils,mappers,schemas,hooks}.ts`, `EventEditorForm.tsx` (one
reusable create/edit form, personal/family/child kind switch, always-required date+start+end,
inline conflict warnings for drop-off/pick-up assignees), `ResponsibilityRow.tsx` (Take/
Accept/Decline as primary actions, mirroring `FamilyTaskRow`). `dateUtils.ts`'s
`localDayBoundsUtc` goes through the local `Date` constructor (DST-correct) for local-day UTC
query boundaries — a genuinely different problem from `tasks/dateUtils.ts`'s deliberately
timezone-independent date-only strings, since events store a real instant.

`app/(app)/calendar.tsx` rewritten from the Phase 1 placeholder: date navigation, Personal/
Family mode toggle, per-member filter in Family mode — deliberately doubles as "Family Today"
rather than a second near-duplicate screen. Routes: `app/event/new.tsx`, `app/event/[id].tsx`
(the event-responsibility notification-tap destination), `app/event/[id]/edit.tsx` (also owns
Cancel Event), registered in `app/_layout.tsx`'s `Stack.Protected` list with the same modal/
header pattern as `task/new`/`task/[id]/edit`.

Type-checked clean on the first `tsc --noEmit` run after `npm run db:types` regenerated
`src/lib/supabase/types.ts` against the real migrated schema (types.ts had not existed for
the new tables/RPCs until then, since Docker being down earlier in the session meant client
code was written against what the schema *would* produce, not yet verified). Two React
Compiler lint errors (`react-hooks/preserve-manual-memoization`) on a hand-written `useMemo`
whose dependency was derived via `.find()` each render — fixed by removing the manual
`useMemo` entirely (cheap array filters; the project's React Compiler handles this
automatically) rather than fighting the compiler's own safety check.

### Client tests

`src/domain/calendar/{dateUtils,schemas,mappers}.test.ts` — 27 tests. `dateUtils.test.ts` is
deliberately self-consistent rather than a multi-timezone matrix (unlike
`tasks/dateUtils.test.ts`), since these functions intentionally resolve against the runtime's
actual timezone and Phase 4 already established `process.env.TZ` isn't reliably swappable in
this Jest environment; `intervalsOverlap`'s half-open-boundary coverage has no timezone
dependency at all and got the thorough multi-case treatment instead.

**Not written this phase**: component tests for `EventEditorForm`/`ResponsibilityRow`/
`calendar.tsx`, and Maestro E2E flows — both deferred given this phase's already-large scope
and, for Maestro specifically, the established non-determinism documented in Phase 5 (not
worth risking a rushed/flaky addition). The real backend integration script and domain-logic
unit tests are this phase's UI-adjacent coverage instead.

### Backend integration script (`scripts/e2e-calendar.sh`, `npm run e2e:calendar`)

27 checks: family/child setup, a private family-linked event (owner sees full content,
spouse sees only a Busy block via `family_schedule` with a secret-marker sweep, an outsider
sees nothing), a child event with drop-off/pick-up assigned to different adults (self-assign
immediate acceptance vs. pending for someone else), accept/decline/take through the full
state machine, a real deterministic conflict (confirmed the RPC's raw HTTP response body
contains no leaked field), the notification outbox extension (expected rows, self-
notification suppression, no duplicate idempotency_key, a rejected stale-state replay never
enqueues a duplicate), and authorization boundaries.

**A real, previously-undiscovered bug found while building this script**: `admin_create_user`
appended to `CREATED_USER_IDS` *inside* the function, but every call site across
`scripts/e2e-backend.sh`, `scripts/e2e-notifications.sh`, and (initially) this new script
invoked it via command substitution (`OWNER_ID=$(admin_create_user ...)`) — which runs the
function body in a subshell, silently discarding the array mutation before it ever reached
`cleanup()`. `e2e-backend.sh` turned out unaffected (it never captures the function's output
via `$(...)` at all). `e2e-notifications.sh` **was** affected — confirmed 12 accumulated
leaked `e2e-*` `auth.users` accounts in the local database, meaning every run since Phase 6
had silently failed to clean up its test users (the Phase 6 "no residue" verification was
correct about what it actually checked — family/outbox rows, a separate variable outside this
array — but incomplete). Fixed in both `e2e-notifications.sh` and `e2e-calendar.sh` by
appending at each call site instead; manually purged the 12 leaked accounts; both scripts
re-verified to leave zero matching `auth.users` rows after two consecutive runs.

**Verified: `npm run e2e:calendar` → 27/27, run twice consecutively, zero residue** (confirmed
via direct `psql` counts of families, events with secret-marker titles, and outbox rows after
the second run).

## Docker outage mid-session

The local Supabase/Postgres Docker daemon was unreachable (`Cannot connect to the Docker
daemon... Is the docker daemon running?` — a real daemon-down state, not a hang, though it was
initially misdiagnosed as "hanging" due to repeatedly issuing fresh background `docker ps`
checks instead of checking the results of ones already in flight) for a large portion of this
session, starting from the very first `db reset` attempt. Continued writing the migration,
pgTAP test, and client domain/service/hooks layer during the outage — all reviewed by hand for
correctness (catching several real bugs before ever running anything, see above) — and ran the
full verification loop (`db reset`, `test db`, `db:types`, `tsc`, `e2e:calendar`,
`e2e:notifications`) once the daemon recovered. Flagged the outage to the user directly rather
than continuing to silently pile up unverified code once it became clear the daemon was
genuinely down rather than momentarily slow.

## Verification (full loop)

- `npm run verify` (lint + typecheck + test + wiki:lint) — lint 0 errors, typecheck clean,
  **233/233 Jest tests across 34 suites**, wiki:lint passed (17 articles after this session's
  new page).
- `npx supabase db reset && npx supabase test db` — **381/381 pgTAP assertions across 12
  files**, all pass.
- `cd supabase/functions && deno test` — **11/11**, unaffected by the `notifications.outbox`
  schema extension.
- `npm run e2e:calendar` — **27/27**, run twice, zero residue.
- `npm run e2e:notifications` — **24/24**, re-verified after the subshell-array cleanup fix,
  zero residue (previously silently leaking, see above).
- `npx expo-doctor` — 21/21.
- `npx expo export --platform ios` — succeeded, both before and after the `event/*` route
  registrations were added to `app/_layout.tsx`.
- No new native dependency was added this phase, so a full native rebuild
  (`pod-install`/`expo run:ios`) was judged not required — the bundle export is the
  applicable check per this project's own established distinction (see Phase 5's patch-drift
  entry in `docs/DECISIONS.md` for when a rebuild *is* required: a native-code-shipping
  package version bump, which did not happen here).

## Not done this phase, by design or by explicit deferral

- Maestro E2E flows for the calendar (deferred — see "Client tests" above).
- Component tests for the three new UI files (deferred — same reason).
- Week/Month calendar views, recurring events, reminders, Google/Apple Calendar sync,
  automatic conflict resolution, all-day events — all explicit non-goals per the brief.
- No external EAS/Apple/Firebase/hosted-Supabase resource was created or modified.

## Status at this write-up

All code committed on `feature/family-calendar` (7 commits, based on `develop`'s tip after
Phase 6's merge): DB/migration/pgTAP, client domain/repository layer, UI/routes,
domain-logic Jest coverage, the `e2e-notifications.sh` cleanup bugfix, the
`e2e-calendar.sh` backend integration script. Documentation and this wiki pass are the last
item, done in this same session. Nothing pushed, merged, or PR'd — all standing constraints
held throughout.
