/**
 * A screen as a Svelte component, in the shape this repository writes them.
 *
 * The third emitter, and the reason it is a third rather than a branch: Svelte has
 * no template element, its styles are scoped without saying so, its conditional is
 * a block rather than an attribute, and — the part that decides everything else —
 * it has two incompatible ways of declaring state that ship in two different major
 * versions. `$state()` in a Svelte 4 project does not compile, and `export let` in a
 * Svelte 5 project compiles with a deprecation the team is trying to get rid of.
 *
 * So the era is established before anything is written, and from the dependency
 * rather than from taste: the installed `svelte` version is a fact, and the measured
 * `props declaration` convention is the fallback when the version cannot be read.
 * Which of the two was used is reported, because on a codebase mid-migration those
 * two answers disagree and the disagreement is the useful part.
 */

/** What this emitter can produce, per dimension. */
export const SVELTE_CAN_WRITE = {
  'file structure': ['flat Name.svelte'],
  // Scoped by default, or kept outside. `:global` reaches out of the component's
  // own scope and `class:` directives are a different way of writing markup; this
  // approximates neither.
  styling: ['Svelte <style>', 'stylesheet imported', 'class, styles elsewhere'],
  'colour values': ['from tokens'],
  'sizing values': ['from tokens'],
  // A Svelte file exports no component, so there is no axis here to honour or break.
  'component export': undefined,
  // The generated screen declares no props of its own.
  'props declaration': undefined,
  'handler naming': undefined,
  'internal imports': undefined,
  'user-facing text': undefined,
  'test placement': undefined,
}

/**
 * Which Svelte this project is, and how that was decided.
 *
 * @param version      the `svelte` entry from package.json, if any
 * @param measuredProps what the `props declaration` signal measured across screens
 */
export function svelteEra({ version, measuredProps }) {
  const major = /(\d+)/.exec(String(version ?? '').replace(/^[^\d]*/, ''))?.[1]
  if (major) return { runes: Number(major) >= 5, from: `svelte ${version} in package.json` }
  // No readable version. The convention the screens already follow is the next best
  // evidence, and saying which was used matters: on a codebase mid-migration the
  // dependency and the habit disagree.
  if (measuredProps === '$props() runes') return { runes: true, from: 'the props form the existing screens use' }
  if (measuredProps === 'export let') return { runes: false, from: 'the props form the existing screens use' }
  return { runes: false, from: 'neither a readable version nor a settled props form; assuming pre-runes, which compiles on both' }
}

/**
 * @param ctx.name        component name
 * @param ctx.cssClass    block class
 * @param ctx.zones       resolved zones from the agreed spec
 * @param ctx.imports     [{ what, from }] every component used; Svelte imports by default
 * @param ctx.shell       { component, props } or undefined
 * @param ctx.styleMode   'inline' | 'imported' | 'none'
 * @param ctx.era         what `svelteEra` returned
 * @param ctx.usesI18n    whether text goes through i18n here
 * @param ctx.propsFor    (item) => [{ name, value, expression }]
 * @param ctx.takesSlot   (component) => boolean
 * @param ctx.label       (role) => the text to put in the slot
 */
export function emitSvelte(ctx) {
  const {
    name, cssClass, zones, imports, shell, styleMode, era, usesI18n,
    propsFor, takesSlot, label, statesComment, cautions, screens, specFile, profile,
  } = ctx

  const anyLabel = zones.some(z => z.items.some(i => takesSlot(i.component)))

  const importLines = [
    ...(styleMode === 'imported' ? [`import './${name}.css'`] : []),
    ...(usesI18n && anyLabel ? ["import { _ } from 'svelte-i18n'"] : []),
    // A Svelte component is a default export and its specifier carries the
    // extension. Dropping either produces an import that does not resolve.
    ...imports.map(i => `import ${i.what} from '${i.from}'`),
  ]

  // The two eras, and the difference is not stylistic: `$state()` does not exist in
  // Svelte 4 and `export let` is on its way out of 5.
  const stateBody = era.runes
    ? `let items = $state<Row[]>([])
let loading = $state(false)
let error = $state<string | null>(null)

const state = $derived(
  loading ? { key: 'loading', message: 'Loading…' }
    : error ? { key: 'error', message: 'Something went wrong.' }
    : items.length === 0 ? { key: 'empty', message: 'Nothing here yet.' }
    : undefined,
)`
    : `let items: Row[] = []
let loading = false
let error: string | null = null

$: state = loading ? { key: 'loading', message: 'Loading…' }
  : error ? { key: 'error', message: 'Something went wrong.' }
  : items.length === 0 ? { key: 'empty', message: 'Nothing here yet.' }
  : undefined`

  // Svelte writes an attribute the way JSX does, so the value and its spelling line
  // up without translation — unlike Vue, where a bound attribute needs a colon.
  const attrs = (item) => propsFor(item)
    .map(p => p.expression ? ` ${p.name}={${p.value}}` : ` ${p.name}="${p.value}"`)
    .join('')

  const IN = shell ? '    ' : '  '
  const ZONE = IN + '  '
  const zoneMarkup = zones.map(zone => {
    const inner = zone.items.map(item => takesSlot(item.component)
      ? `${ZONE}  <${item.component}${attrs(item)}>${label(item.role)}</${item.component}>`
      : `${ZONE}  <${item.component}${attrs(item)} />`).join('\n')
    return `${ZONE}<!-- ${zone.purpose} -->\n${ZONE}<section class="${cssClass}__${zone.name}" aria-label="${zone.name}">\n${inner}\n${ZONE}</section>`
  }).join('\n\n')

  const container = shell ? 'div' : 'main'
  const open = shell ? `<${shell.component}${shell.props}>\n  ` : ''
  const close = shell ? `\n</${shell.component}>` : ''

  const script = `<script lang="ts">
${importLines.length ? importLines.map(l => '  ' + l).join('\n') + '\n\n' : ''}${[
  `  /* Generated from ${specFile} against the ${profile} profile.`,
  `   * Zones, components and props come from the agreed spec; the file's shape is`,
  `   * this repository's own, measured from ${screens} existing screen(s).`,
  `   *`,
  `   * Written for ${era.runes ? 'Svelte 5 runes' : 'pre-runes Svelte'}, decided from ${era.from}.`,
  `   *`,
  `   * Agreed states:`,
  statesComment ? statesComment.split('\n').map(l => '  ' + l.replace(/^ \*/, ' *')).join('\n') : '   *   none specified',
  ...(cautions?.length ? [
    `   *`,
    `   * Written against these measured shortfalls rather than with them:`,
    ...cautions.map(c => `   *   ${c.pattern} — ${c.measured}`),
  ] : []),
  `   */`,
].join('\n')}

  type Row = { id: string }

${stateBody.split('\n').map(l => l ? '  ' + l : l).join('\n')}
</script>`

  // One indent, computed once, so the container and everything inside it agree
  // instead of being separate hand-counted guesses.
  const OUT = shell ? '  ' : ''
  const markup = `${open}<${container} class="${cssClass}">
${IN}{#if state}
${IN}  <p class="${cssClass}__state" role={state.key === 'error' ? 'alert' : undefined}>{state.message}</p>
${IN}{:else}
${zoneMarkup}
${IN}{/if}
${OUT}</${container}>${close}`

  const style = styleMode === 'inline'
    ? `\n\n<style>\n${css(cssClass, zones, ctx.spacing)}</style>`
    : ''

  return {
    body: `${script}\n\n${markup}${style}\n`,
    css: styleMode === 'imported' ? css(cssClass, zones, ctx.spacing) : undefined,
  }
}

/** Custom properties only. A literal here violates the project's own rule. */
function css(cssClass, zones, space = {}) {
  return `  .${cssClass} {
    display: flex;
    flex-direction: column;
${space.gap ? `  gap: var(${space.gap});` : '  /* no spacing token is declared in this project */'}
  }

  .${cssClass}__state {
    ${space.muted ? `color: var(${space.muted});` : '/* no muted foreground is declared in this project */'}
  }

${zones.map(z => `  .${cssClass}__${z.name} {
    display: flex;
${space.gap ? `  gap: var(${space.gap});` : '  /* no spacing token is declared in this project */'}
  }`).join('\n\n')}
`
}

/**
 * The test, in the harness this repository already uses.
 *
 * @param ctx.mounts 'testing-library' | 'client'
 */
export function emitSvelteTest({ name, importPath, mounts, cssClass }) {
  const lib = mounts === 'testing-library'
    ? "import { cleanup, render } from '@testing-library/svelte'"
    : "import { mount, unmount } from 'svelte'"

  // What is true on mount, which is the empty state — the screen is generated with no
  // data and the zones render only when there is some. This asserted a zone by role
  // and failed with "unable to find an accessible element with the role region", on a
  // screen behaving exactly as designed.
  const renders = mounts === 'testing-library'
    ? `    const { container } = render(${name})
    expect(container.firstElementChild).not.toBeNull()`
    : `    const host = document.createElement('div')
    const app = mount(${name}, { target: host })
    expect(host.querySelector('.${cssClass}')).not.toBeNull()
    unmount(app)`

  // Through the render result, not a global `screen` — the import was trimmed to what
  // the file uses and `screen.getByText` became a call on nothing.
  const empty = mounts === 'testing-library'
    ? `    const { getByText } = render(${name})
    expect(getByText('Nothing here yet.')).toBeTruthy()`
    : `    const host = document.createElement('div')
    const app = mount(${name}, { target: host })
    expect(host.textContent).toContain('Nothing here yet.')
    unmount(app)`

  return `import { ${mounts === 'testing-library' ? 'afterEach, ' : ''}describe, expect, it } from 'vitest'
${lib}
import ${name} from '${importPath}'

/* The promises this screen makes that only running code can prove: it renders, and
 * it says something when there is nothing to show. The spec agreed both; without a
 * test they are sentences in a file.
 *
 * What is NOT asserted here: that it looks right. No mounted test can see that, and
 * a test that claims to is the reason nobody trusts the suite.
 */
describe('${name}', () => {${mounts === 'testing-library' ? `
  // Registered rather than relied on: Testing Library clears the document between
  // tests only where the runner exposes a global \`afterEach\`, and without it the
  // second render finds the first one's output as well — "found multiple elements",
  // on a screen that is perfectly correct.
  afterEach(cleanup)
` : ''}
  it('mounts', () => {
${renders}
  })

  it('says something when there is nothing to show', () => {
${empty}
  })
})
`
}
