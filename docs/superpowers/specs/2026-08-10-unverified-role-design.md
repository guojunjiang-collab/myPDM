# 飞书登录未验证用户角色设计文档

> **创建日期**: 2026-08-10
> **状态**: 设计中

---

## 一、概述

飞书免登自动创建的用户当前直接获得 `guest` 角色，具备读取大部分数据的权限。需要新增一个 `unverified` 角色，使飞书自动建号的用户处于"零权限"状态，等待管理员审批并分配正式角色后才能正常使用。

### 核心目标

| 目标 | 说明 |
|------|------|
| 新增 `unverified` 角色 | 零权限，飞书自动建号默认为此角色 |
| 引导页 | 未验证用户登录后只看到"等待审批"引导页（无导航栏） |
| 通知管理员 | 用户可一键通知所有管理员审批 |
| 待审批 Tab | 用户管理页新增「待审批」tab，管理员可分配角色 |
| 保留 `guest` 角色 | guest 角色权限不做任何改动 |

---

## 二、角色与权限设计

### 2.1 权限矩阵变更

在 `permissions/permissions.json` 的 `roles` 数组中新增 `"unverified"`：

```json
"roles": ["admin", "engineer", "production", "guest", "unverified"]
```

`unverified` 角色在权限矩阵中**不授予任何权限**。所有权限项的 roles 数组保持不变。

### 2.2 隐式可访问端点

以下端点在代码层面不对 `unverified` 角色做拦截（不依赖权限矩阵）：

| 端点 | 鉴权方式 | 说明 |
|------|---------|------|
| `POST /api/auth/token` | 无 | 登录 |
| `GET /api/auth/me` | `Depends(get_current_user)` | 获取当前用户信息（纯 JWT 校验，不走权限矩阵） |
| `POST /api/auth/change-password` | `Depends(get_current_user)` | 修改密码（纯 JWT 校验） |
| `POST /api/auth/feishu/*` | 无/state 签名 | 飞书 OAuth 流程 |
| `POST /api/notifications/request-approval` | `Depends(get_current_user)` | 通知管理员（新增，**不走 require_permission**） |

> **注意**: `request-approval` 端点不使用 `require_permission`，因为 unverified 角色在权限矩阵中无任何权限。仅做 JWT 登录态校验 + 业务层判断 `user.role == "unverified"`。

### 2.3 guest 角色保持不变

`guest` 角色原有的 ~30 个 `*:read` 权限不做任何更改。

---

## 三、登录与路由流程

### 3.1 飞书自动建号

`backend/app/crud.py` — `find_or_create_feishu_user()` 函数：

- **修改前**: `role="guest"`
- **修改后**: `role="unverified"`

### 3.2 前端登录后路由决策

```
飞书免登成功 → 拿到 token
  → 前端调 GET /api/auth/me 获取当前用户
    ├─ user.role != "unverified" → 进入 Layout 正常渲染
    └─ user.role == "unverified" → 跳转 /pending-approval
```

### 3.3 ProtectedRoute 改造

```typescript
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.must_change_password) return <Navigate to="/change-password" replace />;

  // 新增：unverified 用户重定向到引导页
  if (user?.role === 'unverified') return <Navigate to="/pending-approval" replace />;

  return <>{children}</>;
}
```

### 3.4 引导页路由

`/pending-approval` 是独立路由，**不被 ProtectedRoute 包裹**，也不使用 Layout：

```tsx
<Route path="/pending-approval" element={<PendingApproval />} />
```

---

## 四、引导页设计 (`/pending-approval`)

### 4.1 页面布局

纯居中卡片式布局，无侧边栏、无顶栏，风格类似登录页。

```
┌─────────────────────────────────────────┐
│                                         │
│            ⏳ 等待审批                    │
│                                         │
│    您的账号正在等待管理员审批，           │
│    审批通过后即可正常使用系统功能。       │
│                                         │
│    ┌─────────────────────────────────┐  │
│    │         📢 通知管理员            │  │
│    └─────────────────────────────────┘  │
│    ┌─────────────────────────────────┐  │
│    │          退出登录                │  │
│    └─────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### 4.2 按钮行为

| 按钮 | 行为 |
|------|------|
| 「通知管理员」 | 调 `POST /api/notifications/request-approval`，成功后按钮文案变为 "已通知"（disabled） |
| 「退出登录」 | 清除 authStore + localStorage token，跳转 `/login` |

### 4.3 状态管理

- 进入页面时检查该用户是否已有未读的审批通知（通过回调查询避免重复发送）
- 如果已有未结束的审批通知，按钮直接显示 "已通知"

---

## 五、通知机制

### 5.1 通知模型

复用现有 `notifications` 表（`models_notification.py`），无需新建表。

新增 `event_type` 值：`"approval_request"`

### 5.2 通知发送流程

```
用户点击「通知管理员」
  → POST /api/notifications/request-approval
  → 后端校验：用户角色为 unverified
  → 查询所有 role=admin 的用户
  → 检查是否已有未读审批通知（防重复）
  → 为每位 admin 创建一条通知：
       event_type = "approval_request"
       title      = "用户 {姓名} 申请系统访问权限"
       body       = "飞书免登用户 {姓名}（{username}）等待审批"
       target_type = "user"
       target_id   = applicant_user_id
       sender_id  = applicant_user_id
  → 返回 { "notified_count": 3 }
```

### 5.3 防重复发送

后端在创建通知前，查询是否存在以下条件的未读通知：
- `recipient_id` 为任意 admin
- `event_type` = `"approval_request"`
- `target_id` = 当前用户 ID
- `is_read` = false

如果已存在，直接返回 `{ "notified_count": 0, "already_notified": true }`。

### 5.4 管理员审批后通知自动标记

当管理员通过 `PUT /api/users/{user_id}` 将用户角色从 `unverified` 改为其他角色时：

- 查询所有 `event_type = "approval_request"` 且 `target_id = user_id` 且 `is_read = false` 的通知
- 将这些通知标记为已读（`mark_all_read` 逻辑不可用，需按 target 批量标记）

### 5.5 前端通知表现

在 `frontend/src/lib/notification.ts` 中注册：

```typescript
// NOTIFICATION_EVENT_ICON
approval_request: { icon: '👤', bg: '#fef3c7' }

// NOTIFICATION_TARGET_ROUTE
user: '/users'
```

管理员点击通知后跳转到用户管理页。

---

## 六、用户管理页「待审批」Tab

### 6.1 页面结构

```
┌─ 用户管理 ───────────────────────────────────┐
│ [全部用户] [待审批 (3)] [已禁用]               │
├───────────────────────────────────────────────┤
│ 用户名    │ 姓名 │ 来源      │ 申请时间 │ 操作  │
│ zhangsan  │ 张三 │ 飞书登录   │ 08-10   │ [审批] │
│ lisi      │ 李四 │ 飞书登录   │ 08-10   │ [审批] │
│ wangwu    │ 王五 │ 飞书(EH)  │ 08-09   │ [审批] │
└───────────────────────────────────────────────┘
```

### 6.2 列表数据

调用现有 `GET /api/users/` 接口，增加参数 `role=unverified`。

后端 user 查询需支持 `role` 筛选参数（如当前不支持则新增）。

### 6.3 审批操作

点击「审批」→ 弹出下拉框选择角色（engineer / production / guest）→ 确认。

调用 `PUT /api/users/{user_id}` 更新 `role` 字段（复用现有接口，admin 已持有 `users:update` 权限）。

### 6.4 审批后效果

- 用户重新登录或刷新页面后，`/auth/me` 返回新角色，不再重定向到引导页
- 所有该用户的 `approval_request` 通知自动标记为已读
- 待审批列表自动刷新，该用户从列表中移除

---

## 七、改动文件清单

### 后端（7 个文件）

| 文件 | 改动 |
|------|------|
| `permissions/permissions.json` | roles 数组新增 `"unverified"` |
| `backend/app/permissions/_generated.py` | 运行 `gen_permissions.py` 自动生成 |
| `backend/app/crud.py` | `find_or_create_feishu_user` 中 `role="guest"` → `role="unverified"` |
| `backend/app/schemas.py` | 无需改动（ROLES 从 `_generated.py` 导入，自动包含新角色） |
| `backend/app/notifications.py` | 新增 `resolve_approval_notifications(db, user_id)` 函数 |
| `backend/app/routers/notifications.py` | 新增 `POST /request-approval` 端点 |
| `backend/app/routers/users.py` | `update_user` 中，角色从 unverified 变为其他时调用 `resolve_approval_notifications` |

### 前端（7 个文件）

| 文件 | 改动 |
|------|------|
| `frontend/src/constants/permissions.generated.ts` | 运行 `gen_permissions.py` 自动生成 |
| `frontend/src/types/index.ts` | `UserRole` 类型新增 `"unverified"` |
| `frontend/src/App.tsx` | 新增 `/pending-approval` 路由，改造 `ProtectedRoute` |
| `frontend/src/pages/PendingApproval.tsx` | **新建**：引导页组件 |
| `frontend/src/pages/Users.tsx` | 新增「待审批」tab |
| `frontend/src/services/api.ts` | 新增 `requestApproval()` 方法 |
| `frontend/src/lib/notification.ts` | 注册 `approval_request` 事件图标和路由 |

### 测试

| 文件 | 说明 |
|------|------|
| `backend/tests/test_unverified_role.py` | 测试：角色创建、权限拒绝、通知发送/去重/自动已读 |
| `backend/tests/test_feishu_auth.py` | 更新断言：飞书新用户角色为 `unverified` |

---

## 八、边界情况

| 场景 | 处理方式 |
|------|---------|
| 已有飞书 guest 用户 | 不受影响，保持 guest 角色（不做数据迁移） |
| 管理员也通过飞书登录 | 管理员不会走自动建号流程（已有绑定），不受影响 |
| 用户反复点击「通知管理员」 | 后端检查未读通知去重，不重复发送 |
| 未验证用户手动输入 URL 访问其他页面 | `ProtectedRoute` 拦截，重定向到 `/pending-approval` |
| 未验证用户直接调 API | 后端权限矩阵无 `unverified`，API 返回 403 |
| 用户角色从 unverified 改回 unverified | 无意义操作，正常处理 |
| 多个管理员审批 | 任一位审批后，其余通知自动标记已读 |

---

## 九、与现有功能的兼容性

| 现有功能 | 影响 |
|---------|------|
| 普通账号密码登录 | 不受影响（无法创建 unverified 用户） |
| 管理员手动创建用户 | 创建时可正常选角色，不会选 unverified |
| ECR/ECO 通知 | 不受影响（不同 event_type） |
| 看板共享 | unverified 用户无 `dashboard:read` 权限，无法访问 |
| AI 助手 | unverified 用户无 `assistant:chat` 权限，无法使用 |
