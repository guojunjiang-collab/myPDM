# 图文档签入签出完善·设计方案

> 版本: v1 | 日期: 2026-07-10 | 状态: 设计中

## 1. 概述

### 1.1 背景
图文档签入签出后端基础逻辑（checkout/checkin/undo-checkout/iterations）已在 `crud_documents.py` 实现，`Document`/`DocumentIteration` 表字段齐全，但存在多处断层：
- 附件上传未绑定 `iteration_id`，编辑与迭代脱节
- 详情界面与编辑界面分离（只读 `DocumentDetailContent` + 独立编辑弹窗）
- 前端完全未接入签出状态展示/操作
- 无管理员强制签入
- 无专用权限项（复用 `documents:update`）
- 列表/详情未返回签出用户名

参照零件（Parts）模块的完整实现，将图文档签入签出补全到同等成熟度，表单详情与编辑合并为统一交互。

### 1.2 核心目标
图文档拥有与零件一致的「签出 → 编辑 → 签入」迭代闭环：
- 创建时自动生成迭代1并签出给创建者
- 草稿态必须先签出才能编辑（字段/附件/自定义字段）
- 签出自动新建迭代并复制上一迭代附件
- 编辑作用于当前迭代
- 签入固化迭代，撤销签出清除当前迭代

### 1.3 变更范围
| 层 | 变更类型 | 说明 |
|---|---|---|
| 数据表 | 无需新建 | `Document`/`DocumentIteration`/`DocumentAttachment` 字段齐全 |
| 数据迁移 | 新增 | 为存量文档创建 iteration=1，回填附件 iteration_id |
| 后端 CRUD | 增补 | force-checkin、编辑门槛校验、附件绑定迭代、签出用户名 |
| 后端路由 | 增补 | force-checkin 端点、上传逻辑适配迭代 |
| 权限 | 新增 | 4 个专用权限项 |
| 前端组件 | 新建 | `DocumentDetailModal` 详情+编辑合一弹窗 |
| 前端组件 | 改造 | `Documents.tsx` 列表页、新建弹窗 |
| 前端类型/API | 增补 | 签出字段、DocumentIteration 类型 |

---

## 2. 数据层

### 2.1 现有表结构（无需修改）

**documents 表**（已有签出字段）：
```sql
check_out_user_id UUID, check_out_date TIMESTAMPTZ, latest_iteration INTEGER DEFAULT 0
```

**document_iterations 表**（已有签入字段）：
```sql
id UUID PK, document_id UUID FK, iteration INTEGER, 
check_in_date TIMESTAMPTZ, check_in_note TEXT
```

**document_attachments 表**（已有迭代关联字段）：
```sql
iteration_id UUID FK -> document_iterations.id
```

### 2.2 存量数据迁移

`main.py` 启动时自动执行（无需手动脚本）：

```
FOR each Document WHERE latest_iteration = 0:
  1. 创建 DocumentIteration(iteration=1, document_id=doc.id)
  2. 将该文档所有 DocumentAttachment 的 iteration_id 回填为新建迭代的 id
  3. latest_iteration = 1
```

---

## 3. 后端

### 3.1 创建文档对齐零件
`POST /documents/` — 修改 `create_document`：
- 创建 Document 后自动建 `DocumentIteration(iteration=1)` + 自动签出给创建者 (`check_out_user_id=creator_id`, `latest_iteration=1`)
- 不再暴露独立的"新建后手动附件"流程——创建即已签出，可直接上传

### 3.2 签出签入（已有逻辑微调）
`crud_documents.py` 现有 `checkout_document` / `checkin_document` / `undo_checkout_document` / `list_iterations` 保持。

微调点：
- `checkout_document`：增加自定义字段值复制（参考 `_copy_iteration_custom_fields`）
- `undo_checkout_document`：增加自定义字段值清理

### 3.3 新增：force-checkin
```python
def force_checkin_document(db, doc_id) -> (Document | None, str | None):
    """管理员强制签入：清除签出锁，保留当前迭代"""
    doc = get_document(db, doc_id)
    if not doc: return None, "文档不存在"
    if doc.check_out_user_id is None: return None, "未被签出"
    doc.check_out_user_id = None
    doc.check_out_date = None
    db.commit()
    return doc, None
```

路由：`POST /documents/{doc_id}/force-checkin`，权限 `documents:force_checkin`（仅 admin）。

### 3.4 编辑门槛校验

`PUT /documents/{doc_id}` — 增加：
```python
if d.check_out_user_id != current_user.id:
    raise HTTPException(400, "请先签出再编辑")
if d.status != "draft":
    raise HTTPException(400, "仅草稿状态可编辑")
```

### 3.5 附件绑定迭代
附件上传/删除均须校验签出态，且写入/限定当前迭代。

**base64 上传** (`POST /documents/{doc_id}/attachments`)：
```python
# 校验签出
if d.check_out_user_id != current_user.id:
    raise HTTPException(400, "请先签出再上传附件")
# 读取当前迭代
iteration = get_current_iteration(db, d)
# 创建附件时写入 iteration_id
att = DocumentAttachment(..., iteration_id=iteration.id)
```

**删除附件** (`DELETE /documents/{doc_id}/attachments/{att_id}`)：
```python
if d.check_out_user_id != current_user.id:
    raise HTTPException(400, "请先签出再删除附件")
if att.iteration_id != current_iteration.id:
    raise HTTPException(400, "只能删除当前迭代的附件")
```

**V2 上传** (`POST /api/v2/attachments/upload` / chunk complete)：
在 complete 逻辑中，当 `entity_type='documents'` 时，检查签出态并写 `iteration_id` 到 `DocumentAttachment` 记录。

### 3.6 返回签出用户名
列表 (`GET /documents/`) / 详情 (`GET /documents/{id}`) / 迭代历史 (`GET /documents/{id}/iterations`) 三个端点均补 `check_out_user_name`（通过 `User` 表关联查询 `check_out_user_id`）。

### 3.7 权限
`permissions/permissions.json` 新增：
```json
"documents:checkout":        ["admin", "engineer"],
"documents:checkin":         ["admin", "engineer"],
"documents:undocheckout":    ["admin", "engineer"],
"documents:force_checkin":   ["admin"]
```

重新生成权限代码 (`python tools/gen_permissions.py`)。

### 3.8 API 端点总览（变更后）

| 端点 | 方法 | 权限 | 变化 |
|---|---|---|---|
| `/documents/` | GET | `documents:read` | 补 `check_out_user_name` |
| `/documents/` | POST | `documents:create` | 自动建迭代1+签出 |
| `/documents/{id}` | GET | `documents:read` | 补 `check_out_user_name` |
| `/documents/{id}` | PUT | `documents:update` | **新增签出校验** |
| `/documents/{id}` | DELETE | `documents:delete` | 不变 |
| `/documents/{id}/checkout` | POST | `documents:checkout` | 权限改为专用项 |
| `/documents/{id}/checkin` | POST | `documents:checkin` | 权限改为专用项 |
| `/documents/{id}/undo-checkout` | POST | `documents:undocheckout` | 权限改为专用项 |
| `/documents/{id}/force-checkin` | POST | `documents:force_checkin` | **新增** |
| `/documents/{id}/iterations` | GET | `documents:read` | 补用户名 |
| `/documents/{id}/upgrade` | POST | `documents:create` | 不变 |
| `/documents/{id}/versions` | GET | `documents:read` | 不变 |
| `/documents/{id}/attachments` | POST | `documents.attachment:upload` | **新增签出校验+绑定迭代** |
| `/documents/{id}/attachments` | GET | `documents.attachment:download` | 不变 |
| `/documents/{id}/attachments/{att_id}` | DELETE | `documents.attachment:delete` | **新增签出校验+迭代校验** |

---

## 4. 前端

### 4.1 架构变更

```
Documents.tsx 页面前后对比:
  Before: [列表] → 点击行 → [DocumentDetailContent 只读详情]
                        → 点击编辑 → [EntityEditModal 编辑弹窗]  ← 两套分离
  After:  [列表(含签出状态列)] → 点击行 → [DocumentDetailModal 详情+编辑合一]
                        → 点击新建 → [DocumentCreateModal 精简新建弹窗]
```

### 4.2 新建 `DocumentDetailModal.tsx`

参照 `PartDetailModal.tsx` 结构，props：

```ts
interface Props {
  open: boolean;
  docId: string;
  onClose: () => void;
  onSaved: () => void;  // 回调刷新列表
}
```

**内部状态逻辑**：
```ts
const isCheckedOut = !!doc?.check_out_user_id;
const isCheckedOutByMe = isCheckedOut && doc?.check_out_user_id === user?.id;
const isDraft = doc?.status === 'draft';
const canEdit = isCheckedOutByMe && isDraft;
const canCheckout = isDraft && !isCheckedOut;
const canCheckin = isDraft && isCheckedOutByMe;
const canUndo = isDraft && isCheckedOutByMe && (doc?.latest_iteration || 0) > 1;
const canForceCheckin = isCheckedOut && user?.role === 'admin';
```

**布局**（参照零件详情弹窗）：

```
┌─────────────────────────────────────┐
│  顶部：核心信息（grid 4 列）            │
│  ┌──────────┐ ┌──────┐ ┌──────┐ ┌─────┐
│  │ 编号     │ │ 名称  │ │ 版本  │ │状态  │
│  │ (可编辑)  │ │(可编辑)│ │(只读) │ │标签  │
│  └──────────┘ └──────┘ └──────┘ └─────┘
│  ┌──────────┐ ┌──────┐ ┌──────┐ ┌─────┐
│  │ 备注     │ │创建人 │ │创建时间│ │更新时间│
│  │ (可编辑)  │ │      │ │      │ │       │
│  └──────────┘ └──────┘ └──────┘ └─────┘
│
│  中部：签出状态条 + 操作按钮组
│  ┌─────────────────────────────────┐
│  │  🔒 已签出：张三    [签入][撤销签出][强制签入][升版]  │
│  └─────────────────────────────────┘
│
│  底部：Tab 页 (边框分隔)
│  [附件] [自定义字段] [版本历史] [迭代历史] [引用]
│  ┌─────────────────────────────────┐
│  │  Tab 内容区                        │
│  └─────────────────────────────────┘
└─────────────────────────────────────
```

**Tab 定义**：

| Tab | 说明 | 可编辑条件 |
|---|---|---|
| 附件 | **当前迭代**的附件列表（预览/下载/上传/删除） | `canEdit` 时显示上传/删除按钮 |
| 自定义字段 | 仅文档范围的字段展示/编辑 | `canEdit` 时可编辑 |
| 版本历史 | 升版版本列表 | 只读 |
| 迭代历史 | 签入时间/说明/当时附件 | 只读，可展开查看附件 |
| 引用 | 哪些零部件引用了此图文档 | 只读 |

**签入说明弹窗**：签入按钮点击后弹出 Modal，textarea 输入说明（选填），确认后调用 `checkin` API。

**附件操作（签出态下）**：
- 上传：按钮 → file input → V2 upload API → 刷新附件列表
- 删除：按钮 → 确认对话框 → delete API → 刷新
- 预览/下载：与原逻辑一致，不受签出态限制

**自动保存**：编辑态下，编号(仅 A 版)、名称、备注、自定义字段变更后防抖自动保存（`PUT /documents/{id}`）。

### 4.3 新建「新增图文档」弹窗

精简弹窗（取代原 `EntityEditModal` 的新建模式）：
- 输入：编号 / 名称 / 备注 / 用户组
- 创建后列表刷新

### 4.4 改造 `Documents.tsx` 列表页

- 表头新增「签出状态」列（`w-28`，同零件列表）
- 行内显示 `check_out_user_name`（橙色标注）或 "—"
- 操作列移除「编辑」按钮，新增「签出」按钮（条件：`status==='draft' && !check_out_user_id`）
- 点击行打开 `DocumentDetailModal`（取代原只读详情）
- 新建按钮打开精简新建弹窗

### 4.5 类型与 API 客户端

**`types/index.ts`**：
```ts
export interface Document {
  // ...existing...
  check_out_user_id?: string | null;
  check_out_user_name?: string | null;
  check_out_date?: string | null;
  latest_iteration: number;
}

export interface DocumentIteration {
  id: string;
  iteration: number;
  check_in_date?: string | null;
  check_in_note?: string | null;
  created_at?: string | null;
  attachments: AttachmentBrief[];
}

export interface AttachmentBrief {
  id: string;
  file_name: string;
  file_size: number;
  created_at?: string | null;
}
```

**`services/api.ts`** — `documentsApi` 新增：
```ts
checkout: (docId: string) => api.post(`/documents/${docId}/checkout`).then(r => r.data),
checkin: (docId: string, note?: string) => api.post(`/documents/${docId}/checkin`, null, { params: { note } }).then(r => r.data),
undocheckout: (docId: string) => api.post(`/documents/${docId}/undo-checkout`).then(r => r.data),
forceCheckin: (docId: string) => api.post(`/documents/${docId}/force-checkin`).then(r => r.data),
iterations: (docId: string) => api.get(`/documents/${docId}/iterations`).then(r => r.data),
```

### 4.6 兼容现有引用点

| 引用位置 | 处理方式 |
|---|---|
| `Board.tsx` | 继续使用只读 `DocumentDetailContent`，不修改 |
| `TaskEditModal.tsx` | 继续使用只读 `DocumentDetailContent`，不修改 |

---

## 5. 实施顺序

1. **权限**：更新 `permissions.json` + 重生成
2. **数据迁移**：添加存量文档迭代初始化逻辑
3. **后端**：编辑门槛 + force-checkin + 附件绑定迭代 + 返回用户名
4. **前端类型 & API**：类型定义 + API 函数
5. **前端组件**：`DocumentDetailModal` → 精简新建弹窗 → `Documents.tsx` 改造
6. **编译部署**：构建前端 + 重启后端

---

## 6. 非范围（明确不包含）

- 图文档不做级联签出/签入/撤销（无 BOM 层级概念）
- 图文档不做 BOM 结构 Tab（非部件）
- 不在本方案中改动 `PartDetailModal` 或零件签入签出逻辑
- 不做文档与迭代之间的附件增量对比
