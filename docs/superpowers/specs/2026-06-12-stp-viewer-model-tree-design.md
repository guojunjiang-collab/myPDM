# STP 预览 — 装配模型树 + 双向高亮 + 隔离透明

**日期**: 2026-06-12
**状态**: 设计已确认，待 review

## 1. 背景与问题

图文档附件的 STP 三维预览（前端 React + Three.js / @react-three/fiber）目前有几处「写了但没接通」的半成品功能：

1. **`PartHighlighter` 组件已实现但从未挂载** —— 选中零件的包围盒高亮框组件存在（`components/STPViewer/PartHighlighter.tsx`），注释要求加进 `ViewerCanvas` 的 Suspense 块，但 `ViewerCanvas.tsx` 从未引用它，导致高亮框不显示。
2. **点击 3D 模型不触发高亮** —— `ModelLoader.tsx` 的 mesh 点击只调 `selectPart`，未调 `highlightPart`，所以点 3D 零件只"选中"不变色；只有从列表点才会高亮，两条路径行为不一致。
3. **零件面板是扁平列表，非层级树** —— `BOMPanel.tsx` 把所有 Mesh 名平铺成 list，丢弃了装配体的父子层级。
4. **两个入口不一致** —— 弹窗版（`components/STPViewer/index.tsx`）有 `BOMPanel`；独立页版（`pages/STPViewer.tsx`）连零件面板都没有，只有 Canvas + Toolbar。

用户需求：**在渲染界面增加导出模型的「装配层级树」，实现零件可点击高亮，并支持"选中高亮、其余透明"的隔离聚焦观察。**

## 2. 关键前提验证（已完成）

用真实的 Mayo 产物 GLB（`glb_cache/GD40_A/GD40_Assembly-20250807.glb`，`generator: OpenCascade-7.7.0`）解析确认：

- **完整保留装配层级**：1 个根节点，多级子装配嵌套。分组节点（子装配）无 mesh，叶子节点（零件）带 mesh —— 标准 XCAF 装配树结构。
- **命名完美**：子装配中文名（机架组件 / 动力组件 / 起落架组件）+ 零件中文名（上盖 / 底壳 / 电机_1 / 螺旋桨_1…）。
- 结论：**「真正的装配层级树」技术可行**，直接映射 GLB 的 `Object3D` 层级即可。

> 注：Blender 导出的 GLB 可能是扁平的（一个对照样本 33 node 全是根节点）。设计需对"无层级"情况自适应降级，但生产路径（Mayo / OCC）保留层级。

## 3. 设计目标

| 目标 | 说明 |
|---|---|
| 装配层级树面板 | 递归映射 GLB 真实层级，可折叠展开，替换现有扁平 `BOMPanel` |
| 双向高亮联动 | 点树节点 → 3D 高亮；点 3D 零件 → 树定位展开并高亮，单一数据源同步 |
| 隔离透明（可选开关） | 选中后其余零件半透明聚焦；**全局开关，用户随时切换、即时生效** |
| 分组选中 = 整子树高亮 | 选中分组节点时，其下所有层级零件全部高亮，组外透明 |
| 两入口统一 | 弹窗版与独立页版都使用新的 `ModelTreePanel` |
| 修复已有 bug | 接通 `PartHighlighter`；修复点 3D 不高亮 |

## 4. 架构（分层）

### 4.1 数据层 — `buildModelTree(scene)`
新建纯函数（建议 `components/STPViewer/buildModelTree.ts`），递归遍历 `gltf.scene` 的 `Object3D` 层级，产出树：

```ts
interface TreeNode {
  id: string;              // 稳定 id，优先 mesh.name / object.name，回退 uuid
  name: string;            // 显示名（中文零件/子装配名）
  type: 'group' | 'part';  // group=子装配(无mesh) / part=零件(有mesh)
  meshUuids: string[];     // 该节点(含子树)关联的所有 mesh uuid，用于高亮/透明
  children: TreeNode[];
}
```

- 分组节点（无 mesh 的 Object3D / Group）→ 可折叠分支
- 零件节点（带 Mesh）→ 叶子
- `meshUuids` 在分组上聚合整个子树的 mesh，支撑"选中分组=整子树高亮"
- **自适应**：若场景无层级（所有 mesh 平铺），退化为单层列表，不报错

### 4.2 状态层 — `viewerStore` 扩展
```ts
treeData: TreeNode | null;        // 解析出的树
selectedNodeId: string | null;    // 选中节点（树与 3D 共用）
isolateMode: boolean;             // 隔离透明开关，默认 true
expandedIds: Set<string>;         // 树展开状态
// actions
setTreeData / selectNode / setIsolateMode / toggleExpanded / expandToNode
```
保留现有 `visibleParts`（显隐白名单）、`highlightedPartId`。`selectedNodeId` 统一选中语义，逐步收敛现有 `selectedPartId` / `highlightedPartId` 的重叠。

### 4.3 3D 层 — `ModelLoader` 改造 + 接通 `PartHighlighter`
在现有遍历 `useEffect`（`ModelLoader.tsx`）中加入高亮/隔离逻辑：

```
选中节点的 meshUuids 集合 = S（叶子为单个，分组为整子树）
遍历每个 Mesh：
  if selectedNodeId 存在:
    mesh ∈ S       → 实色 + emissive 高亮
    mesh ∉ S 且 isolateMode → transparent=true, opacity=0.12, depthWrite=false
    mesh ∉ S 且 !isolateMode → 正常实色（仅不高亮）
  else:
    全部恢复 opacity=1, transparent=false, 无 emissive
```

- `isolateMode` 切换 → effect 依赖触发，**即时重算**当前选中项的透明度
- **接通 `PartHighlighter`**：在 `ViewerCanvas` 的 Suspense 块内挂载 `<PartHighlighter url={url} />`，渲染选中节点的包围盒框（分组取整子树包围盒）
- **修复点击**：`ModelLoader` 的 mesh `onClick` → `selectNode(节点id)` + `expandToNode`，使 3D 点击与树选中一致

### 4.4 UI 层 — `ModelTreePanel` 替换 `BOMPanel`
新建 `components/STPViewer/ModelTreePanel.tsx`：

- 可折叠层级树（▸/▾），缩进体现层级；递归渲染 `TreeNode`
- 节点点击 → `selectNode` + 双向高亮 + 隔离（受 `isolateMode`）
- 勾选框 → 显隐，复用 `visibleParts`；分组勾选联动其整个子树
- 点 3D 零件 → 树自动展开到该节点并滚动到可视区、高亮
- **面板顶部放「隔离模式」开关**（控制 `isolateMode`，显眼、即时生效）
- 自适应：无层级时渲染为单层列表（等价旧 `BOMPanel` 体验）

### 4.5 应用范围
- 弹窗版 `components/STPViewer/index.tsx`：`BOMPanel` → `ModelTreePanel`
- 独立页版 `pages/STPViewer.tsx`：补上 `ModelTreePanel`（当前无任何面板）
- `BOMPanel.tsx` 在两处都替换后删除（或保留为内部降级渲染，二选一，实现时定）

## 5. 核心交互规格

### 5.1 隔离透明开关（用户重点诉求）
- **全局开关**，默认开启，放树面板顶部
- 多层级工作流：看大组整体 → 开透明隔离无关组件；钻进去看子组件 → 关透明，在完整上下文里点击查看内部
- 切换开关瞬间，按当前 `selectedNodeId` 重算所有 mesh 透明度，无需重新点击

### 5.2 分组选中 = 整子树高亮
选中分组节点（如"动力组件"）→ 其下所有层级零件（动力结构组件、动力线路组件及各自零件）全部实色高亮，组外其余透明。依赖分组节点的 `meshUuids` 聚合整子树。

### 5.3 双向联动
- 树 → 3D：点节点高亮对应 mesh（+ 包围盒）
- 3D → 树：点 mesh 反查所属 `TreeNode`，展开路径 + 滚动 + 高亮
- 单一数据源 `selectedNodeId`，两侧始终同步

## 6. 非目标（YAGNI）

- 不与 PDM 数据库 BOM / 构型 BOM 做关联映射（本次仅基于几何模型树；如需另立项目）
- 不改后端 Mayo 转换流程（层级已满足需求）
- 不做树节点搜索/过滤、多选（首版聚焦层级树 + 高亮 + 隔离）

## 7. 测试要点

- `buildModelTree`：用真实 Mayo GLB（GD40_Assembly）断言层级结构、`meshUuids` 聚合正确；扁平 GLB 断言降级为单层
- 隔离开关：开/关切换即时反映到 mesh 透明度
- 分组选中：整子树高亮、组外透明
- 双向联动：点 3D ↔ 点树 选中态一致
- 两入口：弹窗版与独立页版均渲染 `ModelTreePanel`

## 8. 风险

- **深层嵌套性能**：113 节点/96 网格规模下遍历高亮在每次选中重算，需确保 effect 只在 `selectedNodeId` / `isolateMode` 变化时触发，避免逐帧重算。
- **材质共享**：多个 mesh 可能共享同一 `material` 实例，改 opacity 会互相影响 —— 需在改透明前确认是否要 clone material，实现时验证。
- **id 稳定性**：`buildModelTree` 的节点 id 若用 mesh.name，存在重名风险（同名零件）；需结合路径或 uuid 保证唯一。
