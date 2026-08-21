import { helper } from '../lib/helper'

function Legacy({ label }: { label: string }) {
  return <div className="widget">{helper(label)}</div>
}

export default Legacy
