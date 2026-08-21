/**
 * A client's Figma variables, as a token layer in the same shape as the other two.
 *
 * There are three places a client's visual language is written down and they
 * disagree: the design file says what was decided, the live site says what was
 * shipped, and the code says what is maintained. Reading one and calling it the
 * system is how a token layer gets rejected by whoever owns the other two.
 *
 * So this reads the third, into the same DTCG shape `style:tokens` produces from
 * a site, which makes them comparable — and the disagreement is the finding.
 * "Your brand blue is #1A73E8 in Figma, #1B74E9 on the site and a hardcoded
 * literal in nineteen components" is a conversation. "Here is a palette" is not.
 *
 * Facts only, as everywhere here. A variable's name, its resolved value per mode,
 * and its collection. What a variable is FOR — whether `blue/500` is the primary
 * action colour or a chart series — is judgment that lives in the bindings, and
 * guessing it from the name is how a token layer ends up confidently wrong.
 *
 *   node scripts/adapt-figma.mjs --file <key> --token <pat> --out <id>
 *   node scripts/adapt-figma.mjs --from <variables.json> --out <id>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const FILE = flag('--file')
const TOKEN = flag('--token') ?? process.env.FIGMA_TOKEN
const FROM = flag('--from')
const OUT = flag('--out')

if (!OUT || (!FILE && !FROM)) {
  console.error('usage: node scripts/adapt-figma.mjs --file <key> --token <pat> --out <id>')
  console.error('       node scripts/adapt-figma.mjs --from <variables.json> --out <id>')
  console.error('')
  console.error('The REST variables endpoint is Enterprise-only. Everywhere else, export the')
  console.error('response once — from the Dev Mode MCP or a plugin — and pass it with --from.')
  process.exit(2)
}

// ── The response ──────────────────────────────────────────────────────────────

const payload = await (async () => {
  if (FROM) {
    if (!existsSync(FROM)) { console.error(`adapt-figma: no file at ${FROM}`); process.exit(1) }
    try { return JSON.parse(readFileSync(FROM, 'utf8')) } catch (error) {
      console.error(`adapt-figma: ${FROM} does not parse as JSON: ${error.message}`)
      process.exit(1)
    }
  }
  if (!TOKEN) {
    console.error('adapt-figma: --token or FIGMA_TOKEN is required to read a file over the API.')
    console.error('The scope needed is file_variables:read, which Figma grants on Enterprise plans only.')
    process.exit(2)
  }
  const url = `https://api.figma.com/v1/files/${FILE}/variables/local`
  let response
  try {
    response = await fetch(url, { headers: { 'X-Figma-Token': TOKEN } })
  } catch (error) {
    console.error(`adapt-figma: could not reach ${url}: ${error.message}`)
    process.exit(1)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`adapt-figma: Figma answered ${response.status}.`)
    // The two failures worth telling apart, because one is a plan and the other a
    // typo, and "403" sends somebody to check the wrong thing.
    if (response.status === 403) {
      console.error('  403 on this endpoint is usually the plan, not the token: the variables API')
      console.error('  is Enterprise-only. Export the variables once and pass them with --from.')
    }
    if (response.status === 404) console.error('  404 means the file key is wrong, or the token cannot see that file.')
    if (body) console.error(`  ${body.slice(0, 200)}`)
    process.exit(1)
  }
  return response.json()
})()

const meta = payload.meta ?? payload
const variables = meta.variables ?? {}
const collections = meta.variableCollections ?? {}

if (!Object.keys(variables).length) {
  console.error('adapt-figma: the response holds no variables.')
  console.error('This is not an empty design system; it is a response this pass could not read.')
  console.error('Expected `meta.variables` keyed by id, as GET /v1/files/:key/variables/local returns.')
  process.exit(1)
}

// ── Resolution ────────────────────────────────────────────────────────────────

const hex = (c) => {
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  const base = `#${to(c.r)}${to(c.g)}${to(c.b)}`
  return c.a === undefined || c.a >= 1 ? base : base + to(c.a)
}

/**
 * A variable's value in one mode, following aliases to a literal.
 *
 * An alias chain that loops, or points at a variable this file does not hold, is
 * left unresolved rather than flattened to whatever was nearest — an invented
 * colour in a token layer is a colour somebody ships.
 */
const resolve = (id, modeId, seen = new Set()) => {
  if (seen.has(id)) return { unresolved: 'the alias chain loops' }
  const variable = variables[id]
  if (!variable) return { unresolved: 'the alias points outside this file, most often at a published library' }
  const collection = collections[variable.variableCollectionId]
  const mode = modeId && variable.valuesByMode?.[modeId] !== undefined ? modeId : collection?.defaultModeId
  const value = variable.valuesByMode?.[mode]
  if (value === undefined) return { unresolved: 'no value in this mode' }
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    return resolve(value.id, modeId, new Set([...seen, id]))
  }
  if (value && typeof value === 'object' && 'r' in value) return { value: hex(value) }
  return { value }
}

const DTCG_TYPE = { COLOR: 'color', FLOAT: 'dimension', STRING: 'string', BOOLEAN: 'boolean' }

// ── Build ─────────────────────────────────────────────────────────────────────

const tokens = {
  $description: `Extracted from Figma variables by adapt-figma. Facts only: each variable's name, its resolved value per mode, and the collection it belongs to. What a variable is FOR is judgment and is not here — guessing that a variable called blue/500 is the primary action colour is how a token layer ends up confidently wrong.`,
}
const unresolved = []
const modesSeen = new Map()

for (const [id, variable] of Object.entries(variables)) {
  if (variable.remote) continue
  const collection = collections[variable.variableCollectionId]
  const modes = collection?.modes ?? [{ modeId: collection?.defaultModeId, name: 'default' }]
  if (collection) modesSeen.set(collection.name, modes.map(m => m.name))

  // `colour/brand/500` becomes nested groups, which is what DTCG is and what the
  // other two sources already produce.
  const path = variable.name.split('/').map(p => p.trim()).filter(Boolean)
  if (!path.length) continue

  const primary = resolve(id, collection?.defaultModeId)
  if (primary.unresolved) {
    unresolved.push({ name: variable.name, why: primary.unresolved })
    continue
  }

  let node = tokens
  for (const part of path.slice(0, -1)) node = (node[part] ??= {})
  const leaf = {
    $type: DTCG_TYPE[variable.resolvedType] ?? 'string',
    $value: primary.value,
    ...variable.description ? { $description: variable.description } : {},
  }

  // Other modes ride under $extensions rather than becoming separate tokens: a
  // dark value is the same decision under different light, not another token.
  const others = modes.filter(m => m.modeId !== collection?.defaultModeId)
  if (others.length) {
    const byMode = {}
    for (const mode of others) {
      const r = resolve(id, mode.modeId)
      if (r.unresolved) unresolved.push({ name: `${variable.name} (${mode.name})`, why: r.unresolved })
      else byMode[mode.name] = r.value
    }
    if (Object.keys(byMode).length) leaf.$extensions = { 'com.figma.modes': byMode }
  }
  node[path.at(-1)] = leaf
}

const outDir = join(root, 'profiles', OUT)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n')

// ── Report ────────────────────────────────────────────────────────────────────

const count = (node) => Object.entries(node).reduce((n, [k, v]) =>
  k.startsWith('$') ? n : n + (v && typeof v === 'object' && '$value' in v ? 1 : count(v)), 0)
const total = count(tokens)

console.log(`\nadapt-figma: ${FROM ?? `file ${FILE}`}`)
console.log(`${Object.keys(variables).length} variable(s) in ${Object.keys(collections).length} collection(s)\n`)
console.log(`  ${String(total).padStart(4)}  tokens written`)
console.log(`  ${String(unresolved.length).padStart(4)}  left unresolved rather than guessed`)
for (const [collection, modes] of modesSeen) {
  console.log(`        ${collection}: ${modes.join(', ')}`)
}

if (unresolved.length) {
  console.log('\nUNRESOLVED — recorded, not filled in')
  for (const u of unresolved.slice(0, 8)) console.log(`  ${u.name.padEnd(40)} ${u.why}`)
  console.log('\n  An alias pointing at a published library resolves in Figma and not here.')
  console.log('  Reading the library file too is the fix; inventing the value is not.')
}

console.log('\nWHAT IS NOT HERE, BECAUSE IT IS NOT A FACT')
console.log('  which token is the primary action, the danger state, the page background —')
console.log('  that is judgment, it lives in the bindings, and no design file carries it.')

console.log(`\nwritten to profiles/${OUT}/tokens.json`)
console.log(`Compare against what they ship:  node scripts/style-to-tokens.mjs <style-id> --compare ${OUT}`)
