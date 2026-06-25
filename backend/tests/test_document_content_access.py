import uuid
from fastapi.testclient import TestClient
from app import models


def _client(db, user):
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _group(db, name):
    g = models.UserGroup(name=name)
    db.add(g); db.commit(); db.refresh(g)
    return g


def test_create_document_sets_creator_and_groups(db, engineer_user):
    from app.main import app
    client = _client(db, engineer_user)
    try:
        g = _group(db, "G")
        r = client.post("/api/documents/", json={"code": "DOC1", "name": "图纸", "group_ids": [str(g.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert str(body["creator_id"]) == str(engineer_user.id)
        assert [str(x) for x in body["group_ids"]] == [str(g.id)]
    finally:
        app.dependency_overrides.clear()


def test_list_marks_accessible_false_for_nonmember(db, engineer_user, guest_user):
    from app.main import app
    g = _group(db, "G2")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    client = _client(db, engineer_user)
    try:
        r = client.post("/api/documents/", json={"code": "DOC2", "name": "图纸", "group_ids": [str(g.id)]})
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()
    client = _client(db, guest_user)
    try:
        r = client.get("/api/documents/")
        assert r.status_code == 200
        row = [d for d in r.json() if d["code"] == "DOC2"][0]
        assert row["accessible"] is False
        assert str(g.id) in [str(x) for x in row["group_ids"]]
    finally:
        app.dependency_overrides.clear()


def _doc_with_group(db, creator, gid):
    d = models.Document(code=f"D{uuid.uuid4().hex[:6]}", name="图纸", creator_id=creator.id if creator else None)
    db.add(d); db.commit(); db.refresh(d)
    if gid:
        db.add(models.DocumentGroupLink(document_id=d.id, group_id=gid)); db.commit()
    return d


def _att(db, document_id):
    a = models.DocumentAttachment(document_id=document_id, file_name="a.pdf", file_path="x/a.pdf")
    db.add(a); db.commit(); db.refresh(a)
    return a


def test_documents_download_attachment_blocks_nonmember(db, admin_user, guest_user):
    from app.main import app
    g = _group(db, "Gd")
    d = _doc_with_group(db, admin_user, g.id)
    att = _att(db, d.id)
    client = _client(db, guest_user)
    try:
        r = client.get(f"/api/documents/{d.id}/attachments/{att.id}")
        assert r.status_code == 403
        r = client.get(f"/api/documents/{d.id}/attachments/")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_v2_download_stream_get_block_nonmember(db, admin_user, guest_user):
    from app.main import app
    g = _group(db, "Gv")
    d = _doc_with_group(db, admin_user, g.id)
    att = _att(db, d.id)
    client = _client(db, guest_user)
    try:
        assert client.get(f"/api/v2/attachments/{att.id}").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/download").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/stream").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_media_token_denied_for_nonmember_allowed_for_member(db, admin_user, engineer_user, guest_user):
    from app.main import app
    g = _group(db, "Gt")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc_with_group(db, admin_user, g.id)
    att = _att(db, d.id)
    client = _client(db, guest_user)
    try:
        r = client.get(f"/api/v2/attachments/{att.id}/media-token", params={"action": "preview"})
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()
    client = _client(db, engineer_user)
    try:
        r = client.get(f"/api/v2/attachments/{att.id}/media-token", params={"action": "preview"})
        assert r.status_code == 200 and "token" in r.json()
    finally:
        app.dependency_overrides.clear()


def test_backfill_creator_from_logs(db, engineer_user):
    import importlib.util, pathlib
    d = models.Document(code="BF1", name="图纸", creator_id=None)
    db.add(d); db.commit(); db.refresh(d)
    db.add(models.OperationLog(user_id=engineer_user.id, username="eng",
                               action="创建图文档", target_type="document", target_id=str(d.id)))
    db.commit()
    spec = importlib.util.spec_from_file_location(
        "backfill_document_creator",
        str(pathlib.Path(__file__).resolve().parents[2] / "tools" / "backfill_document_creator.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    n1 = mod.backfill(db)
    assert n1 == 1
    db.refresh(d)
    assert d.creator_id == engineer_user.id
    assert mod.backfill(db) == 0
