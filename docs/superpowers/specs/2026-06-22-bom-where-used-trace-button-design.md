# 零件/部件列表「反查」按钮设计

日期：2026-06-22
状态：已确认设计，待实现

## 目标

在「零件管理」和「部件管理」列表页的操作列各增加一个「反查」按钮，点击弹出该零部件的**反查（where-used）**结果——即所有引用它的上层父项。仅对 admin、engineer、production 三类角色可见。

## 背景与复用现状

本功能**几乎完全复用现有能力**，无需后端改动、无需改权限：

- **后端接口已存在**：`GET /bom/trace/{entity_type}/{entity_id}`（`backend/app/routers/bom.py:118`），基于递归 CTE 向上追溯父级，最多 10 层，返回 `List[BOMTraceItem]`。
- **权限已就绪**：`permissions/permissions.json` 中 `bom:trace` 已配置为 `["admin", "engineer", "production"]`，与需求完全一致。前端用 `can('bom:trace')` 判定即可。
- **前端已有**：
  - API 封装 `bomApi.trace(type, id)`（`frontend/src/services/api.ts:152`）
  - 树构建 helper `buildTraceTree` / `flattenTraceTree`（`frontend/src/pages/BOM/helpers.ts`）
  - 类型 `BOMTraceItem` / `TraceTreeNode`
  - 成熟的反查树形表格 UI（`frontend/src/pages/BOM/BOMTracePanel.tsx`，含层级缩进、展开/收起、类型/状态标签、用量列）
  - 详情查看组件 `PartDetailContent` / `AssemblyDetailContent`，以及 `BOM.tsx` 中用单个弹窗同时承载二者的取数逻辑 `handleViewEntity`（拉实体 + 自定义字段定义/值）

## 设计

### 1. 新增共享组件 `BOMTraceModal`

路径：`frontend/src/components/BOMTraceModal.tsx`。自包含、Parts/Components 两页共用。

- **Props**
  - `entity: { type: 'part' | 'assembly'; id: string; code: string; name: string } | null`
  - `onClose: () => void`
- **数据加载**：`entity` 变化且非 null 时，调用 `bomApi.trace(entity.type, entity.id)`，用 `buildTraceTree` 构建递归树。维护 loading / error 状态。
- **展示**：复用 `BOMTracePanel` 同款树形表格——`flattenTraceTree` 扁平化后渲染，列为「层级 / 类型 / 件号 / 名称 / 规格型号 / 版本 / 状态 / 用量」，支持节点展开/收起。
- **空状态**：沿用文案「未找到任何引用该实体的上级部件」。
- **容器**：使用现有共享 `Modal` 组件，标题 `反查 — {entity.code} {entity.name}`，宽度取较宽档（如 BOM 反查表格所需宽度）。
- **风格**：沿用现有页面统一风格（primary-* 配色、共享 Modal、统一表格），符合既有 UI 一致性约定。

注：可将 `BOMTracePanel` 的树形表格渲染部分抽出为内部子组件或直接在 `BOMTraceModal` 内重写同款表格。优先保持与 `BOMTracePanel` 视觉一致；不强制重构 `BOMTracePanel` 本身（避免扩大改动面）。

### 2. 点击父项 → 在弹窗内叠加详情

详情查看**内置在 `BOMTraceModal` 内部**，保证两页零重复接线：

- 点击某父项行时，在反查弹窗之上**叠加**一个详情弹窗。
- 根据父项类型渲染 `PartDetailContent`（part）或 `AssemblyDetailContent`（assembly）。
- 取数复用 `BOM.tsx` 的 `handleViewEntity` 逻辑：拉取实体详情 + 该类型适用的自定义字段定义与值。
- `AssemblyDetailContent` 内子项可继续点击下钻（沿用其 `onSubItemClick`）。
- 关闭详情弹窗回到反查树；关闭反查弹窗回到列表。

（已否决备选：路由跳转到对方页面 `/assemblies?view=<id>`——会离开当前列表上下文，且需给两页加 URL 参数处理。叠加详情弹窗更内聚、可复用。）

### 3. 操作列新增「反查」按钮

- **Parts.tsx**：操作列（`frontend/src/pages/Parts.tsx:551` 一带）在「编辑/删除」之前加：
  `{can('bom:trace') && <button onClick={...}>反查</button>}`
- **Components.tsx**：操作列同样处理。
- 按钮 `onClick` 内 `e.stopPropagation()`（操作列单元格已有 stopPropagation 包裹的，亦确保不触发行点击的详情弹窗），设置本页新增的 `traceEntity` state 以打开 `BOMTraceModal`。
- 样式与同列其它文字按钮一致（text-link 风格，例如 `text-indigo-600 hover:text-indigo-800 mr-3`，与「编辑」「删除」并列）。
- 两页各自渲染一个 `<BOMTraceModal entity={traceEntity} onClose={() => setTraceEntity(null)} />`。
- 引入 `can` from `../stores/auth`（Parts.tsx 现已引入 `canEdit/isAdmin/canDownload`，按需补充 `can`）。

## 边界与非目标

- 不修改后端、不修改权限矩阵。
- 不重构现有 `BOMTracePanel`（仅复用其视觉/helper）。
- 不增加「直接父项 only」模式——统一用递归全树。

## 测试与验证

无前端单测惯例，以下列手测为准（沿用本项目 build + Docker 部署验证流程）：

1. `cd frontend && npm run build` 通过。
2. admin / engineer / production 登录可见「反查」按钮；guest 登录**不可见**。
3. 选一个被多层装配引用的零件，反查弹窗正确展示递归树，可展开/收起。
4. 选一个无父项的零件，显示空状态文案。
5. 点击父项行，叠加详情弹窗，part/assembly 各自渲染正确；assembly 详情可下钻子项。
6. 反查按钮点击不会同时触发行点击的详情弹窗。
7. 零件页与部件页行为一致。
