import type { ConfigPreviewTreeNode } from '../../services/api';
import type { TreeNode } from './treeTypes';

/**
 * 将后端 config_tree_nodes 转换为 viewerStore 用的 TreeNode。
 * 初始 meshUuids 为空，后续由 AssemblyModelLoader 通过 @see mergeMeshUuidsIntoConfigTree 回填。
 */
export function buildConfigTreeNodes(node: ConfigPreviewTreeNode | null): TreeNode | null {
  if (!node) return null;

  const convert = (n: ConfigPreviewTreeNode, parentId: string | null): TreeNode => {
    const children = n.children.map((c) => convert(c, n.bom_item_id));
    return {
      id: n.bom_item_id,
      name: n.name,
      type: n.type === 'config_item' ? 'config_item' : 'part',
      meshUuids: [],
      parentId,
      children,
      hasModel: n.has_model,
      partCode: n.part_code || undefined,
    };
  };

  return convert(node, null);
}

/**
 * 将 AssemblyModelLoader 加载得到的 mesh 映射回填到 config 树中。
 *
 * @param configTree   buildConfigTreeNodes 构建的配置项树
 * @param flatTree     后端返回的扁平实例树（AssemblyTreeNode[]，与 instances 一一对应）
 * @param meshMap      AssemblyModelLoader 构建的 { bom_item_id → meshUuid[] }
 */
export function mergeMeshUuidsIntoConfigTree(
  configTree: TreeNode,
  flatTree: { bom_item_id: string; part_code: string }[],
  meshMap: Map<string, string[]>,
): TreeNode {
  const codeToUuids = new Map<string, string[]>();
  for (const f of flatTree) {
    const uuids = meshMap.get(f.bom_item_id);
    if (uuids && uuids.length > 0 && f.part_code) {
      codeToUuids.set(f.part_code, uuids);
    }
  }

  const walk = (node: TreeNode): TreeNode => {
    const children = node.children.map(walk);
    const matched = node.partCode ? (codeToUuids.get(node.partCode) ?? []) : [];
    const meshUuids = matched.length > 0 ? matched : children.flatMap((c) => c.meshUuids);
    return { ...node, meshUuids, children };
  };

  return walk(configTree);
}
