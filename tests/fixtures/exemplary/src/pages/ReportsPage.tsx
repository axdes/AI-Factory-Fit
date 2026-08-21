import { useEffect, useState } from 'react'

export function ReportsPage() {
  const [rows, setRows] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reports')
      .then(r => r.json())
      .then(setRows)
      .catch(() => setError('The reports could not be loaded.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <main className="reports">Loading…</main>
  if (error) return <main className="reports" role="alert">{error}</main>
  if (rows.length === 0) return <main className="reports">Nothing to report yet.</main>

  return (
    <main className="reports">
      {rows.map(r => <p key={r}>{r}</p>)}
    </main>
  )
}
