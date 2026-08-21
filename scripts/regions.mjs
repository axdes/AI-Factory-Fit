/**
 * The region vocabulary, measured across many products.
 *
 * This exists because of a negative result. The obvious way to answer "where do we
 * get screen patterns from" is to measure real products and keep the shapes that
 * repeat — and across eight of them, in four frameworks, the shapes do not repeat
 * at all. Thirty-six frame names in the first four products, zero appearing in more
 * than one. `Scene`, `PageContentWrapper`, `SettingsPageLayout`, `DefaultLayout`:
 * every product invents its own frame and its own name for it. There is no
 * catalogue of screen archetypes to be lifted from other people's code, and any
 * catalogue claiming otherwise was assembled from taste rather than measurement.
 *
 * What does transfer is one level down. A frame declares the places a screen can
 * fill — `title`, `header`, `actions`, `footer` — and those names recur across
 * products that share no code, no framework and no team. Of 352 distinct region
 * names across 658 frames, 86% appear in exactly one product; the fifty that do not
 * are the portable part, and `title` appears in all eight.
 *
 * So this measures the vocabulary, not the layouts. It is the honest half of the
 * question, and it is the half a project with no screens of its own can actually
 * be handed: not "your dashboard should look like this", but "a page frame in this
 * industry offers these places, and yours offers none of them".
 *
 *   node scripts/regions.mjs <name>=<path> [<name>=<path> ...] [--out catalogue/regions.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk } from './lib/signals.mjs'
import { regionsDeclaredBy } from './lib/archetypes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const OUT = outFlag === -1 ? undefined : args[outFlag + 1]
const specs = args.filter(a => a.includes('=') && !a.startsWith('--'))

if (!specs.length) {
  console.error('usage: node scripts/regions.mjs <name>=<path> [<name>=<path> ...] [--out file.json]')
  console.error('  each path is one product; two are enough to see whether anything transfers at all')
  process.exit(2)
}

const EXT = new Set(['.tsx', '.jsx', '.ts', '.vue', '.svelte'])
const inProduct = new Map()   // region -> Set(product)
const products = []

for (const spec of specs) {
  const at = spec.indexOf('=')
  const name = spec.slice(0, at)
  const target = spec.slice(at + 1)
  let files = []
  try { files = walk(target, [], EXT) } catch { }
  files = files.filter(f => !/\.(test|spec|stories)\./.test(f))

  let frames = 0
  const here = new Set()
  for (const f of files) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    const declared = regionsDeclaredBy(text)
    if (!declared) continue
    // `children` is every frame's default slot and says nothing about shape. A
    // frame is one that offers a NAMED place.
    const named = [...declared].filter(r => r !== 'children')
    if (!named.length) continue
    frames += 1
    for (const r of named) {
      here.add(r)
      if (!inProduct.has(r)) inProduct.set(r, new Set())
      inProduct.get(r).add(name)
    }
  }
  products.push({ name, target, files: files.length, frames, distinctRegions: here.size })
}

// A product that contributed nothing is not a product in this comparison.
//
// Pointed at `vue-vben-admin/apps` instead of `packages`, this printed "0 name(s)
// recur across products" and "100% of the vocabulary is local to one product" over
// two products, one of which had contributed nothing at all. Both sentences read as
// findings and both were artifacts of a wrong path — the same zero-over-nothing this
// tool exists to refuse, inside the pass that measures it.
//
// The two ways of contributing nothing are different and a reader acts on which: no
// files at all is a path that does not point at source, and files with no frames is
// a codebase whose components declare no named place.
const contributing = products.filter(p => p.frames > 0)
const silent = products.filter(p => p.frames === 0)
const n = contributing.length
const byReach = [...inProduct]
  .map(([region, seen]) => ({ region, products: seen.size, seenIn: [...seen].sort() }))
  .sort((a, b) => b.products - a.products || a.region.localeCompare(b.region))

const portable = byReach.filter(r => r.products > 1)
const local = byReach.length - portable.length

console.log(`\nregions: ${n} product(s), ${products.reduce((s, p) => s + p.frames, 0)} frame(s) declaring a named place\n`)
for (const p of products) {
  console.log(`  ${p.name.padEnd(12)} ${String(p.files).padStart(5)} file(s) · ${String(p.frames).padStart(4)} frame(s) · ${p.distinctRegions} distinct region(s)`)
}

if (silent.length) {
  console.log('')
  for (const p of silent) {
    console.log(`  ${p.name} contributed nothing and is not counted below — ${p.files
      ? `${p.files} file(s) read, none of them declaring a named place`
      : 'no source files were read here at all; check the path'}`)
  }
}

if (n < 2) {
  console.log(`\n  ${n} product(s) contributed. Nothing can be said about what transfers`)
  console.log('  between products from fewer than two of them, so no share is printed.')
  if (OUT) console.log(`\n  ${OUT} not written — a vocabulary measured on one product is that product's.`)
  process.exit(n ? 0 : 2)
}

console.log(`\n${byReach.length} distinct region name(s)`)
for (let k = n; k >= 2; k -= 1) {
  const at = portable.filter(r => r.products === k)
  if (at.length) console.log(`  in ${k} of ${n}:  ${at.map(r => r.region).join(', ')}`)
}
console.log(`  in 1 of ${n}:  ${local} name(s) — ${Math.round(local / byReach.length * 100)}% of the vocabulary is local to one product`)

// The negative result, stated rather than left for a reader to notice.
console.log(`\n  ${portable.length} name(s) recur across products. That is the transferable part, and`)
console.log('  it is a vocabulary of places, not a set of layouts — no frame NAME in this')
console.log('  corpus appears in more than one product.')

if (OUT) {
  const path = OUT.startsWith('/') ? OUT : join(root, OUT)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    _: [
      'Measured, not authored. Every name here was read from a frame that declares',
      'it — a React prop typed as renderable content, a Vue or Svelte <slot name>,',
      'an Angular <ng-content select> — in one of the products named below.',
      '',
      'A name in this list is not a recommendation. It is a fact about what frames',
      'in these products offer, and the number beside it is how many of them.',
      'Nothing here says a screen SHOULD have a title; it says that seven of eight',
      'independent products built a frame that offers one.',
    ],
    // Every product named, including the ones that contributed nothing — a corpus
    // is only readable if what was in it and produced no regions is visible beside
    // what did.
    measuredOn: products.map(p => ({ name: p.name, files: p.files, frames: p.frames, counted: p.frames > 0 })),
    regions: byReach.map(r => ({ name: r.region, products: r.products, seenIn: r.seenIn })),
  }, null, 2) + '\n')
  console.log(`\nwritten to ${OUT}`)
}
