export interface TreeNode {
  /** 稳定唯一 id，取自 Object3D.uuid */
  id: string;
  /** 显示名（中文零件/子装配名） */
  name: string;
  /** group=子装配(无mesh) / part=零件(有mesh) */
  type: 'group' | 'part';
  /** 该节点(含整个子树)关联的所有 mesh uuid，用于高亮/透明/包围盒/显隐 */
  meshUuids: string[];
  /** 父节点 id，根为 null，用于 3D→树 展开祖先 */
  parentId: string | null;
  children: TreeNode[];
}
