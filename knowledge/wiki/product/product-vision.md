---
title: Product vision
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../raw/product/initial-product-concept.md
tags: [product, vision]
---

## Confirmed

FamilyFlow (working name) is a personal **and** family planner for iOS/Android — not a
to-do list with a family label on it. It combines personal tasks, calendar events,
reminders, family calendars, shared responsibilities, and child schedules, with AI-assisted
planning as a later horizon (V3 — see [roadmap](roadmap.md)).

Two connected modes, both real product surfaces from MVP onward:

- **Personal planner** — Today/Tomorrow/Inbox, tasks, events, reminders, recurrence,
  categories, priorities, Private/Family visibility per item.
- **Family planner** — a Family Space with an Owner, adult members, and child profiles
  (children don't need accounts). See [family-spaces](../domain/family-spaces.md).

## Working-name mechanism

"FamilyFlow" must be renameable without a large refactor. Implemented as: a single JSON file
(`src/config/app-info.json`) is the source of truth; `src/config/appInfo.ts` re-exports it
typed for app code; `app.config.ts` reads the same JSON for the native manifest. See
`docs/ARCHITECTURE.md`, "Environment configuration," for why JSON rather than a `.ts` module
(Expo's config loader can't resolve sibling TypeScript imports from `app.config.ts`).

## Full detail

Read [`docs/PRODUCT.md`](../../../docs/PRODUCT.md) for the complete product model. This page
only orients; it does not restate the full document.

## See also

- [MVP definition](mvp-definition.md)
- [Glossary](glossary.md)
- [Events and responsibilities](../domain/events-and-responsibilities.md) — the single most
  important domain rule in the product
