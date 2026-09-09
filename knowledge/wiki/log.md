# Operation log

Append-only. Add new entries at the bottom. Never edit or delete a past entry — if a past
entry turns out to be wrong, add a new entry that says so and points at the correction.

---

## 2026-09-02T00:00:00Z — initial wiki creation

- **Operation type:** initial ingestion + foundation build
- **Source material ingested:**
  [`knowledge/raw/product/initial-product-concept.md`](../raw/product/initial-product-concept.md)
  (the full original product/architecture brief, including the mid-session LLM Wiki
  addendum), and the foundation-phase build itself, recorded in
  [`knowledge/raw/sessions/2026-09-02-foundation-build.md`](../raw/sessions/2026-09-02-foundation-build.md).
- **Wiki pages created:** all of `wiki/index.md`, `wiki/log.md`, `wiki/product/*` (4 pages),
  `wiki/domain/*` (5 pages), `wiki/engineering/*` (5 pages) — the full initial structure.
- **Decisions/contradictions recorded:** none yet contradicted — this is the first pass, so
  every wiki page's "Confirmed decisions" section simply reflects the brief and the
  foundation-phase build. Open questions were recorded directly on the relevant pages
  (see `domain/family-spaces.md` re: personal custom categories,
  `engineering/data-model.md` re: recurrence materialization,
  `domain/privacy-and-availability.md` re: RLS tests not existing yet) rather than forcing
  premature resolution.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-02T00:00:00Z — Phase 2: Supabase foundation, schema, RLS, authentication

- **Operation type:** implementation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-02-phase2-supabase-foundation.md`](../raw/sessions/2026-09-02-phase2-supabase-foundation.md).
- **Wiki pages created:** `engineering/authentication.md` (new).
- **Wiki pages updated:** `engineering/security-model.md`, `engineering/data-model.md`,
  `engineering/testing-strategy.md`, `engineering/system-architecture.md`,
  `domain/privacy-and-availability.md`, `domain/family-spaces.md`,
  `domain/tasks-and-assignments.md`, `domain/events-and-responsibilities.md`,
  `wiki/index.md` (added the new authentication page).
- **Decisions/contradictions recorded:**
  - A real design gap in Phase 1's proposed `SECURITY_AND_PRIVACY.md` Mechanism 2
    (`security_invoker` sanitized view) was found while implementing it — a
    `security_invoker` view would inherit base-table RLS's non-owner block and could never
    show a Busy block for a private item. Corrected to an ordinary (owner-executed) view
    whose own `WHERE` clause is the authorization check. Recorded in `docs/DECISIONS.md`,
    `docs/SECURITY_AND_PRIVACY.md`, and `engineering/security-model.md` /
    `domain/privacy-and-availability.md` — not silently patched.
  - Schema additions beyond the original `docs/DATA_MODEL.md` proposal (denormalized
    `family_id` on family-scoped child tables, `timezone` columns, no native Postgres enums,
    a validating rather than syncing owner-consistency trigger) are documented in
    `docs/DECISIONS.md` and referenced from the relevant wiki pages rather than silently
    applied.
  - **Unresolved, carried forward**: whether the pgTAP suite and local Supabase auth flow
    were actually verified against a live Postgres instance this session depends on whether
    Docker finished installing in time — see the session source and the final report for the
    answer. If not verified, treat `supabase/migrations/` and `supabase/tests/` as
    reasoned-through but not yet proven, until `npm run db:reset && npm run db:test` is run
    for real.
  - No family-creation RPC exists yet — flagged in `domain/family-spaces.md` and
    `engineering/data-model.md` as a hard prerequisite for Phase 3, not silently deferred.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-02T00:00:00Z — Phase 2 follow-up: Docker resolved, full verification completed

- **Operation type:** blocker resolution + verification + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-02-phase2-docker-resolved.md`](../raw/sessions/2026-09-02-phase2-docker-resolved.md).
- **Wiki pages updated:** `engineering/authentication.md`, `engineering/security-model.md`,
  `engineering/data-model.md`, `engineering/testing-strategy.md`,
  `domain/privacy-and-availability.md` — removed "not run this session" / Docker-unavailable
  caveats now that they're resolved.
- **Decisions/contradictions recorded:**
  - The previous session's "Docker was unavailable" blocker is resolved — worked around the
    interactive-sudo install failure by installing from Homebrew's own already-verified
    cached download, placing the CLI symlinks in a user-writable location instead of the
    root-owned one the cask defaults to. Full method in the raw source above.
  - Running the migrations for real (not reasoned through) surfaced one real migration-order
    bug and two pgTAP test-assertion bugs — both fixed and re-verified; see the raw source
    and `docs/DECISIONS.md` for detail. Neither was a privacy/RLS design flaw.
  - **All 88 pgTAP assertions now pass against a real local Postgres instance**, and the full
    sign-up → profile-creation-trigger → confirmation-email pipeline was verified end to end
    via direct REST calls against the running local stack — not just unit-tested against
    mocks. This upgrades every previously-"unverified" claim in the Phase 2 session to
    confirmed.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-03T00:00:00Z — Phase 3: Family Space, invitations, family members, child profiles

- **Operation type:** security audit + implementation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-03-phase3-family-space.md`](../raw/sessions/2026-09-03-phase3-family-space.md).
- **Wiki pages updated:** `domain/family-spaces.md` (rewritten — the gap it flagged as "a
  hard prerequisite for Phase 3" is now closed), `engineering/security-model.md`,
  `engineering/data-model.md`, `engineering/authentication.md`,
  `engineering/system-architecture.md`, `engineering/testing-strategy.md`,
  `product/glossary.md`.
- **Decisions/contradictions recorded:**
  - The mandatory pre-implementation security audit (per this wiki's own workflow) found and
    fixed two real issues before they shipped: `family_invitations`' invitee-by-email direct
    SELECT policy was incompatible with token/link-based delivery and was replaced
    (owner-only direct access; invitees go through a sanitized preview RPC instead); and a
    genuine gap where `anon` had `EXECUTE` on every `SECURITY DEFINER` function in the
    codebase — Phase 2's helpers included — because `revoke all on function ... from public`
    never revokes the separate ACL entry Supabase's own role bootstrap grants directly to
    `anon`. The second finding was caught by a failing test during implementation (an
    assertion that `anon` gets `42501` calling an invitation-preview RPC instead observed the
    call succeeding), not assumed from reading the migration. Both are written up in full in
    `docs/DECISIONS.md`, "Phase 3," and `engineering/security-model.md`.
  - `families`/`family_members`/`family_invitations` remain RPC-only for every mutation — no
    direct `INSERT`/`UPDATE`/`DELETE` grant was added for `authenticated`, continuing the
    Phase 2 boundary rather than opening it up now that RPCs exist to write through.
  - Family ownership transfer / an owner leaving their own family has **no RPC** —
    `remove_family_member` unconditionally refuses to remove the `role = 'owner'` row.
    Recorded as a deferred, not-yet-designed gap in `docs/ROADMAP.md`, not silently absent.
  - `screens → hooks → repositories → Supabase client` is now written up as the standing
    architectural pattern (`docs/ARCHITECTURE.md`, new "Layering" section;
    `engineering/system-architecture.md` updated to match), not just this feature's shape —
    future features should follow `src/domain/family/*` / `src/lib/family/familyService.ts`
    as the reference implementation.
  - **136/136 pgTAP assertions and 61/61 Jest tests pass**, and the full flow was additionally
    verified against three real `auth.users` accounts via direct PostgREST calls (not
    `supabase test db`'s simulated personas) — 16/16 checks, including confirming `anon`
    really does get `401` calling the invitation-preview RPC now, the real-world proof the
    EXECUTE-grant fix above actually holds.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-03T00:00:00Z — Phase 4: Personal Tasks, Inbox, Today, Tomorrow

- **Operation type:** security audit + implementation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-03-phase4-personal-tasks.md`](../raw/sessions/2026-09-03-phase4-personal-tasks.md).
- **Wiki pages updated:** `domain/personal-planning.md` (rewritten — no longer describes
  placeholder screens), `domain/tasks-and-assignments.md`,
  `domain/privacy-and-availability.md`, `engineering/security-model.md`,
  `engineering/data-model.md`, `engineering/system-architecture.md`,
  `engineering/testing-strategy.md`, `product/roadmap.md`, `product/mvp-definition.md`,
  `product/glossary.md`.
- **Decisions/contradictions recorded:**
  - The mandatory pre-implementation security audit found and fixed a real gap before it
    shipped: `tasks` granted raw `INSERT`/`UPDATE`/`DELETE` to `authenticated`, and the
    `UPDATE` policy's `WITH CHECK` protected only `owner_profile_id` — a client could rewrite
    `family_id`/`assignee_member_id`/`assignment_status` on their own task directly, bypassing
    the `task_assignments` audit trail and (since the sanitized view's authorization is the
    viewer's family membership, not the owner's) potentially exposing a task to a family its
    owner was never in. Fixed by revoking those grants entirely and moving every task
    mutation to a `SECURITY DEFINER` RPC, the same pattern Phase 3 established for families.
    One pre-existing Phase 2 pgTAP assertion was updated to match (a _stronger_, not weaker,
    guarantee) — documented inline at the change site, not silently altered.
  - Two smaller schema gaps closed alongside it: a task could have a `start_time` with no
    `date` at all (now a `CHECK`), and `duration_minutes` had no upper bound (now capped at
    1440). Explicitly **not** changed: `visibility = 'family'` with `family_id IS NULL`
    remains valid-but-ignored, per `docs/DATA_MODEL.md`'s prior, deliberate documentation of
    that state — the audit did not silently override it.
  - Recurring tasks and reminder scheduling are both MVP-scope (not V2) but still not built —
    each now has a concrete implementation proposal recorded in `docs/ROADMAP.md` rather than
    being left as a vague gap, and the task editor deliberately has no UI for either so as not
    to imply either works.
  - `src/domain/tasks/dateUtils.ts` never round-trips a date-only value through `Date`'s
    UTC-based ISO parsing/formatting, by construction — confirmed with deterministic tests
    across UTC/Europe-Kyiv/a negative offset/a DST transition/midnight boundaries. A real
    `jest-expo` environment quirk was found and recorded while writing those tests:
    `process.env.TZ` reassignment at runtime is not reliably honored inside this project's
    Jest environment, unlike plain Node — doesn't affect this module's correctness (it never
    reads ambient timezone state), but is now documented so a future timezone-dependent test
    doesn't rely on the same trick blind.
  - **192/192 pgTAP assertions and 127/127 Jest tests pass**, and the full personal-task
    lifecycle was additionally verified against two real `auth.users` accounts via direct
    PostgREST calls (not simulated personas) — 20/20 checks, including the same
    secret-marker-never-leaks proof Phase 3 used, extended to the new task RPC write path.
  - Native runtime smoke testing (Section 18 of the brief) was **not performed** this session
    and is reported as such rather than inferred from `expo export`/`expo-doctor` passing —
    those check bundling, not runtime behavior on a simulator or device.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

## 2026-09-05T00:00:00Z — Phase 5 (in progress): Shared Family Tasks, assignment workflow, native E2E foundation

- **Operation type:** security audit + implementation + test-infrastructure investigation + wiki update (interim — not this phase's final pass)
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-05-phase5-shared-family-tasks.md`](../raw/sessions/2026-09-05-phase5-shared-family-tasks.md).
- **Wiki pages updated:** `domain/tasks-and-assignments.md` (substantially rewritten — no
  longer describes assignment UI as nonexistent), `domain/family-spaces.md` (soft-delete
  member removal), `engineering/security-model.md` (new RPC grant pattern, zero-grant internal
  helper), `engineering/testing-strategy.md` (Phase 5 test counts, two RNTL environment
  limitations found and worked around).
- **Decisions/contradictions recorded:**
  - Resolved the Phase 4 custom-category contradiction: `create_custom_category` was already
    correct and family-owner-scoped, just never wired into any UI. Wired into the shared task
    editor's category menu, gated to match the RPC's own owner-only authorization.
  - Found and fixed a real architectural gap before it shipped: none of the FKs referencing
    `family_members` specify `ON DELETE`, and the new `task_assignments` audit rows are
    permanent and `NOT NULL` — a hard `DELETE` in `remove_family_member` would raise a raw FK
    violation the first time a removed member had ever been assigned a task. Fixed via soft
    delete (`removed_at`), with every membership-check helper and sanitized view updated to
    filter it.
  - Self-caught a repeat of the Phase 3 `anon`-EXECUTE-grant lesson while authoring the new
    migration: `set_task_assignment`'s revoke statement was missing from the first draft.
    Fixed before applying, and made this function's grant policy stricter than the earlier
    finding required — zero grants to any role at all, not just a corrected revoke.
  - Two RN Testing Library / `react-test-renderer` environment limitations were investigated
    to a firm conclusion rather than worked around blindly: `SectionList` cannot expand past
    its initial render window without a real native layout engine (confirmed via an 8-second
    real-timer wait that did not resolve it — a hard cutoff, not a slow render), and a
    single-file Jest invocation reliably crashes/hangs on teardown due to a React 19
    deferred-`act()`-flush racing Jest's module-registry teardown, triggered by
    `react-native-paper` components that lazily construct an `Animated.Value`. Both are
    documented as evidenced findings in `docs/DECISIONS.md`, not silently patched around;
    the first was fixed at the test-harness level (a `SectionList` mock) after confirming a
    production `initialNumToRender` change would have been a Jest-only workaround with a real
    (if small) production cost; the second is documented as technical debt with an explicit
    instruction on record not to mask it with `--forceExit` in `npm test`/CI.
  - **172/172 Jest tests pass (28 suites, up from 144/24)** covering the new domain layer and
    UI components (`AssigneeLabel`, `AssigneePicker`, `FamilyTaskRow`, `FamilyTaskBoard`,
    `TaskEditorForm`'s shared-task mode). `71` new pgTAP assertions were added
    (`263` total across the whole schema, pending a fresh full-suite re-run this same session
    per its own verification checklist — not yet re-confirmed as of this log entry).
  - **This wiki update is explicitly interim**, per this session's own instruction: the real
    multi-user backend integration script and the Maestro E2E flows have not run yet, and both
    this raw session file and the affected wiki pages will be updated again once they have,
    before the phase is reported complete.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-04T00:00:00Z — Phase 5 (final): real backend integration, Maestro E2E, checkpoint verification

- **Operation type:** verification + E2E implementation + bug fixing + wiki update (final pass
  for this phase, superseding the "interim" status of the previous entry)
- **Source material ingested:** the "Continuation" section appended to
  [`knowledge/raw/sessions/2026-09-05-phase5-shared-family-tasks.md`](../raw/sessions/2026-09-05-phase5-shared-family-tasks.md).
- **Wiki pages updated:** `engineering/testing-strategy.md` (Maestro E2E moved from "not yet
  implemented" to confirmed/current, with the full findings summary and a link to
  DECISIONS.md).
- **Canonical docs updated:** `docs/DECISIONS.md` (new Phase 5 subsections: the real backend
  integration results, Maestro installation, and eight individually-evidenced findings from
  getting the three flows to pass reliably), `docs/TEST_STRATEGY.md` (E2E row updated from "not
  configured" to implemented), `docs/PRODUCT.md` ("Assignment workflow" — see contradiction
  below).
- **Decisions/contradictions recorded:**
  - Real multi-user backend integration (ad hoc script, not committed): **32/32 checks passed**
    against a live local stack with two real `auth.users` accounts, an outsider, and an
    anonymous request — including genuine concurrent Take Task via parallel `curl`, not a
    simulated race.
  - Maestro 2.10.0 installed and all three required flows (`personal_task_smoke`,
    `family_task_workflow`, `assignment_decline`) reached two consecutive fully clean,
    unattended runs each, cross-verified against real database state. Getting there surfaced
    and fixed **one real application bug**: `TaskEditorForm`'s `beforeRemove` unsaved-changes
    guard had a stale-closure race (`onDone()` navigates away in the same tick a mutation
    resolves, before `isSubmitSuccessful`'s state update had propagated through a re-render),
    causing a spurious "Discard changes?" dialog after an already-successful save — fixed via a
    synchronously-set ref, independent of Maestro; a real user could in principle have hit the
    same bug. Also found and fixed **two bugs in the flow logic itself** (not the app): a blind
    recovery retry that could double-submit a task after the dialog above, and a blind
    double-tap trigger on `AssigneePicker` that could self-assign instead of assigning to the
    intended member — both confirmed via direct database/screenshot evidence, not assumed.
    Plus four environment-level findings, each root-caused via `maestro hierarchy` rather than
    guessed at: password/text-injection on `tapOn` right after typing, merged accessibility
    text on compound `Pressable`s, the leftmost/rightmost tab bar items being unmatchable by
    text or testID at all (worked around with a coordinate tap), and an unreliable `checked`
    selector attribute for a custom checkbox. Full writeup with evidence for each:
    `docs/DECISIONS.md`, "Phase 5."
  - **Found and fixed a real cross-document contradiction**, not assumed absent:
    `docs/PRODUCT.md`'s "Assignment workflow" section claimed "the recipient is notified" and
    described `task_assignments` as a "proposed shape," both stale — `SECURITY_AND_PRIVACY.md`
    already correctly listed assignment/response notifications as "Not yet implemented" (only
    an in-app pending-count badge exists this phase), and `task_assignments` has been
    implemented exactly as `DATA_MODEL.md` describes since this same phase's migration.
    `PRODUCT.md` corrected to match; `DATA_MODEL.md`/`SECURITY_AND_PRIVACY.md`/`ARCHITECTURE.md`
    were checked and found already accurate, not assumed so.
  - Full checkpoint verification re-run clean: Prettier, `tsc`, ESLint, Jest (172/172, no
    regressions), `wiki:lint`, `supabase db reset` + pgTAP (263/263), `expo config`,
    `expo-doctor` (20/21 — one pre-existing, unrelated Expo SDK patch-version drift, out of
    scope given this repo's deliberate pinning philosophy), and both `expo export` platforms.
  - Three logical git commits landed on `feature/shared-family-tasks` (still unpushed, per this
    repo's git rules): the `TaskEditorForm` bug fix, testID/E2E-instrumentation source changes,
    and the Maestro flows/scripts themselves — kept separate even where they touched the same
    file, since one is a behavior fix and the others are test infrastructure.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-06T00:00:00Z — Phase 5 closure pass: Expo Doctor fix, Maestro tap hardening

- **Operation type:** hardening + investigation + wiki update
- **Source material ingested:** the "Closure pass" section appended to
  [`knowledge/raw/sessions/2026-09-05-phase5-shared-family-tasks.md`](../raw/sessions/2026-09-05-phase5-shared-family-tasks.md).
- **Wiki pages updated:** `engineering/testing-strategy.md` (corrected the `tabBarTestID`
  finding to name the real prop, `tabBarButtonTestID`; reframed the boundary-tab issue as a
  tap-delivery limitation proven independent of selector type, not a matching problem; added
  the Expo Doctor resolution).
- **Canonical docs updated:** `docs/DECISIONS.md` — corrected the "leftmost/rightmost tab bar
  items" entry with the conclusive investigation (real testID confirmed reaching native via
  `tabBarButtonTestID`, tap still proven not to land 3/3 with screenshot evidence), generalized
  the "genuine hangs" entry to include silent no-op taps, and added a new entry for the Expo
  SDK patch-version resolution.
- **Decisions/contradictions recorded:**
  - **Corrected a claim from the previous entry, not silently**: `tabBarTestID` "not respected
    by Expo Router" was actually the wrong prop name, not a real framework gap — the correct
    prop, `tabBarButtonTestID`, works and now ships in `app/(app)/_layout.tsx`. Every middle
    tab across all three Maestro flows now matches by this stable id instead of text.
  - Proved, rather than assumed, that the boundary-tab tap failure is a genuine touch-delivery
    limitation independent of selector: with a hierarchy-confirmed real testID in hand, an
    id-based `tapOn` on the rightmost tab still failed to land 3/3 in isolation (Maestro
    reported `COMPLETED`; the screenshot taken immediately after showed no navigation
    occurred). The percentage-based coordinate-tap workaround is retained for exactly the two
    edge tabs, now on stronger evidence.
  - Generalized a prior finding: the "genuine Maestro/XCUITest hangs" technical debt isn't only
    a hang-with-dead-output failure mode — the same underlying rare tap-delivery issue can also
    surface as a false `COMPLETED` with no effect, observed twice on a genuine middle tab
    during this pass's verification runs (always clean on immediate retry).
  - Expo Doctor's 20/21 was traced to ordinary lockfile staleness (existing `~57.0.x` ranges
    already permitted the newer patches), not a deliberate pin — explicitly distinguished from
    this repo's real TypeScript/ESLint pins, which exist for genuine peer-dependency conflicts.
    Fixed via `npx expo install --fix` plus a full native rebuild (required since two of the
    three packages ship native code); re-verified clean across the full checkpoint suite.
    `expo-doctor` now 21/21.
  - All three Maestro flows re-verified with two consecutive fully clean, unattended runs each
    after every change in this pass.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-06T01:00:00Z — Phase 5 final consistency pass: report corrections, backend script committed, retry hardening

- **Operation type:** correction + hardening + wiki update
- **Source material ingested:** the "Final consistency pass" section appended to
  [`knowledge/raw/sessions/2026-09-05-phase5-shared-family-tasks.md`](../raw/sessions/2026-09-05-phase5-shared-family-tasks.md).
- **Wiki pages updated:** `engineering/testing-strategy.md` (corrected run-count claim to the
  3x9 final verification numbers, reframed tap-delivery flakiness as significant rather than
  rare, documented the retry-hardening pattern and the Reduce Motion investigation).
- **Canonical docs updated:** `docs/DECISIONS.md` (reframed the hangs/silent-no-op entry's
  severity, added the Reduce Motion investigation result, added a new "Retry hardening" entry
  with the 3x9 final verification numbers).
- **Decisions/contradictions recorded:**
  - **Corrected two errors in the previous report, not silently**: the commit count was
    reported as 17 while only 14 hashes were listed — `git rev-list --count` confirms 14, a
    plain counting mistake. The base commit's description ("main's successor line") was
    imprecise — `80aae74` is exactly `develop`'s tip (verified via `git rev-parse develop` and
    `git merge-base`), and is confirmed NOT an ancestor of `main` at all.
  - Committed `scripts/e2e-backend.sh` (`npm run e2e:backend`), replacing the ad hoc/uncommitted
    script: credentials now read dynamically from `supabase status`, a hard localhost-only
    safety gate, unique per-run identities, and a `trap`-based cleanup. Building the cleanup
    surfaced and fixed a real FK-ordering bug: `task_assignments`' composite FK to
    `family_members` isn't cascaded from `families`, so it must be cleared first or the cascade
    delete 409s.
  - Investigated Maestro/Simulator animation stabilization: Maestro has no built-in option
    (confirmed via binary search of its jars); Reduce Motion is settable at the Simulator level
    via `simctl` and is now enabled by `scripts/e2e-ios.sh`, honestly framed as unproven since
    the flakiness was already isolated to touch delivery, not animation timing.
  - Hardened every mutating/navigating tap across all three flows with a bounded,
    state-verified conditional retry (proves non-success before ever retrying — never blind).
    Final verification: 3 consecutive full runs of all three flows (9 completions) — all
    passed, 0 retries actually triggered, 1 genuine hang requiring a full flow restart.
    Reported as "passed this run," explicitly not claimed as newly deterministic.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-06T12:00:00Z — Phase 6: Reliable Family Assignment Push Notifications

- **Operation type:** implementation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-06-phase6-push-notifications.md`](../raw/sessions/2026-09-06-phase6-push-notifications.md).
- **Wiki pages created:** `engineering/push-notifications.md` (new — the outbox/dispatcher
  design, recipient-derivation rules, schema-level API isolation, client layering, and testing
  approach).
- **Wiki pages updated:** `wiki/index.md` (linked the new page), `engineering/security-model.md`
  (Mechanism 4 now implemented; new Mechanism 4a — schema-level API exclusion; the anon-EXECUTE
  gap's third recurrence; assertion count 192 → 293), `engineering/data-model.md` (migration
  count 11 → 13; new entities), `engineering/testing-strategy.md` (pgTAP count 263 → 293; new
  Edge Function/Deno test layer; two new RNTL/Jest conventions), `engineering/system-architecture.md`
  (`pendingNotificationRoute` added to the state-boundary rule; a fourth layering reference
  implementation; a second runtime this app's tooling excludes), `domain/tasks-and-assignments.md`
  (a "Push notifications" section + cross-link), `product/roadmap.md` (reminders item updated —
  the token-registration/dispatcher infrastructure it called out as missing now exists, wired
  to assignments only; Phase 6's own non-goals listed), `product/glossary.md` ("Task" entry
  corrected to reflect Phase 5; two new terms — outbox, dispatcher).
- **Canonical docs updated:** `docs/DATA_MODEL.md` (`notification_tokens.deactivated_at`, new
  `notification_preferences` table, new "notifications schema" section), `docs/SECURITY_AND_PRIVACY.md`
  (Mechanism 4 rewritten to match what's actually implemented; new Mechanism 4a), `docs/ARCHITECTURE.md`
  (new "Push notifications" section; folder tree and stack table updated), `docs/ROADMAP.md`
  (reminders item updated; new "Push notification scope not covered by Phase 6" section),
  `docs/TEST_STRATEGY.md` (new Edge Function test row; RLS row assertion count; two new
  conventions), `docs/PRODUCT.md` (the "later phase, not this one" line for assignment
  notifications corrected — this is that phase), `docs/DECISIONS.md` (new "Phase 6" section:
  outbox-vs-direct-send rationale, the schema-exclusion design, claim/idempotency design,
  `PushTransport` interface rationale, Deno tooling-isolation rationale, the recurred
  anon-EXECUTE gap, the contextual-permission-request decision, the `e2e-notifications.sh`
  portability fixes, and the exact manual deployment steps still required), `README.md`
  (Phase 5 and Phase 6 entries added to "Current state" — Phase 5 had never been added; new
  scripts in the table).
- **Decisions/contradictions recorded:**
  - `docs/PRODUCT.md` and `docs/SECURITY_AND_PRIVACY.md` both previously described assignment
    notifications as "a later phase, not this one" — that phase has now arrived; both corrected
    to describe the implemented design rather than defer it a second time.
  - `README.md`'s "Current state" section had never been updated for Phase 5 at all (still
    ended at Phase 4, listing shared-task assignment as "not implemented" even though Phase 5
    had shipped and merged) — a pre-existing staleness gap, not introduced this phase, fixed
    alongside the Phase 6 addition rather than left further behind.
  - The anon-EXECUTE-grant gap (Phase 3, recurred Phase 5) recurred a third time on two new
    Phase 6 functions — recorded as evidence the "verify `pg_proc.proacl` on every new
    `SECURITY DEFINER` function" instruction is genuinely load-bearing, not a one-time cleanup.
  - Two non-obvious RNTL/Jest gotchas were root-caused via isolated minimal repros this session
    (not guessed, not worked around blindly): a synchronous `act()` call corrupting React's
    act-scope for a *later* test's `renderHook` in the same file, and ESM-interop wrapping
    (`_interopRequireWildcard`) snapshotting a plain mocked data property's value per import
    call site, defeating a test's attempt to mutate it — recorded in both `docs/TEST_STRATEGY.md`
    and `engineering/testing-strategy.md` as new conventions, since both are exactly the kind
    of hard-won, non-obvious lesson this wiki exists to preserve.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-07T12:00:00Z — Phase 7: Family Calendar, Child Events, and Responsibilities

- **Operation type:** implementation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-07-phase7-family-calendar.md`](../raw/sessions/2026-09-07-phase7-family-calendar.md).
- **Wiki pages created:** `engineering/family-calendar.md` (new — schema evolution, the
  audit finding, the responsibility state machine, conflict detection, the two-view read
  model, timezone handling, the Family-Today-is-the-Calendar-screen decision, and the
  notification outbox extension).
- **Wiki pages updated:** `wiki/index.md` (linked the new page), `domain/events-and-
  responsibilities.md` (UI/RPC layer now implemented, was previously marked not built),
  `domain/privacy-and-availability.md` (Mechanism 4 status corrected — implemented, not
  pending; Phase 4's `tasks` gap entry paired with the new Phase 7 `events` one),
  `engineering/security-model.md` (five real gaps now, not four; new Mechanism 4b; a new
  "Calendar mutations are RPC-only too" section mirroring the Phase 5 shared-task one;
  assertion count 293 → 381), `engineering/data-model.md` (migration count 13 → 14; new
  entities; Phase 7 refinements section), `engineering/testing-strategy.md` (pgTAP count and
  file list; a new bash-subshell-array convention; Maestro's Phase 6/7 non-coverage made
  explicit), `engineering/system-architecture.md` (a fifth layering reference
  implementation), `product/roadmap.md` (calendar scope not covered by Phase 7; conflict
  *detection* moved from "V2 not implemented" to "implemented, resolution remains V2"),
  `product/glossary.md` ("Family Today"/"Event"/"Responsibility" entries corrected from
  not-built to implemented; two new terms — conflict detection, and "Take" extended to cover
  responsibilities too).
- **Canonical docs updated:** `docs/DATA_MODEL.md` (events.deleted_at,
  responsibility_assignments, the two new sanitized views, has_member_schedule_conflict,
  timezone handling), `docs/SECURITY_AND_PRIVACY.md` (Mechanism 4 extended to event-
  responsibility events; new Mechanism 4b; the Phase 7 audit-finding bullet), `docs/
  ARCHITECTURE.md` (new "Family calendar" section), `docs/DECISIONS.md` (new "Phase 7"
  section: schema-evolution rationale, the audit finding, the second-audit-table decision,
  the hard-delete-on-remove decision, the conflict-function design, the Family-Today
  decision, the all-day-event deferral, and the cross-script subshell-array bug), `docs/
  ROADMAP.md` (calendar non-goals; conflict detection moved to "implemented"), `docs/
  TEST_STRATEGY.md` (new pgTAP/backend-script/Jest rows; Maestro non-coverage stated
  explicitly, not left implicit), `docs/PRODUCT.md` (Calendar tab description corrected from
  placeholder to implemented), `README.md` (Phase 7 added to "Current state"; new
  `e2e:calendar` script).
- **Decisions/contradictions recorded:**
  - `docs/PRODUCT.md`'s MVP-navigation section and `knowledge/wiki`'s own "Family Today"/
    "Event"/"Responsibility" glossary entries all described the Calendar tab and these
    concepts as not-yet-built — all corrected to describe what's actually implemented rather
    than deferred a second time, the same pattern as Phase 6's PRODUCT.md correction.
  - A genuine, previously-undiscovered bug affecting two prior phases' own backend
    integration scripts (`e2e-notifications.sh` since Phase 6; `e2e-backend.sh` checked but
    found unaffected) — `admin_create_user`'s array append ran inside a subshell created by
    command substitution at every call site, so `CREATED_USER_IDS` was always empty and
    `cleanup()`'s user-deletion loop never actually iterated. `e2e-notifications.sh` had been
    silently leaking its test `auth.users` accounts on every run since Phase 6; Phase 6's own
    "no residue" verification was correct about what it checked (family/outbox rows) but
    incomplete (never checked the users themselves). Found while building this phase's own
    `e2e-calendar.sh`, fixed in both scripts, 12 leaked accounts purged, both re-verified
    clean. Recorded as a correction to a specific claim in Phase 6's final report, not
    silently patched.
  - The same class of direct-grant security gap Phase 4 found for `tasks` recurred for
    `events`/`event_participants`/`responsibilities` (Phase 2 schema, never revisited until
    now) — the fourth recurrence of this general finding pattern across phases (Phase 3
    anon-EXECUTE, Phase 5 anon-EXECUTE, Phase 6 anon-EXECUTE, now Phase 7 direct-grant),
    reinforcing that every phase's own audit-before-building step is genuinely load-bearing.
  - `responsibility_assignments` was initially designed with zero SELECT grant for
    `authenticated` at all — caught as a real bug via the pgTAP test file's own audit-history
    assertions failing with a permission error, not by design review. Corrected to grant
    `select` (RLS-scoped), which is actually a tighter design than the precedent
    (`task_assignments` still carries a Phase-2-era direct-INSERT policy this phase did not
    touch or revisit, since it was out of this phase's scope).
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-08T00:00:00Z — Phase 6.1: Deployment & Real Device Push Validation

- **Operation type:** scoping decision + implementation (local-only) + documentation +
  wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md`](../raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md).
- **Wiki pages updated:** `engineering/push-notifications.md` (status corrected to "not
  deployed"; new "Security regression guard" and "Deployment status" sections), `engineering/
  security-model.md` (assertion count 293 → 299; a new bullet for the durable regression
  guard closing the recurring anon-EXECUTE finding), `engineering/testing-strategy.md`
  (pgTAP count/file updated; a new "prove a regression guard actually fails before trusting
  it" convention).
- **Canonical docs updated:** a new `docs/DEPLOYMENT.md` (full runbook: EAS setup, hosted
  Supabase deploy commands, Database Webhook + `pg_cron` configuration and why both, the
  manual on-device acceptance matrix, Expo tickets-vs-receipts, at-least-once delivery
  semantics stated explicitly, observability, repeatable secret-audit commands, and a "Known
  limitations" section), `docs/DECISIONS.md` (new "Phase 6.1" section: the scope-split
  decision and why, the regression-guard design rationale, why `DEPLOYMENT.md` is a new file
  rather than folded into an existing doc), `docs/TEST_STRATEGY.md` (RLS row updated for the
  new test), `README.md` (Phase 6.1 entry added to "Current state"; `docs/DEPLOYMENT.md`
  linked).
- **Decisions/contradictions recorded:**
  - This phase's own brief spans work an agent can do autonomously (a security regression
    guard, a secret audit, documentation) and work that fundamentally requires the
    repository operator's own external accounts and a physical device (EAS, a hosted
    Supabase project, real push credentials, an actual device tap) — the latter is not a
    permissions question, since even with explicit authorization an agent cannot tap a
    physical device. Investigated the repo first (confirmed genuinely no linked EAS/hosted-
    Supabase project exists) rather than assuming, then asked the user directly how to
    proceed rather than silently doing only part of the brief or spending significant effort
    on deployment tooling for infrastructure that might not get created. Recorded as a
    scoping decision in `docs/DECISIONS.md`, not left implicit.
  - The anon-EXECUTE-grant finding had recurred three times (Phase 3, 5, 6) with no
    automated test for the general invariant ever existing — every prior "fix" closed only
    the specific instance found that phase. Phase 6.1 treats this as evidence the class of
    finding itself needed a durable, schema-driven guard, not another one-off catch — built
    and, importantly, verified to actually fail when the guarded-against bug is
    reintroduced (not just verified to pass against already-correct code, which would prove
    nothing about whether the guard works at all).
  - `NOTIFICATION_WORKER_SECRET` specifically had never been scanned for by name in any
    prior phase's bundle audit (Phase 6's own scan checked for `SERVICE_ROLE`/OAuth secret
    patterns, not this one) — closed as a real, if narrow, gap in previously-claimed
    verification coverage.
  - This log's own entry ordering for Phase 6.1 (dated 2026-09-08) follows the Phase 7 entry
    (dated 2026-09-07) even though Phase 6.1 was the branch actually merged into `develop`
    first — `feature/family-calendar` was rebased onto the post-Phase-6.1 `develop` tip after
    the fact, and this entry order matches the entries' own dates rather than the order the
    branches happened to land in.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-08T00:00:00Z — Phase 7 follow-up: audit against a more detailed brief

- **Operation type:** audit + implementation (targeted fixes) + documentation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-08-phase7-followup-audit.md`](../raw/sessions/2026-09-08-phase7-followup-audit.md).
- **Wiki pages updated:** `engineering/family-calendar.md` (Jest coverage section rewritten —
  the components previously marked "not covered this phase" are now covered; e2e-calendar
  check count 27 → 28; new "Phase 7 follow-up" section), `engineering/testing-strategy.md`
  (pgTAP count 387 → 391; new Components-row bullet for the three new calendar test files; a
  new "screen tests must never live inside `app/`" convention), `engineering/security-model.md`
  (assertion count 387 → 391; a note on the trigger-function revoke consistency fix, explicitly
  not counted as a seventh "real gap" since nothing was reachable).
- **Canonical docs updated:** `docs/DECISIONS.md` (new "Phase 7 follow-up" section covering all
  four findings below), `docs/TEST_STRATEGY.md` (Components row rewritten; pgTAP count updated;
  new convention entry for the `app/`-test-file bundling gotcha), `README.md` (Phase 7 bullet
  updated to mention the follow-up's UI-coverage and offline/refresh additions).
- **Decisions/contradictions recorded:**
  - A later, more detailed Phase 7 brief arrived after the original Phase 7 branch was already
    built and rebased onto `develop`. Followed that brief's own explicit working rule: audited
    the existing implementation against it line by line before changing anything, rather than
    re-implementing from scratch or assuming the original pass already satisfied it.
  - Three of four new trigger functions in the Phase 7 migration were missing an explicit
    `revoke` present on the fourth and established as Phase 6's own convention for this exact
    situation. Confirmed via the Phase 6.1 regression guard (unchanged pass before/after) that
    this was never actually exploitable — trigger functions are uninvokable directly regardless
    of grant — and fixed anyway for consistency, explicitly documented as *not* a seventh "real
    gap" in `security-model.md`'s running count, to avoid overstating severity.
  - The `declined`/`taken` notification event types had no direct pgTAP or e2e-script assertion
    despite the brief explicitly requiring coverage of all four event types. Worse, discovered
    while fixing this that the e2e script's existing `take_event_responsibility` call was made
    by the event's own owner — the exact self-actor/self-recipient case Mechanism 4's
    self-notification suppression is designed to catch — so no `taken` outbox row could ever
    have existed to assert on even if the assertion had been written. Changed the actor to a
    different family member and documented why, rather than silently working around it.
  - The original Phase 7 pass's own explicit deferral of Jest UI coverage for
    `EventEditorForm`/`ResponsibilityRow`/`app/(app)/calendar.tsx` (citing scope and the
    Phase-5-documented RNTL `<Menu>` limitation) is overridden by this brief's explicit
    "deterministic Jest UI tests are mandatory and may not be deferred" instruction — built all
    three, same `<Menu>` scoping constraint still applied where relevant.
  - A genuinely new, previously undocumented environment constraint was found while building
    the third of those: a test file placed inside `app/` (co-located with its screen, matching
    every other test file's convention relative to its source) passes under Jest but breaks
    `npx expo export --platform ios` outright, because Expo Router's Metro bundler treats every
    file under `app/` as a route candidate regardless of filename. This is confirmed to be the
    actual reason no other screen in this codebase has a test file, not an oversight — recorded
    as a hard constraint and a new convention (test screens from `src/`, import via relative
    path) rather than silently worked around with no explanation.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-08T00:00:00Z — Phase 8: Recurring Tasks, Scheduled Reminders, and Snooze

- **Operation type:** implementation (new feature) + native verification + documentation +
  wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md`](../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md).
- **Wiki pages updated:** new
  `engineering/recurring-tasks-and-reminders.md`; `index.md` (new page linked);
  `domain/personal-planning.md` (recurrence/reminder boundaries rewritten from "deliberately
  not built" to delivered); `product/mvp-definition.md` (implementation status brought current
  through Phase 8 — every MVP-list bullet is now implemented); `product/roadmap.md`
  (recurrence/reminders moved from "MVP-scope items not yet built" to delivered; calendar/push
  non-goal lists clarified as task-scoped, not calendar-event-scoped); `engineering/data-model.md`
  (new `task_occurrences` entity, `reminders`/`recurrence_rules`/`notification_preferences`
  evolution, migration count 14→16, resolved the long-open "recurrence materialization
  strategy" unresolved item); `engineering/security-model.md` (pgTAP count 391→461, files
  13→14; new "not a seventh gap" entry for the pre-emptive `reminders` RPC-only conversion;
  Mechanism 4b extension and new Mechanism 4c; new "Recurrence/reminder mutations are RPC-only
  too" section); `engineering/testing-strategy.md` (Jest count 264→331, suites 37→42; pgTAP
  count/file breakdown updated; new Phase 8 Components bullet; the `<Menu>` limitation
  explicitly extended from "Jest-only" to "confirmed live via Maestro on a real device build,
  narrowed to native-modal-presented screens"; new flaky-test convention entry);
  `engineering/push-notifications.md` (clarified reminders are now delivered, deliberately
  never through this outbox); `engineering/family-calendar.md` (conflict-detection Phase 8
  extension noted).
- **Canonical docs updated:** `docs/DECISIONS.md` (new "Phase 8" subsections: the device-local
  scheduler rationale, reminder identity, permission-timing gap fix, cross-router
  disambiguation, Snooze/Done semantics, the full native-verification diagnostic — hierarchy
  dump, frame-by-frame video, second-Menu reproduction — and a "Verified, not just asserted"
  closing section with exact re-run counts); `docs/DATA_MODEL.md` (`task_occurrences` section,
  `reminders`/`recurrence_rules` rewritten, "Recurrence — deliberately not exposed" section
  replaced); `docs/ARCHITECTURE.md` (new "Recurring tasks and local reminder scheduling"
  section); `docs/SECURITY_AND_PRIVACY.md` (new Mechanism 4c, `reminders` RPC-only conversion
  bullet, Mechanism 4/4b framing updated); `docs/TEST_STRATEGY.md` (new `<Menu>`
  live-Maestro-confirmation bullet); `docs/ROADMAP.md` (MVP-scope items moved from "not yet
  built" to delivered; calendar/push non-goal lists clarified); `README.md` (new Phase 8
  bullet, `e2e:recurrence` script row, corrected "still not implemented" list).
- **Decisions/contradictions recorded:**
  - Chose bounded materialized occurrences (one real `task_occurrences` row per generated
    occurrence, idempotent via `unique (task_id, original_date)`) over fully virtual
    (computed-on-read) occurrences, for three concrete reasons recorded in `DECISIONS.md` —
    efficient date-range joins for Today/Tomorrow/Calendar, a real row for conflict detection
    to check, and simpler idempotent-concurrency reasoning.
  - Direct testing against real Postgres before writing pgTAP surfaced four real bugs: a
    weekly-interval `date_trunc` timestamp-vs-date cast bug, a weekly-series first-occurrence
    anchor not snapping to a selected weekday, four occurrence RPCs not checking the parent
    series' soft-delete state, and a real timezone-mixing bug in my own conflict-detection
    pgTAP assertion (hardcoded UTC offset vs. the test runner's actual Europe/Kyiv system
    timezone) — fixed via proper `at time zone` conversion rather than hand-computed offsets.
  - A real permission-request gap was found and fixed mid-session: `ReminderEditorSection`'s
    original `addPreset` created a reminder row with no OS permission check at all, meaning a
    reminder could be silently created and then never fire. Fixed by checking
    `getNotificationPermissionStatus()` first and only requesting when `'undetermined'`.
  - A real cross-router payload collision was found and fixed while wiring in the second
    (local-reminder) notification tap handler: Phase 6's existing router had no way to exclude
    a local reminder payload, which would otherwise have been double- or mis-handled by both
    routers on the same tap. Fixed by excluding any payload carrying a `notificationType`
    field from the Phase 6 router.
  - A genuinely new, live-environment confirmation of an already-documented limitation: Phase
    5 recorded `react-native-paper`'s `<Menu>` as unreliable under Jest/`react-test-renderer`.
    This session reproduced the identical failure in a real native build driven by Maestro —
    diagnosed exhaustively (six tap strategies, a live accessibility-hierarchy dump, a
    frame-by-frame screen-recording extraction via `ffmpeg` installed specifically for this,
    and a second independent `<Menu>` on the same screen) rather than assumed, narrowing the
    cause to "any `<Menu>` anchored on a screen presented via `presentation: 'modal'`." This
    blocked real on-device verification of local-notification delivery/tap/Snooze/Done, which
    is honestly reported as not observed, per this phase's own explicit instruction not to
    describe a notification as observed unless it actually appeared. Build, launch, sign-in,
    and data-flow (a task and a reminder created via the app's own RPC path both correctly
    rendering in the real running app) were directly, visually verified on a real iOS 26.5
    Simulator.
  - A real, full-suite-only flaky test was found and fixed: `ReminderEditorSection.test.tsx`'s
    two Menu-driven tests passed in isolation but intermittently failed among the full 42-suite
    Jest run — the same `<Menu>`/Portal unreliability reproducing intermittently under Jest at
    scale. Fixed by extracting the pure `existingReminderOffsets()` function and testing it
    directly, never driving the Menu open. Confirmed stable across 3 consecutive full runs
    afterward.
  - Android: exports and `expo-doctor` pass with the Phase 8 schema/RPC changes in place; no
    Android exact-alarm permission was requested (Section 24 stop-condition, correctly never
    triggered). A real Android native build/run was not attempted this session — reported
    honestly as unverified rather than assumed equivalent to the iOS result.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-08T00:00:00Z — Phase 8 final validation pass: real notification evidence, UX audit, a real bug fix

- **Operation type:** verification (native, on-device) + audit + implementation (bug fix,
  dead-code removal) + regression tests + documentation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-08-phase8-final-validation.md`](../raw/sessions/2026-09-08-phase8-final-validation.md).
- **Wiki pages updated:** `engineering/recurring-tasks-and-reminders.md` (status line changed
  from "not yet verified" to "verified on-device"; the `<Menu>` section rewritten to describe
  the `__DEV__`-diagnostic-screen workaround and the full real-device evidence obtained through
  it; two new sections — the Tonight/Tomorrow ordering bug, and the occurrence-vs-series UX
  audit outcome; test counts updated); `engineering/testing-strategy.md` (two new convention
  bullets — dev-diagnostic screens as an accepted workaround for a UI-automation limitation, and
  fixing system time for any test whose assertions depend on real wall-clock "now"; Jest counts
  331/42 → 342/43).
- **Canonical docs updated:** `docs/DECISIONS.md` (Phase 8's native-verification section
  rewritten — the `<Menu>` blocker kept as diagnosed, but followed by the `dev-diagnostics.tsx`
  workaround and seven concretely itemized, real, on-device-observed results — permission grant,
  push-token independence, scheduled-key/fire-time proof, delivery observed twice, reschedule
  cancel-and-reschedule, delete cancellation, past-reminder skip — with tap-to-navigate/Snooze/
  Done reframed as a distinct, structural cross-process-UI limitation rather than grouped under
  the `<Menu>` finding; new "Final validation pass" subsection covering the UX audit and the
  Tonight/Tomorrow bug; "Verified, not just asserted" counts updated); `docs/ARCHITECTURE.md`
  (the `<Menu>` note extended to mention the diagnostic-screen workaround);
  `docs/TEST_STRATEGY.md` (two new convention bullets, mirroring the wiki);
  `docs/MVP_SCOPE.md` (conflict detection corrected from "V2, out of scope" to "implemented in
  Phase 7; resolution remains V2" — a real, pre-existing docs/code contradiction unrelated to
  Phase 8, found while auditing scope boundaries).
- **Decisions/contradictions recorded:**
  - Rather than accept the already-documented `<Menu>` limitation as a hard stop on Section 19's
    on-device verification requirement, added a `__DEV__`-only diagnostic screen
    (`app/dev-diagnostics.tsx`) that calls the exact production functions the broken Menu items
    would have, skipping only the broken UI trigger. This is recorded explicitly as a workaround
    with a clear bar (real production code only, never a bypassed business rule, never reachable
    in production or normal navigation) rather than a shortcut, per the task's own explicit
    allowance for "a development-only diagnostic log or existing production scheduler
    inspection."
  - This let real on-device evidence be obtained for permission-grant, push-token independence,
    scheduled-key/fire-time correctness, actual delivery (observed twice, via a lock-screen
    screenshot and via the scheduled-count transition at fire time), reschedule
    (cancel-and-reschedule under the same key), delete (cancellation), and past-reminder
    skip-and-never-reschedule behavior — all against real database rows and the real production
    reconciliation function, not simulated.
  - Tap-to-navigate and the Snooze/Done notification actions remained unverified, diagnosed as a
    distinct, structural limitation from the `<Menu>` one: Maestro's `appId`-scoped iOS
    automation can reliably drive exactly one piece of cross-process system UI (the OS
    permission alert, confirmed working) but not ordinary lock-screen/Notification-Center
    content, tried three ways (text selector, point tap, a Notification Center swipe from two
    different screens). Recorded as not observed, not worked around further, consistent with
    the standing instruction never to claim an observation that didn't happen.
  - A real product-level bug was found specifically because this session's own test run
    happened to execute near midnight: `SNOOZE_TONIGHT` could resolve to a later timestamp than
    `SNOOZE_TOMORROW` when tapped after the fixed 20:00 anchor had already passed for the day —
    inverting the two options exactly when a user would reach for "Tonight" in the evening.
    Fixed in production (a bounded `now + 1 hour` fallback instead of the same anchor 24h later)
    and in the test (fixed system time via `jest.useFakeTimers().setSystemTime(...)`, split into
    a normal-hours case and a dedicated late-night case covering the exact scenario that broke).
  - Audited the "This occurrence / Entire series" UX brief section against the actual
    implementation and found it already correct by construction — every occurrence action
    (complete/restore/reschedule/skip) already targets the occurrence directly, every content
    edit already routes to the series, and the existing `seriesNotice` HelperText already states
    this — there was never an interactive scope-choice dialog to begin with, and therefore
    nothing misleading being shown. The one real finding was two dead, zero-reference i18n keys
    (`seriesActionThisOccurrence`/`seriesActionEntireSeries`) left over as unwired scaffolding,
    removed from both locale files. Added `TaskEditorForm.test.tsx` (the component had no test
    file at all before this) to lock in the correct behavior going forward, which incidentally
    confirmed `react-native-paper`'s `<Dialog>` — unlike `<Menu>` — mounts and interacts
    correctly under Jest, narrowing the existing Menu limitation to that component specifically.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-08T00:00:00Z — Phase 8 production-surface cleanup: remove the temporary dev-diagnostics route

- **Operation type:** cleanup (code removal) + verification + documentation + wiki update
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-08-phase8-production-cleanup.md`](../raw/sessions/2026-09-08-phase8-production-cleanup.md).
- **Wiki pages updated:** `engineering/recurring-tasks-and-reminders.md` and
  `engineering/testing-strategy.md` — both edited to state plainly that
  `app/dev-diagnostics.tsx` was temporary and has since been removed before merge, while keeping
  the evidence list it produced intact (past tense, framed as a historical record, not a claim
  the screen still exists).
- **Canonical docs updated:** `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`,
  `docs/TEST_STRATEGY.md` — same correction (screen removed, evidence preserved).
- **Decisions/contradictions recorded:**
  - The prior pass's `app/dev-diagnostics.tsx` (a `__DEV__`-only screen used to obtain real
    on-device notification evidence around the `<Menu>` limitation) was always intended as
    temporary, not a permanent addition to the codebase — removed in this pass along with its
    route registration in `app/_layout.tsx`. Confirmed, not assumed, that removal is complete:
    zero source references remain in `app/`/`src/`; zero trace in either `expo export`
    platform's route manifest or bundled JS; zero trace in `npx expo config`'s public output.
  - The production functions the diagnostic screen called
    (`requestNotificationPermission`/`getNotificationPermissionStatus`, `reconcileReminders`,
    `expoLocalScheduler`, `useReminderNotificationActions`) live in their own files and were
    never modified by either adding or removing the diagnostic screen — it only ever called
    them, so the real on-device evidence obtained through it remains valid documentation of how
    those functions actually behave, even though the screen used to observe them no longer
    exists.
  - `knowledge/raw/` and `knowledge/wiki/log.md` are immutable/append-only by this repository's
    own stated convention — the prior raw session file and log entry describing the diagnostic
    screen's creation were left unedited (they accurately describe what was true at the time);
    this cleanup gets its own new raw file and log entry rather than rewriting history.
  - `expo-doctor` still reports the same `expo`/`expo-router` patch-version drift first noticed
    in the prior pass (`20/21`) — new versions published upstream, unrelated to this session's
    changes. Deliberately not bumped, consistent with this repository's stated tooling-version-
    pinning discipline; recorded as deferred rather than silently ignored or reflexively fixed.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-09T00:00:00Z — Phase 9 (Secure Realtime Sync, Offline Resilience, Conflict Center): in progress, first wiki entry

- **Operation type:** feature (new domain) + documentation + wiki update. **This phase is not
  finished** — this entry and the new wiki page both say so explicitly and must be updated
  again, not treated as a closing entry, once the remaining scope lands.
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-09-phase9-realtime-offline-partial.md`](../raw/sessions/2026-09-09-phase9-realtime-offline-partial.md).
  Covers both this session's client-layer work and the prior (compacted) session's database
  layer (commits `615c040`, `eee7cac`), which had never been logged here — this is the first
  Phase 9 wiki entry for either.
- **Wiki pages added:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md)
  (new, `status: proposed` — deliberately not `current`, tracks a "done" and "not done yet"
  list to be kept current as the phase continues rather than closed out prematurely).
- **Wiki pages updated:** [`index.md`](index.md) — added the new page under Engineering.
- **Canonical docs updated:** `docs/SECURITY_AND_PRIVACY.md` (Mechanism 3 rewritten from a
  Phase-2-era "not implemented, here's the planned design" note to the actual Broadcast
  implementation, which is more private than that old plan — content-free payloads, not
  merely sanitized ones — plus a new offline-cache-privacy paragraph explicitly stating
  app-sandbox storage is not the same guarantee as hardware encryption), `docs/ARCHITECTURE.md`
  (the provider-stack diagram was stale — missing `AuthProvider` entirely and in the wrong
  order relative to `QueryProvider` — corrected; new "Realtime sync (Phase 9)" section; "Offline
  & caching" rewritten from "not wired up yet" to the actual implementation), `docs/ROADMAP.md`
  and `docs/MVP_SCOPE.md` (moved the now-implemented subset of "advanced offline sync" out of
  "V2, design before building" into "implemented," with the still-V2 remainder — full manual
  conflict-resolution UI, offline editing beyond a personal task — precisely named rather than
  left as a blanket "still V2"), `docs/DECISIONS.md` (new "Phase 9 — in progress" entry),
  `docs/TEST_STRATEGY.md` (pgTAP file/assertion counts corrected from the stale Phase 7-era
  13 files/391 to the current 15 files/508; two new testing conventions recorded).
- **Decisions/contradictions recorded:**
  - `docs/SECURITY_AND_PRIVACY.md`'s old Mechanism 3 and `docs/ROADMAP.md`'s old "V2, design
    before building" framing were both genuine, accurate-at-the-time statements that had gone
    stale against code built either earlier in Phase 9 (the DB layer, previously undocumented)
    or in this session — corrected, not silently left contradicting the implementation the
    way the standing instruction warns against.
  - The actual Realtime payload design (fully content-free) is **stricter** than the Phase-2
    plan it replaces (a sanitized-but-present row shape) — recorded as a deliberate
    improvement the Phase 9 brief specified, not a scope creep needing separate justification.
  - Recurring-occurrence complete/restore was named in the brief's offline-queue scope
    (Section 9) alongside the six one-off-task operations that got built; it was not wired in
    this pass. Recorded as a known, tracked gap in the new wiki page's "Not done yet" list —
    not silently dropped from scope, not claimed as done.
  - The Conflict Center UI, the real local Realtime WebSocket integration test, the offline
    integration test suite, native device verification, and full manual conflict-resolution
    UI are all still unbuilt. `npm run verify` is green (51 suites, 427 tests) but the
    pgTAP/Deno/e2e:backend/e2e:notifications/e2e:calendar/e2e:recurrence suites were last
    confirmed green against the DB-layer commit only, before any client-side Phase 9 code
    existed — re-confirmation is still owed before this phase can be called complete.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-09T12:00:00Z — Phase 9 continued: Conflict Center, real integration tests, a real recurrence-script bug fix

- **Operation type:** feature (new domain) + test (two new real local integration suites) +
  bug fix (unrelated pre-existing script fragility) + wiki update. Still not the phase's
  closing entry — native verification and the full manual conflict-resolution UI remain open.
- **Source material ingested:**
  [`knowledge/raw/sessions/2026-09-09-phase9-conflict-center-and-integration-tests.md`](../raw/sessions/2026-09-09-phase9-conflict-center-and-integration-tests.md).
- **Wiki pages updated:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md) —
  "Done"/"Not done yet" split brought current (Conflict Center, both real integration test
  suites, and the re-confirmed e2e:backend/notifications/calendar/recurrence runs all moved
  from "not done" to "done"); still `status: proposed`, not `current`.
- **Canonical docs to be updated in this same pass:** `docs/DECISIONS.md` (Conflict Center
  design notes, the two integration suites' environment fixes, the e2e-recurrence.sh bug),
  `docs/TEST_STRATEGY.md` (new pgTAP/e2e counts and the two new `e2e:*` scripts),
  `docs/ARCHITECTURE.md`/`docs/SECURITY_AND_PRIVACY.md` if the Conflict Center's design
  warrants its own section beyond what Realtime/offline already cover.
- **Decisions/contradictions recorded:**
  - A private, family-linked event's Realtime broadcast **does** reach `family:<family_id>`
    (not withheld) — an assumption held while planning `scripts/e2e-realtime.mjs`, corrected
    by reading the actual trigger SQL before writing the test rather than asserting a wrong
    expectation. Correct by construction: the payload never carries content regardless of
    which topic it goes out on.
  - `e2e-recurrence.sh` had its own real, pre-existing wall-clock bug (a hardcoded creation
    date, unrelated to any Phase 9 code) — found only because re-verification happened to run
    a day after the script was last authored/tested. Fixed; not silently patched over.
  - Both new real integration suites (`e2e:offline`, `e2e:realtime`) needed real environment
    fixes before they could run at all under Jest/Node against a live backend (jest-expo's
    RN fetch polyfill breaking real network calls; a virtual env-var module needing an
    explicit transform carve-out; a non-cascading FK silently leaking test accounts on
    cleanup) — each is a genuine, reusable lesson for any future real-backend test in this
    repo, not just this phase's own scripts.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-09T14:00:00Z — Phase 9 continued: real native iOS verification, Maestro policy recorded

- **Operation type:** verification (real device) + documentation + wiki update. Still not the
  phase's closing entry — see the wiki page's remaining "Not done yet" list.
- **Wiki pages updated:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md) —
  native iOS verification and the Maestro policy decision moved from "not done" to "done";
  remaining gaps (full manual conflict-resolution UI, recurring-occurrence offline queue,
  network-disconnection/account-switch/Android testing) stay listed, `status` stays
  `proposed`.
- **Canonical docs updated:** `docs/DECISIONS.md` (five new subsections under the existing
  "Phase 9" entry: Conflict Center Review-routing rationale, the two real environment fixes
  behind the integration suites, the corrected private-event-broadcast assumption, the full
  native verification writeup, and the Maestro policy decision), `docs/TEST_STRATEGY.md`
  (E2E row extended with the Phase 9 native pass; the RLS/privacy row's stale "not yet
  written" note about the two integration suites corrected).
- **Decisions/contradictions recorded:**
  - A real, valuable piece of native evidence: with the Conflict Center open on a real
    Simulator build, an external `curl`-driven RPC call (simulating another device) made the
    on-screen conflict list update live with zero manual refresh — direct proof the full
    Realtime pipeline (trigger → Broadcast → real WebSocket → invalidation → refetch →
    re-render) works end to end on a running app, not only inside `e2e-realtime.mjs`'s own
    isolated test.
  - A genuine tool-level limitation (not an app defect) was independently reproduced: a
    Maestro assertion reported "1 conflict" as not visible on a step whose own screenshot
    shows that exact text clearly rendered — confirming the Simulator/Maestro touch-and-
    assertion-delivery flakiness `personal_task_smoke.yaml` already documented from Phase 5
    also affects assertions, not only taps. Recorded as inconclusive for the one interaction
    it affected (the Review action's tap-through), not asserted as either a pass or a bug —
    the underlying routing logic is already deterministically covered by
    `ConflictRow.test.tsx`.
  - A leftover `expo run:ios` process from an earlier point in this same session (idle ~18
    hours, its own log confirming it had already finished its work) was found still running
    and was terminated before starting this pass's own native build, to avoid it competing
    for the same Simulator device.
  - Network-disconnection testing, account-switch-no-flash, and Android were explicitly not
    attempted this pass — recorded as gaps, not silently skipped. The Maestro policy decision
    itself explains why network-disconnection specifically was deferred to `e2e:offline`
    rather than attempted via Maestro.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-09T15:00:00Z — Phase 9 continued: recurring-occurrence complete/restore joins the offline queue

- **Operation type:** feature (closes a previously tracked gap) + test + wiki update.
  Autonomous-loop tick — continuing this same session's own explicitly-tracked "Not done yet"
  list, not new/invented scope.
- **Wiki pages updated:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md) —
  the offline-queue "Done" bullet extended to cover occurrence complete/restore; the matching
  "Not done yet" item removed.
- **Canonical docs updated:** `docs/DECISIONS.md` — new subsection under the Phase 9 entry
  explaining why this needed no migration/RPC change at all (the occurrence RPCs were already
  idempotent by construction) and why no optimistic UI patch was added (matches the existing
  "deliberately not optimistic" rule for occurrence mutations, which predates Phase 9).
- **Decisions/contradictions recorded:** none — this closes a gap this same session had
  already identified and recorded, without discovering a new contradiction.
- **Verified:** `npm run verify` — 55 suites, 463 tests (7 new: 3 in
  `offlineQueueReplay.test.ts` covering the two new replay cases plus `RecurrenceServiceError`
  classification, 4 in a new `src/domain/recurrence/hooks.test.tsx` covering the offline/online
  branch and the bounded-queue error case), lint/typecheck/wiki:lint all clean.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

## 2026-09-10T12:00:00Z — Phase 9 completion pass: Sync Issues resolution UX

- **Operation type:** feature (closes Phase 9's last remaining gap) + migration + test + docs.
  User-directed: a full 16-section "Sync Conflict Resolution UX" brief, delivered after the
  user asked whether the phase was finished.
- **Wiki pages updated:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md) —
  status changed `proposed` → `current`; "Done and verified" gained the Sync Issues bullet and
  an extended offline-queue bullet (state-machine rename); "Not done yet" reduced to only the
  Phase-10-deferred device-hardware items; two new sections added ("A concurrency nuance worth
  knowing before touching Apply my change," and two new entries under the testing-gotchas
  section: the Zustand `useShallow` array-selector gotcha, and the singleton-`queryClient`
  test-hang gotcha).
- **Canonical docs updated:** `docs/DECISIONS.md` (Phase 9 status note → complete, plus a full
  new "Sync Issues resolution UX" subsection), `docs/ARCHITECTURE.md` ("Offline & caching"
  section extended), `docs/SECURITY_AND_PRIVACY.md` (new bullet: Sync Issues never renders a
  raw server error), `docs/ROADMAP.md` ("Offline behavior" section rewritten — conflict
  resolution moved from "still V2" to "implemented"), `docs/MVP_SCOPE.md` (same correction),
  `docs/TEST_STRATEGY.md` (Components row + RLS/privacy row counts and file lists updated),
  `README.md` (added a Phase 9 bullet — it had none before despite the phase being otherwise
  fully documented elsewhere; fixed a stale "Realtime sync... not implemented" claim in the
  same pass).
- **Decisions/contradictions recorded:** a real tension between the brief's own two Section-5
  instructions for Apply my change ("refetch latest server version" vs. "remain in Needs
  review if another update happened between review and application") — the implementation
  took the literal "refetch" reading, which means only a write racing inside Apply's own
  fetch-then-write pair (not the whole human review window) still produces a renewed conflict.
  Documented in DECISIONS.md and the wiki rather than silently resolved either way — see that
  entry if a future session needs to pin Apply to the exact reviewed version instead.
- **Two real, unrelated bugs found and fixed along the way** (not part of the brief, found
  while implementing it): (1) `schedule_personal_task`'s pre-existing `p_date is null →
  22023` check was accidentally dropped while rewriting the function for the P0002 change —
  caught by the existing pgTAP suite failing after `supabase db reset`, restored in its
  original position (before the existence lookup). (2) `SyncStatusIndicator.tsx` and the Sync
  Issues list screen both passed a new-array-every-call Zustand selector directly to
  `useOfflineQueueStore`, causing a real "Maximum update depth exceeded" infinite render loop
  under Zustand 5 — fixed with `useShallow`; this had also silently broken
  `CalendarScreen.test.tsx` as a knock-on (it renders the indicator).
- **Verified:** `npm run verify` — 60 suites / 544 tests (up from 55/463 — new:
  `syncIssueDisplay.test.ts`, `syncIssueResolution.test.ts`, `SyncIssueCard.test.tsx`,
  `SyncIssuesScreen.test.tsx`, `SyncIssueDetailScreen.test.tsx`, plus updates across the
  vocabulary-rewrite-affected files), lint/typecheck/wiki:lint all clean. `supabase db reset
  && supabase test db` — 16 files / 528 pgTAP assertions (new: `160_sync_issues_resolution_
  test.sql`, 20 assertions). `deno test` for `dispatch-notifications` — 11/11. `e2e:backend`
  32/32, `e2e:notifications` 24/24, `e2e:calendar` 28/28, `e2e:recurrence` 23/23 all
  re-confirmed. `e2e:offline` extended with a 14-step review/resolve scenario, run twice
  consecutively without a DB reset, both green. `e2e:realtime` run twice, both green (28/28).
  `expo config --type public`, both `expo export` platforms, `git diff --check` all clean.
  `expo-doctor` 20/21 — one pre-existing, unrelated patch-version drift (`expo`/`expo-router`),
  reported per this codebase's dependency-pinning precedent rather than bumped.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

## 2026-09-11T12:00:00Z — Phase 9 final security/concurrency pass

- **Operation type:** security fix + migration + test + docs. User-directed: a detailed 5-part
  brief identifying two specific defects in the immediately prior session's own Sync Issues
  work (a task-existence oracle, and a gap in Apply my change's review semantics) and
  requesting both be fixed, plus resolution of a stray `deno.lock`.
- **Wiki pages updated:**
  [`engineering/realtime-sync-and-offline.md`](engineering/realtime-sync-and-offline.md) —
  "Done and verified" gained a bullet documenting the existence-oracle fix and rewrote the
  Sync Issues resolution bullet; the former "A concurrency nuance worth knowing before
  touching Apply my change" section (which had flagged the review-semantics gap as an open
  question) is replaced with "Apply my change's two concurrency windows," documenting the fix
  now that it exists instead of the gap that used to exist there.
- **Canonical docs updated:** `docs/DECISIONS.md` (new "Final security/concurrency pass"
  subsection under Phase 9 — added below the prior "Sync Issues resolution UX" entry, which
  was not edited, per this project's "add to a record, don't overwrite it" convention),
  `docs/SECURITY_AND_PRIVACY.md` (new bullet for the existence-oracle fix, updated bullet for
  the merged `OfflineSafeErrorCode` count), `docs/ARCHITECTURE.md` (Apply-my-change paragraph
  rewritten from "flagged for confirmation" to the actual fixed two-window behavior),
  `docs/TEST_STRATEGY.md` (pgTAP count 528→530, `160_...` file's own count 20→22, e2e:offline
  description corrected to describe the real fixed behavior instead of the pre-fix one).
- **Decisions/contradictions recorded:** none new — this session *resolved* the one open
  question the prior session's own entries had explicitly flagged (Apply's two brief
  instructions being in tension), rather than discovering a new one. The resolution: `reviewedVersion`
  decouples the review-time fetch from the apply-time fetch, so both of the brief's
  instructions are now literally true at once.
- **Two real defects found and fixed, both originating in the immediately prior session's own
  work** (not part of this session's own new code until the fix): (1) the P0002/42501 split
  (commit `47df0e7`) was a cross-user task-existence oracle — any authenticated caller could
  learn whether a task UUID exists anywhere in the system, for any user; removed via a new
  additive migration, proven fixed by literally capturing and comparing the exact error output
  for a random UUID vs. another profile's real UUID. (2) `applyMyChange` re-fetched the server
  row and used that same fetch as both the staleness check and the write precondition, so a
  write between a real user review and a real Apply press was silently absorbed rather than
  re-surfaced — fixed by decoupling review-time and apply-time fetches via
  `OfflineOperation.reviewedVersion`.
- **Verified:** `npm run verify` — 60 suites / 550 tests, lint/typecheck/wiki:lint all clean.
  `supabase db reset && supabase test db` — 16 files / 530 pgTAP assertions (`160_sync_issues_
  resolution_test.sql` rewritten, 20→22 assertions, now proving indistinguishability directly
  via a `pg_temp` capture helper rather than only checking both cases raise 42501).
  `deno test` for `dispatch-notifications` — 11/11, run from the documented `supabase/
  functions` directory (confirmed this does not regenerate the stray root `deno.lock`).
  `e2e:backend` 32/32, `e2e:notifications` 24/24, `e2e:calendar` 28/28, `e2e:recurrence` 23/23
  all re-confirmed. `e2e:offline` (extended with the real "stale review" concurrency window)
  run twice consecutively without a DB reset, both green. `e2e:realtime` run twice, both green
  (28/28). `expo config --type public`, both `expo export` platforms, `git diff --check` all
  clean. `expo-doctor` unchanged at 20/21 (same pre-existing, unrelated patch-version drift).
  Stray root-level `deno.lock` deleted; `/deno.lock` added to `.gitignore` (root-anchored only
  — does not affect the real, already-tracked `supabase/functions/deno.lock`).
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).

---

## 2026-09-09T00:00:00Z — Phase 10 (Stage A): release-safety RPCs, security audit, release docs

- **Operation type:** feature build (family ownership/deletion RPCs + client wiring) + security
  audit + release-documentation build, on new branch `release/mvp-beta` (from `develop`).
- **Source material:** [`knowledge/raw/sessions/
  2026-09-09-phase10-release-stabilization.md`](../raw/sessions/2026-09-09-phase10-release-stabilization.md).
- **Wiki pages updated:** `domain/family-spaces.md` (new "Ownership transfer, family deletion,
  and account deletion" section, permissions table extended, the stale "no RPC yet" line
  removed), `engineering/security-model.md` (two new real-gap bullets, a new "Family lifecycle
  mutations" section, Mechanism 3's status corrected — see below), `engineering/data-model.md`
  (Phase 10 schema additions, the ownership-transfer "Unresolved" bullet resolved),
  `engineering/testing-strategy.md` (current totals note, Phase 10 additions, two new
  conventions), `product/roadmap.md` (ownership-transfer line resolved; see below),
  `engineering/realtime-sync-and-offline.md` (Phase 10 addendum for `delete_family`'s
  Realtime broadcast), `index.md` (Realtime page's status blurb corrected from "in progress" to
  "complete," matching that page's own already-current content).
- **Two pre-existing staleness gaps found and corrected, not just Phase 10 content added**:
  `engineering/security-model.md` and `product/roadmap.md` both still described Phase 9's
  Realtime sync and offline mutation queue as "not implemented" — true when those pages were
  last written (Phase 2–8) but false since Phase 9 actually shipped both; apparently never
  updated during Phase 9's own session despite that session's own dedicated
  `realtime-sync-and-offline.md` page being kept current throughout. Corrected in place with an
  explicit note explaining the correction (not a silent rewrite — per this file's own "add to a
  record, don't overwrite it" convention, applied here to a stale claim rather than a
  contradiction). `engineering/testing-strategy.md` has the same kind of gap in its own
  per-phase narrative (stops at Phase 8) — flagged with a similar note rather than fully
  backfilled, since a full Phase 9 backfill is beyond this session's own scope; pointed at
  `docs/TEST_STRATEGY.md` as the accurate source meanwhile.
- **Canonical docs updated:** `docs/SECURITY_AND_PRIVACY.md` (new "Mechanism 6"),
  `docs/ARCHITECTURE.md` (new Phase 10 section), `docs/DECISIONS.md` (full new "Phase 10"
  section), `docs/TEST_STRATEGY.md` (counts + 2 new convention bullets), `docs/MVP_SCOPE.md`
  and `docs/ROADMAP.md` (updated by the prior segment of this same session, before this wiki
  pass), `README.md` (new Phase 10 bullet). Four new docs:
  `docs/RELEASE_CHECKLIST.md`, `docs/BETA_TESTING.md`, `docs/PRIVACY_POLICY_DRAFT.md` (draft,
  unpublished), `docs/INCIDENT_AND_ROLLBACK.md`.
- **Decisions/contradictions recorded:** none new beyond the two staleness corrections above
  (which are corrections to out-of-date claims, not live contradictions between two current
  sources).
- **Two real defects found and fixed this phase** (both in new Phase 10 code, caught by
  `supabase test db`/the Phase 6.1 anon-EXECUTE guard, not by review): (1) `is_family_member`/
  `is_family_owner`/`current_family_ids` redefined against their *original* Phase 2 source
  instead of the latest (Phase 5-amended) one, silently dropping the `removed_at is null`
  filter and regressing 5 existing pgTAP assertions. (2) A new internal helper
  (`_remove_or_leave_family_member`) documented an intended `REVOKE` only in a comment, never
  as an actual statement — left reachable by `anon`/`authenticated` via Supabase's own
  default-privilege bootstrap until the Phase 6.1 regression guard caught it.
- **One test-coverage gap found and closed while auditing this session's own compliance with
  the brief's "add tests for every Phase 10 change" instruction**: the member-detail screen's
  new "Make family owner" button (and the screen itself) had zero test coverage, and the three
  new `familyService.ts` RPC wrappers plus the new `profileService.ts` had no direct unit
  test. Fixed: new `FamilyMemberDetailScreen.test.tsx` (6 tests) and `profileService.test.ts`
  (5 tests), plus 3 new tests in the existing `familyService.test.ts`.
- **A test-hygiene bug found while writing that new component test**: every `fireEvent.press`
  call in the first draft was unawaited, which didn't fail the offending test itself but
  corrupted a *later* test's render (an empty tree, preceded by an "overlapping act() calls"
  warning) — the same class of bug `engineering/testing-strategy.md` already recorded for a
  bare `act()` call (Phase 9), now confirmed to apply to `fireEvent.press` too. Fixed by
  awaiting every call.
- **Verified:** `npm run verify` — 65 suites / 576 tests (up from 63/562), lint/typecheck/
  wiki:lint all clean. `supabase db reset && supabase test db` — 18 files / 578 pgTAP
  assertions (up from 16/530; new `170_release_safety_test.sql` 40 assertions,
  `180_task_category_guard_test.sql` 8 assertions). `deno test` — 11/11. `e2e:backend` 32/32,
  `e2e:notifications` 24/24, `e2e:calendar` 28/28, `e2e:recurrence` 23/23 all re-confirmed.
  `e2e:offline` (5/5) and `e2e:realtime` (28/28) each run twice consecutively with no reset in
  between, both green both times. `expo config --type public`, both `expo export` platforms,
  `git diff --check` all clean. `expo-doctor` unchanged at 20/21 (pre-existing, unrelated
  patch-version drift). No hosted project, EAS project, or physical device was touched — Stage
  B remains entirely pending, honestly reported as such in every doc updated this pass.
- **Responsible agent:** Claude (Sonnet 5, via Claude Code).
