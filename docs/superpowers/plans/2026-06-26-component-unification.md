# 零部件统一化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `parts` 和 `assemblies` 两张结构完全相同的表合并为 `components` 表，对外统称"零部件"，消除重复代码和分支逻辑。

**Architecture:** 分三个阶段：阶段一在数据库创建 `components` 表并迁移数据，同时上线 `/components` 新路由，旧路由 `/parts`/`/assemblies` 代理到新表；阶段二前端切换到新路由；阶段三清理旧代码和旧表。

**Tech Stack:** Python/FastAPI, SQLAlchemy, PostgreSQL, React/TypeScript

---

## 文件变更总览

**新建：**
- `backend/app/migrations_components.py` — 数据库迁移脚本
- `backend/app/routers/components.py` — `/components` 路由
- `frontend/src/pages/ComponentsPage.tsx` — 零部件管理页面

**修改（阶段一）：**
- `backend/app/models.py` — 新增 `Component` 类
- `backend/app/schemas.py` — 新增 `ComponentBase/Create/Update/Response`
- `backend/app/crud.py` — 新增 Component CRUD 函数，更新 `assert_entity_editable`
- `backend/app/routers/__init__.py` — 注册 `components_router`
- `backend/app/main.py` — include `components_router`，调用迁移
- `permissions/permissions.json` — 新增 `components.*` 权限
- `backend/app/permissions/_generated.py` — 重新生成
- `frontend/src/constants/permissions.generated.ts` — 重新生成
- `backend/app/routers/parts.py` — 代理到 Component
- `backend/app/routers/assemblies.py` — 代理到 Component
- `backend/app/routers/bom.py` — 统一 entity_type 为 `"component"`
- `backend/app/crud_eco.py` — Part/Assembly → Component
- `backend/app/crud_ecr.py` — Part/Assembly → Component
- `backend/app/crud_inventory.py` — Part/Assembly → Component
- `backend/tests/test_parts_perms.py` → 更新为 Component

**修改（阶段二）：**
- `frontend/src/pages/Components.tsx` — 切换 API 到 `/components`（后阶段三删除）
- `frontend/src/App.tsx` 或路由文件 — 更新路由
- `frontend/src/components/AssemblyPartPicker.tsx` — 统一为 component
- `frontend/src/components/BOMTraceModal.tsx` — 统一 entity_type
- `frontend/src/pages/BOM/BOMTreePanel.tsx` — 统一 entity_type
- `frontend/src/pages/BOM/BOMTracePanel.tsx` — 统一 entity_type
- `frontend/src/pages/BOM/BOMComparePanel.tsx` — 统一 entity_type
- `frontend/src/components/ECR/ECRAffectedItemPicker.tsx` — 统一为 component
- `frontend/src/components/ECO/ECOEditView.tsx` — 统一为 component

**删除（阶段三）：**
- `backend/app/routers/parts.py`
- `backend/app/routers/assemblies.py`
- `Part`、`Assembly` 类（从 `models.py`）
- `frontend/src/pages/Parts.tsx`
- `frontend/src/pages/Components.tsx`（旧文件）
- DROP TABLE `parts`, `assemblies`

---

## 阶段一：数据库 + 后端

---

### Task 1: 写数据库迁移脚本

**Files:**
- Create: `backend/app/migrations_components.py`

- [ ] **Step 1: 新建迁移脚本**

```python
# backend/app/migrations_components.py
"""零部件统一化迁移：parts + assemblies → components

幂等设计：可重复执行，已迁移的行不会重复插入。
仅在 PostgreSQL 环境执行（测试库 SQLite 跳过）。
"""
from sqlalchemy import text


def migrate_components(db, engine):
    if engine.dialect.name != "postgresql":
        return

    # 1. 创建 components 表（若已存在则跳过）
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS components (
            id UUID PRIMARY KEY,
            code VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            spec VARCHAR(255),
            version VARCHAR(32) DEFAULT 'A',
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            remark TEXT,
            revisions JSONB DEFAULT '[]',
            revision_parent_id UUID,
            creator_id UUID,
            document_links JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            deleted_at TIMESTAMPTZ
        )
    """))

    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uix_component_code_version
        ON components (code, version)
        WHERE deleted_at IS NULL
    """))

    # 2. 迁移 parts（跳过 id 已存在的行）
    db.execute(text("""
        INSERT INTO components
            (id, code, name, spec, version, status, remark,
             revisions, revision_parent_id, creator_id, document_links,
             created_at, updated_at, deleted_at)
        SELECT
            id, code, name, spec, version, status, remark,
            revisions, revision_parent_id, creator_id, document_links,
            created_at, updated_at, deleted_at
        FROM parts
        WHERE id NOT IN (SELECT id FROM components)
    """))

    # 3. 迁移 assemblies（跳过 id 已存在的行）
    db.execute(text("""
        INSERT INTO components
            (id, code, name, spec, version, status, remark,
             revisions, revision_parent_id, creator_id, document_links,
             created_at, updated_at, deleted_at)
        SELECT
            id, code, name, spec, version, status, remark,
            revisions, revision_parent_id, creator_id, document_links,
            created_at, updated_at, deleted_at
        FROM assemblies
        WHERE id NOT IN (SELECT id FROM components)
    """))

    # 4. bom_items: parent_type / child_type → 'component'
    db.execute(text("""
        UPDATE bom_items
        SET parent_type = 'component'
        WHERE parent_type IN ('part', 'assembly')
    """))
    db.execute(text("""
        UPDATE bom_items
        SET child_type = 'component'
        WHERE child_type IN ('part', 'assembly', 'component')
    """))

    # 5. custom_field_values: entity_type → 'component'
    db.execute(text("""
        UPDATE custom_field_values
        SET entity_type = 'component'
        WHERE entity_type IN ('part', 'assembly')
    """))

    # 6. custom_field_definitions: applies_to 数组内替换（JSONB）
    db.execute(text("""
        UPDATE custom_field_definitions
        SET applies_to = (
            SELECT jsonb_agg(
                CASE
                    WHEN elem IN ('"part"'::jsonb, '"assembly"'::jsonb, '"component"'::jsonb)
                    THEN '"component"'::jsonb
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(applies_to) AS elem
        )
        WHERE applies_to ?| array['part', 'assembly', 'component']
    """))

    # 7. dashboard_items: entity_type → 'component'
    db.execute(text("""
        UPDATE dashboard_items
        SET entity_type = 'component'
        WHERE entity_type IN ('part', 'assembly')
    """))

    # 8. inventory_documents: ref_entity_type → 'component'
    db.execute(text("""
        UPDATE inventory_documents
        SET ref_entity_type = 'component'
        WHERE ref_entity_type IN ('part', 'assembly')
    """))

    # 9. project_tasks: entity_type → 'component'
    db.execute(text("""
        UPDATE project_tasks
        SET entity_type = 'component'
        WHERE entity_type IN ('part', 'assembly')
    """))

    # operation_logs 的 target_type 保留历史值，前端展示时做映射

    db.commit()
```

- [ ] **Step 2: 验证脚本语法**

```bash
cd backend
python -c "from app.migrations_components import migrate_components; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/migrations_components.py
git commit -m "feat: 零部件迁移脚本（幂等）"
```

---

### Task 2: 新增 Component 模型和 Schemas

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: 在 models.py 中新增 Component 类**

在 `Assembly` 类定义之后（第 57 行后）插入：

```python
class Component(Base):
    __tablename__ = "components"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    version = Column(String(32), default="A")
    status = Column(String(32), nullable=False, default="draft")
    remark = Column(Text)
    revisions = Column(JSONB, default=[])
    revision_parent_id = Column(UUID(as_uuid=True), nullable=True)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    document_links = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
```

- [ ] **Step 2: 在 schemas.py 中新增 Component schemas**

在 `AssemblyResponse` 类之后（约第 112 行后）插入：

```python
class ComponentBase(BaseSchema):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    spec: Optional[str] = None
    version: str = "A"
    status: str = "draft"
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class ComponentCreate(ComponentBase):
    id: Optional[uuid.UUID] = None

class ComponentUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class ComponentResponse(ComponentBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 3: 验证导入**

```bash
cd backend
python -c "from app.models import Component; from app.schemas import ComponentResponse; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py
git commit -m "feat: Component 模型和 Schema"
```

---

### Task 3: 新增 Component CRUD 函数

**Files:**
- Modify: `backend/app/crud.py`

- [ ] **Step 1: 在 crud.py 中新增 Component 相关函数**

在 `get_assemblies` 函数之后（约第 240 行后）插入以下函数：

```python
# ===== Component CRUD =====

def get_component(db, component_id):
    return db.query(models.Component).filter(models.Component.id == component_id).first()

def get_component_by_code_version(db, code, version):
    return db.query(models.Component).filter(
        models.Component.code == code,
        models.Component.version == version,
        models.Component.deleted_at.is_(None)
    ).first()

def get_components(db, skip=0, limit=100, search=None, include_deleted=False,
                   updated_since=None, top_level=False):
    q = db.query(models.Component)
    if not include_deleted:
        q = q.filter(models.Component.deleted_at.is_(None))
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (models.Component.code.ilike(pattern)) |
            (models.Component.name.ilike(pattern))
        )
    if updated_since:
        from datetime import datetime, timezone
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        q = q.filter(
            (models.Component.updated_at >= since_dt) |
            (models.Component.deleted_at >= since_dt)
        )
    if top_level:
        subq = db.query(models.BOMItem.child_id).filter(
            models.BOMItem.child_type == 'component',
            models.BOMItem.deleted_at.is_(None)
        ).subquery()
        q = q.filter(~models.Component.id.in_(subq))
    return q.offset(skip).limit(limit).all()

def create_component(db, component):
    data = component.model_dump()
    db_comp = models.Component(**data)
    db.add(db_comp)
    db.commit()
    db.refresh(db_comp)
    return db_comp

def update_component(db, component_id, component_update):
    db_comp = get_component(db, component_id)
    if not db_comp:
        return None
    for field, value in component_update.model_dump(exclude_unset=True).items():
        setattr(db_comp, field, value)
    from datetime import datetime
    db_comp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_comp)
    return db_comp

def delete_component(db, component_id):
    db.query(models.BOMItem).filter(
        models.BOMItem.child_type == 'component',
        models.BOMItem.child_id == component_id,
        models.BOMItem.deleted_at.is_(None)
    ).update({"deleted_at": sqlfunc.now()}, synchronize_session=False)
    db.commit()
    db_comp = get_component(db, component_id)
    if db_comp:
        db_comp.deleted_at = sqlfunc.now()
        db.commit()
    return db_comp
```

- [ ] **Step 2: 更新 `assert_entity_editable` 函数**

找到 `assert_entity_editable` 函数（约第 138 行），将整个函数替换为：

```python
def assert_entity_editable(db, entity_type: str, entity_id, user_role: str):
    """审批锁定：处于"冻结/发布"状态的零部件，非管理员不可修改。"""
    if user_role == "admin":
        return
    if entity_type == "component":
        ent = get_component(db, entity_id)
    elif entity_type == "part":
        ent = get_part(db, entity_id)
    elif entity_type in ("assembly",):
        ent = get_assembly(db, entity_id)
    else:
        return
    if ent and ent.status in ("frozen", "released"):
        from fastapi import HTTPException
        label = "已冻结" if ent.status == "frozen" else "已发布"
        raise HTTPException(status_code=403, detail=f"该零部件{label}，审批/发布期间不可修改（仅管理员可修改）")
```

- [ ] **Step 3: 验证**

```bash
cd backend
python -c "from app.crud import get_component, get_components, create_component, update_component, delete_component; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/crud.py
git commit -m "feat: Component CRUD 函数"
```

---

### Task 4: 创建 /components 路由

**Files:**
- Create: `backend/app/routers/components.py`

- [ ] **Step 1: 新建 components.py 路由文件**

```python
# backend/app/routers/components.py
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
import uuid

from ..database import get_db
from ..models import User, Document, DocumentGroupLink, UserGroup, Component
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/components", tags=["零部件管理"])


def _creator_name(db, creator_id):
    if not creator_id:
        return ""
    u = db.query(User).filter(User.id == creator_id).first()
    return u.real_name if u else ""


def _comp_brief(comp, creator_name_map=None):
    d = {
        "id": str(comp.id),
        "code": comp.code,
        "name": comp.name,
        "spec": comp.spec,
        "version": comp.version,
        "status": comp.status,
        "remark": comp.remark,
        "creator_id": str(comp.creator_id) if comp.creator_id else None,
        "created_at": comp.created_at.isoformat() if comp.created_at else None,
        "updated_at": comp.updated_at.isoformat() if comp.updated_at else None,
        "deleted_at": comp.deleted_at.isoformat() if comp.deleted_at else None,
    }
    if creator_name_map is not None and comp.creator_id:
        d["creator_name"] = creator_name_map.get(comp.creator_id, "")
    return d


def _comp_response(comp, creator_name_map=None):
    d = {
        "id": comp.id,
        "code": comp.code,
        "name": comp.name,
        "spec": comp.spec,
        "version": comp.version,
        "status": comp.status,
        "remark": comp.remark,
        "revisions": comp.revisions or [],
        "creator_id": comp.creator_id,
        "created_at": comp.created_at,
        "updated_at": comp.updated_at,
        "deleted_at": comp.deleted_at,
    }
    if creator_name_map is not None and comp.creator_id:
        d["creator_name"] = creator_name_map.get(comp.creator_id, "")
    return d


@router.get("/")
async def list_components(
    skip: int = 0, limit: int = 100, search: str = None,
    updated_since: float = None, brief: bool = False, top_level: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    include_deleted = bool(updated_since)
    comps = crud.get_components(db, skip=skip, limit=limit, search=search,
                                updated_since=updated_since,
                                include_deleted=include_deleted, top_level=top_level)
    creator_ids = {c.creator_id for c in comps if c.creator_id}
    creator_name_map = {}
    if creator_ids:
        users = db.query(User).filter(User.id.in_(creator_ids)).all()
        creator_name_map = {u.id: u.real_name for u in users}
    if brief:
        return JSONResponse(content=[_comp_brief(c, creator_name_map) for c in comps])
    return [_comp_response(c, creator_name_map) for c in comps]


@router.post("/", response_model=schemas.ComponentResponse)
async def create_component(
    component: schemas.ComponentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:create"))
):
    if crud.get_component_by_code_version(db, component.code, component.version):
        raise HTTPException(status_code=400, detail="零部件编码+版本已存在")
    data = component.model_dump()
    data["creator_id"] = current_user.id
    db_comp = Component(**data)
    db.add(db_comp)
    db.commit()
    db.refresh(db_comp)
    ip = request.client.host if request.client else None
    crud.log_operation(db, current_user.id, current_user.username,
                       "create_component", "component", str(db_comp.id),
                       f"创建零部件 {db_comp.code}", ip)
    return _comp_response(db_comp)


@router.get("/{component_id}")
async def get_component(
    component_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    return _comp_response(comp, {comp.creator_id: _creator_name(db, comp.creator_id)})


@router.put("/{component_id}", response_model=schemas.ComponentResponse)
async def update_component(
    component_id: uuid.UUID, component: schemas.ComponentUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update"))
):
    db_comp = crud.get_component(db, component_id)
    if not db_comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.assert_entity_editable(db, "component", component_id, current_user.role)
    updated = crud.update_component(db, component_id, component)
    ip = request.client.host if request.client else None
    crud.log_operation(db, current_user.id, current_user.username,
                       "update_component", "component", str(component_id),
                       f"修改零部件 {updated.code}", ip)
    return _comp_response(updated)


@router.delete("/{component_id}")
async def delete_component(
    component_id: uuid.UUID, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete"))
):
    db_comp = crud.get_component(db, component_id)
    if not db_comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.delete_component(db, component_id)
    ip = request.client.host if request.client else None
    crud.log_operation(db, current_user.id, current_user.username,
                       "delete_component", "component", str(component_id),
                       f"删除零部件 {db_comp.code}", ip)
    return {"ok": True}


@router.post("/{component_id}/document-links")
async def update_document_links(
    component_id: uuid.UUID, body: dict, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:link"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    comp.document_links = body.get("document_links", [])
    flag_modified(comp, "document_links")
    db.commit()
    ip = request.client.host if request.client else None
    crud.log_operation(db, current_user.id, current_user.username,
                       "update_doc_links", "component", str(component_id),
                       "更新图文档关联", ip)
    return {"ok": True, "document_links": comp.document_links}
```

- [ ] **Step 2: 验证语法**

```bash
cd backend
python -c "from app.routers.components import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/components.py
git commit -m "feat: /components 路由"
```

---

### Task 5: 注册路由 + 调用迁移

**Files:**
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 在 `routers/__init__.py` 中注册 components_router**

在文件末尾的 import 列表中加入：

```python
from .components import router as components_router
```

在 `__all__` 列表中加入 `"components_router"`。

- [ ] **Step 2: 在 `main.py` 中 include 新路由并调用迁移**

在 `from .routers import ...` 行末尾加入 `components_router`：

```python
from .routers import (auth_router, users_router, parts_router, assemblies_router,
                      bom_router, logs_router, custom_fields_router, documents_router,
                      user_groups_router, dashboard_router, ecr_router, eco_router,
                      config_router, inventory_router, components_router)
```

在 `app.include_router(assemblies_router, ...)` 之后加入：

```python
app.include_router(components_router, prefix="/api")
```

在文件末尾添加启动时迁移调用（在现有 `startup` event 或文件末尾添加）：

```python
from .database import engine
from .migrations_components import migrate_components

@app.on_event("startup")
async def run_migrations():
    db = SessionLocal()
    try:
        migrate_components(db, engine)
    finally:
        db.close()
```

> 注意：如果 `main.py` 已有 `@app.on_event("startup")` 块，将 `migrate_components(db, engine)` 调用加入其中而不是新建一个。

- [ ] **Step 3: 验证应用启动无报错**

```bash
cd backend
python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/__init__.py backend/app/main.py
git commit -m "feat: 注册 /components 路由，启动时执行迁移"
```

---

### Task 6: 更新权限配置

**Files:**
- Modify: `permissions/permissions.json`
- Run: `python tools/gen_permissions.py`

- [ ] **Step 1: 在 `permissions/permissions.json` 中新增 components 权限**

找到 `"assemblies:create"` 等权限块，在同级新增：

```json
"components:create": ["admin", "engineer"],
"components:delete": ["admin"],
"components:read": ["admin", "engineer", "production", "guest"],
"components:update": ["admin", "engineer"],
"components.doc:link": ["admin", "engineer"],
"components.doc:read": ["admin", "engineer", "production", "guest"],
"components.doc:unlink": ["admin", "engineer"],
"components.bom:manage": ["admin", "engineer"],
"components.bom:export_single": ["admin", "engineer", "production"],
"components.bom:import_export_all": ["admin"]
```

- [ ] **Step 2: 重新生成权限常量**

```bash
python tools/gen_permissions.py
```

Expected: 无报错，`backend/app/permissions/_generated.py` 和 `frontend/src/constants/permissions.generated.ts` 文件被更新。

- [ ] **Step 3: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat: 新增 components.* 权限"
```

---

### Task 7: 旧路由代理到 components 表

**Files:**
- Modify: `backend/app/routers/parts.py`
- Modify: `backend/app/routers/assemblies.py`

目标：旧路由内部改为查 `Component` 模型，对外 API 行为不变，供前端过渡期使用。

- [ ] **Step 1: 修改 `routers/parts.py` 顶部 import**

将：
```python
from ..models import User, Document, DocumentGroupLink, UserGroup, Part
```
改为：
```python
from ..models import User, Document, DocumentGroupLink, UserGroup, Component
```

- [ ] **Step 2: 全局替换 `parts.py` 中所有 `Part` 模型引用为 `Component`**

在 `parts.py` 中执行以下替换（注意只替换模型引用，不替换字符串 `"part"`）：

- `models.Part` → `models.Component`
- `crud.get_part(` → `crud.get_component(`
- `crud.get_parts(` → `crud.get_components(`
- `crud.get_part_by_code(` → `crud.get_component_by_code_version(`（注意参数签名变化，需补充 `version` 参数）
- `crud.update_part(` → `crud.update_component(`
- `crud.delete_part(` → `crud.delete_component(`
- `Part(` → `Component(`（创建实例时）

- [ ] **Step 3: 对 `routers/assemblies.py` 做同样的替换**

将：
```python
from ..models import User, Document, DocumentGroupLink, UserGroup, Assembly
```
改为：
```python
from ..models import User, Document, DocumentGroupLink, UserGroup, Component
```

同上，将所有 `Assembly`/`crud.get_assembly*`/`crud.get_assemblies`/`crud.update_assembly`/`crud.delete_assembly` 替换为对应的 `Component` 版本。

- [ ] **Step 4: 验证两个旧路由可导入**

```bash
cd backend
python -c "from app.routers.parts import router; from app.routers.assemblies import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/parts.py backend/app/routers/assemblies.py
git commit -m "refactor: 旧路由 /parts /assemblies 代理到 components 表"
```

---

### Task 8: 更新 BOM 路由

**Files:**
- Modify: `backend/app/routers/bom.py`

- [ ] **Step 1: 统一 entity_type 验证**

找到 `if entity_type not in ["part", "assembly"]:` 和 `if entity_type not in ("part", "assembly"):` 的所有位置，改为：

```python
if entity_type not in ("component", "part", "assembly"):
```

> 保留旧值兼容，因为数据库迁移可能有延迟窗口。

- [ ] **Step 2: 统一模型查询**

找到所有形如：
```python
if item.child_type == "part":
    child = db.query(models.Part).filter(...).first()
elif item.child_type == "assembly":
    child = db.query(models.Assembly).filter(...).first()
```

统一改为：
```python
child = db.query(models.Component).filter(models.Component.id == item.child_id).first()
```

- [ ] **Step 3: 移除 component → assembly 兼容转换**

找到：
```python
child_type = row.child_type
if child_type == "component":
    child_type = "assembly"
```

改为直接使用 `"component"`：
```python
child_type = "component"
```

- [ ] **Step 4: 更新 models import**

在 bom.py 顶部 import 行中加入 `Component`：
```python
from ..models import User, Part, Assembly, BOMItem, Document, Component
```

- [ ] **Step 5: 验证**

```bash
cd backend
python -c "from app.routers.bom import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/bom.py
git commit -m "refactor: bom 路由统一使用 Component 模型"
```

---

### Task 9: 更新 ECO / ECR / 库存 CRUD

**Files:**
- Modify: `backend/app/crud_eco.py`
- Modify: `backend/app/crud_ecr.py`
- Modify: `backend/app/crud_inventory.py`

- [ ] **Step 1: 在三个文件顶部 import 中加入 `Component`**

在每个文件找到 `from .models import ...` 行，加入 `Component`：

```python
from .models import ..., Component
```

- [ ] **Step 2: 替换 crud_eco.py 中的 Part/Assembly 分支**

找到所有形如：
```python
model = Part if entity_type == "part" else Assembly
```
改为：
```python
model = Component if entity_type == "component" else (Part if entity_type == "part" else Assembly)
```

找到所有形如：
```python
if entity_type == "part":
    ...
elif entity_type != "part":
    ...
```
加入 `"component"` 分支，指向 `Component` 模型。

关键位置（按行号参考）：
- `crud_eco.py:389` — `model = Part if entity_type == "part" else Assembly`
- `crud_eco.py:691` — `_get_next_version(db, Part if entity_type == "part" else Assembly, ...)`
- `crud_eco.py:790` — `model = Part if entity_type == "part" else Assembly`

统一替换模式：

```python
# 替换前
model = Part if entity_type == "part" else Assembly

# 替换后
if entity_type == "component":
    model = Component
elif entity_type == "part":
    model = Part
else:
    model = Assembly
```

- [ ] **Step 3: 替换 crud_ecr.py 中的 Part/Assembly 分支**

关键位置（按行号参考）：
- `crud_ecr.py:362` — `if data.entity_type == "part": ... elif data.entity_type == "assembly": ...`
- `crud_ecr.py:467` — `if entity_type == "part": ...`

加入 `"component"` 分支：

```python
if entity_type == "component":
    entity = db.query(Component).filter(Component.id == entity_id).first()
elif entity_type == "part":
    entity = db.query(Part).filter(Part.id == entity_id).first()
elif entity_type == "assembly":
    entity = db.query(Assembly).filter(Assembly.id == entity_id).first()
```

- [ ] **Step 4: 替换 crud_inventory.py 中的 Part/Assembly 分支**

找到（约第 100 行）：
```python
model = Part if data.entity_type == "part" else Assembly
```
改为：
```python
if data.entity_type == "component":
    model = Component
elif data.entity_type == "part":
    model = Part
else:
    model = Assembly
```

- [ ] **Step 5: 验证三个文件可导入**

```bash
cd backend
python -c "import app.crud_eco, app.crud_ecr, app.crud_inventory; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: 运行现有测试确认无回归**

```bash
cd backend
python -m pytest tests/ -x -q 2>&1 | tail -20
```

Expected: 所有测试通过（或只有与数据库相关的跳过，无新增失败）

- [ ] **Step 7: Commit**

```bash
git add backend/app/crud_eco.py backend/app/crud_ecr.py backend/app/crud_inventory.py
git commit -m "refactor: ECO/ECR/库存 CRUD 支持 Component 实体类型"
```

---

### Task 10: 更新 test_parts_perms.py

**Files:**
- Modify: `backend/tests/test_parts_perms.py`

- [ ] **Step 1: 在测试文件中加入 Component 测试辅助**

在文件顶部 import 中加入 `Component`：
```python
from app.models import User, Part, Component
```

- [ ] **Step 2: 新增 `_make_component` 辅助函数**

```python
def _make_component(db, code, version="A"):
    comp = Component(id=uuid.uuid4(), code=code, name=f"Test {code}",
                     version=version, status="draft")
    db.add(comp); db.commit(); db.refresh(comp)
    return comp
```

- [ ] **Step 3: 新增针对 /components 的权限测试**

```python
@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 403), ("guest", 403)
])
def test_components_create_role_gate(db, role, expect):
    user = _make_user(db, role)
    c = _make_test_client(db, user)
    r = c.post("/api/components/", json={
        "code": f"COMP_{role}_{uuid.uuid4().hex[:4]}",
        "name": "Test", "version": "A"
    })
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 200), ("guest", 200)
])
def test_components_read_role_gate(db, role, expect):
    user = _make_user(db, role)
    c = _make_test_client(db, user)
    r = c.get("/api/components/")
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 403), ("production", 403), ("guest", 403)
])
def test_components_delete_role_gate(db, role, expect):
    admin = _make_user(db, "admin")
    comp = _make_component(db, f"CDEL_{role}_{uuid.uuid4().hex[:4]}")
    user = _make_user(db, role)
    c = _make_test_client(db, user)
    r = c.delete(f"/api/components/{comp.id}")
    assert r.status_code == expect
```

- [ ] **Step 4: 运行新测试**

```bash
cd backend
python -m pytest tests/test_parts_perms.py -v 2>&1 | tail -30
```

Expected: 所有新增测试通过

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_parts_perms.py
git commit -m "test: 新增 /components 权限测试"
```

---

## 阶段二：前端切换

---

### Task 11: 创建 ComponentsPage.tsx

**Files:**
- Create: `frontend/src/pages/ComponentsPage.tsx`

- [ ] **Step 1: 复制 `Components.tsx` 为 `ComponentsPage.tsx`，修改 API 调用**

将 `frontend/src/pages/Components.tsx` 内容复制到 `ComponentsPage.tsx`，然后做以下修改：

1. 将所有 `/assemblies` API 调用改为 `/components`
2. 将所有 `assembliesApi` 调用改为 `componentsApi`（需在 `services/api.ts` 中新增 `componentsApi`，见 Step 2）
3. 页面标题改为 `"零部件管理"`
4. 将 `entity_type: "assembly"` 改为 `entity_type: "component"`
5. 将组件内部 `Assembly`/`assembly` 的类型名称统一改为 `Component`/`component`

- [ ] **Step 2: 在 `services/api.ts` 中新增 `componentsApi`**

找到 `assembliesApi` 的定义，参照其结构新增：

```typescript
export const componentsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/components/', { params }),
  get: (id: string) =>
    api.get(`/components/${id}`),
  create: (data: Record<string, any>) =>
    api.post('/components/', data),
  update: (id: string, data: Record<string, any>) =>
    api.put(`/components/${id}`, data),
  delete: (id: string) =>
    api.delete(`/components/${id}`),
  updateDocumentLinks: (id: string, documentLinks: any[]) =>
    api.post(`/components/${id}/document-links`, { document_links: documentLinks }),
};
```

- [ ] **Step 3: 在 `frontend/src/types/index.ts`（或 types.ts）中新增 `Component` 类型**

参照现有 `Assembly` 类型定义新增：

```typescript
export interface Component {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version: string;
  status: string;
  remark?: string;
  revisions?: any[];
  creator_id?: string;
  creator_name?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}
```

- [ ] **Step 4: 验证前端编译无报错**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: 编译成功，无 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ComponentsPage.tsx frontend/src/services/api.ts frontend/src/types/index.ts
git commit -m "feat: 零部件管理页面 ComponentsPage"
```

---

### Task 12: 更新路由和侧边栏

**Files:**
- Modify: `frontend/src/App.tsx`（或路由配置文件）
- Modify: 侧边栏组件（如 `Sidebar.tsx` 或 `Layout.tsx`）

- [ ] **Step 1: 找出路由配置文件**

```bash
grep -r "Parts\|Components\|/parts\|/assemblies" frontend/src/App.tsx frontend/src/main.tsx 2>/dev/null | head -20
```

- [ ] **Step 2: 新增 `/components` 路由，指向 `ComponentsPage`**

在路由配置中加入：

```tsx
import ComponentsPage from './pages/ComponentsPage';
// ...
<Route path="/components" element={<ComponentsPage />} />
```

- [ ] **Step 3: 更新侧边栏**

找到侧边栏中"零件"和"部件"两个入口，替换为单个"零部件"入口：

```tsx
{ path: '/components', label: '零部件管理', icon: <CubeIcon /> }
```

删除原来的 `/parts` 和 `/assemblies` 入口。

- [ ] **Step 4: 验证编译**

```bash
cd frontend
npm run build 2>&1 | tail -10
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx  # 或相关路由文件
git commit -m "feat: 侧边栏合并为零部件管理单一入口"
```

---

### Task 13: 更新 BOM 相关组件

**Files:**
- Modify: `frontend/src/pages/BOM/BOMTreePanel.tsx`
- Modify: `frontend/src/pages/BOM/BOMTracePanel.tsx`
- Modify: `frontend/src/pages/BOM/BOMComparePanel.tsx`
- Modify: `frontend/src/components/BOMTraceModal.tsx`

- [ ] **Step 1: 在所有 BOM 组件中统一 entity_type**

对每个文件，找到所有形如：

```typescript
if (type === 'part') { ... }
else if (type === 'assembly') { ... }
```

改为：

```typescript
// 统一处理，'part'/'assembly' 为兼容旧数据的后备
if (type === 'component' || type === 'assembly' || type === 'part') { ... }
```

或者彻底统一节点渲染，不再区分类型：

```typescript
// 节点图标/颜色不再按类型区分
const nodeLabel = node.code + ' - ' + node.name;
```

- [ ] **Step 2: 将 BOM API 调用中的 entity_type 改为 "component"**

找到 BOM 组件中发起请求时传递 `entity_type: "part"` 或 `entity_type: "assembly"` 的地方，改为 `entity_type: "component"`。

- [ ] **Step 3: 验证编译**

```bash
cd frontend
npm run build 2>&1 | tail -10
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BOM/ frontend/src/components/BOMTraceModal.tsx
git commit -m "refactor: BOM 组件统一使用 component entity_type"
```

---

### Task 14: 更新选择器和 ECO/ECR 组件

**Files:**
- Modify: `frontend/src/components/AssemblyPartPicker.tsx`
- Modify: `frontend/src/components/ECR/ECRAffectedItemPicker.tsx`
- Modify: `frontend/src/components/ECO/ECOEditView.tsx`

- [ ] **Step 1: 更新 `AssemblyPartPicker.tsx`**

该组件目前分别从 `/parts` 和 `/assemblies` 加载数据，合并为从 `/components` 统一加载：

```typescript
// 删除分别请求 parts 和 assemblies 的逻辑
// 改为
const { data: components } = useQuery(['components'], () => componentsApi.list({ brief: true }));
```

选择项展示去掉"零件/部件"分组标签，统一显示"零部件"。

- [ ] **Step 2: 更新 `ECRAffectedItemPicker.tsx`**

找到 `entity_type: "part"` 和 `entity_type: "assembly"` 的选择项，统一改为 `entity_type: "component"`，并从 `/components` 加载列表。

- [ ] **Step 3: 更新 `ECOEditView.tsx`**

找到 affected items 中对 `entity_type` 的判断和赋值，统一改为 `"component"`。

- [ ] **Step 4: 验证编译**

```bash
cd frontend
npm run build 2>&1 | tail -10
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssemblyPartPicker.tsx \
        frontend/src/components/ECR/ECRAffectedItemPicker.tsx \
        frontend/src/components/ECO/ECOEditView.tsx
git commit -m "refactor: 选择器和 ECO/ECR 组件统一使用 component"
```

---

### Task 15: 更新自定义字段配置

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`（或自定义字段配置组件）

- [ ] **Step 1: 找到 applies_to 选项配置**

```bash
grep -r "applies_to\|零件\|部件" frontend/src/pages/Settings.tsx frontend/src/components/ 2>/dev/null | head -20
```

- [ ] **Step 2: 将"零件"和"部件"合并为"零部件"**

找到 `applies_to` 的选项列表，替换为：

```typescript
const APPLIES_TO_OPTIONS = [
  { value: 'component', label: '零部件' },
  { value: 'document', label: '图文档' },
  // ... 其他选项
];
```

删除原来分列的 `{ value: 'part', label: '零件' }` 和 `{ value: 'assembly', label: '部件' }`（或 `{ value: 'component', label: '部件' }`）。

- [ ] **Step 3: 验证编译**

```bash
cd frontend
npm run build 2>&1 | tail -10
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.tsx  # 或相关文件
git commit -m "feat: 自定义字段 applies_to 合并为零部件"
```

---

## 阶段三：清理

> **前提：** 阶段二已上线并稳定运行至少一个迭代周期，确认前端无 `/parts`/`/assemblies` 调用残留。

---

### Task 16: 删除旧路由

**Files:**
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py`
- Delete: `backend/app/routers/parts.py`
- Delete: `backend/app/routers/assemblies.py`

- [ ] **Step 1: 从 `__init__.py` 删除旧路由导入**

删除：
```python
from .parts import router as parts_router
from .assemblies import router as assemblies_router
```

从 `__all__` 中删除 `"parts_router"` 和 `"assemblies_router"`。

- [ ] **Step 2: 从 `main.py` 删除旧路由注册**

删除：
```python
app.include_router(parts_router, prefix="/api")
app.include_router(assemblies_router, prefix="/api")
```

从 import 行中删除 `parts_router`、`assemblies_router`。

- [ ] **Step 3: 删除文件**

```bash
git rm backend/app/routers/parts.py backend/app/routers/assemblies.py
```

- [ ] **Step 4: 验证应用启动**

```bash
cd backend
python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/__init__.py backend/app/main.py
git commit -m "chore: 删除旧路由 /parts /assemblies"
```

---

### Task 17: 删除旧模型和旧 CRUD 函数

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/crud.py`
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: 从 `models.py` 删除 `Part` 和 `Assembly` 类**

删除 `Part`（约第 21-38 行）和 `Assembly`（约第 40-57 行）整个类定义。

- [ ] **Step 2: 从 `schemas.py` 删除旧 Schema 类**

删除 `PartBase`、`PartCreate`、`PartUpdate`、`PartResponse`、`AssemblyBase`、`AssemblyCreate`、`AssemblyUpdate`、`AssemblyResponse`。

- [ ] **Step 3: 从 `crud.py` 删除旧 CRUD 函数**

删除：`get_part`、`get_part_by_code`、`get_parts`、`create_part`、`update_part`、`delete_part`、`get_assembly`、`get_assembly_by_code`、`get_assembly_by_code_version`、`get_assemblies`、`_part_brief`、`_assembly_brief`。

简化 `assert_entity_editable` 为仅处理 `"component"`：

```python
def assert_entity_editable(db, entity_type: str, entity_id, user_role: str):
    if user_role == "admin":
        return
    if entity_type != "component":
        return
    ent = get_component(db, entity_id)
    if ent and ent.status in ("frozen", "released"):
        from fastapi import HTTPException
        label = "已冻结" if ent.status == "frozen" else "已发布"
        raise HTTPException(status_code=403, detail=f"该零部件{label}，审批/发布期间不可修改（仅管理员可修改）")
```

- [ ] **Step 4: 运行全量测试**

```bash
cd backend
python -m pytest tests/ -x -q 2>&1 | tail -20
```

Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/schemas.py
git commit -m "chore: 删除旧 Part/Assembly 模型和 CRUD"
```

---

### Task 18: 删除旧数据库表

**Files:**
- 在生产数据库执行 SQL（不是迁移脚本，手动执行一次）

- [ ] **Step 1: 确认 components 表数据完整**

```sql
SELECT COUNT(*) FROM components;
-- 应等于旧 parts + assemblies 数量之和

SELECT COUNT(*) FROM parts;
SELECT COUNT(*) FROM assemblies;
```

- [ ] **Step 2: 确认无 bom_items 仍引用旧类型**

```sql
SELECT COUNT(*) FROM bom_items WHERE parent_type IN ('part', 'assembly') AND deleted_at IS NULL;
SELECT COUNT(*) FROM bom_items WHERE child_type IN ('part', 'assembly') AND deleted_at IS NULL;
-- 两个查询均应返回 0
```

- [ ] **Step 3: DROP 旧表**

```sql
DROP TABLE IF EXISTS parts;
DROP TABLE IF EXISTS assemblies;
```

- [ ] **Step 4: 验证应用正常运行**

访问 `/api/components/` 返回正确数据。

---

### Task 19: 删除旧前端文件

**Files:**
- Delete: `frontend/src/pages/Parts.tsx`
- Delete: `frontend/src/pages/Components.tsx`

- [ ] **Step 1: 确认无引用残留**

```bash
grep -r "Parts\|from.*pages/Components" frontend/src/ --include="*.tsx" --include="*.ts" | grep -v ComponentsPage | grep -v node_modules
```

Expected: 无输出（无残留引用）

- [ ] **Step 2: 删除文件**

```bash
git rm frontend/src/pages/Parts.tsx frontend/src/pages/Components.tsx
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend
npm run build 2>&1 | tail -10
```

Expected: 编译成功

- [ ] **Step 4: 运行前端测试**

```bash
cd frontend
npm test 2>&1 | tail -20
```

Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 清理旧前端页面 Parts.tsx Components.tsx"
```

---

## 验收清单

**阶段一：**
- [ ] `GET /api/components/` 返回迁移后的全量数据
- [ ] `GET /api/parts/` 和 `GET /api/assemblies/` 仍可访问，返回相同数据
- [ ] `bom_items` 表中所有 `parent_type`/`child_type` 均为 `"component"`
- [ ] ECO/ECR 创建修改流程正常

**阶段二：**
- [ ] 侧边栏只有"零部件管理"一个入口
- [ ] BOM 树可正确展示零部件层级
- [ ] ECR/ECO 创建时可正常选择零部件
- [ ] 自定义字段 applies_to 只有"零部件"一个选项

**阶段三：**
- [ ] 数据库只有 `components` 表，无 `parts`/`assemblies`
- [ ] 代码库中无 `Part`/`Assembly` 模型引用
- [ ] 全量测试通过
