"""飞书 OpenAPI 客户端：双 provider 配置 + 授权码换 token + 用户信息。"""
import os
from urllib.parse import urlencode

import httpx

FEISHU_BASE_URL = "https://open.feishu.cn/open-apis"


class FeishuError(Exception):
    def __init__(self, code, message):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class FeishuProvider:
    def __init__(self, name: str, app_id: str, app_secret: str, redirect_uri: str):
        self.name = name
        self.app_id = app_id
        self.app_secret = app_secret
        self.redirect_uri = redirect_uri


def _provider_redirect_uri(redirect_base: str) -> str:
    return f"{redirect_base.rstrip('/')}/api/auth/feishu/callback"


def provider_env_prefix(key: str) -> str:
    """provider key → 环境变量前缀。feishu 为主入口（FEISHU_），其余任意 key 用 FEISHU_<KEY大写>_。"""
    if key == "feishu":
        return "FEISHU_"
    return f"FEISHU_{key.upper()}_"


def list_provider_keys() -> list[str]:
    """启用的 provider key 列表：未设置 FEISHU_PROVIDERS 时默认仅主飞书入口（单路）。"""
    raw = os.getenv("FEISHU_PROVIDERS", "feishu")
    return [k.strip() for k in raw.split(",") if k.strip()]


def get_provider(name: str):
    """按 provider key 读取环境变量；未配置返回 None。"""
    prefix = provider_env_prefix(name)
    app_id = os.getenv(f"{prefix}APP_ID", "").strip()
    app_secret = os.getenv(f"{prefix}APP_SECRET", "").strip()
    if not app_id or not app_secret:
        return None
    redirect_base = os.getenv(
        f"{prefix}REDIRECT_BASE",
        os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080"),
    ).strip()
    return FeishuProvider(name=name, app_id=app_id, app_secret=app_secret,
                          redirect_uri=_provider_redirect_uri(redirect_base))


def list_providers():
    return [p for key in list_provider_keys() if (p := get_provider(key))]


class FeishuClient:
    def __init__(self, provider: FeishuProvider, base_url: str = FEISHU_BASE_URL):
        self.provider = provider
        self.base_url = base_url.rstrip("/")

    def build_authorize_url(self, state: str) -> str:
        params = {
            "app_id": self.provider.app_id,
            "redirect_uri": self.provider.redirect_uri,
            "state": state,
        }
        return f"{self.base_url}/authen/v1/authorize?{urlencode(params)}"

    def exchange_oauth_code(self, code: str) -> dict:
        resp = httpx.post(
            f"{self.base_url}/authen/v2/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": self.provider.app_id,
                "client_secret": self.provider.app_secret,
                "code": code,
                "redirect_uri": self.provider.redirect_uri,
            },
            timeout=10,
        )
        return self._handle(resp)

    def exchange_jsapi_code(self, code: str) -> dict:
        resp = httpx.post(
            f"{self.base_url}/authen/v1/access_token",
            json={
                "app_id": self.provider.app_id,
                "app_secret": self.provider.app_secret,
                "grant_type": "authorization_code",
                "code": code,
            },
            timeout=10,
        )
        return self._handle(resp)

    def get_user_info(self, user_access_token: str) -> dict:
        resp = httpx.get(
            f"{self.base_url}/authen/v1/user_info",
            headers={"Authorization": f"Bearer {user_access_token}"},
            timeout=10,
        )
        return self._handle(resp)

    @staticmethod
    def _handle(resp: httpx.Response) -> dict:
        try:
            body = resp.json()
        except ValueError:
            raise FeishuError("http", f"非 JSON 响应: HTTP {resp.status_code}")
        if resp.status_code >= 400:
            msg = body.get("error_description") or body.get("msg") or body.get("error") or ""
            raise FeishuError("http", f"HTTP {resp.status_code} {msg}".strip())
        if isinstance(body, dict) and "code" in body and body.get("code", -1) != 0:
            raise FeishuError(str(body.get("code", "unknown")), body.get("msg", ""))
        data = body.get("data", body) if isinstance(body, dict) else body
        if not isinstance(data, dict):
            raise FeishuError("http", "飞书返回结构异常")
        return data
