/**
 * One reader for a token layer, whichever pass wrote it.
 *
 * Two produce them and they disagree in shape. `ds style:image` writes a flat map —
 * `colour-1`, `space-1` — because a screenshot yields a short list. `ds style --out`
 * writes DTCG groups — `palette.10`, `spacing.10`, `font.family.default` — because a
 * live site yields sixty-seven values across seven kinds, and a flat list of that is
 * unreadable.
 *
 * Both are right for what they hold. What was wrong is that nothing read the second:
 * `ds name:tokens` expects the flat shape and returned "no colours" on a layer with
 * eleven, and the generator reads neither. So a client's whole visual language —
 * their palette, their type scale, their spacing, their radii, and thirteen colours
 * the site names itself — was extracted, written to disk, and never reached a line of
 * generated code.
 *
 * This flattens either into the same list, keeping the one thing that matters most:
 * whether a name came from the client or from a counter.
 */

/** A leaf is anything carrying a `$value`. */
const isLeaf = (v) => v && typeof v === 'object' && '$value' in v

/**
 * @param layer the parsed tokens.json
 * @returns [{ path, name, value, type, named, uses, source }]
 *          `named` is true where the client named it, not this tool.
 */
export function readTokenLayer(layer) {
  const out = []
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (key.startsWith('$')) continue
      const at = [...path, key]
      if (isLeaf(value)) {
        const meta = value.$extensions?.['org.ds-profile'] ?? {}
        out.push({
          path: at.join('.'),
          // The CSS custom property this becomes. A group path is joined with a
          // hyphen, which is how everybody writes them — except `named`, which is a
          // container for the names the client already chose. Joining it in produced
          // `--named-docsearch-primary-color` for a property the client calls
          // `docsearch-primary-color`, which is the one name in the file that must
          // survive untouched.
          name: (at[0] === 'named' ? at.slice(1) : at).join('-'),
          value: Array.isArray(value.$value) ? value.$value.join(', ') : String(value.$value),
          type: value.$type,
          // The client's own name for it, or a number this tool assigned. A name the
          // client wrote is the judgment tier handed over for free, and it must not be
          // mixed with a rank.
          named: at[0] === 'named' || meta.named === true || Boolean(meta.source?.includes('custom property')),
          uses: meta.uses,
          source: meta.readFrom ?? meta.source,
        })
      } else if (value && typeof value === 'object') {
        walk(value, at)
      }
    }
  }
  walk(layer, [])
  return out
}

/** The subset of one kind, in the order the layer put them. */
export const ofType = (tokens, type) => tokens.filter(t => t.type === type)

/**
 * A `:root` block a project can adopt, from a layer it does not have yet.
 *
 * Written rather than referenced, because a `var(--x)` naming a custom property the
 * project does not declare is dropped silently by the browser — the generated screen
 * then has no colour and no error. Where the tokens travel with the proposal, taking
 * the proposal takes what it needs.
 */
export function rootBlock(tokens, { from, limit = 60 } = {}) {
  const kept = tokens.slice(0, limit)
  if (!kept.length) return undefined
  const named = kept.filter(t => t.named)
  return [
    '/* Tokens for the screen proposed beside this file — PROPOSED, not yours yet.',
    ' *',
    from ? ` * Read from ${from}.` : ' * Read from what this client already ships.',
    named.length
      ? ` * ${named.length} of ${kept.length} carry the name the client gave them; the rest are ranked by use`
      : ' * None of these are named by the client, so the numbers are this tool\'s ranking',
    ' * and named by nothing — a rank is not a claim about intent.',
    ' *',
    ' * To adopt: move this into your stylesheet. To refuse: delete it, and the screen',
    ' * beside it falls back to whatever your project already declares.',
    ' */',
    ':root {',
    ...kept.map(t => `  --${t.name}: ${t.value};${t.uses ? `  /* ${t.uses} use(s) */` : ''}`),
    '}',
    '',
  ].join('\n')
}
