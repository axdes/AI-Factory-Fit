/**
 * When a stored scan was taken, and under which rules.
 *
 * A scan on disk reads as a fact about the project. It is a fact about the project
 * *as the rules of that day counted it* — and the rules change. A stored scan of
 * vue-vben-admin listed `app.vue` and two layouts as screens; today's rule excludes
 * all three, correctly. Nothing in the file said so, and the stale number cost a
 * real search for a defect that had already been fixed.
 *
 * So every scan carries the date it was taken and a fingerprint of the rules that
 * took it. The fingerprint is deliberately narrow: the detector's own source and
 * the local modules it imports, transitively — not the whole repository. Editing an
 * emitter must not mark a security scan stale; editing the security detector must.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Relative specifiers only — a package is pinned by the lockfile, not by us. */
const LOCAL = /^\.{1,2}\//

/** Every local module this file reaches, itself included, in a stable order. */
function graph(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return seen
  seen.add(entry)
  const text = readFileSync(entry, 'utf8')
  const here = dirname(entry)
  // Static imports and re-exports. A dynamic import() inside a branch is not
  // followed: it may not run, and claiming it as a rule that produced this number
  // would be the same overreach this module exists to prevent.
  for (const m of text.matchAll(/^\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]
    if (!LOCAL.test(spec)) continue
    const at = resolve(here, spec)
    graph(extname(at) ? at : `${at}.mjs`, seen)
  }
  return seen
}

/**
 * Which version of the measured code this was measured against.
 *
 * SARIF, the OASIS standard for static-analysis results, requires that a reference
 * to a file under version control carry enough information — a commit id — to
 * retrieve the version that was actually analysed. The reason is the one this file
 * exists for, pointed at the other half of the problem: a rules fingerprint answers
 * "did the ruler change", and answers nothing about whether the thing being measured
 * did. A scan can carry today's date and today's rules and still describe code from
 * forty commits ago.
 *
 * A dirty tree is reported as dirty rather than smoothed into its commit. What was
 * measured then was the commit plus uncommitted edits, and the commit alone does not
 * identify it — claiming otherwise would make the stamp confidently wrong, which is
 * worse than absent.
 */
function subjectOf(dir) {
  if (!dir) return undefined
  const git = (args) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
  }).trim()
  try {
    const commit = git(['rev-parse', '--short', 'HEAD'])
    // Whose repository that commit belongs to. `git` answers from the nearest
    // enclosing checkout, and a client's code unpacked inside another repository —
    // a consultant's own working folder, say — would otherwise be stamped with that
    // repository's commit. The stamp would be confidently wrong, which is the one
    // outcome worse than no stamp. Recorded, so a reader can see when the commit is
    // not the measured directory's own.
    const top = git(['rev-parse', '--show-toplevel'])
    const owner = resolve(top) === resolve(dir) ? undefined : { repo: top }
    // `--porcelain` is empty exactly when nothing is staged or modified. Untracked
    // files count: a scan walks the working tree, so a file git has never seen was
    // still measured.
    const dirty = git(['status', '--porcelain']) !== ''
    return dirty
      ? { commit, dirty: true, ...owner, why: 'measured with uncommitted changes, so the commit alone does not identify what was read' }
      : { commit, dirty: false, ...owner }
  } catch {
    // Not a repository, no git, or a HEAD that does not resolve — an empty repo has
    // no commit to name. Unknown is recorded as unknown.
    return { unknown: 'the measured directory is not a git checkout, so the version read cannot be named' }
  }
}

/**
 * The stamp to store alongside a scan.
 *
 * @param metaUrl the writing script's own `import.meta.url`
 * @param subject the directory that was measured, when there is one
 */
export function taken(metaUrl, subject, { dated = true } = {}) {
  const entry = fileURLToPath(metaUrl)
  const files = [...graph(entry)].sort()
  const h = createHash('sha256')
  for (const f of files) h.update(readFileSync(f))
  return {
    // Date, not timestamp: the useful question is "how many days old", and a
    // second-precision time invites a diff on every re-run of an unchanged scan.
    //
    // Some artifacts drop it entirely. An evidence pack is meant to be committed and
    // diffed, and the reviewer's question is about this tree, not about when it was
    // read — a date would make two runs over an unchanged tree differ for no reason.
    // The commit and the rules fingerprint stay: both are stable for an unchanged
    // tree, and both are exactly what a reviewer needs.
    ...(dated ? { on: new Date().toISOString().slice(0, 10) } : {}),
    rules: h.digest('hex').slice(0, 12),
    // Named so a reader can tell what the fingerprint covers without guessing.
    from: `${files.length} source file(s) of this detector`,
    of: subjectOf(subject),
  }
}

/**
 * Whether the measured code has moved on since, or undefined when it has not.
 * Separate from `staleness` because the two go stale independently and the fix
 * differs: changed rules mean re-run the detector, changed code means the numbers
 * are about a version nobody is looking at any more.
 */
export function movedSince(stored, dir) {
  const of = stored?.of
  if (!of) return undefined
  if (of.unknown) return undefined
  const now = subjectOf(dir)
  if (!now || now.unknown) return undefined
  // A commit belonging to an enclosing repository says nothing about whether the
  // measured directory changed. Saying "the checkout has moved" from it would be a
  // claim about code the commit does not cover.
  if (of.repo) return `the commit recorded (${of.commit}) belongs to ${of.repo}, not to the measured directory, so whether that code moved is unknown`
  if (of.dirty) return `taken against ${of.commit} with uncommitted changes, so what was read cannot be reconstructed`
  if (now.commit !== of.commit) return `taken against ${of.commit}; the checkout is now at ${now.commit}`
  return now.dirty ? `taken against ${of.commit}, which is still the checkout, but there are uncommitted changes since` : undefined
}

/**
 * What to say about a scan being read back, or undefined when there is nothing
 * to say. Undefined is the common case and must stay silent: a caveat printed on
 * every current scan is a caveat nobody reads.
 *
 * @param stored   the `taken` block off the stored scan, if it has one
 * @param metaUrl  the reading script's `import.meta.url`, when it is the same
 *                 detector; otherwise pass the writer's path
 */
export function staleness(stored, metaUrl) {
  if (!stored?.rules) {
    return 'this scan predates rule fingerprinting, so which rules counted it is unknown'
  }
  const now = taken(metaUrl)
  if (now.rules === stored.rules) return undefined
  return stored.on
    ? `the rules changed since this scan was taken on ${stored.on}; the numbers below were counted by the older ones`
    : 'the rules changed since this was taken; the numbers below were counted by the older ones'
}
