# 构型项零部件版本级绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让构型项关联的零部件从 master 级绑定改造为绑定到具体版本(revision)，锁定配置基线。

**Architecture:** `configuration_item_parts` 增加 `revision_id` 列并回填最新版；添加/改版本时持久化选中的 revision；构型项详情按绑定版本解析显示；前端去重口径由 master 改为 revision（允许同零件多版本）。BOM/项目任务模块已是 revision 级，不动。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL（生产）/ SQLite（测试，pytest）；React + TS + Vite（前端）。

## Global Constraints

- 绑定语义：**固定版本**——零件升版后构型不自动跟新。
- 迁移必须**幂等**（`ADD COLUMN IF NOT EXISTS` / `UPDATE ... WHERE revision_id IS NULL` / `CREATE INDEX IF NOT EXISTS`）。
- 存量行回填 `revision_id` = 该 master **最新未软删 revision**（`created_at` 最新）。
- 同一构型项内**允许**同一零件多个不同版本；去重口径按 `revision_id`。
- 保留 `part_id`(master) 列，兼容既有读取 master 主数据(code/name)的代码。
- 后端测试：pytest，`db` fixture（SQLite 内存库），直接调 `crud_configuration`。
  运行：`cd backend && python -m pytest tests/<file> -v`（host 无依赖时用
  `docker exec bom_backend python -m pytest ...`，需确保 tests 目录在容器内可见）。
- 前端无单测框架，验证用 `cd frontend && npm run build`（含 `tsc`）+ Docker 手测。

## 延后项（本计划不做，交接时确认是否单开）

配置清单下游（`configuration_working_items` / `configuration_profile_items`）当前仅存
`item_id`(master)+code/name，无零部件版本列。让清单按绑定版本"钉版"需给这两张表加
`part_revision_id` 列 + 迁移 + 改生成/消费逻辑，明显超出核心绑定，**本计划延后**。
核心绑定完成后，配置清单仍按 master 解析 code/name（版本无关），不回归。

---

### Task 1: 后端 — `revision_id` 列 + 幂等迁移 + 启动挂载

**Files:**
- Modify: `backend/app/models_configuration.py`（`ConfigurationItemPart` 加列，约 59-70 行）
- Create: `backend/app/migrations_configuration.py`
- Modify: `backend/app/main.py`（启动迁移块，约 477 行后）
- Test: `backend/tests/test_configuration_part_version.py`

**Interfaces:**
- Produces: `ConfigurationItemPart.revision_id`（`Column(UUID, ForeignKey("part_revisions.id"), nullable=True)`）；
  `migrate_config_part_revision(db, engine) -> None`。

- [ ] **Step 1: 写失败测试（列可持久化）**

`backend/tests/test_configuration_part_version.py`：
```python
"""构型项零部件版本级绑定：列/写入/更新/详情解析。"""
import uuid
from app import models_parts
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision,
    ConfigurationItemIteration, ConfigurationItemPart,
)


def _part(db, code="P1", ptype="part", versions=("A",)):
    """建一个零件 master + 若干 revision（按传入顺序创建，最后一个为最新）。返回 (master, [rev...])。"""
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type=ptype)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                      status="released", latest_iteration=1)
        db.add(r); db.flush()
        revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1"):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version="A")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(id=uuid.uuid4(), revision_id=cr.id, iteration=1)
    db.add(ci); db.commit()
    return cm, cr, ci


def test_part_link_persists_revision_id(db):
    m, revs = _part(db, versions=("A",))
    _, _, ci = _config_iter(db)
    link = ConfigurationItemPart(
        id=uuid.uuid4(), iteration_id=ci.id, part_type="part",
        part_id=m.id, revision_id=revs[0].id, quantity=1,
    )
    db.add(link); db.commit(); db.refresh(link)
    assert link.revision_id == revs[0].id
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_part_link_persists_revision_id -v`
Expected: FAIL（`ConfigurationItemPart` 无 `revision_id` 属性 / 建表无该列）

- [ ] **Step 3: 模型加列**

`models_configuration.py` `ConfigurationItemPart` 内，`part_id` 行之后加：
```python
    revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id"), nullable=True)
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_part_link_persists_revision_id -v`
Expected: PASS

- [ ] **Step 5: 写迁移文件**

`backend/app/migrations_configuration.py`：
```python
"""构型项零部件版本级绑定迁移：加 revision_id 列并回填最新版。幂等，PostgreSQL。"""
from sqlalchemy import text


def migrate_config_part_revision(db, engine):
    db.execute(text(
        "ALTER TABLE configuration_item_parts ADD COLUMN IF NOT EXISTS revision_id UUID"
    ))
    db.execute(text("""
        UPDATE configuration_item_parts cip
        SET revision_id = (
            SELECT pr.id FROM part_revisions pr
            WHERE pr.master_id = cip.part_id AND pr.deleted_at IS NULL
            ORDER BY pr.created_at DESC
            LIMIT 1
        )
        WHERE cip.revision_id IS NULL
    """))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_cip_revision_id "
        "ON configuration_item_parts(revision_id)"
    ))
    db.commit()
```

- [ ] **Step 6: 挂载到 main.py 启动迁移**

`main.py` 中现有 `migrate_task_dates_to_date` 调用块之后，追加同样的 try 包裹：
```python
            try:
                from app.migrations_configuration import migrate_config_part_revision
                migrate_config_part_revision(db, engine)
            except Exception as _ce:
                db.rollback()
                print(f"⚠ Config part revision migration skipped: {_ce}")
```

- [ ] **Step 7: 提交**

```bash
git add backend/app/models_configuration.py backend/app/migrations_configuration.py backend/app/main.py backend/tests/test_configuration_part_version.py
git commit -m "feat(config): 构型零部件关联加 revision_id 列与幂等迁移"
```

---

### Task 2: 后端 — Schema 与写入侧存储 `revision_id`

**Files:**
- Modify: `backend/app/schemas_configuration.py`（`ConfigPartCreate`/`ConfigPartUpdate`/`ConfigPartResponse`，约 51-76 行）
- Modify: `backend/app/crud_configuration.py`（`add_part_to_iteration` 约 694 行、`add_config_parts` 约 748 行）
- Test: `backend/tests/test_configuration_part_version.py`

**Interfaces:**
- Consumes: `ConfigurationItemPart.revision_id`（Task 1）。
- Produces: `add_part_to_iteration(db, iteration_id, part_type, part_id, revision_id=None, is_required=True, quantity=1, sort_order=0)`；
  `ConfigPartCreate.revision_id: uuid.UUID`；`ConfigPartUpdate.revision_id: Optional[uuid.UUID]`；
  `ConfigPartResponse.revision_id: Optional[uuid.UUID]`。

- [ ] **Step 1: 写失败测试（写入存 revision + 同零件多版本共存）**

追加到 `test_configuration_part_version.py`：
```python
from app import crud_configuration as crud
from app import schemas_configuration as schemas


def test_add_parts_stores_revision_and_allows_multi_version(db):
    m, revs = _part(db, versions=("A", "B"))   # revs[0]=A, revs[1]=B(最新)
    _, _, ci = _config_iter(db)
    crud.add_config_parts(db, str(ci.id), [
        schemas.ConfigPartCreate(part_type="part", part_id=m.id, revision_id=revs[0].id, quantity=1),
        schemas.ConfigPartCreate(part_type="part", part_id=m.id, revision_id=revs[1].id, quantity=1),
    ])
    parts = crud.get_iteration_parts(db, ci.id)
    bound = sorted(str(p.revision_id) for p in parts)
    assert bound == sorted([str(revs[0].id), str(revs[1].id)])
    assert len(parts) == 2   # 同零件两个版本共存
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_add_parts_stores_revision_and_allows_multi_version -v`
Expected: FAIL（`ConfigPartCreate` 无 `revision_id` 字段 / 未落库）

- [ ] **Step 3: Schema 加字段**

`schemas_configuration.py`：
```python
class ConfigPartCreate(BaseSchema):
    part_type: str
    part_id: uuid.UUID
    revision_id: uuid.UUID
    is_required: bool = True
    quantity: int = 1
    sort_order: int = 0


class ConfigPartUpdate(BaseSchema):
    is_required: Optional[bool] = None
    quantity: Optional[int] = None
    sort_order: Optional[int] = None
    revision_id: Optional[uuid.UUID] = None
```
并在 `ConfigPartResponse` 增加：
```python
    revision_id: Optional[uuid.UUID] = None
```

- [ ] **Step 4: CRUD 写入 revision_id**

`crud_configuration.py` `add_part_to_iteration` 签名加参数并写入模型：
```python
def add_part_to_iteration(
    db: Session, iteration_id: UUID, part_type: str, part_id: UUID,
    revision_id: Optional[UUID] = None,
    is_required: bool = True, quantity: int = 1, sort_order: int = 0,
) -> models.ConfigurationItemPart:
    part = models.ConfigurationItemPart(
        iteration_id=iteration_id,
        part_type=part_type,
        part_id=part_id,
        revision_id=revision_id,
        is_required=is_required,
        quantity=quantity,
        sort_order=sort_order,
    )
    db.add(part)
    db.commit()
    db.refresh(part)
    return part
```
`add_config_parts` 的构造处（约 756 行）加 `revision_id=it.revision_id`：
```python
        part = models.ConfigurationItemPart(
            iteration_id=iteration_id,
            part_type=it.part_type,
            part_id=it.part_id,
            revision_id=it.revision_id,
            is_required=it.is_required,
            quantity=it.quantity,
            sort_order=it.sort_order,
        )
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py -v`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add backend/app/schemas_configuration.py backend/app/crud_configuration.py backend/tests/test_configuration_part_version.py
git commit -m "feat(config): 构型关联零部件写入侧存储 revision_id，支持同零件多版本"
```

---

### Task 3: 后端 — 改版本（更新 revision_id）

**Files:**
- Modify: `backend/app/crud_configuration.py`（`update_config_part` 约 713-729 行，确认 revision_id 可更新）
- Modify: `backend/app/routers/configuration.py`（PUT parts 端点，约 682-690 行，确认 `model_dump` 透传 revision_id）
- Test: `backend/tests/test_configuration_part_version.py`

**Interfaces:**
- Consumes: `update_config_part(db, part_id, data: dict)`（现有，`if v is not None: setattr`）。

- [ ] **Step 1: 写失败测试（改版本生效）**

追加：
```python
def test_update_part_changes_revision(db):
    m, revs = _part(db, versions=("A", "B"))
    _, _, ci = _config_iter(db)
    link = crud.add_part_to_iteration(db, ci.id, "part", m.id, revision_id=revs[0].id)
    updated = crud.update_config_part(db, link.id, {"revision_id": revs[1].id})
    assert updated is not None
    assert updated.revision_id == revs[1].id
```

- [ ] **Step 2: 跑测试**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_update_part_changes_revision -v`
Expected: 现有 `update_config_part` 是通用 `setattr`，应直接 PASS。若 FAIL（如字段被过滤），继续 Step 3；否则跳到 Step 4。

- [ ] **Step 3: （如需）放行 revision_id 更新**

确认 `update_config_part` 循环为通用 `for k, v in data.items(): if v is not None: setattr(part, k, v)`（无字段白名单），无需改动。
确认路由 PUT 端点用 `data.model_dump(exclude_none=True)` 透传（`ConfigPartUpdate.revision_id` 已在 Task 2 加）。若路由对 body 有字段白名单，补上 `revision_id`。

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_update_part_changes_revision -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud_configuration.py backend/app/routers/configuration.py backend/tests/test_configuration_part_version.py
git commit -m "feat(config): 支持更新构型关联零部件的绑定版本"
```

---

### Task 4: 后端 — 构型项详情按绑定版本解析（固定不跟新）

**Files:**
- Modify: `backend/app/routers/configuration.py`（`part_detail` 组装，约 178-216 行）
- Test: `backend/tests/test_configuration_part_version.py`

**Interfaces:**
- Consumes: `ConfigurationItemPart.revision_id`。part_detail 用 `PartRevision.id == cip.revision_id` 取绑定版本，
  `revision_id` 为空（脏数据）时回退最新版。

- [ ] **Step 1: 写失败测试（升版后仍显示绑定版本）**

追加（直接测提取逻辑：绑定 A 版后再建更新的 B 版，取绑定版本仍为 A）：
```python
from app.models_parts import PartRevision


def _resolve_bound_revision(db, cip):
    """镜像 router 中 part_detail 的版本解析：优先绑定版本，空则回退最新。"""
    rev = None
    if cip.revision_id:
        rev = db.query(PartRevision).filter(PartRevision.id == cip.revision_id).first()
    if rev is None:
        rev = (db.query(PartRevision)
               .filter(PartRevision.master_id == cip.part_id, PartRevision.deleted_at.is_(None))
               .order_by(PartRevision.created_at.desc()).first())
    return rev


def test_detail_shows_bound_version_not_latest(db):
    m, revs = _part(db, versions=("A",))
    _, _, ci = _config_iter(db)
    link = crud.add_part_to_iteration(db, ci.id, "part", m.id, revision_id=revs[0].id)
    # 之后该零件升版到 B（更晚创建）
    import time; time.sleep(0.01)
    rb = PartRevision(id=uuid.uuid4(), master_id=m.id, version="B", status="released", latest_iteration=1)
    db.add(rb); db.commit()
    db.refresh(link)
    bound = _resolve_bound_revision(db, link)
    assert bound.version == "A"   # 固定绑定，不跟新到 B
```

- [ ] **Step 2: 跑测试**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py::test_detail_shows_bound_version_not_latest -v`
Expected: PASS（测试用的是镜像解析函数，验证语义）；若 FAIL 说明 `_resolve_bound_revision` 逻辑写错，修正。

- [ ] **Step 3: 路由改用绑定版本解析**

`routers/configuration.py` `part_detail` 组装处（约 182 行），把"取最新 revision"改为优先绑定版本：
```python
            entity = db.query(PartMaster).filter(PartMaster.id == p.part_id).first()
            if entity:
                rev = None
                if p.revision_id:
                    rev = db.query(PartRevision).filter(PartRevision.id == p.revision_id).first()
                if rev is None:
                    rev = db.query(PartRevision).filter(
                        PartRevision.master_id == entity.id,
                        PartRevision.deleted_at.is_(None)
                    ).order_by(PartRevision.created_at.desc()).first()
```
并在 `part_detail` dict 中补 `"revision_id": str(rev.id) if rev else ""`（若原本已有则保留，确保取自 `rev`）。

- [ ] **Step 4: 跑全部后端相关测试**

Run: `cd backend && python -m pytest tests/test_configuration_part_version.py tests/test_configuration_approval.py -v`
Expected: 全部 PASS（未回归构型审批流）

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/configuration.py backend/tests/test_configuration_part_version.py
git commit -m "feat(config): 构型项详情按绑定版本解析零部件，固定不跟新"
```

---

### Task 5: 前端 — API 签名带 `revision_id`

**Files:**
- Modify: `frontend/src/services/api.ts`（`configurationApi.addParts` 约 726 行、`updatePart` 约 728 行）

**Interfaces:**
- Produces: `addParts(id, items: { part_type; part_id; revision_id; is_required; quantity? }[])`；
  `updatePart(id, partId, data: { is_required?; quantity?; revision_id? })`。

- [ ] **Step 1: 改签名**

```ts
  addParts: (id: string, items: { part_type: string; part_id: string; revision_id: string; is_required: boolean; quantity?: number }[]) =>
    api.post(`/configurations/items/${id}/parts`, { items }),
  updatePart: (id: string, partId: string, data: { is_required?: boolean; quantity?: number; revision_id?: string }) =>
    api.put(`/configurations/items/${id}/parts/${partId}`, data),
```

- [ ] **Step 2: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 无类型错误（此步会因下游调用点未更新而报错——继续 Task 6/7 修复；若想本步独立通过，可先允许调用点暂传 revision_id，见下任务）。
> 说明：本任务与 Task 6、7 类型上耦合，建议连续实施后统一 `npm run build`。

- [ ] **Step 3: 提交（与 Task 6 合并提交亦可）**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(config): configurationApi 支持零部件绑定版本 revision_id"
```

---

### Task 6: 前端 — `ConfigItemDetailModal` 添加/改版本存 revision + 去重按 revision

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigItemDetailModal.tsx`（添加流约 451-484 行、`VersionSelectModal onSelect` 约 494-510 行）

**Interfaces:**
- Consumes: `configurationApi.addParts`/`updatePart`（Task 5）；picker `it.child_id` = revision_id。

- [ ] **Step 1: 添加流存 revision + 去重按 revision**

`AssemblyPartPicker` 的 `onConfirm`（约 453-483 行）改为直接以 `it.child_id`(revision) 绑定，
去重按已绑定的 revision：
```tsx
      <AssemblyPartPicker open={partPickerOpen} onClose={() => setPartPickerOpen(false)}
        existingChildIds={new Set(parts.map(p => p.part_detail?.revision_id).filter(Boolean) as string[])}
        onConfirm={async (items) => {
          const existingRevs = new Set(parts.map(p => p.part_detail?.revision_id).filter(Boolean));
          const toAdd: { part_type: string; part_id: string; revision_id: string; is_required: boolean; quantity: number }[] = [];
          for (const it of items) {
            if (existingRevs.has(it.child_id)) continue;   // 同版本已存在则跳过
            let masterId = ''; let pType = 'part';
            try {
              const rev = await partsApi.getRevision(it.child_id);
              masterId = rev.master_id;
              if (!masterId) continue;
              const master = await partsApi.get(masterId);
              pType = master.type || 'part';
            } catch { continue; }
            toAdd.push({ part_type: pType, part_id: masterId, revision_id: it.child_id, is_required: true, quantity: it.quantity ?? 1 });
          }
          if (toAdd.length === 0) { setPartPickerOpen(false); return; }
          try {
            await configurationApi.addParts(internalRevId, toAdd);
            toast.success(`已关联 ${toAdd.length} 个零部件版本`);
            setPartPickerOpen(false);
            loadDetail();
          } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const msg = Array.isArray(detail) ? detail.map((d: any) => d.msg).join('; ') : (typeof detail === 'string' ? detail : '操作失败');
            toast.error(msg);
          }
        }}
```

- [ ] **Step 2: `VersionSelectModal onSelect` 持久化**

`onSelect`（约 494-510 行）改为调接口持久化再刷新：
```tsx
          onSelect={async (versionId: string) => {
            const target = parts[versionSelectIdx];
            setVersionSelectIdx(null);
            try {
              await configurationApi.updatePart(internalRevId, target.id, { revision_id: versionId });
              toast.success('已更新绑定版本');
              loadDetail();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || '更新版本失败');
            }
          }}
```
> 注：`target.id` 为 `ConfigurationItemPart.id`（关联行 id），非 part master。确认 `parts[i].id` 即该行 id。

- [ ] **Step 3: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过（配合 Task 5、7）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/Configuration/ConfigItemDetailModal.tsx
git commit -m "feat(config): 构型项详情添加/改版本持久化零部件绑定版本，去重按版本"
```

---

### Task 7: 前端 — `ConfigurationCreateModal` 添加存 revision + 去重按 revision

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationCreateModal.tsx`（添加去重约 749 行、提交约 165-170 行）

**Interfaces:**
- Consumes: `configurationApi.addParts`（Task 5）；本地 `parts[i]` 已带 `revision_id`（见 751 行 `revision_id: it.child_id`）。

- [ ] **Step 1: 去重键含 revision + 提交带 revision_id**

添加去重（约 749 行）改为按 `part_type + revision_id`：
```tsx
            const exists = parts.some(p => `${p.part_type}_${p.revision_id}` === key);
```
其中构造 `key` 处一并改为 `${type}_${it.child_id}`（与新增行的 `revision_id: it.child_id` 对齐）。
最终提交 `configurationApi.addParts`（约 165-170 行）时补 `revision_id`：
```tsx
            part_type: p.part_type, part_id: p.part_id, revision_id: p.revision_id, is_required: p.is_required, quantity: p.quantity ?? 1,
```

- [ ] **Step 2: 构建校验**

Run: `cd frontend && npm run build`
Expected: `tsc` 通过，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Configuration/ConfigurationCreateModal.tsx
git commit -m "feat(config): 新建构型配置按版本绑定零部件并按版本去重"
```

---

### Task 8: 集成验证（Docker 手测）

**Files:** 无（验证）

- [ ] **Step 1: 重建并启动**

```bash
cd frontend && npm run build
docker compose up -d --build
```

- [ ] **Step 2: 验证迁移与回填**

```bash
docker exec bom_postgres psql -U bomadmin -d bom_system -c "\d configuration_item_parts"
docker exec bom_postgres psql -U bomadmin -d bom_system -c "SELECT count(*) total, count(revision_id) filled FROM configuration_item_parts;"
```
Expected: 存在 `revision_id` 列与 `ix_cip_revision_id` 索引；`filled` 接近 `total`（仅无任何 revision 的脏 master 为空）。

- [ ] **Step 3: 功能手测（浏览器 https://localhost:8080，Ctrl+F5）**

- 打开一个构型项详情 → 关联零部件的版本显示为绑定版本。
- 「添加子项」选中某零件的具体版本 → 列表新增该版本行。
- 对同一零件再选**另一个版本** → 新增第二行（多版本共存）。
- 用版本选择器改某行版本 → 刷新后显示新版本（已持久化，DB 可复核）。
- 把该零件**升版**后重开构型项 → 绑定版本**不变**（固定，不跟新）。
- 历史构型项（改造前创建）→ 版本显示与改造前一致（回填最新版）。

- [ ] **Step 4: DB 复核绑定持久化**

```bash
docker exec bom_postgres psql -U bomadmin -d bom_system -c "SELECT part_id, revision_id, quantity FROM configuration_item_parts ORDER BY created_at DESC LIMIT 5;"
```
Expected: 新增/改版行的 `revision_id` 为选定版本。

---

## Self-Review

- **Spec 覆盖**：§4 列+迁移→Task1；§5.1 schema→Task2；§5.2 写入/改版本→Task2/3；
  详情按绑定版本→Task4；前端添加/去重/改版本→Task5/6/7；迁移回填/兼容→Task1/8。
  §5.2 下游配置清单版本化 → 见「延后项」明确标注（需交接确认）。
- **占位符**：无 TODO/TBD；测试与实现均含真实代码。
- **类型一致**：`revision_id`(UUID/string) 贯穿 model/schema/crud/api；`add_part_to_iteration`
  新增 `revision_id` 参数与 Task2/3 调用一致；前端 `addParts` 项含 `revision_id` 与 Task6/7 传参一致；
  `VersionSelectModal.onSelect` 用 `ConfigurationItemPart.id`(行 id) 调 `updatePart`。
