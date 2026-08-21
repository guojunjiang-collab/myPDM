"""微信开放平台网站应用客户端：OAuth2 授权码换 token + 用户信息（PC 扫码登录）。"""
import os
from urllib.parse import urlencode

import httpx

WECHAT_AUTHORIZE_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_API_BASE_URL = "https://api.weixin.qq.com/sns"


class WechatError(Exception):
    def __init__(self, code, message):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class WechatProvider:
    def __init__(self, name: str, app_id: str, app_secret: str, redirect_uri: str):
        self.name = name
        self.app_id = app_id
        self.app_secret = app_secret
        self.redirect_uri = redirect_uri


def _provider_redirect_uri(redirect_base: str) -> str:
    return f"{redirect_base.rstrip('/')}/api/auth/wechat/callback"


def get_provider(name: str = "wechat"):
    """按 provider 名读取环境变量；未配置返回 None。"""
    prefix = "WECHAT_"
    app_id = os.getenv(f"{prefix}APP_ID", "").strip()
    app_secret = os.getenv(f"{prefix}APP_SECRET", "").strip()
    if not app_id or not app_secret:
        return None
    redirect_base = os.getenv("WECHAT_REDIRECT_BASE", os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")).strip()
    return WechatProvider(name=name, app_id=app_id, app_secret=app_secret,
                           redirect_uri=_provider_redirect_uri(redirect_base))


def list_providers():
    return [p for p in (get_provider("wechat"),) if p]


class WechatClient:
    def __init__(self, provider: WechatProvider, api_base_url: str = WECHAT_API_BASE_URL):
        self.provider = provider
        self.api_base_url = api_base_url.rstrip("/")

    def build_authorize_url(self, state: str) -> str:
        params = {
            "appid": self.provider.app_id,
            "redirect_uri": self.provider.redirect_uri,
            "response_type": "code",
            "scope": "snsapi_login",
            "state": state,
        }
        return f"{WECHAT_AUTHORIZE_URL}?{urlencode(params)}#wechat_redirect"

    def exchange_oauth_code(self, code: str) -> dict:
        """授权码换 access_token。返回含 access_token/openid/unionid 的字典。"""
        resp = httpx.get(
            f"{self.api_base_url}/oauth2/access_token",
            params={
                "appid": self.provider.app_id,
                "secret": self.provider.app_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        return self._handle(resp)

    def get_user_info(self, access_token: str, open_id: str) -> dict:
        """拉取用户信息（nickname/headimgurl/unionid）。"""
        resp = httpx.get(
            f"{self.api_base_url}/userinfo",
            params={"access_token": access_token, "openid": open_id, "lang": "zh_CN"},
            timeout=10,
        )
        return self._handle(resp)

    @staticmethod
    def _handle(resp: httpx.Response) -> dict:
        try:
            body = resp.json()
        except ValueError:
            raise WechatError("http", f"非 JSON 响应: HTTP {resp.status_code}")
        if resp.status_code >= 400:
            msg = body.get("errmsg") or body.get("error") or ""
            raise WechatError("http", f"HTTP {resp.status_code} {msg}".strip())
        # 微信错误响应用 errcode（0 表示成功，部分接口成功无 errcode）
        if isinstance(body, dict) and body.get("errcode", 0) not in (0, None):
            raise WechatError(str(body.get("errcode")), body.get("errmsg", ""))
        if not isinstance(body, dict):
            raise WechatError("http", "微信返回结构异常")
        return body
