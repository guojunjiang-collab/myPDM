# STP 查看器「自动上色」设计文档

日期：2026-06-24
分支：dev

## 背景

STP 三维查看器（`frontend/src/components/STPViewer/`）将 STEP 经 Mayo/OpenCascade 转为 glTF 后用 three.js（@react-three/fiber）渲染。许多 STEP 模型导出后零件颜色单一（灰），装配体中相邻零件难以区分，可读性差。

现状要点（已核对）：
- glTF 经 `GLTFLoader` 加载；`ModelLoader.tsx` 在加载后把每个单材质 mesh 的 `material` 克隆为独立 `MeshStandardMaterial`，避免共享材质互相影响。
- 装配树 `TreeNode`（`type: 'group' | 'part'`，`part` 节点含 `meshUuids`）；`viewerStore` 维护 `nodeMap`、`meshOwner`。
- 选中高亮/隔离逻辑（`ModelLoader.tsx` 的 effect）只修改 mesh 材质的 `emissive`/`opacity`/`depthWrite`/`wireframe`，**不修改 `material.color`**。
- Toolbar 已有统一的 toggle 按钮样式（线框/平行/测量等）。

## 目标

在工具栏提供「上色」开关：开启时按**零件名称**为零部件自动着色（同名同色、异名异色），提高装配体可读性；关闭时还原模型原始颜色。

## 非目标

- 不做手动逐零件调色 / 调色板编辑。
- 不持久化颜色到后端（纯前端、随会话）。
- 不改动 STEP→glTF 转换链路。
- 不处理多材质（数组材质）mesh 的着色（与现有样式逻辑一致，跳过）。

## 总体方案

新增纯函数着色模块 + viewerStore 开关 + ModelLoader 的着色 effect + Toolbar 按钮。着色只改 `material.color`，与既有选中/隔离/线框（改 emissive/opacity/wireframe）正交，可叠加。

### 1. 颜色分配算法（`autoColor.ts`，纯函数、可单测）

```ts
// 给定一组零件名称，返回 name -> 颜色(hex number) 的映射
export function buildColorMap(names: string[]): Map<string, number>
```

实现：
- 取传入名称的**去重集合**并按字典序排序（保证确定性）。
- 对第 i 个名称，色相 `h = (i * 137.508) % 360`（黄金角，均匀铺满色相环、相邻区分度高）。
- 固定 `S=55%`、`L=55%`（灰底 `#e8e8e8` 上辨识度高且不过曝）。
- HSL→RGB→packed hex number（three `Color` 兼容）。
- 空数组返回空 Map；同名必得同色（来自同一 i）。

> 选择"按当前模型出现的名称均匀铺色相"而非"名称哈希→色相"：对实际存在的零件分得最开、最易区分；代价是跨不同模型同名零件颜色不保证一致（本特性只要求同一模型内稳定）。

### 2. viewerStore 开关

`ViewerState` 增加：
- `autoColor: boolean`（initialState 中默认 `false`）
- `toggleAutoColor: () => void` → `set({ autoColor: !get().autoColor })`
- `reset()` 一并恢复 `autoColor: false`（随 initialState）。

### 3. 原始色捕获 + 着色 effect（`ModelLoader.tsx`）

**原始色捕获**：在已有"克隆材质"步骤之后，建立一个 `useRef<Map<string, number>>`（meshUuid → 原始 color hex），遍历单材质 mesh 记录 `material.color.getHex()`。该 Map 在模型加载时填充一次。

**着色 effect**（新增，依赖 `[autoColor, treeData, nodeMap]`）：
- 若 `!groupRef.current || !treeData` → 直接返回。
- `autoColor === true`：
  - 收集所有 `type==='part'` 节点的 `name`，`buildColorMap(names)` 得到 name→color。
  - 遍历这些 part 节点：对其每个 `meshUuid` 对应的单材质 mesh，设 `material.color.setHex(colorMap.get(node.name))`、`needsUpdate = true`。
- `autoColor === false`：
  - 遍历原始色 Map，对每个 mesh 还原 `material.color.setHex(origHex)`、`needsUpdate = true`。
- 多材质 mesh（`Array.isArray(material)`）跳过。

> 着色不触碰 `emissive`/`opacity`，因此与选中/隔离/线框 effect 互不覆盖。两 effect 依赖不同，互不触发。

### 4. Toolbar 按钮

在「线框」按钮旁新增「上色」toggle，样式复用现有 active/inactive 类：

```tsx
const autoColor = useViewerStore((s) => s.autoColor);
const toggleAutoColor = useViewerStore((s) => s.toggleAutoColor);
// ...
<button onClick={toggleAutoColor}
  className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
    ${autoColor ? 'bg-blue-50 text-blue-600 border border-blue-200'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}>
  上色
</button>
```

## 数据流

```
点「上色」→ toggleAutoColor → autoColor=true
   ModelLoader 着色 effect:
     part 节点名称集合 → buildColorMap → mesh.material.color.setHex(...)
关「上色」→ autoColor=false → 从原始色 Map 还原
（选中/隔离/线框 effect 各自独立，仅改 emissive/opacity/wireframe）
```

## 错误处理 / 边界

- 模型未加载完成 / 无 treeData：着色 effect 直接返回。
- 多材质 mesh：跳过着色与还原。
- 关闭后再开启：复用已填充的原始色 Map，不重复捕获。
- `meshOwner`/`nodeMap` 已由 `setTreeData` 维护；着色直接用 part 节点的 `meshUuids` 定位 mesh。

## 测试

单测 `autoColor.test.ts`（vitest，纯函数）：
- 同名输入 → 同色；不同名 → 不同色（合理数量内）。
- 返回值为合法 packed hex（0..0xffffff）。
- 空数组 → 空 Map；重复名称去重后仍稳定。
- 确定性：同一输入多次调用结果一致。

手测（Docker 部署后）：
- 打开多零件装配体 STP → 开「上色」：零件按名称着色、同名同色、相邻区分明显。
- 着色态下：选中高亮、隔离半透明、线框、剖切、爆炸仍正常。
- 关「上色」：还原模型原始颜色。

## 影响与取舍

- 纯前端、无后端/转换链路改动，无数据库迁移。
- 颜色随会话，不持久化。
- 跨模型同名零件颜色不保证一致（仅同一模型内稳定）。

## 文件

- 新增 `frontend/src/components/STPViewer/autoColor.ts`、`autoColor.test.ts`
- 修改 `frontend/src/stores/viewerStore.ts`（autoColor 状态 + toggle + reset）
- 修改 `frontend/src/components/STPViewer/ModelLoader.tsx`（原始色捕获 + 着色 effect）
- 修改 `frontend/src/components/STPViewer/Toolbar.tsx`（「上色」按钮）
