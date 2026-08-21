/**
 * Run the corpus: does this ruleset actually discriminate?
 *
 * Every other check asks whether the code is right. This asks whether we would
 * have noticed if it were not — which is a different question, and the only one
 * that tells you a change to the rules, the registry or the examples improved
 * anything rather than felt like it did.
 *
 * Each task ships a reference solution and a set of deliberate breaks, one per
 * failure class agents actually produce: a value outside a union, a prop that
 * does not exist, a literal colour, an icon-only control with no name. The
 * reference must score high and every break must be caught.
 *
 * A surviving break is a hole in the ruleset, never a break to delete. That is
 * the whole discipline: the corpus is adversarial towards the checks, not towards
 * the code.
 *
 * No model runs here. Candidates are files; scoring is the same scorer the gate
 * uses. Put an agent's output in a task folder and it is scored on the same terms.
 *
 *   node scripts/eval.mjs [--profile own] [--verbose]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexProfile, scoreFiles } from './lib/score-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const corpus = join(root, 'evals')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'
const verbose = process.argv.includes('--verbose')

/** A reference is expected to clear this; below it the corpus itself is wrong. */
const REFERENCE_FLOOR = 95

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const conventions = readJson(join(corpus, '.ds', 'conventions.json'))
const profile = indexProfile(readJson(join(root, 'profiles', PROFILE, 'components.json')))

if (!conventions || !profile) {
  console.error('eval: the corpus needs evals/.ds/conventions.json and a built profile.')
  process.exit(1)
}

const taskDir = join(corpus, 'tasks')
const tasks = readdirSync(taskDir).filter(name => existsSync(join(taskDir, name, 'task.json')))
if (tasks.length === 0) { console.error('eval: no tasks.'); process.exit(1) }

const score = (file) => scoreFiles({ target: corpus, files: [file], conventions, baseline: {}, profile })

const results = []
for (const id of tasks) {
  const task = JSON.parse(readFileSync(join(taskDir, id, 'task.json'), 'utf8'))
  const referencePath = join(taskDir, id, 'reference.tsx')
  const reference = existsSync(referencePath) ? score(referencePath) : undefined

  const breaksDir = join(taskDir, id, 'breaks')
  const breaks = existsSync(breaksDir)
    ? readdirSync(breaksDir).filter(f => f.endsWith('.tsx')).map(file => {
      const result = score(join(breaksDir, file))
      const failures = result.checks.filter(c => !c.ok)
      return { file: basename(file, '.tsx'), result, caught: failures.length > 0, failures }
    })
    : []

  results.push({ id, task, reference, breaks })
}

// ── Report ────────────────────────────────────────────────────────────────────

const allBreaks = results.flatMap(r => r.breaks)
const survived = allBreaks.filter(b => !b.caught)
const weakReferences = results.filter(r => r.reference && r.reference.score < REFERENCE_FLOOR)

console.log(`\neval: ${tasks.length} task(s), ${allBreaks.length} deliberate break(s), profile "${PROFILE}"\n`)

for (const r of results) {
  const referenceScore = r.reference ? `${r.reference.score}%` : 'no reference'
  console.log(`  ${r.id.padEnd(16)} reference ${referenceScore.padStart(5)}   ${r.breaks.filter(b => b.caught).length}/${r.breaks.length} break(s) caught`)
  if (verbose && r.reference) {
    for (const c of r.reference.checks.filter(c => !c.ok)) console.log(`      reference fails: ${c.detail}`)
  }
  for (const b of r.breaks) {
    const mark = b.caught ? '✓' : '✗ SURVIVED'
    const why = b.caught ? b.failures[0].detail : 'nothing in the ruleset noticed'
    console.log(`      ${mark.padEnd(11)} ${b.file.padEnd(24)} ${String(why).slice(0, 72)}`)
  }
}

console.log('')
if (weakReferences.length) {
  console.log(`REFERENCES BELOW ${REFERENCE_FLOOR}% — the corpus is wrong before the ruleset is:`)
  for (const r of weakReferences) {
    console.log(`  ${r.id}: ${r.reference.score}%`)
    for (const c of r.reference.checks.filter(c => !c.ok)) console.log(`    ${c.detail}`)
  }
  console.log('')
}

if (survived.length) {
  console.log(`HOLES — ${survived.length} break(s) the ruleset does not catch:`)
  for (const b of survived) console.log(`  ${b.file}`)
  console.log('')
  console.log('Each of these is a failure class an agent can produce and ship. Close the hole')
  console.log('by adding a check; deleting the break would only stop the corpus from asking.')
} else {
  console.log('Every deliberate break was caught. The ruleset discriminates on all of them.')
}

const discrimination = allBreaks.length === 0 ? 0
  : Math.round(((allBreaks.length - survived.length) / allBreaks.length) * 100)
const referenceMean = results.filter(r => r.reference).reduce((n, r) => n + r.reference.score, 0)
  / (results.filter(r => r.reference).length || 1)

console.log('')
console.log(`  references average   ${Math.round(referenceMean)}%`)
console.log(`  breaks caught        ${discrimination}%`)
console.log('')
console.log('The number worth watching over time is the second one. A ruleset that scores')
console.log('good code well and bad code equally well is not enforcing anything.')

process.exit(survived.length || weakReferences.length ? 1 : 0)
