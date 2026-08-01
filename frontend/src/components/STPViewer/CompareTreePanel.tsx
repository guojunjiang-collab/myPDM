import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
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

/**
 * 单侧格子：缺失侧渲染占位。缩进走本格 paddingLeft，保证两格等宽。
 *
 * leading 是格内首位插槽（展开按钮或等宽占位）。展开按钮放在格内而非行首固定槽里，
 * 才能随层级缩进移动、与本层竖线对齐；两格各放一个同宽插槽，文字仍横向对齐。
 */
function SideCell({ side, node, which, indent, leading }: {
  side: CompareSide | null;
  node: CompareNode;
  which: Side;
  indent: number;
  leading: ReactNode;
}) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleCompareSideVisibility);

  if (!side) {
    return (
      <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
        {leading}
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
      {leading}
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
      {/* 增删改的底色已足够表意，不再重复文字标签；
          「位置变」保留 —— 紫色底在这套界面里没有约定俗成的含义，
          且它标的正是后端 BOM diff 看不见的那类变动。 */}
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
      {/* 与 BOM 行的展开按钮等宽占位，保证实例行文字与上级行对齐 */}
      <span className="w-4 shrink-0" />
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

/**
 * 层级参考线：每一行自己画满 1..level 各级竖线段，画在**行内部**。
 *
 * 不能挂在 <li> 上跨子树画一条长线 —— 对比树大量行带变更底色，
 * 行背景会把长线截断成一段一段。改成每行画自己那一段、上下首尾相接，
 * 无论行有没有底色，ladder 都是连续的。
 *
 * 每条线对齐**该层展开按钮的中心**：格内 paddingLeft = 8 + level*12，
 * 按钮宽 16px，故第 k 层按钮中心距格左边 16 + k*12。两格严格等宽
 * （行内只有 两个 flex-1 + 1px 分隔线），右格左边即 50% + 0.5px。
 */
function GuideLines({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <>
      {Array.from({ length: level }, (_, k) => {
        const x = 16 + k * 12;
        return (
          <Fragment key={k}>
            <span
              className="absolute top-0 -bottom-px w-px bg-gray-200 pointer-events-none"
              style={{ left: x }}
            />
            <span
              className="absolute top-0 -bottom-px w-px bg-gray-200 pointer-events-none"
              style={{ left: `calc(50% + ${x + 0.5}px)` }}
            />
          </Fragment>
        );
      })}
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
    <li>
      <div
        onClick={(e) => { e.stopPropagation(); selectCompareKey(inst.key); }}
        className={`relative flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors ${bg}`}
      >
        <GuideLines level={depth + 1} />
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
    <li>
      <div
        ref={rowRef}
        onClick={() => selectCompareKey(node.key)}
        className={`relative flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors
          ${selected
            ? 'ring-1 ring-inset ring-primary-400 bg-primary-50'
            : `${node.changeType === 'none' && node.placementChanged ? 'bg-purple-50' : ROW_BG[node.changeType]} hover:brightness-95`}`}
      >
        <GuideLines level={depth} />
        {/* 展开按钮放在左格内首位，随层级缩进移动、与本层竖线对齐；
            右格放同宽占位，两格仍等宽、分隔线在所有行上齐平 */}
        <SideCell
          side={node.left}
          node={node}
          which="left"
          indent={depth * 12}
          leading={hasChildren || hasInstances ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.key); }}
              className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-gray-200/60"
              title={expanded ? '折叠' : '展开'}
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
        />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell
          side={node.right}
          node={node}
          which="right"
          indent={depth * 12}
          leading={<span className="w-4 shrink-0" />}
        />
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
