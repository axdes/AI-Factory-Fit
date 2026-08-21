/**
 * The ways an agent really breaks code, as transforms.
 *
 * Extracted from the red-team pass so more than one thing can use them. That pass
 * mutates the reference solutions in this repository's own corpus and fails when a
 * break survives; the same operators answer a different and narrower question about
 * a generated file:
 *
 *   `ds eval`      does OUR ruleset discriminate, on OUR corpus
 *   `evals-gen`    would the installed gate catch a break of THEIR reference file
 *   this           would it catch a break of the file we have just written INTO their
 *                  repository, which neither of the other two touches
 *
 * The third is the one that goes stale silently. A generator that regresses and starts
 * emitting a default export into a named-export project is caught by a unit test here
 * and by nothing in the client's repository — and the client's gate is the only thing
 * standing between the next agent and the same mistake.
 *
 * Each operator says which check is supposed to catch it. A break that survives names
 * a hole, and the hole is the finding: never a break to delete.
 */

export const OPERATORS = [
  {
    id: 'union-value-invented',
    catchBy: 'values in union',
    what: 'a variant value that is not in the component union',
    apply: (src) => src.replace(/\b(variant|tone|size|fill|shape|status|appearance)="([^"]+)"/, (m, prop) => `${prop}="totallyMadeUp"`),
  },
  {
    id: 'prop-invented-with-value',
    catchBy: 'props declared',
    what: 'a prop the component does not declare, with a value',
    apply: (src) => src.replace(/<([A-Z]\w*)\b/, '<$1 elevation="2"'),
  },
  {
    id: 'prop-invented-boolean',
    catchBy: 'props declared',
    what: 'a prop the component does not declare, as boolean shorthand',
    apply: (src) => src.replace(/<([A-Z]\w*)\b/, '<$1 rounded'),
  },
  {
    id: 'component-not-in-registry',
    catchBy: 'components exist',
    what: 'a component imported from the system that the system does not have',
    apply: (src) => src.replace(/import \{ (\w+) \} from '@ds\/(\w+)'/, "import { GhostPanel } from '@ds/GhostPanel'")
      .replace(/<(\w+)([\s/>])/, (m, name, tail) => (/^[A-Z]/.test(name) ? `<GhostPanel${tail}` : m)),
  },
  {
    id: 'literal-colour',
    catchBy: 'no literal values',
    what: 'a literal colour where the system has tokens',
    apply: (src) => src.replace(/<([A-Z]\w*)\b/, '<$1 style={{ color: \'#d32f2f\' }}'),
  },
  {
    id: 'literal-size',
    catchBy: 'no literal values',
    what: 'a literal size where the system has a scale',
    apply: (src) => src.replace(/<([A-Z]\w*)\b/, '<$1 style={{ padding: \'12px\' }}'),
  },
  {
    id: 'default-export',
      // Catchable only where this project enforces the dimension. A leaning is not
      // held against new code by design.
      needs: 'component export',
    catchBy: 'conventions',
    what: 'a default export where the repository uses named',
    apply: (src) => src.includes('export function')
      ? src.replace('export function', 'export default function') : undefined,
  },
  {
    id: 'interface-props',
      // Catchable only where this project enforces the dimension. A leaning is not
      // held against new code by design.
      needs: 'props declaration',
    catchBy: 'conventions',
    what: 'props declared as an interface where the repository uses a type',
    apply: (src) => src.includes('type Props =')
      ? src.replace(/type Props = \{/, 'interface Props {').replace(/\}\n\nexport/, '}\n\nexport') : undefined,
  },
  {
    id: 'handler-renamed',
      // Catchable only where this project enforces the dimension. A leaning is not
      // held against new code by design.
      needs: 'handler naming',
    catchBy: 'conventions',
    what: 'a handler named against the repository convention',
    apply: (src) => /const on[A-Z]/.test(src)
      ? src.replace(/const on([A-Z]\w*)/g, 'const handle$1').replace(/\bon([A-Z]\w*)\}/g, 'handle$1}')
        .replace(/onClick=\{on([A-Z]\w*)\}/g, 'onClick={handle$1}') : undefined,
  },
  {
    id: 'icon-button-unnamed',
    catchBy: 'accessibility floor',
    what: 'an accessible name removed from an icon-only control',
    // Only where the label is the ONLY name the element has. This removed any
    // `aria-label` it found, and on a generated screen the first one belongs to a
    // `<section>` — stripping a region label is not an unnamed control, the
    // accessibility floor was right to stay quiet, and the operator was reported as
    // surviving a check it had never given anything to catch.
    apply: (src) => {
      const m = /<\w+[^>]*\saria-label="[^"]*"[^>]*\/>/.exec(src)
      return m ? src.replace(m[0], m[0].replace(/\s*aria-label="[^"]*"/, '')) : undefined
    },
  },
  {
    id: 'click-on-div',
    catchBy: 'accessibility floor',
    what: 'interactive behaviour moved onto a non-interactive element',
    apply: (src) => src.includes('<div')
      ? src.replace('<div', '<div onClick={() => {}}') : undefined,
  },
  {
    id: 'image-without-alt',
    catchBy: 'accessibility floor',
    what: 'an image with no alternative text',
    apply: (src) => src.replace(/<([A-Z]\w*)([^>]*)\/>/, '<img src="/x.png" />\n      <$1$2/>'),
  },
]
