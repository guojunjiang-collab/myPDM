"""飞书免登路由：config / authorize / callback / jsapi。"""
import os
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud
from ..database import get_db
from ..feishu_client import FeishuClient, FeishuError, get_provider, list_providers
from .auth import ALGORITHM, SECRET_KEY, create_access_token, create_refresh_token

router = APIRouter(prefix="/auth/feishu", tags=["飞书认证"])

FEISHU_STATE_EXPIRE_MINUTES = 10


class JsapiRequest(BaseModel):
    provider: str
    code: str


def _redirect_base() -> str:
    return os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080").rstrip("/")


def _sign_state(provider: str) -> str:
    payload = {
        "provider": provider,
        "typ": "feishu_state",
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_state":
            raise KeyError
        return payload["provider"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="state 无效或已过期")


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


def _authenticate(code: str, provider_name: str, jsapi: bool, db: Session):
    provider = _provider_or_400(provider_name)
    client = FeishuClient(provider)
    try:
        token_data = client.exchange_jsapi_code(code) if jsapi else client.exchange_oauth_code(code)
        user_info = client.get_user_info(token_data["access_token"])
    except FeishuError as exc:
        raise HTTPException(status_code=502, detail=f"飞书接口错误: {exc.message}")
    except KeyError:
        raise HTTPException(status_code=502, detail="飞书返回数据缺少 access_token")
    union_id = user_info.get("union_id")
    if not union_id:
        raise HTTPException(status_code=502, detail="飞书未返回 union_id")
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
def feishu_authorize(provider: str):
    provider_cfg = _provider_or_400(provider)
    state = _sign_state(provider)
    client = FeishuClient(provider_cfg)
    return RedirectResponse(client.build_authorize_url(state))


@router.get("/callback")
def feishu_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        provider_name = _verify_state(state)
        user = _authenticate(code, provider_name, jsapi=False, db=db)
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    fragment = urlencode(_login_response(user))
    return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")


@router.post("/jsapi")
def feishu_jsapi(req: JsapiRequest, db: Session = Depends(get_db)):
    user = _authenticate(req.code, req.provider, jsapi=True, db=db)
    return _login_response(user)
