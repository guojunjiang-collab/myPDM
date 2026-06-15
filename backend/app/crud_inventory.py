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
    except Exception:
        db.rollback()
        raise
