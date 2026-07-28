"""宿主机硬件指纹采集与容错匹配。

三源特征均取自宿主机（容器内 MAC/hostname 每次重建都变，不可用），
通过 docker-compose 只读挂载到 /host 下。
"""
import hashlib
import os
import uuid as _uuid
from pathlib import Path

SENTINEL = "00000000"
FALLBACK_PREFIX = "DOCKER-"
_VIRTUAL_IFACE_PREFIXES = ("lo", "docker", "veth", "br-", "virbr", "tun", "tap")


def _host_root(host_root: str | None) -> Path:
    return Path(host_root or os.getenv("LICENSE_HOST_ROOT", "/host"))


def _fallback_dir(fallback_dir: str | None) -> Path:
    return Path(fallback_dir or os.getenv("LICENSE_DIR", "/app/uploads/license"))


def _read_text(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return None
    return value or None


def _read_mac(net_dir: Path) -> str | None:
    try:
        names = sorted(p.name for p in net_dir.iterdir())
    except OSError:
        return None
    for name in names:
        if name.startswith(_VIRTUAL_IFACE_PREFIXES):
            continue
        addr = _read_text(net_dir / name / "address")
        if addr and addr != "00:00:00:00:00:00":
            return addr
    return None


def read_sources(host_root: str | None = None) -> dict:
    root = _host_root(host_root)
    return {
        "uuid": _read_text(root / "product_uuid"),
        "machine_id": _read_text(root / "machine-id"),
        "mac": _read_mac(root / "net"),
    }


def _seg(value: str | None) -> str:
    if not value:
        return SENTINEL
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]


def _fallback_code(fallback_dir: str | None) -> str:
    directory = _fallback_dir(fallback_dir)
    directory.mkdir(parents=True, exist_ok=True)
    marker = directory / ".machine"
    value = _read_text(marker)
    if not value:
        value = _uuid.uuid4().hex[:8]
        marker.write_text(value, encoding="utf-8")
    return f"{FALLBACK_PREFIX}{value}"


def machine_code(host_root: str | None = None,
                 fallback_dir: str | None = None) -> str:
    src = read_sources(host_root)
    if not any(src.values()):
        return _fallback_code(fallback_dir)
    return "-".join([_seg(src["uuid"]), _seg(src["machine_id"]), _seg(src["mac"])])


def matches(expected: str, host_root: str | None = None,
            fallback_dir: str | None = None) -> bool:
    actual = machine_code(host_root, fallback_dir)
    if expected.startswith(FALLBACK_PREFIX) or actual.startswith(FALLBACK_PREFIX):
        return expected == actual

    exp_segs = expected.split("-")
    act_segs = actual.split("-")
    if len(exp_segs) != 3 or len(act_segs) != 3:
        return False

    comparable = [
        i for i in range(3)
        if exp_segs[i] != SENTINEL and act_segs[i] != SENTINEL
    ]
    if not comparable:
        return False
    matched = sum(1 for i in comparable if exp_segs[i] == act_segs[i])
    if len(comparable) == 3:
        return matched >= 2
    return matched == len(comparable)
