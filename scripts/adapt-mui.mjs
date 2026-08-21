/**
 * Adapter: MUI (@mui/material) into a library profile.
 *
 * Facts are taken, never guessed. The theme is EXECUTED and serialised rather
 * than parsed, so the token values are the ones the library will actually apply;
 * props and their closed unions come from the shipped .d.ts through the
 * TypeScript AST, so they are the unions the compiler enforces.
 *
 * Policy and judgment are different tiers and come from elsewhere. Atomic level,
 * surface, the sentence that tells an agent which component to pick, and the
 * pairs that get confused do not exist in MUI and cannot be derived from it.
 * They are authored in seeds/mui.judgment.json and merged here, tagged with their
 * provenance so that a year from now it is still obvious which lines the library
 * declared and which lines a person decided.
 *
 * A component the library ships and the seed does not cover is reported rather
 * than defaulted. A profile that quietly invents a level asserts something nobody
 * decided, which is the failure this whole arrangement exists to prevent.
 *
 *   node scripts/adapt-mui.mjs [--sandbox <path>] [--out mui]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const sandboxArg = process.argv.indexOf('--sandbox')
// Where the library is installed. This defaulted to the absolute path of a
// scratch directory on one machine, which is a tool that runs for one person
// until that directory is cleared. `--sandbox` names it, and without one the
// default sits beside the tool where anybody can find it.
const SANDBOX = sandboxArg === -1
  ? process.env.DS_SANDBOX ?? join(root, '.sandboxes', 'mui')
  : process.argv[sandboxArg + 1]
const outArg = process.argv.indexOf('--out')
const OUT_ID = outArg === -1 ? 'mui' : process.argv[outArg + 1]

const MUI = join(SANDBOX, 'node_modules', '@mui', 'material')
if (!existsSync(MUI)) {
  console.error(`adapt-mui: @mui/material not found under ${SANDBOX}`)
  process.exit(1)
}

const require = createRequire(join(SANDBOX, 'package.json'))
const ts = require('typescript')
const muiVersion = require('@mui/material/package.json').version

// ── Tier: facts — the theme, executed ─────────────────────────────────────────

const { createTheme } = require('@mui/material/styles')
const theme = createTheme()

/** Wraps a value as a DTCG token carrying the theme path that produced it. */
const token = (value, type, path, description) => ({
  $value: value,
  ...type ? { $type: type } : {},
  ...description ? { $description: description } : {},
  $extensions: { 'org.ds-profile': { themePath: path, source: `@mui/material@${muiVersion} createTheme()` } },
})

const tokens = { $description: `MUI default theme, executed from @mui/material@${muiVersion}.` }

// Palette. The role tier of MUI: this is what a component may reference.
const paletteRoles = ['primary', 'secondary', 'error', 'warning', 'info', 'success']
tokens.palette = {}
for (const role of paletteRoles) {
  const entry = theme.palette[role]
  if (!entry) continue
  tokens.palette[role] = {}
  for (const slot of ['main', 'light', 'dark', 'contrastText']) {
    if (entry[slot]) tokens.palette[role][slot] = token(entry[slot], 'color', `palette.${role}.${slot}`)
  }
}
for (const group of ['text', 'background', 'action']) {
  const entry = theme.palette[group]
  if (!entry) continue
  tokens.palette[group] = {}
  for (const [slot, value] of Object.entries(entry)) {
    if (typeof value === 'string') tokens.palette[group][slot] = token(value, 'color', `palette.${group}.${slot}`)
  }
}
if (theme.palette.divider) tokens.palette.divider = token(theme.palette.divider, 'color', 'palette.divider')
if (theme.palette.grey) {
  tokens.palette.grey = Object.fromEntries(
    Object.entries(theme.palette.grey).map(([stop, value]) => [stop, token(value, 'color', `palette.grey.${stop}`)]),
  )
}

// Typography.
tokens.typography = {}
for (const [key, value] of Object.entries(theme.typography)) {
  if (typeof value === 'string' || typeof value === 'number') {
    tokens.typography[key] = token(value, typeof value === 'number' ? 'number' : undefined, `typography.${key}`)
  } else if (value && typeof value === 'object' && 'fontSize' in value) {
    tokens.typography[key] = Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([slot, v]) => [slot, token(v, undefined, `typography.${key}.${slot}`)]),
    )
  }
}

// Spacing is a function, not a table. Its scale is materialised so the profile
// can state what a spacing step actually resolves to.
tokens.spacing = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6, 8, 10, 12].map(step => [
    String(step),
    token(theme.spacing(step), 'dimension', `spacing(${step})`),
  ]),
)

tokens.shape = { borderRadius: token(theme.shape.borderRadius, 'dimension', 'shape.borderRadius') }
tokens.breakpoints = Object.fromEntries(
  Object.entries(theme.breakpoints.values).map(([k, v]) => [k, token(v, 'dimension', `breakpoints.values.${k}`)]),
)
tokens.zIndex = Object.fromEntries(
  Object.entries(theme.zIndex).map(([k, v]) => [k, token(v, 'number', `zIndex.${k}`)]),
)
tokens.transitions = {
  duration: Object.fromEntries(
    Object.entries(theme.transitions.duration)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => [k, token(v, 'duration', `transitions.duration.${k}`)]),
  ),
}

// ── Tier: facts — components, from the shipped types ──────────────────────────

/**
 * Collects the string-literal members of a union.
 *
 * Follows the two indirections MUI actually uses: OverridableStringUnion, and a
 * reference to a type alias declared in the same file. Without the second, a
 * component whose variant union lives one line away in `<Name>Variants` reports
 * no closed set at all, and an agent is free to invent a value.
 */
function literalValues(typeNode, aliases = new Map(), seen = new Set()) {
  if (!typeNode) return undefined
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) return [typeNode.literal.text]
  if (ts.isUnionTypeNode(typeNode)) {
    const values = []
    for (const member of typeNode.types) {
      // `| undefined` and `| null` widen the type; they are not choices an
      // author picks, so they do not belong in the value list.
      if (member.kind === ts.SyntaxKind.UndefinedKeyword || member.kind === ts.SyntaxKind.NullKeyword) continue
      const inner = literalValues(member, aliases, seen)
      if (!inner) return undefined
      values.push(...inner)
    }
    return values.length ? values : undefined
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText()
    // MUI declares an extensible union as OverridableStringUnion<Literals, Overrides>.
    // The first argument is the closed set the library ships with.
    if (name === 'OverridableStringUnion' && typeNode.typeArguments?.length) {
      return literalValues(typeNode.typeArguments[0], aliases, seen)
    }
    // A local alias. The seen set stops a self-referential alias from recursing.
    if (aliases.has(name) && !seen.has(name)) {
      return literalValues(aliases.get(name).type, aliases, new Set([...seen, name]))
    }
  }
  return undefined
}

/** First sentence of a JSDoc comment: the line an agent reads to choose. */
function firstSentence(node, source) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.pos) ?? []
  for (const range of ranges) {
    const text = source.text.slice(range.pos, range.end)
    if (!text.startsWith('/**')) continue
    const body = text
      .replace(/^\/\*\*/, '').replace(/\*\/$/, '')
      .split('\n').map(l => l.replace(/^\s*\*ी?\s?/, '').replace(/^\s*\*\s?/, '').trim())
      .filter(l => l && !l.startsWith('@'))
      .join(' ')
      .trim()
    if (!body) continue
    const stop = body.search(/\.\s|\.$/)
    return (stop === -1 ? body : body.slice(0, stop + 1)).trim()
  }
  return undefined
}

function defaultTag(node, source) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.pos) ?? []
  for (const range of ranges) {
    const match = source.text.slice(range.pos, range.end).match(/@default\s+(.+)/)
    if (match) return match[1].trim()
  }
  return undefined
}

const componentDirs = readdirSync(MUI).filter(name => /^[A-Z]/.test(name) && existsSync(join(MUI, name, `${name}.d.ts`)))

const components = {}
const noProps = []

for (const name of componentDirs) {
  const file = join(MUI, name, `${name}.d.ts`)
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

  // MUI splits a component's own props from the props it inherits from its root
  // element, but it does not do so under one name. Four conventions are in use
  // across the package, and a parser that knows only the commonest one silently
  // drops TextField, Select and Grid — the three components a real project uses
  // most. Candidates are tried in order of specificity.
  const candidates = [`${name}OwnProps`, `Base${name}Props`, `${name}BaseProps`, `${name}Props`]
  const declared = new Map()
  const aliases = new Map()
  source.forEachChild(node => {
    if (ts.isInterfaceDeclaration(node)) declared.set(node.name.text, node)
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node)
  })
  const target = candidates.map(c => declared.get(c)).find(Boolean)
  if (!target) { noProps.push(name); continue }

  const props = []
  for (const member of target.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue
    const propName = member.name.getText()
    if (propName === 'sx' || propName === 'classes') continue
    const values = literalValues(member.type, aliases)
    props.push({
      name: propName,
      type: member.type ? member.type.getText().replace(/\s+/g, ' ').replace(/ \| undefined$/, '') : 'unknown',
      required: !member.questionToken,
      ...values ? { values } : {},
      ...defaultTag(member, source) ? { default: defaultTag(member, source) } : {},
      ...firstSentence(member, source) ? { description: firstSentence(member, source) } : {},
    })
  }

  // Some components keep `variant` out of the props interface and declare it as a
  // standalone `<Name>Variants` alias, because each variant carries a different
  // prop set. The union is still the closed choice an author makes, so it belongs
  // in the registry rather than being lost to the file layout.
  if (!props.some(p => p.name === 'variant')) {
    const alias = aliases.get(`${name}Variants`) ?? aliases.get(`${name}Variant`)
    const values = alias && literalValues(alias.type, aliases)
    if (values?.length) {
      props.push({
        name: 'variant',
        type: `${name}Variants`,
        required: false,
        values,
        description: `Which ${name} shape to render; each variant carries its own prop set.`,
      })
    }
  }

  // No filler description. MUI documents its components on the docs site, not in
  // the shipped types, so the index line an agent reads is simply not a fact this
  // adapter can take. Emitting "MUI Button." would satisfy the validator while
  // telling the agent nothing — a passing check that proves nothing is worse than
  // a failing one that names the gap.
  const described = firstSentence(target, source)

  components[name] = {
    ref: name,
    ...described ? { description: described } : {},
    exports: [name],
    main: name,
    from: '@mui/material',
    slots: [],
    props,
    sourcePath: `node_modules/@mui/material/${name}/${name}.d.ts`,
    variants: Object.fromEntries(
      props.filter(p => p.values).map(p => [p.name, { prop: p.name, values: p.values }]),
    ),
    uses: [],
  }
}

// ── Tiers: policy and judgment — authored, merged in from the seed ────────────
//
// Kept in a separate file on purpose. This adapter's job is to transcribe what
// the library declares; the seed's job is to say what a person decided. Mixing
// the two would make it impossible to tell, a year from now, which lines came
// from MUI and which came from us.

const SEED_PATH = join(root, 'seeds', 'mui.judgment.json')
if (!existsSync(SEED_PATH)) {
  console.error(`adapt-mui: judgment seed not found at ${SEED_PATH}`)
  process.exit(1)
}
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'))

// Infrastructure is removed rather than described. A registry that offers
// GlobalStyles as a choice teaches the agent that it is one.
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
  // Provenance, so no one later mistakes an authored sentence for a library fact.
  entry.provenance = { facts: 'shipped .d.ts', description: 'authored', level: 'authored', context: 'authored' }
}

// ── Tier: policy — assignments this system makes, not facts MUI carries ───────

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

write('profile.json', {
  schemaVersion: 1,
  id: OUT_ID,
  library: { name: '@mui/material', kind: 'third-party', source: `@mui/material@${muiVersion}` },
  adapter: 'adapt-mui.mjs',
  tiers: { facts: ['components.json', 'tokens.json'], policy: ['policy.json', 'rules.json'], judgment: ['judgment.json'] },
  counts: {
    components: Object.keys(components).length,
    blocks: 0,
    tokens: JSON.stringify(tokens).split('"$value"').length - 1,
  },
})
write('components.json', { schemaVersion: 1, components, blocks: {} })
write('tokens.json', tokens)
write('policy.json', {
  schemaVersion: 1,
  _: 'Levels and surfaces do not exist in MUI. These are assignments this system makes, authored in seeds/mui.judgment.json.',
  levels,
  surfaces,
  status: {},
  excluded,
})
write('judgment.json', {
  schemaVersion: 1,
  _: 'Authored, not extracted. Source: seeds/mui.judgment.json.',
  vocabulary: seed.vocabulary ?? {},
  twins: seed.twins ?? { pairs: {} },
})
write('rules.json', { schemaVersion: 1, catalogue: '../../rules/catalogue.json', applies: 'all', expressionKey: 'mui' })

// ── Report ────────────────────────────────────────────────────────────────────

const withUnions = Object.values(components).filter(c => Object.keys(c.variants).length > 0).length
const totalProps = Object.values(components).reduce((sum, c) => sum + c.props.length, 0)
const totalValues = Object.values(components).reduce(
  (sum, c) => sum + Object.values(c.variants).reduce((s, v) => s + v.values.length, 0), 0)

console.log(`\nadapt-mui: @mui/material@${muiVersion}`)
console.log('\nFACTS — taken, not guessed')
console.log(`  components         ${Object.keys(components).length} of ${componentDirs.length} folders`)
console.log(`  props              ${totalProps}`)
console.log(`  closed unions      ${totalValues} values across ${withUnions} components`)
console.log(`  tokens             ${JSON.stringify(tokens).split('"$value"').length - 1} from the executed theme`)
if (noProps.length) console.log(`  no own-props type  ${noProps.length} (${noProps.slice(0, 6).join(', ')}${noProps.length > 6 ? ', …' : ''})`)

console.log('\nPOLICY / JUDGMENT — authored in seeds/mui.judgment.json')
console.log(`  excluded           ${Object.keys(excluded).length} infrastructure components, with a reason each`)
console.log(`  levels + surfaces  ${Object.keys(levels).length} assigned`)
console.log(`  descriptions       ${Object.values(components).filter(c => c.description).length} written`)
console.log(`  twins              ${Object.keys(seed.twins?.pairs ?? {}).length} pairs decided`)
console.log(`  vocabulary         ${Object.keys(seed.vocabulary ?? {}).filter(k => k !== '_').length} shared prop names recorded`)
if (uncovered.length) {
  console.error(`\n  NOT COVERED BY THE SEED — ${uncovered.length}: ${uncovered.join(', ')}`)
  console.error('  A component the library ships and nobody has judged. Add it to the seed or exclude it.')
}

console.log(`\nwritten to profiles/${OUT_ID}/`)
