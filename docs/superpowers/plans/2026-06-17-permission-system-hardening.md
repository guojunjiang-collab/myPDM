# 用户权限系统巩固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一份权限定义文件 + 代码生成建立单一事实源，把后端 209 处 `require_role`、前端 94 处权限判断收敛到生成产物上，根除前后端漂移，并完成 3 项安全加固。

**Architecture:** `permissions/permissions.json`（唯一事实源）→ `tools/gen_permissions.py`（代码生成，产物提交入库）→ 后端 `require_permission()` 角色门 + 命名对象级策略 / 前端 `can()`。一个 pytest 同步守卫保证生成物不漂移。行为保持，逐路由迁移。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2（后端）；React 18 + TS + Zustand + Vite（前端）；纯 Python stdlib 生成器；pytest。

**源 spec:** `docs/superpowers/specs/2026-06-17-permission-system-hardening-design.md`（权限矩阵以其 §5、不一致裁决以其 §6 为准）。

---

## 文件结构

| 文件 | 职责 | 动作 |
| - | - | - |
| `permissions/permissions.json` | 唯一事实源：roles + resource:action→roles(+object_policy) | 创建 |
| `tools/gen_permissions.py` | 读 json，生成后端/前端常量 | 创建 |
| `backend/app/permissions/__init__.py` | `require_permission`/`has_permission`/`enforce_object_policy`/`register_policy` | 创建 |
| `backend/app/permissions/_generated.py` | 生成物：`ROLES`/`PERMISSIONS`/`OBJECT_POLICIES` | 生成(提交) |
| `backend/app/permissions/policies.py` | 5 个对象级策略函数 | 创建 |
| `backend/tests/test_permissions_sync.py` | 生成物漂移守卫 | 创建 |
| `backend/tests/test_require_permission.py` | 角色门 + 对象策略单元测试 | 创建 |
| `backend/app/routers/*.py` | 19 个路由：`require_role`→`require_permission`，内联检查→`enforce_object_policy` | 修改 |
| `frontend/src/constants/permissions.generated.ts` | 生成物：`Role`/`Permission`/`PERMISSIONS` | 生成(提交) |
| `frontend/src/stores/auth.ts` | 新增 `can()`，旧 helper 改薄封装 | 修改 |
| `frontend/package.json` | `pregen`/`prebuild` 钩子 | 修改 |
| `backend/app/routers/auth.py` | JWT 过期统一、`/refresh`、密钥 fail-fast | 修改 |
| `backend/app/routers/attachments_v2.py` | 媒体令牌签发 + 5 端点改校验媒体令牌 | 修改 |
| `backend/app/media_token.py` | 媒体令牌签发/校验工具 | 创建 |
| `backend/app/schemas.py` | `UserCreate`/`UserUpdate` 角色值校验 | 修改 |
| `frontend/src/services/api.ts` | 401 自动刷新拦截器 | 修改 |
| `项目说明/用户权限说明.md`, `AGENTS.md` | 文档对齐生成矩阵 | 修改 |

---

## Phase 0 — 单一事实源 + 代码生成

### Task 1: 创建权限定义文件 `permissions/permissions.json`

**Files:**
- Create: `permissions/permissions.json`

- [ ] **Step 1: 写入完整矩阵**（依据 spec §5；角色简写 A/E/P/G 在此展开为全名）

```json
{
  "roles": ["admin", "engineer", "production", "guest"],
  "permissions": {
    "parts:read": ["admin", "engineer", "production", "guest"],
    "parts:create": ["admin", "engineer"],
    "parts:update": ["admin", "engineer"],
    "parts:delete": ["admin"],
    "parts:export": ["admin", "engineer", "production"],
    "parts:import": ["admin", "engineer"],
    "parts.doc:read": ["admin", "engineer", "production", "guest"],
    "parts.doc:link": ["admin", "engineer"],
    "parts.doc:unlink": ["admin", "engineer"],

    "assemblies:read": ["admin", "engineer", "production", "guest"],
    "assemblies:create": ["admin", "engineer"],
    "assemblies:update": ["admin", "engineer"],
    "assemblies:delete": ["admin"],
    "assemblies.bom:manage": ["admin", "engineer"],
    "assemblies.bom:export_single": ["admin", "engineer", "production"],
    "assemblies.bom:import_export_all": ["admin"],
    "assemblies.doc:read": ["admin", "engineer", "production", "guest"],
    "assemblies.doc:link": ["admin", "engineer"],
    "assemblies.doc:unlink": ["admin", "engineer"],

    "documents:read": ["admin", "engineer", "production", "guest"],
    "documents:read_refs": ["admin", "engineer", "production", "guest"],
    "documents:create": ["admin", "engineer"],
    "documents:update": ["admin", "engineer"],
    "documents:delete": ["admin"],
    "documents:import_export_all": ["admin"],
    "documents.attachment:upload": ["admin", "engineer"],
    "documents.attachment:download": ["admin", "engineer", "production", "guest"],
    "documents.attachment:preview": ["admin", "engineer", "production", "guest"],
    "documents.attachment:delete": ["admin", "engineer"],

    "attachments:list": ["admin", "engineer"],
    "attachments:upload": ["admin", "engineer"],
    "attachments:download": ["admin", "engineer", "production", "guest"],
    "attachments:preview": ["admin", "engineer", "production", "guest"],
    "attachments:direct_download": ["admin", "engineer", "production", "guest"],
    "attachments:gltf": ["admin", "engineer", "production"],
    "attachments:archive_browse": ["admin", "engineer", "production"],
    "attachments:delete": ["admin", "engineer"],
    "attachments:convert_manage": ["admin"],

    "bom:tree": ["admin", "engineer", "production"],
    "bom:compare": ["admin", "engineer", "production"],
    "bom:trace": ["admin", "engineer", "production"],
    "bom:doc_refs": ["admin", "engineer", "production"],
    "bom:export": ["admin", "engineer", "production"],
    "bom:create_relation": ["admin", "engineer"],
    "bom:delete_relation": ["admin"],

    "configuration:read": ["admin", "engineer", "production", "guest"],
    "configuration:create": ["admin", "engineer"],
    "configuration:update": ["admin", "engineer"],
    "configuration:delete": ["admin"],
    "configuration:export": ["admin", "engineer", "production"],
    "configuration.doc:manage": ["admin", "engineer"],
    "configuration.item:manage": ["admin", "engineer"],
    "profile:read": ["admin", "engineer", "production", "guest"],
    "profile:create": ["admin", "engineer"],
    "profile:update": ["admin", "engineer"],
    "profile:delete": ["admin"],
    "profile:activate_archive": ["admin", "engineer"],
    "profile:change_status": ["admin"],
    "profile.bom:manage": ["admin", "engineer"],

    "ecr:read": ["admin", "engineer", "production", "guest"],
    "ecr:read_status_log": ["admin", "engineer", "production", "guest"],
    "ecr:bom_trace": ["admin", "engineer", "production", "guest"],
    "ecr:cc_manage": ["admin", "engineer", "production", "guest"],
    "ecr:create": ["admin", "engineer"],
    "ecr:update": { "roles": ["admin", "engineer"], "object_policy": "ecr_owner_or_admin" },
    "ecr:delete": { "roles": ["admin", "engineer"], "object_policy": "ecr_owner_or_admin" },
    "ecr:submit": { "roles": ["admin", "engineer"], "object_policy": "ecr_owner_or_admin" },
    "ecr:withdraw": { "roles": ["admin", "engineer"], "object_policy": "ecr_owner_or_admin" },
    "ecr:approve": { "roles": ["admin", "engineer"], "object_policy": "ecr_approver_or_admin" },
    "ecr:close": ["admin", "engineer"],
    "ecr:export_pdf": ["admin", "engineer", "production"],

    "eco:read": ["admin", "engineer", "production", "guest"],
    "eco:read_status_log": ["admin", "engineer", "production", "guest"],
    "eco:bom_trace": ["admin", "engineer", "production", "guest"],
    "eco:cc_manage": ["admin", "engineer", "production", "guest"],
    "eco:create": ["admin", "engineer"],
    "eco:update": { "roles": ["admin", "engineer"], "object_policy": "eco_owner_or_admin" },
    "eco:delete": { "roles": ["admin", "engineer"], "object_policy": "eco_owner_or_admin" },
    "eco:submit": { "roles": ["admin", "engineer"], "object_policy": "eco_owner_or_admin" },
    "eco:withdraw": { "roles": ["admin", "engineer"], "object_policy": "eco_owner_or_admin" },
    "eco:close": ["admin", "engineer"],
    "eco:execute": ["admin", "engineer"],
    "eco:execute_item": ["admin", "engineer"],
    "eco:execute_all": ["admin", "engineer"],
    "eco:revise": ["admin", "engineer"],
    "eco:restore": ["admin", "engineer"],
    "eco:freeze": ["admin", "engineer"],
    "eco:publish": ["admin", "engineer"],
    "eco.affected:manage": ["admin", "engineer"],
    "eco:export_pdf": ["admin", "engineer", "production"],

    "inventory.warehouse:read": ["admin", "engineer", "production", "guest"],
    "inventory.warehouse:write": ["admin", "engineer"],
    "inventory.warehouse:delete": ["admin"],
    "inventory.material:read": ["admin", "engineer", "production", "guest"],
    "inventory.material:write": ["admin", "engineer"],
    "inventory.material:enable_from_pdm": ["admin", "engineer"],
    "inventory.material:delete": ["admin"],
    "inventory.stock:read": ["admin", "engineer", "production", "guest"],
    "inventory.doc:read": ["admin", "engineer", "production", "guest"],
    "inventory.doc:write": ["admin", "engineer", "production"],
    "inventory.doc:delete": ["admin", "engineer", "production"],
    "inventory.doc:submit_withdraw_approve": ["admin", "engineer", "production"],
    "inventory.doc:post": { "roles": ["admin", "engineer", "production"], "object_policy": "inventory_keeper_or_admin" },

    "dashboard:read": ["admin", "engineer", "production", "guest"],
    "dashboard.folder:create": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.folder:rename": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.folder:delete": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.folder:share": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.folder:unshare": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.item:add": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard.item:delete": { "roles": ["admin", "engineer", "production", "guest"], "object_policy": "dashboard_folder_editor" },
    "dashboard:export_all": ["admin"],
    "dashboard:import_all": ["admin"],

    "assistant:chat": ["admin", "engineer", "production", "guest"],
    "assistant:download_artifact": ["admin", "engineer", "production", "guest"],

    "users:read": ["admin", "engineer", "production", "guest"],
    "users:read_detail": ["admin"],
    "users:create": ["admin"],
    "users:update": ["admin"],
    "users:delete": ["admin"],
    "users:reset_password": ["admin"],
    "users:import_export": ["admin"],

    "logs:read": ["admin"],

    "custom_field.def:read": ["admin"],
    "custom_field.def:write": ["admin"],
    "custom_field.def:sort": ["admin"],
    "custom_field.value:read": ["admin", "engineer", "production", "guest"],
    "custom_field.value:write": ["admin", "engineer"],
    "custom_field:reset_data": ["admin"],

    "admin.soft_delete:read": ["admin"],
    "admin.soft_delete:cleanup": ["admin"],

    "sync:read": ["admin", "engineer", "production", "guest"],

    "nav.admin_tools": ["admin", "engineer", "production"],
    "nav.settings": ["admin", "engineer"]
  }
}
```

- [ ] **Step 2: 校验 JSON 合法**

Run: `python -c "import json; json.load(open('permissions/permissions.json', encoding='utf-8')); print('ok')"`
Expected: 输出 `ok`

- [ ] **Step 3: Commit**

```bash
git add permissions/permissions.json
git commit -m "feat(perms): 权限单一事实源 permissions.json"
```

---

### Task 2: 代码生成器 `tools/gen_permissions.py`

**Files:**
- Create: `tools/gen_permissions.py`

- [ ] **Step 1: 写生成器**（纯 stdlib，`build()` 返回 (后端文本, 前端文本)，便于测试复用）

```python
#!/usr/bin/env python3
"""从 permissions/permissions.json 生成后端与前端权限常量（产物提交入库）。

Run: python tools/gen_permissions.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "permissions" / "permissions.json"
BACKEND_OUT = ROOT / "backend" / "app" / "permissions" / "_generated.py"
FRONTEND_OUT = ROOT / "frontend" / "src" / "constants" / "permissions.generated.ts"


def load():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    roles = data["roles"]
    perms: dict[str, list[str]] = {}
    policies: dict[str, str] = {}
    for name, val in data["permissions"].items():
        if isinstance(val, list):
            perms[name] = val
        else:
            perms[name] = val["roles"]
            if val.get("object_policy"):
                policies[name] = val["object_policy"]
    return roles, perms, policies


def render_backend(roles, perms, policies) -> str:
    lines = [
        "# AUTO-GENERATED by tools/gen_permissions.py — DO NOT EDIT BY HAND.",
        "from __future__ import annotations",
        "",
        f"ROLES: list[str] = {json.dumps(roles, ensure_ascii=False)}",
        "",
        "PERMISSIONS: dict[str, list[str]] = {",
    ]
    for name in sorted(perms):
        lines.append(f"    {json.dumps(name)}: {json.dumps(perms[name], ensure_ascii=False)},")
    lines += ["}", "", "OBJECT_POLICIES: dict[str, str] = {"]
    for name in sorted(policies):
        lines.append(f"    {json.dumps(name)}: {json.dumps(policies[name])},")
    lines += ["}", ""]
    return "\n".join(lines)


def render_frontend(roles, perms, policies) -> str:
    names = sorted(perms)
    union = " | ".join(json.dumps(n) for n in names) or "never"
    lines = [
        "// AUTO-GENERATED by tools/gen_permissions.py — DO NOT EDIT BY HAND.",
        "",
        f"export type Role = {' | '.join(json.dumps(r) for r in roles)};",
        f"export type Permission = {union};",
        "",
        "export const PERMISSIONS: Record<Permission, Role[]> = {",
    ]
    for name in names:
        roles_ts = "[" + ", ".join(json.dumps(r) for r in perms[name]) + "]"
        lines.append(f"  {json.dumps(name)}: {roles_ts},")
    lines += ["};", ""]
    return "\n".join(lines)


def build() -> tuple[str, str]:
    roles, perms, policies = load()
    return render_backend(roles, perms, policies), render_frontend(roles, perms, policies)


def main():
    backend_txt, frontend_txt = build()
    BACKEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    BACKEND_OUT.write_text(backend_txt, encoding="utf-8", newline="\n")
    FRONTEND_OUT.write_text(frontend_txt, encoding="utf-8", newline="\n")
    print(f"Wrote {BACKEND_OUT}")
    print(f"Wrote {FRONTEND_OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行生成器**

Run: `python tools/gen_permissions.py`
Expected: 打印两行 `Wrote ...`，生成 `backend/app/permissions/_generated.py` 与 `frontend/src/constants/permissions.generated.ts`

- [ ] **Step 3: 抽查生成物**

Run: `python -c "import sys; sys.path.insert(0,'backend'); from app.permissions._generated import PERMISSIONS, ROLES, OBJECT_POLICIES; print(len(PERMISSIONS), ROLES, OBJECT_POLICIES['ecr:update'])"`
Expected: 权限条数 + `['admin', 'engineer', 'production', 'guest']` + `ecr_owner_or_admin`

- [ ] **Step 4: Commit**

```bash
git add tools/gen_permissions.py backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(perms): 权限代码生成器 + 生成产物"
```

---

### Task 3: 同步守卫测试 `test_permissions_sync.py`

**Files:**
- Create: `backend/tests/test_permissions_sync.py`

- [ ] **Step 1: 写测试**（在内存重跑生成器，与已提交产物逐字符比对；用 `read_text()` 默认通用换行，避免 Windows CRLF 干扰）

```python
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tests -> backend -> myPDM


def _load_gen():
    spec = importlib.util.spec_from_file_location(
        "gen_permissions", ROOT / "tools" / "gen_permissions.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gen_permissions"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_generated_files_in_sync():
    gen = _load_gen()
    backend_txt, frontend_txt = gen.build()
    committed_backend = (ROOT / "backend/app/permissions/_generated.py").read_text(encoding="utf-8")
    committed_frontend = (ROOT / "frontend/src/constants/permissions.generated.ts").read_text(encoding="utf-8")
    assert backend_txt == committed_backend, "后端产物过期，请运行: python tools/gen_permissions.py"
    assert frontend_txt == committed_frontend, "前端产物过期，请运行: python tools/gen_permissions.py"
```

- [ ] **Step 2: 运行——应通过**

Run: `cd backend && python -m pytest tests/test_permissions_sync.py -v`
Expected: PASS

- [ ] **Step 3: 反向验证守卫有效**：临时改 `permissions.json` 某条角色，重跑测试应 FAIL，再还原

Run: 改后 `cd backend && python -m pytest tests/test_permissions_sync.py -v` → Expected: FAIL；`git checkout permissions/permissions.json` 还原后再跑 → PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_permissions_sync.py
git commit -m "test(perms): 生成物漂移守卫"
```

---

## Phase 1 — 后端权限执行核心

### Task 4: `require_permission` / `has_permission`

**Files:**
- Create: `backend/app/permissions/__init__.py`
- Test: `backend/tests/test_require_permission.py`

- [ ] **Step 1: 写失败测试**

```python
import pytest
from fastapi import HTTPException
from types import SimpleNamespace
from app.permissions import has_permission, require_permission, PERMISSIONS


def _user(role):
    return SimpleNamespace(role=role, status="active")


def test_has_permission_true_false():
    assert has_permission(_user("admin"), "parts:delete") is True
    assert has_permission(_user("engineer"), "parts:delete") is False


def test_has_permission_unknown_raises():
    with pytest.raises(KeyError):
        has_permission(_user("admin"), "parts:nope")


@pytest.mark.asyncio
async def test_require_permission_allows_and_denies():
    checker = require_permission("parts:create")
    assert (await checker(current_user=_user("engineer"))).role == "engineer"
    with pytest.raises(HTTPException) as exc:
        await checker(current_user=_user("guest"))
    assert exc.value.status_code == 403


def test_require_permission_unknown_perm_raises_at_build():
    with pytest.raises(KeyError):
        require_permission("totally:fake")
```

- [ ] **Step 2: 运行——应失败**

Run: `cd backend && python -m pytest tests/test_require_permission.py -v`
Expected: FAIL（`app.permissions` 无 `require_permission`）

- [ ] **Step 3: 实现 `__init__.py`**

```python
from fastapi import Depends, HTTPException

from ..models import User
from ._generated import PERMISSIONS, ROLES, OBJECT_POLICIES
from .policies import enforce_object_policy, register_policy  # noqa: F401  (导入即注册策略)

__all__ = [
    "PERMISSIONS", "ROLES", "OBJECT_POLICIES",
    "require_permission", "has_permission",
    "enforce_object_policy", "register_policy",
]


def has_permission(user: User, perm: str) -> bool:
    allowed = PERMISSIONS.get(perm)
    if allowed is None:
        raise KeyError(f"Unknown permission: {perm}")
    return user.role in allowed


def require_permission(perm: str):
    if perm not in PERMISSIONS:
        raise KeyError(f"Unknown permission: {perm}")  # 启动期 fail-fast
    # 惰性导入避免循环：schemas → permissions(__init__) → routers.auth → schemas
    from ..routers.auth import get_current_active_user

    async def checker(current_user: User = Depends(get_current_active_user)) -> User:
        if current_user.role not in PERMISSIONS[perm]:
            raise HTTPException(status_code=403, detail="权限不足")
        return current_user

    return checker
```

> **循环导入注意**：`__init__.py` **不得**在模块顶层 `import ..routers.auth`。因为 Task 25 后 `schemas.py` 会 `from .permissions._generated import ROLES`，这会触发 `permissions/__init__.py` 执行；而 `routers/auth.py` 顶层 `from .. import schemas`，若此时 `__init__` 又导入 auth 就成环。把 `get_current_active_user` 的导入放进 `require_permission` 函数体内（惰性）即可断环——路由在导入期调用 `require_permission(...)` 时 schemas 已加载完毕。`_generated.py` 仅依赖 stdlib，`policies.py` 仅依赖 `fastapi`+`..models`，均无环。

> 注：`__init__` 导入 `.policies`，故 Task 5 须先存在一个最小 `policies.py`（含 `enforce_object_policy`/`register_policy`）方可导入成功。本任务先在 Step 3 同时创建占位 `policies.py`（见下），Task 5 再补全 5 个策略。

最小 `backend/app/permissions/policies.py`：

```python
from fastapi import HTTPException

from ..models import User

_POLICY_FUNCS: dict = {}


def register_policy(name: str):
    def deco(fn):
        _POLICY_FUNCS[name] = fn
        return fn
    return deco


def enforce_object_policy(name: str, user: User, obj, **ctx) -> None:
    fn = _POLICY_FUNCS.get(name)
    if fn is None:
        raise KeyError(f"Unregistered object policy: {name}")
    if not fn(user, obj, **ctx):
        raise HTTPException(status_code=403, detail="无权操作该对象")
```

- [ ] **Step 4: 运行——应通过**

Run: `cd backend && python -m pytest tests/test_require_permission.py -v`
Expected: PASS（确保已装 `pytest-asyncio`；若缺则 `pip install pytest-asyncio` 并在 `backend/pytest.ini` 设 `asyncio_mode = auto`）

- [ ] **Step 5: Commit**

```bash
git add backend/app/permissions/__init__.py backend/app/permissions/policies.py backend/tests/test_require_permission.py
git commit -m "feat(perms): require_permission/has_permission 角色门"
```

---

### Task 5: 对象级策略 `policies.py`（5 个）

**Files:**
- Modify: `backend/app/permissions/policies.py`
- Test: `backend/tests/test_object_policies.py`

> 每个策略封装**现有内联检查的等价条件**（迁移时只是搬家，不改判定）。字段名以现有路由代码为准：ECR/ECO 用 `creator_id`；ECR 审批用现有 reviewer 集合；库存单据用 `keeper_id`；看板用 `DashboardFolderShare.permission == "edit"` 与文件夹归属。

- [ ] **Step 1: 写失败测试**

```python
import pytest
import uuid
from types import SimpleNamespace
from fastapi import HTTPException
from app.permissions.policies import enforce_object_policy


def _u(role, uid):
    return SimpleNamespace(role=role, id=uid)


def test_ecr_owner_or_admin():
    owner = uuid.uuid4()
    ecr = SimpleNamespace(creator_id=owner)
    enforce_object_policy("ecr_owner_or_admin", _u("engineer", owner), ecr)          # 创建者放行
    enforce_object_policy("ecr_owner_or_admin", _u("admin", uuid.uuid4()), ecr)       # admin 放行
    with pytest.raises(HTTPException):
        enforce_object_policy("ecr_owner_or_admin", _u("engineer", uuid.uuid4()), ecr)  # 他人拒绝


def test_inventory_keeper_or_admin():
    keeper = uuid.uuid4()
    doc = SimpleNamespace(keeper_id=keeper)
    enforce_object_policy("inventory_keeper_or_admin", _u("production", keeper), doc)
    with pytest.raises(HTTPException):
        enforce_object_policy("inventory_keeper_or_admin", _u("production", uuid.uuid4()), doc)


def test_dashboard_folder_editor_owner_and_share():
    owner = uuid.uuid4()
    other = uuid.uuid4()
    folder = SimpleNamespace(owner_user_id=owner, shares=[SimpleNamespace(shared_with_user_id=other, permission="edit")])
    enforce_object_policy("dashboard_folder_editor", _u("guest", owner), folder)        # 所有者
    enforce_object_policy("dashboard_folder_editor", _u("guest", other), folder)        # edit 分享
    with pytest.raises(HTTPException):
        enforce_object_policy("dashboard_folder_editor", _u("guest", uuid.uuid4()), folder)
```

- [ ] **Step 2: 运行——应失败**

Run: `cd backend && python -m pytest tests/test_object_policies.py -v`
Expected: FAIL（策略未注册）

- [ ] **Step 3: 在 `policies.py` 追加 5 个策略**（放在 `enforce_object_policy` 定义之后）

```python
def _is_admin(user) -> bool:
    return user.role == "admin"


@register_policy("ecr_owner_or_admin")
def _ecr_owner_or_admin(user, ecr, **_) -> bool:
    return _is_admin(user) or ecr.creator_id == user.id


@register_policy("eco_owner_or_admin")
def _eco_owner_or_admin(user, eco, **_) -> bool:
    return _is_admin(user) or eco.creator_id == user.id


@register_policy("ecr_approver_or_admin")
def _ecr_approver_or_admin(user, ecr, *, reviewer_ids=None, **_) -> bool:
    # reviewer_ids: 由 handler 传入的当前 ECR 指定审批人 id 集合（沿用现有计算逻辑）
    return _is_admin(user) or (reviewer_ids is not None and user.id in reviewer_ids)


@register_policy("inventory_keeper_or_admin")
def _inventory_keeper_or_admin(user, doc, **_) -> bool:
    return _is_admin(user) or getattr(doc, "keeper_id", None) == user.id


@register_policy("dashboard_folder_editor")
def _dashboard_folder_editor(user, folder, **_) -> bool:
    if _is_admin(user) or getattr(folder, "owner_user_id", None) == user.id:
        return True
    for share in getattr(folder, "shares", []) or []:
        if share.shared_with_user_id == user.id and share.permission == "edit":
            return True
    return False
```

> `dashboard` 文件夹归属字段：现模型 `DashboardFolder` 经 `dashboard_id`→`UserDashboard.user_id` 间接归属，无直接 `owner_user_id`。迁移 dashboard 路由（Task 17）时，handler 负责解析出 `owner_user_id` 后构造传入对象，或改为传 `owner_user_id=<resolved>` 到 `enforce_object_policy(..., owner_user_id=...)` 并相应调整策略签名。**实现 Task 17 前先确认该字段解析路径**，本策略以 `owner_user_id` 属性为契约。

- [ ] **Step 4: 运行——应通过**

Run: `cd backend && python -m pytest tests/test_object_policies.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/permissions/policies.py backend/tests/test_object_policies.py
git commit -m "feat(perms): 5 个对象级策略"
```

---

## Phase 2 — 路由迁移（行为保持，逐路由）

### 迁移配方（Migration Recipe，统一适用于 Phase 2 全部任务）

对每个路由文件，执行同一机械变换：

1. 把 `from .auth import require_role` 改为 `from ..permissions import require_permission`（保留 `get_current_active_user` 等其他导入；若文件仍有少量 `require_role` 暂未映射，可暂时两个都导入，迁完再删）。
2. 删除文件内自定义的 `READ_ROLES`/`WRITE_ROLES`/`MASTER_ROLES` 常量。
3. 把每个 `Depends(require_role([...]))` 按**该任务的映射表**替换为 `Depends(require_permission("<perm>"))`。
4. 对带对象级策略的端点（映射表标注 `+policy`），在 handler 内、角色门通过后加入 `enforce_object_policy("<policy>", current_user, <obj>[, **ctx])`，并**删除原内联创建者/审批人/保管人判断**（等价搬家）。
5. 跑该路由对应的现有测试 + 下方新增的 1 个回归断言，确认行为不变。

> 验证标准：迁移后该路由的**最低越权角色**在**关键写端点**仍得到 403，且现有测试全绿。

### 路由→权限映射总表（Appendix A）

> 形如 `METHOD 路径 → perm`。同一资源的 read 端点统一用对应 `*:read`。`+policy` 见 Phase 1 Task 5。

**parts.py** (13)：`GET /` `GET /{id}` `GET /{id}/can-delete` `GET /{id}/documents` `GET /{id}/versions` → `parts:read`(列表/详情/版本) 或 `parts.doc:read`(关联列表)；`POST /` → `parts:create`；`PUT /{id}` `POST /{id}/upgrade` → `parts:update`；`DELETE /{id}` → `parts:delete`；`POST /{id}/documents` → `parts.doc:link`；`PUT/DELETE /{id}/documents/{lid}` → `parts.doc:unlink`；导入导出端点 → `parts:import`/`parts:export`。

**assemblies.py** (17)：读 → `assemblies:read`/`assemblies.doc:read`；create/update/delete → `assemblies:{create,update,delete}`；BOM 项增删 → `assemblies.bom:manage`；单个 BOM 导出 → `assemblies.bom:export_single`；全量 BOM 导入导出 → `assemblies.bom:import_export_all`；关联文档增删 → `assemblies.doc:{link,unlink}`。

**documents.py** (14)：读 → `documents:read`/`documents:read_refs`；create/update/delete → `documents:{create,update,delete}`；附件上传 → `documents.attachment:upload`；附件删除 → `documents.attachment:delete`；下载/预览 → `documents.attachment:{download,preview}`；全量导入导出 → `documents:import_export_all`。

**bom.py** (10)：tree/compare/trace/doc_refs/export → 对应 `bom:*`；创建关系 → `bom:create_relation`；删除关系 → `bom:delete_relation`。

**configuration.py** (28)：构型读 → `configuration:read`，create/update/delete → `configuration:{create,update,delete}`，导出 → `configuration:export`，关联文档/子项 → `configuration.doc:manage`/`configuration.item:manage`；方案读 → `profile:read`，create/update/delete → `profile:{create,update,delete}`，激活归档 → `profile:activate_archive`，改状态 → `profile:change_status`，方案 BOM → `profile.bom:manage`。

**ecrs.py** (17)：读类 → `ecr:read`/`ecr:read_status_log`/`ecr:bom_trace`/`ecr:cc_manage`；`ecr:create`；编辑/删除/提交/撤回 → 对应 `ecr:{update,delete,submit,withdraw}` **+ `ecr_owner_or_admin`**；审批 → `ecr:approve` **+ `ecr_approver_or_admin`**（handler 传入 `reviewer_ids`）；关闭 → `ecr:close`；PDF → `ecr:export_pdf`。

**ecos.py** (27)：读类 → `eco:read`/`eco:read_status_log`/`eco:bom_trace`/`eco:cc_manage`；`eco:create`；编辑/删除/提交/撤回 → `eco:{update,delete,submit,withdraw}` **+ `eco_owner_or_admin`**；关闭 → `eco:close`；执行类 → `eco:{execute,execute_item,execute_all}`；升版/还原/冻结/发布 → `eco:{revise,restore,freeze,publish}`；受影响项 → `eco.affected:manage`；PDF → `eco:export_pdf`。

**inventory.py** (23)：读 → `inventory.{warehouse,material,stock,doc}:read`；仓库写/删 → `inventory.warehouse:{write,delete}`；物料写/删/启用 → `inventory.material:{write,delete,enable_from_pdm}`；单据写/删 → `inventory.doc:{write,delete}`；提交/撤回/审批 → `inventory.doc:submit_withdraw_approve`；过账 → `inventory.doc:post` **+ `inventory_keeper_or_admin`**。

**dashboard.py** (16)：`GET` 看板 → `dashboard:read`；文件夹增/改名/删/分享/取消分享 → `dashboard.folder:{create,rename,delete,share,unshare}` **+ `dashboard_folder_editor`**；收藏项增删 → `dashboard.item:{add,delete}` **+ `dashboard_folder_editor`**；全量导出/导入 → `dashboard:{export_all,import_all}`。

**users.py** (6)：列表 → `users:read`；详情 → `users:read_detail`；create/update/delete → `users:{create,update,delete}`；（重置密码/导入导出若有端点 → `users:reset_password`/`users:import_export`）。

**custom_fields.py** (10)：定义读/写/排序 → `custom_field.def:{read,write,sort}`；值读/写 → `custom_field.value:{read,write}`；重置 → `custom_field:reset_data`。

**logs.py** (2) → `logs:read`。**admin.py** (3) → `admin.soft_delete:{read,cleanup}`。**sync.py** (2) → `sync:read`。**assistant.py** (3) + `assistant/api_gateway.py` (2) → `assistant:chat`/`assistant:download_artifact`。**attachments_v2.py** (14) → 见 Phase 4 Task 21（与媒体令牌一并处理）。

---

### Task 6: 迁移 `parts.py`（含已工作示例）

**Files:**
- Modify: `backend/app/routers/parts.py`
- Test: `backend/tests/test_parts_perms.py`

- [ ] **Step 1: 按配方改导入与各端点**。示例（节选 `parts.py:10/31/40/57/105/174/227`）：

```python
# 顶部
from ..permissions import require_permission   # 替换 from .auth import require_role

# GET /            （原 require_role(["admin","engineer","production","guest"])）
current_user: User = Depends(require_permission("parts:read"))
# POST /           （原 ["admin","engineer"]）
current_user: User = Depends(require_permission("parts:create"))
# PUT /{part_id}   和 POST /{part_id}/upgrade
current_user: User = Depends(require_permission("parts:update"))
# DELETE /{part_id}（原 ["admin"]）
current_user: User = Depends(require_permission("parts:delete"))
# POST /{part_id}/documents
current_user: User = Depends(require_permission("parts.doc:link"))
# PUT/DELETE /{part_id}/documents/{link_id}
current_user: User = Depends(require_permission("parts.doc:unlink"))
```

- [ ] **Step 2: 写回归测试**（用现有测试夹具/客户端；若无统一夹具，参考 `backend/tests/test_inventory_api.py` 的登录方式取 4 角色 token）

```python
import pytest

# 假定存在 client 夹具与 token(role) 辅助（沿用现有测试约定）
@pytest.mark.parametrize("role,expect", [("admin",200),("engineer",200),("production",403),("guest",403)])
def test_parts_create_role_gate(client, token, role, expect):
    r = client.post("/api/parts/", json={"code":"PERMX","name":"x","version":"A"},
                    headers={"Authorization": f"Bearer {token(role)}"})
    assert r.status_code == expect


@pytest.mark.parametrize("role,expect", [("admin",200),("engineer",403),("production",403),("guest",403)])
def test_parts_delete_admin_only(client, token, existing_part_id, role, expect):
    r = client.delete(f"/api/parts/{existing_part_id}",
                      headers={"Authorization": f"Bearer {token(role)}"})
    assert r.status_code in ({expect, 400} if expect == 200 else {expect})
```

> 若现有测试套件无 `client`/`token` 夹具，本 Task 先在 `backend/tests/conftest.py` 添加：基于 TestClient 的 `client`，以及登录 4 个演示账号返回 token 的 `token` 工厂。该 conftest 供 Phase 2 所有路由测试复用（DRY）。

- [ ] **Step 3: 运行 parts 相关测试 + 全量回归**

Run: `cd backend && python -m pytest tests/test_parts_perms.py -v && python -m pytest -q`
Expected: 新测试 PASS，现有套件保持绿

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/parts.py backend/tests/test_parts_perms.py backend/tests/conftest.py
git commit -m "refactor(perms): parts 路由迁移至 require_permission"
```

---

### Task 7–20: 迁移其余路由（每个路由一个 Task / 一次提交）

> 对以下每个文件，重复 Task 6 的 5 步配方，映射表见 Appendix A。每个 Task 单独提交，提交信息 `refactor(perms): <router> 迁移至 require_permission`。带 `+policy` 的路由额外按 Task 5 注入 `enforce_object_policy` 并删除内联检查。

- [ ] **Task 7:** `assemblies.py` — 跑 `pytest -k assembl` + 全量回归
- [ ] **Task 8:** `documents.py`
- [ ] **Task 9:** `bom.py`
- [ ] **Task 10:** `configuration.py`（28 处，最大，分段核对）
- [ ] **Task 11:** `ecrs.py`（注入 `ecr_owner_or_admin` / `ecr_approver_or_admin`，删内联 `ecr.creator_id != current_user.id` 等判断）
- [ ] **Task 12:** `ecos.py`（注入 `eco_owner_or_admin`）
- [ ] **Task 13:** `inventory.py`（注入 `inventory_keeper_or_admin` 于过账；删 `MASTER_ROLES/WRITE_ROLES/READ_ROLES`）
- [ ] **Task 14:** `dashboard.py`（注入 `dashboard_folder_editor`，先确认 `owner_user_id` 解析路径见 Task 5 注）
- [ ] **Task 15:** `users.py`
- [ ] **Task 16:** `custom_fields.py`
- [ ] **Task 17:** `logs.py`
- [ ] **Task 18:** `admin.py`
- [ ] **Task 19:** `sync.py`
- [ ] **Task 20:** `assistant.py` + `assistant/api_gateway.py`

每个 Task 的验收：该路由现有测试 + 全量 `pytest -q` 绿；对其关键写端点新增/已存在一条最低越权角色得 403 的断言。

- [ ] **收尾:** 全仓搜索确认无残留：`grep -rn "require_role" backend/app/routers backend/app/assistant`（仅 `auth.py` 可保留 `require_role` 作为兼容 shim，或一并删除）。然后 `git commit -m "chore(perms): 移除残留 require_role"`。

---

## Phase 3 — 前端统一到 `can()`

### Task 21: `can()` + 旧 helper 薄封装

**Files:**
- Modify: `frontend/src/stores/auth.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: 改 `auth.ts`**（用生成的 `PERMISSIONS`/`Permission`；保留旧 helper 为薄封装）

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { PERMISSIONS, type Permission, type Role } from '../constants/permissions.generated';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User | null, token: string | null) => void;
  logout: () => void;
  hasRole: (roles: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setUser: (user, token) => set({ user, token, isAuthenticated: !!user }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      hasRole: (roles) => {
        const { user } = get();
        return !!user && roles.includes(user.role);
      },
    }),
    { name: 'auth-storage' }
  )
);

// 单一权限判定：角色 × 生成的权限矩阵
export const can = (perm: Permission): boolean => {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return (PERMISSIONS[perm] as Role[]).includes(user.role as Role);
};

// 旧 helper 改为 can() 薄封装（保持向后兼容，新代码请直接用 can('...')）
export const canEdit = () => can('parts:create');        // 等价 admin+engineer
export const canDownload = () => can('parts:export');    // 等价 admin+engineer+production
export const canPreview = () => true;
export const isAdmin = () => can('parts:delete');        // 等价 admin
```

- [ ] **Step 2: package.json 加生成钩子**

```jsonc
{
  "scripts": {
    "gen:perms": "python ../tools/gen_permissions.py",
    "prebuild": "python ../tools/gen_permissions.py",
    "build": "tsc -b && vite build"
  }
}
```

> 以现有 `build` 脚本为准合并，仅追加 `gen:perms` 与 `prebuild`。`prebuild` 在 `npm run build` 前自动重生成，保证产物最新。

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd frontend; npm run build`
Expected: 编译通过（旧 helper 语义不变，无破坏）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/auth.ts frontend/package.json
git commit -m "feat(perms): 前端 can() 统一权限判定 + 旧 helper 薄封装"
```

---

### Task 22: 增量改造前端调用点到 `can('...')`

**Files:**
- Modify: 22 个使用权限判断的前端文件（见 spec 背景）

- [ ] **Step 1:** 对每个被触达的页面/组件，把语义更精确的判断改用 `can('<perm>')`（如库存仓库编辑按钮 `canEdit()` → `can('inventory.warehouse:write')`，零件删除 `isAdmin()` → `can('parts:delete')`），消除 D4 类「按钮显示与后端不一致」的表达歧义。未触达的可保留薄封装，分批迁移。
- [ ] **Step 2:** `cd frontend; npm run build` 通过。
- [ ] **Step 3:** Commit：`refactor(perms): 前端关键按钮改用 can()`

---

## Phase 4 — 安全加固

### Task 23: JWT 过期统一 + `/auth/refresh`

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `frontend/src/services/api.ts`
- Test: `backend/tests/test_auth_refresh.py`

- [ ] **Step 1: 写失败测试**

```python
def test_login_token_expiry_8h(client):
    from jose import jwt
    from app.routers.auth import SECRET_KEY, ALGORITHM
    r = client.post("/api/auth/token", data={"username":"admin","password":"123456"},
                    headers={"Content-Type":"application/x-www-form-urlencoded"})
    assert r.status_code == 200
    payload = jwt.decode(r.json()["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert payload.get("typ") in (None, "access")


def test_refresh_returns_new_access(client):
    login = client.post("/api/auth/token", data={"username":"admin","password":"123456"},
                        headers={"Content-Type":"application/x-www-form-urlencoded"}).json()
    r = client.post("/api/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert r.status_code == 200 and "access_token" in r.json()
```

- [ ] **Step 2: 运行——应失败**（`/refresh` 不存在、无 `refresh_token` 字段）

Run: `cd backend && python -m pytest tests/test_auth_refresh.py -v` → Expected: FAIL

- [ ] **Step 3: 改 `auth.py`**

```python
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))   # 8h，单一来源
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

def create_access_token(data, expires_delta=None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "typ": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(username):
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": username, "exp": expire, "typ": "refresh"}, SECRET_KEY, algorithm=ALGORITHM)
```

login 改为同时返回 access + refresh（access 用统一过期，删除写死的 `timedelta(minutes=60)`）：

```python
@router.post("/token", response_model=schemas.Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误", headers={"WWW-Authenticate": "Bearer"})
    return {
        "access_token": create_access_token({"sub": user.username, "role": user.role}),
        "refresh_token": create_refresh_token(user.username),
        "token_type": "bearer",
    }

@router.post("/refresh", response_model=schemas.Token)
async def refresh(req: schemas.RefreshRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(req.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "refresh":
            raise HTTPException(status_code=401, detail="无效的刷新令牌")
        username = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="刷新令牌验证失败")
    user = crud.get_user_by_username(db, username=username)
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="用户不可用")
    return {
        "access_token": create_access_token({"sub": user.username, "role": user.role}),
        "refresh_token": create_refresh_token(user.username),
        "token_type": "bearer",
    }
```

在 `schemas.py` 加：`class RefreshRequest(BaseSchema): refresh_token: str`，并给 `Token` 增加可选 `refresh_token: Optional[str] = None`。

- [ ] **Step 4: 前端拦截器 401 自动刷新**（`frontend/src/services/api.ts` 替换响应拦截器）

```typescript
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const rt = localStorage.getItem('refresh_token');
  if (!rt) return null;
  try {
    const resp = await axios.post('/api/auth/refresh', { refresh_token: rt });
    const { access_token, refresh_token } = resp.data;
    useAuthStore.getState().setUser(useAuthStore.getState().user, access_token);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    return access_token;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original: any = error.config;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      refreshing = refreshing || doRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

> 登录流程（`authApi.login` 调用处）须把返回的 `refresh_token` 存入 `localStorage`；登出时清除。改动登录页/`setUser` 调用点。

- [ ] **Step 5: 运行 + 构建**

Run: `cd backend && python -m pytest tests/test_auth_refresh.py -v`（PASS）；`cd frontend; npm run build`（通过）

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/auth.py backend/app/schemas.py backend/tests/test_auth_refresh.py frontend/src/services/api.ts
git commit -m "feat(auth): JWT 过期统一(8h) + 刷新令牌 + 前端自动续期"
```

---

### Task 24: 收紧 `?token=` — 媒体令牌

**Files:**
- Create: `backend/app/media_token.py`
- Modify: `backend/app/routers/attachments_v2.py`
- Modify: 前端 URL 构造处（`EntityDocumentSection.tsx`/`DocumentDetailContent.tsx`/`ECR/ECRDetailModal.tsx`/`ECO/ECODetailModal.tsx`/`STPViewer/index.tsx`/`pages/STPViewer.tsx`/`ArchiveTreeModal.tsx`/`services/api.ts`/`services/assistantApi.ts`）
- Test: `backend/tests/test_media_token.py`

- [ ] **Step 1: 写失败测试**

```python
import time, pytest
from app.media_token import mint_media_token, verify_media_token
from fastapi import HTTPException

def test_media_token_roundtrip():
    t = mint_media_token("att-1", "preview", ttl=300)
    assert verify_media_token(t, "att-1", "preview") is True

def test_media_token_wrong_action():
    t = mint_media_token("att-1", "preview", ttl=300)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-1", "gltf")

def test_media_token_wrong_attachment():
    t = mint_media_token("att-1", "preview", ttl=300)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-2", "preview")
```

- [ ] **Step 2: 运行——应失败**

Run: `cd backend && python -m pytest tests/test_media_token.py -v` → Expected: FAIL

- [ ] **Step 3: 实现 `media_token.py`**（独立短寿命签名令牌，作用域绑定 attachment+action）

```python
from datetime import datetime, timedelta
from fastapi import HTTPException
from jose import JWTError, jwt

from .routers.auth import SECRET_KEY, ALGORITHM


def mint_media_token(attachment_id: str, action: str, ttl: int = 300) -> str:
    expire = datetime.utcnow() + timedelta(seconds=ttl)
    return jwt.encode(
        {"aid": str(attachment_id), "act": action, "typ": "media", "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def verify_media_token(token: str, attachment_id: str, action: str) -> bool:
    if not token:
        raise HTTPException(status_code=401, detail="缺少媒体令牌")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="媒体令牌验证失败")
    if payload.get("typ") != "media" or payload.get("aid") != str(attachment_id) or payload.get("act") != action:
        raise HTTPException(status_code=403, detail="媒体令牌作用域不匹配")
    return True
```

- [ ] **Step 4: 签发端点 + 5 端点改校验**（`attachments_v2.py`）

新增受角色门保护的签发端点（角色校验在此处真正发生，修复 gltf/archive 排除 guest 的缺失）：

```python
from ..media_token import mint_media_token, verify_media_token
from ..permissions import require_permission

_ACTION_PERM = {
    "preview": "attachments:preview",
    "direct-download": "attachments:direct_download",
    "gltf": "attachments:gltf",
    "archive-tree": "attachments:archive_browse",
    "extract-file": "attachments:archive_browse",
}

@router.get("/{attachment_id}/media-token")
async def issue_media_token(attachment_id: uuid.UUID, action: str,
                            current_user: User = Depends(get_current_active_user)):
    perm = _ACTION_PERM.get(action)
    if not perm:
        raise HTTPException(status_code=400, detail="未知媒体操作")
    if not has_permission(current_user, perm):       # from ..permissions import has_permission
        raise HTTPException(status_code=403, detail="权限不足")
    return {"token": mint_media_token(str(attachment_id), action, ttl=300)}
```

5 个原端点：把 `payload = jwt.decode(token, ...)` 段替换为 `verify_media_token(token, str(attachment_id), "<action>")`（各端点用自身 action），删除从会话 JWT 取 `sub/role` 的逻辑与误导性 docstring（D2）。

- [ ] **Step 5: 前端改造**——在打开预览/3D/下载前先取媒体令牌再拼 URL。在 `services/api.ts` 加：

```typescript
export const mediaApi = {
  token: (attId: string, action: 'preview'|'direct-download'|'gltf'|'archive-tree'|'extract-file') =>
    api.get(`/v2/attachments/${attId}/media-token`, { params: { action } }).then(r => r.data.token as string),
};
```

各调用点（如 `DocumentDetailContent.tsx:76`）改为：

```typescript
const mt = await mediaApi.token(attId, 'preview');
window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
```

> STP 查看器路由 `/stp-viewer?id=...&token=...` 同理：传入媒体令牌（action `gltf`）。`ArchiveTreeModal` 的 `extract-file`/`archive-tree` 用 action `archive-tree`/`extract-file` 的令牌。逐文件替换 8 处调用点。

- [ ] **Step 6: 运行 + 构建 + 手动验证**

Run: `cd backend && python -m pytest tests/test_media_token.py -v`（PASS）；`cd frontend; npm run build`；手动验证 PDF 预览、STP 3D、压缩包浏览、原生下载在 4 角色下表现符合矩阵（guest 不能 gltf/archive）。

- [ ] **Step 7: Commit**

```bash
git add backend/app/media_token.py backend/app/routers/attachments_v2.py backend/tests/test_media_token.py frontend/src
git commit -m "feat(security): 附件改用短寿命媒体令牌，杜绝会话JWT入URL"
```

---

### Task 25: 角色值校验 + JWT 密钥 fail-fast

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/auth.py`
- Test: `backend/tests/test_role_validation.py`

- [ ] **Step 1: 写失败测试**

```python
import pytest
from pydantic import ValidationError
from app import schemas

def test_user_create_rejects_bad_role():
    with pytest.raises(ValidationError):
        schemas.UserCreate(username="abc", real_name="x", role="superuser", password="123456")

def test_user_create_accepts_valid_role():
    schemas.UserCreate(username="abc", real_name="x", role="engineer", password="123456")
```

- [ ] **Step 2: 运行——应失败**

Run: `cd backend && python -m pytest tests/test_role_validation.py -v` → Expected: FAIL

- [ ] **Step 3: 在 `schemas.py` 加校验器**（用生成的 `ROLES`）

```python
from pydantic import field_validator
from .permissions._generated import ROLES

class UserBase(BaseSchema):
    username: str = Field(..., min_length=3, max_length=64)
    real_name: str = Field(..., min_length=1, max_length=64)
    role: str = Field(...)
    department: Optional[str] = None
    phone: Optional[str] = None
    status: str = "active"

    @field_validator("role")
    @classmethod
    def _check_role(cls, v):
        if v not in ROLES:
            raise ValueError(f"非法角色: {v}")
        return v

# UserUpdate.role 为 Optional，单独校验非 None 值
class UserUpdate(BaseSchema):
    ...
    @field_validator("role")
    @classmethod
    def _check_role_opt(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError(f"非法角色: {v}")
        return v
```

> 注意 `schemas.py` 导入 `.permissions._generated` —— 该模块仅依赖 stdlib，无循环导入风险（`_generated.py` 不 import 任何 app 模块）。

- [ ] **Step 4: JWT 密钥 fail-fast**（`auth.py` 顶部）

```python
SECRET_KEY = os.getenv("JWT_SECRET", "bom-secret-key-change-in-production")
if os.getenv("APP_ENV", "production") == "production" and SECRET_KEY == "bom-secret-key-change-in-production":
    raise RuntimeError("生产环境必须设置 JWT_SECRET 环境变量（当前为弱默认值）")
```

> 开发/测试可设 `APP_ENV=development` 跳过。确认 `docker-compose.yml` 已注入 `JWT_SECRET`；若未注入，本任务补上 `.env` 示例与 compose 环境变量。

- [ ] **Step 5: 运行 + 全量回归**

Run: `cd backend && python -m pytest tests/test_role_validation.py -v && python -m pytest -q`（PASS；测试环境设 `APP_ENV=development` 或提供 JWT_SECRET）

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/auth.py backend/tests/test_role_validation.py
git commit -m "feat(security): 角色值校验 + 生产环境 JWT 密钥 fail-fast"
```

---

## Phase 5 — 文档对齐

### Task 26: 更新权限文档

**Files:**
- Modify: `项目说明/用户权限说明.md`
- Modify: `AGENTS.md`

- [ ] **Step 1:** 在 `用户权限说明.md` 顶部加说明：权限矩阵的**事实源**为 `permissions/permissions.json`，本文档为人类可读镜像；列出 §6 五项不一致的最终裁决（D1–D5）。
- [ ] **Step 2:** 更新 `AGENTS.md` 的「权限模型」章节：`require_role` → `require_permission`，新增 `permissions/` 目录、生成命令 `python tools/gen_permissions.py`、`can()` 用法。
- [ ] **Step 3:** Commit：`docs(perms): 文档对齐生成矩阵与新权限机制`

---

## 收尾验收

- [ ] `cd backend && python -m pytest -q` 全绿（含 sync 守卫、角色门、对象策略、刷新、媒体令牌、角色校验）。
- [ ] `cd frontend; npm run build` 通过（`Permission` 类型把拼错的 perm 卡在编译期）。
- [ ] `grep -rn "require_role" backend/app/routers` 无残留（或仅 auth.py 兼容 shim）。
- [ ] 4 角色手动走查关键路径：写操作 403、附件预览/3D/下载、变更创建者编辑、库存过账保管人、看板共享编辑。
- [ ] 用 superpowers:requesting-code-review 做一次评审，再用 superpowers:finishing-a-development-branch 决定合并方式。

---

## 自检覆盖（spec → task 映射）

- spec §3 三层模型 → Task 4（角色门）+ Task 5（对象策略）
- spec §4 定义文件 → Task 1；§7 代码生成 → Task 2 + 同步守卫 Task 3
- spec §5 完整矩阵 → Task 1（全量种入）
- spec §6 不一致裁决 → D1(`parts:import` Task1)、D2(Task24 删 docstring)、D3(`attachments:list` Task1)、D4(Task22 前端表达)、D5(`nav.settings` Task1)
- spec §8 执行层重构 → Phase 2（后端 209 处）+ Phase 3（前端）
- spec §9.1/9.2/9.3 安全 → Task 23 / 24 / 25
- spec §10 测试 → 各 Task 内 TDD + 收尾验收
- spec §11 增量上线 → Phase 2 逐路由 + 提交顺序
