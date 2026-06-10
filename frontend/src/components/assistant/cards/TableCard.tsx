interface Props { payload: { title?: string; columns: string[]; rows: Record<string, unknown>[] }; }
export default function TableCard({ payload }: Props) {
  const { title, columns, rows } = payload;
  return (
    <div className="border rounded-lg overflow-hidden my-2">
      {title && <div className="px-3 py-2 bg-gray-50 text-sm font-medium">{title}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-gray-100">
            {columns.map((c) => <th key={c} className="px-3 py-1.5 text-left whitespace-nowrap">{c}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{String(r[c] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
