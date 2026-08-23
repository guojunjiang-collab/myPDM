# 前端风格统一（徽标/按钮/表单）设计文档

**日期**：2026-08-22  
**状态**：已批准，待实施  
**范围**：桌面端 + 移动端（`frontend/src/` 全部组件与页面）

---

## 背景与目标

项目经过多轮功能迭代（v3.4.0），前端积累了 100+ 处重复内联的 Tailwind 样式，尤其是**状态徽标**与**按钮**：

- 零部件/图文档的 4 态状态徽标映射（草稿=蓝、冻结=橙、发布=绿、作废=红）在 **20+ 个文件**里各自内联重复定义，细节互相冲突（`rounded` vs `rounded-full`、`text-blue-700` vs `text-blue-800`、四种 padding 尺寸、字段名 `class` vs `cls`）；
- 主按钮 `bg-primary-600` 出现 **85+ 处**，存在 `rounded`/`rounded-lg` 混用、禁用态三种写法、约 1/4 缺 hover；
- 语义冲突点：必选/可选两套相反配色、装配件类型蓝/紫不定、库存单据"已批准"用蓝色；
- 任务/项目状态用 50 级淡色（`bg-blue-50`），数据状态用 100 级（`bg-blue-100`），两套并存；
- 移动端虽已有 `StatusBadge` 组件雏形，但各页面仍各自传重复 map，组件形同虚设。

**目标**：建立"单一事实源 + 公共组件"三层结构，全量替换存量样式，使桌面端与移动端视觉完全一致，并杜绝后续再次分叉。

**颜色语义共识已存在，本方案不是重新设计颜色，而是收拢与固化**。

---

## 核心决策

| 决策项 | 选择 |
|---|---|
| 落地力度 | **全量组件化重构**（一次性替换全部存量） |
| 徽标形状 | **胶囊 `rounded-full`**（桌面/移动端一致） |
| 多套风格（主题化） | **CSS 变量驱动，本次落地基础架构**：ui 组件颜色全部走 `var(--ui-*)` 变量；默认风格在 `:root` 定义，`html[data-theme]` 可整体覆盖，业务代码与映射表零感知 |
| 颜色体系 | 语义映射表（状态 → tone）不变；**tone/variant → 颜色**的最终落地改为 CSS 变量（而非静态 Tailwind 类），为多风格切换预留 |
| 切换 UI | 本次**不实现**风格选择器与第二套风格，仅落地"默认变量集 + 可覆盖结构" |
| 公共组件位置 | 新增 `src/components/ui/` 目录（Badge / Button / Input / Select / Textarea） |
| 语义映射位置 | 新增 `src/constants/badges.ts`（单一事实源） |
| 移动端 | 复用同一套 ui 组件；Button 增加 `touch` 触控尺寸 |
| 色级收敛 | 任务/项目状态 50 级淡色 → 100 级，与数据状态统一 |
| 琥珀/黄收敛 | `yellow` 色系统一为 `amber`（执行中、CAD 可新建等） |

---

## 三层架构

```
① 语义映射单一事实源            ② 公共 UI 组件               ③ 全量替换
src/constants/badges.ts  →   src/components/ui/        →   桌面 ~18 文件 + 移动端 ~12 文件
(全部状态域 → 颜色 tone)       Badge / Button / Input       + 85+ 处按钮
```

所有颜色只允许出现在 `badges.ts` 与 `ui/*.tsx` 中；业务代码只写语义（`<Badge status="released" />`、`<Button variant="danger">`），不写颜色类。**例外（已批准）**：非按钮语义的分段控件选中态与必选/可选切换 chip 等交互控件，允许直接引用 `var(--ui-*)`（移动端筛选胶囊 tab 选中态、构型必选/可选切换，见 Task 16/19b）。

---

## ① 语义映射表（`src/constants/badges.ts`）

### tone → CSS 变量（组件内部唯一真源）

| tone | 背景变量 | 文字变量 | 语义 |
|---|---|---|---|
| `blue` | `var(--ui-blue-bg)` | `var(--ui-blue-text)` | 信息/草稿/审核中 |
| `orange` | `var(--ui-orange-bg)` | `var(--ui-orange-text)` | 冻结/高优先级 |
| `green` | `var(--ui-green-bg)` | `var(--ui-green-text)` | 成功/发布/已批准 |
| `red` | `var(--ui-red-bg)` | `var(--ui-red-text)` | 错误/作废/驳回 |
| `gray` | `var(--ui-gray-bg)` | `var(--ui-gray-text)` | 中性/未开始/低优先级 |
| `amber` | `var(--ui-amber-bg)` | `var(--ui-amber-text)` | 警告/执行中/挂起/他人签出 |
| `teal` | `var(--ui-teal-bg)` | `var(--ui-teal-text)` | 终态成功（已过账/已完成） |
| `purple` | `var(--ui-purple-bg)` | `var(--ui-purple-text)` | 构型项类型 |
| `indigo` | `var(--ui-indigo-bg)` | `var(--ui-indigo-text)` | 图文档类型 |

组件渲染类名：`bg-[var(--ui-blue-bg)] text-[var(--ui-blue-text)]`（Tailwind 任意值 + CSS 变量，静态字符串可被 JIT 正常扫描）。默认值在 `index.css` 的 `:root` 中定义为与现状一致的色值（如 `--ui-blue-bg: #dbeafe; --ui-blue-text: #1e40af;`）。

### 状态域 → 状态值 → { label, tone }（完整清单）

**A. 数据生命周期（part / document / configItem / material 共用）**

| 值 | 标签 | tone |
|---|---|---|
| `draft` | 草稿 | blue |
| `frozen` | 冻结 | orange |
| `released` | 发布 | green |
| `obsolete` | 作废 | red |
| 未知 | 原值 | gray |

**B. ECR 状态（审批流程）**

| 值 | 标签 | tone |
|---|---|---|
| `draft` | 草稿 | gray（未提交） |
| `reviewing` | 审核中 | blue |
| `approved` | 已批准 | green |
| `rejected` | 已驳回 | red |

**C. ECO 状态**

| 值 | 标签 | tone |
|---|---|---|
| `draft` | 草稿 | gray |
| `reviewing` | 评审中 | blue |
| `approved` | 已批准 | green |
| `rejected` | 已驳回 | red |
| `executing` | 执行中 | amber（原 yellow → amber） |
| `completed` | 已完成 | teal |

**D. 构型概要状态**

| 值 | 标签 | tone |
|---|---|---|
| `draft` | 草稿 | gray |
| `reviewing` | 评审中 | blue |
| `active` | 生效中 | green |
| `rejected` | 已驳回 | red |

**E. 库存单据状态**

| 值 | 标签 | tone | 变更 |
|---|---|---|---|
| `draft` | 草稿 | gray | — |
| `reviewing` | 评审中 | blue | 原 amber → blue（与审批流程一致） |
| `approved` | 已批准 | green | 原 primary → green（正向完成态） |
| `posted` | 已过账 | teal | — |
| `rejected` | 已驳回 | red | — |
| `cancelled` | 已取消 | gray | 文字色 400 |

**F. 优先级（ECR/ECO 共用）**

| 值 | 标签 | tone |
|---|---|---|
| `urgent` | 紧急 | red |
| `high` | 高 | orange |
| `normal` | 普通 | blue |
| `low` | 低 | gray |

**G. BOM 变更动作（ECR/ECO 影响分析）**

| 值 | 标签 | tone |
|---|---|---|
| `create` / `add_new` | 新建 | green |
| `add_existing` | 新增 | teal |
| `upgrade` | 升版 | blue |
| `qty_change` | 数量变更 | orange |
| `delete` | 删除 | red |
| `no_change` | 不变 | gray |

**H. 执行状态**

| 值 | 标签 | tone |
|---|---|---|
| `pending` | 待执行 | gray |
| `in_progress` | 执行中 | amber（原 yellow → amber） |
| `completed` | 已完成 | green |
| `failed` | 失败 | red |

**I. 签出状态**

| 值 | 标签 | tone |
|---|---|---|
| `not_checked_out` | 未签出 | gray |
| `checked_out` | 已签出 | blue |
| `other_checked_out` | 他人签出 | amber |

**J. 必选/可选（冲突修复 #2）**

| 值 | 标签 | tone |
|---|---|---|
| `required` | 必选 | blue（强调） |
| `optional` | 可选 | gray（中性） |

**K. 实体类型（冲突修复 #1）**

| 值 | 标签 | tone |
|---|---|---|
| `part` | 零件 | gray |
| `assembly` | 装配 | blue（原紫/蓝不定 → 统一蓝） |
| `configuration` | 构型项 | purple |
| `document` | 图文档 | indigo |

**L. CAD 匹配状态**

| 值 | 标签 | tone |
|---|---|---|
| `matched` | 已匹配 | green |
| `new` | 可新建 | amber（原 yellow → amber） |
| `conflict` | 冲突 | red |
| `unknown` | 未知 | gray |

**M. 角色**

| 值 | 标签 | tone |
|---|---|---|
| `admin` | 管理员 | red |
| `engineer` | 工程师 | blue |
| `production` | 生产人员 | green |
| `guest` | 访客 | gray |
| `unverified` | 未验证/待审批 | amber（原 yellow → amber 收敛；提示管理员待处理） |

> 角色徽标出现位置：用户管理列表、用户组、顶栏当前用户、知会/审批人选择器等（`Layout`、`Users`、`UsersListPage`、`ECO*`、`ECR*`）。

**N. 用户状态**

| 值 | 标签 | tone | 说明 |
|---|---|---|---|
| `active` | 正常 | green | — |
| `disabled` | 禁用 | red | 统一桌面红（移动端原灰 → 红，与桌面一致；禁用属需关注状态） |

**O. 项目状态**

| 值 | 标签 | tone |
|---|---|---|
| `待启动` | 待启动 | gray |
| `进行中` | 进行中 | blue |
| `已完成` | 已完成 | green |
| `已暂停` | 已暂停 | amber |
| `已归档` | 已归档 | gray（文字 400） |

**P. 任务状态（色级 50 → 100 收敛）**

| 值 | 标签 | tone |
|---|---|---|
| `未开始` | 未开始 | gray |
| `进行中` | 进行中 | blue |
| `已完成` | 已完成 | green |
| `挂起` | 挂起 | amber |

**Q. 审批意见**

| 值 | 标签 | tone |
|---|---|---|
| `approved` | 同意 | green |
| `rejected` | 驳回 | red |

**R. 行内计数徽标**：`px-1.5 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600`（Badge `size="xs"`）。

> **草稿色语义规范（冲突修复 #4）**：数据生命周期 `draft` = 蓝（活跃编辑中）；审批流程 `draft` = 灰（未开始/未提交）。两类刻意不同色，写进规范防止误改。

---

## ② 公共 UI 组件（`src/components/ui/`）

### Badge.tsx

```tsx
type BadgeTone = 'blue' | 'orange' | 'green' | 'red' | 'gray' | 'amber' | 'teal' | 'purple' | 'indigo';
type BadgeDomain = 'part' | 'ecr' | 'eco' | 'profile' | 'inventoryDoc' | 'priority'
                 | 'action' | 'exec' | 'checkout' | 'required' | 'entity' | 'match'
                 | 'role' | 'user' | 'project' | 'task' | 'decision';

interface BadgeProps {
  status?: string;            // 配合 domain 从映射表取 label+tone
  domain?: BadgeDomain;       // 省略时直接用 tone + label
  tone?: BadgeTone;
  label?: string;
  size?: 'sm' | 'xs';         // sm: px-2 py-0.5 text-xs（默认）；xs: px-1.5 py-0.5 text-[11px]
  className?: string;         // 追加（如 cursor-pointer）
}
```

渲染：`inline-flex items-center whitespace-nowrap rounded-full font-medium` + tone 变量类（`bg-[var(--ui-<tone>-bg)] text-[var(--ui-<tone>-text)]`）+ size 类。  
移动端与桌面端**共用同一组件、同一尺寸**（徽标非交互，无需放大触控区）。

### Button.tsx

```tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'dark' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'touch';
}
```

| variant | 类名（CSS 变量驱动） | 用途 |
|---|---|---|
| `primary` | `bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] active:bg-[var(--ui-btn-primary-active)]` | 新建/保存/确认 |
| `secondary` | `border border-[var(--ui-btn-secondary-border)] bg-[var(--ui-btn-secondary-bg)] text-[var(--ui-btn-secondary-text)] hover:bg-[var(--ui-btn-secondary-hover)]` | 取消/浏览 |
| `ghost` | `bg-[var(--ui-btn-ghost-bg)] text-[var(--ui-btn-ghost-text)] hover:bg-[var(--ui-btn-ghost-hover)]` | 次要筛选/折叠 |
| `danger` | `bg-[var(--ui-btn-danger-bg)] text-[var(--ui-btn-danger-text)] hover:bg-[var(--ui-btn-danger-hover)] active:bg-[var(--ui-btn-danger-active)]` | 删除/作废/强制签入（统一 600 值） |
| `success` | `bg-[var(--ui-btn-success-bg)] text-[var(--ui-btn-success-text)] hover:bg-[var(--ui-btn-success-hover)]` | 签入/全部签入（统一 green 值，废弃 emerald） |
| `dark` | `bg-[var(--ui-btn-dark-bg)] text-[var(--ui-btn-dark-text)] hover:bg-[var(--ui-btn-dark-hover)]` | 撤销签出等中性实底 |
| `link` | `text-[var(--ui-btn-link-text)] hover:text-[var(--ui-btn-link-hover)] hover:underline` | 行内操作 |

| size | 类名 | 适用 |
|---|---|---|
| `xs` | `px-2.5 py-1 text-xs rounded` | 表格行内小按钮 |
| `sm` | `px-3 py-1.5 text-xs rounded-lg` | 详情页操作 |
| `md` | `px-4 py-2 text-sm rounded-lg` | 默认 |
| `lg` | `px-5 py-2.5 text-sm rounded-lg` | 弹窗主操作 |
| `touch` | `h-11 px-4 text-sm rounded-lg` | 移动端主按钮（≥44px 触控） |

公共基础：`inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed`（`link` 变体除外，不加 disabled 底）。

### Input / Select / Textarea

统一：`w-full rounded-lg border border-[var(--ui-input-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-input-text)] placeholder:text-[var(--ui-input-placeholder)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-input-focus-ring)] focus:border-[var(--ui-input-focus-border)] disabled:bg-[var(--ui-input-disabled-bg)] disabled:text-[var(--ui-input-disabled-text)]`。  
表格内小输入框用 `size="xs"`：`px-2 py-1 text-xs`。消除 `rounded`/`rounded-lg`、`ring-1`/`ring-2`、`ring-primary-500`/`ring-blue-500` 混用。

### CSS 变量清单（`index.css` `:root` 定义，共 3 组 40+ 变量）

```css
:root {
  /* ① 徽标 tone（9 × 2） */
  --ui-blue-bg: #dbeafe;   --ui-blue-text: #1e40af;
  --ui-orange-bg: #ffedd5; --ui-orange-text: #9a3412;
  --ui-green-bg: #dcfce7;  --ui-green-text: #166534;
  --ui-red-bg: #fee2e2;    --ui-red-text: #991b1b;
  --ui-gray-bg: #f3f4f6;   --ui-gray-text: #374151;
  --ui-amber-bg: #fef3c7;  --ui-amber-text: #92400e;
  --ui-teal-bg: #ccfbf1;   --ui-teal-text: #115e59;
  --ui-purple-bg: #f3e8ff; --ui-purple-text: #6b21a8;
  --ui-indigo-bg: #e0e7ff; --ui-indigo-text: #3730a3;

  /* ② 按钮 variant */
  --ui-btn-primary-bg: #0284c7;     --ui-btn-primary-hover: #0369a1;
  --ui-btn-primary-active: #075985; --ui-btn-primary-text: #ffffff;
  --ui-btn-secondary-bg: #ffffff;   --ui-btn-secondary-hover: #f9fafb;
  --ui-btn-secondary-border: #d1d5db; --ui-btn-secondary-text: #374151;
  --ui-btn-ghost-bg: #f3f4f6;       --ui-btn-ghost-hover: #e5e7eb;
  --ui-btn-ghost-text: #374151;
  --ui-btn-danger-bg: #dc2626;      --ui-btn-danger-hover: #b91c1c;
  --ui-btn-danger-active: #991b1b;
  --ui-btn-success-bg: #16a34a;     --ui-btn-success-hover: #15803d;
  --ui-btn-dark-bg: #6b7280;        --ui-btn-dark-hover: #4b5563;
  --ui-btn-link-text: #0284c7;      --ui-btn-link-hover: #075985;

  /* ③ 表单 */
  --ui-input-bg: #ffffff;           --ui-input-border: #d1d5db;
  --ui-input-text: #374151;         --ui-input-placeholder: #9ca3af;
  --ui-input-focus-ring: #38bdf8;   --ui-input-focus-border: #0ea5e9;
  --ui-input-disabled-bg: #f3f4f6;  --ui-input-disabled-text: #6b7280;
}
```

> 变量值 = 现状各 Tailwind 色阶（blue-100/800、gray-100/700、primary-600 等）的色值，**默认风格与现状视觉完全一致**，切换风格只是换一套变量值。

---

## ④ 多套风格（主题化）扩展路径

本方案落地的 CSS 变量结构使"多套风格、用户自选"成为**后续的低成本增量**：

### 机制

1. **默认风格**：`index.css` `:root` 中的变量集（即本次落地值）
2. **新风格**：追加一段 `html[data-theme='<风格名>'] { --ui-blue-bg: ...; ... }` 覆盖全部变量
3. **用户选择**：前端读 `localStorage['pdm-theme']` → 设置 `document.documentElement.dataset.theme` → 整套颜色即时切换，零重渲染、业务代码零改动
4. **防闪烁**：`main.tsx` 入口早期（或 `index.html` 内联脚本）读取并设置 `data-theme`，先于 React 渲染

### 新增一套风格的步骤（后续任务，工作量约 0.5 天）

1. 定义新变量集（复制 `:root` 块改色值）
2. 设置页加"风格选择"（写 `localStorage` + 更新 `data-theme`）
3. 可选：logo/布局色等**非 ui 组件**的全局色 token 化（第二步任务：全局色 token 化——将页面背景、卡片、正文色等静态类也改为变量，本次**不包含**）

### 本次范围边界

- **包含**：ui 组件（徽标/按钮/表单）全部颜色走 CSS 变量；`:root` 默认变量集落地；`html[data-theme]` 覆盖机制经测试可用
- **不包含**：第二套风格、风格选择 UI、布局/页面级颜色的 token 化（后续独立任务）

---

## ③ 替换范围与冲突修复

### Phase 1 — 基础设施（纯新增，零行为变化）

- 新增 `src/constants/badges.ts`（映射表）
- 新增 `src/components/ui/Badge.tsx`、`Button.tsx`、`Input.tsx`、`Select.tsx`、`Textarea.tsx`

### Phase 2 — 状态徽标全量替换

删除各文件内联 map，改用 `<Badge status=... domain=... />`。涉及（不完全列举）：

- 桌面：`PartsPage`、`Documents`、`PartDetailModal`、`DocumentDetailModal`、`PartDetailContent`、`AssemblyDetailContent`、`DocumentDetailContent`、`EntityEditModal`、`VersionHistory`、`VersionSelectModal`、`BOMTreeTable`、`BomWhereUsedTree`、`AssemblyPartPicker`、`DocumentPicker`、`ConfigItemPicker`、`ConfigurationList`、`ConfigurationDetailModal`、`ConfigItemDetailModal`、`MaterialTab`、`ECO*`、`ECR*`、`Board`、`Users`、`Layout`（角色徽标）
- 移动端：`PartsListPage`、`DocumentsListPage`、`ConfigurationItemsPage`、`ConfigurationProfilesPage`、`PartDetailPage`、`DocumentDetailPage`、`ConfigItemDetailPage`、`EcPage`、`InventoryPage`、`ProjectsPage`、`TaskDetailPage`、`BomTree`、`ConfigTree`（删除重复 map，`StatusBadge` 组件退役）

### Phase 3 — 按钮全量替换 + 冲突修复

- 85+ 处按钮 → `<Button variant size />`
- 冲突修复：必选/可选（J）、装配件类型（K）、库存单据已批准（E）、撤销签出按钮统一 `dark` 变体
- 危险按钮 `red-500` → `red-600`；成功按钮 `emerald-500` → `green-600`

### Phase 4 — 表单统一 + 色级收敛

- 输入框/下拉/文本域 → ui 组件
- 任务/项目状态 50 级 → 100 级；`yellow` → `amber`
- 计数徽标统一 `size="xs"`

### Phase 5 — 验收

- `cd frontend && npm run build` 通过
- `npm run test` 通过（如无相关测试则跳过）
- grep 校验：业务代码中不再出现 `bg-blue-100 text-blue-800` 等内联状态类（仅 `badges.ts` / `ui/Badge.tsx` 保留）
- 桌面逐页抽查：零部件、图文档、ECR、ECO、构型、库存、项目、用户、日志、看板、通知
- 移动端逐页抽查：零部件、图文档、EC、构型、库存、项目、通知、更多

---

## 风险与规避

| 风险 | 规避 |
|---|---|
| 大面积替换引入视觉回归 | 每 Phase 结束即 `npm run build` + 关键页面肉眼抽查；组件默认样式与原主流样式等价（除胶囊与色级收敛为预期变更） |
| 组件 props 覆盖不全（图标按钮、disabled 自定义等） | `className` 透传 + 原生属性透传；替换中发现缺口的场景即时补组件变体 |
| 遗漏状态值导致灰底兜底 | Badge 对未知值灰底兜底并保留原 label，不影响功能 |
| 映射表与后端新状态脱节 | 映射表集中一处，新状态只需改 `badges.ts` 一处 |
