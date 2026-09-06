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
