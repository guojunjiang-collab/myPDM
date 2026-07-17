"""件号+版本 批量匹配 PDM 零部件（CAD 工作台自动匹配）测试"""
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User
from app import models_parts, crud_parts


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


def _make_part(db, code, versions):
    """创建零件及多个版本。versions: [(version, check_out_user_id)]，
    created_at 递增以保证「最新版本 = created_at 最新」的确定性。"""
    master = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=f"零件{code}")
    db.add(master)
    base = datetime(2026, 1, 1)
    revs = []
    for i, (version, co_user) in enumerate(versions):
        rev = models_parts.PartRevision(
            id=uuid.uuid4(),
            master_id=master.id,
            version=version,
            check_out_user_id=co_user,
            created_at=base + timedelta(days=i),
        )
        db.add(rev)
        revs.append(rev)
    db.commit()
    return master, revs


def test_exact_match(db):
    user = _make_user(db)
    master, revs = _make_part(db, "P-001", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-001", "version": "a"}], user.id)
    assert results[0]["match_status"] == "matched"
    assert results[0]["revision_id"] == revs[0].id
    assert results[0]["matched_version"] == "A"
    assert results[0]["name"] == "零件P-001"
    assert results[0]["checkout_status"] == "not_checked_out"


def test_empty_version_matches_latest(db):
    user = _make_user(db)
    master, revs = _make_part(db, "P-002", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-002", "version": ""}], user.id)
    assert results[0]["match_status"] == "matched"
    assert results[0]["revision_id"] == revs[1].id
    assert results[0]["matched_version"] == "B"


def test_version_not_found_is_conflict(db):
    user = _make_user(db)
    _make_part(db, "P-003", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-003", "version": "C"}], user.id)
    assert results[0]["match_status"] == "conflict"
    assert results[0]["revision_id"] is None
    assert results[0]["latest_version"] == "B"


def test_code_not_found_is_new(db):
    user = _make_user(db)
    results = crud_parts.match_cad_bom_items(db, [{"code": "NOT-EXIST", "version": "A"}], user.id)
    assert results[0]["match_status"] == "new"
    assert results[0]["master_id"] is None


def test_checkout_status(db):
    me = _make_user(db)
    other = _make_user(db)
    _make_part(db, "P-004", [("A", me.id)])
    _make_part(db, "P-005", [("A", other.id)])
    results = crud_parts.match_cad_bom_items(
        db,
        [{"code": "P-004", "version": "A"}, {"code": "P-005", "version": "A"}],
        me.id,
    )
    assert results[0]["checkout_status"] == "checked_out"
    assert results[1]["checkout_status"] == "other_checked_out"


def test_endpoint(db):
    user = _make_user(db)
    _make_part(db, "P-006", [("A", None)])
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    try:
        client = TestClient(app)
        r = client.post("/api/parts/cad/bom-match", json={
            "items": [{"code": "P-006", "version": "A"}, {"code": "X", "version": None}]
        })
        assert r.status_code == 200
        body = r.json()
        assert len(body["results"]) == 2
        assert body["results"][0]["match_status"] == "matched"
        assert body["results"][1]["match_status"] == "new"
    finally:
        app.dependency_overrides.clear()
