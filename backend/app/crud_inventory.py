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
