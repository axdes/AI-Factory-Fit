export function Unsafe({ html, script }: { html: string; script: string }) {
  const el = document.createElement("div")
  el.innerHTML = html
  const scriptEl = document.createElement("script")
  scriptEl.innerHTML = script
  return <div />
}
