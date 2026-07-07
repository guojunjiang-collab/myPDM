import { useState } from 'react';
import type { AssemblyTreeNode } from '../../services/api';
import { useAssemblyStore } from './assemblyViewerStore';

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="currentColor">
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

function TreeRow({ node, depth }: { node: AssemblyTreeNode; depth: number }) {
  const selectedId = useAssemblyStore((s) => s.selectedBomItemId);
  const hiddenIds = useAssemblyStore((s) => s.hiddenBomItemIds);
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);
  const toggleHidden = useAssemblyStore((s) => s.toggleHidden);

  const instanceIdx = (node as any).instance_index;
  const nodeId = instanceIdx !== undefined ? `${node.bom_item_id}:${instanceIdx}` : node.bom_item_id;
  const isSel = selectedId === nodeId;
  const hidden = hiddenIds.has(node.bom_item_id);
  const hasChildren = node.children && node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div className={`flex items-center gap-1 py-0.5 cursor-pointer text-sm group ${isSel ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
        style={{ paddingLeft: depth * 14 + 4 }}>
        {/* 展开/折叠 */}
        <span className="w-4 shrink-0 flex items-center justify-center" onClick={(e) => { e.stopPropagation(); if (hasChildren) setExpanded(!expanded); }}>
          {hasChildren ? <Chevron expanded={expanded} /> : <span className="w-3.5" />}
        </span>
        {/* 眼睛图标 */}
        <span className="w-4 shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); toggleHidden(node.bom_item_id); }}>
          <EyeIcon visible={!hidden} />
        </span>
        {/* 名称（点击选中） */}
        <span className="truncate flex-1" onClick={() => selectBomItem(isSel ? null : nodeId)}>
          {node.part_code}
        </span>
        {node.instance_count > 1 && !instanceIdx && (
          <span className="text-gray-400 text-xs">×{node.instance_count}</span>
        )}
      </div>
      {hasChildren && expanded && node.children.map((c, i) => (
        <TreeRow key={`${c.bom_item_id}_${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function AssemblyTreePanel({ tree }: { tree: AssemblyTreeNode[] }) {
  return (
    <div className="py-1 select-none">
      {tree.map((n, i) => <TreeRow key={`${n.bom_item_id}_${i}`} node={n} depth={0} />)}
    </div>
  );
}
