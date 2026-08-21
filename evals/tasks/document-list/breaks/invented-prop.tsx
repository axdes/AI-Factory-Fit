/* break: a prop the component does not declare */
import { Badge } from '@ds/Badge'
type Props = { label: string }
export function DocumentList({ label }: Props) {
  return <Badge rounded tone="neutral">{label}</Badge>
}
