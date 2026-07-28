"""测试用 license 生成辅助。"""
import base64
import json
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.licensing import fingerprint as fp
from app.licensing import state as st
from app.licensing import verifier

TEST_PRIVATE_KEY = Ed25519PrivateKey.generate()
TEST_PUBLIC_KEY_B64 = base64.b64encode(
    TEST_PRIVATE_KEY.public_key().public_bytes_raw()
).decode()

FULL_MODULES = ("change", "inventory", "project")


def build_host(root: Path) -> str:
    (root / "net" / "eth0").mkdir(parents=True, exist_ok=True)
    (root / "product_uuid").write_text("test-uuid")
    (root / "machine-id").write_text("test-machine-id")
    (root / "net" / "eth0" / "address").write_text("aa:bb:cc:dd:ee:ff")
    return str(root)


def write_license_file(lic_dir: Path, host_root: str, *,
                       expires="2099-12-31", grace=15,
                       modules=FULL_MODULES, max_users=100000,
                       machine_code=None) -> None:
    payload = {
        "license_id": "LIC-TEST",
        "customer": "测试客户",
        "machine_code": machine_code or fp.machine_code(host_root, str(lic_dir)),
        "issued_at": "2026-01-01",
        "expires_at": expires,
        "grace_days": grace,
        "max_users": max_users,
        "modules": list(modules),
        "edition": "full" if set(modules) == set(FULL_MODULES) else "basic",
    }
    sig = TEST_PRIVATE_KEY.sign(verifier.canonical_bytes(payload))
    doc = {"payload": payload, "signature": base64.b64encode(sig).decode()}
    lic_dir.mkdir(parents=True, exist_ok=True)
    (lic_dir / st.LICENSE_FILENAME).write_bytes(
        base64.b64encode(json.dumps(doc, ensure_ascii=False).encode("utf-8"))
    )


def install_license(monkeypatch, **kwargs) -> Path:
    """在临时目录装一份 license 并指向它。返回 license 目录。"""
    tmp = Path(tempfile.mkdtemp())
    host = build_host(tmp / "host")
    lic_dir = tmp / "lic"
    monkeypatch.setattr(verifier, "_pubkey_b64", lambda: TEST_PUBLIC_KEY_B64)
    monkeypatch.setenv("LICENSE_HOST_ROOT", host)
    monkeypatch.setenv("LICENSE_DIR", str(lic_dir))
    write_license_file(lic_dir, host, **kwargs)
    st.invalidate()
    return lic_dir
