/**
 * Fail when a shared prop name carries a meaning nobody wrote down.
 *
 * A shared prop name is a promise. `tone` on Alert and `tone` on ProgressBar must
 * accept the same words, or an agent that learned the system from one component
 * writes a type error against the next. harness already EXTRACTS each component's
 * unions into the profile (scripts/vocabulary.mjs); this is the other half — it
 * holds those unions to a declared vocabulary instead of only listing them.
 *
 * The direction that matters: a closed-union prop NAME used on two or more
 * components and NOT declared in roles/prop-vocabulary.json is red. Two components
 * is the threshold a word becomes a promise at — one component owning a word is
 * its own business, a second makes it a contract, and a contract has to be
 * written down. A value outside its declared axis is red too. It reads the
 * published profile, not TSX: the profile is the API agents actually consume.
 *
 * Each declared word carries the ONE question its prop answers (`axis`) and may
 * restrict where it is allowed — a word written with `onlyOn: interactive` (the
 * destructive ACTION, as opposed to the `danger` STATE) is red on any component
 * that renders no control of its own.
 *
 * Two things it will not do. It will not invent a preferred spelling: a word
 * outside the vocabulary is a question for a person, answered by using the
 * declared word or declaring the new one with its meaning. And it will not require
 * a component to accept every word — a subset of an axis is normal.
 *
 *   node scripts/lint-vocab.mjs                 check the "own" profile
 *   node scripts/lint-vocab.mjs --profile mui   check a different profile
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { propVocabulary, describeVocabulary } from './lib/vocab.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m'

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'

const profilePath = `${ROOT}/profiles/${PROFILE}/components.json`
if (!existsSync(profilePath)) {
  console.error(`${RED}✗ no profile at ${profilePath}${RESET}`)
  process.exit(1)
}
const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
const vocab = JSON.parse(readFileSync(`${ROOT}/roles/prop-vocabulary.json`, 'utf8'))

/* The declaration the engine reads: prop name -> { axis, values }. The `_` key is
 * the file's own preface, and `scoped` is metadata this script honours rather than
 * the engine, so both are stripped from what the engine is handed. */
const declared = Object.fromEntries(
  Object.entries(vocab).filter(([k]) => k !== '_'),
)
const SCOPED = new Set(Object.keys(declared).filter((k) => declared[k].scoped))

const findings = propVocabulary(profile.components, declared)

/* A component renders a control of its own — the difference between a destructive
 * ACTION and a bad STATE. Read from the profile's rendered-element set, the same
 * signal the twin check uses, so no second parser disagrees with the first. */
const CONTROL = /^(button|a|input|textarea|select)$/
const isInteractive = (name) => (profile.components[name]?.renders ?? []).some((t) => CONTROL.test(t))

/* Values written with `onlyOn: interactive`, checked against every component that
 * actually publishes them. The engine validates that a word is IN the axis; this
 * validates WHERE the word is allowed, which the engine does not model. */
const misplaced = []
for (const [prop, axis] of Object.entries(declared)) {
  for (const [word, meaning] of Object.entries(axis.values ?? {})) {
    if (!meaning || typeof meaning !== 'object' || meaning.onlyOn !== 'interactive') continue
    for (const [name, comp] of Object.entries(profile.components)) {
      const uses = (comp.props ?? []).some(
        (p) => p.name === prop && (p.values ?? []).map(String).includes(word),
      )
      if (uses && !isInteractive(name)) {
        misplaced.push({ prop, word, name, why: meaning.why })
      }
    }
  }
}

/* Findings the engine raises, minus the ones this file's own policy forgives:
 * a scoped axis is a component-local look, declared so the NAME is accounted for
 * but not policed value-by-value, so its words never count as outside-the-axis. */
const undeclared = findings.filter((f) => f.undeclared)
const outside = findings.filter((f) => f.outsideTheAxis && !SCOPED.has(f.prop))

/* The denominator, printed: how many components publish each declared prop, and
 * how many closed-union prop names the profile carries in all. A check that shows
 * only its failures reads as "nothing to find" when it means "I did not look". */
const usage = new Map(Object.keys(declared).map((p) => [p, 0]))
const unionNames = new Set()
for (const comp of Object.values(profile.components)) {
  for (const p of comp.props ?? []) {
    if (!Array.isArray(p.values) || !p.values.length) continue
    unionNames.add(p.name)
    if (usage.has(p.name)) usage.set(p.name, usage.get(p.name) + 1)
  }
}
console.log(
  `${BOLD}Prop vocabulary${RESET} ${DIM}profile ${PROFILE}, ${usage.size} declared prop(s), ` +
    `${unionNames.size} union prop name(s) in the profile${RESET}\n`,
)
for (const [prop, count] of usage) {
  const scoped = SCOPED.has(prop) ? ` ${DIM}(scoped)${RESET}` : ''
  console.log(`  ${prop.padEnd(11)} ${DIM}${String(count).padStart(2)} component(s)${RESET}${scoped}`)
}
console.log('')

if (undeclared.length) {
  console.error(`${RED}✗ ${undeclared.length} prop name(s) shared across components with nothing written down:${RESET}`)
  for (const f of undeclared) console.error(`    ${DIM}${describeVocabulary(f)}${RESET}`)
  console.error(
    `\n  Declare each in roles/prop-vocabulary.json: the ONE question it answers, and a` +
      `\n  sentence per value. If two components use the name for two different questions,` +
      `\n  that is two props wearing one name — rename one of them.\n`,
  )
  process.exit(1)
}
if (outside.length) {
  console.error(`${RED}✗ ${outside.length} prop(s) take a value outside their declared axis:${RESET}`)
  for (const f of outside) console.error(`    ${DIM}${describeVocabulary(f)}${RESET}`)
  console.error(`\n  Use a declared word, or add the new one to roles/prop-vocabulary.json with its meaning.\n`)
  process.exit(1)
}
if (misplaced.length) {
  console.error(`${RED}✗ ${misplaced.length} word(s) used where they are not allowed:${RESET}`)
  for (const m of misplaced) {
    console.error(`    ${m.name}: \`${m.prop}='${m.word}'\` on a component that renders no control`)
    console.error(`      ${DIM}${m.why}${RESET}`)
  }
  console.error(
    `\n  A shared prop name is a promise that the word means the same thing everywhere.` +
      `\n  Two words for one idea is how an agent learns the system wrong.\n`,
  )
  process.exit(1)
}
console.log(`${GREEN}✓ every shared word is declared, inside its axis, and where it belongs.${RESET}`)
