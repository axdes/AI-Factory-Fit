/**
 * Composition and component APIs for the two frameworks that are not JSX.
 *
 * Everything the deep pass measures about a screen — what it is built from, which
 * of its three states it handles, how it takes its configuration — is a fact about
 * markup and a props declaration, not about JSX. Reading only JSX made all of it
 * report NOT APPLICABLE on Vue and Svelte, which was honest and was still half the
 * value missing on any project not written in React.
 *
 * These are readers, not parsers. A single-file component's template is HTML with
 * additions, and what is needed here is which tags are components, which are raw,
 * what the props are and whether the three states are branched on. Taking a real
 * compiler for that means two more dependencies and a version to keep in step with
 * the client's, for answers the same shape as these.
 *
 * The limit travels with the result: a component resolved at runtime — Vue's
 * `<component :is>`, Svelte's `<svelte:component>` — is counted as one element and
 * not as whatever it becomes.
 */

/** Elements that are HTML rather than something the project wrote. */
const RAW = /^(div|span|p|h[1-6]|ul|ol|li|table|tr|td|th|section|header|footer|nav|aside|main|button|input|select|textarea|a|img|form|label|template|slot|br|hr)$/i

const block = (text, tag) => {
  const open = new RegExp(`<${tag}[^>]*>`, 'i').exec(text)
  if (!open) return undefined
  const from = open.index + open[0].length
  const close = text.lastIndexOf(`</${tag}>`)
  return close > from ? text.slice(from, close) : text.slice(from)
}

/** Capitalised or kebab-case tags in markup, split into components and raw. */
function tags(markup) {
  const component = []
  const raw = []
  for (const m of markup.matchAll(/<([A-Za-z][\w.-]*)/g)) {
    const name = m[1]
    if (RAW.test(name)) raw.push(name)
    // A dash or a capital is the convention both ecosystems use to mean "not
    // HTML". `<router-view>` and `<RouterView>` are the same element written two
    // ways, and a project usually picks one.
    else if (/[A-Z]/.test(name) || name.includes('-')) component.push(name)
    else raw.push(name)
  }
  return { component, raw }
}

const importedNames = (script) => {
  const names = new Set()
  for (const m of (script ?? '').matchAll(/import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (/^(vue|svelte)$/.test(m[2])) continue
    const clause = m[1].replace(/\btype\s+/g, '')
    const named = (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',')
    const byDefault = clause.replace(/\{[^}]*\}/, '').split(',')[0]
    for (const raw of [...named, byDefault]) {
      const clean = raw.trim().split(/\s+as\s+/).pop()?.trim()
      if (clean && /^[A-Z]\w*$/.test(clean)) names.add(clean)
    }
  }
  return names
}

/**
 * The three states, by the same rule the JSX pass uses: presence of an
 * identifier, not proof that anything renders for it. A floor, and it is called
 * one in the report.
 */
const states = (text) => ({
  handlesLoading: /\b(isLoading|loading|pending|isPending|Skeleton|Spinner)\b/.test(text),
  handlesError: /\b(error|isError|ErrorBoundary|Alert|catch)\b/.test(text),
  handlesEmpty: /\b(empty|EmptyState|noResults|isEmpty|length === 0|length \?)\b/.test(text),
})

/** A Vue single-file component. */
export function readVue(text) {
  const script = block(text, 'script') ?? ''
  const markup = block(text, 'template') ?? ''
  const { component, raw } = tags(markup)

  // `defineProps<{ a: string; b?: number }>()` and the object form. Vue writes its
  // props declaration in one place, which makes this the most reliable of the
  // three frameworks to read.
  // Three forms, and the one that matters most is the least obvious. Reading only
  // the inline `defineProps<{ ... }>` found props in nine of forty-nine files in a
  // real component library: thirty-three of them write
  // `withDefaults(defineProps<Props>(), { ... })`, where `Props` is an interface
  // declared above. Exactly the failure the React extractor had, in another
  // language — a named type is how people write anything longer than two props.
  const named = /defineProps<\s*([A-Z]\w*)\s*>/.exec(script)?.[1]
  const declaration = named
    // The closing brace may or may not be on its own line. Requiring a newline
    // read a one-line `interface Props { a: string; b: number }` as declaring
    // nothing, which is a shape people write for two or three props.
    ? new RegExp(`(?:interface|type)\\s+${named}\\s*(extends\\s+[^{]+)?=?\\s*\\{([^{}]*)\\}`).exec(script)
    : undefined
  // `interface Props extends FallbackProps {}` declares nothing of its own — the
  // props come from a type this file imports. Zero and unknown are different
  // answers, and reporting zero would put a component with a full API into the
  // median as though it took nothing.
  const inherits = Boolean(declaration?.[1])
  const resolved = declaration?.[2]?.trim() ? declaration[2] : undefined
  // Read to the matching brace, not to the first one. `defineProps<{ options?: {
  // label: string; value: string }[] }>()` ends, to a lazy `[\s\S]*?\}`, at the inner
  // object — and the props came back as `options: { label: string` plus a phantom
  // `value: string }[]` marked REQUIRED. The generator then passed `:value="[]"` to a
  // component with no such prop, on a file it had just reported as conforming.
  const typedBlock = (() => {
    const at = /defineProps<\s*\{/.exec(script)
    if (!at) return undefined
    const from = at.index + at[0].length
    let depth = 1
    for (let i = from; i < script.length; i += 1) {
      if (script[i] === '{') depth += 1
      else if (script[i] === '}') { depth -= 1; if (!depth) return script.slice(from, i) }
    }
    return undefined
  })()
  const typed = typedBlock ?? resolved
  const object = /defineProps\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(script)?.[1]
  // Split on both separators. Matching per line missed every prop in a one-line
  // declaration, where a semicolon does the job a newline does elsewhere.
  // Split at the separators that are between props, not the ones inside a prop's own
  // type. Splitting on every `;` cut `{ label: string; value: string }` in half.
  const splitTop = (text) => {
    const out = []
    let depth = 0, from = 0
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i]
      // `>` closes a generic — unless it is the tail of an arrow. `createRow?: () =>
      // Record<string, unknown>` walked to depth -1 at the arrow, so the comma inside
      // `Record<...>` split the prop and the type came back as `() => Record<string`.
      if (c === '{' || c === '[' || c === '(' || c === '<') depth += 1
      else if (c === '>' && text[i - 1] === '=') { /* an arrow, not a closing bracket */ }
      else if (c === '}' || c === ']' || c === ')' || c === '>') depth -= 1
      else if ((c === ';' || c === '\n' || c === ',') && depth <= 0) { out.push(text.slice(from, i)); from = i + 1 }
    }
    out.push(text.slice(from))
    return out
  }
  const props = typed
    ? splitTop(typed).map(part => /^\s*(\w+)(\??)\s*:\s*(.+?)\s*,?\s*$/.exec(part))
      .filter(Boolean)
      .map(m => ({ name: m[1], type: m[3].trim(), required: m[2] !== '?' }))
    : object
      ? [...object.matchAll(/^\s*(\w+)\s*:/gm)].map(m => ({ name: m[1], type: 'unknown', required: false }))
      : []

  return {
    // The template itself, so the shell a screen renders into can be read from
    // it. Without this every single-file component answers "no recognisable
    // shell", which is a fact about where the reader looked, not about the screen.
    markup,
    framework: 'vue',
    componentUses: component.length,
    rawElements: raw.length,
    distinctComponents: new Set(component).size,
    imported: importedNames(script),
    props,
    // Absent is not unknown. A Vue component with no defineProps has no props,
    // and that is a measurement; unknown is reserved for a declaration this pass
    // could not follow.
    propsUnknown: Boolean(named && !resolved) || inherits,
    ...states(text),
  }
}

/** A Svelte component. */
export function readSvelte(text) {
  const script = block(text, 'script') ?? ''
  // Everything outside the script and style blocks is markup. Svelte has no
  // template element, which is the whole difference from Vue here.
  const markup = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  const { component, raw } = tags(markup)

  // Two eras, both in the wild: `export let name` through Svelte 4, and
  // `let { name } = $props()` from 5. Reading only one halves the answer on any
  // codebase mid-migration, which is most of them.
  const legacy = [...script.matchAll(/^\s*export\s+let\s+(\w+)(\s*=\s*([^;\n]+))?/gm)]
    .map(m => ({ name: m[1], type: 'unknown', required: m[2] === undefined }))
  // Names, not everything that looks like one. `let { variant = 'secondary', children }
  // = $props()` gave up three props — `variant`, `secondary` and `children` — because
  // every word in the destructuring was taken, defaults included. `$bindable('')`
  // produced a prop called `bindable`. The registry then offered components props they
  // do not have, and the generator would have passed them.
  //
  // A name is what stands before `=` or `:` at the top level of the braces; a default
  // is what stands after, and it may itself contain commas and calls.
  const runeNames = (block) => {
    const out = []
    let depth = 0, from = 0
    const parts = []
    for (let i = 0; i < block.length; i += 1) {
      const c = block[i]
      if (c === '{' || c === '(' || c === '[') depth += 1
      else if (c === '}' || c === ')' || c === ']') depth -= 1
      else if (c === ',' && depth === 0) { parts.push(block.slice(from, i)); from = i + 1 }
    }
    parts.push(block.slice(from))
    for (const part of parts) {
      const name = /^\s*(?:\.\.\.)?\s*(\w+)/.exec(part)?.[1]
      if (name) out.push([part, name])
    }
    return out
  }
  const runes = /\$props\(\)/.test(script)
    ? runeNames(/\{([^}]*)\}\s*(?::[^=]+)?=\s*\$props\(\)/.exec(script)?.[1] ?? '')
      .map(m => ({ name: m[1], type: 'unknown', required: false }))
    : []
  const props = [...legacy, ...runes]

  return {
    // The template itself, so the shell a screen renders into can be read from
    // it. Without this every single-file component answers "no recognisable
    // shell", which is a fact about where the reader looked, not about the screen.
    markup,
    framework: 'svelte',
    componentUses: component.length,
    rawElements: raw.length,
    distinctComponents: new Set(component).size,
    imported: importedNames(script),
    props,
    propsUnknown: props.length === 0 && /\$props\(\)|export let/.test(script),
    ...states(text),
  }
}

/**
 * The stylesheet an SFC carries, as CSS a parser can take.
 *
 * A single-file component keeps its rules in a `<style>` block, so anything that
 * collected `.css` and `.scss` files saw none of them. `defects` counted literals
 * across zero files on a Vue project holding three, and printed the zero.
 *
 * Every block is concatenated: a component may carry a scoped one and a global one,
 * and both are this component's rules.
 */
export function styleSource(text) {
  const out = []
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out.push(m[1])
  return out.join('\n')
}

/**
 * An Angular component, which is a class with a decorator and usually a template in
 * a file beside it.
 *
 * Read here rather than through the TypeScript AST for one reason: everything this
 * function answers is a fact about the decorator and the markup, which is what the
 * two readers above already establish. Reaching for the compiler would give the same
 * answers through a second mechanism that has to be kept in step with the first.
 *
 * The path is required, not optional: a component that names its template cannot be
 * read from its own text alone, and returning "no markup" for the majority form
 * would report a whole codebase as rendering nothing.
 */
export function readAngular(text, abs, io = {}) {
  const { exists, read } = io
  const decorator = /@Component\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/.exec(text)?.[1] ?? ''

  let markup = /template\s*:\s*`([\s\S]*?)`/.exec(decorator)?.[1]
  if (markup === undefined && exists && read) {
    const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(decorator)?.[1]
    if (url) {
      const at = resolveBeside(abs, url)
      markup = exists(at) ? read(at) : undefined
    }
  }
  const { component, raw } = tags(markup ?? '')

  // Two eras, both in the wild, and independent of each other: `@Input()` on a field
  // through 17, `input()` as a signal from 17.1. A repository is routinely on both.
  const decorated = [...text.matchAll(/@Input\s*\(([^)]*)\)\s*(?:readonly\s+)?(\w+)([?!])?\s*(?::[^=;\n]+)?(\s*=)?/g)]
    .map(m => ({ name: m[2], type: 'unknown', required: !m[4] && m[3] !== '?' }))
  // The type is in the generic: `input<'primary' | 'secondary'>('secondary')`. Read
  // as `unknown`, the closed set never reached the registry, and `ds bind` asked
  // DsButton for a "primary" value, found none, and marked a correct match
  // questionable — on a component declaring exactly that union one line above.
  const signals = [...text.matchAll(/(?:readonly\s+)?(\w+)\s*=\s*input(\.required)?\s*(<([^>]*)>)?\s*\(/g)]
    .map(m => ({ name: m[1], type: (m[4] ?? 'unknown').trim(), required: Boolean(m[2]) }))
  const props = [...decorated, ...signals]

  return {
    // The template itself, so the shell a screen renders into can be read from
    // it. Without this every single-file component answers "no recognisable
    // shell", which is a fact about where the reader looked, not about the screen.
    markup,
    framework: 'angular',
    componentUses: component.length,
    rawElements: raw.length,
    distinctComponents: new Set(component).size,
    imported: importedNames(text),
    props,
    propsUnknown: props.length === 0 && /@Input\b|=\s*input[<(]/.test(text),
    // A template that could not be read is not a template with no states in it.
    ...(markup === undefined
      ? { handlesLoading: undefined, handlesError: undefined, handlesEmpty: undefined }
      : states(markup)),
  }
}

/** `./home.component.html` from `/a/b/home.component.ts`. */
function resolveBeside(abs, relative) {
  const dir = abs.slice(0, Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\')))
  return `${dir}/${relative.replace(/^\.\//, '')}`
}

export const READERS = { '.vue': readVue, '.svelte': readSvelte }

/** What these readers cannot see, carried with every result that uses them. */
export const SFC_LIMITS =
  'Single-file components are read, not compiled: a tag with a capital or a dash is treated as a '
  + 'component and everything else as raw markup. A component chosen at runtime — Vue\'s `<component :is>`, '
  + 'Svelte\'s `<svelte:component>` — counts as one element rather than as what it becomes, and a props '
  + 'declaration built by a helper rather than written out is not read.'
