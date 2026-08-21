// Escaped by a function this file calls, spelled the way people actually spell
// it. A case-sensitive `escapeHtml` pattern reported this as raw injection.
import { escapeHTML } from './escape'

export function Safe({ code }: { code: string }) {
  const rendered = escapeHTML(code)
  return <code dangerouslySetInnerHTML={{ __html: rendered }} />
}
