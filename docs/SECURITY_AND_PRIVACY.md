# Security & Privacy Design

Status: **implemented** in `supabase/migrations/` (Phase 2) and proven by the pgTAP suite in
`supabase/tests/`, most directly `060_privacy_regression_test.sql`. This document was
originally written _before_ any migration existed, per the project brief's instruction to
design the security approach first — implementing it surfaced one real gap in the original
Mechanism 2 design, corrected below and recorded in
[DECISIONS.md](DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design).

## The rule

For a **private** event or task (`visibility = 'private'`, see [DATA_MODEL.md](DATA_MODEL.md)),
a family member who is not the owner may learn only:

- who owns it (which family member);
- its start time;
- its end time;
- the literal fact "Busy."

They must never receive title, description, category, notes, attachments, or any other
field — **through any channel**: a direct PostgREST/API query, a Supabase Realtime event, a
push notification, a server or client log line, or a client-side filter. "Client-side
filter" is called out explicitly because it is the failure mode that is easiest to ship by
accident: fetching the full private row and simply not _rendering_ the title in the UI is
not privacy — the data already left the database and sits in the device's memory, a network
log, or a crash report. **The database must never return the sensitive columns to a
non-owner in the first place.**

## Mechanism 1 — RLS blocks the base tables entirely for non-owners

`events` and `tasks` get a `SELECT` policy of roughly:

```sql
create policy "owner or family-visible" on events
  for select
  using (
    owner_profile_id = auth.uid()
    or (
      visibility = 'family'
      and family_id in (select family_id from family_members where profile_id = auth.uid())
    )
  );
```

The critical property: **there is no branch of this policy that lets a non-owner select a
row where `visibility = 'private'`.** Not a restricted set of columns — the row itself is
unreachable via the base table. Postgres RLS is row-level, not column-level, so column-level
redaction has to happen elsewhere (Mechanism 2). This policy only has to get one thing right:
never return a private row's `owner_profile_id ≠ auth.uid()` case, full stop.

The same shape applies to `tasks`, `reminders` (owner-only, no family branch at all —
reminders are never shared, see DATA_MODEL.md), and `notification_tokens` (owner-only).

**Constraint this implies**: a task cannot be both `visibility = 'private'` and have
`assignee_member_id` set to someone other than the owner — you cannot assign work to someone
the RLS policy prevents from reading the task. This is enforced with a `CHECK` constraint (or
a trigger, if the check needs a subquery) in the migration, not left as an application-layer
assumption.

## Mechanism 2 — a sanitized view is the _only_ way to read someone else's item

Family members never query `events`/`tasks` directly for other members' data. They query
`family_schedule` / `family_task_board`
(`supabase/migrations/20260902120800_sanitized_availability.sql`):

```sql
create view public.family_schedule as
select
  e.id, e.family_id, e.owner_profile_id, e.starts_at, e.ends_at, e.visibility,
  case when e.visibility = 'family' then e.title       else null end as title,
  case when e.visibility = 'family' then e.description else null end as description,
  case when e.visibility = 'family' then e.location    else null end as location
from public.events e
where e.family_id is not null
  and e.family_id in (select fm.family_id from public.family_members fm where fm.profile_id = auth.uid());
```

**This view is deliberately _not_ `security_invoker`.** That's a correction to this
document's original design, made while implementing it — see
[DECISIONS.md](DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design)
for the full reasoning. In short: `events`' own base-table RLS (Mechanism 1) already hides a
private row from non-owners entirely. A `security_invoker` view runs with the querying user's
own RLS, so it would inherit that same block and could never show a Busy block for a private
item — the opposite of what this view exists to do. As an ordinary (owner-executed) view, it
bypasses the querying user's RLS on `events` by construction, which means **the view's own
`WHERE` clause is the entire authorization check** — there is no second, independent RLS
layer behind it for this view. That's why the `WHERE` clause and the sanitizing `CASE`
expressions are reviewed together, in this one file, rather than assumed to be backed by
table RLS as well.

The sanitizing `CASE` is the column-level mechanism: a private row still appears as a row (so
"Busy" renders at the right time), but its `title`/`description`/`location` are `NULL` **in
the query result itself** — not hidden by the client. Querying this view with `select *` from
a REST client, a debugger, or a bug in the mobile app can never surface more than the allowed
fields, because the disallowed fields are never computed into the row.

The client only ever queries `events`/`tasks` (the base tables) for its own data
(`owner_profile_id = auth.uid()`); it queries `family_schedule`/`family_task_board` for
anyone else's. `family_task_board` mirrors this exact pattern for tasks, including
sanitizing `assignee_member_id` (which would otherwise reveal who a private task is
delegated to).

Proven end to end — a private event/task planted with a unique secret marker in every
sensitive field, asserted absent from both views for a family member, and both views empty
for an outsider/anonymous — by `supabase/tests/060_privacy_regression_test.sql`.

## Mechanism 3 — Realtime never re-broadcasts the raw row

**Not implemented yet** — Realtime sync is explicitly out of scope for Phase 2 (see
docs/ROADMAP.md); `supabase/config.toml` has `[realtime] enabled = true` (the default) but no
table currently has Realtime turned on, and no broadcast trigger exists. This section
documents the design that must be followed when Realtime is added, not current behavior.

Supabase Realtime's `postgres_changes` on the base `events`/`tasks` tables must **not be used
for cross-member updates**, even though modern Supabase Realtime is RLS-aware, because:

1. it broadcasts the full `NEW`/`OLD` row payload to the change-detection layer before RLS
   narrows _visibility_ of the row — RLS controls whether a subscriber sees the change event
   at all, not whether the payload is column-redacted; a private row's realtime payload could
   still contain the title even if only the owner's connection receives it, which is fine
   for the owner but is exactly the kind of "trust the transport, not the data" pattern this
   document is trying to avoid;
2. it is easy to misconfigure (a service-role key or a permissive policy added later for an
   unrelated feature silently widens who receives these events).

Instead: **family-visible schedule changes must broadcast through the same sanitization
shape as `family_schedule`**, using Supabase's Broadcast-from-Database pattern — a trigger on
`events`/`tasks` reusing the exact `CASE`-based projection from the view (extracted into a
shared SQL function at that point, so both the view and the broadcast trigger call the same
code rather than two copies of the sanitization logic) and broadcasting _that_ payload to a
per-family Realtime channel (`family:{family_id}:schedule`). Personal, non-shared items
(`family_id IS NULL`) must never trigger a broadcast at all.

## Mechanism 4 — notifications

Reminders (`reminders` table) are owner-only by construction (`profile_id`) — a reminder for
a private task never has another recipient, so there is no cross-user leak path to design
against.

Assignment notifications ("X assigned you a task") are sent only for tasks where
`visibility = 'family'` (see the constraint in Mechanism 1 — a private task can't have a
non-owner assignee), so the assignee already has read access to the full task by the time the
notification arrives. The notification payload is still built server-side from the same
sanitized/authorized query path, not by trusting whatever the client sends — a compromised or
buggy client should not be able to get the notification service to include arbitrary text in
a push payload to another user.

## Mechanism 5 — logs

Application logs go through `src/lib/logger/logger.ts`, whose contract (documented in that
file and enforced by convention/review, not by a runtime filter) is: log identifiers and
metadata, never free-text content fields (`title`, `description`, `notes`). The
`ErrorBoundary` (`src/components/ErrorBoundary.tsx`) follows the same rule — it logs the
error message and component stack, never component props/state, which is exactly where a
private task's title would otherwise end up. Supabase/Postgres-side logs (Edge Functions,
database logs) must follow the same rule once they exist: log row ids, not row content.

## Implementation status

- ✅ RLS policies for every table in DATA_MODEL.md's ownership table exist in
  `supabase/migrations/` — not just `events`/`tasks`.
- ✅ Tests assert a non-owner **cannot** read a private row's sensitive columns via the base
  table or via the sanitized views — `supabase/tests/060_privacy_regression_test.sql`, run
  against a real local Postgres instance with RLS enabled (`supabase test db`), not mocked.
  See [TEST_STRATEGY.md](TEST_STRATEGY.md), "RLS and privacy tests."
- ✅ Every table has `REVOKE ALL ... FROM anon, authenticated` followed by narrow explicit
  `GRANT`s — no table relies on RLS alone while leaving broad default privileges in place.
  `service_role` is never referenced by the mobile app (`src/lib/supabase/client.ts` only
  ever uses the anon key — see `docs/DECISIONS.md`, "Never place a service_role key...").
- ⬜ **Not yet implemented**: Realtime (Mechanism 3) — see that section above. Confirm the
  broadcast-trigger design is actually in place, as a PR checklist item, before enabling
  Realtime on `events`/`tasks` for the first time.
- ⬜ **Not yet implemented**: assignment/response notifications (Mechanism 4) — no
  notification-sending code exists yet; the constraint that makes it safe
  (`tasks_assert_integrity`'s private+non-owner-assignee rejection) is already in place and
  tested, ready for when notification sending is built.
- ⚠️ **Function EXECUTE grants are a separate mechanism from table grants — audited in Phase
  3, fixed where it mattered.** The "REVOKE ALL ... FROM anon, authenticated" bullet above is
  about _tables_ and remains accurate. _Functions_ are different: Supabase's own role bootstrap
  grants `anon`/`authenticated` EXECUTE on every new function directly (not via the `PUBLIC`
  pseudo-role), so `revoke all on function ... from public` alone never actually revokes it —
  confirmed by inspecting `pg_proc.proacl` on a real local instance. Every
  `SECURITY DEFINER` function in this codebase (Phase 2's `is_family_member`/`is_family_owner`/
  `current_family_ids` and Phase 3's family/invitation/child RPCs) now explicitly revokes from
  `anon` too — see [DECISIONS.md](DECISIONS.md), "Phase 3," for the full writeup and which two
  functions this was a real (not just theoretical) gap for. **Before adding any new
  `SECURITY DEFINER` function**, confirm its ACL with a query like the one in that entry
  rather than trusting a `revoke ... from public` statement alone.

## Non-goals for MVP

- End-to-end encryption of event/task content. Supabase (Postgres + RLS) is a trusted-server
  model, consistent with the rest of the product; this document's guarantees are about
  _which authenticated family members_ see _which fields_, not about hiding data from
  FamilyFlow's own backend.
- Anonymizing _who_ owns a busy block. The product brief explicitly allows the owner's
  identity in a Busy block ("owner, start, end, Busy") — only content is redacted.
