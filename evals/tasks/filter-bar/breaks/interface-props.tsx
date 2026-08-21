/* break: props declared against the repository's convention */
import { SearchInput } from '@ds/SearchInput'
interface Props { query: string }
export function FilterBar({ query }: Props) {
  const onChange = () => {}
  return <SearchInput value={query} onChange={onChange} />
}
