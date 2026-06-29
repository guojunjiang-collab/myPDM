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

- 附件表 `document_attachments` 当前与图文档强绑定：`document_id` 为 `NOT NULL` 且外键指向 `documents`。因此附件目前只能挂在图文档上。
- 文件存储层 `file_storage.py` 已支持 `document` / `part` / `assembly` 目录布局，但**尚未支持** `component`。
- 通用上传端点 `/attachments/upload` 与 `/attachments/chunk/*` 已接收 `entity_type` 参数，但建库记录时仅对 `document` 类型写入关联；非 document 类型会因 `document_id NOT NULL` 约束而失败。
- 前端已有可复用件：
  - `v2UploadApi`（小文件 + 分块上传）
  - `previewAttachment`、`mediaApi.token`、`ArchiveTreeModal`（预览/3D/压缩包/下载，均以附件 id 为入口）
  - `EntityDocumentSection` 内的附件子表是 UI 模板
- 组件统一（component-unification）已将 parts/assemblies 合并为 components。

> 代码已为"通用化附件"铺好了一半路（upload 接收 entity_type、file_storage 支持多实体目录），本设计沿该方向落地。

## 3. 架构决策

采用**通用化共享附件表**方案（已评审通过），而非新建独立表或把文件包装成图文档：

- 直接复用 `document_attachments` 表与现有上传/预览/3D/下载管线，使 STP 3D、Office 预览等能力对零部件附件"零成本可用"。
- 改动为**追加式、向后兼容**：现有图文档附件行不受影响。

## 4. 数据模型

### 4.1 `document_attachments` 表变更

| 列 | 变更 |
|---|---|
| `document_id` | `NOT NULL` → **可空** |
| `entity_type` | **新增** `VARCHAR(32) NOT NULL DEFAULT 'document'` |
| `entity_id` | **新增** `UUID` |
| `category` | **新增** `VARCHAR(32)`，取值 `'cad'` / `'production'`；图文档附件为 `NULL` |

### 4.2 迁移（migration）

- 修改 `document_id` 为可空。
- 新增 `entity_type` / `entity_id` / `category` 三列。
- 回填存量行：`entity_type='document'`，`entity_id = document_id`，`category = NULL`。
- 新增索引 `(entity_type, entity_id, category)`。
- 保留 `documents.file_id` 外键与"删除图文档级联删除附件"行为不变。

回填后语义：
- 图文档附件：`entity_type='document'`，`entity_id=document_id`，`document_id` 保留原值，`category=NULL`。
- 零部件 CAD 附件：`entity_type='component'`，`entity_id=<component_id>`，`document_id=NULL`，`category='cad'`。
- 零部件生产附件：同上但 `category='production'`。

### 4.3 模型 (`models.py`)

`DocumentAttachment` 增加 `entity_type` / `entity_id` / `category` 三个字段，`document_id` 改为 `nullable=True`。

## 5. 文件存储

`file_storage.py`：

- `ALLOWED_ENTITY_TYPES` 增加 `"component"`。
- `ENTITY_TYPE_ALIASES` 增加 `"components": "component"`。
- 文件落盘到 `…/component/<component_id>/`。

## 6. API 设计

### 6.1 上传（复用并扩展现有通用端点）

`/attachments/upload`、`/attachments/chunk/init`、`/attachments/chunk/complete`：

- 新增可选表单字段 `category`（`cad` / `production`）。
- 建库逻辑扩展：
  - `entity_type` 为 `document/documents` 时：维持现有行为（写 `document_id`、更新 `documents.file_name/file_id`），`entity_type='document'`，`entity_id=document_id`，`category=NULL`。
  - `entity_type` 为 `component/components` 时：写 `entity_type='component'`、`entity_id=<entity_id>`、`category=<category>`、`document_id=NULL`。
- 分块流程：`chunked_uploader.init_upload` 的 meta 增加 `category`，`complete` 端点从 meta 读取并写入。

### 6.2 列表（新增，挂在 components 路由）

`GET /components/{component_id}/attachments?category=cad`

- 返回该零部件指定分类的附件行列表（id / file_name / file_size / created_at 等）。
- 权限：`components:read`。
- `category` 可选；不传则返回该零部件全部附件（前端可一次取回再按分类分桶，减少请求）。

### 6.3 删除 / 预览 / 下载 / 3D / 压缩包

全部复用现有 `/attachments/{attachment_id}` 系列端点，**无需改动**。

### 6.4 权限

- 文件上传/预览/下载/删除：复用现有 `attachments:upload` / `attachments:preview` / `attachments:download` / `attachments:delete`。
- 零部件维度的附件列表：`components:read`。

## 7. 前端设计

### 7.1 新增可复用组件 `ComponentAttachmentBucket`

Props：`{ entityType: 'component'; entityId: string; category: 'cad' | 'production'; label: string; editable: boolean }`

渲染一个带标题的附件桶：

- `editable=true`：显示"+ 上传附件"按钮（小文件走 `v2UploadApi.uploadSmallFile`，超阈值走分块 `initChunkedUpload/uploadChunk/completeChunkedUpload`，`entity_type='components'`，带 `category`），上传进度条，文件表（文件名 / 大小），每行"删除"。
- 预览 / 下载 / 3D / 压缩包浏览：复用 `previewAttachment`、`mediaApi.token`、`ArchiveTreeModal`，与 `EntityDocumentSection` 的附件子表一致。
- `editable=false`（详情只读）：仅显示预览 / 下载，无上传/删除。

样式遵循现有"构型管理 / 图文档"区风格：`primary-*` 配色、共享 `Modal`、统一表格与工具栏（符合项目 UI 一致性约束）。

### 7.2 接入位置

在零部件的**编辑弹窗**与**详情（只读）视图**中各放置两个实例：

- CAD附件：`category='cad'`，`label='CAD附件'`
- 生产附件：`category='production'`，`label='生产附件'`

编辑视图 `editable=true`，详情视图 `editable=false`。具体接入文件在实现计划阶段定位（`ComponentsPage.tsx` 及其编辑/详情子组件）。

### 7.3 API 客户端

`services/api.ts` 增加 `componentAttachmentsApi.list(componentId, category?)`，并确保 `v2UploadApi` 上传支持透传 `category`。

## 8. 边界情况

- **删除零部件**：清理其名下附件行与磁盘文件（镜像现有图文档删除时的附件清理逻辑）。
- **大文件**：自动走现有分块上传路径（超过阈值）。
- **STP 文件**：任一桶内的 STP 自动获得按需 3D 查看能力（复用 `gltf` 端点）。
- **Office / 文本 / 图片**：复用现有预览管线。
- **空桶**：显示"暂无附件"占位。
- **向后兼容**：迁移与端点改动均为追加式，存量图文档附件行为不变。

## 9. 验证

- 后端：迁移可重复执行（幂等）；上传/列表/删除单测覆盖 `component` 类型与 `category` 分桶；存量图文档附件回归测试。
- 前端：`build` 通过；编辑视图可上传/删除、详情视图可预览/下载两类附件。
- 手测：Docker 环境上传 .stp 验证 3D、.pdf 验证预览、大文件验证分块、删除零部件验证文件清理。

## 10. 不做（YAGNI）

- 不做图文档关联（已有独立功能）。
- 不做附件审批/版本/状态流转（原始文件桶，非图文档）。
- 不新增独立 `component_attachments` 表。
