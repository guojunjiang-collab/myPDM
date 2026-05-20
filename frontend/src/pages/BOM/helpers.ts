import type { BOMCompareNode, BOMTraceItem } from '../../types';

// ── 类型 ──

export interface SelectOption {
  id: string;
  code: string;
  name: string;
}

export interface TraceTreeNode {
  item: BOMTraceItem;
  level: number;
  children: TraceTreeNode[];
  expanded: boolean;
}

// ── BOM 对比工具 ──

/** 变更格子高亮样式 */
export const CHANGED_CELL_CLASS = 'bg-amber-100 font-semibold text-amber-900 rounded px-1';

/** 检测 modify 类型下哪些字段发生了变化 */
export function getChangedFields(node: BOMCompareNode): Set<string> {
  const changed = new Set<string>();
  if (node.change_type !== 'modify' || !node.left || !node.right) return changed;

  if (node.left.detail.code !== node.right.detail.code) changed.add('code');
  if (node.left.detail.name !== node.right.detail.name) changed.add('name');
  if (node.left.detail.spec !== node.right.detail.spec) changed.add('spec');
  if (node.left.detail.version !== node.right.detail.version) changed.add('version');
  if (node.left.detail.status !== node.right.detail.status) changed.add('status');
  if (node.left.quantity !== node.right.quantity) changed.add('quantity');

  return changed;
}

export function getChangeLabel(node: BOMCompareNode): string {
  const { change_type, left, right } = node;
  switch (change_type) {
    case 'none':
      return '无变更';
    case 'add':
      return '新增';
    case 'delete':
      return '删除';
    case 'internal':
      return '内部变更';
    case 'modify': {
      const parts: string[] = [];
      if (left && right) {
        if (left.detail.version !== right.detail.version) {
          parts.push(`版本变更 ${left.detail.version}→${right.detail.version}`);
        }
        if (left.quantity !== right.quantity) {
          parts.push(`数量变更 ${left.quantity}→${right.quantity}`);
        }
        if (left.detail.spec !== right.detail.spec) {
          parts.push(`规格变更 ${left.detail.spec || '-'}→${right.detail.spec || '-'}`);
        }
        if (left.detail.code !== right.detail.code) {
          parts.push(`件号变更 ${left.detail.code}→${right.detail.code}`);
        }
        if (left.detail.name !== right.detail.name) {
          parts.push(`名称变更 ${left.detail.name}→${right.detail.name}`);
        }
        if (left.detail.status !== right.detail.status) {
          parts.push(`状态变更 ${getStatusLabel(left.detail.status)}→${getStatusLabel(right.detail.status)}`);
        }
      }
      return parts.length > 0 ? parts.join('，') : '已修改';
    }
    default:
      return change_type;
  }
}

export function getRowBgClass(changeType: string): string {
  switch (changeType) {
    case 'add': return 'bg-green-50';
    case 'delete': return 'bg-red-50';
    case 'modify': return 'bg-yellow-50';
    case 'internal': return 'bg-orange-50';
    default: return '';
  }
}

export function getStatusLabel(status: string): string {
  const m: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  return m[status] || status;
}

// ── BOM 反查工具 ──

export function buildTraceTree(items: BOMTraceItem[]): TraceTreeNode[] {
  const nodes: TraceTreeNode[] = items.map(item => ({
    item,
    level: item.level,
    children: [] as TraceTreeNode[],
    expanded: true,
  }));

  const nodesByChildId = new Map<string, TraceTreeNode[]>();
  for (const node of nodes) {
    const childId = node.item.child_entity?.id;
    if (childId) {
      const list = nodesByChildId.get(childId);
      if (list) {
        list.push(node);
      } else {
        nodesByChildId.set(childId, [node]);
      }
    }
  }

  for (const node of nodes) {
    const parentId = node.item.parent_assembly?.id || node.item.parent_part?.id;
    if (!parentId) continue;

    const candidates = nodesByChildId.get(parentId) || [];
    for (const child of candidates) {
      if (child.item.level === node.item.level + 1) {
        node.children.push(child);
      }
    }
  }

  return nodes.filter(n => n.item.level === 1);
}

export function flattenTraceTree(nodes: TraceTreeNode[]): TraceTreeNode[] {
  const result: TraceTreeNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (n.expanded && n.children.length > 0) {
      result.push(...flattenTraceTree(n.children));
    }
  }
  return result;
}
