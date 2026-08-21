/**
 * Score code against everything a project has decided — run from this tool.
 *
 * One scorer, three uses. Run it on a file an agent just wrote and it is a
 * verify step. Run it on the project's own recent code and it is the baseline.
 * Run it on candidate solutions to the same task and it is an eval — the only way
 * to find out whether a change to the rules, the registry or the examples
 * actually improved anything, rather than felt like it did.
 *
 * The logic lives in lib/score-core.mjs, which `install` copies into the target
 * repository so the gate there scores identically. Two copies that drift would
 * score the same file differently depending on who ran it, which makes the number
 * worthless.
 *
 *   node scripts/score.mjs <repo> --profile own [files...]
 *   node scripts/score.mjs <repo> --profile own --baseline --exclude ds,brand
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { walk } from './lib/signals.mjs'
import { indexProfile, scoreFiles, reportScore } from './lib/score-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile')
const EXCLUDE = flag('--exclude')
const baselineMode = process.argv.includes('--baseline')
const EXCLUDED = (EXCLUDE ?? '').split(',').map(x => x.trim()).filter(Boolean)
const fileArgs = process.argv.slice(3)
  .filter(a => !a.startsWith('--') && a !== PROFILE && a !== EXCLUDE)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/score.mjs <repo> --profile <id> [files...] [--baseline] [--exclude a,b]')
  process.exit(2)
}

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
const conventions = readJson(join(target, '.ds', 'conventions.json'))
const baseline = readJson(join(target, '.ds', 'baseline.json')) ?? {}
const profile = indexProfile(PROFILE ? readJson(join(root, 'profiles', PROFILE, 'components.json')) : undefined)

/** Recently touched code is the fairest baseline: it is what the team writes now. */
function recentFiles(days = 90) {
  try {
    const out = execFileSync('git', ['-C', target, 'log', `--since=${days} days ago`, '--name-only', '--pretty=format:'], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
    return [...new Set(out.split('\n').map(l => l.trim()).filter(Boolean))].map(p => join(target, p))
  } catch { return [] }
}

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const usable = (f) => existsSync(f) && /\.[jt]sx$/.test(f) && !/\.(test|spec)\./.test(f)
  && !excludedPrefixes.some(p => f === p || f.startsWith(p + sep))

// Where the source lives. `src` is only a default; a repository that keeps its
// code somewhere else is not an error to crash on, and a stack trace out of
// readdir is not an answer a client can act on.
const scope = join(target, conventions?.scope ?? 'src')
if (!baselineMode && !fileArgs.length && !existsSync(scope)) {
  console.error(`score: nothing to score at ${scope}.`)
  console.error(conventions?.scope
    ? 'That path comes from .ds/conventions.json — the repository moved since it was written.'
    : 'No .ds/conventions.json here, so `src` was assumed. Run `ds install` first, or name the files to score.')
  process.exit(2)
}

const files = (baselineMode
  ? recentFiles()
  : fileArgs.length
    ? fileArgs.map(f => isAbsolute(f) ? f : join(target, f))
    : walk(scope)
).filter(usable)

if (files.length === 0) {
  console.error('score: no files to score.')
  process.exit(1)
}

const result = scoreFiles({ target, files, conventions, baseline, profile })
reportScore(result, {
  files: files.length,
  profile,
  note: baselineMode
    ? 'This is the baseline: what the team\'s own recent code scores.\nAgent output is worth comparing against this number, not against 100.'
    : undefined,
})
