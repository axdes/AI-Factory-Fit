/**
 * The vocabulary a codebase actually uses, measured at the call sites.
 *
 * A profile already carries what a component's types *declare*. For the libraries
 * this tool was modelled on that is enough, because somebody wrote a vocabulary file
 * by hand. A client's own registry has no such file, and where the registry came out
 * of `adapt:css` or `adapt:sfc` there are no types to read either — so an agent is
 * handed a list of component names and no idea which props take which values.
 *
 * That gap is the one thing in the judgment tier that does not have to stay somebody's
 * afternoon. Which values a prop is given is not a matter of taste; it is countable,
 * and counting it is what this does.
 *
 * What it does NOT do is decide what those values mean. `variant="ghost"` appearing
 * fifty-eight times is a fact. That `ghost` is the quietest of the three is a
 * judgment, and it stays in the worksheet where a person writes it. The split is the
 * point: extract the enumeration, leave the meaning.
 *
 *   node scripts/vocabulary.mjs <repo> --profile <id> [--exclude a,b]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, CODE_EXT, scanSlot, installedHere, MIN_OBSERVATIONS } from './lib/signals.mjs'
import { propUsage, axesFrom } from './lib/prop-usage.mjs'
import { counted, countedLine } from './lib/counted.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? undefined : process.argv[i + 1] }
const PROFILE = arg('--profile')
const EXCLUDED = (arg('--exclude') ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target) || !PROFILE) {
  console.error('usage: node scripts/vocabulary.mjs <repo> --profile <id> [--exclude a,b]')
  process.exit(2)
}

const profilePath = join(root, 'profiles', PROFILE, 'components.json')
if (!existsSync(profilePath)) {
  // Named rather than crashed. The usual cause is a profile that was never built,
  // and "ENOENT components.json" sends the reader to look for a missing file
  // instead of running the adapter that writes it.
  console.error(`no profile '${PROFILE}': ${relative(root, profilePath)} does not exist`)
  console.error('build one first: node scripts/ds.mjs adapt:sfc <dir> --out <id>')
  process.exit(2)
}

const registry = JSON.parse(readFileSync(profilePath, 'utf8')).components ?? {}
const names = Object.keys(registry)

// Every spelling a component may be written under, mapped back to the one name the
// registry files it by. Angular is the case that forces this: the profile holds
// `NgxHeader` and the template holds `<ngx-header>`, and matching on the class name
// alone reported all four components of a real registry as never used — a confident
// zero over a codebase that uses every one of them.
//
// Built in two passes, and the order is the whole point. `Map.set` overwrites, so a
// single pass makes the result depend on key order: a registry holding both `Button`
// (class `ButtonComponent`) and a separate component actually named `ButtonComponent`
// would attribute every use of the second to the first, or not, depending on which
// came out of `Object.entries` first. Aliases go down first and a component's own
// name goes down last, so a real name always wins over somebody else's alias.
const writtenAs = new Map()
const contested = []
for (const [name, c] of Object.entries(registry)) {
  for (const alias of [c.selector, c.className].filter(Boolean)) {
    if (alias === name) continue
    const taken = writtenAs.get(alias)
    if (taken && taken !== name) contested.push({ alias, between: [taken, name] })
    writtenAs.set(alias, name)
  }
}
for (const name of names) writtenAs.set(name, name)
// Two components claiming one spelling cannot both be right, and picking one
// silently files real uses under the wrong component — with a plausible number in
// place of a missing one, which is the failure nothing in the output reveals.
for (const { alias, between } of contested) {
  console.error(`  ! '${alias}' is claimed by both ${between.join(' and ')}; uses of it are filed under ${writtenAs.get(alias)}`)
}

const ours = installedHere(target)
const excludedPrefixes = EXCLUDED.map(e => join(target, e))
// `.html` is not in the shared code extensions, and an Angular component's markup
// lives in exactly that file. Walking without it read zero templates and said so
// honestly — "0 file were read" — which is the right answer to the wrong question.
const files = walk(target, [], new Set([...CODE_EXT, '.html']))
  .filter(a => !ours(a))
  .filter(a => /\.(tsx|jsx|ts|vue|svelte|html)$/.test(a))
  .filter(a => !excludedPrefixes.some(p => a === p || a.startsWith(p + sep)))

/**
 * The markup in a file, which in one case is not the whole file.
 *
 * Angular puts a component's markup either in a `.html` beside it or in a backtick
 * template inside the `.ts` — both are ordinary, and on ngx-admin every use of the
 * registry is in the second kind. Reading only `.html` found none of them and
 * reported all four components as never used.
 *
 * A `.ts` is still not read whole. `<HeaderComponent>x` in TypeScript is a type
 * assertion, and counting it as a call site would invent uses out of casts — a
 * false positive with nothing in the output to give it away. So only what is
 * declared as a template is read, which is exactly the text that holds tags.
 */
const markupOf = (at, text) => {
  if (!/\.ts$/.test(at)) return text
  const templates = [...text.matchAll(/template\s*:\s*`([\s\S]*?)`/g)].map(m => m[1])
  return templates.length ? templates.join('\n') : undefined
}

const sources = files.map(at => {
  try {
    const markup = markupOf(at, readFileSync(at, 'utf8'))
    return markup === undefined ? undefined : { at, text: markup }
  } catch { return undefined }
}).filter(Boolean)

const usage = propUsage(sources, writtenAs)
const axes = axesFrom(usage, MIN_OBSERVATIONS)

// Which of the registry was never called at all. A component nobody uses has no
// measured vocabulary, and saying "no axes found" about it would read as a finding
// about the component rather than about the search.
const called = new Set(Object.keys(usage.components))

// A component reached by attribute has no tag to look for. Angular Material declares
// sixteen of them — `button[matButton]` is written `<button matButton>`, on a host the
// screen already has — and a scan counting tags finds none of them. Listing those as
// "never written in this codebase" would be a confident falsehood about components a
// project may use on every screen.
const byAttribute = names.filter(n => registry[n]?.attributeSelector && !called.has(n))
const outOfReach = new Set(byAttribute)
const uncalled = names.filter(n => !called.has(n) && !outOfReach.has(n))

const flat = Object.entries(axes).flatMap(([component, props]) =>
  Object.entries(props).map(([prop, v]) => ({ component, prop, ...v })))
const found = flat.filter(a => a.axis)

const out = {
  schemaVersion: 1,
  taken: taken(import.meta.url, target),
  target,
  profile: PROFILE,
  considered: {
    ...usage.considered,
    registry: names.length,
    // The honest denominator for every share below. A vocabulary drawn from a
    // registry that is barely called is a vocabulary about almost nothing.
    called: called.size,
  },
  // Named for observation throughout. These are the values seen at call sites, and
  // a value nobody happened to write is not thereby illegal — the file says what
  // was counted, never what is permitted.
  axes: Object.fromEntries(Object.entries(axes).map(([c, props]) => [c,
    Object.fromEntries(Object.entries(props).filter(([, v]) => v.axis))])
    .filter(([, props]) => Object.keys(props).length)),
  refused: flat.filter(a => !a.axis).map(({ component, prop, why }) => ({ component, prop, why })),
  // How often each component is written, which is a different question from how
  // many other components render it — and the better answer to "where does a
  // description earn its keep". On memos the two disagree completely: Button is
  // written at 118 call sites and rendered by no other registry component.
  sites: Object.fromEntries(Object.entries(usage.components)
    .map(([name, e]) => [name, e.sites])
    .sort((a, b) => b[1] - a[1])),
  uncalled,
  // Separate from `uncalled`, because the two mean opposite things: one is a
  // component nobody writes, the other is one this pass cannot see.
  notMeasurableByTag: byAttribute,
}

const outDir = join(root, 'scans', scanSlot(target))
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'vocabulary.json'), JSON.stringify(out, null, 2) + '\n')

console.log(`\nvocabulary measured in ${relative(root, target) || target} against the ${PROFILE} profile\n`)
console.log(countedLine('registry components called',
  counted(called.size, names.length - byAttribute.length, 'component'),
  uncalled.length ? `${uncalled.length} never appear in this codebase` : undefined))
// Why a zero below is a zero. On a 358-component registry with 801 call sites, no
// prop cleared the floor — and the reason is not the props: the median component is
// written once. That is a fact about the registry worth saying on its own, and
// without it the zero reads as a failure of this pass.
const often = Object.values(usage.components).filter(e => e.sites >= MIN_OBSERVATIONS).length
if (called.size) {
  console.log(countedLine('called often enough for a share to mean anything',
    counted(often, called.size, 'component'),
    `at least ${MIN_OBSERVATIONS} call site(s)`))
}
if (byAttribute.length) {
  console.log(`      ?  ${byAttribute.length} component(s) are reached by attribute, not by tag — this pass cannot see their uses and says so rather than reporting none`)
}
console.log(countedLine('call sites read',
  counted(usage.considered.callSites, sources.length, 'file')))
// The denominator here is every prop that was weighed, not every prop that exists:
// a prop nobody passes was never a candidate, and counting it would make the share
// a statement about the registry's size instead of about this search.
console.log(countedLine('props that read as a closed set of choices',
  counted(found.length, flat.length, 'prop'),
  'the rest are free text, identifiers, or too rarely written to say'))

if (found.length) {
  console.log('\nObserved, not permitted — these are the values this codebase writes:\n')
  for (const a of found.sort((x, y) => Object.values(y.observed).reduce((s, n) => s + n, 0) - Object.values(x.observed).reduce((s, n) => s + n, 0))) {
    console.log(`  ${a.component}.${a.prop}`)
    console.log(`    ${Object.entries(a.observed).map(([v, n]) => `${v} ×${n}`).join('  ')}`)
    console.log(`    ${a.from}${a.alsoPassedAsExpression ? `, and passed as an expression ${a.alsoPassedAsExpression} more time(s)` : ''}`)
  }
  console.log('\nWhat each value MEANS is not measurable and is not here. That stays in the')
  console.log('policy worksheet, where a person writes it once.')
} else {
  console.log('\nNo prop in this codebase is written often enough, with repeated values, to')
  console.log('read as a set of choices. That is a fact about how much code there is, not')
  console.log('about the registry.')
}

console.log(`\nwritten to scans/${scanSlot(target)}/vocabulary.json`)
