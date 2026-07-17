import type { BOMRow } from './CADBOMMatchTable';

/**
 * 将桥接返回的 CATIA 装配树扁平化为 BOM 匹配表格行。
 * 同层级（同一父节点下）相同件号的实例合并为一行，用量累加，避免重复；
 * CATIA 属性存于零件文档、同件号实例共享，取第一个实例作代表即可，
 * 各实例的变换矩阵全部保留（instances），供 BOM 推送写入 PDM；
 * 件号为空的节点无法判定为同一零部件，不参与合并。
 */
export function flattenTree(tree: any): BOMRow[] {
  const rows: BOMRow[] = [];

  function pushNode(node: any, quantity: number, instances: { matrix: number[] | null; label: string }[]) {
    rows.push({
      instance_name: node.instance_name || '',
      part_number: node.builtin?.PartNumber || '',
      path: node.path || '',
      level: node.level || 0,
      is_assembly: node.is_assembly || false,
      quantity,
      instances,
      doc_path: node.doc_path || '',
      builtin: node.builtin || {},
      user_properties: node.user_properties || {},
      pdm_match: null,
      match_status: 'unknown' as const,
      checkout_status: null,
    });
    walkChildren(node.children || []);
  }

  function walkChildren(children: any[]) {
    const groups = new Map<string, { node: any; count: number; instances: { matrix: number[] | null; label: string }[] }>();
    const order: string[] = [];
    for (const child of children) {
      const pn = child.builtin?.PartNumber || '';
      const key = pn || `__path__${child.path}`;
      const inst = { matrix: child.matrix || null, label: child.instance_name || '' };
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        g.instances.push(inst);
      } else {
        groups.set(key, { node: child, count: 1, instances: [inst] });
        order.push(key);
      }
    }
    for (const key of order) {
      const g = groups.get(key)!;
      pushNode(g.node, g.count, g.instances);
    }
  }

  pushNode(tree, 1, []);
  return rows;
}
