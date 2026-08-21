export default function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; cls: string }> }) {
  const entry = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${entry.cls}`}>{entry.label}</span>;
}
