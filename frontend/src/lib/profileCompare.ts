import type { ConfigTreeNode, ConfigTreePart } from '../types';

export type ChangeType = 'add' | 'delete' | 'modify' | 'none';

export interface PartSide {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  item_version?: string;
  item_status?: string;
  quantity?: number;
}
export interface ConfigItemSide {
  id: string;
  code: string;
  name: string;
  version?: string;
  status?: string;
  quantity?: number;
}
export interface ProfileComparePart {
  key: string;
  change_type: ChangeType;
  changed_fields?: ('version' | 'quantity' | 'status')[];
  left?: PartSide | null;
  right?: PartSide | null;
}
export interface ProfileCompareNode {
  key: string;
  change_type: ChangeType;
  changed_fields?: 'quantity'[];
  left?: ConfigItemSide | null;
  right?: ConfigItemSide | null;
  parts: ProfileComparePart[];
  children: ProfileCompareNode[];
}
export interface ProfileCompareCounts { add: number; delete: number; modify: number; none: number; }
export interface ProfileCompareSummary {
  config_item: ProfileCompareCounts;
  part: ProfileCompareCounts;
}
export interface ProfileCompareResult {
  root: ProfileCompareNode | null;
  summary: ProfileCompareSummary;
}

const isNodeIncluded = (n: ConfigTreeNode): boolean => n.is_selected || n.is_required;
const isPartIncluded = (p: ConfigTreePart): boolean =>
  (p.is_selected || p.is_required) && p.item_type !== 'config_item';
const byCode = (a: string, b: string): number => a.localeCompare(b, 'zh-CN', { numeric: true });

function groupByCode<T>(arr: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = keyFn(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function partToSide(p: ConfigTreePart): PartSide {
  return {
    item_id: p.item_id, item_code: p.item_code, item_name: p.item_name,
    item_type: p.item_type, item_version: p.item_version, item_status: p.item_status,
    quantity: p.quantity,
  };
}
function nodeToSide(n: ConfigTreeNode): ConfigItemSide {
  return { id: n.id, code: n.code, name: n.name, version: n.version, status: n.status, quantity: n.quantity };
}

function comparePart(key: string, left?: ConfigTreePart, right?: ConfigTreePart): ProfileComparePart {
  if (left && !right) return { key, change_type: 'delete', left: partToSide(left), right: null };
  if (!left && right) return { key, change_type: 'add', left: null, right: partToSide(right) };
  const l = left!, r = right!;
  const changed: ('version' | 'quantity' | 'status')[] = [];
  if ((l.item_version || '') !== (r.item_version || '')) changed.push('version');
  if ((l.quantity ?? null) !== (r.quantity ?? null)) changed.push('quantity');
  if ((l.item_status || '') !== (r.item_status || '')) changed.push('status');
  return {
    key,
    change_type: changed.length ? 'modify' : 'none',
    changed_fields: changed.length ? changed : undefined,
    left: partToSide(l),
    right: partToSide(r),
  };
}

function comparePartsOfNode(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileComparePart[] {
  const leftParts = (left?.parts || []).filter(isPartIncluded);
  const rightParts = (right?.parts || []).filter(isPartIncluded);
  const lByCode = groupByCode(leftParts, (p) => p.item_code);
  const rByCode = groupByCode(rightParts, (p) => p.item_code);
  const codes = [...new Set([...lByCode.keys(), ...rByCode.keys()])].sort(byCode);
  const out: ProfileComparePart[] = [];
  for (const code of codes) {
    const ls = lByCode.get(code) || [];
    const rs = rByCode.get(code) || [];
    const n = Math.max(ls.length, rs.length);
    for (let i = 0; i < n; i++) {
      out.push(comparePart(`${path}::part::${code}#${i}`, ls[i], rs[i]));
    }
  }
  return out;
}

function compareChildren(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileCompareNode[] {
  const leftKids = (left?.children || []).filter(isNodeIncluded);
  const rightKids = (right?.children || []).filter(isNodeIncluded);
  const lByCode = new Map(leftKids.map((c) => [c.code, c] as const));
  const rByCode = new Map(rightKids.map((c) => [c.code, c] as const));
  const codes = [...new Set([...lByCode.keys(), ...rByCode.keys()])].sort(byCode);
  return codes.map((code) =>
    compareNode(`${path}/${code}`, lByCode.get(code) || null, rByCode.get(code) || null)
  );
}

function compareNode(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileCompareNode {
  const parts = comparePartsOfNode(path, left, right);
  const children = compareChildren(path, left, right);

  let change_type: ChangeType;
  let changed_fields: 'quantity'[] | undefined;

  if (left && !right) change_type = 'delete';
  else if (!left && right) change_type = 'add';
  else {
    const qtyChanged = (left!.quantity ?? null) !== (right!.quantity ?? null);
    const descendantChanged =
      parts.some((p) => p.change_type !== 'none') ||
      children.some((c) => c.change_type !== 'none');
    if (qtyChanged) changed_fields = ['quantity'];
    change_type = qtyChanged || descendantChanged ? 'modify' : 'none';
  }

  return {
    key: path,
    change_type,
    changed_fields,
    left: left ? nodeToSide(left) : null,
    right: right ? nodeToSide(right) : null,
    parts,
    children,
  };
}

function summarize(root: ProfileCompareNode | null): ProfileCompareSummary {
  const s: ProfileCompareSummary = {
    config_item: { add: 0, delete: 0, modify: 0, none: 0 },
    part: { add: 0, delete: 0, modify: 0, none: 0 },
  };
  const walk = (n: ProfileCompareNode) => {
    s.config_item[n.change_type]++;
    for (const p of n.parts) s.part[p.change_type]++;
    for (const c of n.children) walk(c);
  };
  if (root) walk(root);
  return s;
}

/**
 * 对比两个构型配置的正式清单（仅已选项）。
 * 根节点按位置匹配（每个配置单根）；子节点/零部件按 code-path/件号匹配。
 */
export function diffProfileTrees(
  left: ConfigTreeNode | null,
  right: ConfigTreeNode | null,
): ProfileCompareResult {
  const l = left && isNodeIncluded(left) ? left : null;
  const r = right && isNodeIncluded(right) ? right : null;
  let root: ProfileCompareNode | null = null;
  if (l || r) {
    const rootCode = r?.code ?? l?.code ?? 'ROOT';
    root = compareNode(rootCode, l, r);
  }
  return { root, summary: summarize(root) };
}
