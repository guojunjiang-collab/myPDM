# 首次登录强制修改密码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建用户首次登录、以及管理员重置密码之后，用户必须先修改密码才能使用系统，拦截由后端强制生效。

**Architecture:** `users` 表增加 `must_change_password` 布尔列。后端所有业务路由都经由 `get_current_active_user` 依赖（`require_permission` 也链到它），在该依赖里加一条检查即可全覆盖拦截，只豁免 `GET /auth/me` 和 `POST /auth/change-password` 两个接口。前端在登录后读 `/auth/me` 的该字段决定跳转，并用一个无导航出口的强制改密页承接。

**Tech Stack:** FastAPI + SQLAlchemy + pydantic v2 + bcrypt（后端）；React + react-router-dom + zustand + axios + TailwindCSS（前端）；pytest + TestClient + 内存 SQLite（测试）。

## Global Constraints

- 数据库迁移**不使用 alembic**。新列通过 `backend/app/main.py` 启动时的幂等 `ALTER TABLE` 添加，沿用该文件既有写法。
- 新列默认值必须是 `FALSE`，保证升级后存量用户不被拦截。
- 拦截错误码固定为 **HTTP 403**，`detail` 固定为字符串 **`"PASSWORD_CHANGE_REQUIRED"`**，前后端约定一致，不要改写成中文。
- 豁免接口**只有两个**：`GET /auth/me`、`POST /auth/change-password`。
- 管理员重置密码继续使用固定值 `123456`（前端 `Users.tsx` 已有逻辑，不改）。
- 管理员创建用户时填写的初始密码**不施加**强度规则。
- 强制改密页**唯一出口是"退出登录"**，不放任何其他导航链接。
- 后端测试用内存 SQLite（`tests/conftest.py` 的 `db` fixture），前端交付标准是 `npm run build` 通过。
- 中文文案，与现有页面风格一致（`primary-*` 配色）。

## 与 spec 的三处偏差（已在实现中确定）

实现前读代码发现的现状，均为简化，不改变功能目标：

1. **密码强度规则已存在且更严**。`schemas.ChangePasswordRequest` 已要求 ≥8 位且必须含大写、小写、数字（`backend/app/schemas.py:96-111`），比 spec 写的"≥8 且含字母+数字"更严，也已经天然挡掉 `123456`/`password`/`admin`。因此**不新增弱密码黑名单**（YAGNI），只补 spec 要求的"新密码不得与旧密码相同"。
2. **`/auth/token` 响应不加 `must_change_password` 字段**。前端登录流程本来就会紧接着调 `/auth/me`（`Login.tsx:25`），而 `/auth/me` 是豁免接口，把字段加到 `UserResponse` 上即可，Token schema 无需改动。
3. **JWT payload 不携带该标记**。判定始终查库，token 里放一份既无人使用也增加不一致风险。

## File Structure

**后端**

| 文件 | 职责 | 改动 |
|---|---|---|
| `backend/app/models.py` | `User` ORM 模型 | 加 `must_change_password` 列 |
| `backend/app/main.py` | 启动迁移 | 加一条幂等 ALTER TABLE |
| `backend/app/routers/auth.py` | 认证依赖与接口 | 拆依赖、加拦截、改密清标记 |
| `backend/app/schemas.py` | pydantic 模型 | `UserResponse` 加字段；`ChangePasswordRequest` 加"新旧不同"校验 |
| `backend/app/crud.py` | 用户 CRUD | `create_user` 置标记 |
| `backend/app/routers/users.py` | 用户管理接口 | 管理员改他人密码时置标记 |
| `backend/tests/test_force_password_change.py` | 新增测试 | 全部后端行为 |

**前端**

| 文件 | 职责 | 改动 |
|---|---|---|
| `frontend/src/pages/ForcePasswordChange.tsx` | 强制改密页（新建） | 无导航布局 + 改密表单 + 退出登录 |
| `frontend/src/types/index.ts` | 类型 | `User` 加可选字段 |
| `frontend/src/pages/Login.tsx` | 登录 | 按标记决定跳转目标 |
| `frontend/src/App.tsx` | 路由 | 新路由 + `ProtectedRoute` 守卫 |
| `frontend/src/services/api.ts` | 拦截器 | 403 兜底跳转 |
| `frontend/src/pages/Users.tsx` | 用户管理页 | 重置密码确认框文案 |

**已知且接受的缺口：** `backend/app/routers/settings.py` 的 `GET /cad-naming` 没有任何认证依赖，属于只读配置接口，本次不改。

---

### Task 1: 数据模型与迁移

**Files:**
- Modify: `backend/app/models.py:2`（导入）、`backend/app/models.py:8-19`（`User` 类）
- Modify: `backend/app/main.py:416-419`（列迁移列表）
- Test: `backend/tests/test_force_password_change.py`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `User.must_change_password`（SQLAlchemy `Column(Boolean)`，Python 侧读到 `bool`，默认 `False`），后续所有任务都依赖它。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_force_password_change.py`：

```python
"""首次登录强制修改密码 —— 后端行为测试。"""
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import User
from app import crud


def make_user(db, username="u1", password="Passw0rd", role="admin",
              must_change=False, status="active"):
    user = User(
        id=uuid.uuid4(), username=username,
        password_hash=crud.get_password_hash(password),
        real_name="测试用户", role=role, status=status,
        must_change_password=must_change,
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def login(client, username="u1", password="Passw0rd"):
    r = client.post(
        "/api/auth/token",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_new_column_defaults_to_false(db):
    """存量用户语义：不显式赋值时该列为 False，不会被拦截。"""
    user = User(
        id=uuid.uuid4(), username="legacy",
        password_hash=crud.get_password_hash("Passw0rd"),
        real_name="存量用户", role="engineer", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    assert user.must_change_password is False
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：`TypeError: 'must_change_password' is an invalid keyword argument for User`（`make_user` 处）或 `AttributeError`。

- [ ] **Step 3: 加模型字段**

`backend/app/models.py` 第 2 行导入加上 `Boolean`：

```python
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Numeric, Text, JSON, UniqueConstraint, ForeignKey, LargeBinary
```

`User` 类里，在 `status` 那一行之后插入：

```python
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false")
```

- [ ] **Step 4: 加启动迁移**

`backend/app/main.py` 的 "ECO/ECR 列迁移（增量更新）" 列表（约 416-419 行）里追加一项：

```python
        for tbl, col, coltype in [
            ("ecrs", "cc_users", "JSONB NOT NULL DEFAULT '[]'"),
            ("ecos", "cc_users", "JSONB NOT NULL DEFAULT '[]'"),
            ("ecos", "release_items", "JSONB NOT NULL DEFAULT '[]'"),
            ("configuration_item_children", "quantity", "INTEGER NOT NULL DEFAULT 1"),
            ("users", "must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ]:
```

该循环本身已是"查 `information_schema` 不存在才 ADD"的幂等写法，无需额外代码。

- [ ] **Step 5: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：`test_new_column_defaults_to_false` PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/models.py backend/app/main.py backend/tests/test_force_password_change.py
git commit -m "feat: users 表增加 must_change_password 列及启动迁移"
```

---

### Task 2: 后端硬拦截

**Files:**
- Modify: `backend/app/routers/auth.py:48-51`（依赖）、`:89-91`（`/me`）、`:93-99`（改密）
- Test: `backend/tests/test_force_password_change.py`

**Interfaces:**
- Consumes: `User.must_change_password`（Task 1）
- Produces:
  - `get_current_user_pwchange(token, db) -> User` —— 只校验 `status == "active"`，**不**校验改密标记，供豁免接口使用
  - `get_current_active_user(current_user) -> User` —— 在前者基础上追加改密标记检查，抛 `HTTPException(403, "PASSWORD_CHANGE_REQUIRED")`
  - `POST /auth/change-password` 成功后把 `must_change_password` 置为 `False`

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_force_password_change.py`：

```python
def test_flagged_user_blocked_on_business_api(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"


def test_flagged_user_can_read_me(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["must_change_password"] is True


def test_flagged_user_can_change_password(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "NewPassw0rd"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_flag_cleared_after_change_and_access_restored(client, db):
    user = make_user(db, must_change=True)
    token = login(client)
    client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "NewPassw0rd"},
        headers={"Authorization": f"Bearer {token}"},
    )
    db.refresh(user)
    assert user.must_change_password is False

    new_token = login(client, password="NewPassw0rd")
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {new_token}"})
    assert r.status_code == 200


def test_unflagged_user_unaffected(client, db):
    make_user(db, must_change=False)
    token = login(client)
    r = client.get("/api/users/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_disabled_user_still_400_not_403(client, db):
    """禁用优先于改密标记：两者都命中时返回账户已禁用。"""
    make_user(db, must_change=True, status="disabled")
    token = login(client)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：`test_flagged_user_blocked_on_business_api` FAIL（返回 200 而非 403）、`test_flagged_user_can_read_me` FAIL（响应无 `must_change_password` 键）。

- [ ] **Step 3: 拆分依赖并加拦截**

`backend/app/routers/auth.py`，把现有的 `get_current_active_user`（48-51 行）整体替换为：

```python
async def get_current_user_pwchange(current_user: User = Depends(get_current_user)):
    """豁免版依赖：只校验账户状态，不校验强制改密标记。

    仅供 GET /auth/me 与 POST /auth/change-password 使用，新增接口不要用它。
    """
    if current_user.status != "active":
        raise HTTPException(status_code=400, detail="账户已被禁用")
    return current_user

async def get_current_active_user(current_user: User = Depends(get_current_user_pwchange)):
    if current_user.must_change_password:
        raise HTTPException(status_code=403, detail="PASSWORD_CHANGE_REQUIRED")
    return current_user
```

- [ ] **Step 4: 两个豁免接口改用新依赖**

同文件，`/me` 与 `/change-password` 的签名把 `get_current_active_user` 换成 `get_current_user_pwchange`，并在改密成功时清标记：

```python
@router.get("/me", response_model=schemas.UserResponse)
async def get_me(current_user: User = Depends(get_current_user_pwchange)):
    return current_user

@router.post("/change-password")
async def change_password(req: schemas.ChangePasswordRequest, current_user: User = Depends(get_current_user_pwchange), db: Session = Depends(get_db)):
    if not crud.verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    current_user.password_hash = crud.get_password_hash(req.new_password)
    current_user.must_change_password = False
    db.commit()
    return {"message": "密码修改成功"}
```

- [ ] **Step 5: `UserResponse` 暴露该字段**

`backend/app/schemas.py`，`UserResponse`（57-60 行）加一行：

```python
class UserResponse(UserBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    must_change_password: bool = False
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：本任务新增的 6 个测试全部 PASS。

- [ ] **Step 7: 跑全量后端测试确认没打破别的**

```bash
cd backend && python -m pytest -q
```

预期：无新增失败。

- [ ] **Step 8: 提交**

```bash
git add backend/app/routers/auth.py backend/app/schemas.py backend/tests/test_force_password_change.py
git commit -m "feat: 未改密用户除 /auth/me 与改密接口外一律 403 拦截"
```

---

### Task 3: 置位逻辑（创建用户 / 管理员重置）

**Files:**
- Modify: `backend/app/crud.py:40-52`（`create_user`）
- Modify: `backend/app/routers/users.py:29-34`（`update_user`）
- Test: `backend/tests/test_force_password_change.py`

**Interfaces:**
- Consumes: `User.must_change_password`（Task 1）、`get_current_active_user` 的 403 行为（Task 2）
- Produces: `crud.create_user` 返回的 `User` 其 `must_change_password` 恒为 `True`；`PUT /users/{user_id}` 携带 `password` 且目标不是操作者本人时，把目标用户置位。

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_force_password_change.py`：

```python
def test_created_user_is_flagged(client, db):
    make_user(db, username="admin1")
    token = login(client, username="admin1")
    r = client.post(
        "/api/users/",
        json={"username": "newbie", "real_name": "新人", "role": "engineer",
              "password": "Init1234"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["must_change_password"] is True


def test_admin_reset_flags_target_user(client, db):
    make_user(db, username="admin1")
    target = make_user(db, username="victim", role="engineer")
    assert target.must_change_password is False

    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{target.id}",
        json={"password": "123456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(target)
    assert target.must_change_password is True


def test_admin_changing_own_password_does_not_flag_self(client, db):
    """管理员在用户管理页改自己的密码，不应把自己锁进强制改密页。"""
    admin = make_user(db, username="admin1")
    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{admin.id}",
        json={"password": "Another1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(admin)
    assert admin.must_change_password is False


def test_admin_update_without_password_does_not_flag(client, db):
    make_user(db, username="admin1")
    target = make_user(db, username="victim", role="engineer")
    token = login(client, username="admin1")
    r = client.put(
        f"/api/users/{target.id}",
        json={"department": "研发部"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    db.refresh(target)
    assert target.must_change_password is False
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v -k "flag"
```

预期：`test_created_user_is_flagged` 与 `test_admin_reset_flags_target_user` FAIL（断言拿到 `False`）。

- [ ] **Step 3: 创建用户时置位**

`backend/app/crud.py` 的 `create_user`，在构造 `models.User(...)` 时加上该字段：

```python
def create_user(db, user):
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        username=user.username, password_hash=hashed_password,
        real_name=user.real_name, role=user.role,
        department=user.department, phone=user.phone, status=user.status,
        must_change_password=True,
    )
    if user.id:
        db_user.id = user.id
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
```

（`crud.create_user` 在后端只有 `routers/users.py:20` 一处调用，不存在被启动脚本或导入流程复用的路径。）

- [ ] **Step 4: 管理员重置他人密码时置位**

`backend/app/routers/users.py` 的 `update_user` 整体替换为：

```python
@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:update"))):
    db_user = crud.update_user(db, user_id, user_update)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 管理员替他人重置密码 → 该用户下次登录必须重设；改自己的密码不算
    if user_update.password is not None and db_user.id != current_user.id:
        db_user.must_change_password = True
        db.commit()
        db.refresh(db_user)
    return db_user
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：本任务 4 个测试及此前全部测试 PASS。

- [ ] **Step 6: 跑全量后端测试**

```bash
cd backend && python -m pytest -q
```

预期：无新增失败。注意若有既有测试断言"新建用户后立刻访问业务接口成功"，会因新拦截而失败——这属于预期行为变更，把该测试里的用户改成显式 `must_change_password=False` 即可，不要放宽拦截逻辑。

- [ ] **Step 7: 提交**

```bash
git add backend/app/crud.py backend/app/routers/users.py backend/tests/test_force_password_change.py
git commit -m "feat: 新建用户与管理员重置密码时置 must_change_password"
```

---

### Task 4: 新密码不得与旧密码相同

**Files:**
- Modify: `backend/app/schemas.py:96-111`（`ChangePasswordRequest`）
- Test: `backend/tests/test_force_password_change.py`

**Interfaces:**
- Consumes: 现有 `ChangePasswordRequest.old_password` / `new_password`
- Produces: `ChangePasswordRequest` 新增跨字段校验，违反时 pydantic 抛错 → FastAPI 返回 422。

既有的 `validate_password_strength` 校验器（≥8 位、含大小写与数字）保持不变，本任务只加"新旧不同"。

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_force_password_change.py`：

```python
def test_new_password_same_as_old_rejected(client, db):
    make_user(db, must_change=True)
    token = login(client)
    r = client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "Passw0rd"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_weak_new_password_rejected(client, db):
    """既有强度规则依然生效：123456 无大小写字母，直接被挡。"""
    make_user(db, must_change=True)
    token = login(client)
    r = client.post(
        "/api/auth/change-password",
        json={"old_password": "Passw0rd", "new_password": "123456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v -k "password_same or weak"
```

预期：`test_new_password_same_as_old_rejected` FAIL（返回 200）；`test_weak_new_password_rejected` 已经 PASS（既有规则生效）。

- [ ] **Step 3: 加跨字段校验**

`backend/app/schemas.py` 顶部若尚未导入 `model_validator`，在 pydantic 导入里补上（与 `field_validator` 同一行）：

```python
from pydantic import BaseModel, Field, field_validator, model_validator
```

`ChangePasswordRequest` 类末尾（`validate_password_strength` 之后）追加：

```python
    @model_validator(mode='after')
    def validate_new_differs_from_old(self):
        if self.new_password == self.old_password:
            raise ValueError('新密码不能与原密码相同')
        return self
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_force_password_change.py -v
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/app/schemas.py backend/tests/test_force_password_change.py
git commit -m "feat: 改密时校验新密码不得与原密码相同"
```

---

### Task 5: 前端强制改密流程

**Files:**
- Create: `frontend/src/pages/ForcePasswordChange.tsx`
- Modify: `frontend/src/types/index.ts:3-13`（`User` 接口）
- Modify: `frontend/src/pages/Login.tsx:19-27`（登录跳转）
- Modify: `frontend/src/App.tsx:24-30`（守卫）、`:36-37`（路由表）
- Modify: `frontend/src/services/api.ts:50-70`（响应拦截器）
- Modify: `frontend/src/pages/Users.tsx:592-599`（重置确认框文案）

**Interfaces:**
- Consumes: `GET /auth/me` 响应中的 `must_change_password: boolean`（Task 2）；业务接口 403 + `detail === "PASSWORD_CHANGE_REQUIRED"`（Task 2）；`authApi.changePassword(oldPassword, newPassword)`（已有，`services/api.ts:84`）；`useAuthStore` 的 `user` / `logout`（已有）
- Produces: 路由 `/change-password` 渲染 `ForcePasswordChange` 页面

- [ ] **Step 1: 扩展 User 类型**

`frontend/src/types/index.ts` 的 `User` 接口加一行：

```ts
export interface User {
  id: string;
  username: string;
  real_name: string;
  role: UserRole;
  department?: string;
  phone?: string;
  status: string;
  must_change_password?: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: 新建强制改密页**

新建 `frontend/src/pages/ForcePasswordChange.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function ForcePasswordChange() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与原密码相同');
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) ||
        !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('新密码至少8位，且需同时包含大写字母、小写字母和数字');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      const me = await authApi.getCurrentUser();
      useAuthStore.getState().setUser(me.data, token);
      navigate('/', { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail) && detail[0]?.msg) {
        setError(String(detail[0].msg).replace(/^Value error, /, ''));
      } else {
        setError('修改失败，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          退出登录
        </button>
      </div>

      <div className="flex justify-center px-4">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-xl font-semibold mb-2">请修改密码</h1>
          <p className="text-sm text-gray-500 mb-6">
            {user?.real_name ? `${user.real_name}，` : ''}
            你的密码需要重新设置后才能继续使用系统。这通常是因为你是首次登录，或管理员刚重置了你的密码。
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">原密码</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
              <p className="mt-1 text-xs text-gray-400">至少8位，需包含大写字母、小写字母和数字</p>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>

            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : '确认修改'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 登录后按标记跳转**

`frontend/src/pages/Login.tsx`，把 `handleSubmit` 里 `getCurrentUser` 之后的两行改为：

```tsx
      const userResponse = await authApi.getCurrentUser();
      useAuthStore.getState().setUser(userResponse.data, access_token);
      navigate(userResponse.data.must_change_password ? '/change-password' : '/');
```

- [ ] **Step 4: 加路由与守卫**

`frontend/src/App.tsx`：导入新页面（放在 `import Login from './pages/Login';` 之后）：

```tsx
import ForcePasswordChange from './pages/ForcePasswordChange';
```

`ProtectedRoute` 改为：

```tsx
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}
```

在 `<Route path="/login" ... />` 之后加一条新路由：

```tsx
        <Route path="/change-password" element={<ForcePasswordChangeRoute />} />
```

并在 `ProtectedRoute` 下方定义它——已登录才可进，标记已清则弹回首页，避免页面滞留：

```tsx
function ForcePasswordChangeRoute() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!user?.must_change_password) {
    return <Navigate to="/" replace />;
  }
  return <ForcePasswordChange />;
}
```

- [ ] **Step 5: 加 403 兜底拦截**

`frontend/src/services/api.ts` 的响应拦截器错误分支，在 401 处理之前插入：

```ts
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original: any = error.config;
    if (
      error.response?.status === 403 &&
      (error.response?.data as any)?.detail === 'PASSWORD_CHANGE_REQUIRED' &&
      window.location.pathname !== '/change-password'
    ) {
      window.location.href = '/change-password';
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && original && !original._retry) {
```

（其余部分不变。）

- [ ] **Step 6: 补重置密码确认文案**

`frontend/src/pages/Users.tsx` 的重置密码 `ConfirmModal`（591-599 行），只改 `content` 一个 prop，其余不动：

```tsx
        content="确定要将该用户密码重置为 123456 吗？该用户下次登录时必须重新设置密码。"
```

- [ ] **Step 7: 构建验证**

```bash
cd frontend && npm run build
```

预期：构建成功，无 TypeScript 报错。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/pages/ForcePasswordChange.tsx frontend/src/types/index.ts frontend/src/pages/Login.tsx frontend/src/App.tsx frontend/src/services/api.ts frontend/src/pages/Users.tsx
git commit -m "feat: 前端强制改密页与首次登录跳转"
```

---

## 手动验收（Docker 环境）

代码完成后按此清单实测：

- [ ] 升级后用现有账号登录，一切照旧，不出现改密页
- [ ] 管理员新建一个用户 → 用该账号登录 → 直接落在改密页，侧边栏与顶栏都不可见
- [ ] 在改密页手动把地址栏改成 `/parts` → 被弹回改密页
- [ ] 改密页点"退出登录" → 回到登录页
- [ ] 输入弱密码（如 `abc123`）→ 前端即时报错；输入与原密码相同 → 报错
- [ ] 正确改密 → 自动进入首页，功能正常
- [ ] 管理员重置某在线用户的密码 → 该用户下一次 API 请求被弹到改密页 → 用 `123456` 完成改密
- [ ] 管理员在用户管理页改自己的密码 → 不被弹到改密页
