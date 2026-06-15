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
