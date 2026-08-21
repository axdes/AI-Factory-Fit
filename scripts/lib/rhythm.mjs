/**
 * The spacing this project actually writes, and whether the tokens exist at all.
 *
 * Every emitter here hardcoded `var(--space-4)` for a root gap, `var(--space-2)`
 * between zone items, `var(--space-6)` for page padding and `var(--colour-text-muted)`
 * for muted text. Measured against one real design system:
 *
 *   gap      --space-2 ×72 · --space-3 ×37 · --space-1 ×31 · --space-4 ×27
 *   padding  --space-2 ×17 · --space-4 ×16 · --space-3 ×13 · --space-6 ×7
 *
 * So the generated file used the project's fourth-favourite gap and its least
 * favourite padding. Both exist there, so nothing broke — it simply did not read
 * like the files beside it.
 *
 * The worse case is the one that has not happened yet: a project whose scale is
 * named `--spacing-md` or `--sp-2` gets a stylesheet referring to custom properties
 * it does not declare. That is not a file that looks foreign, it is a file that is
 * broken, and CSS fails silently — the rule is dropped and the page just looks wrong.
 *
 * So both are answered from the same reading: which token is used most for each
 * purpose, and whether it is declared anywhere.
 */

const declaredIn = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))

const majorityOf = (css, property) => {
  const counts = new Map()
  const re = new RegExp(`\\b${property}\\s*:[^;{}]*?var\\((--[\\w-]+)`, 'g')
  for (const m of css.matchAll(re)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  return ranked.length ? { token: ranked[0][0], count: ranked[0][1], of: [...counts.values()].reduce((a, b) => a + b, 0) } : undefined
}

/**
 * @param css every stylesheet this project owns, concatenated
 * @returns what to write for each purpose, and what could not be answered
 */
export function rhythm(css) {
  const declared = declaredIn(css)
  const gap = majorityOf(css, 'gap')
  const padding = majorityOf(css, 'padding')

  // A muted foreground is a judgement about a palette, not a measurement of one, so
  // it is taken only when the project already names one. Guessing a colour token is
  // how a generated file ends up referring to something that does not exist.
  // Named differently in every system, and a list of guesses is still guessing. The
  // one this tool's own first-party system uses is `--muted-foreground`, which was
  // not on the first list — so every stylesheet generated into it carried a
  // reference to `--colour-text-muted`, a property that is not declared there. CSS
  // drops an unresolvable custom property silently: the rule vanishes and the text
  // renders in whatever it inherits.
  const muted = ['--colour-text-muted', '--color-text-muted', '--text-muted', '--muted-foreground',
    '--colour-muted', '--color-muted', '--fg-muted', '--text-secondary', '--secondary-foreground']
    .find(t => declared.has(t))

  const unresolved = []
  if (!gap) unresolved.push('gap: no rule here sets one from a token')
  if (!padding) unresolved.push('padding: no rule here sets one from a token')
  if (!muted) unresolved.push('muted foreground: this project declares no token named for one')

  return {
    gap: gap?.token,
    gapShare: gap ? gap.count / gap.of : 0,
    padding: padding?.token,
    paddingShare: padding ? padding.count / padding.of : 0,
    muted,
    declared,
    unresolved,
    /** A value only where the token behind it exists. */
    has: (token) => declared.has(token),
  }
}
