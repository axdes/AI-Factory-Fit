import { Button } from '@ds/Button'
import { Modal } from '@ds/Modal'

type Props = { open: boolean; onClose: () => void; onConfirm: () => void }

export function ConfirmDialog({ open, onClose, onConfirm }: Props) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="destructive" onClick={onConfirm}>Delete</Button>
    </Modal>
  )
}
