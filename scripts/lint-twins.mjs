/**
 * Fail when two components in a library resemble each other and nobody has said why.
 *
 * The contract everywhere says: search the registry before building. Nothing holds
 * the LIBRARY to it, so the seventy-fourth component can quietly repeat the
 * thirtieth — the one place a duplicate is most expensive, because every product
 * that adopts the library inherits it. This reads the published profile and asks
 * the question the contract never asks of the system itself.
 *
 * Two signals, and both have to be high: the Jaccard of prop-name sets and the
 * Jaccard of rendered-element sets. Prop overlap alone is noise (two small
 * components agree by accident); rendered-markup overlap alone is noise the other
 * way (most of a system is divs and spans). Together they are specific. The engine
 * is scripts/lib/twins.mjs, pinned by tests; this runs it against a real profile
 * at the reference thresholds and enforces the registry.
 *
 * Composition is not duplication: when one component renders the other, the second
 * is built ON the first (RangeSlider renders Slider, ProgressBar renders Meter),
 * and those pairs are dropped before scoring — which is why the three pairs the
 * reference had to hand-wave are simply not twins here.
 *
 * Enforcement is bidirectional. A flagged pair with no entry in roles/twins.json
 * FAILS: fold one into the other, or record what separates them and what would
 * make them one component again. A recorded pair that has stopped resembling its
 * twin also FAILS as stale — a stale excuse waives a future duplicate.
 *
 *   node scripts/lint-twins.mjs                 check the "own" profile
 *   node scripts/lint-twins.mjs --profile mui   check a different profile
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findTwins } from './lib/twins.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m'

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'

/* Both signals cleared at these levels flag a pair. They match the reference twin
 * check (0.5 on each): a pair that agrees on half its prop names AND half its
 * rendered markup is worth a person's minute. The engine's own defaults are
 * stricter on props; harness records the richer composition edge in `renders`, so
 * the loosening is safe — a wrapper is excluded as composition, not by a threshold. */
const PROP_THRESHOLD = 0.5
const RENDER_THRESHOLD = 0.5

const profilePath = `${ROOT}/profiles/${PROFILE}/components.json`
if (!existsSync(profilePath)) {
  console.error(`${RED}✗ no profile at ${profilePath}${RESET}`)
  process.exit(1)
}
const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
const declared = JSON.parse(readFileSync(`${ROOT}/roles/twins.json`, 'utf8'))

const result = findTwins(profile.components, {
  declared,
  propThreshold: PROP_THRESHOLD,
  renderThreshold: RENDER_THRESHOLD,
})

/* The denominator, printed. A check that reports only its failures reads as
 * "nothing to find" when it means "I did not look": both signals cost coverage,
 * and the components that could not be compared are questions this pass did not
 * answer, not questions it answered "no". */
console.log(
  `${BOLD}Twins${RESET} ${DIM}profile ${PROFILE}, ${result.considered} components compared, ` +
    `${result.notComparable} not comparable${RESET}`,
)
if (!result.ran) {
  console.error(`\n${RED}✗ nothing could be compared: no rendered-markup signal in this profile.${RESET}`)
  console.error(`  ${DIM}${result.why ?? ''}${RESET}`)
  process.exit(1)
}
console.log('')

for (const t of result.answered) {
  console.log(`  ${GREEN}✓${RESET} ${t.pair.padEnd(28)} ${DIM}props ${t.byProps}, markup ${t.byRenders}${RESET}`)
  if (t.separated) console.log(`      ${DIM}${t.separated}${RESET}`)
}
for (const t of result.unanswered) {
  console.log(`  ${RED}✗${RESET} ${t.pair.padEnd(28)} ${DIM}props ${t.byProps}, markup ${t.byRenders}${RESET}`)
}
console.log('')

if (result.unanswered.length) {
  console.error(`${RED}✗ ${result.unanswered.length} pair(s) resemble each other and nobody has said why:${RESET}`)
  for (const t of result.unanswered) console.error(`    ${t.pair} ${DIM}(props ${t.byProps}, markup ${t.byRenders})${RESET}`)
  console.error(
    `\n  Either fold one into the other, or add the pair to roles/twins.json with what` +
      `\n  separates them and what would make them one component again. A duplicate in the` +
      `\n  library is inherited by every product that consumes it.\n`,
  )
  process.exit(1)
}
if (result.stale.length) {
  console.error(`${RED}✗ ${result.stale.length} recorded pair(s) no longer resemble each other:${RESET}`)
  for (const p of result.stale) console.error(`    ${p}`)
  console.error(`\n  Remove them from roles/twins.json — a stale excuse waives a future duplicate.\n`)
  process.exit(1)
}
console.log(`${GREEN}✓ no unexplained twin inside the library.${RESET}`)
