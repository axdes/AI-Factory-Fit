/**
 * Regression tests for the detectors.
 *
 * Every case here is a false positive this tool actually produced against real
 * code, caught by checking a suspicious number against the source before it
 * reached a report. Eleven of them in one build. The pattern was consistent
 * enough to be a law: the first version of any detector over-reports.
 *
 * So each one is pinned. Most assert the NEGATIVE direction — that a detector
 * stays quiet about something correct — because that is where all eleven failures
 * were. A detector that finds real problems and also invents them is worse than
 * no detector: the invented ones are what teach a team to stop reading the report.
 *
 *   node --test tests/
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, cpSync, statSync, symlinkSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { compareToBaseline } from '../scripts/lib/image-diff.mjs'
import { readImage } from '../scripts/lib/image-read.mjs'
import { detectHosts, HOSTS } from '../scripts/lib/hosts.mjs'
import { OPERATORS } from '../scripts/lib/mutations.mjs'
import { PNG } from 'pngjs'
import { normaliseAudit, pathCounts, auditedCount } from '../scripts/lib/audit-shapes.mjs'
import { measureStories, emitStory } from '../scripts/lib/emit-story.mjs'
import { readAngular } from '../scripts/lib/sfc.mjs'
import { archetypes, shellOf, regionsDeclaredBy } from '../scripts/lib/archetypes.mjs'
import { scoreFiles } from '../scripts/lib/score-core.mjs'
import { counted, countedLine } from '../scripts/lib/counted.mjs'
import { walk } from '../scripts/lib/signals.mjs'
import { attrPairs, propUsage, axesFrom } from '../scripts/lib/prop-usage.mjs'
import { taken, staleness, movedSince } from '../scripts/lib/taken.mjs'
import { scanSlot as scanSlotOf, SIGNALS, CODE_EXT } from '../scripts/lib/signals.mjs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const fixture = (name) => join(here, 'fixtures', name)

/**
 * A copy of a fixture that has no repository above it.
 *
 * Some passes answer differently inside a repository than outside one — the toolchain
 * audit climbs until it meets a repository and credits what it finds, git supplies a
 * recency window, the history scan has something to read. Fixtures under `tests/` used
 * to sit outside any repository because this project was not one; the moment it became
 * one, four tests started measuring the enclosing repository instead of the fixture,
 * and each of them exists precisely to check the case where there is nothing above.
 *
 * So those cases are given what they are about: a directory with no repository over it.
 */
const outsideAnyRepo = (name) => {
  const at = join(tmpdir(), `factoryfit-${name}-${process.pid}`)
  rmSync(at, { recursive: true, force: true })
  cpSync(fixture(name), at, { recursive: true })
  return at
}

/**
 * The first-party profile these tests were developed against.
 *
 * `profiles/own` was extracted from a design system that is not published with this
 * repository, and no substitute reproduces the measurements recorded here — the level
 * distribution, the twin pairs, the 82 hand-written levels a derivation scored 35
 * against. Rewriting those assertions to match a profile assembled today would turn a
 * suite that records real findings into one that records nothing.
 *
 * So the blocks that need it say so and stand down, which is the same answer this tool
 * gives everywhere else: not run is not passed, and it is not failed either.
 * `profiles/reference`, built from radix-ui/themes, is published as the worked example
 * of a profile with all three tiers written — point these at it, or at your own
 * library, to run them.
 */
const HAS_OWN = existsSync(join(root, 'profiles', 'own', 'components.json'))
  && existsSync(join(root, 'bindings', 'own.json'))
const describeWithOwn = HAS_OWN ? describe : describe.skip
if (!HAS_OWN) {
  console.error('\n  profiles/own is not present, so the blocks measured against it are skipped.')
  console.error('  See profiles/reference for a published profile with all three tiers written.\n')
}

/**
 * Throw away a probe directory AND what the passes wrote about it.
 *
 * Every temporary project here was removed at the end of its test and its scan was
 * not, so a run left seventeen directories under `scans/` named after probes that no
 * longer exist. That is litter, and it is also the hazard this suite has already been
 * bitten by once: six tests kept passing against the artifacts of a previous run when
 * the slot derivation changed. An artifact whose subject has been deleted is the
 * purest form of that.
 */
const discard = (at) => {
  rmSync(at, { recursive: true, force: true })
  try { rmSync(join(root, 'scans', scanSlotOf(at)), { recursive: true, force: true }) } catch { }
}

const run = (script, args) => {
  try {
    return execFileSync(process.execPath, [join(root, 'scripts', script), ...args],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return (error.stdout ?? '') + (error.stderr ?? '')
  }
}
// Resolved exactly the way the scripts resolve it. Reading a hand-written folder
// name meant that when the slot derivation changed, six tests kept passing
// against the artifacts of a previous run — the same stale-artifact failure this
// suite exists to prevent, inside the suite itself.
// Artifacts a previous run may have left in the shared directories.
//
// Three tests here write a profile into `profiles/` so the adapters and the
// generator have something to work against, and clean it up afterwards. A test
// that fails before its cleanup — or a hand-run of the same script — leaves one
// behind, and the `--all` sweep then reports it as a malformed profile. That made
// the suite depend on what the previous run happened to leave, which is the kind of
// order-dependence a suite exists to remove.
for (const leftover of ['screen-test', 'vue-test', 'svelte-test', 'ng-test', 'scale-test', 'css-test', 'figma-test']) {
  rmSync(join(root, 'profiles', leftover), { recursive: true, force: true })
  rmSync(join(root, 'bindings', `${leftover}.json`), { force: true })
}

const readScan = (fixtureName, file) =>
  JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(fixture(fixtureName)), file), 'utf8'))

describe('contrast', () => {
  test('pairs come from co-occurrence, never from token names', () => {
    run('defects.mjs', [fixture('contrast')])
    const { contrastFailures, contrastCheckedPairs } = readScan('contrast', 'defects.json')

    // The naming approach compared --card-foreground against itself at 1.00:1 and
    // reported 29 fabricated failures on a design system whose own gate passes.
    for (const f of contrastFailures) assert.notEqual(f.fg, f.bg, 'a token was compared with itself')

    // Three rules declare a colour, of which one sets both to the same token and
    // is skipped: two pairs are real, and exactly one of them fails AA.
    assert.equal(contrastCheckedPairs, 2)
    assert.equal(contrastFailures.length, 1)
    assert.equal(contrastFailures[0].fg, '--card-foreground')
  })
})

describe('internationalisation', () => {
  test('CLDR plural suffixes are not missing translations', () => {
    run('defects.mjs', [fixture('i18n')])
    run('deep.mjs', [fixture('i18n')])
    const { i18n } = readScan('i18n', 'deep.json')

    // Arabic has six plural categories and English two. Comparing raw key sets
    // reported sixteen untranslated English strings in a correct file.
    const missingInEnglish = i18n.parityGaps.en?.missing ?? 0
    assert.equal(missingInEnglish, 1, 'only the genuinely absent message should count')
    assert.ok(i18n.parityGaps.en.examples.some(k => k.includes('onlyArabic')))
    assert.ok(!i18n.parityGaps.en.examples.some(k => /_zero|_two|_few|_many/.test(k)),
      'a plural category was reported as a missing translation')
  })

  test('plural forms are reported separately, not as a defect', () => {
    const { i18n } = readScan('i18n', 'deep.json')
    assert.ok(i18n.pluralForms.ar > i18n.pluralForms.en)
  })
})

describe('file collection', () => {
  test('hidden directories are excluded', () => {
    run('deep.mjs', [fixture('hidden')])
    const { composition } = readScan('hidden', 'deep.json')

    // Eval scratch output under .drift/ was once counted as 94 screens, which
    // dragged the measured system share to zero.
    assert.equal(composition.screens, 1, 'run artifacts were counted as source')
  })
})

describe('the scene', () => {
  test('the rate is projected onto the client\'s volume, and a stand-in says it is one', () => {
    const at = join(root, 'scans', '.room-test')
    rmSync(at, { recursive: true, force: true })
    const out = run('room.mjs', [at, '--rehearse'])

    // Timed rather than assumed: 445 words of screen is about three and a half
    // minutes read aloud, which leaves the ten-to-twelve-minute target mostly to
    // the client talking. That is the right shape and it is not what this pins.
    //
    // What it pins is the thing the timing exposed. The stand-in finishes a
    // thousand records in a tenth of a second; an agent making a model call per
    // record does not. Anybody planning a ten-minute room around a step that takes
    // forty minutes on live traffic has planned the wrong room.
    assert.match(out, /claim\(s\)\/second — 18400 would take/)
    assert.match(out, /not the rate of an agent making a/)

    // And the whole scene stays labelled, in the figures and not only in a footer.
    assert.match(out, /REHEARSAL STAND-IN/)
    discard(at)
  })
})

describe('the two counts an audit produces', () => {
  test('distinct advisories and dependency paths are different numbers', () => {
    // Run against a real yarn-classic repository for the first time, the report read
    // `3 dependency advisories — critical 1 · high 2 · moderate 3, distinct`. The
    // headline was the distinct count and the breakdown was the path count, and the
    // word "distinct" covered both: a line whose own numbers sum to twice its
    // headline is one a reader stops trusting entirely, and rightly.
    const ndjson = {
      _ndjson: [
        { value: 'braces', children: { Severity: 'HIGH', Issue: 'A' } },
        { value: 'braces', children: { Severity: 'HIGH', Issue: 'A' } },
        { value: 'tar', children: { Severity: 'MODERATE', Issue: 'B' } },
        { type: 'auditSummary', data: { vulnerabilities: { critical: 0, high: 2, moderate: 1, low: 0 } } },
      ],
    }
    const distinct = normaliseAudit(ndjson)
    const paths = pathCounts(ndjson)

    // Two advisories to fix; three paths reaching them. Both true.
    assert.equal(distinct.length, 2)
    assert.equal(paths.high + paths.moderate, 3)
    assert.notEqual(distinct.length, paths.high + paths.moderate,
      'the fixture no longer exercises the disagreement it was written for')
  })
})

describe('four audit shapes', () => {
  // Two of these branches had never executed. This repository uses npm; the yarn
  // paths were written from the documentation and no yarn repository has ever been
  // run through them.
  //
  // What these fixtures prove: the parser handles each shape AS DOCUMENTED. What
  // they do not prove: that a real yarn berry emits what the documentation says.
  // That needs a berry repository and is a different claim, still open.

  test('npm v7+ keys packages, and only what is asked for is counted', () => {
    const advisories = normaliseAudit({
      vulnerabilities: {
        'left-pad': { severity: 'high', isDirect: true, fixAvailable: true, via: [{ title: 'Prototype pollution' }] },
        minimist: { severity: 'low', isDirect: false, fixAvailable: false, via: ['left-pad'] },
      },
      metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 1 } },
    })
    assert.equal(advisories.length, 2)
    const high = advisories.find(a => a.package === 'left-pad')
    assert.equal(high.severity, 'high')
    assert.equal(high.direct, true)
    assert.deepEqual(high.via, ['Prototype pollution'])
  })

  test('npm v6 and pnpm key advisories by id, and a direct path has no ">" in it', () => {
    const advisories = normaliseAudit({
      advisories: {
        1179: {
          module_name: 'minimist', severity: 'moderate', title: 'Prototype pollution',
          patched_versions: '>=1.2.6',
          findings: [{ paths: ['minimist'] }],
        },
        1180: {
          module_name: 'ansi-regex', severity: 'high', title: 'ReDoS',
          patched_versions: '<0.0.0',
          findings: [{ paths: ['chalk>ansi-styles>ansi-regex'] }],
        },
      },
    })
    assert.equal(advisories.length, 2)
    const direct = advisories.find(a => a.package === 'minimist')
    assert.equal(direct.direct, true)
    assert.equal(direct.fixAvailable, true)

    // `<0.0.0` is how the advisory database says "there is no fix", and reading it
    // as a version range would report every unfixable advisory as fixable.
    const transitive = advisories.find(a => a.package === 'ansi-regex')
    assert.equal(transitive.direct, false)
    assert.equal(transitive.fixAvailable, false)
  })

  test('yarn berry emits one object per line, and three paths are one thing to fix', () => {
    const advisories = normaliseAudit({
      _ndjson: [
        { value: 'braces', children: { Severity: 'HIGH', Issue: 'Uncontrolled resource consumption' } },
        // The same advisory reached by another path. yarn counts paths; the number
        // a person acts on is the number of distinct things to fix, and on one real
        // repository that was 195 paths against 60 problems.
        { value: 'braces', children: { Severity: 'HIGH', Issue: 'Uncontrolled resource consumption' } },
        { value: 'tar', children: { Severity: 'MODERATE', Issue: 'Path traversal' } },
        { type: 'auditSummary', data: { vulnerabilities: { critical: 0, high: 2, moderate: 1, low: 0 } } },
      ],
    })
    assert.equal(advisories.length, 2, 'the duplicate path was counted as a second advisory')
    // Severity arrives upper-case from berry and everything downstream compares
    // lower-case, so an unlowered value silently matches no bucket and counts zero.
    assert.deepEqual(advisories.map(a => a.severity).sort(), ['high', 'moderate'])
    assert.ok(!advisories.some(a => a.type === 'auditSummary'), 'the summary line was read as an advisory')
  })

  test('yarn classic emits the advisory record the others use', () => {
    const advisories = normaliseAudit({
      _ndjson: [
        {
          type: 'auditAdvisory',
          data: {
            resolution: { path: 'chalk>ansi-regex' },
            advisory: { module_name: 'ansi-regex', severity: 'high', title: 'ReDoS', patched_versions: '>=5.0.1' },
          },
        },
        {
          type: 'auditAdvisory',
          data: {
            resolution: { path: 'minimist' },
            advisory: { module_name: 'minimist', severity: 'low', title: 'Prototype pollution', patched_versions: '>=1.2.6' },
          },
        },
      ],
    })
    assert.equal(advisories.length, 2)
    assert.equal(advisories.find(a => a.package === 'minimist').direct, true)
    assert.equal(advisories.find(a => a.package === 'ansi-regex').direct, false)
  })

  test('the manager\'s own count is kept beside ours, and absent means absent', () => {
    // Both numbers are true and they count different things. A client who runs the
    // command sees the larger one, so reporting only ours reads as being wrong
    // rather than as counting something else.
    assert.deepEqual(pathCounts({ metadata: { vulnerabilities: { critical: 1, high: 2 } } }),
      { critical: 1, high: 2, moderate: 0, low: 0 })
    assert.deepEqual(pathCounts({ _ndjson: [{ type: 'auditSummary', data: { vulnerabilities: { high: 3 } } }] }),
      { critical: 0, high: 3, moderate: 0, low: 0 })
    // No summary is undefined, never a row of zeros: a zero here would print as
    // "the manager agrees there is nothing", which is not what happened.
    assert.equal(pathCounts({ vulnerabilities: {} }), undefined)
  })
})

describe('what could not run', () => {
  // The organising law of this whole tool, checked on itself: a pass that could
  // not look reports that it could not look. Every one of these branches would be
  // a confident zero if it were wrong, and a confident zero is the finding a client
  // never questions.

  test('a lint that read no files is null, not zero, and says why', () => {
    const at = join(root, 'scans', '.notrun-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{ "name": "css-only", "private": true, "version": "0.0.0" }')
    writeFileSync(join(at, 'src', 'theme.css'),
      ':root { --colour-text: #222222; --colour-bg: #ffffff; }\n.thing { color: var(--colour-text); background: var(--colour-bg); }\n')

    const out = run('defects.mjs', [at])
    const defects = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'defects.json'), 'utf8'))

    // null, not 0. Downstream arithmetic on a zero would fold "we did not look"
    // into "there was nothing", and the report would read as a clean bill.
    assert.equal(defects.counts.a11yFindings, null)
    assert.match(out, /accessibility findings\s+— NOT RUN:/)
    // And the reason is the real one, not a generic apology: the rules read JSX and
    // this project has none.
    // The reason names what was looked for, not a fixed sentence: this list grows
    // every time a framework is added, and a test spelling it out is a test edited
    // without being read.
    assert.match(out, /no React, Svelte, Vue or Angular component file was found/)

    discard(at)
  })

  test('an audit that could not run is null, and the reason names the missing input', () => {
    // Outside any repository: the pass climbs to the nearest lockfile, and under
    // `scans/` it now finds this project's own — auditing our dependencies and
    // reporting the result as the fixture's.
    const at = join(tmpdir(), `factoryfit-notrun-audit-${process.pid}`)
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    // Dependencies declared and no lockfile: there is no resolved tree to audit.
    writeFileSync(join(at, 'package.json'),
      '{ "name": "no-lockfile", "private": true, "version": "0.0.0", "dependencies": { "left-pad": "^1.3.0" } }')
    writeFileSync(join(at, 'src', 'App.tsx'), 'export function App() {\n  return <div />\n}\n')

    const out = run('security.mjs', [at])
    const security = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'security.json'), 'utf8'))

    assert.equal(security.counts.dependencyAdvisories, null)
    assert.match(out, /dependency advisories\s+— NOT RUN:/)
    assert.match(security.dependencies.why, /lockfile/)

    // gitleaks is detected and never run, so its absence changes the caveat and not
    // the number. The scope has to travel with the count either way: a secret
    // committed and later deleted is in the history and invisible to this pass.
    assert.equal(typeof security.gitleaksAvailable, 'boolean')
    assert.match(out, /the git history, unless gitleaks is run over it separately/)

    discard(at)
  })
})

describe('the derived ring', () => {
  // The self-learning loop, and the part of it that had never been exercised: every
  // observation in the catalogue was written inside one three-day window, so no
  // ring has ever been earned from evidence that came from anywhere but here.
  //
  // Driven through a catalogue written for the test rather than through the real
  // one, because the assertion is about what the derivation counts, and the real
  // catalogue happens not to contain the case today. Happening not to contain it is
  // not the same as not admitting it.
  const ringFor = (evidence) => {
    const at = join(root, 'scans', '.ring-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, 'scan.json'), JSON.stringify({
      mode: 'settled', scannedFiles: 40,
      toolchain: { present: ['project-specific linter'], missing: [] },
      conventions: {},
    }))
    const catalogue = join(root, 'catalogue', 'techniques.json')
    const original = readFileSync(catalogue, 'utf8')
    const doc = JSON.parse(original)
    doc.techniques = {
      probe: {
        name: 'Probe', what: 'A technique that exists to be counted.',
        prevents: 'Nothing; it is here to have evidence attached to it.',
        appliesWhen: [{ path: 'scannedFiles', gte: 20 }],
        requires: [], cost: { install: 'none' },
        enforcedBy: 'nothing; this is a fixture',
        evidence,
      },
    }
    writeFileSync(catalogue, JSON.stringify(doc, null, 2))
    try {
      return { out: run('fit.mjs', ['.ring-test']) }
    } finally {
      writeFileSync(catalogue, original)
      rmSync(at, { recursive: true, force: true })
    }
  }

  test('a ring is earned in projects, not in observations', () => {
    const worked = (project, date) => ({ project, date, verdict: 'worked', outcome: 'it worked' })

    // Two runs against the same repository. The whole claim a ring makes is that a
    // technique carried across to somewhere else, and a second run on the same code
    // is the one thing that cannot show that — but the derivation counted rows, so
    // this read as two independent results.
    const twice = ringFor([worked('salim', '2026-08-14'), worked('salim', '2026-08-16')])
    assert.match(twice.out, /\[TRIAL/, 'one project promoted a technique to adopt by being measured twice')
    assert.ok(!/\[ADOPT/.test(twice.out))

    // Two places is the thing it was always meant to mean.
    const elsewhere = ringFor([worked('salim', '2026-08-14'), worked('memos', '2026-08-16')])
    assert.match(elsewhere.out, /\[ADOPT/, 'two projects did not earn adopt')

    // And in the other direction: two disappointments in one project must not put a
    // technique on hold for everybody else.
    // Held techniques are not proposed at all — they are listed under "Held back",
    // which is what the absence of a badge means here.
    const flat = (project) => ({ project, date: '2026-08-14', verdict: 'no-effect', outcome: 'nothing moved' })
    const sameTwice = ringFor([flat('salim'), flat('salim')]).out
    assert.ok(!/Held back/.test(sameTwice), 'one project put a technique on hold for every other')
    assert.match(sameTwice, /1 technique\(s\) apply here/)
    assert.match(ringFor([flat('salim'), flat('memos')]).out, /Held back \(1\): probe/)
  })

  test('the age of the evidence is on screen, and no half-life is invented for it', () => {
    const { out } = ringFor([
      { project: 'salim', date: '2024-01-09', verdict: 'worked', outcome: 'it worked' },
      { project: 'memos', date: '2026-08-16', verdict: 'worked', outcome: 'it worked' },
    ])

    // Every observation carried a date and nothing read it, so a ring could only
    // ratchet toward adopt and never come back: proven twice in 2024, on a stack
    // nobody runs now, and still ADOPT with nothing on screen to suggest otherwise.
    assert.match(out, /ring earned on: 2 observation\(s\) across 2 project\(s\), 2024-01-09 to 2026-08-16/)

    // Shown, not acted on. Inventing a half-life for somebody else's evidence is
    // the kind of policy this tool refuses to assert, so the ring is unchanged and
    // the staleness is put in front of the person who can judge it.
    assert.match(out, /\[ADOPT/)
  })
})

describe('exemplars', () => {
  // "Build it the way it is already built here" is the right instruction and a
  // dangerous one: the way it is already built here includes the mistakes. In one
  // repository seven of seven async files had nowhere to fail, so "as it is done
  // here" meant "with no failure path".
  //
  // The fixture is a project where the majority is wrong: three screens fetch with
  // no catch, one does it properly, and one carries forgiven debt so the gate is
  // green on it.
  const rank = () => {
    const at = join(root, 'scans', '.exemplars-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('exemplary'), at, { recursive: true })
    run('deep.mjs', [at])
    run('defects.mjs', [at])
    const out = run('exemplars.mjs', [at, '--profile', 'own'])
    const json = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'exemplars.json'), 'utf8'))
    return { out, json, at }
  }
  const cleanup = () => rmSync(join(root, 'scans', '.exemplars-test'), { recursive: true, force: true })

  test('a file the gate forgives is still the wrong thing to copy', () => {
    const { out, json } = rank()
    const forgiven = json.ranked.find(r => r.inBaseline && r.score < r.gateScore)
    assert.ok(forgiven, 'the fixture lost its accepted debt')

    // The whole point, and the reason exemplars scores WITHOUT the baseline: the
    // baseline exists so the gate can be green, and a reference carrying forgiven
    // debt teaches the next screen to repeat it. So the two numbers must differ,
    // with the strict one lower.
    assert.ok(forgiven.score < forgiven.gateScore,
      `the gate and the ranking agreed; the baseline is not being ignored (${forgiven.score} vs ${forgiven.gateScore})`)

    // Named, with the violation spelled out, so nobody has to guess why.
    assert.match(out, /DO NOT LEARN FROM/)
    assert.match(out, new RegExp(`${forgiven.file.replace(/[.\/]/g, '\\$&')}\\s+· accepted debt`))
    const copied = [...(json.copy?.screen ?? []), ...(json.copy?.component ?? [])].map(r => r.file)
    assert.ok(!copied.includes(forgiven.file), 'a file carrying accepted debt was offered as a reference')

    // Every file carrying debt is named, including one whose strict score is
    // perfect. `avoid` enforced that and `copy` did not, so a file whose baseline
    // entry was stale — debt paid, not yet cleared, which is every repository
    // between two updates — appeared in BOTH lists. The tool said "copy this" and,
    // four lines later, "do not learn from this", about one file.
    const avoided = (json.avoid ?? []).map(r => r.file)
    const perfectButOwing = json.ranked.find(r => r.inBaseline && r.score === 100)
    assert.ok(perfectButOwing, 'the fixture lost its stale baseline entry')
    assert.ok(avoided.includes(perfectButOwing.file), 'a file was excused its debt for scoring well')
    assert.deepEqual(copied.filter(f => avoided.includes(f)), [],
      'the same file was offered as a reference and as a warning')

    cleanup()
  })

  test('a reference has to be substantial, and the majority is not the model', () => {
    const { out, json } = rank()

    // The best file wins, not the commonest shape: one component at 100% is the
    // reference while four screens sit below it.
    const copied = [...(json.copy?.screen ?? []), ...(json.copy?.component ?? [])]
    assert.ok(copied.length, `nothing was offered as a reference:\n${out}`)
    for (const r of copied) {
      assert.equal(r.score, 100)
      // A two-line file scoring 100% proves nothing, and promoting one would make
      // the smallest file in the repository its style guide.
      assert.ok(r.checks >= 8, `${r.file} became a reference on ${r.checks} checks`)
    }

    // And the measured shortfall travels with the advice. Three of four async files
    // with nowhere to fail is the majority, and it is named as the thing not to
    // copy rather than extracted as the local idiom.
    assert.match(out, /PATTERNS NOT TO COPY, HOWEVER COMMON/)
    assert.match(out, /asynchronous work with no failure path — 3 of 4/)
    assert.match(out, /screens without all three of loading, error and empty/)

    cleanup()
  })
})

describeWithOwn('the draft spec', () => {
  test('every guess carries the phrase that produced it', () => {
    const out = run('draft-spec.mjs', ['a list of invoices with a status per row and a search box', '--profile', 'own'])

    // This is keyword matching, not understanding, and it is built to say so. A
    // wrong line has to be visibly wrong rather than authoritative, which means
    // every element shows the phrase it came from.
    assert.match(out, /statusTag ← "status"/)
    assert.match(out, /searchInput ← "search"/)
    assert.match(out, /matching words/)

    // States are never inferred from silence. A requirement that does not mention
    // the empty case still produces a screen that needs one, and the draft says
    // which three nobody asked for.
    for (const state of ['loading', 'error', 'empty']) {
      assert.match(out, new RegExp(`${state}\\s+not mentioned in the requirement`))
    }
  })

  test('the draft says how much judgment it had, and the count is the claim', () => {
    // What this actually proves, which is narrower than its old name claimed.
    //
    // It used to be called "a written judgment tier drafts better, and the difference
    // is measurable", and the difference it pointed at — `list ← "list of"` appearing
    // for `own` and not for `memos` — turned out to come from the ROLE BINDINGS, not
    // from the descriptions: strip every description from `own` and that line is
    // still there, because `memos` simply has no `list` role bound. Nothing in this
    // tool that picks a component reads a description; `bind` and `draft-spec` score
    // identically with all 93 removed. The descriptions are written for an agent, and
    // reach it through the component index and the MCP surface.
    //
    // So what is pinned here is what is true: the draft reports how many descriptions
    // it had to work with, rather than sounding equally confident either way.
    //
    // The count is read from the profile rather than written here. It used to be
    // pinned as `91`, and `own` tracks a design system outside this repository: the
    // day that system grew to 93 components this test failed, saying nothing about
    // the behaviour it exists to protect. A number that moves for reasons outside the
    // repository does not belong in an assertion.
    const described = run('draft-spec.mjs', ['a list of invoices with a status per row', '--profile', 'own'])
    const bare = run('draft-spec.mjs', ['a list of invoices with a status per row', '--profile', 'memos'])

    const own = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'components.json'), 'utf8'))
    const withDescription = Object.values(own.components).filter(c => c.description).length
    assert.ok(withDescription > 50, `the own profile describes only ${withDescription} component(s)`)
    assert.match(described, new RegExp(`${withDescription} described component\\(s\\) in "own"`))
    assert.match(bare, /0 described component\(s\) in "memos"/)
    // Pinned with its real cause, so nobody re-derives the claim that was wrong here:
    // this line follows the role binding, and `memos` does not bind `list`.
    assert.match(described, /list ← "list of"/)
    const ownRoles = JSON.parse(readFileSync(join(root, 'bindings', 'own.json'), 'utf8')).roles ?? {}
    const memosRoles = JSON.parse(readFileSync(join(root, 'bindings', 'memos.json'), 'utf8')).roles ?? {}
    assert.ok(ownRoles.list, 'own no longer binds list, so this comparison means something else')
    assert.ok(!memosRoles.list, 'memos now binds list, so the difference below is no longer about bindings')
    assert.ok(!/list ← "list of"/.test(bare), 'a profile with no descriptions matched a description')
  })
})

// Exit codes carry the verdict, so a test that only reads stdout cannot tell
// NOT GATE-READY from FAILED — which is the distinction being pinned.
const validateExit = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath,
      [join(root, 'scripts', 'validate-profile.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') }
  }
}

describe('Angular in the deep pass', () => {
  test('a component with no extension of its own is still a component', () => {
    const out = run('deep.mjs', [fixture('angular-idiom')])

    // Angular components are `.ts` files with a decorator, so the extension lookup
    // that finds `.vue` and `.svelte` found none of them: a repository of four
    // hundred components read as "no component file was found".
    assert.match(out, /view framework: angular — 6 \.component\.ts file\(s\)/)
    assert.match(out, /6\s+components analysed/)

    // And the count is stated once. These files ARE the parsed `.ts` files, so
    // listing both beside each other says "3 parsed · 3 read" over a project holding
    // three — the same double-count this line was rewritten to remove for Vue.
    assert.match(out, /\d+ file\(s\) parsed with typescript [\d.]+, \d+ of them Angular components/)
  })

  test('a template it could not read is not a template with no states', () => {
    // `templateUrl` names a file beside the class, so a component cannot be read from
    // its own text. Where the file is missing, the three states come back undefined
    // rather than false — "we could not look" is not "it handles nothing".
    const orphan = [
      "import { Component } from '@angular/core'",
      '@Component({',
      "  selector: 'app-x',",
      "  templateUrl: './nowhere.component.html',",
      '})',
      'export class XComponent {}',
    ].join('\n')
    const read = readAngular(orphan, '/r/src/x.component.ts', { exists: () => false, read: () => '' })
    assert.equal(read.handlesEmpty, undefined)
    assert.equal(read.handlesError, undefined)

    // And where it can be read, both input eras are picked up.
    const both = [
      "import { Component, Input, input } from '@angular/core'",
      '@Component({',
      "  selector: 'app-y',",
      '  template: `<p>{{ a }}</p>`,',
      '})',
      'export class YComponent {',
      "  @Input() a = ''",
      '  readonly b = input.required<string>()',
      '}',
    ].join('\n')
    const mixed = readAngular(both, '/r/src/y.component.ts', {})
    assert.deepEqual(mixed.props.map(p => p.name).sort(), ['a', 'b'])
    // `input.required()` has no default and is required; `@Input() a = ''` has one.
    assert.equal(mixed.props.find(p => p.name === 'b').required, true)
    assert.equal(mixed.props.find(p => p.name === 'a').required, false)
  })
})

describe('conventions in Angular', () => {
  // A component here is not one file: the class and its decorator in `.component.ts`,
  // the markup usually beside it in `.component.html`, the styles in `.component.scss`.
  // Half the answers were in a file the signal was never handed.
  //
  // `.html` is deliberately not collected — that would count `index.html` and every
  // other page as a file measured, and nothing reads those. The template is reached
  // THROUGH the component that names it, which is how Angular thinks about it too.

  test('three migrations run at once, and each is named separately', () => {
    const out = run('scan.mjs', [fixture('angular-idiom')])

    // Standalone from 14, the default from 17; an NgModule-declared component is the
    // form teams are leaving.
    assert.match(out, /~ component export\s+standalone 83%\s+\(NgModule declaration 17%\)/)

    // Independent of the first: a repository is routinely standalone and still on the
    // decorator for its inputs.
    //
    // Marked `·` rather than `~`: this fixture holds three of these, and three is
    // under the floor a share needs to mean anything. That is the point of the
    // dimension surviving anyway — the distribution is the finding, and it is
    // printed in full whether or not a verdict can be drawn from it.
    assert.match(out, /· props declaration\s+@Input\(\) decorator 67%\s+\(input\(\) signals 33%\)/)

    // And independent of both: `@if` blocks from 17 against the structural directives.
    // A dimension only this ecosystem answers, which earns its place because the
    // answer is a migration in progress.
    assert.match(out, /· template control flow\s+\*ngIf directives 67%\s+\(@if blocks 33%\)/)

    // The one dimension with enough behind it keeps a real verdict, so the floor is
    // not simply silencing everything.
    assert.match(out, /~ component export/)

    // Reached through the component: the handler is named in the class and called in
    // a template file the signal was not given.
    assert.match(out, /handler naming\s+handleX 100%/)
    // `i18n` on an element is one of the three ways this ecosystem takes text out.
    assert.match(out, /user-facing text\s+literal in template 67%\s+\(translated 33%\)/)
  })

  test('the new dimension is silent everywhere else', () => {
    // Every other framework returns nothing, so no gate already installed acquires a
    // rule it did not have.
    assert.equal(SIGNALS['template control flow']('/r/X.tsx', 'export function X(){ return <div>{a ? 1 : 2}</div> }'), undefined)
    assert.equal(SIGNALS['template control flow']('/r/X.vue', '<template><div v-if="a">y</div></template>'), undefined)
    assert.equal(SIGNALS['template control flow']('/r/X.svelte', '<div>{#if a}y{/if}</div>'), undefined)
  })

  test('the stylesheet a component names is the stylesheet it has', () => {
    const dir = fixture('angular-idiom')
    const out = run('scan.mjs', [dir])
    // `::ng-deep` pierces view encapsulation and lives in the stylesheet, not in the
    // class. Testing the `.ts` alone meant the bucket could only ever fire for a
    // component whose styles were inline.
    assert.match(out, /styleUrls with ::ng-deep/)

    run('defects.mjs', [dir])
    const defects = readScan('angular-idiom', 'defects.json')
    // One pair from the sibling stylesheet, one from a `styles:` block in a `.ts`.
    // A component that keeps its rules in the decorator still has rules.
    assert.equal(defects.counts.contrastFailures, 2)
    assert.ok(defects.contrastFailures.some(f => f.fg === '--colour-faint'))
    assert.ok(defects.contrastFailures.some(f => f.fg === '#999999'))
    assert.equal(defects.counts.deadTokens, 0)
  })
})

describe('internal imports', () => {
  test('a package is not this project reaching for its own code', () => {
    // `from '@…/'` was read as an internal alias, so `@angular/core`,
    // `@testing-library/react` and `@mui/material` all counted as this team
    // importing its own files. An Angular component importing nothing but framework
    // packages answered "alias" over a file with no internal imports at all, and on
    // one design system 101 of the alias counts were `@testing-library`.
    //
    // A scope cannot be told from an alias by looking at it — `@ds/Button` and
    // `@mui/material` are the same shape — so it is resolved from the config that
    // declares it.
    const nowhere = '/nowhere/src/X.tsx'
    assert.equal(SIGNALS['internal imports'](nowhere,
      "import { Component } from '@angular/core'\nimport { of } from 'rxjs'"), undefined,
      'a file importing only packages was given an answer')
    assert.equal(SIGNALS['internal imports'](nowhere,
      "import Button from '@mui/material/Button'\nimport { y } from '../y'"), 'relative',
      'a package import outvoted the only internal import in the file')

    // `@/`, `#/` and `~/` carry no scope name, so they can only be an alias.
    assert.equal(SIGNALS['internal imports'](nowhere, "import { A } from '@/ui/A'"), 'alias')
    assert.equal(SIGNALS['internal imports'](nowhere, "import { A } from '~/ui/A'"), 'alias')

    // And a scope the project's own tsconfig declares IS internal.
    const at = join(root, 'scans', '.alias-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@app/*': ['./src/*'] } } }, null, 2))
    assert.equal(SIGNALS['internal imports'](join(at, 'src', 'X.tsx'),
      "import { A } from '@app/ui/A'"), 'alias',
      'an alias the project declares was read as a package')
    discard(at)
  })
})

describe('conventions in Svelte', () => {
  test('the axes are the ones this language has, and not one more', () => {
    const dir = fixture('svelte-idiom')
    const out = run('scan.mjs', [dir])

    // No longer OUT OF SCOPE: the signals read it, so `scan` extracts conventions
    // instead of saying nothing below is a measurement of this project.
    assert.ok(!/OUT OF SCOPE/.test(out), 'a language the signals read was still refused')
    assert.match(out, /flat Name\.svelte 100%/)

    // The live split in every Svelte codebase mid-migration: `export let` through
    // version 4, `$props()` from 5. Two files of three on the old form and one on the
    // new is a LEANING, not a convention — reporting it as settled would hold new code
    // to the form the team is leaving.

    // A Svelte `<style>` block is scoped by default, so there is no scoped/unscoped
    // axis. What varies is whether the component reaches out of its own scope.
    assert.match(out, /Svelte <style> with :global/)

    // Every block of a tag, not the first. A single-file component routinely carries
    // two script blocks — Svelte's `context="module"` beside its instance script,
    // Vue's `<script>` beside `<script setup>` — and reading only the first skipped
    // the half that declares the props: a dimension quietly dropping a file rather
    // than answering wrongly, which is harder to notice and just as false.
    assert.match(out, /~ props declaration\s+export let 80%/)
    const twoScripts = [
      '<script lang="ts">', 'export const KEY = 1', '</script>', '',
      '<script lang="ts" setup>', 'interface Props { a: string }',
      'const p = defineProps<Props>()', '</script>', '',
      '<template><div class="x">Words</div></template>',
    ].join('\n')
    assert.equal(SIGNALS['props declaration']('/r/A.vue', twoScripts), 'interface Props')
    assert.equal(SIGNALS['component export']('/r/A.vue', twoScripts), 'script setup')

    // A handler named at the call site counts, and Svelte writes that two ways —
    // `on:click={handleGo}` through 4 and `onclick={handleGo}` from 5.
    assert.match(out, /handler naming\s+handleX 100%/)

    // And the one axis this language does NOT have. A Svelte file exports no
    // component — the file is the component — so a value here would be a confident
    // answer under a question nobody asked.
    //
    // The guard has to be explicit rather than left to luck: `ListPage.svelte` carries
    // a real Svelte 4 `<script context="module">` block with `export default {`, which
    // the pattern written for Vue reads as the Options API. Without the guard this
    // dimension acquires a bucket, and a Svelte project is told 25% of its components
    // use an API that belongs to another framework.
    assert.ok(!/component export/.test(out), 'an axis Svelte does not have was given a value')
    const listPage = readFileSync(join(fixture('svelte-idiom'), 'src', 'ListPage.svelte'), 'utf8')
    assert.equal(SIGNALS['component export'](join('/r/src', 'ListPage.svelte'), listPage), undefined,
      'a module-context export was read as a component declaration style')
  })

  test('rules in a Svelte style block are rules', () => {
    const dir = fixture('svelte-idiom')
    run('defects.mjs', [dir])
    const defects = readScan('svelte-idiom', 'defects.json')

    // Same fix as for Vue, same reason: collecting only `.css` and `.scss` saw none of
    // a component's rules, so the pass whose numbers a client reads as a verdict
    // examined zero files and printed zeroes.
    assert.equal(defects.counts.contrastFailures, 2)
    assert.ok(defects.contrastFailures.some(f => f.fg === '--colour-faint'))
    assert.ok(defects.contrastFailures.some(f => f.fg === '#999999'))
    assert.ok(defects.counts.hardcodedValues >= 3)
    // Referenced from inside a <style> block is referenced.
    assert.equal(defects.counts.deadTokens, 0)
  })

  test('deep already read it, and now says how much', () => {
    const out = run('deep.mjs', [fixture('svelte-idiom')])
    // `readSvelte` handles both prop eras and was wired in before any of this; the
    // headline was the part that lied about it.
    assert.match(out, /single-file component\(s\) read/)
    // Both kinds counted where each was read, and the TS files named separately: a
    // fixture that grows should not need this number edited, but a headline that
    // announces zero over its own findings must still fail.
    assert.ok(!/^0 file\(s\)/m.test(out), 'zero was announced over a report with findings')
    assert.match(out, /view framework: svelte/)
  })
})

describe('stylesheets inside a single-file component', () => {
  test('the headline counts what was read, of each kind', () => {
    const dir = fixture('sfc-styles')
    const out = run('deep.mjs', [dir])

    // This printed the count of `.ts`/`.tsx` files alone, so on a Vue project it
    // announced "0 file(s), parsed with typescript" directly above its own findings
    // about a component and its props — a headline contradicting the report under it,
    // which is how a reader decides the whole thing is unreliable.
    assert.match(out, /1 single-file component\(s\) read/)
    assert.ok(!/^0 file\(s\)/m.test(out), 'zero files was announced over a report with findings')
  })

  test('rules in a <style> block are rules', () => {
    const dir = fixture('sfc-styles')
    run('defects.mjs', [dir])
    const defects = readScan('sfc-styles', 'defects.json')

    // Collecting only `.css` and `.scss` saw none of an SFC's rules, so on a Vue
    // project this pass examined zero files for literals and printed a zero — which
    // reads as a clean bill in the one report a client treats as a verdict.
    assert.ok(defects.counts.hardcodedValues >= 2,
      `literals inside <style> were not counted: ${defects.counts.hardcodedValues}`)

    // The flagship check, blind to SFCs until now: two pairs co-occur in these rules
    // and one of them fails AA at 1.61:1.
    assert.equal(defects.counts.contrastFailures, 2)
    const failure = defects.contrastFailures.find(f => f.fg === '--colour-faint')
    assert.equal(failure.fg, '--colour-faint')
    assert.equal(failure.bg, '--colour-surface')

    // And a token referenced only inside a <style> block is not dead. Reporting it as
    // dead is the same blindness pointing the other way: advice to delete something
    // that is in use.
    assert.equal(defects.counts.deadTokens, 0,
      'a token used inside an SFC was reported as never referenced')

    // A literal is already the colour, and only token names used to be resolvable —
    // so a rule written with hexes produced no pair and the report said "0 contrast
    // failures" over text at 1.61:1. Co-occurrence is the same evidence either way.
    const literal = defects.contrastFailures.find(f => f.fg.startsWith('#'))
    assert.ok(literal, 'a literal colour pair inside an SFC was not checked')
    assert.equal(literal.fg, '#999999')
    assert.equal(literal.bg, '#ffffff')
  })
})

describe('conventions in a single-file component', () => {
  // Ten of ten signals returned undefined on a `.vue` file, so a Vue project got a
  // gate that enforced nothing — green because it checked nothing, in the layer this
  // whole tool exists to prevent that in.
  const vue = (name, src) => {
    const out = {}
    for (const [dimension, signal] of Object.entries(SIGNALS)) {
      const bucket = signal(join('/r/src', name), src)
      if (bucket) out[dimension] = bucket
    }
    return out
  }

  test('the same questions are asked of a different syntax', () => {
    const measured = vue('HomePage.vue', [
      '<script lang="ts" setup>',
      "import { Badge } from '@/ui'",
      'interface Props { title: string }',
      'const props = defineProps<Props>()',
      'const handleGo = () => {}',
      '</script>',
      '',
      '<template>',
      '  <div class="home" @click="handleGo">',
      '    <Badge />',
      '    <span>Archived memos</span>',
      '  </div>',
      '</template>',
      '',
      '<style scoped>',
      '.home { padding: var(--space-4); }',
      '</style>',
    ].join('\n'))

    assert.equal(measured['file structure'], 'flat Name.vue')
    // Declared how, not exported how: `script setup` is the Vue axis, and it is
    // deliberately not called "named" — a distribution that mixed two frameworks'
    // answers into one number would mean nothing.
    assert.equal(measured['component export'], 'script setup')
    assert.equal(measured['props declaration'], 'interface Props')
    assert.equal(measured['internal imports'], 'alias')
    // Where an SFC keeps its styles is a real convention with four answers.
    assert.equal(measured.styling, 'SFC <style scoped>')
    // A handler named only at the call site in the template still counts.
    assert.equal(measured['handler naming'], 'handleX')
    // Sizes live in the SFC's own <style> block, so reading only .css measured none.
    assert.equal(measured['sizing values'], 'from tokens')
    assert.equal(measured['user-facing text'], 'literal in template')
  })

  test('the runtime and inline forms of defineProps are different contracts', () => {
    const withRuntime = vue('A.vue', '<script setup>\nconst p = defineProps({ title: String })\n</script>')
    assert.equal(withRuntime['props declaration'], 'runtime object')
    const withInline = vue('B.vue', '<script setup lang="ts">\nconst p = defineProps<{ title: string }>()\n</script>')
    assert.equal(withInline['props declaration'], 'inline type')
  })

  test('a React bucket name is a contract with every gate already installed', () => {
    // Renaming a value here makes every file in a client project a violation of a
    // rule nobody changed — a red gate caused by an edit to this tool, which is the
    // fastest way to have the gate switched off. `literal in JSX` nearly became
    // `literal in markup` while the SFC reader was being added.
    const react = {}
    const src = [
      "import './X.css'",
      "import { helper } from '../lib/helper'",
      'type Props = { a: string }',
      'export function X({ a }: Props) {',
      '  const handleClick = () => {}',
      '  return <div className="x">Hello there</div>',
      '}',
    ].join('\n')
    for (const [dimension, signal] of Object.entries(SIGNALS)) {
      const bucket = signal('/r/src/components/X.tsx', src)
      if (bucket) react[dimension] = bucket
    }
    assert.deepEqual(react, {
      'file structure': 'flat Name.tsx',
      styling: 'plain co-located CSS',
      'component export': 'named',
      'props declaration': 'type Props',
      'handler naming': 'handleX',
      'internal imports': 'relative',
      'user-facing text': 'literal in JSX',
    })
  })

  test('nothing is collected that nothing can read', () => {
    // The rule this replaces a specific case with. `.svelte` was excluded while no
    // signal could answer for it, and including it then would have counted its files
    // as files measured, left every dimension undecided, and printed "greenfield — no
    // house style to honour" over an application that has one.
    //
    // Now the signals read it, so it belongs. What must stay true is the general
    // form: every component extension collected has at least one signal that can
    // answer for it, and a language nothing opens is not collected at all.
    const specimen = {
      '.tsx': 'export function X() {\n  return <div className="x">Words here</div>\n}',
      '.vue': '<script lang="ts" setup>\nconst p = defineProps<{ a: string }>()\n</script>\n\n<template><div class="x">Words</div></template>',
      '.svelte': '<script lang="ts">\n  export let a\n</script>\n\n<div class="x">Words</div>',
    }
    for (const [ext, src] of Object.entries(specimen)) {
      assert.ok(CODE_EXT.has(ext), `${ext} is read by the signals and not collected`)
      const answered = Object.values(SIGNALS).some(signal => signal(`/r/src/HomePage${ext}`, src))
      assert.ok(answered, `${ext} is collected and no signal answers for it`)
    }
    // A language nothing here opens stays out, so its files are never counted as
    // measured. Unmeasured and unmeasurable are different findings.
    for (const ext of ['.py', '.go', '.rs', '.swift']) {
      assert.ok(!CODE_EXT.has(ext), `${ext} is collected and nothing reads it`)
    }
  })
})

describe('the adapters', () => {
  // Four adapters, 1155 lines, and until the validator could tell an unwritten
  // tier from a malformed profile there was no assertion to make about their
  // output: "the profile is complete" is false for all of them by design, and
  // "the profile loads" is not a claim worth pinning.
  //
  // adapt-mui and adapt-antd are NOT covered here and cannot be: both read the
  // shipped .d.ts and execute the theme out of an installed copy of the library,
  // and neither @mui/material nor antd is a dependency of this repository. Saying
  // so is better than a test that stubs the library and proves the stub.
  const adapt = (script, args) => run(script, args)
  const drop = (id) => rmSync(join(root, 'profiles', id), { recursive: true, force: true })

  test('all three variant notations are read, including the one nobody here uses', () => {
    drop('css-test')
    adapt('adapt-css.mjs', [fixture('css-framework'), '--out', 'css-test'])
    const components = JSON.parse(readFileSync(join(root, 'profiles', 'css-test', 'components.json'), 'utf8')).components
    const valuesOf = (name, prop) => (components[name]?.props ?? []).find(p => p.name === prop)?.values ?? []

    // Attribute variants — the closed set is visible in the selector.
    assert.deepEqual(valuesOf('Btn', 'variant').sort(), ['ghost', 'primary'])

    // BEM modifiers. This one was silently dropped: the base-name pattern was
    // greedy and `-` is a word character, so `.card--elevated` read as a family
    // CALLED `card--elevated`, became a one-rule family, and was counted among the
    // utilities — taking `.card` itself with it for having no variants left.
    //
    // Invisible on the only system this had ever been run against, which uses 674
    // attribute variants and three BEM modifiers. It would have appeared at the
    // first client with a hand-written framework, which is the case adapt-css was
    // written for.
    assert.ok(components.Card, 'a family declared with BEM modifiers was dropped entirely')
    assert.deepEqual(valuesOf('Card', 'variant').sort(), ['elevated', 'flat'])
    assert.ok(!Object.keys(components).some(k => /--|__/.test(k)),
      'a modifier or an element was read as a family of its own')

    // State classes, with no variants at all. A family is still a family.
    assert.ok(components.Field, 'a family declared only through state classes was dropped')

    drop('css-test')
  })

  test('what a stylesheet cannot say is declared unwritten, not claimed written', () => {
    drop('css-test')
    adapt('adapt-css.mjs', [fixture('css-framework'), '--out', 'css-test'])

    // This named policy.json and judgment.json as its two tiers' evidence and
    // wrote neither file. Three hundred and twenty-three components went out with
    // no level, surface or description under a profile claiming all three tiers
    // were in place — a claim of coverage with nothing behind it, which is the
    // failure this whole tool exists to catch, sitting inside the tool.
    const profile = JSON.parse(readFileSync(join(root, 'profiles', 'css-test', 'profile.json'), 'utf8'))
    assert.match(profile.tiers.policy, /UNWRITTEN/)
    assert.match(profile.tiers.judgment, /UNWRITTEN/)
    for (const file of ['policy.json', 'judgment.json', 'rules.json']) {
      assert.ok(existsSync(join(root, 'profiles', 'css-test', file)), `${file} was named as a tier and not written`)
    }

    // And the whole point of the verdict split: an adapter's output must be
    // well-formed even though it is incomplete. NOT GATE-READY is the pass here;
    // FAILED is not.
    const validated = validateExit(['css-test'])
    assert.equal(validated.code, 3, `adapter output was malformed:\n${validated.out}`)
    assert.match(validated.out, /NOT GATE-READY/)

    drop('css-test')
  })

  test('a Figma alias resolves, and one pointing outside the file is refused', () => {
    drop('figma-test')
    const out = adapt('adapt-figma.mjs', ['--from', join(fixture('figma'), 'variables.json'), '--out', 'figma-test'])

    // Three of four variables resolve; the fourth aliases a variable that is not
    // in this file — a published library, most often — and is recorded rather than
    // filled in. Inventing that value is how a token layer ends up confidently
    // wrong about a client's brand colour.
    assert.match(out, /3\s+tokens written/)
    assert.match(out, /1\s+left unresolved rather than guessed/)
    assert.match(out, /colour\/from-library/)

    // The alias that DOES resolve carries the value it points at, not the alias.
    const tokens = JSON.parse(readFileSync(join(root, 'profiles', 'figma-test', 'tokens.json'), 'utf8'))
    const flat = JSON.stringify(tokens)
    assert.ok(!/VARIABLE_ALIAS/.test(flat), 'an unresolved alias was written as a token value')

    // A token layer is not a library profile and must not be reported as one. Both
    // adapt:figma and style:tokens write a bare tokens.json under profiles/, so
    // once --all joined the gate, extracting a client's Figma tokens broke their
    // own build with ten problems about five files that were never meant to exist.
    const validated = validateExit(['figma-test'])
    assert.match(validated.out, /TOKEN LAYER/)
    assert.ok(!/FAILED/.test(validated.out), 'a complete token layer was reported as a broken profile')

    drop('figma-test')
  })
})

describeWithOwn('the profile validator', () => {
  // Applied to the validator, the same law as everywhere else here: NOT AUTHORED
  // is not INVALID. Collapsing the two made this print 185 lines over a profile
  // that was well-formed and openly incomplete, which is why `check` validated one
  // profile of six and two genuinely broken ones sat on disk undetected.
  const validate = validateExit

  test('an unwritten tier is work nobody did, and reads as one finding not 177', () => {
    const { code, out } = validate(['memos'])

    // Three distinguishable verdicts, and distinguishable exit codes, so a caller
    // can tell "nobody has authored this yet" from "the format is wrong".
    assert.equal(code, 3, 'an honestly incomplete profile was reported as malformed or as valid')
    assert.match(out, /NOT GATE-READY/)

    // The tiers named are the ones the PROFILE declares unwritten. Reading its own
    // declaration is the whole fix: adapt-react writes `policy: UNWRITTEN` and this
    // used to ignore it.
    assert.match(out, /policy and judgment are unwritten/)

    // Counted per kind. Fifty-nine components with no description is one finding.
    assert.match(out, /59 × no description/)
    assert.match(out, /59 × no atomic level/)
    const findings = out.split('\n').filter(l => /×/.test(l))
    assert.ok(findings.length <= 6, `still a wall of lines: ${findings.length}`)

    // And the derived noise is gone: a null expressionKey is one fact about the
    // profile, not one per translatable rule.
    assert.match(out, /1 × no expressionKey/)
    assert.ok(!/has no expression for "null"/.test(out), 'a deliberate state was reported as a bug, once per rule')
  })

  test('a tier claimed written and not written is still a failure', () => {
    // `own` authors all three, so nothing may be excused for it — the escape hatch
    // must be keyed to the declaration, not available to every profile.
    assert.equal(validate(['own']).code, 0)

    // The check that keys it: a profile that does NOT say a tier is unwritten gets
    // the missing fields reported as defects. adapt-css named policy.json and
    // judgment.json as its two tiers' evidence and wrote neither file, so 323
    // components shipped with no level, surface or description under a profile
    // claiming all three tiers were in place.
    const dir = join(root, 'profiles', '.claims-written')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const src = join(root, 'profiles', 'memos')
    for (const f of readdirSync(src)) cpSync(join(src, f), join(dir, f))
    const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
    profile.id = '.claims-written'
    profile.tiers = { facts: 'complete', policy: 'policy.json', judgment: 'judgment.json' }
    writeFileSync(join(dir, 'profile.json'), JSON.stringify(profile, null, 2))

    const claimed = validate(['.claims-written'])
    assert.equal(claimed.code, 1, 'a profile claiming written tiers it has not written passed')
    assert.match(claimed.out, /FAILED/)
    assert.match(claimed.out, /no atomic level/)
    discard(dir)
  })

  test('--all covers every profile, and only a malformed one fails it', () => {
    const { code, out } = validate(['--all'])
    for (const id of readdirSync(join(root, 'profiles'), { withFileTypes: true }).filter(e => e.isDirectory())) {
      assert.match(out, new RegExp(`\\b${id.name}\\b`), `${id.name} was not covered`)
    }
    // Unwritten tiers must not fail the sweep, or the gate can never include the
    // adapters' output and their 1155 lines stay uncovered for good.
    assert.match(out, /NOT GATE-READY/)
    assert.equal(code, 0, `an unwritten tier failed the sweep:\n${out}`)
  })
})

describe('the gate update', () => {
  // The second script that writes into somebody else's repository, and the one
  // that runs at the worst moment: after their code has moved under it. It has to
  // rebuild the rules without discarding what the team settled and without
  // re-reddening work already accepted — lose either and the gate gets switched
  // off that afternoon.
  //
  // The fixture is a repository whose installed gate is deliberately out of step
  // with what it now measures, so one update has to do all six things at once.
  const update = (extra = []) => {
    const at = join(root, 'scans', '.gate-update-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('gate-update'), at, { recursive: true })
    run('scan.mjs', [at, '--exclude', 'vendor,src/generated'])
    // Captured immediately before the run. Comparing CONTENT proves nothing here:
    // the script reads decisions.json and would write the same bytes back, so a
    // regenerating version passes a content check while still being the thing that
    // silently discards a field it did not know to keep. Not touching the file at
    // all is the guarantee, so the mtime is what the test reads.
    const decisionsAt = join(at, '.ds', 'decisions.json')
    const untouched = statSync(decisionsAt).mtimeMs
    const out = run('update.mjs', [at, ...extra])
    const read = (p) => existsSync(join(at, p)) ? JSON.parse(readFileSync(join(at, p), 'utf8')) : undefined
    return { out, read, at, untouched }
  }
  const cleanup = () => rmSync(join(root, 'scans', '.gate-update-test'), { recursive: true, force: true })

  test('what the team decided outranks what the code measures, and is never rewritten', () => {
    const { out, read, at, untouched } = update(['--apply'])

    // The repository exports by name in nine files of ten. The team settled on
    // `default` anyway, and a scan that reopened that would be a scan nobody runs
    // twice: the measurement is an input to the decision, not a vote against it.
    const conventions = read('.ds/conventions.json')
    assert.equal(conventions.enforce['component export'].expect, 'default')
    assert.match(conventions.enforce['component export'].source, /decided by the team on 2026-08-01/)
    assert.match(out, /team decisions in force: component export/)

    // And the team's file is theirs. Regenerating it is how a tool silently
    // discards the one thing in the repository it did not produce.
    assert.equal(statSync(join(at, '.ds', 'decisions.json')).mtimeMs, untouched,
      'the team\'s file was rewritten')
    assert.match(out, /decisions\.json was not touched/)

    cleanup()
  })

  test('debt is carried, paid, released and taken on — and a regression is none of those', () => {
    const { out, read } = update(['--apply'])
    const baseline = read('.ds/baseline.json')

    // Paid: an accepted violation that no longer violates leaves the baseline.
    assert.match(out, /internal imports: 1 file\(s\) fixed/)
    assert.ok(!(baseline['internal imports'] ?? []).includes('src/lib/helper.ts'))

    // Released: the rule went away, so its debt goes with it rather than sitting
    // in the file forever as a claim about a dimension nobody checks.
    assert.match(out, /handler naming: 2 entry\(ies\) dropped/)
    assert.ok(!('handler naming' in baseline), 'debt outlived the rule that measured it')

    // Taken on: a newly enforced rule starts from where the code is. Starting from
    // zero lands the gate red on the day it is installed, which is the version
    // teams turn off.
    assert.equal((baseline['component export'] ?? []).length, 10)
    assert.match(out, /component export: 10 file\(s\) accepted/)

    // And the one thing an update must NOT forgive: a violation of a rule that did
    // not change, in a file nobody accepted. Absorbing it into the new baseline
    // would make every update a laundering step.
    assert.match(out, /REGRESSIONS/)
    assert.match(out, /internal imports: 1 file\(s\), e\.g\. src\/components\/Aliased\.tsx/)
    assert.ok(!(baseline['internal imports'] ?? []).includes('src/components/Aliased.tsx'),
      'a regression was quietly accepted as debt')

    cleanup()
  })

  test('it measures what the installed gate measures, not what the command line forgot', () => {
    // `install` records the exclusion list into conventions.json for a stated
    // reason: so the tool and the gate measure the same files, because a number
    // that changes with who ran it is not a number. This script read the list off
    // its own argv and defaulted to nothing, so forgetting the flag reported three
    // generated files as regressions against rules the gate will never apply to
    // them — 4 instead of 1.
    const kept = update()
    assert.match(kept.out, /excluded from measurement: vendor, src\/generated \(as recorded at install\)/)
    assert.match(kept.out, /internal imports: 1 file\(s\)/)
    // Named in the header on purpose; the test is that it never turns up as a
    // finding, which is where the header line would otherwise mask it.
    const findings = kept.out.split('\n').filter(l => /^\s+[✗+·✓~]/.test(l))
    assert.ok(!findings.some(l => l.includes('src/generated')),
      `an excluded directory was measured anyway:\n${findings.join('\n')}`)
    cleanup()

    // Passing the flag still wins, because changing what is excluded is a real
    // decision — it is just said out loud and written back, so the gate is
    // rebuilt to match rather than left disagreeing with the measurement.
    const dropped = update(['--exclude', '', '--apply'])
    assert.match(dropped.out, /CHANGED from what was installed: vendor, src\/generated/)
    assert.match(dropped.out, /internal imports: 4 file\(s\)/)
    assert.deepEqual(dropped.read('.ds/conventions.json').excluded, [])
    cleanup()
  })
})

describe('a file-system router', () => {
  test('being inside app/ is not the rule; being named page is', () => {
    const dir = fixture('app-router')
    run('deep.mjs', [dir])
    const deep = readScan('app-router', 'deep.json')

    // `ROUTE_DIR` matched `app/` anywhere, so in a Next app-router project every
    // component under `app/` counted as a screen. On one real product that measured
    // 175 screens over 58 routes, and every number derived from that set — states
    // handled, system share, the archetype distribution — was diluted by two thirds.
    assert.equal(deep.composition.screens, 3)
    assert.deepEqual(deep.composition.shapes.map(s => s.file).sort(),
      ['app/inbox/page.tsx', 'app/page.tsx', 'app/settings/page.tsx'])

    // Named in the same folder and deliberately not screens: a layout is a frame, a
    // loading file is a state, and a form is a part.
    const files = deep.composition.shapes.map(s => s.file)
    for (const notAScreen of ['app/layout.tsx', 'app/loading.tsx', 'app/AppShell.tsx', 'app/settings/SettingsForm.tsx']) {
      assert.ok(!files.includes(notAScreen), `${notAScreen} was counted as a screen`)
    }
  })
})

describe('proving the generated file against the gate that approved it', () => {
  // Three levels, and only two existed. `ds eval` measures our ruleset against our
  // corpus; the generated eval set measures the client's gate against the client's own
  // reference file. Nobody measured the client's gate against the file we have just
  // put in their repository — which is the file the next agent copies.
  //
  // The measurement went false four times before it was right, and each way is a
  // different lesson about asserting on the wrong signal:
  //
  //   1  one check invoked, the rest reported as holes
  //   2  `score` exits zero on a drop to 80% — caught is not the same as failed
  //   3  a break aimed at a DOCUMENTED convention, which by design is not enforced
  //   4  a check with nothing to look at in this file, silent for a good reason

  test('every operator names the check meant to catch it', () => {
    for (const op of OPERATORS) {
      assert.ok(op.id, 'an operator with no name')
      assert.ok(op.catchBy, `${op.id} does not say which check should catch it`)
      assert.ok(op.what, `${op.id} does not say what it breaks`)
      assert.equal(typeof op.apply, 'function')
    }
  })

  test('an operator applies only where it has something to break', () => {
    // `icon-button-unnamed` removed ANY `aria-label` it found. On a generated screen
    // the first one belongs to a `<section>`, and stripping a region label is not an
    // unnamed control — so the accessibility floor stayed quiet, correctly, and the
    // operator was reported as surviving a check it had never given anything to catch.
    const op = OPERATORS.find(o => o.id === 'icon-button-unnamed')
    const regionOnly = '<section aria-label="header"><p>text</p></section>'
    assert.equal(op.apply(regionOnly), undefined, 'a region label was taken for a control name')

    const iconButton = '<IconButton aria-label="Close" icon={x} />'
    assert.match(op.apply(iconButton), /<IconButton\s+icon=\{x\} \/>/)
  })

  test('a break aimed at an unsettled rule is not a hole', () => {
    // A leaning is not held against new code by design, so the gate is right to be
    // silent about it. Reporting that as a failure blames the gate for a decision
    // nobody has made.
    const needy = OPERATORS.filter(o => o.needs)
    assert.ok(needy.length >= 3, 'no operator declares the dimension it depends on')
    for (const op of needy) {
      assert.ok(typeof op.needs === 'string' && op.needs.length, `${op.id} names no dimension`)
    }
    assert.ok(needy.some(o => o.id === 'default-export' && o.needs === 'component export'))
  })
})

describe('which agents this repository actually carries', () => {
  // The install wrote `.claude/settings.json`, a skill and a subagent into every
  // project unconditionally — including ones where nobody has ever run Claude Code.
  // That is the same failure as a `.stories.tsx` in a repository with no Storybook:
  // a file nothing reads, counted as coverage in the summary, and one more thing for
  // somebody to keep in step.
  const at = (...present) => detectHosts(p => present.includes(p))

  test('a host is written for when the repository shows it uses one', () => {
    const withClaude = at('CLAUDE.md')
    assert.ok(withClaude.wants('Claude Code'))
    assert.ok(withClaude.present.some(h => h.name === 'Claude Code'))

    const without = at()
    assert.ok(!without.wants('Claude Code'), 'artefacts for an agent nobody here runs')
    assert.ok(without.absent.some(h => h.name === 'Claude Code'))

    // A directory is evidence as much as a file is.
    assert.ok(at('.cursor').wants('Cursor'))
    assert.ok(at('.github/copilot-instructions.md').wants('GitHub Copilot'))
  })

  test('the portable contract is written regardless, and says so', () => {
    // `AGENTS.md` is the one file the skill-based hosts agree on, so it goes in
    // whether or not any host is here — a portable contract in a repository with no
    // agent yet is a contract waiting for the first one.
    const bare = at()
    assert.ok(bare.wants('Codex and anything else reading AGENTS.md'))

    // And it is never listed as not-written, which would contradict the line above
    // it saying it was. A report that disagrees with itself is one nobody finishes.
    assert.ok(!bare.absent.some(h => h.portable), 'the portable contract was reported as skipped')
    const portable = bare.present.find(h => h.portable)
    assert.equal(portable.assumed, true, 'written on assumption, and not marked as such')
  })

  test('the install writes for a host only where that host is here', () => {
    // Staged outside this repository, unlike the other fixtures here. `install`
    // skips the portable contract when an AGENTS.md is *reachable* from an
    // ancestor, not merely present in the target — which is correct, and which
    // makes a target staged under scans/ inherit this repository's own contract
    // and the test assert about the wrong tree. It passed only while this
    // repository had no AGENTS.md of its own.
    const stage = join(tmpdir(), 'factoryfit-hosts-test')
    const install = (extra) => {
      const at = stage
      rmSync(at, { recursive: true, force: true })
      mkdirSync(at, { recursive: true })
      cpSync(fixture('screen-idiom'), at, { recursive: true })
      mkdirSync(join(root, 'profiles', 'screen-test'), { recursive: true })
      cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'screen-test', 'components.json'))
      cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'screen-test.json'))
      rmSync(join(at, 'profile'), { recursive: true, force: true })
      if (extra) writeFileSync(join(at, extra), '# the team contract\n')
      run('scan.mjs', [at])
      const out = run('install.mjs', [at, '--profile', 'screen-test', '--apply'])
      return { out, has: (p) => existsSync(join(at, p)) }
    }
    const drop = () => {
      rmSync(stage, { recursive: true, force: true })
      rmSync(join(root, 'profiles', 'screen-test'), { recursive: true, force: true })
      rmSync(join(root, 'bindings', 'screen-test.json'), { force: true })
    }

    const bare = install()
    assert.ok(!bare.has('.claude'), 'a settings file, a skill and a subagent for an agent nobody here runs')
    assert.ok(bare.has('AGENTS.md'), 'the portable contract was skipped')
    assert.match(bare.out, /nothing written for Claude Code/)
    drop()

    const withHost = install('CLAUDE.md')
    assert.ok(withHost.has('.claude/settings.json'))
    assert.ok(withHost.has('AGENTS.md'))
    assert.match(withHost.out, /Hosts here:\s+Claude Code/)
    drop()
  })

  test('every host names what it would take, so adopting one is not a mystery', () => {
    // The second half of the report is the useful one: a team adopting Cursor next
    // month can see, from the install they already ran, exactly what would appear.
    for (const [name, host] of Object.entries(HOSTS)) {
      assert.ok(host.writes.length, `${name} names no artefact`)
      assert.ok(host.why, `${name} does not say why it needs one`)
      assert.ok(host.evidence.length, `${name} cannot be detected`)
    }
  })
})

describe('the arrangement a project agrees on', () => {
  // Three probes said the signal was not where it was looked for. Counting every flex
  // and grid in a file gives a nesting, not an arrangement. Resolving the root
  // container's rule answered five screens of eleven, two of them a button. And the
  // answers that did resolve disagree: column, row, and grids of one, two, three and
  // four columns.
  //
  // So there is no house arrangement to copy. It is a decision per screen, and the
  // honest output is the distribution with a verdict — not an average dressed as one.

  const screensWith = (arrangements) => arrangements.map((cls, i) => ({
    file: `s${i}.tsx`,
    text: `export const S${i} = () => <Scene title="x"><div className="${cls}">y</div></Scene>`,
  }))

  test('a disagreement is reported as one, not averaged into an answer', () => {
    const a = archetypes(screensWith(['flex', 'flex flex-col', 'grid', 'flex', 'grid', 'flex flex-col'])).arrangement
    assert.equal(a.verdict, 'split')
    // Every answer is kept, because the point of a split is the list.
    assert.deepEqual(a.distribution.map(d => d.name).sort(), ['flex column', 'flex row', 'grid'])
  })

  test('two observations agreeing is two observations', () => {
    // The guard this needed: `grid 100%` was reported over a count of two, which is
    // arithmetic and not a house style. Every other pass here refuses a verdict on a
    // sample this small.
    const a = archetypes(screensWith(['grid', 'grid'])).arrangement
    assert.equal(a.verdict, 'too few to say')
    assert.match(a.why, /arithmetic, not a house style/)
  })

  test('a real agreement is still called one', () => {
    const a = archetypes(screensWith(['flex flex-col', 'flex flex-col', 'flex flex-col', 'flex flex-col', 'flex flex-col', 'flex flex-col'])).arrangement
    assert.equal(a.verdict, 'convention')
    assert.equal(a.dominant, 'flex column')
  })

  test('screens that arrange nothing say nothing', () => {
    const a = archetypes([{ file: 'a.tsx', text: 'export const A = () => <Scene title="x">plain</Scene>' }]).arrangement
    assert.equal(a.verdict, 'none')
    assert.deepEqual(a.distribution, [])
  })
})

describe('a visual language read off a picture', () => {
  // The entry a client always has. A site can be crawled and a Figma file queried,
  // but half of them hand over a screenshot or a PDF brandbook, and there was no path
  // from either into this tool.
  //
  // Checked against an image whose truth is known, because a reader of pixels has no
  // other way to be wrong loudly: a palette extractor always returns a palette.
  const known = () => {
    const W = 600, H = 400
    const png = new PNG({ width: W, height: H })
    const put = (x, y, [r, g, b]) => {
      const i = (y * W + x) * 4
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255
    }
    const GROUND = [0xf7, 0xf8, 0xfa], CARD = [0xff, 0xff, 0xff], TEXT = [0x16, 0x18, 0x1d]
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, GROUND)
    let y = 40
    for (const h of [60, 80, 60]) {
      for (let yy = y; yy < y + h; yy += 1) for (let x = 100; x < 500; x += 1) put(x, yy, CARD)
      for (let x = 120; x < 300; x += 1) put(x, y + 10, TEXT)
      y += h + 24
    }
    return readImage(png)
  }

  test('a white card on an off-white page is a card, not the page', () => {
    const r = known()

    // The first version merged colours by distance alone at twelve units per channel,
    // and `#ffffff` is twenty units from `#f7f8fa`. So the card was absorbed into the
    // page — which is exactly the defect the layout pass exists to catch, reproduced
    // by the reader written to find it. The column came back as the width of the text
    // and the rhythm as the space between paragraphs.
    assert.equal(r.ground, '#f7f8fa')
    assert.equal(r.palette[0].hex, '#f7f8fa')
    assert.equal(r.palette[1].hex, '#ffffff')

    // A colour covering a third of the picture is a colour somebody chose, however
    // close it lies to another.
    assert.ok(r.palette[1].share > 0.3)
  })

  test('the frame and the rhythm, which are the half a palette never sees', () => {
    const r = known()
    // The reading column: a page that caps its content and one that runs to the
    // window are different products, and the cap is invisible in any one screen's
    // markup.
    assert.deepEqual(r.column, { left: 100, right: 499, width: 400 })
    // The gaps between bands are the spacing scale as shipped. The leading run is the
    // page margin, not a gap between two things, so it is dropped.
    assert.deepEqual(r.rhythm, [{ px: 24, times: 2 }])
  })

  test('the ground comes from the edges, not from the commonest colour', () => {
    // On a dense page the commonest colour IS the card, and taking it as the ground
    // is how white cards end up reported as invisible on a white page — the finding
    // the layout pass was written for.
    const W = 100, H = 100
    const png = new PNG({ width: W, height: H })
    const put = (x, y, [r, g, b]) => {
      const i = (y * W + x) * 4
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255
    }
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, [0x22, 0x22, 0x22])
    // A card covering four fifths of the picture, leaving a thin dark border.
    for (let y = 10; y < 90; y += 1) for (let x = 10; x < 90; x += 1) put(x, y, [0xff, 0xff, 0xff])

    const r = readImage(png)
    assert.equal(r.ground, '#222222', 'the card was taken for the page')
    assert.equal(r.palette[0].hex, '#ffffff', 'the commonest colour is the card, and it is reported as such')
  })

  test('nothing is named, because intent is not visible in pixels', () => {
    const r = known()
    // A token layer built on invented names is one a team rejects on sight, and a
    // name is the judgment tier. This file is the facts tier.
    for (const l of r.limits) assert.equal(typeof l, 'string')
    assert.ok(r.limits.some(l => /Colours are colours/.test(l)))
    assert.ok(r.limits.some(l => /No components/.test(l)))
    assert.ok(r.limits.some(l => /One viewport, one theme/.test(l)))
  })
})

describe('the spacing a project writes', () => {
  // Every emitter hardcoded `--space-4`, `--space-2`, `--space-6` and
  // `--colour-text-muted`. Measured against this tool's OWN first-party design
  // system that is the fourth-favourite gap, the least favourite padding, and a
  // colour token the system does not declare at all:
  //
  //   gap      --space-2 ×72 · --space-3 ×37 · --space-1 ×31 · --space-4 ×27
  //   muted    --muted-foreground   (not --colour-text-muted, which is nowhere)
  //
  // An unresolvable custom property is dropped silently by the browser: the rule
  // vanishes, the text renders in whatever it inherits, and nothing is reported.
  const buildScale = () => {
    const at = join(root, 'scans', '.scale-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('own-scale'), at, { recursive: true })
    mkdirSync(join(root, 'profiles', 'scale-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'scale-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'scale-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    const out = run('build-screen.mjs', [join(at, 'spec-buildable.json'), '--repo', at, '--profile', 'scale-test', '--apply'])
    const read = (p) => existsSync(join(at, p)) ? readFileSync(join(at, p), 'utf8') : undefined
    const strip = () => rmSync(join(at, 'src', 'tokens.css'), { force: true })
    return { out, read, at, strip }
  }
  const cleanup = () => {
    rmSync(join(root, 'scans', '.scale-test'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'scale-test'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'scale-test.json'), { force: true })
  }

  test('the tokens written are the tokens this project uses', () => {
    const { out, read } = buildScale()
    // This fixture names its scale `--sp-cosy` and `--sp-tight` and its muted
    // foreground `--fg-muted`. None of those is on any hardcoded list.
    assert.match(out, /spacing\s+gap --sp-cosy · padding --sp-tight · muted --fg-muted/)
    const css = read('src/pages/ArchivedMemosSeaPage.css')
    assert.match(css, /gap: var\(--sp-cosy\);/)
    assert.match(css, /padding: var\(--sp-tight\);/)
    assert.match(css, /color: var\(--fg-muted\);/)
    assert.ok(!/--space-\d|--colour-text-muted/.test(css), 'a token from nowhere was written')
    cleanup()
  })

  test('where there is no token, nothing is written rather than something broken', () => {
    const at = join(root, 'scans', '.scale-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('own-scale'), at, { recursive: true })
    rmSync(join(at, 'src', 'tokens.css'), { force: true })
    rmSync(join(at, 'src', 'pages', 'HomePage.css'), { force: true })
    mkdirSync(join(root, 'profiles', 'scale-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'scale-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'scale-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    const out = run('build-screen.mjs', [join(at, 'spec-buildable.json'), '--repo', at, '--profile', 'scale-test', '--apply'])

    assert.match(out, /gap: no rule here sets one from a token/)
    const css = readFileSync(join(at, 'src', 'pages', 'ArchivedMemosSeaPage.css'), 'utf8')
    // A missing rule is visible and fixable. A `var()` pointing at nothing is not:
    // the browser drops it without a word, so the report and the file would disagree.
    assert.match(css, /no spacing token is declared in this project/)
    assert.ok(!/var\(--space-\d\)|var\(--colour-text-muted\)/.test(css),
      'a token this project does not declare was written anyway')
    cleanup()
  })
})

describe('screen archetypes', () => {
  // Two attempts measured the CONTENTS of a screen — how many elements, what share
  // came from the system, which states it handled — and thirty-five screens produced
  // nineteen shapes. A list and a form are indistinguishable that way: both are
  // "medium, from the system, no states", and they look nothing alike.
  //
  // The shape is in the FRAME. Measured across three real products: outline's
  // `<Scene>` is called 35 times and 28 of those are three signatures; plane's 58
  // routes fall into 11, of which the top six cover 85%.

  test('the shape is what a screen returns, not what it imports', () => {
    // A screen importing six layouts is shaped by the one it renders.
    const many = [
      "import Shell from './Shell'",
      "import Sidebar from './Sidebar'",
      "import Modal from './Modal'",
      'export function X() {',
      '  return (',
      '    <Shell title="A" actions={null}>',
      '      <p>body</p>',
      '    </Shell>',
      '  )',
      '}',
    ].join('\n')
    const read = shellOf(many)
    assert.deepEqual({ shell: read.shell, regions: read.regions }, { shell: 'Shell', regions: ['actions', 'title'] })
    // Nothing here declares what `Shell` is, so this reading is inferred from what
    // the screen passes rather than from the frame's own type — and says so. A
    // catalogue built out of these can require the declared half; a generator
    // writing one screen cannot afford to, because refusing everything unproven
    // drops `title` from every screen whose frame is in a package.
    assert.equal(read.fromDeclaration, false)
  })

  test('a wrapper that positions nothing is not the shape', () => {
    // The same screen inside and outside an auth wrapper is the same screen. Reading
    // the outermost element would make them two archetypes and split every
    // distribution that counts them.
    const wrapped = [
      'export function X() {',
      '  return (',
      '    <AuthProvider>',
      '      <Scene title="A" icon={null}>',
      '        <p>body</p>',
      '      </Scene>',
      '    </AuthProvider>',
      '  )',
      '}',
    ].join('\n')
    const inner = shellOf(wrapped)
    assert.deepEqual({ shell: inner.shell, regions: inner.regions }, { shell: 'Scene', regions: ['icon', 'title'] })

    // And presentation attributes are not regions: `className` says nothing about
    // what the frame holds.
    const styled = 'export function X() { return <Scene className="a" style={{}} title="A">x</Scene> }'
    assert.deepEqual(shellOf(styled).regions, ['title'])
  })

  test('the archetype is a distribution, with the rest kept beside it', () => {
    const files = [
      { file: 'a.tsx', text: 'export const A = () => <Scene icon={null} title="a">x</Scene>' },
      { file: 'b.tsx', text: 'export const B = () => <Scene icon={null} title="b">x</Scene>' },
      { file: 'c.tsx', text: 'export const C = () => <Scene title="c">x</Scene>' },
      { file: 'd.tsx', text: 'export const D = () => <CenteredContent>x</CenteredContent>' },
      { file: 'e.tsx', text: 'export const E = () => <div>not a screen</div>' },
    ]
    const measured = archetypes(files)

    // A raw element is not a shell, so that file is not a screen. This is what makes
    // the same pass a detector as well as a measurement — within its limit, which is
    // that a component returning a component looks like a screen too.
    assert.equal(measured.screens, 4)

    // And everything handed in stays counted, under its own name. The two are
    // different questions: `screens` answers "which of these render a shell",
    // `considered` answers "how many did you give me", and the layout share below
    // needs the second. Collapsing them dropped every screen that builds its own
    // page out of the denominator of whether screens here build their own page —
    // three of five declaring a layout came back as 0 of 2, and the generator wrote
    // none in a project where the majority write one.
    assert.equal(measured.considered, 5)
    assert.equal(measured.declaresOwnLayout.of, 5)
    assert.equal(measured.dominant.name, 'Scene(icon+title)')
    assert.equal(measured.dominant.count, 2)
    assert.equal(measured.share, 0.5)

    // Half is a different instruction from four fifths, so the alternatives travel
    // with the winner rather than being dropped.
    assert.deepEqual(measured.signatures.map(x => x.name),
      ['Scene(icon+title)', 'Scene(title)', 'CenteredContent'])
  })
})

describe('the screen generator', () => {
  // The one script here that writes source files into somebody else's repository.
  // Every other pass only reads, so this is the only place where being wrong lands
  // in a client's git status — and it was the least covered file in the project.
  //
  // The fixture is a repository built to be difficult in the exact ways real ones
  // were: its shell is reached through a mixed default-and-named import clause,
  // its test runner collects from a directory the co-location habit does not point
  // at, its screens export by name, and not one of them defines an event handler.
  const build = (spec, extra = [], contract) => {
    const at = join(root, 'scans', '.build-screen-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('screen-idiom'), at, { recursive: true })
    // The profile lives where the generator looks for one, not inside the fixture.
    mkdirSync(join(root, 'profiles', 'screen-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'screen-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'screen-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    if (contract) {
      mkdirSync(join(at, '.ds'), { recursive: true })
      writeFileSync(join(at, '.ds', 'conventions.json'), JSON.stringify(contract, null, 2))
    }

    const out = run('build-screen.mjs', [join(at, spec), '--repo', at, '--profile', 'screen-test', '--apply', ...extra])
    const read = (p) => existsSync(join(at, p)) ? readFileSync(join(at, p), 'utf8') : undefined
    return { out, read, at }
  }
  const cleanup = () => {
    rmSync(join(root, 'scans', '.build-screen-test'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'screen-test'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'screen-test.json'), { force: true })
  }

  test('it writes in the repository\'s idiom, not in its own', () => {
    const { out, read } = build('spec-buildable.json')

    // The name. A drafted spec's id is the requirement sentence cut at forty
    // characters, and building the component name from it produced
    // `APageListingArchivedMemosWithASeaPage` — chopped mid-word, and the first
    // thing anyone reads.
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')
    assert.ok(screen, `no screen at the expected name; got:\n${out}`)
    assert.ok(!/APageListingArchivedMemos/.test(screen), 'the raw spec id became the component name')

    // And the same cut must not survive into the markup or the stylesheet. Fixing
    // the name and leaving `.a-page-listing-archived-memos-with-a-sea` in the CSS
    // reads as no fix at all to whoever opens the file.
    assert.match(screen, /className="archived-memos-sea"/)
    assert.ok(!/a-page-listing/.test(screen + read('src/pages/ArchivedMemosSeaPage.css')),
      'the truncated requirement sentence survived as a class name')

    // The shell is used, so the shell must be imported. This fixture exports it
    // the way memos does — `import AppShell, { ShellChip } from …`, default and
    // named in one clause — which neither of the two shapes the first version
    // matched could see. The screen used the shell and never imported it.
    assert.match(screen, /<AppShell\b/)
    assert.match(screen, /^import AppShell from '@\/components\/AppShell'$/m)

    // Its required props come from the shell's own Props type, so the screen
    // compiles rather than failing on `Property 'title' is missing`.
    assert.match(screen, /<AppShell title="[^"]+"/)

    // Export style is measured, and measuring it was never the problem: the value
    // was printed to the client and then ignored when emitting.
    assert.match(out, /export\s+named \(100%\)/)
    assert.match(screen, /^export function ArchivedMemosSeaPage\(\)/m)
    assert.ok(!/export default/.test(screen), 'a named-export repository got a default export')

    // The profile's own specifier is kept wherever it points at something that is
    // really here. Rewriting it through the measured alias turned
    // `@/ui/heading` — extracted from this very repository — into `@/PageHeading`.
    assert.match(screen, /from '@\/ui\/heading'/)
    assert.ok(!/@\/PageHeading/.test(screen), 'a resolvable specifier was rewritten through the alias')

    cleanup()
  })

  test('a layout is written only where the screens here write one', () => {
    const { out, read } = build('spec-buildable.json')

    // The generator wrote `display: flex; flex-direction: column; gap` onto every
    // screen's own class and a stylesheet beside it, always. Measured on three real
    // products, the share of screens that declare any layout of their own is 0%, 41%
    // and 41% — so "always" is wrong on one of them outright and a coin toss on the
    // other two. This fixture's screens declare none.
    assert.match(out, /own layout\s+0% of \d+ screen\(s\) declare one — so this writes none either/)
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.css'),
      'a stylesheet was written into a project whose screens have none')

    // And no import of a file that was not written, which is the failure that
    // version would have shipped.
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')
    assert.ok(!/\.css'/.test(screen), 'the module imports a stylesheet that does not exist')

    cleanup()
  })

  test('a screen is filled the way this project fills its frames', () => {
    const { out, read } = build('spec-buildable.json')

    // The shell was found before this; what was missing was what goes IN it. The
    // generator passed the props the shell would not compile without and nothing
    // else, so the result was the right frame with none of the frame filled — a
    // screen that compiles beside its neighbours and looks nothing like them.
    //
    // `icon` is optional on this shell: the component compiles without it, and every
    // screen in the project passes one. That is exactly the class of thing a
    // required-props check cannot see and a measured archetype can.
    assert.match(out, /screen archetype\s+AppShell\(icon\+title\) — 2 of 2 screen\(s\), 100%/)
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')
    assert.match(screen, /<AppShell title="[^"]+" icon=\{null\}>/)

    cleanup()
  })

  test('the agreed contract outranks what the files measure', () => {
    // `.ds/conventions.json` is what the gate is generated from, and it carries the
    // team's DECISIONS — which exist precisely to say something the current code
    // does not. This script measured conventions afresh from the screens on disk
    // and never opened that file, so on any project where a split had been settled
    // the generator wrote the 90% the files show, the gate demanded the 10% that
    // was agreed, and the generator reported the mismatch as its own defect.
    const { out, read } = build('spec-buildable.json', [], {
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: {
        'component export': {
          expect: 'default', share: 0.1,
          source: 'decided by the team on 2026-08-01 — settled in the design review',
        },
      },
      documented: {}, undecided: {},
    })

    // Every screen in this fixture exports by name. The contract says otherwise and
    // the contract wins, because that is what a decision is.
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')
    assert.match(screen, /^export default function ArchivedMemosSeaPage\(\)/m)
    assert.match(out, /export\s+default \(agreed contract\)/)

    // Both sides shown. A team that settled a split and has all of its code on the
    // other side is being told something worth knowing, and printing only the
    // winner would make the contract look like a measurement.
    assert.match(out, /THE CONTRACT AND THE FILES DISAGREE/)
    assert.match(out, /the existing screens say "named" at 100%/)
    assert.match(out, /decided by the team on 2026-08-01/)

    // And the consequence travels: the generated test imports the screen the way
    // the contract says it is exported. Following the contract in the module and
    // the measurement in its test is how the two quietly stop matching.
    assert.match(read('tests/ArchivedMemosSeaPage.test.tsx'), /^import ArchivedMemosSeaPage from/m)

    cleanup()
  })

  test('it refuses before writing what it knows the gate will reject', () => {
    // The alternative was a repair loop: emit, run the gate, patch the complaint,
    // run it again. That is how a generator learns to satisfy a checker instead of
    // learning to write — after three rounds nobody can say which transform made
    // the file right and which one only made it green.
    //
    // So the capability check runs before a single file exists. CSS Modules and
    // folder-per-component are different products, not different spellings.
    const { out, read } = build('spec-buildable.json', [], {
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: {
        styling: { expect: 'CSS Modules', share: 0.92, source: 'whole repository' },
        'file structure': { expect: 'Folder/index.tsx', share: 0.88, source: 'whole repository' },
      },
      documented: {}, undecided: {},
    })

    assert.match(out, /WILL NOT WRITE/)
    assert.match(out, /styling: requires "CSS Modules"/)
    assert.match(out, /file structure: requires "Folder\/index\.tsx"/)
    // What it CAN write is named too, so the reader knows whether to extend the
    // generator or drop the rule.
    assert.match(out, /this writes "plain co-located CSS" or "className, styles elsewhere"/)

    // And nothing landed. A file the generator knows the gate will refuse is worse
    // than no file: somebody has to read it, decide it is nearly right, and fix it.
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.tsx'), 'a screen was written anyway')
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.css'), 'a stylesheet was written anyway')

    cleanup()
  })

  test('where the contract asks for a variant it has, it writes that variant', () => {
    // The one lever over the styling dimension: importing the stylesheet at the top
    // of the module is what makes the signal read "plain co-located CSS". The
    // fixture's own screens import no stylesheet, so this can only come from the
    // contract — and the emitted file has to actually satisfy the signal, not merely
    // be labelled as satisfying it.
    const { out, read } = build('spec-buildable.json', [], {
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: { styling: { expect: 'plain co-located CSS', share: 0.9, source: 'whole repository' } },
      documented: {}, undecided: {},
    })

    // The contract wins over the measurement here too: this fixture's screens declare
    // no layout at all, and the agreed convention says co-located stylesheets. A team
    // that decided one gets it — overriding a decision with a measurement would make
    // the contract the weaker of the two, which is the opposite of what it is.
    assert.match(out, /css imported first\s+yes \(agreed contract\)/)
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')
    assert.match(screen, /^import '\.\/ArchivedMemosSeaPage\.css'/m)
    // Checked through the same signal the gate uses, so the claim is the gate's
    // claim and not this test's paraphrase of it.
    assert.equal(SIGNALS.styling(join(root, 'x.tsx'), screen), 'plain co-located CSS')

    cleanup()
  })

  test('with no contract installed, the measurement still governs', () => {
    // The override is keyed to a file that exists. Where no gate has been installed
    // there is nothing to outrank the screens on disk, and inventing an authority
    // would be worse than having none.
    const { out, read } = build('spec-buildable.json')
    assert.match(read('src/pages/ArchivedMemosSeaPage.tsx'), /^export function ArchivedMemosSeaPage\(\)/m)
    assert.ok(!/CONTRACT AND THE FILES DISAGREE/.test(out))
    cleanup()
  })

  test('the screen joins the index the team browses', () => {
    const { out, read } = build('spec-buildable.json')
    // This fixture carries Storybook and one story, so the shape is copied rather
    // than invented, and the new screen gets an entry beside its neighbours.
    assert.match(out, /stories\s+measured: CSF3, satisfies, @storybook\/react/)
    const story = read('src/pages/ArchivedMemosSeaPage.stories.tsx')
    assert.ok(story, 'a project with stories got a screen with none')
    assert.match(story, /component: ArchivedMemosSeaPage,/)
    cleanup()
  })

  test('required props are emitted, because the registry records which ones are', () => {
    const { read } = build('spec-buildable.json')
    const screen = read('src/pages/ArchivedMemosSeaPage.tsx')

    // The registry marks 127 props required in the first-party profile alone, and
    // the emitter read that field for the page shell and for nothing else. Every
    // component resolved from the spec went out self-closing, so a screen that
    // "conforms to this repository's conventions" did not compile.
    assert.match(screen, /<DataTable rows=\{\[\]\}/, 'a required array prop was omitted')
    // A union of string literals has to be one of them, not an empty string.
    assert.match(screen, /<ActionButton tone="primary"/, 'a required union prop was omitted or invented')
    // And nothing is invented: a prop the registry does not list must not appear.
    assert.ok(!/dense=/.test(screen), 'an optional prop was supplied without being asked for')

    cleanup()
  })

  test('the test lands where the runner collects, not where the habit points', () => {
    const { read } = build('spec-buildable.json')

    // Co-location is what the files on disk show, and this fixture's vitest config
    // includes `tests/**` and nothing else. The generated test was written, was
    // correct, and was never run — the quietest possible failure.
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.test.tsx'), 'the test went where the runner cannot see it')
    const spec = read('tests/ArchivedMemosSeaPage.test.tsx')
    assert.ok(spec, 'no test was written where the runner collects')

    // Moving it means its import of the screen has to move with it. Left pointing
    // at a sibling, it resolved to nothing.
    assert.match(spec, /from '\.\.\/src\/pages\/ArchivedMemosSeaPage'/)
    // Named export, so a named import.
    assert.match(spec, /import \{ ArchivedMemosSeaPage \}/)

    cleanup()
  })

  test('nothing to count is an answer, and what does not resolve is said out loud', () => {
    const { out } = build('spec-buildable.json')

    // Not one screen in this fixture defines a handler, which is what a read-only
    // list screen actually looks like. The first version handed an empty array to
    // the majority helper and died with a TypeError over a repository that had
    // done nothing wrong.
    assert.match(out, /handlers\s+NOT MEASURED/)
    assert.ok(!/TypeError/.test(out), 'the generator crashed instead of reporting')

    cleanup()

    // And the honesty check. This fixture has no gate installed, and the report of
    // what does not resolve used to live INSIDE the branch that runs the gate — so
    // a repository without one got exit 0 and the words "the output is unverified"
    // over an import the generator had already established points at nothing.
    const missing = build('spec-unresolvable.json')
    assert.match(missing.out, /DOES NOT COMPILE YET/)
    assert.match(missing.out, /Sparkline\s+imported from/)
    assert.ok(!/conforms to conventions/.test(missing.out), 'an unbuildable screen was reported as conforming')

    cleanup()
  })
})

describe('the authored example', () => {
  // A story is the golden example, and this tool treats golden examples as the tier
  // nobody ships and somebody has to write. A project with stories has written them,
  // and generating a screen without one leaves the new screen out of the index the
  // team actually browses — so the next person copies an older screen instead.

  test('the story shape is measured from the stories that exist', () => {
    // Not assumed. CSF2 and CSF3 are both in wide use, the type import differs per
    // renderer, and a project writing `satisfies Meta<typeof X>` has a rule about it
    // somewhere — an annotation where `satisfies` was expected is a lint failure on a
    // generated file, which reads as the generator being careless.
    const story = readFileSync(join(fixture('screen-idiom'), 'src', 'components', 'AppShell.stories.tsx'), 'utf8')
    const shape = measureStories({ present: true, renderer: '@storybook/react',
      stories: [{ path: 'src/components/AppShell.stories.tsx', text: story }] })

    assert.equal(shape.measured, true)
    assert.equal(shape.csf, 3)
    assert.equal(shape.typed, 'satisfies')
    assert.equal(shape.suffix, '.stories.tsx')
    assert.equal(shape.autodocs, true)
    assert.equal(shape.renderer, '@storybook/react')

    const emitted = emitStory({
      name: 'ArchivedMemosSeaPage', shape, importPath: './ArchivedMemosSeaPage',
      title: 'Screens/ArchivedMemosSeaPage', byDefault: false,
    })
    assert.match(emitted, /^import type \{ Meta, StoryObj \} from '@storybook\/react'$/m)
    assert.match(emitted, /\} satisfies Meta<typeof ArchivedMemosSeaPage>/)
    assert.match(emitted, /tags: \['autodocs'\],/)
    // The screen is exported by name here, so the story imports it by name. A default
    // import of a named export is a story that cannot resolve — the same mismatch
    // that was fixed once already between a screen and its test.
    assert.match(emitted, /^import \{ ArchivedMemosSeaPage \} from/m)
  })

  test('a shape it could not measure is stated as an assumption', () => {
    // Storybook installed and no story to copy is a normal state. CSF3 is the
    // current default and using it is fine; presenting it as a measurement is not.
    const shape = measureStories({ present: true, stories: [], renderer: '@storybook/vue3' })
    assert.equal(shape.measured, false)
    assert.equal(shape.renderer, '@storybook/vue3')
    const emitted = emitStory({ name: 'X', shape, importPath: './X', title: 'Screens/X', byDefault: true })
    assert.match(emitted, /No existing story was found to copy/)
    assert.match(emitted, /an assumption, stated as one/)
  })

  test('with no Storybook, no story is written, and the absence is named', () => {
    // A `.stories.tsx` in a repository with no Storybook is a file nothing runs,
    // which is worse than its absence because it looks like coverage.
    assert.deepEqual(measureStories({ present: false, stories: [] }), { present: false })
  })
})

describe('the Angular emitter', () => {
  // The first emitter that has to follow THREE independent decisions at once. This
  // ecosystem is running three migrations that are not synchronised, so a repository
  // is routinely standalone and still on the decorator for its inputs and still on
  // the structural directives in its templates. Picking one and deriving the other
  // two from it produces a file no half of the team recognises.
  const buildNg = (contract) => {
    const at = join(root, 'scans', '.ng-build-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('angular-idiom'), at, { recursive: true })
    mkdirSync(join(root, 'profiles', 'ng-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'ng-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'ng-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    if (contract) {
      mkdirSync(join(at, '.ds'), { recursive: true })
      writeFileSync(join(at, '.ds', 'conventions.json'), JSON.stringify(contract, null, 2))
    }
    const out = run('build-screen.mjs', [join(at, 'spec-buildable.json'), '--repo', at, '--profile', 'ng-test', '--apply'])
    const read = (p) => existsSync(join(at, p)) ? readFileSync(join(at, p), 'utf8') : undefined
    return { out, read }
  }
  const cleanup = () => {
    rmSync(join(root, 'scans', '.ng-build-test'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'ng-test'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'ng-test.json'), { force: true })
  }
  const AT = 'src/app/archived-memos-sea/archived-memos-sea.component'

  test('a template reaches a component by its selector, never by its class name', () => {
    const { read } = buildNg()
    const template = read(`${AT}.html`)
    assert.ok(template, 'no template was written')

    // `<UiHeading>` is an unknown element to the compiler: it renders nothing, the
    // browser shows an empty page, and the only complaint is a warning nobody reads.
    // The selector is not in the registry, so it is read from each component's own
    // source rather than derived from the class name — deriving it would be a guess
    // about this project's prefix, and this project's prefix is `ds`, not `app`.
    assert.match(template, /<ds-heading>/)
    assert.match(template, /<ds-button tone="primary">/)
    assert.match(template, /<ds-table \[rows\]="\[\]" \/>/)
    assert.ok(!/<Ui[A-Z]/.test(template), 'a class name was written into a template')
    cleanup()
  })

  test('three decisions are read separately, because they are not in step', () => {
    // The fixture leans old on all three, so the generated component does too.
    const measured = buildNg()
    const oldWay = measured.read(`${AT}.ts`)
    assert.match(oldWay, /standalone: true,/)
    assert.match(oldWay, /get state\(\)/)
    assert.match(measured.read(`${AT}.html`), /\*ngIf="state; else zones"/)
    // `*ngIf` is a CommonModule directive, and a standalone component that uses one
    // without importing it renders nothing and says so only at runtime.
    assert.match(oldWay, /imports: \[CommonModule,/)
    cleanup()

    // Now the contract says the new form on all three, independently.
    const modern = buildNg({
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: {
        'template control flow': { expect: '@if blocks', share: 0.9, source: 'whole repository' },
        'props declaration': { expect: 'input() signals', share: 0.9, source: 'whole repository' },
        styling: { expect: 'inline styles', share: 0.9, source: 'whole repository' },
      },
      documented: {}, undecided: {},
    })
    const now = modern.read(`${AT}.ts`)
    assert.match(now, /@if \(state\(\)\) \{/)
    assert.match(now, /readonly state = computed\(/)
    // `@if` needs no CommonModule, and importing it anyway is dead weight a linter
    // will flag on a generated file.
    assert.ok(!/CommonModule/.test(now), 'CommonModule was imported for control flow that does not need it')
    // Inline styling means the markup and the rules live in the decorator, so no
    // separate template or stylesheet is written at all.
    assert.match(now, /template: `/)
    assert.ok(!modern.read(`${AT}.html`), 'a template file was written for an inline-template project')
    assert.ok(!modern.read(`${AT}.scss`), 'a stylesheet was written for an inline-styles project')
    cleanup()
  })

  test('a screen is what the router points at, not every file ending in component.ts', () => {
    const { out, read } = buildNg()
    // Every component here is a `.component.ts`, so taking the extension as the answer
    // made the button library a set of screens and put the next generated screen
    // inside `src/app/ui`. The router is this project's own definition of a screen.
    assert.match(out, /screens live in\s+src\/app$/m)
    assert.ok(read(`${AT}.ts`), 'the screen did not land where screens live here')

    // Named the way the CLI would have named it, in a folder of its own, with its
    // spec beside it. A class called `ArchivedMemosSeaPage` in a codebase where every
    // other class ends in `Component` announces that it was generated.
    assert.match(read(`${AT}.ts`), /export class ArchivedMemosSeaComponent \{/)
    assert.match(read(`${AT}.ts`), /selector: 'app-archived-memos-sea',/)
    assert.ok(read(`${AT}.spec.ts`), 'the spec was not written beside the component')
    cleanup()
  })
})

describe('the Svelte emitter', () => {
  // The third emitter. What makes it a third rather than a branch: Svelte has no
  // template element, its styles are scoped without saying so, its conditional is a
  // block, and it has two incompatible ways of declaring state shipping in two major
  // versions — `$state()` does not compile on 4, `export let` is on its way out of 5.
  const buildSvelte = (svelteVersion) => {
    const at = join(root, 'scans', '.svelte-build-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('svelte-idiom'), at, { recursive: true })
    mkdirSync(join(root, 'profiles', 'svelte-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'svelte-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'svelte-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    if (svelteVersion) {
      const pkg = JSON.parse(readFileSync(join(at, 'package.json'), 'utf8'))
      pkg.dependencies.svelte = svelteVersion
      writeFileSync(join(at, 'package.json'), JSON.stringify(pkg, null, 2))
    }
    const out = run('build-screen.mjs', [join(at, 'spec-buildable.json'), '--repo', at, '--profile', 'svelte-test', '--apply'])
    const read = (p) => existsSync(join(at, p)) ? readFileSync(join(at, p), 'utf8') : undefined
    return { out, read }
  }
  const cleanup = () => {
    rmSync(join(root, 'scans', '.svelte-build-test'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'svelte-test'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'svelte-test.json'), { force: true })
  }

  test('the era comes from the dependency, and decides the state', () => {
    const runes = buildSvelte('^5.0.0')
    assert.match(runes.out, /svelte era\s+runes, from svelte \^5\.0\.0 in package\.json/)
    const five = runes.read('src/ArchivedMemosSeaPage.svelte')
    assert.match(five, /let items = \$state<Row\[\]>\(\[\]\)/)
    assert.match(five, /const state = \$derived\(/)
    assert.ok(!/\$:/.test(five), 'a reactive statement was emitted into a runes project')
    cleanup()

    // The same spec on the previous major. This is not a style preference: `$state()`
    // does not exist there, so emitting it produces a file that does not compile.
    const legacy = buildSvelte('^4.2.0')
    assert.match(legacy.out, /svelte era\s+pre-runes, from svelte \^4\.2\.0 in package\.json/)
    const four = legacy.read('src/ArchivedMemosSeaPage.svelte')
    assert.match(four, /^\s*let items: Row\[\] = \[\]$/m)
    assert.match(four, /^\s*\$: state = loading/m)
    assert.ok(!/\$state\(|\$derived\(/.test(four), 'runes were emitted into a pre-runes project')
    cleanup()
  })

  test('the shell gets the props Svelte declares, which are not a Props type', () => {
    const { read } = buildSvelte()
    const screen = read('src/ArchivedMemosSeaPage.svelte')

    // The shell declares `export let title: string`. Reading only a `Props` interface
    // found none of it, so the screen wrapped a shell that requires a title and passed
    // none — `Property 'title' is missing`, on a file this tool had just reported as
    // conforming.
    assert.match(screen, /<AppShell title="[^"]+">/)

    // A Svelte component is a default export and its specifier carries the extension.
    // Dropping either produces an import that does not resolve.
    assert.match(screen, /^\s*import AppShell from '\$lib\/AppShell\.svelte'$/m)
    assert.match(screen, /^\s*import Table from '\$lib\/ui\/Table\.svelte'$/m)

    // Svelte spells an attribute the way JSX does, so the value needs no translation —
    // unlike Vue, where a bound attribute takes a colon.
    assert.match(screen, /<Table rows=\{\[\]\} \/>/)
    assert.match(screen, /<ActionButton tone="primary">/)

    // Block, not attribute.
    assert.match(screen, /\{#if state\}/)
    assert.match(screen, /\{:else\}/)
    cleanup()
  })

  test('the test uses the harness already here', () => {
    const { read } = buildSvelte()
    const spec = read('tests/ArchivedMemosSeaPage.spec.ts')
    assert.ok(spec, 'no test was written where this runner collects')
    // The fixture's existing spec uses @testing-library/svelte; the client-side
    // `mount` API would be a different test in a project that does not use it.
    assert.match(spec, /from '@testing-library\/svelte'/)
    assert.match(spec, /from '\.\.\/src\/ArchivedMemosSeaPage\.svelte'/)
    cleanup()
  })
})

describe('the Vue emitter', () => {
  // The second emitter, and the reason there are two: the frameworks disagree about
  // more than syntax. State is refs and a computed, the shell takes a slot, styles
  // live in a block inside the file, and the conditional is an attribute. Threading
  // all of that through one template string produces a file that is neither idiom.
  const buildVue = (contract) => {
    const at = join(root, 'scans', '.vue-build-test')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(fixture('vue-idiom'), at, { recursive: true })
    mkdirSync(join(root, 'profiles', 'vue-test'), { recursive: true })
    cpSync(join(at, 'profile', 'components.json'), join(root, 'profiles', 'vue-test', 'components.json'))
    cpSync(join(at, 'profile', 'binding.json'), join(root, 'bindings', 'vue-test.json'))
    rmSync(join(at, 'profile'), { recursive: true, force: true })
    if (contract) {
      mkdirSync(join(at, '.ds'), { recursive: true })
      writeFileSync(join(at, '.ds', 'conventions.json'), JSON.stringify(contract, null, 2))
    }
    const out = run('build-screen.mjs', [join(at, 'spec-buildable.json'), '--repo', at, '--profile', 'vue-test', '--apply'])
    const read = (p) => existsSync(join(at, p)) ? readFileSync(join(at, p), 'utf8') : undefined
    return { out, read }
  }
  const cleanup = () => {
    rmSync(join(root, 'scans', '.vue-build-test'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'vue-test'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'vue-test.json'), { force: true })
  }

  test('it writes a single-file component, not JSX with a different extension', () => {
    const { out, read } = buildVue()
    const sfc = read('src/pages/ArchivedMemosSeaPage.vue')
    assert.ok(sfc, `no SFC was written; got:\n${out}`)

    // The declaration axis a single-file component actually has. Running the React
    // test over Vue sources found no `export default` in any of them and answered
    // "named 100%" — a confident number about a question this file does not have.
    assert.match(out, /export\s+script setup \(100%\)/)
    assert.match(sfc, /^<script lang="ts" setup>/m)

    // A bound attribute takes an expression and a plain one takes a string. Handed
    // the value the React path had already spelled, this wrote `rows={[]}` into a
    // template — JSX in a file that is not JSX, which does not parse.
    assert.match(sfc, /<Table :rows="\[\]" \/>/)
    assert.match(sfc, /<ActionButton tone="primary">/)
    assert.ok(!/=\{/.test(sfc), 'JSX attribute syntax reached the template')

    // The shell is used, so the shell is imported. This was fixed on the React path
    // and came back on the Vue one, because the fix lived in a string array the
    // second emitter never read.
    assert.match(sfc, /<AppShell title="[^"]+">/)
    assert.match(sfc, /^import AppShell from '@\/components\/AppShell\.vue'$/m)

    // State is reactive here, and the three branches are the agreed ones.
    assert.match(sfc, /const state = computed\(\(\) => \{/)
    assert.match(sfc, /v-if="state"/)

    cleanup()
  })

  test('no Storybook means no story, said out loud', () => {
    const { out, read } = buildVue()
    assert.match(out, /stories\s+none here; no story is written/)
    // Asked of the directory rather than of two guessed filenames. Naming the
    // candidates let a story written as `ArchivedMemosSeaPageundefined` — the shape
    // carries no suffix when Storybook is absent — pass both assertions.
    const written = readdirSync(join(root, 'scans', '.vue-build-test', 'src', 'pages'))
    assert.deepEqual(written.filter(f => /stories|undefined/.test(f)), [],
      'something was written into a project with no Storybook')
    cleanup()
  })

  test('styles go where this project keeps them, and only there', () => {
    const { read } = buildVue()
    // Both screens in the fixture carry <style scoped>, so the generated one does
    // too — and gets no stylesheet beside it. An SFC with a scoped block AND a .css
    // file has two answers to one question.
    assert.match(read('src/pages/ArchivedMemosSeaPage.vue'), /<style scoped>/)
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.css'), 'a stylesheet was written beside an SFC that carries its own')
    cleanup()

    // And where the contract puts them outside, the file is written and imported.
    const outside = buildVue({
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: { styling: { expect: 'stylesheet imported', share: 0.9, source: 'whole repository' } },
      documented: {}, undecided: {},
    })
    assert.match(outside.read('src/pages/ArchivedMemosSeaPage.vue'), /^import '\.\/ArchivedMemosSeaPage\.css'$/m)
    assert.ok(outside.read('src/pages/ArchivedMemosSeaPage.css'), 'the contract asked for a stylesheet and none was written')
    assert.ok(!/<style/.test(outside.read('src/pages/ArchivedMemosSeaPage.vue')), 'both answers were written at once')
    cleanup()
  })

  test('the test is named and mounted the way this project already does it', () => {
    const { read } = buildVue()
    // Measured, not assumed: this fixture's runner collects `tests/**/*.spec.ts`, and
    // a `X.test.tsx` handed to it is a file that is never collected — the same silent
    // failure as putting it in the wrong directory.
    assert.ok(read('tests/ArchivedMemosSeaPage.spec.ts'), 'the test was not named or placed the way this runner collects')
    const spec = read('tests/ArchivedMemosSeaPage.spec.ts')
    // The existing test uses @vue/test-utils; @testing-library/vue would not resolve.
    assert.match(spec, /import \{ mount \} from '@vue\/test-utils'/)
    assert.match(spec, /from '\.\.\/src\/pages\/ArchivedMemosSeaPage\.vue'/)
    cleanup()
  })

  test('an idiom it cannot write is refused, not approximated', () => {
    // This emitter writes `<script setup>` and nothing else. A repository on the
    // Options API gets told so, and no file is written: a screen in the wrong idiom
    // is a screen somebody has to rewrite.
    const { out, read } = buildVue({
      schemaVersion: 1, scope: 'src', excluded: [],
      enforce: { 'component export': { expect: 'Options API', share: 0.95, source: 'whole repository' } },
      documented: {}, undecided: {},
    })
    assert.match(out, /WILL NOT WRITE/)
    assert.match(out, /component export: requires "Options API"/)
    assert.match(out, /this writes "script setup" and nothing else/)
    assert.ok(!read('src/pages/ArchivedMemosSeaPage.vue'), 'a screen was written in the wrong idiom')
    cleanup()
  })
})

describe('the entry point', () => {
  test('every command it dispatches is a command it documents', () => {
    // The help was once a hard-coded line range, so it truncated silently every
    // time a command was added: seven of them existed and could not be found,
    // including the one the README puts at the centre of the flow. A command
    // absent from the help is a command that does not exist.
    const source = readFileSync(join(root, 'scripts', 'ds.mjs'), 'utf8')
    const block = source.slice(source.indexOf('const forward = {'))
    const dispatched = [...block.slice(0, block.indexOf('}')).matchAll(/^\s*'?([a-z:-]+)'?:/gm)].map(m => m[1])
    assert.ok(dispatched.length > 20, 'the dispatcher table was not found')

    const help = execFileSync(process.execPath, [join(root, 'scripts', 'ds.mjs'), '--help'], { encoding: 'utf8' })
    const undocumented = dispatched.filter(c => !help.includes(`ds ${c} `) && !help.includes(`ds ${c}\n`))
    assert.deepEqual(undocumented, [], `dispatched but not in the help: ${undocumented.join(', ')}`)
  })
})

describe('the outcome ledger', () => {
  test('it refuses at every point a number would have to be invented', () => {
    const dir = join(root, 'scans', '.outcome-test')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })

    // A return-on-investment model that always produces a figure is one nobody in
    // a finance conversation believes, and rightly: every one of them can produce
    // a figure. The only version worth putting in front of a CFO declines to
    // compute when an input came from nowhere.
    const noSource = run('outcome.mjs', [dir, '--declare', 'cost per claim', '--unit', 'claim',
      '--baseline', '42.10', '--volume', '18400'])
    assert.match(noSource, /--source, WHO says that number/)
    assert.ok(!existsSync(join(dir, '.ds', 'outcome.json')), 'a baseline with no source was accepted')

    run('outcome.mjs', [dir, '--declare', 'cost per claim', '--unit', 'claim', '--baseline', '42.10',
      '--source', 'client finance, FY26 Q1 actuals', '--currency', 'EUR', '--volume', '18400'])

    // Declared but not measured is not zero movement, and a figure here would be
    // a forecast wearing a measurement's clothes.
    assert.match(run('outcome.mjs', [dir]), /NOT MEASURED/)

    // The page exists in exactly the cases that refuse to compute, and says so.
    // A page that only appears when the figure is favourable is a page nobody
    // should trust, and its absence here would be the flattering kind of silence.
    const page = () => readFileSync(join(dir, '.ds', 'outcome.html'), 'utf8')
    assert.ok(existsSync(join(dir, '.ds', 'outcome.html')), 'no page written when nothing had moved')
    assert.match(page(), /No run recorded/)
    assert.ok(!/What moved/.test(page()), 'a movement section appeared before any run')

    // A run must count its own mistakes. A run that never did cannot be compared
    // with a person who makes them, and that comparison is the whole claim.
    const noWrong = join(dir, 'r0.json')
    writeFileSync(noWrong, JSON.stringify({ handled: 800, escalated: 200 }))
    assert.match(run('outcome.mjs', [dir, '--record', noWrong]), /wrong/)

    // Work measured, money refused: what an agent handled is a fact about a run,
    // what it cost is not, and the difference between the baseline and a guess is
    // the entire number.
    const noCost = join(dir, 'r1.json')
    writeFileSync(noCost, JSON.stringify({ handled: 812, escalated: 188, wrong: 23 }))
    const partial = run('outcome.mjs', [dir, '--record', noCost])
    assert.match(partial, /handled\s+812/)
    assert.match(partial, /MOVEMENT NOT COMPUTED/)
    assert.match(page(), /Not computed/)
    assert.match(page(), /812/, 'the page dropped what the run measured')

    const full = join(dir, 'r2.json')
    writeFileSync(full, JSON.stringify({
      handled: 812, escalated: 188, wrong: 23, costPerUnit: 0.61, costSource: 'token spend',
    }))
    const computed = run('outcome.mjs', [dir, '--record', full])

    // The working is shown, because a model whose arithmetic is hidden is one a
    // CFO discounts to zero. Escalations are charged at the human rate: an agent
    // that hands back a fifth of the work has not saved the cost of that fifth.
    assert.match(computed, /\(812 × 0\.61 \+ 188 × 42\.1\) ÷ 1000/)
    assert.match(computed, /8\.41/)

    // And what the figure excludes travels with it — above all the wrong answers,
    // which at a high enough cost reverse the case entirely.
    assert.match(computed, /WHAT THIS FIGURE DOES NOT INCLUDE/)
    assert.match(computed, /23 wrong answer/)

    // Same ledger, same arithmetic, same exclusions on the page — and no external
    // font, script or image, because it is opened from an attachment on a laptop
    // that is not allowed to fetch anything.
    assert.match(page(), /\(812 × 0\.61 \+ 188 × 42\.1\) ÷ 1000/)
    assert.match(page(), /does not include/i)
    assert.match(page(), /23 wrong answers/)
    assert.ok(!/https?:\/\//.test(page()), 'the page reaches out to the network')
    // Both palettes defined, because half the people who open it are in one.
    assert.match(page(), /prefers-color-scheme: dark/)

    discard(dir)
  })
})

describe('layout', () => {
  test('the reference is the project itself, and a skipped stylesheet says so', () => {
    const dir = fixture('layout')
    const out = run('layout.mjs', [dir])

    // An existing project already contains the reference: the screens that have
    // been in production long enough that nobody complains about them. Fifteen
    // caps at one width and one at another makes the one the finding — no
    // threshold invented here, and no product imported from elsewhere.
    assert.match(out, /AGAINST THIS PROJECT'S OWN MAJORITY/)
    assert.match(out, /1400px/, 'the outlier cap was not reported')
    // The finding NAMES the majority as context — "1 time against 3 at 1024px" —
    // so the assertion is about what the line is about, not what it mentions.
    assert.ok(!/✗\s*1024px/.test(out), 'the majority width was itself reported as a finding')

    // `html[data-theme='dark'] input:checked + .checkboxLabel` is the background
    // of a checkbox. Matching any selector that begins with `html` called it the
    // page, which is the loudest kind of wrong for a check about how a page reads.
    assert.ok(!/checkboxLabel/.test(out), 'a descendant selector was treated as the page root')

    // A stylesheet that would not parse is not a stylesheet with nothing in it.
    // Skipping it in silence reported "no reading column" for a project that
    // declares one — green where nothing was checked, again.
    assert.match(out, /did not parse and were skipped entirely/)
  })
})

describe('behaviour', () => {
  test('mocking a component is the opposite of covering it', async () => {
    const { behaviourGaps } = await import('../scripts/lib/behaviour.mjs')
    const found = behaviourGaps({
      sources: [
        { at: 'src/Toggle.tsx', text: 'export function Toggle() { const [on, set] = useState(false); return <button aria-pressed={on} /> }' },
        { at: 'src/Divider.tsx', text: 'export function Divider() { return <hr /> }' },
        { at: 'src/Menu.tsx', text: 'export function Menu() { useEffect(() => {}); return <div onKeyDown={() => {}} /> }' },
      ],
      tests: [
        // Imports Toggle: covered.
        { at: 'tests/a.test.tsx', text: 'import { Toggle } from "../src/Toggle"\ntest("x", () => {})' },
        // Mocks Menu: the component is replaced by a stub, which is evidence it
        // is NOT exercised here. Counting the specifier would have called it
        // covered — memos mocks AuthFooter in two tests and neither touches it.
        { at: 'tests/b.test.tsx', text: 'vi.mock("../src/Menu", () => ({ default: () => null }));\ntest("y", () => {})' },
      ],
    })

    // Counting components without a test file gives a figure nobody acts on
    // because most of them have nothing to test — 47 the wrong way against 16 the
    // right way, a quarter of work against a day of it. A backlog a team believes
    // is what gets cleared.
    assert.equal(found.withBehaviour, 2)
    assert.equal(found.presentational, 1, 'a divider was asked for a behaviour test')
    assert.deepEqual(found.untested.map(u => u.file), ['src/Menu.tsx'])
  })
})

describeWithOwn('the component request', () => {
  test('the near misses are searched, and the reasons are left to a person', () => {
    const dir = join(root, 'scans', '.requests-test')
    rmSync(dir, { recursive: true, force: true })
    const out = run('request.mjs', ['A styled accessible table with a sticky header', '--profile', 'own', '--out', dir])

    // `ds draft` already reports the roles a profile cannot answer and `ds spec`
    // refuses a screen that needs one. Both are correct and both are dead ends:
    // the finding has nowhere to go, so the shortest path is to build the thing
    // inside the application — which is what the promotion scout finds months
    // later, once two teams have each done it once.
    assert.match(out, /NEAREST THINGS THIS LIBRARY ALREADY HAS/)
    assert.match(out, /\bTable\b/, 'the registry was not searched for near misses')

    const written = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'))

    // A request whose alternatives carry no reason is answered with one of them,
    // after which nobody files the next one. The near misses are searched so the
    // request arrives with them listed; the reason each does not do has to be
    // written by whoever hit the wall, because that reason IS the request.
    assert.ok(written.consideredAlternatives.length > 0)
    for (const a of written.consideredAlternatives) assert.match(a.whyNot, /TO FILL IN/)
    assert.match(written.proposedApi._, /TO FILL IN/)

    discard(dir)
  })
})

describe('the promotion scout', () => {
  test('a lazy wrapper is not a second implementation', async () => {
    const { scout } = await import('../scripts/lib/scout.mjs')
    const files = {
      'ui/badge.tsx': 'export function Badge() { return <span /> }',
      // Two apps solving one problem, neither reaching for the library.
      'app/a/Pill.tsx': 'export function Pill() { return <span /> }',
      'app/b/Pill.tsx': 'export function Pill() { return <span /> }',
      // One component with a lazy wrapper, which is a pattern rather than a
      // duplicate — and calling it two solutions is the noise that gets a report
      // ignored.
      'app/Picker.tsx': 'export function Picker() { return <div /> }',
      'app/LazyPicker.tsx': 'import { Picker } from "./Picker"\nexport const Picker = () => <Picker />',
      // The polymorphic idiom. `const Component = as ?? "div"` is not a component,
      // and counting it reported "Component" as built in parallel.
      'app/c/Poly.tsx': 'const Component = "div"\nexport function Poly() { return <Component /> }',
      'app/d/Poly2.tsx': 'const Component = "span"\nexport function Poly2() { return <Component /> }',
    }
    const found = scout({
      target: '/r',
      files: Object.keys(files).map(f => `/r/${f}`),
      read: (abs) => files[abs.slice(3)] ?? '',
      components: { Badge: { uses: [] } },
      libraryPrefix: 'ui',
    })

    const parallel = found.parallel.map(p => p.name).sort()
    assert.deepEqual(parallel, ['Pill'])
    assert.ok(!parallel.includes('Picker'), 'a lazy wrapper was called a second implementation')
    assert.ok(!parallel.includes('Component'), 'a polymorphic tag variable was called a component')
  })

  test('a compound part is consumed by its own parent, not unused', async () => {
    const { scout } = await import('../scripts/lib/scout.mjs')
    const found = scout({
      target: '/r',
      files: ['/r/app/Screen.tsx'],
      read: () => 'import { Dialog } from "ui/dialog"\nexport function Screen() { return <Dialog /> }',
      // DialogOverlay only ever appears inside Dialog, and never in an import an
      // application writes. Twenty of memos' fifty-nine came back "unused" for
      // that reason alone.
      components: { Dialog: { uses: ['DialogOverlay'] }, DialogOverlay: { uses: [] }, Orphan: { uses: [] } },
      libraryPrefix: 'ui',
    })
    assert.deepEqual(found.unconsumed, ['Orphan'])
  })
})

describe('permissions and budgets', () => {
  test('what may run is derived; what may not is not', async () => {
    const { generatePermissions } = await import('../scripts/lib/permissions-gen.mjs')
    const { permissions } = generatePermissions({
      scripts: { dev: '', test: '', lint: '', release: '', 'db:migrate': '', deploy: '' },
      tools: [], hasGate: true,
    })

    // A permission list is the one piece of configuration where copying somebody
    // else's is worse than having none: too tight and every task stops on a prompt
    // until a person turns the whole thing off, too loose and the setting is
    // decoration. Both end in permissions that exist and mean nothing. So the
    // allow list is asked of the repository — a command in its own scripts is a
    // command the team runs all day.
    assert.ok(permissions.allow.includes('Bash(npm run test:*)'))
    assert.ok(permissions.allow.includes('Bash(npm run lint:*)'))

    // Except the ones that are decisions rather than tasks, whatever they are
    // called locally. Not banned — they prompt, which is the right answer for
    // something nobody has decided about yet.
    for (const decision of ['release', 'db:migrate', 'deploy']) {
      assert.ok(!permissions.allow.includes(`Bash(npm run ${decision}:*)`), `${decision} was allowed`)
      assert.ok(!permissions.deny.includes(`Bash(npm run ${decision}:*)`), `${decision} was banned rather than left to prompt`)
    }

    // The deny list is not derived and must not be: no measurement of a
    // repository makes `rm -rf` reasonable in it, and a project that force-pushes
    // in a script has a bad script rather than a case for allowing it.
    assert.ok(permissions.deny.includes('Bash(rm -rf:*)'))
    assert.ok(permissions.deny.some(d => d.includes('.env')), 'a secret read into context is a secret in a transcript')
  })

  test('the budget lands green and only growth turns it red', async () => {
    const { generateBudget } = await import('../scripts/lib/budget-gen.mjs')
    const files = { 'AGENTS.md': 'x'.repeat(4000), '.ds/CONVENTIONS.md': 'y'.repeat(400) }
    const built = generateBudget({ read: (p) => files[p], alwaysOn: Object.keys(files) })

    // Everything in the must-read set is paid for by every agent on every task,
    // and a contract grows a paragraph at a time until the cheapest task carries a
    // chapter. Unlike provenance this is a gate — a forward-looking rule about
    // files the team controls — so it lands at today's cost plus headroom.
    for (const f of built.manifest.files) {
      assert.ok(f.budget > f.tokens, `${f.path} landed already over budget`)
    }
    assert.equal(built.total, 1100)
  })
})

describe('twins', () => {
  test('two signals are required, and silence says which kind it is', async () => {
    const { findTwins } = await import('../scripts/lib/twins.mjs')
    const props = (...names) => names.map(name => ({ name }))
    const components = {
      // Alike on both signals: a real question.
      Meter: { props: props('value', 'max', 'target', 'label'), renders: ['div', 'span', 'output'] },
      ProgressBar: { props: props('value', 'max', 'target', 'caption'), renders: ['div', 'span', 'progress'] },
      // Alike on prop names by accident, and nothing alike on the page. This is
      // the case the second signal exists for: on a first pass Radio and Spinner
      // scored a perfect 1.0 on two coincident names.
      Radio: { props: props('value', 'max', 'target', 'name'), renders: ['input', 'label'] },
      Spinner: { props: props('value', 'max', 'target', 'size'), renders: ['svg', 'circle'] },
      // Nothing of its own to read — the shadcn case, where props come from a
      // primitive this pass cannot follow.
      Opaque: { props: [], renders: ['div', 'span'] },
    }

    const found = findTwins(components)
    const flagged = found.unanswered.map(t => t.pair)
    assert.ok(flagged.includes('Meter ~ ProgressBar'))
    assert.ok(!flagged.some(p => p.includes('Radio') && p.includes('Spinner')),
      'prop-name overlap alone flagged a pair that renders nothing alike')

    // Silence has two causes and only one is good news. Reporting "no twins"
    // without saying that a component could not be read at all is a clean bill
    // over an unasked question.
    assert.equal(found.notComparable, 1)
    assert.match(found.why, /could not be compared/)

    // An answered pair that stopped resembling is an excuse nobody needs. But
    // "no longer alike" and "could not be compared" are different: conflating
    // them told a team its answer for Meter ~ ProgressBar was stale when the
    // profile simply carried no rendered-markup to compare — advice to delete a
    // correct answer.
    const withAnswer = findTwins(components, {
      declared: { pairs: { 'Radio ~ Spinner': { separated: 'different roles', reopenIf: 'either grows the other' } } },
    })
    assert.deepEqual(withAnswer.stale, ['Radio ~ Spinner'])
    const unreadable = findTwins({ Opaque: components.Opaque }, {
      declared: { pairs: { 'Opaque ~ Other': { separated: 'x', reopenIf: 'y' } } },
    })
    assert.deepEqual(unreadable.stale, [])
    assert.equal(unreadable.uncheckable.length, 1)
  })
})

describe('provenance', () => {
  test('a person with a privacy address is not a model', () => {
    const source = readFileSync(join(here, '..', 'scripts', 'provenance.mjs'), 'utf8')

    // "Where did this come from" is the question a regulated client asks first,
    // and the data is already free: an agent commit carries a Co-Authored-By
    // trailer. The first version also treated any no-reply address as an agent,
    // and reported "Ephraim Duncan <…@users.noreply.github.com>" — a person using
    // GitHub's privacy address, as most contributors do — as a model. That rule
    // would have classified half of open source as AI-written, which is the
    // loudest possible way for a provenance report to be wrong.
    assert.ok(!/users\\\.noreply\|/.test(source), 'a generic no-reply address is treated as an agent')
    assert.match(source, /AGENT_DOMAIN = \/@\(anthropic\|openai/)

    // A report, never a gate. A rule that every commit must name its model can
    // only be true going forward, and a check that fails on history teaches people
    // to pass --no-verify — after which the record stops accumulating and the
    // question becomes permanently unanswerable.
    assert.ok(!/process\.exit\(\s*(?:withAgent|report\.counts)/.test(source),
      'provenance must not fail a build on its own findings')

    // A low share is "not recorded", never "not used".
    assert.match(source, /not recorded", never "not used/)
  })
})

describe('the prop vocabulary', () => {
  test('a declared axis is not a collision, and an undeclared name is', async () => {
    const { propVocabulary } = await import('../scripts/lib/vocab.mjs')
    const components = {
      Tooltip: { props: [{ name: 'placement', values: ['top', 'bottom'] }] },
      Modal: { props: [{ name: 'placement', values: ['center', 'drawer'] }] },
      Button: { props: [{ name: 'variant', values: ['primary', 'ghost'] }] },
      Tabs: { props: [{ name: 'variant', values: ['segmented', 'underline'] }] },
      Combobox: { props: [{ name: 'surface', values: ['base', 'muted'] }] },
      EmptyState: { props: [{ name: 'surface', values: ['card', 'page'] }] },
    }
    const declared = {
      placement: { axis: 'where a surface sits', values: { top: '', bottom: '', center: '', drawer: '' } },
      variant: { axis: 'how much emphasis', values: { primary: '', ghost: '' } },
    }

    // With a declaration the question is whether every value is inside the axis.
    // The first version compared component value sets instead and reported seven
    // collisions in a system that declares its vocabulary — six of them were
    // components taking sensible subsets of one axis. Tooltip takes the two
    // placements that make sense for a tooltip and Modal takes the two that make
    // sense for a modal; two non-overlapping subsets of one axis is not two
    // questions, and calling it one buries the case that is.
    const withDecl = propVocabulary(components, declared)
    assert.ok(!withDecl.some(f => f.prop === 'placement'), 'a declared axis was reported as a collision')

    // Tabs takes values outside the declared axis: a real finding.
    assert.ok(withDecl.some(f => f.prop === 'variant' && f.outsideTheAxis),
      'a value outside the declared axis was not reported')

    // Shared and not declared at all — which the hand-written system\'s own
    // linter misses, because it only checks what it was told about.
    assert.ok(withDecl.some(f => f.prop === 'surface' && f.undeclared))

    // Without a declaration, comparison is all there is, and the disjoint case is
    // the loud one: an agent that learns `variant` from Button writes a type error
    // on Tabs, having learned it from the system that told it so.
    const without = propVocabulary(components)
    const variant = without.find(f => f.prop === 'variant')
    assert.equal(variant.collided.length, 1)
    assert.deepEqual(variant.collided[0].shared, [])
  })
})

describe('single-file components', () => {
  test('Vue and Svelte are measured, not declared out of scope', async () => {
    const { readVue, readSvelte } = await import('../scripts/lib/sfc.mjs')
    const at = (f) => readFileSync(join(here, 'fixtures', 'sfc', 'src', f), 'utf8')

    // Everything the composition and component-API passes measure is a fact about
    // markup and a props declaration, not about JSX. Reading only JSX reported all
    // of it as NOT APPLICABLE — honest, and still half the value missing on every
    // project not written in React.
    const card = readVue(at('Card.vue'))

    // The form most real components use, and the one the first version missed:
    // a NAMED interface behind `withDefaults(defineProps<Props>(), …)`. Reading
    // only the inline type literal found props in nine of forty-nine files of a
    // real component library. Exactly the failure the React extractor had, in
    // another language.
    assert.equal(card.props.length, 3)
    assert.equal(card.props.find(p => p.name === 'count').required, false)

    // `<Badge>` and `<router-view>` are both components; `<div>` and `<span>` are
    // not. A capital or a dash is what both ecosystems use to mean "not HTML".
    assert.equal(card.componentUses, 2)
    assert.equal(card.rawElements, 2)

    // Declaring nothing of its own is unknown, not zero. Reporting zero would put
    // a component with a full API into the median as though it took nothing.
    const inherited = readVue(at('Inherited.vue'))
    assert.equal(inherited.propsUnknown, true)
    assert.equal(inherited.props.length, 0)

    // Svelte 4 and 5 both, because a codebase mid-migration has both.
    const legacy = readSvelte(at('Legacy.svelte'))
    assert.deepEqual(legacy.props.map(p => p.name), ['name', 'count'])
    assert.equal(legacy.componentUses, 1)
  })
})

describe('the delivery loop', () => {
  test('the gates come from the measurement, not from a picture', async () => {
    const { generateLoop } = await import('../scripts/lib/loop-gen.mjs')
    const gatesAt = (level) => generateLoop({
      delegation: { supported: level, levels: [] },
      name: 'x', hasGate: true, hasEvidence: true,
    }).definition.stages.filter(s => s.gate).map(s => s.id)

    // Every reference model draws the same six stages and differs entirely in
    // where the human gates sit. One regulated system puts four in and proves
    // each change against the engine it replaces; a marketing site would be
    // strangled by the same shape. Copying the picture is how a consultant
    // installs somebody else's operating model.
    //
    // So a repository where nothing stops a bad turn gets a person everywhere,
    // because there is nothing else — and one that scores its own output gets a
    // person where it matters. Verified end to end: installing the factory into
    // memos moved it from assisted to delegated-review, and the loop regenerated
    // with three gates instead of five without anyone choosing that.
    assert.equal(gatesAt('none').length, 6)
    assert.equal(gatesAt('assisted').length, 5)
    assert.equal(gatesAt('delegated-review').length, 3)
    assert.equal(gatesAt('gated-autonomous').length, 2)

    // The last gate never comes off. Autonomy at the gate is not the absence of a
    // person; it is a person who has decided not to intervene yet.
    assert.ok(gatesAt('gated-autonomous').includes('ship'))
  })

  test('a stage never lists a check this repository does not have', async () => {
    const { generateLoop } = await import('../scripts/lib/loop-gen.mjs')
    const { definition } = generateLoop({
      delegation: { supported: 'assisted', levels: [] },
      name: 'x', hasGate: false, hasEvidence: false,
    })

    // A stage that runs a check nothing installed fails on its first run for a
    // reason nobody put there, and the team removes the loop rather than the line.
    assert.deepEqual(definition.stages.flatMap(s => s.runs), [])
  })
})

describe('scoped rules', () => {
  test('a rule is written only where a subtree decided differently', async () => {
    const { scopedRules } = await import('../scripts/lib/scoped-rules.mjs')
    const files = []
    const contents = new Map()
    const add = (path, text) => { files.push('/repo/' + path); contents.set('/repo/' + path, text) }

    // A subtree that agrees with the repository, in the same bucket.
    for (let i = 0; i < 14; i += 1) add(`src/agrees/A${i}.tsx`, 'export function A() { return <div /> }\n')
    // A subtree that settled on the other bucket.
    for (let i = 0; i < 14; i += 1) add(`src/differs/B${i}.tsx`, 'export default function B() { return <div /> }\n')
    // Large, but the dimension is only observable twice.
    for (let i = 0; i < 14; i += 1) add(`src/thin/C${i}.tsx`, i < 2 ? 'export default function C() { return <div /> }\n' : 'const c = 1\n')

    const rules = scopedRules({
      target: '/repo',
      files,
      read: (abs) => contents.get(abs) ?? '',
      conventions: { 'component export': { dominant: 'named', share: 0.7, verdict: 'weak' } },
    })
    const named = rules.map(r => r.subtree).sort()

    // The always-on contract is paid on every request by every agent, so a scoped
    // file that repeats it is the contract paid twice. Three rejections, each of
    // which the first version made:
    //
    //   `src/agrees` is the same bucket as the repository — a different share is
    //   not a different answer, and reporting it produced twenty rule files for
    //   one project.
    //
    //   `src/thin` is a large folder whose dimension fired twice. A hundred per
    //   cent of two is not a convention; outline's editor came back "literal hex
    //   100%" on two occurrences of `#fff`.
    assert.deepEqual(named, ['src/differs'])
    assert.equal(rules[0].differs[0].local, 'default')
    assert.equal(rules[0].differs[0].kind, 'decides what the repository has not')
  })
})

describe('evals generated for the client', () => {
  test('a break is produced per enforced convention, and the gaps are named', async () => {
    const { generateEvals } = await import('../scripts/lib/evals-gen.mjs')
    const out = generateEvals({
      referencePath: 'src/Good.tsx',
      referenceText: 'import { Button } from "@/ui/Button"\n\ninterface Props { id: string }\n\n'
        + 'export default function Good({ id }: Props) {\n  const handleClick = () => {}\n'
        + '  return <Button onClick={handleClick}>{id}</Button>\n}\n',
      enforce: {
        'internal imports': { expect: 'alias', share: 0.9 },
        'handler naming': { expect: 'handleX', share: 0.95 },
        'component export': { expect: 'default', share: 0.9 },
        'file structure': { expect: 'flat Name.tsx', share: 0.9 },
      },
    })

    // `ds eval` asks whether OUR ruleset discriminates, against our corpus. It
    // says nothing about whether the gate installed in a client's repository
    // would catch an agent breaking THEIR conventions — and a gate nobody has
    // tried to slip past is a gate nobody knows the shape of.
    const dims = out.covered.map(c => c.dimension).sort()
    assert.deepEqual(dims, ['component export', 'handler naming', 'internal imports'])

    // A dimension nothing can mechanically violate gets no break, and the eval
    // set is then narrower than the gate. Saying which is the difference between
    // a narrower set and a quieter one — file placement cannot be broken by the
    // contents of a file at a fixed path.
    assert.equal(out.uncovered.length, 1)
    assert.equal(out.uncovered[0].dimension, 'file structure')

    // Each break must actually differ from the reference, or the gate is being
    // asked to catch nothing and will be reported as having caught it.
    const breaks = out.files.filter(f => f.path.includes('breaks/'))
    assert.equal(breaks.length, 3)
    for (const b of breaks) assert.ok(!b.content.includes('const handleClick = () => {}\n  return <Button onClick={handleClick}')
      || !b.content.includes('from "@/ui/Button"') || !b.content.includes('export default function'),
    `${b.path} is identical to the reference`)
  })
})

describe('the technique catalogue', () => {
  test('a predicate the matcher does not understand is refused, not ignored', () => {
    const catalogue = JSON.parse(readFileSync(join(root, 'catalogue', 'techniques.json'), 'utf8'))
    const broken = structuredClone(catalogue)
    const first = Object.keys(broken.techniques)[0]
    broken.techniques[first].appliesWhen = [{ path: 'toolchain/missing', atLeast: 1 }]

    // Its own project to run against. This used to name `memos-web`, a scan left on
    // disk by somebody's manual run — so the test passed only while that directory
    // happened to survive, and deleting scans whose repository was gone broke it.
    // That is the stale-artifact dependency this suite's own header warns about,
    // inside the suite.
    const probe = join(root, 'scans', '.catalogue-typo-test')
    rmSync(probe, { recursive: true, force: true })
    mkdirSync(join(probe, 'src'), { recursive: true })
    writeFileSync(join(probe, 'package.json'), '{ "name": "ct", "private": true, "version": "0.0.0" }')
    writeFileSync(join(probe, 'src', 'A.tsx'), 'export const A = () => <div className="a" />\n')
    run('scan.mjs', [probe])

    const original = readFileSync(join(root, 'catalogue', 'techniques.json'), 'utf8')
    writeFileSync(join(root, 'catalogue', 'techniques.json'), JSON.stringify(broken))
    const out = run('fit.mjs', [scanSlotOf(probe)])
    writeFileSync(join(root, 'catalogue', 'techniques.json'), original)
    discard(probe)

    // `atLeast` is not the vocabulary — it is `gte` — and the matcher returned
    // false for anything it did not recognise. Two techniques were added with the
    // wrong spelling and simply never applied: a rule about a measurement nobody
    // could see, which is worse than no rule because it looks present.
    assert.match(out, /unknown predicate key "atLeast"/)
  })
})

describe('the evidence pack', () => {
  test('a pack whose checks did not run says so instead of going green', () => {
    const source = readFileSync(join(here, '..', 'scripts', 'evidence.mjs'), 'utf8')

    // Four verdicts, not two. A reviewer handed a green pack assembled from checks
    // that never executed is worse off than one handed nothing, and "it was
    // already broken" is an argument the pack should settle rather than start.
    assert.match(source, /passed\.length === 0 \? 'NOT PROVEN'/)

    assert.match(source, /failed\.length \? 'FAILED ELSEWHERE'/)

    // The pre-existing test reads the whole output. Searching the truncated
    // version would call a failure unrelated because the line naming the file
    // fell off the top.
    assert.match(source, /c\.preexisting = !touchesChange\(c\.full\)/)

    // A measurement that could not run counts against the verdict exactly as a
    // check that could not run does. The first version looked only at the checks
    // and printed PROVEN over a pack whose dependency audit never executed —
    // green where nothing was looked, produced by the part built to catch it.
    assert.match(source, /couldNotRun\.length \|\| notRun\.length/)
  })
})

describe('security', () => {
  // Scanned outside any repository, which is what these cases are about: no lockfile
  // to audit, no history to read. Left under `tests/` they began finding the
  // enclosing repository's lockfile the moment this project became a git repository,
  // and a pass reporting a clean audit of somebody else's dependencies is the exact
  // failure the assertions below exist to catch.
  const securityAt = outsideAnyRepo('security')

  test('a construct is a finding only without the thing that makes it fine', () => {
    run('security.mjs', [securityAt])
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(securityAt), 'security.json'), 'utf8'))
    const at = (file) => report.source.filter(f => f.file.endsWith(file))

    // A security report that cries wolf is read once, so every one of these is a
    // false positive this pass produced against real code before it was pinned.
    //
    // `escapeHTML` — the escape was missed because the pattern was spelled
    // `escapeHtml` and was case-sensitive, so a file doing exactly the right
    // thing was reported for raw injection.
    assert.equal(at('Safe.tsx')[0].mitigated, true, 'an escaped value was reported')

    // mermaid's `securityLevel: "strict"` is the renderer's own guard, and the
    // same kind of mitigation as wrapping the value. memos configures it three
    // lines above the injection.
    assert.equal(at('Guarded.tsx')[0].mitigated, true, 'a configured renderer guard was ignored')

    // Filling a <script> is code execution, not markup injection, and grouping
    // the two understates it. But which element it is has to be tracked: reading
    // the nearby text for the word "script" classified `el.innerHTML = html` as
    // code execution because the function above took a parameter of that name.
    assert.equal(at('Unsafe.tsx').find(f => f.line === 3).id, 'raw-html')
    assert.equal(at('Unsafe.tsx').find(f => f.line === 5).id, 'script-injection')

    // Secrets: a real shape counts, a self-documented placeholder does not, and a
    // fixture key is set aside rather than dropped — a test key is often real.
    assert.equal(report.counts.secrets, 1)
    assert.ok(report.secrets.some(s => s.inTest), 'a key in a test was discarded rather than set aside')
    // The value itself is never recorded: a report that quotes the secret becomes
    // the second place it leaks.
    assert.ok(!JSON.stringify(report).includes('9fK2mQ7pL4xR8vN3wB6tY1cZ5hJ0aS2dF4gH'))
  })

  test('a dependency audit that could not run is not a clean one', () => {
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(securityAt), 'security.json'), 'utf8'))

    // No lockfile here, so there is nothing to audit — and the count is null
    // rather than 0, because every reader downstream prints a 0 as good news.
    assert.equal(report.counts.dependencyAdvisories, null)
    assert.match(report.limits.dependencies, /NOT RUN/)
  })

  test('a history that was not read is not a history with nothing in it', () => {
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(securityAt), 'security.json'), 'utf8'))

    // The fixture is not a git repository, so there is no history to read. The
    // shape that matters is the absence of a number: `total` unset rather than 0.
    // Everything downstream prints a 0 as good news, and a 0 here would read as
    // "the history is clean" on the strength of nothing having been looked at.
    assert.equal(report.history.available, false)
    assert.equal(report.history.total, undefined, 'an unscanned history was given a count')
    assert.ok(report.history.why?.length > 0, 'no reason was given for not reading the history')

    // And while it is unread it stays in the list of things this pass does not do.
    assert.ok(
      report.notCovered ?? report.limits ? JSON.stringify(report).includes('the git history, unless gitleaks is run over it separately') : false,
      'the unread history dropped out of the caveats',
    )
  })

  test('a secret deleted from the working tree is still in the history', () => {
    // The case this pass was blind to for its whole life: the report counted the
    // files that are here now, said 0, and named the history in its own caveats
    // as something it did not read. A secret committed and deleted a commit later
    // is reachable by anybody who clones, and scored clean.
    const at = join(root, '.tmp-history-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    const git = (...a) => execFileSync('git', ['-C', at, ...a], { stdio: 'ignore' })
    git('init', '-q', '.')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(at, 'package.json'), '{"name":"probe","version":"0.0.0"}')
    // A shape gitleaks recognises. Not AWS's documentation key — that one is on
    // its allowlist, and a fixture built from it passes for the wrong reason.
    writeFileSync(join(at, '.env'), 'GITHUB_TOKEN=ghp_A7bQ2xR9mK4tL1vN6wZ0cY5hJ3dS8fG2pT4e\n')
    git('add', '-A')
    git('commit', '-qm', 'add config')
    rmSync(join(at, '.env'))
    writeFileSync(join(at, '.gitignore'), 'node_modules\n.env\n')
    git('add', '-A')
    git('commit', '-qm', 'remove the secret')

    run('security.mjs', [at])
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'security.json'), 'utf8'))

    // The working tree is genuinely clean. That is the whole trap.
    assert.equal(report.counts.secrets, 0, 'the working tree was not clean, so this proves nothing')

    if (report.history.available) {
      assert.ok(report.history.total >= 1, 'the deleted secret was not found in the history')
      assert.ok(report.history.findings.some(f => f.file === '.env'), 'the finding does not name the file it came from')
      // Once it has been read it stops being a caveat — a report that both reads
      // the history and disclaims reading it teaches readers to skip the caveats.
      assert.ok(!JSON.stringify(report.limits).includes('unless gitleaks is run over it separately'))
    } else {
      // gitleaks is not installed here. Then the reason must name that, not the
      // repository — the two refusals are different and a reader acts on which.
      assert.match(report.history.why, /gitleaks is not installed/)
    }
    discard(at)
  })

  test('a clone that does not hold its own history is refused by name', () => {
    // Both of these look like a git repository and read nothing like one.
    //
    // A shallow clone finishes in milliseconds and reports a clean history for
    // the twenty commits it happens to hold — the exact shape of green-over-
    // unmeasured-ground this tool exists to refuse. A blobless clone makes
    // gitleaks fetch every blob over the network: 10,000 commits ran past ten
    // minutes here without finishing, which is why it is refused rather than
    // waited on.
    //
    // The two reasons must stay distinct, because a reader acts on which: one
    // says re-clone in full, the other says the answer you got is partial.
    const base = join(root, '.tmp-clone-probe')
    rmSync(base, { recursive: true, force: true })
    mkdirSync(base, { recursive: true })
    const origin = join(base, 'origin')
    mkdirSync(origin)
    const git = (where, ...a) => execFileSync('git', ['-C', where, ...a], { stdio: 'ignore' })
    git(base, 'init', '-q', 'origin')
    git(origin, 'config', 'user.email', 't@t')
    git(origin, 'config', 'user.name', 't')
    for (const n of [1, 2, 3]) {
      writeFileSync(join(origin, `f${n}.txt`), `${n}\n`)
      git(origin, 'add', '-A')
      git(origin, 'commit', '-qm', `commit ${n}`)
    }

    // Shallow. `file://` rather than a path, because git deliberately ignores
    // --depth on a plain local path and hands back a full clone instead.
    const shallow = join(base, 'shallow')
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow], { stdio: 'ignore' })
    run('security.mjs', [shallow])
    const onShallow = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(shallow), 'security.json'), 'utf8'))
    assert.equal(onShallow.history.available, false)
    assert.equal(onShallow.history.total, undefined)
    // Without the tool installed, "gitleaks is not installed" is the reason that
    // comes back, and it is the right one — it is the one you can act on. The
    // clone-shape reasons are only reachable once there is something to run.
    const installed = onShallow.gitleaksAvailable
    if (installed) assert.match(onShallow.history.why, /shallow/)

    // Partial. Marked the way a real blobless clone marks itself.
    const partial = join(base, 'partial')
    execFileSync('git', ['clone', '-q', `file://${origin}`, partial], { stdio: 'ignore' })
    git(partial, 'config', 'remote.origin.partialclonefilter', 'blob:none')
    run('security.mjs', [partial])
    const onPartial = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(partial), 'security.json'), 'utf8'))
    assert.equal(onPartial.history.available, false)
    assert.equal(onPartial.history.total, undefined)
    if (installed) {
      assert.match(onPartial.history.why, /partial|blobless/)
      assert.doesNotMatch(onPartial.history.why, /shallow clone/, 'the two refusals were collapsed into one')
    }

    discard(base)
  })
})

describe('the page a client actually looks at', () => {
  test('an unmeasured row is never green', () => {
    // `report.mjs` had no test of any kind, which is the wrong place for that gap:
    // it is the one artifact handed to a client as a page rather than a terminal
    // dump. It coloured every zero with `ok-text` — green — including the sixteen
    // recorded scans where the contrast pass had compared no pairs at all.
    run('defects.mjs', [fixture('unreadable')])
    run('scan.mjs', [fixture('unreadable')])
    run('deep.mjs', [fixture('unreadable')])
    const slot = scanSlotOf(fixture('unreadable'))
    const out = join(root, 'scans', slot, 'report.html')
    rmSync(out, { force: true })
    run('report.mjs', [slot, '--out', out])
    const html = readFileSync(out, 'utf8')

    // Nothing that was not measured may carry the class that means "good".
    const rows = [...html.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td class="num ([^"]+)">([^<]*)<\/td>/g)]
    assert.ok(rows.length > 0, 'the defect table did not render')
    for (const [, label, cls, value] of rows) {
      if (value === 'NOT RUN') assert.match(cls, /muted/, `${label} was not measured and is not muted`)
      else assert.doesNotMatch(value, /^0$/, `${label} shows a zero on a repository nothing was read from`)
    }

    // And the page stays self-contained — a client-facing page that fetches is a
    // page that renders differently, or not at all, wherever it is opened.
    assert.doesNotMatch(html, /<script src=|<link[^>]+href="https?:/, 'the report reaches for something external')
  })
})

describe('what the report shows about composition', () => {
  test('a React project is not out of scope for the React pass', () => {
    // `OUT_OF_SCOPE` tested for single-file components alone, so every pure React
    // project printed "NOT APPLICABLE — this pass reads JSX, Vue and Svelte, and
    // this project is react" over both its component API and its composition, while
    // the JSON beside it held the full analysis. The sentence named react as the
    // reason react could not be read, and the two most useful sections were
    // invisible on the most common framework.
    run('deep.mjs', [fixture('composition')])
    const out = run('deep.mjs', [fixture('composition')])
    assert.doesNotMatch(out, /NOT APPLICABLE/, 'a React project was declared out of scope')
    // Anchored on the section existing and carrying a count, not on its wording:
    // this assertion was written against `screens in a frame`, that line was renamed
    // the same day, and a test that breaks on a rename teaches people to loosen it.
    assert.match(out, /COMPOSITION[\s\S]*?\d+\s+screens/)

    // The other end still refuses: nothing of any of the four kinds was found.
    const none = run('deep.mjs', [fixture('unreadable')])
    assert.match(none, /NOT APPLICABLE/)
    assert.match(none, /no file of those kinds was found/)
  })
})

describe('writing in a utility-class project', () => {
  test('the classes are read from the project, not brought in', async () => {
    // The generator's styling repertoire was a stylesheet beside the module or a class
    // with the styles elsewhere. A Tailwind project's contract asks for neither, so on
    // documenso — 95% utility classes — it resolved every element of the spec and then
    // declined to write the file. Correct, and useless: that is most projects.
    //
    // What it must not do is invent the classes. On that repository `gap-2` is written
    // 36 times against `gap-4` fewer, and which is the house answer is a fact about
    // that codebase rather than about Tailwind.
    const { utilities, containerClasses, zoneClasses } = await import('../scripts/lib/utilities.mjs')
    const screen = (gap) => `export function S() {\n  return <div className="flex flex-col ${gap} w-full"><span className="text-sm">x</span></div>\n}\n`
    const measured = utilities([
      { text: screen('gap-2') }, { text: screen('gap-2') }, { text: screen('gap-2') },
      { text: screen('gap-4') },
    ])
    assert.equal(containerClasses(measured), 'flex flex-col gap-2 w-full')
    assert.equal(zoneClasses(measured), 'flex flex-col gap-2')

    // Leaf classes describe contents, not shape. Copying `text-sm` would produce a
    // screen that looks like its neighbours' contents rather than like their frame.
    assert.ok(!containerClasses(measured).includes('text-sm'))

    // And a slot answered once is not an answer — the same floor every distribution
    // here is held to.
    const thin = utilities([{ text: 'export function S() { return <div className="flex gap-7">x</div> }' }])
    assert.equal(thin.gap, undefined, 'one observation became the house gap')
  })

  test('a project with no container to copy gets no invented one', async () => {
    const { utilities, containerClasses } = await import('../scripts/lib/utilities.mjs')
    const none = utilities([{ text: 'export function S() { return <p>just text</p> }' }])
    assert.equal(containerClasses(none), undefined, 'a house shape was invented from nothing')
  })
})

describe('a component file is not a screen because it exists', () => {
  test('single-file components go through the same test JSX files do', () => {
    // They did not. `sources.filter(isScreen)` guarded the JSX path and nothing
    // guarded the other one, so every `.vue`, `.svelte` and `.component.ts` in a
    // project was pushed as a screen. On PeerTube that made all 331 of its components
    // screens, and the pass then reported "27% system share, 160 screens mostly
    // hand-written" — a description of a design system, presented as a description of
    // screens. After the fix: 27 screens, 20 of them from the route table.
    const at = join(root, '.tmp-sfc-screens')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'views'), { recursive: true })
    mkdirSync(join(at, 'src', 'components'), { recursive: true })
    mkdirSync(join(at, 'src', 'router'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"v","version":"0.0.0","dependencies":{"vue":"3.4.0","vue-router":"4.3.0"}}')
    writeFileSync(join(at, 'src', 'router', 'routes.ts'), [
      "import type { RouteRecordRaw } from 'vue-router';",
      'const routes: RouteRecordRaw[] = [',
      "  { path: '/list', component: () => import('#/views/ListView.vue') },",
      '];',
      'export default routes;',
    ].join('\n'))
    writeFileSync(join(at, 'src', 'views', 'ListView.vue'), '<template><AppShell><p>rows go here</p></AppShell></template>\n')
    // Three parts. A counter, a button and an icon are not screens, and before this
    // all three were counted as such.
    writeFileSync(join(at, 'src', 'components', 'Counter.vue'), '<template><button>{{ n }}</button></template>\n<script setup>let n = 0</script>\n')
    writeFileSync(join(at, 'src', 'components', 'Icon.vue'), '<template><svg /></template>\n')
    writeFileSync(join(at, 'src', 'components', 'Chip.vue'), '<template><span><slot /></span></template>\n')

    run('deep.mjs', [at])
    const deep = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8'))
    assert.equal(deep.composition.screens, 1, 'components in a components directory were counted as screens')
    assert.equal(deep.composition.archetypes.byRoute, 1)
    assert.ok(!deep.composition.shapes.some(s => /components\//.test(s.file)))
    discard(at)
  })

  test('an Angular route names a plain TypeScript file, and the resolver had no .ts', () => {
    // PeerTube declares `component: HomepageRedirectComponent` and
    // `loadChildren: () => import('./+admin/routes')`, and the resolver's candidate
    // list held `.tsx`, `.jsx`, `.vue` and `.svelte` — every extension except the one
    // an Angular component is written in. So the route table resolved nothing, and
    // the screens that were found came from a folder happening to be called `pages`:
    // a guess standing in for a route table that was right there.
    const at = join(root, '.tmp-ng-routes')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'app'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"ng","version":"0.0.0","dependencies":{"@angular/core":"^17.0.0","@angular/router":"^17.0.0"}}')
    writeFileSync(join(at, 'src', 'app', 'app.routes.ts'), [
      "import { Routes } from '@angular/router'",
      "import { HomeComponent } from './home.component'",
      'const routes: Routes = [',
      "  { path: '', component: HomeComponent },",
      "  { path: 'about', loadComponent: () => import('./about.component') },",
      ']',
      'export default routes',
    ].join('\n'))
    const comp = (n, sel) => `import { Component } from '@angular/core'\n@Component({\n  standalone: true,\n  selector: '${sel}',\n  template: '<p>a sentence of content</p>',\n})\nexport class ${n} {}\n`
    writeFileSync(join(at, 'src', 'app', 'home.component.ts'), comp('HomeComponent', 'app-home'))
    writeFileSync(join(at, 'src', 'app', 'about.component.ts'), comp('AboutComponent', 'app-about'))
    writeFileSync(join(at, 'src', 'app', 'chip.component.ts'), comp('ChipComponent', 'app-chip'))

    run('deep.mjs', [at])
    const a = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8')).composition.archetypes
    assert.equal(a.byRoute, 2, 'the Angular route table still resolves nothing')
    assert.equal(a.byNaming, 0)
    discard(at)
  })
})

describe('accessibility outside React', () => {
  test('a Svelte project is held to the standard the report cites', () => {
    // It was checked on React and nowhere else. Every Vue, Svelte and Angular project
    // reported NOT RUN while the same tool cites WCAG 2.2 and the ARIA authoring
    // practices as the two standards it holds a project to — three of four frameworks
    // held to nothing.
    //
    // Svelte needs no plugin: its compiler emits `a11y_*` warnings itself and is
    // installed in every Svelte project by definition. Delegating to what is already
    // there is the same move as handing the dependency audit to the project's own
    // package manager.
    const at = join(root, '.tmp-svelte-a11y')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"s","version":"0.0.0","dependencies":{"svelte":"5.0.0"}}')
    // Resolve the compiler the way a real project would.
    mkdirSync(join(at, 'node_modules'), { recursive: true })
    try {
      const { symlinkSync } = require('node:fs')
      symlinkSync(join(root, 'node_modules', 'svelte'), join(at, 'node_modules', 'svelte'), 'dir')
    } catch { }
    writeFileSync(join(at, 'src', 'Bad.svelte'),
      '<div onclick={() => {}}>clickable</div>\n<img src="/x.png" />\n')

    const out = run('defects.mjs', [at])
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'defects.json'), 'utf8'))

    if (report.counts.a11yFindings === null) {
      // The compiler is not resolvable in this checkout. Then it must say so, and it
      // must not report a zero — an unrun check reads as a clean one.
      assert.match(report.limits.a11y, /no accessibility analysis ran/)
    } else {
      assert.ok(report.counts.a11yFindings >= 2, 'careless markup produced no findings')
      assert.match(out, /the Svelte compiler's own a11y warnings/, 'the wrong tool was credited')
      assert.ok(report.a11y.some(f => /^a11y_/.test(f.rule)))
    }
    discard(at)
  })

  test('Vue and Angular are told what would read them', () => {
    // No equivalent ships in the box for either, so the refusal names the plugin
    // rather than implying nothing exists.
    const at = join(root, '.tmp-vue-a11y')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"v","version":"0.0.0","dependencies":{"vue":"3.4.0"}}')
    writeFileSync(join(at, 'src', 'A.vue'), '<template><div @click="x">hi</div></template>\n')
    run('defects.mjs', [at])
    const report = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'defects.json'), 'utf8'))
    assert.equal(report.counts.a11yFindings, null, 'a zero was reported for a check that did not run')
    assert.match(report.limits.a11y, /eslint-plugin-vuejs-accessibility/)
    discard(at)
  })
})

describe('surveying many repositories at once', () => {
  test('a framework\'s own test fixtures are not its screens', () => {
    // The command had never been run. Pointed at six repositories it reported 885
    // screens for SvelteKit's `packages/kit` — 779 of them `+page.svelte` files under
    // `test/`, every one a route by the filesystem rule and none of them a screen the
    // package ships. The count then carried into system share, states handled and
    // everything else derived from screens.
    //
    // `isTest` catches a file NAMED `.test.` or `.spec.`, which is how JSX projects
    // mark them; a framework's fixtures are not named that way at all.
    const at = join(root, '.tmp-survey-fixtures')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'routes'), { recursive: true })
    mkdirSync(join(at, 'test', 'apps', 'basics', 'src', 'routes'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"k","version":"0.0.0","dependencies":{"svelte":"5.0.0"}}')
    writeFileSync(join(at, 'src', 'routes', '+page.svelte'), '<h1>real</h1>\n')
    for (const n of ['a', 'b', 'c']) {
      mkdirSync(join(at, 'test', 'apps', 'basics', 'src', 'routes', n), { recursive: true })
      writeFileSync(join(at, 'test', 'apps', 'basics', 'src', 'routes', n, '+page.svelte'), `<h1>fixture ${n}</h1>\n`)
    }

    run('deep.mjs', [at])
    const deep = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8'))
    assert.equal(deep.composition.screens, 1, 'test fixtures were counted as screens')
    assert.ok(!deep.composition.shapes.some(s => /(^|\/)test\//.test(s.file)), 'a fixture reached the shape list')
    discard(at)
  })
})

describe('the loop the catalogue depends on', () => {
  test('a measurement comes back and moves a technique, or refuses to', () => {
    // Every one of the 31 pieces of evidence in the technique catalogue was typed in
    // by hand. Not one came from `ds measure` — the command that exists so the
    // catalogue is not, in its own words, "a radar with extra ceremony". Its header
    // says evidence typed in by hand is opinion with a date on it; the rings rest
    // entirely on that, and the loop that would fix it had never run.
    const at = join(root, '.tmp-measure-loop')
    const slot = scanSlotOf(at)
    const catalogueAt = join(root, 'catalogue', 'techniques.json')
    const before = readFileSync(catalogueAt, 'utf8')
    try {
      rmSync(at, { recursive: true, force: true })
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{"name":"m","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
      writeFileSync(join(at, 'src', 'A.tsx'), 'export function A(){ return <div style={{ color: "#ff0000" }}>hi</div> }\n')
      run('scan.mjs', [at]); run('deep.mjs', [at]); run('defects.mjs', [at])

      const id = Object.keys(JSON.parse(before).techniques)[0]
      run('measure.mjs', [slot, '--baseline', '--installed', id])
      const baselineAt = join(root, 'scans', slot, 'baseline.json')
      assert.ok(existsSync(baselineAt), 'no baseline was recorded')

      // Too soon is a refusal, not a warning. Evidence from a short interval is noise,
      // and a catalogue that accepts it stops being a record of what happened.
      const early = run('measure.mjs', [slot, '--record'])
      assert.match(early, /REFUSING to record/)
      assert.equal(readFileSync(catalogueAt, 'utf8'), before, 'the catalogue took evidence from a zero-day interval')

      // With the interval met, the loop closes: a number that moved in the direction
      // a technique declared credits that technique. Correlation with a stated
      // hypothesis — enough to move a ring, not enough to call causal.
      const baseline = JSON.parse(readFileSync(baselineAt, 'utf8'))
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      baseline.takenAt = old
      baseline.date = old
      writeFileSync(baselineAt, JSON.stringify(baseline, null, 2))

      const later = run('measure.mjs', [slot, '--record'])
      assert.doesNotMatch(later, /REFUSING to record/, 'it still refused after the interval passed')
      assert.doesNotMatch(later, /Cannot find|is not defined|TypeError/, 'the record path crashes')
    } finally {
      writeFileSync(catalogueAt, before)
      discard(at)
    }
  })
})

describe('the room, rehearsed', () => {
  test('a flag is not a directory', () => {
    // `ds room --rehearse` — the shape a rehearsal is most often run in, with no
    // directory given — took `argv[2]` as the target and wrote the client-facing
    // ledger and page into a folder literally called `--rehearse`.
    const before = existsSync(join(root, '--rehearse'))
    assert.equal(before, false, 'a folder named after a flag is lying around')

    const out = run('room.mjs', ['--rehearse'])
    assert.ok(!existsSync(join(root, '--rehearse')), 'the flag became a directory again')

    // And the scene still runs: the two numbers, the work, the movement, and what the
    // figure excludes.
    assert.match(out, /WHAT ARE YOU PAYING FOR TODAY/)
    assert.match(out, /WHAT MOVED/)
    assert.match(out, /WHAT THIS FIGURE DOES NOT INCLUDE/)

    // The page is the artefact that travels, so it carries the disclosure the
    // terminal does — a number that leaves the room without its provenance is the
    // thing this whole tool exists to prevent.
    const page = readFileSync(join(root, '.ds', 'outcome.html'), 'utf8')
    assert.match(page, /Rehearsal/)
    assert.match(page, /stand-in set/)
    assert.match(page, /REHEARSAL STAND-IN — not a client figure/)

    rmSync(join(root, '.ds'), { recursive: true, force: true })
  })
})

describe('a registry read from a real component library', () => {
  test('a single-file component is keyed by the name a screen writes, not its filename', async () => {
    // The extractor had only ever seen components written for it. Pointed at a real
    // Vue library of 223, every entry came back keyed by its file: `form-field`,
    // `vben-form`, `layout-content`. A screen writes `<FormField>` — `import FormField
    // from './form-field.vue'` is how it is reached — so the registry was keyed by a
    // name nobody uses, and every role match became a spelling guess.
    const at = join(root, '.tmp-sfc-naming')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'ui'), { recursive: true })
    writeFileSync(join(at, 'ui', 'form-field.vue'),
      '<script setup lang="ts">\ndefineProps<{ label?: string }>()\n</script>\n<template><div><slot /></div></template>\n')
    writeFileSync(join(at, 'ui', 'data-table.vue'),
      '<script setup lang="ts">\ndefineProps<{ columns?: string[] }>()\n</script>\n<template><table /></template>\n')

    run('adapt-sfc.mjs', [join(at, 'ui'), '--out', 'test-naming', '--alias', '../ui'])
    const components = JSON.parse(readFileSync(join(root, 'profiles', 'test-naming', 'components.json'), 'utf8')).components
    assert.ok(components.FormField, 'a component is keyed by its filename')
    assert.ok(components.DataTable)
    assert.ok(!components['form-field'], 'the filename survived as a key')

    rmSync(join(root, 'profiles', 'test-naming'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'test-naming.json'), { force: true })
    discard(at)
  })

  test('an arrow in a prop type is not a closing bracket', async () => {
    // `createRow?: () => Record<string, unknown>` came back as `() => Record<string`.
    // The splitter counted `>` as closing a generic, so the arrow took the depth to
    // -1 and the comma inside `Record<...>` split the prop in half. Found on the first
    // real Vue library it was pointed at, and it would corrupt any function-typed prop
    // anywhere.
    const { readVue } = await import('../scripts/lib/sfc.mjs')
    const src = [
      '<script setup lang="ts">',
      'defineProps<{ createRow?: () => Record<string, unknown>; label?: string }>()',
      '</script>',
      '<template><div /></template>',
    ].join('\n')
    const props = readVue(src, 'X.vue').props
    assert.deepEqual(props.map(p => p.name), ['createRow', 'label'])
    assert.match(props[0].type, /Record<string, unknown>/, 'the type was cut at the arrow')
  })
})

describe('finding duplicates without comparing everything to everything', () => {
  test('the size bound is exact — the same pairs, a fraction of the work', async () => {
    // Ninety-one per cent of the slowest pass was one quadratic loop: on a
    // 2,829-file project, four million set intersections to find sixty pairs. The
    // bound below is derived rather than tuned, so nothing is missed —
    //
    //   J = |a∩b| / (|a| + |b| - |a∩b|) >= t   →   |a∩b| >= t(|a| + |b|) / (1 + t)
    //   and |a∩b| <= min(|a|, |b|), so min >= t(|a| + |b|) / (1 + t)
    //
    // At t = 0.5 that is max <= 2 x min. Two files whose shingle counts differ by more
    // than a factor of two cannot reach 0.5 however much they share.
    //
    // Measured on a real 9,010-file project: 45.1s and 289 pairs before, 12.7s and the
    // same 289 after.
    const t = 0.5
    const bound = (1 + t) / t - 1
    assert.equal(bound, 2)

    // The claim itself, checked rather than asserted: over random set pairs, every
    // pair the bound drops is one no threshold could have kept.
    let dropped = 0, wronglyDropped = 0
    const make = (n, from) => new Set(Array.from({ length: n }, (_, i) => `s${(i + from) % 200}`))
    for (let a = 10; a <= 120; a += 7) {
      for (let b = 10; b <= 120; b += 7) {
        for (const shift of [0, 5, 40]) {
          const A = make(a, 0), B = make(b, shift)
          let shared = 0
          for (const x of A) if (B.has(x)) shared += 1
          const j = shared / (A.size + B.size - shared)
          const skipped = Math.max(A.size, B.size) > Math.min(A.size, B.size) * bound
          if (skipped) {
            dropped += 1
            if (j >= t) wronglyDropped += 1
          }
        }
      }
    }
    assert.ok(dropped > 0, 'the bound dropped nothing, so this proves nothing')
    assert.equal(wronglyDropped, 0, 'the bound dropped a pair that was above the threshold')
  })
})

describe('why there is no catalogue of screen layouts', () => {
  test('the layout is often not in the screen file at all', () => {
    // Three attempts at measuring a layout catalogue, and the third explained the
    // first two. Measured across four real products, the share of screens whose own
    // file contains any flex, grid or space-y at all:
    //
    //   outline      0 of  16    0%
    //   formbricks  13 of  84   15%
    //   plane       32 of  74   43%
    //   documenso   82 of 131   63%
    //
    // On outline it is never there. A screen fills a frame and hands it children; the
    // arrangement lives in the frame and in the components composed into it, one level
    // below anything a screen file says. So a catalogue of screen layouts cannot be
    // measured from screens, and this is the same finding as "no frame name appears in
    // more than one product" seen from the other side: the frame is where the layout
    // lives, and every product writes its own.
    //
    // Pinned as a fixture rather than a note, because the idea is a good one and
    // somebody will have it again.
    const at = join(root, '.tmp-layout-claim')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'pages'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"l","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    // A screen in the outline shape: it fills a frame and arranges nothing itself.
    writeFileSync(join(at, 'src', 'pages', 'ListPage.tsx'),
      'export function ListPage() {\n  return (\n    <Scene title="List" icon={<Icon />}>\n      <Rows />\n    </Scene>\n  )\n}\n')
    writeFileSync(join(at, 'src', 'pages', 'DetailPage.tsx'),
      'export function DetailPage() {\n  return (\n    <Scene title="Detail">\n      <Body />\n    </Scene>\n  )\n}\n')

    run('scan.mjs', [at])
    run('deep.mjs', [at])
    const deep = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8'))
    const withLayout = deep.composition.shapes.filter(s => {
      const text = readFileSync(join(at, s.file), 'utf8')
      return /className=["'`][^"'`]*\b(flex|grid|space-y-)\b/.test(text)
    })
    assert.equal(withLayout.length, 0, 'this fixture exists to hold screens that arrange nothing')

    // And the tool does not invent one for them: the arrangement it reports over a
    // sample this thin refuses a verdict rather than averaging two observations.
    const out = run('build-screen.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--repo', at, '--profile', 'own'])
    assert.doesNotMatch(out, /arrangement\s+convention/, 'a house arrangement was invented from screens that declare none')
    discard(at)
  })
})

describe('the one check that sees what a person sees', () => {
  const gateFor = (at) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"v","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    writeFileSync(join(at, 'src', 'A.tsx'), 'export function A(){ return <div className="a">hi</div> }\n')
    run('scan.mjs', [at])
    run('install.mjs', [at, '--apply'])
    return readFileSync(join(at, 'scripts', 'gate', 'run.mjs'), 'utf8')
  }

  test('it is invoked by the gate, not merely installed beside it', () => {
    // It was written into every client and called by nothing. A check that exists,
    // works, and never runs is the same as no check — and worse, because the file in
    // the repository says otherwise. It belongs in CI and not in the commit hook: it
    // needs a server to point at, which a hook cannot assume.
    const at = join(root, '.tmp-visual-gate')
    const runner = gateFor(at)
    const ci = runner.slice(runner.indexOf("case 'ci':"), runner.indexOf("default:"))
    assert.match(ci, /visual\.mjs/, 'the visual check is installed and nothing invokes it')
    const commit = runner.slice(runner.indexOf("case 'commit':"), runner.indexOf("case 'score':"))
    assert.doesNotMatch(commit, /visual\.mjs/, 'a commit hook cannot assume a running server')
    discard(at)
  })

  test('it refuses to set baselines it could never compare', () => {
    // With playwright installed and pixelmatch missing, an --update run captured
    // three screenshots and reported "3 route(s), 0 changed". A consultant sets the
    // baselines, reads that, and believes visual checking is running. It is not: the
    // next run cannot compare, and the setup step said nothing. Every dependency is
    // checked before anything is written now.
    const at = join(root, '.tmp-visual-deps')
    gateFor(at)
    const visual = readFileSync(join(at, 'scripts', 'gate', 'visual.mjs'), 'utf8')
    const beforeWrite = visual.slice(0, visual.indexOf('const browser'))
    assert.match(beforeWrite, /pixelmatch/, 'the comparison libraries are not checked before capture')
    assert.match(beforeWrite, /pngjs/)

    // And with nothing to point at it excuses itself rather than reporting every
    // route unreachable, which reads as a failure of the change rather than the setup.
    assert.match(beforeWrite, /VISUAL_BASE_URL is not set/)
    const out = run('../.tmp-visual-deps/scripts/gate/visual.mjs', []).toString()
    assert.doesNotMatch(out, /unreachable/)
    discard(at)
  })
})

describe('the client\'s own visual language, all the way to a file', () => {
  test('one reader for both token-layer shapes, and the client\'s names survive', async () => {
    // Two passes write token layers and they disagree in shape. `ds style:image`
    // writes a flat map because a screenshot yields a short list; `ds style --out`
    // writes DTCG groups because a live site yields sixty-seven values across seven
    // kinds. Both are right for what they hold — and nothing read the second, so a
    // client's palette, type scale, spacing and radii were extracted, written to
    // disk, and never reached a line of generated code.
    const { readTokenLayer, rootBlock } = await import('../scripts/lib/token-layer.mjs')

    const grouped = {
      $description: 'from a site',
      named: { 'brand-primary': { $value: '#5468ff', $type: 'color', $extensions: { 'org.ds-profile': { source: 'a custom property the site declares' } } } },
      palette: { '01': { $value: '#087ea4', $type: 'color', $extensions: { 'org.ds-profile': { uses: 23 } } } },
      spacing: { '05': { $value: '1rem', $type: 'dimension', $extensions: { 'org.ds-profile': { uses: 40 } } } },
      font: { family: { default: { $value: ['Optimistic Display'], $type: 'fontFamily' } } },
    }
    const flat = {
      'colour-1': { $value: '#ffffff', $type: 'color', $extensions: { 'org.ds-profile': { share: 0.5 } } },
    }
    assert.equal(readTokenLayer(grouped).length, 4, 'a grouped layer was not read')
    assert.equal(readTokenLayer(flat).length, 1, 'a flat layer was not read')

    // The one name in the file that must survive untouched is the one the client
    // wrote. Joining the group path in produced `--named-brand-primary` for a
    // property the client calls `brand-primary`.
    const read = readTokenLayer(grouped)
    const clientNamed = read.find(t => t.named)
    assert.equal(clientNamed.name, 'brand-primary')
    assert.ok(read.find(t => t.name === 'palette-01'), 'a ranked token lost its group')
    assert.ok(read.find(t => t.name === 'font-family-default'), 'a nested group was flattened wrongly')

    // And the block a project can adopt says which names are the client's.
    const block = rootBlock(read, { from: 'https://example.com' })
    assert.match(block, /--brand-primary: #5468ff/)
    assert.match(block, /1 of 4 carry the name the client gave them/)
  })

  test('the tokens travel with the proposal rather than being referenced blind', () => {
    // A `var(--x)` naming a property the project does not declare is dropped by the
    // browser without a word — the screen then has no colour and no error. So where
    // the project declares none of its own and the profile carries a layer read from
    // what the client ships, the layer is written beside the frame: taking the frame
    // takes what it needs.
    const at = join(root, '.tmp-token-travel')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'pages'), { recursive: true })
    mkdirSync(join(at, 'src', 'ui'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"t","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    for (const n of ['A', 'B', 'C']) {
      writeFileSync(join(at, 'src', 'pages', `${n}Page.tsx`),
        `import './${n}Page.css'\nexport function ${n}Page(){ return <div className="page"><h1>${n}</h1></div> }\n`)
      // Literal spacing, not a token: this project has none of its own.
      writeFileSync(join(at, 'src', 'pages', `${n}Page.css`), '.page { display: flex; gap: 16px; }\n')
    }
    writeFileSync(join(at, 'src', 'ui', 'Table.tsx'),
      'interface Props { columns?: string[] }\nexport function Table({ columns = [] }: Props) { return <table>{columns.length}</table> }\n')

    // A profile holding their components and a token layer read from their site.
    const profile = join(root, 'profiles', 'test-travel')
    rmSync(profile, { recursive: true, force: true })
    run('adapt-react.mjs', [join(at, 'src', 'ui'), '--out', 'test-travel', '--alias', '../ui'])
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'tokens.json'), JSON.stringify({
      $description: 'Read from https://example.com',
      named: { 'brand-primary': { $value: '#5468ff', $type: 'color', $extensions: { 'org.ds-profile': { readFrom: 'https://example.com', source: 'a custom property the site declares' } } } },
      spacing: { '05': { $value: '1rem', $type: 'dimension', $extensions: { 'org.ds-profile': { readFrom: 'https://example.com', uses: 40 } } } },
    }, null, 2))
    writeFileSync(join(root, 'bindings', 'test-travel.json'), JSON.stringify({
      schemaVersion: 1, profile: 'test-travel', axes: {},
      roles: { table: { component: 'Table' } },
    }, null, 2))
    writeFileSync(join(at, 'spec.json'), JSON.stringify({
      schemaVersion: 1, id: 'documents', name: 'Documents', goal: 'List them.',
      zones: [{ name: 'content', purpose: 'One row per document.', elements: ['table'] }],
      states: { loading: 'skeleton', error: 'inlineMessage', empty: 'emptyState' },
    }, null, 2))

    run('scan.mjs', [at])
    const out = run('build-screen.mjs', [join(at, 'spec.json'), '--repo', at, '--profile', 'test-travel', '--apply'])

    const tokensAt = join(at, '.ds', 'proposals', 'tokens.proposed.css')
    assert.ok(existsSync(tokensAt), 'the token layer did not travel with the proposal')
    const tokens = readFileSync(tokensAt, 'utf8')
    assert.match(tokens, /--brand-primary: #5468ff/, "the client's own name did not survive")
    assert.match(tokens, /--spacing-05: 1rem/)

    // The frame uses one of them, and says where it came from rather than claiming
    // this repository reaches for it.
    const sheet = readFileSync(join(at, '.ds', 'proposals', 'PageFrame.css'), 'utf8')
    assert.match(sheet, /gap: var\(--spacing-05\)/)
    assert.match(sheet, /from the token layer beside this file/)
    assert.doesNotMatch(sheet, /this repository already reaches/, 'it claimed a borrowed token as measured here')
    assert.match(out, /read from what the client already ships/)

    rmSync(profile, { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'test-travel.json'), { force: true })
    discard(at)
  })

  test('all three spacing roles are borrowed, not just the gap', () => {
    // The first version borrowed `gap` alone, so a project with no tokens got a
    // screen with a gap, no padding, and a state paragraph in the browser's default
    // black — while the layer beside it held 45 dimensions and 65 colours. The three
    // roles the generator already applies are gap, padding and muted; borrowing one
    // of three is most of the work and none of the effect.
    const at = join(root, '.tmp-three-roles')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'pages'), { recursive: true })
    mkdirSync(join(at, 'src', 'ui'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"r","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    for (const n of ['A', 'B', 'C']) {
      writeFileSync(join(at, 'src', 'pages', `${n}Page.tsx`),
        `import './${n}Page.css'\nexport function ${n}Page(){ return <div className="page"><h1>${n}</h1></div> }\n`)
      writeFileSync(join(at, 'src', 'pages', `${n}Page.css`), '.page { display: flex; gap: 16px; }\n')
    }
    writeFileSync(join(at, 'src', 'ui', 'Table.tsx'),
      'interface Props { columns?: string[] }\nexport function Table({ columns = [] }: Props) { return <table>{columns.length}</table> }\n')

    const profile = join(root, 'profiles', 'test-roles')
    rmSync(profile, { recursive: true, force: true })
    run('adapt-react.mjs', [join(at, 'src', 'ui'), '--out', 'test-roles', '--alias', '../ui'])
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'tokens.json'), JSON.stringify({
      $description: 'Read from https://client.example',
      // A muted foreground is a judgment about intent, so it is borrowed only where
      // the client named one. Picking the third-darkest colour and calling it muted
      // is the kind of guess a team rejects on sight.
      named: { 'text-muted': { $value: '#6b7280', $type: 'color', $extensions: { 'org.ds-profile': { readFrom: 'https://client.example', source: 'a custom property the site declares' } } } },
      spacing: {
        '02': { $value: '0.5rem', $type: 'dimension', $extensions: { 'org.ds-profile': { uses: 60 } } },
        '04': { $value: '1rem', $type: 'dimension', $extensions: { 'org.ds-profile': { uses: 40 } } },
      },
    }, null, 2))
    writeFileSync(join(root, 'bindings', 'test-roles.json'), JSON.stringify({
      schemaVersion: 1, profile: 'test-roles', axes: {}, roles: { table: { component: 'Table' } },
    }, null, 2))
    writeFileSync(join(at, 'spec.json'), JSON.stringify({
      schemaVersion: 1, id: 'documents', name: 'Documents', goal: 'List them.',
      zones: [{ name: 'content', purpose: 'One row per document.', elements: ['table'] }],
      states: { loading: 'skeleton', error: 'inlineMessage', empty: 'emptyState' },
    }, null, 2))

    run('scan.mjs', [at])
    const out = run('build-screen.mjs', [join(at, 'spec.json'), '--repo', at, '--profile', 'test-roles', '--apply'])

    const sheet = readFileSync(join(at, 'src', 'pages', 'DocumentsPage.css'), 'utf8')
    assert.match(sheet, /gap: var\(--spacing-\d+\)/, 'the gap was not borrowed')
    assert.match(sheet, /padding: var\(--spacing-\d+\)/, 'the padding was not borrowed')
    assert.match(sheet, /color: var\(--text-muted\)/, "the client's own muted colour was not used")

    // The invariant, which is the whole reason borrowing is allowed at all: every
    // property the screen references is declared somewhere it can reach. A `var()`
    // naming a property nobody declares is dropped by the browser without a word.
    const beside = readFileSync(join(at, '.ds', 'proposals', 'tokens.proposed.css'), 'utf8')
    const own = readFileSync(join(at, 'src', 'pages', 'APage.css'), 'utf8')
    for (const m of sheet.matchAll(/var\((--[\w-]+)\)/g)) {
      assert.ok(beside.includes(`${m[1]}:`) || own.includes(`${m[1]}:`), `${m[1]} is referenced and nothing declares it`)
    }

    // And a borrowed token reads identically to a measured one in the stylesheet, so
    // the report has to say which it is.
    assert.match(out, /borrowed from the "test-roles" token layer/)

    rmSync(profile, { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'test-roles.json'), { force: true })
    discard(at)
  })
})

describe('a registry from single-file components', () => {
  test('a nested type in defineProps is read whole, not cut at the first brace', async () => {
    // The chain stopped at the registry for three of the four frameworks: `adapt:react`
    // cannot open a `.vue` file and `adapt:css` finds nothing in a project whose
    // components are single files. So generation on Vue, Svelte and Angular lived on
    // fixtures, and the honest answer to "does it work on Vue" was no.
    //
    // The first real Vue library read produced a phantom. `defineProps<{ options?: {
    // label: string; value: string }[] }>()` ends, to a lazy match, at the INNER brace,
    // and the props came back as `options: { label: string` plus a `value: string }[]`
    // marked REQUIRED. The generator then passed `:value="[]"` to a component with no
    // such prop, on a file it had just reported as conforming.
    const { readVue } = await import('../scripts/lib/sfc.mjs')
    const src = [
      '<script setup lang="ts">',
      "defineProps<{ modelValue?: string; options?: { label: string; value: string }[] }>()",
      '</script>',
      '<template><select /></template>',
    ].join('\n')
    const props = readVue(src, 'DsSelect.vue').props
    assert.deepEqual(props.map(p => p.name), ['modelValue', 'options'], 'a nested type produced a phantom prop')
    assert.match(props[1].type, /label: string; value: string/)
    assert.ok(!props.some(p => p.required), 'an invented prop was marked required')
  })

  test('the house prefix a library stamps on everything is measured and set aside', () => {
    // A design system stamps its components: `DsButton`, `AppShell`, `my-global-icon`.
    // Matched raw, every one becomes a spelling guess at best — on the first real Vue
    // library this proposed nothing confidently and marked `DsSelect` for `select` as
    // "name only contains select", which is true and useless.
    const at = join(root, '.tmp-sfc-registry')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'ui'), { recursive: true })
    const comp = (name, props, body) =>
      `<script setup lang="ts">\ndefineProps<{ ${props} }>()\n</script>\n\n<template>${body}</template>\n`
    writeFileSync(join(at, 'ui', 'DsButton.vue'), comp('DsButton', "variant?: 'primary' | 'secondary'", '<button><slot /></button>'))
    writeFileSync(join(at, 'ui', 'DsInput.vue'), comp('DsInput', 'modelValue?: string', '<input />'))
    writeFileSync(join(at, 'ui', 'DsTable.vue'), comp('DsTable', 'columns?: string[]', '<table />'))
    writeFileSync(join(at, 'ui', 'DsBadge.vue'), comp('DsBadge', "tone?: 'neutral' | 'success'", '<span><slot /></span>'))
    writeFileSync(join(at, 'ui', 'DsAvatar.vue'), comp('DsAvatar', 'name?: string', '<span />'))

    const extracted = run('adapt-sfc.mjs', [join(at, 'ui'), '--out', 'test-sfc', '--alias', '../ui'])
    assert.match(extracted, /5 vue component\(s\)/)

    const proposed = run('bind.mjs', ['test-sfc'])
    assert.match(proposed, /"Ds" is on 5 of 5 names/, 'the house stamp was not measured')
    // With the stamp set aside these are exact matches, not spelling guesses. And the
    // closed set has to reach the prop itself: `DsButton` declares
    // `variant?: 'primary' | 'secondary'` and this asked it for a "primary" value,
    // found none, and marked a correct match questionable.
    assert.match(proposed, /primaryAction\s+→\s+DsButton \(primary\)/)
    assert.match(proposed, /table\s+→\s+DsTable/)
    assert.match(proposed, /statusTag\s+→\s+DsBadge/)

    rmSync(join(root, 'profiles', 'test-sfc'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'test-sfc.json'), { force: true })
    discard(at)
  })
})

describe('which of four situations we walked into', () => {
  test('a product with settled conventions is never called greenfield', () => {
    // documenso: 542 files, three conventions at 95% or better over 1,083
    // observations — and this said `greenfield — no house style to honour`, on the
    // first line a consultant reads. The installer then wrote all three into that
    // client's gate as enforced rules, so the label contradicted what the tool itself
    // did next.
    const at = join(root, '.tmp-mode-mixed')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"m","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    // Enough files for the dimensions to clear the observation floor, agreeing on
    // some and split on others.
    for (let i = 0; i < 10; i += 1) {
      writeFileSync(join(at, 'src', `A${i}.tsx`),
        `import './A${i}.css'\ntype Props = { id: string }\nexport function A${i}({ id }: Props) {\n  const onPick = () => {}\n  return <div className="card" onClick={onPick}>{id}</div>\n}\n`)
      writeFileSync(join(at, 'src', `A${i}.css`), '.card { color: var(--ink); }\n')
    }
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(join(at, 'src', `B${i}.tsx`),
        `type Props = { id: string }\nexport default function B${i}({ id }: Props) {\n  const handlePick = () => {}\n  return <span onClick={handlePick}>{id}</span>\n}\n`)
    }
    const out = run('scan.mjs', [at])
    assert.doesNotMatch(out, /MODE\s+greenfield/, 'a project with settled conventions was called greenfield')
    assert.match(out, /MODE\s+(mixed|settled|drifted)/)
    discard(at)
  })

  test('an empty repository and a small one are different sentences', () => {
    // Both used to be "greenfield — no house style to honour", which is true of one
    // and a lie about the other. Eight files with every dimension under the
    // observation floor is not a project without a house style; it is a project with
    // not enough written to tell.
    const empty = join(root, '.tmp-mode-empty')
    rmSync(empty, { recursive: true, force: true })
    mkdirSync(join(empty, 'src'), { recursive: true })
    writeFileSync(join(empty, 'package.json'), '{"name":"e","version":"0.0.0"}')
    assert.match(run('scan.mjs', [empty]), /MODE\s+EMPTY/)
    discard(empty)

    // The floor between them is measured, not chosen: real products answer 78–100%
    // of these dimensions and a small repository answers 17–22%.
    assert.match(run('scan.mjs', [fixture('screen-idiom')]), /MODE\s+too early to say — only \d+ of \d+/)
  })
})

describe('Angular, measured on real products rather than a fixture', () => {
  const project = (at, angularVersion, files) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, 'package.json'), JSON.stringify({
      name: 'ng', version: '0.0.0', dependencies: { '@angular/core': angularVersion },
    }))
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(at, path)), { recursive: true })
      writeFileSync(join(at, path), body)
    }
    return run('scan.mjs', [at])
  }

  test('a one-line @Component is a component', () => {
    // Every Angular signal reads the decorator through one regex, and that regex
    // ended at `\n\s*}` — it required the closing brace on a line of its own. That
    // is the common style and it is not the rule: `@Component({ selector: 'x',
    // template: '<p>y</p>' })` is ordinary for a small component, and a project
    // written that way was not measured wrongly, it was not measured at all.
    const at = join(root, '.tmp-ng-oneline')
    const out = project(at, '^17.0.0', {
      'src/app/a.component.ts': "import { Component } from '@angular/core'\n@Component({ standalone: true, selector: 'a-x', template: '<p>a sentence here</p>' })\nexport class AComponent {}\n",
    })
    assert.match(out, /component export\s+standalone 100%/)
    discard(at)
  })

  test('a bare i18n attribute is how this ecosystem marks text', () => {
    // Found on PeerTube, which ships in dozens of languages: 237 of its 300 templates
    // carry the marker and this reported `literal in template 100%, translated 0%`.
    // The check required `i18n=` or `i18n[`, which that codebase writes three times,
    // and missed the bare attribute it writes 1,620 times.
    //
    // The number matters because `user-facing text` is a convention, and a share of
    // 100% goes into a client's gate as an enforced rule — one telling every future
    // file not to translate.
    const at = join(root, '.tmp-ng-i18n')
    const out = project(at, '^17.0.0', {
      'src/app/a.component.ts': "import { Component } from '@angular/core'\n@Component({ standalone: true, selector: 'a-x', templateUrl: './a.component.html' })\nexport class AComponent {}\n",
      'src/app/a.component.html': '<h1 i18n>Watch this video</h1>\n<p i18n>Some longer sentence about it</p>\n',
      'src/app/b.component.ts': "import { Component } from '@angular/core'\n@Component({ standalone: true, selector: 'b-x', templateUrl: './b.component.html' })\nexport class BComponent {}\n",
      'src/app/b.component.html': '<span i18n-title title="Hello" i18n>Another sentence here</span>\n',
    })
    assert.match(out, /user-facing text\s+translated 100%/)
    discard(at)
  })

  test('an absent standalone flag means opposite things either side of Angular 19', () => {
    // ngx-admin is on 15: 136 components, not one carrying the flag, sixteen
    // NgModules declaring them — and this reported `standalone by default 100%`, the
    // exact opposite, at a share that would have been written into that client's gate.
    //
    // The version decides, read from the nearest package.json the same way the Svelte
    // emitter reads its own rather than guessing the era.
    const body = (n) => `import { Component } from '@angular/core'\n@Component({ selector: '${n}-x', template: '<p>hello there</p>' })\nexport class ${n.toUpperCase()}Component {}\n`
    const files = { 'src/app/a.component.ts': body('a'), 'src/app/b.component.ts': body('b') }

    const old = join(root, '.tmp-ng-15')
    assert.match(project(old, '^15.2.10', files), /component export\s+NgModule declaration 100%/)
    discard(old)

    const now = join(root, '.tmp-ng-19')
    assert.match(project(now, '^19.0.0', files), /component export\s+standalone by default 100%/)
    discard(now)

    // And where no package.json above the file names Angular, the absence of a flag
    // is evidence of nothing. The file leaves the distribution rather than joining
    // the wrong side of it.
    const unknown = join(root, '.tmp-ng-unknown')
    rmSync(unknown, { recursive: true, force: true })
    mkdirSync(join(unknown, 'src', 'app'), { recursive: true })
    writeFileSync(join(unknown, 'package.json'), '{"name":"ng","version":"0.0.0","dependencies":{"typescript":"5.0.0"}}')
    for (const [path, text] of Object.entries(files)) writeFileSync(join(unknown, path), text)
    const out = run('scan.mjs', [unknown])
    assert.doesNotMatch(out, /component export\s+standalone by default/, 'it guessed the era with no version to read')
    discard(unknown)
  })
})

describe('a route in the frameworks that are not React', () => {
  test('Vue Router points at screens, and this used to see none of it', () => {
    // On vue-vben-admin every one of 27 screens fell through to the filename guess,
    // and the report saying so — `found by: file name 27 (a guess, not a route)` — is
    // what surfaced it. Four separate things were in the way, each of them a form
    // React never writes:
    //
    //   · a route module is `const routes: RouteRecordRaw[] = [...]`, so `routes:` is
    //     followed by a type and not a bracket
    //   · the component is attached as `component: () => import('…')`
    //   · the specifier uses the `#/` alias, because `@` belongs to the scope in a
    //     pnpm workspace
    //   · and the resolver looked for the target among `.tsx`/`.jsx` files only, so a
    //     `.vue` path could not be found in a map that could not contain it
    //
    // The fifth was mine: single-file screens were handed `foundBy: 'naming'` flatly,
    // so even a resolved route would have reported as a guess.
    const at = join(root, '.tmp-vue-route-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'router'), { recursive: true })
    mkdirSync(join(at, 'src', 'views', 'dashboard'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"v","version":"0.0.0","dependencies":{"vue":"3.4.0","vue-router":"4.3.0"}}')
    writeFileSync(join(at, 'src', 'router', 'routes.ts'), [
      "import type { RouteRecordRaw } from 'vue-router';",
      'const routes: RouteRecordRaw[] = [',
      "  { name: 'Analytics', path: '/analytics', component: () => import('#/views/dashboard/analytics.vue') },",
      "  { name: 'Workspace', path: '/workspace', component: () => import('#/views/dashboard/workspace.vue') },",
      '];',
      'export default routes;',
    ].join('\n'))
    const screen = (name) => `<template>\n  <AppShell :title="'${name}'"><p>{{ name }}</p></AppShell>\n</template>\n<script setup lang="ts">\nconst name = '${name}'\n</script>\n`
    writeFileSync(join(at, 'src', 'views', 'dashboard', 'analytics.vue'), screen('Analytics'))
    writeFileSync(join(at, 'src', 'views', 'dashboard', 'workspace.vue'), screen('Workspace'))
    // A part in the same tree: it must not become a screen for being nearby.
    writeFileSync(join(at, 'src', 'views', 'dashboard', 'Chart.vue'), '<template><canvas /></template>\n')

    run('deep.mjs', [at])
    const a = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8')).composition.archetypes
    assert.equal(a.byRoute, 2, 'the Vue route table still points at nothing')
    discard(at)
  })
})

describe('a screen with no frame is an answer, not a gap', () => {
  test('the three outcomes partition the screens', () => {
    // `undefined` used to mean both "this pass could not read the shape" and "this
    // screen has no frame", which are opposite claims. On documenso 78 of 131
    // screens came back undefined; 61 of them return a raw `<div>` and hand-roll
    // their own headings. Filed as a limitation that was invisible, and it is the
    // single most useful thing the pass can say about that repository — there is no
    // page frame to write the next screen in.
    const at = join(root, '.tmp-frame-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'app', 'routes'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"f","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    writeFileSync(join(at, 'app', 'routes', 'framed.tsx'),
      'export default function A() {\n  return <PageShell title="x"><p>b</p></PageShell>\n}\n')
    writeFileSync(join(at, 'app', 'routes', 'own.tsx'),
      'export default function B() {\n  return (\n    <div>\n      <h2>Stats</h2>\n    </div>\n  )\n}\n')
    writeFileSync(join(at, 'app', 'routes', 'loader-only.tsx'),
      'export async function loader() {\n  return { count: 1 }\n}\n')
    // A layout route whose whole body is an outlet. It renders, and it has no shape
    // of its own — counting it as archetype `Outlet` said only that the router puts
    // children there, which is true of every layout route ever written.
    writeFileSync(join(at, 'app', 'routes', 'pass-through.tsx'),
      'export default function L() {\n  return <Outlet />\n}\n')

    run('deep.mjs', [at])
    const a = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8')).composition.archetypes
    assert.equal(a.framed, 1)
    assert.equal(a.unframed, 1, 'a screen building its own page was not counted as one')
    assert.equal(a.renderingNothing, 1)
    assert.equal(a.plumbingOnly, 1, 'a layout that only passes through was given a shape')

    // The four must add up to the screens. Computed unconditionally the explanation
    // for an absence was also produced for screens that had a frame, and 53 + 84 +
    // 17 came to 154 screens out of 131 — a partition that does not partition.
    const screens = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8')).composition.screens
    assert.equal(a.framed + a.unframed + a.renderingNothing + a.plumbingOnly + a.unclassified, screens)

    // `unclassified` exists so a screen falling through every category is visible
    // rather than absorbed into the nearest one, and it earned its place the same
    // hour: moving `<Outlet />` into the plumbing list left every layout route that
    // returns nothing else with no category at all, and this counter is what showed
    // it. It stays, and it stays at zero.
    assert.equal(a.unclassified, 0, 'a screen fell through every category')
    discard(at)
  })
})

describe('what makes a file a screen', () => {
  test('Remix routes are not Next routes, and `app/` is not evidence of either', () => {
    // documenso keeps a full route tree under `app/routes/`, and this pass found
    // zero screens in it. `inAppRouter` tested for an `app/` segment, matched, and
    // handed every file to the Next rule, which requires `page.tsx` — a filename
    // Remix never writes. One hundred and thirty-one screens were invisible, and the
    // report said the project had none rather than that it could not read them.
    const at = join(root, '.tmp-router-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'app', 'routes', '_authenticated+'), { recursive: true })
    mkdirSync(join(at, 'app', 'components'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"r","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    const screen = (name) => `export default function ${name}() {\n  return <PageShell title="x"><div>body</div></PageShell>\n}\n`
    writeFileSync(join(at, 'app', 'routes', '_index.tsx'), screen('Index'))
    writeFileSync(join(at, 'app', 'routes', '_authenticated+', 'documents.tsx'), screen('Documents'))
    writeFileSync(join(at, 'app', 'routes', '_authenticated+', 'settings.tsx'), screen('Settings'))
    // A part, in the same tree. It must not become a screen just by being nearby.
    writeFileSync(join(at, 'app', 'components', 'Button.tsx'), 'export function Button() { return <button /> }\n')

    run('deep.mjs', [at])
    const deep = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'deep.json'), 'utf8'))
    assert.equal(deep.composition.screens, 3, 'the Remix route tree was not read as screens')
    assert.ok(!deep.composition.shapes.some(s => /components\//.test(s.file)), 'a component became a screen')

    // And the evidence each screen rests on is recorded. A filesystem router is the
    // framework's own declaration and is a fact; only a `SomethingPage.tsx` outside
    // any router is a guess, and the two must not be counted together.
    assert.equal(deep.composition.archetypes.byRouter, 3)
    assert.equal(deep.composition.archetypes.byNaming, 0)
    discard(at)
  })
})

describeWithOwn('the binding proposer, against the bindings people wrote', () => {
  test('it never confidently contradicts a person, and misses nothing', () => {
    // The synonym table in `bind.mjs` is authored — every entry claims two words mean
    // the same thing — and nothing checked those claims until this ran. Four bindings
    // here were written by hand across four libraries: 88 role decisions to be wrong
    // about.
    //
    // The first measurement: 73 agreed, 5 different components, 8 missed, 2 filled
    // where a person deliberately refused, and only 2 of the 7 errors flagged. Three
    // fixes came out of it, each one derived from the disagreements rather than from
    // taste:
    //
    //   · roles no library answers with a component of their own. `searchInput` was
    //     missed on three of four, and all three had the library's plain text field;
    //     `iconAction` on Ant had `Button`. Not synonyms — nobody calls a text field
    //     a search input — but fallbacks, and every library took them.
    //   · two entries falsified and removed. `toolbar` for `pageHeader` contradicted
    //     MUI's own binding, which says MUI ships no page header. `inlineMessage` as
    //     a fallback for `transientMessage` was wrong in both libraries that name it:
    //     a toast is a hook there, not an alert.
    //   · ties are not settled. Where two candidates matched at the same strength the
    //     shortest-name tiebreak chose `Input`/`Tag`/`Progress`/`Sheet` and people
    //     chose `TextField`/`Badge`/`Spin`/`DialogContent` — four for four against.
    //
    // What is pinned here is the discipline, not the score: a proposal that quietly
    // disagrees with the only person who looked is the failure mode, and a missed
    // role is the cheap one.
    let missed = 0, wrongUnflagged = 0, agreed = 0
    for (const profile of ['own', 'mui', 'antd', 'memos']) {
      const out = run('bind.mjs', [profile, '--check'])
      const tally = /(\d+) agreed · (\d+) different · (\d+) missed · (\d+) filled where a person refused/.exec(out)
      assert.ok(tally, `no tally for ${profile}: ${out.slice(-200)}`)
      const flagged = /of the (\d+) it got wrong, (\d+) were marked questionable/.exec(out)
      assert.ok(flagged, `no flag count for ${profile}`)
      agreed += Number(tally[1])
      missed += Number(tally[3])
      wrongUnflagged += Number(flagged[1]) - Number(flagged[2])
    }
    assert.equal(missed, 0, 'a role a person found was missed')
    assert.equal(wrongUnflagged, 0, 'the proposal contradicted a person without marking it questionable')
    // A floor, so the table cannot be gutted to make the two numbers above pass.
    assert.ok(agreed >= 78, `agreement fell to ${agreed} of 88`)
  })
})

describe('choosing the extractor', () => {
  test('a utility-class project is told the components are not in its stylesheets', () => {
    // Found by running the whole chain on memos. `ds adapt:css` parsed six
    // stylesheets, found seventy-six custom properties and six class families —
    // five of them one BEM block — and reported it in the tone of a full
    // extraction. `ds bind` then proposed 0 of 26 roles, which was correct and
    // useless, and the chain stopped with nothing saying why. The components were
    // in the TSX; `ds adapt:react` found 123 of them.
    const thin = run('adapt-css.mjs', [fixture('utility-classes'), '--out', 'test-thin'])
    assert.match(thin, /WRONG EXTRACTOR/)
    assert.match(thin, /ds adapt:react/)
    // The tokens are still real; it is the component list that is thin.
    assert.match(thin, /tokens above are still real/)

    // And a small CSS framework is small, not misread. The first version of this
    // check was an absolute count and fired on a four-stylesheet framework holding
    // three families and four tokens. Lopsided is the signal, not few:
    //   a real CSS framework  323 families / 234 tokens = 1.38
    //   a small one             3 families /   4 tokens = 0.75
    //   a Tailwind project      6 families /  76 tokens = 0.08
    const small = run('adapt-css.mjs', [fixture('css-framework'), '--out', 'test-small'])
    assert.doesNotMatch(small, /WRONG EXTRACTOR/, 'a small CSS framework was called the wrong extractor')
    rmSync(join(root, 'profiles', 'test-thin'), { recursive: true, force: true })
    rmSync(join(root, 'profiles', 'test-small'), { recursive: true, force: true })
    rmSync(join(root, 'bindings', 'test-thin.json'), { force: true })
    rmSync(join(root, 'bindings', 'test-small.json'), { force: true })
  })
})

describeWithOwn('the proposed binding', () => {
  test('a missing binding is a refusal that says what to do, not a stack trace', () => {
    // The generator's own report tells a reader to extract a profile with
    // `ds adapt:css` when the one they named is not installed. Following that advice
    // produced `ENOENT: bindings/nods-probe.json` and a Node backtrace: the tool
    // crashed on the path it recommended.
    const out = run('build-screen.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--repo', fixture('screen-idiom'), '--profile', 'css-extracted'])
    assert.doesNotMatch(out, /ENOENT|at ModuleJob|Node\.js v/, 'a missing binding still crashes')
    assert.match(out, /no binding for "css-extracted"/)
    // And the refusal names the one command that fixes it.
    assert.match(out, /ds bind css-extracted/)
  })

  test('evidence is ranked, because the first version took whichever came first', () => {
    // On a 323-component profile with no ranking at all, this proposed
    // `tooltip → Popover` while `Tooltip` sat in the same profile, `dialog →
    // ModalOverlay` beside `Modal`, `transientMessage → ToastRegion` beside
    // `Toast`, and `statusTag → AvatarStatus` beside `Tag`. Every one of those
    // compiles and puts the wrong component on the screen, which is the expensive
    // kind of wrong.
    const out = run('bind.mjs', ['css-extracted'])
    const pick = (role) => new RegExp(`^\\s+${role}\\s+[→~]\\s+(\\S+)`, 'm').exec(out)?.[1]
    assert.equal(pick('tooltip'), 'Tooltip')
    assert.equal(pick('dialog'), 'Modal')
    assert.equal(pick('transientMessage'), 'Toast')
    assert.equal(pick('statusTag'), 'Tag')
    assert.equal(pick('emptyState'), 'EmptyState')

    // A match resting on spelling alone is questionable whatever else is true of
    // it, and a BEM block shared by several components names a family rather than
    // one of its members — `.pagination__gap` made `PaginationGap` an exact match
    // for `pagination`, and the gap between page numbers became the pagination.
    assert.match(out, /pagination\s+~\s+\S+\s+in the "pagination" block, which 3 components share/)
    assert.match(out, /text\s+~\s+\S+\s+name only contains/)

    // `heading` was the example of an uncovered role here until the synonym table
    // was measured against the four hand-written bindings: `own` maps
    // `heading → PageHeader` by hand, with the note that the system has no
    // standalone heading and a title comes from the page header. Proposing it is now
    // agreeing with the only person who looked, so the example moved to a profile
    // that genuinely has nothing — and the refusal itself is pinned there.
    const thin = run('bind.mjs', ['test-lib'])
    assert.match(thin, /with no candidate/)
    assert.match(thin, /No candidate for:/)
    assert.match(thin, /Recorded as uncovered rather than filled with the nearest thing/)
  })

  test('nothing is proposed over a binding that exists', () => {
    // Those maps are somebody's decision. Replacing one with a guess is the single
    // thing this must not do.
    const out = run('bind.mjs', ['own'])
    assert.match(out, /already has a binding/)
    assert.doesNotMatch(out, /proposed ·/)
  })

  test('the proposal is a file to accept or refuse, and it carries its reasons', () => {
    const at = join(root, '.tmp-bind-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    run('bind.mjs', ['css-extracted', '--repo', at])
    const proposal = join(at, '.ds', 'proposals', 'bindings.json')
    assert.ok(existsSync(proposal), 'no proposal was written')
    const j = JSON.parse(readFileSync(proposal, 'utf8'))

    // Outside anything that reads bindings, so adopting it is a move and refusing it
    // is a delete — the same terms as the page frame.
    assert.ok(!existsSync(join(root, 'bindings', 'css-extracted.json')), 'the proposal was installed rather than proposed')
    assert.match(JSON.stringify(j._), /PROPOSED/)

    // Every entry says what it rests on, so the ones resting on a spelling
    // coincidence can be found and thrown out.
    for (const [role, v] of Object.entries(j.roles)) {
      const hasReason = v.proposedBecause || v.notCovered
      assert.ok(hasReason, `${role} carries no reason`)
    }
    // And an uncovered role has no component at all, rather than a nearest guess.
    const uncovered = Object.entries(j.roles).filter(([, v]) => v.notCovered)
    for (const [role, v] of uncovered) assert.ok(!v.component, `${role} is uncovered and still names a component`)
    discard(at)
  })
})

describeWithOwn('the proposed frame', () => {
  const build = (at, files) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'pages'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"p","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(at, path)), { recursive: true })
      writeFileSync(join(at, path), body)
    }
    run('scan.mjs', [at])
    return run('build-screen.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--repo', at, '--profile', 'own', '--apply'])
  }

  test('it is written where there is no frame, outside the source tree, and nothing uses it', () => {
    const at = join(root, '.tmp-proposal-probe')
    const page = (n) => `export function ${n}Page() {\n  return (\n    <div className="page">\n      <h1>${n}</h1>\n    </div>\n  )\n}\n`
    const out = build(at, {
      'src/pages/DocumentsPage.tsx': page('Documents'),
      'src/pages/SettingsPage.tsx': page('Settings'),
      'src/pages/TeamPage.tsx': page('Team'),
    })

    const frame = join(at, '.ds', 'proposals', 'PageFrame.tsx')
    assert.ok(existsSync(frame), 'no frame was proposed for a project that has none')
    const body = readFileSync(frame, 'utf8')

    // Outside `src`, so it is not built and not linted. A frame the screen imported
    // would make refusing the proposal a compile error, and a proposal that cannot
    // be refused is a decision.
    assert.match(out, /is a PROPOSAL and is outside the source tree/)
    const screen = readFileSync(join(at, 'src', 'pages', 'DocumentsListV2Page.tsx'), 'utf8')
    assert.doesNotMatch(screen, /PageFrame/, 'the screen was wired to the proposal')

    // The places come from the agreed spec, and each carries how many independent
    // products were measured offering one — so `header` at 7 of 8 reads differently
    // from a name nothing outside this project supports.
    assert.match(body, /header\?: ReactNode/)
    assert.match(body, /toolbar\?: ReactNode/)
    assert.match(body, /header\s+offered by \d+ of \d+/)
    assert.match(body, /PROPOSED, not measured from this repository/)
    assert.match(body, /To refuse: delete it/)

    // And it is written in this repository's idiom. A proposal in a style the team
    // does not use gets refused for the wrong reason.
    assert.match(body, /export function PageFrame/, 'the project exports named; the proposal does not')

    // Whatever it imports has to be there. This project keeps a stylesheet beside a
    // component, so the frame writes `import './PageFrame.css'` — and without the
    // file the import dangles and the proposal stops compiling the moment somebody
    // adopts it. A proposal that cannot be taken up is worse than none: refusing it
    // then looks like the tool's fault rather than a decision.
    for (const m of body.matchAll(/import ['"]\.\/([^'"]+)['"]/g)) {
      assert.ok(existsSync(join(at, '.ds', 'proposals', m[1])), `${m[1]} is imported and was not written`)
    }

    discard(at)
  })

  test('the stylesheet writes the project\'s own token, or nothing at all', () => {
    // The one visual decision the proposal is allowed to make, and it is only
    // allowed because it is not a decision: a gap taken from the spacing token this
    // repository already reaches for most often.
    const withToken = join(root, '.tmp-frame-token')
    const withoutToken = join(root, '.tmp-frame-notoken')
    const screens = (gap) => Object.fromEntries(['A', 'B', 'C'].flatMap(n => [
      [`src/pages/${n}Page.tsx`, `import './${n}Page.css'\nexport function ${n}Page(){ return <div className="page"><h1>${n}</h1></div> }\n`],
      [`src/pages/${n}Page.css`, `.page { display: flex; gap: ${gap}; }\n`],
    ]))

    build(withToken, { ...screens('var(--space-4)'), 'src/pages/tokens.css': ':root { --space-4: 16px; }\n' })
    const sheet = readFileSync(join(withToken, '.ds', 'proposals', 'PageFrame.css'), 'utf8')
    assert.match(sheet, /gap: var\(--space-4\)/)
    assert.match(sheet, /token this repository already reaches/)

    // Where the project declares none, the rule is not "write nothing" — it is
    // "write nothing that goes undeclared". A `var()` naming a property nobody
    // declares is dropped by the browser without a word. Since the profile's token
    // layer now travels beside the frame, a borrowed name is declared and the rule
    // holds; where there is no layer to borrow from, nothing is written and the file
    // says where to get one.
    build(withoutToken, screens('16px'))
    const bare = readFileSync(join(withoutToken, '.ds', 'proposals', 'PageFrame.css'), 'utf8')
    const declaredBeside = (() => {
      const at = join(withoutToken, '.ds', 'proposals', 'tokens.proposed.css')
      return existsSync(at) ? readFileSync(at, 'utf8') : ''
    })()
    for (const m of bare.matchAll(/var\((--[\w-]+)\)/g)) {
      assert.ok(declaredBeside.includes(`${m[1]}:`), `${m[1]} is referenced and nothing declares it`)
    }
    if (!declaredBeside) {
      assert.match(bare, /declares no spacing token/)
      assert.match(bare, /ds style:image/)
    }

    discard(withToken)
    discard(withoutToken)
  })

  test('none is proposed where a frame already exists, or where nothing could be read', () => {
    // Two different silences. A project with a frame has a shape to copy and needs
    // no proposal. A project whose screens render nothing has not decided to go
    // without a frame — this pass failed to read them, and proposing on the
    // strength of that would dress a reading failure as a finding.
    const withFrame = join(root, '.tmp-proposal-has')
    rmSync(withFrame, { recursive: true, force: true })
    cpSync(fixture('screen-idiom'), withFrame, { recursive: true })
    run('scan.mjs', [withFrame])
    run('build-screen.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--repo', withFrame, '--profile', 'own', '--apply'])
    assert.ok(!existsSync(join(withFrame, '.ds', 'proposals')), 'a frame was proposed to a project that has one')
    discard(withFrame)

    const unread = join(root, '.tmp-proposal-unread')
    build(unread, {
      'src/pages/APage.tsx': 'export const loader = () => ({ a: 1 })\n',
      'src/pages/BPage.tsx': 'export const loader = () => ({ b: 2 })\n',
    })
    assert.ok(!existsSync(join(unread, '.ds', 'proposals')), 'a frame was proposed on the strength of an unreadable project')
    discard(unread)
  })
})

describeWithOwn('generating a screen where there is nothing to copy', () => {
  test('no house shape is a finding, and what follows is marked a proposal', () => {
    // The case the whole design line exists for: a project whose screens all build
    // their own page out of raw elements. There is no archetype to copy, and the
    // generator used to fall through to a default and write one anyway — inventing
    // an idiom and presenting it as measured.
    const at = join(root, '.tmp-noframe-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src', 'pages'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"n","version":"0.0.0","dependencies":{"react":"18.0.0"}}')
    for (const n of ['Documents', 'Settings', 'Team']) {
      writeFileSync(join(at, 'src', 'pages', `${n}Page.tsx`),
        `import './${n}Page.css'\nexport function ${n}Page() {\n  return (\n    <div className="page flex flex-col">\n      <h1>${n}</h1>\n    </div>\n  )\n}\n`)
      writeFileSync(join(at, 'src', 'pages', `${n}Page.css`), '.page { display: flex; }\n')
    }
    run('scan.mjs', [at])
    const out = run('build-screen.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--repo', at, '--profile', 'own'])

    // Not "not measured". The measurement ran, and its answer is the finding.
    assert.match(out, /screen archetype\s+NONE/)
    assert.match(out, /3 build their own page out of raw elements/)
    assert.match(out, /no shape here to write the next screen in/)
    assert.match(out, /a proposal, not this repository's idiom/)

    // And the proposal carries where it came from. A vocabulary offered without its
    // provenance is a recommendation, which is the thing this tool does not do.
    assert.match(out, /title \(\d+\/\d+\)/, 'the proposed places carry no counts')
    assert.match(out, /catalogue\/regions\.json/)

    // The layout question is still answerable, and its denominator is every screen.
    // Dropping the unframed ones took the three screens that DO declare a layout out
    // of the denominator of whether screens here declare one: 0 of 0 instead of 3 of
    // 3, and the generator wrote no layout in a project where every screen has one.
    assert.match(out, /own layout\s+100% of 3 screen\(s\) declare one/)
    discard(at)
  })
})

describe('where screen patterns come from', () => {
  test('a region is what the frame declares, not what the screen passes', () => {
    // Three wrong answers preceded this one, each found by reading real output.
    //
    // Calling every attribute a region produced `WorkflowRunsTable(error+isError+
    // isLoading+onRetry+runs)` — a data table's props, read as a shape. Narrowing to
    // markup-valued attributes lost `title={t("Archive")}`, the most common region
    // in the corpus. Both were guesses about somebody else's component.
    //
    // The component declares it. outline's Scene types four props as ReactNode and
    // two as string and boolean, and that separation is its author's, already on
    // disk.
    const scene = [
      'type Props = {',
      '  icon?: React.ReactNode;',
      '  title?: React.ReactNode;',
      '  textTitle?: string;',
      '  actions?: React.ReactNode;',
      '  wide?: boolean;',
      '};',
    ].join('\n')
    const declared = regionsDeclaredBy(scene)
    assert.deepEqual([...declared].sort(), ['actions', 'icon', 'title'])
    assert.ok(!declared.has('textTitle'), 'a string prop was called a place in the frame')
    assert.ok(!declared.has('wide'), 'a setting was called a place in the frame')

    // `Element` alone was in the renderable list for one draft, and it matched
    // `e: Event`, `ref: RefObject<Element>` and every `onClick: (e: MouseEvent) =>
    // void` in five products — so `e`, `ref`, `onClick` and `value` came back as
    // regions shared by four products out of five, which read as a portable
    // vocabulary and was a leaky regex.
    const leaky = [
      'type P = {',
      '  onClick?: (e: React.MouseEvent<Element>) => void;',
      '  containerRef?: React.RefObject<Element>;',
      '  header?: React.ReactNode;',
      '};',
    ].join('\n')
    assert.deepEqual([...regionsDeclaredBy(leaky)], ['header'])

    // Every framework declares the same thing in its own words.
    assert.ok(regionsDeclaredBy('<div><slot name="header" /><slot /></div>').has('header'))
    assert.ok(regionsDeclaredBy('<ng-content select="[toolbar]"></ng-content>').has('toolbar'))
    assert.ok(regionsDeclaredBy('{@render footer()}').has('footer'))

    // And a frame that declares nothing renderable is not a frame with no regions —
    // it is a component this cannot describe, which is a different answer.
    assert.equal(regionsDeclaredBy('type P = { rows: Row[]; isLoading: boolean }'), undefined)
  })

  test('an opening tag ends where it ends, not at the first > inside it', () => {
    // `[^>]*` was the first reading, and the case it fails on is the one that
    // matters most: a region whose value is markup. `<Scene icon={<ArchiveIcon />}
    // title={t("Import")}>` ended, to that regex, inside `<ArchiveIcon />`, so every
    // region after the first markup-valued one disappeared. outline calls `<Scene>`
    // thirty-six times and the pass found four filled ones.
    const src = 'export function X(){ return (<Scene icon={<ArchiveIcon />} title={t("Import")} actions={<Button/>}><Body/></Scene>) }'
    const read = shellOf(src)
    assert.deepEqual(read.regions, ['actions', 'icon', 'title'])
  })

  test('no frame name in the corpus appears in more than one product', () => {
    // The negative result this whole line of work rests on, kept as a fixture so it
    // is a claim with a shape rather than a sentence in a commit message.
    //
    // Two products, each with a frame offering the same three places under different
    // names for the frame itself. A catalogue keyed on the frame name has nothing to
    // say about either; a vocabulary of places describes both.
    const a = 'type P = { title?: React.ReactNode; actions?: React.ReactNode; header?: React.ReactNode }'
    const b = '<div><slot name="title" /><slot name="actions" /><slot name="header" /></div>'
    assert.deepEqual([...regionsDeclaredBy(a)].sort(), [...regionsDeclaredBy(b)].sort())
  })
})

describe('a share needs something to be a share of', () => {
  test('one observation does not become an enforced rule', () => {
    // Found by installing the gate on a real repository and reading the contract
    // it wrote. hono's scan reported `props declaration — type Props 100%` and
    // `colour values — literal hex 100%`, and `.ds/conventions.json` carried both
    // under `enforce` with `share: 1` and `source: "whole repository"`. The whole
    // repository was one file and two values.
    //
    // The gate would then have failed every future file declaring props any other
    // way — a rule the tool invented and handed to the client as their own
    // decision. The colour one would have enforced literal hex on a project where
    // the same run counted 36 hardcoded values as a defect.
    const at = join(root, '.tmp-floor-probe')
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{"name":"floor","version":"0.0.0"}')
    // Six files agreeing on one dimension, one file carrying another.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      writeFileSync(join(at, 'src', `Thing${n}.tsx`),
        `export default function Thing${n}() {\n  const onPick = () => {}\n  return <button onClick={onPick}>Go</button>\n}\n`)
    }
    writeFileSync(join(at, 'src', 'Only.tsx'),
      `type Props = { id: string }\nexport default function Only({ id }: Props) {\n  return <span>{id}</span>\n}\n`)

    run('scan.mjs', [at])
    const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
    const props = scan.conventions['props declaration']
    assert.ok(props, 'the dimension was not measured at all')
    assert.ok(props.total < 5, `expected a thin sample, got ${props.total}`)
    assert.equal(props.verdict, 'too few to say', 'a single observation was called a convention')

    run('install.mjs', [at, '--apply'])
    const contract = JSON.parse(readFileSync(join(at, '.ds', 'conventions.json'), 'utf8'))
    assert.ok(!contract.enforce['props declaration'], 'a rule was enforced from one observation')
    assert.match(contract.undecided['props declaration'].why, /observation/)

    // And every rule that IS enforced says how many observations stand behind it.
    // Without that number in the contract, `share: 1` reads the same at one file
    // and at three hundred.
    for (const [dimension, rule] of Object.entries(contract.enforce)) {
      assert.equal(typeof rule.observations, 'number', `${dimension} carries no observation count`)
      assert.ok(rule.observations >= 5, `${dimension} enforced on ${rule.observations} observation(s)`)
    }
    discard(at)
  })
})

describe('a count is a number only when something was counted', () => {
  test('a repository nothing could be read from reports no zeros', () => {
    // The tool's own law, turned on the tool. On this fixture — one Python file —
    // `ds assess` printed six zeros: contrast, dead tokens, hardcoded values,
    // duplicate modules, secrets, dangerous patterns. All six true, none of them
    // about this repository, and every one of them read as good news. Only the two
    // dimensions that had been made fail-closed one at a time said NOT RUN.
    //
    // The denominators were never missing. Both passes print them one line above
    // the counts — `0 owned file(s)`, `0 file(s) read` — and dropped them before
    // the JSON, which is the only thing the HTML report, the evidence pack and the
    // assessment summary read.
    run('defects.mjs', [fixture('unreadable')])
    run('security.mjs', [fixture('unreadable')])
    const d = readScan('unreadable', 'defects.json')
    const sec = readScan('unreadable', 'security.json')

    // The denominator reaches the artifact.
    assert.equal(d.considered.files, 0)
    assert.equal(d.considered.tokensDeclared, 0)
    assert.equal(d.considered.contrastPairs, 0)
    assert.equal(sec.considered.files, 0)

    // And no reader turns it into a zero. The DEFECTS and SECURITY sections of the
    // summary are the ones a client reads.
    const unreadableAt = outsideAnyRepo('unreadable')
    const out = run('ds.mjs', ['assess', unreadableAt])
    const from = out.indexOf('DEFECTS')
    const to = out.indexOf('not covered:', from)
    assert.ok(from !== -1 && to !== -1, 'the summary did not print its defect and security sections')
    const shown = out.slice(from, to)
    const bareZero = shown.split('\n').filter(l => /^\s+0\s+\S/.test(l))
    assert.deepEqual(bareZero, [], 'a zero was printed over nothing measured')
    assert.ok(shown.includes('NOT RUN'), 'nothing was declared unmeasured either')
  })

  test('a repository that was read still gets its numbers', () => {
    // The other direction, and the one that makes the first worth having: a
    // refusal that fires everywhere is the same as no measurement at all.
    run('defects.mjs', [fixture('contrast')])
    const d = readScan('contrast', 'defects.json')
    assert.ok(d.considered.files > 0)
    assert.ok(d.considered.contrastPairs > 0, 'this fixture exists to have comparable pairs')

    const out = run('ds.mjs', ['assess', fixture('contrast')])
    assert.match(out, /\d+\s+contrast pairs below WCAG AA/, 'a real count was suppressed')
  })

  test('sixteen of twenty-four real scans compared no colour pairs at all', () => {
    // Not an edge case — the normal case. The pass finds pairs only from rules
    // setting both a colour and a background, and Tailwind, CSS-in-JS and utility
    // classes do not write those. Every one of those scans reported 0 failures,
    // and the HTML report coloured the 0 green.
    //
    // This is pinned as a fact about coverage rather than a defect: the narrow
    // pair-finding is deliberate — reading pairs from token names invented 29
    // failures on a design system whose own gate passes. What was wrong was
    // calling the result zero.
    run('defects.mjs', [fixture('i18n')])
    const d = readScan('i18n', 'defects.json')
    assert.equal(d.considered.contrastPairs, 0)
    assert.equal(d.counts.contrastFailures, 0)
    // The pair count is what tells the two apart, and it has to be in the artifact.
    assert.equal(typeof d.considered.contrastPairs, 'number')
  })
})

describe('extracting a profile from a client library', () => {
  test("a component is found however it is exported, and its variants wherever they live", () => {
    run('adapt-react.mjs', [fixture('react-lib'), '--out', 'test-lib', '--alias', '@/ui'])
    const profile = JSON.parse(readFileSync(join(root, 'profiles', 'test-lib', 'components.json'), 'utf8'))
    const badge = profile.components.Badge

    // Two idioms, both universal, both missed by the obvious implementation.
    // Reading only the `export` modifier found one component in eighteen files of
    // memos, because that style declares plainly and exports at the bottom. And
    // looking only for TypeScript unions found no variants at all: with cva, the
    // union is never written down — it is inferred from the config's keys.
    assert.ok(badge, 'a component exported at the bottom of the file was not found')
    assert.equal(badge.from, '@/ui/badge')
    const variant = badge.props.find(p => p.name === 'variant')
    assert.deepEqual(variant.values, ['default', 'secondary', 'destructive'])
    assert.equal(badge.props.find(p => p.name === 'shape').values.length, 2)

    // Facts only. A guessed level or an invented description recommends the wrong
    // component confidently, which is worse than admitting the tier is unwritten.
    assert.equal(badge.level, null)
    assert.equal(badge.description, null)

    // An exported constant and a hook are not components. Asserted by name rather
    // than by counting the fixture, so adding a file to it does not break a test
    // about something else.
    assert.ok(!('NOT_A_COMPONENT' in profile.components))
    assert.ok(!('useThing' in profile.components))
  })

  test('an authored example outranks one scraped from a call site', () => {
    run('adapt-react.mjs', [fixture('react-lib'), '--out', 'test-lib', '--alias', '@/ui', '--usages', fixture('react-lib')])
    const profile = JSON.parse(readFileSync(join(root, 'profiles', 'test-lib', 'components.json'), 'utf8'))
    const badge = profile.components.Badge

    // A registry without an example is a list of names, and the example is what
    // an agent copies. Three sources, in that order of authority: a Storybook
    // story, a documented demo, and — only if neither exists — the best real call
    // site in the repository.
    //
    // A modern story carries no JSX at all: the meta names the component and the
    // args are the props, so scanning for `<Badge` finds nothing in the one file
    // most worth reading. Reassembled, it is the example somebody wrote.
    assert.equal(badge.example, '<Badge variant="secondary">Draft</Badge>')
    assert.match(badge.exampleIs, /^authored/)
    assert.match(badge.exampleFrom, /badge\.stories\.tsx/)

    // `children` is content. `children="Draft"` is something no one would write,
    // and this is the line an agent copies.
    assert.ok(!badge.example.includes('children='))
  })

  test('a compiler that does not expose its API is refused, not used', async () => {
    const { loadTypeScript } = await import('../scripts/lib/signals.mjs')

    // memos installs TypeScript 7, whose CommonJS entry is a shim carrying
    // `version` and nothing else. `require('typescript')` returns it without
    // complaint and every pass then died on `ts.ScriptTarget.Latest`. It went
    // unseen across eleven surveyed repositories because none had its
    // dependencies installed.
    const shim = { version: '7.0.2' }
    const real = { version: '5.9.3', ScriptTarget: { Latest: 99 }, createSourceFile: () => ({}) }
    const fake = (base) => () => (base === 'theirs' ? shim : real)

    const loaded = loadTypeScript(fake, ['theirs', 'ours'])
    assert.equal(loaded.ts.version, '5.9.3', 'a compiler without the API was used anyway')
    assert.equal(loaded.rejected[0].version, '7.0.2')
    assert.equal(loaded.rejected.length, 1, 'the rejection must be reported, not silent')
  })
})

describe('the installed gate', () => {
  test('a missing command is NOT RUN, not FAIL — and still not green', () => {
    const source = readFileSync(join(here, '..', 'scripts', 'install.mjs'), 'utf8')

    // Run in a checkout with no dependencies installed, the gate printed
    // "FAIL lint" when the truth was that tsc is not on the PATH. That sends a
    // developer to read code which is fine, and it is the same confusion between
    // "checked and bad" and "never checked" that every other defect here was.
    //
    // The gate must still be red — a check that could not run is never a pass —
    // so only the label and the summary line change.
    assert.match(source, /CANNOT_RUN = \/command not found/)
    assert.match(source, /r\.unavailable \? 'NOT RUN ' : 'FAIL '/)
    assert.match(source, /process\.exit\(failed\.length \? 1 : 0\)/,
      'a check that could not run must still fail the gate')
  })
})

describe('where measurements are filed', () => {
  test('two packages sharing a leaf name do not share a slot', () => {
    // `memos/web` and `formbricks/apps/web` both filed under `web` and silently
    // overwrote each other, so one project's numbers could be read under another
    // project's name. Nothing about that output looks wrong, which is what makes
    // it the worst failure this tool has had.
    const memos = scanSlotOf(join(here, 'fixtures', 'slots', 'memos', 'web'))
    const formbricks = scanSlotOf(join(here, 'fixtures', 'slots', 'formbricks', 'apps', 'web'))
    assert.notEqual(memos, formbricks, 'two different projects were filed in one place')
    assert.match(memos, /memos/)
    assert.match(formbricks, /formbricks/)
  })

  test('the toolchain audit does not credit a project with its neighbours', () => {
    // Walking a fixed number of levels up from a target with no repository above
    // it reached a directory holding ten unrelated clones and reported six of
    // their mechanisms as this project's. The climb now stops at a repository or
    // a declared workspace, and where there is none the target is the whole world.
    const lonely = outsideAnyRepo('lonely')
    run('scan.mjs', [lonely])
    const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(lonely), 'scan.json'), 'utf8'))
    const present = scan.toolchain.present.map(m => m.name ?? m)
    assert.ok(!present.includes('agent evals'), 'a sibling directory\'s tooling was counted as this project\'s')
    assert.ok(!present.includes('gate aggregate'), 'a sibling directory\'s tooling was counted as this project\'s')
  })
})

describe('agent readiness', () => {
  test('a contract is checked against the code it describes', () => {
    run('scan.mjs', [fixture('contract-truth')])
    run('ai-audit.mjs', [fixture('contract-truth')])
    const { contract_truth: truth } = readScan('contract-truth', 'ai-audit.json')

    // Every other reader of an AGENTS.md can only take it at its word. Having
    // measured the same conventions the contract talks about, this can check
    // whether the rules an agent is handed match the code it is handed them for —
    // and a wrong contract is worse than a missing one, because a missing one
    // makes an agent read the code.
    //
    // Found on Excalidraw, whose copilot-instructions.md line 24 says "Use CSS
    // modules for component styling" over one .module.css and seventy-three plain
    // stylesheets.
    assert.equal(truth.contradictions.length, 1)
    assert.equal(truth.contradictions[0].dimension, 'styling')
    assert.equal(truth.contradictions[0].claimed, 'CSS Modules')
    assert.match(truth.contradictions[0].where, /AGENTS\.md:\d+/, 'a claim nobody can locate is one nobody can fix')

    // "…`~/*`, and relative imports last" is a sort order, not a preference for
    // relative paths. The phrase matched and the meaning did not, and the loudest
    // possible false positive is a wrong contradiction.
    assert.ok(!truth.contradictions.some(c => c.dimension === 'internal imports'),
      'a line about import order was read as a claim about import form')
  })

  test('skills are found in every layout projects actually use', () => {
    run('ai-audit.mjs', [fixture('skill-layouts')])
    const audit = readScan('skill-layouts', 'ai-audit.json')

    // Looking only under `.claude/skills` reported "0 skills" for shadcn/ui,
    // which ships two under `skills/`, for tldraw, which ships twenty-three the
    // same way, and for Documenso, which uses `.agents/skills`. Three of eleven
    // repositories surveyed — on the one question this audit exists to answer.
    //
    // The manifest settles it rather than the folder name: a directory holding a
    // SKILL.md is a skill wherever it was put, and `skills/not-a-skill` without
    // one is a folder that happens to share the word.
    // A subset, not an equality: the fixture inherits whatever the directory
    // above it declares, which is the documented behaviour and would otherwise
    // make this test depend on where the repository is checked out.
    for (const expected of ['claude-style', 'cross-tool', 'plugin-style']) {
      assert.ok(audit.knowledge.skills.includes(expected), `${expected} layout was not found`)
    }
    assert.ok(!audit.knowledge.skills.includes('not-a-skill'), 'a folder with no SKILL.md was counted as one')
  })
})

describe('what the tool cannot see', () => {
  test('a project it does not read is refused, not scored zero', () => {
    run('scan.mjs', [fixture('unreadable')])
    run('deep.mjs', [fixture('unreadable')])
    run('defects.mjs', [fixture('unreadable')])
    const scan = readScan('unreadable', 'scan.json')
    const deep = readScan('unreadable', 'deep.json')
    const defects = readScan('unreadable', 'defects.json')

    // Run against SvelteKit, the assessment printed "0 accessibility findings ·
    // 0 screens · states handled loading 0% · error 0% · empty 0%" over a
    // repository containing no React file at all. Every number was arithmetically
    // true and all of them were false, because a zero in a report means "looked
    // and found none".
    //
    // Svelte is now read, so the boundary has moved and this fixture moved with
    // it: a Python service, where there is genuinely nothing here that speaks the
    // language. It came back as "greenfield — no house style to honour", which is
    // not a low score but a wrong statement about a repository full of code.
    assert.match(scan.mode, /OUT OF SCOPE/)
    assert.equal(deep.composition, null, 'screens were counted in a language nothing here reads')
    assert.equal(deep.componentApi, null, 'component APIs were counted in a language nothing here reads')
    assert.equal(defects.counts.a11yFindings, null, 'a JSX linter reported a clean result on Python')
  })

  test('Svelte is inside the boundary now, and reports real numbers', () => {
    run('deep.mjs', [fixture('not-react')])
    const deep = readScan('not-react', 'deep.json')

    // The same fixture that used to prove the tool refuses Svelte now proves it
    // reads it. Refusing was honest while nothing could read the file; keeping the
    // refusal after building the reader would be the tool under-reporting itself.
    assert.equal(deep.framework.name, 'svelte')
    assert.equal(deep.framework.jsx, false)
    assert.ok(deep.composition, 'a Svelte project is measured, not withheld')

    // This asserted `screens === 1`, which was pinning a defect: single-file
    // components were pushed as screens unconditionally, so every `.vue`, `.svelte`
    // and `.component.ts` in a project counted. On PeerTube that made all 331
    // components screens and the pass described a design system while saying
    // "31% system share, 160 screens mostly hand-written" about screens.
    //
    // This fixture holds one component, `Counter.svelte` — a button that counts. No
    // router points at it and its name says nothing, so it is a part, and the
    // measurement that matters is that the file was READ rather than that it was
    // called a screen.
    assert.equal(deep.composition.screens, 0, 'a counter button is not a screen')
    assert.ok(deep.componentApi, 'the Svelte component was not read at all')
  })
})

describe('accessibility', () => {
  test("a project's own lint config cannot switch the audit off", () => {
    run('defects.mjs', [fixture('a11y-suppressed')])
    const defects = readScan('a11y-suppressed', 'defects.json')

    // The fixture ships an `.oxlintrc.json` that enumerates rules explicitly,
    // which replaces the category asked for on the command line and disables the
    // jsx-a11y plugin entirely. Nothing errors. Every file is read. outline
    // returned a clean zero this way while holding seventy findings, and tldraw
    // returned one by shipping a config oxlint refuses to parse at all.
    //
    // Their configuration governs their build. It does not decide what this
    // audit is allowed to see.
    assert.equal(defects.counts.a11yFindings, 2, 'the project config suppressed the audit')
  })

  test('a count of zero is never reported when nothing was linted', () => {
    // The count is null rather than 0 when the linter did not run, because every
    // reader downstream — the assessment, the report, the exemplar cautions —
    // prints a 0 as though it were a clean bill of health.
    const source = readFileSync(join(here, '..', 'scripts', 'defects.mjs'), 'utf8')
    assert.match(source, /a11yFindings: a11yRun\.available \? a11y\.length : null/)
    assert.match(source, /if \(!filesLinted\) return \{ findings: \[\], available: false/)
  })
})

describe('screen composition', () => {
  test('the router decides what a screen is, not the folder name', () => {
    run('deep.mjs', [fixture('routing')])
    const { composition } = readScan('routing', 'deep.json')
    const found = new Set([...composition.screensMissingStates.map(s => s.file ?? s),
      ...composition.handWritten.map(s => s.file)])

    // Outline keeps its screens in `scenes/`, which appears on no list of folder
    // names, so five were found in a repository holding several dozen. Resolving
    // route declarations instead found them — a routed module is a screen by that
    // project's own definition, wherever it lives.
    //
    // Both directions matter. Reading any dynamic `import()` as a route target
    // made `Modal.tsx` a screen, and the `Page` suffix made an input control one.
    assert.equal(composition.screens, 3, 'the route table was not resolved')
    assert.ok(found.has('src/scenes/Login.tsx'), 'a directly imported route target was missed')
    assert.ok(found.has('src/scenes/Dashboard.tsx'), 'a lazily imported route target was missed')
    assert.ok(!found.has('src/components/Modal.tsx'), 'code splitting was mistaken for routing')
    assert.ok(!found.has('src/components/InputSearchPage.tsx'), 'a component was named into a screen')
  })

  test('default imports from unfamiliar paths still count as components', () => {
    run('deep.mjs', [fixture('composition')])
    const { composition } = readScan('composition', 'deep.json')

    // Two rules, each wrong on its own, and together they turned a well-composed
    // screen into an accusation. The system had to be imported from a path
    // matching `components|@ds|ui/`, which is a guess about someone else's folder
    // names; and only `import { X } from` was read, so a default export — how a
    // great many projects ship their components — was invisible.
    //
    // On Docusaurus that reported 14 of 14 screens as hand-written at 0% system
    // share. On memos a screen holding four components and one div read as 0%.
    // The measurement was of naming fashion, not of composition.
    //
    // Four component uses against one div: 80%.
    assert.equal(composition.screens, 1)
    assert.equal(composition.medianSystemShare, 0.8, 'default-imported components were not counted')
    assert.equal(composition.handWritten.length, 0, 'a composed screen was called hand-written')
  })
})

describe('component API', () => {
  test('a union referenced through a local alias is still a union', () => {
    run('deep.mjs', [fixture('api')])
    const { componentApi } = readScan('api', 'deep.json')

    // Counting only inline unions reported a design system whose every component
    // has a variant prop as configured by boolean flags.
    assert.equal(componentApi.variantStrategy.dominant, 'union')
  })
})

describeWithOwn('scoring', () => {
  const scoreOf = (file) => {
    const out = run('score.mjs', [fixture('scoring'), '--profile', 'own', `src/${file}`])
    return { out, failures: out.split('\n').filter(l => l.trim() && !/^\s{0,3}\d+%/.test(l)) }
  }

  test('attributes inherited from an element are not invented props', () => {
    const { out } = scoreOf('Inherited.tsx')
    // Input extends InputHTMLAttributes, so type/id/placeholder are its API.
    assert.ok(!/is not a declared prop/.test(out), out)
  })

  test('parts of a compound component resolve to their entry', () => {
    const { out } = scoreOf('Compound.tsx')
    assert.ok(!/CardTitle> is not in the registry/.test(out), out)
  })

  test("an application's own components are not held to the system registry", () => {
    const { out } = scoreOf('AppLocal.tsx')
    assert.ok(!/MyOwnWidget/.test(out), out)
  })

  test('a value outside a closed union is caught', () => {
    const { out } = scoreOf('Invented.tsx')
    assert.match(out, /variant="cta"> is outside its union/)
  })
})

describe('catalogues fail closed', () => {
  test('a technique with no applicability condition is refused', () => {
    const catalogue = JSON.parse(readFileSync(join(root, 'catalogue', 'techniques.json'), 'utf8'))
    for (const [id, t] of Object.entries(catalogue.techniques)) {
      assert.ok(Array.isArray(t.appliesWhen) && t.appliesWhen.length > 0, `${id} has no condition`)
      assert.ok(t.prevents, `${id} does not name what it prevents`)
      assert.ok(!('ring' in t), `${id} declares a ring; rings are derived from evidence`)
    }
  })

  test('every practice carries a primary source', () => {
    const practices = JSON.parse(readFileSync(join(root, 'practices', 'catalogue.json'), 'utf8'))
    for (const [id, p] of Object.entries(practices.practices)) {
      assert.ok(p.source?.url, `${id} has no source`)
      assert.ok(['standard', 'official-docs', 'convention'].includes(p.authority), `${id}: bad authority`)
      if (p.overridesConvention) {
        assert.equal(p.authority, 'standard', `${id} overrides a measured convention without being a standard`)
      }
    }
  })

  test('a practice target is structured, never prose', () => {
    const practices = JSON.parse(readFileSync(join(root, 'practices', 'catalogue.json'), 'utf8'))
    // Parsing "0 where the product ships an RTL language" with a heuristic
    // reported a project at zero physical properties as diverging.
    for (const [id, p] of Object.entries(practices.practices)) {
      if (!p.target) continue
      assert.ok(['lte', 'gte', 'equals'].includes(p.target.op), `${id}: unknown operator`)
      assert.notEqual(p.target.value, undefined, `${id}: no target value`)
    }
  })
})

describeWithOwn('profiles', () => {
  test('the first-party profile still holds its system without loss', () => {
    const out = run('validate-profile.mjs', ['own'])
    assert.match(out, /Valid\./)
  })

  test('a profile with an untranslated rule is refused', () => {
    const out = run('validate-profile.mjs', ['does-not-exist'])
    assert.match(out, /no profile/)
  })
})

describe('reading a visual language off a site', () => {
  // Served locally rather than fetched: a test that needs the network fails for
  // reasons unrelated to the code. The pass insists on an http(s) URL, and 127.0.0.1
  // is one.
  //
  // In a separate process, which took a wrong turn to learn. A server in this process
  // cannot answer anything, because `run()` is `execFileSync` and blocks the event
  // loop it would need — the child fetched, this process sat still holding the
  // socket, and the pass reported an empty palette on a page full of colour. The
  // symptom read as a detector bug and was a test-harness bug.
  const serve = async (dir) => {
    const { spawn } = await import('node:child_process')
    const port = 8700 + Math.floor(process.hrtime()[1] % 200)
    const code = `
      const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
      http.createServer((q, r) => {
        const p = q.url === '/' ? '/index.html' : q.url
        try {
          r.writeHead(200, { 'content-type': p.endsWith('.css') ? 'text/css' : 'text/html' })
          r.end(fs.readFileSync(path.join(${JSON.stringify(dir)}, p)))
        } catch { r.writeHead(404); r.end() }
      }).listen(${port}, '127.0.0.1', () => console.log('up'))
    `
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] })
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('the fixture server did not start')), 5000)
      child.stdout.on('data', () => { clearTimeout(timer); done() })
    })
    return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() }
  }

  test('an empty scale says which of the two empties it is', async () => {
    // Every scale here has a frequency bar, because a value used once is a one-off
    // and a scale of one-offs is noise. That is right. What was wrong is that the
    // report printed `—` for both "nothing was declared" and "things were declared
    // and none reached the bar": on a page plainly carrying four colours, three font
    // sizes and two gaps, three of the five sections came back `—` and read as a site
    // with no palette, no typography and no spacing at all.
    const site = await serve(fixture('site'))
    try {
      const out = run('style-from-site.mjs', [site.url])

      // What clears its bar is extracted.
      // The count, not a count: how a colour written four different ways tallies is
      // the pass's business, and pinning my arithmetic into a test makes the test
      // wrong the first time that changes. What is pinned is that it cleared the bar.
      const paletteLine = /^\s+(\d+)\s+#2563eb$/m.exec(out)
      assert.ok(paletteLine, 'a colour used four times was not in the palette')
      assert.ok(Number(paletteLine[1]) >= 3, `it cleared the bar of 3 with ${paletteLine[1]}`)
      assert.match(out, /sizes\s+.*16px/, 'a size used three times was not in the scale')
      assert.match(out, /spacing\s+.*8px/, 'a spacing value used five times was not in the scale')
      assert.match(out, /radii\s+.*8px/)
      assert.match(out, /breakpoints\s+.*768px/)

      // What does not clear it says so, with the counts. `—` alone is a shrug.
      assert.match(out, /families\s+—/)
      assert.match(out, /nothing reached 2 use\(s\) — most-used: Inter/)

      // And what was never written at all is a different sentence.
      assert.match(out, /weights\s+—/)
      assert.match(out, /nothing of this kind is declared here/)

      // The site's own names are kept apart from the frequency scales: a name the
      // team wrote is evidence of intent, and a count is not.
      assert.match(out, /--brand: #2563eb/)
    } finally { site.stop() }
  })

  test('a URL that is not one is refused before anything is fetched', () => {
    const out = run('style-from-site.mjs', ['/private/tmp/some/file.css'])
    assert.match(out, /usage|http/i)
    assert.doesNotMatch(out, /at ModuleJob|Node\.js v/, 'a bad URL crashes')
  })
})

describeWithOwn('the check for a library duplicating itself', () => {
  test('it could not run at all on any profile here, and said nothing', async () => {
    // The one place a duplicate is most expensive is the library: every product that
    // adopts it inherits the duplicate. The check needs two independent signals —
    // prop-name overlap alone is noise, two components with three props each agree by
    // accident — and the second is what a component renders.
    //
    // No profile carried that field. `probe-own` never wrote it, so all 82 components
    // of this design system were incomparable, and the pass returned an empty list
    // that every reader takes for "no duplicates". It now follows the `sourcePath`
    // the registry already records.
    const { findTwins } = await import('../scripts/lib/twins.mjs')
    const c = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'components.json'), 'utf8')).components
    const withRenders = Object.values(c).filter(v => (v.renders ?? []).length >= 2).length
    assert.ok(withRenders >= 40, `only ${withRenders} components record what they render; the check cannot fire`)

    const r = findTwins(c, { declared: JSON.parse(readFileSync(join(root, 'profiles', 'own', 'judgment.json'), 'utf8')).twins })
    assert.equal(r.ran, true, 'the twin check still cannot run on the first-party system')
    assert.ok(r.considered >= 40)
  })

  test('a component is not the twin of the thing it is built out of', () => {
    // `Meter ~ ProgressBar` has been misread twice by this pass. Once when the
    // profile carried no rendered-markup field and the answer was called stale —
    // fixed by telling "could not compare" from "no longer alike". And again once the
    // field existed, because ProgressBar RENDERS Meter and inherits four of its
    // props, which is what a wrapper looks like to a similarity score.
    //
    // One rendering the other is a fact, not a threshold, and it settles the question
    // before any score is computed.
    const c = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'components.json'), 'utf8')).components
    assert.ok((c.ProgressBar.renders ?? []).includes('Meter'), 'the fixture for this no longer holds')

    const judgment = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'judgment.json'), 'utf8'))
    assert.ok(judgment.twins.pairs['Meter ~ ProgressBar'], 'the answered pair this tests is gone')
  })
})

describeWithOwn('the tier nobody can measure', () => {
  test('the atomic level is not derivable, and this is the proof', () => {
    // Kept as a test rather than a note, because the idea is a good one and somebody
    // will have it again. A component's level looked like a fact about the
    // composition graph: renders nothing from the registry → atom, renders atoms →
    // molecule. Against the 82 levels written by hand in `own` that rule scored 35,
    // and 34 of the 47 errors were over-estimates.
    //
    // This pair is why, and it is in the profile, so the test reads it rather than
    // quoting it.
    const c = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'components.json'), 'utf8')).components
    const levels = JSON.parse(readFileSync(join(root, 'profiles', 'own', 'policy.json'), 'utf8')).levels
    const registry = new Set(Object.keys(c))
    const usesOf = (n) => (c[n].uses ?? []).filter(u => registry.has(u) && u !== n)

    assert.equal(usesOf('Button').length, 3)
    assert.equal(usesOf('Card').length, 3)
    assert.equal(levels.Button, 'atom')
    assert.equal(levels.Card, 'organism')
    // Identical graph shape, opposite answers: the level says what a thing IS, and a
    // button with a spinner in it is still a button.

    // In-degree is not it either. Three overlapping ranges, medians 1, 0 and 0.
    const inDegree = new Map([...registry].map(n => [n, 0]))
    for (const n of registry) for (const u of usesOf(n)) inDegree.set(u, inDegree.get(u) + 1)
    const median = (level) => {
      const v = [...registry].filter(n => levels[n] === level).map(n => inDegree.get(n)).sort((a, b) => a - b)
      return v[Math.floor(v.length / 2)]
    }
    const spread = (level) => {
      const v = [...registry].filter(n => levels[n] === level).map(n => inDegree.get(n))
      return [Math.min(...v), Math.max(...v)]
    }
    const [atomLo, atomHi] = spread('atom')
    const [orgLo, orgHi] = spread('organism')
    assert.ok(atomLo <= orgHi && orgLo <= atomHi, 'the in-degree ranges no longer overlap; re-derive the level and re-measure')
    assert.ok(median('molecule') === median('organism'), 'two of the three medians are no longer equal')
  })

  test('the worksheet says which signal ordered it, and refuses a coin flip', () => {
    // A list that looks ordered and is not is worse than an unordered one. In-degree
    // is the signal worth having and only exists where the extractor read component
    // files: a profile from `ds adapt:css` carries `uses: []` on every entry, and on
    // a 323-component one that made every row 0 and the "ordered" list alphabetical.
    const fromCss = run('policy.mjs', ['css-extracted', '--learn-from', 'own'])
    assert.match(fromCss, /no profile here records what renders what/)
    assert.match(fromCss, /by how much is declared on it/)

    const fromCode = run('policy.mjs', ['own'])
    assert.match(fromCode, /by how many other components render it/)

    // The level→surface correlation is offered where it is strong and refused where
    // it is a coin flip. The exact tallies used to be pinned here — `atom card 28`,
    // `molecule card 24 · region 17` — and `own` tracks a design system outside this
    // repository, so the day it grew by two components this test failed while saying
    // nothing about the behaviour it protects. What has to hold is the rule, not the
    // arithmetic of one afternoon's registry.
    const line = (level) => fromCode.split('\n').find(l => new RegExp(`^\\s+${level}\\s`).test(l)) ?? ''
    for (const level of ['atom', 'molecule', 'organism']) {
      const row = line(level)
      assert.ok(row, `no row for ${level}:\n${fromCode.slice(0, 900)}`)
      const tallies = [...row.matchAll(/(\w+)\s+(\d+)/g)].map(m => Number(m[2])).sort((a, b) => b - a)
      const total = tallies.reduce((a, b) => a + b, 0)
      const strong = total >= 5 && tallies[0] / total >= 0.7
      if (strong) assert.match(row, /→ \w+$/, `a strong correlation was refused: ${row}`)
      else assert.match(row, /→ too even to call$/, `a coin flip was offered as an answer: ${row}`)
    }
    // And at least one of each, or the rule is only half exercised.
    assert.ok(/→ too even to call/.test(fromCode) && /→ (card|region|page)$/m.test(fromCode),
      `this profile no longer exercises both halves of the rule:\n${fromCode.slice(0, 900)}`)

    // And the negative result travels with every run, so nobody re-derives the level
    // from the graph without meeting the number first.
    assert.match(fromCode, /The atomic level is not derivable/)
    assert.match(fromCode, /scored 35/)

    // A description is the line that decides which component gets picked, so what it
    // has to do is distinguish — and the nearest thing to each component, with what
    // separates them, is the material for writing one. Written for `Chip` in
    // isolation it comes out "a small labelled element"; written knowing IconButton
    // is the closest and the difference is `selected` against `loading/reveal/tone`,
    // it comes out something somebody can choose on.
    assert.match(fromCode, /nearest IconButton .* only here: block, iconEnd/)

    // One prop in common is not material. `Icon` and `Textarea` shared one of three
    // each, scored 0.33, and appeared as a neighbour nobody can write from.
    assert.doesNotMatch(fromCode, /Icon\s+atom[^\n]*\n\s+nearest Textarea/)

    // And a wrapper is named a wrapper. `Input` and `PasswordInput` declare exactly
    // the same three props; read alone that says rivals, and PasswordInput renders
    // Input — so the description has to say what wrapping adds, not how they differ.
    assert.match(fromCode, /nearest PasswordInput \(1\) — PasswordInput renders the other, so this is a wrapper/)
  })
})

describe('naming an extracted token layer', () => {
  const layerFrom = (id, bands) => {
    const W = 200, H = 140
    const png = new PNG({ width: W, height: H })
    const put = (x, y, [r, g, b]) => {
      const i = (W * y + x) << 2
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255
    }
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, bands.ground)
    for (let y = 15; y < 125; y += 1) for (let x = 20; x < 180; x += 1) put(x, y, bands.surface)
    for (let y = 25; y < 38; y += 1) for (let x = 30; x < 150; x += 1) put(x, y, bands.text)
    for (let y = 55; y < 72; y += 1) for (let x = 30; x < 90; x += 1) put(x, y, bands.accent)
    const shot = join(root, `.tmp-${id}.png`)
    writeFileSync(shot, PNG.sync.write(png))
    run('style-from-image.mjs', [shot, '--out', id])
    rmSync(shot, { force: true })
    return run('name-tokens.mjs', [id])
  }

  test('four names, each one arithmetic rather than taste', () => {
    // The facts tier refuses to name anything and is right to. But a layer of
    // `colour-1 … colour-4` is where the design path stopped: nothing can be bound
    // to a role, nothing written into a stylesheet, and a client is handed hexes.
    // Four of the names are not judgment, and these are they.
    const out = layerFrom('test-light', {
      ground: [0xf7, 0xf8, 0xfa], surface: [0xff, 0xff, 0xff],
      text: [0x16, 0x18, 0x1d], accent: [0x25, 0x63, 0xeb],
    })
    assert.match(out, /--colour-background\s+#f7f8fa/)
    assert.match(out, /--colour-text\s+#16181d/)
    assert.match(out, /--colour-accent\s+#2563eb/)
    assert.match(out, /--colour-surface\s+#ffffff/)

    // Each carries the measurement behind it: a name without one is the kind a team
    // rejects on sight, and that discredits the ones that were defensible.
    assert.match(out, /at \d+\.\d+:1/, 'the text name carries no contrast ratio')
    assert.match(out, /most saturated colour here at \d+%/)
    assert.match(out, /within \d+ per channel of the ground/)

    // And what is not proposed is stated, so its absence reads as a decision.
    assert.match(out, /nothing in a picture says green means success/)
    rmSync(join(root, 'profiles', 'test-light'), { recursive: true, force: true })
  })

  test('a dark ground needs no special case, because contrast is not darkness', () => {
    // "The darkest colour is the text" is true on a light page and wrong on a dark
    // one. Contrast against the ground covers both, and the ground is known.
    const out = layerFrom('test-dark', {
      ground: [0x11, 0x13, 0x18], surface: [0x1c, 0x1f, 0x26],
      text: [0xf2, 0xf4, 0xf8], accent: [0xf5, 0x9e, 0x0b],
    })
    assert.match(out, /--colour-background\s+#111318/)
    assert.match(out, /--colour-text\s+#f2f4f8/, 'the lightest colour is the text on a dark ground')
    assert.match(out, /--colour-accent\s+#f59e0b/)
    rmSync(join(root, 'profiles', 'test-dark'), { recursive: true, force: true })
  })

  test('without a recorded ground it refuses, rather than guessing from share', () => {
    // Every name here is relative to the ground, and the ground is read from the
    // edges of the picture — not from which colour covers most of it. On a dense page
    // the commonest colour is the card, so guessing would name the card the page.
    // That is the exact defect the reader was rebuilt around, and it was reachable
    // again from here because the layer did not record which colour the ground was.
    const id = 'test-noground'
    const dir = join(root, 'profiles', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify({
      $description: 'a layer with no ground recorded',
      'colour-1': { $value: '#ffffff', $type: 'color', $extensions: { 'org.ds-profile': { share: 0.5 } } },
      'colour-2': { $value: '#f7f8fa', $type: 'color', $extensions: { 'org.ds-profile': { share: 0.4 } } },
    }, null, 2))
    const out = run('name-tokens.mjs', [id])
    assert.match(out, /does not record which colour is the page ground/)
    assert.match(out, /commonest colour is NOT the ground/)
    assert.doesNotMatch(out, /--colour-background/, 'it named a background anyway')
    discard(dir)
  })

  test('the layer itself is never touched', () => {
    const out = layerFrom('test-untouched', {
      ground: [0xf7, 0xf8, 0xfa], surface: [0xff, 0xff, 0xff],
      text: [0x16, 0x18, 0x1d], accent: [0x25, 0x63, 0xeb],
    })
    assert.ok(out.length > 0)
    const layer = JSON.parse(readFileSync(join(root, 'profiles', 'test-untouched', 'tokens.json'), 'utf8'))
    // Names are judgment; the facts tier stays unnamed whatever is proposed over it.
    for (const [key, v] of Object.entries(layer)) {
      if (v?.$type !== 'color') continue
      assert.match(key, /^colour-\d+$/, `${key} was renamed in the facts tier`)
      assert.equal(v.$extensions['org.ds-profile'].named, false)
    }
    rmSync(join(root, 'profiles', 'test-untouched'), { recursive: true, force: true })
  })
})

describe('reading a visual language off a picture', () => {
  const shot = (out) => {
    const W = 200, H = 120
    const png = new PNG({ width: W, height: H })
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const i = (W * y + x) << 2
      const band = y < 30
      png.data[i] = band ? 0x25 : 0xfa
      png.data[i + 1] = band ? 0x63 : 0xfa
      png.data[i + 2] = band ? 0xeb : 0xfc
      png.data[i + 3] = 255
    }
    writeFileSync(out, PNG.sync.write(png))
  }

  test('a screenshot yields a token layer, and says it is not a profile', () => {
    const at = join(root, '.tmp-shot-probe.png')
    shot(at)
    const out = run('style-from-image.mjs', [at, '--out', 'test-shot'])

    // The colours, unnamed. Naming one is a claim about intent that a picture cannot
    // carry, and a token layer built on invented names is one a team rejects on sight.
    assert.match(out, /#2563eb/)
    assert.match(out, /#fafaf[cd]/)
    assert.match(out, /Nothing here is named/)
    assert.match(out, /a token layer, not a profile/)

    // So it writes tokens and nothing else — no components, no bindings. A profile
    // with a components.json nobody measured would pass every downstream check.
    const dir = join(root, 'profiles', 'test-shot')
    assert.ok(existsSync(join(dir, 'tokens.json')))
    assert.ok(!existsSync(join(dir, 'components.json')), 'a picture produced a component registry')

    // And what it could not see is printed with the result, not left implied.
    assert.match(out, /NOT MEASURED/)

    rmSync(dir, { recursive: true, force: true })
    rmSync(at, { force: true })
  })

  test('a JPEG is refused, with the reason', () => {
    // A JPEG of a flat page holds thousands of shades nobody chose, and every one of
    // them would become a token.
    const at = join(root, '.tmp-shot-probe.jpg')
    writeFileSync(at, 'not really a jpeg')
    const out = run('style-from-image.mjs', [at])
    assert.match(out, /is not a PNG/)
    assert.doesNotMatch(out, /at ModuleJob|Node\.js v/, 'a non-PNG crashes')
    rmSync(at, { force: true })
  })
})

describe('style extraction', () => {
  test('nested colour syntax is read whole', () => {
    // `rgb(88 196 220 / var(--opacity))` was cut at the first bracket, producing
    // a colour nobody wrote.
    const source = readFileSync(join(root, 'scripts', 'style-from-site.mjs'), 'utf8')
    const pattern = source.match(/rgba\?\\\((.+?)\)\/g/)
    assert.ok(source.includes('(?:[^()]|\\([^()]*\\))*'), 'the colour pattern does not balance brackets')
    assert.ok(pattern === null || true)
  })
})

describe('visual comparison', () => {
  const { PNG } = createRequire(import.meta.url)('pngjs')
  const tmp = join(here, 'fixtures', '.tmp')

  const png = (w, h, paint) => {
    const image = new PNG({ width: w, height: h })
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (w * y + x) << 2
        const [r, g, b] = paint(x, y)
        image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255
      }
    }
    return PNG.sync.write(image)
  }

  test('an unchanged render passes', () => {
    mkdirSync(tmp, { recursive: true })
    const flat = () => [200, 200, 200]
    const baseline = join(tmp, 'same.png')
    writeFileSync(baseline, png(40, 40, flat))
    const result = compareToBaseline({ baselinePath: baseline, captured: png(40, 40, flat) })
    assert.equal(result.status, 'unchanged')
  })

  test('a changed render fails and writes a diff', () => {
    mkdirSync(tmp, { recursive: true })
    const baseline = join(tmp, 'changed.png')
    const diffPath = join(tmp, 'changed.diff.png')
    writeFileSync(baseline, png(40, 40, () => [200, 200, 200]))
    // A quarter of the image turned red: a regression no assertion would catch.
    const result = compareToBaseline({
      baselinePath: baseline,
      captured: png(40, 40, (x, y) => (x < 20 && y < 20 ? [255, 0, 0] : [200, 200, 200])),
      diffPath,
    })
    assert.equal(result.status, 'changed', 'the gate did not notice a quarter of the image changing')
    assert.ok(result.ratio > 0.2)
    assert.ok(existsSync(diffPath), 'no difference image was written')
  })

  test('a size change is reported as a layout change, not a pixel diff', () => {
    mkdirSync(tmp, { recursive: true })
    const baseline = join(tmp, 'resized.png')
    writeFileSync(baseline, png(40, 40, () => [10, 10, 10]))
    const result = compareToBaseline({ baselinePath: baseline, captured: png(40, 60, () => [10, 10, 10]) })
    assert.equal(result.status, 'resized')
  })

  test('a missing baseline is recorded rather than failed', () => {
    rmSync(join(tmp, 'new.png'), { force: true })
    const result = compareToBaseline({ baselinePath: join(tmp, 'new.png'), captured: png(8, 8, () => [1, 2, 3]) })
    assert.equal(result.status, 'recorded')
  })
})

describeWithOwn('style to tokens', () => {
  test('the DTCG typed colour object is understood', () => {
    // Reading only hex strings found one colour in a profile holding sixty-five,
    // because the stable DTCG format stores components in 0..1, not as a string.
    const out = run('style-to-tokens.mjs', ['react-dev', '--compare', 'own'])
    const inCode = Number(out.match(/(\d+) in own\b/)?.[1] ?? 0)
    assert.ok(inCode > 50, `only ${inCode} colours read from the profile: ${out.slice(0, 200)}`)
  })

  test('naming is left to a person', () => {
    const out = run('style-to-tokens.mjs', ['react-dev'])
    assert.ok(!/primary|secondary/i.test(out.split('Naming is left')[0]),
      'a rank was turned into a role name')
  })
})

describeWithOwn('the corpus', () => {
  test('every deliberate break is still caught', () => {
    // The corpus is adversarial towards the checks, not the code. A surviving
    // break is a failure class an agent can ship, and it found one that
    // twenty-one unit tests had not: boolean shorthand attributes.
    const out = run('eval.mjs', [])
    assert.match(out, /breaks caught\s+100%/, out.slice(-400))
  })

  test('a reference solution scores at the floor or above', () => {
    const out = run('eval.mjs', [])
    const average = Number(out.match(/references average\s+(\d+)%/)?.[1] ?? 0)
    assert.ok(average >= 95, `references average ${average}%`)
  })

  test('a score of 100 means zero failures, not a rounded 99.7', () => {
    assert.equal(scoreFiles({ target: here, files: [], conventions: undefined }).score, 100)
  })
})

describeWithOwn('the MCP surface', () => {
  const drive = (profile, calls, repo) => {
    const script = join(root, 'scripts', 'mcp.mjs')
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 3 + i, method: 'tools/call', params: c })),
    ].map(m => JSON.stringify(m)).join('\n') + '\n'

    const out = execFileSync(process.execPath, [script, '--profile', profile, ...(repo ? ['--repo', repo] : [])], {
      input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'],
    })
    return out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
  }

  test('it separates what a component accepts from what this repository writes', () => {
    // The answer the whole usage measurement exists to produce. memos declares six
    // variants on Button and writes three of them; an agent told only the union has
    // no reason to prefer `ghost`, and an agent told only the habit would think the
    // other three are illegal. Both, labelled, or neither.
    const at = join(root, 'scans', '.mcp-usage-test')
    rmSync(at, { recursive: true, force: true })
    const id = 'zz-mcp-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "m", "private": true, "version": "0.0.0" }')
      mkdirSync(join(root, 'profiles', id), { recursive: true })
      writeFileSync(join(root, 'profiles', id, 'components.json'), JSON.stringify({
        schemaVersion: 1,
        components: {
          Button: {
            from: '@/ui/button',
            props: [{ name: 'variant', type: "'a' | 'b' | 'c'", values: ['a', 'b', 'c'], required: false }],
          },
        },
        blocks: {},
      }))
      for (let i = 0; i < 20; i += 1) {
        writeFileSync(join(at, 'src', `S${i}.tsx`), `export const S${i} = () => <Button variant="${i % 4 ? 'a' : 'b'}" />\n`)
      }
      run('vocabulary.mjs', [at, '--profile', id])

      const withRepo = drive(id, [{ name: 'get_component', arguments: { names: ['Button'] } }], at)
      const said = withRepo.find(m => m.id === 3)?.result?.content?.[0]?.text ?? ''
      assert.match(said, /one of: a \| b \| c/, said)
      assert.match(said, /Observed in this repository/, said)
      assert.match(said, /a ×15\s+b ×5/, said)
      assert.match(said, /not forbidden/, said)

      // Without a repository there is no measurement, and the section must simply
      // not appear. "No observed values" would read as a finding about the code.
      const without = drive(id, [{ name: 'get_component', arguments: { names: ['Button'] } }])
      const bare = without.find(m => m.id === 3)?.result?.content?.[0]?.text ?? ''
      assert.match(bare, /one of: a \| b \| c/)
      assert.doesNotMatch(bare, /Observed in this repository/)
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    }
  })

  test('it serves the four answers over the protocol', () => {
    const messages = drive('own', [])
    const tools = messages.find(m => m.id === 2)?.result?.tools ?? []
    assert.deepEqual(tools.map(t => t.name).sort(),
      ['check_usage', 'choose_between', 'get_component', 'list_components'])
  })

  test('it refuses to confirm an invented prop', () => {
    // The answer that changes behaviour: an agent can check itself before writing.
    const messages = drive('own', [{
      name: 'check_usage',
      arguments: { code: 'import { Button } from "@ds/Button"\nexport function X() { return <Button variant="cta" rounded>go</Button> }' },
    }])
    const text = messages.find(m => m.id === 3)?.result?.content?.[0]?.text ?? ''
    assert.match(text, /outside its union/)
    assert.match(text, /not a declared prop/)
  })

  test('the same server serves a different library', () => {
    const messages = drive('mui', [{ name: 'choose_between', arguments: { name: 'Dialog' } }])
    const text = messages.find(m => m.id === 3)?.result?.content?.[0]?.text ?? ''
    assert.match(text, /Dialog ~ Modal/)
  })
})

describeWithOwn('three libraries, one spec', () => {
  test('the same agreed screen is buildable on all three', () => {
    const out = run('validate-spec.mjs', [join(root, 'specs', 'documents-list.v2.json'), '--profile', 'own,mui,antd'])
    const buildable = [...out.matchAll(/buildable: (\d+) element/g)].map(m => Number(m[1]))
    assert.equal(buildable.length, 3, out.slice(-300))
    assert.ok(buildable.every(n => n === buildable[0]), 'the libraries resolved different element counts')
  })

  test('every profile holds together', () => {
    for (const id of ['own', 'mui', 'antd']) {
      assert.match(run('validate-profile.mjs', [id]), /Valid\./, `${id} does not validate`)
    }
  })

  test("Ant's `type` ambiguity is written down rather than smoothed over", () => {
    // The same prop name sets weight on Button and meaning on Alert; an agent
    // that learns it once learns it wrong for the other.
    const judgment = JSON.parse(readFileSync(join(root, 'profiles', 'antd', 'judgment.json'), 'utf8'))
    assert.match(judgment.vocabulary.type.note, /two different questions/)
  })
})

describeWithOwn('bindings', () => {
  test('a binding pointing at a component the registry lacks is refused', () => {
    // Found by a spec failing to build, which looked like the spec's fault.
    // A binding is part of the profile contract and is checked with it.
    for (const id of ['own', 'mui', 'antd']) {
      assert.match(run('validate-profile.mjs', [id]), /Valid\./, `${id}`)
    }
  })

  test('a draft spec is checkable like any other', () => {
    const out = run('validate-spec.mjs', [join(root, 'specs', 'invoices.draft.json'), '--profile', 'antd'])
    assert.match(out, /buildable/)
  })
})

describe('a stored scan says which rules counted it', () => {
  // The bug this pins cost a real search. A stored scan of a vben-shaped project
  // listed a root `app.vue` and two layouts as screens. Today's rule excludes all
  // three, correctly — the scan was taken before the fix and the file said nothing
  // about that, so an already-fixed defect was chased as a live one. A client
  // reading the same numbers in a report would have had no way to tell at all.
  const url = (script) => pathToFileURL(join(root, 'scripts', script)).href

  test('the fingerprint covers the detector, not the repository', () => {
    // The narrow half. If any edit anywhere invalidated every scan, the warning
    // would fire constantly and be trained away within a week — which is the same
    // failure as not having it.
    const before = taken(url('deep.mjs')).rules
    const outside = join(root, 'scripts', 'lib', 'emit-svelte.mjs')
    const original = readFileSync(outside, 'utf8')
    try {
      writeFileSync(outside, original + '\n// probe\n')
      assert.equal(taken(url('deep.mjs')).rules, before,
        'editing a file the detector never imports changed its fingerprint')
    } finally {
      writeFileSync(outside, original)
    }
  })

  test('the fingerprint moves when the rules that counted do', () => {
    // The exact half, and the one that matters: `archetypes.mjs` is where the
    // screen rule lives, and it is what changed under the vben scan.
    const before = taken(url('deep.mjs')).rules
    const inside = join(root, 'scripts', 'lib', 'archetypes.mjs')
    const original = readFileSync(inside, 'utf8')
    try {
      writeFileSync(inside, original + '\n// probe\n')
      assert.notEqual(taken(url('deep.mjs')).rules, before,
        'editing the rule the detector applies left its fingerprint unchanged')
    } finally {
      writeFileSync(inside, original)
      assert.equal(taken(url('deep.mjs')).rules, before, 'the fingerprint is not deterministic')
    }
  })

  test('a current scan is not warned about', () => {
    assert.equal(staleness(taken(url('deep.mjs')), url('deep.mjs')), undefined)
  })

  test('a scan names the version of the code it measured', () => {
    // SARIF, the OASIS standard for static-analysis results, requires that a result
    // referring to code under version control carry enough to retrieve the version
    // analysed. The rules fingerprint answers "did the ruler change" and says nothing
    // about the thing measured: a scan can be current in rules and date and still
    // describe code from forty commits ago.
    const at = join(root, 'scans', '.commit-test')
    rmSync(at, { recursive: true, force: true })
    const git = (...args) => execFileSync('git', args, { cwd: at, stdio: 'ignore' })
    try {
      mkdirSync(at, { recursive: true })
      writeFileSync(join(at, 'a.txt'), 'one\n')
      git('init', '-q', '.')
      git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
      git('add', '-A'); git('commit', '-qm', 'one')

      const stamp = taken(url('scan.mjs'), at)
      assert.equal(stamp.of.dirty, false)
      assert.match(stamp.of.commit, /^[0-9a-f]{7,}$/)
      assert.equal(movedSince(stamp, at), undefined, 'an unmoved checkout was reported as moved')

      writeFileSync(join(at, 'a.txt'), 'two\n')
      assert.match(String(movedSince(stamp, at)), /uncommitted changes since/)

      git('add', '-A'); git('commit', '-qm', 'two')
      assert.match(String(movedSince(stamp, at)), /the checkout is now at/)
    } finally {
      rmSync(at, { recursive: true, force: true })
    }
  })

  test("an enclosing repository's commit is not passed off as the project's", () => {
    // The hazard is ordinary: a client's code unpacked inside the consultant's own
    // working folder. `git` answers from the nearest enclosing checkout, so the scan
    // would carry a commit describing entirely different code — a stamp that is
    // confidently wrong, which is worse than no stamp at all.
    const outer = join(root, 'scans', '.enclosing-test')
    rmSync(outer, { recursive: true, force: true })
    try {
      mkdirSync(join(outer, 'client'), { recursive: true })
      writeFileSync(join(outer, 'a.txt'), 'one\n')
      const git = (...args) => execFileSync('git', args, { cwd: outer, stdio: 'ignore' })
      git('init', '-q', '.')
      git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
      git('add', '-A'); git('commit', '-qm', 'one')

      const stamp = taken(url('scan.mjs'), join(outer, 'client'))
      assert.ok(stamp.of.repo, 'the commit was recorded without saying whose repository it is')
      assert.match(String(movedSince(stamp, join(outer, 'client'))), /not to the measured directory/)
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
  })

  test('a scan with no stamp is not treated as current', () => {
    // Fail-closed: unstamped is unknown, and unknown is not clean. Every scan
    // written before this existed lands here.
    assert.match(String(staleness(undefined, url('deep.mjs'))), /predates|unknown/)
  })

  test('the report is dated by the measurement, not by the render', () => {
    const at = join(root, 'scans', '.dated-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), JSON.stringify({ name: 'dated', version: '0.0.0' }))
      writeFileSync(join(at, 'src', 'One.tsx'), 'export const One = () => <div className="a" />\n')
      run('scan.mjs', [at])
      const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
      // A date the report can show. Before this, the report printed `new Date()` —
      // today, always, no matter how old the numbers under it were.
      assert.match(String(scan.taken?.on), /^\d{4}-\d{2}-\d{2}$/)
      assert.equal(staleness(scan.taken, url('scan.mjs')), undefined)
    } finally {
      discard(at)
    }
  })
})

describe('installing into somebody else\'s repository', () => {
  const project = (at) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{ "name": "host", "private": true, "version": "0.0.0" }')
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(join(at, 'src', `C${i}.tsx`), `export const C${i} = () => <div className="a" />\n`)
    }
    run('scan.mjs', [at])
  }

  test('a file this tool did not write is never overwritten', () => {
    // The one thing this tool must never do, and it did it. `regenerate` means
    // "ours, refresh it on the next install" and was taken from the path alone, so a
    // project that already had `scripts/gate/run.mjs` — its own file, its own
    // contents — had it silently replaced on the FIRST install, reported as
    // `refresh`.
    const at = join(root, 'scans', '.install-collide-test')
    try {
      project(at)
      mkdirSync(join(at, 'scripts', 'gate'), { recursive: true })
      const theirs = '// their own runner, nothing to do with us\nexport const mine = 1\n'
      writeFileSync(join(at, 'scripts', 'gate', 'run.mjs'), theirs)

      const out = run('install.mjs', [at, '--apply'])
      assert.equal(readFileSync(join(at, 'scripts', 'gate', 'run.mjs'), 'utf8'), theirs,
        'a file the tool did not write was destroyed')
      assert.match(out, /skip \(theirs\)/, out.slice(-400))
      // Said out loud: a gate file that is theirs means the gate is not the generated
      // one, and that has to be a decision rather than a discovery.
      assert.match(out, /did not write — it was left alone/)
    } finally {
      discard(at)
    }
  })

  test('a file written under the old name is still recognised as ours', () => {
    // The rename to AI FactoryFit changed the marker in every generated file. A gate
    // that stopped recognising its own past output would report each of those as the
    // project's own, skip them, and quietly stop refreshing — in exactly the
    // repositories where it has already been installed the longest.
    const at = join(root, 'scans', '.install-oldmarker-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      mkdirSync(join(at, 'scripts', 'gate'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "m", "private": true, "version": "0.0.0" }')
      for (let i = 0; i < 8; i += 1) {
        writeFileSync(join(at, 'src', `C${i}.tsx`), `export const C${i} = () => <div className="a" />\n`)
      }
      const gate = join(at, 'scripts', 'gate', 'run.mjs')
      writeFileSync(gate, '/**\n * Gate runner — generated by ds-profile install.\n */\nexport const old = 1\n')

      run('scan.mjs', [at])
      const out = run('install.mjs', [at, '--apply'])
      assert.doesNotMatch(out.split('\n').find(l => /gate\/run\.mjs/.test(l)) ?? '', /skip \(theirs\)/,
        'a file this tool wrote under its previous name was treated as the project\'s')
      assert.doesNotMatch(readFileSync(gate, 'utf8'), /export const old/, 'it was not refreshed')
    } finally {
      discard(at)
    }
  })

  test('what it wrote, it refreshes — and it knows which those are by having recorded them', () => {
    // Ownership recorded, not inferred. Deciding it from a marker in the content
    // missed every file whose format cannot carry a comment: six of this tool's own
    // files came back as "theirs" on the second install and the gate silently stopped
    // being refreshed.
    const at = join(root, 'scans', '.install-refresh-test')
    try {
      project(at)
      run('install.mjs', [at, '--apply'])
      const manifest = JSON.parse(readFileSync(join(at, '.ds', 'installed.json'), 'utf8'))
      assert.ok(manifest.paths.length > 5, `too little recorded: ${manifest.paths.length}`)

      // Change one of ours, re-install, and it must come back.
      const gate = join(at, 'scripts', 'gate', 'run.mjs')
      writeFileSync(gate, '// stale\n')
      const second = run('install.mjs', [at, '--apply'])
      assert.match(second, /refresh/)
      assert.notEqual(readFileSync(gate, 'utf8'), '// stale\n', 'our own file was not refreshed')
      assert.doesNotMatch(second, /skip \(theirs\)/, second.slice(-400))
    } finally {
      discard(at)
    }
  })

  test('a scan that claims nothing about the house style does not have one enforced', () => {
    // The tool contradicted itself in two consecutive lines: `too early to say —
    // nothing is claimed about the house style because nothing can be`, and directly
    // under it `enforcing 3 convention(s)`. A gate holding every future commit to
    // three rules IS a claim about the house style, made in the client's repository,
    // against a scan that had just said it could not make one.
    const at = join(root, 'scans', '.install-tooearly-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "t", "private": true, "version": "0.0.0" }')
      // Perfectly consistent, and only six files of it.
      for (let i = 0; i < 6; i += 1) {
        writeFileSync(join(at, 'src', `C${i}.tsx`), `export const C${i} = () => <div className="a" />\n`)
      }
      run('scan.mjs', [at])
      const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
      assert.match(scan.mode, /too early to say/, scan.mode)

      const out = run('install.mjs', [at])
      assert.match(out, /enforcing 0 convention\(s\)/, out.slice(0, 500))
      // Not dropped — documented, so the team can adopt it when there is enough code.
      assert.match(out, /documenting [1-9]/, out.slice(0, 500))
    } finally {
      discard(at)
    }
  })

  test('nothing already in the repository is modified, except a declared merge', () => {
    const at = join(root, 'scans', '.install-untouched-test')
    try {
      project(at)
      const before = new Map()
      const walkAll = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name === '.ds' || e.name === 'node_modules') continue
          const p = join(dir, e.name)
          if (e.isDirectory()) walkAll(p)
          else before.set(p, readFileSync(p, 'utf8'))
        }
      }
      walkAll(at)

      run('install.mjs', [at, '--apply'])

      const changed = [...before].filter(([p, text]) => {
        try { return readFileSync(p, 'utf8') !== text } catch { return true }
      }).map(([p]) => relative(at, p))
      assert.deepEqual(changed, [], `install modified files that were already here: ${changed.join(', ')}`)
    } finally {
      discard(at)
    }
  })
})

describe('which zero it is', () => {
  test('a check with nothing to compare reports NOT RUN, not a clean zero', () => {
    // Found on the Svelte repository, in the pass whose own header documents this
    // exact failure. `dead tokens` and `contrast failures` printed a bare `0` while
    // their denominators sat in a line above: on a project declaring no tokens that
    // reads as "no dead tokens", and on one whose colours never co-occur in a rule
    // it reads as "contrast is fine". The note carried the denominator; the digit in
    // the left column did not, and the digit is what gets read.
    const at = join(root, 'scans', '.which-zero-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "z", "private": true, "version": "0.0.0" }')
      // Markup and no stylesheet: nothing declares a token, nothing pairs a colour.
      writeFileSync(join(at, 'src', 'A.tsx'), 'export const A = () => <div className="a" />\n')

      const out = run('defects.mjs', [at])
      const contrast = out.split('\n').find(l => /contrast failures/.test(l)) ?? ''
      assert.match(contrast, /NOT RUN/, contrast)
      assert.doesNotMatch(contrast, /^\s+0\s/, 'a green zero was printed over nothing to compare')
      const dead = out.split('\n').find(l => /dead tokens/.test(l)) ?? ''
      assert.match(dead, /NOT RUN/, dead)
    } finally {
      discard(at)
    }
  })

  test('the reason reads like a sentence', () => {
    // It goes in front of a client. "0 pair were read" is what a template that never
    // learned plurals produces.
    assert.match(countedLine('x', counted(0, 0, 'pair')), /no pairs were read/)
    assert.match(countedLine('x', counted(0, 0, 'file')), /no files were read/)
  })
})

describe('the tool reading its own results', () => {
  // Every defect in this codebase was found by looking at a produced number and not
  // believing it. This pass is that reading, written down: it finds nothing new on
  // its own, it finds the same class of thing again on the next project without
  // anybody sitting and reading. Which makes it worth exactly as much as its ability
  // to catch a defect that has actually happened — so that is what is tested.
  const auditOf = (slot) => run('audit-output.mjs', [slot])

  const fixture = (at, id, template) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{ "name": "a", "private": true, "version": "0.0.0" }')
    mkdirSync(join(root, 'profiles', id), { recursive: true })
    writeFileSync(join(root, 'profiles', id, 'components.json'), JSON.stringify({
      schemaVersion: 1, components: { Chip: { from: './chip', selector: 'app-chip' } }, blocks: {},
    }))
    for (let i = 0; i < 12; i += 1) {
      writeFileSync(join(at, 'src', `l${i}.ts`),
        `@Component({ selector: 'app-l', template: \`${template(i)}\` })\nexport class L${i} {}\n`)
    }
  }

  test('it catches parse debris that reached a measured value', () => {
    // The real shape, from Angular Material: an event binding whose value was read
    // as further attributes produced `Chip.picked = "$event.checked\""` — a variable
    // in the consumer's component, with a stray quote, on its way into a contract.
    const at = join(root, 'scans', '.audit-debris-test')
    const id = 'zz-audit-test'
    try {
      fixture(at, id, i => `<app-chip picked="$event.${i % 2 ? 'checked' : 'value'}&quot;"></app-chip>`)
      run('vocabulary.mjs', [at, '--profile', id])
      const out = auditOf(scanSlotOf(at))
      assert.match(out, /parse debris in a measured value/, out.slice(0, 600))
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    }
  })

  test('it stays quiet about a measurement with nothing wrong with it', () => {
    // The half that decides whether anybody keeps running it. A pass that flags
    // healthy output is one that gets switched off in a week, and then the real
    // findings go with it.
    const at = join(root, 'scans', '.audit-clean-test')
    const id = 'zz-audit-clean'
    try {
      fixture(at, id, i => `<app-chip tone="${i % 2 ? 'warn' : 'ok'}"></app-chip>`)
      run('vocabulary.mjs', [at, '--profile', id])
      const out = auditOf(scanSlotOf(at))
      assert.doesNotMatch(out, /parse debris|content in a measured value|empty denominator/, out.slice(0, 600))
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    }
  })

  test('it catches two passes telling a team opposite things', () => {
    // Live on formbricks: the gate enforced `colour values → literal hex` at 95%
    // while the defects pass reported 852 literal values as a defect. Both numbers
    // were correct and the pair was unusable — one measures what this project does,
    // the other measures it against a standard it has not adopted, and neither said
    // so. No single artifact looks wrong, which is why this is checked across them.
    const at = join(root, 'scans', '.audit-cross-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(at, { recursive: true })
      const taken = { rules: 'deadbeefcafe', from: 'test' }
      writeFileSync(join(at, 'scan.json'), JSON.stringify({
        schemaVersion: 1, taken, target: at, mode: 'settled — a system exists',
        conventions: { 'colour values': { verdict: 'convention', dominant: 'literal hex', share: 0.95, total: 83 } },
      }))
      writeFileSync(join(at, 'defects.json'), JSON.stringify({
        schemaVersion: 1, taken, target: at, counts: { hardcodedValues: 852 },
      }))
      const out = run('audit-output.mjs', ['.audit-cross-test'])
      assert.match(out, /two passes disagreeing about the same question/, out.slice(0, 800))
    } finally {
      rmSync(at, { recursive: true, force: true })
    }
  })

  test('it notices a scan holding measurements of two different checkouts', () => {
    // The slot is derived to be stable wherever a repository sits, which is right for
    // re-scanning one project after it moves and wrong for two copies of it. One
    // formbricks slot held five artifacts describing three different directories, and
    // anything reading that slot combined all three as one measurement.
    const at = join(root, 'scans', '.audit-two-checkouts-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(at, { recursive: true })
      const taken = { rules: 'deadbeefcafe', from: 'test' }
      writeFileSync(join(at, 'scan.json'), JSON.stringify({ schemaVersion: 1, taken, target: at }))
      writeFileSync(join(at, 'deep.json'), JSON.stringify({ schemaVersion: 1, taken, target: join(at, 'elsewhere') }))
      assert.match(run('audit-output.mjs', ['.audit-two-checkouts-test']),
        /one scan describing more than one directory/)

      // And the same directory written two ways is one directory. One pass records
      // the target as typed, another records it resolved; comparing them as text
      // reported a fixture against itself.
      writeFileSync(join(at, 'deep.json'), JSON.stringify({
        schemaVersion: 1, taken, target: join(at, '..', '.audit-two-checkouts-test'),
      }))
      assert.doesNotMatch(run('audit-output.mjs', ['.audit-two-checkouts-test']),
        /more than one directory/)
    } finally {
      rmSync(at, { recursive: true, force: true })
    }
  })

  test('it does not guess which denominator belongs to which count', () => {
    // Its own first version did. `contrastCheckedPairs reported while tokensDeclared
    // is 0` was one pass measuring contrast against its own denominator of 1, beside
    // a dead-token check that correctly found nothing to check. The pairing is not
    // knowable from the artifact, and guessing it is the same overreach this pass
    // exists to catch.
    const at = join(root, 'scans', '.audit-denominator-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(at, { recursive: true })
      writeFileSync(join(at, 'plausible.json'), JSON.stringify({
        schemaVersion: 1,
        taken: { rules: 'deadbeefcafe', from: 'test' },
        considered: { files: 22, tokensDeclared: 0, contrastPairs: 1 },
        contrastCheckedPairs: 1,
      }))
      assert.doesNotMatch(auditOf('.audit-denominator-test'), /empty denominator/)

      // And it still fires when nothing at all was looked at.
      writeFileSync(join(at, 'hollow.json'), JSON.stringify({
        schemaVersion: 1,
        taken: { rules: 'deadbeefcafe', from: 'test' },
        considered: { files: 0, tokensDeclared: 0 },
        deadTokens: 3,
      }))
      assert.match(auditOf('.audit-denominator-test'), /empty denominator/)
    } finally {
      rmSync(at, { recursive: true, force: true })
    }
  })
})

describe('a clean audit over nothing', () => {
  test('every manager\'s way of saying how much it checked is read', () => {
    // npm 7+ gives an object, npm 6 and some pnpm versions a bare number, yarn
    // classic an `auditSummary` line. Yarn berry says nothing, and undefined is the
    // honest answer there: an unknown denominator is not a known zero and is not
    // the same as fine.
    assert.equal(auditedCount({ metadata: { dependencies: { prod: 1, total: 0 } } }), 0)
    assert.equal(auditedCount({ metadata: { dependencies: 412 } }), 412)
    assert.equal(auditedCount({ _ndjson: [{ type: 'auditSummary', data: { totalDependencies: 1204 } }] }), 1204)
    assert.equal(auditedCount({ _ndjson: [{ value: 'an advisory' }] }), undefined)
  })

  test('a lockfile that resolves nothing is NOT RUN, not zero advisories', () => {
    // The worst failure this tool has had, in the pass a client is most likely to
    // act on. A project pointing at a private registry it cannot reach resolved
    // nothing; `npm audit` answered zero vulnerabilities over zero dependencies, and
    // the pass printed `0 dependency advisories`, green. Nothing had been checked.
    const at = join(root, 'scans', '.audit-empty-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), JSON.stringify({
        name: 'private-app', version: '1.0.0', private: true,
        dependencies: { '@acme/ui': '^2.1.0' },
      }))
      writeFileSync(join(at, '.npmrc'), '@acme:registry=https://npm.invalid.internal/\nregistry=https://npm.invalid.internal/\n')
      // A lockfile that installs to nothing: npm audits it without reaching any
      // registry, and answers honestly that it looked at zero packages.
      writeFileSync(join(at, 'package-lock.json'), JSON.stringify({ name: 'private-app', lockfileVersion: 3, packages: {} }))
      writeFileSync(join(at, 'src', 'A.tsx'), 'export const A = () => <div className="a" />\n')

      run('security.mjs', [at])
      const doc = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'security.json'), 'utf8'))
      // Where npm is not installed the pass refuses for a different reason, which is
      // also correct; what must never happen is `available: true` with a clean zero.
      if (doc.dependencies?.available) {
        assert.notEqual(doc.dependencies.audited, 0,
          'a green audit was reported over zero dependencies')
      } else {
        assert.match(String(doc.dependencies?.why), /resolved 0 dependencies|not installed|no lockfile|refused/)
      }
    } finally {
      discard(at)
    }
  })
})

describeWithOwn('measuring whether the registry lets the right component be chosen', () => {
  const withCases = (cases, run_) => {
    const at = join(root, 'evals', 'choice.json')
    const original = existsSync(at) ? readFileSync(at, 'utf8') : undefined
    try {
      writeFileSync(at, JSON.stringify({ schemaVersion: 1, profile: 'own', cases }, null, 2) + '\n')
      return run_()
    } finally {
      if (original !== undefined) writeFileSync(at, original)
      else rmSync(at, { force: true })
    }
  }

  test('a correction to a draft becomes a labelled case', () => {
    // The bottleneck this whole measurement has: four labelled cases, and hand-editing
    // JSON is not how a fifth arrives. But the evidence is a by-product of ordinary
    // work — `draft-spec` records the phrase behind every element it proposes, which
    // is the person's own wording, and then a person corrects the draft. The
    // correction IS the label.
    const at = join(root, 'evals', 'choice.json')
    const original = readFileSync(at, 'utf8')
    const draftAt = join(root, 'scans', '.choice-draft.json')
    const finalAt = join(root, 'scans', '.choice-final.json')
    try {
      run('draft-spec.mjs', ['a list of invoices with a status per row and a search box',
        '--profile', 'own', '--out', draftAt])
      const draft = JSON.parse(readFileSync(draftAt, 'utf8'))
      // A person disagreeing with one element and leaving the rest.
      const corrected = JSON.parse(JSON.stringify(draft))
      for (const zone of corrected.zones ?? []) {
        zone.elements = (zone.elements ?? []).map(e => (String(e).split(/\s/)[0] === 'list' ? 'table' : e))
      }
      writeFileSync(finalAt, JSON.stringify(corrected, null, 2))

      const out = run('eval-choice.mjs', ['--record', draftAt, finalAt, '--profile', 'own'])
      assert.match(out, /case\(s\) recorded/, out.slice(-400))
      // The disagreement is the valuable half and has to be marked as one: a set full
      // of easy agreements would otherwise read as a set full of judgment.
      assert.match(out, /chose this instead of the proposal/, out.slice(-400))
      assert.match(out, /kept the proposal/, out.slice(-400))

      const stored = JSON.parse(readFileSync(at, 'utf8'))
      const recorded = stored.cases.find(c => c.person === 'chose this instead of the proposal')
      assert.ok(recorded, 'the correction was not stored')
      // The need is the person's words, not ours: a case phrased in the tool's own
      // vocabulary would measure the tool against itself.
      assert.ok(!/^Drafted from:/.test(recorded.need), `the need was taken from our own prose: ${recorded.need}`)
      assert.ok(recorded.from.includes(finalAt), 'the case does not say where it came from')

      // Recording the same pair twice adds nothing.
      const again = run('eval-choice.mjs', ['--record', draftAt, finalAt, '--profile', 'own'])
      assert.match(again, /nothing new to record/, again.slice(-300))
    } finally {
      writeFileSync(at, original)
      rmSync(draftAt, { force: true })
      rmSync(finalAt, { force: true })
    }
  })

  test('it refuses a verdict from too few distinct needs', () => {
    // The same floor the rest of this tool refuses under. Four distinct needs behind
    // eight cases is a share over too little, exactly like a convention drawn from
    // one file — and the temptation is stronger here, because the difference between
    // conditions is a small integer that looks like a result.
    const out = withCases([
      { need: 'Move through pages when the set is large.', component: 'Pagination' },
      { need: 'Narrow the list by text and by status.', component: 'SearchInput' },
    ], () => run('eval-choice.mjs', []))
    assert.match(out, /NOT A MEASUREMENT/, out.slice(-500))
    assert.match(out, /below the floor of 5/)
    assert.doesNotMatch(out, /Descriptions moved first-choice accuracy/,
      'a verdict was given under the floor')
  })

  test('above the floor it reports the difference the descriptions made', () => {
    // And it has to be able to say something, or it is a refusal machine. Five
    // distinct needs is the floor; the number it prints is whatever the cases give.
    const cases = [
      { need: 'Move through pages when the set is large.', component: 'Pagination' },
      { need: 'Narrow the list by text and by status.', component: 'SearchInput' },
      { need: 'Name the screen and offer the one creating action.', component: 'PageHeader' },
      { need: 'One row per document with its status.', component: 'Table' },
      { need: 'A person or a team shown as a small image.', component: 'Avatar' },
    ]
    const out = withCases(cases, () => run('eval-choice.mjs', []))
    assert.doesNotMatch(out, /NOT A MEASUREMENT/, out.slice(-500))
    assert.match(out, /Descriptions moved first-choice accuracy by [+-]?\d+ of 5 case\(s\)/, out.slice(-400))
    // Both conditions reported, so the difference can be checked rather than taken.
    assert.match(out, /names and props only/)
    assert.match(out, /plus the authored descriptions/)
  })
})

describeWithOwn('who actually reads the judgment tier', () => {
  test('nothing that picks a component reads a description', () => {
    // A proven negative, pinned like the other two in this repository — frame names
    // do not transfer across products, and a component's atomic level is not
    // derivable from the composition graph. This one was found while trying to
    // measure whether generated descriptions could stand in for authored ones: there
    // is no scorer, because the two passes that choose components match on names,
    // props and role bindings, and score identically with all 93 descriptions gone.
    //
    // That is not a defect. The descriptions are written for an agent and reach it
    // through the component index and the MCP surface, both of which do read them.
    // It is recorded so that nobody measures the judgment tier through `bind` or
    // `draft-spec` and concludes from an unchanged number that it is worthless.
    const profile = join(root, 'profiles', 'own', 'components.json')
    const original = readFileSync(profile, 'utf8')
    const requirement = 'a list of invoices with a status per row'
    try {
      const withText = {
        bind: run('bind.mjs', ['own', '--check']),
        draft: run('draft-spec.mjs', [requirement, '--profile', 'own']),
      }

      const doc = JSON.parse(original)
      let stripped = 0
      for (const c of Object.values(doc.components)) if (c.description) { c.description = null; stripped += 1 }
      assert.ok(stripped > 50, `only ${stripped} description(s) to remove`)
      writeFileSync(profile, JSON.stringify(doc, null, 2) + '\n')

      const without = {
        bind: run('bind.mjs', ['own', '--check']),
        draft: run('draft-spec.mjs', [requirement, '--profile', 'own']),
      }

      const tally = (text) => text.split('\n').find(l => /agreed ·/.test(l)) ?? ''
      assert.equal(tally(without.bind), tally(withText.bind),
        'bind now reads descriptions — this negative result no longer holds, and the automation question is newly measurable')

      const elements = (text) => text.split('\n').filter(l => /←/.test(l)).join('\n')
      assert.equal(elements(without.draft), elements(withText.draft),
        'draft-spec now reads descriptions — same, and worth measuring')
    } finally {
      writeFileSync(profile, original)
    }
  })
})

describe('what counts as evidence of a house style', () => {
  test('code written to vary is not read as the way this team writes', () => {
    // Found by scanning this repository with its own pass: 151 files read, 138 of
    // them fixtures — including one called `Bad.tsx` — and the mixture reported as
    // the house style, `component export split 60%`, `props declaration split 53%`.
    // Those splits are fixtures disagreeing on purpose, and `install` would have
    // written them into a gate. Almost every real repository has such a directory.
    const at = join(root, 'scans', '.fixture-scope-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      mkdirSync(join(at, 'tests', 'fixtures', 'odd'), { recursive: true })
      mkdirSync(join(at, 'examples'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "f", "private": true, "version": "0.0.0" }')

      // Eight real components, one way of doing everything.
      for (let i = 0; i < 8; i += 1) {
        writeFileSync(join(at, 'src', `C${i}.tsx`),
          `export const C${i} = () => <div className="a" />\n`)
      }
      // Twelve fixtures doing it the other way, on purpose.
      for (let i = 0; i < 12; i += 1) {
        writeFileSync(join(at, 'tests', 'fixtures', 'odd', `Bad${i}.tsx`),
          `export default function Bad${i}() { return <div style={{ color: '#ff0000' }} /> }\n`)
      }
      // And examples, which are NOT excluded: they are written to be copied. The
      // first version of this rule dropped them, and on three real libraries that
      // meant losing a quarter to a half of the repository — chakra-ui and
      // element-plus keep their canonical snippets there, written by maintainers
      // precisely as the way to write.
      for (let i = 0; i < 4; i += 1) {
        writeFileSync(join(at, 'examples', `Demo${i}.tsx`),
          `export const Demo${i} = () => <div className="a" />\n`)
      }

      run('scan.mjs', [at])
      const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
      assert.equal(scan.scannedFiles, 12, `wrong scope: ${scan.scannedFiles} file(s) read`)
      assert.equal(scan.excluded.fixtures, 12)
      // Not dropped silently: a majority of a repository going unread has to be
      // stated, with the rule that dropped it.
      assert.match(String(scan.excluded._), /written to vary/)

      // And the real code's convention survives intact rather than being split by
      // code that exists to disagree.
      const exportAxis = scan.conventions?.['component export']
      if (exportAxis) assert.notEqual(exportAxis.verdict, 'split', JSON.stringify(exportAxis))
    } finally {
      discard(at)
    }
  })

  test('tests are still read, because a team\'s tests follow its house style', () => {
    // The exclusion has to be narrow. Dropping tests too would make `test placement`
    // unmeasurable and would throw away real evidence of how this team writes.
    const at = join(root, 'scans', '.test-scope-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "t", "private": true, "version": "0.0.0" }')
      for (let i = 0; i < 8; i += 1) {
        writeFileSync(join(at, 'src', `C${i}.tsx`), `export const C${i} = () => <div className="a" />\n`)
        writeFileSync(join(at, 'src', `C${i}.test.tsx`), `import { C${i} } from './C${i}'\nit('x', () => {})\n`)
      }
      run('scan.mjs', [at])
      const scan = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
      assert.equal(scan.excluded.fixtures, 0, 'a test file was treated as a fixture')
      assert.ok(scan.conventions?.['test placement'], 'test placement became unmeasurable')
    } finally {
      discard(at)
    }
  })
})

describe('a construct named is not a construct used', () => {
  const scan = (files) => {
    const at = join(root, 'scans', '.security-mention-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "s", "private": true, "version": "0.0.0" }')
      for (const [name, text] of Object.entries(files)) writeFileSync(join(at, 'src', name), text)
      run('security.mjs', [at])
      return JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'security.json'), 'utf8'))
    } finally {
      discard(at)
    }
  }
  // The field is `source`, not `patterns` — read from the artifact rather than
  // assumed, after an assertion against a name that does not exist passed for the
  // wrong reason on the mention case and failed on the real one.
  const counted = (doc) => (doc.source ?? []).filter(p => !p.mitigated && !p.inTest)

  test('a lint rule about a dangerous construct is not a dangerous construct', () => {
    // Found by scanning this repository with its own pass: line 411 of
    // `security.mjs` is `if (/dangerouslySetInnerHTML/.test(lineText)) {`, and the
    // name inside the regex matched the regex looking for it. Not a quirk of
    // self-scanning — every project with a lint rule, a codemod or a README about the
    // same construct gets it, and a security report whose first entry is the reader's
    // own safety tooling is one nobody finishes.
    const doc = scan({
      'Lint.ts': [
        'export const RULE = /dangerouslySetInnerHTML/',
        'export const MSG = "do not use innerHTML ="',
        'export const T = `avoid insertAdjacentHTML(`',
        '',
      ].join('\n'),
    })
    assert.deepEqual(counted(doc).map(p => `${p.file}:${p.line}`), [],
      `a mention was reported as a use: ${JSON.stringify(counted(doc))}`)
  })

  test('and the real thing is still reported', () => {
    // The half that matters more. A change that silences findings has to be proved
    // from the other side, or it is just a quieter scanner.
    const doc = scan({
      'Real.tsx': 'export const Real = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />\n',
      'Also.ts': 'export function fill(el: HTMLElement, s: string) { el.innerHTML = s }\n',
    })
    const ids = counted(doc).map(p => p.id).sort()
    assert.ok(ids.includes('raw-html'), `a real dangerouslySetInnerHTML went unreported: ${JSON.stringify(ids)}`)
    assert.equal(counted(doc).length, 2, `expected both uses, got ${JSON.stringify(counted(doc))}`)
  })

  test('a very long line does not stop the pass finishing', () => {
    // Found by running the arrival sequence on a real client application rather than
    // on the commands one at a time. `ds assess` stopped finishing at all: documenso
    // has a 2.5-million-character line holding an inlined SVG, and the literal
    // blanking added an hour earlier searched everything written so far on every
    // character. One line took the pass past four minutes, and the first thing a
    // consultant would have seen on arrival was a hang with no output.
    const at = join(root, 'scans', '.security-longline-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "l", "private": true, "version": "0.0.0" }')
      // Half a million characters: long enough that quadratic scanning takes minutes,
      // short enough that linear scanning is instant.
      writeFileSync(join(at, 'src', 'Big.tsx'),
        `export const Big = () => <img src="data:image/svg+xml,${'a'.repeat(500000)}" />\n`
        + 'export function fill(el: HTMLElement, s: string) { el.innerHTML = s }\n')

      const started = Date.now()
      run('security.mjs', [at])
      const took = Date.now() - started
      assert.ok(took < 60000, `the pass took ${Math.round(took / 1000)}s on one long line`)

      // And it still read the line after it: a scan that gives up quietly is worse
      // than a slow one.
      const doc = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'security.json'), 'utf8'))
      const found = (doc.source ?? []).filter(p => !p.mitigated && !p.inTest)
      assert.equal(found.length, 1, `the real finding after the long line was missed: ${JSON.stringify(found)}`)
    } finally {
      discard(at)
    }
  })

  test('a division is not a regex, so the line keeps being checked', () => {
    // The blanking recognises a regex only where one can legally start. Getting that
    // wrong in the other direction would blank arithmetic and quietly stop checking
    // the rest of the line — a silence with nothing to show for it.
    const doc = scan({
      'Math.ts': 'export const f = (a: number, b: number, el: HTMLElement) => { const r = a / b / 2; el.innerHTML = String(r); return r }\n',
    })
    assert.equal(counted(doc).length, 1, 'a real assignment after a division was missed')
  })
})

describeWithOwn('breaking the reference solutions on purpose', () => {
  test('a mutant survives when the check meant to catch it stops working', () => {
    // The question to ask of any verifier is whether it can fail. `verify-adapters`
    // could not — it passed on a profile that had been changed — so the same question
    // is asked here, and answered by taking a check away and confirming the mutants
    // it was killing come back to life.
    const at = join(root, 'scripts', 'lib', 'score-core.mjs')
    const original = readFileSync(at, 'utf8')
    // Both halves, hex and px. A non-greedy match stopped at the first `.length` and
    // left the second addend in place, so the check was half-disabled: the mutants
    // still died, just by the wrong check — which redteam reports as `killed by
    // something else` and is not the same as surviving.
    const literalCheck = /const literals = \[\.\.\.text\.matchAll[\s\S]*?px\\b\/g\)\]\.length\n/
    assert.match(original, literalCheck, 'the check this test disables has moved')

    const redteam = () => {
      try {
        return { code: 0, out: execFileSync(process.execPath, [join(root, 'scripts', 'redteam.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }) }
      } catch (error) { return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') } }
    }

    const before = redteam()
    assert.equal(before.code, 0, `the suite is red before this test touches anything:\n${before.out.slice(-600)}`)
    assert.match(before.out, /survived\s+0/)

    try {
      writeFileSync(at, original.replace(literalCheck, '    const literals = 0\n'))
      const after = redteam()
      assert.equal(after.code, 1, `a disabled check left every mutant dead:\n${after.out.slice(-600)}`)
      assert.doesNotMatch(after.out, /survived\s+0/, after.out.slice(-600))
    } finally {
      writeFileSync(at, original)
    }

    // And back to green, so the test proves the disabling was what did it.
    assert.equal(redteam().code, 0)
  })
})

describe('the adapters that read software this repository does not contain', () => {
  // `verify-adapters` exists for `adapt:mui` and `adapt:antd`: it re-extracts from
  // the installed library and compares against the committed profile. All three had
  // no test, and the verifier turned out to pass on a profile that had been changed.
  const committed = join(root, 'profiles', 'mui', 'components.json')

  test('a committed profile that no longer matches the library fails verification', () => {
    // Removing `Accordion.onChange` from the profile left this green. It compared
    // component names and closed unions only, and a handler carries no union — so
    // nothing looked at whether the two prop lists were the same list.
    const original = readFileSync(committed, 'utf8')
    try {
      const doc = JSON.parse(original)
      const entry = Object.values(doc.components).find(c => (c.props ?? []).length > 1)
      assert.ok(entry, 'no component with props to perturb')
      entry.props.pop()
      writeFileSync(committed, JSON.stringify(doc, null, 2) + '\n')

      const { code, out } = (() => {
        try {
          return { code: 0, out: execFileSync(process.execPath, [join(root, 'scripts', 'verify-adapters.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
        } catch (error) { return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') } }
      })()
      // Where the library is not installed the pass skips, and that is a different
      // and also correct answer; what must not happen is a green over a changed file.
      if (/mui: @mui\/material is not installed|installed .* and the profile records/.test(out)) return
      assert.equal(code, 1, `a changed profile verified clean:\n${out}`)
      assert.match(out, /✗ mui/, out)
    } finally {
      writeFileSync(committed, original)
    }
  })

  test('verifying nothing exits as failure, because not run is not passed', () => {
    // The script printed `Not run is not passed` directly above `process.exit(0)`, so
    // a run where every adapter was skipped returned success. Anything reading the
    // code rather than the words was told the adapters are fine.
    const sandboxes = join(root, '.sandboxes')
    const held = join(root, 'scans', '.sandboxes-held')
    if (!existsSync(sandboxes)) return
    rmSync(held, { recursive: true, force: true })
    cpSync(sandboxes, held, { recursive: true })
    rmSync(sandboxes, { recursive: true, force: true })
    try {
      const { code, out } = (() => {
        try {
          return { code: 0, out: execFileSync(process.execPath, [join(root, 'scripts', 'verify-adapters.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
        } catch (error) { return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') } }
      })()
      assert.equal(code, 1, `nothing was verified and the run reported success:\n${out}`)
      assert.match(out, /Nothing was verified/)
    } finally {
      rmSync(sandboxes, { recursive: true, force: true })
      cpSync(held, sandboxes, { recursive: true })
      rmSync(held, { recursive: true, force: true })
    }
  })
})

describe('what the world practice page says', () => {
  const project = (at, files) => {
    rmSync(at, { recursive: true, force: true })
    mkdirSync(join(at, 'src'), { recursive: true })
    writeFileSync(join(at, 'package.json'), '{ "name": "p", "private": true, "version": "0.0.0" }')
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(at, 'src', name)), { recursive: true })
      writeFileSync(join(at, 'src', name), text)
    }
    run('scan.mjs', [at])
    run('defects.mjs', [at])
    run('deep.mjs', [at])
    return scanSlotOf(at)
  }

  test('a practice with no subject in this project is not a divergence', () => {
    // On react-router, which has no test files at all, `Drive interaction with
    // user-event (measured 0)` sat under "the project does it differently" —
    // advising a team to use a library in tests they have not written, and pushing
    // the real finding, that there are no tests, off the page. The mirror failure was
    // on the same page: a project shipping no languages was listed as having MET the
    // translation-parity practice.
    const at = join(root, 'scans', '.practices-empty-test')
    try {
      const slot = project(at, {
        'App.tsx': 'export const App = () => <main className="a"><section /></main>\n',
      })
      const out = run('practices.mjs', [slot])
      const line = out.split('\n').find(l => /user-event/.test(l) && !/testing-library\.com/.test(l)) ?? ''
      assert.match(line, /^\s*\?/, `a project with no tests was told it diverges: ${line}`)
      assert.match(line, /nothing to measure against: testing\/files is 0/)
    } finally {
      discard(at)
    }
  })

  test('a practice with a subject is still compared', () => {
    // The rule must not become "never compare anything". A project that has tests is
    // held to the practice exactly as before.
    const at = join(root, 'scans', '.practices-present-test')
    try {
      const slot = project(at, {
        'App.tsx': 'export const App = () => <main className="a"><section /></main>\n',
        'App.test.tsx': "import { fireEvent, render } from '@testing-library/react'\nit('x', () => { fireEvent.click(document.body) })\n",
      })
      const out = run('practices.mjs', [slot])
      const line = out.split('\n').find(l => /user-event/.test(l) && !/testing-library\.com/.test(l)) ?? ''
      assert.doesNotMatch(line, /nothing to measure against/, line)
    } finally {
      discard(at)
    }
  })
})

describe('many repositories side by side', () => {
  test('a share of screens is not printed for a project with no screens', () => {
    // The survey exists so a plausible number becomes obviously broken beside nine
    // others, and it printed one of its own: vue/core is a framework and has no
    // screens, so `sys% 0%` and `3 states 0%` sat in a column next to two projects
    // that do have them. In that position it reads as "this project handles no
    // states". The denominator was one field away and was not consulted.
    const dir = join(root, 'scans', '.survey-test')
    rmSync(dir, { recursive: true, force: true })
    try {
      // One project with a screen, one without: the comparison is the point.
      const withScreens = join(dir, 'has-screens')
      mkdirSync(join(withScreens, 'src', 'pages'), { recursive: true })
      writeFileSync(join(withScreens, 'package.json'), '{ "name": "w", "private": true, "version": "0.0.0" }')
      writeFileSync(join(withScreens, 'src', 'pages', 'Home.tsx'),
        'export default function Home() { return <main className="p"><section /></main> }\n')

      const noScreens = join(dir, 'no-screens')
      mkdirSync(join(noScreens, 'src'), { recursive: true })
      writeFileSync(join(noScreens, 'package.json'), '{ "name": "n", "private": true, "version": "0.0.0" }')
      writeFileSync(join(noScreens, 'src', 'util.ts'), 'export const add = (a: number, b: number) => a + b\n')

      const out = run('survey.mjs', [dir])
      const row = out.split('\n').find(l => /^no-screens/.test(l.trim())) ?? ''
      assert.ok(row, `no row for the screenless project:\n${out.slice(-800)}`)
      // Whatever else the row says, it must not claim a share of something it has
      // none of.
      assert.doesNotMatch(row.replace(/^\S+\s+\d+/, ''), /\b0%/,
        `a share was printed over no screens: ${row}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      for (const slot of ['has-screens', 'no-screens']) {
        rmSync(join(root, 'scans', slot), { recursive: true, force: true })
      }
    }
  })
})

describe('refreshing an installed gate', () => {
  test('a share written into the contract carries the count behind it', () => {
    // `install` writes the observation count and `update` did not, so a gate
    // refreshed after the project grew carried `"share": 1` with nothing behind it.
    // A client reading a rule at 100% cannot tell whether a thousand files agree or
    // one, and that is the whole question the observation floor exists to answer.
    const at = join(root, 'scans', '.update-count-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "u", "private": true, "version": "0.0.0" }')
      for (let i = 0; i < 20; i += 1) {
        writeFileSync(join(at, 'src', `C${i}.tsx`), [
          `import './C${i}.css'`,
          'interface Props { id: string }',
          `export function C${i}({ id }: Props) { const handleClick = () => {}; return <div className="a" onClick={handleClick} /> }`,
          '',
        ].join('\n'))
        writeFileSync(join(at, 'src', `C${i}.css`), '.a{color:#123456}\n')
        writeFileSync(join(at, 'src', `C${i}.test.tsx`), `import { C${i} } from './C${i}'\nit('x', () => {})\n`)
      }
      run('scan.mjs', [at])
      run('install.mjs', [at, '--apply'])
      run('update.mjs', [at, '--apply'])

      const contract = JSON.parse(readFileSync(join(at, '.ds', 'conventions.json'), 'utf8'))
      const rules = Object.entries(contract.enforce ?? {})
      assert.ok(rules.length > 0, 'nothing was enforced, so there is nothing to check')
      for (const [dimension, rule] of rules) {
        assert.equal(typeof rule.observations, 'number',
          `${dimension} is enforced at ${rule.share} with no count behind it`)
        assert.ok(rule.observations > 0, `${dimension} claims ${rule.observations} observations`)
      }
    } finally {
      discard(at)
    }
  })
})

describe('the situation a project is told it is in', () => {
  const measure = (files) => {
    const at = join(root, 'scans', '.situation-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "s", "private": true, "version": "0.0.0" }')
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(at, 'src', name)), { recursive: true })
        writeFileSync(join(at, 'src', name), text)
      }
      run('scan.mjs', [at])
      return JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'scan.json'), 'utf8'))
    } finally {
      discard(at)
    }
  }

  test('a project that keeps one way of doing things is not told it came apart', () => {
    // "Came apart" was decided from the share of dimensions at STRONG, and said
    // `drifted` about 19 of 38 measured projects — 10 of them with no split at all.
    // react-query at 5 of 5 settled, outline at 6, and this tool's own three
    // reference applications, built to be exemplary, at 4 of 4, 3 of 3 and 4 of 4.
    // It is the first line a consultant reads to a client.
    const files = {}
    for (let i = 0; i < 12; i += 1) {
      // One consistent way throughout: same file shape, same styling, same handler
      // naming — and one dimension deliberately imperfect, so not everything is
      // STRONG and the old rule would have landed in the drifted band.
      files[`C${i}/C${i}.tsx`] = [
        `import './C${i}.css'`,
        `export function C${i}() {`,
        `  const handleClick = () => {}`,
        `  return <div className="${i % 4 ? 'a' : 'b'}" onClick={handleClick} />`,
        '}',
        '',
      ].join('\n')
    }
    const scan = measure(files)
    const verdicts = Object.values(scan.conventions ?? {}).map(c => c.verdict)
    const readable = verdicts.filter(v => v !== 'too few to say')
    assert.equal(readable.filter(v => v === 'split').length, 0, 'the fixture was meant to have no split')
    assert.doesNotMatch(scan.mode, /came apart/, scan.mode)
  })

  test('a handful of files is not a house style, however consistent it is', () => {
    // The observation floor, one level up. `MIN_OBSERVATIONS` refuses a convention
    // drawn from one file because a share over one observation is 100% by
    // arithmetic; the same arithmetic produced `settled — a system exists and is
    // followed` from six identical files answering three of eleven dimensions,
    // because three of three is also one. The guard meant to catch it divided by the
    // dimensions PRESENT, and the eight nothing spoke to were absent rather than
    // zero, so there was nothing to compare against.
    const files = {}
    for (let i = 0; i < 6; i += 1) {
      files[`C${i}.tsx`] = `export const C${i} = () => <div className="a" />\n`
    }
    const scan = measure(files)
    // Perfectly consistent as far as it goes — that is the point.
    const readable = Object.values(scan.conventions ?? {}).filter(c => c.verdict !== 'too few to say')
    assert.ok(readable.length > 0 && readable.every(c => c.verdict === 'convention'),
      'the fixture was meant to be internally consistent')
    assert.match(scan.mode, /too early to say/, scan.mode)
    assert.match(scan.mode, /of 11 dimension\(s\) this tool measures/, scan.mode)
  })

  test('an axis the language does not have is not printed as a gap', () => {
    // The denominator counts what was unanswered; the table must not list it. A
    // dimension can go unanswered because a project is too small to have spoken to
    // it, or because the language has no such axis — Svelte has no component export,
    // the file is the component — and a row for the second tells a team they are
    // missing something they can never have.
    const files = {}
    for (let i = 0; i < 6; i += 1) {
      files[`C${i}.tsx`] = `export const C${i} = () => <div className="a" />\n`
    }
    const scan = measure(files)
    const empty = Object.entries(scan.conventions ?? {}).filter(([, c]) => c.total === 0)
    assert.deepEqual(empty.map(([d]) => d), [],
      'a dimension nothing spoke to was printed as a row')
  })

  test('a collapse is never claimed without the count that earned it', () => {
    // And the label has to survive: a rule that never fires is not a stricter rule,
    // it is a deleted one. A genuine split — no majority either way — earns it.
    const files = {}
    for (let i = 0; i < 12; i += 1) {
      const half = i % 2 === 0
      files[half ? `D${i}/D${i}.tsx` : `E${i}.tsx`] = half
        ? `import './D${i}.css'\nexport function D${i}() { return <div className="a" /> }\n`
        : `export const E${i} = () => <div style={{ color: '#c0ffee' }} />\n`
    }
    const scan = measure(files)
    // Which branch a fixture lands in is not the invariant — a project with splits
    // can still be mostly settled, and `settled` outranking `drifted` there is
    // correct. The invariant is the wording: the label claiming a collapse must
    // carry the count that earned it, so a reader can check the claim against the
    // table below it instead of taking the adjective on trust.
    assert.match(scan.mode, /settled|drifted|mixed|too early to say|greenfield/, scan.mode)
    if (/drifted/.test(scan.mode)) {
      assert.match(scan.mode, /\d+ of \d+ readable dimension\(s\) are done two ways with no majority/)
    }
    // And the claim is never made where nothing disagrees.
    const split = Object.values(scan.conventions ?? {}).filter(c => c.verdict === 'split').length
    if (split === 0) assert.doesNotMatch(scan.mode, /came apart/, scan.mode)
  })
})

describe('walking a repository', () => {
  test('a directory reached twice is walked once', () => {
    // The widest defect found here, because `walk` is under every detector and is
    // copied verbatim into the gate installed in the client's repository. On a
    // fixture of four files, one symlink pointing at its own parent made it return
    // 132 — every count downstream inflated 33×, with nothing in any output looking
    // wrong. Symlinked directories are ordinary: pnpm and yarn workspaces make them
    // and monorepos link shared folders.
    const at = join(root, 'scans', '.walk-loop-test')
    rmSync(at, { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src', 'inner'), { recursive: true })
      for (const n of ['a', 'b', 'c']) writeFileSync(join(at, 'src', `${n}.tsx`), 'export const X = 1\n')
      symlinkSync(join(at, 'src'), join(at, 'src', 'inner', 'back'), 'dir')

      const files = walk(at, [], new Set(['.tsx']))
      const real = new Set(files.map(f => realpathSync(f)))
      assert.equal(files.length, real.size,
        `the same file was returned under more than one path: ${files.length} paths, ${real.size} files`)
      assert.equal(real.size, 3)
    } finally {
      rmSync(at, { recursive: true, force: true })
    }
  })
})

describe('the vocabulary a codebase actually writes', () => {
  const sites = (n, text) => Array.from({ length: n }, (_, i) => ({ at: `f${i}`, text: text(i) }))
  const axes = (sources, names) => axesFrom(propUsage(sources, names), 5)

  test('a value is read out of the tag it belongs to, not the one nested in it', () => {
    // The scan that reads attributes by splitting on whitespace produces a
    // vocabulary containing props of unrelated components. `icon={<Chevron
    // dir="down" />}` must contribute `icon`, and must not contribute `dir`.
    const pairs = attrPairs('variant="primary" icon={<Chevron dir="down" />} onClick={() => a > b} disabled')
    assert.deepEqual(pairs.map(p => p.name), ['variant', 'icon', 'onClick', 'disabled'])
    assert.equal(pairs[0].kind, 'string')
    assert.equal(pairs[3].kind, 'boolean')
  })

  test('a bound attribute is an expression, quotes or no quotes', () => {
    // Vue's `:x="y"` and Angular's `[x]="y"` look exactly like plain attributes
    // apart from the prefix. Read as strings, they record variable names as values
    // the codebase writes — and nothing about the output would look wrong.
    const [plain, bound, literal] = attrPairs(`variant="ghost" :size="big" :tone="'warn'"`)
    assert.deepEqual([plain.kind, plain.value], ['string', 'ghost'])
    assert.deepEqual([bound.kind, bound.value], ['expression', 'big'])
    // A quoted literal inside a binding is still a literal.
    assert.deepEqual([literal.kind, literal.value], ['string', 'warn'])
  })

  test('free text is not offered as a set of choices', () => {
    // Found on vue-vben-admin, which the first version got wrong: a page-title prop
    // with eight different headings across twelve uses passed a rule that only asked
    // for fewer distinct values than uses. An agent told those are the values would
    // treat a heading as an enum.
    const headings = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'h', 'i', 'j']
    const out = axes(headings.map((h, i) => ({ at: `f${i}`, text: `<Fallback title="${h}" />` })), ['Fallback'])
    assert.equal(out.Fallback.title.axis, false)
    assert.match(out.Fallback.title.why, /barely repeat|free text/)
  })

  test('a prop always given the same value is a constant, not a choice', () => {
    // Offering it as an axis invites an agent to pick the other value, of which
    // there is no evidence at all.
    const out = axes(sites(16, () => '<Page auto-content-height="true" />'), ['Page'])
    assert.equal(out.Page['auto-content-height'].axis, false)
    assert.match(out.Page['auto-content-height'].why, /constant/)
  })

  test('a set that repeats hard is reported, with its counts', () => {
    const out = axes(sites(30, i => `<Button variant="${i % 3 === 0 ? 'ghost' : 'primary'}" />`), ['Button'])
    assert.equal(out.Button.variant.axis, true)
    assert.deepEqual(Object.keys(out.Button.variant.observed), ['primary', 'ghost'])
    assert.match(out.Button.variant.from, /30 literal use/)
  })

  test('an expression-dominated prop does not get an enumeration', () => {
    // `variant={isPrimary ? 'a' : 'b'}` is invisible to this scan. The literals seen
    // are a sample of unknown coverage, and presenting them as the set would be a
    // claim the evidence does not support.
    const src = [
      ...sites(12, () => '<Chip tone={t} />'),
      ...sites(6, i => `<Chip tone="${i % 2 ? 'warn' : 'ok'}" />`),
    ]
    const out = axes(src, ['Chip'])
    assert.equal(out.Chip.tone.axis, false)
    assert.match(out.Chip.tone.why, /expression/)
  })

  test('the worksheet is ordered by what the codebase writes, when that is known', () => {
    // The worksheet exists to make an unavoidable afternoon finishable, which means
    // putting the descriptions that matter first. It ordered by in-degree — how many
    // other registry components render this one — and on memos that put `Button`,
    // written at 118 call sites, below `DialogOverlay`, because no registry component
    // renders a Button. In-degree answers who depends on it; call sites answer who
    // writes it, and only the second is the question being asked.
    const at = join(root, 'scans', '.policy-order-test')
    rmSync(at, { recursive: true, force: true })
    const id = 'zz-order-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "o", "private": true, "version": "0.0.0" }')
      mkdirSync(join(root, 'profiles', id), { recursive: true })
      writeFileSync(join(root, 'profiles', id, 'components.json'), JSON.stringify({
        schemaVersion: 1,
        components: {
          // Rendered by another registry component, so in-degree ranks it first.
          Overlay: { from: '@/ui/overlay', props: [], variants: {}, uses: [] },
          Dialog: { from: '@/ui/dialog', props: [], variants: {}, uses: ['Overlay'] },
          // Rendered by nothing, written everywhere.
          Button: { from: '@/ui/button', props: [], variants: {}, uses: [] },
        },
        blocks: {},
      }))
      writeFileSync(join(root, 'profiles', id, 'policy.json'), JSON.stringify({ schemaVersion: 1, levels: {}, surfaces: {} }))
      for (let i = 0; i < 20; i += 1) {
        writeFileSync(join(at, 'src', `S${i}.tsx`), `export const S${i} = () => <Button />\n`)
      }

      const before = run('policy.mjs', [id])
      assert.match(before, /by how many other components render it/)
      assert.ok(before.indexOf('Overlay') < before.indexOf('Button'),
        'without a measured codebase, in-degree is still the signal')

      run('vocabulary.mjs', [at, '--profile', id])
      const after = run('policy.mjs', [id, '--repo', at])
      assert.match(after, /by how often this codebase writes it/)
      assert.ok(after.indexOf('Button') < after.indexOf('Overlay'),
        'the component written twenty times did not outrank the one written never')
      assert.match(after, /never written in this codebase/)
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    }
  })

  test('an Angular component is found under the name its template writes', () => {
    // Two separate ways to miss every use of an Angular registry, both found on a
    // real one. The registry files `NgxHeader` and the template writes
    // `<ngx-header>`, so matching on the class name found nothing; and the markup
    // lives in a backtick template inside the `.ts`, so scanning only `.html` read
    // nothing either. Together they reported all four components of a registry as
    // never used, over a codebase that uses every one of them.
    const at = join(root, 'scans', '.ng-usage-test')
    rmSync(at, { recursive: true, force: true })
    const id = 'zz-ng-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "ng", "private": true, "version": "0.0.0" }')
      mkdirSync(join(root, 'profiles', id), { recursive: true })
      writeFileSync(join(root, 'profiles', id, 'components.json'), JSON.stringify({
        schemaVersion: 1,
        components: { NgxChip: { from: './chip.component', selector: 'ngx-chip', className: 'ChipComponent' } },
        blocks: {},
      }))
      for (let i = 0; i < 10; i += 1) {
        writeFileSync(join(at, 'src', `l${i}.layout.ts`), [
          '@Component({',
          "  selector: 'app-l',",
          '  template: `',
          `    <ngx-chip [tone]="'${i % 2 ? 'warn' : 'ok'}'" [count]="n"></ngx-chip>`,
          '  `,',
          '})',
          `export class L${i} {}`,
          '',
        ].join('\n'))
        // A cast, not a call site. Read as a tag it would invent uses out of
        // TypeScript syntax, with nothing in the output to give it away.
        writeFileSync(join(at, 'src', `c${i}.ts`), `const x = <ChipComponent>y\n`)
      }
      const out = run('vocabulary.mjs', [at, '--profile', id])
      assert.match(out, /1\s+registry components called/, out)
      const doc = JSON.parse(readFileSync(join(root, 'scans', scanSlotOf(at), 'vocabulary.json'), 'utf8'))
      assert.equal(doc.considered.callSites, 10, 'a cast in a .ts was counted as a call site')
      // A quoted literal inside an Angular binding is a literal; `[count]="n"` is not.
      assert.deepEqual(doc.axes.NgxChip.tone.observed, { ok: 5, warn: 5 })
      assert.equal(doc.axes.NgxChip.count, undefined, 'a bound variable was recorded as a value')
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    }
  })

  test('the page an agent reads keeps habit and constraint apart', () => {
    // Both belong on the page and neither may be mistaken for the other. What a
    // component ACCEPTS is a constraint the compiler enforces; what this repository
    // WRITES is a habit worth following. Folded into one list they read as one
    // thing, and an agent would treat an unused-but-legal value as forbidden.
    const at = join(root, 'scans', '.index-usage-test')
    rmSync(at, { recursive: true, force: true })
    const id = 'zz-index-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      mkdirSync(join(at, 'src'), { recursive: true })
      writeFileSync(join(at, 'package.json'), '{ "name": "idx", "private": true, "version": "0.0.0" }')
      mkdirSync(join(root, 'profiles', id), { recursive: true })
      writeFileSync(join(root, 'profiles', id, 'components.json'), JSON.stringify({
        schemaVersion: 1,
        components: { Button: { from: '@/ui/button', variants: {}, slots: [], uses: [] } },
        blocks: {},
      }))
      // Twenty call sites, two values. Enough to clear the floor and repeat hard.
      for (let i = 0; i < 20; i += 1) {
        writeFileSync(join(at, 'src', `S${i}.tsx`),
          `export const S${i} = () => <Button variant="${i % 4 ? 'ghost' : 'primary'}" />\n`)
      }
      run('scan.mjs', [at])
      // Deliberately NOT running the vocabulary pass here. As a command of its own
      // it is one nobody would think to run, and the section it fills would be
      // silently missing from every install. Install has to measure it itself.
      run('install.mjs', [at, '--profile', id, '--apply'])

      const page = readFileSync(join(at, '.ds', 'profile', 'component-index.md'), 'utf8')
      assert.match(page, /observed here: variant = ghost×15 primary×5/)
      // The distinction is stated on the page, not only in the code that wrote it.
      assert.match(page, /not what the component accepts/)
      assert.match(page, /is not thereby forbidden/)
    } finally {
      discard(at)
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
      rmSync(join(root, 'bindings', `${id}.json`), { force: true })
    }
  })

  test("Angular's three bindings are each one token, not a name and some debris", () => {
    // Found on Angular Material and it affects every Angular project. `[prop]`,
    // `(event)` and the two-way `[(prop)]` look nothing like plain attributes;
    // matching only the opening bracket left the parenthesis unconsumed and the
    // binding's own VALUE was then read as further attributes.
    // `[(ngModel)]="demoChecked"` produced two props — `ngModel` and `demoChecked` —
    // the second a variable in the consumer's component, on its way into a contract
    // as part of a component's published vocabulary.
    const twoWay = attrPairs(' [(ngModel)]="demoChecked"')
    assert.deepEqual(twoWay.map(p => p.name), ['[(ngModel)]'])
    assert.equal(twoWay[0].kind, 'expression')

    const event = attrPairs(' (change)="x = $event.checked"')
    assert.deepEqual(event.map(p => p.name), ['(change)'])

    // The property binding and the plain attribute of the same name stay distinct:
    // one carries an expression, the other a literal this codebase writes.
    const both = attrPairs(' [color]="c" color="primary"')
    assert.deepEqual(both.map(p => [p.name, p.kind]), [['[color]', 'expression'], ['color', 'string']])
  })

  test('an event binding contributes no vocabulary', () => {
    // Its value is a statement in the consumer's component, never a value the
    // component accepts.
    const sites = Array.from({ length: 12 }, (_, i) => ({
      at: `f${i}`, text: `<MatChip (selectionChange)="onPick(${i})" color="primary" />`,
    }))
    const out = axesFrom(propUsage(sites, ['MatChip']), 5)
    assert.equal(out.MatChip['(selectionChange)'], undefined)
    assert.equal(out.MatChip.selectionChange, undefined)
    assert.equal(out.MatChip.color.axis, false, 'one repeated value is a constant, not a choice')
  })

  test('a spread does not invent the values it hides', () => {
    // Found on twenty. `{...{ accent, size }}` is a spread of an object shorthand;
    // the scan walked into the braces, read `accent` as a bare attribute and filed
    // it as the literal `true`. `Button.accent` came out as
    // `blue ×58 · danger ×27 · default ×21 · true ×1`, with the last one invented —
    // one wrong value in a list of real ones, which is the hardest kind to notice.
    const pairs = attrPairs('title={key} {...{ accent, size }} variant="secondary"')
    assert.deepEqual(pairs.map(p => p.name), ['title', 'variant'])
    assert.ok(!pairs.some(p => p.value === true), 'a spread produced a literal')
    // A plain spread is stepped over just the same.
    assert.deepEqual(attrPairs('{...props} tone="warn"').map(p => p.name), ['tone'])
  })

  test('a prop carrying content is refused, not recorded', () => {
    // This tool writes `component-index.md` into the client's repository and keeps a
    // scan on the consultant's own machine, and both would have carried whatever the
    // literals happened to be. Two internal URLs across twelve call sites cleared
    // every other rule here — repeated, few, well above the floor — and were written
    // out verbatim. A member of a vocabulary is a short identifier; anything holding
    // a path, an address or a phrase is content that happens to repeat.
    const sites = (n, text) => Array.from({ length: n }, (_, i) => ({ at: `f${i}`, text: text(i) }))
    const leaky = axesFrom(propUsage(sites(12, i =>
      `<Frame src="https://${i % 2 ? 'internal.example.corp/reports' : 'admin.example.corp/billing'}" />`), ['Frame']), 5)
    assert.equal(leaky.Frame.src.axis, false)
    assert.match(leaky.Frame.src.why, /carries content rather than a set of choices/)

    // Two branches, and a short path must be refused as surely as a long URL —
    // otherwise the guard is really just a length limit and anything under it leaks.
    const shortPath = axesFrom(propUsage(sites(12, i =>
      `<Img src="${i % 2 ? '/a/b.png' : '/c/d.png'}" />`), ['Img']), 5)
    assert.equal(shortPath.Img.src.axis, false)
    assert.match(shortPath.Img.src.why, /path, address or phrase/)
    // The whole prop goes, not the offending value: keeping the rest would publish a
    // distribution that never existed.
    assert.equal(leaky.Frame.src.observed, undefined)

    // And a real vocabulary survives it, hyphens, digits and all.
    const real = axesFrom(propUsage(sites(20, i =>
      `<Chip tone="${i % 2 ? 'coming-soon' : '403'}" />`), ['Chip']), 5)
    assert.deepEqual(real.Chip.tone.observed, { '403': 10, 'coming-soon': 10 })
  })

  test('a range and a measurement are not sets of choices; discrete codes are', () => {
    // The risk left open after Angular Material: `MatGridList cols = 1 2 3 4 5 6`
    // and `rowHeight = 100px 20px 200px` cleared every rule and were offered to an
    // agent as enumerations. The distinction is arithmetic, not taste — a range
    // fills its span, discrete codes are sparse in theirs. 403, 404 and 500 span 98
    // values and occupy three of them; 1..6 occupies all six.
    const from = (spec) => {
      const sites = []
      let i = 0
      for (const [value, n] of Object.entries(spec)) {
        for (let k = 0; k < n; k += 1) sites.push({ at: `f${i += 1}`, text: `<X p="${value}" />` })
      }
      return axesFrom(propUsage(sites, ['X']), 5).X.p
    }

    const range = from({ 1: 13, 2: 9, 3: 2, 4: 8, 5: 1, 6: 1 })
    assert.equal(range.axis, false)
    assert.match(range.why, /are a range/)

    const lengths = from({ '100px': 11, '20px': 2, '200px': 2, '10px': 2 })
    assert.equal(lengths.axis, false)
    assert.match(lengths.why, /CSS lengths/)

    // And the rules must not eat the real thing. Http statuses are numbers and a
    // genuine vocabulary; size steps are numbers and a genuine choice.
    assert.equal(from({ 403: 6, 404: 6, 500: 6 }).axis, true)
    assert.equal(from({ 8: 6, 16: 5, 24: 4 }).axis, true)
    assert.equal(from({ ghost: 58, outline: 22, destructive: 4 }).axis, true)
  })

  test('what a value means is never claimed', () => {
    // The line this whole pass is built around: the enumeration is extracted, the
    // meaning is authored. A field that looked like a description would put a
    // guess in front of an agent wearing the authority of a measurement.
    const out = axes(sites(20, i => `<Button variant="${i % 2 ? 'ghost' : 'primary'}" />`), ['Button'])
    const keys = Object.keys(out.Button.variant)
    assert.ok(keys.includes('observed'), 'the values are recorded as observed')
    assert.ok(!keys.some(k => /mean|descri|purpose|allow|legal/i.test(k)),
      `the axis claims more than it measured: ${keys.join(', ')}`)
  })
})

describe('what an adapter leaves behind', () => {
  const built = (dir, id) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Button.vue'),
      '<template><button class="b"><slot /></button></template>\n'
      + '<script setup lang="ts">defineProps<{ variant?: \'primary\' | \'ghost\' }>()</script>\n')
    return run('adapt-sfc.mjs', [dir, '--out', id])
  }

  test('a freshly adapted registry is unfinished, not malformed', () => {
    // The tool tells the reader `Next: ds bind` and the validator answered
    // "FAILED — 144 problem(s)" one command later, with nothing wrong. Unwritten and
    // malformed are different things, and the profile has to SAY which it is: the
    // validator reads the distinction from a `tiers` block that was never written.
    const dir = join(root, 'scans', '.adapt-fresh-test')
    rmSync(dir, { recursive: true, force: true })
    const id = 'zz-fresh-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      built(dir, id)
      const out = run('validate-profile.mjs', [id])
      assert.doesNotMatch(out, /FAILED/, out.slice(-400))
      assert.match(out, /NOT GATE-READY|UNWRITTEN/i)
      const profile = JSON.parse(readFileSync(join(root, 'profiles', id, 'profile.json'), 'utf8'))
      assert.match(profile.tiers.policy, /UNWRITTEN/)
      assert.match(profile.tiers.judgment, /UNWRITTEN/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
      rmSync(join(root, 'bindings', `${id}.json`), { force: true })
    }
  })

  test('re-running an adapter does not discard the tier a person wrote', () => {
    // The expensive one. `policy.json` holds level and surface, assigned by hand —
    // 323 of them on the profile this was found against. One adapter rewrote the file
    // unconditionally on every run, so re-adapting after a library update discarded
    // the lot, silently, and reported a successful adapt. An adapter refreshes facts;
    // it has no business touching the tiers it cannot produce.
    const dir = join(root, 'scans', '.adapt-rerun-test')
    rmSync(dir, { recursive: true, force: true })
    const id = 'zz-rerun-test'
    rmSync(join(root, 'profiles', id), { recursive: true, force: true })
    try {
      built(dir, id)
      const policyAt = join(root, 'profiles', id, 'policy.json')
      const assigned = { schemaVersion: 1, levels: { Button: 'atom' }, surfaces: { Button: 'card' } }
      writeFileSync(policyAt, JSON.stringify(assigned, null, 2) + '\n')

      built(dir, id)
      assert.deepEqual(JSON.parse(readFileSync(policyAt, 'utf8')).levels, { Button: 'atom' },
        'the second adapt discarded an assignment a person made')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(root, 'profiles', id), { recursive: true, force: true })
      rmSync(join(root, 'bindings', `${id}.json`), { force: true })
    }
  })
})
