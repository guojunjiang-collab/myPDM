# 图文档详情「反查」Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图文档详情弹窗新增「反查」Tab，五段堆叠展示当前图文档版本被 构型项 / 零部件 / 项目任务 / ECO / ECR 引用的情况，行点击打开对应详情弹窗。

**Architecture:** 各来源的 `document_links` 存图文档**版本(revision) id**（数据定论），故五段均按当前文档 `revisionId` 反查。JSONB 数组匹配用**可移植的 Python 侧过滤**（查候选行后 Python 判断是否含目标 id，兼容 SQLite 测试）。5 个后端端点挂 `routers/documents.py`；前端新增 `DocWhereUsedTab`（镜像 `PartWhereUsedTab`）接入 `DocumentDetailModal`，复用五个现有详情弹窗。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL（测试 SQLite/pytest）；React + TS + Vite。

## Global Constraints

- 五段反查口径统一为**当前文档版本**（输入均为详情当前 `revisionId`）。
- JSONB `document_links` 匹配用 Python 过滤：`any(l.get("document_id") == str(rev) for l in (row.document_links or []))`。不使用 Postgres `@>`（SQLite 测试不支持）。
- 端点挂 `routers/documents.py`（前缀 `/documents`），只读权限 `require_permission("documents:read")`。
  该文件已 import：`uuid`、`get_db`、`Session`、`User`、`require_permission`、`PartMaster`、`PartRevision`。
- 任务段格式化复用 `routers/projects.py::_task_dict`，端点内**函数级 import** 避免 router 间循环引用。
- 查询不到返回空数组（非 500）。
- 后端测试：pytest / SQLite `db` fixture，直接调 crud。运行：
  `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py -v" ; docker exec bom_backend rm -rf /app/tests`
  （host 有依赖时可直接 `cd backend && python -m pytest tests/test_doc_where_used.py -v`）。
- 前端无单测框架，验证用 `cd frontend && npm run build`（含 `tsc`）+ Docker 手测。

---

### Task 1: 后端 — 构型项反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_configuration.py`（新增 `where_used_configurations_by_document`）
- Modify: `backend/app/routers/documents.py`（新增 GET 端点）
- Test: `backend/tests/test_doc_where_used.py`

**Interfaces:**
- Produces: `where_used_configurations_by_document(db, doc_revision_id) -> list[dict]`，元素含
  `config_item_master_id, config_item_revision_id, code, name, version, status`；
  端点 `GET /documents/revisions/{revision_id}/where-used/configurations`。

- [ ] **Step 1: 写失败测试**

`backend/tests/test_doc_where_used.py`：
```python
"""图文档反查：构型项 / 零部件 / 任务 / ECO / ECR。"""
import uuid
from sqlalchemy.orm.attributes import flag_modified
from app import models
from app import crud_configuration as ccrud
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision, ConfigurationItemIteration,
)


def _doc(db, code="D1", versions=("A",)):
    m = models.DocumentMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models.DocumentRevision(id=uuid.uuid4(), master_id=m.id, version=v, status="released")
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1", doc_rev_ids=()):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version="A", status="released")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(
        id=uuid.uuid4(), revision_id=cr.id, iteration=1,
        document_links=[{"document_id": str(d), "document_name": "x"} for d in doc_rev_ids],
    )
    db.add(ci); db.commit()
    return cm, cr, ci


def test_where_used_configs_by_document(db):
    m, revs = _doc(db, versions=("A", "B"))
    cm, cr, ci = _config_iter(db, doc_rev_ids=[revs[0].id])   # 构型项引用 A 版
    hit = ccrud.where_used_configurations_by_document(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["config_item_revision_id"] == str(cr.id)
    assert hit[0]["code"] == cm.code
    # 引用 A，查 B → 空
    assert ccrud.where_used_configurations_by_document(db, revs[1].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_configs_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: FAIL（`where_used_configurations_by_document` 未定义）

- [ ] **Step 3: 实现 crud**

`crud_configuration.py` 末尾追加：
```python
def where_used_configurations_by_document(db: Session, doc_revision_id) -> list:
    """反查：迭代 document_links 引用了该图文档版本的构型项（按构型项 revision 去重）。"""
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for it in db.query(models.ConfigurationItemIteration).all():
        if not any(l.get("document_id") == rev_str for l in (it.document_links or [])):
            continue
        cir = db.query(models.ConfigurationItemRevision).filter(
            models.ConfigurationItemRevision.id == it.revision_id,
            models.ConfigurationItemRevision.deleted_at.is_(None)).first()
        if not cir or str(cir.id) in seen:
            continue
        cim = db.query(models.ConfigurationItemMaster).filter(
            models.ConfigurationItemMaster.id == cir.master_id,
            models.ConfigurationItemMaster.deleted_at.is_(None)).first()
        if not cim:
            continue
        seen.add(str(cir.id))
        out.append({
            "config_item_master_id": str(cim.id), "config_item_revision_id": str(cir.id),
            "code": cim.code, "name": cim.name, "version": cir.version, "status": cir.status,
        })
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_configs_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: PASS

- [ ] **Step 5: 加端点**

`routers/documents.py` 末尾追加：
```python
@router.get("/revisions/{revision_id}/where-used/configurations")
async def doc_where_used_configurations(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_configuration import where_used_configurations_by_document
    return where_used_configurations_by_document(db, revision_id)
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_configuration.py backend/app/routers/documents.py backend/tests/test_doc_where_used.py
git commit -m "feat(documents): 图文档反查-构型项端点"
```

---

### Task 2: 后端 — 零部件反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_documents.py`（新增 `where_used_parts_by_document`）
- Modify: `backend/app/routers/documents.py`（新增 GET 端点）
- Test: `backend/tests/test_doc_where_used.py`

**Interfaces:**
- Produces: `where_used_parts_by_document(db, doc_revision_id) -> list[dict]`，元素含
  `master_id, revision_id, code, name, type`；端点 `GET /documents/revisions/{revision_id}/where-used/parts`。

- [ ] **Step 1: 写失败测试**

追加：
```python
from app import crud_documents as dcrud
from app import models_parts


def _part_iter(db, code="P1", doc_rev_ids=()):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.flush()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", status="released", latest_iteration=1)
    db.add(r); db.flush()
    it = models_parts.PartIteration(
        id=uuid.uuid4(), revision_id=r.id, iteration=1,
        document_links=[{"document_id": str(d), "document_name": "x"} for d in doc_rev_ids],
    )
    db.add(it); db.commit()
    return m, r, it


def test_where_used_parts_by_document(db):
    m, revs = _doc(db, code="D2", versions=("A", "B"))
    pm, pr, it = _part_iter(db, doc_rev_ids=[revs[0].id])
    hit = dcrud.where_used_parts_by_document(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["master_id"] == str(pm.id)
    assert hit[0]["revision_id"] == str(pr.id)
    assert hit[0]["code"] == pm.code
    assert dcrud.where_used_parts_by_document(db, revs[1].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_parts_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: FAIL

- [ ] **Step 3: 实现 crud**

`crud_documents.py` 末尾追加：
```python
def where_used_parts_by_document(db, doc_revision_id) -> list:
    """反查：迭代 document_links 引用了该图文档版本的零部件（按零件 master 去重）。"""
    from app.models_parts import PartIteration, PartRevision, PartMaster
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for it in db.query(PartIteration).all():
        if not any(l.get("document_id") == rev_str for l in (it.document_links or [])):
            continue
        pr = db.query(PartRevision).filter(
            PartRevision.id == it.revision_id, PartRevision.deleted_at.is_(None)).first()
        if not pr:
            continue
        pm = db.query(PartMaster).filter(
            PartMaster.id == pr.master_id, PartMaster.deleted_at.is_(None)).first()
        if not pm or str(pm.id) in seen:
            continue
        seen.add(str(pm.id))
        out.append({"master_id": str(pm.id), "revision_id": str(pr.id),
                    "code": pm.code, "name": pm.name, "type": pm.type})
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_parts_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: PASS

- [ ] **Step 5: 加端点**

`routers/documents.py` 追加：
```python
@router.get("/revisions/{revision_id}/where-used/parts")
async def doc_where_used_parts(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_documents import where_used_parts_by_document
    return where_used_parts_by_document(db, revision_id)
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_documents.py backend/app/routers/documents.py backend/tests/test_doc_where_used.py
git commit -m "feat(documents): 图文档反查-零部件端点"
```

---

### Task 3: 后端 — 项目任务反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_project.py`（新增 `where_used_tasks_by_document`）
- Modify: `backend/app/routers/documents.py`（新增 GET 端点，复用 `_task_dict`）
- Test: `backend/tests/test_doc_where_used.py`

**Interfaces:**
- Produces: `where_used_tasks_by_document(db, doc_revision_id) -> list[tuple[ProjectTask, Project]]`；
  端点返回 `[{ project_id, project_name, task: <_task_dict> }]`。

- [ ] **Step 1: 写失败测试**

追加：
```python
from app import crud_project as pcrud
from app.models_project import Project, ProjectTask, ProjectTaskLink


def test_where_used_tasks_by_document(db):
    m, revs = _doc(db, code="D3", versions=("A",))
    proj = Project(id=uuid.uuid4(), code=f"PRJ-{uuid.uuid4().hex[:5]}", name="proj", owner_id=uuid.uuid4())
    db.add(proj); db.flush()
    t = ProjectTask(id=uuid.uuid4(), project_id=proj.id, code="T1", name="任务1")
    db.add(t); db.flush()
    db.add(ProjectTaskLink(id=uuid.uuid4(), task_id=t.id, entity_type="document", entity_id=revs[0].id))
    db.commit()
    rows = pcrud.where_used_tasks_by_document(db, revs[0].id)
    assert len(rows) == 1
    task, project = rows[0]
    assert str(task.id) == str(t.id) and str(project.id) == str(proj.id)
    # 换一个无引用文档 → 空
    m2, revs2 = _doc(db, code="D3B", versions=("A",))
    assert pcrud.where_used_tasks_by_document(db, revs2[0].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_tasks_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: FAIL

- [ ] **Step 3: 实现 crud**

`crud_project.py` 末尾追加（`Project, ProjectTask, ProjectTaskLink` 已在顶部 import）：
```python
def where_used_tasks_by_document(db: Session, doc_revision_id) -> list:
    """反查：通过 task_link(entity_type=document) 引用了该图文档版本的任务（按任务去重）。"""
    rows = (
        db.query(ProjectTask, Project)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(Project, Project.id == ProjectTask.project_id)
        .filter(ProjectTaskLink.entity_type == "document",
                ProjectTaskLink.entity_id == doc_revision_id,
                ProjectTask.deleted_at.is_(None),
                Project.deleted_at.is_(None))
        .all()
    )
    seen, out = set(), []
    for t, p in rows:
        if str(t.id) in seen:
            continue
        seen.add(str(t.id))
        out.append((t, p))
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_tasks_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: PASS

- [ ] **Step 5: 加端点**

`routers/documents.py` 追加：
```python
@router.get("/revisions/{revision_id}/where-used/tasks")
async def doc_where_used_tasks(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_project import where_used_tasks_by_document
    from .projects import _task_dict
    return [
        {"project_id": str(p.id), "project_name": p.name, "task": _task_dict(db, t)}
        for t, p in where_used_tasks_by_document(db, revision_id)
    ]
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_project.py backend/app/routers/documents.py backend/tests/test_doc_where_used.py
git commit -m "feat(documents): 图文档反查-项目任务端点"
```

---

### Task 4: 后端 — ECO / ECR 反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_eco.py`（新增 `where_used_by_document`）
- Modify: `backend/app/crud_ecr.py`（新增 `where_used_by_document`）
- Modify: `backend/app/routers/documents.py`（新增 2 个 GET 端点）
- Test: `backend/tests/test_doc_where_used.py`

**Interfaces:**
- Produces: `crud_eco.where_used_by_document(db, doc_revision_id) -> list[dict]`（`eco_id, eco_number, title, status`）；
  `crud_ecr.where_used_by_document(db, doc_revision_id) -> list[dict]`（`ecr_id, ecr_number, title, status`）；
  端点 `.../where-used/ecos`、`.../where-used/ecrs`。

- [ ] **Step 1: 写失败测试**

追加：
```python
from app import crud_eco, crud_ecr
from app.models_eco import ECO
from app.models_ecr import ECR


def test_where_used_ecos_and_ecrs_by_document(db):
    m, revs = _doc(db, code="D4", versions=("A", "B"))
    eco = ECO(id=uuid.uuid4(), eco_number="ECO-1", title="变更1", reason="设计", creator_id=uuid.uuid4(),
              document_links=[{"document_id": str(revs[0].id), "document_name": "x"}])
    ecr = ECR(id=uuid.uuid4(), ecr_number="ECR-1", title="请求1", reason="设计", creator_id=uuid.uuid4(),
              document_links=[{"document_id": str(revs[0].id), "document_name": "x"}])
    db.add_all([eco, ecr]); db.commit()
    eco_hit = crud_eco.where_used_by_document(db, revs[0].id)
    ecr_hit = crud_ecr.where_used_by_document(db, revs[0].id)
    assert len(eco_hit) == 1 and eco_hit[0]["eco_number"] == "ECO-1"
    assert len(ecr_hit) == 1 and ecr_hit[0]["ecr_number"] == "ECR-1"
    # 查 B 版 → 都空
    assert crud_eco.where_used_by_document(db, revs[1].id) == []
    assert crud_ecr.where_used_by_document(db, revs[1].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py::test_where_used_ecos_and_ecrs_by_document -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: FAIL

- [ ] **Step 3: 实现两个 crud**

`crud_eco.py` 末尾追加：
```python
def where_used_by_document(db, doc_revision_id) -> list:
    """反查：document_links 引用了该图文档版本的 ECO（按 ECO 去重）。"""
    from app.models_eco import ECO
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for eco in db.query(ECO).all():
        if str(eco.id) in seen:
            continue
        if any(l.get("document_id") == rev_str for l in (eco.document_links or [])):
            seen.add(str(eco.id))
            out.append({"eco_id": str(eco.id), "eco_number": eco.eco_number,
                        "title": eco.title, "status": eco.status})
    return out
```
`crud_ecr.py` 末尾追加：
```python
def where_used_by_document(db, doc_revision_id) -> list:
    """反查：document_links 引用了该图文档版本的 ECR（按 ECR 去重）。"""
    from app.models_ecr import ECR
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for ecr in db.query(ECR).all():
        if str(ecr.id) in seen:
            continue
        if any(l.get("document_id") == rev_str for l in (ecr.document_links or [])):
            seen.add(str(ecr.id))
            out.append({"ecr_id": str(ecr.id), "ecr_number": ecr.ecr_number,
                        "title": ecr.title, "status": ecr.status})
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py -v" ; docker exec bom_backend rm -rf /app/tests`
Expected: 全部 PASS

- [ ] **Step 5: 加 2 个端点**

`routers/documents.py` 追加：
```python
@router.get("/revisions/{revision_id}/where-used/ecos")
async def doc_where_used_ecos(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_eco import where_used_by_document
    return where_used_by_document(db, revision_id)


@router.get("/revisions/{revision_id}/where-used/ecrs")
async def doc_where_used_ecrs(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_ecr import where_used_by_document
    return where_used_by_document(db, revision_id)
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_eco.py backend/app/crud_ecr.py backend/app/routers/documents.py backend/tests/test_doc_where_used.py
git commit -m "feat(documents): 图文档反查-ECO/ECR端点"
```

---

### Task 5: 前端 — `documentsApi` 5 方法

**Files:**
- Modify: `frontend/src/services/api.ts`（`documentsApi` 内新增 5 方法）

**Interfaces:**
- Produces: `documentsApi.whereUsedConfigurations/whereUsedParts/whereUsedTasks/whereUsedEcos/whereUsedEcrs`
  `(revisionId) => Promise<any[]>`。

- [ ] **Step 1: 加方法**

`documentsApi` 对象内追加：
```ts
  whereUsedConfigurations: (revisionId: string) =>
    api.get(`/documents/revisions/${revisionId}/where-used/configurations`).then(r => r.data),
  whereUsedParts: (revisionId: string) =>
    api.get(`/documents/revisions/${revisionId}/where-used/parts`).then(r => r.data),
  whereUsedTasks: (revisionId: string) =>
    api.get(`/documents/revisions/${revisionId}/where-used/tasks`).then(r => r.data),
  whereUsedEcos: (revisionId: string) =>
    api.get(`/documents/revisions/${revisionId}/where-used/ecos`).then(r => r.data),
  whereUsedEcrs: (revisionId: string) =>
    api.get(`/documents/revisions/${revisionId}/where-used/ecrs`).then(r => r.data),
```

- [ ] **Step 2: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(documents): 前端图文档反查 API（5 段）"
```

---

### Task 6: 前端 — `DocWhereUsedTab` 五段堆叠 + 懒加载

**Files:**
- Create: `frontend/src/components/DocumentDetailModal/DocWhereUsedTab.tsx`

**Interfaces:**
- Consumes: `documentsApi.whereUsed*`（Task 5）。
- Produces: `DocWhereUsedTab`，props
  `{ revisionId: string; onOpenConfig: (cirId: string) => void; onOpenPart: (masterId: string, revisionId: string) => void; onOpenTask: (projectId: string, task: any) => void; onOpenEco: (ecoId: string) => void; onOpenEcr: (ecrId: string) => void }`。

- [ ] **Step 1: 实现五段组件**

```tsx
import { useEffect, useState } from 'react';
import { documentsApi } from '../../services/api';

interface Props {
  revisionId: string;
  onOpenConfig: (cirId: string) => void;
  onOpenPart: (masterId: string, revisionId: string) => void;
  onOpenTask: (projectId: string, task: any) => void;
  onOpenEco: (ecoId: string) => void;
  onOpenEcr: (ecrId: string) => void;
}

function useLazy<T>(fetcher: () => Promise<T[]>, dep: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let c = false; setLoading(true); setError(false);
    fetcher().then(d => { if (!c) setData(d || []); })
      .catch(() => { if (!c) setError(true); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [dep]);
  return { data, loading, error };
}

const Section = ({ title, count, children }: any) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-2">
      <span className="text-sm font-semibold text-gray-700">{title}</span>
      <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{count}</span>
    </div>
    {children}
  </div>
);

const State = ({ s, children }: any) =>
  s.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
    : s.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
    : s.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
    : children;

export default function DocWhereUsedTab(props: Props) {
  const { revisionId } = props;
  const cfg = useLazy(() => documentsApi.whereUsedConfigurations(revisionId), revisionId);
  const prt = useLazy(() => documentsApi.whereUsedParts(revisionId), revisionId);
  const tsk = useLazy(() => documentsApi.whereUsedTasks(revisionId), revisionId);
  const eco = useLazy(() => documentsApi.whereUsedEcos(revisionId), revisionId);
  const ecr = useLazy(() => documentsApi.whereUsedEcrs(revisionId), revisionId);
  const th = "px-3 py-2 text-left text-gray-500 font-medium";
  const tbl = "w-full text-sm border rounded";

  return (
    <div className="space-y-2">
      <Section title="被构型项引用" count={cfg.loading ? '…' : cfg.data.length}>
        <State s={cfg}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>构型项件号</th><th className={th}>名称</th>
            <th className={`${th} w-16`}>版本</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {cfg.data.map((r: any) => (
              <tr key={r.config_item_revision_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenConfig(r.config_item_revision_id)}>
                <td className="px-3 py-2 font-medium">{r.code}</td><td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.version || '-'}</td>
                <td className="px-3 py-2 text-gray-500">{r.status || '-'}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被零部件引用" count={prt.loading ? '…' : prt.data.length}>
        <State s={prt}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>件号</th><th className={th}>名称</th><th className={`${th} w-16`}>类型</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {prt.data.map((r: any) => (
              <tr key={r.master_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenPart(r.master_id, r.revision_id)}>
                <td className="px-3 py-2 font-medium">{r.code}</td><td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.type === 'assembly' ? '部件' : '零件'}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被项目任务引用" count={tsk.loading ? '…' : tsk.data.length}>
        <State s={tsk}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>项目</th><th className={th}>任务</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {tsk.data.map((r: any) => (
              <tr key={r.task.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenTask(r.project_id, r.task)}>
                <td className="px-3 py-2">{r.project_name}</td>
                <td className="px-3 py-2 font-medium">{r.task.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.task.status}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被 ECO 引用" count={eco.loading ? '…' : eco.data.length}>
        <State s={eco}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>ECO 编号</th><th className={th}>标题</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {eco.data.map((r: any) => (
              <tr key={r.eco_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenEco(r.eco_id)}>
                <td className="px-3 py-2 font-medium">{r.eco_number}</td>
                <td className="px-3 py-2">{r.title}</td>
                <td className="px-3 py-2 text-gray-500">{r.status}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被 ECR 引用" count={ecr.loading ? '…' : ecr.data.length}>
        <State s={ecr}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>ECR 编号</th><th className={th}>标题</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {ecr.data.map((r: any) => (
              <tr key={r.ecr_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenEcr(r.ecr_id)}>
                <td className="px-3 py-2 font-medium">{r.ecr_number}</td>
                <td className="px-3 py-2">{r.title}</td>
                <td className="px-3 py-2 text-gray-500">{r.status}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/DocumentDetailModal/DocWhereUsedTab.tsx
git commit -m "feat(documents): 反查 Tab 五段组件 DocWhereUsedTab"
```

---

### Task 7: 前端 — 接入 `DocumentDetailModal`（Tab + 五个弹窗）

**Files:**
- Modify: `frontend/src/components/DocumentDetailModal.tsx`

**Interfaces:**
- Consumes: `DocWhereUsedTab`（Task 6）；现有 `ConfigItemDetailModal` / `PartDetailModal` /
  `TaskEditModal` / `ECODetailModal` / `ECRDetailModal`（props 见 spec §5.3）。

- [ ] **Step 1: TabKey + tabs 注册**

`TabKey` 联合类型加 `'whereused'`；`tabs` useMemo 数组（约 334 行）新增
`{ key: 'whereused' as const, label: '反查' }`（放版本历史之后）。

- [ ] **Step 2: import + 弹窗 state**

顶部 import：
```tsx
import DocWhereUsedTab from './DocumentDetailModal/DocWhereUsedTab';
import ConfigItemDetailModal from './Configuration/ConfigItemDetailModal';
import PartDetailModal from './PartDetailModal';
import TaskEditModal from '../pages/Project/TaskEditModal';
import { ECODetailModal } from './ECO/ECODetailModal';
import { ECRDetailModal } from './ECR/ECRDetailModal';
```
> 注：`ECODetailModal` 为具名导出（`export function ECODetailModal`）；`ECRDetailModal` 按其实际导出方式
> 调整为具名或默认。`PartDetailModal`/`ConfigItemDetailModal`/`TaskEditModal` 按各自导出方式引入。
组件内 state：
```tsx
const [wuConfig, setWuConfig] = useState<string | null>(null);
const [wuPart, setWuPart] = useState<{ masterId: string; revisionId: string } | null>(null);
const [wuTask, setWuTask] = useState<{ projectId: string; task: any } | null>(null);
const [wuEco, setWuEco] = useState<string | null>(null);
const [wuEcr, setWuEcr] = useState<string | null>(null);
```

- [ ] **Step 3: 渲染 Tab 内容**

在 tab 内容区（与 `activeTab === 'versions'` 等并列）加：
```tsx
{activeTab === 'whereused' && effectiveRevisionId && (
  <DocWhereUsedTab
    revisionId={effectiveRevisionId}
    onOpenConfig={(cirId) => setWuConfig(cirId)}
    onOpenPart={(masterId, revisionId) => setWuPart({ masterId, revisionId })}
    onOpenTask={(projectId, task) => setWuTask({ projectId, task })}
    onOpenEco={(ecoId) => setWuEco(ecoId)}
    onOpenEcr={(ecrId) => setWuEcr(ecrId)}
  />
)}
```

- [ ] **Step 4: 渲染五个弹窗（就地）**

组件底部加（各弹窗必填 props 以其组件定义为准，缺失的可选回调传空函数）：
```tsx
{wuConfig && (
  <ConfigItemDetailModal open={!!wuConfig} revisionId={wuConfig} onClose={() => setWuConfig(null)} />
)}
{wuPart && (
  <PartDetailModal open={!!wuPart} masterId={wuPart.masterId} revisionId={wuPart.revisionId}
    onClose={() => setWuPart(null)} />
)}
{wuTask && (
  <TaskEditModal open={!!wuTask} projectId={wuTask.projectId} task={wuTask.task}
    onClose={() => setWuTask(null)} onSaved={() => {}} onRefresh={() => {}} />
)}
{wuEco && (
  <ECODetailModal ecoId={wuEco} onClose={() => setWuEco(null)} onRefresh={() => {}} />
)}
{wuEcr && (
  <ECRDetailModal ecrId={wuEcr} onClose={() => setWuEcr(null)} onRefresh={() => {}} />
)}
```
> 核对各弹窗 Props：`ConfigItemDetailModal`{open,revisionId,onClose}；
> `PartDetailModal`{open,masterId,revisionId,onClose}（以其定义为准，可能需 nested 变体）；
> `TaskEditModal`{open,projectId,task,onClose,onSaved,onRefresh}；
> `ECODetailModal`{ecoId,onClose,onRefresh,executionMode?}；`ECRDetailModal` 类比。

- [ ] **Step 5: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/DocumentDetailModal.tsx
git commit -m "feat(documents): 图文档详情接入反查 Tab 与五类详情弹窗"
```

---

### Task 8: 集成验证（Docker 手测）

**Files:** 无（验证）

- [ ] **Step 1: 全量新测试**

```bash
docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_doc_where_used.py -v" ; docker exec bom_backend rm -rf /app/tests
```
Expected: `test_doc_where_used.py` 全绿。

- [ ] **Step 2: 重建并启动**

```bash
cd frontend && npm run build
docker compose up -d --build
```

- [ ] **Step 3: 功能手测（https://localhost:8080，Ctrl+F5）**

造数：某图文档版本 X 被 (a) 某构型项「关联图文档」、(b) 某零部件「关联图文档」、(c) 某项目任务关联、
(d) 某 ECO 关联文档、(e) 某 ECR 关联文档。打开该图文档详情 → 「反查」Tab：
- 五段分别显示对应引用；空段显示「暂无引用」。
- 点构型项行→`ConfigItemDetailModal`；点零部件行→`PartDetailModal`；点任务行→`TaskEditModal`；
  点 ECO 行→`ECODetailModal`；点 ECR 行→`ECRDetailModal`。
- 切到该文档**另一版本 Y**（版本历史 Tab）→ 五段刷新为 Y 的引用（引用 X 的不再出现）。

- [ ] **Step 4: 接口抽查（可选）**

```bash
docker exec bom_postgres psql -U bomadmin -d bom_system -c "SELECT jsonb_array_elements(document_links)->>'document_id' FROM part_iterations WHERE jsonb_array_length(document_links) > 0 LIMIT 1;"
```
用该 revision_id 登录态访问 `/documents/revisions/{id}/where-used/parts`，确认返回非空。

---

## Self-Review

- **Spec 覆盖**：§4.2 构型项→Task1；§4.3 零部件→Task2；§4.4 任务→Task3；§4.5 ECO/ECR→Task4；
  §4.1 端点齐（5 个）；§5.4 API→Task5；§5.2 五段→Task6；§5.1/§5.3 接入+五弹窗→Task7；§8 测试→各任务+Task8。
- **占位符**：后端 crud/端点/测试均可运行；前端 Task7 弹窗 import/props「以组件定义为准」为既有组件适配说明，
  非新逻辑。
- **类型一致**：端点路径 `GET /documents/revisions/{revision_id}/where-used/{configurations|parts|tasks|ecos|ecrs}`
  贯穿 spec/后端/前端；返回字段 `config_item_revision_id`/`{master_id,revision_id}`/`{project_id,task}`/
  `eco_id`/`ecr_id` 与前端 `onOpenConfig/onOpenPart/onOpenTask/onOpenEco/onOpenEcr` 入参一致；
  `document_links` Python 过滤统一用 `l.get("document_id") == str(rev)`。
