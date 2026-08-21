/**
 * A component registry read out of single-file components.
 *
 * The chain stopped here for three of the four frameworks. A Vue, Svelte or Angular
 * project could be measured, could have a gate installed, and then had nowhere to go:
 * `ds bind` needs a registry, `ds spec` needs a binding, and the only extractors were
 * `adapt:react` — which cannot open a `.vue` file — and `adapt:css`, which finds
 * nothing in a project whose components are single files. So generation on those three
 * lived on fixtures, and the honest answer to "does it work on Vue" was no.
 *
 * The readers already existed: `sfc.mjs` gets props, slots, imports and markup out of
 * all three. What was missing is the pass that turns them into the same registry shape
 * `adapt:react` writes, so everything downstream stops caring which framework it is.
 *
 * What is extracted and what is not follows the same three tiers as everywhere:
 * props, variants and slots are facts in the file; level, surface and description are
 * not in any file and are left null, with the count of how many.
 *
 *   node scripts/adapt-sfc.mjs <components-dir> --out <profile-id> [--alias <import-alias>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk } from './lib/signals.mjs'
import { READERS, readAngular } from './lib/sfc.mjs'
import { regionsDeclaredBy } from './lib/archetypes.mjs'
import { writeUnwrittenTiers } from './lib/profile-stubs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const DIR = process.argv[2]
const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? undefined : process.argv[i + 1] }
const OUT = arg('--out')
const ALIAS = arg('--alias')

if (!DIR || !existsSync(DIR) || !OUT) {
  console.error('usage: node scripts/adapt-sfc.mjs <components-dir> --out <profile-id> [--alias <import-alias>]')
  console.error('  reads .vue, .svelte and Angular .component.ts — the three `adapt:react` cannot open')
  process.exit(2)
}

/**
 * An Angular component is one that carries `@Component`, not one whose file is
 * named a particular way.
 *
 * `*.component.ts` is the Angular CLI's convention and a great many projects follow
 * it. Angular's own component library does not: across `angular/components`, 616
 * files declare `@Component` and not one of them is named `*.component.ts`. Matching
 * on the filename found zero components in 3,053 files and told the reader to try
 * the React adapter instead.
 *
 * Reading the file to answer the question costs one pass over the `.ts` files and
 * gives the real answer rather than a convention's shadow.
 */
const declaresComponent = (f) => {
  try { return /@Component\s*\(/.test(readFileSync(f, 'utf8')) } catch { return false }
}

const files = walk(DIR, [], new Set(['.vue', '.svelte', '.ts']))
  .filter(f => !/\.(test|spec|stories)\./.test(f))
  // A component written for a test — a harness, a fixture host — is not part of the
  // library, and on this codebase they outnumber the real ones.
  .filter(f => !/(^|\/)(testing|__tests__|fixtures)\//.test(f))
  .filter(f => /\.(vue|svelte)$/.test(f) || /\.component\.ts$/.test(f) || declaresComponent(f))

if (!files.length) {
  console.error(`\nadapt-sfc: no single-file component under ${DIR}.`)
  console.error('  Looked for .vue, .svelte, and any .ts declaring @Component. A React library is')
  console.error('  read by `ds adapt:react`; a CSS framework by `ds adapt:css`.')
  process.exit(2)
}

// The Angular reader needs to fetch a template named by the decorator, so it is handed
// a way to read rather than only the text.
const io = { read: (p) => { try { return readFileSync(p, 'utf8') } catch { return undefined } }, exists: (p) => existsSync(p) }

const components = {}
const unreadable = []
let framework

for (const abs of files) {
  const ext = extname(abs)
  // Same question as the file selection, and it has to be answered the same way:
// a `.ts` here is Angular because it declares a component, not because of what it
// is called. Keyed on the name, the selection found 76 files on Angular Material
// and this handed every one of them to `READERS['.ts']`, which is undefined —
// "76 file(s) read and no component came out of them".
const reader = ext === '.ts' ? readAngular : READERS[ext]
  if (!reader) continue
  let read
  try { read = reader(readFileSync(abs, 'utf8'), abs, io) } catch { read = undefined }
  if (!read) { unreadable.push(relative(DIR, abs)); continue }
  framework ??= read.framework

  // The name a screen writes. Angular reaches a component by its selector and the
  // other two by the name they are imported under, which is the file's.
  // The name a screen writes, which for a single-file component is the PascalCase of
  // its file. A real Vue library came back as `form-field`, `vben-form`,
  // `layout-content` — every entry keyed by a filename nobody writes in a template.
  // `import FormField from './form-field.vue'` is how it is reached, and `<FormField>`
  // is what a screen contains.
  const pascal = (n) => n.split(/[-_.]/).filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  // Every extension this pass reads, stripped. Taking off `.component.ts` and the two
  // single-file ones but not a plain `.ts` produced `ButtonTs`, `CardTs`,
  // `AutocompleteTs` across all 76 components of Angular Material — the extension
  // pascal-cased into the name of every one of them.
  const fromFile = /\.component\.ts$/.test(abs)
    ? basename(abs).replace(/\.component\.ts$/, '')
    : pascal(basename(abs).replace(/\.(vue|svelte|ts)$/, ''))

  // The selector as written, quotes or backticks. Angular Material declares its
  // selectors in a multi-line template literal listing attribute forms, and reading
  // only quoted strings left all 76 without one.
  const declared = ext === '.ts'
    ? /selector\s*:\s*(['"`])([\s\S]*?)\1/.exec(readFileSync(abs, 'utf8'))?.[2]?.replace(/\s+/g, ' ').trim()
    : undefined

  // Two shapes, and they are used differently. `mat-card` is an element a screen
  // writes as `<mat-card>`; `button[matButton]` is an attribute put on a host the
  // screen already has, written `<button matButton>`. Treating the second as an
  // element name would have a screen generator emit `<ButtonMatbutton>`, which is
  // nothing, so the shape travels with the value instead of being flattened away.
  const elementSelector = declared && /^[a-z][\w-]*(\s*,|$)/.test(declared)
    ? declared.split(',')[0].trim()
    : undefined
  const selector = elementSelector
  const attributeSelector = declared && !elementSelector ? declared : undefined
  const name = selector
    ? selector.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
    : fromFile
  if (!/^[A-Za-z]/.test(name)) continue

  // Where a screen imports it from. An alias if one was given, otherwise the path
  // relative to the directory that was read.
  // `.vue` and `.svelte` are part of the specifier; `.ts` is not. Keeping it produced
  // `import { DsTable } from '../ui/ds-table.component.ts'`, which TypeScript rejects
  // and which the generator then reported as a module that does not exist.
  const rel = relative(DIR, abs).split(/[\\/]/).join('/')
  const spec = rel.replace(/\.ts$/, '')
  const from = ALIAS
    ? `${ALIAS.replace(/\/$/, '')}/${spec}`
    : './' + spec

  // A prop whose values are a closed set is a variant, which is what a spec can ask
  // for by name. Everything else is a prop and stays one.
  // The closed set goes on the prop as well as into `variants`, because that is the
  // shape everything downstream reads. Without it `ds bind` asked DsButton for a
  // "primary" value, found none, and marked a correct match questionable — while the
  // component declared `variant?: 'primary' | 'secondary'` two lines up.
  const variants = {}
  const props = (read.props ?? []).map(p => {
    const values = [...String(p.type ?? '').matchAll(/'([^']+)'/g)].map(m => m[1])
    if (values.length > 1) variants[p.name] = { values }
    return values.length > 1 ? { ...p, values } : p
  })

  components[name] = {
    ref: name,
    // Not in any file, and named as absent rather than guessed. The count is printed
    // at the end so the size of that afternoon is visible.
    level: null,
    surface: null,
    status: null,
    description: null,
    from,
    // The places this component offers, read from its own declaration — a Vue or
    // Svelte `<slot name>`, an Angular `<ng-content select>`.
    slots: [...(regionsDeclaredBy(read.markup) ?? [])].filter(s => s !== 'children'),
    props,
    propsUnknown: Boolean(read.propsUnknown),
    exportedAs: (selector || attributeSelector) ? 'named' : 'default',
    ...(selector ? { selector } : {}),
    // Recorded, and recorded as what it is. A component reached by attribute has no
    // tag to look for, so anything counting call sites by tag must say it cannot
    // measure these rather than report zero uses of a component used everywhere.
    ...(attributeSelector ? { attributeSelector } : {}),
    // The class a screen imports. Angular reaches a component by selector in the
    // template and by class name in the import, and only carrying the first left the
    // generator with a shell it could not import.
    ...((selector || attributeSelector) ? { className: /export\s+class\s+(\w+)/.exec(readFileSync(abs, 'utf8'))?.[1] } : {}),
    variants,
    // What it renders, which is the second signal the twin check needs.
    renders: [...new Set([...(read.markup ?? '').matchAll(/<([A-Za-z][\w.-]*)[\s/>]/g)].map(m => m[1]))]
      .filter(n => n !== name).sort(),
    uses: [...(read.imported ?? [])].filter(Boolean),
    sourcePath: rel,
  }
}

const names = Object.keys(components)
if (!names.length) {
  console.error(`\nadapt-sfc: ${files.length} file(s) read and no component came out of them.`)
  console.error('  That is a fact about this pass, not about the project — report it rather')
  console.error('  than treating an empty registry as an empty library.')
  process.exit(2)
}

const outDir = join(root, 'profiles', OUT)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'components.json'), JSON.stringify({
  schemaVersion: 1,
  profile: OUT,
  _: [
    `Extracted from ${files.length} ${framework ?? 'single-file'} component(s) under ${DIR}.`,
    '',
    'Props, variants, slots and what each renders are facts in the files. Level,',
    'surface and description are in none of them and are null here — that tier is',
    'authored, and `ds policy` lays out the order to write it in.',
  ],
  counts: { components: names.length },
  components,
}, null, 2) + '\n')

// The tiers no single-file component records. Declared, not omitted: a profile that
// says nothing about them has every missing description read as a defect, and a
// freshly adapted registry came out "FAILED — 144 problem(s)" one command after this
// script told the reader to carry on.
writeUnwrittenTiers(outDir, {
  id: OUT,
  adapter: 'adapt-sfc.mjs',
  library: { name: basename(DIR), kind: 'first-party', source: DIR },
  facts: `extracted from ${files.length} ${framework ?? 'single-file'} component(s); complete`,
  counts: { components: names.length },
})

// The empty binding stub, exactly as `adapt:react` writes one: a placeholder is not a
// judgment, and `ds bind` proposes into it.
const bindingAt = join(root, 'bindings', `${OUT}.json`)
if (!existsSync(bindingAt)) {
  writeFileSync(bindingAt, JSON.stringify({
    _: `Role bindings for ${OUT}. EMPTY AND DELIBERATELY SO: a binding claims that a component is the right answer for a role, which is judgment. Propose one with \`ds bind ${OUT} --repo <path>\`.`,
    schemaVersion: 1,
    profile: OUT,
    axes: {},
    roles: {},
  }, null, 2) + '\n')
}

const withSlots = names.filter(n => components[n].slots.length)
const withVariants = names.filter(n => Object.keys(components[n].variants).length)

console.log(`\nadapt-sfc: ${OUT} — ${names.length} ${framework ?? 'single-file'} component(s) from ${files.length} file(s)\n`)
console.log('FACTS — read from the files')
console.log(`  ${String(names.length).padStart(4)}  components`)
console.log(`  ${String(withVariants.length).padStart(4)}  with a closed set of values a spec can ask for by name`)
console.log(`  ${String(withSlots.length).padStart(4)}  declaring a named place to put something`)
if (unreadable.length) console.log(`  ${String(unreadable.length).padStart(4)}  file(s) the reader could not open: ${unreadable.slice(0, 3).join(', ')}`)

console.log('\nNOT EXTRACTED, BECAUSE IT IS NOT IN THE FILES')
console.log(`  ${String(names.length).padStart(4)}  × no description — the line an agent reads to choose`)
console.log(`  ${String(names.length).padStart(4)}  × no atomic level or surface — measured to be underivable; see \`ds policy ${OUT}\``)
console.log(`\nwritten to profiles/${OUT}/components.json`)
console.log(`Next:  ds bind ${OUT} --repo <path>    proposes the role map, to accept or refuse`)
