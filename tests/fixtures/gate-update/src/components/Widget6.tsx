import { helper } from '../lib/helper'

export function Widget6({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
