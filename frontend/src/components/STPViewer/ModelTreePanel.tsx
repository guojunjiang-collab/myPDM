import { useEffect, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import type { TreeNode } from './treeTypes';

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
      {visible ? (
        <>
          <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
          <circle cx="8" cy="8" r="2" />
        </>
      ) : (
        <>
          <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
          <path d="M2 2l12 12" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

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

  const indent = 16 + depth * 16;

  return (
    <li className="relative">
      {/* Vertical guide line */}
      {depth > 0 && (
        <div className="absolute top-0 bottom-0" style={{ left: indent - 9 }}>
          <div className="h-full w-px bg-gray-200" />
        </div>
      )}
      <div
        ref={rowRef}
        onClick={() => selectNode(node.id)}
        className={`group flex items-center gap-0.5 py-0.5 pr-2 cursor-pointer select-none text-sm transition-colors relative
          ${selected ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
        style={{ paddingLeft: indent }}
        title={node.name}
      >
        {/* Left accent bar when selected */}
        {selected && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 rounded-r" />}

        {/* Expand/collapse */}
        {isGroup ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-gray-200/60"
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Visibility toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleNodeVisibility(node); }}
          className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-400'}`}
        >
          <EyeIcon visible={visible} />
        </button>

        {/* Name */}
        <span className={`truncate flex-1 ml-0.5 ${visible ? '' : 'text-gray-300 line-through'}`}>
          {node.name}
        </span>

        {/* Child count badge */}
        {isGroup && (
          <span className="text-sm text-gray-400 tabular-nums bg-gray-100 rounded px-1 py-px ml-1">
            {node.children.length}
          </span>
        )}
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
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">模型树</span>
        <button
          onClick={() => selectNode(null)}
          className="text-sm text-gray-400 hover:text-blue-500 transition-colors"
        >
          取消选中
        </button>
      </div>

      {/* Isolate mode toggle */}
      <label className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 cursor-pointer select-none hover:bg-gray-50/50 transition-colors">
        <span className="text-sm text-gray-500">隔离模式</span>
        <div className="relative">
          <input
            type="checkbox"
            checked={isolateMode}
            onChange={(e) => setIsolateMode(e.target.checked)}
            className="sr-only"
          />
          <div className={`w-7 h-4 rounded-full transition-colors ${isolateMode ? 'bg-blue-500' : 'bg-gray-200'}`}>
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${isolateMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </div>
        </div>
      </label>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <ul>
          <NodeRow node={treeData} depth={0} />
        </ul>
      </div>
    </div>
  );
}
