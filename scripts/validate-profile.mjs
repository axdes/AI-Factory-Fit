/**
 * Fail-closed validator for a library profile.
 *
 * This file IS the profile contract; there is no separate JSON Schema to drift
 * away from it. Unknown shapes fail rather than pass silently, so a profile
 * cannot quietly stop being covered as the format grows.
 *
 * The load-bearing check is `translatable rules carry an expression`: a rule the
 * catalogue marks translatable, left unexpressed for this library, is a disabled
 * rule. That check is what turns "the rules hold on any framework" into a
 * statement a machine can refuse.
 *
 * MALFORMED AND UNWRITTEN ARE DIFFERENT THINGS, and collapsing them made this
 * validator unusable on the profiles that matter most.
 *
 * A profile has three tiers: facts an adapter extracts, policy somebody assigns
 * per library, and judgment somebody authors — the tier no library ships. An
 * adapter can only produce the first, and it says so: `adapt-react` writes
 * `policy: UNWRITTEN` and `judgment: UNWRITTEN` into the profile it emits.
 *
 * This read that declaration and ignored it, so the profile extracted from a real
 * client repository reported 185 problems, 177 of which were the two tiers the
 * profile itself openly said were not written yet. Unreadable, so nobody read it,
 * so `check` validated exactly one profile of six and the genuinely broken ones
 * sat there undetected.
 *
 * The same law as everywhere else in this tool, applied to its own validator:
 * NOT AUTHORED is not INVALID. Three verdicts now, and the exit codes are
 * distinct so a caller can tell them apart:
 *
 *   VALID           0   nothing missing, nothing malformed
 *   NOT GATE-READY  3   well-formed; a tier the profile declares unwritten is
 *                       unwritten. Cannot gate with it, and it is not broken.
 *   TOKEN LAYER     3   not a library profile at all. `adapt:figma` and
 *                       `style:tokens` both write a bare tokens.json under
 *                       profiles/, and reporting one as a profile missing five
 *                       files describes it as broken when it is complete.
 *   FAILED          1   the format is wrong, or a tier claimed written is not
 *
 *   node scripts/validate-profile.mjs <profile-id>
 *   node scripts/validate-profile.mjs --all      every profile, one table
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DOM_ATTRIBUTES } from './lib/score-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// ── --all: every profile on disk, so the gate covers more than one ─────────────
//
// `check` validated `own` alone, which is how two profiles sat invalid on disk
// without anybody noticing. It could not do better while this printed 185 lines
// for an honestly incomplete profile.
if (process.argv[2] === '--all') {
  const ids = readdirSync(join(root, 'profiles'), { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name).sort()
  const rows = []
  for (const each of ids) {
    let code = 0
    let out = ''
    try {
      out = execFileSync(process.execPath, [join(here, 'validate-profile.mjs'), each],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      code = error.status ?? 1
      out = (error.stdout ?? '') + (error.stderr ?? '')
    }
    const first = out.split('\n').find(l => l.trim()) ?? ''
    // The verdict is read from what the child said, not re-derived from its exit
    // code. Two states share code 3 and they are not the same news.
    const verdict = /TOKEN LAYER/.test(first) ? 'TOKEN LAYER'
      : /NOT GATE-READY/.test(first) ? 'NOT GATE-READY'
      : code === 0 ? 'VALID' : 'FAILED'
    rows.push({ id: each, code, verdict, summary: first })
  }
  console.log('\nvalidate-profile --all\n')
  for (const row of rows) {
    const verdict = row.verdict
    console.log(`  ${verdict.padEnd(15)} ${row.id}`)
    if (row.code === 1) console.log(`  ${' '.repeat(15)} ${row.summary}`)
  }
  const broken = rows.filter(r => r.code === 1)
  // An unwritten tier is work nobody has done; a malformed profile is a defect.
  // Only the second one fails this, or the gate can never include the adapters'
  // output and their 1155 lines stay uncovered.
  console.log(broken.length
    ? `\n${broken.length} profile(s) malformed. Run validate-profile on each for the detail.`
    : '\nNo profile is malformed. Unwritten tiers are named above, not counted as defects.')
  process.exit(broken.length ? 1 : 0)
}

const LEVELS = new Set(['atom', 'molecule', 'organism', 'block', 'shell', 'layout'])
const SURFACES = new Set(['page', 'region', 'card'])
const REQUIRED_FILES = ['profile.json', 'components.json', 'tokens.json', 'policy.json', 'judgment.json', 'rules.json']
const PROFILE_KEYS = new Set(['schemaVersion', 'id', 'library', 'adapter', 'tiers', 'counts', 'bindings'])

const id = process.argv[2]
if (!id) {
  console.error('usage: node scripts/validate-profile.mjs <profile-id>')
  process.exit(2)
}

const dir = join(root, 'profiles', id)
const failures = []
const fail = (message) => failures.push(message)

// Tiers the profile declares unwritten, read from the profile rather than assumed.
// `UNWRITTEN` is the marker the adapters already write, so this reads what they
// say instead of inventing a second vocabulary for the same fact.
let unwrittenTiers = new Set()
const missing = { policy: new Map(), judgment: new Map() }

// A field belonging to a tier the profile says is unwritten is not a defect; it is
// work that has not happened. Counted per KIND rather than per component, because
// "59 components have no description" is one finding and 59 lines of it is a wall
// nobody reads to the bottom of.
const absent = (tier, kind, where) => {
  if (!unwrittenTiers.has(tier)) { fail(`${where}: ${kind}`); return }
  const bucket = missing[tier]
  bucket.set(kind, (bucket.get(kind) ?? 0) + 1)
}

if (!existsSync(dir)) {
  console.error(`validate-profile: no profile at profiles/${id}`)
  process.exit(1)
}

// A token layer is what `adapt:figma` and `style:tokens` produce: one tokens.json
// under profiles/, deliberately, so it can be compared with what a client ships.
// It is not a library profile and never claimed to be. Demanding profile.json,
// policy.json and four more of it produced ten problems over a file that has
// nothing wrong with it — and, once --all joined the gate, meant that extracting a
// client's Figma tokens broke their own build.
if (!existsSync(join(dir, 'profile.json')) && existsSync(join(dir, 'tokens.json'))) {
  let count = 0
  try {
    const doc = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'))
    count = JSON.stringify(doc).match(/"\$value"/g)?.length ?? 0
  } catch (error) {
    console.error(`validate-profile(${id}): FAILED — tokens.json does not parse: ${error.message}`)
    process.exit(1)
  }
  console.log(`validate-profile(${id}): TOKEN LAYER — ${count} token(s), not a library profile.`)
  console.log('  Written by adapt:figma or style:tokens to be compared against what a client')
  console.log('  ships. There is no registry here to gate on, which is why this is not zero.')
  process.exit(3)
}

function read(name) {
  const abs = join(dir, name)
  if (!existsSync(abs)) { fail(`${name}: missing`); return undefined }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (error) {
    fail(`${name}: does not parse as JSON: ${error.message}`)
    return undefined
  }
}

for (const name of REQUIRED_FILES) {
  if (!existsSync(join(dir, name))) fail(`${name}: required file is missing`)
}

const profile = read('profile.json')
const componentsDoc = read('components.json')
const policy = read('policy.json')
const judgment = read('judgment.json')
const rules = read('rules.json')

// ── profile.json ──────────────────────────────────────────────────────────────

if (profile) {
  unwrittenTiers = new Set(Object.entries(profile.tiers ?? {})
    .filter(([, value]) => /UNWRITTEN/i.test(String(value)))
    .map(([tier]) => tier))

  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEYS.has(key)) fail(`profile.json: unknown key "${key}" — extend the validator before extending the format`)
  }
  if (profile.schemaVersion !== 1) fail(`profile.json: unsupported schemaVersion ${profile.schemaVersion}`)
  if (profile.id !== id) fail(`profile.json: id "${profile.id}" does not match the directory "${id}"`)
  if (!profile.library?.name) fail('profile.json: library.name is required')
  if (!profile.library?.kind) fail('profile.json: library.kind is required (first-party | third-party)')
  if (!profile.adapter) fail('profile.json: adapter is required — a profile records what produced it')
}

// ── components.json ───────────────────────────────────────────────────────────

const components = componentsDoc?.components ?? {}
const names = Object.keys(components)

if (componentsDoc && names.length === 0) fail('components.json: no components — an empty registry cannot be discovery-first')

for (const name of names) {
  const entry = components[name]
  const at = `components.json/${name}`

  // Description is judgment; level and surface are policy. An import specifier is
  // a fact, and an adapter that could not find one has failed at its own job.
  if (!entry.description) absent('judgment', 'no description; the line an agent reads to choose', at)
  if (!entry.from) fail(`${at}: no import specifier`)
  if (!entry.level) absent('policy', 'no atomic level', at)
  else if (!LEVELS.has(entry.level)) fail(`${at}: unknown level "${entry.level}"`)
  if (!entry.context) absent('policy', 'no surface context', at)
  else if (!SURFACES.has(entry.context)) fail(`${at}: unknown surface "${entry.context}"`)
  if (!Array.isArray(entry.props)) fail(`${at}: props must be an array, even when empty`)

  for (const prop of entry.props ?? []) {
    if (!prop.name) fail(`${at}: a prop with no name`)
    if (!prop.type) fail(`${at}.${prop.name}: no type`)
    if ('values' in prop && (!Array.isArray(prop.values) || prop.values.length === 0)) {
      fail(`${at}.${prop.name}: closed union with an empty value list`)
    }
  }
}

if (profile?.counts?.components !== undefined && profile.counts.components !== names.length) {
  fail(`profile.json: counts.components is ${profile.counts.components}, components.json holds ${names.length}`)
}

// ── policy.json ───────────────────────────────────────────────────────────────

if (policy) {
  for (const [name, level] of Object.entries(policy.levels ?? {})) {
    if (!LEVELS.has(level)) fail(`policy.json/levels: ${name} has unknown level "${level}"`)
  }
  for (const [name, surface] of Object.entries(policy.surfaces ?? {})) {
    if (!SURFACES.has(surface)) fail(`policy.json/surfaces: ${name} has unknown surface "${surface}"`)
  }
}

// ── judgment.json ─────────────────────────────────────────────────────────────
// A twin entry without its reopening condition is an excuse rather than a
// decision: the next person inherits the claim instead of being able to check it.

for (const [pair, entry] of Object.entries(judgment?.twins?.pairs ?? {})) {
  if (!entry.separated) fail(`judgment.json/twins: "${pair}" does not say how the two differ`)
  if (!entry.reopenIf) fail(`judgment.json/twins: "${pair}" has no reopening condition`)
}

// ── rules.json — the load-bearing check ───────────────────────────────────────

if (rules) {
  const cataloguePath = join(dir, rules.catalogue ?? '../../rules/catalogue.json')
  if (!existsSync(cataloguePath)) {
    fail(`rules.json: catalogue not found at ${rules.catalogue}`)
  } else {
    const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'))
    const key = rules.expressionKey
    // No key is one fact about the profile, not one fact per rule. Reporting it as
    // seven problems — six of them `has no expression for "null"` — described a
    // deliberate state as if it were a bug, and buried the one line that was true.
    if (!key) absent('policy', 'no expressionKey, so every translatable rule is disabled', 'rules.json')

    for (const [ruleId, rule] of Object.entries(catalogue.rules ?? {})) {
      if (key && rule.class === 'translatable') {
        const expressed = rule.expression?.[key]
        if (!expressed) {
          fail(`rules.json: translatable rule "${ruleId}" has no expression for "${key}" — an untranslated rule is a disabled rule`)
        }
      }
      if (rule.class !== 'system-owned' && !rule.enforcedBy) {
        fail(`rules/catalogue.json: "${ruleId}" names no check; a rule with no check is a wish`)
      }
    }
  }
}

// ── bindings, when one exists ─────────────────────────────────────────────────
// A binding that points at a component the registry does not have fails only when
// somebody writes a spec that uses that role — which is late, and looks like the
// spec's fault. It is checked here instead.

const bindingPath = join(root, 'bindings', `${id}.json`)
if (existsSync(bindingPath)) {
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'))
  const vocabularyPath = join(root, 'roles', 'vocabulary.json')
  const vocabulary = existsSync(vocabularyPath) ? JSON.parse(readFileSync(vocabularyPath, 'utf8')) : { roles: {} }

  for (const [role, bound] of Object.entries(binding.roles ?? {})) {
    if (!vocabulary.roles[role]) fail(`bindings/${id}.json: "${role}" is not a role in the vocabulary`)
    if (bound.notCovered) continue
    if (!bound.component) { fail(`bindings/${id}.json: ${role} binds to nothing and does not say it is uncovered`); continue }
    if (!components[bound.component]) {
      fail(`bindings/${id}.json: ${role} points at ${bound.component}, which is not in this registry`)
      continue
    }
    const declared = new Map((components[bound.component].props ?? []).map(p => [p.name, p]))
    for (const [prop, value] of Object.entries(bound.props ?? {})) {
      const spec = declared.get(prop)
      if (!spec) {
        // A component that spreads DOM attributes accepts them, and the scorer
        // already knows this — it stopped reporting `<Input type>` as an invented
        // prop for exactly this reason. The validator refusing the same binding
        // means two rules for one question, and a team hitting whichever is
        // stricter without being able to tell which.
        if (components[bound.component].inherits && DOM_ATTRIBUTES.has(prop)) continue
        fail(`bindings/${id}.json: ${role} sets ${bound.component}.${prop}, which is not a declared prop`)
        continue
      }
      if (spec.values && !spec.values.includes(String(value))) {
        fail(`bindings/${id}.json: ${role} sets ${bound.component}.${prop}="${value}", outside its union (${spec.values.join(' | ')})`)
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`validate-profile(${id}): FAILED — ${failures.length} problem(s):`)
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}

const unwritten = [...unwrittenTiers].filter(tier => (missing[tier]?.size ?? 0) > 0)
if (unwritten.length) {
  console.log(`validate-profile(${id}): NOT GATE-READY — well-formed, and ${unwritten.join(' and ')} ${unwritten.length > 1 ? 'are' : 'is'} unwritten.`)
  console.log(`  ${names.length} components extracted; the facts are here.`)
  for (const tier of unwritten) {
    console.log(`\n  ${tier.toUpperCase()} — ${String(profile.tiers[tier]).replace(/^UNWRITTEN\s*[—-]\s*/i, '')}`)
    for (const [kind, count] of [...missing[tier]].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)} × ${kind}`)
    }
  }
  console.log('\n  This is work nobody has done, not a defect. Nothing can be gated on it')
  console.log('  until it is done, which is why this does not exit zero.')
  process.exit(3)
}

console.log(`validate-profile(${id}): ${names.length} components, ${Object.keys(policy?.levels ?? {}).length} levels, rules expressed for "${rules?.expressionKey}". Valid.`)
