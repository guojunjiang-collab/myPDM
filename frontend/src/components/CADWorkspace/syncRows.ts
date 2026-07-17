import type { BOMRow } from './CADBOMMatchTable';

/**
 * 按 CATIA PartNumber 同步更新所有相同零部件实例行的属性。
 * 业务来源：CATIA 中属性存于零件文档，同一 PartNumber 的所有实例
 * 引用同一文档、属性天然共享，因此表格各实例行的显示也必须保持一致。
 * PartNumber 为空时回退为仅按 path 更新当前行，避免多个空件号的行被误同步。
 * target 为 'builtin' 时更新内置属性（版本/定义/术语/描述），默认更新用户属性。
 */
export function syncRowsByPartNumber(
  rows: BOMRow[],
  row: BOMRow,
  key: string,
  value: string,
  target: 'user' | 'builtin' = 'user',
): BOMRow[] {
  const matches = row.part_number
    ? (r: BOMRow) => r.part_number === row.part_number
    : (r: BOMRow) => r.path === row.path;
  return rows.map(r => {
    if (!matches(r)) return r;
    if (target === 'builtin') {
      return { ...r, builtin: { ...r.builtin, [key]: value } };
    }
    return { ...r, user_properties: { ...r.user_properties, [key]: value } };
  });
}
