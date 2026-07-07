import type { AssemblyTreeNode } from '../../services/api';
import { useAssemblyStore } from './assemblyViewerStore';

function TreeRow({ node, depth }: { node: AssemblyTreeNode; depth: number }) {
  const selectedId = useAssemblyStore((s) => s.selectedBomItemId);
  const hidden = useAssemblyStore((s) => s.hiddenBomItemIds.has(node.bom_item_id));
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);
  const toggleHidden = useAssemblyStore((s) => s.toggleHidden);

  const instanceIdx = (node as any).instance_index;
  const nodeId = instanceIdx !== undefined ? `${node.bom_item_id}:${instanceIdx}` : node.bom_item_id;
  const isSel = selectedId === nodeId;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 cursor-pointer text-sm ${isSel ? 'bg-primary-100 text-primary-700' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => selectBomItem(isSel ? null : nodeId)}
      >
        <button
          className="text-xs opacity-60 hover:opacity-100 w-5 text-center"
          onClick={(e) => { e.stopPropagation(); toggleHidden(node.bom_item_id); }}
          title={hidden ? '显示' : '隐藏'}
        >{hidden ? '👁' : '🙈'}</button>
        <span className="truncate">{node.part_code}</span>
      </div>
      {node.children.map((c, i) => <TreeRow key={`${c.bom_item_id}_${i}`} node={c} depth={depth + 1} />)}
    </div>
  );
}

export function AssemblyTreePanel({ tree }: { tree: AssemblyTreeNode[] }) {
  return (
    <div className="py-1">
      {tree.map((n, i) => <TreeRow key={`${n.bom_item_id}_${i}`} node={n} depth={0} />)}
    </div>
  );
}
