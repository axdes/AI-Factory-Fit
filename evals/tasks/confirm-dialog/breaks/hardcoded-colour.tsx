/* break: a literal colour where the system has tokens */
import { Modal } from '@ds/Modal'
type Props = { open: boolean }
export function ConfirmDialog({ open }: Props) {
  return <Modal open={open}><span style={{ color: '#d32f2f' }}>Delete</span></Modal>
}
