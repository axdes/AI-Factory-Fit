/**
 * A screen as a Vue single-file component, in the shape this repository writes them.
 *
 * A second emitter rather than a switch inside the first one. The two frameworks
 * disagree about more than syntax: state is refs and a computed rather than local
 * variables and a function, the shell takes a slot rather than children, styles
 * belong in a block inside the file rather than beside it, and the conditional is
 * an attribute rather than a ternary. Threading all of that through one template
 * string produces a file that is neither idiom.
 *
 * What is NOT duplicated is the part that decides anything: the zones and their
 * components come from the same resolved spec, the required props come from the
 * same registry, and the contract from `.ds/conventions.json` outranks the
 * measurement here exactly as it does there. This file only knows how to write.
 *
 * The limit is stated rather than worked around: this writes `<script setup>` and
 * nothing else. A repository on the Options API is told so and no file is written,
 * because a screen in the wrong idiom is a screen somebody has to rewrite.
 */

/** `ArchivedMemosSeaPage` → `archived-memos-sea`, the same class the React path uses. */
export const VUE_CAN_WRITE = {
  // The one declaration form this emitter produces.
  'component export': ['script setup'],
  'file structure': ['flat Name.vue'],
  // Scoped, unscoped, or a stylesheet beside the component. `<style module>` is a
  // different contract for class names and is not approximated here.
  styling: ['SFC <style scoped>', 'SFC <style>', 'stylesheet imported', 'class, styles elsewhere'],
  'sizing values': ['from tokens'],
  'colour values': ['from tokens'],
  // The generated screen declares no props and no handlers of its own, so a rule
  // about either is neither honoured nor broken.
  'props declaration': undefined,
  'handler naming': undefined,
  'internal imports': undefined,
  'user-facing text': undefined,
  'test placement': undefined,
}

/**
 * @param ctx.name           component name, e.g. `ArchivedMemosSeaPage`
 * @param ctx.cssClass       block class, e.g. `archived-memos-sea`
 * @param ctx.zones          resolved zones: [{ name, purpose, items: [{ role, component, props }] }]
 * @param ctx.spec           the agreed spec (states, title, id)
 * @param ctx.imports        [{ what, from, byDefault }] for every component used
 * @param ctx.shell          { component, props } or undefined
 * @param ctx.styleMode      'scoped' | 'plain' | 'imported' | 'none'
 * @param ctx.usesI18n       whether text goes through i18n here
 * @param ctx.propsFor       (item) => [{ name, value, expression }], required props included
 * @param ctx.takesSlot      (component) => boolean
 * @param ctx.label          (role) => the text to put in the slot
 * @param ctx.statesComment  the agreed states, already formatted as comment lines
 * @param ctx.cautions       measured shortfalls this was written against
 * @param ctx.screens        how many existing screens the shape came from
 * @param ctx.specFile       the spec's filename, for the provenance comment
 * @param ctx.profile        profile id, for the provenance comment
 */
export function emitVue(ctx) {
  const {
    name, cssClass, zones, spec, imports, shell, styleMode, usesI18n,
    propsFor, takesSlot, label, statesComment, cautions, screens, specFile, profile,
  } = ctx

  const anyLabel = zones.some(z => z.items.some(i => takesSlot(i.component)))
  const reactive = ['ref', 'computed']

  const importLines = [
    `import { ${reactive.join(', ')} } from 'vue'`,
    ...(styleMode === 'imported' ? [`import './${name}.css'`] : []),
    ...(usesI18n && anyLabel ? ["import { useI18n } from 'vue-i18n'"] : []),
    ...imports.map(i => i.byDefault
      ? `import ${i.what} from '${i.from}'`
      : `import { ${i.what} } from '${i.from}'`),
  ]

  // States as an attribute, not as a comment above the component. A screen whose
  // empty case is described in prose has no empty case: the description does not
  // render, and the first user to arrive with no data sees the loading frame.
  const stateBody = `const items = ref<Row[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const state = computed(() => {
  if (loading.value) return { key: 'loading', message: 'Loading…' }
  if (error.value) return { key: 'error', message: 'Something went wrong.' }
  if (items.value.length === 0) return { key: 'empty', message: 'Nothing here yet.' }
  return undefined
})`

  // One indent for everything inside the container, so the template and the zones
  // agree instead of being two hand-counted guesses.
  const shellOpen = shell ? `  <${shell.component}${shell.props}>\n` : ''
  const shellClose = shell ? `\n  </${shell.component}>` : ''
  const container = shell ? 'div' : 'main'
  const indent = shell ? '    ' : '  '
  // Two levels in: the zones sit inside <template v-else>, not beside it.
  const IN = indent + '    '

  // Vue spells an attribute two ways and the difference is not cosmetic: a bound
  // attribute takes an expression, a plain one takes a string. Handed a value the
  // React path had already spelled as `{[]}`, this wrote `rows={[]}` into a template
  // — JSX in a file that is not JSX, which does not parse. So the emitter is given
  // values and does its own spelling.
  const attrs = (item) => propsFor(item)
    .map(p => p.expression ? ` :${p.name}="${p.value}"` : ` ${p.name}="${p.value}"`)
    .join('')

  const zoneMarkup = zones.map(zone => {
    const inner = zone.items.map(item => takesSlot(item.component)
      ? `${IN}  <${item.component}${attrs(item)}>${label(item.role)}</${item.component}>`
      : `${IN}  <${item.component}${attrs(item)} />`).join('\n')
    return `${IN}<!-- ${zone.purpose} -->\n${IN}<section class="${cssClass}__${zone.name}" aria-label="${zone.name}">\n${inner}\n${IN}</section>`
  }).join('\n\n')

  const script = `<script lang="ts" setup>
${importLines.join('\n')}

/* Generated from ${specFile} against the ${profile} profile.
 * Zones, components and props come from the agreed spec; the file's shape is
 * this repository's own, measured from ${screens} existing screen(s).
 *
 * Agreed states:
${statesComment || ' *   none specified'}
${cautions?.length ? ` *
 * Written against these measured shortfalls rather than with them:
${cautions.map(c => ` *   ${c.pattern} — ${c.measured}`).join('\n')}` : ''}
 */

type Row = { id: string }
${usesI18n && anyLabel ? "\nconst { t } = useI18n()\n" : ''}
${stateBody}
</script>`

  const template = `<template>
${shellOpen}${indent}<${container} class="${cssClass}">
${indent}  <p
${indent}    v-if="state"
${indent}    class="${cssClass}__state"
${indent}    :role="state.key === 'error' ? 'alert' : undefined"
${indent}  >{{ state.message }}</p>
${indent}  <template v-else>
${zoneMarkup}
${indent}  </template>
${indent}</${container}>${shellClose}
</template>`

  const style = styleMode === 'scoped' || styleMode === 'plain'
    ? `\n\n<style${styleMode === 'scoped' ? ' scoped' : ''}>\n${css(cssClass, zones, ctx.spacing)}</style>`
    : ''

  return {
    body: `${script}\n\n${template}${style}\n`,
    // Only written when the convention puts styles outside the component.
    css: styleMode === 'imported' ? css(cssClass, zones, ctx.spacing) : undefined,
  }
}

/** Custom properties only. A literal here is a violation of the project's own rule. */
function css(cssClass, zones, space = {}) {
  return `.${cssClass} {
  display: flex;
  flex-direction: column;
${space.gap ? `  gap: var(${space.gap});` : '  /* no spacing token is declared in this project */'}
}

.${cssClass}__state {
  ${space.muted ? `color: var(${space.muted});` : '/* no muted foreground is declared in this project */'}
}

${zones.map(z => `.${cssClass}__${z.name} {
  display: flex;
${space.gap ? `  gap: var(${space.gap});` : '  /* no spacing token is declared in this project */'}
}`).join('\n\n')}
`
}

/**
 * The test, in the harness this repository already uses.
 *
 * @param ctx.name        component name
 * @param ctx.importPath  path to the screen from where the test will sit
 * @param ctx.mounts      'test-utils' | 'testing-library'
 * @param ctx.zones       resolved zones, for what to assert on
 */
export function emitVueTest({ name, importPath, mounts, zones }) {
  const lib = mounts === 'testing-library'
    ? `import { render, screen } from '@testing-library/vue'`
    : `import { mount } from '@vue/test-utils'`

  const renders = mounts === 'testing-library'
    ? `    render(${name})
    expect(screen.getByRole('region', { name: 'header' })).toBeTruthy()`
    : `    const wrapper = mount(${name})
    expect(wrapper.find('.${name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}').exists()).toBe(true)`

  const empty = mounts === 'testing-library'
    ? `    render(${name})
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()`
    : `    const wrapper = mount(${name})
    expect(wrapper.text()).toContain('Nothing here yet.')`

  return `import { describe, expect, it } from 'vitest'
${lib}
import ${name} from '${importPath}'

/* The promises this screen makes that only running code can prove: it renders, and
 * it says something when there is nothing to show. The spec agreed both; without a
 * test they are sentences in a file.
 *
 * What is NOT asserted here: that it looks right. No mounted test can see that, and
 * a test that claims to is the reason nobody trusts the suite.
 */
describe('${name}', () => {
  it('renders its zones', () => {
${renders}
  })

  it('says something when there is nothing to show', () => {
${empty}
  })
})
`
}
