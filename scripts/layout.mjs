/**
 * The things that make a page read as a page, measured and compared.
 *
 * This exists because of a specific failure that no other check here would have
 * caught: a screen every gate called green and a person called wrong on sight.
 * Nothing was lying. The checks simply had no opinion about what was wrong.
 *
 *   · the page was painted with the CARD colour instead of the page colour, so
 *     white cards sat invisible on a white page. An accessibility checker looks
 *     at TEXT contrast, and a card that vanishes into its page has perfect text
 *     contrast.
 *   · the header ran the full window while the content sat in a narrower column.
 *     Comparing their edges finds nothing, because both were internally
 *     consistent.
 *   · the reading column was 1400 pixels wide, because the layout kept a cap
 *     meant for a page with a sidebar it did not have.
 *
 * Each is invisible to a rule looking at one screen alone and obvious the moment
 * the screen is put beside one that reads correctly. So the comparison is the
 * check — and an existing project already contains what to compare against.
 *
 * The reference is the project's own majority, which is the principle used
 * everywhere else here: measure the distribution, and where fifteen screens cap
 * the reading column at one width and one caps it at another, the one is the
 * finding. Nothing has to be imported from a product that "looks right", and a
 * threshold invented here would fire on a number nobody chose.
 *
 * A recorded reference is still available for the case the majority cannot
 * answer: a greenfield project, or a redesign where the majority is what is being
 * replaced.
 *
 *   ds layout <repo>                      measure, and compare if a reference exists
 *   ds layout <repo> --record <name>      make this the reference somebody approved
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { walk, scanSlot, installedHere } from './lib/signals.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const target = process.argv[2]
const RECORD = flag('record')

if (!target || !existsSync(target)) {
  console.error('usage: ds layout <repo> [--record <name>]')
  process.exit(2)
}

const ours = installedHere(target)
const css = walk(target).filter(f => /\.(css|scss)$/.test(f) && !ours(f))
const rel = (abs) => relative(target, abs).split(sep).join('/')

// ── Measure ───────────────────────────────────────────────────────────────────
//
// From the stylesheets, not from a browser. A rendered measurement is stronger
// and needs the project's own runner; this reads what the CSS declares, which is
// where all three of the failures above were written down.

const facts = {
  pageBackground: [],
  readingWidths: [],
}

// A stylesheet that would not parse is not a stylesheet with nothing in it, and
// skipping it in silence reported "no reading column" for a project declaring
// `max-width: 1024px` in a SCSS file postcss refused. The count travels with the
// result.
const unparsed = []
for (const file of css) {
  let ast
  try {
    ast = postcss.parse(readFileSync(file, 'utf8'), { from: file })
  } catch (error) {
    unparsed.push({ file: rel(file), why: String(error.message).split('\n')[0].slice(0, 90) })
    continue
  }

  ast.walkRules(rule => {
    const selector = rule.selector.trim()
    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue

      // What paints the page. The root ITSELF, not something inside it: matching
      // any selector beginning with `html` caught
      // `html[data-theme='dark'] input:checked + .checkboxLabel`, which is the
      // background of a checkbox and has nothing to do with the page.
      //
      // A theme attribute or a pseudo-class still names the root; a descendant,
      // a child or a sibling does not.
      const isPageRoot = selector.split(',').some(part => /^(html|body|:root|#root|#app|\.app)(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$/.test(part.trim()))
      if (isPageRoot && /^background(-color)?$/.test(node.prop)) {
        facts.pageBackground.push({ file: rel(file), selector, value: node.value.trim() })
      }

      // How wide the reading column is allowed to get. A cap is a decision about
      // line length, and one carried over from a layout with a sidebar is the
      // third failure.
      if (node.prop === 'max-width' && /rem|px|ch/.test(node.value)) {
        const px = /(\d+(?:\.\d+)?)rem/.test(node.value)
          ? Number(/(\d+(?:\.\d+)?)rem/.exec(node.value)[1]) * 16
          : /(\d+(?:\.\d+)?)px/.test(node.value)
            ? Number(/(\d+(?:\.\d+)?)px/.exec(node.value)[1])
            : undefined
        if (px && px >= 480) facts.readingWidths.push({ file: rel(file), selector, value: node.value.trim(), px })
      }
    }
  })
}

// ── The project's own majority ────────────────────────────────────────────────
//
// An existing project already contains the reference: the screens that have been
// in production long enough that nobody complains about them. Where most caps
// agree and one does not, the one is the finding — and that needs no threshold
// anybody invented and no product imported from elsewhere.

const distribution = (values) => {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return ranked.length
    ? { dominant: ranked[0][0], share: ranked[0][1] / values.length, counts: Object.fromEntries(ranked) }
    : undefined
}

const capsByPx = facts.readingWidths.map(w => w.px)
const caps = distribution(capsByPx)
const backgrounds = distribution(facts.pageBackground.map(b => b.value))

// An outlier is a declaration the project disagrees with, measured against the
// majority rather than against the total.
//
// A share of the total is the wrong test on small numbers: one cap in four is
// 25%, which passed a 15% threshold and let the single 1400px column through in
// a project where 1024px appears three times. What matters is the ratio to the
// dominant — used once where another is used three times is an outlier however
// few declarations there are in total.
const outliers = {
  caps: caps
    ? facts.readingWidths
      .filter(w => w.px !== caps.dominant && (caps.counts[w.px] ?? 0) * 2 <= caps.counts[caps.dominant])
      .map(w => ({ px: w.px, value: w.value, at: `${w.file} ${w.selector}`, seen: caps.counts[w.px], majority: caps.counts[caps.dominant] }))
    : [],
  backgrounds: backgrounds
    ? facts.pageBackground
      .filter(b => b.value !== backgrounds.dominant)
      .map(b => ({ value: b.value, at: `${b.file} ${b.selector}` }))
    : [],
}

const widest = facts.readingWidths.sort((a, b) => b.px - a.px)[0]
const distinctCaps = [...new Set(capsByPx)].sort((a, b) => a - b)

const measured = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  pageBackground: facts.pageBackground.map(b => b.value),
  pageBackgroundDeclaredIn: facts.pageBackground.slice(0, 4),
  widestReadingColumn: widest ? { px: widest.px, value: widest.value, at: `${widest.file} ${widest.selector}` } : null,
  distinctCaps,
  majority: { caps, backgrounds },
  outliers,
  stylesheets: css.length,
  unparsed,
}

const outDir = join(root, 'scans', scanSlot(target))
mkdirSync(outDir, { recursive: true })

// ── Record, or compare ────────────────────────────────────────────────────────

const referenceDir = join(root, 'layout-references')
if (RECORD) {
  mkdirSync(referenceDir, { recursive: true })
  const at = join(referenceDir, `${RECORD}.json`)
  writeFileSync(at, JSON.stringify({
    ...measured,
    _: [
      'A reference is a screen somebody LOOKED AT and called right. Nothing derives it,',
      'and recording one from a layout nobody has approved makes every later comparison',
      'agree with a mistake.',
    ],
  }, null, 2) + '\n')
  console.log(`\nlayout: recorded ${RECORD} from ${target}`)
  console.log('  This is now the shape other screens are compared against. It is a claim that')
  console.log('  somebody looked at this layout and found it right — if that is not true, delete it.')
  process.exit(0)
}

const references = existsSync(referenceDir)
  ? (await import('node:fs')).readdirSync(referenceDir).filter(f => f.endsWith('.json'))
  : []

writeFileSync(join(outDir, 'layout.json'), JSON.stringify(measured, null, 2) + '\n')

console.log(`\nlayout: ${target}`)
console.log(`${css.length - unparsed.length} of ${css.length} stylesheet(s) parsed${unparsed.length ? `; ${unparsed.length} would not` : ''}\n`)

console.log(`  page background   ${measured.pageBackground.length ? measured.pageBackground.join(', ') : 'nothing paints the page — it inherits whatever the browser gives it'}`)
console.log(`  reading column    ${widest ? `${widest.value} at ${widest.file} ${widest.selector}` : 'no cap; the column is as wide as the window'}`)
console.log(`  distinct caps     ${distinctCaps.length ? distinctCaps.join(', ') + 'px' : 'none'}`)

// The project against itself, first. This is the answer for an existing codebase,
// and it needs nothing recorded.
if (caps || backgrounds) {
  console.log('\nAGAINST THIS PROJECT\'S OWN MAJORITY')
  if (caps) {
    console.log(`  reading column    ${caps.dominant}px in ${Math.round(caps.share * 100)}% of the caps declared here`)
  }
  if (backgrounds) {
    console.log(`  page background   ${backgrounds.dominant} in ${Math.round(backgrounds.share * 100)}% of what paints a page`)
  }
  const found = [...outliers.caps, ...outliers.backgrounds]
  if (found.length) {
    for (const o of outliers.caps) {
      console.log(`  ✗ ${o.value} at ${o.at} — used ${o.seen} time(s) against ${o.majority} at ${caps.dominant}px`)
    }
    for (const o of outliers.backgrounds) {
      // Collapsed: a multi-line gradient printed raw turns one finding into six
      // lines of CSS nobody reads.
      const short = o.value.replace(/\s+/g, ' ').slice(0, 60)
      console.log(`  ✗ the page is painted ${short}${o.value.length > 60 ? '…' : ''} at ${o.at}`)
      console.log(`      the rest of this project uses ${String(backgrounds.dominant).replace(/\s+/g, ' ').slice(0, 50)}`)
    }
    console.log('\n  An outlier is a question. A screen may genuinely want a different shape —')
    console.log('  but on one screen alone nobody notices, which is the whole reason to compare.')
  } else {
    console.log('  no declaration disagrees with the rest of the project')
  }
}

if (!references.length) {
  console.log('\n  No recorded reference, which an existing project does not need: it has its own')
  console.log('  screens to be compared against. Record one for a greenfield project, or for a')
  console.log('  redesign where the majority is the thing being replaced:')
  console.log('    ds layout <a repo whose layout is right> --record <name>')
} else {
  console.log(`\nAGAINST ${references.length} REFERENCE(S)`)
  for (const file of references) {
    const ref = JSON.parse(readFileSync(join(referenceDir, file), 'utf8'))
    const name = file.replace(/\.json$/, '')
    const notes = []
    if (ref.widestReadingColumn && widest && Math.abs(ref.widestReadingColumn.px - widest.px) > 160) {
      notes.push(`reading column ${widest.px}px against ${ref.widestReadingColumn.px}px`)
    }
    if (ref.pageBackground.length && measured.pageBackground.length
      && !measured.pageBackground.some(b => ref.pageBackground.includes(b))) {
      notes.push(`the page is painted ${measured.pageBackground[0]}, the reference uses ${ref.pageBackground[0]}`)
    }
    console.log(notes.length
      ? `  ✗ ${name}: ${notes.join('; ')}`
      : `  ✓ ${name}: the boxes that decide whether a page reads as a page agree`)
  }
  console.log('\n  A difference is a question, not a defect: two products may genuinely want')
  console.log('  different shapes. It is worth asking because nobody notices it on one screen.')
}

if (unparsed.length) {
  console.log(`\n  ${unparsed.length} stylesheet(s) did not parse and were skipped entirely:`)
  for (const u of unparsed.slice(0, 4)) console.log(`    ${u.file} — ${u.why}`)
  console.log('  Whatever they declare is missing from everything above. A silent skip here')
  console.log('  reported "no reading column" for a project that declares one.')
}

console.log('\nWHAT THIS CANNOT SEE')
console.log('  · Declared, not rendered. A width computed in JavaScript, or a background set by a')
console.log('    class this pass cannot follow to its rule, is invisible here.')
console.log('  · Alignment between a header and the content under it needs both boxes measured on')
console.log('    a page, which needs the project\'s own runner rather than its stylesheets.')
console.log(`\nwritten to scans/${scanSlot(target)}/layout.json`)
