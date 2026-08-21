/**
 * Convention signals — the one home for how house style is measured.
 *
 * Read by the scanner here and, in copied form, by the conventions linter that
 * `install` writes into the target repository. Both must measure identically:
 * a linter that scores differently from the scan would reject code for matching
 * the convention it was told to match.
 *
 * Signals are shape-level and deliberately cheap. They read the form of the code
 * — file layout, naming, where styling attaches — not its meaning. A signal
 * returns a bucket name, or undefined when the file says nothing about that
 * dimension.
 */
import { readdirSync, statSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, basename, dirname, extname, sep, isAbsolute, relative } from 'node:path'

/** A pattern this dominant is treated as the house rule. */
export const STRONG = 0.85
/** Below this the repository is telling us it has not decided. */
export const WEAK = 0.60

/**
 * How many observations a distribution needs before its share means anything.
 *
 * A share is a ratio, and a ratio over one observation is 100% by arithmetic. On
 * hono the scan reported `props declaration — type Props 100%` and `colour values
 * — literal hex 100%`, from one file and two values, and `ds install --apply`
 * wrote both into `.ds/conventions.json` under `enforce` with `share: 1` and
 * `source: "whole repository"`. Nothing in that contract said the whole repository
 * meant one file. The gate would then have failed every future file that declared
 * props any other way — a rule invented by the tool, presented to the client as
 * their own decision.
 *
 * The colour one was worse than useless: it would have enforced literal hex on a
 * project where the same run counted 36 hardcoded values as a defect.
 *
 * Five is the number `arrangement` already refuses below, for the same reason and
 * in the same words — two observations agreeing is not a convention, it is two
 * observations. It lives here so the scan, the installer and the gate that gets
 * copied into the client's repository cannot disagree about it.
 */
export const MIN_OBSERVATIONS = 5

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-single', 'build', 'coverage', '.next', 'out', '.turbo', 'vendor'])

/** Product source. What conventions are measured over. */
// `.vue` is source and belongs here: leaving it out was why a Vue project measured
// `scannedFiles: 0` and every convention came back undecided.
//
// `.svelte` joined once the signals below could read it. It was excluded while they
// could not, and for a reason worth keeping written down: collecting a language
// nothing looks inside counts its files as files measured, leaves every dimension
// undecided, and prints `greenfield — no house style to honour` over an application
// that has one. Unmeasured and unmeasurable are different findings, and the
// difference is whether a reader is told something false.
export const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.vue', '.svelte'])

/**
 * Everything the toolchain audit needs to see, which is wider than product
 * source: build and lint scripts are usually `.mjs`, and asking "does this
 * repository carry its own linter" against a source-only listing answers no for
 * every repository that has one.
 */
export const TOOL_EXT = new Set([...CODE_EXT, '.mjs', '.cjs', '.json', '.yml', '.yaml', '.sh'])

/**
 * Paths this tool installed, which it must not then measure.
 *
 * After an install the repository contains a gate, a loop, an eval set and a
 * reference file — and the next scan counted them as the project's own source.
 * The eval breaks are deliberately wrong code, so the tool was reporting its own
 * fixtures as the client's defects, and the reference file inflated every count
 * it appeared in.
 *
 * Only where `.ds/conventions.json` is present, because these are ordinary
 * directory names in a repository that never had an install.
 */
export function installedHere(target) {
  if (!existsSync(join(target, '.ds', 'conventions.json'))) return () => false
  const OURS = ['.ds/', 'evals/', 'scripts/gate/', 'scripts/loop/']
  return (abs) => {
    const rel = relative(target, abs).split(sep).join('/')
    return OURS.some(p => rel.startsWith(p))
  }
}

/** Collects files under dir with the given extensions, skipping build output. */
export function walk(dir, out = [], ext = CODE_EXT, seen = new Set()) {
  // A directory reached twice is walked once. Symlinked directories are ordinary —
  // pnpm and yarn workspaces make them, and monorepos link shared folders — and
  // following them blindly counts the same files again under a second path. On a
  // fixture holding four files, one symlink pointing at its own parent made this
  // return 132: every count downstream inflated 33×, silently, with nothing in any
  // output looking wrong. A loop also terminates only because the operating system
  // eventually refuses to resolve the path.
  //
  // `realpathSync` is the identity that survives links; the path a walk arrived by
  // is not.
  let here
  try { here = realpathSync(dir) } catch { return out }
  if (seen.has(here)) return out
  seen.add(here)

  for (const name of readdirSync(dir)) {
    // Hidden directories hold caches and run artifacts — eval scratch output read
    // as 94 screens once, which is the kind of number that discredits a report.
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const abs = join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walk(abs, out, ext, seen)
    else if (ext.has(extname(name))) out.push(abs)
  }
  return out
}

/**
 * Where a target's measurements are filed.
 *
 * This used to be the last path segment, which is a name two different clients
 * routinely share: `memos/web` and `formbricks/apps/web` both filed under `web`
 * and silently overwrote each other, so a report could show one project's
 * numbers under another project's name. That is the worst failure this tool has,
 * because nothing about the output looks wrong.
 *
 * The slot is the enclosing repository plus the path within it, which is unique
 * wherever the repositories are and still reads like something a person chose.
 */
export function scanSlot(target) {
  const clean = String(target).replace(/[\\/]+$/, '')
  const abs = isAbsolute(clean) ? clean : join(process.cwd(), clean)

  let dir = abs
  const parts = []
  let rooted = false
  for (let i = 0; i < 6; i += 1) {
    const up = dirname(dir)
    if (up === dir) break
    if (existsSync(join(dir, '.git'))) { rooted = true; break }
    parts.unshift(basename(dir))
    dir = up
  }

  // Inside a repository the slot is its name plus the path within it, so two
  // packages called `web` stay apart by whose they are.
  //
  // Outside one there is no root to lead with, and joining the whole filesystem
  // path produces a directory name nobody can read. Trailing segments have to do
  // — minus the words that only say "a folder of packages lives here", since
  // `apps/web` would otherwise identify a project by neither of its own names.
  const CONTAINERS = new Set(['apps', 'packages', 'libs', 'modules', 'projects', 'src'])
  const segments = rooted
    ? [basename(dir), ...parts]
    : parts.filter(p => !CONTAINERS.has(p)).slice(-2)
  const slug = segments.filter(Boolean).join('-')
  return slug.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'target'
}

/**
 * The TypeScript to parse a project with — theirs where it is usable, ours where
 * it is not.
 *
 * Parsing with the project's own compiler is the right default: it means the
 * analysis cannot disagree with the build the team actually runs. But memos
 * installs TypeScript 7, whose CommonJS entry point is a shim exposing `version`
 * and nothing else, and `require('typescript')` returns it without complaint.
 * Every pass then died on `ts.ScriptTarget.Latest` being undefined — and only
 * after a project's dependencies were installed, so eleven repositories were
 * surveyed without meeting it once.
 *
 * A resolved module is therefore checked for the API before it is believed.
 */
export function loadTypeScript(createRequire, candidates) {
  const usable = (mod) => mod && mod.ScriptTarget && typeof mod.createSourceFile === 'function'
  const rejected = []
  for (const base of candidates) {
    let mod
    try { mod = createRequire(base)('typescript') } catch { continue }
    if (usable(mod)) return { ts: mod, from: base, rejected }
    rejected.push({ base, version: mod?.version, why: 'this build does not expose the compiler API to CommonJS' })
  }
  return { ts: undefined, from: undefined, rejected }
}

/**
 * How far up the project extends — the directories whose configuration this
 * target genuinely inherits.
 *
 * A package in a monorepo inherits its workspace's linters, hooks and CI, and
 * crediting it with none of them is wrong. But climbing a fixed number of levels
 * and taking whatever is there is worse. Pointed at a copy of memos, this reached
 * a scratch directory whose leftover `package.json` declared workspaces, and
 * reported six mechanisms belonging to an unrelated project — a duplication
 * check, a dead-code check, token tiers, agent evals and a gate aggregate, none
 * of which memos has. On a client machine that is `~/work/their-app` inheriting
 * from `~/work`.
 *
 * A repository contains everything beneath it, so `.git` always claims. A
 * workspace claims only what its own globs cover: a root listing `apps/*` does
 * not own a directory that is not one of them, however close it sits.
 */
const WORKSPACE_GLOBS = (dir) => {
  const globs = []
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const w = pkg.workspaces
    if (Array.isArray(w)) globs.push(...w)
    else if (Array.isArray(w?.packages)) globs.push(...w.packages)
  } catch { /* no manifest */ }
  try {
    // Deliberately not a YAML parser: the only shape that matters is a list of
    // quoted globs under `packages:`, and taking a dependency to read six lines
    // buys nothing.
    const yaml = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    for (const m of yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) globs.push(m[1].trim())
  } catch { /* none */ }
  return globs
}

/** Whether a workspace glob covers a path relative to the workspace root. */
const globCovers = (glob, relPath) => {
  if (glob.startsWith('!')) return false
  const pattern = glob.replace(/\/+$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]+')
    .replace(/ /g, '.*')
  // A glob covers the package it names and anything inside it: `apps/*` claims
  // `apps/web` and `apps/web/src` alike.
  return new RegExp(`^${pattern}(/.*)?$`).test(relPath)
}

export function projectRoots(target, maxDepth = 6) {
  const abs = isAbsolute(target) ? target : join(process.cwd(), target)
  const chain = [target]
  let dir = abs
  for (let i = 0; i < maxDepth; i += 1) {
    const up = dirname(dir)
    if (up === dir) break
    dir = up
    chain.push(up)
    if (existsSync(join(up, '.git'))) return chain
    const rel = relative(up, abs).split(sep).join('/')
    if (WORKSPACE_GLOBS(up).some(g => globCovers(g, rel))) return chain
  }
  // Nothing above claims this target, so nothing above is part of it.
  return [target]
}

/**
 * Which view framework this repository is written in, and therefore how much of
 * the measurement applies at all.
 *
 * Nearly everything downstream — screens, component APIs, state branches,
 * jsx-a11y — reads JSX. Run against SvelteKit, every one of those returns zero,
 * and the assessment printed "0 accessibility findings · 0 screens · states
 * handled loading 0% · error 0%" over a repository with no React file in it.
 * Each number was arithmetically true and every one of them was a lie, because a
 * zero means "looked and found none" to anyone reading a report.
 *
 * A tool that cannot see something has to say so in the same breath as the
 * number, so the sections it cannot speak to are marked rather than filled in.
 */
export function detectFramework(files, deps = {}) {
  const count = (test) => files.filter(test).length
  const evidence = {
    react: count(f => /\.[jt]sx$/.test(f)),
    svelte: count(f => f.endsWith('.svelte')),
    vue: count(f => f.endsWith('.vue')),
    // Angular has no extension of its own — a component is a `.ts` file with a
    // decorator on the class. Counting by extension found none of them, so a
    // repository of four hundred components read as "no component file was found".
    angular: count(f => /\.component\.ts$/.test(f)),
  }
  // A dependency is weaker evidence than a file: half the ecosystem lists react
  // in devDependencies for tooling it never renders with.
  const declared = (name) => Object.keys(deps).some(d => d === name || d.startsWith(name + '-') || d.startsWith('@' + name + '/'))
  const ranked = Object.entries(evidence).sort((a, b) => b[1] - a[1])
  const [name, n] = ranked[0]

  if (n === 0) {
    const guess = ['react', 'svelte', 'vue', 'angular'].find(declared)
    return { name: guess ?? 'unknown', files: 0, jsx: false, confident: false,
      why: guess ? `${guess} is declared as a dependency but no component file was found` : 'no React, Svelte, Vue or Angular component file was found' }
  }
  const suffix = { react: '.jsx/.tsx', angular: '.component.ts' }[name] ?? '.' + name
  return { name, files: n, jsx: name === 'react', confident: true, evidence,
    why: `${n} ${suffix} file(s)` }
}

/** What a measurement says when it was never in a position to look. */
export const NOT_APPLICABLE = null

// A single-file component is source with three blocks in it, and the conventions
// worth measuring are the same questions asked of a different syntax: how the
// component is declared, how its props are typed, where its styles live. Ten of ten
// signals returned undefined on a `.vue` file, so a Vue project got a gate that
// enforced nothing — green because it checked nothing, in the layer this whole tool
// is built to prevent that in.
//
// Vue buckets are NAMED DIFFERENTLY from the React ones on purpose. `script setup`
// is not `named export`; calling them the same word would let a distribution mix
// two frameworks' answers into one number, and the number would mean nothing.
const isVue = (abs) => extname(abs) === '.vue'
const isSvelte = (abs) => extname(abs) === '.svelte'
const isSfc = (abs) => isVue(abs) || isSvelte(abs)

// Svelte has no template element: everything outside the script and style blocks is
// markup. That is the whole structural difference from Vue here.
const svelteMarkup = (src) => src
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
// Every block of that tag, not the first one.
//
// A single-file component routinely carries two script blocks — Svelte's
// `<script context="module">` beside its instance script, Vue's `<script>` beside
// `<script setup>` — and reading only the first one skipped the half that declares
// the props. On a Svelte file with a module block, `props declaration` returned
// nothing over a live `export let`, which is a dimension quietly dropping a file
// rather than answering wrongly: harder to notice and just as false.
const sfcBlock = (src, tag) => {
  const found = [...src.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
  if (!found.length) {
    // An unclosed block still carries its attributes and the rest of the file.
    const open = new RegExp(`<${tag}\\b[^>]*>`).exec(src)
    if (!open) return undefined
    return { attrs: open[0], body: src.slice(open.index + open[0].length) }
  }
  return { attrs: found.map(m => m[0].slice(0, m[0].indexOf('>') + 1)).join(' '), body: found.map(m => m[1]).join('\n') }
}

// Which import prefixes this project maps to its own files.
//
// `internal imports` counted `from '@…/'` as an internal alias, so `@angular/core`,
// `@testing-library/react` and `@mui/material` were all read as this team reaching
// for its own code. On an Angular file importing nothing but framework packages the
// dimension answered "alias 100%" over a file with no internal imports at all; on
// one design system, 101 of the alias counts were `@testing-library`.
//
// A scope name cannot be told from an alias by looking at it — `@ds/Button` and
// `@mui/material` are the same shape — so it is resolved instead, from the tsconfig
// or vite config that declares it. Memoised per directory: a signal runs once per
// file and this would otherwise re-read the same config for every one of them.
const aliasCache = new Map()
function aliasRootsFor(abs) {
  let dir = dirname(abs)
  const chain = []
  for (let i = 0; i < 8 && dir && dir !== dirname(dir); i += 1) {
    if (aliasCache.has(dir)) {
      const hit = aliasCache.get(dir)
      for (const d of chain) aliasCache.set(d, hit)
      return hit
    }
    chain.push(dir)
    const configs = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'jsconfig.json',
      'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'svelte.config.js']
      .map(f => join(dir, f)).filter(f => existsSync(f))
    if (configs.length) {
      const roots = new Set()
      for (const file of configs) {
        let text
        try { text = readFileSync(file, 'utf8') } catch { continue }
        // `"@/*": ["./src/*"]` and the alias form `'@app': path.resolve(...)`. Only
        // the key matters here: whether a specifier is this project's own.
        for (const m of text.matchAll(/["']([^"'\s]+?)\/?\*?["']\s*:\s*[[{'"]/g)) {
          const key = m[1].replace(/\/\*$/, '').replace(/\*$/, '')
          if (/^[@~$#][\w.-]*$/.test(key) || /^[a-z][\w.-]*$/i.test(key) === false) roots.add(key)
        }
      }
      // SvelteKit declares `$lib` in its own config and often nowhere else.
      if (configs.some(f => f.endsWith('svelte.config.js'))) roots.add('$lib')
      const value = roots
      for (const d of chain) aliasCache.set(d, value)
      return value
    }
    // A package boundary stops the climb: a nested package does not inherit the
    // aliases of the one above it by accident.
    if (existsSync(join(dir, 'package.json')) && chain.length > 1) break
    dir = dirname(dir)
  }
  const empty = new Set()
  for (const d of chain) aliasCache.set(d, empty)
  return empty
}

/** `@/ui/A` under a project declaring `@/` is internal; `@mui/material` is not. */
const isInternalAlias = (specifier, roots) => {
  // Relative is a dot. `~` was in this class by mistake, which sent `~/ui/A` — an
  // alias in every project that uses one — out before the alias branch could see it.
  if (specifier.startsWith('.')) return false
  // `@/x`, `#/x` and `~/x` carry no scope name, so they can only be an alias.
  if (/^[@#~]\//.test(specifier)) return true
  const head = specifier.split('/')[0]
  return roots.has(head) || roots.has(head + '/')
}

// ── Angular ───────────────────────────────────────────────────────────────────
//
// A component here is not one file. The class and its decorator live in
// `foo.component.ts`, the markup usually in `foo.component.html` beside it, the
// styles in `foo.component.scss`. So the answers to half these questions are in a
// file the signal was not handed.
//
// `.html` is deliberately NOT collected. Adding it would count `index.html` and
// every other page in the repository as a file measured, and nothing reads those —
// the same trade that kept `.svelte` out until its signals existed. The template is
// reached THROUGH the component that declares it, which is also how Angular thinks
// about it: `templateUrl` names one file, and that file belongs to this component.
/**
 * The object inside `@Component({ ... })`, read by balancing braces.
 *
 * This was a regex ending at `\n\s*\}`, which required the decorator's closing
 * brace to sit on a line of its own. That is the common style and it is not the
 * rule: `@Component({ selector: 'x', template: '<p>y</p>' })` on one line is
 * ordinary for a small component, and a project written that way was invisible to
 * every Angular signal at once — not measured wrongly, not measured at all.
 *
 * @returns the decorator's body, or undefined when there is no `@Component`
 */
function componentDecorator(src) {
  const at = /@Component\s*\(\s*\{/.exec(src)
  if (!at) return undefined
  const from = at.index + at[0].length
  let depth = 1, quote
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = undefined; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (!depth) return src.slice(from, i) }
  }
  return undefined
}

// Kept as an object with the shape the call sites use, so `DECORATOR.exec(src)?.[1]`
// keeps reading as it did while the reading underneath it changed.
const DECORATOR = {
  exec: (src) => { const body = componentDecorator(src); return body === undefined ? null : [undefined, body] },
  test: (src) => componentDecorator(src) !== undefined,
}
const isAngular = (abs, src) => /\.ts$/.test(abs) && DECORATOR.test(src)

/** The stylesheet this component names, read from beside it. */
const styleCache = new Map()
function angularStyles(abs, src) {
  if (styleCache.has(abs)) return styleCache.get(abs)
  const decorator = DECORATOR.exec(src)?.[1] ?? ''
  const inline = /styles\s*:\s*\[?\s*`([\s\S]*?)`/.exec(decorator)?.[1]
  let text = inline ?? ''
  for (const m of (/styleUrls?\s*:\s*\[?([^\]}]*)/.exec(decorator)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)) {
    const at = join(dirname(abs), m[1])
    try { if (existsSync(at)) text += '\n' + readFileSync(at, 'utf8') } catch { /* unreadable */ }
  }
  styleCache.set(abs, text)
  return text
}

const templateCache = new Map()
/** The markup this component renders: the inline template, or the file it names. */
function angularTemplate(abs, src) {
  if (templateCache.has(abs)) return templateCache.get(abs)
  const decorator = DECORATOR.exec(src)?.[1] ?? ''
  let markup = /template\s*:\s*`([\s\S]*?)`/.exec(decorator)?.[1]
  if (markup === undefined) {
    const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(decorator)?.[1]
    if (url) {
      const at = join(dirname(abs), url)
      try { markup = existsSync(at) ? readFileSync(at, 'utf8') : undefined } catch { markup = undefined }
    }
  }
  templateCache.set(abs, markup)
  return markup
}

/**
 * Which Angular this file belongs to, from the nearest package.json above it.
 *
 * Read rather than assumed, because the one thing an absent `standalone` flag means
 * changes completely at 19: before it, the component is declared in an NgModule;
 * from it, standalone is the default and the flag is redundant. A pass with no
 * version reads a 15-era project as fully migrated.
 *
 * Cached per directory: a signal runs once per file and a project has one answer.
 * `undefined` where no package.json above the file names Angular — the absence of a
 * flag is then evidence of nothing, and the file leaves the distribution rather than
 * joining the wrong side of it.
 */
const angularVersionCache = new Map()
function angularMajor(abs) {
  let dir = dirname(abs)
  const seen = []
  for (let i = 0; i < 8; i += 1) {
    if (angularVersionCache.has(dir)) {
      const found = angularVersionCache.get(dir)
      for (const d of seen) angularVersionCache.set(d, found)
      return found
    }
    seen.push(dir)
    const at = join(dir, 'package.json')
    if (existsSync(at)) {
      try {
        const p = JSON.parse(readFileSync(at, 'utf8'))
        const v = { ...p.dependencies, ...p.devDependencies }['@angular/core']
        const major = v ? Number(/(\d+)/.exec(String(v))?.[1]) : undefined
        if (major !== undefined && !Number.isNaN(major)) {
          for (const d of seen) angularVersionCache.set(d, major)
          return major
        }
      } catch { }
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  for (const d of seen) angularVersionCache.set(d, undefined)
  return undefined
}

export const SIGNALS = {
  'file structure': (abs, src) => {
    if (isAngular(abs, src)) {
      // The CLI generates a folder per component; a flat tree is a decision somebody
      // made against it, and mixing the two is the drift worth reporting.
      const name = basename(abs, '.ts')
      const parent = basename(dirname(abs))
      return name.replace(/\.component$/, '') === parent
        ? 'Folder/name.component.ts'
        : 'flat name.component.ts'
    }
    const ext = extname(abs)
    if (!['.tsx', '.vue', '.svelte'].includes(ext)) return
    const name = basename(abs, ext)
    const parent = basename(dirname(abs))
    if (name === 'index') return `Folder/index${ext}`
    if (name === parent) return `Folder/Folder${ext}`
    if (/^[A-Z]/.test(name)) return `flat Name${ext}`
  },
  'styling': (abs, src) => {
    if (isAngular(abs, src)) {
      const decorator = DECORATOR.exec(src)?.[1] ?? ''
      // `::ng-deep` pierces view encapsulation, which is the same decision as Vue's
      // `:global` and worth separating from keeping to your own component. It lives
      // in the stylesheet, not in the class — testing the `.ts` alone meant the bucket
      // could only ever fire for a component with inline styles.
      const pierces = /::ng-deep/.test(angularStyles(abs, src))
      if (/styleUrls?\s*:/.test(decorator)) return pierces ? 'styleUrls with ::ng-deep' : 'styleUrls'
      if (/styles\s*:/.test(decorator)) return 'inline styles'
      return
    }
    if (isSvelte(abs)) {
      // A Svelte `<style>` block is scoped by default, so there is no scoped/unscoped
      // axis to measure. What varies is whether the component carries its styles at
      // all, and whether it reaches out of its own scope with `:global`.
      const style = sfcBlock(src, 'style')
      if (style && /:global\s*\(/.test(style.body)) return 'Svelte <style> with :global'
      if (style) return 'Svelte <style>'
      if (/from ['"]\.\/[^'"]*\.css['"]|@import/.test(src)) return 'stylesheet imported'
      if (/\bclass:/.test(src)) return 'class: directives'
      if (/\bclass=/.test(src)) return 'class, styles elsewhere'
      return
    }
    if (isVue(abs)) {
      // Where an SFC keeps its styles is a real convention with four common
      // answers, and it is not the same axis as a React file's.
      const style = sfcBlock(src, 'style')
      if (style?.attrs.includes('module')) return 'SFC <style module>'
      if (style?.attrs.includes('scoped')) return 'SFC <style scoped>'
      if (style) return 'SFC <style>'
      if (/@import ['"]|from ['"]\.\/[^'"]*\.css['"]/.test(src)) return 'stylesheet imported'
      if (/\bclass=/.test(src)) return 'class, styles elsewhere'
      return
    }
    if (!/\.tsx?$/.test(abs)) return
    if (/from ['"][^'"]*\.module\.css['"]/.test(src)) return 'CSS Modules'
    if (/\bstyled[.(]/.test(src) || /from ['"]@emotion|styled-components['"]/.test(src)) return 'styled'
    if (/\bsx=\{/.test(src)) return 'MUI sx'
    if (/className="[^"]*\b(flex|grid|p[xytblr]?-\d|m[xytblr]?-\d|text-(xs|sm|base|lg|xl)|bg-\w+-\d00)\b/.test(src)) return 'utility classes'
    if (/import ['"]\.\/[^'"]*\.css['"]/.test(src)) return 'plain co-located CSS'
    if (/className=/.test(src)) return 'className, styles elsewhere'
  },
  'component export': (abs, src) => {
    if (isAngular(abs, src)) {
      // The live migration: standalone components from 14, the default from 19, and
      // an NgModule-declared component is the form teams are leaving.
      const decorator = DECORATOR.exec(src)?.[1] ?? ''
      if (/standalone\s*:\s*false/.test(decorator)) return 'NgModule declaration'
      if (/standalone\s*:\s*true/.test(decorator)) return 'standalone'

      // An absent flag means opposite things on either side of Angular 19, so the
      // version decides — the same way the Svelte emitter reads its version rather
      // than guessing the era.
      //
      // Measured on ngx-admin, which is on 15: 136 components, not one carrying the
      // flag, and sixteen NgModules declaring them. This returned `standalone by
      // default 100%` — the exact opposite of the truth, at a share that would have
      // been written into that client's gate as an enforced convention.
      const major = angularMajor(abs)
      if (major === undefined) return undefined
      return major >= 19 ? 'standalone by default' : 'NgModule declaration'
    }
    if (isSvelte(abs)) return
    if (isVue(abs)) {
      // The Vue equivalent of the same question: which way the component is
      // declared. Three answers are in wide use and mixing them is the drift.
      if (/<script[^>]*\bsetup\b/.test(src)) return 'script setup'
      if (/defineComponent\s*\(/.test(src)) return 'defineComponent'
      if (/export default\s*\{/.test(src)) return 'Options API'
      return
    }
    if (extname(abs) !== '.tsx') return
    if (/export default/.test(src)) return 'default'
    if (/export (function|const) [A-Z]/.test(src)) return 'named'
  },
  'props declaration': (abs, src) => {
    if (isAngular(abs, src)) {
      // The second live migration, and independent of the first: a repository is
      // routinely standalone and still on the decorator.
      const decorator = /@Input\s*\(/.test(src)
      const signal = /=\s*input(\.required)?\s*[<(]/.test(src)
      if (decorator && signal) return 'both @Input() and input()'
      if (signal) return 'input() signals'
      if (decorator) return '@Input() decorator'
      return
    }
    if (isSvelte(abs)) {
      // The live split in every Svelte codebase mid-migration: `export let` through
      // version 4, `$props()` from 5. Both in one file is not a third style, it is
      // the migration caught in the act, and worth reporting as its own answer.
      const script = sfcBlock(src, 'script')?.body ?? ''
      const runes = /\$props\s*\(/.test(script)
      const legacy = /^\s*export\s+let\s+\w/m.test(script)
      if (runes && legacy) return 'both export let and $props()'
      if (runes) return '$props() runes'
      if (legacy) return 'export let'
      return
    }
    if (isVue(abs)) {
      if (!/defineProps/.test(src)) return
      // A runtime object and a type argument are different contracts, and an
      // inline literal is a third: it cannot be reused or exported.
      if (/defineProps\s*\(\s*\{/.test(src)) return 'runtime object'
      if (/defineProps\s*<\s*\{/.test(src)) return 'inline type'
      const named = /defineProps\s*<\s*(\w+)\s*>/.exec(src)?.[1]
      if (!named) return
      if (new RegExp(`interface ${named}\\b`).test(src)) return 'interface Props'
      if (new RegExp(`type ${named}\\s*=`).test(src)) return 'type Props'
      return 'imported type'
    }
    if (!/\.tsx?$/.test(abs)) return
    const hasInterface = /interface \w*Props\b/.test(src)
    const hasType = /type \w*Props\s*=/.test(src)
    if (hasInterface && !hasType) return 'interface Props'
    if (hasType && !hasInterface) return 'type Props'
    if (hasInterface && hasType) return 'both in one file'
  },
  'handler naming': (abs, src) => {
    if (isAngular(abs, src)) {
      const markup = angularTemplate(abs, src) ?? ''
      const both = src + '\n' + markup
      const handle = (both.match(/\bhandle[A-Z]\w*\s*\(/g) ?? []).length
      const on = (both.match(/\bon[A-Z]\w*\s*\(/g) ?? []).length
      if (handle === 0 && on === 0) return
      return handle >= on ? 'handleX' : 'onX'
    }
    const ext = extname(abs)
    if (!['.tsx', '.vue', '.svelte'].includes(ext)) return
    // In an SFC a handler is as often named only at the call site in the markup as it
    // is declared in the script, so both are counted. Svelte writes the call site two
    // ways — `on:click={handleGo}` through version 4 and `onclick={handleGo}` from 5 —
    // and both are the same naming question.
    const handle = (src.match(/(?:const|function) handle[A-Z]|(?:on:|@|:)?(?:click|submit|input|change)=[{"]handle[A-Z]/g) ?? []).length
    const on = (src.match(/(?:const|function) on[A-Z]|(?:on:|@|:)?(?:click|submit|input|change)=[{"]on[A-Z]/g) ?? []).length
    if (handle === 0 && on === 0) return
    return handle >= on ? 'handleX' : 'onX'
  },
  'internal imports': (abs, src) => {
    if (!/\.(tsx?|vue|svelte)$/.test(abs)) return
    const roots = aliasRootsFor(abs)
    const alias = [...src.matchAll(/from ['"]([^'"]+)['"]/g)]
      .filter(m => isInternalAlias(m[1], roots)).length
    const rel = (src.match(/from ['"]\.\.?\//g) ?? []).length
    // Neither kind present means this file reaches for nothing of its own, and a
    // file with only package imports has no answer to give here.
    if (alias === 0 && rel === 0) return
    return alias >= rel ? 'alias' : 'relative'
  },
  'test placement': (abs) => {
    if (!/\.(test|spec)\.tsx?$/.test(abs)) return
    return abs.includes(`${sep}__tests__${sep}`) || abs.includes(`${sep}test${sep}`)
      ? 'separate test folder'
      : 'co-located'
  },
  'colour values': (abs, src) => {
    if (/tokens?|primitive|palette|theme/i.test(abs)) return
    const hex = (src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length
    const varRef = (src.match(/var\(--|theme\.palette|useToken\(/g) ?? []).length
    if (hex === 0 && varRef === 0) return
    return varRef >= hex ? 'from tokens' : 'literal hex'
  },
  'sizing values': (abs, src) => {
    if (/tokens?|primitive|settings|reset/i.test(abs)) return
    // An SFC keeps its sizes in its own <style> block, so reading only .css files
    // measured none of them.
    const styles = isSfc(abs) ? sfcBlock(src, 'style')?.body
      // An Angular component keeps its sizes in a sibling stylesheet, which is
      // collected on its own, or inline in the decorator, which is not.
      : isAngular(abs, src) ? angularStyles(abs, src)
      : /\.(css|scss)$/.test(abs) ? src : undefined
    if (styles === undefined) return
    const px = (styles.match(/\b\d{1,4}px\b/g) ?? []).length
    const varRef = (styles.match(/var\(--/g) ?? []).length
    if (px === 0 && varRef === 0) return
    return varRef >= px ? 'from tokens' : 'literal px'
  },
  // A dimension only one ecosystem currently has an answer for, and it earns its
  // place because that answer is a migration in progress: `*ngIf` and `*ngFor` are
  // the structural directives, `@if` and `@for` the block syntax from 17. A file
  // holding both is a file two people edited to different standards.
  //
  // Every other framework returns nothing here, so no installed gate acquires a rule
  // it did not have.
  'template control flow': (abs, src) => {
    if (!isAngular(abs, src)) return
    const markup = angularTemplate(abs, src)
    if (!markup) return
    const blocks = (markup.match(/@(if|for|switch)\s*[({]/g) ?? []).length
    const directives = (markup.match(/\*ng(If|For|Switch)\b/g) ?? []).length
    if (blocks === 0 && directives === 0) return
    if (blocks > 0 && directives > 0) return 'both blocks and *ngIf'
    return blocks > 0 ? '@if blocks' : '*ngIf directives'
  },
  'user-facing text': (abs, src) => {
    if (isAngular(abs, src)) {
      const markup = angularTemplate(abs, src)
      if (!markup || !/>[^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*</.test(markup)) return
      // `| translate`, `$localize` and the `i18n` attribute are the three ways this
      // ecosystem takes text out of the template.
      // The `i18n` attribute is usually bare — `<span i18n>Text</span>` — and this
      // required a `=` or a `[` after it. On PeerTube, which ships in dozens of
      // languages, 237 of 300 templates carry the marker and the pass reported
      // `literal in template 100%, translated 0%`. That number goes into the gate
      // as an enforced convention, so a client would have been handed a rule
      // telling every future file not to translate.
      //
      // Whitespace before it and a delimiter after keeps it an attribute rather
      // than the word appearing in prose. `i18n-title` and `i18n-ariaLabel` are the
      // same mechanism applied to an attribute and count too.
      return /\|\s*translate\b|\$localize|\si18n(?=[\s=>\]-])/.test(markup) ? 'translated' : 'literal in template'
    }
    const ext = extname(abs)
    if (!['.tsx', '.vue', '.svelte'].includes(ext)) return
    const markup = isSvelte(abs) ? svelteMarkup(src)
      : isVue(abs) ? sfcBlock(src, 'template')?.body
      : src
    if (!markup) return
    if (!/>[^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*</.test(markup)) return
    // `$_(` and `$t(` are the svelte-i18n stores, read as values in markup.
    if (/\bt\(['"`]|\$t\(|\$_\(|i18nKey|<Trans\b|v-t\b/.test(src)) return 'translated'
    // The React bucket keeps its original name. Every gate already installed in a
    // client repository has `literal in JSX` written into its conventions.json, and
    // renaming the value here would make every file in the project a violation of a
    // rule nobody changed — a red gate caused by an edit to this tool, which is the
    // fastest way to have a gate switched off.
    return isVue(abs) ? 'literal in template'
      : isSvelte(abs) ? 'literal in markup'
      : 'literal in JSX'
  },
}
