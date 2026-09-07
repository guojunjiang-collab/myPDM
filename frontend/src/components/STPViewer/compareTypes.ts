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
  /** 按实例矩阵匹配后的子实例列表；非空时显示实例明细行 */
  instances?: CompareInstanceNode[];
  /** 该行自身或其子孙存在"仅位置变动"——件号/版本/数量都没变，但实例位置对不上。
      与后端的 changeType 正交：只在 changeType === 'none' 的行上判定，不与增删改抢语义。 */
  placementChanged?: boolean;
}

/** 单个实例节点：由左右两侧矩阵匹配生成。
 *  可以是叶子实例（有几何，leftMeshUuids/rightMeshUuids 回填），
 *  也可以是多实例装配的中间实例（无几何，children 挂该实例下的 BOM 子项行）。 */
export interface CompareInstanceNode {
  /** 唯一 key，形如 parentKey:inst:idx */
  key: string;
  /** modify = 左右件号相同但版本不同（版本变更，同一实例）；'both' 表示左右两侧都参与匹配 */
  changeType: ChangeType; // 'add' | 'delete' | 'modify' | 'none' | 'internal'(中间实例聚合)
  /** 该实例所属侧别；'both' 表示左右矩阵匹配 */
  side: Side | 'both';
  /** 该实例在源侧 instance 数组中的序号（仅叶子实例有） */
  leftIndex?: number;
  rightIndex?: number;
  /** 左侧那份几何的全部 mesh uuid（含三档 LOD 的每个 mesh；加载后回填，无左份时为空数组） */
  leftMeshUuids: string[];
  /** 右侧那份几何的全部 mesh uuid（含三档 LOD 的每个 mesh；加载后回填，无右份时为空数组） */
  rightMeshUuids: string[];
  /** 实例在同父节点下的序号（1-based） */
  seq: number;
  /** 该实例下的 BOM 子项行（中间实例展开后显示；递归挂更深实例层） */
  children?: CompareChildRow[];
}

/** 实例上下文中的 BOM 子项行视图：同一 BOM 行在不同实例下各自实例化一份。
 *  node 是左右配对的 BOM 行（渲染左右格子的数据源）；
 *  instances 是该行在此实例上下文下的实例层；children 是该行的 BOM 子项行。 */
export interface CompareChildRow {
  /** 唯一 key：父实例 key + 子 BOM key */
  key: string;
  /** 对应的 BOM 配对行（左右格子数据源） */
  node: CompareNode;
  /** 该子项行在此实例上下文下的实例层（递归） */
  instances?: CompareInstanceNode[];
  /** 该行在此实例上下文下的 BOM 子项行（单实例行无实例层时仍有子项行） */
  children?: CompareChildRow[];
}
