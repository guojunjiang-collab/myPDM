# BOM 3D 对比 Design Spec

## 目标

在「BOM 对比」弹窗中新增「3D对比」入口，进入 3D 预览界面后，把左右两个部件的三维模型放进**同一个场景叠加显示**，按 BOM 变更类型着色，左侧配一组**左右并排、行对齐的模型树**，使"这一版改了什么、改在哪儿"能被直接看见。

在现有 STPViewer 上做升级改造，新增第四种数据源模式 `compare`，不影响已有的单件 / 装配 / 配置清单三种模式。

## 范围

**做**：叠加场景 + 变更着色、左右并排对齐模型树、显示模式与过滤工具、双向联动选中、缺模型降级。

**不做**：几何级差异比对（不判断"这个零件的形状变了没有"，变更判定完全来自 BOM 对比结果）；分屏双画布；坐标系自动对齐；导出对比报告。

## 架构

- **后端**：零改动。所需数据全部来自现有接口。
- **前端**：STPViewer 页面新增 `compare` 模式；新增 `CompareModelLoader`、`CompareTreePanel`、`buildCompareTree`；`viewerStore` 增加可选 `compare` 分片；`Toolbar` 增加对比模式专属控件组。
- **权限**：沿用现有 `bom:compare`（对比弹窗入口）与装配查看接口自身权限，不新增权限点。

### 复用接口（全部现成）

| 接口 | 用途 |
|------|------|
| `bomApi.compare(leftRevId, rightRevId)` | BOM 差异结果，提供每个节点的 `change_type` 与左右两侧 `bom_item.id` |
| `assemblyViewerApi.instances(revId)` ×2 | 左右两侧的零件实例（GLB 三档 LOD URL + 世界矩阵 + `bom_path`） |
| `assemblyViewerApi.tree(revId)` ×2 | 左右两侧的装配树（提供层级与多实例序号） |

### 数据对接关键

`BOMCompareNode.left.id` / `right.id` 是 bom_item 的 id；`AssemblyInstance.bom_path` 的末段是 `{bom_item_id}` 或 `{bom_item_id}:{实例序号}`。两者直接对得上，因此变更类型可以无损映射到具体实例，无需新增任何后端字段。

## 数据流

```
PartCompareModal → [🧊 3D对比] → window.open('/stp-viewer?compare-left=<revId>&compare-right=<revId>')
  → STPViewer 识别 compare 模式，并发拉取 5 个接口
      bomApi.compare(L, R)
      assemblyViewerApi.instances(L) / tree(L)
      assemblyViewerApi.instances(R) / tree(R)
  → buildCompareTree(comparison, leftTree, rightTree) → CompareNode[]（配对树）
  → viewerStore.setCompareTree(...)：树立即渲染，画布可交互
  → CompareModelLoader 按渲染规则流式加载两侧实例，逐个把 mesh uuid 并回配对树
  → 用户操作：显示模式 / 仅显示差异 / 幽灵透明度 / 选中联动
```

## 核心数据结构

### CompareNode（配对树节点）

两棵树在数据层就配成一棵树，而不是两棵独立树各自渲染。**这是行对齐、展开联动、滚动联动能免费成立的原因**：一行就是一个 `CompareNode`，行内左右两格分别渲染 `left` / `right`，缺失的一侧渲染占位。

```ts
export type ChangeType = 'none' | 'add' | 'delete' | 'modify' | 'internal';

export interface CompareSide {
  /** bom_item id（根节点为空串） */
  bomItemId: string;
  code: string;
  name: string;
  version: string;
  quantity: number | null;
  /** 该侧此节点(含子树)关联的 mesh uuid */
  meshUuids: string[];
  /** 是否有可用 3D 模型；false 时该格灰显并标"无模型" */
  hasModel: boolean;
}

export interface CompareNode {
  /** 稳定唯一 key，取自 BOMCompareNode.key；根节点为 'ROOT' */
  key: string;
  parentKey: string | null;
  level: number;
  changeType: ChangeType;
  left: CompareSide | null;
  right: CompareSide | null;
  children: CompareNode[];
}
```

`buildCompareTree(comparison, leftTree, rightTree)` 是**纯函数**：把 `BOMCompareNode[]` 扁平列表按 `path` 还原成树（复用 PartCompareModal 里已验证的 path 前缀逻辑，但抽成独立函数并补齐任意层级递归，不再像弹窗里那样硬编码到四层），再从两侧 `AssemblyTreeNode` 补上 `hasModel` 与多实例信息。

### viewerStore 扩展

在现有单例 store 上增加一个**可选分片**，`compare === null` 时所有现有行为逐字节不变：

```ts
compare: {
  tree: CompareNode[];
  nodeMap: Map<string, CompareNode>;
  /** mesh uuid → { key, side }，供 3D 点选反查配对行 */
  meshOwner: Map<string, { key: string; side: 'left' | 'right' }>;
  displayMode: 'both' | 'left' | 'right';
  onlyDiff: boolean;
  ghostOpacity: number;        // 默认 0.12，范围 0.02–0.5
  selectedKey: string | null;  // 配对行 key，左右同时选中
  leftMissing: boolean;        // 该侧无任何实例
  rightMissing: boolean;
} | null
```

不新建独立 store、不做 Context 化改造：场景仍是单画布，剖切 / 测量 / 爆炸 / 相机 / 线框 / ViewCube 全部原样复用当前单例 store。选中锚点从 `selectedNodeId` 换成 `compare.selectedKey`，由 `CompareModelLoader` 自己解析成 mesh 集合。

## 渲染规则（叠加场景）

坐标：**两侧实例矩阵原样使用**（STEP 世界坐标），不做任何对齐补偿。左右装配同源时天然重合；若某版重新导出导致原点漂移，表现为整体错位——已知取舍，出现后再议。

按变更类型决定画哪一侧，避免重合几何 z-fighting：

| change_type | 画左侧 | 画右侧 | 颜色 |
|---|---|---|---|
| `none` 未变 | ✅ | ❌（几何与左侧相同，不重复渲染） | 灰 `#B4B2A9` |
| `modify` 修改 | ✅ 幽灵透明度 | ✅ 实体 | 黄 `#EF9F27` |
| `add` 新增 | —（左侧不存在） | ✅ 实体 | 绿 `#639922` |
| `delete` 删除 | ✅ 实体 | —（右侧不存在） | 红 `#E24B4A` |
| `internal` 子项变化 | 本身是组，不直接渲染，由子项各自决定 | | |

`modify` 两侧都画，是为了让"同一零件不同版本的形状差异"能被看出来——这是叠加模式相对分屏唯一不可替代的价值。

### 显示模式与过滤

| 控件 | 类型 | 行为 |
|---|---|---|
| `叠加 / 只看左 / 只看右` | 三选一 | 叠加＝上表规则；只看左＝仅渲染左侧实例（未变件也只有左侧，天然一致）、右侧全部不渲染；只看右＝对称，且未变件改为渲染右侧实例 |
| `仅显示差异` | 勾选 | 树中隐藏 `change_type === 'none'` 的行（父节点若含差异子孙则保留）；3D 中未变件**不隐藏**，降为幽灵透明度作为空间参照 |
| `幽灵透明度` | 滑块 0.02–0.5 | 统一控制所有"淡出"对象的不透明度 |

**幽灵透明度作用于三类对象**（共用一个值，界面上只有一个滑块）：
1. 隔离模式下未被选中的零件；
2. `仅显示差异` 开启时的未变件；
3. 叠加模式下 `modify` 件的左侧（旧版本）那一份。

「只看左 / 只看右」是**完全不渲染**另一侧，不走幽灵——"只看"取字面含义。

### 着色与现有「上色」开关

compare 模式下变更着色接管配色，工具栏的「上色」按钮**禁用并置灰**（`title` 说明"对比模式下按变更类型着色"）。两者互斥，不做叠加，否则变更色会被自动色覆盖、失去意义。

### 多实例粒度

同一 `bom_item` 若有多个实例（`bom_path` 末段带 `:idx`），高亮 / 显隐 / 着色一律**按 bom_item 整体作用于其全部实例**，与现有装配模式行为一致。配对树不下钻到实例级。

### 加载性能

不设实例数量硬上限。沿用现有机制：三档 LOD、按装配树 DFS 顺序流式加载、GLB 按 URL 缓存。左右两版共用的零件 GLB URL 相同，`sceneCache` 天然去重，只下载一次——实例数翻倍但下载量远小于翻倍。进度角标显示两侧合计 `已加载 n/N`。

## 组件设计

### 页面：STPViewer.tsx

新增第四种模式分支，与现有 `assembly` / `config-profile` / `id&token` 并列：

```
params: ?compare-left=<revId>&compare-right=<revId>
```

并发拉取 5 个接口 → `buildCompareTree` → `setCompareTree` → 渲染
`<ViewerCanvas source={{ kind: 'compare', left, right, compareTree }} />`。

顶部在任一侧缺模型时显示提示条：`右部件尚无 3D 模型，仅显示左侧`。

### CompareTreePanel.tsx（新增）

替代 compare 模式下的 `ModelTreePanel`（后者保持原样服务其余三种模式）。

布局：单一滚动容器，每行是一个 flex 行，行内两格等宽：

```
┌ 左 · GB-100 V1 ─────────┬ 右 · GB-100 V2 ─────────┐
│ ▾ 齿轮箱总成            │ ▾ 齿轮箱总成            │
│   箱体 ×1               │   箱体 ×1               │
│   输入轴 V1        [黄] │   输入轴 V2        [黄] │
│   —                     │   滚针轴承 ×2      [绿] │
│   垫片 ×1          [红] │   —                     │
│ ▸ 输出组件         [黄] │ ▸ 输出组件         [黄] │
└─────────────────────────┴─────────────────────────┘
```

- 展开/折叠按钮只在行首出现一次，作用于整行（左右同时展开）——**联动是结构性的，不需要同步代码**。
- 缺失侧渲染虚线占位格。
- 行背景按 `changeType` 着色，与 PartCompareModal 表格同一套配色（`bg-green-50 / bg-red-50 / bg-yellow-50`），保持认知一致。
- 无模型的格灰显 + `(无模型)` 角标，沿用现有 `TreeNode.hasModel` 的呈现惯例。
- 每格保留独立的显隐眼睛按钮（可单独隐藏某一侧的某个件）。

### CompareModelLoader.tsx（新增）

与 `AssemblyModelLoader` 同构，差异在于：加载两组实例、按渲染规则决定画哪侧、着色来自 `changeType` 而非自动上色、mesh uuid 并回 `compare.meshOwner`（带 side 标记）。

初始取景用**两侧实例位置的合并粗包围盒**做一次预取景，加载完成后若用户未交互再做一次精确取景——沿用现有做法。

### CompareVisualState（新增 hook）

compare 模式下的视觉态施加，替代 `useSceneVisualState`（后者保持原样服务其余三种模式）。职责：按 `selectedKey`、`displayMode`、`onlyDiff`、`ghostOpacity`、`hiddenParts` 计算每个 mesh 的 `visible / opacity / emissive / color`。

两个 hook 有重复逻辑（线框、显隐、选中高亮），但语义已经分叉（单选 vs 配对选、单一色源 vs 变更色源），强行合并会得到一个满是 `if (compare)` 的函数。保持两份、各自单一职责。

### Toolbar.tsx（改造）

compare 模式下（`compare !== null`）在现有控件左侧插入一组专属控件：显示模式三选一按钮组、`仅显示差异` 勾选、`幽灵` 滑块。同时禁用「上色」按钮。其余控件（剖切 / 测量 / 爆炸 / 重置 / 相机 / 线框）保持可用。

### PartCompareModal.tsx（改造）

按钮行加「🧊 3D对比」，左右均已选中即可点击（**不要求先点「开始对比」**，新页面自己拉 compare 数据）。样式沿用现有 primary 按钮惯例。

## 交互：双向联动选中

- 点左树或右树任一格 → `selectedKey` 设为该行 key → 两格同时高亮 → 3D 中该行**左右两侧的实例同时高亮**（新增/删除只有一侧存在则只亮一侧）。
- 点 3D 模型 → 经 `compare.meshOwner` 反查得到 `{key, side}` → 选中该配对行 → 沿 `parentKey` 上溯展开所有祖先 → 行滚动进视野。
- `Esc` 或点击空白 → 取消选中，与现有行为一致。
- 隔离模式开启时，未选中件降为幽灵透明度（不隐藏），与「仅显示差异」共用同一个滑块值。

## 降级与错误处理

| 情况 | 行为 |
|---|---|
| 一侧 `instances` 返回空数组 | 照常进入。两棵树完整渲染（树来自 BOM，与 3D 无关），该侧整体灰显，顶部提示条说明；3D 只画有数据的一侧 |
| 两侧都为空 | 树正常显示，画布区显示「两个部件均无 3D 模型」 |
| 单个零件 GLB 缺失 / 转换失败 | 沿用现有 loader 行为：`console.warn` 后跳过该件，不影响整体；该行标 `(无模型)` |
| `bomApi.compare` 失败 | 整页错误态「对比数据加载失败，请关闭后重试」（没有差异结果就无从着色，不降级） |
| 某侧 `instances`/`tree` 请求失败 | 视同该侧无模型，走缺模型降级 |
| URL 缺少 `compare-left` 或 `compare-right` | 整页错误态，与现有 `id/token` 缺失处理一致 |

## 测试

沿用现有 `*.test.ts` + vitest 惯例，重点测纯函数：

- `buildCompareTree.test.ts`
  - 扁平 `comparison` 按 path 正确还原任意深度树（现有弹窗逻辑只硬编码到四层，本函数须递归，用 5 层用例锁死）
  - 增 / 删 / 改 / 未变 / 内部变更 五种 `change_type` 各自的左右侧填充与占位
  - `hasModel` 从两侧装配树正确回填
  - 多实例零件（`bom_item_id:idx`）归并到同一配对节点
- `compareRenderRules.test.ts`（渲染规则抽成纯函数便于测试）
  - 三种显示模式 × 五种 change_type 的「画哪侧、什么颜色、是否幽灵」矩阵
  - `onlyDiff` 开启时未变件仍渲染、但透明度为 ghost 值
- `compareTreeFilter.test.ts`
  - `仅显示差异` 时，含差异子孙的父节点保留、纯未变子树整体隐藏

3D 渲染本身不做自动化测试（沿用现有惯例），由手动验收覆盖。

## 文件清单

**新增**
- `frontend/src/components/STPViewer/buildCompareTree.ts` + `.test.ts`
- `frontend/src/components/STPViewer/compareRenderRules.ts` + `.test.ts`
- `frontend/src/components/STPViewer/compareTreeFilter.ts` + `.test.ts`
- `frontend/src/components/STPViewer/CompareTreePanel.tsx`
- `frontend/src/components/STPViewer/CompareModelLoader.tsx`
- `frontend/src/components/STPViewer/useCompareVisualState.ts`
- `frontend/src/components/STPViewer/compareTypes.ts`

**改造**
- `frontend/src/pages/STPViewer.tsx` — 新增 compare 模式分支
- `frontend/src/components/STPViewer/ViewerCanvas.tsx` — `ViewerSource` 增加 `kind: 'compare'`
- `frontend/src/stores/viewerStore.ts` — 增加可选 `compare` 分片及其 actions
- `frontend/src/components/STPViewer/Toolbar.tsx` — compare 专属控件组、禁用「上色」
- `frontend/src/components/PartCompareModal.tsx` — 「🧊 3D对比」入口按钮

**不动**
- `ModelTreePanel.tsx` / `useSceneVisualState.ts` / `AssemblyModelLoader.tsx` / `ModelLoader.tsx` — 服务其余三种模式，保持原样
- 后端全部文件

## 验收标准

1. BOM 对比弹窗选中左右两个部件后，「3D对比」按钮可点，新标签打开 3D 对比界面。
2. 左侧呈现左右并排、行对齐的两棵树；增删项在对侧显示虚线占位；展开/折叠与滚动天然联动。
3. 3D 场景中新增件为绿、删除件为红、修改件为黄（旧版半透明+新版实体）、未变件为灰。
4. 切换 `只看左 / 只看右 / 叠加`，场景按规则正确增减实例；未变件在只看模式下也正确显示对应侧。
5. 勾选 `仅显示差异`：树中未变行消失（含差异子孙的父节点保留），3D 中未变件降为幽灵透明度而非消失。
6. 拖动幽灵透明度滑块，所有淡出对象的不透明度实时跟随。
7. 点击任一树格或 3D 模型，两侧树行同时高亮并滚动进视野，3D 中左右两侧对应实例同时高亮。
8. 一侧无装配模型时，两棵树仍完整渲染，顶部出现提示条，3D 只显示有模型的一侧。
9. 剖切 / 测量 / 爆炸 / 重置 / 相机切换 / 线框 在对比模式下均可正常使用；「上色」按钮置灰。
10. 现有单件 / 装配 / 配置清单三种预览模式行为完全不变。
