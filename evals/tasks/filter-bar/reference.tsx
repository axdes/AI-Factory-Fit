import { SearchInput } from '@ds/SearchInput'
import { Select } from '@ds/Select'

type Props = { query: string; onQueryChange: (value: string) => void }

export function FilterBar({ query, onQueryChange }: Props) {
  const onPick = () => {}
  return (
    <div>
      <SearchInput value={query} onChange={onQueryChange} />
      <Select size="md" onChange={onPick} />
    </div>
  )
}
