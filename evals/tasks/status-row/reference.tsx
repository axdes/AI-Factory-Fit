import { Avatar } from '@ds/Avatar'
import { Badge } from '@ds/Badge'
import { IconButton } from '@ds/IconButton'
import { Icon } from '@ds/Icon'

type Props = { name: string; status: 'online' | 'away' }

export function StatusRow({ name, status }: Props) {
  const onOpen = () => {}
  return (
    <div>
      <Avatar size="sm" status={status} />
      <Badge tone="neutral">{name}</Badge>
      <IconButton aria-label="Open profile" onClick={onOpen}><Icon name="person" /></IconButton>
    </div>
  )
}
