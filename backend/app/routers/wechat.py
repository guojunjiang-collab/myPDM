"""微信免登路由（PC 扫码登录）：config / authorize / callback / bind-intent / bindings。"""
import os
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud, models
from ..database import get_db
from ..wechat_client import WechatClient, WechatError, get_provider, list_providers
from .auth import (
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    create_refresh_token,
    get_current_user_pwchange,
)

router = APIRouter(prefix="/auth/wechat", tags=["微信认证"])

WECHAT_STATE_EXPIRE_MINUTES = 10
WECHAT_BIND_EXPIRE_MINUTES = 10


class BindIntentRequest(BaseModel):
    provider: str


def _redirect_base() -> str:
    return os.getenv("WECHAT_REDIRECT_BASE", os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")).rstrip("/")


def _sign_state(provider: str, user_id: str | None = None) -> str:
    payload = {
        "provider": provider,
        "typ": "wechat_state",
        "exp": datetime.utcnow() + timedelta(minutes=WECHAT_STATE_EXPIRE_MINUTES),
    }
    if user_id:
        payload["mode"] = "binding"
        payload["user_id"] = user_id
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "wechat_state":
            raise KeyError
        return payload
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="state 无效或已过期")


def _sign_intent(user_id, provider: str) -> str:
    payload = {
        "typ": "wechat_bind_intent",
        "user_id": str(user_id),
        "provider": provider,
        "exp": datetime.utcnow() + timedelta(minutes=WECHAT_BIND_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_intent(intent: str) -> dict:
    try:
        payload = jwt.decode(intent, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "wechat_bind_intent":
            raise KeyError
        return payload
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="绑定意图无效或已过期")


def _provider_or_400(name: str):
    provider = get_provider(name)
    if not provider:
        raise HTTPException(status_code=400, detail=f"provider 未配置: {name}")
    return provider


def _login_response(user):
    return {
        "access_token": create_access_token({"sub": user.username, "role": user.role}),
        "refresh_token": create_refresh_token(user.username),
        "token_type": "bearer",
    }


def _fetch_user_info(code: str, provider_name: str) -> dict:
    """换取 access_token + 用户信息，返回统一结构 {union_id, open_id, name, avatar_url}。

    union_id 优先取微信返回的 unionid；未返回（单应用未开通 unionid）时回退 openid，
    保证绑定唯一键始终存在。
    """
    provider = _provider_or_400(provider_name)
    client = WechatClient(provider)
    try:
        token_data = client.exchange_oauth_code(code)
        access_token = token_data["access_token"]
        open_id = token_data["openid"]
        user_info = client.get_user_info(access_token, open_id)
    except WechatError as exc:
        raise HTTPException(status_code=502, detail=f"微信接口错误: {exc.message}")
    except KeyError as exc:
        raise HTTPException(status_code=502, detail=f"微信返回数据缺少字段: {exc}")
    union_id = user_info.get("unionid") or open_id
    if not union_id:
        raise HTTPException(status_code=502, detail="微信未返回可用身份标识")
    return {
        "union_id": union_id,
        "open_id": open_id,
        "name": user_info.get("nickname"),
        "avatar_url": user_info.get("headimgurl"),
    }


def _authenticate(code: str, provider_name: str, db: Session):
    user_info = _fetch_user_info(code, provider_name)
    user = crud.find_or_create_wechat_user(db, provider_name, user_info)
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已禁用")
    return user


def _error_redirect(detail: str) -> RedirectResponse:
    return RedirectResponse(f"{_redirect_base()}/wechat-callback#error={quote(detail)}")


@router.get("/config")
def wechat_config():
    return {
        "providers": [
            {
                "key": p.name,
                "name": "微信登录",
                "app_id": p.app_id,
            }
            for p in list_providers()
        ]
    }


@router.get("/authorize")
def wechat_authorize(provider: str, intent: str | None = None):
    provider_cfg = _provider_or_400(provider)
    if intent:
        payload = _verify_intent(intent)
        if payload.get("provider") != provider:
            raise HTTPException(status_code=400, detail="绑定意图与 provider 不匹配")
        state = _sign_state(provider, user_id=payload["user_id"])
    else:
        state = _sign_state(provider)
    client = WechatClient(provider_cfg)
    return RedirectResponse(client.build_authorize_url(state))


@router.get("/callback")
def wechat_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        payload = _verify_state(state)
        provider_name = payload["provider"]
        user_info = _fetch_user_info(code, provider_name)
        if payload.get("mode") == "binding":
            user_id = payload["user_id"]
            crud.bind_wechat_to_user(
                db, provider_name, user_info["union_id"], uuid.UUID(user_id), user_info,
            )
            fragment = urlencode({
                "mode": "binding", "result": "success", "provider": provider_name,
            })
            return RedirectResponse(f"{_redirect_base()}/wechat-callback#{fragment}")
        user = crud.find_or_create_wechat_user(db, provider_name, user_info)
        if user.status != "active":
            raise HTTPException(status_code=403, detail="账号已禁用")
        fragment = urlencode(_login_response(user))
        return RedirectResponse(f"{_redirect_base()}/wechat-callback#{fragment}")
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    except ValueError as exc:
        fragment = urlencode({
            "mode": "binding", "result": "error",
            "provider": payload.get("provider", ""), "message": str(exc),
        })
        return RedirectResponse(f"{_redirect_base()}/wechat-callback#{fragment}")


@router.post("/bind-intent")
def wechat_bind_intent(
    req: BindIntentRequest,
    current_user: models.User = Depends(get_current_user_pwchange),
):
    _provider_or_400(req.provider)
    return {"intent": _sign_intent(current_user.id, req.provider)}


@router.get("/bindings")
def wechat_bindings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_pwchange),
):
    rows = crud.get_user_wechat_bindings(db, current_user.id)
    return {
        "bindings": [
            {
                "provider": b.provider,
                "name": b.name,
                "avatar_url": b.avatar_url,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in rows
        ]
    }


@router.delete("/bindings/{provider}")
def wechat_unbind(
    provider: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_pwchange),
):
    """解除当前用户指定微信入口的绑定。"""
    n = crud.unbind_wechat(db, current_user.id, provider)
    if n == 0:
        raise HTTPException(404, "未找到该绑定记录")
    return {"detail": "已解除绑定"}
