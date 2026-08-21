/**
 * Four audit output shapes, one advisory list.
 *
 * Every package manager answers `audit` differently and the differences are not
 * cosmetic. Parsing only npm's shape reported "no result" for every repository
 * that does not use npm, which is most of them.
 *
 *   npm v7+        { vulnerabilities: { <package>: { severity, via, isDirect } } }
 *   npm v6 / pnpm  { advisories: { <id>: { module_name, severity, findings } } }
 *   yarn berry     one JSON object per line: { value, children: { Severity, Issue } }
 *   yarn classic   one JSON object per line: { type: "auditAdvisory", data: {...} }
 *
 * Extracted from the script so the shapes can be exercised without the managers.
 * Two of these four branches had never executed: this repository uses npm, and
 * the yarn paths were written from the documentation. A recorded fixture proves
 * the parser handles the shape as documented — NOT that it handles what a real
 * yarn berry emits, which needs a berry repository and is a different claim.
 */

/** One entry per distinct advisory, in the shape the rest of the pass expects. */
export function normaliseAudit(parsed) {

    if (parsed._ndjson) {
      // Two line shapes. Berry: { value, children: { Severity, Issue } }.
      // Classic: { type: "auditAdvisory", data: { advisory: {...} } }, which
      // carries the same advisory record npm and pnpm use.
      return parsed._ndjson
        .filter(a => a.type !== 'auditSummary')
        .map(a => {
          const adv = a.data?.advisory
          if (adv) {
            return {
              package: adv.module_name ?? '?',
              severity: String(adv.severity ?? '').toLowerCase(),
              direct: a.data?.resolution?.path ? !a.data.resolution.path.includes('>') : undefined,
              fixAvailable: Boolean(adv.patched_versions && adv.patched_versions !== '<0.0.0'),
              via: [adv.title].filter(Boolean),
            }
          }
          return {
            package: a.value ?? a.children?.Package ?? '?',
            severity: String(a.children?.Severity ?? '').toLowerCase(),
            direct: undefined,
            fixAvailable: undefined,
            via: [a.children?.Issue].filter(Boolean),
          }
        })
        // One advisory reached by three paths is one advisory to fix.
        .filter((a, i, all) => all.findIndex(b => b.package === a.package && b.via[0] === a.via[0]) === i)
    }
    if (parsed.advisories) {
      // pnpm, and npm v6
      return Object.values(parsed.advisories).map(a => ({
        package: a.module_name ?? a.name ?? '?',
        severity: String(a.severity ?? '').toLowerCase(),
        direct: a.findings?.some(f => f.paths?.some(p => !p.includes('>'))),
        fixAvailable: Boolean(a.patched_versions && a.patched_versions !== '<0.0.0'),
        via: [a.title].filter(Boolean),
      }))
    }
    return Object.entries(parsed.vulnerabilities ?? {}).map(([name, a]) => ({
      package: name,
      severity: String(a.severity ?? '').toLowerCase(),
      direct: a.isDirect === true,
      fixAvailable: Boolean(a.fixAvailable),
      via: (Array.isArray(a.via) ? a.via.map(x => typeof x === 'string' ? x : x.title).filter(Boolean) : []).slice(0, 2),
    }))
}

/**
 * What the manager itself reports, which counts dependency PATHS rather than
 * advisories. One advisory reached three ways is three "high" to yarn and one
 * thing to fix to us. A client running the command sees the larger number, so
 * reporting only ours reads as being wrong rather than as counting something else.
 */
export function pathCounts(parsed) {
  const summary = parsed.metadata?.vulnerabilities
    ?? parsed._ndjson?.find(l => l.type === 'auditSummary')?.data?.vulnerabilities
  if (!summary) return undefined
  return {
    critical: summary.critical ?? 0, high: summary.high ?? 0,
    moderate: summary.moderate ?? 0, low: summary.low ?? 0,
  }
}

/**
 * How many dependencies the manager actually audited, or undefined when it does
 * not say.
 *
 * The denominator, and it was being dropped. A project pointing at an unreachable
 * private registry resolved nothing, and `npm audit` answered with zero
 * vulnerabilities over `dependencies.total: 0` — which the security pass printed as
 * `0 dependency advisories`, green, on a project where nothing had been checked at
 * all. That is the exact failure this whole tool exists to catch, sitting in the one
 * pass a client is most likely to act on.
 *
 * The number is in the manager's own output. npm and pnpm report it under metadata;
 * yarn classic emits an `auditSummary` line carrying `totalDependencies`. Yarn berry
 * reports no total at all, and undefined is the honest answer there — an unknown
 * denominator is not the same as a known zero, and it is not the same as fine.
 */
export function auditedCount(parsed) {
  const deps = parsed.metadata?.dependencies
  // npm 7+ gives an object; npm 6 and some pnpm versions give a bare number.
  if (typeof deps === 'number') return deps
  if (deps && typeof deps.total === 'number') return deps.total

  const summary = parsed._ndjson?.find(l => l.type === 'auditSummary')?.data
  if (summary && typeof summary.totalDependencies === 'number') return summary.totalDependencies

  return undefined
}
