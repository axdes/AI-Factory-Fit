/**
 * The map from the roles a spec names to the components a profile holds — proposed.
 *
 * This is the wall a freshly measured project hits. `ds adapt:css` extracts a
 * profile in seconds and every spec then fails with `no bindings for "x"`: the
 * components are known, and nothing says which of them answers `primaryAction`.
 * The bindings for `own`, `mui` and `antd` were written by hand, and so was the one
 * for a real client project — which is the proof it can be done and the proof that
 * doing it is the bottleneck.
 *
 * A binding is a judgment: deciding that this system's `Btn` with its `primary`
 * modifier is what a spec means by `primaryAction` is a decision about the product,
 * not a fact in the stylesheet. So this proposes rather than writes, on the same
 * terms as the page frame: the file lands outside anything that reads bindings,
 * every match says what it rests on, and a role with no candidate is recorded as
 * uncovered with the reason rather than filled with the nearest thing.
 *
 * What the matching may use is deliberately narrow — a name, a selector, a variant
 * value. Anything looser invents a mapping that compiles and is wrong, which is the
 * expensive kind: the screen builds, and the wrong component is in it.
 *
 *   node scripts/bind.mjs <profile-id> [--repo <path>] [--out <file.json>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const PROFILE = process.argv[2]
const repoFlag = process.argv.indexOf('--repo')
const REPO = repoFlag === -1 ? undefined : process.argv[repoFlag + 1]
const outFlag = process.argv.indexOf('--out')
const OUT = outFlag === -1
  ? (REPO ? join(REPO, '.ds', 'proposals', 'bindings.json') : undefined)
  : process.argv[outFlag + 1]

if (!PROFILE || !existsSync(join(root, 'profiles', PROFILE, 'components.json'))) {
  console.error('usage: node scripts/bind.mjs <profile-id> [--repo <path>] [--out <file.json>]')
  console.error(`  profiles here: ${readdirSync(join(root, 'profiles')).filter(d => !d.startsWith('.')).join(', ')}`)
  process.exit(2)
}
// Refused over a binding somebody wrote; not over an empty one.
//
// `ds adapt:react` writes a stub with no roles and a comment saying why it is
// empty, which is the honest thing for it to do — and this guard read that stub as
// a decision and refused to propose anything, on exactly the profile a proposal is
// for. A placeholder is not a judgment.
// Measured against the bindings people actually wrote.
//
// The synonym table below is authored — every entry is a claim that two words mean
// the same thing — and until this mode existed nothing checked those claims. Four
// bindings in this repository were written by hand across four different libraries,
// which is eighty-eight role decisions to be wrong about.
//
// What matters is not the agreement rate. It is the shape of the disagreements: a
// role the proposer left uncovered that somebody filled costs a reader one lookup,
// and a role the proposer filled that somebody deliberately left uncovered puts the
// wrong component on a screen that compiles.
const CHECK = process.argv.includes('--check')

const existingPath = join(root, 'bindings', `${PROFILE}.json`)
if (existsSync(existingPath) && !CHECK) {
  let existing
  try { existing = JSON.parse(readFileSync(existingPath, 'utf8')) } catch { existing = undefined }
  const filled = Object.keys(existing?.roles ?? {}).length
  if (filled) {
    console.error(`\nbind: "${PROFILE}" already has a binding at bindings/${PROFILE}.json, with ${filled} role(s) in it.`)
    console.error('Nothing is proposed over one that exists — that map is somebody\'s decision,')
    console.error('and replacing it with a guess is the one thing this must not do.')
    process.exit(2)
  }
  console.log(`\nbindings/${PROFILE}.json exists and is empty — a placeholder, not a decision. Proposing into it.`)
}

const vocabulary = JSON.parse(readFileSync(join(root, 'roles', 'vocabulary.json'), 'utf8'))
const profile = JSON.parse(readFileSync(join(root, 'profiles', PROFILE, 'components.json'), 'utf8'))
const components = profile.components ?? {}

/**
 * The words a role and a component may be called by, where they differ.
 *
 * Authored, small, and listed here rather than buried in a regex, because every
 * entry is a claim that two words mean the same thing to a reader. `btn` for button
 * is a fact about how people write CSS; `panel` for card is a habit worth naming as
 * one. Anything not here is not matched by meaning — only by spelling.
 */
const SAME_THING = {
  primaryAction: ['button', 'btn'],
  secondaryAction: ['button', 'btn'],
  iconAction: ['iconbutton', 'iconbtn'],
  textInput: ['input', 'textfield', 'textbox'],
  searchInput: ['search', 'searchbox', 'searchfield'],
  select: ['dropdown', 'combobox', 'picker'],
  toggle: ['switch'],
  statusTag: ['tag', 'badge', 'chip', 'label', 'pill'],
  inlineMessage: ['alert', 'callout', 'banner', 'notice'],
  transientMessage: ['toast', 'snackbar', 'notification'],
  loading: ['spinner', 'loader', 'progress', 'circularprogress', 'spin', 'loadingindicator'],
  skeleton: ['placeholder', 'shimmer'],
  emptyState: ['empty', 'blankslate', 'nodata'],
  dialog: ['modal', 'drawer', 'sheet'],
  // `toolbar` was here and is gone: MUI's binding says outright that MUI ships no
  // page header and composes one from Toolbar, Typography and an action. Proposing
  // Toolbar contradicted the only person who had looked.
  pageHeader: ['header', 'pagetitle'],
  // `Typography` and `PageHeader` answered `heading` in three of the four bindings
  // people wrote here, and it was the single most-missed role until they were added.
  heading: ['title', 'headline', 'typography', 'pageheader', 'sectionheading'],
  text: ['paragraph', 'body', 'typography'],
  card: ['panel', 'tile', 'surface'],
  divider: ['separator', 'rule', 'hr'],
  avatar: ['profilepicture', 'userpic'],
  tooltip: ['popover', 'hint'],
  pagination: ['pager', 'paginator'],
  list: ['listview', 'stack'],
  table: ['datagrid', 'grid', 'datatable'],
  tabs: ['tabbar', 'tablist'],
  checkbox: ['check', 'tickbox'],
}

const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The prefix this library puts on everything, if it has one.
 *
 * A design system routinely stamps its components: `DsButton`, `AppShell`,
 * `my-global-icon`, `UiTable`. Matched against the role vocabulary raw, every one of
 * them becomes a spelling guess at best — on a real Vue project this proposed nothing
 * confidently and marked `DsSelect` for `select` as "name only contains select",
 * which is true and useless.
 *
 * Measured rather than listed: a prefix is a house prefix when most of the library
 * carries it. Two or three letters, because `Data`/`Form`/`Page` are words a
 * component is named for rather than stamps on it, and stripping those would make
 * `FormField` match `field`.
 */
const housePrefix = (() => {
  const names = Object.keys(components).filter(n => /^[A-Z]/.test(n))
  if (names.length < 4) return undefined
  for (const len of [2, 3]) {
    const tally = new Map()
    for (const n of names) {
      const head = n.slice(0, len)
      // Only where a capital follows, so `Ds` in `DsButton` counts and `Da` in
      // `Datagrid` does not.
      if (/^[A-Z][a-z]?$/.test(head) && /^[A-Z]/.test(n.slice(len))) {
        tally.set(head, (tally.get(head) ?? 0) + 1)
      }
    }
    const top = [...tally].sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] / names.length >= 0.7) return { prefix: top[0], on: top[1], of: names.length }
  }
  return undefined
})()

/**
 * Roles that no library answers with a component of their own.
 *
 * Measured against the four bindings written by hand here. `searchInput` was missed
 * on three of the four, and on all three the person had written the library's plain
 * text field — MUI's `TextField`, Ant's `Input`, memos' `Input`. `iconAction` was
 * missed on Ant, where the person wrote `Button`. These are not synonyms: nobody
 * calls a text field a search input. They are roles that a library answers by
 * reaching for the more general component, and every one of the four did it.
 *
 * A fallback is weaker evidence than a name and is marked as such in the proposal —
 * it says which role it borrowed from, so a reader can see that the library has no
 * dedicated component rather than that this guessed.
 */
const FALLS_BACK_TO = {
  searchInput: 'textInput',
  iconAction: 'primaryAction',
  secondaryAction: 'primaryAction',
  // `transientMessage: 'inlineMessage'` was here and is falsified. Both libraries
  // whose bindings name it say the same thing: the answer is not a component. In
  // this design system it is the `useToast()` hook; in Ant it is the message and
  // notification instances on the App context. A toast is not an alert, and the
  // fallback proposed one in both.
  skeleton: 'loading',
}

/**
 * What every refusal a person wrote here has in common.
 *
 * Four roles were left uncovered by hand across four libraries, and all four
 * reasons say the same thing: the answer is not a component. `useToast()` is a hook.
 * Ant's notifications are instances on a context. MUI's page header is a
 * composition of three components. Body copy is plain markup.
 *
 * This pass sees a list of components and nothing else, so a role answered by a
 * hook, a context or a composition is indistinguishable from a role with no answer.
 * It cannot tell them apart, and saying so in the proposal is the only honest move —
 * a reviewer who knows to look for it will spot in a second what this cannot see.
 */
const NOT_A_COMPONENT_NOTE = [
  'One thing this cannot see. Every role a person left uncovered in the four',
  'hand-written bindings here was uncovered for the same reason: the answer is not a',
  'component. A toast comes from a hook, notifications from a context instance, a',
  'page header from composing three components, body copy from plain markup. This',
  'pass reads a list of components, so a role answered by any of those looks exactly',
  'like a role with no answer — and where it proposes something for one of them, it',
  'is proposing a component in place of something that is not one.',
]

/**
 * The same measurement for a kebab selector. `my-global-icon` and `my-alert` share
 * `my`; `.modal-body` and `.card-header` share nothing, and their first segment is
 * the component rather than a stamp on it.
 */
const kebabPrefix = (() => {
  const selectors = Object.values(components)
    .map(c => c.selector && String(c.selector).replace(/^[.#]/, ''))
    .filter(sel => sel && sel.includes('-'))
  if (selectors.length < 4) return undefined
  const tally = new Map()
  for (const sel of selectors) {
    const head = sel.split('-')[0]
    tally.set(head, (tally.get(head) ?? 0) + 1)
  }
  const top = [...tally].sort((a, b) => b[1] - a[1])[0]
  return top && top[1] / selectors.length >= 0.7 ? { prefix: top[0], on: top[1], of: selectors.length } : undefined
})()

/** What a component might be called, from its name and its selector. */
const namesOf = (name, entry) => {
  const out = new Set([flat(name)])
  if (entry.ref) out.add(flat(entry.ref))
  // With the house stamp off, so `DsButton` can answer `primaryAction` the way
  // `Button` does. Both spellings are kept: the stamp is a fact about this library
  // and dropping it entirely would lose a component actually named for it.
  if (housePrefix && name.startsWith(housePrefix.prefix)) out.add(flat(name.slice(housePrefix.prefix.length)))
  // The same stamp in kebab, where a selector carries one: `my-global-icon`. Only a
  // measured prefix is dropped — the first version dropped the first segment of every
  // selector, and `.modal-body` became `body`, which matched the synonym for `text`
  // and made a modal's body the role for body copy.
  if (entry.selector && kebabPrefix) {
    const parts = String(entry.selector).replace(/^[.#]/, '').split('-')
    if (parts.length > 1 && parts[0] === kebabPrefix.prefix) out.add(flat(parts.slice(1).join('')))
  }
  return [...out].filter(Boolean)
}

/**
 * The BEM block a component's selector sits in, which is a weaker thing than a name.
 *
 * `.pagination__gap` is in the `pagination` block, and so are `.pagination__page`
 * and `.pagination__pages`. Treating that block as a name made all three an exact
 * match for the role `pagination`, and the shortest-name tiebreak then picked
 * `PaginationGap` — the gap between page numbers — as the pagination component.
 *
 * A block shared by several components names a family, not a member of it, and
 * choosing one member is a decision nothing in the stylesheet supports.
 */
const blockOf = (entry) => entry.selector
  ? flat(String(entry.selector).replace(/^[.#]/, '').split(/[^a-zA-Z0-9]/)[0])
  : undefined

const sharingBlock = new Map()
for (const [, entry] of Object.entries(components)) {
  const b = blockOf(entry)
  if (b) sharingBlock.set(b, (sharingBlock.get(b) ?? 0) + 1)
}

/** Every value any prop of this component can take, for matching a tone. */
const valuesOf = (entry) => (entry.props ?? []).flatMap(p => p.values ?? []).map(flat)

const proposed = {}
const uncovered = {}

for (const [role, description] of Object.entries(vocabulary.roles)) {
  const roleFlat = flat(role)
  // The role's own word, with `action`/`input` dropped: `primaryAction` is a button
  // whose tone is primary, and matching the whole word finds nothing.
  const bare = roleFlat.replace(/(action|input|state|message|tag)$/, '')
  const synonyms = (SAME_THING[role] ?? []).map(flat)

  const candidates = []
  for (const [name, entry] of Object.entries(components)) {
    const names = namesOf(name, entry)
    // Ranked, because the first version had no ranking and took whichever component
    // came first in the file. On a 323-component profile that gave `tooltip →
    // Popover` while `Tooltip` sat in the same profile, `dialog → ModalOverlay`
    // beside `Modal`, `transientMessage → ToastRegion` beside `Toast`, and
    // `statusTag → AvatarStatus` beside `Tag` and `Badge`. Every one of those
    // compiles, and every one puts the wrong component on the screen.
    const block = blockOf(entry)
    let evidence, score, blockOnly
    if (names.includes(roleFlat)) { evidence = 'name matches the role exactly'; score = 3 }
    else if (block === roleFlat && sharingBlock.get(block) === 1) { evidence = `the only component in the "${block}" block`; score = 3 }
    else if (block === roleFlat) {
      evidence = `in the "${block}" block, which ${sharingBlock.get(block)} components share — this picks one member of a family`
      score = 1
      blockOnly = true
    }
    else if (synonyms.some(s => names.includes(s))) { evidence = `named ${names.find(n => synonyms.includes(n))}, which this tool records as another word for ${role}`; score = 2 }
    else if (bare.length > 3 && names.some(n => n.includes(bare))) { evidence = `name only contains "${bare}" — this is a guess from spelling`; score = 1 }
    if (!evidence) continue

    // A tone in the role name has to be a value the component actually takes.
    const tone = /^(primary|secondary|danger|warning|success|info)/.exec(roleFlat)?.[1]
    const takesTone = tone ? valuesOf(entry).includes(tone) : undefined
    if (tone && takesTone === false) {
      candidates.push({ component: name, evidence, score, blockOnly, weaker: `takes no "${tone}" value; the role's tone would have nowhere to go` })
      continue
    }
    candidates.push({ component: name, evidence, score, blockOnly, ...(tone ? { variant: tone } : {}) })
  }

  // Strongest evidence first; among equals the shortest name, because a compound is
  // a part of a component and the bare word is the component — `Modal` over
  // `ModalOverlay`, `Toast` over `ToastRegion`.
  candidates.sort((a, b) => b.score - a.score
    || (a.weaker ? 1 : 0) - (b.weaker ? 1 : 0)
    || a.component.length - b.component.length)
  const best = candidates[0]

  // Several candidates at the same strength is not a close call this can settle.
  //
  // Measured against four hand-written bindings: where two synonyms tied, the
  // shortest-name tiebreak chose `Input` and a person chose `TextField`, `Tag` and a
  // person chose `Badge`, `Progress` and a person chose `Spin`, `Sheet` and a person
  // chose `DialogContent`. Four for four against. Nothing in the profile separates
  // them, so the proposal names them all and marks the pick as a question — five
  // confident errors become five flagged ones.
  const tied = best && candidates.filter(c => c.score === best.score && !c.weaker).length > 1

  // A synonym won while something in the profile carries the role's own word.
  //
  // memos matched `dialog → Sheet` — a recorded synonym, cleanly stronger than the
  // `DialogContent` sitting beside it — and the person who wrote that binding chose
  // `DialogContent`. Both are dialogs; the library has one thing named for the role
  // and one named by another word for it, and nothing here can say which the spec
  // means. That is a question, not a close call.
  const literal = best && best.score === 2
    ? candidates.filter(c => c !== best && c.score === 1 && c.component.toLowerCase().includes(roleFlat))
    : []
  if (!best) {
    // Before giving up: a role some libraries answer with a more general component.
    const via = FALLS_BACK_TO[role]
    const borrowed = via ? proposed[via] : undefined
    if (borrowed) {
      proposed[role] = {
        component: borrowed.component,
        proposedBecause: `nothing here is named for ${role}; this is what answers ${via}, which is how all four measured libraries answer it`,
        fallbackFrom: via,
        weak: true,
      }
      continue
    }
    uncovered[role] = { notCovered: `nothing in "${PROFILE}" is named for this role or for any word recorded as meaning it${via ? `, and nothing answers ${via} to fall back to` : ''}`, means: description }
    continue
  }
  proposed[role] = {
    component: best.component,
    ...(best.variant ? { variant: best.variant } : {}),
    proposedBecause: best.evidence + (best.weaker ? ` — but ${best.weaker}` : ''),
    // Anything resting on spelling alone is questionable by construction, whatever
    // else is true of it. A reader has to look at those; the exact ones they can skim.
    ...(best.weaker || best.score === 1 || tied || literal.length ? { weak: true } : {}),
    ...(tied ? { tiedWith: candidates.filter(c => c.score === best.score && c !== best && !c.weaker).map(c => c.component) } : {}),
    ...(literal.length ? { alsoNamedForTheRole: literal.map(c => c.component) } : {}),
    ...(candidates.length > 1 ? { alsoConsidered: candidates.filter(c => c !== best).map(c => c.component) } : {}),
  }
}

const strong = Object.entries(proposed).filter(([, v]) => !v.weak)
const weak = Object.entries(proposed).filter(([, v]) => v.weak)
const total = Object.keys(vocabulary.roles).length

console.log(`\nbind: ${PROFILE} — ${Object.keys(components).length} component(s) against ${total} role(s)`)
if (housePrefix) {
  console.log(`  "${housePrefix.prefix}" is on ${housePrefix.on} of ${housePrefix.of} names, so it is read as this library's stamp and matched with and without it.`)
}
console.log('')
for (const [role, v] of strong) {
  console.log(`  ${role.padEnd(18)} → ${String(v.component + (v.variant ? ` (${v.variant})` : '')).padEnd(22)} ${v.proposedBecause}`)
}
if (weak.length) {
  console.log('')
  for (const [role, v] of weak) {
    console.log(`  ${role.padEnd(18)} ~ ${String(v.component).padEnd(22)} ${v.proposedBecause}`)
  }
}
console.log(`\n  ${strong.length} proposed · ${weak.length} proposed but questionable · ${Object.keys(uncovered).length} with no candidate`)
if (Object.keys(uncovered).length) {
  console.log(`\nNo candidate for: ${Object.keys(uncovered).join(', ')}`)
  console.log('Recorded as uncovered rather than filled with the nearest thing. A spec asking')
  console.log('for one of these will refuse to build, which is the correct answer.')
}

if (CHECK) {
  const authored = JSON.parse(readFileSync(existingPath, 'utf8')).roles ?? {}
  const rows = []
  for (const role of Object.keys(vocabulary.roles)) {
    const mine = proposed[role]
    const theirs = authored[role]
    if (!theirs) { rows.push({ role, verdict: 'not in the authored binding' }); continue }
    const theirComponent = theirs.component
    if (!theirComponent && !mine) { rows.push({ role, verdict: 'agreed: uncovered' }); continue }
    if (!theirComponent && mine) {
      rows.push({ role, verdict: 'WRONG: filled where a person left it uncovered', mine: mine.component, weak: mine.weak, why: theirs.notCovered })
      continue
    }
    if (theirComponent && !mine) { rows.push({ role, verdict: 'missed: a person found one', theirs: theirComponent }); continue }
    if (mine.component === theirComponent) { rows.push({ role, verdict: 'agreed', mine: mine.component, weak: mine.weak }); continue }
    rows.push({ role, verdict: 'DIFFERENT component', mine: mine.component, theirs: theirComponent, weak: mine.weak })
  }

  const count = (v) => rows.filter(r => r.verdict.startsWith(v)).length
  console.log(`\n── ${PROFILE}: proposal against the binding somebody wrote ──\n`)
  for (const r of rows) {
    if (r.verdict === 'agreed' || r.verdict === 'agreed: uncovered' || r.verdict === 'not in the authored binding') continue
    console.log(`  ${r.role.padEnd(18)} ${r.verdict}`)
    if (r.mine) console.log(`  ${''.padEnd(18)}   proposed ${r.mine}${r.weak ? ' (marked questionable)' : ''}`)
    if (r.theirs) console.log(`  ${''.padEnd(18)}   authored ${r.theirs}`)
    if (r.why) console.log(`  ${''.padEnd(18)}   they said: ${String(r.why).slice(0, 90)}`)
  }
  const agreed = count('agreed')
  const wrong = rows.filter(r => r.verdict.startsWith('WRONG'))
  const different = rows.filter(r => r.verdict.startsWith('DIFFERENT'))
  const missed = rows.filter(r => r.verdict.startsWith('missed'))
  console.log(`\n  ${agreed} agreed · ${different.length} different · ${missed.length} missed · ${wrong.length} filled where a person refused`)
  // The last number is the one that matters. The others cost a reader a lookup;
  // that one produces a screen that compiles with the wrong component in it.
  console.log(`  of the ${different.length + wrong.length} it got wrong, ${[...different, ...wrong].filter(r => r.weak).length} were marked questionable in the proposal`)
  process.exit(0)
}

if (!OUT) {
  console.log('\nNothing was written. Add --repo <path> or --out <file> to write the proposal.')
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  profile: PROFILE,
  _: [
    'PROPOSED. Not a binding until somebody moves it to bindings/' + PROFILE + '.json.',
    '',
    'A binding is a judgment: that this system\'s ' + (strong[0]?.[1].component ?? 'component') + ' is what a spec means',
    'by ' + (strong[0]?.[0] ?? 'a role') + ' is a decision about the product, not a fact in the stylesheet.',
    'Every entry below says what it rests on, so the ones resting on a spelling',
    'coincidence can be found and thrown out.',
    '',
    ...NOT_A_COMPONENT_NOTE,
    '',
    'Roles with no candidate are under `roles` with `notCovered` and no component.',
    'A spec asking for one of those refuses to build, which is the correct answer —',
    'filling them with the nearest thing produces a screen that compiles and is wrong.',
  ],
  axes: vocabulary.axes,
  roles: { ...proposed, ...uncovered },
}, null, 2) + '\n')
// Both ends of the move, in full. The proposal lands in the CLIENT's repository and
// is adopted into THIS one, and saying `written to .ds/proposals/bindings.json — move
// it to bindings/<id>.json` names two paths as though they were in one place. Anybody
// following it looks for the first in the wrong repository, which is what happened
// the first time this instruction was followed as written.
console.log(`\nwritten to ${OUT} — a PROPOSAL, in the repository being read.`)
console.log(`To adopt: review every "proposedBecause", then move it to`)
console.log(`  ${join(root, 'bindings', `${PROFILE}.json`)}`)
console.log('  — which is in this tool, not in theirs: a binding is part of the profile.')
console.log('To refuse: delete it. Nothing reads it where it is.')
