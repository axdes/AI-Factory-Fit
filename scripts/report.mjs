/**
 * Turn a measurement into a document a client can read.
 *
 * Everything until now printed to a terminal, which means the assessment existed
 * only for whoever ran it. The findings that matter — a WCAG number, a rule the
 * team wrote and does not follow, a variant that exists in the API and does
 * nothing — have to survive being forwarded.
 *
 * Self-contained HTML: no fonts, scripts or images from anywhere else, so it
 * opens from a mail attachment on a locked-down laptop. Light and dark both
 * defined, because half the people who open it will be in one and half the other.
 *
 * Every number carries its source, and the limits of each detector are printed
 * rather than kept in a JSON file nobody opens. A report that hides what it could
 * not see is asking to be trusted about the rest.
 *
 *   node scripts/report.mjs <project> [--out <file.html>]
 */
import { counted } from './lib/counted.mjs'
import { staleness, movedSince } from './lib/taken.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const project = process.argv[2]
const outArg = process.argv.indexOf('--out')
const OUT = outArg === -1 ? join(root, 'scans', project ?? '_', 'report.html') : process.argv[outArg + 1]

if (!project || !existsSync(join(root, 'scans', project, 'scan.json'))) {
  console.error('usage: node scripts/report.mjs <project> [--out <file.html>]')
  console.error('Measure it first: node scripts/ds.mjs assess <repo>')
  process.exit(2)
}

const read = (file) => existsSync(join(root, 'scans', project, file))
  ? JSON.parse(readFileSync(join(root, 'scans', project, file), 'utf8'))
  : undefined

const scan = read('scan.json')
const defects = read('defects.json')
const deep = read('deep.json')
const plan = read('plan.json')

/**
 * A report is read as a statement about the project today. It is a statement about
 * what the scans on disk counted, whenever that was, under whatever rules were in
 * force then. Those two are the same thing only until a detector changes.
 *
 * They did diverge: a stored scan listed a root `app.vue` and two layouts as screens,
 * which today's rule correctly excludes. The file said nothing, so the old count read
 * as a present-day defect and was chased as one. A client reading the same page would
 * have had no way to tell at all.
 */
const stale = [
  ['conventions', scan, 'scan.mjs'],
  ['defects', defects, 'defects.mjs'],
  ['structure', deep, 'deep.mjs'],
].flatMap(([what, doc, writer]) => {
  if (!doc) return []
  // Two independent ways for the same number to stop being true, needing different
  // fixes: changed rules mean re-run the detector; changed code means the numbers
  // describe a version nobody is looking at any more. SARIF requires the second — an
  // analysis result must name the version of the code it was produced against — and
  // that was the half missing here.
  return [
    staleness(doc.taken, pathToFileURL(join(root, 'scripts', writer)).href),
    movedSince(doc.taken, doc.target ?? scan.target),
  ].filter(Boolean).map(said => ({ what, said }))
})

const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (v) => v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`

const verdictClass = { convention: 'ok', weak: 'warn', split: 'bad', 'too few to say': 'muted' }

const conventionRows = Object.entries(scan.conventions ?? {}).map(([dimension, c]) => `
  <tr>
    <td>${escape(dimension)}</td>
    <td><span class="dot ${verdictClass[c.verdict]}"></span>${escape(c.dominant)}</td>
    <td class="num">${pct(c.share)}</td>
    <td class="muted">${escape(Object.entries(c.distribution).slice(1).map(([k, v]) => `${k} ${v}`).join(' · ') || '—')}</td>
  </tr>`).join('')

// A zero is only good news if something was counted. This table coloured
// `0` green — `ok-text` — on sixteen of twenty-four recorded scans where the
// pass had compared no pairs at all, which is the one place a client actually
// looks. So the count comes through the same refusal as everywhere else, and an
// unmeasured row is muted and says why rather than being green.
const over = defects?.considered ?? {}
const defectRows = defects ? [
  ['Colour pairs below the contrast minimum', counted(defects.counts.contrastFailures, over.contrastPairs, 'colour pairs', 'no rule sets both a colour and a background, so no pair could be compared'), 'WCAG 2.2 §1.4.3', 'https://www.w3.org/TR/WCAG22/#contrast-minimum'],
  ['Accessibility findings', counted(defects.counts.a11yFindings, over.files, 'files', 'the linter did not run'), 'oxlint jsx-a11y', 'https://oxc.rs'],
  ['Tokens declared and never referenced', counted(defects.counts.deadTokens, over.tokensDeclared, 'tokens', 'this project declares no design tokens'), 'measured in this repository', ''],
  ['Literal colour and size values outside token files', counted(defects.counts.hardcodedValues, over.styleableFiles, 'style-carrying files'), 'measured in this repository', ''],
  ['Modules built twice', counted(defects.counts.duplicatePairs, over.modules, 'modules'), 'measured in this repository', ''],
].map(([label, c, source, url]) => `
  <tr>
    <td>${escape(label)}</td>
    <td class="num ${c.ran ? (c.count > 0 ? 'bad-text' : 'ok-text') : 'muted'}">${c.ran ? c.count : 'NOT RUN'}</td>
    <td class="muted">${c.ran
      ? `${url ? `<a href="${url}">${escape(source)}</a>` : escape(source)}, over ${c.considered} ${escape(c.unit)}`
      : escape(c.why)}</td>
  </tr>`).join('') : ''

// Every section of `deep.json` is optional, and two of them are routinely absent:
// a project with no components identified writes `componentApi: null` and
// `composition: null`. This table read straight through both and crashed the whole
// page — on a SvelteKit repository and a Vue one, the two ecosystems support was
// most recently added for and whose report nobody had opened.
//
// A section that is not there says so. `—` was the previous answer for a missing
// variant strategy and it reads as "none found", which is a different claim.
const row = (label, section, render) => {
  if (!section) return { label, value: 'NOT MEASURED', measured: false }
  try { return { label, value: String(render()), measured: true } }
  catch { return { label, value: 'NOT MEASURED', measured: false } }
}
const buildRows = deep ? [
  row('Component configuration', deep.componentApi, () => `${deep.componentApi.variantStrategy?.dominant ?? 'none found'} (${pct(deep.componentApi.variantStrategy?.share)})`),
  row('Screens', deep.composition, () => `${deep.composition.screens}, ${pct(deep.composition.medianSystemShare)} of elements from the system`),
  row('Screens handling loading, error and empty', deep.composition?.statesHandled, () => pct(deep.composition.statesHandled.allThree)),
  row('Server-state library', deep.stateData, () => deep.stateData.serverStateLibrary.join(', ') || 'none'),
  row('Components fetching directly', deep.stateData, () => deep.stateData.fetchInComponents.length),
  row('Forms guarding double submission', deep.forms, () => `${deep.forms.guardsDoubleSubmit} of ${deep.forms.formsFound}`),
  row('Async work with nowhere to fail', deep.resilience, () => `${deep.resilience.unhandledAsync.length} of ${deep.resilience.asyncFiles} file(s)`),
  row('Import cycles', deep.architecture, () => deep.architecture.cycleCount ?? 'not analysed'),
  row('Tests, as a share of source files', deep.testing, () => pct(deep.testing.perSourceFile)),
  row('Test queries that are accessible', deep.testing, () => pct(deep.testing.queryDiscipline)),
].map(({ label, value, measured }) =>
  `<tr><td>${escape(label)}</td><td class="num${measured ? '' : ' muted'}">${escape(value)}</td></tr>`).join('') : ''

const splits = Object.entries(scan.conventions ?? {}).filter(([, c]) => c.verdict === 'split')

const limits = [
  ...Object.values(defects?.limits ?? {}),
  ...Object.values(deep?.limits ?? {}),
].filter(l => typeof l === 'string')

const html = `<title>${escape(project)} — codebase assessment</title>
<style>
  :root {
    --bg: #ffffff; --fg: #16181d; --muted: #5b6270; --line: #e3e6ea;
    --ok: #1a7f4b; --warn: #a8730a; --bad: #b3261e; --accent: #0b5fa5;
    --card: #f7f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #16181d; --fg: #e8eaed; --muted: #9aa2b1; --line: #2b3038;
      --ok: #6ee7a8; --warn: #f2c14e; --bad: #f2857c; --accent: #7db8f0;
      --card: #1c1f26;
    }
  }
  :root[data-theme="dark"] {
    --bg: #16181d; --fg: #e8eaed; --muted: #9aa2b1; --line: #2b3038;
    --ok: #6ee7a8; --warn: #f2c14e; --bad: #f2857c; --accent: #7db8f0;
    --card: #1c1f26;
  }
  body {
    background: var(--bg); color: var(--fg); margin: 0 auto; padding: 3rem 1.5rem 6rem;
    max-width: 54rem; line-height: 1.55;
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 1.9rem; margin: 0 0 .25rem; letter-spacing: -0.02em; }
  h2 { font-size: 1.15rem; margin: 3rem 0 .75rem; letter-spacing: -0.01em; }
  h2:first-of-type { margin-top: 2rem; }
  p { margin: .5rem 0; }
  .lede { color: var(--muted); margin-bottom: 2rem; }
  .situation {
    background: var(--card); border-left: 3px solid var(--accent);
    padding: .9rem 1.1rem; border-radius: 0 6px 6px 0; margin: 1.5rem 0;
  }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .94rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: .8rem;
       text-transform: uppercase; letter-spacing: .04em; padding: .4rem .6rem .4rem 0; }
  td { padding: .45rem .6rem .45rem 0; border-top: 1px solid var(--line); vertical-align: baseline; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--muted); font-size: .88rem; }
  /* Loud on purpose. A quiet note about stale numbers is a note that gets skipped,
     and the numbers underneath it are the ones a client acts on. */
  .stale { border: 1px solid var(--bad); border-left-width: 4px; border-radius: 4px;
           padding: .9rem 1.1rem; margin: 1.25rem 0; background: color-mix(in srgb, var(--bad) 6%, transparent); }
  .stale ul { margin: .5rem 0 .4rem; padding-left: 1.1rem; }
  .ok-text { color: var(--ok); } .bad-text { color: var(--bad); }
  .dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%;
         margin-right: .5rem; vertical-align: middle; }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--bad); }
  a { color: var(--accent); }
  ul { padding-left: 1.1rem; } li { margin: .3rem 0; }
  .limits { font-size: .88rem; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           color: var(--muted); font-size: .85rem; }
</style>

<h1>${escape(project)}</h1>
<p class="lede">Codebase assessment · ${scan.scannedFiles} files measured · ${scan.taken?.on ?? 'date not recorded'}</p>

<div class="situation"><strong>Situation.</strong> ${escape(scan.mode)}</div>
${stale.length ? `
<div class="stale"><strong>Read this first.</strong> This page renders scans that are
already on disk; it does not re-measure. For ${stale.length === 1 ? 'one section' : `${stale.length} sections`}
the stored numbers were not counted by the rules in force today:
<ul>${stale.map(x => `<li><strong>${escape(x.what)}</strong> — ${escape(x.said)}</li>`).join('')}</ul>
Re-run the assessment before this page is shown to anyone.</div>` : ''}

<p>Nothing in this report is an imported rule. The conventions below were measured
in this repository's own code; the defects each carry the standard they are
measured against. Where a detector could not see something, it says so at the end
rather than reporting a zero.</p>

<h2>How this repository writes code</h2>
<div class="table-wrap"><table>
  <tr><th>Dimension</th><th>Dominant</th><th>Share</th><th>Other</th></tr>
  ${conventionRows}
</table></div>
${splits.length ? `<p><strong>For the team to settle:</strong> ${splits.map(([d]) => escape(d)).join(', ')}.
Two ways of doing the same thing in comparable amounts is not a defect — it is a
decision nobody has made yet, and it is not ours to make.</p>` : ''}

${defects ? `<h2>Defects, each with a standard behind it</h2>
<div class="table-wrap"><table>
  <tr><th>Finding</th><th>Count</th><th>Measured against</th></tr>
  ${defectRows}
</table></div>` : ''}

${deep ? `<h2>How it is built</h2>
<div class="table-wrap"><table>${buildRows}</table></div>` : ''}

${plan ? `<h2>What was agreed</h2>
<p>Decided ${escape(plan.decidedOn)}.</p>
<ul>
  ${plan.selected.map(id => `<li>${escape(id)}</li>`).join('')}
</ul>
${plan.rejected.length ? `<p class="muted">Declined: ${plan.rejected.map(r => `${escape(r.id)} — ${escape(r.reason)}`).join('; ')}</p>` : ''}` : ''}

<h2>What this could not see</h2>
<ul class="limits">
  ${limits.map(l => `<li>${escape(l)}</li>`).join('')}
</ul>

<footer>
  Generated by AI FactoryFit from the artifacts of a read-only measurement. No file in
  the assessed repository was modified to produce it.
</footer>
`

writeFileSync(OUT, html)
console.log(`\nreport: ${OUT}`)
console.log(`  ${Object.keys(scan.conventions ?? {}).length} convention(s), ${defects ? Object.keys(defects.counts).length : 0} defect measure(s), ${limits.length} stated limit(s)`)
console.log('  self-contained: no external fonts, scripts or images')
