"""许可中间件拦截测试。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.licensing import state as st
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import install_license


@pytest.fixture
def client(db):
    user = User(id=uuid.uuid4(), username="eng", password_hash="x",
                real_name="工程师", role="engineer", status="active")
    db.add(user); db.commit(); db.refresh(user)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_write_allowed_when_valid(client):
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH01", "name": "原料库", "type": "raw"})
    assert resp.status_code == 200


def test_write_blocked_when_readonly(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=0)
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH02", "name": "x", "type": "raw"})
    assert resp.status_code == 403
    assert resp.json()["license_state"] == "READONLY"


def test_read_allowed_when_readonly(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=0)
    c, _ = client
    assert c.get("/api/inventory/stock").status_code == 200


def test_write_blocked_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH03", "name": "x", "type": "raw"})
    assert resp.status_code == 403
    assert resp.json()["license_state"] == "MISSING"
    st.invalidate()


def test_grace_allows_write_and_sets_warning_header(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=99999)
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH04", "name": "x", "type": "raw"})
    assert resp.status_code == 200
    assert "X-License-Warning" in resp.headers


def test_gated_module_blocks_get_and_post(client, monkeypatch):
    install_license(monkeypatch, modules=())
    c, _ = client
    for resp in (c.get("/api/inventory/stock"),
                 c.post("/api/inventory/warehouses",
                        json={"code": "WH05", "name": "x", "type": "raw"})):
        assert resp.status_code == 403
        assert resp.json()["license_state"] == "MODULE_DENIED"
        assert resp.json()["module"] == "inventory"


def test_gated_change_module(client, monkeypatch):
    install_license(monkeypatch, modules=("inventory", "project"))
    c, _ = client
    assert c.get("/api/ecrs").status_code == 403
    assert c.get("/api/inventory/stock").status_code == 200


def test_notifications_never_gated(client, monkeypatch):
    install_license(monkeypatch, modules=())
    c, _ = client
    assert c.get("/api/notifications/unread-count").status_code != 403


def test_license_endpoints_whitelisted_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    assert c.get("/api/license/status").status_code != 403
    st.invalidate()


def test_openapi_reachable_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    assert c.get("/api/openapi.json").status_code == 200
    st.invalidate()
