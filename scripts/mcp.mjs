/**
 * Serve a library profile over the Model Context Protocol.
 *
 * The registry is only useful to whoever cloned the repository it lives in. Every
 * other agent — a developer's editor, a colleague's session, a pipeline running
 * somewhere else — is guessing, and guessing produces exactly the failure the
 * registry exists to prevent: a component or a prop that does not exist.
 *
 * Four answers, which are the four questions worth asking before writing UI:
 * what exists, what does this one take, which of these two do I want, and is what
 * I just wrote correct. The last is the one that changes behaviour, because it
 * turns "do not invent props" from a sentence in a contract into a check the
 * agent can run on itself.
 *
 * The full registry is never returned. It is 41k tokens for the eighty
 * components a task will not use, and a contract that does not fit in context is
 * not a contract that gets followed.
 *
 *   node scripts/mcp.mjs --profile own
 *   node scripts/mcp.mjs --profile mui --repo /path/to/project
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { indexProfile, scoreFiles } from './lib/score-core.mjs'
import { indexRow, componentDetail } from './lib/answers.mjs'
import { scanSlot } from './lib/signals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const flag = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PROFILE = flag('--profile') ?? 'own'
const REPO = flag('--repo')

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined

const profileDoc = readJson(join(root, 'profiles', PROFILE, 'components.json'))
if (!profileDoc) {
  console.error(`mcp: no profile "${PROFILE}". Build one first.`)
  process.exit(1)
}
const components = profileDoc.components
const indexed = indexProfile(profileDoc)
const judgment = readJson(join(root, 'profiles', PROFILE, 'judgment.json')) ?? {}
const tokensDoc = readJson(join(root, 'profiles', PROFILE, 'tokens.json'))

// A repository's own conventions, when one is named. Without it `check_usage`
// still catches invented props and values; with it, house style too.
const conventions = REPO ? readJson(join(REPO, '.ds', 'conventions.json')) : undefined

// ── The answers ───────────────────────────────────────────────────────────────

const oneLine = (name) => indexRow(name, components[name])

/**
 * What the client's own codebase writes at its call sites, if it has been measured.
 *
 * Read from that repository's scan, not from the profile: usage is a fact about one
 * codebase and a profile may serve several. Absent without `--repo`, and absent when
 * the scan was measured against a different profile than the one being served —
 * either way the section simply does not appear, which is the correct amount to say
 * about a measurement that was never taken.
 */
const observed = (() => {
  if (!REPO) return {}
  try {
    const doc = JSON.parse(readFileSync(join(root, 'scans', scanSlot(REPO), 'vocabulary.json'), 'utf8'))
    return doc.profile === PROFILE ? (doc.axes ?? {}) : {}
  } catch { return {} }
})()

const detail = (name) => componentDetail(name, indexed, observed)

const twinsFor = (name) => Object.entries(judgment.twins?.pairs ?? {})
  .filter(([pair]) => pair.split(/\s*~\s*/).includes(name))
  .map(([pair, entry]) => `${pair}\n  ${entry.separated}\n  reopen if: ${entry.reopenIf}`)

const TOOLS = [
  {
    name: 'list_components',
    description: 'Every component in this system, one line each: name, atomic level, surface, and what it is for. This is the whole list — if a component is not here it does not exist.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_component',
    description: 'The contract for named components: props, the closed set of values each variant accepts, the import, and a usage example. Ask for the ones you are about to write and no others.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' }, description: 'Component names' } },
      required: ['names'], additionalProperties: false,
    },
  },
  {
    name: 'choose_between',
    description: 'Why two components that look alike are not, and the condition under which that decision would be reopened. Ask when picking between neighbours such as Tooltip and Popover, or Table and DataGrid.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'A component whose neighbours are confusing' } },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'check_usage',
    description: 'Score a snippet against this system before writing it to disk: components that do not exist, props that are not declared, values outside a closed union, literal colours and sizes, and the accessibility floor.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'TSX source to check' } },
      required: ['code'], additionalProperties: false,
    },
  },
]

const text = (value) => ({ content: [{ type: 'text', text: value }] })

const handlers = {
  list_components: () => text([
    `${Object.keys(components).length} components in "${PROFILE}".`,
    'If a thing is not on this list it does not exist; inventing one fails the gate.',
    '',
    ...Object.keys(components).sort().map(oneLine),
  ].join('\n')),

  get_component: ({ names }) => {
    const found = names.map(n => detail(n) ?? `${n}: not in this system. Nothing here is called that.`)
    return text(found.join('\n\n---\n\n'))
  },

  choose_between: ({ name }) => {
    const pairs = twinsFor(name)
    if (!pairs.length) {
      return text(`No neighbour of ${name} has been written up in this system.\nThat is a gap in the profile, not a statement that the choice is obvious.`)
    }
    return text(pairs.join('\n\n'))
  },

  check_usage: async ({ code }) => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'ds-mcp-'))
    const file = join(dir, 'snippet.tsx')
    try {
      writeFileSync(file, code)
      const result = scoreFiles({ target: dir, files: [file], conventions, baseline: {}, profile: indexed })
      const failures = result.checks.filter(c => !c.ok)
      if (!failures.length) {
        return text(`${result.score}% — ${result.total} check(s) passed. Nothing invented, nothing outside a union.`)
      }
      return text([
        `${result.score}% — ${failures.length} problem(s):`,
        '',
        ...failures.map(f => `  ${f.detail}`),
        '',
        'Every value above comes from this system\'s own registry, not from a general rule.',
      ].join('\n'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
}

// ── Serve ─────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'ai-factoryfit', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name]
  if (!handler) return text(`No tool called ${request.params.name}.`)
  try {
    return await handler(request.params.arguments ?? {})
  } catch (error) {
    return text(`${request.params.name} failed: ${error.message}`)
  }
})

await server.connect(new StdioServerTransport())
console.error(`factoryfit mcp: serving "${PROFILE}" — ${Object.keys(components).length} components`
  + `${tokensDoc ? ', tokens' : ''}${conventions ? ', repository conventions' : ''}`)
