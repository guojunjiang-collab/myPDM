# 装配 3D 预览流式加载 设计

- 日期：2026-07-24
- 分支：dev
- 状态：设计定稿，待实现

## 背景与问题

零部件详情中，若零部件是装配（`isAssembly`），点击「3D预览」会打开新标签页
`/stp-viewer?assembly=<revisionId>`，由 `AssemblyModelLoader` 加载。

当前加载流程（`frontend/src/components/STPViewer/AssemblyModelLoader.tsx`）存在体验问题：

1. 用 `for...of` 顺序遍历所有 `instances`，**每个零件先并行下载 coarse+normal+fine 三档 LOD** 才处理下一个。
2. `setTreeData(...)` 只在**整个循环跑完之后**才调用（约 line 155）。
3. `setLoadingState('ready')` 只在**最后**调用（约 line 177）。
4. 模型树面板（`ModelTreePanel`）与画布仅在 `loadingState === 'ready'` 时才显示；此前
   `STPViewer.tsx` 的「正在解析渲染」遮罩（`absolute inset-0 z-30`）**全屏覆盖画布并吞掉鼠标事件**。

结果：大装配打开后，用户面对空白遮罩长时间等待，**整机加载完之前既看不到模型树、看不到任何零件，也无法旋转/缩放/平移**。

## 目标

- 打开预览后**模型树立即全量显示**（来自已获取的 BOM 树数据），带每节点加载状态。
- 画布**立即可交互**：加载过程中即可旋转/缩放/平移。
- 零件**按模型树顺序逐个加载完就弹出显示**，顶部显示「已加载 X/Y」进度。
- 相机**首个零件加入时自动取景一次**；收尾自动 refit **让位于用户交互**（用户已操作过相机则不抢镜头）。

## 非目标（YAGNI）

- 不做「粗模先行、后台升级」的两趟加载（改动大、状态复杂），保留现有每件三档 LOD 一次性加载。
- 不改后端：instances/tree/GLB 接口与转换流程不动。
- 不改单件（`?id=`）预览路径——单件仅一个 GLB，无流式意义。

## 方案：渐进显示（progressive display）

改动集中在三处，**无后端依赖**：

1. `frontend/src/components/STPViewer/AssemblyModelLoader.tsx` — 加载编排
2. `frontend/src/stores/viewerStore.ts` — 增量更新树节点 mesh 映射 + 流式进度状态
3. `frontend/src/pages/STPViewer.tsx` — 用非阻塞进度角标替换全屏遮罩

### 1. 模型树立即显示

在加载循环**开始前**，用空 mesh 表构建并写入树：

```
setTreeData(buildAssemblyTreeNodes(tree, new Map()))   // 装配模式
// config 模式：mergeMeshUuidsIntoConfigTree(displayTree, tree, new Map())
```

此时所有节点已渲染，`meshUuids` 为空。`ModelTreePanel` 中 `meshUuids.length === 0` 的节点
本就按「无 mesh」处理（可见性视为 true、不显示眼睛按钮），无需改面板。

### 2. 画布立即可见且可交互

- 循环前即 `setLoadingState('ready')`，让树面板与画布挂载。
- `STPViewer.tsx` 中把「正在解析渲染」的全屏阻塞遮罩（`state === 'ready' && loadingState !== 'ready'`
  分支）改为一个**不覆盖画布、不挡交互**的小进度角标（右上或顶部工具栏旁），显示「已加载 X/Y」。
- `ArcballControls`（`CameraController`）在画布挂载后即活动，用户可自由旋转/缩放/平移。

### 3. 零件流式加入

保留 per-instance 循环；每个零件的 LOD 加入 `rootGroup` 后：

- 调用新 store 方法 `mergeInstanceMeshes(bomItemId, meshUuids)`，把该零件所有层级 mesh uuid
  合并进对应叶子树节点，并同步刷新 `meshOwner`（使已加载零件的显隐/高亮/隔离/选中立即可用）。
- 更新流式进度 `streamProgress = { loaded, total }`。

加载**顺序**：按模型树（BOM）显示顺序加载，使画面自上而下填充。若 `instances` 顺序与树顺序
不一致，先按 `bom_path`/树顺序对 `instances` 排序后再循环。

> 注意：`rootGroup` 已在场景图中（通过 `<primitive>`），因此每加入一个 LOD，该零件即刻可见——
> 天然的逐件弹出，无需额外触发渲染。

### 4. 相机取景，让位于用户交互

- 新增 `firstFitDone` 与 `userInteracted` 两个局部标志（loader 内 `useRef`）。
- **首个零件**加入且 `!firstFitDone` 时：按当前 `rootGroup` 包围盒 fit 一次（缩放居中 + 保存
  `initialState`），置 `firstFitDone = true`。
- **全部加载完**：仅当 `!userInteracted` 时再做一次收尾 refit（此时装配完整，取景更准）；用户已
  交互过则跳过，不抢镜头。
- `userInteracted` 通过监听 `ArcballControls` 的 `change` 事件或画布 `pointerdown` 置位。
  为避免把「程序化 fit 本身触发的 change」误判为用户交互，程序化 fit 期间设一个抑制窗口
  （fit 前后短暂忽略 change，或用「fit 由代码发起」布尔闸门）。

### 数据流

```
STPViewer(assembly) --instances/tree--> AssemblyModelLoader
  ├─ setTreeData(空mesh树) + setLoadingState('ready')      // 立即：树+画布可见可交互
  └─ for inst in 排序后的 instances:
        load 三档 LOD -> clone/贴矩阵 -> rootGroup.add(lod)  // 零件弹出
        mergeInstanceMeshes(leafBom, uuids)                 // 树节点补 mesh
        streamProgress.loaded++                              // 进度角标
        if 首个: fitToView(); firstFitDone=true
     结束: if !userInteracted: fitToView()                  // 收尾 refit（让位交互）
```

## viewerStore 改动

新增：

- 状态：`streamProgress: { loaded: number; total: number } | null`
- 动作：`setStreamProgress(p)`
- 动作：`mergeInstanceMeshes(nodeId: string, meshUuids: string[])`
  - 在现有 `treeData` 中定位 `nodeId` 节点，把 `meshUuids` 并入其 `meshUuids`（去重）。
  - 同步把这些 uuid 注册进 `meshOwner`（指向该节点），并更新 `nodeMap`。
  - 以不可变方式 `set(...)` 触发面板重渲染。

`reset()` 需一并清空 `streamProgress`。

## 兼容性

- **config 清单预览**（`displayTree` 存在）共用 `AssemblyModelLoader`：
  - 立即显示的树改用 `mergeMeshUuidsIntoConfigTree(displayTree, tree, new Map())`。
  - 流式合并 mesh 时，config 树节点的 id 体系与装配树不同——`mergeInstanceMeshes` 按
    `nodeId` 查找即可，但需确认 config 模式下叶子 `bomItemId` 能映射到 config 树节点 id；
    若不能，config 模式退化为「循环结束一次性 `setTreeData`」（保持现状），仅装配模式启用
    增量流式。实现时以此为准，避免破坏 config 预览。
- **单件预览**（`ModelLoader`）：不涉及。

## 错误处理

- 单个零件加载/转换失败：沿用现有 `try/catch + continue`，进度 total 仍计入但该件不弹出；
  可在该零件对应树节点标注失败态（可选，非本期必须）。
- 全部零件均失败：`rootGroup` 空、包围盒为空 → 跳过 fit；树仍显示（节点无 mesh）。

## 测试

- `viewerStore.test.ts` 补单测：
  - `mergeInstanceMeshes` 正确并入 mesh、更新 `meshOwner`/`nodeMap`、去重、不可变更新。
  - `setStreamProgress` / `reset` 清空。
- UI 流式行为（逐件弹出、进度角标、加载中可交互、fit 让位）难以单测，`npm run build` +
  `tsc --noEmit` 通过后走人工验证（因本地自签名证书+需登录，无法自动化端到端）。

## 风险

- 主要风险：增量更新树节点 mesh 映射的一致性 → 用 store 方法封装 + 单测覆盖。
- 次要风险：`userInteracted` 与程序化 fit 触发的 change 误判 → 用抑制窗口/闸门隔离。
- config 模式 id 映射不确定 → 实现时若无法安全增量，则 config 保持一次性 setTreeData。
