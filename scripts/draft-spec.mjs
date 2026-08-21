/**
 * Turn a requirement into a draft screen spec.
 *
 * This is keyword matching, not understanding, and it is built to say so. What it
 * removes is the blank page: a person reading a draft that names the wrong
 * component argues with it in a minute, where a person facing an empty file
 * writes nothing for an hour.
 *
 * Two things make the guessing safe. Every element carries the evidence that
 * produced it — the phrase, and why that phrase suggested that role — so a wrong
 * line is visibly wrong rather than authoritative. And nothing here bypasses
 * `validate-spec`: a draft naming a component or value the library does not have
 * is rejected exactly as a hand-written one would be.
 *
 * The match runs against two vocabularies: the roles, which are portable, and the
 * profile's own component descriptions — the authored sentences that say what each
 * component is FOR. That second source is why a library with a filled judgment
 * tier drafts better than one without, and it is the clearest argument for
 * writing those sentences at all.
 *
 *   node scripts/draft-spec.mjs "a list of invoices with a status per row" --profile antd
 *   node scripts/draft-spec.mjs --file brief.txt --profile own --out specs/invoices.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'
const OUT = flag('--out')
const FILE = flag('--file')
const requirement = FILE
  ? (existsSync(FILE) ? readFileSync(FILE, 'utf8') : undefined)
  : process.argv.slice(2).filter(a => !a.startsWith('--') && a !== PROFILE && a !== OUT && a !== FILE)[0]

if (!requirement) {
  console.error('usage: node scripts/draft-spec.mjs "<requirement>" --profile <id> [--out <file>]')
  console.error('   or: node scripts/draft-spec.mjs --file brief.txt --profile <id>')
  process.exit(2)
}

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const vocabulary = readJson(join(root, 'roles', 'vocabulary.json'))
const binding = readJson(join(root, 'bindings', `${PROFILE}.json`))
const componentsDoc = readJson(join(root, 'profiles', PROFILE, 'components.json'))

if (!vocabulary || !binding || !componentsDoc) {
  console.error(`draft-spec: needs the role vocabulary, bindings and a profile for "${PROFILE}".`)
  process.exit(1)
}

// ── The cue tables, authored ──────────────────────────────────────────────────
//
// Written down rather than inferred. A table someone can read and correct beats a
// heuristic nobody can argue with, and this is the part most likely to be wrong.

const ROLE_CUES = {
  table: ['table', 'rows', 'columns', 'grid of data', 'spreadsheet'],
  list: ['list of', 'listing', 'list all', 'feed', 'items', 'entries', 'all the ', 'browse'],
  statusTag: ['status', 'state', 'label', 'tag', 'badge', 'stage'],
  primaryAction: ['create', 'new', 'add', 'start', 'submit', 'save', 'send', 'invite'],
  secondaryAction: ['cancel', 'back', 'export', 'download', 'duplicate'],
  iconAction: ['icon button', 'more', 'overflow', 'menu button'],
  searchInput: ['search', 'find', 'filter by text', 'look up'],
  select: ['choose', 'pick', 'filter by', 'dropdown', 'from a list', 'category'],
  textInput: ['enter', 'type', 'name', 'title', 'field', 'input'],
  checkbox: ['tick', 'check', 'multiple options', 'agree'],
  toggle: ['toggle', 'switch', 'enable', 'turn on'],
  dialog: ['confirm', 'dialog', 'modal', 'are you sure', 'warn before'],
  tooltip: ['tooltip', 'hint', 'explain on hover'],
  pagination: ['pages', 'paginate', 'page through', 'next page'],
  tabs: ['tabs', 'sections', 'switch between'],
  avatar: ['avatar', 'person', 'user', 'author', 'owner', 'assignee'],
  card: ['card', 'tile', 'panel per'],
  heading: ['title', 'heading', 'name the screen'],
  emptyState: ['empty', 'nothing', 'no results', 'first time'],
  inlineMessage: ['error message', 'warning', 'banner', 'alert'],
  loading: ['loading', 'while it loads', 'spinner'],
  skeleton: ['placeholder', 'skeleton'],
  divider: ['separator', 'divider'],
}

const ZONE_CUES = {
  header: ['title', 'heading', 'name the screen', 'create', 'new', 'add', 'primary action'],
  toolbar: ['search', 'filter', 'sort', 'narrow', 'choose', 'pick'],
  content: ['list', 'table', 'rows', 'cards', 'items', 'each', 'per row'],
  footer: ['pages', 'paginate', 'total', 'summary'],
}

const STATE_CUES = {
  empty: ['empty', 'nothing', 'no results', 'first time', 'none yet'],
  error: ['fails', 'error', 'cannot load', 'unavailable', 'retry'],
  loading: ['loading', 'while it loads', 'waiting', 'fetch'],
}

// ── Match ─────────────────────────────────────────────────────────────────────

const text = requirement.toLowerCase()
const clauses = requirement.split(/[.;\n]|\band\b|,\s*/i).map(c => c.trim()).filter(c => c.length > 3)

const hits = []
// A role the requirement asks for and this profile cannot answer.
//
// The loop used to `continue` past an unbound role, so a requirement to list
// archived memos produced a status tag and a search box and no list — the one
// thing the screen exists to do, dropped in silence because memos binds nothing
// to that role. What the profile cannot cover is the most useful thing a draft
// can say, because it is the conversation to have before anything is built.
const uncovered = []
for (const [role, cues] of Object.entries(ROLE_CUES)) {
  const cue = cues.find(c => text.includes(c))
  if (!cue) continue
  const clause = clauses.find(c => c.toLowerCase().includes(cue)) ?? requirement.trim()
  if (!binding.roles[role] || binding.roles[role].notCovered) {
    uncovered.push({ role, cue, clause: clause.slice(0, 80) })
    continue
  }
  hits.push({ role, cue, clause: clause.slice(0, 80) })
}

// The profile's own descriptions, searched. A library whose judgment tier is
// filled drafts better than one whose is empty, which is the argument for
// filling it.
const components = componentsDoc.components
const described = Object.entries(components).filter(([, c]) => c.description)
const componentHits = []
for (const clause of clauses) {
  const words = clause.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  if (!words.length) continue
  let best
  for (const [name, entry] of described) {
    const description = entry.description.toLowerCase()
    const overlap = words.filter(w => description.includes(w)).length
    if (overlap >= 2 && (!best || overlap > best.overlap)) best = { name, overlap, entry }
  }
  if (best) componentHits.push({ clause: clause.slice(0, 80), component: best.name, overlap: best.overlap })
}

const zoneFor = (role, clause) => {
  const lower = clause.toLowerCase()
  for (const [zone, cues] of Object.entries(ZONE_CUES)) {
    if (cues.some(cue => lower.includes(cue))) return zone
  }
  return role === 'pagination' ? 'footer' : 'content'
}

// Some roles are what a screen shows INSTEAD of its content, not something
// placed within it. Drafting emptyState as an element of the content zone put a
// component in the layout that only ever appears when the layout is empty.
const STATE_ROLES = new Set(['emptyState', 'loading', 'skeleton'])

const zones = {}
const stateHits = []
for (const hit of hits) {
  if (STATE_ROLES.has(hit.role)) { stateHits.push(hit); continue }
  const zone = zoneFor(hit.role, hit.clause)
  ;(zones[zone] ??= []).push(hit)
}

const states = {}
for (const [state, cues] of Object.entries(STATE_CUES)) {
  const cue = cues.find(c => text.includes(c))
  if (cue) states[state] = `mentioned as "${cue}" — decide what the screen shows`
}
for (const hit of stateHits) {
  const state = hit.role === 'emptyState' ? 'empty' : hit.role === 'loading' ? 'loading' : 'loading'
  states[state] = `${hit.role} — drafted from "${hit.cue}"`
}
// A screen that fetches has three states whether or not the requirement named
// them, and the missing one is nearly always empty.
for (const state of ['loading', 'error', 'empty']) {
  states[state] ??= 'not mentioned in the requirement, and a screen still needs it'
}

// The id becomes the component's name and its CSS class, so a requirement
// sentence cut at the fortieth character becomes a file called
// `APageListingArchivedMemosWithASeaPage` — "sea" being the surviving half of
// "search box". Whole words, and the ones that carry meaning.
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'that',
  'which', 'this', 'showing', 'shows', 'show', 'page', 'screen', 'view', 'states', 'state'])
const id = (flag('--id') ?? (() => {
  const words = requirement.trim().toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean)
  const kept = words.filter(w => !FILLER.has(w))
  return (kept.length ? kept : words).slice(0, 5).join('-')
})()).replace(/^-|-$/g, '')

const spec = {
  id,
  title: requirement.trim().slice(0, 60),
  goal: requirement.trim(),
  _draft: [
    `Generated by keyword matching against the role vocabulary and the "${PROFILE}" profile.`,
    'Every element below carries the phrase that produced it. This is a starting point',
    'for the conversation that agrees the screen, not the agreement itself.',
    'Run validate-spec before building: an impossible screen is rejected here as anywhere.',
  ],
  zones: Object.entries(zones).map(([name, items]) => ({
    name,
    purpose: `Drafted from: ${[...new Set(items.map(i => i.clause))].join(' / ')}`,
    elements: [...new Set(items.map(i => i.role))],
    _evidence: items.map(i => `${i.role} ← "${i.cue}"`),
  })),
  states,
  data: [`TODO: name the records this screen shows and their fields`],
  _componentSuggestions: componentHits.slice(0, 6).map(h =>
    `"${h.clause}" resembles ${h.component}: ${components[h.component].description}`),
  _review: [
    'Every zone assignment came from a cue table, not from reading the requirement.',
    'Roles the requirement implies but no cue matched are missing, and nothing here says so.',
  ],
}

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n')
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\ndraft-spec: "${requirement.trim().slice(0, 70)}"`)
console.log(`matched against the role vocabulary and ${described.length} described component(s) in "${PROFILE}"\n`)

if (!hits.length) {
  console.log('No role matched. The cue tables in this script are the thing to extend —')
  console.log('a requirement written in words nobody listed produces nothing, silently.')
} else {
  for (const zone of spec.zones) {
    console.log(`  ${zone.name}`)
    for (const evidence of zone._evidence) console.log(`    ${evidence}`)
  }
}

if (spec._componentSuggestions.length) {
  console.log('\nCOMPONENTS THE DESCRIPTIONS SUGGEST')
  for (const s of spec._componentSuggestions) console.log(`  ${s.slice(0, 110)}`)
}

console.log('\nSTATES')
for (const [state, note] of Object.entries(spec.states)) console.log(`  ${state.padEnd(8)} ${note}`)

if (uncovered.length) {
  console.log('\nASKED FOR, AND THIS PROFILE HAS NOTHING BOUND TO IT')
  for (const u of uncovered) {
    console.log(`  ${u.role.padEnd(16)} ← "${u.cue}"`)
  }
  console.log(`  Either bind ${uncovered.map(u => u.role).join(', ')} in bindings/${PROFILE}.json, or`)
  console.log('  agree the screen composes it from what the library does have. Left out of the')
  console.log('  draft rather than answered with the nearest thing.')
}

console.log('\nThis is a draft produced by matching words. It is wrong in ways only a person')
console.log('reading the requirement can see, and it is faster to correct than to start from.')
if (OUT) console.log(`\nwritten to ${OUT}`)
else console.log('\nAdd --out <file> to keep it, then check it with validate-spec.')
