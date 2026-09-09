# Beta Testing

The 13-step beta scenario, the native device test matrix, and the artifacts a real tester
needs — the beta-facing counterpart to [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), which
tracks what's built rather than what a tester should do. None of this has been run against
physical hardware or a hosted environment yet — see RELEASE_CHECKLIST.md's Stage B table.

## The beta scenario

Two adults sign up, form a family, and verify the app end-to-end:

1. Adult A signs up (email/password) and creates a family.
2. Adult A invites Adult B; Adult B accepts via the invitation deep link.
3. Adult A adds a child profile (no account).
4. Adult A creates a private personal task and a family-shared task.
5. Adult B confirms they cannot see Adult A's private task, and that a private *event* of
   Adult A's shows only as a sanitized "Busy" block on the shared calendar — never its title.
6. Adult B claims ("Take") the shared task, or Adult A assigns it directly; Adult B
   accepts/declines and the audit history reflects it.
7. Adult A creates a child event (e.g. a lesson) with separate drop-off and pick-up
   responsibilities assigned to each adult.
8. Both adults confirm the change is visible on a second signed-in device within a few
   seconds (Realtime sync), without a manual refresh.
9. One adult goes offline, edits/completes a personal task, then reconnects — the change
   syncs automatically; a deliberately conflicting edit (made by the other adult while the
   first was offline) surfaces in **Sync Issues**, not silently overwritten.
10. Both adults receive a local reminder notification for a scheduled task at the right time,
    with a generic (non-content) body if the device is locked; tapping it opens the right
    screen.
11. Both adults receive a remote push notification for an assignment/responsibility event
    (**Stage B only** — requires a real device and hosted push infrastructure).
12. Adult B leaves the family (a non-owner, so this is immediate); Adult A confirms Adult B no
    longer appears and can no longer access family content.
13. Adult A deletes their own account via the typed-confirmation flow, after first either
    transferring ownership or deleting the family — confirming the app never lets them
    orphan the family by accident.

Every step above except #11 is coverable with local/simulator testing (Stage A); #11
specifically needs Stage B (a linked EAS project, hosted push infrastructure, a physical
device).

## Native device test matrix

**Platform scope for the first beta round (decided 2026-09-09): iOS only.** Android rows below
are kept in the table (not deleted) because Android remains part of the eventual beta target —
they're deferred, not dropped. Do not spend Stage B effort on Android credentials/builds until
iOS has been through this matrix and the repo owner says to add it.

| Area | iOS physical | Android physical | Notes |
| --- | --- | --- | --- |
| Clean install | Required | Deferred | |
| Sign-up + email confirmation | Required | Deferred | Real deep link, real device. |
| Invitation deep link (cold start + warm) | Required | Deferred | |
| Local reminder notification (scheduled, tap routes correctly) | Required | Deferred | |
| Remote push notification (assignment/responsibility) | Required | Deferred | Needs Stage B. |
| Background / cold-start notification tap | Required | Deferred | |
| Offline → reconnect (queued mutation replays) | Required | Deferred | |
| Account-switch isolation (no cached-content flash) | Required | Deferred | |
| Family Realtime sync across two real devices | Required | Deferred | Two iOS devices for this round. |
| App update preserves local/offline data | Required | Deferred | |

Simulator/emulator evidence may supplement this table but never replaces the physical-device
rows above, particularly for push notifications — see
[DEPLOYMENT.md, "Known limitations"](DEPLOYMENT.md). When Android is added to scope in a later
round, report it as blocked/pending until actually run — never infer an Android pass from an
iOS result.

**Record for each row**: device model, OS version, app build number, environment (staging vs.
local), date tested, pass/fail, evidence (screen recording or screenshot reference), and any
unresolved issue filed.

## Beta tester checklist

Give this to each beta tester before they start:

- [ ] Received an install link (TestFlight / Play Internal Testing) — not a raw `.ipa`/`.apk`.
- [ ] Signed up with a real email you can check (confirmation link required).
- [ ] Notification permission granted when prompted (needed for reminders and assignments).
- [ ] Tried the 13-step scenario above with your co-parent/partner, on two separate devices.
- [ ] Tried going offline (airplane mode) mid-task, then reconnecting.
- [ ] Reported anything confusing, not just anything broken — see the bug report template
      below.

## Bug report template

```
Device / OS:
App build number:
What I was trying to do:
What happened:
What I expected instead:
Steps to reproduce (numbered):
Screenshot or screen recording (if possible):
Did it happen once or every time?
```

## Support info (placeholder)

An operator-supplied support contact (email or in-app link) is required before beta
distribution — not yet set. Track this as a Stage B prerequisite alongside the EAS/store
account questions in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Known limitations to disclose to beta testers

- Google/Apple sign-in buttons are not enabled this beta — email/password only.
- Week/Month calendar views, recurring events, shopping lists, and AI features are not part
  of this beta — see [MVP_SCOPE.md](MVP_SCOPE.md) for the full boundary.
- A schedule conflict (overlapping events) is flagged but never auto-resolved or blocked.
- Offline editing is limited to personal, one-off tasks — family/shared edits require a
  connection.
