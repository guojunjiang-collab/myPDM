# ECO 三层数据结构适配 — 设计文档

**日期**: 2026-08-07
**状态**: 进行中

---

## 背景

ECO 模块（升版/冻结/解冻/发布/还原）当前仍使用旧的扁平数据模型，以 `PartMaster.id` 作为 `entity_id`、以 `PartMaster.status` 作为状态载体。零部件已全面迁移到三层模型（PartMaster → PartRevision → PartIteration），需要适配。

## 核心改动

### entity_id 语义变更

`entity_id` 从 `PartMaster.id` 改为 `PartRevision.id`：

- `eco_execution_items.entity_id` → 存 PartRevision.id
- `ecos.release_items[].entity_id` → 存 PartRevision.id
- `ecos.frozen_entities[].entity_id` → 存 PartRevision.id

### 升版

- 旧: `_clone_entity()` 创建新 PartMaster（复制 code/name/type）
- 新: 调用 `crud_parts.upgrade_part(revision_id, user_id)`，在同一 PartMaster 下创建新 PartRevision + PartIteration

### 状态操作（冻结/解冻/发布）

- 旧: 查询 PartMaster，改 PartMaster.status
- 新: 查询 PartRevision，改 PartRevision.status

### 还原

- draft 状态还原: 删除 PartRevision（级联删除 PartIteration），清理执行项记录
- frozen 状态还原: 改 PartRevision.status → draft

### BOM 树遍历

- `collect_release_tree_entities()`: 使用 `BOMItem.parent_revision_id/child_revision_id` 替代旧字段
- `_execute_*` 系列: 适配 BOM 引用模型

---

## 涉及文件

### 后端

| 文件 | 改动内容 |
|------|---------|
| `crud_eco.py` | `_clone_entity()` 替换为调用 `upgrade_part()`；`collect_release_tree_entities()`/`freeze_release_tree_on_submit()`/`unfreeze_release_tree()` 适配 PartRevision；`_execute_*` BOM 引用适配 |
| `routers/ecos.py` | 手动升版/还原/冻结/发布/一键发布端点，model 从 PartMaster → PartRevision |
| `schemas_eco.py` | 可能需要调整 entity_id 字段注释/描述 |

### 前端

| 文件 | 改动内容 |
|------|---------|
| `ECOEditView.tsx` | 状态自动检测逻辑适配三层模型；按钮回调传递正确 ID |
| `ECODetailModal.tsx` | 操作回调适配；行点击跳转使用 revision ID |

---

## 实现策略

1. 复用 `crud_parts.upgrade_part()` 作为升版入口（已实现完整的三层模型逻辑）
2. entity_id 改为存 PartRevision.id，所有读写通过 PartRevision 模型
3. BOM 遍历使用 `parent_revision_id`/`child_revision_id`
4. 前端最小改动——ID 传递逻辑不变，只需适配自动检测
