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
