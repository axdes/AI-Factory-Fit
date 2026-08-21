import './OrderRow.css'
import { formatMoney } from '../lib/money'

type Props = {
  id: string
  total: number
  onOpen: (id: string) => void
}

export function OrderRow({ id, total, onOpen }: Props) {
  const handleClick = () => onOpen(id)

  return (
    <button type="button" className="order-row" onClick={handleClick}>
      <span className="order-row__id">{id}</span>
      <span className="order-row__total">{formatMoney(total)}</span>
    </button>
  )
}
