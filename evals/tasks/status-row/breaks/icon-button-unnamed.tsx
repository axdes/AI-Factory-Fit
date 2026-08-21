/* break: an icon-only control announced as "button" and nothing else */
import { IconButton } from '@ds/IconButton'
import { Icon } from '@ds/Icon'
type Props = { onOpen: () => void }
export function StatusRow({ onOpen }: Props) {
  return <IconButton onClick={onOpen}><Icon name="person" /></IconButton>
}
