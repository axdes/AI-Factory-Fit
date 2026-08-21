/**
 * Rules attached to the files they are about, rather than to every task.
 *
 * The always-on contract is paid on every request by every agent, and the largest
 * one measured across eleven repositories was 1708 tokens of prose that a task
 * about a utility function did not need. Scoping is the current practice for
 * exactly this: `alwaysApply: false` plus a glob, and the rule loads only while
 * the agent is editing a file it matches.
 *
 * The question this answers is which rules deserve a scope, and the answer has to
 * be measured or it is somebody guessing at folder names again. A subtree earns a
 * scoped rule when it has SETTLED SOMEWHERE ELSE than the repository as a whole —
 * `components/` at 96% named exports inside a repository that is 73% default is a
 * real local convention, and an agent editing there should be told the local one.
 *
 * Where a subtree merely agrees with the repository, no rule is written. A scoped
 * file repeating what the contract already says is the contract paid twice.
 */
import { relative, sep } from 'node:path'
import { SIGNALS, STRONG } from './signals.mjs'

/**
 * Conventions measured per subtree, and the ones that differ from the whole.
 *
 * @param {object} input
 * @param {string} input.target      repository root
 * @param {string[]} input.files     absolute paths already collected
 * @param {(abs: string) => string} input.read
 * @param {object} input.conventions the repository-wide measurement, all dimensions
 * @param {number} [input.minFiles]  a subtree smaller than this decides nothing
 * @param {number} [input.minObserved] a dimension seen in fewer files than this
 *                                     decides nothing either
 */
export function scopedRules({ target, files, read, conventions, minFiles = 12, minObserved = 5 }) {
  // Grouped by the first two path segments, which is where a project's own
  // divisions live — `src/components`, `src/hooks`, `app/routes`. One segment is
  // usually just `src` and three is usually one feature.
  const subtrees = new Map()
  for (const abs of files) {
    const rel = relative(target, abs).split(sep).join('/')
    const parts = rel.split('/')
    if (parts.length < 3) continue
    const key = parts.slice(0, 2).join('/')
    ;(subtrees.get(key) ?? subtrees.set(key, []).get(key)).push(abs)
  }

  const rules = []
  for (const [subtree, members] of subtrees) {
    if (members.length < minFiles) continue

    const local = {}
    for (const abs of members) {
      const src = read(abs)
      for (const [dimension, signal] of Object.entries(SIGNALS)) {
        const bucket = signal(abs, src)
        if (!bucket) continue
        const counts = (local[dimension] ??= {})
        counts[bucket] = (counts[bucket] ?? 0) + 1
      }
    }

    const differs = []
    for (const [dimension, counts] of Object.entries(local)) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      const share = n / total
      // Settled locally is the first half. A subtree that is itself split has
      // nothing to say and gets no rule.
      //
      // Two thresholds, because a large subtree can still decide a dimension in
      // two files: outline's `editor/menus` came back "literal hex 100%" on two
      // occurrences of `#fff`. A hundred per cent of two is not a convention, and
      // the size of the folder says nothing about how often the signal fired.
      if (total < minObserved) continue
      if (share < STRONG) continue

      const repo = conventions[dimension]
      if (!repo) continue

      // The second half is what the repository did, and the most valuable case is
      // the one a first version skipped: where the REPOSITORY is split and the
      // subtree has settled. Comparing only against dimensions the repository had
      // already decided found nothing in four large codebases, because it could
      // only ever report an override — and an override is rarer than a local
      // decision the contract is not in a position to make.
      // Same answer, different confidence, is not a divergence. `named 86%` in a
      // subtree of a repository that is `named 83%` says nothing an agent does not
      // already know, and reporting it produced twenty rule files for one project
      // — the always-on contract split into many always-loaded ones.
      if (repo.dominant === top) continue

      if (repo.verdict !== 'convention') {
        differs.push({
          dimension, local: top, share: Number(share.toFixed(3)), files: total,
          repository: `${repo.dominant} ${Math.round(repo.share * 100)}%, not settled`,
          kind: 'decides what the repository has not',
        })
        continue
      }
      differs.push({
        dimension, local: top, share: Number(share.toFixed(3)), files: total,
        repository: repo.dominant, kind: 'differs from the repository',
      })
    }

    if (differs.length) rules.push({ subtree, files: members.length, differs })
  }
  return rules
}

/** A Cursor rule file: frontmatter, then only what is local. */
export function ruleFile({ subtree, files, differs }) {
  const id = subtree.replace(/\//g, '-')
  const body = [
    '---',
    `description: Conventions specific to ${subtree}, where they differ from the repository`,
    `globs: ${subtree}/**/*.{ts,tsx,js,jsx}`,
    'alwaysApply: false',
    '---',
    '',
    `# ${subtree}`,
    '',
    `Measured over ${files} file(s) here. Everything the repository decides is in`,
    '`.ds/CONVENTIONS.md` and is not repeated — this file carries only what this',
    'subtree does differently, so an agent editing elsewhere never pays for it.',
    '',
    ...differs.map(d =>
      `- **${d.dimension}** — here it is **${d.local}** (${Math.round(d.share * 100)}% of ${d.files} file(s)); `
      + `the repository as a whole is ${d.repository}. ${d.kind === 'decides what the repository has not'
        ? 'The repository has not settled this; this subtree has. Follow the local one here, and do not read it as a decision for the rest.'
        : 'Follow the local one.'}`),
    '',
    'A local convention is not a licence to diverge further. It is recorded because',
    'it is already true, and the gate holds new code to whichever of the two applies',
    'where the file sits.',
    '',
  ].join('\n')
  return { path: `.cursor/rules/${id}.mdc`, content: body, id }
}
