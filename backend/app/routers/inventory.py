"""库存管理 - API Router"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.models_inventory import InventoryStock, InventoryMaterial, InventoryLedger, InventoryDocumentLine
from app import crud_inventory
from app.schemas_inventory import (
    WarehouseCreate, WarehouseEdit, MaterialCreate, MaterialEdit, MaterialEnableFromPDM,
    DocumentCreate, DocumentEdit, DocumentListParams, ReviewAction, AssignKeeperAction, PostAction,
)
from ..permissions import require_permission, enforce_object_policy

router = APIRouter(prefix="/inventory", tags=["库存管理"])


def _enforce_doc_participant(user: User, doc) -> None:
    """单据级门禁：admin / 创建者 / 保管人 / 指定审批人。

    与 crud_inventory.list_documents 的行级可见性同口径 —— 否则拿到 UUID 就能
    绕过列表过滤读写他人单据。
    """
    enforce_object_policy("inventory_doc_participant_or_admin", user, doc)


# ──────────── 仓库 ────────────
@router.get("/warehouses")
async def list_warehouses(db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.warehouse:read"))):
    items = crud_inventory.list_warehouses(db)
    return {"items": [_wh_dict(w) for w in items]}


@router.post("/warehouses")
async def create_warehouse(data: WarehouseCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.warehouse:write"))):
    return _wh_dict(crud_inventory.create_warehouse(db, data))


@router.put("/warehouses/{wh_id}")
async def update_warehouse(wh_id: uuid.UUID, data: WarehouseEdit, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.warehouse:write"))):
    wh = crud_inventory.get_warehouse(db, wh_id)
    return _wh_dict(crud_inventory.update_warehouse(db, wh, data))


@router.delete("/warehouses/{wh_id}")
async def delete_warehouse(wh_id: uuid.UUID, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.warehouse:delete"))):
    crud_inventory.delete_warehouse(db, crud_inventory.get_warehouse(db, wh_id))
    return {"detail": "已删除"}


# ──────────── 物料 ────────────
@router.get("/materials")
async def list_materials(search: str = Query(None), source_type: str = Query(None),
                         track_mode: str = Query(None), db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.material:read"))):
    items = crud_inventory.list_materials(db, search, source_type, track_mode)
    return {"items": [_mat_dict(m) for m in items]}


@router.post("/materials")
async def create_material(data: MaterialCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.material:write"))):
    return _mat_dict(crud_inventory.create_material(db, data))


@router.post("/materials/enable-from-pdm")
async def enable_from_pdm(data: MaterialEnableFromPDM, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.material:enable_from_pdm"))):
    return _mat_dict(crud_inventory.enable_material_from_pdm(db, data))


@router.put("/materials/{m_id}")
async def update_material(m_id: uuid.UUID, data: MaterialEdit, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.material:write"))):
    m = crud_inventory.get_material(db, m_id)
    return _mat_dict(crud_inventory.update_material(db, m, data))


@router.delete("/materials/{m_id}")
async def delete_material(m_id: uuid.UUID, db: Session = Depends(get_db),
                           current_user: User = Depends(require_permission("inventory.material:delete"))):
    crud_inventory.delete_material(db, crud_inventory.get_material(db, m_id))
    return {"detail": "已删除"}


# ──────────── 库存查询 ────────────
@router.get("/stock")
async def list_stock(material: str = Query(None), warehouse_id: uuid.UUID = Query(None),
                     low_only: bool = Query(False), db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("inventory.stock:read"))):
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
                      current_user: User = Depends(require_permission("inventory.stock:read"))):
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
        "doc_id": str(r.doc_id) if r.doc_id else None,
        "operator_name": r.operator_name, "created_at": r.created_at,
    } for r in rows]}


# ──────────── 单据 ────────────
@router.get("/documents")
async def list_documents(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                         doc_type: str = Query(None), status: str = Query(None), search: str = Query(None),
                         db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("inventory.doc:read"))):
    params = DocumentListParams(page=page, page_size=page_size, doc_type=doc_type, status=status, search=search)
    docs, total = crud_inventory.list_documents(db, params, current_user)
    items = [_doc_brief(db, d) for d in docs]
    # 批量取每张单据的物料摘要（供前端按物料/单据内容搜索），避免逐单 N+1
    doc_ids = [d.id for d in docs]
    if doc_ids:
        rows = (
            db.query(InventoryDocumentLine.doc_id, InventoryMaterial.code, InventoryMaterial.name)
            .join(InventoryMaterial, InventoryDocumentLine.material_id == InventoryMaterial.id)
            .filter(InventoryDocumentLine.doc_id.in_(doc_ids))
            .all()
        )
        mat_map: dict = {}
        for did, code, name in rows:
            mat_map.setdefault(did, []).append(f"{code} {name}")
        for it, d in zip(items, docs):
            it["materials"] = " ".join(mat_map.get(d.id, []))
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/documents")
async def create_document(data: DocumentCreate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.doc:write"))):
    doc = crud_inventory.create_document(db, data, current_user.id)
    return _doc_detail(db, doc)


@router.get("/documents/{doc_id}")
async def get_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("inventory.doc:read"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    return _doc_detail(db, doc)


@router.put("/documents/{doc_id}")
async def update_document(doc_id: uuid.UUID, data: DocumentEdit, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.doc:write"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    return _doc_detail(db, crud_inventory.update_document(db, doc, data))


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.doc:delete"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    crud_inventory.delete_document(db, doc)
    return {"detail": "已删除"}


@router.post("/documents/{doc_id}/submit")
async def submit_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.doc:submit_withdraw_approve"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    return _doc_detail(db, crud_inventory.submit_document(db, doc, current_user))


@router.post("/documents/{doc_id}/withdraw")
async def withdraw_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                            current_user: User = Depends(require_permission("inventory.doc:submit_withdraw_approve"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    return _doc_detail(db, crud_inventory.withdraw_document(db, doc, current_user))


@router.post("/documents/{doc_id}/review")
async def review_document(doc_id: uuid.UUID, data: ReviewAction, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("inventory.doc:submit_withdraw_approve"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    return _doc_detail(db, crud_inventory.review_document(db, doc, current_user, data.decision, data.comment or ""))


@router.post("/documents/{doc_id}/assign-keeper")
async def assign_keeper(doc_id: uuid.UUID, data: AssignKeeperAction, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("inventory.doc:submit_withdraw_approve"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
    keeper = db.query(User).filter(User.id == uuid.UUID(data.keeper_id)).first()
    if not keeper:
        raise HTTPException(status_code=404, detail="指定用户不存在")
    return _doc_detail(db, crud_inventory.assign_keeper(db, doc, keeper))


@router.post("/documents/{doc_id}/post")
async def post_document(doc_id: uuid.UUID, data: PostAction = None, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("inventory.doc:post"))):
    doc = crud_inventory.get_document(db, doc_id)
    # 仅指定库管员或管理员可过账（由 inventory_keeper_or_admin 策略统一门控）
    enforce_object_policy("inventory_keeper_or_admin", current_user, doc)
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
                          current_user: User = Depends(require_permission("inventory.doc:submit_withdraw_approve"))):
    doc = crud_inventory.get_document(db, doc_id)
    _enforce_doc_participant(current_user, doc)
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
            "keeper_id": str(d.keeper_id) if d.keeper_id else None,
            "keeper_name": d.keeper_name, "creator_id": str(d.creator_id),
            "creator_name": creator.real_name if creator else "",
            "reviewers": d.reviewers or [],
            "created_at": d.created_at, "updated_at": d.updated_at}


def _doc_detail(db, d):
    base = _doc_brief(db, d)
    lines = crud_inventory.get_document_lines(db, d.id)

    def _book_qty(line):
        # 已冻结的账面量（过账后固化）直接返回；未过账的盘点单实时查询当前库存作为账面量
        if line.book_quantity is not None:
            return float(line.book_quantity)
        if d.doc_type == "stocktake" and d.status != "posted":
            stock = db.query(InventoryStock).filter(
                InventoryStock.material_id == line.material_id,
                InventoryStock.warehouse_id == d.warehouse_id,
                InventoryStock.batch_no == (line.batch_no or ""),
            ).first()
            if stock and stock.quantity is not None:
                return float(stock.quantity)
        return None

    base["lines"] = [{
        "id": str(l.id), "material_id": str(l.material_id), "batch_no": l.batch_no,
        "quantity": float(l.quantity), "direction": l.direction,
        "book_quantity": _book_qty(l),
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
