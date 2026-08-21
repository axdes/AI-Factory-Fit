import { helper } from '../lib/helper'

export function Widget9({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}
