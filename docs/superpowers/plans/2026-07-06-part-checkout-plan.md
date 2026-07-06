# 零部件检入检出 PDM 系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 myPDM 零部件管理从单表 `components` 重构为 PartMaster/PartRevision/PartIteration 三层模型，并实现签出/签入/级联操作/迭代历史等完整 PDM 功能。

**Architecture:** 后端采用新文件 `models_parts.py` / `schemas_parts.py` / `crud_parts.py` / `routers/parts.py` 独立实现，旧 `components` 路由保留兼容过渡（后期逐步淘汰）。前端新建 `PartsPage.tsx` + `PartDetailPanel.tsx`，旧 `ComponentsPage.tsx` 保留并行运行。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2.x + React 18 + TypeScript + Zustand + Tailwind CSS

**参考设计文档:** `docs/superpowers/specs/2026-07-06-part-checkout-design.md`

---

## Phase 1: 后端数据模型

### Task 1: 创建 `models_parts.py` — PartMaster/PartRevision/PartIteration/PartAttachment

**Files:**
- Create: `D:\OpenCode\myPDM\backend\app\models_parts.py`

- [ ] **Step 1: 创建模型文件**

```python
"""
零部件签入检出模型（三层：PartMaster → PartRevision → PartIteration）
参考 DocDoku PLM 数据结构
"""
import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class PartMaster(Base):
    __tablename__ = "part_masters"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    type = Column(String(16), nullable=False, default="part")  # 'part' / 'assembly'
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

    revisions = relationship("PartRevision", back_populates="master", lazy="dynamic")


class PartRevision(Base):
    __tablename__ = "part_revisions"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), ForeignKey("part_masters.id", ondelete="CASCADE"), nullable=False)
    version = Column(String(32), nullable=False, default="A")
    status = Column(String(32), nullable=False, default="draft")  # draft/frozen/released/obsolete
    revision_note = Column(Text)
    check_out_user_id = Column(UUID(as_uuid=True), nullable=True)
    check_out_date = Column(DateTime(timezone=True), nullable=True)
    latest_iteration = Column(Integer, nullable=False, default=0)
    revision_parent_id = Column(UUID(as_uuid=True), nullable=True)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

    master = relationship("PartMaster", back_populates="revisions")
    iterations = relationship("PartIteration", back_populates="revision", lazy="dynamic",
                              order_by="PartIteration.iteration")


class PartIteration(Base):
    __tablename__ = "part_iterations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    iteration = Column(Integer, nullable=False, default=1)
    check_in_date = Column(DateTime(timezone=True), nullable=True)
    check_in_note = Column(Text)
    custom_fields = Column(JSONB, default={})
    document_links = Column(JSONB, default=[])
    remark = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    revision = relationship("PartRevision", back_populates="iterations")
    attachments = relationship("PartAttachment", back_populates="iteration", lazy="dynamic")


class PartAttachment(Base):
    __tablename__ = "part_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("part_iterations.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(32), nullable=False)  # 'cad' / 'production'
    file_name = Column(String(255))
    file_size = Column(Integer)
    file_path = Column(String(512))
    file_hash = Column(String(64))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    iteration = relationship("PartIteration", back_populates="attachments")
```

- [ ] **Step 2: 验证 Python 语法**

```powershell
python -c "import sys; sys.path.insert(0, 'D:\\OpenCode\\myPDM\\backend'); from app import models_parts; print('OK')"
```

Note: 此命令在 Docker 外可能因缺少依赖而失败，改为直接在容器内测试。

- [ ] **Step 3: 重启后端容器验证**

```powershell
docker restart bom_backend
docker logs bom_backend --tail 20
```

Expected: 无 import 错误（表还未创建，迁移脚本会在 Phase 1 Task 6 执行）。

---

### Task 2: 修改 `models.py` — BOMItem 更新

**Files:**
- Modify: `D:\OpenCode\myPDM\backend\app\models.py:39-49`

- [ ] **Step 1: 更新 BOMItem 模型**

将 BOMItem 模型（`models.py:39-49`）替换为：

```python
class BOMItem(Base):
    __tablename__ = "bom_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("part_iterations.id", ondelete="CASCADE"), nullable=False)
    parent_revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    child_revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
```

- [ ] **Step 2: 验证**

```powershell
docker restart bom_backend
docker logs bom_backend --tail 20
```

Expected: 无 import 错误。

---

### Task 3: 迁移脚本 — `008_part_tables.sql`

**Files:**
- Create: `D:\OpenCode\myPDM\initdb\migrations\008_part_tables.sql`

- [ ] **Step 1: 创建 SQL 迁移脚本**

```sql
-- 008: 创建零部件三层模型表 (PartMaster/PartRevision/PartIteration/PartAttachment)
-- 改造 BOMItem 表以适配新模型

-- 1. 创建 part_masters 表
CREATE TABLE IF NOT EXISTS part_masters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    type VARCHAR(16) NOT NULL DEFAULT 'part',
    creator_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_master_code ON part_masters (code) WHERE deleted_at IS NULL;

-- 2. 创建 part_revisions 表
CREATE TABLE IF NOT EXISTS part_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID NOT NULL REFERENCES part_masters(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    revision_note TEXT,
    check_out_user_id UUID REFERENCES users(id),
    check_out_date TIMESTAMPTZ,
    latest_iteration INTEGER NOT NULL DEFAULT 0,
    revision_parent_id UUID,
    creator_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_revision_master_version ON part_revisions (master_id, version) WHERE deleted_at IS NULL;

-- 3. 创建 part_iterations 表
CREATE TABLE IF NOT EXISTS part_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id UUID NOT NULL REFERENCES part_revisions(id) ON DELETE CASCADE,
    iteration INTEGER NOT NULL DEFAULT 1,
    check_in_date TIMESTAMPTZ,
    check_in_note TEXT,
    custom_fields JSONB DEFAULT '{}',
    document_links JSONB DEFAULT '[]',
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_iteration_revision_iter ON part_iterations (revision_id, iteration);

-- 4. 创建 part_attachments 表
CREATE TABLE IF NOT EXISTS part_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iteration_id UUID NOT NULL REFERENCES part_iterations(id) ON DELETE CASCADE,
    category VARCHAR(32) NOT NULL,
    file_name VARCHAR(255),
    file_size INTEGER,
    file_path VARCHAR(512),
    file_hash VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. BOMItem 表改造（仅当旧结构存在且新列不存在时执行）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bom_items' AND column_name='parent_type') THEN
        -- 添加新列
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS iteration_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS parent_revision_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS child_revision_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
    END IF;
END $$;

-- 6. 从现有 components 表迁移数据到新表
INSERT INTO part_masters (id, code, name, spec, type, creator_id, created_at, updated_at, deleted_at)
SELECT
    c.id,
    c.code,
    c.name,
    c.spec,
    CASE WHEN EXISTS (SELECT 1 FROM bom_items b WHERE b.parent_type = 'component' AND b.parent_id = c.id AND b.deleted_at IS NULL)
         THEN 'assembly' ELSE 'part' END,
    c.creator_id,
    c.created_at,
    c.updated_at,
    c.deleted_at
FROM components c
WHERE c.revision_parent_id IS NULL  -- 仅原始版本（非升版产生的重复记录）
ON CONFLICT DO NOTHING;

-- 将每个 component 记录作为 revision + iteration 迁移
INSERT INTO part_revisions (id, master_id, version, status, revision_parent_id, creator_id, created_at, updated_at, deleted_at, latest_iteration)
SELECT
    gen_random_uuid(),
    c.id,
    c.version,
    c.status,
    c.revision_parent_id,
    c.creator_id,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    1
FROM components c
ON CONFLICT DO NOTHING;

INSERT INTO part_iterations (id, revision_id, iteration, custom_fields, document_links, remark, created_at, check_in_date)
SELECT
    gen_random_uuid(),
    pr.id,
    1,
    '{}',
    COALESCE(c.document_links, '[]'),
    c.remark,
    c.created_at,
    c.created_at
FROM components c
JOIN part_revisions pr ON pr.master_id = c.id AND pr.version = c.version
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: 提交迁移**

```powershell
git add initdb/migrations/008_part_tables.sql
git commit -m "feat: add part checkout data model migration (008_part_tables)"
```

---

### Task 4: 自动建表 — 更新 `main.py` 启动逻辑

**Files:**
- Modify: `D:\OpenCode\myPDM\backend\app\main.py`（在 `import models_*` 区域和 startup 函数）

- [ ] **Step 1: 导入新模型和 startup 中建表**

在 `main.py` 顶部导入区域（已有的 `from . import models_eco, models_configuration, models_inventory, models_project` 附近）添加：

```python
from . import models_parts  # 零部件三层模型
```

在 startup 事件的 `_create_tables` 函数调用处，确保 `models_parts` 的表被包含。检查 `main.py` 中 `Base.metadata.create_all` 已覆盖所有模型。

- [ ] **Step 2: 重启验证建表**

```powershell
docker restart bom_backend
docker logs bom_backend --tail 30
```

Expected: 无错误。可进入容器验证表已创建：

```powershell
docker exec bom_postgres psql -U bomadmin -d bom_system -c "\dt part_*"
```

Expected: 列出 `part_masters`, `part_revisions`, `part_iterations`, `part_attachments` 四张表。

---

## Phase 2: 后端 Schema

### Task 5: 创建 `schemas_parts.py`

**Files:**
- Create: `D:\OpenCode\myPDM\backend\app\schemas_parts.py`

- [ ] **Step 1: 创建 Schema 文件**

```python
"""零部件签入检出 Schema"""
from __future__ import annotations
from typing import Optional, List, Any, Dict
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


# ===== PartMaster =====

class PartMasterBase(BaseModel):
    code: str
    name: str
    spec: Optional[str] = None
    type: str = "part"  # 'part' / 'assembly'


class PartMasterCreate(PartMasterBase):
    pass


class PartMasterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None
    type: Optional[str] = None


class PartMasterResponse(PartMasterBase):
    id: UUID
    creator_id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    latest_revision: Optional["PartRevisionBrief"] = None

    class Config:
        from_attributes = True


# ===== PartRevision =====

class PartRevisionBrief(BaseModel):
    id: UUID
    version: str
    status: str
    latest_iteration: int
    check_out_user_id: Optional[UUID] = None
    check_out_user_name: Optional[str] = None
    check_out_date: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PartRevisionResponse(PartRevisionBrief):
    master_id: UUID
    revision_note: Optional[str] = None
    revision_parent_id: Optional[UUID] = None
    creator_id: Optional[UUID] = None
    updated_at: Optional[datetime] = None
    current_iteration: Optional["PartIterationResponse"] = None


# ===== PartIteration =====

class PartIterationResponse(BaseModel):
    id: UUID
    revision_id: UUID
    iteration: int
    check_in_date: Optional[datetime] = None
    check_in_note: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = {}
    document_links: Optional[List[Dict[str, Any]]] = []
    remark: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== Checkout/Checkin =====

class CheckinRequest(BaseModel):
    check_in_note: Optional[str] = None


class CascadeResult(BaseModel):
    succeed_count: int
    failed_count: int
    failed_items: List[Dict[str, Any]] = []


# ===== PartAttachment =====

class PartAttachmentResponse(BaseModel):
    id: UUID
    iteration_id: UUID
    category: str
    file_name: str
    file_size: Optional[int] = None
    file_path: Optional[str] = None
    file_hash: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== BOM Item（新模型） =====

class BOMItemCreate(BaseModel):
    child_revision_id: UUID
    quantity: int = 1
    sort_order: int = 0


class BOMItemUpdate(BaseModel):
    quantity: Optional[int] = None
    sort_order: Optional[int] = None


class BOMItemResponse(BaseModel):
    id: UUID
    iteration_id: UUID
    parent_revision_id: UUID
    child_revision_id: UUID
    quantity: int
    sort_order: int
    child_detail: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== 列表查询 =====

class PartListQuery(BaseModel):
    search: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
    check_out_user_id: Optional[UUID] = None
    show_all_versions: bool = False
    page: int = 1
    page_size: int = 50
```

- [ ] **Step 2: 验证**

```powershell
docker exec bom_backend python -c "from app import schemas_parts; print('OK')"
```

---

## Phase 3: 后端 CRUD

### Task 6: 创建 `crud_parts.py` — 基础 CRUD

**Files:**
- Create: `D:\OpenCode\myPDM\backend\app\crud_parts.py`

- [ ] **Step 1: 创建 CRUD 文件（PartMaster + PartRevision 基础操作）**

```python
"""零部件签入检出 CRUD 操作"""
from __future__ import annotations
from typing import Optional, List, Tuple, Any, Dict
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from fastapi import HTTPException

from . import models, models_parts
from .database import SessionLocal


# ====== 版本号工具 ======

VERSION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def _to_version_string(index: int) -> str:
    """将索引转为版本字符串 A=0, B=1, ...（24进制，不含I/O）"""
    if index < 0:
        index = 0
    result = ""
    num = index
    while True:
        result = VERSION_CHARS[num % 24] + result
        num = num // 24 - 1
        if num < 0:
            break
    return result


def _get_next_version(db: Session, master_id: UUID) -> str:
    """根据同一 master 下已有版本数，生成下一版本号"""
    count = (
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.master_id == master_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .count()
    )
    return _to_version_string(count)


# ====== PartMaster CRUD ======

def create_part_master(db: Session, data: dict, user_id: UUID) -> models_parts.PartMaster:
    """创建零件主数据，同时自动创建 Revision=A、Iteration=1"""
    master = models_parts.PartMaster(
        code=data["code"],
        name=data["name"],
        spec=data.get("spec"),
        type=data.get("type", "part"),
        creator_id=user_id,
    )
    db.add(master)
    db.flush()

    revision = models_parts.PartRevision(
        master_id=master.id,
        version="A",
        status="draft",
        latest_iteration=1,
        creator_id=user_id,
    )
    db.add(revision)
    db.flush()

    iteration = models_parts.PartIteration(
        revision_id=revision.id,
        iteration=1,
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    return master


def get_part_master(db: Session, master_id: UUID) -> Optional[models_parts.PartMaster]:
    return (
        db.query(models_parts.PartMaster)
        .filter(
            models_parts.PartMaster.id == master_id,
            models_parts.PartMaster.deleted_at.is_(None),
        )
        .first()
    )


def list_part_masters(
    db: Session,
    search: Optional[str] = None,
    status: Optional[str] = None,
    type_: Optional[str] = None,
    check_out_user_id: Optional[UUID] = None,
    show_all_versions: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict], int]:
    """查询零件列表（含最新版本摘要），返回 (items, total)"""
    query = (
        db.query(models_parts.PartMaster)
        .filter(models_parts.PartMaster.deleted_at.is_(None))
        .options(joinedload(models_parts.PartMaster.revisions))
    )
    if search:
        query = query.filter(
            models_parts.PartMaster.code.ilike(f"%{search}%")
            | models_parts.PartMaster.name.ilike(f"%{search}%")
        )
    if type_:
        query = query.filter(models_parts.PartMaster.type == type_)

    total = query.count()
    masters = query.offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for master in masters:
        revisions_query = (
            db.query(models_parts.PartRevision)
            .filter(
                models_parts.PartRevision.master_id == master.id,
                models_parts.PartRevision.deleted_at.is_(None),
            )
            .order_by(models_parts.PartRevision.created_at.desc())
        )
        if status:
            revisions_query = revisions_query.filter(models_parts.PartRevision.status == status)
        if check_out_user_id:
            revisions_query = revisions_query.filter(
                models_parts.PartRevision.check_out_user_id == check_out_user_id
            )

        revisions = revisions_query.all()
        for rev in revisions:
            if not show_all_versions and rev != revisions[0]:
                break  # 仅展示最新版本（按创建时间倒序）
            # 获取签出用户名
            checkout_user_name = None
            if rev.check_out_user_id:
                user = db.query(models.User).filter(models.User.id == rev.check_out_user_id).first()
                if user:
                    checkout_user_name = user.real_name
            items.append(
                {
                    "master_id": master.id,
                    "code": master.code,
                    "name": master.name,
                    "spec": master.spec,
                    "type": master.type,
                    "revision_id": rev.id,
                    "version": rev.version,
                    "status": rev.status,
                    "check_out_user_id": rev.check_out_user_id,
                    "check_out_user_name": checkout_user_name,
                    "check_out_date": rev.check_out_date,
                    "latest_iteration": rev.latest_iteration,
                    "created_at": rev.created_at,
                }
            )
    return items, total


def update_part_master(db: Session, master_id: UUID, data: dict) -> Optional[models_parts.PartMaster]:
    master = get_part_master(db, master_id)
    if not master:
        return None
    for field in ("code", "name", "spec", "type"):
        if field in data and data[field] is not None:
            setattr(master, field, data[field])
    db.commit()
    db.refresh(master)
    return master


def delete_part_master(db: Session, master_id: UUID) -> bool:
    """软删除主数据（级联软删除所有版本和迭代）"""
    master = get_part_master(db, master_id)
    if not master:
        return False
    master.deleted_at = datetime.now(timezone.utc)
    # 级联软删除所有版本
    db.query(models_parts.PartRevision).filter(
        models_parts.PartRevision.master_id == master_id
    ).update({"deleted_at": datetime.now(timezone.utc)})
    db.commit()
    return True


# ====== PartRevision CRUD ======

def get_part_revision(db: Session, revision_id: UUID) -> Optional[models_parts.PartRevision]:
    return (
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.id == revision_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .first()
    )


def get_part_revision_with_current_iteration(
    db: Session, revision_id: UUID
) -> Optional[Tuple[models_parts.PartRevision, Optional[models_parts.PartIteration]]]:
    """获取版本 + 当前最新迭代"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None
    iteration = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    return revision, iteration


def list_revisions_by_master(db: Session, master_id: UUID) -> List[models_parts.PartRevision]:
    return (
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.master_id == master_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .order_by(models_parts.PartRevision.created_at)
        .all()
    )


# ====== PartIteration CRUD ======

def get_part_iteration(db: Session, iteration_id: UUID) -> Optional[models_parts.PartIteration]:
    return db.query(models_parts.PartIteration).filter(
        models_parts.PartIteration.id == iteration_id
    ).first()


def list_iterations_by_revision(db: Session, revision_id: UUID) -> List[models_parts.PartIteration]:
    return (
        db.query(models_parts.PartIteration)
        .filter(models_parts.PartIteration.revision_id == revision_id)
        .order_by(models_parts.PartIteration.iteration.desc())
        .all()
    )


# ====== 迭代数据复制工具 ======

def _copy_iteration_data(db: Session, source_iter: models_parts.PartIteration, new_iter: models_parts.PartIteration):
    """复制上一迭代的全部数据到新迭代"""
    new_iter.custom_fields = source_iter.custom_fields or {}
    new_iter.document_links = source_iter.document_links or []
    new_iter.remark = source_iter.remark
    db.flush()

    # 复制附件引用
    for att in source_iter.attachments:
        new_att = models_parts.PartAttachment(
            iteration_id=new_iter.id,
            category=att.category,
            file_name=att.file_name,
            file_size=att.file_size,
            file_path=att.file_path,
            file_hash=att.file_hash,
        )
        db.add(new_att)

    # 复制 BOM 关系（直接查询，避免跨模块 relationship 循环引用）
    bom_rows = (
        db.query(models.BOMItem)
        .filter(
            models.BOMItem.iteration_id == source_iter.id,
            models.BOMItem.deleted_at.is_(None),
        )
        .all()
    )
    for bom in bom_rows:
        new_bom = models.BOMItem(
            iteration_id=new_iter.id,
            parent_revision_id=bom.parent_revision_id,
            child_revision_id=bom.child_revision_id,
            quantity=bom.quantity,
            sort_order=bom.sort_order,
        )
        db.add(new_bom)
```

- [ ] **Step 2: 验证**

```powershell
docker exec bom_backend python -c "from app import crud_parts; print('OK')"
```

---

### Task 7: `crud_parts.py` — 签出/签入/撤销/状态变更

**Files:**
- Modify: `D:\OpenCode\myPDM\backend\app\crud_parts.py`（追加）

- [ ] **Step 1: 追加签出/签入核心逻辑**

在 `crud_parts.py` 文件末尾追加：

```python
# ====== 签出 ======

def checkout_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """签出零件：创建新迭代，加锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft",):
        return None, "仅草稿状态可签出"
    if revision.check_out_user_id is not None:
        return None, "该版本已被他人签出"

    # 获取上一迭代
    prev_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )

    # 创建新迭代
    new_iteration_num = revision.latest_iteration + 1
    new_iter = models_parts.PartIteration(
        revision_id=revision_id,
        iteration=new_iteration_num,
    )
    db.add(new_iter)
    db.flush()

    # 复制上一迭代数据
    if prev_iter:
        _copy_iteration_data(db, prev_iter, new_iter)

    # 加锁
    revision.latest_iteration = new_iteration_num
    revision.check_out_user_id = user_id
    revision.check_out_date = datetime.now(timezone.utc)

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 签入 ======

def checkin_part(db: Session, revision_id: UUID, user_id: UUID, note: Optional[str] = None) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """签入零件：记录签入信息，解锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    # 获取当前迭代
    iteration = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if iteration:
        iteration.check_in_date = datetime.now(timezone.utc)
        iteration.check_in_note = note

    # 解锁
    revision.check_out_user_id = None
    revision.check_out_date = None

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 撤销签出 ======

def undocheckout_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """撤销签出：删除最新迭代，解锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能撤销签出"
    if revision.latest_iteration <= 1:
        return None, "至少需保留一个迭代"

    # 删除最新迭代（级联删除附件和BOM关系）
    latest_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if latest_iter:
        db.delete(latest_iter)

    # 解锁
    revision.latest_iteration -= 1
    revision.check_out_user_id = None
    revision.check_out_date = None

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 强制签入（管理员） ======

def force_checkin_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 状态变更 ======

def release_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """发布版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft", "frozen"):
        return None, "仅草稿或冻结状态可发布"
    if revision.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再发布"
    revision.status = "released"
    db.commit()
    db.refresh(revision)
    return revision, None


def freeze_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """冻结版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "draft":
        return None, "仅草稿状态可冻结"
    revision.status = "frozen"
    db.commit()
    db.refresh(revision)
    return revision, None


def unfreeze_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """解冻版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "frozen":
        return None, "仅冻结状态可解冻"
    revision.status = "draft"
    db.commit()
    db.refresh(revision)
    return revision, None


def obsolete_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """作废版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "released":
        return None, "仅已发布状态可作废"
    revision.status = "obsolete"
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 升版 ======

def upgrade_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """升版：创建新 Revision，自动签出"""
    source_rev = get_part_revision(db, revision_id)
    if not source_rev:
        return None, "源版本不存在"
    if source_rev.status not in ("released", "obsolete"):
        return None, "仅已发布或已作废版本可升版"

    # 获取源迭代数据
    source_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == source_rev.latest_iteration,
        )
        .first()
    )

    # 创建新版本
    new_version = _get_next_version(db, source_rev.master_id)
    new_rev = models_parts.PartRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status="draft",
        latest_iteration=1,
        revision_parent_id=source_rev.id,
        creator_id=user_id,
    )
    db.add(new_rev)
    db.flush()

    # 创建第一个迭代
    new_iter = models_parts.PartIteration(
        revision_id=new_rev.id,
        iteration=1,
    )
    db.add(new_iter)
    db.flush()

    # 复制源迭代数据
    if source_iter:
        _copy_iteration_data(db, source_iter, new_iter)

    # 自动签出
    new_rev.check_out_user_id = user_id
    new_rev.check_out_date = datetime.now(timezone.utc)

    db.commit()
    db.refresh(new_rev)
    return new_rev, None


# ====== 级联操作 ======

def cascade_checkout(db: Session, revision_id: UUID, user_id: UUID) -> CascadeResultFromDict:
    """级联签出：递归签出 BOM 树下所有子孙版本"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_child_revisions(rev_id: UUID, visited: set) -> List[models_parts.PartRevision]:
        """递归收集 BOM 树中所有子孙 revision"""
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if child_rev and child_rev.id not in visited:
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_child_revisions(child_rev.id, visited))
        return children

    # 先签出当前版本
    _, err = checkout_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    # 递归签出所有子版本
    visited = {revision_id}
    child_revisions = _collect_child_revisions(revision_id, visited)
    for child_rev in child_revisions:
        _, err = checkout_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


CascadeResultFromDict = Dict[str, Any]  # 类型别名，实际返回 dict


def cascade_checkin(db: Session, revision_id: UUID, user_id: UUID) -> Dict[str, Any]:
    """级联签入：递归签入 BOM 树下当前用户签出的所有子孙版本"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_checked_out_children(rev_id: UUID, user_uid: UUID, visited: set) -> List[models_parts.PartRevision]:
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if (
                child_rev
                and child_rev.id not in visited
                and child_rev.check_out_user_id is not None
                and str(child_rev.check_out_user_id) == str(user_uid)
            ):
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_checked_out_children(child_rev.id, user_uid, visited))
        return children

    # 先签入当前版本
    _, err = checkin_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    # 递归签入所有子版本
    visited = {revision_id}
    child_revisions = _collect_checked_out_children(revision_id, user_id, visited)
    for child_rev in child_revisions:
        _, err = checkin_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


def cascade_undocheckout(db: Session, revision_id: UUID, user_id: UUID) -> Dict[str, Any]:
    """级联撤销签出"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_checked_out_children(rev_id: UUID, user_uid: UUID, visited: set) -> List[models_parts.PartRevision]:
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if (
                child_rev
                and child_rev.id not in visited
                and child_rev.check_out_user_id is not None
                and str(child_rev.check_out_user_id) == str(user_uid)
            ):
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_checked_out_children(child_rev.id, user_uid, visited))
        return children

    # 先撤销当前版本
    _, err = undocheckout_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    # 递归撤销所有子版本
    visited = {revision_id}
    child_revisions = _collect_checked_out_children(revision_id, user_id, visited)
    for child_rev in child_revisions:
        _, err = undocheckout_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


# ====== BOM 操作 ======

def get_bom_tree(db: Session, revision_id: UUID) -> List[Dict]:
    """获取版本的 BOM 树（当前迭代的 BOM 关系）"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return []

    # 获取当前迭代的 BOM 关系
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

    result = []
    for item in bom_items:
        child_rev = get_part_revision(db, item.child_revision_id)
        if child_rev:
            master = get_part_master(db, child_rev.master_id)
            result.append(
                {
                    "id": str(item.id),
                    "child_revision_id": str(item.child_revision_id),
                    "child_code": master.code if master else "",
                    "child_name": master.name if master else "",
                    "child_version": child_rev.version,
                    "child_status": child_rev.status,
                    "child_type": master.type if master else "part",
                    "quantity": item.quantity,
                    "sort_order": item.sort_order,
                }
            )
    return result


def add_bom_item(db: Session, revision_id: UUID, data: dict) -> Tuple[Optional[models.BOMItem], Optional[str]]:
    """在当前迭代中添加 BOM 子项"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"

    # 获取当前迭代 ID
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

    item = models.BOMItem(
        iteration_id=iteration.id,
        parent_revision_id=revision_id,
        child_revision_id=data["child_revision_id"],
        quantity=data.get("quantity", 1),
        sort_order=data.get("sort_order", 0),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item, None


def update_bom_item(db: Session, item_id: UUID, data: dict) -> Tuple[Optional[models.BOMItem], Optional[str]]:
    """更新 BOM 子项"""
    item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id, models.BOMItem.deleted_at.is_(None)).first()
    if not item:
        return None, "BOM项不存在"
    for field in ("quantity", "sort_order"):
        if field in data and data[field] is not None:
            setattr(item, field, data[field])
    db.commit()
    db.refresh(item)
    return item, None


def delete_bom_item(db: Session, item_id: UUID) -> bool:
    """软删除 BOM 子项"""
    item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id, models.BOMItem.deleted_at.is_(None)).first()
    if not item:
        return False
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return True
```

- [ ] **Step 2: 验证**

```powershell
docker exec bom_backend python -c "from app import crud_parts; print('OK')"
```

---

### Task 8: 更新 `permissions.json` 并重新生成权限代码

**Files:**
- Modify: `D:\OpenCode\myPDM\permissions\permissions.json`
- Auto-generate: `backend/app/permissions/_generated.py`
- Auto-generate: `frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 添加新权限到 permissions.json**

在 `permissions.json` 的 `"permissions"` 对象中，`"components.bom:import_export_all"` 之后添加：

```json
"parts:checkout": ["admin", "engineer"],
"parts:checkin": ["admin", "engineer"],
"parts:undocheckout": ["admin", "engineer"],
"parts:force_checkin": ["admin"],
"parts:upgrade": ["admin", "engineer"],
"parts:release": ["admin", "engineer"],
"parts:freeze": ["admin", "engineer"],
"parts:unfreeze": ["admin"],
"parts:obsolete": ["admin", "engineer"],
"parts:cascade_checkout": ["admin", "engineer"],
"parts:cascade_checkin": ["admin", "engineer"],
"parts:cascade_undocheckout": ["admin", "engineer"],
```

- [ ] **Step 2: 运行权限生成脚本**

```powershell
python D:\OpenCode\myPDM\tools\gen_permissions.py
```

- [ ] **Step 3: 验证生成的文件包含新权限**

```powershell
# 检查后端生成文件
Select-String -Path "D:\OpenCode\myPDM\backend\app\permissions\_generated.py" -Pattern "parts:checkout"
# 检查前端生成文件
Select-String -Path "D:\OpenCode\myPDM\frontend\src\constants\permissions.generated.ts" -Pattern "parts:checkout"
```

- [ ] **Step 4: 提交**

```powershell
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat: add parts checkout permissions"
```

---

## Phase 4: 后端 API 路由

### Task 9: 创建 `routers/parts.py` — PartMaster + PartRevision 路由

**Files:**
- Create: `D:\OpenCode\myPDM\backend\app\routers\parts.py`

- [ ] **Step 1: 创建路由文件（PartMaster/PartRevision 基础路由）**

```python
"""零部件签入检出 API 路由"""
from __future__ import annotations
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from .. import crud_parts
from .. import schemas_parts
from ..permissions import require_permission

router = APIRouter(prefix="/api/parts", tags=["parts"])


# ===== PartMaster =====

@router.get("/", response_model=dict)
def list_parts(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, alias="type"),
    check_out_user_id: Optional[UUID] = Query(None),
    show_all_versions: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    items, total = crud_parts.list_part_masters(
        db, search, status, type, check_out_user_id, show_all_versions, page, page_size
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/", response_model=schemas_parts.PartMasterResponse)
def create_part(
    data: schemas_parts.PartMasterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:create")),
):
    master = crud_parts.create_part_master(db, data.model_dump(), current_user.id)
    return _build_master_response(db, master)


@router.get("/{master_id}", response_model=schemas_parts.PartMasterResponse)
def get_part(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    master = crud_parts.get_part_master(db, master_id)
    if not master:
        raise HTTPException(404, "零件不存在")
    return _build_master_response(db, master)


@router.put("/{master_id}", response_model=schemas_parts.PartMasterResponse)
def update_part(
    master_id: UUID,
    data: schemas_parts.PartMasterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    master = crud_parts.update_part_master(db, master_id, data.model_dump(exclude_none=True))
    if not master:
        raise HTTPException(404, "零件不存在")
    return _build_master_response(db, master)


@router.delete("/{master_id}")
def delete_part(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete")),
):
    ok = crud_parts.delete_part_master(db, master_id)
    if not ok:
        raise HTTPException(404, "零件不存在")
    return {"detail": "已删除"}


# ===== PartRevision =====

@router.get("/{master_id}/revisions")
def list_revisions(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    revisions = crud_parts.list_revisions_by_master(db, master_id)
    result = []
    for rev in revisions:
        checkout_user_name = None
        if rev.check_out_user_id:
            user = db.query(User).filter(User.id == rev.check_out_user_id).first()
            if user:
                checkout_user_name = user.real_name
        result.append(
            {
                "id": str(rev.id),
                "version": rev.version,
                "status": rev.status,
                "revision_note": rev.revision_note,
                "check_out_user_id": str(rev.check_out_user_id) if rev.check_out_user_id else None,
                "check_out_user_name": checkout_user_name,
                "check_out_date": rev.check_out_date.isoformat() if rev.check_out_date else None,
                "latest_iteration": rev.latest_iteration,
                "revision_parent_id": str(rev.revision_parent_id) if rev.revision_parent_id else None,
                "created_at": rev.created_at.isoformat() if rev.created_at else None,
            }
        )
    return result


@router.get("/revisions/{revision_id}")
def get_revision(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    return _build_revision_response(db, revision, iteration)


# ===== 辅助函数 =====

def _build_master_response(db: Session, master) -> dict:
    """构建 PartMasterResponse，含最新版本摘要"""
    latest_revision = (
        db.query(crud_parts.models_parts.PartRevision)
        .filter(
            crud_parts.models_parts.PartRevision.master_id == master.id,
            crud_parts.models_parts.PartRevision.deleted_at.is_(None),
        )
        .order_by(crud_parts.models_parts.PartRevision.created_at.desc())
        .first()
    )

    checkout_user_name = None
    if latest_revision and latest_revision.check_out_user_id:
        user = db.query(User).filter(User.id == latest_revision.check_out_user_id).first()
        if user:
            checkout_user_name = user.real_name

    return {
        "id": str(master.id),
        "code": master.code,
        "name": master.name,
        "spec": master.spec,
        "type": master.type,
        "creator_id": str(master.creator_id) if master.creator_id else None,
        "created_at": master.created_at.isoformat() if master.created_at else None,
        "updated_at": master.updated_at.isoformat() if master.updated_at else None,
        "latest_revision": {
            "id": str(latest_revision.id) if latest_revision else None,
            "version": latest_revision.version if latest_revision else None,
            "status": latest_revision.status if latest_revision else None,
            "latest_iteration": latest_revision.latest_iteration if latest_revision else 0,
            "check_out_user_id": str(latest_revision.check_out_user_id) if (latest_revision and latest_revision.check_out_user_id) else None,
            "check_out_user_name": checkout_user_name,
            "check_out_date": latest_revision.check_out_date.isoformat() if (latest_revision and latest_revision.check_out_date) else None,
            "created_at": latest_revision.created_at.isoformat() if (latest_revision and latest_revision.created_at) else None,
        } if latest_revision else None,
    }


def _build_revision_response(db: Session, revision, iteration) -> dict:
    """构建 PartRevisionResponse，含当前迭代数据"""
    checkout_user_name = None
    if revision.check_out_user_id:
        user = db.query(User).filter(User.id == revision.check_out_user_id).first()
        if user:
            checkout_user_name = user.real_name

    resp = {
        "id": str(revision.id),
        "master_id": str(revision.master_id),
        "version": revision.version,
        "status": revision.status,
        "revision_note": revision.revision_note,
        "check_out_user_id": str(revision.check_out_user_id) if revision.check_out_user_id else None,
        "check_out_user_name": checkout_user_name,
        "check_out_date": revision.check_out_date.isoformat() if revision.check_out_date else None,
        "latest_iteration": revision.latest_iteration,
        "revision_parent_id": str(revision.revision_parent_id) if revision.revision_parent_id else None,
        "creator_id": str(revision.creator_id) if revision.creator_id else None,
        "created_at": revision.created_at.isoformat() if revision.created_at else None,
        "updated_at": revision.updated_at.isoformat() if revision.updated_at else None,
        "current_iteration": None,
    }
    if iteration:
        resp["current_iteration"] = {
            "id": str(iteration.id),
            "revision_id": str(iteration.revision_id),
            "iteration": iteration.iteration,
            "check_in_date": iteration.check_in_date.isoformat() if iteration.check_in_date else None,
            "check_in_note": iteration.check_in_note,
            "custom_fields": iteration.custom_fields or {},
            "document_links": iteration.document_links or [],
            "remark": iteration.remark,
            "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
        }
    return resp
```

- [ ] **Step 2: 验证语法**

```powershell
docker exec bom_backend python -c "from app.routers import parts; print('OK')"
```

---

### Task 10: `routers/parts.py` — 签出/签入/状态变更路由

**Files:**
- Modify: `D:\OpenCode\myPDM\backend\app\routers\parts.py`（追加）

- [ ] **Step 1: 追加签出签入和状态变更路由**

在 `routers/parts.py` 文件末尾追加：

```python
# ===== 签出/签入 =====

@router.post("/revisions/{revision_id}/checkout")
def checkout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:checkout")),
):
    revision, err = crud_parts.checkout_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/checkin")
def checkin(
    revision_id: UUID,
    body: schemas_parts.CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:checkin")),
):
    revision, err = crud_parts.checkin_part(db, revision_id, current_user.id, body.check_in_note)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/undocheckout")
def undocheckout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:undocheckout")),
):
    revision, err = crud_parts.undocheckout_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/force-checkin")
def force_checkin(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:force_checkin")),
):
    revision, err = crud_parts.force_checkin_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


# ===== 状态变更 =====

@router.post("/revisions/{revision_id}/release")
def release(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:release")),
):
    revision, err = crud_parts.release_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/freeze")
def freeze(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:freeze")),
):
    revision, err = crud_parts.freeze_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/unfreeze")
def unfreeze(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:unfreeze")),
):
    revision, err = crud_parts.unfreeze_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/obsolete")
def obsolete(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:obsolete")),
):
    revision, err = crud_parts.obsolete_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/upgrade")
def upgrade(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:upgrade")),
):
    revision, err = crud_parts.upgrade_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision.id)
    return _build_revision_response(db, result[0], result[1])


# ===== 迭代历史 =====

@router.get("/revisions/{revision_id}/iterations")
def list_iterations(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    iterations = crud_parts.list_iterations_by_revision(db, revision_id)
    return [
        {
            "id": str(it.id),
            "revision_id": str(it.revision_id),
            "iteration": it.iteration,
            "check_in_date": it.check_in_date.isoformat() if it.check_in_date else None,
            "check_in_note": it.check_in_note,
            "remark": it.remark,
            "created_at": it.created_at.isoformat() if it.created_at else None,
        }
        for it in iterations
    ]


@router.get("/revisions/{revision_id}/iterations/{iteration_id}")
def get_iteration(
    revision_id: UUID,
    iteration_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    iteration = crud_parts.get_part_iteration(db, iteration_id)
    if not iteration or str(iteration.revision_id) != str(revision_id):
        raise HTTPException(404, "迭代不存在")
    return {
        "id": str(iteration.id),
        "revision_id": str(iteration.revision_id),
        "iteration": iteration.iteration,
        "check_in_date": iteration.check_in_date.isoformat() if iteration.check_in_date else None,
        "check_in_note": iteration.check_in_note,
        "custom_fields": iteration.custom_fields or {},
        "document_links": iteration.document_links or [],
        "remark": iteration.remark,
        "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
    }
```

- [ ] **Step 2: 追加级联操作路由**

```python
# ===== 级联操作 =====

@router.post("/revisions/{revision_id}/cascade-checkout")
def cascade_checkout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_checkout")),
):
    result = crud_parts.cascade_checkout(db, revision_id, current_user.id)
    return result


@router.post("/revisions/{revision_id}/cascade-checkin")
def cascade_checkin(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_checkin")),
):
    result = crud_parts.cascade_checkin(db, revision_id, current_user.id)
    return result


@router.post("/revisions/{revision_id}/cascade-undocheckout")
def cascade_undocheckout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_undocheckout")),
):
    result = crud_parts.cascade_undocheckout(db, revision_id, current_user.id)
    return result


# ===== BOM 管理 =====

@router.get("/revisions/{revision_id}/bom")
def get_bom(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:tree")),
):
    return crud_parts.get_bom_tree(db, revision_id)


@router.post("/revisions/{revision_id}/bom/items")
def add_bom_item(
    revision_id: UUID,
    data: schemas_parts.BOMItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:create_relation")),
):
    item, err = crud_parts.add_bom_item(db, revision_id, data.model_dump())
    if err:
        raise HTTPException(400, err)
    return {"id": str(item.id), "detail": "已添加"}


@router.put("/revisions/{revision_id}/bom/items/{item_id}")
def update_bom_item(
    revision_id: UUID,
    item_id: UUID,
    data: schemas_parts.BOMItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:create_relation")),
):
    item, err = crud_parts.update_bom_item(db, item_id, data.model_dump(exclude_none=True))
    if err:
        raise HTTPException(400, err)
    return {"id": str(item.id), "detail": "已更新"}


@router.delete("/revisions/{revision_id}/bom/items/{item_id}")
def delete_bom_item(
    revision_id: UUID,
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:delete_relation")),
):
    ok = crud_parts.delete_bom_item(db, item_id)
    if not ok:
        raise HTTPException(404, "BOM项不存在")
    return {"detail": "已删除"}
```

- [ ] **Step 3: 验证路由文件完整性**

```powershell
docker exec bom_backend python -c "from app.routers.parts import router; print('Routes:', len(router.routes))"
```

---

### Task 11: 注册路由到 `main.py` 和 `routers/__init__.py`

**Files:**
- Modify: `D:\OpenCode\myPDM\backend\app\routers\__init__.py`
- Modify: `D:\OpenCode\myPDM\backend\app\main.py`

- [ ] **Step 1: 在 `routers/__init__.py` 添加导入**

在 `D:\OpenCode\myPDM\backend\app\routers\__init__.py` 现有导入之后添加：

```python
from .parts import router as parts_router
```

- [ ] **Step 2: 在 `main.py` 注册路由**

在 `main.py` 的 `app.include_router(components_router, prefix="/api")` 之后添加：

```python
app.include_router(parts_router, prefix="/api")
```

- [ ] **Step 3: 重启验证**

```powershell
docker restart bom_backend
docker logs bom_backend --tail 20
```

Expected: 无错误，Swagger UI 可看到新的 `/api/parts/` 路由。

---

## Phase 5: 前端实现

### Task 12: 添加前端类型定义

**Files:**
- Modify: `D:\OpenCode\myPDM\frontend\src\types\index.ts`

- [ ] **Step 1: 在 Component 类型定义之后添加 Part 相关类型**

```typescript
// ===== 零部件三层模型类型 =====

export interface PartMaster {
  id: string;
  code: string;
  name: string;
  spec?: string;
  type: 'part' | 'assembly';
  creator_id?: string;
  created_at?: string;
  updated_at?: string;
  latest_revision?: PartRevisionBrief | null;
}

export interface PartRevisionBrief {
  id: string;
  version: string;
  status: PartStatus;
  latest_iteration: number;
  check_out_user_id?: string | null;
  check_out_user_name?: string | null;
  check_out_date?: string | null;
  created_at?: string;
}

export interface PartRevision extends PartRevisionBrief {
  master_id: string;
  revision_note?: string;
  revision_parent_id?: string | null;
  creator_id?: string;
  updated_at?: string;
  current_iteration?: PartIteration | null;
}

export type PartStatus = 'draft' | 'frozen' | 'released' | 'obsolete';

export interface PartIteration {
  id: string;
  revision_id: string;
  iteration: number;
  check_in_date?: string | null;
  check_in_note?: string;
  custom_fields: Record<string, any>;
  document_links: DocumentLink[];
  remark?: string;
  created_at?: string;
}

export interface DocumentLink {
  id: string;
  document_id: string;
  category: string;
  sort_order: number;
}

export interface PartListItem {
  master_id: string;
  code: string;
  name: string;
  spec?: string;
  type: 'part' | 'assembly';
  revision_id: string;
  version: string;
  status: PartStatus;
  check_out_user_id?: string | null;
  check_out_user_name?: string | null;
  check_out_date?: string | null;
  latest_iteration: number;
  created_at?: string;
}

export interface PartAttachment {
  id: string;
  iteration_id: string;
  category: 'cad' | 'production';
  file_name: string;
  file_size?: number;
  file_path?: string;
  file_hash?: string;
  created_at?: string;
}

export interface CascadeResult {
  succeed_count: number;
  failed_count: number;
  failed_items: { revision_id: string; version?: string; reason: string }[];
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```powershell
cd D:\OpenCode\myPDM\frontend; npx tsc --noEmit --strict 2>&1 | Select-Object -First 10
```

---

### Task 13: 添加前端 API 客户端

**Files:**
- Modify: `D:\OpenCode\myPDM\frontend\src\services\api.ts`

- [ ] **Step 1: 在 `componentsApi` 之后添加 `partsApi`**

在 `D:\OpenCode\myPDM\frontend\src\services\api.ts` 的 `componentsApi` 对象之后添加：

```typescript
export const partsApi = {
  // PartMaster
  list: (params?: Record<string, any>) =>
    api.get('/parts/', { params }).then((r) => r.data),
  get: (masterId: string) =>
    api.get(`/parts/${masterId}`).then((r) => r.data),
  create: (data: Partial<PartMaster>) =>
    api.post('/parts/', data).then((r) => r.data),
  update: (masterId: string, data: Partial<PartMaster>) =>
    api.put(`/parts/${masterId}`, data).then((r) => r.data),
  delete: (masterId: string) =>
    api.delete(`/parts/${masterId}`).then((r) => r.data),

  // PartRevision
  revisions: (masterId: string) =>
    api.get(`/parts/${masterId}/revisions`).then((r) => r.data),
  getRevision: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}`).then((r) => r.data),

  // 签出/签入
  checkout: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/checkout`).then((r) => r.data),
  checkin: (revisionId: string, note?: string) =>
    api.post(`/parts/revisions/${revisionId}/checkin`, { check_in_note: note }).then((r) => r.data),
  undocheckout: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/undocheckout`).then((r) => r.data),
  forceCheckin: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/force-checkin`).then((r) => r.data),

  // 状态变更
  release: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/release`).then((r) => r.data),
  freeze: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/freeze`).then((r) => r.data),
  unfreeze: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/unfreeze`).then((r) => r.data),
  obsolete: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/obsolete`).then((r) => r.data),
  upgrade: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/upgrade`).then((r) => r.data),

  // 迭代
  iterations: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}/iterations`).then((r) => r.data),
  getIteration: (revisionId: string, iterationId: string) =>
    api.get(`/parts/revisions/${revisionId}/iterations/${iterationId}`).then((r) => r.data),

  // 级联
  cascadeCheckout: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/cascade-checkout`).then((r) => r.data),
  cascadeCheckin: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/cascade-checkin`).then((r) => r.data),
  cascadeUndocheckout: (revisionId: string) =>
    api.post(`/parts/revisions/${revisionId}/cascade-undocheckout`).then((r) => r.data),

  // BOM
  getBOM: (revisionId: string) =>
    api.get(`/parts/revisions/${revisionId}/bom`).then((r) => r.data),
  addBOMItem: (revisionId: string, data: { child_revision_id: string; quantity?: number; sort_order?: number }) =>
    api.post(`/parts/revisions/${revisionId}/bom/items`, data).then((r) => r.data),
  updateBOMItem: (revisionId: string, itemId: string, data: { quantity?: number; sort_order?: number }) =>
    api.put(`/parts/revisions/${revisionId}/bom/items/${itemId}`, data).then((r) => r.data),
  deleteBOMItem: (revisionId: string, itemId: string) =>
    api.delete(`/parts/revisions/${revisionId}/bom/items/${itemId}`).then((r) => r.data),
};
```

- [ ] **Step 2: 验证 TypeScript 编译**

```powershell
cd D:\OpenCode\myPDM\frontend; npx tsc --noEmit 2>&1 | Select-Object -First 20 | Select-String -Pattern "api.ts|import " | Select-Object -First 5
```

---

### Task 14: 创建零件列表页 `Pages/PartsPage.tsx`

**Files:**
- Create: `D:\OpenCode\myPDM\frontend\src\pages\PartsPage.tsx`

- [ ] **Step 1: 核心列表页面**

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { PartListItem, PartStatus } from '../types';
import Loading from '../components/Loading';
import Toast from '../components/Toast';

const STATUS_LABELS: Record<PartStatus, string> = {
  draft: '草稿',
  frozen: '冻结',
  released: '已发布',
  obsolete: '已作废',
};

const STATUS_COLORS: Record<PartStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  frozen: 'bg-blue-100 text-blue-700',
  released: 'bg-green-100 text-green-700',
  obsolete: 'bg-red-100 text-red-700',
};

export default function PartsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [items, setItems] = useState<PartListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const PAGE_SIZE = 50;

  const isAdmin = user?.role === 'admin';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: PAGE_SIZE };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      const res = await partsApi.list(params);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCheckout = async (revisionId: string) => {
    try {
      await partsApi.checkout(revisionId);
      setToast({ type: 'success', message: '签出成功' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '签出失败' });
    }
  };

  const handleCreate = () => {
    navigate('/parts/new');
  };

  const showCheckoutButton = (item: PartListItem) => {
    if (!(item.status === 'draft' && !item.check_out_user_id)) return false;
    return user?.role === 'admin' || user?.role === 'engineer';
  };

  if (loading && items.length === 0) return <Loading />;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">零件管理</h1>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 新建零件
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="搜索件号/名称..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm w-48"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部类型</option>
          <option value="part">零件</option>
          <option value="assembly">部件</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-4 py-2">件号</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-left px-4 py-2">版本</th>
              <th className="text-left px-4 py-2">类型</th>
              <th className="text-left px-4 py-2">状态</th>
              <th className="text-left px-4 py-2">签出状态</th>
              <th className="text-left px-4 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={`${item.revision_id}-${idx}`} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 font-mono">{item.code}</td>
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2">{item.version}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${item.type === 'assembly' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                    {item.type === 'assembly' ? '部件' : '零件'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[item.status]}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs">
                  {item.check_out_user_name ? (
                    <span className="text-orange-600">
                      {item.check_out_user_name}
                      {item.check_out_date && ` ${new Date(item.check_out_date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => navigate(`/parts/${item.master_id}?revision=${item.revision_id}`)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      详情
                    </button>
                    {showCheckoutButton(item) && (
                      <button
                        onClick={() => handleCheckout(item.revision_id)}
                        className="text-green-600 hover:underline text-xs"
                      >
                        签出
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {total > PAGE_SIZE && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`px-3 py-1 rounded text-sm ${page === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: 添加路由到 `App.tsx`**

在 `D:\OpenCode\myPDM\frontend\src\App.tsx` 添加导入和路由：

```
import PartsPage from './pages/PartsPage';  // 在其他 import 之后
```

在 components 路由之后添加：

```tsx
<Route path="parts" element={<PartsPage />} />
<Route path="parts/new" element={<PartDetailPanel />} />
<Route path="parts/:masterId" element={<PartDetailPanel />} />
```

- [ ] **Step 3: 构建验证**

```powershell
cd D:\OpenCode\myPDM\frontend; npm run build
```

Expected: 构建成功（PartDetailPanel 还未创建，先临时注释掉未导入的路由）。

---

### Task 15: 创建零件详情面板 `components/PartDetailPanel.tsx`

**Files:**
- Create: `D:\OpenCode\myPDM\frontend\src\components\PartDetailPanel.tsx`

由于此组件较大（6个TAB，签出签入交互），分步骤实现。

- [ ] **Step 1: 创建基础框架（顶部信息 + TAB 切换）**

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { PartMaster, PartRevision, PartIteration, PartStatus, CascadeResult } from '../types';
import Loading from './Loading';
import Toast from './Toast';
import Modal from './Modal';

const STATUS_LABELS: Record<PartStatus, string> = {
  draft: '草稿', frozen: '冻结', released: '已发布', obsolete: '已作废',
};
const STATUS_COLORS: Record<PartStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  frozen: 'bg-blue-100 text-blue-700',
  released: 'bg-green-100 text-green-700',
  obsolete: 'bg-red-100 text-red-700',
};

export default function PartDetailPanel() {
  const { masterId } = useParams<{ masterId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isNew = !masterId || masterId === 'new';

  const [master, setMaster] = useState<PartMaster | null>(null);
  const [revision, setRevision] = useState<PartRevision | null>(null);
  const [iteration, setIteration] = useState<PartIteration | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // TAB 状态
  const [activeTab, setActiveTab] = useState<'info' | 'bom' | 'docs' | 'attachments' | 'versions' | 'iterations'>('info');

  // 编辑状态（签出后才能编辑）
  const [editData, setEditData] = useState<{
    custom_fields: Record<string, any>;
    document_links: any[];
    remark: string;
  }>({ custom_fields: {}, document_links: [], remark: '' });

  // 签字签入状态
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [showCascadeModal, setShowCascadeModal] = useState<'checkout' | 'checkin' | 'undo' | null>(null);
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null);

  // 查看历史迭代
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  const [viewingIteration, setViewingIteration] = useState<PartIteration | null>(null);

  const revisionId = searchParams.get('revision') || revision?.id;

  const loadData = useCallback(async () => {
    if (isNew || !masterId) return;
    setLoading(true);
    try {
      const m = await partsApi.get(masterId);
      setMaster(m);

      const revId = searchParams.get('revision') || (m.latest_revision?.id);
      if (revId) {
        const rev = await partsApi.getRevision(revId);
        setRevision(rev);
        if (rev.current_iteration) {
          setIteration(rev.current_iteration);
          setEditData({
            custom_fields: rev.current_iteration.custom_fields || {},
            document_links: rev.current_iteration.document_links || [],
            remark: rev.current_iteration.remark || '',
          });
        }
      }
    } catch (e) {
      console.error(e);
      setToast({ type: 'error', message: '加载失败' });
    } finally {
      setLoading(false);
    }
  }, [masterId, isNew, searchParams]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- 权限判断 ----
  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const isAdmin = user?.role === 'admin';
  const canEdit = isDraft && isCheckedOutByMe && !viewingIterationId;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canFreeze = revision?.status === 'draft';
  const canUnfreeze = revision?.status === 'frozen' && isAdmin;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdmin;

  // ---- 操作 ----
  const handleCheckout = async () => {
    if (!revisionId) return;
    try {
      await partsApi.checkout(revisionId);
      setToast({ type: 'success', message: '签出成功' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '签出失败' });
    }
  };

  const handleCheckin = async () => {
    if (!revisionId) return;
    setSaving(true);
    try {
      await partsApi.checkin(revisionId, checkinNote || undefined);
      setToast({ type: 'success', message: '签入成功' });
      setShowCheckinModal(false);
      setCheckinNote('');
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '签入失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (!revisionId) return;
    try {
      await partsApi.undocheckout(revisionId);
      setToast({ type: 'success', message: '已撤销签出' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '撤销失败' });
    }
  };

  const handleRelease = async () => {
    if (!revisionId) return;
    try {
      await partsApi.release(revisionId);
      setToast({ type: 'success', message: '已发布' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '发布失败' });
    }
  };

  const handleFreeze = async () => {
    if (!revisionId) return;
    try {
      await partsApi.freeze(revisionId);
      setToast({ type: 'success', message: '已冻结' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '冻结失败' });
    }
  };

  const handleUnfreeze = async () => {
    if (!revisionId) return;
    try {
      await partsApi.unfreeze(revisionId);
      setToast({ type: 'success', message: '已解冻' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '解冻失败' });
    }
  };

  const handleUpgrade = async () => {
    if (!revisionId) return;
    try {
      const newRev = await partsApi.upgrade(revisionId);
      setToast({ type: 'success', message: `已升版至 ${newRev.version}` });
      setSearchParams({ revision: newRev.id });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '升版失败' });
    }
  };

  const handleObsolete = async () => {
    if (!revisionId) return;
    try {
      await partsApi.obsolete(revisionId);
      setToast({ type: 'success', message: '已作废' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '作废失败' });
    }
  };

  const handleForceCheckin = async () => {
    if (!revisionId) return;
    try {
      await partsApi.forceCheckin(revisionId);
      setToast({ type: 'success', message: '已强制签入' });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '强制签入失败' });
    }
  };

  const handleViewIteration = async (iterationId: string) => {
    if (!revisionId) return;
    try {
      const iter = await partsApi.getIteration(revisionId, iterationId);
      setViewingIterationId(iterationId);
      setViewingIteration(iter);
    } catch (e) {
      console.error(e);
    }
  };

  const handleReturnToCurrent = () => {
    setViewingIterationId(null);
    setViewingIteration(null);
  };

  // 级联操作
  const handleCascadeAction = async (action: 'checkout' | 'checkin' | 'undo') => {
    if (!revisionId) return;
    setShowCascadeModal(action);
    try {
      let result: CascadeResult;
      if (action === 'checkout') result = await partsApi.cascadeCheckout(revisionId);
      else if (action === 'checkin') result = await partsApi.cascadeCheckin(revisionId);
      else result = await partsApi.cascadeUndocheckout(revisionId);
      setCascadeResult(result);
      setToast({ type: 'success', message: `成功: ${result.succeed_count}, 失败: ${result.failed_count}` });
      loadData();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.response?.data?.detail || '级联操作失败' });
    }
  };

  if (loading) return <Loading />;
  if (isNew) return <div className="p-6">新建零件功能待实现</div>;

  const currentDisplay = viewingIteration || iteration;

  return (
    <div className="p-6">
      {/* 返回 + 主数据 */}
      <button onClick={() => navigate('/parts')} className="text-blue-600 hover:underline text-sm mb-2">
        &larr; 返回列表
      </button>

      {/* 主数据信息 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">件号:</span> <span className="font-mono">{master?.code}</span></div>
          <div><span className="text-gray-500">名称:</span> {master?.name}</div>
          <div><span className="text-gray-500">规格:</span> {master?.spec || '—'}</div>
          <div><span className="text-gray-500">类型:</span> {master?.type === 'assembly' ? '部件' : '零件'}</div>
        </div>
      </div>

      {/* 版本 + 状态 + 操作按钮 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-semibold">版本: {revision?.version}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[revision?.status || 'draft']}`}>
              {STATUS_LABELS[revision?.status || 'draft']}
            </span>
            {isCheckedOut && (
              <span className="text-xs text-orange-600">
                已签出: {revision?.check_out_user_name}
                {revision?.check_out_date && ` ${new Date(revision.check_out_date).toLocaleString('zh-CN')}`}
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {canCheckout && (
              <button onClick={handleCheckout} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">签出</button>
            )}
            {canCheckin && (
              <button onClick={() => setShowCheckinModal(true)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">检入</button>
            )}
            {canUndo && (
              <button onClick={handleUndo} className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>
            )}
            {canFreeze && (
              <button onClick={handleFreeze} className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>
            )}
            {canUnfreeze && (
              <button onClick={handleUnfreeze} className="px-3 py-1 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600">解冻</button>
            )}
            {canRelease && (
              <button onClick={handleRelease} className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">发布</button>
            )}
            {canUpgrade && (
              <button onClick={handleUpgrade} className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>
            )}
            {canObsolete && (
              <button onClick={handleObsolete} className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>
            )}
            {canForceCheckin && (
              <button onClick={handleForceCheckin} className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>
            )}
          </div>
        </div>
      </div>

      {/* 历史迭代查看提示 */}
      {viewingIterationId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded px-4 py-2 mb-4 text-sm flex items-center justify-between">
          <span>正在查看 Iteration #{viewingIteration?.iteration} 的历史数据（只读）</span>
          <button onClick={handleReturnToCurrent} className="text-blue-600 hover:underline text-xs">返回当前迭代</button>
        </div>
      )}

      {/* TAB 导航 */}
      <div className="bg-white rounded-lg shadow mb-4">
        <div className="flex border-b">
          {[
            { key: 'info', label: '基本信息' },
            { key: 'bom', label: 'BOM结构', hide: master?.type !== 'assembly' },
            { key: 'docs', label: '关联文档' },
            { key: 'attachments', label: '附件' },
            { key: 'versions', label: '版本历史' },
            { key: 'iterations', label: '迭代历史' },
          ]
            .filter((t) => !t.hide)
            .map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key as any)}
                className={`px-4 py-2 text-sm ${activeTab === t.key ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600 hover:text-gray-800'}`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {/* TAB 内容区域 */}
        <div className="p-4">
          {activeTab === 'info' && (
            <InfoTab
              iteration={currentDisplay}
              canEdit={canEdit}
              editData={editData}
              setEditData={setEditData}
            />
          )}
          {activeTab === 'bom' && master?.type === 'assembly' && revisionId && (
            <BOMTab
              revisionId={revisionId}
              onCascade={(action) => handleCascadeAction(action)}
            />
          )}
          {activeTab === 'docs' && (
            <DocsTab iteration={currentDisplay} canEdit={canEdit} />
          )}
          {activeTab === 'attachments' && (
            <AttachmentsTab iteration={currentDisplay} canEdit={canEdit} />
          )}
          {activeTab === 'versions' && masterId && (
            <VersionsTab masterId={masterId} currentRevisionId={revision?.id} onSwitch={(revId) => setSearchParams({ revision: revId })} />
          )}
          {activeTab === 'iterations' && revisionId && (
            <IterationsTab revisionId={revisionId} currentIterationId={iteration?.id} onView={handleViewIteration} />
          )}
        </div>
      </div>

      {/* 签入弹窗 */}
      {showCheckinModal && (
        <Modal onClose={() => setShowCheckinModal(false)} title="签入说明">
          <div className="p-4">
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              placeholder="请输入签入说明（选填）..."
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCheckinModal(false)} className="px-4 py-1.5 border rounded text-sm">取消</button>
              <button onClick={handleCheckin} disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm">
                {saving ? '保存中...' : '确认签入'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 级联操作确认弹窗 */}
      {showCascadeModal && cascadeResult && (
        <Modal onClose={() => { setShowCascadeModal(null); setCascadeResult(null); }} title="级联操作结果">
          <div className="p-4">
            <p className="text-sm mb-2">
              成功: <span className="text-green-600 font-bold">{cascadeResult.succeed_count}</span>{' '}
              失败/跳过: <span className="text-red-600 font-bold">{cascadeResult.failed_count}</span>
            </p>
            {cascadeResult.failed_items.length > 0 && (
              <div className="max-h-40 overflow-auto text-xs">
                {cascadeResult.failed_items.map((f, i) => (
                  <div key={i} className="text-gray-600 py-0.5">
                    {f.version || f.revision_id}: {f.reason}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button
                onClick={() => { setShowCascadeModal(null); setCascadeResult(null); }}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm"
              >
                确定
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

// ============== TAB 子组件 ==============

function InfoTab({
  iteration, canEdit, editData, setEditData,
}: {
  iteration: PartIteration | null;
  canEdit: boolean;
  editData: { custom_fields: Record<string, any>; document_links: any[]; remark: string };
  setEditData: React.Dispatch<React.SetStateAction<any>>;
}) {
  if (!iteration) return <div className="text-gray-400 text-sm">无数据</div>;

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">
        Iteration #{iteration.iteration}
        {iteration.check_in_note && <span className="ml-2">签入说明: {iteration.check_in_note}</span>}
      </div>

      {/* 自定义字段 */}
      <div>
        <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(iteration.custom_fields || {}).map(([key, val]) => (
            <div key={key}>
              <label className="text-xs text-gray-500">{key}</label>
              {canEdit ? (
                <input
                  type="text"
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={editData.custom_fields[key] || ''}
                  onChange={(e) => setEditData((prev: any) => ({
                    ...prev,
                    custom_fields: { ...prev.custom_fields, [key]: e.target.value },
                  }))}
                />
              ) : (
                <div className="text-sm">{String(val)}</div>
              )}
            </div>
          ))}
          {Object.keys(iteration.custom_fields || {}).length === 0 && (
            <div className="text-gray-400 text-sm">无自定义字段</div>
          )}
        </div>
      </div>

      {/* 备注 */}
      <div>
        <h4 className="text-sm font-semibold mb-1">备注</h4>
        {canEdit ? (
          <textarea
            className="w-full border rounded px-2 py-1 text-sm"
            rows={3}
            value={editData.remark}
            onChange={(e) => setEditData((prev: any) => ({ ...prev, remark: e.target.value }))}
          />
        ) : (
          <div className="text-sm text-gray-600">{iteration.remark || '—'}</div>
        )}
      </div>
    </div>
  );
}

function BOMTab({
  revisionId, onCascade,
}: {
  revisionId: string;
  onCascade: (action: 'checkout' | 'checkin' | 'undo') => void;
}) {
  const [bomItems, setBomItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await partsApi.getBOM(revisionId);
        setBomItems(data || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [revisionId]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => onCascade('checkout')} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">级联签出</button>
        <button onClick={() => onCascade('checkin')} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">级联检入</button>
        <button onClick={() => onCascade('undo')} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">级联撤销</button>
      </div>
      {loading ? (
        <div className="text-gray-400 text-sm">加载中...</div>
      ) : bomItems.length === 0 ? (
        <div className="text-gray-400 text-sm">无BOM子项</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-1">件号</th>
              <th className="text-left px-3 py-1">名称</th>
              <th className="text-left px-3 py-1">版本</th>
              <th className="text-left px-3 py-1">数量</th>
              <th className="text-left px-3 py-1">状态</th>
            </tr>
          </thead>
          <tbody>
            {bomItems.map((item, idx) => (
              <tr key={idx} className="border-b">
                <td className="px-3 py-1 font-mono">{item.child_code}</td>
                <td className="px-3 py-1">{item.child_name}</td>
                <td className="px-3 py-1">{item.child_version}</td>
                <td className="px-3 py-1">{item.quantity}</td>
                <td className="px-3 py-1">{item.child_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DocsTab({
  iteration, canEdit,
}: {
  iteration: PartIteration | null;
  canEdit: boolean;
}) {
  if (!iteration) return <div className="text-gray-400 text-sm">无数据</div>;
  const docs = iteration.document_links || [];
  return (
    <div>
      {docs.length === 0 ? (
        <div className="text-gray-400 text-sm">无关联文档</div>
      ) : (
        docs.map((doc: any, idx: number) => (
          <div key={idx} className="text-sm py-1 border-b last:border-0">
            {doc.document_id || doc.id} {doc.category && `[${doc.category}]`}
          </div>
        ))
      )}
    </div>
  );
}

function AttachmentsTab({
  iteration, canEdit,
}: {
  iteration: PartIteration | null;
  canEdit: boolean;
}) {
  if (!iteration) return <div className="text-gray-400 text-sm">无数据</div>;
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">附件</h4>
      <div className="text-gray-400 text-sm">附件功能待实现</div>
    </div>
  );
}

function VersionsTab({
  masterId, currentRevisionId, onSwitch,
}: {
  masterId: string;
  currentRevisionId?: string;
  onSwitch: (revId: string) => void;
}) {
  const [versions, setVersions] = useState<any[]>([]);
  useEffect(() => {
    partsApi.revisions(masterId).then(setVersions).catch(console.error);
  }, [masterId]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b">
          <th className="text-left px-3 py-1">版本</th>
          <th className="text-left px-3 py-1">状态</th>
          <th className="text-left px-3 py-1">创建时间</th>
          <th className="text-left px-3 py-1">操作</th>
        </tr>
      </thead>
      <tbody>
        {versions.map((v) => (
          <tr key={v.id} className={`border-b ${v.id === currentRevisionId ? 'bg-blue-50' : ''}`}>
            <td className="px-3 py-1">{v.version}</td>
            <td className="px-3 py-1">
              <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[v.status as PartStatus]}`}>
                {STATUS_LABELS[v.status as PartStatus]}
              </span>
            </td>
            <td className="px-3 py-1">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td>
            <td className="px-3 py-1">
              {v.id === currentRevisionId ? (
                <span className="text-blue-600 text-xs">● 当前</span>
              ) : (
                <button onClick={() => onSwitch(v.id)} className="text-blue-600 hover:underline text-xs">切换</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IterationsTab({
  revisionId, currentIterationId, onView,
}: {
  revisionId: string;
  currentIterationId?: string;
  onView: (iterationId: string) => void;
}) {
  const [iterations, setIterations] = useState<any[]>([]);
  useEffect(() => {
    partsApi.iterations(revisionId).then(setIterations).catch(console.error);
  }, [revisionId]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b">
          <th className="text-left px-3 py-1">迭代</th>
          <th className="text-left px-3 py-1">签入时间</th>
          <th className="text-left px-3 py-1">签入说明</th>
          <th className="text-left px-3 py-1">操作</th>
        </tr>
      </thead>
      <tbody>
        {iterations.map((it) => (
          <tr key={it.id} className={`border-b ${it.id === currentIterationId ? 'bg-blue-50' : ''}`}>
            <td className="px-3 py-1">#{it.iteration}</td>
            <td className="px-3 py-1">
              {it.check_in_date ? new Date(it.check_in_date).toLocaleString('zh-CN') : '未签入'}
            </td>
            <td className="px-3 py-1">{it.check_in_note || '—'}</td>
            <td className="px-3 py-1">
              {it.id === currentIterationId ? (
                <span className="text-blue-600 text-xs">● 当前</span>
              ) : (
                <button onClick={() => onView(it.id)} className="text-blue-600 hover:underline text-xs">查看数据</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: 更新 App.tsx 完整路由**

在 `App.tsx` 中取消注释 PartDetailPanel 的路由（如果已添加），确保：

```tsx
import PartDetailPanel from './components/PartDetailPanel';
```

```tsx
<Route path="parts" element={<PartsPage />} />
<Route path="parts/:masterId" element={<PartDetailPanel />} />
```

- [ ] **Step 3: 构建验证**

```powershell
cd D:\OpenCode\myPDM\frontend; npm run build
```

Expected: 构建成功。

---

## Phase 6: 集成验证

### Task 16: 端到端验证

- [ ] **Step 1: 重启全部服务**

```powershell
cd D:\OpenCode\myPDM
docker-compose up -d --force-recreate nginx
```

- [ ] **Step 2: 验证 API 端点**

```powershell
# 测试零件列表 API
curl -k -X GET "https://localhost:8080/api/parts/" -H "Authorization: Bearer <token>"

# 测试创建零件
curl -k -X POST "https://localhost:8080/api/parts/" -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"code":"TEST-001","name":"测试零件","type":"part"}'
```

- [ ] **Step 3: 浏览器验证**

打开 `https://localhost:8080/parts`，验证：
1. 零件列表页正常加载
2. 点击详情进入 TAB 面板
3. 签出/签入/撤销功能正常
4. 版本历史、迭代历史正常

Expected: 全部功能可用。

---

## Phase 7: 清理与提交

### Task 17: 最终提交

- [ ] **Step 1: 检查所有变更**

```powershell
git status
```

- [ ] **Step 2: 分批提交**

```powershell
git add backend/app/models_parts.py backend/app/schemas_parts.py backend/app/crud_parts.py
git commit -m "feat: add PartMaster/PartRevision/PartIteration data model, schemas, and CRUD"

git add backend/app/routers/parts.py backend/app/routers/__init__.py backend/app/main.py backend/app/models.py
git commit -m "feat: add parts API routes with checkout/checkin/cascade operations"

git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat: add parts checkout permissions"

git add initdb/migrations/008_part_tables.sql
git commit -m "feat: add part checkout migration script"

git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add frontend Part types and partsApi client"

git add frontend/src/pages/PartsPage.tsx frontend/src/components/PartDetailPanel.tsx frontend/src/App.tsx
git commit -m "feat: add parts list page and detail panel with TAB UI"
```

- [ ] **Step 3: 构建前端**

```powershell
cd D:\OpenCode\myPDM\frontend; npm run build
```

- [ ] **Step 4: 重启 Nginx**

```powershell
docker-compose up -d --force-recreate nginx
```

---

## 风险与注意事项

1. **旧 Component 兼容**: 旧 `components` 路由和 `ComponentsPage` 保留不动，新 `parts` 路由和 `PartsPage` 并行运行
2. **BOMItem 改造**: 新 BOMItem 模型使用 `iteration_id` + `revision_id` 关联，与旧 `parent_type/parent_id` 不兼容。旧 BOM 数据在迁移脚本中处理
3. **附件迁移**: 旧 `component_attachments` 表保留，新 `part_attachments` 表独立运行。文件存储路径不变
4. **权限生成**: 每次修改 `permissions.json` 后必须运行 `python tools/gen_permissions.py`
5. **前端构建**: 每次前端修改后必须 `npm run build`
