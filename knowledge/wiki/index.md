---
title: LLM Wiki index
status: current
updated: 2026-09-08
sources: []
tags: [index]
---

Entry point. Every wiki page must be reachable from here (enforced by `npm run wiki:lint`).
For a one-off lookup, prefer `rg <term> knowledge/wiki` over reading this whole tree.

## Product

- [Product vision](product/product-vision.md) — what FamilyFlow is, the working-name mechanism
- [MVP definition](product/mvp-definition.md) — what's in/out of the MVP
- [Roadmap](product/roadmap.md) — V2/V3 and how the architecture anticipates them
- [Glossary](product/glossary.md) — domain terms, fast lookup

## Domain

- [Personal planning](domain/personal-planning.md) — Today/Tomorrow/Inbox, task structure
- [Family Spaces](domain/family-spaces.md) — Owner/Adult/Child members, invitations
- [Tasks and assignments](domain/tasks-and-assignments.md) — assignment workflow, Take Task
- [Events and responsibilities](domain/events-and-responsibilities.md) — **the event ≠
  responsibility rule** — read this before touching anything event-shaped
- [Privacy and availability](domain/privacy-and-availability.md) — the Busy-block rule and
  how it's enforced

## Engineering

- [System architecture](engineering/system-architecture.md) — stack, folders, state boundaries
- [Data model](engineering/data-model.md) — entities, ownership, authorization
- [Security model](engineering/security-model.md) — RLS + sanitization mechanisms
- [Authentication](engineering/authentication.md) — Supabase Auth, session state, deep links
- [Push notifications](engineering/push-notifications.md) — the notification outbox, Edge
  Function dispatcher, and client-side token/routing layer (Phase 6)
- [Family calendar](engineering/family-calendar.md) — events, responsibilities, the
  assignment state machine, conflict detection, and the Calendar UI (Phase 7)
- [Recurring tasks and reminders](engineering/recurring-tasks-and-reminders.md) — bounded
  materialized occurrences, the device-local reminder scheduler, and a confirmed `<Menu>`
  testability limitation (Phase 8)
- [Realtime sync and offline resilience](engineering/realtime-sync-and-offline.md) —
  Broadcast-based Realtime, the persisted read cache, the bounded offline mutation queue, and
  the sync-status UI — **in progress (Phase 9), tracks done vs. not-done**
- [Testing strategy](engineering/testing-strategy.md) — what's tested, what isn't yet
- [Development workflow](engineering/development-workflow.md) — git rules, CI, **the
  mandatory wiki read/update workflow** — read this once, it governs how every other page
  gets used and maintained

## Log

- [Operation log](log.md) — append-only history of what changed in this wiki and why

## How to use this without loading everything

1. Read this index.
2. `rg -i "<concept>" knowledge/wiki` for anything specific.
3. Open only the pages that actually matched.
4. Follow each page's `sources:` links to the canonical `/docs` file or raw source before
   trusting a detail for an implementation decision — this wiki synthesizes and points, it
   does not replace the canonical documents.
