/* break: a component that is not in the registry at all */
import { FilterPanel } from '@ds/FilterPanel'
type Props = { query: string }
export function FilterBar({ query }: Props) {
  return <FilterPanel value={query} />
}
