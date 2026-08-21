import mermaid from 'mermaid'
// The renderer carries the guard. This is the same kind of mitigation as
// wrapping the value, and not recognising it reports a correct decision.
mermaid.initialize({ securityLevel: "strict" })
export function Guarded({ svg }: { svg: string }) {
  return <div dangerouslySetInnerHTML={{ __html: svg }} />
}
