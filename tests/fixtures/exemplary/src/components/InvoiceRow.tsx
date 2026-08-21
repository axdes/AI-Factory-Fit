import './InvoiceRow.css'
import { formatMoney } from '../lib/money'

type Props = {
  id: string
  total: number
  onOpen: (id: string) => void
}

export function InvoiceRow({ id, total, onOpen }: Props) {
  const handleClick = () => onOpen(id)

  return (
    <button type="button" className="invoice-row" onClick={handleClick}>
      <span className="invoice-row__id">{id}</span>
      <span className="invoice-row__total">{formatMoney(total)}</span>
    </button>
  )
}
