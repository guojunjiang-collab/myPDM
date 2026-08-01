import { useEffect, useMemo, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { filterCompareTree } from './compareTreeFilter';
import type { CompareNode, CompareSide, ChangeType, Side } from './compareTypes';

const ROW_BG: Record<ChangeType, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-yellow-50',
  none: '',
};

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
      {visible ? <circle cx="8" cy="8" r="2" /> : <path d="M2 2l12 12" strokeLinecap="round" />}
    </svg>
  );
}

/** 单侧格子：缺失侧渲染虚线占位 */
function SideCell({ side, node, which }: { side: CompareSide | null; node: CompareNode; which: Side }) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleCompareSideVisibility);

  if (!side) {
    return (
      <div className="flex-1 min-w-0 px-2 py-0.5">
        <div className="border border-dashed border-gray-300 rounded text-gray-300 text-xs text-center leading-5">—</div>
      </div>
    );
  }

  const visible = side.meshUuids.length === 0 ? true : side.meshUuids.some((u) => !hiddenParts.has(u));
  const noModel = !side.hasModel;
  const label = [side.code, side.version, side.name].filter(Boolean).join('_');

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5">
      {side.meshUuids.length > 0 ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMeshes(node.key, which); }}
          className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-400'}`}
          title={visible ? '隐藏' : '显示'}
        >
          <EyeIcon visible={visible} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span
        className={`truncate flex-1 text-xs
          ${noModel ? 'text-gray-400 italic' : 'text-gray-700'}
          ${visible ? '' : 'text-gray-300 line-through'}`}
        title={label}
      >
        {label}
        {node.instances && node.instances.length > 0 ? (
          <span className="text-gray-400 ml-1">×{node.instances.length}</span>
        ) : side.quantity !== null ? (
          <span className="text-gray-400 ml-1">×{side.quantity}</span>
        ) : null}
        {noModel && <span className="text-gray-400 ml-1">(无模型)</span>}
      </span>
    </div>
  );
}

function Row({ node, depth }: { node: CompareNode; depth: number }) {
  const expandedIds = useViewerStore((s) => s.expandedIds);
  const toggleExpanded = useViewerStore((s) => s.toggleExpanded);
  const selectedKey = useViewerStore((s) => s.compare?.selectedKey ?? null);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);

  const expanded = expandedIds.has(node.key);
  const selected = selectedKey === node.key;
  const hasChildren = node.children.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && rowRef.current) rowRef.current.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li>
      <div
        ref={rowRef}
        onClick={() => selectCompareKey(node.key)}
        className={`flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors
          ${selected ? 'ring-1 ring-inset ring-primary-400 bg-primary-50' : `${ROW_BG[node.changeType]} hover:brightness-95`}`}
      >
        {/* 展开按钮每行只有一个，作用于整行 —— 左右联动是结构性的 */}
        <div className="shrink-0 flex items-center" style={{ paddingLeft: 4 + depth * 12 }}>
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.key); }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200/60"
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="w-4" />
          )}
        </div>
        <SideCell side={node.left} node={node} which="left" />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell side={node.right} node={node} which="right" />
      </div>

      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} />)}
        </ul>
      )}

      {/* 实例子行：按矩阵匹配结果，仿 ModelTreePanel 样式逐实例展示增删 */}
      {node.instances && node.instances.length > 0 && (
        <ul>
          {node.instances.map((inst, idx) => {
            const isSelected = selectedKey === inst.key;
            const side = inst.side;
            const partSide = side === 'both' ? (node.left || node.right) : node[side];
            const label = partSide ? [partSide.code, partSide.version].filter(Boolean).join('·') : `实例 ${idx + 1}`;
            return (
              <li key={inst.key} className="relative">
                <div
                  onClick={(e) => { e.stopPropagation(); selectCompareKey(inst.key); }}
                  className={`group flex items-center gap-1 py-0.5 pr-2 cursor-pointer select-none text-xs transition-colors
                    ${isSelected ? 'ring-1 ring-inset ring-primary-400 bg-primary-50' :
                      inst.changeType === 'add' ? 'bg-green-50 hover:bg-green-100' :
                      inst.changeType === 'delete' ? 'bg-red-50 hover:bg-red-100' :
                      'hover:bg-gray-50 text-gray-500'}`}
                  style={{ paddingLeft: (depth + 1) * 12 + 28 }}
                >
                  {isSelected && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 rounded-r" />}
                  <span className="truncate flex-1">
                    {inst.changeType === 'add' ? '+ ' : inst.changeType === 'delete' ? '− ' : ''}
                    {label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function CompareTreePanel() {
  const compare = useViewerStore((s) => s.compare);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);

  const view = useMemo(
    () => (compare ? filterCompareTree(compare.tree, compare.onlyDiff) : null),
    [compare],
  );

  if (!compare || !view) return null;

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-500">BOM 对比树</span>
        <button
          onClick={() => selectCompareKey(null)}
          className="text-sm text-gray-400 hover:text-primary-600 transition-colors"
        >
          取消选中
        </button>
      </div>

      <div className="flex items-stretch text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200">
        <span className="shrink-0 w-5" />
        <span className="flex-1 min-w-0 px-2 py-1 truncate">
          左 · {compare.tree.left?.code || '-'} {compare.tree.left?.version || ''}
          {compare.leftMissing && <span className="text-gray-400 ml-1">(无模型)</span>}
        </span>
        <span className="w-px bg-gray-200" />
        <span className="flex-1 min-w-0 px-2 py-1 truncate">
          右 · {compare.tree.right?.code || '-'} {compare.tree.right?.version || ''}
          {compare.rightMissing && <span className="text-gray-400 ml-1">(无模型)</span>}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <ul>
          <Row node={view} depth={0} />
        </ul>
      </div>
    </div>
  );
}
