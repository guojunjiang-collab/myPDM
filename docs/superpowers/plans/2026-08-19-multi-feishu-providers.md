# 多路飞书登录（多企业）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 分步实现。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 解除当前飞书登录仅支持「feishu / feishu_eh」两路写死的限制，改为由环境变量驱动的动态 provider 列表，允许同一 PDM 系统接入任意多个企业飞书应用（如 `corpA`、`corpB`…），每个企业一套 AppID/AppSecret，登录页与绑定面板自动按配置渲染。

**Architecture:**
- 后端 `feishu_client.py` 的 `list_providers()` 由「枚举两个固定名」改为「读取 `FEISHU_PROVIDERS` 逗号列表 → 逐个按 key 解析环境变量」。provider key 为**任意字符串**，不再为任何具体公司（如 `eh`）保留特殊名：
  - `feishu` → 前缀 `FEISHU_`（系统主飞书入口，显示名默认「飞书登录」）
  - 其它任意 key（如 `corpA`、`companyB`）→ 前缀 `FEISHU_<KEY大写>_`
- **不使用 `feishu_eh` 这类带有具体公司品牌的含义 key**：旧部署中写死的 `feishu_eh` 仅作为过渡，新方案一律用中性/业务命名（如 `companyB`）替代。
- 每个 provider 支持 `APP_ID` / `APP_SECRET` / `NAME`（显示名）/ 可选 `REDIRECT_BASE`。
- 绑定表 `user_feishu_bindings(provider, union_id)` 已是唯一约束，**无需改表**；不同企业 union_id 命名空间天然隔离，互不冲突。
- 前端 `Login.tsx` 与 `FeishuBindPanel.tsx` 已经遍历 `feishuConfig().providers` 动态渲染，**基本无需改动**（仅帮助文案/自动触发默认项确认）。
- `docker-compose.yml` 后端改为 `env_file: .env` 透传全部变量，避免每加一个企业就要改编排文件。

**Tech Stack:** FastAPI + SQLAlchemy 2.0（后端）；React 18 + TypeScript（前端，无实质改动）；环境变量配置。

**Specs:** 无新增独立 spec 文件（本计划即实现依据）。

## Global Constraints

- **不使用 `feishu_eh` 这类含具体公司品牌的 key**，provider key 一律中性/业务命名。
- 向后兼容：不设置 `FEISHU_PROVIDERS` 时默认仅 `feishu`（主入口）；仍仅当对应 `APP_ID/APP_SECRET` 存在时才出现在 `config` 中。
- 显示名 `NAME` 未配置时：key=`feishu` → `飞书登录`；其它 → `飞书登录（{key}）`（建议通过 `NAME` 显式配置可读名称，如「飞书登录（甲公司）」）。
- 每个飞书开放平台应用须将回调域配置为 `{REDIRECT_BASE}/api/auth/feishu/callback`，多企业共用同一部署域名时回调地址相同，靠 `state/provider` 参数区分。
- 代码注释中文；后端改动后 `docker compose up -d backend`，前端改动后 `npm run build`。
- 不引入新的数据表、不引入管理后台 UI（provider 通过环境变量配置，符合现有飞书配置范式）。

---

### Task 1: 后端动态 provider 解析（feishu_client.py）

**Files:**
- Modify: `backend/app/feishu_client.py`

**Changes:**
- 新增 `provider_env_prefix(key: str) -> str`：
  ```python
  def provider_env_prefix(key: str) -> str:
      if key == "feishu":
          return "FEISHU_"
      if key.startswith("feishu_"):
          return f"FEISHU_{key[len('feishu_'):].upper()}_"
      return f"FEISHU_{key.upper()}_"
  ```
- 新增 `list_provider_keys() -> list[str]`：
  ```python
  def list_provider_keys() -> list[str]:
      # 未设置时默认仅主飞书入口；设置后按列表自动启用多路（含 feishu 自身）
      raw = os.getenv("FEISHU_PROVIDERS", "feishu")
      return [k.strip() for k in raw.split(",") if k.strip()]
  ```
- 改写 `get_provider(name)`：用 `provider_env_prefix(name)` 取 `APP_ID`/`APP_SECRET`，未配置返回 `None`；`redirect_base` 支持 `{PREFIX}REDIRECT_BASE`，缺省回退 `FEISHU_REDIRECT_BASE`。
- 改写 `list_providers()`：`for name in list_provider_keys(): if (p := get_provider(name)): yield p`。

- [ ] 实现 `provider_env_prefix` / `list_provider_keys`
- [ ] 改写 `get_provider` 使用前缀解析 + 可选 `REDIRECT_BASE`
- [ ] 改写 `list_providers` 走动态 key 列表

### Task 2: 路由 config 动态显示名（routers/feishu.py）

**Files:**
- Modify: `backend/app/routers/feishu.py`

**Changes:**
- `/config` 的 `name` 改为从对应前缀 `NAME` 读取：
  ```python
  from ..feishu_client import provider_env_prefix
  def _provider_display_name(p) -> str:
      name = os.getenv(f"{provider_env_prefix(p.name)}NAME")
      if name:
          return name
      if p.name == "feishu":
          return "飞书登录"
      return f"飞书登录（{p.name}）"
  ```
- `authorize` / `callback` / `bind-intent` / `bindings` / `unbind` 已按 `provider` 参数工作，无需改动。

- [ ] 实现 `_provider_display_name` 并入 `/config`
- [ ] 确认通用 `NAME` 机制替代原有 `FEISHU_EH_NAME` 特例（移除 `feishu_eh` 专属逻辑）

### Task 3: docker-compose 透传全部环境变量

**Files:**
- Modify: `docker-compose.yml`

**Changes:**
- 后端 `environment` 段保留必填项（`JWT_SECRET`/`REDIS_PASSWORD` 等），将飞书相关逐项声明改为 `env_file` 透传，避免新增企业时改编排：
  ```yaml
  env_file:
    - .env
  ```
- 保留 `JWT_SECRET` / `REDIS_PASSWORD` 用 `${...:?...}` 强校验（或也放 .env 由 env_file 提供）。
- 移除原先逐项列出的 `FEISHU_APP_ID` / `FEISHU_EH_*` / `FEISHU_REDIRECT_BASE` 重复声明（由 env_file 覆盖）。

- [ ] 后端服务增加 `env_file: .env`
- [ ] 清理重复的飞书环境变量逐项声明

### Task 4: 前端确认与帮助文案（基本无代码改动）

**Files:**
- Verify: `frontend/src/pages/Login.tsx`（已遍历 `feishuConfig().providers`，按钮动态渲染；客户端内自动免登默认选 `feishu`，无需改）
- Verify: `frontend/src/components/FeishuBindPanel.tsx`（已动态渲染，无需改）
- Modify(optional): `frontend/src/pages/Help.tsx` 将「飞书登录（EH）」示例改为「多路飞书入口（名称可配置）」说明。

- [ ] 确认 Login/FeishuBindPanel 对 N 个 provider 渲染正确
- [ ] 更新 Help 文案说明多企业/多路配置

### Task 5: 文档与验证

**Files:**
- Modify: `docs/微信登录指南.md` 不涉及；新增/更新飞书多路说明于 `docs/` 或 Help。
- 验证：
  ```powershell
  # .env 增加
  FEISHU_PROVIDERS=feishu,feishu_eh,corpA
  FEISHU_CORPA_APP_ID=cli_corpA_xxx
  FEISHU_CORPA_APP_SECRET=xxx
  FEISHU_CORPA_NAME=飞书登录（甲公司）

  docker compose up -d backend
  curl.exe -sk https://localhost:8080/api/auth/feishu/config
  # 期望返回 3 个 provider，corpA 显示「飞书登录（甲公司）」
  ```

- [ ] 编写/更新配置说明文档
- [ ] 本地起多 provider 验证 `config` 与扫码回调（至少两路真实或 mock）

---

## 配置示例（.env）

```dotenv
# ── 单路（默认，无需设置 FEISHU_PROVIDERS）──
FEISHU_APP_ID=cli_default_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_BASE=https://你的域名:8080

# ── 多路：设置 FEISHU_PROVIDERS 后自动启用多企业入口 ──
# 逗号分隔的 provider key（feishu 为主入口，其余为各企业中性命名，不含具体公司品牌）
FEISHU_PROVIDERS=feishu,companyB,companyC

# 主入口（前缀 FEISHU_）
FEISHU_APP_ID=cli_default_xxx
FEISHU_APP_SECRET=xxx

# 第二路（前缀 FEISHU_COMPANYB_）
FEISHU_COMPANYB_APP_ID=cli_companyb_xxx
FEISHU_COMPANYB_APP_SECRET=xxx
FEISHU_COMPANYB_NAME=飞书登录（乙公司）

# 第三路（前缀 FEISHU_COMPANYC_）
FEISHU_COMPANYC_APP_ID=cli_companyc_xxx
FEISHU_COMPANYC_APP_SECRET=xxx
FEISHU_COMPANYC_NAME=飞书登录（丙公司）
```

> 未设置 `FEISHU_PROVIDERS` 时系统仅启用主飞书入口（单路）；一旦设置即按列表自动启用对应多路，每个 key 对应一套 `FEISHU_<KEY大写>_APP_ID/APP_SECRET/NAME`。

每个飞书开放平台应用均需在后台把「授权回调域」配为 `你的域名:8080`，回调地址统一为 `https://你的域名:8080/api/auth/feishu/callback`，系统靠 `provider` 参数区分企业。
