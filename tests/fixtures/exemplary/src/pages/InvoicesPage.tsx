import { useEffect, useState } from 'react'

export function InvoicesPage() {
  const [rows, setRows] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/Invoices').then(r => r.json()).then(setRows)
  }, [])

  return (
    <main className="Invoices">
      {rows.map(r => <p key={r}>{r}</p>)}
    </main>
  )
}
