import uuid
import pytest
from fastapi.testclient import TestClient
from app.models import User, Part
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


def _make_part(db, code, version="A"):
    part = Part(id=uuid.uuid4(), code=code, name=f"Test {code}",
                version=version, status="draft")
    db.add(part); db.commit(); db.refresh(part)
    return part


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
    r = c.post("/api/parts/", json={"code": f"PERM_{role}_{uuid.uuid4().hex[:4]}", "name": "Test", "version": "A"})
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
    part = _make_part(db, f"GET_{role}", "A")
    c = _make_test_client(db, user)
    r = c.get(f"/api/parts/{part.id}")
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 200), ("production", 403), ("guest", 403)
])
def test_parts_update_role_gate(db, role, expect):
    user = _make_user(db, role)
    part = _make_part(db, f"UPD_{role}", "A")
    c = _make_test_client(db, user)
    r = c.put(f"/api/parts/{part.id}", json={"name": "Updated"})
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [
    ("admin", 200), ("engineer", 403), ("production", 403), ("guest", 403)
])
def test_parts_delete_admin_only(db, role, expect):
    user = _make_user(db, role)
    part = _make_part(db, f"DEL_{role}", "A")
    c = _make_test_client(db, user)
    r = c.delete(f"/api/parts/{part.id}")
    assert r.status_code in ({expect} if expect == 200 else {expect, 400})
