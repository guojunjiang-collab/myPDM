import type { AssemblyTreeNode } from '../../services/api';
import type { TreeNode } from './treeTypes';

/**
 * 把后端嵌套 BOM 树(AssemblyTreeNode) + 每个 BOM 链接的 mesh uuid 集合，
 * 转成 viewerStore 用的 TreeNode（与单件 buildModelTree 输出同构）。
 *
 * 这样装配模式的树面板/高亮/隔离/显隐全部走 viewerStore，与单件模式共用一套逻辑。
 *
 * @param tree 后端 assembly-tree（顶层是数组）
 * @param meshUuidsByBomItemId  bom_item_id → 该链接所有实例的 mesh uuid（叶子才有）
 */
export function buildAssemblyTreeNodes(
  tree: AssemblyTreeNode[],
  meshUuidsByBomItemId: Map<string, string[]>,
): TreeNode | null {
  if (!tree || tree.length === 0) return null;

  const convert = (node: AssemblyTreeNode, parentId: string | null): TreeNode => {
    const children = node.is_leaf ? [] : node.children.map((c) => convert(c, node.bom_item_id));
    const own = meshUuidsByBomItemId.get(node.bom_item_id) ?? [];
    const meshUuids = node.is_leaf ? own : children.flatMap((c) => c.meshUuids);
    const label = `${node.part_code}${node.part_name ? ' ' + node.part_name : ''}`.trim() || '未命名';
    return {
      id: node.bom_item_id,
      name: node.instance_count > 1 ? `${label} ×${node.instance_count}` : label,
      type: node.is_leaf ? 'part' : 'group',
      meshUuids,
      parentId,
      children,
    };
  };

  if (tree.length === 1) return convert(tree[0], null);

  // 多个顶层 → 合成虚拟根
  const virtualId = 'assembly-root';
  const children = tree.map((n) => convert(n, virtualId));
  return {
    id: virtualId,
    name: '装配',
    type: 'group',
    meshUuids: children.flatMap((c) => c.meshUuids),
    parentId: null,
    children,
  };
}
