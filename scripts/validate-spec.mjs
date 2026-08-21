/**
 * Validate a screen spec against a library profile.
 *
 * A spec is written in roles, not in component names, so the same agreed screen
 * can be checked against more than one library. Validation resolves each role
 * through that profile's bindings, then checks the resulting component and props
 * against what the library actually declares — the closed unions from its own
 * types, not a list somebody maintained by hand.
 *
 * The point is to reject an impossible screen before it is built. Arguing about a
 * zone costs a minute; arguing about a built screen costs an afternoon.
 *
 * A role the target library does not cover is reported with the reason its
 * binding gives. That is a design decision surfacing early, not a tool failure:
 * it says this screen needs a composition the library does not ship.
 *
 *   node scripts/validate-spec.mjs <spec.json> --profile own
 *   node scripts/validate-spec.mjs <spec.json> --profile own,mui
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const specPath = process.argv[2]
const profileArg = process.argv.indexOf('--profile')
const PROFILES = profileArg === -1
  ? ['own']
  : (process.argv[profileArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!specPath || !existsSync(specPath)) {
  console.error('usage: node scripts/validate-spec.mjs <spec.json> --profile own[,mui]')
  process.exit(2)
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const vocabulary = JSON.parse(readFileSync(join(root, 'roles', 'vocabulary.json'), 'utf8'))

/** `primaryAction tone=danger size=md` -> { role, props }. */
function parseElement(text) {
  const [role, ...rest] = text.trim().split(/\s+/)
  const props = {}
  for (const pair of rest) {
    const eq = pair.indexOf('=')
    if (eq === -1) { props[pair] = true; continue }
    props[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return { role, props }
}

function validateAgainst(profileId) {
  const problems = []
  const resolved = []

  const profileDir = join(root, 'profiles', profileId)
  const bindingPath = join(root, 'bindings', `${profileId}.json`)
  if (!existsSync(profileDir)) return { problems: [`no profile "${profileId}"`], resolved }
  if (!existsSync(bindingPath)) return { problems: [`no bindings for "${profileId}"`], resolved }

  const components = JSON.parse(readFileSync(join(profileDir, 'components.json'), 'utf8')).components
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'))

  for (const zone of spec.zones ?? []) {
    for (const text of zone.elements ?? []) {
      const { role, props } = parseElement(text)
      const at = `${zone.name}/${text}`

      if (!vocabulary.roles[role]) {
        problems.push(`${at}: "${role}" is not a role in the vocabulary`)
        continue
      }

      const bound = binding.roles[role]
      if (!bound) {
        problems.push(`${at}: role "${role}" has no binding for ${profileId}`)
        continue
      }
      if (bound.notCovered) {
        problems.push(`${at}: ${profileId} does not cover "${role}" — ${bound.notCovered}`)
        continue
      }

      const entry = components[bound.component]
      if (!entry) {
        problems.push(`${at}: binding points at ${bound.component}, which is not in the ${profileId} registry`)
        continue
      }

      // Defaults the binding always applies, then whatever the spec asked for,
      // translated from the shared axis into this library's own prop and value.
      const applied = { ...bound.props }
      for (const [axis, value] of Object.entries(props)) {
        const rule = bound.axes?.[axis] ?? binding.axes?.[axis]
        if (!rule) {
          problems.push(`${at}: "${axis}" is not an axis this vocabulary defines`)
          continue
        }
        const translated = rule.values[value]
        if (translated === undefined) {
          problems.push(`${at}: ${profileId} maps no value for ${axis}=${value}`)
          continue
        }
        applied[rule.prop] = translated
      }

      const before = problems.length
      for (const [prop, value] of Object.entries(applied)) {
        const declared = entry.props?.find(p => p.name === prop)
        if (!declared) {
          problems.push(`${at}: ${bound.component} has no prop "${prop}" (the binding says it should)`)
          continue
        }
        if (declared.values && !declared.values.includes(String(value))) {
          problems.push(`${at}: ${bound.component}.${prop}="${value}" is outside its union (${declared.values.join(' | ')})`)
        }
      }

      resolved.push({
        zone: zone.name,
        role,
        component: bound.component,
        props: applied,
        note: bound.note,
        // An element whose props did not check out is not a resolved element.
        // Printing it with a tick next to its own error is how a report teaches
        // people to stop reading it.
        ok: problems.length === before,
      })
    }
  }

  return { problems, resolved }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nspec: ${spec.id} — ${spec.title}`)
console.log(`goal: ${spec.goal}`)

let failed = 0
for (const profileId of PROFILES) {
  const { problems, resolved } = validateAgainst(profileId)
  console.log(`\n── ${profileId} ${'─'.repeat(Math.max(0, 60 - profileId.length))}`)
  for (const item of resolved) {
    const props = Object.entries(item.props).map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`  ${item.ok ? '✓' : '✗'} ${item.zone.padEnd(10)} ${item.role.padEnd(17)} → <${item.component}${props ? ' ' + props : ''}>`)
    if (item.note) console.log(`      note: ${item.note}`)
  }
  if (problems.length) {
    failed += 1
    console.log('')
    for (const problem of problems) console.log(`  ✗ ${problem}`)
    console.log(`\n  ${problems.length} problem(s) — this screen cannot be built on ${profileId} as specified.`)
  } else {
    console.log(`\n  buildable: ${resolved.length} element(s), every component and value checked against the library's own types.`)
  }
}

process.exit(failed ? 1 : 0)
