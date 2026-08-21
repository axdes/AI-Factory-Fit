/**
 * Scan an arbitrary repository along two axes.
 *
 *   1. CONVENTIONS — how code is written here, as measured distributions rather
 *      than opinion. A pattern above the dominance threshold is a convention we
 *      will hold new code to; anything below is a finding the team has to settle,
 *      not a choice we make for them.
 *
 *   2. TOOLCHAIN — what enforcement the repository already carries, and what is
 *      missing. The missing list is the work order for `install`.
 *
 * Recency matters: a repository averaged over its whole history canonises the
 * style a team is moving away from. Every convention is therefore measured twice,
 * over all files and over recently touched ones, and a disagreement between the
 * two is reported as direction of travel.
 *
 * Read-only. Nothing is written into the scanned repository; results land in
 * scans/<name>/ inside this tool.
 *
 * Vendored copies must be excluded. A snapshot of somebody else's package sitting
 * inside the repository is not this team's code, and averaging it in measures the
 * wrong house style — the same trap as averaging in a legacy zone.
 *
 *   node scripts/scan.mjs <path-to-repo> [--days 180] [--exclude ds,vendor]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { SIGNALS, STRONG, WEAK, MIN_OBSERVATIONS, TOOL_EXT, walk, scanSlot, projectRoots, installedHere } from './lib/signals.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const daysArg = process.argv.indexOf('--days')
const RECENT_DAYS = daysArg === -1 ? 180 : Number(process.argv[daysArg + 1] ?? 180)
const excludeArg = process.argv.indexOf('--exclude')
const EXCLUDED = excludeArg === -1
  ? []
  : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/scan.mjs <path-to-repo> [--days 180] [--exclude ds,vendor]')
  process.exit(2)
}

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const isExcluded = (abs) => excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep))

/**
 * Code written to be an example is not code written to be followed.
 *
 * A fixture exists to demonstrate a shape — often a wrong one. This repository's own
 * scan read 151 files of which 138 were fixtures, including one called `Bad.tsx`,
 * and reported the resulting mixture as its house style: `component export split
 * 60%`, `props declaration split 53%`. Those splits are the fixtures disagreeing on
 * purpose, and `install` would have written them into a gate.
 *
 * Almost every real repository has such a directory. The line is narrow on purpose,
 * and was drawn too wide once: `examples/` went in with them until three real
 * libraries were measured. Chakra-ui keeps half its repository there and element-plus
 * a quarter, and both are canonical snippets written by the maintainers to be copied
 * — code written to be FOLLOWED, which is the best evidence of a house style there
 * is, and dropping it threw away half the answer.
 *
 * So only the trees whose purpose is to be various or wrong. Tests stay too: a team's
 * tests follow its house style, and `test placement` cannot be measured without them.
 */
const IS_FIXTURE = /(^|\/)(fixtures|__fixtures__|__mocks__)\//

const allWalked = walk(target)
const fixtures = allWalked.filter(abs => IS_FIXTURE.test(relative(target, abs).split(sep).join('/')))
const fixtureSet = new Set(fixtures)
const files = allWalked.filter(abs => !isExcluded(abs) && !fixtureSet.has(abs))
const excludedCount = allWalked.length - files.length
const fixtureCount = fixtures.filter(abs => !isExcluded(abs)).length

/** Paths touched inside the recency window, per git. Empty when not a repo. */
function recentlyTouched() {
  try {
    const out = execFileSync('git', ['-C', target, 'log', `--since=${RECENT_DAYS} days ago`, '--name-only', '--pretty=format:'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    return new Set(out.split('\n').map(l => l.trim()).filter(Boolean))
  } catch {
    return undefined
  }
}

const recent = recentlyTouched()
const isRecent = (abs) => recent === undefined ? false : recent.has(relative(target, abs).split(sep).join('/'))

function tally(fileList) {
  const result = {}
  for (const abs of fileList) {
    let src
    try { src = readFileSync(abs, 'utf8') } catch { continue }
    for (const [dimension, signal] of Object.entries(SIGNALS)) {
      const bucket = signal(abs, src)
      if (!bucket) continue
      result[dimension] ??= {}
      result[dimension][bucket] ??= { count: 0, examples: [] }
      result[dimension][bucket].count += 1
      if (result[dimension][bucket].examples.length < 3) {
        result[dimension][bucket].examples.push(relative(target, abs))
      }
    }
  }
  return result
}

function summarise(counts) {
  const out = {}
  for (const [dimension, buckets] of Object.entries(counts)) {
    const entries = Object.entries(buckets).sort((a, b) => b[1].count - a[1].count)
    const total = entries.reduce((sum, [, v]) => sum + v.count, 0)
    const [topName, topValue] = entries[0]
    const share = topValue.count / total
    out[dimension] = {
      // The count comes before the share. A dimension seen once is 100% by
      // arithmetic, and calling that a convention is how the installer ends up
      // writing a rule the team never made.
      verdict: total < MIN_OBSERVATIONS ? 'too few to say'
        : share >= STRONG ? 'convention' : share >= WEAK ? 'weak' : 'split',
      dominant: topName,
      share: Number(share.toFixed(3)),
      total,
      distribution: Object.fromEntries(entries.map(([name, v]) => [name, v.count])),
      examples: topValue.examples,
    }
  }
  return out
}

const allFiles = files
const recentFiles = recent === undefined ? [] : files.filter(isRecent)

const conventions = summarise(tally(allFiles))
const conventionsRecent = recentFiles.length >= 10 ? summarise(tally(recentFiles)) : undefined

// Direction of travel: a dimension whose dominant pattern differs between the
// whole history and the recent window is a team in the middle of a move. Holding
// new code to the all-time answer would push against them.
const drift = []
if (conventionsRecent) {
  for (const [dimension, recentEntry] of Object.entries(conventionsRecent)) {
    const allEntry = conventions[dimension]
    if (!allEntry) continue
    if (allEntry.dominant !== recentEntry.dominant) {
      drift.push({ dimension, allTime: allEntry.dominant, recent: recentEntry.dominant })
    } else if (recentEntry.share - allEntry.share > 0.15) {
      drift.push({ dimension, consolidating: recentEntry.dominant, from: allEntry.share, to: recentEntry.share })
    }
  }
}

// ── Toolchain audit ───────────────────────────────────────────────────────────

// A package inside a workspace inherits its root's linters, formatter and CI.
// Auditing the package alone reported a repository with a full toolchain as
// having one mechanism of twenty-two.
const ancestors = projectRoots(target)

const packages = ancestors
  .map(base => join(base, 'package.json'))
  .filter(existsSync)
  .map(f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} } })

const deps = Object.assign({}, ...packages.map(p => ({ ...p.dependencies, ...p.devDependencies })).reverse())
const scripts = Object.assign({}, ...packages.map(p => p.scripts ?? {}).reverse())
const scriptText = Object.values(scripts).join(' ; ')

const hasFile = (...candidates) => candidates.some(c => ancestors.some(base => existsSync(join(base, c))))
const hasDep = (...names) => names.some(n => n in deps)
const hasScript = (re) => Object.keys(scripts).some(k => re.test(k)) || re.test(scriptText)

// Conventions are measured on owned product source only. The toolchain audit
// asks a different question — what the repository CARRIES — so it looks at the
// whole tree and at the wider set of extensions build tooling actually uses.
// The gate we installed is not evidence that this repository carries a gate.
const ours = installedHere(target)
const toolFiles = walk(target, [], TOOL_EXT).filter(f => !ours(f))
const workspaceFiles = ancestors.length > 1
  ? walk(ancestors[ancestors.length - 1], [], TOOL_EXT)
  : toolFiles
const anyFile = (re) => toolFiles.some(f => re.test(relative(target, f)))
  || workspaceFiles.some(f => re.test(relative(ancestors[ancestors.length - 1], f)))

const TOOLCHAIN = {
  'agent contract': hasFile('AGENTS.md', 'CLAUDE.md'),
  'JS/TS linter': hasDep('eslint', 'oxlint') || hasFile('eslint.config.js', 'eslint.config.mjs', '.eslintrc.json', '.eslintrc.cjs'),
  'CSS linter': hasDep('stylelint') || hasFile('.stylelintrc.json', '.stylelintrc'),
  'project-specific linter': anyFile(/scripts[\\/].*lint.*\.(mjs|js|ts)$/),
  'strict TypeScript': ['tsconfig.json', 'tsconfig.base.json'].some(f => existsSync(join(target, f)) && /"strict"\s*:\s*true/.test(readFileSync(join(target, f), 'utf8'))),
  'unit tests': hasDep('vitest', 'jest') && anyFile(/\.(test|spec)\.[tj]sx?$/),
  'accessibility tests': hasDep('vitest-axe', 'jest-axe', '@axe-core/react'),
  'visual baselines': hasDep('playwright', '@playwright/test', 'puppeteer') && hasScript(/visual|screenshot/),
  'contrast check': hasScript(/contrast/),
  'component registry': anyFile(/component-(registry|index)\.json$/),
  'token tiers': anyFile(/(primitives|semantic|settings|tokens)\.(css|scss|json)$/),
  'token export (DTCG)': anyFile(/\.tokens\.json$/),
  'screen specs': anyFile(/screen-specs?[\\/]/),
  'duplication check': hasDep('jscpd'),
  'dead code check': hasDep('knip', 'ts-prune'),
  'context budget': hasScript(/context/),
  'secret scan': hasScript(/secret|gitleaks/) || hasDep('gitleaks'),
  'pre-commit hook': hasFile('.githooks/pre-commit', '.husky/pre-commit', 'lefthook.yml', '.pre-commit-config.yaml'),
  'CI pipeline': hasFile('.gitlab-ci.yml', '.github/workflows', 'azure-pipelines.yml', 'Jenkinsfile'),
  'gate aggregate': hasScript(/^check(:|$)/),
  'agent evals': anyFile(/evals?[\\/]/) || hasScript(/eval/),
  'MCP surface': hasFile('.mcp.json', 'mcp'),
}

const present = Object.entries(TOOLCHAIN).filter(([, v]) => v).map(([k]) => k)
const missing = Object.entries(TOOLCHAIN).filter(([, v]) => !v).map(([k]) => k)

// ── Mode ──────────────────────────────────────────────────────────────────────
// Which of the three situations we walked into decides the whole engagement.

/**
 * How many dimensions there were to answer, which is not how many were answered.
 *
 * The guard against judging a project on too little used to divide by the dimensions
 * PRESENT in the result, and a dimension nothing spoke to was absent rather than
 * zero. Six identical files answered three of eleven and came back "settled — a
 * system exists and is followed": three of three is a share of one, and the guard
 * meant to catch exactly that had nothing to compare against.
 *
 * The denominator is what this tool can measure. It is deliberately NOT padded into
 * the table: a dimension can be missing because the project is too small to have
 * spoken to it, or because the language has no such axis — Svelte has no component
 * export, the file is the component — and printing a row for the second would tell a
 * team they are missing something they can never have. Unanswered is counted, and
 * only counted.
 */
const MEASURABLE = Object.keys(SIGNALS).length

const verdicts = Object.values(conventions).map(c => c.verdict)
// Over what this tool measures, not over what happened to answer. Dividing by the
// dimensions present made three settled dimensions out of three a share of one, and
// `settled — a system exists and is followed` is decided from this before the guard
// against judging on too little is ever reached.
const strongShare = verdicts.filter(v => v === 'convention').length / MEASURABLE
// Whether there is anything here this tool can read.
//
// A Python service with source in it came back as "greenfield — no house style to
// honour", which is not a low score but a wrong statement about a repository full
// of code. Nought files measured is true and "greenfield" is a lie, and the two
// were printed as one sentence.
//
// So the languages present are counted before a mode is assigned, and a project
// whose source this pass cannot read is told that plainly.
//
// `.vue` and `.svelte` both came off this list when the signals learned to read them:
// a language that is now measured must not also be counted as one that is not, or the
// project is told both that its conventions were extracted and that nothing below is
// a measurement of it. Anything still on the list is here because nothing in this
// tool opens it — which is the whole point of the list.
const UNREADABLE = { '.py': 'Python', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby',
  '.php': 'PHP', '.rs': 'Rust', '.cs': 'C#', '.swift': 'Swift', '.dart': 'Dart', '.ex': 'Elixir' }
const otherLanguages = (() => {
  const counts = {}
  // Deduplicated by path. The tool walk and this one overlap wherever an extension
  // is in both sets, and counting a file twice reported "4 file(s) against 2
  // readable" over a project holding two.
  for (const f of new Set(toolFiles.concat(walk(target, [], new Set(Object.keys(UNREADABLE)))))) {
    const ext = f.slice(f.lastIndexOf('.'))
    if (UNREADABLE[ext]) counts[UNREADABLE[ext]] = (counts[UNREADABLE[ext]] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
})()

const otherCount = otherLanguages.reduce((n, [, c]) => n + c, 0)
const outOfScope = files.length === 0 && otherLanguages.length > 0
// Readable source exists, but it is the minority. "Drifted" is true of the 25
// TypeScript files in a Vue application and reads as a statement about the
// application, so the share it was measured over travels with it.
const partial = !outOfScope && otherCount > files.length

// How many dimensions this project has actually settled, not just their share.
//
// A share alone said "greenfield — no house style to honour" about documenso: 542
// files, three conventions at 95% or better over 1,083 observations, and the
// installer wrote all three into that client's gate as enforced rules. The label
// contradicted what the tool itself then did, and it is the first line a consultant
// reads. "Greenfield" has to mean there is nothing to honour, and here there were
// three things.


const settledCount = verdicts.filter(v => v === 'convention').length
// A dimension with no dominant pattern at all: the project does it two ways and has
// not chosen. This is the only direct evidence of a system coming apart, as opposed
// to one that was never uniform to begin with.
const splitCount = verdicts.filter(v => v === 'split').length
const readableCount = verdicts.filter(v => v !== 'too few to say').length
const splitShare = readableCount ? splitCount / readableCount : 0

const mode = outOfScope
  ? `OUT OF SCOPE — this pass reads JavaScript and TypeScript, and the source here is ${otherLanguages.map(([l, n]) => `${l} (${n} file(s))`).join(', ')}. Nothing below is a measurement of this project.`
  : files.length === 0
    ? 'EMPTY — no readable source here at all. Nothing was measured, and anything brought in is the client\'s decision from a blank page.'
  : (partial ? `${otherLanguages[0][0]} is the majority of this source (${otherCount} file(s) against ${files.length} readable); what follows was measured over the readable minority only. ` : '') + (strongShare >= 0.7
  ? 'settled — a system exists and is followed; extract it and write indistinguishably'
  // "Came apart" is a claim, and the evidence for it is a dimension the project
  // answers two ways — a `split`. Deciding it from the share of STRONG dimensions
  // alone said `drifted` about 19 of 38 measured projects, and 10 of those had no
  // split at all: react-query with 5 of 5 settled, outline with 6, and this tool's
  // own three reference applications, built to be exemplary, at 4 of 4, 3 of 3 and
  // 4 of 4. Telling a team that keeps one way of doing everything that their system
  // came apart is wrong, and it is the first line a consultant reads to them.
  //
  // A fifth of the readable dimensions having no dominant answer is disagreement.
  // Below that a house style exists and is merely not uniform, which `mixed` already
  // says accurately — honour what is settled, the rest is the team's to settle.
  : strongShare >= 0.4 && splitShare >= 0.2
    ? `drifted — ${splitCount} of ${readableCount} readable dimension(s) are done two ways with no majority; a system existed and came apart. Put those splits to the team, then ratchet`
    // Four situations, not three, and "not enough written yet" is checked before
    // "some of it is settled" — a project answering two dimensions of nine can have
    // one of those two settled, and that is one measurement rather than a house
    // style. The floor is measured, not guessed: real products answer 78–100% of
    // these dimensions (documenso 7 of 9, memos 9 of 10, formbricks 10 of 10) while
    // a small repository answers 17–22%. Half separates them with room to spare.
    : readableCount < MEASURABLE / 2
      ? `too early to say — only ${readableCount} of ${MEASURABLE} dimension(s) this tool measures have enough written to answer, across ${files.length} readable file(s). Nothing is claimed about the house style because nothing can be.`
      : settledCount > 0
        ? `mixed — ${settledCount} of ${readableCount} readable dimension(s) are settled and the rest are open. Honour the ${settledCount}; the others are the team's to settle, not ours to average.`
        : 'greenfield — nothing here is settled, so there is no house style to honour; bringing one in is a decision for the client')

// ── Output ────────────────────────────────────────────────────────────────────

const name = scanSlot(target)
const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })

const report = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  scannedFiles: files.length,
  // Named in the artifact as well as on screen: a downstream reader deciding whether
  // to trust a share needs to know what was not counted, and why.
  excluded: {
    paths: EXCLUDED,
    files: excludedCount,
    byRequest: excludedCount - fixtureCount,
    fixtures: fixtureCount,
    _: fixtureCount ? 'fixture and mock trees are written to vary, so they are not evidence of a house style; examples are kept, being written to be copied' : undefined,
  },
  recencyWindowDays: RECENT_DAYS,
  recentFiles: recentFiles.length,
  mode,
  conventions,
  conventionsRecent,
  drift,
  toolchain: { present, missing },
}
writeFileSync(join(outDir, 'scan.json'), JSON.stringify(report, null, 2) + '\n')

const pct = (n) => `${Math.round(n * 100)}%`
const mark = { convention: '✓', weak: '~', split: '✗', 'too few to say': '·' }

console.log(`\nscan: ${target}`)
// What was left out, and why. `138 excluded ()` — an empty reason — is worse than no
// line: it says a majority of the repository was dropped and refuses to say by what
// rule, so nobody can check whether the right things went.
const why = [
  EXCLUDED.length ? `${excludedCount - fixtureCount} by --exclude ${EXCLUDED.join(',')}` : undefined,
  fixtureCount ? `${fixtureCount} in fixture or mock trees, which are written to vary` : undefined,
].filter(Boolean).join(' · ')
console.log(`${files.length} files${excludedCount ? ` · ${excludedCount} not read (${why})` : ''} · ${recent === undefined ? 'not a git repository' : `${recentFiles.length} touched in the last ${RECENT_DAYS} days`}`)
console.log(`\nMODE  ${mode}\n`)

console.log('CONVENTIONS — what the code already agrees on')
// Widened to whatever is actually present. A hand-counted column stops lining up the
// first time a dimension with a longer name is added, and a report that does not line
// up reads as one nobody looked at.
const nameWidth = Math.max(20, ...Object.keys(conventions).map(d => d.length))
for (const [dimension, c] of Object.entries(conventions)) {
  const others = Object.entries(c.distribution).slice(1)
    .map(([n, v]) => `${n} ${pct(v / c.total)}`).join(' · ')
  console.log(`  ${mark[c.verdict]} ${dimension.padEnd(nameWidth)} ${c.dominant} ${pct(c.share)}${others ? `   (${others})` : ''}`)
}

if (drift.length) {
  console.log('\nDIRECTION OF TRAVEL — recent code disagrees with the average; hold new code to the recent answer')
  for (const d of drift) {
    console.log(d.recent
      ? `  → ${d.dimension}: was ${d.allTime}, now ${d.recent}`
      : `  → ${d.dimension}: ${d.consolidating} consolidating ${pct(d.from)} → ${pct(d.to)}`)
  }
}

console.log(`\nTOOLCHAIN — present ${present.length}/${present.length + missing.length}`)
for (const item of present) console.log(`  ✓ ${item}`)
if (missing.length) {
  console.log('\nMISSING — this is the work order for `install`')
  for (const item of missing) console.log(`  ✗ ${item}`)
}

const splits = Object.entries(conventions).filter(([, c]) => c.verdict === 'split')
if (splits.length) {
  console.log('\nUNDECIDED — put these to the team; do not pick for them')
  for (const [dimension, c] of splits) {
    console.log(`  ? ${dimension}: ${Object.entries(c.distribution).map(([n, v]) => `${n} ${pct(v / c.total)}`).join(' vs ')}`)
  }
}

console.log(`\nwritten to scans/${name}/scan.json`)
