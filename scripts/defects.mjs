/**
 * Defect detectors over a repository, producing counts a client cannot argue with.
 *
 * The conventions scan says a project is inconsistent. This says what is broken.
 * The difference matters on the first day: "your imports are split 54/46" is an
 * observation, "14 colour pairs fail WCAG AA" is a defect with a standard behind
 * it and an owner.
 *
 * Everything here is static. That is a real limit and it is reported rather than
 * hidden: a token assembled at runtime is invisible to the dead-token pass, and
 * an accessible name supplied by a wrapper is invisible to the a11y pass. Each
 * detector states what it cannot see, so a zero is never mistaken for a clean
 * bill of health.
 *
 *   node scripts/defects.mjs <repo> [--exclude ds,brand]
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import postcss from 'postcss'
import { walk, TOOL_EXT, detectFramework, scanSlot, installedHere } from './lib/signals.mjs'
import { styleSource } from './lib/sfc.mjs'
import { taken } from './lib/taken.mjs'
import { counted, countedLine } from './lib/counted.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const excludeArg = process.argv.indexOf('--exclude')
const EXCLUDED = excludeArg === -1
  ? []
  : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/defects.mjs <repo> [--exclude ds,brand]')
  process.exit(2)
}

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const ours = installedHere(target)
const all = walk(target, [], TOOL_EXT).filter(a => !ours(a))
const owned = all.filter(abs => !excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep)))
const rel = (abs) => relative(target, abs).split(sep).join('/')
const read = (abs) => { try { return readFileSync(abs, 'utf8') } catch { return '' } }

// A single-file component's rules live in its `<style>` block, so collecting only
// `.css` and `.scss` saw none of them: on a Vue project this pass examined zero
// files for literals and printed a zero, which reads as a clean bill.
// An Angular component may keep its rules in the decorator rather than beside the
// class, and a `.ts` holding a `styles:` block is a stylesheet as far as contrast and
// dead tokens are concerned.
const ANGULAR_INLINE = /@Component\s*\([\s\S]*?\bstyles\s*:\s*\[?\s*`/
const css = all.filter(f => /\.(css|scss|vue|svelte)$/.test(f)
  || (/\.ts$/.test(f) && ANGULAR_INLINE.test(read(f))))

/** The CSS a file contributes: all of it, or the part of it that is CSS. */
const cssOf = (abs) => {
  if (/\.(vue|svelte)$/.test(abs)) return styleSource(read(abs))
  if (/\.ts$/.test(abs)) {
    const text = read(abs)
    return [...text.matchAll(/\bstyles\s*:\s*\[?\s*`([\s\S]*?)`/g)].map(m => m[1]).join('\n')
  }
  return read(abs)
}
const code = owned.filter(f => /\.(tsx?|jsx?)$/.test(f) && !/\.(test|spec)\./.test(f))

// ── Colour maths, WCAG 2.2 ────────────────────────────────────────────────────

function parseColour(value) {
  const text = String(value).trim()
  let m = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  }
  m = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return undefined
}

const luminance = ([r, g, b]) => {
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── Tokens: declared, referenced, resolvable ──────────────────────────────────

// CSS is parsed, not pattern-matched. The regex version mistook a declaration
// inside a comment for a token, cut multi-line values at the first newline, and
// could not see into @media or @supports — three ways to be wrong about a file
// that a parser is simply right about.
const parsedCss = []
const unparsedCss = []
for (const file of css) {
  try {
    const text = cssOf(file)
    // An SFC with no <style> block contributes nothing, and handing PostCSS an empty
    // string to parse is a rule count of zero dressed up as a parsed stylesheet.
    if (!text.trim()) continue
    parsedCss.push({ file, ast: postcss.parse(text, { from: file }) })
  } catch (error) {
    unparsedCss.push({ file: rel(file), reason: error.message.split('\n')[0] })
  }
}

const declared = new Map()   // name -> { value, file }
for (const { file, ast } of parsedCss) {
  ast.walkDecls(decl => {
    if (!decl.prop.startsWith('--')) return
    // A token declared in several theme blocks keeps its first value for
    // resolution; the themes are reported separately by the contrast pass.
    if (!declared.has(decl.prop)) declared.set(decl.prop, { value: decl.value.trim(), file: rel(file) })
  })
}

const referenceCount = new Map()
for (const file of all) {
  for (const m of read(file).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    referenceCount.set(m[1], (referenceCount.get(m[1]) ?? 0) + 1)
  }
}

/** Follows var() aliases to a literal colour, or gives up rather than guessing. */
function resolveColour(name, seen = new Set()) {
  if (seen.has(name)) return undefined
  // A literal is already the colour. Only token names were resolvable, so a rule
  // written with hexes produced no pair at all and the report said "0 contrast
  // failures" over text at 1.61:1 — the most confident possible silence, in the one
  // number a client reads as a verdict.
  if (!name.startsWith('--')) return parseColour(name)
  const entry = declared.get(name)
  if (!entry) return undefined
  const direct = parseColour(entry.value)
  if (direct) return direct
  const alias = entry.value.match(/var\(\s*(--[a-z0-9-]+)/i)
  if (alias) return resolveColour(alias[1], new Set([...seen, name]))
  return undefined
}

const deadTokens = [...declared.keys()]
  .filter(name => !(referenceCount.get(name) > 0))
  .sort()

// ── Contrast ──────────────────────────────────────────────────────────────────
//
// Pairs come from co-occurrence in a rule, never from token names. Pairing by
// name multiplies every foreground against every background and invents failures
// between colours that never meet on screen: measured against a design system
// whose own contrast gate passes cleanly, the naming approach reported 29
// failures, all of them fabricated. A rule that sets both `color` and a
// `background` is evidence that those two render together.
//
// The cost of being right here is coverage: text on an inherited background is
// invisible to this pass. Under-reporting with a stated limit beats over-reporting
// with a confident number.

// A state rule that repaints the same element. `.checkbox-box` sets the page
// colour and a foreground; `.checkbox-input:checked + .checkbox-box` sets the
// primary colour, and the foreground is only visible in that second state. The
// pair from the base rule co-occurs in the stylesheet and never renders together,
// which is how a design system whose own contrast gate passes was reported at
// 1:1 — the sharpest possible false positive, on a component that is fine.
const repainted = new Map()
for (const { ast } of parsedCss) {
  ast.walkRules(rule => {
    const paints = (rule.nodes ?? []).some(n => n.type === 'decl'
      && (n.prop === 'background' || n.prop === 'background-color'))
    if (!paints) return
    for (const part of rule.selector.split(',')) {
      // The last simple selector is the element being painted, whatever leads to
      // it: `.a:checked + .b` repaints `.b`.
      const subject = part.trim().split(/\s*[+>~ ]\s*/).pop()
      if (!subject) continue
      const base = subject.replace(/(:{1,2}[\w-]+(\([^)]*\))?)+$/, '')
      if (!base || base === subject) continue
      repainted.set(base, (repainted.get(base) ?? 0) + 1)
    }
  })
}

const rulePairs = new Map()
for (const { file, ast } of parsedCss) {
  ast.walkRules(rule => {
    let fg, bg
    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue
      // A token reference or a literal, and nothing else: `inherit`,
      // `transparent` and `currentColor` name a colour this pass cannot know, and
      // guessing one is how a fabricated failure gets into a report.
      const token = node.value.match(/var\(\s*(--[a-z0-9-]+)/i)?.[1]
        ?? (parseColour(node.value.trim()) ? node.value.trim() : undefined)
      if (!token) continue
      if (node.prop === 'color') fg = token
      if (node.prop === 'background' || node.prop === 'background-color') bg = token
    }
    if (!fg || !bg || fg === bg) return

    // Where a state rule repaints this same element, the background in THIS rule
    // is not necessarily the one the foreground is read against. Recorded as
    // unresolved rather than as a failure: under-reporting with a stated reason
    // beats a confident number about a state that never renders.
    const subject = rule.selector.split(',')[0].trim().split(/\s*[+>~ ]\s*/).pop() ?? ''
    if (repainted.has(subject)) {
      rulePairs.set(`${fg}|${bg}`, {
        fg, bg, file: rel(file), selector: rule.selector.slice(0, 60),
        stateOverridden: `${subject} is repainted by a state rule, so this background is not the one this foreground is read against`,
      })
      return
    }
    rulePairs.set(`${fg}|${bg}`, { fg, bg, file: rel(file), selector: rule.selector.slice(0, 60) })
  })
}

const contrastChecked = []
const contrastFailures = []
const contrastUnresolved = []
for (const pair of rulePairs.values()) {
  if (pair.stateOverridden) { contrastUnresolved.push(pair); continue }
  const fgColour = resolveColour(pair.fg)
  const bgColour = resolveColour(pair.bg)
  if (!fgColour || !bgColour) { contrastUnresolved.push(pair); continue }
  const ratio = Number(contrastRatio(fgColour, bgColour).toFixed(2))
  contrastChecked.push({ ...pair, ratio })
  if (ratio < 4.5) contrastFailures.push({ ...pair, ratio, needs: 4.5 })
}
contrastFailures.sort((a, b) => a.ratio - b.ratio)

// ── Hardcoded values in product code ──────────────────────────────────────────

const isTokenFile = (f) => /tokens?|primitive|settings|palette|theme|reset/i.test(f)
const hardcoded = []
const styleable = owned.filter(f => /\.(css|scss|tsx?|jsx?|vue|svelte)$/.test(f))
for (const file of styleable) {
  if (isTokenFile(file)) continue
  const text = read(file)
  const hex = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length
  const px = [...text.matchAll(/\b\d{1,4}px\b/g)].length
  if (hex + px > 0) hardcoded.push({ file: rel(file), hex, px, total: hex + px })
}
hardcoded.sort((a, b) => b.total - a.total)

// ── Accessibility, delegated to a real linter ─────────────────────────────────
//
// This used to be four hand-written patterns. oxlint ships a port of
// eslint-plugin-jsx-a11y — around thirty rules whose false positives the
// community has already shaken out — and checks a large codebase in seconds.
// Measured on the same repository the hand-written version found one finding and
// this finds twenty-four. Writing our own was how we got here quickly; keeping
// our own would have been a choice to be worse on purpose.

// Delegating a check means inheriting its failure modes, and two repositories
// here produced the same clean-looking zero for two different reasons — both of
// them the project's own `.oxlintrc.json`, which oxlint discovers and applies.
//
// tldraw's config oxlint rejects outright: `options.typeAware` is root-only, so
// it exits having linted nothing. Reading only the exit code, that is
// indistinguishable from a pass, and 286 files were reported as accessible.
//
// outline's is worse because nothing goes wrong. Its config enumerates rules
// explicitly, which replaces the category we asked for, so jsx-a11y is simply
// switched off. Every file is read, no error is raised, and the honest-looking
// zero was hiding seventy findings.
//
// So the measurement always runs against our own config. Their configuration
// governs their build; it does not get to decide what our audit is allowed to
// see. And the run is only believed when oxlint reports how many files it read —
// absent or zero means no result rather than a good one.
function runA11y(dir) {
  const bin = join(root, 'node_modules', '.bin', 'oxlint')
  if (!existsSync(bin)) return { findings: [], available: false, why: 'oxlint is not installed' }

  const args = ['--jsx-a11y-plugin', '--react-plugin', '-D', 'correctness', '--format=json',
    '--config', join(root, 'config', 'a11y.oxlintrc.json'), dir]
  let out
  try {
    out = execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // A non-zero exit is the normal case: it is how a linter reports findings.
    // Only the absence of parseable output means the run itself failed.
    if (typeof error.stdout !== 'string') throw error
    out = error.stdout
  }

  let filesLinted
  try { filesLinted = JSON.parse(out).number_of_files } catch { filesLinted = undefined }
  if (!filesLinted) return { findings: [], available: false, why: 'oxlint produced no file count, so it did not lint anything here' }
  return { findings: parseA11y(out), available: true, filesLinted }
}

function parseA11y(out) {
  let parsed
  try { parsed = JSON.parse(out) } catch { return [] }
  const diagnostics = parsed.diagnostics ?? (Array.isArray(parsed) ? parsed : [])
  return diagnostics
    .filter(d => /jsx-a11y/.test(d.code ?? d.ruleId ?? ''))
    .map(d => ({
      rule: (d.code ?? d.ruleId ?? '').replace(/^jsx-a11y[()]*/, '').replace(/[()]/g, ''),
      file: d.filename ? rel(join(target, relative(target, d.filename))) : (d.labels?.[0]?.file ?? '?'),
      detail: d.message ?? '',
      standard: 'WCAG via jsx-a11y',
    }))
}

// oxlint reads JSX. Pointed at SvelteKit it lints every `.js` file, reports a
// perfectly true zero, and the assessment prints "0 accessibility findings" over
// ninety-nine `.svelte` components nobody checked. The count is withheld rather
// than shown as clean.
const a11yScope = join(target, existsSync(join(target, 'src')) ? 'src' : '.')
const framework = detectFramework(
  walk(target, [], new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte', '.vue'])),
  (() => { try { const p = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')); return { ...p.dependencies, ...p.devDependencies } } catch { return {} } })(),
)
/**
 * Accessibility on Svelte, from the compiler the project already has.
 *
 * This was checked on React and nowhere else: every Vue, Svelte and Angular project
 * reported NOT RUN, while the same tool cites WCAG 2.2 and the ARIA authoring
 * practices as the two standards it holds a project to. Three of four frameworks were
 * held to nothing.
 *
 * Svelte needs no plugin — its compiler emits `a11y_*` warnings itself, and it is
 * installed in every Svelte project by definition. Three lines of careless markup
 * produce four of them. Delegating to what is already there is the same move as
 * handing the dependency audit to the project's own package manager.
 *
 * Vue and Angular have no equivalent in the box: each needs a plugin the project may
 * not have, and the refusal below names it rather than implying nothing exists.
 */
function runSvelteA11y() {
  let compiler
  try { compiler = createRequire(join(target, 'package.json'))('svelte/compiler') } catch {
    return { findings: [], available: false, why: 'this project is svelte and its compiler could not be loaded from here, so no accessibility analysis ran' }
  }
  if (typeof compiler.compile !== 'function') {
    return { findings: [], available: false, why: 'the svelte compiler here exposes no compile(), so no accessibility analysis ran' }
  }
  const files = walk(target, [], new Set(['.svelte']))
    .filter(abs => !excludedPrefixes.some(p => abs === p || abs.startsWith(p + sep)))
  const findings = []
  let linted = 0
  for (const abs of files) {
    let text
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    let result
    try { result = compiler.compile(text, { filename: abs, generate: 'client' }) } catch { continue }
    linted += 1
    for (const w of result.warnings ?? []) {
      const code = String(w.code ?? '')
      if (!code.startsWith('a11y')) continue
      findings.push({
        file: rel(abs),
        line: w.start?.line ?? 0,
        rule: code,
        message: String(w.message ?? '').split('\n')[0],
        standard: 'WCAG via the Svelte compiler',
      })
    }
  }
  if (!linted) return { findings: [], available: false, why: 'no .svelte file could be compiled here, so no accessibility analysis ran' }
  return { findings, available: true, filesLinted: linted, by: "the Svelte compiler's own a11y warnings" }
}

const a11yRun = framework.jsx
  ? runA11y(a11yScope)
  : framework.name === 'svelte'
    ? runSvelteA11y()
    : {
        findings: [],
        available: false,
        why: `these rules read JSX and this project is ${framework.name} — ${framework.why}. `
          + `${framework.name === 'vue' ? 'eslint-plugin-vuejs-accessibility' : '@angular-eslint/template with its a11y rules'} would read it; nothing here does`,
      }
const a11y = a11yRun.findings

// ── Near-duplicate modules ────────────────────────────────────────────────────
// The signal worth having is "this was built twice", which is a whole-file
// similarity question rather than a repeated-block one.

const shingle = (text) => {
  const tokens = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
    .replace(/['"`][^'"`]*['"`]/g, '"s"')
    .match(/[A-Za-z_$][\w$]*|[{}()[\];,.<>=+\-*/]/g) ?? []
  const set = new Set()
  for (let i = 0; i + 5 <= tokens.length; i += 1) set.add(tokens.slice(i, i + 5).join(' '))
  return set
}

const candidates = code.filter(f => /\.[jt]sx$/.test(f)).map(f => ({ file: f, set: shingle(read(f)) }))
  .filter(c => c.set.size >= 40)

// A size bound before any set is intersected, derived rather than tuned.
//
// This compared every pair: on a 2,829-file project that is four million comparisons
// and sixteen of the pass's eighteen seconds, to find sixty duplicates. The bound is
// exact, so nothing is missed —
//
//   J = |a∩b| / (|a| + |b| - |a∩b|) >= t
//     → |a∩b| >= t(|a| + |b|) / (1 + t)
//   and |a∩b| <= min(|a|, |b|), so
//     min(|a|, |b|) >= t(|a| + |b|) / (1 + t)
//
// At t = 0.5 that is max <= 2 x min: two files whose shingle counts differ by more
// than a factor of two cannot reach 0.5 however much they share. Sorting by size lets
// the inner loop stop at the first file too large, rather than running to the end.
const THRESHOLD = 0.5
const MAX_RATIO = (1 + THRESHOLD) / THRESHOLD - 1  // 2 at t = 0.5
const bySize = [...candidates].sort((x, y) => x.set.size - y.set.size)

const duplicates = []
let comparisons = 0
for (let i = 0; i < bySize.length; i += 1) {
  const a = bySize[i]
  for (let j = i + 1; j < bySize.length; j += 1) {
    const b = bySize[j]
    // Sorted ascending, so once one is too large every one after it is too.
    if (b.set.size > a.set.size * MAX_RATIO) break
    comparisons += 1
    let shared = 0
    // Iterate the smaller set: the work is one lookup per member of it.
    const [small, large] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set]
    for (const s of small) if (large.has(s)) shared += 1
    const jaccard = shared / (a.set.size + b.set.size - shared)
    if (jaccard >= THRESHOLD) {
      duplicates.push({ a: rel(a.file), b: rel(b.file), similarity: Number(jaccard.toFixed(2)) })
    }
  }
}
duplicates.sort((x, y) => y.similarity - x.similarity)

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
  counts: {
    deadTokens: deadTokens.length,
    contrastFailures: contrastFailures.length,
    // null, not 0, when the linter never ran. Everything downstream reads this
    // count, and a 0 propagates as "checked and clean" into the report, the
    // exemplar cautions and the assessment summary alike.
    a11yFindings: a11yRun.available ? a11y.length : null,
    hardcodedValues: hardcoded.reduce((n, f) => n + f.total, 0),
    duplicatePairs: duplicates.length,
  },
  // The denominators. Every count above is a number over one of these, and until
  // they were written here they existed only in a console line the JSON readers
  // never see — so a repository nothing could be read from reported five zeros
  // and looked cleaner than one that had been measured.
  considered: {
    files: owned.length,
    tokensDeclared: declared.size,
    contrastPairs: contrastChecked.length,
    styleableFiles: styleable.length,
    modules: code.length,
  },
  limits: {
    deadTokens: 'Static. A token assembled at runtime or referenced from outside this tree reads as dead.',
    cssParsing: unparsedCss.length
      ? `${unparsedCss.length} stylesheet(s) did not parse and were skipped entirely: ${unparsedCss.map(u => u.file).join(', ')}`
      : 'every stylesheet parsed',
    contrast: `Pairs come from rules that set both color and background, which is evidence they render together — never from token names, which invents failures. ${contrastChecked.length} pair(s) compared, ${contrastUnresolved.length} skipped because a token did not resolve to a literal. Text on an inherited background is invisible to this pass.`,
    a11y: a11yRun.available
      ? `From ${a11yRun.by ?? "oxlint's jsx-a11y rules"} over ${a11yRun.filesLinted} file(s): static analysis, so anything needing a rendered tree — computed contrast, focus order, live regions — is out of scope. A floor, not an audit.`
      : `${a11yRun.why}, so no accessibility analysis ran. This is not a clean result; it is no result.`,
    duplication: 'Whole-file similarity over 5-token shingles at 0.5 Jaccard. Finds the same thing built twice; does not find a repeated block inside one file.',
  },
  deadTokens,
  contrastFailures,
  contrastCheckedPairs: contrastChecked.length,
  a11y,
  hardcoded: hardcoded.slice(0, 20),
  duplicates,
}
writeFileSync(join(outDir, 'defects.json'), JSON.stringify(report, null, 2) + '\n')

console.log(`\ndefects: ${target}`)
console.log(`${owned.length} owned file(s) · ${declared.size} token(s) declared\n`)

const line = (label, value, note) => console.log(`  ${String(value).padStart(5)}  ${label}${note ? `  — ${note}` : ''}`)
// Both of these printed a bare `0` over a denominator that lived in the header, one
// line above. On a project declaring no tokens that reads as "no dead tokens", and on
// one whose colours never co-occur in a rule it reads as "contrast is fine" — the
// exact pair of zeros this tool was built to stop reporting, still being reported by
// it. The note carried the denominator; the digit in the left column did not, and the
// digit is what gets read.
console.log(countedLine('dead tokens',
  counted(deadTokens.length, declared.size, 'token'), 'declared and never referenced'))
console.log(countedLine('contrast failures',
  counted(contrastFailures.length, contrastChecked.length, 'pair'),
  `of ${contrastChecked.length} pair(s) found co-occurring in a rule, WCAG AA 4.5:1`))
// A zero here has to say which zero it is. "Nothing found" and "nothing looked"
// print the same digit, and only one of them is good news.
console.log(a11yRun.available
  // Name the thing that actually looked. On a Svelte project this said "oxlint
  // jsx-a11y" about a count produced by the Svelte compiler.
  ? `  ${String(a11y.length).padStart(5)}  accessibility findings  — ${a11yRun.by ?? 'oxlint jsx-a11y rules'} over ${a11yRun.filesLinted} file(s)`
  : `      —  accessibility findings  — NOT RUN: ${a11yRun.why}`)
/**
 * What this project's own scan says about the same question.
 *
 * A hardcoded colour is a defect against an external standard: tokens are better
 * than literals. Whether this project agrees is a separate fact, and it is measured
 * one pass over. On formbricks the gate enforces `colour values → literal hex` at
 * 95% while this line reports 20 literal values as a defect — the same tool telling
 * the same team, in the same run, that literals are their convention and that
 * literals are a problem. A team reading both stops trusting either.
 *
 * The finding stands: the standard is real and worth stating. What it must not do is
 * present itself as conformance when the project's own measured convention says the
 * opposite. So the disagreement is named, and named where it is read.
 */
const ownConvention = (() => {
  try {
    const scan = JSON.parse(readFileSync(join(outDir, 'scan.json'), 'utf8'))
    const c = scan.conventions?.['colour values']
    return c && c.verdict !== 'too few to say' ? c : undefined
  } catch { return undefined }
})()
const writesLiterals = ownConvention && /literal/i.test(String(ownConvention.dominant))

line('hardcoded values', report.counts.hardcodedValues, `across ${hardcoded.length} file(s) outside token files`)
if (writesLiterals) {
  console.log(`         this project's own convention is \`${ownConvention.dominant}\` at ${Math.round(ownConvention.share * 100)}%,`)
  console.log('         so the count above is measured against an outside standard this project has')
  console.log('         not adopted — a recommendation to put to the team, not a conformance failure')
}
line('near-duplicate modules', duplicates.length, 'pairs above 0.5 similarity')

if (contrastFailures.length) {
  console.log('\nworst contrast pairs:')
  for (const f of contrastFailures.slice(0, 5)) {
    console.log(`  ${f.ratio.toFixed(2)}:1  ${f.fg} on ${f.bg}  (needs ${f.needs}:1)  ${f.file}${f.selector ? ` — ${f.selector}` : ''}`)
  }
}
if (a11y.length) {
  const byRule = {}
  for (const f of a11y) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  console.log('\naccessibility findings by rule:')
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rule}`)
}
if (duplicates.length) {
  console.log('\nbuilt twice:')
  for (const d of duplicates.slice(0, 5)) console.log(`  ${d.similarity}  ${d.a}  ~  ${d.b}`)
}
if (hardcoded.length) {
  console.log('\nworst files for hardcoded values:')
  for (const f of hardcoded.slice(0, 5)) console.log(`  ${String(f.total).padStart(4)}  ${f.file}  (${f.hex} hex, ${f.px} px)`)
}

console.log(`\nwritten to scans/${name}/defects.json`)
console.log('Every count above is static. What each detector cannot see is recorded in the report.')
