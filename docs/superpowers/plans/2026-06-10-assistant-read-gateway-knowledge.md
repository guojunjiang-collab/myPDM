# AI 助手全量只读网关 + 自生数据字典 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI agent 能读取整个 PDM 系统的全部业务数据类型（只读网关），并自带从代码自动派生的接口手册与数据字典（知识/技能层）。

**Architecture:** 两个网关工具 `list_api_endpoints` + `call_read_api`，后者用 `httpx.ASGITransport` 在进程内把带用户 JWT 的 GET 请求转发到真实 FastAPI 路由，复用现有权限与业务逻辑。`knowledge.py` 内省 SQLAlchemy 模型生成字段字典，配人工词汇表，经系统提示「速览」+ `get_data_dictionary` 工具交付。全部 GET-only 只读。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + httpx(ASGITransport, 已固定 0.27.2) + openai/DeepSeek + pytest。

**关联 spec:** [docs/superpowers/specs/2026-06-10-assistant-read-gateway-knowledge-design.md](../specs/2026-06-10-assistant-read-gateway-knowledge-design.md)

## 已核对的代码事实（实现时信任这些）

- 路由前缀（均在 `/api` 下，附件在 `/api/v2`）：`/parts /assemblies /bom /documents /v2/attachments /configurations /custom-fields /ecos /ecrs`（业务，允许）；`/users /logs /admin /sync /auth /assistant /dashboard`（拒绝）。
- 模型类：`app.models` 含 `Part, Assembly, BOMItem, Document, DocumentAttachment, CustomFieldDefinition, CustomFieldValue`；`app.models_ecr.ECR`；`app.models_eco.ECO`；`app.models_configuration.ConfigurationItem, ConfigurationProfile`。
- `app.routers.auth` 导出 `oauth2_scheme`（`OAuth2PasswordBearer`）。
- `run_agent(messages, db, user, emit, llm=None, max_iters=None)` 现有签名（本计划新增 `token` 形参）。
- conftest 已含 `@compiles(JSONB, "sqlite")` shim；fixtures `engineer_user`/`guest_user` 含 `real_name`。
- **测试用 `python -m pytest`**（非裸 `pytest`），在 `backend/` 下运行，本地 Python 3.11 已装依赖。PowerShell 用 `;` 不用 `&&`。
- 每个 commit 追加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。分支 `dev`。

## 文件结构

- 新增 `backend/app/assistant/api_gateway.py` — 白名单判定、目录构建、ASGI 转发、`call_read_api`
- 新增 `backend/app/assistant/knowledge.py` — 模型内省字段字典、`get_data_dictionary`、`build_overview`
- 新增 `backend/app/assistant/knowledge_glossary.py` — 人工词汇表 `GLOSSARY` + 系统提示 `OVERVIEW`
- 改 `backend/app/assistant/tools.py` — 注册 3 个新工具
- 改 `backend/app/assistant/agent.py` — 系统提示注入 overview + 透传 token 到 needs_token 工具
- 改 `backend/app/routers/assistant.py` — 端点取 token 并传入 run_agent
- 改 `.env`、`docker-compose.yml`
- 测试 `backend/tests/test_api_gateway.py`、`test_knowledge.py`、补 `test_agent.py`

---

## Phase 1：白名单 + 接口目录 + list_api_endpoints

### Task 1.1：白名单判定与目录构建

**Files:**
- Create: `backend/app/assistant/api_gateway.py`
- Test: `backend/tests/test_api_gateway.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_api_gateway.py`：
```python
from app.assistant import api_gateway as gw


def test_is_allowed_business_paths():
    assert gw.is_allowed("/api/parts/")
    assert gw.is_allowed("/api/parts/abc-123")
    assert gw.is_allowed("/api/bom/tree/assembly/abc")
    assert gw.is_allowed("/api/ecrs/")
    assert gw.is_allowed("/api/v2/attachments/")


def test_is_allowed_denies_sensitive_and_binary():
    assert not gw.is_allowed("/api/users/")
    assert not gw.is_allowed("/api/logs/")
    assert not gw.is_allowed("/api/admin/soft-deleted-stats")
    assert not gw.is_allowed("/api/sync/status")
    assert not gw.is_allowed("/api/dashboard/")
    assert not gw.is_allowed("/api/bom/export/assembly/abc")
    assert not gw.is_allowed("/api/v2/attachments/abc/download")
    assert not gw.is_allowed("/api/v2/attachments/abc/preview")
    assert not gw.is_allowed("/api/v2/attachments/abc/gltf")


def test_build_catalog_filters_to_allowed_get():
    fake_openapi = {"paths": {
        "/api/parts/": {"get": {"summary": "零件列表", "parameters": [
            {"name": "search", "in": "query"}, {"name": "limit", "in": "query"}]}},
        "/api/parts/{part_id}": {"get": {"summary": "零件详情", "parameters": [
            {"name": "part_id", "in": "path"}]}},
        "/api/users/": {"get": {"summary": "用户列表"}},
        "/api/bom/export/{item_type}/{item_id}": {"get": {"summary": "导出"}},
        "/api/parts/": {"post": {"summary": "创建零件"}},  # post 不计
    }}
    cat = gw.build_catalog(fake_openapi)
    paths = {e["path"] for e in cat}
    assert "/api/parts/{part_id}" in paths
    assert "/api/users/" not in paths
    assert "/api/bom/export/{item_type}/{item_id}" not in paths
    detail = next(e for e in cat if e["path"] == "/api/parts/{part_id}")
    assert detail["method"] == "GET"
    assert detail["path_params"] == ["part_id"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -v`
Expected: FAIL（`ModuleNotFoundError`）。

- [ ] **Step 3: 实现 api_gateway.py（本任务部分）**

`backend/app/assistant/api_gateway.py`：
```python
"""AI 只读网关：白名单判定、接口目录、ASGI 进程内转发。"""
import os
import json
import asyncio

# 业务数据路由前缀（均在 /api 下，附件在 /api/v2）——允许
ALLOWED_PREFIXES = (
    "/api/parts", "/api/assemblies", "/api/bom", "/api/documents",
    "/api/v2/attachments", "/api/configurations", "/api/custom-fields",
    "/api/ecos", "/api/ecrs",
)
# 二进制/文件/导出子路径——拒绝（返回文件，不该进模型上下文）
DENIED_PATTERNS = (
    "/stream", "/download", "/direct-download", "/preview", "/gltf",
    "/extract-file", "/bom/export/",
)


def is_allowed(path: str) -> bool:
    """仅放行业务前缀且不含二进制/导出模式的路径。"""
    if not any(path.startswith(p) for p in ALLOWED_PREFIXES):
        return False
    if any(pat in path for pat in DENIED_PATTERNS):
        return False
    return True


def build_catalog(openapi: dict) -> list:
    """从 OpenAPI 文档构建白名单只读接口目录。"""
    out = []
    for path, methods in openapi.get("paths", {}).items():
        if "get" not in methods:
            continue
        if not is_allowed(path):
            continue
        op = methods["get"]
        params = op.get("parameters", []) or []
        out.append({
            "path": path,
            "method": "GET",
            "summary": op.get("summary") or op.get("description") or "",
            "path_params": [p["name"] for p in params if p.get("in") == "path"],
            "query_params": [p["name"] for p in params if p.get("in") == "query"],
        })
    return out


def list_api_endpoints(db, user):
    """工具：返回白名单只读接口目录。"""
    from ..main import app  # 延迟导入避免循环
    return {"endpoints": build_catalog(app.openapi())}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -v`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/api_gateway.py backend/tests/test_api_gateway.py
git commit -m "feat(assistant): 只读网关白名单与接口目录构建"
```

---

### Task 1.2：注册 list_api_endpoints 工具

**Files:**
- Modify: `backend/app/assistant/tools.py`
- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_tools.py` 末尾追加：
```python
def test_list_api_endpoints_registered_and_returns_endpoints(db, engineer_user):
    out = tools.REGISTRY["list_api_endpoints"]["execute"](db, engineer_user)
    assert "endpoints" in out
    paths = {e["path"] for e in out["endpoints"]}
    # 至少包含零件列表，且不含用户接口
    assert any(p.startswith("/api/parts") for p in paths)
    assert not any(p.startswith("/api/users") for p in paths)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_tools.py -k list_api_endpoints -v`
Expected: FAIL（`KeyError: 'list_api_endpoints'`）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/tools.py` 顶部 import 区追加：
```python
from . import api_gateway
```
在 `REGISTRY` 字典中追加一项：
```python
    "list_api_endpoints": {
        "execute": api_gateway.list_api_endpoints,
        "schema": {"type": "function", "function": {
            "name": "list_api_endpoints",
            "description": "列出 AI 可读的全部只读接口目录（路径/说明/参数）。需要某类数据时先调它发现接口。",
            "parameters": {"type": "object", "properties": {}},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_tools.py -k list_api_endpoints -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): 注册 list_api_endpoints 工具"
```

---

## Phase 2：call_read_api 转发 + token 透传

### Task 2.1：call_read_api（含路径校验、体积截断；转发器可注入）

**Files:**
- Modify: `backend/app/assistant/api_gateway.py`
- Test: `backend/tests/test_api_gateway.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_api_gateway.py` 末尾追加：
```python
def test_call_read_api_rejects_unauthorized_path_without_forwarding():
    called = []
    def fake_forward(path, query, token):
        called.append(path); return 200, "{}"
    out = gw.call_read_api(None, None, path="/api/users/", _forward=fake_forward)
    assert "error" in out
    assert called == []  # 未授权路径不应转发


def test_call_read_api_forwards_with_token_and_parses_json():
    seen = {}
    def fake_forward(path, query, token):
        seen.update(path=path, query=query, token=token)
        return 200, '{"items": [1, 2, 3]}'
    out = gw.call_read_api(None, None, path="/api/parts/", query={"limit": 5},
                           _token="tok-abc", _forward=fake_forward)
    assert seen["token"] == "tok-abc"
    assert seen["query"] == {"limit": 5}
    assert out["status"] == 200
    assert out["data"] == {"items": [1, 2, 3]}


def test_call_read_api_truncates_oversized(monkeypatch):
    monkeypatch.setenv("ASSISTANT_API_MAX_CHARS", "20")
    def fake_forward(path, query, token):
        return 200, "x" * 100
    out = gw.call_read_api(None, None, path="/api/parts/", _forward=fake_forward)
    assert out["_truncated"] is True
    assert "hint" in out
    assert len(out["data_preview"]) == 20


def test_call_read_api_returns_error_on_4xx():
    def fake_forward(path, query, token):
        return 403, '{"detail": "权限不足"}'
    out = gw.call_read_api(None, None, path="/api/ecrs/", _forward=fake_forward)
    assert out["status"] == 403
    assert "error" in out
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -k call_read_api -v`
Expected: FAIL（`AttributeError: call_read_api`）。

- [ ] **Step 3: 实现 call_read_api + 真实转发器**

在 `backend/app/assistant/api_gateway.py` 末尾追加：
```python
async def _forward_async(app, path, query, token):
    import httpx
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    timeout = float(os.getenv("ASSISTANT_API_TIMEOUT", "15"))
    async with httpx.AsyncClient(transport=transport,
                                 base_url="http://pdm.internal") as client:
        resp = await client.get(path, params=query or {}, headers=headers,
                                timeout=timeout)
    return resp.status_code, resp.text


def real_forward(path, query, token):
    """默认转发器：进程内 ASGI 调用真实 app。"""
    from ..main import app  # 延迟导入避免循环
    return asyncio.run(_forward_async(app, path, query, token))


def call_read_api(db, user, path, query=None, _token=None, _forward=None):
    """工具：把 GET 请求转发到白名单内的真实接口。

    _forward 仅供测试注入；生产用 real_forward（带用户 token 的 ASGI 转发）。
    """
    if not is_allowed(path):
        return {"error": "该接口不在 AI 可读范围（仅业务数据只读接口）"}
    forward = _forward or real_forward
    try:
        status, text = forward(path, query, _token)
    except Exception as exc:
        return {"error": f"接口调用失败: {exc}"}
    if status >= 400:
        return {"status": status, "error": text[:500]}
    max_chars = int(os.getenv("ASSISTANT_API_MAX_CHARS", "8000"))
    if len(text) > max_chars:
        return {"status": status, "_truncated": True,
                "data_preview": text[:max_chars],
                "hint": "结果过大，请用 limit/search/skip 等查询参数缩小范围"}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = text
    return {"status": status, "data": data}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_api_gateway.py -v`
Expected: PASS（全部，含新 4 个）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/api_gateway.py backend/tests/test_api_gateway.py
git commit -m "feat(assistant): call_read_api 转发（路径校验/体积截断/可注入转发器）"
```

---

### Task 2.2：注册 call_read_api 工具 + agent/路由 token 透传

**Files:**
- Modify: `backend/app/assistant/tools.py`
- Modify: `backend/app/assistant/agent.py`
- Modify: `backend/app/routers/assistant.py`
- Test: `backend/tests/test_agent.py`（追加）

- [ ] **Step 1: 追加失败测试（验证 token 透传到 needs_token 工具）**

在 `backend/tests/test_agent.py` 末尾追加：
```python
def test_agent_injects_token_into_needs_token_tool(db, engineer_user, make_fake_llm, monkeypatch):
    captured = {}
    def fake_exec(db_, user, _token=None, **kw):
        captured["token"] = _token
        captured["kw"] = kw
        return {"ok": True}
    # 临时往 REGISTRY 注入一个 needs_token 工具
    from app.assistant import tools as tools_mod
    tools_mod.REGISTRY["__probe__"] = {"execute": fake_exec, "needs_token": True,
        "schema": {"type": "function", "function": {"name": "__probe__",
            "parameters": {"type": "object", "properties": {}}}}}
    try:
        tc = {"id": "c1", "type": "function",
              "function": {"name": "__probe__", "arguments": "{}"}}
        llm = make_fake_llm([
            [{"type": "final", "finish_reason": "tool_calls", "tool_calls": [tc]}],
            [{"type": "text", "delta": "ok"},
             {"type": "final", "finish_reason": "stop", "tool_calls": []}],
        ])
        events, emit = _emit_collector()
        agent.run_agent([{"role": "user", "content": "x"}], db, engineer_user, emit,
                        token="tok-xyz", llm=llm, max_iters=5)
        assert captured["token"] == "tok-xyz"
    finally:
        tools_mod.REGISTRY.pop("__probe__", None)
```

> 注：`_emit_collector` 已在 test_agent.py 顶部定义（Phase 1 既有）。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_agent.py -k injects_token -v`
Expected: FAIL（`run_agent` 不接受 `token` 关键字，或未注入 `_token`）。

- [ ] **Step 3: 改 agent.py 支持 token 透传**

在 `backend/app/assistant/agent.py` 中：

1. 改 `run_agent` 签名，新增 `token` 形参：
```python
def run_agent(messages: list, db: Session, user: User, emit: Callable[[dict], None],
              token: Optional[str] = None, llm=None, max_iters: Optional[int] = None) -> None:
```

2. 在工具执行处（`result = spec["execute"](db, user, **args)` 那段）改为按 `needs_token` 注入 `_token`：
```python
            spec = tools_mod.REGISTRY.get(name)
            if not spec:
                result = {"error": f"未知工具 {name}"}
            else:
                kwargs = dict(args)
                if spec.get("needs_token"):
                    kwargs["_token"] = token
                try:
                    result = spec["execute"](db, user, **kwargs)
                except Exception as exc:  # 工具错误回灌模型，不中断
                    result = {"error": str(exc)}
```

- [ ] **Step 4: 注册 call_read_api 工具（needs_token）**

在 `backend/app/assistant/tools.py` 的 `REGISTRY` 追加：
```python
    "call_read_api": {
        "execute": api_gateway.call_read_api,
        "needs_token": True,
        "schema": {"type": "function", "function": {
            "name": "call_read_api",
            "description": ("调用 list_api_endpoints 目录里的某个只读接口取数。"
                            "path 用实际路径（路径参数已填入，如 /api/parts/<id>）；"
                            "query 为查询参数对象（如 {\"search\":\"电机\",\"limit\":20}）。"),
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string", "description": "接口路径，含已填好的路径参数"},
                "query": {"type": "object", "description": "查询参数（可选）"},
            }, "required": ["path"]},
        }},
    },
```

- [ ] **Step 5: 改路由透传 token**

在 `backend/app/routers/assistant.py`：

1. import 区把 `oauth2_scheme` 引入：
```python
from .auth import require_role, get_current_active_user, oauth2_scheme
```

2. `chat` 端点签名增加 token 依赖：
```python
@router.post("/chat")
async def chat(
    req: ChatRequest,
    current_user: User = Depends(require_role(ASSISTANT_ROLES)),
    token: str = Depends(oauth2_scheme),
):
```

3. worker 内把 token 传入 run_agent：
```python
            agent_mod.run_agent(req.messages, db, current_user, q.put, token=token)
```

- [ ] **Step 6: 运行确认通过 + 回归**

Run: `cd backend; python -m pytest tests/test_agent.py tests/test_tools.py -v`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/assistant/tools.py backend/app/assistant/agent.py backend/app/routers/assistant.py backend/tests/test_agent.py
git commit -m "feat(assistant): 注册 call_read_api 并透传用户 token 到网关工具"
```

---

## Phase 3：自生数据字典 + get_data_dictionary

### Task 3.1：knowledge 模型内省与词汇表

**Files:**
- Create: `backend/app/assistant/knowledge_glossary.py`
- Create: `backend/app/assistant/knowledge.py`
- Test: `backend/tests/test_knowledge.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_knowledge.py`：
```python
from app.assistant import knowledge


def test_data_dictionary_covers_core_entities():
    d = knowledge.build_data_dictionary()
    for key in ["part", "assembly", "bom_item", "document", "ecr", "eco",
                "configuration_item"]:
        assert key in d
        assert d[key]["fields"]  # 非空字段列表


def test_part_dictionary_has_code_field():
    d = knowledge.build_data_dictionary()
    names = {f["name"] for f in d["part"]["fields"]}
    assert "code" in names


def test_get_data_dictionary_for_entity():
    out = knowledge.get_data_dictionary(None, None, entity="part")
    assert out["entity"] == "part"
    assert any(f["name"] == "code" for f in out["fields"])


def test_get_data_dictionary_no_arg_lists_entities():
    out = knowledge.get_data_dictionary(None, None)
    assert "part" in out["entities"]
    assert "glossary" in out


def test_get_data_dictionary_unknown_entity():
    out = knowledge.get_data_dictionary(None, None, entity="nope")
    assert "error" in out


def test_overview_mentions_key_concepts():
    ov = knowledge.build_overview()
    assert "构型" in ov and "ECR" in ov
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_knowledge.py -v`
Expected: FAIL（`ModuleNotFoundError`）。

- [ ] **Step 3: 实现 knowledge_glossary.py**

`backend/app/assistant/knowledge_glossary.py`：
```python
"""PDM 领域词汇表与系统提示速览（人工维护，代码表达不出的语义）。"""

GLOSSARY = {
    "part": "零件：最小物料单元。code=编码，name=名称，spec=规格，version=版本，status=状态，软删除用 deleted_at。",
    "assembly": "部件/装配体：可含子项的层级单元。与零件结构相似，另有 revisions 版本数组、document_links 关联文档。",
    "bom_item": ("BOM 关系行：parent_type/parent_id → child_type/child_id，quantity=用量。"
                 "child_type 取值 part/assembly/component（component 兼容 assembly）。deleted_at 软删除。"),
    "document": "图文档：含 revisions 版本、document_links 关联。附件元数据见 attachment。",
    "attachment": "文档附件元数据：文件名、大小、哈希、路径。二进制内容不经 AI（用下载工具取链接）。",
    "configuration_item": ("构型项：面向交付/配置的清单单元，**与 BOM 不同**——BOM 是制造结构，"
                           "构型是配置视角。含 document_links。"),
    "configuration_profile": "构型清单/方案：一组构型项的集合，有 status 状态。",
    "ecr": "变更请求(ECR)：发起变更的申请，含受影响项、评审记录、状态流转。",
    "eco": "变更执行(ECO)：由 ECR 转化的执行单，含执行项、评审、状态日志。ecr_id 关联来源 ECR。",
    "custom_field_definition": "自定义字段定义：name、field_type、options、applies_to（适用实体数组）。",
    "custom_field_value": "自定义字段值：entity_type/entity_id 关联到具体实体，value/value_json。",
}

OVERVIEW = (
    "你管理的 PDM 系统含以下业务数据（字段含义用 get_data_dictionary 查，接口用 list_api_endpoints 查）：\n"
    "- 零件 part、部件 assembly、BOM（bom_item，父子结构带 quantity）\n"
    "- 图文档 document 及附件 attachment（附件二进制不直接读，下载走下载工具）\n"
    "- 构型 configuration（与 BOM 不同，是配置/交付视角的清单）\n"
    "- 自定义字段 custom_field、变更请求 ECR、变更执行 ECO\n"
    "关系：BOM 子项类型为 part/assembly/component（component 兼容 assembly）；软删除用 deleted_at。\n"
    "需要任何数据：先 list_api_endpoints 找接口，再 call_read_api 取数；结果过大用 limit/search 缩小。"
)
```

- [ ] **Step 4: 实现 knowledge.py**

`backend/app/assistant/knowledge.py`：
```python
"""自生数据字典：内省 SQLAlchemy 模型 + 人工词汇表。"""
from sqlalchemy import inspect as sa_inspect

from .. import models, models_ecr, models_eco, models_configuration
from .knowledge_glossary import GLOSSARY, OVERVIEW

ENTITY_MODELS = {
    "part": models.Part,
    "assembly": models.Assembly,
    "bom_item": models.BOMItem,
    "document": models.Document,
    "attachment": models.DocumentAttachment,
    "custom_field_definition": models.CustomFieldDefinition,
    "custom_field_value": models.CustomFieldValue,
    "ecr": models_ecr.ECR,
    "eco": models_eco.ECO,
    "configuration_item": models_configuration.ConfigurationItem,
    "configuration_profile": models_configuration.ConfigurationProfile,
}


def _fields(model):
    return [{"name": c.name, "type": str(c.type), "nullable": bool(c.nullable)}
            for c in sa_inspect(model).columns]


def build_data_dictionary() -> dict:
    return {k: {"fields": _fields(m), "glossary": GLOSSARY.get(k)}
            for k, m in ENTITY_MODELS.items()}


def get_data_dictionary(db, user, entity=None):
    """工具：无参返回实体清单+词汇表概要；带 entity 返回该实体字段字典。"""
    if entity is None:
        return {"entities": list(ENTITY_MODELS.keys()), "glossary": GLOSSARY}
    key = entity.lower()
    if key not in ENTITY_MODELS:
        return {"error": f"未知实体 {entity}", "entities": list(ENTITY_MODELS.keys())}
    return {"entity": key, "fields": _fields(ENTITY_MODELS[key]),
            "glossary": GLOSSARY.get(key)}


def build_overview() -> str:
    return OVERVIEW
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_knowledge.py -v`
Expected: PASS（6 个用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/knowledge.py backend/app/assistant/knowledge_glossary.py backend/tests/test_knowledge.py
git commit -m "feat(assistant): 自生数据字典与 PDM 词汇表"
```

---

### Task 3.2：注册 get_data_dictionary 工具

**Files:**
- Modify: `backend/app/assistant/tools.py`
- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_tools.py` 末尾追加：
```python
def test_get_data_dictionary_tool_registered(db, engineer_user):
    out = tools.REGISTRY["get_data_dictionary"]["execute"](db, engineer_user, entity="part")
    assert out["entity"] == "part"
    assert any(f["name"] == "code" for f in out["fields"])
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_tools.py -k get_data_dictionary -v`
Expected: FAIL（`KeyError`）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/tools.py` 顶部 import 区追加：
```python
from . import knowledge
```
在 `REGISTRY` 追加：
```python
    "get_data_dictionary": {
        "execute": knowledge.get_data_dictionary,
        "schema": {"type": "function", "function": {
            "name": "get_data_dictionary",
            "description": ("查询 PDM 数据字典：不带参返回所有实体清单与词汇表；"
                            "带 entity（如 part/assembly/bom_item/document/ecr/eco/configuration_item）"
                            "返回该实体的字段含义。"),
            "parameters": {"type": "object", "properties": {
                "entity": {"type": "string", "description": "实体名（可选）"},
            }},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_tools.py -k get_data_dictionary -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): 注册 get_data_dictionary 工具"
```

---

## Phase 4：系统提示注入速览

### Task 4.1：agent SYSTEM_PROMPT 注入 overview

**Files:**
- Modify: `backend/app/assistant/agent.py`
- Test: `backend/tests/test_agent.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_agent.py` 末尾追加：
```python
def test_system_prompt_includes_pdm_overview():
    from app.assistant import agent as agent_mod
    assert "构型" in agent_mod.SYSTEM_PROMPT
    assert "list_api_endpoints" in agent_mod.SYSTEM_PROMPT
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_agent.py -k overview -v`
Expected: FAIL（当前 SYSTEM_PROMPT 不含这些）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/agent.py`：

1. import 区追加：
```python
from . import knowledge
```

2. 在 `SYSTEM_PROMPT = (...)` 定义之后追加拼接（紧接其后）：
```python
SYSTEM_PROMPT = SYSTEM_PROMPT + "\n\n" + knowledge.build_overview()
```

> 注：保持原有 SYSTEM_PROMPT 文本不变，仅在其后追加 overview。这样既有的 prompt 行为不变，新增 PDM 速览。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd backend; python -m pytest -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/agent.py backend/tests/test_agent.py
git commit -m "feat(assistant): 系统提示注入 PDM 速览"
```

---

## Phase 5：配置与部署

### Task 5.1：.env 与 docker-compose 配置项

**Files:**
- Modify: `.env`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 追加 .env 配置**

在根 `.env` 的「AI 助手配置」段追加两行：
```
ASSISTANT_API_MAX_CHARS=8000
ASSISTANT_API_TIMEOUT=15
```

- [ ] **Step 2: docker-compose 透传**

在 `docker-compose.yml` 的 `backend` 服务 `environment:` 段（已有 ASSISTANT_* 那块）追加：
```yaml
      - ASSISTANT_API_MAX_CHARS=${ASSISTANT_API_MAX_CHARS:-8000}
      - ASSISTANT_API_TIMEOUT=${ASSISTANT_API_TIMEOUT:-15}
```

- [ ] **Step 3: Commit**

```bash
git add .env docker-compose.yml
git commit -m "chore(assistant): 网关体积/超时配置项透传"
```

> 注：`.env` 已在 `.gitignore` 中（上一轮安全处理），`git add .env` 不会生效——改为只提交 docker-compose.yml，并在 PR/交接说明里提醒手动在 `.env` 补这两行。实现者执行本步时若 `git add .env` 无输出属正常，仅提交 docker-compose.yml 即可。

---

### Task 5.2：部署与浏览器实测（需有效 DEEPSEEK_API_KEY）

> 本任务无单测，依赖真实模型与运行环境，由控制者/用户执行。

- [ ] **Step 1: 重建后端镜像并重启**

Run: `docker-compose up -d --build backend`
Expected: `bom_backend` Started，`docker logs bom_backend --tail 5` 无 import 错误。

- [ ] **Step 2: 容器内连通性自测（不需登录）**

Run:
```
docker exec bom_backend python -c "from app.assistant import api_gateway, knowledge; print(len(api_gateway.build_catalog(__import__('app.main', fromlist=['app']).app.openapi())), 'endpoints'); print(list(knowledge.ENTITY_MODELS))"
```
Expected: 打印接口数（>0）与实体清单。

- [ ] **Step 3: 真实对话验证（HTTP，admin/admin123）**

登录取 token 后，向 `/api/assistant/chat` 发问，覆盖三类：
- 「这个系统里都能查哪些数据？」→ 应触发 list_api_endpoints / get_data_dictionary，给出业务数据概览
- 「构型和 BOM 有什么区别？」→ 应用 get_data_dictionary 词汇表作答
- 「查一下变更请求(ECR)有哪些」→ 应通过 call_read_api 调 /api/ecrs/ 取数

验证要点：能取到业务数据；问「列出所有用户」时网关拒绝（/api/users 不在白名单），模型礼貌说明无权限。

- [ ] **Step 4: 无需 commit**（部署/验证步骤）

---

## 验收清单

- [ ] `cd backend; python -m pytest -v` 全绿（含 test_api_gateway / test_knowledge / 新增 agent、tools 用例）
- [ ] 后端重建后启动无错，容器内自测打印接口数与实体清单
- [ ] AI 能用 list_api_endpoints + call_read_api 读取业务数据（parts/ecrs/configurations 等）
- [ ] AI 能用 get_data_dictionary 解释字段与「构型 vs BOM」
- [ ] users/logs/admin/sync/dashboard 与二进制接口被网关拒绝
- [ ] 超大结果被截断并提示缩小范围

## 备注（二期）

- B「多步技能/配方」：把高频工作流编码为命名过程。
- C「跨会话学习记忆」：持久化学到的字段语义/常用编码/用户习惯（需校验防跑偏）。
- 词汇表后续按业务补充；可加 configuration 的 profile/working item 等细分实体。
