import uuid
from urllib.parse import urlparse, parse_qs

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app import models
from app.main import app
from app.database import get_db
from app.routers.auth import SECRET_KEY, ALGORITHM, create_access_token
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


def _mk_user(db, username, role="engineer", status="active"):
    user = models.User(
        id=uuid.uuid4(), username=username, password_hash="x",
        real_name=username, role=role, status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth(user):
    token = create_access_token({"sub": user.username, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _bind(client, user):
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"}, headers=_auth(user))
    assert r.status_code == 200
    intent = r.json()["intent"]
    r2 = client.get("/api/auth/feishu/authorize", params={"provider": "feishu", "intent": intent},
                    follow_redirects=False)
    return parse_qs(urlparse(r2.headers["location"]).query)["state"][0]


def test_bind_intent_requires_login(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"})
    assert r.status_code == 401


def test_bind_intent_returns_signed_intent(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"}, headers=_auth(user))
    assert r.status_code == 200
    payload = jwt.decode(r.json()["intent"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["typ"] == "feishu_bind_intent"
    assert payload["user_id"] == str(user.id)
    assert payload["provider"] == "feishu"


def test_authorize_with_intent_embeds_binding_state(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    state = _bind(client, user)
    payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["mode"] == "binding"
    assert payload["user_id"] == str(user.id)


def test_callback_binding_creates_binding_for_current_user(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, user)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    assert "result=success" in r.headers["location"]
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding is not None
    assert binding.user_id == user.id
    assert "access_token" not in r.headers["location"]


def test_callback_binding_conflict_redirects_error(monkeypatch, client, db):
    _setup_env(monkeypatch)
    other = _mk_user(db, "other", role="engineer")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_1", user_id=other.id))
    db.commit()
    me = _mk_user(db, "me")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, me)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    frag = parse_qs(r.headers["location"].split("#", 1)[1])
    assert frag["result"] == ["error"]
    assert "已绑定其他账号" in frag["message"][0]


def test_callback_binding_takes_over_guest(monkeypatch, client, db):
    _setup_env(monkeypatch)
    guest = _mk_user(db, "guest1", role="guest")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_1", user_id=guest.id))
    db.commit()
    real = _mk_user(db, "real")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, real)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    assert "result=success" in r.headers["location"]
    db.refresh(guest)
    assert guest.status == "disabled"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding.user_id == real.id


def test_bindings_requires_login(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/bindings")
    assert r.status_code == 401


def test_bindings_returns_current_user_rows(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="u1", user_id=user.id, name="张三"))
    db.add(models.UserFeishuBinding(provider="feishu_eh", union_id="u2", user_id=user.id, name="张三"))
    db.commit()
    r = client.get("/api/auth/feishu/bindings", headers=_auth(user))
    assert r.status_code == 200
    rows = r.json()["bindings"]
    assert {x["provider"] for x in rows} == {"feishu", "feishu_eh"}
