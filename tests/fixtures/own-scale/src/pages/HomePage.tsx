import './HomePage.css'
import AppShell, { ShellChip } from '@/components/AppShell'
import { PageHeading } from '@/ui/heading'

export function HomePage() {
  return (
    <AppShell icon={null} title="Home">
      <div className="home">
        <PageHeading>Home</PageHeading>
        <ShellChip />
      </div>
    </AppShell>
  )
}
