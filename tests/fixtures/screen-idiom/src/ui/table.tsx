export function DataTable({ rows }: { rows: unknown[] }) {
  return <table><tbody>{rows.map(() => null)}</tbody></table>
}
