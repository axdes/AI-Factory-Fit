/**
 * The policy tier: what nobody can measure, laid out so it can be written.
 *
 * This started as an attempt to derive it. A component's atomic level looked like a
 * fact about the composition graph — a thing that renders nothing from the registry
 * is an atom, a thing that renders atoms is a molecule — and against 82 levels
 * written by hand it scored 35. The error had one shape: 34 of the 47 wrong were
 * over-estimates, and the reason is one pair.
 *
 *   Button uses  Icon, IconButton, Spinner   → authored `atom`
 *   Card   uses  Badge, Button, MetaItem     → authored `organism`
 *
 * Identical graphs, opposite levels, because the level says what a thing IS and not
 * what it contains. A button with a spinner in it is still a button. In-degree fares
 * no better: atoms run 0..34 incoming, molecules 0..19, organisms 0..6, medians 1, 0
 * and 0 — three overlapping ranges.
 *
 * So the level is irreducible, and 646 assignments across a 323-component profile
 * stay somebody's afternoon. What this does instead is make that afternoon finishable:
 *
 *   · every measured fact about a component on one line, so nobody opens the source
 *   · ordered by how much the answer matters — a component rendered thirty times
 *     first, one rendered never last, and the tail marked as skippable
 *   · the surface proposed from the level once the level is given, using the
 *     correlation measured in this very profile rather than a rule of thumb
 *
 * That last one is worth stating precisely. Across the 82 hand-written pairs here,
 * knowing the level gets the surface right 73% of the time: atom→card 24 of 26,
 * organism→region 15 of 18, and molecule a coin flip at 21 card against 17 region.
 * So it is offered where it is strong, refused where it is not, and always with the
 * count that earned it.
 *
 *   node scripts/policy.mjs <profile-id> [--out <file.json>] [--learn-from <profile-id>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSlot } from './lib/signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const PROFILE = process.argv[2]
const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? undefined : process.argv[i + 1] }
const OUT = arg('--out')
const LEARN = arg('--learn-from')
const REPO = arg('--repo')

if (!PROFILE || !existsSync(join(root, 'profiles', PROFILE, 'components.json'))) {
  console.error('usage: node scripts/policy.mjs <profile-id> [--out <file.json>] [--learn-from <profile-id>]')
  console.error(`  profiles here: ${readdirSync(join(root, 'profiles')).filter(d => !d.startsWith('.')).join(', ')}`)
  process.exit(2)
}

const load = (id) => {
  const at = join(root, 'profiles', id)
  const components = JSON.parse(readFileSync(join(at, 'components.json'), 'utf8')).components ?? {}
  let policy = { levels: {}, surfaces: {} }
  try { policy = { ...policy, ...JSON.parse(readFileSync(join(at, 'policy.json'), 'utf8')) } } catch { }
  return { components, policy }
}

const { components, policy } = load(PROFILE)
const names = Object.keys(components)

// ── What the level→surface correlation is worth, measured where it can be ──────
//
// From a profile that has both written down. The profile being worked on, if it has
// any; otherwise one named with --learn-from. Never a table of defaults: a rule of
// thumb about atoms and cards is the kind of thing that is true of somebody else's
// system.
const teacher = LEARN ? load(LEARN) : { components, policy }
const pairs = Object.keys(teacher.policy.levels ?? {})
  .filter(n => teacher.policy.surfaces?.[n])
  .map(n => [teacher.policy.levels[n], teacher.policy.surfaces[n]])

const surfaceGivenLevel = new Map()
for (const [level, surface] of pairs) {
  if (!surfaceGivenLevel.has(level)) surfaceGivenLevel.set(level, new Map())
  const m = surfaceGivenLevel.get(level)
  m.set(surface, (m.get(surface) ?? 0) + 1)
}
const proposeSurface = (level) => {
  const m = surfaceGivenLevel.get(level)
  if (!m) return undefined
  const ranked = [...m].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((n, [, c]) => n + c, 0)
  const [name, count] = ranked[0]
  const share = count / total
  // A coin flip is not a proposal. On the profile this was built against, molecules
  // split 21 card against 17 region, and offering `card` there would be inventing a
  // house rule out of a 55% majority.
  if (share < 0.7 || total < 5) {
    return { refused: true, why: `${ranked.map(([s, c]) => `${s} ${c}`).join(', ')} across ${total} — too even to call` }
  }
  return { surface: name, because: `${count} of ${total} ${level}s in ${LEARN ?? PROFILE} sit on a ${name}` }
}

// ── How much each answer matters ──────────────────────────────────────────────
//
// A component rendered thirty times decides thirty screens; one rendered never
// decides nothing, and the tail of a 323-component profile is mostly that. Ordering
// by it turns "write 323 descriptions" into "write the first forty".
const inDegree = new Map(names.map(n => [n, 0]))
for (const n of names) {
  for (const u of components[n].uses ?? []) if (inDegree.has(u) && u !== n) inDegree.set(u, inDegree.get(u) + 1)
}

/**
 * What a real codebase writes with these components, where one has been measured.
 *
 * This worksheet exists to make an unavoidable afternoon finishable, and the thing
 * that makes it finishable is knowing which answers matter. In-degree — how many
 * other components render this one — is a fact about the registry. How often a team
 * actually writes it, and with which values, is a fact about the work, and it is the
 * better guide to where a description earns its keep. A component the codebase never
 * writes can wait; one written two hundred times with three variants cannot.
 *
 * Absent without --repo, and the worksheet is unchanged. Nothing here is invented
 * from an empty measurement.
 */
const observed = (() => {
  if (!REPO) return {}
  try {
    const doc = JSON.parse(readFileSync(join(root, 'scans', scanSlot(REPO), 'vocabulary.json'), 'utf8'))
    if (doc.profile !== PROFILE) {
      console.error(`  ! ${relative(root, REPO) || REPO} was measured against the '${doc.profile}' profile, not '${PROFILE}'; usage is not shown`)
      return {}
    }
    return { axes: doc.axes ?? {}, sites: doc.sites ?? {}, uncalled: new Set(doc.uncalled ?? []) }
  } catch {
    console.error(`  ! no usage measured for ${relative(root, REPO) || REPO} — run: ds vocabulary ${REPO} --profile ${PROFILE}`)
    return {}
  }
})()

// Which signal orders the list, chosen by what this profile actually carries.
//
// In-degree is the one worth having: a component thirty others render decides thirty
// screens. But it is only populated where the extractor read component files — a
// profile from `ds adapt:css` has `uses: []` on every entry, and on a 323-component
// one that made every row 0 and the "ordered" list alphabetical. A list that looks
// ordered and is not is worse than an unordered one, so the signal is named.
const anyInDegree = [...inDegree.values()].some(n => n > 0)
const substanceOf = (name) => {
  const c = components[name]
  return (c.declarations ?? 0)
    + Object.keys(c.variants ?? {}).length * 3
    + (c.states ?? []).length * 2
    + (c.parts ?? []).length * 2
    + (c.props ?? []).length
}
// Call sites beat both, where a codebase has been measured. In-degree answers how
// many components depend on this one; call sites answer how often anybody writes it,
// and that is the question this worksheet asks — where a description earns its keep.
// The two disagree sharply and the disagreement is not academic: on memos, `Button`
// is written at 118 call sites and rendered by no other registry component, so
// in-degree put the single most valuable description at the bottom of the list,
// under `DialogOverlay`.
const sitesOf = (name) => observed.sites?.[name] ?? 0
const anySites = Object.keys(observed.sites ?? {}).length > 0

const ordering = anySites
  ? { by: 'callSites', label: 'how often this codebase writes it', weight: sitesOf }
  : anyInDegree
    ? { by: 'renderedBy', label: 'how many other components render it', weight: (n) => inDegree.get(n) }
    : { by: 'substance', label: 'how much is declared on it — no profile here records what renders what', weight: substanceOf }

// The nearest thing to each component, and what separates them.
//
// A description is the line that decides which component gets picked, so what it has
// to do is distinguish. Writing one for `Chip` in isolation produces "a small
// labelled element"; writing one knowing that `Badge` is the closest thing to it and
// that the difference is `selected` and `variant` produces a line somebody can choose
// on.
//
// Deliberately looser than the twin check, which needs two signals before it will
// call a pair a possible duplicate. Nothing is being alleged here — the nearest
// neighbour is material for writing, not a finding, so prop overlap alone is enough.
const UNIVERSAL = new Set(['className', 'class', 'style', 'id', 'children', 'ref', 'key', 'as', 'asChild'])
const propsOf = (n) => new Set((components[n].props ?? []).map(p => p.name).filter(p => !UNIVERSAL.has(p)))
const nearestTo = (name) => {
  const mine = propsOf(name)
  if (mine.size < 2) return undefined
  let best
  for (const other of names) {
    if (other === name) continue
    const theirs = propsOf(other)
    if (theirs.size < 2) continue
    let shared = 0
    for (const p of mine) if (theirs.has(p)) shared += 1
    const score = shared / (mine.size + theirs.size - shared)
    // Two props in common at least, not a ratio alone. `Icon` and `Textarea` share
    // one prop out of three each and scored 0.33, which is above any threshold worth
    // setting and is not material anybody can write from.
    if (shared >= 2 && score > 0.3 && (!best || score > best.score)) {
      best = {
        name: other,
        score: Number(score.toFixed(2)),
        // Whether one is built out of the other. `Input` and `PasswordInput` declare
        // exactly the same three props, and a writer reading that alone would take
        // them for rivals — PasswordInput renders Input, so the description has to
        // say what wrapping it adds, not how the two differ.
        composes: (components[other].renders ?? []).includes(name) ? other
          : (components[name].renders ?? []).includes(other) ? name
            : undefined,
        // What one has and the other does not, which is the sentence a description
        // has to carry.
        onlyHere: [...mine].filter(p => !theirs.has(p)).sort(),
        onlyThere: [...theirs].filter(p => !mine.has(p)).sort(),
      }
    }
  }
  return best
}

const rows = names.map(name => {
  const c = components[name]
  const level = policy.levels?.[name] ?? c.level ?? null
  const proposed = level ? proposeSurface(level) : undefined
  return {
    name,
    renderedBy: inDegree.get(name),
    // What put this row where it is, so a reader can see the list is ordered by
    // something and by which thing.
    orderedBy: ordering.by,
    weight: ordering.weight(name),
    // Everything measured, so nobody opens the source to answer this.
    evidence: {
      props: (c.props ?? []).length,
      variants: Object.keys(c.variants ?? {}),
      states: c.states ?? [],
      parts: c.parts ?? [],
      renders: (c.renders ?? []).slice(0, 6),
      usesFromRegistry: (c.uses ?? []).slice(0, 6),
      from: c.from,
    },
    // The material for a description, not a description. Nothing here says what a
    // component is for; it says what it would have to be distinguished from.
    nearest: nearestTo(name),
    level,
    surface: policy.surfaces?.[name] ?? c.surface ?? null,
    surfaceProposed: level && !policy.surfaces?.[name] && proposed && !proposed.refused ? proposed : undefined,
    surfaceRefused: level && !policy.surfaces?.[name] && proposed?.refused ? proposed.why : undefined,
  }
}).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))

const needLevel = rows.filter(r => !r.level)
const needSurface = rows.filter(r => !r.surface)
const neverRendered = rows.filter(r => r.renderedBy === 0)

console.log(`\npolicy: ${PROFILE} — ${names.length} component(s)\n`)
console.log(`  ${needLevel.length} without an atomic level · ${needSurface.length} without a surface`)
if (pairs.length) {
  console.log(`  level→surface learned from ${pairs.length} pair(s) in ${LEARN ?? PROFILE}:`)
  for (const [level, m] of surfaceGivenLevel) {
    const ranked = [...m].sort((a, b) => b[1] - a[1])
    const total = ranked.reduce((n, [, c]) => n + c, 0)
    const strong = ranked[0][1] / total >= 0.7 && total >= 5
    console.log(`    ${level.padEnd(10)} ${ranked.map(([s, c]) => `${s} ${c}`).join(' · ')}   ${strong ? `→ ${ranked[0][0]}` : '→ too even to call'}`)
  }
} else {
  console.log('  No profile here has both a level and a surface written down, so there is')
  console.log('  nothing to learn the correlation from. Name one with --learn-from.')
}

console.log(`\nTHE ORDER TO WRITE THEM IN — by ${ordering.label}`)
if (!anyInDegree) {
  console.log('  Nothing here records what renders what, so the best signal is missing and')
  console.log('  this is the second best: a family with five variants and three states is')
  console.log('  substantial, one with a name and nothing else may be a leftover class.')
}
for (const r of rows.slice(0, 12)) {
  const e = r.evidence
  const shape = [
    e.props ? `${e.props} props` : undefined,
    e.variants.length ? `variants: ${e.variants.join('/')}` : undefined,
    e.states.length ? `states: ${e.states.slice(0, 3).join('/')}` : undefined,
    e.parts.length ? `${e.parts.length} parts` : undefined,
    e.usesFromRegistry.length ? `uses ${e.usesFromRegistry.slice(0, 3).join(', ')}` : undefined,
  ].filter(Boolean).join(' · ')
  const mark = anySites ? `${String(sitesOf(r.name)).padStart(3)}×`
    : anyInDegree ? `${String(r.renderedBy).padStart(3)}×`
      : String(r.weight).padStart(4)
  console.log(`  ${mark}  ${r.name.padEnd(22)} ${r.level ?? '·'} ${shape || 'nothing measured beyond its name'}`)
  // Kept on its own line and labelled. What a component ACCEPTS is in `variants`
  // above; this is what the team WRITES. Merging them would let a habit read as a
  // constraint, which is the one thing this measurement must not cause.
  const seen = observed.axes?.[r.name]
  if (seen && Object.keys(seen).length) {
    console.log(`        written here: ${Object.entries(seen).map(([p, a]) =>
      `${p} = ${Object.entries(a.observed).map(([v, n]) => `${v}×${n}`).join(' ')}`).join(' · ')}`)
  } else if (observed.uncalled?.has(r.name)) {
    console.log('        never written in this codebase — its description can wait')
  }
  if (r.nearest) {
    const diff = [
      r.nearest.onlyHere.length ? `only here: ${r.nearest.onlyHere.slice(0, 4).join(', ')}` : undefined,
      r.nearest.onlyThere.length ? `only there: ${r.nearest.onlyThere.slice(0, 4).join(', ')}` : undefined,
    ].filter(Boolean).join(' · ')
    const rel = r.nearest.composes
      ? ` — ${r.nearest.composes} renders the other, so this is a wrapper, not a rival`
      : diff ? ' — ' + diff : ' — the same props exactly, and neither renders the other'
    console.log(`        nearest ${r.nearest.name} (${r.nearest.score})${rel}`)
  }
}
if (rows.length > 12) console.log(`  … ${rows.length - 12} more, in the same order`)

if (anyInDegree && neverRendered.length) {
  console.log(`\n  ${neverRendered.length} component(s) are rendered by nothing else in this registry.`)
  console.log('  They may be entry points, or they may be dead. Either way an answer for them')
  console.log('  decides nothing until something reaches for them, so they are last.')
}

console.log('\nWHAT THIS DOES NOT DO, AND CANNOT')
console.log('  The atomic level is not derivable. Against 82 levels written by hand, a rule')
console.log('  reading the composition graph scored 35, and the reason is one pair: Button')
console.log('  renders Icon, IconButton and Spinner and is an atom; Card renders Badge,')
console.log('  Button and MetaItem and is an organism. Identical graphs, opposite answers,')
console.log('  because the level says what a thing IS. In-degree overlaps too — atoms run')
console.log('  0..34 incoming, molecules 0..19, organisms 0..6.')

if (!OUT) {
  console.log('\nNothing was written. Add --out <file.json> to keep this as a worksheet.')
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  profile: PROFILE,
  _: [
    'A worksheet, not a result. `level` is null wherever nobody has written one, and',
    'nothing here fills it: against 82 hand-written levels a rule reading the',
    'composition graph scored 35, because Button renders three components and is an',
    'atom while Card renders three and is an organism.',
    '',
    'Rows are ordered by ' + ordering.label + ', so the answers that decide the most',
    'come first and the tail that decides nothing comes last. `orderedBy` on each row',
    'says which signal that was — in-degree where the extractor read component files,',
    'and how much is declared where it read only stylesheets.',
    '',
    '`surfaceProposed` appears only where the level is known and the correlation',
    'measured in a profile that has both is strong enough to carry it. Where it is a',
    'coin flip, `surfaceRefused` says so with the counts instead.',
  ],
  learnedFrom: { profile: LEARN ?? PROFILE, pairs: pairs.length },
  components: rows,
}, null, 2) + '\n')
console.log(`\nwritten to ${relative(process.cwd(), OUT)} — a worksheet.`)
console.log('Fill in `level`; the surfaces that follow strongly are already proposed beside it.')
