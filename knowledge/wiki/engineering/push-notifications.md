---
title: Push notifications
status: current
updated: 2026-09-06
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
tags: [engineering, notifications, edge-functions, phase6]
---

## Status: implemented (Phase 6), scoped to shared family task assignment events only

Push notifications for the four assignment lifecycle events (assigned/reassigned → requested,
accepted, declined, took → taken). Everything else — recurring tasks, reminders, digests,
quiet hours, AI-driven content, email/SMS, an in-app notification inbox, event/child-profile
notifications, ownership-transfer notifications, direct APNs/FCM — is deliberately out of
scope. See [roadmap](../product/roadmap.md).

**No real push has been sent or received.** Every layer of testing (pgTAP, the Deno Edge
Function suite, Jest, `scripts/e2e-notifications.sh`) uses a fake `PushTransport` — never a
real Expo network call. The Database Webhook/`pg_cron` invocation and any EAS/Apple/Firebase
configuration were deliberately not created this phase — see [DECISIONS.md, "Phase
6"](../../../docs/DECISIONS.md) for the exact manual steps still required, and this
repository's standing rule against creating external resources without explicit
authorization.

## Durable transactional outbox — why not a direct send

A mutation RPC (`assign_family_task`, `accept_task_assignment`, etc.) never calls Expo's API
itself. A second `AFTER INSERT` trigger on `task_assignments`
(`notifications.enqueue_task_assignment_notification`, alongside the pre-existing
`apply_task_assignment_action` — kept as a separate trigger, not folded in, so "apply the
assignment" and "decide who to notify" stay independently reviewable) writes a
`notifications.outbox` row in the *same transaction* as the mutation. A separate, asynchronous
dispatcher claims and sends outbox rows later. This means a notification can never be lost to
a mid-request crash, and the mutation the user is waiting on never blocks on a third-party
API's latency/failure. See [tasks-and-assignments](../domain/tasks-and-assignments.md) for the
assignment state machine this hooks into.

## Recipient derivation — server-side, same transaction, never self

| Event                                | Fires on `task_assignments.action` | Recipient                                    |
| ------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| `family_task.assignment_requested.v1` | `assigned` / `reassigned`            | the new assignee                               |
| `family_task.assignment_accepted.v1`  | `accepted`                           | the assigner, if any                           |
| `family_task.assignment_declined.v1`  | `declined`                           | the assigner, if any                           |
| `family_task.assignment_taken.v1`     | `took`                               | the prior assigner if known, else family owner |

No row is enqueued when the recipient would be the actor (no self-notification — e.g.
assigning to yourself, which already collapses to `accepted` immediately, per
[tasks-and-assignments](../domain/tasks-and-assignments.md)), when the recipient has since
left the family, or (checked at dispatch time) when the recipient has disabled
`notification_preferences.assignment_notifications_enabled` (default `true` — a user who never
opens Settings is still notified). Full column-level detail:
[`docs/DATA_MODEL.md`, "The notifications schema"](../../../docs/DATA_MODEL.md).

## The `notifications` schema is unreachable from the client API — a schema-level control

Unlike every other table in this codebase (RLS + grants), `notifications.outbox`/`deliveries`
are additionally excluded from `supabase/config.toml`'s `[api] schemas` list — PostgREST
routes to them for **no role at all, including `service_role`**, before grants/RLS are even
consulted. See [security-model](security-model.md), "Mechanism 4a," for the full reasoning.
Every table/function inside the schema also carries an explicit `revoke all` as
defense-in-depth, but the schema's absence from that config is the operative control. Verified
two ways: `supabase/tests/110_notification_outbox_test.sql` (database-level) and
`scripts/e2e-notifications.sh` (API-level — a `service_role`-authenticated REST call to
`$API_URL/rest/v1/outbox` 404s, since PostgREST never registered the route). The only
legitimate access path is a direct Postgres connection via `SUPABASE_DB_URL`.

## The dispatcher — a separate Deno runtime, not part of the main app

`supabase/functions/dispatch-notifications/index.ts` is a Deno Edge Function — `npm:`/
`https://` import specifiers, a global `Deno`, its own `deno.json`/`deno.lock`. Excluded from
`tsconfig.json`/`eslint.config.js`/`jest.config.js` so the Node-oriented main-app tooling never
tries to parse it. `dispatchNotifications()` is exported and unit-testable independent of the
`Deno.serve(...)` entry point (guarded by `import.meta.main`, so importing it for a test never
opens a real listener):

1. **Claim** — `notifications.claim_pending_outbox()`, `FOR UPDATE SKIP LOCKED` (safe under
   concurrent invocations — a webhook firing mid-cron-sweep can't double-send a row).
2. **Send** — looks up the recipient's active (non-deactivated) tokens, batches through a
   `PushTransport` interface (real implementation: `_shared/expoTransport.ts`'s
   `createExpoTransport`, a thin `fetch` wrapper around Expo's push API; tests and
   `cli.ts` inject a fully fake one instead), records a `notifications.deliveries` row per
   device.
3. **Classify** — a `DeviceNotRegistered` ticket/receipt deactivates that token
   (`notifications.deactivate_notification_token`); other errors retry at the outbox level
   with bounded exponential backoff (capped 30 minutes).
4. **Check receipts** — a later invocation polls Expo's receipt endpoint for still-`ticket_ok`
   tickets — Expo's own two-phase send-then-receipt flow.

Idempotency: `notifications.outbox.idempotency_key` is unique, derived deterministically from
the triggering `task_assignments.id` (`task_assignment:<id>`), `insert ... on conflict do
nothing` — even a full RPC replay can't produce two outbox rows for the same event.

## Client layer — mirrors `authService.ts`'s pattern exactly

- `src/lib/notifications/notificationService.ts` — the only module calling
  `expo-notifications`/`expo-device`, and the only caller of the
  `register_notification_token`/`notification_preferences` RPCs. Typed `NotificationServiceError`
  with a stable `code`, same shape as `AuthServiceError`.
- `src/domain/notifications/hooks.ts` — TanStack Query hooks wrapping that service; screens
  never call it directly (see [system-architecture](system-architecture.md), "Layering").
- `app/notification-settings.tsx` — the only place permission is requested, and only on
  explicit user action, never on app launch (a deliberate product/privacy choice, not just an
  App Store guideline nicety — see [DECISIONS.md, "Phase 6"](../../../docs/DECISIONS.md)).
- `src/lib/notifications/notificationResponseRouter.ts` — handles a tapped notification cold
  (`getLastNotificationResponseAsync`), backgrounded, and foregrounded
  (`addNotificationResponseReceivedListener`), deduplicated by the notification's own response
  id, resolving the parsed (Zod-validated, ids-only) payload to the existing task editor
  route. A tap while signed out is preserved via `uiStore.pendingNotificationRoute` and
  replayed after sign-in — the same pattern Phase 3 established for `pendingInviteToken`, not
  a new one.

## The push payload never carries task/user content

`src/domain/notifications/payload.ts`: `schemaVersion`, `eventType`, `familyId`, `taskId` —
ids only, never a title, name, or free text. The on-device title/body are static strings the
dispatcher chooses from `event_type` (`NOTIFICATION_BODY_BY_EVENT`), never interpolated from
row content — the same "log ids, not content" discipline as
[security-model](security-model.md), Mechanism 5, applied to a channel that leaves the
database entirely. A tap only ever produces a route to navigate to; the destination screen
re-fetches through the authenticated Supabase client + RLS, so the payload is never trusted as
authorization either.

## Testing

Three layers, all against real local infrastructure, never mocks, per this project's own
standing convention:

- **pgTAP** (`110_notification_outbox_test.sql`, 30 assertions) — the data model: recipient
  derivation, suppression rules, dedup, schema inaccessibility.
- **Deno** (`dispatch-notifications/index.test.ts`, 11 steps) — the dispatcher code: claiming,
  backoff, ticket/receipt handling, token deactivation, against real Postgres + a fake
  transport.
- **`scripts/e2e-notifications.sh`** (`npm run e2e:notifications`) — real `auth.users`
  accounts, real assignment RPCs, the *real* dispatcher code (imported, not reimplemented) via
  a small Deno CLI wrapper (`cli.ts`), authorization boundaries, and full cleanup. Confirmed
  repeatable twice in a row, no residue. Same safety gate as `scripts/e2e-backend.sh`
  (localhost-only, checked against both `API_URL` and `DB_URL` independently).

Client-side Jest coverage (`src/domain/notifications/payload.test.ts`,
`src/lib/notifications/{notificationService,notificationResponseRouter}.test.ts`) surfaced two
non-obvious RNTL/Jest gotchas — see [testing-strategy](testing-strategy.md) for both in full.

## See also

- [Tasks and assignments](../domain/tasks-and-assignments.md) — the assignment state machine
  this feature hooks into
- [Security model](security-model.md) — Mechanism 4/4a in full
- [Data model](data-model.md) — the schema
- [Testing strategy](testing-strategy.md) — the RNTL/Jest gotchas found this phase
- [Roadmap](../product/roadmap.md) — what's explicitly out of scope
