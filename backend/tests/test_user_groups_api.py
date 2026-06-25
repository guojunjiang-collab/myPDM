import uuid
from fastapi import HTTPException
import pytest
from app import models, crud_groups


def _doc(db, creator_id=None):
    d = models.Document(code=f"D{uuid.uuid4().hex[:6]}", name="图纸", creator_id=creator_id)
    db.add(d); db.commit(); db.refresh(d)
    return d


def _att(db, document_id):
    a = models.DocumentAttachment(document_id=document_id, file_name="a.pdf", file_path="x/a.pdf")
    db.add(a); db.commit(); db.refresh(a)
    return a


def _group(db, name):
    g = models.UserGroup(name=name)
    db.add(g); db.commit(); db.refresh(g)
    return g


def test_get_user_and_document_group_ids(db, engineer_user):
    g = _group(db, "G1")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    assert crud_groups.get_user_group_ids(db, engineer_user.id) == {g.id}
    assert crud_groups.get_document_group_ids(db, d.id) == {g.id}


def test_document_is_accessible_unlinked(db, guest_user):
    d = _doc(db)
    assert crud_groups.document_is_accessible(db, guest_user, d) is True


def test_document_is_accessible_member_vs_nonmember(db, engineer_user, guest_user):
    g = _group(db, "G2")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    assert crud_groups.document_is_accessible(db, engineer_user, d) is True
    assert crud_groups.document_is_accessible(db, guest_user, d) is False


def test_enforce_attachment_content_access(db, engineer_user, guest_user):
    g = _group(db, "G3")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    d = _doc(db)
    db.add(models.DocumentGroupLink(document_id=d.id, group_id=g.id)); db.commit()
    att = _att(db, d.id)
    crud_groups.enforce_attachment_content_access(db, engineer_user, att.id)
    with pytest.raises(HTTPException):
        crud_groups.enforce_attachment_content_access(db, guest_user, att.id)


def test_enforce_attachment_missing_is_silent(db, guest_user):
    crud_groups.enforce_attachment_content_access(db, guest_user, uuid.uuid4())


from fastapi.testclient import TestClient


def _client(db, user):
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def test_group_crud_and_members_via_api(db, admin_user, engineer_user):
    client = _client(db, admin_user)
    try:
        r = client.post("/api/user-groups/", json={"name": "研发组", "description": "x"})
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        r = client.get("/api/user-groups/")
        assert r.status_code == 200 and len(r.json()) == 1
        r = client.put(f"/api/user-groups/{gid}", json={"name": "研发一组"})
        assert r.status_code == 200 and r.json()["name"] == "研发一组"
        r = client.put(f"/api/user-groups/{gid}/members", json={"user_ids": [str(engineer_user.id)]})
        assert r.status_code == 200
        r = client.get(f"/api/user-groups/{gid}/members")
        assert str(engineer_user.id) in [str(x) for x in r.json()["user_ids"]]
        r = client.delete(f"/api/user-groups/{gid}")
        assert r.status_code == 200
        assert client.get("/api/user-groups/").json() == []
    finally:
        from app.main import app
        app.dependency_overrides.clear()


def test_group_create_forbidden_for_non_admin(db, engineer_user):
    client = _client(db, engineer_user)
    try:
        r = client.post("/api/user-groups/", json={"name": "x"})
        assert r.status_code == 403
    finally:
        from app.main import app
        app.dependency_overrides.clear()


def test_user_groups_subresource(db, admin_user, engineer_user):
    from app.main import app
    client = _client(db, admin_user)
    try:
        g = _group(db, "Gsub")
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert r.status_code == 200 and r.json()["group_ids"] == []
        r = client.put(f"/api/users/{engineer_user.id}/groups", json={"group_ids": [str(g.id)]})
        assert r.status_code == 200
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert str(g.id) in [str(x) for x in r.json()["group_ids"]]
    finally:
        app.dependency_overrides.clear()
