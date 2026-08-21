/**
 * A visual language read off a picture, into the same token layer as everything else.
 *
 * The entry a client always has. A site can be crawled and a Figma file queried, but
 * half of them hand over a PDF brandbook or a screenshot of what they already ship,
 * and there was no path from either into this tool at all.
 *
 * What is read is the part that turned out to carry the shape: the page ground, the
 * reading column, and the vertical rhythm. A palette is the easy half and every tool
 * extracts one; the half that decides whether a generated stylesheet reads as native
 * is the spacing, and no palette extractor sees it.
 *
 * Every value here is anonymous on purpose. `#1A73E8` is a colour; calling it
 * `--colour-primary` is a claim about intent that a picture cannot carry, and a token
 * layer built on invented names is one a team rejects on sight. Names are the
 * judgment tier, and this is the facts tier.
 *
 *   node scripts/style-from-image.mjs <shot.png> --out <profile-id>
 *   node scripts/style-from-image.mjs <shot.png> --compare <profile-id>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { readImage } from './lib/image-read.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}
const file = process.argv[2]
const OUT = arg('--out')
const COMPARE = arg('--compare')

if (!file || !existsSync(file)) {
  console.error('usage: node scripts/style-from-image.mjs <shot.png> [--out <profile-id>] [--compare <profile-id>]')
  process.exit(2)
}
if (!/\.png$/i.test(file)) {
  console.error(`style-from-image: ${basename(file)} is not a PNG.`)
  console.error('  Only PNG is read here, because it is the one lossless format a screenshot')
  console.error('  arrives in. A JPEG of a flat page holds thousands of shades that were never')
  console.error('  chosen, and every measurement below would be about the compressor.')
  console.error('  Re-export as PNG, or screenshot the PDF page rather than converting it.')
  process.exit(2)
}

let read
try {
  read = readImage(PNG.sync.read(readFileSync(file)))
} catch (error) {
  console.error(`style-from-image: ${basename(file)} could not be decoded: ${error.message}`)
  process.exit(1)
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nstyle-from-image: ${basename(file)} — ${read.width}×${read.height}`)

console.log('\nFRAME — what a rule reading one screen\u2019s markup cannot see')
console.log(`  page ground         ${read.ground ?? 'NOT MEASURED'}`)
console.log(read.column
  ? `  reading column      ${read.column.width}px, from ${read.column.left} to ${read.column.right}`
  : '  reading column      NOT MEASURED')
console.log(read.rhythm.length
  ? `  vertical rhythm     ${read.rhythm.map(g => `${g.px}px ×${g.times}`).join(' · ')}`
  : '  vertical rhythm     NOT MEASURED')

console.log('\nCOLOURS — by share of the picture, and unnamed')
for (const c of read.palette.slice(0, 8)) {
  console.log(`  ${c.hex}  ${String(Math.round(c.share * 1000) / 10).padStart(5)}%`)
}

if (read.unresolved.length) {
  console.log('\nNOT MEASURED')
  for (const u of read.unresolved) console.log(`  · ${u}`)
}

console.log('\nWHAT A PICTURE CANNOT SAY')
for (const l of read.limits) console.log(`  · ${l}`)

// ── Write, when asked ─────────────────────────────────────────────────────────

if (OUT) {
  const tokens = {
    $description: `Read from ${basename(file)} at ${read.width}×${read.height}. One viewport, one theme, one moment.`,
  }
  read.palette.forEach((c, i) => {
    // Numbered by frequency, not named by guess. A name here is judgment and this
    // file is facts; `colour-1` is honest and `colour-primary` is not.
    //
    // One thing about the colour IS measured, though, and it was being thrown away:
    // which of them is the page ground. That is read from the edges of the picture
    // rather than from how much of it a colour covers, and the difference is the
    // whole reason this reader exists — on a dense page the commonest colour is the
    // card. It was computed, printed to the terminal, and dropped before the file,
    // so anything reading the token layer had to guess the ground back from share
    // and would have guessed the card.
    tokens[`colour-${i + 1}`] = {
      $value: c.hex,
      $type: 'color',
      $extensions: {
        'org.ds-profile': {
          source: basename(file),
          share: Number(c.share.toFixed(4)),
          named: false,
          // Not a name. A name says what a colour is FOR; this says where it was
          // found, which is a fact about the picture.
          ...(read.ground && c.hex === read.ground ? { isPageGround: true, groundFrom: 'the edges of the picture, not its commonest colour' } : {}),
        },
      },
    }
  })
  read.rhythm.forEach((g, i) => {
    tokens[`space-${i + 1}`] = {
      $value: `${g.px}px`,
      $type: 'dimension',
      $extensions: { 'org.ds-profile': { source: basename(file), occurrences: g.times, named: false } },
    }
  })
  if (read.column) {
    tokens['reading-column'] = {
      $value: `${read.column.width}px`,
      $type: 'dimension',
      $extensions: { 'org.ds-profile': { source: basename(file), named: false } },
    }
  }
  const outDir = join(root, 'profiles', OUT)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n')
  console.log(`\nwritten to profiles/${OUT}/tokens.json — a token layer, not a profile.`)
  console.log('  Nothing here is named, so nothing here can be bound to a role yet. That is')
  console.log('  the authoring step, and no picture does it for you.')
}

// ── Compare, when asked ───────────────────────────────────────────────────────
//
// The disagreement is the product. "Your brand blue is #1A73E8 in Figma, #1B74E9 on
// this screenshot and a literal in nineteen components" is a conversation; a palette
// on its own is a decoration.

if (COMPARE) {
  const at = join(root, 'profiles', COMPARE, 'tokens.json')
  if (!existsSync(at)) {
    console.error(`\nstyle-from-image: no token layer at profiles/${COMPARE}/tokens.json to compare with.`)
    process.exit(1)
  }
  const theirs = JSON.parse(readFileSync(at, 'utf8'))
  const values = new Map()
  const collect = (node) => {
    for (const [k, v] of Object.entries(node ?? {})) {
      if (k.startsWith('$')) continue
      if (v && typeof v === 'object' && '$value' in v) {
        if (typeof v.$value === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.$value)) values.set(v.$value.toLowerCase(), k)
      } else if (v && typeof v === 'object') collect(v)
    }
  }
  collect(theirs)

  console.log(`\nAGAINST profiles/${COMPARE} — ${values.size} colour token(s) declared there`)
  const dist = (a, b) => {
    const p = (s) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16))
    const [ar, ag, ab] = p(a), [br, bg, bb] = p(b)
    return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
  }
  let exact = 0
  for (const c of read.palette.slice(0, 8)) {
    const hit = values.get(c.hex)
    if (hit) { exact += 1; console.log(`  =  ${c.hex}  is ${hit}`); continue }
    const nearest = [...values].map(([v, k]) => ({ v, k, d: dist(c.hex, v) })).sort((a, b) => a.d - b.d)[0]
    console.log(nearest && nearest.d <= 24
      ? `  ~  ${c.hex}  is ${nearest.d} away from ${nearest.k} (${nearest.v}) — near, and not the same`
      : `  ✗  ${c.hex}  matches nothing declared there`)
  }
  console.log(`\n  ${exact} of ${Math.min(8, read.palette.length)} colours on this picture are declared tokens.`)
  console.log('  A near miss is the finding: two values that differ by a few units are two')
  console.log('  values somebody has to reconcile, and neither side knows the other exists.')
}
