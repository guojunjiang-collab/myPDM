# 飞书免登与已有用户关联（自助绑定）设计

日期：2026-08-07
分支：`feat/feishu-bind-existing-user`

## 1. 背景与目标

myPDM 已上线飞书免登（普通飞书 `feishu` + EH 飞书 `feishu_eh` 双 provider），首次免登会自动创建 `guest` 账号。当前问题：**已有账号（含角色、数据）的用户用飞书登录时，会得到一个新的 guest 账号，而不是自己的原账号**。

目标：已登录用户可在「系统设置」中把飞书身份**自助绑定**到自己账号，之后飞书免登直接进入原账号（角色、数据保持不变）。

成功标准：
- 已有用户绑定后，飞书免登进入原账号；
- 已绑定身份被其他账号绑定时，新绑定请求被拒绝；
- 误产生的 guest 绑定被原账号接管后，guest 被停用且数据保留；
- 无需管理员介入即可完成上述流程。

## 2. 需求与规则

### 2.1 功能范围

- 入口：系统设置页新增「飞书绑定」tab，位于「修改密码」之后，所有角色可用。
- 每个已配置的 provider（普通飞书 / EH）独立展示与绑定。
- 一个账号可以分别绑定 `feishu` 和 `feishu_eh`。
- **不做解绑**；绑定错误无法自助纠正，需后续管理功能支持（本期不做）。

### 2.2 绑定规则

以 `(provider, union_id)` 查询现有绑定：

| 现状 | 处理 |
| --- | --- |
| 无绑定 | 新建绑定到当前用户 |
| 已绑定当前用户 | 幂等成功，刷新姓名/头像 |
| 已绑定 guest 用户 | 改绑到当前用户；guest 账号置为 `disabled`（保留数据） |
| 已绑定其他正式账号 | 拒绝，返回「该飞书身份已绑定其他账号」 |

登录流程不变：未绑定的飞书用户首次免登仍自动创建 `guest`。

## 3. 后端设计

### 3.1 绑定意图接口（新增）

浏览器跳转 OAuth 无法携带 JWT Header，因此新增：

`POST /api/auth/feishu/bind-intent`（需登录）

- 请求：`{ "provider": "feishu" | "feishu_eh" }`
- 响应：`{ "intent": "<JWT>" }`
- intent 载荷：`{ "user_id": ..., "provider": ..., "exp": now+10min }`，用现有 state 签名密钥签发。
- provider 未配置 → 400。

### 3.2 authorize 扩展

`GET /api/auth/feishu/authorize?provider=xx&intent=yyy`

- 有 `intent`：校验签名与有效期，从 intent 取 `user_id`，生成带 `mode=binding` 的 state（含 user_id、provider、exp）。
- 无 `intent`：现有登录模式，state 不变。
- intent 非法/过期 → 400 或跳回错误页。

### 3.3 callback 扩展

`GET /api/auth/feishu/callback?code=xx&state=yyy`

验 state 后：

- `mode=binding`：换 token → 取 `union_id` → 调用 `crud.bind_feishu_to_user()` → 前端跳转：
  - 成功：`{base}/feishu-callback#mode=binding&result=success&provider=xx`
  - 失败：`{base}/feishu-callback#mode=binding&result=error&message=原因`
- `mode` 缺省：现有登录逻辑，行为不变。

### 3.4 绑定核心逻辑

`crud.bind_feishu_to_user(db, provider, union_id, user_id, feishu_user)`：

1. 查 `(provider, union_id)` 绑定：
   - 无 → 新建绑定。
   - `binding.user_id == user_id` → 刷新姓名/头像，返回成功。
   - 绑定的是 guest → `binding.user_id = user_id`；guest 用户 `status='disabled'`；刷新绑定姓名/头像与目标用户 `real_name`。
   - 其他情况 → 抛绑定冲突错误（HTTP 409，回调转错误提示）。
2. 提交并返回目标用户。

### 3.5 绑定列表接口（新增）

`GET /api/auth/feishu/bindings`（需登录）

- 响应：`{ "bindings": [ { "provider", "name", "avatar_url", "created_at" } ] }`
- 只返回当前用户的绑定，供设置页展示状态。

### 3.6 数据模型

`user_feishu_bindings` 表结构不变，`(provider, union_id)` 唯一约束不变。

## 4. 前端设计

### 4.1 系统设置 tab

`frontend/src/pages/Settings.tsx` 的 tabs 数组在「修改密码」后插入：

```ts
{ key: 'feishuBind', label: '飞书绑定', enabled: true, adminOnly: false }
```

### 4.2 绑定 tab 内容

- 挂载时调用 `GET /api/auth/feishu/bindings` 获取当前绑定。
- 遍历 `/api/auth/feishu/config` 返回的 providers：
  - 未绑定 → 显示 provider 名称 +「绑定」按钮；
  - 已绑定 → 显示 provider 名称 + 飞书姓名/头像 +「已绑定」标签（无解绑按钮）。
- 点击「绑定」：调用 `POST /api/auth/feishu/bind-intent` 拿到 intent，再 `window.location.href = /api/auth/feishu/authorize?provider=xx&intent=yyy`。

### 4.3 回调结果页

复用 `/feishu-callback`：

- 解析 fragment 中 `mode=binding`：
  - `result=success` → 显示「绑定成功」，按钮返回 `/settings`；
  - `result=error` → 显示 `message`（如「该飞书身份已绑定其他账号」），按钮返回 `/settings`。
- 无 `mode=binding` → 现有登录回调逻辑不变。

## 5. 错误处理

- 未登录调用 bind-intent / bindings → 401。
- provider 未配置或非法 → 400。
- 绑定冲突 → 回调页展示原因，不登录任何账号。
- 换 token / 取用户信息失败 → 回调页展示「飞书授权失败，请重试」。
- 绑定流程不改变任何现有登录行为。

## 6. 测试

### 后端（新增/扩展 pytest）

- 无绑定 → 新建绑定成功；
- 已绑定当前用户 → 幂等成功；
- 已绑定 guest → 改绑当前用户，guest 置 `disabled`；
- 已绑定正式账号 → 409 拒绝；
- 未登录访问 bind-intent / bindings → 401；
- intent 过期/伪造 → 拒绝；
- `feishu` / `feishu_eh` 互相隔离；
- 绑定成功后，原登录流程进入原账号（回归用例）。

### 前端

- tab 渲染与权限（非 admin 可见）；
- 绑定列表展示、绑定按钮跳转；
- 回调成功/失败结果展示。

## 7. 文档

- 更新 `docs/飞书免登配置指南.md`，新增「已有账号绑定」使用说明。

## 8. 本期不做（YAGNI）

- 解绑功能；
- 管理员强制改绑/解绑；
- 手机号/姓名自动匹配；
- guest 数据迁移或合并（仅停用保留）。
