"""license 文件验签与解析。

安全说明：公钥字面量位于 _pubkey_b64() 函数体内。该文件经 Cython 编译为 .so 后，
函数被编译为 C 函数，外部无法通过模块属性赋值替换。请勿把公钥提升为模块级常量。
"""
import base64
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

_PUBKEY_PLACEHOLDER = "@@LICENSE_PUBKEY@@"

REQUIRED_FIELDS = (
    "license_id", "customer", "machine_code", "issued_at",
    "expires_at", "grace_days", "max_users", "modules", "edition",
)


class LicenseError(Exception):
    """license 缺失、格式非法或验签失败。"""


def _pubkey_b64() -> str:
    return _PUBKEY_PLACEHOLDER


def canonical_bytes(payload: dict) -> bytes:
    """payload 的规范化字节表示。签发端与验证端必须使用同一实现。"""
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _verify_with_key(raw: bytes, public_key_b64: str) -> dict:
    try:
        doc = json.loads(base64.b64decode(raw, validate=True))
    except Exception as exc:
        raise LicenseError(f"license 文件格式非法: {exc}") from exc

    if not isinstance(doc, dict) or "payload" not in doc or "signature" not in doc:
        raise LicenseError("license 文件缺少 payload 或 signature 字段")

    payload = doc["payload"]
    if not isinstance(payload, dict):
        raise LicenseError("license payload 不是对象")

    missing = [f for f in REQUIRED_FIELDS if f not in payload]
    if missing:
        raise LicenseError(f"license payload 缺少字段: {','.join(missing)}")

    try:
        key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(public_key_b64, validate=True)
        )
        key.verify(base64.b64decode(doc["signature"], validate=True),
                   canonical_bytes(payload))
    except InvalidSignature as exc:
        raise LicenseError("license 签名校验失败") from exc
    except Exception as exc:
        raise LicenseError(f"license 签名校验异常: {exc}") from exc

    return payload


def verify_and_parse(raw: bytes) -> dict:
    """用内置公钥验签并返回 payload。失败抛 LicenseError。"""
    return _verify_with_key(raw, _pubkey_b64())
