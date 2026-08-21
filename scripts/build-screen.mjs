/**
 * Build a screen from a validated spec, in the shape this repository already
 * writes screens.
 *
 * Nothing about the output is brought in. The components come from the profile,
 * the roles are resolved through that profile's bindings, and the file's shape —
 * where screens live, how the design system is imported, whether CSS sits beside
 * the module, whether text goes through i18n, how the component is exported — is
 * measured from the screens that are already there.
 *
 * The claim this makes is checkable, and checking it is the last step: the
 * generated file is run through the repository's own conventions gate. If the
 * generator's output fails the gate that was installed from this repository's
 * conventions, then the generator does not write like this repository, whatever
 * it looks like.
 *
 * Writes are opt-in.
 *
 *   node scripts/build-screen.mjs <spec.json> --repo <path> --profile own
 *   node scripts/build-screen.mjs <spec.json> --repo <path> --profile own --apply
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { scanSlot, detectFramework } from './lib/signals.mjs'
import { emitVue, emitVueTest, VUE_CAN_WRITE } from './lib/emit-vue.mjs'
import { measureStories, emitStory } from './lib/emit-story.mjs'
import { emitSvelte, emitSvelteTest, svelteEra, SVELTE_CAN_WRITE } from './lib/emit-svelte.mjs'
import { emitAngular, emitAngularTest, angularSelector, ANGULAR_CAN_WRITE } from './lib/emit-angular.mjs'
import { archetypes, shellOf, regionsDeclaredBy } from './lib/archetypes.mjs'
import { utilities, containerClasses, zoneClasses } from './lib/utilities.mjs'
import { readTokenLayer, ofType, rootBlock } from './lib/token-layer.mjs'
import { emitFrame } from './lib/emit-frame.mjs'
import { rhythm } from './lib/rhythm.mjs'
import { OPERATORS } from './lib/mutations.mjs'
import { staleness } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}
const specPath = process.argv[2]
const REPO = arg('--repo')
const PROFILE = arg('--profile', 'own')
const apply = process.argv.includes('--apply')

if (!specPath || !existsSync(specPath) || !REPO || !existsSync(REPO)) {
  console.error('usage: node scripts/build-screen.mjs <spec.json> --repo <path> --profile <id> [--apply]')
  process.exit(2)
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'))

// What this project does well, and what it does commonly but badly. Without the
// second list a generator that copies the local idiom copies the local defect:
// "as it is done here" once meant "with no failure path", in seven files of seven.
const exemplarsPath = join(root, 'scans', scanSlot(REPO), 'exemplars.json')
const exemplars = existsSync(exemplarsPath) ? JSON.parse(readFileSync(exemplarsPath, 'utf8')) : undefined
// A missing profile or binding is the ordinary case on a project measured an hour
// ago, and it used to be a stack trace. The generator's own report tells a reader to
// extract a profile with `ds adapt:css` when the one they named is not installed —
// and following that advice produced `ENOENT: bindings/nods-probe.json` and a Node
// backtrace. A tool that crashes on the path it recommends is worse than one that
// never recommended it.
const readProfilePart = (dir, file, what) => {
  const at = join(root, dir, file)
  if (!existsSync(at)) {
    console.error(`\nbuild-screen: no ${what} for "${PROFILE}" — ${relative(root, at)} does not exist.`)
    if (dir === 'profiles') {
      console.error('\nExtract one from what this project already has:')
      console.error(`  ds adapt:css <css-dir> --out ${PROFILE}`)
      console.error('or name a profile that is installed:')
      try {
        console.error(`  ${readdirSync(join(root, 'profiles')).filter(d => !d.startsWith('.')).join(', ')}`)
      } catch { }
    } else {
      // A profile with no binding is the wall a freshly extracted profile hits: the
      // components are known, and nothing says which of them answers `primaryAction`.
      console.error('\nThe profile exists; what is missing is the map from the roles a spec')
      console.error('names to the components in it. Nothing can be built until that is written.')
      console.error(`\n  ds bind ${PROFILE} --repo <path>    proposes one from the profile, to accept or refuse`)
    }
    process.exit(2)
  }
  return JSON.parse(readFileSync(at, 'utf8'))
}
const components = readProfilePart('profiles', join(PROFILE, 'components.json'), 'profile').components
const binding = readProfilePart('bindings', `${PROFILE}.json`, 'binding')

// ── Skeleton, measured from the screens already here ──────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage', 'ds'].includes(name)) continue
    const abs = join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walk(abs, out)
    // Every extension a component can live in. Collecting only `.tsx` was why a Vue
    // project with two perfectly good screens was told "no existing screens found to
    // learn from. Run `ds assess` first" — three clauses, all false: the screens are
    // there, the scan would not help, and naming did not fail because the extension
    // was never looked at.
    else if (/\.(tsx|vue|svelte)$/.test(abs) || /\.component\.ts$/.test(abs)) out.push(abs)
  }
  return out
}

function walkAny(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(name)) continue
    const abs = join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walkAny(abs, out)
    else out.push(abs)
  }
  return out
}

// Where this project keeps its source, taken from the contract rather than assumed.
//
// This was `join(REPO, 'src')`, eight times over, and it crashed outright on the first
// real client tried against it: documenso keeps its code in `app/`, and the generator
// threw `ENOENT: scandir .../src` before printing anything. A tool whose whole claim is
// that it arrives at any repository cannot require one directory name.
//
// `ds install` already writes the scope it measured into `.ds/conventions.json`; where
// no gate is installed yet, the common roots are tried in order and the repository
// root is the last resort.
const SOURCE_ROOT = (() => {
  const fromContract = (() => {
    try {
      const c = JSON.parse(readFileSync(join(REPO, '.ds', 'conventions.json'), 'utf8'))
      return c.scope && c.scope !== '.' ? join(REPO, c.scope) : (c.scope === '.' ? REPO : undefined)
    } catch { return undefined }
  })()
  if (fromContract && existsSync(fromContract)) return fromContract
  for (const dir of ['src', 'app', 'lib', 'source']) {
    if (existsSync(join(REPO, dir))) return join(REPO, dir)
  }
  return REPO
})()

const tsxFiles = walk(SOURCE_ROOT)

// What this repository calls a screen, taken from the measurement rather than
// guessed again here.
//
// This used to match `Page.tsx` and `Screen.tsx` and nothing else, so against
// memos — where the router points at `pages/Home.tsx`, `pages/Archived.tsx` and
// fifteen more — the generator refused to run at all, saying the repository had
// no shape to copy. Two implementations of the same question is one too many:
// `deep` already resolved the route table, and its answer is the one to use.
const measured = (() => {
  try {
    const at = join(root, 'scans', scanSlot(REPO), 'deep.json')
    const deep = JSON.parse(readFileSync(at, 'utf8'))
    // The exemplars this generator copies its shape from come out of this file. A
    // scan taken under an older screen rule listed a root `app.vue` and two layouts
    // as screens; copying the shape of a layout into a screen is not a warning, it
    // is a wrong file written to disk with no sign of anything having gone wrong.
    // So it is said out loud, once, where the person running the build will see it.
    const said = staleness(deep.taken, pathToFileURL(join(root, 'scripts', 'deep.mjs')).href)
    if (said) console.error(`  ! the shape below is copied from a stored scan, and ${said}\n    re-run: node scripts/deep.mjs ${REPO}`)
    const listed = new Set([
      ...(deep.composition?.screensMissingStates ?? []).map(s => s.file ?? s),
      ...(deep.composition?.handWritten ?? []).map(s => s.file),
    ].filter(Boolean))
    return [...listed].map(f => join(REPO, f)).filter(existsSync)
  } catch { return [] }
})()

// Which components a router points at.
//
// In Angular every component is a `.component.ts`, so taking the extension as the
// answer made the button library a set of screens and put the next generated screen
// inside `src/app/ui`. The router is the project's own definition of a screen — the
// same evidence the React path already uses — and where there is no router to read,
// that is said rather than guessed around.
const angularRouted = (() => {
  if (!tsxFiles.some(f => /\.component\.ts$/.test(f))) return undefined
  const routeFiles = walkAny(SOURCE_ROOT).filter(f => /\.ts$/.test(f) && !/\.component\.ts$/.test(f))
  const named = new Set()
  for (const f of routeFiles) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    if (!/\bRoutes\b|RouterModule\.for|provideRouter|loadComponent/.test(text)) continue
    for (const m of text.matchAll(/\bcomponent\s*:\s*([A-Z]\w*)/g)) named.add(m[1])
    for (const m of text.matchAll(/loadComponent\s*:[^,]*?import\s*\(\s*['"]([^'"]+)['"]/g)) named.add(m[1])
  }
  if (!named.size) return undefined
  return tsxFiles.filter(f => {
    if (!/\.component\.ts$/.test(f)) return false
    try {
      const cls = /export class (\w+)/.exec(readFileSync(f, 'utf8'))?.[1]
      return cls ? named.has(cls) : false
    } catch { return false }
  })
})()

const screens = (measured.length ? measured
  : angularRouted?.length ? angularRouted
  : tsxFiles.filter(f =>
    /(Page|Screen|View)\.(tsx|vue|svelte)$/.test(f)
    || /\.component\.ts$/.test(f)))
  .filter(f => !/\.(test|spec)\./.test(f))

// Which framework the screens actually are, decided by the screens rather than by
// the dependency list — a repository can declare three and write one.
const FRAMEWORK = (() => {
  const counts = { tsx: 0, vue: 0, svelte: 0, angular: 0 }
  for (const f of screens) {
    if (/\.component\.ts$/.test(f)) counts.angular += 1
    else counts[f.slice(f.lastIndexOf('.') + 1)] += 1
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return top[1] === 0 ? undefined : { tsx: 'react', vue: 'vue', svelte: 'svelte', angular: 'angular' }[top[0]]
})()
const EXT = FRAMEWORK === 'vue' ? '.vue'
  : FRAMEWORK === 'svelte' ? '.svelte'
  : FRAMEWORK === 'angular' ? '.component.ts'
  : '.tsx'

// Svelte is refused by name, with the true reason. It was previously refused with
// the wrong one, which sends somebody to run a scan that will not help.
if (screens.length === 0) {
  console.error('build-screen: no existing screens found to learn from.')
  console.error(measured.length === 0
    ? `Run \`ds assess ${REPO}\` first — the route table is what identifies a screen here, and naming alone found none.`
    : 'This repository has no shape to copy yet.')
  process.exit(1)
}

// The installed contract, which outranks anything measured here.
//
// This script measured conventions afresh from the screens on disk and never
// opened `.ds/conventions.json` — the file the gate is generated from. That file
// carries the team's DECISIONS, and decisions exist precisely to say something the
// current code does not: `update` writes them into `enforce` with the source
// "decided by the team on <date>", and they are never regenerated.
//
// So on any project where a team had settled a split, the generator wrote against
// the 90% that the files show, the gate demanded the 10% that was agreed, and the
// generator concluded "the generator does not write like this repository. That is
// the generator's defect." It was not. It was the one authority in the repository
// going unread, in the script that writes files into it.
const contract = (() => {
  const at = join(REPO, '.ds', 'conventions.json')
  if (!existsSync(at)) return undefined
  try { return JSON.parse(readFileSync(at, 'utf8')) } catch { return undefined }
})()

/** What the contract requires for a dimension, or undefined if it does not cover it. */
const required = (dimension) => contract?.enforce?.[dimension]

// What this generator is able to write, per dimension.
//
// The alternative design was a repair loop: emit, run the gate, patch whatever it
// complained about, run it again. That is how a generator learns to satisfy a
// checker instead of learning to write — the transform that makes the gate green
// is not the transform that makes the file right, and after three rounds nobody
// can say which one happened.
//
// So the check runs BEFORE anything is written. Where the contract requires a
// convention this generator has no way to produce, it refuses and says which one,
// because a file it knows the gate will reject is worse than no file: somebody has
// to read it, decide it is nearly right, and fix it by hand.
//
// `undefined` means the dimension is not exercised by the output at all — the
// generated screen declares no props and no handlers, so a rule about them is
// neither honoured nor broken, and claiming either would be a lie in one direction.
const CAN_WRITE = {
  // Both forms, and the choice already follows the contract above.
  'component export': ['named', 'default'],
  // Toggled by whether the stylesheet is imported at the top of the module. The
  // other four buckets — CSS Modules, styled, MUI sx, utility classes — are
  // different products, not different spellings.
  // `utility classes` was outside this list, and that is why the generator resolved
  // every element of a spec on a real Tailwind product and then declined to write the
  // file. The classes are not invented: they are read from the containers that project
  // already writes, and where it gives no answer for a slot nothing is written for it.
  styling: ['plain co-located CSS', 'className, styles elsewhere', 'utility classes'],
  // One file per screen, named for the component.
  'file structure': ['flat Name.tsx'],
  // The stylesheet is emitted with custom properties and no literals.
  'colour values': ['token'],
  'sizing values': ['token'],
  'user-facing text': undefined,
  'props declaration': undefined,
  'handler naming': undefined,
  // Deliberately excluded: the runner's configuration decides where a test is
  // collected from, and that already outranks the measured habit. Listing it here
  // would turn a considered divergence into a refusal.
  'test placement': undefined,
  // The specifiers come from the profile and from how the existing screens import
  // their shell. This does not choose them, so it cannot promise a form.
  'internal imports': undefined,
}

// Whichever emitter is going to run. A React table consulted for a Vue build would
// refuse `script setup` for not being `named`.
const CAPABILITY = FRAMEWORK === 'vue' ? VUE_CAN_WRITE
  : FRAMEWORK === 'svelte' ? SVELTE_CAN_WRITE
  : FRAMEWORK === 'angular' ? ANGULAR_CAN_WRITE
  : CAN_WRITE

const cannotHonour = Object.entries(contract?.enforce ?? {})
  .filter(([dimension, rule]) => {
    const can = CAPABILITY[dimension]
    if (can === undefined) return false
    return !can.includes(rule.expect)
  })
  .map(([dimension, rule]) => ({ dimension, expect: rule.expect, can: CAPABILITY[dimension] }))

// Nothing to count is an answer, not a crash. `handler` collects only from screens
// that define one, so a repository of read-only list screens hands this an empty
// array — and the first version died there with a TypeError over a repository
// that had done nothing wrong.
const majority = (values) => {
  if (!values.length) return { value: undefined, share: 0, measured: false }
  const counts = {}
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return { value: top[0], share: top[1] / values.length, measured: true }
}

const sources = screens.map(f => ({ path: f, text: readFileSync(f, 'utf8') }))

// Where screens live, and what they are called.
const screenDir = (() => {
  const dirs = screens.map(f => dirname(f))
  // Angular gives each component a folder of its own, so the majority of those
  // folders is whichever component happened to come first — `src/app/archived` as
  // the home of every future screen. The parent they share is the answer.
  if (EXT === '.component.ts' && new Set(dirs).size === dirs.length && dirs.length > 1) {
    const parents = dirs.map(d => dirname(d))
    if (new Set(parents).size < parents.length) return majority(parents).value
  }
  return majority(dirs).value
})()

// How the design system is reached from a screen. The alias a repository uses is
// not guessable — salim reaches it as `@ds/Button`, another repo as a package.
const dsImports = sources.flatMap(s => [...s.text.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]))
const dsPrefix = (() => {
  const prefixes = dsImports
    .filter(p => /^[@a-z]/i.test(p) && p.includes('/'))
    .map(p => p.split('/')[0])
    .filter(p => p.startsWith('@'))
  return prefixes.length ? majority(prefixes).value : undefined
})()
const dsImportsAreScoped = dsImports.some(p => p.startsWith(`${dsPrefix}/`))

const disagreements = []

// Measured here, then overruled where the contract speaks. Kept as a pair so the
// report can show both: "the team decided X; the files say Y at 90%" is a fact
// about the project worth seeing, and hiding it would make the contract look like
// the measurement.
const decided = (dimension, measured) => {
  const rule = required(dimension)
  if (!rule || rule.expect === measured.value) return measured
  disagreements.push({ dimension, contract: rule.expect, measured: measured.value, share: measured.share, source: rule.source })
  return { value: rule.expect, share: rule.share ?? 0, measured: false, fromContract: true }
}

// The spacing this project writes, and whether the tokens behind it exist.
//
// Every emitter hardcoded `--space-4`, `--space-2`, `--space-6` and
// `--colour-text-muted`. Against this tool's own first-party design system that used
// the fourth-favourite gap, the least favourite padding, and a colour token the
// system does not declare at all — and an unresolvable custom property is dropped
// silently, so the rule vanishes and nobody is told.
// The client's own visual language, where this profile carries one.
//
// `ds style <url> --out <id>` reads a live site into a token layer: sixty-seven values
// on one real site, thirteen of them under the name the site itself gave them. Nothing
// downstream read it, so a project with no design system in code got a screen with the
// right shape and no colour, while its palette, type scale, spacing and radii sat in a
// file two steps away.
//
// It is never referenced blind. A `var(--x)` naming a property the project does not
// declare is dropped by the browser without a word, so the tokens travel WITH the
// proposal: taking the frame takes what it needs.
const profileTokens = (() => {
  try {
    const at = join(root, 'profiles', PROFILE, 'tokens.json')
    if (!existsSync(at)) return undefined
    const all = readTokenLayer(JSON.parse(readFileSync(at, 'utf8')))
    return all.length ? all : undefined
  } catch { return undefined }
})()


const spacing = (() => {
  const sheets = walkAny(SOURCE_ROOT).filter(f => /\.(css|scss)$/.test(f))
  const inline = sources.map(s => s.text).join('\n')
  const css = sheets.map(f => { try { return readFileSync(f, 'utf8') } catch { return '' } }).join('\n') + '\n' + inline
  const measured = rhythm(css)

  // Where this project declares a role, that is the answer and nothing overrides it.
  // Where it declares none and the profile carries a layer read from what the client
  // ships, the role is borrowed — and the layer is written beside the proposal, so
  // the name resolves rather than being dropped by the browser in silence.
  //
  // All three roles, not one. The first version borrowed only `gap`, so a project
  // with no tokens got a screen with a gap and no padding and a state paragraph in
  // the browser's default black — while the layer beside it held 45 dimensions and
  // 65 colours.
  if (!profileTokens) return measured
  const dims = profileTokens.filter(t => t.type === 'dimension')
  const bySpace = [...dims.filter(t => /^(spacing|space)/.test(t.name))].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
  // A muted foreground is a judgment about intent, so it is taken only where the
  // client named one themselves. Picking the third-darkest colour and calling it
  // muted is the kind of guess a team rejects on sight.
  const mutedNamed = profileTokens.find(t => t.named && t.type === 'color'
    && /(muted|secondary|subtle|dim|tertiary)/i.test(t.name))

  const borrowed = {
    gap: measured.gap ?? (bySpace[0] ? `--${bySpace[0].name}` : undefined),
    // A padding is a larger step than a gap where the layer offers one, and the same
    // token where it does not. Two roles from one value is what a small scale means.
    padding: measured.padding ?? (bySpace[1] ? `--${bySpace[1].name}` : bySpace[0] ? `--${bySpace[0].name}` : undefined),
    muted: measured.muted ?? (mutedNamed ? `--${mutedNamed.name}` : undefined),
  }
  // Per role, not for the object. A project can declare its own gap and none of the
  // rest, and a flag on the whole thing made the frame say its measured gap came from
  // somewhere else — which is the one sentence in that file that must be exact.
  const borrowedRoles = Object.fromEntries(
    ['gap', 'padding', 'muted'].map(k => [k, Boolean(!measured[k] && borrowed[k])]),
  )
  return {
    ...measured,
    ...borrowed,
    borrowed: borrowedRoles,
    fromProfile: Object.values(borrowedRoles).some(Boolean),
  }
})()

// What shape the screens here are.
//
// Measured from what a screen RETURNS rather than from what it imports, because a
// screen importing six layouts is shaped by the one it renders. The pair — which
// shell, and which of its regions are filled — is the archetype: on one real product
// `Scene(icon+title)` is seventeen screens and `Scene(title)` is seven, and the
// difference between them is a title bar with an icon in it.
//
// The generator used to take only the shell and pass the props the shell would not
// compile without. That produced a screen wrapped in the right frame with none of the
// frame filled in: correct, and unlike every neighbour it sits beside.
// What each frame in this repository declares, so the regions a screen fills are
// read from the frame's own type rather than guessed from the attribute names. The
// generator was running the inferred half of that alone, which is how `TableRow`
// and `Link` could come back as the shape to copy.
const frameIndex = (() => {
  const byName = new Map()
  for (const f of tsxFiles) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    const base = basename(f).replace(/\.(component\.ts|[jt]sx?|vue|svelte)$/, '')
    if (/^[A-Z]/.test(base) && !byName.has(base)) byName.set(base, text)
    for (const m of text.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g)) {
      if (!byName.has(m[1])) byName.set(m[1], text)
    }
  }
  const cache = new Map()
  return (name) => {
    if (!cache.has(name)) cache.set(name, regionsDeclaredBy(byName.get(name)))
    return cache.get(name)
  }
})()

// The measured region vocabulary, if this installation has one.
//
// Loaded rather than hard-coded, and only used where the repository itself has
// nothing to copy. It is a record of what frames in other products offer — not a
// recommendation, and it never overrides a shape measured here.
const REGION_VOCABULARY = (() => {
  const at = join(root, 'catalogue', 'regions.json')
  if (!existsSync(at)) return undefined
  try {
    const v = JSON.parse(readFileSync(at, 'utf8'))
    const counted = (v.measuredOn ?? []).filter(p => p.counted !== false)
    const of = counted.length
    const all = v.regions ?? []
    const top = all.filter(r => r.products > 1).slice(0, 8)
    return top.length && of > 1
      ? { of, top, all, names: counted.map(p => p.name).join(', ') }
      : undefined
  } catch { return undefined }
})()

const archetype = (() => {
  const measured = archetypes(sources.map(s => ({ file: s.path, text: s.text })), frameIndex)
  if (!measured.screens || !measured.dominant) {
    // Nothing to copy. Reported rather than silently replaced by a default, and the
    // partition says which kind of nothing: a repository whose screens all build
    // their own page has made a decision, and one where no screen could be read has
    // not.
    // `laysOutOwn` survives: whether screens here write their own layout is answered
    // by every screen, framed or not, and it is the one question a repository with
    // no frame can still answer.
    return { none: true, measured, laysOutOwn: measured.declaresOwnLayout, arrangement: measured.arrangement }
  }
  return {
    measured,
    signature: measured.dominant.name,
    count: measured.dominant.count,
    share: measured.dominant.count / measured.screens,
    of: measured.screens,
    // The regions the dominant archetype fills, which is what makes a new screen
    // look like the ones already here rather than merely compile beside them.
    regions: shellOf(
      sources.find(s => measured.dominant.examples.includes(s.path))?.text ?? '',
    )?.regions ?? [],
    alternatives: measured.signatures.slice(1, 4).map(x => `${x.name} ×${x.count}`),
    // Whether screens here arrange themselves or leave it to the frame. Always
    // writing a layout is right in a project where most screens do and wrong in one
    // where most do not, and both exist: measured at 0%, 41% and 41% on three real
    // products.
    laysOutOwn: measured.declaresOwnLayout,
    arrangement: measured.arrangement,
  }
})()

// Follow the majority, and say how strong it is. A screen that writes its own flex
// column into a project where no screen writes one is a file that looks generated
// from the first line.
// The contract wins, as it does everywhere else here. A team that agreed on
// co-located stylesheets gets one even where the screens on disk have none — that
// disagreement is what a decision IS, and overriding it with a measurement would
// make the agreed contract the weaker of the two.
const writeOwnLayout = required('styling')
  ? true
  : archetype ? archetype.laysOutOwn.share >= 0.5 : true

const skeleton = {
  screenDir: relative(REPO, screenDir).split(sep).join('/'),
  cssBeside: majority(sources.map(s => existsSync(s.path.replace(/\.tsx$/, '.css')) ? 'yes' : 'no')),
  cssImportFirst: (() => {
    const measured = majority(sources.map(s => /^import ['"]\.\/[^'"]+\.css['"]/m.test(s.text.split('\n')[0]) ? 'yes' : 'no'))
    // The one lever this generator has over the styling dimension: importing the
    // stylesheet at the top of the module is what makes the signal read
    // "plain co-located CSS" instead of "className, styles elsewhere". Where the
    // contract asks for one of those two, it decides; the other four buckets are
    // refused above rather than approximated here.
    const rule = required('styling')
    if (rule?.expect === 'plain co-located CSS') return { value: 'yes', share: rule.share ?? 0, measured: false, fromContract: true }
    if (rule?.expect === 'className, styles elsewhere') return { value: 'no', share: rule.share ?? 0, measured: false, fromContract: true }
    return measured
  })(),
  // Asked on the axis the framework actually has. Running the React test over Vue
  // sources found no `export default` in any of them and answered "named 100%" — a
  // confident number about a question a single-file component does not have.
  // A Svelte file exports no component, so there is nothing to measure and nothing
  // to follow — the dimension is left unmeasured rather than given a value.
  exportStyle: EXT === '.svelte' ? { value: undefined, share: 0, measured: false }
    : EXT === '.component.ts' ? decided('component export', majority(sources.map(s => {
      const decorator = /@Component\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(s.text)?.[1] ?? ''
      if (/standalone\s*:\s*false/.test(decorator)) return 'NgModule declaration'
      if (/standalone\s*:\s*true/.test(decorator)) return 'standalone'
      return 'standalone by default'
    })))
    : decided('component export', EXT === '.vue'
    ? majority(sources.map(s => /<script[^>]*\bsetup\b/.test(s.text) ? 'script setup'
      : /defineComponent\s*\(/.test(s.text) ? 'defineComponent'
      : /export default\s*\{/.test(s.text) ? 'Options API' : undefined).filter(Boolean))
    : majority(sources.map(s => /export default/.test(s.text) ? 'default' : 'named'))),
  i18n: majority(sources.map(s => /useTranslation\(/.test(s.text) ? 'yes' : 'no')),
  handler: decided('handler naming', majority(sources.flatMap(s => {
    const handle = (s.text.match(/const handle[A-Z]/g) ?? []).length
    const on = (s.text.match(/const on[A-Z]/g) ?? []).length
    return handle === 0 && on === 0 ? [] : [handle > on ? 'handleX' : 'onX']
  }))),
  dsPrefix,

  // How a screen here gets its data. salim seeds local state from a mock module;
  // another project uses a query client. Copying the wrong one produces a screen
  // that compiles and fetches nothing.
  data: (() => {
    const usesQuery = sources.some(s => /useQuery|useSWR/.test(s.text))
    const usesMock = sources.some(s => /MOCK_[A-Z_]+/.test(s.text))
    return usesQuery ? 'query-hook' : usesMock ? 'local-state-from-mock' : 'local-state'
  })(),

  // Where the query hook is imported from, counted across the screens here.
  //
  // The generator wrote `useScreenData()` — a name nothing declares, nothing imports
  // and nothing flagged. The file could not compile and the report said the gate found
  // no violations, which is true and reads as approval. Which hook a project uses is
  // measurable: on one real product 51 screens import it from `@documenso/trpc/react`
  // and two from `@tanstack/react-query`. WHICH query to call is a decision about this
  // screen and stays a placeholder — a named one, reported.
  queryFrom: (() => {
    const tally = new Map()
    for (const s of sources) {
      if (!/\buseQuery\b/.test(s.text)) continue
      for (const m of s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        if (!/\buseQuery\b/.test(m[1])) continue
        tally.set(m[2], (tally.get(m[2]) ?? 0) + 1)
      }
    }
    // The other shape, which is the majority one on a tRPC project: a client is
    // imported and the hook hangs off a route — `trpc.document.find.useQuery()`. It
    // cannot be written without the route name, which is the decision being left to a
    // person, so it is reported rather than used. Saying "2 screens" while 51 do it
    // another way is half a truth.
    const viaClient = new Map()
    for (const src of sources) {
      for (const m of src.text.matchAll(/\b([a-z]\w*)\.[\w.]*useQuery\b/g)) {
        viaClient.set(m[1], (viaClient.get(m[1]) ?? 0) + 1)
      }
    }
    const client = [...viaClient].sort((a, b) => b[1] - a[1])[0]
    const clientModule = client && (() => {
      for (const src of sources) {
        const m = new RegExp(`import\\s*\\{[^}]*\\b${client[0]}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`).exec(src.text)
        if (m) return m[1]
      }
      return undefined
    })()

    const ranked = [...tally].sort((a, b) => b[1] - a[1])
    const bare = ranked.length && ranked[0][1] >= 2 ? { module: ranked[0][0], uses: ranked[0][1] } : undefined
    return (bare || client)
      ? { ...(bare ?? {}), viaClient: client ? { name: client[0], uses: client[1], module: clientModule } : undefined }
      : undefined
  })(),

  // The test harness, read from a real test rather than assumed. Getting the a11y
  // helper's import path wrong produces a test file that cannot even be collected.
  test: (() => {
    const testFiles = tsxFiles.filter(f => /\.test\.tsx$/.test(f)).map(f => ({ path: f, text: readFileSync(f, 'utf8') }))
    if (!testFiles.length) return undefined
    const sample = testFiles.find(t => /a11yViolations|toHaveNoViolations/.test(t.text)) ?? testFiles[0]
    return {
      framework: /from 'vitest'/.test(sample.text) ? 'vitest' : 'jest',
      router: /MemoryRouter/.test(sample.text),
      userEvent: /@testing-library\/user-event/.test(sample.text),
      // Resolved to an absolute path here and made relative to the generated file
      // later. A relative specifier copied from a test two directories deeper
      // points at nothing from where this screen lives.
      a11yHelperFrom: sample.path,
      // A screen here renders inside six providers. This repository wrapped that
      // once in a helper rather than repeating it per file, and a generated test
      // that calls render() directly dies on the first context it needs.
      screenHelper: (() => {
        const screenTest = testFiles.find(t => /renderScreen|renderWithProviders/.test(t.text))
        if (!screenTest) return undefined
        const match = screenTest.text.match(/import \{ (renderScreen|renderWithProviders) \} from '([^']+)'/)
        return match ? { name: match[1], specifier: match[2], from: screenTest.path } : undefined
      })(),
      a11yHelper: (sample.text.match(/import \{ (a11yViolations) \} from '([^']+)'/) ?? [])[2],
      count: testFiles.length,
    }
  })(),

  // What wraps a screen here. Rendering a bare div failed this repository's own
  // accessibility test with `region` — content outside any landmark — because the
  // landmark lives in the shell every other screen is wrapped in.
  shell: (() => {
    const wrappers = sources
      .map(s => EXT === '.component.ts'
        // The template is a file beside the class, so the wrapper is looked for
        // there rather than in the class body.
        ? (() => {
            const decorator = /@Component\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(s.text)?.[1] ?? ''
            const inline = /template\s*:\s*`([\s\S]*?)`/.exec(decorator)?.[1]
            let markup = inline
            if (markup === undefined) {
              const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(decorator)?.[1]
              const at = url ? join(dirname(s.path), url) : undefined
              markup = at && existsSync(at) ? readFileSync(at, 'utf8') : ''
            }
            // An application shell is a custom element; a raw tag is not one.
            return (/<((?:app|ui|ds)-[\w-]+)/.exec(markup) ?? [])[1]
          })()
        : EXT === '.svelte'
        // Svelte has no template element: the first capitalised element after the
        // script and style blocks is what wraps a screen here.
        ? (/^\s*<([A-Z][\w-]*)/m.exec(s.text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')) ?? [])[1]
        : EXT === '.vue'
        // The first element inside <template> is what wraps a screen here; a Vue
        // component has no `return (` to match on, so the React pattern found none
        // and every generated screen emitted its own <main>, producing two.
        ? (/<template[^>]*>\s*<([A-Z][\w-]*)/.exec(s.text) ?? [])[1]
        : (s.text.match(/return \(\s*<([A-Z]\w+)/) ?? [])[1])
      .filter(Boolean)
    if (!wrappers.length) return undefined
    const top = majority(wrappers)
    return top.share >= 0.4 ? { component: top.value, share: top.share } : undefined
  })(),

  routes: (() => {
    const app = tsxFiles.find(f => /App\.tsx$/.test(f))
    if (!app) return undefined
    const text = readFileSync(app, 'utf8')
    const constants = tsxFiles.concat(walk(SOURCE_ROOT).filter(f => /routes\.ts$/.test(f)))
      .find(f => /routes\.ts$/.test(f))
    return {
      file: relative(REPO, app).split(sep).join('/'),
      guard: (text.match(/<Route path=\{ROUTES\.\w+\}\s+element=\{<(\w+)>/) ?? [])[1],
      constantsFile: constants ? relative(REPO, constants).split(sep).join('/') : undefined,
    }
  })(),
}

// ── Resolve the spec into components ──────────────────────────────────────────

const parseElement = (text) => {
  const [role, ...rest] = text.trim().split(/\s+/)
  const props = {}
  for (const pair of rest) {
    const eq = pair.indexOf('=')
    if (eq === -1) props[pair] = true
    else props[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return { role, props }
}

const zones = []
const unresolved = []
for (const zone of spec.zones ?? []) {
  const items = []
  for (const text of zone.elements ?? []) {
    const { role, props } = parseElement(text)
    const bound = binding.roles[role]
    if (!bound || bound.notCovered) { unresolved.push(`${zone.name}/${role}`); continue }
    const applied = { ...bound.props }
    for (const [axis, value] of Object.entries(props)) {
      const rule = bound.axes?.[axis] ?? binding.axes?.[axis]
      const translated = rule?.values?.[value]
      if (translated !== undefined) applied[rule.prop] = translated
    }
    items.push({ role, component: bound.component, props: applied })
  }
  zones.push({ ...zone, items })
}

if (unresolved.length) {
  console.error(`build-screen: the spec is not buildable on ${PROFILE}: ${unresolved.join(', ')}`)
  console.error('Run validate-spec first; a screen is not generated from a spec that does not check out.')
  process.exit(1)
}

// ── Emit, in the measured shape ───────────────────────────────────────────────

// The landmark belongs to whichever level owns it. This repository's shell already
// renders <main>, so a screen adding its own produced two nested mains — a
// violation in the other direction, and one the first version could not see
// because it never rendered inside the shell at all.
// The hooks the emitted body actually calls. Writing `useState` without importing
// it produced a screen that passed the conventions gate — which checks house style
// and the registry, not compilation — and died on first render.
const reactHooks = skeleton.data === 'query-hook' ? [] : ['useState']

// The component's name.
//
// Built from the spec id, which for a drafted spec is the whole requirement
// sentence truncated to forty characters — so a page listing archived memos
// became `APageListingArchivedMemosWithASeaPage`, cut mid-word. A name is the
// first thing anyone reads, and one like that says the file was not written by
// anybody.
//
// Articles, prepositions and the filler a requirement sentence is made of are
// dropped, and what remains is capped at four words.
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'showing',
  'shows', 'show', 'that', 'which', 'this', 'page', 'screen', 'view', 'listing', 'lists'])
// Angular names a class for what it is. `ArchivedMemosSeaPage` in a codebase where
// every other class ends in `Component` is a file that announces it was generated.
const SUFFIX = FRAMEWORK === 'angular' ? 'Component' : 'Page'
const name = (() => {
  const explicit = spec.name ?? spec.componentName
  if (explicit) return new RegExp(`${SUFFIX}$|Page$|Screen$|View$`).test(explicit) ? explicit : explicit + SUFFIX
  const words = spec.id.split('-').filter(Boolean).filter(w => !FILLER.has(w.toLowerCase()))
  const kept = (words.length ? words : spec.id.split('-').filter(Boolean)).slice(0, 4)
  return kept.map(p => p[0].toUpperCase() + p.slice(1)).join('') + SUFFIX
})()

// `ArchivedMemosSeaComponent` → `archived-memos-sea.component`, which is what the
// CLI would have called it and what every sibling file is called.
const fileBase = `${name.replace(/Component$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.component`

const shellName = skeleton.shell?.component

// Props the shell will not render without.
//
// Wrapping in AuthPageLayout without them produced `Property 'title' is missing`
// — the screen matched this repository's shape and did not compile. The required
// names come from the shell's own Props type; the values come from how the
// existing screens pass them, so the placeholder is at least the right kind of
// thing rather than an invented string.
/** The declared type of one prop on a component, wherever it declares its props. */
const propTypeOf = (text, prop) =>
  new RegExp(`\\b${prop}\\s*\\??\\s*:\\s*([^;,\\n)}]+)`).exec(text)?.[1]?.trim()

const shellProps = (() => {
  if (!shellName) return ''
  const file = tsxFiles.find(f => basename(f, EXT) === shellName)
    ?? tsxFiles.find(f => basename(f, '.tsx') === shellName)
    ?? tsxFiles.find(f => new RegExp(`(interface|type)\\s+Props\\b`).test(readFileSync(f, 'utf8')) && basename(f).includes(shellName))
  if (!file) return ''
  const text = readFileSync(file, 'utf8')

  // Svelte declares props in the script, not in a Props type: `export let title:
  // string` through version 4 and `let { title } = $props()` from 5. Reading only a
  // `Props` interface found none of them, so the generated screen wrapped a shell
  // that requires a title and passed none — `Property 'title' is missing`, on a file
  // this tool had just reported as conforming.
  const required = EXT === '.svelte'
    ? (() => {
        const script = (text.match(/<script[^>]*>([\s\S]*?)<\/script>/g) ?? []).join('\n')
        const legacy = [...script.matchAll(/^\s*export\s+let\s+(\w+)(\s*:\s*([^=;\n]+))?(\s*=)?/gm)]
          // A default makes it optional, and passing a placeholder over a default the
          // component already chose is noise in every generated file.
          .filter(m => !m[4])
          .map(m => ({ name: m[1], type: (m[3] ?? 'unknown').trim() }))
        const runes = [...(/\{([^}]*)\}\s*(?::\s*([^=]+))?=\s*\$props\(\)/.exec(script)?.[1] ?? '')
          .split(',').map(x => x.trim()).filter(Boolean)]
          // A destructured default is optional for the same reason.
          .filter(x => !x.includes('='))
          .map(x => ({ name: x.split(':')[0].trim(), type: 'unknown' }))
        return [...legacy, ...runes].filter(p => p.name !== 'children')
      })()
    : (() => {
        const propsBlock = /(?:interface\s+\w*Props\s*(?:extends[^{]+)?|type\s+\w*Props\s*=)\s*\{([\s\S]*?)\n\}/.exec(text)?.[1]
        if (!propsBlock) return undefined
        return [...propsBlock.matchAll(/^\s*(\w+)\s*:\s*([^;\n]+)/gm)]
          .filter(m => m[1] !== 'children')
          .map(m => ({ name: m[1], type: m[2].trim() }))
      })()
  if (!required) return ''
  // Two different questions, and only the first was being answered.
  //
  //   what will not compile without a value  — the shell's own required props
  //   what this project actually fills       — the regions of the dominant archetype
  //
  // A screen wrapped in the right shell with none of its regions filled compiles and
  // looks nothing like its neighbours: every other page here has a title bar and this
  // one has an empty frame.
  // A Svelte prop the shell renders with `{@render x()}` is a snippet, and a snippet
  // is passed as `{#snippet x()}…{/snippet}` rather than as a value. This filled it
  // with the spec's goal sentence — `<PageShell actions="Find a document and open
  // it.">` — and the component died at runtime with `snippet is not a function`,
  // on a file the conventions gate had just approved.
  const snippets = new Set([...text.matchAll(/\{@render\s+(\w+)/g)].map(m => m[1]))
  const declared = new Map(required.map(p => [p.name, p]))
  const filled = (archetype?.regions ?? [])
    .filter(r => !declared.has(r) && r !== 'children' && !snippets.has(r))
    .map(r => ({ name: r, type: propTypeOf(text, r) ?? 'unknown', fromArchetype: true }))

  // What the screens here actually pass into each region, rather than what its type
  // permits. `title` is typed `ReactNode` on this shell and every screen passes a
  // plain string into it — so `title={null}` was type-correct, produced a page with an
  // empty header bar, and made the generated screen the only one in the project
  // without a heading.
  const passedHere = (region) => {
    const shapes = new Map()
    for (const src of sources) {
      for (const m of src.text.matchAll(new RegExp(`\\b${region}\\s*=\\s*(\{|["'])`, 'g'))) {
        shapes.set(m[1] === '{' ? 'expression' : 'string', (shapes.get(m[1] === '{' ? 'expression' : 'string') ?? 0) + 1)
      }
    }
    const ranked = [...shapes].sort((a, b) => b[1] - a[1])
    return ranked.length ? ranked[0][0] : undefined
  }

  return [...required, ...filled].filter(p => !snippets.has(p.name)).map(p => {
    if (/ReactNode|JSX\.Element/.test(p.type)) {
      if (passedHere(p.name) !== 'string') return ` ${p.name}={null}`
      // Fall through to the readable name below: this project fills this region with
      // text, and an empty one would be the only screen here without it.
    } else
    if (/^boolean$/.test(p.type)) return ` ${p.name}={false}`
    else if (/^number$/.test(p.type)) return ` ${p.name}={0}`
    else if (/=>/.test(p.type)) return ` ${p.name}={() => {}}`
    // Never the raw goal: a drafted spec's title is the requirement sentence
    // truncated mid-word, and it ends up rendered on the page.
    const words = (spec.title ?? spec.goal ?? '').split(/\s+/).filter(Boolean)
    const readable = words.length && words.length <= 6 ? words.join(' ') : name.replace(/Page$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
    return ` ${p.name}="${readable}"`
  }).join('')
})()

const shellOpen = shellName ? `<${shellName}${shellProps}>\n    ` : ''
const shellClose = shellName ? `\n    </${shellName}>` : ''
const container = shellName ? 'div' : 'main'

// Derived from the cleaned name, not from the raw spec id. The id of a drafted
// spec is the requirement sentence truncated at forty characters, and the same
// cut that produced `APageListingArchivedMemosWithASeaPage` was still going into
// the markup and the stylesheet as `.a-page-listing-archived-memos-with-a-sea`
// after the component name had been fixed. Half a fix reads as no fix to whoever
// opens the CSS.
const cssClass = name.replace(/Page$|Component$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

// How this project arranges a container, where it arranges them with utility classes.
//
// Measured over the screens already here, never assumed: on one real product `gap-2`
// is written 36 times against `gap-4`'s fewer, and which of those is the house answer
// is a fact about that repository rather than about Tailwind.
const utilityIdiom = utilities(sources.map(x => ({ text: x.text })))
const writesUtilities = (required('styling')?.expect ?? skeleton.styling?.value) === 'utility classes'
const rootClass = writesUtilities ? (containerClasses(utilityIdiom) ?? cssClass) : cssClass
const zoneClass = (zoneName) => writesUtilities
  ? (zoneClasses(utilityIdiom) ?? `${cssClass}__${zoneName}`)
  : `${cssClass}__${zoneName}`

const shellEntry = shellName
  ? (components[shellName] ?? Object.values(components).find(c => c?.selector === shellName))
  : undefined

// The shell belongs in the import list too, whenever the registry holds it.
//
// The branch below imports a shell that is NOT a registry component, on the reasoning
// that a registry one is handled by the loop over `used`. But `used` is the components
// the spec's zones name, and a shell is not a zone — so a shell that happens to be in
// the registry was imported by nobody. The generated screen rendered `<PageShell>`
// with no import for it: a file that does not run, reported as conforming.
const used = [...new Set([
  ...zones.flatMap(z => z.items.map(i => i.component)),
  ...(shellName && shellEntry !== undefined
    ? [Object.keys(components).find(k => components[k] === shellEntry) ?? shellName]
    : []),
])].sort()
const importLines = []
// Declared here rather than beside the registry loop: the shell's import is found
// earlier than that, and a `let` below the assignment is a dead zone, not a variable.
let shellImport
if (skeleton.cssImportFirst.value === 'yes' && writeOwnLayout) importLines.push(`import './${name}.css'`)
const missingImports = []
// The registry entry for the shell, which on Angular is keyed by a readable name and
// referred to in the template by its selector. Looking it up by the template's name
// found nothing, so the shell went down the "not a registry component" path and was
// imported under its selector: `import { ds-page-shell }`, which is not an identifier.
if (shellName && shellEntry === undefined) {
  // The shell is an application component, not a system one, so it is imported
  // the way the other screens here import it — including the form of the import.
  // Matching only `import { X } from` emitted a screen that used AuthPageLayout
  // and never imported it, because memos exports it by default. That is the same
  // blindness to default exports that made the composition pass report a
  // well-composed screen as raw markup.
  // The whole clause is read rather than matched against two shapes, because
  // memos writes `import AuthPageLayout, { AuthChip } from "@/components/..."` —
  // default and named together, which neither shape covers. The result was a
  // screen that used the shell and never imported it, and tsc caught what the
  // conventions gate could not.
  const found = (() => {
    for (const s of sources) {
      for (const m of s.text.matchAll(/import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
        const clause = m[1].replace(/\btype\s+/g, '')
        const named = (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',').map(x => x.trim().split(/\s+as\s+/).pop()?.trim())
        const byDefault = clause.replace(/\{[^}]*\}/, '').split(',')[0].trim()
        if (byDefault === shellName) return { from: m[2], form: 'default' }
        if (named.includes(shellName)) return { from: m[2], form: 'named' }
      }
    }
    return undefined
  })()
  if (found) {
    // Same rule for the shell. `skeleton.shell.component` is what the template
    // writes, and on Angular that is a selector — `import { ds-page-shell }` is not
    // an identifier, and the file did not parse.
    const shellIdentifier = shellEntry?.className ?? shellName
    importLines.push(found.form === 'named'
      ? `import { ${shellIdentifier} } from '${found.from}'`
      : `import ${shellIdentifier} from '${found.from}'`)
    // Recorded structurally as well. Handing the Vue emitter only the registry
    // components emitted a template using <AppShell> with no import for it — the
    // same defect that was fixed on the React path, reappearing in the second
    // emitter because the fix lived in a string array the second one never read.
    shellImport = { what: shellEntry?.className ?? shellName, from: found.from, byDefault: found.form !== 'named' }
  } else {
    missingImports.push(shellName)
  }
}
if (skeleton.i18n.value === 'yes') importLines.push("import { useTranslation } from 'react-i18next'")
// Whether an import specifier names something that exists in this repository.
//
// The generator resolved `Badge` and `SearchInput` from the profile and wrote
// `import { Badge } from "@/Badge"` into memos, which has neither — then reported
// that the screen conforms, because the conventions gate checks house style and
// not whether a module is there. tsc said otherwise in four lines.
//
// This is the honest boundary of building with a profile the project has not
// adopted, and it belongs in the output rather than in the client's first build.
const aliasRoots = (() => {
  const roots = new Map()
  for (const file of ['tsconfig.json', 'tsconfig.app.json', 'vite.config.ts', 'vite.config.mts']) {
    const at = join(REPO, file)
    if (!existsSync(at)) continue
    const text = readFileSync(at, 'utf8')
    for (const m of text.matchAll(/["']([^"']+?)\/?\*?["']\s*:\s*\[?\s*["']\.?\/?([^"'*]*)\*?["']/g)) {
      if (m[1].includes('/') && !m[1].startsWith('@')) continue
      roots.set(m[1].replace(/\/\*$/, ''), m[2].replace(/\/$/, ''))
    }
  }
  return roots
})()

/**
 * Whether this repository's own code already imports that specifier.
 *
 * The strongest evidence there is, and it needs no resolver. `@documenso/ui/primitives/input`
 * is a workspace sibling: it exists on disk two directories up, 115 files in that
 * project import it, and it is not under `node_modules` because the clone has not had
 * `npm install` run. The resolver said "no such module in this repository" about a
 * module that repository uses 115 times — a false alarm at the one moment the tool is
 * telling a client that generated code will not compile.
 */
const alreadyImportedHere = (() => {
  const seen = new Set()
  for (const f of tsxFiles) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const m of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) seen.add(m[1])
  }
  return (specifier) => seen.has(specifier)
})()

const resolvesHere = (specifier) => {
  if (alreadyImportedHere(specifier)) return true
  if (!specifier.startsWith('.') && !specifier.startsWith('@') && !specifier.startsWith('~')) {
    return existsSync(join(REPO, 'node_modules', specifier))
      || existsSync(join(REPO, '..', '..', 'node_modules', specifier))
  }
  // A scoped package that is a sibling in the same workspace. `@scope/pkg/path` lives
  // at `packages/pkg/path` above the app, and no amount of looking inside the app
  // finds it.
  if (specifier.startsWith('@') && specifier.includes('/')) {
    const withoutScope = specifier.split('/').slice(1).join('/')
    for (const up of ['..', join('..', '..'), join('..', '..', '..')]) {
      for (const dir of ['packages', 'libs', 'modules']) {
        const at = join(REPO, up, dir, withoutScope)
        if (['', '.tsx', '.ts', '/index.tsx', '/index.ts'].some(ext => existsSync(at + ext))) return true
      }
    }
  }
  const alias = [...aliasRoots.keys()].find(a => specifier === a || specifier.startsWith(a + '/'))
  const rest = alias ? specifier.slice(alias.length).replace(/^\//, '') : specifier.replace(/^[.~/]+/, '')
  const base = alias ? join(REPO, aliasRoots.get(alias), rest) : join(REPO, 'src', rest)
  return ['', '.tsx', '.ts', '.jsx', '.js', '.vue', '/index.tsx', '/index.ts', '/index.vue'].some(ext => existsSync(base + ext))
}

const missingModules = []
const importSpecs = []
for (const component of used) {
  const entry = components[component]

  // The profile's own specifier first, whenever it points at something that is
  // actually here. Rewriting it through the alias measured from the screens is
  // for the case where the library sits behind a different name in the consuming
  // app — and applying it unconditionally turned `@/components/ui/badge`, which
  // was extracted from this very repository, into `@/Badge`, which is nowhere.
  const viaAlias = `${skeleton.dsPrefix}/${component}`
  const declared = entry?.from
  const from = declared && resolvesHere(declared) ? declared
    : dsImportsAreScoped && declared?.startsWith('@/') ? viaAlias
    : declared ?? viaAlias

  // How the library exports it, not how this generator would prefer to.
  //
  // And under what name. Angular reaches a component by its selector in a template
  // and by its class in an import; the registry is keyed by a readable name derived
  // from the selector, and using that key as the identifier wrote
  // `import { DsAvatar } from '…'` for a class called `DsAvatarComponent`.
  const named = entry?.exportedAs !== 'default'
  const identifier = entry?.className ?? component
  importLines.push(named
    ? `import { ${identifier} } from '${from}'`
    : `import ${identifier} from '${from}'`)
  // The same facts, structured, so a second emitter does not have to parse the
  // strings the first one built.
  importSpecs.push({ what: identifier, from, byDefault: !named })
  if (!resolvesHere(from)) missingModules.push({ component, from })
}

const attrs = (props) => Object.entries(props)
  .map(([k, v]) => v === true ? ` ${k}` : ` ${k}="${v}"`).join('')

// Props the component will not compile without.
//
// The registry records which props are required — 127 of them in the first-party
// profile alone — and the emitter read that field for the page shell and for
// nothing else. Every component resolved from the spec went out self-closing, so
// `<DataTable />` shipped without the `rows` it declares, and the screen that
// "conforms to this repository's conventions" did not compile. The gate checks
// house style; house style has no opinion about a missing prop.
//
// A placeholder is not the real value and does not pretend to be. It is the right
// SHAPE, so the file compiles and the one thing left to do is visible as a value
// to replace rather than as an error to decode.
// The value and whether it is an expression, kept apart from how a framework spells
// it. Returning `'{[]}'` here meant the Vue emitter wrote `rows={[]}` into a
// template — JSX syntax in a file that is not JSX, and it does not parse.
const placeholder = (type = '') => {
  if (/ReactNode|JSX\.Element|ReactElement/.test(type)) return { value: 'null', expression: true }
  if (/\[\]$|^Array</.test(type)) return { value: '[]', expression: true }
  if (/^boolean$/.test(type)) return { value: 'false', expression: true }
  if (/^number$/.test(type)) return { value: '0', expression: true }
  if (/=>/.test(type)) return { value: '() => {}', expression: true }
  if (/^Record<|^\{/.test(type)) return { value: '{}', expression: true }
  // A union of string literals has to be one of them; anything else is free text.
  const literal = /^'([^']+)'/.exec(type)
  return { value: literal ? literal[1] : '', expression: false }
}

/** Every attribute an element needs, as values rather than as syntax. */
const propsFor = (item) => [
  ...Object.entries(item.props).map(([name, v]) =>
    v === true ? { name, value: 'true', expression: false, bare: true } : { name, value: String(v), expression: false }),
  ...(components[item.component]?.props ?? [])
    .filter(p => p.required && p.name !== 'children' && item.props[p.name] === undefined)
    .map(p => ({ name: p.name, ...placeholder(p.type) })),
]

const jsxAttrs = (item) => propsFor(item)
  .map(p => p.bare ? ` ${p.name}` : p.expression ? ` ${p.name}={${p.value}}` : ` ${p.name}="${p.value}"`).join('')

// A component that takes children gets a label; one that does not is left
// self-closing. Emitting children into a component that has none would not
// compile, and inventing props the registry does not list is the exact failure
// this whole arrangement exists to prevent.
const takesChildren = (component) => Boolean(components[component]?.props?.some(p => p.name === 'children'))
const usesI18n = skeleton.i18n.value === 'yes'
const label = (role) => usesI18n ? `{t('${spec.id}.${role}')}` : role

const zoneMarkup = zones.map(zone => {
  const inner = zone.items.map(item => {
    const all = jsxAttrs(item)
    return takesChildren(item.component)
      ? `        <${item.component}${all}>${label(item.role)}</${item.component}>`
      : `        <${item.component}${all} />`
  }).join('\n')
  return `      {/* ${zone.purpose} */}\n      <section className="${zoneClass(zone.name)}" aria-label="${zone.name}">\n${inner}\n      </section>`
}).join('\n\n')

const anyLabel = zones.some(z => z.items.some(i => takesChildren(i.component)))

const statesComment = Object.entries(spec.states ?? {})
  .map(([state, text]) => ` *   ${state}: ${text}`).join('\n')

// States as branches, not as a comment. A screen whose empty case is described in
// prose above the component is a screen with no empty case: the description does
// not render, and the first user to arrive with no data sees the loading frame.
const emptyRole = zones.flatMap(z => z.items).find(i => i.role === 'emptyState')
// A loading, failed or empty screen still has the application's chrome around it.
// Returning early from above the shell dropped the landmark exactly in the state
// the accessibility test renders, so the screen failed for being empty rather
// than for being wrong.
//
// Written as early returns rather than nested ternaries. The ternary version read
// fine and was rejected by the stricter of two repositories this was tried in —
// sonarjs forbids nesting them — and a generator whose output the project's own
// linter refuses has not written in that project's idiom, whatever it looks like.
const stateBody = `
  const state = resolveState()

  function resolveState() {
    if (loading) return { key: 'loading', message: ${usesI18n ? `t('${spec.id}.loading')` : "'Loading…'"} }
    if (error) return { key: 'error', message: ${usesI18n ? `t('${spec.id}.error')` : "'Something went wrong.'"} }
    if (items.length === 0) return { key: 'empty', message: ${usesI18n ? `t('${spec.id}.empty')` : "'Nothing here yet.'"} }
    return undefined
  }
`

const dataHook = skeleton.data === 'query-hook'
  ? `  /* TODO — the one thing measurement cannot supply: which query this screen makes.
   * Everything else in this file was read from this repository. Point this at the
   * real endpoint; the three branches below do not change.
   */
  const { data: items = [], isLoading: loading, error } = useQuery(SCREEN_QUERY)`
  : `  /* Local state seeded from a data module, which is how screens here get their
   * data today. Replace the seed with the real source; the three branches below
   * do not change. */
  const [items] = useState<Row[]>([])
  const loading = false
  const error = null`

// The css import stays first where that is the house rule; the React import goes
// after it rather than before.
const cssFirst = skeleton.cssImportFirst.value === 'yes' ? importLines.slice(0, 1) : []
const rest = skeleton.cssImportFirst.value === 'yes' ? importLines.slice(1) : importLines
// The query hook is imported from wherever this project imports it, so the only thing
// left undeclared is the query itself — which is named, commented and reported below.
if (skeleton.data === 'query-hook' && skeleton.queryFrom?.module) {
  importLines.push(`import { useQuery } from '${skeleton.queryFrom.module}'`)
}

const allImports = [
  ...cssFirst,
  ...reactHooks.length ? [`import { ${reactHooks.join(', ')} } from 'react'`] : [],
  ...rest,
]

const body = `${allImports.filter(l => !(l.includes('react-i18next') && !(usesI18n && anyLabel))).join('\n')}

/* Generated from ${basename(specPath)} against the ${PROFILE} profile.
 * Zones, components and props come from the agreed spec; the file's shape is
 * this repository's own, measured from ${screens.length} existing screens.
 *
 * Agreed states:
${statesComment || ' *   none specified'}
${exemplars?.caution?.length ? ` *
 * Written against these measured shortfalls rather than with them:
${exemplars.caution.map(c => ` *   ${c.pattern} — ${c.measured}`).join('\n')}` : ''}
 */

type Row = { id: string }

${skeleton.exportStyle.value === 'default' ? 'export default function' : 'export function'} ${name}() {${usesI18n && anyLabel ? '\n  const { t } = useTranslation()' : ''}
${dataHook}
${stateBody}
  return (
    ${shellOpen}<${container} className="${rootClass}">
      {state ? (
        <p${writesUtilities ? '' : ` className="${cssClass}__state"`} {...(state.key === 'error' ? { role: 'alert' } : {})}>{state.message}</p>
      ) : (
        <>
${zoneMarkup}
        </>
      )}
    </${container}>${shellClose}
  )
}
`

// The helper's location, expressed from where the new test will sit.
const a11yImport = (() => {
  if (!skeleton.test?.a11yHelper || !skeleton.test.a11yHelperFrom) return undefined
  const resolved = join(dirname(skeleton.test.a11yHelperFrom), skeleton.test.a11yHelper)
  let path = relative(join(REPO, skeleton.screenDir), resolved).split(sep).join('/')
  if (!path.startsWith('.')) path = `./${path}`
  return path
})()

const helper = skeleton.test?.screenHelper
const helperImport = helper ? (() => {
  const resolved = join(dirname(helper.from), helper.specifier)
  let path = relative(join(REPO, skeleton.screenDir), resolved).split(sep).join('/')
  if (!path.startsWith('.')) path = `./${path}`
  return path
})() : undefined

// Angular puts a component in a folder of its own by default, and the file is named
// for the component rather than for the class.
const angularFolder = FRAMEWORK === 'angular'
  && (required('file structure')?.expect ?? skeleton.fileStructure?.value ?? 'Folder/name.component.ts') !== 'flat name.component.ts'
const targetDir = FRAMEWORK === 'angular' && angularFolder
  ? join(REPO, skeleton.screenDir, fileBase.replace(/\.component$/, ''))
  : join(REPO, skeleton.screenDir)
const targetTsx = FRAMEWORK === 'angular'
  ? join(targetDir, `${fileBase}.ts`)
  : join(REPO, skeleton.screenDir, `${name}${EXT}`)
const targetCss = FRAMEWORK === 'angular'
  ? join(targetDir, `${fileBase}.scss`)
  : join(REPO, skeleton.screenDir, `${name}.css`)
const targetTemplate = FRAMEWORK === 'angular' ? join(targetDir, `${fileBase}.html`) : undefined

// Where the test runner will actually collect it.
//
// The convention scan measured memos as co-locating tests, which is true of the
// files on disk, and the generator put one beside the screen. Their vitest config
// includes `tests/**/*.test.{ts,tsx}` and nothing else, so the test was written,
// was correct, and was never run — the quietest possible failure.
//
// The runner's configuration outranks the measured habit, because it is the thing
// that decides.
// What a test file is called here, measured from the ones that exist. A Vue project
// on `X.spec.ts` handed a `X.test.tsx` gets a file its runner does not collect —
// the same silent failure as putting it in the wrong directory.
const testSuffix = (() => {
  const found = walk(SOURCE_ROOT).concat(existsSync(join(REPO, 'tests')) ? walk(join(REPO, 'tests')) : [])
    .concat(readdirSync(REPO).includes('tests') ? [] : [])
  const names = []
  for (const dir of ['src', 'tests', 'test', '__tests__']) {
    const at = join(REPO, dir)
    if (!existsSync(at)) continue
    for (const f of walkAny(at)) {
      const m = /\.(test|spec)\.(tsx?|[jm]s)$/.exec(f)
      if (m) names.push(`.${m[1]}.${m[2]}`)
    }
  }
  // Each framework's own convention, where the project has written no test to copy.
  // `.test.tsx` was the fallback for everything that was not Angular or Vue, so a
  // Svelte project got a `.tsx` test for a `.svelte` component — a file the runner
  // collects and the compiler has no reason to accept.
  if (!names.length) {
    return FRAMEWORK === 'angular' ? '.spec.ts'
      : FRAMEWORK === 'vue' ? '.spec.ts'
        : FRAMEWORK === 'svelte' ? '.test.ts'
          : '.test.tsx'
  }
  const counts = {}
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
})()

const testPlacement = (() => {
  const configs = ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.js', 'vite.config.ts', 'vite.config.mts', 'jest.config.js', 'package.json']
    .map(f => join(REPO, f)).filter(existsSync)
  for (const config of configs) {
    const text = readFileSync(config, 'utf8')
    const include = /include\s*:\s*\[([^\]]*)\]/.exec(text)?.[1]
    if (!include) continue
    const globs = [...include.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]).filter(g => /test|spec/.test(g))
    if (!globs.length) continue
    // Co-location still wins when the globs allow it — the habit and the runner
    // agree, and the file belongs next to what it tests.
    const beside = relative(REPO, join(skeleton.screenDir, `${name}${testSuffix}`)).split(sep).join('/')
    const covers = (glob) => new RegExp('^' + glob
      .replace(/[.+^${}()|[\]\\]/g, (c) => '\\' + c)
      .replace(/\*\*\//g, '(.*/)?').replace(/\*\*/g, '.*')
      .replace(/\{([^}]*)\}/g, (m, g) => `(${g.split(',').join('|')})`)
      .replace(/\*/g, '[^/]*') + '$').test(beside)
    if (globs.some(covers)) return { at: join(REPO, skeleton.screenDir, `${name}${testSuffix}`), why: 'co-located, which this runner collects' }

    // Otherwise the first directory the globs name is where tests live here.
    const dir = globs[0].split('/').filter(p => !p.includes('*'))[0]
    if (dir) return { at: join(REPO, dir, `${name}${testSuffix}`), why: `${dir}/, because ${basename(config)} collects tests only from there` }
  }
  return { at: join(REPO, skeleton.screenDir, `${name}${testSuffix}`), why: 'beside the screen; no runner config named a different place' }
})()
// Angular names a spec after the file it tests and keeps it in the same folder,
// which is where the CLI puts it and where every sibling spec already is.
const targetTest = FRAMEWORK === 'angular'
  ? join(targetDir, `${fileBase}.spec.ts`)
  : testPlacement.at

const testImports = [
  `import { afterEach, describe, expect, it } from '${skeleton.test?.framework ?? 'vitest'}'`,
  // `screen` only where the body reaches for it. Queries moved onto the render
  // result, `screen` stayed in the import list, and tsc refused the file this tool
  // had just written — TS6133, a name declared and never read.
  helper ? "import { cleanup__SCREEN__ } from '@testing-library/react'" : "import { cleanup, render__SCREEN__ } from '@testing-library/react'",
  ...helper ? [`import { ${helper.name} } from '${helperImport}'`] : (skeleton.test?.router ? ["import { MemoryRouter } from 'react-router-dom'"] : []),
  ...a11yImport ? [`import { a11yViolations } from '${a11yImport}'`] : [],
  // Computed from where the test landed, not assumed to be beside the screen.
  // Moving the file to the directory the runner collects from left this pointing
  // at a sibling that was not there, and vitest failed to resolve it.
  `import ${skeleton.exportStyle.value === 'default' ? name : `{ ${name} }`} from '${(() => {
    const p = relative(dirname(targetTest), targetTsx).split(sep).join('/').replace(/\.tsx$/, '')
    return p.startsWith('.') ? p : './' + p
  })()}'`,
]

const renderCall = helper ? helper.name : 'render'

// A shell that reaches for context needs the providers around it. Where the
// repository wrapped that in a helper, the test uses it; where it did not, a test
// calling render() directly dies on the first context — so the generator says so
// instead of emitting a red test it knew would be red.
const shellNeedsProviders = shellName && !helper && sources.some(s =>
  new RegExp(`<${shellName}\\b`).test(s.text)) && (() => {
  const shellFile = walk(SOURCE_ROOT).concat(
    existsSync(join(REPO, 'ds')) ? walk(join(REPO, 'ds')) : [],
  ).find(f => new RegExp(`${shellName}\\.tsx$`).test(f))
  const text = shellFile ? readFileSync(shellFile, 'utf8') : ''
  return /\buse[A-Z]\w*\(\)/.test(text) || /use\(\w+Context\)/.test(text)
})()
const wrap = (jsx) => helper ? jsx : (skeleton.test?.router ? `<MemoryRouter>${jsx}</MemoryRouter>` : jsx)

const testBody = (() => {
  const draft = `${testImports.join('\n')}

/* The promises this screen makes that only running code can prove: it renders,
 * it says something when there is nothing to show, and it is reachable by
 * assistive technology. The spec agreed all three; without a test they are
 * sentences in a file. */

describe('${name}', () => {
  // Registered rather than relied on. Testing Library clears the document between
  // tests only where the runner exposes a global \`afterEach\` — vitest does that with
  // \`globals: true\` and not otherwise — and without it the second render finds the
  // first one's output as well: "found multiple elements", on a screen that is
  // perfectly correct. A generated test must not depend on how the host is configured.
  afterEach(cleanup)
${shellNeedsProviders ? `
  /* These are todo rather than red on purpose. ${shellName} reads from context,
   * and this repository has no provider-aware render helper, so a test calling
   * render() directly fails on the first context rather than on anything about
   * this screen. Add one — a single wrapper with the providers App.tsx uses — and
   * turn these on. */` : ''}
  it${shellNeedsProviders ? '.todo' : ''}('renders', () => {
    ${renderCall}(${wrap(`<${name} />`)})
    ${writesUtilities
      ? `const { getByRole } = ${renderCall}(${wrap(`<${name} />`)})\n    expect(getByRole('region', { name: '${zones[0]?.name ?? 'content'}' })).toBeTruthy()`
      : `expect(document.querySelector('.${cssClass}, .${cssClass}__state')).not.toBeNull()`}
  })

  it${shellNeedsProviders ? '.todo' : ''}('says something when there is nothing to show', () => {
    // Queried through the render result rather than the global \`screen\`, which
    // searches the whole document and therefore depends on the host clearing it
    // between tests. Where it does not — vitest without \`globals: true\` — the second
    // render finds the first one's output too and the test fails with "found multiple
    // elements", on a screen that is perfectly correct.
    const { getByText } = ${renderCall}(${wrap(`<${name} />`)})
    // The empty state is the first thing a new user sees and the one most often
    // left out, which is why it is pinned rather than assumed.
    expect(getByText(/${usesI18n ? '.' : 'nothing here yet'}/i)).toBeTruthy()
  })
${a11yImport ? `
  it${shellNeedsProviders ? '.todo' : ''}('has no accessibility violations', async () => {
    const { baseElement } = ${renderCall}(${wrap(`<${name} />`)})
    expect(await a11yViolations(baseElement)).toEqual([])
  })` : ''}
})
`
  // The body is written first, then the import list is trimmed to what it uses.
  return draft.replace('__SCREEN__', /\bscreen\./.test(draft.split('\n').slice(4).join('\n')) ? ', screen' : '')
})()

// The state paragraph carries this class in the markup and had no rule to match it:
// a class used and unstyled, which the three other emitters write and this one did
// not. The colour is written only where this project names one — an unresolvable
// custom property is dropped by the browser without a word.
const stateRule = spacing.muted
  ? `.${cssClass}__state {\n  color: var(${spacing.muted});\n}\n\n`
  : ''
const gapLine = spacing.gap
  ? `  gap: var(${spacing.gap});`
  : '  /* no spacing token is declared in this project */'
const css = `.${cssClass} {
  display: flex;
  flex-direction: column;
${gapLine}
${spacing.padding ? `  padding: var(${spacing.padding});\n` : ''}}

${stateRule}${zones.map(z => `.${cssClass}__${z.name} {\n  display: flex;\n${gapLine}\n}`).join('\n\n')}
`


// ── Which emitter wrote it ────────────────────────────────────────────────────

// Where an SFC keeps its styles, decided by the contract when it speaks and
// measured from the existing screens when it does not.
const vueStyleMode = (() => {
  const bucket = required('styling')?.expect
    ?? majority(sources.map(s => {
      if (/<style[^>]*\bscoped\b/.test(s.text)) return 'SFC <style scoped>'
      if (/<style[^>]*>/.test(s.text)) return 'SFC <style>'
      if (/from ['"]\.\/[^'"]*\.css['"]|@import/.test(s.text)) return 'stylesheet imported'
      return 'class, styles elsewhere'
    })).value
  return { 'SFC <style scoped>': 'scoped', 'SFC <style>': 'plain', 'stylesheet imported': 'imported' }[bucket] ?? 'none'
})()

// Which mounting library the existing tests use. Handing a project on
// @vue/test-utils a @testing-library/vue test writes a file that cannot resolve.
const vueMounts = (() => {
  for (const dir of ['tests', 'test', '__tests__', 'src']) {
    const at = join(REPO, dir)
    if (!existsSync(at)) continue
    for (const f of walkAny(at)) {
      if (!/\.(test|spec)\./.test(f)) continue
      const text = readFileSync(f, 'utf8')
      if (/@testing-library\/vue/.test(text)) return 'testing-library'
      if (/@vue\/test-utils/.test(text)) return 'test-utils'
    }
  }
  return 'test-utils'
})()

// ── The authored example, where this project keeps authored examples ───────────
//
// A story is the golden example, and this tool treats golden examples as the tier
// nobody ships and somebody has to write. A project with stories has written them,
// and generating a screen without one leaves the new screen out of the index the
// team actually browses — so the next person copies an older screen instead.
const storyShape = (() => {
  const pkg = (() => {
    try { return JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) } catch { return {} }
  })()
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const renderer = Object.keys(deps).find(d => /^@storybook\/(react|vue3|svelte|web-components|angular)$/.test(d))
    ?? Object.keys(deps).find(d => d.startsWith('@storybook/'))
  const present = Boolean(renderer) || existsSync(join(REPO, '.storybook'))
  const stories = present
    ? walkAny(SOURCE_ROOT).filter(f => /\.stories\.[jt]sx?$/.test(f))
      .map(f => ({ path: relative(REPO, f), text: readFileSync(f, 'utf8') }))
    : []
  return measureStories({ present, stories, renderer })
})()

// Both halves required. `present` without a suffix is not a shape a filename can be
// built from, and building one anyway wrote `ArchivedMemosSeaPageundefined` — a file
// whose name is the bug, sitting in somebody's repository.
const targetStory = storyShape.present && storyShape.suffix
  ? join(REPO, skeleton.screenDir, `${name}${storyShape.suffix}`)
  : undefined

// Which Svelte, decided from the dependency rather than from taste: `$state()` does
// not compile on 4 and `export let` is on its way out of 5.
const era = FRAMEWORK === 'svelte'
  ? svelteEra({
      version: (() => {
        try {
          const p = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
          return { ...p.dependencies, ...p.devDependencies }.svelte
        } catch { return undefined }
      })(),
      measuredProps: majority(sources.map(s => {
        const script = s.text.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
        return /\$props\s*\(/.test(script) ? '$props() runes'
          : /^\s*export\s+let\s+\w/m.test(script) ? 'export let' : undefined
      }).filter(Boolean)).value,
    })
  : undefined

// How an SFC keeps its styles, on the Svelte axis: inside the component, beside it,
// or nowhere of this component's business.
const svelteStyleMode = (() => {
  const bucket = required('styling')?.expect
    ?? majority(sources.map(s => {
      if (/<style[^>]*>/.test(s.text)) return 'Svelte <style>'
      if (/from ['"]\.\/[^'"]*\.css['"]|@import/.test(s.text)) return 'stylesheet imported'
      return 'class, styles elsewhere'
    })).value
  return { 'Svelte <style>': 'inline', 'stylesheet imported': 'imported' }[bucket] ?? 'none'
})()

const svelteMounts = (() => {
  for (const dir of ['tests', 'test', '__tests__', 'src']) {
    const at = join(REPO, dir)
    if (!existsSync(at)) continue
    for (const f of walkAny(at)) {
      if (!/\.(test|spec)\./.test(f)) continue
      if (/@testing-library\/svelte/.test(readFileSync(f, 'utf8'))) return 'testing-library'
    }
  }
  // No test to copy, so the dependency list decides. `mount()` from `svelte` resolves
  // to the server build under vitest unless the browser condition is set, and the
  // generated test failed with `mount(...) is not available on the server` — a
  // failure about the runner's resolution, on a screen that is correct. Testing
  // Library handles that itself, so where the project already has it, use it.
  try {
    const p = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    if ({ ...p.dependencies, ...p.devDependencies }['@testing-library/svelte']) return 'testing-library'
  } catch { }
  return 'client'
})()

// The selector each registry component declares, read from its own source. Angular
// templates reach a component by selector, and the registry does not carry one:
// deriving `app-ui-heading` from `UiHeading` is a guess about somebody else's prefix,
// and a wrong guess renders an empty page with no error a person will see.
const angularSelectors = new Map()
const angularSelectorsMissing = []
if (FRAMEWORK === 'angular') {
  for (const component of used) {
    // The registry may already carry it, read from the component's own decorator.
    // Searching the filesystem for it is the fallback, not the first move.
    const known = components[component]?.selector
    if (known) { angularSelectors.set(component, known); continue }
    const declared = components[component]?.from
    const bases = declared ? [declared] : []
    let found
    for (const base of bases) {
      const alias = [...aliasRoots.keys()].find(a => base === a || base.startsWith(a + '/'))
      const rest = alias ? base.slice(alias.length).replace(/^\//, '') : base.replace(/^[.~/]+/, '')
      const at = alias ? join(REPO, aliasRoots.get(alias), rest) : join(REPO, 'src', rest)
      for (const ext of ['.ts', '.component.ts', '/index.ts']) {
        if (!existsSync(at + ext)) continue
        found = /selector\s*:\s*['"]([^'"]+)['"]/.exec(readFileSync(at + ext, 'utf8'))?.[1]
        if (found) break
      }
      if (found) break
    }
    if (found) angularSelectors.set(component, found)
    else angularSelectorsMissing.push(component)
  }
}

const angularStyleMode = (() => {
  const bucket = required('styling')?.expect
    ?? majority(sources.map(s => {
      const decorator = /@Component\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(s.text)?.[1] ?? ''
      if (/styleUrls?\s*:/.test(decorator)) return 'styleUrls'
      if (/styles\s*:/.test(decorator)) return 'inline styles'
      return undefined
    }).filter(Boolean)).value
  return bucket === 'inline styles' ? 'inline' : 'styleUrls'
})()

// The three decisions, each read from the contract on its own. Deriving two of them
// from the third is the mistake that produces a file no half of the team recognises.
const angularBlocks = (required('template control flow')?.expect
  ?? majority(sources.map(s => {
    const decorator = /@Component\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(s.text)?.[1] ?? ''
    const inline = /template\s*:\s*`([\s\S]*?)`/.exec(decorator)?.[1]
    let markup = inline
    if (markup === undefined) {
      const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(decorator)?.[1]
      const at = url ? join(dirname(s.path), url) : undefined
      markup = at && existsSync(at) ? readFileSync(at, 'utf8') : ''
    }
    if (/@(if|for|switch)\s*[({]/.test(markup)) return '@if blocks'
    if (/\*ng(If|For|Switch)\b/.test(markup)) return '*ngIf directives'
    return undefined
  }).filter(Boolean)).value) === '@if blocks'

const angularSignals = (required('props declaration')?.expect
  ?? majority(sources.map(s => {
    if (/=\s*input(\.required)?\s*[<(]/.test(s.text)) return 'input() signals'
    if (/@Input\s*\(/.test(s.text)) return '@Input() decorator'
    return undefined
  }).filter(Boolean)).value) === 'input() signals'

const emitted = FRAMEWORK === 'angular'
  ? (() => {
      const out = emitAngular({
        name, fileBase, cssClass, zones,
        imports: importSpecs,
        shell: shellName ? { component: shellName, props: shellProps } : undefined,
        shellFrom: shellImport?.from,
        shellClass: shellEntry?.className,
        standalone: skeleton.exportStyle.value === 'NgModule declaration' ? 'module' : 'standalone',
        signals: angularSignals,
        blocks: angularBlocks,
        styleMode: angularStyleMode,
        // Named only where one is written, so the decorator cannot point at a file
        // that does not exist.
        styleFile: angularStyleMode !== 'inline' && writeOwnLayout && !writesUtilities
          ? basename(targetCss) : undefined,
        selector: angularSelector(name),
        selectorOf: angularSelectors.get.bind(angularSelectors),
        propsFor, takesSlot: takesChildren, label,
        spacing, statesComment, cautions: exemplars?.caution,
        screens: screens.length, specFile: basename(specPath), profile: PROFILE,
      })
      return {
        body: out.body,
        css: out.css,
        template: out.template,
        test: emitAngularTest({
          name, cssClass,
          harness: walkAny(SOURCE_ROOT).some(f => /\.(test|spec)\./.test(f)
            && /@testing-library\/angular/.test(readFileSync(f, 'utf8'))) ? 'testing-library' : 'testbed',
          importPath: (() => {
            const p = relative(dirname(targetTest), targetTsx).split(sep).join('/').replace(/\.ts$/, '')
            return p.startsWith('.') ? p : './' + p
          })(),
        }),
      }
    })()
  : FRAMEWORK === 'svelte'
  ? (() => {
      const out = emitSvelte({
        name, cssClass, zones, era,
        imports: [...(shellImport ? [shellImport] : []), ...importSpecs],
        shell: shellName ? { component: shellName, props: shellProps } : undefined,
        styleMode: svelteStyleMode,
        usesI18n, propsFor, takesSlot: takesChildren, label,
        spacing, statesComment, cautions: exemplars?.caution,
        screens: screens.length, specFile: basename(specPath), profile: PROFILE,
      })
      return {
        body: out.body,
        css: out.css,
        test: emitSvelteTest({
          name, cssClass, mounts: svelteMounts,
          importPath: (() => {
            const p = relative(dirname(targetTest), targetTsx).split(sep).join('/')
            return p.startsWith('.') ? p : './' + p
          })(),
        }),
      }
    })()
  : FRAMEWORK === 'vue'
  ? (() => {
      const out = emitVue({
        name, cssClass, zones, spec,
        imports: [...(shellImport ? [shellImport] : []), ...importSpecs],
        shell: shellName ? { component: shellName, props: shellProps } : undefined,
        styleMode: vueStyleMode,
        usesI18n,
        propsFor,
        takesSlot: takesChildren,
        label,
        spacing,
        statesComment,
        cautions: exemplars?.caution,
        screens: screens.length,
        specFile: basename(specPath),
        profile: PROFILE,
      })
      return {
        body: out.body,
        css: out.css,
        test: emitVueTest({
          name, mounts: vueMounts, zones,
          importPath: (() => {
            const p = relative(dirname(targetTest), targetTsx).split(sep).join('/')
            return p.startsWith('.') ? p : './' + p
          })(),
        }),
      }
    })()
  : { body, css, test: testBody }

// ── Report, write, then prove it conforms ─────────────────────────────────────

console.log(`\nbuild-screen: ${spec.id} → ${PROFILE}`)
// Which authority each line came from. A number reads as a measurement, so a value
// that came from the contract must not be printed as one.
const authority = (m) => m.fromContract ? 'agreed contract' : m.measured ? `${Math.round(m.share * 100)}%` : 'NOT MEASURED'
console.log(`\nSKELETON — measured from ${screens.length} existing screens`)
console.log(`  screens live in     ${skeleton.screenDir}`)
console.log(`  design system via   ${skeleton.dsPrefix ?? '(package name)'}`)
console.log(`  css beside module   ${skeleton.cssBeside.value} (${Math.round(skeleton.cssBeside.share * 100)}%)`)
console.log(`  css imported first  ${skeleton.cssImportFirst.value} (${authority(skeleton.cssImportFirst)})`)
console.log(`  export              ${skeleton.exportStyle.value} (${authority(skeleton.exportStyle)})`)
console.log(`  text through i18n   ${skeleton.i18n.value} (${Math.round(skeleton.i18n.share * 100)}%)`)
console.log(`  handlers            ${skeleton.handler.value ?? 'NOT MEASURED — no screen here names one'}${skeleton.handler.value ? ` (${authority(skeleton.handler)})` : ''}`)
console.log(`  data                ${skeleton.data}`)
if (shellNeedsProviders) {
  console.log('')
  console.log(`  ⚠ ${shellName} reads from context and this repository has no render helper.`)
  console.log('    The generated tests are marked todo rather than shipped red.')
  console.log('    Add src/test/renderScreen.tsx wrapping the providers App.tsx uses, then enable them.')
}
console.log(`  test helper         ${helper ? `${helper.name} from ${helperImport}` : 'none; render() directly'}`)
console.log(`  screen shell        ${skeleton.shell ? `${skeleton.shell.component} (${Math.round(skeleton.shell.share * 100)}%)` : 'none; a <main> landmark is emitted instead'}`)
// The shape, and what it is a shape OF. A dominant archetype covering a fifth of the
// screens is a different instruction from one covering four fifths, and printing only
// the winner would hide which of the two this is.
if (archetype && !archetype.none) {
  console.log(`  screen archetype    ${archetype.signature} — ${archetype.count} of ${archetype.of} screen(s), ${Math.round(archetype.share * 100)}%`)
} else if (archetype?.none) {
  // Not "not measured". The measurement ran and its answer was that this repository
  // has no house shape — which is a finding, and the one that decides whether the
  // next thing to do is generate a screen or install a frame.
  const m = archetype.measured
  console.log(`  screen archetype    NONE — of ${m.considered} screen(s): ${m.framed} render into a shell, ${m.unframed} build their own page out of raw elements, ${m.renderingNothing} render nothing`)
  console.log('                      There is no shape here to write the next screen in.')
  console.log('                      What this writes below is a proposal, not this repository\'s idiom.')
  if (REGION_VOCABULARY) {
    console.log(`                      A page frame in ${REGION_VOCABULARY.of} measured product(s) offers:`)
    console.log(`                        ${REGION_VOCABULARY.top.map(r => `${r.name} (${r.products}/${REGION_VOCABULARY.of})`).join(' · ')}`)
    console.log('                      Measured, not recommended — see catalogue/regions.json.')
  }
} else {
  console.log('  screen archetype    NOT MEASURED — no screen here returns a recognisable shell')
}
console.log(archetype
  ? `  own layout          ${Math.round(archetype.laysOutOwn.share * 100)}% of ${archetype.laysOutOwn.of} screen(s) declare one${writeOwnLayout ? '' : ' — so this writes none either'}`
  : '  own layout          NOT MEASURED')
// The arrangement, and whether the screens here agree on one. A split is the team's
// to settle, not ours to average: reporting a dominant answer over a disagreement
// would be inventing a house style out of arithmetic.
if (archetype?.arrangement) {
  const a = archetype.arrangement
  console.log(a.verdict === 'none'
    ? '  arrangement         none declared by any screen here'
    : `  arrangement         ${a.verdict}${a.dominant ? ` — ${a.dominant} ${Math.round(a.share * 100)}%` : ''}`)
  if (a.distribution.length > 1 || a.verdict === 'too few to say') {
    console.log(`                      ${a.distribution.map(d => `${d.name} ×${d.count}`).join(' · ')}`)
  }
  if (a.verdict === 'split') {
    console.log('                      the screens here disagree; this writes the neutral stack and')
    console.log('                      leaves the choice where it belongs')
  }
  if (a.why) console.log(`                      ${a.why}`)
}
console.log(`  spacing             gap ${spacing.gap ?? 'NOT MEASURED'} · padding ${spacing.padding ?? 'NOT MEASURED'} · muted ${spacing.muted ?? 'NOT DECLARED HERE'}`)
if (spacing.fromProfile) {
  // Which of them this project actually declares, and which came from elsewhere. A
  // borrowed token reads identically to a measured one in the stylesheet, and the
  // difference is the whole question of whether the team has agreed to it.
  const which = ['gap', 'padding', 'muted'].filter(k => spacing.borrowed?.[k])
  console.log(`                      ${which.join(', ')} borrowed from the "${PROFILE}" token layer,`)
  console.log('                      because this repository declares none. Written beside the')
  console.log('                      proposal so the names resolve; nothing is referenced blind.')
}
if (spacing.unresolved.length) {
  for (const u of spacing.unresolved) console.log(`                      ${u}`)
  console.log('                      a custom property this project does not declare is dropped')
  console.log('                      silently by the browser, so nothing is written for these.')
}
if (archetype?.alternatives?.length) {
  console.log(`                      also here: ${archetype.alternatives.join(' · ')}`)
}
if (era) console.log(`  svelte era          ${era.runes ? 'runes' : 'pre-runes'}, from ${era.from}`)
console.log(`  stories             ${storyShape.present
  ? `${storyShape.measured ? 'measured' : 'ASSUMED — Storybook is here and no story was found to copy'}: CSF${storyShape.csf}, ${storyShape.typed === 'none' ? 'untyped' : storyShape.typed}, ${storyShape.renderer}`
  : 'none here; no story is written, because a story nothing runs looks like coverage'}`)
console.log(`  tests               ${skeleton.test ? `${skeleton.test.framework}${skeleton.test.router ? ' + MemoryRouter' : ''}${a11yImport ? ` + ${a11yImport}` : ''} (${skeleton.test.count} existing)` : 'none found'}`)

// Where the contract and the files disagree, both are shown. The contract wins —
// that is what a decision is — but a team that settled a split three months ago
// and has 90% of its code on the other side is being told something useful.
if (disagreements.length) {
  console.log('\nTHE CONTRACT AND THE FILES DISAGREE — the contract wins, and this is why it exists')
  for (const d of disagreements) {
    console.log(`  ${d.dimension}: written as "${d.contract}"`)
    console.log(`    ${d.measured ? `the existing screens say "${d.measured}"${d.share ? ` at ${Math.round(d.share * 100)}%` : ''}` : 'nothing measurable in the existing screens'}`)
    if (d.source) console.log(`    ${d.source}`)
  }
}

if (exemplars) {
  const references = [...(exemplars.copy?.screen ?? [])].slice(0, 2)
  if (references.length) {
    console.log('\nFOLLOWING — the highest-scoring screens here, not the most common shape')
    for (const r of references) console.log(`  ${r.file} (${r.score}% over ${r.checks} checks)`)
  }
  if (exemplars.caution?.length) {
    console.log('\nDELIBERATELY NOT COPIED — measured here, and not reproduced')
    for (const c of exemplars.caution) console.log(`  · ${c.pattern} — ${c.measured}`)
  }
}

console.log(`\nRESOLVED — ${zones.reduce((n, z) => n + z.items.length, 0)} element(s) from the spec`)
for (const zone of zones) {
  for (const item of zone.items) {
    console.log(`  ${zone.name.padEnd(9)} ${item.role.padEnd(15)} → <${item.component}${attrs(item.props)} />`)
  }
}

// Refused before a single file exists.
//
// The gate at the bottom of this script would catch these too, but by then the
// screen, its stylesheet and its test are on disk and somebody has to decide
// whether to keep them. A generator that knows in advance that it cannot meet the
// contract should say so and write nothing.
if (cannotHonour.length && !process.argv.includes('--anyway')) {
  console.error('\nWILL NOT WRITE — the contract requires conventions this generator cannot produce\n')
  for (const c of cannotHonour) {
    console.error(`  ${c.dimension}: requires "${c.expect}"`)
    console.error(`    this writes ${c.can.map(v => `"${v}"`).join(' or ')} and nothing else`)
  }
  console.error('\n  These are different products, not different spellings — a screen written the')
  console.error('  other way would fail the gate installed from this repository\'s own contract.')
  console.error('  Extend the generator, or drop the rule, or pass --anyway to write it regardless')
  console.error('  and see exactly how the gate refuses it.')
  process.exit(2)
}

if (!apply) {
  console.log(`\n── ${relative(REPO, targetTsx)} ${'─'.repeat(20)}`)
  console.log(emitted.body)
  console.log('Plan only — nothing was written. Add --apply to generate.')
  process.exit(0)
}

// A stylesheet is only a file where the convention keeps styles outside the
// component. An SFC carrying a <style scoped> block that also gets a .css beside it
// has two answers to one question.
const toWrite = [[targetTsx, emitted.body], [targetTest, emitted.test]]
// A stylesheet only where the screens here have one. Writing `display: flex;
// flex-direction: column; gap` onto a screen in a project where no screen declares a
// layout produces a file that reads as generated from its first line — and one more
// stylesheet for somebody to keep in step with a frame that already handles this.
// A utility-class project keeps no stylesheet beside a screen; writing one would be
// the second styling system this repository does not have.
if (emitted.css !== undefined && writeOwnLayout && !writesUtilities) toWrite.push([targetCss, emitted.css])
// Angular keeps its markup in a file of its own wherever the project does.
if (emitted.template !== undefined && targetTemplate) toWrite.push([targetTemplate, emitted.template])
if (targetStory) {
  toWrite.push([targetStory, emitStory({
    name, shape: storyShape, title: `Screens/${name}`,
    byDefault: skeleton.exportStyle.value === 'default' || FRAMEWORK === 'vue',
    needsHost: shellNeedsProviders ? shellName : undefined,
    importPath: (() => {
      const p = relative(dirname(targetStory), targetTsx).split(sep).join('/')
      const bare = FRAMEWORK === 'vue' ? p : p.replace(/\.tsx$/, '')
      return bare.startsWith('.') ? bare : './' + bare
    })(),
  })])
}

// ── The frame, where this repository has none ─────────────────────────────────
//
// Written beside the screen rather than into it. A frame the screen imported would
// make refusing the proposal a compile error, and a proposal that cannot be refused
// is a decision — so this goes outside the source tree, where it is not built, not
// linted, and not in anybody's way. Adopting it is a move; refusing it is a delete.
const proposedFrame = (() => {
  if (!archetype?.none || !REGION_VOCABULARY) return undefined
  const m = archetype.measured
  // Only where the absence is a decision the project made, not a reading this pass
  // failed at. A repository whose screens could not be read is not a repository
  // without a frame.
  if (!m.unframed || m.framed) return undefined

  const known = new Map((REGION_VOCABULARY.all ?? []).map(r => [r.name, r.products]))
  const regions = zones.map(z => ({ name: z.name, products: known.get(z.name) ?? 1 }))
  const frameName = 'PageFrame'
  const emitted = emitFrame({
    name: frameName,
    regions,
    of: REGION_VOCABULARY.of,
    measuredOn: REGION_VOCABULARY.names,
    screens: m.considered,
    unframed: m.unframed,
    framework: FRAMEWORK,
    exportStyle: skeleton.exportStyle.value,
    stylesBeside: skeleton.cssBeside?.value === 'yes',
    selector: `ds-${frameName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
    signals: angularSignals,
    runes: Boolean(era?.runes),
    arrangement: archetype.arrangement,
    // Already resolved above, borrowed roles and all, so the frame and the screen
    // cannot disagree about which token they mean.
    spacing,
  })
  const dir = join(REPO, '.ds', 'proposals')
  // Only where this project declares none of its own. A token layer extracted from
  // their site is a proposal; the tokens already in their code are a fact, and a fact
  // outranks a proposal.
  const tokensBlock = spacing.fromProfile && profileTokens
    ? rootBlock(profileTokens, { from: profileTokens.find(t => t.source)?.source })
    : undefined
  return {
    path: join(dir, frameName + emitted.ext),
    body: emitted.body,
    css: emitted.css === undefined ? undefined : [join(dir, frameName + '.css'), emitted.css],
    tokens: tokensBlock ? [join(dir, 'tokens.proposed.css'), tokensBlock] : undefined,
    tokenCount: tokensBlock ? profileTokens.length : 0,
    namedByClient: tokensBlock ? profileTokens.filter(t => t.named).length : 0,
    regions,
  }
})()
if (proposedFrame) {
  toWrite.push([proposedFrame.path, proposedFrame.body])
  // The stylesheet travels with it. Without it the import the frame writes points at
  // nothing, and the proposal stops compiling the moment somebody adopts it.
  if (proposedFrame.css) toWrite.push(proposedFrame.css)
  if (proposedFrame.tokens) toWrite.push(proposedFrame.tokens)
}

for (const [path, content] of toWrite) {
  if (existsSync(path)) {
    console.error(`\nbuild-screen: ${relative(REPO, path)} already exists; refusing to overwrite a screen.`)
    process.exit(1)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
console.log(`\nwrote ${toWrite.map(([f]) => relative(REPO, f)).join(', ')}`)
if (proposedFrame) {
  console.log(`\n${relative(REPO, proposedFrame.path)} is a PROPOSAL and is outside the source tree.`)
  console.log('It is not built, not linted, and nothing imports it. The screen written')
  console.log('above does not use it — adopting the frame is a move into src and an edit;')
  console.log('refusing it is a delete, and neither happens on its own.')
  if (proposedFrame.tokens) {
    console.log(`\nThis project declares no spacing token of its own, and the "${PROFILE}" profile`)
    console.log(`carries ${proposedFrame.tokenCount} read from what the client already ships${proposedFrame.namedByClient ? `, ${proposedFrame.namedByClient} of them under the name the client gave them` : ''}.`)
    console.log('They are written beside the frame rather than referenced from it: a var()')
    console.log('naming a property the project does not declare is dropped by the browser')
    console.log('without a word, so taking the frame takes what it needs.')
  }
}

// ── Formatted by whatever this repository formats with ────────────────────────
//
// The first output here was rejected by memos' biome over semicolons and the
// indentation of JSX inside the page shell. Matching that by hand means encoding
// one project's formatter settings into a generator that has to work in any
// project, and being wrong in the next one.
//
// Every repository that cares about this already owns the answer. Run theirs.
const formatted = (() => {
  // `biome check --write` rather than `format --write`: their configuration also
  // enforces import order through the assist rules, which formatting alone does
  // not apply, and the generated test was rejected for listing vitest before
  // testing-library. Whatever the project has told its tool to fix, let it fix.
  const candidates = [
    ['biome', ['check', '--write']],
    ['prettier', ['--write']],
    ['eslint', ['--fix']],
    ['dprint', ['fmt']],
  ]
  const written = toWrite.map(([f]) => f).filter(existsSync).map(f => relative(REPO, f))
  for (const [tool, args] of candidates) {
    const bin = [join(REPO, 'node_modules', '.bin', tool), join(REPO, '..', '..', 'node_modules', '.bin', tool)]
      .find(existsSync)
    if (!bin) continue
    try {
      execFileSync(bin, [...args, ...written], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return tool
    } catch { /* try the next one; an unformatted file is caught by the gate below */ }
  }
  return undefined
})()
console.log(formatted
  ? `formatted with this repository's own ${formatted}`
  : 'no formatter found here, so the output keeps the generator\'s spacing')

// Registration is reported, not performed. Editing a router is the one change here
// that alters what the application does rather than adding to it, and a generator
// that quietly rewires routing is a generator nobody will run twice.
if (skeleton.routes) {
  const routeKey = spec.id.replace(/-([a-z])/g, (m, c) => c.toUpperCase())
  console.log('\n── to reach this screen, two edits nobody should make for you ──')
  if (skeleton.routes.constantsFile) {
    console.log(`  ${skeleton.routes.constantsFile}`)
    console.log(`    ${routeKey}: '/${spec.id}',`)
  }
  console.log(`  ${skeleton.routes.file}`)
  const guardOpen = skeleton.routes.guard ? `<${skeleton.routes.guard}>` : ''
  const guardClose = skeleton.routes.guard ? `</${skeleton.routes.guard}>` : ''
  console.log(`    <Route path={ROUTES.${routeKey}} element={${guardOpen}<${name} />${guardClose}} />`)
  if (skeleton.routes.guard) {
    console.log(`  The guard is this repository's own: every existing route is wrapped in ${skeleton.routes.guard}.`)
  }
}

// The claim, checked. A generator that says it writes like this repository has to
// survive the gate built from this repository's conventions.
// What does not resolve is reported whether or not a gate exists to say it.
//
// This used to live inside the branch that runs the gate, so a repository with no
// gate installed got `exit 0` and the words "the output is unverified" over four
// imports the generator had already established point at nothing. It knew, and it
// said nothing — which is this tool's own version of green where nothing was
// checked, in the one script that writes files into somebody else's repository.
const reportUnresolved = () => {
  if (angularSelectorsMissing.length) {
    console.log('\nSELECTOR NOT FOUND')
    for (const c of angularSelectorsMissing) {
      console.log(`  ${c.padEnd(16)} its source could not be read, so the element it declares is unknown`)
    }
    console.log('\n  An Angular template reaches a component by selector. Deriving one from the')
    console.log('  class name is a guess about this project\'s prefix, and a wrong guess renders')
    console.log('  an empty page with no error anybody sees. The class name was written instead,')
    console.log('  which the compiler will reject — visibly.')
  }
  const placeholder = skeleton.data === 'query-hook'
  if (!missingModules.length && !missingImports.length && !placeholder) return angularSelectorsMissing.length > 0
  console.log('\nDOES NOT COMPILE YET')
  if (placeholder) {
    console.log('  SCREEN_QUERY      a name this file uses and nothing declares')
    const q = skeleton.queryFrom
    console.log(`                    ${q?.module
      ? `\`useQuery\` is imported from ${q.module}, which ${q.uses} screen(s) here use.`
      : 'No bare `useQuery` import could be measured here, so the hook is not imported either.'}`)
    if (q?.viaClient) {
      console.log(`                    ${q.viaClient.uses} screen(s) here instead call \`${q.viaClient.name}.<route>.useQuery()\`${q.viaClient.module ? `, from ${q.viaClient.module}` : ''}.`)
      console.log('                    That form needs the route name, which is the same decision, so')
      console.log('                    it is reported rather than written.')
    }
    console.log('                    Which query this screen makes is the one thing measurement')
    console.log('                    cannot supply. Everything else was read from this repository.')
  }
  for (const u of missingModules) {
    console.log(`  ${u.component.padEnd(16)} imported from ${u.from} — no such module in this repository`)
  }
  for (const m of missingImports) {
    console.log(`  ${m.padEnd(16)} used as the page shell, and no screen here imports it in a form this could copy`)
  }
  // Only where components are actually missing. This printed after a placeholder
  // symbol too, telling a reader that a profile extracted from their own package was
  // not installed in their own project — advice to fix something that was not wrong.
  if (missingModules.length || missingImports.length) {
    console.log(`\n  The "${PROFILE}" profile is not installed in this project. Either add these`)
    console.log('  components, or build against a profile extracted from what it already has')
    console.log(`  (\`ds adapt:css\` or \`ds probe:own\`). The file's shape is this repository's;`)
    console.log('  the component library it reaches for is not here yet.')
  }
  return true
}

const gate = join(REPO, 'scripts', 'gate', 'conventions.mjs')
if (!existsSync(gate)) {
  console.log('\nNo conventions gate installed here, so the house style is unverified. Run install first.')
  process.exit(reportUnresolved() ? 1 : 0)
}
console.log('\n── the repository\'s own conventions gate, on what was just generated ──')
try {
  const out = execFileSync(process.execPath, [gate, ...toWrite.map(([f]) => relative(REPO, f)).filter(f => !/\.(test|spec)\./.test(f))], { cwd: REPO, encoding: 'utf8' })
  console.log(out.trim())

  // The gate checks house style. It does not check that a module is there, and
  // saying "conforms" over four imports that do not resolve is the tool's own
  // version of a green light where nothing was looked at.
  if (reportUnresolved()) {
    console.log('\n  It conforms in style. That is a smaller claim than it looks.')
    process.exit(1)
  }

  console.log('\nThe generated screen conforms to conventions measured from this repository.')

  // Conforming is a smaller claim than it sounds, and this is the check that says how
  // much smaller. The gate has just approved this file; the question left is whether
  // it would have refused a broken one.
  //
  // Neither existing eval asks it. `ds eval` measures our ruleset against our corpus,
  // and the generated eval set measures the client's gate against the client's own
  // reference file. Nobody measures the gate against the file we have just put in
  // their repository — which is the file the next agent will copy.
  // What the checks SAY, not what they exit with.
  //
  // The first version treated a zero exit as "not caught" and reported ten survivors.
  // Every one was wrong, in three different ways, and each way is worth keeping
  // written down because they are the three ways this measurement goes false:
  //
  //   · only one check was invoked, and the others were reported as holes
  //   · `score` exits zero on a drop to 80%: a break can be caught and still not
  //     fail the command
  //   · `component export` is DOCUMENTED here, not enforced. A leaning is not held
  //     against new code by design, so the gate was right to be silent and the report
  //     called that a hole.
  //
  // So each break is judged by the group that is supposed to catch it, and a break
  // aimed at a dimension this project has not settled is reported as that rather than
  // as a failure.
  const scoreGate = join(REPO, 'scripts', 'gate', 'score.mjs')
  const enforced = new Set(Object.keys(contract?.enforce ?? {}))
  const groupScore = (out, group) => {
    const line = out.split('\n').find(l => l.includes(group))
    const pct = line && /(\d+)%/.exec(line)?.[1]
    return pct === undefined ? undefined : Number(pct)
  }

  const written = readFileSync(targetTsx, 'utf8')
  const survived = []
  const unsettled = []
  const inapplicable = []
  const exercised = []
  if (existsSync(scoreGate)) {
    // What the checks say about the file as written. A group absent here is a check
    // that has nothing to look at in this file — no union prop is used, no image is
    // rendered — and its silence afterwards is not a hole. Comparing the broken file
    // with nothing is how four checks that do not apply were reported as holes.
    let base = ''
    try {
      base = execFileSync(process.execPath, [scoreGate, relative(REPO, targetTsx)], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) { base = (error.stdout ?? '') + (error.stderr ?? '') }
    for (const op of OPERATORS) {
      const broken = op.apply(written)
      if (broken === undefined || broken === written) continue

      // A break aimed at a convention this project has not settled cannot be caught,
      // and saying the gate failed to catch it would be blaming it for a decision
      // nobody has made.
      if (op.needs && !enforced.has(op.needs)) {
        unsettled.push(op)
        continue
      }
      // A check with nothing to look at in this file cannot be held to catching a
      // break in it.
      if (groupScore(base, op.catchBy) === undefined) {
        inapplicable.push(op)
        continue
      }
      exercised.push(op.id)
      writeFileSync(targetTsx, broken)
      let out = ''
      try {
        out = execFileSync(process.execPath, [scoreGate, relative(REPO, targetTsx)], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) { out = (error.stdout ?? '') + (error.stderr ?? '') }
      const scored = groupScore(out, op.catchBy)
      if (scored === undefined || scored === 100) survived.push({ ...op, scored })
    }
    writeFileSync(targetTsx, written)
  }

  console.log(`\nPROVEN — ${exercised.length} deliberate break(s) put back through the checks that just approved this file`)
  if (inapplicable.length) {
    console.log(`  ${inapplicable.length} not attempted, because the check that would catch them has nothing to look at here:`)
    for (const op of inapplicable) console.log(`    ${op.id.padEnd(24)} "${op.catchBy}" reports nothing about this file as written`)
  }
  if (unsettled.length) {
    console.log(`  ${unsettled.length} not attempted, because this project has not settled the rule they break:`)
    for (const op of unsettled) console.log(`    ${op.id.padEnd(24)} needs "${op.needs}", which is documented here rather than enforced`)
  }
  if (survived.length) {
    console.log(`  ${survived.length} survived, which is a hole in this repository's checks:`)
    for (const op of survived) {
      console.log(`    ${op.id.padEnd(24)} ${op.what}`)
      console.log(`    ${' '.repeat(24)} ${op.scored === undefined ? `"${op.catchBy}" reported nothing` : `"${op.catchBy}" still scored 100%`}`)
    }
    console.log('\n  A surviving break is never a break to delete. Until one of these is closed,')
    console.log('  the checks approve this shape of file whether it is right or not.')
    process.exit(1)
  }
  if (exercised.length) console.log('  none survived: every one was caught by the check meant to catch it.')
} catch (error) {
  console.error((error.stdout ?? '') + (error.stderr ?? ''))
  console.error('The generator does not write like this repository. That is the generator\'s defect, not the gate\'s.')
  process.exit(1)
}
