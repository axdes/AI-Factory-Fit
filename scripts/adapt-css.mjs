/**
 * Adapter: a CSS framework into a library profile.
 *
 * The case this tool was asked about first. A team has a CSS framework, hand
 * written over years, and it is the source of truth for itself — which means
 * nothing can check it. This reads it into the same profile format everything
 * else consumes, so it can be checked, compared and built on.
 *
 * A CSS framework declares its components as class families with variants, and
 * three notations are in wide use:
 *
 *   .btn[data-variant="primary"]   attribute variants — the closed set is visible
 *   .btn--primary                  BEM modifiers
 *   .btn.is-loading                state classes
 *
 * All three are read. What cannot be read from CSS is what the component is FOR,
 * which is the judgment tier again: a stylesheet says how a thing looks and never
 * why you would reach for it.
 *
 * Parsed with PostCSS. Selector text is where a regex is least reliable and the
 * consequences are quietest — a missed variant becomes a value an agent is free
 * to invent.
 *
 *   node scripts/adapt-css.mjs <css-dir> --out <profile-id>
 *   node scripts/adapt-css.mjs <css-dir> --compare <profile-id>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { walk } from './lib/signals.mjs'
import { writeUnwrittenTiers } from './lib/profile-stubs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const OUT = flag('--out')
const COMPARE = flag('--compare')

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/adapt-css.mjs <css-dir> --out <profile-id> [--compare <profile-id>]')
  process.exit(2)
}

const files = walk(target, [], new Set(['.css', '.scss']))
if (files.length === 0) {
  console.error(`adapt-css: no stylesheets under ${target}`)
  process.exit(1)
}

const rel = (abs) => relative(target, abs).split(sep).join('/')

const sheets = []
const unreadable = []
for (const file of files) {
  try { sheets.push({ file, ast: postcss.parse(readFileSync(file, 'utf8'), { from: file }) }) } catch (error) {
    unreadable.push({ file: rel(file), reason: error.message.split('\n')[0] })
  }
}

// ── Tokens ────────────────────────────────────────────────────────────────────
// The tier a token belongs to is readable from where it is declared, when the
// framework separates its layers into files. When it does not, everything lands
// in one tier and the report says so rather than inventing a hierarchy.

const TIER_BY_FILE = [
  [/settings|config|knobs/i, 'settings'],
  [/primitive|palette|scale|base/i, 'primitive'],
  [/semantic|role|theme|token/i, 'semantic'],
]

const tokens = new Map()
for (const { file, ast } of sheets) {
  const tier = (TIER_BY_FILE.find(([pattern]) => pattern.test(file)) ?? [, 'unclassified'])[1]
  ast.walkDecls(decl => {
    if (!decl.prop.startsWith('--')) return
    if (tokens.has(decl.prop)) return
    const scope = decl.parent?.selector ?? ':root'
    tokens.set(decl.prop, { name: decl.prop, value: decl.value.trim(), tier, file: rel(file), scope })
  })
}

const tiers = {}
for (const t of tokens.values()) tiers[t.tier] = (tiers[t.tier] ?? 0) + 1

// ── Components: class families and their variants ─────────────────────────────

/** `.btn[data-variant="primary"]:hover` → base `btn`, variant, state. */
function readSelector(selector) {
  const out = []
  for (const part of selector.split(',')) {
    const text = part.trim()

    // The base name stops at the BEM separators, and getting this wrong silently
    // deleted one of the three notations this file claims to read.
    //
    // `[\w-]*` is greedy and `-` is a word character here, so `.card--elevated`
    // read as a family CALLED `card--elevated`. The modifier test that follows then
    // looked for `.card--elevated--x` and found nothing, so every BEM modifier
    // became its own one-rule family, fell under whatever threshold makes something
    // a component, and was counted among the utilities. `card` itself was left with
    // no variants and dropped too.
    //
    // Attribute variants and `.is-` state classes survived only because their
    // separators are not `-`. Which is the failure this file's own header warns
    // about: a missed variant becomes a value an agent is free to invent.
    //
    // A single hyphen is part of a name (`.btn-group`); a double hyphen is a
    // modifier; an underscore pair is an element.
    const base = text.match(/^\.([a-z][a-z\d]*(?:-(?!-)[a-z\d][\w]*)*)/i)?.[1]
    if (!base) continue

    const attributes = [...text.matchAll(/\[data-([\w-]+)(?:\s*=\s*["']([^"']+)["'])?\]/g)]
      .map(m => ({ prop: m[1], value: m[2] }))
    const modifier = text.match(new RegExp(`^\\.${base}--([\\w-]+)`))?.[1]
    const stateClass = text.match(new RegExp(`^\\.${base}\\.(is-|has-)([\\w-]+)`))?.[2]
    const pseudo = [...text.matchAll(/:(hover|focus|focus-visible|active|disabled|checked)\b/g)].map(m => m[1])
    const element = text.match(new RegExp(`^\\.${base}__([\\w-]+)`))?.[1]

    out.push({ base, attributes, modifier, stateClass, pseudo, element })
  }
  return out
}

const families = new Map()
for (const { file, ast } of sheets) {
  ast.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return
    for (const parsed of readSelector(rule.selector)) {
      const family = families.get(parsed.base) ?? {
        base: parsed.base,
        variants: new Map(),
        states: new Set(),
        elements: new Set(),
        declarations: 0,
        files: new Set(),
      }
      family.files.add(rel(file))
      family.declarations += rule.nodes?.filter(n => n.type === 'decl').length ?? 0
      for (const attr of parsed.attributes) {
        const values = family.variants.get(attr.prop) ?? new Set()
        if (attr.value) values.add(attr.value)
        family.variants.set(attr.prop, values)
      }
      if (parsed.modifier) {
        const values = family.variants.get('modifier') ?? new Set()
        values.add(parsed.modifier)
        family.variants.set('modifier', values)
      }
      if (parsed.stateClass) family.states.add(parsed.stateClass)
      for (const p of parsed.pseudo) family.states.add(p)
      if (parsed.element) family.elements.add(parsed.element)
      families.set(parsed.base, family)
    }
  })
}

// A class that styles one thing and has no variants, states or parts is a utility
// or a one-off, not a component. Calling it one inflates the registry with names
// an agent would then try to use.
const components = {}
const utilities = []
for (const family of families.values()) {
  const hasShape = family.variants.size > 0 || family.states.size > 0 || family.elements.size > 0
  if (!hasShape && family.declarations < 4) { utilities.push(family.base); continue }

  const name = family.base.split(/[-_]/).map(p => p[0]?.toUpperCase() + p.slice(1)).join('')
  components[name] = {
    ref: name,
    selector: `.${family.base}`,
    from: `css:${[...family.files][0]}`,
    props: [...family.variants.entries()]
      .filter(([, values]) => values.size > 0)
      .map(([prop, values]) => ({
        name: prop === 'modifier' ? 'variant' : prop,
        type: [...values].map(v => `'${v}'`).join(' | '),
        required: false,
        values: [...values].sort(),
      })),
    variants: Object.fromEntries([...family.variants.entries()]
      .filter(([, values]) => values.size > 0)
      .map(([prop, values]) => [prop, { prop: prop === 'modifier' ? 'variant' : prop, values: [...values].sort() }])),
    states: [...family.states].sort(),
    parts: [...family.elements].sort().map(e => `${name}__${e}`),
    declarations: family.declarations,
    uses: [],
  }
}

// ── Compare with a profile built another way ──────────────────────────────────

if (COMPARE) {
  const path = join(root, 'profiles', COMPARE, 'components.json')
  if (!existsSync(path)) { console.error(`adapt-css: no profile "${COMPARE}"`); process.exit(1) }
  const other = JSON.parse(readFileSync(path, 'utf8')).components

  const fromCss = new Set(Object.keys(components))
  const fromCode = new Set(Object.keys(other))
  const both = [...fromCss].filter(n => fromCode.has(n))

  console.log(`\nadapt-css: ${target}\ncompared with profile "${COMPARE}", which was read from source rather than from CSS\n`)
  console.log(`  ${String(fromCss.size).padStart(4)}  families found in CSS`)
  console.log(`  ${String(fromCode.size).padStart(4)}  components in the profile`)
  console.log(`  ${String(both.length).padStart(4)}  present in both\n`)

  const variantAgreement = []
  for (const name of both) {
    const cssVariants = components[name].variants
    const codeVariants = other[name].variants ?? {}
    for (const [prop, v] of Object.entries(cssVariants)) {
      const codeProp = codeVariants[prop === 'modifier' ? 'variant' : prop]
      // A registry entry can carry a variant with a null value list — a CSS
      // variant reachable through no prop at all. That is a finding of its own,
      // not something to compare against.
      if (!codeProp || !Array.isArray(codeProp.values)) continue
      const missingInCss = codeProp.values.filter(x => !v.values.includes(x))
      const extraInCss = v.values.filter(x => !codeProp.values.includes(x))
      variantAgreement.push({ name, prop, missingInCss, extraInCss, agree: !missingInCss.length && !extraInCss.length })
    }
  }
  const agreeing = variantAgreement.filter(v => v.agree).length
  console.log(`VARIANT UNIONS: ${agreeing}/${variantAgreement.length} agree between CSS and source`)
  for (const v of variantAgreement.filter(v => !v.agree).slice(0, 8)) {
    console.log(`  ${v.name}.${v.prop}`)
    if (v.missingInCss.length) console.log(`    in the source, not in the CSS: ${v.missingInCss.join(', ')}`)
    if (v.extraInCss.length) console.log(`    in the CSS, not in the source: ${v.extraInCss.join(', ')}`)
  }

  const cssOnly = [...fromCss].filter(n => !fromCode.has(n))
  console.log(`\nIN CSS, NOT IN THE PROFILE (${cssOnly.length}): ${cssOnly.slice(0, 12).join(', ')}`)
  console.log('These are class families with no component behind them — either the CSS')
  console.log('outlived its component, or the component was never in the registry.')
  process.exit(0)
}

// ── Write ─────────────────────────────────────────────────────────────────────

if (OUT) {
  const outDir = join(root, 'profiles', OUT)
  mkdirSync(outDir, { recursive: true })
  const write = (file, data) => writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + '\n')

  write('components.json', { schemaVersion: 1, components, blocks: {} })
  write('tokens.json', {
    $description: `Read from the stylesheets under ${target}.`,
    ...Object.fromEntries([...tokens.values()].map(t => [
      t.name.replace(/^--/, ''),
      { $value: t.value, $extensions: { 'org.ds-profile': { tier: t.tier, source: t.file, scope: t.scope } } },
    ])),
  })
  writeUnwrittenTiers(outDir, {
    id: OUT,
    adapter: 'adapt-css.mjs',
    library: { name: basename(target), kind: 'first-party', source: target },
    // A stylesheet contains no level, no surface and no description. Class families
    // and their variants are facts and are extracted; what a component is FOR is
    // authored, and saying so is the difference between an incomplete profile and a
    // dishonest one. This once named `policy.json` and `judgment.json` as evidence
    // and then wrote neither file — 323 components shipped with a profile claiming
    // all three tiers were in place.
    facts: 'extracted from the stylesheets; complete',
    counts: { components: Object.keys(components).length, blocks: 0, tokens: tokens.size },
  })
}

console.log(`\nadapt-css: ${target}`)
console.log(`${sheets.length} stylesheet(s) parsed${unreadable.length ? `, ${unreadable.length} unreadable` : ''}\n`)

console.log('FACTS — read from the stylesheets')
console.log(`  ${String(tokens.size).padStart(4)}  custom properties`)
console.log(`        tiers: ${Object.entries(tiers).map(([t, n]) => `${t} ${n}`).join(' · ')}`)
console.log(`  ${String(Object.keys(components).length).padStart(4)}  class families with variants, states or parts`)
console.log(`  ${String(utilities.length).padStart(4)}  utilities and one-offs, not treated as components`)

const withVariants = Object.values(components).filter(c => Object.keys(c.variants).length)
console.log(`  ${String(withVariants.length).padStart(4)}  families whose variants form a closed set`)

console.log('\nEXAMPLES')
for (const c of withVariants.slice(0, 6)) {
  const v = Object.entries(c.variants).map(([k, x]) => `${k}: ${x.values.join('|')}`).join('   ')
  console.log(`  ${c.ref.padEnd(14)} ${v.slice(0, 90)}`)
}

// Whether this project keeps its components in CSS at all.
//
// On memos — a Tailwind project — this parsed six stylesheets, found seventy-six
// custom properties and six class families, five of which were one BEM block, and
// reported it in the same tone as a full extraction. The next command in the chain
// then proposed a binding for 0 of 26 roles, which is correct and useless, and the
// chain stopped there with nothing saying why.
//
// A project whose components are TSX with utility classes has its components
// somewhere this pass cannot read, and that is a fact about where to look rather
// than a fact about the project.
// The reasoning above is about proportion, and the first version of this check was
// an absolute count — which fired on a four-stylesheet CSS framework holding three
// families and four tokens, a small system rather than a misread one. Measured:
//
//   a real CSS framework      323 families / 234 tokens   =  1.38
//   a small one (fixture)       3 families /   4 tokens   =  0.75
//   a Tailwind project          6 families /  76 tokens   =  0.08
//
// Lopsided, not small, is the signal — and only once there are enough tokens for
// the ratio to mean anything.
const familyCount = Object.keys(components).length
const ratio = tokens.size ? familyCount / tokens.size : undefined
if (tokens.size >= 20 && ratio !== undefined && ratio < 0.15) {
  console.log('\nTHIS IS PROBABLY THE WRONG EXTRACTOR HERE')
  console.log(`  ${familyCount} class family/families across ${sheets.length} stylesheet(s), against ${tokens.size} custom`)
  console.log('  properties. A design system declared in CSS has families and variants in')
  console.log('  proportion to its tokens; this has tokens and almost no families, which is')
  console.log('  what a utility-class project looks like from here — the components are in')
  console.log('  the component files, not in the stylesheets.')
  console.log('')
  console.log('  Read them where they are:')
  console.log('    ds adapt:react <components-dir> --out <id> --alias <import-alias>')
  console.log('')
  console.log('  The tokens above are still real and still worth keeping. It is the')
  console.log('  component list that is thin, and thin because of where this looked.')
}

console.log('\nJUDGMENT — not in here')
console.log('  A stylesheet says how a thing looks and never why you would reach for it.')
console.log('  Descriptions, levels, surfaces and confusable pairs are authored, as with any library.')
if (OUT) console.log(`\nwritten to profiles/${OUT}/`)
