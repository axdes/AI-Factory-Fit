export function AppShell({ title, icon, children }: { title: string, icon?: React.ReactNode, children: React.ReactNode }) {
  return <main className="shell"><h1>{icon}{title}</h1>{children}</main>
}
