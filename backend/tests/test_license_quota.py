"""用户数配额校验测试。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import install_license


@pytest.fixture
def client(db):
    admin = User(id=uuid.uuid4(), username="admin1", password_hash="x",
                 real_name="管理员", role="admin", status="active")
    db.add(admin); db.commit(); db.refresh(admin)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: admin
    yield TestClient(app), admin
    app.dependency_overrides.clear()


def new_user_body(name):
    return {"username": name, "password": "pw123456", "real_name": "新人",
            "role": "engineer", "status": "active"}


def test_create_user_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    c, _ = client
    resp = c.post("/api/users/", json=new_user_body("newbie"))
    assert resp.status_code == 403
    assert "授权用户数上限" in resp.json()["detail"]


def test_create_user_allowed_below_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=5)
    c, _ = client
    assert c.post("/api/users/", json=new_user_body("newbie2")).status_code == 200


def test_enabling_disabled_user_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    off = User(id=uuid.uuid4(), username="off1", password_hash="x",
               real_name="停用", role="engineer", status="disabled")
    db.add(off); db.commit()
    c, _ = client
    resp = c.put(f"/api/users/{off.id}", json={"status": "active"})
    assert resp.status_code == 403


def test_other_updates_not_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    off = User(id=uuid.uuid4(), username="off2", password_hash="x",
               real_name="停用", role="engineer", status="disabled")
    db.add(off); db.commit()
    c, _ = client
    assert c.put(f"/api/users/{off.id}", json={"real_name": "改名"}).status_code == 200


def test_existing_active_users_unaffected(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    c, _ = client
    assert c.get("/api/users/").status_code == 200
