/**
 * A page frame, proposed for a project that has none.
 *
 * This is the one thing in the tool that is not measured from the repository it
 * writes into, and it exists because refusing to answer is also an answer a client
 * cannot use. A project whose screens all build their own page out of raw elements
 * has no shape to copy — measured, not assumed — and the next screen written there
 * either invents a shape silently or is handed a proposal that says where it came
 * from. This is the second.
 *
 * Three rules keep it a proposal rather than a decision:
 *
 * 1. The places it offers are the ones the agreed spec asks for, not a set this
 *    file believes in. A spec with a header and a footer gets a frame with a header
 *    and a footer.
 * 2. Each place carries how many independent products were measured offering one,
 *    so a reader can tell `header` (7 of 8) from a name that appeared once.
 * 3. Everything else — how it exports, whether styles sit beside it, how props are
 *    declared — is this repository's own idiom, measured. A proposal written in a
 *    style the team does not use is refused for the wrong reason.
 *
 * It is written outside the source tree, so adopting it is a move and refusing it
 * is a delete, and neither is something this tool does on its own.
 */

/** The comment that travels with it, so the file explains itself away from here. */
function preamble({ regions, of, measuredOn, screens, unframed }) {
  const corroborated = regions.filter(r => r.products > 1)
  const local = regions.filter(r => r.products <= 1)
  return [
    '/**',
    ' * A page frame — PROPOSED, not measured from this repository.',
    ' *',
    ` * Of ${screens} screen(s) here, ${unframed} build their own page out of raw elements and`,
    ' * none render into a shared frame. There was no shape to copy, so this was',
    ' * written instead of one being invented silently inside the next screen.',
    ' *',
    ' * The places it offers come from the agreed spec. How common each one is, across',
    ` * ${of} independently measured product(s)${measuredOn ? ` (${measuredOn})` : ''}:`,
    ' *',
    ...corroborated.map(r => ` *   ${r.name.padEnd(12)} offered by ${r.products} of ${of}`),
    ...(local.length ? [
      ' *',
      ' * These the spec asks for and the measured products do not corroborate. That is',
      ' * not an argument against them — it means nothing outside this project supports',
      ' * them, and they are the ones to question first:',
      ...local.map(r => ` *   ${r.name}`),
    ] : []),
    ' *',
    ' * To adopt: move this into the source tree and have screens render into it.',
    ' * To refuse: delete it. Nothing here depends on it.',
    ' */',
  ].join('\n')
}

/**
 * @param ctx.name       component name
 * @param ctx.regions    [{ name, products }] the places, from the spec
 * @param ctx.of         how many products were measured
 * @param ctx.framework  'react' | 'vue' | 'svelte' | 'angular'
 * @param ctx.exportStyle 'default' | 'named'
 * @param ctx.stylesBeside whether this project keeps a stylesheet beside a component
 * @param ctx.selector   Angular element selector, where that is the framework
 * @param ctx.signals    Angular: input() signals rather than @Input()
 * @param ctx.runes      Svelte: $props() rather than export let
 */
export function emitFrame(ctx) {
  const { name, regions, framework } = ctx
  const head = preamble(ctx)
  const slots = regions.map(r => r.name)

  if (framework === 'vue') return { ext: '.vue', body: vue(head, name, slots, ctx) }
  if (framework === 'svelte') return { ext: '.svelte', body: svelte(head, name, slots, ctx) }
  if (framework === 'angular') return { ext: '.component.ts', body: angular(head, name, slots, ctx) }
  return { ext: '.tsx', body: react(head, name, slots, ctx), css: ctx.stylesBeside ? css(name, slots, ctx) : undefined }
}

/**
 * The stylesheet the frame imports, where this project keeps one beside a component.
 *
 * Written because without it the import dangles and the proposal does not compile
 * the moment somebody adopts it — a proposal that cannot be taken up is worse than
 * none, because refusing it looks like the tool's fault rather than a decision.
 *
 * It declares the class hooks and no arrangement. What was measured here is stated
 * in the comment instead: on a repository whose screens do not agree on a layout,
 * choosing one for them is the thing this tool exists not to do, and on one where
 * they do agree there is a frame already and no proposal to write.
 */
function css(name, slots, { arrangement, spacing = {} }) {
  const measured = arrangement?.distribution?.length
    ? arrangement.distribution.map(d => `${d.name} ×${d.count}`).join(', ')
    : undefined

  // The one visual decision this file is allowed to make, and only because it is
  // not a decision: a gap between the frame's places, set from the token this
  // repository already uses most for exactly that. Where no such token is
  // declared, nothing is written — a `var()` naming a custom property the project
  // does not declare is dropped silently by the browser, which is worse than a gap
  // that was never set.
  const gap = spacing.gap
  const note = gap
    ? spacing.borrowed?.gap
      // Where it came from decides the sentence. Saying "this repository" about a
      // token read off the client's live site is a small lie in the one file whose
      // whole job is to say where everything came from.
      ? ` * The gap is ${gap}, from the token layer beside this file — read from what\n * this client already ships, because this repository declares no spacing token of\n * its own. Adopt that file and the name resolves; delete it and this one falls back.`
      : ` * The gap is ${gap}, which is the spacing token this repository already reaches\n * for most often. Nothing else visual is set: colour, type and density are the\n * team's, and this file has no measurement to draw them from.`
    : ` * Nothing visual is set here. This repository declares no spacing token, so\n * there is nothing measured to draw on — extract one first (\`ds style <url>\`\n * from a live site, \`ds style:image <shot.png>\` from a screenshot) or write one.`

  return `/* Class hooks for ${name}. No arrangement is set here.
 *
 * ${measured
    ? `The screens in this repository arrange themselves with: ${measured}.\n * That is ${arrangement.verdict}, so it is not copied into the frame — pick one.`
    : 'No screen in this repository declares an arrangement, so there is none to copy.'}
 *
${note}
 */
.frame {
${gap ? `  gap: var(${gap});` : ''}
}

${slots.map(s => `.frame__${s} {\n}`).join('\n\n')}
`
}

function react(head, name, slots, { exportStyle, stylesBeside }) {
  const props = slots.map(s => `  ${s}?: ReactNode`).join('\n')
  const body = slots.map(s => `      {${s} ? <div className="frame__${s}">{${s}}</div> : undefined}`).join('\n')
  const decl = exportStyle === 'default'
    ? `export default function ${name}({ ${slots.join(', ')} }: Props) {`
    : `export function ${name}({ ${slots.join(', ')} }: Props) {`
  return `${stylesBeside ? `import './${name}.css'\n` : ''}import type { ReactNode } from 'react'

${head}
interface Props {
${props}
}

${decl}
  return (
    <main className="frame">
${body}
    </main>
  )
}
`
}

function vue(head, name, slots) {
  // A Vue frame declares its places as named slots; that is the declaration, and
  // nothing else in the file needs to name them.
  return `<script setup lang="ts">
${head}
</script>

<template>
  <main class="frame">
${slots.map(s => `    <div class="frame__${s}"><slot name="${s}" /></div>`).join('\n')}
  </main>
</template>
`
}

function svelte(head, name, slots, { runes }) {
  const script = runes
    ? `  ${head.split('\n').join('\n  ')}\n  const { ${slots.join(', ')} } = $props()`
    : `  ${head.split('\n').join('\n  ')}\n${slots.map(s => `  export let ${s} = undefined`).join('\n')}`
  return `<script lang="ts">
${script}
</script>

<main class="frame">
${slots.map(s => runes
    ? `  <div class="frame__${s}">{@render ${s}?.()}</div>`
    : `  <div class="frame__${s}"><slot name="${s}" /></div>`).join('\n')}
</main>
`
}

function angular(head, name, slots, { selector }) {
  return `import { Component } from '@angular/core'

${head}
@Component({
  selector: '${selector}',
  standalone: true,
  template: \`
    <main class="frame">
${slots.map(s => `      <div class="frame__${s}"><ng-content select="[${s}]"></ng-content></div>`).join('\n')}
    </main>
  \`,
})
export class ${name} {}
`
}
