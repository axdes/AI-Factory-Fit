/**
 * Names for an extracted token layer — proposed, and each one measured.
 *
 * The facts tier refuses to name anything, and it is right to: `#1A73E8` is a
 * colour, and calling it `--colour-primary` is a claim about intent that a picture
 * cannot carry. But a layer of `colour-1 … colour-4` is where the design path stops.
 * Nothing can be bound to a role, nothing can be written into a stylesheet, and a
 * client is handed a list of hexes.
 *
 * Some of the names are not judgment. Which colour is the page ground is read from
 * the edges of the picture. Which is the text is whichever has the most contrast
 * against that ground, and contrast is arithmetic. Which is the accent is whichever
 * is most saturated and is neither, and saturation is arithmetic too. A surface is a
 * colour within a few units of the ground that still covers a large share — the white
 * card on an off-white page.
 *
 * So this proposes those four and stops. `--colour-success` is not in here: nothing
 * in a picture says green means success rather than a brand colour that happens to be
 * green, and a name nobody can defend is the kind a team rejects on sight — which
 * discredits the twelve that were defensible.
 *
 *   node scripts/name-tokens.mjs <profile-id> [--out <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const PROFILE = process.argv[2]
const outFlag = process.argv.indexOf('--out')
const OUT = outFlag === -1 ? undefined : process.argv[outFlag + 1]

const layerPath = PROFILE && join(root, 'profiles', PROFILE, 'tokens.json')
if (!PROFILE || !existsSync(layerPath)) {
  console.error('usage: node scripts/name-tokens.mjs <profile-id> [--out <dir>]')
  console.error('  needs a token layer at profiles/<id>/tokens.json, from `ds style:image`,')
  console.error('  `ds style --out` or `ds adapt:figma`.')
  try {
    const withTokens = readdirSync(join(root, 'profiles')).filter(d => existsSync(join(root, 'profiles', d, 'tokens.json')))
    if (withTokens.length) console.error(`  layers here: ${withTokens.join(', ')}`)
  } catch { }
  process.exit(2)
}

const layer = JSON.parse(readFileSync(layerPath, 'utf8'))

const colours = Object.entries(layer)
  .filter(([, v]) => v?.$type === 'color')
  .map(([key, v]) => ({ key, hex: String(v.$value), meta: v.$extensions?.['org.ds-profile'] ?? {} }))

if (colours.length === 0) {
  console.error(`\nname-tokens: ${PROFILE} holds no colours, so there is nothing here to name.`)
  process.exit(2)
}

// ── The arithmetic, which is why these four are not judgment ───────────────────

const rgb = (hex) => {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
}
/** WCAG relative luminance. */
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** HSL saturation, which is what "most colourful" means numerically. */
const saturation = (hex) => {
  const [r, g, b] = rgb(hex).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const l = (max + min) / 2
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}
const channelDistance = (a, b) => {
  const [x, y] = [rgb(a), rgb(b)]
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])))
}

// ── The four ──────────────────────────────────────────────────────────────────

const proposed = {}
const claim = (name, colour, because) => {
  proposed[name] = { value: colour.hex, from: colour.key, because }
}

// The ground, which is the one role the reader established structurally. Where the
// layer does not record it, nothing downstream can be anchored — and guessing it
// from share is the exact mistake the reader exists to avoid, so this refuses.
const ground = colours.find(c => c.meta.isPageGround)
if (!ground) {
  console.error(`\nname-tokens: ${PROFILE} does not record which colour is the page ground.`)
  console.error('  Every name below is relative to it — the text is whatever contrasts with the')
  console.error('  ground, the surface is whatever sits just above it — so there is nothing to')
  console.error('  measure from. The commonest colour is NOT the ground: on a dense page it is')
  console.error('  the card, and taking it would name the card the page.')
  console.error('\n  Re-read the source with a version that records it: ds style:image <shot.png> --out ' + PROFILE)
  process.exit(2)
}
claim('colour-background', ground, `${ground.meta.groundFrom ?? 'recorded as the page ground by the reader'}`)

const rest = colours.filter(c => c !== ground)

// Text: most contrast against the ground. Not "the darkest" — on a dark ground the
// text is the lightest thing, and contrast covers both without a special case.
const byContrast = [...rest].sort((a, b) => contrast(b.hex, ground.hex) - contrast(a.hex, ground.hex))
const text = byContrast[0]
if (text) {
  const ratio = contrast(text.hex, ground.hex)
  claim('colour-text', text, `the most contrast against the ground of anything here, at ${ratio.toFixed(1)}:1${ratio < 4.5 ? ' — which is below the 4.5:1 body-text minimum, so this palette has no colour that passes on that ground' : ''}`)
}

// Accent: most saturated of what is left. A ground and a text are usually near-grey;
// the thing a team chose on purpose is the colourful one.
const accentPool = rest.filter(c => c !== text)
const byColour = [...accentPool].sort((a, b) => saturation(b.hex) - saturation(a.hex))
const accent = byColour[0] && saturation(byColour[0].hex) > 0.15 ? byColour[0] : undefined
if (accent) {
  claim('colour-accent', accent, `the most saturated colour here at ${Math.round(saturation(accent.hex) * 100)}%, and neither the ground nor the text`)
} 

// Surface: close to the ground and still large. The white card on an off-white page,
// which is the case the reader was rebuilt around.
const surface = rest.find(c => c !== text && c !== accent
  && channelDistance(c.hex, ground.hex) <= 24
  && (c.meta.share ?? 0) >= 0.1)
if (surface) {
  claim('colour-surface', surface, `within ${channelDistance(surface.hex, ground.hex)} per channel of the ground and still covering ${Math.round((surface.meta.share ?? 0) * 100)}% — a surface sitting above the page rather than the page`)
}

const unnamed = colours.filter(c => !Object.values(proposed).some(p => p.from === c.key))

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nname-tokens: ${PROFILE} — ${colours.length} colour(s)\n`)
for (const [name, p] of Object.entries(proposed)) {
  console.log(`  --${name.padEnd(20)} ${p.value.padEnd(10)} ${p.because}`)
}
if (unnamed.length) {
  console.log(`\n  ${unnamed.length} left unnamed: ${unnamed.map(c => `${c.key} ${c.hex}`).join(' · ')}`)
  console.log('  Nothing measured here says what they are for. A name nobody can defend is the')
  console.log('  kind a team rejects on sight, and that discredits the ones above it.')
}
console.log('\nNOT PROPOSED, and deliberately')
console.log('  · success, warning, danger — nothing in a picture says green means success')
console.log('    rather than a brand that happens to be green.')
console.log('  · a scale (50…900) — one screenshot holds the shades it holds, not a ramp.')
console.log('  · anything about type. A picture has no font names in it.')

if (!OUT) {
  console.log('\nNothing was written. Add --out <dir> to write the proposal.')
  process.exit(0)
}

const css = [
  '/* Names for an extracted token layer — PROPOSED, not measured from your code.',
  ' *',
  ` * Read from the token layer "${PROFILE}". Four names, each one arithmetic rather`,
  ' * than taste: the ground is where the reader found it, the text is what contrasts',
  ' * with it most, the accent is the most saturated thing that is neither, and a',
  ' * surface is what sits within a few units of the ground and still covers a lot.',
  ' *',
  ...Object.entries(proposed).map(([n, p]) => ` *   --${n}: ${p.value} — ${p.because}`),
  ' *',
  ' * To adopt: move this into your stylesheet. To refuse: delete it.',
  ' */',
  ':root {',
  ...Object.entries(proposed).map(([n, p]) => `  --${n}: ${p.value};`),
  '}',
  '',
].join('\n')

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'tokens.proposed.css'), css)
writeFileSync(join(OUT, 'tokens.proposed.json'), JSON.stringify({
  schemaVersion: 1,
  _: [
    'PROPOSED names for the token layer "' + PROFILE + '". The layer itself is unchanged.',
    '',
    'Four names are proposed and no more. Each is arithmetic: the ground was read',
    'from the edges of the source, the text is whatever contrasts with it most, the',
    'accent is the most saturated colour that is neither, and a surface is one within',
    'a few units of the ground that still covers a large share.',
    '',
    'What is not proposed is listed in the report and is not an oversight: nothing in',
    'a picture says green means success, one screenshot is not a ramp, and no picture',
    'holds a font name.',
  ],
  from: PROFILE,
  names: proposed,
  leftUnnamed: unnamed.map(c => ({ key: c.key, value: c.hex })),
}, null, 2) + '\n')
console.log(`\nwritten to ${relative(process.cwd(), join(OUT, 'tokens.proposed.css'))} and .json — a PROPOSAL.`)
console.log('The token layer itself is untouched: names are judgment, and these are proposed ones.')
