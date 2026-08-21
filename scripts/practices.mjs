/**
 * Compare a project against the world-practice catalogue.
 *
 * Two jobs. On a greenfield project the catalogue IS the starting position,
 * because there is nothing to measure yet. On an existing project it is the
 * quieter of two voices: the measured convention wins, and a practice speaks up
 * only where it fills a gap, or where it is a published standard and the
 * divergence costs something outside taste.
 *
 * That precedence is the whole design. Walking into a client's codebase and
 * correcting its style against a blog post is how a consultant gets ignored on
 * the things that actually matter — so the tool is built to be unable to do it.
 *
 * Every practice carries a primary source, and the validator refuses one that
 * does not: a recommendation with nobody behind it is an opinion, and the client
 * has their own.
 *
 *   node scripts/practices.mjs <project>          compare a measured project
 *   node scripts/practices.mjs --greenfield       the starting position
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const catalogue = JSON.parse(readFileSync(join(root, 'practices', 'catalogue.json'), 'utf8'))
const project = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined
const greenfield = process.argv.includes('--greenfield')

/**
 * Which framework this project is, when there is a project.
 *
 * Read early because the greenfield listing prints citations too, and undefined
 * there is the right answer: with no project there is no framework to disagree
 * with, and the catalogue's own link stands unqualified.
 */
const framework = project
  ? (() => {
    try {
      return JSON.parse(readFileSync(join(root, 'scans', project, 'deep.json'), 'utf8')).framework?.name
    } catch { return undefined }
  })()
  : undefined

/**
 * The citation to show, which is not always the one written down.
 *
 * Seven of these practices are framework-agnostic principles carrying a link into
 * React's documentation, because that is where they are written down clearest. On
 * element-plus — a Vue project — the report advised "Split at the route boundary"
 * and cited `react.dev/reference/react/lazy`. The advice was right and the citation
 * made it unreadable: a team that has never written React sees a copy-paste, and
 * stops reading the rest.
 *
 * So a practice may carry a per-framework source, and where it does not, the
 * mismatch is said out loud rather than left for the reader to notice. Admitting
 * the link is React's costs one clause; letting them find it costs the report.
 */
const FRAMEWORK_IN = /^(React|Vue|Svelte|SvelteKit|Angular|Next|Nuxt)\b/
const citation = (p, framework) => {
  const own = p.sources?.[framework]
  if (own) return `${own.name} — ${own.url}`
  const named = FRAMEWORK_IN.exec(p.source.name)?.[1]?.toLowerCase()
  const foreign = framework && named && named !== framework && !(named === 'sveltekit' && framework === 'svelte')
  return `${p.source.name} — ${p.source.url}`
    + (foreign ? `\n      (the principle is not ${p.source.name.split(/\s*—\s*/)[0]}'s; that is where it is written down clearest)` : '')
}

// ── Validation, fail-closed ───────────────────────────────────────────────────

const AUTHORITY = new Set(['standard', 'official-docs', 'convention'])
const invalid = []
for (const [id, p] of Object.entries(catalogue.practices)) {
  if (!p.what) invalid.push(`${id}: no statement of the practice`)
  if (!p.why) invalid.push(`${id}: does not say what it prevents`)
  if (!AUTHORITY.has(p.authority)) invalid.push(`${id}: authority "${p.authority}" is not one of ${[...AUTHORITY].join(', ')}`)
  if (!p.source?.url || !p.source?.name) invalid.push(`${id}: no primary source — a recommendation with nobody behind it is an opinion`)
  if (p.overridesConvention && p.authority !== 'standard') {
    invalid.push(`${id}: claims to override a measured convention without being a standard`)
  }
}
if (invalid.length) {
  console.error(`practices: the catalogue is invalid — ${invalid.length} problem(s):`)
  for (const problem of invalid) console.error('  ✗ ' + problem)
  process.exit(1)
}

const badge = { standard: 'STANDARD', 'official-docs': 'DOCS    ', convention: 'CUSTOM  ' }

// ── Greenfield: the catalogue is the position ─────────────────────────────────

if (greenfield || !project) {
  console.log('\npractices: starting position for a project with nothing to measure yet\n')
  const groups = { standard: [], 'official-docs': [], convention: [] }
  for (const [id, p] of Object.entries(catalogue.practices)) groups[p.authority].push([id, p])

  for (const [authority, list] of Object.entries(groups)) {
    if (!list.length) continue
    const heading = authority === 'standard'
      ? 'STANDARDS — conformance, not preference; a divergence is a defect'
      : authority === 'official-docs'
        ? 'OFFICIAL DOCS — the maintainers say this; strong, still not binding'
        : 'CONVENTION — widely adopted and contestable; yields to anything the team decides'
    console.log(heading)
    for (const [id, p] of list) {
      console.log(`  ${p.name}`)
      console.log(`    ${p.what}`)
      console.log(`    why: ${p.why}`)
      console.log(`    source: ${citation(p, framework)}`)
      if (p.contested) console.log(`    contested: ${p.contested}`)
      console.log('')
    }
  }
  console.log('None of this outranks a decision the team makes and writes down.')
  console.log('On an existing project, run against the project instead: the measurement wins.')
  process.exit(0)
}

// ── Existing project: measurement first ───────────────────────────────────────

const scanDir = join(root, 'scans', project)
const load = (file) => existsSync(join(scanDir, file)) ? JSON.parse(readFileSync(join(scanDir, file), 'utf8')) : undefined
const measured = { ...load('scan.json'), defects: load('defects.json'), ...load('deep.json') }

/**
 * The denominator a practice is measured over, where the catalogue names one.
 *
 * A count of zero means two opposite things and the page presented only one. On
 * react-router — which has no test files at all — `Drive interaction with user-event
 * (measured 0)` sat under "the project does it differently", advising a team to use
 * a library in tests they have not written. The real finding is that there are no
 * tests, and this line hid it.
 *
 * Where the catalogue does not name a denominator, nothing is assumed: the practice
 * is compared as before. Guessing which field divides which is how a page starts
 * making claims nobody can check.
 */
const at = (path) => String(path).split('/').reduce((o, k) => (o === undefined || o === null ? o : o[k]), measured)
const denominatorOf = (p) => {
  if (!p.measuredOver) return undefined
  const v = at(p.measuredOver)
  return Array.isArray(v) ? v.length : v
}
if (!measured.target) {
  console.error(`practices: no measurement for "${project}". Run scan, defects and deep first.`)
  process.exit(1)
}

const valueAt = (path) => path.split('/').reduce((node, key) => (node == null ? undefined : node[key]), measured)

const gaps = []
const divergences = []
const met = []

for (const [id, p] of Object.entries(catalogue.practices)) {
  if (!p.dimension) { gaps.push({ id, p, reason: 'nothing measured for this' }); continue }
  const actual = valueAt(p.dimension)
  if (actual === undefined) { gaps.push({ id, p, reason: 'not measured on this project' }); continue }

  // The target is structured, not prose. Reading "0 where the product ships an
  // RTL language" with a heuristic reported a project at zero physical properties
  // as diverging from the practice it satisfies perfectly — the comparator has to
  // be told the operator rather than guess it from a sentence.
  if (!p.target) { gaps.push({ id, p, reason: 'no comparable target; for discussion, not for scoring' }); continue }

  // A count of zero over nothing is not a divergence. `Drive interaction with
  // user-event (measured 0)` was advice to a project with no test files at all,
  // printed under "the project does it differently" and pushing the real finding —
  // that there are no tests — off the page.
  const over = denominatorOf(p)
  if (over === 0) {
    gaps.push({ id, p, reason: `nothing to measure against: ${p.measuredOver} is 0 here, so this practice has no subject in this project` })
    continue
  }

  const asNumber = typeof actual === 'number' ? actual
    : Array.isArray(actual) ? actual.length
      : actual && typeof actual === 'object' && !actual.dominant ? Object.keys(actual).length
        : undefined
  const asString = typeof actual === 'string' ? actual : actual?.dominant

  let verdict
  if (p.target.op === 'equals') verdict = asString === p.target.value ? 'met' : 'diverges'
  else if (asNumber === undefined) { gaps.push({ id, p, reason: 'measured value is not a number' }); continue }
  else if (p.target.op === 'lte') verdict = asNumber <= p.target.value ? 'met' : 'diverges'
  else if (p.target.op === 'gte') verdict = asNumber >= p.target.value ? 'met' : 'diverges'
  if (!verdict) { gaps.push({ id, p, reason: 'unknown target operator' }); continue }
    ; (verdict === 'met' ? met : divergences).push({ id, p, actual: asString ?? asNumber })
}

const overriding = divergences.filter(d => d.p.overridesConvention)
const advisory = divergences.filter(d => !d.p.overridesConvention)

console.log(`\npractices: ${project}`)
console.log(`measured ${measured.analysedFiles ?? measured.scannedFiles} file(s); the measurement outranks this catalogue except where noted\n`)

if (overriding.length) {
  console.log('CONFORMANCE — published standards, and the project diverges. These are not style.')
  for (const d of overriding) {
    console.log(`  ✗ ${d.p.name}  (measured ${JSON.stringify(d.actual)})`)
    console.log(`      ${d.p.why}`)
    console.log(`      ${citation(d.p, framework)}`)
  }
  console.log('')
}

if (advisory.length) {
  console.log('WORTH RAISING — sourced, and the project does it differently. The team decides.')
  for (const d of advisory) {
    console.log(`  · [${badge[d.p.authority].trim()}] ${d.p.name}  (measured ${JSON.stringify(d.actual)})`)
    console.log(`      ${d.p.why}`)
    console.log(`      ${citation(d.p, framework)}`)
    if (d.p.contested) console.log(`      counter-argument on record: ${d.p.contested}`)
  }
  console.log('')
}

console.log(`ALREADY MET (${met.length}): ${met.map(m => m.p.name).join(' · ') || 'none'}\n`)

if (gaps.length) {
  console.log(`NOT COMPARABLE (${gaps.length}) — no measurement to hold these against:`)
  for (const g of gaps) console.log(`  ? ${g.p.name} — ${g.reason}`)
  console.log('')
}

console.log(`${overriding.length} conformance issue(s), ${advisory.length} question(s) for the team.`)
process.exit(0)
