/* break: default export where this repository uses named */
import { Button } from '@ds/Button'
type Props = { label: string }
export default function DocumentList({ label }: Props) {
  const onCreate = () => {}
  return <Button variant="primary" onClick={onCreate}>{label}</Button>
}
