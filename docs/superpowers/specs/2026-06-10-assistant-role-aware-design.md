# AI 对话角色感知 — 设计

- **日期**: 2026-06-10
- **状态**: 已评审，待实现计划
- **关联**: [全量只读网关+数据字典](2026-06-10-assistant-read-gateway-knowledge-design.md)

## 目标

让用户发起的 AI 对话感知当前用户角色，**按其权限提供相应的读取操作功能**：AI 只看到、只提供该角色权限范围内的读取接口，并在系统提示中知晓角色与能力边界，无权的操作礼貌说明而非试错。

**现状**：网关已用用户 JWT 转发，越权接口运行时被真实 `require_role` 拒（403）；下载/导出工具已按 `DOWNLOAD_ROLES` 门控 guest。**缺口**：AI 事先不知道用户角色，`list_api_endpoints` 不分角色地列出全部业务接口，导致模型可能试错或呈现用不了的能力。

## 角色与读取能力（四档）

| 角色 | 读取能力描述（注入提示用） |
|---|---|
| admin | 全部数据与操作 |
| engineer | 查看、编辑（无删除）；可下载/导出 |
| production | 查看、下载、导出；不可编辑删除 |
| guest | 仅查看；**不可下载/导出** |

> 本功能仅作用于读取场景；编辑/删除仍由后端权限强制，不在 AI v1 范围。

## 方案：接口目录过滤 + 提示注入

### ① 角色提取（`api_gateway.py`）

- `roles_for_route(route) -> set[str] | None`：遍历 FastAPI 路由的 `dependant`（递归 `.dependencies`），找到 `__qualname__` 以 `require_role.<locals>.checker` 结尾的依赖，从其 `__closure__` 取出捕获的角色列表（list/tuple/set of str）。找不到角色门返回 `None`。
  - **已实测**：在真实 app 上对 `/api/parts/`（四角色）、`/api/bom/tree/...`（无 guest）等读出的角色与源码一致。
- `endpoint_roles_map() -> dict[str, set[str]]`：遍历 `app.routes` 的 `APIRoute`（method 含 GET），构建 `{path: roles}`，模块级缓存（首次构建后复用，重启刷新）。

### ② 接口目录按角色过滤

- `filter_catalog_by_role(catalog, role, roles_map) -> list`：保留满足「`path` 无角色门（roles 为 None）或 `role in roles`」的条目。纯函数，便于单测。
- `list_api_endpoints(db, user)`（已有 user 参数，无需改签名）：在白名单目录基础上调用 `filter_catalog_by_role(..., user.role, endpoint_roles_map())`，返回当前角色可访问的接口。
  - 结果包含层级关系：guest ⊆ production ⊆ admin。

### ③ 系统提示注入角色 + 能力

- `knowledge_glossary.py` 新增 `ROLE_CAPABILITIES = {"admin": "...", "engineer": "...", "production": "...", "guest": "..."}`（上表四档文案）。
- `agent.py` 的 `run_agent` 组装系统消息时，在系统内容后追加一行（用当前 `user.role`）：
  > 当前用户角色：{role}（{ROLE_CAPABILITIES[role]}）。只提供该角色权限范围内的读取操作；遇到无权限的操作，礼貌说明而非尝试。
- 未知角色回退为通用文案（不报错）。

### ④ 运行时兜底（已存在，不改）

网关 `call_read_api` 用用户 token 转发 → 真实 `require_role` 强制；越权 403 原样回灌模型并转述。下载/导出工具已门控 guest。即使模型异常构造越权路径，运行时仍拦住。

## 非目标（YAGNI）

- 不在 `call_read_api` 做路径模板匹配的角色预校验（运行时 403 + 目录过滤已覆盖，避免脆弱的模板匹配）。
- 不改写操作权限。
- 不做角色级的字段脱敏差异（脱敏仍统一按 `sanitize_for_llm`）。

## 影响文件

- 改 `backend/app/assistant/api_gateway.py`（`roles_for_route`、`endpoint_roles_map`、`filter_catalog_by_role`，`list_api_endpoints` 接入过滤）
- 改 `backend/app/assistant/agent.py`（系统消息按角色注入能力行）
- 改 `backend/app/assistant/knowledge_glossary.py`（`ROLE_CAPABILITIES`）
- 测试 `backend/tests/test_api_gateway.py`、`backend/tests/test_agent.py`

## 测试策略（pytest）

- `roles_for_route`：对真实 app 的已知路由（如 `/api/parts/`）读出包含 guest；对 `/api/bom/tree/...` 读出不含 guest。（导入 `app.main`）
- `filter_catalog_by_role`（纯函数）：给定 roles_map，guest 过滤后条目数 < admin；无角色门条目保留。
- `list_api_endpoints` 按角色：用 `guest_user` 返回的目录是 `engineer_user` 的子集。
- 系统提示注入：用 fake LLM 捕获 `run_agent` 组装的系统消息，断言含当前角色与其能力文案；guest 的消息含「不可下载」。

## 落地顺序

1. `roles_for_route` + `endpoint_roles_map` + `filter_catalog_by_role`。
2. `list_api_endpoints` 接入按角色过滤。
3. `ROLE_CAPABILITIES` + `run_agent` 系统消息注入。
4. 测试补全 + 部署 + 浏览器实测（不同角色登录看 AI 行为差异）。
