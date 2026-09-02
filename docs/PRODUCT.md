# Product

Working name: **FamilyFlow** — stored centrally in [`src/config/app-info.json`](../src/config/app-info.json)
(re-exported, typed, from [`src/config/appInfo.ts`](../src/config/appInfo.ts) and consumed
by [`app.config.ts`](../app.config.ts)). Renaming the product means editing that one JSON
file; no other file should ever hardcode the product name.

## What it is

FamilyFlow is a personal and family planner for iOS and Android. It helps individuals and
families understand:

- what needs to be done;
- when it needs to be done;
- who is responsible;
- whether family schedules contain conflicts (V2 — see [ROADMAP.md](ROADMAP.md)).

It combines personal tasks, calendar events, reminders, family calendars, shared
responsibilities, and child schedules, with future AI-assisted planning (V3). It is not a
to-do list app with a "family" label bolted on — see "Core product model" below for why the
two modes are architecturally distinct, and [DATA_MODEL.md](DATA_MODEL.md) for how that plays
out in the schema.

## Core product model

The app has two connected modes.

### Personal planner

Every adult user has a personal planner:

- **Today** / **Tomorrow** — date-scoped views;
- **Inbox** — tasks with no date yet;
- tasks, with or without a scheduled time;
- calendar events;
- reminders (one or more per task);
- recurring tasks;
- categories (default: Work, Family, Home, Shopping, Health, Other — user-extensible);
- priorities (Normal, Important, Critical);
- **Private** or **Family** visibility per item.

### Family planner

Any adult user can create a **Family Space** and invite other adults. A family has:

- an **Owner**;
- **Adult members**;
- **Child profiles** — a child does not need an account; a parent manages the child's
  calendar. The data model reserves a path to link a child profile to a real account later
  without a migration that breaks existing data (see DATA_MODEL.md, "family_members").

Family members can see:

- the combined family schedule ("Family Today");
- shared family tasks;
- child events;
- responsibilities and assignments;
- **sanitized busy blocks** for other members' private events (owner, start, end, "Busy" —
  nothing else). See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

A user may eventually belong to multiple families. The MVP UI focuses on one _active_ family
at a time (`activeFamilyId` in the client UI store — see ARCHITECTURE.md), but the data model
supports many-to-many membership from day one.

## Critical domain rule: an event is not a responsibility

Modeling this correctly is the single most important domain decision in the product. Example:

```text
Event:
  Swimming — Child: Son — 17:00–18:00

Responsibilities (separate records):
  Drop off → Mom
  Pick up  → Dad
```

An **event** answers "what, when, where." A **responsibility** answers "who is on the hook
for a specific part of it." They are never merged into a single record, and drop-off/pickup
are never plain text fields on an event — described in full in
[DATA_MODEL.md, "events" and "responsibilities"](DATA_MODEL.md#responsibilities). This is
what lets the product later answer "does anyone actually have pickup covered today?" as a
structured query instead of a note a parent has to remember to write and re-read.

## Task structure

A task may carry: title, description, date, start time, duration, one or more reminders,
priority, category, assignee, recurrence, visibility, completion status, and assignment
status. **Only the title is mandatory** — see `src/domain/tasks/schemas.ts` for the
validation this is built against today, and DATA_MODEL.md for the full column list.

Tasks can be personal, shared with family, assigned to a specific member, left unassigned,
claimed via "Take task," scheduled (date+time or date-only), or parked in Inbox with no date.

## Assignment workflow

When one adult assigns a task to another:

- the recipient is notified;
- the assignment can require **Accept** or **Decline** — assignment is never assumed to be
  automatic acceptance;
- assignment status is an explicit, queryable field, not inferred from other state;
- assignment history is auditable (who assigned, who accepted/declined, when).

See DATA_MODEL.md, "task_assignments," for the proposed shape.

## Privacy

Personal items are **Private** or **Family**. For a private event, family members may see
only: owner, start time, end time, and the literal state "Busy." They must never see title,
description, category, notes, attachments, or any other private metadata — not through
direct API queries, realtime events, logs, notifications, or client-side filtering. This is a
data-layer guarantee (Postgres RLS + a sanitized view/RPC), not a UI convention. Full design
in [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## MVP navigation

Five primary tabs: **Today, Calendar, Inbox, Family, Profile** (`app/(app)/`). Today, Inbox,
and Family are fully functional as of Phase 4/Phase 3 respectively; Calendar remains a
placeholder (event CRUD is out of scope through Phase 4 — see [MVP_SCOPE.md](MVP_SCOPE.md)).
Task creation is reachable from Today, Inbox, and Tomorrow (a nested route off Today, not a
sixth tab — see [ARCHITECTURE.md](ARCHITECTURE.md)) via both an inline quick-add and a FAB →
the full editor (`/task/new`).

## MVP success scenario

The MVP is successful when two adults can each install the app, create an account, form a
family (one creates it, the other joins), add a child profile, maintain personal tasks and
events, see private events reduced to "Busy" for each other, see a combined Family Today,
create and assign shared tasks, create a child event with separately-assigned drop-off/pickup
responsibilities, have changes sync across devices, and receive reminders and assignment
notifications. See [MVP_SCOPE.md](MVP_SCOPE.md) for the corresponding build boundary and
[ROADMAP.md](ROADMAP.md) for what is deliberately deferred.
