# 图文档分组权限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图文档上叠加基于用户组的内容访问控制——未关联组全员可预览/下载;关联组仅成员可;admin 与文档创建者绕过。

**Architecture:** 新增 3 张表(用户组、用户↔组、文档↔组)与 `documents.creator_id` 列。判定逻辑封装为单一对象策略 `document_content_access`,供两类内容入口复用:A 类直连入口(自带 `current_user`)逐个调用;B 类媒体令牌入口统一在 `/media-token` 签发端点收口。前端用户管理页加「用户组」Tab,图文档列表对受限文档显示锁图标并禁用预览/下载。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + pytest(后端);React + TypeScript + Vite(前端)。

> 设计依据: `docs/superpowers/specs/2026-06-25-document-group-permission-design.md`

---

## File Structure

**后端(新建)**
- `backend/app/crud_groups.py` — 组相关查询与内容访问判定助手
- `backend/app/routers/user_groups.py` — 用户组 CRUD + 成员管理 router
- `backend/tests/test_document_group_policy.py` — 策略单元测试
- `backend/tests/test_user_groups_api.py` — 用户组 API 与用户组归属测试
- `backend/tests/test_document_content_access.py` — 内容入口拦截测试
- `tools/backfill_document_creator.py` — creator_id 回填脚本

**后端(修改)**
- `permissions/permissions.json` — 加 `user_groups:read/manage`(随后跑生成器)
- `backend/app/models.py` — 3 张新表 + `Document.creator_id`
- `backend/app/schemas.py` — 用户组与文档分组相关 schema
- `backend/app/permissions/policies.py` — `check_object_policy` + `document_content_access` 策略
- `backend/app/routers/__init__.py`、`backend/app/main.py` — 注册 user_groups router
- `backend/app/routers/documents.py` — 创建/更新/读取/列表带 group_ids 与 creator_id;附件下载/列附件加拦截
- `backend/app/routers/users.py` — 用户组归属子资源
- `backend/app/routers/attachments_v2.py` — get/download/stream/media-token 加拦截

**前端(修改)**
- `frontend/src/services/api.ts` — `userGroupsApi`、usersApi 组归属、documentsApi 类型
- `frontend/src/pages/Users.tsx` — 用户/用户组 Tab + 组管理 + 用户编辑分配组
- `frontend/src/pages/Documents.tsx` — 关联用户组多选 + 锁图标/禁用按钮

---

## Task 1: 权限定义 — 新增 user_groups 权限

**Files:**
- Modify: `permissions/permissions.json`(users 块,约第 142-148 行附近)
- Generated: `backend/app/permissions/_generated.py`、`frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 在 permissions.json 的 users 权限块后追加两条权限**

在 `"users:import_export": ["admin"],` 之后加入:

```json
    "user_groups:read": ["admin"],
    "user_groups:manage": ["admin"],
```

- [ ] **Step 2: 重新生成权限常量**

Run: `python tools/gen_permissions.py`
Expected: 输出生成成功;`backend/app/permissions/_generated.py` 的 `PERMISSIONS` 中出现 `"user_groups:read"` 与 `"user_groups:manage"`。

- [ ] **Step 3: 验证生成产物**

Run: `grep -c "user_groups:" backend/app/permissions/_generated.py`
Expected: 输出 `2`

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(perm): 新增 user_groups:read/manage 权限"
```

---

## Task 2: 数据模型 — 3 张新表 + Document.creator_id

**Files:**
- Modify: `backend/app/models.py`(User 类后、Document 类内)

- [ ] **Step 1: 给 Document 增加 creator_id 列**

在 `backend/app/models.py` 的 `Document` 类中,`revision_parent_id` 行之后加入:

```python
    creator_id = Column(UUID(as_uuid=True), nullable=True)  # 文档创建者，支持"创建者始终可访问"
```

- [ ] **Step 2: 在文件末尾追加三张表**

在 `backend/app/models.py` 末尾追加:

```python
class UserGroup(Base):
    """用户组"""
    __tablename__ = "user_groups"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(64), unique=True, nullable=False)
    description = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserGroupMember(Base):
    """用户 ↔ 组（多对多）"""
    __tablename__ = "user_group_members"
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey('user_groups.id', ondelete='CASCADE'), primary_key=True)


class DocumentGroupLink(Base):
    """文档 ↔ 组（多对多）"""
    __tablename__ = "document_group_links"
    document_id = Column(UUID(as_uuid=True), ForeignKey('documents.id', ondelete='CASCADE'), primary_key=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey('user_groups.id', ondelete='CASCADE'), primary_key=True)
```

- [ ] **Step 3: 验证模型可被 create_all 建表（SQLite）**

Run: `cd backend && python -c "from app.database import Base; from app import models; print('user_groups' in Base.metadata.tables, 'user_group_members' in Base.metadata.tables, 'document_group_links' in Base.metadata.tables)"`
Expected: `True True True`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(model): 新增用户组三表与 documents.creator_id"
```

---

## Task 3: 策略层 — check_object_policy + document_content_access

**Files:**
- Modify: `backend/app/permissions/policies.py`
- Test: `backend/tests/test_document_group_policy.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_document_group_policy.py`:

```python
import uuid
import pytest
from types import SimpleNamespace
from fastapi import HTTPException
from app.permissions.policies import enforce_object_policy, check_object_policy


def _u(role, uid):
    return SimpleNamespace(role=role, id=uid)


def _doc(creator_id=None):
    return SimpleNamespace(id=uuid.uuid4(), creator_id=creator_id)


def test_admin_always_allowed():
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("admin", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids={g}) is True


def test_creator_always_allowed():
    uid = uuid.uuid4()
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("engineer", uid), _doc(creator_id=uid),
                               user_group_ids=set(), doc_group_ids={g}) is True


def test_unlinked_document_allows_everyone():
    assert check_object_policy("document_content_access", _u("guest", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids=set()) is True


def test_member_allowed_nonmember_denied():
    g = uuid.uuid4()
    member = _u("engineer", uuid.uuid4())
    nonmember = _u("engineer", uuid.uuid4())
    assert check_object_policy("document_content_access", member, _doc(),
                               user_group_ids={g}, doc_group_ids={g}) is True
    assert check_object_policy("document_content_access", nonmember, _doc(),
                               user_group_ids={uuid.uuid4()}, doc_group_ids={g}) is False


def test_enforce_raises_for_nonmember():
    g = uuid.uuid4()
    with pytest.raises(HTTPException):
        enforce_object_policy("document_content_access", _u("engineer", uuid.uuid4()), _doc(),
                              user_group_ids=set(), doc_group_ids={g})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_document_group_policy.py -v`
Expected: FAIL —— `check_object_policy` 无法导入 / 策略 `document_content_access` 未注册。

- [ ] **Step 3: 实现 check_object_policy 并注册策略**

编辑 `backend/app/permissions/policies.py`。把 `enforce_object_policy` 改为复用新的 `check_object_policy`,并在末尾注册新策略:

```python
def check_object_policy(name: str, user: User, obj, **ctx) -> bool:
    fn = _POLICY_FUNCS.get(name)
    if fn is None:
        raise KeyError(f"Unregistered object policy: {name}")
    return bool(fn(user, obj, **ctx))


def enforce_object_policy(name: str, user: User, obj, **ctx) -> None:
    if not check_object_policy(name, user, obj, **ctx):
        raise HTTPException(status_code=403, detail="无权操作该对象")
```

> 注意:删除原有的 `enforce_object_policy` 旧实现(第 15-20 行),用上面两个函数替换。`_POLICY_FUNCS`、`register_policy`、`_is_admin` 保持不变。

在文件末尾追加策略:

```python
@register_policy("document_content_access")
def _document_content_access(user, document, *, user_group_ids=frozenset(), doc_group_ids=frozenset(), **_) -> bool:
    if _is_admin(user):
        return True
    if getattr(document, "creator_id", None) == user.id:
        return True
    if not doc_group_ids:
        return True
    return bool(set(user_group_ids) & set(doc_group_ids))
```

- [ ] **Step 4: 把 check_object_policy 导出到 permissions 包**

编辑 `backend/app/permissions/__init__.py`:
- 第 5 行 import 改为:`from .policies import enforce_object_policy, register_policy, check_object_policy  # noqa: F401`
- `__all__` 列表追加 `"check_object_policy"`。

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_document_group_policy.py tests/test_object_policies.py -v`
Expected: PASS（新测试全过，且原有 object policy 测试不回归）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/permissions/policies.py backend/app/permissions/__init__.py backend/tests/test_document_group_policy.py
git commit -m "feat(perm): document_content_access 策略 + check_object_policy"
```

---

## Task 4: crud_groups — 组查询与内容访问助手

**Files:**
- Create: `backend/app/crud_groups.py`
- Test: `backend/tests/test_user_groups_api.py`(本任务先建文件，写助手层测试)

- [ ] **Step 1: 写失败测试（助手层）**

创建 `backend/tests/test_user_groups_api.py`:

```python
import uuid
from fastapi import HTTPException
import pytest
from app import models, crud_groups


def _doc(db, creator_id=None):
    d = models.Document(code=f"D{uuid.uuid4().hex[:6]}", name="图纸", creator_id=creator_id)
    db.add(d); db.commit(); db.refresh(d)
    return d


def _att(db, document_id):
    a = models.DocumentAttachment(document_id=document_id, file_name="a.pdf", file_path="x/a.pdf")
    db.add(a); db.commit(); db.refresh(a)
    return a


def _group(db, name):
    g = models.UserGroup(name=name)
    db.add(g); db.commit(); db.refresh(g)
    return g


def test_get_user_and_document_group_ids(db, engineer_user):
    g = _group(db, "G1")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    assert crud_groups.get_user_group_ids(db, engineer_user.id) == {g.id}
    assert crud_groups.get_document_group_ids(db, d.id) == {g.id}


def test_document_is_accessible_unlinked(db, guest_user):
    d = _doc(db)
    assert crud_groups.document_is_accessible(db, guest_user, d) is True


def test_document_is_accessible_member_vs_nonmember(db, engineer_user, guest_user):
    g = _group(db, "G2")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    assert crud_groups.document_is_accessible(db, engineer_user, d) is True
    assert crud_groups.document_is_accessible(db, guest_user, d) is False


def test_enforce_attachment_content_access(db, engineer_user, guest_user):
    g = _group(db, "G3")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    att = _att(db, d.id)
    crud_groups.enforce_attachment_content_access(db, engineer_user, att.id)  # 成员不抛
    with pytest.raises(HTTPException):
        crud_groups.enforce_attachment_content_access(db, guest_user, att.id)


def test_enforce_attachment_missing_is_silent(db, guest_user):
    crud_groups.enforce_attachment_content_access(db, guest_user, uuid.uuid4())  # 不存在 → 不抛
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_user_groups_api.py -v`
Expected: FAIL —— `app.crud_groups` 不存在。

- [ ] **Step 3: 实现 crud_groups.py**

创建 `backend/app/crud_groups.py`:

```python
"""用户组查询与图文档内容访问判定助手。"""
from sqlalchemy.orm import Session

from .models import UserGroupMember, DocumentGroupLink, Document, DocumentAttachment
from .permissions import enforce_object_policy, check_object_policy


def get_user_group_ids(db: Session, user_id) -> set:
    rows = db.query(UserGroupMember.group_id).filter(UserGroupMember.user_id == user_id).all()
    return {r[0] for r in rows}


def get_document_group_ids(db: Session, document_id) -> set:
    rows = db.query(DocumentGroupLink.group_id).filter(DocumentGroupLink.document_id == document_id).all()
    return {r[0] for r in rows}


def document_is_accessible(db: Session, user, document) -> bool:
    """不抛异常，返回布尔（用于列表 accessible 标记）。"""
    return check_object_policy(
        "document_content_access", user, document,
        user_group_ids=get_user_group_ids(db, user.id),
        doc_group_ids=get_document_group_ids(db, document.id),
    )


def enforce_document_content_access(db: Session, user, document) -> None:
    """不可访问则抛 403。"""
    enforce_object_policy(
        "document_content_access", user, document,
        user_group_ids=get_user_group_ids(db, user.id),
        doc_group_ids=get_document_group_ids(db, document.id),
    )


def enforce_attachment_content_access(db: Session, user, attachment_id) -> None:
    """由附件回溯父文档后判定。附件/文档缺失或无文档归属 → 放行（404 交由端点处理）。"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att or not att.document_id:
        return
    document = db.query(Document).filter(Document.id == att.document_id).first()
    if not document:
        return
    enforce_document_content_access(db, user, document)
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_user_groups_api.py -v`
Expected: PASS（5 个助手层测试全过）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_groups.py backend/tests/test_user_groups_api.py
git commit -m "feat(groups): crud_groups 组查询与内容访问助手"
```

---

## Task 5: schemas — 用户组与文档分组 schema

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: 追加用户组相关 schema**

在 `backend/app/schemas.py` 末尾追加(文件已 import `Optional`、`List`、`uuid`、`Field`、`BaseSchema`):

```python
# ── 用户组 ──
class UserGroupCreate(BaseSchema):
    name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = None


class UserGroupUpdate(BaseSchema):
    name: Optional[str] = None
    description: Optional[str] = None


class GroupMembersUpdate(BaseSchema):
    user_ids: List[uuid.UUID] = []


class UserGroupsUpdate(BaseSchema):
    group_ids: List[uuid.UUID] = []
```

- [ ] **Step 2: 给文档 schema 增加 group_ids**

修改 `DocumentCreate`(约第 272 行)与 `DocumentUpdate`(约第 275 行):

```python
class DocumentCreate(DocumentBase):
    id: Optional[uuid.UUID] = None
    group_ids: Optional[List[uuid.UUID]] = None

class DocumentUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    group_ids: Optional[List[uuid.UUID]] = None
```

- [ ] **Step 3: 验证 schema 可导入**

Run: `cd backend && python -c "from app import schemas; print(schemas.UserGroupCreate, schemas.GroupMembersUpdate, schemas.UserGroupsUpdate)"`
Expected: 打印三个类，无异常。

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(schema): 用户组与文档 group_ids schema"
```

---

## Task 6: user_groups router — 组 CRUD + 成员管理

**Files:**
- Create: `backend/app/routers/user_groups.py`
- Modify: `backend/app/routers/__init__.py`、`backend/app/main.py`
- Test: 追加到 `backend/tests/test_user_groups_api.py`

- [ ] **Step 1: 实现 user_groups router**

创建 `backend/app/routers/user_groups.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User, UserGroup, UserGroupMember, DocumentGroupLink
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/user-groups", tags=["用户组管理"])


def _group_dict(db, g):
    count = db.query(UserGroupMember).filter(UserGroupMember.group_id == g.id).count()
    return {"id": g.id, "name": g.name, "description": g.description,
            "member_count": count, "created_at": g.created_at, "updated_at": g.updated_at}


@router.get("/")
async def list_groups(db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:read"))):
    groups = db.query(UserGroup).order_by(UserGroup.name).all()
    return [_group_dict(db, g) for g in groups]


@router.post("/")
async def create_group(body: schemas.UserGroupCreate, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    if db.query(UserGroup).filter(UserGroup.name == body.name).first():
        raise HTTPException(status_code=400, detail="该用户组名称已存在")
    g = UserGroup(name=body.name, description=body.description)
    db.add(g); db.commit(); db.refresh(g)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建用户组", "user_group", str(g.id), f"名称:{g.name}", ip)
    return _group_dict(db, g)


@router.put("/{group_id}")
async def update_group(group_id: uuid.UUID, body: schemas.UserGroupUpdate, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    if body.name and body.name != g.name:
        if db.query(UserGroup).filter(UserGroup.name == body.name, UserGroup.id != group_id).first():
            raise HTTPException(status_code=400, detail="该用户组名称已存在")
        g.name = body.name
    if body.description is not None:
        g.description = body.description
    db.commit(); db.refresh(g)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新用户组", "user_group", str(group_id), None, ip)
    return _group_dict(db, g)


@router.delete("/{group_id}")
async def delete_group(group_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    name = g.name
    db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).delete()
    db.query(DocumentGroupLink).filter(DocumentGroupLink.group_id == group_id).delete()
    db.delete(g); db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除用户组", "user_group", str(group_id), f"名称:{name}", ip)
    return {"message": "用户组已删除"}


@router.get("/{group_id}/members")
async def get_members(group_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:read"))):
    rows = db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group_id).all()
    return {"user_ids": [r[0] for r in rows]}


@router.put("/{group_id}/members")
async def set_members(group_id: uuid.UUID, body: schemas.GroupMembersUpdate, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).delete()
    uids = set(body.user_ids)
    for uid in uids:
        db.add(UserGroupMember(user_id=uid, group_id=group_id))
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "设置用户组成员", "user_group", str(group_id), f"成员数:{len(uids)}", ip)
    return {"user_ids": list(uids)}
```

- [ ] **Step 2: 注册 router**

编辑 `backend/app/routers/__init__.py`:
- 在 `from .documents import router as documents_router` 之后加:`from .user_groups import router as user_groups_router`
- `__all__` 列表追加 `"user_groups_router"`

编辑 `backend/app/main.py`:
- 第 6 行的 `from .routers import (...)` 末尾追加 `user_groups_router`
- 在 `app.include_router(users_router, prefix="/api")` 之后加:`app.include_router(user_groups_router, prefix="/api")`

- [ ] **Step 3: 写 API 测试（用 TestClient 覆盖 CRUD + 成员）**

追加到 `backend/tests/test_user_groups_api.py` 末尾:

```python
from fastapi.testclient import TestClient


def _client(db, user):
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def test_group_crud_and_members_via_api(db, admin_user, engineer_user):
    client = _client(db, admin_user)
    try:
        # 建组
        r = client.post("/api/user-groups/", json={"name": "研发组", "description": "x"})
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        # 列表含 1 个组
        r = client.get("/api/user-groups/")
        assert r.status_code == 200 and len(r.json()) == 1
        # 改名
        r = client.put(f"/api/user-groups/{gid}", json={"name": "研发一组"})
        assert r.status_code == 200 and r.json()["name"] == "研发一组"
        # 设成员
        r = client.put(f"/api/user-groups/{gid}/members", json={"user_ids": [str(engineer_user.id)]})
        assert r.status_code == 200
        r = client.get(f"/api/user-groups/{gid}/members")
        assert str(engineer_user.id) in [str(x) for x in r.json()["user_ids"]]
        # 删组
        r = client.delete(f"/api/user-groups/{gid}")
        assert r.status_code == 200
        assert client.get("/api/user-groups/").json() == []
    finally:
        app.dependency_overrides.clear() if (app := __import__('app.main', fromlist=['app']).app) else None


def test_group_create_forbidden_for_non_admin(db, engineer_user):
    client = _client(db, engineer_user)
    try:
        from app.main import app
        r = client.post("/api/user-groups/", json={"name": "x"})
        assert r.status_code == 403
    finally:
        from app.main import app
        app.dependency_overrides.clear()
```

> 注:`require_permission` 内部依赖 `get_current_active_user`,覆盖后者即可绕过 JWT;角色由注入的 user 决定,403 逻辑仍真实执行。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_user_groups_api.py -v`
Expected: PASS（含 CRUD、成员设置、非管理员 403）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/user_groups.py backend/app/routers/__init__.py backend/app/main.py backend/tests/test_user_groups_api.py
git commit -m "feat(api): 用户组 CRUD 与成员管理 router"
```

---

## Task 7: users router — 用户组归属子资源

**Files:**
- Modify: `backend/app/routers/users.py`
- Test: 追加到 `backend/tests/test_user_groups_api.py`

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_user_groups_api.py` 末尾:

```python
def test_user_groups_subresource(db, admin_user, engineer_user):
    from app.main import app
    client = _client(db, admin_user)
    try:
        g = _group(db, "Gsub")
        # 初始为空
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert r.status_code == 200 and r.json()["group_ids"] == []
        # 设置归属
        r = client.put(f"/api/users/{engineer_user.id}/groups", json={"group_ids": [str(g.id)]})
        assert r.status_code == 200
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert str(g.id) in [str(x) for x in r.json()["group_ids"]]
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_user_groups_api.py::test_user_groups_subresource -v`
Expected: FAIL —— 404（端点不存在）。

- [ ] **Step 3: 实现子资源端点**

编辑 `backend/app/routers/users.py`。在文件顶部 import 区确保有 `from ..models import User, UserGroupMember`(若原本只 import User，则补上 UserGroupMember),并在文件末尾追加:

```python
@router.get("/{user_id}/groups")
async def get_user_groups(user_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("user_groups:read"))):
    rows = db.query(UserGroupMember.group_id).filter(UserGroupMember.user_id == user_id).all()
    return {"group_ids": [r[0] for r in rows]}


@router.put("/{user_id}/groups")
async def set_user_groups(user_id: uuid.UUID, body: schemas.UserGroupsUpdate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("user_groups:manage"))):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="用户不存在")
    db.query(UserGroupMember).filter(UserGroupMember.user_id == user_id).delete()
    gids = set(body.group_ids)
    for gid in gids:
        db.add(UserGroupMember(user_id=user_id, group_id=gid))
    db.commit()
    return {"group_ids": list(gids)}
```

> 若 `users.py` 顶部未 import `HTTPException` / `schemas` / `uuid`,一并补齐(参考同文件已有 import)。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_user_groups_api.py -v`
Expected: PASS（全部用户组相关测试）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/users.py backend/tests/test_user_groups_api.py
git commit -m "feat(api): 用户组归属子资源 GET/PUT /users/{id}/groups"
```

---

## Task 8: documents router — group_ids + creator_id 贯通

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_document_content_access.py`

- [ ] **Step 1: 写失败测试（文档接口带 group_ids / creator_id / accessible）**

创建 `backend/tests/test_document_content_access.py`:

```python
import uuid
from fastapi.testclient import TestClient
from app import models


def _client(db, user):
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _group(db, name):
    g = models.UserGroup(name=name)
    db.add(g); db.commit(); db.refresh(g)
    return g


def test_create_document_sets_creator_and_groups(db, engineer_user):
    from app.main import app
    client = _client(db, engineer_user)
    try:
        g = _group(db, "G")
        r = client.post("/api/documents/", json={"code": "DOC1", "name": "图纸", "group_ids": [str(g.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert str(body["creator_id"]) == str(engineer_user.id)
        assert [str(x) for x in body["group_ids"]] == [str(g.id)]
    finally:
        app.dependency_overrides.clear()


def test_list_marks_accessible_false_for_nonmember(db, engineer_user, guest_user):
    from app.main import app
    g = _group(db, "G2")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    # engineer 建一个关联组的文档
    client = _client(db, engineer_user)
    try:
        r = client.post("/api/documents/", json={"code": "DOC2", "name": "图纸", "group_ids": [str(g.id)]})
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()
    # guest 看列表：可见但 accessible=False
    client = _client(db, guest_user)
    try:
        r = client.get("/api/documents/")
        assert r.status_code == 200
        row = [d for d in r.json() if d["code"] == "DOC2"][0]
        assert row["accessible"] is False
        assert str(g.id) in [str(x) for x in row["group_ids"]]
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_document_content_access.py -v`
Expected: FAIL —— 响应缺 `creator_id`/`group_ids`/`accessible`。

- [ ] **Step 3: 修改 create_document**

编辑 `backend/app/routers/documents.py`。顶部 import 追加:`from . import crud_groups` 改为正确相对路径 `from .. import crud_groups`;并 import 模型 `DocumentGroupLink`(把第 10 行的 `from ..models import User, Document, DocumentAttachment, Part, Assembly` 改为追加 `, DocumentGroupLink`),以及 `from ..permissions import require_permission, check_object_policy`。

把 `create_document`(约第 141-163 行)函数体替换为:

```python
async def create_document(doc: schemas.DocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:create"))):
    existing = db.query(Document).filter(
        Document.code == doc.code,
        Document.version == doc.version,
        Document.deleted_at.is_(None),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该编号和版本的组合已存在")
    data = doc.model_dump()
    group_ids = data.pop("group_ids", None) or []
    d = Document(**data, creator_id=current_user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    for gid in set(group_ids):
        db.add(DocumentGroupLink(document_id=d.id, group_id=gid))
    if group_ids:
        db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建图文档", "document", str(d.id), f"编号:{d.code}", ip)
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "creator_id": d.creator_id,
        "group_ids": list(set(group_ids)),
        "created_at": d.created_at, "updated_at": d.updated_at,
    }
```

- [ ] **Step 4: 修改 update_document 支持 group_ids**

在 `update_document`(约第 196 行)的 `for field, value in body.model_dump(exclude_unset=True).items():` 循环**之前**插入对 group_ids 的处理,并在循环里跳过 group_ids:

```python
    update_data = body.model_dump(exclude_unset=True)
    group_ids = update_data.pop("group_ids", None)
    if group_ids is not None:
        db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id == doc_id).delete()
        for gid in set(group_ids):
            db.add(DocumentGroupLink(document_id=doc_id, group_id=gid))
    for field, value in update_data.items():
        setattr(d, field, value)
```

> 替换原来的 `for field, value in body.model_dump(exclude_unset=True).items(): setattr(...)` 两行。

并把 update_document 的返回 dict 追加 `"creator_id": d.creator_id, "group_ids": list(crud_groups.get_document_group_ids(db, d.id)),`。

- [ ] **Step 5: 修改 get_document 返回 group_ids + creator_id**

在 `get_document`(约第 165 行)返回 dict 中追加:

```python
        "creator_id": d.creator_id,
        "group_ids": list(crud_groups.get_document_group_ids(db, d.id)),
```

- [ ] **Step 6: 修改 list_documents 增加 accessible + group_ids（批量，避免 N+1）**

在 `list_documents`(约第 37 行 `docs = query...all()` 之后、return 之前)插入:

```python
    user_group_ids = crud_groups.get_user_group_ids(db, current_user.id)
    doc_ids = [d.id for d in docs]
    links = db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id.in_(doc_ids)).all() if doc_ids else []
    doc_groups = {}
    for l in links:
        doc_groups.setdefault(l.document_id, set()).add(l.group_id)

    def _accessible(d):
        return check_object_policy(
            "document_content_access", current_user, d,
            user_group_ids=user_group_ids,
            doc_group_ids=doc_groups.get(d.id, set()),
        )
```

并在**非 brief** 的返回列表(第 48-55 行那段)每个 dict 追加:

```python
        "accessible": _accessible(d),
        "group_ids": list(doc_groups.get(d.id, set())),
```

> brief 模式(同步用)保持不变。

- [ ] **Step 7: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_document_content_access.py -v`
Expected: PASS（creator_id/group_ids 写入与 accessible 标记）。

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_document_content_access.py
git commit -m "feat(documents): 创建/更新/读取/列表贯通 group_ids 与 creator_id/accessible"
```

---

## Task 9: 内容入口拦截 — A 类直连入口

**Files:**
- Modify: `backend/app/routers/documents.py`(download_attachment、list_attachments)
- Modify: `backend/app/routers/attachments_v2.py`(get_attachment、download、stream)
- Test: 追加到 `backend/tests/test_document_content_access.py`

- [ ] **Step 1: 写失败测试（直连入口非成员 403、成员/admin 放行）**

追加到 `backend/tests/test_document_content_access.py` 末尾:

```python
def _doc_with_group(db, creator, gid):
    d = models.Document(code=f"D{uuid.uuid4().hex[:6]}", name="图纸", creator_id=creator.id if creator else None)
    db.add(d); db.commit(); db.refresh(d)
    if gid:
        db.add(models.DocumentGroupLink(document_id=d.id, group_id=gid)); db.commit()
    return d


def _att(db, document_id):
    a = models.DocumentAttachment(document_id=document_id, file_name="a.pdf", file_path="x/a.pdf")
    db.add(a); db.commit(); db.refresh(a)
    return a


def test_documents_download_attachment_blocks_nonmember(db, admin_user, guest_user):
    from app.main import app
    g = _group(db, "Gd")
    d = _doc_with_group(db, admin_user, g.id)   # creator=admin, 关联 Gd
    att = _att(db, d.id)
    client = _client(db, guest_user)            # guest 非成员
    try:
        r = client.get(f"/api/documents/{d.id}/attachments/{att.id}")
        assert r.status_code == 403
        r = client.get(f"/api/documents/{d.id}/attachments/")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_v2_download_stream_get_block_nonmember(db, admin_user, guest_user):
    from app.main import app
    g = _group(db, "Gv")
    d = _doc_with_group(db, admin_user, g.id)
    att = _att(db, d.id)
    client = _client(db, guest_user)
    try:
        assert client.get(f"/api/v2/attachments/{att.id}").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/download").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/stream").status_code == 403
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_document_content_access.py::test_documents_download_attachment_blocks_nonmember tests/test_document_content_access.py::test_v2_download_stream_get_block_nonmember -v`
Expected: FAIL —— 当前返回 200/404 而非 403（注:guest 默认无 `attachments:list` 权限,get_attachment 可能先 403,这是可接受的拦截结果；download/stream guest 有权限,会暴露为非 403 失败）。

- [ ] **Step 3: 在 documents.py 两个端点加拦截**

在 `download_attachment`(约第 331 行)里,`att` 存在性检查之后、读取文件之前插入:

```python
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if doc:
        crud_groups.enforce_document_content_access(db, current_user, doc)
```

在 `list_attachments`(约第 354 行)函数体开头插入:

```python
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if doc:
        crud_groups.enforce_document_content_access(db, current_user, doc)
```

- [ ] **Step 4: 在 attachments_v2.py 三个直连端点加拦截**

编辑 `backend/app/routers/attachments_v2.py`,顶部 import 追加 `from .. import crud_groups`。

在 `get_attachment`(约第 410 行)、`download_attachment`(约第 439 行)、`stream_attachment`(约第 472 行)三处,各自在 `att = db.query(...).first()` 取得并通过非空检查之后插入:

```python
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)
```

> 三处都在 `if not att: raise 404` 之后插入即可（`enforce_attachment_content_access` 自身对缺失附件静默放行，但此处 att 已存在）。

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_document_content_access.py -v`
Expected: PASS（直连入口非成员全部 403）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/documents.py backend/app/routers/attachments_v2.py backend/tests/test_document_content_access.py
git commit -m "feat(perm): A 类直连入口加图文档分组拦截"
```

---

## Task 10: 内容入口拦截 — B 类媒体令牌入口

**Files:**
- Modify: `backend/app/routers/attachments_v2.py`(issue_media_token)
- Test: 追加到 `backend/tests/test_document_content_access.py`

- [ ] **Step 1: 写失败测试（非成员拿不到令牌、成员可拿）**

追加到 `backend/tests/test_document_content_access.py` 末尾:

```python
def test_media_token_denied_for_nonmember_allowed_for_member(db, admin_user, engineer_user, guest_user):
    from app.main import app
    g = _group(db, "Gt")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc_with_group(db, admin_user, g.id)
    att = _att(db, d.id)
    # 非成员 guest：拒签
    client = _client(db, guest_user)
    try:
        r = client.get(f"/api/v2/attachments/{att.id}/media-token", params={"action": "preview"})
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()
    # 成员 engineer：可签
    client = _client(db, engineer_user)
    try:
        r = client.get(f"/api/v2/attachments/{att.id}/media-token", params={"action": "preview"})
        assert r.status_code == 200 and "token" in r.json()
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_document_content_access.py::test_media_token_denied_for_nonmember_allowed_for_member -v`
Expected: FAIL —— guest 当前能拿到令牌(200)。

- [ ] **Step 3: 在 issue_media_token 加拦截**

编辑 `backend/app/routers/attachments_v2.py` 的 `issue_media_token`(约第 512 行)。在 `if not has_permission(...): raise 403` 之后、`return {"token": ...}` 之前插入:

```python
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)
```

> 该函数当前签名无 `db`。需给 `issue_media_token` 增加 `db: Session = Depends(get_db)` 参数(确认文件顶部已 import `get_db` 与 `Session`;若无则补 `from ..database import get_db`、`from sqlalchemy.orm import Session`)。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_document_content_access.py -v`
Expected: PASS（令牌签发对非成员 403、成员 200）。

- [ ] **Step 5: 回归全部后端测试**

Run: `cd backend && python -m pytest -q`
Expected: 全绿(新增测试通过，既有测试无回归)。

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/attachments_v2.py backend/tests/test_document_content_access.py
git commit -m "feat(perm): B 类媒体令牌入口在 media-token 端点收口拦截"
```

---

## Task 11: creator_id 回填脚本

**Files:**
- Create: `tools/backfill_document_creator.py`
- Test: 追加到 `backend/tests/test_document_content_access.py`(对回填核心函数做单测)

- [ ] **Step 1: 写失败测试（回填函数幂等）**

追加到 `backend/tests/test_document_content_access.py` 末尾:

```python
def test_backfill_creator_from_logs(db, engineer_user):
    import importlib.util, pathlib
    # 一个无 creator 的文档 + 一条创建日志
    d = models.Document(code="BF1", name="图纸", creator_id=None)
    db.add(d); db.commit(); db.refresh(d)
    db.add(models.OperationLog(user_id=engineer_user.id, username="eng",
                               action="创建图文档", target_type="document", target_id=str(d.id)))
    db.commit()
    # 加载回填模块并执行核心函数
    spec = importlib.util.spec_from_file_location(
        "backfill_document_creator",
        str(pathlib.Path(__file__).resolve().parents[2] / "tools" / "backfill_document_creator.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    n1 = mod.backfill(db)
    assert n1 == 1
    db.refresh(d)
    assert d.creator_id == engineer_user.id
    # 幂等：再跑回填 0 条
    assert mod.backfill(db) == 0
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && python -m pytest tests/test_document_content_access.py::test_backfill_creator_from_logs -v`
Expected: FAIL —— 文件不存在。

- [ ] **Step 3: 实现回填脚本**

创建 `tools/backfill_document_creator.py`:

```python
#!/usr/bin/env python3
"""从 operation_logs 回填 documents.creator_id（幂等）。

仅处理 creator_id 为空的文档；按最早一条"创建图文档"日志取 user_id。
找不到日志的文档保持空置。

Run（容器内或配好 DATABASE_URL 后）: python tools/backfill_document_creator.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.models import Document, OperationLog  # noqa: E402


def backfill(db) -> int:
    docs = db.query(Document).filter(Document.creator_id.is_(None)).all()
    filled = 0
    for d in docs:
        log = (db.query(OperationLog)
               .filter(OperationLog.target_type == "document",
                       OperationLog.target_id == str(d.id),
                       OperationLog.action == "创建图文档")
               .order_by(OperationLog.created_at.asc())
               .first())
        if log and log.user_id:
            d.creator_id = log.user_id
            filled += 1
    db.commit()
    return filled


def main():
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        n = backfill(db)
        print(f"✓ backfilled creator_id for {n} document(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && python -m pytest tests/test_document_content_access.py::test_backfill_creator_from_logs -v`
Expected: PASS（回填 1 条 + 幂等 0 条）。

- [ ] **Step 5: Commit**

```bash
git add tools/backfill_document_creator.py backend/tests/test_document_content_access.py
git commit -m "feat(tools): documents.creator_id 日志回填脚本(幂等)"
```

---

## Task 12: 前端 — API 客户端

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 新增 userGroupsApi 并扩展 usersApi**

在 `frontend/src/services/api.ts` 的 `usersApi`(约第 157 行)中追加两个方法,并在其后新增 `userGroupsApi`:

```typescript
export const usersApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; skip?: number; limit?: number }) =>
    api.get('/users/', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: unknown) => api.post('/users/', data),
  update: (id: string, data: unknown) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  getGroups: (id: string) => api.get(`/users/${id}/groups`),
  setGroups: (id: string, groupIds: string[]) => api.put(`/users/${id}/groups`, { group_ids: groupIds }),
};

// 用户组 API
export const userGroupsApi = {
  list: () => api.get('/user-groups/'),
  create: (data: { name: string; description?: string }) => api.post('/user-groups/', data),
  update: (id: string, data: { name?: string; description?: string }) => api.put(`/user-groups/${id}`, data),
  delete: (id: string) => api.delete(`/user-groups/${id}`),
  getMembers: (id: string) => api.get(`/user-groups/${id}/members`),
  setMembers: (id: string, userIds: string[]) => api.put(`/user-groups/${id}/members`, { user_ids: userIds }),
};
```

- [ ] **Step 2: 验证前端可编译（类型检查）**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误(若仓库既有无关报错，确认未新增与 api.ts 相关错误)。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(fe): userGroupsApi 与 usersApi 组归属方法"
```

---

## Task 13: 前端 — 用户管理页 Tab 与用户组管理

**Files:**
- Modify: `frontend/src/pages/Users.tsx`

> 本任务在现有 `Users.tsx` 顶部加「用户」「用户组」两个 Tab;「用户组」Tab 内做组的增删改与成员分配;用户编辑弹窗增加「所属组」多选。沿用项目现有 `primary-*` 配色、共享 Modal 与表格/工具栏风格(见 spec §7.1 与记忆 ui-style-consistency)。

- [ ] **Step 1: 读取现有结构以对齐风格**

Run: `sed -n '1,120p' frontend/src/pages/Users.tsx`
确认:共享 Modal 组件的引入方式、表格类名、工具栏按钮类名、`usersApi` 用法,后续新代码必须沿用。

- [ ] **Step 2: 引入 userGroupsApi 与 Tab 状态**

在 `Users.tsx` 顶部 import 加入 `userGroupsApi`(与现有 `usersApi` 同处引入)。在组件状态区加入:

```typescript
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');
  const [groups, setGroups] = useState<Array<{ id: string; name: string; description?: string; member_count: number }>>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; description?: string } | null>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [memberModalGroupId, setMemberModalGroupId] = useState<string | null>(null);
  const [memberSelectedIds, setMemberSelectedIds] = useState<string[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
```

- [ ] **Step 3: 加载用户组数据**

新增加载函数,并在进入 groups Tab 时调用:

```typescript
  const loadGroups = async () => {
    const res = await userGroupsApi.list();
    setGroups(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    if (activeTab === 'groups') loadGroups();
  }, [activeTab]);
```

- [ ] **Step 4: 渲染 Tab 切换栏**

在页面主体最上方(标题/工具栏之上)加入 Tab 栏,沿用项目按钮高亮风格:

```tsx
  <div className="flex gap-2 mb-4 border-b border-gray-200">
    <button
      className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'users' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
      onClick={() => setActiveTab('users')}
    >用户</button>
    <button
      className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'groups' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
      onClick={() => setActiveTab('groups')}
    >用户组</button>
  </div>
```

把现有用户列表主体包进 `{activeTab === 'users' && ( ... )}`。

- [ ] **Step 5: 渲染用户组 Tab 主体（列表 + 增删改 + 成员入口）**

在 Tab 栏之后加入:

```tsx
  {activeTab === 'groups' && (
    <div>
      <div className="flex justify-end mb-3">
        <button
          className="px-3 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700"
          onClick={() => { setEditingGroup(null); setGroupForm({ name: '', description: '' }); setGroupModalOpen(true); }}
        >新建用户组</button>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead><tr>
          <th className="px-4 py-2 text-left text-sm text-gray-500">名称</th>
          <th className="px-4 py-2 text-left text-sm text-gray-500">描述</th>
          <th className="px-4 py-2 text-left text-sm text-gray-500">成员数</th>
          <th className="px-4 py-2 text-left text-sm text-gray-500">操作</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {groups.map((g) => (
            <tr key={g.id}>
              <td className="px-4 py-2">{g.name}</td>
              <td className="px-4 py-2 text-gray-600">{g.description || '-'}</td>
              <td className="px-4 py-2">{g.member_count}</td>
              <td className="px-4 py-2 space-x-2">
                <button className="text-primary-600 hover:underline" onClick={() => openMembers(g.id)}>成员</button>
                <button className="text-primary-600 hover:underline" onClick={() => { setEditingGroup(g); setGroupForm({ name: g.name, description: g.description || '' }); setGroupModalOpen(true); }}>编辑</button>
                <button className="text-red-600 hover:underline" onClick={() => removeGroup(g.id)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
```

- [ ] **Step 6: 实现组的保存/删除/成员处理函数**

```typescript
  const saveGroup = async () => {
    if (editingGroup) await userGroupsApi.update(editingGroup.id, groupForm);
    else await userGroupsApi.create(groupForm);
    setGroupModalOpen(false);
    await loadGroups();
  };

  const removeGroup = async (id: string) => {
    if (!window.confirm('确定删除该用户组？文档将恢复为全员可访问。')) return;
    await userGroupsApi.delete(id);
    await loadGroups();
  };

  const openMembers = async (groupId: string) => {
    const res = await userGroupsApi.getMembers(groupId);
    setMemberSelectedIds((res.data?.user_ids || []).map((x: string) => String(x)));
    setMemberModalGroupId(groupId);
  };

  const saveMembers = async () => {
    if (!memberModalGroupId) return;
    await userGroupsApi.setMembers(memberModalGroupId, memberSelectedIds);
    setMemberModalGroupId(null);
    await loadGroups();
  };
```

- [ ] **Step 7: 渲染组编辑弹窗与成员弹窗（沿用现有 Modal）**

用项目现有共享 Modal 组件渲染两个弹窗。组编辑弹窗含 `name`(必填)与 `description` 两个输入,底部「取消 / 保存」(保存调 `saveGroup`)。成员弹窗列出全部 `users`,每行一个 checkbox 绑定 `memberSelectedIds`(选中切换增删 id),底部「取消 / 保存」(保存调 `saveMembers`)。

```tsx
  {/* 成员弹窗示意（用现有 Modal 包裹） */}
  {memberModalGroupId && (
    <div className="max-h-80 overflow-auto">
      {users.map((u) => (
        <label key={u.id} className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            checked={memberSelectedIds.includes(String(u.id))}
            onChange={(e) => setMemberSelectedIds((prev) =>
              e.target.checked ? [...prev, String(u.id)] : prev.filter((x) => x !== String(u.id)))}
          />
          <span>{u.real_name}（{u.username}）</span>
        </label>
      ))}
    </div>
  )}
```

- [ ] **Step 8: 用户编辑弹窗增加「所属组」多选**

在现有用户编辑弹窗打开时加载该用户的组,保存用户后同步写回:
- 打开编辑(已有 `editingUser` 流程)时:`const gr = await usersApi.getGroups(user.id); setUserGroupIds((gr.data?.group_ids||[]).map(String));`(`userGroupIds` 状态已在 Step 2 声明;新建用户时置 `[]`)。
- 在用户表单里加入一段与成员弹窗相同结构的「所属组」多选(遍历 `groups`,checkbox 绑定 `userGroupIds`)。若 `groups` 为空,进入用户 Tab 时也加载一次:在 `loadUsers` 后追加 `loadGroups()`,或在组件挂载时 `loadGroups()`。
- 保存用户成功后:`await usersApi.setGroups(savedUserId, userGroupIds);`(`savedUserId` 取更新的 `editingUser.id` 或创建返回的 `id`)。

- [ ] **Step 9: 前端编译验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/Users.tsx
git commit -m "feat(fe): 用户管理页加用户组 Tab 与组成员/用户组归属管理"
```

---

## Task 14: 前端 — 图文档关联用户组与受限标识

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`

> 新建/编辑弹窗加「关联用户组」多选;列表对 `accessible === false` 的行显示锁图标并禁用预览/下载按钮。

- [ ] **Step 1: 读取现有结构**

Run: `grep -n "accessible\|group_ids\|预览\|下载\|preview\|download\|Modal\|interface\|useState" frontend/src/pages/Documents.tsx | head -50`
确认:文档表单的状态结构、预览/下载按钮所在处的渲染、文档列表项类型,后续改动沿用。

- [ ] **Step 2: 加载用户组供多选**

在 `Documents.tsx` 顶部 import `userGroupsApi`。新增状态与加载:

```typescript
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [formGroupIds, setFormGroupIds] = useState<string[]>([]);

  useEffect(() => {
    userGroupsApi.list().then((res) => setAllGroups(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);
```

- [ ] **Step 3: 打开新建/编辑时初始化 formGroupIds**

- 新建:`setFormGroupIds([]);`
- 编辑:从文档详情读取 `group_ids`(`documentsApi.get(id)` 返回含 `group_ids`),`setFormGroupIds((d.group_ids||[]).map(String));`

- [ ] **Step 4: 表单里渲染「关联用户组」多选**

在文档表单(编号/名称等字段附近)加入:

```tsx
  <div className="mb-3">
    <label className="block text-sm text-gray-600 mb-1">关联用户组（留空=全员可预览/下载）</label>
    <div className="max-h-32 overflow-auto border border-gray-200 rounded p-2">
      {allGroups.length === 0 && <span className="text-gray-400 text-sm">暂无用户组</span>}
      {allGroups.map((g) => (
        <label key={g.id} className="flex items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={formGroupIds.includes(String(g.id))}
            onChange={(e) => setFormGroupIds((prev) =>
              e.target.checked ? [...prev, String(g.id)] : prev.filter((x) => x !== String(g.id)))}
          />
          <span className="text-sm">{g.name}</span>
        </label>
      ))}
    </div>
  </div>
```

- [ ] **Step 5: 保存时带上 group_ids**

在文档创建/更新提交的 payload 中加入 `group_ids: formGroupIds`(create 与 update 都传)。

- [ ] **Step 6: 列表受限标识 + 禁用按钮**

在文档列表行的预览/下载按钮处,基于该行 `accessible` 字段(默认 `true` 兜底)渲染:

```tsx
  {row.accessible === false ? (
    <span className="inline-flex items-center gap-1 text-gray-400" title="无权限：需关联用户组成员">
      🔒
      <button className="text-gray-300 cursor-not-allowed" disabled>预览</button>
      <button className="text-gray-300 cursor-not-allowed" disabled>下载</button>
    </span>
  ) : (
    /* 现有的预览/下载按钮原样保留 */
  )}
```

> 把现有预览/下载按钮原样放进 `: ( ... )` 分支,不改其行为。

- [ ] **Step 7: 前端编译验证**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Documents.tsx
git commit -m "feat(fe): 图文档关联用户组多选与受限文档锁标识/禁用按钮"
```

---

## Task 15: 全量验证

**Files:** 无(仅运行验证)

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && python -m pytest -q`
Expected: 全绿。

- [ ] **Step 2: 前端构建**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 3: Docker 起栈手测（按 spec §10 验收清单逐项）**

Run: `docker compose up -d --build`
然后按 spec §10 验收清单手测:未关联组全员可下载;关联组成员可、非成员锁定;admin/创建者不受限;零部件引用的受限图纸预览/下载被拦截;用户组两边可改;重启自动建表。

- [ ] **Step 4: 回填脚本（在已有数据的环境执行一次）**

Run: `docker compose exec backend python tools/backfill_document_creator.py`
Expected: 输出 `✓ backfilled creator_id for N document(s)`。

- [ ] **Step 5: 最终提交（如有手测微调）**

```bash
git add -A
git commit -m "chore: 图文档分组权限功能联调收尾"
```

---

## Self-Review 备注

- **Spec 覆盖**:§3 模型→Task 2;§3.3 回填→Task 11;§4 判定→Task 3/4;§5 A 类入口→Task 9、B 类→Task 10;§6.1 组 API→Task 6、§6.2 用户组归属→Task 7、§6.3 文档接口→Task 8;§7.1 用户页→Task 13、§7.2 文档页→Task 14;§8 迁移→自动机制 + Task 11;§9 测试→各任务内 + Task 15。
- **类型一致**:策略名统一 `document_content_access`;助手 `enforce_document_content_access` / `enforce_attachment_content_access` / `document_is_accessible` / `get_user_group_ids` / `get_document_group_ids` 在 Task 4 定义、Task 8/9/10 引用一致;前端 `userGroupsApi` 方法名(list/create/update/delete/getMembers/setMembers)与 usersApi `getGroups/setGroups` 在 Task 12 定义、Task 13/14 引用一致。
