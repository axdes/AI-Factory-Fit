/**
 * Reconstruct a client's visual language from what they have already shipped.
 *
 * A project with no code is rarely a client with nothing. There is almost always
 * a live site, and a live site is the design decisions already made and already
 * public: the palette, the type scale, the spacing rhythm, the radii, the
 * breakpoints. Asking a client to describe their style produces adjectives;
 * reading their site produces values.
 *
 * Static by choice: the HTML and the stylesheets it links, parsed. No browser, so
 * this runs anywhere — and so it sees what is declared rather than what is
 * computed. A site that builds its palette at runtime, or ships styles only
 * through JavaScript, will under-report, and the report says so.
 *
 * Frequency is the signal. A value used three hundred times is the scale; a value
 * used once is somebody's exception. Ranking by use is what separates the system
 * from the noise without anyone having to declare which is which.
 *
 *   node scripts/style-from-site.mjs <url> [--out <id>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const url = process.argv[2]
const outArg = process.argv.indexOf('--out')
const OUT = outArg === -1 ? undefined : process.argv[outArg + 1]

if (!url || !/^https?:\/\//.test(url)) {
  console.error('usage: node scripts/style-from-site.mjs <url> [--out <id>]')
  process.exit(2)
}

// What needs bounding is bytes and requests, not files. A page linking fifty
// stylesheets is rarely fifty times the work — most of them are small. Capping at
// twelve files read 12 of linear.app's 54 links, stopped at 297 KB, and discarded
// three quarters of the evidence while well inside any byte budget worth having.
// Frequency is the signal here, so a truncated read does not merely see less; it
// ranks wrong.
const MAX_CSS_BYTES = 2 * 1024 * 1024
const MAX_REQUESTS = 100

async function get(target) {
  const response = await fetch(target, {
    headers: { 'user-agent': 'ai-factoryfit style reader', accept: 'text/html,text/css,*/*' },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.text()
}

let html
try {
  html = await get(url)
} catch (error) {
  console.error(`style-from-site: could not read ${url} — ${error.message}`)
  process.exit(1)
}

// ── Collect the stylesheets the page actually links ───────────────────────────

const base = new URL(url)
const hrefs = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)]
  .map(tag => (tag[0].match(/href=["']([^"']+)["']/i) ?? [])[1])
  .filter(Boolean)
  .map(href => { try { return new URL(href, base).toString() } catch { return undefined } })
  .filter(Boolean)

const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1])

// Never requested and requested-but-failed are different facts about the read, and
// reporting both as "could not be fetched" described 42 sheets nobody had asked for.
const sheets = []
let bytes = 0
let failed = 0
let skipped = 0
for (const [i, href] of hrefs.entries()) {
  if (i >= MAX_REQUESTS || bytes >= MAX_CSS_BYTES) { skipped = hrefs.length - i; break }
  try {
    const css = await get(href)
    bytes += css.length
    sheets.push({ href, css })
  } catch { failed += 1 }
}
const css = [...inline, ...sheets.map(s => s.css)].join('\n')

if (css.length < 200) {
  console.error('style-from-site: almost no CSS was readable from this page.')
  console.error('The site probably injects its styles through JavaScript, which a static read cannot see.')
  process.exit(1)
}

// ── Frequency is the signal ───────────────────────────────────────────────────

const tally = (matches, normalise = (v) => v) => {
  const counts = new Map()
  for (const m of matches) {
    const value = normalise(typeof m === 'string' ? m : m[1])
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const expandHex = (hex) => hex.length === 4
  ? '#' + hex.slice(1).split('').map(c => c + c).join('').toLowerCase()
  : hex.toLowerCase()

// Modern colour syntax nests: `rgb(88 196 220 / var(--opacity))`. A pattern that
// stops at the first bracket cuts it in half and reports a colour nobody wrote.
const colours = tally(
  [...css.matchAll(/(#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|rgba?\((?:[^()]|\([^()]*\))*\))/g)],
  v => v.startsWith('#') ? expandHex(v) : v.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim(),
)

const fontFamilies = tally(
  [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)],
  v => v.trim().replace(/\s*,\s*/g, ', ').replace(/["']/g, '').slice(0, 80),
)

const numeric = (property, unit = 'px|rem|em') => tally(
  [...css.matchAll(new RegExp(`${property}\\s*:\\s*(-?[\\d.]+(?:${unit}))`, 'gi'))],
)

const fontSizes = numeric('font-size')
const radii = numeric('border-radius')
const lineHeights = tally([...css.matchAll(/line-height\s*:\s*([\d.]+(?:px|rem|em)?)/gi)])
const fontWeights = tally([...css.matchAll(/font-weight\s*:\s*(\d{3}|bold|normal)/gi)])
const shadows = tally([...css.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)], v => v.trim().slice(0, 60))
const durations = tally([...css.matchAll(/(?:transition|animation)[^:;}]*:\s*[^;}]*?([\d.]+m?s)/gi)])

const spacing = tally([
  ...css.matchAll(/(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*(-?[\d.]+(?:px|rem))/gi),
])

const breakpoints = tally([...css.matchAll(/@media[^{]*?([\d.]+px)/g)])

// Custom properties are the strongest evidence there is: a site that ships them
// has already decided what its system is, and we are reading it rather than
// inferring it.
const customProperties = tally([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)])
const colourProperties = [...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g)]
  .map(m => ({ name: m[1], value: m[2].trim() }))

/** Keeps the values that carry the scale and drops the long tail of exceptions. */
const scaleOf = (entries, minUses = 3, take = 12) => entries
  .filter(([, n]) => n >= minUses)
  .slice(0, take)
  .map(([value, n]) => ({ value, uses: n }))

const numericSort = (entries) => [...entries].sort((a, b) => parseFloat(a.value) - parseFloat(b.value))

/**
 * What an empty scale means, which is two different things.
 *
 * Every scale here has a frequency bar — three uses for a colour, four for a
 * spacing value — because a value used once is a one-off and a scale built from
 * one-offs is noise. That is right, and the report printed `—` for both "nothing was
 * declared" and "things were declared and none reached the bar". On a page plainly
 * carrying four colours, three font sizes and two gaps, three of the five sections
 * came back `—` and read as a site with no palette, no typography and no spacing.
 *
 * The counts exist either way. Saying which of the two it is costs one line and is
 * the difference between a measurement and a shrug.
 */
const shortfall = (raw, minUses, show = 4) => {
  const seen = raw.filter(([, n]) => n < minUses)
  if (!seen.length) return 'nothing of this kind is declared here'
  const top = seen.slice(0, show).map(([v, n]) => `${v} ×${n}`).join(' · ')
  return `nothing reached ${minUses} use(s) — most-used: ${top}${seen.length > show ? ` (+${seen.length - show} more)` : ''}`
}

// Said in the report as well as recorded in the file. A partial read that only
// shows up in JSON is a partial read nobody applies to the numbers above it.
const partialRead = [
  failed ? `${failed} stylesheet(s) could not be fetched` : undefined,
  skipped ? `${skipped} were never requested — the read stopped at its byte or request budget` : undefined,
].filter(Boolean).join('; ') || undefined

const styleProfile = {
  schemaVersion: 1,
  source: { url, stylesheets: sheets.length, inlineBlocks: inline.length, cssBytes: css.length },
  readable: {
    linkedStylesheetsFound: hrefs.length,
    stylesheetsRead: sheets.length,
    stylesheetsFailed: failed,
    stylesheetsSkipped: skipped,
    note: partialRead,
  },
  hasDesignSystem: customProperties.length >= 20,
  customProperties: customProperties.length,
  palette: scaleOf(colours, 3, 16),
  namedColours: colourProperties.slice(0, 24),
  typography: {
    families: scaleOf(fontFamilies, 2, 5),
    sizes: numericSort(scaleOf(fontSizes, 3, 12)),
    weights: scaleOf(fontWeights, 2, 6),
    lineHeights: scaleOf(lineHeights, 3, 6),
  },
  spacing: numericSort(scaleOf(spacing, 4, 12)),
  radii: numericSort(scaleOf(radii, 2, 8)),
  shadows: scaleOf(shadows, 2, 5),
  motion: scaleOf(durations, 2, 5),
  breakpoints: numericSort(scaleOf(breakpoints, 1, 8)),
  limits: [
    'Static read: styles injected at runtime, or values computed in JavaScript, are invisible.',
    'Frequency counts declarations in the stylesheet, not renders on the page. A rule in dead CSS counts.',
    'Colours are counted as written; the same colour in hex and rgb form counts twice.',
    partialRead ? `Partial read: ${partialRead}. Frequency ranks what was read, so the order is provisional.` : undefined,
  ].filter(Boolean),
}

if (OUT) {
  const outDir = join(root, 'styles', OUT)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'style.json'), JSON.stringify(styleProfile, null, 2) + '\n')
}

// ── Report ────────────────────────────────────────────────────────────────────

const list = (items, format = (i) => `${i.value} (${i.uses})`) =>
  items.length ? items.map(format).join('  ') : '—'

console.log(`\nstyle: ${url}`)
console.log(`${sheets.length}/${hrefs.length} stylesheet(s) read, ${inline.length} inline block(s), ${Math.round(css.length / 1024)} KB of CSS\n`)

console.log(styleProfile.hasDesignSystem
  ? `DESIGN SYSTEM — ${customProperties.length} custom properties; this site ships a token layer, so we read it rather than infer it`
  : `NO TOKEN LAYER — ${customProperties.length} custom properties; the scales below are inferred from frequency`)

console.log('\nPALETTE — ranked by use')
if (styleProfile.palette.length) {
  for (const c of styleProfile.palette.slice(0, 10)) console.log(`  ${String(c.uses).padStart(4)}  ${c.value}`)
} else {
  console.log(`     —  ${shortfall(colours, 3)}`)
}

if (styleProfile.namedColours.length) {
  console.log('\nNAMED COLOURS — the site\'s own names for them')
  for (const c of styleProfile.namedColours.slice(0, 8)) console.log(`        ${c.name}: ${c.value}`)
}

// Each line either shows the scale or says why there is none.
const scaleLine = (label, scale, raw, minUses, render = (i) => i.value) => {
  console.log(`  ${label.padEnd(11)} ${scale.length ? list(scale, render) : '—'}`)
  if (!scale.length) console.log(`  ${''.padEnd(11)} ${shortfall(raw, minUses)}`)
}

console.log('\nTYPOGRAPHY')
scaleLine('families', styleProfile.typography.families, fontFamilies, 2, i => i.value.split(',')[0])
scaleLine('sizes', styleProfile.typography.sizes, fontSizes, 3)
scaleLine('weights', styleProfile.typography.weights, fontWeights, 2)
scaleLine('line height', styleProfile.typography.lineHeights, lineHeights, 3)

console.log('\nSCALES')
scaleLine('spacing', styleProfile.spacing, spacing, 4)
scaleLine('radii', styleProfile.radii, radii, 2)
scaleLine('breakpoints', styleProfile.breakpoints, breakpoints, 1)
scaleLine('motion', styleProfile.motion, durations, 2)

if (styleProfile.shadows.length) {
  console.log('\nELEVATION')
  for (const s of styleProfile.shadows) console.log(`  ${String(s.uses).padStart(4)}  ${s.value}`)
}

console.log('\nWhat this cannot see:')
for (const limit of styleProfile.limits) console.log(`  · ${limit}`)
if (OUT) console.log(`\nwritten to styles/${OUT}/style.json`)
else console.log('\nAdd --out <id> to keep this as a style profile.')
