import { helper } from '@/lib/helper'

export function Aliased({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
