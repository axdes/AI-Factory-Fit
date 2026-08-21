/* break: interactive behaviour on a non-interactive element */
import { Avatar } from '@ds/Avatar'
type Props = { onOpen: () => void }
export function StatusRow({ onOpen }: Props) {
  return <div onClick={onOpen}><Avatar size="sm" /></div>
}
