/**
 * Run the measurement chain over many repositories and put the results side by
 * side.
 *
 * One project tells you whether the tool runs. Ten tell you where it is wrong,
 * because a number that is plausible alone becomes obviously broken next to nine
 * others — a screen count of zero reads as a finding until the column beside it
 * shows the same detector finding a hundred and thirty-five.
 *
 * Failures are first-class here. A repository the tool cannot read is a result,
 * and printing it beside the ones it can is the only way to see the boundary of
 * where this works at all.
 *
 * Most real repositories are monorepos, so the thing to measure is rarely the
 * directory git created. Targets are given explicitly, one line per project:
 *
 *   name<TAB>relative/path/to/the/app
 *
 *   node scripts/survey.mjs <dir-of-clones> [--targets targets.tsv]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { scanSlot } from './lib/signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const dir = process.argv[2]
if (!dir || !existsSync(dir)) {
  console.error('usage: node scripts/survey.mjs <dir-of-clones> [--targets file.tsv]')
  process.exit(2)
}

const targetsFlag = process.argv.indexOf('--targets')
const declared = targetsFlag === -1 ? undefined : readFileSync(process.argv[targetsFlag + 1], 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => { const [name, sub] = l.split(/\t+|\s{2,}/); return { name, sub: sub ?? '.' } })

const projects = declared ?? readdirSync(dir)
  .filter(name => !name.startsWith('.'))
  .filter(name => { try { return statSync(join(dir, name)).isDirectory() } catch { return false } })
  .map(name => ({ name, sub: '.' }))

const stage = (script, target) => {
  try {
    execFileSync(process.execPath, [join(here, script), target], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, why: String(error.stderr ?? error.message).split('\n').find(Boolean)?.slice(0, 80) }
  }
}

const readScan = (name, file) => {
  const path = join(root, 'scans', name, file)
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

const rows = []
for (const { name, sub } of projects) {
  const target = join(dir, name, sub)
  process.stdout.write(`  ${name.padEnd(18)} `)
  if (!existsSync(target)) { console.log('NOT CLONED'); continue }

  // Where each stage writes. Derived the same way the stages derive it, because
  // reading the wrong folder is how a previous run's numbers get reported as this
  // one's — and the leaf name is not enough: memos/web and formbricks/apps/web
  // are both "web".
  const slot = scanSlot(target)

  const results = {}
  for (const [script, file] of [['scan.mjs', 'scan.json'], ['defects.mjs', 'defects.json'], ['deep.mjs', 'deep.json'], ['security.mjs', 'security.json'], ['ai-audit.mjs', 'ai-audit.json']]) {
    const at = join(root, 'scans', slot, file)
    const before = existsSync(at) ? statSync(at).mtimeMs : 0
    const r = stage(script, target)
    const after = existsSync(at) ? statSync(at).mtimeMs : 0
    results[script] = r.ok && after > before ? 'ok' : (r.why ?? 'ran but wrote nothing')
    process.stdout.write(results[script] === 'ok' ? '·' : 'x')
  }

  // A stage that failed contributes nothing. Reading its artifact anyway is
  // exactly the bug that made a crashed scan print the previous run's numbers
  // under the word "done".
  const fresh = (script, file) => results[script] === 'ok' ? readScan(slot, file) : undefined
  const scan = fresh('scan.mjs', 'scan.json')
  const defects = fresh('defects.mjs', 'defects.json')
  const deep = fresh('deep.mjs', 'deep.json')
  const ai = fresh('ai-audit.mjs', 'ai-audit.json')
  const security = fresh('security.mjs', 'security.json')

  rows.push({
    name,
    stages: results,
    files: scan?.scannedFiles,
    mode: scan?.mode?.split(' —')[0],
    styling: scan?.conventions?.styling?.dominant,
    stylingShare: scan?.conventions?.styling?.share,
    toolchain: scan ? `${scan.toolchain.present.length}/${scan.toolchain.present.length + scan.toolchain.missing.length}` : undefined,
    framework: deep?.framework?.name,
    screens: deep?.composition?.screens,
    // Both of these are shares OF SCREENS, so with no screens they are shares of
    // nothing. On vue/core — a framework, which has none — the table printed
    // `sys% 0%` and `3 states 0%`, and in a column beside two projects that do have
    // screens that reads as "this project handles no states". The denominator is one
    // field away and was not consulted.
    systemShare: deep?.composition?.screens ? deep.composition.medianSystemShare : undefined,
    allThree: deep?.composition?.screens ? deep.composition.statesHandled?.allThree : undefined,
    cycles: deep?.architecture?.modulesInCycles,
    a11y: defects?.counts?.a11yFindings,
    hardcoded: defects?.counts?.hardcodedValues,
    dupes: defects?.counts?.duplicatePairs,
    contractReach: ai?.counts?.contractReach,
    delegation: ai?.delegation?.supported,
    advisories: security?.counts?.dependencyAdvisories,
    advisoryScope: security?.dependencies?.scopeIsWider ? security.dependencies.scope : undefined,
    secrets: security?.counts?.secrets,
    dangerous: security?.counts?.sourceFindings,
    tests: deep?.testing?.perSourceFile,
    testsElsewhere: deep?.testing?.testsElsewhere,
  })
  console.log('')
}

// ── Table ─────────────────────────────────────────────────────────────────────

const pct = (v) => v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`
const num = (v) => v === undefined || v === null ? '—' : String(v)

const columns = [
  ['project', r => r.name, 16],
  ['files', r => num(r.files), 6],
  ['view', r => r.framework ?? '—', 8],
  ['styling', r => r.styling ? `${r.styling.slice(0, 12)} ${pct(r.stylingShare)}` : '—', 18],
  ['tools', r => r.toolchain ?? '—', 6],
  ['screens', r => num(r.screens), 8],
  ['sys%', r => pct(r.systemShare), 5],
  ['3 states', r => pct(r.allThree), 9],
  ['tangled', r => num(r.cycles), 8],
  ['a11y', r => num(r.a11y), 5],
  ['dupes', r => num(r.dupes), 6],
  ['secret', r => num(r.secrets), 7],
  ['danger', r => num(r.dangerous), 7],
  ['deps', r => num(r.advisories), 5],
  ['reach', r => num(r.contractReach), 6],
  ['handed', r => (r.delegation ?? '—').replace('delegated-review', 'deleg.'), 8],
]

console.log('')
console.log(columns.map(([h, , w]) => h.padEnd(w)).join(''))
console.log(columns.map(([, , w]) => '─'.repeat(w - 1) + ' ').join(''))
for (const r of rows) console.log(columns.map(([, get, w]) => String(get(r)).padEnd(w)).join(''))

const broken = rows.filter(r => Object.values(r.stages).some(v => v !== 'ok'))
if (broken.length) {
  console.log(`\nSTAGES THAT PRODUCED NOTHING (${broken.length} project(s))`)
  for (const r of broken) {
    for (const [script, why] of Object.entries(r.stages)) {
      if (why !== 'ok') console.log(`  ${r.name.padEnd(18)} ${script.padEnd(14)} ${why}`)
    }
  }
}

// Numbers that are suspicious next to their neighbours. A detector returning zero
// on one project and a hundred on another is either measuring a real difference
// or failing to recognise a convention, and only the comparison shows which.
const suspicious = []
for (const r of rows) {
  // A React project only. Elsewhere the dash in these columns is the correct
  // answer, and flagging it would train whoever reads this to ignore the list.
  const jsx = r.framework === 'react'
  if (jsx && r.files > 100 && r.screens === 0) suspicious.push(`${r.name}: ${r.files} files and 0 screens — the routing convention is probably unrecognised`)
  if (jsx && r.files > 100 && r.a11y === 0) suspicious.push(`${r.name}: 0 accessibility findings across ${r.files} files — check that the linter ran`)
  if (r.contractReach === 0) suspicious.push(`${r.name}: no agent contract at all`)
  if (r.secrets > 0) suspicious.push(`${r.name}: ${r.secrets} secret-shaped value(s) in the working tree — read security.json before repeating this anywhere`)
  if (r.advisories === null) suspicious.push(`${r.name}: the dependency audit did not run; this is not a clean result`)
  // A number measured over more than the target. react-query showed 126 advisories
  // in this column — an honest count of the whole TanStack workspace, read as a
  // property of a 65-file package. The scope is in security.json and the table has
  // room for a digit, so the caveat is where it can be seen.
  if (r.advisoryScope) suspicious.push(`${r.name}: the ${r.advisories} advisory count covers ${r.advisoryScope}, not this package alone`)
  if (r.tests === 0 && !r.testsElsewhere) suspicious.push(`${r.name}: no test files found, and none in any sibling package either`)
  if (r.tests === 0 && r.testsElsewhere) suspicious.push(`${r.name}: no tests under this target, but a suite lives at ${r.testsElsewhere.join(', ')} — a monorepo package measured in isolation`)
}
if (suspicious.length) {
  console.log('\nWORTH CHECKING AGAINST THE SOURCE BEFORE BELIEVING')
  for (const s of suspicious) console.log(`  · ${s}`)
}

console.log(`\n${rows.length} project(s) surveyed.`)
