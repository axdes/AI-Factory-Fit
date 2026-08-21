/**
 * The ledger as one page, for the person who was not in the room.
 *
 * A number agreed in a meeting and repeated from memory is a number that gets
 * disputed. This is the page the CFO forwards: the baseline with whose report it
 * came from, what the run actually did, the arithmetic in full, and — given equal
 * weight rather than a footnote — everything the figure leaves out.
 *
 * The exclusions are the reason this exists. Any consultancy can send a number.
 * The one that sends a number together with the conditions under which it is
 * wrong is the one that can be paid on it, because a contract needs both sides to
 * know what they are arguing about before there is anything to argue about. That
 * argument is built into the layout: the exclusions carry the same frame and the
 * same type as the movement, so the page reads as one claim and its conditions
 * rather than a figure with small print underneath it.
 *
 * Two constraints come from where this file ends up. It is written into a client
 * repository and opened from an attachment on a laptop that is not allowed to
 * fetch anything, so nothing here reaches the network — no font, script or image,
 * and no webfont inlined either, because a page that ships into somebody's repo
 * should not carry a megabyte of typeface. And it is read in whichever theme the
 * reader keeps, so both are defined at token level.
 */

const escape = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const n = (v) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })
const money = (v, ccy) => `${n(v)}${ccy ? ' ' + ccy : ''}`

// The KPI is the name of the number, so it is the name of the page. Whatever
// follows the first comma is the qualifier, and that belongs in the body.
const pageName = (kpi) => {
  const head = String(kpi).split(',')[0].trim()
  return head.charAt(0).toUpperCase() + head.slice(1)
}

export function outcomePage(ledger) {
  const run = ledger.runs?.at(-1)
  const ccy = ledger.currency ?? ''
  const unit = ledger.unit
  const seen = run ? run.handled + run.escalated : 0
  const rehearsal = /REHEARSAL|STAND-IN/i.test(JSON.stringify(ledger))

  const computed = run && typeof run.costPerUnit === 'number'
  const blended = computed ? (run.handled * run.costPerUnit + run.escalated * ledger.baseline.value) / seen : undefined
  const perUnit = computed ? ledger.baseline.value - blended : undefined
  const total = computed ? perUnit * ledger.baseline.volume : undefined
  const sign = (v) => (v >= 0 ? '−' : '+')

  return `<title>${escape(pageName(ledger.kpi))}</title>
<style>
  /* Neutrals carry a faint blue-green cast — the tint of safety paper — so the
     ground reads as chosen rather than inherited. The accent is accounting ink,
     spent only on the two figures that are the point. Refusals get a colour of
     their own: what the page declines to say must not look like what it says. */
  :root {
    --paper:     #fbfcfc;
    --raise:     #f3f6f5;
    --ink:       #14181a;
    --muted:     #5a666b;
    --rule:      #dde4e3;
    --edge:      #c9d4d2;
    --ledger:    #0b5a52;
    --caution:   #8a5a00;
    --cautionbg: #fdf6e7;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:     #0e1315;
      --raise:     #161d1f;
      --ink:       #e6ebea;
      --muted:     #93a3a4;
      --rule:      #263133;
      --edge:      #33413f;
      --ledger:    #5fd3bf;
      --caution:   #e0ad4e;
      --cautionbg: #221a09;
    }
  }
  :root[data-theme="dark"] {
    --paper:     #0e1315;
    --raise:     #161d1f;
    --ink:       #e6ebea;
    --muted:     #93a3a4;
    --rule:      #263133;
    --edge:      #33413f;
    --ledger:    #5fd3bf;
    --caution:   #e0ad4e;
    --cautionbg: #221a09;
  }

  /* Three roles, no webfont. A statement of account is set with serifs, and the
     serif is what keeps the money distinct from the prose about the money. */
  :root {
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body {
    background: var(--paper);
    color: var(--ink);
    font: 400 16px/1.6 var(--sans);
    margin: 0 auto;
    max-width: 44rem;
    padding: 4rem 1.5rem 6rem;
    -webkit-text-size-adjust: 100%;
  }

  .masthead { display: flex; flex-direction: column; gap: .4rem; }
  h1 {
    font: 400 2.1rem/1.15 var(--serif);
    letter-spacing: -0.015em;
    margin: 0;
    text-wrap: balance;
  }
  .scope { color: var(--muted); font-size: .95rem; margin: 0; }

  /* Ledger rule: the section label sits on a hairline that runs the full column,
     which is how a statement of account separates its parts. No numbering — these
     are one argument, not a sequence of steps a reader works through. */
  section { margin-top: 3.25rem; }
  h2 {
    border-bottom: 1px solid var(--rule);
    color: var(--muted);
    font: 600 .72rem/1 var(--sans);
    letter-spacing: .1em;
    margin: 0 0 1.2rem;
    padding-bottom: .55rem;
    text-transform: uppercase;
  }

  .figure {
    color: var(--ledger);
    font: 400 3.1rem/1 var(--serif);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .figure.secondary { font-size: 1.9rem; margin-top: 1.1rem; }
  .qualifier {
    color: var(--muted);
    font: 400 .95rem/1.4 var(--sans);
    margin: .35rem 0 0;
  }
  .note { color: var(--muted); font-size: .9rem; margin: 1.2rem 0 0; }
  .note strong { color: var(--ink); font-weight: 600; }

  table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
  th, td { border-bottom: 1px solid var(--rule); padding: .55rem 0; text-align: left; }
  tr:first-child th, tr:first-child td { border-top: 1px solid var(--rule); }
  th { font-weight: 400; }
  td.n { text-align: right; white-space: nowrap; }
  td.share { color: var(--muted); padding-left: 1.25rem; width: 4.75rem; }

  /* The claim and its conditions get the same frame and the same type. Anything
     less makes the exclusions small print, and small print is what a client finds
     out afterwards rather than agrees to in advance. */
  .panel {
    background: var(--raise);
    border: 1px solid var(--edge);
    border-radius: 3px;
    padding: 1.5rem 1.6rem 1.6rem;
  }
  .panel h2 { border-bottom-color: var(--edge); }

  .working {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 3px;
    font: 400 .84rem/1.8 var(--mono);
    font-variant-numeric: tabular-nums;
    margin: 1.4rem 0 0;
    overflow-x: auto;
    padding: .9rem 1rem;
    white-space: pre;
  }

  ul { display: flex; flex-direction: column; gap: .9rem; margin: 0; padding-left: 1.15rem; }
  li::marker { color: var(--muted); }
  li strong { font-weight: 600; }

  /* A refusal must never be mistaken for a result. */
  .refused {
    border-left: 3px solid var(--caution);
    color: var(--muted);
    margin: 0;
    padding-left: 1rem;
  }
  .flag {
    background: var(--cautionbg);
    border: 1px solid var(--caution);
    border-radius: 3px;
    color: var(--caution);
    font-size: .9rem;
    margin: 2.25rem 0 0;
    padding: .9rem 1rem;
  }
  .flag strong { font-weight: 600; }

  footer {
    border-top: 1px solid var(--rule);
    color: var(--muted);
    font-size: .88rem;
    margin-top: 4rem;
    padding-top: 1.2rem;
  }
  code { font: 400 .9em var(--mono); }
</style>

<header class="masthead">
  <h1>${escape(pageName(ledger.kpi))}</h1>
  <p class="scope">${escape(ledger.kpi)} · ${escape(n(ledger.baseline.volume))} ${escape(unit)}s ${escape(ledger.baseline.window)}</p>
</header>
${rehearsal ? `<p class="flag"><strong>Rehearsal.</strong> Every figure below came from a stand-in set.
None of it is any client's data, and nobody supplied the baseline — in a real run the first two
numbers are given by the client, and this page names the report they came from.</p>` : ''}

<section>
  <h2>What one costs today</h2>
  <p class="figure">${escape(money(ledger.baseline.value, ccy))}</p>
  <p class="qualifier">per ${escape(unit)}, before any of this</p>
  <p class="note">From <strong>${escape(ledger.baseline.source)}</strong>. Nothing here estimates a
  baseline: a business case is usually wrong at the baseline, and usually wrong in the direction that
  flatters whoever wrote it.</p>
</section>

<section>
  <h2>What the run did</h2>
${run ? `  <table>
    <tr><th>Handled by the agent</th><td class="n">${escape(n(run.handled))}</td><td class="n share">${Math.round((run.handled / seen) * 100)}%</td></tr>
    <tr><th>Handed back to a person</th><td class="n">${escape(n(run.escalated))}</td><td class="n share">${Math.round((run.escalated / seen) * 100)}%</td></tr>
    <tr><th>Wrong, of those handled</th><td class="n">${escape(n(run.wrong))}</td><td class="n share">${((run.wrong / run.handled) * 100).toFixed(1)}%</td></tr>
  </table>
  <p class="note">${escape(run.window ?? 'window not stated')}. Handed-back work is charged below at
  the human rate: an agent that returns a fifth of the work has not saved the cost of that fifth, and
  a model that forgets this overstates by roughly double.</p>` :
`  <p class="refused">No run recorded, so nothing has moved. A figure here would be a forecast wearing
  a measurement's clothes.</p>`}
</section>

${computed ? `<section class="panel">
  <h2>What moved</h2>
  <p class="figure">${sign(perUnit)}${escape(money(Math.abs(perUnit), ccy))}</p>
  <p class="qualifier">per ${escape(unit)}</p>
  <p class="figure secondary">${sign(total)}${escape(money(Math.abs(total), ccy))}</p>
  <p class="qualifier">across ${escape(n(ledger.baseline.volume))} ${escape(unit)}s ${escape(ledger.baseline.window)}</p>
  <div class="working">blended  = (${run.handled} × ${run.costPerUnit} + ${run.escalated} × ${ledger.baseline.value}) ÷ ${seen}
         = ${blended.toFixed(2)} ${escape(ccy)} per ${escape(unit)}
moved    = ${ledger.baseline.value} − ${blended.toFixed(2)}
         = ${perUnit.toFixed(2)} ${escape(ccy)} per ${escape(unit)}</div>
  <p class="note">Agent cost ${escape(money(run.costPerUnit, ccy))} per handled ${escape(unit)}, from
  <strong>${escape(run.costSource ?? 'no source stated')}</strong>. The arithmetic is printed because a
  model whose working is hidden is one a finance function discounts to zero.</p>
</section>

<section class="panel">
  <h2>What this figure does not include</h2>
  <ul>
    <li><strong>The ${escape(n(run.wrong))} wrong ${run.wrong === 1 ? 'answer' : 'answers'}.</strong>
    What one costs is a number you have and we do not. At a high enough cost per wrong
    ${escape(unit)} it reverses this case entirely, which is why it is here and not in a footnote.</li>
    <li><strong>Building and running the thing.</strong> This is the operating difference between a
    person and an agent doing the work. It is not the return on the investment that produced the
    agent.</li>
    <li><strong>Whether ${escape(n(seen))} ${escape(unit)}s represent the rest.</strong> A run on the
    easy ones moves a number that a full population will not.</li>
    ${run.costSource ? '' : `<li><strong>A source for the agent cost.</strong> It carries none, so it
    is an estimate, and every figure above inherits that.</li>`}
  </ul>
</section>` : run ? `<section>
  <h2>What moved</h2>
  <p class="refused">Not computed. The run measured what the agent did; what it costs per
  ${escape(unit)} did not come with it, and this will not estimate it — the difference between
  ${escape(money(ledger.baseline.value, ccy))} and a guess is the entire number.</p>
</section>` : ''}

<footer>
Generated from the ledger at <code>.ds/outcome.json</code>. Every number on this page came from the
client or from a measured run. None was estimated here, and where an input was missing the figure was
refused rather than filled in.
</footer>
`
}
