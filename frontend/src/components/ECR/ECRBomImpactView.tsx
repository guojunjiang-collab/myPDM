import { useCallback, useEffect, useState, useMemo } from 'react';
import type { BomImpactNode } from '../../types';

// ─── Action config ───────────────────────────────────────────────
const ACTION_ROW_CLASS: Record<string, string> = {
  upgrade: 'bg-blue-50',
  qty_change: 'bg-orange-50',
  delete: 'bg-red-50',
  no_change: '',
};

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  upgrade: { label: '升版', color: 'bg-blue-100 text-blue-800' },
  qty_change: { label: '数量修改', color: 'bg-orange-100 text-orange-800' },
  delete: { label: '删除', color: 'bg-red-100 text-red-800' },
  no_change: { label: '不变', color: 'bg-gray-100 text-gray-600' },
};

const UPWARD_ACTIONS = ['upgrade', 'qty_change', 'delete', 'no_change'] as const;
const DOWNWARD_ACTIONS = ['upgrade', 'qty_change', 'delete', 'no_change'] as const;

// ─── Props ───────────────────────────────────────────────────────
interface ECRBomImpactViewProps {
  upwardChain: BomImpactNode[];
  downwardItems: BomImpactNode[];
  onChange: (upwardChain: BomImpactNode[], downwardItems: BomImpactNode[]) => void;
  editable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────
function updateNodeAt<T extends BomImpactNode>(nodes: T[], index: number, patch: Partial<T>): T[] {
  return nodes.map((n, i) => (i === index ? { ...n, ...patch } : n));
}

const isQuantityEditable = (action: string): boolean =>
  action === 'qty_change';

const getQuantityValue = (node: BomImpactNode): number => {
  if (node.quantity_change?.to) return node.quantity_change.to;
  return node.quantity;
};

// ─── Upward tree structure ──────────────────────────────────────
interface UpwardTreeNode {
  node: BomImpactNode;
  children: UpwardTreeNode[];
}

// 按件号对同级兄弟节点排序（不改变输入顺序——树的父子嵌套依赖输入的 level 序列）
function sortUpwardSiblings(nodes: UpwardTreeNode[]): void {
  nodes.sort((a, b) => (a.node.entity_code || '').localeCompare(b.node.entity_code || ''));
  for (const n of nodes) sortUpwardSiblings(n.children);
}

function buildUpwardTree(items: BomImpactNode[]): UpwardTreeNode[] {
  const filtered = items.filter((item) => item.level !== 0 && !item.is_change_target);
  const roots: UpwardTreeNode[] = [];
  const stack: UpwardTreeNode[] = [];
  for (const item of filtered) {
    const treeNode: UpwardTreeNode = { node: item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].node.level! >= item.level!) {
      stack.pop();
    }
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
    stack.push(treeNode);
  }
  // 仅对兄弟排序，保持父→子→孙的层级相邻关系
  sortUpwardSiblings(roots);
  return roots;
}

// ─── Component ───────────────────────────────────────────────────
export function ECRBomImpactView({
  upwardChain: upwardChainProp,
  downwardItems: downwardItemsProp,
  onChange,
  editable,
}: ECRBomImpactViewProps) {
  // 防空：导入或未计算 BOM 影响时，bom_impact 可能为 {}，上/下链为 undefined
  const upwardChain = upwardChainProp || [];
  const downwardItems = downwardItemsProp || [];
  // ── Upward tree state ──────────────────────────────────────────
  const upwardTree = useMemo(() => buildUpwardTree(upwardChain), [upwardChain]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const flattenUpwardTreeExpanded = useCallback(
    (nodes: UpwardTreeNode[], keys: Set<string>): UpwardTreeNode[] => {
      const result: UpwardTreeNode[] = [];
      for (const n of nodes) {
        result.push(n);
        const key = `${n.node.entity_id}:${n.node.level}`;
        if (keys.has(key) && n.children.length > 0) {
          result.push(...flattenUpwardTreeExpanded(n.children, keys));
        }
      }
      return result;
    },
    [],
  );

  // 前序遍历：兄弟已在 buildUpwardTree 中按件号排好序，展开后父项后紧跟其子/孙项
  const flatUpward = useMemo(
    () => flattenUpwardTreeExpanded(upwardTree, expandedKeys),
    [upwardTree, expandedKeys, flattenUpwardTreeExpanded],
  );

  // Sort: downward items by entity_code ascending
  const sortedDownwardItems = useMemo(
    () => [...downwardItems].sort((a, b) => (a.entity_code || '').localeCompare(b.entity_code || '')),
    [downwardItems],
  );

  const toggleUpwardNode = (treeNode: UpwardTreeNode) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      const key = `${treeNode.node.entity_id}:${treeNode.node.level}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // ── Upstream helpers ───────────────────────────────────────────
  const handleUpwardAction = useCallback(
    (index: number, action: BomImpactNode['action']) => {
      const updated = updateNodeAt(upwardChain, index, { action });
      onChange(updated, downwardItems);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleUpwardQty = useCallback(
    (index: number, value: string) => {
      const num = value === '' ? '' : Math.max(1, parseInt(value) || 1);
      const updated = updateNodeAt(upwardChain, index, {
        quantity_change: { from: upwardChain[index].quantity, to: num === '' ? upwardChain[index].quantity : num as number },
      });
      onChange(updated, downwardItems);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleUpwardDescription = useCallback(
    (index: number, value: string) => {
      const updated = updateNodeAt(upwardChain, index, { change_description: value || undefined });
      onChange(updated, downwardItems);
    },
    [upwardChain, downwardItems, onChange],
  );

  // ── Downstream helpers ─────────────────────────────────────────
  const handleDownwardSelected = useCallback(
    (index: number, selected: boolean) => {
      const updated = updateNodeAt(downwardItems, index, { selected });
      onChange(upwardChain, updated);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleDownwardAction = useCallback(
    (index: number, action: BomImpactNode['action']) => {
      const updated = updateNodeAt(downwardItems, index, { action });
      onChange(upwardChain, updated);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleDownwardQty = useCallback(
    (index: number, value: string) => {
      const num = value === '' ? '' : Math.max(1, parseInt(value) || 1);
      const updated = updateNodeAt(downwardItems, index, {
        quantity_change: { from: downwardItems[index].quantity, to: num === '' ? downwardItems[index].quantity : num as number },
      });
      onChange(upwardChain, updated);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleDownwardDescription = useCallback(
    (index: number, value: string) => {
      const updated = updateNodeAt(downwardItems, index, { change_description: value || undefined });
      onChange(upwardChain, updated);
    },
    [upwardChain, downwardItems, onChange],
  );

  // ── Render helpers ─────────────────────────────────────────────
  const renderActionBadge = (action: string) => {
    const cfg = ACTION_CONFIG[action] || { label: action, color: 'bg-gray-100 text-gray-600' };
    return (
      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${cfg.color}`}>
        {cfg.label}
      </span>
    );
  };

  const renderActionSelect = (
    value: string,
    onChangeAction: (val: BomImpactNode['action']) => void,
    options: typeof UPWARD_ACTIONS | typeof DOWNWARD_ACTIONS,
  ) => (
    <select
      value={value}
      onChange={(e) => onChangeAction(e.target.value as BomImpactNode['action'])}
      className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 bg-white focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
    >
      {options.map((opt) => {
        const cfg = ACTION_CONFIG[opt];
        return (
          <option key={opt} value={opt}>
            {cfg.label}
          </option>
        );
      })}
    </select>
  );

  const thClass = 'px-2 py-2 text-left text-xs font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap';
  const tdClass = 'px-2 py-1.5 text-xs text-gray-700 border-b border-gray-100';

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Section header */}
      <h3 className="text-sm font-semibold text-gray-800">BOM 影响分析</h3>

      {/* ─── Upward chain table ──────────────────────────── */}
      <div>
        <div className="text-xs font-semibold text-gray-800 mb-1.5">向上溯源链</div>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className={`${thClass} w-20`}>层级</th>
                <th className={thClass}>件号</th>
                <th className={thClass}>名称</th>
                <th className={thClass}>版本</th>
                <th className={thClass}>子项用量</th>
                <th className={`${thClass} w-24`}>操作</th>
                <th className={thClass}>目标用量</th>
                <th className={thClass}>变更说明</th>
              </tr>
            </thead>
            <tbody>
              {upwardChain.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-xs text-gray-400">
                    暂无向上溯源数据
                  </td>
                </tr>
              ) : (
                flatUpward.map((treeNode) => {
                  const node = treeNode.node;
                  const idx = upwardChain.indexOf(node);
                  const hasChildren = treeNode.children.length > 0;
                  return (
                    <tr key={`up-${idx}`} className={node.action && node.action !== 'no_change' ? ACTION_ROW_CLASS[node.action] || '' : 'hover:bg-gray-50'}>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-0.5">
                          <span className="text-xs text-gray-400">{'-'.repeat(node.level ?? 0)}{node.level ?? 0}</span>
                          {hasChildren ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleUpwardNode(treeNode); }}
                              className="w-4 h-4 inline-flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
                            >
                              {expandedKeys.has(`${treeNode.node.entity_id}:${treeNode.node.level}`) ? '▼' : '▶'}
                            </button>
                          ) : (
                            <span className="w-4 inline-block" />
                          )}
                        </span>
                      </td>
                      <td className={`${tdClass} font-mono whitespace-nowrap`}>{node.entity_code}</td>
                      <td className={tdClass}>{node.entity_name}</td>
                      <td className={tdClass}>{node.entity_version}</td>
                      <td className={tdClass}>{node.quantity}</td>
                      <td className={tdClass}>
                        {editable ? (
                          renderActionSelect(node.action, (val) => handleUpwardAction(idx, val), UPWARD_ACTIONS)
                        ) : (
                          renderActionBadge(node.action)
                        )}
                      </td>
                      <td className={tdClass}>
                        {editable && isQuantityEditable(node.action) ? (
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={getQuantityValue(node)}
                            onChange={(e) => handleUpwardQty(idx, e.target.value)}
                            className="w-20 text-xs border rounded px-1.5 py-0.5 focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-xs">{getQuantityValue(node)}</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        {editable ? (
                          <input
                            type="text"
                            value={node.change_description || ''}
                            onChange={(e) => handleUpwardDescription(idx, e.target.value)}
                            disabled={node.action === 'no_change'}
                            className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="变更说明"
                          />
                        ) : (
                          <span className="text-xs text-gray-500 max-w-32 truncate block">
                            {node.change_description || '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Downward items table ──────────────────────────── */}
      {downwardItems.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-800 mb-1.5">
            向下子项：<span className="font-normal text-gray-400">一级BOM</span>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className={thClass}>件号</th>
                  <th className={thClass}>名称</th>
                  <th className={thClass}>版本</th>
                  <th className={thClass}>当前数量</th>
                  <th className={thClass}>操作</th>
                  <th className={thClass}>目标用量</th>
                  <th className={thClass}>变更说明</th>
                </tr>
              </thead>
              <tbody>
                {downwardItems.length === 0 ? (
                  <tr>
<td colSpan={7} className="px-2 py-6 text-center text-xs text-gray-400">
                      暂无向下子项，点击上方按钮添加
                    </td>
                  </tr>
                ) : (
                sortedDownwardItems.map((node) => {
                  const idx = downwardItems.indexOf(node);
                  return (
                  <tr key={`down-${idx}`} className={node.action && node.action !== 'no_change' ? ACTION_ROW_CLASS[node.action] || '' : 'hover:bg-gray-50'}>
                    <td className={`${tdClass} font-mono`}>{node.entity_code}</td>
                    <td className={tdClass}>{node.entity_name}</td>
                    <td className={tdClass}>{node.entity_version}</td>
                    <td className={tdClass}>{node.quantity}</td>
                    <td className={tdClass}>
                      {editable ? (
                        renderActionSelect(node.action, (val) => handleDownwardAction(idx, val), DOWNWARD_ACTIONS)
                      ) : (
                        renderActionBadge(node.action)
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable && isQuantityEditable(node.action) ? (
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={getQuantityValue(node)}
                          onChange={(e) => handleDownwardQty(idx, e.target.value)}
                          className="w-20 text-xs border rounded px-1.5 py-0.5 focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-xs">{getQuantityValue(node)}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <input
                          type="text"
                          value={node.change_description || ''}
                          onChange={(e) => handleDownwardDescription(idx, e.target.value)}
                          disabled={node.action === 'no_change'}
                          className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="变更说明"
                        />
                      ) : (
                        <span className="text-xs text-gray-500 max-w-32 truncate block">
                          {node.change_description || '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
        <span className="font-semibold text-gray-800">结论：</span>
        {(() => {
          const upParents = upwardChain.filter((n) => n.level !== 0 && !n.is_change_target);
          const upChanged = upParents.filter((n) => n.action !== 'no_change').length;
          const downChanged = downwardItems.filter((n) => n.action !== 'no_change').length;
          const parts: string[] = [];
          if (upParents.length > 0) {
            parts.push(`向上影响 ${upChanged}/${upParents.length} 节点需变更`);
          }
          if (downwardItems.length > 0) {
            parts.push(`向下影响 ${downChanged}/${downwardItems.length} 子项需变更`);
          }
          return parts.join(' | ');
        })()}
      </div>
    </div>
  );
}
