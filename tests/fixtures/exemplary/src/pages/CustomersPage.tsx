import { useEffect, useState } from 'react'

export function CustomersPage() {
  const [rows, setRows] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/Customers').then(r => r.json()).then(setRows)
  }, [])

  return (
    <main className="Customers">
      {rows.map(r => <p key={r}>{r}</p>)}
    </main>
  )
}
