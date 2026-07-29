"""首次登录强制修改密码 —— 后端行为测试。"""
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import User
from app import crud


def make_user(db, username="u1", password="Passw0rd", role="admin",
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


def login(client, username="u1", password="Passw0rd"):
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
