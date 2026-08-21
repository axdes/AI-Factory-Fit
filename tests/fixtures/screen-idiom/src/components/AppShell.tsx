import type { ReactNode } from 'react'

interface Props {
  title: string
  /* Optional: the component compiles without it, and every screen here passes one. */
  icon?: ReactNode
  children: ReactNode
}

export function ShellChip() {
  return <span className="shell__chip" />
}

export default function AppShell({ title, icon, children }: Props) {
  return (
    <main className="shell">
      <h1>{icon}{title}</h1>
      {children}
    </main>
  )
}
