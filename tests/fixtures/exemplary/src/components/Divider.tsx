import './Divider.css'

type Props = {
  label?: string
}

export function Divider({ label }: Props) {
  return <hr className="divider" aria-label={label} />
}
