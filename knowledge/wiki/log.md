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
