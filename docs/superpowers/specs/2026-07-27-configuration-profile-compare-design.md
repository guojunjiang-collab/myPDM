# 构型配置对比功能 — 设计方案

> 日期：2026-07-27
> 状态：设计定稿，待实施

## 一、目标与范围

在「构型管理 → 构型配置」中新增**两个构型配置(Profile)之间的对比功能**，让用户直观看到两份配置的正式清单差异（新增/删除/修改），用于评估不同型号、不同架次配置之间的区别。

**核心决策（来自需求澄清）：**

1. **对比对象**：两个不同的构型配置(Profile)。
2. **对比范围**：各取其**正式配置清单（仅已选项）**，即 `is_selected || is_required` 的构型项节点与其内部 `is_selected || is_required` 的零部件。
3. **来源状态不限**：草稿 / 评审中 / 生效中 / 已驳回 / 已归档 的配置**都可被选来对比**（每个配置在草稿阶段即已有勾选清单）。
4. **差异维度**：
   - 零部件：新增 / 删除，以及同件号的 **版本 / 数量 / 状态** 变化记为「修改」。
   - 构型项：新增 / 删除，以及**自底向上卷积**——自身数量变化，或其内部任一子零部件/子构型项发生变化，则该构型项也标记为「修改」。
5. **入口**：`构型配置` 列表页工具栏加「配置对比」按钮，打开全屏对比弹窗。
6. **输出与渲染**：**嵌套树形结构**（非扁平），渲染为可展开/折叠的树表。

**实现取向**：纯前端算差异（`configurationProfileApi.get` 已返回完整 `config_tree`），**无后端改动**。差异逻辑抽为纯函数便于单测，视觉复用现有构型清单树表与 BOM 对比的差异高亮风格。

## 二、架构与文件

| 文件 | 类型 | 职责 |
|------|------|------|
| `frontend/src/lib/profileCompare.ts` | 新增 | 纯函数 `diffProfileTrees(left, right)`：输入两棵 `config_tree`，输出嵌套对比树 + 汇总。无 React、无 IO。 |
| `frontend/src/lib/profileCompare.test.ts` | 新增 | 纯函数单测（vitest）。 |
| `frontend/src/components/Configuration/ProfileCompareModal.tsx` | 新增 | 对比弹窗：左右选择器 + 汇总条 + 树表 + 折叠/仅看差异 + 行点详情。 |
| `frontend/src/components/Configuration/ProfileList.tsx` | 修改 | 工具栏加「配置对比」按钮与弹窗挂载。 |

**数据流**：选左右配置 → 各调一次 `configurationProfileApi.get(id)` 取 `config_tree` → `diffProfileTrees` 算差异 → 渲染。选择器数据用 `configurationProfileApi.list`（所有状态）。

**复用**：差异底色/单元格高亮尽量复用 `pages/BOM/helpers.ts`（`getRowBgClass`、`CHANGED_CELL_CLASS`）；如需构型专用微调则抽独立小 helper，不改 BOM 版。树渲染仿 `ProfileEditModal.renderFormalRows` 的递归写法与展开态管理（`Set<nodeKey>`）。

## 三、差异算法 `diffProfileTrees`（核心，纯函数）

输入：两棵 `ConfigTreeNode`（left、right，可为 null）。

### 3.1 取正式清单
递归过滤两棵树：只保留 `is_selected || is_required` 的构型项节点；节点内只保留 `is_selected || is_required` 的零部件。与现有「正式配置清单」口径一致（必选项纳入）。

### 3.2 匹配键（按业务编号，非 id）
两配置可能关联不同构型项版本，故按编号匹配：
- **构型项节点**：按从根到该节点的**构型号链（code-path）**匹配，避免同号在不同父级下被错配。
- **零部件**：按 **（所属节点 code-path，件号 item_code）** 匹配。

### 3.3 逐层并集遍历
每层把左右子节点构型号取并集，按构型号排序（`localeCompare('zh-CN', { numeric: true })`）；节点内零部件按件号并集排序。保证左右对齐、顺序稳定。

### 3.4 change_type 判定
- **零部件**：仅右有→`add`；仅左有→`delete`；两侧都有→比较 `item_version`/`quantity`/`item_status`，有差异→`modify` 且 `changed_fields` 记录具体字段，否则 `none`。
- **构型项节点（自底向上卷积）**：仅右有→`add`；仅左有→`delete`；两侧都有→若自身 `quantity` 变化**或**任一子零部件/子构型项为 `add`/`delete`/`modify`→`modify`，否则 `none`。

### 3.5 输出：嵌套对比树
```ts
type ChangeType = 'add' | 'delete' | 'modify' | 'none';

interface PartSide {
  item_id: string;      // master id，供行点详情
  item_code: string;
  item_name: string;
  item_type: string;    // part / assembly / component
  item_version?: string;
  item_status?: string;
  quantity?: number;
}
interface ConfigItemSide {
  id: string;           // 构型项 revision id，供行点详情
  code: string;
  name: string;
  quantity?: number;
}

interface ProfileComparePart {
  key: string;
  change_type: ChangeType;
  changed_fields?: ('version' | 'quantity' | 'status')[];
  left?: PartSide | null;
  right?: PartSide | null;
}
interface ProfileCompareNode {
  key: string;
  change_type: ChangeType;
  changed_fields?: ('quantity')[];       // 节点自身字段
  left?: ConfigItemSide | null;
  right?: ConfigItemSide | null;
  parts: ProfileComparePart[];
  children: ProfileCompareNode[];
}

interface ProfileCompareSummary {
  config_item: { add: number; delete: number; modify: number; none: number };
  part:        { add: number; delete: number; modify: number; none: number };
}
interface ProfileCompareResult {
  root: ProfileCompareNode | null;       // 两侧都空则 null
  summary: ProfileCompareSummary;
}

function diffProfileTrees(
  left: ConfigTreeNode | null,
  right: ConfigTreeNode | null,
): ProfileCompareResult
```
每个配置的 `config_tree` 单根，比对得到单个 `root`。汇总在遍历时累计。

## 四、UI 与交互

**入口**：`ProfileList` 工具栏「+ 新建配置」左侧加 `⇄ 配置对比` 按钮 → 打开 `ProfileCompareModal`。

**弹窗布局**（共享 `Modal`，宽版）：
1. **顶部两个选择器**（左/右配置）：搜索输入 + 下拉，数据来自 `configurationProfileApi.list`（所有状态），每项显示 `编号 - 名称` + 状态徽标（`ProfileStatusBadge`）→ `开始对比`。
2. **对比头**：左右各显示 编号/名称/状态/架次范围；汇总条：`构型项 新增x 删除x 修改x` 与 `零部件 新增x 删除x 修改x`。
3. **结果树表**：列 `层级 ｜（件号 名称 类型 版本 状态 数量）左 ‖ （…）右 ｜ 变更`。递归渲染，构型项行 `▶/▼` 折叠（默认展开第 1 层）；`add` 绿底、`delete` 红底、`modify` 黄底，变化单元格再单独高亮；`变更` 列文字说明（如「版本 A→B」「新增」「删除」）。
4. **`仅显示差异` 开关**：勾选后隐藏 `none` 行（卷积保证含差异的父构型项仍显示）。
5. **行点详情**：零部件行→`PartDetailModal`（`masterId = item_id`）；构型项行→`ConfigurationDetailModal`（`itemId = id`）。matched 行优先取右侧 id，无则取左侧。

**空/异常态**：任一侧未选→`开始对比` 禁用；两侧完全相同→显示「两配置正式清单一致」；某侧无关联构型项→提示该侧清单为空，另一侧整体记为新增/删除。

## 五、错误处理与边界

- 取任一配置详情失败→弹窗内红色错误提示，不崩溃；对比期间显示加载态；两侧并发 `get`。
- 某侧 `config_tree` 为 null → 该侧正式清单空，另一侧整体 add/delete。
- 两侧选同一配置 → 全 `none`，提示一致。
- 单个构型项内重复件号 → 按出现顺序兜底匹配（通常唯一）。
- 纯函数 O(n)，配置规模不大，无需虚拟滚动。

## 六、测试与验收

**单元测试** `frontend/src/lib/profileCompare.test.ts`（vitest）覆盖：
1. 完全相同 → 全 `none`。
2. 零部件 版本/数量/状态 变化 → `modify` 且 `changed_fields` 正确。
3. 零部件 单侧新增 / 删除。
4. 构型项 单侧新增 / 删除。
5. 构型项数量变化 → `modify`。
6. 卷积：子零部件变化 → 父构型项标 `modify`。
7. 未选项（`is_selected=false`）被剔除。
8. 某侧树为 null → 另一侧全 add/delete。
9. code-path 匹配：同构型号在不同父级下不被错配。

组件层不写重测试，靠 `tsc --noEmit` + `vite build` + 手测把关。

**验收命令**：
- `npm run build`（`tsc && vite build`）
- `npx vitest run src/lib/profileCompare.test.ts`

## 七、非目标（YAGNI）

- 不做同一配置的历史/快照对比（Profile 目前无版本快照）。
- 不做三个及以上配置的多路对比。
- 不新增后端对比接口（数据前端已具备）。
- 不做对比结果导出（如需可后续复用 `configProfilePdfExport` 追加）。
