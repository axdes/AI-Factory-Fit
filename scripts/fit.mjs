/**
 * Match a project fingerprint against the technique catalogue.
 *
 * This is the step that turns a catalogue into a recommendation. A radar tells
 * you what an industry thinks; this tells you what applies HERE, because every
 * technique carries a condition that is evaluated against what the scan actually
 * measured in this repository.
 *
 * Rings are derived, never declared. A technique's confidence comes from the
 * evidence recorded against it and nowhere else, so the catalogue cannot claim
 * a certainty it has not earned — and a technique that stops working demotes
 * itself the next time a measurement comes back.
 *
 * The output is a proposal for a person to take to a client, not an install
 * plan that runs itself. What gets adopted is the client's decision; refusals
 * are worth recording, because five in a row say the technique is badly argued.
 *
 *   node scripts/fit.mjs <project>                      the proposal
 *   node scripts/fit.mjs <project> --json               machine-readable
 *   node scripts/fit.mjs <project> --select a,b,c       record what the client chose
 *   node scripts/fit.mjs <project> --reject id:reason   record what they turned down
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const project = process.argv[2]
const asJson = process.argv.includes('--json')
const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const SELECT = (flag('--select') ?? '').split(',').map(x => x.trim()).filter(Boolean)
// One refusal per invocation, because the reason is prose and prose contains
// commas. Splitting the flag on them turned "no runner with a browser, and
// nobody would review the images" into two technique names.
const REJECT = flag('--reject') ? [flag('--reject')] : []

if (!project) {
  console.error('usage: node scripts/fit.mjs <project> [--json]')
  process.exit(2)
}

const scanPath = join(root, 'scans', project, 'scan.json')
if (!existsSync(scanPath)) {
  console.error(`fit: no fingerprint for "${project}". Run the scan first.`)
  process.exit(1)
}

const fingerprint = JSON.parse(readFileSync(scanPath, 'utf8'))

// The agent-readiness audit joins it under `ai/`. Engineering and agent readiness
// are different axes: a project can have a faultless test suite and be illegible
// to every agent its team runs.
const aiPath = join(root, 'scans', project, 'ai-audit.json')
if (existsSync(aiPath)) fingerprint.ai = JSON.parse(readFileSync(aiPath, 'utf8'))

// Deep analysis joins it under `deep/`, so a technique can key off a cycle count.
const deepPath = join(root, 'scans', project, 'deep.json')
if (existsSync(deepPath)) fingerprint.deep = JSON.parse(readFileSync(deepPath, 'utf8'))

// Defect counts join the fingerprint under `defects/` when they have been
// measured. A technique may key off them, so "propose a contrast gate" becomes a
// consequence of finding failing pairs rather than of a checklist.
const defectsPath = join(root, 'scans', project, 'defects.json')
if (existsSync(defectsPath)) fingerprint.defects = JSON.parse(readFileSync(defectsPath, 'utf8'))

// Security joins under `security/`. Adding the pass without adding it here meant
// a technique keyed on advisories could never fire — the catalogue would hold a
// rule about a measurement the matcher could not see, which is worse than not
// having the rule, because it looks present.
const securityPath = join(root, 'scans', project, 'security.json')
if (existsSync(securityPath)) fingerprint.security = JSON.parse(readFileSync(securityPath, 'utf8'))
const catalogue = JSON.parse(readFileSync(join(root, 'catalogue', 'techniques.json'), 'utf8'))

/** Every form the matcher understands. Anything else is a typo, not a rule. */
const PREDICATE_KEYS = new Set(['path', 'contains', 'equals', 'startsWith', 'gte', 'lt', 'anyOf', 'allOf', 'not'])
const predicateProblems = (p, at) => {
  if (p.anyOf) return p.anyOf.flatMap(q => predicateProblems(q, at))
  if (p.allOf) return p.allOf.flatMap(q => predicateProblems(q, at))
  if (p.not) return predicateProblems(p.not, at)
  const unknown = Object.keys(p).filter(k => !PREDICATE_KEYS.has(k))
  const problems = unknown.map(k => `${at}: unknown predicate key "${k}" — the matcher would silently never apply this`)
  if (!('path' in p)) problems.push(`${at}: a predicate with no path`)
  const ops = Object.keys(p).filter(k => k !== 'path')
  if (!ops.length) problems.push(`${at}: a predicate that tests nothing`)
  return problems
}

// ── Catalogue validation, fail-closed ─────────────────────────────────────────
// A technique that cannot say when it applies is a preference. A technique that
// cannot name what it prevents is a fashion. Neither is admitted.

const VERDICTS = new Set(['worked', 'no-effect', 'rejected', 'gap-observed'])
const invalid = []
for (const [id, t] of Object.entries(catalogue.techniques)) {
  if (!t.what) invalid.push(`${id}: no description`)
  if (!t.prevents) invalid.push(`${id}: does not name the failure it prevents`)
  for (const p of t.appliesWhen ?? []) invalid.push(...predicateProblems(p, id))
  if (!Array.isArray(t.appliesWhen) || t.appliesWhen.length === 0) invalid.push(`${id}: no applicability condition`)
  if (!t.cost?.install) invalid.push(`${id}: no install cost`)
  if (!t.enforcedBy) invalid.push(`${id}: names no mechanism that holds it`)
  if ('ring' in t) invalid.push(`${id}: declares a ring; rings are derived from evidence, never asserted`)
  for (const e of t.evidence ?? []) {
    if (!VERDICTS.has(e.verdict)) invalid.push(`${id}: unknown verdict "${e.verdict}"`)
    if (!e.outcome) invalid.push(`${id}: an evidence entry with no outcome`)
  }
  for (const need of t.requires ?? []) {
    if (!catalogue.techniques[need]) invalid.push(`${id}: requires "${need}", which is not in the catalogue`)
  }
}
if (invalid.length) {
  console.error(`fit: the catalogue is invalid — ${invalid.length} problem(s):`)
  for (const problem of invalid) console.error('  ✗ ' + problem)
  process.exit(1)
}

// ── Derived ring ──────────────────────────────────────────────────────────────

// Counted in PROJECTS, not in observations.
//
// This counted rows, so running the same technique twice against the same
// repository promoted it to `adopt` — "it worked here, and it worked here again"
// read as two independent results when it is one. The whole claim a ring makes is
// that a technique carried across to somewhere else; a second run on the same code
// is the one thing that cannot show that.
//
// The same correction applies in the other direction: two disappointments in one
// project should not put a technique on hold for every other project either.
function ringOf(technique) {
  const evidence = technique.evidence ?? []
  const projects = (verdict) => new Set(evidence.filter(e => e.verdict === verdict).map(e => e.project ?? '(unnamed)')).size
  const worked = projects('worked')
  const none = projects('no-effect')
  const refused = projects('rejected')

  if (none >= 2 || refused >= 3) return 'hold'
  if (worked >= 2 && none === 0) return 'adopt'
  if (worked >= 1) return 'trial'
  return 'assess'
}

// How old the evidence behind a ring is, and from how many places.
//
// Every observation carries a date and nothing read it, so a ring could only
// ratchet toward `adopt` and never come back: a technique proven twice in 2024, on
// a stack nobody runs now, would sit at `adopt` forever with nothing on screen to
// suggest otherwise. No decay rule is invented here — inventing a half-life for
// somebody else's evidence is exactly the kind of policy this tool refuses to
// assert. What it does instead is show the age, so a stale ring is visible to the
// person who can judge it.
function provenance(technique) {
  const evidence = technique.evidence ?? []
  if (!evidence.length) return undefined
  const dates = evidence.map(e => e.date).filter(Boolean).sort()
  return {
    projects: new Set(evidence.map(e => e.project ?? '(unnamed)')).size,
    observations: evidence.length,
    from: dates[0],
    to: dates.at(-1),
    undated: evidence.length - dates.length,
  }
}

const RING_ORDER = { adopt: 0, trial: 1, assess: 2, hold: 3 }

// ── Predicates over the fingerprint ───────────────────────────────────────────
// `/` separates path segments because measured dimensions have spaces in their
// names ("internal imports"), and a dot would split them in the wrong place.

function valueAt(path) {
  return path.split('/').reduce((node, key) => (node == null ? undefined : node[key]), fingerprint)
}

function evaluate(predicate) {
  if (predicate.anyOf) return predicate.anyOf.some(evaluate)
  if (predicate.allOf) return predicate.allOf.every(evaluate)
  if (predicate.not) return !evaluate(predicate.not)

  const actual = valueAt(predicate.path)
  if ('contains' in predicate) return Array.isArray(actual) && actual.includes(predicate.contains)
  if ('equals' in predicate) return actual === predicate.equals
  if ('startsWith' in predicate) return typeof actual === 'string' && actual.startsWith(predicate.startsWith)
  if ('gte' in predicate) return typeof actual === 'number' && actual >= predicate.gte
  if ('lt' in predicate) return typeof actual === 'number' && actual < predicate.lt
  // Unreachable: the catalogue is validated before anything is evaluated. Left
  // as a guard rather than a fallback, because returning false for a predicate
  // nobody understands is how a technique stops applying without anyone noticing.
  throw new Error(`fit: unknown predicate ${JSON.stringify(predicate)}`)
}


/** Which of a technique's conditions matched — the reason shown to the client. */
function why(technique) {
  const reasons = []
  const describe = (p) => {
    if (p.anyOf) return p.anyOf.filter(evaluate).map(describe).join('; ')
    if (p.not) return `not ${describe(p.not)}`
    const actual = valueAt(p.path)
    if ('contains' in p) return `${p.path} includes "${p.contains}"`
    if ('equals' in p) return `${p.path} is "${actual}"`
    if ('startsWith' in p) return `${p.path} is "${String(actual).split(' —')[0]}"`
    if ('gte' in p) return `${p.path} is ${actual}`
    if ('lt' in p) return `${p.path} is ${actual}`
    return p.path
  }
  for (const p of technique.appliesWhen) if (evaluate(p)) reasons.push(describe(p))
  return reasons
}

// ── Match ─────────────────────────────────────────────────────────────────────

// A technique whose mechanism the project already carries is not work to
// propose. Recommending three-tier tokens to a repository measured at 95% token
// coverage is how a proposal loses the room in its first minute.
const present = new Set(fingerprint.toolchain?.present ?? [])
const satisfied = (technique) => Boolean(technique.mechanism) && present.has(technique.mechanism)

const alreadyInPlace = []
const applicable = new Map()
for (const [id, technique] of Object.entries(catalogue.techniques)) {
  if (satisfied(technique)) { alreadyInPlace.push(id); continue }
  if (!technique.appliesWhen.some(evaluate)) continue
  applicable.set(id, { id, technique, ring: ringOf(technique), reasons: why(technique), pulledInBy: undefined })
}

// A prerequisite of something applicable is itself required, whether or not its
// own condition fired. Recommending a screen-spec gate without the registry it
// reads would be recommending a step that cannot run.
let added = true
while (added) {
  added = false
  for (const entry of [...applicable.values()]) {
    for (const need of entry.technique.requires ?? []) {
      if (applicable.has(need)) continue
      const technique = catalogue.techniques[need]
      // A prerequisite the project already satisfies is a met precondition, not
      // a step. It is reported as met and never proposed as work.
      if (satisfied(technique)) continue
      applicable.set(need, {
        id: need, technique, ring: ringOf(technique), reasons: [], pulledInBy: entry.id,
      })
      added = true
    }
  }
}

// Order: prerequisites before what needs them, then by earned confidence.
const ordered = []
const placed = new Set()
const place = (entry) => {
  if (placed.has(entry.id)) return
  placed.add(entry.id)
  for (const need of entry.technique.requires ?? []) {
    if (applicable.has(need)) place(applicable.get(need))
  }
  ordered.push(entry)
}
for (const entry of [...applicable.values()].sort((a, b) => RING_ORDER[a.ring] - RING_ORDER[b.ring])) place(entry)

const proposed = ordered.filter(e => e.ring !== 'hold')
const held = ordered.filter(e => e.ring === 'hold')

if (asJson) {
  console.log(JSON.stringify({
    project, mode: fingerprint.mode,
    proposed: proposed.map(e => ({ id: e.id, ring: e.ring, reasons: e.reasons, pulledInBy: e.pulledInBy, cost: e.technique.cost })),
    held: held.map(e => e.id),
  }, null, 2))
  process.exit(0)
}


// ── Recording the decision ────────────────────────────────────────────────────
//
// A proposal nobody answered is a document. What the client picked has to reach
// `install`, or the choice changes nothing — and what they turned down has to be
// written somewhere, because a technique refused five times is either badly
// argued or too expensive, and that is worth knowing before the sixth pitch.

if (SELECT.length || REJECT.length) {
  const known = new Set(Object.keys(catalogue.techniques))
  const unknown = [...SELECT, ...REJECT.map(r => r.split(':')[0])].filter(id => !known.has(id))
  if (unknown.length) {
    console.error(`fit: not in the catalogue: ${unknown.join(', ')}`)
    process.exit(1)
  }

  // A chosen technique brings its prerequisites, or it cannot run.
  const chosenTechniques = new Set(SELECT)
  let grew = true
  while (grew) {
    grew = false
    for (const id of [...chosenTechniques]) {
      for (const need of catalogue.techniques[id].requires ?? []) {
        if (!chosenTechniques.has(need)) { chosenTechniques.add(need); grew = true }
      }
    }
  }
  const pulledIn = [...chosenTechniques].filter(id => !SELECT.includes(id))

  const plan = {
    schemaVersion: 1,
    project,
    decidedOn: new Date().toISOString().slice(0, 10),
    selected: [...chosenTechniques],
    pulledInAsPrerequisites: pulledIn,
    installs: [...new Set([...chosenTechniques].flatMap(id => catalogue.techniques[id].installs ?? []))],
    rejected: REJECT.map(entry => {
      const [id, ...reason] = entry.split(':')
      return { id, reason: reason.join(':').trim() || 'no reason recorded' }
    }),
  }
  writeFileSync(join(root, 'scans', project, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')

  // A refusal is evidence about the technique, not about the client.
  if (plan.rejected.length) {
    for (const r of plan.rejected) {
      catalogue.techniques[r.id].evidence.push({
        project, date: plan.decidedOn, verdict: 'rejected', outcome: r.reason,
      })
    }
    writeFileSync(join(root, 'catalogue', 'techniques.json'), JSON.stringify(catalogue, null, 2) + '\n')
  }

  console.log(`\nfit: recorded the decision for ${project}`)
  console.log(`  selected      ${SELECT.join(', ') || 'none'}`)
  if (pulledIn.length) console.log(`  prerequisites ${pulledIn.join(', ')}`)
  if (plan.rejected.length) {
    console.log(`  rejected      ${plan.rejected.map(r => `${r.id} — ${r.reason}`).join('; ')}`)
    console.log('                recorded as evidence; three refusals move a technique to hold')
  }
  console.log(`  installs      ${plan.installs.length} artifact(s)`)

  // Agreeing to seven and receiving five is the same broken negotiation as
  // agreeing to three and receiving twelve, and only one of the two directions
  // was guarded. A technique that writes no file is not a technique that failed —
  // some are commands and some are gate stages — but the client has to be told
  // which of the things they agreed to will not appear on disk.
  const noArtifact = [...chosenTechniques].filter(id => !(catalogue.techniques[id].installs ?? []).length)
  if (noArtifact.length) {
    console.log(`\n  ${noArtifact.length} agreed technique(s) write no file:`)
    for (const id of noArtifact) {
      console.log(`    ${id.padEnd(22)} ${catalogue.techniques[id].deliveredBy ?? 'nothing in the catalogue says how this is delivered'}`)
    }
  }
  console.log('\nnode scripts/install.mjs <repo> --plan --profile <id>')
  process.exit(0)
}

// ── Proposal ──────────────────────────────────────────────────────────────────

const badge = { adopt: 'ADOPT ', trial: 'TRIAL ', assess: 'ASSESS', hold: 'HOLD  ' }

console.log(`\nfit: ${project}`)
console.log(`situation: ${fingerprint.mode}`)
console.log(`fingerprint: ${fingerprint.scannedFiles} files · ${fingerprint.toolchain.present.length}/${fingerprint.toolchain.present.length + fingerprint.toolchain.missing.length} mechanisms present`)
console.log(`\n${proposed.length} technique(s) apply here, in the order they can be installed:\n`)

let step = 0
for (const entry of proposed) {
  step += 1
  const t = entry.technique
  console.log(`${String(step).padStart(2)}. [${badge[entry.ring]}] ${t.name}`)
  console.log(`    ${t.what}`)
  console.log(`    prevents: ${t.prevents}`)
  if (entry.reasons.length) {
    console.log(`    applies because: ${entry.reasons.join('; ')}`)
  } else {
    console.log(`    applies because: required by ${entry.pulledInBy}`)
  }
  console.log(`    cost: ${t.cost.install}${t.cost.ongoing ? ` · ongoing: ${t.cost.ongoing}` : ''}`)
  if (t.standard && t.standard !== 'none') console.log(`    standard: ${t.standard}`)
  // The age of the evidence, shown rather than acted on. Nothing here decides when
  // a result has gone stale — that is a judgement about somebody else's stack — but
  // a ring resting on a single old week should not look the same as one resting on
  // a year of work.
  const age = provenance(t)
  if (age) {
    console.log(`    ring earned on: ${age.observations} observation(s) across ${age.projects} project(s)`
      + (age.from ? `, ${age.from === age.to ? age.from : `${age.from} to ${age.to}`}` : '')
      + (age.undated ? `, ${age.undated} undated` : ''))
  }
  const worked = (t.evidence ?? []).filter(e => e.verdict === 'worked')
  const gaps = (t.evidence ?? []).filter(e => e.verdict === 'gap-observed')
  if (worked.length) {
    const places = [...new Set(worked.map(e => e.project))]
    // Named as distinct places, because that is what the ring was earned on. The
    // count of rows would read as more corroboration than there is.
    console.log(`    evidence: worked on ${places.join(', ')} (${places.length} project${places.length === 1 ? '' : 's'})`)
  }
  else if (gaps.length) console.log(`    evidence: absence measured causing a problem on ${gaps.map(e => e.project).join(', ')}; not yet delivered by us`)
  else console.log('    evidence: none yet — this would be the first time')
  console.log('')
}

if (held.length) {
  console.log(`Held back (${held.length}): ${held.map(e => e.id).join(', ')}`)
  console.log('Evidence says these did not work or were repeatedly refused.\n')
}

if (alreadyInPlace.length) {
  console.log(`Already in place (${alreadyInPlace.length}), so not proposed as work:`)
  console.log(`  ${alreadyInPlace.join(', ')}\n`)
}

const notApplicable = Object.keys(catalogue.techniques).length - ordered.length - alreadyInPlace.length
console.log(`${notApplicable} technique(s) in the catalogue do not apply to this project and are not proposed.`)
