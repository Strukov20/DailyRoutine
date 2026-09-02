# The LLM Wiki (`knowledge/`)

Development infrastructure — persistent, Markdown + Git-based project knowledge so Claude
Code (or another coding agent) can retrieve product requirements, approved decisions,
architecture, domain rules, implementation history, known problems, unresolved questions,
and previously-failed approaches without re-deriving them each session. **Never a runtime
dependency of the mobile app** — nothing under `knowledge/` is imported by `app/` or `src/`.

## External skill evaluation: `Astro-Han/karpathy-llm-wiki`

**Not installed.** Evaluated before building anything manually, per instruction.

- **Contents inspected** (via the GitHub API, read-only — repo, tree, and file contents,
  never cloned/executed): `SKILL.md` (an Agent-Skills-format skill definition), one Python
  script `scripts/check_evidence.py` (a "grounding" linter — checks that facts in wiki
  articles are traceable to raw sources), Markdown templates under `references/`, examples,
  and tests. No install scripts, no hooks directory, no CI/network-calling code.
- **License:** MIT (confirmed via the GitHub API's `license` field) — compatible with
  reviewing/adapting its ideas.
- **Safety:** `check_evidence.py` was read in full — pure standard library (`re`, `sys`,
  `dataclasses`, `pathlib`), no `subprocess`, `eval`/`exec`, network calls, or file writes.
  It's a read-only validator, structurally comparable to this repo's own
  `scripts/wiki-lint.mjs`. Nothing about the repository raised a secrets, network-activity,
  or unsafe-hook concern.
- **Why it wasn't installed anyway:** its schema doesn't match what this task requires. It
  uses a flat `raw/<topic>/` + `wiki/<topic>/<article>.md` layout, its own frontmatter/log
  format (`Sources:`/`Raw:` fields, `## [date] ingest | ...` log lines), and is designed for
  general personal-knowledge ingestion (research articles, tweets) rather than a
  repository's own product/domain/engineering knowledge with an explicit "`/docs` is
  normative, wiki synthesizes" hierarchy. Adopting it as-is would mean maintaining two
  divergent conventions in parallel (its schema vs. the `knowledge/raw/{product,research,
sessions}` / `knowledge/wiki/{product,domain,engineering}` structure this project
  specifically requires) with no way to reconcile them without forking the skill. Per this
  task's own instruction — "If installation is unavailable, unsafe, or incompatible,
  implement the Markdown-based workflow manually" — the workflow below was built by hand
  instead. Its core ideas (immutable raw sources, a grounding/citation discipline, an
  append-only log, a lint script) were kept; its specific file layout was not.

If the required structure ever changes to match that skill's conventions, or a future
version resolves the schema mismatch, re-evaluate rather than assuming this conclusion still
holds — this is a point-in-time decision, not a permanent one.

## Structure

```text
knowledge/
  README.md            Orientation, same content summarized here
  raw/                  Immutable source material
    product/             Original product briefs (never edited after the fact)
    research/             External research inputs (empty for now — see its README)
    sessions/             Dated records of what an agent did in a given session
  wiki/                 Synthesized, maintained, cross-linked pages
    index.md              Entry point — every page must be reachable from here
    log.md                 Append-only operation history
    product/               Vision, MVP definition, roadmap, glossary
    domain/                 Personal planning, family spaces, tasks/assignments,
                            events/responsibilities, privacy/availability
    engineering/            Architecture, data model, security, testing, workflow
```

Deviation from the originally-sketched structure: none of significance — the tree above
matches what was requested, with `raw/research/` currently holding only a `README.md`
explaining its purpose (no research sources exist yet to ingest).

## Sources of truth (highest to lowest authority)

1. **Executed migrations, tests, and application code** — current _implemented_ behavior.
2. **Approved `/docs` files** — normative product/architecture decisions.
3. **`knowledge/wiki/`** — synthesis, navigation, history, terminology; links to `/docs`
   instead of duplicating it.
4. **`knowledge/raw/`** — original evidence and requirements, immutable.

If code and `/docs` ever disagree, that's a contradiction to report, not something to
silently resolve by assuming the code is right.

## How to ingest a new source

1. Add a new, dated file under the right `knowledge/raw/` subdirectory
   (`product/` for corrected/new product requirements, `sessions/` for a record of what an
   agent did, `research/` for external material). **Never edit an existing raw file** — raw
   sources are immutable; add a new one and let the wiki point at whichever is current.
2. Update the affected `knowledge/wiki/*` pages: state what's confirmed vs. proposed vs.
   unresolved, cite the raw source and/or canonical `/docs` file in frontmatter `sources:`,
   and record contradictions explicitly rather than picking a side silently.
3. Fix cross-links; update `wiki/index.md` if a page was added, renamed, or moved.
4. Append an entry to `wiki/log.md` (append-only — never edit a past entry).
5. Run `npm run wiki:lint`.

## How to query the wiki

Start at [`knowledge/wiki/index.md`](../knowledge/wiki/index.md), then
`rg -i "<concept>" knowledge/wiki` for anything specific — retrieve only the pages that
actually match, don't load the whole tree into context. Follow each page's `sources:` links
to the canonical `/docs` file before trusting a detail for an implementation decision.

## How to lint it

```bash
npm run wiki:lint
```

Implemented in [`scripts/wiki-lint.mjs`](../scripts/wiki-lint.mjs) — plain Node, no
dependency added, per instruction ("Do not add a heavy dependency when a small Node script
is sufficient"). Checks: `knowledge/wiki/index.md` and `knowledge/wiki/log.md` exist; every
`wiki/**/*.md` article (other than `index.md`/`log.md`) is linked from `index.md`; every
relative Markdown link in a wiki page resolves to a real file; every wiki page has the
required frontmatter (`title`, `status`, `updated`, `sources`, `tags`); every path listed in
a page's `sources:` frontmatter exists on disk; and no two wiki pages share the same `title`.
Wired into CI alongside lint/typecheck/test — see `.github/workflows/ci.yml`.

## How agents must maintain it

The enforced version of this section lives in root [`CLAUDE.md`](../CLAUDE.md) (read before
every non-trivial task) and is elaborated in
[`knowledge/wiki/engineering/development-workflow.md`](../knowledge/wiki/engineering/development-workflow.md).
Summary: read the index + search + read linked `/docs` + check the log _before_ editing
code; after a material change, decide whether durable knowledge changed, and if so add a raw
source, update wiki pages, fix cross-links, append to the log, and lint — all before
reporting the task done.
