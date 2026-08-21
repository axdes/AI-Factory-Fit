import { helper } from '../lib/helper'

export function Widget4({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
