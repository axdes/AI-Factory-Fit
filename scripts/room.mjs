/**
 * The scene, in one command.
 *
 * Everything else in this tool is for the people who build. This is for the room
 * where somebody decides — and the difference is not presentation, it is what is
 * on screen. A pipeline, a repository, a framework: each of those says the value
 * is in the artefact, and the artefact is the thing that just became cheap. What
 * survives is the number in the client's accounts.
 *
 * So the scene runs in this order and no other:
 *
 *   1  the two numbers, ASKED IN THE ROOM and typed in as the client says them.
 *      Not our estimate of their baseline. A consultancy that arrives with the
 *      client's own number already filled in has told the room it guessed.
 *   2  the work, on their traffic, with what the agent handled, handed back and
 *      got wrong.
 *   3  the movement, with the arithmetic shown and what it excludes named.
 *   4  what that means for how the work is paid for, which is the part nobody
 *      else in the room can say.
 *
 * The agent is NOT ours. `--agent` names whatever does the work — theirs, ours,
 * an API, a script. This owns the ledger and the refusals, and owning the ledger
 * is what makes an outcome contract possible: risk can only be shared on a number
 * both sides can audit.
 *
 *   ds room <dir> --agent "node agent.mjs" --work claims.jsonl
 *   ds room <dir> --rehearse            the same scene on a stand-in set
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
// The first argument that is not a flag. Taking `argv[2]` blindly made `ds room
// --rehearse` treat the flag as the directory, and the scene wrote its ledger into a
// folder called `--rehearse` — which is the shape a rehearsal is most often run in,
// with no directory given at all.
const target = process.argv.slice(2).find(a => !a.startsWith('-')) ?? (process.argv.includes('--rehearse') ? process.cwd() : undefined)
const AGENT = flag('agent')
const WORK = flag('work')
const REHEARSE = process.argv.includes('--rehearse')

if (!target) {
  console.error('usage: ds room <dir> --agent "<command>" --work <file>')
  console.error('       ds room <dir> --rehearse')
  process.exit(2)
}

const B = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m'
const rule = (t) => console.log(`\n${B}${t}${OFF}\n${'─'.repeat(t.length)}`)
const pause = () => console.log('')

mkdirSync(target, { recursive: true })

// ── 1. The two numbers ────────────────────────────────────────────────────────

rule('WHAT ARE YOU PAYING FOR TODAY')

console.log('Two questions. Both answers come from you, and nothing below works until')
console.log('they do — this will not estimate either of them.\n')

// The two numbers are typed in while the room watches. Without a terminal there
// is nobody to type them, and inventing them here would be the one thing this
// scene exists to refuse.
if (!REHEARSE && !process.stdin.isTTY) {
  console.error('  This scene asks two questions and takes the answers from the room.')
  console.error('  There is no terminal here to answer them, and this will not fill them in:')
  console.error('  a consultancy that arrives with the client\'s own number already entered has')
  console.error('  told the room it guessed.\n')
  console.error('  To rehearse it against a stand-in set:  ds room <dir> --rehearse')
  process.exit(2)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = async (q, why) => {
  console.log(`${DIM}${why}${OFF}`)
  const a = (await rl.question(`  ${q} `)).trim()
  console.log('')
  return a
}

let kpi, unit, baseline, source, volume, window, currency
if (REHEARSE) {
  // A rehearsal set, and labelled as one everywhere it appears. A stand-in
  // presented as a client's number is precisely the thing this scene refuses to
  // do, and doing it once in a rehearsal is how it reaches a room.
  ;({ kpi, unit, baseline, source, volume, window, currency } = {
    kpi: 'cost per claim, first notice of loss',
    unit: 'claim',
    baseline: '42.10',
    source: 'REHEARSAL STAND-IN — not a client figure',
    volume: '18400',
    window: 'per quarter',
    currency: 'EUR',
  })
  console.log(`${DIM}  rehearsal: the answers below are a stand-in, not anybody's actuals${OFF}`)
  console.log(`  ${kpi}: ${baseline} ${currency} per ${unit}, ${volume} ${unit}s ${window}\n`)
} else {
  kpi = await ask('What does one unit of this work cost you today, and what is the unit?',
    'The number a CFO already has. Not a rate card — what appears in the accounts.')
  unit = await ask('One of those is called a…?', 'A claim, a ticket, an order. The thing you count.')
  baseline = await ask(`How much, per ${unit}?`, '')
  currency = await ask('In what currency?', '')
  source = await ask('Which report does that come from?',
    'Written down because a business case is usually wrong at the baseline, and usually wrong in\nthe direction that flatters whoever wrote it.')
  volume = await ask(`How many ${unit}s, over what period?`, 'Movement in a rate means nothing without the count it applies to.')
  window = await ask('That period being?', '')
}
rl.close()

const declare = execFileSync(process.execPath, [
  join(here, 'outcome.mjs'), target,
  '--declare', kpi, '--unit', unit, '--baseline', String(baseline),
  '--source', source, '--currency', currency, '--volume', String(volume), '--window', window,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
console.log(declare.split('\n').filter(l => l.trim()).map(l => '  ' + l.trim()).join('\n'))

// ── 2. The work ───────────────────────────────────────────────────────────────

rule('WHAT A PERSON DOES WITH IT, AND WHAT DOES NOT NEED A PERSON')

const workFile = WORK ?? (REHEARSE ? join(root, 'samples', 'claims', 'intake.jsonl') : undefined)
const agentCommand = AGENT ?? (REHEARSE ? `${process.execPath} ${join(root, 'samples', 'claims', 'agent.mjs')}` : undefined)

if (!workFile || !existsSync(workFile)) {
  console.log('  No work to run. Point at a file of real records with --work.')
  console.log('  A scene that skips this step is a slide.')
  process.exit(1)
}
if (!agentCommand) {
  console.log('  No agent. --agent names whatever does the work — yours, ours, an API.')
  console.log('  This does not supply one: what does the work is your decision, and owning it')
  console.log('  here would make the measurement ours to flatter.')
  process.exit(1)
}

const records = readFileSync(workFile, 'utf8').split('\n').filter(l => l.trim())
console.log(`  ${records.length} record(s) from ${workFile.replace(root + '/', '')}`)
if (REHEARSE) console.log(`${DIM}  rehearsal set — synthetic records, no client data${OFF}`)
console.log(`  agent: ${agentCommand}\n`)

const started = Date.now()
let out
try {
  const [cmd, ...args] = agentCommand.split(' ')
  out = execFileSync(cmd, [...args, workFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (error) {
  console.error('  The agent failed. That is the run, and it is reported as one:')
  console.error('  ' + String(error.stdout ?? error.message).split('\n')[0])
  process.exit(1)
}

let run
try { run = JSON.parse(out) } catch {
  console.error('  The agent did not return counts this can read. It must print JSON with')
  console.error('  handled, escalated and wrong — a run that never counted its mistakes cannot')
  console.error('  be compared with a person who makes them.')
  process.exit(1)
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

const seen = (run.handled ?? 0) + (run.escalated ?? 0)
console.log(`  handled     ${String(run.handled).padStart(5)}  ${Math.round((run.handled / seen) * 100)}% of what came in`)
console.log(`  handed back ${String(run.escalated).padStart(5)}  went to a person, and is charged as one below`)
console.log(`  wrong       ${String(run.wrong).padStart(5)}  of the handled`)
console.log(`  ${DIM}in ${elapsed}s${OFF}`)

// How long the client's whole volume would take at the rate just measured.
//
// This exists because of what a rehearsal hides. The stand-in classifies by
// keyword and finishes a thousand records in a tenth of a second; an agent making
// a model call per record does not. Anybody planning a ten-minute room around a
// step that will take forty minutes on live traffic has planned the wrong room,
// and the only honest place to say so is beside the number that caused it.
const perSecond = records.length / Math.max(Number(elapsed), 0.001)
const projected = Number(volume) / perSecond
const spell = (seconds) => seconds < 90 ? `${Math.round(seconds)}s`
  : seconds < 5400 ? `${Math.round(seconds / 60)} min`
  : `${(seconds / 3600).toFixed(1)} hours`
console.log(`  ${DIM}${Math.round(perSecond)} ${unit}(s)/second — ${volume} would take ${spell(projected)} at this rate${OFF}`)
if (REHEARSE) {
  console.log(`  ${DIM}A stand-in classifying by keyword is not the rate of an agent making a${OFF}`)
  console.log(`  ${DIM}model call per ${unit}. Run yours before promising anybody a time.${OFF}`)
}

// ── 3. The movement ───────────────────────────────────────────────────────────

rule('WHAT MOVED')

const runFile = join(target, '.ds', 'run.json')
mkdirSync(dirname(runFile), { recursive: true })
writeFileSync(runFile, JSON.stringify({ ...run, window: `${records.length} records, ${elapsed}s` }, null, 2))

const movement = execFileSync(process.execPath, [join(here, 'outcome.mjs'), target, '--record', runFile],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
console.log(movement.split('\n').slice(movement.split('\n').findIndex(l => /MOVEMENT|NOT COMPUTED/.test(l)))
  .filter(l => !/^written to/.test(l)).join('\n'))

// ── 4. How it is paid for ─────────────────────────────────────────────────────

rule('SO HOW IS THIS PAID FOR')

console.log('  Three things just happened, and only the third is new.\n')
console.log('  The work is gone — a person no longer does the part the agent handled.')
console.log('  The output is cheap — whatever it produced could be produced again for pennies.')
console.log('  The number moved, and it moved by an amount both of us can audit: your baseline,')
console.log('  your volume, our run, and a list of what the figure leaves out.\n')
console.log('  That last part is what makes a different contract possible. Not a team for three')
console.log('  months at a rate — a share of a number, measured this way, with the exclusions')
console.log('  agreed in advance rather than argued afterwards.\n')
console.log(`  ${DIM}Nobody can offer that on a number they cannot prove they moved.${OFF}`)

if (REHEARSE) {
  console.log(`\n${DIM}  ── rehearsal ─────────────────────────────────────────────────────${OFF}`)
  console.log(`${DIM}  Every number above came from a stand-in set. In the room the first two${OFF}`)
  console.log(`${DIM}  are typed in as the client says them, and the rest is their traffic.${OFF}`)
}

// The room ends, and the page outlives it. Whoever has to repeat this number to
// somebody who was not here should be reading it, not remembering it.
console.log(`\n  ledger: ${join(target, '.ds', 'outcome.json')}`)
console.log(`  page:   ${join(target, '.ds', 'outcome.html')}  ${DIM}— open in a browser, send as an attachment${OFF}`)
