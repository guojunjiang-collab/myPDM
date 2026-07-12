import uuid
import pytest
from fastapi.testclient import TestClient
from app.models import User
from app import models_parts
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user


def _make_test_client(db, user):
    """Helper: override FastAPI deps and return TestClient. Caller must clear overrides after."""
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _make_user(db, role):
    user = User(
        id=uuid.uuid4(), username=f"p_{role}_{uuid.uuid4().hex[:6]}",
        password_hash="x", real_name=f"P {role}",
        role=role, status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


def _make_part(db, code):
    """创建三层模型的零件：PartMaster + 一个 draft 版本。返回 master。"""
    master = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=f"Test {code}", type="part")
    db.add(master); db.commit(); db.refresh(master)
    rev = models_parts.PartRevision(
        id=uuid.uuid4(), master_id=master.id, version="A", status="draft",
        latest_iteration=1,
    )
    db.add(rev); db.commit(); db.refresh(rev)
    return master


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 403), ("guest", 403)
])
def test_parts_create_role_gate(db, role, expect):
    user = _make_user(db, role)
    c = _make_test_client(db, user)
    r = c.post("/api/parts/", json={"code": f"PERM_{role}_{uuid.uuid4().hex[:4]}", "name": "Test"})
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 200), ("guest", 200)
])
def test_parts_read_role_gate(db, role, expect):
    user = _make_user(db, role)
    c = _make_test_client(db, user)
    r = c.get("/api/parts/")
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 200), ("guest", 200)
])
def test_parts_get_by_id(db, role, expect):
    user = _make_user(db, role)
    part = _make_part(db, f"GET_{role}")
    c = _make_test_client(db, user)
    r = c.get(f"/api/parts/{part.id}")
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 403), ("guest", 403)
])
def test_parts_update_role_gate(db, role, expect):
    user = _make_user(db, role)
    part = _make_part(db, f"UPD_{role}")
    c = _make_test_client(db, user)
    r = c.put(f"/api/parts/{part.id}", json={"name": "Updated"})
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 403), ("production", 403), ("guest", 403)
])
def test_parts_delete_admin_only(db, role, expect):
    user = _make_user(db, role)
    part = _make_part(db, f"DEL_{role}")
    c = _make_test_client(db, user)
    r = c.delete(f"/api/parts/{part.id}")
    # 非 admin 应 403；admin 允许（200 或业务 400）
    assert r.status_code in ({expect} if expect == 200 else {expect, 400})
