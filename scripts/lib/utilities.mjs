/**
 * The utility classes this project actually puts on a container.
 *
 * Written because the generator could not write for the majority of projects it
 * measures. Its styling repertoire was a stylesheet beside the module or a class
 * with the styles elsewhere, and a Tailwind project's contract asks for neither —
 * so on documenso, whose screens are 95% utility classes, it resolved every element
 * of the spec and then declined to write the file. Correct, and useless.
 *
 * What it must not do is invent the classes. `flex flex-col gap-4` is a guess about
 * somebody else's scale; on one real product `gap-4` is written 19 times and `gap-2`
 * 16, and which of those is the house answer is a fact about that repository and not
 * about Tailwind. So the ranking is measured, and where a slot has no measured
 * answer nothing is written for it.
 *
 * Containers only. Every screen is full of utilities on leaf elements — text sizes,
 * colours, borders — and copying those would produce a screen that looks like its
 * neighbours' contents rather than like their shape.
 */

/** Classes that arrange children, which is the only kind this reads. */
const DIRECTION = /^(flex-col|flex-row|flex-col-reverse|flex-row-reverse|grid-cols-\d+)$/
const DISPLAY = /^(flex|grid|inline-flex)$/
const GAP = /^gap(-x|-y)?-[\d.]+$/
const WIDTH = /^(w-full|max-w-[\w-]+|mx-auto|container)$/
const PADDING = /^p[xy]?-[\d.]+$/

/**
 * @param sources [{ text }] the screens already in this project
 * @returns { display, direction, gap, width, padding, measuredOn } — each value
 *          undefined where the project gives no answer
 */
export function utilities(sources) {
  const tally = { display: new Map(), direction: new Map(), gap: new Map(), width: new Map(), padding: new Map() }
  let containers = 0

  for (const { text } of sources) {
    // A container is an element whose class list arranges something. Reading every
    // `className` would count the leaf elements too, and those describe contents.
    for (const m of String(text ?? '').matchAll(/className=["']([^"']{3,200})["']/g)) {
      const classes = m[1].split(/\s+/).filter(Boolean)
      if (!classes.some(c => DISPLAY.test(c))) continue
      containers += 1
      for (const c of classes) {
        const into = DISPLAY.test(c) ? 'display'
          : DIRECTION.test(c) ? 'direction'
            : GAP.test(c) ? 'gap'
              : WIDTH.test(c) ? 'width'
                : PADDING.test(c) ? 'padding' : undefined
        if (into) tally[into].set(c, (tally[into].get(c) ?? 0) + 1)
      }
    }
  }

  // A slot answered once is not an answer. The same floor every distribution in this
  // tool is held to: a share over one observation is arithmetic.
  const top = (m) => {
    const ranked = [...m].sort((a, b) => b[1] - a[1])
    if (!ranked.length || ranked[0][1] < 2) return undefined
    return { value: ranked[0][0], uses: ranked[0][1], of: [...m.values()].reduce((n, v) => n + v, 0) }
  }

  return {
    containers,
    display: top(tally.display),
    direction: top(tally.direction),
    gap: top(tally.gap),
    width: top(tally.width),
    padding: top(tally.padding),
  }
}

/**
 * The class list for a screen's root, from what was measured and nothing else.
 *
 * Returns undefined when the project gave no display class to copy — there is then
 * no house shape here, and writing `flex flex-col` would be this tool inventing one.
 */
export function containerClasses(measured) {
  if (!measured?.display) return undefined
  return [measured.display, measured.direction, measured.gap, measured.width]
    .filter(Boolean)
    .map(x => x.value)
    .join(' ')
}

/** The class list for a zone inside that root: the same arrangement, without the page width. */
export function zoneClasses(measured) {
  if (!measured?.display) return undefined
  return [measured.display, measured.direction, measured.gap]
    .filter(Boolean)
    .map(x => x.value)
    .join(' ')
}
