# MVP Scope

This is the feature boundary for the MVP referenced throughout the other docs. If a task
description doesn't fit under one of these bullets, it belongs in [ROADMAP.md](ROADMAP.md)
(V2/V3), not in a "quick addition" to the MVP.

## In scope for MVP

- Account creation and authentication (Supabase Auth — email/password at minimum).
- Personal tasks: create, edit, complete, delete; title-only-required per DATA_MODEL.md.
- Inbox (date-less tasks).
- Today and Tomorrow views.
- Task scheduling: date-only or date+time.
- Reminders (one or more per task).
- Recurring tasks (a recurrence rule attached to a task, generating instances).
- Personal calendar (day view).
- Family Space creation.
- Adult invitations to a Family Space.
- Child profiles (no account required).
- Shared family calendar (Family Today: merged view across members and children).
- Shared family tasks.
- Task assignment, including "Take task" (self-claim of an unassigned task).
- Assignment Accept/Decline workflow with audit history.
- Privacy: Private vs Family visibility, sanitized "Busy" blocks for private events.
- Child events.
- Drop-off and pickup responsibilities as records separate from the event they attach to.
- Family Today (combined schedule).

## Explicitly out of scope for MVP

These are documented (architecturally supported where noted) but not built. See
[ROADMAP.md](ROADMAP.md) for the full V2/V3 breakdown:

- **V2**: Google/Apple Calendar integration, Week/Month calendar views, subtasks, attachments,
  shared shopping lists, widgets, comments, advanced offline sync, statistics. (Deterministic
  schedule-conflict *detection* was implemented in Phase 7 — see
  [ARCHITECTURE.md, "Family calendar"](ARCHITECTURE.md) and
  [DECISIONS.md, "Phase 7"](DECISIONS.md); *automatically* proposing or applying a fix for a
  schedule conflict remains V2 — the Conflict Center stays read-only plus a Review action, by
  design. A bounded personal-task/occurrence offline mutation queue, a persisted read cache,
  Realtime cross-device sync, stale-write *detection*, and — from a Phase 9 completion pass —
  full manual *resolution* of a stale-write sync conflict (the Sync Issues screens: review a
  field-level comparison, then Reload/Apply/Keep/Discard) were implemented — see
  [ARCHITECTURE.md, "Offline & caching"](ARCHITECTURE.md) and
  [DECISIONS.md, "Phase 9"](DECISIONS.md). Offline editing for anything beyond a personal
  task/occurrence remains V2.)
- **V3**: natural-language task creation, "Plan My Day," AI scheduling, automatic
  rescheduling with confirmation, family conflict resolution, AI family planning.

## Current status: MVP scope is feature-complete; Phase 10 is release stabilization

Every item in "In scope for MVP" above is built (Phases 1–9) and covered by automated tests —
see [README.md](../README.md)'s own phase-by-phase summary for what each phase added, and
[DECISIONS.md](DECISIONS.md) for why things were built the way they were. Phase 10
("MVP Stabilization, Deployment, and Beta Release," [DECISIONS.md, "Phase 10"](DECISIONS.md))
is not new feature work — it is release-readiness work: closing the mandatory release-safety
gaps an MVP audit found (family ownership transfer, family/account deletion — none of which
were built despite being prerequisites for a real family to safely use the app), a security
audit, environment/build configuration, and the beta-distribution runbook
([docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)). This document's own "in scope" list is
otherwise unchanged by Phase 10 — see [ROADMAP.md](ROADMAP.md) for exactly what Phase 10 added
versus what remains V2/V3.
