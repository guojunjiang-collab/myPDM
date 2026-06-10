# AI 助手：全量只读网关 + 自生数据字典 — 设计

- **日期**: 2026-06-10
- **状态**: 已评审，待实现计划
- **关联**: [PDM AI 助手](2026-06-10-pdm-ai-assistant-design.md)

## 目标

让 AI agent 能读取整个 PDM 系统的全部业务数据类型，并具备对系统接口与数据模型的"知识/技能"——通过两层能力：

1. **只读网关（手）**：AI 可调用任意白名单 GET 接口，进程内转发到真实 FastAPI 路由，权限与业务逻辑全部复用现有代码。
2. **自生数据字典/知识层（脑）**：从 OpenAPI + SQLAlchemy 模型 + 人工词汇表自动生成"PDM 操作手册"，让 agent 启动即懂系统，无需每次靠探索现学。

两层都是**从代码静态派生**（可一键重生成，永远跟代码同步），不是会跑偏的"学习记忆"。

## 范围决策（已定）

- **交付方式**：系统提示注入一份**精简「PDM 速览」**（常驻、很小）+ `get_data_dictionary` 工具按需返回完整字段字典。
- **白名单**：仅业务数据。**允许** parts、assemblies、bom（除 export）、documents、attachments(仅元数据)、configuration、custom_fields、ecos、ecrs。**拒绝** users、logs、admin、sync、auth、assistant 自身、**dashboard**（私人看板）。
- **附件**：只放元数据接口（列表/详情/convert-status/archive-tree），**排除二进制**（stream/download/direct-download/preview/gltf/extract-file）与 bom/export —— 这些返回文件，下载仍走现有下载工具给链接。
- 现有 7 个工具（search_entity、get_part_detail、get_assembly_detail、get_bom_tree、trace_bom、diff_bom、download_document/export_bom/create_document）**保留**为快捷通道。

## 非目标（YAGNI）

- 写操作（仍只读，GET-only）。
- B「多步技能/配方」与 C「跨会话学习记忆」——本期不做，列后期。
- 个性化/用户级记忆。

---

## ① 只读网关

### 工具

**`list_api_endpoints()`** → 返回白名单只读接口目录：
```json
{"endpoints": [
  {"path": "/api/parts/", "method": "GET", "summary": "...",
   "path_params": [], "query_params": ["skip","limit","search"]},
  ...
]}
```
数据来自 `app.openapi()`，经白名单过滤。目录是工具调用的返回值，不进每轮系统提示。

**`call_read_api(path, query?)`** → 模型按目录调用 GET 接口：
- 入参：`path`（如 `/api/parts/`，或带路径参数 `/api/parts/{id}` 已填好的实际路径）、`query`（dict，可选）。
- 执行：**进程内 ASGI 转发**。用 `httpx.AsyncClient(transport=ASGITransport(app))` 对自身 app 发起 GET，带 `Authorization: Bearer <当前用户 token>`。复用真实路由、`require_role`、crud、序列化。
- 在 agent 的同步工具执行上下文里通过 `asyncio.run(...)` 调用异步转发。

### 白名单实现

`api_gateway.py` 定义：
- `ALLOWED_PREFIXES`：业务路由前缀集合（`/api/parts`、`/api/assemblies`、`/api/bom`、`/api/documents`、`/api/v2/attachments`、`/api/configuration`、`/api/custom-fields`、`/api/ecos`、`/api/ecrs`）。实现时以各 router 实际 prefix 为准（实现首步用 `grep` 校准）。
- `DENIED_PATH_PATTERNS`：二进制/导出子路径模式（`/stream`、`/download`、`/direct-download`、`/preview`、`/gltf`、`/extract-file`、`/bom/export/`）。
- 过滤规则：仅 `method == GET` 且 `path` 前缀在 `ALLOWED_PREFIXES` 且不匹配任何 `DENIED_PATH_PATTERNS`。
- `is_allowed(path) -> bool`：`call_read_api` 执行前再校验一次（防止模型伪造未授权路径），不在白名单直接返回 `{"error": "该接口不在 AI 可读范围"}`。

### 安全

- 仅放行 GET → 天然只读。
- 权限由真实 deps 强制：转发带用户 token，admin-only 接口对非 admin 自动 403，原样回灌模型。
- 出境前过现有 `sanitize_for_llm`（剔除 cost/price/supplier 等敏感字段）。
- **体积防护**：转发结果序列化后若超 `ASSISTANT_API_MAX_CHARS`（默认 8000）字符，截断并附 `{"_truncated": true, "hint": "结果过大，请用 limit/search/skip 等参数缩小范围"}`。
- 转发超时（默认 15s）兜底，异常回灌为 `{"error": ...}`。

---

## ② 自生数据字典 / 知识层

### 内容来源

`knowledge.py` 构建并缓存（模块级缓存，重启刷新）：

1. **接口手册**：复用 `list_api_endpoints` 的目录数据。
2. **字段字典**：内省 SQLAlchemy 模型类（`app.models`）——每个核心实体的列名、类型、nullable。实体集合：`Part, Assembly, Document, BOMItem, DocumentAttachment, Configuration?, CustomFieldDefinition, CustomFieldValue, ECR, ECO`（以 `models.py` 实际类名为准，实现首步核对）。
3. **领域词汇表**（人工，静态文件 `knowledge_glossary.py` 或常量）：代码表达不出的语义。初稿由实现者从 `backend/app/models.py` 行内注释 + `项目说明/` 文档提炼，至少覆盖：
   - part / assembly / component 的关系与 child_type 取值（含 'component' 兼容 'assembly'）
   - BOM 父子结构、quantity 含义、软删除 `deleted_at`
   - **构型 configuration vs BOM** 的区别
   - status 常见取值（如 active 等）
   - document_links 结构 `[{id, document_id, category, sort_order}]`、revisions 版本数组
   - ECR（变更请求）/ECO（变更执行）的关系与状态流转概念

### 交付

- **系统提示精简速览**（`agent.py` 的 SYSTEM_PROMPT 追加）：一段紧凑文本，列出可读实体清单 + 3-5 条核心概念 + 指引"接口细节调 `list_api_endpoints`，字段含义调 `get_data_dictionary`"。控制在几百字以内，避免膨胀每轮提示。
- **`get_data_dictionary(entity?)`** 工具：
  - 无参 → 返回实体清单 + 词汇表概要。
  - 带 `entity`（如 `"part"`）→ 返回该实体字段字典 + 相关词汇 + 相关接口路径。

### 安全

字段字典与词汇表是元数据（结构/语义），不含真实业务数据，可直接给模型；不经脱敏（脱敏只针对真实数据值）。

---

## ③ Token 透传

- `routers/assistant.py` 的 `/chat` 端点增加 `token: str = Depends(oauth2_scheme)`（从 `auth` 导入 `oauth2_scheme`），传入 `run_agent`。
- `run_agent(messages, db, user, emit, token=None, llm=None, max_iters=None)` 新增 `token` 形参，注入工具执行上下文，供 `call_read_api` 转发使用。
- 工具执行签名保持 `execute(db, user, **args)`。网关工具额外需 token，**固定方案**：在 `REGISTRY` 的工具项上加可选标记 `"needs_token": True`；`agent.py` 分发时，若该工具 `needs_token`，则以关键字 `_token=token` 注入执行器（执行器签名 `execute(db, user, _token=None, **args)`）。仅 `call_read_api` 标记 `needs_token`。这样其余工具签名不变，互不影响。

---

## ④ 影响文件

- 新增：`backend/app/assistant/api_gateway.py`、`backend/app/assistant/knowledge.py`、`backend/app/assistant/knowledge_glossary.py`
- 改：`backend/app/assistant/tools.py`（注册 `list_api_endpoints`、`call_read_api`、`get_data_dictionary`）、`backend/app/assistant/agent.py`（系统提示注入速览 + 透传 token）、`backend/app/routers/assistant.py`（透传 token）
- 测试：`backend/tests/test_api_gateway.py`、`backend/tests/test_knowledge.py`、补 `backend/tests/test_tools.py`

## ⑤ 测试策略（pytest）

- **白名单过滤**：允许的业务路径通过；users/logs/admin/sync/dashboard 被拒；二进制子路径被拒。
- **call_read_api 转发权限**：构造带 token 的转发，admin 可读某业务接口、guest 对 admin-only 接口被 403（用 TestClient/ASGITransport，依赖覆盖 get_db）。
- **体积截断**：超阈值结果被截断并带 hint。
- **路径校验**：未授权 path 直接 `{"error": ...}`，不发起转发。
- **knowledge 字段字典**：覆盖核心实体、字段名/类型存在；`get_data_dictionary("part")` 返回该实体字段与相关接口。
- **速览注入**：SYSTEM_PROMPT 含实体清单关键词。

## ⑥ 配置项（.env）

```
ASSISTANT_API_MAX_CHARS=8000
ASSISTANT_API_TIMEOUT=15
```

## ⑦ 分阶段落地

1. `api_gateway.py`：白名单 + 目录构建 + `list_api_endpoints` 工具（不含转发）。
2. `call_read_api` 转发 + token 透传 + 体积/权限/路径校验。
3. `knowledge.py` + glossary + `get_data_dictionary` 工具。
4. SYSTEM_PROMPT 速览注入。
5. 配置项、测试补全、浏览器实测。
