/**
 * The map of everything this repository can verify, written for a machine.
 *
 * The division of labour it exists to serve: code decides what is TRUE, and the
 * agent decides what to DO next. An agent that has to parse coloured prose to
 * learn whether the gate passed is doing the code's job badly; an agent told by
 * hand which script answers which question is briefed anew every session, and that
 * briefing goes stale the day a check is added.
 *
 * So this is generated, never written. Each check already opens with a comment
 * saying what it is for — that is this repository's own habit — and the first
 * sentence of that comment IS the description here. A check cannot drift away from
 * its entry, because the entry is the check's own words.
 *
 * Adapted from css's multi-package generator to harness, which is one package: the
 * output is flat (no `packages` nesting), and `inGate` is read straight from the
 * `check` script's chain rather than from a gates graph.
 *
 *   node scripts/gen-checks-manifest.mjs          write checks.json
 *   node scripts/gen-checks-manifest.mjs --check  fail if it is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const OUT = `${ROOT}/checks.json`
const check = process.argv.includes('--check')

/* A script that verifies something, as opposed to one that builds, drafts, serves
 * or measures. Harness names its verifiers consistently: the gate members (test,
 * eval, redteam, probe:own, validate), the spec validators, the lint:* checks that
 * hold the library to its own vocabulary, and the meta-checks that guard the
 * context budget and this manifest itself. A name that starts with one of these is
 * a check; ds, scan, draft, build:screen, adapt:* are not. */
const VERIFIES = /^(test|eval|redteam|probe|validate|spec|check|context|verify|lint)/

/** The first sentence of a file's leading comment: what the check is for. */
function purposeOf(file) {
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const m = /^(?:\/\*([\s\S]*?)\*\/|((?:\/\/[^\n]*\n)+))/.exec(src.trimStart())
  if (!m) return null
  const text = (m[1] ?? m[2] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\*|\/\/)\s?/, '').trim())
    .join(' ')
    .trim()
  /* Up to the first stop that ends a sentence — including `?` and `!`, because a
   * purpose here can be a question (eval opens with one) and stopping only at a
   * full stop would swallow the sentence after it. */
  const sentence = /^(.+?[.?!])(\s|$)/.exec(text)
  return (sentence ? sentence[1] : text).slice(0, 240) || null
}

/** The .mjs file a command runs — the last token ending in .mjs, resolved to
 * root. Handles both `node scripts/x.mjs` and `node --test tests/y.test.mjs`. */
function scriptFile(command) {
  const m = [...command.matchAll(/([^\s]+\.mjs)/g)].pop()
  if (!m) return null
  const rel = m[1]
  const p = rel.startsWith('/') ? rel : `${ROOT}/${rel}`
  return p.replace(/\/\.\//g, '/')
}

const pj = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8'))
const scripts = pj.scripts ?? {}
const gate = scripts.check ?? ''

/* What the gate actually runs. `check` chains its members with `&&`, some as
 * `npm run X`, one as the bare `npm test`. Hyphens and colons count: probe:own
 * and checks:manifest are script names, so the pattern allows [\w:-]. */
const inGate = new Set([
  ...[...gate.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]),
  ...(/\bnpm test\b/.test(gate) ? ['test'] : []),
])

const checks = {}
for (const [name, command] of Object.entries(scripts)) {
  if (!VERIFIES.test(name)) continue
  const file = scriptFile(command)
  /* What KIND of thing it is, so "not in the gate" means something. `check` is the
   * gate's own entry point, not a check that runs inside it. */
  const kind = name === 'check'
    ? 'gate'
    : inGate.has(name)
      ? 'gated'
      : 'manual'
  checks[name] = {
    command: name === 'test' ? command : `npm run ${name}`,
    kind,
    inGate: inGate.has(name),
    answers: file ? purposeOf(file) : null,
  }
}

const manifest = {
  _generated: 'node scripts/gen-checks-manifest.mjs',
  gate: gate ? 'npm run check' : null,
  checks,
}

const json = JSON.stringify(manifest, null, 2) + '\n'

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== json) {
    console.error('\x1b[31m✗ checks.json is out of date.\x1b[0m Run `npm run checks:manifest`.')
    process.exit(1)
  }
  console.log(`\x1b[32m✓ checks.json matches the repository\x1b[0m (${Object.keys(checks).length} checks)`)
} else {
  writeFileSync(OUT, json)
  const all = Object.values(checks)
  const gated = all.filter((c) => c.kind === 'gated').length
  const manual = all.filter((c) => c.kind === 'manual')
  console.log(`\x1b[32m✓\x1b[0m checks.json written: ${gated} gated, ${manual.length} run by hand`)
  if (manual.length) {
    console.log(`\x1b[2m  by hand: ${[...new Set(manual.map((c) => c.command.replace('npm run ', '')))].sort().join(' ')}\x1b[0m`)
    console.log('\x1b[2m  Each is either a validator you point at a file (spec) or a meta-check run\x1b[0m')
    console.log('\x1b[2m  on demand. A new name here that answers nothing is a capability nobody runs.\x1b[0m')
  }
}
