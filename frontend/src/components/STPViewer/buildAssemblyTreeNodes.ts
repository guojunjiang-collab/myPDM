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

  // 与实例 bom_path 末段一致的 key：多实例展开用 "{bom_item_id}:{idx}"，否则用 bom_item_id。
  // 后端 get_assembly_instances 对多实例链接的 bom_path 用 "{link.id}:{idx}"，
  // get_assembly_tree 则把 idx 放在 instance_index 字段 —— 这里拼回一致的 key，
  // 否则多实例零件的 meshUuids 挂不上，导致上色/高亮/选中对其无效。
  const keyOf = (node: AssemblyTreeNode): string =>
    node.instance_index !== undefined && node.instance_index !== null
      ? `${node.bom_item_id}:${node.instance_index}`
      : node.bom_item_id;

  // 显示名：件号_版本_中文名称_实例顺序号（1基）
  const nameOf = (node: AssemblyTreeNode): string => {
    const code = node.part_code || '';
    const ver = node.version || '';
    const name = node.part_name || '';
    const base = [code, ver, name].filter(Boolean).join('_') || '未命名';
    return node.instance_index !== undefined && node.instance_index !== null
      ? `${base}_${node.instance_index + 1}`
      : base;
  };

  const convert = (node: AssemblyTreeNode, parentId: string | null): TreeNode => {
    const key = keyOf(node);
    const children = node.is_leaf ? [] : node.children.map((c) => convert(c, key));
    const own = meshUuidsByBomItemId.get(key) ?? [];
    const meshUuids = node.is_leaf ? own : children.flatMap((c) => c.meshUuids);
    return {
      id: key,
      name: nameOf(node),
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
