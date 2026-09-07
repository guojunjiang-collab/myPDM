export function formatMeta(rows: Array<[string, string | undefined | null]>): string {
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
}
