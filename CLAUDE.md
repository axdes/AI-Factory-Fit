@AGENTS.md

## Claude Code

Claude Code reads this file, not `AGENTS.md`. The bare `@` import above expands
that file into context at launch — a markdown link would be inert text.

- Run `npm run check` before calling a change done. It is the same gate CI runs.
- Prefer `node --test tests/detectors.test.mjs` while iterating on one detector.
- `scans/` is generated output. Do not hand-edit it, and do not commit a scan
  taken during a debugging session.
