/**
 * Which props a component is actually passed, and with which values.
 *
 * The profile already knows what a component's types *declare*. That is a different
 * question from what the codebase *does*, and the gap between them is where the
 * useful answers live: a union of eight values where three are ever used says which
 * three matter; a prop declared and never passed is dead surface; and a registry
 * with no types at all — anything `adapt:css` or `adapt:sfc` produced — has no
 * declared vocabulary to read, so usage is the only evidence there is.
 *
 * The honesty line runs straight through the middle of this file and is worth
 * stating before any of the code. What is measured here is what was *observed*. It
 * is never what is *allowed*: an enumeration built from call sites is a sample, and
 * a value nobody happened to write this quarter is not thereby illegal. So every
 * field is named for observation, and the one place that could be read as a rule —
 * whether a prop looks like a closed set of choices — refuses far more readily than
 * it accepts.
 */

/** Attributes that say nothing about a component's own vocabulary. */
const FRAMEWORK = /^(key|ref|className|class|style|id|slot|children|v-\w+|\*ng\w+|ng\w*|let-\w+|on[A-Z]\w*|@\w+|#\w+)$/
// An Angular event binding is a handler, and a handler has no vocabulary — its value
// is a statement in the consumer's component. Written `(click)`, `(change)`, and
// never `(prop)` for anything a spec could ask for by name.
const EVENT_BINDING = /^\(/

/**
 * `:prop`, `[prop]`, `[(prop)]`, `v-bind:prop` and `bind:prop` all name one prop.
 *
 * Angular writes three bindings that look nothing like a plain attribute:
 * `[prop]="x"`, `(event)="x()"` and the two-way `[(prop)]="x"`. Reading only the
 * square-bracket form left the parentheses unmatched, and the scanner then read the
 * binding's own value as if it were more attributes: `[(ngModel)]="demoChecked"` on
 * Angular Material produced two props, `ngModel` and `demoChecked` — the second one
 * a variable in the consumer's component, which had no business being recorded at
 * all, let alone written into a contract as part of a component's vocabulary.
 */
const NAME = /^(?:v-bind:|bind:|:|\[\(|\[|\()?([\w.-]+?)(?:\)\]|\]|\))?$/
/** The same prefixes, asked as a question: is this value an expression? */
const BOUND = /^(?:v-bind:|bind:|:|\[|\()/

/**
 * Every attribute in an opening tag, with its value and how the value was written.
 *
 * Splitting on whitespace does not survive contact with real markup: a value can
 * contain spaces, quotes, braces, a nested tag, or an arrow function whose body has
 * all four. So each value is walked to its own end before the next name is looked
 * for. Reading a nested attribute as a sibling was an actual defect here, in the
 * screen-shape reader, and it is the same scan.
 *
 * @param attrs the text between the tag name and its closing `>`
 * @returns [{ name, value, kind }] — kind is 'string' | 'expression' | 'boolean'
 */
export function attrPairs(attrs) {
  const out = []
  // Angular's `[(x)]`, `[x]` and `(x)` are one token each. Matching only the opening
  // bracket left `(` unconsumed, and everything after it was read as fresh
  // attributes — including the binding's own value.
  const NAME = /^(?:\[\(\s*[\w.-]+\s*\)\]|\(\s*[\w.-]+\s*\)|\[\s*[\w.-]+\s*\]|(?:v-bind:|bind:|@|#|:|\*)?[\w.-]+)/
  let i = 0
  while (i < attrs.length) {
    while (i < attrs.length && /[\s/]/.test(attrs[i])) i += 1
    if (i >= attrs.length) break

    // A brace where a NAME belongs is a spread — `{...props}`, `{...{ accent, size }}`.
    // Scanning through it read the object's shorthand keys as bare attributes and
    // recorded them as the literal `true`: on twenty, `Button.accent` came out as
    // `blue ×58 · danger ×27 · default ×21 · true ×1`, with the last one invented.
    // The prop really is passed there, but never as a literal — a spread carries
    // expressions — so nothing here can be learned from it and it is stepped over.
    if (attrs[i] === '{') { i = skipBraced(attrs, i); continue }

    const m = NAME.exec(attrs.slice(i))
    if (!m) { i += 1; continue }
    const name = m[0]
    let j = i + name.length
    while (j < attrs.length && /\s/.test(attrs[j])) j += 1

    // No `=`: a bare attribute, which in JSX and Vue alike means `true`.
    if (attrs[j] !== '=') { out.push({ name, value: true, kind: 'boolean' }); i = i + name.length; continue }

    j += 1
    while (j < attrs.length && /\s/.test(attrs[j])) j += 1
    const opener = attrs[j]
    let value, kind
    if (opener === '{') {
      const stop = skipBraced(attrs, j)
      const inner = attrs.slice(j + 1, stop - 1).trim()
      // `variant={'ghost'}` is a literal wearing braces. Unwrapping it keeps one
      // value from being counted as two different things.
      const quoted = /^(['"])(.*)\1$/s.exec(inner)
      if (quoted) { value = quoted[2]; kind = 'string' }
      else { value = inner; kind = 'expression' }
      j = stop
    } else if (opener === '"' || opener === "'") {
      const close = attrs.indexOf(opener, j + 1)
      const raw = attrs.slice(j + 1, close === -1 ? attrs.length : close)
      j = close === -1 ? attrs.length : close + 1
      // A bound attribute holds an expression, quotes or no quotes. `:variant="x"`
      // in Vue and `[variant]="x"` in Angular mean the same thing as `variant={x}`
      // in JSX, and reading them as the string "x" would have recorded a variable
      // name as a value this codebase writes. Both frameworks' bindings look exactly
      // like plain attributes apart from the prefix, which is why this is easy to
      // get wrong and invisible once wrong.
      if (BOUND.test(name)) {
        const q = /^(['"])(.*)\1$/s.exec(raw.trim())
        if (q) { value = q[2]; kind = 'string' }
        else { value = raw; kind = 'expression' }
      } else {
        value = raw
        kind = 'string'
      }
    } else {
      // An unquoted value, which Angular and HTML both allow.
      const from = j
      while (j < attrs.length && !/\s/.test(attrs[j])) j += 1
      value = attrs.slice(from, j)
      kind = 'string'
    }
    out.push({ name, value, kind })
    i = j
  }
  return out
}

/** The index just past a brace-balanced group, quotes and nesting respected. */
function skipBraced(text, at) {
  let depth = 0, quote
  for (let i = at; i < text.length; i += 1) {
    const c = text[i]
    if (quote) { if (c === quote && text[i - 1] !== '\\') quote = undefined; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (!depth) return i + 1 }
  }
  return text.length
}

/**
 * Where a component's opening tag ends, brace- and quote-aware.
 *
 * `>` inside `onClick={() => a > b}` does not close the tag, and a scan that thinks
 * it does truncates every attribute after it.
 */
export function tagAt(src, from) {
  let depth = 0, quote
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = undefined; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') { depth += 1; continue }
    if (c === '}') { depth -= 1; continue }
    if (c === '>' && depth <= 0) return { attrs: src.slice(from, i).replace(/\/$/, ''), end: i + 1 }
  }
  return undefined
}

/**
 * Count how the given components are called across the given sources.
 *
 * A component is not always written under the name the registry files it by. In
 * Angular the registry holds a class and the template holds a selector, so looking
 * for `NgxHeader` in `<ngx-header>` finds nothing and reports, in good faith, that
 * the whole registry is unused. Any spelling may therefore be mapped back to the
 * one name the results are filed under.
 *
 * @param sources [{ at, text }]
 * @param names   registry names, or a Map from written tag to registry name
 */
export function propUsage(sources, names) {
  const wanted = names instanceof Map ? names : new Map([...names].map(n => [n, n]))
  const components = {}
  let callSites = 0

  for (const { text } of sources) {
    // One pass per source, finding any capitalised or hyphenated tag and keeping
    // only the ones the registry knows. Scanning per-name would re-read the file
    // once per registry component, which on a 300-component profile is 300 passes.
    const tag = /<([A-Z][\w.]*|[a-z][\w-]*-[\w-]+)/g
    let m
    while ((m = tag.exec(text))) {
      const name = wanted.get(m[1])
      if (!name) continue
      const found = tagAt(text, m.index + m[0].length)
      if (!found) continue
      tag.lastIndex = found.end
      callSites += 1
      const entry = components[name] ??= { sites: 0, props: {} }
      entry.sites += 1
      for (const { name: raw, value, kind } of attrPairs(found.attrs)) {
        if (EVENT_BINDING.test(raw)) continue
        const clean = NAME.exec(raw)?.[1]
        if (!clean || FRAMEWORK.test(clean) || FRAMEWORK.test(raw)) continue
        const prop = entry.props[clean] ??= { passed: 0, observed: {}, expressions: 0 }
        prop.passed += 1
        if (kind === 'expression') prop.expressions += 1
        else {
          const key = kind === 'boolean' ? 'true' : String(value)
          prop.observed[key] = (prop.observed[key] ?? 0) + 1
        }
      }
    }
  }

  return {
    components,
    // The denominator, always. A vocabulary drawn from four call sites and one drawn
    // from four hundred are different kinds of claim, and only one of them is worth
    // putting in front of an agent.
    considered: { files: sources.length, callSites },
  }
}

/**
 * Which observed props read as a closed set of choices — an axis an agent can be
 * told about — and which do not, with the reason.
 *
 * Every rule here is a refusal. That is deliberate: the cost of the two mistakes is
 * not symmetric. Missing an axis leaves an agent no worse off than it is today,
 * while inventing one teaches it that a free-text `title` has four legal values.
 *
 * @param floor the observation floor this profile already uses elsewhere
 */
export function axesFrom(usage, floor) {
  const out = {}
  for (const [component, entry] of Object.entries(usage.components)) {
    for (const [prop, p] of Object.entries(entry.props)) {
      const literals = Object.values(p.observed).reduce((a, b) => a + b, 0)
      const distinct = Object.keys(p.observed).length
      const refuse = (why) => { (out[component] ??= {})[prop] = { axis: false, why, literals, distinct } }

      if (literals < floor) { refuse(`only ${literals} call site(s) pass a literal here, below the floor of ${floor}`); continue }
      // A prop mostly passed as an expression has a literal set that is a sample of
      // unknown size. `variant={isPrimary ? 'primary' : 'ghost'}` is invisible to
      // this scan, and so is `variant={props.variant}`.
      if (p.expressions > literals) { refuse(`passed as an expression ${p.expressions} time(s) against ${literals} literal(s), so the values seen are not the whole set`); continue }
      // A prop always given the same literal is a constant, not a choice. `Page
      // auto-content-height="true"` sixteen times says the flag is on everywhere;
      // offering it to an agent as an axis invites it to pick the other value, of
      // which there is no evidence at all.
      if (distinct < 2) { refuse(`every use passes the same value, so this is a constant rather than a choice`); continue }
      // A vocabulary is small and reused; free text is long and barely repeats.
      // Requiring only "fewer distinct values than uses" was not enough: a page
      // title prop with eight different headings across twelve uses passed it, and
      // an agent told those are the values would treat a heading as an enum. On
      // average each member of a real set is written at least twice.
      if (distinct * 2 > literals) { refuse(`${distinct} distinct values across ${literals} use(s) barely repeat, which reads as free text rather than a set of choices`); continue }
      if (distinct > 12) { refuse(`${distinct} distinct values is a range or an identifier, not a set of choices`); continue }
      // A member of a vocabulary is a short identifier: `ghost`, `sm`, `403`,
      // `coming-soon`. Anything long, or carrying a path, a host or an address, is
      // configuration or content that happens to repeat — not a choice.
      //
      // The rule earns its place twice. It is true on its own terms, and it is the
      // only thing standing between a client's source and two places this tool
      // writes: `component-index.md` inside their repository, and a scan on the
      // consultant's own machine. Two internal URLs across twelve call sites cleared
      // every other rule here and were recorded verbatim, in full, into both.
      //
      // The whole prop is refused, not the offending value. Dropping one value and
      // keeping the rest would publish a distribution that never existed.
      // A contiguous run of integers is a range, not a set of choices. `MatGridList
      // cols = 1 2 3 4 5 6` cleared every rule above and told an agent that a column
      // count is an enumeration. Discrete codes survive because they are sparse: the
      // http statuses 403, 404 and 500 span 98 values and fill three of them, while
      // 1..6 fills all six. Three is the floor, so a genuine two-value choice that
      // happens to be numeric is not caught by arithmetic.
      const nums = Object.keys(p.observed).map(Number)
      if (distinct >= 3 && nums.every(n => Number.isInteger(n))) {
        const sorted = [...new Set(nums)].sort((a, b) => a - b)
        const span = sorted[sorted.length - 1] - sorted[0] + 1
        if (sorted.length / span >= 0.8) { refuse(`${distinct} values running from ${sorted[0]} to ${sorted[sorted.length - 1]} are a range, not a set of choices`); continue }
      }
      // A length is a measurement, not a name. `rowHeight = 100px 20px 200px fit`
      // repeats often enough to pass for a vocabulary and is nothing of the kind.
      const lengths = Object.keys(p.observed).filter(v => /^-?[\d.]+(px|rem|em|%|vh|vw|ch|pt)$/.test(v)).length
      if (lengths * 2 >= distinct && lengths > 0) { refuse(`${lengths} of ${distinct} values are CSS lengths, which is a measurement rather than a set of choices`); continue }

      const unfit = Object.keys(p.observed).find(v => v.length > 32 || /[\s\/@]|:\/\//.test(v))
      if (unfit !== undefined) {
        refuse(`a value here is ${unfit.length > 32 ? 'longer than any name' : 'a path, address or phrase'}, so this carries content rather than a set of choices`)
        continue
      }

      ;(out[component] ??= {})[prop] = {
        axis: true,
        // Named for what it is. These are the values seen, and a value nobody wrote
        // this quarter is not thereby illegal — the difference between `observed`
        // and `allowed` is the whole reason this file is not a type checker.
        observed: Object.fromEntries(Object.entries(p.observed).sort((a, b) => b[1] - a[1])),
        from: `${literals} literal use(s) across ${entry.sites} call site(s)`,
        ...(p.expressions ? { alsoPassedAsExpression: p.expressions } : {}),
      }
    }
  }
  return out
}
