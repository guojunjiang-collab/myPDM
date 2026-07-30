# 项目交付物汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目详情页新增「交付物汇总」弹窗，把项目下所有任务关联的构型项、零部件、图文档、变更按类型汇总成可搜索、可筛选、可导出 Excel 的清单。

**Architecture:** 后端新增一个只读聚合模块 `crud_deliverables.py`，从 `project_tasks JOIN project_task_links` 出发，按 `entity_type` 分流查询四类对象，Python 侧按 `entity_id` 去重并合并来源任务，经一个新 GET 路由返回。前端新增 `DeliverableModal` 弹窗，打开时一次性拉取全量数据，TAB 切换/搜索/筛选/导出全在前端完成；行点击与来源任务点击复用现有的详情弹窗与 `TaskEditModal`。数据库 schema 零改动。

**Tech Stack:** FastAPI + SQLAlchemy 2.x（ORM 查询，不用原生 SQL，保证 SQLite 测试可跑）、pytest + 内存 SQLite、React + TypeScript + Tailwind、vitest、SheetJS (xlsx)。

## Global Constraints

- **数据库 schema 零改动**：不新增表、不加列、不改权限表。本功能是纯读取聚合。
- **不做结构性下钻**：不顺着构型项自动带出其零部件/图文档。汇总口径严格等于「项目下未删除任务的 `project_task_links`」。
- **行粒度 = 版本去重**：一行 = 一个 `entity_id`（零部件/图文档/构型项为 revision id，变更为 ECR/ECO 主键）。同一 `entity_id` 被多任务引用时合并到一行的 `tasks` 数组。
- **过滤规则**：任务与对象的 `deleted_at IS NOT NULL` 一律排除；`obsolete` 状态的版本**必须保留**并正常显示。
- **权限**：接口用 `require_permission("project:read")`。该权限对 admin / engineer / production / guest 四角色全开，入口按钮不做 `isManager` 判断。
- **ORM 优先**：后端查询一律用 SQLAlchemy ORM（`db.query(...).join(...)`），不用 `text()` 原生 SQL —— 测试跑在内存 SQLite 上，PG 方言 SQL 会失败。
- **叠放层级**：所有弹窗沿用共享 `Modal` 的默认 `zIndex: 50`，靠 portal 挂载顺序决定叠放，**不新增 zIndex 参数**。
- **命名固定**：列名用「创建人」（非「负责人」）；变更 TAB 的名称列表头为「标题」，且不显示版本列。
- **变更类无版本**：`ecrs`/`ecos` 无 version 字段，其 `version` 恒为 `null`。

**参考 spec：** `docs/superpowers/specs/2026-07-30-project-deliverables-summary-design.md`

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `backend/app/crud_deliverables.py` | 四类对象的聚合查询与去重（约 170 行） |
| `backend/tests/test_deliverables.py` | 聚合逻辑与路由的 pytest 用例 |
| `frontend/src/pages/Project/deliverableUtils.ts` | 纯函数：TAB 配置、状态标签、搜索/筛选、状态选项、来源任务文案 |
| `frontend/src/pages/Project/deliverableUtils.test.ts` | 上述纯函数的 vitest 用例 |
| `frontend/src/pages/Project/DeliverableModal.tsx` | 弹窗组件：TAB + 工具栏 + 表格 + 嵌套详情弹窗 |
| `frontend/src/services/deliverableExport.ts` | Excel 四 sheet 导出 |

**修改**

| 文件 | 改动 |
|---|---|
| `backend/app/routers/projects.py` | 新增 `GET /{project_id}/deliverables` 路由 |
| `frontend/src/types/project.ts` | 新增 `DeliverableTaskRef` / `DeliverableItem` / `DeliverableSummary` |
| `frontend/src/services/projectApi.ts` | 新增 `getDeliverables(id)` |
| `frontend/src/pages/Project/Projects.tsx` | 新增入口按钮、弹窗挂载、来源任务打开任务弹窗的回调 |

---

## Task 1: 后端聚合模块骨架 + 零部件聚合

**Files:**
- Create: `backend/app/crud_deliverables.py`
- Test: `backend/tests/test_deliverables.py`

**Interfaces:**
- Consumes: 现有模型 `app.models_project.{Project, ProjectTask, ProjectTaskLink}`、`app.models_parts.{PartMaster, PartRevision}`、`app.models.User`
- Produces:
  - `_collect(bucket: dict, key: str, task: ProjectTask, factory: Callable[[], dict]) -> None`
  - `_finalize(bucket: dict) -> list[dict]`
  - `_user_names(db: Session) -> dict[uuid.UUID, str]`
  - `list_parts(db: Session, project_id: uuid.UUID, user_names: dict) -> list[dict]`
  - 统一 item 形状：`{entity_type, entity_id, master_id, code, name, version, status, creator_name, extra, tasks}`，`tasks` 为 `[{id, code, name}]`

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/test_deliverables.py`：

```python
"""项目交付物汇总：四类对象聚合、版本去重、来源任务合并。"""
import uuid
from datetime import datetime, timezone

from app import models, crud_deliverables
from app.models_parts import PartMaster, PartRevision
from app.models_project import Project, ProjectTask, ProjectTaskLink


# ────────── 构造辅助 ──────────

def _user(db, name="张三"):
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}", password_hash="x",
                    real_name=name, role="engineer", status="active")
    db.add(u); db.commit()
    return u


def _project(db, owner, code="PRJ-1"):
    p = Project(id=uuid.uuid4(), code=code, name="项目一", owner_id=owner.id)
    db.add(p); db.commit()
    return p


def _task(db, project, code="T-01", name="结构设计", deleted=False):
    t = ProjectTask(id=uuid.uuid4(), project_id=project.id, code=code, name=name,
                    deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(t); db.commit()
    return t


def _link(db, task, entity_type, entity_id):
    lk = ProjectTaskLink(id=uuid.uuid4(), task_id=task.id,
                         entity_type=entity_type, entity_id=entity_id)
    db.add(lk); db.commit()
    return lk


def _part(db, creator, code="P-001", versions=("A",), ptype="part",
          status="released", deleted=False):
    m = PartMaster(id=uuid.uuid4(), code=code, name=f"{code}名称", type=ptype,
                   creator_id=creator.id,
                   deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = PartRevision(id=uuid.uuid4(), master_id=m.id, version=v, status=status,
                         creator_id=creator.id)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


# ────────── 用例 ──────────

def test_empty_project_returns_empty_list(db):
    owner = _user(db)
    p = _project(db, owner)
    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_part_linked_by_two_tasks_is_one_row_with_two_tasks(db):
    owner = _user(db)
    p = _project(db, owner)
    t1 = _task(db, p, code="T-01", name="设计")
    t2 = _task(db, p, code="T-02", name="校核")
    m, revs = _part(db, owner)
    _link(db, t1, "part", revs[0].id)
    _link(db, t2, "part", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    it = items[0]
    assert it["code"] == "P-001"
    assert it["version"] == "A"
    assert it["status"] == "released"
    assert it["creator_name"] == "张三"
    assert it["extra"] == "零件"
    assert it["entity_type"] == "part"
    assert it["master_id"] == str(m.id)
    assert [t["code"] for t in it["tasks"]] == ["T-01", "T-02"]


def test_two_versions_of_same_master_are_two_rows(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, versions=("A", "B"))
    _link(db, t, "part", revs[0].id)
    _link(db, t, "part", revs[1].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 2
    assert sorted(i["version"] for i in items) == ["A", "B"]


def test_deleted_task_link_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p, deleted=True)
    m, revs = _part(db, owner)
    _link(db, t, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_deleted_part_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, deleted=True)
    _link(db, t, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_obsolete_part_is_included(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, status="obsolete")
    _link(db, t, "part", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["status"] == "obsolete"


def test_assembly_extra_label_is_bujian(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, code="A-001", ptype="assembly")
    _link(db, t, "assembly", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert items[0]["extra"] == "部件"
    assert items[0]["entity_type"] == "assembly"


def test_other_project_links_are_not_mixed_in(db):
    owner = _user(db)
    p1 = _project(db, owner, code="PRJ-1")
    p2 = _project(db, owner, code="PRJ-2")
    t2 = _task(db, p2)
    m, revs = _part(db, owner)
    _link(db, t2, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p1.id, crud_deliverables._user_names(db)) == []
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.crud_deliverables'`（collection error）

- [ ] **Step 3: 写最小实现**

创建 `backend/app/crud_deliverables.py`：

```python
"""项目交付物汇总 - 只读聚合查询
============================
汇总口径：项目下所有未删除任务的 project_task_links，按 entity_id 去重、合并来源任务。
不新增表，不做结构性下钻。查询一律用 ORM（测试跑在内存 SQLite 上）。
"""
import uuid
from typing import Callable

from sqlalchemy.orm import Session

from app.models import User
from app.models_parts import PartMaster, PartRevision
from app.models_project import ProjectTask, ProjectTaskLink

# task_links 中代表零部件的 entity_type 取值（component 为历史遗留值）
PART_LINK_TYPES = ("part", "assembly", "component")
PART_TYPE_LABEL = {"part": "零件", "assembly": "部件"}


def _user_names(db: Session) -> dict:
    """一次性取全部用户的显示名，避免逐行查询。"""
    return {u.id: u.real_name for u in db.query(User).all()}


def _collect(bucket: dict, key: str, task: ProjectTask, factory: Callable[[], dict]) -> None:
    """把一行查询结果并入 bucket：首次出现时用 factory 建 item，之后只累加来源任务。"""
    item = bucket.get(key)
    if item is None:
        item = factory()
        item["tasks"] = []
        bucket[key] = item
    if not any(t["id"] == str(task.id) for t in item["tasks"]):
        item["tasks"].append({"id": str(task.id), "code": task.code, "name": task.name})


def _finalize(bucket: dict) -> list:
    """任务按编号排序、条目按 code 排序，保证导出结果稳定。"""
    items = list(bucket.values())
    for it in items:
        it["tasks"].sort(key=lambda t: t["code"] or "")
    items.sort(key=lambda i: i["code"] or "")
    return items


def list_parts(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """零部件：entity_id 指向 part_revisions.id。"""
    rows = (
        db.query(ProjectTask, PartRevision, PartMaster)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(PartRevision, PartRevision.id == ProjectTaskLink.entity_id)
        .join(PartMaster, PartMaster.id == PartRevision.master_id)
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type.in_(PART_LINK_TYPES),
                PartRevision.deleted_at.is_(None),
                PartMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master in rows:
        def factory(rev=rev, master=master):
            return {
                "entity_type": master.type,
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": PART_TYPE_LABEL.get(master.type, master.type),
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: PASS —— 8 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud_deliverables.py backend/tests/test_deliverables.py
git commit -m "feat: 交付物汇总零部件聚合与版本去重"
```

---

## Task 2: 图文档与构型项聚合

**Files:**
- Modify: `backend/app/crud_deliverables.py`
- Test: `backend/tests/test_deliverables.py`

**Interfaces:**
- Consumes: Task 1 的 `_collect` / `_finalize` / `_user_names`
- Produces:
  - `list_documents(db: Session, project_id: uuid.UUID, user_names: dict) -> list[dict]` —— `extra` 取 `document_revisions.remark`
  - `list_config_items(db: Session, project_id: uuid.UUID, user_names: dict) -> list[dict]` —— `extra` 取最新迭代的 `version_name`

- [ ] **Step 1: 写失败的测试**

在 `backend/tests/test_deliverables.py` 末尾追加：

```python
# ────────── Task 2: 图文档与构型项 ──────────

from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision, ConfigurationItemIteration,
)


def _document(db, creator, code="D-001", versions=("A",), status="released",
              remark="首版", deleted=False):
    m = models.DocumentMaster(id=uuid.uuid4(), code=code, name=f"{code}图纸",
                              creator_id=creator.id,
                              deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models.DocumentRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                    status=status, remark=remark, creator_id=creator.id)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_item(db, creator, code="CI-001", version="A", status="released",
                 latest_iteration=2, version_name="首轮构型"):
    m = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=f"{code}构型",
                                creator_id=creator.id)
    db.add(m); db.flush()
    r = ConfigurationItemRevision(id=uuid.uuid4(), master_id=m.id, version=version,
                                  status=status, latest_iteration=latest_iteration,
                                  creator_id=creator.id)
    db.add(r); db.flush()
    # 造两个迭代，确认取的是 latest_iteration 那个而不是第一个
    db.add(ConfigurationItemIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1,
                                      version_name="旧名"))
    db.add(ConfigurationItemIteration(id=uuid.uuid4(), revision_id=r.id,
                                      iteration=latest_iteration, version_name=version_name))
    db.commit()
    return m, r


def test_document_extra_is_remark(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _document(db, owner, remark="出图版")
    _link(db, t, "document", revs[0].id)

    items = crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["code"] == "D-001"
    assert items[0]["extra"] == "出图版"
    assert items[0]["entity_type"] == "document"
    assert items[0]["master_id"] == str(m.id)
    assert items[0]["version"] == "A"


def test_deleted_document_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _document(db, owner, deleted=True)
    _link(db, t, "document", revs[0].id)

    assert crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db)) == []


def test_documents_sorted_by_code(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    for code in ("D-003", "D-001", "D-002"):
        _, revs = _document(db, owner, code=code)
        _link(db, t, "document", revs[0].id)

    items = crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db))
    assert [i["code"] for i in items] == ["D-001", "D-002", "D-003"]


def test_config_item_extra_is_latest_iteration_version_name(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, rev = _config_item(db, owner, version_name="二轮构型")
    _link(db, t, "config_item", rev.id)

    items = crud_deliverables.list_config_items(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["code"] == "CI-001"
    assert items[0]["extra"] == "二轮构型"
    assert items[0]["entity_type"] == "config_item"
    assert items[0]["master_id"] == str(m.id)


def test_config_item_without_matching_iteration_has_empty_extra(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m = ConfigurationItemMaster(id=uuid.uuid4(), code="CI-009", name="无迭代构型",
                                creator_id=owner.id)
    db.add(m); db.flush()
    rev = ConfigurationItemRevision(id=uuid.uuid4(), master_id=m.id, version="A",
                                    status="draft", latest_iteration=5, creator_id=owner.id)
    db.add(rev); db.commit()
    _link(db, t, "config_item", rev.id)

    items = crud_deliverables.list_config_items(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["extra"] == ""
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: FAIL — `AttributeError: module 'app.crud_deliverables' has no attribute 'list_documents'`

- [ ] **Step 3: 写实现**

在 `backend/app/crud_deliverables.py` 的 import 区补充：

```python
from sqlalchemy import and_

from app.models import DocumentMaster, DocumentRevision
from app.models_configuration import (
    ConfigurationItemIteration, ConfigurationItemMaster, ConfigurationItemRevision,
)
```

在 `list_parts` 之后追加：

```python
def list_documents(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """图文档：entity_id 指向 document_revisions.id，extra 取该版本备注。"""
    rows = (
        db.query(ProjectTask, DocumentRevision, DocumentMaster)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(DocumentRevision, DocumentRevision.id == ProjectTaskLink.entity_id)
        .join(DocumentMaster, DocumentMaster.id == DocumentRevision.master_id)
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type == "document",
                DocumentRevision.deleted_at.is_(None),
                DocumentMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master in rows:
        def factory(rev=rev, master=master):
            return {
                "entity_type": "document",
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": rev.remark or "",
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)


def list_config_items(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """构型项：entity_id 指向 configuration_item_revisions.id。

    extra 取 latest_iteration 对应迭代的 version_name；迭代缺失时为空串（outerjoin）。
    """
    rows = (
        db.query(ProjectTask, ConfigurationItemRevision, ConfigurationItemMaster,
                 ConfigurationItemIteration)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(ConfigurationItemRevision,
              ConfigurationItemRevision.id == ProjectTaskLink.entity_id)
        .join(ConfigurationItemMaster,
              ConfigurationItemMaster.id == ConfigurationItemRevision.master_id)
        .outerjoin(ConfigurationItemIteration,
                   and_(ConfigurationItemIteration.revision_id == ConfigurationItemRevision.id,
                        ConfigurationItemIteration.iteration == ConfigurationItemRevision.latest_iteration))
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type == "config_item",
                ConfigurationItemRevision.deleted_at.is_(None),
                ConfigurationItemMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master, iteration in rows:
        def factory(rev=rev, master=master, iteration=iteration):
            return {
                "entity_type": "config_item",
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": (iteration.version_name if iteration else "") or "",
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: PASS —— 13 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud_deliverables.py backend/tests/test_deliverables.py
git commit -m "feat: 交付物汇总图文档与构型项聚合"
```

---

## Task 3: 变更聚合 + 汇总入口 + 路由

**Files:**
- Modify: `backend/app/crud_deliverables.py`
- Modify: `backend/app/routers/projects.py`
- Test: `backend/tests/test_deliverables.py`

**Interfaces:**
- Consumes: Task 1、2 的 `list_parts` / `list_documents` / `list_config_items` / `_user_names`
- Produces:
  - `list_changes(db: Session, project_id: uuid.UUID, user_names: dict) -> list[dict]` —— ECR/ECO 合并，`extra` 为 `"ECR"` / `"ECO"`，`version` 恒 `None`，`master_id` 恒 `None`
  - `get_deliverables(db: Session, project_id: uuid.UUID) -> dict` —— 返回 `{counts, config_items, parts, documents, changes}`
  - HTTP: `GET /api/projects/{project_id}/deliverables`

- [ ] **Step 1: 写失败的测试**

在 `backend/tests/test_deliverables.py` 末尾追加：

```python
# ────────── Task 3: 变更、汇总、路由 ──────────

from app.models_ecr import ECR
from app.models_eco import ECO


def _ecr(db, creator, number="ECR-001", status="approved", deleted=False):
    e = ECR(id=uuid.uuid4(), ecr_number=number, title=f"{number}标题", reason="设计缺陷",
            status=status, creator_id=creator.id,
            deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(e); db.commit()
    return e


def _eco(db, creator, number="ECO-001", status="executing"):
    e = ECO(id=uuid.uuid4(), eco_number=number, title=f"{number}标题", reason="设计缺陷",
            status=status, creator_id=creator.id)
    db.add(e); db.commit()
    return e


def test_changes_merge_ecr_and_eco(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    ecr = _ecr(db, owner)
    eco = _eco(db, owner)
    _link(db, t, "ec", ecr.id)
    _link(db, t, "ec", eco.id)

    items = crud_deliverables.list_changes(db, p.id, crud_deliverables._user_names(db))
    assert [i["code"] for i in items] == ["ECO-001", "ECR-001"]
    by_code = {i["code"]: i for i in items}
    assert by_code["ECR-001"]["extra"] == "ECR"
    assert by_code["ECR-001"]["status"] == "approved"
    assert by_code["ECO-001"]["extra"] == "ECO"
    assert all(i["version"] is None for i in items)
    assert all(i["master_id"] is None for i in items)
    assert all(i["entity_type"] == "ec" for i in items)


def test_deleted_ecr_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    ecr = _ecr(db, owner, deleted=True)
    _link(db, t, "ec", ecr.id)

    assert crud_deliverables.list_changes(db, p.id, crud_deliverables._user_names(db)) == []


def test_get_deliverables_shape_and_counts(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    _, prevs = _part(db, owner)
    _, drevs = _document(db, owner)
    _, cirev = _config_item(db, owner)
    ecr = _ecr(db, owner)
    _link(db, t, "part", prevs[0].id)
    _link(db, t, "document", drevs[0].id)
    _link(db, t, "config_item", cirev.id)
    _link(db, t, "ec", ecr.id)

    data = crud_deliverables.get_deliverables(db, p.id)
    assert data["counts"] == {"config_items": 1, "parts": 1, "documents": 1, "changes": 1}
    assert len(data["parts"]) == 1
    assert len(data["documents"]) == 1
    assert len(data["config_items"]) == 1
    assert len(data["changes"]) == 1


def test_get_deliverables_empty_project(db):
    owner = _user(db)
    p = _project(db, owner)
    data = crud_deliverables.get_deliverables(db, p.id)
    assert data["counts"] == {"config_items": 0, "parts": 0, "documents": 0, "changes": 0}
    assert data["parts"] == [] and data["documents"] == []
    assert data["config_items"] == [] and data["changes"] == []


# ────────── 路由 ──────────

from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user, oauth2_scheme


def test_deliverables_endpoint_returns_data(db, engineer_user):
    p = _project(db, engineer_user)
    t = _task(db, p)
    _, prevs = _part(db, engineer_user)
    _link(db, t, "part", prevs[0].id)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    app.dependency_overrides[oauth2_scheme] = lambda: "test-token"
    try:
        client = TestClient(app)
        resp = client.get(f"/api/projects/{p.id}/deliverables")
        assert resp.status_code == 200
        body = resp.json()
        assert body["counts"]["parts"] == 1
        assert body["parts"][0]["code"] == "P-001"
        assert body["parts"][0]["tasks"][0]["code"] == "T-01"
    finally:
        app.dependency_overrides.clear()


def test_deliverables_endpoint_404_for_unknown_project(db, engineer_user):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    app.dependency_overrides[oauth2_scheme] = lambda: "test-token"
    try:
        client = TestClient(app)
        resp = client.get(f"/api/projects/{uuid.uuid4()}/deliverables")
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: FAIL — `AttributeError: module 'app.crud_deliverables' has no attribute 'list_changes'`

- [ ] **Step 3: 实现聚合函数**

在 `backend/app/crud_deliverables.py` 的 import 区补充：

```python
from app.models_eco import ECO
from app.models_ecr import ECR
```

在 `list_config_items` 之后追加：

```python
def list_changes(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """变更：entity_type 统一为 ec，entity_id 指向 ecrs.id 或 ecos.id。

    ECR/ECO 是单实例对象，无版本概念，version 与 master_id 恒为 None。
    """
    bucket: dict = {}
    for model, number_attr, kind in ((ECR, "ecr_number", "ECR"), (ECO, "eco_number", "ECO")):
        rows = (
            db.query(ProjectTask, model)
            .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
            .join(model, model.id == ProjectTaskLink.entity_id)
            .filter(ProjectTask.project_id == project_id,
                    ProjectTask.deleted_at.is_(None),
                    ProjectTaskLink.entity_type == "ec",
                    model.deleted_at.is_(None))
            .all()
        )
        for task, ec in rows:
            def factory(ec=ec, number_attr=number_attr, kind=kind):
                return {
                    "entity_type": "ec",
                    "entity_id": str(ec.id),
                    "master_id": None,
                    "code": getattr(ec, number_attr),
                    "name": ec.title,
                    "version": None,
                    "status": ec.status,
                    "creator_name": user_names.get(ec.creator_id, ""),
                    "extra": kind,
                }
            _collect(bucket, str(ec.id), task, factory)
    return _finalize(bucket)


def get_deliverables(db: Session, project_id: uuid.UUID) -> dict:
    """项目交付物汇总：四类对象各自去重后返回，counts 为各类总数（不受前端筛选影响）。"""
    user_names = _user_names(db)
    config_items = list_config_items(db, project_id, user_names)
    parts = list_parts(db, project_id, user_names)
    documents = list_documents(db, project_id, user_names)
    changes = list_changes(db, project_id, user_names)
    return {
        "counts": {
            "config_items": len(config_items),
            "parts": len(parts),
            "documents": len(documents),
            "changes": len(changes),
        },
        "config_items": config_items,
        "parts": parts,
        "documents": documents,
        "changes": changes,
    }
```

- [ ] **Step 4: 挂路由**

在 `backend/app/routers/projects.py` 第 8 行的 import 改为：

```python
from app import crud_project, crud, crud_deliverables
```

在 `# ──────── 序列化辅助 ────────` 注释行（约第 450 行）之前插入：

```python
@router.get("/{project_id}/deliverables")
async def get_deliverables(project_id: uuid.UUID, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("project:read"))):
    """项目交付物汇总：构型项/零部件/图文档/变更四类，按版本去重、合并来源任务。"""
    crud_project.get_project(db, project_id)   # 项目不存在时抛 404
    return crud_deliverables.get_deliverables(db, project_id)
```

- [ ] **Step 5: 跑全部后端测试确认通过**

Run: `cd backend && python -m pytest tests/test_deliverables.py -v`
Expected: PASS —— 19 passed

Run: `cd backend && python -m pytest -q`
Expected: 全部通过，无新增失败

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_deliverables.py backend/app/routers/projects.py backend/tests/test_deliverables.py
git commit -m "feat: 交付物汇总变更聚合与查询接口"
```

---

## Task 4: 前端类型、API 与纯函数工具

**Files:**
- Modify: `frontend/src/types/project.ts`
- Modify: `frontend/src/services/projectApi.ts`
- Create: `frontend/src/pages/Project/deliverableUtils.ts`
- Test: `frontend/src/pages/Project/deliverableUtils.test.ts`

**Interfaces:**
- Consumes: Task 3 的接口响应形状
- Produces:
  - 类型 `DeliverableTaskRef` / `DeliverableItem` / `DeliverableSummary`
  - `projectApi.getDeliverables(id: string)`
  - `DeliverableTabKey = 'config_items' | 'parts' | 'documents' | 'changes'`
  - `DELIVERABLE_TABS: { key, label, nameLabel, extraLabel, showVersion }[]`
  - `statusLabel(status: string): string`
  - `filterItems(items: DeliverableItem[], search: string, status: string): DeliverableItem[]`
  - `statusOptions(items: DeliverableItem[]): { value: string; label: string }[]`
  - `taskTooltip(tasks: DeliverableTaskRef[]): string`

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/pages/Project/deliverableUtils.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  DELIVERABLE_TABS, statusLabel, filterItems, statusOptions, taskTooltip,
} from './deliverableUtils';
import type { DeliverableItem } from '../../types/project';

function item(over: Partial<DeliverableItem> = {}): DeliverableItem {
  return {
    entity_type: 'part', entity_id: 'e1', master_id: 'm1',
    code: 'P-001', name: '支架', version: 'A', status: 'released',
    creator_name: '张三', extra: '零件', tasks: [{ id: 't1', code: 'T-01', name: '设计' }],
    ...over,
  };
}

describe('DELIVERABLE_TABS', () => {
  it('四个 TAB，仅变更不显示版本列', () => {
    expect(DELIVERABLE_TABS.map((t) => t.key)).toEqual(
      ['config_items', 'parts', 'documents', 'changes']);
    expect(DELIVERABLE_TABS.find((t) => t.key === 'changes')!.showVersion).toBe(false);
    expect(DELIVERABLE_TABS.filter((t) => t.showVersion)).toHaveLength(3);
  });

  it('变更 TAB 的名称列表头为「标题」', () => {
    expect(DELIVERABLE_TABS.find((t) => t.key === 'changes')!.nameLabel).toBe('标题');
    expect(DELIVERABLE_TABS.find((t) => t.key === 'parts')!.nameLabel).toBe('名称');
  });
});

describe('statusLabel', () => {
  it('映射零部件/图文档状态', () => {
    expect(statusLabel('draft')).toBe('草稿');
    expect(statusLabel('released')).toBe('发布');
    expect(statusLabel('obsolete')).toBe('作废');
  });

  it('映射变更专有状态', () => {
    expect(statusLabel('reviewing')).toBe('审核中');
    expect(statusLabel('executing')).toBe('执行中');
  });

  it('未知状态原样返回', () => {
    expect(statusLabel('weird_state')).toBe('weird_state');
  });
});

describe('filterItems', () => {
  const items = [
    item({ code: 'P-001', name: '支架', status: 'released' }),
    item({ code: 'P-002', name: '底板', status: 'draft' }),
  ];

  it('空条件返回全部', () => {
    expect(filterItems(items, '', '')).toHaveLength(2);
  });

  it('按编号搜索', () => {
    expect(filterItems(items, 'P-002', '').map((i) => i.code)).toEqual(['P-002']);
  });

  it('按名称搜索', () => {
    expect(filterItems(items, '支架', '').map((i) => i.code)).toEqual(['P-001']);
  });

  it('搜索忽略大小写与首尾空格', () => {
    expect(filterItems([item({ code: 'ABC-1' })], '  abc  ', '')).toHaveLength(1);
  });

  it('都不命中返回空', () => {
    expect(filterItems(items, '不存在', '')).toEqual([]);
  });

  it('按状态筛选', () => {
    expect(filterItems(items, '', 'draft').map((i) => i.code)).toEqual(['P-002']);
  });

  it('搜索与状态同时生效', () => {
    expect(filterItems(items, 'P-001', 'draft')).toEqual([]);
  });
});

describe('statusOptions', () => {
  it('去重、排序并带中文标签', () => {
    const opts = statusOptions([
      item({ status: 'released' }), item({ status: 'draft' }), item({ status: 'released' }),
    ]);
    expect(opts).toEqual([
      { value: 'draft', label: '草稿' },
      { value: 'released', label: '发布' },
    ]);
  });

  it('空数组返回空', () => {
    expect(statusOptions([])).toEqual([]);
  });
});

describe('taskTooltip', () => {
  it('多任务按行拼接', () => {
    expect(taskTooltip([
      { id: 't1', code: 'T-01', name: '设计' },
      { id: 't2', code: 'T-02', name: '校核' },
    ])).toBe('T-01 设计\nT-02 校核');
  });

  it('空任务返回空串', () => {
    expect(taskTooltip([])).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/pages/Project/deliverableUtils.test.ts`
Expected: FAIL — 无法解析 `./deliverableUtils`

- [ ] **Step 3: 加类型**

在 `frontend/src/types/project.ts` 末尾追加：

```ts
/** 交付物汇总：来源任务引用 */
export interface DeliverableTaskRef {
  id: string;
  code: string;
  name: string;
}

/** 交付物汇总：统一条目形状（四类共用） */
export interface DeliverableItem {
  entity_type: string;           // part/assembly/component/document/config_item/ec
  entity_id: string;             // 版本级 id；变更为 ECR/ECO 主键
  master_id: string | null;      // 变更为 null
  code: string;
  name: string;
  version: string | null;        // 变更恒为 null
  status: string;
  creator_name: string;
  extra: string | null;          // 专属列的值
  tasks: DeliverableTaskRef[];
}

/** 交付物汇总：接口响应 */
export interface DeliverableSummary {
  counts: { config_items: number; parts: number; documents: number; changes: number };
  config_items: DeliverableItem[];
  parts: DeliverableItem[];
  documents: DeliverableItem[];
  changes: DeliverableItem[];
}
```

- [ ] **Step 4: 加 API 方法**

在 `frontend/src/services/projectApi.ts` 的 `myTasks` 一行之前插入：

```ts
  getDeliverables: (id: string) => api.get(`/${id}/deliverables`),
```

- [ ] **Step 5: 写纯函数实现**

创建 `frontend/src/pages/Project/deliverableUtils.ts`：

```ts
/**
 * 交付物汇总 - 纯函数工具
 * TAB 配置、状态标签映射、搜索/筛选、状态选项生成、来源任务文案。
 */
import { STATUS_OPTIONS } from '../../constants';
import type { DeliverableItem, DeliverableTaskRef } from '../../types/project';

export type DeliverableTabKey = 'config_items' | 'parts' | 'documents' | 'changes';

export interface DeliverableTabDef {
  key: DeliverableTabKey;
  label: string;        // TAB 标签
  nameLabel: string;    // 名称列表头
  extraLabel: string;   // 专属列表头
  showVersion: boolean; // 是否显示版本列
}

export const DELIVERABLE_TABS: DeliverableTabDef[] = [
  { key: 'config_items', label: '构型项', nameLabel: '名称', extraLabel: '版本名称', showVersion: true },
  { key: 'parts', label: '零部件', nameLabel: '名称', extraLabel: '类型', showVersion: true },
  { key: 'documents', label: '图文档', nameLabel: '名称', extraLabel: '备注', showVersion: true },
  { key: 'changes', label: '变更', nameLabel: '标题', extraLabel: '类型', showVersion: false },
];

/** 零部件/图文档/构型项状态 */
const BASE_STATUS_LABEL: Record<string, string> =
  Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

/** 变更专有状态（与 ECRStatusBadge / ECOCreateModal 中的映射保持一致） */
const EC_STATUS_LABEL: Record<string, string> = {
  reviewing: '审核中', approved: '已批准', rejected: '已驳回',
  executing: '执行中', completed: '已完成', closed: '已关闭',
};

/** 状态英文值 → 中文标签；映射不到时原样返回 */
export function statusLabel(status: string): string {
  return BASE_STATUS_LABEL[status] || EC_STATUS_LABEL[status] || status;
}

/** 按关键词（编号/名称）与状态过滤 */
export function filterItems(
  items: DeliverableItem[], search: string, status: string,
): DeliverableItem[] {
  const kw = search.trim().toLowerCase();
  return items.filter((i) => {
    if (status && i.status !== status) return false;
    if (!kw) return true;
    return i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw);
  });
}

/** 从当前数据动态生成状态下拉选项（去重 + 排序），不硬编码状态字典 */
export function statusOptions(items: DeliverableItem[]): { value: string; label: string }[] {
  const seen: string[] = [];
  for (const i of items) {
    if (i.status && !seen.includes(i.status)) seen.push(i.status);
  }
  seen.sort();
  return seen.map((s) => ({ value: s, label: statusLabel(s) }));
}

/** 来源任务列的悬浮提示：每行一个任务 */
export function taskTooltip(tasks: DeliverableTaskRef[]): string {
  return tasks.map((t) => `${t.code} ${t.name}`).join('\n');
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/pages/Project/deliverableUtils.test.ts`
Expected: PASS —— 14 passed

- [ ] **Step 7: 提交**

```bash
git add frontend/src/types/project.ts frontend/src/services/projectApi.ts frontend/src/pages/Project/deliverableUtils.ts frontend/src/pages/Project/deliverableUtils.test.ts
git commit -m "feat: 交付物汇总前端类型、API 与纯函数工具"
```

---

## Task 5: 交付物弹窗组件与入口按钮

**Files:**
- Create: `frontend/src/pages/Project/DeliverableModal.tsx`
- Modify: `frontend/src/pages/Project/Projects.tsx`

**Interfaces:**
- Consumes: Task 4 的 `DELIVERABLE_TABS` / `filterItems` / `statusOptions` / `statusLabel` / `taskTooltip` / `projectApi.getDeliverables` / `DeliverableSummary`
- Produces: `DeliverableModal` 默认导出，props：

```ts
interface Props {
  open: boolean;
  projectId: string;
  projectCode: string;
  refreshKey?: number;                     // 变化时重新拉取（Task 7 用）
  onClose: () => void;
  onOpenTask: (taskId: string) => void;    // Task 7 接线，本任务先传空实现
}
```

本任务先做数据加载 + TAB + 工具栏 + 表格；行点击详情（Task 6）、来源任务跳转（Task 7）、导出（Task 8）在后续任务接入。

- [ ] **Step 1: 创建组件**

创建 `frontend/src/pages/Project/DeliverableModal.tsx`：

```tsx
/**
 * 项目交付物汇总弹窗
 * 打开时一次性拉取四类对象，TAB 切换 / 搜索 / 状态筛选全在前端完成。
 */
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { toast } from '../../components/Toast';
import type { DeliverableItem, DeliverableSummary } from '../../types/project';
import {
  DELIVERABLE_TABS, filterItems, statusOptions, statusLabel, taskTooltip,
  type DeliverableTabKey, type DeliverableTabDef,
} from './deliverableUtils';

interface Props {
  open: boolean;
  projectId: string;
  projectCode: string;
  refreshKey?: number;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

const EMPTY_HINT: Record<DeliverableTabKey, string> = {
  config_items: '暂无关联的构型项',
  parts: '暂无关联的零部件',
  documents: '暂无关联的图文档',
  changes: '暂无关联的变更',
};

export default function DeliverableModal({
  open, projectId, projectCode, refreshKey = 0, onClose, onOpenTask,
}: Props) {
  // projectCode 在 Task 8（导出）接入，onOpenTask 在 Task 7（来源任务跳转）接入。
  // 先声明为已使用，避免 eslint no-unused-vars 在 --max-warnings 0 下报错。
  void projectCode; void onOpenTask;

  const [summary, setSummary] = useState<DeliverableSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<DeliverableTabKey>('config_items');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // 打开时（以及 refreshKey 变化时）重新拉取，保证数据新鲜
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    projectApi.getDeliverables(projectId)
      .then((r) => { if (!cancelled) setSummary(r.data); })
      .catch((e: any) => {
        if (!cancelled) toast.error(e?.response?.data?.detail || '加载交付物失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, refreshKey]);

  // 关闭时重置视图状态，下次打开从头开始
  useEffect(() => {
    if (!open) { setTab('config_items'); setSearch(''); setStatus(''); }
  }, [open]);

  // 切 TAB 时清掉筛选，避免上个 TAB 的状态值在新 TAB 里筛空
  const handleTabChange = (k: DeliverableTabKey) => {
    setTab(k); setSearch(''); setStatus('');
  };

  const tabDef: DeliverableTabDef = DELIVERABLE_TABS.find((t) => t.key === tab)!;
  const rawItems: DeliverableItem[] = summary ? summary[tab] : [];
  const items = useMemo(() => filterItems(rawItems, search, status), [rawItems, search, status]);
  const options = useMemo(() => statusOptions(rawItems), [rawItems]);

  // 编号/名称/专属/状态/创建人/来源任务/操作 = 7 列，再按需加版本列
  const colSpan = 7 + (tabDef.showVersion ? 1 : 0);

  return (
    <Modal open={open} title="交付物汇总" onClose={onClose} width="3xl" height="75vh">
      {/* TAB 条 */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-3">
        {DELIVERABLE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary-600 text-primary-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-gray-400">
              {summary ? summary.counts[t.key] : 0}
            </span>
          </button>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="搜索编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">全部状态</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-sm text-gray-400">共 {items.length} 条</span>
      </div>

      {/* 表格 */}
      <div className="border border-gray-200 rounded-lg overflow-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">编号</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{tabDef.nameLabel}</th>
              {tabDef.showVersion && (
                <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">版本</th>
              )}
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{tabDef.extraLabel}</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">状态</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">创建人</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">来源任务</th>
              <th className="px-3 py-2 text-right text-sm font-medium text-gray-500 whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">{EMPTY_HINT[tab]}</td></tr>
            ) : (
              items.map((i) => (
                <tr key={i.entity_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm font-medium whitespace-nowrap">{i.code}</td>
                  <td className="px-3 py-2 text-sm">{i.name}</td>
                  {tabDef.showVersion && (
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{i.version || '—'}</td>
                  )}
                  <td className="px-3 py-2 text-sm text-gray-600">{i.extra || '—'}</td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                      {statusLabel(i.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{i.creator_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-gray-600" title={taskTooltip(i.tasks)}>
                    {i.tasks.length === 0
                      ? '—'
                      : `${i.tasks[0].code} ${i.tasks[0].name}${i.tasks.length > 1 ? ` +${i.tasks.length - 1}` : ''}`}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="text-gray-300 text-sm">详情</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
```

说明：`projectCode` 与 `onOpenTask` 本任务尚未使用（分别在 Task 8、Task 7 接入），先在 props 中占位以免后续改签名，组件内用 `void` 语句消除 lint 的未使用变量告警（已包含在上面的代码块中）。

- [ ] **Step 2: 接入入口按钮**

在 `frontend/src/pages/Project/Projects.tsx` 第 12 行 `import TaskEditModal from './TaskEditModal';` 之后插入：

```tsx
import DeliverableModal from './DeliverableModal';
```

在 `const [memberOpen, setMemberOpen] = useState(false);` 附近（detail tab state 区域）追加：

```tsx
  const [deliverableOpen, setDeliverableOpen] = useState(false);
```

把项目信息条中「成员管理」按钮那段（约第 609-611 行）替换为：

```tsx
                  <button onClick={() => setDeliverableOpen(true)}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">交付物汇总</button>
                  {isManager && (
                    <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
                  )}
```

在 `<MemberManageModal ... />` 之后、`<TaskEditModal ... />` 之前插入（挂载顺序很重要：交付物弹窗必须在 TaskEditModal 之前，才能让任务弹窗叠在其上）：

```tsx
                <DeliverableModal open={deliverableOpen} projectId={selectedProjectId!}
                  projectCode={currentProject.code}
                  onClose={() => setDeliverableOpen(false)}
                  onOpenTask={() => {}} />
```

- [ ] **Step 3: 类型检查与构建**

Run: `cd frontend && npm run build`
Expected: `tsc` 与 `vite build` 均无报错

- [ ] **Step 4: 手工验证**

启动前后端，进入 项目管理 → 项目详情 → 选中一个项目：
1. 「成员管理」左侧出现「交付物汇总」按钮，非项目经理账号也能看到
2. 点击弹出弹窗，四个 TAB 带数量角标
3. 切 TAB 数据正确切换，搜索框与状态下拉可用，右侧「共 N 条」随筛选变化
4. TAB 角标数字**不随**搜索/筛选变化
5. 空数据类型显示「暂无关联的XXX」

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/Project/DeliverableModal.tsx frontend/src/pages/Project/Projects.tsx
git commit -m "feat: 交付物汇总弹窗与入口按钮"
```

---

## Task 6: 行点击打开对象详情弹窗

**Files:**
- Modify: `frontend/src/pages/Project/DeliverableModal.tsx`

**Interfaces:**
- Consumes: 现有 `PartDetailModal` / `DocumentDetailModal` / `ConfigItemDetailModal` / `ECRDetailModal` / `ECODetailModal`
- Produces: 无对外新接口；组件内部新增 `detail: DeliverableItem | null` 状态

各详情弹窗的现有签名（照 `TaskEditModal.tsx` 第 702-733 行）：

| 组件 | props |
|---|---|
| `ConfigItemDetailModal` | `open`, `revisionId`, `onClose` |
| `PartDetailModal` | `open`, `masterId`, `revisionId`, `onClose` |
| `DocumentDetailModal` | `open`, `revisionId`, `onClose`, `onSaved` |
| `ECRDetailModal` | `open`, `ecrId`, `onClose`, `onSuccess` |
| `ECODetailModal` | `ecoId`, `onClose`, `onRefresh` |

- [ ] **Step 1: 加 import**

在 `DeliverableModal.tsx` 的 import 区末尾追加：

```tsx
import PartDetailModal from '../../components/PartDetailModal';
import DocumentDetailModal from '../../components/DocumentDetailModal';
import ConfigItemDetailModal from '../../components/Configuration/ConfigItemDetailModal';
import { ECRDetailModal } from '../../components/ECR/ECRDetailModal';
import { ECODetailModal } from '../../components/ECO/ECODetailModal';
```

- [ ] **Step 2: 加状态**

在 `const [status, setStatus] = useState('');` 之后插入：

```tsx
  const [detail, setDetail] = useState<DeliverableItem | null>(null);
```

在关闭重置的那个 `useEffect` 里补上 `setDetail(null);`：

```tsx
  useEffect(() => {
    if (!open) { setTab('config_items'); setSearch(''); setStatus(''); setDetail(null); }
  }, [open]);
```

- [ ] **Step 3: 行与操作列改为可点击**

把表格 `<tr>` 那行改为：

```tsx
                <tr key={i.entity_id} onClick={() => setDetail(i)}
                    className="hover:bg-gray-50 cursor-pointer">
```

把操作列的占位 `<span className="text-gray-300 text-sm">详情</span>` 替换为：

```tsx
                    <button onClick={(e) => { e.stopPropagation(); setDetail(i); }}
                            className="text-primary-600 hover:text-primary-800 text-sm">详情</button>
```

- [ ] **Step 4: 挂详情弹窗**

在 `</Modal>` 之前插入（注意：需要把组件的返回值从单个 `<Modal>` 改为 `<>...</>` 片段，详情弹窗放在 `</Modal>` **之后**，这样它们的 portal 在交付物弹窗之后挂载，才会叠在上层）：

```tsx
      </Modal>

      {detail?.entity_type === 'config_item' && (
        <ConfigItemDetailModal open revisionId={detail.entity_id}
          onClose={() => setDetail(null)} />
      )}
      {detail?.entity_type === 'ec' && detail.extra === 'ECR' && (
        <ECRDetailModal open ecrId={detail.entity_id}
          onClose={() => setDetail(null)} onSuccess={() => {}} />
      )}
      {detail?.entity_type === 'ec' && detail.extra === 'ECO' && (
        <ECODetailModal ecoId={detail.entity_id}
          onClose={() => setDetail(null)} onRefresh={() => {}} />
      )}
      {detail && ['part', 'assembly', 'component'].includes(detail.entity_type) && (
        <PartDetailModal open masterId={detail.master_id || ''} revisionId={detail.entity_id}
          onClose={() => setDetail(null)} />
      )}
      {detail?.entity_type === 'document' && (
        <DocumentDetailModal open revisionId={detail.entity_id}
          onClose={() => setDetail(null)} onSaved={() => {}} />
      )}
    </>
```

同时把 `return (` 之后的 `<Modal ...>` 前加上 `<>`：

```tsx
  return (
    <>
      <Modal open={open} title="交付物汇总" onClose={onClose} width="3xl" height="75vh">
```

- [ ] **Step 5: 类型检查与构建**

Run: `cd frontend && npm run build`
Expected: 无报错

- [ ] **Step 6: 手工验证**

1. 构型项 TAB 点行 → 构型项详情弹窗打开，且叠在交付物弹窗之上
2. 零部件 TAB 点行 → 零件详情弹窗打开，BOM/属性可正常显示（验证 `master_id` 传对了）
3. 图文档 TAB 点行 → 图文档详情弹窗打开
4. 变更 TAB 点 ECR 行 → ECR 详情弹窗；点 ECO 行 → ECO 详情弹窗
5. 关掉详情弹窗回到交付物弹窗，TAB 与筛选条件保持不变

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/Project/DeliverableModal.tsx
git commit -m "feat: 交付物汇总行点击打开对象详情"
```

---

## Task 7: 来源任务点击打开任务弹窗

**Files:**
- Modify: `frontend/src/pages/Project/DeliverableModal.tsx`
- Modify: `frontend/src/pages/Project/Projects.tsx`

**Interfaces:**
- Consumes: Task 5 传入的 `onOpenTask(taskId)` 与 `refreshKey`；`Projects.tsx` 内已有的 `findTaskById(list, id)`（第 474 行）与 `editTask/editParentId/editOpen` 状态
- Produces: `DeliverableModal` 内部子组件 `TaskCell`（不导出）
- **`TaskEditModal` 零改动**

- [ ] **Step 1: 在 DeliverableModal 内加 TaskCell 子组件**

在 `DeliverableModal.tsx` 中、`export default function DeliverableModal` **之前**插入：

```tsx
/** 来源任务单元格：单任务直接点，多任务用 +N 展开下拉 */
function TaskCell({ tasks, onOpenTask }: {
  tasks: DeliverableTaskRef[];
  onOpenTask: (taskId: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);

  if (tasks.length === 0) return <span className="text-gray-400">—</span>;

  return (
    <span className="relative inline-flex items-center gap-1" title={taskTooltip(tasks)}>
      <button
        onClick={(e) => { e.stopPropagation(); onOpenTask(tasks[0].id); }}
        className="text-primary-600 hover:text-primary-800 truncate max-w-[160px]"
      >
        {tasks[0].code} {tasks[0].name}
      </button>
      {tasks.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setListOpen((v) => !v); }}
            className="px-1 rounded bg-gray-100 text-gray-500 text-xs hover:bg-gray-200"
          >
            +{tasks.length - 1}
          </button>
          {listOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]">
              {tasks.slice(1).map((t) => (
                <button
                  key={t.id}
                  onClick={(e) => { e.stopPropagation(); setListOpen(false); onOpenTask(t.id); }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 truncate"
                >
                  {t.code} {t.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </span>
  );
}
```

在 import 的类型行补上 `DeliverableTaskRef`：

```tsx
import type { DeliverableItem, DeliverableSummary, DeliverableTaskRef } from '../../types/project';
```

- [ ] **Step 2: 用 TaskCell 替换来源任务单元格**

把表格里的来源任务 `<td>` 整段替换为：

```tsx
                  <td className="px-3 py-2 text-sm text-gray-600">
                    <TaskCell tasks={i.tasks} onOpenTask={onOpenTask} />
                  </td>
```

同时删掉 Step 5 中加的 `void projectCode; void onOpenTask;` 里的 `void onOpenTask;` 部分（`projectCode` 仍在 Task 8 才用上，保留 `void projectCode;`）。

- [ ] **Step 3: 在 Projects.tsx 接线**

在 `const [deliverableOpen, setDeliverableOpen] = useState(false);` 之后追加：

```tsx
  const [deliverableKey, setDeliverableKey] = useState(0);
```

在 `findTaskById` 定义（第 474 行附近）之后追加回调：

```tsx
  // 交付物弹窗里点来源任务：不关闭交付物弹窗，直接在其上层打开任务编辑弹窗
  const handleOpenTaskFromDeliverable = useCallback((taskId: string) => {
    const t = findTaskById(tasks, taskId);
    if (!t) { toast.error('任务不存在或已被删除'); return; }
    setEditTask(t);
    setEditParentId(null);
    setEditOpen(true);
  }, [tasks]);
```

把 `<DeliverableModal ... />` 的挂载改为：

```tsx
                <DeliverableModal open={deliverableOpen} projectId={selectedProjectId!}
                  projectCode={currentProject.code} refreshKey={deliverableKey}
                  onClose={() => setDeliverableOpen(false)}
                  onOpenTask={handleOpenTaskFromDeliverable} />
```

把 `<TaskEditModal ... />` 的 `onSaved` 改为同时刷新交付物数据（用户可能在任务弹窗里增删了关联对象）：

```tsx
                <TaskEditModal open={editOpen} projectId={selectedProjectId!} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)}
                               onSaved={() => { setEditOpen(false); reload(); setDeliverableKey((k) => k + 1); }}
                               onRefresh={() => { reload(); setDeliverableKey((k) => k + 1); }} />
```

- [ ] **Step 4: 类型检查与构建**

Run: `cd frontend && npm run build`
Expected: 无报错

- [ ] **Step 5: 手工验证**

1. 单任务来源：点任务名 → 任务编辑弹窗打开，叠在交付物弹窗之上；关闭后回到交付物清单，TAB/搜索/筛选保持不变
2. 多任务来源：点 `+N` → 下拉列出其余任务，点其中一条 → 打开对应任务
3. 点行的其他位置仍然打开对象详情弹窗（`stopPropagation` 生效，没有同时弹两个）
4. 在任务弹窗里删掉一个关联对象并保存 → 关闭任务弹窗后，交付物清单对应条目消失、TAB 角标减一
5. 先打开交付物 → 打开任务 → 关闭任务 → 点行开对象详情，详情仍在最上层

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/Project/DeliverableModal.tsx frontend/src/pages/Project/Projects.tsx
git commit -m "feat: 交付物汇总来源任务点击打开任务弹窗"
```

---

## Task 8: Excel 导出

**Files:**
- Create: `frontend/src/services/deliverableExport.ts`
- Modify: `frontend/src/pages/Project/DeliverableModal.tsx`

**Interfaces:**
- Consumes: Task 4 的 `DELIVERABLE_TABS` / `statusLabel`、`DeliverableSummary`、现有 `frontend/src/lib/file.ts` 的 `downloadBlob(blob, filename)`
- Produces: `exportDeliverables(summary: DeliverableSummary, projectCode: string): void`

- [ ] **Step 1: 写导出服务**

创建 `frontend/src/services/deliverableExport.ts`：

```ts
/**
 * 项目交付物汇总 - Excel 导出
 * 单文件四个 sheet，导出全量四类，不受当前 TAB 与搜索/筛选影响。
 */
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/file';
import { DELIVERABLE_TABS, statusLabel } from '../pages/Project/deliverableUtils';
import type { DeliverableSummary } from '../types/project';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function exportDeliverables(summary: DeliverableSummary, projectCode: string): void {
  const wb = XLSX.utils.book_new();

  for (const tab of DELIVERABLE_TABS) {
    const headers = [
      '编号',
      tab.nameLabel,
      ...(tab.showVersion ? ['版本'] : []),
      tab.extraLabel,
      '状态',
      '创建人',
      '来源任务',
    ];
    const rows = summary[tab.key].map((i) => [
      i.code,
      i.name,
      ...(tab.showVersion ? [i.version || ''] : []),
      i.extra || '',
      statusLabel(i.status),
      i.creator_name || '',
      i.tasks.map((t) => `${t.code} ${t.name}`).join('; '),
    ]);
    // 即使无数据也建表头 sheet，保证四个 sheet 齐全
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: h === '来源任务' ? 36 : h === '编号' ? 18 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, tab.label);
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `项目交付物汇总_${projectCode}_${todayStr()}.xlsx`);
}
```

- [ ] **Step 2: 在弹窗接入导出按钮**

在 `DeliverableModal.tsx` import 区追加：

```tsx
import { exportDeliverables } from '../../services/deliverableExport';
```

删掉之前占位的 `void projectCode;` 一行，并在 `const colSpan = ...` 之后加：

```tsx
  const handleExport = () => {
    if (!summary) return;
    exportDeliverables(summary, projectCode);
  };
```

把 `<Modal ...>` 开标签改为带 `headerAction`：

```tsx
      <Modal open={open} title="交付物汇总" onClose={onClose} width="3xl" height="75vh"
        headerAction={
          <button onClick={handleExport} disabled={!summary}
            title="导出全部四类，不受当前 TAB 与筛选影响"
            className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
            导出 Excel
          </button>
        }>
```

- [ ] **Step 3: 类型检查与构建**

Run: `cd frontend && npm run build`
Expected: 无报错

- [ ] **Step 4: 跑全部前端测试**

Run: `cd frontend && npm test`
Expected: 全部通过

- [ ] **Step 5: 手工验证**

1. 弹窗标题栏右侧、关闭按钮左侧出现「导出 Excel」按钮
2. 数据加载完成前按钮为禁用态
3. 点击后下载 `项目交付物汇总_{项目编号}_{今天}.xlsx`
4. 打开文件：四个 sheet 齐全（构型项/零部件/图文档/变更），即使某类为空也有表头 sheet
5. 变更 sheet 的第二列表头是「标题」且**没有**版本列；其余三个 sheet 有版本列
6. 先在页面上搜索过滤再导出，导出内容仍是全量 —— 验证导出不受筛选影响
7. 来源任务列用 `; ` 分隔多个任务

- [ ] **Step 6: 提交**

```bash
git add frontend/src/services/deliverableExport.ts frontend/src/pages/Project/DeliverableModal.tsx
git commit -m "feat: 交付物汇总 Excel 四 sheet 导出"
```

---

## 最终验收

- [ ] **后端全量测试**

Run: `cd backend && python -m pytest -q`
Expected: 全部通过，无新增失败

- [ ] **前端测试与构建**

Run: `cd frontend && npm test`
Expected: 全部通过

Run: `cd frontend && npm run build`
Expected: 无报错

Run: `cd frontend && npm run lint`
Expected: 无 error（`--max-warnings 0`）

- [ ] **端到端手工验证清单**

1. 非项目经理账号能看到并打开「交付物汇总」
2. 四类数据齐全，同一零件的两个版本各占一行
3. 同一版本被多任务引用时只有一行，`+N` 能展开全部来源任务
4. 已作废（obsolete）的版本出现在清单里并显示「作废」标签
5. 软删除的任务与对象不出现在清单里
6. 行点击 → 对象详情；来源任务点击 → 任务弹窗；两者都叠在交付物弹窗之上
7. 任务弹窗里改动关联对象并保存 → 交付物清单同步刷新
8. 导出 Excel 四个 sheet 内容与页面一致且为全量
