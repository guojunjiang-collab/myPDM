# 首次登录强制修改密码 — 设计文档

日期：2026-07-29
状态：设计定稿，待实施

## 背景

当前系统中：

- 管理员在 `Users` 页面创建用户时手填初始密码，重置密码固定为 `123456`（`frontend/src/pages/Users.tsx:266`）
- `User` 模型没有任何"首次登录"或"密码需更换"的标记字段
- `/auth/change-password` 已存在（`backend/app/routers/auth.py:93`），需要旧密码，但不是强制的
- 结果：大量账号长期停留在初始弱密码状态

## 目标

1. 新建用户首次登录时，必须先修改密码才能使用系统
2. 管理员重置密码后，该用户下次登录同样必须修改密码
3. 拦截在后端强制生效，不能通过直接调 API 绕过
4. 升级后现有用户不受影响，不出现"全员被拦"

## 非目标

- 密码定期过期 / 强制轮换（本期不做）
- 密码历史记录、禁止复用最近 N 次密码（本期不做）
- 找回密码 / 邮件重置流程（本期不做）
- 管理员填写的初始密码不施加强度规则（一次性密码，必然被强制换掉）

## 数据模型

`users` 表新增一列：

```sql
must_change_password BOOLEAN NOT NULL DEFAULT FALSE
```

`backend/app/models.py` 的 `User` 类同步加字段。

**迁移方式**：本项目没有 alembic，schema 变更沿用 `backend/app/main.py` 启动时的幂等 `ALTER TABLE` 模式（参见 `main.py:425` 附近的既有写法）。加一条：

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
```

默认 `FALSE` 保证存量用户不受影响。

**置为 TRUE 的时机只有两处**：

1. 管理员创建用户（users 路由的 create）
2. 管理员重置密码（users 路由的 update，当请求体带 `password` 且操作者不是本人时）

**置为 FALSE 的时机只有一处**：用户通过 `/auth/change-password` 成功改密。

## 后端拦截

### 依赖注入改造

现有几乎所有业务路由都依赖 `get_current_active_user`，`require_role` 也链到它。因此拦截只需改这一处即可全覆盖。

`backend/app/routers/auth.py`：

- 新增 `get_current_user_pwchange`：只校验 `status == "active"`，**不**校验 `must_change_password`
- `get_current_active_user`：在现有 status 校验之后，新增

  ```python
  if current_user.must_change_password:
      raise HTTPException(status_code=403, detail="PASSWORD_CHANGE_REQUIRED")
  ```

### 豁免接口

只有两个接口改用 `get_current_user_pwchange`：

- `GET /auth/me` — 前端需要它渲染改密页的用户信息
- `POST /auth/change-password` — 改密本身

其余所有接口一律 403。

### 登录响应

`POST /auth/token` 响应体新增 `must_change_password: bool`（`schemas.Token` 加可选字段）。JWT payload 也带一份，仅供前端展示；**权威判定始终以数据库查询为准**，不信任 token 内容。

### 改密接口

`POST /auth/change-password` 成功后，除更新 `password_hash` 外，将 `must_change_password` 置为 `False`。

## 密码强度规则

在 `schemas.ChangePasswordRequest` 上用 pydantic validator 实现，对 `new_password`：

- 长度 ≥ 8
- 至少包含字母和数字两类字符
- 不得与 `old_password` 相同
- 不得命中弱密码黑名单（`123456`、`12345678`、`password`、`admin`、`abc123`、`111111` 等，小列表即可）

违反规则返回 422，错误信息用中文，前端直接展示。

此规则**仅**作用于 `/auth/change-password`，不作用于管理员创建用户时填写的初始密码。

## 前端

### 强制改密页

新增路由 `/change-password` 及对应页面组件：

- 布局：不套 `Layout`，无侧边栏、无顶栏导航
- 内容：居中卡片，含旧密码 / 新密码 / 确认新密码三个输入框，一个"确认修改"按钮
- 右上角只有一个"退出登录"按钮，这是本页**唯一**的出口
- 页面顶部提示文案说明为何被要求改密（首次登录 / 密码已被管理员重置）
- 改密成功后清除标记、提示成功、跳转主页
- 表单样式沿用现有页面风格（primary-* 配色、共享 Modal/表单组件），与 `Settings.tsx` 中已有的改密表单保持一致

### 登录跳转

`Login.tsx`：登录成功后若响应 `must_change_password` 为真，直接跳 `/change-password`，不进主页。

### 路由守卫

`App.tsx`：已登录且 `must_change_password` 为真时，访问任何其他路由都重定向到 `/change-password`。

### API 兜底

`services/api.ts` 响应拦截器：任何 403 且 `detail === "PASSWORD_CHANGE_REQUIRED"` → 强制跳转 `/change-password`。防止 token 仍有效但服务端状态已变（如管理员刚重置了在线用户的密码）的情况。

### 用户管理页文案

`Users.tsx` 重置密码确认框补充说明：重置后密码为 `123456`，该用户下次登录须重新设置密码。

## 测试

后端 pytest，沿用 `backend/tests/` 现有风格与 fixtures：

1. 管理员新建用户 → 该用户登录，响应 `must_change_password == true`
2. 带该标记的 token 访问任意业务接口（如 `/parts`）→ 403，`detail == "PASSWORD_CHANGE_REQUIRED"`
3. 同一 token 访问 `GET /auth/me` → 200
4. 同一 token 访问 `POST /auth/change-password` → 可用
5. 改密成功后再查库，标记为 `False`；重新登录后访问业务接口 → 200
6. 新密码过短 / 无数字 / 命中黑名单 / 与旧密码相同 → 422
7. 管理员重置某用户密码后，该用户 `must_change_password` 重新为 `True`
8. 存量用户（字段为 `False`）登录后访问业务接口 → 200，不受影响
9. 用户自己通过 Settings 改密，不应把自己标记为需改密

前端：`npm run build` 通过；手动验证首次登录流程与重置后流程。

## 风险与注意事项

- **在线用户被重置**：管理员重置一个已登录用户的密码后，其现有 token 仍有效但会开始收到 403，由 API 拦截器兜底跳转，用户需用新的 `123456` 完成改密。这是预期行为。
- **豁免面必须严格**：只有 `/auth/me` 和 `/auth/change-password` 两个接口豁免，新增接口时不要误用 `get_current_user_pwchange`。
- **`/auth/refresh` 不豁免**：它不依赖 `get_current_active_user`，本身不受影响，刷新出的新 token 同样会被业务接口拦截，无需特殊处理。
