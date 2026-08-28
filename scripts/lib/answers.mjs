/**
 * What an agent actually receives — the two answers, rendered once.
 *
 * `list_components` serves an index row per component and `get_component` serves a
 * detail block, and both were written twice: the server rendered them and the
 * context budget rendered them again to price them. The budget's own comment says
 * a copy on disk "would be one more thing to keep in step" and then kept a copy in
 * code, byte for byte, in another file.
 *
 * They had already drifted where it mattered most. The budget priced a fetch as
 * `JSON.stringify(entry)` while the server answers with this text: 1891 tokens
 * against 443 for Table, 26 entries over the per-entry ceiling against none. The
 * ceiling the budget calls "the number that actually matters per fetch" was being
 * tripped by punctuation and key names that no agent ever sees.
 *
 * So there is one definition, the server serves it, and the budget prices it.
 */

/**
 * The index row: name, level, and ONE line about the component.
 *
 * One line is what the index promises, in its name and in the tool description
 * agents read. The descriptions in a profile are paragraphs — 96 tokens each on
 * `own`, and the longest is 312 — so rendering them whole made discovery cost
 * 13.4k tokens on every task to say 131 things. The first sentence is the row; the
 * rest is a `get_component` away and costs nothing until somebody asks.
 */
export const indexRow = (name, c) => {
  const level = c.level ? ` · ${c.level}` : ''
  const context = c.context ? `/${c.context}` : ''
  return `${name}${level}${context} · ${firstSentence(c.description) ?? 'no description'}`
}

/**
 * The first sentence, or the whole thing when it does not end in one.
 *
 * Deliberately conservative about what ends a sentence: a description opening with
 * "Wraps `Button.Group`, i.e. the row of them" must not be cut at the abbreviation,
 * and one with no full stop at all is a single line already. A cut is only taken
 * where a terminator is followed by whitespace and the result still says something.
 */
export const firstSentence = (text) => {
  if (!text) return undefined
  const match = /^(.+?[.!?])(\s|$)/s.exec(text.trim())
  if (!match) return text.trim()
  const head = match[1].trim()
  // An abbreviation is not the end of a sentence, and neither is a lone word.
  if (head.length < 20 || /\b(e\.g|i\.e|etc|vs|cf|no)\.$/i.test(head)) return text.trim()
  return head
}

/**
 * The `get_component` answer: what the component is, how to import it, its props,
 * what this repository has been observed to write, and an example.
 *
 * `observed` is optional and only rendered where a measurement exists — inventing
 * the section from an empty scan would put "no observed values" in front of an
 * agent as though that meant something.
 */
export const componentDetail = (name, indexed, observed = {}) => {
  const c = indexed[name]
  if (!c) return undefined
  const lines = [`${c.ref ?? name}${c.isPart ? ` — a part of ${c.partOf}` : ''}`]
  if (c.description) lines.push(c.description)
  if (c.from) lines.push(`import { ${name} } from '${c.from}'`)
  if (c.isPart) {
    lines.push(`Props are declared on ${c.partOf}; this profile does not publish them per part.`)
    return lines.join('\n')
  }
  if (c.props?.length) {
    lines.push('', 'Props:')
    for (const p of c.props) {
      const values = p.values ? `  one of: ${p.values.join(' | ')}` : ''
      lines.push(`  ${p.name}${p.required ? '' : '?'}: ${p.type}${values}`)
    }
  }
  // What this repository writes, kept separate from what the component accepts.
  // An agent that cannot tell them apart treats an unused-but-legal value as
  // forbidden, or a local habit as a rule the compiler will enforce.
  const seen = observed[name]
  if (seen && Object.keys(seen).length) {
    lines.push('', 'Observed in this repository (a habit to follow, not a constraint):')
    for (const [prop, a] of Object.entries(seen)) {
      lines.push(`  ${prop} = ${Object.entries(a.observed).map(([v, n]) => `${v} ×${n}`).join('  ')}   — ${a.from}`)
    }
    lines.push('  A value missing here is not forbidden; it is one nobody has needed yet.')
  }
  if (c.example) lines.push('', 'Example:', c.example)
  return lines.join('\n')
}
