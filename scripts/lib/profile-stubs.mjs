/**
 * The tiers an adapter cannot fill, written down rather than left absent.
 *
 * An adapter extracts facts. Level, surface, a description of what a component is
 * FOR, and which of two confusable components to reach for are in none of the
 * sources any adapter reads — they are authored, once, by a person.
 *
 * Leaving those files out is not the same as saying they are unwritten, and the
 * difference is not academic: `validate-profile` distinguishes MALFORMED from
 * UNWRITTEN, and reads the distinction from the profile's own `tiers` block. A
 * profile that omits the block claims nothing, so every missing description counts
 * as a defect. A freshly adapted Vue registry came out as "FAILED — 144 problem(s)"
 * one command after the tool itself said `Next: ds bind`, with nothing wrong.
 *
 * This is the one place that decides what an unfinished profile looks like, so the
 * three adapters cannot drift into three different answers.
 */
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param outDir       the profile directory, already created
 * @param id           the profile id
 * @param adapter      the script that produced it, for the record
 * @param library      { name, kind, source }
 * @param facts        one line saying what WAS extracted and from where
 * @param counts       whatever the adapter counted
 * @returns { kept } the authored files that already existed and were left untouched
 */
export function writeUnwrittenTiers(outDir, { id, adapter, library, facts, counts }) {
  const put = (file, data) => writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + '\n')

  // The three files below hold work a person did by hand, so they are written once
  // and never again. One adapter wrote them unconditionally, which meant re-running
  // it over a profile whose 323 levels had been assigned discarded all of them —
  // silently, and reported as a successful adapt. An adapter refreshes facts; it has
  // no business touching the tiers it cannot produce.
  const once = (file, data) => {
    if (existsSync(join(outDir, file))) return false
    put(file, data)
    return true
  }

  // Pure adapter output: rewritten every run, because that is what it describes.
  put('profile.json', {
    schemaVersion: 1,
    id,
    library,
    adapter,
    tiers: {
      facts,
      policy: 'UNWRITTEN — level, surface and status, which no source an adapter reads records',
      judgment: 'UNWRITTEN — descriptions and role bindings, the tier no library ships',
    },
    counts,
  })

  // Written empty and valid rather than left absent, so `validate-profile` can say
  // what is missing instead of failing to load the profile at all.
  const kept = []
  // A token layer is extracted from stylesheets, which is a different pass from
  // reading components. Where it has not run, the file is written empty rather than
  // left out: `validate-profile` requires it, and a missing file made a Vue registry
  // read as malformed when the only true statement is that nobody has extracted its
  // tokens yet. An adapter that DOES extract them writes the real file first, and
  // this leaves it alone.
  if (!once('tokens.json', {
    $description: 'No token layer has been extracted into this profile. That is a pass that has not run, not a project without tokens — run the token extraction against this project\'s stylesheets and this file is replaced.',
  })) kept.push('tokens.json')
  if (!once('policy.json', {
    _: 'Level and surface per component. Assigned once for the library and then reusable across every client on this stack. Empty until someone assigns them.',
    schemaVersion: 1, levels: {}, surfaces: {},
  })) kept.push('policy.json')
  if (!once('judgment.json', {
    _: 'Which of two confusable components to reach for, and why. Authored; no library publishes this.',
    schemaVersion: 1, twins: { pairs: {} },
  })) kept.push('judgment.json')
  if (!once('rules.json', {
    _: 'How the shared rule catalogue is expressed for this library. Until expressionKey names a set of expressions, every translatable rule is a disabled rule.',
    schemaVersion: 1, catalogue: '../../rules/catalogue.json', expressionKey: null,
  })) kept.push('rules.json')

  // Named, so a re-run says what it left alone rather than looking like it wrote
  // everything. Silence here is what made the overwrite invisible.
  return { kept }
}
