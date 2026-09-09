---
title: Family Spaces
status: current
updated: 2026-09-09
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/RELEASE_CHECKLIST.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
  - ../../raw/sessions/2026-09-09-phase10-release-stabilization.md
tags: [domain, family]
---

## Confirmed

A Family Space has an Owner, adult members, and child profiles. A child does not need an
account; a parent manages the child's calendar. A user may belong to multiple families over
time; the UI focuses on one _active_ family at a time
(`useUIStore.activeFamilyId` — client-only "which one am I looking at," not membership data —
see [`useActiveFamily()`](../engineering/system-architecture.md)).

## Decision: unified `family_members` table, not a separate `children` table

Adults and children share one table (`member_type: 'adult' | 'child'`), because most
family-schedule queries (events, responsibilities, assignment) treat "a person in this
family" uniformly regardless of type — splitting into two tables would duplicate every such
join or force a union view anyway. `family_members.profile_id` is nullable and stays `NULL`
for every child this phase — children are never linked to a real account, so they cannot be
discovered or contacted independently of the family that created them. Full reasoning:
[`docs/DECISIONS.md`, "Data model & privacy"](../../../docs/DECISIONS.md).

## Schema: implemented

- `families` — id, name, `owner_id`. Ownership consistency (exactly one `role='owner'` row,
  matching `owner_id`) is enforced by a partial unique index + validating trigger — see
  [data-model](../engineering/data-model.md).
- `family_members` — per-family row per person; `role: owner | adult | child`; `member_type`
  distinguishes the two shapes; a `CHECK` constraint enforces `member_type = 'adult' ⇒
role in (owner, adult) AND profile_id NOT NULL`.
- `family_invitations` — `invited_email` (an owner-facing label only, not access control),
  `token_hash` (SHA-256 of a one-time token; the raw token is never stored), `status:
pending | accepted | declined | expired | revoked`, `expires_at` required (default 7 days).

Full column list and migration files:
[`docs/DATA_MODEL.md`, "family_members" / "family_invitations"](../../../docs/DATA_MODEL.md#family_members).

## Current implementation (Phase 3 — complete)

**Family creation, invitations, permissions, and child profiles are all implemented**,
entirely as `SECURITY DEFINER` RPCs — `families`/`family_members` still have no direct
`INSERT`/`UPDATE`/`DELETE` grant for `authenticated` at all (see "Notable gap," resolved,
below):

- `create_family_with_owner(name)` — the only way to create a family; atomically creates the
  family row and its owner's `family_members` row.
- `create_family_invitation(family_id, invited_email)` (owner-only) → returns a raw one-time
  token exactly once. `get_family_invitation_preview(token)` (any authenticated user) →
  sanitized preview (family name, inviter's display name, status, validity) — **never** a
  member list, an email address, or the token/hash. `accept_family_invitation(token)` /
  `decline_family_invitation(token)` — validated by token possession + pending + not-expired,
  never by matching the caller's email (there is no email provider — invitations are
  delivered as a `familyflow://invite/<token>` deep link via native Share or copy-link, see
  `app/family/invite.tsx` and `src/lib/family/inviteLink.ts`). `revoke_family_invitation(id)`
  (owner-only).
- `create_child_profile(family_id, display_name, date_of_birth?)` / `update_child_profile(...)`
  — any adult member (owner or adult role) may manage children; minimal fields only, no
  `profile_id` ever assigned.
- `remove_family_member(member_id)` — owner-only, and **refuses unconditionally** to remove
  the `role = 'owner'` row (the DB-level owner-orphan guard). **Phase 5: soft delete, not a
  hard `DELETE`** — sets `family_members.removed_at` instead. A hard delete would violate the
  (Phase 5) `task_assignments` audit trail's `NOT NULL` FKs the moment a removed member had
  ever taken/been assigned a task. `is_family_member`/`is_family_owner`/`current_family_ids`
  and the sanitized views all filter `removed_at is null`, so access disappears immediately
  even though the row persists — see [tasks-and-assignments](tasks-and-assignments.md),
  "member removal."

## Ownership transfer, family deletion, and account deletion — implemented (Phase 10)

The gap the paragraph above used to describe ("no RPC yet") is closed. Four
`SECURITY DEFINER` RPCs, all in
`supabase/migrations/20260912120000_release_safety_ownership_and_deletion.sql`:

- `transfer_family_ownership(family_id, new_owner_member_id)` — owner-only; the target must be
  an active adult member of the *same* family (never a child — a child profile can never
  become an owner). Writes `families.owner_id` first, then demotes the old owner to `adult`,
  then promotes the new owner — this exact order is not arbitrary, it is what the
  pre-existing `assert_family_owner_consistency` trigger (Phase 2) and the
  `family_members_one_owner_per_family` unique partial index jointly require; see
  [DECISIONS.md, "Phase 10"](../../../docs/DECISIONS.md) for the full derivation. Records an
  append-only row in `family_ownership_transfers` (members can `SELECT`, nothing else). A
  target member id that doesn't exist, belongs to another family, or was already removed all
  raise the identical `42501` — the same no-existence-oracle discipline
  [tasks-and-assignments](tasks-and-assignments.md) already documents for tasks, extended here
  to family membership.
- `delete_family(family_id)` — owner-only, soft delete (`families.deleted_at`).
  `is_family_member`/`is_family_owner`/`current_family_ids` exclude a deleted family, so every
  member (including the former owner) loses access in the same instant, through the same
  choke point every other family-scoped RLS policy already routes through — see
  [security-model](../engineering/security-model.md). Tasks/events/responsibilities/audit rows
  are never deleted, only made unreachable. `families` had no Realtime broadcast trigger of
  its own before this phase (unlike `family_members`) — `delete_family` calls the existing
  `emit_invalidation` helper explicitly so every affected device's UI still updates promptly.
- `leave_family(family_id)` — self-service for any non-owner adult; the owner is refused
  (`22023`) until they transfer or delete.
- `request_account_deletion()` — self-service, blocked (`22023`) while the caller owns any
  non-deleted family. **Anonymizes the `profiles` row in place; never hard-deletes
  `auth.users`** — a deliberate decision, not a shortcut: `auth.users` has no cascading delete
  path here, and resolving every non-cascading FK that references a profile
  (`tasks.owner_profile_id`, `events.owner_profile_id`, `families.owner_id`, and others) is
  explicitly out of this phase's scope. The caller's own private content is soft-deleted;
  family-shared content they created is left alone (the profile row stays valid, so other
  members keep whatever access they already had) — see
  [SECURITY_AND_PRIVACY.md, "Mechanism 6"](../../../docs/SECURITY_AND_PRIVACY.md) for the full
  per-table lifecycle.

Both `families` and `profiles`' `UPDATE` grants are column-scoped (excluding `deleted_at`, and
for `families`, `owner_id`) specifically so a raw client write can never bypass any of the
above — the RPCs are the only path to these columns, the same "choke point, not a convention"
pattern the read-side RLS helpers already establish.

**Status**: implemented and tested locally (18 pgTAP files / 578 assertions, including a
dedicated `170_release_safety_test.sql`, 40 assertions). **Not yet validated**: against a
hosted Supabase project, or via the in-app UI on a physical device — see
[RELEASE_CHECKLIST.md](../../../docs/RELEASE_CHECKLIST.md) for exactly what Stage B still
needs.

UI: `app/(app)/family.tsx` (roster + family switcher + pending-invitations list for owners),
`app/family/{create,invite,add-child}.tsx`, `app/family/member/[id].tsx`,
`app/invite/[token].tsx` (the deep-link landing screen — outside both `Stack.Protected`
groups in `app/_layout.tsx`, like `reset-password.tsx`, so it renders for a signed-out
visitor too; see `useUIStore.pendingInviteToken` for how that visitor gets routed back here
after signing in).

Layering: screens → `src/domain/family/hooks.ts` (TanStack Query) →
`src/lib/family/familyService.ts` (the only module calling `supabase.rpc`/`supabase.from` for
this feature) → the Supabase client. See
[system-architecture](../engineering/system-architecture.md), "Layering."

**Notable gap — resolved**: the INSERT-grant gap this page used to describe as "a hard
prerequisite for Phase 3" is closed by `create_family_with_owner`. What replaced it — and a
real security finding made while building it — is written up in
[DECISIONS.md, "Phase 3"](../../../docs/DECISIONS.md): Supabase's own role bootstrap grants
`anon` `EXECUTE` on every new function directly (not via `PUBLIC`), so
`revoke ... from public` alone never actually revoked it. Fixed for every family RPC and,
retroactively, for the three Phase 2 `is_family_member`/`is_family_owner`/`current_family_ids`
helpers too.

## Permissions model

| Action                                           | Owner                        | Adult | Child |
| ------------------------------------------------ | ---------------------------- | ----- | ----- |
| Create a family                                  | —                            | —     | —     | (anyone becomes Owner of a family they create) |
| Rename the family                                | ✅                           | ❌    | —     |
| Send / revoke an invitation                      | ✅                           | ❌    | —     |
| Accept / decline an invitation addressed to them | n/a (already a member)       | ✅    | —     |
| Add / edit a child profile                       | ✅                           | ✅    | —     |
| Remove any member (including a child)            | ✅                           | ❌    | —     |
| Remove the owner                                 | ❌ (unconditionally refused) | ❌    | —     |
| Transfer ownership to an active adult member      | ✅ (Phase 10)                | ❌    | —     |
| Delete the family                                | ✅ (Phase 10)                | ❌    | —     |
| Leave the family                                 | ❌ (must transfer/delete first) | ✅ (Phase 10) | — |
| Delete their own account                         | ❌ (must transfer/delete family first) | ✅ (Phase 10) | — |

## See also

- [Events and responsibilities](events-and-responsibilities.md) — child events reference
  `family_members`, not a separate children table
- [Privacy and availability](privacy-and-availability.md) — what other family members can
  and can't see
- [Security model](../engineering/security-model.md) — the anon-EXECUTE-grant finding, in the
  same terms as the RLS/sanitized-view mechanisms this page's schema relies on
- [Authentication](../engineering/authentication.md) — what exists once a user signs up
  (a profile) and how the invite deep link interacts with sign-in
- [Data model](../engineering/data-model.md) — `family_ownership_transfers`, `deleted_at` on
  `families`/`profiles`
