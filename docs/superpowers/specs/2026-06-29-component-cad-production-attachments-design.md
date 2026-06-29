# 零部件 CAD附件 / 生产附件 设计文档

**日期**: 2026-06-29
**分支**: V2.0
**状态**: 已评审待实现

## 1. 背景与目标

零部件（components）数据需要新增两个附件字段：

- **CAD附件**
- **生产附件**

每个字段是一个**附件桶**，可容纳**多个直接上传的原始文件**（如 .stp / .pdf / .zip），并复用现有附件模组的全部能力：分块上传、预览（PDF/Office/文本/图片）、STP→3D 查看、压缩包浏览、下载、删除。

**明确不在本次范围内**：关联已有图文档。零部件已有独立的"关联图文档"功能，本次只做两类附件的**直接上传**。

## 2. 现状关键事实

- 图文档存储形态：`documents`（父实体）⟵ `document_attachments`（子附件表，`document_id` 外键 `NOT NULL`，含 `file_name/file_size/file_path/file_hash`）。
- 文件存储层 `file_storage.py` 已支持 `document` / `part` / `assembly` 目录布局，但**尚未支持** `component`。
- 通用上传端点 `/attachments/upload` 与 `/attachments/chunk/*` 已接收 `entity_type` 参数，但建库记录时仅对 `document` 类型写入 `document_attachments`。
- 媒体端点（预览/下载/流式/3D/Office-PDF/压缩包/media-token）均以 `db.query(DocumentAttachment).filter(id==...)` 定位附件，仅需 `file_path` / `file_name` / `id`。
- 前端可复用件：
  - `v2UploadApi`（小文件 + 分块上传）
  - `previewAttachment`、`mediaApi.token`、`ArchiveTreeModal`（预览/3D/压缩包/下载，均以附件 id 为入口，命中 `/attachments/{id}/*`）
  - `EntityDocumentSection` 内的附件子表是 UI 模板
- 组件统一（component-unification）已将 parts/assemblies 合并为 components。

## 3. 架构决策

**照抄图文档及其附件的存储形态**：新建独立的 `component_attachments` 子表，结构与 `document_attachments` 一致，父实体为 `components`（已评审确定）。

- 图文档附件链路（`documents` / `document_attachments`）**完全不动**，零回归风险。
- 为同时满足"借用附件模组功能"，媒体端点改为**跨表解析**附件 id：新增一个解析器，先查 `document_attachments`、再查 `component_attachments`，返回统一的 `(file_path, file_name, source)`。前端 `previewAttachment` / `mediaApi.token` / `ArchiveTreeModal` 命中的 `/attachments/{id}/*` 路由因此对两类附件**同时生效，前端零改动**。
- 文件落盘、STP→glb 转换、Office→PDF 转换、缓存删除等均以 `attachment_id + file_path` 为参数，对新表附件天然可用。

> 取舍：相比"同表加列"，独立表对图文档侧零侵入，代价是媒体端点需要一处跨表解析改造（集中、可控）。

## 4. 数据模型

### 4.1 新增 `component_attachments` 表（照抄 `document_attachments`）

| 列 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `component_id` | UUID 外键 → `components.id`，`ON DELETE CASCADE`，`NOT NULL` |
| `category` | `VARCHAR(32) NOT NULL`，取值 `'cad'` / `'production'` |
| `file_name` | `VARCHAR(255)` |
| `file_size` | `Integer` |
| `file_path` | `VARCHAR(512)`，文件系统路径 |
| `file_hash` | `VARCHAR(64)` |
| `created_at` | 带时区时间戳，默认 now() |

索引：`(component_id, category)`。

### 4.2 迁移（migration）

- 仅**新建**表 `component_attachments`，幂等（`IF NOT EXISTS`）。
- `document_attachments` / `documents` **不变**。

### 4.3 模型 (`models.py`)

新增 `ComponentAttachment(Base)`，字段同上；`DocumentAttachment` 不变。

## 5. 文件存储

`file_storage.py`：

- `ALLOWED_ENTITY_TYPES` 增加 `"component"`。
- `ENTITY_TYPE_ALIASES` 增加 `"components": "component"`。
- 文件落盘到 `…/component/<component_id>/`。

## 6. API 设计

### 6.1 上传（复用通用端点的文件机制，按 entity_type 分流建库）

`/attachments/upload`、`/attachments/chunk/init`、`/attachments/chunk/complete`：

- 新增可选表单字段 `category`（`cad` / `production`）。
- 文件保存逻辑（file_storage / chunked_uploader）保持复用。
- 建库分流：
  - `entity_type=document/documents`：维持现有行为，写 `document_attachments` 并更新 `documents.file_name/file_id`。
  - `entity_type=component/components`：写一行 `component_attachments`（`component_id=entity_id`、`category=category`）。
- 分块流程：`chunked_uploader.init_upload` 的 meta 增加 `category`，`complete` 端点据 `entity_type` 决定写入哪张表。

### 6.2 列表（新增，挂在 components 路由）

`GET /components/{component_id}/attachments?category=cad`

- 查询 `component_attachments`，返回该零部件指定分类的附件行（id / file_name / file_size / created_at）。
- `category` 可选；不传返回全部，前端按分类分桶。
- 权限：`components:read`。

### 6.3 删除（新增，挂在 components 路由）

`DELETE /components/{component_id}/attachments/{attachment_id}`

- 删除 `component_attachments` 行 + 磁盘文件 + STP/Office 缓存（镜像 `document_attachments` 的删除清理逻辑）。
- 权限：`attachments:delete`（或 `components:update`，实现时择一并保持一致）。

### 6.4 媒体端点（跨表解析复用）

`attachments_v2.py` 中 preview / download / stream / gltf / office-pdf / archive-tree / extract-file / media-token：

- 新增解析器 `resolve_attachment(db, attachment_id)`：先查 `DocumentAttachment`，再查 `ComponentAttachment`，返回统一对象 `{id, file_name, file_path, source}`。
- 各端点把原 `db.query(DocumentAttachment)...` 替换为解析器调用。
- `crud_groups.enforce_attachment_content_access`（图文档用户组权限）仅对 `source='document'` 执行；`source='component'` 视为可访问（零部件无用户组维度权限）。

### 6.5 权限

- 文件上传/预览/下载：复用现有 `attachments:upload` / `attachments:preview` / `attachments:download`。
- 零部件附件列表：`components:read`；删除：`attachments:delete`（与 6.3 一致）。

## 7. 前端设计

### 7.1 新增可复用组件 `ComponentAttachmentBucket`

Props：`{ componentId: string; category: 'cad' | 'production'; label: string; editable: boolean }`

渲染一个带标题的附件桶：

- `editable=true`：显示"+ 上传附件"按钮（小文件走 `v2UploadApi.uploadSmallFile`，超阈值走分块，`entity_type='components'`，带 `category`），上传进度条，文件表（文件名 / 大小），每行"删除"（调 6.3 端点）。
- 预览 / 下载 / 3D / 压缩包浏览：复用 `previewAttachment`、`mediaApi.token`、`ArchiveTreeModal`，与 `EntityDocumentSection` 的附件子表一致（命中 `/attachments/{id}/*`，由 6.4 跨表解析支撑）。
- `editable=false`（详情只读）：仅显示预览 / 下载。
- 列表数据来自 6.2 端点。

样式遵循现有"构型管理 / 图文档"区风格：`primary-*` 配色、共享 `Modal`、统一表格与工具栏（符合项目 UI 一致性约束）。

### 7.2 接入位置

零部件**编辑弹窗**与**详情（只读）视图**中各放置两个实例：

- CAD附件：`category='cad'`，`label='CAD附件'`
- 生产附件：`category='production'`，`label='生产附件'`

编辑视图 `editable=true`，详情视图 `editable=false`。具体接入文件在实现计划阶段定位（`ComponentsPage.tsx` 及其编辑/详情子组件）。

### 7.3 API 客户端

`services/api.ts` 增加 `componentAttachmentsApi.list(componentId, category?)` 与 `componentAttachmentsApi.remove(componentId, attachmentId)`；确保 `v2UploadApi` 上传透传 `category`。

## 8. 边界情况

- **删除零部件**：`component_attachments.component_id` 的 `ON DELETE CASCADE` 清掉行；磁盘文件与 STP/Office 缓存需在删除零部件时一并清理（镜像图文档删除清理）。
- **大文件**：自动走现有分块上传路径（超阈值）。
- **STP 文件**：任一桶内 STP 自动获得按需 3D 查看（复用 `gltf` 端点 + 跨表解析）。
- **Office / 文本 / 图片**：复用现有预览管线。
- **ID 跨表**：两表均 UUID，解析器按"先 document 后 component"顺序匹配，碰撞概率可忽略。
- **空桶**：显示"暂无附件"占位。
- **向后兼容**：新增表 + 端点跨表解析，图文档附件行为完全不变。

## 9. 验证

- 后端：迁移幂等；上传/列表/删除单测覆盖 `component_attachments` 与 `category` 分桶；跨表解析器单测（document/component 两源 + 不存在）；图文档附件回归。
- 前端：`build` 通过；编辑视图可上传/删除、详情视图可预览/下载两类附件。
- 手测：Docker 环境上传 .stp 验证 3D、.pdf 验证预览、大文件验证分块、删除零部件验证文件清理。

## 10. 不做（YAGNI）

- 不做图文档关联（已有独立功能）。
- 不做附件审批/版本/状态流转（原始文件桶）。
- 不改动 `document_attachments` / `documents` 表结构。
