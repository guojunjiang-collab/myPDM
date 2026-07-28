"""许可状态机测试。"""
import base64
import json
import uuid
from datetime import date

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import models
from app.licensing import state as st
from app.licensing import verifier


@pytest.fixture
def keypair(monkeypatch):
    priv = Ed25519PrivateKey.generate()
    pub = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    monkeypatch.setattr(verifier, "_pubkey_b64", lambda: pub)
    return priv


@pytest.fixture
def host(tmp_path):
    root = tmp_path / "host"
    (root / "net" / "eth0").mkdir(parents=True)
    (root / "product_uuid").write_text("uuid-1")
    (root / "machine-id").write_text("mid-1")
    (root / "net" / "eth0" / "address").write_text("aa:bb:cc:dd:ee:ff")
    return str(root)


@pytest.fixture
def lic_dir(tmp_path, host, monkeypatch):
    d = tmp_path / "lic"
    d.mkdir()
    monkeypatch.setenv("LICENSE_DIR", str(d))
    monkeypatch.setenv("LICENSE_HOST_ROOT", host)
    st.invalidate()
    yield d
    st.invalidate()


def write_license(lic_dir, priv, host, *, expires="2027-07-28", grace=15,
                  modules=("change", "inventory", "project"), max_users=50,
                  machine_code=None, corrupt=False):
    from app.licensing import fingerprint as fp
    payload = {
        "license_id": "LIC-T-1",
        "customer": "测试客户",
        "machine_code": machine_code or fp.machine_code(host, str(lic_dir)),
        "issued_at": "2026-07-28",
        "expires_at": expires,
        "grace_days": grace,
        "max_users": max_users,
        "modules": list(modules),
        "edition": "full" if modules else "basic",
    }
    sig = priv.sign(verifier.canonical_bytes(payload))
    doc = {"payload": payload, "signature": base64.b64encode(sig).decode()}
    if corrupt:
        doc["payload"]["max_users"] = 9999
    raw = base64.b64encode(json.dumps(doc, ensure_ascii=False).encode("utf-8"))
    (lic_dir / st.LICENSE_FILENAME).write_bytes(raw)


def test_missing_when_no_file(lic_dir):
    info = st.load(force=True)
    assert info.state is st.LicenseState.MISSING
    assert st.is_write_blocked(info) is True


def test_valid_license(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host)
    info = st.load(force=True, now=date(2026, 8, 1))
    assert info.state is st.LicenseState.VALID
    assert st.is_write_blocked(info) is False
    assert info.modules == frozenset({"change", "inventory", "project"})
    assert info.days_left == 361


def test_tampered_payload(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, corrupt=True)
    info = st.load(force=True, now=date(2026, 8, 1))
    assert info.state is st.LicenseState.TAMPERED
    assert st.is_write_blocked(info) is True


def test_fingerprint_mismatch_is_tampered_without_grace(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, machine_code="dead0000-beef0000-cafe0000")
    info = st.load(force=True, now=date(2026, 8, 1))
    assert info.state is st.LicenseState.TAMPERED


def test_grace_period(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, expires="2026-08-01", grace=15)
    info = st.load(force=True, now=date(2026, 8, 2))
    assert info.state is st.LicenseState.GRACE
    assert st.is_write_blocked(info) is False
    assert info.days_left == -1


def test_last_day_of_grace_still_grace(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, expires="2026-08-01", grace=15)
    info = st.load(force=True, now=date(2026, 8, 16))
    assert info.state is st.LicenseState.GRACE


def test_readonly_after_grace(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, expires="2026-08-01", grace=15)
    info = st.load(force=True, now=date(2026, 8, 17))
    assert info.state is st.LicenseState.READONLY
    assert st.is_write_blocked(info) is True


def test_expiry_day_itself_is_valid(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, expires="2026-08-01")
    assert st.load(force=True, now=date(2026, 8, 1)).state is st.LicenseState.VALID


def test_basic_edition_denies_gated_modules(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, modules=())
    info = st.load(force=True, now=date(2026, 8, 1))
    assert st.denied_module_for_path("/api/inventory/stock", info) == "inventory"
    assert st.denied_module_for_path("/api/ecrs", info) == "change"
    assert st.denied_module_for_path("/api/ecos/123", info) == "change"
    assert st.denied_module_for_path("/api/projects", info) == "project"


def test_basic_edition_allows_core_and_notifications(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, modules=())
    info = st.load(force=True, now=date(2026, 8, 1))
    for path in ("/api/parts", "/api/documents", "/api/notifications",
                 "/api/dashboard", "/api/configurations", "/api/assistant/chat"):
        assert st.denied_module_for_path(path, info) is None


def test_full_edition_allows_gated_modules(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host)
    info = st.load(force=True, now=date(2026, 8, 1))
    assert st.denied_module_for_path("/api/inventory/stock", info) is None


def test_no_module_gating_when_untrusted(lic_dir):
    info = st.load(force=True)
    assert info.state is st.LicenseState.MISSING
    assert st.denied_module_for_path("/api/inventory", info) is None


def test_cache_returns_same_object_until_invalidated(lic_dir, keypair, host):
    write_license(lic_dir, keypair, host)
    a = st.load(force=True, now=date(2026, 8, 1))
    b = st.load(now=date(2026, 8, 1))
    assert a is b
    st.invalidate()
    assert st.load(now=date(2026, 8, 1)) is not a


def test_user_quota(db, lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, max_users=2)
    info = st.load(force=True, now=date(2026, 8, 1))
    for i in range(2):
        db.add(models.User(id=uuid.uuid4(), username=f"u{i}", password_hash="x",
                           real_name="X", role="engineer", status="active"))
    db.commit()
    assert st.count_active_users(db) == 2
    with pytest.raises(st.LicenseQuotaError):
        st.check_user_quota(db, info)


def test_disabled_users_do_not_count(db, lic_dir, keypair, host):
    write_license(lic_dir, keypair, host, max_users=2)
    info = st.load(force=True, now=date(2026, 8, 1))
    db.add(models.User(id=uuid.uuid4(), username="a", password_hash="x",
                       real_name="X", role="engineer", status="active"))
    db.add(models.User(id=uuid.uuid4(), username="b", password_hash="x",
                       real_name="X", role="engineer", status="disabled"))
    db.commit()
    assert st.count_active_users(db) == 1
    st.check_user_quota(db, info)
