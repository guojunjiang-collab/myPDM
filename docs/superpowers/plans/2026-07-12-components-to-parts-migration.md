# 前端 /components → /parts 迁移收尾 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 把前端所有仍在调用已废弃 `/components`、`/assemblies` 端点的遗留代码，全部迁移到新的 `/parts`（PartMaster/PartRevision 三层）revision 模型，恢复 ECO、配置、库存、项目、导入导出等功能。

**Architecture:** 后端 `/components`、`/assemblies` 路由已删除，只保留 `/parts`。主零部件页（PartsPage）、看板、项目任务、配置详情已迁移到 `partsApi`（以 `revision_id` 为 BOM/附件/文档操作主键，`master_id` 为零部件身份）。本计划迁移剩余遗留组件与 API 封装，统一到同一约定。

**Tech Stack:** React 18 + TS + Vite；`frontend/src/services/api.ts` 的 `partsApi`；后端 FastAPI `/api/parts/*`。

---

## 核心约定（所有任务遵守）

- **零部件身份 = `master_id`**；**版本实体 = `revision_id`**。
- **BOM 子项 / 附件 / 关联文档 / 自定义字段值** 一律以 `revision_id` 为主键操作。
- **详情/编辑弹窗** 一律复用已工作的 `PartDetailModal`（props：`masterId`、可选 `revisionId`、`open`、`onClose`）。
- **子项选择器** 一律用 `<AssemblyPartPicker ... dataMode="parts" />`，其 `onConfirm` 回调的 `child_id` = 子件 `revision_id`。
- `partsApi.list(params)` 直接返回 `data`（`{items:[PartListItem], total}`），**非 axios 响应**，无需 `.data`。`PartListItem` 字段：`master_id, revision_id, code, name, spec, type('part'|'assembly'), version, status`。
- `partsApi.getBOM(revisionId)` 直接返回子项数组，字段：`id(bom_item_id), child_revision_id, child_master_id, child_code, child_name, child_spec, child_version, child_status, child_type, has_children, quantity`。
- `partsApi.getRevision(revisionId)` 返回 `{id, master_id, version, status, current_iteration:{...}, ...}`。
- `partsApi.get(masterId)` 返回 `{id, code, name, spec, type, latest_revision:{id,version,status,...}}`。

### 旧 API → 新 API 映射表

| 旧调用（已坏） | 新调用 |
|---|---|
| `componentsApi.list(p)` → `.data.items` | `await partsApi.list(p)` → `.items`（id 用 `revision_id`） |
| `componentsApi.get(id)` | `await partsApi.getRevision(revisionId)`（或 `partsApi.get(masterId)`） |
| `componentsApi.create(d)` | `await partsApi.create(d)` → `{id(master), latest_revision:{id,version,status}}` |
| `componentsApi.update(id,d)` | `await partsApi.update(masterId, {code,name,spec})` |
| `assembliesApi.*` | 对应 `partsApi.*` |
| `assemblyPartsApi.list(id)` → `.data`（`child_detail` 结构） | `await partsApi.getBOM(revisionId)`（扁平 `child_*` 结构，需适配读取处） |
| `assemblyPartsApi.add(id,{child_type,child_id,qty})` | `await partsApi.addBOMItem(revisionId,{child_revision_id:child_id, quantity})` |
| `assemblyPartsApi.update(id,itemId,{quantity})` | `await partsApi.updateBOMItem(revisionId,itemId,{quantity})` |
| `assemblyPartsApi.remove(id,itemId)` | `await partsApi.deleteBOMItem(revisionId,itemId)` |

### 受影响文件清单（12 处 broken 调用 + 5 处 picker 未设 parts 模式）

- 共享：`components/AssemblyDetailContent.tsx`、`components/BOMTreeTable.tsx`、`components/EntityEditModal.tsx`、`services/api.ts`（`entityDocumentsApi`、`componentAttachmentsApi` 的 component 分支）
- 选择器（需 `dataMode="parts"`）：`EntityEditModal.tsx`、`Configuration/ConfigurationCreateModal.tsx`、`ECO/ECOCreateModal.tsx`、`ECO/ECODetailModal.tsx`、`ECO/ECOEditView.tsx`
- 功能页：`ECO/ECOEditView.tsx`、`Configuration/ProfileEditModal.tsx`、`Inventory/MaterialTab.tsx`（详情弹窗）、`services/importExport.ts`
- 构建脚本：`frontend/package.json`（`prebuild`/`gen:perms` 的 `python3` → `python`）

---

## Phase 0：构建脚本与后端端点确认

### Task 0.1: 修复 prebuild 的 python3

**Files:** Modify `frontend/package.json`

- [ ] **Step 1**：把 `"prebuild": "python3 ../tools/gen_permissions.py"` 与 `"gen:perms": "python3 ../tools/gen_permissions.py"` 中的 `python3` 改为 `python`。
- [ ] **Step 2**：验证 `cd frontend; npm run gen:perms`，预期输出 `Wrote ... permissions.generated.ts`，退出码 0。
- [ ] **Step 3**：提交 `git commit -m "fix(build): prebuild 使用 python 兼容 Windows"`

### Task 0.2: 确认后端 parts 的文档/附件端点契约

**Files:** 只读 `backend/app/routers/parts.py`

- [ ] **Step 1**：定位并阅读以下端点，记录其**路径参数是 master_id 还是 revision_id**、请求/响应字段：
  - `GET/POST /parts/{id}/documents`（约 line 712）与 `GET/POST /parts/revisions/{id}/documents`（约 line 735）
  - `GET/POST/DELETE /parts/revisions/{revision_id}/attachments`
- [ ] **Step 2**：把结论写入本文件"核心约定"下方作为事实依据（文档端点用哪种 id、附件端点用 revision_id）。这是 Phase 1 Task 1.3 的前置。
- [ ] **Step 3**：若 `/parts/{id}/documents` 只支持 master 而附件只支持 revision，则 Phase 1 中 `EntityDocumentSection` 与 `ComponentAttachmentBucket` 分别按各自 id 传参。

---

## Phase 1：共享基础组件迁移（其余功能都依赖）

### Task 1.1: `BOMTreeTable` 改为 revision 模型

**Files:** Modify `frontend/src/components/BOMTreeTable.tsx`

参考已完成的 `frontend/src/pages/BOM/BOMTreePanel.tsx`（同款自建递归树，用 `partsApi.getBOM`、`has_children` 懒加载、`child_master_id/child_revision_id`）。

- [ ] **Step 1**：把 props `assemblyId` 语义改为 `revisionId`（保留同名或改名，调用方 Task 1.2 同步）。新增可选 `rootMasterId`。
- [ ] **Step 2**：`loadViewParts` 用 `const rows = await partsApi.getBOM(revisionId)`；节点直接用 `has_children` 决定可展开，删除 `preCheckChildren` 的并行探测。
- [ ] **Step 3**：展开子节点用 `partsApi.getBOM(node.item.child_revision_id)`。
- [ ] **Step 4**：行渲染字段从 `child_detail?.code` 改为 `child_code` 等扁平字段；`onRowClick` 回调改为传 `(child_master_id, child_revision_id)`。
- [ ] **Step 5**：`npx tsc` 通过（0 错误）。
- [ ] **Step 6**：提交。

### Task 1.2: `AssemblyDetailContent` 改为 revision 模型

**Files:** Modify `frontend/src/components/AssemblyDetailContent.tsx`

前提：调用方传入的 `assembly` 对象需含 `revision_id`。**先确认**（见各 Phase 的 caller 任务）。

- [ ] **Step 1**：新增/使用 `assembly.revision_id`（若缺失，回退 `assembly.id`）。定义 `const revId = (assembly as any).revision_id || assembly.id`。
- [ ] **Step 2**：`assemblyPartsApi.list(assembly.id)` → `partsApi.getBOM(revId)`；`hasSubItems` 判断用返回数组长度。
- [ ] **Step 3**：`<BOMTreeTable assemblyId=... />` 改为传 `revisionId={revId}`。
- [ ] **Step 4**：`EntityDocumentSection` / `ComponentAttachmentBucket` 的 id 按 Task 0.2 结论传（component 分支改走 parts）。
- [ ] **Step 5**：`npx tsc` 通过；提交。

### Task 1.3: `entityDocumentsApi` / `componentAttachmentsApi` component 分支改走 parts

**Files:** Modify `frontend/src/services/api.ts`

依据 Task 0.2 结论。

- [ ] **Step 1**：`entityDocumentsApi` 的 `base` 计算里，`'component'|'assembly'` 从 `'components'` 改为 parts 对应路径（若端点用 revision，则调用方需传 revision_id）。
- [ ] **Step 2**：`componentAttachmentsApi.list/remove` 从 `/components/{id}/attachments` 改为 `/parts/revisions/{revisionId}/attachments`（含 `deleteAttachment` 语义对齐 `partsApi`）。
- [ ] **Step 3**：全局搜索 `componentAttachmentsApi`、`entityDocumentsApi` 调用方，确认传入 id 与新端点一致（`ComponentAttachmentBucket`、`EntityDocumentSection`）。
- [ ] **Step 4**：`npx tsc` 通过；提交。

### Task 1.4: `EntityEditModal` 迁移到 partsApi

**Files:** Modify `frontend/src/components/EntityEditModal.tsx`

- [ ] **Step 1**：`const api = ...componentsApi/assembliesApi/partsApi` 改为统一走 `partsApi`；`entityId` 语义统一为 `revision_id`；加载详情用 `partsApi.getRevision(entityId)`（读 code/name/spec 来自其 master，需 `partsApi.get(master_id)` 或 revision 响应含这些字段——按 Task 0.2/接口实际）。
- [ ] **Step 2**：`loadEditParts` 用 `partsApi.getBOM(revisionId)`；`renderPartRow` 字段从 `child_detail?.*` 改为扁平 `child_*`。
- [ ] **Step 3**：`handleAddParts`/`handleRemovePart`/`handleUpdateQuantity`/嵌套操作 改用 `partsApi.addBOMItem/deleteBOMItem/updateBOMItem`。
- [ ] **Step 4**：`<AssemblyPartPicker>` 加 `dataMode="parts"`；`existingChildIds` 用子项的 `child_revision_id`。
- [ ] **Step 5**：`handleSubmit` 的 `api.update` 改 `partsApi.update(masterId,{code,name,spec})`；需要 masterId → 从 `partsApi.getRevision` 响应的 `master_id` 取。
- [ ] **Step 6**：`VersionSelectModal` 的 `entityId`/`currentVersionId` 传 `child_master_id`（版本列表按 master 查）。确认 `VersionSelectModal` 内部 `api.versions` 已走 parts；若未，改用 `partsApi.revisions(masterId)`。
- [ ] **Step 7**：`npx tsc` 通过；提交。

**Phase 1 验收**：`npm run build` 成功；手动打开主零部件页 `PartDetailModal`（仍应正常，未被破坏）。

---

## Phase 2：配置管理（Configuration）

### Task 2.1: `ConfigurationCreateModal` 子项选择器 + 详情

**Files:** Modify `frontend/src/components/Configuration/ConfigurationCreateModal.tsx`

- [ ] **Step 1**：阅读 line 720–840，确认 `api`（`api.get(it.child_id)`、`api.get(target.id)`、`api.get(versionId)`）指向哪个封装；`configuration_item_parts` 存的 `child_id` 是 master 还是 revision（查后端 `crud_configuration.py`/`models_configuration.py`）。
- [ ] **Step 2**：`<AssemblyPartPicker>`（line 737）加 `dataMode="parts"`。
- [ ] **Step 3**：把 `api.get(...)`（componentsApi）替换为 `partsApi.getRevision(revisionId)` 或 `partsApi.get(masterId)`，与 Step 1 结论一致。
- [ ] **Step 4**：`npx tsc` 通过；提交。

### Task 2.2: `ProfileEditModal` 的 componentsApi.get

**Files:** Modify `frontend/src/components/Configuration/ProfileEditModal.tsx:147,152`

- [ ] **Step 1**：确认 `itemId` 是 master 还是 revision（上下文 line 140–160）。
- [ ] **Step 2**：`componentsApi.get(itemId)` → `partsApi.getRevision(itemId)` 或 `partsApi.get(itemId)`，读取字段对齐。
- [ ] **Step 3**：`npx tsc` 通过；提交。

**Phase 2 验收**：`npm run build` 成功；后端实测 `GET /api/configurations/...` 相关无 500（用 admin token）。

---

## Phase 3：ECO / ECR 变更管理

### Task 3.1: ECO 弹窗子项选择器改 parts 模式

**Files:** Modify `ECO/ECOCreateModal.tsx`、`ECO/ECODetailModal.tsx`、`ECO/ECOEditView.tsx`

- [ ] **Step 1**：给这三个文件中的 `<AssemblyPartPicker>` 加 `dataMode="parts"`。

### Task 3.2: ECOCreateModal / ECODetailModal 的 assemblyPartsApi.list

**Files:** Modify `ECO/ECOCreateModal.tsx:829`、`ECO/ECODetailModal.tsx:556`

- [ ] **Step 1**：阅读各自 line 上下文，确认 `entityId` 语义（master/revision）；ECO `release_items`/`affected` 存的 id 查后端 `models_eco.py`/`crud_eco.py`。
- [ ] **Step 2**：`assemblyPartsApi.list(entityId)` → `partsApi.getBOM(revisionId)`，读取处字段改扁平 `child_*`。
- [ ] **Step 3**：这两个弹窗中渲染 `AssemblyDetailContent`（ECOCreateModal:738、ECODetailModal:427）传入的 `nestedData` 需含 `revision_id`（Task 1.2 前提）。确认 `nestedData` 来源并补 `revision_id`。

### Task 3.3: ECOEditView 的 componentsApi

**Files:** Modify `ECO/ECOEditView.tsx:635,649,764,766`

- [ ] **Step 1**：line 631–657 的状态查询 `componentsApi.list({search:entity_code})` → `partsApi.list({search:entity_code})`（`.items`，比较用 `revision_id !== entity_id`，`newId=revision_id`）。
- [ ] **Step 2**：picker `onConfirm`（line 760–773）：`componentsApi.get(item.child_id)` → 直接用 picker 已返回的候选信息，或 `partsApi.getRevision(item.child_id)`。
- [ ] **Step 3**：`npx tsc` 通过；提交。

**Phase 3 验收**：`npm run build` 成功；后端实测 ECO 详情/列表 API 无 500。

---

## Phase 4：库存 & 导入导出

### Task 4.1: MaterialTab 详情弹窗

**Files:** Modify `frontend/src/components/Inventory/MaterialTab.tsx`

- [ ] **Step 1**：line 46–60 的 `api.get(id)` + `PartDetailContent/AssemblyDetailContent` 详情，改为复用 `PartDetailModal`（masterId=ref_entity_id 对应的 master，revisionId 可选）。确认 `ref_entity_id` 存 master 还是 revision（查后端 `models_inventory.py`）。
- [ ] **Step 2**：`npx tsc` 通过；提交。

### Task 4.2: importExport.ts

**Files:** Modify `frontend/src/services/importExport.ts:697,716,828,1396,1411,1483,1501,1509`

- [ ] **Step 1**：`componentsApi.create(d)` → `partsApi.create(d)`（返回结构不同：用 `res.latest_revision.id` 作为后续 BOM 操作的 revision）。
- [ ] **Step 2**：`componentsApi.update(existing.id,d)` → `partsApi.update(masterId,d)`。
- [ ] **Step 3**：`assemblyPartsApi.list(parentId)` → `partsApi.getBOM(parentRevisionId)`；`assemblyPartsApi.add(parentId,{child_type,child_id,qty})` → `partsApi.addBOMItem(parentRevisionId,{child_revision_id, quantity})`。
- [ ] **Step 4**：处理 `.data` 差异（partsApi 系列多数直接返回 data）。
- [ ] **Step 5**：`npx tsc` 通过；提交。

**Phase 4 验收**：`npm run build` 成功；手动跑一次零部件 Excel 导入预览（不落库）确认无请求 404。

---

## Phase 5：清理与全量验证

### Task 5.1: 移除死封装

- [ ] **Step 1**：全局搜索确认 `componentsApi`、`assembliesApi`、`assemblyPartsApi` 已无引用（`grep`）。
- [ ] **Step 2**：从 `services/api.ts` 删除这三个封装（及 `componentAttachmentsApi` 若已被 partsApi 取代）。
- [ ] **Step 3**：`npx tsc` 通过。

### Task 5.2: 全量构建与冒烟

- [ ] **Step 1**：`cd frontend; npm run build` 成功。
- [ ] **Step 2**：`docker logs bom_backend --tail 50` 无新报错。
- [ ] **Step 3**：逐一冒烟（浏览器）：主零部件页 BOM 添加、ECO 详情/编辑、配置创建/概要、库存物料详情、导入预览、管理工具 4 个 BOM 工具。
- [ ] **Step 4**：提交总结 commit。

---

## 风险与注意

- **不要破坏已迁移路径**：`ConfigurationDetailModal`、`PartDetailModal`、`TaskEditModal`、`Board`、`MaterialTab` 的 partsApi 列表部分已工作，改动相邻代码时勿回退。
- **id 约定是最大风险**：每个功能存的 `entity_id/child_id` 可能是 master 或 revision，必须逐 feature 查后端模型确认后再改（各任务已含确认步骤）。
- **无法完全自动测试** ECO/配置/库存工作流，需人工冒烟。
- 每个 Phase 结束后 `npm run build` + 后端日志检查，出问题就地修复再进下一 Phase。
