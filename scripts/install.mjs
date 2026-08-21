/**
 * Install the enforcement layer into a target repository.
 *
 * What gets installed is derived from that repository, not brought in: the
 * conventions come from its own code, the baseline is its current state, and the
 * gate holds it to what it already does. Nothing is red on the day of install —
 * only a regression is.
 *
 * Writes are opt-in. The default run prints the plan and touches nothing, and an
 * existing file is never overwritten without --force, because arriving at a
 * client repository and replacing their config is how the gate gets removed by
 * Friday.
 *
 *   node scripts/install.mjs <repo> --profile own [--exclude ds,brand]   plan only
 *   node scripts/install.mjs <repo> --apply                write
 *   node scripts/install.mjs <repo> --apply --force        overwrite too
 *   node scripts/install.mjs <repo> --apply --skip .gitlab-ci.yml
 *
 * --plan installs only what the client chose, read from the plan `fit --select`
 * wrote. Without it everything installable is installed, which is the right
 * default for our own repositories and the wrong one for a client who agreed to
 * three techniques out of twelve.
 *
 * --skip leaves an artifact out. Reach for it on a repository with a remote: a
 * CI definition is not an inert file, it starts running on the next push.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { SIGNALS, STRONG, walk, scanSlot, projectRoots } from './lib/signals.mjs'
import { generateEvals } from './lib/evals-gen.mjs'
import { scopedRules, ruleFile } from './lib/scoped-rules.mjs'
import { generateLoop } from './lib/loop-gen.mjs'
import { generateBudget } from './lib/budget-gen.mjs'
import { generatePermissions } from './lib/permissions-gen.mjs'

import { detectHosts, HOSTS } from './lib/hosts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const excludeArg = process.argv.indexOf('--exclude')
const EXCLUDED = excludeArg === -1
  ? []
  : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
// Which coding agents this repository already carries. Evidence, not a question: a
// team using Cursor has a `.cursor/`, a team using Copilot has its instructions file.
// Writing for a host nobody here runs is a file nothing reads, and the summary counts
// it as coverage.
const hosts = detectHosts((p) => existsSync(join(target, p)))

const profileArg = process.argv.indexOf('--profile')
const PROFILE = profileArg === -1 ? undefined : process.argv[profileArg + 1]
const usePlan = process.argv.includes('--plan')
const skipArg = process.argv.indexOf('--skip')
const SKIPPED = skipArg === -1
  ? []
  : (process.argv[skipArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/install.mjs <repo> [--exclude ds,brand] [--apply] [--force]')
  process.exit(2)
}

const name = scanSlot(target)
/**
 * What this repository writes at its own call sites, if it has been measured.
 *
 * A profile records what a component declares; this records what the team does with
 * it. The two are kept apart on purpose and both are worth having — a union of eight
 * values where three are ever used tells an agent which three to reach for, and a
 * registry with no types at all has nothing else to go on.
 *
 * Read from this client's scan rather than from the profile, because usage is a fact
 * about a codebase and a profile may be shared across several of them. Folding one
 * client's habits into a shared library's description would hand the next client a
 * measurement of somebody else's project wearing the authority of their own.
 */
const measuredVocabulary = (() => {
  // A profile that does not exist is install's own error to report, a few lines
  // below and in its own words. Measuring first put a confusing warning about usage
  // above the plain message about the typo, so the first thing a reader saw was the
  // least useful one.
  if (!PROFILE || !existsSync(join(root, 'profiles', PROFILE, 'components.json'))) return {}
  // Measured here rather than expected to be on disk. As a separate command it was
  // one nobody would run: the section it fills is the only place an agent learns
  // which of six declared variants this team actually reaches for, and it would
  // have been silently absent from every install with nothing saying why. The pass
  // reads the repository and writes only into this tool's own scans.
  try {
    execFileSync(process.execPath, [join(here, 'vocabulary.mjs'), target, '--profile', PROFILE,
      ...(EXCLUDED.length ? ['--exclude', EXCLUDED.join(',')] : [])],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 })
  } catch (error) {
    // Not fatal. The rest of the install is unaffected, and a missing section is
    // better than a failed install — but it is said out loud, because a section
    // that quietly never appears is indistinguishable from one with nothing to say.
    console.error(`  ! usage was not measured, so the contract will not say what this repository writes: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
  try {
    const doc = JSON.parse(readFileSync(join(root, 'scans', name, 'vocabulary.json'), 'utf8'))
    return doc.profile === PROFILE ? (doc.axes ?? {}) : {}
  } catch { return {} }
})()

const scanPath = join(root, 'scans', name, 'scan.json')
if (!existsSync(scanPath)) {
  console.error(`install: no scan for "${name}". Run the scan first:`)
  console.error(`  node scripts/scan.mjs ${target}${EXCLUDED.length ? ` --exclude ${EXCLUDED.join(',')}` : ''}`)
  process.exit(1)
}
const scan = JSON.parse(readFileSync(scanPath, 'utf8'))

// ── What we will enforce ──────────────────────────────────────────────────────
// Only dimensions the repository already agrees on. A weak or split dimension is
// documented and left alone: enforcing a decision the team has not made is how a
// consultant's gate gets switched off.

/**
 * Whether this project has written enough to have a house style at all.
 *
 * The per-dimension floor was fixed and the per-project one was not, so the tool
 * contradicted itself in two consecutive lines: `too early to say — nothing is
 * claimed about the house style because nothing can be`, and directly under it
 * `enforcing 3 convention(s)`. A gate holding every future commit to three rules IS
 * a claim about the house style, made in the client's repository, against a scan
 * that had just said it could not make one.
 *
 * Six identical files answering three of eleven dimensions is not a system; it is
 * six files. So they are documented instead — written down, visible, and available
 * to the team to adopt with `ds update` once there is enough code to mean it.
 */
const tooEarly = /^too early to say/.test(scan.mode)

const enforce = {}
const documented = {}
const undecided = {}

for (const [dimension, entry] of Object.entries(scan.conventions)) {
  // Direction of travel wins: when recent code has moved on, hold new code to
  // where the team is going, not to the average of where it has been.
  const moved = (scan.drift ?? []).find(d => d.dimension === dimension && d.recent)
  const expect = moved?.recent ?? entry.dominant
  const recentEntry = scan.conventionsRecent?.[dimension]
  const share = moved ? (recentEntry?.share ?? entry.share) : entry.share

  // A dimension nobody has written enough of is not undecided by disagreement —
  // it is undecided by absence, and both belong in the same place: left alone.
  // Without this, one file declaring props became an enforced rule at "100%".
  if (entry.verdict === 'too few to say') {
    undecided[dimension] = {
      distribution: entry.distribution,
      why: `${entry.total} observation(s) — too few for a share to mean anything, so nothing is enforced here`,
    }
  } else if (entry.verdict === 'convention' || (moved && (recentEntry?.share ?? 0) >= STRONG)) {
    // Settled as a dimension, and still not a house style if the project has not
    // written enough to have one. Documented rather than enforced, with the reason
    // in the record so it does not read as an oversight.
    const settled = { expect, share: Number(share.toFixed(3)), observations: entry.total, source: moved ? 'recent code' : 'whole repository' }
    if (tooEarly) {
      documented[dimension] = {
        leaning: expect, share: settled.share, observations: entry.total, distribution: entry.distribution,
        why: 'consistent as far as it goes, but this project has answered too few dimensions for any of it to be a house style yet — adopt it with `ds update` once there is more code',
      }
    } else {
      enforce[dimension] = settled
    }
  } else if (entry.verdict === 'weak') {
    documented[dimension] = { leaning: expect, share: Number(share.toFixed(3)), observations: entry.total, distribution: entry.distribution }
  } else {
    undecided[dimension] = { distribution: entry.distribution }
  }
}

// ── Baseline: today's violations, accepted as debt ────────────────────────────

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const isExcluded = (abs) => excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep))
const files = walk(target).filter(abs => !isExcluded(abs))

const baseline = {}
for (const abs of files) {
  let src
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  const rel = relative(target, abs).split(sep).join('/')
  for (const [dimension, rule] of Object.entries(enforce)) {
    const bucket = SIGNALS[dimension]?.(abs, src)
    if (!bucket || bucket === rule.expect) continue
    ;(baseline[dimension] ??= []).push(rel)
  }
}
for (const list of Object.values(baseline)) list.sort()
const debtCount = Object.values(baseline).reduce((sum, l) => sum + l.length, 0)

// ── Generated artifacts ───────────────────────────────────────────────────────

const pct = (n) => `${Math.round(n * 100)}%`

/**
 * The registry as one page an agent reads before writing anything.
 *
 * The hand-written system this was modelled on carries a line per component:
 * name, level, the parts of a compound, and what it is FOR. That last part is the
 * one that decides which component gets picked, and an extracted profile does not
 * have it — nobody publishes it and nothing derives it.
 *
 * So the index is built from what extraction does know, and says plainly what it
 * does not. "Badge takes variant: default|secondary|destructive and is imported
 * from @/components/ui/badge" is worth having on its own; pretending to know that
 * Badge is how this project shows status would be worth less than nothing.
 */
function componentIndex(profileDoc, profileId, measured = {}) {
  const components = profileDoc.components ?? {}
  const names = Object.keys(components).sort()
  const described = names.filter(n => components[n].description).length
  const extracted = names.some(n => components[n].exampleIs)

  const line = (name) => {
    const c = components[name]
    const bits = [name]
    if (c.level) bits.push(c.context ? `${c.level}/${c.context}` : c.level)
    // A variant without a value list is a knob whose settings nobody recorded —
    // real in the hand-written registry, where some variants are described in
    // prose. Naming it and saying nothing about it beats crashing, and beats
    // dropping it as though the knob were not there.
    const knobs = Object.values(c.variants ?? {}).map(v => Array.isArray(v?.values)
      ? `${v.prop}: ${v.values.slice(0, 6).join('|')}${v.values.length > 6 ? '|…' : ''}`
      : `${v?.prop ?? '?'}: values not recorded`)
    if (knobs.length) bits.push(knobs.join(' · '))
    if (c.uses?.length) bits.push(`+${c.uses.slice(0, 4).join(',')}`)
    bits.push(c.description ?? 'no description — read the source to choose')
    // What this repository actually writes, kept on its own line and never folded
    // into the declared values above. The two answer different questions: a union
    // says what the component accepts, and this says what the team reaches for. A
    // reader who cannot tell them apart will take a habit for a constraint.
    const seen = Object.entries(measured[name] ?? {})
    const usage = seen.length
      ? `\n  observed here: ${seen.map(([prop, a]) =>
        `${prop} = ${Object.entries(a.observed).map(([v, n]) => `${v}×${n}`).join(' ')}`).join(' · ')}`
      : ''
    return bits.join(' · ') + usage
  }

  return [
    `# ${profileId} — ${names.length} component(s)`,
    '',
    'One line each: name · variants and their values · what it is built from · what it is for.',
    `Import from \`${components[names[0]]?.from?.replace(/\/[^/]+$/, '') ?? '?'}/<name>\`.`,
    '',
    ...(Object.keys(measured).length ? [
      'Some lines carry a second line, `observed here`. That is what this repository',
      'actually writes at its call sites, counted — not what the component accepts.',
      'The two are different questions and the difference matters when writing: the',
      'declared values are a constraint, the observed ones are a habit. Following the',
      'habit keeps new code consistent with what is here; a value absent from the',
      'observed list is not thereby forbidden, it is only one nobody has needed yet.',
      '',
    ] : []),
    ...extracted
      ? ['Extracted from this repository, so everything here is a fact the compiler could',
        `check. What is NOT here is judgment: ${names.length - described} of ${names.length} components carry no`,
        'description, because no library publishes the line that decides which component to',
        'reach for and nothing derives it. Until somebody writes them, an agent choosing',
        'between two similar components here is guessing.']
      : ['Authored, so the descriptions are decisions somebody made.'],
    '',
    'Generated — never edit this file; it is rebuilt from the profile.',
    '',
    ...names.map(line),
    '',
    '## Examples',
    '',
    ...names.filter(n => components[n].example).flatMap(n => [
      `### ${n}`,
      components[n].exampleFrom ? `_${components[n].exampleIs?.split(':')[0]} — ${components[n].exampleFrom}_` : null,
      '',
      '```tsx',
      String(components[n].example).trim(),
      '```',
      '',
    ]),
  // Only the conditional lines are dropped. Filtering every empty string collapsed
  // the paragraph breaks and produced one wall of markdown.
  ].filter(l => l !== null && l !== undefined).join('\n')
}

// The delivery loop, with its gates set by what this repository supports.
//
// Every reference model draws the same six stages and differs entirely in where
// the human gates sit — and copying one is how a consultant installs somebody
// else's operating model. The audit already derived the delegation level; the
// gates follow from it rather than from a picture.
const loop = (() => {
  const at = join(root, 'scans', name, 'ai-audit.json')
  if (!existsSync(at)) return undefined
  try {
    const audit = JSON.parse(readFileSync(at, 'utf8'))
    return generateLoop({ delegation: audit.delegation, name, hasEvidence: false, hasGate: true })
  } catch { return undefined }
})()

// Rules attached to the files they are about. The always-on contract is paid on
// every request by every agent, and a task about a utility function does not need
// the screen conventions. A subtree earns a scoped rule only where it has settled
// on something the repository as a whole has not.
const scoped = scopedRules({
  target,
  files,
  read: (abs) => { try { return readFileSync(abs, 'utf8') } catch { return '' } },
  conventions: scan.conventions,
}).map(ruleFile)

// The exemplar this repository already contains, and the breaks generated from it.
// Without a ranking there is nothing to hold up as the reference, so the eval set
// is skipped rather than built around an arbitrary file.
const evals = (() => {
  const at = join(root, 'scans', name, 'exemplars.json')
  if (!existsSync(at)) return { files: [], covered: [], uncovered: [], why: 'no exemplars ranked yet; run `ds exemplars` first' }
  let ranked
  try { ranked = JSON.parse(readFileSync(at, 'utf8')) } catch { return { files: [], covered: [], uncovered: [], why: 'the exemplars file does not parse' } }
  const best = [...(ranked.copy?.screen ?? []), ...(ranked.copy?.component ?? []), ...(ranked.ranked ?? [])]
    .find(r => r && r.score === 100 && r.checks >= 8) ?? (ranked.ranked ?? [])[0]
  if (!best) return { files: [], covered: [], uncovered: [], why: 'nothing scored well enough to be a reference' }
  const abs = join(target, best.file)
  if (!existsSync(abs)) return { files: [], covered: [], uncovered: [], why: `the reference ${best.file} is no longer on disk` }
  return { ...generateEvals({ referencePath: best.file, referenceText: readFileSync(abs, 'utf8'), enforce }), reference: best.file }
})()

const contractReachableAt = projectRoots(target)
  .map(base => join(base, 'AGENTS.md'))
  .find(existsSync)

// What an agent reads before it may touch anything, and what that costs on every
// task. A contract grows a paragraph at a time and nobody notices until the
// cheapest task carries a chapter before it starts.
const budget = generateBudget({
  read: (p) => { try { return readFileSync(join(target, p), 'utf8') } catch { return undefined } },
  alwaysOn: [
    contractReachableAt ? relative(target, contractReachableAt).split(sep).join('/') : 'AGENTS.md',
    'CLAUDE.md',
    '.ds/CONVENTIONS.md',
    '.ds/profile/component-index.md',
  ],
})

const conventionsMd = [
  '# Conventions — how this repository writes code',
  '',
  'Generated from this repository by AI FactoryFit. These are not imported rules:',
  'every line below was measured in the code that is already here.',
  '',
  `Measured over ${scan.scannedFiles} files${scan.excluded?.files ? `, excluding ${scan.excluded.paths.join(', ')}` : ''}.`,
  `Situation: ${scan.mode}`,
  '',
  '## Enforced',
  '',
  'The gate holds new code to these. Existing violations are recorded in',
  '`.ds/baseline.json` and are accepted debt — the gate fails on a new one, never',
  'on an old one.',
  '',
  ...Object.entries(enforce).map(([dimension, rule]) =>
    `- **${dimension}** — ${rule.expect} (${pct(rule.share)}, from ${rule.source})`),
  '',
  '## Leaning, not enforced',
  '',
  'The repository tends this way but has not settled. Follow the lean; the gate',
  'will not stop you either way.',
  '',
  ...(Object.keys(documented).length
    ? Object.entries(documented).map(([dimension, d]) => `- **${dimension}** — ${d.leaning} (${pct(d.share)})`)
    : ['- nothing in this class']),
  '',
  '## Undecided — for the team, not for us',
  '',
  'Two ways of doing the same thing, in comparable amounts. Someone who knows why',
  'has to choose; until then nothing here is enforced.',
  '',
  ...(Object.keys(undecided).length
    ? Object.entries(undecided).map(([dimension, d]) =>
        `- **${dimension}** — ${Object.entries(d.distribution).map(([k, v]) => `${k} ${v}`).join(' vs ')}`)
    : ['- nothing in this class']),
  '',
  '## Running the gate',
  '',
  '```sh',
  'node scripts/gate/run.mjs edit <files>   # what an edit hook runs',
  'node scripts/gate/run.mjs commit         # what the pre-commit hook runs',
  'node scripts/gate/run.mjs ci             # what CI runs',
  '```',
  '',
].join('\n')

const conventionsJson = {
  schemaVersion: 1,
  generatedFrom: `AI FactoryFit scan of ${scan.scannedFiles} files`,
  mode: scan.mode,
  scope: existsSync(join(target, 'src')) ? 'src' : '.',
  // Recorded so the installed gates measure the same files the scan did. Without
  // it the tool and the gate report different numbers for the same repository,
  // and a number that changes with who ran it is not a number.
  excluded: EXCLUDED,
  enforce,
  documented,
  undecided,
}

const gateLinter = `/**
 * Conventions gate — generated by AI FactoryFit install.
 *
 * Holds new code to what this repository already does. The expected value for
 * each dimension came from measuring this codebase, and every file that violated
 * one at install time is listed in .ds/baseline.json as accepted debt. This gate
 * fails on a NEW violation, never on an old one, so it is green on the day it
 * lands and only a regression turns it red.
 *
 * To pay down debt, delete entries from the baseline: a removed entry that still
 * violates fails immediately, so the baseline cannot silently grow back.
 *
 *   node scripts/gate/conventions.mjs            check the whole scope
 *   node scripts/gate/conventions.mjs <files>    check these files
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIGNALS, walk } from './signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const conventions = JSON.parse(readFileSync(join(repo, '.ds', 'conventions.json'), 'utf8'))
const baselinePath = join(repo, '.ds', 'baseline.json')
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const files = args.length
  ? args.map(f => isAbsolute(f) ? f : join(repo, f)).filter(f => existsSync(f))
  : walk(join(repo, conventions.scope))

const violations = []
for (const abs of files) {
  let src
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  const rel = relative(repo, abs).split(sep).join('/')
  for (const [dimension, rule] of Object.entries(conventions.enforce)) {
    const signal = SIGNALS[dimension]
    if (!signal) continue
    const bucket = signal(abs, src)
    if (!bucket || bucket === rule.expect) continue
    if ((baseline[dimension] ?? []).includes(rel)) continue
    violations.push({ rel, dimension, found: bucket, expect: rule.expect, share: rule.share })
  }
}

if (violations.length === 0) {
  console.log('conventions: ' + files.length + ' file(s) checked, no new violations.')
  process.exit(0)
}

console.error('conventions: ' + violations.length + ' new violation(s)')
for (const v of violations) {
  const share = Math.round(v.share * 100)
  console.error('  x ' + v.rel)
  console.error('    ' + v.dimension + ': found "' + v.found + '", this repository uses "' + v.expect + '" (' + share + '%)')
}
console.error('')
console.error('These are conventions measured in this repository, not imported rules.')
console.error('If one is wrong, change .ds/conventions.json and say why in the commit.')
process.exit(1)
`

const gateRunner = `/**
 * Gate runner — generated by AI FactoryFit install.
 *
 * One dependency graph, several named modes. Modes are derived from the same
 * gate list rather than maintained as separate command chains, because two hand
 * written chains drift: a check present locally and missing in CI is the normal
 * end state of that arrangement, not an unlucky one.
 *
 *   node scripts/gate/run.mjs edit <files>
 *   node scripts/gate/run.mjs commit
 *   node scripts/gate/run.mjs ci
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const pkg = existsSync(join(repo, 'package.json'))
  ? JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  : {}
const has = (script) => Boolean(pkg.scripts?.[script])

const mode = process.argv[2] ?? 'commit'
const fileArgs = process.argv.slice(3)

const conventions = (files) => ({
  id: 'conventions',
  command: process.execPath,
  args: [join(here, 'conventions.mjs'), ...files],
})
const score = (files) => ({
  id: 'score',
  command: process.execPath,
  args: [join(here, 'score.mjs'), ...files],
})
const npmScript = (id, script, needs) => ({ id, command: 'npm', args: ['run', script], needs })

function gatesFor(selected) {
  switch (selected) {
    case 'edit':
      return [conventions(fileArgs), score(fileArgs)]
    case 'commit':
      return [
        conventions([]),
        score([]),
        ...has('lint') ? [npmScript('lint', 'lint')] : [],
        ...has('typecheck') ? [npmScript('typecheck', 'typecheck')] : [],
      ]
    case 'score':
      return [score(fileArgs)]
    case 'ci':
      return [
        conventions([]),
        score([]),
        { id: 'examples', command: process.execPath, args: [join(here, 'examples.mjs')] },
        { id: 'architecture', command: process.execPath, args: [join(here, 'architecture.mjs')] },
        // The only check here that sees what a person sees. It needs a server to
        // point at, which a commit hook cannot assume — so it is in CI and not in
        // commit, and it excuses itself with SKIPPED when VISUAL_BASE_URL is not set
        // rather than failing a build for a reason unrelated to the change.
        //
        // It was installed into every client and invoked by nothing: a check that
        // exists, works, and never runs is the same as no check, and worse, because
        // the file in the repository says otherwise.
        { id: 'visual', command: process.execPath, args: [join(here, 'visual.mjs')] },
        ...has('lint') ? [npmScript('lint', 'lint')] : [],
        ...has('lint:css') ? [npmScript('lint:css', 'lint:css')] : [],
        ...has('typecheck') ? [npmScript('typecheck', 'typecheck')] : [],
        ...has('test') ? [npmScript('test', 'test')] : [],
        ...has('build') ? [npmScript('build', 'build', ['typecheck'])] : [],
      ]
    default:
      console.error('unknown mode: ' + selected + ' (edit | commit | score | ci)')
      process.exit(2)
  }
}

// "The tool is missing" and "your code is wrong" both exit non-zero, and telling
// a developer FAIL lint when the truth is that tsc is not installed sends them
// to read code that is fine. The gate still fails — a check that cannot run must
// never be green — but it says which of the two happened.
const CANNOT_RUN = /command not found|: not found|ENOENT|is not recognized|Cannot find module|Cannot find package/i

function run(gate) {
  return new Promise((resolve) => {
    const chunks = []
    const child = spawn(gate.command, gate.args, { cwd: repo, shell: false })
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => chunks.push(d))
    child.on('error', (err) => resolve({ gate, ok: false, unavailable: true, output: String(err) }))
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString()
      resolve({
        gate,
        ok: code === 0 || code === 78,
        skipped: code === 78,
        unavailable: code !== 0 && code !== 78 && CANNOT_RUN.test(output),
        output,
      })
    })
  })
}

const gates = gatesFor(mode)
const workers = Math.max(1, Math.min(availableParallelism() - 1, gates.length))
const done = new Map()
const results = []

// A gate runs once its dependencies have passed. A gate whose dependency failed
// is skipped and reported, never silently dropped: a gate that did not run is
// not a gate that passed.
async function schedule() {
  const pending = new Map(gates.map(g => [g.id, g]))
  const running = new Map()

  while (pending.size > 0 || running.size > 0) {
    for (const [id, gate] of [...pending]) {
      if (running.size >= workers) break
      const needs = gate.needs ?? []
      if (needs.some(n => done.get(n) === false)) {
        pending.delete(id)
        done.set(id, false)
        results.push({ gate, ok: false, output: 'skipped: dependency failed' })
        continue
      }
      if (!needs.every(n => done.get(n) === true)) continue
      pending.delete(id)
      running.set(id, run(gate).then((r) => {
        done.set(id, r.ok)
        results.push(r)
        running.delete(id)
      }))
    }
    if (running.size === 0) break
    await Promise.race(running.values())
  }
}

await schedule()

const failed = results.filter(r => !r.ok)
for (const r of results) {
  const label = r.skipped ? 'SKIP ' : r.ok ? 'PASS ' : r.unavailable ? 'NOT RUN ' : 'FAIL '
  console.log(label + r.gate.id)
  if (r.skipped && r.output.trim()) console.log('     ' + r.output.trim().slice(0, 120))
  if (!r.ok && r.output.trim()) console.log(r.output.trimEnd())
}
const skipped = results.filter(r => r.skipped)
const unavailable = results.filter(r => r.unavailable)
console.log('')
console.log('gate ' + mode + ': ' + (results.length - failed.length - skipped.length) + ' passed, '
  + skipped.length + ' skipped, ' + (failed.length - unavailable.length) + ' failed, '
  + unavailable.length + ' could not run')
if (skipped.length) console.log('A skipped check is not a passed one — install what it needs, or drop it.')
if (unavailable.length) {
  console.log('Could not run: ' + unavailable.map(r => r.gate.id).join(', ')
    + ' — the command is missing, not the code wrong. Most often npm install has not been run here.')
}
process.exit(failed.length ? 1 : 0)
`


// The scorer, inside their repository. It reads the profile from .ds/profile so
// the gate is self-contained: a check that only runs when a consultant's laptop
// is present is not a gate.
const gateScore = `/**
 * Conformance score — generated by AI FactoryFit install.
 *
 * Same logic as the tool that installed it, copied rather than called, so this
 * repository can score itself with nothing else present.
 *
 *   node scripts/gate/score.mjs               score the scope
 *   node scripts/gate/score.mjs <files...>    score what was just written
 *   node scripts/gate/score.mjs --baseline    what this team's recent code scores
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { walk } from './signals.mjs'
import { indexProfile, scoreFiles, reportScore } from './score-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const conventions = readJson(join(repo, '.ds', 'conventions.json'))
const baseline = readJson(join(repo, '.ds', 'baseline.json')) ?? {}
const profile = indexProfile(readJson(join(repo, '.ds', 'profile', 'components.json')))

const baselineMode = process.argv.includes('--baseline')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))

function recentFiles(days) {
  try {
    const out = execFileSync('git', ['-C', repo, 'log', '--since=' + days + ' days ago', '--name-only', '--pretty=format:'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return [...new Set(out.split('\\n').map(l => l.trim()).filter(Boolean))].map(p => join(repo, p))
  } catch { return [] }
}

const excludedPrefixes = (conventions?.excluded ?? []).map(e => join(repo, e))
const usable = (f) => existsSync(f) && /\\.[jt]sx$/.test(f) && !/\\.(test|spec)\\./.test(f)
  && !excludedPrefixes.some(p => f === p || f.startsWith(p + sep))
const files = (baselineMode ? recentFiles(90)
  : args.length ? args.map(f => isAbsolute(f) ? f : join(repo, f))
  : walk(join(repo, conventions?.scope ?? 'src'))).filter(usable)

if (files.length === 0) {
  console.log('score: no files to score.')
  process.exit(0)
}

const result = scoreFiles({ target: repo, files, conventions, baseline, profile })
reportScore(result, { files: files.length, profile })
process.exit(0)
`

// Examples are checked where components are owned. In a consuming app this
// reports on the app's own components; in a design system it reports on all of
// them. Either way the question is the same: is there a real module an agent can
// copy, or only a description of one.
const gateExamples = `/**
 * Golden example coverage — generated by AI FactoryFit install.
 *
 * An example is what an agent copies, so it has to be a real module: the compiler
 * breaks it when a prop is renamed, and the test suite renders it. A snippet in a
 * document cannot do either, and drifts the first time anything changes.
 *
 *   node scripts/gate/examples.mjs [--strict]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk } from './signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const strict = process.argv.includes('--strict')

const components = walk(join(repo, 'src')).filter(f => {
  if (!/\\.tsx$/.test(f) || /\\.(test|spec|example)\\./.test(f)) return false
  const name = basename(f, '.tsx')
  return /^[A-Z]/.test(name) && basename(dirname(f)) === name
})

const missing = []
const present = []
for (const file of components) {
  const example = file.replace(/\\.tsx$/, '.example.tsx')
  if (existsSync(example)) {
    const text = readFileSync(example, 'utf8')
    const real = /export function Example|export const Example/.test(text)
    if (real) present.push(relative(repo, example))
    else missing.push({ file: relative(repo, file), why: 'example exists but exports no Example()' })
  } else missing.push({ file: relative(repo, file), why: 'no example module' })
}

const total = components.length
const covered = present.length
console.log('examples: ' + covered + '/' + total + ' component(s) ship a real example module')

if (missing.length) {
  console.log('')
  for (const m of missing.slice(0, 20)) console.log('  · ' + m.file + ' — ' + m.why)
  if (missing.length > 20) console.log('  … and ' + (missing.length - 20) + ' more')
  console.log('')
  console.log('An example is a module, not a snippet: tsc breaks it on a rename and the')
  console.log('suite renders it, so the documentation cannot drift away from the component.')
}

process.exit(strict && missing.length ? 1 : 0)
`

const gateVisual = `/**
 * Visual baselines — generated by AI FactoryFit install.
 *
 * The only check that sees layout as it renders. Everything else asserts what the
 * code says; this asserts what a browser draws.
 *
 * It compares. An earlier version took the screenshot, put it beside the baseline
 * and exited zero — a check that cannot fail, counted as passing in every summary
 * it appeared in. A size change is reported as a layout change rather than as a
 * large pixel diff, because comparing different dimensions pixel by pixel means
 * nothing.
 *
 * Capture needs Playwright and a running app; without either it exits 78, which
 * the runner reports as SKIP rather than PASS.
 *
 *   node scripts/gate/visual.mjs [--update]
 *   VISUAL_ROUTES=/,/settings VISUAL_BASE_URL=http://localhost:5173 node scripts/gate/visual.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { compareToBaseline } from './image-diff.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const SKIPPED_EXIT = 78
const update = process.argv.includes('--update')
const BASE_URL = process.env.VISUAL_BASE_URL ?? 'http://localhost:5173'

const need = createRequire(join(repo, 'package.json'))
let chromium
try {
  ({ chromium } = need('playwright'))
} catch {
  console.log('visual: playwright is not installed here.')
  console.log('        npm i -D playwright pixelmatch pngjs, then run this again.')
  process.exit(SKIPPED_EXIT)
}

// Everything this needs, checked before anything is written — including on --update.
//
// The comparison libraries were only reached at comparison time, so an --update run
// with playwright installed and pixelmatch missing wrote three baselines and reported
// "3 route(s), 0 changed". A consultant sets the baselines, sees that, and believes
// visual checking is running. It is not: the next run cannot compare, and the setup
// step said nothing.
try { need('pixelmatch'); need('pngjs') } catch {
  console.log('visual: playwright is here, and pixelmatch and pngjs are not.')
  console.log('        Baselines could be captured and nothing could ever be compared')
  console.log('        against them, so nothing is written.')
  console.log('        npm i -D pixelmatch pngjs, then run this again.')
  process.exit(SKIPPED_EXIT)
}

// Nothing to point at. In CI without a server started first this would report every
// route unreachable, which reads as a failure of the change rather than of the setup.
if (!process.env.VISUAL_BASE_URL) {
  console.log('visual: VISUAL_BASE_URL is not set, so there is nothing to point at.')
  console.log('        Start the app, then: VISUAL_BASE_URL=http://localhost:5173 VISUAL_ROUTES=/,/settings')
  process.exit(SKIPPED_EXIT)
}

const routes = (process.env.VISUAL_ROUTES ?? '/').split(',').filter(Boolean)
const outDir = join(repo, 'visual')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const results = []
let unreachable = 0

for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 15000 })
  } catch {
    unreachable += 1
    await page.close()
    continue
  }
  const name = (route === '/' ? 'root' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')) + '.png'
  const baselinePath = join(outDir, name)
  const captured = await page.screenshot({ fullPage: true })
  await page.close()

  if (update) {
    writeFileSync(baselinePath, captured)
    results.push({ name, status: 'updated' })
    continue
  }
  results.push({ name, ...compareToBaseline({ baselinePath, captured, diffPath: join(outDir, name.replace('.png', '.diff.png')) }) })
}
await browser.close()

if (unreachable === routes.length) {
  console.log('visual: nothing at ' + BASE_URL + ' — is the app running?')
  process.exit(SKIPPED_EXIT)
}

// A comparison that could not run is not a comparison that passed. Without the
// image libraries this gate captured a screenshot, reported "0 changed" and
// exited zero — a green that meant nothing was compared.
const unavailable = results.filter(r => r.status === 'unavailable')
if (unavailable.length === results.length && results.length) {
  console.log('visual: ' + unavailable[0].reason + '.')
  console.log('        npm i -D pixelmatch pngjs, then run this again.')
  process.exit(SKIPPED_EXIT)
}

const changed = results.filter(r => r.status === 'changed' || r.status === 'resized')
for (const r of results) {
  if (r.status === 'unchanged') console.log('  = ' + r.name)
  else if (r.status === 'recorded') console.log('  + ' + r.name + ' recorded as the baseline')
  else if (r.status === 'updated') console.log('  ~ ' + r.name + ' updated')
  else if (r.status === 'resized') console.log('  x ' + r.name + ' layout changed: ' + r.reason)
  else if (r.status === 'changed') console.log('  x ' + r.name + ' ' + r.changedPixels + ' pixel(s) differ (' + (r.ratio * 100).toFixed(2) + '%) — see the .diff.png')
  else if (r.status === 'unavailable') console.log('  ? ' + r.name + ' ' + r.reason)
}

console.log('')
console.log('visual: ' + results.length + ' route(s), ' + changed.length + ' changed'
  + (unreachable ? ', ' + unreachable + ' unreachable' : ''))
if (changed.length) console.log('Review the difference images, then accept with --update.')
process.exit(changed.length ? 1 : 0)
`


// dependency-cruiser is configured per project, not invoked with guessed flags.
// Run ad hoc it saw 17 modules of 90 — it does not follow `lazy(() => import())`
// without knowing the entry points — and disagreed with our own graph about
// whether a cycle existed. With a config that names the tsconfig it reads 257
// modules and finds the cycle. The difference is the config, so the config is
// what gets installed.
const depCruiserConfig = `/** Architecture rules — generated by AI FactoryFit install.
 *
 * These make module boundaries executable rather than merely documented. Run:
 *   npx depcruise src
 *
 * Add rules as the team decides them; each one should name what it prevents.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle means neither module can be understood, moved or tested alone.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'A module nothing imports is either dead or reached in a way the graph cannot see.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\\\.[^/]+\\\\.(js|cjs|mjs|ts|json)$',
          '\\\\.d\\\\.ts$',
          '(^|/)(main|index)\\\\.[jt]sx?$',
          '(^|/)vite-env\\\\.d\\\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-dev-dep-in-src',
      comment: 'Shipping code must not depend on a development-only package.',
      severity: 'error',
      from: { path: '^src', pathNot: '\\\\.(test|spec)\\\\.[jt]sx?$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
`

const gateArchitecture = `/**
 * Architecture gate — generated by AI FactoryFit install.
 *
 * Delegates to dependency-cruiser, which resolves tsconfig path aliases and
 * follows the real module graph. A hand-written traversal cannot do either, and
 * one that only reads relative imports reports a cycle count that is a lower
 * bound while sounding like a total.
 *
 *   node scripts/gate/architecture.mjs
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

// A check that could not run is not a check that passed. The runner reports this
// exit code as SKIP, so a green summary never hides an absent tool.
const SKIPPED_EXIT = 78

const bin = ['node_modules/.bin/depcruise', '../../node_modules/.bin/depcruise']
  .map(p => join(repo, p)).find(existsSync)

if (!bin) {
  console.log('architecture: dependency-cruiser is not installed here.')
  console.log('              npm i -D dependency-cruiser, then run this again.')
  process.exit(SKIPPED_EXIT)
}
if (!existsSync(join(repo, '.dependency-cruiser.cjs'))) {
  console.log('architecture: no .dependency-cruiser.cjs to read.')
  process.exit(SKIPPED_EXIT)
}

let raw = ''
try {
  raw = execFileSync(bin, ['src', '--output-type', 'json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (error) {
  raw = error.stdout ?? ''
}

let report
try { report = JSON.parse(raw) } catch {
  console.log('architecture: dependency-cruiser produced no readable output.')
  process.exit(SKIPPED_EXIT)
}

const { summary } = report
console.log('architecture: ' + summary.totalCruised + ' module(s), ' + summary.totalDependenciesCruised + ' dependency(ies)')

const violations = summary.violations ?? []
const errors = violations.filter(v => v.rule.severity === 'error')
const warnings = violations.filter(v => v.rule.severity === 'warn')

for (const v of errors) console.log('  x [' + v.rule.name + '] ' + v.from + ' → ' + v.to)
for (const v of warnings.slice(0, 10)) console.log('  ~ [' + v.rule.name + '] ' + v.from)
if (warnings.length > 10) console.log('  ~ … and ' + (warnings.length - 10) + ' more warning(s)')

if (errors.length === 0) console.log('  no forbidden dependency found.')
process.exit(errors.length ? 1 : 0)
`


// ── The agent side ────────────────────────────────────────────────────────────
//
// Rules an agent must obey become hooks; knowledge it needs sometimes becomes a
// skill; work with its own definition of done becomes a subagent. That is the
// classification, and putting a thing in the wrong one is why contracts grow
// until nobody reads them.
//
// Two of these files usually already exist and belong to the team. They are
// MERGED, never replaced: an install that overwrites .claude/settings.json takes
// somebody's permissions and hooks with it.

const gateCommand = 'node scripts/gate/run.mjs'

// What an agent may run here, taken from what this repository already runs.
//
// A permission list is the one piece of configuration where copying somebody
// else's is worse than having none: too tight and every task stops on a prompt
// until a person turns the whole thing off, too loose and the setting is
// decoration. Both end in permissions that exist and mean nothing.
const permissions = generatePermissions({
  scripts: (() => {
    try { return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).scripts ?? {} } catch { return {} }
  })(),
  tools: scan.toolchain.present.map(t => t.name ?? t),
  hasGate: true,
})

const claudeSettings = {
  ...permissions.permissions ? { permissions: permissions.permissions } : {},
  hooks: {
    PostToolUse: [{
      matcher: 'Edit|Write',
      hooks: [{
        type: 'command',
        command: `${gateCommand} edit "$CLAUDE_FILE_PATHS"`,
      }],
    }],
    Stop: [{
      hooks: [{ type: 'command', command: `${gateCommand} commit` }],
    }],
  },
}

const mcpEntry = {
  mcpServers: {
    'design-system': {
      command: 'node',
      args: [join(root, 'scripts', 'mcp.mjs'), '--profile', PROFILE ?? 'own', '--repo', '.'],
    },
  },
}

const gateSkill = `---
name: ${name}-gate
description: Run this repository's own checks on what you just wrote — conventions measured here, components and props from its registry, and the accessibility floor. Use before saying a change is done, and whenever a file has been edited.
---

# ${name} gate

This repository's rules were measured from its own code, not imported. The gate
holds new code to them and forgives everything that was already there.

## Check what you just wrote

\`\`\`sh
node scripts/gate/score.mjs <files>
\`\`\`

Reports components that are not in the registry, props that are not declared,
values outside a closed union, literal colours and sizes, and the accessibility
floor. Every number comes from this repository, so a failure is a statement about
this project rather than a general rule.

## Check everything before finishing

\`\`\`sh
node scripts/gate/run.mjs commit
\`\`\`

## What to copy

Read \`.ds/EXEMPLARS.md\` when it is there. It names the highest-scoring files in
this project — the ones to model new work on — and, separately, the patterns that
are common here and should not be reproduced. The most common shape carries the
most common mistake, so "do it like the neighbours" is only safe once somebody has
ranked the neighbours.

## What the rules are

Read \`.ds/CONVENTIONS.md\`. It lists what is enforced, what the repository leans
towards without enforcing, and what the team has not decided — that last group is
not yours to settle.

## Accepted debt

\`.ds/baseline.json\` holds violations that predate the gate. They are accepted:
the gate fails on a new one, never an old one. Do not add to it to make a check
pass.
`

const conformanceSubagent = `---
name: ${name}-conformance
description: Reviews a change against this repository's measured conventions and its component registry. Use after writing or editing UI code, before calling the work done.
tools: Read, Grep, Glob, Bash
---

You review changes against what this repository already decided. You do not bring
rules with you.

Run \`node scripts/gate/score.mjs <files>\` and read \`.ds/CONVENTIONS.md\` for the
enforced set. Report only what the measurement supports:

- a component or prop that is not in \`.ds/profile/components.json\`
- a value outside a closed union
- a convention violation that is not already in \`.ds/baseline.json\`
- an accessibility finding

Two things are out of scope. Anything in the "undecided" section of the contract
is the team's to settle, not yours to enforce. And anything already in the
baseline is accepted debt — say so if it is nearby, but do not report it as a
defect of this change.

Give the file, the line, and the rule with its measured share. A finding without
those three is an opinion.
`

const headlessWorkflow = `# Generated by AI FactoryFit install.
#
# Runs the gate unattended. Adding an agent step — Claude Code in headless mode,
# a scheduled review — reuses these same hooks and permissions, and is a decision
# with a key attached, so it is left to the team.
name: gate
on: [push, pull_request]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node scripts/gate/run.mjs ci
`

const preCommit = `#!/bin/sh
# Generated by AI FactoryFit install. Runs this repository's own gate before a commit.
set -e
node scripts/gate/run.mjs commit
`

const usesGithub = existsSync(join(target, '.github'))
const ciPath = usesGithub ? '.github/workflows/gate.yml' : '.gitlab-ci.yml'
const ciContent = usesGithub
  ? `# Generated by AI FactoryFit install.
name: gate
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node scripts/gate/run.mjs ci
`
  : `# Generated by AI FactoryFit install.
gate:
  image: node:22
  script:
    - npm ci
    - node scripts/gate/run.mjs ci
`

const signalsSource = readFileSync(join(root, 'scripts', 'lib', 'signals.mjs'), 'utf8')
const scoreCoreSource = readFileSync(join(root, 'scripts', 'lib', 'score-core.mjs'), 'utf8')
const imageDiffSource = readFileSync(join(root, 'scripts', 'lib', 'image-diff.mjs'), 'utf8')

const profilePath = PROFILE ? join(root, 'profiles', PROFILE, 'components.json') : undefined
const profileSource = profilePath && existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : undefined
if (PROFILE && !profileSource) {
  console.error(`install: no profile "${PROFILE}" — run the adapter for it first.`)
  process.exit(1)
}

const plan = [
  // Evals, generated from the exemplar and the enforced conventions. `ds eval`
  // asks whether OUR ruleset discriminates; this asks whether the gate installed
  // HERE would notice an agent breaking this repository's own conventions — which
  // is a different question and the one the team actually has.
  ...evals.files.map(f => ({ regenerate: true, path: f.path, content: f.content,
    why: f.path.endsWith('run.mjs') ? `${evals.covered.length} break(s) the gate should catch`
      : f.path.includes('breaks/') ? 'meant to fail; a surviving break is a hole in the gate'
      : 'the highest-scoring file here; meant to pass' })),

  ...scoped.map(r => ({ regenerate: true, path: r.path, content: r.content,
    why: 'loaded only while editing this subtree; carries only what differs' })),

  ...loop ? [
    { regenerate: true, path: '.ds/loop.json', content: JSON.stringify(loop.definition, null, 2) + '\n',
      why: `${loop.gateCount} human gate(s), derived from the ${loop.level} level` },
    { regenerate: true, path: 'scripts/loop/run.mjs', content: loop.runner,
      why: 'runs the deterministic parts and stops where a person is required' },
  ] : [],

  ...budget ? [
    { path: '.ds/context-budget.json', content: JSON.stringify(budget.manifest, null, 2) + '\n',
      why: `${budget.total} token(s) read on every task, with a quarter of headroom` },
    { regenerate: true, path: 'scripts/gate/context.mjs', content: budget.runner,
      why: 'fails when the must-read set outgrows its budget' },
  ] : [],

  { path: '.ds/CONVENTIONS.md', content: conventionsMd, why: 'the contract, generated from their code' },

  // The cross-tool contract, written only where there is none.
  //
  // A repository that already has an AGENTS.md has a team's decisions in it, and
  // overwriting those is not this tool's business — there the instruction to link
  // it is printed and nothing is touched. But where the file is absent there is
  // nothing to preserve, and printing "link the contract" to a repository with no
  // contract leaves every agent inventing its own conventions, which is the exact
  // state the audit had just measured as the problem.
  //
  // A pointer, not a copy: two texts on one subject drift, and the measured
  // contract is regenerated while this file is written once.
  // Reachable, not merely present here. memos keeps its AGENTS.md at the
  // repository root and the target is `web/`, so checking only the target wrote a
  // second contract into the package — two texts on one subject, which is the
  // failure this file is meant to prevent. The audit already resolves contracts up
  // the workspace; install has to agree with it.
  ...contractReachableAt ? [] : [{
    path: 'AGENTS.md',
    why: 'the cross-tool contract; ~30 agents read this name natively',
    content: [
      `# ${name}`,
      '',
      'Conventions for this repository are measured from its own code, not chosen.',
      'They live in `.ds/CONVENTIONS.md`, which is regenerated — read that file',
      'rather than repeating it here, or the two drift and neither is authoritative.',
      '',
      '@.ds/CONVENTIONS.md',
      '',
      '## Before saying a change is done',
      '',
      '```sh',
      'node scripts/gate/run.mjs edit    # on what you just wrote',
      'node scripts/gate/run.mjs commit  # before committing',
      '```',
      '',
      'A check that did not run is not a check that passed. The gate says which of',
      'the two happened; do not read a skipped check as a green one.',
      '',
      '## What the team decided, where it differs from what was measured',
      '',
      '`.ds/decisions.json` outranks the measurement and is never regenerated. If a',
      'rule here contradicts the code, that file is where the disagreement is settled —',
      'not by changing the measurement.',
      '',
      '## Debt',
      '',
      `\`.ds/baseline.json\` forgives ${debtCount} violation(s) that existed when this`,
      'landed, so nothing is red on day one. Adding to it is a decision, not a fix:',
      'only a regression turns the gate red.',
      '',
    ].join('\n'),
  }],
  { path: '.ds/conventions.json', content: JSON.stringify(conventionsJson, null, 2) + '\n', why: 'machine-readable, read by the gate' },
  { path: '.ds/baseline.json', content: JSON.stringify(baseline, null, 2) + '\n', why: `${debtCount} accepted violations, so nothing is red today` },
  { regenerate: true, path: 'scripts/gate/signals.mjs', content: signalsSource, why: 'how conventions are measured; same code as the scan' },
  { regenerate: true, path: 'scripts/gate/conventions.mjs', content: gateLinter, why: 'the ratchet' },
  { regenerate: true, path: 'scripts/gate/run.mjs', content: gateRunner, why: 'one graph, four modes' },
  ...profileSource ? [{ regenerate: true, path: '.ds/profile/components.json', content: profileSource, why: `the ${PROFILE} registry, so the gate is self-contained` }] : [],
  ...profileSource ? [{ regenerate: true, path: '.ds/profile/component-index.md',
    content: componentIndex(JSON.parse(profileSource), PROFILE, measuredVocabulary),
    why: 'the registry as one page, for an agent to read before writing' }] : [],
  { regenerate: true, path: 'scripts/gate/score-core.mjs', content: scoreCoreSource, why: 'the scoring logic, identical to the tool\'s' },
  { regenerate: true, path: 'scripts/gate/score.mjs', content: gateScore, why: 'verify, baseline and evals in one command' },
  { regenerate: true, path: 'scripts/gate/examples.mjs', content: gateExamples, why: 'is there a real module an agent can copy' },
  { regenerate: true, path: 'scripts/gate/image-diff.mjs', content: imageDiffSource, why: 'baseline comparison, testable without a browser' },
  { regenerate: true, path: 'scripts/gate/visual.mjs', content: gateVisual, why: 'the only check that sees layout as rendered' },
  { regenerate: true, path: 'scripts/gate/architecture.mjs', content: gateArchitecture, why: 'module boundaries, via dependency-cruiser' },
  { path: '.dependency-cruiser.cjs', content: depCruiserConfig, why: 'architecture rules the team can extend' },
  { path: '.githooks/pre-commit', content: preCommit, why: 'runs the gate on commit', mode: 0o755 },
  // Written only where this host is already here. These went into every project
  // unconditionally, which put a settings file, a skill and a subagent for one agent
  // into repositories where nobody runs it — the same failure as a story file in a
  // project with no Storybook, and worse, because the summary counts it as coverage.
  ...(hosts.wants('Claude Code') ? [
    { regenerate: true, path: `.claude/skills/${name}-gate/SKILL.md`, content: gateSkill, why: 'the gate as knowledge an agent reaches for' },
    { regenerate: true, path: `.claude/agents/${name}-conformance.md`, content: conformanceSubagent, why: 'review as a boundary, with its own context' },
    { merge: '.claude/settings.json', path: '.claude/settings.json', content: claudeSettings, why: `edit hook, stop gate and ${permissions.permissions.allow.length} allowed command(s), merged into what is there` },
  ] : []),
  { regenerate: true, path: '.ds/permissions.md', content: [
    '# What an agent may run here, and why',
    '',
    ...permissions.reasoning._,
    '',
    '## Allowed',
    '',
    ...permissions.reasoning.allow.map(a => `- \`${a.rule}\` — ${a.why}`),
    '',
    '## Denied',
    '',
    ...permissions.reasoning.deny.map(d => `- \`${d.rule}\` — ${d.why}`),
    '',
  ].join('\n'), why: 'the reasoning, because a permission nobody can explain gets removed' },
  { merge: '.mcp.json', path: '.mcp.json', content: mcpEntry, why: 'the registry, reachable by any agent' },
  { path: '.github/workflows/gate.yml', content: headlessWorkflow, why: 'the gate unattended' },
  { path: ciPath, content: ciContent, why: 'the same graph in CI, so the two cannot drift' },
]

// ── Execute or report ─────────────────────────────────────────────────────────

console.log(`\ninstall: ${target}`)
console.log(`situation: ${scan.mode}`)
console.log(`enforcing ${Object.keys(enforce).length} convention(s), documenting ${Object.keys(documented).length}, leaving ${Object.keys(undecided).length} to the team`)
console.log(`baseline: ${debtCount} existing violation(s) accepted as debt\n`)

// The client's decision, if one was recorded. An artifact outside it is not
// installed: agreeing to three techniques and receiving twelve is how the whole
// arrangement stops being a negotiation.
const planPath = join(root, 'scans', name, 'plan.json')
const chosen = usePlan && existsSync(planPath)
  ? new Set(JSON.parse(readFileSync(planPath, 'utf8')).installs)
  : undefined
if (usePlan && !chosen) {
  console.error(`install: --plan given but no decision recorded for "${name}".`)
  console.error(`  node scripts/fit.mjs ${name} --select a,b,c`)
  process.exit(1)
}
if (chosen) {
  const decision = JSON.parse(readFileSync(planPath, 'utf8'))
  console.log(`following the decision of ${decision.decidedOn}: ${decision.selected.length} technique(s), ${decision.rejected.length} declined\n`)
}

/**
 * Adds our entries to a JSON file the team owns, without touching theirs.
 *
 * Overwriting .claude/settings.json takes somebody's permissions and hooks with
 * it, and the team finds out when their own hook stops firing.
 */
function mergeJson(path, addition) {
  let existing = {}
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf8')) } catch {
      return { ok: false, reason: 'the existing file does not parse; merging would lose it' }
    }
  }
  const merged = { ...existing }
  const added = []
  for (const [section, value] of Object.entries(addition)) {
    if (Array.isArray(value)) continue
    merged[section] = { ...(existing[section] ?? {}) }
    for (const [key, entry] of Object.entries(value)) {
      if (merged[section][key] !== undefined) continue
      merged[section][key] = entry
      added.push(`${section}.${key}`)
    }
  }
  return { ok: true, merged, added, existed: existsSync(path) }
}

/**
 * What this tool wrote into this repository last time.
 *
 * Ownership is recorded, not inferred. `regenerate` means "ours, refresh it", and
 * taking that from the path alone destroyed a project's own `scripts/gate/run.mjs`
 * on the first install; taking it from a marker in the content missed every file
 * whose format cannot carry one. A list written at the time it happened answers both
 * without guessing.
 */
//
// `--adopt` is the way back for a file that really is ours and cannot prove it: an
// install made before this record existed leaves its files unrecognisable, and
// without a way to claim them the gate quietly stops being refreshed forever. The
// claim is the operator's to make and is written down, never inferred.
const ADOPT = (() => {
  const i = process.argv.indexOf('--adopt')
  if (i === -1) return []
  const list = process.argv[i + 1]
  return list === 'all' ? 'all' : (list ?? '').split(',').map(p => p.trim()).filter(Boolean)
})()

const manifestPath = join(target, '.ds', 'installed.json')
const installedBefore = new Set((() => {
  try { return JSON.parse(readFileSync(manifestPath, 'utf8')).paths ?? [] } catch { return [] }
})())

const weWrote = new Set()
let written = 0
let skipped = 0
let mergedCount = 0
for (const item of plan) {
  if (chosen && !chosen.has(item.path)) continue
  const abs = join(target, item.path)
  const exists = existsSync(abs)

  /**
   * Whether the file at this path is one we wrote.
   *
   * `regenerate` means "ours, refresh it on the next install", and it was taken on
   * trust from the path alone. A project that already had `scripts/gate/run.mjs` —
   * its own file, its own contents — had it silently replaced on the FIRST install,
   * because the path matched. That is destroying somebody's work while reporting
   * `refresh`, and it is the one thing this tool must never do.
   *
   * Every generated file carries the line that says so. A file at our path without
   * it is theirs, whatever it is called.
   */
  const oursAlready = (() => {
    if (!exists) return false
    // What was written last time, recorded at the time. Deciding ownership from the
    // file's contents needed a marker every format could carry, and six of this
    // tool's own files — a JSON loop definition, a copied library — have no place to
    // put a comment. They came back as "theirs" on the second install and the gate
    // silently stopped being refreshed.
    if (installedBefore.has(item.path)) return true
    if (ADOPT === 'all' || ADOPT.includes(item.path)) return true
    // Installs made before the manifest existed have no record, so the marker is
    // still read where a file can carry one.
    // Both markers. Files written before the rename carry the old one, and a gate
    // that stopped recognising its own past output would report every one of them as
    // the project's and quietly stop refreshing them.
    try {
      const text = readFileSync(abs, 'utf8')
      return text.includes('AI FactoryFit install') || text.includes('ds-profile install')
    } catch { return false }
  })()

  const action = SKIPPED.includes(item.path) ? 'skip (--skip)'
    : item.merge ? (exists ? 'merge' : 'create')
      : exists && item.regenerate && oursAlready ? 'refresh'
        : exists && item.regenerate ? 'skip (theirs)'
          : exists && !force ? 'skip (exists)'
            : exists ? 'OVERWRITE' : 'create'

  console.log(`  ${apply && !action.startsWith('skip') ? '+' : '·'} ${item.path.padEnd(32)} ${action.padEnd(14)} ${item.why}`)

  if (!apply) continue
  if (action === 'skip (theirs)') {
    // Said loudly, not logged and forgotten. A gate file that is theirs means the
    // gate will not run as generated, and that has to be a decision somebody makes
    // rather than something they discover later.
    console.log(`      this path already holds a file this tool did not write — it was left alone`)
    console.log(`      keep it, or if it IS one of ours from an earlier install:  --adopt ${item.path}`)
  }
  if (action.startsWith('skip')) { skipped += 1; continue }
  if (item.merge) {
    const result = mergeJson(abs, item.content)
    if (!result.ok) { console.log(`      ${result.reason}`); skipped += 1; continue }
    if (result.added.length === 0) { skipped += 1; continue }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, JSON.stringify(result.merged, null, 2) + '\n')
    console.log(`      merged: ${result.added.join(', ')}${result.existed ? ' (nothing else touched)' : ''}`)
    weWrote.add(item.path)
    mergedCount += 1
    continue
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, item.content)
  if (item.mode) chmodSync(abs, item.mode)
  weWrote.add(item.path)
  written += 1
}

// The record, written last so it lists what actually landed rather than what was
// planned. A merge counts: the file is partly ours and re-merging it is safe, which
// is the question this list is asked.
if (apply) {
  const paths = [...new Set([...installedBefore, ...weWrote])].sort()
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify({
    _: 'Paths this tool wrote into this repository. It refreshes these on a later install and refuses to touch anything else, so a file of yours at one of these paths is safe the moment you remove it from this list.',
    schemaVersion: 1,
    paths,
  }, null, 2) + '\n')
}

// ── What was already red before any of this arrived ───────────────────────────
//
// The gate delegates to the project's own scripts, so if one of them was failing
// yesterday the gate is red today and gets the blame. Installed into memos, the
// gate's own checks passed and `npm run lint` did not — on a file this tool never
// touched. A team seeing that for the first time at the commit hook concludes the
// gate broke their build.
//
// So the state of their checks is recorded before the gate starts running them,
// and reported as theirs. Nothing is fixed and nothing is forgiven: the point is
// only that the two are told apart on day one.

const preexisting = []
{
  const theirScripts = (() => {
    try { return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).scripts ?? {} } catch { return {} }
  })()
  // Only the fast, deterministic ones. A full test run is not something to make
  // an install wait on, and its result would be stale by the time it mattered.
  for (const name of ['lint', 'typecheck', 'lint:css']) {
    if (!theirScripts[name]) continue
    try {
      execFileSync('npm', ['run', '--silent', name], {
        cwd: target, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
      })
      preexisting.push({ name, ok: true })
    } catch (error) {
      const out = String(error.stdout ?? '') + String(error.stderr ?? '')
      const missing = /command not found|: not found|ENOENT|Cannot find module/i.test(out)
      preexisting.push({
        name,
        ok: false,
        missing,
        first: out.split('\n').map(l => l.trim()).filter(Boolean).find(l => !l.startsWith('>'))?.slice(0, 120),
      })
    }
  }
}

const alreadyRed = preexisting.filter(p => !p.ok && !p.missing)
const couldNotRun = preexisting.filter(p => p.missing)

if (!apply) {
  console.log('\nPlan only — nothing was written. Add --apply to install.')
} else {
  console.log(`\nwrote ${written} file(s), merged into ${mergedCount}, skipped ${skipped}.`)
  console.log('Enable the hook in this repository:  git config core.hooksPath .githooks')
  console.log(`Permissions:                        ${permissions.permissions.allow.length} allowed from this project's own scripts, ${permissions.permissions.deny.length} denied outright — see .ds/permissions.md`)
  if (budget) {
    console.log(`Context budget written:             ${budget.total} token(s) on every task — run \`node scripts/gate/context.mjs\``)
  }
  if (loop) {
    console.log(`Loop written:                       ${loop.gateCount} human gate(s) from the ${loop.level} level — run \`node scripts/loop/run.mjs\``)
  }
  if (scoped.length) {
    console.log(`Scoped rules written:               ${scoped.map(r => r.path.replace('.cursor/rules/', '')).join(', ')} — loaded only where they apply`)
  }
  if (evals.covered?.length) {
    console.log(`Evals generated:                    ${evals.covered.length} break(s) from ${evals.reference} — run \`node evals/run.mjs\``)
  } else if (evals.why) {
    console.log(`Evals not generated:                ${evals.why}`)
  }
  console.log(contractReachableAt
    ? `AGENTS.md already reachable:        ${relative(target, contractReachableAt).split(sep).join('/')} — point it at .ds/CONVENTIONS.md yourself, so the two cannot drift`
    : 'AGENTS.md written:                  it points at .ds/CONVENTIONS.md rather than repeating it')

  // Which agents this repository carries, and which it does not. The second half is
  // the useful one: a team adopting Cursor next month can see, from the install they
  // already ran, exactly what would be written for it and why.
  console.log(`Hosts here:                         ${hosts.present.map(h => h.assumed ? `${h.name} (portable, written regardless)` : h.name).join(' · ')}`)
  for (const h of hosts.absent) {
    console.log(`  nothing written for ${h.name} — it would take ${h.writes.join(', ')}`)
  }
}

if (alreadyRed.length || couldNotRun.length) {
  console.log('\nTHIS REPOSITORY BEFORE THE GATE ARRIVED')
  for (const p of alreadyRed) {
    console.log(`  npm run ${p.name} — ALREADY FAILING${p.first ? `: ${p.first}` : ''}`)
  }
  for (const p of couldNotRun) {
    console.log(`  npm run ${p.name} — could not run here; dependencies are probably not installed`)
  }
  console.log('  The gate runs these, so it will be red until they are. That is their state,')
  console.log('  not something this installed, and none of it was baselined away.')
} else if (preexisting.length) {
  console.log(`\nTheir own checks pass today (${preexisting.map(p => p.name).join(', ')}), so a red gate will mean a regression.`)
}
