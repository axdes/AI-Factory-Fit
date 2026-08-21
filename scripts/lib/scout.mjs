/**
 * Things built inside an application that belong in the shared library, and
 * things in the library that no application uses.
 *
 * The whole point of a shared system is that a thing built once is available
 * everywhere, and the failure mode is quiet: somebody needs a pill, a page
 * skeleton, an empty state, builds it inside their app because that is the
 * shortest path, and the next app builds it again. Nothing is red, nothing is
 * broken, and the library slowly stops being where components live.
 *
 * Nothing off the shelf catches this. A duplication tool sees copy-paste but not
 * intent; a dead-code tool sees unused exports but not code that should have been
 * shared. Three questions those tools cannot ask:
 *
 *   parallel     the same component name is defined in two or more places
 *                outside the library, and neither copy imports the library. Two
 *                people solved one problem twice.
 *   shadowing    a component defined outside the library has the name of one
 *                inside it. Either the library's version was not found, or it
 *                was found and rejected — both are worth a minute.
 *   unconsumed   a library component nothing imports. Reported, never failed: a
 *                library may ship ahead of demand. But a component nobody uses
 *                while applications hand-roll the same thing is the exact
 *                inversion this exists to surface.
 *
 * Every finding is a question. None of them is a defect on its own, and a report
 * that called them defects would be wrong about a library shipping ahead of its
 * consumers — which is a good thing that looks identical from here.
 */
import { relative, sep, basename } from 'node:path'

/**
 * Names that are not components even when capitalised. `const Component = as ?? 'div'`
 * is the polymorphic idiom, and counting it reported "Component" as built in
 * parallel across two markdown renderers.
 */
const NOT_A_COMPONENT = new Set(['Component', 'Comp', 'Element', 'Tag', 'Wrapper', 'Root', 'Provider', 'Context'])

/** Local components, by name, from files outside the library. */
function definedOutside(files, read, libraryPrefix, target) {
  const byName = new Map()
  for (const abs of files) {
    const rel = relative(target, abs).split(sep).join('/')
    if (libraryPrefix && rel.startsWith(libraryPrefix)) continue
    if (/\.(test|spec|stories)\./.test(rel)) continue
    const text = read(abs)
    // Declared here, not imported from anywhere: `export function Badge` or
    // `const Badge = (...) =>` followed by JSX somewhere in the file.
    for (const m of text.matchAll(/(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)|(?:export\s+)?const\s+([A-Z]\w*)\s*[:=]/g)) {
      const name = m[1] ?? m[2]
      if (!name || NOT_A_COMPONENT.has(name) || !/<[A-Za-z]/.test(text)) continue
      const seen = byName.get(name) ?? []
      seen.push({
        file: rel,
        importsLibrary: libraryPrefix ? text.includes(libraryPrefix.split('/').pop()) : false,
        text,
      })
      byName.set(name, seen)
    }
  }
  return byName
}

export function scout({ target, files, read, components, libraryPrefix }) {
  const registry = new Set(Object.keys(components ?? {}))
  const outside = definedOutside(files, read, libraryPrefix, target)

  const parallel = []
  const shadowing = []
  for (const [name, places] of outside) {
    const distinct = [...new Map(places.map(p => [p.file, p])).values()]
    if (registry.has(name)) {
      shadowing.push({ name, places: distinct.map(p => p.file) })
      continue
    }
    // Two or more places, none of them reaching for the library, and none of them
    // reaching for each other.
    //
    // That last clause matters: `LazyLocationPicker.tsx` and `LocationPicker.tsx`
    // both declare `LocationPicker`, and the first imports the second. That is one
    // component with a lazy wrapper, which is a pattern rather than a duplicate,
    // and calling it two solutions to one problem is exactly the noise that gets a
    // report ignored.
    // One of them IMPORTING the other, not merely mentioning its name. A file
    // always contains the name of the component it declares, and when two files
    // declare the same name that is also the other's basename — so a first version
    // found every parallel pair "dependent" on itself and reported nothing at all.
    const importsOther = (p, other) => {
      const stem = basename(other.file).replace(/\.[jt]sx$/, '')
      // Static and dynamic both. memos writes its lazy wrapper as
      // `lazyWithReload(() => import("./LocationPicker"))` — no `from` anywhere —
      // so reading only static imports called a wrapper and the thing it wraps
      // two independent solutions to one problem.
      return [...p.text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
        .some(m => m[1].split('/').pop().replace(/\.[jt]sx$/, '') === stem)
    }
    const independent = distinct.every(p => !distinct.some(other => other !== p && importsOther(p, other)))
    if (distinct.length >= 2 && distinct.every(p => !p.importsLibrary) && independent) {
      parallel.push({ name, places: distinct.map(p => p.file) })
    }
  }

  // What the applications actually import from the library.
  const imported = new Set()
  for (const abs of files) {
    const rel = relative(target, abs).split(sep).join('/')
    if (libraryPrefix && rel.startsWith(libraryPrefix)) continue
    const text = read(abs)
    for (const m of text.matchAll(/import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
      if (libraryPrefix && !m[2].includes(basename(libraryPrefix))) continue
      const clause = m[1].replace(/\btype\s+/g, '')
      const named = (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',')
      const byDefault = clause.replace(/\{[^}]*\}/, '').split(',')[0]
      for (const raw of [...named, byDefault]) {
        const clean = raw.trim().split(/\s+as\s+/).pop()?.trim()
        if (clean && /^[A-Z]\w*$/.test(clean)) imported.add(clean)
      }
    }
  }

  // A compound part is consumed by its own parent, inside the library, and is
  // never imported by an application on its own. Twenty of memos' fifty-nine came
  // back "unused" for that reason alone — DialogOverlay, DropdownMenuLabel and
  // the rest of the parts that only ever appear inside their own component.
  const usedInside = new Set(Object.values(components ?? {}).flatMap(c => c.uses ?? []))
  const unconsumed = [...registry]
    .filter(n => !imported.has(n) && !usedInside.has(n))
    .sort()

  return {
    parallel: parallel.sort((a, b) => b.places.length - a.places.length),
    shadowing,
    unconsumed,
    consumed: registry.size - unconsumed.length,
    registrySize: registry.size,
    // Without a library path there is no inside and no outside, and every one of
    // these questions is about the boundary between them.
    scoped: Boolean(libraryPrefix),
  }
}
