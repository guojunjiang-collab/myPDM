# 构型项详情 — 子构型项统一树表（含关联零部件）

日期：2026-06-10
状态：已批准，待实现

## 背景

构型项详情界面（`ConfigurationDetailModal`）当前有两张独立表：

- **关联零部件**：展示当前构型项自身的直接关联零部件，列丰富（层级/类型/件号/名称/版本/状态/用量/必选可选），部件行可展开 BOM 子零件，行可点击查看实体详情。
- **子构型项**：仅展示子构型项层级（列：构型号/名称/备注/数量/必选可选）。展开某子构型项时只加载其**更深一层子构型项**，而**丢弃了同一接口已返回的零部件数据**。

需求：参考「构型配置详情」的正式配置清单，把每个子构型项的关联零部件也展示进来，便于用户查看。

## 关键现状（数据来源）

`GET /configuration/items/{id}`（`get_config_item`）返回：

- `parts[]`：`{ id, part_type, part_id, is_required, quantity, part_detail{ code,name,version,spec,status } }`
- `children[]`：`{ id, child_id, is_required, quantity, has_children, child_detail{ code,name,spec,remark } }`
  - `has_children` **只反映是否有更深层子构型项，不反映是否有零部件**。

前端 `toggleChild` 调用 `configurationApi.getItem(childId)` 时，该响应**本就同时含 parts 和 children**，但当前只用 children、丢弃 parts。本需求即“把已经取到的 parts 也用起来”，因此可行性高、无需新增接口。

## 设计决策（已与用户确认）

1. **展示模型**：统一层级树表（仿正式配置清单），而非在现表内塞零部件行。
2. **交互深度**：完整 —— 零部件行可点击查看实体详情；部件（assembly）行可继续展开 BOM 子零件。
3. **范围**：仅改造「子构型项」区域；**顶部「关联零部件」表保持不变**。
4. **去掉「备注」列**（与正式配置清单一致）；根构型项备注仍在顶部基本信息卡片展示。

## 改动详情

### 1. 列结构（统一，8 列）

`层级 | 构型号/零部件件号 | 名称 | 类型 | 版本 | 状态 | 用量 | 必选/可选`

- **构型项行**：构型号填入「构型号/零部件件号」列；类型列显示紫色「构型项」徽章；版本、状态为 `-`；用量 = `quantity`；必选/可选徽章。
- **零部件行**：件号（`font-mono`）填入「构型号/零部件件号」列；类型列显示「零件/部件」徽章；版本、状态、用量正常显示；必选/可选徽章。

### 2. 层级与展开规则

- Level 0 = 直接子构型项（来自已加载的 `data.children`）。
- 展开一个**构型项行** → 懒加载 `getItem(childId)`，显示：先它的**零部件行**，后它的**更深层子构型项行**；递归同理。
- 展开一个**部件（assembly）零部件行** → 复用现有 `togglePart`，展开其 BOM 子零件（保持顶部表同款行为）。
- 是否显示构型项行的展开按钮：依据 `has_children || has_parts`。
- 点击**构型项行** → 弹出该子构型项嵌套详情（现有 `setNestedConfigId`，递归打开 `ConfigurationDetailModal`）。
- 点击**零部件行** → 弹出零件/部件实体详情（现有 `handleNestedView`）。

### 3. 后端（routers/configuration.py）

`get_config_item` 的 `children_data` 每项新增 `has_parts`：以是否存在该子构型项的关联零部件判定（轻量查询，复用 `crud.get_config_parts(db, child_id)` 非空 / count>0）。其余响应不变。

### 4. 前端（frontend/src/components/Configuration/ConfigurationDetailModal.tsx）

- `toggleChild`：展开态由“仅 children”改为存 `{ parts, children }`。`noChildren`（无可展开内容）判定改为 parts 与 children 均空。
- 新增统一树渲染函数：
  - `renderUnifiedChildRow(child, level, idx)`：渲染构型项行；展开时先渲染其 parts（`renderUnifiedPartRow`）后递归其 children。
  - `renderUnifiedPartRow(part, level, idx)`：按统一列序渲染零部件行；复用 `togglePart`（BOM 展开）与 `handleNestedView`（点击详情）。
- 顶部「关联零部件」表的 `renderPartRow` **保持不动**（其列序与本树不同，不共用）。
- idx 命名空间：构型项行与零部件行使用不同前缀（如 `${idx}-c${j}` / `${idx}-p${j}`）避免键冲突。
- 子构型项表头与表体替换为统一树表（8 列）。

### 5. 前端类型（types/index.ts）

`ConfigChildItem` 增加可选 `has_parts?: boolean`。

## 不改动

- 顶部「关联零部件」表（当前构型项自身零部件）。
- 构型配置详情/编辑（已是统一清单）。
- 导出 PDF、导入导出。
- 数据库（无迁移）。

## 验证

1. 后端重启，`get_config_item` 的 children 含 `has_parts`。
2. `npx tsc --noEmit`、`npm run build` 通过。
3. 打开一个含子构型项的构型项详情：
   - 子构型项区域为统一树表（8 列，无备注列）。
   - 展开某子构型项 → 先显示其关联零部件行（件号/类型/版本/状态/用量），后显示更深层子构型项；仅有零部件无更深子项的也能展开。
   - 部件零部件行可继续展开 BOM 子零件；点击零部件行弹实体详情；点击构型项行弹嵌套构型项详情。
   - 无零部件且无子项的子构型项不显示展开按钮。
