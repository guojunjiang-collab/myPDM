# 零部件详情「反查」Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在零部件详情弹窗新增「反查」Tab，四段堆叠展示当前零部件版本被 父项零部件 / 构型项 / 项目任务 / 构型配置(Profile) 引用的情况，行点击打开对应详情弹窗。

**Architecture:** 复用已有 BOM 反查接口（`bomApi.trace`）；新增 3 个后端反查端点（构型项/任务/配置，均按当前 `revision_id` 查询，前置的构型版本级绑定改造已使这三张关联表均存 revision 级字段）。前端抽取 `BomWhereUsedTree` 共享组件（同时重构原 `BOMTracePanel` 去重），新增 `PartWhereUsedTab` 四段懒加载，行点击复用四个现有详情弹窗。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL（测试 SQLite/pytest）；React + TS + Vite。

## Global Constraints

- 四段反查口径统一为**当前版本**（输入均为详情当前 `revisionId`）。
- 后端端点复用只读认证 `require_permission("parts:read")`，查询不到返回空数组（非 500）。
- 端点挂在 `routers/parts.py`（前缀 `/parts`），保持「以零部件为主语」URL；任务段格式化复用
  `routers/projects.py::_task_dict`，在端点内**函数级 import** 避免 router 间循环引用。
- 后端测试：pytest，`db` fixture（SQLite 内存库），直接调 crud。运行：
  `cd backend && python -m pytest tests/<file> -v`（host 无依赖时：`docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/<file> -v"`，跑完 `docker exec bom_backend rm -rf /app/tests`）。
- 前端无单测框架，验证用 `cd frontend && npm run build`（含 `tsc`）+ Docker 手测。
- 构型配置段仅取正式清单 `configuration_profile_items`（不含草稿工作表）。

---

### Task 1: 后端 — 构型项反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_configuration.py`（新增 `where_used_configurations`）
- Modify: `backend/app/routers/parts.py`（新增 GET 端点）
- Test: `backend/tests/test_where_used.py`

**Interfaces:**
- Produces: `where_used_configurations(db, revision_id) -> list[dict]`，元素含
  `config_item_master_id, config_item_revision_id, code, name, version, status, is_required, quantity`；
  端点 `GET /parts/revisions/{revision_id}/where-used/configurations`。

- [ ] **Step 1: 写失败测试**

`backend/tests/test_where_used.py`：
```python
"""零部件反查：构型项 / 项目任务 / 构型配置。"""
import uuid
from app import models_parts
from app import crud_configuration as ccrud
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision,
    ConfigurationItemIteration, ConfigurationItemPart,
)


def _part(db, code="P1", versions=("A",)):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                      status="released", latest_iteration=1)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1", version="A"):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version=version, status="released")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(id=uuid.uuid4(), revision_id=cr.id, iteration=1)
    db.add(ci); db.commit()
    return cm, cr, ci


def test_where_used_configurations_matches_bound_version(db):
    m, revs = _part(db, versions=("A", "B"))
    cm, cr, ci = _config_iter(db)
    # 构型项绑定 A 版
    db.add(ConfigurationItemPart(id=uuid.uuid4(), iteration_id=ci.id, part_type="part",
                                 part_id=m.id, revision_id=revs[0].id, quantity=2)); db.commit()
    hit_a = ccrud.where_used_configurations(db, revs[0].id)
    assert len(hit_a) == 1
    assert hit_a[0]["config_item_revision_id"] == str(cr.id)
    assert hit_a[0]["code"] == cm.code
    assert hit_a[0]["quantity"] == 2
    # 查 B 版：不命中（绑定的是 A）
    assert ccrud.where_used_configurations(db, revs[1].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd backend && python -m pytest tests/test_where_used.py::test_where_used_configurations_matches_bound_version -v`
Expected: FAIL（`where_used_configurations` 未定义）

- [ ] **Step 3: 实现 crud**

`crud_configuration.py` 末尾追加：
```python
def where_used_configurations(db: Session, revision_id) -> list:
    """反查：绑定了该零部件版本(revision)的构型项（按构型项 revision 去重）。"""
    rows = (
        db.query(models.ConfigurationItemPart, models.ConfigurationItemRevision, models.ConfigurationItemMaster)
        .join(models.ConfigurationItemIteration,
              models.ConfigurationItemIteration.id == models.ConfigurationItemPart.iteration_id)
        .join(models.ConfigurationItemRevision,
              models.ConfigurationItemRevision.id == models.ConfigurationItemIteration.revision_id)
        .join(models.ConfigurationItemMaster,
              models.ConfigurationItemMaster.id == models.ConfigurationItemRevision.master_id)
        .filter(models.ConfigurationItemPart.revision_id == revision_id,
                models.ConfigurationItemMaster.deleted_at.is_(None),
                models.ConfigurationItemRevision.deleted_at.is_(None))
        .all()
    )
    seen, out = set(), []
    for cip, cir, cim in rows:
        if str(cir.id) in seen:
            continue
        seen.add(str(cir.id))
        out.append({
            "config_item_master_id": str(cim.id),
            "config_item_revision_id": str(cir.id),
            "code": cim.code, "name": cim.name,
            "version": cir.version, "status": cir.status,
            "is_required": cip.is_required, "quantity": cip.quantity,
        })
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd backend && python -m pytest tests/test_where_used.py::test_where_used_configurations_matches_bound_version -v`
Expected: PASS

- [ ] **Step 5: 加端点**

`routers/parts.py` 末尾追加（确认文件顶部已 `import uuid`、有 `get_db`/`require_permission`；
沿用现有 import 风格）：
```python
@router.get("/revisions/{revision_id}/where-used/configurations")
async def where_used_configurations_ep(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:read")),
):
    from ..crud_configuration import where_used_configurations
    return where_used_configurations(db, revision_id)
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_configuration.py backend/app/routers/parts.py backend/tests/test_where_used.py
git commit -m "feat(parts): 构型项反查端点 where-used/configurations"
```

---

### Task 2: 后端 — 项目任务反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_project.py`（新增 `where_used_tasks`）
- Modify: `backend/app/routers/parts.py`（新增 GET 端点，复用 `_task_dict`）
- Test: `backend/tests/test_where_used.py`

**Interfaces:**
- Produces: `where_used_tasks(db, revision_id) -> list[tuple[ProjectTask, Project]]`；
  端点 `GET /parts/revisions/{revision_id}/where-used/tasks` 返回
  `[{ project_id, project_name, task: <_task_dict> }]`。

- [ ] **Step 1: 写失败测试**

追加到 `test_where_used.py`：
```python
from app import crud_project as pcrud
from app.models_project import Project, ProjectTask, ProjectTaskLink


def _task_with_link(db, entity_rev_id, entity_type="part"):
    proj = Project(id=uuid.uuid4(), code=f"PRJ-{uuid.uuid4().hex[:5]}", name="proj", owner_id=uuid.uuid4())
    db.add(proj); db.flush()
    t = ProjectTask(id=uuid.uuid4(), project_id=proj.id, code="T1", name="任务1")
    db.add(t); db.flush()
    db.add(ProjectTaskLink(id=uuid.uuid4(), task_id=t.id, entity_type=entity_type, entity_id=entity_rev_id))
    db.commit()
    return proj, t


def test_where_used_tasks_matches_revision(db):
    m, revs = _part(db, versions=("A",))
    proj, t = _task_with_link(db, revs[0].id, entity_type="part")
    rows = pcrud.where_used_tasks(db, revs[0].id)
    assert len(rows) == 1
    task, project = rows[0]
    assert str(task.id) == str(t.id)
    assert str(project.id) == str(proj.id)
    # 无引用版本 → 空
    m2, revs2 = _part(db, code="P2", versions=("A",))
    assert pcrud.where_used_tasks(db, revs2[0].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd backend && python -m pytest tests/test_where_used.py::test_where_used_tasks_matches_revision -v`
Expected: FAIL（`where_used_tasks` 未定义）

- [ ] **Step 3: 实现 crud**

`crud_project.py` 末尾追加（`Project, ProjectTask, ProjectTaskLink` 已在文件顶部 import）：
```python
def where_used_tasks(db: Session, revision_id) -> list:
    """反查：引用了该零部件版本的项目任务（含所属项目）。按任务去重。"""
    rows = (
        db.query(ProjectTask, Project)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(Project, Project.id == ProjectTask.project_id)
        .filter(ProjectTaskLink.entity_type.in_(["part", "assembly", "component"]),
                ProjectTaskLink.entity_id == revision_id,
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

Run: `cd backend && python -m pytest tests/test_where_used.py::test_where_used_tasks_matches_revision -v`
Expected: PASS

- [ ] **Step 5: 加端点（复用 `_task_dict`）**

`routers/parts.py` 追加：
```python
@router.get("/revisions/{revision_id}/where-used/tasks")
async def where_used_tasks_ep(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:read")),
):
    from ..crud_project import where_used_tasks
    from .projects import _task_dict
    return [
        {"project_id": str(p.id), "project_name": p.name, "task": _task_dict(db, t)}
        for t, p in where_used_tasks(db, revision_id)
    ]
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_project.py backend/app/routers/parts.py backend/tests/test_where_used.py
git commit -m "feat(parts): 项目任务反查端点 where-used/tasks"
```

---

### Task 3: 后端 — 构型配置(Profile)反查（crud + 端点 + 测试）

**Files:**
- Modify: `backend/app/crud_configuration.py`（新增 `where_used_profiles`）
- Modify: `backend/app/routers/parts.py`（新增 GET 端点）
- Test: `backend/tests/test_where_used.py`

**Interfaces:**
- Produces: `where_used_profiles(db, revision_id) -> list[dict]`，元素含
  `profile_id, code, name, status, is_required, quantity`；
  端点 `GET /parts/revisions/{revision_id}/where-used/profiles`。

- [ ] **Step 1: 写失败测试**

追加到 `test_where_used.py`：
```python
from app.models_configuration import ConfigurationProfile, ConfigurationProfileItem


def test_where_used_profiles_matches_bound_version(db):
    m, revs = _part(db, versions=("A", "B"))
    prof = ConfigurationProfile(
        id=uuid.uuid4(), code=f"CFG-{uuid.uuid4().hex[:5]}", name="配置1",
        status="active", creator_id=uuid.uuid4(), reviewers=[], review_mode="all", cc_users=[],
    )
    db.add(prof); db.flush()
    db.add(ConfigurationProfileItem(
        id=uuid.uuid4(), profile_id=prof.id, item_type="part", item_id=m.id,
        item_code=m.code, item_name=m.name, part_revision_id=revs[0].id,
        is_required=True, is_selected=True, quantity=1, source_type="direct", sort_order=0,
    )); db.commit()
    hit = ccrud.where_used_profiles(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["profile_id"] == str(prof.id)
    assert hit[0]["code"] == prof.code
    # 绑定 A，查 B → 空
    assert ccrud.where_used_profiles(db, revs[1].id) == []
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd backend && python -m pytest tests/test_where_used.py::test_where_used_profiles_matches_bound_version -v`
Expected: FAIL（`where_used_profiles` 未定义）

- [ ] **Step 3: 实现 crud**

`crud_configuration.py` 末尾追加：
```python
def where_used_profiles(db: Session, revision_id) -> list:
    """反查：正式配置清单中引用了该零部件版本的构型配置(Profile)。按 profile 去重。"""
    rows = (
        db.query(models.ConfigurationProfileItem, models.ConfigurationProfile)
        .join(models.ConfigurationProfile,
              models.ConfigurationProfile.id == models.ConfigurationProfileItem.profile_id)
        .filter(models.ConfigurationProfileItem.part_revision_id == revision_id,
                models.ConfigurationProfile.deleted_at.is_(None))
        .all()
    )
    seen, out = set(), []
    for pi, prof in rows:
        if str(prof.id) in seen:
            continue
        seen.add(str(prof.id))
        out.append({
            "profile_id": str(prof.id),
            "code": prof.code, "name": prof.name, "status": prof.status,
            "is_required": pi.is_required, "quantity": pi.quantity,
        })
    return out
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd backend && python -m pytest tests/test_where_used.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 加端点**

`routers/parts.py` 追加：
```python
@router.get("/revisions/{revision_id}/where-used/profiles")
async def where_used_profiles_ep(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:read")),
):
    from ..crud_configuration import where_used_profiles
    return where_used_profiles(db, revision_id)
```

- [ ] **Step 6: 提交**

```bash
git add backend/app/crud_configuration.py backend/app/routers/parts.py backend/tests/test_where_used.py
git commit -m "feat(parts): 构型配置反查端点 where-used/profiles"
```

---

### Task 4: 前端 — API 方法

**Files:**
- Modify: `frontend/src/services/api.ts`（`partsApi` 内新增 3 方法）

**Interfaces:**
- Produces: `partsApi.whereUsedConfigurations(revisionId)`、`whereUsedTasks(revisionId)`、
  `whereUsedProfiles(revisionId)`，均 `api.get(...)` 返回数组。

- [ ] **Step 1: 加方法**

`partsApi` 对象内追加：
```ts
  whereUsedConfigurations: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}/where-used/configurations`).then(r => r.data),
  whereUsedTasks: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}/where-used/tasks`).then(r => r.data),
  whereUsedProfiles: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}/where-used/profiles`).then(r => r.data),
```
> 注：与 `partsApi` 内既有方法的返回风格保持一致（若既有方法直接返回 `api.get(...)` 不 `.then`，
> 则去掉 `.then`，在调用处取 `.data`）。实现时对照本文件既有写法统一。

- [ ] **Step 2: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(parts): 前端反查 API（构型项/任务/配置）"
```

---

### Task 5: 前端 — 抽取 `BomWhereUsedTree` 并重构 `BOMTracePanel`

**Files:**
- Create: `frontend/src/pages/BOM/BomWhereUsedTree.tsx`
- Modify: `frontend/src/pages/BOM/BOMTracePanel.tsx`（改用共享组件）

**Interfaces:**
- Produces: `BomWhereUsedTree` 组件，props
  `{ revisionId: string; root: { masterId: string; revisionId: string; code: string; name: string; version?: string } | null; onViewEntity: (masterId: string, revisionId?: string) => void }`。
  内部 `bomApi.trace('component', revisionId)` + `buildTraceTree/flattenTraceTree`（自
  `./helpers` 导入）渲染结果树。

- [ ] **Step 1: 新建 `BomWhereUsedTree.tsx`**

把 `BOMTracePanel.tsx` 中「反查结果树形表格」渲染逻辑（约 215-316 行的 `<table>` 及
`buildTraceTree/flattenTraceTree/toggleTraceAll/toggleTraceNode` 相关状态）迁入本组件；
组件在 `revisionId` 变化时调用 `bomApi.trace('component', revisionId)` 拉取并渲染：
```tsx
import { useState, useEffect } from 'react';
import { bomApi } from '../../services/api';
import type { BOMTraceItem } from '../../types';
import { buildTraceTree, flattenTraceTree, getStatusLabel } from './helpers';
import type { TraceTreeNode } from './types';

interface Props {
  revisionId: string;
  root: { masterId: string; revisionId: string; code: string; name: string; version?: string } | null;
  onViewEntity: (masterId: string, revisionId?: string) => void;
}

export default function BomWhereUsedTree({ revisionId, root, onViewEntity }: Props) {
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!revisionId) return;
    let cancelled = false;
    setLoading(true); setError(''); setSearched(false);
    bomApi.trace('component', revisionId)
      .then(res => { if (!cancelled) { setTraceResult(res.data || []); setSearched(true); } })
      .catch(() => { if (!cancelled) setError('反查失败，请稍后重试'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revisionId]);

  useEffect(() => { setTraceTree(buildTraceTree(traceResult)); }, [traceResult]);

  // …此处粘贴原 BOMTracePanel 的 toggleTraceAll / toggleTraceNode 及
  //   「反查结果树形表格」<table> JSX（根节点用 root，展开逻辑与状态原样迁移）…
  // 空态：loading→加载中；searched && 空→暂无引用；error→错误提示。
}
```
> 迁移时保留原表格列（层级/类型/件号/名称/规格/版本/状态/用量）与点击 `onViewEntity` 行为。

- [ ] **Step 2: `BOMTracePanel` 改用共享组件**

`BOMTracePanel.tsx` 删除已迁出的树渲染与相关状态，保留「搜索框 + 选中态」，选中后渲染：
```tsx
{selected && (
  <BomWhereUsedTree
    revisionId={selected.revisionId}
    root={{ masterId: selected.masterId, revisionId: selected.revisionId,
            code: selected.code, name: selected.name, version: selected.version }}
    onViewEntity={onViewEntity}
  />
)}
```

- [ ] **Step 3: 构建校验 + 功能回归**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。
Docker 手测：BOM 页反查功能与改造前一致（搜索→反查树→点击跳转）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/BOM/BomWhereUsedTree.tsx frontend/src/pages/BOM/BOMTracePanel.tsx
git commit -m "refactor(bom): 抽取 BomWhereUsedTree 共享组件"
```

---

### Task 6: 前端 — `PartWhereUsedTab` 四段堆叠 + 懒加载

**Files:**
- Create: `frontend/src/components/PartDetailModal/PartWhereUsedTab.tsx`

**Interfaces:**
- Consumes: `partsApi.whereUsedConfigurations/whereUsedTasks/whereUsedProfiles`（Task 4）；
  `BomWhereUsedTree`（Task 5）。
- Produces: `PartWhereUsedTab`，props
  `{ revisionId: string; masterId: string; code: string; name: string; version?: string;
     onOpenPart: (masterId: string, revisionId?: string) => void;
     onOpenConfig: (configItemRevisionId: string) => void;
     onOpenTask: (projectId: string, task: any) => void;
     onOpenProfile: (profileId: string) => void }`。

- [ ] **Step 1: 实现四段组件**

```tsx
import { useEffect, useState } from 'react';
import { partsApi } from '../../services/api';
import BomWhereUsedTree from '../../pages/BOM/BomWhereUsedTree';

interface Props {
  revisionId: string; masterId: string; code: string; name: string; version?: string;
  onOpenPart: (masterId: string, revisionId?: string) => void;
  onOpenConfig: (configItemRevisionId: string) => void;
  onOpenTask: (projectId: string, task: any) => void;
  onOpenProfile: (profileId: string) => void;
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

export default function PartWhereUsedTab(props: Props) {
  const { revisionId, masterId, code, name, version } = props;
  const cfg = useLazy(() => partsApi.whereUsedConfigurations(revisionId), revisionId);
  const tsk = useLazy(() => partsApi.whereUsedTasks(revisionId), revisionId);
  const prof = useLazy(() => partsApi.whereUsedProfiles(revisionId), revisionId);

  return (
    <div className="space-y-2">
      {/* 1) 父项零部件 */}
      <Section title="父项零部件" count={''}>
        <BomWhereUsedTree
          revisionId={revisionId}
          root={{ masterId, revisionId, code, name, version }}
          onViewEntity={props.onOpenPart}
        />
      </Section>

      {/* 2) 被构型项引用 */}
      <Section title="被构型项引用" count={cfg.loading ? '…' : cfg.data.length}>
        {cfg.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : cfg.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : cfg.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">构型项件号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">必需</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {cfg.data.map((r: any) => (
                <tr key={r.config_item_revision_id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenConfig(r.config_item_revision_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.version || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.status || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.is_required ? '是' : '否'}</td>
                  <td className="px-3 py-2">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 3) 被项目任务引用 */}
      <Section title="被项目任务引用" count={tsk.loading ? '…' : tsk.data.length}>
        {tsk.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : tsk.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : tsk.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">项目</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">任务</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {tsk.data.map((r: any) => (
                <tr key={r.task.id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenTask(r.project_id, r.task)}>
                  <td className="px-3 py-2">{r.project_name}</td>
                  <td className="px-3 py-2 font-medium">{r.task.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 4) 被构型配置引用 */}
      <Section title="被构型配置引用" count={prof.loading ? '…' : prof.data.length}>
        {prof.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : prof.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : prof.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">配置编号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">必需</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {prof.data.map((r: any) => (
                <tr key={r.profile_id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenProfile(r.profile_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.status || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.is_required ? '是' : '否'}</td>
                  <td className="px-3 py-2">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
git add frontend/src/components/PartDetailModal/PartWhereUsedTab.tsx
git commit -m "feat(parts): 反查 Tab 四段堆叠组件 PartWhereUsedTab"
```

---

### Task 7: 前端 — 接入 `PartDetailModal`（Tab + 四个弹窗）

**Files:**
- Modify: `frontend/src/components/PartDetailModal.tsx`

**Interfaces:**
- Consumes: `PartWhereUsedTab`（Task 6）；现有 `ConfigItemDetailModal` / `TaskEditModal` /
  `ProfileEditModal`（各自 props 见 spec §5.4）。

- [ ] **Step 1: Tab 注册**

`activeTab` 联合类型加 `'whereused'`；`tabs` useMemo 数组在 `bom` 之后插入：
```ts
{ key: 'whereused' as const, label: '反查', show: true },
```

- [ ] **Step 2: 引入组件与弹窗 state**

顶部 import：
```tsx
import PartWhereUsedTab from './PartDetailModal/PartWhereUsedTab';
import ConfigItemDetailModal from './Configuration/ConfigItemDetailModal';
import TaskEditModal from '../pages/Project/TaskEditModal';
import ProfileEditModal from './Configuration/ProfileEditModal';
```
组件内 state：
```tsx
const [wuConfigRevId, setWuConfigRevId] = useState<string | null>(null);
const [wuTask, setWuTask] = useState<{ projectId: string; task: any } | null>(null);
const [wuProfileId, setWuProfileId] = useState<string | null>(null);
```
> 父项下钻复用现有 `setNestedMasterId/setNestedRevisionId`。

- [ ] **Step 3: 渲染 Tab 内容**

在 tab 内容区（与 `activeTab === 'bom'` 等并列）加：
```tsx
{activeTab === 'whereused' && revisionId && (
  <PartWhereUsedTab
    revisionId={revisionId}
    masterId={masterId}
    code={master?.code || ''}
    name={master?.name || ''}
    version={revision?.version}
    onOpenPart={(mid, rid) => { setNestedMasterId(mid); setNestedRevisionId(rid || null); }}
    onOpenConfig={(cirId) => setWuConfigRevId(cirId)}
    onOpenTask={(projectId, task) => setWuTask({ projectId, task })}
    onOpenProfile={(pid) => setWuProfileId(pid)}
  />
)}
```

- [ ] **Step 4: 渲染四个弹窗（就地）**

在组件底部（与现有 `nestedMasterId` 弹窗并列）加：
```tsx
{wuConfigRevId && (
  <ConfigItemDetailModal open={!!wuConfigRevId} revisionId={wuConfigRevId}
    onClose={() => setWuConfigRevId(null)} />
)}
{wuTask && (
  <TaskEditModal open={!!wuTask} projectId={wuTask.projectId} task={wuTask.task}
    onClose={() => setWuTask(null)} onSaved={() => {}} onRefresh={() => {}} />
)}
{wuProfileId && (
  <ProfileEditModal open={!!wuProfileId} profileId={wuProfileId}
    onClose={() => setWuProfileId(null)} />
)}
```
> 核对三个弹窗的必填 props：`ConfigItemDetailModal`{open,revisionId,onClose}；
> `TaskEditModal`{open,projectId,task,onClose,onSaved?,onRefresh?}（如 `onSaved/onRefresh` 为必填则传空函数）；
> `ProfileEditModal`{open,profileId,onClose}。实现时对照各组件 Props 定义补齐/删减可选项。

- [ ] **Step 5: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/PartDetailModal.tsx
git commit -m "feat(parts): 零部件详情接入反查 Tab 与四类详情弹窗"
```

---

### Task 8: 集成验证（Docker 手测）

**Files:** 无（验证）

- [ ] **Step 1: 全量后端测试**

```bash
docker cp backend/tests bom_backend:/app/tests && docker exec bom_backend sh -c "cd /app && python -m pytest tests/test_where_used.py -v" ; docker exec bom_backend rm -rf /app/tests
```
Expected: `test_where_used.py` 全绿。

- [ ] **Step 2: 重建并启动**

```bash
cd frontend && npm run build
docker compose up -d --build
```

- [ ] **Step 3: 功能手测（https://localhost:8080，Ctrl+F5）**

造数：某零件版本 X 同时被 (a) 某上级装配 BOM 引用、(b) 某构型项绑定 X、(c) 某项目任务关联 X、
(d) 某正式构型配置含 X。打开该零件详情 → 「反查」Tab：
- 四段分别显示对应引用；空的段显示「暂无引用」。
- 点父项行 → 嵌套打开上级装配详情；点构型项行 → `ConfigItemDetailModal`；
  点任务行 → `TaskEditModal`（项目/任务正确）；点配置行 → `ProfileEditModal`。
- 切到该零件**另一版本 Y**（版本历史 Tab）→ 四段刷新为 Y 的引用（构型/配置绑定 X 的不再出现）。

- [ ] **Step 4: 接口抽查（可选）**

```bash
# 取一个 revision_id 后：
docker exec bom_postgres psql -U bomadmin -d bom_system -c "SELECT revision_id FROM configuration_item_parts WHERE revision_id IS NOT NULL LIMIT 1;"
```
用该 revision_id 在浏览器登录态下访问三个端点，确认返回非空数组。

---

## Self-Review

- **Spec 覆盖**：§4.2 构型项→Task1；§4.3 任务→Task2；§4.4 配置→Task3；§4.1 端点齐；
  §5.3 抽取 BomWhereUsedTree/重构 BOMTracePanel→Task5；§5.2 四段→Task6；§5.1/§5.4 接入+四弹窗→Task7；
  §8 测试→各任务 Step1 + Task8。
- **占位符**：后端 crud/端点/测试均为可运行代码；前端 Task5（树渲染迁移）与 Task7（弹窗 props 核对）
  含"对照既有代码"说明——因属既有 JSX 迁移/既有组件 props 适配，非新增逻辑，执行时按现有源码落实。
- **类型一致**：端点路径 `GET /parts/revisions/{revision_id}/where-used/{configurations|tasks|profiles}`
  贯穿 spec/后端/前端 api；返回字段 `config_item_revision_id`/`{project_id,task}`/`profile_id` 与
  前端 `onOpenConfig`/`onOpenTask`/`onOpenProfile` 入参一致；`_task_dict` 输出即 `ProjectTask` 结构，
  直接喂 `TaskEditModal.task`。
