import uuid
import pytest
from app import crud, models


def test_find_or_create_creates_guest_user(db):
    user = crud.find_or_create_feishu_user(
        db, "feishu",
        {"union_id": "u1", "name": "张三", "open_id": "o1", "avatar_url": "http://a"},
    )
    assert user.role == "guest"
    assert user.must_change_password is False
    assert user.real_name == "张三"
    assert user.username == "张三"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="u1").first()
    assert binding is not None
    assert binding.user_id == user.id


def test_find_or_create_returns_same_user(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    assert user1.id == user2.id
    assert db.query(models.UserFeishuBinding).count() == 1


def test_username_collision_fallback(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "a", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu_eh", {"union_id": "b", "name": "张三"})
    assert user1.username == "张三"
    assert user2.username != "张三"
    assert user2.username.startswith("张三")


from urllib.parse import urlparse, parse_qs
from fastapi.testclient import TestClient
from jose import jwt
from app.main import app
from app.database import get_db
from app.routers.auth import SECRET_KEY, ALGORITHM
from app.feishu_client import FeishuClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _setup_env(monkeypatch):
    monkeypatch.setenv("FEISHU_APP_ID", "cli_test")
    monkeypatch.setenv("FEISHU_APP_SECRET", "sec_test")
    monkeypatch.setenv("FEISHU_EH_APP_ID", "cli_eh")
    monkeypatch.setenv("FEISHU_EH_APP_SECRET", "sec_eh")
    monkeypatch.setenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")


def _fake_exchange(self, code):
    return {"access_token": "fake_uat"}


def _fake_user_info(self, token):
    return {"union_id": "union_1", "open_id": "open_1", "name": "张三", "avatar_url": "http://a"}


def _get_state(location):
    return parse_qs(urlparse(location).query)["state"][0]


def test_config_lists_providers_without_secret(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/config")
    assert r.status_code == 200
    providers = r.json()["providers"]
    assert [p["key"] for p in providers] == ["feishu", "feishu_eh"]
    assert "app_secret" not in providers[0]


def test_authorize_redirects_to_feishu(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "/authen/v1/authorize" in r.headers["location"]


def test_callback_auto_creates_and_redirects_with_tokens(monkeypatch, client, db):
    _setup_env(monkeypatch)
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    state = _get_state(r.headers["location"])
    r2 = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                    follow_redirects=False)
    assert r2.status_code in (302, 307)
    assert r2.headers["location"].startswith("https://192.168.61.105:8080/feishu-callback#")
    assert db.query(models.UserFeishuBinding).count() == 1


def test_callback_rejects_disabled_user(monkeypatch, client, db):
    _setup_env(monkeypatch)
    disabled = models.User(id=uuid.uuid4(), username="disabled", password_hash="x",
                           real_name="停用", role="guest", status="disabled")
    db.add(disabled)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_dis", user_id=disabled.id))
    db.commit()
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info",
                        lambda self, token: {"union_id": "union_dis", "name": "停用"})
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    state = _get_state(r.headers["location"])
    r2 = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                    follow_redirects=False)
    assert "error=" in r2.headers["location"]


def test_callback_rejects_bad_state(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/callback",
                   params={"code": "c", "state": "bad"}, follow_redirects=False)
    assert "error=" in r.headers["location"]


def test_jsapi_login_returns_token(monkeypatch, client):
    _setup_env(monkeypatch)
    monkeypatch.setattr(FeishuClient, "exchange_jsapi_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    r = client.post("/api/auth/feishu/jsapi", json={"provider": "feishu", "code": "c1"})
    assert r.status_code == 200
    payload = jwt.decode(r.json()["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["sub"] == "张三"


def test_unconfigured_provider_returns_400(monkeypatch, client):
    _setup_env(monkeypatch)
    monkeypatch.delenv("FEISHU_EH_APP_ID")
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu_eh"})
    assert r.status_code == 400
