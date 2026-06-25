# 项目管理模块 第2期 实施计划(甘特图 / 进度)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有 WBS 任务上叠加甘特图能力:任务依赖(FS/SS/FF/SF + lag)、自研 SVG 时间轴可视化、关键路径(CPM)、甘特条拖拽改期。

**Architecture:** 后端把 `project_tasks` 四个日期列从 `String(32)` 迁为真正 `Date`(含启动时幂等数据迁移),新增 `project_task_deps` 表与依赖/甘特/CPM 的 CRUD 与端点;前端在"项目视图"tab 内新增自研 `GanttView`(SVG),并在任务编辑弹窗加"依赖"区。沿用既有领域模块模式与权限单一事实源。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + PostgreSQL(测试用 SQLite);React 18 + TypeScript + Vite + Tailwind + Zustand + Axios。

参考设计文档:`docs/superpowers/specs/2026-06-25-project-management-phase2-3-design.md`

---

## 文件结构总览

**后端(修改)**
- `permissions/permissions.json` — 新增 `project.task:depend`
- `backend/app/models_project.py` — 4 个日期列改 `Date`;新增 `ProjectTaskDep`
- `backend/app/main.py` — 启动迁移块新增日期列类型迁移
- `backend/app/schemas_project.py` — 日期字段改 `date`;新增 `DepCreate`
- `backend/app/crud_project.py` — 日期序列化 isoformat;依赖 CRUD + DAG 校验;`compute_schedule`(CPM)+ `get_gantt_data`;删任务连带删依赖
- `backend/app/routers/projects.py` — 依赖端点 + `/gantt` 端点

**后端(新增测试)**
- `backend/tests/test_project_deps.py` — 依赖 CRUD / DAG / CPM / 甘特数据
- `backend/tests/test_project_date_migration.py` — 日期迁移幂等与容错

**前端(新增)**
- `frontend/src/pages/Project/gantt/ganttUtils.ts` — 类型 + 时间轴/布局/日期数学工具
- `frontend/src/pages/Project/gantt/GanttView.tsx` — 自研 SVG 甘特组件

**前端(修改)**
- `frontend/src/types/project.ts` — 依赖/甘特类型;`ProjectTask` 日期保持 string(ISO)
- `frontend/src/services/projectApi.ts` — `getGantt / listDeps / addDep / removeDep`
- `frontend/src/pages/Project/Projects.tsx` — "项目视图" tab 渲染 `GanttView`
- `frontend/src/pages/Project/TaskEditModal.tsx` — "依赖"区

---

## Task 1: 权限定义(project.task:depend)

**Files:**
- Modify: `permissions/permissions.json`
- Verify: `backend/app/permissions/_generated.py` / `frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 在 permissions.json 新增权限项**

在 `permissions/permissions.json` 的 `"permissions"` 对象内,`"project.task:link"` 行附近加入一行:

```json
    "project.task:depend": { "roles": ["admin", "engineer", "production"], "object_policy": "project_manager_or_admin" },
```

> 对象级策略 `project_manager_or_admin` 已在第 1 期注册(`policies.py`),无需新增策略函数。

- [ ] **Step 2: 生成权限代码**

Run:
```bash
cd D:/OpenCode/myPDM && python tools/gen_permissions.py
```
Expected: 生成成功;`backend/app/permissions/_generated.py` 与 `frontend/src/constants/permissions.generated.ts` 出现 `project.task:depend`。

- [ ] **Step 3: 运行权限同步测试**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_permissions_sync.py -v
```
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(project): 新增任务依赖管理权限 project.task:depend"
```

---

## Task 2: 数据模型 — 日期列改 Date + 依赖表

**Files:**
- Modify: `backend/app/models_project.py`
- Test: `backend/tests/test_project_deps.py`

- [ ] **Step 1: 写依赖模型 + Date 列的失败测试**

创建 `backend/tests/test_project_deps.py`:

```python
import uuid
import datetime
from app import models_project  # noqa: F401
from app.models_project import Project, ProjectTask, ProjectTaskDep


def test_task_date_columns_accept_date_objects(db):
    p = Project(code="PRJ-001", name="X", owner_id=uuid.uuid4())
    db.add(p); db.commit(); db.refresh(p)
    t = ProjectTask(
        project_id=p.id, code="PRJ-001-01", name="T",
        planned_start=datetime.date(2026, 1, 1), planned_end=datetime.date(2026, 1, 5),
    )
    db.add(t); db.commit(); db.refresh(t)
    assert t.planned_start == datetime.date(2026, 1, 1)
    assert t.planned_end == datetime.date(2026, 1, 5)


def test_dep_insert(db):
    pid = uuid.uuid4(); a = uuid.uuid4(); b = uuid.uuid4()
    d = ProjectTaskDep(project_id=pid, predecessor_id=a, successor_id=b,
                       dep_type="FS", lag_days=0)
    db.add(d); db.commit(); db.refresh(d)
    assert d.dep_type == "FS" and d.lag_days == 0
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -v
```
Expected: FAIL,`ImportError: cannot import name 'ProjectTaskDep'`。

- [ ] **Step 3: 修改模型文件**

在 `backend/app/models_project.py` 顶部 import 增加 `Date`:

```python
from sqlalchemy import Column, String, Integer, Text, DateTime, Date, ForeignKey
```

把 `ProjectTask` 中四个日期列由 `String(32)` 改为 `Date`:

```python
    planned_start = Column(Date, nullable=True)
    planned_end = Column(Date, nullable=True)
    actual_start = Column(Date, nullable=True)
    actual_end = Column(Date, nullable=True)
```

在文件末尾追加依赖模型:

```python
class ProjectTaskDep(Base):
    __tablename__ = "project_task_deps"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    predecessor_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    successor_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    dep_type = Column(String(2), nullable=False, default="FS")  # FS/SS/FF/SF
    lag_days = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -v
```
Expected: PASS(2 个测试)。

> 注:测试用 SQLite 内存库每次新建,`create_all` 直接按 `Date` 建列;无需迁移分支。生产 Postgres 的旧 varchar 列迁移见 Task 3。

- [ ] **Step 5: Commit**

```bash
git add backend/app/models_project.py backend/tests/test_project_deps.py
git commit -m "feat(project): 任务日期列改 Date 类型 + 新增任务依赖表"
```

---

## Task 3: 日期列类型迁移(Postgres varchar → date)

**Files:**
- Modify: `backend/app/main.py`(启动迁移块,`Base.metadata.create_all(bind=engine)` 之后)
- Test: `backend/tests/test_project_date_migration.py`

- [ ] **Step 1: 写迁移辅助函数的失败测试**

创建 `backend/tests/test_project_date_migration.py`:

```python
from app.migrations_project import parse_iso_date


def test_parse_valid_iso():
    import datetime
    assert parse_iso_date("2026-01-05") == datetime.date(2026, 1, 5)


def test_parse_invalid_returns_none():
    assert parse_iso_date("") is None
    assert parse_iso_date(None) is None
    assert parse_iso_date("not-a-date") is None
    assert parse_iso_date("2026/01/05") is None
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_date_migration.py -v
```
Expected: FAIL,`ModuleNotFoundError: No module named 'app.migrations_project'`。

- [ ] **Step 3: 创建迁移辅助模块**

创建 `backend/app/migrations_project.py`:

```python
"""项目管理 - 启动迁移辅助"""
import datetime
from sqlalchemy import text


def parse_iso_date(v):
    """把 'YYYY-MM-DD' 解析为 date;无法解析或空返回 None。"""
    if not v:
        return None
    if isinstance(v, datetime.date):
        return v
    try:
        return datetime.datetime.strptime(str(v).strip(), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


_DATE_COLS = ("planned_start", "planned_end", "actual_start", "actual_end")


def migrate_task_dates_to_date(db, engine):
    """把 project_tasks 四个日期列从 varchar 迁为 date(仅 Postgres,幂等)。

    SQLite 无需迁移(测试库每次按模型新建)。Postgres 旧库若列仍是字符型,
    逐行解析后 ALTER TYPE;无法解析的值置 NULL。
    """
    if engine.dialect.name != "postgresql":
        return
    insp_sql = text(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = 'project_tasks' AND column_name = :col"
    )
    for col in _DATE_COLS:
        row = db.execute(insp_sql, {"col": col}).fetchone()
        if not row:
            continue  # 列不存在(全新库交由 create_all)
        data_type = row[0]
        if data_type == "date":
            continue  # 已迁移,幂等跳过
        # 先把非法/空字符串规整为可转换或 NULL
        db.execute(text(
            f"UPDATE project_tasks SET {col} = NULL "
            f"WHERE {col} IS NOT NULL AND {col} !~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$'"
        ))
        db.commit()
        db.execute(text(
            f"ALTER TABLE project_tasks ALTER COLUMN {col} TYPE date "
            f"USING NULLIF({col}, '')::date"
        ))
        db.commit()
        print(f"✓ Migrated project_tasks.{col} varchar -> date")
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_date_migration.py -v
```
Expected: PASS。

- [ ] **Step 5: 在 main.py 调用迁移**

在 `backend/app/main.py` 的 `Base.metadata.create_all(bind=engine)`(约第 501 行)之后、`_col_default_sql` 定义之前,加入:

```python
            # 项目任务日期列 varchar -> date(Postgres 旧库迁移,幂等)
            try:
                from app.migrations_project import migrate_task_dates_to_date
                migrate_task_dates_to_date(db, engine)
            except Exception as _de:
                db.rollback()
                print(f"⚠ Task date migration skipped: {_de}")
```

- [ ] **Step 6: 验证应用可导入**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "from app.main import app; print('ok')"
```
Expected: 打印 `ok`,无导入错误。

- [ ] **Step 7: Commit**

```bash
git add backend/app/migrations_project.py backend/app/main.py backend/tests/test_project_date_migration.py
git commit -m "feat(project): 启动时迁移任务日期列为 date 类型"
```

---

## Task 4: Schemas — 日期字段改 date + DepCreate

**Files:**
- Modify: `backend/app/schemas_project.py`

- [ ] **Step 1: 修改 schema 日期字段类型并新增依赖 schema**

在 `backend/app/schemas_project.py` 顶部 import 增加 `date`:

```python
from datetime import datetime, date
```

把 `TaskCreate` 与 `TaskEdit` 中四个日期字段由 `Optional[str]` 改为 `Optional[date]`(Pydantic v2 会自动解析 `'YYYY-MM-DD'` 字符串为 `date`):

```python
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
```

> `ProjectCreate` / `ProjectEdit` 的 `planned_start/planned_end` 暂保持 `Optional[str]`(项目级日期本期不参与甘特计算,避免牵动第 1 期项目表)。

在文件末尾追加依赖 schema:

```python
# ---- 任务依赖 ----
class DepCreate(BaseSchema):
    predecessor_id: str
    successor_id: str
    dep_type: Literal["FS", "SS", "FF", "SF"] = "FS"
    lag_days: int = 0
```

- [ ] **Step 2: 验证可导入**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "import app.schemas_project as s; print(s.DepCreate, s.TaskCreate.model_fields['planned_start'].annotation)"
```
Expected: 打印 `DepCreate` 类与 `typing.Optional[datetime.date]`(或 `date | None`)。

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas_project.py
git commit -m "feat(project): 任务日期 schema 改 date + 新增 DepCreate"
```

---

## Task 5: CRUD — 日期序列化修正

**Files:**
- Modify: `backend/app/crud_project.py`(`get_task_tree` 内日期 isoformat)
- Modify: `backend/app/routers/projects.py`(`_task_dict` 内日期 isoformat)
- Test: `backend/tests/test_project_crud.py`(已存在,补一条)

> 背景:日期列改 `Date` 后,`t.planned_start` 是 `date` 对象;序列化为前端需 `isoformat()`,否则 JSON 编码不一致 / 树测试比较失败。

- [ ] **Step 1: 写日期序列化失败测试**

在 `backend/tests/test_project_crud.py` 末尾追加:

```python
import datetime as _dt
from app.schemas_project import TaskCreate as _TC


def test_task_tree_serializes_dates_as_iso(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="DateProj"), owner.id)
    crud_project.create_task(db, p, _TC(name="T", planned_start=_dt.date(2026, 1, 1),
                                        planned_end=_dt.date(2026, 1, 5)))
    tree = crud_project.get_task_tree(db, p.id)
    assert tree[0]["planned_start"] == "2026-01-01"
    assert tree[0]["planned_end"] == "2026-01-05"
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py::test_task_tree_serializes_dates_as_iso -v
```
Expected: FAIL(返回的是 `date` 对象,不等于字符串)。

- [ ] **Step 3: 在 crud_project.py 增加日期序列化辅助并用于 get_task_tree**

在 `backend/app/crud_project.py` 顶部辅助区(`_uuid` 函数附近)加入:

```python
def _iso(d):
    """date -> 'YYYY-MM-DD';None -> None;已是字符串原样返回。"""
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)
```

在 `get_task_tree` 组装节点 dict 处,把四个日期字段改为经 `_iso` 包裹:

```python
            "planned_start": _iso(t.planned_start), "planned_end": _iso(t.planned_end),
            "actual_start": _iso(t.actual_start), "actual_end": _iso(t.actual_end),
```

- [ ] **Step 4: 在 routers/projects.py 的 _task_dict 同样处理**

在 `backend/app/routers/projects.py` 顶部 import `_iso`(或在文件内复用 crud 的):把 `_task_dict` 的日期字段改为:

```python
            "planned_start": crud_project._iso(t.planned_start),
            "planned_end": crud_project._iso(t.planned_end),
            "actual_start": crud_project._iso(t.actual_start),
            "actual_end": crud_project._iso(t.actual_end),
```

- [ ] **Step 5: 运行全部项目 CRUD 测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_crud.py -v
```
Expected: PASS(含新增序列化测试 + 既有不回归)。

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_project.py backend/app/routers/projects.py backend/tests/test_project_crud.py
git commit -m "fix(project): 任务日期统一 isoformat 序列化"
```

---

## Task 6: CRUD — 依赖增删列 + DAG 校验 + 删任务连带删依赖

**Files:**
- Modify: `backend/app/crud_project.py`
- Test: `backend/tests/test_project_deps.py`(追加)

- [ ] **Step 1: 追加依赖 CRUD 的失败测试**

在 `backend/tests/test_project_deps.py` 末尾追加:

```python
import pytest
from fastapi import HTTPException
from app import crud_project
from app.schemas_project import ProjectCreate, TaskCreate, DepCreate


def _mk_user(db, role="engineer"):
    from app import models
    import uuid as _u
    u = models.User(id=_u.uuid4(), username=f"u{_u.uuid4().hex[:6]}",
                    password_hash="x", real_name="T", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _mk_proj_tasks(db, n=3):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="P"), owner.id)
    tasks = [crud_project.create_task(db, p, TaskCreate(name=f"T{i}")) for i in range(n)]
    return p, tasks


def test_add_list_remove_dep(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    d = crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    assert d.dep_type == "FS"
    assert len(crud_project.list_deps(db, p.id)) == 1
    crud_project.remove_dep(db, p.id, d.id)
    assert len(crud_project.list_deps(db, p.id)) == 0


def test_self_loop_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    with pytest.raises(HTTPException) as ei:
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(a.id)))
    assert ei.value.status_code == 400


def test_duplicate_dep_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    with pytest.raises(HTTPException) as ei:
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    assert ei.value.status_code == 400


def test_cycle_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(b.id), successor_id=str(c.id)))
    with pytest.raises(HTTPException) as ei:  # c->a 会成环 a->b->c->a
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(c.id), successor_id=str(a.id)))
    assert ei.value.status_code == 400


def test_delete_task_removes_deps(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    crud_project.delete_task(db, a)
    assert len(crud_project.list_deps(db, p.id)) == 0
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -k "dep or loop or cycle or removes" -v
```
Expected: FAIL,`AttributeError: module 'app.crud_project' has no attribute 'add_dep'`。

- [ ] **Step 3: 追加依赖 CRUD 到 crud_project.py**

先在 `crud_project.py` 顶部 import 增加 `ProjectTaskDep` 与 `DepCreate`:

```python
from app.models_project import (
    Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment, ProjectTaskDep,
)
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
)
```

在文件末尾追加:

```python
# ════════════════════════ 任务依赖 ════════════════════════
def list_deps(db: Session, project_id: uuid.UUID) -> list:
    return db.query(ProjectTaskDep).filter(ProjectTaskDep.project_id == project_id).all()


def _would_create_cycle(db: Session, project_id: uuid.UUID, pred_id, succ_id) -> bool:
    """加入 pred->succ 后是否成环:即 succ 是否已能到达 pred。"""
    edges = {}
    for d in list_deps(db, project_id):
        edges.setdefault(d.predecessor_id, []).append(d.successor_id)
    edges.setdefault(pred_id, []).append(succ_id)
    # 从 succ 出发 DFS,看能否回到 pred
    stack = [succ_id]; seen = set()
    while stack:
        cur = stack.pop()
        if cur == pred_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(edges.get(cur, []))
    return False


def add_dep(db: Session, project_id: uuid.UUID, data: DepCreate) -> ProjectTaskDep:
    pred = _uuid(data.predecessor_id); succ = _uuid(data.successor_id)
    if pred == succ:
        raise HTTPException(status_code=400, detail="任务不能依赖自身")
    # 任务须存在且属于本项目
    for tid in (pred, succ):
        t = db.query(ProjectTask).filter(
            ProjectTask.id == tid, ProjectTask.project_id == project_id,
            ProjectTask.deleted_at.is_(None)
        ).first()
        if not t:
            raise HTTPException(status_code=404, detail="任务不存在或不属于该项目")
    exists = db.query(ProjectTaskDep).filter(
        ProjectTaskDep.predecessor_id == pred, ProjectTaskDep.successor_id == succ
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="该依赖已存在")
    if _would_create_cycle(db, project_id, pred, succ):
        raise HTTPException(status_code=400, detail="依赖会形成循环")
    d = ProjectTaskDep(project_id=project_id, predecessor_id=pred, successor_id=succ,
                       dep_type=data.dep_type, lag_days=data.lag_days)
    db.add(d); db.commit(); db.refresh(d)
    return d


def remove_dep(db: Session, project_id: uuid.UUID, dep_id: uuid.UUID):
    db.query(ProjectTaskDep).filter(
        ProjectTaskDep.id == dep_id, ProjectTaskDep.project_id == project_id
    ).delete()
    db.commit()
```

- [ ] **Step 4: 在 delete_task 末尾连带删除相关依赖**

在 `crud_project.py` 的 `delete_task` 函数中,`db.commit()` 之前,把被软删任务集合的相关依赖硬删。把 `delete_task` 改为收集被删 id 后删依赖:

找到 `delete_task` 中 `while to_delete:` 循环,改为先收集所有被删 id:

```python
def delete_task(db: Session, t: ProjectTask):
    """软删任务及其整棵子树,并硬删相关依赖。"""
    now = datetime.now(timezone.utc)
    deleted_ids = []
    to_delete = [t.id]
    while to_delete:
        current = to_delete.pop()
        task = db.query(ProjectTask).filter(ProjectTask.id == current).first()
        if task and task.deleted_at is None:
            task.deleted_at = now
            deleted_ids.append(current)
            children = db.query(ProjectTask.id).filter(
                ProjectTask.parent_id == current, ProjectTask.deleted_at.is_(None)
            ).all()
            to_delete.extend([c[0] for c in children])
    if deleted_ids:
        db.query(ProjectTaskDep).filter(
            (ProjectTaskDep.predecessor_id.in_(deleted_ids)) |
            (ProjectTaskDep.successor_id.in_(deleted_ids))
        ).delete(synchronize_session=False)
    db.commit()
```

- [ ] **Step 5: 运行依赖测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -v
```
Expected: PASS(全部依赖测试)。

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_deps.py
git commit -m "feat(project): 任务依赖 CRUD + DAG 校验 + 删任务连带删依赖"
```

---

## Task 7: CRUD — CPM 关键路径 + 甘特数据组装

**Files:**
- Modify: `backend/app/crud_project.py`
- Test: `backend/tests/test_project_deps.py`(追加)

- [ ] **Step 1: 写 CPM / 甘特数据的失败测试**

在 `backend/tests/test_project_deps.py` 末尾追加:

```python
import datetime as _dt


def test_cpm_linear_chain_all_critical(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="CP"), owner.id)
    a = crud_project.create_task(db, p, TaskCreate(name="A",
        planned_start=_dt.date(2026, 1, 1), planned_end=_dt.date(2026, 1, 2)))
    b = crud_project.create_task(db, p, TaskCreate(name="B",
        planned_start=_dt.date(2026, 1, 3), planned_end=_dt.date(2026, 1, 4)))
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    data = crud_project.get_gantt_data(db, p.id)
    crit = {t["id"]: t["is_critical"] for t in data["tasks"]}
    assert crit[str(a.id)] is True and crit[str(b.id)] is True


def test_cpm_parallel_branch_has_slack(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="CP2"), owner.id)
    a = crud_project.create_task(db, p, TaskCreate(name="A",
        planned_start=_dt.date(2026, 1, 1), planned_end=_dt.date(2026, 1, 1)))
    long = crud_project.create_task(db, p, TaskCreate(name="LONG",
        planned_start=_dt.date(2026, 1, 2), planned_end=_dt.date(2026, 1, 10)))
    short = crud_project.create_task(db, p, TaskCreate(name="SHORT",
        planned_start=_dt.date(2026, 1, 2), planned_end=_dt.date(2026, 1, 3)))
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(long.id)))
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(short.id)))
    data = crud_project.get_gantt_data(db, p.id)
    crit = {t["id"]: t["is_critical"] for t in data["tasks"]}
    assert crit[str(long.id)] is True       # 长支在关键路径
    assert crit[str(short.id)] is False      # 短支有浮动


def test_gantt_violation_flag(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="V"), owner.id)
    a = crud_project.create_task(db, p, TaskCreate(name="A",
        planned_start=_dt.date(2026, 1, 5), planned_end=_dt.date(2026, 1, 10)))
    b = crud_project.create_task(db, p, TaskCreate(name="B",
        planned_start=_dt.date(2026, 1, 1), planned_end=_dt.date(2026, 1, 3)))  # B 早于 A 完成
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))  # FS 违规
    data = crud_project.get_gantt_data(db, p.id)
    assert data["deps"][0]["is_violation"] is True


def test_gantt_no_dates_no_crash(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="ND"), owner.id)
    crud_project.create_task(db, p, TaskCreate(name="NoDate"))  # 无日期
    data = crud_project.get_gantt_data(db, p.id)
    assert data["tasks"][0]["is_critical"] is False
    assert data["range"]["min_date"] is None
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -k "cpm or gantt" -v
```
Expected: FAIL,`AttributeError: module 'app.crud_project' has no attribute 'get_gantt_data'`。

- [ ] **Step 3: 追加 CPM + 甘特组装到 crud_project.py**

在 `crud_project.py` 末尾追加:

```python
# ════════════════════════ 甘特 / CPM ════════════════════════
_DEP_OK = {
    # 约束:返回 succ 必须满足的最早(以"天序号"计)。ok = 实际 >= 约束
    "FS": lambda ps, pe, lag: ("start", pe + lag),   # succ_start >= pred_end + lag
    "SS": lambda ps, pe, lag: ("start", ps + lag),   # succ_start >= pred_start + lag
    "FF": lambda ps, pe, lag: ("end", pe + lag),     # succ_end   >= pred_end + lag
    "SF": lambda ps, pe, lag: ("end", ps + lag),     # succ_end   >= pred_start + lag
}


def _leaf_ids(tasks) -> set:
    parents = {t.parent_id for t in tasks if t.parent_id is not None}
    return {t.id for t in tasks if t.id not in parents}


def compute_schedule(db: Session, project_id: uuid.UUID, tasks=None, deps=None) -> set:
    """经典 CPM:仅对有完整计划日期的叶任务,按依赖+工期算 slack。
    返回关键路径任务 id 集合(slack==0)。无法计算时返回空集。"""
    if tasks is None:
        tasks = db.query(ProjectTask).filter(
            ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
        ).all()
    if deps is None:
        deps = list_deps(db, project_id)
    leaves = _leaf_ids(tasks)
    dur = {}
    for t in tasks:
        if t.id in leaves and t.planned_start and t.planned_end:
            dur[t.id] = (t.planned_end - t.planned_start).days + 1
    if not dur:
        return set()
    # 仅保留两端都在 CPM 集合内的依赖
    edges = [(d.predecessor_id, d.successor_id, d.dep_type, d.lag_days)
             for d in deps if d.predecessor_id in dur and d.successor_id in dur]
    succ_map = {}; pred_map = {}; indeg = {tid: 0 for tid in dur}
    for pr, su, _ty, _lg in edges:
        succ_map.setdefault(pr, []).append((su, _ty, _lg))
        pred_map.setdefault(su, []).append((pr, _ty, _lg))
        indeg[su] += 1
    # 拓扑序
    order = [tid for tid in dur if indeg[tid] == 0]
    topo = []; idq = list(order)
    indeg2 = dict(indeg)
    while idq:
        n = idq.pop(0); topo.append(n)
        for su, _ty, _lg in succ_map.get(n, []):
            indeg2[su] -= 1
            if indeg2[su] == 0:
                idq.append(su)
    if len(topo) != len(dur):
        return set()  # 异常成环,降级
    # 前向:ES/EF(以天序号,起点 0)
    ES = {}; EF = {}
    for n in topo:
        es = 0
        for pr, ty, lg in pred_map.get(n, []):
            kind, bound = _DEP_OK[ty](ES[pr], EF[pr], lg)
            es = max(es, bound if kind == "start" else bound - dur[n] + 1)
        ES[n] = es; EF[n] = es + dur[n] - 1
    project_end = max(EF.values())
    # 后向:LF/LS
    LF = {}; LS = {}
    for n in reversed(topo):
        succs = succ_map.get(n, [])
        if not succs:
            lf = project_end
        else:
            lf = min(
                (LS[su] if ty in ("FS", "SS") else LF[su]) - lg - (0 if ty in ("FF", "SF") else 1)
                + (1 if ty in ("FF", "SF") else 0)
                for su, ty, lg in succs
            )
        LF[n] = lf; LS[n] = lf - dur[n] + 1
    return {n for n in dur if (LS[n] - ES[n]) == 0}


def _violation(dep, tasks_by_id) -> bool:
    pr = tasks_by_id.get(dep.predecessor_id); su = tasks_by_id.get(dep.successor_id)
    if not pr or not su:
        return False
    if not (pr.planned_start and pr.planned_end and su.planned_start and su.planned_end):
        return False
    ps = pr.planned_start.toordinal(); pe = pr.planned_end.toordinal()
    ss = su.planned_start.toordinal(); se = su.planned_end.toordinal()
    kind, bound = _DEP_OK[dep.dep_type](ps, pe, dep.lag_days)
    actual = ss if kind == "start" else se
    return actual < bound


def get_gantt_data(db: Session, project_id: uuid.UUID) -> dict:
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    deps = list_deps(db, project_id)
    critical = compute_schedule(db, project_id, tasks, deps)
    user_names = {u.id: u.real_name for u in db.query(User).all()}
    tasks_by_id = {t.id: t for t in tasks}
    # 计算 depth
    depth = {}
    def _depth(t):
        if t.id in depth:
            return depth[t.id]
        d = 0 if not t.parent_id else _depth(tasks_by_id[t.parent_id]) + 1 if t.parent_id in tasks_by_id else 0
        depth[t.id] = d
        return d
    today = datetime.now(timezone.utc).date()
    out_tasks = []
    dates = []
    for t in tasks:
        ps, pe = t.planned_start, t.planned_end
        if ps:
            dates.append(ps)
        if pe:
            dates.append(pe)
        is_overdue = bool(pe and pe < today and t.status != "已完成")
        out_tasks.append({
            "id": str(t.id), "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type, "status": t.status,
            "assignee_name": user_names.get(t.assignee_id) if t.assignee_id else None,
            "planned_start": _iso(ps), "planned_end": _iso(pe),
            "duration_days": ((pe - ps).days + 1) if (ps and pe) else None,
            "is_critical": t.id in critical, "is_overdue": is_overdue,
            "sort_order": t.sort_order, "depth": _depth(t),
        })
    out_deps = [{
        "id": str(d.id), "predecessor_id": str(d.predecessor_id),
        "successor_id": str(d.successor_id), "dep_type": d.dep_type,
        "lag_days": d.lag_days, "is_violation": _violation(d, tasks_by_id),
    } for d in deps]
    return {
        "tasks": out_tasks, "deps": out_deps,
        "range": {"min_date": _iso(min(dates)) if dates else None,
                  "max_date": _iso(max(dates)) if dates else None},
    }
```

- [ ] **Step 4: 运行 CPM/甘特测试确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -k "cpm or gantt" -v
```
Expected: PASS(4 个测试)。若 `test_cpm_parallel_branch_has_slack` 失败,核对后向遍历的 LF 约束表达式与 `_DEP_OK` 是否一致。

- [ ] **Step 5: 运行全部依赖测试 + 全量回归**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_deps.py -q && python -m pytest -q
```
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_deps.py
git commit -m "feat(project): CPM 关键路径计算 + 甘特数据组装"
```

---

## Task 8: API 路由 — 依赖端点 + 甘特端点

**Files:**
- Modify: `backend/app/routers/projects.py`

- [ ] **Step 1: 在 routers/projects.py 增加导入**

确认/补充顶部导入(`DepCreate` 加入 schema 导入列表):

```python
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskStatusUpdate, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
)
```

- [ ] **Step 2: 在"任务关联对象"区块前/后加入依赖与甘特端点**

在 `routers/projects.py` 合适位置(如任务端点之后)加入:

```python
# ──────────── 甘特 ────────────
@router.get("/{project_id}/gantt")
async def get_gantt(project_id: uuid.UUID, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return crud_project.get_gantt_data(db, project_id)


# ──────────── 任务依赖 ────────────
@router.get("/{project_id}/deps")
async def list_deps(project_id: uuid.UUID, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [{
        "id": str(d.id), "predecessor_id": str(d.predecessor_id),
        "successor_id": str(d.successor_id), "dep_type": d.dep_type, "lag_days": d.lag_days,
    } for d in crud_project.list_deps(db, project_id)]}


@router.post("/{project_id}/deps")
async def add_dep(project_id: uuid.UUID, data: DepCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_permission("project.task:depend"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    d = crud_project.add_dep(db, project_id, data)
    return {"id": str(d.id), "predecessor_id": str(d.predecessor_id),
            "successor_id": str(d.successor_id), "dep_type": d.dep_type, "lag_days": d.lag_days}


@router.delete("/{project_id}/deps/{dep_id}")
async def remove_dep(project_id: uuid.UUID, dep_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project.task:depend"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    crud_project.remove_dep(db, project_id, dep_id)
    return {"detail": "已删除"}
```

- [ ] **Step 3: 验证路由注册**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "from app.main import app; print([r.path for r in app.routes if 'gantt' in r.path or 'deps' in r.path])"
```
Expected: 打印含 `/api/projects/{project_id}/gantt`、`/api/projects/{project_id}/deps`、`/api/projects/{project_id}/deps/{dep_id}`。

- [ ] **Step 4: 全量后端测试回归**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest -q
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/projects.py
git commit -m "feat(project): 依赖与甘特 API 端点"
```

---

## Task 9: 前端 — 类型与 API 服务

**Files:**
- Modify: `frontend/src/types/project.ts`
- Modify: `frontend/src/services/projectApi.ts`

- [ ] **Step 1: 在 types/project.ts 追加依赖与甘特类型**

在 `frontend/src/types/project.ts` 末尾追加:

```typescript
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskDependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  dep_type: DepType;
  lag_days: number;
  is_violation?: boolean;
}

export interface GanttTask {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  task_type: TaskType;
  status: TaskStatus;
  assignee_name?: string | null;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number | null;
  is_critical: boolean;
  is_overdue: boolean;
  sort_order: number;
  depth: number;
}

export interface GanttData {
  tasks: GanttTask[];
  deps: TaskDependency[];
  range: { min_date: string | null; max_date: string | null };
}
```

- [ ] **Step 2: 在 projectApi.ts 追加方法**

在 `frontend/src/services/projectApi.ts` 的 `projectApi` 对象内,`deleteComment` 之后加入:

```typescript
  getGantt: (id: string) => api.get(`/${id}/gantt`),
  listDeps: (id: string) => api.get(`/${id}/deps`),
  addDep: (id: string, data: { predecessor_id: string; successor_id: string; dep_type?: string; lag_days?: number }) =>
    api.post(`/${id}/deps`, data),
  removeDep: (id: string, depId: string) => api.delete(`/${id}/deps/${depId}`),
```

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误(若仓库本就有既存错误,确认未新增与本次相关的错误)。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/project.ts frontend/src/services/projectApi.ts
git commit -m "feat(project): 前端甘特/依赖类型与 API 服务"
```

---

## Task 10: 前端 — 甘特工具模块(时间轴/布局/日期数学)

**Files:**
- Create: `frontend/src/pages/Project/gantt/ganttUtils.ts`

- [ ] **Step 1: 创建 ganttUtils.ts**

创建 `frontend/src/pages/Project/gantt/ganttUtils.ts`:

```typescript
import type { GanttTask, TaskDependency } from '../../../types/project';

export type Scale = 'day' | 'week' | 'month';

export const DAY_PX: Record<Scale, number> = { day: 28, week: 10, month: 4 };
export const ROW_H = 32;
export const LEFT_W = 320; // 左侧任务名列宽

export function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function fmtISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 计算时间轴范围:任务最早开始 - 2 天 ~ 最晚结束 + 2 天;无日期时以今天为中心 ±15 天。 */
export function computeRange(tasks: GanttTask[]): { start: Date; end: Date } {
  const dates: Date[] = [];
  for (const t of tasks) {
    const s = parseDate(t.planned_start);
    const e = parseDate(t.planned_end);
    if (s) dates.push(s);
    if (e) dates.push(e);
  }
  if (dates.length === 0) {
    const today = new Date();
    return { start: addDays(today, -15), end: addDays(today, 15) };
  }
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  return { start: addDays(min, -2), end: addDays(max, 2) };
}

export interface BarBox {
  x: number; w: number; y: number;
}

/** 任务条几何:相对时间轴起点的像素位置。 */
export function barBox(t: GanttTask, rangeStart: Date, scale: Scale, rowIndex: number): BarBox | null {
  const s = parseDate(t.planned_start);
  const e = parseDate(t.planned_end);
  if (!s || !e) return null;
  const px = DAY_PX[scale];
  const x = daysBetween(rangeStart, s) * px;
  const w = Math.max(px, (daysBetween(s, e) + 1) * px);
  const y = rowIndex * ROW_H + 6;
  return { x, w, y };
}

/** 表头刻度:返回 [{x, label, major}]。 */
export function ticks(rangeStart: Date, rangeEnd: Date, scale: Scale): { x: number; label: string; major: boolean }[] {
  const px = DAY_PX[scale];
  const total = daysBetween(rangeStart, rangeEnd) + 1;
  const out: { x: number; label: string; major: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = addDays(rangeStart, i);
    if (scale === 'day') {
      out.push({ x: i * px, label: `${d.getMonth() + 1}/${d.getDate()}`, major: d.getDay() === 1 });
    } else if (scale === 'week') {
      if (d.getDay() === 1) out.push({ x: i * px, label: `${d.getMonth() + 1}/${d.getDate()}`, major: true });
    } else {
      if (d.getDate() === 1) out.push({ x: i * px, label: `${d.getFullYear()}-${d.getMonth() + 1}`, major: true });
    }
  }
  return out;
}

export const STATUS_FILL: Record<string, string> = {
  未开始: '#9ca3af',
  进行中: '#3b82f6',
  已完成: '#22c55e',
  挂起: '#eab308',
};

/** 依赖连线两端的锚点(返回前置端 x 与后置端 x 的取法)。 */
export function depAnchors(dep: TaskDependency): { from: 'start' | 'end'; to: 'start' | 'end' } {
  switch (dep.dep_type) {
    case 'SS': return { from: 'start', to: 'start' };
    case 'FF': return { from: 'end', to: 'end' };
    case 'SF': return { from: 'start', to: 'end' };
    case 'FS':
    default: return { from: 'end', to: 'start' };
  }
}
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Project/gantt/ganttUtils.ts
git commit -m "feat(project): 甘特工具模块(时间轴/布局/日期数学)"
```

---

## Task 11: 前端 — GanttView 组件(SVG 渲染 + 拖拽改期)

**Files:**
- Create: `frontend/src/pages/Project/gantt/GanttView.tsx`

- [ ] **Step 1: 创建 GanttView.tsx**

创建 `frontend/src/pages/Project/gantt/GanttView.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectApi } from '../../../services/projectApi';
import type { GanttData, GanttTask } from '../../../types/project';
import type { Scale } from './ganttUtils';
import {
  DAY_PX, ROW_H, LEFT_W, parseDate, daysBetween, addDays, fmtISO,
  computeRange, barBox, ticks, STATUS_FILL, depAnchors,
} from './ganttUtils';

interface Props {
  projectId: string;
  canEdit: boolean;                 // 能否拖拽改期(经理/admin)
  onTaskUpdated?: () => void;       // 改期后回调(刷新详情等)
}

export default function GanttView({ projectId, canEdit, onTaskUpdated }: Props) {
  const [data, setData] = useState<GanttData | null>(null);
  const [scale, setScale] = useState<Scale>('day');
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize-l' | 'resize-r'; startX: number; origStart: Date; origEnd: Date } | null>(null);
  const [preview, setPreview] = useState<Record<string, { start: string; end: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await projectApi.getGantt(projectId);
      setData(res.data);
      setPreview({});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (projectId) load(); /* eslint-disable-next-line */ }, [projectId]);

  const range = useMemo(() => (data ? computeRange(data.tasks) : null), [data]);
  const px = DAY_PX[scale];

  // 应用拖拽预览到任务的有效日期
  const effTask = (t: GanttTask): GanttTask => {
    const p = preview[t.id];
    return p ? { ...t, planned_start: p.start, planned_end: p.end } : t;
  };

  const onMouseDown = (e: React.MouseEvent, t: GanttTask, mode: 'move' | 'resize-l' | 'resize-r') => {
    if (!canEdit) return;
    const s = parseDate(t.planned_start); const en = parseDate(t.planned_end);
    if (!s || !en) return;
    e.preventDefault();
    setDrag({ id: t.id, mode, startX: e.clientX, origStart: s, origEnd: en });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const deltaDays = Math.round((e.clientX - drag.startX) / px);
      let ns = drag.origStart; let ne = drag.origEnd;
      if (drag.mode === 'move') { ns = addDays(drag.origStart, deltaDays); ne = addDays(drag.origEnd, deltaDays); }
      else if (drag.mode === 'resize-l') { ns = addDays(drag.origStart, deltaDays); if (ns > ne) ns = ne; }
      else { ne = addDays(drag.origEnd, deltaDays); if (ne < ns) ne = ns; }
      setPreview((p) => ({ ...p, [drag.id]: { start: fmtISO(ns), end: fmtISO(ne) } }));
    };
    const onUp = async () => {
      const pv = preview[drag.id];
      const d = drag; setDrag(null);
      if (pv) {
        try {
          await projectApi.updateTask(projectId, d.id, { planned_start: pv.start, planned_end: pv.end });
          onTaskUpdated?.();
          await load();
        } catch {
          await load(); // 失败回滚为服务端值
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    /* eslint-disable-next-line */
  }, [drag, preview, px, projectId]);

  if (loading && !data) return <div className="p-8 text-center text-gray-400">加载甘特图...</div>;
  if (!data || !range) return null;
  if (data.tasks.length === 0) return <div className="p-8 text-center text-gray-400">该项目还没有任务,先在"项目详情"中添加任务。</div>;

  const totalDays = daysBetween(range.start, range.end) + 1;
  const chartW = totalDays * px;
  const chartH = data.tasks.length * ROW_H;
  const rowIndex: Record<string, number> = {};
  data.tasks.forEach((t, i) => { rowIndex[t.id] = i; });
  const tickList = ticks(range.start, range.end, scale);
  const todayX = daysBetween(range.start, new Date()) * px;

  // 依赖连线路径
  const depPaths = data.deps.map((dep) => {
    const pt = data.tasks.find((t) => t.id === dep.predecessor_id);
    const st = data.tasks.find((t) => t.id === dep.successor_id);
    if (!pt || !st) return null;
    const pb = barBox(effTask(pt), range.start, scale, rowIndex[pt.id]);
    const sb = barBox(effTask(st), range.start, scale, rowIndex[st.id]);
    if (!pb || !sb) return null;
    const a = depAnchors(dep);
    const x1 = a.from === 'end' ? pb.x + pb.w : pb.x;
    const y1 = pb.y + (ROW_H - 12) / 2;
    const x2 = a.to === 'end' ? sb.x + sb.w : sb.x;
    const y2 = sb.y + (ROW_H - 12) / 2;
    const midX = (x1 + x2) / 2;
    return (
      <path key={dep.id} d={`M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`}
        fill="none" stroke={dep.is_violation ? '#ef4444' : '#94a3b8'}
        strokeWidth={dep.is_violation ? 2 : 1.2} markerEnd="url(#arrow)" />
    );
  });

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm text-gray-500">视图:</span>
        {(['day', 'week', 'month'] as Scale[]).map((s) => (
          <button key={s} onClick={() => setScale(s)}
            className={`px-2 py-1 text-xs rounded ${scale === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>
            {s === 'day' ? '日' : s === 'week' ? '周' : '月'}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-2 py-1 text-xs rounded bg-white border border-gray-300 text-gray-600">刷新</button>
      </div>

      <div className="flex overflow-auto" style={{ maxHeight: '70vh' }}>
        {/* 左侧任务名列 */}
        <div className="shrink-0 border-r border-gray-200" style={{ width: LEFT_W }}>
          <div className="h-8 bg-gray-50 border-b border-gray-200 flex items-center px-2 text-xs font-medium text-gray-500">任务</div>
          {data.tasks.map((t) => (
            <div key={t.id} className="flex items-center border-b border-gray-100 text-sm"
              style={{ height: ROW_H, paddingLeft: 8 + t.depth * 16 }}>
              <span className="text-gray-400 mr-1">
                {t.task_type === '里程碑' ? '🏁' : t.task_type === '评审' ? '🔎' : '📋'}
              </span>
              <span className={`truncate ${t.is_critical ? 'text-red-600 font-medium' : 'text-gray-700'}`} title={`${t.code} ${t.name}`}>
                {t.name}
              </span>
            </div>
          ))}
        </div>

        {/* 右侧时间轴画布 */}
        <div className="relative" style={{ width: chartW }}>
          {/* 表头 */}
          <div className="sticky top-0 h-8 bg-gray-50 border-b border-gray-200 z-10" style={{ width: chartW }}>
            {tickList.map((tk, i) => (
              <div key={i} className={`absolute top-0 h-8 text-[10px] flex items-center ${tk.major ? 'text-gray-600' : 'text-gray-300'}`}
                style={{ left: tk.x, borderLeft: tk.major ? '1px solid #e5e7eb' : 'none', paddingLeft: 2 }}>
                {tk.label}
              </div>
            ))}
          </div>

          <svg width={chartW} height={chartH} className="block">
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
              </marker>
            </defs>
            {/* 行底纹 */}
            {data.tasks.map((t, i) => (
              <rect key={`bg-${t.id}`} x={0} y={i * ROW_H} width={chartW} height={ROW_H}
                fill={i % 2 ? '#fafafa' : '#fff'} />
            ))}
            {/* today 竖线 */}
            {todayX >= 0 && todayX <= chartW && (
              <line x1={todayX} y1={0} x2={todayX} y2={chartH} stroke="#f97316" strokeWidth={1} strokeDasharray="3,3" />
            )}
            {/* 依赖连线 */}
            {depPaths}
            {/* 任务条 */}
            {data.tasks.map((t) => {
              const box = barBox(effTask(t), range.start, scale, rowIndex[t.id]);
              if (!box) return null;
              const isParent = data.tasks.some((c) => c.parent_id === t.id);
              if (t.task_type === '里程碑') {
                const cx = box.x; const cy = box.y + 6;
                return <rect key={t.id} x={cx - 7} y={cy - 7} width={14} height={14}
                  transform={`rotate(45 ${cx} ${cy})`}
                  fill={t.is_overdue ? '#ef4444' : '#6366f1'} stroke={t.is_critical ? '#dc2626' : 'none'} strokeWidth={2} />;
              }
              const fill = t.is_overdue ? '#ef4444' : STATUS_FILL[t.status] || '#9ca3af';
              return (
                <g key={t.id}>
                  <rect x={box.x} y={box.y} width={box.w} height={12} rx={3}
                    fill={isParent ? '#cbd5e1' : fill} opacity={isParent ? 0.7 : 1}
                    stroke={t.is_critical ? '#dc2626' : 'none'} strokeWidth={t.is_critical ? 2 : 0}
                    style={{ cursor: canEdit && !isParent ? 'grab' : 'default' }}
                    onMouseDown={(e) => !isParent && onMouseDown(e, t, 'move')} />
                  {canEdit && !isParent && (
                    <>
                      <rect x={box.x - 3} y={box.y} width={6} height={12} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => onMouseDown(e, t, 'resize-l')} />
                      <rect x={box.x + box.w - 3} y={box.y} width={6} height={12} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => onMouseDown(e, t, 'resize-r')} />
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Project/gantt/GanttView.tsx
git commit -m "feat(project): 自研 SVG 甘特视图组件(时间轴/依赖连线/拖拽改期)"
```

---

## Task 12: 前端 — 把甘特接入"项目视图" tab

**Files:**
- Modify: `frontend/src/pages/Project/Projects.tsx`

- [ ] **Step 1: 在 Projects.tsx 引入 GanttView 并替换占位**

在 `frontend/src/pages/Project/Projects.tsx` 顶部 import 区加入:

```tsx
import GanttView from './gantt/GanttView';
import { can } from '../../utils/permissions'; // 若已存在 can 工具,沿用现有导入路径
```

> 实施时先确认 `can` 的实际导入路径(项目中其他页面如何判定权限,例如 `useAuthStore` + `can(perm)`);若已在本文件导入,跳过重复导入。

找到渲染 `tab === 'view'` 的占位块(当前为 `项目视图 — 甘特图等功能即将上线`),替换为:

```tsx
        {tab === 'view' && (
          <div className="p-4">
            {!selectedProjectId ? (
              <div className="text-center text-gray-400 py-12">请从项目汇总中选择一个项目</div>
            ) : (
              <GanttView
                projectId={selectedProjectId}
                canEdit={can('project.task:depend')}
                onTaskUpdated={() => loadTasks(selectedProjectId)}
              />
            )}
          </div>
        )}
```

> `canEdit` 用 `project.task:depend`(经理/admin 经对象策略)近似"可改期"。若需更精确,可在实施时改为 `can('project.task:update')` 并叠加"是否本项目经理"的判断;本期用角色级近似即可。

- [ ] **Step 2: 构建验证**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: build 成功,无类型/编译错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Project/Projects.tsx
git commit -m "feat(project): 项目视图 tab 接入甘特图"
```

---

## Task 13: 前端 — 任务编辑弹窗"依赖"区

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

- [ ] **Step 1: 在 TaskEditModal 增加依赖状态与加载**

在 `frontend/src/pages/Project/TaskEditModal.tsx`,参照其已有"关联对象"区的写法(`listLinks/addLink/removeLink` 模式),新增依赖区。先在组件内加入状态与加载逻辑(放在已有 links/comments state 附近):

```tsx
  const [deps, setDeps] = useState<TaskDependency[]>([]);
  const [allTasks, setAllTasks] = useState<{ id: string; code: string; name: string }[]>([]);
  const [depForm, setDepForm] = useState<{ other: string; role: 'pred' | 'succ'; type: DepType; lag: number }>(
    { other: '', role: 'pred', type: 'FS', lag: 0 });

  const loadDeps = async () => {
    if (!projectId || !task?.id) return;
    const [dRes, tRes] = await Promise.all([
      projectApi.listDeps(projectId),
      projectApi.listTasks(projectId),
    ]);
    const mine = (dRes.data.items as TaskDependency[]).filter(
      (d) => d.predecessor_id === task.id || d.successor_id === task.id);
    setDeps(mine);
    const flat: { id: string; code: string; name: string }[] = [];
    const walk = (arr: any[]) => arr.forEach((t) => { if (t.id !== task.id) flat.push({ id: t.id, code: t.code, name: t.name }); (t.children || []).forEach((c: any) => walk([c])); });
    walk(tRes.data.items || []);
    setAllTasks(flat);
  };
```

> 在已有"打开弹窗时加载 links/comments"的 `useEffect` 中,追加调用 `loadDeps()`(条件与 links 相同:有 `task?.id` 时)。需要从 props 取得 `projectId`(弹窗已有该 prop;若命名不同按实际)。同时在顶部 import 类型:

```tsx
import type { TaskDependency, DepType } from '../../types/project';
```

- [ ] **Step 2: 增加依赖区 UI(放在"关联对象"区之后、"评论"区之前)**

```tsx
        {task?.id && (
          <div className="border-t border-gray-100 pt-3 mt-3">
            <div className="text-sm font-medium text-gray-700 mb-2">任务依赖</div>
            <ul className="space-y-1 mb-2">
              {deps.map((d) => {
                const isPred = d.predecessor_id === task.id;
                const otherId = isPred ? d.successor_id : d.predecessor_id;
                const other = allTasks.find((t) => t.id === otherId);
                return (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${d.is_violation ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{d.dep_type}</span>
                    <span className="text-gray-500">{isPred ? '后置→' : '←前置'}</span>
                    <span className="truncate">{other ? `${other.code} ${other.name}` : otherId}</span>
                    {d.lag_days ? <span className="text-gray-400">lag {d.lag_days}d</span> : null}
                    {canEditDeps && (
                      <button className="ml-auto text-xs text-red-500" onClick={async () => { await projectApi.removeDep(projectId, d.id); loadDeps(); }}>删除</button>
                    )}
                  </li>
                );
              })}
              {deps.length === 0 && <li className="text-xs text-gray-400">暂无依赖</li>}
            </ul>
            {canEditDeps && (
              <div className="flex flex-wrap items-center gap-2">
                <select className="border rounded px-2 py-1 text-sm" value={depForm.role}
                  onChange={(e) => setDepForm({ ...depForm, role: e.target.value as 'pred' | 'succ' })}>
                  <option value="pred">本任务为前置 →</option>
                  <option value="succ">本任务为后置 ←</option>
                </select>
                <select className="border rounded px-2 py-1 text-sm" value={depForm.other}
                  onChange={(e) => setDepForm({ ...depForm, other: e.target.value })}>
                  <option value="">选择关联任务</option>
                  {allTasks.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm" value={depForm.type}
                  onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DepType })}>
                  {(['FS', 'SS', 'FF', 'SF'] as DepType[]).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" className="border rounded px-2 py-1 text-sm w-20" placeholder="lag" value={depForm.lag}
                  onChange={(e) => setDepForm({ ...depForm, lag: Number(e.target.value) })} />
                <button className="px-2 py-1 text-sm bg-primary-600 text-white rounded"
                  disabled={!depForm.other}
                  onClick={async () => {
                    const pred = depForm.role === 'pred' ? task.id : depForm.other;
                    const succ = depForm.role === 'pred' ? depForm.other : task.id;
                    try {
                      await projectApi.addDep(projectId, { predecessor_id: pred, successor_id: succ, dep_type: depForm.type, lag_days: depForm.lag });
                      setDepForm({ ...depForm, other: '', lag: 0 });
                      loadDeps();
                    } catch (err: any) {
                      alert(err?.response?.data?.detail || '添加依赖失败');
                    }
                  }}>添加依赖</button>
              </div>
            )}
          </div>
        )}
```

> `canEditDeps` 用与弹窗内其他"经理/admin 操作"一致的判定(例如已有的 `canManage` / `can('project.task:depend')`);实施时复用本文件已有的权限变量,避免重复定义。

- [ ] **Step 3: 构建验证**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: build 成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Project/TaskEditModal.tsx
git commit -m "feat(project): 任务编辑弹窗新增依赖管理区"
```

---

## Task 14: 端到端回归与手测清单

**Files:** 无(验证任务)

- [ ] **Step 1: 后端全量测试**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest -q
```
Expected: 全部 PASS。

- [ ] **Step 2: 前端构建**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: 成功。

- [ ] **Step 3: Docker 手测清单(人工)**

记录以下手测点(在 Docker 起整套后逐项验证):
- 进入项目 → "项目视图" tab → 看到甘特图,任务条按状态着色;里程碑为菱形。
- 日/周/月切换缩放正常;today 橙色虚线在正确位置。
- 关键路径任务:左侧名称红字 + 任务条红描边。
- 逾期任务(计划完成<今天且未完成):红条。
- 给两个任务建 FS 依赖 → 甘特出现箭头连线;把后置任务拖到前置之前 → 连线变红(违规)。
- 经理/admin 拖拽任务条平移与拉伸边缘改期 → 释放后日期保存、甘特刷新;非经理无拖拽手柄。
- 任务编辑弹窗"依赖"区:新增 FS/SS/FF/SF + lag、删除;成环/重复/自依赖被后端拒绝并提示。

- [ ] **Step 4: 更新记忆(可选)**

如本期完成且未合并,更新 `MEMORY.md` 中项目管理相关条目(标注甘特图第 2 期 dev 完成、待手测/未合并)。

---

## 自检清单(写计划后)

- 权限:`project.task:depend`(Task 1)✓
- 数据:日期列 Date(Task 2/3)、依赖表(Task 2)、删任务连带删依赖(Task 6)✓
- CPM 四种依赖约束 + 降级(Task 7)✓
- 端点:`/gantt`、`/deps`(Task 8)✓
- 前端:类型/服务(Task 9)、工具(Task 10)、SVG 甘特+拖拽(Task 11)、接入 tab(Task 12)、依赖区(Task 13)✓
- 范围边界遵守:不做自动级联排期(拖拽仅改自身)、不引进度百分比 ✓
