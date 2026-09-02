# knowledge/ — the LLM Wiki

Development infrastructure only — **never a runtime dependency of the mobile app.** Nothing
under this directory is imported by `app/` or `src/`.

Purpose: let Claude Code (or another coding agent) quickly retrieve product requirements,
approved decisions, architecture, domain rules, implementation history, known problems,
unresolved questions, and previously-failed approaches, without re-deriving them from
scratch or re-reading the entire `docs/` set every time.

- `raw/` — immutable source material (the original product brief, dated session records,
  external research). Never edit an existing raw file to reflect new information; add a new
  dated file instead.
- `wiki/` — synthesized, cross-linked, maintained pages. Start at
  [`wiki/index.md`](wiki/index.md). Every change is recorded, append-only, in
  [`wiki/log.md`](wiki/log.md).

Full design, maintenance workflow, and how this relates to `/docs`: see
[`docs/LLM_WIKI.md`](../docs/LLM_WIKI.md). Validate structure with `npm run wiki:lint`.
