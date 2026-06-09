# 构型配置详情：导出 PDF（MD → 打印另存 PDF）

日期：2026-06-09
状态：已批准，待实现

## 背景

构型配置详情界面（`ProfileEditModal` 的 view/edit 模式）展示「基本信息 + 正式配置清单」。正式清单是一棵 `config_tree`，界面按折叠状态分层展示。需求：右上角加「导出PDF」按钮，把界面内容导出为 PDF，且正式配置清单**展开所有层级、显示所有信息**。

现状：
- 详情数据（基本信息 + 完整 `config_tree`）在 `loadProfile` 时一次性加载进内存（`profile` / `configTree`），导出无需额外请求。
- 已有 MD 导出先例 `frontend/src/services/ecMarkdownExport.ts`（ECO/ECR，纯前端生成 .md）。
- 项目无 markdown 渲染库、无 PDF 库。

## 决策（已与用户确认）

- 路线：**MD → HTML →（浏览器打印）另存为 PDF**。最后一步走浏览器打印对话框（用户点「另存为 PDF」），而非一键静默下载——避免内嵌 CJK 字体的重方案，中文显示最稳。
- 导出内容：**基本信息 + 全展开的正式配置清单**。
- 按钮位置：弹窗内容**顶部右对齐**（不改公共 `Modal` 组件）。

## 改动详情（全部前端）

### 1. 依赖
新增 `marked`（MD → HTML，纯 JS，Vite 兼容）。

### 2. 新增服务 `frontend/src/services/configProfilePdfExport.ts`

#### `buildProfileMarkdown(profile, configTree): string`
生成 Markdown（中间产物）：
- `# 构型配置：{code} {name}`
- **基本信息** 区：编号、名称、关联构型项（`configuration_item?.code` 或 `configuration_item_code`）、架次范围（`effectivity_start ~ effectivity_end`）、状态（草稿/生效/归档）、备注。
- `## 正式配置清单` 区：管道表格，列 `层级 | 构型号 | 名称 | 类型 | 零部件件号 | 版本 | 状态 | 数量`。
  - 递归遍历整棵 `config_tree`，规则与界面 `renderFormalRows` 一致：
    - 节点 `is_selected || is_required` 才纳入；构型项行填 构型号/名称/类型=构型项/数量；件号、版本、状态留空。
    - 其下 `parts` 中 `is_selected`（跳过 `item_type==='config_item'`）的零部件各一行：名称、类型（零件/部件）、件号、版本、状态。
    - 递归纳入选中的子构型项，层级 +1。
  - 层级列用 `'-'.repeat(level)+level` 前缀，复刻界面。
  - 状态值转中文（draft 草稿 / frozen 冻结 / released 发布 / obsolete 作废）。
  - 表格单元格内对 `|` 做转义，避免破坏管道表格。

#### `exportProfilePdf(profile, configTree): void`
1. `md = buildProfileMarkdown(...)`
2. `html = marked.parse(md)`
3. 套打印模板：`<html>` + `<style>`（正文字体、表格 `border-collapse` 带边框、A4 `@page` 边距、`@media print` 隐藏多余留白、标题）。
4. 创建隐藏 `iframe`，写入 HTML，`iframe.contentWindow.print()`；打印结束后移除 iframe。
   - 用 iframe 而非新窗口，避免被弹窗拦截；`onafterprint` 或定时清理。

### 3. UI 改动 `frontend/src/components/Configuration/ProfileEditModal.tsx`
- 在弹窗内容顶部加一行 `justify-end` 的按钮区，`profile && configTree` 时渲染 `📄 导出PDF` 按钮。
- onClick → `exportProfilePdf(profile, configTree)`。
- 传入排序后的 `configTree`（与界面顺序一致）+ `profile`（基本信息）。

## 不改动
- 后端。
- ECO/ECR 现有 MD 导出。
- 构型项详情（`ConfigurationDetailModal`）。
- 公共 `Modal` 组件。

## 验证
1. `npm install marked` 后 `npx tsc --noEmit` 通过；`npm run build` 通过。
2. 打开一个多层级、含必选/可选项的构型配置详情 → 点「导出PDF」→ 浏览器打印预览中：基本信息齐全、正式配置清单所有层级与零部件全部展开、中文正常、可另存为 PDF。
3. 详情/编辑两种模式按钮均可用；空 `config_tree` 时按钮不显示或导出仅含基本信息（不报错）。
