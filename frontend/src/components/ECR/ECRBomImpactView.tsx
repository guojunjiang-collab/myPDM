import { useCallback, useMemo } from 'react';
import type { BomImpactNode } from '../../types';

// ─── Action config ───────────────────────────────────────────────
const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  upgrade: { label: '升版', color: 'bg-blue-100 text-blue-800' },
  qty_change: { label: '数量修改', color: 'bg-orange-100 text-orange-800' },
  delete: { label: '删除', color: 'bg-red-100 text-red-800' },
  add_existing: { label: '新增现有', color: 'bg-green-100 text-green-800' },
  add_new: { label: '新建', color: 'bg-purple-100 text-purple-800' },
  no_change: { label: '不变', color: 'bg-gray-100 text-gray-600' },
};

const UPWARD_ACTIONS = ['upgrade', 'qty_change', 'delete', 'no_change'] as const;
const DOWNWARD_ACTIONS = [...UPWARD_ACTIONS, 'add_existing', 'add_new'] as const;

// ─── Props ───────────────────────────────────────────────────────
interface ECRBomImpactViewProps {
  upwardChain: BomImpactNode[];
  downwardItems: BomImpactNode[];
  onChange: (upwardChain: BomImpactNode[], downwardItems: BomImpactNode[]) => void;
  editable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────
function updateNodeAt<T extends BomImpactNode>(
  nodes: T[],
  index: number,
  patch: Partial<T>,
): T[] {
  return nodes.map((n, i) => (i === index ? { ...n, ...patch } : n));
}

// ─── Component ───────────────────────────────────────────────────
export function ECRBomImpactView({
  upwardChain,
  downwardItems,
  onChange,
  editable,
}: ECRBomImpactViewProps) {
  // ── Upstream helpers ───────────────────────────────────────────
  const handleUpwardAction = useCallback(
    (index: number, action: BomImpactNode['action']) => {
      const updated = updateNodeAt(upwardChain, index, { action });
      onChange(updated, downwardItems);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleUpwardTargetVersion = useCallback(
    (index: number, value: string) => {
      const updated = updateNodeAt(upwardChain, index, { target_version: value || undefined });
      onChange(updated, downwardItems);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleUpwardQtyChange = useCallback(
    (index: number, field: 'from' | 'to', value: string) => {
      const num = value === '' ? 0 : Number(value);
      const cur = upwardChain[index].quantity_change || { from: 0, to: 0 };
      const updated = updateNodeAt(upwardChain, index, {
        quantity_change: { ...cur, [field]: Number.isNaN(num) ? 0 : num },
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

  const handleDownwardTargetVersion = useCallback(
    (index: number, value: string) => {
      const updated = updateNodeAt(downwardItems, index, { target_version: value || undefined });
      onChange(upwardChain, updated);
    },
    [upwardChain, downwardItems, onChange],
  );

  const handleDownwardQtyChange = useCallback(
    (index: number, field: 'from' | 'to', value: string) => {
      const num = value === '' ? 0 : Number(value);
      const cur = downwardItems[index].quantity_change || { from: 0, to: 0 };
      const updated = updateNodeAt(downwardItems, index, {
        quantity_change: { ...cur, [field]: Number.isNaN(num) ? 0 : num },
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

  // ── Summary ────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const upwardChanged = upwardChain.filter((n) => n.action !== 'no_change').length;
    const downwardSelected = downwardItems.filter((n) => n.selected).length;
    return `向上影响 ${upwardChain.length} 节点(需变更 ${upwardChanged}) | 向下选中 ${downwardSelected} 项`;
  }, [upwardChain, downwardItems]);

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
        <div className="text-xs font-medium text-gray-500 mb-1.5">向上溯源链</div>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className={thClass}>层级</th>
                <th className={thClass}>编码</th>
                <th className={thClass}>名称</th>
                <th className={thClass}>版本</th>
                <th className={thClass}>父项编码</th>
                <th className={thClass}>操作</th>
                <th className={thClass}>目标版本</th>
                <th className={thClass}>数量变更</th>
                <th className={thClass}>变更说明</th>
              </tr>
            </thead>
            <tbody>
              {upwardChain.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-xs text-gray-400">
                    暂无向上溯源数据
                  </td>
                </tr>
              ) : (
                upwardChain.map((node, idx) => (
                  <tr key={`up-${idx}`} className={node.is_change_target ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className={tdClass}>L{node.level ?? idx}</td>
                    <td className={`${tdClass} font-mono`}>{node.entity_code}</td>
                    <td className={tdClass}>{node.entity_name}</td>
                    <td className={tdClass}>{node.entity_version}</td>
                    <td className={`${tdClass} font-mono`}>{node.parent_entity_code || '—'}</td>
                    <td className={tdClass}>
                      {editable ? (
                        renderActionSelect(node.action, (val) => handleUpwardAction(idx, val), UPWARD_ACTIONS)
                      ) : (
                        renderActionBadge(node.action)
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <input
                          type="text"
                          value={node.target_version || ''}
                          onChange={(e) => handleUpwardTargetVersion(idx, e.target.value)}
                          className="w-16 text-xs border border-gray-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      ) : (
                        <span className="text-xs text-gray-500">{node.target_version || '—'}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={node.quantity_change?.from ?? ''}
                            onChange={(e) => handleUpwardQtyChange(idx, 'from', e.target.value)}
                            className="w-12 text-xs border border-gray-300 rounded px-1 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="从"
                          />
                          <span className="text-gray-400 text-xs">→</span>
                          <input
                            type="number"
                            value={node.quantity_change?.to ?? ''}
                            onChange={(e) => handleUpwardQtyChange(idx, 'to', e.target.value)}
                            className="w-12 text-xs border border-gray-300 rounded px-1 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="到"
                          />
                        </div>
                      ) : node.quantity_change ? (
                        <span className="text-xs text-gray-500">
                          {node.quantity_change.from}→{node.quantity_change.to}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <input
                          type="text"
                          value={node.change_description || ''}
                          onChange={(e) => handleUpwardDescription(idx, e.target.value)}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Downward items table (only when present) ──────────── */}
      {downwardItems.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">
            向下子项 <span className="text-gray-400">（一级 BOM）</span>
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className={`${thClass} w-8`}>勾选</th>
                  <th className={thClass}>编码</th>
                  <th className={thClass}>名称</th>
                  <th className={thClass}>版本</th>
                  <th className={thClass}>当前数量</th>
                  <th className={thClass}>操作</th>
                  <th className={thClass}>目标版本</th>
                  <th className={thClass}>数量变更</th>
                  <th className={thClass}>变更说明</th>
                </tr>
              </thead>
              <tbody>
                {downwardItems.map((node, idx) => (
                  <tr key={`down-${idx}`} className={node.selected ? 'bg-primary-50' : 'hover:bg-gray-50'}>
                    <td className={`${tdClass} text-center`}>
                      <input
                        type="checkbox"
                        checked={!!node.selected}
                        onChange={(e) => handleDownwardSelected(idx, e.target.checked)}
                        disabled={!editable}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
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
                      {editable ? (
                        <input
                          type="text"
                          value={node.target_version || ''}
                          onChange={(e) => handleDownwardTargetVersion(idx, e.target.value)}
                          className="w-16 text-xs border border-gray-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      ) : (
                        <span className="text-xs text-gray-500">{node.target_version || '—'}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={node.quantity_change?.from ?? ''}
                            onChange={(e) => handleDownwardQtyChange(idx, 'from', e.target.value)}
                            className="w-12 text-xs border border-gray-300 rounded px-1 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="从"
                          />
                          <span className="text-gray-400 text-xs">→</span>
                          <input
                            type="number"
                            value={node.quantity_change?.to ?? ''}
                            onChange={(e) => handleDownwardQtyChange(idx, 'to', e.target.value)}
                            className="w-12 text-xs border border-gray-300 rounded px-1 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="到"
                          />
                        </div>
                      ) : node.quantity_change ? (
                        <span className="text-xs text-gray-500">
                          {node.quantity_change.from}→{node.quantity_change.to}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {editable ? (
                        <input
                          type="text"
                          value={node.change_description || ''}
                          onChange={(e) => handleDownwardDescription(idx, e.target.value)}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Summary line ─────────────────────────────────── */}
      <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-xs text-gray-600">{summary}</p>
      </div>
    </div>
  );
}
