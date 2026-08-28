# AI FactoryFit — Copilot instructions

`AGENTS.md` at the repository root is the contract. Read it before proposing a
change; this file carries only the rules that must survive being concatenated
with other instruction files in an order nobody controls.

- **ESM `.mjs`, no semicolons, single quotes, two-space indent.** There is no
  formatter, and adding one is a change to 24k lines.
- **British spelling** — `colour`, `behaviour`, `normalise`, `catalogue`. These
  appear in identifiers and JSON keys, so Americanising them renames the public
  surface.
- **Tests are `node --test` with `node:assert/strict`.** No vitest, no jest, and
  no test runner is to be added.
- **A new or changed detector ships with a pinned regression test**, and most
  assert the negative direction — that the detector stays quiet about something
  correct. Every detector's first version over-reports.
- **A skipped check is never reported as `PASS`,** and a comparison that could
  not run is never reported as `0 changed`. Record what could not be seen.
- **The measurement commands are read-only.** `assess`, `scan`, `deep` and
  `ai-audit` never write into the repository they are pointed at. Only `install`
  writes, only under `--apply`, and only what was agreed.

Run `npm run check` before calling a change done — it is what CI runs.

Everything else — where files live, what `decisions.json` is for, why
`profiles/own` is not committed — is in `AGENTS.md`.
