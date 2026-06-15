# PDM AI 助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 myPDM 上构建一个后端编排的悬浮聊天式 AI 助手：工具取数、大模型分析/撰写、SSE 流式富卡片呈现，v1 覆盖查询 / BOM 对比 / 下载导出 / 文档生成（Markdown）。

**Architecture:** 前端悬浮聊天窗通过 `fetch` POST 流式读取 `/api/assistant/chat`（SSE 风格 `data:` 行）。后端 Agent 编排循环把用户消息 + 工具清单发给云端大模型（DeepSeek，OpenAI 兼容），模型决定调取数工具或直接分析/撰写；工具执行强制注入当前用户身份并复用现有 `require_role`/crud；文档由后端 `document_builder` 生成成品产物落地 `uploads/assistant_artifacts/`，前端只展示与下载。

**Tech Stack:** 后端 FastAPI + SQLAlchemy 2.0 + `openai` SDK（调 DeepSeek）+ pytest（新增，TDD）；前端 React 18 + TypeScript + Zustand + Tailwind（沿用现有 build + 浏览器手动验证）。

**关键设计文档:**]

"..\specs\2026-06-10-assistant-ui-polish-design.md"

"..\specs\2026-06-10-assistant-read-gateway-knowledge-design.md"

"..\specs\2026-06-10-pdm-ai-assistant-design.md"

"..\specs\2026-06-10-assistant-role-aware-design.md"

**新增依赖（已征得用户同意）:** 后端 `openai`、`pytest`；前端无新增。

---

## 模块与文件结构

### 后端（`backend/`）

```
app/assistant/
├── __init__.py
├── llm_client.py        # DeepSeek(OpenAI 兼容) 流式封装，yield 文本增量 + 累积 tool_calls
├── tools.py             # 工具注册表 REGISTRY：name → {schema, execute}
├── agent.py             # run_agent() 编排循环，通过 emit 回调推事件
├── document_builder.py  # Markdown 文档组装 + 落地 artifacts
└── sanitizer.py         # 出境前字段白名单/脱敏
app/routers/assistant.py # POST /api/assistant/chat (SSE) + GET artifacts 下载
tests/
├── conftest.py          # pytest fixtures：内存 SQLite + 测试用户 + 假 LLM
├── test_tools.py
├── test_agent.py
├── test_document_builder.py
├── test_sanitizer.py
└── test_assistant_api.py
pytest.ini
```

### 前端（`frontend/src/`）

```
stores/assistant.ts                     # Zustand：会话历史、面板开关、流式状态
services/assistantApi.ts                # fetch 流式连接 + 解析 data: 行 + 产物下载 URL
hooks/useAssistantChat.ts               # 发送消息、消费事件流、更新 store
types/assistant.ts                      # 消息/事件/卡片类型定义
components/assistant/
├── FloatingAssistant.tsx               # 悬浮按钮 + 可展开面板（挂在 Layout）
├── MessageList.tsx                     # 消息流渲染
├── ChatInput.tsx                       # 输入框
└── cards/
    ├── TextCard.tsx
    ├── TableCard.tsx
    ├── MarkdownCard.tsx
    ├── DownloadCard.tsx
    └── LinkCard.tsx
```

### 事件协议（后端 `emit` → 前端解析）

每个事件是一行 `data: {json}\n\n`，JSON 含 `type` 字段：

| type         | 字段                           | 用途                                    |
| ------------ | ---------------------------- | ------------------------------------- |
| `token`      | `{type, delta}`              | 文本增量（打字机）                             |
| `tool_start` | `{type, name, summary}`      | "正在查询 BOM 树…"                         |
| `tool_end`   | `{type, name, ok}`           | 工具完成                                  |
| `card`       | `{type, card_type, payload}` | 富卡片（table/markdown_doc/download/link） |
| `done`       | `{type}`                     | 本轮结束                                  |
| `error`      | `{type, message}`            | 友好错误                                  |

---

## Phase 0：后端脚手架与测试基建

### Task 0.1：新增依赖与 pytest 配置

**Files:**

- Modify: `backend/requirements.txt`

- Create: `backend/pytest.ini`

- Create: `backend/tests/__init__.py`（空文件）

- [ ] **Step 1: 追加依赖到 requirements.txt**

在 `backend/requirements.txt` 末尾追加两行：

```
openai==1.55.0
pytest==8.3.4
```

- [ ] **Step 2: 创建 pytest.ini**

`backend/pytest.ini`：

```ini
[pytest]
pythonpath = .
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 3: 创建空包文件**

`backend/tests/__init__.py`：空文件（内容为空）。

- [ ] **Step 4: 安装依赖并验证 pytest 可用**

Run（在 `backend/` 下，建议本地 venv 或容器内）：

```
pip install -r requirements.txt
pytest --version
```

Expected: 打印 `pytest 8.3.4`。

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/pytest.ini backend/tests/__init__.py
git commit -m "chore(assistant): 引入 openai 与 pytest 依赖及配置"
```

---

### Task 0.2：pytest fixtures（内存数据库 + 测试用户 + 假 LLM）

**Files:**

- Create: `backend/tests/conftest.py`

- [ ] **Step 1: 写 conftest.py**

> **已实测前提（务必保留）**：模型用 PostgreSQL 的 `JSONB`/`UUID` 列。内存 SQLite 下，`UUID` 在 SQLAlchemy 2.0 原生可用，但 `JSONB` 必须经 `@compiles` 映射为 `JSON`，否则 `create_all` 失败。下面的 conftest 已包含该 shim，**不要删除**。已验证 `create_all`、UUID 主键、`child_id.in_([uuid])` 过滤均可正常工作。

`backend/tests/conftest.py`：

```python
"""pytest 公共 fixtures：内存数据库、测试用户、假 LLM 客户端。"""
import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

from app.database import Base
from app import models


# SQLite 下把 PG 的 JSONB 渲染成 JSON，使 create_all 可用（已实测必需）
@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):
    return "JSON"


@pytest.fixture
def db():
    """每个测试一个独立的内存 SQLite 会话。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def engineer_user(db):
    user = models.User(
        id=uuid.uuid4(), username="eng", password_hash="x",
        role="engineer", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def guest_user(db):
    user = models.User(
        id=uuid.uuid4(), username="guest1", password_hash="x",
        role="guest", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


class FakeLLM:
    """脚本化的假 LLM：按预设序列产出 stream_chat 事件。

    scripts: List[List[dict]]，每次调用 stream_chat 弹出一组事件。
    """
    def __init__(self, scripts):
        self._scripts = list(scripts)
        self.calls = []

    def stream_chat(self, messages, tools):
        self.calls.append({"messages": list(messages), "tools": tools})
        events = self._scripts.pop(0)
        for ev in events:
            yield ev


@pytest.fixture
def make_fake_llm():
    return lambda scripts: FakeLLM(scripts)
```

> 注：若 `app.models.User` 字段与上面不符（如缺 `status`），以实际 `app/models.py` 为准调整 fixture 字段，但保留 `role`/`status`。

- [ ] **Step 2: 跑一个占位收集，确认 fixtures 导入无误**

Run: `cd backend && pytest --collect-only -q`
Expected: 无导入错误（collected 0 items 也算通过本步）。

- [ ] **Step 3: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(assistant): 添加 pytest fixtures（内存库/用户/假LLM）"
```

---

## Phase 1：核心取数工具 + Agent 循环 + SSE 端点（端到端跑通）

### Task 1.1：工具注册表与首批只读取数工具

**Files:**

- Create: `backend/app/assistant/__init__.py`（空文件）

- Create: `backend/app/assistant/tools.py`

- Test: `backend/tests/test_tools.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_tools.py`：

```python
import uuid
from app.assistant import tools
from app import models


def _make_part(db, code, name):
    p = models.Part(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_search_entity_matches_part_by_code(db, engineer_user):
    _make_part(db, "P-100", "螺钉")
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="P-100")
    assert any(r["code"] == "P-100" and r["type"] == "part" for r in out["results"])


def test_search_entity_empty_keyword_returns_empty(db, engineer_user):
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="")
    assert out["results"] == []


def test_registry_specs_have_required_openai_shape():
    for name, spec in tools.REGISTRY.items():
        s = spec["schema"]
        assert s["type"] == "function"
        assert s["function"]["name"] == name
        assert "parameters" in s["function"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_tools.py -v`
Expected: FAIL（`ModuleNotFoundError: app.assistant.tools` 或 `KeyError`）。

- [ ] **Step 3: 创建空包文件**

`backend/app/assistant/__init__.py`：空文件。

- [ ] **Step 4: 实现 tools.py（首批工具）**

`backend/app/assistant/tools.py`：

```python
"""AI 助手工具注册表。

每个工具：{"schema": <OpenAI function schema>, "execute": fn(db, user, **args) -> dict}
execute 必须把当前 user 作为权限边界；返回值是给大模型回灌的 JSON 可序列化 dict。
若工具产出富卡片，在返回 dict 中放 "_card": {"card_type":..., "payload":...}，
由 agent 层取出并 emit，不回灌给模型（避免重复占 token）。
"""
import uuid
from typing import Optional
from sqlalchemy.orm import Session

from .. import crud
from ..models import User

DOWNLOAD_ROLES = {"admin", "engineer", "production"}


def _entity_brief(obj, etype):
    return {
        "id": str(obj.id), "code": obj.code, "name": obj.name,
        "spec": getattr(obj, "spec", None), "type": etype,
    }


def search_entity(db: Session, user: User, keyword: str, type: Optional[str] = None):
    keyword = (keyword or "").strip()
    if not keyword:
        return {"results": []}
    results = []
    if type in (None, "part"):
        for p in crud.get_parts(db, search=keyword, limit=10):
            results.append(_entity_brief(p, "part"))
    if type in (None, "assembly"):
        for a in crud.get_assemblies(db, search=keyword, limit=10):
            results.append(_entity_brief(a, "assembly"))
    return {"results": results}


def get_part_detail(db: Session, user: User, part_id: str):
    p = crud.get_part(db, uuid.UUID(part_id))
    if not p:
        return {"error": "零件不存在"}
    return {"detail": _entity_brief(p, "part")}


def get_assembly_detail(db: Session, user: User, assembly_id: str):
    a = crud.get_assembly(db, uuid.UUID(assembly_id))
    if not a:
        return {"error": "部件不存在"}
    return {"detail": _entity_brief(a, "assembly")}


def get_bom_tree(db: Session, user: User, type: str, id: str):
    if type not in ("part", "assembly"):
        return {"error": "无效的类型，仅支持 part 或 assembly"}
    items = crud.get_bom_items(db, type, uuid.UUID(id))
    rows = []
    for it in items:
        if it.child_type == "part":
            child = crud.get_part(db, it.child_id)
        else:
            child = crud.get_assembly(db, it.child_id)
        rows.append({
            "child_type": it.child_type,
            "child_code": getattr(child, "code", None),
            "child_name": getattr(child, "name", None),
            "quantity": int(it.quantity),
        })
    card = {"card_type": "table", "payload": {"title": "BOM 树", "columns":
            ["child_type", "child_code", "child_name", "quantity"], "rows": rows}}
    return {"items": rows, "_card": card}


REGISTRY = {
    "search_entity": {
        "execute": search_entity,
        "schema": {"type": "function", "function": {
            "name": "search_entity",
            "description": "按关键词搜索零件或部件，把名称/编码解析为真实 ID。",
            "parameters": {"type": "object", "properties": {
                "keyword": {"type": "string", "description": "搜索关键词（编码或名称）"},
                "type": {"type": "string", "enum": ["part", "assembly"], "description": "可选，限定类型"},
            }, "required": ["keyword"]},
        }},
    },
    "get_part_detail": {
        "execute": get_part_detail,
        "schema": {"type": "function", "function": {
            "name": "get_part_detail",
            "description": "获取单个零件详情。",
            "parameters": {"type": "object", "properties": {
                "part_id": {"type": "string"},
            }, "required": ["part_id"]},
        }},
    },
    "get_assembly_detail": {
        "execute": get_assembly_detail,
        "schema": {"type": "function", "function": {
            "name": "get_assembly_detail",
            "description": "获取单个部件详情。",
            "parameters": {"type": "object", "properties": {
                "assembly_id": {"type": "string"},
            }, "required": ["assembly_id"]},
        }},
    },
    "get_bom_tree": {
        "execute": get_bom_tree,
        "schema": {"type": "function", "function": {
            "name": "get_bom_tree",
            "description": "获取零件或部件的 BOM 树（直接子项），返回原始数据供分析。",
            "parameters": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["part", "assembly"]},
                "id": {"type": "string"},
            }, "required": ["type", "id"]},
        }},
    },
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && pytest tests/test_tools.py -v`
Expected: PASS（3 个用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/__init__.py backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): 工具注册表与首批只读取数工具"
```

---

### Task 1.2：LLM 客户端封装（DeepSeek 流式）

**Files:**

- Create: `backend/app/assistant/llm_client.py`

- Test: `backend/tests/test_llm_client.py`

- [ ] **Step 1: 写失败测试（只测累积逻辑，不真连网）**

`backend/tests/test_llm_client.py`：

```python
from app.assistant.llm_client import accumulate_tool_calls


def test_accumulate_tool_calls_merges_fragments():
    # 模拟 OpenAI 流式 tool_call 分片
    frags = [
        [{"index": 0, "id": "c1", "function": {"name": "search_entity", "arguments": '{"key'}}],
        [{"index": 0, "function": {"arguments": 'word":"P-1"}'}}],
    ]
    acc = {}
    for fr in frags:
        accumulate_tool_calls(acc, fr)
    calls = list(acc.values())
    assert calls[0]["id"] == "c1"
    assert calls[0]["function"]["name"] == "search_entity"
    assert calls[0]["function"]["arguments"] == '{"keyword":"P-1"}'
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_llm_client.py -v`
Expected: FAIL（`ImportError`）。

- [ ] **Step 3: 实现 llm_client.py**

`backend/app/assistant/llm_client.py`：

```python
"""DeepSeek（OpenAI 兼容）流式客户端封装。

stream_chat 产出统一事件：
  {"type": "text", "delta": str}
  {"type": "final", "finish_reason": str, "tool_calls": list}
便于 agent 消费与测试 mock。
"""
import os
from typing import Iterator, Optional


def accumulate_tool_calls(acc: dict, fragments: list) -> None:
    """把流式 tool_call 分片按 index 累积进 acc。"""
    for f in fragments:
        idx = f["index"]
        slot = acc.setdefault(idx, {"id": None, "type": "function",
                                    "function": {"name": "", "arguments": ""}})
        if f.get("id"):
            slot["id"] = f["id"]
        fn = f.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] += fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] += fn["arguments"]


class LLMClient:
    def __init__(self, client=None, model: Optional[str] = None):
        self._model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        if client is not None:
            self._client = client
        else:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=os.getenv("DEEPSEEK_API_KEY", ""),
                base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            )

    def stream_chat(self, messages: list, tools: list) -> Iterator[dict]:
        stream = self._client.chat.completions.create(
            model=self._model, messages=messages, tools=tools or None,
            stream=True,
        )
        acc: dict = {}
        finish = None
        for chunk in stream:
            choice = chunk.choices[0]
            delta = choice.delta
            if getattr(delta, "content", None):
                yield {"type": "text", "delta": delta.content}
            if getattr(delta, "tool_calls", None):
                frags = [{
                    "index": tc.index, "id": tc.id,
                    "function": {"name": tc.function.name if tc.function else None,
                                 "arguments": tc.function.arguments if tc.function else None},
                } for tc in delta.tool_calls]
                accumulate_tool_calls(acc, frags)
            if choice.finish_reason:
                finish = choice.finish_reason
        yield {"type": "final", "finish_reason": finish,
               "tool_calls": [acc[k] for k in sorted(acc)]}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_llm_client.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat(assistant): DeepSeek 流式客户端封装与 tool_call 累积"
```

---

### Task 1.3：Agent 编排循环

**Files:**

- Create: `backend/app/assistant/agent.py`

- Test: `backend/tests/test_agent.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_agent.py`：

```python
import json
import uuid
from app.assistant import agent
from app import models


def _emit_collector():
    events = []
    return events, lambda ev: events.append(ev)


def _make_part(db, code, name):
    p = models.Part(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_agent_plain_answer_emits_token_and_done(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[
        {"type": "text", "delta": "你好"},
        {"type": "final", "finish_reason": "stop", "tool_calls": []},
    ]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit,
                    llm=llm, max_iters=5)
    types = [e["type"] for e in events]
    assert "token" in types and types[-1] == "done"


def test_agent_runs_tool_then_answers(db, engineer_user, make_fake_llm):
    _make_part(db, "P-100", "螺钉")
    tool_call = {"id": "c1", "type": "function",
                 "function": {"name": "search_entity",
                              "arguments": json.dumps({"keyword": "P-100"})}}
    llm = make_fake_llm([
        [{"type": "final", "finish_reason": "tool_calls", "tool_calls": [tool_call]}],
        [{"type": "text", "delta": "找到了 P-100"},
         {"type": "final", "finish_reason": "stop", "tool_calls": []}],
    ])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "搜 P-100"}], db, engineer_user, emit,
                    llm=llm, max_iters=5)
    types = [e["type"] for e in events]
    assert "tool_start" in types and "tool_end" in types
    # search_entity 不产卡片；get_bom_tree 才产。此处确保循环结束
    assert types[-1] == "done"


def test_agent_stops_at_max_iters(db, engineer_user, make_fake_llm):
    tool_call = {"id": "c1", "type": "function",
                 "function": {"name": "search_entity",
                              "arguments": json.dumps({"keyword": "x"})}}
    # 永远返回 tool_calls，触发上限
    llm = make_fake_llm([[{"type": "final", "finish_reason": "tool_calls",
                           "tool_calls": [tool_call]}]] * 10)
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "loop"}], db, engineer_user, emit,
                    llm=llm, max_iters=3)
    assert events[-1]["type"] == "error"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_agent.py -v`
Expected: FAIL（`ImportError`）。

- [ ] **Step 3: 实现 agent.py**

`backend/app/assistant/agent.py`：

```python
"""AI 助手 Agent 编排循环。"""
import json
import os
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..models import User
from . import tools as tools_mod
from .sanitizer import sanitize_for_llm

SYSTEM_PROMPT = (
    "你是 PDM/BOM 系统的智能助手。可调用工具获取零件、部件、BOM 数据，"
    "然后用中文为用户做分析、对比、撰写文档。无法用工具获取的信息不要编造。"
    "涉及下载时，把工具返回的下载链接如实告知用户。"
)


def run_agent(messages: list, db: Session, user: User, emit: Callable[[dict], None],
              llm=None, max_iters: Optional[int] = None) -> None:
    if llm is None:
        from .llm_client import LLMClient
        llm = LLMClient()
    if max_iters is None:
        max_iters = int(os.getenv("ASSISTANT_MAX_ITERS", "8"))

    tool_specs = [t["schema"] for t in tools_mod.REGISTRY.values()]
    convo = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)

    for _ in range(max_iters):
        text_buf = ""
        final = None
        for ev in llm.stream_chat(convo, tool_specs):
            if ev["type"] == "text":
                text_buf += ev["delta"]
                emit({"type": "token", "delta": ev["delta"]})
            elif ev["type"] == "final":
                final = ev

        tool_calls = (final or {}).get("tool_calls") or []
        if not tool_calls:
            emit({"type": "done"})
            return

        # 记录助手的 tool_calls 轮
        convo.append({"role": "assistant", "content": text_buf or None,
                      "tool_calls": tool_calls})

        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            emit({"type": "tool_start", "name": name,
                  "summary": json.dumps(args, ensure_ascii=False)[:80]})
            spec = tools_mod.REGISTRY.get(name)
            if not spec:
                result = {"error": f"未知工具 {name}"}
            else:
                try:
                    result = spec["execute"](db, user, **args)
                except Exception as exc:  # 工具错误回灌模型，不中断
                    result = {"error": str(exc)}
            card = result.pop("_card", None) if isinstance(result, dict) else None
            emit({"type": "tool_end", "name": name, "ok": "error" not in (result or {})})
            if card:
                emit({"type": "card", "card_type": card["card_type"],
                      "payload": card["payload"]})
            convo.append({"role": "tool", "tool_call_id": tc["id"],
                          "content": json.dumps(sanitize_for_llm(result),
                                                ensure_ascii=False)})

    emit({"type": "error", "message": "已达到最大工具调用轮数，请缩小问题范围后重试。"})
```

- [ ] **Step 4: 临时占位 sanitizer 以通过导入**

为让本任务测试可跑，先建最小 `backend/app/assistant/sanitizer.py`（Phase 5 再补完整逻辑与测试）：

```python
"""出境前脱敏（Phase 5 完善）。当前为透传占位。"""
def sanitize_for_llm(data):
    return data
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && pytest tests/test_agent.py -v`
Expected: PASS（3 个用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/agent.py backend/app/assistant/sanitizer.py backend/tests/test_agent.py
git commit -m "feat(assistant): Agent 编排循环（工具调用/卡片/上限兜底）"
```

---

### Task 1.4：SSE 聊天端点

**Files:**

- Create: `backend/app/routers/assistant.py`

- Modify: `backend/app/main.py`（注册路由）

- Test: `backend/tests/test_assistant_api.py`

- [ ] **Step 1: 写失败测试（用 FastAPI TestClient + 依赖覆盖）**

`backend/tests/test_assistant_api.py`：

```python
import json
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.assistant import agent as agent_mod


def test_chat_streams_events(db, engineer_user, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user

    def fake_run_agent(messages, db_, user, emit, **kw):
        emit({"type": "token", "delta": "hi"})
        emit({"type": "done"})
    monkeypatch.setattr(agent_mod, "run_agent", fake_run_agent)

    client = TestClient(app)
    with client.stream("POST", "/api/assistant/chat",
                       json={"messages": [{"role": "user", "content": "hi"}]}) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_text())
    assert '"type": "token"' in body or '"type":"token"' in body
    assert "done" in body
    app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_assistant_api.py -v`
Expected: FAIL（404 或 ImportError）。

- [ ] **Step 3: 实现 routers/assistant.py**

`backend/app/routers/assistant.py`：

```python
"""AI 助手 SSE 端点。"""
import json
import queue
import threading

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import User
from .auth import require_role, get_current_active_user
from ..assistant import agent as agent_mod

router = APIRouter(prefix="/assistant", tags=["AI助手"])

ASSISTANT_ROLES = ["admin", "engineer", "production", "guest"]


class ChatRequest(BaseModel):
    messages: list


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(
    req: ChatRequest,
    current_user: User = Depends(require_role(ASSISTANT_ROLES)),
):
    """SSE 流式：在独立线程跑 Agent，通过队列把事件推给响应生成器。

    Agent 内部需要 DB 会话——为避免跨线程复用请求级会话，这里新开一个会话。
    """
    q: "queue.Queue" = queue.Queue()
    SENTINEL = object()

    def worker():
        db = SessionLocal()
        try:
            agent_mod.run_agent(req.messages, db, current_user, q.put)
        except Exception as exc:  # 兜底
            q.put({"type": "error", "message": str(exc)})
        finally:
            db.close()
            q.put(SENTINEL)

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            ev = q.get()
            if ev is SENTINEL:
                break
            yield _sse(ev)

    return StreamingResponse(stream(), media_type="text/event-stream")
```

> 注：测试用例用 `monkeypatch` 替换了 `run_agent`，因此测试不依赖线程内真实 DB。生产路径新开 `SessionLocal()`，与请求级 `get_db` 解耦。

- [ ] **Step 4: 在 main.py 注册路由**

修改 `backend/app/main.py`：

1. 在路由 import 区（`from .routers.admin import router as admin_router` 附近）加：
   
   ```python
   from .routers.assistant import router as assistant_router
   ```

2. 在 `app.include_router(admin_router, prefix="/api")` 之后加：
   
   ```python
   app.include_router(assistant_router, prefix="/api")
   ```
- [ ] **Step 5: 运行确认通过**

Run: `cd backend && pytest tests/test_assistant_api.py -v`
Expected: PASS。

- [ ] **Step 6: 全量回归**

Run: `cd backend && pytest -v`
Expected: 所有用例 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/assistant.py backend/app/main.py backend/tests/test_assistant_api.py
git commit -m "feat(assistant): SSE 聊天端点并注册路由"
```

---

## Phase 2：BOM 对比双通道（diff_bom）

### Task 2.1：diff_bom 工具（小 BOM 原始数据 / 大 BOM 服务端预处理）

**Files:**

- Modify: `backend/app/assistant/tools.py`

- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

> `get_bom_tree_recursive` 依赖 PostgreSQL 递归 CTE，内存 SQLite 跑不了，因此用 monkeypatch 替换它来控制节点数，DB 无关地覆盖「小→raw / 大→preprocessed」两条路径。

在 `backend/tests/test_tools.py` 末尾追加：

```python
def _make_assembly(db, code, name):
    a = models.Assembly(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(a); db.commit(); db.refresh(a)
    return a


def _fake_node(code, qty, level=0):
    return {"child_code": code, "child_name": code + "名", "quantity": qty, "level": level}


def test_diff_bom_small_returns_raw_trees(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: [_fake_node("X", 1)])
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "raw"
    assert "left" in out and "right" in out


def test_diff_bom_large_returns_preprocessed_diff(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    # 阈值设小，强制走预处理；左右有增/删/改量
    monkeypatch.setenv("ASSISTANT_BOM_RAW_THRESHOLD", "1")
    left_nodes = [_fake_node("COMMON", 1), _fake_node("ONLY_LEFT", 1)]
    right_nodes = [_fake_node("COMMON", 3), _fake_node("ONLY_RIGHT", 1)]
    calls = iter([left_nodes, right_nodes])
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: next(calls))
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "preprocessed"
    codes_added = {r["code"] for r in out["diff"]["added"]}
    codes_removed = {r["code"] for r in out["diff"]["removed"]}
    codes_changed = {r["code"] for r in out["diff"]["changed"]}
    assert "ONLY_RIGHT" in codes_added
    assert "ONLY_LEFT" in codes_removed
    assert "COMMON" in codes_changed
    assert out["_card"]["card_type"] == "table"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_tools.py -k diff_bom -v`
Expected: FAIL（`KeyError: 'diff_bom'`）。

- [ ] **Step 3: 实现 diff_bom 并注册**

在 `backend/app/assistant/tools.py` 顶部 import 区追加：

```python
import os
from ..bom import compare
```

追加函数（放在 REGISTRY 定义之前）：

```python
def _flatten_tree(db, etype, eid):
    if etype != "assembly":
        return []
    return compare.get_bom_tree_recursive(db, eid)


def diff_bom(db: Session, user: User, left_id: str, right_id: str,
             left_type: str = "assembly", right_type: str = "assembly"):
    threshold = int(os.getenv("ASSISTANT_BOM_RAW_THRESHOLD", "200"))
    left_nodes = _flatten_tree(db, left_type, uuid.UUID(left_id))
    right_nodes = _flatten_tree(db, right_type, uuid.UUID(right_id))

    def brief(nodes):
        return [{"code": n.get("child_code"), "name": n.get("child_name"),
                 "qty": int(n.get("quantity") or 0), "level": n.get("level")}
                for n in nodes]

    if len(left_nodes) + len(right_nodes) <= threshold:
        # 小 BOM：原始数据交给模型自由分析
        return {"mode": "raw", "left": brief(left_nodes), "right": brief(right_nodes)}

    # 大 BOM：服务端预处理，只回变化行
    def key(n):
        return n.get("child_code")
    lmap = {key(n): n for n in left_nodes}
    rmap = {key(n): n for n in right_nodes}
    added = [brief([rmap[k]])[0] for k in rmap.keys() - lmap.keys()]
    removed = [brief([lmap[k]])[0] for k in lmap.keys() - rmap.keys()]
    changed = []
    for k in lmap.keys() & rmap.keys():
        lq = int(lmap[k].get("quantity") or 0)
        rq = int(rmap[k].get("quantity") or 0)
        if lq != rq:
            changed.append({"code": k, "name": lmap[k].get("child_name"),
                            "left_qty": lq, "right_qty": rq})
    diff = {"added": added, "removed": removed, "changed": changed}
    card = {"card_type": "table", "payload": {
        "title": "BOM 对比（已对超大 BOM 预处理）",
        "columns": ["变化", "code", "name", "数量"],
        "rows": ([{"变化": "新增", **a} for a in added] +
                 [{"变化": "删除", **r} for r in removed] +
                 [{"变化": "改量", "code": c["code"], "name": c["name"],
                   "数量": f'{c["left_qty"]}→{c["right_qty"]}'} for c in changed])}}
    return {"mode": "preprocessed", "diff": diff, "_card": card,
            "note": "BOM 较大，已服务端预处理为差异。"}
```

在 `REGISTRY` 字典中追加一项：

```python
    "diff_bom": {
        "execute": diff_bom,
        "schema": {"type": "function", "function": {
            "name": "diff_bom",
            "description": ("对比两个部件的 BOM。小 BOM 返回两棵原始树供你自行分析差异；"
                            "大 BOM 自动返回服务端预处理的增/删/改量。"),
            "parameters": {"type": "object", "properties": {
                "left_id": {"type": "string"},
                "right_id": {"type": "string"},
                "left_type": {"type": "string", "enum": ["assembly"], "default": "assembly"},
                "right_type": {"type": "string", "enum": ["assembly"], "default": "assembly"},
            }, "required": ["left_id", "right_id"]},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_tools.py -v`
Expected: PASS（含新用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): diff_bom 双通道（小BOM原始/大BOM预处理）"
```

---

## Phase 3：下载/导出工具 + 权限

### Task 3.1：trace_bom 反查工具

**Files:**

- Modify: `backend/app/assistant/tools.py`

- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

```python
def test_trace_bom_returns_parents(db, engineer_user):
    parent = _make_assembly(db, "A-P", "父")
    child = _make_part(db, "P-C", "子")
    bi = models.BOMItem(id=uuid.uuid4(), parent_type="assembly", parent_id=parent.id,
                        child_type="part", child_id=child.id, quantity=2)
    db.add(bi); db.commit()
    out = tools.REGISTRY["trace_bom"]["execute"](
        db, engineer_user, entity_type="part", entity_id=str(child.id))
    assert isinstance(out["parents"], list)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_tools.py::test_trace_bom_returns_parents -v`
Expected: FAIL（`KeyError: 'trace_bom'`）。

- [ ] **Step 3: 实现 trace_bom**

在 `tools.py` 追加函数（复用 BOM 反查的递归 CTE，但 SQLite 测试库需兼容——用 SQLAlchemy ORM 逐层查询，避免 PG 专有语法）：

```python
def trace_bom(db: Session, user: User, entity_type: str, entity_id: str, max_level: int = 10):
    from ..models import BOMItem
    if entity_type not in ("part", "assembly"):
        return {"error": "无效类型"}
    parents = []
    frontier = [uuid.UUID(entity_id)]
    seen = set()
    level = 0
    while frontier and level < max_level:
        level += 1
        next_frontier = []
        rows = db.query(BOMItem).filter(
            BOMItem.child_id.in_(frontier),
            BOMItem.deleted_at.is_(None),
        ).all()
        for r in rows:
            if r.parent_id in seen:
                continue
            seen.add(r.parent_id)
            pa = crud.get_assembly(db, r.parent_id) if r.parent_type == "assembly" else crud.get_part(db, r.parent_id)
            if pa:
                parents.append({"level": level, "parent_type": r.parent_type,
                                "code": pa.code, "name": pa.name})
                next_frontier.append(r.parent_id)
        frontier = next_frontier
    return {"parents": parents}
```

在 REGISTRY 追加：

```python
    "trace_bom": {
        "execute": trace_bom,
        "schema": {"type": "function", "function": {
            "name": "trace_bom",
            "description": "BOM 反查：查找使用了某零件/部件的所有上层部件。",
            "parameters": {"type": "object", "properties": {
                "entity_type": {"type": "string", "enum": ["part", "assembly"]},
                "entity_id": {"type": "string"},
            }, "required": ["entity_type", "entity_id"]},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_tools.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): trace_bom 反查工具（ORM 逐层，兼容测试库）"
```

---

### Task 3.2：下载/导出工具 + 权限守卫

**Files:**

- Modify: `backend/app/assistant/tools.py`

- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试（含访客越权被拒）**

```python
def test_export_bom_returns_link_for_engineer(db, engineer_user):
    a = _make_assembly(db, "A-X", "导出")
    out = tools.REGISTRY["export_bom"]["execute"](
        db, engineer_user, type="assembly", id=str(a.id))
    assert out["_card"]["card_type"] == "download"
    assert "/api/" in out["_card"]["payload"]["url"]


def test_export_bom_denied_for_guest(db, guest_user):
    a = _make_assembly(db, "A-Y", "禁止")
    out = tools.REGISTRY["export_bom"]["execute"](
        db, guest_user, type="assembly", id=str(a.id))
    assert "error" in out and "_card" not in out
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_tools.py -k export_bom -v`
Expected: FAIL（`KeyError: 'export_bom'`）。

- [ ] **Step 3: 实现下载/导出工具**

在 `tools.py` 追加（`DOWNLOAD_ROLES` 已在 Task 1.1 定义）：

```python
def export_bom(db: Session, user: User, type: str, id: str):
    if user.role not in DOWNLOAD_ROLES:
        return {"error": "当前账号无下载/导出权限"}
    # 复用现有 BOM 导出端点（前端用带 token 链接调用）
    url = f"/api/bom/export/{type}/{id}"
    card = {"card_type": "download", "payload": {"label": "下载 BOM 导出", "url": url}}
    return {"url": url, "_card": card}


def download_document(db: Session, user: User, attachment_id: str):
    if user.role not in DOWNLOAD_ROLES:
        return {"error": "当前账号无下载权限"}
    url = f"/api/v2/attachments/{attachment_id}/direct-download"
    card = {"card_type": "download", "payload": {"label": "下载文档", "url": url}}
    return {"url": url, "_card": card}
```

REGISTRY 追加：

```python
    "export_bom": {
        "execute": export_bom,
        "schema": {"type": "function", "function": {
            "name": "export_bom",
            "description": "导出零件/部件的 BOM，返回下载链接。需下载权限。",
            "parameters": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["part", "assembly"]},
                "id": {"type": "string"},
            }, "required": ["type", "id"]},
        }},
    },
    "download_document": {
        "execute": download_document,
        "schema": {"type": "function", "function": {
            "name": "download_document",
            "description": "返回某附件的下载链接。需下载权限。",
            "parameters": {"type": "object", "properties": {
                "attachment_id": {"type": "string"},
            }, "required": ["attachment_id"]},
        }},
    },
```

> **已确认**：`backend/app/routers/bom.py` 目前**没有** `/export` 端点。因此本任务必须新增一个最简 CSV 导出端点（见下一步）。前端下载链接统一由前端附加 `Authorization` 头（见 Task 6.2 `authedDownload`）。

- [ ] **Step 3.5: 在 routers/bom.py 新增 CSV 导出端点**

在 `backend/app/routers/bom.py` 末尾追加（复用已存在的 `compare.get_bom_tree_recursive`；文件顶部已 `from ..bom import compare`、`from fastapi.responses` 需新增 import）：

文件顶部 import 区追加：

```python
from fastapi.responses import StreamingResponse
import csv
import io
```

追加端点：

```python
@router.get("/export/{item_type}/{item_id}")
async def export_bom_csv(
    item_type: str,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production"])),
):
    """导出零件/部件 BOM 为 CSV（供 AI 助手与前端下载）。"""
    if item_type not in ("part", "assembly"):
        raise HTTPException(status_code=400, detail="无效的类型")
    nodes = compare.get_bom_tree_recursive(db, item_id) if item_type == "assembly" else []
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["层级", "类型", "编码", "名称", "规格", "数量"])
    for n in nodes:
        writer.writerow([n.get("level"), n.get("child_type"), n.get("child_code"),
                         n.get("child_name"), n.get("child_spec"), n.get("quantity")])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="bom_{item_id}.csv"'})
```

> 本端点的下载验证依赖真实 PostgreSQL（递归 CTE），不纳入 SQLite 单测；通过 Task 6.4 浏览器手动验证覆盖。`export_bom` 工具单测只校验它返回了正确形状的 download 卡片与 url（不真正取数）。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_tools.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/app/routers/bom.py backend/tests/test_tools.py
git commit -m "feat(assistant): 下载/导出工具、CSV导出端点与下载权限守卫"
```

---

## Phase 4：文档生成（create_document + 产物落地 + 下载端点）

### Task 4.1：document_builder（Markdown 产物落地）

**Files:**

- Create: `backend/app/assistant/document_builder.py`

- Test: `backend/tests/test_document_builder.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_document_builder.py`：

```python
import os
from app.assistant import document_builder as db_mod


def test_build_markdown_persists_and_returns_meta(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    meta = db_mod.build_document(title="变更报告", content="# 标题\n正文", fmt="md")
    assert meta["doc_id"]
    assert meta["format"] == "md"
    saved = os.path.join(str(tmp_path), "assistant_artifacts", meta["doc_id"] + ".md")
    assert os.path.exists(saved)
    with open(saved, encoding="utf-8") as f:
        assert "正文" in f.read()


def test_read_document_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    meta = db_mod.build_document(title="t", content="hello", fmt="md")
    assert db_mod.read_document(meta["doc_id"]) == "hello"


def test_read_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    assert db_mod.read_document("nope") is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_document_builder.py -v`
Expected: FAIL（`ImportError`）。

- [ ] **Step 3: 实现 document_builder.py**

`backend/app/assistant/document_builder.py`：

```python
"""AI 文档产物组装与落地（v1 仅 Markdown，预留 docx/xlsx/pdf）。"""
import os
import uuid
import re

SUPPORTED = {"md"}


def _artifacts_dir() -> str:
    base = os.getenv("UPLOAD_DIR", "/app/uploads")
    d = os.path.join(base, "assistant_artifacts")
    os.makedirs(d, exist_ok=True)
    return d


def _safe_doc_id(doc_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", doc_id or ""):
        raise ValueError("非法 doc_id")
    return doc_id


def build_document(title: str, content: str, fmt: str = "md") -> dict:
    if fmt not in SUPPORTED:
        raise ValueError(f"暂不支持的格式: {fmt}")
    doc_id = uuid.uuid4().hex
    body = content if content.lstrip().startswith("#") else f"# {title}\n\n{content}"
    path = os.path.join(_artifacts_dir(), f"{doc_id}.{fmt}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return {"doc_id": doc_id, "title": title, "format": fmt,
            "preview": body, "download_url": f"/api/assistant/artifacts/{doc_id}/download"}


def read_document(doc_id: str) -> "str | None":
    doc_id = _safe_doc_id(doc_id)
    path = os.path.join(_artifacts_dir(), f"{doc_id}.md")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_document_builder.py -v`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/document_builder.py backend/tests/test_document_builder.py
git commit -m "feat(assistant): document_builder Markdown 产物落地"
```

---

### Task 4.2：create_document 工具 + 产物下载端点

**Files:**

- Modify: `backend/app/assistant/tools.py`

- Modify: `backend/app/routers/assistant.py`

- Test: `backend/tests/test_tools.py`、`backend/tests/test_assistant_api.py`（追加）

- [ ] **Step 1: 追加失败测试**

`test_tools.py` 追加：

```python
def test_create_document_returns_markdown_doc_card(db, engineer_user, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    out = tools.REGISTRY["create_document"]["execute"](
        db, engineer_user, title="对比报告", content="# 报告\n内容")
    assert out["_card"]["card_type"] == "markdown_doc"
    assert out["_card"]["payload"]["download_url"].endswith("/download")
```

`test_assistant_api.py` 追加：

```python
def test_artifact_download(db, engineer_user, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.assistant import document_builder
    meta = document_builder.build_document("t", "# 标题\n正文", "md")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    client = TestClient(app)
    resp = client.get(f"/api/assistant/artifacts/{meta['doc_id']}/download")
    assert resp.status_code == 200
    assert "正文" in resp.text
    app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_tools.py -k create_document tests/test_assistant_api.py -k artifact -v`
Expected: FAIL。

- [ ] **Step 3: 实现 create_document 工具**

`tools.py` 顶部 import 追加：`from . import document_builder`。追加函数与注册：

```python
def create_document(db: Session, user: User, title: str, content: str, format: str = "md"):
    meta = document_builder.build_document(title=title, content=content, fmt=format)
    card = {"card_type": "markdown_doc", "payload": {
        "title": meta["title"], "preview": meta["preview"],
        "download_url": meta["download_url"]}}
    # 不把全文回灌模型（节省 token），只回执行结果
    return {"doc_id": meta["doc_id"], "title": meta["title"], "_card": card}
```

```python
    "create_document": {
        "execute": create_document,
        "schema": {"type": "function", "function": {
            "name": "create_document",
            "description": ("把你撰写好的文档内容交给后端生成成品（Markdown），"
                            "返回可预览/下载的产物。content 为完整 Markdown 正文。"),
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string"},
                "content": {"type": "string", "description": "完整 Markdown 正文"},
                "format": {"type": "string", "enum": ["md"], "default": "md"},
            }, "required": ["title", "content"]},
        }},
    },
```

- [ ] **Step 4: 实现产物下载端点**

`routers/assistant.py` 追加（文件顶部 import 追加 `from fastapi import HTTPException` 与 `from ..assistant import document_builder`）：

```python
@router.get("/artifacts/{doc_id}/download")
async def download_artifact(
    doc_id: str,
    current_user: User = Depends(require_role(ASSISTANT_ROLES)),
):
    content = document_builder.read_document(doc_id)
    if content is None:
        raise HTTPException(status_code=404, detail="产物不存在")
    return StreamingResponse(
        iter([content]), media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{doc_id}.md"'})
```

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `cd backend && pytest -v`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/tools.py backend/app/routers/assistant.py backend/tests/
git commit -m "feat(assistant): create_document 工具与产物下载端点"
```

---

## Phase 5：合规与硬化

### Task 5.1：sanitizer 字段白名单/脱敏

**Files:**

- Modify: `backend/app/assistant/sanitizer.py`

- Test: `backend/tests/test_sanitizer.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_sanitizer.py`：

```python
from app.assistant.sanitizer import sanitize_for_llm


def test_strips_sensitive_keys_recursively():
    data = {"code": "P-1", "cost": 12.5, "supplier": "ACME",
            "children": [{"name": "x", "price": 9}]}
    out = sanitize_for_llm(data)
    assert "cost" not in out and "supplier" not in out
    assert "price" not in out["children"][0]
    assert out["code"] == "P-1"


def test_passes_through_plain_values():
    assert sanitize_for_llm("hello") == "hello"
    assert sanitize_for_llm([1, 2]) == [1, 2]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_sanitizer.py -v`
Expected: FAIL（占位实现不脱敏）。

- [ ] **Step 3: 实现 sanitizer.py（替换占位）**

`backend/app/assistant/sanitizer.py`：

```python
"""出境前脱敏：递归剔除敏感字段。

敏感字段集合可经 ASSISTANT_SENSITIVE_FIELDS（逗号分隔）覆盖。
"""
import os

_DEFAULT_SENSITIVE = {"cost", "price", "supplier", "supplier_code", "unit_price"}


def _sensitive_fields():
    extra = os.getenv("ASSISTANT_SENSITIVE_FIELDS", "")
    fields = set(_DEFAULT_SENSITIVE)
    if extra.strip():
        fields |= {f.strip() for f in extra.split(",") if f.strip()}
    return fields


def sanitize_for_llm(data):
    fields = _sensitive_fields()
    if isinstance(data, dict):
        return {k: sanitize_for_llm(v) for k, v in data.items() if k not in fields}
    if isinstance(data, list):
        return [sanitize_for_llm(v) for v in data]
    return data
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd backend && pytest -v`
Expected: 全部 PASS（agent 已在 Task 1.3 调用 `sanitize_for_llm`，现在生效）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/sanitizer.py backend/tests/test_sanitizer.py
git commit -m "feat(assistant): 出境前字段脱敏并接入 Agent 回灌"
```

---

### Task 5.2：.env 配置项与文档

**Files:**

- Modify: `.env`

- Modify: `AGENTS.md`（在 API 概览补一节）

- [ ] **Step 1: 追加 .env 配置**

在项目根 `.env` 追加：

```
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ASSISTANT_MAX_ITERS=8
ASSISTANT_BOM_RAW_THRESHOLD=200
ASSISTANT_SENSITIVE_FIELDS=
```

- [ ] **Step 2: 确认 docker-compose 把变量透传给后端**

Run: `grep -n "environment\|DEEPSEEK\|UPLOAD_DIR" docker-compose.yml`
若 `bom_backend` 的 `environment` 未透传上述变量，在其 `environment:` 下追加：

```yaml
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
      - DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-chat}
      - ASSISTANT_MAX_ITERS=${ASSISTANT_MAX_ITERS:-8}
      - ASSISTANT_BOM_RAW_THRESHOLD=${ASSISTANT_BOM_RAW_THRESHOLD:-200}
      - ASSISTANT_SENSITIVE_FIELDS=${ASSISTANT_SENSITIVE_FIELDS:-}
```

- [ ] **Step 3: 在 AGENTS.md 追加「AI 助手」接口小节**

在 `AGENTS.md` 的「📝 API 接口概览」末尾追加：

```markdown
### AI 助手

- `POST /api/assistant/chat` - 自然语言对话（SSE 流式，工具编排）
- `GET /api/assistant/artifacts/{doc_id}/download` - 下载 AI 生成的文档产物
```

- [ ] **Step 4: Commit**

```bash
git add .env docker-compose.yml AGENTS.md
git commit -m "chore(assistant): 配置项透传与文档补充"
```

---

## Phase 6：前端悬浮聊天窗

> 前端无单元测试，每个 Task 以 `cd frontend && npm run build` 通过 + 浏览器手动验证为完成标准。

### Task 6.1：类型定义与 Zustand 会话 store

**Files:**

- Create: `frontend/src/types/assistant.ts`

- Create: `frontend/src/stores/assistant.ts`

- [ ] **Step 1: 写类型定义**

`frontend/src/types/assistant.ts`：

```typescript
export type CardType = 'table' | 'markdown_doc' | 'download' | 'link';

export interface AssistantCard {
  card_type: CardType;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  cards: AssistantCard[];
  streaming?: boolean;
}

export type SSEEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string; summary: string }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'card'; card_type: CardType; payload: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 写 store**

`frontend/src/stores/assistant.ts`：

```typescript
import { create } from 'zustand';
import type { ChatMessage, AssistantCard } from '../types/assistant';

interface AssistantState {
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  toggle: () => void;
  pushUser: (text: string) => void;
  startAssistant: () => void;
  appendToken: (delta: string) => void;
  addCard: (card: AssistantCard) => void;
  finish: () => void;
  setError: (msg: string) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  open: false,
  messages: [],
  busy: false,
  toggle: () => set((s) => ({ open: !s.open })),
  pushUser: (text) =>
    set((s) => ({ messages: [...s.messages, { role: 'user', text, cards: [] }] })),
  startAssistant: () =>
    set((s) => ({ busy: true,
      messages: [...s.messages, { role: 'assistant', text: '', cards: [], streaming: true }] })),
  appendToken: (delta) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.text += delta;
      return { messages: msgs };
    }),
  addCard: (card) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.cards = [...last.cards, card];
      return { messages: msgs };
    }),
  finish: () =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last) last.streaming = false;
      return { busy: false, messages: msgs };
    }),
  setError: (msg) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.text += `\n\n⚠️ ${msg}`;
      return { busy: false, messages: msgs };
    }),
}));
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/assistant.ts frontend/src/stores/assistant.ts
git commit -m "feat(assistant-fe): 会话类型与 Zustand store"
```

---

### Task 6.2：SSE 流式客户端与 hook

**Files:**

- Create: `frontend/src/services/assistantApi.ts`

- Create: `frontend/src/hooks/useAssistantChat.ts`

- [ ] **Step 1: 写 assistantApi.ts（fetch 流式读取）**

`frontend/src/services/assistantApi.ts`：

```typescript
import { useAuthStore } from '../stores/auth';
import type { SSEEvent, ChatMessage } from '../types/assistant';

export async function streamChat(
  history: ChatMessage[],
  onEvent: (ev: SSEEvent) => void,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const messages = history.map((m) => ({ role: m.role, content: m.text }));
  const resp = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  if (!resp.body) throw new Error('无响应流');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith('data:')) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as SSEEvent);
      } catch {
        /* 忽略半包 */
      }
    }
  }
}

// 给下载链接附带 token（后端下载端点需鉴权）
export function authedDownload(url: string): void {
  const token = useAuthStore.getState().token;
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '';
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
```

- [ ] **Step 2: 写 hook**

`frontend/src/hooks/useAssistantChat.ts`：

```typescript
import { useCallback } from 'react';
import { useAssistantStore } from '../stores/assistant';
import { streamChat } from '../services/assistantApi';

export function useAssistantChat() {
  const store = useAssistantStore();

  const send = useCallback(async (text: string) => {
    if (!text.trim() || store.busy) return;
    store.pushUser(text);
    const history = useAssistantStore.getState().messages;
    store.startAssistant();
    try {
      await streamChat(history, (ev) => {
        switch (ev.type) {
          case 'token': store.appendToken(ev.delta); break;
          case 'card': store.addCard({ card_type: ev.card_type, payload: ev.payload }); break;
          case 'done': store.finish(); break;
          case 'error': store.setError(ev.message); break;
          default: break; // tool_start/tool_end 可后续做状态条
        }
      });
      useAssistantStore.getState().finish();
    } catch (e) {
      useAssistantStore.getState().setError(String(e));
    }
  }, [store]);

  return { send };
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/assistantApi.ts frontend/src/hooks/useAssistantChat.ts
git commit -m "feat(assistant-fe): SSE 流式客户端与聊天 hook"
```

---

### Task 6.3：卡片组件

**Files:**

- Create: `frontend/src/components/assistant/cards/TextCard.tsx`

- Create: `frontend/src/components/assistant/cards/TableCard.tsx`

- Create: `frontend/src/components/assistant/cards/MarkdownCard.tsx`

- Create: `frontend/src/components/assistant/cards/DownloadCard.tsx`

- Create: `frontend/src/components/assistant/cards/LinkCard.tsx`

- [ ] **Step 1: TableCard.tsx**

```tsx
interface Props { payload: { title?: string; columns: string[]; rows: Record<string, unknown>[] }; }
export default function TableCard({ payload }: Props) {
  const { title, columns, rows } = payload;
  return (
    <div className="border rounded-lg overflow-hidden my-2">
      {title && <div className="px-3 py-2 bg-gray-50 text-sm font-medium">{title}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-gray-100">
            {columns.map((c) => <th key={c} className="px-3 py-1.5 text-left whitespace-nowrap">{c}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{String(r[c] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DownloadCard.tsx**

```tsx
import { authedDownload } from '../../../services/assistantApi';
interface Props { payload: { label?: string; url: string }; }
export default function DownloadCard({ payload }: Props) {
  return (
    <button onClick={() => authedDownload(payload.url)}
      className="my-2 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
      ⬇ {payload.label || '下载'}
    </button>
  );
}
```

- [ ] **Step 3: MarkdownCard.tsx**（v1 用 `<pre>` 预览，避免引入 markdown 渲染依赖）

```tsx
import { authedDownload } from '../../../services/assistantApi';
interface Props { payload: { title?: string; preview: string; download_url: string }; }
export default function MarkdownCard({ payload }: Props) {
  return (
    <div className="border rounded-lg my-2">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
        <span className="text-sm font-medium">{payload.title || '文档'}</span>
        <div className="flex gap-2">
          <button onClick={() => navigator.clipboard.writeText(payload.preview)}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-100">复制</button>
          <button onClick={() => authedDownload(payload.download_url)}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">下载 .md</button>
        </div>
      </div>
      <pre className="p-3 text-xs whitespace-pre-wrap max-h-72 overflow-auto">{payload.preview}</pre>
    </div>
  );
}
```

- [ ] **Step 4: LinkCard.tsx**

```tsx
interface Props { payload: { label?: string; href: string }; }
export default function LinkCard({ payload }: Props) {
  return (
    <a href={payload.href} className="my-2 inline-block text-blue-600 underline text-sm">
      {payload.label || '查看详情'}
    </a>
  );
}
```

- [ ] **Step 5: TextCard.tsx**

```tsx
interface Props { text: string; streaming?: boolean; }
export default function TextCard({ text, streaming }: Props) {
  return (
    <div className="text-sm whitespace-pre-wrap leading-relaxed">
      {text}{streaming && <span className="animate-pulse">▋</span>}
    </div>
  );
}
```

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/assistant/cards/
git commit -m "feat(assistant-fe): 富卡片组件（table/markdown/download/link/text）"
```

---

### Task 6.4：消息流、输入框、悬浮面板并挂载

**Files:**

- Create: `frontend/src/components/assistant/MessageList.tsx`

- Create: `frontend/src/components/assistant/ChatInput.tsx`

- Create: `frontend/src/components/assistant/FloatingAssistant.tsx`

- Modify: `frontend/src/components/Layout.tsx`（挂载悬浮组件）

- [ ] **Step 1: MessageList.tsx**

```tsx
import { useAssistantStore } from '../../stores/assistant';
import TextCard from './cards/TextCard';
import TableCard from './cards/TableCard';
import MarkdownCard from './cards/MarkdownCard';
import DownloadCard from './cards/DownloadCard';
import LinkCard from './cards/LinkCard';
import type { AssistantCard } from '../../types/assistant';

function renderCard(card: AssistantCard, i: number) {
  const p = card.payload as never;
  switch (card.card_type) {
    case 'table': return <TableCard key={i} payload={p} />;
    case 'markdown_doc': return <MarkdownCard key={i} payload={p} />;
    case 'download': return <DownloadCard key={i} payload={p} />;
    case 'link': return <LinkCard key={i} payload={p} />;
    default: return null;
  }
}

export default function MessageList() {
  const messages = useAssistantStore((s) => s.messages);
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((m, i) => (
        <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
          <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 ${
            m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
            {m.role === 'assistant'
              ? <><TextCard text={m.text} streaming={m.streaming} />
                  {m.cards.map(renderCard)}</>
              : <span className="text-sm">{m.text}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: ChatInput.tsx**

```tsx
import { useState } from 'react';
import { useAssistantChat } from '../../hooks/useAssistantChat';
import { useAssistantStore } from '../../stores/assistant';

export default function ChatInput() {
  const [text, setText] = useState('');
  const { send } = useAssistantChat();
  const busy = useAssistantStore((s) => s.busy);
  const submit = () => { const t = text; setText(''); send(t); };
  return (
    <div className="border-t p-2 flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        disabled={busy} placeholder="问点什么，比如：对比 A-1 和 A-2 的 BOM"
        className="flex-1 border rounded-md px-3 py-1.5 text-sm" />
      <button onClick={submit} disabled={busy}
        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
        发送
      </button>
    </div>
  );
}
```

- [ ] **Step 3: FloatingAssistant.tsx**

```tsx
import { useAssistantStore } from '../../stores/assistant';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

export default function FloatingAssistant() {
  const { open, toggle } = useAssistantStore();
  return (
    <>
      <button onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 flex items-center justify-center text-xl">
        {open ? '×' : 'AI'}
      </button>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[32rem] bg-white rounded-xl shadow-2xl border flex flex-col">
          <div className="px-4 py-2 border-b font-medium text-sm">PDM 智能助手</div>
          <MessageList />
          <ChatInput />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: 在 Layout 挂载**

先确认 Layout 结构：`grep -n "return\|</" frontend/src/components/Layout.tsx | head`。
在 `frontend/src/components/Layout.tsx` 顶部 import：

```typescript
import FloatingAssistant from './assistant/FloatingAssistant';
```

在 Layout 的最外层返回容器内、闭合标签前插入：

```tsx
      <FloatingAssistant />
```

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 6: 浏览器手动验证**
1. 起后端（容器内或本地）并在 `.env` 填入有效 `DEEPSEEK_API_KEY`，重启 `bom_backend`。

2. `docker-compose up -d --force-recreate nginx`，浏览器 Ctrl+F5。

3. 登录后右下角出现 AI 悬浮球；点开输入"搜索 P-100"，确认有流式文字返回。

4. 输入"对比 A-1 和 A-2 的 BOM"（用库中真实编码），确认返回表格卡片。

5. 输入"把刚才的对比写成一份变更报告文档"，确认出现可下载的 markdown_doc 卡片，点下载得到 .md。

6. 用 guest 账号登录，要求下载，确认被礼貌拒绝。
- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/assistant/ frontend/src/components/Layout.tsx
git commit -m "feat(assistant-fe): 悬浮聊天窗口并挂载到 Layout"
```

---

## 验收清单（全部完成后）

- [ ] 后端 `cd backend && pytest -v` 全绿
- [ ] 前端 `cd frontend && npm run build` 无报错
- [ ] 悬浮窗可问答、流式输出、表格卡片、文档生成与下载
- [ ] 访客下载被拦截
- [ ] 敏感字段不出境（可在 agent 回灌处临时打印验证）
- [ ] 超大 BOM 走 diff_bom 预处理路径（构造 >阈值 数据验证）

---

## 备注与后续（二期）

- 会话历史持久化、上下文裁剪策略。
- 写操作工具（需二次确认 UX）、变更对比工具。
- Word/Excel/PDF 产物（document_builder 加渲染器，前端协议不变）。
- `tool_start/tool_end` 事件在前端做"正在查询…"状态条。
- MarkdownCard 升级为真正的 Markdown 渲染（引入 react-markdown，需征得用户同意新增依赖）。
