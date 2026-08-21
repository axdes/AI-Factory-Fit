import { AppShell } from '../AppShell'
import { SettingsForm } from './SettingsForm'

export default function SettingsPage() {
  return (
    <AppShell title="Settings" icon={null}>
      <SettingsForm />
    </AppShell>
  )
}
