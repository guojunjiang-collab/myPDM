"""license 验签与 canonical 序列化测试。"""
import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.licensing import verifier
from app.licensing.verifier import LicenseError


PAYLOAD = {
    "license_id": "LIC-2026-0001",
    "customer": "某某机械有限公司",
    "machine_code": "a3f29c81-4d07e5b2-77c10fa9",
    "issued_at": "2026-07-28",
    "expires_at": "2027-07-28",
    "grace_days": 15,
    "max_users": 50,
    "modules": ["change", "inventory", "project"],
    "edition": "full",
}


def make_keypair():
    priv = Ed25519PrivateKey.generate()
    pub_b64 = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    return priv, pub_b64


def make_license(priv, payload=None) -> bytes:
    payload = payload if payload is not None else PAYLOAD
    sig = priv.sign(verifier.canonical_bytes(payload))
    doc = {"payload": payload, "signature": base64.b64encode(sig).decode()}
    return base64.b64encode(
        json.dumps(doc, ensure_ascii=False).encode("utf-8")
    )


def test_canonical_bytes_is_key_order_independent():
    a = {"b": 1, "a": 2, "z": [3, 4]}
    b = {"z": [3, 4], "a": 2, "b": 1}
    assert verifier.canonical_bytes(a) == verifier.canonical_bytes(b)


def test_canonical_bytes_has_no_whitespace_and_keeps_utf8():
    out = verifier.canonical_bytes({"customer": "某某机械", "n": 1})
    assert b" " not in out
    assert "某某机械".encode("utf-8") in out


def test_valid_license_parses():
    priv, pub = make_keypair()
    payload = verifier._verify_with_key(make_license(priv), pub)
    assert payload["license_id"] == "LIC-2026-0001"
    assert payload["modules"] == ["change", "inventory", "project"]


def test_tampered_payload_rejected():
    priv, pub = make_keypair()
    raw = make_license(priv)
    doc = json.loads(base64.b64decode(raw))
    doc["payload"]["max_users"] = 9999
    bad = base64.b64encode(json.dumps(doc, ensure_ascii=False).encode("utf-8"))
    with pytest.raises(LicenseError):
        verifier._verify_with_key(bad, pub)


def test_signature_from_other_key_rejected():
    priv_a, pub_a = make_keypair()
    priv_b, _ = make_keypair()
    with pytest.raises(LicenseError):
        verifier._verify_with_key(make_license(priv_b), pub_a)


def test_garbage_input_rejected():
    _, pub = make_keypair()
    with pytest.raises(LicenseError):
        verifier._verify_with_key(b"not-base64-at-all!!!", pub)


def test_missing_signature_field_rejected():
    _, pub = make_keypair()
    bad = base64.b64encode(json.dumps({"payload": PAYLOAD}).encode())
    with pytest.raises(LicenseError):
        verifier._verify_with_key(bad, pub)


def test_verify_and_parse_uses_injected_pubkey(monkeypatch):
    priv, pub = make_keypair()
    monkeypatch.setattr(verifier, "_pubkey_b64", lambda: pub)
    payload = verifier.verify_and_parse(make_license(priv))
    assert payload["edition"] == "full"
