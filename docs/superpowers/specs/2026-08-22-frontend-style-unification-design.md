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
| 深色模式 | 不做，但颜色经"语义→类名"映射表间接引用，预留替换点 |
| 颜色体系 | 复用 Tailwind 内置色板，不新建色板；只建语义映射表 |
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

所有颜色只允许出现在 `badges.ts` 与 `ui/*.tsx` 中；业务代码只写语义（`<Badge status="released" />`、`<Button variant="danger">`），不写颜色类。

---

## ① 语义映射表（`src/constants/badges.ts`）

### tone → 类名（组件内部唯一真源）

| tone | 类名 | 语义 |
|---|---|---|
| `blue` | `bg-blue-100 text-blue-800` | 信息/草稿/审核中 |
| `orange` | `bg-orange-100 text-orange-800` | 冻结/高优先级 |
| `green` | `bg-green-100 text-green-800` | 成功/发布/已批准 |
| `red` | `bg-red-100 text-red-800` | 错误/作废/驳回 |
| `gray` | `bg-gray-100 text-gray-700` | 中性/未开始/低优先级 |
| `amber` | `bg-amber-100 text-amber-800` | 警告/执行中/挂起/他人签出 |
| `teal` | `bg-teal-100 text-teal-800` | 终态成功（已过账/已完成） |
| `purple` | `bg-purple-100 text-purple-700` | 构型项类型 |
| `indigo` | `bg-indigo-100 text-indigo-700` | 图文档类型 |

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

**N. 用户状态**

| 值 | 标签 | tone |
|---|---|---|
| `active` | 正常 | green |
| `disabled` | 禁用 | red |

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

渲染：`inline-flex items-center whitespace-nowrap rounded-full font-medium` + tone 类 + size 类。  
移动端与桌面端**共用同一组件、同一尺寸**（徽标非交互，无需放大触控区）。

### Button.tsx

```tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'dark' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'touch';
}
```

| variant | 类名 | 用途 |
|---|---|---|
| `primary` | `bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800` | 新建/保存/确认 |
| `secondary` | `border border-gray-300 bg-white text-gray-700 hover:bg-gray-50` | 取消/浏览 |
| `ghost` | `bg-gray-100 text-gray-700 hover:bg-gray-200` | 次要筛选/折叠 |
| `danger` | `bg-red-600 text-white hover:bg-red-700 active:bg-red-800` | 删除/作废/强制签入（统一 600） |
| `success` | `bg-green-600 text-white hover:bg-green-700` | 签入/全部签入（统一 green，废弃 emerald） |
| `dark` | `bg-gray-500 text-white hover:bg-gray-600` | 撤销签出等中性实底 |
| `link` | `text-primary-600 hover:text-primary-800 hover:underline` | 行内操作 |

| size | 类名 | 适用 |
|---|---|---|
| `xs` | `px-2.5 py-1 text-xs rounded` | 表格行内小按钮 |
| `sm` | `px-3 py-1.5 text-xs rounded-lg` | 详情页操作 |
| `md` | `px-4 py-2 text-sm rounded-lg` | 默认 |
| `lg` | `px-5 py-2.5 text-sm rounded-lg` | 弹窗主操作 |
| `touch` | `h-11 px-4 text-sm rounded-lg` | 移动端主按钮（≥44px 触控） |

公共基础：`inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed`（`link` 变体除外，不加 disabled 底）。

### Input / Select / Textarea

统一：`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500`。  
表格内小输入框用 `size="xs"`：`px-2 py-1 text-xs`。消除 `rounded`/`rounded-lg`、`ring-1`/`ring-2`、`ring-primary-500`/`ring-blue-500` 混用。

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
