# BOM 子项绑定从 revision_id 迁移到 iteration_id - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BOM 子项主绑定从 `parent_revision_id` 改为 `iteration_id`，使同一版本的不同迭代拥有独立的 BOM 快照。

**Architecture:** 复用数据库已有 `bom_items.iteration_id` 列，API 增加可选 `?iteration_id=` 查询参数，不传默认当前迭代；签出时 `_copy_iteration_data` 已实现 BOM 复制。

**Tech Stack:** Python/FastAPI/SQLAlchemy 后端 + React/TypeScript 前端

## Global Constraints

- 后端目录通过 Docker volume 挂载，修改后 `docker restart bom_backend`
- 前端修改后必须 `cd frontend; npm run build` 并 `docker-compose up -d --force-recreate nginx`
- API 兼容：不传 iteration_id 时默认使用当前最新迭代
- Python 变量/函数: snake_case，TypeScript: camelCase
- 代码注释用中文

---

### Task 1: crud_parts.py — 核心 BOM CRUD 增加 iteration_id 参数

**Files:**
- Modify: `backend/app/crud_parts.py`

- [ ] **Step 1: `get_bom_tree` 增加 optional `iteration_id` 参数**

将函数签名改为 `def get_bom_tree(db: Session, revision_id: UUID, iteration_id: Optional[UUID] = None)`.

将第 985-998 行的查询改为：

```python
    if iteration_id:
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.iteration_id == iteration_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
    else:
        revision = get_part_revision(db, revision_id)
        if not revision:
            return []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.iteration_id == (
                    db.query(models_parts.PartIteration.id)
                    .filter(
                        models_parts.PartIteration.revision_id == revision_id,
                        models_parts.PartIteration.iteration == revision.latest_iteration,
                    )
                    .scalar_subquery()
                ),
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
```

将第 1020-1034 行的 `has_children` / `child_type` 检查从 `parent_revision_id` 改为 `iteration_id`:

```python
                    "child_type": "assembly" if (
                        db.query(models.BOMItem)
                        .filter(
                            models.BOMItem.iteration_id == (
                                db.query(models_parts.PartIteration.id)
                                .filter(
                                    models_parts.PartIteration.revision_id == child_rev.id,
                                    models_parts.PartIteration.iteration == child_rev.latest_iteration,
                                )
                                .scalar_subquery()
                            ),
                            models.BOMItem.deleted_at.is_(None),
                        )
                        .count() > 0
                    ) else "part",
                    "has_children": (
                        db.query(models.BOMItem)
                        .filter(
                            models.BOMItem.iteration_id == (
                                db.query(models_parts.PartIteration.id)
                                .filter(
                                    models_parts.PartIteration.revision_id == child_rev.id,
                                    models_parts.PartIteration.iteration == child_rev.latest_iteration,
                                )
                                .scalar_subquery()
                            ),
                            models.BOMItem.deleted_at.is_(None),
                        )
                        .count() > 0
                    ),
```

- [ ] **Step 2: `add_bom_item` 增加 optional `iteration_id` 参数**

将函数签名改为 `def add_bom_item(db: Session, revision_id: UUID, data: dict, iteration_id: Optional[UUID] = None)`.

将第 1046-1059 行改为：如果传了 `iteration_id` 直接用，否则取最新 iteration：

```python
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"

    if iteration_id:
        iteration = (
            db.query(models_parts.PartIteration)
            .filter(models_parts.PartIteration.id == iteration_id)
            .first()
        )
    else:
        iteration = (
            db.query(models_parts.PartIteration)
            .filter(
                models_parts.PartIteration.revision_id == revision_id,
                models_parts.PartIteration.iteration == revision.latest_iteration,
            )
            .first()
        )
    if not iteration:
        return None, "当前迭代不存在"
```

- [ ] **Step 3: `get_bom_descendants` 增加 optional `iteration_id` 参数**

将函数签名改为 `def get_bom_descendants(db: Session, revision_id: UUID, iteration_id: Optional[UUID] = None)`.

将第 879-886 行查询改为按 `iteration_id` 过滤（通过 `_current_iteration` 取每个 rid 的当前迭代）：

```python
        it = _current_iteration(db, rid)
        if it:
            bom_items = (
                db.query(models.BOMItem)
                .filter(
                    models.BOMItem.iteration_id == it.id,
                    models.BOMItem.deleted_at.is_(None),
                )
                .all()
            )
        else:
            bom_items = []
```

- [ ] **Step 4: 级联签出/检入 BOM 遍历改为 `iteration_id`**

`cascade_checkin` (第 702 行) — 将 `_collect_checked_out_children` 函数内的 BOM 查询改为：

```python
        it = _current_iteration(db, rev_id)
        if it:
            bom_items = (
                db.query(models.BOMItem)
                .filter(
                    models.BOMItem.iteration_id == it.id,
                    models.BOMItem.deleted_at.is_(None),
                )
                .all()
            )
        else:
            bom_items = []
```

同样修改 `cascade_undocheckout` 中类似 BOM 遍历。

- [ ] **Step 5: `_build_master_response` 中 child_count 改为 iteration_id**

`routers/parts.py` 第 580-586 行的 `child_count` 查询从 `parent_revision_id` 改为通过 `latest_iteration` 的 `iteration_id` 查询：

```python
    if latest_revision:
        latest_iter = db.query(crud_parts.models_parts.PartIteration).filter(
            crud_parts.models_parts.PartIteration.revision_id == latest_revision.id,
            crud_parts.models_parts.PartIteration.iteration == latest_revision.latest_iteration,
        ).first()
        if latest_iter:
            child_count = db.query(crud_parts.models.BOMItem).filter(
                crud_parts.models.BOMItem.iteration_id == latest_iter.id,
                crud_parts.models.BOMItem.deleted_at.is_(None),
            ).count()
```

- [ ] **Step 6: 验证后端重启**

```powershell
docker restart bom_backend
```

---

### Task 2: routers/parts.py — BOM 路由增加 iteration_id 查询参数

**Files:**
- Modify: `backend/app/routers/parts.py`

- [ ] **Step 1: GET /revisions/{revision_id}/bom 增加 iteration_id 参数**

```python
@router.get("/revisions/{revision_id}/bom")
def get_bom(
    revision_id: UUID,
    iteration_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:tree")),
):
    return crud_parts.get_bom_tree(db, revision_id, iteration_id)
```

- [ ] **Step 2: POST /revisions/{revision_id}/bom/items 增加 iteration_id 参数**

```python
@router.post("/revisions/{revision_id}/bom/items")
def add_bom_item(
    revision_id: UUID,
    data: schemas_parts.BOMItemCreate,
    iteration_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:create_relation")),
):
    item, err = crud_parts.add_bom_item(db, revision_id, data.model_dump(), iteration_id)
    if err:
        raise HTTPException(400, err)
    return {"id": str(item.id), "detail": "已添加"}
```

- [ ] **Step 3: 删除修订检查也用 iteration_id**

`check_before_delete` 附近（第 124-129 行）的 `child_revision_id` 引用检查保持不变（这是检查是否被引用为子项，不限于特定迭代）。

- [ ] **Step 4: 重启后端验证**

```powershell
docker restart bom_backend
```

---

### Task 3: 后端其他文件 — BOM 查询适配 iteration_id

**Files:**
- Modify: `backend/app/routers/bom.py`
- Modify: `backend/app/bom/compare.py`
- Modify: `backend/app/crud_eco.py`
- Modify: `backend/app/crud_ecr.py`
- Modify: `backend/app/assistant/tools.py`
- Modify: `backend/app/routers/ecos.py`

- [ ] **Step 1: `routers/bom.py` — `/bom/tree` 支持 iteration_id**

```python
@router.get("/tree/{item_type}/{item_id}")
def get_bom_tree(item_type: str, item_id: str,
                 iteration_id: Optional[UUID] = Query(None),
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_permission("bom:tree"))):
    ...
```

内部调用 `crud_parts.get_bom_tree(db, UUID(item_id), iteration_id)`.

- [ ] **Step 2: `bom/compare.py` — `get_bom_tree_recursive` 透传 iteration_id**

函数签名增加 `iteration_id: Optional[uuid.UUID] = None`，传给 `crud_parts.get_bom_tree(db, rev_id, iteration_id)`.

路由 `bom.py` 的 `/compare` 和 `/compare/component` 端点也增加 `iteration_id` 参数并透传。

- [ ] **Step 3: `crud_eco.py` — BOM 遍历改为 iteration_id**

所有使用 `BOMItem.parent_revision_id` 的地方改为通过 `_current_iteration` 取 `iteration_id` 查询：
- `collect_release_tree_entities` (第 399-402 行)
- `_clone_entity` (第 728-741 行)
- `_execute_create` (第 774-781 行)
- `_execute_upgrade` (第 798-801 行)
- `_execute_qty_change` (第 833-857 行)
- `_execute_delete` (第 890-905 行)

模式统一为：

```python
from ..crud_parts import _current_iteration
it = _current_iteration(db, parent_rev_id)
if it:
    bom_items = db.query(BOMItem).filter(
        BOMItem.iteration_id == it.id,
        BOMItem.deleted_at.is_(None),
    ).all()
else:
    bom_items = []
```

- [ ] **Step 4: `crud_ecr.py` — ECR 影响分析适配**

第 454-462 行，BOM 查询改为通过 `_current_iteration` 取 `iteration_id`。

- [ ] **Step 5: `assistant/tools.py` — AI 工具 BOM 查询适配**

第 178-180 行，改为通过 `_current_iteration` 取 `iteration_id`，或直接使用 `child_revision_id` 反转查（反查不限于迭代）。

- [ ] **Step 6: `routers/ecos.py` — 撤销升版 BOM 检查适配**

第 551-561 行，适配 iteration_id。

- [ ] **Step 7: 重启后端验证**

```powershell
docker restart bom_backend
```

---

### Task 4: 前端 api.ts — BOM API 增加 iterationId 参数

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: `getBOM` 增加 iterationId 参数**

```typescript
  getBOM: (revisionId: string, iterationId?: string) =>
    api.get(`/parts/revisions/${revisionId}/bom`, { params: iterationId ? { iteration_id: iterationId } : {} }).then((r) => r.data),
```

- [ ] **Step 2: `addBOMItem` 增加 iterationId 参数**

```typescript
  addBOMItem: (revisionId: string, data: { child_revision_id: string; quantity?: number; sort_order?: number }, iterationId?: string) =>
    api.post(`/parts/revisions/${revisionId}/bom/items`, data, { params: iterationId ? { iteration_id: iterationId } : {} }).then((r) => r.data),
```

- [ ] **Step 3: 构建验证**

```powershell
cd frontend; npm run build
```

---

### Task 5: PartDetailModal.tsx — BOM 加载和迭代切换联动

**Files:**
- Modify: `frontend/src/components/PartDetailModal.tsx`

- [ ] **Step 1: `loadDetail` 和 `loadTabs` 中 BOM 调用传入 iteration_id**

在 `loadDetail` (第 167 行) 和 `loadTabs` (第 186 行) 中：

```typescript
// loadDetail 中
const iterId = viewingIterationId || iteration?.id;
const bomData = await partsApi.getBOM(revId, iterId);

// loadTabs 中
const iterId = viewingIterationId || iteration?.id;
const bomData = await partsApi.getBOM(revisionId, iterId);
```

- [ ] **Step 2: BOM 编辑操作传入 iteration_id**

BOM 添加/更新/删除操作（第 393、430、980、1017 等行）传入当前 `iteration?.id`:

```typescript
// addBOMItem
await partsApi.addBOMItem(revisionId, { child_revision_id: childRevId, quantity: 1 }, iteration?.id);

// deleteBOMItem (不变)
await partsApi.deleteBOMItem(revisionId, item.id);
```

- [ ] **Step 3: BOM 展开子项（toggleBomExpand）传入子项的当前 iteration_id**

`toggleBomExpand` (第 323 行) 中：展开子项时获取子 revision 的 `getBOM` 传当前迭代 ID。由于子项的迭代 ID 不在当前上下文中，不传参数（后端默认取最新迭代）即可。

```typescript
// 子项取最新迭代的 BOM，不传 iteration_id
const children = await partsApi.getBOM(revId);
```

- [ ] **Step 4: 级联操作后 BOM 刷新（第 487 行）**

保持不变，刷新时传入当前 iteration_id。

- [ ] **Step 5: 构建验证**

```powershell
cd frontend; npm run build
```

---

### Task 6: EntityEditModal.tsx 和其他组件适配

**Files:**
- Modify: `frontend/src/components/EntityEditModal.tsx`
- Modify: `frontend/src/components/BOMTreeTable.tsx`
- Modify: `frontend/src/pages/BOM/BOMTreePanel.tsx`
- Modify: `frontend/src/components/ECO/ECOCreateModal.tsx`
- Modify: `frontend/src/components/ECO/ECODetailModal.tsx`
- Modify: `frontend/src/components/Configuration/ConfigurationDetailModal.tsx`
- Modify: `frontend/src/services/importExport.ts`

- [ ] **Step 1: EntityEditModal.tsx**

BOM 加载/添加/删除均传入 `revision.current_iteration.id`（如有）。查看 `EntityEditModal` 中 `loadEditParts` 调用的 `partsApi.getBOM(revisionId)` — 增加 `iterationId` 参数，从 revision 数据中获取。

```typescript
// loadEditParts 中
const iterId = rev?.current_iteration?.id;
const rows = await partsApi.getBOM(revisionId, iterId);
```

BOM 操作中添加/更新/删除时同样传入当前 iteration_id。

- [ ] **Step 2: BOMTreeTable.tsx 和 BOMTreePanel.tsx**

这些组件通过 `getBOM(revId)` 加载数据。不传 `iteration_id` 参数（后端默认取最新迭代）即可，无需改动。

- [ ] **Step 3: EC 组件**

`ECOCreateModal.tsx` 中第 843 行的 `getBOM` 调用：不传参数，默认取最新迭代 — 无需改动。

`ECODetailModal.tsx` 中同理 — 无需改动。

- [ ] **Step 4: ConfigurationDetailModal.tsx**

第 79 行调用 `partsApi.getBOM` — 不传参数，默认取最新迭代 — 无需改动。

- [ ] **Step 5: importExport.ts**

BOM 导入（第 1494-1502 行）创建 BOM 项时传入 `iteration_id`。需要先获取目标 revision 的当前 iteration:

```typescript
// 在创建 BOM 项前获取当前 iteration
const rev = await partsApi.getRevision(parentRevisionId);
const iterId = rev?.current_iteration?.id;
if (iterId) {
  await partsApi.addBOMItem(parentRevisionId, { child_revision_id: childRevisionId, quantity: 1, sort_order: 0 }, iterId);
}
```

- [ ] **Step 6: 构建验证**

```powershell
cd frontend; npm run build
```

---

### Task 7: 全链路验证

- [ ] **Step 1: 重启后端和前端**

```powershell
docker restart bom_backend
cd frontend; npm run build
docker-compose up -d --force-recreate nginx
```

- [ ] **Step 2: 功能验证清单**

1. 打开零部件 "A" 详情 → BOM 结构页签 → 应显示当前迭代的子项
2. 签出 → 添加/删除子项 → 签入 → BOM 应反映新迭代
3. 迭代历史 → 点击 "查看数据" → 切换到 "BOM结构" → 应显示该历史迭代的子项
4. 点击 "返回当前迭代" → BOM 应恢复当前迭代数据
5. BOM 对比功能正常运行
6. CAD 导入 BOM 同步正常运行
7. ECO 执行中 BOM 操作正常运行

- [ ] **Step 3: 提交代码**

```bash
git add -A
git commit -m "feat: BOM子项绑定从revision_id迁移到iteration_id，支持迭代级BOM快照"
```
