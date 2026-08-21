/**
 * A screen as an Angular component, in the shape this repository writes them.
 *
 * The fourth emitter, and the first that has to follow THREE independent decisions
 * at once. Angular is running three migrations that are not synchronised, so a
 * repository is routinely standalone and still on the decorator for its inputs and
 * still on the structural directives in its templates:
 *
 *   component export       standalone            ·  NgModule declaration
 *   props declaration      input() signals       ·  @Input() decorator
 *   template control flow  @if blocks            ·  *ngIf directives
 *
 * Each is read from the contract separately. Picking one and deriving the other two
 * from it is the mistake that produces a file no half of the team recognises.
 *
 * A component here is also more than one file: the class, usually a template beside
 * it, usually a stylesheet beside that. Which of those exist is the `styling`
 * decision, and it is followed rather than chosen.
 */

/** What this emitter can produce, per dimension. */
export const ANGULAR_CAN_WRITE = {
  'component export': ['standalone', 'standalone by default', 'NgModule declaration'],
  'template control flow': ['@if blocks', '*ngIf directives'],
  styling: ['styleUrls', 'inline styles'],
  'file structure': ['Folder/name.component.ts', 'flat name.component.ts'],
  'colour values': ['from tokens'],
  'sizing values': ['from tokens'],
  // The generated screen declares no inputs of its own, so a rule about how inputs
  // are declared is neither honoured nor broken by it. The state style still follows
  // the same axis, because that is the evidence available for which era this is.
  'props declaration': undefined,
  'handler naming': undefined,
  'internal imports': undefined,
  'user-facing text': undefined,
  'test placement': undefined,
}

/** `ArchivedMemosSeaComponent` → `app-archived-memos-sea`, the CLI's own convention. */
export const angularSelector = (name, prefix = 'app') =>
  `${prefix}-${name.replace(/Component$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`

/**
 * @param ctx.name         class name, e.g. `ArchivedMemosSeaComponent`
 * @param ctx.fileBase     file stem, e.g. `archived-memos-sea.component`
 * @param ctx.cssClass     block class
 * @param ctx.zones        resolved zones from the agreed spec
 * @param ctx.imports      [{ what, from }] every component used
 * @param ctx.shell        { component, props } or undefined
 * @param ctx.standalone   'standalone' | 'module'
 * @param ctx.signals      whether state is written with signals
 * @param ctx.blocks       whether control flow uses @if rather than *ngIf
 * @param ctx.styleMode    'styleUrls' | 'inline'
 * @param ctx.selector     the element selector to declare
 * @param ctx.propsFor     (item) => [{ name, value, expression }]
 * @param ctx.takesSlot    (component) => boolean
 * @param ctx.label        (role) => the text to put in the slot
 */
export function emitAngular(ctx) {
  const {
    name, fileBase, cssClass, zones, imports, shell, standalone, signals, blocks,
    styleMode, selector, propsFor, takesSlot, label,
    statesComment, cautions, screens, specFile, profile,
  } = ctx

  // Angular binds an expression with square brackets and a plain attribute without.
  // Handing it a value already spelled for JSX would put `rows={[]}` into a template
  // that does not parse it.
  const attrs = (item) => propsFor(item)
    .map(p => p.expression ? ` [${p.name}]="${p.value.replace(/"/g, "'")}"` : ` ${p.name}="${p.value}"`)
    .join('')

  // A component is reached by its SELECTOR here, not by its class name. `<UiHeading>`
  // is an unknown element to the compiler and renders nothing — the browser shows an
  // empty page and the only complaint is a warning nobody reads. The selector is not
  // in the registry, so it is read from the component's own source; where that cannot
  // be found the caller is told rather than a prefix being invented.
  const tag = (component) => ctx.selectorOf(component) ?? component

  const IN = shell ? '    ' : '  '
  // How the template reads the state: a signal is called, a plain field is not.
  const read = signals ? 'state()' : 'state'
  // The zones sit inside the branch, not beside it. Two hand-counted indents that
  // disagree read as a file nobody looked at after generating.
  const ZONE = IN + '  '
  const zoneMarkup = zones.map(zone => {
    const inner = zone.items.map(item => takesSlot(item.component)
      ? `${ZONE}  <${tag(item.component)}${attrs(item)}>${label(item.role)}</${tag(item.component)}>`
      : `${ZONE}  <${tag(item.component)}${attrs(item)} />`).join('\n')
    return `${ZONE}<!-- ${zone.purpose} -->\n${ZONE}<section class="${cssClass}__${zone.name}" aria-label="${zone.name}">\n${inner}\n${ZONE}</section>`
  }).join('\n\n')

  // The third decision, and it is not cosmetic: `@if` does not exist before 17 and
  // the structural directives need CommonModule imported to work at all.
  const branch = blocks
    ? `${IN}@if (state()) {
${IN}  <p class="${cssClass}__state" [attr.role]="state()?.key === 'error' ? 'alert' : null">{{ state()?.message }}</p>
${IN}} @else {
${zoneMarkup}
${IN}}`
    // A signal is a function, in the template as much as in the class. The `@if`
    // branch above calls it and the directive branch did not — `state?.key` on a
    // `Signal<…>` is a property that does not exist, and the compiler said so on a
    // file the conventions gate had just approved. The two branches choose the
    // control flow, not whether state is a signal.
    : `${IN}<p *ngIf="${read}; else zones" class="${cssClass}__state" [attr.role]="${read}?.key === 'error' ? 'alert' : null">{{ ${read}?.message }}</p>
${IN}<ng-template #zones>
${zoneMarkup}
${IN}</ng-template>`

  const container = shell ? 'div' : 'main'
  const open = shell ? `<${shell.component}${shell.props}>\n  ` : ''
  const close = shell ? `\n</${shell.component}>` : ''
  const template = `${open}<${container} class="${cssClass}">
${branch}
${shell ? '  ' : ''}</${container}>${close}\n`

  // State, on the same axis the inputs were measured on. A project writing `input()`
  // is on 17.1 or later and writes `signal()` for state; one on the decorator is not
  // necessarily anywhere `signal()` exists.
  const stateBody = signals
    ? `  readonly items = signal<Row[]>([])
  readonly loading = signal(false)
  readonly error = signal<string | null>(null)

  readonly state = computed(() =>
    this.loading() ? { key: 'loading', message: 'Loading…' }
      : this.error() ? { key: 'error', message: 'Something went wrong.' }
      : this.items().length === 0 ? { key: 'empty', message: 'Nothing here yet.' }
      : undefined,
  )`
    : `  items: Row[] = []
  loading = false
  error: string | null = null

  get state(): { key: string, message: string } | undefined {
    if (this.loading) return { key: 'loading', message: 'Loading…' }
    if (this.error) return { key: 'error', message: 'Something went wrong.' }
    if (this.items.length === 0) return { key: 'empty', message: 'Nothing here yet.' }
    return undefined
  }`

  const angularImports = ['Component', ...(signals ? ['signal', 'computed'] : [])]
  // `*ngIf` is a CommonModule directive and a standalone component that uses one
  // without importing it renders nothing and says so only at runtime.
  // The shell's class, not the selector it is written as in the template. `shell.component`
  // is what the markup uses — on Angular that is `ds-page-shell` — and putting it in an
  // import or a decorator array produced `import { ds-page-shell }`, which is not an
  // identifier and does not parse.
  const shellClass = shell ? (ctx.shellClass ?? shell.component) : undefined
  const declaredImports = [
    ...(!blocks ? ['CommonModule'] : []),
    ...imports.map(i => i.what),
    ...(shellClass && !imports.some(i => i.what === shellClass) ? [shellClass] : []),
  ]

  const importLines = [
    `import { ${angularImports.join(', ')} } from '@angular/core'`,
    ...(!blocks ? ["import { CommonModule } from '@angular/common'"] : []),
    ...imports.map(i => `import { ${i.what} } from '${i.from}'`),
    ...(shellClass && !imports.some(i => i.what === shellClass) && ctx.shellFrom
      ? [`import { ${shellClass} } from '${ctx.shellFrom}'`] : []),
  ]

  const decorator = [
    `  selector: '${selector}',`,
    ...(standalone === 'standalone'
      ? [`  standalone: true,`, declaredImports.length ? `  imports: [${declaredImports.join(', ')}],` : undefined]
      // A component the module declares must say so from 19, where standalone is the
      // default and silence means the new form.
      : [`  standalone: false,`]),
    styleMode === 'inline'
      ? `  template: \`\n${template.split('\n').map(l => l ? '    ' + l : l).join('\n')}  \`,`
      : `  templateUrl: './${fileBase}.html',`,
    styleMode === 'inline'
      ? `  styles: [\`\n${css(cssClass, zones, ctx.spacing).split('\n').map(l => l ? '    ' + l : l).join('\n')}  \`],`
      // Only where a stylesheet is actually written, and with the extension this
      // project uses. This pointed at `./x.component.scss` in a project that writes
      // `.css` and where no stylesheet was emitted at all: `NG2008: Could not find
      // stylesheet file`, on a screen otherwise correct.
      : ctx.styleFile ? `  styleUrls: ['./${ctx.styleFile}'],` : undefined,
  ].filter(Boolean).join('\n')

  const body = `${importLines.join('\n')}

/* Generated from ${specFile} against the ${profile} profile.
 * Zones, components and props come from the agreed spec; the file's shape is this
 * repository's own, measured from ${screens} existing component(s).
 *
 * Three decisions, read from the contract separately because this ecosystem is
 * running three migrations that are not in step:
 *   declaration    ${standalone === 'standalone' ? 'standalone' : 'declared by an NgModule'}
 *   state          ${signals ? 'signals' : 'plain fields with a getter'}
 *   control flow   ${blocks ? '@if blocks' : '*ngIf directives'}
 *
 * Agreed states:
${statesComment || ' *   none specified'}
${cautions?.length ? ` *
 * Written against these measured shortfalls rather than with them:
${cautions.map(c => ` *   ${c.pattern} — ${c.measured}`).join('\n')}` : ''}
 */
@Component({
${decorator}
})
export class ${name} {
${stateBody}
}

// Declared here rather than imported from nowhere. Every other emitter writes this
// type beside the class it belongs to, and the one that referenced the row type
// without declaring it produced a component that does not compile — on a file the
// tool had just reported as conforming.
type Row = { id: string }
`

  return {
    body,
    template: styleMode === 'inline' ? undefined : template,
    css: styleMode === 'inline' ? undefined : css(cssClass, zones, ctx.spacing),
  }
}

/** Custom properties only. A literal here violates the project's own rule. */
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
 * @param ctx.harness 'testing-library' | 'testbed'
 */
export function emitAngularTest({ name, importPath, harness, cssClass }) {
  if (harness === 'testing-library') {
    return `import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/angular'
import { ${name} } from '${importPath}'

${HEADER}
describe('${name}', () => {
  it('renders its zones', async () => {
    await render(${name})
    expect(screen.getByRole('region', { name: 'content' })).toBeTruthy()
  })

  it('says something when there is nothing to show', async () => {
    await render(${name})
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
  })
})
`
  }

  return `import { describe, expect, it, beforeEach } from 'vitest'
import { TestBed } from '@angular/core/testing'
import { ${name} } from '${importPath}'

${HEADER}
describe('${name}', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [${name}] }).compileComponents()
  })

  it('renders its zones', () => {
    const fixture = TestBed.createComponent(${name})
    fixture.detectChanges()
    expect(fixture.nativeElement.querySelector('.${cssClass}')).not.toBeNull()
  })

  it('says something when there is nothing to show', () => {
    const fixture = TestBed.createComponent(${name})
    fixture.detectChanges()
    expect(fixture.nativeElement.textContent).toContain('Nothing here yet.')
  })
})
`
}

const HEADER = `/* The promises this screen makes that only running code can prove: it renders, and
 * it says something when there is nothing to show. The spec agreed both; without a
 * test they are sentences in a file.
 *
 * What is NOT asserted here: that it looks right. No mounted test can see that, and
 * a test that claims to is the reason nobody trusts the suite.
 */`
