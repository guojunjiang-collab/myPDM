import type { CompareNode } from './compareTypes';

/**
 * 「仅显示差异」剪枝：隐藏 change_type === 'none' 的纯未变子树，
 * 但保留含差异子孙的父节点（否则差异项会失去路径上下文）。
 *
 * 返回新树，不修改入参。onlyDiff=false 时直接返回原引用（避免无谓重渲染）。
 */
export function filterCompareTree(root: CompareNode, onlyDiff: boolean): CompareNode {
  if (!onlyDiff) return root;

  const prune = (node: CompareNode): CompareNode | null => {
    const children = node.children
      .map(prune)
      .filter((c): c is CompareNode => c !== null);
    if (node.changeType === 'none' && !node.placementChanged && children.length === 0) return null;
    return { ...node, children };
  };

  const children = root.children
    .map(prune)
    .filter((c): c is CompareNode => c !== null);
  return { ...root, children };
}
