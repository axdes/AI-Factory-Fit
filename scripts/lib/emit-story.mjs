/**
 * A Storybook story for the generated screen, in the shape this project already
 * writes stories.
 *
 * Why this belongs here at all: a story is the authored example. Everything else in
 * this tool treats golden examples as the tier no library ships and somebody has to
 * write — and a project with stories has already written them. Generating a screen
 * and not its story leaves the new screen out of the one index the team actually
 * browses, so the next person copies an older screen instead.
 *
 * Nothing is installed. If Storybook is not here, no story is written and that is
 * said once rather than passed over — a `.stories.tsx` in a repository with no
 * Storybook is a file nothing runs, which is worse than its absence because it
 * looks like coverage.
 *
 * The shape is measured, not assumed. CSF2 and CSF3 are both in wide use, the type
 * import differs per renderer, and a project that writes `satisfies Meta<typeof X>`
 * has a lint rule about it somewhere. Where there is no story to copy, the shape
 * used is stated as an assumption instead of presented as a measurement.
 */

const STORY_FILE = /\.stories\.([jt]sx?)$/

/**
 * What Storybook looks like here.
 *
 * @param present  whether Storybook is a dependency or has a config directory
 * @param stories  [{ path, text }] every existing story file
 * @param renderer the @storybook/* package this project depends on, if any
 */
export function measureStories({ present, stories, renderer }) {
  if (!present) return { present: false }
  if (!stories.length) {
    return {
      present: true,
      measured: false,
      // Current default rather than a guess dressed as a measurement, and the
      // report says which it is.
      csf: 3,
      suffix: '.stories.tsx',
      typed: 'satisfies',
      renderer: renderer ?? '@storybook/react',
      coLocated: true,
      autodocs: false,
    }
  }

  const majority = (values) => {
    const counts = {}
    for (const v of values.filter(v => v !== undefined)) counts[v] = (counts[v] ?? 0) + 1
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return entries.length ? entries[0][0] : undefined
  }

  return {
    present: true,
    measured: true,
    // CSF3 is an object with a default-exported meta; CSF2 exports functions.
    csf: Number(majority(stories.map(s => /export default (meta|\{)/.test(s.text) ? 3 : 2)) ?? 3),
    suffix: majority(stories.map(s => `.stories.${STORY_FILE.exec(s.path)?.[1] ?? 'tsx'}`)) ?? '.stories.tsx',
    // How the meta is typed. A project writing `satisfies` usually has a rule about
    // it, and an annotation where `satisfies` was expected is a lint failure on a
    // generated file, which reads as the generator being careless.
    typed: majority(stories.map(s => /satisfies Meta</.test(s.text) ? 'satisfies'
      : /:\s*Meta</.test(s.text) ? 'annotation' : 'none')) ?? 'none',
    renderer: majority(stories.map(s => /from ['"](@storybook\/[\w-]+)['"]/.exec(s.text)?.[1])) ?? renderer ?? '@storybook/react',
    // Beside the component, or gathered in a folder of their own.
    coLocated: majority(stories.map(s => /(^|[\\/])(stories|__stories__)[\\/]/.test(s.path) ? 'folder' : 'beside')) !== 'folder',
    autodocs: stories.some(s => /tags:\s*\[[^\]]*['"]autodocs['"]/.test(s.text)),
  }
}

/**
 * @param ctx.name        component name
 * @param ctx.shape       what `measureStories` returned
 * @param ctx.importPath  path to the screen from where the story will sit
 * @param ctx.byDefault   whether the screen is exported by default here
 * @param ctx.title       Storybook title, e.g. `Screens/ArchivedMemosSeaPage`
 * @param ctx.needsHost   what the screen mounts inside and a story cannot supply
 */
export function emitStory({ name, shape, importPath, title, needsHost, byDefault }) {
  // The screen's own export style, which the generator already decided from the
  // contract. A default import of a named export is a story that cannot resolve —
  // the same mismatch that was fixed once already between a screen and its test.
  const screenImport = byDefault
    ? `import ${name} from '${importPath}'`
    : `import { ${name} } from '${importPath}'`
  const typeImport = shape.csf === 3 && shape.typed !== 'none'
    ? `import type { Meta, StoryObj } from '${shape.renderer}'\n`
    : ''

  // Stated in the file, not only in the terminal. A story that mounts a screen
  // needing providers fails on the first context it reaches, and the person who
  // opens it should learn that from the file rather than from the stack trace.
  const caveat = needsHost
    ? `\n * ${name} renders inside ${needsHost}. Storybook has to supply the same thing —
 * a decorator in .storybook/preview, or this story will fail on the first context
 * it reaches. It is written rather than skipped so the gap is visible.`
    : ''

  const header = `/* The authored example for this screen, in this project's own story shape${shape.measured ? '' : '.\n * No existing story was found to copy, so this is CSF3 with the renderer from\n * package.json — an assumption, stated as one'}.
 *
 * What a story proves: that the screen mounts and that somebody can look at it.
 * What it does not: that it is correct. The spec's states are separate stories only
 * where the screen can be driven into them from props, and this one takes none.${caveat}
 */`

  if (shape.csf === 2) {
    return `${screenImport}

${header}
export default {
  title: '${title}',
  component: ${name},
}

export const Default = () => <${name} />
`
  }

  const metaTail = shape.typed === 'satisfies' ? ' satisfies Meta<typeof ' + name + '>'
    : shape.typed === 'annotation' ? '' : ''
  const metaHead = shape.typed === 'annotation' ? `const meta: Meta<typeof ${name}> = ` : 'const meta = '

  return `${typeImport}${screenImport}

${header}
${metaHead}{
  title: '${title}',
  component: ${name},${shape.autodocs ? "\n  tags: ['autodocs']," : ''}
}${metaTail}

export default meta
${shape.typed !== 'none' ? `\ntype Story = StoryObj<typeof meta>\n` : ''}
export const Default${shape.typed !== 'none' ? ': Story' : ''} = {}
`
}
