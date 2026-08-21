/* break: a variant value that is not in the component's union */
import { Button } from '@ds/Button'
type Props = { label: string }
export function DocumentList({ label }: Props) {
  const onCreate = () => {}
  return <Button variant="cta" onClick={onCreate}>{label}</Button>
}
