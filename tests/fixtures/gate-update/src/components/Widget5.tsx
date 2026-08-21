import { helper } from '../lib/helper'

export function Widget5({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
