/**
 * Context budget — the cost side of the profile.
 *
 * Everything an agent must read before it may write a screen on this system is
 * paid for on EVERY task, by every agent, forever. That makes the must-read set a
 * budget like bundle size, not a free resource: this reports what it costs, where
 * the weight sits, and fails when it goes over.
 *
 * The must-read set here is not the registry. An agent authoring a spec reads the
 * system contract (README.md), the role vocabulary a spec is written in
 * (roles/vocabulary.json), and a one-line-per-component index of what exists — the
 * same rows `list_components` serves over MCP, built here from the profile so the
 * number is the real discovery cost, not a stale copy. The full contract for a
 * component (props, unions, example) is fetched on demand through `get_component`,
 * so profiles/<id>/components.json is measured as an on-demand registry with a
 * per-entry ceiling, not as must-read.
 *
 * Token counts are an ESTIMATE (chars / 4, the usual rule of thumb for English
 * plus code). We do not ship a tokenizer: the number is a trend line and a budget,
 * not billing. Compare runs, do not quote it as exact.
 *
 *   node scripts/context-budget.mjs                 report against the "own" profile
 *   node scripts/context-budget.mjs --profile mui   measure a different profile
 *   node scripts/context-budget.mjs --check         exit non-zero when over budget
 */
import { readFileSync, existsSync } from 'node:fs'
import { indexProfile } from './lib/score-core.mjs'
import { indexRow, componentDetail } from './lib/answers.mjs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const tokens = (text) => Math.ceil(text.length / 4)
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'
const CHECK = process.argv.includes('--check')

/* The must-read set, in the order an agent meets it. Keep this list honest: if a
 * file becomes required reading to author a screen on this system, it belongs
 * here. The budgets are sensible ceilings sat just above today's cost, so a raise
 * is a decision somebody takes on purpose with a reason, not a surprise. */
const REQUIRED = [
  /* The system contract. ~11.2k today; the ceiling sits a little above so ordinary
   * edits do not trip it, and a real growth in the front-door doc is a deliberate
   * raise here, argued in a comment like this one. */
  { path: 'README.md', why: 'the system contract, read every session', budget: 12000 },
  /* The language a spec is written in — roles and axes. Small on purpose: the
   * vocabulary README argues that a portable vocabulary stays deliberately small,
   * so this budget being generous is itself a smell if it ever fills. */
  { path: 'roles/vocabulary.json', why: 'the role vocabulary a spec is written in', budget: 1200 },
]

/* Read on demand, not on every task: `get_component` over MCP returns these
 * entries for the four or five components a screen actually uses.
 *
 * The per-entry ceiling is the one that guards a fetch, and it is now measured on
 * the rendered answer rather than on the record. Six worst-case components is
 * about 3.6k, which is the number that matters when an agent looks them up. When
 * it trips, cut the entry (shorten the example, drop a prop with a reason) before
 * raising it — it has never been raised.
 *
 * The file ceiling used to be argued as "a registry that doubles makes every fetch
 * heavier". That was true only while a fetch was priced as the file's own JSON. It
 * is not: 131 entries are 67.7k on disk and 34.3k answered, and the difference is
 * punctuation and fields the answer never renders. What the file total is still
 * good for is noticing growth in one number, so it stays — with the honest reason.
 *
 * Raised 56k→112k on 2026-08-28, when probe:own was fixed and the profile caught
 * up with the source design system: 91→131 components, and richer entries with it.
 * The per-entry ceiling was untouched at 640 and holds with room — the heaviest
 * answer is 607. (Earlier: 48k→56k on 2026-08-21, 82→91 components.) */
const ON_DEMAND = [
  {
    path: `profiles/${PROFILE}/components.json`,
    why: 'the full contract, fetched per component',
    budget: 112000,
    perEntry: 640,
  },
]

/* The whole must-read budget. README + vocabulary + the generated index come to
 * ~16.5k today; the ceiling sits above that so the index has runway. When it
 * trips, the answer is usually the index (see the runway below), not the
 * contract. */
const TOTAL_BUDGET = 18000 // must-read context, tokens

let failed = 0
console.log(`\x1b[1mContext budget for "${PROFILE}" (estimated tokens, chars/4)\x1b[0m\n`)

/* The discovery index: one line per component, exactly the rows `list_components`
 * serves — name, level/surface, and the first-line description. Built from the
 * profile rather than a committed file because that is what the agent actually
 * reads, and a copy on disk would be one more thing to keep in step. */
const profilePath = `${ROOT}/profiles/${PROFILE}/components.json`
if (!existsSync(profilePath)) {
  console.error(`\x1b[31m✗\x1b[0m no profile "${PROFILE}" — nothing to measure. Build one first.`)
  process.exit(2)
}
const profileDoc = JSON.parse(readFileSync(profilePath, 'utf8'))
const components = profileDoc.components ?? {}
const oneLine = (name) => indexRow(name, components[name])
const indexRows = Object.keys(components).sort().map(oneLine)
const indexText = indexRows.join('\n')
const INDEX_BUDGET = 6000 // the one-line index, tokens

let total = 0
for (const { path, why, budget } of REQUIRED) {
  const full = `${ROOT}/${path}`
  if (!existsSync(full)) {
    console.error(`  \x1b[31m✗\x1b[0m ${path} is missing`)
    failed++
    continue
  }
  const t = tokens(readFileSync(full, 'utf8'))
  total += t
  const ok = t <= budget
  if (!ok) failed++
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${path.padEnd(28)} ${fmt(t).padStart(7)} / ${fmt(budget)}   \x1b[2m${why}\x1b[0m`)
}

/* The generated index counts as must-read: it is what an agent reads to learn
 * what exists before it fetches anything. */
const indexTokens = tokens(indexText)
total += indexTokens
const indexOk = indexTokens <= INDEX_BUDGET
if (!indexOk) failed++
console.log(`  ${indexOk ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${'component index (built)'.padEnd(28)} ${fmt(indexTokens).padStart(7)} / ${fmt(INDEX_BUDGET)}   \x1b[2mwhat exists, one line each — discovery reads this\x1b[0m`)

const totalOk = total <= TOTAL_BUDGET
if (!totalOk) failed++
console.log(`  ${totalOk ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${'total must-read'.padEnd(28)} ${fmt(total).padStart(7)} / ${fmt(TOTAL_BUDGET)}\n`)

console.log('  \x1b[2mon demand — get_component over MCP, not carried into every task\x1b[0m')
for (const { path, why, budget } of ON_DEMAND) {
  const full = `${ROOT}/${path}`
  if (!existsSync(full)) {
    console.error(`  \x1b[31m✗\x1b[0m ${path} is missing`)
    failed++
    continue
  }
  const t = tokens(readFileSync(full, 'utf8'))
  const ok = t <= budget
  if (!ok) failed++
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${path.padEnd(28)} ${fmt(t).padStart(7)} / ${fmt(budget)}   \x1b[2m${why}\x1b[0m`)
}
console.log('')

/* Where the registry weight actually sits. Per-entry cost is the number that
 * matters both when adding a component and when fetching one: it is the price of
 * one answer from `get_component`. */
/* Priced as the ANSWER, not as the record. This used to be
 * `tokens(JSON.stringify(e))`, which charged an agent for indentation, key names
 * and fields `get_component` never renders: 1891 against 443 for Table, and 26
 * entries over the ceiling that no agent had ever paid. The rendering is imported
 * from the same module the server answers with, so the two cannot drift again. */
const indexedProfile = indexProfile(profileDoc)
const entries = Object.entries(components).map(([name, e]) => ({
  ref: e.ref ?? name,
  total: tokens(componentDetail(name, indexedProfile) ?? ''),
  onDisk: tokens(JSON.stringify(e)),
  example: tokens(e.example ?? ''),
  props: tokens(JSON.stringify(e.props ?? [])),
}))
entries.sort((a, b) => b.total - a.total)
const sum = entries.reduce((n, e) => n + e.total, 0)
const avg = entries.length ? Math.round(sum / entries.length) : 0
const fileTokens = tokens(readFileSync(profilePath, 'utf8'))
const onDiskSum = entries.reduce((n, e) => n + e.onDisk, 0)

console.log('  \x1b[2mregistry breakdown\x1b[0m')
console.log(`    ${entries.length} entries, ${fmt(sum)} tokens answered (avg ${avg}/entry)`)
console.log(`    ${fmt(onDiskSum)} tokens on disk — the ${fmt(onDiskSum - sum)} difference is JSON the answer never renders`)
console.log('    heaviest entries:')
for (const e of entries.slice(0, 6)) {
  console.log(`      ${String(e.total).padStart(5)}  ${e.ref.padEnd(22)} \x1b[2mexample ${e.example}, props ${e.props}\x1b[0m`)
}
const perEntry = ON_DEMAND[0].perEntry
const over = entries.filter((e) => e.total > perEntry)
if (over.length) {
  failed++
  console.log(`\n    \x1b[31m✗ ${over.length} entr${over.length === 1 ? 'y is' : 'ies are'} over the ${perEntry}-token per-entry ceiling:\x1b[0m`)
  for (const e of over) console.log(`      ${String(e.total).padStart(5)}  ${e.ref}`)
  console.log(`    \x1b[2mThat is what an agent pays to look one of them up. Shorten the example or the prop descriptions.\x1b[0m`)
}

/* Two marginal costs, and they are different by a factor of five. The index one is
 * what a new component costs EVERY task; the registry one is what it costs the
 * tasks that actually use it. And the RUNWAY, which turns a budget into a plan: at
 * a known price per row, how many more components fit before the index trips? A
 * ceiling met on the day it goes red is one nobody planned for; one that says
 * "room for nine more" is a decision somebody can take a month earlier. */
const perRow = indexRows.length
  ? indexRows.reduce((n, l) => n + tokens(l) + 1, 0) / indexRows.length
  : 0
const idxAvg = Math.round(perRow)
console.log(`\n    \x1b[2mMarginal cost of one more component: ${idxAvg} tokens on every task (its index row),\x1b[0m`)
console.log(`    \x1b[2mplus about ${avg} tokens on the tasks that fetch it.\x1b[0m`)
if (perRow > 0) {
  const room = Math.floor((INDEX_BUDGET - indexTokens) / perRow)
  const colour = room <= 5 ? '\x1b[31m' : room <= 15 ? '\x1b[33m' : '\x1b[2m'
  console.log(`    ${colour}Runway: room for ${room} more component(s) before the index budget trips.\x1b[0m`)
  if (room <= 15) {
    console.log('    \x1b[2mAt the end of it: raise the index budget deliberately, or make search the primary path.\x1b[0m')
  }
}
console.log(`    \x1b[2mIf this gets tight, cut the per-entry payload (shorter examples, fewer prop descriptions) before cutting components.\x1b[0m\n`)

if (failed) {
  console.error(`\x1b[31m✗ context over budget.\x1b[0m Either trim the payload, or raise the budget in scripts/context-budget.mjs with a reason.`)
  /* Over budget always fails the process; --check is the name the gate calls it
   * by, and reads the same way whether or not the flag is present. */
  process.exit(1)
}
console.log('\x1b[32m✓ context within budget.\x1b[0m')
