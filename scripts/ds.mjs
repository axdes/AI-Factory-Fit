#!/usr/bin/env node
/**
 * One entry point for the whole pipeline.
 *
 * The individual scripts each answer one question and write one artifact. This
 * runs them in the order they depend on each other and prints the consolidated
 * result, because eleven commands with an implicit ordering is a tool only its
 * author can operate.
 *
 *   ds assess <repo> [--exclude a,b]    measure everything and report
 *   ds scan <repo>                      one stage: conventions and toolchain
 *   ds defects <repo>                   one stage: contrast, tokens, a11y, duplication
 *   ds deep <repo>                      one stage: API, screens, state, forms, i18n
 *   ds practices <project>              against the catalogue; measurement wins
 *   ds fit <project> --select a,b       which techniques apply HERE, and the cost
 *   ds layout <repo>                    page ground and reading column, vs its own majority
 *   ds install <repo> --profile <id>    build the gate from what was measured
 *   ds update <repo>                    rebuild it after the project moved
 *   ds score <repo> --profile <id>      what code scores against the rules
 *   ds measure <repo> [--baseline]      record or compare a baseline
 *   ds style <url>                      read a client's visual language
 *   ds style:image <shot.png>           the same, off a screenshot or brandbook page
 *   ds draft "<requirement>" --profile   a draft spec from a requirement
 *   ds spec <file> --profile a,b        check a screen spec against libraries
 *   ds build <spec> --repo <r>          generate a screen in the repo's idiom
 *   ds ai-audit <repo>                  what an agent here can read, and what stops it
 *   ds security <repo>                  dependencies, secrets and dangerous source patterns
 *   ds evidence <repo> [--since main]   the proof a reviewer reads instead of the diff
 *   ds provenance <repo>                where the code came from, and what wrote it
 *   ds request "<need>" --profile <id>  a component the library lacks, written down not built
 *   ds exemplars <repo> --profile <id>  what to copy here, and what never to copy
 *   ds report <project>                 the assessment as a document to send
 *   ds style:tokens <id> --compare <p>  the client's site against their code
 *   ds adapt:css <dir> --out <id>       a CSS framework into a profile
 *   ds adapt:react <dir> --out <id>     a client's own React components into a profile
 *   ds adapt:figma --from <json> --out  their Figma variables as a token layer
 *   ds adapt:mui --out <id>             Material UI into a profile
 *   ds adapt:antd --out <id>            Ant Design into a profile
 *   ds profile <id> | --all             validate one profile, or every one on disk
 *   ds probe:own                        rebuild profiles/own and prove it lost nothing
 *   ds verify:adapters                  do MUI and antd still reproduce their profiles
 *   ds eval                             the corpus: does the ruleset discriminate
 *   ds redteam                          mutate the references; a survivor is a hole
 *   ds survey <dir> --targets <tsv>     run the chain over many repositories at once
 *   ds regions <name>=<path> ...        which places frames offer, across many products
 *   ds bind <profile> --repo <path>     propose the role→component map a spec needs
 *   ds bind <profile> --check          the proposal against the one a person wrote
 *   ds name:tokens <profile> --out <d>  propose names for an extracted token layer
 *   ds policy <profile> --learn-from <p> the worksheet for the tier nobody can measure
 *   ds vocabulary <repo> --profile <id> which prop values this codebase actually writes
 *   ds audit:output [slot]              the tool's own results, read the way a sceptic reads them
 *   ds eval:choice [--profile <id>]     whether the registry lets the right component be chosen
 *   ds eval:choice --record <a> <b>    a corrected draft becomes a labelled case
 *   ds adapt:sfc <dir> --out <id>       a registry from .vue, .svelte or Angular components
 *   ds mcp --profile <id>               serve the registry to any agent, anywhere
 *   ds outcome <repo> --declare "<kpi>"  the client's number, its baseline, what moved
 *   ds room <dir> --rehearse            the scene: one command, outcome first
 *   ds test                             the tool's own regression suite
 */
import { counted, countedLine } from './lib/counted.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { scanSlot } from './lib/signals.mjs'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const [command, ...rest] = process.argv.slice(2)

const run = (script, args, { quiet = false } = {}) => {
  try {
    const out = execFileSync(process.execPath, [join(here, script), ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    if (!quiet) process.stdout.write(out)
    return { ok: true, out }
  } catch (error) {
    const out = (error.stdout ?? '') + (error.stderr ?? '')
    if (!quiet) process.stdout.write(out)
    return { ok: false, out }
  }
}

// The list ends where the comment ends, not at a line number somebody counted
// once. A hard-coded slice silently truncates the help every time a command is
// added, and a command absent from the help is a command that does not exist.
const usage = () => {
  const lines = readFileSync(join(here, 'ds.mjs'), 'utf8').split('\n')
  const end = lines.findIndex(l => l.trim() === '*/')
  console.log(lines.slice(1, end).map(l => l.replace(/^ \* ?/, '').replace(/^ \*$/, '')).join('\n'))
  // Asking for the help succeeded. Only an unknown command is a failure, and a
  // tool that exits non-zero on `--help` fails in whatever script wraps it.
  process.exit(command && command !== 'help' && command !== '--help' ? 1 : 0)
}

if (!command || command === 'help' || command === '--help') usage()

// ── assess: the whole measurement chain, one report ───────────────────────────

if (command === 'assess') {
  const target = rest[0]
  if (!target || !existsSync(target)) {
    console.error('ds assess <repo> [--exclude a,b]')
    process.exit(2)
  }
  const name = scanSlot(target)
  const passthrough = rest.slice(1)

  const stages = [
    ['scan.mjs', 'conventions, direction of travel, toolchain'],
    ['defects.mjs', 'contrast, dead tokens, accessibility, duplication'],
    ['deep.mjs', 'component API, screens, architecture, state, forms, i18n'],
    ['security.mjs', 'dependencies, secrets, dangerous patterns'],
    ['ai-audit.mjs', 'what an agent working here can read, and what stops it'],
  ]
  const afterInstall = [['exemplars.mjs', 'which files are worth copying, and which are not']]

  // The chain reading back what the chain just wrote. Every defect in this tool was
  // found by looking at a produced number and not believing it; this is that reading,
  // and running it anywhere but here would mean it never runs — the same mistake the
  // vocabulary pass made when it was a command of its own.
  const afterMeasuring = [['audit-output.mjs', 'the numbers just written, checked against the ways this tool has been wrong before']]

  // A stage that crashed leaves the previous run's artifact on disk, and reading
  // it prints last week's measurement as this week's. Once that happened here the
  // report looked complete and was stale, which is worse than an obvious gap.
  console.log(`\nassessing ${target}\n`)
  const failed = []
  for (const [script, what] of stages) {
    process.stdout.write(`  ${script.replace('.mjs', '').padEnd(9)} ${what} … `)
    const artifact = join(root, 'scans', name, script.replace('.mjs', '').replace('ai-audit', 'ai-audit') + '.json')
    const before = existsSync(artifact) ? statSync(artifact).mtimeMs : 0
    const result = run(script, [target, ...passthrough], { quiet: true })
    const after = existsSync(artifact) ? statSync(artifact).mtimeMs : 0
    const wrote = after > before

    if (result.ok && wrote) { console.log('done'); continue }
    console.log(result.ok ? 'PRODUCED NOTHING' : 'FAILED')
    failed.push({ script, stale: existsSync(artifact) })
    for (const line of result.out.split('\n').filter(Boolean).slice(0, 3)) console.log('    ' + line)
  }

  // Read back before anything is reported. It takes the slot, not the target: it
  // checks what was written, not what was measured.
  //
  // Its findings never fail the assessment. They are about how much a number can be
  // trusted, which is the reader's judgement to make — a pass that aborted the run
  // over a suspicious value would be making that judgement for them, and would be
  // switched off the first time it was wrong.
  const audit = run('audit-output.mjs', [name], { quiet: true })
  const flagged = audit.out.split('\n').filter(l => /finding\(s\)\./.test(l))[0]
  if (flagged) {
    console.log('')
    console.log(`  reading back what was just written: ${flagged.trim()}`)
    console.log('  node scripts/audit-output.mjs ' + name)
  }

  if (failed.length) {
    console.log('')
    console.log(`${failed.length} stage(s) did not produce a measurement.`)
    const stale = failed.filter(f => f.stale)
    if (stale.length) {
      console.log(`An older artifact is on disk for ${stale.map(f => f.script).join(', ')} and is NOT used below.`)
    }
    console.log('Fix the stage before reading anything from this report.')
    process.exit(1)
  }

  // Ranking needs the installed contract to score against; without it the step is
  // skipped rather than run on a guess.
  if (existsSync(join(target, '.ds', 'conventions.json'))) {
    for (const [script, what] of afterInstall) {
      process.stdout.write(`  ${script.replace('.mjs', '').padEnd(9)} ${what} … `)
      console.log(run(script, [target, ...passthrough], { quiet: true }).ok ? 'done' : 'skipped')
    }
  }

  const read = (file) => existsSync(join(root, 'scans', name, file))
    ? JSON.parse(readFileSync(join(root, 'scans', name, file), 'utf8'))
    : undefined
  const scan = read('scan.json')
  const defects = read('defects.json')
  const deep = read('deep.json')
  const ai = read('ai-audit.json')
  const security = read('security.json')

  if (!scan) { console.error('\nassess: the scan produced nothing; cannot report.'); process.exit(1) }

  const pct = (v) => v === undefined ? '—' : `${Math.round(v * 100)}%`
  const rule = (label) => console.log(`\n${label}\n${'─'.repeat(label.length)}`)

  rule('SITUATION')
  console.log(`  ${scan.mode}`)
  console.log(`  ${scan.scannedFiles} files measured, ${scan.toolchain.present.length} of ${scan.toolchain.present.length + scan.toolchain.missing.length} enforcement mechanisms present`)

  rule('HOW THIS REPOSITORY WRITES CODE')
  const mark = { convention: '✓', weak: '~', split: '✗', 'too few to say': '·' }
  for (const [dimension, c] of Object.entries(scan.conventions)) {
    console.log(`  ${mark[c.verdict]} ${dimension.padEnd(20)} ${c.dominant} ${pct(c.share)}`)
  }
  const splits = Object.entries(scan.conventions).filter(([, c]) => c.verdict === 'split')
  if (splits.length) {
    console.log(`\n  For the team to settle: ${splits.map(([d]) => d).join(', ')}`)
  }

  if (defects) {
    rule('DEFECTS, WITH A STANDARD BEHIND EACH')
    const d = defects.counts
    // Each count against what it was counted over. Without the denominator these
    // six lines print the same digit for "looked and found nothing" and "did not
    // look", and this summary is the one a client reads.
    const over = defects.considered ?? {}
    console.log(countedLine('contrast pairs below WCAG AA 4.5:1',
      counted(d.contrastFailures, over.contrastPairs, 'colour pairs',
        'no rule sets both a colour and a background, so no pair could be compared')))
    console.log(countedLine('accessibility findings (oxlint jsx-a11y)',
      counted(d.a11yFindings, over.files, 'files', 'the linter did not run — see defects.json')))
    console.log(countedLine('tokens declared and never referenced',
      counted(d.deadTokens, over.tokensDeclared, 'tokens', 'this project declares no design tokens')))
    console.log(countedLine('literal colour and size values outside token files',
      counted(d.hardcodedValues, over.styleableFiles, 'style-carrying files')))
    console.log(countedLine('modules built twice',
      counted(d.duplicatePairs, over.modules, 'modules')))
  }

  if (security) {
    const s2 = security.counts
    rule('SECURITY')
    console.log(s2.dependencyAdvisories === null
      ? `      —  dependency advisories — NOT RUN: ${security.dependencies.why}`
      : `  ${String(s2.dependencyAdvisories).padStart(5)}  dependency advisories, high and critical (${security.dependencies.manager} audit${security.dependencies.scopeIsWider ? `, covering ${security.dependencies.scope}` : ''})`)
    const read = security.considered?.files
    console.log(countedLine('secrets in the working tree', counted(s2.secrets, read, 'files')))
    console.log(countedLine('dangerous source patterns without their mitigation', counted(s2.sourceFindings, read, 'files')))
    console.log(security.history?.available
      ? countedLine('secrets in the git history', counted(security.history.total, 1, 'commits'))
      : `      —  secrets in the git history  — NOT RUN: ${security.history?.why ?? 'not read'}`)
    // The scope has to travel with the number. A security section a client reads
    // as "we were audited" is worse than none, and this is a floor over text.
    console.log(`         not covered: authorisation, CSRF/SSRF/traversal/SQL, infrastructure${security.history?.available ? '' : ', git history'}`)
  }

  if (deep) {
    rule('HOW IT IS BUILT')
    // The JSX-reading passes are withheld rather than zeroed where they could not
    // look. Against SvelteKit this block once printed "0 screens · states handled
    // loading 0% · error 0%" over a repository holding no React, which is not a
    // low score but a fabricated one.
    if (deep.composition && deep.componentApi) {
      console.log(`  component API        ${deep.componentApi.variantStrategy?.dominant ?? '—'} (${pct(deep.componentApi.variantStrategy?.share)}), median ${deep.componentApi.medianProps} props`)
      console.log(`  screens              ${deep.composition.screens}, ${pct(deep.composition.medianSystemShare)} of elements from the system`)
      console.log(`  states handled       loading ${pct(deep.composition.statesHandled.loading)} · error ${pct(deep.composition.statesHandled.error)} · empty ${pct(deep.composition.statesHandled.empty)}`)
    } else {
      console.log(`  component API        NOT APPLICABLE — these passes read JSX, and this is ${deep.framework?.name ?? 'not a React project'}`)
      console.log(`  screens              NOT APPLICABLE — ${deep.framework?.why ?? 'no JSX found'}`)
    }
    console.log(`  server state         ${deep.stateData.serverStateLibrary.join(', ') || 'none'}; ${deep.stateData.fetchInComponents.length} component(s) fetch directly`)
    console.log(`  forms                ${deep.forms.formsFound} found, ${deep.forms.handRolled.length} hand-rolled, ${deep.forms.guardsDoubleSubmit} guard double submit`)
    console.log(`  async                ${deep.resilience.unhandledAsync.length} of ${deep.resilience.asyncFiles} file(s) with nowhere to fail`)
    console.log(`  tests                ${pct(deep.testing.perSourceFile)} of source files, ${pct(deep.testing.queryDiscipline)} of queries accessible`)
  }

  if (ai) {
    rule('WHAT AN AGENT WORKING HERE CAN READ')
    console.log(`  contract reach       ${ai.contract.reach.length ? ai.contract.reach.join(', ') : 'nothing — every agent invents its own conventions'}`)
    console.log(`  largest contract     ${ai.counts.largestContractTokens} tokens, paid on every task by every agent`)
    console.log(`  stops an agent       ${[ai.enforcement.preToolUse && 'PreToolUse', ai.enforcement.postToolUse && 'PostToolUse', ai.enforcement.stop && 'Stop', ai.enforcement.gitHook && 'commit hook'].filter(Boolean).join(' · ') || 'nothing'}`)
    console.log(`  knowledge            ${ai.counts.skills} skill(s) · ${ai.counts.subagents} subagent(s) · ${ai.counts.mcpServers} MCP server(s)`)
    console.log(`  runs unattended      ${ai.headless ? 'yes' : 'no'}`)
    if (ai.delegation) {
      console.log(`  supports             ${ai.delegation.supported}`)
      const next = ai.delegation.levels.find(l => !l.met)
      if (next) console.log(`  next level           ${next.id} needs: ${next.missing.map(m => m.is).join('; ')}`)
    }
  }

  console.log('')
  run('practices.mjs', [name], { quiet: false })
  run('fit.mjs', [name], { quiet: false })

  console.log('\nNothing was written to the repository. `ds install` builds the gate from this.')
  process.exit(0)
}

// ── everything else forwards to the script that owns it ───────────────────────

const forward = {
  // Each stage runnable on its own. When one fails inside `assess` you get three
  // lines of its output, and the way to see the rest must not be knowing which
  // file it lives in.
  scan: 'scan.mjs',
  defects: 'defects.mjs',
  deep: 'deep.mjs',
  install: 'install.mjs',
  update: 'update.mjs',
  score: 'score.mjs',
  measure: 'measure.mjs',
  style: 'style-from-site.mjs',
  spec: 'validate-spec.mjs',
  build: 'build-screen.mjs',
  fit: 'fit.mjs',
  practices: 'practices.mjs',
  profile: 'validate-profile.mjs',
  'adapt:mui': 'adapt-mui.mjs',
  'adapt:css': 'adapt-css.mjs',
  'adapt:react': 'adapt-react.mjs',
  'adapt:figma': 'adapt-figma.mjs',
  'adapt:antd': 'adapt-antd.mjs',
  'style:tokens': 'style-to-tokens.mjs',
  'style:image': 'style-from-image.mjs',
  report: 'report.mjs',
  'ai-audit': 'ai-audit.mjs',
  security: 'security.mjs',
  evidence: 'evidence.mjs',
  provenance: 'provenance.mjs',
  request: 'request.mjs',
  layout: 'layout.mjs',
  outcome: 'outcome.mjs',
  room: 'room.mjs',
  exemplars: 'exemplars.mjs',
  draft: 'draft-spec.mjs',
  eval: 'eval.mjs',
  redteam: 'redteam.mjs',
  survey: 'survey.mjs',
  mcp: 'mcp.mjs',
  'probe:own': 'probe-own.mjs',
  'verify:adapters': 'verify-adapters.mjs',
  regions: 'regions.mjs',
  bind: 'bind.mjs',
  'name:tokens': 'name-tokens.mjs',
  policy: 'policy.mjs',
  vocabulary: 'vocabulary.mjs',
  'audit:output': 'audit-output.mjs',
  'eval:choice': 'eval-choice.mjs',
  'adapt:sfc': 'adapt-sfc.mjs',
}

if (command === 'test') {
  try {
    execFileSync(process.execPath, ['--test', join(root, 'tests', 'detectors.test.mjs')], { stdio: 'inherit' })
    process.exit(0)
  } catch { process.exit(1) }
}

if (!forward[command]) {
  console.error(`ds: unknown command "${command}"\n`)
  usage()
}

const result = run(forward[command], rest)
process.exit(result.ok ? 0 : 1)
