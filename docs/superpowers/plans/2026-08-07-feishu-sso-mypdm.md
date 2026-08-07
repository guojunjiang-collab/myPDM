# myPDM 飞书免登（双飞书入口）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 myPDM 增加双飞书入口免密登录（普通飞书 + EH 企业），支持浏览器 OAuth 和飞书客户端内 JSAPI 两种登录方式，首次登录按 union_id 自动建号。

**Architecture:** 后端新增 feishu_client 封装（双 provider 环境变量配置）、`user_feishu_bindings` 绑定表、`/api/auth/feishu/*` 认证路由；身份按 `(provider, union_id)` 关联 users 表并签发现有 JWT。前端登录页增加「飞书登录」「飞书登录（EH）」两个按钮，飞书客户端内自动走 `tt.requestAccess` 免登，OAuth 回调经 `/feishu-callback` 页面把 token 写入现有 auth store。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + httpx（已有依赖，不新增）；React 18 + TypeScript + Vite + Zustand；PostgreSQL 16。

## Global Constraints

- 双 provider 名称固定为 `feishu` 和 `feishu_eh`；按钮文案固定为「飞书登录」和「飞书登录（EH）」。
- 回调基地址固定为 `https://192.168.61.105:8080`，回调路径为 `/api/auth/feishu/callback`。
- OAuth 授权码换 token 用 `POST /authen/v2/oauth/token`；JSAPI 授权码换 token 用 `POST /authen/v1/access_token`；用户信息用 `GET /authen/v1/user_info`。
- app_secret 只存后端 `.env`，不进前端、不提交 git、不写日志；接口响应不得包含 secret。
- 自动建号默认 `role=guest`、`status=active`、`must_change_password=False`；密码为不可登录的随机哈希。
- 本次**不修改** main.py 的启动迁移逻辑（“表不存在被当缺列”的 bug 由用户另行处理）；新表 DDL 写入 `initdb/init.sql`，当前数据库手动执行建表。
- 后端代码改完由 uvicorn `--reload` 自动生效；前端每次修改后必须执行 `npm run build`。
- 不新增 Python 依赖（httpx 已在 requirements.txt）。
- 测试沿用现有约定：`backend/tests/conftest.py` 提供内存 SQLite `db` fixture；路由测试用 `TestClient` + `app.dependency_overrides[get_db]`。
- 若本机未安装项目 Python 依赖：先执行 `python -m venv backend/.venv`，再用 `backend/.venv/Scripts/pip install -r backend/requirements.txt` 安装；所有 pytest 命令通过 `backend/.venv/Scripts/python -m pytest` 运行。
- `.env` 与 `.env.example` 均被 `.gitignore` 忽略，**不提交 git**（符合 secret 不入库规范）。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `backend/app/feishu_client.py` | 飞书 OpenAPI 客户端：provider 配置、授权地址、v1/v2 换 token、用户信息、统一错误 |
| `backend/app/models.py` | 新增 `UserFeishuBinding` 模型（User 旁） |
| `backend/app/crud.py` | 新增绑定查询与 `find_or_create_feishu_user` 自动建号 |
| `backend/app/routers/feishu.py` | `/api/auth/feishu/*` 四个路由 |
| `backend/app/main.py` | 注册 feishu router |
| `initdb/init.sql` | 新增 `user_feishu_bindings` 建表 DDL |
| `frontend/src/lib/feishu.ts` | JSSDK 加载、`tt.requestAccess` 封装、飞书客户端检测 |
| `frontend/src/pages/FeishuCallback.tsx` | OAuth 回调页：读 fragment token → 登录 |
| `frontend/src/pages/Login.tsx` | 双按钮 + JSAPI 自动免登 + 错误展示 |
| `frontend/src/services/api.ts` | `authApi.feishuConfig` / `feishuJsapiLogin` |
| `frontend/src/App.tsx` | 新增 `/feishu-callback` 路由 |
| `.env` / `.env.example` | 飞书双 provider 配置 |
| `backend/tests/test_feishu_client.py` | 客户端单测（mock httpx） |
| `backend/tests/test_feishu_bindings.py` | 绑定表模型测试 |
| `backend/tests/test_feishu_auth.py` | CRUD 建号 + 路由测试（TestClient + mock FeishuClient） |

---

### Task 1: 飞书客户端封装

**Files:**
- Create: `backend/app/feishu_client.py`
- Test: `backend/tests/test_feishu_client.py`

**Interfaces:**
- Produces: `FeishuError(code, message)`；`FeishuProvider(name, app_id, app_secret, redirect_uri)`；`get_provider(name) -> FeishuProvider | None`；`list_providers() -> list[FeishuProvider]`；`FeishuClient(provider, base_url="https://open.feishu.cn/open-apis")` 的方法 `build_authorize_url(state) -> str`、`exchange_oauth_code(code) -> dict`、`exchange_jsapi_code(code) -> dict`、`get_user_info(user_access_token) -> dict`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_feishu_client.py`：

```python
import pytest
import httpx
from app.feishu_client import FeishuClient, FeishuError, FeishuProvider, get_provider


def _provider(**kw):
    defaults = dict(name="feishu", app_id="cli_test", app_secret="sec",
                    redirect_uri="https://192.168.61.105:8080/api/auth/feishu/callback")
    defaults.update(kw)
    return FeishuProvider(**defaults)


def test_get_provider_returns_none_without_env(monkeypatch):
    monkeypatch.delenv("FEISHU_APP_ID", raising=False)
    monkeypatch.delenv("FEISHU_APP_SECRET", raising=False)
    assert get_provider("feishu") is None


def test_get_provider_reads_env(monkeypatch):
    monkeypatch.setenv("FEISHU_APP_ID", "cli_1")
    monkeypatch.setenv("FEISHU_APP_SECRET", "sec1")
    monkeypatch.setenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")
    p = get_provider("feishu")
    assert p.app_id == "cli_1"
    assert p.redirect_uri == "https://192.168.61.105:8080/api/auth/feishu/callback"


def test_build_authorize_url_contains_state(monkeypatch):
    client = FeishuClient(_provider())
    url = client.build_authorize_url("state123")
    assert "/authen/v1/authorize" in url
    assert "app_id=cli_test" in url
    assert "state=state123" in url


def test_exchange_oauth_code_uses_v2(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return httpx.Response(200, json={"access_token": "uat", "expires_in": 7200})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    data = FeishuClient(_provider()).exchange_oauth_code("code123")
    assert data["access_token"] == "uat"
    assert captured["url"].endswith("/authen/v2/oauth/token")
    assert captured["json"]["redirect_uri"] == "https://192.168.61.105:8080/api/auth/feishu/callback"


def test_exchange_jsapi_code_uses_v1(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        return httpx.Response(200, json={"code": 0, "data": {"access_token": "uat"}})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    data = FeishuClient(_provider()).exchange_jsapi_code("c1")
    assert data["access_token"] == "uat"
    assert captured["url"].endswith("/authen/v1/access_token")


def test_get_user_info(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        return httpx.Response(200, json={"code": 0, "data": {"union_id": "u1", "name": "张三"}})

    monkeypatch.setattr("app.feishu_client.httpx.get", fake_get)
    info = FeishuClient(_provider()).get_user_info("uat")
    assert info["union_id"] == "u1"


def test_feishu_error_on_nonzero_code(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(200, json={"code": 10001, "msg": "bad"})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    with pytest.raises(FeishuError) as ei:
        FeishuClient(_provider()).exchange_jsapi_code("c1")
    assert ei.value.code == "10001"


def test_http_error_raises(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(400, json={"error": "invalid_grant"})

    monkeypatch.setattr("app.feishu_client.httpx.post", fake_post)
    with pytest.raises(FeishuError):
        FeishuClient(_provider()).exchange_oauth_code("c1")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; python -m pytest tests/test_feishu_client.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.feishu_client'`

- [ ] **Step 3: 实现 `backend/app/feishu_client.py`**

```python
"""飞书 OpenAPI 客户端：双 provider 配置 + 授权码换 token + 用户信息。"""
import os
from urllib.parse import urlencode

import httpx

FEISHU_BASE_URL = "https://open.feishu.cn/open-apis"


class FeishuError(Exception):
    def __init__(self, code, message):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class FeishuProvider:
    def __init__(self, name: str, app_id: str, app_secret: str, redirect_uri: str):
        self.name = name
        self.app_id = app_id
        self.app_secret = app_secret
        self.redirect_uri = redirect_uri


def _provider_redirect_uri(redirect_base: str) -> str:
    return f"{redirect_base.rstrip('/')}/api/auth/feishu/callback"


def get_provider(name: str):
    """按 provider 名读取环境变量；未配置返回 None。"""
    prefix = "FEISHU_EH_" if name == "feishu_eh" else "FEISHU_"
    app_id = os.getenv(f"{prefix}APP_ID", "").strip()
    app_secret = os.getenv(f"{prefix}APP_SECRET", "").strip()
    if not app_id or not app_secret:
        return None
    redirect_base = os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080").strip()
    return FeishuProvider(name=name, app_id=app_id, app_secret=app_secret,
                          redirect_uri=_provider_redirect_uri(redirect_base))


def list_providers():
    return [p for name in ("feishu", "feishu_eh") if (p := get_provider(name))]


class FeishuClient:
    def __init__(self, provider: FeishuProvider, base_url: str = FEISHU_BASE_URL):
        self.provider = provider
        self.base_url = base_url.rstrip("/")

    def build_authorize_url(self, state: str) -> str:
        params = {
            "app_id": self.provider.app_id,
            "redirect_uri": self.provider.redirect_uri,
            "state": state,
        }
        return f"{self.base_url}/authen/v1/authorize?{urlencode(params)}"

    def exchange_oauth_code(self, code: str) -> dict:
        resp = httpx.post(
            f"{self.base_url}/authen/v2/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": self.provider.app_id,
                "client_secret": self.provider.app_secret,
                "code": code,
                "redirect_uri": self.provider.redirect_uri,
            },
            timeout=10,
        )
        return self._handle(resp)

    def exchange_jsapi_code(self, code: str) -> dict:
        resp = httpx.post(
            f"{self.base_url}/authen/v1/access_token",
            json={
                "app_id": self.provider.app_id,
                "app_secret": self.provider.app_secret,
                "grant_type": "authorization_code",
                "code": code,
            },
            timeout=10,
        )
        return self._handle(resp)

    def get_user_info(self, user_access_token: str) -> dict:
        resp = httpx.get(
            f"{self.base_url}/authen/v1/user_info",
            headers={"Authorization": f"Bearer {user_access_token}"},
            timeout=10,
        )
        return self._handle(resp)

    @staticmethod
    def _handle(resp: httpx.Response) -> dict:
        try:
            body = resp.json()
        except ValueError:
            raise FeishuError("http", f"非 JSON 响应: HTTP {resp.status_code}")
        if resp.status_code >= 400:
            msg = body.get("error_description") or body.get("msg") or body.get("error") or ""
            raise FeishuError("http", f"HTTP {resp.status_code} {msg}".strip())
        if isinstance(body, dict) and "code" in body and body.get("code", -1) != 0:
            raise FeishuError(str(body.get("code", "unknown")), body.get("msg", ""))
        data = body.get("data", body) if isinstance(body, dict) else body
        if not isinstance(data, dict):
            raise FeishuError("http", "飞书返回结构异常")
        return data
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend; python -m pytest tests/test_feishu_client.py -q`
Expected: `8 passed`

- [ ] **Step 5: 提交**

```bash
git add backend/app/feishu_client.py backend/tests/test_feishu_client.py
git commit -m "feat: 飞书 OpenAPI 客户端封装（双 provider）"
```

---

### Task 2: 绑定模型 + init.sql DDL

**Files:**
- Modify: `backend/app/models.py`（User 类之后追加）
- Modify: `initdb/init.sql`（users 表之后追加）
- Test: `backend/tests/test_feishu_bindings.py`

**Interfaces:**
- Produces: `models.UserFeishuBinding`，字段 `id/provider/union_id/open_id/name/avatar_url/user_id/created_at/updated_at`，唯一约束 `(provider, union_id)`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_feishu_bindings.py`：

```python
import uuid
import pytest
from sqlalchemy.exc import IntegrityError
from app import models


def test_binding_table_created(db):
    user = models.User(id=uuid.uuid4(), username="u1", password_hash="x",
                       real_name="用户", role="guest", status="active")
    db.add(user)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="uniq1", user_id=user.id))
    db.commit()
    row = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="uniq1").first()
    assert row.user_id == user.id


def test_binding_provider_union_unique(db):
    user = models.User(id=uuid.uuid4(), username="u1", password_hash="x",
                       real_name="用户", role="guest", status="active")
    db.add(user)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="same", user_id=user.id))
    db.commit()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="same", user_id=user.id))
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; python -m pytest tests/test_feishu_bindings.py -q`
Expected: FAIL with `AttributeError: module 'app.models' has no attribute 'UserFeishuBinding'`

- [ ] **Step 3: 实现模型与 DDL**

在 `backend/app/models.py` 的 `User` 类之后追加：

```python
class UserFeishuBinding(Base):
    """飞书免登绑定表：身份按 (provider, union_id) 隔离。"""
    __tablename__ = "user_feishu_bindings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(32), nullable=False)
    union_id = Column(String(128), nullable=False)
    open_id = Column(String(128), nullable=True)
    name = Column(String(64), nullable=True)
    avatar_url = Column(String(512), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (
        UniqueConstraint("provider", "union_id", name="uq_user_feishu_bindings_provider_union"),
    )
```

在 `initdb/init.sql` 的 `users` 表之后追加：

```sql
-- 飞书免登绑定表（provider 隔离，普通飞书 / EH 各自 union_id）
CREATE TABLE IF NOT EXISTS user_feishu_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(32) NOT NULL,
    union_id VARCHAR(128) NOT NULL,
    open_id VARCHAR(128),
    name VARCHAR(64),
    avatar_url VARCHAR(512),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_feishu_bindings_provider_union UNIQUE (provider, union_id)
);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend; python -m pytest tests/test_feishu_bindings.py -q`
Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add backend/app/models.py initdb/init.sql backend/tests/test_feishu_bindings.py
git commit -m "feat: user_feishu_bindings 绑定表模型与 DDL"
```

---

### Task 3: 绑定查询与自动建号 CRUD

**Files:**
- Modify: `backend/app/crud.py`（`authenticate_user` 之后追加）
- Test: `backend/tests/test_feishu_auth.py`

**Interfaces:**
- Consumes: `models.UserFeishuBinding`；`crud.get_password_hash`
- Produces: `crud.get_feishu_binding(db, provider, union_id) -> UserFeishuBinding | None`；`crud.find_or_create_feishu_user(db, provider, feishu_user: dict) -> models.User`，入参 dict 需含 `union_id`，可选 `name/open_id/avatar_url`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_feishu_auth.py`（先只放 CRUD 部分，路由测试在 Task 4 追加）：

```python
import uuid
import pytest
from app import crud, models


def test_find_or_create_creates_guest_user(db):
    user = crud.find_or_create_feishu_user(
        db, "feishu",
        {"union_id": "u1", "name": "张三", "open_id": "o1", "avatar_url": "http://a"},
    )
    assert user.role == "guest"
    assert user.must_change_password is False
    assert user.real_name == "张三"
    assert user.username == "张三"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="u1").first()
    assert binding is not None
    assert binding.user_id == user.id


def test_find_or_create_returns_same_user(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    assert user1.id == user2.id
    assert db.query(models.UserFeishuBinding).count() == 1


def test_username_collision_fallback(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "a", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu_eh", {"union_id": "b", "name": "张三"})
    assert user1.username == "张三"
    assert user2.username != "张三"
    assert user2.username.startswith("张三")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; python -m pytest tests/test_feishu_auth.py -q`
Expected: FAIL with `AttributeError: module 'app.crud' has no attribute 'find_or_create_feishu_user'`

- [ ] **Step 3: 实现 CRUD**

在 `backend/app/crud.py` 的 `authenticate_user` 之后追加：

```python
def get_feishu_binding(db, provider, union_id):
    return db.query(models.UserFeishuBinding).filter(
        models.UserFeishuBinding.provider == provider,
        models.UserFeishuBinding.union_id == union_id,
    ).first()


def _unique_username(db, name):
    import re
    import secrets
    base = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]", "", (name or "")).strip()[:32]
    if len(base) < 2:
        base = f"feishu_{secrets.token_hex(3)}"
    candidate = base
    i = 1
    while db.query(models.User).filter(models.User.username == candidate).first():
        candidate = f"{base[:24]}_{i}"
        i += 1
    return candidate


def find_or_create_feishu_user(db, provider, feishu_user):
    """按 (provider, union_id) 找绑定；不存在则自动建 guest 用户 + 绑定。"""
    import secrets
    union_id = feishu_user["union_id"]
    binding = get_feishu_binding(db, provider, union_id)
    if binding:
        binding.name = feishu_user.get("name") or binding.name
        binding.avatar_url = feishu_user.get("avatar_url") or binding.avatar_url
        db_user = db.query(models.User).filter(models.User.id == binding.user_id).first()
        if db_user and feishu_user.get("name"):
            db_user.real_name = feishu_user["name"]
        db.commit()
        return db_user

    name = feishu_user.get("name") or ""
    username = _unique_username(db, name)
    random_password = secrets.token_urlsafe(16)
    db_user = models.User(
        username=username,
        password_hash=get_password_hash(random_password),
        real_name=name or username,
        role="guest",
        status="active",
        must_change_password=False,
    )
    db.add(db_user)
    db.flush()
    db.add(models.UserFeishuBinding(
        provider=provider,
        union_id=union_id,
        open_id=feishu_user.get("open_id"),
        name=name or None,
        avatar_url=feishu_user.get("avatar_url"),
        user_id=db_user.id,
    ))
    db.commit()
    db.refresh(db_user)
    return db_user
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend; python -m pytest tests/test_feishu_auth.py -q`
Expected: `3 passed`

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud.py backend/tests/test_feishu_auth.py
git commit -m "feat: 飞书绑定查询与自动建号 CRUD"
```

---

### Task 4: 认证路由 + 注册

**Files:**
- Create: `backend/app/routers/feishu.py`
- Modify: `backend/app/main.py`（import 区 + include_router 区）
- Test: `backend/tests/test_feishu_auth.py`（追加路由测试）

**Interfaces:**
- Consumes: `FeishuClient/FeishuError/get_provider/list_providers`；`crud.find_or_create_feishu_user`；`auth.create_access_token/create_refresh_token/SECRET_KEY/ALGORITHM`；`get_db`
- Produces: `GET /api/auth/feishu/config` → `{"providers": [{"key","name","app_id","jsapi"}]}`；`GET /api/auth/feishu/authorize?provider=` → 302；`GET /api/auth/feishu/callback?code&state` → 302 到 `FEISHU_REDIRECT_BASE/feishu-callback#access_token=...&refresh_token=...` 或 `#error=...`；`POST /api/auth/feishu/jsapi {"provider","code"}` → Token JSON

- [ ] **Step 1: 追加路由测试（先确认失败）**

在 `backend/tests/test_feishu_auth.py` 追加（文件顶部已有 `import uuid`、`import pytest`、`from app import crud, models`）：

```python
from urllib.parse import urlparse, parse_qs
from fastapi.testclient import TestClient
from jose import jwt
from app.main import app
from app.database import get_db
from app.routers.auth import SECRET_KEY, ALGORITHM
from app.feishu_client import FeishuClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _setup_env(monkeypatch):
    monkeypatch.setenv("FEISHU_APP_ID", "cli_test")
    monkeypatch.setenv("FEISHU_APP_SECRET", "sec_test")
    monkeypatch.setenv("FEISHU_EH_APP_ID", "cli_eh")
    monkeypatch.setenv("FEISHU_EH_APP_SECRET", "sec_eh")
    monkeypatch.setenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080")


def _fake_exchange(self, code):
    return {"access_token": "fake_uat"}


def _fake_user_info(self, token):
    return {"union_id": "union_1", "open_id": "open_1", "name": "张三", "avatar_url": "http://a"}


def _get_state(location):
    return parse_qs(urlparse(location).query)["state"][0]


def test_config_lists_providers_without_secret(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/config")
    assert r.status_code == 200
    providers = r.json()["providers"]
    assert [p["key"] for p in providers] == ["feishu", "feishu_eh"]
    assert "app_secret" not in providers[0]


def test_authorize_redirects_to_feishu(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "/authen/v1/authorize" in r.headers["location"]


def test_callback_auto_creates_and_redirects_with_tokens(monkeypatch, client, db):
    _setup_env(monkeypatch)
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    state = _get_state(r.headers["location"])
    r2 = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                    follow_redirects=False)
    assert r2.status_code in (302, 307)
    assert r2.headers["location"].startswith("https://192.168.61.105:8080/feishu-callback#")
    assert db.query(models.UserFeishuBinding).count() == 1


def test_callback_rejects_disabled_user(monkeypatch, client, db):
    _setup_env(monkeypatch)
    disabled = models.User(id=uuid.uuid4(), username="disabled", password_hash="x",
                           real_name="停用", role="guest", status="disabled")
    db.add(disabled)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_dis", user_id=disabled.id))
    db.commit()
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info",
                        lambda self, token: {"union_id": "union_dis", "name": "停用"})
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu"},
                   follow_redirects=False)
    state = _get_state(r.headers["location"])
    r2 = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                    follow_redirects=False)
    assert "error=" in r2.headers["location"]


def test_callback_rejects_bad_state(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/callback",
                   params={"code": "c", "state": "bad"}, follow_redirects=False)
    assert "error=" in r.headers["location"]


def test_jsapi_login_returns_token(monkeypatch, client):
    _setup_env(monkeypatch)
    monkeypatch.setattr(FeishuClient, "exchange_jsapi_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    r = client.post("/api/auth/feishu/jsapi", json={"provider": "feishu", "code": "c1"})
    assert r.status_code == 200
    payload = jwt.decode(r.json()["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["sub"] == "张三"


def test_unconfigured_provider_returns_400(monkeypatch, client):
    _setup_env(monkeypatch)
    monkeypatch.delenv("FEISHU_EH_APP_ID")
    r = client.get("/api/auth/feishu/authorize", params={"provider": "feishu_eh"})
    assert r.status_code == 400
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend; python -m pytest tests/test_feishu_auth.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.routers.feishu'`

- [ ] **Step 3: 实现 `backend/app/routers/feishu.py`**

```python
"""飞书免登路由：config / authorize / callback / jsapi。"""
import os
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud
from ..database import get_db
from ..feishu_client import FeishuClient, FeishuError, get_provider, list_providers
from .auth import ALGORITHM, SECRET_KEY, create_access_token, create_refresh_token

router = APIRouter(prefix="/auth/feishu", tags=["飞书认证"])

FEISHU_STATE_EXPIRE_MINUTES = 10


class JsapiRequest(BaseModel):
    provider: str
    code: str


def _redirect_base() -> str:
    return os.getenv("FEISHU_REDIRECT_BASE", "https://192.168.61.105:8080").rstrip("/")


def _sign_state(provider: str) -> str:
    payload = {
        "provider": provider,
        "typ": "feishu_state",
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_state":
            raise KeyError
        return payload["provider"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="state 无效或已过期")


def _provider_or_400(name: str):
    provider = get_provider(name)
    if not provider:
        raise HTTPException(status_code=400, detail=f"provider 未配置: {name}")
    return provider


def _login_response(user):
    return {
        "access_token": create_access_token({"sub": user.username, "role": user.role}),
        "refresh_token": create_refresh_token(user.username),
        "token_type": "bearer",
    }


def _authenticate(code: str, provider_name: str, jsapi: bool, db: Session):
    provider = _provider_or_400(provider_name)
    client = FeishuClient(provider)
    try:
        token_data = client.exchange_jsapi_code(code) if jsapi else client.exchange_oauth_code(code)
        user_info = client.get_user_info(token_data["access_token"])
    except FeishuError as exc:
        raise HTTPException(status_code=502, detail=f"飞书接口错误: {exc.message}")
    except KeyError:
        raise HTTPException(status_code=502, detail="飞书返回数据缺少 access_token")
    union_id = user_info.get("union_id")
    if not union_id:
        raise HTTPException(status_code=502, detail="飞书未返回 union_id")
    user = crud.find_or_create_feishu_user(db, provider_name, user_info)
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已禁用")
    return user


def _error_redirect(detail: str) -> RedirectResponse:
    return RedirectResponse(f"{_redirect_base()}/feishu-callback#error={quote(detail)}")


@router.get("/config")
def feishu_config():
    return {
        "providers": [
            {
                "key": p.name,
                "name": "飞书登录" if p.name == "feishu" else "飞书登录（EH）",
                "app_id": p.app_id,
                "jsapi": True,
            }
            for p in list_providers()
        ]
    }


@router.get("/authorize")
def feishu_authorize(provider: str):
    provider_cfg = _provider_or_400(provider)
    state = _sign_state(provider)
    client = FeishuClient(provider_cfg)
    return RedirectResponse(client.build_authorize_url(state))


@router.get("/callback")
def feishu_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        provider_name = _verify_state(state)
        user = _authenticate(code, provider_name, jsapi=False, db=db)
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    fragment = urlencode(_login_response(user))
    return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")


@router.post("/jsapi")
def feishu_jsapi(req: JsapiRequest, db: Session = Depends(get_db)):
    user = _authenticate(req.code, req.provider, jsapi=True, db=db)
    return _login_response(user)
```

- [ ] **Step 4: 注册路由**

`backend/app/main.py`：

在 `from .routers import ...` 行下方追加 import：

```python
from .routers.feishu import router as feishu_router
```

在 `app.include_router(users_router, prefix="/api")` 之后追加：

```python
app.include_router(feishu_router, prefix="/api")
```

- [ ] **Step 5: 运行全部新增后端测试确认通过**

Run: `cd backend; python -m pytest tests/test_feishu_client.py tests/test_feishu_bindings.py tests/test_feishu_auth.py -q`
Expected: 全部 PASS（Task 4 共 6 个路由测试 + 3 个 CRUD 测试 + Task 1/2 的测试）

- [ ] **Step 6: 提交**

```bash
git add backend/app/routers/feishu.py backend/app/main.py backend/tests/test_feishu_auth.py
git commit -m "feat: 飞书免登认证路由（config/authorize/callback/jsapi）"
```

---

### Task 5: 前端 API + 回调页 + 路由

**Files:**
- Modify: `frontend/src/services/api.ts`（`authApi` 追加两个方法）
- Create: `frontend/src/pages/FeishuCallback.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: 后端 `GET /api/auth/feishu/config`、`POST /api/auth/feishu/jsapi`；`useAuthStore`；`authApi.getCurrentUser`
- Produces: `authApi.feishuConfig()`、`authApi.feishuJsapiLogin(provider, code)`；路由 `/feishu-callback`

- [ ] **Step 1: 扩展 `authApi`**

在 `frontend/src/services/api.ts` 的 `changePassword` 之后追加：

```typescript
  feishuConfig: () => api.get('/auth/feishu/config'),
  feishuJsapiLogin: (provider: string, code: string) =>
    api.post('/auth/feishu/jsapi', { provider, code }),
```

- [ ] **Step 2: 创建 `frontend/src/pages/FeishuCallback.tsx`**

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function FeishuCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const error = params.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!accessToken) {
      navigate('/login?error=' + encodeURIComponent('飞书登录失败：缺少令牌'), { replace: true });
      return;
    }

    useAuthStore.getState().setUser(null, accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);

    authApi
      .getCurrentUser()
      .then((res) => {
        useAuthStore.getState().setUser(res.data, accessToken);
        navigate('/', { replace: true });
      })
      .catch(() => {
        navigate('/login?error=' + encodeURIComponent('飞书登录失败：无法获取用户信息'), { replace: true });
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">正在登录...</div>
    </div>
  );
}
```

- [ ] **Step 3: 注册路由**

`frontend/src/App.tsx`：在 `import Login from './pages/Login';` 后追加：

```tsx
import FeishuCallback from './pages/FeishuCallback';
```

在 `<Route path="/login" element={<Login />} />` 后追加：

```tsx
<Route path="/feishu-callback" element={<FeishuCallback />} />
```

- [ ] **Step 4: 构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功，无 TS 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/services/api.ts frontend/src/pages/FeishuCallback.tsx frontend/src/App.tsx
git commit -m "feat: 飞书 OAuth 回调页与 authApi 扩展"
```

---

### Task 6: 登录页双按钮 + JSAPI 自动免登

**Files:**
- Create: `frontend/src/lib/feishu.ts`
- Modify: `frontend/src/pages/Login.tsx`（整体替换）

**Interfaces:**
- Consumes: `authApi.feishuConfig/feishuJsapiLogin`；`useAuthStore`；`authApi.getCurrentUser`
- Produces: `lib/feishu.ts` 的 `isFeishuClient() -> boolean`、`getFeishuProviderParam() -> string | null`、`loadH5Sdk() -> Promise<void>`、`requestAccessCode(appId) -> Promise<string>`

- [ ] **Step 1: 创建 `frontend/src/lib/feishu.ts`**

```ts
const H5_SDK_URL = 'https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.45.js';

declare global {
  interface Window {
    h5sdk?: any;
    tt?: any;
  }
}

export function isFeishuClient(): boolean {
  return /Feishu|Lark/i.test(navigator.userAgent);
}

export function getFeishuProviderParam(): string | null {
  return new URLSearchParams(window.location.search).get('feishu_provider');
}

export function loadH5Sdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.h5sdk) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = H5_SDK_URL;
    script.onload = () => {
      const start = Date.now();
      const timer = window.setInterval(() => {
        if (window.h5sdk) {
          window.clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 5000) {
          window.clearInterval(timer);
          reject(new Error('飞书 JSSDK 就绪超时'));
        }
      }, 100);
    };
    script.onerror = () => reject(new Error('加载飞书 JSSDK 失败'));
    document.head.appendChild(script);
  });
}

export function requestAccessCode(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tt = window.tt;
    if (!tt?.requestAccess) {
      reject(new Error('当前环境不支持飞书免登'));
      return;
    }
    tt.requestAccess({
      appID: appId,
      scopeList: [],
      success: (res: any) => {
        const raw = res && res.data && typeof res.data === 'object' ? res.data : res;
        const code = raw?.authCode ?? raw?.auth_code ?? raw?.code ?? (typeof raw === 'string' ? raw : null);
        if (code) resolve(String(code));
        else reject(new Error('飞书未返回授权码'));
      },
      fail: (err: any) => reject(new Error(err?.errMsg || '飞书免登失败')),
    });
  });
}
```

- [ ] **Step 2: 替换 `frontend/src/pages/Login.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';
import { getFeishuProviderParam, isFeishuClient, loadH5Sdk, requestAccessCode } from '../lib/feishu';

interface FeishuProvider {
  key: string;
  name: string;
  app_id: string;
  jsapi: boolean;
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [feishuProviders, setFeishuProviders] = useState<FeishuProvider[]>([]);

  const finishLogin = async (accessToken: string, refreshToken?: string | null) => {
    useAuthStore.getState().setUser(null, accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
    const userResponse = await authApi.getCurrentUser();
    useAuthStore.getState().setUser(userResponse.data, accessToken);
    navigate(userResponse.data.must_change_password ? '/change-password' : '/');
  };

  useEffect(() => {
    const urlError = new URLSearchParams(window.location.search).get('error');
    if (urlError) setError(urlError);

    let cancelled = false;
    authApi
      .feishuConfig()
      .then((res) => {
        const providers: FeishuProvider[] = res.data.providers ?? [];
        setFeishuProviders(providers);
        if (isFeishuClient() && providers.length > 0) {
          const want = getFeishuProviderParam();
          const provider =
            providers.find((p) => (want ? p.key === want : p.key === 'feishu')) ?? providers[0];
          if (provider?.jsapi) {
            loadH5Sdk()
              .then(() => requestAccessCode(provider.app_id))
              .then((code) => authApi.feishuJsapiLogin(provider.key, code))
              .then(async (loginRes) => {
                const { access_token, refresh_token } = loginRes.data;
                if (cancelled) return;
                await finishLogin(access_token, refresh_token);
              })
              .catch((e: Error) => {
                if (!cancelled) setError(e?.message || '飞书免登失败');
              });
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await authApi.login(username, password);
      const { access_token, refresh_token } = response.data;
      await finishLogin(access_token, refresh_token);
    } catch (err) {
      setError('用户名或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">🛠 PDM系统</h1>
          <p className="text-gray-500 mt-2">物料清单全生命周期数字化管理平台</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="请输入用户名"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="请输入密码"
              required
            />
          </div>

          {error && <p className="mb-4 text-sm text-red-600 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>

        {feishuProviders.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              <span className="flex-1 border-t border-gray-200" />
              或
              <span className="flex-1 border-t border-gray-200" />
            </div>
            <div className="mt-4 space-y-2">
              {feishuProviders.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    window.location.href = `/api/auth/feishu/authorize?provider=${p.key}`;
                  }}
                  className="w-full py-2 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功，无 TS 错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/lib/feishu.ts frontend/src/pages/Login.tsx
git commit -m "feat: 登录页飞书双按钮与 JSAPI 自动免登"
```

---

### Task 7: 配置、建表与本地验证

**Files:**
- Modify: `.env`
- Create: `.env.example`

**Interfaces:**
- Consumes: Task 1-6 全部产出

- [ ] **Step 1: 追加 `.env` 配置（值先留空，凭据到位后填写）**

```powershell
Add-Content -Path .env -Value @"

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_EH_APP_ID=
FEISHU_EH_APP_SECRET=
FEISHU_REDIRECT_BASE=https://192.168.61.105:8080
"@
```

- [ ] **Step 2: 创建 `.env.example`**

```powershell
Copy-Item .env .env.example
```

然后把 `.env.example` 里的所有 secret 值清空、路径值保留，确保不包含任何真实凭据。

- [ ] **Step 3: 当前数据库手动建表**

Run（PowerShell，从项目根目录）：

```powershell
docker exec -i bom_postgres psql -U bomadmin -d bom_system -c "CREATE TABLE IF NOT EXISTS user_feishu_bindings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), provider VARCHAR(32) NOT NULL, union_id VARCHAR(128) NOT NULL, open_id VARCHAR(128), name VARCHAR(64), avatar_url VARCHAR(512), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT uq_user_feishu_bindings_provider_union UNIQUE (provider, union_id));"
```

Expected: `CREATE TABLE`

- [ ] **Step 4: 后端自动重载验证 + 接口冒烟**

Run:

```powershell
docker logs bom_backend --tail 20
curl.exe -k -s https://192.168.61.105:8080/api/auth/feishu/config
```

Expected: uvicorn 重载完成无报错；config 返回 `{"providers":[]}`（未填凭据时）

- [ ] **Step 5: 全量后端测试 + 前端构建**

Run:

```powershell
cd backend; python -m pytest -q
cd ..\frontend; npm run build
```

Expected: 后端全部通过；前端构建成功

- [ ] **Step 6: 提交说明**

`.env` / `.env.example` 已被 `.gitignore` 忽略，本任务无文件提交；配置仅存本地。

---

### Task 8: 真实验证（凭据门禁）

**Files:** 无新增（依赖用户提供凭据与飞书后台配置）

**Interfaces:**
- Consumes: Task 7 的 `.env`

- [ ] **Step 1: 向用户索取非 EH 的 App ID/App Secret，填入 `.env` 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`**

```powershell
docker compose up -d --force-recreate backend
```

前提：`docker-compose.yml` 的 backend 服务 `environment` 已追加 `FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_EH_APP_ID/FEISHU_EH_APP_SECRET/FEISHU_REDIRECT_BASE`（容器不直接读根目录 `.env`，必须由 compose 注入）。

- [ ] **Step 2: 用户确认飞书后台已登记回调并发布**

回调地址：`https://192.168.61.105:8080/api/auth/feishu/callback`（末尾无 `/`）；权限 `contact:user.base:readonly`；可用范围含测试账号；已创建版本并发布。

- [ ] **Step 3: 验证浏览器 OAuth（非 EH）**

浏览器打开 `https://192.168.61.105:8080/login`（首次需信任自签名证书）→ 点「飞书登录」→ 飞书授权页 → 回跳 `/feishu-callback` → 进入系统。
Expected: 自动创建 guest 用户并登录成功；`users` 与 `user_feishu_bindings` 各新增一行。

- [ ] **Step 4: 验证飞书客户端内 JSAPI（非 EH）**

飞书开发者工具新建网页项目指向 `https://192.168.61.105:8080/login`，或飞书客户端内打开应用主页 → 页面自动免登进入系统。

- [ ] **Step 5: 提交 `.env.example`（凭据只进本地 `.env`，已被 .gitignore 排除，不提交）**

```bash
git add .env.example
git commit -m "chore: 同步飞书配置模板"
```

- [ ] **Step 6: EH 验证（用户提供 EH App ID/Secret 后）**

填入 `FEISHU_EH_APP_ID` / `FEISHU_EH_APP_SECRET` → `docker restart bom_backend` → 飞书后台登记 `https://192.168.61.105:8080/api/auth/feishu/callback`（同一回调路径，但对应 EH 应用）→ 登录页点「飞书登录（EH）」验证。

---

## Self-Review 记录

已对照设计文档逐节核对：客户端封装（§4.1）→ Task 1；绑定表与 DDL（§4.2）→ Task 2；建号规则（§4.4）→ Task 3；路由与 state（§4.3/§7/§8）→ Task 4；前端 API/回调页（§5.3/§5.4）→ Task 5；登录页按钮与 JSAPI（§5.1/§5.2）→ Task 6；配置与建表（§4.5）→ Task 7；验证（§9）→ Task 8。无占位符；函数签名跨任务一致（`get_provider`、`FeishuClient`、`find_or_create_feishu_user`、`feishuJsapiLogin` 等）。
