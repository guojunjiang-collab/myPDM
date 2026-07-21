# 图文档三层模型重构 实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development to execute.

**Goal:** 将图文档从扁平模型重构为 Master→Revision→Iteration 三层架构，统一三类实体数据模型。

**Architecture:** 参照已完成零部件的三层拆分模式。新建 document_masters/document_revisions 两表，现有 document_iterations FK 改为 revision_id。外部引用（ECR/ECO/Part/ConfigItem）的 document_links 中 document_id 改为 document_revision_id。

**Spec:** `docs/superpowers/specs/2026-07-21-document-three-tier-design.md`

## Global Constraints

- 版本序列：A→B→...→ZZ，复用 `crud.py` 中的 `_to_version_string`/`_get_next_version`
- 签出模式：参照零部件（创建新迭代+1，复制上一迭代附件引用）
- 附件：去掉 file_name/file_id 冗余快照，仅存 DocumentAttachment 表
- 软删除：仅 Revision 层
- 不改动库存单据（InventoryDocument）、V2附件端点核心逻辑
- 前端 UI 参照零部件详情模式

---

### Task 1: 数据模型 + 迁移

**Files:**
- Modify: `backend/app/models.py`
- Create: `initdb/migrations/011_document_three_tier.sql`

- [ ] Replace `Document` class with `DocumentMaster` + `DocumentRevision`
- [ ] Update `DocumentIteration.document_id` → `revision_id` (FK to document_revisions)
- [ ] Update `DocumentAttachment.document_id` → `revision_id` (FK to document_revisions)
- [ ] Update `DocumentGroupLink.document_id` → FK to document_masters.id
- [ ] Drop `file_name`, `file_id` from old document (these fields won't exist in new tables)
- [ ] Add `ConfigurationItem = ConfigurationItemMaster` alias if not already present
- [ ] Create migration SQL: create new tables, migrate data (each old doc → 1 master + 1 revision(A) + update iteration FK), update attachment FK, update group link FK, drop old table
- [ ] Update `main.py` auto-migration: remove `documents` references, add new table references

### Task 2: CRUD 函数

**Files:**
- Modify: `backend/app/crud_documents.py`
- Modify: `backend/app/crud.py`

- [ ] Rewrite `crud_documents.py`: create_document (master+revision(A)+iteration(1)), checkout/checkin/undo/force-checkin, upgrade (generate new version + create new revision + iteration 1)
- [ ] Update `crud.py`: upgrade_document to use new models, get_document_versions
- [ ] Update `crud_groups.py`: get_document_group_ids → FK to masters

### Task 3: API 路由 + Schema

**Files:**
- Modify: `backend/app/routers/documents.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/attachments_v2.py`

- [ ] Rewrite `/api/documents` endpoints: list (master aggregate), create, detail, update, delete, checkout, checkin, undo, force-checkin, upgrade, freeze, release, obsolete, versions, iterations, delete iteration
- [ ] Update schemas: DocumentCreate, DocumentUpdate, DocumentRevisionOut, DocumentDetailOut
- [ ] Update attachments_v2: update document_id → revision_id references

### Task 4: 外部引用适配

**Files:**
- Modify: `backend/app/routers/parts.py` (document_links)
- Modify: `backend/app/routers/configuration.py` (document_links)
- Modify: `backend/app/routers/bom.py` (doc-refs)
- Modify: `backend/app/routers/dashboard.py` (DashboardItem)
- Modify: `backend/app/crud_ecr.py` / `crud_eco.py`
- Modify: `backend/app/schemas_ecr.py` / `schemas_eco.py`
- Modify: `backend/app/assistant/tools.py` / `knowledge.py`

- [ ] Update all document_links references: document_id → document_revision_id
- [ ] Update DashboardItem: entity_id → document_masters.id
- [ ] Update AI assistant document references

### Task 5: 前端类型 + API

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] Split `Document` interface into `DocumentMaster` + `DocumentRevision` + `DocumentIteration`
- [ ] Clean up duplicate `DocumentBrief` definitions (3 copies → 1)
- [ ] Rewrite `documentsApi` methods for new endpoints
- [ ] Verify: `npx tsc --noEmit` (will have component errors until Tasks 6-7)

### Task 6: DocumentDetailModal 重构

**Files:**
- Create/Modify: `frontend/src/components/DocumentDetailModal.tsx`

- [ ] Rewrite with PartDetailModal pattern: version/status bar + action buttons (checkout/checkin/undo/upgrade/freeze/release/obsolete/force-checkin), tabs (info/attachments/versions/iterations/custom-fields), inline editable when checked out

### Task 7: 列表 + Picker + 其他组件适配

**Files:**
- Modify: `frontend/src/pages/Documents.tsx` (list page)
- Modify: `frontend/src/components/DocumentPicker.tsx`
- Modify: `frontend/src/components/EntityDocumentSection.tsx`
- Modify: `frontend/src/components/DocumentDetailContent.tsx`
- Modify: `frontend/src/stores/data.ts`
- Modify: `frontend/src/services/importExport.ts`

- [ ] List page: use new API, show version+status columns
- [ ] Picker: adapt to new list response
- [ ] EntityDocumentSection: update FK references
- [ ] Clean up stale document type references

### Task 8: 编译部署 + 验证

- [ ] `cd frontend; npm run build`
- [ ] Deploy: nginx + backend restart
- [ ] Run migration SQL on existing database
- [ ] Verify: create doc → checkout → upload attachment → checkin → upgrade → freeze → release
