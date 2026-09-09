# Deployment & Real Device Push Validation

Status: **not deployed**. Everything in this document describes exact manual steps for
whoever operates the real Supabase/EAS project — none of it has been executed against a real
hosted project or physical device by an agent working in this repository, per this project's
standing rule against creating or modifying external resources (EAS, Apple Developer,
Firebase, hosted Supabase) without explicit authorization. See "Known limitations" at the
bottom for exactly what has and hasn't been verified.

This is the deployment/runbook counterpart to [ARCHITECTURE.md](ARCHITECTURE.md), "Push
notifications," and [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), "Mechanism 4." Read
those first for *why* the system is built this way; this document is *how to actually turn it
on*.

## The flow this document deploys

```text
task_assignment event
  → notifications.outbox (written in the same transaction, via a trigger)
  → dispatch-notifications (deployed Edge Function, claims + sends)
  → Expo Push Service (ticket, then later a receipt)
  → APNs / FCM
  → physical device
  → notification tap
  → app route (task edit screen), re-fetched through RLS
```

Every stage up to and including "Expo Push Service" is implemented and tested against real
local infrastructure (see [TEST_STRATEGY.md](TEST_STRATEGY.md)) with a **fake** transport —
no code in this repository has ever made a real call to Expo's push API. Deploying is what
turns the fake transport into the real one (`_shared/expoTransport.ts`'s
`createExpoTransport()`, already wired as the production path in
`dispatch-notifications/index.ts`'s `Deno.serve` handler — no code change is needed to go
from "tested with a fake" to "running for real," only configuration).

## 1. EAS / Expo Push infrastructure

Required before a device can obtain a real `ExpoPushToken`:

1. **Create or link an EAS project.** `npx eas login` (interactive — your own Expo account),
   then `npx eas init` from the repo root. This writes `extra.eas.projectId` into the
   resolved Expo config — `src/lib/notifications/notificationService.ts`'s
   `getExpoProjectId()` already reads exactly this field
   (`Constants.expoConfig?.extra?.eas?.projectId`), so no client code change is needed once
   it's set. Until then, `registerForPushNotifications()` correctly throws a typed
   `missing_project_id` error rather than attempting a request that would fail — this is
   tested behavior (`notificationService.test.ts`), not a gap.
2. **Push credentials.** `npx eas credentials` — Android needs an FCM server key (or EAS's
   own managed credentials); iOS needs an APNs key/cert, which requires an active Apple
   Developer Program membership. EAS can manage both for you interactively.
3. **A development or production build**, not Expo Go — `expo-notifications`' real push-token
   API behaves differently (or is unavailable) in Expo Go on SDK 53+. `eas.json` (Phase 10)
   defines four profiles: `development-simulator` (iOS Simulator, no real push token
   possible — `Device.isDevice` is false), `development-device` (a real device, dev client,
   for exactly this kind of manual push validation), `preview` (internal distribution —
   TestFlight/Play Internal Testing, see "Beta distribution" below), and `production` (store
   submission, auto-incrementing build number). `npx eas build --profile development-device`
   for real push-token validation on a physical device.
4. **Never commit credentials.** `eas credentials` stores what it needs on Expo's servers, not
   in this repo. The EAS project ID itself is not a secret (it's already read from the public
   Expo config on every device) and is safe to commit to `app.config.ts`/`eas.json` once
   assigned.

## 2. Deploying `dispatch-notifications`

The function's logic does not change for deployment — only its runtime configuration.

```bash
# One-time: link this repo to your hosted Supabase project (interactive login required).
npx supabase login
npx supabase link --project-ref <your-project-ref>

# Push the schema (migrations, including the notifications schema and its
# RLS/grants) to the hosted project. Review the diff it prints before confirming.
npx supabase db push

# Set the worker secret as an Edge Function secret — never in .env, never
# committed, never EXPO_PUBLIC_*.
npx supabase secrets set NOTIFICATION_WORKER_SECRET=$(openssl rand -hex 32)

# Deploy the function itself.
npx supabase functions deploy dispatch-notifications
```

`SUPABASE_DB_URL` (which `_shared/db.ts`'s `createDbClient()` reads to reach the
PostgREST-unexposed `notifications` schema — see [DATA_MODEL.md](DATA_MODEL.md)) does **not**
need to be set manually: Supabase's hosted Edge Function runtime injects it automatically for
every deployed function, the same way it injects `SUPABASE_URL`/`SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`. Confirm this is still true for whatever Supabase platform
version is current at deploy time — if it isn't, `SUPABASE_DB_URL` becomes a required manual
secret too, same handling as `NOTIFICATION_WORKER_SECRET` below.

**Secret hygiene checklist** (all verified locally as of this phase — see "Client bundle
audit" below for the repeatable check):

- `NOTIFICATION_WORKER_SECRET` is read only via `Deno.env.get(...)` inside
  `dispatch-notifications/index.ts` — never referenced by any file under `src/`/`app/`, never
  an `EXPO_PUBLIC_*` name, never in `.env.example`.
- The `service_role` key is never referenced by the mobile app
  (`src/lib/supabase/client.ts` only ever uses the anon key).
- Neither secret appears in this repository's git history for this phase (nothing was ever
  set, since nothing was ever deployed).

## 3. Dispatcher trigger — recommended: Database Webhook + `pg_cron`, both

Both mechanisms call the same `Deno.serve` handler — wiring either up is a dashboard/CLI
configuration step, never a code change.

### Database Webhook (low latency)

Supabase Dashboard → Database → Webhooks → create one on `notifications.outbox`, event
`INSERT`, target: the deployed function's URL, with the
`x-notification-worker-secret: <NOTIFICATION_WORKER_SECRET>` header. This fires within
seconds of a task assignment.

### `pg_cron` sweep (the durable fallback — do not skip this even if the webhook is set up)

```sql
select cron.schedule(
  'dispatch-notifications-sweep',
  '* * * * *', -- every minute
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-worker-secret', '<NOTIFICATION_WORKER_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

(Requires the `pg_cron` and `pg_net` extensions enabled on the hosted project — Dashboard →
Database → Extensions.) The webhook alone is not sufficient on its own: a webhook delivery
can fail (a transient network blip, the function cold-starting slowly) with no automatic
retry from Supabase's side. The cron sweep is what actually delivers the "durable" half of
"durable transactional outbox" — an outbox row stays `pending` until a claim succeeds, so a
missed webhook just means a delay of at most one cron interval, never a lost notification.

**Why not "just cron" or "just webhook" alone**: cron-only adds up to 60s of latency to every
notification; webhook-only has no fallback for a missed delivery. Running both is not
redundant scheduling — it's latency (webhook) plus durability (cron), the same design already
documented in the function's own header comment.

### Authentication, concurrency, and failure handling — already implemented, not something to design at deploy time

- **Auth**: the function checks `x-notification-worker-secret` against
  `NOTIFICATION_WORKER_SECRET` and rejects with 401 on any mismatch — independent of and in
  addition to Supabase's own platform-level JWT verification in front of every Edge Function.
- **Concurrent claim safety**: `notifications.claim_pending_outbox()` uses
  `FOR UPDATE SKIP LOCKED` — a second dispatcher invocation (webhook firing mid-cron-sweep, or
  two overlapping cron ticks if one runs long) never blocks on or re-claims a row the first
  already has. Verified directly: `dispatch-notifications/index.test.ts`'s "concurrent claim"
  step asserts two simultaneous claims never return the same row.
- **Timeout/error handling**: a transport-level failure (network timeout, malformed response)
  is caught per-outbox-row and reschedules that row via `next_attempt_at` with bounded
  exponential backoff (`notifications.backoff_interval`: 1m, 2m, 4m, 8m, 16m, capped at 30m) —
  it never fails the whole batch, and never retries immediately/unboundedly. After 5 attempts
  an outbox row is marked `failed` (terminal) rather than retried forever.

## 4. Real device registration — manual test procedure

Run against a real development/production build (not Expo Go), signed in as a real test user:

1. Sign in.
2. Navigate to Notification Settings (`app/notification-settings.tsx`) — permission is
   requested only here, only on explicit tap, never on app launch (see
   [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for why that's a deliberate product
   choice, not just a guideline).
3. Grant permission.
4. Confirm a real `ExponentPushToken[...]` was obtained (visible via a debug log, or by
   inspecting `notification_tokens` directly in the Supabase Dashboard's Table Editor).
5. Confirm exactly one row exists for this device in `notification_tokens`
   (`register_notification_token` upserts on `expo_push_token`, so a second app launch must
   not create a duplicate — this is tested locally with a fake token string; re-verify with a
   real one).
6. Sign out — confirm `deactivated_at` is set on that row (`app/(app)/profile.tsx` calls
   `deactivateCurrentDeviceToken()` before `signOut()`).
7. Sign back in and re-register — confirm `deactivated_at` clears again on the same row
   (`register_notification_token`'s own documented behavior: it always reassigns/reactivates
   on re-registration, covering both re-login and reinstall/device-resale).

## 5–8. Real push, tap routing, pending route, and the event matrix

These are manual, on-device procedures — the automated equivalent of every one of them
already exists and passes against a fake transport (see
`scripts/e2e-notifications.sh`/`npm run e2e:notifications` for the server-side flow, and
`notificationResponseRouter.test.ts` for tap-routing logic). Deploying does not change any of
this logic; it only makes the *transport* real. The manual acceptance matrix below is the
same one from this phase's own brief — treat it as the checklist to run once real
infrastructure exists:

| Case | Expected |
| --- | --- |
| Assignment | Recipient device receives a push; actor does not |
| Reassignment | Correct new recipient, not the stale one |
| Accepted | The original assigner receives it |
| Declined | The original assigner receives it |
| Self-assigned ("Take") | No notification to anyone (self-notification is suppressed server-side) |
| Notifications disabled (preference) | No push sent, checked server-side at dispatch time, not client-side |
| Foreground tap | Routes to the correct task |
| Background tap | App resumes, routes to the correct task |
| Cold-start tap | App launches, routes to the correct task once navigation/auth is ready |
| Logged-out tap | Login flow, then routes to the correct task (`pendingNotificationRoute`) |
| Duplicate delivery (retry) | No duplicate navigation — response-id dedup in `notificationResponseRouter.ts` |
| Invalid/uninstalled token | Token deactivated, no infinite retry loop |
| Removed family member | No notification (checked server-side against current `family_members` state) |

Payload contents to inspect on a real received notification: `schemaVersion`, `eventType`,
`familyId`, `taskId` only — confirm no title, description, or any other field is present (see
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), Mechanism 4).

## 9. Notification preferences on the real pipeline

`notification_preference_enabled()` defaults `true` for a profile with no
`notification_preferences` row — a user who never opens Settings is still notified. Toggling
it off in Settings and triggering a new assignment must produce **zero** outbox rows for that
recipient (checked at enqueue time by
`notifications.enqueue_task_assignment_notification()`), not merely a skipped delivery — the
server-side recipient-derivation is the only source of truth, the client never filters
notifications it already received.

## 10. Expo tickets vs. receipts, and `DeviceNotRegistered` handling

Expo's push API is two-phase, and this codebase's own delivery-status model mirrors it
exactly:

1. **Send → ticket** (`notifications.deliveries.status = 'ticket_ok'` or `'ticket_error'`) —
   an immediate, synchronous response confirming Expo *accepted the message for delivery*.
   This is not confirmation the device received anything.
2. **Later, separately, poll for a receipt** (`'receipt_ok'` or `'receipt_error'`) — the
   actual outcome, fetched by ticket id on a subsequent dispatcher invocation (Phase 2 of
   `dispatchNotifications()`, run every time the function fires, checking all outstanding
   `ticket_ok` deliveries so far).

`classifyExpoError()` (`_shared/expoTransport.ts`) applies to *both* a ticket-time error and a
receipt-time error, since Expo uses the same `details.error` vocabulary for both:

- `DeviceNotRegistered` → `notifications.deactivate_notification_token()` — the token is
  marked `deactivated_at`, excluded from all future sends (`notification_tokens.deactivated_at
  is null` is part of the recipient-token query), but the row itself is kept, not deleted —
  re-registering the same token string later clears it again.
- `MessageTooBig` / `InvalidCredentials` → `permanent` (not retried at the delivery level —
  the delivery row itself is terminal, though the outbox row it belongs to is still marked
  `sent`, since the send call itself succeeded; see "Retry semantics" below for why outbox and
  delivery status are tracked separately).
- `MessageRateExceeded` / `ProviderError` / anything unrecognized → `retryable` (safer to
  retry an unknown code a bounded number of times than to silently drop a real notification).

If a real `DeviceNotRegistered` is hard to trigger manually (it requires an actually-revoked
token, e.g. an uninstalled app), `dispatch-notifications/index.test.ts`'s dedicated
`DeviceNotRegistered` steps (ticket-time and receipt-time, both passing) remain the primary
proof this path works — real-device validation only needs to confirm the *transport* really
returns Expo's documented error shape when it happens, not re-prove the handling logic.

## 11. Retry and idempotency semantics — the actual delivery guarantee

Documented explicitly here because the brief itself warns against overclaiming: **this system
is at-least-once, not exactly-once**, matching what Expo's own push infrastructure guarantees
(no more, no less):

- **A processed (`sent`) outbox row is never reprocessed** by a later cron run —
  `claim_pending_outbox()` only selects `status = 'pending'` rows.
- **A retryable failure is retried with bounded backoff** (see Section 3) up to 5 attempts,
  then marked `failed` (terminal — not retried again automatically; a human/ops action would
  be needed to requeue it, which this phase does not build tooling for).
- **Two concurrent dispatcher invocations cannot claim the same row** (`FOR UPDATE SKIP
  LOCKED` — see Section 3).
- **Idempotency at the source**: `notifications.outbox.idempotency_key` is unique, derived
  deterministically from the triggering `task_assignments.id`
  (`task_assignment:<id>`) with `insert ... on conflict do nothing` — even a full RPC replay
  that somehow re-triggered the same logical event cannot produce a second outbox row.
- **What is *not* guaranteed**: that a device receives a notification exactly once. A ticket
  can succeed while the receipt is still pending when the app later checks — Expo itself may
  redeliver in rare cases, and this system does not attempt to build an exactly-once guarantee
  on top of a provider that doesn't offer one. **Tap-time deduplication** (in
  `notificationResponseRouter.ts`, keyed by the notification's own response id) is what
  prevents a redelivered/re-tapped notification from double-navigating — this is dedup at the
  *client tap* level, a different guarantee from *delivery* exactly-once, and should not be
  conflated with it in future documentation.

## 12. Observability

Every stage of a delivery is traceable via `notifications.outbox`/`notifications.deliveries`
(both reachable only via a direct Postgres connection or the Supabase Dashboard's SQL editor
— see Mechanism 4a, they are not exposed via the REST API to any role): `event_type`,
`recipient_member_id`, `attempts`, `status`, `last_error`, `expo_ticket_id`,
`expo_receipt_status`, `error_code` per device. This is sufficient for production
troubleshooting without client device access — no new observability tooling was built or is
needed this phase, per the brief's own "if structured logging is already sufficient, don't
build a new system" instruction.

**Never logged, anywhere in this codebase**: `NOTIFICATION_WORKER_SECRET`, any auth token, the
raw push token string itself (`notifications.deliveries` stores `expo_ticket_id`, never the
device's push token), or any push payload content beyond ids — verified directly:
`dispatch-notifications/index.test.ts`'s "redacted logging" step asserts the dispatch result
never contains a raw push token.

## Client bundle / secret audit (repeatable)

```bash
npx expo export --platform ios --output-dir /tmp/audit-ios
npx expo export --platform android --output-dir /tmp/audit-android
strings /tmp/audit-ios/_expo/static/js/ios/*.hbc | grep -iE "NOTIFICATION_WORKER_SECRET|SERVICE_ROLE|CLIENT_SECRET"
strings /tmp/audit-android/_expo/static/js/android/*.hbc | grep -iE "NOTIFICATION_WORKER_SECRET|SERVICE_ROLE|CLIENT_SECRET"
npx expo config --type public | grep -iE "NOTIFICATION_WORKER_SECRET|SERVICE_ROLE|CLIENT_SECRET"
```

All three should produce no matches. Re-run after any change touching environment variables,
`app.config.ts`, or the notification client code — verified clean as of this phase (see
[DECISIONS.md](DECISIONS.md), "Phase 6.1"). The Expo project ID itself is expected to appear
in the public config and is not a secret.

## Known limitations — what this phase did not and could not verify

- **No EAS project has been created or linked.** `app.config.ts` has no `extra.eas.projectId`.
- **No hosted Supabase project is connected to this repository.** `dispatch-notifications` has
  never been deployed anywhere; `NOTIFICATION_WORKER_SECRET` has never been set anywhere.
- **No Database Webhook or `pg_cron` schedule has been configured** — there is nothing hosted
  for either to call yet.
- **No physical device has received a real push notification** through this pipeline. Every
  automated test at every layer (pgTAP, Deno, Jest, `scripts/e2e-notifications.sh`) uses a
  fake `PushTransport` — this is deliberate (see [TEST_STRATEGY.md](TEST_STRATEGY.md)), not an
  oversight, but it means the manual acceptance matrix in Section 5–8 above has not been
  executed against reality.
- **Tickets vs. receipts, and `DeviceNotRegistered`, are proven against the fake transport
  only** — the classification logic is real and tested, but has not observed a real Expo
  response shape.

Executing the steps in this document (creating an EAS project, linking/deploying to a hosted
Supabase project, running the manual device matrix) requires the repository operator's own
Expo/Apple/Google/Supabase accounts and a physical device, and was explicitly out of scope for
an agent to perform autonomously this phase — see [DECISIONS.md](DECISIONS.md), "Phase 6.1."

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md), "Push notifications" — the design this deploys
- [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), Mechanism 4/4a — the privacy/isolation
  guarantees that must hold in production exactly as they do locally
- [TEST_STRATEGY.md](TEST_STRATEGY.md) — what's covered by the fake-transport test suite
- [DECISIONS.md](DECISIONS.md), "Phase 6" and "Phase 6.1" — the original design rationale and
  this phase's own findings
