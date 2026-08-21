/**
 * The scoring logic, in one place.
 *
 * Used by the tool's CLI and, in copied form, by the gate that `install` writes
 * into the target repository. Two copies of this that drift would score the same
 * file differently depending on who ran it, which is the fastest way to make a
 * number worthless.
 *
 * Nothing here is a new opinion. Every check is something the project already
 * established: its measured conventions, the components its profile says exist,
 * the props those components declare, and the accessibility floor that comes from
 * a published standard rather than from taste.
 */
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { SIGNALS } from './signals.mjs'

/** Attributes an element accepts because it is an element, not because we declared them. */
export const DOM_ATTRIBUTES = new Set([
  'id', 'name', 'type', 'value', 'defaultValue', 'checked', 'defaultChecked', 'placeholder',
  'disabled', 'required', 'readOnly', 'autoFocus', 'autoComplete', 'maxLength', 'minLength',
  'min', 'max', 'step', 'pattern', 'multiple', 'accept', 'rows', 'cols', 'htmlFor', 'form',
  'src', 'alt', 'href', 'target', 'rel', 'download', 'title', 'tabIndex', 'role', 'lang', 'dir',
  'width', 'height', 'loading', 'colSpan', 'rowSpan', 'scope', 'inputMode', 'enterKeyHint',
])

/**
 * Indexes a profile so a compound component's parts resolve to their entry.
 * Card exports CardTitle and Dropdown exports DropdownItem; looking up only the
 * main name reports every part of every compound component as invented.
 */
export function indexProfile(profileDoc) {
  if (!profileDoc) return undefined
  const index = {}
  for (const [name, entry] of Object.entries({ ...profileDoc.components, ...profileDoc.blocks })) {
    index[name] = { ...entry, isPart: false }
    // A compound component's parts resolve to its entry so that <CardTitle> is
    // known to exist — but that entry carries the PARENT's props, not the part's.
    // Checking CardTitle's attributes against Card's prop list reported `as` and
    // `icon` as invented when both are declared one file away. Until a registry
    // publishes per-part props, existence is checked and the prop list is not.
    for (const exported of entry.exports ?? []) {
      if (exported === name) continue
      index[exported] ??= { ...entry, ref: exported, isPart: true, partOf: name }
    }
    for (const part of entry.parts ?? []) index[part] ??= { ...entry, ref: part, isPart: true, partOf: name }
  }
  return index
}

/**
 * Components reached through the design system, and only those. An application's
 * own components are its own business; holding them to a registry they were never
 * in produces a failure list nobody reads.
 */
function systemComponentsIn(text) {
  const imported = new Set()
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!/@ds\b|@blocks\b|design-system/.test(m[2])) continue
    for (const raw of m[1].split(',')) {
      const nameOnly = raw.trim().split(/\s+as\s+/)[0].trim()
      if (/^[A-Z]/.test(nameOnly)) imported.add(nameOnly)
    }
  }
  return imported
}

/**
 * Attributes written on one JSX element, without descending into its children.
 *
 * Scanned rather than pattern-matched. Two attempts with regexes failed in
 * opposite directions: requiring `name=` made boolean shorthand invisible, and
 * allowing it made every word inside `onClick={() => {…}}` look like an
 * attribute, because a regular expression cannot balance brackets. A scanner
 * that tracks quote and brace depth can, in about twenty lines.
 */
function attributesOn(text, component) {
  const found = []
  const opening = new RegExp(`<${component}\\b`, 'g')

  for (const match of text.matchAll(opening)) {
    let i = match.index + match[0].length
    let depth = 0
    let quote

    while (i < text.length) {
      const c = text[i]

      if (quote) { if (c === quote) quote = undefined; i += 1; continue }

      // Comments live inside the attribute region too, and a disable directive
      // there turned `eslint-disable-next-line jsx-a11y/no-autofocus` into three
      // undeclared props on the element below it.
      if (c === '/' && text[i + 1] === '/') {
        const newline = text.indexOf('\n', i)
        i = newline === -1 ? text.length : newline + 1
        continue
      }
      if (c === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2)
        i = close === -1 ? text.length : close + 2
        continue
      }

      if (c === '"' || c === "'" || c === '`') { quote = c; i += 1; continue }
      if (c === '{') { depth += 1; i += 1; continue }
      if (c === '}') { depth -= 1; i += 1; continue }
      if (depth > 0) { i += 1; continue }
      if (c === '>') break
      if (c === '/' && text[i + 1] === '>') break

      // At depth zero, an identifier here is an attribute name.
      const name = /^[a-zA-Z][\w:-]*/.exec(text.slice(i))?.[0]
      if (!name) { i += 1; continue }
      i += name.length

      let value
      const after = /^\s*=\s*/.exec(text.slice(i))
      if (after) {
        i += after[0].length
        const literal = /^(["'])([^"']*)\1/.exec(text.slice(i))
        if (literal) { value = literal[2]; i += literal[0].length }
        // An expression value is skipped by the brace tracking above.
      }
      found.push({ name, value })
    }
  }
  return found
}

export function scoreFiles({ target, files, conventions, baseline = {}, profile }) {
  const checks = []
  const record = (file, group, ok, detail) => checks.push({ file, group, ok, detail })

  for (const abs of files) {
    const rel = relative(target, abs).split(sep).join('/')
    let text
    try { text = readFileSync(abs, 'utf8') } catch { continue }

    // Conventions the project measured, minus what it already forgave.
    for (const [dimension, rule] of Object.entries(conventions?.enforce ?? {})) {
      const bucket = SIGNALS[dimension]?.(abs, text)
      if (!bucket) continue
      if ((baseline[dimension] ?? []).includes(rel)) continue
      record(rel, 'conventions', bucket === rule.expect,
        bucket === rule.expect ? undefined : `${dimension}: found "${bucket}", this repository uses "${rule.expect}"`)
    }

    // The registry is the whole list, and a component's props are its API.
    if (profile) {
      for (const component of systemComponentsIn(text)) {
        const entry = profile[component]
        record(rel, 'components exist', Boolean(entry), entry ? undefined : `<${component}> is not in the registry`)
        if (!entry) continue

        if (entry.isPart) continue
        const declared = new Map((entry.props ?? []).map(p => [p.name, p]))
        // A component extending an element's attributes accepts them. Reporting
        // `<Input type>` as undeclared on a component whose type says
        // `InputHTMLAttributes` is the tool misreading the contract.
        const inheritsDom = Boolean(entry.inherits)

        for (const attr of attributesOn(text, component)) {
          if (/^(key|ref|className|style|data-|aria-|on[A-Z])/.test(attr.name)) continue
          const prop = declared.get(attr.name)
          const inherited = !prop && inheritsDom && DOM_ATTRIBUTES.has(attr.name)
          record(rel, 'props declared', Boolean(prop) || inherited,
            (prop || inherited) ? undefined : `<${component} ${attr.name}> is not a declared prop`)
          if (!prop || attr.value === undefined || !prop.values) continue
          const allowed = prop.values.includes(attr.value)
          record(rel, 'values in union', allowed, allowed ? undefined
            : `<${component} ${attr.name}="${attr.value}"> is outside its union (${prop.values.join(' | ')})`)
        }
      }
    }

    // Values decided outside the system.
    const literals = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length
      + [...text.matchAll(/\b\d{2,4}px\b/g)].length
    record(rel, 'no literal values', literals === 0, literals === 0 ? undefined : `${literals} literal colour or size value(s)`)

    // The accessibility floor: WCAG 1.1.1 and 4.1.2, not a preference.
    const a11y = []
    if (/<img\b(?![^>]*\balt\s*=)/.test(text)) a11y.push('an image without alt text')
    if (/<(div|span)\b[^>]*\bonClick\s*=(?![^>]*\brole\s*=)/.test(text)) a11y.push('a click handler on a non-interactive element')
    if (/<(button|IconButton)\b(?![^>]*\b(aria-label|aria-labelledby|title)\s*=)[^>]*>\s*<(Icon|svg)[^>]*\/?>\s*<\//.test(text)) a11y.push('an icon-only control with no accessible name')
    record(rel, 'accessibility floor', a11y.length === 0, a11y.length ? a11y.join('; ') : undefined)
  }

  const groups = {}
  for (const c of checks) {
    const g = groups[c.group] ??= { passed: 0, total: 0 }
    g.total += 1
    if (c.ok) g.passed += 1
  }

  const passed = checks.filter(c => c.ok).length
  // Floored, not rounded. 1176 of 1180 rounds to 100% and reads as "nothing left
  // to fix" while four checks are still failing; a hundred here means zero.
  const floor = (n) => Math.floor(n * 100)
  return {
    score: checks.length === 0 ? 100 : floor(passed / checks.length),
    passed,
    total: checks.length,
    checks,
    groups,
  }
}

/** Prints a score the same way wherever it is run. */
export function reportScore(result, { files, profile, note } = {}) {
  console.log(`\nscore: ${result.score}%  (${result.passed}/${result.total} checks over ${files ?? '?'} file(s))`)
  if (!profile) console.log('No profile available, so component and prop checks did not run.')
  console.log('')
  for (const [name, g] of Object.entries(result.groups)) {
    const pct = g.total === 0 ? 100 : Math.round((g.passed / g.total) * 100)
    console.log(`  ${String(pct).padStart(3)}%  ${name.padEnd(20)} ${g.passed}/${g.total}`)
  }
  const failures = result.checks.filter(c => !c.ok)
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`)
    const byFile = {}
    for (const f of failures) (byFile[f.file] ??= []).push(f)
    for (const [file, list] of Object.entries(byFile).slice(0, 15)) {
      console.log(`  ${file}`)
      for (const f of list.slice(0, 6)) console.log(`    ${f.detail}`)
    }
    const more = Object.keys(byFile).length - 15
    if (more > 0) console.log(`  … and ${more} more file(s)`)
  }
  if (note) console.log(`\n${note}`)
}
