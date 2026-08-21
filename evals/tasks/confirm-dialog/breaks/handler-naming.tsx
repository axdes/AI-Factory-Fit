/* break: handler named against the repository's convention */
import { Button } from '@ds/Button'
type Props = { onConfirm: () => void }
export function ConfirmDialog({ onConfirm }: Props) {
  const handleConfirm = () => onConfirm()
  return <Button variant="destructive" onClick={handleConfirm}>Delete</Button>
}
