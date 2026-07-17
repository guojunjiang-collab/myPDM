"""CATIA 装配直接子项 BOM 同步到 PDM 测试"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User, BOMItem
from app import models_parts, crud_parts


IDENTITY_MM = [
    1.0, 0.0, 0.0, 100.0,
    0.0, 1.0, 0.0, 200.0,
    0.0, 0.0, 1.0, 300.0,
    0.0, 0.0, 0.0, 1.0,
]


def _make_user(db, role="engineer"):
    user = User(
        id=uuid.uuid4(),
        username=f"u_{uuid.uuid4().hex[:8]}",
        password_hash="x",
        real_name="测试用户",
        role=role,
    )
    db.add(user)
    db.commit()
    return user


def _make_part(db, user, code, name="零件"):
    """通过 create_part_master 创建零件（自动建版本A+迭代1）"""
    master = crud_parts.create_part_master(db, {"code": code, "name": name}, user.id)
    rev = (
        db.query(models_parts.PartRevision)
        .filter(models_parts.PartRevision.master_id == master.id)
        .first()
    )
    return master, rev


def test_sync_creates_new_part_and_bom_item(db):
    user = _make_user(db)
    _, parent_rev = _make_part(db, user, "ASM-001", "装配")
    result = crud_parts.sync_cad_bom_children(db, parent_rev.id, [
        {
            "code": "P-NEW",
            "name": "新零件",
            "spec": "M6",
            "quantity": 3,
            "instances": [
                {"matrix": IDENTITY_MM, "label": "P-NEW.1"},
                {"matrix": IDENTITY_MM, "label": "P-NEW.2"},
            ],
        }
    ], user.id)
    assert result["created_parts"] == ["P-NEW"]
    assert result["created_items"] == 1
    item = (
        db.query(BOMItem)
        .filter(BOMItem.parent_revision_id == parent_rev.id, BOMItem.deleted_at.is_(None))
        .first()
    )
    assert item.quantity == 3
    assert len(item.cad_instances) == 2
    # 平移分量 mm → m
    assert item.cad_instances[0]["matrix"][3] == pytest.approx(0.1)
    assert item.cad_instances[0]["matrix"][7] == pytest.approx(0.2)
    assert item.cad_instances[0]["matrix"][11] == pytest.approx(0.3)
    assert item.cad_instances[0]["source"] == "catia"
    assert item.cad_instances[0]["label"] == "P-NEW.1"
    # 新建零件已存在且名称正确
    master = (
        db.query(models_parts.PartMaster)
        .filter(models_parts.PartMaster.code == "P-NEW")
        .first()
    )
    assert master is not None
    assert master.name == "新零件"


def test_sync_updates_existing_item_and_keeps_step_matrices(db):
    user = _make_user(db)
    _, parent_rev = _make_part(db, user, "ASM-002", "装配")
    _, child_rev = _make_part(db, user, "P-OLD", "旧零件")
    item = BOMItem(
        parent_revision_id=parent_rev.id,
        child_revision_id=child_rev.id,
        quantity=1,
        cad_instances=[
            {"matrix": [1.0] * 16, "source": "step", "label": "old-step"},
            {"matrix": [2.0] * 16, "source": "catia", "label": "old-catia"},
        ],
    )
    db.add(item)
    db.commit()
    result = crud_parts.sync_cad_bom_children(db, parent_rev.id, [
        {
            "code": "P-OLD",
            "quantity": 5,
            "instances": [{"matrix": IDENTITY_MM, "label": "P-OLD.1"}],
        }
    ], user.id)
    assert result["updated_items"] == 1
    assert result["created_items"] == 0
    db.refresh(item)
    assert item.quantity == 5
    sources = [c["source"] for c in item.cad_instances]
    assert sources.count("step") == 1  # step 矩阵保留
    assert sources.count("catia") == 1  # catia 矩阵替换为新的
    catia_entry = next(c for c in item.cad_instances if c["source"] == "catia")
    assert catia_entry["label"] == "P-OLD.1"


def test_sync_reports_extra_in_pdm(db):
    user = _make_user(db)
    _, parent_rev = _make_part(db, user, "ASM-003", "装配")
    _, child_rev = _make_part(db, user, "P-EXTRA", "PDM多余零件")
    item = BOMItem(parent_revision_id=parent_rev.id, child_revision_id=child_rev.id, quantity=1)
    db.add(item)
    db.commit()
    result = crud_parts.sync_cad_bom_children(db, parent_rev.id, [
        {"code": "P-PUSHED", "name": "推送零件", "quantity": 1, "instances": []},
    ], user.id)
    assert result["extra_in_pdm"] == ["P-EXTRA"]
    # 多余子项保留未删除
    db.refresh(item)
    assert item.deleted_at is None


def test_sync_skips_null_matrix_instances(db):
    user = _make_user(db)
    _, parent_rev = _make_part(db, user, "ASM-004", "装配")
    crud_parts.sync_cad_bom_children(db, parent_rev.id, [
        {
            "code": "P-NOMAT",
            "name": "无矩阵零件",
            "quantity": 2,
            "instances": [{"matrix": None, "label": "x.1"}, {"matrix": None, "label": "x.2"}],
        }
    ], user.id)
    item = (
        db.query(BOMItem)
        .filter(BOMItem.parent_revision_id == parent_rev.id, BOMItem.deleted_at.is_(None))
        .first()
    )
    assert item is not None
    assert item.quantity == 2
    assert (item.cad_instances or []) == []


def test_sync_endpoint(db):
    user = _make_user(db)
    _, parent_rev = _make_part(db, user, "ASM-005", "装配")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    try:
        client = TestClient(app)
        r = client.post(f"/api/parts/revisions/{parent_rev.id}/cad/bom-sync", json={
            "children": [
                {"code": "P-EP", "name": "端点零件", "quantity": 1,
                 "instances": [{"matrix": IDENTITY_MM, "label": "P-EP.1"}]},
            ]
        })
        assert r.status_code == 200
        body = r.json()
        assert body["created_parts"] == ["P-EP"]
        assert body["created_items"] == 1
    finally:
        app.dependency_overrides.clear()
