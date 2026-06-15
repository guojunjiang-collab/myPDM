# 库存管理模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 PDM 上落地库存管理模块——多仓库数量/批次库存、5 类单据（入库/出库/调拨/盘点/调整）、审批后由指定库管员过账的全闭环。

**Architecture:** 「余额快照(`inventory_stock`) + 不可变流水(`inventory_ledger`)」双表记账；5 类单据共用一张 `inventory_documents` + 明细行表 + 一套审批/过账引擎；审批复用 ECR/ECO 范式（reviewers + review_mode + 审批记录 + 状态日志）；过账在单事务内写流水 + 改余额。

**Tech Stack:** 后端 FastAPI + SQLAlchemy + PostgreSQL（测试用内存 SQLite，conftest 已将 JSONB 编译为 JSON）；前端 React + TS + Zustand + Tailwind + axios。

**参考设计文档：** `docs/superpowers/specs/2026-06-15-inventory-management-design.md`

**现有可复用范式（实现时对照）：**
- 后端：`backend/app/models_eco.py`、`schemas_eco.py`、`crud_eco.py`（编号生成 `generate_eco_number`、`change_eco_status`、`add_eco_review_record`、`check_all_approved`、`clear_review_records`、`_build_reviewers_json`、`_ALLOWED_TRANSITIONS`）、`routers/ecos.py`、`routers/auth.py`（`require_role`）。
- 测试：`backend/tests/conftest.py`（`db` fixture = 内存 SQLite；`engineer_user`/`guest_user` fixture）。
- 前端：`frontend/src/services/api.ts`（axios 实例 + 拦截器，按域导出 `xxxApi` 对象）、`stores/data.ts`、`stores/auth.ts`、`pages/EC.tsx`、`components/Layout.tsx`（导航 `navItems`）、`components/Modal.tsx`、`components/Toast.tsx`。

**执行约定：** 后端全程 TDD（先写失败测试→跑红→实现→跑绿→提交）。运行测试统一在 `backend/` 目录：`python -m pytest tests/ -v`（或指定文件）。前端任务以「能编译 + 关键交互可用」为验收，无单测时以 `npm run build` 通过为绿。

---

## 阶段 A：后端

### Task A1: 数据模型 `models_inventory.py`

**Files:**
- Create: `backend/app/models_inventory.py`
- Modify: `backend/app/main.py`（启动时导入新模型 + `create_all`）
- Modify: `initdb/init.sql`（追加新表 DDL，供全新库初始化）

- [ ] **Step 1: 写模型文件**

Create `backend/app/models_inventory.py`:

```python
"""
库存管理 - SQLAlchemy Models
============================
仓库 / 物料主数据 / 库存余额 / 库存流水 / 单据 / 明细行 / 审批记录 / 状态日志
"""
import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Numeric, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(32), nullable=True)            # 原料库/成品库/不良品库/通用
    default_keeper_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(32), nullable=False, default="active")
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryMaterial(Base):
    __tablename__ = "inventory_materials"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255), nullable=True)
    unit = Column(String(32), nullable=True)
    source_type = Column(String(16), nullable=False, default="standalone")  # part/assembly/standalone
    ref_entity_type = Column(String(16), nullable=True)   # part/assembly
    ref_entity_id = Column(UUID(as_uuid=True), nullable=True)
    track_mode = Column(String(16), nullable=False, default="quantity")     # quantity/batch
    safety_stock = Column(Numeric(14, 4), nullable=True)
    status = Column(String(32), nullable=False, default="active")
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryStock(Base):
    __tablename__ = "inventory_stock"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id = Column(UUID(as_uuid=True), ForeignKey("inventory_materials.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    quantity = Column(Numeric(14, 4), nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id = Column(UUID(as_uuid=True), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    direction = Column(String(4), nullable=False)       # in/out
    quantity = Column(Numeric(14, 4), nullable=False)   # 恒正
    balance_after = Column(Numeric(14, 4), nullable=False)
    doc_id = Column(UUID(as_uuid=True), nullable=True)
    doc_type = Column(String(16), nullable=True)
    doc_number = Column(String(32), nullable=True)
    doc_line_id = Column(UUID(as_uuid=True), nullable=True)
    operator_id = Column(UUID(as_uuid=True), nullable=True)
    operator_name = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InventoryDocument(Base):
    __tablename__ = "inventory_documents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_number = Column(String(32), unique=True, nullable=False)
    doc_type = Column(String(16), nullable=False)       # inbound/outbound/transfer/stocktake/adjustment
    biz_type = Column(String(32), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    to_warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")
    keeper_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    keeper_name = Column(String(64), nullable=True)
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    document_links = Column(JSONB, nullable=False, default=[])
    remark = Column(Text, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryDocumentLine(Base):
    __tablename__ = "inventory_document_lines"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    material_id = Column(UUID(as_uuid=True), ForeignKey("inventory_materials.id"), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    quantity = Column(Numeric(14, 4), nullable=False, default=0)
    direction = Column(String(4), nullable=True)         # 仅调整单：in/out
    book_quantity = Column(Numeric(14, 4), nullable=True)     # 仅盘点
    counted_quantity = Column(Numeric(14, 4), nullable=True)  # 仅盘点
    remark = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)


class InventoryReviewRecord(Base):
    __tablename__ = "inventory_review_records"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InventoryStatusLog(Base):
    __tablename__ = "inventory_status_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 2: 在启动流程导入新模型并建表**

In `backend/app/main.py`, the startup `startup_event()` already imports model modules near line 437-440 to populate `Base.metadata`. Add the inventory import alongside them, and add a `create_all` so missing tables are created on existing DBs.

Find this block (around line 436-440):
```python
            # 导入所有模型模块以填充 Base.metadata
            import app.models  # noqa: F401
            import app.models_ecr  # noqa: F401
            import app.models_eco  # noqa: F401
            import app.models_configuration  # noqa: F401
```
Replace with:
```python
            # 导入所有模型模块以填充 Base.metadata
            import app.models  # noqa: F401
            import app.models_ecr  # noqa: F401
            import app.models_eco  # noqa: F401
            import app.models_configuration  # noqa: F401
            import app.models_inventory  # noqa: F401

            # 幂等建表：仅创建尚不存在的表（如库存模块新表）
            Base.metadata.create_all(bind=engine)
```

- [ ] **Step 3: 追加 init.sql DDL（全新库）**

Append to the end of `initdb/init.sql`:
```sql
-- ===== 库存管理模块 =====
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(32),
    default_keeper_id UUID REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_warehouse_code ON warehouses (code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    unit VARCHAR(32),
    source_type VARCHAR(16) NOT NULL DEFAULT 'standalone',
    ref_entity_type VARCHAR(16),
    ref_entity_id UUID,
    track_mode VARCHAR(16) NOT NULL DEFAULT 'quantity',
    safety_stock NUMERIC(14,4),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_material_code ON inventory_materials (code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_materials(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uix_stock_mat_wh_batch UNIQUE (material_id, warehouse_id, batch_no)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    direction VARCHAR(4) NOT NULL,
    quantity NUMERIC(14,4) NOT NULL,
    balance_after NUMERIC(14,4) NOT NULL,
    doc_id UUID, doc_type VARCHAR(16), doc_number VARCHAR(32), doc_line_id UUID,
    operator_id UUID, operator_name VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ledger_material ON inventory_ledger (material_id, warehouse_id);

CREATE TABLE IF NOT EXISTS inventory_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_number VARCHAR(32) UNIQUE NOT NULL,
    doc_type VARCHAR(16) NOT NULL,
    biz_type VARCHAR(32),
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    warehouse_id UUID REFERENCES warehouses(id),
    to_warehouse_id UUID REFERENCES warehouses(id),
    reviewers JSONB NOT NULL DEFAULT '[]',
    review_mode VARCHAR(8) NOT NULL DEFAULT 'all',
    keeper_id UUID REFERENCES users(id),
    keeper_name VARCHAR(64),
    creator_id UUID NOT NULL REFERENCES users(id),
    document_links JSONB NOT NULL DEFAULT '[]',
    remark TEXT,
    reviewed_at TIMESTAMPTZ, posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_document_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES inventory_documents(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_materials(id),
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
    direction VARCHAR(4),
    book_quantity NUMERIC(14,4),
    counted_quantity NUMERIC(14,4),
    remark TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_review_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES inventory_documents(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    reviewer_name VARCHAR(64),
    decision VARCHAR(16) NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES inventory_documents(id) ON DELETE CASCADE,
    from_status VARCHAR(16), to_status VARCHAR(16) NOT NULL,
    operator_id UUID NOT NULL REFERENCES users(id),
    operator_name VARCHAR(64),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 4: 冒烟测试——模型可建表**

Create `backend/tests/test_inventory_models.py`:
```python
from app import models_inventory  # noqa: F401
from app.models_inventory import Warehouse, InventoryMaterial, InventoryDocument


def test_models_create_and_insert(db):
    wh = Warehouse(code="WH01", name="原料库", type="raw")
    db.add(wh); db.commit(); db.refresh(wh)
    assert wh.id is not None and wh.status == "active"

    m = InventoryMaterial(code="M001", name="螺丝", unit="个", track_mode="quantity")
    db.add(m); db.commit(); db.refresh(m)
    assert m.source_type == "standalone"
```

- [ ] **Step 5: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_inventory_models.py -v`
Expected: 1 passed（`db` fixture 的 `Base.metadata.create_all` 会自动建出新表）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models_inventory.py backend/app/main.py initdb/init.sql backend/tests/test_inventory_models.py
git commit -m "feat(inventory): 数据模型（仓库/物料/库存/流水/单据/审批）+ 建表"
```

---

### Task A2: Pydantic Schemas `schemas_inventory.py`

**Files:**
- Create: `backend/app/schemas_inventory.py`

- [ ] **Step 1: 写 schemas 文件**

Create `backend/app/schemas_inventory.py`:
```python
"""库存管理 - Pydantic Schemas"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal, List
from datetime import datetime


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 仓库 ----
class WarehouseCreate(BaseSchema):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    type: Optional[str] = None
    default_keeper_id: Optional[str] = None
    remark: Optional[str] = None


class WarehouseEdit(BaseSchema):
    name: Optional[str] = None
    type: Optional[str] = None
    default_keeper_id: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None


# ---- 物料 ----
class MaterialCreate(BaseSchema):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    spec: Optional[str] = None
    unit: Optional[str] = None
    track_mode: Literal["quantity", "batch"] = "quantity"
    safety_stock: Optional[float] = None
    remark: Optional[str] = None


class MaterialEdit(BaseSchema):
    name: Optional[str] = None
    spec: Optional[str] = None
    unit: Optional[str] = None
    track_mode: Optional[Literal["quantity", "batch"]] = None
    safety_stock: Optional[float] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class MaterialEnableFromPDM(BaseSchema):
    entity_type: Literal["part", "assembly"]
    entity_id: str
    track_mode: Literal["quantity", "batch"] = "quantity"
    unit: Optional[str] = None
    safety_stock: Optional[float] = None


# ---- 单据 ----
class ReviewerItem(BaseModel):
    user_id: str
    seq: int = 0


class DocumentLineItem(BaseSchema):
    material_id: str
    batch_no: str = ""
    quantity: float = 0
    direction: Optional[Literal["in", "out"]] = None   # 仅调整单
    counted_quantity: Optional[float] = None            # 仅盘点单（过账时填）
    remark: Optional[str] = None


class DocumentCreate(BaseSchema):
    doc_type: Literal["inbound", "outbound", "transfer", "stocktake", "adjustment"]
    biz_type: Optional[str] = None
    warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    reviewers: List[ReviewerItem] = []
    review_mode: Literal["all", "any"] = "all"
    keeper_id: Optional[str] = None
    remark: Optional[str] = None
    lines: List[DocumentLineItem] = []


class DocumentEdit(BaseSchema):
    biz_type: Optional[str] = None
    warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    reviewers: Optional[List[ReviewerItem]] = None
    review_mode: Optional[Literal["all", "any"]] = None
    keeper_id: Optional[str] = None
    remark: Optional[str] = None
    lines: Optional[List[DocumentLineItem]] = None


class ReviewAction(BaseSchema):
    decision: Literal["approved", "rejected", "returned"]
    comment: Optional[str] = None


class AssignKeeperAction(BaseSchema):
    keeper_id: str


class PostLineCount(BaseModel):
    line_id: str
    counted_quantity: float


class PostAction(BaseSchema):
    # 盘点单过账时提交各行实盘数；其它单据可省略
    counts: Optional[List[PostLineCount]] = None


class DocumentListParams(BaseModel):
    page: int = 1
    page_size: int = 20
    doc_type: Optional[str] = None
    status: Optional[str] = None
    search: Optional[str] = None
```

- [ ] **Step 2: 冒烟测试——schema 可解析**

Create `backend/tests/test_inventory_schemas.py`:
```python
from app.schemas_inventory import DocumentCreate


def test_document_create_parses_lines():
    d = DocumentCreate(
        doc_type="inbound", warehouse_id="w1",
        lines=[{"material_id": "m1", "quantity": 5}],
    )
    assert d.doc_type == "inbound"
    assert d.lines[0].quantity == 5
    assert d.review_mode == "all"
```

- [ ] **Step 3: 跑测试**

Run: `cd backend && python -m pytest tests/test_inventory_schemas.py -v`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas_inventory.py backend/tests/test_inventory_schemas.py
git commit -m "feat(inventory): Pydantic schemas（仓库/物料/单据/审批/过账）"
```

---

### Task A3: 主数据 CRUD（仓库 + 物料）

**Files:**
- Create: `backend/app/crud_inventory.py`
- Test: `backend/tests/test_inventory_master.py`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/test_inventory_master.py`:
```python
import uuid
import pytest
from app import crud_inventory
from app.schemas_inventory import WarehouseCreate, MaterialCreate, MaterialEnableFromPDM
from app.models import Part


def test_create_warehouse_and_material(db, engineer_user):
    wh = crud_inventory.create_warehouse(db, WarehouseCreate(code="WH01", name="原料库", type="raw"))
    assert wh.code == "WH01"

    m = crud_inventory.create_material(db, MaterialCreate(code="M001", name="螺丝", unit="个"))
    assert m.source_type == "standalone" and m.track_mode == "quantity"


def test_enable_material_from_pdm_part(db):
    part = Part(id=uuid.uuid4(), code="P-100", name="法兰", version="A", status="released")
    db.add(part); db.commit()
    m = crud_inventory.enable_material_from_pdm(
        db, MaterialEnableFromPDM(entity_type="part", entity_id=str(part.id), unit="件")
    )
    assert m.source_type == "part"
    assert m.ref_entity_id == part.id
    assert m.code == "P-100" and m.name == "法兰"
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_inventory_master.py -v`
Expected: FAIL（`ModuleNotFoundError` / `AttributeError: create_warehouse`）。

- [ ] **Step 3: 写 crud_inventory.py 的主数据部分（含头部与状态常量）**

Create `backend/app/crud_inventory.py`:
```python
"""库存管理 - CRUD + 过账引擎"""
import uuid
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from fastapi import HTTPException

from app.models import User, Part, Assembly
from app.models_inventory import (
    Warehouse, InventoryMaterial, InventoryStock, InventoryLedger,
    InventoryDocument, InventoryDocumentLine, InventoryReviewRecord, InventoryStatusLog,
)
from app.schemas_inventory import (
    WarehouseCreate, WarehouseEdit, MaterialCreate, MaterialEdit, MaterialEnableFromPDM,
    DocumentCreate, DocumentEdit, DocumentListParams,
)

# ── 状态流转规则 ──
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing"},
    "reviewing": {"approved", "rejected", "draft"},
    "approved":  {"posted", "cancelled"},
    "posted":    set(),
    "rejected":  set(),
    "cancelled": set(),
}

_DOC_PREFIX = {
    "inbound": "IN", "outbound": "OUT", "transfer": "TR",
    "stocktake": "PC", "adjustment": "ADJ",
}


def _uuid(v):
    if v is None or v == "":
        return None
    return uuid.UUID(v) if isinstance(v, str) else v


# ════════════════════════ 仓库 ════════════════════════
def create_warehouse(db: Session, data: WarehouseCreate) -> Warehouse:
    exists = db.query(Warehouse).filter(
        Warehouse.code == data.code, Warehouse.deleted_at.is_(None)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="仓库编码已存在")
    wh = Warehouse(
        code=data.code, name=data.name, type=data.type,
        default_keeper_id=_uuid(data.default_keeper_id), remark=data.remark,
    )
    db.add(wh); db.commit(); db.refresh(wh)
    return wh


def list_warehouses(db: Session) -> list:
    return db.query(Warehouse).filter(Warehouse.deleted_at.is_(None)).order_by(Warehouse.code).all()


def get_warehouse(db: Session, wh_id: uuid.UUID) -> Warehouse:
    wh = db.query(Warehouse).filter(Warehouse.id == wh_id, Warehouse.deleted_at.is_(None)).first()
    if not wh:
        raise HTTPException(status_code=404, detail="仓库不存在")
    return wh


def update_warehouse(db: Session, wh: Warehouse, data: WarehouseEdit) -> Warehouse:
    for field in ("name", "type", "status", "remark"):
        val = getattr(data, field)
        if val is not None:
            setattr(wh, field, val)
    if data.default_keeper_id is not None:
        wh.default_keeper_id = _uuid(data.default_keeper_id)
    db.commit(); db.refresh(wh)
    return wh


def delete_warehouse(db: Session, wh: Warehouse):
    wh.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ════════════════════════ 物料 ════════════════════════
def create_material(db: Session, data: MaterialCreate) -> InventoryMaterial:
    exists = db.query(InventoryMaterial).filter(
        InventoryMaterial.code == data.code, InventoryMaterial.deleted_at.is_(None)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="物料编码已存在")
    m = InventoryMaterial(
        code=data.code, name=data.name, spec=data.spec, unit=data.unit,
        source_type="standalone", track_mode=data.track_mode,
        safety_stock=data.safety_stock, remark=data.remark,
    )
    db.add(m); db.commit(); db.refresh(m)
    return m


def enable_material_from_pdm(db: Session, data: MaterialEnableFromPDM) -> InventoryMaterial:
    model = Part if data.entity_type == "part" else Assembly
    entity = db.query(model).filter(model.id == _uuid(data.entity_id)).first()
    if not entity:
        raise HTTPException(status_code=404, detail="PDM 实体不存在")
    dup = db.query(InventoryMaterial).filter(
        InventoryMaterial.ref_entity_type == data.entity_type,
        InventoryMaterial.ref_entity_id == entity.id,
        InventoryMaterial.deleted_at.is_(None),
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="该零部件已启用库存")
    m = InventoryMaterial(
        code=entity.code, name=entity.name, spec=getattr(entity, "spec", None),
        unit=data.unit, source_type=data.entity_type,
        ref_entity_type=data.entity_type, ref_entity_id=entity.id,
        track_mode=data.track_mode, safety_stock=data.safety_stock,
    )
    db.add(m); db.commit(); db.refresh(m)
    return m


def list_materials(db: Session, search: str = None, source_type: str = None, track_mode: str = None) -> list:
    q = db.query(InventoryMaterial).filter(InventoryMaterial.deleted_at.is_(None))
    if source_type:
        q = q.filter(InventoryMaterial.source_type == source_type)
    if track_mode:
        q = q.filter(InventoryMaterial.track_mode == track_mode)
    if search:
        p = f"%{search}%"
        q = q.filter((InventoryMaterial.code.ilike(p)) | (InventoryMaterial.name.ilike(p)))
    return q.order_by(InventoryMaterial.code).all()


def get_material(db: Session, m_id: uuid.UUID) -> InventoryMaterial:
    m = db.query(InventoryMaterial).filter(
        InventoryMaterial.id == m_id, InventoryMaterial.deleted_at.is_(None)
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="物料不存在")
    return m


def update_material(db: Session, m: InventoryMaterial, data: MaterialEdit) -> InventoryMaterial:
    for field in ("name", "spec", "unit", "track_mode", "status", "remark"):
        val = getattr(data, field)
        if val is not None:
            setattr(m, field, val)
    if data.safety_stock is not None:
        m.safety_stock = data.safety_stock
    db.commit(); db.refresh(m)
    return m


def delete_material(db: Session, m: InventoryMaterial):
    m.deleted_at = datetime.now(timezone.utc)
    db.commit()
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_inventory_master.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_inventory.py backend/tests/test_inventory_master.py
git commit -m "feat(inventory): 仓库/物料主数据 CRUD（含从 PDM 启用库存）"
```

---

### Task A4: 库存余额 + 流水 + 过账引擎（核心）

**Files:**
- Modify: `backend/app/crud_inventory.py`（追加库存与过账函数）
- Test: `backend/tests/test_inventory_posting.py`

- [ ] **Step 1: 写失败测试（覆盖 5 类单据过账 + 余额不足拒绝）**

Create `backend/tests/test_inventory_posting.py`:
```python
import uuid
import pytest
from decimal import Decimal
from fastapi import HTTPException
from app import crud_inventory
from app.models_inventory import (
    Warehouse, InventoryMaterial, InventoryDocument, InventoryDocumentLine,
    InventoryStock, InventoryLedger,
)


def _wh(db, code="WH01"):
    wh = Warehouse(id=uuid.uuid4(), code=code, name=code, type="raw")
    db.add(wh); db.commit(); db.refresh(wh)
    return wh


def _mat(db, code="M001"):
    m = InventoryMaterial(id=uuid.uuid4(), code=code, name=code, unit="个", track_mode="quantity")
    db.add(m); db.commit(); db.refresh(m)
    return m


def _doc(db, doc_type, wh, creator, to_wh=None):
    doc = InventoryDocument(
        id=uuid.uuid4(), doc_number=f"T-{doc_type}-{uuid.uuid4().hex[:6]}",
        doc_type=doc_type, status="approved", warehouse_id=wh.id,
        to_warehouse_id=(to_wh.id if to_wh else None), creator_id=creator.id,
        keeper_id=creator.id,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    return doc


def _line(db, doc, mat, qty, direction=None, counted=None):
    ln = InventoryDocumentLine(
        id=uuid.uuid4(), doc_id=doc.id, material_id=mat.id, batch_no="",
        quantity=qty, direction=direction, counted_quantity=counted,
    )
    db.add(ln); db.commit(); db.refresh(ln)
    return ln


def _stock_qty(db, mat, wh):
    s = db.query(InventoryStock).filter(
        InventoryStock.material_id == mat.id, InventoryStock.warehouse_id == wh.id,
        InventoryStock.batch_no == "",
    ).first()
    return Decimal(s.quantity) if s else Decimal(0)


def test_inbound_posting_increases_stock(db, engineer_user):
    wh, m = _wh(db), _mat(db)
    doc = _doc(db, "inbound", wh, engineer_user)
    _line(db, doc, m, 10)
    crud_inventory.post_document(db, doc, engineer_user)
    assert _stock_qty(db, m, wh) == Decimal(10)
    assert db.query(InventoryLedger).filter(InventoryLedger.doc_id == doc.id).count() == 1
    assert doc.status == "posted"


def test_outbound_insufficient_stock_rejected(db, engineer_user):
    wh, m = _wh(db), _mat(db)
    out = _doc(db, "outbound", wh, engineer_user)
    _line(db, out, m, 5)
    with pytest.raises(HTTPException) as exc:
        crud_inventory.post_document(db, out, engineer_user)
    assert exc.value.status_code == 400
    assert _stock_qty(db, m, wh) == Decimal(0)  # 整单回滚，未扣减


def test_outbound_posting_decreases_stock(db, engineer_user):
    wh, m = _wh(db), _mat(db)
    inb = _doc(db, "inbound", wh, engineer_user); _line(db, inb, m, 10)
    crud_inventory.post_document(db, inb, engineer_user)
    out = _doc(db, "outbound", wh, engineer_user); _line(db, out, m, 4)
    crud_inventory.post_document(db, out, engineer_user)
    assert _stock_qty(db, m, wh) == Decimal(6)


def test_transfer_moves_between_warehouses(db, engineer_user):
    src, dst, m = _wh(db, "SRC"), _wh(db, "DST"), _mat(db)
    inb = _doc(db, "inbound", src, engineer_user); _line(db, inb, m, 10)
    crud_inventory.post_document(db, inb, engineer_user)
    tr = _doc(db, "transfer", src, engineer_user, to_wh=dst); _line(db, tr, m, 3)
    crud_inventory.post_document(db, tr, engineer_user)
    assert _stock_qty(db, m, src) == Decimal(7)
    assert _stock_qty(db, m, dst) == Decimal(3)
    assert db.query(InventoryLedger).filter(InventoryLedger.doc_id == tr.id).count() == 2


def test_stocktake_corrects_to_counted(db, engineer_user):
    wh, m = _wh(db), _mat(db)
    inb = _doc(db, "inbound", wh, engineer_user); _line(db, inb, m, 10)
    crud_inventory.post_document(db, inb, engineer_user)
    pc = _doc(db, "stocktake", wh, engineer_user); _line(db, pc, m, 0, counted=8)
    crud_inventory.post_document(db, pc, engineer_user)
    assert _stock_qty(db, m, wh) == Decimal(8)


def test_adjustment_in_and_out(db, engineer_user):
    wh, m = _wh(db), _mat(db)
    adj_in = _doc(db, "adjustment", wh, engineer_user); _line(db, adj_in, m, 5, direction="in")
    crud_inventory.post_document(db, adj_in, engineer_user)
    assert _stock_qty(db, m, wh) == Decimal(5)
    adj_out = _doc(db, "adjustment", wh, engineer_user); _line(db, adj_out, m, 2, direction="out")
    crud_inventory.post_document(db, adj_out, engineer_user)
    assert _stock_qty(db, m, wh) == Decimal(3)
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_inventory_posting.py -v`
Expected: FAIL（`AttributeError: post_document`）。

- [ ] **Step 3: 在 crud_inventory.py 追加库存与过账引擎**

Append to `backend/app/crud_inventory.py`:
```python
# ════════════════════════ 库存余额 / 流水 ════════════════════════
def _get_or_create_stock(db: Session, material_id, warehouse_id, batch_no: str) -> InventoryStock:
    batch_no = batch_no or ""
    stock = db.query(InventoryStock).filter(
        InventoryStock.material_id == material_id,
        InventoryStock.warehouse_id == warehouse_id,
        InventoryStock.batch_no == batch_no,
    ).with_for_update().first()  # PG 行锁；SQLite 下被忽略
    if not stock:
        stock = InventoryStock(material_id=material_id, warehouse_id=warehouse_id,
                               batch_no=batch_no, quantity=0)
        db.add(stock); db.flush()
    return stock


def _apply_movement(db, doc, line, warehouse_id, direction: str, qty: Decimal, operator: User):
    if qty <= 0:
        return
    stock = _get_or_create_stock(db, line.material_id, warehouse_id, line.batch_no)
    current = Decimal(stock.quantity or 0)
    if direction == "out":
        if current < qty:
            raise HTTPException(
                status_code=400,
                detail=f"库存不足：物料 {line.material_id} 仓库 {warehouse_id} 当前 {current}，需出 {qty}",
            )
        new_balance = current - qty
    else:
        new_balance = current + qty
    stock.quantity = new_balance
    db.add(InventoryLedger(
        material_id=line.material_id, warehouse_id=warehouse_id, batch_no=line.batch_no or "",
        direction=direction, quantity=qty, balance_after=new_balance,
        doc_id=doc.id, doc_type=doc.doc_type, doc_number=doc.doc_number, doc_line_id=line.id,
        operator_id=operator.id, operator_name=operator.real_name,
    ))


def get_stock_quantity(db: Session, material_id, warehouse_id, batch_no: str = "") -> Decimal:
    s = db.query(InventoryStock).filter(
        InventoryStock.material_id == material_id,
        InventoryStock.warehouse_id == warehouse_id,
        InventoryStock.batch_no == (batch_no or ""),
    ).first()
    return Decimal(s.quantity) if s else Decimal(0)


# ════════════════════════ 过账引擎 ════════════════════════
def post_document(db: Session, doc: InventoryDocument, operator: User) -> InventoryDocument:
    """审批通过(approved)的单据过账：单事务内写流水 + 改余额；任一行失败整单回滚。"""
    if doc.status != "approved":
        raise HTTPException(status_code=400, detail="仅已审批单据可过账")
    lines = db.query(InventoryDocumentLine).filter(
        InventoryDocumentLine.doc_id == doc.id
    ).order_by(InventoryDocumentLine.sort_order).all()
    if not lines:
        raise HTTPException(status_code=400, detail="单据无明细，无法过账")

    try:
        for line in lines:
            qty = Decimal(line.quantity or 0)
            if doc.doc_type == "inbound":
                _apply_movement(db, doc, line, doc.warehouse_id, "in", qty, operator)
            elif doc.doc_type == "outbound":
                _apply_movement(db, doc, line, doc.warehouse_id, "out", qty, operator)
            elif doc.doc_type == "transfer":
                if not doc.to_warehouse_id:
                    raise HTTPException(status_code=400, detail="调拨单缺少目标仓")
                _apply_movement(db, doc, line, doc.warehouse_id, "out", qty, operator)
                _apply_movement(db, doc, line, doc.to_warehouse_id, "in", qty, operator)
            elif doc.doc_type == "stocktake":
                stock = _get_or_create_stock(db, line.material_id, doc.warehouse_id, line.batch_no)
                book = Decimal(stock.quantity or 0)
                counted = Decimal(line.counted_quantity if line.counted_quantity is not None else book)
                line.book_quantity = book  # 记录过账时实时账面
                diff = counted - book
                if diff > 0:
                    _apply_movement(db, doc, line, doc.warehouse_id, "in", diff, operator)
                elif diff < 0:
                    _apply_movement(db, doc, line, doc.warehouse_id, "out", -diff, operator)
            elif doc.doc_type == "adjustment":
                direction = line.direction or "in"
                _apply_movement(db, doc, line, doc.warehouse_id, direction, qty, operator)
            else:
                raise HTTPException(status_code=400, detail=f"未知单据类型 {doc.doc_type}")

        doc.status = "posted"
        doc.posted_at = datetime.now(timezone.utc)
        db.add(InventoryStatusLog(
            doc_id=doc.id, from_status="approved", to_status="posted",
            operator_id=operator.id, operator_name=operator.real_name, comment="过账",
        ))
        db.commit()
        db.refresh(doc)
        return doc
    except HTTPException:
        db.rollback()
        raise
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_inventory_posting.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_inventory.py backend/tests/test_inventory_posting.py
git commit -m "feat(inventory): 过账引擎（入/出/调拨/盘点/调整）+ 余额流水双写"
```

---

### Task A5: 单据 CRUD + 生命周期（编号/创建/编辑/状态流转/审批/改派/取消）

**Files:**
- Modify: `backend/app/crud_inventory.py`（追加单据与审批函数）
- Test: `backend/tests/test_inventory_document.py`

- [ ] **Step 1: 写失败测试（编号 + 创建 + 提交→自动批准 + 提交→审批通过→过账 + 非法流转 + 改派）**

Create `backend/tests/test_inventory_document.py`:
```python
import uuid
import pytest
from fastapi import HTTPException
from app import crud_inventory
from app.schemas_inventory import DocumentCreate, DocumentLineItem, ReviewerItem
from app.models import User
from app.models_inventory import Warehouse, InventoryMaterial


@pytest.fixture
def wh(db):
    w = Warehouse(id=uuid.uuid4(), code="WH01", name="原料库", type="raw")
    db.add(w); db.commit(); db.refresh(w)
    return w


@pytest.fixture
def mat(db):
    m = InventoryMaterial(id=uuid.uuid4(), code="M001", name="螺丝", unit="个", track_mode="quantity")
    db.add(m); db.commit(); db.refresh(m)
    return m


@pytest.fixture
def keeper(db):
    u = User(id=uuid.uuid4(), username="kp", password_hash="x", real_name="库管", role="production", status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _create(db, wh, mat, creator, reviewers=None, keeper_id=None):
    data = DocumentCreate(
        doc_type="inbound", warehouse_id=str(wh.id),
        reviewers=[ReviewerItem(user_id=r) for r in (reviewers or [])],
        keeper_id=keeper_id,
        lines=[DocumentLineItem(material_id=str(mat.id), quantity=10)],
    )
    return crud_inventory.create_document(db, data, creator.id)


def test_generate_doc_number_prefix(db):
    n = crud_inventory.generate_doc_number(db, "inbound")
    assert n.startswith("IN-")


def test_create_then_submit_no_reviewer_auto_approved(db, wh, mat, engineer_user):
    doc = _create(db, wh, mat, engineer_user, reviewers=[], keeper_id=str(engineer_user.id))
    assert doc.status == "draft"
    doc = crud_inventory.submit_document(db, doc, engineer_user)
    assert doc.status == "approved"  # 无审批人自动批准


def test_submit_review_post_full_chain(db, wh, mat, engineer_user, keeper):
    doc = _create(db, wh, mat, engineer_user, reviewers=[str(engineer_user.id)], keeper_id=str(keeper.id))
    doc = crud_inventory.submit_document(db, doc, engineer_user)
    assert doc.status == "reviewing"
    doc = crud_inventory.review_document(db, doc, engineer_user, "approved", "ok")
    assert doc.status == "approved"
    doc = crud_inventory.post_document(db, doc, keeper)
    assert doc.status == "posted"
    assert crud_inventory.get_stock_quantity(db, mat.id, wh.id) == 10


def test_cannot_post_before_approved(db, wh, mat, engineer_user):
    doc = _create(db, wh, mat, engineer_user, reviewers=[str(engineer_user.id)])
    with pytest.raises(HTTPException):
        crud_inventory.post_document(db, doc, engineer_user)  # 仍 draft


def test_assign_keeper(db, wh, mat, engineer_user, keeper):
    doc = _create(db, wh, mat, engineer_user)
    doc = crud_inventory.assign_keeper(db, doc, keeper)
    assert doc.keeper_id == keeper.id and doc.keeper_name == "库管"
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_inventory_document.py -v`
Expected: FAIL（缺 `generate_doc_number` / `create_document` 等）。

- [ ] **Step 3: 在 crud_inventory.py 追加单据与审批函数**

Append to `backend/app/crud_inventory.py`:
```python
# ════════════════════════ 单据编号 ════════════════════════
def generate_doc_number(db: Session, doc_type: str) -> str:
    prefix = f"{_DOC_PREFIX[doc_type]}-{datetime.now(timezone.utc):%Y%m%d}-"
    max_number = db.query(sqlfunc.max(InventoryDocument.doc_number)).filter(
        InventoryDocument.doc_number.like(f"{prefix}%")
    ).scalar()
    if max_number:
        try:
            seq = int(max_number[len(prefix):]) + 1
        except ValueError:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:04d}"


def _build_reviewers_json(db: Session, reviewer_items) -> list:
    result = []
    for item in (reviewer_items or []):
        uid = item.user_id if hasattr(item, "user_id") else item.get("user_id", "")
        seq = item.seq if hasattr(item, "seq") else item.get("seq", 0)
        u_uuid = _uuid(uid)
        if not u_uuid:
            continue
        user = db.query(User).filter(User.id == u_uuid).first()
        if user:
            result.append({"seq": seq, "user_id": str(u_uuid),
                           "user_name": user.real_name, "role": user.role})
    return result


def _add_status_log(db, doc_id, from_status, to_status, operator: User, comment=""):
    db.add(InventoryStatusLog(
        doc_id=doc_id, from_status=from_status, to_status=to_status,
        operator_id=operator.id, operator_name=operator.real_name, comment=comment,
    ))


def _set_lines(db, doc, lines):
    db.query(InventoryDocumentLine).filter(InventoryDocumentLine.doc_id == doc.id).delete()
    for idx, ln in enumerate(lines or []):
        db.add(InventoryDocumentLine(
            doc_id=doc.id, material_id=_uuid(ln.material_id), batch_no=ln.batch_no or "",
            quantity=ln.quantity or 0, direction=ln.direction,
            counted_quantity=ln.counted_quantity, remark=ln.remark, sort_order=idx,
        ))


# ════════════════════════ 单据 CRUD ════════════════════════
def create_document(db: Session, data: DocumentCreate, creator_id) -> InventoryDocument:
    keeper_id = _uuid(data.keeper_id)
    # 默认带出主仓默认库管员
    if not keeper_id and data.warehouse_id:
        wh = db.query(Warehouse).filter(Warehouse.id == _uuid(data.warehouse_id)).first()
        if wh and wh.default_keeper_id:
            keeper_id = wh.default_keeper_id
    keeper_name = None
    if keeper_id:
        ku = db.query(User).filter(User.id == keeper_id).first()
        keeper_name = ku.real_name if ku else None

    doc = InventoryDocument(
        doc_number=generate_doc_number(db, data.doc_type),
        doc_type=data.doc_type, biz_type=data.biz_type, status="draft",
        warehouse_id=_uuid(data.warehouse_id), to_warehouse_id=_uuid(data.to_warehouse_id),
        reviewers=_build_reviewers_json(db, data.reviewers), review_mode=data.review_mode,
        keeper_id=keeper_id, keeper_name=keeper_name, creator_id=creator_id, remark=data.remark,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    _set_lines(db, doc, data.lines)
    db.commit(); db.refresh(doc)
    return doc


def get_document(db: Session, doc_id: uuid.UUID) -> InventoryDocument:
    doc = db.query(InventoryDocument).filter(
        InventoryDocument.id == doc_id, InventoryDocument.deleted_at.is_(None)
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="单据不存在")
    return doc


def update_document(db: Session, doc: InventoryDocument, data: DocumentEdit) -> InventoryDocument:
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑")
    for field in ("biz_type", "review_mode", "remark"):
        val = getattr(data, field)
        if val is not None:
            setattr(doc, field, val)
    if data.warehouse_id is not None:
        doc.warehouse_id = _uuid(data.warehouse_id)
    if data.to_warehouse_id is not None:
        doc.to_warehouse_id = _uuid(data.to_warehouse_id)
    if data.keeper_id is not None:
        doc.keeper_id = _uuid(data.keeper_id)
        ku = db.query(User).filter(User.id == doc.keeper_id).first()
        doc.keeper_name = ku.real_name if ku else None
    if data.reviewers is not None:
        doc.reviewers = _build_reviewers_json(db, data.reviewers)
    if data.lines is not None:
        _set_lines(db, doc, data.lines)
    db.commit(); db.refresh(doc)
    return doc


def delete_document(db: Session, doc: InventoryDocument):
    if doc.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="仅草稿/已拒绝单据可删除")
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()


def list_documents(db: Session, params: DocumentListParams, current_user: User):
    from sqlalchemy import or_, String
    q = db.query(InventoryDocument).filter(InventoryDocument.deleted_at.is_(None))
    if current_user and current_user.role not in ("admin",):
        uid = str(current_user.id)
        q = q.filter(or_(
            InventoryDocument.creator_id == current_user.id,
            InventoryDocument.keeper_id == current_user.id,
            InventoryDocument.reviewers.cast(String).contains(f'"user_id": "{uid}"'),
        ))
    if params.doc_type:
        q = q.filter(InventoryDocument.doc_type == params.doc_type)
    if params.status:
        q = q.filter(InventoryDocument.status == params.status)
    if params.search:
        q = q.filter(InventoryDocument.doc_number.ilike(f"%{params.search}%"))
    total = q.count()
    docs = q.order_by(InventoryDocument.created_at.desc()).offset(
        (params.page - 1) * params.page_size
    ).limit(params.page_size).all()
    return docs, total


# ════════════════════════ 状态流转 / 审批 ════════════════════════
def _change_status(db, doc, to_status, operator: User, comment="", skip_log=False):
    if to_status not in _ALLOWED_TRANSITIONS.get(doc.status, set()):
        raise HTTPException(status_code=400, detail=f"不允许从 {doc.status} 变更为 {to_status}")
    if not skip_log:
        _add_status_log(db, doc.id, doc.status, to_status, operator, comment)
    doc.status = to_status
    if to_status in ("approved", "rejected"):
        doc.reviewed_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(doc)
    return doc


def submit_document(db, doc, user: User) -> InventoryDocument:
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可提交")
    db.query(InventoryReviewRecord).filter(InventoryReviewRecord.doc_id == doc.id).delete()
    db.commit()
    if not doc.reviewers:
        return _change_status(db, doc, "approved", user, "无审批人，自动批准")
    return _change_status(db, doc, "reviewing", user, "提交审批")


def withdraw_document(db, doc, user: User) -> InventoryDocument:
    if doc.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅审批中可撤回")
    if user.role != "admin" and doc.creator_id != user.id:
        raise HTTPException(status_code=403, detail="仅创建人或管理员可撤回")
    db.query(InventoryReviewRecord).filter(InventoryReviewRecord.doc_id == doc.id).delete()
    db.commit()
    return _change_status(db, doc, "draft", user, "撤回审批")


def _check_all_approved(db, doc) -> bool:
    rids = {_uuid(r["user_id"]) for r in (doc.reviewers or []) if r.get("user_id")}
    if not rids:
        return False
    approved = db.query(InventoryReviewRecord).filter(
        InventoryReviewRecord.doc_id == doc.id, InventoryReviewRecord.decision == "approved"
    ).all()
    aids = {r.reviewer_id for r in approved}
    return len(aids & rids) > 0 if doc.review_mode == "any" else rids.issubset(aids)


def review_document(db, doc, reviewer: User, decision: str, comment: str = "") -> InventoryDocument:
    if doc.status != "reviewing":
        raise HTTPException(status_code=400, detail="单据不在审批中")
    is_admin = reviewer.role == "admin"
    is_reviewer = any(r.get("user_id") == str(reviewer.id) for r in (doc.reviewers or []))
    if not is_admin and not is_reviewer:
        raise HTTPException(status_code=403, detail="您不是该单据的指定审批人")

    if decision == "returned":
        db.query(InventoryReviewRecord).filter(InventoryReviewRecord.doc_id == doc.id).delete()
        db.commit()
        return _change_status(db, doc, "draft", reviewer, comment or "退回修改")

    db.add(InventoryReviewRecord(
        doc_id=doc.id, reviewer_id=reviewer.id, reviewer_name=reviewer.real_name,
        decision=decision, comment=comment,
    ))
    db.commit()
    if decision == "approved" and _check_all_approved(db, doc):
        return _change_status(db, doc, "approved", reviewer, "审批通过")
    if decision == "rejected":
        return _change_status(db, doc, "rejected", reviewer, comment or "驳回")
    db.refresh(doc)
    return doc


def assign_keeper(db, doc, keeper_user: User) -> InventoryDocument:
    if doc.status not in ("draft", "reviewing", "approved"):
        raise HTTPException(status_code=400, detail="过账后不可改派库管员")
    if keeper_user.role not in ("admin", "engineer", "production"):
        raise HTTPException(status_code=400, detail="该用户无库存操作权限，不能指派为库管员")
    doc.keeper_id = keeper_user.id
    doc.keeper_name = keeper_user.real_name
    db.commit(); db.refresh(doc)
    return doc


def cancel_document(db, doc, user: User) -> InventoryDocument:
    if doc.status != "approved":
        raise HTTPException(status_code=400, detail="仅已审批未过账单据可取消")
    return _change_status(db, doc, "cancelled", user, "取消")


def get_document_lines(db, doc_id):
    return db.query(InventoryDocumentLine).filter(
        InventoryDocumentLine.doc_id == doc_id
    ).order_by(InventoryDocumentLine.sort_order).all()


def get_review_records(db, doc_id):
    return db.query(InventoryReviewRecord).filter(
        InventoryReviewRecord.doc_id == doc_id
    ).order_by(InventoryReviewRecord.created_at).all()


def get_status_logs(db, doc_id):
    return db.query(InventoryStatusLog).filter(
        InventoryStatusLog.doc_id == doc_id
    ).order_by(InventoryStatusLog.created_at).all()
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_inventory_document.py -v`
Expected: 5 passed.

- [ ] **Step 5: 跑全部库存测试**

Run: `cd backend && python -m pytest tests/test_inventory_*.py -v`
Expected: 全绿（models 1 + schemas 1 + master 2 + posting 6 + document 5 = 15 passed）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_inventory.py backend/tests/test_inventory_document.py
git commit -m "feat(inventory): 单据 CRUD + 状态机 + 审批 + 改派/取消"
```

---

### Task A6: 路由 `routers/inventory.py` + 注册 + 过账时填实盘数

**Files:**
- Create: `backend/app/routers/inventory.py`
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py`（include_router）
- Test: `backend/tests/test_inventory_api.py`

- [ ] **Step 1: 写路由文件**

Create `backend/app/routers/inventory.py`:
```python
"""库存管理 - API Router"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.models_inventory import InventoryStock, InventoryMaterial, InventoryLedger
from app import crud_inventory
from app.schemas_inventory import (
    WarehouseCreate, WarehouseEdit, MaterialCreate, MaterialEdit, MaterialEnableFromPDM,
    DocumentCreate, DocumentEdit, DocumentListParams, ReviewAction, AssignKeeperAction, PostAction,
)
from app.routers.auth import require_role

router = APIRouter(prefix="/inventory", tags=["库存管理"])

READ_ROLES = ["admin", "engineer", "production", "guest"]
WRITE_ROLES = ["admin", "engineer", "production"]
MASTER_ROLES = ["admin", "engineer"]


# ──────────── 仓库 ────────────
@router.get("/warehouses")
async def list_warehouses(db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(READ_ROLES))):
    items = crud_inventory.list_warehouses(db)
    return {"items": [_wh_dict(w) for w in items]}


@router.post("/warehouses")
async def create_warehouse(data: WarehouseCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(require_role(MASTER_ROLES))):
    return _wh_dict(crud_inventory.create_warehouse(db, data))


@router.put("/warehouses/{wh_id}")
async def update_warehouse(wh_id: uuid.UUID, data: WarehouseEdit, db: Session = Depends(get_db),
                           current_user: User = Depends(require_role(MASTER_ROLES))):
    wh = crud_inventory.get_warehouse(db, wh_id)
    return _wh_dict(crud_inventory.update_warehouse(db, wh, data))


@router.delete("/warehouses/{wh_id}")
async def delete_warehouse(wh_id: uuid.UUID, db: Session = Depends(get_db),
                           current_user: User = Depends(require_role(MASTER_ROLES))):
    crud_inventory.delete_warehouse(db, crud_inventory.get_warehouse(db, wh_id))
    return {"detail": "已删除"}


# ──────────── 物料 ────────────
@router.get("/materials")
async def list_materials(search: str = Query(None), source_type: str = Query(None),
                         track_mode: str = Query(None), db: Session = Depends(get_db),
                         current_user: User = Depends(require_role(READ_ROLES))):
    items = crud_inventory.list_materials(db, search, source_type, track_mode)
    return {"items": [_mat_dict(m) for m in items]}


@router.post("/materials")
async def create_material(data: MaterialCreate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(MASTER_ROLES))):
    return _mat_dict(crud_inventory.create_material(db, data))


@router.post("/materials/enable-from-pdm")
async def enable_from_pdm(data: MaterialEnableFromPDM, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(MASTER_ROLES))):
    return _mat_dict(crud_inventory.enable_material_from_pdm(db, data))


@router.put("/materials/{m_id}")
async def update_material(m_id: uuid.UUID, data: MaterialEdit, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(MASTER_ROLES))):
    m = crud_inventory.get_material(db, m_id)
    return _mat_dict(crud_inventory.update_material(db, m, data))


@router.delete("/materials/{m_id}")
async def delete_material(m_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(MASTER_ROLES))):
    crud_inventory.delete_material(db, crud_inventory.get_material(db, m_id))
    return {"detail": "已删除"}


# ──────────── 库存查询 ────────────
@router.get("/stock")
async def list_stock(material: str = Query(None), warehouse_id: uuid.UUID = Query(None),
                     low_only: bool = Query(False), db: Session = Depends(get_db),
                     current_user: User = Depends(require_role(READ_ROLES))):
    q = db.query(InventoryStock, InventoryMaterial).join(
        InventoryMaterial, InventoryStock.material_id == InventoryMaterial.id
    )
    if warehouse_id:
        q = q.filter(InventoryStock.warehouse_id == warehouse_id)
    if material:
        p = f"%{material}%"
        q = q.filter((InventoryMaterial.code.ilike(p)) | (InventoryMaterial.name.ilike(p)))
    rows = q.all()
    items = []
    for stock, mat in rows:
        if low_only and (mat.safety_stock is None or float(stock.quantity) >= float(mat.safety_stock)):
            continue
        items.append({
            "material_id": str(mat.id), "material_code": mat.code, "material_name": mat.name,
            "unit": mat.unit, "warehouse_id": str(stock.warehouse_id), "batch_no": stock.batch_no,
            "quantity": float(stock.quantity),
            "safety_stock": float(mat.safety_stock) if mat.safety_stock is not None else None,
            "is_low": mat.safety_stock is not None and float(stock.quantity) < float(mat.safety_stock),
        })
    return {"items": items}


@router.get("/stock/ledger")
async def list_ledger(material_id: uuid.UUID = Query(None), warehouse_id: uuid.UUID = Query(None),
                      doc_id: uuid.UUID = Query(None), limit: int = Query(200, le=1000),
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_role(READ_ROLES))):
    q = db.query(InventoryLedger)
    if material_id:
        q = q.filter(InventoryLedger.material_id == material_id)
    if warehouse_id:
        q = q.filter(InventoryLedger.warehouse_id == warehouse_id)
    if doc_id:
        q = q.filter(InventoryLedger.doc_id == doc_id)
    rows = q.order_by(InventoryLedger.created_at.desc()).limit(limit).all()
    return {"items": [{
        "id": str(r.id), "material_id": str(r.material_id), "warehouse_id": str(r.warehouse_id),
        "batch_no": r.batch_no, "direction": r.direction, "quantity": float(r.quantity),
        "balance_after": float(r.balance_after), "doc_number": r.doc_number, "doc_type": r.doc_type,
        "operator_name": r.operator_name, "created_at": r.created_at,
    } for r in rows]}


# ──────────── 单据 ────────────
@router.get("/documents")
async def list_documents(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                         doc_type: str = Query(None), status: str = Query(None), search: str = Query(None),
                         db: Session = Depends(get_db),
                         current_user: User = Depends(require_role(READ_ROLES))):
    params = DocumentListParams(page=page, page_size=page_size, doc_type=doc_type, status=status, search=search)
    docs, total = crud_inventory.list_documents(db, params, current_user)
    return {"items": [_doc_brief(db, d) for d in docs], "total": total, "page": page, "page_size": page_size}


@router.post("/documents")
async def create_document(data: DocumentCreate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.create_document(db, data, current_user.id)
    return _doc_detail(db, doc)


@router.get("/documents/{doc_id}")
async def get_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(require_role(READ_ROLES))):
    return _doc_detail(db, crud_inventory.get_document(db, doc_id))


@router.put("/documents/{doc_id}")
async def update_document(doc_id: uuid.UUID, data: DocumentEdit, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    return _doc_detail(db, crud_inventory.update_document(db, doc, data))


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    crud_inventory.delete_document(db, crud_inventory.get_document(db, doc_id))
    return {"detail": "已删除"}


@router.post("/documents/{doc_id}/submit")
async def submit_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    return _doc_detail(db, crud_inventory.submit_document(db, doc, current_user))


@router.post("/documents/{doc_id}/withdraw")
async def withdraw_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                            current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    return _doc_detail(db, crud_inventory.withdraw_document(db, doc, current_user))


@router.post("/documents/{doc_id}/review")
async def review_document(doc_id: uuid.UUID, data: ReviewAction, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    return _doc_detail(db, crud_inventory.review_document(db, doc, current_user, data.decision, data.comment or ""))


@router.post("/documents/{doc_id}/assign-keeper")
async def assign_keeper(doc_id: uuid.UUID, data: AssignKeeperAction, db: Session = Depends(get_db),
                        current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    keeper = db.query(User).filter(User.id == uuid.UUID(data.keeper_id)).first()
    if not keeper:
        raise HTTPException(status_code=404, detail="指定用户不存在")
    return _doc_detail(db, crud_inventory.assign_keeper(db, doc, keeper))


@router.post("/documents/{doc_id}/post")
async def post_document(doc_id: uuid.UUID, data: PostAction = None, db: Session = Depends(get_db),
                        current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    # 仅指定库管员或管理员可过账
    if current_user.role != "admin" and doc.keeper_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅指定库管员可过账")
    # 盘点单：先写入各行实盘数
    if data and data.counts:
        line_map = {str(l.id): l for l in crud_inventory.get_document_lines(db, doc.id)}
        for c in data.counts:
            if c.line_id in line_map:
                line_map[c.line_id].counted_quantity = c.counted_quantity
        db.commit()
    return _doc_detail(db, crud_inventory.post_document(db, doc, current_user))


@router.post("/documents/{doc_id}/cancel")
async def cancel_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_role(WRITE_ROLES))):
    doc = crud_inventory.get_document(db, doc_id)
    return _doc_detail(db, crud_inventory.cancel_document(db, doc, current_user))


# ──────────── 序列化辅助 ────────────
def _wh_dict(w):
    return {"id": str(w.id), "code": w.code, "name": w.name, "type": w.type,
            "default_keeper_id": str(w.default_keeper_id) if w.default_keeper_id else None,
            "status": w.status, "remark": w.remark}


def _mat_dict(m):
    return {"id": str(m.id), "code": m.code, "name": m.name, "spec": m.spec, "unit": m.unit,
            "source_type": m.source_type, "ref_entity_type": m.ref_entity_type,
            "ref_entity_id": str(m.ref_entity_id) if m.ref_entity_id else None,
            "track_mode": m.track_mode,
            "safety_stock": float(m.safety_stock) if m.safety_stock is not None else None,
            "status": m.status, "remark": m.remark}


def _doc_brief(db, d):
    creator = db.query(User).filter(User.id == d.creator_id).first()
    return {"id": str(d.id), "doc_number": d.doc_number, "doc_type": d.doc_type,
            "biz_type": d.biz_type, "status": d.status,
            "warehouse_id": str(d.warehouse_id) if d.warehouse_id else None,
            "to_warehouse_id": str(d.to_warehouse_id) if d.to_warehouse_id else None,
            "keeper_name": d.keeper_name, "creator_name": creator.real_name if creator else "",
            "created_at": d.created_at, "updated_at": d.updated_at}


def _doc_detail(db, d):
    base = _doc_brief(db, d)
    lines = crud_inventory.get_document_lines(db, d.id)
    base["lines"] = [{
        "id": str(l.id), "material_id": str(l.material_id), "batch_no": l.batch_no,
        "quantity": float(l.quantity), "direction": l.direction,
        "book_quantity": float(l.book_quantity) if l.book_quantity is not None else None,
        "counted_quantity": float(l.counted_quantity) if l.counted_quantity is not None else None,
        "remark": l.remark, "sort_order": l.sort_order,
    } for l in lines]
    base["reviewers"] = d.reviewers or []
    base["review_mode"] = d.review_mode
    base["keeper_id"] = str(d.keeper_id) if d.keeper_id else None
    base["remark"] = d.remark
    base["review_records"] = [{
        "id": str(r.id), "reviewer_name": r.reviewer_name, "decision": r.decision,
        "comment": r.comment, "created_at": r.created_at,
    } for r in crud_inventory.get_review_records(db, d.id)]
    base["status_logs"] = [{
        "id": str(s.id), "from_status": s.from_status, "to_status": s.to_status,
        "operator_name": s.operator_name, "comment": s.comment, "created_at": s.created_at,
    } for s in crud_inventory.get_status_logs(db, d.id)]
    return base
```

- [ ] **Step 2: 注册路由**

In `backend/app/routers/__init__.py`, add after the `config_router` import line:
```python
from .inventory import router as inventory_router
```
And add `"inventory_router"` to the `__all__` list.

In `backend/app/main.py`, add to the imports on line 5 (extend the `from .routers import ...` tuple) `inventory_router`, then add after line 40 (`app.include_router(config_router, prefix="/api")`):
```python
app.include_router(inventory_router, prefix="/api")
```

- [ ] **Step 3: 写 API 集成测试（用 TestClient + 依赖覆盖鉴权）**

Create `backend/tests/test_inventory_api.py`:
```python
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User


@pytest.fixture
def client(db):
    user = User(id=uuid.uuid4(), username="eng", password_hash="x", real_name="工程师",
                role="engineer", status="active")
    db.add(user); db.commit(); db.refresh(user)

    # 注意：用 TestClient(app) 而非 with TestClient(app) —— 不触发 startup_event（避免连 PostgreSQL）
    # require_role 返回的 checker 依赖 get_current_active_user，覆盖它即可让所有端点放行为该用户
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_full_inbound_flow_via_api(client, db):
    c, user = client
    # 建仓库
    wh = c.post("/api/inventory/warehouses", json={"code": "WH01", "name": "原料库", "type": "raw"}).json()
    # 建物料
    mat = c.post("/api/inventory/materials", json={"code": "M001", "name": "螺丝", "unit": "个"}).json()
    # 建入库单（无审批人，提交即自动批准）
    doc = c.post("/api/inventory/documents", json={
        "doc_type": "inbound", "warehouse_id": wh["id"], "keeper_id": str(user.id),
        "lines": [{"material_id": mat["id"], "quantity": 10}],
    }).json()
    assert doc["status"] == "draft"
    doc = c.post(f"/api/inventory/documents/{doc['id']}/submit").json()
    assert doc["status"] == "approved"
    doc = c.post(f"/api/inventory/documents/{doc['id']}/post", json={}).json()
    assert doc["status"] == "posted"
    # 库存查询
    stock = c.get("/api/inventory/stock").json()
    assert any(s["quantity"] == 10.0 for s in stock["items"])
```

> 说明：`require_role(roles)` 内部 `Depends(get_current_active_user)`，覆盖 `get_current_active_user` 即可让任意端点放行为该工程师用户，无需逐个覆盖 `require_role`。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_inventory_api.py -v`
Expected: 1 passed.

- [ ] **Step 5: 跑全部库存测试 + 全量回归**

Run: `cd backend && python -m pytest tests/ -v`
Expected: 既有测试全绿 + 新增库存测试全绿（无回归）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/inventory.py backend/app/routers/__init__.py backend/app/main.py backend/tests/test_inventory_api.py
git commit -m "feat(inventory): API 路由（仓库/物料/库存/单据全生命周期）+ 集成测试"
```

---

### Task A7: AI 助手只读网关放行库存端点

**Files:**
- Modify: `backend/app/assistant/api_gateway.py`（白名单加库存 GET 端点）
- Test: `backend/tests/test_api_gateway.py`（若已有白名单断言则补一条）

- [ ] **Step 1: 查看现有白名单结构**

Run: `cd backend && grep -n "whitelist\|ALLOW\|allowed\|parts\|configurations" app/assistant/api_gateway.py | head -20`
Identify the allow-list constant (e.g. a set/list of path prefixes like `parts`, `assemblies`, `bom`, `documents`, `configurations`, `custom-fields`, `ecos`, `ecrs`).

- [ ] **Step 2: 加入库存 GET 前缀**

Add these path prefixes to the existing allow-list constant (match the existing format exactly — string entries like the others):
```
inventory/stock
inventory/documents
inventory/materials
inventory/warehouses
```
Keep write/post paths excluded (the gateway is GET-only by design — verify the existing code already restricts to GET; do not change that).

- [ ] **Step 3: 跑网关测试**

Run: `cd backend && python -m pytest tests/test_api_gateway.py -v`
Expected: 既有测试仍全绿（新增前缀不破坏既有断言）。

- [ ] **Step 4: Commit**

```bash
git add backend/app/assistant/api_gateway.py
git commit -m "feat(inventory): AI 助手只读网关放行库存查询端点"
```

---

## 阶段 B：前端

> 前端任务以「`npm run build` 通过 + 关键交互可用」为绿。运行：`cd frontend && npm run build`。所有新组件放 `frontend/src/components/Inventory/`。颜色/样式沿用现有 Tailwind 约定（参考 `pages/EC.tsx`、`components/Modal.tsx`）。

### Task B1: 前端 API 客户端 `inventoryApi.ts` + 类型

**Files:**
- Create: `frontend/src/services/inventoryApi.ts`
- Modify: `frontend/src/types/index.ts`（追加库存相关类型；若 types 是目录则建 `types/inventory.ts` 并在 `index.ts` re-export）

- [ ] **Step 1: 确认 types 结构**

Run: `cd frontend && ls src/types`
If `index.ts` exists, append types there; if it's a folder of files, create `src/types/inventory.ts` and add `export * from './inventory';` to `src/types/index.ts`.

- [ ] **Step 2: 写类型**

Add to the appropriate types file:
```typescript
export type InvDocType = 'inbound' | 'outbound' | 'transfer' | 'stocktake' | 'adjustment';
export type InvDocStatus = 'draft' | 'reviewing' | 'approved' | 'posted' | 'rejected' | 'cancelled';

export interface Warehouse {
  id: string; code: string; name: string; type?: string;
  default_keeper_id?: string | null; status: string; remark?: string;
}
export interface InvMaterial {
  id: string; code: string; name: string; spec?: string; unit?: string;
  source_type: 'part' | 'assembly' | 'standalone';
  ref_entity_type?: string | null; ref_entity_id?: string | null;
  track_mode: 'quantity' | 'batch'; safety_stock?: number | null; status: string;
}
export interface StockRow {
  material_id: string; material_code: string; material_name: string; unit?: string;
  warehouse_id: string; batch_no: string; quantity: number;
  safety_stock?: number | null; is_low: boolean;
}
export interface InvDocLine {
  id?: string; material_id: string; batch_no: string; quantity: number;
  direction?: 'in' | 'out' | null; book_quantity?: number | null;
  counted_quantity?: number | null; remark?: string;
}
export interface InvReviewer { user_id: string; seq?: number; user_name?: string; role?: string; }
export interface InvDocument {
  id: string; doc_number: string; doc_type: InvDocType; biz_type?: string;
  status: InvDocStatus; warehouse_id?: string | null; to_warehouse_id?: string | null;
  keeper_id?: string | null; keeper_name?: string; creator_name?: string;
  reviewers?: InvReviewer[]; review_mode?: 'all' | 'any'; remark?: string;
  lines?: InvDocLine[]; review_records?: any[]; status_logs?: any[];
  created_at?: string; updated_at?: string;
}
```

- [ ] **Step 3: 写 API 客户端**

Create `frontend/src/services/inventoryApi.ts`:
```typescript
import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({ baseURL: '/api/inventory', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const inventoryApi = {
  // 仓库
  listWarehouses: () => api.get('/warehouses'),
  createWarehouse: (data: any) => api.post('/warehouses', data),
  updateWarehouse: (id: string, data: any) => api.put(`/warehouses/${id}`, data),
  deleteWarehouse: (id: string) => api.delete(`/warehouses/${id}`),
  // 物料
  listMaterials: (params?: { search?: string; source_type?: string; track_mode?: string }) =>
    api.get('/materials', { params }),
  createMaterial: (data: any) => api.post('/materials', data),
  enableFromPdm: (data: any) => api.post('/materials/enable-from-pdm', data),
  updateMaterial: (id: string, data: any) => api.put(`/materials/${id}`, data),
  deleteMaterial: (id: string) => api.delete(`/materials/${id}`),
  // 库存
  listStock: (params?: { material?: string; warehouse_id?: string; low_only?: boolean }) =>
    api.get('/stock', { params }),
  listLedger: (params?: { material_id?: string; warehouse_id?: string; doc_id?: string }) =>
    api.get('/stock/ledger', { params }),
  // 单据
  listDocuments: (params?: { page?: number; page_size?: number; doc_type?: string; status?: string; search?: string }) =>
    api.get('/documents', { params }),
  getDocument: (id: string) => api.get(`/documents/${id}`),
  createDocument: (data: any) => api.post('/documents', data),
  updateDocument: (id: string, data: any) => api.put(`/documents/${id}`, data),
  deleteDocument: (id: string) => api.delete(`/documents/${id}`),
  submit: (id: string) => api.post(`/documents/${id}/submit`),
  withdraw: (id: string) => api.post(`/documents/${id}/withdraw`),
  review: (id: string, data: { decision: string; comment?: string }) => api.post(`/documents/${id}/review`, data),
  assignKeeper: (id: string, keeperId: string) => api.post(`/documents/${id}/assign-keeper`, { keeper_id: keeperId }),
  post: (id: string, data?: { counts?: { line_id: string; counted_quantity: number }[] }) =>
    api.post(`/documents/${id}/post`, data || {}),
  cancel: (id: string) => api.post(`/documents/${id}/cancel`),
};
```

- [ ] **Step 4: 编译验证**

Run: `cd frontend && npm run build`
Expected: 编译通过（无类型错误）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/inventoryApi.ts frontend/src/types
git commit -m "feat(inventory): 前端 API 客户端 + 类型定义"
```

---

### Task B2: Zustand store + Inventory Tab 容器 + 导航文案

**Files:**
- Create: `frontend/src/stores/inventory.ts`
- Rewrite: `frontend/src/pages/Inventory.tsx`
- Modify: `frontend/src/components/Layout.tsx`（导航文案）

- [ ] **Step 1: 写 store（缓存仓库/物料/用户列表）**

Create `frontend/src/stores/inventory.ts`:
```typescript
import { create } from 'zustand';
import { inventoryApi } from '../services/inventoryApi';
import { usersApi } from '../services/api';
import type { Warehouse, InvMaterial } from '../types';

interface InvState {
  warehouses: Warehouse[];
  materials: InvMaterial[];
  users: { id: string; real_name: string; role: string }[];
  loadWarehouses: () => Promise<void>;
  loadMaterials: (search?: string) => Promise<void>;
  loadUsers: () => Promise<void>;
}

export const useInventoryStore = create<InvState>((set) => ({
  warehouses: [],
  materials: [],
  users: [],
  loadWarehouses: async () => {
    const res = await inventoryApi.listWarehouses();
    set({ warehouses: res.data.items });
  },
  loadMaterials: async (search?: string) => {
    const res = await inventoryApi.listMaterials({ search });
    set({ materials: res.data.items });
  },
  loadUsers: async () => {
    const res = await usersApi.list({ page: 1, page_size: 200 });
    const items = (res.data.items || res.data || []).map((u: any) => ({
      id: u.id, real_name: u.real_name, role: u.role,
    }));
    set({ users: items });
  },
}));
```

> 实现时核实 `usersApi.list` 的返回结构（`res.data.items` 还是 `res.data`），按实际调整 `.map` 来源。

- [ ] **Step 2: 写 Tab 容器页**

Rewrite `frontend/src/pages/Inventory.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useInventoryStore } from '../stores/inventory';
import StockTab from '../components/Inventory/StockTab';
import DocumentTab from '../components/Inventory/DocumentTab';
import MaterialTab from '../components/Inventory/MaterialTab';
import WarehouseTab from '../components/Inventory/WarehouseTab';

const TABS = [
  { key: 'stock', label: '库存查询' },
  { key: 'documents', label: '单据' },
  { key: 'materials', label: '物料主数据' },
  { key: 'warehouses', label: '仓库' },
] as const;

export default function Inventory() {
  const [tab, setTab] = useState<string>('stock');
  const { loadWarehouses, loadUsers } = useInventoryStore();

  useEffect(() => { loadWarehouses(); loadUsers(); }, [loadWarehouses, loadUsers]);

  return (
    <div className="p-4">
      <div className="flex gap-2 border-b mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm ${tab === t.key
              ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
              : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'stock' && <StockTab />}
      {tab === 'documents' && <DocumentTab />}
      {tab === 'materials' && <MaterialTab />}
      {tab === 'warehouses' && <WarehouseTab />}
    </div>
  );
}
```

- [ ] **Step 3: 改导航文案**

In `frontend/src/components/Layout.tsx`, find the inventory nav item:
```tsx
  { path: '/inventory', label: '库存管理（开发中）', icon: '🏗️', roles: ['admin', 'engineer', 'production', 'guest'] },
```
Change `label` to `'库存管理'` and `icon` to `'📦'`:
```tsx
  { path: '/inventory', label: '库存管理', icon: '📦', roles: ['admin', 'engineer', 'production', 'guest'] },
```
(部件管理已用 📦——如重复可改用 '🏬'。)

- [ ] **Step 4: 建 4 个占位 Tab 组件让编译通过**

Create 4 minimal placeholder files so the page compiles before later tasks flesh them out:

`frontend/src/components/Inventory/StockTab.tsx`:
```tsx
export default function StockTab() { return <div className="text-sm text-gray-500">库存查询</div>; }
```
`frontend/src/components/Inventory/DocumentTab.tsx`:
```tsx
export default function DocumentTab() { return <div className="text-sm text-gray-500">单据</div>; }
```
`frontend/src/components/Inventory/MaterialTab.tsx`:
```tsx
export default function MaterialTab() { return <div className="text-sm text-gray-500">物料主数据</div>; }
```
`frontend/src/components/Inventory/WarehouseTab.tsx`:
```tsx
export default function WarehouseTab() { return <div className="text-sm text-gray-500">仓库</div>; }
```

- [ ] **Step 5: 编译验证**

Run: `cd frontend && npm run build`
Expected: 编译通过；侧边栏「库存管理」可进入，显示 4 个 Tab。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/inventory.ts frontend/src/pages/Inventory.tsx frontend/src/components/Layout.tsx frontend/src/components/Inventory/
git commit -m "feat(inventory): 前端 Tab 容器 + store + 导航上线"
```

---

### Task B3: 仓库 Tab（列表 + 新建/编辑弹窗）

**Files:**
- Rewrite: `frontend/src/components/Inventory/WarehouseTab.tsx`

- [ ] **Step 1: 实现仓库 Tab**

Rewrite `frontend/src/components/Inventory/WarehouseTab.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { Warehouse } from '../../types';

const WH_TYPES = [
  { value: 'raw', label: '原料库' },
  { value: 'finished', label: '成品库' },
  { value: 'defective', label: '不良品库' },
  { value: 'general', label: '通用' },
];

export default function WarehouseTab() {
  const { warehouses, loadWarehouses, users } = useInventoryStore();
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);

  const save = async () => {
    if (!editing) return;
    if (editing.id) {
      await inventoryApi.updateWarehouse(editing.id, editing);
    } else {
      await inventoryApi.createWarehouse(editing);
    }
    setEditing(null);
    await loadWarehouses();
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该仓库？')) return;
    await inventoryApi.deleteWarehouse(id);
    await loadWarehouses();
  };

  return (
    <div>
      <button onClick={() => setEditing({ code: '', name: '', type: 'general' })}
        className="mb-3 px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建仓库</button>
      <table className="w-full text-sm border">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">编码</th><th className="p-2 text-left">名称</th>
            <th className="p-2 text-left">类型</th><th className="p-2 text-left">默认库管员</th>
            <th className="p-2">操作</th></tr>
        </thead>
        <tbody>
          {warehouses.map((w) => (
            <tr key={w.id} className="border-t">
              <td className="p-2">{w.code}</td><td className="p-2">{w.name}</td>
              <td className="p-2">{WH_TYPES.find((t) => t.value === w.type)?.label || w.type}</td>
              <td className="p-2">{users.find((u) => u.id === w.default_keeper_id)?.real_name || '-'}</td>
              <td className="p-2 text-center">
                <button onClick={() => setEditing(w)} className="text-blue-500 mr-2">编辑</button>
                <button onClick={() => remove(w.id)} className="text-red-500">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-96 space-y-3">
            <h3 className="font-medium">{editing.id ? '编辑仓库' : '新建仓库'}</h3>
            <input placeholder="编码" value={editing.code || ''} disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="名称" value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <select value={editing.type || 'general'}
              onChange={(e) => setEditing({ ...editing, type: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm">
              {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={editing.default_keeper_id || ''}
              onChange={(e) => setEditing({ ...editing, default_keeper_id: e.target.value || null })}
              className="w-full border px-2 py-1 rounded text-sm">
              <option value="">（无默认库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm">取消</button>
              <button onClick={save} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

Run: `cd frontend && npm run build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Inventory/WarehouseTab.tsx
git commit -m "feat(inventory): 仓库管理 Tab（CRUD + 默认库管员）"
```

---

### Task B4: 物料 Tab（列表 + 新建非PDM + 从 PDM 启用）

**Files:**
- Rewrite: `frontend/src/components/Inventory/MaterialTab.tsx`

- [ ] **Step 1: 实现物料 Tab**

Rewrite `frontend/src/components/Inventory/MaterialTab.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { partsApi, assembliesApi } from '../../services/api';
import type { InvMaterial } from '../../types';

export default function MaterialTab() {
  const { materials, loadMaterials } = useInventoryStore();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<InvMaterial> | null>(null);
  const [pdmMode, setPdmMode] = useState(false);
  const [pdmKeyword, setPdmKeyword] = useState('');
  const [pdmResults, setPdmResults] = useState<{ id: string; code: string; name: string; entity_type: string }[]>([]);

  useEffect(() => { loadMaterials(); }, [loadMaterials]);

  const saveStandalone = async () => {
    if (!editing) return;
    if (editing.id) await inventoryApi.updateMaterial(editing.id, editing);
    else await inventoryApi.createMaterial(editing);
    setEditing(null);
    await loadMaterials(search);
  };

  const searchPdm = async () => {
    const [p, a] = await Promise.all([
      partsApi.list({ search: pdmKeyword, page_size: 20 }),
      assembliesApi.list({ search: pdmKeyword, page_size: 20 }),
    ]);
    const parts = (p.data.items || []).map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'part' }));
    const asms = (a.data.items || []).map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'assembly' }));
    setPdmResults([...parts, ...asms]);
  };

  const enablePdm = async (r: { id: string; entity_type: string }) => {
    await inventoryApi.enableFromPdm({ entity_type: r.entity_type, entity_id: r.id, track_mode: 'quantity' });
    setPdmMode(false); setPdmResults([]); setPdmKeyword('');
    await loadMaterials(search);
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input placeholder="搜索编码/名称" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadMaterials(search)}
          className="border px-2 py-1 rounded text-sm" />
        <button onClick={() => setEditing({ code: '', name: '', track_mode: 'quantity', unit: '个' } as any)}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建物料</button>
        <button onClick={() => setPdmMode(true)}
          className="px-3 py-1.5 bg-green-500 text-white text-sm rounded">从 PDM 启用</button>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-left">编码</th><th className="p-2 text-left">名称</th>
          <th className="p-2 text-left">单位</th><th className="p-2 text-left">来源</th>
          <th className="p-2 text-left">追踪</th><th className="p-2 text-left">安全库存</th>
          <th className="p-2">操作</th></tr></thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.id} className="border-t">
              <td className="p-2">{m.code}</td><td className="p-2">{m.name}</td>
              <td className="p-2">{m.unit}</td>
              <td className="p-2">{m.source_type === 'standalone' ? '非PDM' : m.source_type === 'part' ? '零件' : '部件'}</td>
              <td className="p-2">{m.track_mode === 'batch' ? '批次' : '数量'}</td>
              <td className="p-2">{m.safety_stock ?? '-'}</td>
              <td className="p-2 text-center">
                <button onClick={() => setEditing(m)} className="text-blue-500">编辑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 新建/编辑非 PDM 物料 */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-96 space-y-3">
            <h3 className="font-medium">{editing.id ? '编辑物料' : '新建物料'}</h3>
            <input placeholder="编码" value={editing.code || ''} disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="名称" value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="单位" value={editing.unit || ''}
              onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <select value={editing.track_mode || 'quantity'}
              onChange={(e) => setEditing({ ...editing, track_mode: e.target.value as any })}
              className="w-full border px-2 py-1 rounded text-sm">
              <option value="quantity">按数量</option>
              <option value="batch">按批次</option>
            </select>
            <input placeholder="安全库存（选填）" type="number" value={editing.safety_stock ?? ''}
              onChange={(e) => setEditing({ ...editing, safety_stock: e.target.value ? Number(e.target.value) : null })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm">取消</button>
              <button onClick={saveStandalone} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 从 PDM 启用 */}
      {pdmMode && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-[32rem] space-y-3">
            <h3 className="font-medium">从 PDM 零件/部件启用库存</h3>
            <div className="flex gap-2">
              <input placeholder="搜索零件/部件" value={pdmKeyword}
                onChange={(e) => setPdmKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchPdm()}
                className="flex-1 border px-2 py-1 rounded text-sm" />
              <button onClick={searchPdm} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">搜索</button>
            </div>
            <div className="max-h-60 overflow-auto border rounded">
              {pdmResults.map((r) => (
                <div key={`${r.entity_type}-${r.id}`} className="flex justify-between p-2 border-t text-sm">
                  <span>[{r.entity_type === 'part' ? '零件' : '部件'}] {r.code} {r.name}</span>
                  <button onClick={() => enablePdm(r)} className="text-green-600">启用</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setPdmMode(false)} className="px-3 py-1 text-sm">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

> 实现时核实 `partsApi.list` / `assembliesApi.list` 的入参与返回字段（`res.data.items`），按实际微调。

- [ ] **Step 2: 编译验证**

Run: `cd frontend && npm run build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Inventory/MaterialTab.tsx
git commit -m "feat(inventory): 物料主数据 Tab（新建非PDM + 从PDM启用）"
```

---

### Task B5: 库存查询 Tab（余额表 + 低库存高亮 + 流水抽屉）

**Files:**
- Rewrite: `frontend/src/components/Inventory/StockTab.tsx`

- [ ] **Step 1: 实现库存查询 Tab**

Rewrite `frontend/src/components/Inventory/StockTab.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { StockRow } from '../../types';

export default function StockTab() {
  const { warehouses, loadWarehouses } = useInventoryStore();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [material, setMaterial] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<StockRow | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);

  const load = async () => {
    const res = await inventoryApi.listStock({
      material: material || undefined,
      warehouse_id: warehouseId || undefined,
      low_only: lowOnly || undefined,
    });
    setRows(res.data.items);
  };

  useEffect(() => { loadWarehouses(); load(); /* eslint-disable-next-line */ }, []);

  const openLedger = async (row: StockRow) => {
    setLedgerFor(row);
    const res = await inventoryApi.listLedger({ material_id: row.material_id, warehouse_id: row.warehouse_id });
    setLedger(res.data.items);
  };

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="flex gap-2 mb-3 items-center">
          <input placeholder="物料编码/名称" value={material}
            onChange={(e) => setMaterial(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="border px-2 py-1 rounded text-sm" />
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="border px-2 py-1 rounded text-sm">
            <option value="">全部仓库</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="text-sm flex items-center gap-1">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            仅看低库存
          </label>
          <button onClick={load} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">查询</button>
        </div>
        <table className="w-full text-sm border">
          <thead className="bg-gray-50"><tr>
            <th className="p-2 text-left">物料</th><th className="p-2 text-left">仓库</th>
            <th className="p-2 text-left">批次</th><th className="p-2 text-right">数量</th>
            <th className="p-2 text-right">安全库存</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t ${r.is_low ? 'bg-red-50 text-red-600' : ''}`}>
                <td className="p-2">{r.material_code} {r.material_name}</td>
                <td className="p-2">{whName(r.warehouse_id)}</td>
                <td className="p-2">{r.batch_no || '-'}</td>
                <td className="p-2 text-right">{r.quantity} {r.unit || ''}</td>
                <td className="p-2 text-right">{r.safety_stock ?? '-'}</td>
                <td className="p-2 text-center">
                  <button onClick={() => openLedger(r)} className="text-blue-500">流水</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledgerFor && (
        <div className="w-80 border-l pl-4">
          <div className="flex justify-between mb-2">
            <h3 className="font-medium text-sm">{ledgerFor.material_name} · 库存流水</h3>
            <button onClick={() => setLedgerFor(null)} className="text-gray-400">✕</button>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-auto">
            {ledger.map((l) => (
              <div key={l.id} className="text-xs border rounded p-2">
                <div className="flex justify-between">
                  <span className={l.direction === 'in' ? 'text-green-600' : 'text-red-600'}>
                    {l.direction === 'in' ? '+' : '-'}{l.quantity}
                  </span>
                  <span className="text-gray-400">余 {l.balance_after}</span>
                </div>
                <div className="text-gray-500">{l.doc_number} · {l.operator_name}</div>
              </div>
            ))}
            {ledger.length === 0 && <div className="text-xs text-gray-400">暂无流水</div>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

Run: `cd frontend && npm run build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Inventory/StockTab.tsx
git commit -m "feat(inventory): 库存查询 Tab（余额表 + 低库存高亮 + 流水抽屉）"
```

---

### Task B6: 单据 Tab —— 列表 + 类型自适应编辑弹窗

**Files:**
- Rewrite: `frontend/src/components/Inventory/DocumentTab.tsx`
- Create: `frontend/src/components/Inventory/DocumentEditModal.tsx`

- [ ] **Step 1: 写编辑弹窗（类型自适应）**

Create `frontend/src/components/Inventory/DocumentEditModal.tsx`:
```tsx
import { useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { InvDocType, InvDocLine } from '../../types';

const DOC_LABELS: Record<InvDocType, string> = {
  inbound: '入库单', outbound: '出库单', transfer: '调拨单',
  stocktake: '盘点单', adjustment: '库存调整单',
};

export default function DocumentEditModal({ docType, onClose, onSaved }:
  { docType: InvDocType; onClose: () => void; onSaved: () => void }) {
  const { warehouses, materials, users, loadMaterials } = useInventoryStore();
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [bizType, setBizType] = useState('');
  const [remark, setRemark] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [reviewMode, setReviewMode] = useState<'all' | 'any'>('all');
  const [keeperId, setKeeperId] = useState('');
  const [lines, setLines] = useState<InvDocLine[]>([{ material_id: '', batch_no: '', quantity: 0 }]);

  const isTransfer = docType === 'transfer';
  const isAdjustment = docType === 'adjustment';

  const onWarehouseChange = (id: string) => {
    setWarehouseId(id);
    const wh = warehouses.find((w) => w.id === id);
    if (wh?.default_keeper_id && !keeperId) setKeeperId(wh.default_keeper_id);
  };

  const updateLine = (i: number, patch: Partial<InvDocLine>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines([...lines, { material_id: '', batch_no: '', quantity: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!warehouseId) { alert('请选择仓库'); return; }
    if (isTransfer && !toWarehouseId) { alert('请选择目标仓'); return; }
    const payload = {
      doc_type: docType, biz_type: bizType || undefined,
      warehouse_id: warehouseId, to_warehouse_id: isTransfer ? toWarehouseId : undefined,
      review_mode: reviewMode, keeper_id: keeperId || undefined, remark,
      reviewers: reviewerIds.map((id, seq) => ({ user_id: id, seq })),
      lines: lines.filter((l) => l.material_id).map((l) => ({
        material_id: l.material_id, batch_no: l.batch_no || '',
        quantity: Number(l.quantity) || 0,
        direction: isAdjustment ? (l.direction || 'in') : undefined,
      })),
    };
    await inventoryApi.createDocument(payload);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded w-[44rem] max-h-[88vh] overflow-auto space-y-3">
        <h3 className="font-medium">新建{DOC_LABELS[docType]}</h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">{isTransfer ? '源仓' : '仓库'}
            <select value={warehouseId} onChange={(e) => onWarehouseChange(e.target.value)}
              className="w-full border px-2 py-1 rounded mt-1">
              <option value="">请选择</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          {isTransfer && (
            <label className="text-sm">目标仓
              <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}
                className="w-full border px-2 py-1 rounded mt-1">
                <option value="">请选择</option>
                {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">业务子类
            <input value={bizType} onChange={(e) => setBizType(e.target.value)}
              placeholder="如 采购入库/生产领料" className="w-full border px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-sm">指定库管员
            <select value={keeperId} onChange={(e) => setKeeperId(e.target.value)}
              className="w-full border px-2 py-1 rounded mt-1">
              <option value="">（默认仓库库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* 审批人 */}
        <div className="text-sm">
          审批人（{reviewMode === 'all' ? '会签' : '或签'}）
          <button onClick={() => setReviewMode(reviewMode === 'all' ? 'any' : 'all')}
            className="ml-2 text-blue-500 text-xs">切换</button>
          <select multiple value={reviewerIds}
            onChange={(e) => setReviewerIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            className="w-full border px-2 py-1 rounded mt-1 h-20">
            {users.filter((u) => ['admin', 'engineer'].includes(u.role)).map((u) => (
              <option key={u.id} value={u.id}>{u.real_name}（{u.role}）</option>
            ))}
          </select>
        </div>

        {/* 明细行 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium">明细</span>
            <button onClick={addLine} className="text-blue-500 text-xs">+ 加一行</button>
          </div>
          <table className="w-full text-xs border">
            <thead className="bg-gray-50"><tr>
              <th className="p-1 text-left">物料</th><th className="p-1">批次</th>
              {isAdjustment && <th className="p-1">方向</th>}
              <th className="p-1">数量</th><th className="p-1"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">
                    <select value={l.material_id} onChange={(e) => updateLine(i, { material_id: e.target.value })}
                      className="w-full border px-1 py-0.5 rounded">
                      <option value="">选择物料</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><input value={l.batch_no}
                    onChange={(e) => updateLine(i, { batch_no: e.target.value })}
                    className="w-20 border px-1 py-0.5 rounded" /></td>
                  {isAdjustment && (
                    <td className="p-1">
                      <select value={l.direction || 'in'} onChange={(e) => updateLine(i, { direction: e.target.value as any })}
                        className="border px-1 py-0.5 rounded">
                        <option value="in">盘盈+</option><option value="out">报损-</option>
                      </select>
                    </td>
                  )}
                  <td className="p-1"><input type="number" value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    className="w-20 border px-1 py-0.5 rounded" /></td>
                  <td className="p-1 text-center">
                    <button onClick={() => removeLine(i)} className="text-red-500">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {docType === 'stocktake' && (
            <p className="text-xs text-gray-400 mt-1">盘点单的实盘数在「过账」时由库管员填写。</p>
          )}
        </div>

        <textarea placeholder="备注" value={remark} onChange={(e) => setRemark(e.target.value)}
          className="w-full border px-2 py-1 rounded text-sm" rows={2} />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 text-sm">取消</button>
          <button onClick={save} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存草稿</button>
        </div>
      </div>
    </div>
  );
}
```

> 用 `loadMaterials` 确保物料已加载（在 DocumentTab 挂载时调用）。

- [ ] **Step 2: 写单据列表 Tab**

Rewrite `frontend/src/components/Inventory/DocumentTab.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import DocumentEditModal from './DocumentEditModal';
import DocumentDetail from './DocumentDetail';
import type { InvDocType, InvDocStatus } from '../../types';

const DOC_TYPES: { key: InvDocType; label: string }[] = [
  { key: 'inbound', label: '入库单' }, { key: 'outbound', label: '出库单' },
  { key: 'transfer', label: '调拨单' }, { key: 'stocktake', label: '盘点单' },
  { key: 'adjustment', label: '库存调整单' },
];
const STATUS_LABEL: Record<InvDocStatus, string> = {
  draft: '草稿', reviewing: '审批中', approved: '已审批', posted: '已过账',
  rejected: '已拒绝', cancelled: '已取消',
};
const STATUS_COLOR: Record<InvDocStatus, string> = {
  draft: 'bg-gray-100 text-gray-600', reviewing: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700', posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400',
};

export default function DocumentTab() {
  const { loadMaterials, loadWarehouses } = useInventoryStore();
  const [docs, setDocs] = useState<any[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState<InvDocType | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    const res = await inventoryApi.listDocuments({
      doc_type: typeFilter || undefined, status: statusFilter || undefined,
    });
    setDocs(res.data.items);
  };

  useEffect(() => { loadMaterials(); loadWarehouses(); }, [loadMaterials, loadWarehouses]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, statusFilter]);

  return (
    <div>
      <div className="flex gap-2 mb-3 items-center">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="border px-2 py-1 rounded text-sm">
          <option value="">全部类型</option>
          {DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border px-2 py-1 rounded text-sm">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative ml-auto">
          <button onClick={() => setShowMenu(!showMenu)}
            className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建单据 ▾</button>
          {showMenu && (
            <div className="absolute right-0 mt-1 bg-white border rounded shadow z-10">
              {DOC_TYPES.map((t) => (
                <button key={t.key} onClick={() => { setCreating(t.key); setShowMenu(false); }}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">{t.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-left">单据号</th><th className="p-2 text-left">类型</th>
          <th className="p-2 text-left">状态</th><th className="p-2 text-left">库管员</th>
          <th className="p-2 text-left">创建人</th><th className="p-2 text-left">创建时间</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(d.id)}>
              <td className="p-2 text-blue-600">{d.doc_number}</td>
              <td className="p-2">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</td>
              <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLOR[d.status as InvDocStatus]}`}>
                {STATUS_LABEL[d.status as InvDocStatus]}</span></td>
              <td className="p-2">{d.keeper_name || '-'}</td>
              <td className="p-2">{d.creator_name}</td>
              <td className="p-2">{d.created_at?.slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <DocumentEditModal docType={creating} onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load(); }} />
      )}
      {detailId && (
        <DocumentDetail docId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: 建 DocumentDetail 占位（下一任务实现）**

Create `frontend/src/components/Inventory/DocumentDetail.tsx`:
```tsx
export default function DocumentDetail({ onClose }:
  { docId: string; onClose: () => void; onChanged: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded w-96">
        <p className="text-sm text-gray-500">单据详情（占位）</p>
        <button onClick={onClose} className="mt-3 px-3 py-1 text-sm">关闭</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 编译验证**

Run: `cd frontend && npm run build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Inventory/DocumentTab.tsx frontend/src/components/Inventory/DocumentEditModal.tsx frontend/src/components/Inventory/DocumentDetail.tsx
git commit -m "feat(inventory): 单据列表 + 类型自适应新建弹窗"
```

---

### Task B7: 单据详情 + 操作（提交/审批/改派/过账/取消，盘点填实盘数）

**Files:**
- Rewrite: `frontend/src/components/Inventory/DocumentDetail.tsx`

- [ ] **Step 1: 实现单据详情与操作**

Rewrite `frontend/src/components/Inventory/DocumentDetail.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import type { InvDocument, InvDocStatus } from '../../types';

const STATUS_LABEL: Record<InvDocStatus, string> = {
  draft: '草稿', reviewing: '审批中', approved: '已审批', posted: '已过账',
  rejected: '已拒绝', cancelled: '已取消',
};

export default function DocumentDetail({ docId, onClose, onChanged }:
  { docId: string; onClose: () => void; onChanged: () => void }) {
  const { materials, users } = useInventoryStore();
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<InvDocument | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reassign, setReassign] = useState('');

  const reload = async () => {
    const res = await inventoryApi.getDocument(docId);
    setDoc(res.data);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [docId]);

  if (!doc) return null;
  const matName = (id: string) => {
    const m = materials.find((x) => x.id === id);
    return m ? `${m.code} ${m.name}` : id;
  };
  const isAdmin = user?.role === 'admin';
  const isKeeper = doc.keeper_id === user?.id || isAdmin;
  const isCreator = doc.creator_name === user?.real_name || isAdmin;

  const act = async (fn: () => Promise<any>) => { await fn(); await reload(); onChanged(); };

  const doPost = async () => {
    const payload = doc.doc_type === 'stocktake'
      ? { counts: (doc.lines || []).map((l) => ({ line_id: l.id!, counted_quantity: counts[l.id!] ?? 0 })) }
      : {};
    await act(() => inventoryApi.post(doc.id, payload));
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded w-[46rem] max-h-[90vh] overflow-auto space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">{doc.doc_number}
            <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">{STATUS_LABEL[doc.status]}</span>
          </h3>
          <button onClick={onClose} className="text-gray-400">✕</button>
        </div>

        <div className="text-sm text-gray-600">库管员：{doc.keeper_name || '未指定'} · 创建人：{doc.creator_name}</div>

        {/* 明细 */}
        <table className="w-full text-xs border">
          <thead className="bg-gray-50"><tr>
            <th className="p-1 text-left">物料</th><th className="p-1">批次</th>
            {doc.doc_type === 'adjustment' && <th className="p-1">方向</th>}
            {doc.doc_type === 'stocktake' && <th className="p-1">账面</th>}
            {doc.doc_type === 'stocktake' && <th className="p-1">实盘</th>}
            <th className="p-1">数量</th></tr></thead>
          <tbody>
            {(doc.lines || []).map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-1">{matName(l.material_id)}</td>
                <td className="p-1 text-center">{l.batch_no || '-'}</td>
                {doc.doc_type === 'adjustment' && <td className="p-1 text-center">{l.direction === 'out' ? '报损-' : '盘盈+'}</td>}
                {doc.doc_type === 'stocktake' && <td className="p-1 text-center">{l.book_quantity ?? '-'}</td>}
                {doc.doc_type === 'stocktake' && (
                  <td className="p-1 text-center">
                    {doc.status === 'approved' && isKeeper ? (
                      <input type="number" value={counts[l.id!] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [l.id!]: Number(e.target.value) })}
                        className="w-16 border px-1 rounded" />
                    ) : (l.counted_quantity ?? '-')}
                  </td>
                )}
                <td className="p-1 text-center">{l.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 审批记录 + 状态日志 */}
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="font-medium mb-1">审批记录</div>
            {(doc.review_records || []).map((r: any) => (
              <div key={r.id} className="border-b py-1">{r.reviewer_name}：{r.decision} {r.comment}</div>
            ))}
            {(doc.review_records || []).length === 0 && <div className="text-gray-400">暂无</div>}
          </div>
          <div>
            <div className="font-medium mb-1">状态流转</div>
            {(doc.status_logs || []).map((s: any) => (
              <div key={s.id} className="border-b py-1">{s.from_status || '—'}→{s.to_status} · {s.operator_name}</div>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2 justify-end border-t pt-3">
          {doc.status === 'draft' && isCreator && (
            <button onClick={() => act(() => inventoryApi.submit(doc.id))}
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded">提交审批</button>
          )}
          {doc.status === 'draft' && isCreator && (
            <button onClick={() => act(() => inventoryApi.deleteDocument(doc.id)).then(onClose)}
              className="px-3 py-1 text-red-500 text-sm">删除</button>
          )}
          {doc.status === 'reviewing' && (doc.reviewers || []).some((r) => r.user_id === user?.id) && (
            <>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'approved' }))}
                className="px-3 py-1 bg-green-500 text-white text-sm rounded">通过</button>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'returned' }))}
                className="px-3 py-1 bg-yellow-500 text-white text-sm rounded">退回</button>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'rejected' }))}
                className="px-3 py-1 bg-red-500 text-white text-sm rounded">拒绝</button>
            </>
          )}
          {doc.status === 'reviewing' && isCreator && (
            <button onClick={() => act(() => inventoryApi.withdraw(doc.id))}
              className="px-3 py-1 text-sm border rounded">撤回</button>
          )}
          {doc.status === 'approved' && (
            <>
              <select value={reassign} onChange={(e) => setReassign(e.target.value)}
                className="border px-2 py-1 rounded text-sm">
                <option value="">改派库管员…</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </select>
              {reassign && (
                <button onClick={() => act(() => inventoryApi.assignKeeper(doc.id, reassign)).then(() => setReassign(''))}
                  className="px-3 py-1 text-sm border rounded">确认改派</button>
              )}
              {isKeeper && (
                <button onClick={doPost}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded">过账</button>
              )}
              <button onClick={() => act(() => inventoryApi.cancel(doc.id))}
                className="px-3 py-1 text-sm border rounded">取消</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

> 实现时核实 `useAuthStore` 暴露的当前用户字段名（`user.id` / `user.role` / `user.real_name`）；若 store 只存 token，则从 `authApi.getCurrentUser` 取或在 auth store 增加 user 缓存。`isCreator` 用 real_name 比对是兜底，优先用 user.id 比对（详情接口可在 `_doc_brief` 增加 `creator_id` 字段——如需，回 Task A6 的 `_doc_brief` 加 `"creator_id": str(d.creator_id)` 并在前端改用 id 比对）。

- [ ] **Step 2: 编译验证**

Run: `cd frontend && npm run build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Inventory/DocumentDetail.tsx
git commit -m "feat(inventory): 单据详情 + 全状态操作（审批/改派/过账，盘点填实盘）"
```

---

### Task B8: 端到端手测 + 收尾

**Files:** 无（验证 + 文档）

- [ ] **Step 1: 起本地环境**

Run（参考项目 README/docker-compose）: `docker-compose up -d --build backend` 重建后端镜像（新增模型需建表），前端 `cd frontend && npm run dev`。

- [ ] **Step 2: 手测全链路（逐项打勾）**

- [ ] 仓库：建「原料库」「成品库」，给原料库设默认库管员
- [ ] 物料：建非 PDM 物料「螺丝/个/数量」；从 PDM 启用一个零件
- [ ] 入库单：建单（目标仓=原料库，库管员自动带出）→ 提交（无审批人→自动 approved）→ 库管员过账 → 库存查询见 +10
- [ ] 出库单：建单数量超库存 → 过账被拒（提示库存不足）；改小后过账成功，余额减少
- [ ] 调拨单：原料库→成品库，过账后两仓余额此消彼长，流水 2 条
- [ ] 盘点单：建单 → approved → 过账界面填实盘数 → 余额校正
- [ ] 调整单：盘盈 +5 / 报损 -2，余额相应变化
- [ ] 审批流：建带审批人的单 → 审批人通过 → approved；退回 → 回 draft
- [ ] 改派：approved 单据改派库管员，新库管员可过账
- [ ] 低库存：物料设安全库存高于现有，库存查询红色高亮 + 「仅看低库存」筛选
- [ ] AI 助手：问「螺丝还有多少库存」，助手能取数回答

- [ ] **Step 3: 跑后端全量测试确认无回归**

Run: `cd backend && python -m pytest tests/ -v`
Expected: 全绿。

- [ ] **Step 4: 更新记忆与文档**

- 在 `C:\Users\guojun\.claude\projects\D--OpenCode-myPDM\memory\` 新增一条 project 记忆，记录库存模块已完成、所在分支、部署需重建后端镜像（建表），并在 `MEMORY.md` 加一行索引。
- 标记设计文档 `docs/superpowers/specs/2026-06-15-inventory-management-design.md` 状态为「已实现」。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(inventory): 端到端手测通过，库存模块一期完成"
```

---

## 自查（Spec 覆盖核对）

- ✅ 8 张表 → Task A1
- ✅ 数量+批次追踪（`track_mode` + `batch_no`）→ A1/A3
- ✅ 多仓库 + 调拨 → A1/A4（transfer 双边流水）
- ✅ 物料统一表（PDM + standalone）→ A3（`create_material` / `enable_material_from_pdm`）
- ✅ 5 类单据 + 统一过账引擎 → A4（`post_document` 全类型分支）
- ✅ 审批闭环（reviewers/review_mode/记录/日志）→ A5
- ✅ 发起人≠库管员 + 默认库管员 + 改派 + 过账权限 → A5（`assign_keeper`、`create_document` 默认带出）/ A6（post 权限校验）
- ✅ 状态机 + 非法流转拦截 → A5（`_ALLOWED_TRANSITIONS` + 测试）
- ✅ 余额不足拒绝 + 整单回滚 → A4（测试 `test_outbound_insufficient_stock_rejected`）
- ✅ 行锁（`with_for_update`，PG 生效）→ A4
- ✅ API 全端点 → A6
- ✅ AI 助手联动 → A7
- ✅ 权限矩阵（READ/WRITE/MASTER_ROLES + keeper/reviewer 校验）→ A6
- ✅ 前端 4 Tab + 类型自适应单据 + 详情操作 → B2–B7
- ✅ 导航上线 → B2
- ✅ 数据库迁移（init.sql + create_all）→ A1
- ⚠️ 操作日志写 `operation_logs`：spec 第 9 节列为关键动作记录。**本计划未单独建任务**——如需，在 A5 各状态流转函数后补写 `OperationLog`（参考现有 `crud.py` 写日志方式）。属低风险增强，可作为 A5 的可选补充或二期。
```
