# 图文档三层模型重构（Master → Revision → Iteration）

日期：2026-07-21
状态：已批准，待实现

## 背景

当前图文档是扁平模型（Document + DocumentIteration），与零部件、构型项的三层架构不一致。本次重构将 Document 拆分为 DocumentMaster → DocumentRevision → DocumentIteration，统一三类实体的数据模型。

## 决策（已与用户确认）

1. **模型**: Master → Revision → Iteration 三层，版本序列 A→B→...→ZZ
2. **签出**: 锁在 Revision 层，参照零部件机制
3. **附件**: 去掉 file_name/file_id 冗余快照，附件仅存 DocumentAttachment 表（`document_id` → `document_revision_id`）
4. **自定义字段**: 绑定在 Revision 层（entity_type='document' → entity_id=document_revisions.id）
5. **用户组权限**: DocumentGroupLink → document_masters.id（文档级权限，跨版本）
6. **看板**: DashboardItem → document_masters.id
7. **外部引用**: ECR/ECO/PartIteration/ConfigurationItemIteration 中的 document_links 的 document_id 改为 document_revision_id

## 改动详情

### 一、数据模型（`backend/app/models.py`）

#### 1.1 原 Document 表替换为三个新表

**document_masters**（主数据，不变）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | — |
| code | String(64) | 图文档编号，唯一索引 |
| name | String(255) | 图文档名称 |
| revisions | JSONB | 版本升版历史 `[{version, parent_version, action, user, timestamp}]` |
| creator_id | UUID | 原始创建者 |
| created_at | DateTime | — |
| updated_at | DateTime | — |
| deleted_at | DateTime | 软删除 |

**document_revisions**（版本层）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | — |
| master_id | UUID FK→masters | — |
| version | String(32) | 版本号 |
| status | String(32) | draft/frozen/released/obsolete |
| remark | Text | 版本备注 |
| revision_parent_id | UUID | 升版来源 revision |
| check_out_user_id | UUID, 可空 | 签出用户 |
| check_out_date | DateTime, 可空 | 签出时间 |
| latest_iteration | Integer | 最新迭代号 |
| creator_id | UUID | 本版本创建者 |
| created_at | DateTime | — |
| deleted_at | DateTime | 软删除 |

**document_iterations**（迭代，已存在，FK 改为 revision_id）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | — |
| revision_id | UUID FK→revisions | 原 document_id |
| iteration | Integer | 迭代号 |
| check_in_date | DateTime | — |
| check_in_note | Text | — |
| created_at | DateTime | — |

#### 1.2 DocumentAttachment 改造

| 字段 | 当前 | 改为 |
|------|------|------|
| document_id | FK→documents.id | FK→document_revisions.id |

#### 1.3 DocumentGroupLink 改造

| 字段 | 当前 | 改为 |
|------|------|------|
| document_id | FK→documents.id | FK→document_masters.id |

### 二、API 端点改造（`backend/app/routers/documents.py`）

路由前缀保持不变 `/api/documents`，操作对象改为 `revision`：

| 端点 | 说明 |
|------|------|
| `GET /` | 列表（按 master 聚合，返回最新 revision 摘要） |
| `POST /` | 创建（同时建 Master + Revision(A) + Iteration(1)，参考零部件） |
| `GET /{revision_id}` | 详情（含当前迭代 + 附件列表） |
| `PUT /{revision_id}` | 更新 remark（需签出） |
| `DELETE /{revision_id}` | 软删除 revision |
| `POST /{revision_id}/checkout` | 签出（创建新迭代+1，复制附件引用） |
| `POST /{revision_id}/checkin` | 签入（记录 note，清除签出锁） |
| `POST /{revision_id}/undocheckout` | 撤销签出（删除迭代+附件，清除锁） |
| `POST /{revision_id}/force-checkin` | 管理员强制签入 |
| `POST /{revision_id}/upgrade` | 升版（生成新版本号，创建新 revision + iteration 1） |
| `POST /{revision_id}/freeze` | 冻结 |
| `POST /{revision_id}/release` | 发布 |
| `POST /{revision_id}/obsolete` | 作废 |
| `GET /{revision_id}/versions` | 版本历史 |
| `GET /{revision_id}/iterations` | 迭代历史 |
| `DELETE /{revision_id}/iterations/{id}` | 删除迭代 |
| `POST /{revision_id}/attachments` | 上传附件（关联到当前迭代） |
| `DELETE /{revision_id}/attachments/{id}` | 删除附件 |

### 三、外部引用适配

| 位置 | 当前引用 | 改为 |
|------|---------|------|
| ECR/ECO `document_links` | `{document_id, code, name, version}` | `{document_revision_id, code, name, version}` |
| PartIteration `document_links` | 同上 | 同上 |
| ConfigurationItemIteration `document_links` | 同上 | 同上 |
| DashboardItem | entity_type='document', entity_id=documents.id | entity_type='document', entity_id=document_masters.id |
| DocumentGroupLink | document_id → documents.id | document_id → document_masters.id |
| BOM 反查 `doc-refs` | 查 document_links 中的 document_id | 查 document_revision_id |

### 四、前端改造

**类型**: 拆分 `Document` 为 `DocumentMaster` + `DocumentRevision` + `DocumentIteration`

**API**: `documentsApi` 方法适配新端点，列表返回 revision 摘要

**组件**: `DocumentDetailModal` 参照 `ConfigItemDetailModal` / `PartDetailModal` 模式重构，加入签出/签入/版本操作按钮 + Tab

**DocumentPicker**: 展示形式不变，内部用 `list()` 获取 master 聚合数据

###五、不改动

- 附件的文件存储路径保持 `document/{code}/{version}/{iteration}/` 不变
- V2 附件端点（`attachments_v2.py`）内部逻辑适配 FK 即可
- 库存单据（`InventoryDocument`）是独立体系，不涉及此重构

## 验证

1. 迁移后原文档数据完整可访问
2. 创建/签出/签入/升版流程正常
3. 附件上传/下载/预览正常
4. ECR/ECO 中文档引用正常显示
5. 用户组权限正常
6. 看板文档显示正常
7. 前端编译通过
