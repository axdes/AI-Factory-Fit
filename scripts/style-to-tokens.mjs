/**
 * Turn a style read off a client's site into tokens, and compare it with what
 * their code actually ships.
 *
 * Two jobs, both of which were missing while the style extractor wrote a file
 * nobody read:
 *
 *   tokens    a DTCG token layer built from the client's real visual language,
 *             so a new project starts from what they already ship rather than
 *             from a default palette
 *   compare   the drift report: what the site uses and the code does not, and
 *             the reverse. This is the argument nobody can have without numbers,
 *             and every client has some version of it running unresolved
 *
 * Naming stays judgment. Where the site declares a custom property we take its
 * name, because the team chose it. Where it does not, values are emitted ranked
 * by use and left unnamed: inventing `--primary` for the colour that happens to
 * appear most is exactly the kind of guess that reads as a fact later.
 *
 *   node scripts/style-to-tokens.mjs <style-id> [--out <profile-id>]
 *   node scripts/style-to-tokens.mjs <style-id> --compare <profile-id>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const styleId = process.argv[2]
const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const OUT = flag('--out')
const COMPARE = flag('--compare')

const stylePath = styleId && join(root, 'styles', styleId, 'style.json')
if (!styleId || !existsSync(stylePath)) {
  console.error('usage: node scripts/style-to-tokens.mjs <style-id> [--out <profile-id>] [--compare <profile-id>]')
  console.error('Read a site first: node scripts/style-from-site.mjs <url> --out <style-id>')
  process.exit(2)
}

const style = JSON.parse(readFileSync(stylePath, 'utf8'))

// ── Colour normalisation, so two spellings of one colour are one colour ───────

const parseColour = (value) => {
  // The DTCG stable format stores a colour as a typed object with components in
  // 0..1, not as a hex string. Reading only strings found one colour in a profile
  // that holds sixty-five — and this tool cites that specification elsewhere,
  // which makes not speaking it the worse kind of gap.
  if (value && typeof value === 'object' && Array.isArray(value.components)) {
    const [r, g, b] = value.components
    if ([r, g, b].every(c => typeof c === 'number')) return [r * 255, g * 255, b * 255]
    return undefined
  }
  const text = String(value).trim().toLowerCase()
  let m = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  }
  m = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return undefined
}
const toHex = (rgb) => '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')

/** Collapses spellings to one canonical hex, keeping the total use count. */
function canonicalColours(entries) {
  const byHex = new Map()
  for (const { value, uses } of entries) {
    const rgb = parseColour(value)
    if (!rgb) continue
    const hex = toHex(rgb)
    const existing = byHex.get(hex)
    if (existing) existing.uses += uses
    else byHex.set(hex, { hex, uses, written: value })
  }
  return [...byHex.values()].sort((a, b) => b.uses - a.uses)
}

const palette = canonicalColours(style.palette ?? [])
const named = (style.namedColours ?? [])
  .map(c => ({ ...c, rgb: parseColour(c.value) }))
  .filter(c => c.rgb)
  .map(c => ({ ...c, hex: toHex(c.rgb) }))

// ── tokens ────────────────────────────────────────────────────────────────────

const token = (value, type, note) => ({
  $value: value,
  ...type ? { $type: type } : {},
  $extensions: { 'org.ds-profile': { readFrom: style.source.url, ...note } },
})

function buildTokens() {
  const tokens = {
    $description: `Read from ${style.source.url}. Values are the client's; the naming is not, except where they named it themselves.`,
  }

  if (named.length) {
    tokens.named = Object.fromEntries(named.map(c => [
      c.name.replace(/^--/, ''),
      token(c.hex, 'color', { source: 'a custom property the site declares', writtenAs: c.value }),
    ]))
  }

  tokens.palette = Object.fromEntries(palette.slice(0, 16).map((c, i) => [
    // Ranked, not named. The most-used colour is not necessarily "primary", and
    // saying so would turn a count into a claim about intent.
    String(i + 1).padStart(2, '0'),
    token(c.hex, 'color', { uses: c.uses, rank: i + 1 }),
  ]))

  const scale = (entries, type) => Object.fromEntries((entries ?? []).map((e, i) => [
    String(i + 1).padStart(2, '0'), token(e.value, type, { uses: e.uses }),
  ]))

  tokens.spacing = scale(style.spacing, 'dimension')
  tokens.radius = scale(style.radii, 'dimension')
  tokens.breakpoint = scale(style.breakpoints, 'dimension')
  tokens.duration = scale(style.motion, 'duration')

  tokens.font = {
    family: Object.fromEntries((style.typography?.families ?? []).map((f, i) => [
      i === 0 ? 'default' : `alt-${i}`,
      token(f.value.split(',').map(s => s.trim()), 'fontFamily', { uses: f.uses }),
    ])),
    size: scale(style.typography?.sizes, 'dimension'),
    weight: Object.fromEntries((style.typography?.weights ?? []).map(w => [
      w.value, token(Number(w.value) || w.value, 'number', { uses: w.uses }),
    ])),
  }

  return tokens
}

// ── compare ───────────────────────────────────────────────────────────────────

function flattenProfileTokens(node, path = [], out = []) {
  if (node === null || typeof node !== 'object') return out
  if ('$value' in node) { out.push({ id: path.join('.'), value: node.$value }); return out }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    flattenProfileTokens(child, [...path, key], out)
  }
  return out
}

if (COMPARE) {
  // Three places a client's visual language is written down, and they disagree:
  // the design file says what was decided, the live site says what was shipped,
  // and the code says what is maintained. Comparing two of them and calling the
  // result drift picks a winner by accident — the finding is which of the three
  // hold a colour and which do not.
  //
  // `--compare a,b` takes as many profiles as there are sources. The output used
  // to say "in the code" whatever it had been given, so a comparison against a
  // Figma export reported design decisions as code.
  const ids = COMPARE.split(',').map(s => s.trim()).filter(Boolean)
  const sources = []
  for (const id of ids) {
    const at = join(root, 'profiles', id, 'tokens.json')
    if (!existsSync(at)) {
      console.error(`style-to-tokens: no profile "${id}"`)
      process.exit(1)
    }
    const document = JSON.parse(readFileSync(at, 'utf8'))
    const leaves = flattenProfileTokens(document)
    const byId = new Map(leaves.map(l => [l.id, l.value]))

    /** Follows a DTCG alias — `{color.brand.400}` — to the value it points at. */
    const resolve = (value, seen = new Set()) => {
      if (typeof value !== 'string') return value
      const alias = value.match(/^\{([^}]+)\}$/)
      if (!alias || seen.has(alias[1]) || !byId.has(alias[1])) return value
      return resolve(byId.get(alias[1]), new Set([...seen, alias[1]]))
    }

    const colours = new Map()
    for (const leaf of leaves) {
      const rgb = parseColour(resolve(leaf.value))
      if (rgb) colours.set(toHex(rgb), leaf.id)
    }
    // Named by what produced it, so a Figma export is never reported as code.
    const what = /figma/i.test(String(document.$description ?? '')) ? 'Figma'
      : /site|shipped/i.test(String(document.$description ?? '')) ? 'the site'
      : 'the code'
    sources.push({ id, what, colours })
  }

  const siteColours = new Map(palette.map(c => [c.hex, c.uses]))
  for (const c of named) if (!siteColours.has(c.hex)) siteColours.set(c.hex, 0)

  const columns = ['site', ...sources.map(s => s.id)]
  const every = new Set([...siteColours.keys(), ...sources.flatMap(s => [...s.colours.keys()])])

  console.log(`\ndrift: ${style.source.url}  vs  ${sources.map(s => `${s.id} (${s.what})`).join('  vs  ')}`)
  // Counted per source, because "85 across three" hides a source that contributed
  // nothing — and reading a profile as empty is the failure this whole file has
  // already had once, when typed DTCG colour objects were skipped and a registry
  // of sixty-five colours read as one.
  console.log([`${siteColours.size} on the site`, ...sources.map(s => `${s.colours.size} in ${s.id}`)].join(', ')
    + `; ${every.size} distinct across ${columns.length} source(s)\n`)

  const has = (hex) => [siteColours.has(hex), ...sources.map(s => s.colours.has(hex))]
  const rows = [...every].map(hex => ({ hex, marks: has(hex), uses: siteColours.get(hex) ?? 0 }))
  const agreed = rows.filter(r => r.marks.every(Boolean))
  const disputed = rows.filter(r => r.marks.some(Boolean) && !r.marks.every(Boolean))

  console.log(`  ${'colour'.padEnd(10)}${columns.map(c => c.slice(0, 12).padEnd(13)).join('')}`)
  console.log(`  ${'─'.repeat(9)} ${columns.map(() => '─'.repeat(12)).join(' ')}`)
  for (const r of [...agreed, ...disputed.sort((a, b) => b.uses - a.uses)].slice(0, 16)) {
    const cells = r.marks.map((m, i) => (m
      ? (i === 0 ? (r.uses ? `yes ${r.uses}×` : 'declared') : sources[i - 1].colours.get(r.hex).slice(0, 12))
      : '—').padEnd(13))
    console.log(`  ${r.hex.padEnd(10)}${cells.join('')}`)
  }

  console.log(`\n  ${agreed.length} colour(s) every source holds · ${disputed.length} held by some and not others`)
  console.log('\nMatched by value, not by name: two systems rarely agree on names and always')
  console.log('agree on hex. A colour in the design file and not on the site is a decision that')
  console.log('never shipped; one on the site and nowhere else is a decision nobody recorded.')
  console.log('Neither is a defect on its own — but nobody can have that argument without this.')
  process.exit(0)
}

// ── write ─────────────────────────────────────────────────────────────────────

const tokens = buildTokens()
const count = JSON.stringify(tokens).split('"$value"').length - 1

if (OUT) {
  const outDir = join(root, 'profiles', OUT)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n')
}

console.log(`\ntokens from ${style.source.url}`)
console.log(`${count} token(s): ${Object.keys(tokens.named ?? {}).length} the site names itself, the rest ranked by use\n`)
console.log(`  palette      ${palette.slice(0, 6).map(c => `${c.hex}(${c.uses})`).join('  ')}`)
console.log(`  spacing      ${(style.spacing ?? []).map(s => s.value).join('  ') || '—'}`)
console.log(`  radius       ${(style.radii ?? []).map(s => s.value).join('  ') || '—'}`)
console.log(`  font size    ${(style.typography?.sizes ?? []).map(s => s.value).join('  ') || '—'}`)
console.log(`  breakpoints  ${(style.breakpoints ?? []).map(s => s.value).join('  ') || '—'}`)

console.log(`\nNaming is left undone on purpose: calling the most-used colour "primary" turns`)
console.log('a count into a claim about intent. A person names these, once, and then they')
console.log('are the client\'s tokens rather than ours.')
if (OUT) console.log(`\nwritten to profiles/${OUT}/tokens.json`)
else console.log('\nAdd --out <profile-id> to keep them.')
