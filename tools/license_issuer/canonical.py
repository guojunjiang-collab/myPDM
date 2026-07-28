"""payload 规范化序列化。必须与 backend/app/licensing/verifier.py 的实现逐字节一致。"""
import json


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
