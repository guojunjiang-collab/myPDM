# 图文档签入签出完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图文档拥有与零件一致的「签出 → 编辑 → 签入」迭代闭环，详情与编辑合一到单个弹窗。

**Architecture:** 后端复用已有 `Document`/`DocumentIteration`/`DocumentAttachment` 表结构，补齐编辑门槛校验、附件迭代绑定、force-checkin、签出用户名返回与专用权限；前端新建 `DocumentDetailModal`（参照 `PartDetailModal`）承载详情+编辑，列表页增加签出状态列与签出按钮。

**Tech Stack:** FastAPI + SQLAlchemy 2.0（后端）、React 18 + TypeScript + Vite（前端）、PostgreSQL 16。

**验证策略:** 本项目无 pytest 基础设施，采用「后端 `docker restart bom_backend` + 查日志/API 验证」「前端 `npm run build` 编译通过 + UI 手动验证」为主。

**部署注意:** 本机 `python3` 不可用，权限生成用 `python ../tools/gen_permissions.py`（在 frontend 目录）或 `python tools/gen_permissions.py`（在根目录）。

---

## 文件结构

### 后端（Modify）
- `permissions/permissions.json` — 新增 4 个 documents 签出权限项
- `backend/app/permissions/_generated.py` — 生成产物（勿手改）
- `backend/app/main.py` — startup 增加存量文档迭代迁移
- `backend/app/crud_documents.py` — 编辑门槛、force-checkin、自定义字段复制/清理、当前迭代辅助
- `backend/app/routers/documents.py` — 创建自动建迭代+签出、编辑校验、附件绑定迭代、返回用户名、force-checkin 路由、权限切换
- `backend/app/routers/attachments_v2.py:120` — `_ensure_document_meta` 绑定当前迭代 iteration_id

### 前端（Create/Modify）
- `frontend/src/constants/permissions.generated.ts` — 生成产物（勿手改）
- `frontend/src/types/index.ts` — Document 加签出字段、新增 DocumentIteration/AttachmentBrief
- `frontend/src/services/api.ts` — documentsApi 加 5 个签出函数
- `frontend/src/components/DocumentDetailModal.tsx` — **新建**，详情+编辑合一弹窗
- `frontend/src/pages/Documents.tsx` — 列表加签出状态列/按钮、接入新弹窗、精简新建弹窗

---

## Task 1: 新增图文档签出专用权限

**Files:**
- Modify: `permissions/permissions.json:37`
- Regenerate: `backend/app/permissions/_generated.py`, `frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 在 permissions.json 的 documents 权限块末尾新增 4 项**

在 `"documents.attachment:delete": ["admin", "engineer"],`（第 37 行）之后、空行之前插入：

```json
    "documents.attachment:delete": ["admin", "engineer"],
    "documents:checkout": ["admin", "engineer"],
    "documents:checkin": ["admin", "engineer"],
    "documents:undocheckout": ["admin", "engineer"],
    "documents:force_checkin": ["admin"],
```

- [ ] **Step 2: 重新生成权限代码**

Run（在根目录）: `python tools/gen_permissions.py`
Expected: 输出 `Wrote ...backend\app\permissions\_generated.py` 和 `Wrote ...frontend\src\constants\permissions.generated.ts`

- [ ] **Step 3: 验证生成结果包含新权限**

Run: `Select-String -Path backend/app/permissions/_generated.py -Pattern "documents:force_checkin"`
Expected: 匹配到 `"documents:force_checkin"` 行

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(perms): 新增图文档签入签出专用权限项"
```

---

## Task 2: 存量文档迭代迁移

为 `latest_iteration = 0` 的存量文档创建 iteration=1 并回填附件 iteration_id。放在 `main.py` startup 迁移末尾。

**Files:**
- Modify: `backend/app/main.py`（startup_event 内，迁移逻辑末尾、`db.close()` 之前）

- [ ] **Step 1: 定位插入点**

Run: `Select-String -Path backend/app/main.py -Pattern "db.close\(\)|except Exception"`
确认 startup_event 的迁移 try 块结构，找到最后一段迁移之后、finally/close 之前的位置。

- [ ] **Step 2: 在迁移逻辑末尾追加文档迭代初始化**

在 `backend/app/main.py` 的 startup 迁移 try 块末尾（所有现有迁移之后）追加：

```python
        # ===== 图文档签入签出：为存量文档初始化 iteration=1 =====
        # 逻辑：latest_iteration=0 的文档尚未纳入迭代体系，
        # 需补建首个迭代并把已有附件回填到该迭代，保证签出/签入正常。
        try:
            legacy_docs = db.execute(text(
                "SELECT id FROM documents WHERE latest_iteration = 0 AND deleted_at IS NULL"
            )).fetchall()
            for row in legacy_docs:
                doc_id = row[0]
                new_iter_id = db.execute(text("""
                    INSERT INTO document_iterations (id, document_id, iteration, created_at)
                    VALUES (gen_random_uuid(), :doc_id, 1, now())
                    RETURNING id
                """), {"doc_id": doc_id}).fetchone()[0]
                db.execute(text("""
                    UPDATE document_attachments SET iteration_id = :iter_id
                    WHERE document_id = :doc_id AND iteration_id IS NULL
                """), {"iter_id": new_iter_id, "doc_id": doc_id})
                db.execute(text(
                    "UPDATE documents SET latest_iteration = 1 WHERE id = :doc_id"
                ), {"doc_id": doc_id})
            if legacy_docs:
                db.commit()
                print(f"✓ Initialized iteration=1 for {len(legacy_docs)} legacy documents")
        except Exception as e:
            db.rollback()
            print(f"⚠ Document iteration migration skipped: {e}")
```

- [ ] **Step 3: 重启后端并验证迁移执行**

Run: `docker restart bom_backend`
Run（等待 5 秒后）: `docker logs bom_backend --tail 30 | Select-String "legacy documents|startup complete"`
Expected: 看到 `Application startup complete.`（若有存量文档还会看到 `Initialized iteration=1 for N legacy documents`）

- [ ] **Step 4: 验证数据库状态**

Run: `docker exec bom_postgres psql -U bomadmin bom_system -c "SELECT count(*) FROM documents WHERE latest_iteration = 0 AND deleted_at IS NULL;"`
Expected: `0`（所有存量文档已初始化）

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(documents): 存量文档启动时初始化迭代1"
```

---

## Task 3: 创建文档时自动建迭代并签出

对齐零件：创建后自动建 iteration=1 且签出给创建者，创建者可立即上传附件。

**Files:**
- Modify: `backend/app/routers/documents.py:197-230`（create_document）

- [ ] **Step 1: 修改 create_document，创建后建迭代并签出**

将 `backend/app/routers/documents.py` 中 `create_document` 的核心创建段（约 206-217 行 `d = Document(...)` 到 `crud.create_log(...)` 之前）替换为：

```python
    data = doc.model_dump()
    group_ids = data.pop("group_ids", None) or []
    d = Document(**data, creator_id=current_user.id)
    db.add(d)
    db.flush()
    # 自动建首个迭代并签出给创建者（对齐零件：创建即可编辑/传附件）
    from ..models import DocumentIteration
    first_iter = DocumentIteration(document_id=d.id, iteration=1)
    db.add(first_iter)
    d.latest_iteration = 1
    d.check_out_user_id = current_user.id
    d.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(d)
    for gid in set(group_ids):
        db.add(DocumentGroupLink(document_id=d.id, group_id=gid))
    if group_ids:
        db.commit()
```

- [ ] **Step 2: 更新 create_document 返回体包含签出字段**

将该函数末尾 `return {...}` 中已有的 `"check_out_user_id": d.check_out_user_id,` 一行确认存在并补充用户名（若无则加）：

```python
        "check_out_user_id": str(d.check_out_user_id) if d.check_out_user_id else None,
        "check_out_user_name": current_user.real_name,
        "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
        "latest_iteration": d.latest_iteration,
```

- [ ] **Step 3: 重启并通过 API 验证**

Run: `docker restart bom_backend`
创建一个文档后查询数据库：
Run: `docker exec bom_postgres psql -U bomadmin bom_system -c "SELECT code, latest_iteration, check_out_user_id IS NOT NULL AS locked FROM documents ORDER BY created_at DESC LIMIT 1;"`
Expected: 最新文档 `latest_iteration=1`，`locked=t`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/documents.py
git commit -m "feat(documents): 创建文档自动建迭代1并签出给创建者"
```

---

## Task 4: 后端 force-checkin + 自定义字段复制/清理

**Files:**
- Modify: `backend/app/crud_documents.py`（checkout/undo 补自定义字段、新增 force-checkin）

- [ ] **Step 1: checkout_document 增加自定义字段复制**

在 `backend/app/crud_documents.py` 的 `checkout_document` 中，`db.add(new_att)` 循环之后、`doc.latest_iteration = new_iter_num` 之前插入：

```python
    # 复制上一迭代的自定义字段值到新迭代（对齐零件）
    if prev_iter:
        from . import crud as crud_common
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id)
```

- [ ] **Step 2: undo_checkout_document 增加自定义字段清理**

在 `undo_checkout_document` 的 `for att in atts:` 删除循环之后、`db.delete(iteration)` 之前插入：

```python
        # 清理当前迭代复制的自定义字段值
        db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.iteration_id == iteration.id
        ).delete(synchronize_session=False)
```

- [ ] **Step 3: 新增 force_checkin_document 函数**

在 `backend/app/crud_documents.py` 的 `undo_checkout_document` 函数之后新增：

```python
# ====== 强制签入（管理员） ======

def force_checkin_document(db: Session, doc_id: UUID) -> Tuple[Optional[models.Document], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    doc = get_document(db, doc_id)
    if not doc:
        return None, "文档不存在"
    if doc.check_out_user_id is None:
        return None, "该文档未被签出"
    doc.check_out_user_id = None
    doc.check_out_date = None
    db.commit()
    db.refresh(doc)
    return doc, None
```

- [ ] **Step 4: 重启验证无导入错误**

Run: `docker restart bom_backend`
Run（等 5 秒）: `docker logs bom_backend --tail 15 | Select-String "startup complete|Error|Traceback"`
Expected: `Application startup complete.`，无 Traceback

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_documents.py
git commit -m "feat(documents): 新增强制签入及迭代自定义字段复制/清理"
```

---

## Task 5: 后端编辑门槛校验

草稿态必须本人签出才能改字段。

**Files:**
- Modify: `backend/app/routers/documents.py:258-284`（update_document）

- [ ] **Step 1: update_document 开头增加签出校验**

在 `backend/app/routers/documents.py` 的 `update_document` 中，`if not d: raise HTTPException(404...)` 之后、code 冲突校验之前插入：

```python
    # 编辑门槛：仅本人已签出且草稿态可编辑（对齐零件）
    if d.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑")
    if d.check_out_user_id is None:
        raise HTTPException(status_code=400, detail="请先签出后再编辑")
    if str(d.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="该文档被他人签出，无法编辑")
```

- [ ] **Step 2: 重启验证**

Run: `docker restart bom_backend`
Run（等 5 秒）: `docker logs bom_backend --tail 10 | Select-String "startup complete"`
Expected: `Application startup complete.`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/documents.py
git commit -m "feat(documents): 编辑需先签出的门槛校验"
```

---

## Task 6: 后端附件绑定当前迭代

上传写 iteration_id、删除限当前迭代，均校验签出态。覆盖 base64 端点与 V2 上传。

**Files:**
- Modify: `backend/app/routers/documents.py:390-424`（base64 上传）
- Modify: `backend/app/routers/documents.py:461-490`（删除附件）
- Modify: `backend/app/routers/attachments_v2.py:120-153`（_ensure_document_meta）

- [ ] **Step 1: base64 上传端点增加签出校验并绑定迭代**

在 `upload_document_attachment` 中，`if not d: raise HTTPException(404...)` 之后插入校验，并在创建 `DocumentAttachment` 时写 iteration_id：

```python
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    # 签出校验
    if d.check_out_user_id is None or str(d.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="请先签出后再上传附件")
    current_iter = crud_documents.get_current_iteration(db, d)
```

并将后面的 `att = DocumentAttachment(...)` 改为：

```python
    att = DocumentAttachment(
        id=body.id,
        document_id=doc_id,
        file_name=body.file_name,
        file_size=result["file_size"],
        file_path=result["file_path"],
        iteration_id=current_iter.id if current_iter else None,
    )
```

- [ ] **Step 2: 删除附件端点增加签出与迭代校验**

在 `delete_attachment` 中，`if not att: raise HTTPException(404...)` 之后插入：

```python
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    d_lock = db.query(Document).filter(Document.id == doc_id).first()
    if d_lock:
        if d_lock.check_out_user_id is None or str(d_lock.check_out_user_id) != str(current_user.id):
            raise HTTPException(status_code=400, detail="请先签出后再删除附件")
        current_iter = crud_documents.get_current_iteration(db, d_lock)
        if current_iter and att.iteration_id and str(att.iteration_id) != str(current_iter.id):
            raise HTTPException(status_code=400, detail="只能删除当前迭代的附件")
```

- [ ] **Step 3: V2 _ensure_document_meta 绑定当前迭代**

在 `backend/app/routers/attachments_v2.py` 的 `_ensure_document_meta` 中，创建 `DocumentAttachment(...)` 时加入 iteration_id。将 `if not att:` 分支的创建段改为：

```python
    if not att:
        # 绑定文档当前迭代（签出态下上传应归入当前迭代）
        current_iter = None
        if doc.latest_iteration and doc.latest_iteration > 0:
            from ..models import DocumentIteration
            current_iter = db.query(DocumentIteration).filter(
                DocumentIteration.document_id == doc.id,
                DocumentIteration.iteration == doc.latest_iteration,
            ).first()
        att = DocumentAttachment(
            id=UUID(att_id) if att_id else uuid4(),
            document_id=entity_id,
            file_name=filename,
            file_size=file_size,
            file_path=stored_path,
            file_hash=file_hash,
            iteration_id=current_iter.id if current_iter else None,
        )
        db.add(att)
```

- [ ] **Step 4: 清理 _ensure_document_meta 尾部冗余 return**

确认 `_ensure_document_meta` 函数结尾只有一个 `return att`（删除注入/重复的多余 `return att` 行，若存在）。函数应以：

```python
    doc.file_name = filename
    doc.file_id = att.id
    db.commit()
    db.refresh(att)
    return att
```

结束，之后紧接下一个函数定义。

- [ ] **Step 5: 重启验证**

Run: `docker restart bom_backend`
Run（等 5 秒）: `docker logs bom_backend --tail 10 | Select-String "startup complete|Traceback"`
Expected: `Application startup complete.`，无 Traceback

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/documents.py backend/app/routers/attachments_v2.py
git commit -m "feat(documents): 附件上传/删除绑定当前迭代并校验签出"
```

---

## Task 7: 后端返回签出用户名 + force-checkin 路由 + 权限切换

**Files:**
- Modify: `backend/app/routers/documents.py`（列表/详情补用户名、迭代补用户名、checkout/checkin/undo 权限切换、新增 force-checkin 路由）

- [ ] **Step 1: 抽取签出用户名解析辅助函数**

在 `backend/app/routers/documents.py` 的 `_resolve_group_names` 函数之后新增：

```python
def _checkout_user_name(db: Session, uid) -> Optional[str]:
    """解析签出用户的真实姓名"""
    if not uid:
        return None
    u = db.query(User).filter(User.id == uid).first()
    return u.real_name if u else None
```

- [ ] **Step 2: 列表端点补 check_out_user_name**

在 `list_documents` 中，`creator_map` 构建之后新增签出用户映射：

```python
    checkout_ids = {d.check_out_user_id for d in docs if d.check_out_user_id}
    checkout_map = {}
    if checkout_ids:
        cus = db.query(User).filter(User.id.in_(checkout_ids)).all()
        checkout_map = {u.id: u.real_name for u in cus}
```

并在 brief 与非 brief 两个返回体的 `"check_out_user_id": ...` 行下方各加：

```python
            "check_out_user_name": checkout_map.get(d.check_out_user_id) if d.check_out_user_id else None,
```

- [ ] **Step 3: 详情端点补 check_out_user_name**

在 `get_document` 的返回体 `"check_out_user_id": ...` 行下方加：

```python
        "check_out_user_name": _checkout_user_name(db, d.check_out_user_id),
```

- [ ] **Step 4: 迭代端点补签出信息（可选，保持一致）**

`get_document_iterations` 返回 crud 列表即可，无需用户名（迭代记录属于历史，展示签入信息）。此步无改动，跳过。

- [ ] **Step 5: 切换 checkout/checkin/undo 权限为专用项**

将 `checkout_document` 路由的依赖 `require_permission("documents:update")` 改为 `require_permission("documents:checkout")`；
`checkin_document` 改为 `require_permission("documents:checkin")`；
`undo_checkout_document` 改为 `require_permission("documents:undocheckout")`。
并在这三个路由返回体的 `"check_out_user_id"` 处补 `"check_out_user_name"`（checkout 用 `current_user.real_name`，checkin/undo 为 `None`）。

- [ ] **Step 6: 新增 force-checkin 路由**

在 `undo_checkout_document` 路由之后新增：

```python
@router.post("/{doc_id}/force-checkin")
def force_checkin_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:force_checkin")),
):
    doc, err = crud_documents.force_checkin_document(db, doc_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    from .. import crud as crud_common
    crud_common.create_log(db, current_user.id, current_user.username,
                           "图文档强制签入", "document", str(doc.id),
                           f"编号:{doc.code} 版本:{doc.version}", None)
    return {
        "id": str(doc.id), "code": doc.code, "name": doc.name,
        "version": doc.version, "status": doc.status,
        "check_out_user_id": None, "check_out_user_name": None,
        "check_out_date": None, "latest_iteration": doc.latest_iteration,
    }
```

- [ ] **Step 7: 重启验证 + API 冒烟**

Run: `docker restart bom_backend`
Run（等 5 秒）: `docker logs bom_backend --tail 10 | Select-String "startup complete|Traceback"`
Expected: `Application startup complete.`，无 Traceback

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/documents.py
git commit -m "feat(documents): 返回签出用户名+强制签入路由+专用签出权限"
```

---

## Task 8: 前端类型与 API 客户端

**Files:**
- Modify: `frontend/src/types/index.ts`（Document 接口 + 新增类型）
- Modify: `frontend/src/services/api.ts`（documentsApi 加函数）

- [ ] **Step 1: 扩展 Document 接口并新增类型**

在 `frontend/src/types/index.ts` 的 `Document` 接口（约 156-173 行）末尾字段后追加：

```typescript
  check_out_user_id?: string | null;
  check_out_user_name?: string | null;
  check_out_date?: string | null;
  latest_iteration?: number;
```

并在 `Document` 接口之后新增：

```typescript
export interface DocumentAttachmentBrief {
  id: string;
  file_name: string;
  file_size: number;
  file_path?: string;
  created_at?: string | null;
}

export interface DocumentIteration {
  id: string;
  iteration: number;
  check_in_date?: string | null;
  check_in_note?: string | null;
  created_at?: string | null;
  attachments: DocumentAttachmentBrief[];
}
```

- [ ] **Step 2: documentsApi 增加签出函数**

在 `frontend/src/services/api.ts` 的 `documentsApi` 对象中（`references` 函数附近）追加：

```typescript
  checkout: (docId: string) =>
    api.post(`/documents/${docId}/checkout`).then((r) => r.data),
  checkin: (docId: string, note?: string) =>
    api.post(`/documents/${docId}/checkin`, null, { params: note ? { note } : {} }).then((r) => r.data),
  undocheckout: (docId: string) =>
    api.post(`/documents/${docId}/undo-checkout`).then((r) => r.data),
  forceCheckin: (docId: string) =>
    api.post(`/documents/${docId}/force-checkin`).then((r) => r.data),
  iterations: (docId: string) =>
    api.get(`/documents/${docId}/iterations`).then((r) => r.data),
```

> 注意：确认 `documentsApi` 现有函数是否用 `.then((r) => r.data)` 风格还是返回 axios promise。若现有风格是返回 `api.xxx(...)`（不 unwrap），则与现有保持一致，去掉 `.then`。先 `Select-String -Path frontend/src/services/api.ts -Pattern "documentsApi" -Context 0,20` 查看风格再决定。

- [ ] **Step 3: 编译验证**

Run（在 frontend 目录）: `npx tsc --noEmit`
Expected: 无类型错误（或仅有既存的无关警告）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(documents): 前端签出类型与 API 客户端"
```

---

## Task 9: 新建 DocumentDetailModal 组件

详情+编辑合一弹窗，参照 `PartDetailModal`。核心信息在上、操作区居中、Tab 在下。

**Files:**
- Create: `frontend/src/components/DocumentDetailModal.tsx`

- [ ] **Step 1: 先精读参考组件的 Modal / Tab / 自动保存写法**

Run: `Select-String -Path frontend/src/components/PartDetailModal.tsx -Pattern "autoSaveMaster|activeTab|setActiveTab|Modal open|width=" -Context 1,3`
理解 Modal 用法、Tab 切换、防抖自动保存模式，供本组件复用。

- [ ] **Step 2: 创建 DocumentDetailModal.tsx**

创建 `frontend/src/components/DocumentDetailModal.tsx`，内容如下（完整组件）：

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from './Modal';
import Loading from './Loading';
import { useToast } from '../hooks/useCommon';
import { useAuthStore, isAdmin } from '../stores/auth';
import { documentsApi, mediaApi, v2UploadApi } from '../services/api';
import { uploadLargeFile } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import { formatDateTime } from '../utils/date';
import type { Document, DocumentIteration, DocumentAttachment } from '../types';

interface Props {
  open: boolean;
  docId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const statusTag = (s: string) => {
  const tags: Record<string, { label: string; class: string }> = {
    draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', class: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
  };
  return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
};

type TabKey = 'attachments' | 'versions' | 'iterations';

export default function DocumentDetailModal({ open, docId, onClose, onSaved }: Props) {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('attachments');
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [iterations, setIterations] = useState<DocumentIteration[]>([]);
  const [versions, setVersions] = useState<Document[]>([]);
  const [editForm, setEditForm] = useState({ code: '', name: '', remark: '' });
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinNote, setCheckinNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const isCheckedOut = !!doc?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && doc?.check_out_user_id === user?.id;
  const isDraft = doc?.status === 'draft';
  const canEdit = isCheckedOutByMe && isDraft;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (doc?.latest_iteration || 0) > 1;
  const canForceCheckin = isCheckedOut && isAdmin();

  const loadDoc = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const d = await documentsApi.get(docId);
      setDoc(d.data ?? d);
      const dd = d.data ?? d;
      setEditForm({ code: dd.code || '', name: dd.name || '', remark: dd.remark || '' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  const loadAttachments = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await documentsApi.listAttachments(docId);
      setAttachments(res.data || []);
    } catch { setAttachments([]); }
  }, [docId]);

  const loadIterations = useCallback(async () => {
    if (!docId) return;
    try { setIterations(await documentsApi.iterations(docId)); } catch { setIterations([]); }
  }, [docId]);

  const loadVersions = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await documentsApi.versions(docId);
      setVersions(res.data || []);
    } catch { setVersions([]); }
  }, [docId]);

  useEffect(() => {
    if (open && docId) {
      loadDoc();
      loadAttachments();
      loadIterations();
      loadVersions();
    }
  }, [open, docId, loadDoc, loadAttachments, loadIterations, loadVersions]);

  // 字段自动保存（防抖）
  const autoSave = (patch: Partial<{ code: string; name: string; remark: string }>) => {
    if (!docId) return;
    const next = { ...editForm, ...patch };
    setEditForm(next);
    window.clearTimeout((autoSave as any)._t);
    (autoSave as any)._t = window.setTimeout(async () => {
      try {
        await documentsApi.update(docId, patch);
        onSaved();
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '保存失败');
      }
    }, 600);
  };

  const doAction = async (fn: () => Promise<any>, okMsg: string) => {
    try {
      await fn();
      toast.success(okMsg);
      await loadDoc();
      await loadIterations();
      await loadAttachments();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '操作失败');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docId) return;
    setUploading(true);
    try {
      if (file.size > 5 * 1024 * 1024) {
        await uploadLargeFile(file, docId, () => {}, 'documents');
      } else {
        await v2UploadApi.uploadSmallFile(file, 'documents', docId, () => {});
      }
      await loadAttachments();
      toast.success('上传成功');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteAtt = async (attId: string) => {
    if (!docId || !confirm('确定删除该附件？')) return;
    try {
      await documentsApi.deleteAttachment(docId, attId);
      await loadAttachments();
      toast.success('已删除');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '删除失败');
    }
  };

  const handleDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { toast.error('下载失败'); }
  };

  const tabs = useMemo(() => ([
    { key: 'attachments' as const, label: '附件' },
    { key: 'versions' as const, label: '版本历史' },
    { key: 'iterations' as const, label: '迭代历史' },
  ]), []);

  if (!open) return null;
  const tag = doc ? statusTag(doc.status) : { label: '', class: '' };

  return (
    <Modal open={open} title="图文档详情" onClose={onClose} width="full">
      <div className="min-h-[50vh] flex flex-col">
        {loading && !doc ? (
          <Loading />
        ) : !doc ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            {/* 顶部核心信息 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 mb-3">
              <Field label="图文档编号">
                {canEdit && doc.version === 'A' ? (
                  <input value={editForm.code} onChange={(e) => autoSave({ code: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                ) : <div className="text-sm text-gray-900 font-medium font-mono">{doc.code}</div>}
              </Field>
              <Field label="名称">
                {canEdit ? (
                  <input value={editForm.name} onChange={(e) => autoSave({ name: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                ) : <div className="text-sm text-gray-900 font-medium">{doc.name}</div>}
              </Field>
              <Field label="版本"><div className="text-sm text-gray-900 font-medium">{doc.version || '-'}</div></Field>
              <Field label="状态"><span className={`inline-block px-2 py-0.5 text-xs rounded-full ${tag.class}`}>{tag.label}</span></Field>
              <Field label="备注" className="col-span-2">
                {canEdit ? (
                  <input value={editForm.remark} onChange={(e) => autoSave({ remark: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                ) : <div className="text-sm text-gray-900 font-medium whitespace-pre-wrap">{doc.remark || '-'}</div>}
              </Field>
              <Field label="创建人"><div className="text-sm text-gray-900 font-medium">{doc.creator_name || '-'}</div></Field>
              <Field label="更新时间"><div className="text-sm text-gray-900 font-medium">{formatDateTime(doc.updated_at)}</div></Field>
            </div>

            {/* 中部操作区 */}
            <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3 shrink-0">
              <div className="text-xs">
                {isCheckedOut
                  ? <span className="text-orange-600">🔒 已签出：{doc.check_out_user_name || '未知'}</span>
                  : <span className="text-gray-400">未签出</span>}
              </div>
              <div className="flex gap-2">
                {canCheckout && <button onClick={() => doAction(() => documentsApi.checkout(doc.id), '签出成功')} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">签出</button>}
                {canCheckin && <button onClick={() => setShowCheckinModal(true)} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">签入</button>}
                {canUndo && <button onClick={() => doAction(() => documentsApi.undocheckout(doc.id), '已撤销签出')} className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-100">撤销签出</button>}
                {canForceCheckin && <button onClick={() => { if (confirm('确定强制签入该文档？')) doAction(() => documentsApi.forceCheckin(doc.id), '已强制签入'); }} className="px-3 py-1 text-sm border border-red-300 rounded text-red-600 hover:bg-red-50">强制签入</button>}
                {isDraft && isCheckedOutByMe && <button onClick={() => { if (confirm('确定升版？')) doAction(() => documentsApi.upgrade(doc.id), '升版成功'); }} className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-100">升版</button>}
              </div>
            </div>

            {/* 底部 Tab */}
            <div className="border-b flex gap-1 shrink-0">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm -mb-px border-b-2 ${activeTab === t.key ? 'border-primary-600 text-primary-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto pt-3">
              {activeTab === 'attachments' && (
                <div>
                  {canEdit && (
                    <div className="mb-2">
                      <label className="inline-block px-3 py-1 text-sm bg-primary-600 text-white rounded cursor-pointer hover:bg-primary-700">
                        {uploading ? '上传中...' : '上传附件'}
                        <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                      </label>
                    </div>
                  )}
                  {attachments.length === 0 ? (
                    <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">暂无附件</div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="px-3 py-2 text-left text-gray-500 font-medium">文件名</th>
                            <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">大小</th>
                            <th className="px-3 py-2 text-left text-gray-500 font-medium w-40">上传时间</th>
                            <th className="px-3 py-2 text-right text-gray-500 font-medium w-40">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {attachments.map((att) => (
                            <tr key={att.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-primary-600">{att.file_name}</td>
                              <td className="px-3 py-2 text-gray-500">{formatFileSize(att.file_size || 0)}</td>
                              <td className="px-3 py-2 text-gray-500">{formatDateTime(att.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => previewAttachment(att.id, att.file_name || 'preview', {})} className="text-blue-600 hover:text-blue-800 mr-2">预览</button>
                                <button onClick={() => handleDownload(att.id, att.file_name || 'download')} className="text-primary-600 hover:text-primary-800 mr-2">下载</button>
                                {canEdit && <button onClick={() => handleDeleteAtt(att.id)} className="text-red-600 hover:text-red-800">删除</button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'versions' && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b"><tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">版本</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">状态</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">更新时间</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {versions.map((v) => (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{v.version}</td>
                          <td className="px-3 py-2">{statusTag(v.status).label}</td>
                          <td className="px-3 py-2 text-gray-500">{formatDateTime(v.updated_at)}</td>
                        </tr>
                      ))}
                      {versions.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">暂无版本历史</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              {activeTab === 'iterations' && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b"><tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">迭代</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-40">签入时间</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">签入说明</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {iterations.map((it) => (
                        <tr key={it.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">#{it.iteration}</td>
                          <td className="px-3 py-2 text-gray-500">{it.check_in_date ? formatDateTime(it.check_in_date) : <span className="text-orange-600">进行中</span>}</td>
                          <td className="px-3 py-2 text-gray-700">{it.check_in_note || '-'}</td>
                          <td className="px-3 py-2 text-gray-500">{(it.attachments || []).map((a) => a.file_name).join('、') || '-'}</td>
                        </tr>
                      ))}
                      {iterations.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">暂无迭代记录</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showCheckinModal && (
        <Modal open={showCheckinModal} title="签入说明" onClose={() => setShowCheckinModal(false)} width="md">
          <textarea value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)}
            placeholder="请输入签入说明（选填）..." rows={4}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowCheckinModal(false)} className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600">取消</button>
            <button onClick={async () => {
              if (!doc) return;
              await doAction(() => documentsApi.checkin(doc.id, checkinNote || undefined), '签入成功');
              setShowCheckinModal(false); setCheckinNote('');
            }} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">确认签入</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 ${className || ''}`}>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: 核对依赖导入的真实签名**

逐一确认这些导入在项目中确实存在且签名匹配（不匹配则按实际调整）：
- Run: `Select-String -Path frontend/src/services/api.ts -Pattern "uploadLargeFile|v2UploadApi|export const mediaApi|token:"`
- Run: `Select-String -Path frontend/src/hooks/useCommon.ts -Pattern "useToast"`
- Run: `Select-String -Path frontend/src/stores/auth.ts -Pattern "isAdmin|useAuthStore"`
- Run: `Select-String -Path frontend/src/utils/attachmentPreview.ts -Pattern "previewAttachment"`

重点核对 `uploadLargeFile` 的参数顺序与 entity_type 参数（DocumentDetailContent/Documents.tsx 中已有用法，参照其调用方式修正 Step 2 中的 `handleUpload`）。

- [ ] **Step 4: 编译验证**

Run（frontend 目录）: `npx tsc --noEmit`
Expected: 无类型错误。若有导入/签名不符，按 Step 3 结果修正。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DocumentDetailModal.tsx
git commit -m "feat(documents): 新建详情/编辑合一的 DocumentDetailModal"
```

---

## Task 10: 改造 Documents.tsx 列表页与新建弹窗

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`

- [ ] **Step 1: 精读现有列表与弹窗结构**

Run: `Select-String -Path frontend/src/pages/Documents.tsx -Pattern "editingDoc|setEditingDoc|<thead|<th |handleRowClick|onClick.*setEditingDoc|DocumentDetailContent" -Context 0,2`
理解现有列表表头、行点击、编辑弹窗触发方式，规划改造点。

- [ ] **Step 2: 引入 DocumentDetailModal 并增加状态**

在 `Documents.tsx` 顶部 import 处加：

```tsx
import DocumentDetailModal from '../components/DocumentDetailModal';
```

在组件 state 区加：

```tsx
const [detailDocId, setDetailDocId] = useState<string | null>(null);
```

- [ ] **Step 3: 表头新增「签出状态」列**

在列表 `<thead>` 的「状态」列之后、「操作」列之前插入：

```tsx
<th className="w-28 px-4 py-3 text-left text-sm font-medium text-gray-500">签出状态</th>
```

- [ ] **Step 4: 表体新增签出状态单元格 + 行内签出按钮**

在每行「状态」单元格之后插入签出状态单元格：

```tsx
<td className="px-4 py-3 text-sm">
  {d.check_out_user_name
    ? <span className="text-orange-600">{d.check_out_user_name}</span>
    : <span className="text-gray-400">—</span>}
</td>
```

在「操作」单元格内，将原「编辑」按钮替换为「详情」按钮（点击打开新弹窗），并在草稿未签出时加「签出」按钮：

```tsx
<button onClick={() => setDetailDocId(d.id)} className="text-primary-600 hover:text-primary-800 mr-3">详情</button>
{d.status === 'draft' && !d.check_out_user_id && (
  <button onClick={async () => {
    try { await documentsApi.checkout(d.id); toast.success('签出成功'); setDetailDocId(d.id); loadDocuments(); }
    catch (e: any) { toast.error(e?.response?.data?.detail || '签出失败'); }
  }} className="text-orange-600 hover:text-orange-800 mr-3">签出</button>
)}
```

> `loadDocuments` / `toast` 用现有页面内同名函数（若名称不同，按现有实现替换）。原「删除」按钮保留不动。

- [ ] **Step 5: 挂载 DocumentDetailModal**

在 Documents.tsx 页面 return 的末尾（现有编辑弹窗附近）加：

```tsx
<DocumentDetailModal
  open={!!detailDocId}
  docId={detailDocId}
  onClose={() => { setDetailDocId(null); loadDocuments(); }}
  onSaved={() => loadDocuments()}
/>
```

- [ ] **Step 6: 精简新建弹窗（保留新建，去除附件/升版等编辑态逻辑）**

保留现有「新增图文档」弹窗用于创建（编号/名称/备注/用户组）。将其提交后的行为改为：创建成功后关闭弹窗，并用返回的新文档 id 打开 `DocumentDetailModal`（`setDetailDocId(newDoc.id)`），使用户在详情弹窗内继续上传附件。移除新建弹窗内的附件上传区（因为创建时文档已自动签出，附件在详情弹窗上传）。

> 具体：定位新建提交逻辑（约 `documentsApi.create` 调用处），成功分支改为 `setDetailDocId(created.id)` 并关闭新建弹窗。若新建弹窗与编辑弹窗共用（`editingDoc`），则拆分：`editingDoc === null` 为新建，去掉其编辑/附件分支。

- [ ] **Step 7: 编译验证**

Run（frontend 目录）: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Documents.tsx
git commit -m "feat(documents): 列表接入签出状态列与详情弹窗，精简新建流程"
```

---

## Task 11: 编译部署与端到端验证

**Files:** 无（仅构建部署）

- [ ] **Step 1: 生成权限（确保最新）+ 前端构建**

Run（frontend 目录）: `python ../tools/gen_permissions.py; if ($?) { npx tsc; if ($?) { npx vite build } }`
Expected: `built in ...`，无错误

- [ ] **Step 2: 重启后端 + 重建 nginx**

Run（根目录）: `docker restart bom_backend`
Run（根目录）: `docker-compose up -d --force-recreate nginx`
Expected: 容器 Started

- [ ] **Step 3: 服务健康检查**

Run: `docker ps --format "{{.Names}}: {{.Status}}"`
Expected: bom_nginx / bom_backend / bom_postgres / bom_redis 均 Up
Run: `docker logs bom_backend --tail 15 | Select-String "startup complete|Traceback"`
Expected: `Application startup complete.`，无 Traceback

- [ ] **Step 4: 端到端手动验证清单（浏览器 https://localhost:8080，Ctrl+F5）**

以 engineer 登录，验证：
1. 新建图文档 → 自动进入详情弹窗且显示「已签出：<自己>」
2. 详情弹窗上传附件 → 附件列表出现该文件
3. 签入（填说明）→ 状态变为未签出，迭代历史出现 #1 带签入说明
4. 列表页「签出状态」列显示正确；对未签出草稿点「签出」→ 进入编辑态
5. 再次签出 → 迭代 #2，撤销签出 → 回到 #1，附件恢复到上一迭代状态
6. 换 admin 登录，对他人签出的文档可见「强制签入」并生效
7. 未签出状态下核心字段不可编辑；他人签出时本人不能编辑

- [ ] **Step 5: 最终提交（如有构建产物或残留修改）**

```bash
git add -A
git commit -m "chore(documents): 图文档签入签出编译部署"
```

---

## Self-Review 结果

- **Spec 覆盖**：数据迁移(T2)、创建自动签出(T3)、force-checkin(T4/T7)、编辑门槛(T5)、附件绑定迭代(T6)、签出用户名(T7)、权限(T1)、前端类型/API(T8)、DocumentDetailModal(T9)、列表改造(T10)、部署验证(T11) — 全部覆盖。
- **Placeholder 扫描**：无 TBD/TODO；组件代码完整；对需按现有签名核对处（uploadLargeFile/toast/loadDocuments）已明确给出核对命令与回退策略。
- **类型一致性**：`documentsApi.checkout/checkin/undocheckout/forceCheckin/iterations`（T8 定义 = T9/T10 使用）；`DocumentIteration`/`DocumentAttachmentBrief`（T8 定义 = T9 使用）；`check_out_user_name` 字段后端(T7)与前端(T8/T9/T10)一致。
- **已知需执行者现场核对项**：`uploadLargeFile` 是否支持 `entity_type` 第 4 参数、`documentsApi` 现有函数是否 unwrap `.data`、`Documents.tsx` 内 `loadDocuments`/`toast` 实际名称 — 均已在对应 Step 标注核对命令。
