/**
 * Which files in this project are worth copying, and which are not.
 *
 * "Build it the way it is already built here" is the right instruction and a
 * dangerous one, because the way it is already built here includes the mistakes.
 * A generator that extracts the majority pattern reproduces the majority's
 * defects: in one repository seven of seven asynchronous files had nowhere to
 * fail, so "as it is done here" meant "with no failure path".
 *
 * The fix is not to guess better. It is to rank: score every existing instance
 * against the project's own rules, and treat the best ones as the reference
 * rather than the most common ones. A design system solves this by writing golden
 * examples by hand; a project with none has them selected instead, from what it
 * already ships.
 *
 * Three outputs, and the third is the point:
 *
 *   copy       the highest-scoring instances, with what makes them good
 *   avoid      instances carrying accepted debt, named so nobody learns from them
 *   caution    patterns the audit flagged that a naive extraction would copy
 *
 *   node scripts/exemplars.mjs <repo> --profile own [--exclude ds,brand]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, scanSlot } from './lib/signals.mjs'
import { indexProfile, scoreFiles } from './lib/score-core.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const target = process.argv[2]
const PROFILE = flag('--profile') ?? 'own'
const EXCLUDED = (flag('--exclude') ?? '').split(',').map(x => x.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/exemplars.mjs <repo> --profile <id> [--exclude a,b]')
  process.exit(2)
}

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const conventions = readJson(join(target, '.ds', 'conventions.json'))
const baseline = readJson(join(target, '.ds', 'baseline.json')) ?? {}
const profile = indexProfile(readJson(join(root, 'profiles', PROFILE, 'components.json')))

const name = scanSlot(target)
const deep = readJson(join(root, 'scans', name, 'deep.json'))
const defects = readJson(join(root, 'scans', name, 'defects.json'))

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const files = walk(join(target, conventions?.scope ?? 'src'))
  .filter(f => /\.[jt]sx$/.test(f) && !/\.(test|spec)\./.test(f))
  .filter(f => !excludedPrefixes.some(p => f.startsWith(p + sep)))

if (!files.length) { console.error('exemplars: nothing to rank.'); process.exit(1) }

const rel = (f) => relative(target, f).split(sep).join('/')

// ── Rank ──────────────────────────────────────────────────────────────────────
//
// Scored WITHOUT the baseline, deliberately. The baseline forgives debt so the
// gate can be green; an exemplar carrying forgiven debt is still the wrong thing
// to copy, and hiding that here would teach the next screen to repeat it.

const ranked = files.map(file => {
  const strict = scoreFiles({ target, files: [file], conventions, baseline: {}, profile })
  const forgiven = scoreFiles({ target, files: [file], conventions, baseline, profile })
  const inBaseline = Object.values(baseline).some(list => list.includes(rel(file)))
  return {
    file: rel(file),
    score: strict.score,
    gateScore: forgiven.score,
    checks: strict.total,
    failures: strict.checks.filter(c => !c.ok).map(c => c.detail),
    inBaseline,
    kind: /(Page|Screen|View)\.[jt]sx$/.test(file) ? 'screen' : 'component',
  }
}).sort((a, b) => b.score - a.score || b.checks - a.checks)

const byKind = (kind) => ranked.filter(r => r.kind === kind)

/** Enough checks to mean something: a two-line file scoring 100% proves nothing. */
const substantial = (r) => r.checks >= 8

// Accepted debt disqualifies a reference, and only `avoid` was enforcing that.
// `copy` filtered on the score alone, so a file whose baseline entry was stale —
// debt paid, not yet cleared, which is every repository between two updates —
// scored 100 strictly and appeared in BOTH lists. The tool said "copy this" and,
// four lines later, "do not learn from this", about the same file.
const referenceable = (r) => r.score === 100 && substantial(r) && !r.inBaseline
const copy = { screen: byKind('screen').filter(referenceable).slice(0, 3),
  component: byKind('component').filter(referenceable).slice(0, 3) }
const avoid = ranked.filter(r => r.inBaseline || r.score < 90).slice(0, 8)

// ── Patterns a naive extraction would copy ────────────────────────────────────
//
// The majority is not automatically the model. Where the audit already measured
// a shortfall, copying the majority propagates it, and the generator has to be
// told which way to break the tie.

const caution = []
if (deep) {
  const async = deep.resilience
  if (async && async.asyncFiles > 0 && async.unhandledAsync.length / async.asyncFiles > 0.5) {
    caution.push({
      pattern: 'asynchronous work with no failure path',
      measured: `${async.unhandledAsync.length} of ${async.asyncFiles} file(s)`,
      instruction: 'Do not copy this. New async work gets a catch and a state the user can see.',
    })
  }
  const states = deep.composition?.statesHandled
  if (states && states.allThree < 0.5) {
    caution.push({
      pattern: 'screens without all three of loading, error and empty',
      measured: `${Math.round((states.allThree ?? 0) * 100)}% of screens handle all three`,
      instruction: 'Do not copy this. A new screen handles all three even where its neighbours do not.',
    })
  }
  const forms = deep.forms
  if (forms && forms.formsFound > 0 && forms.guardsDoubleSubmit === 0) {
    caution.push({
      pattern: 'forms with no guard against double submission',
      measured: `0 of ${forms.formsFound} form(s)`,
      instruction: 'Do not copy this. A submit control is disabled while the submission is in flight.',
    })
  }
  if (deep.stateData?.fetchInComponents?.length > 0) {
    caution.push({
      pattern: 'fetching inside a component body',
      measured: `${deep.stateData.fetchInComponents.length} component(s)`,
      instruction: 'Copy only if the project has no server-state library. It has none, so this is the local idiom — but a new screen should not add to the count without a reason.',
    })
  }
}
if (defects?.counts?.a11yFindings > 0) {
  caution.push({
    pattern: 'accessibility findings in existing code',
    measured: `${defects.counts.a11yFindings} finding(s)`,
    instruction: 'The floor is not negotiable regardless of what the neighbours do.',
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })
const report = { schemaVersion: 1, taken: taken(import.meta.url, target), target, profile: PROFILE, copy, avoid, caution, ranked: ranked.slice(0, 40) }
writeFileSync(join(outDir, 'exemplars.json'), JSON.stringify(report, null, 2) + '\n')

// The same thing an agent can read without running anything.
const markdown = [
  `# What to copy in ${name}`,
  '',
  'Selected by scoring every existing file against this project\'s own rules, not by',
  'counting which pattern is most common. The most common pattern carries the most',
  'common mistake.',
  '',
  '## Copy these',
  '',
  ...['screen', 'component'].flatMap(kind => {
    const list = copy[kind]
    if (!list.length) return [`No ${kind} scores 100% on enough checks to be a reference yet.`, '']
    return [`### ${kind}s`, '', ...list.map(r => `- \`${r.file}\` — ${r.score}% over ${r.checks} checks`), '']
  }),
  '## Do not learn from these',
  '',
  ...(avoid.length
    ? avoid.map(r => `- \`${r.file}\` — ${r.score}%${r.inBaseline ? ', carries accepted debt' : ''}${r.failures[0] ? `: ${r.failures[0]}` : ''}`)
    : ['Nothing scores badly enough to warn about.']),
  '',
  '## Patterns not to copy, however common',
  '',
  ...(caution.length
    ? caution.flatMap(c => [`- **${c.pattern}** — ${c.measured}. ${c.instruction}`])
    : ['None measured.']),
  '',
].join('\n')
writeFileSync(join(outDir, 'exemplars.md'), markdown)

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nexemplars: ${target}\n${files.length} file(s) ranked against this project's own rules\n`)

for (const kind of ['screen', 'component']) {
  const list = copy[kind]
  console.log(`COPY — ${kind}s`)
  if (!list.length) console.log(`  none yet: no ${kind} scores 100% on enough checks to be a reference`)
  for (const r of list) console.log(`  ${String(r.score).padStart(3)}%  ${r.file}  (${r.checks} checks)`)
  console.log('')
}

console.log('DO NOT LEARN FROM')
for (const r of avoid.slice(0, 5)) {
  console.log(`  ${String(r.score).padStart(3)}%  ${r.file}${r.inBaseline ? '  · accepted debt' : ''}`)
  if (r.failures[0]) console.log(`        ${r.failures[0].slice(0, 90)}`)
}
if (!avoid.length) console.log('  nothing scores badly enough to warn about')

console.log('\nPATTERNS NOT TO COPY, HOWEVER COMMON')
if (!caution.length) console.log('  none measured')
for (const c of caution) {
  console.log(`  · ${c.pattern} — ${c.measured}`)
  console.log(`    ${c.instruction}`)
}

console.log('\nThe majority is not the model. Where a shortfall was measured, the generator')
console.log('is told to break the tie against the neighbours rather than with them.')
console.log(`\nwritten to scans/${name}/exemplars.json and exemplars.md`)
