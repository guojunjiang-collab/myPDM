import uuid
import pytest
from fastapi.testclient import TestClient
from app.models import User, Component, ComponentAttachment
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app import file_storage as fs_mod


def _client(db, user):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _user(db, role="engineer"):
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}",
             password_hash="x", real_name="U", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _component(db, code="C1"):
    c = Component(id=uuid.uuid4(), code=f"{code}_{uuid.uuid4().hex[:4]}",
                  name="Test", version="A", status="draft")
    db.add(c); db.commit(); db.refresh(c)
    return c


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_component_attachment_model_persists(db):
    comp = _component(db)
    att = ComponentAttachment(
        id=uuid.uuid4(), component_id=comp.id, category="cad",
        file_name="part.stp", file_size=10, file_path="component/x/part.stp",
        file_hash="abc",
    )
    db.add(att); db.commit(); db.refresh(att)
    rows = db.query(ComponentAttachment).filter(
        ComponentAttachment.component_id == comp.id).all()
    assert len(rows) == 1
    assert rows[0].category == "cad"


def test_file_storage_allows_component_entity():
    assert "component" in fs_mod.ALLOWED_ENTITY_TYPES
    assert fs_mod.ENTITY_TYPE_ALIASES.get("components") == "component"


def test_migrate_components_is_noop_on_sqlite(db):
    from app.migrations_components import migrate_components
    assert migrate_components(db, db.get_bind()) is None


def test_upload_small_file_to_component(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    files = {"file": ("part.pdf", b"%PDF-1.4 test", "application/pdf")}
    data = {"entity_type": "component", "entity_id": str(comp.id), "category": "cad"}
    r = c.post("/api/v2/attachments/upload", files=files, data=data)
    assert r.status_code == 200, r.text

    rows = db.query(ComponentAttachment).filter(
        ComponentAttachment.component_id == comp.id).all()
    assert len(rows) == 1
    assert rows[0].category == "cad"
    assert rows[0].file_name == "part.pdf"


def test_component_attachment_stream_and_token(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    files = {"file": ("m.pdf", b"%PDF-1.4 body", "application/pdf")}
    data = {"entity_type": "component", "entity_id": str(comp.id), "category": "production"}
    up = c.post("/api/v2/attachments/upload", files=files, data=data)
    att_id = up.json()["id"]

    tok = c.get(f"/api/v2/attachments/{att_id}/media-token", params={"action": "preview"})
    assert tok.status_code == 200, tok.text

    s = c.get(f"/api/v2/attachments/{att_id}/stream")
    assert s.status_code == 200, s.text
    assert s.content == b"%PDF-1.4 body"


def test_list_and_delete_component_attachments(db, tmp_path, monkeypatch):
    from app import file_storage as fsm
    store = fsm.FileStorage(base_dir=str(tmp_path))
    monkeypatch.setattr(fsm, "file_storage", store)
    monkeypatch.setattr("app.routers.attachments_v2.file_storage", store)
    monkeypatch.setattr("app.routers.components.file_storage", store)

    comp = _component(db)
    user = _user(db, "engineer")
    c = _client(db, user)

    for cat, fn in [("cad", "a.pdf"), ("production", "b.pdf")]:
        c.post("/api/v2/attachments/upload",
               files={"file": (fn, b"%PDF-1.4 x", "application/pdf")},
               data={"entity_type": "component", "entity_id": str(comp.id), "category": cat})

    r = c.get(f"/api/components/{comp.id}/attachments")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2

    r_cad = c.get(f"/api/components/{comp.id}/attachments", params={"category": "cad"})
    assert len(r_cad.json()) == 1
    assert r_cad.json()[0]["category"] == "cad"

    att_id = r_cad.json()[0]["id"]
    d = c.delete(f"/api/components/{comp.id}/attachments/{att_id}")
    assert d.status_code == 200, d.text
    assert db.query(ComponentAttachment).filter(ComponentAttachment.id == uuid.UUID(att_id)).first() is None
