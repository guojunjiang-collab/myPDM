from datetime import datetime, timedelta
from fastapi import HTTPException
from jose import JWTError, jwt

from .routers.auth import SECRET_KEY, ALGORITHM


def mint_media_token(attachment_id: str, action: str, ttl: int = 300) -> str:
    expire = datetime.utcnow() + timedelta(seconds=ttl)
    return jwt.encode(
        {"aid": str(attachment_id), "act": action, "typ": "media", "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def verify_media_token(token: str, attachment_id: str, action: str) -> bool:
    if not token:
        raise HTTPException(status_code=401, detail="缺少媒体令牌")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="媒体令牌验证失败")
    if payload.get("typ") != "media" or payload.get("aid") != str(attachment_id) or payload.get("act") != action:
        raise HTTPException(status_code=403, detail="媒体令牌作用域不匹配")
    return True
