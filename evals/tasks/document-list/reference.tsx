import { Badge } from '@ds/Badge'
import { Button } from '@ds/Button'
import { Table } from '@ds/Table'

type Props = { documents: { id: string; title: string; status: 'draft' | 'review' }[] }

export function DocumentList({ documents }: Props) {
  const onCreate = () => {}
  return (
    <section>
      <Button variant="primary" onClick={onCreate}>New document</Button>
      <Table>
        {documents.map((d) => (
          <Badge key={d.id} tone={d.status === 'review' ? 'warning' : 'neutral'}>{d.title}</Badge>
        ))}
      </Table>
    </section>
  )
}
