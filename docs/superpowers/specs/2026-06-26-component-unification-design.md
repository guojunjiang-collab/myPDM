# 零部件统一化重构设计文档

**日期**：2026-06-26  
**分支**：V2.0  
**状态**：已批准，待实施

---

## 背景与目标

系统中"零件"（`parts` 表）和"部件"（`assemblies` 表）的数据库结构完全一致，区别仅在于部件可以有 BOM 子项，零件没有。这一区分在数据层面是冗余的——是否有子项可由 BOM 关系自然决定，无需两张独立的表。

**目标**：将 `parts` 和 `assemblies` 合并为统一的 `components` 表，对外统称"零部件"，消除重复代码和分支逻辑。

---

## 核心决策

| 决策项 | 选择 |
|---|---|
| 是否保留类型区分 | 否，统一叫"零部件"，不加 type 字段 |
| 新表名 / 路由 | `components` / `/components` |
| 模型类名 | `Component` |
| 前端入口 | 合并为"零部件管理"一个入口 |
| 迁移策略 | 全量迁移，保留原 id，分三阶段上线 |

---

## 数据库层设计

### 新表 `components`

字段与 `parts` / `assemblies` 完全一致，无新增列：

```sql
CREATE TABLE components (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(64) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    spec        VARCHAR(255),
    version     VARCHAR(32) DEFAULT 'A',
    status      VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark      TEXT,
    revisions   JSONB DEFAULT '[]',
    revision_parent_id UUID,
    creator_id  UUID,
    document_links JSONB DEFAULT '[]',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX uix_component_code_version
    ON components (code, version)
    WHERE deleted_at IS NULL;
```

### 迁移脚本执行顺序

前置检查：验证 `parts.id` 与 `assemblies.id` 无重复（UUID 理论上不冲突，但需显式确认）。

1. 创建 `components` 表及唯一索引
2. `INSERT INTO components SELECT * FROM parts`
3. `INSERT INTO components SELECT * FROM assemblies`
4. `bom_items`：`parent_type` / `child_type` 中 `'part'` / `'assembly'` / `'component'`（旧兼容值）→ `'component'`
5. `custom_field_values`：`entity_type` 中 `'part'` / `'assembly'` → `'component'`
6. `custom_field_definitions`：`applies_to` JSONB 数组中 `'part'` / `'assembly'` / `'component'` → `'component'`（去重）
7. `dashboard_items`：`entity_type` 中 `'part'` / `'assembly'` → `'component'`
8. `operation_logs`：`target_type` 中 `'part'` / `'assembly'` → `'component'`
9. `inventory_documents`：`ref_entity_type` 中 `'part'` / `'assembly'` → `'component'`
10. `project_tasks`（`models_project.py`）：`entity_type` 同上
11. 旧表 `parts`、`assemblies` **暂时保留**，阶段三删除

---

## 后端层设计

### 新增

- `models.py`：新增 `Component` 类（表名 `components`），字段与 `Part` / `Assembly` 一致
- `routers/components.py`：新路由，覆盖完整 CRUD 及版本/发布/归档操作

**端点列表：**

```
GET    /components          列表（分页、搜索、状态筛选）
GET    /components/{id}     详情
POST   /components          创建
PUT    /components/{id}     编辑
DELETE /components/{id}     软删除
POST   /components/{id}/publish    发布
POST   /components/{id}/archive    归档
POST   /components/{id}/revise     新建版本
```

### 修改

- `routers/bom.py`：`entity_type` 只接受 `"component"`，移除 `part`/`assembly` 分支及旧兼容转换逻辑
- `crud_eco.py`、`crud_ecr.py`、`crud_inventory.py`、`crud.py`：所有 `Part if entity_type == "part" else Assembly` 分支统一改为查 `Component`
- `models.py`：`CustomFieldValue.entity_type`、`DashboardItem.entity_type` 注释更新为 `'component'`

### 旧路由暂留（阶段一）

`/parts` 和 `/assemblies` 路由内部改为查 `components` 表，对外行为不变，供前端过渡期使用。阶段二前端切换完成后删除。

---

## 前端层设计

### 页面变更

| 文件 | 操作 |
|---|---|
| `pages/Parts.tsx` | 阶段三删除 |
| `pages/Components.tsx` | 阶段三删除 |
| `pages/ComponentsPage.tsx` | 新建，以现有 `Components.tsx` 为基础改造 |

侧边栏只保留"零部件管理"一个入口。

### API 调用

所有调用从 `/parts`、`/assemblies` 切换到 `/components`，`entity_type` 字段统一传 `"component"`。

### BOM 相关组件

`BOMTreePanel.tsx`、`BOMTracePanel.tsx`、`BOMComparePanel.tsx`、`BOMTraceModal.tsx`：
- 移除 `type === "part"` / `type === "assembly"` 分支渲染差异
- 节点统一按 `"component"` 处理，标签显示"零部件"

### 选择器 / 关联组件

`AssemblyPartPicker.tsx`、`ECRAffectedItemPicker.tsx`、`ECOEditView.tsx` 等：
- 移除零件/部件分列选择逻辑，统一为"零部件"单一选择器
- `entity_type` 传值统一为 `"component"`

### 自定义字段配置界面

`applies_to` 选项中"零件"/"部件"合并为"零部件"一项。

---

## 分阶段实施计划

### 阶段一：数据库 + 后端

**交付物：**
- 迁移脚本执行完毕，`components` 表数据完整
- `Component` 模型 + `/components` 路由上线
- 旧路由 `/parts`、`/assemblies` 代理到 `components` 表

**验收：**
- 旧前端功能全部正常（零件/部件列表、BOM、ECO/ECR）
- 新 `/components` 端点可正确 CRUD
- `bom_items` 中所有 `parent_type`/`child_type` 值均为 `'component'`

### 阶段二：前端切换

**交付物：**
- `ComponentsPage.tsx` 上线，侧边栏切换为"零部件管理"
- 所有 API 调用改为 `/components`
- BOM、ECO/ECR、选择器组件统一为 `"component"`

**验收：**
- 端到端：零部件增删改查、BOM 树展示、ECO 流程、库存引用全部正常
- 前端无 `/parts`、`/assemblies` 调用残留

### 阶段三：清理

**交付物：**
- 删除旧路由 `/parts`、`/assemblies`
- 删除 `Part`、`Assembly` 模型类
- `DROP TABLE parts, assemblies`
- 删除 `pages/Parts.tsx`、`pages/Components.tsx`

**验收：**
- 数据库只剩 `components` 表
- 代码中无 `Part`、`Assembly` 类引用残留

---

## 风险与注意事项

- **id 冲突**：迁移前必须执行 `SELECT id FROM parts INTERSECT SELECT id FROM assemblies` 确认为空
- **ECO 发布快照**：ECO 中可能存储了 `entity_type: "part"/"assembly"` 的历史快照 JSONB，迁移脚本需覆盖到所有 JSONB 字段内部值，或在后端读取时做兼容处理
- **operation_logs 历史记录**：`target_type` 可选择不迁移（历史日志保持原值），在前端展示时做映射即可，避免大批量更新日志表
