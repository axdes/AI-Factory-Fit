/**
 * Which components have behaviour, and which of those nobody tests.
 *
 * A component that renders is already covered by anything that renders it: for a
 * divider that is the whole truth about the component. But rendering cannot press
 * a key, and it cannot notice that a toggle stopped toggling — so for anything
 * holding state, answering a keyboard, running an effect or carrying an ARIA
 * state, a render test is a smoke test wearing a coverage badge.
 *
 * The number this produces is the point. Counting components without a test file
 * gives a figure nobody acts on, because most of them have nothing to test; the
 * reference implementation measured 47 that way and 16 the right way — a day of
 * work rather than a quarter of it. A backlog a team believes is what gets
 * cleared.
 *
 * The signals are deliberately crude, and the asymmetry is deliberate too: a
 * false positive costs one test nobody strictly needed, a false negative costs an
 * untested toggle. When in doubt this asks for the test.
 */

const SIGNALS = [
  [/\buseState\b|\buseReducer\b/, 'holds state'],
  [/onKeyDown|onKeyUp|onKeyPress|\bkey === ['"]|\be\.key\b/, 'has a keyboard contract'],
  [/\buseEffect\b|\buseLayoutEffect\b/, 'runs an effect'],
  [/aria-(expanded|selected|checked|current|invalid|pressed|sort|busy|disabled)=/, 'carries an ARIA state'],
  [/\bonChange\b|\bonToggle\b|\bonSelect\b|\bonOpenChange\b/, 'reports a change to its caller'],
  [/\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame/, 'does something on a timer'],
]

/**
 * @param {object} input
 * @param {{at: string, text: string}[]} input.sources  non-test source files
 * @param {{at: string, text: string}[]} input.tests  test files
 */
export function behaviourGaps({ sources, tests }) {
  // A test covers a component when its filename says so OR when it imports it.
  //
  // Filename alone was the first version, and it reported 99 of 100 components
  // untested in a repository holding 112 test files — because that project keeps
  // its tests in `tests/` under names of its own. A number like that is dismissed
  // rather than acted on, and rightly.
  // Mocking a component is the opposite of covering it. `vi.mock("@/components/AuthFooter")`
  // replaces the thing under discussion with a stub, and a test doing that is
  // evidence the component is NOT exercised there — so the mocked specifiers are
  // removed before anything else is read out of the file.
  const withoutMocks = (text) => (text ?? '')
    .replace(/\b(vi|jest)\.mock\s*\([\s\S]*?\)\s*;?/g, '')

  const covered = new Set()
  for (const t of tests) {
    const text = withoutMocks(t.text)
    covered.add(t.at.split('/').pop().replace(/\.(test|spec)\.[jt]sx?$/, ''))
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const stem = m[1].split('/').pop().replace(/\.[jt]sx?$/, '')
      if (stem && stem !== 'index') covered.add(stem)
      // `from '../components/Foo'` also names the file through its directory when
      // the module is a folder with an index.
      const parent = m[1].split('/').slice(-2)[0]
      if (m[1].endsWith('/index') && parent) covered.add(parent)
    }
    // Named imports too: a test importing { Badge } covers Badge even when the
    // module it came from is a barrel.
    for (const m of text.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const raw of m[1].split(',')) {
        const clean = raw.trim().split(/\s+as\s+/).pop()?.trim()
        if (clean && /^[A-Z]\w*$/.test(clean)) covered.add(clean)
      }
    }
  }
  const testNames = covered

  const withBehaviour = []
  const presentational = []

  for (const s of sources) {
    const name = s.at.split('/').pop().replace(/\.[jt]sx?$/, '')
    const reasons = SIGNALS.filter(([re]) => re.test(s.text)).map(([, why]) => why)
    const tested = testNames.has(name)
    if (!reasons.length) {
      presentational.push({ file: s.at, tested })
      continue
    }
    withBehaviour.push({ file: s.at, name, reasons, tested })
  }

  const untested = withBehaviour.filter(c => !c.tested)

  return {
    withBehaviour: withBehaviour.length,
    presentational: presentational.length,
    untested,
    // The number that is NOT the backlog, kept beside it so nobody quotes the
    // larger one. Most untested files have nothing to test.
    untestedOverall: withBehaviour.filter(c => !c.tested).length + presentational.filter(c => !c.tested).length,
    limits: 'Behaviour is inferred from the source: state, a keyboard handler, an effect, an ARIA state '
      + 'or a change callback. A component whose behaviour lives entirely in a hook it calls reads as '
      + 'presentational here. Coverage is matched by filename and by what each test imports, so a '
      + 'component exercised only through a parent it is rendered inside reads as untested. A '
      + 'component a test MOCKS is not covered by it — mocking is the opposite of exercising, and '
      + 'those specifiers are removed before coverage is read.',
  }
}
