"""许可 HTTP 接口测试。"""
import base64
import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.licensing import state as st
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import (TEST_PRIVATE_KEY, build_host, install_license,
                                    write_license_file)
from app.licensing import fingerprint as fp
from app.licensing import verifier


def make_client(db, role="admin"):
    user = User(id=uuid.uuid4(), username=f"u-{role}", password_hash="x",
                real_name="X", role=role, status="active")
    db.add(user); db.commit(); db.refresh(user)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app), user


@pytest.fixture
def admin_client(db):
    c, u = make_client(db, "admin")
    yield c, u
    app.dependency_overrides.clear()


@pytest.fixture
def guest_client(db):
    c, u = make_client(db, "guest")
    yield c, u
    app.dependency_overrides.clear()


def test_status_returns_valid(admin_client, db):
    c, _ = admin_client
    body = c.get("/api/license/status").json()
    assert body["state"] == "VALID"
    assert body["customer"] == "测试客户"
    assert set(body["modules"]) == {"change", "inventory", "project"}
    assert body["used_users"] == st.count_active_users(db)


def test_status_readable_by_guest(guest_client):
    c, _ = guest_client
    assert c.get("/api/license/status").status_code == 200


def test_machine_code_admin_only(admin_client):
    ac, _ = admin_client
    assert len(ac.get("/api/license/machine-code").json()["machine_code"]) > 0


def test_machine_code_denied_for_guest(guest_client):
    c, _ = guest_client
    assert c.get("/api/license/machine-code").status_code == 403


def test_upload_valid_license(admin_client, monkeypatch, tmp_path):
    lic_dir = install_license(monkeypatch, modules=())
    c, _ = admin_client
    assert c.get("/api/license/status").json()["modules"] == []

    host = str(Path(str(lic_dir)).parent / "host")
    new_dir = tmp_path / "new"
    write_license_file(new_dir, host, modules=("change", "inventory", "project"))
    raw = (new_dir / st.LICENSE_FILENAME).read_bytes()

    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", raw, "application/octet-stream")})
    assert resp.status_code == 200
    assert set(resp.json()["modules"]) == {"change", "inventory", "project"}
    assert c.get("/api/license/status").json()["state"] == "VALID"


def test_upload_rejects_tampered_license(admin_client, monkeypatch, tmp_path):
    install_license(monkeypatch)
    c, _ = admin_client
    doc = {"payload": {"license_id": "X"}, "signature": "AAAA"}
    raw = base64.b64encode(json.dumps(doc).encode())
    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", raw, "application/octet-stream")})
    assert resp.status_code == 400
    assert "许可证" in resp.json()["detail"]


def test_upload_denied_for_guest(guest_client, tmp_path):
    c, _ = guest_client
    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", b"x", "application/octet-stream")})
    assert resp.status_code == 403


def test_upload_writes_audit_row(admin_client, db, monkeypatch, tmp_path):
    from app.models_license import LicenseRecord
    lic_dir = install_license(monkeypatch)
    host = str(Path(str(lic_dir)).parent / "host")
    new_dir = tmp_path / "new2"
    write_license_file(new_dir, host, max_users=77)
    raw = (new_dir / st.LICENSE_FILENAME).read_bytes()
    c, user = admin_client
    c.post("/api/license/upload",
           files={"file": ("license.lic", raw, "application/octet-stream")})
    row = db.query(LicenseRecord).order_by(LicenseRecord.uploaded_at.desc()).first()
    assert row is not None
    assert row.max_users == 77
    assert row.uploaded_by == user.id


def test_status_works_when_license_missing(admin_client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "nope"))
    st.invalidate()
    c, _ = admin_client
    body = c.get("/api/license/status").json()
    assert body["state"] == "MISSING"
    assert body["modules"] == []
    st.invalidate()
