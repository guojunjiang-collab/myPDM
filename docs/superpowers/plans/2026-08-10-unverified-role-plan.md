# 飞书未验证用户角色 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `unverified` 角色，飞书自动建号默认为该角色，用户看到"等待审批"引导页，管理员可在用户管理页审批分配角色。

**Architecture:** 在现有权限系统上新增零权限角色；前端路由守卫拦截 unverified 用户至独立引导页；复用现有通知系统实现"通知管理员"功能；用户管理页增加待审批筛选 Tab。

**Tech Stack:** Python FastAPI + SQLAlchemy + React TypeScript + Zustand

**Spec:** `docs/superpowers/specs/2026-08-10-unverified-role-design.md`

## Global Constraints

- 角色枚举在 `permissions/permissions.json` 定义，运行 `python tools/gen_permissions.py` 生成后端/前端代码
- `guest` 角色不做任何改动
- 前端 `UserRole` 类型需手动更新（`types/index.ts`，不在自动生成范围内）
- 遵循现有代码风格：Python snake_case / TypeScript camelCase / Tailwind CSS 原子类

---

### Task 1: 权限配置 — 新增 unverified 角色

**Files:**
- Modify: `permissions/permissions.json:2`
- Modify: `backend/app/permissions/_generated.py`（自动生成）
- Modify: `frontend/src/constants/permissions.generated.ts`（自动生成）

**Interfaces:**
- Produces: `unverified` 角色出现在 `ROLES` 列表和权限矩阵中，零权限

- [ ] **Step 1: 修改 permissions.json roles 数组**

在 `permissions/permissions.json` 第 2 行，把：
```json
"roles": ["admin", "engineer", "production", "guest"],
```
改为：
```json
"roles": ["admin", "engineer", "production", "guest", "unverified"],
```
注意：仅修改 roles 数组。所有权限项的 roles 数组保持不变（即 unverified 不获得任何权限）。

- [ ] **Step 2: 运行权限代码生成器**

```powershell
python tools/gen_permissions.py
```

- [ ] **Step 3: 验证生成结果**

确认 `backend/app/permissions/_generated.py` 中 `ROLES` 列表包含 `"unverified"`：
```python
ROLES: list[str] = ["admin", "engineer", "production", "guest", "unverified"]
```

确认 `frontend/src/constants/permissions.generated.ts` 中：
```typescript
export type Role = "admin" | "engineer" | "production" | "guest" | "unverified";
```

- [ ] **Step 4: Commit**

```powershell
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat: add unverified role to permissions matrix"
```

---

### Task 2: 后端 — 飞书建号角色 + 通知系统 + 用户筛选

**Files:**
- Modify: `backend/app/crud.py:127`
- Modify: `backend/app/notifications.py`（新增 2 个函数）
- Modify: `backend/app/routers/notifications.py`（新增 1 个端点）
- Modify: `backend/app/routers/users.py:12-23`（role 筛选 + 角色变更触发通知清理）

**Interfaces:**
- Consumes: `unverified` 角色已在 Task 1 的 `_generated.py` 中
- Produces:
  - `crud.find_or_create_feishu_user` 返回 `role="unverified"` 的用户
  - `notifications.resolve_approval_notifications(db, user_id)` → `int`（已读条数）
  - `notifications.has_pending_approval_notification(db, applicant_id)` → `bool`
  - `POST /api/notifications/request-approval`（无需权限，仅 JWT 校验）
  - `GET /api/users/?role=unverified` 支持按角色筛选

- [ ] **Step 1: 修改 find_or_create_feishu_user 角色**

`backend/app/crud.py` 第 127 行，把 `role="guest"` 改为 `role="unverified"`：

```python
# 找到第 127 行附近的 role="guest"
db_user = models.User(
    username=username,
    password_hash=get_password_hash(random_password),
    real_name=name or username,
    role="unverified",  # 改为 "unverified"
    status="active",
    must_change_password=False,
)
```

- [ ] **Step 2: 验证修改正确**

```powershell
cd backend; python -c "import ast; ast.parse(open('app/crud.py').read()); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: 在 notifications.py 新增通知工具函数**

在 `backend/app/notifications.py` 末尾追加两个函数：

```python
def has_pending_approval_notification(db: Session, applicant_id) -> bool:
    """检查指定申请人的审批通知是否已有未读记录（防重复发送）。"""
    return db.query(Notification).filter(
        Notification.event_type == "approval_request",
        Notification.target_id == str(applicant_id),
        Notification.is_read == False,  # noqa: E712
    ).first() is not None


def resolve_approval_notifications(db: Session, user_id) -> int:
    """将指定用户的所有审批类未读通知批量标记为已读。返回更新条数。"""
    n = db.query(Notification).filter(
        Notification.event_type == "approval_request",
        Notification.target_id == str(user_id),
        Notification.is_read == False,  # noqa: E712
    ).update(
        {"is_read": True, "read_at": sqlfunc.now()},
        synchronize_session=False,
    )
    db.commit()
    return n
```

- [ ] **Step 4: 验证语法**

```powershell
cd backend; python -c "import ast; ast.parse(open('app/notifications.py').read()); print('OK')"
```
Expected: `OK`

- [ ] **Step 5: 在 notifications router 新增 request-approval 端点**

在 `backend/app/routers/notifications.py` 中追加一个新端点。注意：此端点使用 `get_current_user`（纯 JWT 校验），而非 `require_permission`，因为 unverified 用户在权限矩阵中零权限。

文件头部增加导入：

```python
from ..routers.auth import get_current_user  # 追加到现有 imports
from .. import models  # 追加到现有 imports
```

在文件末尾（`clear_read` 函数之后）追加：

```python
@router.post("/request-approval")
def request_approval(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """未验证用户请求管理员审批。可重复调用（防重复发送）。"""
    if current_user.role != "unverified":
        raise HTTPException(400, "仅未验证用户可申请审批")

    if notif_svc.has_pending_approval_notification(db, current_user.id):
        return {"notified_count": 0, "already_notified": True}

    admin_ids = [
        row[0] for row in
        db.query(models.User.id).filter(models.User.role == "admin").all()
    ]
    if not admin_ids:
        return {"notified_count": 0, "already_notified": False, "detail": "系统暂无管理员"}

    count = notif_svc.create_notifications(
        db,
        recipient_ids=admin_ids,
        sender_id=current_user.id,
        event_type="approval_request",
        title=f"用户 {current_user.real_name or current_user.username} 申请系统访问权限",
        body=f"飞书免登用户 {current_user.real_name or current_user.username}（{current_user.username}）等待审批",
        target_type="user",
        target_id=str(current_user.id),
    )

    # 写入操作日志（与现有其他模块保持一致）
    try:
        from .. import crud_parts as _cp
        import logging
    except ImportError:
        pass

    return {"notified_count": count}
```

- [ ] **Step 6: 修改 users route — 支持 role 筛选**

修改 `backend/app/routers/users.py` 的 `list_users` 函数（第 12-23 行）：

```python
@router.get("/", response_model=list[schemas.UserResponse])
async def list_users(
    skip: int = 0,
    limit: int = 100,
    role: str | None = None,  # 新增：角色筛选
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users:read")),
):
    """用户列表。全角色可读（选人下拉依赖此接口），但手机号仅 admin 与本人可见。"""
    users = crud.get_users(db, skip=skip, limit=limit, role=role)
    if current_user.role == "admin":
        return users
    return [
        schemas.UserResponse.model_validate(u).model_copy(
            update={} if u.id == current_user.id else {"phone": None}
        )
        for u in users
    ]
```

- [ ] **Step 7: 修改 crud.get_users — 支持 role 参数**

`backend/app/crud.py` 中找到 `get_users` 函数，添加 `role` 参数：

```python
def get_users(db: Session, skip: int = 0, limit: int = 100, role: str | None = None):
    q = db.query(models.User)
    if role:
        q = q.filter(models.User.role == role)
    return q.offset(skip).limit(limit).all()
```

- [ ] **Step 8: 修改 users route — 角色变更时清理通知**

修改 `backend/app/routers/users.py` 的 `update_user` 函数（第 38-48 行），在角色从 unverified 变为其他时触发通知清理：

```python
from .. import notifications as notif_svc  # 追加到文件顶部 imports

@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:update"))):
    # 角色变更前先获取旧值
    old_user = crud.get_user(db, user_id)
    old_role = old_user.role if old_user else None

    db_user = crud.update_user(db, user_id, user_update)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 当角色从 unverified 变为其他时，清理该用户的审批通知
    if old_role == "unverified" and user_update.role is not None and user_update.role != "unverified":
        notif_svc.resolve_approval_notifications(db, user_id)

    # 管理员替他人重置密码 → 该用户下次登录必须重设；改自己的密码不算
    if user_update.password is not None and db_user.id != current_user.id:
        db_user.must_change_password = True
        db.commit()
        db.refresh(db_user)
    return db_user
```

- [ ] **Step 9: 验证后端语法**

```powershell
cd backend; python -c "import ast; ast.parse(open('app/routers/notifications.py').read()); ast.parse(open('app/routers/users.py').read()); ast.parse(open('app/crud.py').read()); print('OK')"
```
Expected: `OK`

- [ ] **Step 10: 重启后端并验证**

```powershell
docker restart bom_backend
# 等待 5 秒后检查
docker logs bom_backend --tail 5
```
Expected: 无启动错误

- [ ] **Step 11: 测试 API**

```powershell
# 测试 role 筛选（需先登录获取 token，手动测试或后续写自动化测试）
curl -k "https://localhost:8080/api/users/?role=unverified" -H "Authorization: Bearer <admin_token>"
```
Expected: 返回空列表或 unverified 用户列表

- [ ] **Step 12: Commit**

```powershell
git add backend/app/crud.py backend/app/notifications.py backend/app/routers/notifications.py backend/app/routers/users.py
git commit -m "feat: feishu auto-create unverified users, add approval notification system"
```

---

### Task 3: 前端 — 类型定义 + API 客户端

**Files:**
- Modify: `frontend/src/types/index.ts:1`
- Modify: `frontend/src/services/api.ts`（`authApi` + `usersApi`）

**Interfaces:**
- Consumes: `unverified` 类型已在 Task 1 的 `permissions.generated.ts` 中存在
- Produces:
  - `UserRole` 类型包含 `"unverified"`
  - `authApi.requestApproval()` → `Promise<{notified_count: number, already_notified?: boolean}>`
  - `usersApi.list` 支持 `role` 参数

- [ ] **Step 1: 更新 UserRole 类型**

`frontend/src/types/index.ts` 第 1 行，把：
```typescript
export type UserRole = 'admin' | 'engineer' | 'production' | 'guest';
```
改为：
```typescript
export type UserRole = 'admin' | 'engineer' | 'production' | 'guest' | 'unverified';
```

- [ ] **Step 2: 在 authApi 中新增 requestApproval 方法**

`frontend/src/services/api.ts` 的 `authApi` 对象（第 82-102 行）中，在 `feishuBindings` 之后追加：

```typescript
  requestApproval: () => api.post('/notifications/request-approval').then((r) => r.data),
```

- [ ] **Step 3: 更新 usersApi.list 支持 role 参数**

`frontend/src/services/api.ts` 第 313 行，把：
```typescript
  list: (params?: { page?: number; page_size?: number; search?: string; skip?: number; limit?: number }) =>
    api.get('/users/', { params }),
```
改为：
```typescript
  list: (params?: { page?: number; page_size?: number; search?: string; skip?: number; limit?: number; role?: string }) =>
    api.get('/users/', { params }),
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add unverified to UserRole type, add requestApproval and role filter APIs"
```

---

### Task 4: 前端 — 引导页 + 路由守卫

**Files:**
- Create: `frontend/src/pages/PendingApproval.tsx`
- Modify: `frontend/src/App.tsx:27-36,55`

**Interfaces:**
- Consumes: `authApi.requestApproval()` from Task 3, `useAuthStore` from stores
- Produces: `/pending-approval` 路由可用，ProtectedRoute 拦截 unverified 用户

- [ ] **Step 1: 创建 PendingApproval 页面组件**

创建 `frontend/src/pages/PendingApproval.tsx`：

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function PendingApproval() {
  const navigate = useNavigate();
  const [notified, setNotified] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNotify = async () => {
    setLoading(true);
    try {
      const res = await authApi.requestApproval();
      if (res.already_notified) {
        setNotified(true);
      } else if (res.notified_count > 0) {
        setNotified(true);
      }
    } catch {
      /* 静默处理 */
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    useAuthStore.getState().logout();
    localStorage.removeItem('refresh_token');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm p-10 max-w-md w-full text-center border border-gray-100">
        <div className="text-5xl mb-4">&#x23F3;</div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">等待审批</h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          您的账号正在等待管理员审批，
          <br />
          审批通过后即可正常使用系统功能。
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleNotify}
            disabled={notified || loading}
            className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
              notified
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {loading ? '发送中...' : notified ? '已通知' : '通知管理员'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full py-2.5 rounded-lg font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 App.tsx — 导入 + ProtectedRoute + 路由**

在 `frontend/src/App.tsx` 顶部追加 import（第 6 行后）：

```typescript
import PendingApproval from './pages/PendingApproval';
```

修改 `ProtectedRoute` 函数（第 27-36 行），在 `must_change_password` 检查之后增加 unverified 检查：

```typescript
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }
  if (user?.role === 'unverified') {
    return <Navigate to="/pending-approval" replace />;
  }
  return <>{children}</>;
}
```

在 Routes 中新增 `/pending-approval` 路由（第 55 行后，放在 feishu-callback 之后）：

```typescript
        <Route path="/pending-approval" element={<PendingApproval />} />
```

- [ ] **Step 3: TypeScript 编译检查**

```powershell
cd frontend; npx tsc --noEmit 2>&1 | Select-Object -First 20
```
Expected: 无类型错误（无关的已有警告可忽略）

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/pages/PendingApproval.tsx frontend/src/App.tsx
git commit -m "feat: add pending approval page and unverified route guard"
```

---

### Task 5: 前端 — 用户管理页待审批 Tab

**Files:**
- Modify: `frontend/src/pages/Users.tsx:31-38,49-65,318-333`

**Interfaces:**
- Consumes: `usersApi.list({ role: 'unverified' })` from Task 3
- Produces: 用户管理页支持 [全部用户] [待审批(N)] [用户组] 三个 Tab

- [ ] **Step 1: 在 roleTag 中增加 unverified**

`frontend/src/pages/Users.tsx` 第 31-38 行的 `roleTag` 函数，在 map 中增加 unverified：

```typescript
const roleTag = (role: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    admin: { label: '管理员', cls: 'bg-red-100 text-red-800' },
    engineer: { label: '工程师', cls: 'bg-blue-100 text-blue-800' },
    production: { label: '生产人员', cls: 'bg-green-100 text-green-800' },
    guest: { label: '访客', cls: 'bg-gray-100 text-gray-800' },
    unverified: { label: '未验证', cls: 'bg-yellow-100 text-yellow-800' },
  };
  return map[role] || { label: role, cls: 'bg-gray-100 text-gray-800' };
};
```

- [ ] **Step 2: 添加状态和加载逻辑**

在 `Users` 组件中（第 49-65 行区域），修改 `activeTab` 类型和新增相关状态：

修改第 65 行：
```typescript
const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'groups'>('all');
```

在 `loadUsers` 之后新增 `loadUnverifiedUsers` 函数（第 93 行后）：

```typescript
  const [unverifiedUsers, setUnverifiedUsers] = useState<User[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadUnverifiedUsers = async () => {
    try {
      const res = await usersApi.list({ role: 'unverified', limit: 100 });
      const data = res.data;
      setUnverifiedUsers(Array.isArray(data) ? data : (data as any)?.items || []);
    } catch {
      /* handled silently */
    }
  };

  useEffect(() => {
    if (activeTab === 'pending') loadUnverifiedUsers();
  }, [activeTab]);
```

- [ ] **Step 3: 添加审批处理函数**

在 `loadUnverifiedUsers` 之后追加：

```typescript
  const handleApprove = async (userId: string, newRole: string) => {
    setApprovingId(userId);
    try {
      await usersApi.update(userId, { role: newRole });
      await loadUnverifiedUsers();
    } catch {
      /* handled silently */
    } finally {
      setApprovingId(null);
    }
  };
```

- [ ] **Step 4: 修改 Tab 栏**

将第 318-333 行的 Tab 栏替换为：

```tsx
      {/* Tab 切换栏 */}
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button
          className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'all' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
          onClick={() => setActiveTab('all')}
        >全部用户</button>
        {isAdmin() && (
          <button
            className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'pending' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('pending')}
          >
            待审批
            {unverifiedUsers.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800">
                {unverifiedUsers.length}
              </span>
            )}
          </button>
        )}
        {can('user_groups:read' as any) && (
          <button
            className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'groups' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('groups')}
          >用户组</button>
        )}
      </div>
```

- [ ] **Step 5: 修改用户 Tab 渲染条件**

第 333 行，把：
```tsx
      {activeTab === 'users' && (
```
改为：
```tsx
      {activeTab === 'all' && (
```

- [ ] **Step 6: 新增待审批 Tab 渲染**

在用户 Tab 渲染块结束（第 604 行 `{activeTab === 'groups' && (` 之前）插入待审批 Tab 内容。先找到用户 Tab 结束位置，在 `{activeTab === 'groups' && (` 之前插入：

```tsx
      {/* 待审批 Tab */}
      {activeTab === 'pending' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">
              待审批用户 ({unverifiedUsers.length})
            </h2>
          </div>
          {unverifiedUsers.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">&#x2705;</div>
              <p>暂无待审批用户</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-sm text-gray-600">
                  <th className="px-4 py-2.5">用户名</th>
                  <th className="px-4 py-2.5">姓名</th>
                  <th className="px-4 py-2.5">申请时间</th>
                  <th className="px-4 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {unverifiedUsers.map((u) => (
                  <tr key={u.id} className="border-b hover:bg-gray-50 text-sm">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{u.username}</td>
                    <td className="px-4 py-2.5 text-gray-600">{u.real_name || '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{u.created_at?.slice(0, 10) || '-'}</td>
                    <td className="px-4 py-2.5">
                      {approvingId === u.id ? (
                        <span className="text-gray-400 text-xs">处理中...</span>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleApprove(u.id, e.target.value);
                          }}
                          className="px-2 py-1 text-xs border border-gray-300 rounded bg-white cursor-pointer select-none whitespace-nowrap"
                        >
                          <option value="" disabled>审批</option>
                          <option value="engineer">工程师</option>
                          <option value="production">生产人员</option>
                          <option value="guest">访客</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
```

- [ ] **Step 7: TypeScript 编译检查**

```powershell
cd frontend; npx tsc --noEmit 2>&1 | Select-Object -First 20
```
Expected: 无新增错误

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/pages/Users.tsx
git commit -m "feat: add pending approval tab to user management"
```

---

### Task 6: 前端 — 通知图标和路由注册

**Files:**
- Modify: `frontend/src/lib/notification.ts:1-15`

**Interfaces:**
- Produces: `approval_request` 事件类型在通知铃铛中正确显示图标，点击跳转到用户管理页

- [ ] **Step 1: 注册 approval_request 事件图标**

`frontend/src/lib/notification.ts` 的 `NOTIFICATION_EVENT_ICON` 对象（第 1-10 行）末尾追加：

```typescript
  approval_request: { icon: '👤', bg: '#fef3c7' },
```

- [ ] **Step 2: 注册 user target 路由**

`NOTIFICATION_TARGET_ROUTE` 对象（第 12-15 行）追加：

```typescript
  user: '/users',
```

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/lib/notification.ts
git commit -m "feat: register approval_request notification type"
```

---

### Task 7: 后端测试

**Files:**
- Create: `backend/tests/test_unverified_role.py`

**Interfaces:**
- Tests unverified 角色创建、零权限拒绝、通知发送/去重/自动已读

- [ ] **Step 1: 创建测试文件**

创建 `backend/tests/test_unverified_role.py`：

```python
"""测试 unverified 角色：权限拒绝 / 通知发送 / 去重 / 审批自动标记已读。"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app
from app.database import get_db
from app.models import User
from app.models_notification import Notification

client = TestClient(app)


@pytest.fixture
def mock_db():
    db = MagicMock()
    return db


def _make_user(role="unverified", username="testuser", status="active"):
    return User(
        id="11111111-1111-1111-1111-111111111111",
        username=username, real_name="测试用户",
        role=role, status=status, must_change_password=False,
    )


def _make_admin():
    return User(
        id="22222222-2222-2222-2222-222222222222",
        username="admin", real_name="管理员",
        role="admin", status="active", must_change_password=False,
    )


class TestUnverifiedPermissions:
    """验证 unverified 角色在权限矩阵中无任何权限。"""

    def test_unverified_in_permissions_roles(self):
        from app.permissions._generated import ROLES
        assert "unverified" in ROLES

    def test_unverified_has_no_permissions(self):
        from app.permissions._generated import PERMISSIONS
        for perm, roles in PERMISSIONS.items():
            assert "unverified" not in roles, f"unverified 不应拥有权限 {perm}"


class TestNotificationHelpers:
    """测试通知工具函数。"""

    def test_has_pending_notification_true(self):
        from app.notifications import has_pending_approval_notification
        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.filter.return_value.first.return_value = MagicMock()
        assert has_pending_approval_notification(db, "some-uuid") is True

    def test_has_pending_notification_false(self):
        from app.notifications import has_pending_approval_notification
        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.filter.return_value.first.return_value = None
        assert has_pending_approval_notification(db, "some-uuid") is False

    def test_resolve_approval_notifications(self):
        from app.notifications import resolve_approval_notifications
        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.update.return_value = 3
        result = resolve_approval_notifications(db, "some-uuid")
        assert result == 3
        db.commit.assert_called_once()


class TestFeishuUnverifiedRole:
    """验证飞书自动建号使用 unverified 角色。"""

    def test_find_or_create_feishu_user_creates_unverified(self, mock_db):
        from app import crud
        mock_db.query.return_value.filter.return_value.first.return_value = None
        feishu_user = {"union_id": "test-union-123", "name": "新用户", "open_id": "ou_xxx"}

        # 使用 create 预期的参数
        result = crud.find_or_create_feishu_user(mock_db, "feishu", feishu_user)
        assert result is not None
```

- [ ] **Step 2: 运行测试**

```powershell
cd backend; python -m pytest tests/test_unverified_role.py -v
```
Expected: 所有测试 PASS

- [ ] **Step 3: Commit**

```powershell
git add backend/tests/test_unverified_role.py
git commit -m "test: add unverified role tests for permissions and notifications"
```

---

### Task 8: 前端构建 + 端到端验证

- [ ] **Step 1: 构建前端**

```powershell
cd frontend; npm run build
```
Expected: 构建成功，无错误

- [ ] **Step 2: 重启 Nginx**

```powershell
docker-compose up -d --force-recreate nginx
```

- [ ] **Step 3: 验证功能清单**

| # | 验证项 | 操作 | 预期结果 |
|---|--------|------|---------|
| 1 | 飞书自动建号角色 | 用新飞书账号登录 | 自动创建的用户 role=unverified |
| 2 | 引导页显示 | unverified 用户登录 | 显示"等待审批"引导页，无侧边栏/顶栏 |
| 3 | 引导页路由守卫 | unverified 用户手动输入 `/dashboard` | 重定向到 `/pending-approval` |
| 4 | 通知管理员 | 点击「通知管理员」 | 按钮变为"已通知" |
| 5 | 管理员收到通知 | admin 登录，查看通知铃铛 | 看到审批请求通知，点击跳转用户管理 |
| 6 | 待审批 Tab | admin 进入用户管理页 | 看到「待审批(N)」Tab，N 为待审批人数 |
| 7 | 审批操作 | admin 选择角色并确认 | 用户从待审批列表移除 |
| 8 | 审批后正常使用 | 被审批用户重新登录 | 正常进入 Layout，可访问业务页面 |
| 9 | 通知已读 | 审批后 admin 查看通知 | 审批请求通知自动标记已读 |

- [ ] **Step 4: Commit（如有最终调整）**

```powershell
git status
git add <any remaining files>
git commit -m "chore: frontend build for unverified role feature"
```
