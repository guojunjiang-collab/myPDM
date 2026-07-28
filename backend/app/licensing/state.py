"""许可状态机：综合到期、宽限、指纹、模块与用户配额。"""
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from pathlib import Path

from . import fingerprint as _fp
from .verifier import LicenseError, verify_and_parse

LICENSE_FILENAME = "license.lic"
_CACHE_TTL_SECONDS = 60

GATED_MODULES: dict[str, tuple[str, ...]] = {
    "change": ("/api/ecrs", "/api/ecos"),
    "inventory": ("/api/inventory",),
    "project": ("/api/projects",),
}


class LicenseState(str, Enum):
    VALID = "VALID"
    GRACE = "GRACE"
    READONLY = "READONLY"
    TAMPERED = "TAMPERED"
    MISSING = "MISSING"


class LicenseQuotaError(Exception):
    """启用用户数超过授权上限。"""


@dataclass(frozen=True)
class LicenseInfo:
    state: LicenseState
    payload: dict | None
    modules: frozenset[str]
    days_left: int | None
    reason: str


_cache: tuple[float, LicenseInfo] | None = None


def _license_dir() -> Path:
    return Path(os.getenv("LICENSE_DIR", "/app/uploads/license"))


def license_path() -> Path:
    return _license_dir() / LICENSE_FILENAME


def invalidate() -> None:
    global _cache
    _cache = None


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _evaluate(now: date) -> LicenseInfo:
    path = license_path()
    if not path.is_file():
        return LicenseInfo(LicenseState.MISSING, None, frozenset(), None,
                           "未找到许可证文件")

    try:
        payload = verify_and_parse(path.read_bytes())
    except LicenseError as exc:
        return LicenseInfo(LicenseState.TAMPERED, None, frozenset(), None, str(exc))
    except OSError as exc:
        return LicenseInfo(LicenseState.MISSING, None, frozenset(), None,
                           f"许可证文件不可读: {exc}")

    if not _fp.matches(payload["machine_code"]):
        return LicenseInfo(LicenseState.TAMPERED, None, frozenset(), None,
                           "许可证与本机硬件不匹配")

    try:
        expires = _parse_date(payload["expires_at"])
        grace_days = int(payload["grace_days"])
    except (ValueError, TypeError, KeyError) as exc:
        return LicenseInfo(LicenseState.TAMPERED, None, frozenset(), None,
                           f"许可证日期字段非法: {exc}")

    modules = frozenset(payload.get("modules") or [])
    days_left = (expires - now).days

    if now > expires + timedelta(days=grace_days):
        return LicenseInfo(LicenseState.READONLY, payload, modules, days_left,
                           "许可证已过期且超出宽限期")
    if now > expires:
        return LicenseInfo(LicenseState.GRACE, payload, modules, days_left,
                           f"许可证已过期，剩余 {grace_days + days_left} 天宽限期")
    return LicenseInfo(LicenseState.VALID, payload, modules, days_left, "")


def load(force: bool = False, now: date | None = None) -> LicenseInfo:
    global _cache
    if not force and _cache is not None:
        stamped_at, info = _cache
        if time.monotonic() - stamped_at < _CACHE_TTL_SECONDS:
            return info
    info = _evaluate(now or date.today())
    _cache = (time.monotonic(), info)
    return info


def is_write_blocked(info: LicenseInfo) -> bool:
    return info.state in (LicenseState.READONLY, LicenseState.TAMPERED,
                          LicenseState.MISSING)


def denied_module_for_path(path: str, info: LicenseInfo) -> str | None:
    """返回该路径所属的未授权模块 key；已授权或不可门控返回 None。"""
    if info.payload is None:
        return None
    for module, prefixes in GATED_MODULES.items():
        if module in info.modules:
            continue
        for prefix in prefixes:
            if path == prefix or path.startswith(prefix + "/"):
                return module
    return None


def count_active_users(db) -> int:
    from ..models import User
    return db.query(User).filter(User.status == "active").count()


def check_user_quota(db, info: LicenseInfo | None = None) -> None:
    """启用用户数达上限时抛 LicenseQuotaError。"""
    info = info if info is not None else load()
    if info.payload is None:
        return
    max_users = int(info.payload.get("max_users") or 0)
    if max_users <= 0:
        return
    if count_active_users(db) >= max_users:
        raise LicenseQuotaError(
            f"已达授权用户数上限 {max_users}，请联系供应商扩容"
        )
