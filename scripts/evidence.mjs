/**
 * The proof that a change is safe to take, assembled in one place.
 *
 * Every other command here produces a measurement. None of them produce the
 * thing a reviewer actually needs, which is all of them at once, about one change,
 * with the unchecked parts named. So the reviewer reads the diff and forms an
 * opinion, and that opinion is the bottleneck: everything upstream — the spec,
 * the generator, the gate — moves faster than one person can absorb proof.
 *
 * What makes this an evidence pack rather than a summary is that it fails closed.
 * A check that did not run is not a check that passed, and a pack whose checks
 * did not run says NOT PROVEN in the place where a verdict would go. A reviewer
 * who cannot tell those apart is back to reading the diff.
 *
 * Four questions, in the order a reviewer asks them:
 *
 *   what changed        the files, and whether they are the ones the work claimed
 *   does it hold        the gate, the score, the project's own checks
 *   what got worse      measured against the baseline, not against nothing
 *   what was not checked the honest half, and the reason this is readable at all
 *
 *   node scripts/evidence.mjs <repo> [--since main] [--out FILE.md]
 */
import { counted } from './lib/counted.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { scanSlot } from './lib/signals.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}
const target = process.argv[2]
const SINCE = arg('--since')
const OUT = arg('--out')

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/evidence.mjs <repo> [--since main] [--out FILE.md]')
  process.exit(2)
}

const name = scanSlot(target)
const readScan = (file) => {
  const at = join(root, 'scans', name, file)
  if (!existsSync(at)) return undefined
  try { return JSON.parse(readFileSync(at, 'utf8')) } catch { return undefined }
}

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch { return undefined }
}

// ── 1. What changed ───────────────────────────────────────────────────────────
//
// From git, because the alternative is asking the person being reviewed which
// files they changed. The base is named in the pack: "against main" and "against
// the last commit" are different claims and a reviewer has to know which.

const inGit = git('rev-parse', '--is-inside-work-tree') === 'true'
const base = (() => {
  if (!inGit) return undefined
  if (SINCE) return SINCE
  for (const candidate of ['origin/HEAD', 'origin/main', 'main', 'master']) {
    const resolved = git('merge-base', 'HEAD', candidate)
    if (resolved) return candidate
  }
  return undefined
})()

const changed = (() => {
  if (!inGit) return { available: false, why: 'not a git repository, so there is no way to tell what changed' }
  const committed = base ? git('diff', '--name-only', `${base}...HEAD`) : undefined
  // -uall, or an untracked directory collapses to one line and the reviewer is
  // handed `.ds/` where they asked which files.
  const working = git('status', '--porcelain', '-uall')
  const files = new Set()
  for (const line of (committed ?? '').split('\n').filter(Boolean)) files.add(line.trim())
  for (const line of (working ?? '').split('\n').filter(Boolean)) files.add(line.slice(3).trim())
  if (!base && !working) return { available: false, why: 'no base branch resolved and no uncommitted work; nothing to compare against' }
  return {
    available: true,
    base: base ?? 'the working tree only',
    files: [...files].filter(Boolean).sort(),
    commits: base ? (git('log', '--oneline', `${base}..HEAD`) ?? '').split('\n').filter(Boolean).length : 0,
  }
})()

// ── 2. Does it hold ───────────────────────────────────────────────────────────
//
// The project's own gate, run now rather than quoted from a previous run. A pack
// assembled from artifacts on disk is a pack that can be stale, and stale proof
// is the failure this whole tool exists to avoid.

const runCheck = (label, command, args, cwd = target) => {
  const at = Date.now()
  try {
    const out = execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return { label, verdict: 'passed', ms: Date.now() - at, output: out.trim().split('\n').slice(-4).join('\n') }
  } catch (error) {
    if (error.code === 'ENOENT') return { label, verdict: 'not run', why: `${command} is not installed here`, ms: Date.now() - at }
    const out = String(error.stdout ?? '') + String(error.stderr ?? '')
    // The distinction the gate learned: a command that could not start is not a
    // failing check, and calling it one sends a reviewer to read correct code.
    if (/command not found|: not found|ENOENT|Cannot find module|Cannot find package/i.test(out)) {
      return { label, verdict: 'not run', why: out.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 120), ms: Date.now() - at }
    }
    return {
      label, verdict: 'failed', ms: Date.now() - at,
      output: out.trim().split('\n').slice(-12).join('\n'),
      // The whole output, kept for deciding whether the failure is about this
      // change. Searching the truncated version would call a failure pre-existing
      // because the line naming the file fell off the top.
      full: out,
    }
  }
}

const checks = []
const gateRunner = join(target, 'scripts', 'gate', 'run.mjs')
if (existsSync(gateRunner)) {
  checks.push(runCheck('the installed gate', process.execPath, [gateRunner]))
} else {
  checks.push({ label: 'the installed gate', verdict: 'not run', why: 'no gate is installed here; run `ds install` first' })
}

const theirScripts = (() => {
  try { return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).scripts ?? {} } catch { return {} }
})()
for (const script of ['lint', 'typecheck', 'test']) {
  if (theirScripts[script]) checks.push(runCheck(`npm run ${script}`, 'npm', ['run', '--silent', script]))
}

// ── 3. What got worse ─────────────────────────────────────────────────────────
//
// Against the measurement that was recorded, not against zero. A count with no
// baseline is a number a reviewer cannot act on: 72 accessibility findings means
// nothing until it is 72 where there were 70.

const defects = readScan('defects.json')
const deep = readScan('deep.json')
const security = readScan('security.json')
const baselinePath = join(target, '.ds', 'baseline.json')
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined

// Each measurement against what it was measured over, so a count that had nothing
// to count leaves this list rather than sitting in it as a zero. A pack that
// carries "0 contrast pairs below AA" over zero pairs compared is the pack a
// reviewer stops reading the caveats of.
const dOver = defects?.considered ?? {}
const sOver = security?.considered ?? {}
const candidates = [
  defects && ['accessibility findings', counted(defects.counts.a11yFindings, dOver.files, 'files', 'the linter did not run'), 'oxlint jsx-a11y'],
  defects && ['contrast pairs below AA', counted(defects.counts.contrastFailures, dOver.contrastPairs, 'colour pairs', 'no rule sets both a colour and a background'), 'WCAG 2.2 §1.4.3'],
  defects && ['modules built twice', counted(defects.counts.duplicatePairs, dOver.modules, 'modules'), 'whole-file similarity'],
  security && ['dependency advisories, high and critical', counted(security.counts.dependencyAdvisories, 1, 'lockfiles', security.dependencies.why), `${security.dependencies.manager ?? 'package manager'} audit`],
  security && ['secrets in the working tree', counted(security.counts.secrets, sOver.files, 'files'), 'fixed-prefix shapes'],
  security && ['dangerous source patterns', counted(security.counts.sourceFindings, sOver.files, 'files'), 'construct without its mitigation'],
  deep?.architecture?.modulesInCycles !== undefined && ['modules in import cycles', counted(deep.architecture.modulesInCycles, deep.architecture.modules, 'modules', `dependency-cruiser resolved no modules here (${deep.architecture.analysedBy})`), 'dependency-cruiser'],
  deep?.composition && ['screens handling all three states', counted(deep.composition.statesHandled?.allThree, deep.composition.screens, 'screens', 'no screen was identified in this project'), 'share, by identifier'],
].filter(Boolean)

const measured = candidates.filter(([, c]) => c.ran).map(([label, c, source]) => [label, c.count, `${source}, over ${c.considered} ${c.unit}`])
const unmeasured = candidates.filter(([, c]) => !c.ran).map(([label, c]) => `${label}: ${c.why}`)

// ── 4. What was not checked ───────────────────────────────────────────────────
//
// Collected from what each pass recorded about itself. This section is why the
// rest is readable: a reviewer who knows the shape of the hole can decide whether
// it matters here, and one who does not has to assume the worst about everything.

const unchecked = []
for (const [source, limits] of [['defects', defects?.limits], ['deep', deep?.limits], ['security', security?.limits]]) {
  for (const [what, text] of Object.entries(limits ?? {})) {
    if (Array.isArray(text)) { for (const t of text) unchecked.push({ source, what, text: t }) }
    else if (typeof text === 'string') unchecked.push({ source, what, text })
  }
}
const notRun = [
  ...checks.filter(c => c.verdict === 'not run').map(c => `${c.label}: ${c.why}`),
  // Everything that had nothing to count arrives here rather than appearing above
  // as a zero. This includes the two that were already handled by name — they now
  // come through the same path as the rest instead of each being special-cased.
  ...unmeasured,
  deep?.architecture?.analysedBy === 'not analysed' ? `architecture: ${deep.architecture.reason}` : undefined,
].filter(Boolean)

// ── Verdict ───────────────────────────────────────────────────────────────────
//
// Three states, never two. "Proven" and "failed" are both answers; a pack whose
// checks did not run has no answer, and saying so is the entire point — a
// reviewer who is handed a green pack assembled from checks that never executed
// is worse off than one handed nothing.

// Whether a failing check is about this change at all.
//
// memos' lint was red before any of this arrived, on a file nothing here touched.
// A pack that reports FAILED without saying so is a pack that gets argued with
// instead of acted on, and the argument is always the same one: "that was already
// broken". Checkable rather than assumed — if the failure output names none of
// the changed files, it is not about them.
const touchesChange = (output) => {
  if (!output || !changed.available || !changed.files.length) return true
  const bases = changed.files.map(f => f.split('/').pop()).filter(Boolean)
  return bases.some(b => output.includes(b))
}
for (const c of checks) {
  if (c.verdict === 'failed') { c.preexisting = !touchesChange(c.full); delete c.full }
}

const failed = checks.filter(c => c.verdict === 'failed')
const couldNotRun = checks.filter(c => c.verdict === 'not run')
const passed = checks.filter(c => c.verdict === 'passed')

const causedHere = failed.filter(c => !c.preexisting)

// A measurement that could not run counts against the verdict exactly as a check
// that could not run does. The first version looked only at the checks and
// printed PROVEN over a pack whose dependency audit never executed — the same
// green-where-nothing-was-looked failure this tool exists to catch, produced by
// the part of it that exists to catch it.
const verdict = causedHere.length ? 'FAILED'
  : failed.length ? 'FAILED ELSEWHERE'
  : passed.length === 0 ? 'NOT PROVEN'
  : (couldNotRun.length || notRun.length) ? 'PARTLY PROVEN'
  : 'PROVEN'

const pack = {
  schemaVersion: 1,
  // Undated on purpose: a pack is committed and diffed, and a date would make two
  // runs over an unchanged tree differ. The commit and the rules fingerprint are
  // stable for an unchanged tree and are what a reviewer actually needs.
  taken: taken(import.meta.url, target, { dated: false }),
  target,
  // No timestamp: it would make two runs of the same unchanged tree differ, and
  // the reviewer's question is about this tree, not about when it was read.
  verdict,
  changed,
  checks,
  measured: measured.map(([label, value, how]) => ({ label, value, how })),
  baseline: baseline ? { accepted: Object.values(baseline).flat().length, _: 'debt forgiven at install; a regression is what turns the gate red, not this' } : undefined,
  notRun,
  unchecked,
}

const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(pack, null, 2) + '\n')

// ── The document ──────────────────────────────────────────────────────────────

const pct = (v) => typeof v === 'number' && v <= 1 && v >= 0 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : String(v)
const md = [
  `# Evidence: ${name}`,
  '',
  `**${verdict}**`,
  '',
  verdict === 'PROVEN' ? 'Every check ran and passed. What each of them cannot see is at the bottom.'
    : verdict === 'FAILED ELSEWHERE' ? 'Checks failed, and none of the failures name a file this change touched. That is this repository\'s existing state, not this change — confirm it, then decide separately.'
    : verdict === 'PARTLY PROVEN' ? 'What ran, passed. Some checks did not run, and those are named — a check that did not run is not a check that passed.'
    : verdict === 'FAILED' ? 'At least one check failed. The output is below.'
    : 'Nothing was proven: no check completed. This pack is not evidence of anything.',
  '',
  '## What changed',
  '',
  ...(changed.available
    ? [`Against \`${changed.base}\`${changed.commits ? `, ${changed.commits} commit(s)` : ''} — ${changed.files.length} file(s).`, '',
      ...changed.files.slice(0, 40).map(f => `- \`${f}\``),
      changed.files.length > 40 ? `- …and ${changed.files.length - 40} more` : '']
    : [`Not established: ${changed.why}.`]),
  '',
  '## Does it hold',
  '',
  '| Check | Verdict | |',
  '|---|---|---|',
  ...checks.map(c => `| ${c.label} | **${c.verdict}**${c.preexisting ? ' (not about this change)' : ''} | ${c.verdict === 'not run' ? c.why ?? '' : c.ms !== undefined ? `${(c.ms / 1000).toFixed(1)}s` : ''} |`),
  '',
  ...failed.flatMap(c => [`### ${c.label} failed`, '', '```', c.output ?? '', '```', '']),
  '## What the measurements say',
  '',
  ...(measured.length
    ? ['| Measure | Value | How |', '|---|---|---|',
      ...measured.map(([label, value, how]) => `| ${label} | ${value === null ? '**not measured**' : pct(value)} | ${how} |`)]
    : ['No measurement artifacts on disk. Run `ds assess` first.']),
  '',
  ...(baseline ? [`${pack.baseline.accepted} violation(s) were accepted as debt when the gate was installed. A regression is what turns the gate red; this is not.`, ''] : []),
  '## What was not checked',
  '',
  ...(notRun.length ? ['**Did not run at all:**', '', ...notRun.map(n => `- ${n}`), ''] : []),
  'Every pass here records what it cannot see, and this is that record. It is the',
  'half of the pack that makes the other half readable.',
  '',
  ...unchecked.map(u => `- **${u.source}/${u.what}** — ${u.text}`),
  '',
].join('\n')

const mdPath = OUT ? (OUT.startsWith('/') ? OUT : join(target, OUT)) : join(outDir, 'evidence.md')
writeFileSync(mdPath, md)

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nevidence: ${target}`)
console.log(`${changed.available ? `${changed.files.length} file(s) changed against ${changed.base}` : changed.why}\n`)

for (const c of checks) {
  const mark = { passed: 'PASS   ', failed: 'FAIL   ', 'not run': 'NOT RUN' }[c.verdict]
  console.log(`  ${mark} ${c.label}${c.verdict === 'not run' ? ` — ${c.why}` : ''}${c.preexisting ? ' — names no file this change touched' : ''}`)
}

console.log('')
for (const [label, value, how] of measured) {
  console.log(`  ${String(value === null ? '—' : pct(value)).padStart(6)}  ${label}  — ${how}`)
}

console.log(`\n  ${verdict}`)
if (verdict === 'NOT PROVEN') console.log('  No check completed. This pack is not evidence of anything.')
if (verdict === 'FAILED ELSEWHERE') console.log('  Already red before this change; confirm, then decide separately.')
if (verdict === 'PARTLY PROVEN') {
  const n = couldNotRun.length + notRun.length
  console.log(`  ${n} check(s) or measurement(s) did not run, and what did not run did not pass:`)
  for (const item of [...couldNotRun.map(c => `${c.label}: ${c.why}`), ...notRun].slice(0, 5)) console.log(`    · ${item}`)
}

console.log(`\nwritten to ${relative(process.cwd(), mdPath).split(sep).join('/')} and scans/${name}/evidence.json`)
console.log('The reviewer reads this instead of forming an opinion from the diff. That')
console.log('opinion is the constraint: everything upstream moves faster than one person')
console.log('can absorb proof.')

// A pre-existing failure does not block this change, and does not pass either.
process.exit(verdict === 'FAILED' ? 1 : 0)
