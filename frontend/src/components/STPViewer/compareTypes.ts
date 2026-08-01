/** BOM 对比 3D 模式的共享类型。纯类型文件，不放逻辑。 */

/** 变更类型。internal（子项变化）后端不产出，由 buildCompareTree 派生。 */
export type ChangeType = 'none' | 'add' | 'delete' | 'modify' | 'internal';

/** 场景显示模式：叠加 / 只看左 / 只看右 */
export type DisplayMode = 'both' | 'left' | 'right';

export type Side = 'left' | 'right';

/** 配对行中的单侧数据 */
export interface CompareSide {
  /** bom_item id，与 AssemblyInstance.bom_path 末段对应；根节点为空串 */
  bomItemId: string;
  code: string;
  name: string;
  version: string;
  quantity: number | null;
  /** 该侧此节点(含子树)关联的 mesh uuid，由加载器增量回填 */
  meshUuids: string[];
  /** 该侧是否存在 3D 模型；false 时树中灰显并标"无模型" */
  hasModel: boolean;
}

/** 配对树节点：一行 = 一个节点，行内左右两格分别渲染 left / right */
export interface CompareNode {
  /** 稳定唯一 key，取自 BOMCompareNode.key（件号链）；根节点为 'ROOT' */
  key: string;
  parentKey: string | null;
  /** 与后端一致，0 = 根装配的直接子项；根节点为 -1 */
  level: number;
  changeType: ChangeType;
  left: CompareSide | null;
  right: CompareSide | null;
  children: CompareNode[];
}
