/**
 * Adapter: Ant Design (antd) into a library profile.
 *
 * The second third-party library, and it extracts differently enough from MUI to
 * be worth having: Ant derives most of its unions from runtime tuples
 * (`(typeof _ButtonTypes)[number]`) and declares them one file away from the
 * props that use them. A resolver that handles only inline unions reads none of
 * them, and reports the library's most-used component as taking free-form
 * strings — which is exactly the licence to invent that a registry exists to
 * withdraw.
 *
 * The theme is executed, not parsed: `theme.getDesignToken()` returns the alias
 * tier as values, so the tokens are the ones Ant will actually apply.
 *
 * Judgment is absent here, as it is from every library. What a component is FOR,
 * and which of two neighbours to reach for, is authored — a day per library,
 * reusable across every client on that stack.
 *
 *   node scripts/adapt-antd.mjs [--sandbox <path>] [--out antd]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createResolver, firstSentence } from './lib/dts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
// See adapt-mui: an absolute path into somebody's temp directory is not a default.
const SANDBOX = flag('--sandbox') ?? process.env.DS_SANDBOX ?? join(root, '.sandboxes', 'antd')
const OUT_ID = flag('--out') ?? 'antd'

const ANTD = join(SANDBOX, 'node_modules', 'antd')
if (!existsSync(ANTD)) {
  console.error(`adapt-antd: antd not found under ${SANDBOX}`)
  process.exit(1)
}

const require = createRequire(join(SANDBOX, 'package.json'))
const ts = require('typescript')
const version = require('antd/package.json').version

// ── Facts: the theme, executed ────────────────────────────────────────────────

const { theme } = require('antd')
const designToken = theme.getDesignToken()

const token = (value, type, path) => ({
  $value: value,
  ...type ? { $type: type } : {},
  $extensions: { 'org.ds-profile': { tokenPath: path, source: `antd@${version} theme.getDesignToken()` } },
})

const isColour = (v) => typeof v === 'string' && /^(#|rgba?\()/.test(v)
const tokens = { $description: `Ant Design alias tokens, executed from antd@${version}.` }

// Ant's alias tier is flat, and its names carry the tier: colorX, fontSizeX,
// paddingX. Grouping by that prefix is the library's own structure, not ours.
const groups = { color: {}, font: {}, size: {}, padding: {}, margin: {}, border: {}, line: {}, motion: {}, screen: {}, box: {}, control: {}, other: {} }
for (const [key, value] of Object.entries(designToken)) {
  if (typeof value === 'object' || typeof value === 'function') continue
  const group = Object.keys(groups).find(g => key.toLowerCase().startsWith(g)) ?? 'other'
  groups[group][key] = token(value, isColour(value) ? 'color' : typeof value === 'number' ? 'number' : undefined, key)
}
for (const [name, entries] of Object.entries(groups)) {
  if (Object.keys(entries).length) tokens[name] = entries
}

// ── Facts: components, from the shipped declarations ──────────────────────────

const esDir = join(ANTD, 'es')
const componentDirs = readdirSync(esDir).filter(name => {
  const dir = join(esDir, name)
  try { return readdirSync(dir).some(f => f.endsWith('.d.ts')) } catch { return false }
})

// Every declaration file in a component's folder, so an alias declared beside the
// props can be followed.
const sources = new Map()
const parse = (file) => {
  if (sources.has(file)) return sources.get(file)
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  sources.set(file, source)
  return source
}

for (const dir of componentDirs) {
  for (const file of readdirSync(join(esDir, dir))) {
    if (file.endsWith('.d.ts')) parse(join(esDir, dir, file))
  }
}

const resolveImport = (from, specifier) => {
  if (!specifier.startsWith('.')) return undefined
  const base = join(dirname(from), specifier)
  for (const candidate of [`${base}.d.ts`, join(base, 'index.d.ts')]) {
    if (sources.has(candidate)) return candidate
  }
  return undefined
}

const { literalValues } = createResolver(ts, sources, resolveImport)

const pascal = (name) => name.split(/[-_]/).map(p => p[0]?.toUpperCase() + p.slice(1)).join('')

const components = {}
const noProps = []

for (const dir of componentDirs) {
  const name = pascal(dir)
  const candidates = [`${name}Props`, `Base${name}Props`, `${name}OwnProps`, `${name}BaseProps`]

  let target, targetFile
  for (const file of readdirSync(join(esDir, dir)).filter(f => f.endsWith('.d.ts'))) {
    const path = join(esDir, dir, file)
    const source = sources.get(path)
    if (!source) continue
    source.forEachChild(node => {
      if (!ts.isInterfaceDeclaration(node)) return
      const rank = candidates.indexOf(node.name.text)
      if (rank === -1) return
      if (!target || rank < candidates.indexOf(target.name.text)) { target = node; targetFile = path }
    })
  }
  if (!target) { noProps.push(name); continue }

  // Members reached through `extends`, not only the ones written here. Ant puts
  // its component's real props on Base<Name>Props and leaves <Name>Props holding
  // three of its own; reading the leaf alone reported Button as taking htmlType
  // and nothing else — no type, no size, no variant.
  const collectMembers = (node, file, seen = new Set()) => {
    const key = `${file}#${node.name.text}`
    if (seen.has(key)) return []
    const next = new Set([...seen, key])
    const out = [...node.members].map(m => ({ member: m, file }))

    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const baseName = type.expression.getText?.()
        if (!baseName) continue
        const findIn = (candidateFile) => {
          const source = sources.get(candidateFile)
          let found
          source?.forEachChild(child => {
            if (ts.isInterfaceDeclaration(child) && child.name.text === baseName) found = child
          })
          return found
        }
        let base = findIn(file)
        let baseFile = file
        if (!base) {
          const table = { imports: new Map() }
          sources.get(file)?.forEachChild(child => {
            if (ts.isImportDeclaration(child) && child.importClause?.namedBindings?.elements) {
              for (const element of child.importClause.namedBindings.elements) {
                table.imports.set(element.name.text, child.moduleSpecifier.text)
              }
            }
          })
          const specifier = table.imports.get(baseName)
          const resolved = specifier && resolveImport(file, specifier)
          if (resolved) { base = findIn(resolved); baseFile = resolved }
        }
        if (base) out.push(...collectMembers(base, baseFile, next))
      }
    }
    return out
  }

  const members = collectMembers(target, targetFile)
  const props = []
  const seenProps = new Set()
  for (const { member, file: memberFile } of members) {
    if (!ts.isPropertySignature(member) || !member.name) continue
    const propName = member.name.getText()
    if (/^(className|style|prefixCls|rootClassName|classNames|styles)$/.test(propName)) continue
    if (seenProps.has(propName)) continue
    seenProps.add(propName)
    const values = literalValues(member.type, memberFile)
    props.push({
      name: propName,
      type: member.type ? member.type.getText().replace(/\s+/g, ' ').slice(0, 80) : 'unknown',
      required: !member.questionToken,
      ...values ? { values } : {},
      ...firstSentence(ts, member, sources.get(memberFile)) ? { description: firstSentence(ts, member, sources.get(memberFile)) } : {},
    })
  }

  components[name] = {
    ref: name,
    exports: [name],
    main: name,
    from: 'antd',
    slots: [],
    props,
    sourcePath: `node_modules/antd/es/${dir}/${basename(targetFile)}`,
    variants: Object.fromEntries(props.filter(p => p.values).map(p => [p.name, { prop: p.name, values: p.values }])),
    uses: [],
    provenance: { facts: 'shipped .d.ts', description: 'not published by the library', level: 'not assigned' },
  }
}

// ── Tiers: policy and judgment, merged in from the seed ───────────────────────
//
// Kept in a separate file so that a year from now it is still obvious which lines
// Ant declared and which lines a person decided.

const SEED_PATH = join(root, 'seeds', 'antd.judgment.json')
const seed = existsSync(SEED_PATH) ? JSON.parse(readFileSync(SEED_PATH, 'utf8')) : { components: {}, exclude: {} }

const excluded = {}
for (const [name, reason] of Object.entries(seed.exclude ?? {})) {
  if (components[name]) { excluded[name] = reason; delete components[name] }
}

const uncovered = []
for (const [name, entry] of Object.entries(components)) {
  const authored = seed.components?.[name]
  if (!authored) { uncovered.push(name); continue }
  entry.level = authored.level
  entry.context = authored.surface
  entry.description = authored.description
  entry.provenance = { facts: 'shipped .d.ts', description: 'authored', level: 'authored', context: 'authored' }
}

const levels = {}
const surfaces = {}
for (const [name, entry] of Object.entries(components)) {
  if (entry.level) levels[name] = entry.level
  if (entry.context) surfaces[name] = entry.context
}

// ── Write ─────────────────────────────────────────────────────────────────────

const outDir = join(root, 'profiles', OUT_ID)
mkdirSync(outDir, { recursive: true })
const write = (file, data) => writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + '\n')

const tokenCount = JSON.stringify(tokens).split('"$value"').length - 1

write('profile.json', {
  schemaVersion: 1,
  id: OUT_ID,
  library: { name: 'antd', kind: 'third-party', source: `antd@${version}` },
  adapter: 'adapt-antd.mjs',
  tiers: { facts: ['components.json', 'tokens.json'], policy: ['policy.json', 'rules.json'], judgment: ['judgment.json'] },
  counts: { components: Object.keys(components).length, blocks: 0, tokens: tokenCount },
})
write('components.json', { schemaVersion: 1, components, blocks: {} })
write('tokens.json', tokens)
write('policy.json', {
  schemaVersion: 1,
  _: 'Levels and surfaces do not exist in Ant Design. These are assignments this system makes, authored in seeds/antd.judgment.json.',
  levels, surfaces, status: {}, excluded,
})
write('judgment.json', {
  schemaVersion: 1,
  _: 'Authored, not extracted. Source: seeds/antd.judgment.json.',
  vocabulary: seed.vocabulary ?? {}, twins: seed.twins ?? { pairs: {} },
})
write('rules.json', { schemaVersion: 1, catalogue: '../../rules/catalogue.json', applies: 'all', expressionKey: 'antd' })

// ── Report ────────────────────────────────────────────────────────────────────

const withUnions = Object.values(components).filter(c => Object.keys(c.variants).length)
const totalProps = Object.values(components).reduce((n, c) => n + c.props.length, 0)
const totalValues = Object.values(components).reduce(
  (n, c) => n + Object.values(c.variants).reduce((s, v) => s + v.values.length, 0), 0)

console.log(`\nadapt-antd: antd@${version}`)
console.log('\nFACTS — taken, not guessed')
console.log(`  components         ${Object.keys(components).length} of ${componentDirs.length} folders`)
console.log(`  props              ${totalProps}`)
console.log(`  closed unions      ${totalValues} values across ${withUnions.length} components`)
console.log(`  tokens             ${tokenCount} from the executed theme`)
if (noProps.length) console.log(`  no props interface ${noProps.length} (${noProps.slice(0, 6).join(', ')}${noProps.length > 6 ? ', …' : ''})`)

console.log('\nUNIONS RECOVERED THROUGH EACH INDIRECTION')
for (const c of withUnions.slice(0, 6)) {
  console.log(`  ${c.ref.padEnd(14)} ${Object.entries(c.variants).map(([k, v]) => `${k}: ${v.values.join('|')}`).join('   ').slice(0, 100)}`)
}

console.log('\nPOLICY AND JUDGMENT — authored in seeds/antd.judgment.json')
console.log(`  excluded             ${Object.keys(excluded).length} providers and wrappers, with a reason each`)
console.log(`  levels and surfaces  ${Object.keys(levels).length} of ${Object.keys(components).length}`)
console.log(`  descriptions         ${Object.values(components).filter(c => c.description).length} written — Ant publishes none in its types`)
console.log(`  twins                ${Object.keys(seed.twins?.pairs ?? {}).length} pairs decided`)
if (uncovered.length) {
  console.error(`\n  NOT COVERED BY THE SEED — ${uncovered.length}: ${uncovered.join(', ')}`)
}
console.log(`\nwritten to profiles/${OUT_ID}/`)
