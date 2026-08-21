/**
 * Deep analysis: how this project designs components, composes screens, arranges
 * its modules, tests, and types.
 *
 * The conventions scan measures form — where files sit, what they are called,
 * how they are styled. That is the surface. This measures design decisions, which
 * is what someone actually has to match when they write the next component here.
 *
 * Parsed with the TARGET PROJECT'S own TypeScript, resolved from its
 * node_modules, so the analysis agrees with the compiler the team actually runs.
 *
 * Five groups, each answering a question a new contributor has to answer anyway:
 *
 *   component API   how do components here take their configuration?
 *   composition     what does a screen here look like, and what does it handle?
 *   architecture    what may import what, and does anything import in a circle?
 *   testing         what is asserted, and through which queries?
 *   types           how much of the type system is being opted out of?
 *
 *   node scripts/deep.mjs <repo> [--exclude ds,brand]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { walk, detectFramework, scanSlot, loadTypeScript, installedHere } from './lib/signals.mjs'
import { READERS, SFC_LIMITS, readAngular } from './lib/sfc.mjs'
import { shellOf, shellOfMarkup, signatureOf, regionsDeclaredBy, shapeless } from './lib/archetypes.mjs'
import { behaviourGaps } from './lib/behaviour.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const excludeArg = process.argv.indexOf('--exclude')
const EXCLUDED = excludeArg === -1
  ? []
  : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/deep.mjs <repo> [--exclude ds,brand]')
  process.exit(2)
}

// The project's own compiler, so a disagreement with the team's build is not
// introduced by this tool's choice of parser.
const loaded = loadTypeScript(createRequire, [
  join(target, 'package.json'),
  join(target, '..', '..', 'package.json'),
  join(root, 'package.json'),
])
const ts = loaded.ts
if (!ts) {
  console.error('deep: no usable TypeScript resolvable from the target or from here.')
  for (const r of loaded.rejected) console.error(`  ${r.version ?? 'unknown'} at ${r.base}: ${r.why}`)
  process.exit(1)
}
for (const r of loaded.rejected) {
  console.log(`note: this project's own typescript ${r.version} was not used — ${r.why}.`)
  console.log('      parsed with this tool\'s compiler instead, which may disagree with their build.')
}

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
// What this tool installed is not the project's code. After an install the
// repository holds a gate, a loop and an eval set whose breaks are deliberately
// wrong — and the next scan counted those as the client's defects.
const ours = installedHere(target)
const included = (abs) => !ours(abs) && !excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep))
const files = walk(target).filter(abs => /\.[jt]sx?$/.test(abs) && included(abs))

// Established before anything is measured, because most of what follows reads
// JSX and has nothing to say about a repository that has none.
const framework = detectFramework(
  walk(target, [], new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte', '.vue'])).filter(included),
  (() => { try { const p = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')); return { ...p.dependencies, ...p.devDependencies } } catch { return {} } })(),
)
const rel = (abs) => relative(target, abs).split(sep).join('/')
const read = (abs) => { try { return readFileSync(abs, 'utf8') } catch { return '' } }

const parse = (abs, text) => ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)

const sources = files.map(abs => {
  const text = read(abs)
  return { abs, at: rel(abs), text, ast: parse(abs, text) }
})

const allCssFiles = walk(target).filter(f => /\.(css|scss)$/.test(f)
  && !excludedPrefixes.some(p => f.startsWith(p + sep)))
const allCssText = allCssFiles.map(f => read(f)).join('\n')

const isTest = (s) => /\.(test|spec)\.[jt]sx?$/.test(s.at)

// A directory of test fixtures is not a set of screens.
//
// `isTest` catches a file NAMED `.test.` or `.spec.`, which is how JSX projects mark
// them — and a framework's own fixtures are not named that way at all. SvelteKit keeps
// 779 `+page.svelte` files under `packages/kit/test/`, every one of them a route by
// the filesystem rule, and the survey reported 885 screens for a package that ships
// none. The count then carried into system share, states handled and everything else
// derived from screens.
const IN_TEST_TREE = /(^|\/)(test|tests|__tests__|fixtures|__fixtures__|e2e|spec)\//


// A screen is not always called Page. File-based routers — React Router v7,
// Remix, the Next app router — name screens by their URL, so a detector keyed on
// the suffix finds none of them. Reporting "0% of screens handle their empty
// state" when the truth is "no screens were found" is the worst kind of zero.
//
// But a list of folder names is a guess about someone else's habits wearing the
// clothes of a measurement. Outline keeps its screens in `scenes/`, which no such
// list contains, so five were found in a repository holding several dozen.
//
// The evidence is the router. Whatever a project points a route at is a screen by
// that project's own definition, whether it sits in `scenes`, `views` or nowhere
// in particular — so routes are resolved first, and the naming conventions are
// left as a fallback for projects whose routing this pass cannot read.

/** Modules a router points at, resolved from route declarations to real files. */
const routedModules = (() => {
  // Only files that declare routes get read this way. A first version took any
  // dynamic `import()` anywhere as a route target, which is how `Modal.tsx` and
  // `Table.tsx` were classified as screens — code splitting is used for a great
  // deal that is not a route.
  // Vue Router declares the same thing in its own words, and none of the markers
  // above appear in it: a module is `const routes: RouteRecordRaw[] = [...]`, so
  // `routes:` is followed by a type rather than a bracket. On vue-vben-admin every
  // one of 27 screens fell through to the filename guess, and the report said so —
  // `found by: file name 27 (a guess, not a route)` — which is how this was found.
  const DECLARES_ROUTES = /<Route\b|createBrowserRouter|createRoutesFromElements|RouteObject|RouteRecordRaw|createRouter\s*\(|\brouter\s*=\s*create|\bRoutes\s*=|provideRouter\s*\(|\broutes\s*(?::|=)[^=\n]{0,40}\[/
  const specifiers = new Set()
  for (const s of sources) {
    if (!DECLARES_ROUTES.test(s.text)) continue

    // `element={<Thing />}` and `component={Thing}` name a binding; `lazy` and a
    // bare `Component:` name a module directly. Both end at an import in this
    // file, which is what turns a name into a path.
    const named = new Set()
    for (const m of s.text.matchAll(/(?:element=\{\s*<|component=\{|Component:\s*)([A-Z]\w*)/g)) named.add(m[1])
    // Angular writes `component: HomeComponent` — a bare identifier after a lower-case
    // key, which the pattern above does not reach because it anchors on `Component:`
    // with a capital C.
    for (const m of s.text.matchAll(/\bcomponent\s*:\s*([A-Z]\w*)/g)) named.add(m[1])
    for (const m of s.text.matchAll(/\blazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]/g)) {
      specifiers.add({ from: s.at, spec: m[1] })
    }
    // `component: () => import('#/views/…/index.vue')` — Vue Router's form, and the
    // one React never writes. Anchored on the `component` key rather than on any
    // dynamic import, because a bare `import()` anywhere is code splitting and taking
    // those as routes is what classified `Modal.tsx` as a screen.
    for (const m of s.text.matchAll(/\b(?:component|loadComponent|loadChildren)\s*:\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]/g)) {
      specifiers.add({ from: s.at, spec: m[1] })
    }
    if (!named.size) continue
    for (const m of s.text.matchAll(/import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
      const clause = m[1].replace(/\btype\s+/g, '')
      const bindings = [...(/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(','), clause.replace(/\{[^}]*\}/, '').split(',')[0]]
        .map(b => b.trim().split(/\s+as\s+/).pop()?.trim())
      if (bindings.some(b => b && named.has(b))) specifiers.add({ from: s.at, spec: m[2] })
    }
  }

  // Every file a route could point at, not only the JSX ones. `sources` holds
  // `.tsx`/`.jsx` alone, so a Vue route naming `#/views/dashboard/index.vue`
  // resolved against a map that could not contain it — and every screen in a Vue
  // project fell through to the filename guess with nothing saying why.
  // Computed here rather than reusing `sfcFiles`, which is established two hundred
  // lines below this and cannot be reached from it.
  const singleFile = framework.jsx ? [] : walk(target, [], new Set(['.vue', '.svelte'])).filter(included)
  const byPath = new Map([
    ...sources.map(s => [s.at, s]),
    ...singleFile.map(abs => [rel(abs), { at: rel(abs) }]),
  ])
  const resolved = new Set()
  for (const { from, spec } of specifiers) {
    // `#/` is the alias Vue projects reach for, because `@` is taken by the scope in
    // a pnpm workspace. Without it every route in vue-vben-admin resolved to nothing.
    if (!spec.startsWith('.') && !spec.startsWith('~') && !spec.startsWith('@/') && !spec.startsWith('#/')) continue
    const base = spec.startsWith('.')
      ? join(dirname(from), spec).split(sep).join('/')
      : spec.replace(/^[~@#]\//, '')
    // `.ts` belongs here for Angular, whose components are plain TypeScript, and for
    // any route module a `loadChildren` points at. Without it every Angular route
    // resolved to nothing and the screens that were found came from a folder called
    // `pages` — a guess standing in for a route table that was right there.
    for (const candidate of ['', '.tsx', '.jsx', '.ts', '.vue', '.svelte', '/index.tsx', '/index.jsx', '/index.ts', '/index.vue', '/index.svelte']) {
      const at = base + candidate
      if (byPath.has(at)) { resolved.add(at); break }
      // The scan may be rooted below the import alias, so a suffix match is the
      // only handle available without reading every tsconfig in the tree.
      const tail = [...byPath.keys()].find(k => k.endsWith('/' + at))
      if (tail) { resolved.add(tail); break }
    }
  }
  return resolved
})()

const ROUTE_DIR = /(^|\/)(routes|pages|app)\//
// A folder called `components` is the project stating what the file is, so the
// naming fallbacks defer to it — `InputSearchPage.tsx` is an input and
// `ComponentView.tsx` is a view of a component, and neither is a screen. A route
// declaration still overrides this, because a routed module is a screen whatever
// folder it sits in.
const IS_COMPONENT_DIR = /(^|\/)(components?|lib|utils?|hooks?)\//
// A file-system router has an exact rule, and being INSIDE its directory is not that
// rule. `ROUTE_DIR.test()` matched `app/` anywhere, so in a Next app-router project
// every component under `app/` counted as a screen: plane measured 175 screens over
// 58 routes, and every number derived from that set was diluted by two thirds.
//
// The two routers name their routes differently and both are in wide use:
//
//   app/**/page.tsx      the route. `layout`, `loading`, `error` and everything else
//                        in the same folder are not screens.
//   pages/**/*.tsx       every file IS a route, which is why the older router needs
//   routes/**/*.tsx      the looser rule that the newer one must not have.
const APP_ROUTER_FILE = /(^|\/)(page|route)\.[jt]sx$/
// `app/` means two different things. Next's app router puts one `page.tsx` per
// route in it; Remix and React Router in framework mode put `app/routes/` in it and
// name the files after the URL. Testing for `app/` alone sent every Remix file
// down the Next branch, where the `page.tsx` rule rejected all of them — documenso
// has a full route tree under `app/routes/` and this pass found zero screens in it.
//
// A `routes/` segment settles it wherever it appears, because no Next app router
// uses one.
const inFlatRouter = (at) => /(^|\/)(pages|routes)\//.test(at)
const inAppRouter = (at) => /(^|\/)app\//.test(at) && !inFlatRouter(at)
const NOT_A_ROUTE = /(^|\/)(_app|_document|_error|api)[./]/

const isScreen = (s) => !isTest(s) && !IN_TEST_TREE.test(s.at) && /\.[jt]sx$/.test(s.at) && (
  routedModules.has(s.at)
  || (!IS_COMPONENT_DIR.test(s.at) && !NOT_A_ROUTE.test(s.at) && (
    /(Page|Screen|View)\.[jt]sx$/.test(s.at)
    || (inAppRouter(s.at) ? APP_ROUTER_FILE.test(s.at) : inFlatRouter(s.at))
  ))
)
const isComponentFile = (s) => /\.[jt]sx$/.test(s.at) && !isTest(s) && !isScreen(s)

// Which of the two answers each screen rests on.
//
// "The router points at this file" is a fact about the project. "The file is called
// Page.tsx, or sits in a folder called pages" is a guess about someone else's
// habits, and it is the guess that found five screens in a repository holding
// several dozen — outline keeps its screens in `scenes/`. Both are used, because
// the fact alone misses every route table built from data, but which one carried a
// given screen has to survive into the report: a composition measured mostly by
// naming is a composition measured mostly by assumption.
// Three answers, not two. The first version had only "the router points at it" and
// "it is named like a screen", which put Next and Remix projects entirely in the
// second and made them look like they rested on a guess. A filesystem router is the
// framework's own declaration — `app/page.tsx` IS the route — and it is as much a
// fact as a route table. What is left in `naming` is the only real guess: a file
// called `SomethingPage.tsx` sitting outside any router at all.
const screenEvidence = (s) => routedModules.has(s.at) ? 'route'
  : (inAppRouter(s.at) ? APP_ROUTER_FILE.test(s.at) : inFlatRouter(s.at)) ? 'router'
  : 'naming'

const pct = (n, total) => total === 0 ? 0 : Number((n / total).toFixed(3))
const majority = (values) => {
  if (values.length === 0) return undefined
  const counts = {}
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return { dominant: entries[0][0], share: Number((entries[0][1] / values.length).toFixed(3)), distribution: Object.fromEntries(entries) }
}

// ── 1. Component API design ───────────────────────────────────────────────────

const components = []
for (const s of sources.filter(isComponentFile)) {
  const propTypes = []
  s.ast.forEachChild(node => {
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && /Props$/.test(node.name.text)) {
      propTypes.push(node)
    }
  })

  const members = propTypes.flatMap(node => {
    if (ts.isInterfaceDeclaration(node)) return node.members
    if (ts.isTypeLiteralNode(node.type)) return node.type.members
    return []
  }).filter(m => ts.isPropertySignature(m) && m.name)

  // A union is just as much a union when it is declared one line above and
  // referenced by name. Counting only inline unions reported a design system
  // whose every component has a variant prop as configured by boolean flags.
  const localAliases = new Map()
  s.ast.forEachChild(node => {
    if (ts.isTypeAliasDeclaration(node)) localAliases.set(node.name.text, node.type)
  })
  const isStringUnion = (typeNode, seen = new Set()) => {
    if (!typeNode) return false
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types.some(t => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
    }
    if (ts.isTypeReferenceNode(typeNode)) {
      const ref = typeNode.typeName.getText()
      if (localAliases.has(ref) && !seen.has(ref)) return isStringUnion(localAliases.get(ref), new Set([...seen, ref]))
    }
    return false
  }

  const booleans = members.filter(m => m.type?.kind === ts.SyntaxKind.BooleanKeyword)
  const unions = members.filter(m => isStringUnion(m.type))
  const handlers = members.filter(m => /^on[A-Z]/.test(m.name.getText()))
  const names = new Set(members.map(m => m.name.getText()))

  const exportedComponents = []
  s.ast.forEachChild(node => {
    const exported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) return
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) exportedComponents.push(node.name.text)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.name.getText && /^[A-Z]/.test(decl.name.getText())) exportedComponents.push(decl.name.getText())
      }
    }
  })
  if (exportedComponents.length === 0) continue

  components.push({
    file: s.at,
    exports: exportedComponents,
    props: members.length,
    booleanProps: booleans.length,
    unionProps: unions.length,
    handlerProps: handlers.length,
    // A component configured only by boolean flags cannot express "one of these",
    // so the flags become mutually exclusive by convention and nothing enforces it.
    variantStrategy: unions.length > 0 ? 'union' : booleans.length >= 3 ? 'boolean flags' : booleans.length > 0 ? 'few booleans' : 'none',
    forwardsRef: /forwardRef|\bref\s*[?:]/.test(s.text),
    spreadsRest: /\{\s*\.\.\.(rest|props|others)\s*\}/.test(s.text),
    takesChildren: names.has('children'),
    controlled: names.has('value') && [...names].some(n => /^onChange|^onValueChange/.test(n)),
    compound: exportedComponents.length > 1,
  })
}

// Vue and Svelte, read once. Everything the composition and component-API passes
// measure is a fact about markup and a props declaration, and reading only JSX
// reported all of it as NOT APPLICABLE — honest, and still half the value missing
// on any project not written in React.
// Angular joins them, and needs its own selection: a component here has no
// extension of its own — it is a `.ts` file with a decorator on the class — so the
// extension lookup that finds `.vue` and `.svelte` finds none of them. A repository
// of four hundred components read as "no component file was found".
const sfcFiles = framework.jsx ? []
  : framework.name === 'angular' ? files.filter(f => /\.component\.ts$/.test(f))
  : walk(target, [], new Set(['.vue', '.svelte'])).filter(included)

// The template usually sits in a file beside the class, so the reader is handed the
// path and a way to read: a component that names its template cannot be read from
// its own text, and returning "no markup" for the majority form would report a whole
// codebase as rendering nothing.
const io = { exists: existsSync, read: (p) => readFileSync(p, 'utf8') }
const sfcRead = sfcFiles.map(abs => {
  const reader = framework.name === 'angular' ? readAngular : READERS[abs.slice(abs.lastIndexOf('.'))]
  if (!reader) return undefined
  try { return { abs, ...reader(readFileSync(abs, 'utf8'), abs, io) } } catch { return undefined }
}).filter(Boolean)

for (const r of sfcRead) {
  if (!r.props.length && r.propsUnknown) continue
  components.push({
    file: rel(r.abs),
    props: r.props.length,
    booleanProps: r.props.filter(p => /boolean/i.test(p.type)).length,
    forwardsRef: false,
    spreadsRest: false,
    compound: false,
    controlled: false,
    // 'none', not absent. An absent value passed the `!== 'none'` filter and won
    // the majority vote, so the report read "variant strategy: undefined (100%)".
    // These readers do not extract variants, and saying none is the honest form
    // of that.
    variantStrategy: 'none',
  })
}

const withProps = components.filter(c => c.props > 0)
const componentApi = {
  analysed: components.length,
  medianProps: withProps.length ? withProps.map(c => c.props).sort((a, b) => a - b)[Math.floor(withProps.length / 2)] : 0,
  variantStrategy: majority(components.filter(c => c.variantStrategy !== 'none').map(c => c.variantStrategy)),
  booleanExplosion: components.filter(c => c.booleanProps >= 4).map(c => ({ file: c.file, booleans: c.booleanProps })),
  godComponents: components.filter(c => c.props >= 15).map(c => ({ file: c.file, props: c.props })),
  forwardsRef: pct(components.filter(c => c.forwardsRef).length, components.length),
  spreadsRest: pct(components.filter(c => c.spreadsRest).length, components.length),
  compound: pct(components.filter(c => c.compound).length, components.length),
  controlled: components.filter(c => c.controlled).length,
}

// ── 2. Screen composition ─────────────────────────────────────────────────────

const RAW_ELEMENTS = /<(div|span|p|h[1-6]|ul|ol|li|table|tr|td|th|section|header|footer|nav|aside|main|button|input|select|textarea|a|img|form|label)\b/g
// Component bindings a file brings in, from any source and in any import form.
//
// This used to require the import path to match a list — `components`, `@ds`,
// `ui/` — which is a guess about someone else's folder names dressed up as a
// measurement. Docusaurus keeps its system behind `@theme/*` and `@docusaurus/*`
// and matched none of it, so fourteen of fourteen screens were reported as
// hand-written with a 0% system share. That is not a low score, it is an
// accusation, and it was manufactured by the detector.
//
// It also read only `import { X } from`, so `import Link from '@docusaurus/Link'`
// was invisible — and a default export is how a great many projects ship their
// components. Between them the two rules made the metric report on naming
// fashion rather than on composition.
//
// What survives: anything capitalised that this file imports and then renders is
// a component rather than raw markup. React itself is excluded — `Fragment` is
// not a design decision.
const importedComponents = (text) => {
  const names = new Set()
  for (const m of text.matchAll(/import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (/^react$/.test(m[2])) continue
    const clause = m[1].replace(/\btype\s+/g, '')
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
    const defaultOrNamespace = clause.replace(/\{[^}]*\}/, '').split(',')[0].trim()
    for (const raw of [...named.split(','), defaultOrNamespace]) {
      const clean = raw.trim().split(/\s+as\s+/).pop()?.trim()
      if (clean && /^[A-Z]\w*$/.test(clean)) names.add(clean)
    }
  }
  return names
}

// Where each frame is defined, so its own declaration of what a region is can be
// read instead of guessed at from the outside. Built once: a project renders a few
// dozen frames and asking the filesystem per screen would walk the tree per screen.
//
// Resolved by the two things that identify a component here — the name it is
// exported under, and the file it lives in. Both, because a project splits roughly
// evenly between the two conventions and either alone finds about half.
const frameSource = new Map()
for (const s of sources) {
  const base = basename(s.at).replace(/\.[jt]sx?$/, '')
  if (/^[A-Z]/.test(base) && !frameSource.has(base)) frameSource.set(base, s.text)
  for (const m of s.text.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g)) {
    if (!frameSource.has(m[1])) frameSource.set(m[1], s.text)
  }
}
for (const r of sfcRead) {
  const base = basename(r.abs).replace(/\.(vue|svelte|ts)$/, '')
  if (!frameSource.has(base)) frameSource.set(base, r.markup ?? '')
  // An Angular template reaches a component by its selector, and the index was keyed
  // by filename — so `<ds-page-shell>` looked up `ds-page-shell` and found nothing,
  // while the frame sat under `page-shell.component`. Every Angular screen reported
  // as rendering into a component that declares no place, on a shell declaring two.
  const selector = /selector\s*:\s*['"]([^'"]+)['"]/.exec((() => {
    try { return readFileSync(r.abs, 'utf8') } catch { return '' }
  })())?.[1]
  if (selector && !frameSource.has(selector)) frameSource.set(selector, r.markup ?? '')
}
const declaredRegions = new Map()
const regionsOf = (name) => {
  if (!declaredRegions.has(name)) declaredRegions.set(name, regionsDeclaredBy(frameSource.get(name)))
  return declaredRegions.get(name)
}

// A shell reads as three fields or as none. `undefined` rather than a placeholder:
// a screen whose frame could not be read has not been shown to have no frame.
const shapeOf = (found) => found
  ? {
      shell: found.shell,
      regions: found.regions,
      signature: signatureOf(found),
      // Whether the frame's own declaration was read, or the regions were inferred
      // from what the screen passes. The second is a reading and is marked as one.
      shapeFromDeclaration: found.fromDeclaration,
    }
  : { shell: undefined, regions: undefined, signature: undefined, shapeFromDeclaration: undefined }

const screens = []
for (const s of sources.filter(isScreen)) {
  const imported = importedComponents(s.text)
  const used = [...imported].filter(name => new RegExp(`<${name}\\b`).test(s.text))
  const raw = [...s.text.matchAll(RAW_ELEMENTS)].length
  const systemUses = used.reduce((n, name) => n + [...s.text.matchAll(new RegExp(`<${name}\\b`, 'g'))].length, 0)

  screens.push({
    file: s.at,
    systemComponents: used.length,
    systemElementUses: systemUses,
    rawElements: raw,
    // The share of rendered elements that come from the system rather than from
    // raw markup. A screen at 20% is a screen written mostly by hand.
    systemShare: pct(systemUses, systemUses + raw),
    handlesLoading: /\b(isLoading|loading|pending|isPending|Skeleton|Spinner)\b/.test(s.text),
    handlesError: /\b(error|isError|ErrorBoundary|Alert)\b/.test(s.text),
    handlesEmpty: /\b(empty|EmptyState|noResults|isEmpty|length === 0|length \? )\b/.test(s.text),
    // The shape of the screen, kept per screen rather than only summarised. Until
    // this was written down, the archetype was computed at generate time over
    // whatever sources that run happened to hold, and nothing accumulated: a project
    // measured on Monday taught the next project nothing.
    // Only ever an explanation for an absence. Computed unconditionally it
    // double-counted: `shellOf` looks for the first return whose root is a
    // component and `shapeless` for the first return of any kind, so a file with a
    // raw wrapper early and a frame later answered both, and 53 framed + 84
    // unframed + 17 rendering nothing came to 154 screens out of 131.
    ...(() => {
      const found = shellOf(s.text, regionsOf)
      return { ...shapeOf(found), noShellBecause: found ? undefined : shapeless(s.text) }
    })(),
    foundBy: screenEvidence(s),
  })
}

// The same files as screens. A single-file component is both the unit of
// composition and the unit of API in these frameworks, which is the difference
// from React rather than a shortcut taken here.
// A component file is not a screen because it exists.
//
// JSX files pass through `isScreen`; single-file components did not, so every one of
// them was pushed. On PeerTube that made all 331 components screens and the pass
// reported "31% system share, 160 screens mostly hand-written" about a design system,
// not about screens. The same held for every Vue and Svelte project measured.
//
// The test is the one already written for JSX: the router points at it, it sits where
// the framework's own filesystem router puts routes, or its name says so outside any
// router. The last is a guess and is counted as one.
const sfcScreens = sfcRead.filter(r => {
  const at = rel(r.abs)
  if (IN_TEST_TREE.test(at)) return false
  if (routedModules.has(at)) return true
  if (IS_COMPONENT_DIR.test(at) || NOT_A_ROUTE.test(at)) return false
  if (inAppRouter(at) ? APP_ROUTER_FILE.test(at) : inFlatRouter(at)) return true
  return /(page|screen|view|route)[.-]?[\w-]*\.(vue|svelte)$/i.test(at)
    || /(Page|Screen|View)\.component\.ts$/.test(at)
    || /(^|\/)(pages|views|screens)\//.test(at)
})

for (const r of sfcScreens) {
  screens.push({
    file: rel(r.abs),
    systemComponents: r.distinctComponents,
    systemElementUses: r.componentUses,
    rawElements: r.rawElements,
    systemShare: pct(r.componentUses, r.componentUses + r.rawElements),
    handlesLoading: r.handlesLoading,
    handlesError: r.handlesError,
    handlesEmpty: r.handlesEmpty,
    // Read from the template, not from a return statement — which is the only
    // difference between these screens and the ones above, and the reason they had
    // no shape at all until now.
    ...(() => {
      const found = shellOfMarkup(r.markup, regionsOf)
      return { ...shapeOf(found), noShellBecause: found ? undefined : (r.markup ? shapeless(r.markup) : 'norender') }
    })(),
    // The same three-way evidence the JSX screens get. This said `'naming'` flatly,
    // so a Vue or Svelte screen the router points at still reported as a guess about
    // a filename — and on vue-vben-admin all 27 did, which hid whether the route
    // reader worked on Vue at all.
    foundBy: screenEvidence({ at: rel(r.abs) }),
  })
}

const composition = {
  screens: screens.length,
  // Every screen, kept rather than averaged away.
  //
  // This pass already establishes what each screen is made of and which of its three
  // states it handles, then persists a median and two filtered lists and discards the
  // rest. The discarded part is the only evidence there is for whether a project's
  // screens fall into a few shapes or are all different, and that question cannot be
  // answered from a median.
  shapes: screens.map(s => ({
    file: s.file,
    foundBy: s.foundBy,
    noShellBecause: s.noShellBecause,
    shell: s.shell,
    regions: s.regions,
    signature: s.signature,
    // Whether the shell's own declaration was read. Left out of this map at first,
    // so every shape read as inferred and the aggregate beside it said twelve —
    // a field computed, summarised, and dropped before the only place a reader
    // could check it against the file it came from.
    fromDeclaration: s.shapeFromDeclaration,
    systemComponents: s.systemComponents,
    systemElementUses: s.systemElementUses,
    rawElements: s.rawElements,
    systemShare: s.systemShare,
    states: [s.handlesLoading && 'loading', s.handlesError && 'error', s.handlesEmpty && 'empty'].filter(Boolean),
  })),
  // The distribution, so a reader does not have to derive it, and so the number of
  // screens whose frame could not be read is visible beside the ones that could.
  // A signature covering 60% of screens is a shape to write the next one in; one
  // covering 4% is a screen somebody wrote once.
  archetypes: (() => {
    const withShape = screens.filter(s => s.signature)
    const by = new Map()
    for (const s of withShape) {
      if (!by.has(s.signature)) by.set(s.signature, { files: [], declared: Boolean(s.shapeFromDeclaration) })
      by.get(s.signature).files.push(s.file)
    }
    const byShell = new Map()
    for (const s of withShape) byShell.set(s.shell, (byShell.get(s.shell) ?? 0) + 1)
    return {
      framed: withShape.length,
      // A screen that builds its own page out of raw elements. Not a gap in this
      // pass — a fact about the project, and usually the most actionable one it
      // produces: a repository where most screens are unframed has no page frame to
      // write the next screen in, and that is the thing to install before anything
      // else here is worth doing.
      unframed: screens.filter(s => s.noShellBecause === 'unframed').length,
      // Renders nothing: a route module that only exports a loader or re-exports.
      renderingNothing: screens.filter(s => s.noShellBecause === 'norender').length,
      // Returns plumbing and nothing else — a layout route whose whole body is an
      // `<Outlet />`. It renders, and it has no shape of its own.
      plumbingOnly: screens.filter(s => s.noShellBecause === 'plumbingOnly').length,
      // The three above partition the screens; anything left over is a screen this
      // pass classified as neither, and a category nobody named is a category
      // nobody will notice going wrong.
      unclassified: screens.filter(s => !s.signature && !s.noShellBecause).length,
      // How many of the shapes above rest on the frame's own declaration. A
      // catalogue assembled from inferred shapes is a catalogue of guesses, and
      // this is the number that says how much of it is which.
      fromDeclaration: withShape.filter(s => s.shapeFromDeclaration).length,
      // And how many of the screens themselves are a fact rather than a guess.
      byRoute: screens.filter(s => s.foundBy === 'route').length,
      byRouter: screens.filter(s => s.foundBy === 'router').length,
      byNaming: screens.filter(s => s.foundBy === 'naming').length,
      shells: [...byShell].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      signatures: [...by].map(([name, entry]) => ({
        name,
        count: entry.files.length,
        // Whether the shell behind this signature declares places at all. Without
        // it the list mixes a page frame with a table row and reads as if the
        // project had eight house shapes.
        declared: entry.declared,
        examples: entry.files.slice(0, 3),
      })).sort((a, b) => b.count - a.count),
    }
  })(),
  medianSystemShare: screens.length
    ? screens.map(s => s.systemShare).sort((a, b) => a - b)[Math.floor(screens.length / 2)]
    : 0,
  handWritten: screens.filter(s => s.systemShare < 0.3).map(s => ({ file: s.file, systemShare: s.systemShare })),
  statesHandled: {
    loading: pct(screens.filter(s => s.handlesLoading).length, screens.length),
    error: pct(screens.filter(s => s.handlesError).length, screens.length),
    empty: pct(screens.filter(s => s.handlesEmpty).length, screens.length),
    allThree: pct(screens.filter(s => s.handlesLoading && s.handlesError && s.handlesEmpty).length, screens.length),
  },
  screensMissingStates: screens
    .filter(s => !(s.handlesLoading && s.handlesError && s.handlesEmpty))
    .map(s => ({
      file: s.file,
      missing: [!s.handlesLoading && 'loading', !s.handlesError && 'error', !s.handlesEmpty && 'empty'].filter(Boolean),
    })),
}

// ── 3. Architecture: the import graph ─────────────────────────────────────────
//
// Delegated to dependency-cruiser, which resolves tsconfig path aliases and
// follows the real graph. The hand-written traversal this replaces read only
// relative imports, so its cycle count was a lower bound reported as if it were
// a total: on one repository it saw 90 modules where a configured cruise sees
// 257, and could not prove the cycle it suspected.
//
// The config lives in this tool, not in the analysed repository, because `deep`
// measures and never writes.

function cruise() {
  // Where the binary is depends on how this tool was obtained. Run from a clone it
  // sits under our own node_modules; installed as a dependency it sits in the
  // consumer's, one or two levels up. Looking in one place worked on the machine it
  // was written on and nowhere else — which is what packaging it and running it as
  // a stranger immediately showed.
  const bin = [
    join(root, 'node_modules', '.bin', 'depcruise'),
    join(root, '..', '.bin', 'depcruise'),
    join(root, '..', '..', '.bin', 'depcruise'),
    join(target, 'node_modules', '.bin', 'depcruise'),
  ].find(existsSync)
  const config = join(root, 'config', 'depcruise.cjs')

  // An object either way. Returning `undefined` from one branch and a record from
  // the others left the caller reading `.graph` off nothing, and the whole pass
  // died rather than reporting that one tool was missing.
  if (!bin) return { failed: 'dependency-cruiser is not installed alongside this tool; run npm install where it lives' }
  if (!existsSync(config)) return { failed: `the dependency-cruiser config is missing at ${config}` }

  const tsconfig = ['tsconfig.json', 'tsconfig.app.json'].map(f => join(target, f)).find(existsSync)
  const excludePattern = ['(^|/)\\.[^/]', ...EXCLUDED.map(e => `^${e}/`)].join('|')
  const scope = existsSync(join(target, 'src')) ? 'src' : '.'

  const invoke = (useTsconfig) => {
    try {
      return execFileSync(bin, [scope, '--config', config, '--output-type', 'json'], {
        cwd: target,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, DS_TSCONFIG: useTsconfig ? (tsconfig ?? '') : '', DS_EXCLUDE: excludePattern },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // A forbidden dependency makes it exit non-zero, and that is the normal
      // case. Anything without stdout is a different failure — a missing import
      // once hid here as "the tool is not installed" — so it is raised rather
      // than absorbed.
      if (typeof error.stdout !== 'string') throw error
      return error.stdout || String(error.stderr ?? '')
    }
  }

  // Docusaurus extends `@docusaurus/tsconfig`, which is not on disk until the
  // project's dependencies are installed, and TypeScript refuses the whole file
  // over it. That failure came back as "dependency-cruiser is not installed" —
  // a message that sends a client to fix something that was never broken.
  //
  // Retried without the tsconfig, the graph still builds; what is lost is path
  // alias resolution, so the fallback says so instead of quietly reporting a
  // thinner graph as the whole one.
  let raw = invoke(true)
  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = undefined }
  if (parsed) return { graph: parsed, aliasesResolved: Boolean(tsconfig) }

  const firstError = String(raw).split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 160)
  if (!tsconfig) return { failed: firstError ?? 'dependency-cruiser produced no parseable output' }

  raw = invoke(false)
  try { parsed = JSON.parse(raw) } catch { parsed = undefined }
  if (parsed) return { graph: parsed, aliasesResolved: false, degraded: firstError }
  return { failed: firstError ?? 'dependency-cruiser produced no parseable output' }
}

const cruiseResult = cruise()
const cruised = cruiseResult.graph

const featureOf = (path) => {
  const parts = path.split('/')
  const i = parts.findIndex(p => /^(features?|modules?|domains?|pages?|layouts?|components?)$/.test(p))
  return i === -1 || !parts[i + 1] ? undefined : `${parts[i]}/${parts[i + 1]}`
}

let architecture
if (cruised) {
  const modules = cruised.modules ?? []
  const cycles = new Set()
  const crossFeature = []
  const fanIn = new Map()

  // The same knot of modules, entered from a different file, is reported by
  // dependency-cruiser as another cycle with another path. Excalidraw came back
  // with 1834 of them, which reads as 1834 problems to go and fix; normalising
  // each path to the *set* of modules it runs through shows how many independent
  // knots there actually are, and it is a much smaller number attached to a few
  // barrel files.
  const knots = new Map()

  for (const m of modules) {
    for (const dep of m.dependencies ?? []) {
      if (dep.circular) {
        const path = (dep.cycle ?? []).map(c => c.name ?? c)
        cycles.add(path.join(' → '))
        const key = [...new Set(path)].sort().join('|')
        if (key) knots.set(key, (knots.get(key) ?? 0) + 1)
      }
      if (dep.dependencyTypes?.includes('npm')) continue
      fanIn.set(dep.resolved, (fanIn.get(dep.resolved) ?? 0) + 1)
      const a = featureOf(m.source), b = featureOf(dep.resolved)
      if (a && b && b !== a && a.split('/')[0] === b.split('/')[0]) {
        crossFeature.push({ from: m.source, to: dep.resolved })
      }
    }
  }

  architecture = {
    analysedBy: 'dependency-cruiser',
    modules: cruised.summary.totalCruised,
    internalEdges: cruised.summary.totalDependenciesCruised,
    cycles: [...cycles].slice(0, 10),
    cycleCount: cycles.size,
    // What a team would actually work through: distinct groups of modules that
    // depend on each other, rather than every route through them.
    distinctCycleGroups: knots.size,
    modulesInCycles: new Set([...knots.keys()].flatMap(k => k.split('|'))).size,
    orphans: modules.filter(m => m.orphan).map(m => m.source).slice(0, 10),
    crossFeatureImports: crossFeature.length,
    crossFeatureExamples: crossFeature.slice(0, 8),
    mostDependedOn: [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([m, n]) => ({ module: m, dependents: n })),
  }
} else {
  // No traversal of our own stands in for it. A number produced by a method known
  // to under-report is worse than none, because it gets quoted.
  architecture = {
    analysedBy: 'not analysed',
    reason: cruiseResult.failed ?? 'dependency-cruiser is not installed in this tool; run npm install',
    modules: undefined,
    cycleCount: undefined,
    distinctCycleGroups: undefined,
    modulesInCycles: undefined,
    crossFeatureImports: undefined,
  }
}

// ── 4. Testing discipline ─────────────────────────────────────────────────────

const tests = sources.filter(isTest)
const count = (re) => tests.reduce((n, s) => n + [...s.text.matchAll(re)].length, 0)
const byRole = count(/getBy(Role|LabelText|Text|Placeholder)|findBy(Role|LabelText|Text)/g)
const byTestId = count(/getByTestId|findByTestId|querySelector\(/g)
// A monorepo package is a legitimate thing to be pointed at, and plenty of them
// keep their tests somewhere else. documenso's `apps/remix` holds none, so this
// read "0% of source files tested" — for a project whose suite lives in a sibling
// called `app-tests`. "None here" and "none anywhere" are different findings and
// only one of them is an accusation, so where the count is zero the neighbours
// are checked before the number is reported.
const testsElsewhere = (() => {
  if (tests.length > 0) return undefined
  const chain = []
  let dir = target
  for (let i = 0; i < 4; i += 1) {
    const up = dirname(dir)
    if (up === dir) break
    chain.push(up); dir = up
    if (existsSync(join(up, '.git'))) break
  }
  const found = []
  for (const base of chain) {
    for (const holder of ['packages', 'apps', 'tests', 'e2e']) {
      const at = join(base, holder)
      if (!existsSync(at)) continue
      try {
        for (const name of readdirSync(at)) {
          if (/test|spec|e2e/i.test(name)) found.push(relative(base, join(at, name)).split(sep).join('/'))
        }
      } catch { /* unreadable */ }
    }
    if (existsSync(join(base, 'tests')) || existsSync(join(base, 'e2e'))) {
      found.push(existsSync(join(base, 'tests')) ? 'tests/' : 'e2e/')
    }
  }
  return found.length ? [...new Set(found)] : undefined
})()

// Which components have behaviour, and which of those nobody tests. Counting
// components without a test file gives a figure nobody acts on, because most of
// them have nothing to test — and a backlog a team believes is what gets cleared.
const behaviour = behaviourGaps({
  sources: sources.filter(s => !isTest(s) && /\.[jt]sx$/.test(s.at)),
  tests,
})

const testing = {
  files: tests.length,
  perSourceFile: pct(tests.length, sources.filter(s => !isTest(s)).length),
  testsElsewhere,
  accessibleQueries: byRole,
  implementationQueries: byTestId,
  // Querying by role or label asserts what a user can perceive; querying by test
  // id asserts the markup, and passes after a change that breaks the experience.
  queryDiscipline: byRole + byTestId === 0 ? undefined : pct(byRole, byRole + byTestId),
  userEvent: count(/userEvent\.|user\.(click|type|keyboard|tab)/g),
  fireEvent: count(/fireEvent\./g),
  snapshots: count(/toMatchSnapshot|toMatchInlineSnapshot/g),
  // Projects wrap axe in a helper as often as they call it directly, so the
  // import is the reliable signal rather than the call.
  axe: count(/toHaveNoViolations|\baxe\(|a11yViolations|axeViolations|checkA11y/g)
    + tests.filter(t => /from ['"][^'"]*(a11y|axe)[^'"]*['"]/.test(t.text)).length,
}

// ── 5. Type discipline ────────────────────────────────────────────────────────

const nonTest = sources.filter(s => !isTest(s))
const typeCount = (re) => nonTest.reduce((n, s) => n + [...s.text.matchAll(re)].length, 0)
const types = {
  files: nonTest.length,
  any: typeCount(/(:|<)\s*any\b|\bas\s+any\b/g),
  assertions: typeCount(/\bas\s+(?!const\b)[A-Z][\w.<>[\]]*/g),
  nonNull: typeCount(/[\w)\]]!\s*[.);,\]]/g),
  suppressions: typeCount(/@ts-(ignore|expect-error|nocheck)/g),
  discriminatedUnions: typeCount(/\btype\s+\w+\s*=\s*\{[^}]*\bkind\s*:|(\|\s*\{\s*(kind|type)\s*:)/g),
}


// ── 6. State and data ─────────────────────────────────────────────────────────

const DEPS = (() => {
  const pkgPath = join(target, 'package.json')
  if (!existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch { return {} }
})()
const dep = (...names) => names.filter(n => n in DEPS)

const nonTestSources = sources.filter(s => !isTest(s))
const occurrences = (re, list = nonTestSources) => list.reduce((n, s) => n + [...s.text.matchAll(re)].length, 0)
const filesMatching = (re, list = nonTestSources) => list.filter(s => re.test(s.text))

const isHookFile = (s) => /(^|\/)(hooks?|lib|services?|api|data)\//.test(s.at) || /\/use[A-Z]/.test(s.at)

// Only a network call written by hand. `.get(` and `.delete(` are methods on Map,
// on a form object and on half the libraries in a codebase: matching them counted
// 73 components as fetching directly in a project where ten files touch the
// network at all. Where a server-state library is present its hooks are the
// correct idiom, not a finding.
const fetchCall = /\bfetch\s*\(|\baxios\s*[.(]|\bXMLHttpRequest\b/
const fetchInComponents = filesMatching(fetchCall, nonTestSources.filter(s => /\.[jt]sx$/.test(s.at) && !isHookFile(s)))
const fetchInHooks = filesMatching(fetchCall, nonTestSources.filter(isHookFile))

const stateData = {
  clientStateLibrary: dep('zustand', 'redux', '@reduxjs/toolkit', 'jotai', 'valtio', 'mobx', 'recoil'),
  serverStateLibrary: dep('@tanstack/react-query', 'react-query', 'swr', '@apollo/client', 'urql'),
  useState: occurrences(/\buseState\s*[(<]/g),
  useReducer: occurrences(/\buseReducer\s*\(/g),
  useContext: occurrences(/\buseContext\s*\(/g),
  createContext: occurrences(/\bcreateContext\s*[(<]/g),
  useEffect: occurrences(/\buseEffect\s*\(/g),
  // Fetching inside a component body is the pattern every server-state library
  // exists to replace: no cache, no dedupe, no retry, and a race on every remount.
  fetchInComponents: fetchInComponents.map(s => s.at),
  serverStateHookUses: occurrences(/\buse(Query|Mutation|InfiniteQuery|SWR|SuspenseQuery)\b/g),
  fetchInHooksOrServices: fetchInHooks.length,
  effectWithFetch: filesMatching(/useEffect\s*\([\s\S]{0,400}?(fetch|axios)\s*\(/, nonTestSources).map(s => s.at),
}

// ── 7. Forms ──────────────────────────────────────────────────────────────────

const formFiles = filesMatching(/<form\b|onSubmit=/, nonTestSources)
const forms = {
  library: dep('react-hook-form', 'formik', 'final-form', 'react-final-form', '@tanstack/react-form'),
  validation: dep('zod', 'yup', 'joi', 'valibot', 'superstruct'),
  formsFound: formFiles.length,
  handRolled: formFiles.filter(s => !/useForm|<Formik|useFormik|useField/.test(s.text)).map(s => s.at),
  preventDefault: filesMatching(/preventDefault\s*\(\)/, formFiles).length,
  // A submit handler that never disables while in flight submits twice on a
  // double click, which is the most common way a form creates duplicates.
  guardsDoubleSubmit: filesMatching(/disabled=\{[^}]*(isSubmitting|submitting|pending|loading)/, formFiles).length,
}

// ── 8. Internationalisation ───────────────────────────────────────────────────

const localeFiles = walk(target, [], new Set(['.json']))
  .filter(f => /(locales?|i18n|translations?|lang)\//i.test(relative(target, f)))
  .filter(f => !excludedPrefixes.some(p => f.startsWith(p + sep)))

const flattenKeys = (node, prefix = '', out = []) => {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) flattenKeys(v, prefix ? `${prefix}.${k}` : k, out)
  } else out.push(prefix)
  return out
}

const locales = new Map()
for (const file of localeFiles) {
  const language = (relative(target, file).match(/(?:locales?|i18n|lang)[\\/]([a-zA-Z-]+)/) ?? [])[1]
    ?? basename(file, '.json')
  try {
    const keys = flattenKeys(JSON.parse(readFileSync(file, 'utf8')))
    const bucket = locales.get(language) ?? new Set()
    for (const k of keys) bucket.add(k)
    locales.set(language, bucket)
  } catch { /* not a locale file */ }
}

// Plural suffixes are not translations. CLDR gives Arabic six plural categories
// and English two, so comparing raw key sets reports every Arabic `_few` as a
// missing English string. Comparing base keys asks the question that was meant:
// is this message translated at all.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const baseKey = (k) => k.replace(PLURAL_SUFFIX, '')

const languages = [...locales.keys()]
const baseSets = new Map(languages.map(l => [l, new Set([...locales.get(l)].map(baseKey))]))
const allBaseKeys = new Set(languages.flatMap(l => [...baseSets.get(l)]))
const missingByLanguage = {}
for (const language of languages) {
  const missing = [...allBaseKeys].filter(k => !baseSets.get(language).has(k))
  if (missing.length) missingByLanguage[language] = { missing: missing.length, examples: missing.slice(0, 5) }
}
const pluralForms = Object.fromEntries(languages.map(l =>
  [l, [...locales.get(l)].filter(k => PLURAL_SUFFIX.test(k)).length]))

const i18n = {
  library: dep('react-i18next', 'i18next', 'next-intl', 'react-intl', 'lingui'),
  languages,
  keysPerLanguage: Object.fromEntries(languages.map(l => [l, locales.get(l).size])),
  baseKeysPerLanguage: Object.fromEntries(languages.map(l => [l, baseSets.get(l).size])),
  pluralForms,
  // A key present in one language and absent in another renders as the raw key
  // to whoever speaks the second one. This is the defect, not the count.
  parityGaps: missingByLanguage,
  translatedCalls: occurrences(/\bt\(['"`]|<Trans\b|i18nKey/g),
  plurals: occurrences(/_plural|count\s*:/g),
  rtl: {
    logicalProperties: [...allCssText.matchAll(/(padding|margin|border|inset)-inline|text-align:\s*(start|end)/g)].length,
    physicalProperties: [...allCssText.matchAll(/(padding|margin|border)-(left|right)\s*:/g)].length,
    dirHandling: occurrences(/\bdir\s*=|document\.documentElement\.dir/g),
  },
}

// ── 9. Resilience ─────────────────────────────────────────────────────────────

const asyncFiles = filesMatching(/\basync\b|\.then\s*\(/, nonTestSources)
const resilience = {
  errorBoundaries: filesMatching(/ErrorBoundary|componentDidCatch|getDerivedStateFromError/, nonTestSources).map(s => s.at),
  asyncFiles: asyncFiles.length,
  asyncWithHandling: filesMatching(/try\s*\{|\.catch\s*\(/, asyncFiles).length,
  // Async work with nowhere for a failure to go: the request fails, nothing
  // renders, and the screen sits in its loading state until reload.
  unhandledAsync: asyncFiles.filter(s => !/try\s*\{|\.catch\s*\(/.test(s.text)).map(s => s.at),
}

// ── 10. Performance and responsiveness ────────────────────────────────────────

const cssText = allCssText
const breakpointValues = [...cssText.matchAll(/@media[^{]*?(\d{3,4})px/g)].map(m => m[1])

const performance = {
  memo: occurrences(/\bReact\.memo\(|\bmemo\(/g),
  useMemo: occurrences(/\buseMemo\s*\(/g),
  useCallback: occurrences(/\buseCallback\s*\(/g),
  lazyRoutes: occurrences(/\bReact\.lazy\(|\blazy\(\s*\(\)\s*=>/g),
  suspense: occurrences(/<Suspense\b/g),
  lazyImages: occurrences(/loading=["']lazy["']/g),
  mediaQueries: [...cssText.matchAll(/@media/g)].length,
  containerQueries: [...cssText.matchAll(/@container/g)].length,
  // Breakpoints repeated as literals drift apart the first time one is changed;
  // media queries cannot read custom properties, so this needs a generator or a
  // documented single home rather than discipline.
  distinctBreakpoints: [...new Set(breakpointValues)].sort((a, b) => a - b),
}

// ── Write and report ──────────────────────────────────────────────────────────

const name = scanSlot(target)
const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })

const report = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  parsedWith: `typescript ${ts.version}`,
  analysedFiles: sources.length,
  limits: {
    componentApi: 'Props are read from a *Props type in the same file. A component typing its props inline or importing them is counted as having none.',
    singleFileComponents: sfcFiles.length ? `${sfcFiles.length} ${framework.name === 'angular' ? '.component.ts' : '.vue/.svelte'} file(s) read. ${SFC_LIMITS}` : undefined,
    states: 'State handling is detected by identifier, not by control flow: a screen that names `error` without rendering anything for it reads as handled. This is a floor.',
    architecture: !cruised
      ? `NOT ANALYSED — ${cruiseResult.failed}. This is not a clean result; it is no result.`
      : cruiseResult.aliasesResolved
        ? 'dependency-cruiser with the project\'s tsconfig, so path aliases resolve. Dynamic imports built at runtime remain invisible to any static graph.'
        : `dependency-cruiser WITHOUT the project's tsconfig${cruiseResult.degraded ? ` — it would not load: ${cruiseResult.degraded}` : ''}. Path aliases therefore do not resolve, so imports written through an alias are missing from this graph and the counts below are a floor.`,
    behaviour: behaviour.limits,
    testing: 'Counts occurrences, not intent. A file mixing both query styles contributes to both.',
    types: 'Regex over source. A generic named `any` or the word inside a string will be counted.',
    stateData: 'Only a hand-written network call counts. A request behind a generated client, a tRPC proxy or a query hook is deliberately not counted as fetching in a component — where a server-state library is present, its hooks are the idiom.',
    composition: `A screen is first of all whatever the router points at: ${routedModules.size} module(s) were resolved from route declarations here. Naming — Page/Screen/View, or a module inside a route directory — is only the fallback, because a folder-name list is a guess about someone else's habits and Outline's screens live in \`scenes/\`. What remains out of reach is a route table built from data: where \`component\` comes from a config object or a hook, no static pass can follow it, and those screens are missing from this count rather than absent from the project.`,
    forms: 'A form is recognised by a form element or an onSubmit handler. A form assembled entirely from library components is undercounted.',
    i18n: 'Parity compares BASE keys, with CLDR plural suffixes stripped: Arabic has six plural categories and English two, so raw key sets make correct files look untranslated. A key supplied at runtime is not seen.',
    resilience: 'Presence of try/catch in the file, not around the specific call. A file with one guarded call and one unguarded reads as handled.',
    performance: 'Counts the presence of the tools, not whether they were needed. A high useMemo count is not automatically good.',
  },
  framework,
  // null rather than a zeroed object where the pass could not look. Every reader
  // downstream — the assessment, the exemplars, the survey table — renders a 0 as
  // a measurement, and against a Svelte repository that produced a confident
  // "0 screens · 0% of states handled" over code containing no React at all.
  // Withheld only where nothing could be read at all. A Vue or Svelte project is
  // measured by the single-file readers; a Python one still gets null, because
  // there is nothing here that speaks it.
  behaviour,
  componentApi: framework.jsx || sfcFiles.length ? componentApi : null,
  composition: framework.jsx || sfcFiles.length ? composition : null,
  architecture, testing, types,
  stateData, forms, i18n, resilience, performance,
}
writeFileSync(join(outDir, 'deep.json'), JSON.stringify(report, null, 2) + '\n')

const line = (label, value, note) => console.log(`  ${String(value).padStart(6)}  ${label}${note ? `  — ${note}` : ''}`)
const share = (v) => v === undefined ? '—' : `${Math.round(v * 100)}%`

console.log(`\ndeep: ${target}`)
// What was actually read, of each kind.
//
// This printed `sources.length` alone, and `sources` holds only `.ts`/`.tsx`. On a
// Vue project it therefore announced "0 file(s), parsed with typescript" directly
// above its own findings about one component and its three props — a headline
// contradicting the report under it, which is how a reader decides the whole thing
// is unreliable. Each kind is counted where it was read.
console.log((() => {
  // Angular components ARE `.ts` files, so listing both counts beside each other
  // says "3 files parsed · 3 components read" over a project holding three — the
  // same double-count this line was rewritten to remove for Vue, in a new form.
  if (framework.name === 'angular') {
    return `${sources.length} file(s) parsed with typescript ${ts.version}, ${sfcRead.length} of them Angular components`
  }
  return [
    sources.length ? `${sources.length} file(s) parsed with typescript ${ts.version}` : undefined,
    sfcRead.length ? `${sfcRead.length} single-file component(s) read` : undefined,
  ].filter(Boolean).join(' · ') || 'nothing read: no .ts/.tsx and no .vue/.svelte/.component.ts here'
})())
console.log(`view framework: ${framework.name} — ${framework.why}\n`)

// Everything from here to the architecture section reads JSX. Against a Svelte
// or Vue repository each of these returns zero, and a zero in a report means
// "looked and found none". Saying so once, plainly, is the difference between an
// assessment and an insult.
// Out of scope means nothing here could be read, not that one of the two kinds of
// file is missing.
//
// This tested `sfcFiles.length` alone, so every pure React project — the majority of
// them, and the one this pass was written for — printed "NOT APPLICABLE … this
// project is react" over both its component API and its composition, while the JSON
// beside it held the full analysis. The two most useful sections were invisible on
// the most common framework, and the sentence contradicted itself in the same
// breath: naming react as the reason react was out of scope.
const OUT_OF_SCOPE = (sources.length || sfcFiles.length)
  ? undefined
  : `NOT APPLICABLE — this pass reads JSX, Vue, Svelte and Angular, and no file of those kinds was found (this project reads as ${framework.name})`

console.log('COMPONENT API — how components take their configuration')
if (OUT_OF_SCOPE) console.log(`  ${OUT_OF_SCOPE}`)
else {
  line('components analysed', componentApi.analysed)
  line('median props', componentApi.medianProps)
  console.log(`          variant strategy: ${componentApi.variantStrategy ? `${componentApi.variantStrategy.dominant} (${share(componentApi.variantStrategy.share)})` : 'no variants anywhere'}`)
  line('boolean explosion', componentApi.booleanExplosion.length, '4+ boolean props; a union would say it better')
  line('god components', componentApi.godComponents.length, '15+ props')
  console.log(`          forwards ref ${share(componentApi.forwardsRef)} · spreads rest ${share(componentApi.spreadsRest)} · compound ${share(componentApi.compound)}`)
}

console.log('\nCOMPOSITION — what a screen here looks like')
if (OUT_OF_SCOPE) console.log(`  ${OUT_OF_SCOPE}`)
else {
  line('screens', composition.screens)
  line('system share (median)', share(composition.medianSystemShare), 'rendered elements coming from the system, not raw markup')
  line('screens mostly hand-written', composition.handWritten.length, 'below 30% system share')
  console.log(`          states handled: loading ${share(composition.statesHandled.loading)} · error ${share(composition.statesHandled.error)} · empty ${share(composition.statesHandled.empty)} · all three ${share(composition.statesHandled.allThree)}`)

  // The frame, which is the part a project arriving with no interfaces is missing.
  //
  // Printed as a partition rather than as one number, because the interesting answer
  // is usually the second line: a repository where most screens build their own page
  // out of raw elements has no frame to write the next screen in, and installing one
  // comes before anything else here is worth doing.
  const a = composition.archetypes
  console.log('')
  // Two numbers on one line, because the first alone overstates. A screen whose
  // root is `<TableRow>` returns a component; it is not in a frame, and 53 of
  // documenso's screens read as framed when 12 of them render into something that
  // declares a place to put anything.
  line('screens rendering into a shell', a.framed, a.framed
    ? `${a.fromDeclaration} of those into a shell that declares places; ${a.framed - a.fromDeclaration} into a component that declares none`
    : undefined)
  line('screens building their own page', a.unframed, 'raw elements at the root — no page frame is used here')
  line('modules rendering nothing', a.renderingNothing, 'a route module that only loads data or re-exports')
  line('layouts that only pass through', a.plumbingOnly, 'the whole body is an <Outlet /> or a provider')
  if (a.unclassified) line('unclassified', a.unclassified, 'neither framed nor explained — this is a hole in this pass')

  // Which screens rest on a fact and which on a guess about someone else's habits.
  const guessed = a.byNaming
  console.log(`          found by: route table ${a.byRoute} · filesystem router ${a.byRouter}${guessed ? ` · file name ${guessed} (a guess, not a route)` : ''}`)

  // Two lists, because they answer different questions and one of them was
  // answering neither. `frames filled here` listed `Link(to)`, `Outlet`, `Badge`
  // and `TableRow` on documenso — every one of them a component a screen happens to
  // return, none of them a frame. A frame is a component that declares a place to
  // put something, and that is checkable rather than a matter of the name.
  const declaredSigs = a.signatures.filter(x => x.declared)
  const bareSigs = a.signatures.filter(x => !x.declared)
  if (declaredSigs.length) {
    console.log('          frames filled here — the shell declares these places:')
    for (const sig of declaredSigs.slice(0, 5)) console.log(`            ${String(sig.count).padStart(4)}  ${sig.name}`)
  }
  if (bareSigs.length) {
    console.log(`          ${bareSigs.reduce((n, x) => n + x.count, 0)} screen(s) return a component that declares no place to put anything:`)
    console.log(`            ${bareSigs.slice(0, 6).map(x => `${x.name} ×${x.count}`).join(' · ')}`)
    console.log('            These are not frames. A screen returning one has no shape to copy.')
  }
  if (!a.framed && composition.screens) {
    console.log('          No screen here renders into a frame. There is no house shape to')
    console.log('          copy, so a generated screen would be inventing one — which is a')
    console.log('          decision for the client, not an output of this tool.')
  }
}

console.log('\nARCHITECTURE — what imports what')
if (architecture.analysedBy === 'not analysed') {
  console.log(`  NOT ANALYSED — ${architecture.reason}`)
} else {
  line('modules', architecture.modules)
  line('internal edges', architecture.internalEdges)
  // The count a team can act on is how much of the codebase is tangled, not how
  // many routes exist through the tangle. Excalidraw reports 1834 cycles and 1575
  // distinct module-sets, both of which read as a backlog; the fact underneath is
  // that 346 of its 1090 modules import in a circle, and they do it through a
  // handful of barrel files.
  line('modules in import cycles', architecture.modulesInCycles, `of ${architecture.modules}; ${architecture.distinctCycleGroups} distinct group(s), ${architecture.cycleCount} route(s) through them`)
  line('cross-feature imports', architecture.crossFeatureImports, 'a sibling reaching into a sibling')
  line('orphans', architecture.orphans.length, 'nothing imports them')
  for (const cycle of architecture.cycles.slice(0, 3)) console.log('          cycle: ' + cycle)
}

console.log('\nTESTING — what is asserted, and how')
line('test files', testing.files, `${share(testing.perSourceFile)} of source files`)
if (testing.testsElsewhere) {
  console.log(`          none under this target, but a suite lives nearby: ${testing.testsElsewhere.join(', ')}`)
  console.log('          this is a monorepo package measured in isolation, not an untested project')
}
console.log(`          query discipline: ${share(testing.queryDiscipline)} accessible (${testing.accessibleQueries} by role/label vs ${testing.implementationQueries} by test id or selector)`)
console.log(`          ${behaviour.untested.length} of ${behaviour.withBehaviour} component(s) with behaviour have no test of their own`)
if (behaviour.untested.length) {
  for (const c of behaviour.untested.slice(0, 4)) console.log(`            ${c.file} — ${c.reasons.join(', ')}`)
  console.log(`          ${behaviour.presentational} other component(s) have nothing to test, which is why "untested" alone is the wrong number`)
}
console.log(`          userEvent ${testing.userEvent} · fireEvent ${testing.fireEvent} · snapshots ${testing.snapshots} · axe ${testing.axe}`)

console.log('\nTYPES — how much of the type system is opted out of')
line('any', types.any)
line('assertions (as X)', types.assertions)
line('non-null (!)', types.nonNull)
line('suppressions', types.suppressions, '@ts-ignore / @ts-expect-error')


console.log('\nSTATE AND DATA — where state lives and how data arrives')
console.log(`          client state: ${stateData.clientStateLibrary.join(', ') || 'React only'} · server state: ${stateData.serverStateLibrary.join(', ') || 'none'}`)
line('useState / useEffect', `${stateData.useState} / ${stateData.useEffect}`)
line('context providers', stateData.createContext)
line('fetching inside components', stateData.fetchInComponents.length, 'no cache, no dedupe, a race on every remount')
line('fetching in hooks/services', stateData.fetchInHooksOrServices)

console.log('\nFORMS')
console.log(`          library: ${forms.library.join(', ') || 'hand-rolled'} · validation: ${forms.validation.join(', ') || 'manual'}`)
line('forms found', forms.formsFound)
line('hand-rolled', forms.handRolled.length)
line('guard double submit', forms.guardsDoubleSubmit, `of ${forms.formsFound} form(s)`)

console.log('\nINTERNATIONALISATION')
console.log(`          library: ${i18n.library.join(', ') || 'none'} · languages: ${i18n.languages.join(', ') || 'none'}`)
for (const [language, gap] of Object.entries(i18n.parityGaps)) {
  console.log(`       ${String(gap.missing).padStart(3)}  message(s) missing in "${language}" — they render as the raw key: ${gap.examples.slice(0, 3).join(', ')}`)
}
if (i18n.languages.length && Object.keys(i18n.parityGaps).length === 0) {
  console.log(`          all ${Object.values(i18n.baseKeysPerLanguage)[0]} messages present in every language`)
}
console.log(`          plural forms: ${Object.entries(i18n.pluralForms).map(([l, n]) => `${l} ${n}`).join(' · ')}`)
console.log(`          RTL: ${i18n.rtl.logicalProperties} logical vs ${i18n.rtl.physicalProperties} physical properties`)

console.log('\nRESILIENCE')
line('error boundaries', resilience.errorBoundaries.length)
line('async files', resilience.asyncFiles, `${resilience.asyncWithHandling} with a catch or try`)
line('async with nowhere to fail', resilience.unhandledAsync.length, 'the screen stays in loading until reload')

console.log('\nPERFORMANCE AND RESPONSIVENESS')
console.log(`          memo ${performance.memo} · useMemo ${performance.useMemo} · useCallback ${performance.useCallback}`)
line('lazy routes / Suspense', `${performance.lazyRoutes} / ${performance.suspense}`)
line('media queries', performance.mediaQueries, `${performance.containerQueries} container queries`)
line('distinct breakpoints', performance.distinctBreakpoints.length, performance.distinctBreakpoints.join(', ') + 'px')

console.log(`\nwritten to scans/${name}/deep.json`)
console.log('Each group records what it cannot see; a zero is never a clean bill of health.')
