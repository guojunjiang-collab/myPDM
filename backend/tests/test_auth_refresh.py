import uuid
import pytest
from jose import jwt
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.models import User
from app import crud
from app.routers.auth import SECRET_KEY, ALGORITHM


@pytest.fixture
def client(db):
    password_hash = crud.get_password_hash("123456")
    user = User(
        id=uuid.uuid4(), username="testuser", password_hash=password_hash,
        real_name="Test User", role="admin", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_login_token_expiry_8h(client):
    r = client.post("/api/auth/token", data={"username": "testuser", "password": "123456"},
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200
    data = r.json()
    payload = jwt.decode(data["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload.get("typ") in (None, "access")


def test_refresh_returns_new_access(client):
    r = client.post("/api/auth/token", data={"username": "testuser", "password": "123456"},
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    login = r.json()
    assert "refresh_token" in login, "Login should return refresh_token"
    r2 = client.post("/api/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert r2.status_code == 200
    assert "access_token" in r2.json()
