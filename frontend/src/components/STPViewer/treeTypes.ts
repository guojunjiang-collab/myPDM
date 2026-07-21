export interface TreeNode {
  /** 稳定唯一 id，取自 Object3D.uuid 或后端映射 */
  id: string;
  /** 显示名（中文零件/子装配名） */
  name: string;
  /** group=子装配 / part=零件 / config_item=构型项 */
  type: 'group' | 'part' | 'config_item';
  /** 该节点(含整个子树)关联的所有 mesh uuid，用于高亮/透明/包围盒/显隐 */
  meshUuids: string[];
  /** 父节点 id，根为 null，用于 3D→树 展开祖先 */
  parentId: string | null;
  children: TreeNode[];
  /** 是否有3D模型（config 模式专用），false 时模型树灰显 */
  hasModel?: boolean;
  /** 零部件件号（config 模式专用），用于回填 meshUuids */
  partCode?: string;
}
