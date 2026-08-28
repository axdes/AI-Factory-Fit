/**
 * What this repository has, from an agent's point of view.
 *
 * The other scans measure engineering: linters, tests, CI. This measures the axis
 * that decides whether an agent working here produces conforming code or invents
 * its own conventions — and they are not the same axis. A project can have a
 * perfect test suite and be completely illegible to the six agents its team
 * actually runs.
 *
 * Five things an agent needs, in the order they matter:
 *
 *   contract     rules it can read, in a file its own tool looks for
 *   enforcement  something that stops it, not merely tells it
 *   knowledge    what to reach for, on demand rather than always in context
 *   boundaries   work it should delegate rather than do inline
 *   feedback     whether any of the above changed its behaviour
 *
 * The load-bearing measure is contract COVERAGE. Rules in CLAUDE.md are read by
 * Claude Code and by nothing else; rules in AGENTS.md are read by around thirty
 * agents including Codex, Cursor, Copilot, Gemini CLI, Windsurf, Aider and Zed.
 * A team running three tools with rules in one file has documented its
 * conventions for one of them.
 *
 *   node scripts/ai-audit.mjs <repo>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSlot, projectRoots } from './lib/signals.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
if (!target || !existsSync(target)) {
  console.error('usage: node scripts/ai-audit.mjs <repo>')
  process.exit(2)
}

// Agent configuration is hierarchical: a package inside a workspace inherits the
// hooks, skills and MCP servers declared at the root. Auditing one directory
// reported a package with working hooks and three subagents as having none, which
// is the report telling a team to install what they already run.
const ancestors = projectRoots(target)

/** Where a path is found, nearest first, with whether it was inherited. */
const locate = (...parts) => {
  for (const base of ancestors) {
    const path = join(base, ...parts)
    if (existsSync(path)) return { path, base, inherited: base !== target }
  }
  return undefined
}

const at = (...parts) => locate(...parts)?.path ?? join(target, ...parts)
const has = (...parts) => Boolean(locate(...parts))
const from = (...parts) => locate(...parts)
const read = (...parts) => { try { return readFileSync(at(...parts), 'utf8') } catch { return undefined } }
const list = (...parts) => { try { return readdirSync(at(...parts)) } catch { return [] } }

/**
 * Entries from every level, not only the nearest.
 *
 * Skills and subagents accumulate across scopes rather than shadowing: a package
 * declaring one of its own does not lose the five its workspace declares. Taking
 * the nearest directory reported a project as having gone from five skills to one
 * by gaining a skill.
 */
const listAll = (...parts) => {
  const seen = new Map()
  for (const base of ancestors) {
    let entries = []
    try { entries = readdirSync(join(base, ...parts)) } catch { continue }
    for (const entry of entries) {
      if (!seen.has(entry)) seen.set(entry, { name: entry, base, inherited: base !== target })
    }
  }
  return [...seen.values()]
}

// Rough, and honest about it: a token is about four characters of English prose.
// The point is the order of magnitude, because a contract that does not fit in
// context is not a contract that gets followed.
const tokens = (text) => text ? Math.round(text.length / 4) : 0

// ── 1. Contract: what can read the rules ──────────────────────────────────────

const CONTRACTS = [
  {
    file: 'AGENTS.md',
    reach: ['Codex', 'Cursor', 'Copilot', 'Gemini CLI', 'Windsurf', 'Aider', 'Zed', 'Jules', 'Devin'],
    note: 'the cross-tool standard; around thirty agents read this name natively',
  },
  {
    file: 'CLAUDE.md',
    reach: ['Claude Code'],
    note: 'Claude Code reads this name only — it does not read AGENTS.md unless imported',
  },
  { file: '.github/copilot-instructions.md', reach: ['GitHub Copilot'], note: "Microsoft's variant" },
  { file: '.windsurfrules', reach: ['Windsurf'], note: 'superseded by AGENTS.md in recent versions' },
  { file: '.clinerules', reach: ['Cline'], note: '' },
]

const contracts = CONTRACTS.map(c => ({
  ...c, present: has(c.file), size: tokens(read(c.file)), inherited: from(c.file)?.inherited ?? false,
}))
const cursorRules = list('.cursor', 'rules').filter(f => f.endsWith('.mdc'))
if (cursorRules.length) {
  contracts.push({
    file: '.cursor/rules/',
    reach: ['Cursor'],
    present: true,
    size: cursorRules.reduce((n, f) => n + tokens(read('.cursor', 'rules', f)), 0),
    note: `${cursorRules.length} rule file(s), glob-scoped`,
  })
}

const present = contracts.filter(c => c.present)
const reach = new Set(present.flatMap(c => c.reach))

// The pointer pattern: one contract file, and a short CLAUDE.md that imports it,
// so a single text reaches every tool instead of two texts drifting apart.
//
// Only the bare `@AGENTS.md` form expands the file into context at launch. A
// markdown link or a line of prose is inert text: Claude Code loads the four
// lines that point and never the file pointed at. MUI and Adobe React Spectrum
// both ship exactly that, having had the right instinct and spent it on the
// wrong character. Accepting "see AGENTS.md" reported both as correct — the
// first version of this detector over-reporting, on the one question it was
// added to answer.
//
// Backticks keep the import literal, so `@AGENTS.md` inside a code span or a
// fenced block points at nothing either.
const claude = read('CLAUDE.md')
const withoutCode = claude ? claude.replace(/```[\s\S]*?```|`[^`\n]*`/g, '') : ''
const pointsAtAgents = Boolean(claude && has('AGENTS.md') && /(^|[\s(])@AGENTS\.md\b/.test(withoutCode))
// Points in prose, but with something that does not expand. Worth naming rather
// than passing over: it reads as the pointer pattern and behaves as an empty file.
const inertPointer = Boolean(claude && has('AGENTS.md') && !pointsAtAgents && /AGENTS\.md/.test(claude))
const duplicated = Boolean(claude && has('AGENTS.md') && !pointsAtAgents && !inertPointer && claude.length > 800)

// ── 2. Enforcement: what stops an agent rather than advising it ───────────────

const settingsRaw = read('.claude', 'settings.json') ?? read('.claude', 'settings.local.json')
let settings
try { settings = settingsRaw ? JSON.parse(settingsRaw) : undefined } catch { settings = undefined }

const settingsFrom = from('.claude', 'settings.json') ?? from('.claude', 'settings.local.json')
const hookKinds = settings?.hooks ? Object.keys(settings.hooks) : []
const enforcement = {
  hooks: hookKinds,
  preToolUse: hookKinds.includes('PreToolUse'),
  postToolUse: hookKinds.includes('PostToolUse'),
  stop: hookKinds.includes('Stop'),
  permissions: Boolean(settings?.permissions),
  gitHook: has('.githooks', 'pre-commit') || has('.husky', 'pre-commit') || has('lefthook.yml'),
}

// ── 3. Knowledge: reached on demand rather than carried always ────────────────

// Skills ship in three layouts in the wild, and looking for only one of them is
// how this reported "0 skills" for shadcn/ui — a repository whose `skills/`
// directory holds two substantial ones — and for tldraw and Documenso besides.
// Three of eleven repositories surveyed, on the question this audit exists to
// answer.
//
// What settles it is not the folder name but the file: a directory holding a
// `SKILL.md` is a skill, wherever it was put.
const SKILL_ROOTS = [
  ['.claude', 'skills'],   // Claude Code, project scope
  ['.agents', 'skills'],   // the cross-tool layout, as Documenso ships it
  ['skills'],              // plugin and marketplace layout, as shadcn/ui and tldraw ship it
]
const skillEntries = SKILL_ROOTS.flatMap(parts => listAll(...parts).filter(e => {
  const at = join(e.base, ...parts, e.name)
  try {
    if (!statSync(at).isDirectory()) return false
  } catch { return false }
  // A bare `skills/` at the root is a plausible name for other things, so the
  // manifest is what makes it a skill rather than a folder that shares the word.
  return existsSync(join(at, 'SKILL.md'))
}).map(e => ({ ...e, layout: parts.join('/') })))

// One skill reachable from two layouts is one skill — counted by name, or a
// repository that ships the same skill under `skills/` and `.claude/skills/`
// reports more inherited skills than it has.
const byName = new Map()
for (const e of skillEntries) if (!byName.has(e.name)) byName.set(e.name, e)
const skills = [...byName.keys()]
const commands = listAll('.claude', 'commands').filter(e => e.name.endsWith('.md')).map(e => e.name)
const knowledge = {
  skills,
  commands,
  skillsInherited: [...byName.values()].filter(e => e.inherited).length,
  skillLayouts: [...new Set(skillEntries.map(e => e.layout))],
}

// ── 4. Boundaries: work delegated rather than done inline ─────────────────────

const subagentEntries = [['.claude', 'agents'], ['.agents', 'agents']]
  .flatMap(parts => listAll(...parts).filter(e => e.name.endsWith('.md')))
const subagents = subagentEntries.map(e => e.name)

// ── 5. Reach: what an agent can query, and from where ─────────────────────────

let mcpServers = []
try {
  const mcp = JSON.parse(read('.mcp.json') ?? '{}')
  mcpServers = Object.keys(mcp.mcpServers ?? {})
} catch { /* unreadable */ }

// ── 6. Feedback: did any of it change behaviour ───────────────────────────────

const evalsDir = has('evals') || has('eval')
const scoreGate = has('scripts', 'gate', 'score.mjs')

// ── 7. Headless: can an agent run without a person at the keyboard ────────────

const workflows = list('.github', 'workflows')
const headless = workflows.some(f => /claude|codex|agent/i.test(f))
  || /claude\s+-p|claude\s+--print/.test([...workflows.map(f => read('.github', 'workflows', f) ?? '')].join('\n'))

// ── 8. Does the contract tell the truth about this repository ────────────────
//
// Every other reader of an AGENTS.md can only take it at its word. This tool
// measured the same conventions the contract talks about, so it can do the one
// thing nobody else can: check whether the rules an agent is being handed match
// the code it is being handed them for.
//
// A contract that is wrong is worse than a missing one. A missing contract makes
// an agent read the code; a wrong contract makes it confidently write something
// the repository does not do, and the gate then rejects work the agent was told
// to produce.
//
// Only explicit claims count. The vocabulary below is the same set of buckets the
// scan measures, so a contradiction means the contract named a bucket and the
// measurement found a different one holding at convention strength. A contract
// that says nothing about a dimension is silent, not wrong.

const CLAIM_VOCABULARY = {
  styling: {
    'CSS Modules': /\bcss modules?\b|\.module\.css/i,
    styled: /\bstyled[- ]components?\b|\bemotion\b|\bstyled\./i,
    'utility classes': /\btailwind\b|\butility[- ]class/i,
    'MUI sx': /\bsx prop\b|\bmui sx\b/i,
    'plain co-located CSS': /co-?located css|plain css file/i,
  },
  'component export': {
    default: /\bdefault export\b|\bexport default\b/i,
    named: /\bnamed export\b/i,
  },
  'props declaration': {
    'interface Props': /\binterface\s+\w*Props\b|interface for props/i,
    'type Props': /\btype\s+\w*Props\b|type alias for props/i,
  },
  'handler naming': {
    handleX: /\bhandle[A-Z]\w+|\bhandle-?prefix/i,
    onX: /\bon[A-Z]\w+\s*(?:prefix|naming)|\bon-?prefix/i,
  },
  'internal imports': {
    // A path fragment is not a claim. `../../` appears in any example, and
    // formbricks' line about import ORDER through a prettier plugin was read as a
    // claim about relative versus aliased paths.
    alias: /\b(path )?alias(es)?\b|\buse @\/|\bimport from ['"`]?@\//i,
    relative: /\brelative imports?\b|\bprefer relative\b/i,
  },
  'test placement': {
    'co-located': /co-?locat/i,
    'separate test folder': /\btests?\/ (?:folder|directory)|separate test/i,
  },
  'file structure': {
    'flat Name.tsx': /\bflat\b.*\.tsx|one file per component/i,
    'Folder/index.tsx': /\bindex\.tsx?\b.*folder|folder.*index\.tsx?/i,
  },
}

const contradictions = []
const confirmations = []
const decisions = []
{
  const scanPath = join(root, 'scans', scanSlot(target), 'scan.json')
  const measured = existsSync(scanPath) ? JSON.parse(readFileSync(scanPath, 'utf8')).conventions ?? {} : undefined

  // Everything an agent would actually read here, concatenated. A claim in a
  // Cursor rule is as binding as one in AGENTS.md.
  // Kept per file and per line, because "your contract says CSS Modules" is an
  // assertion and "copilot-instructions.md line 24 says CSS Modules" is something
  // a person can go and read. A claim nobody can locate is one nobody can fix,
  // and a loose match stays visible instead of hiding inside a verdict.
  const contractLines = [
    ...present.map(c => [c.file, read(c.file) ?? '']),
    ...cursorRules.map(f => [`.cursor/rules/${f}`, read('.cursor', 'rules', f) ?? '']),
  ].flatMap(([file, text]) => text.split('\n').map((line, i) => ({ file, line: i + 1, text: line })))
  const contractText = contractLines.map(l => l.text).join('\n')

  if (measured && contractText.trim()) {
    for (const [dimension, buckets] of Object.entries(CLAIM_VOCABULARY)) {
      const actual = measured[dimension]
      if (!actual) continue
      for (const [bucket, pattern] of Object.entries(buckets)) {
        // A line about the ORDER of imports is not a claim about their form.
        // formbricks lists "`@formbricks/*`, `~/*`, `@/*`, and relative imports"
        // as a sort order, and that was read as a preference for relative paths —
        // the phrase matched and the meaning did not.
        //
        // This is the limit of matching words, and it is stated in the report
        // rather than chased with a longer pattern: every finding carries the file,
        // the line and the sentence, so anything that survives can be read and
        // dismissed in seconds.
        const ORDERING = /\border\b|\bsort(ed|ing)?\b|\bfirst\b.*\bthen\b/i
        const said = contractLines.find(l => pattern.test(l.text) && !ORDERING.test(l.text))
        if (!said) continue
        const where = `${said.file}:${said.line}`
        const quote = said.text.trim().replace(/^[-*]\s*/, '').slice(0, 90)
        // Three outcomes, not two. Where the code has settled, the contract either
        // matches it or contradicts it. Where the code is split, the contract is
        // not wrong — it is doing the job a contract exists for, and saying so is
        // more useful than silence.
        //
        // A first version called 58.7% "the code agrees", which is a split reported
        // as agreement: at that share the repository has agreed on nothing.
        if (actual.verdict !== 'convention') {
          decisions.push({ dimension, chose: bucket, split: actual.distribution, where, quote })
          continue
        }
        if (bucket === actual.dominant) {
          confirmations.push({ dimension, bucket, share: actual.share, where })
          continue
        }
        contradictions.push({
          dimension,
          claimed: bucket,
          measured: actual.dominant,
          share: actual.share,
          where,
          quote,
        })
      }
    }
  }
}

// ── 9. Delegation: how much of the work this repository can be handed ─────────
//
// The sections above are a checklist, and a checklist does not answer the
// question a team actually has: how much can we let an agent do here. Three
// levels, borrowed from a reference model that names them well:
//
//   assisted            the agent advises; a person decides and writes
//   delegated-review    the agent writes; a person reviews the result
//   gated-autonomous    the system proceeds unless a person holds it
//
// What matters is that the level is DERIVED rather than chosen. A team that
// declares itself autonomous without anything that stops a bad turn has declared
// a wish. Each requirement below points at a measurement made above, so the
// answer is checkable and the gap is a list of specific missing things.
//
// The reference model's own line is the right one to keep in view: autonomy at
// the gate is not the absence of a human, it is a human who has decided not to
// intervene yet. That decision is only available to someone who can see what
// would have stopped the agent.

const LEVELS = [
  {
    id: 'assisted',
    what: 'the agent advises; a person decides and writes',
    needs: [
      { ok: present.length > 0, is: 'rules the agent can read', why: 'without a contract every agent invents its own conventions, and its advice is about some other project' },
    ],
  },
  {
    id: 'delegated-review',
    what: 'the agent writes; a person reviews the result',
    needs: [
      { ok: reach.size >= 1, is: 'a contract the agents in use can read', why: 'rules in a file a tool does not open are rules that tool does not have' },
      { ok: scoreGate, is: 'a way to score the output', why: 'review without a measurement is taste, and it does not scale past the reviewer\'s attention' },
      { ok: knowledge.skills.length > 0 || subagents.length > 0, is: 'knowledge reachable on demand', why: 'everything an agent needs sometimes, carried always, crowds out the task' },
      { ok: enforcement.gitHook || enforcement.postToolUse, is: 'a check that runs without being asked', why: 'a reviewer who is also the first check is the bottleneck' },
    ],
  },
  {
    id: 'gated-autonomous',
    what: 'the system proceeds unless a person holds it',
    needs: [
      { ok: enforcement.stop || enforcement.postToolUse, is: 'something that stops a bad turn with nobody watching', why: 'this is the whole difference between autonomy and absence' },
      { ok: enforcement.gitHook, is: 'a gate on the way in', why: 'an unattended agent commits, and the commit is the last place to catch it' },
      { ok: headless, is: 'a way to run with nobody at the keyboard', why: 'a factory that only produces while someone watches it is not one' },
      { ok: evalsDir, is: 'evidence that the rules improve the output', why: 'proceeding by default without measurement is proceeding on hope' },
    ],
  },
]

const met = (level) => level.needs.every(n => n.ok)
const supported = [...LEVELS].reverse().find(met)?.id ?? 'none'
const next = LEVELS.find(l => !met(l))

const delegation = {
  supported,
  levels: LEVELS.map(l => ({
    id: l.id,
    what: l.what,
    met: met(l),
    missing: l.needs.filter(n => !n.ok).map(n => ({ is: n.is, why: n.why })),
  })),
  // Named so nobody reads the level as a score. It is a statement about what the
  // repository can currently support, not about how good the team is.
  _: 'Derived from the measurements above, never declared. A level is supported when every requirement under it is present; the first unmet requirement of the next level is the smallest thing that would move it.',
}

// ── Report ────────────────────────────────────────────────────────────────────

const name = scanSlot(target)
const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })

const report = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  searched: ancestors.map(a => relative(target, a) || '.'),
  contract: { files: contracts.filter(c => c.present), reach: [...reach], pointsAtAgents, inertPointer, duplicated },
  enforcement,
  knowledge,
  boundaries: { subagents },
  reachTools: { mcpServers },
  feedback: { evals: evalsDir, scoreGate },
  headless,
  delegation,
  contract_truth: { contradictions, confirmations, decisions },
  // Counts, so a technique's applicability condition can be a number rather than
  // a shape the predicate language would have to learn to walk.
  counts: {
    contractFiles: present.length,
    contractReach: reach.size,
    largestContractTokens: present.length ? Math.max(...present.map(c => c.size)) : 0,
    hooks: hookKinds.length,
    skills: skills.length,
    subagents: subagents.length,
    mcpServers: mcpServers.length,
  },
}
writeFileSync(join(outDir, 'ai-audit.json'), JSON.stringify(report, null, 2) + '\n')

const mark = (ok) => ok ? '✓' : '✗'
console.log(`\nai-audit: ${target}\nwhat an agent working here can read, and what stops it\n`)

console.log('CONTRACT — which agents can read this project\'s rules')
if (!present.length) {
  console.log('  ✗ nothing. Every agent that opens this repository invents its own conventions.')
} else {
  for (const c of present) {
    console.log(`  ✓ ${c.file.padEnd(32)} ${c.size} tokens${c.inherited ? ' · inherited from the workspace' : ''} · read by ${c.reach.join(', ')}`)
    if (c.note) console.log(`      ${c.note}`)
  }
  console.log(`\n  Reach: ${[...reach].join(', ')}`)
  const missing = CONTRACTS.filter(c => !has(c.file) && c.file !== '.windsurfrules' && c.file !== '.clinerules')
  if (missing.length) {
    console.log(`  Blind: ${[...new Set(missing.flatMap(c => c.reach))].filter(r => !reach.has(r)).join(', ') || 'none'}`)
  }
  if (duplicated) {
    console.log('\n  ⚠ AGENTS.md and CLAUDE.md both carry content. Two texts, one subject, and')
    console.log('    nothing keeps them in step. One file plus a pointer is the pattern that holds.')
  }
  if (pointsAtAgents) console.log('\n  CLAUDE.md points at AGENTS.md rather than repeating it.')
  if (inertPointer) {
    console.log('\n  ⚠ CLAUDE.md mentions AGENTS.md but does not import it. Only a bare @AGENTS.md')
    console.log('    expands at launch; a markdown link is text. Claude Code is reading the pointer,')
    console.log('    not the contract.')
  }
  const biggest = Math.max(...present.map(c => c.size))
  if (biggest > 6000) {
    console.log(`\n  ⚠ The largest contract is about ${biggest} tokens, paid on every task by every agent.`)
    console.log('    A contract that does not fit in context is a contract that is not followed.')
  }
}

console.log('\nENFORCEMENT — what stops an agent rather than advising it')
if (settingsFrom?.inherited) console.log(`  (settings inherited from ${relative(target, settingsFrom.base) || '..'})`)
console.log(`  ${mark(enforcement.preToolUse)} PreToolUse hook        ${enforcement.preToolUse ? 'a check before a tool runs' : 'nothing intercepts a write before it happens'}`)
console.log(`  ${mark(enforcement.postToolUse)} PostToolUse hook       ${enforcement.postToolUse ? 'a check after each edit' : 'an edit is not linted as it lands'}`)
console.log(`  ${mark(enforcement.stop)} Stop hook              ${enforcement.stop ? 'a turn cannot finish while red' : 'a turn can end with the build broken'}`)
console.log(`  ${mark(enforcement.permissions)} permissions            ${enforcement.permissions ? 'declared' : 'every tool call is decided ad hoc'}`)
console.log(`  ${mark(enforcement.gitHook)} commit hook            ${enforcement.gitHook ? 'the gate runs on commit' : 'nothing checks a commit'}`)

console.log('\nKNOWLEDGE — reached on demand rather than carried in context')
console.log(`  ${mark(knowledge.skills.length > 0)} skills                 ${knowledge.skills.length || 'none'}${knowledge.skills.length ? `: ${knowledge.skills.slice(0, 6).join(', ')}${knowledge.skillsInherited ? ` · ${knowledge.skillsInherited} inherited` : ''}` : ''}`)
console.log(`  ${mark(knowledge.commands.length > 0)} slash commands         ${knowledge.commands.length || 'none'}`)

console.log('\nBOUNDARIES — work delegated rather than done inline')
console.log(`  ${mark(subagents.length > 0)} subagents              ${subagents.length || 'none'}${subagents.length ? `: ${subagents.map(f => basename(f, '.md')).slice(0, 5).join(', ')}${subagentEntries.filter(e => e.inherited).length ? ` · ${subagentEntries.filter(e => e.inherited).length} inherited` : ''}` : ''}`)

console.log('\nREACH — what an agent can query about this project')
console.log(`  ${mark(mcpServers.length > 0)} MCP servers            ${mcpServers.length ? mcpServers.join(', ') : 'none; an agent outside this checkout knows nothing about it'}`)

console.log('\nFEEDBACK — whether any of it changed behaviour')
console.log(`  ${mark(report.feedback.scoreGate)} conformance score      ${report.feedback.scoreGate ? 'agent output can be scored' : 'no way to tell good output from bad'}`)
console.log(`  ${mark(report.feedback.evals)} evals                  ${report.feedback.evals ? 'present' : 'no measurement that a rule change improved anything'}`)

console.log('\nHEADLESS — can an agent run with nobody at the keyboard')
console.log(`  ${mark(headless)} ${headless ? 'an agent runs in CI' : 'agents only run interactively; nothing is automated'}`)

const score = [
  present.length > 0, reach.size >= 3, enforcement.postToolUse || enforcement.preToolUse,
  enforcement.gitHook, knowledge.skills.length > 0, subagents.length > 0,
  mcpServers.length > 0, report.feedback.scoreGate, report.feedback.evals, headless,
].filter(Boolean).length

if (contradictions.length || confirmations.length || decisions.length) {
  console.log('\nIS THE CONTRACT TRUE — the rules an agent is handed, against the code it is handed them for')
  for (const c of contradictions) {
    console.log(`  ✗ ${c.dimension.padEnd(20)} says ${c.claimed}; the code is ${c.measured} at ${Math.round(c.share * 100)}%`)
    console.log(`      ${c.where}  "${c.quote}"`)
  }
  for (const c of confirmations.slice(0, 4)) {
    console.log(`  ✓ ${c.dimension.padEnd(20)} ${c.bucket}, and the code agrees at ${Math.round(c.share * 100)}%`)
  }
  for (const d of decisions.slice(0, 4)) {
    const split = Object.entries(d.split).map(([k, v]) => `${k} ${v}`).join(' vs ')
    console.log(`  · ${d.dimension.padEnd(20)} chooses ${d.chose} where the code is split — ${split}`)
    console.log(`      ${d.where}  this is the contract doing what a contract is for`)
  }
  if (contradictions.length) {
    console.log('\n  A wrong contract is worse than a missing one. A missing one makes an agent read')
    console.log('  the code; a wrong one makes it confidently write what this repository does not do,')
    console.log('  and the gate then rejects work the agent was told to produce.')
    console.log('\n  Matched on words, so read the quoted line before acting: a sentence that names a')
    console.log('  convention in passing reads the same as one that prescribes it.')
  }
}

console.log('\nDELEGATION — how much of the work this repository can currently be handed')
for (const l of delegation.levels) {
  console.log(`  ${l.met ? '✓' : '✗'} ${l.id.padEnd(20)} ${l.what}`)
  for (const m of l.missing) console.log(`      needs ${m.is} — ${m.why}`)
}
console.log(`\n  Supported today: ${delegation.supported}.`)
console.log('  Derived from the measurements above, never declared. Autonomy at the gate is not')
console.log('  the absence of a person; it is a person who can see what would have stopped the')
console.log('  agent and has decided not to intervene yet.')

console.log(`\n${score}/10 of what an AI factory needs is present.`)
console.log(`written to scans/${name}/ai-audit.json`)
