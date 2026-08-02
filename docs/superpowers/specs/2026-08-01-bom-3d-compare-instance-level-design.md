# BOM 3D 对比：实例级匹配 Design Spec

## 目标

把 BOM 3D 对比从"按 BOM 行比对"下沉到"按零件实例比对"：同一零件在装配中的每一个摆放实例都参与比对，**件号、版本、空间位置三者全同才算同一个实例**，位置或版本不同则按删除 / 新增处理。3D 场景与对比树都按实例级结果着色。

本 spec 是 [2026-08-01-bom-3d-compare-design.md](2026-08-01-bom-3d-compare-design.md) 的增量，只描述与其不同的部分；未提及的决定（叠加单画布、左右并排双树、显示模式与过滤工具、坐标不对齐、双向联动、缺模型降级、后端零改动）全部沿用。

## 修正：现有矩阵匹配从未生效

`CompareModelLoader` 里 `groupLeft` / `groupRight` 以 `bomItemId` 为键分组，再取 `groupLeft.get(id)` 与 `groupRight.get(id)` 做匹配。但 `bom_items` 是按 `parent_revision_id` 存的行，左右两个版本下的同一个零件必然是**两个不同的 bom_item id**，因此对任意 `id`，两个 group 中只会有一个非空——`matchInstances` 永远走"左侧全 delete、右侧全 add"分支，3D 中不存在灰色未变件。

根因是把 `bom_item id` 当成了左右共有的身份。修法：**分组键改为配对行 key**（`CompareNode.key`，即件号链），它本身就已经把左右两侧配好了。现有的 `leftIndex` / `rightIndex`（bomItemId → nodeKey）正好用来做这层映射。

## 匹配身份：revision_id

"件号 + 版本"在数据上等价于一个 `PartRevision`。`AssemblyInstance` 没有 version 字段，但有 `revision_id`——直接用它作匹配身份，比拼 `part_code + version` 更准且无歧义。

## 位置相同的判定

平移与旋转分开设阈值，两者都满足才算同一位置。分开是因为两者量纲不同，用同一个数比没有物理意义。

| 量 | 比法 | 阈值 |
|---|---|---|
| 平移 | 欧氏距离 | `POSITION_TOLERANCE = 0.01`（mm） |
| 旋转 | 3×3 分量最大绝对差 | `ROTATION_TOLERANCE = 1e-4`（约 0.006°） |

阈值写死为模块常量，不做界面可调。0.01mm 在机械装配里远小于任何有意义的位置变动，同时足以吸收 CATIA 重新导出带来的浮点噪声。

**不再使用 `toFixed(4)` 串比**：一是舍入边界会抖（`0.00005` 与 `0.000049999` 落到不同串），二是同一装配重新导出后矩阵尾数几乎必然变化，4 位小数在 mm 单位下约等于要求二进制完全一致。

容差匹配无法用 Map 查表，退化为逐个线性比对，复杂度 O(N×M)。N、M 是同一零件在同一装配下的实例数（通常个位数到几十），无需空间索引。

## 匹配算法

左侧按序贪心：对每个左实例，找第一个"未被占用、`revisionId` 相同、`isSamePlacement` 为真"的右实例配对，标 `none`；配不上标 `delete`。右侧剩余全部标 `add`。

贪心不保证全局最优，但在 0.01mm 容差下两个候选同时命中意味着两个零件几乎重叠——现实装配里不出现，因此解唯一。

## 新模块：matchInstances.ts

把匹配逻辑从加载器里抽出来，成为可单测的纯函数模块。

```ts
export const POSITION_TOLERANCE = 0.01;
export const ROTATION_TOLERANCE = 1e-4;

/** 参与匹配的实例引用 */
export interface InstanceRef {
  /** 在所属侧 instances 数组中的下标 */
  index: number;
  /** 行主序 4×4，平移在下标 3/7/11，旋转为 0,1,2,4,5,6,8,9,10 */
  matrix: number[];
  /** 件号+版本的等价身份 */
  revisionId: string;
}

/** 一条匹配结果 */
export interface InstanceMatch {
  changeType: 'none' | 'add' | 'delete';
  side: 'left' | 'right' | 'both';
  leftIndex?: number;
  rightIndex?: number;
}

export function isSamePlacement(a: number[], b: number[]): boolean;
export function matchInstancePairs(left: InstanceRef[], right: InstanceRef[]): InstanceMatch[];
```

`matchInstancePairs` 的返回顺序即树中的显示顺序：先左侧全部（按左侧原序），再追加右侧未匹配项。

## 3D 着色

实例级只有三种状态，正好对上现有 `renderDecision` 的语义——**`compareRenderRules.ts` 一行都不用改**，只是入参从节点 `changeType` 换成实例 `changeType`。

| 实例状态 | 颜色 | 叠加 | 只看左 | 只看右 |
|---|---|---|---|---|
| `none` 匹配上 | 灰 `0xB4B2A9` | 只画左份（避免重合几何 z-fighting） | 画左份 | 画右份 |
| `delete` 仅左 | 红 `0xE24B4A` | 画 | 画 | 不画 |
| `add` 仅右 | 绿 `0x639922` | 画 | 不画 | 画 |

两侧实例仍全部加载入场，由 `useCompareVisualState` 按当前显示模式控制 `visible`，切换模式不重新下载模型。

匹配不到实例记录的 mesh（例如该节点无实例数据）回退到节点级 `changeType`，与现有实现一致。

### 连带简化：幽灵不再服务 modify

实例级不存在 `modify` 状态——版本不同的实例会被判成 delete + add，不会配成一对。因此"叠加模式下 modify 件左侧画成幽灵"这条规则在实例路径上没有对应物，`ghostCandidates` 恒为空集。

幽灵透明度滑块保留，用途缩减为两个：隔离模式下未选中的零件、`仅显示差异` 开启时的未变件。`useCompareVisualState` 无需改动。

## 对比树呈现

沿用 A 方案（两层结构）：BOM 行按件号层级排布，**只有叶子零件行往下拆实例子行**；装配体行下面挂的仍是它的子 BOM 行，不按实例拆成多行。

### 布局约束（沿用原 spec，当前实现已违反，需修正）

原 spec 定的是：**单一滚动容器；每行是一个 flex 行；行内两格等宽**。实例子行必须遵守同一套骨架，否则左右列对不齐。

当前 `InstanceRow` 把 `paddingLeft: (depth + 1) * 12 + 28` 加在**外层 flex 行**上，缩进吃掉整行左边，左格被压窄、两格不再等宽，也与上方 BOM 行的分栏错位。

修正：所有行统一骨架 —— 固定宽度的展开按钮槽（BOM 行放 chevron，实例行留空占位）+ 两个 `flex-1 min-w-0` 的格子 + 中间 1px 分隔线。**层级缩进移到左右两格各自的 `paddingLeft` 里**，两格取相同缩进值。这样两格永远等宽、分隔线在所有行上处于同一水平位置，同时缩进仍能体现层级。

- **BOM 行**：背景按 `node.changeType`（新增 `bg-green-50` / 删除 `bg-red-50` / 修改与子项变化 `bg-yellow-50`），文本 `件号_版本_名称 ×数量`，行右侧补一个小字变更标签：新增 / 删除 / 修改 / 子项变。数量显示实际实例数。
- **实例子行**：背景按 `inst.changeType`（未变无底色、删除 `bg-red-50`、新增 `bg-green-50`），左右两格，缺失侧显示 `—` 占位；字号比 BOM 行小一档，缩进更深；两格各带眼睛按钮。
- **共享序号**：整个配对列表统一编号 1..N，删除项与新增项都占号。因此左列出现 `_1 _2 _3`、右列出现 `_1 _3 _4 _5` 这类带空档的序列——匹配上的实例在两侧序号相同，一眼能对上。
- 实例显示名：`件号_版本_名称_序号`，左右两格各取自己那侧的 `CompareSide`（版本可能不同）。

视觉参考：[bom-compare-tree-preview.html](../plans/bom-compare-tree-preview.html)。

## 测试

新增 `matchInstances.test.ts`：

- 同 revision、同位置 → `none`
- 平移差 0.005mm（容差内）→ 仍 `none`
- 平移差 0.05mm（超容差）→ `delete` + `add`
- revision 不同、位置相同 → `delete` + `add`
- 旋转分量差 1e-5 → `none`；差 1e-3 → `delete` + `add`
- 数量 3→5 且其中 2 个位置匹配 → 2 个 `none` + 1 个 `delete` + 3 个 `add`
- 返回顺序为"左侧原序 + 右侧未匹配追加"，据此编号 1..N 连续无跳号
- 左空右非空 → 全 `add`；左非空右空 → 全 `delete`；两侧皆空 → 空数组
- 同一右实例不会被两个左实例重复占用

`buildCompareTree` / `compareRenderRules` / `compareTreeFilter` 及其现有测试不改，必须保持全绿。3D 渲染本身不做自动化测试，由手动验收覆盖。

## 文件清单

**新增**
- `frontend/src/components/STPViewer/matchInstances.ts`
- `frontend/src/components/STPViewer/matchInstances.test.ts`

**修改**
- `frontend/src/components/STPViewer/CompareModelLoader.tsx` — 分组键改为配对行 key；删除内联的 `matrixKey` / `matchInstances`，改调新模块；实例查找由矩阵串比改为按 index 直接定位
- `frontend/src/components/STPViewer/CompareTreePanel.tsx` — 修正实例行布局（缩进移入两格内、恢复两格等宽）、BOM 行变更标签、实例行样式对齐参考 HTML

**不动**
- `compareTypes.ts`（`CompareInstanceNode` 已有 `seq` / `label` / `leftIndex` / `rightIndex`）
- `compareRenderRules.ts`、`compareTreeFilter.ts`、`buildCompareTree.ts`、`useCompareVisualState.ts`、`viewerStore.ts`
- 后端全部文件

## 验收标准

1. 两个部件的同一零件、同版本、同位置的实例，在 3D 中显示为**灰色**且只渲染一份（当前是满屏红绿，无灰件）。
2. 同零件同版本但位置移动超过 0.01mm 的实例，左侧显示红色、右侧显示绿色。
3. 同零件同位置但版本不同的实例，判为删除 + 新增（红 + 绿），不判为未变。
4. 位置差异在 0.01mm 以内的实例仍判为未变——用同一装配重新导出的 STEP 验证，不应出现整体红绿。
5. 数量 3→5 的零件，对比树该行展开后有 5 条实例子行，颜色分别对应匹配结果；左右序号一一对齐，缺失侧显示 `—`。
6. BOM 行右侧显示变更标签（新增 / 删除 / 修改 / 子项变），数量显示实际实例数。
7. 切换 `只看左`：未变实例显示左份、删除实例显示、新增实例消失；`只看右` 对称。
8. 实例行的眼睛按钮可单独隐藏该实例。
9. 树为单一滚动容器；BOM 行与实例行的左右两格等宽，中间分隔线在所有行上处于同一水平位置（缩进不破坏分栏）。
10. 现有全部单测保持绿，`npm run lint` 与 `npm run build` 通过。
11. 现有单件 / 装配 / 配置清单三种预览模式行为不变。
