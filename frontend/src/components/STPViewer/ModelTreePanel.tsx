import { useEffect, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import type { TreeNode } from './treeTypes';

function NodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const expandedIds = useViewerStore((s) => s.expandedIds);
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const selectNode = useViewerStore((s) => s.selectNode);
  const toggleExpanded = useViewerStore((s) => s.toggleExpanded);
  const toggleNodeVisibility = useViewerStore((s) => s.toggleNodeVisibility);

  const isGroup = node.type === 'group' && node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const selected = selectedNodeId === node.id;
  const visible = node.meshUuids.some((u) => !hiddenParts.has(u));
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <li>
      <div
        ref={rowRef}
        onClick={() => selectNode(node.id)}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer select-none text-xs transition-colors
          ${selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.name}
      >
        {isGroup ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={visible}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleNodeVisibility(node)}
          className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-500 cursor-pointer shrink-0"
        />
        <span className={`truncate flex-1 ${visible ? '' : 'text-gray-300 line-through'}`}>{node.name}</span>
        {isGroup && <span className="text-[10px] text-gray-400 tabular-nums">{node.children.length}</span>}
      </div>
      {isGroup && expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ModelTreePanel() {
  const treeData = useViewerStore((s) => s.treeData);
  const loadingState = useViewerStore((s) => s.loadingState);
  const isolateMode = useViewerStore((s) => s.isolateMode);
  const setIsolateMode = useViewerStore((s) => s.setIsolateMode);
  const selectNode = useViewerStore((s) => s.selectNode);

  if (loadingState !== 'ready' || !treeData) return null;

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">模型树</span>
        <button
          onClick={() => selectNode(null)}
          className="text-[11px] text-gray-400 hover:text-primary-600 cursor-pointer"
        >
          取消选中
        </button>
      </div>

      {/* 隔离开关 */}
      <label className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isolateMode}
          onChange={(e) => setIsolateMode(e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-500"
        />
        <span className="text-[11px] text-gray-600">隔离模式（选中后其余透明）</span>
      </label>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-0.5">
        <ul>
          <NodeRow node={treeData} depth={0} />
        </ul>
      </div>
    </div>
  );
}
