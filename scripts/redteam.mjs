/**
 * Break the reference solutions the ways agents really break code, and fail if a
 * break survives.
 *
 * Every other check asks whether the code is right. This asks whether we would
 * have noticed if it were not.
 *
 * The corpus carries nine breaks somebody thought to write. This generates them
 * mechanically from the reference solutions, which is strictly stronger: the
 * hand-written set can only contain failures we already knew about, and the one
 * that mattered most — boolean shorthand attributes — was found by accident.
 *
 * A mutant is only counted as caught when the check that SHOULD catch it does.
 * Being caught by an unrelated check is luck, and luck does not survive the next
 * refactor of the ruleset.
 *
 * A surviving mutant is a hole in the checks, never a mutant to delete.
 *
 *   node scripts/redteam.mjs [--profile own] [--verbose]
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { indexProfile, scoreFiles } from './lib/score-core.mjs'

import { OPERATORS } from './lib/mutations.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const corpus = join(root, 'evals')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'
const verbose = process.argv.includes('--verbose')

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const conventions = readJson(join(corpus, '.ds', 'conventions.json'))
const profileDoc = readJson(join(root, 'profiles', PROFILE, 'components.json'))
const profile = indexProfile(profileDoc)

if (!conventions || !profile) {
  console.error('redteam: needs evals/.ds/conventions.json and a built profile.')
  process.exit(1)
}

// ── The mutation operators ────────────────────────────────────────────────────
//
// Each one is a failure class observed in agent output, paired with the check
// group that has to notice it. `apply` returns the mutated source, or undefined
// when this reference gives the operator nothing to work on.

// The operators live in a module so the generator can put its own output through
// them: a break of the file we just wrote is the one neither eval covers.


// ── Run ───────────────────────────────────────────────────────────────────────

const taskDir = join(corpus, 'tasks')
const references = readdirSync(taskDir)
  .map(id => ({ id, path: join(taskDir, id, 'reference.tsx') }))
  .filter(r => existsSync(r.path))

const workDir = mkdtempSync(join(tmpdir(), 'ds-redteam-'))
const score = (file) => scoreFiles({ target: workDir, files: [file], conventions, baseline: {}, profile })

const results = []
try {
  for (const reference of references) {
    const original = readFileSync(reference.path, 'utf8')
    const basePath = join(workDir, `${reference.id}.tsx`)
    writeFileSync(basePath, original)
    const baseline = score(basePath)

    for (const operator of OPERATORS) {
      const mutated = operator.apply(original)
      if (!mutated || mutated === original) {
        results.push({ task: reference.id, operator, status: 'not-applicable' })
        continue
      }
      const mutantPath = join(workDir, `${reference.id}.${operator.id}.tsx`)
      writeFileSync(mutantPath, mutated)
      const result = score(mutantPath)
      const failures = result.checks.filter(c => !c.ok)
      const caughtBy = [...new Set(failures.map(f => f.group))]

      results.push({
        task: reference.id,
        operator,
        status: caughtBy.includes(operator.catchBy) ? 'caught'
          : failures.length ? 'caught-by-luck' : 'survived',
        caughtBy,
        baselineScore: baseline.score,
        mutantScore: result.score,
        detail: failures[0]?.detail,
      })
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

// ── Report ────────────────────────────────────────────────────────────────────

const applicable = results.filter(r => r.status !== 'not-applicable')
const survived = applicable.filter(r => r.status === 'survived')
const luck = applicable.filter(r => r.status === 'caught-by-luck')
const caught = applicable.filter(r => r.status === 'caught')

console.log(`\nredteam: ${references.length} reference(s) × ${OPERATORS.length} operator(s) → ${applicable.length} mutant(s)\n`)

const byOperator = {}
for (const r of applicable) {
  const o = byOperator[r.operator.id] ??= { caught: 0, luck: 0, survived: 0, catchBy: r.operator.catchBy, what: r.operator.what }
  o[r.status === 'caught-by-luck' ? 'luck' : r.status] += 1
}

for (const [id, o] of Object.entries(byOperator)) {
  const total = o.caught + o.luck + o.survived
  const mark = o.survived ? '✗' : o.luck ? '~' : '✓'
  console.log(`  ${mark} ${id.padEnd(26)} ${o.caught}/${total} by ${o.catchBy}${o.luck ? `, ${o.luck} by something else` : ''}${o.survived ? `, ${o.survived} SURVIVED` : ''}`)
  if (verbose) console.log(`      ${o.what}`)
}

if (survived.length) {
  console.log(`\nHOLES — ${survived.length} mutant(s) nothing noticed:`)
  for (const r of survived) {
    console.log(`  ${r.task} · ${r.operator.id}: ${r.operator.what}`)
    console.log(`    scored ${r.mutantScore}% against a reference at ${r.baselineScore}%`)
  }
}

if (luck.length) {
  console.log(`\nCAUGHT BY LUCK — ${luck.length} mutant(s) tripped a check that was not the point:`)
  for (const r of luck) {
    console.log(`  ${r.task} · ${r.operator.id}: expected ${r.operator.catchBy}, got ${r.caughtBy.join(', ')}`)
  }
  console.log('  These pass today and stop passing the moment the unrelated check moves.')
}

const rate = applicable.length === 0 ? 0 : Math.floor((caught.length / applicable.length) * 100)
console.log('')
console.log(`  killed by the intended check   ${caught.length}/${applicable.length}  (${rate}%)`)
console.log(`  killed by something else       ${luck.length}`)
console.log(`  survived                       ${survived.length}`)
console.log('')
console.log('A surviving mutant is a hole in the checks, never a mutant to delete.')

process.exit(survived.length ? 1 : 0)
