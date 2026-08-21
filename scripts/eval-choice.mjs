/**
 * Does the registry let the right component be chosen for a stated need?
 *
 * The question the judgment tier exists to answer, and until now the one thing about
 * it nobody could measure. Stripping all 93 descriptions from `own` changed neither
 * `bind --check` nor `draft-spec` by a single line: both match on names, props and
 * role bindings, so neither could ever show what a description is worth. That is
 * recorded as a proven negative in the test suite; this is the pass that makes the
 * question answerable instead.
 *
 * The method is keyword matching, the same as `draft-spec`, and for the same reason:
 * it is what the tool already does, it is reproducible, and an LLM in the loop would
 * make the result depend on which model ran it. What is compared is not the ranker —
 * it is held fixed — but how much the registry gives it to work with.
 *
 * Three conditions over the same cases:
 *
 *   names only          what a picker sees with no judgment tier at all
 *   with descriptions   the authored tier as it stands
 *   with proposed       whatever `--proposed <file>` holds, for testing generated ones
 *
 * The labelled cases are in `evals/choice.json` and are nearly none. Each one had to
 * be authored independently of the descriptions being measured — a case written from
 * a description measures the description against itself — so they come from zone
 * purposes in specs a person wrote, and there are four distinct ones. Four is below
 * the floor this tool refuses to draw conclusions under, and this pass refuses too.
 *
 *   node scripts/eval-choice.mjs [--profile own] [--proposed <file.json>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_OBSERVATIONS } from './lib/signals.mjs'
import { counted, countedLine } from './lib/counted.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? undefined : process.argv[i + 1] }
const PROPOSED = arg('--proposed')

const casesPath = join(root, 'evals', 'choice.json')

/**
 * Recording a case, which is the only way this file ever fills.
 *
 * Four labelled cases is not a measurement, and hand-editing JSON is not how a
 * fifth arrives. But the evidence is already produced by ordinary work: `draft-spec`
 * turns a requirement into elements and records the phrase behind each one — the
 * words the person actually used — and then a person corrects the draft. The
 * correction IS the label: this need, in their words, and the component they chose
 * instead of the one proposed.
 *
 * Kept and changed elements are both recorded, and the changed ones are the valuable
 * half: agreeing with a proposal says the proposal was easy, and disagreeing says
 * where judgment was needed.
 */
const RECORD = process.argv.indexOf('--record')
if (RECORD !== -1) {
  const draftAt = process.argv[RECORD + 1]
  const finalAt = process.argv[RECORD + 2]
  if (!draftAt || !finalAt || !existsSync(draftAt) || !existsSync(finalAt)) {
    console.error('usage: node scripts/eval-choice.mjs --record <draft.json> <corrected.json> [--profile <id>]')
    console.error('  the draft is what `draft-spec --out` wrote; the corrected one is what a person left')
    process.exit(2)
  }
  const profileId = arg('--profile') ?? 'own'
  const bindingsAt = join(root, 'bindings', `${profileId}.json`)
  const roles = existsSync(bindingsAt) ? (JSON.parse(readFileSync(bindingsAt, 'utf8')).roles ?? {}) : {}

  const draft = JSON.parse(readFileSync(draftAt, 'utf8'))
  const corrected = JSON.parse(readFileSync(finalAt, 'utf8'))

  // The phrase behind each drafted element, which is the person's own wording.
  const phraseFor = new Map()
  for (const zone of draft.zones ?? []) {
    for (const line of zone._evidence ?? []) {
      const m = /^(\S+)\s*←\s*"(.+)"$/.exec(line)
      if (m) phraseFor.set(`${zone.name}/${m[1]}`, m[2])
    }
  }

  const roleOf = (element) => String(element).split(/\s/)[0]
  const componentFor = (role) => roles[role]?.component

  const store = existsSync(casesPath) ? JSON.parse(readFileSync(casesPath, 'utf8')) : { schemaVersion: 1, profile: profileId, cases: [] }
  const already = new Set((store.cases ?? []).map(c => `${c.need}|${c.component}`))
  const added = []
  const skipped = []

  for (const zone of corrected.zones ?? []) {
    const drafted = (draft.zones ?? []).find(z => z.name === zone.name)
    for (const element of zone.elements ?? []) {
      const role = roleOf(element)
      const component = componentFor(role)
      if (!component) { skipped.push(`${role}: no component bound for this role in '${profileId}'`); continue }
      // The phrase for this role, or for the one it replaced in the same zone.
      const phrase = phraseFor.get(`${zone.name}/${role}`)
        ?? (drafted?._evidence ?? []).map(l => /^(\S+)\s*←\s*"(.+)"$/.exec(l)).filter(Boolean)
          .find(m => !(zone.elements ?? []).some(e => roleOf(e) === m[1]))?.[2]
      if (!phrase) { skipped.push(`${role}: no phrase in the draft to attribute this to`); continue }
      const key = `${phrase}|${component}`
      if (already.has(key)) { skipped.push(`${role}: already recorded`); continue }
      already.add(key)
      const wasDrafted = (drafted?.elements ?? []).some(e => roleOf(e) === role)
      added.push({
        need: phrase,
        role,
        component,
        // Which half this is. A correction is worth more than a confirmation and the
        // file has to say which it is, or a set full of easy agreements will look
        // like a set full of judgment.
        person: wasDrafted ? 'kept the proposal' : 'chose this instead of the proposal',
        from: `${draftAt} → ${finalAt}`,
      })
    }
  }

  if (!added.length) {
    console.log('\neval-choice: nothing new to record.')
    for (const s of skipped.slice(0, 6)) console.log(`  · ${s}`)
    process.exit(0)
  }

  store.cases = [...(store.cases ?? []), ...added]
  writeFileSync(casesPath, JSON.stringify(store, null, 2) + '\n')
  console.log(`\neval-choice: ${added.length} case(s) recorded, ${store.cases.length} in the set`)
  for (const c of added) console.log(`  ${c.component.padEnd(16)} ← "${c.need}"   (${c.person})`)
  const distinctNow = new Set(store.cases.map(c => c.need)).size
  console.log(`\n${distinctNow} distinct need(s). ${distinctNow < MIN_OBSERVATIONS ? `${MIN_OBSERVATIONS - distinctNow} more and this becomes a measurement.` : 'That is above the floor: `ds eval:choice` will now answer.'}`)
  process.exit(0)
}

if (!existsSync(casesPath)) {
  console.error('eval-choice: no labelled cases at evals/choice.json — there is nothing to measure against.')
  process.exit(2)
}
const set = JSON.parse(readFileSync(casesPath, 'utf8'))
const PROFILE = arg('--profile') ?? set.profile ?? 'own'

const profilePath = join(root, 'profiles', PROFILE, 'components.json')
if (!existsSync(profilePath)) {
  console.error(`eval-choice: no profile '${PROFILE}'`)
  process.exit(2)
}
const components = JSON.parse(readFileSync(profilePath, 'utf8')).components ?? {}

const proposed = PROPOSED && existsSync(PROPOSED)
  ? JSON.parse(readFileSync(PROPOSED, 'utf8'))
  : undefined

/** Words that match everything and therefore separate nothing. */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'is', 'are', 'it', 'its', 'this', 'that', 'one', 'per', 'when', 'where', 'which', 'as', 'at',
  'be', 'from', 'into', 'over', 'up', 'down', 'not', 'no', 'any', 'each', 'their', 'there'])

const words = (text) => [...new Set(String(text ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase().match(/[a-z][a-z-]{1,}/g) ?? [])].filter(w => !STOP.has(w))

/**
 * What a picker can read about a component under each condition.
 *
 * Props and the component's own name are always visible: they are facts, present
 * whether or not anybody has written a word of judgment. Only the sentence changes.
 */
const textFor = (name, condition) => {
  const c = components[name] ?? {}
  const base = [name, ...(c.props ?? []).map(p => p.name),
    ...Object.values(c.variants ?? {}).flatMap(v => Array.isArray(v?.values) ? v.values : [])]
  if (condition === 'names') return base.join(' ')
  if (condition === 'authored') return [...base, c.description ?? ''].join(' ')
  return [...base, proposed?.[name] ?? ''].join(' ')
}

const names = Object.keys(components)

/** Overlap, and ties broken by nothing: a tie is reported as the rank it is. */
const rankOf = (need, answer, condition) => {
  const q = words(need)
  const scored = names.map(n => {
    const t = new Set(words(textFor(n, condition)))
    return { n, score: q.filter(w => t.has(w)).length }
  }).sort((a, b) => b.score - a.score || a.n.localeCompare(b.n))
  const best = scored[0].score
  // Everything scoring zero is unranked, not ranked last: the picker has no reason
  // to prefer any of them and saying otherwise would flatter the condition.
  const hit = scored.findIndex(s => s.n === answer)
  if (hit === -1 || scored[hit].score === 0) return { rank: undefined, best }
  return { rank: hit + 1, best }
}

const CONDITIONS = [
  ['names', 'names and props only — no judgment tier at all'],
  ['authored', 'plus the authored descriptions'],
  ...(proposed ? [['proposed', `plus the proposed descriptions from ${PROPOSED}`]] : []),
]

console.log(`\neval-choice: ${set.cases.length} labelled case(s) against the ${PROFILE} profile`)
console.log(`${names.length} component(s) to choose between\n`)

const results = {}
for (const [condition, label] of CONDITIONS) {
  const ranks = set.cases.map(c => rankOf(c.need, c.component, condition).rank)
  const found = ranks.filter(r => r !== undefined)
  const top1 = ranks.filter(r => r === 1).length
  const mrr = found.length ? found.reduce((s, r) => s + 1 / r, 0) / set.cases.length : 0
  results[condition] = { top1, found: found.length, mrr }
  console.log(`  ${label}`)
  console.log(countedLine('    chosen first', counted(top1, set.cases.length, 'case')))
  console.log(countedLine('    found at all', counted(found.length, set.cases.length, 'case')))
  console.log(`     ${mrr.toFixed(2)}  mean reciprocal rank`)
  console.log('')
}

// The verdict, and the refusal to give one.
//
// Four distinct needs behind eight cases is the same shape as a convention drawn
// from one file: whatever the difference is, it is arithmetic over too little. The
// floor is the one the rest of this tool uses.
const distinct = new Set(set.cases.map(c => c.need)).size
const delta = results.authored.top1 - results.names.top1

if (distinct < MIN_OBSERVATIONS) {
  console.log(`NOT A MEASUREMENT — ${distinct} distinct need(s) behind ${set.cases.length} case(s), below the floor of ${MIN_OBSERVATIONS}.`)
  console.log(`The difference above is ${delta >= 0 ? '+' : ''}${delta} case(s), and over ${distinct} needs that is noise wearing a number.`)
  console.log('')
  console.log('Every case here was authored independently of the descriptions it measures.')
  console.log('That is what makes them scarce and what makes them worth anything: a case')
  console.log('written from a description measures the description against itself.')
  console.log('')
  console.log('Fill evals/choice.json from a real engagement — one case is one need somebody')
  console.log('stated in their own words and the component a person chose for it.')
  process.exit(0)
}

console.log(`Descriptions moved first-choice accuracy by ${delta >= 0 ? '+' : ''}${delta} of ${set.cases.length} case(s).`)
