/**
 * The tool reading its own results the way a suspicious person reads them.
 *
 * Every defect found in this codebase was found the same way: by looking at a number
 * that had been produced and not believing it. A green zero over a private registry
 * nothing resolved from; a prop value carrying `$event.checked"`; a registry reported
 * 0% used because its components are named differently than expected; "NOT RUN:
 * undefined". None of them looked wrong in the output — that is what made them
 * survive — but each broke a rule that can be written down.
 *
 * So the rules are written down here and applied to everything the passes wrote.
 * This finds nothing new on its own; it finds the same class of thing again, on the
 * next project, without anybody having to sit and read.
 *
 * It is deliberately not a linter for the code. It reads artifacts, which is where
 * the failures actually land, and it makes no claim about what it cannot see.
 *
 *   node scripts/audit-output.mjs [slot]        one scan, or every scan
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ONLY = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined

/** Debris that means a value was cut out of source rather than read from it. */
const DEBRIS = /["`]|\$\{|\$event|=>|<\/|^\s*[{[(]|[)\]}]\s*$|\\$/
/** Content rather than vocabulary: a path, an address, a phrase. */
const CONTENT = /[\s/@]|:\/\//

const findings = []
// Kept apart from the findings on purpose. An artifact written before this tool
// stamped its rules is not wrong — it is unverifiable, and re-running it costs one
// command. Mixed into the list it would be 115 lines of noise over the four that
// mean something, and a report nobody finishes reading is a report that failed.
const stale = []
// Reported once per scan, not once per artifact: five files describing one deleted
// project is one fact about that project, not five findings.
const orphaned = new Set()
// Cross-pass rules run once per scan, not once per artifact.
const crossChecked = new Set()
// target → which artifacts claim it, per scan.
const subjects = new Map()
const note = (slot, file, what, detail) => findings.push({ slot, file, what, detail })

/**
 * A reason has to be a reason. `NOT RUN: undefined` was printed by a real pass, and
 * it is worse than no line: it says a check did not run and refuses to say why, so
 * nobody can tell whether it matters.
 */
const badReason = (why) => why === undefined || why === null
  || /^\s*$/.test(String(why)) || /undefined|null|\[object/i.test(String(why))

const rules = {
  /** Every artifact says which rules counted it. Otherwise it cannot go stale. */
  provenance(slot, file, doc) {
    if (doc.schemaVersion === undefined) return
    if (!doc.taken?.rules) stale.push(`${slot}/${file}`)
  },

  /**
   * An artifact whose subject is gone.
   *
   * The purest form of the stale-number hazard, and the one that already cost a real
   * search here: a stored scan described a project that had been deleted, and its
   * numbers read as current facts about code nobody could go and look at. It cannot
   * be verified and it cannot be refreshed; the only honest thing to do with it is
   * say so.
   */
  subject(slot, file, doc) {
    if (typeof doc.target !== 'string') return
    if (!existsSync(doc.target)) orphaned.add(slot)
    // Every artifact in a slot must be about the same directory. The slot is derived
    // to be stable wherever a repository sits, which is right for re-scanning one
    // project after it moves and wrong for two copies of it: a second checkout files
    // under the same name and its artifacts sit beside the first's. One formbricks
    // slot held five files describing three different directories, and a report
    // reading it combined all three as one measurement of one project.
    // Resolved, not compared as text. One pass records the target as given on the
    // command line and another records it absolute, so `tests/fixtures/unreadable`
    // and `/Users/…/tests/fixtures/unreadable` are one directory written two ways —
    // and the first version of this rule reported them as two.
    const key = resolve(doc.target)
    const seen = subjects.get(slot) ?? new Map()
    seen.set(key, [...(seen.get(key) ?? []), file])
    subjects.set(slot, seen)
  },

  /** A count is a number only when something was counted. */
  denominators(slot, file, doc) {
    const c = doc.considered
    if (c && typeof c === 'object') {
      const denominators = Object.values(c).filter(v => typeof v === 'number')
      // Only when NOTHING was looked at. The first version of this rule paired any
      // zero denominator with any positive count and reported `contrastCheckedPairs
      // reported while tokensDeclared is 0` — one pass measuring contrast against
      // its own denominator of 1, beside a dead-token check that correctly found
      // nothing to check. Which denominator belongs to which count is not knowable
      // from here, and guessing it is the same overreach this pass exists to catch.
      const nothingConsidered = denominators.length > 0 && denominators.every(v => v === 0)
      const counted = Object.entries(doc).filter(([k, v]) =>
        typeof v === 'number' && v > 0 && k !== 'schemaVersion').map(([k]) => k)
      if (nothingConsidered && counted.length) {
        note(slot, file, 'count over an empty denominator', `${counted.join(', ')} reported while every denominator in considered is 0`)
      }
    }
    if (doc.dependencies?.available && doc.dependencies.audited === 0) {
      note(slot, file, 'clean audit over nothing', 'dependencies.available is true with 0 dependencies audited')
    }
  },

  /** A refusal that refuses to say why. */
  reasons(slot, file, doc) {
    const seen = []
    const walk = (v, at) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`))
      if (v.available === false && badReason(v.why)) seen.push(at)
      if (v.ran === false && badReason(v.why)) seen.push(at)
      for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k)
    }
    walk(doc, '')
    for (const at of seen) note(slot, file, 'refusal with no reason', at || '(root)')
  },

  /** A measured value that was cut out of source rather than read from it. */
  values(slot, file, doc) {
    for (const [component, props] of Object.entries(doc.axes ?? {})) {
      for (const [prop, a] of Object.entries(props)) {
        for (const value of Object.keys(a.observed ?? {})) {
          if (DEBRIS.test(value)) note(slot, file, 'parse debris in a measured value', `${component}.${prop} = ${JSON.stringify(value)}`)
          else if (value.length > 32 || CONTENT.test(value)) note(slot, file, 'content in a measured value', `${component}.${prop} = ${JSON.stringify(value).slice(0, 60)}`)
        }
      }
    }
  },

  /**
   * A registry nothing calls. Sometimes true; more often the names being looked for
   * are not the names the codebase writes, which is how 616 Angular components
   * became zero.
   */
  reach(slot, file, doc) {
    if (!doc.considered?.registry) return
    const called = doc.considered.called ?? 0
    const unreachable = (doc.notMeasurableByTag ?? []).length
    if (called === 0 && doc.considered.registry - unreachable > 0) {
      note(slot, file, 'a registry nothing calls', `${doc.considered.registry} component(s), 0 found in ${doc.considered.files ?? '?'} file(s) — usually a naming mismatch, not an unused library`)
    }
  },

  /** A share outside its own bounds, or disagreeing with its counts. */
  shares(slot, file, doc) {
    const walk = (v, at) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`))
      if (typeof v.share === 'number' && (v.share < 0 || v.share > 1)) note(slot, file, 'share outside 0..1', `${at} = ${v.share}`)
      for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k)
    }
    walk(doc, '')
  },

  /**
   * A contract that enforces what the scan said could not be claimed.
   *
   * These are two artifacts and they have to agree. `too early to say — nothing is
   * claimed about the house style because nothing can be` sat one line above
   * `enforcing 3 convention(s)`, and the second one was what got written into the
   * client's gate.
   */
  agreement(slot, file, doc) {
    if (!doc.enforce || !doc.mode) return
    if (/^too early to say/.test(doc.mode) && Object.keys(doc.enforce).length) {
      note(slot, file, 'enforcing what the scan would not claim', `${Object.keys(doc.enforce).length} rule(s) under a mode that claims no house style`)
    }
  },

  /**
   * Two passes telling the same team opposite things about the same question.
   *
   * On formbricks the gate enforced `colour values → literal hex` at 95% while the
   * defects pass reported 20 literal values as a defect, in the same run. Both
   * numbers were correct and the pair was unusable: one measures what this project
   * does, the other measures it against a standard it has not adopted, and neither
   * said so.
   *
   * Checked across a scan rather than inside one artifact, because that is where
   * this kind of contradiction lives — no single file looks wrong.
   */
  crossPass(slot) {
    if (crossChecked.has(slot)) return
    crossChecked.add(slot)
    const at = (f) => join(root, 'scans', slot, f)
    let scan, defects
    try { scan = JSON.parse(readFileSync(at('scan.json'), 'utf8')) } catch { return }
    try { defects = JSON.parse(readFileSync(at('defects.json'), 'utf8')) } catch { return }
    const colour = scan.conventions?.['colour values']
    const literalIsTheirs = colour && colour.verdict === 'convention' && /literal/i.test(String(colour.dominant))
    const flagged = defects.counts?.hardcodedValues ?? (defects.hardcoded ?? []).length
    if (literalIsTheirs && flagged > 0) {
      note(slot, 'scan.json + defects.json', 'two passes disagreeing about the same question',
        `the convention is '${colour.dominant}' at ${Math.round(colour.share * 100)}% and ${flagged} literal value(s) are reported as a defect`)
    }
  },

  /** A claim about the project that carries no evidence for itself. */
  claims(slot, file, doc) {
    if (typeof doc.mode !== 'string') return
    if (/came apart/.test(doc.mode) && !/\d+ of \d+/.test(doc.mode)) {
      note(slot, file, 'a collapse claimed without a count', doc.mode.slice(0, 90))
    }
  },
}

const slots = ONLY ? [ONLY] : readdirSync(join(root, 'scans'))
  .filter(d => { try { return statSync(join(root, 'scans', d)).isDirectory() } catch { return false } })
  .filter(d => !d.startsWith('.'))

let read = 0
for (const slot of slots) {
  const dir = join(root, 'scans', slot)
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    let doc
    try { doc = JSON.parse(readFileSync(join(dir, file), 'utf8')) } catch {
      note(slot, file, 'unreadable artifact', 'this file is on disk and does not parse')
      continue
    }
    read += 1
    for (const rule of Object.values(rules)) rule(slot, file, doc)
  }
}

console.log(`\naudit-output: ${read} artifact(s) across ${slots.length} scan(s)\n`)

// Checked after everything is read, because it is a statement about a set of files
// rather than about any one of them.
for (const [slot, seen] of subjects) {
  if (seen.size < 2) continue
  note(slot, [...seen.values()].flat().join(', '), 'one scan describing more than one directory',
    [...seen.keys()].map(t => `${t}`).join('  ≠  '))
}

if (orphaned.size) {
  console.log(`  ${String(orphaned.size).padStart(4)}  scan(s) describe a directory that is no longer there`)
  console.log(`        ${[...orphaned].slice(0, 6).join(', ')}${orphaned.size > 6 ? `, and ${orphaned.size - 6} more` : ''}`)
  console.log('        Nothing can check these and nothing can refresh them; delete them or re-clone\n')
}

if (stale.length) {
  console.log(`  ${String(stale.length).padStart(4)}  artifact(s) predate rule fingerprinting — not wrong, unverifiable`)
  console.log(`        re-run the passes for these scans and they can be checked like the rest\n`)
}

if (!findings.length) {
  console.log('  Nothing here breaks a rule this tool has already been caught breaking.')
  console.log('  That is not the same as correct — it is the same as not wrong in any of')
  console.log(`  the ${Object.keys(rules).length} ways checked here.`)
  process.exit(0)
}

const byWhat = new Map()
for (const f of findings) byWhat.set(f.what, [...(byWhat.get(f.what) ?? []), f])
for (const [what, list] of [...byWhat].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}  ${what}`)
  for (const f of list.slice(0, 4)) console.log(`        ${f.slot}/${f.file} — ${f.detail}`)
  if (list.length > 4) console.log(`        … and ${list.length - 4} more`)
  console.log('')
}
console.log(`${findings.length} finding(s). Each one is a number somebody could act on.`)
process.exit(1)
