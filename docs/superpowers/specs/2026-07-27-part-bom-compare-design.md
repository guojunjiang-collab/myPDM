# 零部件 BOM 对比功能 Design Spec

## 目标

在零部件管理界面新增「BOM 对比」功能，取代现有 BOM 工具页的「BOM 对比」Tab。交互模式参考构型配置对比：列表页按钮 → 弹窗内左右选择器 → 树形对比表格。

## 架构

- **后端**：零改动，直接复用 `POST /api/bom/compare`（`bomApi.compare`），权限 `bom:compare` 已有
- **前端**：新建 `PartCompareModal` 组件，PartsPage 加入口按钮
- **清理**：BOM 工具页移除「BOM 对比」Tab

## 数据流

```
PartsPage → [⇄ BOM对比] 按钮 → PartCompareModal
  → PartPicker 左右选择部件（搜件号/名称，列表从 partsApi.list 获取）
  → 开始对比 → bomApi.compare(leftRevId, rightRevId)
  → BOMCompareResponse { left_assembly, right_assembly, comparison: BOMCompareNode[], summary }
  → comparison 扁平列表按 path 还原树形结构
  → 树形表格渲染（展开/折叠、差色背景、仅看差异）
  → 行点击 → PartDetailModal（masterId + revisionId）
```

### 复用接口

| 接口 | 方法 | 用途 |
|------|------|------|
| `bomApi.compare(id, id)` | POST `/api/bom/compare` | BOM 树对比 |
| `partsApi.list()` | GET `/api/parts/` | 零部件搜索列表（选择器数据源） |
| `PartDetailModal` | 组件 | 行点击查看详情 |

## 对比维度（精简 4 字段）

| 字段 | 来源 | 说明 |
|------|------|------|
| 件号 | `detail.code` | 匹配键 |
| 版本 | `detail.version` | 版本变化高亮 |
| 状态 | `detail.status` | 草稿/冻结/发布/作废，变化高亮 |
| 数量 | `quantity` | 数量变化高亮 |

> **不纳入**：名称(name)、规格(spec) — 精简以聚焦核心差异。

## 组件设计

### PartCompareModal

Props: `{ open: boolean; onClose: () => void }`

**布局**（参考 ProfileCompareModal）:

```
┌─────────────────────────────────────────────────┐
│ [左配置选择器]          [右配置选择器]            │
│ 左部件状态 · 版本信息   右部件状态 · 版本信息      │
│ [开始对比]  □ 仅显示差异                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ 构型项: 新增X 删除X 修改X  零部件: 新增...  │ │
│ ├────┬──────────────┬┬──────────────┬────────┤ │
│ │层级│ 左部件       ││ 右部件       │ 变更   │ │
│ │    │件号│版本│状态│数量││件号│版本│状态│数量││ 说明 │ │
│ ├────┼────┼───┼───┼───┼┼───┼───┼───┼───┼┼──────┤ │
│ │ -0 │A-01│A │草稿│1  ││A-01│B │发布│1  ││版本:A→B│ │
│ │  -1│B-01│A │草稿│2  ││B-01│A │草稿│2  ││-     │ │
│ ├────┴────┴───┴───┴───┴┴───┴───┴───┴───┴┴──────┤ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**关键行为**:
- 打开弹窗时自动获取零部件列表（page_size=200）
- PartPicker：可搜索下拉，按件号/名称过滤
- 树形表格：sticky 表头，默认展开根节点（level=0），逐级可折叠
- 行颜色：新增绿(bg-green-50)、删除红(bg-red-50)、修改黄(bg-yellow-50)  `internal_change` 视为 `modify`
- 点行打开 PartDetailModal（传 child_master_id + child_revision_id）
- 两个部件相同时提示"BOM 一致"
- 对比失败显示红色错误提示
- 弹窗高度 75vh，表格区域 flex-1 自适应

### 树结构还原

后端返回扁平列表 `BOMCompareNode[]`，带 `level`/`path`/`key`：

```
comparison: [
  { key: "A", level: 0, path: "A", change_type: "modify", left: {...}, right: {...} },
  { key: "A/B", level: 1, path: "A/B", change_type: "none", left: {...}, right: {...} },
  { key: "A/C", level: 1, path: "A/C", change_type: "add", left: null, right: {...} },
]
```

前端按 `path` 父子关系构建树：父 `path` 为子 `path` 的前缀且相差一级 → 父子关系。根节点为 `level === 0`。

### 变更文案

| change_type | 文案 | 规则 |
|-------------|------|------|
| add | 新增 | 仅右侧有 |
| delete | 删除 | 仅左侧有 |
| modify | 版本A→B、状态草稿→发布、数量1→3 | 差异字段拼接 |
| none | - | 无变化（仅看差异时隐藏） |
| internal | 内部变更 | 子项有变化，当前节点无直接变化 |

## 代码变更

### 新建

| 文件 | 说明 |
|------|------|
| `frontend/src/components/PartCompareModal.tsx` | BOM对比弹窗组件 |

### 修改

| 文件 | 改动 |
|------|------|
| `frontend/src/pages/PartsPage.tsx` | 工具栏加「⇄ BOM对比」按钮 + 挂载 PartCompareModal |
| `frontend/src/pages/BOM/BOM.tsx` | 移除 compare Tab，只保留 tree 单一模式；如只剩一个 Tab，直接去掉顶栏 Tab，改为普通页面标题 |

### 不修改

- 后端 `bom/compare.py`、`routers/bom.py`：保留不动
- 前端 `BOMComparePanel.tsx`：保留不动（后续如需可删除）
- 权限 `bom:compare`：已存在
- `bomApi.compare`：已存在

## 边界情况

| 场景 | 处理 |
|------|------|
| 两侧选同一部件 | 提示"BOM 一致" |
| 某侧 BOM 为空 | 另一侧全标记新增/删除 |
| 对比失败 | 红色错误提示，不显示表格 |
| 仅部件有 BOM | PartPicker 过滤只显示 type=assembly 的零部件 |
| 展开/折叠 | 默认展开 level≤1，可逐级折叠 |
| 大型 BOM | 仅显示差异 + 虚拟滚动预留（不阻塞首版） |

## 测试策略

- 组件层不写单元测试（与 ProfileCompareModal 一致）
- 验收：`tsc --noEmit` + `vite build` 通过 + 手测
- 回归：`vitest run src/lib/profileCompare.test.ts` 10/10 不变
