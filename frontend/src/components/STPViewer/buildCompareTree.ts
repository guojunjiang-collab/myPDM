import type { BOMCompareResponse, BOMCompareNode } from '../../types';
import type { AssemblyTreeNode } from '../../services/api';
import type { CompareNode, CompareSide, ChangeType } from './compareTypes';

/**
 * 收集装配树中出现过的 bom_item_id（含多实例展开节点）。
 * 多实例节点的 key 是 "{bom_item_id}:{idx}"，但这里只关心"该 bom_item 有没有模型"，
 * 所以统一收 bom_item_id 本身。
 */
function collectBomItemIds(tree: AssemblyTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: AssemblyTreeNode[]) => {
    for (const n of nodes) {
      if (n.bom_item_id) ids.add(n.bom_item_id);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(tree || []);
  return ids;
}

function toSide(
  raw: BOMCompareNode['left'],
  modelIds: Set<string>,
): CompareSide | null {
  if (!raw) return null;
  return {
    bomItemId: raw.id || '',
    code: raw.detail.code || '',
    name: raw.detail.name || '',
    version: raw.detail.version || '',
    quantity: raw.quantity ?? null,
    meshUuids: [],
    hasModel: modelIds.has(raw.id || ''),
  };
}

/** path 的父路径：'/A/B/C' → '/A/B'；'/A' → '' */
function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

/**
 * 把 BOM 对比结果 + 两侧装配树构建成配对树。
 *
 * 配对树是"一棵树承载左右两版"：一行 = 一个 CompareNode，
 * 行内左右两格分别渲染 left / right，缺失侧渲染占位。
 * 展开/滚动联动因此是结构性的，不需要任何同步代码。
 *
 * 注意：后端只产出 none/add/delete/modify，internal（子项变化）在此派生。
 */
export function buildCompareTree(
  result: BOMCompareResponse,
  leftTree: AssemblyTreeNode[],
  rightTree: AssemblyTreeNode[],
): CompareNode {
  const leftModelIds = collectBomItemIds(leftTree);
  const rightModelIds = collectBomItemIds(rightTree);

  const la = result.left_assembly;
  const ra = result.right_assembly;
  const rootChanged = (la?.version || '') !== (ra?.version || '') || (la?.status || '') !== (ra?.status || '');

  const root: CompareNode = {
    key: 'ROOT',
    parentKey: null,
    level: -1,
    changeType: rootChanged ? 'modify' : 'none',
    left: la ? { bomItemId: '', code: la.code, name: la.name, version: la.version, quantity: null, meshUuids: [], hasModel: leftModelIds.size > 0 } : null,
    right: ra ? { bomItemId: '', code: ra.code, name: ra.name, version: ra.version, quantity: null, meshUuids: [], hasModel: rightModelIds.size > 0 } : null,
    children: [],
  };

  // 第一遍：建节点（顺序无关，父可能后于子出现）
  const byKey = new Map<string, CompareNode>();
  byKey.set('ROOT', root);
  for (const n of result.comparison) {
    byKey.set(n.key, {
      key: n.key,
      parentKey: null,
      level: n.level,
      changeType: n.change_type as ChangeType,
      left: toSide(n.left, leftModelIds),
      right: toSide(n.right, rightModelIds),
      children: [],
    });
  }

  // 第二遍：按 path 前缀挂载。父不存在（数据不完整）时挂到 ROOT，避免丢节点。
  for (const n of result.comparison) {
    const node = byKey.get(n.key)!;
    const pKey = parentPath(n.path);
    const parent = (pKey && byKey.get(pKey)) || root;
    node.parentKey = parent.key === 'ROOT' ? 'ROOT' : parent.key;
    parent.children.push(node);
  }

  // 第三遍：后序派生 internal —— 自身未变但子孙有差异
  const derive = (node: CompareNode): boolean => {
    let childChanged = false;
    for (const c of node.children) {
      if (derive(c)) childChanged = true;
    }
    if (node.changeType === 'none' && childChanged) node.changeType = 'internal';
    return node.changeType !== 'none';
  };
  derive(root);

  return root;
}
