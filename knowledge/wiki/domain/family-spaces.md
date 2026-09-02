---
title: Family Spaces
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
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

## Proposal (not yet implemented)

- `families` — id, name, `owner_id` (ownership transfer = a role update later, never an
  implicit cascade-delete of the row).
- `family_members` — per-family row per person; `role: owner | adult | child`;
  `member_type` distinguishes the two shapes; a `CHECK` constraint (migration-time, not yet
  written) enforces `member_type = 'adult' ⇒ profile_id NOT NULL`.
- `family_invitations` — `invited_email` (invitee may not have an account yet), `status:
pending | accepted | declined | expired | revoked`, `expires_at` required (not open-ended).

Full column list: [`docs/DATA_MODEL.md`, "family_members" /
"family_invitations"](../../../docs/DATA_MODEL.md#family_members).

## Current implementation

`app/(app)/family.tsx` is an empty-state placeholder with a "Create a Family Space" button
that logs and does nothing — family creation and invitations are explicitly out of scope for
the foundation phase (see the brief's "Stop point").

## See also

- [Events and responsibilities](events-and-responsibilities.md) — child events reference
  `family_members`, not a separate children table
- [Privacy and availability](privacy-and-availability.md) — what other family members can
  and can't see
