/**
 * Record a baseline, compare against it later, and return the result to the
 * catalogue as evidence.
 *
 * This is the step that stops the catalogue being a radar with extra ceremony.
 * Rings are derived from evidence, and evidence typed in by hand is just opinion
 * with a date on it; measured evidence is what lets a technique demote itself.
 *
 * Attribution is by DECLARED EXPECTATION, not by proof. A technique states the
 * number it should move; if that number moved in the stated direction the
 * technique is credited. Several techniques can move one metric and other work
 * happens in parallel, so this is correlation with a stated hypothesis — good
 * enough to move a ring, not good enough to call causal, and the report says so.
 *
 * Two refusals keep it honest: nothing is recorded before the minimum interval,
 * because a measurement taken the same week proves nothing; and a technique with
 * no declared metric never receives an automatic verdict.
 *
 *   node scripts/measure.mjs <project> --baseline    record the starting point
 *   node scripts/measure.mjs <project>               compare against it
 *   node scripts/measure.mjs <project> --record      also write evidence back
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { taken, staleness, movedSince } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const project = process.argv[2]
const takeBaseline = process.argv.includes('--baseline')
const record = process.argv.includes('--record')

/** A measurement taken too soon reports movement that is noise, not effect. */
const MIN_INTERVAL_DAYS = 14

if (!project) {
  console.error('usage: node scripts/measure.mjs <project> [--baseline] [--record]')
  process.exit(2)
}

const scanDir = join(root, 'scans', project)
const scanPath = join(scanDir, 'scan.json')
const defectsPath = join(scanDir, 'defects.json')
const baselinePath = join(scanDir, 'baseline.json')

if (!existsSync(scanPath)) {
  console.error(`measure: no fingerprint for "${project}". Run scan and defects first.`)
  process.exit(1)
}

const fingerprint = JSON.parse(readFileSync(scanPath, 'utf8'))
if (existsSync(defectsPath)) fingerprint.defects = JSON.parse(readFileSync(defectsPath, 'utf8'))

const catalogue = JSON.parse(readFileSync(join(root, 'catalogue', 'techniques.json'), 'utf8'))

const valueAt = (path, source = fingerprint) =>
  path.split('/').reduce((node, key) => (node == null ? undefined : node[key]), source)

/** Everything worth watching, gathered in one shape so a diff is a diff. */
function snapshot() {
  const metrics = {}
  for (const [id, technique] of Object.entries(catalogue.techniques)) {
    if (!technique.moves) continue
    metrics[technique.moves.metric] = valueAt(technique.moves.metric)
  }
  const splits = Object.entries(fingerprint.conventions ?? {})
    .filter(([, c]) => c.verdict === 'split').length
  return {
    takenAt: new Date().toISOString().slice(0, 10),
    // Which rules produced these numbers. This is the artifact where it matters
    // most: a baseline is compared against a measurement taken a fortnight or more
    // later, and if the detectors moved in between, part of the "movement" belongs
    // to the tool rather than to the client's code. That difference is the whole
    // claim this pass exists to make.
    taken: taken(import.meta.url, fingerprint.target),
    mode: fingerprint.mode,
    scannedFiles: fingerprint.scannedFiles,
    mechanismsPresent: fingerprint.toolchain?.present?.length ?? 0,
    splitDimensions: splits,
    metrics,
  }
}

// ── Baseline ──────────────────────────────────────────────────────────────────

if (takeBaseline) {
  const installed = process.argv.includes('--installed')
    ? (process.argv[process.argv.indexOf('--installed') + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
    : []
  const baseline = { ...snapshot(), installed }
  mkdirSync(scanDir, { recursive: true })
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n')

  console.log(`\nmeasure: baseline recorded for ${project} on ${baseline.takenAt}`)
  console.log(`  mode                ${baseline.mode.split(' —')[0]}`)
  console.log(`  files               ${baseline.scannedFiles}`)
  console.log(`  mechanisms present  ${baseline.mechanismsPresent}`)
  console.log(`  undecided dimensions ${baseline.splitDimensions}`)
  for (const [metric, value] of Object.entries(baseline.metrics)) {
    console.log(`  ${metric.padEnd(34)} ${value ?? '—'}`)
  }
  if (installed.length) console.log(`  techniques installed: ${installed.join(', ')}`)
  else console.log('  no techniques recorded as installed — pass --installed a,b,c to attribute later movement')
  console.log(`\nCompare no earlier than ${MIN_INTERVAL_DAYS} days from now.`)
  process.exit(0)
}

// ── Compare ───────────────────────────────────────────────────────────────────

if (!existsSync(baselinePath)) {
  console.error(`measure: no baseline for "${project}". Record one first with --baseline.`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const now = snapshot()
const days = Math.round((Date.parse(now.takenAt) - Date.parse(baseline.takenAt)) / 86400000)

console.log(`\nmeasure: ${project}`)
console.log(`baseline ${baseline.takenAt} → now ${now.takenAt}  (${days} day(s))\n`)

// Named before any number is shown, because every row below is a subtraction
// between the two, and a reader who sees the arrows first has already drawn the
// conclusion by the time a caveat arrives.
const ruled = staleness(baseline.taken, pathToFileURL(join(here, 'measure.mjs')).href)
if (ruled) {
  console.log(`  ! ${ruled}`)
  console.log('    Part of any movement below belongs to this tool, not to the code.')
  console.log(`    Re-record the baseline to compare like with like.\n`)
}
const moved = movedSince(baseline.taken, fingerprint.target)
if (moved) console.log(`  · the code was measured against a different revision: ${moved}\n`)

const arrow = (delta) => delta === 0 ? '  =' : delta < 0 ? ' ↓ ' : ' ↑ '
const rows = []
for (const [metric, before] of Object.entries(baseline.metrics)) {
  const after = now.metrics[metric]
  if (before === undefined || after === undefined) {
    rows.push({ metric, before, after, delta: undefined })
    continue
  }
  rows.push({ metric, before, after, delta: after - before })
}

for (const row of rows) {
  const delta = row.delta === undefined ? 'not measured' : `${arrow(row.delta)}${Math.abs(row.delta)}`
  console.log(`  ${row.metric.padEnd(34)} ${String(row.before ?? '—').padStart(5)} → ${String(row.after ?? '—').padStart(5)}   ${delta}`)
}
console.log(`  ${'undecided dimensions'.padEnd(34)} ${String(baseline.splitDimensions).padStart(5)} → ${String(now.splitDimensions).padStart(5)}`)
console.log(`  ${'mechanisms present'.padEnd(34)} ${String(baseline.mechanismsPresent).padStart(5)} → ${String(now.mechanismsPresent).padStart(5)}`)

// ── Verdicts ──────────────────────────────────────────────────────────────────

const installed = baseline.installed ?? []
const verdicts = []
for (const id of installed) {
  const technique = catalogue.techniques[id]
  if (!technique) { verdicts.push({ id, verdict: undefined, note: 'not in the catalogue' }); continue }
  if (!technique.moves) { verdicts.push({ id, verdict: undefined, note: 'no declared metric; the outcome has to be judged by a person' }); continue }
  const row = rows.find(r => r.metric === technique.moves.metric)
  if (!row || row.delta === undefined) { verdicts.push({ id, verdict: undefined, note: `${technique.moves.metric} was not measured on both sides` }); continue }

  const improved = technique.moves.direction === 'down' ? row.delta < 0 : row.delta > 0
  verdicts.push({
    id,
    verdict: improved ? 'worked' : 'no-effect',
    outcome: `${technique.moves.metric} went ${row.before} → ${row.after} over ${days} day(s).`,
    note: improved ? undefined : row.delta === 0 ? 'unchanged' : 'moved the wrong way',
  })
}

if (installed.length === 0) {
  console.log('\nNo techniques were recorded as installed at baseline, so nothing can be attributed.')
} else {
  console.log('\nAttribution — by declared expectation, not by proof:')
  for (const v of verdicts) {
    console.log(`  ${(v.verdict ?? 'no verdict').padEnd(11)} ${v.id}${v.note ? `  — ${v.note}` : ''}`)
  }
  console.log('  Several techniques can move one metric and other work runs in parallel.')
  console.log('  This is correlation against a stated hypothesis: enough to move a ring, not to call causal.')
}

// ── Writing evidence back ─────────────────────────────────────────────────────

if (!record) {
  console.log('\nNothing written. Add --record to return these verdicts to the catalogue as evidence.')
  process.exit(0)
}

if (days < MIN_INTERVAL_DAYS) {
  console.error(`\nmeasure: REFUSING to record — ${days} day(s) since baseline, minimum is ${MIN_INTERVAL_DAYS}.`)
  console.error('Evidence from an interval this short is noise, and a catalogue that accepts it')
  console.error('stops being a record of what happened and becomes a record of what we ran.')
  process.exit(1)
}

const writable = verdicts.filter(v => v.verdict)
if (writable.length === 0) {
  console.log('\nNo automatic verdicts to record.')
  process.exit(0)
}

for (const v of writable) {
  catalogue.techniques[v.id].evidence.push({
    project, date: now.takenAt, verdict: v.verdict, outcome: v.outcome,
  })
}
writeFileSync(join(root, 'catalogue', 'techniques.json'), JSON.stringify(catalogue, null, 2) + '\n')
console.log(`\nrecorded ${writable.length} evidence entry(ies) into the catalogue.`)
console.log('Rings will be recomputed from it on the next fit.')
