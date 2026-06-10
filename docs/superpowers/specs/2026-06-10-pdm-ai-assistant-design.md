# PDM AI 助手 — 设计文档

- **日期**: 2026-06-10
- **状态**: 已评审，待实现计划
- **作者**: 与 AI 协作（brainstorming）
- **关联系统**: myPDM (React + FastAPI BOM/PDM 系统)

---

## 1. 目标

在现有 PDM 系统上增加一个**悬浮聊天式 AI 助手**：用户用自然语言提出需求，后端 Agent 编排大模型，调用「取数工具」获取 BOM/图文档等数据，由大模型完成**分析、推理与文档撰写**，结果以富交互卡片在聊天窗口中呈现。

**核心理念**：工具负责取数，大模型负责分析与创作。现有 API 作为「快速精确通道」，但不限制大模型直接分析原始数据（例如把两张 BOM 表交给模型自行解读差异）。

### v1 范围（四条主链路）

1. **查询类（只读）**：搜零件/部件、查 BOM 树、BOM 反查、图文档反查。
2. **对比类**：BOM 对比（小 BOM 直接喂原始表给模型分析；大 BOM 走服务端预处理）。
3. **下载/导出类**：图文档下载、BOM 导出、附件下载。
4. **文档生成**：大模型撰写文档，**后端组装为成品产物**（v1 输出 Markdown），前端预览 + 下载。

### v1 明确不做（YAGNI）

- 写操作（创建/编辑零件、维护 BOM 关系）——风险高，二期。
- 变更对比（`get_change_data`）——二期。
- Word/Excel/PDF 文档导出——后端预留接口，二期。
- 前端直连大模型——架构上排除（见 §3）。

---

## 2. 选型决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 大模型 | 云端 API（DeepSeek / 通义 / Kimi，OpenAI 兼容） | function calling 成熟、成本低、接入快 |
| 编排位置 | **后端** FastAPI | 密钥不外泄、权限复用、合规边界集中、工具直接复用现有 crud |
| 传输 | SSE 流式 | 边分析边输出，体验好 |
| 结果呈现 | 富交互卡片 | 复用现有 BOM 表格/下载组件 |
| 文档产物 | 后端生成成品 → 前端展示 | 内容统一脱敏排版、有真实 doc_id 与下载链接、未来换渲染器不动前端协议 |
| v1 文档格式 | Markdown | 最轻量，先落地 |

---

## 3. 整体架构

```
┌─ 前端：悬浮聊天窗（新组件）
│   FloatingAssistant + useAssistantChat(SSE) + 富卡片渲染
│
└─► POST /api/assistant/chat  (SSE 流式)
        │
        ▼  后端 Agent 编排循环
   ┌────────────────────────────────────────────┐
   │ 1. 用户消息 + 工具清单 → 大模型              │
   │ 2. 模型决定：调取数工具 or 直接分析/撰写      │
   │ 3. 执行工具（强制注入当前用户身份 + 权限校验）│
   │ 4. 取数结果回灌模型                           │
   │ 5. 模型推理/分析/调 create_document 撰写文档   │
   │ 6. 流式产出（text 增量 / 工具状态 / 卡片）     │
   │ 7. 循环直到最终答复（最多 ASSISTANT_MAX_ITERS）│
   └────────────────────────────────────────────┘
```

**为何后端编排（而非前端直连大模型）**：
- API Key 仅存后端，不泄露。
- 每个工具执行前走现有 `require_role()`，AI 不可能越权（访客仍只读）。
- 发往大模型前的字段白名单/脱敏集中在一处。
- 工具直接调现有 crud/router 逻辑，业务零重复。

---

## 4. 工具集（v1 给大模型的「手」）

工具刻意以**取数为主**，把分析留给模型。每个工具有 JSON Schema 描述，注册在 `tools.py`。

| 工具 | 入参 | 作用 | 复用 |
|---|---|---|---|
| `search_entity` | `keyword, type?` | 把"A 零件""某部件"解析成真实 ID（消歧关键） | parts/assemblies 搜索 |
| `get_part_detail` | `part_id` | 取零件详情 | parts crud |
| `get_assembly_detail` | `assembly_id` | 取部件详情 | assemblies crud |
| `get_bom_tree` | `type, id` | 取完整 BOM 树原始数据 | `/api/bom/tree` |
| `trace_bom` | `part_id` | BOM 反查（被谁用） | `/api/bom/trace` |
| `diff_bom` | `left, right` | 服务端预算差异，**只回变化行**（大 BOM 省 token） | `/api/bom/compare` 逻辑 |
| `export_bom` | `type, id` | 返回带 token 的 BOM 导出下载链接 | 现有导出 |
| `download_document` | `doc_id / attachment_id` | 返回带 token 的下载链接（文件不经大模型） | 附件 V2 链接 |
| `create_document` | `title, content, format='md'` | 大模型把成稿传入，**后端组装文档 → 存 artifacts → 返回 doc_id + 预览内容 + 下载链接** | 新增 document_builder |

### BOM 对比双通道

- **小 BOM**（节点数 ≤ `ASSISTANT_BOM_RAW_THRESHOLD`，默认建议 200）→ 模型调 `get_bom_tree` 取两张表原始数据，自由分析解读差异、影响、原因。
- **大 BOM**（超阈值）→ 自动改走 `diff_bom`，服务端先算结构化差异，仅把变化行喂模型分析，并在回复中告知用户"已对超大 BOM 做预处理"。

阈值由后端在工具执行层判断并提示模型，而非依赖模型自觉。

---

## 5. 结果呈现（富卡片）

SSE 推送的消息分类型，前端复用现有组件渲染：

| 卡片类型 | 数据源 | 渲染 |
|---|---|---|
| `text` | 模型流式文本 | 自然语言分析（打字机效果） |
| `table` | 工具返回的结构化数据 | BOM 表 / 对比表，复用现有表格组件 |
| `markdown_doc` | **后端 create_document 产物**（doc_id / 预览内容 / 下载 URL） | 在线预览 + 复制 + 下载 .md |
| `download` | 带 token 链接 | 下载按钮（走现有 V2 下载） |
| `link` | 实体 ID | 跳转现有详情页 |

模型分析（如"本次变更新增 3 个紧固件、去掉旧电机座，可能影响装配工序…"）走 `text` 流式；表格/文档/下载走对应卡片。

---

## 6. 安全与合规

- **权限复用**：每个工具执行前注入当前已登录用户，走现有角色校验；下载/导出类额外查 `canDownload`。无权限时，工具返回拒绝信息给模型，模型友好告知用户。
- **越权不可能**：访客即使"让 AI 帮我下载"，也在工具层被拦截。
- **数据出境**：发往大模型前经 `sanitizer.py` 字段白名单/脱敏，敏感字段（如成本、供应商等，按配置）可剔除。集中一处便于审计。
- **防失控**：单次请求工具调用上限 `ASSISTANT_MAX_ITERS`（默认 8）+ 整体超时，避免死循环烧 token。
- **下载产物**：`create_document` 落地的文件存 `uploads/assistant_artifacts/`，通过带 token 的端点下载，受同样权限约束。

---

## 7. 新增代码结构

### 后端

```
backend/app/
├── routers/
│   └── assistant.py            # POST /api/assistant/chat (SSE)
│                               # GET  /api/assistant/artifacts/{doc_id}/download
└── assistant/
    ├── __init__.py
    ├── agent.py                # 编排循环（工具调用 + 流式）
    ├── tools.py                # 工具注册表 + JSON Schema + 执行分发
    ├── llm_client.py           # DeepSeek(OpenAI 兼容) 客户端封装
    ├── document_builder.py     # 文档组装 + 落地 artifacts（v1: Markdown；预留 docx/xlsx/pdf）
    └── sanitizer.py            # 字段白名单 / 脱敏
```

`.env` 新增：
```
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ASSISTANT_MAX_ITERS=8
ASSISTANT_BOM_RAW_THRESHOLD=200
```

新增依赖：`openai`（OpenAI 兼容 SDK，调 DeepSeek）。

### 前端

```
frontend/src/
├── components/assistant/
│   ├── FloatingAssistant.tsx   # 悬浮按钮 + 可展开面板
│   ├── MessageList.tsx         # 消息流
│   └── cards/
│       ├── TextCard.tsx
│       ├── TableCard.tsx       # 复用现有 BOM 表格组件
│       ├── MarkdownCard.tsx    # 文档预览 + 下载
│       ├── DownloadCard.tsx
│       └── LinkCard.tsx
├── hooks/
│   └── useAssistantChat.ts     # SSE 客户端，解析事件流
├── stores/
│   └── assistantStore.ts       # Zustand：会话历史、面板开关、流式状态
└── services/
    └── assistantApi.ts         # 建立 SSE 连接、下载产物
```

---

## 8. SSE 事件协议

后端按行推送 JSON 事件（`event: <type>\ndata: <json>`）：

| 事件 | data | 用途 |
|---|---|---|
| `token` | `{ delta: string }` | 文本增量 |
| `tool_start` | `{ name, args_summary }` | 显示"正在查询 BOM 树…" |
| `tool_end` | `{ name, ok }` | 工具完成 |
| `card` | `{ type, payload }` | 推送富卡片（table/markdown_doc/download/link） |
| `done` | `{}` | 本轮结束 |
| `error` | `{ message }` | 友好错误 |

---

## 9. 错误处理

- **LLM 故障**：捕获后发 `error` 事件，前端展示友好提示，不崩溃。
- **工具报错**：作为 tool result 回灌模型，由模型决定重试或向用户解释（而非直接中断会话）。
- **超限/超时**：达到 `ASSISTANT_MAX_ITERS` 或超时，发 `error` 兜底并结束本轮。
- **权限拒绝**：工具返回结构化拒绝，模型转述为友好说明。

---

## 10. 测试策略

### 后端

- **工具单测**：每个工具 mock DB，验证入参解析、权限校验、返回结构。
- **编排循环**：mock LLM，验证多轮工具调用、上限/超时兜底、错误回灌。
- **权限测试**：访客调下载类工具被拒；不同角色行为正确。
- **脱敏测试**：敏感字段确实被剔除后才出境。
- **document_builder**：Markdown 产物落地与下载链接正确。

### 前端

- 各卡片类型渲染测试（text/table/markdown_doc/download/link）。
- SSE 事件解析与流式拼接。
- 面板开关、会话状态。

---

## 11. 分阶段落地建议

1. **骨架**：assistant 路由 + SSE + llm_client + 最小工具（`search_entity` + `get_bom_tree`）+ 前端悬浮窗 text 流式，先跑通"问一句、模型取数回答"。
2. **对比与卡片**：`diff_bom` 双通道 + TableCard。
3. **下载/导出**：`export_bom` / `download_document` + DownloadCard + 权限。
4. **文档生成**：`create_document` + document_builder + MarkdownCard + artifacts 下载端点。
5. **合规与硬化**：sanitizer、上限/超时、错误兜底、测试补全。

---

## 12. 开放问题 / 后续

- 会话历史是否持久化（v1 可仅内存/前端 session，二期入库）。
- 多轮上下文长度管理（超长会话裁剪策略）。
- 二期：写操作（需二次确认 UX）、变更对比、Word/Excel/PDF 导出。
