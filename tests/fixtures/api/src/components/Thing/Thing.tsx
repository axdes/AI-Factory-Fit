type Variant = 'solid' | 'ghost'
type Props = { variant?: Variant; loud?: boolean }
export function Thing({ variant, loud }: Props) { return <b data-v={variant} data-l={loud} /> }
