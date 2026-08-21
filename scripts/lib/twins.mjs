/**
 * Components in one library that resemble each other closely enough to be asked
 * about.
 *
 * The contract everywhere says: search the registry before building. Nothing
 * holds the LIBRARY to it, so the seventy-fourth component can repeat the
 * thirtieth and every check stays green — the one place a duplicate is most
 * expensive, because every product that adopts the library inherits it.
 *
 * Two signals, and both have to be high. This is the part that has to be got
 * right, and the reference implementation records why: prop-name overlap alone is
 * noise, because two components with three props each agree by accident — on a
 * first pass Radio and Spinner scored a perfect 1.0 on two coincident names. What
 * a component RENDERS is an independent signal, and a pair that agrees on both is
 * a pair worth a person's minute.
 *
 * A flagged pair is a question, never a verdict. `twins.json` is where somebody
 * answers it — a claim that the two are genuinely different, plus the condition
 * under which the claim expires, so the next person can check it rather than
 * inherit it. An entry whose pair has stopped resembling is itself reported: an
 * excuse nobody needs any more would silently waive a real duplicate later.
 */

/** Props every component has, which say nothing about what it is. */
const UNIVERSAL = new Set([
  'className', 'class', 'style', 'id', 'children', 'ref', 'key', 'as', 'asChild',
  'data-testid', 'aria-label', 'role', 'tabIndex', 'onClick', 'disabled',
])

/** Below this, a prop set is too small for its overlap to mean anything. */
const MIN_PROPS = 3
/** Below this, a rendered set is too small for its overlap to mean anything. */
const MIN_RENDERS = 2

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const x of a) if (b.has(x)) shared += 1
  return shared / (a.size + b.size - shared)
}

export function findTwins(components, { declared, propThreshold = 0.6, renderThreshold = 0.5 } = {}) {
  const entries = Object.entries(components ?? {}).map(([name, c]) => ({
    name,
    props: new Set((c.props ?? []).map(p => p.name).filter(p => !UNIVERSAL.has(p))),
    renders: new Set(c.renders ?? []),
  }))

  const pairs = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]
      const b = entries[j]
      if (a.props.size < MIN_PROPS || b.props.size < MIN_PROPS) continue
      if (a.renders.size < MIN_RENDERS || b.renders.size < MIN_RENDERS) continue
      // One renders the other. That is composition, not duplication, and it is a
      // fact rather than a threshold: ProgressBar renders Meter and shares four of
      // its props by inheriting them, which is exactly what a wrapper looks like to
      // a similarity score. Asking whether a component duplicates the thing it is
      // built out of wastes the minute the question is meant to earn.
      if (a.renders.has(b.name) || b.renders.has(a.name)) continue

      const byProps = jaccard(a.props, b.props)
      const byRenders = jaccard(a.renders, b.renders)
      if (byProps < propThreshold || byRenders < renderThreshold) continue

      const key = `${a.name} ~ ${b.name}`
      pairs.push({
        pair: key,
        byProps: Number(byProps.toFixed(2)),
        byRenders: Number(byRenders.toFixed(2)),
        answered: Boolean(declared?.pairs?.[key]),
        separated: declared?.pairs?.[key]?.separated,
        reopenIf: declared?.pairs?.[key]?.reopenIf,
      })
    }
  }

  // An answer for a pair that no longer resembles is an excuse nobody needs, and
  // leaving it in place would silently waive a real duplicate later.
  //
  // But "no longer resembles" and "could not be compared" are different, and
  // conflating them told a team its answer for Meter ~ ProgressBar was stale when
  // the truth was that the profile carried no rendered-markup field to compare —
  // advice to delete a correct answer, which is worse than not asking.
  const comparable = new Set(entries
    .filter(e => e.props.size >= MIN_PROPS && e.renders.size >= MIN_RENDERS)
    .map(e => e.name))
  const flagged = new Set(pairs.map(p => p.pair))
  const byName = new Map(entries.map(e => [e.name, e]))
  const stale = []
  const uncheckable = []
  const composed = []
  for (const key of Object.keys(declared?.pairs ?? {})) {
    if (flagged.has(key)) continue
    const both = key.split('~').map(s => s.trim())
    const [x, y] = both.map(n => byName.get(n))
    // Three reasons an answered pair stops being flagged, and only one of them means
    // the answer can go. This pair — Meter ~ ProgressBar — has been misread twice:
    // once when the profile carried no rendered-markup field at all and the answer
    // was called stale, and again once it did, because a wrapper shares its wrapped
    // component's props and falls under the prop bar.
    if (x && y && (x.renders.has(y.name) || y.renders.has(x.name))) {
      composed.push({ pair: key, why: 'one of these renders the other, so they were never twins; the answer is about a real distinction and stays' })
    } else if (both.every(n => comparable.has(n))) stale.push(key)
    else uncheckable.push({ pair: key, why: 'not enough of either component could be read to compare them' })
  }

  // Whether this could run at all, which is not the same as finding nothing.
  //
  // Both signals have to be present, and the second one — what a component renders —
  // is absent from every profile in this repository: `probe-own` never wrote the
  // field, so all 82 components of the design system carry none, and the pass
  // returned an empty list that reads as "no duplicates here". The one place a
  // duplicate is most expensive is the library itself, and the check meant to catch
  // it had been silently answering "clean" on no evidence.
  // The reason was already recorded below, per component, and it is the right
  // sentence. What was missing is the one bit a caller needs to decide between
  // printing a number and printing NOT RUN: whether anything was compared at all.
  // Without it, `unanswered: []` reaches a report as "no duplicates" — and on every
  // profile in this repository that is what happened, because `probe-own` never
  // wrote the rendered-elements field and all 82 components of the design system
  // carry none.
  const ran = comparable.size >= 2

  return {
    ran,
    unanswered: pairs.filter(p => !p.answered).sort((a, b) => (b.byProps + b.byRenders) - (a.byProps + a.byRenders)),
    answered: pairs.filter(p => p.answered),
    stale,
    uncheckable,
    // Answered pairs that are not questions because one is built out of the other.
    // Not stale: the answer records a real distinction and deleting it would lose it.
    composed,
    considered: comparable.size,
    // Silence has two causes and only one of them is good news. In a library
    // whose components type their props through a primitive — most of the
    // shadcn-derived ones — the prop signal is simply unavailable, and reporting
    // "no twins" without saying that reads as a clean bill.
    notComparable: entries.length - comparable.size,
    why: entries.length - comparable.size
      ? `${entries.length - comparable.size} component(s) could not be compared: fewer than ${MIN_PROPS} props of `
        + `their own to read, or fewer than ${MIN_RENDERS} elements rendered. Where props are typed through a `
        + 'primitive this pass cannot follow, that half of the signal is missing and no pair can be judged on '
        + 'the other half alone — which is the whole reason two signals are required.'
      : undefined,
  }
}
