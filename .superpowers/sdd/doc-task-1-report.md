# Task 1 完成报告：图文档数据模型 + 迁移

**日期**: 2026-07-21
**状态**: 完成

## 改动摘要

### 1. `backend/app/models.py`
- **删除**: `Document` 类（旧的扁平图文档模型，含 `file_name`/`file_id` 冗余字段）
- **新增**: `DocumentMaster` 类 → `document_masters` 表（code/name/revisions/creator_id）
- **新增**: `DocumentRevision` 类 → `document_revisions` 表（master_id/version/status/remark/签出字段/latest_iteration）
- **修改**: `DocumentIteration.document_id` → `revision_id`，FK 指向 `document_revisions`
- **修改**: `DocumentAttachment.document_id` → `revision_id`，FK 指向 `document_revisions`
- **修改**: `DocumentGroupLink.document_id` → FK 指向 `document_masters.id`

### 2. `initdb/migrations/011_document_three_tier.sql`
- 创建 `document_masters` 和 `document_revisions` 表
- 旧数据迁移：按 code 去重创建 master，每个旧 doc 对应一个 revision(A=draft)
- 更新 `document_iterations` FK：`document_id` → `revision_id`
- 更新 `document_attachments` FK：`document_id` → `revision_id`
- 更新 `document_group_links` FK：指向 `document_masters`
- 删除旧 `documents` 表
- **幂等**：对已迁移的数据库重复执行不报错

### 3. `backend/app/main.py`
- 移除 `revision_parent_id` 检查中的 `documents` 引用
- 移除旧的 `documents.revisions` 列检查
- 移除 `documents` 从软删除/部分索引迁移列表
- 移除旧的"图文档签入签出存量迭代补建"代码块（由迁移SQL处理）

## 验证结果

| 检查项 | 结果 |
|--------|------|
| 迁移 SQL 执行 | 成功（COMMIT 无错误） |
| `documents` 表已删除 | 是 |
| `document_masters` 有 14 行 | 是 |
| `document_revisions` 有 15 行 | 是 |
| `document_iterations` 列 `revision_id` 存在，`document_id` 已移除 | 是 |
| `document_attachments` 列 `revision_id` 存在，`document_id` 已移除 | 是 |
| `document_group_links` FK → `document_masters` | 是 |
| `document_revisions` FK → `document_masters` | 是 |
| 后端启动 "Application startup complete" | ⚠ 未出现（预期的——下游导入错误待 Task 2-4 修复） |

## 已知影响（待后续任务修复）

- `backend/app/routers/documents.py`：导入 `Document` 失败，后端无法启动
- 所有引用 `Document` 模型的文件均需更新为 `DocumentMaster`/`DocumentRevision`

这些是预期的破坏性变更，将在 Task 2-4 中逐一修复。
