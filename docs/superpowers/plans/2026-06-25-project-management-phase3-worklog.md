# 项目管理模块 第3期 实施计划(工时统计)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务上记录实际工时、为任务设置估算工时,并出"按人 / 按任务 / 按时段"的投入统计报表(计划 vs 实际偏差),支持导出 Excel。

**Architecture:** 后端给 `project_tasks` 加 `estimated_hours`(由通用列对账自动补列),新增 `project_task_worklogs` 表与 CRUD + 聚合端点;前端在任务编辑弹窗加"工时"区,在"项目视图"tab 内加"工时统计"子视图。任意项目成员自由记工时、无审批;改/删限本人或项目经理/admin。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + PostgreSQL(测试用 SQLite);React 18 + TypeScript + Vite + Tailwind + Axios。

参考设计文档:`docs/superpowers/specs/2026-06-25-project-management-phase2-3-design.md`
**前置状态(第 2 期已在 dev 实现,本期基于其基础)**:
- `project_tasks` 四个日期列已是 `Date`;`crud_project._iso(d)` 日期序列化辅助已存在(worklog 日期序列化复用)。
- `schemas_project.py` 的 `TaskCreate/TaskEdit` 已有 `date` 字段 + `_blank_to_none` 校验器;`models_project.py` 已 import `Date`(本期再加 `Numeric`)。
- `crud_project.py` 模型导入含 `ProjectTaskDep`,`update_task` 字段循环为 `(name, task_type, status, priority, planned_start, planned_end, actual_start, actual_end, description)` 且其后调用 `_enforce_milestone_single_day` / `auto_schedule` / `persist_rollup`(本期仅在循环里加 `estimated_hours`,不动其余)。
- `routers/projects.py` 已有 `/gantt`、`/auto-schedule`、`/deps` 端点与 `_task_dict`(用 `crud_project._iso`)。
- 「项目视图」tab 当前**仅渲染 `GanttView` + 共享 `TaskEditModal`**(带 `refreshKey=ganttKey`、`onRowClick=findTaskById→openEdit`);本期在其外层加「甘特图 / 工时统计」子切换。
- `TaskEditModal.tsx` 区块顺序:基本字段 → 关联对象 → 任务附件 → **依赖区** → 评论;本期「工时区」插在依赖区与评论之间。`can` 从 `../../stores/auth` 导入。
- `projectApi.ts` 已有 `getGantt/autoSchedule/listDeps/addDep/removeDep`(本期追加 worklog 方法)。

本期工时逻辑不依赖甘特,仅复用 tab 容器与任务弹窗。

---

## 文件结构总览

**后端(修改)**
- `permissions/permissions.json` — 新增 `project.task:worklog`、`project.worklog:read`
- `backend/app/models_project.py` — `ProjectTask.estimated_hours`;新增 `ProjectTaskWorklog`
- `backend/app/schemas_project.py` — `WorklogCreate / WorklogEdit`;`TaskEdit/TaskCreate` 加 `estimated_hours`
- `backend/app/crud_project.py` — worklog CRUD + 聚合统计;`estimated_hours` 写入
- `backend/app/routers/projects.py` — worklog 端点 + 统计端点

**后端(新增测试)**
- `backend/tests/test_project_worklogs.py`

**前端(新增)**
- `frontend/src/pages/Project/WorklogStatsView.tsx` — 工时统计子视图

**前端(修改)**
- `frontend/src/types/project.ts` — `Worklog / WorklogStats` 类型;`ProjectTask.estimated_hours`
- `frontend/src/services/projectApi.ts` — worklog/统计方法
- `frontend/src/pages/Project/TaskEditModal.tsx` — "工时"区 + 估算工时字段
- `frontend/src/pages/Project/Projects.tsx` — "项目视图" tab 内 甘特/工时 子切换

---

## Task 1: 权限定义

**Files:**
- Modify: `permissions/permissions.json`

- [ ] **Step 1: 新增权限项**

在 `permissions/permissions.json` 的 `"permissions"` 对象内,项目相关权限附近加入:

```json
    "project.task:worklog": ["admin", "engineer", "production"],
    "project.worklog:read": ["admin", "engineer", "production", "guest"],
```

> 写工时与读报表均为角色级 + CRUD 层成员过滤;改/删本人限制在 CRUD 层做,无需对象策略。

- [ ] **Step 2: 生成权限代码**

Run:
```bash
cd D:/OpenCode/myPDM && python tools/gen_permissions.py
```
Expected: 生成成功,两个新键出现在生成文件中。

- [ ] **Step 3: 权限同步测试**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_permissions_sync.py -v
```
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(project): 新增工时记录/报表权限项"
```

---

## Task 2: 数据模型 — estimated_hours + 工时表

**Files:**
- Modify: `backend/app/models_project.py`
- Test: `backend/tests/test_project_worklogs.py`

- [ ] **Step 1: 写模型失败测试**

创建 `backend/tests/test_project_worklogs.py`:

```python
import uuid
import datetime
from decimal import Decimal
from app import models_project  # noqa: F401
from app.models_project import Project, ProjectTask, ProjectTaskWorklog


def test_task_has_estimated_hours(db):
    p = Project(code="PRJ-001", name="X", owner_id=uuid.uuid4())
    db.add(p); db.commit(); db.refresh(p)
    t = ProjectTask(project_id=p.id, code="PRJ-001-01", name="T", estimated_hours=Decimal("8.5"))
    db.add(t); db.commit(); db.refresh(t)
    assert t.estimated_hours == Decimal("8.5")


def test_worklog_insert(db):
    w = ProjectTaskWorklog(
        project_id=uuid.uuid4(), task_id=uuid.uuid4(), user_id=uuid.uuid4(),
        work_date=datetime.date(2026, 1, 1), hours=Decimal("4.0"), description="搭BOM",
    )
    db.add(w); db.commit(); db.refresh(w)
    assert w.hours == Decimal("4.0") and w.deleted_at is None
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -v
```
Expected: FAIL,`ImportError: cannot import name 'ProjectTaskWorklog'`。

- [ ] **Step 3: 修改模型**

在 `backend/app/models_project.py` 顶部 import 增加 `Numeric`:

```python
from sqlalchemy import Column, String, Integer, Text, DateTime, Date, Numeric, ForeignKey
```

在 `ProjectTask` 类中(`sort_order` 之后)加入:

```python
    estimated_hours = Column(Numeric(8, 2), nullable=True)
```

在文件末尾追加工时模型:

```python
class ProjectTaskWorklog(Base):
    __tablename__ = "project_task_worklogs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    work_date = Column(Date, nullable=False)
    hours = Column(Numeric(6, 2), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -v
```
Expected: PASS。

> 注:`estimated_hours` 列在旧库由 `main.py` 通用列对账自动补(可空列);`project_task_worklogs` 新表由 `create_all` 自动建。无需手写迁移。

- [ ] **Step 5: Commit**

```bash
git add backend/app/models_project.py backend/tests/test_project_worklogs.py
git commit -m "feat(project): 任务估算工时字段 + 工时记录表"
```

---

## Task 3: Schemas — Worklog + estimated_hours

**Files:**
- Modify: `backend/app/schemas_project.py`

- [ ] **Step 1: 增加工时 schema 并给任务 schema 加估算工时**

在 `backend/app/schemas_project.py` 顶部 import 确认含 `date`,并加入 `Decimal`:

```python
from datetime import datetime, date
from decimal import Decimal
```

在 `TaskCreate` 与 `TaskEdit` 中加入字段(放在 `description` 之前):

```python
    estimated_hours: Optional[Decimal] = None
```

在文件末尾追加:

```python
# ---- 工时 ----
class WorklogCreate(BaseSchema):
    work_date: date
    hours: Decimal = Field(..., gt=0)
    description: Optional[str] = None


class WorklogEdit(BaseSchema):
    work_date: Optional[date] = None
    hours: Optional[Decimal] = Field(default=None, gt=0)
    description: Optional[str] = None
```

- [ ] **Step 2: 验证可导入**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "import app.schemas_project as s; print(s.WorklogCreate, s.WorklogEdit)"
```
Expected: 打印两个类。

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas_project.py
git commit -m "feat(project): 工时 schema + 任务估算工时字段"
```

---

## Task 4: CRUD — 工时增删改查 + estimated_hours 写入

**Files:**
- Modify: `backend/app/crud_project.py`
- Test: `backend/tests/test_project_worklogs.py`(追加)

- [ ] **Step 1: 写 worklog CRUD 失败测试**

在 `backend/tests/test_project_worklogs.py` 末尾追加:

```python
import datetime as _dt
from decimal import Decimal as _D
import pytest
from fastapi import HTTPException
from app import crud_project
from app.schemas_project import ProjectCreate, TaskCreate, TaskEdit, WorklogCreate, WorklogEdit


def _mk_user(db, role="engineer"):
    from app import models
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}",
                    password_hash="x", real_name="T", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_add_list_update_delete_worklog(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="W"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    w = crud_project.add_worklog(db, p.id, t.id, owner.id,
                                 WorklogCreate(work_date=_dt.date(2026, 1, 1), hours=_D("4")))
    assert len(crud_project.list_worklogs(db, t.id)) == 1
    crud_project.update_worklog(db, w, WorklogEdit(hours=_D("6")))
    assert w.hours == _D("6")
    crud_project.delete_worklog(db, w)
    assert len(crud_project.list_worklogs(db, t.id)) == 0


def test_estimated_hours_written_via_task_edit(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="E"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    crud_project.update_task(db, t, TaskEdit(estimated_hours=_D("12.5")))
    assert t.estimated_hours == _D("12.5")
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -k "worklog or estimated_hours_written" -v
```
Expected: FAIL,`AttributeError: module 'app.crud_project' has no attribute 'add_worklog'`(以及 estimated_hours 未写入)。

- [ ] **Step 3: 给 update_task 增加 estimated_hours 写入**

在 `crud_project.py` 顶部 schema 导入加入 `WorklogCreate, WorklogEdit`,模型导入加入 `ProjectTaskWorklog`:

```python
from app.models_project import (
    Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment, ProjectTaskDep,
    ProjectTaskWorklog,
)
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
    WorklogCreate, WorklogEdit,
)
```

在 `update_task` 的字段循环中,把 `estimated_hours` 加入可写字段元组(与其他直接 setattr 字段并列):

```python
    for field in ("name", "task_type", "status", "priority", "planned_start",
                  "planned_end", "actual_start", "actual_end", "description", "estimated_hours"):
```

同理 `create_task` 若要支持创建即带估算工时,在构造 `ProjectTask(...)` 时加 `estimated_hours=data.estimated_hours`(可选;不加也可后续编辑设置)。

- [ ] **Step 4: 追加 worklog CRUD**

在 `crud_project.py` 末尾追加:

```python
# ════════════════════════ 工时 ════════════════════════
def add_worklog(db: Session, project_id: uuid.UUID, task_id: uuid.UUID,
                user_id: uuid.UUID, data: WorklogCreate) -> ProjectTaskWorklog:
    w = ProjectTaskWorklog(project_id=project_id, task_id=task_id, user_id=user_id,
                           work_date=data.work_date, hours=data.hours, description=data.description)
    db.add(w); db.commit(); db.refresh(w)
    return w


def list_worklogs(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskWorklog).filter(
        ProjectTaskWorklog.task_id == task_id, ProjectTaskWorklog.deleted_at.is_(None)
    ).order_by(ProjectTaskWorklog.work_date.desc()).all()


def get_worklog(db: Session, worklog_id: uuid.UUID) -> ProjectTaskWorklog:
    w = db.query(ProjectTaskWorklog).filter(
        ProjectTaskWorklog.id == worklog_id, ProjectTaskWorklog.deleted_at.is_(None)
    ).first()
    if not w:
        raise HTTPException(status_code=404, detail="工时记录不存在")
    return w


def update_worklog(db: Session, w: ProjectTaskWorklog, data: WorklogEdit) -> ProjectTaskWorklog:
    for field in ("work_date", "hours", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(w, field, val)
    db.commit(); db.refresh(w)
    return w


def delete_worklog(db: Session, w: ProjectTaskWorklog):
    w.deleted_at = datetime.now(timezone.utc)
    db.commit()
```

- [ ] **Step 5: 运行确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -v
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_worklogs.py
git commit -m "feat(project): 工时 CRUD + 任务估算工时写入"
```

---

## Task 5: CRUD — 工时聚合统计

**Files:**
- Modify: `backend/app/crud_project.py`
- Test: `backend/tests/test_project_worklogs.py`(追加)

- [ ] **Step 1: 写聚合统计失败测试**

在 `backend/tests/test_project_worklogs.py` 末尾追加:

```python
def test_worklog_stats_by_user_and_task(db):
    owner = _mk_user(db); helper = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="S"), owner.id)
    t1 = crud_project.create_task(db, p, TaskCreate(name="T1"))
    crud_project.update_task(db, t1, TaskEdit(estimated_hours=_D("10")))
    t2 = crud_project.create_task(db, p, TaskCreate(name="T2"))
    crud_project.add_worklog(db, p.id, t1.id, owner.id, WorklogCreate(work_date=_dt.date(2026, 1, 1), hours=_D("4")))
    crud_project.add_worklog(db, p.id, t1.id, helper.id, WorklogCreate(work_date=_dt.date(2026, 1, 2), hours=_D("3")))
    crud_project.add_worklog(db, p.id, t2.id, owner.id, WorklogCreate(work_date=_dt.date(2026, 1, 2), hours=_D("2")))

    by_user = crud_project.worklog_stats(db, p.id, "user")
    rows = {r["user_id"]: r["hours"] for r in by_user["rows"]}
    assert rows[str(owner.id)] == 6.0 and rows[str(helper.id)] == 3.0
    assert by_user["totals"]["actual"] == 9.0

    by_task = crud_project.worklog_stats(db, p.id, "task")
    t1row = next(r for r in by_task["rows"] if r["task_id"] == str(t1.id))
    assert t1row["actual"] == 7.0 and t1row["estimated"] == 10.0 and t1row["variance"] == -3.0


def test_worklog_stats_by_date_with_window(db):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="D"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    crud_project.add_worklog(db, p.id, t.id, owner.id, WorklogCreate(work_date=_dt.date(2026, 1, 1), hours=_D("4")))
    crud_project.add_worklog(db, p.id, t.id, owner.id, WorklogCreate(work_date=_dt.date(2026, 2, 1), hours=_D("5")))
    res = crud_project.worklog_stats(db, p.id, "date",
                                     date_from=_dt.date(2026, 1, 1), date_to=_dt.date(2026, 1, 31))
    assert len(res["rows"]) == 1 and res["rows"][0]["hours"] == 4.0
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -k "stats" -v
```
Expected: FAIL,`AttributeError: ... has no attribute 'worklog_stats'`。

- [ ] **Step 3: 追加聚合统计函数**

在 `crud_project.py` 末尾追加:

```python
def _f(v):
    """Decimal/None -> float。"""
    return float(v) if v is not None else 0.0


def worklog_stats(db: Session, project_id: uuid.UUID, group_by: str,
                  date_from=None, date_to=None) -> dict:
    q = db.query(ProjectTaskWorklog).filter(
        ProjectTaskWorklog.project_id == project_id,
        ProjectTaskWorklog.deleted_at.is_(None),
    )
    if date_from:
        q = q.filter(ProjectTaskWorklog.work_date >= date_from)
    if date_to:
        q = q.filter(ProjectTaskWorklog.work_date <= date_to)
    logs = q.all()
    total_actual = sum(_f(w.hours) for w in logs)

    rows = []
    if group_by == "user":
        names = {u.id: u.real_name for u in db.query(User).all()}
        agg = {}
        for w in logs:
            agg[w.user_id] = agg.get(w.user_id, 0.0) + _f(w.hours)
        for uid, hrs in sorted(agg.items(), key=lambda kv: -kv[1]):
            rows.append({"user_id": str(uid), "user_name": names.get(uid, ""),
                         "hours": round(hrs, 2),
                         "pct": round(hrs / total_actual * 100, 1) if total_actual else 0.0})
    elif group_by == "task":
        tasks = db.query(ProjectTask).filter(
            ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
        ).all()
        actual = {}
        for w in logs:
            actual[w.task_id] = actual.get(w.task_id, 0.0) + _f(w.hours)
        for t in tasks:
            a = round(actual.get(t.id, 0.0), 2)
            est = _f(t.estimated_hours)
            if a == 0.0 and est == 0.0:
                continue
            rows.append({"task_id": str(t.id), "code": t.code, "name": t.name,
                         "actual": a, "estimated": round(est, 2),
                         "variance": round(a - est, 2)})
    elif group_by == "date":
        agg = {}
        for w in logs:
            key = w.work_date.isoformat()
            agg[key] = agg.get(key, 0.0) + _f(w.hours)
        for d, hrs in sorted(agg.items()):
            rows.append({"date": d, "hours": round(hrs, 2)})

    total_est = _f(db.query(func.coalesce(func.sum(ProjectTask.estimated_hours), 0)).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).scalar())
    return {
        "group_by": group_by, "rows": rows,
        "totals": {"actual": round(total_actual, 2), "estimated": round(total_est, 2),
                   "variance": round(total_actual - total_est, 2)},
    }
```

> 注意:`crud_project.py` 当前**未**导入 `func`(顶部只有 `from sqlalchemy.orm import Session`),本任务需新增 `from sqlalchemy import func`。`_f` 辅助若已存在(本期内多处用)避免重复定义。

- [ ] **Step 4: 运行确认通过**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest tests/test_project_worklogs.py -v
```
Expected: PASS(全部工时测试)。

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_worklogs.py
git commit -m "feat(project): 工时聚合统计(按人/任务/时段)"
```

---

## Task 6: API 路由 — 工时端点 + 统计端点

**Files:**
- Modify: `backend/app/routers/projects.py`

- [ ] **Step 1: 增加导入**

确认 `routers/projects.py` schema 导入含 `WorklogCreate, WorklogEdit`;顶部加 `from datetime import date` 与 `from fastapi import Query`(若未导入)。

- [ ] **Step 2: 增加工时与统计端点**

在 `routers/projects.py` 评论端点之后加入:

```python
# ──────────── 工时 ────────────
@router.get("/{project_id}/tasks/{task_id}/worklogs")
async def list_worklogs(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.worklog:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [_worklog_dict(db, w) for w in crud_project.list_worklogs(db, task_id)]}


@router.post("/{project_id}/tasks/{task_id}/worklogs")
async def add_worklog(project_id: uuid.UUID, task_id: uuid.UUID, data: WorklogCreate,
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:worklog"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_task(db, task_id)
    return _worklog_dict(db, crud_project.add_worklog(db, project_id, task_id, current_user.id, data))


@router.put("/{project_id}/worklogs/{worklog_id}")
async def update_worklog(project_id: uuid.UUID, worklog_id: uuid.UUID, data: WorklogEdit,
                         db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project.task:worklog"))):
    p = crud_project.get_project(db, project_id)
    w = crud_project.get_worklog(db, worklog_id)
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and w.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能修改本人工时")
    return _worklog_dict(db, crud_project.update_worklog(db, w, data))


@router.delete("/{project_id}/worklogs/{worklog_id}")
async def delete_worklog(project_id: uuid.UUID, worklog_id: uuid.UUID, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project.task:worklog"))):
    p = crud_project.get_project(db, project_id)
    w = crud_project.get_worklog(db, worklog_id)
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and w.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除本人工时")
    crud_project.delete_worklog(db, w)
    return {"detail": "已删除"}


# ──────────── 工时统计 ────────────
@router.get("/{project_id}/worklog-stats")
async def worklog_stats(project_id: uuid.UUID,
                        group_by: str = Query("user"),
                        date_from: date = Query(None),
                        date_to: date = Query(None),
                        db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.worklog:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    if group_by not in ("user", "task", "date"):
        raise HTTPException(status_code=400, detail="group_by 取值无效")
    return crud_project.worklog_stats(db, project_id, group_by, date_from, date_to)
```

在序列化辅助区加入 `_worklog_dict`:

```python
def _worklog_dict(db, w):
    u = db.query(User).filter(User.id == w.user_id).first()
    return {"id": str(w.id), "task_id": str(w.task_id), "user_id": str(w.user_id),
            "user_name": u.real_name if u else "",
            "work_date": crud_project._iso(w.work_date),
            "hours": float(w.hours), "description": w.description,
            "created_at": w.created_at}
```

- [ ] **Step 3: 验证路由注册**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -c "from app.main import app; print([r.path for r in app.routes if 'worklog' in r.path])"
```
Expected: 打印含 `/worklogs`、`/worklog-stats` 的路由。

- [ ] **Step 4: 全量后端回归**

Run:
```bash
cd D:/OpenCode/myPDM/backend && python -m pytest -q
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/projects.py
git commit -m "feat(project): 工时记录与统计 API 端点"
```

---

## Task 7: 前端 — 类型与 API 服务

**Files:**
- Modify: `frontend/src/types/project.ts`
- Modify: `frontend/src/services/projectApi.ts`

- [ ] **Step 1: 增加类型**

在 `frontend/src/types/project.ts`:给 `ProjectTask` 接口加 `estimated_hours?: number | null;`;末尾追加:

```typescript
export interface Worklog {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  work_date: string;
  hours: number;
  description?: string | null;
  created_at?: string;
}

export interface WorklogStats {
  group_by: 'user' | 'task' | 'date';
  rows: any[];
  totals: { actual: number; estimated: number; variance: number };
}
```

- [ ] **Step 2: 增加 API 方法**

在 `frontend/src/services/projectApi.ts` 的 `projectApi` 对象内追加:

```typescript
  listWorklogs: (id: string, taskId: string) => api.get(`/${id}/tasks/${taskId}/worklogs`),
  addWorklog: (id: string, taskId: string, data: { work_date: string; hours: number; description?: string }) =>
    api.post(`/${id}/tasks/${taskId}/worklogs`, data),
  updateWorklog: (id: string, worklogId: string, data: { work_date?: string; hours?: number; description?: string }) =>
    api.put(`/${id}/worklogs/${worklogId}`, data),
  deleteWorklog: (id: string, worklogId: string) => api.delete(`/${id}/worklogs/${worklogId}`),
  getWorklogStats: (id: string, params: { group_by: string; date_from?: string; date_to?: string }) =>
    api.get(`/${id}/worklog-stats`, { params }),
```

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/project.ts frontend/src/services/projectApi.ts
git commit -m "feat(project): 前端工时类型与 API 服务"
```

---

## Task 8: 前端 — 任务编辑弹窗"工时"区 + 估算工时

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

- [ ] **Step 1: 估算工时字段**

在 `TaskEditModal.tsx` 基本字段表单中(优先级/计划起止附近),加入估算工时输入,绑定到表单的 `estimated_hours`(随任务保存一并 `updateTask`):

```tsx
        <label className="block text-sm">
          <span className="text-gray-600">估算工时(小时)</span>
          <input type="number" step="0.5" min="0" className="mt-1 w-full border rounded px-2 py-1 text-sm"
            value={form.estimated_hours ?? ''}
            onChange={(e) => setForm({ ...form, estimated_hours: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
```

> 把 `estimated_hours` 纳入 `form` 初始化(从 `task.estimated_hours` 读)与保存 payload。

- [ ] **Step 2: 工时区状态与加载**

在组件内加入(参照已有 links/comments 模式):

```tsx
  const [worklogs, setWorklogs] = useState<Worklog[]>([]);
  const [wlForm, setWlForm] = useState<{ work_date: string; hours: string; description: string }>(
    { work_date: new Date().toISOString().slice(0, 10), hours: '', description: '' });

  const loadWorklogs = async () => {
    if (!projectId || !task?.id) return;
    const res = await projectApi.listWorklogs(projectId, task.id);
    setWorklogs(res.data.items);
  };
```

在打开弹窗加载的 `useEffect` 中追加 `loadWorklogs()`(与 links 同条件)。顶部 import:

```tsx
import type { Worklog } from '../../types/project';
import { useAuthStore } from '../../stores/auth';
```

计算汇总(放在 render 前):

```tsx
  const actualTotal = worklogs.reduce((s, w) => s + (w.hours || 0), 0);
  const est = form.estimated_hours ?? 0;
  const currentUserId = useAuthStore.getState().user?.id;
```

- [ ] **Step 3: 工时区 UI(放在"依赖"区之后、评论区之前)**

```tsx
        {task?.id && (
          <div className="border-t border-gray-100 pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-gray-700">工时</div>
              <div className="text-xs text-gray-500">
                实际 {actualTotal}h / 估算 {est || '—'}h
                {est ? <span className={actualTotal - est > 0 ? 'text-red-500 ml-1' : 'text-green-600 ml-1'}>
                  (偏差 {(actualTotal - est).toFixed(1)}h)</span> : null}
              </div>
            </div>
            <ul className="space-y-1 mb-2 max-h-40 overflow-auto">
              {worklogs.map((w) => (
                <li key={w.id} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 w-24">{w.work_date}</span>
                  <span className="font-medium w-14">{w.hours}h</span>
                  <span className="text-gray-600">{w.user_name}</span>
                  <span className="text-gray-400 truncate flex-1">{w.description}</span>
                  {(w.user_id === currentUserId || canManage) && (
                    <button className="text-xs text-red-500"
                      onClick={async () => { await projectApi.deleteWorklog(projectId, w.id); loadWorklogs(); }}>删除</button>
                  )}
                </li>
              ))}
              {worklogs.length === 0 && <li className="text-xs text-gray-400">暂无工时记录</li>}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className="border rounded px-2 py-1 text-sm" value={wlForm.work_date}
                onChange={(e) => setWlForm({ ...wlForm, work_date: e.target.value })} />
              <input type="number" step="0.5" min="0.5" placeholder="小时" className="border rounded px-2 py-1 text-sm w-20"
                value={wlForm.hours} onChange={(e) => setWlForm({ ...wlForm, hours: e.target.value })} />
              <input type="text" placeholder="工作说明" className="border rounded px-2 py-1 text-sm flex-1"
                value={wlForm.description} onChange={(e) => setWlForm({ ...wlForm, description: e.target.value })} />
              <button className="px-2 py-1 text-sm bg-primary-600 text-white rounded" disabled={!wlForm.hours}
                onClick={async () => {
                  await projectApi.addWorklog(projectId, task.id, {
                    work_date: wlForm.work_date, hours: Number(wlForm.hours), description: wlForm.description || undefined });
                  setWlForm({ ...wlForm, hours: '', description: '' });
                  loadWorklogs();
                }}>记一笔</button>
            </div>
          </div>
        )}
```

> `canManage` 现有弹窗里没有,需新增一个可选 prop:在 `TaskEditModal` 的 `interface Props` 加 `canManage?: boolean`,并在 `Projects.tsx` 渲染该弹窗的**两处**(项目详情 tab 约 644 行、项目视图 tab 见 Task 10)都传入:
> `canManage={(useAuthStore.getState().user?.role === 'admin') || currentProject?.owner_id === useAuthStore.getState().user?.id}`。
> 前端仅控制删除按钮显隐;后端 `update/delete worklog` 已按「本人或项目经理/admin」强校验。

- [ ] **Step 4: 构建验证**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Project/TaskEditModal.tsx
git commit -m "feat(project): 任务弹窗工时区 + 估算工时字段"
```

---

## Task 9: 前端 — 工时统计子视图

**Files:**
- Create: `frontend/src/pages/Project/WorklogStatsView.tsx`

- [ ] **Step 1: 先确认现有 Excel 导出封装**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx grep -r "xlsx\|exportToExcel\|sheet_to" src --include=*.ts --include=*.tsx -l 2>/dev/null || true
```
> 若仓库已有导出工具(如 `utils/export.ts` 或 `xlsx` 依赖),实施时 import 复用;否则本期导出用最简 CSV 下载(下方代码默认提供 CSV 兜底,有 xlsx 工具则替换 `exportRows` 实现)。

- [ ] **Step 2: 创建 WorklogStatsView.tsx**

创建 `frontend/src/pages/Project/WorklogStatsView.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { projectApi } from '../../services/projectApi';
import type { WorklogStats } from '../../types/project';

type Mode = 'user' | 'task' | 'date';

function exportRows(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c)}"`).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

export default function WorklogStatsView({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<Mode>('user');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [stats, setStats] = useState<WorklogStats | null>(null);

  const load = async () => {
    const res = await projectApi.getWorklogStats(projectId, {
      group_by: mode, date_from: from || undefined, date_to: to || undefined });
    setStats(res.data);
  };
  useEffect(() => { if (projectId) load(); /* eslint-disable-next-line */ }, [projectId, mode, from, to]);

  if (!stats) return <div className="p-8 text-center text-gray-400">加载工时统计...</div>;

  const onExport = () => {
    if (mode === 'user') exportRows('worklog_by_user.csv', ['成员', '工时', '占比%'],
      stats.rows.map((r) => [r.user_name, r.hours, r.pct]));
    else if (mode === 'task') exportRows('worklog_by_task.csv', ['编号', '任务', '实际', '估算', '偏差'],
      stats.rows.map((r) => [r.code, r.name, r.actual, r.estimated, r.variance]));
    else exportRows('worklog_by_date.csv', ['日期', '工时'], stats.rows.map((r) => [r.date, r.hours]));
  };

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        {(['user', 'task', 'date'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-2 py-1 text-xs rounded ${mode === m ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>
            {m === 'user' ? '按人' : m === 'task' ? '按任务' : '按时段'}
          </button>
        ))}
        <span className="ml-2 text-xs text-gray-500">从</span>
        <input type="date" className="border rounded px-1 py-0.5 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-gray-500">到</span>
        <input type="date" className="border rounded px-1 py-0.5 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="ml-auto text-xs text-gray-600">
          实际 {stats.totals.actual}h / 估算 {stats.totals.estimated}h /
          <span className={stats.totals.variance > 0 ? 'text-red-500' : 'text-green-600'}> 偏差 {stats.totals.variance}h</span>
        </div>
        <button onClick={onExport} className="px-2 py-1 text-xs rounded bg-white border border-gray-300 text-gray-600">导出</button>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500">
          {mode === 'user' && <tr><th className="text-left px-3 py-2">成员</th><th className="text-right px-3 py-2">工时</th><th className="text-right px-3 py-2">占比</th></tr>}
          {mode === 'task' && <tr><th className="text-left px-3 py-2">任务</th><th className="text-right px-3 py-2">实际</th><th className="text-right px-3 py-2">估算</th><th className="text-right px-3 py-2">偏差</th></tr>}
          {mode === 'date' && <tr><th className="text-left px-3 py-2">日期</th><th className="text-right px-3 py-2">工时</th></tr>}
        </thead>
        <tbody>
          {mode === 'user' && stats.rows.map((r) => (
            <tr key={r.user_id} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{r.user_name}</td>
              <td className="px-3 py-1.5 text-right">{r.hours}</td>
              <td className="px-3 py-1.5 text-right text-gray-500">{r.pct}%</td>
            </tr>
          ))}
          {mode === 'task' && stats.rows.map((r) => (
            <tr key={r.task_id} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{r.code} {r.name}</td>
              <td className="px-3 py-1.5 text-right">{r.actual}</td>
              <td className="px-3 py-1.5 text-right text-gray-500">{r.estimated}</td>
              <td className={`px-3 py-1.5 text-right ${r.variance > 0 ? 'text-red-500' : 'text-green-600'}`}>{r.variance}</td>
            </tr>
          ))}
          {mode === 'date' && stats.rows.map((r) => (
            <tr key={r.date} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{r.date}</td>
              <td className="px-3 py-1.5 text-right">{r.hours}</td>
            </tr>
          ))}
          {stats.rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">暂无工时数据</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npx tsc --noEmit
```
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Project/WorklogStatsView.tsx
git commit -m "feat(project): 工时统计子视图(按人/任务/时段 + 导出)"
```

---

## Task 10: 前端 — "项目视图" tab 内 甘特/工时 子切换

**Files:**
- Modify: `frontend/src/pages/Project/Projects.tsx`

- [ ] **Step 1: 在视图 tab 增加子切换**

在 `Projects.tsx` 顶部 import:

```tsx
import WorklogStatsView from './WorklogStatsView';
```

在组件状态区加入子视图状态:

```tsx
  const [viewSub, setViewSub] = useState<'gantt' | 'worklog'>('gantt');
```

把 `tab === 'view'` 的渲染块改为带子切换:

```tsx
        {tab === 'view' && (
          <div className="p-4">
            {!selectedProjectId ? (
              <div className="text-center text-gray-400 py-12">请从项目汇总中选择一个项目</div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setViewSub('gantt')}
                    className={`px-3 py-1 text-sm rounded ${viewSub === 'gantt' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>甘特图</button>
                  <button onClick={() => setViewSub('worklog')}
                    className={`px-3 py-1 text-sm rounded ${viewSub === 'worklog' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>工时统计</button>
                </div>
                {viewSub === 'gantt' ? (
                  <GanttView
                    projectId={selectedProjectId}
                    canEdit={can('project.task:depend')}
                    refreshKey={ganttKey}
                    onRowClick={(id) => { const t = findTaskById(tasks, id); if (t) openEdit(t); }}
                    onTaskUpdated={() => { loadTasks(selectedProjectId); }}
                  />
                ) : (
                  <WorklogStatsView projectId={selectedProjectId} />
                )}
                <TaskEditModal open={editOpen} projectId={selectedProjectId} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)}
                               onSaved={() => { setEditOpen(false); loadTasks(selectedProjectId); setGanttKey((k) => k + 1); }} />
              </>
            )}
          </div>
        )}
```

> 现状:`tab === 'view'` 块已含 `GanttView`(带 `refreshKey/onRowClick`)+ `TaskEditModal`(第 2 期接入)。本步在其外层包一层「甘特图 / 工时统计」子切换,GanttView 的现有 props 与 TaskEditModal **保持不变**,仅在 worklog 子视图时渲染 `WorklogStatsView`。`viewSub` 状态、`WorklogStatsView` import 照 Step 1 加入。

- [ ] **Step 2: 构建验证**

Run:
```bash
cd D:/OpenCode/myPDM/frontend && npm run build
```
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Project/Projects.tsx
git commit -m "feat(project): 项目视图 tab 增加甘特/工时子切换"
```

---

## Task 11: 端到端回归与手测清单

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

- 任务编辑弹窗设"估算工时",保存后重开仍在。
- 弹窗"工时"区:记一笔(日期/小时/说明)→ 列表出现;实际/估算/偏差汇总正确。
- 他人工时本人不可删(无删除按钮);经理可删任意;本人可删自己。
- "项目视图" tab → "工时统计":按人(占比)、按任务(实际/估算/偏差,超支红字)、按时段(趋势)切换正常。
- 时间窗筛选生效;导出下载 CSV(或 Excel)内容正确。
- 非项目成员访问统计端点 403。

- [ ] **Step 4: 更新记忆(可选)**

更新 `MEMORY.md` 项目管理条目:工时统计第 3 期 dev 完成、待手测/未合并。

---

## 自检清单(写计划后)

- 权限:`project.task:worklog` / `project.worklog:read`(Task 1)✓
- 数据:`estimated_hours`(Task 2,自动补列)、`project_task_worklogs`(Task 2,自动建表)✓
- CRUD:worklog 增删改查 + 改/删本人限制(Task 4/6)、聚合统计三视角 + 时间窗(Task 5)✓
- 端点:worklogs CRUD、`worklog-stats`(Task 6)✓
- 前端:类型/服务(Task 7)、弹窗工时区+估算(Task 8)、统计子视图+导出(Task 9)、tab 子切换(Task 10)✓
- 范围边界遵守:无审批、无计时器、不做跨项目/成本报表、实际工时不联动任务状态 ✓
```