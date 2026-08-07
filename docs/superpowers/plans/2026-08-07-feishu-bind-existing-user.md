# 飞书免登绑定已有用户（自助绑定）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已有用户能在系统设置里把普通飞书/EH 飞书身份自助绑定到自己账号，绑定后飞书免登直接进入原账号。

**Architecture:** 扩展现有飞书 OAuth 流程：`authorize` 支持 `intent` 参数生成绑定态 state，`callback` 按 state 的 `mode=binding` 分支执行绑定而非登录；绑定冲突时拒绝，已绑 guest 时改绑并停用 guest。前端在系统设置新增「飞书绑定」tab，绑定结果复用 `/feishu-callback` 展示。

**Tech Stack:** FastAPI + SQLAlchemy 2.0（现有 db.query 风格）、python-jose、React 18 + TypeScript、Vitest。

## Global Constraints

- 后端函数必须写类型注解；异常用 `HTTPException`（路由层）或 `ValueError`（CRUD 冲突语义）。
- 不修改 `user_feishu_bindings` 表结构；(provider, union_id) 唯一约束不变。
- 不做解绑、不做自动匹配（按姓名/手机号）、不做管理员改绑。
- 飞书身份已绑定其他正式账号时一律拒绝。
- 已绑 guest 时改绑当前用户，guest 置 `status='disabled'` 且保留数据。
- 前端文案使用中文；`Settings.tsx` 新 tab 必须排在「修改密码」之后。
- 每次前端源码修改后必须 `npm.cmd run build`。
- `.env` 不入库；App Secret 不写入代码、日志、提交信息。

---

### Task 1: CRUD 绑定核心逻辑

**Files:**
- Modify: `backend/app/crud.py`（在 `find_or_create_feishu_user` 之后新增两个函数）
- Test: `backend/tests/test_feishu_binding.py`（新建）

**Interfaces:**
- Consumes: `models.User`、`models.UserFeishuBinding`、现有 `get_feishu_binding(db, provider, union_id)`。
- Produces:
  - `bind_feishu_to_user(db, provider: str, union_id: str, user_id, feishu_user: dict) -> models.User`
    语义：无绑定→新建；已绑当前用户→幂等更新；已绑 guest→改绑并停用 guest；已绑其他正式账号→`raise ValueError("该飞书身份已绑定其他账号")`。
  - `get_user_feishu_bindings(db, user_id) -> list[models.UserFeishuBinding]`，按 provider 升序。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_feishu_binding.py`：

```python
import uuid
import pytest
from app import crud, models


def _mk_user(db, username="u", role="engineer", status="active"):
    user = models.User(
        id=uuid.uuid4(), username=username, password_hash="x",
        real_name=username, role=role, status=status,
    )
    db.add(user)
    db.flush()
    return user


def _mk_binding(db, provider, union_id, user_id):
    b = models.UserFeishuBinding(provider=provider, union_id=union_id, user_id=user_id)
    db.add(b)
    db.flush()
    return b


def test_bind_creates_binding(db):
    user = _mk_user(db)
    result = crud.bind_feishu_to_user(
        db, "feishu", "union_1", user.id,
        {"name": "张三", "avatar_url": "http://a", "open_id": "o1"},
    )
    assert result.id == user.id
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding is not None
    assert binding.user_id == user.id
    assert binding.name == "张三"


def test_bind_same_user_idempotent(db):
    user = _mk_user(db)
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三"})
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三新"})
    assert db.query(models.UserFeishuBinding).count() == 1
    binding = db.query(models.UserFeishuBinding).first()
    assert binding.name == "张三新"


def test_bind_takes_over_guest_and_disables_it(db):
    guest = _mk_user(db, username="guest1", role="guest")
    _mk_binding(db, "feishu", "union_1", guest.id)
    real = _mk_user(db, username="real")
    result = crud.bind_feishu_to_user(db, "feishu", "union_1", real.id, {"name": "李四"})
    assert result.id == real.id
    db.refresh(guest)
    assert guest.status == "disabled"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding.user_id == real.id


def test_bind_rejects_non_guest_conflict(db):
    other = _mk_user(db, username="other", role="engineer")
    _mk_binding(db, "feishu", "union_1", other.id)
    me = _mk_user(db, username="me")
    with pytest.raises(ValueError):
        crud.bind_feishu_to_user(db, "feishu", "union_1", me.id, {"name": "我"})


def test_bind_providers_isolated(db):
    user = _mk_user(db)
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三"})
    crud.bind_feishu_to_user(db, "feishu_eh", "union_1", user.id, {"name": "张三"})
    assert db.query(models.UserFeishuBinding).count() == 2


def test_get_user_feishu_bindings(db):
    user = _mk_user(db)
    _mk_binding(db, "feishu", "u1", user.id)
    _mk_binding(db, "feishu_eh", "u2", user.id)
    rows = crud.get_user_feishu_bindings(db, user.id)
    assert {r.provider for r in rows} == {"feishu", "feishu_eh"}
```

- [ ] **Step 2: 运行确认失败**

Run: `backend\.venv\Scripts\python -m pytest backend\tests\test_feishu_binding.py -v`
Expected: FAIL，`AttributeError: module 'app.crud' has no attribute 'bind_feishu_to_user'`。

- [ ] **Step 3: 实现 CRUD 函数**

在 `backend/app/crud.py` 的 `find_or_create_feishu_user` 之后追加：

```python
def bind_feishu_to_user(db, provider: str, union_id: str, user_id, feishu_user: dict):
    """把 (provider, union_id) 绑定到指定用户。
    已绑 guest 时改绑并停用 guest；已绑其他正式账号时抛 ValueError。"""
    binding = get_feishu_binding(db, provider, union_id)
    if binding and binding.user_id != user_id:
        old_user = db.query(models.User).filter(models.User.id == binding.user_id).first()
        if not (old_user and old_user.role == "guest"):
            raise ValueError("该飞书身份已绑定其他账号")
        old_user.status = "disabled"
    if not binding:
        binding = models.UserFeishuBinding(
            provider=provider, union_id=union_id, user_id=user_id,
        )
        db.add(binding)
    binding.user_id = user_id
    binding.name = feishu_user.get("name") or binding.name
    binding.avatar_url = feishu_user.get("avatar_url") or binding.avatar_url
    binding.open_id = feishu_user.get("open_id") or binding.open_id
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user and feishu_user.get("name"):
        db_user.real_name = feishu_user["name"]
    db.commit()
    return db_user


def get_user_feishu_bindings(db, user_id):
    return db.query(models.UserFeishuBinding).filter(
        models.UserFeishuBinding.user_id == user_id,
    ).order_by(models.UserFeishuBinding.provider).all()
```

- [ ] **Step 4: 运行确认通过**

Run: `backend\.venv\Scripts\python -m pytest backend\tests\test_feishu_binding.py -v`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud.py backend/tests/test_feishu_binding.py
git commit -m "feat: 飞书身份绑定 CRUD（新建/幂等/guest 改绑停用/冲突拒绝）"
```

---

### Task 2: 后端绑定路由（intent / authorize / callback / bindings）

**Files:**
- Modify: `backend/app/routers/feishu.py`
- Test: `backend/tests/test_feishu_binding_api.py`（新建）

**Interfaces:**
- Consumes: `crud.bind_feishu_to_user`、`crud.get_user_feishu_bindings`（Task 1）、`get_current_user_pwchange`（来自 `.auth`）、`SECRET_KEY/ALGORITHM`。
- Produces:
  - `POST /api/auth/feishu/bind-intent`：body `{"provider": str}` → `{"intent": "<jwt>"}`，需登录。
  - `GET /api/auth/feishu/authorize?provider=xx&intent=yyy`：intent 校验通过后生成 `mode=binding` 的 state。
  - `GET /api/auth/feishu/callback`：state 为 binding 时执行绑定并跳 `#mode=binding&result=success|error&provider=xx&message=...`；否则维持登录行为。
  - `GET /api/auth/feishu/bindings`：`{"bindings": [{"provider","name","avatar_url","created_at"}]}`，需登录。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_feishu_binding_api.py`：

```python
import uuid
from urllib.parse import urlparse, parse_qs

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app import models
from app.main import app
from app.database import get_db
from app.routers.auth import SECRET_KEY, ALGORITHM, create_access_token
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


def _mk_user(db, username, role="engineer", status="active"):
    user = models.User(
        id=uuid.uuid4(), username=username, password_hash="x",
        real_name=username, role=role, status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth(user):
    token = create_access_token({"sub": user.username, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _bind(client, db, user):
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"}, headers=_auth(user))
    assert r.status_code == 200
    intent = r.json()["intent"]
    r2 = client.get("/api/auth/feishu/authorize", params={"provider": "feishu", "intent": intent},
                    follow_redirects=False)
    return parse_qs(urlparse(r2.headers["location"]).query)["state"][0]


def test_bind_intent_requires_login(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"})
    assert r.status_code == 401


def test_bind_intent_returns_signed_intent(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    r = client.post("/api/auth/feishu/bind-intent", json={"provider": "feishu"}, headers=_auth(user))
    assert r.status_code == 200
    payload = jwt.decode(r.json()["intent"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["typ"] == "feishu_bind_intent"
    assert payload["user_id"] == str(user.id)
    assert payload["provider"] == "feishu"


def test_authorize_with_intent_embeds_binding_state(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    state = _bind(client, db, user)
    payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["mode"] == "binding"
    assert payload["user_id"] == str(user.id)


def test_callback_binding_creates_binding_for_current_user(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, db, user)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    assert "result=success" in r.headers["location"]
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding is not None
    assert binding.user_id == user.id
    assert "access_token" not in r.headers["location"]


def test_callback_binding_conflict_redirects_error(monkeypatch, client, db):
    _setup_env(monkeypatch)
    other = _mk_user(db, "other", role="engineer")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_1", user_id=other.id))
    db.commit()
    me = _mk_user(db, "me")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, db, me)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    frag = parse_qs(r.headers["location"].split("#", 1)[1])
    assert frag["result"] == ["error"]
    assert "已绑定其他账号" in frag["message"][0]


def test_callback_binding_takes_over_guest(monkeypatch, client, db):
    _setup_env(monkeypatch)
    guest = _mk_user(db, "guest1", role="guest")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="union_1", user_id=guest.id))
    db.commit()
    real = _mk_user(db, "real")
    monkeypatch.setattr(FeishuClient, "exchange_oauth_code", _fake_exchange)
    monkeypatch.setattr(FeishuClient, "get_user_info", _fake_user_info)
    state = _bind(client, db, real)
    r = client.get("/api/auth/feishu/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    assert "result=success" in r.headers["location"]
    db.refresh(guest)
    assert guest.status == "disabled"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding.user_id == real.id


def test_bindings_requires_login(monkeypatch, client):
    _setup_env(monkeypatch)
    r = client.get("/api/auth/feishu/bindings")
    assert r.status_code == 401


def test_bindings_returns_current_user_rows(monkeypatch, client, db):
    _setup_env(monkeypatch)
    user = _mk_user(db, "alice")
    db.add(models.UserFeishuBinding(provider="feishu", union_id="u1", user_id=user.id, name="张三"))
    db.add(models.UserFeishuBinding(provider="feishu_eh", union_id="u2", user_id=user.id, name="张三"))
    db.commit()
    r = client.get("/api/auth/feishu/bindings", headers=_auth(user))
    assert r.status_code == 200
    rows = r.json()["bindings"]
    assert {x["provider"] for x in rows} == {"feishu", "feishu_eh"}
```

- [ ] **Step 2: 运行确认失败**

Run: `backend\.venv\Scripts\python -m pytest backend\tests\test_feishu_binding_api.py -v`
Expected: FAIL（`404 Not Found` 或签名不一致）。

- [ ] **Step 3: 实现路由**

修改 `backend/app/routers/feishu.py`：

1. 顶部 import 追加 `import uuid` 与 `from .. import models`；`from .auth import ALGORITHM, SECRET_KEY, create_access_token, create_refresh_token, get_current_user_pwchange`。
2. `_sign_state` 增加可选参数并支持绑定模式：

```python
def _sign_state(provider: str, user_id: str | None = None) -> str:
    payload = {
        "provider": provider,
        "typ": "feishu_state",
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_STATE_EXPIRE_MINUTES),
    }
    if user_id:
        payload["mode"] = "binding"
        payload["user_id"] = user_id
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

3. `_verify_state` 改为返回完整 payload：

```python
def _verify_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_state":
            raise KeyError
        return payload
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="state 无效或已过期")
```

4. `_authenticate` 拆出 `_fetch_user_info`（登录与绑定共用）：

```python
def _fetch_user_info(code: str, provider_name: str, jsapi: bool = False) -> dict:
    provider = _provider_or_400(provider_name)
    client = FeishuClient(provider)
    try:
        token_data = client.exchange_jsapi_code(code) if jsapi else client.exchange_oauth_code(code)
        user_info = client.get_user_info(token_data["access_token"])
    except FeishuError as exc:
        raise HTTPException(status_code=502, detail=f"飞书接口错误: {exc.message}")
    except KeyError:
        raise HTTPException(status_code=502, detail="飞书返回数据缺少 access_token")
    if not user_info.get("union_id"):
        raise HTTPException(status_code=502, detail="飞书未返回 union_id")
    return user_info


def _authenticate(code: str, provider_name: str, jsapi: bool, db: Session):
    user_info = _fetch_user_info(code, provider_name, jsapi=jsapi)
    user = crud.find_or_create_feishu_user(db, provider_name, user_info)
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已禁用")
    return user
```

5. 新增绑定 intent 常量与函数：

```python
FEISHU_BIND_EXPIRE_MINUTES = 10


class BindIntentRequest(BaseModel):
    provider: str


def _sign_intent(user_id, provider: str) -> str:
    payload = {
        "typ": "feishu_bind_intent",
        "user_id": str(user_id),
        "provider": provider,
        "exp": datetime.utcnow() + timedelta(minutes=FEISHU_BIND_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_intent(intent: str) -> dict:
    try:
        payload = jwt.decode(intent, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "feishu_bind_intent":
            raise KeyError
        return payload
    except (JWTError, KeyError):
        raise HTTPException(status_code=400, detail="绑定意图无效或已过期")
```

6. 扩展 authorize：

```python
@router.get("/authorize")
def feishu_authorize(provider: str, intent: str | None = None):
    provider_cfg = _provider_or_400(provider)
    if intent:
        payload = _verify_intent(intent)
        if payload.get("provider") != provider:
            raise HTTPException(status_code=400, detail="绑定意图与 provider 不匹配")
        state = _sign_state(provider, user_id=payload["user_id"])
    else:
        state = _sign_state(provider)
    client = FeishuClient(provider_cfg)
    return RedirectResponse(client.build_authorize_url(state))
```

7. 重写 callback 支持绑定模式：

```python
@router.get("/callback")
def feishu_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        payload = _verify_state(state)
        provider_name = payload["provider"]
        user_info = _fetch_user_info(code, provider_name)
        if payload.get("mode") == "binding":
            user_id = payload["user_id"]
            crud.bind_feishu_to_user(
                db, provider_name, user_info["union_id"], uuid.UUID(user_id), user_info,
            )
            fragment = urlencode({
                "mode": "binding", "result": "success", "provider": provider_name,
            })
            return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")
        user = crud.find_or_create_feishu_user(db, provider_name, user_info)
        if user.status != "active":
            raise HTTPException(status_code=403, detail="账号已禁用")
        fragment = urlencode(_login_response(user))
        return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    except ValueError as exc:
        fragment = urlencode({
            "mode": "binding", "result": "error",
            "provider": payload.get("provider", ""), "message": str(exc),
        })
        return RedirectResponse(f"{_redirect_base()}/feishu-callback#{fragment}")
```

8. 新增两个需登录的接口：

```python
@router.post("/bind-intent")
def feishu_bind_intent(
    req: BindIntentRequest,
    current_user: models.User = Depends(get_current_user_pwchange),
):
    _provider_or_400(req.provider)
    return {"intent": _sign_intent(current_user.id, req.provider)}


@router.get("/bindings")
def feishu_bindings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_pwchange),
):
    rows = crud.get_user_feishu_bindings(db, current_user.id)
    return {
        "bindings": [
            {
                "provider": b.provider,
                "name": b.name,
                "avatar_url": b.avatar_url,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in rows
        ]
    }
```

> `jsapi` 接口与 `_authenticate` 的 `jsapi=True` 调用保持不变。

- [ ] **Step 4: 运行确认通过**

Run: `backend\.venv\Scripts\python -m pytest backend\tests\test_feishu_binding_api.py backend\tests\test_feishu_auth.py -v`
Expected: 新测试 8 个 PASS，既有飞书测试全部 PASS（登录回归）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/feishu.py backend/tests/test_feishu_binding_api.py
git commit -m "feat: 飞书绑定接口（bind-intent/authorize/callback 绑定模式/bindings）"
```

---

### Task 3: 前端 API 与回调结果页

**Files:**
- Modify: `frontend/src/lib/feishu.ts`（新增 hash 解析纯函数）
- Modify: `frontend/src/services/api.ts`（authApi 新增两个方法）
- Modify: `frontend/src/pages/FeishuCallback.tsx`（绑定模式结果展示）
- Test: `frontend/src/lib/feishu.test.ts`（新建）

**Interfaces:**
- Consumes: 后端 `POST /auth/feishu/bind-intent`、`GET /auth/feishu/bindings`、回调 fragment 格式。
- Produces:
  - `parseFeishuCallbackHash(hash: string): { mode: 'binding' | null; result: 'success' | 'error' | null; provider: string | null; message: string | null }`
  - `authApi.feishuBindIntent(provider: string)`、`authApi.feishuBindings()`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/lib/feishu.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseFeishuCallbackHash } from './feishu';

describe('parseFeishuCallbackHash', () => {
  it('登录回调返回 mode=null', () => {
    expect(parseFeishuCallbackHash('#access_token=abc')).toEqual({
      mode: null, result: null, provider: null, message: null,
    });
  });

  it('解析绑定成功', () => {
    expect(parseFeishuCallbackHash('#mode=binding&result=success&provider=feishu')).toEqual({
      mode: 'binding', result: 'success', provider: 'feishu', message: null,
    });
  });

  it('解析绑定失败并带原因', () => {
    const hash = `#mode=binding&result=error&provider=feishu&message=${encodeURIComponent('该飞书身份已绑定其他账号')}`;
    const parsed = parseFeishuCallbackHash(hash);
    expect(parsed.mode).toBe('binding');
    expect(parsed.result).toBe('error');
    expect(parsed.message).toBe('该飞书身份已绑定其他账号');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend; npx vitest run src/lib/feishu.test.ts`
Expected: FAIL（`parseFeishuCallbackHash is not a function`）。

- [ ] **Step 3: 实现解析函数**

在 `frontend/src/lib/feishu.ts` 末尾追加：

```ts
export interface FeishuCallbackInfo {
  mode: 'binding' | null;
  result: 'success' | 'error' | null;
  provider: string | null;
  message: string | null;
}

export function parseFeishuCallbackHash(hash: string): FeishuCallbackInfo {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('mode') !== 'binding') {
    return { mode: null, result: null, provider: null, message: null };
  }
  const rawResult = params.get('result');
  return {
    mode: 'binding',
    result: rawResult === 'success' || rawResult === 'error' ? rawResult : null,
    provider: params.get('provider'),
    message: params.get('message'),
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend; npx vitest run src/lib/feishu.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 扩展 authApi**

`frontend/src/services/api.ts` 的 `authApi` 中追加：

```ts
  feishuBindIntent: (provider: string) => api.post('/auth/feishu/bind-intent', { provider }),
  feishuBindings: () => api.get('/auth/feishu/bindings'),
```

- [ ] **Step 6: 回调页支持绑定结果**

重写 `frontend/src/pages/FeishuCallback.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';
import { parseFeishuCallbackHash } from '../lib/feishu';

export default function FeishuCallback() {
  const navigate = useNavigate();
  const [bindingInfo] = useState(() => parseFeishuCallbackHash(window.location.hash));

  useEffect(() => {
    if (bindingInfo.mode === 'binding') return;

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
  }, [navigate, bindingInfo]);

  if (bindingInfo.mode === 'binding') {
    const ok = bindingInfo.result === 'success';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md text-center">
          <h1 className="text-xl font-semibold mb-4">{ok ? '绑定成功' : '绑定失败'}</h1>
          {!ok && <p className="text-sm text-red-600 mb-4">{bindingInfo.message || '未知错误'}</p>}
          {ok && <p className="text-sm text-gray-500 mb-4">该飞书入口已绑定到当前账号</p>}
          <Link
            to="/settings"
            className="inline-block px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            返回系统设置
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">正在登录...</div>
    </div>
  );
}
```

- [ ] **Step 7: 构建并运行测试**

Run: `cd frontend; npm.cmd run build`
Run: `cd frontend; npx vitest run src/lib/feishu.test.ts`
Expected: 构建成功，测试 PASS。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/lib/feishu.ts frontend/src/lib/feishu.test.ts frontend/src/services/api.ts frontend/src/pages/FeishuCallback.tsx
git commit -m "feat: 飞书绑定回调结果页与前端 API"
```

---

### Task 4: 系统设置「飞书绑定」tab

**Files:**
- Create: `frontend/src/components/FeishuBindPanel.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `authApi.feishuConfig()`、`authApi.feishuBindings()`、`authApi.feishuBindIntent(provider)`。
- Produces: `FeishuBindPanel` 默认导出组件，Settings 在 `activeTab === 'feishuBind'` 时渲染。

- [ ] **Step 1: 创建绑定面板组件**

新建 `frontend/src/components/FeishuBindPanel.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { authApi } from '../services/api';

interface FeishuProvider {
  key: string;
  name: string;
  app_id: string;
  jsapi: boolean;
}

interface FeishuBinding {
  provider: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string | null;
}

export default function FeishuBindPanel() {
  const [providers, setProviders] = useState<FeishuProvider[]>([]);
  const [bindings, setBindings] = useState<Record<string, FeishuBinding>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([authApi.feishuConfig(), authApi.feishuBindings()])
      .then(([cfgRes, bindRes]) => {
        setProviders(cfgRes.data.providers ?? []);
        const map: Record<string, FeishuBinding> = {};
        for (const b of bindRes.data.bindings ?? []) map[b.provider] = b;
        setBindings(map);
      })
      .catch(() => setError('加载飞书绑定信息失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleBind = async (provider: FeishuProvider) => {
    try {
      const res = await authApi.feishuBindIntent(provider.key);
      const intent = encodeURIComponent(res.data.intent);
      window.location.href = `/api/auth/feishu/authorize?provider=${provider.key}&intent=${intent}`;
    } catch {
      setError('发起绑定失败，请重试');
    }
  };

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-medium">飞书绑定</h3>
        <p className="text-sm text-gray-500">
          绑定后，飞书免登将直接进入当前账号；每个飞书入口只能绑定一个账号。
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-gray-400">未配置飞书应用</p>
        ) : (
          providers.map((p) => {
            const b = bindings[p.key];
            return (
              <div
                key={p.key}
                className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {b?.avatar_url && (
                    <img src={b.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    {b ? (
                      <p className="text-xs text-gray-500">{b.name || '已绑定'}</p>
                    ) : (
                      <p className="text-xs text-gray-400">未绑定</p>
                    )}
                  </div>
                </div>
                {b ? (
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">已绑定</span>
                ) : (
                  <button
                    onClick={() => handleBind(p)}
                    className="px-3 py-1 text-sm border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50"
                  >
                    绑定
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 接入 Settings 并构建**

修改 `frontend/src/pages/Settings.tsx`：

1. 顶部 import 追加：

```tsx
import FeishuBindPanel from '../components/FeishuBindPanel';
```

2. `TabKey` 类型与 tabs 数组：「修改密码」之后插入：

```tsx
  type TabKey = 'password' | 'feishuBind' | 'logs' | 'customFields' | 'dataManagement';
```

```tsx
    { key: 'password', label: '修改密码', enabled: true, adminOnly: false },
    { key: 'feishuBind', label: '飞书绑定', enabled: true, adminOnly: false },
```

3. 在 `{activeTab === 'password' && (...)}` 区块之后追加：

```tsx
      {/* 飞书绑定 */}
      {activeTab === 'feishuBind' && <FeishuBindPanel />}
```

Run: `cd frontend; npm.cmd run build`
Expected: 构建成功（tsc 无类型错误）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/FeishuBindPanel.tsx frontend/src/pages/Settings.tsx
git commit -m "feat: 系统设置新增飞书绑定 tab"
```

---

### Task 5: 文档与全量验证

**Files:**
- Modify: `docs/飞书免登配置指南.md`

- [ ] **Step 1: 更新配置指南**

在「四、前端行为说明」之后新增「五、已有账号绑定」章节（原章节顺延）：

```markdown
## 已有账号绑定（自助绑定）

已有账号的用户登录系统后，可在「系统设置 → 飞书绑定」把普通飞书/EH 飞书身份绑定到自己账号。绑定后飞书免登直接进入原账号。

规则：

- 未绑定过的飞书身份 → 直接绑定到当前账号；
- 该飞书身份已误绑到 guest 账号 → 自动改绑到当前账号，原 guest 账号停用但保留数据；
- 该飞书身份已绑定其他正式账号 → 拒绝并提示，需管理员介入（解绑功能暂未提供）；
- 每个飞书入口只能绑定一个账号，同一账号可分别绑定普通飞书与 EH；
- 当前版本不做解绑。
```

- [ ] **Step 2: 全量回归**

Run: `backend\.venv\Scripts\python -m pytest backend\tests\test_feishu_auth.py backend\tests\test_feishu_binding.py backend\tests\test_feishu_binding_api.py backend\tests\test_feishu_client.py -v`
Expected: 全部 PASS。

Run: `cd frontend; npm.cmd run build`
Expected: 构建成功。

- [ ] **Step 3: 手动验收清单**

1. 用已有账号（如 admin/123456）登录 → 系统设置 → 看到「飞书绑定」tab（所有角色可见）。
2. 未绑定状态点「绑定」→ 跳飞书授权 → 返回「绑定成功」→ 返回系统设置显示已绑定。
3. 换浏览器无痕打开登录页，用该飞书身份免登 → 进入**原账号**而非 guest。
4. 用另一个已有账号绑定同一飞书身份 → 回调页显示「该飞书身份已绑定其他账号」。
5. 先以飞书免登产生 guest，再用已有账号绑定该飞书身份 → 绑定成功，guest 在用户管理显示停用。
6. EH 按钮/入口用 `?feishu_provider=feishu_eh` 同样验证一遍。

- [ ] **Step 4: 提交**

```bash
git add docs/飞书免登配置指南.md
git commit -m "docs: 飞书免登配置指南补充已有账号绑定说明"
```
