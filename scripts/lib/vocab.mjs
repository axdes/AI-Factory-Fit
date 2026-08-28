/**
 * Whether a prop name means the same thing everywhere it appears.
 *
 * A shared prop name is a promise. An agent that learns `variant` from Button and
 * writes `variant="destructive"` on Tabs gets a type error, and it learned the
 * wrong thing from a system that told it so. The design system this was modelled
 * on enforces the promise with a hand-written vocabulary file; a client's library
 * has no such file, and the promise can still be checked — because the values are
 * already extracted.
 *
 * The distinction that makes this worth reading is between two kinds of
 * disagreement:
 *
 *   narrowed    one component accepts fewer values than another, and every value
 *               it does accept is in the wider set. `sm|default` beside
 *               `sm|default|lg` is a smaller version of the same question, and it
 *               is usually fine.
 *   collided    two components share the name and no values at all. `variant` as
 *               `default|destructive` on Button and `segmented|underline` on Tabs
 *               is two different questions wearing one name, and that is the case
 *               that teaches an agent wrong.
 *
 * Reporting both as "inconsistent" would put the loud case and the quiet one in
 * one list, and a team would triage the wrong one first.
 */

/**
 * Groups every closed-union prop by name across a profile's components.
 *
 * `declared` is the project's own vocabulary file where it has one. That changes
 * the question entirely, and getting this wrong was the first version's mistake:
 * run against a system that DOES declare its vocabulary, it reported seven
 * collisions, and six were components taking sensible subsets of one declared
 * axis — `placement` is declared as `center|drawer|top|bottom|start|end`, Tooltip
 * takes the four that make sense for a tooltip and Modal takes the two that make
 * sense for a modal. Two non-overlapping subsets of one axis is not two questions.
 *
 * With a declaration the check becomes: is every value inside the axis, and is
 * every shared prop declared at all. Without one it falls back to comparing what
 * the components do, and says so — because a disagreement there may still be a
 * legitimate subset of an axis nobody wrote down.
 */
export function propVocabulary(components, declared) {
  const byName = new Map()
  for (const [component, entry] of Object.entries(components ?? {})) {
    for (const prop of entry.props ?? []) {
      if (!Array.isArray(prop.values) || !prop.values.length) continue
      const set = [...new Set(prop.values)].sort()
      const uses = byName.get(prop.name) ?? []
      uses.push({ component, values: set })
      byName.set(prop.name, uses)
    }
  }

  const findings = []
  for (const [name, uses] of byName) {
    if (uses.length < 2) continue

    // A declared axis answers the question outright.
    const axis = declared?.[name]
    if (axis) {
      /* Compared as text, because a union value can be a number and a JSON key
       * never is: `columns: 1 | 2 | 3` could not match a declared "1" no matter
       * what anyone wrote, so a numeric axis was undeclarable and stayed red
       * forever. The sibling check in lint-vocab.mjs already reads them this way. */
      const allowed = new Set(Object.keys(axis.values ?? {}).map(String))
      const outside = uses
        .map(u => ({ ...u, bad: u.values.filter(v => !allowed.has(String(v))) }))
        .filter(u => u.bad.length)
      if (outside.length) {
        findings.push({
          prop: name, onComponents: uses.length, declaredAxis: axis.axis,
          outsideTheAxis: outside.map(u => ({ component: u.component, values: u.bad })),
          widest: { values: [...allowed], components: [] }, narrowed: [], collided: [],
        })
      }
      continue
    }
    const distinct = [...new Map(uses.map(u => [u.values.join('|'), u])).values()]
    if (distinct.length < 2) continue

    // The widest set is the reference: if every other is contained in it, the
    // vocabulary is one question asked at different widths.
    const widest = distinct.reduce((a, b) => (b.values.length > a.values.length ? b : a))
    const narrowed = []
    const collided = []
    for (const other of distinct) {
      if (other === widest) continue
      const shared = other.values.filter(v => widest.values.includes(v))
      if (shared.length === other.values.length) narrowed.push(other)
      else collided.push({ ...other, shared })
    }

    findings.push({
      prop: name,
      onComponents: uses.length,
      undeclared: Boolean(declared),
      widest: { values: widest.values, components: uses.filter(u => u.values.join('|') === widest.values.join('|')).map(u => u.component) },
      narrowed: narrowed.map(n => ({
        values: n.values,
        components: uses.filter(u => u.values.join('|') === n.values.join('|')).map(u => u.component),
      })),
      collided: collided.map(c => ({
        values: c.values,
        shared: c.shared,
        components: uses.filter(u => u.values.join('|') === c.values.join('|')).map(u => u.component),
      })),
    })
  }
  return findings.sort((a, b) => b.collided.length - a.collided.length || b.onComponents - a.onComponents)
}

/** The one-line verdict per finding, for a report. */
export function describeVocabulary(finding) {
  const { prop, widest, collided, narrowed, declaredAxis, outsideTheAxis, undeclared } = finding
  if (outsideTheAxis) {
    return `${prop} is declared as "${declaredAxis}" and ${outsideTheAxis
      .map(o => `${o.component} takes ${o.values.join(', ')}`).join('; ')} — outside it`
  }
  if (undeclared) {
    return `${prop} is shared by ${finding.onComponents} components and the vocabulary does not declare it; `
      + `${widest.components[0]} takes ${widest.values.join('|')}`
  }
  if (collided.length) {
    const worst = collided[0]
    return `${prop} answers two different questions: ${widest.components.slice(0, 2).join(', ')} take `
      + `${widest.values.join('|')}, ${worst.components.slice(0, 2).join(', ')} take ${worst.values.join('|')}`
      + `${worst.shared.length ? ` — only ${worst.shared.join(', ')} in common` : ' — nothing in common'}`
  }
  return `${prop} is one question at ${narrowed.length + 1} widths; every narrower set is inside `
    + `${widest.values.join('|')}, which is a narrowing rather than a disagreement`
}
