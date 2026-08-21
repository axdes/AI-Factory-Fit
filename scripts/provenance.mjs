/**
 * Where this code came from, and what wrote it.
 *
 * Every other pass here says whether the code is right. None of them says where
 * it came from, and "somebody, at some point, possibly with an AI" is not an
 * answer anyone can file. In a regulated industry it is the question asked first,
 * and the reference architectures put an evidence layer under the whole lifecycle
 * for exactly this reason.
 *
 * The data is already there and already free. A commit made with an agent carries
 * a `Co-Authored-By:` trailer naming the model; a signed commit carries a
 * signature; a merge carries the branch it came from. This reads them back rather
 * than asking anybody to start recording something new.
 *
 * A report, not a gate, and deliberately. A rule that every commit must name its
 * model can only be true going forward, and a check that fails on history teaches
 * people to pass --no-verify — after which the record stops accumulating and the
 * question becomes permanently unanswerable. What makes this real is that the
 * trailer is written on every agent commit whether or not anyone reads it.
 *
 *   node scripts/provenance.mjs <repo>
 *   node scripts/provenance.mjs <repo> --since 2026-07-01
 *   node scripts/provenance.mjs <repo> --file src/App.tsx
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { scanSlot } from './lib/signals.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const target = process.argv[2]
const SINCE = flag('since')
const FILE = flag('file')

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/provenance.mjs <repo> [--since <date>] [--file <path>]')
  process.exit(2)
}

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  } catch { return undefined }
}

if (git('rev-parse', '--is-inside-work-tree')?.trim() !== 'true') {
  console.error('provenance: not a git repository, so there is no history to read.')
  console.error('This is not a clean result; it is no result. The question stays unanswered.')
  process.exit(1)
}

// ── Read ──────────────────────────────────────────────────────────────────────
//
// One record per commit. The separator is a byte no commit message contains,
// because a subject line with a newline in it silently merged two commits into
// one when this was split on newlines.

const SEP = '␞'
const raw = git('log', ...(SINCE ? [`--since=${SINCE}`] : []), ...(FILE ? ['--follow', '--', FILE] : []),
  `--pretty=format:%H%x1f%an%x1f%aI%x1f%G?%x1f%B${SEP}`)

if (raw === undefined) {
  console.error('provenance: git log failed. An empty repository has no history to read.')
  process.exit(1)
}

const commits = raw.split(SEP).map(block => block.trim()).filter(Boolean).map(block => {
  const [hash, author, date, signature, ...rest] = block.split('')
  const body = rest.join('')
  // The trailer as Claude Code, Codex, Copilot and Aider all write it. A model
  // name is whatever sits before the angle bracket, because the address is a
  // no-reply and the name is the fact.
  const coAuthors = [...body.matchAll(/^Co-Authored-By:\s*(.+?)\s*<([^>]*)>/gim)].map(m => ({
    name: m[1].trim(), email: m[2].trim(),
  }))
  return { hash, author, date, signature, coAuthors, body }
})

if (!commits.length) {
  console.error(`provenance: no commits${SINCE ? ` since ${SINCE}` : ''}${FILE ? ` touching ${FILE}` : ''}.`)
  process.exit(1)
}

// An agent is a co-author named as one, or writing from a domain that only an
// agent writes from.
//
// A first version also treated any no-reply address as an agent, which is how
// "Ephraim Duncan <…@users.noreply.github.com>" — a person using GitHub's privacy
// address, as most contributors do — was reported as a model. That single rule
// would have classified half of open source as AI-written, which is the loudest
// possible way for a provenance report to be wrong.
//
// The name is the signal, and the domain only where the domain is the vendor's.
const AGENT_NAME = /^(claude|chatgpt|gpt-|codex|copilot|gemini|cursor|aider|devin|windsurf|amp|jules)\b|\bbot\b$/i
const AGENT_DOMAIN = /@(anthropic|openai|users\.noreply\.cursor|githubcopilot)\./i
const isAgent = (c) => AGENT_NAME.test(c.name) || AGENT_DOMAIN.test(c.email)

const withAgent = commits.filter(c => c.coAuthors.some(isAgent))
const models = new Map()
for (const c of withAgent) {
  // One commit naming the same model twice is one commit. Counting occurrences
  // reported two commits for a history containing one.
  for (const name of new Set(c.coAuthors.filter(isAgent).map(a => a.name))) {
    models.set(name, (models.get(name) ?? 0) + 1)
  }
}

const humans = new Map()
for (const c of commits) humans.set(c.author, (humans.get(c.author) ?? 0) + 1)

const signed = commits.filter(c => ['G', 'U', 'X', 'Y', 'R'].includes(c.signature))

// When the record starts. A repository that adopted the trailer in July cannot be
// asked about June, and reporting one share over the whole history hides that:
// "8% of commits name a model" reads as a discipline problem when the truth is
// that the practice is six weeks old.
const firstAgentCommit = withAgent.at(-1)
const sinceAdoption = firstAgentCommit
  ? commits.filter(c => c.date >= firstAgentCommit.date)
  : []

const report = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  window: { since: SINCE ?? 'the whole history', file: FILE ?? null, commits: commits.length },
  counts: {
    commits: commits.length,
    namingAnAgent: withAgent.length,
    signed: signed.length,
    distinctAuthors: humans.size,
  },
  models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([name, commits]) => ({ name, commits })),
  adoption: firstAgentCommit
    ? {
      firstNamed: firstAgentCommit.date.slice(0, 10),
      sinceThen: sinceAdoption.length,
      shareSinceThen: Number((withAgent.length / sinceAdoption.length).toFixed(3)),
    }
    : undefined,
  limits: {
    trailer: 'Only commits carrying a `Co-Authored-By:` trailer can be counted, and only the tools that '
      + 'write one leave a record. A commit made with an agent that writes no trailer is indistinguishable '
      + 'from one written by hand — so a low share is "not recorded", never "not used".',
    signature: signed.length
      ? `${signed.length} commit(s) carry a signature, which says who pushed rather than what wrote.`
      : 'No commit here is signed, so authorship rests entirely on a name anyone can set.',
    scope: 'Git history only. What an agent was asked, what it read and what it rejected are not in a '
      + 'commit, and this cannot reconstruct them.',
  },
}

const outDir = join(root, 'scans', scanSlot(target))
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'provenance.json'), JSON.stringify(report, null, 2) + '\n')

// ── Report ────────────────────────────────────────────────────────────────────

const pct = (n, of) => of === 0 ? '—' : `${Math.round((n / of) * 100)}%`

console.log(`\nprovenance: ${target}`)
console.log(`${commits.length} commit(s)${SINCE ? ` since ${SINCE}` : ''}${FILE ? ` touching ${FILE}` : ''}\n`)

const line = (label, value, note) => console.log(`  ${String(value).padStart(6)}  ${label}${note ? `  — ${note}` : ''}`)
line('name an agent', withAgent.length, `${pct(withAgent.length, commits.length)} of all history`)
if (report.adoption) {
  line('since the practice began', sinceAdoption.length,
    `first on ${report.adoption.firstNamed}; ${pct(withAgent.length, sinceAdoption.length)} of commits since`)
}
line('signed', signed.length, signed.length ? 'a signature says who pushed, not what wrote' : 'authorship rests on a name anyone can set')
line('distinct authors', humans.size)

if (report.models.length) {
  console.log('\nWHAT WROTE IT')
  for (const m of report.models.slice(0, 8)) console.log(`  ${String(m.commits).padStart(6)}  ${m.name}`)
} else {
  console.log('\nWHAT WROTE IT')
  console.log('  Nothing in this history names a model. That is not evidence nobody used one —')
  console.log('  it is evidence nothing recorded it, and the two are different answers.')
}

if (FILE) {
  const last = commits[0]
  console.log(`\nLAST TOUCHED ${FILE}`)
  console.log(`  ${last.date.slice(0, 10)}  ${last.author}${last.coAuthors.length ? ` with ${last.coAuthors.map(a => a.name).join(', ')}` : ' — nothing recorded'}`)
}

console.log('\nWHAT THIS CANNOT ANSWER')
for (const l of Object.values(report.limits)) console.log(`  · ${l}`)

console.log('\nA report, not a gate. A rule that every commit must name its model can only be true')
console.log('going forward, and a check that fails on history teaches people to pass --no-verify —')
console.log('after which the record stops accumulating and the question becomes unanswerable.')
console.log(`\nwritten to scans/${scanSlot(target)}/provenance.json`)
