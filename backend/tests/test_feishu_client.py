import pytest
import httpx
from app.feishu_client import FeishuClient, FeishuError, FeishuProvider, get_provider


def _provider(**kw):
    defaults = dict(name="feishu", app_id="cli_test", app_secret="sec",
                    redirect_uri="https://192.168.61.105:8080/api/auth/feishu/callback")
    defaults.update(kw)
    return FeishuProvider(**defaults)


def test_get_provider_returns_none_without_env(monkeypatch):
    monkeypatch.delenv("FEISHU_APP_ID", raising=False)
    monkeypatch.delenv("FEISHU_APP_SECRET", raising=False)
    assert get_provider("feishu") is None


def test_get_provider_reads_env(monkeypatch):
    monkeypatch.setenv("FEISHU_APP_ID", "cli_1")
    monkeypatch.setenv("FEISHU_APP_SECRET", "sec1")
    monkeypatch.setenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")
    p = get_provider("feishu")
    assert p.app_id == "cli_1"
    assert p.redirect_uri == "https://192.168.61.105:8080/api/auth/feishu/callback"


def test_build_authorize_url_contains_state(monkeypatch):
    client = FeishuClient(_provider())
    url = client.build_authorize_url("state123")
    assert "/authen/v1/authorize" in url
    assert "app_id=cli_test" in url
    assert "state=state123" in url


def test_exchange_oauth_code_uses_v2(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return httpx.Response(200, json={"access_token": "uat", "expires_in": 7200})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    data = FeishuClient(_provider()).exchange_oauth_code("code123")
    assert data["access_token"] == "uat"
    assert captured["url"].endswith("/authen/v2/oauth/token")
    assert captured["json"]["redirect_uri"] == "https://192.168.61.105:8080/api/auth/feishu/callback"


def test_exchange_jsapi_code_uses_v1(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        return httpx.Response(200, json={"code": 0, "data": {"access_token": "uat"}})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    data = FeishuClient(_provider()).exchange_jsapi_code("c1")
    assert data["access_token"] == "uat"
    assert captured["url"].endswith("/authen/v1/access_token")


def test_get_user_info(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        return httpx.Response(200, json={"code": 0, "data": {"union_id": "u1", "name": "张三"}})

    monkeypatch.setattr("app.feishu_client.httpx.get", fake_get)
    info = FeishuClient(_provider()).get_user_info("uat")
    assert info["union_id"] == "u1"


def test_feishu_error_on_nonzero_code(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(200, json={"code": 10001, "msg": "bad"})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    with pytest.raises(FeishuError) as ei:
        FeishuClient(_provider()).exchange_jsapi_code("c1")
    assert ei.value.code == "10001"


def test_http_error_raises(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(400, json={"error": "invalid_grant"})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    with pytest.raises(FeishuError):
        FeishuClient(_provider()).exchange_oauth_code("c1")
