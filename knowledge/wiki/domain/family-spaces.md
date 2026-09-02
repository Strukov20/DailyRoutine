---
title: Family Spaces
status: current
updated: 2026-09-03
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
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
  the `role = 'owner'` row (the DB-level owner-orphan guard). Ownership transfer and "the
  owner leaves" have no RPC yet — deferred, see [roadmap](../product/roadmap.md).

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

## See also

- [Events and responsibilities](events-and-responsibilities.md) — child events reference
  `family_members`, not a separate children table
- [Privacy and availability](privacy-and-availability.md) — what other family members can
  and can't see
- [Security model](../engineering/security-model.md) — the anon-EXECUTE-grant finding, in the
  same terms as the RLS/sanitized-view mechanisms this page's schema relies on
- [Authentication](../engineering/authentication.md) — what exists once a user signs up
  (a profile) and how the invite deep link interacts with sign-in
