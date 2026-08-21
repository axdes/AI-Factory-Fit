/**
 * Rebuild an installed gate after the project, or the team's mind, has moved.
 *
 * Three things live in a repository after `install`, and they answer to different
 * authorities:
 *
 *   conventions.json  what was MEASURED — regenerated freely, it is an artifact
 *   decisions.json    what the team DECIDED — never overwritten, it outranks the
 *                     measurement, because a team that settled a split does not
 *                     want the next scan reopening it
 *   baseline.json     what was FORGIVEN — carried across, minus the debt that has
 *                     since been paid, because losing it re-reddens work already
 *                     accepted and the gate gets switched off that afternoon
 *
 * The failure this exists to prevent is the one a plain reinstall causes: skip
 * the files and the rules never move, overwrite them and every accepted decision
 * is silently discarded. Neither is survivable on a client project.
 *
 * Debt is never quietly widened. A dimension that becomes enforced brings its
 * current violations in as debt and says how many; a dimension that stops being
 * enforced releases its debt and says so.
 *
 *   node scripts/update.mjs <repo> [--exclude ds,brand]           show the diff
 *   node scripts/update.mjs <repo> [--exclude ds,brand] --apply   write it
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIGNALS, STRONG, walk, scanSlot } from './lib/signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const apply = process.argv.includes('--apply')
const excludeArg = process.argv.indexOf('--exclude')
const excludeFlag = excludeArg === -1
  ? undefined
  : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/update.mjs <repo> [--exclude ds,brand] [--apply]')
  process.exit(2)
}

const dsDir = join(target, '.ds')
if (!existsSync(join(dsDir, 'conventions.json'))) {
  console.error(`update: nothing installed at ${relative(process.cwd(), dsDir)}. Run install first.`)
  process.exit(1)
}

const current = JSON.parse(readFileSync(join(dsDir, 'conventions.json'), 'utf8'))

// What to leave out is a property of the installation, not of whoever ran this.
//
// `install` records the exclusion list into conventions.json for a stated reason:
// so the tool and the installed gate measure the same files, because a number that
// changes with who ran it is not a number. This script — whose whole job is to
// keep those two in step — then read the list off its own command line and
// defaulted to nothing. Run it without the flag on a repository installed with
// `--exclude vendor` and the whole of vendor is measured: its files are taken on
// as debt under any new rule, and reported as regressions under the old ones,
// none of which the gate will ever look at.
//
// The flag still wins when it is given, because changing what is excluded is a
// real decision — it is just recorded rather than applied and forgotten.
const EXCLUDED = excludeFlag ?? current.excluded ?? []
const exclusionsChanged = excludeFlag !== undefined
  && JSON.stringify([...(current.excluded ?? [])].sort()) !== JSON.stringify([...excludeFlag].sort())

const name = scanSlot(target)
const scanPath = join(root, 'scans', name, 'scan.json')
if (!existsSync(scanPath)) {
  console.error(`update: no fresh measurement for "${name}". Run the scan first:`)
  console.error(`  node scripts/scan.mjs ${target}${EXCLUDED.length ? ` --exclude ${EXCLUDED.join(',')}` : ''}`)
  process.exit(1)
}

const scan = JSON.parse(readFileSync(scanPath, 'utf8'))
const currentBaseline = existsSync(join(dsDir, 'baseline.json'))
  ? JSON.parse(readFileSync(join(dsDir, 'baseline.json'), 'utf8'))
  : {}

// Decisions are the team's, and they are read, never written by this script.
const decisionsPath = join(dsDir, 'decisions.json')
const decisions = existsSync(decisionsPath) ? JSON.parse(readFileSync(decisionsPath, 'utf8')) : { _: 'Choices the team has made. These outrank the measurement and are never regenerated.', dimensions: {} }

// ── What the measurement says now, with decisions on top ──────────────────────

const proposed = {}
const documented = {}
const undecided = {}

for (const [dimension, entry] of Object.entries(scan.conventions)) {
  const decided = decisions.dimensions?.[dimension]
  if (decided) {
    proposed[dimension] = {
      expect: decided.expect,
      share: entry.distribution?.[decided.expect] !== undefined
        ? Number((entry.distribution[decided.expect] / entry.total).toFixed(3))
        : 0,
      source: `decided by the team on ${decided.on}${decided.why ? ` — ${decided.why}` : ''}`,
    }
    continue
  }

  const moved = (scan.drift ?? []).find(d => d.dimension === dimension && d.recent)
  const expect = moved?.recent ?? entry.dominant
  const recentEntry = scan.conventionsRecent?.[dimension]
  const share = moved ? (recentEntry?.share ?? entry.share) : entry.share

  // A dimension nobody has written enough of is not undecided by disagreement —
  // it is undecided by absence, and both belong in the same place: left alone.
  // Without this, one file declaring props became an enforced rule at "100%".
  //
  // The count travels into the contract for the same reason. `install` writes it and
  // this did not, so a gate refreshed here carried `"share": 1` with nothing behind
  // it — the client reads a rule at 100% and cannot tell whether that is a thousand
  // files agreeing or one, which is the whole question.
  if (entry.verdict === 'too few to say') {
    undecided[dimension] = {
      distribution: entry.distribution,
      why: `${entry.total} observation(s) — too few for a share to mean anything, so nothing is enforced here`,
    }
  } else if (entry.verdict === 'convention' || (moved && (recentEntry?.share ?? 0) >= STRONG)) {
    proposed[dimension] = { expect, share: Number(share.toFixed(3)), observations: entry.total, source: moved ? 'recent code' : 'whole repository' }
  } else if (entry.verdict === 'weak') {
    documented[dimension] = { leaning: expect, share: Number(share.toFixed(3)), observations: entry.total, distribution: entry.distribution }
  } else {
    undecided[dimension] = { distribution: entry.distribution }
  }
}

// ── The diff ──────────────────────────────────────────────────────────────────

const before = current.enforce ?? {}
const added = Object.keys(proposed).filter(d => !(d in before))
const removed = Object.keys(before).filter(d => !(d in proposed))
const changed = Object.keys(proposed)
  .filter(d => d in before && before[d].expect !== proposed[d].expect)
  .map(d => ({ dimension: d, from: before[d].expect, to: proposed[d].expect, source: proposed[d].source }))
const steady = Object.keys(proposed).filter(d => d in before && before[d].expect === proposed[d].expect)

// ── Baseline: carry, release, pay off, take on ────────────────────────────────

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const files = walk(target).filter(abs => !excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep)))

const violatesNow = {}
for (const abs of files) {
  let src
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  const rel = relative(target, abs).split(sep).join('/')
  for (const [dimension, rule] of Object.entries(proposed)) {
    const bucket = SIGNALS[dimension]?.(abs, src)
    if (!bucket || bucket === rule.expect) continue
    ;(violatesNow[dimension] ??= []).push(rel)
  }
}
for (const list of Object.values(violatesNow)) list.sort()

const nextBaseline = {}
const paidOff = []
const released = []
const takenOn = []

for (const [dimension, entries] of Object.entries(currentBaseline)) {
  if (!(dimension in proposed)) { released.push({ dimension, entries: entries.length }); continue }
  const stillViolating = entries.filter(file => (violatesNow[dimension] ?? []).includes(file))
  const paid = entries.length - stillViolating.length
  if (paid > 0) paidOff.push({ dimension, paid })
  if (stillViolating.length) nextBaseline[dimension] = stillViolating
}

for (const dimension of added) {
  const violations = violatesNow[dimension] ?? []
  if (!violations.length) continue
  nextBaseline[dimension] = violations
  takenOn.push({ dimension, entries: violations.length })
}

// A dimension whose expected value changed re-baselines against the new
// expectation: the old debt was measured against a rule that no longer exists.
for (const { dimension } of changed) {
  const violations = violatesNow[dimension] ?? []
  const previous = (currentBaseline[dimension] ?? []).length
  if (violations.length) nextBaseline[dimension] = violations
  else delete nextBaseline[dimension]
  // Nothing accepted and nothing replaced is not news. A report that lists a rule
  // whose debt went from zero to zero teaches the reader to skim the section that
  // matters.
  if (violations.length || previous) takenOn.push({ dimension, entries: violations.length, replacing: previous })
}

const newlyRed = Object.entries(violatesNow)
  .filter(([dimension]) => dimension in before && !added.includes(dimension) && !changed.some(c => c.dimension === dimension))
  .map(([dimension, list]) => ({
    dimension,
    files: list.filter(f => !(currentBaseline[dimension] ?? []).includes(f)),
  }))
  .filter(x => x.files.length)

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nupdate: ${target}`)
console.log(`enforced before ${Object.keys(before).length} → after ${Object.keys(proposed).length}`)
console.log(`excluded from measurement: ${EXCLUDED.length ? EXCLUDED.join(', ') : 'nothing'}${
  excludeFlag === undefined && EXCLUDED.length ? ' (as recorded at install)' : ''}`)
if (exclusionsChanged) {
  console.log(`  CHANGED from what was installed: ${(current.excluded ?? []).join(', ') || 'nothing'}`)
  console.log('  The gate will be rewritten to match, so it measures what this measured.')
}
if (Object.keys(decisions.dimensions ?? {}).length) {
  console.log(`team decisions in force: ${Object.keys(decisions.dimensions).join(', ')}`)
}
console.log('')

const say = (label, items, format) => {
  if (!items.length) return
  console.log(label)
  for (const item of items) console.log('  ' + format(item))
  console.log('')
}

say('NOW ENFORCED — the repository settled on these since the last update', added,
  d => `+ ${d}: ${proposed[d].expect} (${Math.round(proposed[d].share * 100)}%, from ${proposed[d].source})`)

say('NO LONGER ENFORCED — the repository came apart on these; their debt is released', removed,
  d => `- ${d}: was ${before[d].expect}`)

say('EXPECTATION CHANGED — new code is held to the new answer', changed,
  c => `~ ${c.dimension}: ${c.from} → ${c.to}  (${c.source})`)

say('DEBT PAID — accepted violations that no longer violate', paidOff,
  p => `✓ ${p.dimension}: ${p.paid} file(s) fixed`)

say('DEBT RELEASED — the rule went away, so its debt goes with it', released,
  r => `· ${r.dimension}: ${r.entries} entry(ies) dropped`)

say('DEBT TAKEN ON — new rules start from where the code is, not from zero', takenOn,
  t => `+ ${t.dimension}: ${t.entries} file(s) accepted${t.replacing !== undefined ? ` (replacing ${t.replacing} measured against the old rule)` : ''}`)

if (newlyRed.length) {
  console.log('REGRESSIONS — violations of a rule that did not change, outside the baseline.')
  console.log('These are not forgiven by an update; they are what the gate is for.')
  for (const r of newlyRed) console.log(`  ✗ ${r.dimension}: ${r.files.length} file(s), e.g. ${r.files[0]}`)
  console.log('')
}

if (!added.length && !removed.length && !changed.length && !paidOff.length && !takenOn.length) {
  console.log('Nothing moved. The installed rules still match the repository.\n')
}

console.log(`Steady: ${steady.length} dimension(s) unchanged.`)
console.log(`Left to the team: ${Object.keys(undecided).length} undecided, ${Object.keys(documented).length} leaning.`)

if (!apply) {
  console.log('\nPlan only — nothing was written. Add --apply to update the installed rules.')
  process.exit(0)
}

const conventionsOut = {
  ...current,
  generatedFrom: `AI FactoryFit scan of ${scan.scannedFiles} files`,
  mode: scan.mode,
  // Written back, not merely inherited: a --exclude passed here changes what the
  // gate must skip, and leaving the old list in place is how the two drift apart.
  excluded: EXCLUDED,
  enforce: proposed,
  documented,
  undecided,
}

mkdirSync(dsDir, { recursive: true })
writeFileSync(join(dsDir, 'conventions.json'), JSON.stringify(conventionsOut, null, 2) + '\n')
writeFileSync(join(dsDir, 'baseline.json'), JSON.stringify(nextBaseline, null, 2) + '\n')
if (!existsSync(decisionsPath)) {
  writeFileSync(decisionsPath, JSON.stringify(decisions, null, 2) + '\n')
}

const total = Object.values(nextBaseline).reduce((n, l) => n + l.length, 0)
console.log(`\nwrote .ds/conventions.json and .ds/baseline.json (${total} accepted violation(s)).`)
console.log('.ds/decisions.json was not touched: it is the team\'s file, not this tool\'s.')
