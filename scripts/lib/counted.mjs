/**
 * A count is a number only when something was counted.
 *
 * This is the law the rest of the tool is built on, applied to the tool itself.
 * It was found the way every other defect here was found — by reading a real
 * result and not believing it. On a fixture holding one Python file, `ds assess`
 * printed:
 *
 *     0  contrast pairs below WCAG AA 4.5:1
 *     0  tokens declared and never referenced
 *     0  literal colour and size values outside token files
 *     0  modules built twice
 *     0  secrets in the working tree
 *     0  dangerous source patterns without their mitigation
 *
 * Six greens over a repository from which zero files had been read. Only the two
 * dimensions that had been made fail-closed one at a time — accessibility and
 * dependency advisories — said NOT RUN. The rest said nothing was wrong, which is
 * true, and unrelated to whether anything is wrong.
 *
 * The denominators were never missing. `defects.mjs` prints `0 owned file(s) · 0
 * token(s) declared` and `security.mjs` prints `0 file(s) read`, one line above
 * the zeros. They were computed, shown to whoever was watching the terminal, and
 * dropped before the JSON — and the JSON is what the HTML report, the evidence
 * pack, the assessment summary and every downstream reader actually read. The
 * casual reader got the truth; the client-facing artifact did not.
 *
 * So the denominator travels with the count now, and one place decides whether a
 * number may be shown. Sixteen of twenty-four recorded scans compared zero colour
 * pairs — on Tailwind and CSS-in-JS projects the pass has nothing to look at —
 * and all sixteen reported "0 contrast failures", green.
 */

/**
 * @param count       what the detector found, or null if it never ran
 * @param considered  how many things it looked at
 * @param unit        what those things are, for the sentence
 * @param why         an explicit reason, when the pass knows one better than the count
 */
export function counted(count, considered, unit, why) {
  if (count === null || count === undefined) {
    return { ran: false, why: why ?? 'the check did not run' }
  }
  if (!considered) {
    // "0 pair were read" is what a template that never learned plurals produces, and
    // it is the line a client reads. One place makes the word agree, because every
    // caller passes a singular unit and none of them should have to think about it.
    return { ran: false, why: why ?? `nothing to count — no ${unit === 'files' ? 'file' : unit}s were read` }
  }
  return { ran: true, count, considered, unit }
}

/** The same decision, rendered for a fixed-width terminal column. */
export function countedLine(label, c, note) {
  return c.ran
    ? `  ${String(c.count).padStart(5)}  ${label}${note ? `  — ${note}` : ''}`
    : `      —  ${label}  — NOT RUN: ${c.why}`
}
