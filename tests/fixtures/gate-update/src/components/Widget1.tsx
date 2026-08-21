import { helper } from '../lib/helper'

export function Widget1({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
