# AI FactoryFit — agent contract

Keep this file short. It is loaded on every turn of every session, so anything
substantial belongs in `README.md` or in the module comment beside the code.

This repository measures a codebase and installs a gate fitted to what it
measured. It brings no rules with it. Neither should you.

## Build and check

```sh
npm install
npm test          # node --test tests/detectors.test.mjs
npm run check     # the full gate: tests, evals, redteam, profile validation, lints
```

`npm run check` is what CI runs. Run it before proposing a change is done.

## House style, as the code already is

- ESM `.mjs` only. Node builtins imported with the `node:` prefix.
- **No semicolons.** Single quotes. Two-space indent. There is no formatter, and
  adding one is a change to 24k lines, not a cleanup.
- **British spelling** — `colour`, `behaviour`, `normalise`, `catalogue`,
  `recognise`. These appear in identifiers and JSON keys, not only in prose.
  Americanising them renames the public surface.
- Every module opens with a `/** */` block saying *why it exists*, anchored where
  possible to the real failure it was written to stop. Match that density.
- Tests are `node --test` with `node:assert/strict`. There is no vitest, jest or
  mocha here, and no test runner is to be added.
- Dependencies are deliberately few. Adding one needs a reason in the PR.

## The rule this was built under

Every detector's first version over-reports, and most of its errors are green
where nothing was checked. So:

- A new or changed detector ships with a **pinned regression test**, and most
  assert the **negative** direction — that the detector stays quiet about
  something correct.
- A check that was skipped is never reported as `PASS`. A comparison that could
  not run is never reported as `0 changed`. Record what could not be seen, so a
  zero is never mistaken for a clean bill of health.

A detector that finds real problems and also invents them is worse than none.

## What you must not do here

These are the mistakes agents actually make in this repository. Named, so they
can be pattern-matched against rather than reasoned about.

- **Do not write into a repository being measured.** `assess`, `scan`, `deep`,
  `ai-audit` and the rest are read-only. Only `install` writes, only under
  `--apply`, and only what was agreed.
- **Do not write `decisions.json`.** It is the team's file and outranks the
  measurement. The tool regenerates `conventions.json` and carries
  `baseline.json`; it never authors the third.
- **Do not add a catalogue or practice entry without a source.** The practice
  catalogue fails closed — an entry without one stops the build rather than
  shipping.
- **Do not commit `profiles/own`, or a stand-in for it.** It is extracted from a
  design system that is not ours to distribute. Blocks that measure against it
  stand down when it is absent and say so. Point them at `profiles/reference`.
- **Do not perform route registration.** It is printed, never performed.
- **Do not green a guarded step.** If `profiles/own` is absent the corpus and
  redteam did not run — they are unmeasured, not passing, and the output says so.

## Where things live

- `scripts/*.mjs` — one command each, named as in `package.json`.
- `scripts/lib/*.mjs` — shared detectors and emitters.
- `tests/detectors.test.mjs` + `tests/fixtures/` — the regression suite.
- `profiles/reference` — the published first-party profile, derived from
  radix-ui/themes (MIT).
- `scans/<name>/` — measurement output. Generated; not hand-edited.
- `catalogue/`, `practices/`, `rules/`, `config/` — data, each entry sourced.

`README.md` carries the long form: the arrival sequence, the three tiers, the
three files and their owners, and what this deliberately does not do.
