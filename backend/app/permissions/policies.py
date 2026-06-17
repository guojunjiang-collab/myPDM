from fastapi import HTTPException

from ..models import User

_POLICY_FUNCS: dict = {}


def register_policy(name: str):
    def deco(fn):
        _POLICY_FUNCS[name] = fn
        return fn
    return deco


def enforce_object_policy(name: str, user: User, obj, **ctx) -> None:
    fn = _POLICY_FUNCS.get(name)
    if fn is None:
        raise KeyError(f"Unregistered object policy: {name}")
    if not fn(user, obj, **ctx):
        raise HTTPException(status_code=403, detail="无权操作该对象")
