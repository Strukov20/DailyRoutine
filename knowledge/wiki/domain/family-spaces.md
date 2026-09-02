---
title: Family Spaces
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [domain, family]
---

## Confirmed

A Family Space has an Owner, adult members, and child profiles. A child does not need an
account; a parent manages the child's calendar. A user may belong to multiple families over
time; the MVP UI focuses on one _active_ family at a time
(`useUIStore.activeFamilyId` — client-only "which one am I looking at," not membership data).

## Decision: unified `family_members` table, not a separate `children` table

Adults and children share one table (`member_type: 'adult' | 'child'`), because most
family-schedule queries (events, responsibilities, assignment) treat "a person in this
family" uniformly regardless of type — splitting into two tables would duplicate every such
join or force a union view anyway. `family_members.profile_id` is nullable and is the
deliberate seam for "link a child profile to a real account later": linking becomes a single
`UPDATE`, not a migration. Full reasoning:
[`docs/DECISIONS.md`, "Data model & privacy"](../../../docs/DECISIONS.md).

## Schema: implemented

- `families` — id, name, `owner_id`. Ownership consistency (exactly one `role='owner'` row,
  matching `owner_id`) is enforced by a partial unique index + validating trigger — see
  [data-model](../engineering/data-model.md).
- `family_members` — per-family row per person; `role: owner | adult | child`; `member_type`
  distinguishes the two shapes; a `CHECK` constraint enforces `member_type = 'adult' ⇒
role in (owner, adult) AND profile_id NOT NULL`.
- `family_invitations` — `invited_email` (invitee may not have an account yet), `status:
pending | accepted | declined | expired | revoked`, `expires_at` required (not open-ended).

Full column list and migration file: [`docs/DATA_MODEL.md`, "family_members" /
"family_invitations"](../../../docs/DATA_MODEL.md#family_members).

## Current implementation

**Schema, RLS, and grants exist** (`supabase/migrations/20260902120200_families_and_members.sql`).
**UI and family-creation flow still don't** — `app/(app)/family.tsx` is an empty-state
placeholder with a "Create a Family Space" button that logs and does nothing; family
creation/invitations UI is explicitly out of scope through Phase 2 (see
[roadmap](../product/roadmap.md)).

**Notable gap**: there is no INSERT grant on `families`/`family_members` for `authenticated`
at all yet — only `postgres` (migrations, test fixtures) can create a family right now. A
`create_family_with_owner` `SECURITY DEFINER` RPC is the anticipated way to solve this under
RLS (atomically create the family row + its owner's membership row, avoiding a
chicken-and-egg ordering problem) — sketched in
[DECISIONS.md](../../../docs/DECISIONS.md) but not built. This is a hard prerequisite for
Phase 3 family UI.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — child events reference
  `family_members`, not a separate children table
- [Privacy and availability](privacy-and-availability.md) — what other family members can
  and can't see
- [Authentication](../engineering/authentication.md) — what exists once a user signs up
  (a profile) vs. what doesn't yet (a family)
