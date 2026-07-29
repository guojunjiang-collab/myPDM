"""首次登录强制修改密码 —— 后端行为测试。"""
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import User
from app import crud


def make_user(db, username="usr1", password="Passw0rd", role="admin",
              must_change=False, status="active"):
    user = User(
        id=uuid.uuid4(), username=username,
        password_hash=crud.get_password_hash(password),
        real_name="测试用户", role=role, status=status,
        must_change_password=must_change,
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def login(client, username="usr1", password="Passw0rd"):
    r = client.post(
        "/api/auth/token",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_new_column_defaults_to_false(db):
    """存量用户语义：不显式赋值时该列为 False，不会被拦截。"""
    user = User(
        id=uuid.uuid4(), username="legacy",
        password_hash=crud.get_password_hash("Passw0rd"),
        real_name="存量用户", role="engineer", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    assert user.must_change_password is False


def test_flagged_user_blocked_on_business_api(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"


def test_flagged_user_can_read_me(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["must_change_password"] is True


def test_flagged_user_can_change_password(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "NewPassw0rd"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_flag_cleared_after_change_and_access_restored(client, db):
    user = make_user(db, must_change=True)
    token = login(client)
    client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "NewPassw0rd"},
        headers={"Authorization": f"Bearer {token}"},
    )
    db.refresh(user)
    assert user.must_change_password is False

    new_token = login(client, password="NewPassw0rd")
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {new_token}"})
    assert r.status_code == 200


def test_unflagged_user_unaffected(client, db):
    make_user(db, must_change=False)
    token = login(client)
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_disabled_user_still_400_not_403(client, db):
    """禁用优先于改密标记：两者都命中时返回账户已禁用。"""
    make_user(db, must_change=True, status="disabled")
    token = login(client)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_created_user_is_flagged(client, db):
    make_user(db, username="admin1")
    token = login(client, username="admin1")
    r = client.post(
        "/api/users/",
        json={"username": "newbie", "real_name": "新人", "role": "engineer",
              "password": "Init1234", "department": "IT"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["must_change_password"] is True


def test_admin_reset_flags_target_user(client, db):
    make_user(db, username="admin1")
    target = make_user(db, username="victim", role="engineer")
    assert target.must_change_password is False

    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{target.id}",
        json={"password": "123456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(target)
    assert target.must_change_password is True


def test_admin_changing_own_password_does_not_flag_self(client, db):
    """管理员在用户管理页改自己的密码，不应把自己锁进强制改密页。"""
    admin = make_user(db, username="admin1")
    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{admin.id}",
        json={"password": "Another1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(admin)
    assert admin.must_change_password is False


def test_admin_update_without_password_does_not_flag(client, db):
    make_user(db, username="admin1")
    target = make_user(db, username="victim", role="engineer")
    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{target.id}",
        json={"department": "研发部"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(target)
    assert target.must_change_password is False
