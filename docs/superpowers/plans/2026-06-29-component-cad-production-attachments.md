# 零部件 CAD附件 / 生产附件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为零部件新增两类直接上传附件桶（CAD附件 / 生产附件），照抄图文档附件存储形态（独立 `component_attachments` 表），并复用现有附件模组的上传/预览/3D/下载能力。

**Architecture:** 新建独立子表 `component_attachments`（结构 = `document_attachments` + `component_id` + `category`），图文档链路零改动。媒体端点（预览/3D/下载等）改为"跨表解析"附件 id，使前端 `previewAttachment`/`mediaApi`/`ArchiveTreeModal` 对两类附件零改动复用。上传复用通用 `/v2/attachments/upload` + `/chunk/*`，按 `entity_type` 分流写表并透传 `category`。

**Tech Stack:** 后端 FastAPI + SQLAlchemy（PG 生产 / SQLite 测试，`Base.metadata.create_all`）；前端 React + TypeScript + Tailwind（vite build / vitest）。

---

## 文件结构

后端：
- `backend/app/models.py` — 新增 `ComponentAttachment` 模型
- `backend/app/file_storage.py` — 实体类型增加 `component`；分块 meta 透传 `category`
- `backend/app/migrations_components.py` — 新增 `component_attachments` 建表（PG 幂等）
- `backend/app/routers/attachments_v2.py` — 上传按 `entity_type` 分流写表、透传 `category`；新增跨表解析器；媒体端点改用解析器
- `backend/app/routers/components.py` — 新增列表 / 删除端点；删除零部件时清理附件
- `backend/tests/test_component_attachments.py` — 新增测试

前端：
- `frontend/src/services/api.ts` — `v2UploadApi` 透传 `category`；新增 `componentAttachmentsApi`
- `frontend/src/components/ComponentAttachmentBucket.tsx` — 新增可复用附件桶组件
- `frontend/src/pages/ComponentsPage.tsx` — 编辑弹窗挂载两个桶（可编辑）
- `frontend/src/components/AssemblyDetailContent.tsx` — 详情挂载两个桶（只读）

---

## Task 1: 后端模型 + 文件存储实体类型

**Files:**
- Modify: `backend/app/models.py:83-92`
- Modify: `backend/app/file_storage.py:19-22`
- Test: `backend/tests/test_component_attachments.py`

- [ ] **Step 1: Write the failing test**

创建 `backend/tests/test_component_attachments.py`：

```python
import uuid
import pytest
from fastapi.testclient import TestClient
from app.models import User, Component, ComponentAttachment
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app import file_storage as fs_mod


def _client(db, user):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _user(db, role="engineer"):
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}",
             password_hash="x", real_name="U", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _component(db, code="C1"):
    c = Component(id=uuid.uuid4(), code=f"{code}_{uuid.uuid4().hex[:4]}",
                  name="Test", version="A", status="draft")
    db.add(c); db.commit(); db.refresh(c)
    return c


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_component_attachment_model_persists(db):
    comp = _component(db)
    att = ComponentAttachment(
        id=uuid.uuid4(), component_id=comp.id, category="cad",
        file_name="part.stp", file_size=10, file_path="component/x/part.stp",
        file_hash="abc",
    )
    db.add(att); db.commit(); db.refresh(att)
    rows = db.query(ComponentAttachment).filter(
        ComponentAttachment.component_id == comp.id).all()
    assert len(rows) == 1
    assert rows[0].category == "cad"


def test_file_storage_allows_component_entity():
    assert "component" in fs_mod.ALLOWED_ENTITY_TYPES
    assert fs_mod.ENTITY_TYPE_ALIASES.get("components") == "component"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_component_attachments.py -v`
Expected: FAIL — `ImportError: cannot import name 'ComponentAttachment'`

- [ ] **Step 3: Add the model**

`backend/app/models.py`，紧跟 `DocumentAttachment`（约 92 行后）插入：

```python
class ComponentAttachment(Base):
    """零部件独立附件表（照抄 document_attachments，文件存储在文件系统）"""
    __tablename__ = "component_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    component_id = Column(UUID(as_uuid=True), ForeignKey('components.id', ondelete='CASCADE'), nullable=False)
    category = Column(String(32), nullable=False)  # 'cad' / 'production'
    file_name = Column(String(255))
    file_size = Column(Integer)
    file_path = Column(String(512))  # 文件系统路径
    file_hash = Column(String(64))   # 文件哈希值
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 4: Add component entity type to file storage**

`backend/app/file_storage.py:19` 和 `:22`：

```python
ALLOWED_ENTITY_TYPES = {"document", "part", "assembly", "component"}
# ...
ENTITY_TYPE_ALIASES = {"documents": "document", "parts": "part", "assemblies": "assembly", "components": "component"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py -v`
Expected: PASS（2 passed）

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/file_storage.py backend/tests/test_component_attachments.py
git commit -m "feat: ComponentAttachment 模型 + file_storage 支持 component 实体"
```

---

## Task 2: PG 建表迁移（幂等）

**Files:**
- Modify: `backend/app/migrations_components.py:9-37`
- Test: `backend/tests/test_component_attachments.py`

- [ ] **Step 1: Write the failing test**

在 `tests/test_component_attachments.py` 追加：

```python
def test_migrate_components_is_noop_on_sqlite(db):
    from app.migrations_components import migrate_components
    # SQLite 下 dialect != postgresql，应直接返回且不抛异常
    assert migrate_components(db, db.get_bind()) is None
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_migrate_components_is_noop_on_sqlite -v`
Expected: PASS（`migrate_components` 已对非 PG 直接 `return`）。该测试用于锁定行为；若已 PASS 直接进入 Step 3 添加建表 SQL。

- [ ] **Step 3: Add the create-table SQL**

`backend/app/migrations_components.py`，在第 1 步创建 `components` 表的 `db.execute(...)` 之后、第 2 步迁移 parts 之前插入：

```python
    # 1b. 创建 component_attachments 表（照抄 document_attachments，若已存在跳过）
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS component_attachments (
            id UUID PRIMARY KEY,
            component_id UUID NOT NULL REFERENCES components(id) ON DELETE CASCADE,
            category VARCHAR(32) NOT NULL,
            file_name VARCHAR(255),
            file_size INTEGER,
            file_path VARCHAR(512),
            file_hash VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_component_attachments_comp_cat
        ON component_attachments (component_id, category)
    """))
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py -v`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add backend/app/migrations_components.py backend/tests/test_component_attachments.py
git commit -m "feat: PG 迁移新增 component_attachments 表（幂等）"
```

---

## Task 3: 上传按 entity_type 分流 + 透传 category

**Files:**
- Modify: `backend/app/file_storage.py:233-251` (init meta), `:330-354` (complete file_info)
- Modify: `backend/app/routers/attachments_v2.py:68-164` (upload_file), `:167-216` (init_chunked_upload), `:259-318` (complete_chunked_upload)
- Test: `backend/tests/test_component_attachments.py`

- [ ] **Step 1: Write the failing test**

追加（注意：需要一个临时上传目录，避免污染真实 uploads）：

```python
def test_upload_small_file_to_component(db, tmp_path, monkeypatch):
    # 把文件存储根目录指向临时目录
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    files = {"file": ("part.pdf", b"%PDF-1.4 test", "application/pdf")}
    data = {"entity_type": "component", "entity_id": str(comp.id), "category": "cad"}
    r = c.post("/api/v2/attachments/upload", files=files, data=data)
    assert r.status_code == 200, r.text

    rows = db.query(ComponentAttachment).filter(
        ComponentAttachment.component_id == comp.id).all()
    assert len(rows) == 1
    assert rows[0].category == "cad"
    assert rows[0].file_name == "part.pdf"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_upload_small_file_to_component -v`
Expected: FAIL — 当前 `upload_file` 只建 `DocumentAttachment`，且 `component` 类型会因 `document_id` 逻辑/约束出错；`ComponentAttachment` 行数为 0。

- [ ] **Step 3: Thread `category` through chunk meta (file_storage)**

`backend/app/file_storage.py` `init_upload`：方法签名加 `category` 参数，meta 增加 `category`：

```python
    def init_upload(self, filename: str, file_size: int, entity_type: str,
                    entity_id: str, total_chunks: int, folder_name: str = None,
                    category: str = None) -> Dict[str, Any]:
```
在 meta 字典中（`"folder_name": folder_name,` 之后）加一行：
```python
            "category": category,
```
`complete_upload`：保存文件后，把 category 带入返回的 file_info。将
```python
        meta["status"] = "completed"
        meta["result"] = result
```
之前加：
```python
        result["category"] = meta.get("category")
```

- [ ] **Step 4: Branch the DB insert in upload_file**

`backend/app/routers/attachments_v2.py` `upload_file`，函数签名加 `category` 表单参数：

```python
async def upload_file(
    file: UploadFile = File(...),
    entity_type: str = Form("document"),
    entity_id: str = Form(...),
    category: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:upload"))
):
```
在 `try:` 内保存文件 (`result = file_storage.save_file(...)`) 之后，替换原 `DocumentAttachment` 建库块为按 entity_type 分流：

```python
        # 零部件附件：写入独立表 component_attachments
        if entity_type in ("component", "components"):
            from ..models import ComponentAttachment
            catt_id = str(uuid.uuid4())
            new_catt = ComponentAttachment(
                id=catt_id,
                component_id=uuid.UUID(entity_id),
                category=category or "cad",
                file_name=result["filename"],
                file_size=result["file_size"],
                file_path=result["file_path"],
                file_hash=result.get("file_hash", ""),
            )
            db.add(new_catt)
            db.commit()
            db.refresh(new_catt)
            return {
                "id": new_catt.id,
                "file_name": result["filename"],
                "file_size": result["file_size"],
                "file_path": result["file_path"],
                "message": "文件上传成功",
            }
```
保留其后原有的图文档建库逻辑（`att_id = str(uuid.uuid4()); new_att = DocumentAttachment(...)` 等）不变。

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_upload_small_file_to_component -v`
Expected: PASS

- [ ] **Step 6: Branch the chunked completion path**

`init_chunked_upload`（`attachments_v2.py:167`）签名加 `category: str = Form(None)`，并把它透传到 `chunked_uploader.init_upload(... , folder_name=folder_name, category=category)`。

`complete_chunked_upload`（`attachments_v2.py:259`）：在读取 `file_info` 后，于现有 DocumentAttachment 建库前插入分流块：

```python
        if file_info["entity_type"] in ("component", "components"):
            from ..models import ComponentAttachment
            catt_id = str(uuid.uuid4())
            new_catt = ComponentAttachment(
                id=catt_id,
                component_id=uuid.UUID(file_info["entity_id"]),
                category=file_info.get("category") or "cad",
                file_name=file_info["filename"],
                file_size=file_info["file_size"],
                file_path=file_info["file_path"],
                file_hash=file_info.get("file_hash", ""),
            )
            db.add(new_catt)
            db.commit()
            db.refresh(new_catt)
            return {
                "id": new_catt.id,
                "file_name": file_info["filename"],
                "file_size": file_info["file_size"],
                "file_path": file_info["file_path"],
                "status": "completed",
                "message": "文件上传完成",
            }
```

- [ ] **Step 7: Run the full test file**

Run: `cd backend && python -m pytest tests/test_component_attachments.py -v`
Expected: PASS（全部）

- [ ] **Step 8: Commit**

```bash
git add backend/app/file_storage.py backend/app/routers/attachments_v2.py backend/tests/test_component_attachments.py
git commit -m "feat: 附件上传按 entity_type 分流写 component_attachments，透传 category"
```

---

## Task 4: 跨表解析器 + 媒体端点复用

**Files:**
- Modify: `backend/app/routers/attachments_v2.py`（新增解析器；改 get/download/stream/direct-download/preview/gltf/office-pdf/archive-tree/extract-file 的查询）
- Test: `backend/tests/test_component_attachments.py`

- [ ] **Step 1: Write the failing test**

追加（验证组件附件可拿到 media-token 且 stream 返回文件）：

```python
def test_component_attachment_stream_and_token(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    # 先上传
    files = {"file": ("m.pdf", b"%PDF-1.4 body", "application/pdf")}
    data = {"entity_type": "component", "entity_id": str(comp.id), "category": "production"}
    up = c.post("/api/v2/attachments/upload", files=files, data=data)
    att_id = up.json()["id"]

    # media-token（preview）应成功
    tok = c.get(f"/api/v2/attachments/{att_id}/media-token", params={"action": "preview"})
    assert tok.status_code == 200, tok.text

    # stream 应返回二进制内容
    s = c.get(f"/api/v2/attachments/{att_id}/stream")
    assert s.status_code == 200, s.text
    assert s.content == b"%PDF-1.4 body"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_component_attachment_stream_and_token -v`
Expected: FAIL — `/stream` 端点查 `DocumentAttachment` 找不到 → 404。

- [ ] **Step 3: Add the resolver**

`backend/app/routers/attachments_v2.py`，在 `_attachment_response`（约 55 行）之后插入：

```python
def _resolve_attachment(db, attachment_id):
    """跨表解析附件：先图文档附件表，再零部件附件表。

    返回 (att, source)；source ∈ {"document", "component"}；找不到返回 (None, None)。
    两表均以 file_path/file_name 暴露文件，媒体端点可统一处理。
    """
    from ..models import ComponentAttachment
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if att:
        return att, "document"
    catt = db.query(ComponentAttachment).filter(ComponentAttachment.id == attachment_id).first()
    if catt:
        return catt, "component"
    return None, None
```

- [ ] **Step 4: Switch media endpoints to the resolver**

对以下端点，把
```python
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
```
替换为
```python
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
```
涉及端点（按函数名）：`get_attachment`、`download_attachment`、`stream_attachment`、`direct_download_attachment`、`preview_attachment`、`get_gltf`、`get_office_pdf`、`get_archive_tree`、`extract_archive_file`。

其中已含 `crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)` 的端点保持该调用不变——对零部件附件它会因查不到 DocumentAttachment 而自动放行（已验证其实现：附件无文档归属即 return）。

> 注意：`media-token` 端点（`issue_media_token`）本就不查附件表，仅调用 enforce 后签发，无需改动，对组件附件直接可用。

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_component_attachment_stream_and_token -v`
Expected: PASS

- [ ] **Step 6: Regression — 图文档附件未受影响**

Run: `cd backend && python -m pytest tests/test_media_token.py tests/test_document_content_access.py -v`
Expected: PASS（原有用例不回归）

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/attachments_v2.py backend/tests/test_component_attachments.py
git commit -m "feat: 媒体端点跨表解析附件，复用预览/3D/下载于零部件附件"
```

---

## Task 5: 零部件附件 列表 + 删除端点

**Files:**
- Modify: `backend/app/routers/components.py`（文件末尾新增端点；顶部 import 增 `ComponentAttachment`）
- Test: `backend/tests/test_component_attachments.py`

- [ ] **Step 1: Write the failing test**

追加：

```python
def test_list_and_delete_component_attachments(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)
    monkeypatch.setattr("app.routers.components.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    # 上传一个 cad、一个 production
    for cat, fn in [("cad", "a.pdf"), ("production", "b.pdf")]:
        c.post("/api/v2/attachments/upload",
               files={"file": (fn, b"%PDF-1.4 x", "application/pdf")},
               data={"entity_type": "component", "entity_id": str(comp.id), "category": cat})

    # 列表（全部）
    r = c.get(f"/api/components/{comp.id}/attachments")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2

    # 列表（按 category 过滤）
    r_cad = c.get(f"/api/components/{comp.id}/attachments", params={"category": "cad"})
    assert len(r_cad.json()) == 1
    assert r_cad.json()[0]["category"] == "cad"

    # 删除其中一个
    att_id = r_cad.json()[0]["id"]
    d = c.delete(f"/api/components/{comp.id}/attachments/{att_id}")
    assert d.status_code == 200, d.text
    assert db.query(ComponentAttachment).filter(ComponentAttachment.id == att_id).first() is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_list_and_delete_component_attachments -v`
Expected: FAIL — 端点不存在 → 404/405。

- [ ] **Step 3: Add imports + endpoints**

`backend/app/routers/components.py`：顶部 import 行（`from ..models import User, Document, DocumentGroupLink, UserGroup, Component`）改为追加 `ComponentAttachment`，并新增：

```python
from ..models import User, Document, DocumentGroupLink, UserGroup, Component, ComponentAttachment
from ..file_storage import file_storage
from ..stp_converter import is_stp_file, delete_glb_cache
from ..office_converter import is_office_file, delete_pdf_cache
```

文件末尾追加：

```python
# ===== 零部件附件（CAD / 生产）=====

def _comp_att_response(att):
    return {
        "id": str(att.id),
        "component_id": str(att.component_id),
        "category": att.category,
        "file_name": att.file_name,
        "file_size": att.file_size,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/{component_id}/attachments")
async def list_component_attachments(
    component_id: uuid.UUID, category: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    q = db.query(ComponentAttachment).filter(ComponentAttachment.component_id == component_id)
    if category:
        q = q.filter(ComponentAttachment.category == category)
    rows = q.order_by(ComponentAttachment.created_at.asc()).all()
    return [_comp_att_response(a) for a in rows]


@router.delete("/{component_id}/attachments/{attachment_id}")
async def delete_component_attachment(
    component_id: uuid.UUID, attachment_id: uuid.UUID, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:delete"))
):
    att = db.query(ComponentAttachment).filter(
        ComponentAttachment.id == attachment_id,
        ComponentAttachment.component_id == component_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    # 删除磁盘文件
    if att.file_path:
        file_storage.delete_file(att.file_path)
    # 删除转换缓存（STP→glb / Office→pdf）
    if att.file_name and is_stp_file(att.file_name):
        delete_glb_cache(str(attachment_id), att.file_path)
    if att.file_name and is_office_file(att.file_name):
        delete_pdf_cache(str(attachment_id), att.file_path)
    db.delete(att)
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除零部件附件", "component", str(component_id),
                    f"附件:{att.file_name} 分类:{att.category}", ip)
    return {"message": "附件已删除"}
```

> `file_storage.delete_file` 在文件不存在时不应抛错——参考其实现（`document_attachments` 删除复用同方法）。若实现会抛 `FileNotFoundError`，用 `try/except FileNotFoundError: pass` 包裹（与 attachments_v2 的删除一致地容错）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_list_and_delete_component_attachments -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/components.py backend/tests/test_component_attachments.py
git commit -m "feat: 零部件附件列表/删除端点（按 category 分桶 + 缓存清理）"
```

---

## Task 6: 删除零部件时清理附件文件

**Files:**
- Modify: `backend/app/routers/components.py:132-146` (`delete_component`)
- Test: `backend/tests/test_component_attachments.py`

> 背景：`component_attachments.component_id` 有 `ON DELETE CASCADE`，PG 会自动删行；但磁盘文件与转换缓存需手动清理。`delete_component` 软删/硬删行为以 `crud.delete_component` 为准；此处在路由层补一次文件清理。

- [ ] **Step 1: Write the failing test**

追加：

```python
def test_delete_component_cleans_attachment_files(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)
    monkeypatch.setattr("app.routers.components.file_storage", store)

    comp = _component(db)
    admin = _user(db, "admin")
    c = _client(db, admin)

    up = c.post("/api/v2/attachments/upload",
                files={"file": ("z.pdf", b"%PDF-1.4 z", "application/pdf")},
                data={"entity_type": "component", "entity_id": str(comp.id), "category": "cad"})
    att = db.query(ComponentAttachment).filter(ComponentAttachment.id == up.json()["id"]).first()
    disk_path = store.base_dir / att.file_path
    assert disk_path.exists()

    d = c.delete(f"/api/components/{comp.id}")
    assert d.status_code == 200, d.text
    assert not disk_path.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_component_attachments.py::test_delete_component_cleans_attachment_files -v`
Expected: FAIL — 文件仍存在（删除零部件未清理磁盘文件）。

- [ ] **Step 3: Clean up files in delete_component**

`backend/app/routers/components.py` `delete_component`，在 `crud.delete_component(db, component_id)` 之前插入：

```python
    # 清理零部件附件的磁盘文件与转换缓存（DB 行由 CASCADE 处理）
    catts = db.query(ComponentAttachment).filter(
        ComponentAttachment.component_id == component_id).all()
    for att in catts:
        try:
            if att.file_path:
                file_storage.delete_file(att.file_path)
            if att.file_name and is_stp_file(att.file_name):
                delete_glb_cache(str(att.id), att.file_path)
            if att.file_name and is_office_file(att.file_name):
                delete_pdf_cache(str(att.id), att.file_path)
        except FileNotFoundError:
            pass
```

> 若 `crud.delete_component` 为软删除（不级联删除 component_attachments 行），文件清理仍按上面执行；如需同时软删附件行，依据 `crud.delete_component` 现有语义在实现时确认（本任务只负责文件清理，不改变删除语义）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_component_attachments.py -v`
Expected: PASS（全文件）

- [ ] **Step 5: Run full backend suite (regression)**

Run: `cd backend && python -m pytest -q`
Expected: 全绿（无新增失败）

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/components.py backend/tests/test_component_attachments.py
git commit -m "feat: 删除零部件时清理其附件磁盘文件与转换缓存"
```

---

## Task 7: 前端 API —— category 透传 + componentAttachmentsApi

**Files:**
- Modify: `frontend/src/services/api.ts:319-362` (`v2UploadApi`), 末尾新增 `componentAttachmentsApi`

- [ ] **Step 1: Add `category` param to upload methods**

`frontend/src/services/api.ts` `uploadSmallFile`：签名末尾加 `category?: string`，并在 `formData.append('entity_id', entityId);` 之后追加：

```typescript
    if (category) formData.append('category', category);
```
完整签名：
```typescript
  uploadSmallFile: (
    file: File,
    entityType: string = 'documents',
    entityId: string,
    onProgress?: (percent: number) => void,
    category?: string
  ): Promise<{ id: string; file_name: string; file_size: number; file_path: string }> => {
```

`initChunkedUpload`：签名末尾加 `category?: string`，并在 `formData.append('entity_id', entityId);` 之后追加：
```typescript
    if (category) formData.append('category', category);
```
完整签名：
```typescript
  initChunkedUpload: (
    filename: string,
    fileSize: number,
    entityType: string = 'documents',
    entityId: string,
    category?: string
  ): Promise<{ upload_id: string; total_chunks: number; chunk_size: number; }> => {
```

- [ ] **Step 2: Add componentAttachmentsApi**

在 `api.ts` 中 `entityDocumentsApi` 定义之后新增：

```typescript
// 零部件附件（CAD / 生产）
export interface ComponentAttachment {
  id: string;
  component_id: string;
  category: 'cad' | 'production';
  file_name: string;
  file_size: number | null;
  created_at: string | null;
}

export const componentAttachmentsApi = {
  list: (componentId: string, category?: 'cad' | 'production') =>
    api.get<ComponentAttachment[]>(`/components/${componentId}/attachments`, { params: category ? { category } : {} }),
  remove: (componentId: string, attachmentId: string) =>
    api.delete(`/components/${componentId}/attachments/${attachmentId}`),
};
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(fe): v2 上传透传 category + componentAttachmentsApi"
```

---

## Task 8: ComponentAttachmentBucket 组件

**Files:**
- Create: `frontend/src/components/ComponentAttachmentBucket.tsx`

- [ ] **Step 1: Create the component**

创建 `frontend/src/components/ComponentAttachmentBucket.tsx`。沿用 `EntityDocumentSection` 的附件子表风格（primary-* 配色、上传进度条、预览/下载/删除）：

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { componentAttachmentsApi, mediaApi, v2UploadApi, CHUNK_THRESHOLD, CHUNK_SIZE } from '../services/api';
import type { ComponentAttachment } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import ArchiveTreeModal from './ArchiveTreeModal';

interface Props {
  componentId: string;
  category: 'cad' | 'production';
  label: string;
  editable: boolean;
}

const fmtSize = (n: number | null) =>
  n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function ComponentAttachmentBucket({ componentId, category, label, editable }: Props) {
  const [items, setItems] = useState<ComponentAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [progress, setProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await componentAttachmentsApi.list(componentId, category);
      setItems(res.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [componentId, category]);

  useEffect(() => { load(); }, [load]);

  const uploadLarge = async (file: File) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const init = await v2UploadApi.initChunkedUpload(file.name, file.size, 'components', componentId, category);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      await v2UploadApi.uploadChunk(init.upload_id, i, file.slice(start, Math.min(start + CHUNK_SIZE, file.size)));
      setProgress(Math.round(5 + ((i + 1) / totalChunks) * 90));
    }
    await v2UploadApi.completeChunkedUpload(init.upload_id);
    setProgress(100);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_ALLOWED = 1073741824; // 1GB
    if (file.size > MAX_ALLOWED) { alert('文件大小超过系统限制 1GB'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setUploading(true); setUploadName(file.name); setProgress(0);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadLarge(file);
      } else {
        await v2UploadApi.uploadSmallFile(file, 'components', componentId, (p) => setProgress(p), category);
      }
      await load();
    } catch {
      alert('上传失败，请重试');
    } finally {
      setUploading(false); setUploadName(''); setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (attId: string) => {
    if (!confirm('确定要删除该附件吗？')) return;
    setDeletingId(attId);
    try { await componentAttachmentsApi.remove(componentId, attId); await load(); }
    catch { alert('删除失败，请重试'); }
    finally { setDeletingId(null); }
  };

  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, { onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }) });
  };

  const handleDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName || 'download';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { alert('下载失败，请重试'); }
  };

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">{label}</h4>
        {editable && !uploading && (
          <>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 上传附件</button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
          </>
        )}
      </div>

      {uploading && (
        <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-blue-700">正在上传 "{uploadName}"</span>
            <span className="text-blue-600 font-medium">{progress}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">加载中...</div>
        ) : items.length === 0 && !uploading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">暂无附件</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">文件名</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">大小</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((att) => (
                <tr key={att.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><span className="text-primary-600">{att.file_name}</span></td>
                  <td className="px-3 py-2 text-gray-500">{fmtSize(att.file_size)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => handlePreview(att.id, att.file_name)} className="text-blue-600 hover:text-blue-800 text-xs">预览</button>
                      <button type="button" onClick={() => handleDownload(att.id, att.file_name)} className="text-primary-600 hover:text-primary-800 text-xs">下载</button>
                      {editable && (
                        <button type="button" onClick={() => handleDelete(att.id)} disabled={deletingId === att.id} className="text-red-500 hover:text-red-700 disabled:opacity-50 text-xs">
                          {deletingId === att.id ? '删除中...' : '删除'}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {archivePreview && (
        <ArchiveTreeModal open={!!archivePreview} onClose={() => setArchivePreview(null)} attachmentId={archivePreview.attId} fileName={archivePreview.fileName} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ComponentAttachmentBucket.tsx
git commit -m "feat(fe): ComponentAttachmentBucket 可复用附件桶组件"
```

---

## Task 9: 接入编辑弹窗与详情视图

**Files:**
- Modify: `frontend/src/pages/ComponentsPage.tsx:14`（import）, `:1445-1448`（编辑弹窗）
- Modify: `frontend/src/components/AssemblyDetailContent.tsx:6`（import）, `:75-78`（详情）

- [ ] **Step 1: Wire into the edit modal**

`frontend/src/pages/ComponentsPage.tsx` 顶部 import 区（紧邻第 14 行 `EntityDocumentSection` import）新增：

```tsx
import ComponentAttachmentBucket from '../components/ComponentAttachmentBucket';
```

编辑弹窗中，把第 1445-1448 行的「关联图文档」块改为其后追加两个桶：

```tsx
          {/* 关联图文档（仅编辑已有部件时显示） */}
          {editingComponent && (
            <EntityDocumentSection entityType="component" entityId={editingComponent.id} entityCode={editingComponent.code} entityName={editingComponent.name} editable />
          )}

          {/* CAD附件 / 生产附件（仅编辑已有部件时显示） */}
          {editingComponent && (
            <>
              <ComponentAttachmentBucket componentId={editingComponent.id} category="cad" label="CAD附件" editable />
              <ComponentAttachmentBucket componentId={editingComponent.id} category="production" label="生产附件" editable />
            </>
          )}
```

- [ ] **Step 2: Wire into the detail view**

`frontend/src/components/AssemblyDetailContent.tsx` 顶部 import（第 6 行 `EntityDocumentSection` import 之后）新增：

```tsx
import ComponentAttachmentBucket from './ComponentAttachmentBucket';
```

在「关联图文档」块（第 75-78 行）之后追加两个只读桶：

```tsx
      {/* CAD附件 / 生产附件（只读） */}
      <ComponentAttachmentBucket componentId={assembly.id} category="cad" label="CAD附件" editable={false} />
      <ComponentAttachmentBucket componentId={assembly.id} category="production" label="生产附件" editable={false} />
```

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ComponentsPage.tsx frontend/src/components/AssemblyDetailContent.tsx
git commit -m "feat(fe): 零部件编辑/详情挂载 CAD附件/生产附件 两个桶"
```

---

## Task 10: 端到端手测（Docker）

**Files:** 无（手测）

- [ ] **Step 1: 重建并启动**

Run: `docker compose up -d --build`（参照项目现有部署方式）
Expected: 后端启动时 `migrate_components` 自动创建 `component_attachments` 表。

- [ ] **Step 2: 验证清单**

- [ ] 进入某零部件「编辑」，CAD附件桶上传一个 `.pdf` → 列表出现，点「预览」新窗口内嵌打开
- [ ] 生产附件桶上传一个 `.stp` → 点「预览」进入三维查看器（首次 202 转换后可见）
- [ ] 上传一个 `>10MB` 文件 → 走分块上传，进度条到 100%，列表出现
- [ ] 上传一个 `.zip` → 点「预览」弹出压缩包内容树
- [ ] 「详情」视图能看到两个桶且只读（仅预览/下载，无上传/删除）
- [ ] 删除某附件 → 列表移除；服务器 `uploads/component/<id>/` 下文件消失
- [ ] 删除整个零部件 → 其 `component_attachments` 行与磁盘文件被清理
- [ ] 图文档及其附件功能回归正常（预览/下载/3D 不受影响）

- [ ] **Step 3: 更新记忆（实测通过后）**

实测通过后，在 `MEMORY.md` 增加一行指向本特性的记忆文件（参照库存/AI 助手记忆条目的写法）。

---

## Self-Review 记录

- **Spec 覆盖**：§4 数据模型→T1/T2；§5 文件存储→T1；§6.1 上传→T3；§6.2 列表→T5；§6.3 删除→T5；§6.4 跨表解析→T4；§6.5 权限→T3/T5（复用 attachments:* / components:read）；§7 前端→T7/T8/T9；§8 边界（删除清理/大文件/STP/空桶）→T6/T8/T10；§9 验证→各任务测试 + T10。无遗漏。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致**：`ComponentAttachment`（后端模型）字段与 §4 表一致；前端 `ComponentAttachment` 接口字段与后端 `_comp_att_response` 一致（id/component_id/category/file_name/file_size/created_at）；`componentAttachmentsApi.list/remove`、`v2UploadApi.*(…, category)` 跨任务签名一致；`ComponentAttachmentBucket` props（componentId/category/label/editable）在 T8 定义、T9 使用一致。
- **待实现时确认项**：`file_storage.delete_file` 对缺失文件是否抛错（T5 注记）；`crud.delete_component` 软删/硬删语义是否级联 component_attachments 行（T6 注记，本计划只保证文件清理）。
