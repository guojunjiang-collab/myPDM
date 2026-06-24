# 项目管理模块 第1期 实施计划(项目骨架 + WBS 任务)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 myPDM 上新增"项目管理"模块第 1 期:轻量项目容器 + 无限深度 WBS 任务树,任务可指派、跟踪状态、关联 PDM 对象(零部件/构型项/EC/图文档)、上传附件、添加评论。

**Architecture:** 后端沿用现有领域模块模式(`models_project.py` / `schemas_project.py` / `crud_project.py` / `routers/projects.py`),建表走 `main.py` 启动时 `Base.metadata.create_all` 自动建表 + 通用列对账。权限走 `permissions/permissions.json` 单一事实源 + `gen_permissions.py` 生成 + `policies.py` 对象级策略。前端新增 `pages/Project/`,复用 `Modal`、现有 Picker、`can()` 权限判定,axios 服务文件。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + PostgreSQL(测试用 SQLite 内存库);React 18 + TypeScript + Vite + Tailwind + Zustand + Axios。

参考设计文档:`docs/superpowers/specs/2026-06-24-project-management-phase1-design.md`

---

## 文件结构总览

**后端(新增)**
- `backend/app/models_project.py` — Project / ProjectMember / ProjectTask / ProjectTaskLink / ProjectTaskComment
- `backend/app/schemas_project.py` — Pydantic 请求/响应 schema
- `backend/app/crud_project.py` — 项目/成员/任务/关联/评论 CRUD + 树组装 + 编号生成
- `backend/app/routers/projects.py` — API 路由
- `backend/tests/test_project_models.py` / `test_project_crud.py` / `test_project_policies.py` — 测试

**后端(修改)**
- `backend/app/main.py` — 注册路由 + 在通用列对账块导入 `app.models_project`
- `permissions/permissions.json` — 新增权限项
- `backend/app/permissions/policies.py` — 新增对象级策略

**前端(新增)**
- `frontend/src/services/projectApi.ts` — API 客户端
- `frontend/src/stores/project.ts` — Zustand 状态
- `frontend/src/pages/Project/Projects.tsx` — 项目列表页
- `frontend/src/pages/Project/ProjectWorkspace.tsx` — 项目任务工作区(树形表格)
- `frontend/src/pages/Project/TaskEditModal.tsx` — 任务编辑弹窗(字段+关联+附件+评论)
- `frontend/src/pages/Project/MemberManageModal.tsx` — 项目成员管理弹窗
- `frontend/src/components/ECPicker.tsx` — EC(ECR/ECO)选择器
- `frontend/src/types/project.ts` — TS 类型

**前端(修改)**
- `frontend/src/App.tsx` — 路由
- `frontend/src/components/Layout.tsx` — 导航项

---

## Task 1: 权限定义与对象级策略

**Files:**
- Modify: `permissions/permissions.json`
- Modify: `backend/app/permissions/policies.py`
- Test: `backend/tests/test_project_policies.py`

- [ ] **Step 1: 在 permissions.json 新增权限项**

在 `permissions/permissions.json` 的 `"permissions"` 对象内、`"inventory.doc:post"` 行之后(或任意合适位置)加入:

```json
    "project:read": ["admin", "engineer", "production", "guest"],
    "project:create": ["admin", "engineer"],
    "project:update": { "roles": ["admin", "engineer"], "object_policy": "project_manager_or_admin" },
    "project:delete": { "roles": ["admin", "engineer"], "object_policy": "project_manager_or_admin" },
    "project.member:manage": { "roles": ["admin", "engineer"], "object_policy": "project_manager_or_admin" },
    "project.task:create": { "roles": ["admin", "engineer", "production"], "object_policy": "project_manager_or_admin" },
    "project.task:update": { "roles": ["admin", "engineer", "production"], "object_policy": "project_manager_or_admin" },
    "project.task:update_status": ["admin", "engineer", "production"],
    "project.task:delete": { "roles": ["admin", "engineer", "production"], "object_policy": "project_manager_or_admin" },
    "project.task:link": ["admin", "engineer", "production"],
    "project.task:comment": ["admin", "engineer", "production", "guest"],
```

> 说明:`project:read` 角色放开,但**实际可见性由"项目成员"在 CRUD 层过滤**(见 Task 4)。`project.task:update_status`、`project.task:link`、`project.task:comment` 用角色级 + CRUD 层成员/负责人校验(因策略需要"任务所属项目成员"上下文,放在 CRUD 更直接)。

- [ ] **Step 2: 生成权限代码**

Run:
```bash
cd D:/OpenCode/myPDM && python tools/gen_permissions.py
```
Expected: 终端打印生成成功;`backend/app/permissions/_generated.py` 与 `frontend/src/constants/permissions.generated.ts` 出现上述新权限键。

- [ ] **Step 3: 写对象级策略的失败测试**

创建 `backend/tests/test_project_policies.py`:

```python
import uuid
from app.permissions.policies import _POLICY_FUNCS


class _FakeUser:
    def __init__(self, role, uid=None):
        self.role = role
        self.id = uid or uuid.uuid4()


class _FakeProject:
    def __init__(self, owner_id):
        self.owner_id = owner_id


def test_project_manager_or_admin_policy_registered():
    assert "project_manager_or_admin" in _POLICY_FUNCS


def test_owner_passes_admin_passes_others_fail():
    fn = _POLICY_FUNCS["project_manager_or_admin"]
    owner = _FakeUser("engineer")
    proj = _FakeProject(owner_id=owner.id)
    assert fn(owner, proj) is True                      # 项目负责人
    assert fn(_FakeUser("admin"), proj) is True         # 管理员
    assert fn(_FakeUser("engineer"), proj) is False     # 其他工程师
```

- [ ] **Step 4: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_policies.py -v
```
Expected: FAIL,`KeyError: project_manager_or_admin` 或断言失败(策略未注册)。

- [ ] **Step 5: 注册对象级策略**

在 `backend/app/permissions/policies.py` 末尾追加:

```python
@register_policy("project_manager_or_admin")
def _project_manager_or_admin(user, project, **_) -> bool:
    return _is_admin(user) or getattr(project, "owner_id", None) == user.id
```

- [ ] **Step 6: 运行测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_policies.py -v
```
Expected: PASS。

- [ ] **Step 7: 运行权限同步测试**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_permissions_sync.py -v
```
Expected: PASS(确认 permissions.json 与生成文件一致)。若失败,重跑 Step 2 后再测。

- [ ] **Step 8: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts backend/app/permissions/policies.py backend/tests/test_project_policies.py
git commit -m "feat(project): 新增项目管理权限项与对象级策略"
```

---

## Task 2: 数据模型

**Files:**
- Create: `backend/app/models_project.py`
- Modify: `backend/app/main.py:494`(在导入模型模块处加入 `import app.models_project`)
- Test: `backend/tests/test_project_models.py`

- [ ] **Step 1: 写模型的失败测试**

创建 `backend/tests/test_project_models.py`:

```python
import uuid
from app import models_project  # noqa: F401
from app.models_project import Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment


def test_project_and_task_tree_insert(db):
    p = Project(code="PRJ-001", name="X300 整机研发", owner_id=uuid.uuid4())
    db.add(p); db.commit(); db.refresh(p)
    assert p.id is not None and p.status == "进行中" and p.deleted_at is None

    root = ProjectTask(project_id=p.id, code="PRJ-001-01", name="方案设计阶段")
    db.add(root); db.commit(); db.refresh(root)
    assert root.task_type == "任务" and root.status == "未开始" and root.priority == "中"

    child = ProjectTask(project_id=p.id, parent_id=root.id, code="PRJ-001-02", name="BOM 搭建")
    db.add(child); db.commit(); db.refresh(child)
    assert child.parent_id == root.id


def test_member_link_comment_insert(db):
    pid = uuid.uuid4(); uid = uuid.uuid4(); tid = uuid.uuid4()
    db.add(ProjectMember(project_id=pid, user_id=uid, role_in_project="经理"))
    db.add(ProjectTaskLink(task_id=tid, entity_type="part", entity_id=uuid.uuid4()))
    db.add(ProjectTaskComment(task_id=tid, user_id=uid, content="第一条评论"))
    db.commit()
    assert db.query(ProjectMember).count() == 1
    assert db.query(ProjectTaskLink).count() == 1
    assert db.query(ProjectTaskComment).count() == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_models.py -v
```
Expected: FAIL,`ModuleNotFoundError: No module named 'app.models_project'`。

- [ ] **Step 3: 创建模型文件**

创建 `backend/app/models_project.py`:

```python
"""
项目管理 - SQLAlchemy Models
============================
项目容器 / 项目成员 / 任务(自引用树) / 任务关联对象 / 任务评论
"""
import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class Project(Base):
    __tablename__ = "projects"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(16), nullable=False, default="进行中")  # 进行中/已完成/已暂停/已归档
    planned_start = Column(String(32), nullable=True)
    planned_end = Column(String(32), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ProjectMember(Base):
    __tablename__ = "project_members"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role_in_project = Column(String(8), nullable=False, default="成员")  # 经理/成员
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectTask(Base):
    __tablename__ = "project_tasks"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id"), nullable=True)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    task_type = Column(String(8), nullable=False, default="任务")     # 任务/里程碑/评审
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(8), nullable=False, default="未开始")       # 未开始/进行中/已完成/挂起
    priority = Column(String(4), nullable=False, default="中")        # 高/中/低
    planned_start = Column(String(32), nullable=True)
    planned_end = Column(String(32), nullable=True)
    actual_start = Column(String(32), nullable=True)
    actual_end = Column(String(32), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ProjectTaskLink(Base):
    __tablename__ = "project_task_links"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String(16), nullable=False)  # part/assembly/config_item/ec/document
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectTaskComment(Base):
    __tablename__ = "project_task_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_models.py -v
```
Expected: PASS。

- [ ] **Step 5: 在 main.py 启动迁移块导入新模型模块**

在 `backend/app/main.py` 的通用列对账 try 块内,与其他 `import app.models_*` 并列处(约第 494 行 `import app.models_inventory  # noqa: F401` 之后)加入一行:

```python
            import app.models_project  # noqa: F401
```

> 这样 `Base.metadata.create_all(bind=engine)`(同块内已调用)会自动创建 5 张新表,通用列对账也会覆盖后续新增列,无需手写 CREATE TABLE。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models_project.py backend/app/main.py backend/tests/test_project_models.py
git commit -m "feat(project): 新增项目/成员/任务/关联/评论数据模型"
```

---

## Task 3: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas_project.py`
- Test: `backend/tests/test_project_crud.py`(本任务先建文件骨架,后续任务补充)

- [ ] **Step 1: 创建 schema 文件**

创建 `backend/app/schemas_project.py`:

```python
"""项目管理 - Pydantic Schemas"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal, List
from datetime import datetime


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 项目 ----
class ProjectCreate(BaseSchema):
    name: str = Field(..., max_length=255)
    status: Literal["进行中", "已完成", "已暂停", "已归档"] = "进行中"
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: Optional[str] = None
    member_user_ids: List[str] = []   # 创建时附带成员(创建者自动成为经理)


class ProjectEdit(BaseSchema):
    name: Optional[str] = None
    status: Optional[Literal["进行中", "已完成", "已暂停", "已归档"]] = None
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: Optional[str] = None


# ---- 成员 ----
class MemberAdd(BaseSchema):
    user_id: str
    role_in_project: Literal["经理", "成员"] = "成员"


# ---- 任务 ----
class TaskCreate(BaseSchema):
    name: str = Field(..., max_length=255)
    parent_id: Optional[str] = None
    task_type: Literal["任务", "里程碑", "评审"] = "任务"
    assignee_id: Optional[str] = None
    status: Literal["未开始", "进行中", "已完成", "挂起"] = "未开始"
    priority: Literal["高", "中", "低"] = "中"
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    actual_start: Optional[str] = None
    actual_end: Optional[str] = None
    description: Optional[str] = None


class TaskEdit(BaseSchema):
    name: Optional[str] = None
    task_type: Optional[Literal["任务", "里程碑", "评审"]] = None
    assignee_id: Optional[str] = None
    status: Optional[Literal["未开始", "进行中", "已完成", "挂起"]] = None
    priority: Optional[Literal["高", "中", "低"]] = None
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    actual_start: Optional[str] = None
    actual_end: Optional[str] = None
    description: Optional[str] = None


class TaskStatusUpdate(BaseSchema):
    status: Literal["未开始", "进行中", "已完成", "挂起"]


class TaskMove(BaseSchema):
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


# ---- 关联对象 ----
class TaskLinkAdd(BaseSchema):
    entity_type: Literal["part", "assembly", "config_item", "ec", "document"]
    entity_id: str


# ---- 评论 ----
class CommentAdd(BaseSchema):
    content: str = Field(..., min_length=1)
```

- [ ] **Step 2: 验证 schema 可导入**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "import app.schemas_project as s; print(s.ProjectCreate, s.TaskCreate)"
```
Expected: 打印两个类,无异常。

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas_project.py
git commit -m "feat(project): 新增项目管理 Pydantic schemas"
```

---

## Task 4: CRUD — 项目与成员

**Files:**
- Create: `backend/app/crud_project.py`
- Test: `backend/tests/test_project_crud.py`

- [ ] **Step 1: 写项目/成员 CRUD 的失败测试**

创建 `backend/tests/test_project_crud.py`:

```python
import uuid
import pytest
from fastapi import HTTPException

from app import models_project  # noqa: F401
from app import crud_project
from app.schemas_project import ProjectCreate, ProjectEdit, MemberAdd


def _make_user(db, role="engineer"):
    from app import models
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}",
                    password_hash="x", real_name="测试", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_create_project_auto_code_and_owner_member(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="项目A"), owner.id)
    assert p.code.startswith("PRJ-")
    assert p.owner_id == owner.id
    # 创建者自动成为经理
    members = crud_project.list_members(db, p.id)
    assert any(m.user_id == owner.id and m.role_in_project == "经理" for m in members)


def test_create_project_sequential_codes(db):
    owner = _make_user(db)
    p1 = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    p2 = crud_project.create_project(db, ProjectCreate(name="B"), owner.id)
    assert p1.code != p2.code


def test_list_projects_only_member_visible(db):
    owner = _make_user(db)
    other = _make_user(db)
    crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    assert len(crud_project.list_projects(db, owner)) == 1
    assert len(crud_project.list_projects(db, other)) == 0  # 非成员不可见


def test_admin_sees_all_projects(db):
    owner = _make_user(db)
    admin = _make_user(db, role="admin")
    crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    assert len(crud_project.list_projects(db, admin)) == 1  # admin 全可见


def test_add_and_remove_member(db):
    owner = _make_user(db); m = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    crud_project.add_member(db, p.id, MemberAdd(user_id=str(m.id)))
    assert crud_project.is_member(db, p.id, m.id) is True
    crud_project.remove_member(db, p.id, m.id)
    assert crud_project.is_member(db, p.id, m.id) is False


def test_delete_project_soft(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    crud_project.delete_project(db, p)
    assert p.deleted_at is not None
    assert len(crud_project.list_projects(db, owner)) == 0
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py -v
```
Expected: FAIL,`ModuleNotFoundError: No module named 'app.crud_project'`。

- [ ] **Step 3: 创建 CRUD 文件(项目+成员部分)**

创建 `backend/app/crud_project.py`:

```python
"""项目管理 - CRUD"""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import User
from app.models_project import (
    Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment,
)
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskMove, TaskLinkAdd, CommentAdd,
)


def _uuid(v):
    if v is None or v == "":
        return None
    return uuid.UUID(v) if isinstance(v, str) else v


# ════════════════════════ 项目 ════════════════════════
def _next_project_code(db: Session) -> str:
    count = db.query(Project).count()
    return f"PRJ-{count + 1:03d}"


def create_project(db: Session, data: ProjectCreate, owner_id: uuid.UUID) -> Project:
    p = Project(
        code=_next_project_code(db), name=data.name, owner_id=owner_id,
        status=data.status, planned_start=data.planned_start,
        planned_end=data.planned_end, description=data.description,
    )
    db.add(p); db.commit(); db.refresh(p)
    # 创建者自动成为经理
    db.add(ProjectMember(project_id=p.id, user_id=owner_id, role_in_project="经理"))
    # 附带成员
    for uid in (data.member_user_ids or []):
        if _uuid(uid) != owner_id:
            db.add(ProjectMember(project_id=p.id, user_id=_uuid(uid), role_in_project="成员"))
    db.commit()
    return p


def list_projects(db: Session, user: User) -> list:
    q = db.query(Project).filter(Project.deleted_at.is_(None))
    if user.role != "admin":
        member_pids = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id)
        q = q.filter(Project.id.in_(member_pids))
    return q.order_by(Project.created_at.desc()).all()


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    return p


def update_project(db: Session, p: Project, data: ProjectEdit) -> Project:
    for field in ("name", "status", "planned_start", "planned_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(p, field, val)
    db.commit(); db.refresh(p)
    return p


def delete_project(db: Session, p: Project):
    p.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ════════════════════════ 成员 ════════════════════════
def list_members(db: Session, project_id: uuid.UUID) -> list:
    return db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()


def is_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).first() is not None


def add_member(db: Session, project_id: uuid.UUID, data: MemberAdd) -> ProjectMember:
    uid = _uuid(data.user_id)
    if is_member(db, project_id, uid):
        raise HTTPException(status_code=400, detail="该用户已是项目成员")
    m = ProjectMember(project_id=project_id, user_id=uid, role_in_project=data.role_in_project)
    db.add(m); db.commit(); db.refresh(m)
    return m


def remove_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID):
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).delete()
    db.commit()
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py -v
```
Expected: PASS(6 个项目/成员测试全绿)。

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_crud.py
git commit -m "feat(project): 项目与成员 CRUD"
```

---

## Task 5: CRUD — 任务树、关联、评论

**Files:**
- Modify: `backend/app/crud_project.py`(追加任务/关联/评论函数)
- Test: `backend/tests/test_project_crud.py`(追加测试)

- [ ] **Step 1: 追加任务/关联/评论的失败测试**

在 `backend/tests/test_project_crud.py` 末尾追加:

```python
from app.schemas_project import TaskCreate, TaskEdit, TaskMove, TaskLinkAdd, CommentAdd


def test_create_task_auto_code_and_tree(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    root = crud_project.create_task(db, p, TaskCreate(name="阶段一"))
    assert root.code.startswith(p.code + "-")
    child = crud_project.create_task(db, p, TaskCreate(name="子任务", parent_id=str(root.id)))
    assert child.parent_id == root.id
    tree = crud_project.get_task_tree(db, p.id)
    assert len(tree) == 1 and tree[0]["id"] == str(root.id)
    assert tree[0]["children"][0]["id"] == str(child.id)


def test_update_task_status(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    crud_project.update_task_status(db, t, "进行中")
    assert t.status == "进行中"


def test_delete_task_soft_cascades_subtree(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    root = crud_project.create_task(db, p, TaskCreate(name="R"))
    child = crud_project.create_task(db, p, TaskCreate(name="C", parent_id=str(root.id)))
    crud_project.delete_task(db, root)
    # 整棵子树软删
    assert crud_project.get_task(db, root.id).deleted_at is not None
    assert crud_project.get_task(db, child.id).deleted_at is not None
    assert crud_project.get_task_tree(db, p.id) == []


def test_task_links_add_list_remove(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    link = crud_project.add_link(db, t.id, TaskLinkAdd(entity_type="part", entity_id=str(uuid.uuid4())))
    assert len(crud_project.list_links(db, t.id)) == 1
    crud_project.remove_link(db, link.id)
    assert len(crud_project.list_links(db, t.id)) == 0


def test_task_comments_add_list_delete(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    c = crud_project.add_comment(db, t.id, owner.id, CommentAdd(content="hi"))
    assert len(crud_project.list_comments(db, t.id)) == 1
    crud_project.delete_comment(db, c)
    assert len(crud_project.list_comments(db, t.id)) == 0
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py -k "task or link or comment" -v
```
Expected: FAIL,`AttributeError: module 'app.crud_project' has no attribute 'create_task'`。

- [ ] **Step 3: 追加任务/关联/评论 CRUD**

在 `backend/app/crud_project.py` 末尾追加:

```python
# ════════════════════════ 任务 ════════════════════════
def _next_task_code(db: Session, project: Project) -> str:
    count = db.query(ProjectTask).filter(ProjectTask.project_id == project.id).count()
    return f"{project.code}-{count + 1:02d}"


def get_task(db: Session, task_id: uuid.UUID) -> ProjectTask:
    t = db.query(ProjectTask).filter(ProjectTask.id == task_id, ProjectTask.deleted_at.is_(None)).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


def create_task(db: Session, project: Project, data: TaskCreate) -> ProjectTask:
    parent_id = _uuid(data.parent_id)
    if parent_id:
        get_task(db, parent_id)  # 校验父任务存在
    max_sort = db.query(ProjectTask).filter(
        ProjectTask.project_id == project.id,
        ProjectTask.parent_id == parent_id,
        ProjectTask.deleted_at.is_(None),
    ).count()
    t = ProjectTask(
        project_id=project.id, parent_id=parent_id, code=_next_task_code(db, project),
        name=data.name, task_type=data.task_type, assignee_id=_uuid(data.assignee_id),
        status=data.status, priority=data.priority,
        planned_start=data.planned_start, planned_end=data.planned_end,
        actual_start=data.actual_start, actual_end=data.actual_end,
        description=data.description, sort_order=max_sort,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_task(db: Session, t: ProjectTask, data: TaskEdit) -> ProjectTask:
    for field in ("name", "task_type", "status", "priority", "planned_start",
                  "planned_end", "actual_start", "actual_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(t, field, val)
    if data.assignee_id is not None:
        t.assignee_id = _uuid(data.assignee_id)
    db.commit(); db.refresh(t)
    return t


def update_task_status(db: Session, t: ProjectTask, status: str) -> ProjectTask:
    t.status = status
    db.commit(); db.refresh(t)
    return t


def move_task(db: Session, t: ProjectTask, data: TaskMove) -> ProjectTask:
    if data.parent_id is not None:
        t.parent_id = _uuid(data.parent_id)
    if data.sort_order is not None:
        t.sort_order = data.sort_order
    db.commit(); db.refresh(t)
    return t


def delete_task(db: Session, t: ProjectTask):
    """软删任务及其整棵子树。"""
    now = datetime.now(timezone.utc)
    to_delete = [t.id]
    while to_delete:
        current = to_delete.pop()
        task = db.query(ProjectTask).filter(ProjectTask.id == current).first()
        if task and task.deleted_at is None:
            task.deleted_at = now
            children = db.query(ProjectTask.id).filter(
                ProjectTask.parent_id == current, ProjectTask.deleted_at.is_(None)
            ).all()
            to_delete.extend([c[0] for c in children])
    db.commit()


def get_task_tree(db: Session, project_id: uuid.UUID) -> list:
    """组装该项目整棵任务树(嵌套 dict)。"""
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    # 预取关联数与负责人名
    link_counts = {}
    for tid, in db.query(ProjectTaskLink.task_id).all():
        link_counts[tid] = link_counts.get(tid, 0) + 1
    user_names = {u.id: u.real_name for u in db.query(User).all()}

    nodes = {}
    for t in tasks:
        nodes[t.id] = {
            "id": str(t.id), "project_id": str(t.project_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "assignee_name": user_names.get(t.assignee_id) if t.assignee_id else None,
            "status": t.status, "priority": t.priority,
            "planned_start": t.planned_start, "planned_end": t.planned_end,
            "actual_start": t.actual_start, "actual_end": t.actual_end,
            "sort_order": t.sort_order, "description": t.description,
            "link_count": link_counts.get(t.id, 0),
            "children": [],
        }
    roots = []
    for t in tasks:
        node = nodes[t.id]
        if t.parent_id and t.parent_id in nodes:
            nodes[t.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


# ════════════════════════ 任务关联对象 ════════════════════════
def add_link(db: Session, task_id: uuid.UUID, data: TaskLinkAdd) -> ProjectTaskLink:
    link = ProjectTaskLink(task_id=task_id, entity_type=data.entity_type, entity_id=_uuid(data.entity_id))
    db.add(link); db.commit(); db.refresh(link)
    return link


def list_links(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskLink).filter(ProjectTaskLink.task_id == task_id).all()


def remove_link(db: Session, link_id: uuid.UUID):
    db.query(ProjectTaskLink).filter(ProjectTaskLink.id == link_id).delete()
    db.commit()


# ════════════════════════ 任务评论 ════════════════════════
def add_comment(db: Session, task_id: uuid.UUID, user_id: uuid.UUID, data: CommentAdd) -> ProjectTaskComment:
    c = ProjectTaskComment(task_id=task_id, user_id=user_id, content=data.content)
    db.add(c); db.commit(); db.refresh(c)
    return c


def list_comments(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskComment).filter(
        ProjectTaskComment.task_id == task_id, ProjectTaskComment.deleted_at.is_(None)
    ).order_by(ProjectTaskComment.created_at).all()


def get_comment(db: Session, comment_id: uuid.UUID) -> ProjectTaskComment:
    c = db.query(ProjectTaskComment).filter(
        ProjectTaskComment.id == comment_id, ProjectTaskComment.deleted_at.is_(None)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="评论不存在")
    return c


def delete_comment(db: Session, c: ProjectTaskComment):
    c.deleted_at = datetime.now(timezone.utc)
    db.commit()
```

- [ ] **Step 4: 运行全部 CRUD 测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py -v
```
Expected: PASS(全部项目/成员/任务/关联/评论测试绿)。

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_crud.py
git commit -m "feat(project): 任务树/关联/评论 CRUD"
```

---

## Task 6: API 路由

**Files:**
- Create: `backend/app/routers/projects.py`
- Modify: `backend/app/main.py`(导入并注册路由)

- [ ] **Step 1: 创建路由文件**

创建 `backend/app/routers/projects.py`:

```python
"""项目管理 - API Router"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app import crud_project
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskStatusUpdate, TaskMove, TaskLinkAdd, CommentAdd,
)
from ..permissions import require_permission, enforce_object_policy

router = APIRouter(prefix="/projects", tags=["项目管理"])


def _require_member(db, project_id, user):
    """非 admin 必须是项目成员,否则 403。"""
    if user.role != "admin" and not crud_project.is_member(db, project_id, user.id):
        raise HTTPException(status_code=403, detail="非项目成员")


# ──────────── 项目 ────────────
@router.get("")
async def list_projects(db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project:read"))):
    items = crud_project.list_projects(db, current_user)
    return {"items": [_project_brief(db, p) for p in items]}


@router.post("")
async def create_project(data: ProjectCreate, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:create"))):
    p = crud_project.create_project(db, data, current_user.id)
    return _project_detail(db, p)


@router.get("/{project_id}")
async def get_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project:read"))):
    p = crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return _project_detail(db, p)


@router.put("/{project_id}")
async def update_project(project_id: uuid.UUID, data: ProjectEdit, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return _project_detail(db, crud_project.update_project(db, p, data))


@router.delete("/{project_id}")
async def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:delete"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    crud_project.delete_project(db, p)
    return {"detail": "已删除"}


# ──────────── 成员 ────────────
@router.get("/{project_id}/members")
async def list_members(project_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [_member_dict(db, m) for m in crud_project.list_members(db, project_id)]}


@router.post("/{project_id}/members")
async def add_member(project_id: uuid.UUID, data: MemberAdd, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project.member:manage"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return _member_dict(db, crud_project.add_member(db, project_id, data))


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.member:manage"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    if user_id == p.owner_id:
        raise HTTPException(status_code=400, detail="不能移除项目负责人")
    crud_project.remove_member(db, project_id, user_id)
    return {"detail": "已移除"}


# ──────────── 任务 ────────────
@router.get("/{project_id}/tasks")
async def list_tasks(project_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": crud_project.get_task_tree(db, project_id)}


@router.post("/{project_id}/tasks")
async def create_task(project_id: uuid.UUID, data: TaskCreate, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:create"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return crud_project.get_task_tree(db, project_id) and _task_dict(db, crud_project.create_task(db, p, data))


@router.put("/{project_id}/tasks/{task_id}")
async def update_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskEdit, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    t = crud_project.get_task(db, task_id)
    return _task_dict(db, crud_project.update_task(db, t, data))


@router.patch("/{project_id}/tasks/{task_id}/status")
async def update_task_status(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskStatusUpdate,
                             db: Session = Depends(get_db),
                             current_user: User = Depends(require_permission("project.task:update_status"))):
    p = crud_project.get_project(db, project_id)
    t = crud_project.get_task(db, task_id)
    # 项目经理/admin 或 任务负责人可改状态
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and t.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅项目经理或任务负责人可更新状态")
    if not is_mgr:
        _require_member(db, project_id, current_user)
    return _task_dict(db, crud_project.update_task_status(db, t, data.status))


@router.post("/{project_id}/tasks/{task_id}/move")
async def move_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskMove, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    t = crud_project.get_task(db, task_id)
    return _task_dict(db, crud_project.move_task(db, t, data))


@router.delete("/{project_id}/tasks/{task_id}")
async def delete_task(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:delete"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    crud_project.delete_task(db, crud_project.get_task(db, task_id))
    return {"detail": "已删除"}


# ──────────── 任务关联对象 ────────────
@router.get("/{project_id}/tasks/{task_id}/links")
async def list_links(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [_link_dict(db, l) for l in crud_project.list_links(db, task_id)]}


@router.post("/{project_id}/tasks/{task_id}/links")
async def add_link(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskLinkAdd, db: Session = Depends(get_db),
                   current_user: User = Depends(require_permission("project.task:link"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_task(db, task_id)
    return _link_dict(db, crud_project.add_link(db, task_id, data))


@router.delete("/{project_id}/tasks/{task_id}/links/{link_id}")
async def remove_link(project_id: uuid.UUID, task_id: uuid.UUID, link_id: uuid.UUID,
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:link"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.remove_link(db, link_id)
    return {"detail": "已解除"}


# ──────────── 任务评论 ────────────
@router.get("/{project_id}/tasks/{task_id}/comments")
async def list_comments(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [_comment_dict(db, c) for c in crud_project.list_comments(db, task_id)]}


@router.post("/{project_id}/tasks/{task_id}/comments")
async def add_comment(project_id: uuid.UUID, task_id: uuid.UUID, data: CommentAdd, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:comment"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)   # 任意项目成员可评论,不限任务状态
    crud_project.get_task(db, task_id)
    return _comment_dict(db, crud_project.add_comment(db, task_id, current_user.id, data))


@router.delete("/{project_id}/tasks/{task_id}/comments/{comment_id}")
async def delete_comment(project_id: uuid.UUID, task_id: uuid.UUID, comment_id: uuid.UUID,
                         db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project.task:comment"))):
    p = crud_project.get_project(db, project_id)
    c = crud_project.get_comment(db, comment_id)
    # 本人或项目经理/admin 可删
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and c.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除本人评论")
    crud_project.delete_comment(db, c)
    return {"detail": "已删除"}


# ──────────── 序列化辅助 ────────────
def _project_brief(db, p):
    owner = db.query(User).filter(User.id == p.owner_id).first()
    member_count = len(crud_project.list_members(db, p.id))
    return {"id": str(p.id), "code": p.code, "name": p.name, "status": p.status,
            "owner_id": str(p.owner_id), "owner_name": owner.real_name if owner else "",
            "planned_start": p.planned_start, "planned_end": p.planned_end,
            "member_count": member_count, "created_at": p.created_at}


def _project_detail(db, p):
    base = _project_brief(db, p)
    base["description"] = p.description
    base["members"] = [_member_dict(db, m) for m in crud_project.list_members(db, p.id)]
    return base


def _member_dict(db, m):
    u = db.query(User).filter(User.id == m.user_id).first()
    return {"id": str(m.id), "user_id": str(m.user_id),
            "user_name": u.real_name if u else "", "username": u.username if u else "",
            "role_in_project": m.role_in_project}


def _task_dict(db, t):
    return {"id": str(t.id), "project_id": str(t.project_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "status": t.status, "priority": t.priority,
            "planned_start": t.planned_start, "planned_end": t.planned_end,
            "actual_start": t.actual_start, "actual_end": t.actual_end,
            "sort_order": t.sort_order, "description": t.description}


_ENTITY_TABLE = {"part": "parts", "assembly": "assemblies", "document": "documents"}


def _link_dict(db, l):
    """回填关联对象的编号/名称(尽量,不强依赖)。"""
    from sqlalchemy import text
    code = name = None
    table = _ENTITY_TABLE.get(l.entity_type)
    if table:
        row = db.execute(
            text(f"SELECT code, name FROM {table} WHERE id = :id"), {"id": str(l.entity_id)}
        ).fetchone()
        if row:
            code, name = row[0], row[1]
    return {"id": str(l.id), "task_id": str(l.task_id), "entity_type": l.entity_type,
            "entity_id": str(l.entity_id), "entity_code": code, "entity_name": name}


def _comment_dict(db, c):
    u = db.query(User).filter(User.id == c.user_id).first()
    return {"id": str(c.id), "task_id": str(c.task_id), "user_id": str(c.user_id),
            "user_name": u.real_name if u else "", "content": c.content,
            "created_at": c.created_at}
```

> 注:`create_task` 的 return 行写成 `return _task_dict(...)`(去掉前面那段冗余的 `get_task_tree(...) and`)。正确写法见下方修正步骤。

- [ ] **Step 2: 修正 create_task 返回语句**

将 `routers/projects.py` 中 `create_task` 的返回行改为干净写法:

```python
    return _task_dict(db, crud_project.create_task(db, p, data))
```

- [ ] **Step 3: 在 main.py 注册路由**

修改 `backend/app/main.py`:

第 6 行的 `from .routers import (...)` 末尾追加 `, projects_router`(若 routers 包未导出该名,改为新增一行显式导入):

```python
from .routers.projects import router as projects_router
```

在路由注册区(约第 46 行 `app.include_router(assistant_router, prefix="/api")` 之后)加入:

```python
app.include_router(projects_router, prefix="/api")
```

- [ ] **Step 4: 验证后端可导入、应用可启动**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "from app.main import app; print([r.path for r in app.routes if '/projects' in r.path][:5])"
```
Expected: 打印出含 `/api/projects` 的若干路由路径,无导入错误。

- [ ] **Step 5: 运行后端全量测试确保无回归**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest -q
```
Expected: 全部 PASS(含新增项目测试 + 既有测试不回归)。

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/projects.py backend/app/main.py
git commit -m "feat(project): 项目管理 API 路由与注册"
```

---

## Task 7: 前端 — 类型与 API 服务

**Files:**
- Create: `frontend/src/types/project.ts`
- Create: `frontend/src/services/projectApi.ts`

- [ ] **Step 1: 创建 TS 类型**

创建 `frontend/src/types/project.ts`:

```typescript
export type ProjectStatus = '进行中' | '已完成' | '已暂停' | '已归档';
export type TaskType = '任务' | '里程碑' | '评审';
export type TaskStatus = '未开始' | '进行中' | '已完成' | '挂起';
export type TaskPriority = '高' | '中' | '低';
export type LinkEntityType = 'part' | 'assembly' | 'config_item' | 'ec' | 'document';

export interface ProjectMember {
  id: string;
  user_id: string;
  user_name: string;
  username: string;
  role_in_project: '经理' | '成员';
}

export interface Project {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  owner_id: string;
  owner_name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  description?: string | null;
  member_count?: number;
  members?: ProjectMember[];
  created_at?: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  task_type: TaskType;
  assignee_id: string | null;
  assignee_name?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  sort_order: number;
  description?: string | null;
  link_count?: number;
  children?: ProjectTask[];
}

export interface TaskLink {
  id: string;
  task_id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  entity_code?: string | null;
  entity_name?: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}
```

- [ ] **Step 2: 创建 API 服务**

创建 `frontend/src/services/projectApi.ts`:

```typescript
import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({ baseURL: '/api/projects', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const projectApi = {
  // 项目
  listProjects: () => api.get('/'),
  getProject: (id: string) => api.get(`/${id}`),
  createProject: (data: any) => api.post('/', data),
  updateProject: (id: string, data: any) => api.put(`/${id}`, data),
  deleteProject: (id: string) => api.delete(`/${id}`),
  // 成员
  listMembers: (id: string) => api.get(`/${id}/members`),
  addMember: (id: string, data: { user_id: string; role_in_project?: string }) =>
    api.post(`/${id}/members`, data),
  removeMember: (id: string, userId: string) => api.delete(`/${id}/members/${userId}`),
  // 任务
  listTasks: (id: string) => api.get(`/${id}/tasks`),
  createTask: (id: string, data: any) => api.post(`/${id}/tasks`, data),
  updateTask: (id: string, taskId: string, data: any) => api.put(`/${id}/tasks/${taskId}`, data),
  updateTaskStatus: (id: string, taskId: string, status: string) =>
    api.patch(`/${id}/tasks/${taskId}/status`, { status }),
  moveTask: (id: string, taskId: string, data: { parent_id?: string | null; sort_order?: number }) =>
    api.post(`/${id}/tasks/${taskId}/move`, data),
  deleteTask: (id: string, taskId: string) => api.delete(`/${id}/tasks/${taskId}`),
  // 关联对象
  listLinks: (id: string, taskId: string) => api.get(`/${id}/tasks/${taskId}/links`),
  addLink: (id: string, taskId: string, data: { entity_type: string; entity_id: string }) =>
    api.post(`/${id}/tasks/${taskId}/links`, data),
  removeLink: (id: string, taskId: string, linkId: string) =>
    api.delete(`/${id}/tasks/${taskId}/links/${linkId}`),
  // 评论
  listComments: (id: string, taskId: string) => api.get(`/${id}/tasks/${taskId}/comments`),
  addComment: (id: string, taskId: string, content: string) =>
    api.post(`/${id}/tasks/${taskId}/comments`, { content }),
  deleteComment: (id: string, taskId: string, commentId: string) =>
    api.delete(`/${id}/tasks/${taskId}/comments/${commentId}`),
};
```

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误(若仓库已有历史 tsc 警告,以"未新增"为准)。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/project.ts frontend/src/services/projectApi.ts
git commit -m "feat(project): 前端类型与 API 服务"
```

---

## Task 8: 前端 — Zustand store

**Files:**
- Create: `frontend/src/stores/project.ts`

- [ ] **Step 1: 创建 store**

创建 `frontend/src/stores/project.ts`:

```typescript
import { create } from 'zustand';
import { projectApi } from '../services/projectApi';
import type { Project, ProjectTask } from '../types/project';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  tasks: ProjectTask[];          // 树形(根节点数组)
  loading: boolean;
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  loadTasks: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  tasks: [],
  loading: false,
  loadProjects: async () => {
    set({ loading: true });
    try {
      const res = await projectApi.listProjects();
      set({ projects: res.data.items });
    } finally {
      set({ loading: false });
    }
  },
  loadProject: async (id) => {
    const res = await projectApi.getProject(id);
    set({ currentProject: res.data });
  },
  loadTasks: async (id) => {
    set({ loading: true });
    try {
      const res = await projectApi.listTasks(id);
      set({ tasks: res.data.items });
    } finally {
      set({ loading: false });
    }
  },
}));
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/project.ts
git commit -m "feat(project): 前端项目 store"
```

---

## Task 9: 前端 — ECPicker 组件

**Files:**
- Create: `frontend/src/components/ECPicker.tsx`

> 说明:现有无 EC 选择器。本组件用 `Modal` 包裹,列出 ECR/ECO 供勾选,确认后回传 `{ entity_type: 'ec', entity_id }[]`。EC 列表通过现有 `/api/ecrs/` 与 `/api/ecos/` 获取(参考 `services/api.ts` 中 ecr/eco 方法;若无统一方法则用 axios 直连,带 token)。

- [ ] **Step 1: 创建 ECPicker**

创建 `frontend/src/components/ECPicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Modal } from './Modal';
import { useAuthStore } from '../stores/auth';

interface ECPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { entity_type: 'ec'; entity_id: string }[]) => void;
}

interface ECRow {
  id: string;
  number: string;
  title: string;
  kind: 'ECR' | 'ECO';
}

export default function ECPicker({ open, onClose, onConfirm }: ECPickerProps) {
  const [rows, setRows] = useState<ECRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const token = useAuthStore.getState().token;

  useEffect(() => {
    if (!open) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get('/api/ecrs/', { headers }).catch(() => ({ data: { items: [] } })),
      axios.get('/api/ecos/', { headers }).catch(() => ({ data: { items: [] } })),
    ]).then(([ecrRes, ecoRes]) => {
      const ecrs: ECRow[] = (ecrRes.data.items || []).map((e: any) => ({
        id: e.id, number: e.ecr_number, title: e.title, kind: 'ECR' as const,
      }));
      const ecos: ECRow[] = (ecoRes.data.items || []).map((e: any) => ({
        id: e.id, number: e.eco_number, title: e.title, kind: 'ECO' as const,
      }));
      setRows([...ecrs, ...ecos]);
      setSelected(new Set());
    });
  }, [open, token]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const filtered = rows.filter(
    (r) => !search || r.number?.includes(search) || r.title?.includes(search)
  );

  const handleConfirm = () => {
    onConfirm(Array.from(selected).map((id) => ({ entity_type: 'ec' as const, entity_id: id })));
    onClose();
  };

  return (
    <Modal open={open} title="选择 EC(变更单)" onClose={onClose} width="lg" zIndex={60}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索单号/标题"
        className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg"
      />
      <div className="max-h-80 overflow-y-auto divide-y">
        {filtered.map((r) => (
          <label key={r.id} className="flex items-center gap-2 py-2 cursor-pointer">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <span className="text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700">{r.kind}</span>
            <span className="font-medium">{r.number}</span>
            <span className="text-gray-500 truncate">{r.title}</span>
          </label>
        ))}
        {filtered.length === 0 && <div className="py-8 text-center text-gray-400">无数据</div>}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
        <button onClick={handleConfirm} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          确认({selected.size})
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 校对 ECR/ECO 列表响应字段**

确认实际响应字段名。Run:
```bash
cd D:/OpenCode/myPDM && grep -rn "ecr_number\|eco_number" backend/app/routers/ecrs.py backend/app/routers/ecos.py | head
```
若列表项字段不是 `ecr_number`/`eco_number` 或列表不在 `items` 键下,按实际返回结构调整 ECPicker 的 `.map`。

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ECPicker.tsx
git commit -m "feat(project): EC 选择器组件"
```

---

## Task 10: 前端 — 项目列表页

**Files:**
- Create: `frontend/src/pages/Project/Projects.tsx`

> 风格参考 `frontend/src/pages/Inventory.tsx`:primary-* 配色、统一工具栏与表格。点击行进入工作区(用 React Router 的 `useNavigate('/projects/:id')`,路由在 Task 13 接好)。

- [ ] **Step 1: 创建项目列表页**

创建 `frontend/src/pages/Project/Projects.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { can } from '../../stores/auth';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { ProjectStatus } from '../../types/project';

const STATUSES: ProjectStatus[] = ['进行中', '已完成', '已暂停', '已归档'];
const STATUS_CLASS: Record<ProjectStatus, string> = {
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  已暂停: 'bg-amber-50 text-amber-700',
  已归档: 'bg-gray-100 text-gray-600',
};

export default function Projects() {
  const navigate = useNavigate();
  const { projects, loadProjects, loading } = useProjectStore();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', planned_start: '', planned_end: '', description: '' });

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const filtered = projects.filter((p) =>
    (!search || p.name.includes(search) || p.code.includes(search)) &&
    (!statusFilter || p.status === statusFilter)
  );

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('请填写项目名称'); return; }
    try {
      await projectApi.createProject(form);
      toast.success('项目已创建');
      setCreateOpen(false);
      setForm({ name: '', planned_start: '', planned_end: '', description: '' });
      loadProjects();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold">项目管理</h1>
        <div className="flex-1" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索编号/名称"
               className="px-3 py-2 border border-gray-300 rounded-lg" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg">
          <option value="">全部状态</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {can('project:create') && (
          <button onClick={() => setCreateOpen(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">+ 新建项目</button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">编号</th>
              <th className="text-left px-4 py-2 font-medium">名称</th>
              <th className="text-left px-4 py-2 font-medium">负责人</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-left px-4 py-2 font-medium">计划起止</th>
              <th className="text-left px-4 py-2 font-medium">成员</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-2">{p.code}</td>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2">{p.owner_name}</td>
                <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[p.status]}`}>{p.status}</span></td>
                <td className="px-4 py-2 text-gray-500">{p.planned_start || '—'} ~ {p.planned_end || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{p.member_count ?? 0}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">暂无项目</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} title="新建项目" onClose={() => setCreateOpen(false)} width="lg">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">项目名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">计划开始</label>
              <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">计划完成</label>
              <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">描述</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">创建</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 校对 Toast 用法**

确认 `useToast` 的导出与 API(`success`/`error`)。Run:
```bash
cd D:/OpenCode/myPDM && grep -n "export" frontend/src/components/Toast.tsx | head
```
若 Toast 不是 `useToast()` hook 形式(而是全局函数),按实际签名调整 `toast.success/error` 调用。

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Project/Projects.tsx
git commit -m "feat(project): 项目列表页"
```

---

## Task 11: 前端 — 任务工作区(树形表格)

**Files:**
- Create: `frontend/src/pages/Project/ProjectWorkspace.tsx`
- Create: `frontend/src/pages/Project/MemberManageModal.tsx`

> 任务树自行递归渲染(无限深度),用缩进表达层级、展开/折叠切换。逾期判定:`planned_end < 今天 && status !== '已完成'` → 行标红。任务编辑弹窗在 Task 12 实现并接入。

- [ ] **Step 1: 创建成员管理弹窗**

创建 `frontend/src/pages/Project/MemberManageModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { api } from '../../services/api';
import type { ProjectMember } from '../../types/project';

interface Props {
  open: boolean;
  projectId: string;
  ownerId: string;
  onClose: () => void;
}

export default function MemberManageModal({ open, projectId, ownerId, onClose }: Props) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [users, setUsers] = useState<{ id: string; real_name: string; username: string }[]>([]);
  const [pickUser, setPickUser] = useState('');

  const load = async () => {
    const res = await projectApi.listMembers(projectId);
    setMembers(res.data.items);
  };

  useEffect(() => {
    if (!open) return;
    load();
    api.get('/users/').then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
  }, [open, projectId]);

  const handleAdd = async () => {
    if (!pickUser) return;
    await projectApi.addMember(projectId, { user_id: pickUser });
    setPickUser('');
    load();
  };

  const handleRemove = async (userId: string) => {
    await projectApi.removeMember(projectId, userId);
    load();
  };

  const memberIds = new Set(members.map((m) => m.user_id));

  return (
    <Modal open={open} title="项目成员管理" onClose={onClose} width="lg">
      <div className="flex gap-2 mb-4">
        <select value={pickUser} onChange={(e) => setPickUser(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg">
          <option value="">选择用户加入…</option>
          {users.filter((u) => !memberIds.has(u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.real_name}（{u.username}）</option>
          ))}
        </select>
        <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">添加</button>
      </div>
      <div className="divide-y">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 py-2">
            <span className="font-medium">{m.user_name}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{m.role_in_project}</span>
            <div className="flex-1" />
            {m.user_id !== ownerId && (
              <button onClick={() => handleRemove(m.user_id)} className="text-red-600 text-sm hover:underline">移除</button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
```

> 注:确认 `services/api.ts` 导出名为 `api`(主客户端)。若导出名不同,调整 import。

- [ ] **Step 2: 创建工作区页(树形表格)**

创建 `frontend/src/pages/Project/ProjectWorkspace.tsx`:

```tsx
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { can } from '../../stores/auth';
import { ConfirmModal } from '../../components/Modal';
import MemberManageModal from './MemberManageModal';
import TaskEditModal from './TaskEditModal';
import type { ProjectTask, TaskStatus } from '../../types/project';

const TYPE_ICON: Record<string, string> = { 任务: '📋', 里程碑: '🏁', 评审: '🔎' };
const STATUS_CLASS: Record<TaskStatus, string> = {
  未开始: 'bg-gray-100 text-gray-600',
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  挂起: 'bg-amber-50 text-amber-700',
};

function isOverdue(t: ProjectTask): boolean {
  if (!t.planned_end || t.status === '已完成') return false;
  return t.planned_end < new Date().toISOString().slice(0, 10);
}

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { currentProject, loadProject, tasks, loadTasks } = useProjectStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memberOpen, setMemberOpen] = useState(false);
  const [editTask, setEditTask] = useState<ProjectTask | null>(null);
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [delTask, setDelTask] = useState<ProjectTask | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const reload = () => { if (id) loadTasks(id); };
  useEffect(() => { if (id) { loadProject(id); loadTasks(id); } }, [id]);

  const isManager = useMemo(() => {
    if (!currentProject) return false;
    return can('project.task:create'); // 角色级;对象级由后端兜底
  }, [currentProject]);

  const toggle = (tid: string) => {
    const next = new Set(expanded);
    next.has(tid) ? next.delete(tid) : next.add(tid);
    setExpanded(next);
  };

  const openCreate = (parentId: string | null) => {
    setEditTask(null); setEditParentId(parentId); setEditOpen(true);
  };
  const openEdit = (t: ProjectTask) => {
    setEditTask(t); setEditParentId(null); setEditOpen(true);
  };

  const changeStatus = async (t: ProjectTask, status: string) => {
    if (!id) return;
    await projectApi.updateTaskStatus(id, t.id, status);
    reload();
  };

  const confirmDelete = async () => {
    if (!id || !delTask) return;
    await projectApi.deleteTask(id, delTask.id);
    setDelTask(null);
    reload();
  };

  const renderRow = (t: ProjectTask, depth: number): JSX.Element[] => {
    if (statusFilter && t.status !== statusFilter) {
      // 即便父被过滤,仍渲染匹配的子节点
      return (t.children || []).flatMap((c) => renderRow(c, depth));
    }
    const hasChildren = (t.children?.length || 0) > 0;
    const isOpen = expanded.has(t.id);
    const overdue = isOverdue(t);
    const rows: JSX.Element[] = [
      <tr key={t.id} className={`border-t border-gray-100 ${overdue ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
        <td className="px-4 py-2">
          <span style={{ paddingLeft: depth * 20 }} className="inline-flex items-center gap-1">
            {hasChildren ? (
              <button onClick={() => toggle(t.id)} className="text-gray-400 w-4">{isOpen ? '▾' : '▸'}</button>
            ) : <span className="inline-block w-4" />}
            <span>{TYPE_ICON[t.task_type]}</span>
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-gray-400">{t.code}</span>
            {overdue && <span className="text-xs text-red-600">⚠ 逾期</span>}
          </span>
        </td>
        <td className="px-2 py-2">{t.assignee_name || '—'}</td>
        <td className="px-2 py-2">
          <select value={t.status} onChange={(e) => changeStatus(t, e.target.value)}
                  className={`text-xs px-2 py-0.5 rounded border-0 ${STATUS_CLASS[t.status]}`}>
            {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">{t.priority}</td>
        <td className="px-2 py-2 text-gray-500">{t.planned_end || '—'}</td>
        <td className="px-4 py-2 text-right text-gray-400">
          {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
          {isManager && <button onClick={() => openCreate(t.id)} className="text-primary-600 text-sm mr-2">+子</button>}
          {isManager && <button onClick={() => openEdit(t)} className="text-gray-600 text-sm mr-2">编辑</button>}
          {can('project.task:delete') && <button onClick={() => setDelTask(t)} className="text-red-600 text-sm">删除</button>}
        </td>
      </tr>,
    ];
    if (hasChildren && isOpen) {
      for (const c of t.children!) rows.push(...renderRow(c, depth + 1));
    }
    return rows;
  };

  if (!currentProject) return <div className="p-6 text-gray-400">加载中…</div>;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
        <span className="font-semibold">{currentProject.code} · {currentProject.name}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">{currentProject.status}</span>
        <span className="text-sm text-gray-500">负责人 {currentProject.owner_name}</span>
        <div className="flex-1" />
        <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        {isManager && (
          <button onClick={() => openCreate(null)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">+ 新建顶层任务</button>
        )}
        <div className="flex-1" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
          <option value="">全部状态</option>
          {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">任务名称</th>
              <th className="text-left px-2 py-2 font-medium">负责人</th>
              <th className="text-left px-2 py-2 font-medium">状态</th>
              <th className="text-left px-2 py-2 font-medium">优先级</th>
              <th className="text-left px-2 py-2 font-medium">计划完成</th>
              <th className="text-right px-4 py-2 font-medium">关联/操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.flatMap((t) => renderRow(t, 0))}
            {tasks.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">暂无任务</td></tr>}
          </tbody>
        </table>
      </div>

      <MemberManageModal open={memberOpen} projectId={id!} ownerId={currentProject.owner_id} onClose={() => setMemberOpen(false)} />
      <TaskEditModal open={editOpen} projectId={id!} task={editTask} parentId={editParentId}
                     onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
      <ConfirmModal open={!!delTask} content={`确认删除任务"${delTask?.name}"及其所有子任务?`}
                    onConfirm={confirmDelete} onCancel={() => setDelTask(null)} />
    </div>
  );
}
```

- [ ] **Step 3: 类型检查(允许 TaskEditModal 暂未实现的报错)**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 仅剩 `Cannot find module './TaskEditModal'`(将在 Task 12 解决);无其他新增错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Project/ProjectWorkspace.tsx frontend/src/pages/Project/MemberManageModal.tsx
git commit -m "feat(project): 任务工作区树形表格与成员管理弹窗"
```

---

## Task 12: 前端 — 任务编辑弹窗(字段 + 关联 + 评论)

**Files:**
- Create: `frontend/src/pages/Project/TaskEditModal.tsx`

> 集字段表单、关联对象(4 类 Picker)、评论区于一体。附件区为可选增强:若时间允许接入现有附件组件(`entity_type='project_task'`);本任务先实现字段/关联/评论,附件区留一个占位说明区块(见 Step 1 注释),不阻塞主流程。

- [ ] **Step 1: 创建任务编辑弹窗**

创建 `frontend/src/pages/Project/TaskEditModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { api } from '../../services/api';
import AssemblyPartPicker from '../../components/AssemblyPartPicker';
import DocumentPicker from '../../components/DocumentPicker';
import ECPicker from '../../components/ECPicker';
import type { ProjectTask, TaskType, TaskStatus, TaskPriority, TaskLink, TaskComment } from '../../types/project';

interface Props {
  open: boolean;
  projectId: string;
  task: ProjectTask | null;     // null = 新建
  parentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: TaskType[] = ['任务', '里程碑', '评审'];
const STATUSES: TaskStatus[] = ['未开始', '进行中', '已完成', '挂起'];
const PRIORITIES: TaskPriority[] = ['高', '中', '低'];
const LINK_LABEL: Record<string, string> = {
  part: '零件', assembly: '部件', config_item: '构型项', ec: 'EC', document: '图文档',
};

export default function TaskEditModal({ open, projectId, task, parentId, onClose, onSaved }: Props) {
  const empty = { name: '', task_type: '任务' as TaskType, assignee_id: '', status: '未开始' as TaskStatus,
    priority: '中' as TaskPriority, planned_start: '', planned_end: '', description: '' };
  const [form, setForm] = useState(empty);
  const [users, setUsers] = useState<{ id: string; real_name: string }[]>([]);
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showPartPicker, setShowPartPicker] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showECPicker, setShowECPicker] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/users/').then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
    if (task) {
      setForm({
        name: task.name, task_type: task.task_type, assignee_id: task.assignee_id || '',
        status: task.status, priority: task.priority,
        planned_start: task.planned_start || '', planned_end: task.planned_end || '',
        description: task.description || '',
      });
      loadLinks(task.id);
      loadComments(task.id);
    } else {
      setForm(empty);
      setLinks([]); setComments([]);
    }
  }, [open, task]);

  const loadLinks = async (taskId: string) => {
    const r = await projectApi.listLinks(projectId, taskId);
    setLinks(r.data.items);
  };
  const loadComments = async (taskId: string) => {
    const r = await projectApi.listComments(projectId, taskId);
    setComments(r.data.items);
  };

  const handleSave = async () => {
    const payload: any = { ...form, parent_id: task ? undefined : parentId };
    if (task) await projectApi.updateTask(projectId, task.id, payload);
    else await projectApi.createTask(projectId, payload);
    onSaved();
  };

  // 关联对象需先有任务 id。新建时提示先保存。
  const ensureTaskId = (): string | null => {
    if (!task) { alert('请先保存任务,再添加关联对象/评论'); return null; }
    return task.id;
  };

  const addLinks = async (items: { entity_type: string; entity_id: string }[]) => {
    const tid = ensureTaskId(); if (!tid) return;
    for (const it of items) await projectApi.addLink(projectId, tid, it);
    loadLinks(tid);
  };
  const removeLink = async (linkId: string) => {
    const tid = ensureTaskId(); if (!tid) return;
    await projectApi.removeLink(projectId, tid, linkId);
    loadLinks(tid);
  };

  const submitComment = async () => {
    const tid = ensureTaskId(); if (!tid || !newComment.trim()) return;
    await projectApi.addComment(projectId, tid, newComment.trim());
    setNewComment('');
    loadComments(tid);
  };
  const removeComment = async (commentId: string) => {
    const tid = ensureTaskId(); if (!tid) return;
    await projectApi.deleteComment(projectId, tid, commentId);
    loadComments(tid);
  };

  return (
    <Modal open={open} title={task ? `编辑任务 · ${task.name}` : '新建任务'} onClose={onClose} width="3xl">
      <div className="space-y-4">
        {/* 基本字段 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">任务名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">类型</label>
            <select value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">负责人</label>
            <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="">未指派</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">优先级</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">计划开始</label>
            <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">计划完成</label>
            <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">描述</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={2} />
        </div>

        {/* 关联对象 */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-gray-600">关联对象</span>
            <button onClick={() => setShowPartPicker(true)} className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700">零部件 +</button>
            <button onClick={() => setShowECPicker(true)} className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700">EC +</button>
            <button onClick={() => setShowDocPicker(true)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">图文档 +</button>
            {/* 构型项 Picker 见 Step 2 备注 */}
          </div>
          <div className="space-y-1">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded">
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{LINK_LABEL[l.entity_type]}</span>
                <span>{l.entity_code || l.entity_id} {l.entity_name || ''}</span>
                <div className="flex-1" />
                <button onClick={() => removeLink(l.id)} className="text-gray-400 hover:text-red-600">×</button>
              </div>
            ))}
            {links.length === 0 && <div className="text-xs text-gray-400">暂无关联</div>}
          </div>
        </div>

        {/* 任务附件(占位:接入现有附件组件,entity_type='project_task') */}
        <div className="border-t pt-3">
          <div className="text-sm text-gray-600 mb-1">任务附件 <span className="text-gray-400">(生产人员在此传产出)</span></div>
          <div className="text-xs text-gray-400 border border-dashed border-gray-300 rounded-lg px-3 py-3">
            接入现有附件上传组件(entity_type='project_task', entity_id=任务 id)
          </div>
        </div>

        {/* 评论 */}
        <div className="border-t pt-3">
          <div className="text-sm text-gray-600 mb-2">评论</div>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 text-sm">
                <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs shrink-0">
                  {c.user_name?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.user_name}</span>
                    <span className="text-xs text-gray-400">{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                    <div className="flex-1" />
                    <button onClick={() => removeComment(c.id)} className="text-xs text-gray-400 hover:text-red-600">删除</button>
                  </div>
                  <div className="text-gray-700 whitespace-pre-wrap">{c.content}</div>
                </div>
              </div>
            ))}
            {comments.length === 0 && <div className="text-xs text-gray-400">暂无评论</div>}
          </div>
          <div className="flex gap-2">
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
                   placeholder="写评论…(项目成员均可评论)"
                   className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" />
            <button onClick={submitComment} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">发送</button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">保存</button>
        </div>
      </div>

      {/* Picker 弹窗 */}
      {showPartPicker && (
        <AssemblyPartPicker
          open={showPartPicker}
          onClose={() => setShowPartPicker(false)}
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: it.child_type === 'part' ? 'part' : 'assembly', entity_id: it.child_id })));
            setShowPartPicker(false);
          }}
        />
      )}
      {showDocPicker && (
        <DocumentPicker
          open={showDocPicker}
          onClose={() => setShowDocPicker(false)}
          onConfirm={(docIds: string[]) => {
            addLinks(docIds.map((docId) => ({ entity_type: 'document', entity_id: docId })));
            setShowDocPicker(false);
          }}
        />
      )}
      <ECPicker open={showECPicker} onClose={() => setShowECPicker(false)} onConfirm={(items) => addLinks(items)} />
    </Modal>
  );
}
```

- [ ] **Step 2: 校对 Picker 的 props 契约**

`AssemblyPartPicker` 的 `onConfirm` 回调签名为 `(items: { child_type: string; child_id: string; quantity: number }[]) => void`(已确认)。需要校对 `DocumentPicker` 的 props,并确认是否存在构型项 Picker(`ConfigItemPicker`)。

Run:
```bash
cd D:/OpenCode/myPDM && grep -n "interface.*Props\|onConfirm\|onClose\|open" frontend/src/components/DocumentPicker.tsx | head
cd D:/OpenCode/myPDM && ls frontend/src/components/Configuration/ 2>/dev/null | grep -i picker
```
- 若 `DocumentPicker` 的回调/属性名与上文不符,按实际签名调整 `onConfirm`/props。
- 若存在可复用的构型项 Picker(如 `Configuration/ConfigItemPicker.tsx`),按其 props 增加一个"构型项 +"按钮与对应 picker(映射 `entity_type: 'config_item'`);若没有,本期构型项关联可暂缺,在工作区/弹窗上不显示该按钮(已在 UI 中省略),后续补。

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误(若 Picker 签名不符,在此修正直到通过)。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Project/TaskEditModal.tsx
git commit -m "feat(project): 任务编辑弹窗(字段/关联/评论)"
```

---

## Task 13: 前端 — 路由与导航接入

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: 在 App.tsx 引入页面与路由**

在 `frontend/src/App.tsx` 顶部 import 区(`import Inventory from './pages/Inventory';` 之后)加入:

```tsx
import Projects from './pages/Project/Projects';
import ProjectWorkspace from './pages/Project/ProjectWorkspace';
```

在 Layout 子路由区(`<Route path="inventory" element={<Inventory />} />` 之后)加入:

```tsx
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectWorkspace />} />
```

- [ ] **Step 2: 在 Layout.tsx 增加导航项**

在 `frontend/src/components/Layout.tsx` 的 `navItems` 数组中,`{ path: '/inventory', ... }` 之后加入:

```tsx
  { path: '/projects', label: '项目管理', icon: '🗂️', roles: ['admin', 'engineer', 'production'] },
```

> 角色给 admin/engineer/production(guest 在项目内通过成员可见性控制;若要让 guest 也能看到入口,加 'guest')。导航的 `roles` 字段是页面入口级粗过滤,真正的数据可见性由后端成员过滤兜底。

- [ ] **Step 3: 构建前端**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: 构建成功,无 TypeScript 报错(prebuild 会自动跑 `gen:perms`,确认权限已生成)。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat(project): 路由与导航接入"
```

---

## Task 14: 集成验证(Docker 手测)

**Files:** 无(端到端验证)

- [ ] **Step 1: 重启后端、构建前端、刷新 Nginx**

Run:
```bash
cd D:/OpenCode/myPDM && docker restart bom_backend
cd D:/OpenCode/myPDM/frontend && npm run build
cd D:/OpenCode/myPDM && docker-compose up -d --force-recreate nginx
```
Expected: 容器 Up;后端日志出现 `✓ Auto-added missing column` 或新表创建相关日志(`docker logs bom_backend -f` 查看,确认 5 张 project_* 表已建)。

- [ ] **Step 2: 后端建表确认**

Run:
```bash
docker exec bom_postgres psql -U bomadmin -d bom_system -c "\dt project*"
```
Expected: 列出 `projects`、`project_members`、`project_tasks`、`project_task_links`、`project_task_comments`。

- [ ] **Step 3: 手动冒烟(浏览器,https://localhost:8080)**

用 engineer 账号:
1. 进入"项目管理",新建项目 → 列表出现该项目。
2. 进入项目工作区,新建顶层任务、子任务(验证无限层级、展开折叠)。
3. 编辑任务:改类型为里程碑/评审(图标变化)、指派负责人、改状态(行内下拉)。
4. 给一个任务设"计划完成"为昨天且非已完成 → 该行标红、显示"逾期"。
5. 任务弹窗内:关联一个零件、一个 EC、一个图文档 → 已关联列表出现,可解除。
6. 任务弹窗内:发表评论、删除自己的评论。
7. 成员管理:添加一个 production 用户为成员。

用该 production 账号:
8. 登录后能看到被加入的项目;打开自己负责的任务能改状态、能发评论;非成员项目不可见。

用 guest 账号:
9. 确认看不到未参与的项目(成员可见性生效)。

- [ ] **Step 4: 运行后端全量测试 + 前端构建做最终回归**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest -q
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: 后端全绿;前端构建成功。

- [ ] **Step 5: 最终提交(若手测中有微调)**

```bash
git add -A
git commit -m "test(project): 集成验证与微调"
```

---

## 自查清单(写计划后的复核结论)

- **Spec 覆盖**:项目容器(Task 2/4/6/10)、任务自引用树(Task 2/5/6/11)、task_type/状态/优先级字段(Task 2/3/12)、关联对象多态表(Task 2/5/6/12)、任务附件(Task 12 占位 + 集成说明)、评论(Task 2/5/6/12)、成员可见性(Task 4/6/11)、对象级策略(Task 1/6)、权限矩阵(Task 1)、前端列表/工作区/弹窗/EC Picker/路由导航(Task 7–13)、Docker 手测(Task 14)。均有对应任务。
- **已知需现场校对项(非占位,均给了校对命令)**:`Toast` 用法(Task 10 Step 2)、`services/api.ts` 导出名(Task 11/12)、`DocumentPicker` props 与是否存在 `ConfigItemPicker`(Task 12 Step 2)、ECR/ECO 列表字段名(Task 9 Step 2)、users 列表响应结构(Task 11/12)。这些依赖现有组件契约,故在对应步骤内以可执行命令校对并按实调整。
- **类型一致性**:后端 `_task_dict`/`get_task_tree` 字段与前端 `ProjectTask` 类型对齐;`projectApi` 方法签名与路由路径一一对应。
- **附件区**:第 1 期以占位区块呈现,真实接入复用现有附件组件;不阻塞核心流程(spec 已将"路 A 任务附件"列为生产人员产出落点,Task 12 给出接入位点)。
