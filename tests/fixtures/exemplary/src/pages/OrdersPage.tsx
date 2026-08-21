import { useEffect, useState } from 'react'

function OrdersPage() {
  const [rows, setRows] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/Orders').then(r => r.json()).then(setRows)
  }, [])

  return (
    <main className="Orders">
      {rows.map(r => <p key={r}>{r}</p>)}
    </main>
  )
}

export default OrdersPage
