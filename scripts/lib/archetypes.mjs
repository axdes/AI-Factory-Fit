/**
 * What shape a screen is, taken from the shell it puts itself in.
 *
 * The first two attempts at this measured the CONTENTS of a screen — how many
 * elements, how many of them came from the system, which of the three states it
 * handled — and thirty-five screens produced nineteen shapes. A list and a form are
 * indistinguishable that way: both are "medium, from the system, no states", and
 * they look nothing alike.
 *
 * The shape is in the FRAME. A screen picks a shell and fills some of its regions,
 * and that pair is the archetype. Measured across three real products:
 *
 *   outline   169 files   <Scene> 35 · <Flex> 32 · <CenteredContent> 4
 *   plane      58 routes  SettingsContentWrapper 17 · DefaultLayout 5 · …
 *   twenty                SettingsPageLayout 40
 *
 * and the variant is which regions of that shell are filled. Outline's `<Scene>` is
 * called 35 times and 28 of those fall into three signatures: `icon+title`,
 * `title`, `actions+left+title`.
 *
 * Two things fall out of this that the contents-based attempts never gave:
 *
 *   · the shell is also the SCREEN DETECTOR. A file that renders one is a screen; a
 *     file in the same folder that does not is a part. No separate guess about file
 *     names is needed, which is the guess that found five screens in a repository
 *     holding several dozen.
 *   · it is framework-neutral. `page.tsx` in a Next app is a wrapper with no styling
 *     in it at all, so a CSS skeleton would have found nothing there.
 */

/**
 * The attributes of an opening tag, read to the tag's real end.
 *
 * `[^>]*` was the first version and it is wrong on the single most important case
 * this module has: a region whose value is markup. `<Scene icon={<ArchiveIcon />}
 * title={t("Import")}>` ends, to that regex, at the `>` inside `<ArchiveIcon />` —
 * so the attributes read as `icon={<ArchiveIcon /` and every region after the first
 * markup-valued one disappeared. outline's `<Scene>` is called thirty-five times and
 * this pass found four of them, which looked like a project that rarely fills its
 * frame and was a truncated read.
 *
 * Depth over braces, and quotes respected, so the tag ends where it actually ends.
 *
 * @returns { attrs, end } or undefined if the tag never closes
 */
function openingTag(src, from) {
  let depth = 0, quote
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = undefined; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') { depth += 1; continue }
    if (c === '}') { depth -= 1; continue }
    // A self-closing marker belongs to the tag; `>` at depth 0 ends it.
    if (c === '>' && depth <= 0) return { attrs: src.slice(from, i), end: i + 1 }
  }
  return undefined
}

/**
 * Wrappers that are plumbing rather than shape: they position nothing.
 *
 * `Outlet` was the addition that mattered. A Remix or React Router layout returns
 * one and nothing else, and it was being counted as a shape — five of documenso's
 * screens read as archetype `Outlet`, which says only that the router renders
 * children there. Stepping through it reaches whatever the file actually puts
 * around them, or nothing, and nothing is the right answer.
 */
const PLUMBING = /^(React\.?Fragment|Fragment|Suspense|ErrorBoundary|Provider|[A-Z]\w*Provider|Observer|Authenticated|[A-Z]\w*Guard|Outlet|RouterProvider)$/

/**
 * The shell a screen renders into, and which of its regions it fills.
 *
 * @param src the component's source
 * @returns { shell, regions } or undefined when nothing recognisable wraps it
 */
export function shellOf(src, declared) {
  // What is returned, not what is imported: a screen importing six layouts and
  // rendering one is shaped by the one.
  const opener = /(?:return|=>)\s*\(?\s*<([A-Z][\w.]*)/.exec(src)
  if (!opener) return undefined

  // Three outcomes, not two, and the difference matters more than it looks.
  //
  // `undefined` used to mean both "this pass could not read the shape" and "this
  // screen has no frame", and those are opposite claims. On documenso 78 of 131
  // screens came back undefined; reading them showed 61 return a raw `<div>` and
  // hand-roll their own headings, and 17 render nothing at all. The 61 are not a
  // gap in the measurement — they are the measurement, and "sixty-one screens here
  // use no page frame" is exactly what a consultant arriving at that repository
  // needs to be told. Filed as a limit, it was invisible.
  //
  // See `shapeless` below for how the two are told apart.

  let shell = opener[1]
  let tag = openingTag(src, opener.index + opener[0].length)
  if (!tag) return undefined
  let attrs = tag.attrs
  let rest = src.slice(tag.end)

  // A wrapper that only supplies context is not the shape. Step through them to the
  // first element that positions something, or a screen inside an auth wrapper reads
  // as a different archetype from the identical screen outside one.
  let guard = 0
  while (PLUMBING.test(shell) && guard < 4) {
    const next = /<([A-Z][\w.]*)/.exec(rest)
    if (!next) break
    const inner = openingTag(rest, next.index + next[0].length)
    if (!inner) break
    shell = next[1]
    attrs = inner.attrs
    rest = rest.slice(inner.end)
    guard += 1
  }
  if (PLUMBING.test(shell)) return undefined

  return { shell, ...readAttrs(attrs, /(\w+)\s*=/g, declared?.(shell)) }
}

/**
 * Why a screen has no shell — read, rather than left as an absence.
 *
 * @returns 'unframed'  it returns markup, and the root of it is a raw element:
 *                      this screen builds its own page out of divs
 *          'norender'  it returns no markup at all: a route module that only
 *                      exports a loader, or re-exports something else
 *          undefined   it does have a component at the root, so `shellOf` answers
 */
export function shapeless(src) {
  const any = /(?:return|=>)\s*\(?\s*<([a-zA-Z][\w.]*)/.exec(src)
  if (!any) return 'norender'
  if (/^[a-z]/.test(any[1])) return 'unframed'
  // A component at the root, and `shellOf` still refused it: everything down the
  // chain was plumbing. A Remix layout returning nothing but `<Outlet />` is the
  // ordinary case. Caught by the `unclassified` counter, which exists so that a
  // screen falling through every category is visible rather than absorbed — it
  // found one the moment `Outlet` moved into the plumbing list.
  return 'plumbingOnly'
}

/**
 * The regions a frame declares, read from the frame itself.
 *
 * Guessing which attributes are regions from their names was the second wrong
 * answer here. The first called every attribute a region and produced
 * `WorkflowRunsTable(error+isError+isLoading+onRetry+runs)`; narrowing it to
 * markup-valued attributes lost `title={t("Archive")}`, which is the single most
 * common region in the corpus. Both were guesses about someone else's component.
 *
 * The component says so itself. outline's `Scene` declares:
 *
 *   icon?: React.ReactNode      left?: React.ReactNode
 *   title?: React.ReactNode     actions?: React.ReactNode
 *   textTitle?: string          wide?: boolean
 *
 * Four regions and two settings, separated by their author, in a type that is
 * already on disk. Every framework here has the same declaration in its own words —
 * a Vue `<slot name>`, a Svelte `<slot>` or `Snippet`, an Angular `<ng-content
 * select>` — so this is as framework-neutral as the shell idea it serves.
 *
 * @param source the frame's own source
 * @returns the declared region names, or undefined when the frame could not be read
 *          — which is not the same as a frame with no regions
 */
export function regionsDeclaredBy(source) {
  if (!source) return undefined
  const found = new Set()

  // React and Angular alike: a prop typed as renderable content.
  //
  // `Element` on its own was in this list for one draft and it matched `e: Event`,
  // `ref: RefObject<Element>` and every `onClick: (e: MouseEvent<Element>) => void`
  // in five products — so `e`, `ref`, `onClick` and `value` came back as regions
  // present in four products out of five, which read as a portable vocabulary and
  // was a leaky regex. The types below are the ones that mean renderable content
  // and nothing else.
  const RENDERABLE = /\b(ReactNode|ReactElement|ReactChild|JSX\.Element|React\.JSX\.Element|Snippet|TemplateRef)\b/
  // A handler or a ref can be typed with a renderable inside it and is still not a
  // place in the frame.
  const NOT_A_PLACE = /^(on[A-Z]|handle[A-Z])|([Rr]ef|Handler|Callback)$|^(e|ev|event|props|index|key|data|type|value|name)$/
  for (const m of source.matchAll(/(\w+)\s*\??\s*:\s*([^;,\n}]+)/g)) {
    if (!NOT_A_PLACE.test(m[1]) && RENDERABLE.test(m[2])) found.add(m[1])
  }

  // A place can hold text as well as markup, and the type alone does not say so.
  // The screen-idiom fixture's frame declares `title: string` and renders
  // `<h1>{icon}{title}</h1>` — the title is a place in that frame, filled with a
  // string. Reading types only, the strict path dropped it and the archetype went
  // from `AppShell(icon+title)` to `AppShell(icon)`, losing the region every screen
  // in the fixture fills.
  //
  // The second fact is the frame putting the prop somewhere: `{name}` in a child
  // position, not as an attribute value. `className={cn(x)}` and `title={a ?? b}`
  // are preceded by `=` and are the frame using a value, not offering a place.
  // Import and export braces are not render positions — `import type { ReactNode }`
  // came back as a region named ReactNode. And the match must not consume the
  // character before `{`, or `<h1>{icon}{title}</h1>` yields only `icon`: the `}`
  // that ends the first is the character the second needs, and a consuming group
  // eats it. Hence a lookbehind.
  let body = source.replace(/^\s*(import|export)\s[^\n]*$/gm, '')
  // A shorthand attribute is not a place. `<input bind:value {placeholder} />` is
  // Svelte for `placeholder={placeholder}`, and reading it as a render position made
  // `placeholder` a region of an input.
  body = body.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/\{[^}]*\}/g, ''))
  // Nor is a variable the template itself introduced. `{#each columns as c}<th>{c}</th>`
  // renders `c`, which the component's caller has never heard of — `DsTable` came back
  // declaring places called `c` and `cell`.
  const bound = new Set()
  for (const m of body.matchAll(/\{[#:]?(?:each|await|then|catch|const)\s+[^}]*?\bas\s+([\w,\s[\]{}]+)\}/g)) {
    for (const n of m[1].split(/[\s,[\]{}]+/)) if (n) bound.add(n)
  }
  for (const m of body.matchAll(/\{@const\s+(\w+)/g)) bound.add(m[1])

  for (const m of body.matchAll(/(?<![=$])\{\s*(\w+)\s*\}/g)) {
    if (!NOT_A_PLACE.test(m[1]) && !bound.has(m[1])) found.add(m[1])
  }
  // Vue and Svelte declare a slot in the template rather than in a type.
  for (const m of source.matchAll(/<slot\b([^>]*)>/g)) {
    const name = /name\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1]
    found.add(name ?? 'children')
  }
  // Svelte 5 renders a snippet rather than filling a slot.
  for (const m of source.matchAll(/\{@render\s+(\w+)/g)) found.add(m[1])
  // Angular projects content by selector; a bare `<ng-content>` is the default slot.
  for (const m of source.matchAll(/<ng-content\b([^>]*)>/g)) {
    const sel = /select\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1]
    found.add(sel ? sel.replace(/[\[\].#]/g, '') : 'children')
  }
  // A frame that declares nothing renderable is not a frame this can describe. Say
  // so rather than returning an empty set, which reads as "no regions filled".
  return found.size ? found : undefined
}

/**
 * What a screen hands its shell, split into the two things it is.
 *
 * The first version called every attribute a region, and on real products that
 * produced signatures like `WorkflowRunsTable(error+isError+isLoading+onRetry+runs)`
 * and `DashboardDetailPage(params+searchParams)`. Neither is a shape. The first is a
 * data table's props and the second is Next's route arguments, and putting them in
 * the signature meant two screens with the same frame and different data read as two
 * different archetypes — which is the failure the contents-based attempts had, back
 * again through a different door.
 *
 * A region is a place in the frame; a prop is what goes in it. The separation is by
 * evidence rather than by a list of nice names:
 *
 *   markup      the value contains an element — `icon={<ArchiveIcon />}`. This is a
 *               region and nothing else can be.
 *   behaviour   `onSave`, `handleX` — a callback is not a place.
 *   state       `isLoading`, `hasError`, `canWrite` — a condition is not a place.
 *   identity    `workspaceId`, `queryKey`, `params` — an argument is not a place.
 *
 * What is left over is unclassified, and stays out of the signature rather than
 * being guessed into it. `title="Documents"` is a real region and there is nothing
 * in the source that proves it, so it is reported as unclassified and counted
 * nowhere — the same refusal every other pass here makes.
 */
/**
 * The attribute names of one tag, skipping over each value.
 *
 * Scanning the whole blob for `name=` reads the attributes of anything nested inside
 * a value: `<PageShell actions={<Button variant="primary">Invite</Button>}>` gave up
 * `variant` as one of PageShell's own, and the generator then wrote
 * `variant="Documents"` onto a component that has no such prop. A file that does not
 * compile, from a component the tool had just measured correctly.
 */
function attrNames(attrs, pattern) {
  const names = []
  let i = 0
  while (i < attrs.length) {
    pattern.lastIndex = i
    const m = pattern.exec(attrs)
    if (!m) break
    names.push({ name: m[1], at: m.index + m[0].length })
    // Step past the value, whatever shape it is, so nothing inside it is read as a
    // sibling attribute.
    let j = m.index + m[0].length
    while (j < attrs.length && /\s/.test(attrs[j])) j += 1
    const opener = attrs[j]
    if (opener === '{') {
      let depth = 0, quote
      for (; j < attrs.length; j += 1) {
        const c = attrs[j]
        if (quote) { if (c === quote && attrs[j - 1] !== '\\') quote = undefined; continue }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue }
        if (c === '{') depth += 1
        else if (c === '}') { depth -= 1; if (!depth) { j += 1; break } }
      }
    } else if (opener === '"' || opener === "'") {
      j = attrs.indexOf(opener, j + 1)
      j = j === -1 ? attrs.length : j + 1
    }
    i = Math.max(j, m.index + m[0].length)
  }
  return names
}

function readAttrs(attrs, pattern, declaredRegions) {
  const IGNORE = /^(key|ref|className|class|style|id|slot|data-\w+|aria-\w+|v-\w+|ng\w*|let-\w+)$/
  const regions = [], behaviour = [], state = [], identity = []
  const unclassified = []
  for (const found of attrNames(attrs, new RegExp(pattern.source, 'g'))) {
    const name = found.name
    if (IGNORE.test(name)) continue
    // The value as written, read to the end of its braces.
    const at = found.at
    const value = attrs[at] === '{' ? (openingTag(attrs + '>', at)?.attrs ?? '') : attrs.slice(at, at + 60)
    // The frame's own declaration decides, where the frame could be read. Nothing
    // else here is a fact about the frame; everything else is a guess about it.
    if (declaredRegions) {
      if (declaredRegions.has(name)) regions.push(name)
      else if (/^(on[A-Z]|handle[A-Z])/.test(name)) behaviour.push(name)
      else if (/^(is|has|can|should|are|did|was)[A-Z]/.test(name)) state.push(name)
      else identity.push(name)
      continue
    }
    // No declaration to read: the frame is in a package, or behind an alias this
    // pass did not resolve. Then the three things a region is NOT can still be told
    // apart with confidence — a handler, a condition, an identifier — and what
    // survives is read as a region.
    //
    // This is looser than the declared path on purpose. Refusing everything
    // unproven would drop `title={t("Archive")}` from every screen whose frame
    // could not be found, and `title` is the most common region in the corpus. The
    // reading is kept and marked instead: `fromDeclaration` is false, and anything
    // assembling a catalogue out of these can require the stricter half.
    if (/^(on[A-Z]|handle[A-Z])/.test(name) || /=>|\bfunction\b/.test(value)) behaviour.push(name)
    else if (/^(is|has|can|should|are|did|was)[A-Z]/.test(name) || /^(true|false)$/.test(value.trim())) state.push(name)
    else if (/(Id|Ids|Key|Slug|Uuid)$/.test(name) || /^(params|searchParams|query)$/.test(name)) identity.push(name)
    else regions.push(name)
  }
  const uniq = (a) => [...new Set(a)].sort()
  return {
    // Whether the frame itself was read. A signature drawn from a declaration is a
    // fact; one drawn from attribute shapes is a reading, and a catalogue that mixes
    // the two without saying which is which is a catalogue of guesses.
    fromDeclaration: Boolean(declaredRegions),
    regions: uniq(regions),
    // Kept beside the regions rather than dropped: a shell taking eleven identity
    // props and no regions is a component that was mistaken for a frame, and the
    // only way to see that is for the count to survive.
    passes: { behaviour: uniq(behaviour), state: uniq(state), identity: uniq(identity), unclassified: uniq(unclassified) },
  }
}

/**
 * The same question asked of a template rather than a return statement.
 *
 * Vue, Svelte and Angular put the shell in markup, and `shellOf` reads a `return
 * (<X`, so every single-file component in the corpus answered "no recognisable
 * shell" — which is not a property of those screens, it is a property of where this
 * looked. A catalogue assembled from that would have said flatly that Vue projects
 * have no screen shapes.
 *
 * The rule is the same one: the first element that positions something, and the
 * attributes it is given are the regions it fills. Only the syntax differs, and the
 * two spellings of a bound attribute (`:title` and `[title]`) are the same region.
 *
 * @param markup the component's template
 */
export function shellOfMarkup(markup, declared) {
  if (!markup) return undefined
  // A component, not a raw element: `<div>` is the absence of a shell, not a shell.
  const RE = /<([A-Z][\w.]*|[a-z]+-[\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let guard = 0
  for (const m of markup.matchAll(RE)) {
    const [, tag, attrs] = m
    // Compare the plumbing check against the PascalCase form, so `<app-provider>`
    // and `<AppProvider>` are held to the same rule.
    const asName = tag.includes('-')
      ? tag.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
      : tag
    if (PLUMBING.test(asName)) { if (++guard > 4) break; continue }
    return { shell: tag, ...readAttrs(attrs, /(?:\[|\(|:|@|v-bind:)?([\w-]+)\]?\)?\s*=/g, declared?.(tag)) }
  }
  return undefined
}

/**
 * Whether the screens here lay themselves out, or leave it to the frame.
 *
 * Measured because the generator assumed they do: it wrote `display: flex;
 * flex-direction: column; gap: var(--space-4)` onto every screen's own class and a
 * stylesheet beside it, always. On one real product ten screens of sixteen declare
 * no layout at all — they fill the shell's regions and hand it children — so that
 * output invented an arrangement the project never writes, in a file that then sits
 * beside fifteen that have none.
 *
 * Counted per screen, not per declaration: a screen with six flex rows inside it
 * still answers this question once.
 */
export function declaresOwnLayout(text) {
  // A layout the screen itself owns, in whichever of the three worlds it uses.
  if (/styled[.(][^`]*`[^`]*display\s*:\s*(grid|flex)/s.test(text)) return true
  if (/className=["'`][^"'`]*\b(grid|flex)\b/.test(text)) return true
  if (/import\s+['"][^'"]*\.(css|scss)['"]/.test(text)) return true
  if (/<style[^>]*>[\s\S]*display\s*:\s*(grid|flex)/.test(text)) return true
  return false
}

/**
 * How a screen arranges what it owns, where it arranges anything at all.
 *
 * Measured after two probes said the signal was not where it was looked for. The
 * first counted every flex and grid in the file and got a nesting — a column at the
 * top with rows inside — which is true and is not an arrangement, it is every
 * arrangement the screen contains. The second looked for the root container's rule
 * and resolved five of eleven, two of them a button.
 *
 * What the numbers say, on the one project where every stylesheet is on disk: of
 * thirty-five screens eleven arrange anything, and those eleven do not agree —
 * column, row, and grids of one, two, three and four columns. That is a SPLIT by
 * this tool's own thresholds, and a split is not a house style to copy. It is the
 * team's to settle, and reporting a dominant answer over it would be inventing one.
 *
 * So this counts and reports, and decides nothing.
 */
export function arrangementOf(text) {
  const found = new Set()
  for (const m of text.matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
    const c = m[1]
    if (/\bgrid\b/.test(c)) found.add(/grid-cols/.test(c) ? `grid ${/grid-cols-\[?([^\s\]]+)/.exec(c)?.[1] ?? '?'}` : 'grid')
    else if (/\bflex\b/.test(c)) found.add(/flex-col/.test(c) ? 'flex column' : 'flex row')
  }
  for (const m of text.matchAll(/`([^`]{0,400}?display\s*:\s*(grid|flex)[^`]{0,200}?)`/g)) {
    const body = m[1]
    if (/display\s*:\s*grid/.test(body)) {
      const cols = /grid-template-columns\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
      found.add(cols ? `grid ${cols.split(/\s+/).length} col` : 'grid')
    } else found.add(/flex-direction\s*:\s*column/.test(body) ? 'flex column' : 'flex row')
  }
  return [...found]
}

/** `Scene` filled with `icon` and `title` → `Scene(icon+title)`. */
export const signatureOf = ({ shell, regions }) =>
  regions.length ? `${shell}(${regions.join('+')})` : shell

/**
 * The archetypes of a project, as a distribution.
 *
 * Named the same way every other convention here is: what dominates, at what share,
 * with the rest kept beside it. An archetype covering 60% of screens is a shape to
 * write the next screen in; one covering 4% is a screen somebody wrote once.
 */
export function archetypes(files, declared) {
  const byShell = new Map()
  const bySignature = new Map()
  const screens = []

  for (const { file, text } of files) {
    const found = shellOf(text, declared)
    // Every screen stays in, framed or not. `continue` was here, and it took the
    // screens with no frame out of the denominator of the very question they answer
    // best: on five screens where three build their own page and declare a layout,
    // the three were dropped, `declaresOwnLayout` came back 0 of 2, and the
    // generator decided to write no layout in a project where the majority write
    // one. The true share was 0.6.
    screens.push({
      file,
      ...(found ?? {}),
      framed: Boolean(found),
      noShellBecause: found ? undefined : shapeless(text),
      ownLayout: declaresOwnLayout(text),
      arrangement: arrangementOf(text),
    })
    if (!found) continue
    const sig = signatureOf(found)
    byShell.set(found.shell, (byShell.get(found.shell) ?? 0) + 1)
    if (!bySignature.has(sig)) bySignature.set(sig, { files: [], declared: Boolean(found.fromDeclaration) })
    bySignature.get(sig).files.push(file)
  }
  const framed = screens.filter(s => s.framed)

  const rank = (map, asCount) => [...map]
    .map(([k, v]) => asCount
      ? { name: k, count: v }
      : { name: k, count: v.files.length, declared: v.declared, examples: v.files.slice(0, 3) })
    .sort((a, b) => b.count - a.count)

  const laysOutOwn = screens.filter(s => s.ownLayout).length
  return {
    // Two denominators, because two different questions are being asked of the same
    // list and collapsing them gave a wrong answer to one of them.
    //
    // `screens` is the detector: a file that renders a shell. A file returning a raw
    // `<div>` is not one, and that is what lets this module find screens without a
    // list of folder names.
    //
    // `considered` is everything the caller handed in. The generator hands in a
    // screen list it has already established, and the layout question is about all
    // of those — a screen that builds its own page is the strongest evidence there
    // is that screens here write their own layout, and it was being dropped from the
    // denominator of exactly that question. Three of five screens declared a layout,
    // this returned 0 of 2, and the generator wrote none.
    screens: framed.length,
    considered: screens.length,
    // How many of them arrange themselves rather than leaving it to the frame. A
    // generator that always writes a layout is right in a project where most screens
    // do and wrong in one where most do not — and both exist.
    declaresOwnLayout: { count: laysOutOwn, of: screens.length, share: screens.length ? laysOutOwn / screens.length : 0 },
    // What those screens arrange, and whether they agree. Reported with a verdict on
    // the same thresholds every other dimension here uses, so a split reads as a
    // question for the team rather than as a weak answer from us.
    arrangement: (() => {
      const counts = new Map()
      for (const s of screens) for (const a of s.arrangement) counts.set(a, (counts.get(a) ?? 0) + 1)
      const ranked = [...counts].sort((a, b) => b[1] - a[1])
      const total = ranked.reduce((n, [, v]) => n + v, 0)
      if (!total) return { verdict: 'none', distribution: [] }
      // Two observations agreeing is not a convention, it is two observations. Every
      // other pass here refuses a verdict on a sample this small — the exemplar
      // ranking will not call a file a reference on fewer than eight checks — and
      // this one called `grid 100%` over a count of two before the guard existed.
      if (total < 5) {
        return {
          verdict: 'too few to say',
          share: ranked[0][1] / total,
          distribution: ranked.map(([name, count]) => ({ name, count })),
          why: `${total} arrangement(s) found across the screens here; a share over that few is arithmetic, not a house style`,
        }
      }
      const share = ranked[0][1] / total
      return {
        verdict: share >= 0.85 ? 'convention' : share >= 0.6 ? 'weak' : 'split',
        dominant: ranked[0][0],
        share,
        distribution: ranked.map(([name, count]) => ({ name, count })),
      }
    })(),
    // A file that renders a shell is a screen; one that does not is a part. This is
    // the detector as well as the measurement, which is why no list of folder names
    // appears anywhere in here.
    shells: rank(byShell, true),
    signatures: rank(bySignature, false),
    // The partition, so a caller can tell "no house shape here" from "one I could
    // not read" — the difference between proposing a frame and refusing to.
    framed: framed.length,
    unframed: screens.filter(s => s.noShellBecause === 'unframed').length,
    renderingNothing: screens.filter(s => s.noShellBecause === 'norender').length,
    plumbingOnly: screens.filter(s => s.noShellBecause === 'plumbingOnly').length,
    // Only signatures whose shell declares places. A dominant archetype of
    // `TableRow` is a shape nobody can write a screen into.
    dominant: rank(bySignature, false).filter(x => x.declared)[0] ?? (framed.length ? rank(bySignature, false)[0] : undefined),
    share: framed.length ? rank(bySignature, false)[0].count / framed.length : 0,
  }
}
