# 项目 WBS 模板功能 Implementation Plan（后端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端支持「现有项目 WBS → 可复用模板」与「模板 → 一键生成新项目」，含模板库 CRUD、REST API 与测试。

**Architecture:** 新增 3 张规范化表（`project_templates` / `template_tasks` / `template_task_deps`），与现有 `ProjectTask`/`ProjectTaskDep` 同构；模板任务日期以相对天数（`offset_start_days` + `duration_days`）存储，生成项目时按开工日推算绝对日期。转模板/生成逻辑放 `crud_project.py`，REST 端点放 `routers/projects.py`，复用现有 `create_project`、`_next_task_code`、`_enforce_milestone_single_day`、`persist_rollup`、`compute_schedule`。

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2 + pytest（SQLite 内存库）。权限走 `permissions/permissions.json` → `tools/gen_permissions.py` 生成产物。

> **范围说明**：本计划只覆盖**后端**（一个完整可测切片：API + 测试全绿）。前端（模板库页面、`[存为模板]` 按钮、`[从模板创建]` 分支，复用现有 WBS 树编辑器）依赖本计划落地后的确切 API 形状，且需要单独探查前端组件，另写一份计划。
>
> **spec：** `docs/superpowers/specs/2026-07-07-project-wbs-template-design.md`

---

## File Structure

- **Create** `backend/app/models_project.py` 追加 → `ProjectTemplate` / `TemplateTask` / `TemplateTaskDep`（同文件，紧跟现有 5 个模型）
- **Modify** `backend/app/main.py` → 无需改（`import app.models_project` 已在 494-500，`create_all` 幂等建新表）；确认即可
- **Modify** `backend/app/schemas_project.py` → 追加模板 schema
- **Modify** `backend/app/crud_project.py` → 追加模板 CRUD + 转模板 + 生成
- **Modify** `backend/app/routers/projects.py` → 追加模板 REST 端点
- **Modify** `permissions/permissions.json` → 追加 `project_template:*` 权限键，再跑生成器
- **Test** `backend/tests/test_project_template.py`（新建，覆盖 crud）

---

## Task 1: 模板数据模型

**Files:**
- Modify: `backend/app/models_project.py`（文件末尾追加）
- Test: `backend/tests/test_project_template.py`（新建）

- [ ] **Step 1: 写失败测试 —— 建表并插入模板**

新建 `backend/app/tests`? 不——测试放 `backend/tests/test_project_template.py`：

```python
import uuid
import datetime
import pytest
from fastapi import HTTPException

from app import models_project  # noqa: F401  触发模型注册
from app import crud_project


def _make_user(db, role="engineer"):
    from app import models
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}",
                    password_hash="x", real_name="测试", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_template_tables_insertable(db):
    from app.models_project import ProjectTemplate, TemplateTask, TemplateTaskDep
    u = _make_user(db)
    tpl = ProjectTemplate(name="标准研发模板", category="新品研发", created_by=u.id)
    db.add(tpl); db.commit(); db.refresh(tpl)
    t1 = TemplateTask(template_id=tpl.id, name="需求评审", task_type="评审",
                      offset_start_days=0, duration_days=1, sort_order=0)
    t2 = TemplateTask(template_id=tpl.id, name="详细设计",
                      offset_start_days=1, duration_days=5, sort_order=1)
    db.add_all([t1, t2]); db.commit(); db.refresh(t1); db.refresh(t2)
    dep = TemplateTaskDep(template_id=tpl.id, predecessor_id=t1.id,
                          successor_id=t2.id, dep_type="FS", lag_days=0)
    db.add(dep); db.commit()
    assert tpl.id is not None
    assert t2.offset_start_days == 1 and t2.duration_days == 5
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_project_template.py::test_template_tables_insertable -v`
Expected: FAIL —— `ImportError: cannot import name 'ProjectTemplate'`

- [ ] **Step 3: 追加模型到 `models_project.py` 末尾**

```python
class ProjectTemplate(Base):
    __tablename__ = "project_templates"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    category = Column(String(64), nullable=True)
    description = Column(Text, nullable=True)
    source_project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class TemplateTask(Base):
    __tablename__ = "template_tasks"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("project_templates.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("template_tasks.id"), nullable=True)
    name = Column(String(255), nullable=False)
    task_type = Column(String(8), nullable=False, default="任务")   # 任务/里程碑/评审
    priority = Column(String(4), nullable=False, default="中")      # 高/中/低
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    offset_start_days = Column(Integer, nullable=True)  # 相对开工日偏移(叶任务)
    duration_days = Column(Integer, nullable=True)      # 工期天数
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TemplateTaskDep(Base):
    __tablename__ = "template_task_deps"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("project_templates.id", ondelete="CASCADE"), nullable=False)
    predecessor_id = Column(UUID(as_uuid=True), ForeignKey("template_tasks.id", ondelete="CASCADE"), nullable=False)
    successor_id = Column(UUID(as_uuid=True), ForeignKey("template_tasks.id", ondelete="CASCADE"), nullable=False)
    dep_type = Column(String(2), nullable=False, default="FS")  # FS/SS/FF/SF
    lag_days = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

> 现有 import 已含 `Column, String, Integer, Text, DateTime, Date, ForeignKey`、`UUID`、`func`、`uuid`、`Base` —— 无需新增 import。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_project_template.py::test_template_tables_insertable -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models_project.py backend/tests/test_project_template.py
git commit -m "feat(project-template): add template data models"
```

---

## Task 2: 模板权限键

**Files:**
- Modify: `permissions/permissions.json`
- Modify（生成产物）: `backend/app/permissions/_generated.py`、`frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 在 `permissions/permissions.json` 的 `permissions` 对象里，紧跟 `project:delete` 那行之后加入**

```json
    "project_template:read": ["admin", "engineer", "production", "guest"],
    "project_template:write": ["admin", "engineer"],
```

> 语义：`read` = 看模板库 / 用模板建项目；`write` = 建/改/删模板、把项目存为模板。engineer 即项目经理角色。

- [ ] **Step 2: 运行生成器**

Run: `cd D:/OpenCode/myPDM && python tools/gen_permissions.py`
Expected: 打印生成成功，`_generated.py` 与 `permissions.generated.ts` 被更新。

- [ ] **Step 3: 运行权限同步测试确认通过**

Run: `cd backend && python -m pytest tests/test_permissions_sync.py -v`
Expected: PASS（生成产物与 json 一致）

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(project-template): add project_template permissions"
```

---

## Task 3: 模板 Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas_project.py`（文件末尾追加）

- [ ] **Step 1: 追加 schema（末尾）**

```python
# ---- 模板 ----
class TemplateCreateFromProject(BaseSchema):
    """从现有项目转模板的入参。"""
    name: str = Field(..., max_length=255)
    category: Optional[str] = Field(None, max_length=64)
    description: Optional[str] = None


class TemplateCreateBlank(BaseSchema):
    """手动新建空模板。"""
    name: str = Field(..., max_length=255)
    category: Optional[str] = Field(None, max_length=64)
    description: Optional[str] = None


class TemplateEdit(BaseSchema):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None


class ProjectFromTemplate(BaseSchema):
    """从模板生成项目的入参。"""
    name: str = Field(..., max_length=255)
    planned_start: Optional[str] = None   # 'YYYY-MM-DD'；无则任务日期全空
    member_user_ids: List[str] = []
```

> `BaseSchema` / `Field` / `Optional` / `List` 现有文件已 import。

- [ ] **Step 2: 冒烟校验（无独立测试，随 Task 4 一起被覆盖）**

Run: `cd backend && python -c "from app.schemas_project import TemplateCreateFromProject, ProjectFromTemplate; print('ok')"`
Expected: 打印 `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas_project.py
git commit -m "feat(project-template): add template schemas"
```

---

## Task 4: 现有项目「存为模板」CRUD

**Files:**
- Modify: `backend/app/crud_project.py`（末尾追加）
- Test: `backend/tests/test_project_template.py`

计算规则：`origin` = 所有**叶任务**里最早的 `planned_start`；叶任务且 `planned_start`+`planned_end` 均有值 → `offset=(planned_start-origin).days`，`duration=(planned_end-planned_start).days+1`；否则 offset/duration 留空。父任务不存 offset/duration。依赖按 旧任务id→新模板任务id 映射复制。

- [ ] **Step 1: 写失败测试**

```python
def test_create_template_from_project_captures_relative_dates(db):
    from app.schemas_project import ProjectCreate, TaskCreate, DepCreate, TemplateCreateFromProject
    from app.models_project import TemplateTask, TemplateTaskDep
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="源项目"), owner.id)
    # 父任务 + 两个叶子（有日期），一条 FS 依赖
    parent = crud_project.create_task(db, p, TaskCreate(name="阶段1"))
    a = crud_project.create_task(db, p, TaskCreate(
        name="设计", parent_id=str(parent.id),
        planned_start="2026-03-10", planned_end="2026-03-14"))
    b = crud_project.create_task(db, p, TaskCreate(
        name="评审", parent_id=str(parent.id), task_type="评审",
        planned_start="2026-03-16", planned_end="2026-03-16"))
    crud_project.add_dep(db, p.id, DepCreate(
        predecessor_id=str(a.id), successor_id=str(b.id), dep_type="FS", lag_days=0))

    tpl = crud_project.create_template_from_project(
        db, p.id, TemplateCreateFromProject(name="模板1", category="新品研发"), owner.id)

    tasks = db.query(TemplateTask).filter(TemplateTask.template_id == tpl.id).all()
    by_name = {t.name: t for t in tasks}
    assert tpl.source_project_id == p.id
    assert by_name["设计"].offset_start_days == 0    # origin=03-10
    assert by_name["设计"].duration_days == 5        # 10..14 闭区间
    assert by_name["评审"].offset_start_days == 6    # 03-16 - 03-10
    assert by_name["评审"].duration_days == 1
    # 父任务不存相对日期
    assert by_name["阶段1"].offset_start_days is None
    # 层级保留
    assert by_name["设计"].parent_id == by_name["阶段1"].id
    # 依赖复制且指向模板任务
    deps = db.query(TemplateTaskDep).filter(TemplateTaskDep.template_id == tpl.id).all()
    assert len(deps) == 1
    assert deps[0].predecessor_id == by_name["设计"].id
    assert deps[0].successor_id == by_name["评审"].id


def test_create_template_from_project_no_dates_leaves_offsets_null(db):
    from app.schemas_project import ProjectCreate, TaskCreate, TemplateCreateFromProject
    from app.models_project import TemplateTask
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="源"), owner.id)
    crud_project.create_task(db, p, TaskCreate(name="无日期任务"))
    tpl = crud_project.create_template_from_project(
        db, p.id, TemplateCreateFromProject(name="模板2"), owner.id)
    t = db.query(TemplateTask).filter(TemplateTask.template_id == tpl.id).one()
    assert t.offset_start_days is None and t.duration_days is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_project_template.py -k create_template_from_project -v`
Expected: FAIL —— `AttributeError: module 'app.crud_project' has no attribute 'create_template_from_project'`

- [ ] **Step 3: 实现 `create_template_from_project`（追加到 `crud_project.py` 末尾）**

```python
# ════════════════════════ 模板 ════════════════════════
from app.models_project import ProjectTemplate, TemplateTask, TemplateTaskDep
from app.schemas_project import (
    TemplateCreateFromProject, TemplateCreateBlank, TemplateEdit, ProjectFromTemplate,
)


def create_template_from_project(
    db: Session, project_id: uuid.UUID, data: TemplateCreateFromProject, created_by: uuid.UUID
) -> ProjectTemplate:
    get_project(db, project_id)  # 存在性校验（404）
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    deps = list_deps(db, project_id)
    leaves = _leaf_ids(tasks)

    starts = [t.planned_start for t in tasks
              if t.id in leaves and t.planned_start is not None]
    origin = min(starts) if starts else None

    tpl = ProjectTemplate(
        name=data.name, category=data.category, description=data.description,
        source_project_id=project_id, created_by=created_by,
    )
    db.add(tpl); db.commit(); db.refresh(tpl)

    id_map = {}  # 旧 ProjectTask.id -> 新 TemplateTask.id
    for t in tasks:  # 已按 sort_order 排序；父在子前不保证，故 parent_id 先记原值稍后回填
        offset = duration = None
        if (t.id in leaves and origin is not None
                and t.planned_start and t.planned_end):
            offset = (t.planned_start - origin).days
            duration = (t.planned_end - t.planned_start).days + 1
        tt = TemplateTask(
            template_id=tpl.id, name=t.name, task_type=t.task_type,
            priority=t.priority, description=t.description, sort_order=t.sort_order,
            offset_start_days=offset, duration_days=duration,
        )
        db.add(tt); db.flush()   # 拿到 tt.id，暂不提交
        id_map[t.id] = tt.id
    # 回填 parent_id
    for t in tasks:
        if t.parent_id and t.parent_id in id_map:
            db.query(TemplateTask).filter(TemplateTask.id == id_map[t.id]).update(
                {TemplateTask.parent_id: id_map[t.parent_id]}, synchronize_session=False)
    # 复制依赖
    for d in deps:
        if d.predecessor_id in id_map and d.successor_id in id_map:
            db.add(TemplateTaskDep(
                template_id=tpl.id,
                predecessor_id=id_map[d.predecessor_id],
                successor_id=id_map[d.successor_id],
                dep_type=d.dep_type, lag_days=d.lag_days,
            ))
    db.commit(); db.refresh(tpl)
    return tpl
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_project_template.py -k create_template_from_project -v`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_template.py
git commit -m "feat(project-template): create template from existing project"
```

---

## Task 5: 「从模板生成项目」CRUD

**Files:**
- Modify: `backend/app/crud_project.py`（末尾追加）
- Test: `backend/tests/test_project_template.py`

- [ ] **Step 1: 写失败测试**

```python
def test_create_project_from_template_computes_dates(db):
    from app.schemas_project import (
        ProjectCreate, TaskCreate, DepCreate, TemplateCreateFromProject, ProjectFromTemplate)
    owner = _make_user(db)
    # 先造一个带相对排期的模板（复用转模板路径）
    src = crud_project.create_project(db, ProjectCreate(name="源"), owner.id)
    a = crud_project.create_task(db, src, TaskCreate(
        name="设计", planned_start="2026-03-10", planned_end="2026-03-14"))
    b = crud_project.create_task(db, src, TaskCreate(
        name="评审", task_type="里程碑", planned_start="2026-03-16", planned_end="2026-03-16"))
    crud_project.add_dep(db, src.id, DepCreate(
        predecessor_id=str(a.id), successor_id=str(b.id), dep_type="FS"))
    tpl = crud_project.create_template_from_project(
        db, src.id, TemplateCreateFromProject(name="模板"), owner.id)

    new_p = crud_project.create_project_from_template(
        db, tpl.id, ProjectFromTemplate(name="新项目", planned_start="2026-06-01"), owner.id)

    tree = crud_project.get_task_tree(db, new_p.id)
    flat = {}
    def _walk(ns):
        for n in ns:
            flat[n["name"]] = n; _walk(n["children"])
    _walk(tree)
    assert new_p.name == "新项目"
    assert flat["设计"]["planned_start"] == "2026-06-01"   # 开工日 + offset0
    assert flat["设计"]["planned_end"] == "2026-06-05"     # + 5天工期闭区间
    assert flat["评审"]["planned_start"] == "2026-06-07"   # offset6
    assert flat["评审"]["planned_end"] == "2026-06-07"     # 里程碑单日
    assert flat["设计"]["assignee_id"] is None
    assert flat["设计"]["status"] == "未开始"
    # 依赖被还原
    deps = crud_project.list_deps(db, new_p.id)
    assert len(deps) == 1


def test_create_project_from_template_no_start_leaves_dates_blank(db):
    from app.schemas_project import (
        ProjectCreate, TaskCreate, TemplateCreateFromProject, ProjectFromTemplate)
    owner = _make_user(db)
    src = crud_project.create_project(db, ProjectCreate(name="源"), owner.id)
    crud_project.create_task(db, src, TaskCreate(
        name="设计", planned_start="2026-03-10", planned_end="2026-03-14"))
    tpl = crud_project.create_template_from_project(
        db, src.id, TemplateCreateFromProject(name="模板"), owner.id)
    new_p = crud_project.create_project_from_template(
        db, tpl.id, ProjectFromTemplate(name="新项目"), owner.id)  # 无 planned_start
    tree = crud_project.get_task_tree(db, new_p.id)
    assert tree[0]["planned_start"] is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_project_template.py -k from_template -v`
Expected: FAIL —— `AttributeError: ... 'create_project_from_template'`

- [ ] **Step 3: 实现 `create_project_from_template`（追加末尾）**

```python
def create_project_from_template(
    db: Session, template_id: uuid.UUID, data: ProjectFromTemplate, owner_id: uuid.UUID
) -> Project:
    tpl = get_template(db, template_id)  # Task 6 定义；404 校验
    start_date = migrations_parse(data.planned_start)

    # 1) 建项目容器（复用现有逻辑：自动 code + owner 入组 + 附加成员）
    proj = create_project(db, ProjectCreate(
        name=data.name, planned_start=data.planned_start,
        member_user_ids=data.member_user_ids), owner_id)

    # 2) 逐任务复制（父在子前：按 parent 层级遍历）
    tmpl_tasks = db.query(TemplateTask).filter(
        TemplateTask.template_id == template_id
    ).order_by(TemplateTask.sort_order, TemplateTask.created_at).all()
    children_of = {}
    for t in tmpl_tasks:
        children_of.setdefault(t.parent_id, []).append(t)

    id_map = {}          # TemplateTask.id -> 新 ProjectTask.id
    counter = {"n": 0}   # 生成任务 code，避免逐次查库

    def _make(tmpl_task, new_parent_id):
        counter["n"] += 1
        code = f"{proj.code}-{counter['n']:02d}"
        ps = pe = None
        if (tmpl_task.offset_start_days is not None
                and tmpl_task.duration_days is not None and start_date is not None):
            ps = start_date + timedelta(days=tmpl_task.offset_start_days)
            pe = ps + timedelta(days=tmpl_task.duration_days - 1)
        nt = ProjectTask(
            project_id=proj.id, parent_id=new_parent_id, code=code,
            name=tmpl_task.name, task_type=tmpl_task.task_type,
            assignee_id=None, status="未开始", priority=tmpl_task.priority,
            planned_start=ps, planned_end=pe,
            description=tmpl_task.description, sort_order=tmpl_task.sort_order,
        )
        _enforce_milestone_single_day(nt)
        db.add(nt); db.flush()
        id_map[tmpl_task.id] = nt.id
        for child in children_of.get(tmpl_task.id, []):
            _make(child, nt.id)

    for root in children_of.get(None, []):
        _make(root, None)

    # 3) 复制依赖
    for d in db.query(TemplateTaskDep).filter(TemplateTaskDep.template_id == template_id).all():
        if d.predecessor_id in id_map and d.successor_id in id_map:
            db.add(ProjectTaskDep(
                project_id=proj.id,
                predecessor_id=id_map[d.predecessor_id],
                successor_id=id_map[d.successor_id],
                dep_type=d.dep_type, lag_days=d.lag_days,
            ))
    db.commit()
    persist_rollup(db, proj.id)   # 父任务日期上卷
    db.refresh(proj)
    return proj
```

并在文件**顶部 import 区**（现有 `from datetime import datetime, timezone, timedelta` 已含 `timedelta`）新增一个日期解析辅助（追加到 `_iso` 附近）：

```python
def migrations_parse(v):
    """'YYYY-MM-DD' -> date；空/非法 -> None。"""
    from app.migrations_project import parse_iso_date
    return parse_iso_date(v)
```

> 复用现有 `migrations_project.parse_iso_date`（幂等、容错），不重复造轮子。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_project_template.py -k from_template -v`
Expected: PASS（2 passed）

> 注：本任务依赖 Task 6 的 `get_template`。若按顺序执行，先做 Task 6 再回来跑本步；或本步先内联一个临时 `get_template`。推荐**先做 Task 6 再做 Task 5 的 Step 4**。

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_template.py
git commit -m "feat(project-template): instantiate project from template"
```

---

## Task 6: 模板库 CRUD（列表 / 详情树 / 建空 / 改 / 软删）

**Files:**
- Modify: `backend/app/crud_project.py`（末尾追加）
- Test: `backend/tests/test_project_template.py`

- [ ] **Step 1: 写失败测试**

```python
def test_template_library_crud(db):
    from app.schemas_project import TemplateCreateBlank, TemplateEdit
    owner = _make_user(db)
    tpl = crud_project.create_blank_template(
        db, TemplateCreateBlank(name="空模板", category="样机试制"), owner.id)
    assert crud_project.get_template(db, tpl.id).name == "空模板"
    # 列表（可按分类筛）
    assert len(crud_project.list_templates(db)) == 1
    assert len(crud_project.list_templates(db, category="样机试制")) == 1
    assert len(crud_project.list_templates(db, category="不存在")) == 0
    # 改
    crud_project.update_template(db, tpl.id, TemplateEdit(name="改名"))
    assert crud_project.get_template(db, tpl.id).name == "改名"
    # 软删后列表不含、get 抛 404
    crud_project.delete_template(db, tpl.id)
    assert len(crud_project.list_templates(db)) == 0
    with pytest.raises(HTTPException):
        crud_project.get_template(db, tpl.id)


def test_get_template_tree_nested(db):
    from app.schemas_project import ProjectCreate, TaskCreate, TemplateCreateFromProject
    owner = _make_user(db)
    src = crud_project.create_project(db, ProjectCreate(name="源"), owner.id)
    parent = crud_project.create_task(db, src, TaskCreate(name="阶段"))
    crud_project.create_task(db, src, TaskCreate(name="子任务", parent_id=str(parent.id)))
    tpl = crud_project.create_template_from_project(
        db, src.id, TemplateCreateFromProject(name="M"), owner.id)
    tree = crud_project.get_template_tree(db, tpl.id)
    assert len(tree) == 1 and tree[0]["name"] == "阶段"
    assert tree[0]["children"][0]["name"] == "子任务"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_project_template.py -k "template_library or template_tree" -v`
Expected: FAIL —— `AttributeError: ... 'create_blank_template'`

- [ ] **Step 3: 实现（追加末尾）**

```python
def create_blank_template(
    db: Session, data: "TemplateCreateBlank", created_by: uuid.UUID
) -> ProjectTemplate:
    tpl = ProjectTemplate(
        name=data.name, category=data.category, description=data.description,
        source_project_id=None, created_by=created_by,
    )
    db.add(tpl); db.commit(); db.refresh(tpl)
    return tpl


def list_templates(db: Session, category: str = None) -> list:
    q = db.query(ProjectTemplate).filter(ProjectTemplate.deleted_at.is_(None))
    if category:
        q = q.filter(ProjectTemplate.category == category)
    return q.order_by(ProjectTemplate.created_at.desc()).all()


def get_template(db: Session, template_id: uuid.UUID) -> ProjectTemplate:
    tpl = db.query(ProjectTemplate).filter(
        ProjectTemplate.id == template_id, ProjectTemplate.deleted_at.is_(None)
    ).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    return tpl


def update_template(db: Session, template_id: uuid.UUID, data: "TemplateEdit") -> ProjectTemplate:
    tpl = get_template(db, template_id)
    for field in ("name", "category", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(tpl, field, val)
    db.commit(); db.refresh(tpl)
    return tpl


def delete_template(db: Session, template_id: uuid.UUID):
    tpl = get_template(db, template_id)
    tpl.deleted_at = datetime.now(timezone.utc)
    db.commit()


def get_template_tree(db: Session, template_id: uuid.UUID) -> list:
    """组装模板任务树(嵌套 dict)，与 get_task_tree 结构对齐（无运行期字段）。"""
    tasks = db.query(TemplateTask).filter(
        TemplateTask.template_id == template_id
    ).order_by(TemplateTask.sort_order, TemplateTask.created_at).all()
    nodes = {}
    for t in tasks:
        nodes[t.id] = {
            "id": str(t.id), "template_id": str(t.template_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "name": t.name, "task_type": t.task_type, "priority": t.priority,
            "offset_start_days": t.offset_start_days, "duration_days": t.duration_days,
            "sort_order": t.sort_order, "description": t.description,
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
```

- [ ] **Step 4: 运行整份测试确认通过（含 Task 5 Step 4）**

Run: `cd backend && python -m pytest tests/test_project_template.py -v`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_project.py backend/tests/test_project_template.py
git commit -m "feat(project-template): template library CRUD and tree"
```

---

## Task 7: REST 端点

**Files:**
- Modify: `backend/app/routers/projects.py`（末尾追加）

复用 `require_permission`、`_enforce_manager`（存为模板时对源项目校验管理者）。模板库读写用新键 `project_template:read` / `project_template:write`。生成项目额外要 `project:create`（生成动作创建项目）。

- [ ] **Step 1: 追加 import 与端点**

在文件顶部 schema import 里加入：

```python
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd, MemberRoleUpdate,
    TaskCreate, TaskEdit, TaskStatusUpdate, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
    TemplateCreateFromProject, TemplateCreateBlank, TemplateEdit, ProjectFromTemplate,
)
```

在文件末尾追加端点：

```python
# ──────────── 模板库 ────────────
def _template_brief(tpl) -> dict:
    return {
        "id": str(tpl.id), "name": tpl.name, "category": tpl.category,
        "description": tpl.description,
        "source_project_id": str(tpl.source_project_id) if tpl.source_project_id else None,
        "created_at": tpl.created_at,
    }


@router.get("/templates")
async def list_templates(category: str = Query(None), db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project_template:read"))):
    items = crud_project.list_templates(db, category=category)
    return {"items": [_template_brief(t) for t in items]}


@router.get("/templates/{template_id}")
async def get_template(template_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("project_template:read"))):
    tpl = crud_project.get_template(db, template_id)
    return {**_template_brief(tpl), "tasks": crud_project.get_template_tree(db, tpl.id)}


@router.post("/templates")
async def create_blank_template(data: TemplateCreateBlank, db: Session = Depends(get_db),
                                current_user: User = Depends(require_permission("project_template:write")),
                                request: Request = None):
    tpl = crud_project.create_blank_template(db, data, current_user.id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建模板", "project_template", str(tpl.id), f"名称:{tpl.name}", ip)
    return _template_brief(tpl)


@router.put("/templates/{template_id}")
async def update_template(template_id: uuid.UUID, data: TemplateEdit, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("project_template:write"))):
    tpl = crud_project.update_template(db, template_id, data)
    return _template_brief(tpl)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("project_template:write")),
                          request: Request = None):
    crud_project.get_template(db, template_id)  # 404 校验
    crud_project.delete_template(db, template_id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除模板", "project_template", str(template_id), None, ip)
    return {"message": "模板已删除"}


@router.post("/{project_id}/save-as-template")
async def save_as_template(project_id: uuid.UUID, data: TemplateCreateFromProject,
                           db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("project_template:write")),
                           request: Request = None):
    project = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, project)   # 源项目管理者门禁
    tpl = crud_project.create_template_from_project(db, project_id, data, current_user.id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "项目存为模板", "project_template", str(tpl.id), f"源项目:{project.name}", ip)
    return _template_brief(tpl)


@router.post("/templates/{template_id}/instantiate")
async def instantiate_template(template_id: uuid.UUID, data: ProjectFromTemplate,
                               db: Session = Depends(get_db),
                               current_user: User = Depends(require_permission("project:create")),
                               request: Request = None):
    proj = crud_project.create_project_from_template(db, template_id, data, current_user.id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "从模板建项目", "project", str(proj.id), f"名称:{proj.name}", ip)
    return _project_detail(db, proj)
```

> `_project_detail` 已在本文件定义（`create_project` 端点用过）。`Query` 已 import。

- [ ] **Step 2: 端点冒烟 —— 应用能加载**

Run: `cd backend && python -c "from app.main import app; print([r.path for r in app.routes if 'template' in r.path])"`
Expected: 打印含 `/api/projects/templates`、`/api/projects/templates/{template_id}`、`/api/projects/{project_id}/save-as-template`、`/api/projects/templates/{template_id}/instantiate` 等路径。

- [ ] **Step 3: 跑整个项目测试套件确认无回归**

Run: `cd backend && python -m pytest tests/test_project_crud.py tests/test_project_template.py tests/test_permissions_sync.py -v`
Expected: PASS（全绿）

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/projects.py
git commit -m "feat(project-template): REST endpoints for template library and instantiation"
```

---

## 收尾校验

- [ ] **全量后端测试**

Run: `cd backend && python -m pytest -q`
Expected: 全绿（新增用例通过，旧用例无回归）

- [ ] **前端计划提示**

后端 API 稳定后，另起一份前端计划：模板库页面（列表 + 分类筛选 + 复用现有 WBS 树编辑器编辑 `template_tasks`）、项目详情页 `[存为模板]` 按钮 + 弹窗、新建项目弹窗 `[从模板创建]` 分支。UI 沿用现有构型管理页面风格（primary-* 配色、共享 Modal、统一表格/工具栏）。

---

## API 一览（供前端计划对接）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/projects/templates?category=` | project_template:read | 模板列表（可筛分类） |
| GET | `/api/projects/templates/{id}` | project_template:read | 模板详情 + 任务树 |
| POST | `/api/projects/templates` | project_template:write | 新建空模板 |
| PUT | `/api/projects/templates/{id}` | project_template:write | 改模板元信息 |
| DELETE | `/api/projects/templates/{id}` | project_template:write | 软删模板 |
| POST | `/api/projects/{project_id}/save-as-template` | project_template:write + 源项目管理者 | 项目存为模板 |
| POST | `/api/projects/templates/{id}/instantiate` | project:create | 从模板生成项目 |
