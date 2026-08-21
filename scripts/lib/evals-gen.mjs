/**
 * An eval set for the repository it is generated in.
 *
 * `ds eval` measures whether OUR ruleset discriminates, against our corpus. That
 * says nothing about whether the gate installed in a client's repository would
 * catch an agent breaking THEIR conventions — and a gate nobody has tried to slip
 * past is a gate nobody knows the shape of.
 *
 * Everything here is derived, nothing is written by hand:
 *
 *   reference   the highest-scoring file already in the repository, chosen by
 *               the exemplars pass. Not the most common one — the most common
 *               one carries the most common mistake.
 *   breaks      that same file, mutated to violate one enforced convention each.
 *               A break is generated per dimension the gate claims to enforce,
 *               so the eval set is exactly as wide as the gate's own claim.
 *   verdict     a break that survives is a hole in this repository's gate, and
 *               it is reported as the gate's defect rather than deleted.
 *
 * The honest limit is stated in the generated runner: a dimension nothing can
 * mechanically violate gets no break, so the set is narrower than the gate. It
 * says which dimensions those are rather than quietly covering fewer.
 */

/**
 * How to violate each convention, given the bucket the repository settled on.
 *
 * Only mutations whose result unambiguously belongs to a different bucket. A
 * mutation that might still classify as the original teaches nothing, and a
 * break that the gate correctly ignores looks like a hole and is not one.
 */
const MUTATIONS = {
  'component export': {
    default: { to: 'named', apply: (t) => t.replace(/export default function (\w+)/, 'export function $1') },
    named: { to: 'default', apply: (t) => t.replace(/export function (\w+)/, 'export default function $1') },
  },
  'internal imports': {
    alias: {
      to: 'relative',
      apply: (t) => t.replace(/from ['"]@\/([^'"]+)['"]/g, "from '../$1'"),
    },
    relative: {
      to: 'alias',
      apply: (t) => t.replace(/from ['"]\.\.\/([^'"]+)['"]/g, "from '@/$1'"),
    },
  },
  'handler naming': {
    handleX: { to: 'onX', apply: (t) => t.replace(/\bconst handle([A-Z])/g, 'const on$1') },
    onX: { to: 'handleX', apply: (t) => t.replace(/\bconst on([A-Z])/g, 'const handle$1') },
  },
  'props declaration': {
    'interface Props': { to: 'type Props', apply: (t) => t.replace(/interface (\w*Props)\s*\{/, 'type $1 = {') },
    'type Props': { to: 'interface Props', apply: (t) => t.replace(/type (\w*Props)\s*=\s*\{/, 'interface $1 {') },
  },
  'colour values': {
    'from tokens': {
      to: 'literal hex',
      apply: (t) => /var\(--[\w-]+\)/.test(t) ? t.replace(/var\(--[\w-]+\)/, '#3b82f6') : undefined,
    },
  },
  'user-facing text': {
    'through i18n': {
      to: 'literal in JSX',
      apply: (t) => /\bt\(['"][^'"]+['"]\)/.test(t) ? t.replace(/\bt\((['"])([^'"]+)\1\)/, '"Save"') : undefined,
    },
  },
}

/**
 * Builds the eval set. Returns files to write and the dimensions left uncovered.
 *
 * @param {object} input
 * @param {string} input.referencePath  repository-relative path of the exemplar
 * @param {string} input.referenceText  its contents
 * @param {object} input.enforce        the gate's enforced dimensions
 */
export function generateEvals({ referencePath, referenceText, enforce }) {
  const files = []
  const covered = []
  const uncovered = []

  for (const [dimension, rule] of Object.entries(enforce)) {
    const mutation = MUTATIONS[dimension]?.[rule.expect]
    if (!mutation) {
      uncovered.push({ dimension, expect: rule.expect, why: 'nothing mechanically violates this without possibly still satisfying it' })
      continue
    }
    const broken = mutation.apply(referenceText)
    if (!broken || broken === referenceText) {
      uncovered.push({ dimension, expect: rule.expect, why: 'the reference file has nothing to break for this dimension' })
      continue
    }
    const id = dimension.replace(/\s+/g, '-')
    files.push({
      path: `evals/breaks/${id}.tsx`,
      content: `/* GENERATED. The reference with one convention violated, so the gate can be\n`
        + ` * asked whether it notices. This file is meant to FAIL:\n`
        + ` *\n`
        + ` *   ${dimension}: this repository uses ${rule.expect} at ${Math.round(rule.share * 100)}%,\n`
        + ` *   and this is ${mutation.to}.\n`
        + ` *\n`
        + ` * If the gate passes it, the gate has a hole. Do not fix the file. */\n\n`
        + broken,
    })
    covered.push({ dimension, from: rule.expect, to: mutation.to, break: `evals/breaks/${id}.tsx` })
  }

  if (!covered.length) return { files: [], covered, uncovered }

  files.push({
    path: 'evals/reference.tsx',
    content: `/* GENERATED from ${referencePath}, which scored highest against this\n`
      + ` * repository's own conventions. It is the reference because it is the best\n`
      + ` * instance, not because it is typical — the typical one carries the typical\n`
      + ` * mistake. This file is meant to PASS. */\n\n${referenceText}`,
  })

  files.push({
    path: 'evals/run.mjs',
    content: RUNNER(covered, uncovered, referencePath),
  })

  return { files, covered, uncovered }
}

const RUNNER = (covered, uncovered, referencePath) => `/**
 * Does this repository's gate actually catch an agent breaking its conventions?
 *
 * Generated by AI FactoryFit from the conventions measured here. The reference is
 * the highest-scoring file in this repository; each break is that file with one
 * convention violated. The gate should pass the first and fail every other.
 *
 * A surviving break is a hole in the gate, never a break to delete. Fixing the
 * break instead of the gate leaves the hole and removes the only thing that would
 * have found it again.
 *
 *   node evals/run.mjs
 */
import { readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

const gate = (file) => {
  try {
    execFileSync(process.execPath, [join(repo, 'scripts', 'gate', 'conventions.mjs'), file], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return 'passed'
  } catch (error) {
    // A non-zero exit is the gate reporting a violation, which for a break is the
    // correct outcome. No output at all means it did not run.
    const out = String(error.stdout ?? '') + String(error.stderr ?? '')
    if (!out.trim()) return 'did not run'
    return 'caught'
  }
}

const reference = gate('evals/reference.tsx')
const breaks = readdirSync(join(here, 'breaks')).filter(f => f.endsWith('.tsx'))
  .map(f => ({ file: 'evals/breaks/' + f, verdict: gate('evals/breaks/' + f) }))

console.log('\\ngate evals — generated from the conventions measured in this repository\\n')
console.log(\`  reference (\${${JSON.stringify(referencePath)}})\`)
console.log(\`    \${reference === 'passed' ? 'PASS  as it should' : reference === 'caught' ? 'FAIL  the gate rejects the best file in this repository' : 'NOT RUN'}\`)

console.log('\\n  breaks — each should be caught')
for (const b of breaks) {
  const mark = b.verdict === 'caught' ? 'caught ' : b.verdict === 'passed' ? 'SURVIVED' : 'NOT RUN'
  console.log(\`    \${mark.padEnd(9)} \${b.file}\`)
}

const survived = breaks.filter(b => b.verdict === 'passed')
const notRun = breaks.filter(b => b.verdict === 'did not run')

${uncovered.length ? `console.log('\\n  NOT COVERED — the gate enforces these and nothing here tries to break them')
${uncovered.map(u => `console.log(${JSON.stringify(`    ${u.dimension} (${u.expect}) — ${u.why}`)})`).join('\n')}
console.log('  The eval set is narrower than the gate, and this is where.')` : ''}

console.log(\`\\n\${breaks.length - survived.length - notRun.length}/\${breaks.length} break(s) caught\`)
if (survived.length) {
  console.log('A surviving break is a hole in this gate. Widen the gate; do not fix the break.')
}
if (notRun.length) console.log('A break that did not run proved nothing.')
process.exit(survived.length || notRun.length || reference !== 'passed' ? 1 : 0)
`
