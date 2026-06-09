# 构型项关联零部件「用量」（用户可设置）

日期：2026-06-09
状态：已批准，待实现

## 背景

构型项（`ConfigurationItem`）关联零部件（`configuration_item_parts`）当前无用量字段，构型项详情对直接关联零部件硬编码显示用量 1，构型配置详情/编辑里零部件行的"数量"显示为 `-`（且正式清单表格漏了该格、列错位）。

需求：编辑构型项界面，关联零部件增加「用量」列，由用户设置该构型项下零部件的用量；并贯通到构型项详情、构型配置详情/编辑、导出PDF、导入导出。

## 数据库迁移机制

`main.py` 启动时按 `Base.metadata` 对已存在表执行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，对带标量 `default` 的非空列会生成 `DEFAULT` 并加 `NOT NULL`。因此模型加列即自动补列（旧行取默认值）。`init.sql` 仅用于全新库，需同步更新。

## 改动详情

### 1. 数据模型 + init.sql
- `models_configuration.ConfigurationItemPart`：加 `quantity = Column(Integer, nullable=False, default=1)`。
- `models_configuration.ConfigurationWorkingItem`：加 `quantity = Column(Integer, nullable=False, default=1)`。
- `models_configuration.ConfigurationProfileItem`：加 `quantity = Column(Integer, nullable=False, default=1)`。
- `initdb/init.sql`：`configuration_item_parts`、`configuration_working_items`、`configuration_profile_items` 三张表 DDL 各加 `quantity INTEGER NOT NULL DEFAULT 1`。

### 2. 后端 schemas（schemas_configuration.py）
- `ConfigPartCreate`：加 `quantity: int = 1`。
- `ConfigPartUpdate`：加 `quantity: Optional[int] = None`。
- `ConfigPartResponse`：加 `quantity: int`。

### 3. 后端 crud（crud_configuration.py）
- `add_config_parts`：创建 `ConfigurationItemPart` 时写入 `quantity`（默认 1）。
- `update_config_part`：支持更新 `quantity`。
- `_generate_checklist`：创建 `ConfigurationWorkingItem` 时 `quantity=p.quantity`。
- 提交正式清单（working → profile item 的函数，约 380 行）：`quantity=wi.quantity`。

### 4. 后端 routers（routers/configuration.py）
- `get_config_item` 的 `parts_data` 每项加 `"quantity": p.quantity`。
- `_format_profile_item` 输出加 `"quantity": item.quantity`（working/profile item 均有该列）。于是 `_build_config_tree` 的 parts 自带 quantity。
- `update_part` 响应加 `"quantity"`。

### 5. 前端类型（types/index.ts）
- `ConfigPartItem` 加 `quantity?: number`。
- `ConfigTreePart` 加 `quantity?: number`。

### 6. 前端 编辑构型项（ConfigurationCreateModal.tsx）
- 关联零部件表格新增「用量」列：数字输入 `min=1`，默认 1，用户可改。
- 本地状态保存 quantity；创建/编辑提交时随 part 一起带 `quantity`。
- 与既有"是否必选"列同一编辑模式。

### 7. 前端显示
- `ConfigurationDetailModal.tsx`：直接关联零部件用量 `level === 0 ? 1 : (p.quantity || 1)` → `p.quantity ?? 1`（展开的 BOM 子项仍用 BOM quantity）。
- `ProfileEditModal.tsx`：
  - 可编辑清单 `renderTableRows` 零部件行「数量」`-` → `part.quantity ?? 1`。
  - 正式清单 `renderFormalRows` 零部件行补上缺失的「数量」`<td>`，显示 `part.quantity ?? 1`（修复列错位）。
- `configProfilePdfExport.ts`：`collectFormalRows` 零部件行 `quantity` 填 `part.quantity ?? 1`（而非空）。

### 8. 导入导出（importExport.ts）
- `_buildConfigItemsWorkbook` 的「关联零部件」sheet 增加列「用量」，导出 `p.quantity ?? 1`。
- `previewConfigurationItemsImport` 解析「用量」；`executeConfigurationItemsImport` 提交 `add_config_parts` 时带 `quantity`（解析失败默认 1）。

## 不改动
- 子构型项用量逻辑（已有）。
- ECO/ECR。

## 验证
1. 后端重启，自动补列成功（日志 `Auto-added missing column configuration_item_parts.quantity` 等）。
2. `npx tsc --noEmit`、`npm run build` 通过。
3. 编辑构型项设置某零部件用量=N → 保存 → 构型项详情显示 N；以该构型项新建/重建构型配置 → 详情/编辑/正式清单/PDF 中该零部件用量显示 N。
4. 导出构型项 Excel 含「用量」列；清空后导入还原用量。
