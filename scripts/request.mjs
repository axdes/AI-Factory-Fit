/**
 * A component the library does not have, written down instead of built.
 *
 * `ds draft` already reports the roles a profile cannot answer, and `ds spec`
 * refuses a screen that needs one. Both are correct and both are dead ends: the
 * finding has nowhere to go, so the shortest path is to build the thing inside
 * the application — which is exactly what the promotion scout exists to find
 * later, after two teams have each done it once.
 *
 * This is the other end of that. A request is cheap to file and expensive to
 * ignore, and it carries the one thing that makes it answerable: what was
 * considered and why it did not do.
 *
 * The alternatives are not decoration. A request that names none reads as "I did
 * not look", and it will be answered with the component that was already there.
 * The registry is searched here so the request arrives with the near misses
 * already listed, which is the part a person would skip.
 *
 *   ds request "A styled accessible table" --profile own --level molecule
 *   ds request "..." --profile own --out requests/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const need = process.argv[2]
const PROFILE = flag('profile', 'own')
const LEVEL = flag('level')
const OUT = flag('out')

if (!need || need.startsWith('--')) {
  console.error('usage: ds request "<what is needed and why>" --profile <id> [--level molecule] [--out <dir>]')
  process.exit(2)
}

const profilePath = join(root, 'profiles', PROFILE, 'components.json')
if (!existsSync(profilePath)) {
  console.error(`request: no profile "${PROFILE}". A request against a library nobody has read is a wish.`)
  process.exit(1)
}
const components = JSON.parse(readFileSync(profilePath, 'utf8')).components ?? {}

// ── Near misses ───────────────────────────────────────────────────────────────
//
// Searched, not asked for. A request whose "considered alternatives" is empty
// reads as "I did not look", and will be answered with the component that was
// already there — after which nobody files the next one.

const words = need.toLowerCase().match(/[a-z]{4,}/g) ?? []
const scored = Object.entries(components).map(([name, c]) => {
  const haystack = `${name} ${c.description ?? ''} ${(c.props ?? []).map(p => p.name).join(' ')}`.toLowerCase()
  const hits = words.filter(w => haystack.includes(w))
  // The name matching is worth more than a prop name matching, because a
  // component called Table is a better near miss for a table than one that
  // happens to take a `columns` prop.
  const score = hits.length + (words.some(w => name.toLowerCase().includes(w)) ? 3 : 0)
  return { name, score, why: c.description ?? null, from: c.from }
}).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)

const id = need.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 5).join('-')

const request = {
  schemaVersion: 1,
  id,
  need,
  profile: PROFILE,
  level: LEVEL ?? null,
  requestedBy: 'agent',
  // No timestamp. The file lands in a commit, and the commit already carries the
  // date — a second one only ever disagrees with it.
  consideredAlternatives: scored.map(c => ({
    ref: c.name,
    from: c.from,
    whatItIs: c.why,
    whyNot: 'TO FILL IN: why this does not do. A request whose alternatives carry no reason is answered with one of them.',
  })),
  proposedApi: {
    _: 'TO FILL IN: the props and their types. Proposing an API is what turns a request into something a person can accept or refuse in one reading.',
  },
  status: 'pending',
  _: [
    'A component this library does not have, written down instead of built inside an application.',
    '',
    'The alternative to filing this is the shortest path: build it locally, ship, and let the',
    'next team build it again. That is the failure the promotion scout finds months later, by',
    'which point there are two of them and neither is the one that gets promoted.',
    '',
    'Nothing here is automatic. The near misses were searched; the reasons they do not do have',
    'to be written by whoever hit the wall, because that reason is the entire content of the',
    'request.',
  ],
}

const dir = OUT ? (OUT.startsWith('/') ? OUT : join(process.cwd(), OUT)) : join(root, 'requests')
mkdirSync(dir, { recursive: true })
const at = join(dir, `${id}.json`)
if (existsSync(at)) {
  console.error(`request: ${at} already exists.`)
  console.error('A second request for the same thing is a sign the first was never answered —')
  console.error('which is worth raising rather than overwriting.')
  process.exit(1)
}
writeFileSync(at, JSON.stringify(request, null, 2) + '\n')

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nrequest: ${need}`)
console.log(`against ${Object.keys(components).length} component(s) in "${PROFILE}"\n`)

if (scored.length) {
  console.log('NEAREST THINGS THIS LIBRARY ALREADY HAS')
  for (const c of scored) {
    console.log(`  ${c.name.padEnd(20)} ${c.why ? c.why.slice(0, 78) : 'no description — the line that would decide this is not written'}`)
  }
  console.log('\n  Each needs a reason it does not do, written by whoever hit the wall. That')
  console.log('  reason is the whole content of the request: without it this is answered with')
  console.log('  one of the above, and the next person stops filing them.')
} else {
  console.log('NEAREST THINGS THIS LIBRARY ALREADY HAS')
  console.log('  Nothing matched. Either this is genuinely new, or the words do not overlap —')
  console.log('  a library whose components carry no descriptions cannot be searched by meaning.')
  const described = Object.values(components).filter(c => c.description).length
  if (!described) console.log(`  None of the ${Object.keys(components).length} components here has a description, so only names were matched.`)
}

const pending = readdirSync(dir).filter(f => f.endsWith('.json')).length
console.log(`\nwritten to ${at}`)
console.log(`${pending} request(s) open. A request nobody answers is a component somebody builds locally.`)
