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


def test_create_document_sets_creator_and_groups(db, engineer_user, make_user_group):
    from app.main import app
    client = _client(db, engineer_user)
    try:
        g = make_user_group("G")
        r = client.post("/api/documents/", json={"code": "DOC1", "name": "图纸", "group_ids": [str(g.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        # creator 落在迭代层，响应以 creator_name 呈现
        assert body["creator_name"] == engineer_user.real_name
        assert [str(x) for x in body["group_ids"]] == [str(g.id)]
    finally:
        app.dependency_overrides.clear()
    # 库里确认 creator_id 写在 DocumentIteration 上
    master = db.query(models.DocumentMaster).filter(models.DocumentMaster.code == "DOC1").first()
    rev = db.query(models.DocumentRevision).filter(models.DocumentRevision.master_id == master.id).first()
    it = db.query(models.DocumentIteration).filter(models.DocumentIteration.revision_id == rev.id).first()
    assert it.creator_id == engineer_user.id


def test_list_marks_accessible_false_for_nonmember(db, engineer_user, guest_user, make_user_group):
    from app.main import app
    g = make_user_group("G2")
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
        row = [d for d in r.json()["items"] if d["code"] == "DOC2"][0]
        assert row["accessible"] is False
        assert str(g.id) in [str(x) for x in row["group_ids"]]
    finally:
        app.dependency_overrides.clear()


def test_documents_download_attachment_blocks_nonmember(
    db, admin_user, guest_user, make_user_group, make_document, make_doc_attachment
):
    from app.main import app
    g = make_user_group("Gd")
    _m, rev, it = make_document(creator=admin_user, group_ids=[g.id])
    att = make_doc_attachment(rev, it)
    client = _client(db, guest_user)
    try:
        r = client.get(f"/api/documents/{rev.id}/attachments/{att.id}")
        assert r.status_code == 403
        r = client.get(f"/api/documents/{rev.id}/attachments/")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_v2_download_stream_get_block_nonmember(
    db, admin_user, guest_user, make_user_group, make_document, make_doc_attachment
):
    from app.main import app
    g = make_user_group("Gv")
    _m, rev, it = make_document(creator=admin_user, group_ids=[g.id])
    att = make_doc_attachment(rev, it)
    client = _client(db, guest_user)
    try:
        assert client.get(f"/api/v2/attachments/{att.id}").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/download").status_code == 403
        assert client.get(f"/api/v2/attachments/{att.id}/stream").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_media_token_denied_for_nonmember_allowed_for_member(
    db, admin_user, engineer_user, guest_user, make_user_group, make_document, make_doc_attachment
):
    from app.main import app
    g = make_user_group("Gt")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    _m, rev, it = make_document(creator=admin_user, group_ids=[g.id])
    att = make_doc_attachment(rev, it)
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


def test_creator_can_access_own_document_without_group_membership(
    db, engineer_user, make_user_group, make_document, make_doc_attachment
):
    """回归护栏：创建者不在关联组内，仍应能取自己文档的附件。

    creator_id 下移到迭代层后，策略若还从 DocumentMaster 上取 creator_id 会恒为 None，
    导致创建者被自己的文档挡在门外（v2.0 审计问题 #5）。
    """
    from app.main import app
    g = make_user_group("Gc")            # engineer 故意不加入该组
    _m, rev, it = make_document(creator=engineer_user, group_ids=[g.id])
    att = make_doc_attachment(rev, it)
    client = _client(db, engineer_user)
    try:
        assert client.get(f"/api/documents/{rev.id}/attachments/").status_code == 200
        r = client.get(f"/api/v2/attachments/{att.id}/media-token", params={"action": "preview"})
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_backfill_creator_from_logs(db, engineer_user, make_document):
    """回填脚本：按"创建图文档"日志（target_id = revision_id）回填迭代层 creator_id。"""
    import importlib.util, pathlib
    _m, rev, it = make_document(creator=None)
    assert it.creator_id is None
    db.add(models.OperationLog(user_id=engineer_user.id, username="eng",
                               action="创建图文档", target_type="document",
                               target_id=str(rev.id)))
    db.commit()
    spec = importlib.util.spec_from_file_location(
        "backfill_document_creator",
        str(pathlib.Path(__file__).resolve().parents[2] / "tools" / "backfill_document_creator.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    assert mod.backfill(db) == 1
    db.refresh(it)
    assert it.creator_id == engineer_user.id
    assert mod.backfill(db) == 0
