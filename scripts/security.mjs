/**
 * Security defects, on the same terms as every other pass here.
 *
 * The toolchain audit already asks whether this repository carries a secret
 * scanner. That is a different question from whether it has secrets, and asking
 * only the first was the gap: a project could score well on mechanisms present
 * and be shipping a private key.
 *
 * Three sources, in descending order of how much they can be trusted:
 *
 *   dependencies   npm audit — an advisory database, not our opinion
 *   secrets        gitleaks where installed; otherwise shapes with a checksum
 *                  or a known prefix, never "this looks like a password"
 *   source         a small set of patterns whose danger is not arguable, each
 *                  checked against the mitigation that makes it fine
 *
 * The discipline is the one that matters most here, because a security report
 * that cries wolf is read once. Every finding names what would make it not a
 * finding, and anything requiring taint analysis to judge is left out rather than
 * guessed at — this pass sees text, not data flow.
 *
 *   node scripts/security.mjs <repo> [--exclude vendor]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { walk, TOOL_EXT, scanSlot, projectRoots } from './lib/signals.mjs'
import { normaliseAudit, pathCounts, auditedCount } from './lib/audit-shapes.mjs'
import { taken } from './lib/taken.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2]
const excludeArg = process.argv.indexOf('--exclude')
const EXCLUDED = excludeArg === -1 ? [] : (process.argv[excludeArg + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/security.mjs <repo> [--exclude vendor]')
  process.exit(2)
}

const excludedPrefixes = EXCLUDED.map(e => join(target, e))
const files = walk(target, [], TOOL_EXT)
  .filter(f => !excludedPrefixes.some(p => f === p || f.startsWith(p + sep)))
const rel = (abs) => relative(target, abs).split(sep).join('/')
const read = (abs) => { try { return readFileSync(abs, 'utf8') } catch { return '' } }

const isTest = (f) => /\.(test|spec)\.[jt]sx?$|(^|\/)(tests?|__tests__|e2e|fixtures?|mocks?)\//.test(rel(f))
const source = files.filter(f => /\.[jt]sx?$|\.mjs$|\.cjs$/.test(f))

// ── 1. Dependencies ───────────────────────────────────────────────────────────
//
// Delegated entirely. An advisory database is maintained by people who do this
// full time, and a hand-rolled version of it would be out of date the week it
// was written.

const dependencies = (() => {
  // The project's own package manager, because the lockfile decides which one can
  // answer. Refusing on anything but npm meant reporting no result for every pnpm
  // and yarn repository — which is most of them — when all three ship an audit
  // that reads the same advisory database.
  //
  // The lockfile is looked for up the workspace as well: a package in a monorepo
  // has no lockfile of its own and its dependencies are resolved at the root.
  const MANAGERS = [
    { lock: 'package-lock.json', bin: 'npm', args: ['audit', '--json'] },
    { lock: 'npm-shrinkwrap.json', bin: 'npm', args: ['audit', '--json'] },
    { lock: 'pnpm-lock.yaml', bin: 'pnpm', args: ['audit', '--json'] },
    // Two yarns, two commands. Berry answers `yarn npm audit`; classic answers
    // `yarn audit` and rejects the other. Writing only berry's meant no result on
    // every yarn-1 repository, which is still most of them.
    { lock: 'yarn.lock', bin: 'yarn', args: ['npm', 'audit', '--json', '--all'], alt: ['audit', '--json'] },
  ]
  let found
  for (const base of projectRoots(target)) {
    found = MANAGERS.map(m => ({ ...m, at: base })).find(m => existsSync(join(base, m.lock)))
    if (found) break
  }
  if (found) {
    // A project that pins its manager means it. Outline declares yarn@4 and the
    // global yarn here is 1.22, which refuses to run at all — and the refusal came
    // back as "most often there is no network", blaming the wrong thing entirely.
    // corepack is what the field exists for, so it is used where available.
    try {
      const pinned = JSON.parse(readFileSync(join(found.at, 'package.json'), 'utf8')).packageManager
      if (pinned && pinned.split('@')[0] === found.bin) found.pinned = pinned
    } catch { /* no manifest, or no pin */ }
  }
  if (!found) return { available: false, why: 'no lockfile here or in the workspace above, so there is no resolved dependency tree to check' }

  // What the manager itself said. "Most often there is no network here" was a
  // guess presented as a diagnosis, and it sent the reader to check a connection
  // when the truth was a pinned version mismatch printed in the first line.
  const reasonFrom = (error) => {
    const text = (String(error.stdout ?? '') + String(error.stderr ?? ''))
      .split('\n').map(l => l.trim()).filter(Boolean)
    const said = text.map(l => { try { return JSON.parse(l)?.data } catch { return l } })
      .find(d => typeof d === 'string' && d.length > 10)
    if (said) {
      return `${found.bin} audit refused: ${said.slice(0, 160)}`
        + (found.corepackMissing
          ? '. This project pins its package manager, and corepack — which runs the pinned version — is not installed here; `corepack enable` would let this run'
          : '')
    }
    if (text[0]) return `${found.bin} audit: ${text[0].slice(0, 160)}`
    return `${found.bin} audit produced no output; a network is the usual reason, but it did not say`
  }

  const invoke = (args) => {
    if (found.pinned) {
      try {
        return execFileSync('corepack', [found.bin, ...args], {
          cwd: found.at, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        if (error.code !== 'ENOENT' && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout
        // corepack absent, or it failed for its own reasons: fall through to the
        // globally installed manager and let its refusal be reported honestly.
        //
        // Which refusal is then about the wrong thing. The global manager says "this
        // project pins yarn@4 and I am 1.22", which is true and reads as a fact about
        // the project rather than about this machine. Noted here so the reason can say
        // what would actually fix it.
        if (error.code === 'ENOENT') found.corepackMissing = true
      }
    }
    return execFileSync(found.bin, args, {
      cwd: found.at, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  // Every spelling this manager might answer to, in order. A non-zero exit is
  // normal — it is how an audit reports findings — so the test is whether there
  // is output to read, not whether it succeeded.
  const attempts = [found.args, ...found.alt ? [found.alt] : []]
  let out
  let lastError
  for (const args of attempts) {
    try {
      out = invoke(args)
      break
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { available: false, why: `this project locks with ${found.lock} and ${found.bin} is not installed here` }
      }
      lastError = error
      // Only output that looks like a report counts as one. Accepting any
      // non-empty stdout took yarn classic's complaint about berry syntax as the
      // answer and never tried the spelling it does understand.
      const said = String(error.stdout ?? '').trim()
      if (said.startsWith('{') || said.startsWith('[')) { out = said; break }
    }
  }

  // The refusal is quoted rather than explained away. "Most often there is no
  // network here" was a guess presented as a diagnosis, and on Outline the truth
  // was in the first line the tool printed: the project pins yarn@4 and the
  // installed yarn is 1.22.
  if (!String(out ?? '').trim()) {
    return { available: false, why: lastError ? reasonFrom(lastError) : `${found.bin} audit produced no output` }
  }

  // Three package managers, three output shapes. npm keys a map by package name;
  // pnpm keys a map of advisories by id; yarn berry emits one JSON object per
  // line. Parsing only npm's shape reported "no result" for every repository that
  // does not use npm, which is most of them.
  let parsed
  try {
    parsed = JSON.parse(out)
  } catch {
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
    if (!lines.length) return { available: false, why: `${found.bin} audit output did not parse` }
    parsed = { _ndjson: lines }
  }

  const all = normaliseAudit(parsed)

  // What the package manager itself reports, kept beside ours.
  //
  // yarn counts dependency PATHS: one advisory reached three ways is three
  // "high". Ours counts distinct advisories, because that is the number of things
  // to go and fix — on Excalidraw, 187 paths against 55 problems. Both are true
  // and a client running `yarn audit` will see the larger one, so reporting only
  // ours reads as being wrong rather than as counting something else.
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 }
  for (const a of all) if (a.severity in counts) counts[a.severity] += 1
  const paths = pathCounts(parsed)
  // The denominator. A clean audit over nothing is not a clean audit, and the
  // manager says how much it looked at — npm reported `dependencies.total: 0` on a
  // project whose private registry did not resolve, and the pass printed a green
  // zero over it.
  const audited = auditedCount(parsed)
  if (audited === 0) {
    return {
      available: false,
      why: `${found.bin} audit ran and resolved 0 dependencies, so nothing was checked — the usual cause is a registry it cannot reach or a lockfile that was never installed from`,
    }
  }
  // The distinct count leads. npm's own summary already deduplicates, so the two
  // agree there and differ only where the manager counts paths.
  const final = counts

  return {
    available: true,
    manager: found.bin,
    // Travels with the counts, always. `undefined` where the manager does not say —
    // yarn berry reports no total — and unknown is reported as unknown rather than
    // quietly standing in for "checked everything".
    audited,
    // Where the audit actually ran. A package in a monorepo has no lockfile of
    // its own, so the audit covers the whole workspace — TanStack Query's
    // `packages/react-query` came back with 126 advisories, nearly all of them
    // from the docs site and the examples. True of the repository, not of the
    // package measured, and a client reading it as theirs will reject the report.
    scope: relative(target, found.at) === '' ? 'this package' : `the workspace at ${relative(target, found.at).split(sep).join('/') || '.'}, which is where the lockfile is`,
    scopeIsWider: relative(target, found.at) !== '',
    counts: final,
    paths,
    // Direct dependencies first: those are the ones this team can act on today.
    worst: all.filter(a => ['high', 'critical'].includes(a.severity))
      .sort((a, b) => (Number(b.direct) - Number(a.direct)) || ((b.severity === 'critical') - (a.severity === 'critical')))
      .slice(0, 10),
  }
})()

// ── 2. Secrets ────────────────────────────────────────────────────────────────
//
// Every entry has a fixed prefix or a checkable shape. "Looks like a password"
// is deliberately absent: on a real repository that pattern finds test fixtures,
// example configs and base64 images, and a team that sees three false secrets
// stops reading the fourth.

const SECRET_SHAPES = [
  { id: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, what: 'an AWS access key id' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, what: 'a GitHub token' },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g, what: 'a Slack token' },
  { id: 'stripe-key', re: /\b[sr]k_(live|test)_[0-9a-zA-Z]{24,}\b/g, what: 'a Stripe secret key' },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, what: 'a Google API key' },
  { id: 'openai-key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g, what: 'an OpenAI key' },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g, what: 'an Anthropic key' },
  { id: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, what: 'a private key block' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, what: 'a signed JWT' },
]

const gitleaks = (() => {
  for (const bin of ['gitleaks', join(target, 'node_modules', '.bin', 'gitleaks')]) {
    try {
      execFileSync(bin, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 })
      return bin
    } catch { /* next */ }
  }
  return undefined
})()

// The history, which the working tree cannot answer for.
//
// This pass reads the files that are here now. A secret committed in March and
// deleted in April is in the history, reachable by anybody who clones, and invisible
// to everything above — and the report has been naming that gap in its own caveats
// while doing nothing about it. Where the tool that reads history is installed, it is
// run; where it is not, the gap is named and still not filled.
//
// Delegated entirely, for the reason the dependency audit is: these rules are
// maintained by people who do this full time.
const history = (() => {
  if (!gitleaks) {
    return { available: false, why: 'gitleaks is not installed here, and nothing else in this tool reads git history — `brew install gitleaks`, or a release binary from github.com/gitleaks/gitleaks' }
  }
  if (!existsSync(join(target, '.git'))) {
    return { available: false, why: 'not a git repository, so there is no history to read' }
  }
  // Two clones that look identical and read completely differently.
  //
  // A full clone of 2,800 commits scans in under a second, so there is no size
  // threshold worth inventing here. What does not finish is a clone that does not
  // have its own objects: on a blobless clone gitleaks fetches every blob it needs
  // over the network, and a 10,000-commit repository ran past ten minutes without
  // completing. A shallow clone is the worse case — it finishes fast, and reports a
  // clean history for the handful of commits it happens to hold.
  //
  // Both are refused by name. A partial clone because the wait is unbounded; a
  // shallow one because a number over a truncated history is the exact shape this
  // tool exists to refuse.
  const gitSays = (...a) => {
    try {
      return execFileSync('git', ['-C', target, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { return '' }
  }
  if (gitSays('rev-parse', '--is-shallow-repository') === 'true') {
    const depth = gitSays('rev-list', '--count', 'HEAD') || 'some'
    return { available: false, why: `a shallow clone — only ${depth} commit(s) are here, and a clean result over those would say nothing about the rest` }
  }
  if (gitSays('config', '--get', 'remote.origin.partialclonefilter')) {
    return { available: false, why: 'a partial (blobless or treeless) clone — reading the history would fetch every blob over the network; re-clone in full, or run gitleaks where the objects are' }
  }
  let out = ''
  try {
    out = execFileSync(gitleaks, ['git', target, '--report-format', 'json', '--report-path', '/dev/stdout', '--no-banner', '--exit-code', '0'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const said = String(error.stdout ?? '') + String(error.stderr ?? '')
    if (!said.trim()) {
      return { available: false, why: `gitleaks refused: ${String(error.message).split('\n')[0].slice(0, 140)}` }
    }
    out = said
  }
  const start = out.indexOf('[')
  let findings = []
  try { findings = start === -1 ? [] : JSON.parse(out.slice(start, out.lastIndexOf(']') + 1)) } catch { findings = [] }
  return {
    available: true,
    total: findings.length,
    findings: findings.slice(0, 40).map(f => ({
      rule: f.RuleID ?? f.Description ?? 'unknown',
      file: f.File,
      commit: String(f.Commit ?? '').slice(0, 8),
      date: f.Date,
    })),
  }
})()

const secrets = []
for (const file of files) {
  // A committed .env is a finding regardless of its contents, and its contents
  // are exactly what should not be quoted into a report.
  if (/(^|\/)\.env(\.|$)/.test(rel(file)) && !/\.example$|\.sample$|\.template$/.test(rel(file))) {
    secrets.push({ file: rel(file), what: 'an environment file is committed', shape: 'dotenv', line: 0, mitigated: false })
    continue
  }
  const text = read(file)
  for (const shape of SECRET_SHAPES) {
    for (const m of text.matchAll(shape.re)) {
      const before = text.slice(0, m.index)
      const line = before.split('\n').length
      const lineText = text.split('\n')[line - 1] ?? ''
      // A placeholder in an example file is documentation, not a leak.
      const placeholder = /example|sample|placeholder|dummy|fake|your[-_]?key|xxx|<[a-z]/i.test(lineText)
      secrets.push({
        file: rel(file),
        line,
        what: shape.what,
        shape: shape.id,
        inTest: isTest(file),
        mitigated: placeholder,
        // The value is never recorded. A report that quotes the secret becomes
        // the second place it leaks.
        evidence: `${m[0].slice(0, 4)}…${m[0].length} characters`,
      })
    }
  }
}

// ── 3. Source patterns ────────────────────────────────────────────────────────
//
// Each one pairs a dangerous construct with the thing that makes it safe, so the
// finding is "this, without that" rather than "this". Anything needing to know
// where a value came from is out of scope and said so below.

// Escaping and sanitising, by any of the names people give them. The first
// version of this list was case-sensitive and spelled `escapeHtml`, so a file
// calling `escapeHTML` was reported as injecting raw markup — a false positive on
// code that was doing exactly the right thing, and the fastest way to teach a
// team that this report is not worth reading.
const SANITISERS = /DOMPurify|sanitize-?html|\bsanitiz|\bxss\(|escape-?html|html-?escape|encode-?html|\bpurify/i

// Renderers that produce markup and carry their own switch for escaping it.
// memos injects mermaid's SVG output, which reads as raw HTML injection and is
// configured three lines earlier with `securityLevel: "strict"` — mermaid's own
// mitigation, and the same kind of thing as wrapping the value in DOMPurify.
// Not recognising it meant reporting a project for a decision it had made
// correctly, which is how a security report gets ignored.
const RENDERER_GUARDS = /securityLevel\s*:\s*["'](strict|antiscript)["']|sanitize\s*:\s*true|allowDangerousHtml\s*:\s*false|\bskipHtml\b/

const patterns = []
for (const file of source) {
  const text = read(file)
  const lines = text.split('\n')

  /**
   * Whether the value being injected here is one this file escaped.
   *
   * A file-level "is there a sanitiser anywhere in this text" is too coarse in
   * both directions: it forgives a file that escapes one value and not another,
   * and it has nothing to say when the escape is two lines up. So the identifier
   * is pulled out of the injection and its assignment is looked at.
   */
  const valueIsEscaped = (lineText) => {
    const name = /__html:\s*([A-Za-z_$][\w$]*)|innerHTML\s*=\s*([A-Za-z_$][\w$]*)|outerHTML\s*=\s*([A-Za-z_$][\w$]*)/.exec(lineText)
    const id = name?.[1] ?? name?.[2] ?? name?.[3]
    if (!id) return SANITISERS.test(lineText)
    const assignment = new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=([^\\n]*)`).exec(text)
    if (assignment && SANITISERS.test(assignment[1])) return true
    // The renderer that produced the value carries the guard instead.
    if (RENDERER_GUARDS.test(text)) return true
    // A value the file never assigns comes from outside it, and this pass cannot
    // follow it. Reported rather than forgiven.
    return SANITISERS.test(lineText)
  }

  const add = (i, id, what, why, mitigated = false) => patterns.push({
    file: rel(file), line: i + 1, id, what, why, inTest: isTest(file), mitigated,
    snippet: lines[i].trim().slice(0, 100),
  })

  /**
   * The line with its literals blanked out, so a construct NAMED is not read as a
   * construct USED.
   *
   * This pass reported `raw-html` against its own detector: line 411 of this file is
   * `if (/dangerouslySetInnerHTML/.test(lineText)) {`, and the name inside the regex
   * matched the regex looking for it. It is not a quirk of scanning ourselves —
   * every project with a lint rule, a codemod, a migration script or a README about
   * the same construct gets the same finding, and a security report whose first
   * entry is the reader's own safety tooling is one nobody finishes.
   *
   * Quotes and template literals go too: `"use dangerouslySetInnerHTML with care"` is
   * prose. A regex literal is only recognised where one can legally start, so `a / b
   * / c` stays arithmetic and the line keeps being checked — this errs toward
   * reporting, which is the right way for it to err.
   */
  const codeOnly = (text) => {
    let out = ''
    let quote
    let inRegex = false
    // The last non-space character emitted, carried rather than searched for.
    //
    // It used to be `out.replace(/\s+$/, '').slice(-1)` — a scan of everything
    // written so far, on every character, which is quadratic in the length of the
    // line. Ordinary code never notices. `documenso` has a 2.5-million-character line
    // holding an inlined SVG, and that one line took this pass past four minutes:
    // `ds assess` on a real client application stopped finishing at all, and the
    // first thing a consultant would have seen on arrival was a hang with no output.
    let prev = ''
    for (let k = 0; k < text.length; k += 1) {
      const c = text[k]
      if (quote) {
        out += ' '
        if (c === quote && text[k - 1] !== '\\') quote = undefined
        continue
      }
      if (inRegex) {
        out += ' '
        if (c === '/' && text[k - 1] !== '\\') inRegex = false
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; out += ' '; continue }
      if (c === '/' && (prev === '' || '(=,:!&|?{[;+'.includes(prev))) { inRegex = true; out += ' '; continue }
      out += c
      if (!/\s/.test(c)) prev = c
    }
    return out
  }

  lines.forEach((raw, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return
    const lineText = codeOnly(raw)

    if (/dangerouslySetInnerHTML/.test(lineText)) {
      add(i, 'raw-html', 'HTML injected into the DOM without escaping',
        'the value becomes markup; if any part of it is user-supplied this is stored XSS',
        valueIsEscaped(lineText))
    }
    if (/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/.test(lineText)) {
      // A script element being filled is a different finding from a div being
      // filled, and grouping them understates it. memos does both, three lines
      // apart: the style injection is a defaced page, the script injection is
      // arbitrary code with the session's privileges.
      //
      // Which element it is has to be tracked, not guessed from nearby words. A
      // first version searched the preceding lines for "script" and classified
      // `el.innerHTML = html` as code execution because the function above it took
      // a parameter called `script`.
      const assignee = /^\s*([A-Za-z_$][\w$]*)\s*\.(inner|outer)HTML/.exec(lineText)?.[1]
      const intoScript = Boolean(assignee) && new RegExp(
        `\\b${assignee}\\s*=\\s*document\\.createElement\\s*\\(\\s*["'\`]script["'\`]`).test(text)
      if (intoScript) {
        add(i, 'script-injection', 'a <script> element filled from a value',
          'this is not markup injection, it is code execution: whatever can write that value runs code as every visitor',
          // Escaping does not make this safe. A <script> body is code whether or
          // not its angle brackets were escaped, so the mitigation that applies to
          // markup injection does not apply here.
          false)
      } else {
        add(i, 'raw-html', 'markup assigned directly to the DOM',
          'the value becomes markup, and it bypasses the framework\'s escaping entirely',
          valueIsEscaped(lineText))
      }
    }
    if (/\beval\s*\(|new\s+Function\s*\(/.test(lineText)) {
      add(i, 'dynamic-code', 'code built at runtime and executed',
        'anything reaching this executes with the page\'s full privileges')
    }
    if (/target\s*=\s*["']_blank["']/.test(lineText) && !/rel\s*=\s*["'][^"']*noopener/.test(lineText)) {
      // React 16+ adds rel=noopener itself for JSX; a template string or plain
      // HTML file gets no such help.
      const jsx = /\.[jt]sx$/.test(file)
      add(i, 'tabnabbing', 'a new tab opened without rel="noopener"',
        'the opened page can navigate this one through window.opener', jsx)
    }
    if (/https?:\/\//.test(lineText) && /^\s*(const|let|var|.*:)\s/.test(lineText)
      && /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(lineText)) {
      add(i, 'cleartext', 'a plaintext http:// endpoint',
        'credentials and payloads on this route travel unencrypted')
    }
    if (/postMessage\s*\([^)]*,\s*["']\*["']/.test(lineText)) {
      add(i, 'postmessage-wildcard', 'postMessage to any origin',
        'whatever is in that message is readable by whatever page happens to be framed')
    }
    if (/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/.test(lineText)) {
      add(i, 'tls-off', 'certificate verification switched off',
        'this makes every connection from here interceptable')
    }
    if (/\b(exec|execSync)\s*\(\s*[`'"][^`'"]*\$\{/.test(lineText)) {
      add(i, 'shell-injection', 'a shell command built by string interpolation',
        'a value with a semicolon in it becomes a second command; execFile takes an argument array instead')
    }
    if (/\bMath\.random\s*\(\)/.test(lineText) && /token|secret|nonce|salt|password|key|otp|session/i.test(lineText)) {
      add(i, 'weak-random', 'Math.random used for something that looks like a credential',
        'it is predictable; crypto.randomUUID and crypto.getRandomValues are not')
    }
  })
}

// ── Assemble ──────────────────────────────────────────────────────────────────

const live = (list) => list.filter(f => !f.mitigated && !f.inTest)
const liveSecrets = live(secrets)
const livePatterns = live(patterns)

const name = scanSlot(target)
const outDir = join(root, 'scans', name)
mkdirSync(outDir, { recursive: true })

const report = {
  schemaVersion: 1,
  // Which rules counted this, and when. Read back by anything that trusts the
  // numbers below: a scan taken under older rules is not a current fact.
  taken: taken(import.meta.url, target),
  target,
  counts: {
    // null, never 0, where a check could not run. Every other pass here learned
    // this the same way: a zero reads as "looked and found none".
    dependencyAdvisories: dependencies.available ? (dependencies.counts.critical + dependencies.counts.high) : null,
    secrets: liveSecrets.length,
    sourceFindings: livePatterns.length,
    mitigated: secrets.filter(s => s.mitigated).length + patterns.filter(p => p.mitigated).length,
    inTestsOnly: secrets.filter(s => s.inTest && !s.mitigated).length + patterns.filter(p => p.inTest && !p.mitigated).length,
  },
  limits: {
    dependencies: dependencies.available
      ? `${dependencies.manager} audit over ${dependencies.scope}. Counted as DISTINCT advisories, which is the number of things to fix; ${dependencies.manager} itself counts dependency paths and will show a larger figure${dependencies.paths ? ` — ${dependencies.paths.high + dependencies.paths.critical} high or critical paths against ${dependencies.counts.high + dependencies.counts.critical} problems` : ''}. An advisory is about a published version, not about whether this project reaches the vulnerable code.`
      : `NOT RUN — ${dependencies.why}. This is not a clean result; it is no result.`,
    secrets: gitleaks
      ? 'gitleaks is installed here and should be run over the git history as well: this pass reads the working tree, and a secret removed in a later commit is still in the history.'
      : 'Shapes with a fixed prefix or a checkable form only — no entropy heuristics, which on real repositories find test fixtures and base64 images. The working tree only: a secret committed and later deleted is still in the history and invisible here. gitleaks over the full history is the tool for that.',
    source: 'Text, not data flow. Each finding pairs a construct with the mitigation that would make it fine, but whether a value is actually attacker-controlled needs taint analysis this does not do. Authorisation, session handling, CSRF, SSRF and anything server-side are out of scope entirely.',
    notCovered: [
      'authorisation and access control — the logic is the product, and no static pass reads intent',
      'CSRF, SSRF, path traversal, SQL injection — these need to follow a value from its source',
      'infrastructure, container images, CI secrets, deployed configuration',
      ...(history.available ? [] : ['the git history, unless gitleaks is run over it separately']),
    ],
  },
  dependencies,
  secrets: secrets.slice(0, 40),
  source: patterns.slice(0, 60),
  gitleaksAvailable: Boolean(gitleaks),
  // The denominator every count above is a number over. Printed one line under
  // the counts since the first version, and dropped from the artifact until a
  // fixture with zero readable files reported zero secrets and zero dangerous
  // patterns — both true, both unrelated to whether this repository has any.
  considered: { files: files.length },
  history,
}
writeFileSync(join(outDir, 'security.json'), JSON.stringify(report, null, 2) + '\n')

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\nsecurity: ${target}`)
console.log(`${files.length} file(s) read\n`)

const line = (label, value, note) => console.log(`  ${String(value).padStart(5)}  ${label}${note ? `  — ${note}` : ''}`)

if (dependencies.available) {
  const c = dependencies.counts
  // Two counts, and they are not the same number. `counts` is distinct advisories —
  // the number of things to go and fix — and `paths` is what the manager itself
  // reports, which counts a dependency reached three ways as three. Both are true and
  // a client running the command sees the second, so both travel.
  //
  // This printed the DISTINCT headline over the PATH breakdown and labelled the whole
  // line "distinct": on a real yarn repository that read `3 dependency advisories —
  // critical 1 · high 2 · moderate 3`, where the breakdown sums to six. A line whose
  // own numbers disagree is one a reader stops trusting entirely, and rightly.
  if (dependencies.audited === undefined) {
    console.log(`      ?  ${dependencies.manager} did not say how many dependencies it checked, so the counts below have no denominator`)
  }
  line('dependency advisories', c.critical + c.high,
    `critical ${c.critical} · high ${c.high} · moderate ${c.moderate} · low ${c.low} distinct, from ${dependencies.manager} audit`)
  if (dependencies.paths) {
    const p = dependencies.paths
    const total = p.critical + p.high + p.moderate + p.low
    if (total !== c.critical + c.high + c.moderate + c.low) {
      console.log(`         ${dependencies.manager} itself reports ${total} — it counts dependency PATHS, and one advisory reached`)
      console.log('         three ways is three there and one thing to fix here. Both are true.')
    }
  }
  if (dependencies.scopeIsWider) {
    console.log(`         covering ${dependencies.scope} — not this package's dependencies alone`)
  }
  if (dependencies.paths && dependencies.paths.high + dependencies.paths.critical !== c.high + c.critical) {
    console.log(`         ${dependencies.manager} itself reports ${dependencies.paths.critical + dependencies.paths.high} — it counts dependency paths, one advisory reached several ways`)
  }
} else {
  console.log(`      —  dependency advisories  — NOT RUN: ${dependencies.why}`)
}
// Never a zero where nothing was read. A history that was not scanned is not a
// history with nothing in it, and it is the number a reader is most likely to take
// for a clean bill.
if (history.available) {
  line('secrets in the git history', history.total,
    `gitleaks over every commit reachable from here${history.total ? '; a secret deleted later is still in the history' : ''}`)
} else {
  console.log(`      —  secrets in the git history  — NOT RUN: ${history.why}`)
}
line('secrets in the working tree', liveSecrets.length, 'shapes with a fixed prefix, working tree only')
line('dangerous source patterns', livePatterns.length, 'each one without the mitigation that would make it fine')
if (report.counts.mitigated) line('mitigated, not counted', report.counts.mitigated, 'a sanitiser in the same file, or a documented placeholder')
if (report.counts.inTestsOnly) line('in tests only, not counted', report.counts.inTestsOnly, 'still worth a look; a fixture key is often a real key')

if (dependencies.available && dependencies.worst.length) {
  console.log('\nWORST ADVISORIES — direct dependencies first, because those are actionable today')
  for (const a of dependencies.worst.slice(0, 6)) {
    console.log(`  ${a.severity.padEnd(9)} ${a.package.padEnd(28)} ${a.direct ? 'direct' : 'transitive'}${a.fixAvailable ? ' · a fix exists' : ' · no fix published'}`)
    if (a.via[0]) console.log(`            ${a.via[0].slice(0, 90)}`)
  }
}

if (liveSecrets.length) {
  console.log('\nSECRETS — the value is never printed here, only where it is')
  for (const s of liveSecrets.slice(0, 10)) {
    console.log(`  ${s.file}:${s.line}  ${s.what} (${s.evidence ?? 'file present'})`)
  }
  console.log('\n  Rotate before removing. A key deleted from the working tree is still in the')
  console.log('  history and still valid.')
}

if (livePatterns.length) {
  const byId = {}
  for (const p of livePatterns) (byId[p.id] ??= []).push(p)
  console.log('\nSOURCE — construct, and what would make it fine')
  for (const [id, list] of Object.entries(byId).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(3)}  ${id.padEnd(20)} ${list[0].what}`)
    console.log(`       ${list[0].why}`)
    for (const p of list.slice(0, 2)) console.log(`       ${p.file}:${p.line}  ${p.snippet}`)
  }
}

console.log('\nWHAT THIS DID NOT LOOK AT')
for (const l of report.limits.notCovered) console.log(`  · ${l}`)

console.log(`\nwritten to scans/${name}/security.json`)
