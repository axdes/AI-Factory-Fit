import AppShell from '@/components/AppShell'
import { DataTable } from '@/ui/table'

export function ArchivedPage() {
  return (
    <AppShell icon={null} title="Archived">
      <div className="archived">
        <DataTable rows={[]} />
      </div>
    </AppShell>
  )
}
