import type { BOMRow } from './CADBOMMatchTable';

/** 当前行集合的最大层级(0 基);空集合返回 0 */
export function maxLevelOf(rows: BOMRow[]): number {
  return rows.length ? Math.max(...rows.map(r => r.level)) : 0;
}

/**
 * 计算"展开到层级 k"对应的应折叠节点 path 集合。
 * 语义:所有 level >= k 且有子节点的行折叠 → 可见层为 0..k。
 * k=0 全部折叠;k=Infinity 全部展开(返回空集合)。
 * "有子节点"由相邻行判断:下一行 level 更深即为其子(依赖扁平化后的前序顺序)。
 */
export function buildCollapsedForLevel(rows: BOMRow[], k: number): Set<string> {
  const collapsed = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const hasChild = i < rows.length - 1 && rows[i + 1].level > rows[i].level;
    if (hasChild && rows[i].level >= k) collapsed.add(rows[i].path);
  }
  return collapsed;
}
