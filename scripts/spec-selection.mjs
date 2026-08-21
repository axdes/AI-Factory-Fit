/**
 * Check that each zone's representation is one its declared task and data allow.
 *
 * validate-spec already rejects a screen that names a component or value the
 * library does not have. This asks the question one layer up: given what the zone
 * SAYS the user is doing (task) and what the data looks like (item, cardinality,
 * fields), is a table the right shape for it, or should it have been a list or
 * cards? The engine in scripts/lib/spec-rules.mjs computes the allowed set from
 * roles/selection-rules.json; this runs it.
 *
 * It self-tests first, with planted fixtures, because an engine that cannot REJECT
 * a cards-where-columns-belong zone is a hole, not a check — a green run that never
 * fails proves nothing. A wrong-representation fixture must be rejected and a right
 * one accepted before any real spec is judged; if the self-test breaks, the gate
 * goes red here and no spec is trusted.
 *
 * Existing harness specs predate the decision layer and declare no task, so they
 * are not judged — they are reported as undeclared, never failed. A zone only opts
 * in by adding `task` and `data` to itself.
 *
 *   node scripts/spec-selection.mjs                 self-test, then check specs/*.json
 *   node scripts/spec-selection.mjs specs/x.json    self-test, then check one spec
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRuleEngine } from './lib/spec-rules.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const rulesDoc = JSON.parse(readFileSync(join(root, 'roles', 'selection-rules.json'), 'utf8'))
const engine = makeRuleEngine(rulesDoc)

// ── Self-test: the planted fixtures ─────────────────────────────────────────────
//
// Two zones with identical facts — comparing eight-field records — and different
// representations. R1 says that job wants a table; the card version must be
// rejected and the table version accepted, or this check is theatre. A third
// fixture proves precedence: a card wrapping a table still reads as a table.

const FIXTURES = [
  {
    name: 'wrong representation is rejected',
    zone: {
      name: 'content',
      task: 'compare',
      data: { item: 'record', cardinality: 'many', fields: 8 },
      elements: ['card', 'statusTag'],
    },
    expect: 'reject',
  },
  {
    name: 'right representation is accepted',
    zone: {
      name: 'content',
      task: 'compare',
      data: { item: 'record', cardinality: 'many', fields: 8 },
      elements: ['table', 'statusTag'],
    },
    expect: 'accept',
  },
  {
    name: 'a card wrapping a table reads as a table (precedence)',
    zone: {
      name: 'content',
      task: 'compare',
      data: { item: 'record', cardinality: 'many', fields: 8 },
      elements: ['card', 'table'],
    },
    expect: 'accept',
  },
]

let selfFailed = 0
console.log('spec-selection self-test (the engine must be able to fail)\n')
for (const f of FIXTURES) {
  const { problems } = engine.checkZone(f.zone)
  const rejected = problems.length > 0
  const pass = f.expect === 'reject' ? rejected : !rejected
  if (!pass) selfFailed++
  console.log(`  ${pass ? '✓' : '✗'} ${f.name}`)
  if (!pass) {
    console.log(`      expected to ${f.expect}, but ${rejected ? 'rejected' : 'accepted'}`)
    for (const p of problems) console.log(`      · ${p}`)
  }
}
if (selfFailed) {
  console.error(`\n✗ selection engine self-test failed (${selfFailed}). The check is not trustworthy; stopping before judging any spec.`)
  process.exit(1)
}
console.log('  the engine rejects a wrong representation and accepts a right one.\n')

// ── The real specs ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const specPaths = args.length
  ? args
  : (existsSync(join(root, 'specs'))
      ? readdirSync(join(root, 'specs')).filter((f) => f.endsWith('.json')).map((f) => join(root, 'specs', f))
      : [])

let failed = 0
let undeclaredTotal = 0
for (const path of specPaths) {
  if (!existsSync(path)) {
    console.error(`  ✗ ${path} does not exist`)
    failed++
    continue
  }
  const spec = JSON.parse(readFileSync(path, 'utf8'))
  const problems = []
  const notes = []
  let undeclared = 0
  for (const zone of spec.zones ?? []) {
    const r = engine.checkZone(zone)
    problems.push(...r.problems)
    notes.push(...r.notes)
    if (r.undeclared) undeclared++
  }
  undeclaredTotal += undeclared

  const declared = (spec.zones ?? []).some((z) => z.task)
  const label = `${spec.id ?? path}`
  if (problems.length) {
    failed++
    console.log(`  ✗ ${label}`)
    for (const p of problems) console.log(`      ${p}`)
  } else if (declared) {
    console.log(`  ✓ ${label} — every declared zone uses a representation its task and data allow`)
  } else {
    console.log(`  · ${label} — no zone declares a task; nothing to judge (${undeclared} collection zone(s) undeclared)`)
  }
  for (const n of notes) console.log(`      note: ${n}`)
}

if (!specPaths.length) console.log('  (no specs found to check)')

if (failed) {
  console.error(`\n✗ ${failed} spec(s) name a representation their declared task and data do not allow.`)
  process.exit(1)
}
console.log(`\n✓ selection rules hold${undeclaredTotal ? ` (${undeclaredTotal} collection zone(s) declare no task yet — add task + data to have them checked)` : ''}.`)
