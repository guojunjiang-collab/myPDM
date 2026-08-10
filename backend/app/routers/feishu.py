"""飞书免登路由：config / authorize / callback / jsapi。"""
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
from ..feishu_client import FeishuClient, FeishuError, get_provider, list_providers
from .auth import (
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    create_refresh_token,
    get_current_user_pwchange,
)

router = APIRouter(prefix="/auth/feishu", tags=["飞书认证"])

FEISHU_STATE_EXPIRE_MINUTES = 10
FEISHU_BIND_EXPIRE_MINUTES = 10


class JsapiRequest(BaseModel):
    provider: str
    code: str


class BindIntentRequest(BaseModel):
    provider: str


def _redirect_base() -> str:
    return os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080").rstrip("/")


def _sign_state(provider: str, user_id: str | None = None) -> str:
    payload = {
        "provider": provider,
        "typ": "feishu_state",
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_STATE_EXPIRE_MINUTES),
    }
    if user_id:
        payload["mode"] = "binding"
        payload["user_id"] = user_id
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_state":
            raise KeyError
        return payload
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="state 无效或已过期")


def _sign_intent(user_id, provider: str) -> str:
    payload = {
        "typ": "feishu_bind_intent",
        "user_id": str(user_id),
        "provider": provider,
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_BIND_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_intent(intent: str) -> dict:
    try:
        payload = jwt.decode(intent, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_bind_intent":
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


def _fetch_user_info(code: str, provider_name: str, jsapi: bool = False) -> dict:
    provider = _provider_or_400(provider_name)
    client = FeishuClient(provider)
    try:
        token_data = client.exchange_jsapi_code(code) if jsapi else client.exchange_oauth_code(code)
        user_info = client.get_user_info(token_data["access_token"])
    except FeishuError as exc:
        raise HTTPException(status_code=502, detail=f"飞书接口错误: {exc.message}")
    except KeyError:
        raise HTTPException(status_code=502, detail="飞书返回数据缺少 access_token")
    if not user_info.get("union_id"):
        raise HTTPException(status_code=502, detail="飞书未返回 union_id")
    return user_info


def _authenticate(code: str, provider_name: str, jsapi: bool, db: Session):
    user_info = _fetch_user_info(code, provider_name, jsapi=jsapi)
    user = crud.find_or_create_feishu_user(db, provider_name, user_info)
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已禁用")
    return user


def _error_redirect(detail: str) -> RedirectResponse:
    return RedirectResponse(f"{_redirect_base()}/feishu-callback#error={quote(detail)}")


@router.get("/config")
def feishu_config():
    return {
        "providers": [
            {
                "key": p.name,
                "name": "飞书登录" if p.name == "feishu" else "飞书登录（EH）",
                "app_id": p.app_id,
                "jsapi": True,
            }
            for p in list_providers()
        ]
    }


@router.get("/authorize")
def feishu_authorize(provider: str, intent: str | None = None):
    provider_cfg = _provider_or_400(provider)
    if intent:
        payload = _verify_intent(intent)
        if payload.get("provider") != provider:
            raise HTTPException(status_code=400, detail="绑定意图与 provider 不匹配")
        state = _sign_state(provider, user_id=payload["user_id"])
    else:
        state = _sign_state(provider)
    client = FeishuClient(provider_cfg)
    return RedirectResponse(client.build_authorize_url(state))


@router.get("/callback")
def feishu_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        payload = _verify_state(state)
        provider_name = payload["provider"]
        user_info = _fetch_user_info(code, provider_name)
        if payload.get("mode") == "binding":
            user_id = payload["user_id"]
            crud.bind_feishu_to_user(
                db, provider_name, user_info["union_id"], uuid.UUID(user_id), user_info,
            )
            fragment = urlencode({
                "mode": "binding", "result": "success", "provider": provider_name,
            })
            return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")
        user = crud.find_or_create_feishu_user(db, provider_name, user_info)
        if user.status != "active":
            raise HTTPException(status_code=403, detail="账号已禁用")
        fragment = urlencode(_login_response(user))
        return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    except ValueError as exc:
        fragment = urlencode({
            "mode": "binding", "result": "error",
            "provider": payload.get("provider", ""), "message": str(exc),
        })
        return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")


@router.post("/bind-intent")
def feishu_bind_intent(
    req: BindIntentRequest,
    current_user: models.User = Depends(get_current_user_pwchange),
):
    _provider_or_400(req.provider)
    return {"intent": _sign_intent(current_user.id, req.provider)}


@router.get("/bindings")
def feishu_bindings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_pwchange),
):
    rows = crud.get_user_feishu_bindings(db, current_user.id)
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
def feishu_unbind(
    provider: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_pwchange),
):
    """解除当前用户指定飞书入口的绑定。"""
    n = crud.unbind_feishu(db, current_user.id, provider)
    if n == 0:
        raise HTTPException(404, "未找到该绑定记录")
    return {"detail": "已解除绑定"}


@router.post("/jsapi")
def feishu_jsapi(req: JsapiRequest, db: Session = Depends(get_db)):
    user = _authenticate(req.code, req.provider, jsapi=True, db=db)
    return _login_response(user)
