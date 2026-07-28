"""签发工具与验证端一致性测试。"""
import base64
import importlib.util
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.licensing import verifier

ISSUER_DIR = Path(__file__).resolve().parents[2] / "tools" / "license_issuer"


def load_module(name):
    if str(ISSUER_DIR) not in sys.path:
        sys.path.insert(0, str(ISSUER_DIR))
    spec = importlib.util.spec_from_file_location(
        f"issuer_{name}", ISSUER_DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def issue_mod():
    return load_module("issue")


@pytest.fixture
def canonical_mod():
    return load_module("canonical")


def test_canonical_matches_verifier(canonical_mod):
    payload = {"z": 1, "a": "某某机械", "m": [1, 2]}
    assert canonical_mod.canonical_bytes(payload) == verifier.canonical_bytes(payload)


def test_edition_expands_to_modules(issue_mod):
    assert issue_mod.EDITION_MODULES["basic"] == ()
    assert set(issue_mod.EDITION_MODULES["full"]) == {"change", "inventory", "project"}


def test_basic_payload_has_no_modules(issue_mod):
    p = issue_mod.build_payload(
        license_id="LIC-1", customer="A", machine_code="a-b-c",
        issued_at="2026-07-28", expires_at="2027-07-28",
        grace_days=15, max_users=10, edition="basic")
    assert p["modules"] == []


def test_explicit_modules_override_edition(issue_mod):
    p = issue_mod.build_payload(
        license_id="LIC-1", customer="A", machine_code="a-b-c",
        issued_at="2026-07-28", expires_at="2027-07-28",
        grace_days=15, max_users=10, edition="full", modules=["inventory"])
    assert p["modules"] == ["inventory"]


def test_issued_license_verifies(issue_mod, monkeypatch):
    priv = Ed25519PrivateKey.generate()
    pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption())
    pub = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    monkeypatch.setattr(verifier, "_pubkey_b64", lambda: pub)

    payload = issue_mod.build_payload(
        license_id="LIC-9", customer="某某机械有限公司", machine_code="a-b-c",
        issued_at="2026-07-28", expires_at="2027-07-28",
        grace_days=15, max_users=50, edition="full")
    raw = issue_mod.sign_payload(payload, pem)

    parsed = verifier.verify_and_parse(raw)
    assert parsed["customer"] == "某某机械有限公司"
    assert set(parsed["modules"]) == {"change", "inventory", "project"}


def test_unknown_edition_rejected(issue_mod):
    with pytest.raises(ValueError):
        issue_mod.build_payload(
            license_id="LIC-1", customer="A", machine_code="a-b-c",
            issued_at="2026-07-28", expires_at="2027-07-28",
            grace_days=15, max_users=10, edition="enterprise")
