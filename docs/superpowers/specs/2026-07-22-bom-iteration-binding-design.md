# BOM 子项绑定从 revision_id 迁移到 iteration_id

**日期**: 2026-07-22
**版本**: v1.7
**状态**: 设计中

## 背景

当前 `bom_items` 表的 BOM 父子关系绑定在 `parent_revision_id`（版本级），同一版本下签出/签入产生的不同迭代共享同一套 BOM 子项。用户希望在迭代切换时 BOM 子项跟随变化，即每个迭代有自己独立的 BOM 快照。

## 目标

将 BOM 子项的主绑定从 `parent_revision_id` 改为 `iteration_id`，使同一版本的不同迭代可以拥有不同的 BOM 子项列表。

## 设计原则

- **最小侵入**：数据库已有 `iteration_id` 列，无需 DDL 变更
- **API 兼容**：使用查询参数 `?iteration_id=` 扩展，不传则默认当前迭代
- **签出复制**：签出时复制上一迭代的 BOM 到新迭代（`_copy_iteration_data` 已实现）

## 数据库

### 现状

```sql
bom_items:
  id UUID PK
  iteration_id UUID FK → part_iterations.id  (nullable, 已存在)
  parent_revision_id UUID FK → part_revisions.id  (nullable, 已存在)
  child_revision_id UUID FK → part_revisions.id  (nullable, 已存在)
  quantity, sort_order, cad_instances, created_at, updated_at, deleted_at
```

### 变更

无需 DDL。`iteration_id` 从可选列变为主绑定列。`parent_revision_id` 保留为冗余/兼容列，新创建的 BOM 项同时写入两列。

## 后端变更

### 1. CRUD 层 (`crud_parts.py`)

| 函数 | 改动 |
|------|------|
| `get_bom_tree(revision_id, iteration_id=None)` | 新增 `iteration_id` 参数。传入时直接查 `BOMItem.iteration_id == iteration_id`；不传时查当前最新迭代 |
| `add_bom_item(revision_id, data, user_id, iteration_id=None)` | 新增 `iteration_id` 参数。创建时写入 `iteration_id`（保留 `parent_revision_id` 冗余写入）|
| `update_bom_item(item_id, data)` | 无需改动（按 item_id 更新）|
| `delete_bom_item(item_id)` | 无需改动（按 item_id 软删除）|
| `get_bom_descendants(revision_id, iteration_id=None)` | 新增 `iteration_id` 参数，查询条件适配 |
| `_copy_iteration_data(source_iter, target_iter)` | 已有 BOM 复制逻辑，确认无误 |

### 2. 路由层 (`routers/parts.py`)

```
GET  /parts/revisions/{rev_id}/bom?iteration_id=xxx  → 返回指定迭代的 BOM 树
POST /parts/revisions/{rev_id}/bom/items?iteration_id=xxx → 向指定迭代添加子项
PUT  /parts/revisions/{rev_id}/bom/items/{item_id} → 不变
DELETE /parts/revisions/{rev_id}/bom/items/{item_id} → 不变
```

### 3. 其他后端文件

| 文件 | 改动 |
|------|------|
| `bom/compare.py` | `get_bom_tree_recursive` 传入 `iteration_id` |
| `routers/bom.py` | `/bom/trace` `/bom/compare` 适配 |
| `crud_eco.py` | ECO 执行中 BOM 操作适配 `iteration_id` |
| `crud_ecr.py` | ECR 影响分析适配 |
| `assistant/tools.py` | AI 工具 BOM 查询适配 |

## 前端变更

### 1. API 层 (`api.ts`)

```typescript
// 现有
getBOM: (revisionId: string) => api.get(`/parts/revisions/${revisionId}/bom`)
addBOMItem: (revisionId: string, data) => api.post(`/parts/revisions/${revisionId}/bom/items`, data)

// 改为
getBOM: (revisionId: string, iterationId?: string) =>
  api.get(`/parts/revisions/${revisionId}/bom`, { params: iterationId ? { iteration_id: iterationId } : {} })
addBOMItem: (revisionId: string, data, iterationId?: string) =>
  api.post(`/parts/revisions/${revisionId}/bom/items`, data, { params: iterationId ? { iteration_id: iterationId } : {} })
```

### 2. 组件层

| 文件 | 改动 |
|------|------|
| `PartDetailModal.tsx` | `loadDetail`/`loadTabs` 中 `getBOM` 传入当前 iteration_id；切换历史迭代时重载 BOM |
| `EntityEditModal.tsx` | `getBOM`/`addBOMItem`/`deleteBOMItem` 传入当前 iteration_id |
| `BOMTreeTable.tsx` / `BOMTreePanel.tsx` | 传入 iteration_id |
| `ECOCreateModal.tsx` / `ECODetailModal.tsx` | BOM 读取传入 iteration_id |
| `importExport.ts` | BOM 导入创建时传入 iteration_id |
| `STPViewer/` 组件 | 适配只读场景 |

### 3. PartDetailModal 迭代切换行为

- 查看历史迭代时：BOM 加载该迭代的快照（只读，隐藏编辑控件）
- 返回当前迭代时：BOM 恢复当前迭代数据
- 签入/签出后：自动刷新当前迭代 BOM

## 边界情况

- **首次创建版本**：version=A 时 iteration=1，BOM 的 iteration_id = iteration_1.id
- **签出**：新 BOM 项加到新 iteration，旧 iteration 的 BOM 不变
- **撤销签出**：删除新 iteration 及其 BOM 项，回退到上一 iteration 状态
- **升版**：复制旧版本最新 iteration 的 BOM 到新版本 iteration=1
- **删除 iteration**：级联删除该 iteration 的 BOM 项（已由 FK ON DELETE CASCADE 保证）
- **前端不传 iteration_id**：后端默认取 `PartRevision.latest_iteration` 对应的 iteration
