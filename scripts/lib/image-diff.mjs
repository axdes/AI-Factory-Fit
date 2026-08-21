/**
 * Baseline image comparison.
 *
 * Kept as a module so it can be tested without a browser. The capture half of a
 * visual check needs Chromium and a running app; the comparison half is the part
 * that decides pass or fail, and it was previously not written at all — the gate
 * took a screenshot, put it next to the baseline and exited zero. A check that
 * cannot fail is not a check, and it is worse than none because the summary
 * counts it as passing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Compares a captured PNG against its baseline.
 *
 * @param {object} options
 * @param {string} options.baselinePath the accepted image
 * @param {Buffer}  options.captured     what was just rendered
 * @param {string} [options.diffPath]    where to write the difference image
 * @param {number} [options.tolerance]   share of pixels allowed to differ (0..1)
 * @param {number} [options.threshold]   per-pixel colour sensitivity (0..1)
 * @returns {{status: string, changedPixels?: number, ratio?: number, reason?: string}}
 */
export function compareToBaseline({ baselinePath, captured, diffPath, tolerance = 0.001, threshold = 0.1 }) {
  let PNG, pixelmatch
  try {
    ({ PNG } = require('pngjs'))
    pixelmatch = require('pixelmatch')
    if (typeof pixelmatch !== 'function') pixelmatch = pixelmatch.default
  } catch {
    return { status: 'unavailable', reason: 'pixelmatch and pngjs are not installed' }
  }

  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, captured)
    return { status: 'recorded' }
  }

  const before = PNG.sync.read(readFileSync(baselinePath))
  const after = PNG.sync.read(captured)

  // A size change is a layout change. Comparing pixel by pixel across different
  // dimensions is meaningless, so it is reported as its own outcome rather than
  // as a large diff.
  if (before.width !== after.width || before.height !== after.height) {
    return {
      status: 'resized',
      reason: `${before.width}×${before.height} became ${after.width}×${after.height}`,
    }
  }

  const diff = new PNG({ width: before.width, height: before.height })
  const changedPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold })
  const ratio = changedPixels / (before.width * before.height)

  if (ratio > tolerance) {
    if (diffPath) writeFileSync(diffPath, PNG.sync.write(diff))
    return { status: 'changed', changedPixels, ratio }
  }
  return { status: 'unchanged', changedPixels, ratio }
}
