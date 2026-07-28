# 商业许可认证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 myPDM 增加基于 Ed25519 签名 license 文件的商业许可认证，控制到期时间、用户数、功能模块与硬件绑定四个维度。

**Architecture:** 新增自包含模块 `backend/app/licensing/`，业务代码零耦合。license 为 Base64 编码的 JSON（payload + Ed25519 签名），落盘于 uploads 卷。一个 FastAPI 中间件按状态机结论拦截请求：过期超宽限或验签失败 → 只读降级；未授权模块 → 全方法 403。硬件指纹取宿主机三源特征，≥2 段匹配即同机。核心校验三文件用 Cython 编译为 `.so`，生产 compose 去除后端源码卷挂载。

**Tech Stack:** Python 3.12 / FastAPI 0.115 / SQLAlchemy 2.0 / `cryptography`（新增依赖）/ Cython（仅构建期）/ React + TypeScript + zustand + axios / pytest 8.3

**Spec:** `docs/superpowers/specs/2026-07-28-license-authentication-design.md`

---

## Global Constraints

- 后端 Python 3.12，依赖固定版本写入 `backend/requirements.txt`；新增且仅新增 `cryptography==44.0.0`
- **不得改动 `httpx==0.27.2`**（openai 1.55 仍向 httpx 传 `proxies=`，0.28 已移除会报错）
- 用户「启用」状态字段是 `models.User.status == "active"`，**不是** `is_active`（spec §5.3 表述有误，以本计划为准）
- FastAPI 文档路由是 `/api/docs`、`/api/redoc`、`/api/openapi.json`（**不是** `/docs`；spec §5.2 白名单表述有误，以本计划为准）
- 许可页面实现为 `Settings.tsx` 的一个 tab（key = `license`，adminOnly），**不是** 新路由 `/settings/license`（spec §7 表述有误，以本计划为准 —— 现有系统设置就是 tab 结构）
- 权限必须走 `permissions/permissions.json` + `python tools/gen_permissions.py` 生成，**禁止**手改 `_generated.py` / `permissions.generated.ts`
- 测试遵循现有约定：`TestClient(app)`（不用 `with`，避免触发 startup 连 PostgreSQL）、`app.dependency_overrides` 覆盖 `get_db` 与 `get_current_active_user`
- 所有面向客户的提示文案用中文
- 私钥文件、`issued.csv` 台账、`keys/` 目录必须进 `.gitignore`
- 前端沿用现有风格：Tailwind、`border-blue-500`/`text-blue-600` 选中态、共享 `Modal`/`ConfirmModal`、`Toast`
- 提交信息用中文，格式 `feat: xxx` / `test: xxx` / `chore: xxx`

## 模块门控范围（唯一权威定义）

只有 3 个模块可门控，其余路由恒开：

| 模块 key | 路由前缀 |
|---|---|
| `change` | `/api/ecrs`、`/api/ecos` |
| `inventory` | `/api/inventory` |
| `project` | `/api/projects` |

`/api/notifications` **不门控**。基础版 `modules = []`，全量版 `modules = ["change","inventory","project"]`。

## File Structure

**后端新建**
- `backend/app/licensing/__init__.py` — 导出 `LicenseState`、`load`、`invalidate`
- `backend/app/licensing/verifier.py` — canonical 序列化 + Ed25519 验签（**编译 .so**）
- `backend/app/licensing/fingerprint.py` — 宿主机三源指纹采集与比对（**编译 .so**）
- `backend/app/licensing/state.py` — 状态机、模块门控表、用户配额（**编译 .so**）
- `backend/app/licensing/middleware.py` — FastAPI 中间件（.pyc）
- `backend/app/licensing/router.py` — 3 个 HTTP 接口（.pyc）
- `backend/app/models_license.py` — `licenses` 审计表
- `backend/app/migrations_license.py` — 建表迁移（幂等）

**后端修改**
- `backend/app/main.py` — 注册中间件（须在 CORS 之前 add）与路由、调用迁移
- `backend/app/routers/users.py` — 创建/启用用户时校验配额
- `backend/requirements.txt` — 加 `cryptography`
- `backend/tests/conftest.py` — 全局测试 license fixture（否则现有 94 个测试全挂）
- `backend/Dockerfile` — Cython 编译阶段
- `permissions/permissions.json` — 新增 `license:read`、`license:manage`

**后端测试新建**
- `backend/tests/test_license_verifier.py`
- `backend/tests/test_license_fingerprint.py`
- `backend/tests/test_license_state.py`
- `backend/tests/test_license_middleware.py`
- `backend/tests/test_license_api.py`
- `backend/tests/test_license_quota.py`
- `backend/tests/test_license_issuer.py`

**签发工具新建（不进镜像、不进交付物）**
- `tools/license_issuer/keygen.py`
- `tools/license_issuer/issue.py`
- `tools/license_issuer/canonical.py` — 与 `verifier.py` 共用的序列化定义

**前端新建**
- `frontend/src/services/licenseApi.ts`
- `frontend/src/stores/license.ts`
- `frontend/src/components/LicenseBanner.tsx`
- `frontend/src/components/settings/LicenseTab.tsx`

**前端修改**
- `frontend/src/types/index.ts` — `LicenseStatus` 类型
- `frontend/src/components/Layout.tsx` — 横幅挂载 + 菜单模块门控
- `frontend/src/pages/Settings.tsx` — 新增 `license` tab
- `frontend/src/services/api.ts` — 403 响应体含 `license_state` 时统一提示

**部署新建**
- `docker-compose.prod.yml`

---

## Task 1: license 验签与 canonical 序列化

**Files:**
- Create: `backend/app/licensing/__init__.py`
- Create: `backend/app/licensing/verifier.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_license_verifier.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `canonical_bytes(payload: dict) -> bytes`
  - `verify_and_parse(raw: bytes) -> dict` — `raw` 是 `.lic` 文件原始字节；成功返回 payload dict，失败抛 `LicenseError`
  - `_verify_with_key(raw: bytes, public_key_b64: str) -> dict` — 内部可测版本
  - `_pubkey_b64() -> str` — 返回编译期注入的公钥
  - `class LicenseError(Exception)`

**设计说明（实现者必读）：** 公钥不做成模块级常量，而是放在 `_pubkey_b64()` 函数体内的字面量。Cython 编译后该函数被标记为 C 函数，外部 Python 代码无法通过属性赋值替换它。未编译的开发/测试环境里它是普通函数，测试通过 monkeypatch 它来注入测试公钥——这条测试通路只在未编译构建中存在，是可接受的取舍。

- [ ] **Step 1: 加依赖**

在 `backend/requirements.txt` 末尾追加一行（**不要动其他任何行**）：

```
cryptography==44.0.0
```

- [ ] **Step 2: 安装依赖并确认可导入**

```bash
cd backend && pip install cryptography==44.0.0 && python -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey; print('ok')"
```

Expected: 输出 `ok`

- [ ] **Step 3: 写失败测试**

创建 `backend/tests/test_license_verifier.py`：

```python
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
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_verifier.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.licensing'`

- [ ] **Step 5: 实现 verifier**

创建 `backend/app/licensing/__init__.py`：

```python
"""商业许可认证模块。"""
```

创建 `backend/app/licensing/verifier.py`：

```python
"""license 文件验签与解析。

安全说明：公钥字面量位于 _pubkey_b64() 函数体内。该文件经 Cython 编译为 .so 后，
函数被编译为 C 函数，外部无法通过模块属性赋值替换。请勿把公钥提升为模块级常量。
"""
import base64
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

# 构建期由 Dockerfile 用 --build-arg LICENSE_PUBKEY 替换下面这行的占位串
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
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_verifier.py -v
```

Expected: 8 passed

- [ ] **Step 7: 提交**

```bash
git add backend/requirements.txt backend/app/licensing/ backend/tests/test_license_verifier.py
git commit -m "feat: license Ed25519 验签与 canonical 序列化"
```

---

## Task 2: 宿主机硬件指纹

**Files:**
- Create: `backend/app/licensing/fingerprint.py`
- Test: `backend/tests/test_license_fingerprint.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SENTINEL = "00000000"` — 某一源不可读时该段的占位值
  - `read_sources(host_root: str | None = None) -> dict` — 返回 `{"uuid": str|None, "machine_id": str|None, "mac": str|None}`
  - `machine_code(host_root: str | None = None, fallback_dir: str | None = None) -> str` — 三段式，形如 `a3f29c81-4d07e5b2-77c10fa9`
  - `matches(expected: str, host_root: str | None = None, fallback_dir: str | None = None) -> bool`

**匹配规则（精确定义）：** 把 expected 与实际各拆为 3 段。`comparable` = 两侧都不是 `SENTINEL` 的段下标集合。
- `len(comparable) == 3` → 至少 2 段相等即通过（容忍换网卡或重装系统其一）
- `0 < len(comparable) < 3` → 所有 comparable 段必须相等
- `len(comparable) == 0` → 两侧都退化为兜底码，要求整串完全相等

**路径约定：** 宿主特征挂载在 `/host` 下（`{host_root}/product_uuid`、`{host_root}/machine-id`、`{host_root}/net/<iface>/address`）。默认 `host_root` 取环境变量 `LICENSE_HOST_ROOT`，缺省 `/host`；默认 `fallback_dir` 取 `LICENSE_DIR`，缺省 `/app/uploads/license`。两者都在**调用时**读取环境变量，便于测试注入。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_license_fingerprint.py`：

```python
"""宿主机硬件指纹采集与容错匹配测试。"""
from app.licensing import fingerprint as fp


def build_host(tmp_path, uuid_val="4c4c4544-0037", machine_id="abc123", macs=None):
    """构造伪造的 /host 目录树。传 None 表示该源不可读。"""
    root = tmp_path / "host"
    root.mkdir(parents=True, exist_ok=True)
    if uuid_val is not None:
        (root / "product_uuid").write_text(uuid_val)
    if machine_id is not None:
        (root / "machine-id").write_text(machine_id)
    net = root / "net"
    net.mkdir(parents=True, exist_ok=True)
    for name, addr in (macs if macs is not None else [("eth0", "aa:bb:cc:dd:ee:ff")]):
        iface = net / name
        iface.mkdir(exist_ok=True)
        (iface / "address").write_text(addr)
    return str(root)


def test_reads_all_three_sources(tmp_path):
    host = build_host(tmp_path)
    src = fp.read_sources(host)
    assert src["uuid"] == "4c4c4544-0037"
    assert src["machine_id"] == "abc123"
    assert src["mac"] == "aa:bb:cc:dd:ee:ff"


def test_ignores_loopback_and_virtual_interfaces(tmp_path):
    host = build_host(tmp_path, macs=[
        ("lo", "00:00:00:00:00:00"),
        ("docker0", "02:42:aa:bb:cc:dd"),
        ("veth1234", "02:42:11:22:33:44"),
        ("br-abcdef", "02:42:55:66:77:88"),
        ("eth0", "aa:bb:cc:dd:ee:ff"),
    ])
    assert fp.read_sources(host)["mac"] == "aa:bb:cc:dd:ee:ff"


def test_machine_code_is_three_segments_and_stable(tmp_path):
    host = build_host(tmp_path)
    code = fp.machine_code(host, str(tmp_path))
    assert len(code.split("-")) == 3
    assert all(len(s) == 8 for s in code.split("-"))
    assert code == fp.machine_code(host, str(tmp_path))


def test_unreadable_source_becomes_sentinel(tmp_path):
    host = build_host(tmp_path, machine_id=None)
    assert fp.machine_code(host, str(tmp_path)).split("-")[1] == fp.SENTINEL


def test_all_sources_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    assert fp.matches(expected, host, str(tmp_path)) is True


def test_one_of_three_differs_still_matches(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is True


def test_two_of_three_differ_does_not_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", machine_id="zzz",
                         macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_all_three_differ_does_not_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", uuid_val="zzz", machine_id="yyy",
                         macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_partial_readable_requires_all_readable_to_match(tmp_path):
    """只有 2 源可读时，必须两段全中；错一段即不通过。"""
    host = build_host(tmp_path, uuid_val=None)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", uuid_val=None, machine_id="zzz")
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_fallback_code_when_no_source_readable(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    fb = tmp_path / "fb"
    fb.mkdir()
    code1 = fp.machine_code(str(empty), str(fb))
    code2 = fp.machine_code(str(empty), str(fb))
    assert code1.startswith("DOCKER-")
    assert code1 == code2
    assert (fb / ".machine").exists()
    assert fp.matches(code1, str(empty), str(fb)) is True
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_fingerprint.py -v
```

Expected: FAIL — `ImportError: cannot import name 'fingerprint'`

- [ ] **Step 3: 实现 fingerprint**

创建 `backend/app/licensing/fingerprint.py`：

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_fingerprint.py -v
```

Expected: 10 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/licensing/fingerprint.py backend/tests/test_license_fingerprint.py
git commit -m "feat: 宿主机三源硬件指纹采集与容错匹配"
```

---

## Task 3: 许可状态机

**Files:**
- Create: `backend/app/licensing/state.py`
- Modify: `backend/app/licensing/__init__.py`
- Test: `backend/tests/test_license_state.py`

**Interfaces:**
- Consumes: `verifier.verify_and_parse`、`verifier.LicenseError`、`fingerprint.matches`
- Produces:
  - `class LicenseState(str, Enum)` — 成员 `VALID` / `GRACE` / `READONLY` / `TAMPERED` / `MISSING`
  - `GATED_MODULES: dict[str, tuple[str, ...]]` — 模块 key → 路由前缀元组
  - `@dataclass(frozen=True) class LicenseInfo` — 字段 `state: LicenseState`、`payload: dict | None`、`modules: frozenset[str]`、`days_left: int | None`、`reason: str`
  - `load(force: bool = False, now: date | None = None) -> LicenseInfo` — 带 60 秒进程内缓存
  - `invalidate() -> None`
  - `is_write_blocked(info: LicenseInfo) -> bool`
  - `denied_module_for_path(path: str, info: LicenseInfo) -> str | None`
  - `count_active_users(db) -> int`
  - `check_user_quota(db, info: LicenseInfo | None = None) -> None` — 超限抛 `LicenseQuotaError`
  - `class LicenseQuotaError(Exception)`
  - `LICENSE_FILENAME = "license.lic"`

**状态判定顺序：** 文件不存在 → `MISSING`；验签失败 → `TAMPERED`；指纹不匹配 → `TAMPERED`；`now > expires_at + grace_days` → `READONLY`；`now > expires_at` → `GRACE`；否则 `VALID`。

**门控生效范围：** `denied_module_for_path` 在 `TAMPERED` / `MISSING` 状态下返回 `None`（此时 payload 不可信，一律按只读处理，不再叠加模块判定）。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_license_state.py`：

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_state.py -v
```

Expected: FAIL — `ImportError: cannot import name 'state'`

- [ ] **Step 3: 实现 state**

创建 `backend/app/licensing/state.py`：

```python
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

# 可门控模块 → 路由前缀。基础版这三项全部关闭；/api/notifications 恒不门控。
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
    """返回该路径所属的未授权模块 key；已授权或不可门控返回 None。

    TAMPERED / MISSING 下 payload 不可信，不叠加模块判定（此时已按只读拦截）。
    """
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
```

- [ ] **Step 4: 导出公共接口**

把 `backend/app/licensing/__init__.py` 改为：

```python
"""商业许可认证模块。"""
from .state import (
    GATED_MODULES,
    LicenseInfo,
    LicenseQuotaError,
    LicenseState,
    check_user_quota,
    count_active_users,
    denied_module_for_path,
    invalidate,
    is_write_blocked,
    load,
)
from .verifier import LicenseError

__all__ = [
    "GATED_MODULES", "LicenseInfo", "LicenseQuotaError", "LicenseState",
    "LicenseError", "check_user_quota", "count_active_users",
    "denied_module_for_path", "invalidate", "is_write_blocked", "load",
]
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_state.py -v
```

Expected: 15 passed

- [ ] **Step 6: 提交**

```bash
git add backend/app/licensing/ backend/tests/test_license_state.py
git commit -m "feat: 许可状态机（五态+模块门控+用户配额）"
```

---

## Task 4: 请求拦截中间件

**Files:**
- Create: `backend/app/licensing/middleware.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_license_middleware.py`

**Interfaces:**
- Consumes: `state.load`、`state.is_write_blocked`、`state.denied_module_for_path`、`state.LicenseState`
- Produces:
  - `class LicenseMiddleware(BaseHTTPMiddleware)`
  - `WHITELIST_PREFIXES: tuple[str, ...]`
  - `WRITE_METHODS: frozenset[str]`

**中间件判定顺序（必须严格按此顺序）：**
1. 白名单前缀命中 → 放行
2. `denied_module_for_path` 非 None → 403 `{"detail": "该模块未授权", "license_state": "MODULE_DENIED", "module": <key>}`（**不区分请求方法**）
3. 方法不在 `WRITE_METHODS` → 放行
4. `is_write_blocked` → 403 `{"detail": <中文提示>, "license_state": <state 值>}`
5. 放行

第 2 步必须在第 3 步之前，否则未授权模块的 GET 会被提前放行，等于白送该模块全部数据。

**注册位置（关键）：** Starlette 的 `add_middleware` 是 `insert(0)`，**最后添加的最外层**。必须把 `LicenseMiddleware` 加在现有 `CORSMiddleware` **之前**，让 CORS 处于最外层，否则 403 响应不带 CORS 头，浏览器只会看到不透明错误。

**GRACE 响应头：** `GRACE` 状态下给响应加 `X-License-Warning`，值为 `info.reason`。需在 CORS 的 `expose_headers` 中暴露该头，否则前端读不到——但前端主要走 `/api/license/status`，此处仅作冗余信号，不改 CORS 配置。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_license_middleware.py`：

```python
"""许可中间件拦截测试。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.licensing import state as st
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import install_license


@pytest.fixture
def client(db):
    user = User(id=uuid.uuid4(), username="eng", password_hash="x",
                real_name="工程师", role="engineer", status="active")
    db.add(user); db.commit(); db.refresh(user)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_write_allowed_when_valid(client):
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH01", "name": "原料库", "type": "raw"})
    assert resp.status_code == 200


def test_write_blocked_when_readonly(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=0)
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH02", "name": "x", "type": "raw"})
    assert resp.status_code == 403
    assert resp.json()["license_state"] == "READONLY"


def test_read_allowed_when_readonly(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=0)
    c, _ = client
    assert c.get("/api/inventory/stock").status_code == 200


def test_write_blocked_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH03", "name": "x", "type": "raw"})
    assert resp.status_code == 403
    assert resp.json()["license_state"] == "MISSING"
    st.invalidate()


def test_grace_allows_write_and_sets_warning_header(client, monkeypatch):
    install_license(monkeypatch, expires="2020-01-01", grace=99999)
    c, _ = client
    resp = c.post("/api/inventory/warehouses",
                  json={"code": "WH04", "name": "x", "type": "raw"})
    assert resp.status_code == 200
    assert "X-License-Warning" in resp.headers


def test_gated_module_blocks_get_and_post(client, monkeypatch):
    install_license(monkeypatch, modules=())
    c, _ = client
    for resp in (c.get("/api/inventory/stock"),
                 c.post("/api/inventory/warehouses",
                        json={"code": "WH05", "name": "x", "type": "raw"})):
        assert resp.status_code == 403
        assert resp.json()["license_state"] == "MODULE_DENIED"
        assert resp.json()["module"] == "inventory"


def test_gated_change_module(client, monkeypatch):
    install_license(monkeypatch, modules=("inventory", "project"))
    c, _ = client
    assert c.get("/api/ecrs").status_code == 403
    assert c.get("/api/inventory/stock").status_code == 200


def test_notifications_never_gated(client, monkeypatch):
    install_license(monkeypatch, modules=())
    c, _ = client
    assert c.get("/api/notifications/unread-count").status_code != 403


def test_license_endpoints_whitelisted_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    assert c.get("/api/license/status").status_code == 200
    st.invalidate()


def test_openapi_reachable_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "none"))
    st.invalidate()
    c, _ = client
    assert c.get("/api/openapi.json").status_code == 200
    st.invalidate()
```

- [ ] **Step 2: 写测试辅助模块**

创建 `backend/tests/license_helpers.py`（供本任务及后续任务复用）：

```python
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
```

- [ ] **Step 3: 给全部现有测试装上有效 license**

在 `backend/tests/conftest.py` 的 import 区之后、`@compiles` 之前插入：

```python
from tests.license_helpers import install_license  # noqa: E402


@pytest.fixture(autouse=True)
def _default_license(monkeypatch):
    """默认给每个测试装一份全模块、远期到期的 license。

    否则许可中间件会把现有全部写操作测试拦成 403。
    需要其他 license 状态的测试自行再调 install_license 覆盖。
    """
    install_license(monkeypatch)
    yield
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_middleware.py -v
```

Expected: FAIL — `ImportError: cannot import name 'middleware'` 或全部返回 200（中间件未生效）

- [ ] **Step 5: 实现中间件**

创建 `backend/app/licensing/middleware.py`：

```python
"""许可拦截中间件。"""
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import state as st

WHITELIST_PREFIXES: tuple[str, ...] = (
    "/api/license",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/docs",
    "/api/redoc",
    "/api/openapi.json",
)

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

_BLOCK_MESSAGE = "许可证已过期或无效，系统处于只读模式，请联系供应商续期"


class LicenseMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path

        if path.startswith(WHITELIST_PREFIXES):
            return await call_next(request)

        info = st.load()

        # 模块门控必须先于只读放行判定，否则未授权模块的 GET 会被放行
        denied = st.denied_module_for_path(path, info)
        if denied is not None:
            return JSONResponse(status_code=403, content={
                "detail": "该模块未授权",
                "license_state": "MODULE_DENIED",
                "module": denied,
            })

        if request.method in WRITE_METHODS and st.is_write_blocked(info):
            return JSONResponse(status_code=403, content={
                "detail": _BLOCK_MESSAGE,
                "license_state": info.state.value,
            })

        response = await call_next(request)
        if info.state is st.LicenseState.GRACE:
            response.headers["X-License-Warning"] = info.reason
        return response
```

- [ ] **Step 6: 注册中间件**

在 `backend/app/main.py` 中，于现有 `app.add_middleware(CORSMiddleware, ...)` 调用**之前**插入（顺序至关重要）：

```python
from .licensing.middleware import LicenseMiddleware

# 注意：Starlette 的 add_middleware 是 insert(0)，最后添加的在最外层。
# 许可中间件必须先于 CORS 添加，使 CORS 处于外层，403 响应才带 CORS 头。
app.add_middleware(LicenseMiddleware)
```

`from .licensing.middleware import LicenseMiddleware` 放到文件顶部 import 区（与 `from .database import ...` 同组）。

- [ ] **Step 7: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_middleware.py -v
```

Expected: 10 passed

- [ ] **Step 8: 运行全量后端测试，确认未回归**

```bash
cd backend && python -m pytest -q
```

Expected: 全部通过（现有测试数 + 新增）。若有写操作测试变 403，说明 Step 3 的 autouse fixture 没生效，修好再继续。

- [ ] **Step 9: 提交**

```bash
git add backend/app/licensing/middleware.py backend/app/main.py backend/tests/
git commit -m "feat: 许可拦截中间件（只读降级+模块门控）"
```

---

## Task 5: 许可 HTTP 接口与审计表

**Files:**
- Create: `backend/app/models_license.py`
- Create: `backend/app/migrations_license.py`
- Create: `backend/app/licensing/router.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `permissions/permissions.json`
- Test: `backend/tests/test_license_api.py`

**Interfaces:**
- Consumes: `state.load`、`state.invalidate`、`state.count_active_users`、`state.license_path`、`verifier.verify_and_parse`、`fingerprint.machine_code`
- Produces:
  - `class LicenseRecord(Base)` — 表 `licenses`
  - `migrate_licenses(db, engine) -> None`
  - `router = APIRouter(prefix="/license", tags=["许可管理"])`，挂载于 `/api`
  - `GET /api/license/status` → `{state, edition, customer, expires_at, days_left, max_users, used_users, modules, reason}`
  - `GET /api/license/machine-code` → `{machine_code}`
  - `POST /api/license/upload`（multipart，字段名 `file`）→ 同 status 结构

**权限：** `license:read` = 全部角色；`license:manage` = 仅 `admin`。

- [ ] **Step 1: 加权限定义**

在 `permissions/permissions.json` 的 `"permissions"` 对象中新增两项（放在文件中现有条目之后、保持 JSON 合法）：

```json
    "license:read": ["admin", "engineer", "production", "guest"],
    "license:manage": ["admin"]
```

- [ ] **Step 2: 生成权限常量**

```bash
python tools/gen_permissions.py
```

Expected: 无报错；`git status` 显示 `backend/app/permissions/_generated.py` 与 `frontend/src/constants/permissions.generated.ts` 被修改

- [ ] **Step 3: 写失败测试**

创建 `backend/tests/test_license_api.py`：

```python
"""许可 HTTP 接口测试。"""
import base64
import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.licensing import state as st
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import (TEST_PRIVATE_KEY, build_host, install_license,
                                   write_license_file)
from app.licensing import fingerprint as fp
from app.licensing import verifier


def make_client(db, role="admin"):
    user = User(id=uuid.uuid4(), username=f"u-{role}", password_hash="x",
                real_name="X", role=role, status="active")
    db.add(user); db.commit(); db.refresh(user)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app), user


@pytest.fixture
def admin_client(db):
    c, u = make_client(db, "admin")
    yield c, u
    app.dependency_overrides.clear()


@pytest.fixture
def guest_client(db):
    c, u = make_client(db, "guest")
    yield c, u
    app.dependency_overrides.clear()


def test_status_returns_valid(admin_client, db):
    c, _ = admin_client
    body = c.get("/api/license/status").json()
    assert body["state"] == "VALID"
    assert body["customer"] == "测试客户"
    assert set(body["modules"]) == {"change", "inventory", "project"}
    assert body["used_users"] == st.count_active_users(db)


def test_status_readable_by_guest(guest_client):
    c, _ = guest_client
    assert c.get("/api/license/status").status_code == 200


def test_machine_code_admin_only(admin_client, guest_client):
    ac, _ = admin_client
    assert len(ac.get("/api/license/machine-code").json()["machine_code"]) > 0


def test_machine_code_denied_for_guest(guest_client):
    c, _ = guest_client
    assert c.get("/api/license/machine-code").status_code == 403


def test_upload_valid_license(admin_client, monkeypatch, tmp_path):
    lic_dir = install_license(monkeypatch, modules=())
    c, _ = admin_client
    assert c.get("/api/license/status").json()["modules"] == []

    host = str(Path(str(lic_dir)).parent / "host")
    new_dir = tmp_path / "new"
    write_license_file(new_dir, host, modules=("change", "inventory", "project"))
    raw = (new_dir / st.LICENSE_FILENAME).read_bytes()

    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", raw, "application/octet-stream")})
    assert resp.status_code == 200
    assert set(resp.json()["modules"]) == {"change", "inventory", "project"}
    assert c.get("/api/license/status").json()["state"] == "VALID"


def test_upload_rejects_tampered_license(admin_client, monkeypatch, tmp_path):
    install_license(monkeypatch)
    c, _ = admin_client
    doc = {"payload": {"license_id": "X"}, "signature": "AAAA"}
    raw = base64.b64encode(json.dumps(doc).encode())
    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", raw, "application/octet-stream")})
    assert resp.status_code == 400
    assert "许可证" in resp.json()["detail"]


def test_upload_denied_for_guest(guest_client, tmp_path):
    c, _ = guest_client
    resp = c.post("/api/license/upload",
                  files={"file": ("license.lic", b"x", "application/octet-stream")})
    assert resp.status_code == 403


def test_upload_writes_audit_row(admin_client, db, monkeypatch, tmp_path):
    from app.models_license import LicenseRecord
    lic_dir = install_license(monkeypatch)
    host = str(Path(str(lic_dir)).parent / "host")
    new_dir = tmp_path / "new2"
    write_license_file(new_dir, host, max_users=77)
    raw = (new_dir / st.LICENSE_FILENAME).read_bytes()
    c, user = admin_client
    c.post("/api/license/upload",
           files={"file": ("license.lic", raw, "application/octet-stream")})
    row = db.query(LicenseRecord).order_by(LicenseRecord.uploaded_at.desc()).first()
    assert row is not None
    assert row.max_users == 77
    assert row.uploaded_by == user.id


def test_status_works_when_license_missing(admin_client, monkeypatch, tmp_path):
    monkeypatch.setenv("LICENSE_DIR", str(tmp_path / "nope"))
    st.invalidate()
    c, _ = admin_client
    body = c.get("/api/license/status").json()
    assert body["state"] == "MISSING"
    assert body["modules"] == []
    st.invalidate()
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_api.py -v
```

Expected: FAIL — 404，`/api/license/status` 路由不存在

- [ ] **Step 5: 实现审计表模型**

创建 `backend/app/models_license.py`：

```python
"""license 上传审计表。校验永远以文件+验签为准，本表仅供展示与追溯。"""
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .database import Base


class LicenseRecord(Base):
    __tablename__ = "licenses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    license_id = Column(String(64), nullable=False)
    customer = Column(String(255), nullable=False)
    machine_code = Column(String(64), nullable=False)
    issued_at = Column(String(16), nullable=False)
    expires_at = Column(String(16), nullable=False)
    max_users = Column(Integer, nullable=False, default=0)
    modules = Column(JSONB, default=list)
    edition = Column(String(32), nullable=False, default="basic")
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
```

- [ ] **Step 6: 实现迁移**

创建 `backend/app/migrations_license.py`：

```python
"""licenses 审计表建表迁移。幂等，PostgreSQL。"""
from sqlalchemy import text


def migrate_licenses(db, engine):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS licenses (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            license_id VARCHAR(64) NOT NULL,
            customer VARCHAR(255) NOT NULL,
            machine_code VARCHAR(64) NOT NULL,
            issued_at VARCHAR(16) NOT NULL,
            expires_at VARCHAR(16) NOT NULL,
            max_users INTEGER NOT NULL DEFAULT 0,
            modules JSONB DEFAULT '[]'::jsonb,
            edition VARCHAR(32) NOT NULL DEFAULT 'basic',
            uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL
        )
    """))
    db.commit()
```

- [ ] **Step 7: 实现路由**

创建 `backend/app/licensing/router.py`：

```python
"""许可管理接口。全部路径在中间件白名单内，保证只读态下仍可自救上传。"""
import uuid as _uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..models_license import LicenseRecord
from ..permissions import require_permission
from . import fingerprint as fp
from . import state as st
from .verifier import LicenseError, verify_and_parse

router = APIRouter(prefix="/license", tags=["许可管理"])

MAX_LICENSE_BYTES = 16 * 1024


def _status_body(info: st.LicenseInfo, db: Session) -> dict:
    payload = info.payload or {}
    return {
        "state": info.state.value,
        "edition": payload.get("edition"),
        "customer": payload.get("customer"),
        "license_id": payload.get("license_id"),
        "issued_at": payload.get("issued_at"),
        "expires_at": payload.get("expires_at"),
        "days_left": info.days_left,
        "max_users": payload.get("max_users"),
        "used_users": st.count_active_users(db),
        "modules": sorted(info.modules),
        "reason": info.reason,
    }


@router.get("/status")
async def get_status(db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("license:read"))):
    return _status_body(st.load(), db)


@router.get("/machine-code")
async def get_machine_code(
    current_user: User = Depends(require_permission("license:manage"))
):
    return {"machine_code": fp.machine_code()}


@router.post("/upload")
async def upload_license(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("license:manage")),
):
    raw = await file.read()
    if len(raw) > MAX_LICENSE_BYTES:
        raise HTTPException(status_code=400, detail="许可证文件过大")

    try:
        payload = verify_and_parse(raw)
    except LicenseError as exc:
        raise HTTPException(status_code=400, detail=f"许可证无效：{exc}") from exc

    if not fp.matches(payload["machine_code"]):
        raise HTTPException(status_code=400,
                            detail="许可证与本机硬件不匹配，请提供本机机器码重新申请")

    path = st.license_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    st.invalidate()

    db.add(LicenseRecord(
        id=_uuid.uuid4(),
        license_id=str(payload.get("license_id", "")),
        customer=str(payload.get("customer", "")),
        machine_code=str(payload.get("machine_code", "")),
        issued_at=str(payload.get("issued_at", "")),
        expires_at=str(payload.get("expires_at", "")),
        max_users=int(payload.get("max_users") or 0),
        modules=list(payload.get("modules") or []),
        edition=str(payload.get("edition", "basic")),
        uploaded_by=current_user.id,
    ))
    db.commit()

    return _status_body(st.load(force=True), db)
```

- [ ] **Step 8: 挂载路由与迁移**

在 `backend/app/main.py`：

1. 顶部 import 区加：
```python
from .licensing.router import router as license_router
from .migrations_license import migrate_licenses
```
2. 在 `app.include_router(settings_router, prefix="/api")` 之后加：
```python
app.include_router(license_router, prefix="/api")
```
3. 在 `startup_event` 的迁移段（其他 `migrate_*` 调用旁）加：
```python
        migrate_licenses(db, engine)
        print("✓ licenses 表检查完成")
```

- [ ] **Step 9: 让测试库建出 licenses 表**

在 `backend/tests/conftest.py` 的模型导入行中加入 `models_license`：

```python
from app import models, models_parts, models_ecr, models_eco, models_configuration, models_notification, models_license  # noqa: F401
```

- [ ] **Step 10: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_api.py -v
```

Expected: 9 passed

- [ ] **Step 11: 全量回归**

```bash
cd backend && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 12: 提交**

```bash
git add permissions/ backend/app/ backend/tests/ frontend/src/constants/permissions.generated.ts
git commit -m "feat: 许可管理接口与审计表"
```

---

## Task 6: 用户数配额校验

**Files:**
- Modify: `backend/app/routers/users.py`
- Test: `backend/tests/test_license_quota.py`

**Interfaces:**
- Consumes: `state.check_user_quota`、`state.LicenseQuotaError`
- Produces: 无新公共接口

**校验点：** 仅两处 —— `POST /api/users/`（创建用户）、`PUT /api/users/{id}` 且请求把 `status` 改为 `"active"` 而原值不是 `"active"`（停用转启用）。其余更新不校验。超限返回 403。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_license_quota.py`：

```python
"""用户数配额校验测试。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import User
from app.routers.auth import get_current_active_user
from tests.license_helpers import install_license


@pytest.fixture
def client(db):
    admin = User(id=uuid.uuid4(), username="admin1", password_hash="x",
                 real_name="管理员", role="admin", status="active")
    db.add(admin); db.commit(); db.refresh(admin)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: admin
    yield TestClient(app), admin
    app.dependency_overrides.clear()


def new_user_body(name):
    return {"username": name, "password": "pw123456", "real_name": "新人",
            "role": "engineer", "status": "active"}


def test_create_user_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)  # 已有 1 个 admin，即已达上限
    c, _ = client
    resp = c.post("/api/users/", json=new_user_body("newbie"))
    assert resp.status_code == 403
    assert "授权用户数上限" in resp.json()["detail"]


def test_create_user_allowed_below_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=5)
    c, _ = client
    assert c.post("/api/users/", json=new_user_body("newbie2")).status_code == 200


def test_enabling_disabled_user_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    off = User(id=uuid.uuid4(), username="off1", password_hash="x",
               real_name="停用", role="engineer", status="disabled")
    db.add(off); db.commit()
    c, _ = client
    resp = c.put(f"/api/users/{off.id}", json={"status": "active"})
    assert resp.status_code == 403


def test_other_updates_not_blocked_at_quota(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    off = User(id=uuid.uuid4(), username="off2", password_hash="x",
               real_name="停用", role="engineer", status="disabled")
    db.add(off); db.commit()
    c, _ = client
    assert c.put(f"/api/users/{off.id}", json={"real_name": "改名"}).status_code == 200


def test_existing_active_users_unaffected(client, db, monkeypatch):
    install_license(monkeypatch, max_users=1)
    c, _ = client
    assert c.get("/api/users/").status_code == 200
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_quota.py -v
```

Expected: FAIL — 创建用户返回 200 而非 403

- [ ] **Step 3: 接入配额校验**

修改 `backend/app/routers/users.py`。顶部 import 区加：

```python
from ..licensing.state import LicenseQuotaError, check_user_quota
```

把 `create_user` 改为：

```python
@router.post("/", response_model=schemas.UserResponse)
async def create_user(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:create"))):
    if crud.get_user_by_username(db, user.username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    if getattr(user, "status", "active") == "active":
        try:
            check_user_quota(db)
        except LicenseQuotaError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    return crud.create_user(db, user)
```

把 `update_user` 改为：

```python
@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:update"))):
    existing = crud.get_user(db, user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 停用转启用视同新增一个占用名额的用户
    changes = user_update.model_dump(exclude_unset=True)
    if changes.get("status") == "active" and existing.status != "active":
        try:
            check_user_quota(db)
        except LicenseQuotaError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    db_user = crud.update_user(db, user_id, user_update)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return db_user
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_quota.py -v
```

Expected: 5 passed

- [ ] **Step 5: 全量回归**

```bash
cd backend && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add backend/app/routers/users.py backend/tests/test_license_quota.py
git commit -m "feat: 创建/启用用户时校验授权用户数上限"
```

---

## Task 7: 签发工具

**Files:**
- Create: `tools/license_issuer/canonical.py`
- Create: `tools/license_issuer/keygen.py`
- Create: `tools/license_issuer/issue.py`
- Create: `tools/license_issuer/README.md`
- Modify: `.gitignore`
- Test: `backend/tests/test_license_issuer.py`

**Interfaces:**
- Consumes: `verifier.canonical_bytes`（一致性由测试保证）
- Produces:
  - `canonical.canonical_bytes(payload: dict) -> bytes`
  - `issue.build_payload(*, license_id, customer, machine_code, issued_at, expires_at, grace_days, max_users, edition, modules=None) -> dict`
  - `issue.sign_payload(payload: dict, private_key_pem: bytes) -> bytes` — 返回 `.lic` 文件内容
  - `issue.EDITION_MODULES: dict[str, tuple[str, ...]]` — `{"basic": (), "full": ("change","inventory","project")}`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_license_issuer.py`：

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_license_issuer.py -v
```

Expected: FAIL — 找不到 `tools/license_issuer/issue.py`

- [ ] **Step 3: 实现 canonical**

创建 `tools/license_issuer/canonical.py`：

```python
"""payload 规范化序列化。必须与 backend/app/licensing/verifier.py 的实现逐字节一致。"""
import json


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
```

- [ ] **Step 4: 实现 keygen**

创建 `tools/license_issuer/keygen.py`：

```python
#!/usr/bin/env python3
"""生成 Ed25519 签发密钥对。一次性执行，此后永不重新生成。

私钥丢失 = 所有存量客户无法续期。生成后立即离线备份至少两份。

Run: python tools/license_issuer/keygen.py --out ./keys
"""
import argparse
import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="./keys", help="密钥输出目录")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    priv_path = out / "private_key.pem"
    if priv_path.exists():
        raise SystemExit(f"拒绝覆盖已存在的私钥：{priv_path}")

    priv = Ed25519PrivateKey.generate()
    priv_path.write_bytes(priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()))
    pub_b64 = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    (out / "public_key.b64").write_text(pub_b64, encoding="utf-8")

    print(f"私钥已写入 {priv_path}（请立即离线备份两份）")
    print(f"公钥 base64（构建镜像时作为 LICENSE_PUBKEY 传入）：\n{pub_b64}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 实现 issue**

创建 `tools/license_issuer/issue.py`：

```python
#!/usr/bin/env python3
"""签发 license 文件并记录台账。

Run:
  python tools/license_issuer/issue.py \
    --customer "某某机械有限公司" --machine-code "a3f29c81-4d07e5b2-77c10fa9" \
    --expires 2027-07-28 --max-users 50 --edition full \
    --out ./licenses/某某机械_20260728.lic
"""
import argparse
import base64
import csv
import json
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import serialization

try:
    from canonical import canonical_bytes
except ImportError:
    from .canonical import canonical_bytes

EDITION_MODULES: dict[str, tuple[str, ...]] = {
    "basic": (),
    "full": ("change", "inventory", "project"),
}

LEDGER_COLUMNS = ["license_id", "customer", "machine_code", "issued_at",
                  "expires_at", "max_users", "modules", "edition"]


def build_payload(*, license_id: str, customer: str, machine_code: str,
                  issued_at: str, expires_at: str, grace_days: int,
                  max_users: int, edition: str,
                  modules: list[str] | None = None) -> dict:
    if edition not in EDITION_MODULES:
        raise ValueError(f"未知版本 {edition}，可选：{','.join(EDITION_MODULES)}")
    resolved = list(modules) if modules is not None else list(EDITION_MODULES[edition])
    unknown = set(resolved) - set(EDITION_MODULES["full"])
    if unknown:
        raise ValueError(f"未知模块：{','.join(sorted(unknown))}")
    return {
        "license_id": license_id,
        "customer": customer,
        "machine_code": machine_code,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "grace_days": int(grace_days),
        "max_users": int(max_users),
        "modules": resolved,
        "edition": edition,
    }


def sign_payload(payload: dict, private_key_pem: bytes) -> bytes:
    priv = serialization.load_pem_private_key(private_key_pem, password=None)
    sig = priv.sign(canonical_bytes(payload))
    doc = {"payload": payload, "signature": base64.b64encode(sig).decode()}
    return base64.b64encode(json.dumps(doc, ensure_ascii=False).encode("utf-8"))


def append_ledger(ledger_path: Path, payload: dict) -> None:
    exists = ledger_path.exists()
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with ledger_path.open("a", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=LEDGER_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow({
            **{k: payload[k] for k in LEDGER_COLUMNS if k != "modules"},
            "modules": "|".join(payload["modules"]),
        })


def next_license_id(ledger_path: Path) -> str:
    year = date.today().year
    count = 0
    if ledger_path.exists():
        with ledger_path.open("r", encoding="utf-8-sig") as fh:
            count = sum(1 for _ in csv.DictReader(fh))
    return f"LIC-{year}-{count + 1:04d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer", required=True)
    parser.add_argument("--machine-code", required=True)
    parser.add_argument("--expires", required=True, help="YYYY-MM-DD；永久授权填 9999-12-31")
    parser.add_argument("--max-users", type=int, required=True)
    parser.add_argument("--edition", choices=sorted(EDITION_MODULES), required=True)
    parser.add_argument("--modules", help="逗号分隔，覆盖 edition 默认模块（定制单用）")
    parser.add_argument("--grace-days", type=int, default=15)
    parser.add_argument("--key", default="./keys/private_key.pem")
    parser.add_argument("--ledger", default="./issued.csv")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    ledger = Path(args.ledger)
    payload = build_payload(
        license_id=next_license_id(ledger),
        customer=args.customer,
        machine_code=args.machine_code,
        issued_at=date.today().isoformat(),
        expires_at=args.expires,
        grace_days=args.grace_days,
        max_users=args.max_users,
        edition=args.edition,
        modules=[m.strip() for m in args.modules.split(",")] if args.modules else None,
    )
    raw = sign_payload(payload, Path(args.key).read_bytes())
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    append_ledger(ledger, payload)
    print(f"已签发 {payload['license_id']} → {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 写 README 与 .gitignore**

创建 `tools/license_issuer/README.md`：

```markdown
# license 签发工具

仅在签发者本机运行。**不进 Docker 镜像，不进客户交付物。**

## 一次性初始化

```bash
python tools/license_issuer/keygen.py --out ./keys
```

私钥 `keys/private_key.pem` 丢失 = 所有存量客户无法续期。生成后立即离线备份两份。
输出的公钥 base64 用于构建后端镜像：`--build-arg LICENSE_PUBKEY=<公钥>`。

## 签发

```bash
python tools/license_issuer/issue.py \
  --customer "某某机械有限公司" \
  --machine-code "a3f29c81-4d07e5b2-77c10fa9" \
  --expires 2027-07-28 --max-users 50 --edition full \
  --out ./licenses/某某机械_20260728.lic
```

机器码由客户在「系统设置 → 许可管理」页复制后提供。
`--edition basic` 不含变更/库存/项目管理；`--edition full` 全含。
定制组合用 `--modules change,inventory` 覆盖。

每次签发追加一行到 `issued.csv` 台账。
```

在项目根 `.gitignore` 末尾追加：

```
# license 签发工具产物（私钥与台账绝不入库）
keys/
tools/license_issuer/keys/
licenses/
issued.csv
```

- [ ] **Step 7: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_license_issuer.py -v
```

Expected: 6 passed

- [ ] **Step 8: 端到端手工验证签发流程**

```bash
python tools/license_issuer/keygen.py --out ./keys && python tools/license_issuer/issue.py --customer "测试客户" --machine-code "aaaaaaaa-bbbbbbbb-cccccccc" --expires 2027-12-31 --max-users 10 --edition basic --out ./licenses/test.lic && cat issued.csv
```

Expected: 打印 `已签发 LIC-2026-0001 → licenses/test.lic`，台账含一行

- [ ] **Step 9: 确认产物未被 git 跟踪**

```bash
git status --porcelain | grep -E "keys/|licenses/|issued.csv" || echo "OK: 敏感产物未被跟踪"
```

Expected: 输出 `OK: 敏感产物未被跟踪`

- [ ] **Step 10: 提交**

```bash
git add tools/license_issuer/ .gitignore backend/tests/test_license_issuer.py
git commit -m "feat: license 签发工具（keygen + issue + 台账）"
```

---

## Task 8: 前端许可状态接入与许可页

**Files:**
- Create: `frontend/src/services/licenseApi.ts`
- Create: `frontend/src/stores/license.ts`
- Create: `frontend/src/components/settings/LicenseTab.tsx`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `GET /api/license/status`、`GET /api/license/machine-code`、`POST /api/license/upload`
- Produces:
  - `type LicenseState = 'VALID' | 'GRACE' | 'READONLY' | 'TAMPERED' | 'MISSING'`
  - `interface LicenseStatus` — 见下方定义
  - `licenseApi.getStatus()` / `licenseApi.getMachineCode()` / `licenseApi.upload(file)`
  - `useLicenseStore` — `{ status, loading, fetch(), setStatus(s), isModuleEnabled(m) }`
  - `hasModule(module: string): boolean` — 供 Layout 直接调用的非 hook 版

- [ ] **Step 1: 加类型定义**

在 `frontend/src/types/index.ts` 末尾追加：

```typescript
export type LicenseState = 'VALID' | 'GRACE' | 'READONLY' | 'TAMPERED' | 'MISSING';

export interface LicenseStatus {
  state: LicenseState;
  edition: string | null;
  customer: string | null;
  license_id: string | null;
  issued_at: string | null;
  expires_at: string | null;
  days_left: number | null;
  max_users: number | null;
  used_users: number;
  modules: string[];
  reason: string;
}
```

- [ ] **Step 2: 实现 API 封装**

创建 `frontend/src/services/licenseApi.ts`：

```typescript
import api from './api';
import type { LicenseStatus } from '../types';

export const licenseApi = {
  async getStatus(): Promise<LicenseStatus> {
    return (await api.get('/license/status')).data;
  },

  async getMachineCode(): Promise<string> {
    return (await api.get('/license/machine-code')).data.machine_code;
  },

  async upload(file: File): Promise<LicenseStatus> {
    const form = new FormData();
    form.append('file', file);
    return (await api.post('/license/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data;
  },
};
```

**注意：** 先确认 `services/api.ts` 的默认导出名。若它是 `export default api`，上面的 `import api from './api'` 正确；若是具名导出，改成对应写法。

- [ ] **Step 3: 实现 store**

创建 `frontend/src/stores/license.ts`：

```typescript
import { create } from 'zustand';
import type { LicenseStatus } from '../types';
import { licenseApi } from '../services/licenseApi';

interface LicenseState {
  status: LicenseStatus | null;
  loading: boolean;
  fetch: () => Promise<void>;
  setStatus: (s: LicenseStatus) => void;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  status: null,
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      set({ status: await licenseApi.getStatus() });
    } catch {
      /* 状态拉取失败不阻塞页面，后端仍是唯一权威 */
    } finally {
      set({ loading: false });
    }
  },
  setStatus: (status) => set({ status }),
}));

// 非 hook 版，供 Layout 的菜单过滤等非组件上下文使用。
// 状态未加载时一律放行，避免首屏闪烁；真实拦截以后端为准。
export const hasModule = (module: string): boolean => {
  const status = useLicenseStore.getState().status;
  if (!status) return true;
  return status.modules.includes(module);
};
```

- [ ] **Step 4: 实现许可 tab 组件**

创建 `frontend/src/components/settings/LicenseTab.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLicenseStore } from '../../stores/license';
import { licenseApi } from '../../services/licenseApi';
import type { LicenseState } from '../../types';

const STATE_LABEL: Record<LicenseState, string> = {
  VALID: '正常',
  GRACE: '已过期（宽限期内）',
  READONLY: '已过期（只读模式）',
  TAMPERED: '无效（签名或硬件不匹配）',
  MISSING: '未安装许可证',
};

const STATE_CLASS: Record<LicenseState, string> = {
  VALID: 'bg-green-100 text-green-700',
  GRACE: 'bg-yellow-100 text-yellow-700',
  READONLY: 'bg-red-100 text-red-700',
  TAMPERED: 'bg-red-100 text-red-700',
  MISSING: 'bg-gray-100 text-gray-600',
};

const MODULE_LABEL: Record<string, string> = {
  change: '变更管理',
  inventory: '库存管理',
  project: '项目管理',
};

export default function LicenseTab() {
  const { status, fetch, setStatus } = useLicenseStore();
  const [machineCode, setMachineCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch();
    licenseApi.getMachineCode().then(setMachineCode).catch(() => setMachineCode('--'));
  }, [fetch]);

  const copyMachineCode = async () => {
    await navigator.clipboard.writeText(machineCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFile = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      setStatus(await licenseApi.upload(file));
    } catch (e: any) {
      setError(e?.response?.data?.detail || '许可证上传失败');
    } finally {
      setUploading(false);
    }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex py-2 border-b border-gray-100">
      <div className="w-32 text-sm text-gray-500">{label}</div>
      <div className="flex-1 text-sm text-gray-900">{value}</div>
    </div>
  );

  return (
    <div className="max-w-2xl">
      {status && (
        <div className="mb-6">
          <div className="mb-3">
            <span className={`px-2 py-1 rounded text-sm ${STATE_CLASS[status.state]}`}>
              {STATE_LABEL[status.state]}
            </span>
            {status.reason && (
              <span className="ml-2 text-sm text-gray-500">{status.reason}</span>
            )}
          </div>
          {row('客户名称', status.customer || '--')}
          {row('授权版本', status.edition === 'full' ? '全量版' : status.edition === 'basic' ? '基础版' : '--')}
          {row('许可编号', status.license_id || '--')}
          {row('到期日期', status.expires_at || '--')}
          {row('剩余天数', status.days_left === null ? '--' : `${status.days_left} 天`)}
          {row('用户数', `${status.used_users} / ${status.max_users ?? '--'}`)}
          {row('可选模块', status.modules.length
            ? status.modules.map((m) => MODULE_LABEL[m] || m).join('、')
            : '无（基础版）')}
        </div>
      )}

      <div className="mb-6">
        <div className="text-sm text-gray-500 mb-2">本机机器码（申请许可证时提供给供应商）</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm">
            {machineCode || '--'}
          </code>
          <button
            onClick={copyMachineCode}
            className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      <div>
        <div className="text-sm text-gray-500 mb-2">上传许可证文件</div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded p-8 text-center cursor-pointer hover:border-blue-400"
        >
          <p className="text-sm text-gray-500">
            {uploading ? '上传中…' : '点击选择或拖拽 .lic 文件到此处'}
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".lic"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 挂到 Settings 页**

在 `frontend/src/pages/Settings.tsx`：

1. 顶部 import 区加：
```typescript
import LicenseTab from '../components/settings/LicenseTab';
```
2. `TabKey` 类型加 `| 'license'`：
```typescript
  type TabKey = 'password' | 'logs' | 'customFields' | 'dataManagement' | 'license';
```
3. `tabs` 数组末尾加：
```typescript
    { key: 'license', label: '许可管理', enabled: true, adminOnly: true },
```
4. 在 `{activeTab === 'logs' && <Logs />}` 之后加：
```tsx
      {activeTab === 'license' && <LicenseTab />}
```

- [ ] **Step 6: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/services/licenseApi.ts frontend/src/stores/license.ts frontend/src/components/settings/LicenseTab.tsx frontend/src/types/index.ts frontend/src/pages/Settings.tsx
git commit -m "feat: 前端许可管理页（状态展示+机器码+license 上传）"
```

---

## Task 9: 前端状态横幅、菜单门控与 403 处理

**Files:**
- Create: `frontend/src/components/LicenseBanner.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: `useLicenseStore`、`hasModule`
- Produces: `<LicenseBanner />` 组件

**菜单门控映射：** `/ec → change`、`/inventory → inventory`、`/projects → project`。其余菜单项无 `module` 字段，恒显示。

- [ ] **Step 1: 实现横幅组件**

创建 `frontend/src/components/LicenseBanner.tsx`：

```tsx
import { Link } from 'react-router-dom';
import { useLicenseStore } from '../stores/license';

export default function LicenseBanner() {
  const status = useLicenseStore((s) => s.status);
  if (!status || status.state === 'VALID') return null;

  const isGrace = status.state === 'GRACE';
  const text = isGrace
    ? status.reason || '许可证已过期，请尽快联系供应商续期'
    : status.state === 'MISSING'
      ? '未安装许可证，系统处于只读模式'
      : '许可证已过期或无效，系统处于只读模式，请联系供应商续期';

  return (
    <div
      className={`px-4 py-2 text-sm flex items-center justify-between ${
        isGrace
          ? 'bg-yellow-50 text-yellow-800 border-b border-yellow-200'
          : 'bg-red-50 text-red-800 border-b border-red-200'
      }`}
    >
      <span>{text}</span>
      <Link to="/settings" className="underline shrink-0 ml-4">
        前往许可管理
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: 接入 Layout**

在 `frontend/src/components/Layout.tsx`：

1. import 区加：
```typescript
import LicenseBanner from './LicenseBanner';
import { useLicenseStore, hasModule } from '../stores/license';
```
2. `NavItem` 类型加可选字段：
```typescript
type NavItem = {
  path: string;
  label: string;
  icon: string;
  roles: string[];
  module?: string;   // 需要该许可模块才显示；不填则恒显示
};
```
3. 给三个受控菜单项加 `module`：
```typescript
  { path: '/ec', label: '变更管理', icon: '🔄', roles: ['admin', 'engineer', 'production', 'guest'], module: 'change' },
  { path: '/inventory', label: '库存管理', icon: '🏬', roles: ['admin', 'engineer', 'production', 'guest'], module: 'inventory' },
  { path: '/projects', label: '项目管理', icon: '🗂️', roles: ['admin', 'engineer', 'production'], module: 'project' },
```
4. 组件内加载许可状态。在已有的 `const fetchUnread = useNotificationStore((s) => s.fetchUnread);` 之后加：
```typescript
  const fetchLicense = useLicenseStore((s) => s.fetch);
  const licenseStatus = useLicenseStore((s) => s.status);

  useEffect(() => {
    fetchLicense();
  }, [fetchLicense]);
```
5. 在菜单渲染处，除已有的 `roles` 过滤外追加 module 过滤。找到渲染 `navItems.map(...)` 的位置，在角色判断的同一个 `if` 里加上：
```typescript
              if (item.module && !hasModule(item.module)) return null;
```
   `licenseStatus` 已订阅，状态到达后会触发重渲染，菜单自动更新。
6. 在主内容区最外层容器顶部（页面 header 之上）插入：
```tsx
        <LicenseBanner />
```

- [ ] **Step 3: 403 统一处理**

在 `frontend/src/services/api.ts` 的响应拦截器中，在现有 401 处理分支**之后**加入 403 分支：

```typescript
    if (error.response?.status === 403) {
      const data: any = error.response.data;
      if (data?.license_state) {
        const msg = data.license_state === 'MODULE_DENIED'
          ? '该功能模块未授权，请联系供应商'
          : data.detail || '许可证已过期或无效，系统处于只读模式';
        window.dispatchEvent(new CustomEvent('license-error', { detail: msg }));
      }
    }
```

在 `LicenseBanner.tsx` 中订阅该事件并用 Toast 提示。在组件内加：

```typescript
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as string;
      showToast(msg, 'error');
    };
    window.addEventListener('license-error', handler);
    return () => window.removeEventListener('license-error', handler);
  }, []);
```

`showToast` 从现有 Toast 模块导入 —— 先查看 `frontend/src/components/Toast.tsx` 的导出名，按实际写法引入。同时补上 `import { useEffect } from 'react';`。

- [ ] **Step 4: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/LicenseBanner.tsx frontend/src/components/Layout.tsx frontend/src/services/api.ts
git commit -m "feat: 前端许可横幅、菜单模块门控与 403 统一提示"
```

---

## Task 10: Cython 编译与生产部署配置

**Files:**
- Modify: `backend/Dockerfile`
- Create: `docker-compose.prod.yml`
- Create: `docs/部署-商业许可.md`

**Interfaces:**
- Consumes: `backend/app/licensing/{fingerprint,verifier,state}.py`
- Produces: 镜像内只含 `.so`，无对应 `.py`

**编译要点：** 在 build stage 用 `sed` 把 `verifier.py` 里的 `@@LICENSE_PUBKEY@@` 替换为真实公钥，再 `cythonize`，然后删除这三个 `.py`。

- [ ] **Step 1: 改 Dockerfile**

把 `backend/Dockerfile` 中 `COPY ./app ./app` 那一行替换为下面整段：

```dockerfile
# 许可模块公钥（构建时注入，绝不入版本库）
ARG LICENSE_PUBKEY

COPY ./app ./app

# 编译许可核心三文件为 .so，并删除对应 .py 源码
RUN test -n "$LICENSE_PUBKEY" || (echo "LICENSE_PUBKEY build-arg 未提供" && exit 1) && \
    pip install --no-cache-dir cython==3.0.11 && \
    sed -i "s|@@LICENSE_PUBKEY@@|${LICENSE_PUBKEY}|" app/licensing/verifier.py && \
    grep -q "@@LICENSE_PUBKEY@@" app/licensing/verifier.py && (echo "公钥注入失败" && exit 1) || true && \
    cythonize -i -3 app/licensing/verifier.py app/licensing/fingerprint.py app/licensing/state.py && \
    rm -f app/licensing/verifier.py app/licensing/fingerprint.py app/licensing/state.py \
          app/licensing/verifier.c app/licensing/fingerprint.c app/licensing/state.c && \
    pip uninstall -y cython && \
    python -c "from app.licensing import state; print('licensing 编译校验通过')"
```

- [ ] **Step 2: 本地构建镜像验证编译链**

```bash
cd backend && docker build --build-arg LICENSE_PUBKEY="$(cat ../keys/public_key.b64)" -t mypdm-backend:license-test .
```

Expected: 构建成功，末尾打印 `licensing 编译校验通过`

- [ ] **Step 3: 确认镜像内无许可源码**

```bash
docker run --rm mypdm-backend:license-test sh -c "ls app/licensing/"
```

Expected: 只有 `__init__.py`、`middleware.py`、`router.py` 和三个 `.so`，**没有** `verifier.py` / `fingerprint.py` / `state.py`

- [ ] **Step 4: 写生产 compose**

创建 `docker-compose.prod.yml`：

```yaml
# 生产部署配置。与开发版的关键差异：
#   - 不挂载后端源码（挂载会让客户直接改到许可校验代码，整套许可方案归零）
#   - 不开 --reload
#   - 挂载宿主机指纹三源（只读）
#   - backend 用预构建镜像，不给客户 build 上下文
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: bom_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER not set}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD not set}
      POSTGRES_DB: ${POSTGRES_DB:-bom_system}
    volumes:
      - ${PGDATA_HOST_PATH:-./pgdata}:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d
    restart: unless-stopped
    networks:
      - bom_network

  redis:
    image: redis:7-alpine
    container_name: bom_redis
    command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD not set}
    restart: unless-stopped
    networks:
      - bom_network

  backend:
    image: ${BACKEND_IMAGE:?BACKEND_IMAGE not set}
    container_name: bom_backend
    user: "0:0"
    entrypoint: sh -c "chown -R appuser:appuser /app/uploads && exec su appuser -c 'uvicorn app.main:app --host 0.0.0.0 --port 8000'"
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-bom_system}
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - UPLOAD_DIR=/app/uploads
      - CHUNK_DIR=/app/uploads/chunks
      - MAX_FILE_SIZE=1073741824
      - CHUNK_SIZE=5242880
      - APP_ENV=production
      - LICENSE_DIR=/app/uploads/license
      - LICENSE_HOST_ROOT=/host
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
      - DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-chat}
      - JWT_SECRET=${JWT_SECRET:?JWT_SECRET not set}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
      - CORS_ORIGINS=${CORS_ORIGINS:?CORS_ORIGINS not set}
    volumes:
      - ${UPLOADS_HOST_PATH:-./uploads}:/app/uploads
      # 宿主机硬件指纹三源（只读）
      - /sys/class/dmi/id/product_uuid:/host/product_uuid:ro
      - /etc/machine-id:/host/machine-id:ro
      - /sys/class/net:/host/net:ro
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - bom_network

  nginx:
    image: nginx:alpine
    container_name: bom_nginx
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf
      - ./frontend/dist:/usr/share/nginx/html
      - ./certs:/etc/nginx/certs
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - bom_network
    ports:
      - "${NGINX_HOST_PORT:-8080}:443"

networks:
  bom_network:
    driver: bridge
```

- [ ] **Step 5: 写部署文档**

创建 `docs/部署-商业许可.md`：

```markdown
# 商业许可部署与签发流程

## 一、构建（供应商侧，一次性 + 每次发版）

```bash
# 首次：生成密钥对（此后永不重新生成，私钥离线备份两份）
python tools/license_issuer/keygen.py --out ./keys

# 每次发版：构建后端镜像，注入公钥
cd backend
docker build --build-arg LICENSE_PUBKEY="$(cat ../keys/public_key.b64)" \
  -t mypdm-backend:v1.6.1 .
docker save mypdm-backend:v1.6.1 | gzip > mypdm-backend-v1.6.1.tar.gz
```

## 二、交付物清单

- `docker-compose.prod.yml`
- `.env`（客户按模板填写）
- `nginx/nginx.conf`、`certs/`
- `initdb/`
- `frontend/dist/`
- `mypdm-backend-<版本>.tar.gz`

**不含** `backend/` 源码目录，**不含** `tools/license_issuer/`。

## 三、客户部署

```bash
docker load < mypdm-backend-v1.6.1.tar.gz
docker compose -f docker-compose.prod.yml up -d
```

首次启动无许可证，系统处于只读模式。管理员登录后进入
「系统设置 → 许可管理」，复制机器码发给供应商。

## 四、签发与激活

供应商侧：

```bash
python tools/license_issuer/issue.py \
  --customer "某某机械有限公司" \
  --machine-code "<客户提供的机器码>" \
  --expires 2027-07-28 --max-users 50 --edition full \
  --out ./licenses/某某机械_20260728.lic
```

把 `.lic` 文件发给客户，客户在「许可管理」页上传即生效，无需重启。

## 五、续期与换机

- **续期**：用同一机器码重新签发，客户上传覆盖。
- **换服务器**：客户在新机部署后提供新机器码，重新签发。这一步等于人工确认了一次授权转移。
- **换网卡或重装系统**：三段指纹中一段变化仍判定为同机，无需重新签发。

## 六、许可状态与系统行为

| 情形 | 系统行为 |
|---|---|
| 正常 | 全功能可用 |
| 过期（15 天宽限期内） | 全功能可用，顶部黄色横幅告警 |
| 过期（超宽限期） | 只读模式：可查询、可导出，不可新增/修改/删除 |
| 许可证被篡改或拷到其他机器 | 立即只读，无宽限期 |
| 启用用户数达上限 | 不降级，仅无法新建或启用用户 |
| 模块未授权 | 该模块菜单隐藏，接口 403 |

任何状态下客户数据均可查看与导出。
```

- [ ] **Step 6: 校验 compose 语法**

```bash
docker compose -f docker-compose.prod.yml config -q && echo "compose 配置合法"
```

Expected: 输出 `compose 配置合法`（需先设好必填环境变量，或临时用 `.env` 填占位值）

- [ ] **Step 7: 端到端联调（需 Linux 服务器）**

在 Linux 服务器上：

```bash
docker compose -f docker-compose.prod.yml up -d && sleep 20 && docker compose -f docker-compose.prod.yml logs backend | tail -30
```

Expected: 后端正常启动，日志含 `✓ licenses 表检查完成`

手工验证清单（逐项确认）：
1. 登录后顶部显示红色横幅「未安装许可证」
2. 「系统设置 → 许可管理」能看到机器码，复制可用
3. 用该机器码签发 `--edition basic` 的 license，上传后横幅消失
4. 侧边栏「变更管理」「库存管理」「项目管理」三项消失
5. 直接访问 `/api/inventory/stock` 返回 403 且 `license_state == "MODULE_DENIED"`
6. 换 `--edition full` 重新签发上传，三个菜单恢复
7. 签发 `--expires` 为昨天、`--grace-days 0` 的 license，上传后写操作 403、查询与导出正常
8. 把 license 拷到另一台机器的部署上，状态显示 TAMPERED

- [ ] **Step 8: 提交**

```bash
git add backend/Dockerfile docker-compose.prod.yml docs/部署-商业许可.md
git commit -m "chore: 许可模块 Cython 编译与生产部署配置"
```

---

## 附录：实施前必须完成的准备

1. 运行 `keygen.py` 生成 Ed25519 密钥对，并完成私钥的**两份离线备份**
2. 准备一台 Linux 服务器用于 Task 10 端到端联调（Windows 本机验证不了真实指纹路径）
3. 确认私有镜像仓库地址，或确定以 tar 包方式交付
