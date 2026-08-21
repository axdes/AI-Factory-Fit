import './OrderSummary.css'
import { Badge } from './registry/Badge'
import { Button } from './registry/Button'

type Props = {
  state: string
  onOpen: () => void
}

function OrderSummary({ state, onOpen }: Props) {
  const handleOpen = () => onOpen()

  return (
    <div className="order-summary">
      <Badge tone="primary" fill="soft" size="sm">{state}</Badge>
      <Badge tone="neutral" fill="solid" size="md">{state}</Badge>
      <Button variant="primary" size="md" onClick={handleOpen}>Open</Button>
      <Button variant="secondary" size="sm" onClick={handleOpen}>Dismiss</Button>
    </div>
  )
}

export default OrderSummary
