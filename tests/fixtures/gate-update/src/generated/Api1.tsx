import { helper } from '@/lib/helper'

function Api1(props) {
  return <div style={{ color: '#ff0000' }}>{helper(props.x)}</div>
}
export default Api1
