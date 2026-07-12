"""库存管理 - CRUD + 过账引擎"""
import uuid
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from fastapi import HTTPException

from app.models import User
from app.models_parts import PartMaster, PartRevision
from app.models_inventory import (
    Warehouse, InventoryMaterial, InventoryStock, InventoryLedger,
    InventoryDocument, InventoryDocumentLine, InventoryReviewRecord, InventoryStatusLog,
)
from app.schemas_inventory import (
    WarehouseCreate, WarehouseEdit, MaterialCreate, MaterialEdit, MaterialEnableFromPDM,
    DocumentCreate, DocumentEdit, DocumentListParams,
)
from . import notifications as _notif

# ── 状态流转规则 ──
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing", "approved"},
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
    model = PartMaster
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
    # 版本在最新有效 revision 上（PartMaster 本身无 version 字段）
    latest_rev = (
        db.query(PartRevision)
        .filter(PartRevision.master_id == entity.id, PartRevision.deleted_at.is_(None))
        .order_by(PartRevision.created_at.desc())
        .first()
    )
    version = latest_rev.version if latest_rev else "A"
    m = InventoryMaterial(
        code=f"{entity.code}_{version}", name=entity.name, spec=getattr(entity, "spec", None),
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
        # 站内通知：单据过账
        _notif.create_notifications(
            db, recipient_ids=[doc.creator_id], sender_id=operator.id,
            event_type="inv_doc_posted", title=f"单据 {doc.doc_number} 已过账",
            body=None, target_type="inventory_document", target_id=doc.id,
            exclude_sender=True,
        )
        return doc
    except Exception:
        db.rollback()
        raise


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
        result = _change_status(db, doc, "approved", user, "无审批人，自动批准")
        _notif.create_notifications(
            db, recipient_ids=[result.creator_id], sender_id=None,
            event_type="inv_doc_approved", title=f"单据 {result.doc_number} 审批通过",
            body=None, target_type="inventory_document", target_id=result.id, exclude_sender=True,
        )
        return result
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
        result = _change_status(db, doc, "approved", reviewer, "审批通过")
        # 站内通知：单据审批通过
        _notif.create_notifications(
            db, recipient_ids=[doc.creator_id], sender_id=reviewer.id,
            event_type="inv_doc_approved", title=f"单据 {doc.doc_number} 审批通过",
            body=None, target_type="inventory_document", target_id=doc.id,
            exclude_sender=True,
        )
        return result
    if decision == "rejected":
        result = _change_status(db, doc, "rejected", reviewer, comment or "驳回")
        # 站内通知：单据审批驳回
        _notif.create_notifications(
            db, recipient_ids=[doc.creator_id], sender_id=reviewer.id,
            event_type="inv_doc_rejected", title=f"单据 {doc.doc_number} 审批驳回",
            body=None, target_type="inventory_document", target_id=doc.id,
            exclude_sender=True,
        )
        return result
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
