/**
 * Turn a client's own React components into a profile.
 *
 * Every other adapter here reads something published: MUI's types, Ant's types,
 * a CSS framework's stylesheets. A client's component library is published
 * nowhere, and without this the generator can only build against a library the
 * client has not adopted — which it proved by writing `import { Badge } from
 * "@/Badge"` into a repository that has `@/components/ui/badge` and no Badge.
 *
 * Extraction is deliberately confined to what the compiler can prove:
 *
 *   facts     the exported components, their props, which are required, and
 *             which prop types are closed unions
 *
 * and nothing else. Level, surface and status are policy, and which component
 * answers which role is judgment; both are written by a person afterwards, and
 * both are left empty here rather than guessed. A profile that guesses its
 * judgment tier is a profile that recommends the wrong component confidently.
 *
 *   node scripts/adapt-react.mjs <dir> --out <id> [--alias @/components/ui]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { walk, loadTypeScript } from './lib/signals.mjs'
import { propVocabulary, describeVocabulary } from './lib/vocab.mjs'
import { findTwins } from './lib/twins.mjs'
import { scout } from './lib/scout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}
const target = process.argv[2]
const OUT = arg('--out')
const ALIAS = arg('--alias')
// Where to look for real usages and authored examples. Defaults to the package
// above the component directory, because that is where the screens live.
const USAGES = arg('--usages')

if (!target || !existsSync(target) || !OUT) {
  console.error('usage: node scripts/adapt-react.mjs <dir> --out <id> [--alias @/components/ui]')
  process.exit(2)
}

const loaded = loadTypeScript(createRequire, [join(target, 'package.json'), join(root, 'package.json')])
const ts = loaded.ts
if (!ts) { console.error('adapt-react: no usable TypeScript is resolvable.'); process.exit(1) }

const files = walk(target).filter(f => /\.[jt]sx?$/.test(f) && !/\.(test|spec|stories)\./.test(f))
if (!files.length) { console.error(`adapt-react: no source under ${target}`); process.exit(1) }

// How this library is imported. Without an alias the specifier is the path from
// the directory given, which is right for a package and wrong for an app — so it
// is asked for rather than inferred where it matters.
const importFor = (file) => {
  const rel = relative(target, file).replace(/\.[jt]sx?$/, '').split(sep).join('/')
  const clean = rel.replace(/\/index$/, '')
  return ALIAS ? `${ALIAS}/${clean}` : `./${clean}`
}

// ── Extraction ────────────────────────────────────────────────────────────────

const components = {}
const unionsSeen = []
let skipped = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)

  // Type aliases and interfaces in this file, so a props type referenced by name
  // resolves. Reading only inline object types found no props at all in the
  // common case, where every component types its props through a named alias.
  const localTypes = new Map()
  ast.forEachChild(node => {
    if (ts.isTypeAliasDeclaration(node)) localTypes.set(node.name.text, node.type)
    if (ts.isInterfaceDeclaration(node)) localTypes.set(node.name.text, node)
  })

  /** A closed union of string literals, or undefined for anything wider. */
  const closedUnion = (typeNode) => {
    let node = typeNode
    if (node && ts.isTypeReferenceNode(node)) node = localTypes.get(node.typeName.getText?.() ?? '')
    if (!node || !ts.isUnionTypeNode(node)) return undefined
    const values = node.types.map(t => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : undefined)
    return values.every(Boolean) ? values : undefined
  }

  const propsOf = (typeNode) => {
    let node = typeNode
    if (node && ts.isTypeReferenceNode(node)) node = localTypes.get(node.typeName.getText?.() ?? '')
    if (!node) return undefined
    const members = ts.isInterfaceDeclaration(node) ? node.members
      : ts.isTypeLiteralNode(node) ? node.members
      // `Props & ComponentProps<'button'>` — the part this file declares is the
      // part it decides; the rest is inherited and recorded as such.
      : ts.isIntersectionTypeNode(node) ? node.types.flatMap(t => {
        const resolved = ts.isTypeReferenceNode(t) ? localTypes.get(t.typeName.getText?.() ?? '') : t
        return resolved && (ts.isTypeLiteralNode(resolved) || ts.isInterfaceDeclaration(resolved)) ? [...resolved.members] : []
      })
      : undefined
    if (!members) return undefined
    return members.filter(ts.isPropertySignature).map(m => {
      const name = m.name.getText?.() ?? ''
      const union = closedUnion(m.type)
      if (union) unionsSeen.push({ component: name, values: union })
      return {
        name,
        type: m.type?.getText?.() ?? 'unknown',
        required: !m.questionToken,
        ...union ? { values: union } : {},
      }
    }).filter(p => p.name && p.name !== 'children')
  }

  /** Whether a declaration returns JSX, which is what makes it a component. */
  const rendersJsx = (node) => {
    let found = false
    const visit = (n) => {
      if (found) return
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { found = true; return }
      ts.forEachChild(n, visit)
    }
    visit(node)
    return found
  }

  const inheritsDom = /ComponentProps|HTMLAttributes|ComponentPropsWithoutRef|ButtonHTMLAttributes|InputHTMLAttributes/.test(text)

  const record = (name, propsType, node, isDefault, cva = new Map()) => {
    if (!/^[A-Z]/.test(name)) return
    if (!rendersJsx(node)) { skipped += 1; return }
    let props = propsType ? propsOf(propsType) : undefined

    // A cva variant group is a prop with a closed set of values, whether or not
    // the type it produces is written down anywhere. Merged in rather than
    // replacing, because a component usually has both.
    const body = node.getText?.() ?? ''
    // Only the cva groups this component actually reaches for. `cva` is declared
    // once per file and used by one of the exports; giving its variants to all of
    // them invents props.
    const mine = new Map([...cva].filter(([, values]) => !values.owner || body.includes(values.owner)))
    if (mine.size) {
      props = props ?? []
      for (const [prop, values] of mine) {
        const existing = props.find(p => p.name === prop)
        if (existing) existing.values = values
        else props.push({ name: prop, type: values.map(v => `'${v}'`).join(' | '), required: false, values, from: 'cva' })
      }
    }
    for (const p of props ?? []) if (p.values) unionsSeen.push({ component: name, prop: p.name, values: p.values })

    const existing = components[name]
    if (existing) { existing.exports.push(name); return }
    components[name] = {
      ref: name,
      // Policy, not fact. Left null so nobody mistakes a default for a decision.
      level: null,
      surface: null,
      status: null,
      description: null,
      exports: [name],
      main: name,
      from: importFor(file),
      slots: [],
      inherits: inheritsDom,
      props: props ?? [],
      propsUnknown: props === undefined,
      exportedAs: isDefault ? 'default' : 'named',
      source: relative(target, file).split(sep).join('/'),
      // The declaration's own text. A file usually holds several components, and
      // attributing a file's cva groups and rendered children to all of them gave
      // DialogDescription a `size` prop it does not have and a child it does not
      // render. Removed before the profile is written.
      _body: node.getText?.() ?? '',
    }
  }

  // What this file exports, from either form. Reading only the `export` modifier
  // found one component in eighteen shadcn-derived files, because that idiom
  // declares plainly and exports at the bottom: `export { Badge, badgeVariants }`.
  const exportedNames = new Set()
  let hasDefault = false
  ast.forEachChild(node => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) exportedNames.add(el.name.text)
    }
    if (ts.isExportAssignment(node)) hasDefault = true
    if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(node) && node.name) exportedNames.add(node.name.text)
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) exportedNames.add(d.name.text)
      }
      if (node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) hasDefault = true
    }
  })

  // Variants declared through `cva`, which is where a great many projects keep
  // the closed set a prop accepts. Looking only for TypeScript unions found none
  // of them: `variant: "default" | "secondary"` never appears in the source, it
  // is inferred from the keys of the cva config by VariantProps.
  const cvaVariants = new Map()
  ast.forEachChild(node => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      const init = decl.initializer
      if (!init || !ts.isCallExpression(init) || (init.expression.getText?.() ?? '') !== 'cva') continue
      const config = init.arguments[1]
      if (!config || !ts.isObjectLiteralExpression(config)) continue
      const variants = config.properties.find(p => (p.name?.getText?.() ?? '') === 'variants')
      if (!variants || !ts.isPropertyAssignment(variants) || !ts.isObjectLiteralExpression(variants.initializer)) continue
      for (const group of variants.initializer.properties) {
        if (!ts.isPropertyAssignment(group) || !ts.isObjectLiteralExpression(group.initializer)) continue
        // Keyed by prop, carrying the cva variable's name so a component can be
        // asked whether it uses this one.
        cvaVariants.set(group.name.getText().replace(/['"]/g, ''), Object.assign(
          group.initializer.properties.map(p => p.name?.getText?.().replace(/['"]/g, '')).filter(Boolean),
          { owner: decl.name?.getText?.() },
        ))
      }
    }
  })

  ast.forEachChild(node => {
    const isDefault = (node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false) || (hasDefault && exportedNames.size === 0)

    if (ts.isFunctionDeclaration(node) && node.name && exportedNames.has(node.name.text)) {
      record(node.name.text, node.parameters[0]?.type, node, isDefault, cvaVariants)
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!exportedNames.has(decl.name.text)) continue
        const init = decl.initializer
        // `forwardRef<T, Props>(...)` carries its props in a type argument, and
        // reading only the parameter found none for every component written that
        // way — which in a shadcn-derived library is most of them.
        const viaForwardRef = ts.isCallExpression(init) && /forwardRef|memo/.test(init.expression.getText?.() ?? '')
        const propsType = viaForwardRef
          ? init.typeArguments?.[1] ?? init.arguments[0]?.parameters?.[0]?.type
          : (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init.parameters[0]?.type : undefined
        record(decl.name.text, propsType, init, isDefault, cvaVariants)
      }
    }
  })
}

// ── What each component is built from, and what it varies by ─────────────────
//
// Two facts the extraction was leaving on the floor, both of which the
// hand-written registry carries and an agent reads:
//
//   uses      the components this one renders. `Card uses Badge, Button` is the
//             library's own dependency graph, and it answers "what am I really
//             pulling in" before anything is imported.
//   variants  the props with a closed set of values, gathered per component.
//             The values are already extracted; what was missing is the shape
//             that makes them answerable as a question — which knobs does this
//             component have, and what may each be set to.
//
// `surface` and `level` are still null and still should be. Those are policy: a
// person decides that Card is a region, and deriving it from a name is how a
// registry ends up confidently wrong about the thing agents read first.
{
  const registry = new Set(Object.keys(components))
  for (const [name, entry] of Object.entries(components)) {
    const at = files.find(f => relative(target, f).split(sep).join('/') === entry.source)
    if (at) {
      const text = readFileSync(at, 'utf8')
      const imported = new Set()
      for (const m of text.matchAll(/import\s+([^;'"]+?)\s+from\s*['"][^'"]+['"]/g)) {
        const clause = m[1].replace(/\btype\s+/g, '')
        const named = (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',')
        const byDefault = clause.replace(/\{[^}]*\}/, '').split(',')[0]
        for (const raw of [...named, byDefault]) {
          const clean = raw.trim().split(/\s+as\s+/).pop()?.trim()
          if (clean && /^[A-Z]\w*$/.test(clean)) imported.add(clean)
        }
      }
      // Rendered, and part of this library — whether it was imported or declared
      // in the same file. Looking only at imports found nothing at all, because a
      // compound component's parts live beside it: `DialogContent` renders
      // `DialogOverlay` from the file it is written in.
      //
      // Third-party primitives are somebody else's business and are not counted.
      const rendered = new Set([...(entry._body || text).matchAll(/<([A-Z]\w*)/g)].map(m => m[1]))
      entry.uses = [...rendered]
        .filter(n => n !== name && registry.has(n))
        .sort()
      // Everything this component renders, registry or not. Prop-name overlap on
      // its own is noise — two components with three props each agree by accident
      // — so a second, independent signal is needed before two components can be
      // called alike, and what a component puts on the page is that signal.
      // A generic is not a tag. `React.ComponentProps<"span">` and
      // `<typeof buttonVariants>` both matched a bare `<Name` scan, so Badge came
      // back rendering `typeof` and Button rendering `HTMLElement`.
      //
      // The angle bracket of a generic follows an identifier; the angle bracket of
      // a tag does not.
      const TYPE_WORDS = new Set(['typeof', 'keyof', 'infer', 'const', 'extends', 'readonly'])
      entry.renders = [...new Set(
        [...(entry._body || text).matchAll(/(?<![\w>])<([a-zA-Z][\w.-]*)[\s/>]/g)].map(m => m[1]),
      )].filter(n => n !== name && !TYPE_WORDS.has(n) && !/^(HTML|SVG)\w*Element$/.test(n)).sort()
    }

    const variants = {}
    for (const p of entry.props ?? []) {
      if (p.values) variants[p.name] = { prop: p.name, values: p.values }
      else if (p.type === 'boolean') variants[p.name] = { prop: p.name, values: ['true'] }
    }
    if (Object.keys(variants).length) entry.variants = variants

    // The registry this was modelled on calls it sourcePath. One name for one
    // thing, so a reader of either profile does not have to know which produced it.
    entry.sourcePath = entry.source
    delete entry.source
    delete entry._body
  }
}

// ── Golden examples, taken from the repository's own best call site ───────────
//
// A registry without an example is a list of names. The design system this tool
// was built from carries a hand-written example per component, maintained by a
// test that breaks when a prop is renamed, and nothing extracted can match that.
//
// But a client's repository already contains every component used for real, and
// the best of those usages is a better model than nothing and a far better one
// than an invented snippet. Same principle as the exemplars pass: the best
// existing instance is the model, not the most common one.
//
// "Best" is the usage demonstrating the most of the API — the most distinct props
// — from a file that is not a test, preferring the shortest such call so that an
// example reads like one.

/** From `<Name` to its matching close, tracking braces, quotes and nesting. */
function sliceElement(text, start) {
  let i = start
  let depth = 0
  let quote
  let tagDepth = 0
  while (i < text.length) {
    const c = text[i]
    if (quote) { if (c === quote) quote = undefined; i += 1; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; i += 1; continue }
    if (c === '{') { depth += 1; i += 1; continue }
    if (c === '}') { depth -= 1; i += 1; continue }
    if (depth > 0) { i += 1; continue }
    if (c === '/' && text[i + 1] === '>') { tagDepth -= 1; i += 2; if (tagDepth <= 0) return text.slice(start, i) }
    else if (c === '<') { if (text[i + 1] === '/') tagDepth -= 1; else tagDepth += 1; i += 1 }
    else if (c === '>') { i += 1; if (tagDepth <= 0) return text.slice(start, i) }
    else i += 1
  }
  return undefined
}

// A mature project has already written its examples, and an authored one beats
// anything extracted: somebody chose it, and in a Storybook story a test renders
// it. So the authored sources are searched first and the extraction is the
// fallback, with the registry recording which of the two it got.
const AUTHORED = /\.stories\.[jt]sx?$|\.mdx$|(^|\/)(examples?|demos?|docs)\//
const usageRoot = USAGES ?? (existsSync(join(target, '..', '..', 'src')) ? join(target, '..', '..') : join(target, '..'))
const callSites = (() => {
  let pool = []
  try {
    pool = walk(usageRoot).filter(f => /\.[jt]sx$/.test(f) && !/\.(test|spec|stories)\./.test(f))
  } catch { return new Map() }

  const best = new Map()
  const componentNames = Object.keys(components)
  for (const file of pool) {
    const text = readFileSync(file, 'utf8')
    for (const component of componentNames) {
      const opening = new RegExp('<' + component + '(?=[\\s/>])', 'g')
      for (const m of text.matchAll(opening)) {
        const snippet = sliceElement(text, m.index)
        if (!snippet || snippet.length > 600) continue
        const props = new Set([...snippet.matchAll(/(?:^|\s)([a-zA-Z][\w:-]*)=/g)].map(x => x[1]))
        const score = props.size * 100 - snippet.length / 10
        const at = relative(usageRoot, file).split(sep).join('/')
        const authored = AUTHORED.test(at)
        // An authored example outranks any extracted one regardless of how many
        // props the extracted call happens to show.
        const rank = (authored ? 1e6 : 0) + score
        const current = best.get(component)
        if (!current || rank > current.rank) {
          best.set(component, { rank, score, snippet, props: props.size, at, authored })
        }
      }
    }
  }
  return best
})()

for (const [component, use] of callSites) {
  components[component].example = use.snippet
  // Where it came from, because an extracted example is a different thing from an
  // authored one: nothing maintains it, and it records how this repository uses
  // the component today rather than how it ought to be used.
  components[component].exampleFrom = use.at
  components[component].exampleIs = use.authored
    ? 'authored: taken from a story or a documented example, which somebody chose and something renders'
    : 'extracted from the best real usage in this repository; nothing maintains it, and it records how the component is used today rather than how it should be'
}

// ── Authored examples from Component Story Format ─────────────────────────────
//
// A Storybook story is the authored example, and Storybook keeps its own index of
// them — which makes a project with stories a project that has already done the
// judgment tier for its own library.
//
// But a modern story usually contains no JSX at all:
//
//   const meta = { component: Input }
//   export const WithValue: Story = { args: { defaultValue: 'Sample', ... } }
//
// so scanning for `<Input` finds nothing in the one file most worth reading. The
// meta names the component and the args are the props; put back together they are
// the example somebody wrote.
const storyExamples = (() => {
  const found = new Map()
  let pool = []
  try {
    pool = walk(usageRoot, [], new Set(['.tsx', '.jsx', '.ts', '.js']))
      .filter(f => /\.stories\.[jt]sx?$/.test(f))
  } catch { return found }

  for (const file of pool) {
    const text = readFileSync(file, 'utf8')
    const component = /\bcomponent\s*:\s*([A-Z]\w*)/.exec(text)?.[1]
    if (!component || !components[component]) continue

    // Every named export carrying args, preferring the one that sets the most —
    // the same rule as for extracted usages, and for the same reason.
    let best
    for (const m of text.matchAll(/export const (\w+)[^=]*=\s*\{([\s\S]*?)\n\}/g)) {
      const argsBlock = /\bargs\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(m[2])?.[1]
      if (!argsBlock) continue
      const args = [...argsBlock.matchAll(/^\s*["']?([A-Za-z_$][\w$]*)["']?\s*:\s*(.+?),?\s*$/gm)]
        .map(a => [a[1], a[2].trim().replace(/,$/, '')])
        .filter(([, v]) => v && !v.startsWith('{') && !v.startsWith('('))
      if (!args.length || (best && args.length <= best.args.length)) continue
      best = { story: m[1], args }
    }
    if (!best) continue

    // `children` is content, not an attribute. Rendering `children="Save"` gives an
    // agent something to copy that nobody would write.
    const children = best.args.find(([k]) => k === 'children')
    const attrs = best.args.filter(([k]) => k !== 'children')
      .map(([k, v]) => /^["'].*["']$/.test(v) ? ` ${k}=${v}` : ` ${k}={${v}}`).join('')
    const inner = children && /^["'].*["']$/.test(children[1]) ? children[1].slice(1, -1) : undefined
    found.set(component, {
      snippet: inner
        ? `<${component}${attrs}>${inner}</${component}>`
        : `<${component}${attrs} />`,
      at: relative(usageRoot, file).split(sep).join('/'),
      story: best.story,
    })
  }
  return found
})()

for (const [component, use] of storyExamples) {
  // A story outranks anything found by scanning call sites, including a call site
  // that happens to sit inside a stories file.
  components[component].example = use.snippet
  components[component].exampleFrom = `${use.at} — the "${use.story}" story`
  components[component].exampleIs = 'authored: a Storybook story, which somebody wrote and Storybook renders'
}

const names = Object.keys(components).sort()
if (!names.length) {
  console.error('adapt-react: no exported component renders JSX under this directory.')
  console.error('If the components are exported from an index barrel, point this at the source folder instead.')
  process.exit(1)
}

// ── Write ─────────────────────────────────────────────────────────────────────

const outDir = join(root, 'profiles', OUT)
mkdirSync(outDir, { recursive: true })

writeFileSync(join(outDir, 'components.json'), JSON.stringify({
  schemaVersion: 1,
  _: `Extracted from ${target} by adapt-react. Facts only: exports, props, required flags and closed unions. Level, surface, status and description are policy and judgment — they are null until a person writes them, because a guessed judgment tier recommends the wrong component confidently.`,
  components: Object.fromEntries(names.map(n => [n, components[n]])),
  blocks: {},
}, null, 2) + '\n')

// The rest of the profile's files, written as valid empty documents rather than
// left absent. A missing file makes `validate-profile` report the profile as
// broken; an empty one makes it report exactly what is unwritten, which is the
// difference between "this does not work" and "this is finished up to the tier a
// person owns".
const stub = (name, content) => {
  const at = join(outDir, name)
  if (!existsSync(at)) writeFileSync(at, JSON.stringify(content, null, 2) + '\n')
}
stub('profile.json', {
  schemaVersion: 1,
  id: OUT,
  library: { name: OUT, kind: 'first-party' },
  adapter: 'adapt-react',
  tiers: {
    facts: 'extracted from source; complete',
    policy: 'UNWRITTEN — level, surface and status, one afternoon for the whole library',
    judgment: 'UNWRITTEN — descriptions and role bindings, the tier no library ships',
  },
  counts: { components: names.length },
  bindings: `bindings/${OUT}.json`,
})
stub('policy.json', {
  _: 'Level and surface per component. Assigned once for the library and then reusable across every client on this stack. Empty until someone assigns them.',
  schemaVersion: 1, levels: {}, surfaces: {},
})
stub('judgment.json', {
  _: 'Which of two confusable components to reach for, and why. Authored; no library publishes this.',
  schemaVersion: 1, twins: { pairs: {} },
})
stub('tokens.json', { _: `No tokens extracted from ${OUT}; run adapt-css against its stylesheets if it has any.`, schemaVersion: 1, tokens: {} })
stub('rules.json', {
  _: 'How the shared rule catalogue is expressed for this library. Until expressionKey names a set of expressions, every translatable rule is a disabled rule.',
  schemaVersion: 1, catalogue: '../../rules/catalogue.json', expressionKey: null,
})

// A binding is a claim about which component answers which role, and nobody can
// extract that. The file is created empty and valid so `validate-profile` says
// what is missing rather than failing to load.
const bindingPath = join(root, 'bindings', `${OUT}.json`)
if (!existsSync(bindingPath)) {
  writeFileSync(bindingPath, JSON.stringify({
    _: `Role bindings for ${OUT}. EMPTY AND DELIBERATELY SO: a binding claims that a component is the right answer for a role, which is judgment. Fill these in before building screens against this profile; \`ds spec\` will name every role it cannot resolve.`,
    schemaVersion: 1,
    profile: OUT,
    axes: {},
    roles: {},
  }, null, 2) + '\n')
}

// ── Report ────────────────────────────────────────────────────────────────────

const withProps = names.filter(n => components[n].props.length > 0)
const withUnions = names.filter(n => components[n].props.some(p => p.values))
const unknown = names.filter(n => components[n].propsUnknown)

console.log(`\nadapt-react: ${target}`)
console.log(`${files.length} file(s) read with typescript ${ts.version}\n`)
console.log(`  ${String(names.length).padStart(4)}  components extracted`)
console.log(`  ${String(withProps.length).padStart(4)}  with props readable from a type in the same file`)
console.log(`  ${String(withUnions.length).padStart(4)}  with at least one closed union, which the gate can check values against`)
console.log(`  ${String(unknown.length).padStart(4)}  whose props are typed somewhere this pass cannot follow`)
console.log(`  ${String(skipped).padStart(4)}  exports skipped for rendering no JSX`)
console.log(`  ${String(names.filter(n => components[n].uses?.length).length).padStart(4)}  built from other components in this library`)
console.log(`  ${String(names.filter(n => components[n].variants).length).padStart(4)}  with variants — the knobs, and what each may be set to`)
console.log(`  ${String([...callSites.values()].filter(u => u.authored).length + storyExamples.size).padStart(4)}  with an AUTHORED example — a Storybook story or a documented demo`)
console.log(`  ${String([...callSites.values()].filter(u => !u.authored && !storyExamples.has(u.component)).length).padStart(4)}  with an example extracted from the best real usage here`)

// A shared prop name is a promise, and nothing in a client's library keeps it.
// An agent that learns `variant` from Button and writes `variant="destructive"`
// on Tabs gets a type error, having learned the wrong thing from the system that
// told it so.
const declaredVocab = (() => {
  for (const at of [join(target, 'prop-vocabulary.json'), join(root, 'profiles', OUT, 'prop-vocabulary.json')]) {
    try { return JSON.parse(readFileSync(at, 'utf8')) } catch { /* next */ }
  }
  return undefined
})()
const vocab = propVocabulary(components, declaredVocab)
if (vocab.length) {
  console.log('\nONE PROP NAME, MORE THAN ONE MEANING')
  for (const v of vocab.slice(0, 6)) console.log(`  · ${describeVocabulary(v)}`)
  console.log(declaredVocab
    ? '\n  Checked against this project\'s own prop-vocabulary.json.'
    : '\n  No prop-vocabulary.json here, so these are compared as written. A prop taking'
      + '\n  different values on two components may still be one axis nobody wrote down —'
      + '\n  declaring it is what turns that from a guess into a rule.')
}

// The contract everywhere says: search the registry before building. Nothing
// holds the LIBRARY to it, so the seventy-fourth component can repeat the
// thirtieth and every check stays green.
const declaredTwins = (() => {
  try { return JSON.parse(readFileSync(join(root, 'profiles', OUT, 'judgment.json'), 'utf8')).twins } catch { return undefined }
})()
const twins = findTwins(components, { declared: declaredTwins })
console.log(`\nCOMPONENTS THAT RESEMBLE EACH OTHER — ${twins.considered} of ${names.length} could be compared`)
if (twins.unanswered.length) {
  for (const t of twins.unanswered.slice(0, 6)) {
    console.log(`  ? ${t.pair.padEnd(36)} props ${t.byProps} · renders ${t.byRenders}`)
  }
  console.log('  A question, not a verdict. Answering it means writing down how the two differ')
  console.log('  and what would make that answer expire, so the next person can check it.')
} else if (twins.considered) {
  console.log('  none above both thresholds')
}
if (twins.stale.length) console.log(`  ⚠ answered, but no longer alike: ${twins.stale.join(', ')} — an excuse nobody needs would waive a real duplicate later`)
if (twins.why) console.log(`\n  ${twins.why}`)

// What the applications around this library did instead of using it. The failure
// is quiet: somebody needs a pill, builds it in their app because that is the
// shortest path, and the next app builds it again.
if (USAGES) {
  const appFiles = walk(usageRoot).filter(f => /\.[jt]sx$/.test(f))
  const prefix = relative(usageRoot, target).split(sep).join('/')
  const found = scout({
    target: usageRoot, files: appFiles,
    read: (a) => { try { return readFileSync(a, 'utf8') } catch { return '' } },
    components, libraryPrefix: prefix,
  })
  console.log(`\nTHE LIBRARY AND WHAT SURROUNDS IT — ${found.consumed} of ${found.registrySize} imported by the code around it`)
  for (const p of found.parallel.slice(0, 5)) {
    console.log(`  ? ${p.name.padEnd(22)} built in ${p.places.length} places, none importing the library`)
  }
  for (const s of found.shadowing.slice(0, 5)) {
    console.log(`  ! ${s.name.padEnd(22)} the library has this name too — ${s.places[0]}`)
  }
  if (found.unconsumed.length) {
    console.log(`  · ${found.unconsumed.length} component(s) nothing imports: ${found.unconsumed.slice(0, 6).join(', ')}${found.unconsumed.length > 6 ? '…' : ''}`)
    console.log('    Reported, never failed: a library may ship ahead of demand. It is only a')
    console.log('    problem where applications hand-roll the same thing beside it.')
  }
  if (!found.parallel.length && !found.shadowing.length) {
    console.log('  nothing is being built in parallel with this library')
  }
}

console.log('\nWHAT WAS NOT EXTRACTED, BECAUSE IT CANNOT BE')
console.log('  level, surface, status   policy — one afternoon per library, then reusable')
console.log('  description              the line that decides which component gets picked')
// padEnd(27) on a name longer than 27 runs the two columns together:
// `bindings/e2e-memos-r.jsonjudgment — which component answers which role`.
console.log(`  bindings/${OUT}.json`.padEnd(27) + ' judgment — which component answers which role')
console.log(''.padEnd(27) + ` proposed by: ds bind ${OUT} --repo <path>`)
console.log('\nMeasured across three published libraries, this is the tier no library ships:')
console.log('MUI provides one usable description in the types of 127 components, Ant none in 64.')

console.log(`\nwritten to profiles/${OUT}/components.json`)
console.log(`Check it:  node scripts/ds.mjs profile ${OUT}`)
