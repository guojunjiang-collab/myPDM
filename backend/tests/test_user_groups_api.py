import uuid
from fastapi import HTTPException
import pytest
from app import crud_groups, models


def test_get_user_and_document_group_ids(db, engineer_user, make_user_group, make_document):
    g = make_user_group("G1")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    master, _rev, _it = make_document(group_ids=[g.id])
    assert crud_groups.get_user_group_ids(db, engineer_user.id) == {g.id}
    # 组关联挂在 Master 上
    assert crud_groups.get_document_group_ids(db, master.id) == {g.id}


def test_get_document_creator_id_reads_first_iteration(db, engineer_user, make_document):
    """创建者取"最早版本最早迭代"的 creator_id（v3.1.3 起该列在迭代层）。"""
    master, _rev, _it = make_document(creator=engineer_user)
    assert crud_groups.get_document_creator_id(db, master.id) == engineer_user.id


def test_document_is_accessible_unlinked(db, guest_user, make_document):
    master, _rev, _it = make_document()
    assert crud_groups.document_is_accessible(db, guest_user, master) is True


def test_document_is_accessible_member_vs_nonmember(db, engineer_user, guest_user,
                                                    make_user_group, make_document):
    g = make_user_group("G2")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    master, _rev, _it = make_document(group_ids=[g.id])
    assert crud_groups.document_is_accessible(db, engineer_user, master) is True
    assert crud_groups.document_is_accessible(db, guest_user, master) is False


def test_document_is_accessible_for_creator_outside_group(db, engineer_user, guest_user,
                                                          make_user_group, make_document):
    """创建者即使不在关联组内也可访问（审计问题 #5 的回归护栏）。"""
    g = make_user_group("G2b")
    db.add(models.UserGroupMember(user_id=guest_user.id, group_id=g.id)); db.commit()
    master, _rev, _it = make_document(creator=engineer_user, group_ids=[g.id])
    assert crud_groups.document_is_accessible(db, engineer_user, master) is True


def test_enforce_attachment_content_access(db, engineer_user, guest_user, make_user_group,
                                           make_document, make_doc_attachment):
    g = make_user_group("G3")
    db.add(models.UserGroupMember(user_id=engineer_user.id, group_id=g.id)); db.commit()
    _m, rev, it = make_document(group_ids=[g.id])
    att = make_doc_attachment(rev, it)
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


def test_user_groups_subresource(db, admin_user, engineer_user, make_user_group):
    from app.main import app
    client = _client(db, admin_user)
    try:
        g = make_user_group("Gsub")
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert r.status_code == 200 and r.json()["group_ids"] == []
        r = client.put(f"/api/users/{engineer_user.id}/groups", json={"group_ids": [str(g.id)]})
        assert r.status_code == 200
        r = client.get(f"/api/users/{engineer_user.id}/groups")
        assert str(g.id) in [str(x) for x in r.json()["group_ids"]]
    finally:
        app.dependency_overrides.clear()
