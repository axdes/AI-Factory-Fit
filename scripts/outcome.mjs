/**
 * The client's number, its baseline, and whether it moved.
 *
 * Everything else in this tool measures engineering and stops at the boundary of
 * the business it was for. That boundary is the whole argument: work and output
 * are what an agent makes cheap, so neither is what anybody can be paid for any
 * more. What is left is the number in the client's accounts, and nothing here
 * touched it.
 *
 * This is the ledger for that number, and it is built to REFUSE more than it
 * reports. A return-on-investment model that always produces a figure is a model
 * nobody in a finance conversation believes, and rightly: every one of them can
 * produce a figure. The only version worth putting in front of a CFO is one that
 * declines to compute when an input came from nowhere — because then the figures
 * it does produce mean something.
 *
 * Three things every claim needs, and none of them can be derived here:
 *
 *   baseline   what the number was before, and WHO said so. A baseline with no
 *              source is the single most common way an ROI case is wrong, and it
 *              is wrong in the direction that flatters whoever wrote it.
 *   unit       what one of the thing is — a claim, a ticket, an order. Movement
 *              in a rate means nothing without the count it applies to.
 *   volume     how many, over what window, measured rather than estimated.
 *
 * What CAN be measured here is what the agent actually did: how many it handled,
 * how many it escalated, how many it got wrong. Those are facts about a run. The
 * money is those facts multiplied by rates the client owns, and this says so
 * every time rather than quietly adopting them as its own.
 *
 *   ds outcome <repo> --declare "cost per claim" --unit claim --baseline 42.10 \
 *              --source "finance, FY26 Q1 actuals" --currency EUR --volume 18400
 *   ds outcome <repo> --record <run.json>     what an agent actually handled
 *   ds outcome <repo>                          the ledger, and what it refuses
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSlot } from './lib/signals.mjs'
import { outcomePage } from './lib/outcome-page.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const target = process.argv[2]
if (!target || !existsSync(target)) {
  console.error('usage: ds outcome <repo> [--declare "<kpi>" --unit <unit> --baseline <n> --source "<who>" --volume <n>]')
  process.exit(2)
}

const at = join(target, '.ds', 'outcome.json')
const load = () => {
  try { return JSON.parse(readFileSync(at, 'utf8')) } catch { return undefined }
}

// ── Declare ───────────────────────────────────────────────────────────────────

if (flag('declare')) {
  const baseline = flag('baseline')
  const source = flag('source')
  const unit = flag('unit')
  const volume = flag('volume')

  // Every one of these is refused rather than defaulted. A baseline with no named
  // source is the commonest way a business case is wrong, and it is wrong in the
  // direction that flatters whoever wrote it.
  const missing = []
  if (baseline === undefined || Number.isNaN(Number(baseline))) missing.push('--baseline, the number as it stands today')
  if (!source) missing.push('--source, WHO says that number and from which report')
  if (!unit) missing.push('--unit, what one of the thing is')
  if (volume === undefined || Number.isNaN(Number(volume))) missing.push('--volume, how many of them, over a stated window')
  if (missing.length) {
    console.error(`\noutcome: cannot declare "${flag('declare')}" without:`)
    for (const m of missing) console.error(`  · ${m}`)
    console.error('\nNothing here estimates a baseline. A number this tool invented would be the one')
    console.error('a client checks first, and finding it invented ends the conversation about all')
    console.error('the others.')
    process.exit(2)
  }

  const ledger = {
    schemaVersion: 1,
    taken: taken(import.meta.url, target),
    kpi: flag('declare'),
    unit,
    currency: flag('currency') ?? null,
    baseline: { value: Number(baseline), source, volume: Number(volume), window: flag('window') ?? 'not stated' },
    runs: load()?.runs ?? [],
    _: [
      'The client\'s number, not ours. Everything in this file came from the client or from a',
      'measured run; nothing in it was estimated here.',
      '',
      'The baseline carries its source because a business case is usually wrong at the baseline',
      'and usually wrong in the flattering direction. If the source is "somebody said in a',
      'workshop", write that — an honest weak baseline can be strengthened, an invented strong',
      'one cannot be defended.',
    ],
  }
  mkdirSync(dirname(at), { recursive: true })
  writeFileSync(at, JSON.stringify(ledger, null, 2) + '\n')
  console.log(`\noutcome: declared "${ledger.kpi}"`)
  console.log(`  baseline  ${ledger.baseline.value}${ledger.currency ? ' ' + ledger.currency : ''} per ${unit}, from ${source}`)
  console.log(`  volume    ${ledger.baseline.volume} ${unit}(s), ${ledger.baseline.window}`)
  console.log('\n  Nothing has moved yet. Record a run to compare against this.')
  process.exit(0)
}

// ── Record a run ──────────────────────────────────────────────────────────────

const ledger = load()
if (!ledger) {
  console.error('\noutcome: no KPI declared for this repository.')
  console.error('  ds outcome <repo> --declare "cost per claim" --unit claim --baseline <n> --source "<who>" --volume <n>')
  console.error('\nThe engineering measurements in this tool stop at the boundary of the business')
  console.error('they were for. Until somebody states the number on the other side, there is')
  console.error('nothing here to be paid on.')
  process.exit(1)
}

const RECORD = flag('record')
if (RECORD) {
  if (!existsSync(RECORD)) { console.error(`outcome: no run file at ${RECORD}`); process.exit(1) }
  let run
  try { run = JSON.parse(readFileSync(RECORD, 'utf8')) } catch (e) {
    console.error(`outcome: ${RECORD} does not parse: ${e.message}`)
    process.exit(1)
  }

  // What an agent did is the one half of this that IS a fact about a run, and it
  // is kept separate from the money for exactly that reason.
  const need = ['handled', 'escalated', 'wrong']
  const absent = need.filter(k => typeof run[k] !== 'number')
  if (absent.length) {
    console.error(`outcome: a run needs ${need.join(', ')} as counts. Missing or not numbers: ${absent.join(', ')}.`)
    console.error('\n`wrong` is not optional and not a rounding error: a run that never counted its')
    console.error('mistakes cannot be compared with a person who makes them, and the comparison is')
    console.error('the whole claim.')
    process.exit(2)
  }
  ledger.runs.push({
    handled: run.handled, escalated: run.escalated, wrong: run.wrong,
    window: run.window ?? 'not stated',
    costPerUnit: typeof run.costPerUnit === 'number' ? run.costPerUnit : null,
    costSource: run.costSource ?? null,
    note: run.note ?? null,
  })
  writeFileSync(at, JSON.stringify(ledger, null, 2) + '\n')
  console.log(`\noutcome: recorded a run of ${run.handled + run.escalated} ${ledger.unit}(s)`)
}

// ── Report ────────────────────────────────────────────────────────────────────

const latest = ledger.runs.at(-1)
const outDir = join(root, 'scans', scanSlot(target))
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'outcome.json'), JSON.stringify(ledger, null, 2) + '\n')

// The page for the person who was not in the room. Written at every exit below,
// including the ones that refuse to compute: a page that only appears when the
// figure is favourable is a page nobody should trust.
const finish = (code) => {
  const page = join(target, '.ds', 'outcome.html')
  writeFileSync(page, outcomePage(ledger))
  console.log(`\nwritten to ${join(target, '.ds', 'outcome.json')}`)
  console.log(`         and ${page} — the same ledger as one page`)
  process.exit(code)
}

console.log(`\noutcome: ${ledger.kpi}`)
console.log(`${ledger.baseline.volume} ${ledger.unit}(s) ${ledger.baseline.window}\n`)
console.log(`  baseline        ${ledger.baseline.value}${ledger.currency ? ' ' + ledger.currency : ''} per ${ledger.unit}`)
console.log(`  who says so     ${ledger.baseline.source}`)

if (!latest) {
  console.log('\n  NOT MEASURED — no run recorded, so nothing has moved.')
  console.log('  A number here now would be a forecast wearing a measurement\'s clothes.')
  finish(0)
}

const seen = latest.handled + latest.escalated
const autonomy = seen ? latest.handled / seen : 0
const errorRate = latest.handled ? latest.wrong / latest.handled : 0

console.log(`\n  RUN — ${seen} ${ledger.unit}(s), ${latest.window}`)
console.log(`  handled         ${latest.handled} (${Math.round(autonomy * 100)}%)`)
console.log(`  escalated       ${latest.escalated}`)
console.log(`  wrong           ${latest.wrong} of the handled (${(errorRate * 100).toFixed(1)}%)`)

if (latest.costPerUnit === null) {
  console.log('\n  MOVEMENT NOT COMPUTED')
  console.log('  The run measured what the agent did. What it costs per unit did not come with it,')
  console.log(`  and this will not estimate it: the difference between ${ledger.baseline.value} and a guess is`)
  console.log('  the entire number. Record the run with costPerUnit and costSource.')
  finish(0)
}

// The arithmetic, stated in full so it can be argued with. A model whose working
// is hidden is a model a CFO discounts to zero.
const blended = (latest.handled * latest.costPerUnit + latest.escalated * ledger.baseline.value) / seen
const perUnit = ledger.baseline.value - blended
const annualised = perUnit * ledger.baseline.volume

console.log(`\n  MOVEMENT`)
console.log(`  agent cost      ${latest.costPerUnit}${ledger.currency ? ' ' + ledger.currency : ''} per handled ${ledger.unit}, from ${latest.costSource ?? 'no source stated'}`)
console.log(`  blended         ${blended.toFixed(2)}${ledger.currency ? ' ' + ledger.currency : ''} per ${ledger.unit}`)
console.log(`     = (${latest.handled} × ${latest.costPerUnit} + ${latest.escalated} × ${ledger.baseline.value}) ÷ ${seen}`)
console.log(`  per ${ledger.unit.padEnd(11)} ${perUnit >= 0 ? '−' : '+'}${Math.abs(perUnit).toFixed(2)}${ledger.currency ? ' ' + ledger.currency : ''}`)
console.log(`  at ${ledger.baseline.volume} ${ledger.unit}(s)  ${annualised >= 0 ? '−' : '+'}${Math.abs(annualised).toFixed(0)}${ledger.currency ? ' ' + ledger.currency : ''}`)

console.log('\n  WHAT THIS FIGURE DOES NOT INCLUDE')
console.log(`  · The ${latest.wrong} wrong answer(s). What one costs is a number the client has and`)
console.log('    this does not, and at a high enough cost it reverses the whole case.')
console.log('  · Building and running the thing. This is the operating difference, not the return.')
console.log(`  · Whether ${seen} ${ledger.unit}(s) represent the rest. A run on the easy ones moves a`)
console.log('    number that a full population will not.')
if (!latest.costSource) {
  console.log('  · The agent cost carries no source, so it is somebody\'s estimate and the figure')
  console.log('    above inherits that.')
}
finish(0)
