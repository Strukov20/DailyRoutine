# Incident Diagnosis and Rollback

How to diagnose the failure modes most likely to affect a beta, and how to roll back a bad
release. Written for Stage B (a deployed hosted environment) — see
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for whether that stage has actually happened yet.
Nothing in this document has been exercised against a real incident; it is prepared in advance,
consistent with this phase's "prepare a runbook, don't wait for a real outage to write one"
scope.

## Diagnosing common failure modes

### Auth callback failures (sign-up confirmation, password reset, invitation links)

- Check Supabase Auth logs (Dashboard → Authentication → Logs) for the failed request.
- Confirm the redirect URL used matches what's configured in Supabase Auth settings — a
  mismatch here is the most common cause of "link doesn't open the app."
- Confirm the deep link scheme (`app.config.ts` → `APP_INFO.scheme`) matches what's registered
  in the build the tester installed — a stale build with an old scheme silently fails to open.

### Realtime subscription failures (cross-device sync not happening)

- Confirm the affected client's Realtime connection state — `useRealtimeSync.ts` exposes
  connection status; a UI symptom of "changes on device A never appear on device B" usually
  means device B's channel silently died (e.g. backgrounded too long) and hasn't
  re-subscribed yet.
- Check `realtime.messages` isn't being blocked by an RLS regression — re-run
  `150_realtime_offline_conflicts_test.sql` locally against the same schema version if a
  privacy/authorization regression is suspected.
- A private field appearing in a broadcast payload is a release blocker, not a
  degraded-experience issue — every broadcast payload is contractually
  `{version, scope, entity, operation}` only (see
  [ARCHITECTURE.md, "Realtime sync (Phase 9)"](ARCHITECTURE.md)); if this is ever observed,
  treat it as a security incident, not a bug report.

### Offline replay failures (queued operation never syncs, or syncs wrong)

- Every queued operation carries a stable id/idempotency key — a "duplicate" symptom (the same
  task appearing twice) means that guarantee broke, and should be treated as a release
  blocker, not retried around.
- A stuck "Syncing…" state usually means a crash mid-replay; the operation should self-heal to
  `retry_wait` on the next app launch (`runOfflineQueueReplay`'s hydrate-time reset) — if it
  doesn't, that reset logic itself is the bug to investigate first.
- Direct the tester to **Sync Issues** (`/sync-issues`) rather than asking them to describe
  the failure from memory — it shows the exact operation, status, and (for a conflict) a
  field-level comparison.

### Notification failures

- **Local reminders**: check `reconcileReminders`'s last run — reminders reconcile at fixed
  app lifecycle points, not continuously; a reminder that never fires after a schedule change
  usually means reconciliation didn't run, not that scheduling itself is broken.
- **Remote push (Stage B only)**: `notifications.outbox`/`notifications.deliveries` (direct
  Postgres access or the Supabase Dashboard SQL editor only — never exposed via the REST API)
  carry `status`, `attempts`, `last_error`, `expo_ticket_id`, `expo_receipt_status`, and a
  per-device `error_code` — see [DEPLOYMENT.md, "12. Observability"](DEPLOYMENT.md). A
  `DeviceNotRegistered` receipt should have already deactivated that token automatically; if a
  tester keeps not receiving pushes after reinstalling, confirm their new token actually
  replaced the old (deactivated) one.
- **Invalid device token**: same table — a token stuck `active` despite repeated delivery
  failures is the specific regression to look for; it should have been deactivated on the
  first `DeviceNotRegistered` receipt.

### Ownership/account-deletion failures

- A "family stuck without an owner" report is a release blocker — the schema's own
  `family_members_one_owner_per_family` unique partial index and
  `assert_family_owner_consistency` trigger should make this structurally impossible; if
  observed, capture the exact `family_ownership_transfers` audit rows for that family before
  doing anything else.
- An account deletion that leaves stale cached content visible to a *different* account
  signing in on the same device afterward is also a release blocker — see
  [ARCHITECTURE.md](ARCHITECTURE.md) and `AuthProvider.test.tsx`/`uiStore.test.ts` for what
  should already prevent this; if reproduced, this needs a signed-in-device cache audit, not a
  cosmetic fix.

## Rollback runbook

**Client (EAS/store build)**

1. If the bad build is in internal/preview distribution only: stop distributing the new
   build's link; testers can continue on the previous internal build until a fix ships. No
   store rollback mechanism is needed at this distribution stage.
2. If the bad build has already reached TestFlight/Play Internal Testing: do not promote it
   further; communicate to testers to stay on the prior build if both remain installable, or
   pull the build from the testing track if the platform allows it.
3. A published production build cannot be "rolled back" on either store — the fix is a new,
   higher-versioned build submitted through the normal review process. Plan for this by never
   promoting a build to production distribution without having completed the beta matrix.

**Server (hosted Supabase)**

1. **Never** run `supabase db reset` against a hosted project — this is an explicit standing
   rule (see `CLAUDE.md`), not situational advice for an incident.
2. A bad migration should be rolled back with a new, forward-only migration that reverses the
   change — not by editing or deleting the applied migration file. This preserves the
   migration history's own audit trail.
3. If a bad RPC change is live: the fastest safe mitigation is usually revoking `EXECUTE` on
   the specific function from `authenticated` (stopping the bleeding) while a forward-fix
   migration is prepared — not reverting the whole migration blindly, which can strand data
   written under the new shape.
4. Edge Functions (e.g. `dispatch-notifications`) can be redeployed to a prior version
   independently of the database schema — check compatibility with the currently-applied
   migrations before doing so.

**Secrets**

1. If a secret is suspected compromised (accidentally logged, committed, or exposed in a
   client bundle), rotate it immediately via the Supabase Dashboard / EAS secrets UI, then
   redeploy anything that depended on the old value. Rotating is not optional pending
   investigation — do it first, investigate after.
2. Re-run the client bundle/secret audit in
   [DEPLOYMENT.md, "Client bundle / secret audit"](DEPLOYMENT.md) after any secret rotation or
   environment-variable change, before the next release.

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) — the deployment steps this runbook assumes were followed.
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — current release status.
- [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) — the guarantees an incident above would
  be violating.
