# myPDM 飞书免登（双飞书入口）设计文档

> 日期：2026-08-07
> 状态：已与用户确认（后端/前端/数据流/错误处理/验证方案）

## 1. 背景与目标

myPDM 增加飞书免密登录，支持两个飞书企业应用入口并存：

- 「飞书登录」（provider = `feishu`，普通飞书自建应用）
- 「飞书登录（EH）」（provider = `feishu_eh`，EH 企业自建应用）

目标：

- 登录页增加两个飞书登录按钮（浏览器 OAuth 2.0 授权码流程）。
- 飞书客户端内打开页面时走 JSAPI 免登（`tt.requestAccess`）自动登录。
- 首次登录按 `union_id` 自动建号（用户已确认方案 A），默认角色 `guest`。
- 两个入口的身份按 provider 隔离存储，互不混用 union_id。
- 复用 myPDM 现有 JWT 会话体系，不改变现有账号密码登录。

## 2. 范围

### 包含

- 后端飞书客户端封装、绑定表、认证路由、自动建号。
- 前端登录页双按钮、JSAPI 免登、OAuth 回调页。
- `.env` / `.env.example` 配置。
- 后端 pytest 单测（mock 飞书接口）。

### 不包含（明确排除）

- 本次**不修** main.py 启动迁移中“表不存在被当缺列”导致迁移中止的 bug（用户另行处理）。
- 不抽取跨系统公共 `feishu_auth` 库。
- 不部署共享用户目录服务。
- 不做管理端绑定关系 UI。
- 不做统一登出 / 异常监控。

## 3. 架构

```
浏览器 / 飞书客户端
        │
        ▼
myPDM 前端（登录页按钮 / JSAPI）
        │  OAuth authorize / jsapi code
        ▼
myPDM 后端 /api/auth/feishu/*
        │  app_id + app_secret + code
        ▼
飞书开放平台（authen/v1/authorize、authen/v2/oauth/token、
              authen/v1/access_token、authen/v1/user_info）
```

- 每个入口 = 独立 OAuth 客户端配置（app_id / app_secret / redirect_uri）。
- 用户身份按 `(provider, union_id)` 关联到 myPDM `users` 表。
- 会话仍由 myPDM 签发 JWT（与现有密码登录一致）。

## 4. 后端设计

### 4.1 飞书客户端 `backend/app/feishu_client.py`

基于 `httpx` 封装（依赖已存在于 requirements.txt）：

- `get_provider(name)`：按 `feishu` / `feishu_eh` 读取环境变量配置。
- `build_authorize_url(provider, state, redirect_uri)`：拼 `https://open.feishu.cn/open-apis/authen/v1/authorize` 授权地址（不带 scope，参考 new-api 踩坑）。
- `exchange_oauth_code(provider, code, redirect_uri)`：OAuth 授权码走 `POST /authen/v2/oauth/token`（扁平结构，body 携带 client 凭据）。
- `exchange_jsapi_code(provider, code)`：JSAPI 授权码走 `POST /authen/v1/access_token`（不需要 redirect_uri）。
- `get_user_info(provider, user_access_token)`：`GET /authen/v1/user_info`，返回 `union_id` / `open_id` / `name` / `avatar_url` / `email`。
- 统一异常 `FeishuError(code, message)`；网络/HTTP/非 0 code 均转为可读错误。

### 4.2 绑定表 `user_feishu_bindings`

模型添加在 `backend/app/models.py`（User 旁）：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `provider` | `feishu` / `feishu_eh` |
| `union_id` | 飞书全局身份键 |
| `open_id` | 该应用下的 open_id |
| `name` | 姓名（每次登录同步） |
| `avatar_url` | 头像（每次登录同步） |
| `user_id` | FK → users.id，ON DELETE CASCADE |
| `created_at` / `updated_at` | 时间戳 |

唯一约束：`(provider, union_id)`。

DDL 写入 `initdb/init.sql`（新环境生效）；当前已存在的数据库在实施时**手动执行一次建表 SQL**（不动 main.py 迁移逻辑，本次不修迁移 bug）。

### 4.3 路由 `/api/auth/feishu/*`

新增 `backend/app/routers/feishu.py`，挂载前缀 `/api/auth/feishu`：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/config` | GET | 公开配置：两个 provider 的显示名、app_id、jsapi 是否启用；不含 secret；未配置的 provider 不下发 |
| `/authorize` | GET | 入参 `provider`；生成签名 state（JWT，10 分钟有效，含 provider），302 到飞书授权页 |
| `/callback` | GET | 校验 state → 换 token → 拉用户 → 找/建用户 → 签发 JWT → 302 到前端 `/feishu-callback#access_token=...&refresh_token=...` |
| `/jsapi` | POST | 入参 `{provider, code}`；换身份、找/建用户，直接返回 Token JSON |

### 4.4 建号与登录规则

1. 按 `(provider, union_id)` 查绑定：
   - 存在 → 校验 `users.status == 'active'`：启用则登录；禁用则 403「账号已禁用」。
   - 不存在 → 自动建用户 + 绑定，然后登录。
2. 自动建号规则：
   - `username`：优先飞书姓名（清洗后长度 >= 3 且不重名），否则 `feishu_<6位随机>`；仍撞名则追加随机后缀。
   - `real_name`：飞书姓名；`role=guest`；`status=active`；`must_change_password=False`。
   - `password_hash`：随机密码的哈希（不可用密码登录，管理员可重置）。
3. 每次登录同步绑定表的 `name` / `avatar_url`，并同步 `users.real_name`（有值且来自飞书时）。
4. 签发现有 `create_access_token` / `create_refresh_token`，响应结构与 `/auth/token` 一致。

### 4.5 环境变量

```
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_EH_APP_ID=
FEISHU_EH_APP_SECRET=
FEISHU_REDIRECT_BASE=https://192.168.61.105:8080
```

回调地址由 `FEISHU_REDIRECT_BASE + /api/auth/feishu/callback` 生成（OAuth 换 token 与授权跳转使用同一地址，避免 redirect_uri 不一致）。`FEISHU_EH_*` 未配置时，EH 按钮不下发。

## 5. 前端设计

### 5.1 登录页 `frontend/src/pages/Login.tsx`

- 账号密码表单下方加分隔线「或」和两个按钮：「飞书登录」「飞书登录（EH）」。
- 挂载时调 `/api/auth/feishu/config`，按返回的 provider 渲染按钮（未配置不显示）。
- 点击按钮：`window.location.href = '/api/auth/feishu/authorize?provider=<key>'`。

### 5.2 JSAPI 免登

- 登录页加载时按 config 判断当前 provider 是否启用 JSAPI；默认 provider 为 `feishu`，URL 带 `?feishu_provider=feishu_eh` 时用 EH。
- 引入飞书 H5 JSSDK（`h5-js-sdk-1.5.45.js`），`window.h5sdk.ready` 后调 `tt.requestAccess({ appID, scopeList: [], success, fail })`。
- 兼容解析授权码字段：`authCode` / `code` / `auth_code` / `data` 嵌套。
- 成功 POST `/api/auth/feishu/jsapi {provider, code}` → 存 token → `/auth/me` → 跳转；失败在登录页展示错误。
- 普通浏览器不触发 JSAPI，只显示按钮。

### 5.3 OAuth 回调页 `/feishu-callback`

- 读取 `location.hash` 中的 `access_token` / `refresh_token` / `error`。
- 成功：存 token（复用现有 auth store / localStorage），调 `/auth/me`，跳首页。
- 失败：跳回 `/login` 并展示错误。
- token 只放 URL fragment，不落服务端日志。

### 5.4 API 客户端

`frontend/src/services/api.ts` 的 `authApi` 增加：

- `feishuConfig()`
- `feishuJsapiLogin(provider, code)`

## 6. 数据流

### OAuth（浏览器）

按钮 → `GET /authorize?provider=...` → 302 飞书授权页 → 飞书回跳 `/callback?code&state` → 校验 state → v2 换 token → user_info → 找/建用户 → 签发 JWT → 302 `/feishu-callback#access_token=...` → SPA 存 token 进首页。

### JSAPI（飞书客户端内）

页面加载 → h5sdk.ready → `tt.requestAccess` → 授权码 → `POST /jsapi {provider, code}` → v1 换 token → user_info → 找/建用户 → 返回 JWT JSON → 前端存 token 进首页。

## 7. 错误处理

| 场景 | 处理 |
| --- | --- |
| 飞书接口错误 / 授权码无效或过期 / 网络失败 | 可读中文错误；OAuth 通过 `#error=` 带回登录页，JSAPI 返回 JSON 错误 |
| state 缺失 / 无效 / 过期 | 拒绝，不换 token |
| 账号已禁用 | 403「账号已禁用」 |
| provider 未配置 | 按钮不显示；接口返回 400 |
| 飞书无邮箱 | 不要求补邮箱（本次不做补邮箱流程） |

## 8. 安全

- app_secret 只存后端 `.env`，不进前端、不提交 git、不写日志。
- code → token → user_info 全部在服务端完成，绝不信任前端传身份信息。
- state 为签名 JWT，10 分钟过期，防 CSRF。
- 飞书 `user_access_token` 不在前端停留、不打印日志。
- 本系统 JWT 只在回调时经 URL fragment 传递（不落服务器日志），随后存入前端存储。

## 9. 测试

### 后端 pytest

- feishu_client：mock httpx，覆盖换 token（v1/v2）、user_info、FeishuError。
- callback：state 有效/无效/过期、自动建号、用户名撞名兜底、禁用账号拒绝。
- jsapi：正常登录、错误 code。
- config：未配置 provider 不下发。

### 前端

- 手动验证：登录页双按钮渲染、OAuth 全流程、JSAPI（飞书开发者工具/真机）、错误提示。
- 不新增前端单测（本功能以集成验证为主）。

### 联调步骤

1. 用户提供非 EH 的 App ID/Secret → 填入 `.env`。
2. 用户在飞书后台登记回调 `https://192.168.61.105:8080/api/auth/feishu/callback`、开通 `contact:user.base:readonly`、配置可用范围、发布。
3. 验证浏览器 OAuth（非 EH）。
4. EH 凭据到位后登记 `.../api/auth/feishu_eh/callback`，验证 EH 按钮。
5. JSAPI 用飞书开发者工具 / 飞书客户端验证。

## 10. 交付物

- `backend/app/feishu_client.py`
- `backend/app/models.py`（新增 UserFeishuBinding）
- `backend/app/routers/feishu.py` + `main.py` 注册
- `initdb/init.sql`（绑定表 DDL）+ 当前库手动建表
- `frontend/src/pages/Login.tsx`、`frontend/src/pages/FeishuCallback.tsx`、`frontend/src/App.tsx`（路由）
- `frontend/src/services/api.ts`（authApi 扩展）
- `.env` / `.env.example`
- 后端 pytest 用例
