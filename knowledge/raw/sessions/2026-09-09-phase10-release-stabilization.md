# 2026-09-09 — Phase 10: MVP Stabilization, Deployment, and Beta Release (Stage A)

New branch `release/mvp-beta`, created from `develop` after confirming Phase 9 (merged via
PR #10, `77d224a`) was present and the tree was clean. User sent a full, extremely detailed
23-section brief for "Phase 10 — MVP Stabilization, Deployment, and Beta Release," explicitly
structured around a two-stage model: Stage A (local release readiness, proceed freely) and
Stage B (any external/hosted/paid/credential/device action — must pause and ask, never
inferred from the general task grant). This session completed Stage A. Stage B was not
attempted — no hosted project, EAS project, or physical device exists in this environment, and
none of the "ask the user to confirm" questions (Section 7: app identifiers, Expo org, etc.)
were surfaced to the user this session — that remains open for a follow-up session or a direct
user response.

## What this session did

1. **The four family-lifecycle RPCs** (`supabase/migrations/
   20260912120000_release_safety_ownership_and_deletion.sql`) — `transfer_family_ownership`,
   `delete_family`, `leave_family`, `request_account_deletion`. Full design in
   `docs/DECISIONS.md`, "Phase 10," and `knowledge/wiki/domain/family-spaces.md`. Two real bugs
   caught by `supabase test db`, not review: (a) redefining `is_family_member`/
   `is_family_owner`/`current_family_ids` against the *original* Phase 2 source instead of the
   latest (Phase 5-amended) one, silently dropping the `removed_at is null` filter and
   regressing 5 existing assertions; (b) a new internal helper
   (`_remove_or_leave_family_member`) that documented an intended `REVOKE` in a comment but
   never wrote the actual statement, leaving it reachable by `anon`/`authenticated` by
   Supabase's own default-privilege bootstrap — caught by the Phase 6.1 anon-EXECUTE regression
   guard doing exactly its job.
2. **Client wiring**: `familyService.ts` gained the three family-scoped RPC wrappers; a new
   `src/lib/profile/profileService.ts` (deliberately separate from `authService.ts`) added
   `requestAccountDeletion`. New hooks (`useTransferFamilyOwnership`/`useDeleteFamily`/
   `useLeaveFamily`, and a new `src/domain/profile/hooks.ts`). UI: a "Make family owner" button
   on the member-detail screen, a family-settings "danger zone" (Leave/Delete depending on
   role) on the family screen, and a typed-confirmation ("DELETE") account-deletion dialog on
   the profile screen. `useUIStore` gained `resetForSignOut()` (clears
   `activeFamilyId`/`pendingInviteToken`/`pendingNotificationRoute` only), wired into
   `AuthProvider`'s existing `SIGNED_OUT` handler alongside the pre-existing cache clearing.
3. **A real, if narrow, test-coverage gap found and closed while writing this session's own
   docs.** Auditing what Section 15 ("add tests for every Phase 10 change") actually required
   turned up two gaps neither caught by the prior session's own testing pass: (a) the member-
   detail screen's "Make family owner" button — and the screen itself — had zero test
   coverage of any kind; (b) `familyService.ts`'s three new RPC wrappers and the new
   `profileService.ts` had no direct unit test proving they call the right RPC with the right
   arguments (the existing convention for this class of thin wrapper is light — a
   resolves/rejects check, not necessarily an RPC-args assertion — but even that light bar
   wasn't cleared). Fixed: new `src/components/family/FamilyMemberDetailScreen.test.tsx` (6
   tests), new `src/lib/profile/profileService.test.ts` (5 tests), 3 new tests added to the
   existing `familyService.test.ts`. Suite count: 65 Jest suites / 576 tests (was 63/562 at the
   start of this session), 18 pgTAP files / 578 assertions (was 16/530).
4. **A genuinely confusing test-hygiene bug, found while writing the new component test.**
   `FamilyMemberDetailScreen.test.tsx`'s first draft had every `fireEvent.press` call
   unawaited. The offending tests themselves passed; the symptom appeared two tests later as
   an "overlapping act() calls" warning followed by `screen.getByText` failing to find
   anything — a completely empty render tree — making the actual cause (a test two positions
   earlier) non-obvious from the failure site alone. This is the same underlying class of bug
   `docs/TEST_STRATEGY.md` already documented for a bare, unawaited `act()` call (Phase 9), now
   confirmed to apply identically to `fireEvent.press` specifically. Fixed by awaiting every
   call, per the codebase's own existing (but, in this one new file, initially violated)
   convention.
5. **Full local verification, run for real, not assumed from a prior session's numbers.**
   `npm run verify` (lint/typecheck/65 suites/576 tests/wiki:lint, all green);
   `supabase db reset` (24 migrations, clean) + `supabase test db` (18 files/578 assertions);
   `deno test` (11/11); `e2e:backend`/`e2e:notifications`/`e2e:calendar`/`e2e:recurrence`
   (32/24/28/23, all green); `e2e:offline` and `e2e:realtime` each run **twice** consecutively
   with no reset in between, both green both times; `expo config --type public`, `expo export
   --platform ios`, `expo export --platform android`, `git diff --check` all clean;
   `expo-doctor` unchanged at 20/21 (pre-existing, unrelated `expo`/`expo-router` patch drift).
6. **Documentation**: new "Mechanism 6" in `docs/SECURITY_AND_PRIVACY.md` (account-deletion/
   family-lifecycle data-lifecycle-per-table); a new "Family ownership, family deletion, and
   account deletion (Phase 10)" section in `docs/ARCHITECTURE.md`; a full new "Phase 10"
   section in `docs/DECISIONS.md` (write-ordering rationale, the anonymize-vs-hard-delete
   decision, both real bugs above, the `Alert.alert` test pattern and its
   `fireEvent.press`-await corollary, `eas.json`/environment design); updated counts and two
   new "Conventions established" bullets in `docs/TEST_STRATEGY.md`; a Phase 10 status bullet
   in `README.md`; four new docs — `docs/RELEASE_CHECKLIST.md` (the master Stage A/Stage B
   status table and the Section 7 questions, not yet asked of the user),
   `docs/BETA_TESTING.md`, `docs/PRIVACY_POLICY_DRAFT.md` (explicitly unpublished), and
   `docs/INCIDENT_AND_ROLLBACK.md`.
7. **LLM Wiki pass — also surfaced two pre-existing staleness gaps, corrected in place, not
   silently left.** While updating `knowledge/wiki/domain/family-spaces.md` for the new RPCs,
   found that `knowledge/wiki/engineering/security-model.md` and
   `knowledge/wiki/product/roadmap.md` still described Realtime (Mechanism 3) and the offline
   mutation queue/persisted cache as "not implemented" / "not full offline-first sync" — both
   true when originally written (Phase 2–8) but false since Phase 9 actually built them; those
   pages were apparently never updated during Phase 9's own session. Corrected both in place
   (with an explicit note explaining the correction, not a silent overwrite) rather than
   layering a Phase 10 claim on top of a known-stale Phase 9 claim.
   `knowledge/wiki/engineering/testing-strategy.md` has the same kind of gap (its per-phase
   narrative also stops at Phase 8) — flagged with the same kind of correction note rather than
   fully backfilled, given this session's scope; `docs/TEST_STRATEGY.md` is called out as the
   accurate source in the meantime.

## Deliberately not done this session (Stage B, or otherwise genuinely out of scope)

- No hosted Supabase project, no EAS project, no signing credentials — none created or linked.
- No physical device testing (iOS or Android) — none available in this environment.
- The Section 7 "ask the user to confirm" identifier questions (display name, Expo org, slug,
  bundle id, etc.) — drafted into `docs/RELEASE_CHECKLIST.md` but not yet actually asked of the
  user in this session.
- A UX/accessibility audit pass across the ~15 named MVP screens (Section 13) and a
  performance/load test with synthetic 500-task data (Section 14) — not attempted this
  session; would need to be picked up in a follow-up before Phase 10 could be called more than
  "Stage A: release-safety functionality + security audit + docs," which is what this session
  actually delivered.
- A full historical Phase 9 backfill of `engineering/testing-strategy.md`'s per-phase
  narrative — flagged as a gap (see above), not fixed, since it's Phase 9's own debt, not
  Phase 10's, and a full backfill is a larger task than this session's own scope.

## Verification

`npm run verify` — 65 suites / 576 tests, wiki:lint 19 articles, all green. `supabase test db`
— 18 files / 578 assertions. `deno test` — 11/11. All four backend e2e suites green
(32/24/28/23). `e2e:offline` (5/5) and `e2e:realtime` (28/28) each run twice consecutively, zero
residue both times. `expo config`, both `expo export` platforms, `git diff --check` clean.
`expo-doctor` 20/21 (pre-existing).
