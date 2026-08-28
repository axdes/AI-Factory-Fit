/**
 * Adapter #0 — the first-party system.
 *
 * Builds profiles/own from the artifacts packages/design-system already
 * generates, and PROVES that the profile format holds the working system without
 * loss. Until this is green, connecting a foreign library is premature: a schema
 * derived from a working system and checked against it is a schema, a schema
 * designed up front is a hypothesis.
 *
 *   node scripts/probe-own.mjs            write profiles/own
 *   node scripts/probe-own.mjs --check    fail when what is written has drifted
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CSS_REPO = process.env.CSS_REPO ?? join(homedir(), 'Downloads', 'css')
const DS = join(CSS_REPO, 'packages', 'design-system')
const OUT = join(root, 'profiles', 'own')
/**
 * Writing is the exception here, not the default.
 *
 * `profiles/own` is committed reference data — the profile every generator and test
 * measures itself against — and this rewrote it on any invocation, including one
 * meant only to see whether the command still runs. It did: an exploratory run
 * replaced 91 components with 93 from a design system that had moved on, and the
 * first sign of it was two unrelated tests failing.
 *
 * Every other writer in this tool plans first and writes on `--apply`. This one now
 * does too. `--check` stays as it was: it compares and never writes.
 */
const checkOnly = process.argv.includes('--check')
const apply = process.argv.includes('--apply')

const failures = []
const notes = []
const fail = (message) => failures.push(message)

/** Reads a JSON source, recording an unreadable one as a failure. */
function load(relPath, { required = true } = {}) {
  const abs = join(DS, relPath)
  if (!existsSync(abs)) {
    if (required) fail(`missing required source: ${relPath}`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (error) {
    fail(`${relPath} does not parse as JSON: ${error.message}`)
    return undefined
  }
}

/** Flattens a DTCG tree into its leaves (the nodes carrying $value). */
function flattenTokens(node, path = [], out = []) {
  if (node === null || typeof node !== 'object') return out
  if ('$value' in node) {
    out.push({ id: path.join('.'), value: node.$value, type: node.$type })
    return out
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    flattenTokens(child, [...path, key], out)
  }
  return out
}

const registry = load('component-registry.json')

/**
 * The counts the system publishes for itself, whatever form the index takes.
 *
 * The index was JSON and became Markdown, which is a normal thing for a system to
 * do to a file it owns. What must not change is that this probe compares its own
 * output against a count the system states independently — the whole point of the
 * equivalence proof is that two sources agree.
 */
function publishedCounts() {
  const asJson = load('component-index.json', { required: false })
  if (asJson?.counts) return { counts: asJson.counts, from: 'component-index.json' }

  const asMarkdown = existsSync(join(DS, 'component-index.md'))
    ? readFileSync(join(DS, 'component-index.md'), 'utf8')
    : undefined
  if (asMarkdown) {
    const heading = asMarkdown.split('\n')[0]
    const read = (unit) => {
      const match = heading.match(new RegExp(`(\\d+)\\s+${unit}`))
      return match ? Number(match[1]) : undefined
    }
    const counts = { components: read('components'), blocks: read('blocks'), tokens: read('tokens') }
    if (counts.components !== undefined) return { counts, from: 'component-index.md heading' }
  }

  fail('no component index in any known form (component-index.json or component-index.md)')
  return { counts: {}, from: 'none' }
}
const tokensDoc = load('tokens/design.tokens.json')
const levels = load('src/components/levels.json')
const surfaces = load('src/components/surfaces.json')
/**
 * A source the system may keep in more than one place, read from wherever it is.
 *
 * Both of these moved into `config/` and this probe kept asking for them at the
 * root, so `npm run check` stopped at "missing required source" against a system
 * that had neither lost nor renamed them. The same allowance the counts already
 * get: a system rearranging a file it owns is normal, and the probe says which
 * copy it read rather than pretending there was only ever one place to look.
 */
function loadFrom(...candidates) {
  for (const relPath of candidates) {
    const found = load(relPath, { required: false })
    if (found !== undefined) {
      if (relPath !== candidates[0]) notes.push(`${candidates[0]} read from ${relPath}`)
      return found
    }
  }
  fail(`missing required source: ${candidates.join(' or ')}`)
  return undefined
}

const vocabulary = loadFrom('prop-vocabulary.json', 'config/prop-vocabulary.json')
const twins = loadFrom('twins.json', 'config/twins.json')

if (failures.length) {
  console.error('probe-own: sources unavailable\n' + failures.map(f => '  - ' + f).join('\n'))
  console.error(`\nExpected the system repository at ${DS}`)
  console.error('Override with: CSS_REPO=/path/to/repo node scripts/probe-own.mjs')
  process.exit(1)
}

const components = registry.components ?? {}
const blocks = registry.blocks ?? {}

// What each component renders, followed from the pointer the registry already gives.
//
// The twin check needs two independent signals — prop-name overlap alone is noise,
// because two components with three props each agree by accident — and the second is
// what a component puts on the page. This profile carried none, so all 82 components
// were incomparable and `findTwins` returned an empty list on the one library where a
// duplicate is most expensive: every product that adopts it inherits the duplicate.
//
// The registry records `sourcePath` for each component, so this follows a pointer the
// artifact provides rather than going around it. A component whose source cannot be
// read keeps no `renders` field at all — not an empty one, which would read as a
// component that renders nothing.
const TYPE_WORDS = new Set(['typeof', 'keyof', 'infer', 'const', 'extends', 'readonly'])
let sourcesRead = 0
for (const [name, entry] of Object.entries(components)) {
  if (!entry.sourcePath) continue
  let text
  try { text = readFileSync(join(DS, entry.sourcePath), 'utf8') } catch {
    try { text = readFileSync(join(CSS_REPO, entry.sourcePath), 'utf8') } catch { continue }
  }
  sourcesRead += 1
  // The angle bracket of a generic follows an identifier; the angle bracket of a tag
  // does not. Without that, `React.ComponentProps<"span">` made Badge render `typeof`.
  entry.renders = [...new Set(
    [...text.matchAll(/(?<![\w>])<([a-zA-Z][\w.-]*)[\s/>]/g)].map(m => m[1]),
  )].filter(n => n !== name && !TYPE_WORDS.has(n) && !/^(HTML|SVG)\w*Element$/.test(n)).sort()
}
const componentNames = Object.keys(components)
const tokenLeaves = flattenTokens(tokensDoc)

// ── Equivalence proof ─────────────────────────────────────────────────────────
// Every check answers one question: did this fact survive the move into the
// profile format?

const { counts: expected, from: countsFrom } = publishedCounts()
notes.push(`counts published by the system: ${countsFrom}`)

if (expected.components !== undefined && expected.components !== componentNames.length) {
  fail(`registry holds ${componentNames.length} components, the index promises ${expected.components}`)
}
if (expected.blocks !== undefined && expected.blocks !== Object.keys(blocks).length) {
  fail(`registry holds ${Object.keys(blocks).length} blocks, the index promises ${expected.blocks}`)
}

// Tokens are counted two ways: the registry catalogue and the DTCG leaves. A
// difference is not necessarily wrong — the registry may publish a subset — but
// it has to be visible rather than silent.
const registryTokenCount = registry.tokens
  ? (Array.isArray(registry.tokens) ? registry.tokens.length : Object.keys(registry.tokens).length)
  : undefined
notes.push(`tokens: ${tokenLeaves.length} DTCG leaves, ${registryTokenCount ?? '—'} in the registry catalogue, index promises ${expected.tokens ?? '—'}`)
if (expected.tokens !== undefined
  && expected.tokens !== tokenLeaves.length
  && expected.tokens !== registryTokenCount) {
  fail(`no way of counting tokens agrees with the index (${expected.tokens})`)
}

for (const name of componentNames) {
  const entry = components[name]

  if (!levels[name] && !entry.level) fail(`${name}: no atomic level in levels.json or in the registry entry`)
  if (!surfaces[name] && !entry.context) fail(`${name}: no surface in surfaces.json or in the registry entry`)
  if (!entry.description) fail(`${name}: empty description — this is the index line an agent reads`)
  if (!entry.from) fail(`${name}: no import specifier (from), so the component cannot be written into code`)

  const propNames = new Set((entry.props ?? []).map(p => p.name))

  for (const prop of entry.props ?? []) {
    if ('values' in prop && (!Array.isArray(prop.values) || prop.values.length === 0)) {
      fail(`${name}.${prop.name}: declares a closed union with an empty value list`)
    }
  }

  // A variant not bound to a real prop is a variant an agent cannot choose: it
  // exists in CSS and is unreachable through the API.
  for (const [variantName, variant] of Object.entries(entry.variants ?? {})) {
    if (variant.prop && !propNames.has(variant.prop)) {
      fail(`${name}: variant "${variantName}" points at prop ${variant.prop}, which is not in props`)
    }
  }

  for (const used of entry.uses ?? []) {
    if (!components[used] && !blocks[used]) {
      fail(`${name}: uses ${used}, which is neither a component nor a block`)
    }
  }
}

// ── Profile assembly ──────────────────────────────────────────────────────────

const profile = {
  schemaVersion: 1,
  id: 'own',
  library: {
    name: 'css-design-system',
    kind: 'first-party',
    source: 'packages/design-system',
  },
  adapter: 'probe-own.mjs',
  tiers: {
    facts: ['components.json', 'tokens.json'],
    policy: ['policy.json', 'rules.json'],
    judgment: ['judgment.json'],
  },
  counts: {
    components: componentNames.length,
    blocks: Object.keys(blocks).length,
    tokens: tokenLeaves.length,
  },
}

const componentsOut = {
  schemaVersion: 1,
  components: Object.fromEntries(componentNames.map(name => {
    const entry = components[name]
    return [name, {
      ...entry,
      level: entry.level ?? levels[name],
      context: entry.context ?? surfaces[name],
    }]
  })),
  blocks,
}

const policyOut = {
  schemaVersion: 1,
  levels,
  surfaces,
  status: Object.fromEntries(
    componentNames.filter(name => components[name].status).map(name => [name, components[name].status]),
  ),
}

const judgmentOut = {
  schemaVersion: 1,
  vocabulary,
  twins,
}

const rulesOut = {
  schemaVersion: 1,
  catalogue: '../../rules/catalogue.json',
  applies: 'all',
  expressionKey: 'own',
}

const artifacts = {
  'profile.json': profile,
  'components.json': componentsOut,
  'tokens.json': tokensDoc,
  'policy.json': policyOut,
  'judgment.json': judgmentOut,
  'rules.json': rulesOut,
}

if (checkOnly) {
  for (const [name, data] of Object.entries(artifacts)) {
    const abs = join(OUT, name)
    if (!existsSync(abs)) { fail(`${name}: profile has not been built`); continue }
    if (readFileSync(abs, 'utf8') !== JSON.stringify(data, null, 2) + '\n') {
      fail(`${name}: the written profile has drifted from its source — rerun probe:own`)
    }
  }
} else if (apply) {
  mkdirSync(OUT, { recursive: true })
  for (const [name, data] of Object.entries(artifacts)) {
    writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n')
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`probe-own: source ${DS}`)
for (const note of notes) console.log(`  · ${note}`)
console.log(`  · ${componentNames.length} components, ${Object.keys(blocks).length} blocks, ${tokenLeaves.length} tokens`)

if (failures.length) {
  console.error(`\nprobe-own: FAILED — ${failures.length} discrepancy(ies):`)
  for (const failure of failures) console.error('  ✗ ' + failure)
  console.error('\nThe profile format does not hold the system without loss. Connecting a foreign library is premature.')
  process.exit(1)
}

console.log(checkOnly
  ? '\nprobe-own: the profile matches its source.'
  : apply
    ? '\nprobe-own: profile written to profiles/own — the format holds the system without loss.'
    : '\nprobe-own: the format holds the system without loss. Nothing was written —'
      + '\n  `--apply` replaces profiles/own, which is committed reference data.')
