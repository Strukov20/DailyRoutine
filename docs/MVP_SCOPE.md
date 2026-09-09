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
  [DECISIONS.md, "Phase 7"](DECISIONS.md); conflict *resolution* — automatically proposing or
  applying a fix — remains V2. A bounded personal-task offline mutation queue, a persisted
  read cache, Realtime cross-device sync, and stale-write *detection* were implemented in
  Phase 9 — see [ARCHITECTURE.md, "Offline & caching"](ARCHITECTURE.md) and
  [DECISIONS.md, "Phase 9"](DECISIONS.md); offline editing for anything beyond a personal
  task, and manual conflict *resolution* UI, remain V2.)
- **V3**: natural-language task creation, "Plan My Day," AI scheduling, automatic
  rescheduling with confirmation, family conflict resolution, AI family planning.

## This foundation phase vs. the MVP

This repository's current state is the **foundation phase** — one iteration before MVP work
starts. The foundation phase deliberately stops short of the MVP list above. See the "Stop
point" section of [README.md](../README.md) and [DECISIONS.md](DECISIONS.md) for exactly
what was built vs. deferred, and why.
