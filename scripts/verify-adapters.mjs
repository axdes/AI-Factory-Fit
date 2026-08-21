/**
 * Do the third-party adapters still reproduce their committed profiles?
 *
 * `adapt-mui` and `adapt-antd` read the shipped `.d.ts` through the TypeScript AST
 * and execute the theme, so they are the only passes here whose correctness depends
 * on software that is not in this repository. Nothing in `check` could touch them:
 * their profiles were validated as SHAPES, which says the file is well formed and
 * nothing about whether it still matches the library it claims to describe.
 *
 * This installs nothing. It compares what the adapter produces now against what is
 * committed, at the version the committed profile records — and where the sandbox is
 * missing it says so rather than passing. A verification that quietly skips is the
 * same lie as a check that cannot fail.
 *
 *   npm install --prefix .sandboxes/mui @mui/material@<the recorded version>
 *   node scripts/verify-adapters.mjs
 */
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const ADAPTERS = [
  { id: 'mui', script: 'adapt-mui.mjs', pkg: '@mui/material', sandbox: join(root, '.sandboxes', 'mui') },
  { id: 'antd', script: 'adapt-antd.mjs', pkg: 'antd', sandbox: join(root, '.sandboxes', 'antd') },
]

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
let ran = 0
let failed = 0
const skipped = []

console.log('\nverify-adapters: the two passes whose correctness depends on software not in this repository\n')

for (const a of ADAPTERS) {
  const committed = join(root, 'profiles', a.id, 'profile.json')
  if (!existsSync(committed)) { skipped.push(`${a.id}: no committed profile to compare with`); continue }
  const wanted = read(committed).library?.source ?? ''
  const installed = join(a.sandbox, 'node_modules', a.pkg, 'package.json')
  if (!existsSync(installed)) {
    skipped.push(`${a.id}: ${a.pkg} is not installed under ${a.sandbox.replace(root + '/', '')} — the profile records ${wanted}`)
    continue
  }
  const have = `${a.pkg}@${read(installed).version}`
  if (wanted && have !== wanted) {
    // A different version is a different library. Comparing across one is how a
    // major-version difference reads as sixteen lost unions.
    skipped.push(`${a.id}: installed ${have}, and the profile records ${wanted} — comparing across versions measures the release, not the adapter`)
    continue
  }

  const out = `${a.id}-verify`
  rmSync(join(root, 'profiles', out), { recursive: true, force: true })
  try {
    execFileSync(process.execPath, [join(here, a.script), '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    console.log(`  ${a.id}: the adapter failed to run\n    ${String(error.stdout ?? error.message).split('\n')[0]}`)
    failed += 1
    continue
  }

  const was = read(join(root, 'profiles', a.id, 'components.json')).components
  const now = read(join(root, 'profiles', out, 'components.json')).components
  const names = new Set([...Object.keys(was), ...Object.keys(now)])
  const missing = [...names].filter(n => !now[n])
  const extra = [...names].filter(n => !was[n])
  const lostUnions = []
  // Props gained or lost, not just unions. The comparison is between the committed
  // profile and a fresh extraction from the SAME installed version — the pass above
  // refuses to run otherwise — so within it there is no legitimate difference. Any
  // change is the reader behaving differently, which is the one thing this script
  // exists to catch.
  //
  // It did not catch it: removing `Accordion.onChange` from the committed profile
  // left this verification green, because a handler carries no closed union and
  // nothing else compared the two lists.
  const propsChanged = []
  for (const n of [...names].filter(x => was[x] && now[x])) {
    for (const p of (was[n].props ?? []).filter(p => p.values)) {
      const q = (now[n].props ?? []).find(x => x.name === p.name)
      if (!q || !q.values) lostUnions.push(`${n}.${p.name}`)
    }
    const before = new Set((was[n].props ?? []).map(p => p.name))
    const after = new Set((now[n].props ?? []).map(p => p.name))
    const gone = [...before].filter(x => !after.has(x))
    const added = [...after].filter(x => !before.has(x))
    if (gone.length) propsChanged.push(`${n}: no longer reads ${gone.slice(0, 4).join(', ')}${gone.length > 4 ? ` and ${gone.length - 4} more` : ''}`)
    if (added.length) propsChanged.push(`${n}: now reads ${added.slice(0, 4).join(', ')}${added.length > 4 ? ` and ${added.length - 4} more` : ''}`)
  }
  rmSync(join(root, 'profiles', out), { recursive: true, force: true })

  const ok = !missing.length && !extra.length && !lostUnions.length && !propsChanged.length
  ran += 1
  console.log(`  ${ok ? '✓' : '✗'} ${a.id.padEnd(6)} ${have} — ${Object.keys(now).length} component(s)`)
  if (!ok) {
    failed += 1
    if (propsChanged.length) {
      for (const line of propsChanged.slice(0, 6)) console.log(`      ${line}`)
      if (propsChanged.length > 6) console.log(`      … and ${propsChanged.length - 6} more component(s) whose props changed`)
    }
    if (missing.length) console.log(`      no longer extracted: ${missing.join(', ')}`)
    if (extra.length) console.log(`      newly extracted: ${extra.join(', ')}`)
    // A lost union is the finding that matters: it is a closed set an agent is now
    // free to invent a value outside of.
    if (lostUnions.length) console.log(`      closed sets lost: ${lostUnions.join(', ')}`)
  }
}

if (skipped.length) {
  console.log(`\n  NOT VERIFIED — ${skipped.length}:`)
  for (const s of skipped) console.log(`    · ${s}`)
  console.log('\n  Not run is not passed. These adapters are unverified until their sandbox holds')
  console.log('  the version the committed profile was built from.')
}

console.log(`\n${ran} verified, ${failed} failed, ${skipped.length} not run.`)

// The exit code has to say what the text above it says. `Not run is not passed` was
// printed over `process.exit(0)`, so a run where every adapter was skipped — no
// library installed, wrong version — returned success, and anything reading the code
// rather than the words was told the adapters are fine.
//
// A partial run still passes: skipping one adapter on a machine that lacks its
// library is ordinary, and the skip is named above. Verifying NOTHING is not.
if (!ran) {
  console.log('\nNothing was verified, so nothing is known. That is not the same as passing.')
}
process.exit(failed || !ran ? 1 : 0)
