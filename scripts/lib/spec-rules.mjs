/**
 * The decision layer's engine: which representation fits which task and data
 * shape, computed — never interpreted — from roles/selection-rules.json.
 *
 * A zone in a harness spec names its content in roles ("table", "list",
 * "card ...") the same way validate-spec reads them. When a zone also DECLARES its
 * facts — the task the user is doing and the shape of the data (item, cardinality,
 * fields, editable) — this engine computes the ALLOWED set of representations from
 * rules R1–R10, detects which representation the zone actually chose (seeing
 * through a card wrapper over a table via precedence), and reports a problem when
 * the choice is not allowed, citing the rule id and its `because`.
 *
 * The division of labour is the point: the spec author names the task and the
 * data, which is the judgment a reviewer approves; this module decides what that
 * judgment permits, which is a computation. Ported from css's spec-rules.mjs and
 * narrowed to harness's role vocabulary — see the $comment in selection-rules.json
 * for what css rules were reduced because harness has no grid or stats role.
 *
 * Adapted for harness's spec shape: a zone reads its representation from
 * `zone.elements` (role strings), not css's `zone.components`.
 */

export const TASKS = ['find', 'compare', 'scan', 'browse', 'monitor', 'analyze', 'process', 'navigate']
export const ITEM_KINDS = ['record', 'prose', 'visual', 'metric']
export const CARDINALITIES = ['one', 'few', 'many', 'unbounded']

/** The role a `"table stickyHeader"` element string names is its first word. */
export function roleOf(element) {
  return String(element).trim().split(/\s+/)[0]
}

function ruleMatches(when, task, data) {
  if (when.task && !when.task.includes(task)) return false
  if (when.item && data.item !== when.item) return false
  if (when.editable !== undefined && Boolean(data.editable) !== when.editable) return false
  if (when.cardinality && data.cardinality !== when.cardinality) return false
  if (when.minFields !== undefined && !(typeof data.fields === 'number' && data.fields >= when.minFields)) return false
  if (when.maxFields !== undefined && !(typeof data.fields === 'number' && data.fields <= when.maxFields)) return false
  return true
}

export function makeRuleEngine(rulesDoc) {
  const repOf = new Map()
  for (const [rep, def] of Object.entries(rulesDoc.representations)) {
    for (const role of def.roles) repOf.set(role, rep)
  }
  const collectionTasks = new Set(rulesDoc.collectionTasks)

  /* The strongest representation a zone's elements signal. Precedence matters: a
   * zone that names both a card and a table names the card as the surface the
   * table sits on, while the table is what the user actually reads — so it detects
   * as a table. */
  function detect(zone) {
    const present = new Set(
      (zone.elements ?? []).map((el) => repOf.get(roleOf(el))).filter(Boolean),
    )
    return rulesDoc.precedence.find((rep) => present.has(rep)) ?? null
  }

  /* One zone against the rules. Returns problems (gate-red), notes (printed, never
   * red) and whether the zone shows a collection whose facts were not declared. */
  function checkZone(zone) {
    const problems = []
    const notes = []
    let undeclared = false
    const at = (msg) => `zone "${zone.name}": ${msg}`

    if (zone.task && !TASKS.includes(zone.task)) {
      problems.push(at(`task "${zone.task}" — use ${TASKS.join(' | ')}`))
      return { problems, notes, undeclared }
    }
    const d = zone.data
    if (d) {
      if (d.item && !ITEM_KINDS.includes(d.item)) problems.push(at(`data.item "${d.item}" — use ${ITEM_KINDS.join(' | ')}`))
      if (d.cardinality && !CARDINALITIES.includes(d.cardinality)) problems.push(at(`data.cardinality "${d.cardinality}" — use ${CARDINALITIES.join(' | ')}`))
      if (d.fields !== undefined && (!Number.isInteger(d.fields) || d.fields < 0)) problems.push(at('data.fields must be a whole number'))
    }
    if (problems.length) return { problems, notes, undeclared }

    const rep = detect(zone)
    if (zone.task && collectionTasks.has(zone.task) && rep) {
      if (!d?.item || !d?.cardinality) {
        problems.push(at(`a ${zone.task} zone showing a collection must say what the data looks like (data.item, data.cardinality) — the rules cannot fire on adjectives`))
        return { problems, notes, undeclared }
      }
      for (const h of rulesDoc.hard ?? []) {
        if (ruleMatches(h.when, zone.task, d) && h.forbid.includes(rep)) {
          problems.push(at(`"${rep}" is ruled out here — ${h.because} Use ${h.instead}.`))
        }
      }
      const matched = (rulesDoc.rules ?? []).filter((r) => ruleMatches(r.when, zone.task, d))
      const allowed = new Set(matched.flatMap((r) => r.choose))
      if (matched.length && !allowed.has(rep)) {
        const cite = matched[0]
        problems.push(
          at(`task=${zone.task} over ${d.item} data — "${rep}" is not what any matching rule chooses (${matched.map((r) => r.id).join(', ')} choose ${[...allowed].join(' | ')}). ${cite.id}: ${cite.because}`),
        )
      }
      if (!matched.length) {
        notes.push(at(`no selection rule matches task=${zone.task} + this data shape — either the declaration is off, or selection-rules.json is missing a rule and should gain one`))
      }
      for (const n of rulesDoc.notes ?? []) {
        if (ruleMatches(n.when, zone.task, d) && n.if === rep) notes.push(at(n.say))
      }
    } else if (!zone.task && rep) {
      /* A zone that shows a collection but declares no task is invisible to the
       * rules. Not a failure — most harness specs predate the decision layer — but
       * worth surfacing so the facts can be added when someone touches it. */
      undeclared = true
    }
    return { problems, notes, undeclared }
  }

  /* The verdict as data, for whoever asks BEFORE writing: the allowed set, the
   * forbidden set with reasons, and the roles each allowed representation maps to. */
  function decide(task, data) {
    const matched = (rulesDoc.rules ?? []).filter((r) => ruleMatches(r.when, task, data ?? {}))
    const allowed = [...new Set(matched.flatMap((r) => r.choose))]
    const forbidden = (rulesDoc.hard ?? [])
      .filter((h) => ruleMatches(h.when, task, data ?? {}))
      .map((h) => ({ id: h.id, forbid: h.forbid, instead: h.instead, because: h.because }))
    const roles = Object.fromEntries(
      allowed.map((rep) => [rep, rulesDoc.representations[rep]?.roles ?? []]),
    )
    return { matched, allowed, forbidden, roles }
  }

  return { detect, checkZone, decide, representationRoles: [...repOf.keys()], collectionTasks }
}
