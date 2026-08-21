/**
 * A visual language read off a picture.
 *
 * The one entry a client always has. A site can be crawled and a Figma file can be
 * queried, but half of them hand you a PDF brandbook or a screenshot of the thing
 * they already ship, and there was no path from either into anything here.
 *
 * What this reads is deliberately the part that turned out to be load-bearing: the
 * FRAME and the RHYTHM. Measured across three real products, a screen's shape is
 * carried by the frame it sits in, and the thing that makes a generated stylesheet
 * read as foreign is the spacing scale, not the palette. A palette is the easy half
 * and everybody extracts it.
 *
 * What it must NOT do, and the reason each is refused:
 *
 *   name a colour        `#1A73E8` is a colour. Calling it `--colour-primary` is a
 *                        claim about intent that a picture cannot carry, and a token
 *                        layer built on invented names is one the team rejects on
 *                        sight.
 *   report components    a picture has no components in it. A box that looks like a
 *                        button is a box.
 *   pretend it is the    one viewport, one theme, one moment. Every number here is
 *   whole system         qualified by that, in the output rather than in a footnote.
 *
 * Anti-aliasing means a flat area is never one colour: a screenshot of a white page
 * holds two hundred near-whites. They are merged, and the distance used to merge
 * them travels with the result — a reader who disagrees with the threshold can see
 * what it was.
 */

/**
 * A colour is kept when it covers this much of the picture, however close it lies to
 * another.
 *
 * The first version merged by distance alone at twelve units per channel, and
 * `#ffffff` is twenty units from `#f7f8fa` — so a white card on an off-white page was
 * absorbed into the page. That is precisely the defect the layout pass exists to
 * catch, reproduced here by the reader meant to find it: the column came back as the
 * width of the text rather than the width of the card, and the rhythm as the space
 * between paragraphs rather than between sections.
 *
 * Anti-aliasing produces many shades and each of them is rare. A colour covering a
 * fiftieth of the page is a colour somebody chose.
 */
export const KEEP_SHARE = 0.002

/** How far a rare shade may sit from a kept colour before it is left on its own. */
export const MERGE_DISTANCE = 12

const key = (r, g, b) => (r << 16) | (g << 8) | b
const hex = (r, g, b) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
const distance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
const near = (a, b) => distance(a, b) <= MERGE_DISTANCE * 3

/**
 * @param png  a decoded PNG: { width, height, data } as pngjs produces
 * @returns what can be measured, and what could not be
 */
export function readImage(png) {
  const { width, height, data } = png
  const at = (x, y) => {
    const i = (y * width + x) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
  }

  // ── The palette, by share of the picture ────────────────────────────────────
  const counts = new Map()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = at(x, y)
      if (p.a < 128) continue
      const k = key(p.r, p.g, p.b)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  const raw = [...counts].map(([k, n]) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, n }))
    .sort((a, b) => b.n - a.n)

  // Frequent colours stay distinct; rare shades fold into the nearest one that is
  // not. Folding by proximity alone is what lost the card.
  const pixels = raw.reduce((s, c) => s + c.n, 0)
  const merged = raw.filter(c => c.n / pixels >= KEEP_SHARE).map(c => ({ ...c }))
  for (const c of raw) {
    if (c.n / pixels >= KEEP_SHARE) continue
    const into = merged.filter(m => near(m, c)).sort((a, b) => distance(a, c) - distance(b, c))[0]
    if (into) into.n += c.n
    else merged.push({ ...c })
  }
  merged.sort((a, b) => b.n - a.n)
  const total = merged.reduce((s, c) => s + c.n, 0)
  const palette = merged.slice(0, 12).map(c => ({ hex: hex(c.r, c.g, c.b), share: c.n / total }))

  // ── The page ground ─────────────────────────────────────────────────────────
  //
  // Taken from the edges rather than from the whole picture. The commonest colour
  // overall is the page ground on a sparse page and the CARD colour on a dense one,
  // and confusing those two is the exact defect the layout pass exists to catch:
  // white cards invisible on a white page.
  const edge = new Map()
  const sample = (x, y) => {
    const p = at(x, y)
    if (p.a < 128) return
    const k = key(p.r, p.g, p.b)
    edge.set(k, (edge.get(k) ?? 0) + 1)
  }
  for (let x = 0; x < width; x += 1) { sample(x, 0); sample(x, height - 1) }
  for (let y = 0; y < height; y += 1) { sample(0, y); sample(width - 1, y) }
  const groundKey = [...edge].sort((a, b) => b[1] - a[1])[0]?.[0]
  const ground = groundKey === undefined ? undefined
    : hex((groundKey >> 16) & 255, (groundKey >> 8) & 255, groundKey & 255)

  // Ground is the ground colour and its anti-aliased neighbours, and nothing else. A
  // tolerance wide enough to swallow the next real colour is what turned a card into
  // a page.
  const groundRgb = ground && { r: parseInt(ground.slice(1, 3), 16), g: parseInt(ground.slice(3, 5), 16), b: parseInt(ground.slice(5, 7), 16) }
  const isGround = (x, y) => {
    if (!groundRgb) return false
    return distance(at(x, y), groundRgb) <= 6
  }

  // ── The reading column ──────────────────────────────────────────────────────
  //
  // The left and right edges beyond which nothing is drawn. A page that caps its
  // content at 1024 and a page that runs to the window are different products, and
  // the cap is invisible to anything reading one screen's markup.
  let left = width, right = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (!isGround(x, y)) { if (x < left) left = x; break }
    for (let x = width - 1; x >= 0; x -= 1) if (!isGround(x, y)) { if (x > right) right = x; break }
  }
  const column = right >= left ? { left, right, width: right - left + 1 } : undefined

  // ── The vertical rhythm ─────────────────────────────────────────────────────
  //
  // Runs of ground-coloured rows between bands of content. These gaps are the
  // spacing scale as shipped, which is the half that makes a generated stylesheet
  // read as native or foreign — and the half a palette extractor never sees.
  const rowIsEmpty = []
  for (let y = 0; y < height; y += 1) {
    let empty = true
    for (let x = 0; x < width; x += 1) if (!isGround(x, y)) { empty = false; break }
    rowIsEmpty.push(empty)
  }
  const gaps = []
  let run = 0
  for (let y = 0; y < height; y += 1) {
    if (rowIsEmpty[y]) run += 1
    else { if (run > 0) gaps.push(run); run = 0 }
  }
  const gapCounts = new Map()
  // The leading and trailing runs are the page margin, not a gap between things.
  for (const g of gaps.slice(1)) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1)
  const rhythm = [...gapCounts].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([px, times]) => ({ px, times }))

  const unresolved = []
  if (!ground) unresolved.push('the page ground: every edge pixel is transparent')
  if (!column) unresolved.push('the reading column: nothing is drawn on this image')
  if (!rhythm.length) unresolved.push('the vertical rhythm: no run of empty rows separates anything')

  return {
    width, height,
    ground,
    palette,
    column,
    rhythm,
    mergeDistance: MERGE_DISTANCE,
    unresolved,
    // Carried with the result rather than left to the reader to remember.
    limits: [
      'One viewport, one theme, one moment. A picture cannot say what happens at another width.',
      'Colours are colours. Nothing here names one: intent is not visible in pixels.',
      'No components. A box that looks like a button is a box.',
      `Colours covering at least ${KEEP_SHARE * 100}% of the picture are kept apart however close they lie; rarer shades fold into the nearest kept colour within ${MERGE_DISTANCE} per channel.`,
    ],
  }
}
