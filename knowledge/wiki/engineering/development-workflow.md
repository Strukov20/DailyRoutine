---
title: Development workflow
status: current
updated: 2026-09-02
sources:
  - ../../../CLAUDE.md
  - ../../../docs/LLM_WIKI.md
  - ../../../.github/workflows/ci.yml
tags: [engineering, workflow, git, ci, wiki-maintenance]
---

## Git rules

`main` = stable, `develop` = integration, `feature/*` = short-lived. Never push, never merge
into `main`, without being explicitly asked. Local commits only when the working tree was
clean before starting. Conventional commit messages. Never commit secrets, `.env`, keys,
certificates, or build artifacts — see `.gitignore` and `.env.example`.

## CI

`.github/workflows/ci.yml` runs, in order: lint, format check, typecheck, tests (with
coverage), `npm run wiki:lint`, `npx expo config`, `npx expo-doctor`. All are meant to be
fast enough to run on every PR — none require a live Supabase project.

## Mandatory LLM Wiki workflow (this is the part every agent must actually follow)

Full design: [`docs/LLM_WIKI.md`](../../../docs/LLM_WIKI.md).

**Before any non-trivial implementation task:**

1. Read [`knowledge/wiki/index.md`](../index.md).
2. `rg -i "<concept>" knowledge/wiki` for anything task-relevant — retrieve only what's
   relevant, don't load the whole tree into context.
3. Read the canonical `/docs` pages those wiki hits link to.
4. Check recent entries in [`knowledge/wiki/log.md`](../log.md) for related history.
5. Note any contradiction or unresolved question found _before_ editing code — don't
   silently resolve it by picking a side.

**After any material task:**

1. Decide whether durable project knowledge actually changed (skip this for
   formatting-only/trivial changes — don't generate a session source for those).
2. If yes: add a dated file under `knowledge/raw/sessions/`.
3. Update the affected `knowledge/wiki/*` pages.
4. Fix cross-links; update `knowledge/wiki/index.md` if pages were added/renamed/moved.
5. Append an entry to `knowledge/wiki/log.md` (append-only — never edit a past entry).
6. Run `npm run wiki:lint`.
7. Mention the wiki changes in your final report to the user.

## Sources of truth, in order

1. Executed migrations, tests, and application code — current _implemented_ behavior.
2. Approved `/docs` files — normative product/architecture decisions.
3. `knowledge/wiki/` — synthesis, navigation, history, terminology, cross-links. Links to
   `/docs` instead of duplicating it.
4. `knowledge/raw/` — original evidence and requirements, immutable.

If code and `/docs` disagree, **report the contradiction** — don't assume the code is right
just because it's what's running.

## See also

- [Testing strategy](testing-strategy.md)
- Root [`CLAUDE.md`](../../../CLAUDE.md) — the enforced version of the workflow above
