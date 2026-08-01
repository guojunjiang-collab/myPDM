import { useEffect, useMemo, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { filterCompareTree } from './compareTreeFilter';
import type { CompareNode, CompareSide, ChangeType, Side, CompareInstanceNode } from './compareTypes';

const ROW_BG: Record<ChangeType, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-yellow-50',
  none: '',
};

const CHANGE_LABEL: Record<ChangeType, string> = {
  add: '新增',
  delete: '删除',
  modify: '修改',
  internal: '子项变',
  none: '',
};

const CHANGE_LABEL_COLOR: Record<ChangeType, string> = {
  add: 'text-green-600',
  delete: 'text-red-600',
  modify: 'text-yellow-600',
  internal: 'text-yellow-600',
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

/** 单侧格子：缺失侧渲染占位。缩进走本格 paddingLeft，保证两格等宽。 */
function SideCell({ side, node, which, indent }: {
  side: CompareSide | null;
  node: CompareNode;
  which: Side;
  indent: number;
}) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleCompareSideVisibility);

  if (!side) {
    return (
      <div className="flex-1 min-w-0 flex items-center px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
        <span className="text-gray-300 italic text-xs">—</span>
      </div>
    );
  }

  const visible = side.meshUuids.length === 0 ? true : side.meshUuids.some((u) => !hiddenParts.has(u));
  const noModel = !side.hasModel;
  const label = [side.code, side.version, side.name].filter(Boolean).join('_');
  // 数量只统计**本格这一侧**存在的实例：node.instances 是左右并集
  // （左侧全部 + 右侧未匹配上的），直接用其长度会让两格显示同一个并集数。
  const count = node.instances && node.instances.length > 0
    ? node.instances.filter((i) => i.side === 'both' || i.side === which).length
    : side.quantity;

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
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
        {count !== null && count !== undefined && <span className="text-gray-400 ml-1">×{count}</span>}
        {noModel && <span className="text-gray-400 ml-1">(无模型)</span>}
      </span>
      {which === 'right' && node.changeType !== 'none' && CHANGE_LABEL[node.changeType] && (
        <span className={`shrink-0 text-[10px] ${CHANGE_LABEL_COLOR[node.changeType]}`}>
          {CHANGE_LABEL[node.changeType]}
        </span>
      )}
      {which === 'right' && node.changeType === 'none' && node.placementChanged && (
        <span className="shrink-0 text-[10px] text-purple-600">位置变</span>
      )}
    </div>
  );
}

/** 实例行的单侧格子 */
function InstanceCell({ present, label, meshUuids, indent }: {
  present: boolean;
  label: string;
  meshUuids: string[];
  indent: number;
}) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleMeshes);
  // 一个实例含三档 LOD、每档可能多个 mesh：只要还有一个没被隐藏就算可见
  const visible = meshUuids.length === 0 || meshUuids.some((u) => !hiddenParts.has(u));

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
      {present && meshUuids.length > 0 ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMeshes(meshUuids); }}
          className={`w-3.5 h-3.5 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500' : 'text-gray-300'}`}
          title={visible ? '隐藏' : '显示'}
        >
          <EyeIcon visible={visible} />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className={`truncate flex-1 text-[11px] ${visible ? 'text-gray-600' : 'text-gray-300 line-through'}`}>
        {present ? label : <span className="text-gray-300 italic">—</span>}
      </span>
    </div>
  );
}

/** 两格各自的层级参考线：左格线在 19+indent 处，右格线在 50%+9.5+indent 处（两格严格等宽） */
function GuideLines({ indent }: { indent: number }) {
  return (
    <>
      <div className="absolute top-0 bottom-0 w-px bg-gray-200 pointer-events-none" style={{ left: 19 + indent }} />
      <div className="absolute top-0 bottom-0 w-px bg-gray-200 pointer-events-none" style={{ left: `calc(50% + ${9.5 + indent}px)` }} />
    </>
  );
}

/** 实例行：与 BOM 行同一套骨架（展开槽 + 两格等宽 + 分隔线），缩进走格内 padding */
function InstanceRow({ inst, depth, node }: { inst: CompareInstanceNode; depth: number; node: CompareNode }) {
  const selectedKey = useViewerStore((s) => s.compare?.selectedKey ?? null);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);
  const isSelected = selectedKey === inst.key;
  const inLeft = inst.side === 'left' || inst.side === 'both';
  const inRight = inst.side === 'right' || inst.side === 'both';
  const indent = (depth + 1) * 12;

  // 左右两侧件号/版本可能不同，各取自己那侧的 CompareSide
  const labelOf = (s: CompareSide | null) =>
    [s?.code, s?.version, s?.name, inst.seq].filter(Boolean).join('_');

  const bg = isSelected
    ? 'bg-primary-50 ring-1 ring-inset ring-primary-400'
    : inst.changeType === 'add'
      ? 'bg-green-50 hover:bg-green-100'
      : inst.changeType === 'delete'
        ? 'bg-red-50 hover:bg-red-100'
        : 'hover:bg-gray-50';

  return (
    <li className="relative">
      <GuideLines indent={indent} />
      <div
        onClick={(e) => { e.stopPropagation(); selectCompareKey(inst.key); }}
        className={`flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors ${bg}`}
      >
        <div className="shrink-0 w-5" />
        <InstanceCell present={inLeft} label={labelOf(node.left)} meshUuids={inst.leftMeshUuids} indent={indent} />
        <div className="w-px bg-gray-200 shrink-0" />
        <InstanceCell present={inRight} label={labelOf(node.right)} meshUuids={inst.rightMeshUuids} indent={indent} />
      </div>
    </li>
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
  const hasInstances = !!node.instances && node.instances.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && rowRef.current) rowRef.current.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li className="relative">
      {depth > 0 && <GuideLines indent={depth * 12} />}
      <div
        ref={rowRef}
        onClick={() => selectCompareKey(node.key)}
        className={`flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors
          ${selected
            ? 'ring-1 ring-inset ring-primary-400 bg-primary-50'
            : `${node.changeType === 'none' && node.placementChanged ? 'bg-purple-50' : ROW_BG[node.changeType]} hover:brightness-95`}`}
      >
        {/* 展开槽宽度固定，不随层级变化 —— 缩进走两格各自的 paddingLeft，
            这样两格永远等宽、分隔线在所有行上处于同一水平位置 */}
        <div className="shrink-0 w-5 flex items-center justify-center">
          {hasChildren || hasInstances ? (
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
        <SideCell side={node.left} node={node} which="left" indent={depth * 12} />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell side={node.right} node={node} which="right" indent={depth * 12} />
      </div>

      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} />)}
        </ul>
      )}

      {/* 实例子行：按矩阵匹配结果，逐实例展示，仿 ModelTreePanel 样式 */}
      {hasInstances && expanded && (
        <ul>
          {node.instances?.map((inst) => (
            <InstanceRow key={inst.key} inst={inst} depth={depth} node={node} />
          ))}
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
        <span className="w-px bg-gray-200 shrink-0" />
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
