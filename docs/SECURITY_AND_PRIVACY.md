# Security & Privacy Design

Status: **proposed, not yet implemented.** No migrations exist yet — this document is written
first, on purpose, per the project brief: "Document the proposed security approach before
implementing database migrations." When migrations are written, they must implement this
document; if an implementer needs to deviate, this document should be updated in the same
change, not silently bypassed.

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

Family members never query `events`/`tasks` directly for other members' data. They query a
view (or `SECURITY DEFINER` RPC — a view is preferred here because it stays composable with
PostgREST's existing filtering/pagination instead of requiring a bespoke function signature):

```sql
create view family_schedule as
select
  e.id,
  e.family_id,
  e.owner_profile_id,
  e.starts_at,
  e.ends_at,
  e.visibility,
  case when e.visibility = 'family' then e.title       else null end as title,
  case when e.visibility = 'family' then e.description else null end as description,
  case when e.visibility = 'family' then e.location    else null end as location
from events e
where e.family_id in (select family_id from family_members where profile_id = auth.uid());
```

The sanitizing `CASE` is the whole mechanism: a private row still appears (so "Busy" renders
at the right time), but its `title`/`description`/`location` are `NULL` **in the query result
itself** — not hidden by the client. Querying this view with `select *` from a REST client,
a debugger, or a bug in the mobile app can never surface more than the allowed fields, because
the disallowed fields are never computed into the row. The client only ever consumes this
view for anyone else's data; it queries the base `tasks`/`events` tables only for `owner_profile_id
= auth.uid()`.

The same pattern produces `family_task_board` for tasks. Both views carry `RLS` too (`family_id`
membership check), so the view's own row-visibility and its column sanitization are two
independent, defense-in-depth layers.

**Single source of truth for the sanitization rule**: the `CASE WHEN visibility = 'family'`
logic should exist in exactly one SQL function (e.g. `sanitize_event(events)`), used by both
the view and the realtime trigger in Mechanism 3, so "what counts as sanitized" is never
defined twice and cannot drift.

## Mechanism 3 — Realtime never re-broadcasts the raw row

Supabase Realtime's `postgres_changes` on the base `events`/`tasks` tables is **not used for
cross-member updates**, even though modern Supabase Realtime is RLS-aware, because:

1. it broadcasts the full `NEW`/`OLD` row payload to the change-detection layer before RLS
   narrows _visibility_ of the row — RLS controls whether a subscriber sees the change event
   at all, not whether the payload is column-redacted; a private row's realtime payload could
   still contain the title even if only the owner's connection receives it, which is fine
   for the owner but is exactly the kind of "trust the transport, not the data" pattern this
   document is trying to avoid;
2. it is easy to misconfigure (a service-role key or a permissive policy added later for an
   unrelated feature silently widens who receives these events).

Instead: **family-visible schedule changes broadcast through the sanitized view's shape**,
using Supabase's Broadcast-from-Database pattern — a trigger on `events`/`tasks` calls the
same `sanitize_event()` function from Mechanism 2 and broadcasts _that_ payload to a
per-family Realtime channel (`family:{family_id}:schedule`). Personal, non-shared items
(`family_id IS NULL`) never trigger a broadcast at all. This keeps exactly one function
responsible for "what is another family member allowed to see," reused by REST reads and
realtime pushes alike.

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

## What this leaves for the migration author to still get right

This document fixes the _shape_ of the solution; a real implementation still needs:

- Actual RLS policies for every table in DATA_MODEL.md's ownership table, not just
  `events`/`tasks` (shown above as the representative, highest-risk case).
- Tests that assert a non-owner **cannot** read a private row's sensitive columns via the
  base table, via the view, and via a simulated realtime subscription — see
  [TEST_STRATEGY.md](TEST_STRATEGY.md), "RLS and privacy tests." These tests should run
  against a real (local/CI) Postgres instance with RLS enabled, not be mocked.
- A migration-time check that `anon`/`authenticated` roles have **no** direct grant on
  `events`/`tasks` columns beyond what RLS+views allow, and that `service_role` usage is
  confined to trusted server-side code (Edge Functions), never shipped in the mobile bundle.
- Confirming, before enabling Realtime on any table, exactly which broadcast mechanism is
  active (see Mechanism 3) — Supabase's Realtime configuration is per-table and it is
  possible to enable naive `postgres_changes` broadcast on `events` by accident while adding
  an unrelated feature. This should be a checklist item in the PR that first enables Realtime.

## Non-goals for MVP

- End-to-end encryption of event/task content. Supabase (Postgres + RLS) is a trusted-server
  model, consistent with the rest of the product; this document's guarantees are about
  _which authenticated family members_ see _which fields_, not about hiding data from
  FamilyFlow's own backend.
- Anonymizing _who_ owns a busy block. The product brief explicitly allows the owner's
  identity in a Busy block ("owner, start, end, Busy") — only content is redacted.
