# AI 对话角色感知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 对话按当前用户角色提供相应的读取操作——`list_api_endpoints` 只返回该角色可访问的接口，系统提示注入角色与能力边界。

**Architecture:** 从 FastAPI 路由的 `require_role` 依赖闭包提取每个 GET 接口的允许角色（已实测可靠），构建缓存的 `{path: roles}` 映射；`list_api_endpoints` 按 `user.role` 过滤目录；`run_agent` 在系统消息追加角色能力行。运行时 `require_role` 403 与下载工具门控为既有兜底。

**Tech Stack:** FastAPI 路由内省 + SQLAlchemy + openai/DeepSeek + pytest。

**关联 spec:** [docs/superpowers/specs/2026-06-10-assistant-role-aware-design.md](../specs/2026-06-10-assistant-role-aware-design.md)

## 已核对的代码事实

- `api_gateway.list_api_endpoints(db, user)` 现为：`return {"endpoints": build_catalog(app.openapi())}`（已有 user 参数，无需改签名）。
- `agent.py`：`SYSTEM_PROMPT` 为模块级常量（已 append overview）；`run_agent` 内 `convo = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)`。
- `require_role` 闭包内省：`route.dependant` 递归 `.dependencies`，找 `__qualname__` 以 `require_role.<locals>.checker` 结尾者，从 `__closure__` 取角色 list。**已在真实 app 实测**：`/api/parts/`→含 guest；`/api/bom/tree/...`→不含 guest，与源码一致。
- conftest 有 `guest_user`（role=guest）、`engineer_user`（role=engineer）fixtures。`FakeLLM` 记录每次 `stream_chat` 的 `messages` 到 `.calls`。
- **测试用 `python -m pytest`**，`backend/` 下运行。PowerShell 用 `;`。commit 追加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。分支 `dev`。

## 文件结构

- 改 `backend/app/assistant/api_gateway.py` — 新增 `roles_for_route`、`endpoint_roles_map`、`filter_catalog_by_role`，`list_api_endpoints` 接入过滤
- 改 `backend/app/assistant/knowledge_glossary.py` — 新增 `ROLE_CAPABILITIES`
- 改 `backend/app/assistant/agent.py` — 系统消息按角色注入能力行
- 测试：`backend/tests/test_api_gateway.py`、`backend/tests/test_agent.py`、补 `test_tools.py`

---

## Phase 1：角色提取与目录过滤

### Task 1.1：roles_for_route + endpoint_roles_map + filter_catalog_by_role

**Files:**
- Modify: `backend/app/assistant/api_gateway.py`
- Test: `backend/tests/test_api_gateway.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_api_gateway.py` 末尾追加：
```python
def test_roles_for_route_reads_per_endpoint_roles():
    from app.main import app
    from fastapi.routing import APIRoute
    by_path = {r.path: gw.roles_for_route(r) for r in app.routes
               if isinstance(r, APIRoute) and "GET" in r.methods}
    assert "guest" in by_path["/api/parts/"]
    assert "guest" not in by_path["/api/bom/tree/{item_type}/{item_id}"]


def test_filter_catalog_by_role():
    catalog = [{"path": "/api/parts/"}, {"path": "/api/bom/tree/x"}, {"path": "/api/foo"}]
    roles_map = {"/api/parts/": {"admin", "engineer", "production", "guest"},
                 "/api/bom/tree/x": {"admin", "engineer", "production"}}
    guest = gw.filter_catalog_by_role(catalog, "guest", roles_map)
    paths = {e["path"] for e in guest}
    assert "/api/parts/" in paths
    assert "/api/bom/tree/x" not in paths   # guest 不在允许集
    assert "/api/foo" in paths               # 无角色门(None)→保留


def test_endpoint_roles_map_has_business_paths():
    m = gw.endpoint_roles_map()
    assert "guest" in m["/api/parts/"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -k "roles_for_route or filter_catalog or endpoint_roles_map" -v`
Expected: FAIL（`AttributeError`）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/api_gateway.py` 末尾追加：
```python
def _walk_dependant(dep):
    yield dep
    for d in dep.dependencies:
        yield from _walk_dependant(d)


def roles_for_route(route):
    """从路由的 require_role 依赖闭包提取允许角色集；无角色门返回 None。"""
    for d in _walk_dependant(route.dependant):
        call = getattr(d, "call", None)
        if call and getattr(call, "__qualname__", "").endswith("require_role.<locals>.checker"):
            for cell in (call.__closure__ or []):
                v = cell.cell_contents
                if isinstance(v, (list, tuple, set)) and v and all(isinstance(x, str) for x in v):
                    return set(v)
    return None


_ROLES_MAP_CACHE = None


def endpoint_roles_map():
    """构建 {GET path: 允许角色集 or None}，模块级缓存（重启刷新）。"""
    global _ROLES_MAP_CACHE
    if _ROLES_MAP_CACHE is None:
        from ..main import app  # 延迟导入避免循环
        from fastapi.routing import APIRoute
        m = {}
        for r in app.routes:
            if isinstance(r, APIRoute) and "GET" in r.methods:
                m[r.path] = roles_for_route(r)
        _ROLES_MAP_CACHE = m
    return _ROLES_MAP_CACHE


def filter_catalog_by_role(catalog, role, roles_map):
    """保留：路径无角色门(None) 或 role 在允许集内 的条目。"""
    out = []
    for e in catalog:
        roles = roles_map.get(e["path"])
        if roles is None or role in roles:
            out.append(e)
    return out
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -v`
Expected: PASS（含新 3 个）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/api_gateway.py backend/tests/test_api_gateway.py
git commit -m "feat(assistant): 从 require_role 提取接口角色并支持目录按角色过滤"
```

---

### Task 1.2：list_api_endpoints 接入按角色过滤

**Files:**
- Modify: `backend/app/assistant/api_gateway.py`
- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_tools.py` 末尾追加：
```python
def test_list_api_endpoints_filtered_by_role(db, guest_user, engineer_user):
    g = {e["path"] for e in
         tools.REGISTRY["list_api_endpoints"]["execute"](db, guest_user)["endpoints"]}
    e = {e["path"] for e in
         tools.REGISTRY["list_api_endpoints"]["execute"](db, engineer_user)["endpoints"]}
    assert g <= e  # guest 目录是 engineer 的子集
    # bom/tree 不含 guest，故仅 engineer 可见
    assert "/api/bom/tree/{item_type}/{item_id}" in e
    assert "/api/bom/tree/{item_type}/{item_id}" not in g
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_tools.py -k filtered_by_role -v`
Expected: FAIL（当前 list_api_endpoints 不分角色，guest 也能看到 bom/tree）。

- [ ] **Step 3: 实现**

修改 `backend/app/assistant/api_gateway.py` 的 `list_api_endpoints`：
```python
def list_api_endpoints(db, user):
    """工具：返回当前用户角色可访问的白名单只读接口目录。"""
    from ..main import app  # 延迟导入避免循环
    catalog = build_catalog(app.openapi())
    role = getattr(user, "role", None) or "guest"
    return {"endpoints": filter_catalog_by_role(catalog, role, endpoint_roles_map())}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_tools.py -k filtered_by_role -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/api_gateway.py backend/tests/test_tools.py
git commit -m "feat(assistant): list_api_endpoints 按用户角色过滤接口目录"
```

---

## Phase 2：系统提示角色注入

### Task 2.1：ROLE_CAPABILITIES + run_agent 系统消息注入

**Files:**
- Modify: `backend/app/assistant/knowledge_glossary.py`
- Modify: `backend/app/assistant/agent.py`
- Test: `backend/tests/test_agent.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_agent.py` 末尾追加：
```python
def test_system_message_includes_role_and_capability(db, guest_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, guest_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "guest" in sys_msg
    assert "不可下载" in sys_msg


def test_system_message_role_for_engineer(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "engineer" in sys_msg
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_agent.py -k "role_and_capability or role_for_engineer" -v`
Expected: FAIL（系统消息当前不含角色）。

- [ ] **Step 3: 实现 ROLE_CAPABILITIES**

在 `backend/app/assistant/knowledge_glossary.py` 末尾追加：
```python
ROLE_CAPABILITIES = {
    "admin": "全部数据与操作",
    "engineer": "查看、编辑（无删除），可下载/导出",
    "production": "查看、下载、导出，不可编辑删除",
    "guest": "仅查看，不可下载/导出",
}
```

- [ ] **Step 4: 实现 agent 系统消息注入**

在 `backend/app/assistant/agent.py`：

1. import 区把 `ROLE_CAPABILITIES` 引入（agent 已 `from . import knowledge`；glossary 是其来源，直接从 glossary 导入）：
```python
from .knowledge_glossary import ROLE_CAPABILITIES
```

2. 把 `run_agent` 内的 convo 组装行：
```python
    convo = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)
```
替换为：
```python
    role = getattr(user, "role", None) or "guest"
    cap = ROLE_CAPABILITIES.get(role, "按你的权限提供只读操作")
    role_line = (f"\n\n当前用户角色：{role}（{cap}）。"
                 "只提供该角色权限范围内的读取操作；遇到无权限的操作，礼貌说明而非尝试。")
    convo = [{"role": "system", "content": SYSTEM_PROMPT + role_line}] + list(messages)
```

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `cd backend; python -m pytest -v`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/knowledge_glossary.py backend/app/assistant/agent.py backend/tests/test_agent.py
git commit -m "feat(assistant): 系统提示按角色注入能力边界"
```

---

## Phase 3：部署与实测

### Task 3.1：部署与多角色浏览器实测

> 无单测，需运行环境与真实模型，由控制者/用户执行。

- [ ] **Step 1: 重启后端**

Run: `docker restart bom_backend`
Expected: `docker logs bom_backend --tail 5` 无 import 错误。
（注：本功能无新依赖，重启即可，无需 `--build`。）

- [ ] **Step 2: 容器内角色过滤自测**

Run:
```
docker exec bom_backend python -c "
from app.assistant import api_gateway as gw
from app.main import app
cat = gw.build_catalog(app.openapi())
m = gw.endpoint_roles_map()
for role in ['admin','engineer','production','guest']:
    n = len(gw.filter_catalog_by_role(cat, role, m))
    print(role, '->', n, 'endpoints')
"
```
Expected: 端点数 guest ≤ production ≤ engineer ≤ admin（guest 明显更少）。

- [ ] **Step 3: 多角色对话实测（需各角色密码）**

用不同角色登录，问「这个系统我能查哪些数据？」：
- admin/engineer → 能列出含 BOM 树等接口，可下载
- guest → 接口目录更少；要求下载时礼貌说明「访客无下载权限」

> 注：实测需各角色账号密码（admin 已知 admin/admin123；其余角色密码由用户提供）。若仅有 admin，可用 Step 2 的容器自测覆盖目录过滤的核心验证。

- [ ] **Step 4: 无需 commit**

---

## 验收清单

- [ ] `cd backend; python -m pytest -v` 全绿（含 roles_for_route / filter_catalog / list_api_endpoints 按角色 / 系统消息含角色）
- [ ] 容器自测显示各角色端点数递减（guest < admin）
- [ ] guest 对话目录更少、要求下载被礼貌拒绝；admin/engineer 正常

## 备注

- 角色映射缓存 `_ROLES_MAP_CACHE` 重启刷新；若后续新增/调整接口角色，重启后端即生效。
- 运行时 `require_role` 403 与下载工具 `DOWNLOAD_ROLES` 门控为既有兜底，未改动。
