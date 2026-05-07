/**
 * 将 UTC 时间字符串格式化为本地时间（北京时间 UTC+8）
 * @param utcStr ISO 格式 UTC 时间字符串，如 "2026-05-07T10:30:00"
 * @param format "datetime" 返回 "YYYY-MM-DD HH:mm:ss"，"date" 返回 "YYYY-MM-DD"
 */
export function formatDateTime(utcStr: string | undefined | null, format: 'datetime' | 'date' = 'datetime'): string {
  if (!utcStr) return '-';
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return '-';

  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  if (format === 'date') {
    return `${year}-${month}-${day}`;
  }
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
