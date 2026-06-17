# 用户权限系统巩固方案 (Permission System Hardening)

> 日期: 2026-06-17
> 范围: 在保留现有 4 角色的前提下，建立权限「单一事实源」，根除前后端漂移，并完成选定的安全加固。
> 实施状态: **全部完成** (Phase 0–5, 后端 156 tests pass, 前端构建通过, Docker 部署正常)
> 源文档: `项目说明/用户权限说明.md`（权威权限矩阵）

---

## 1. 背景与问题

当前权限实现存在以下问题：

- **后端**: `require_role([...])` 中硬编码角色字符串列表，散落在 **19 个路由 / 209 处调用**。少数路由自定义 `READ_ROLES`/`WRITE_ROLES`/`MASTER_ROLES` 常量，但不统一。
- **前端**: 4 个硬编码辅助函数（`canEdit`/`canDownload`/`canPreview`/`isAdmin`）用于 **22 个文件 / 94 处**，外加直接 `hasRole([...])`，与后端决策重复、易漂移。
- **业务级规则**（创建者/审批人/保管人/文件夹分享）以内联 `if` 散落在各 handler。
- **已知缺陷**：
  - `?token=` 查询参数把**会话 JWT** 直接放进 URL（5 个附件端点），会泄漏进日志/浏览器历史/Referer；其中 `preview` 端点的 docstring 声称限制角色，实际代码未校验角色。
  - JWT 过期不一致：`ACCESS_TOKEN_EXPIRE_MINUTES = 480`，但登录实际签发 `timedelta(minutes=60)`。
  - `JWT_SECRET` 缺省时静默使用弱默认值 `"bom-secret-key-change-in-production"`。
  - 创建/编辑用户时 `role` 未校验，可写入非法角色字符串。

## 2. 目标与非目标

**目标**
1. 建立权限**单一事实源**（一份定义文件 + 代码生成），从结构上根除前后端漂移。
2. 引入**三层权限模型**，把简单的角色门与复杂的对象级规则分离。
3. 完成选定的安全加固：JWT 过期统一 + 刷新、收紧 `?token=`、角色值校验 + 密钥加固。
4. 全程**行为保持**，可逐路由迁移、可回归验证。

**非目标（本次不做）**
- 不引入数据库驱动的可配置 RBAC（角色/权限存表 + 管理 UI）。
- 不做权限拒绝（403）审计日志。
- 不做登录限流 / 多角色 / 每资源 ACL。

## 3. 权限模型 — 三层

| 层 | 职责 | 实现 |
| - | - | - |
| ① 认证 Authentication | 你是谁 + 账户是否启用 | `get_current_user` → `get_current_active_user`（形态不变，见 §7 加固） |
| ② 角色门 Role gate | 角色能否做某操作（粗粒度，95% 场景） | `require_permission("resource:action")`，查生成的矩阵 |
| ③ 对象级策略 Object policy | 与具体对象+用户关系相关的规则（5% 场景） | 命名策略函数，角色门通过后显式调用 |

**对象级策略清单**（从现有内联检查抽取、集中）：

| 策略名 | 规则 | 应用处 |
| - | - | - |
| `ecr_owner_or_admin` | 仅创建者或 admin（draft 状态） | ECR 编辑/删除/提交/撤回 |
| `ecr_approver_or_admin` | 仅指定审批人或 admin | ECR 审批 |
| `eco_owner_or_admin` | 仅创建者或 admin | ECO 编辑/删除/提交/撤回 |
| `inventory_keeper_or_admin` | 仅指定保管人或 admin | 库存单据过账 |
| `dashboard_folder_editor` | 文件夹所有者，或被分享且 `permission=="edit"` | 共享文件夹的修改类操作 |

## 4. 单一事实源 — `permissions/permissions.json`

位置: 项目根 `permissions/permissions.json`。格式 JSON（Python 与 TS 原生解析，**零新增依赖**）。

```jsonc
{
  "roles": ["admin", "engineer", "production", "guest"],
  "permissions": {
    "parts:read":   ["admin", "engineer", "production", "guest"],
    "parts:create": ["admin", "engineer"],
    "parts:delete": ["admin"],
    "ecr:update":   { "roles": ["admin", "engineer"], "object_policy": "ecr_owner_or_admin" },
    "inventory.doc:post": { "roles": ["admin", "engineer", "production"], "object_policy": "inventory_keeper_or_admin" }
  }
}
```

- 键 = `resource:action`（点号用于子资源，如 `parts.doc:link`）。
- 值 = 角色数组，或 `{ "roles": [...], "object_policy": "<name>" }`。
- 完整矩阵见 §5，直接由 `项目说明/用户权限说明.md` + 209 处真实调用点种入，行为对齐当前实现。

## 5. 完整权限矩阵（种子）

> 角色简写: A=admin, E=engineer, P=production, G=guest。`+policy` 表示附加对象级策略。

### 零件 parts
- `parts:read` → A E P G
- `parts:create` → A E
- `parts:update` → A E
- `parts:delete` → A
- `parts:export` → A E P
- `parts:import` → A E  *(见 §6 待定项 D1)*
- `parts.doc:read` → A E P G
- `parts.doc:link` → A E
- `parts.doc:unlink` → A E

### 部件 assemblies
- `assemblies:read` → A E P G
- `assemblies:create` / `assemblies:update` → A E
- `assemblies:delete` → A
- `assemblies.bom:manage` → A E
- `assemblies.bom:export_single` → A E P
- `assemblies.bom:import_export_all` → A
- `assemblies.doc:read` → A E P G
- `assemblies.doc:link` / `assemblies.doc:unlink` → A E

### 图文档 documents
- `documents:read` / `documents:read_refs` → A E P G
- `documents:create` / `documents:update` → A E
- `documents:delete` → A
- `documents:import_export_all` → A
- `documents.attachment:upload` → A E
- `documents.attachment:download` / `documents.attachment:preview` → A E P G
- `documents.attachment:delete` → A E

### 附件 V2 attachments
- `attachments:list` → A E  *(P/G 不可，见 §6 待定项 D3)*
- `attachments:upload` → A E
- `attachments:download` / `attachments:preview` / `attachments:direct_download` → A E P G
- `attachments:gltf` → A E P *(排除 G)*
- `attachments:archive_browse` → A E P *(排除 G)*
- `attachments:delete` → A E
- `attachments:convert_manage` → A

### BOM 管理 bom（G 完全排除）
- `bom:tree` / `bom:compare` / `bom:trace` / `bom:doc_refs` / `bom:export` → A E P
- `bom:create_relation` → A E
- `bom:delete_relation` → A

### 构型配置 configuration
- `configuration:read` / `profile:read` → A E P G
- `configuration:create` / `configuration:update` → A E
- `configuration:delete` → A
- `profile:create` / `profile:update` → A E
- `profile:delete` → A
- `profile:activate_archive` → A E
- `profile:change_status` → A
- `configuration.doc:manage` / `configuration.item:manage` / `profile.bom:manage` → A E
- `configuration:export` → A E P

### 变更 ECR
- `ecr:read` / `ecr:read_status_log` / `ecr:bom_trace` / `ecr:cc_manage` → A E P G
- `ecr:create` → A E
- `ecr:update` → A E `+ecr_owner_or_admin`
- `ecr:delete` → A E `+ecr_owner_or_admin`
- `ecr:submit` → A E `+ecr_owner_or_admin`
- `ecr:withdraw` → A E `+ecr_owner_or_admin`
- `ecr:approve` → A E `+ecr_approver_or_admin`
- `ecr:close` → A E
- `ecr:export_pdf` → A E P

### 变更 ECO
- `eco:read` / `eco:read_status_log` / `eco:bom_trace` / `eco:cc_manage` → A E P G
- `eco:create` → A E
- `eco:update` / `eco:delete` / `eco:submit` / `eco:withdraw` → A E `+eco_owner_or_admin`
- `eco:close` → A E
- `eco:execute` / `eco:execute_item` / `eco:execute_all` → A E
- `eco:revise` / `eco:restore` / `eco:freeze` / `eco:publish` → A E
- `eco.affected:manage` → A E
- `eco:export_pdf` → A E P

### 库存 inventory
- `inventory.warehouse:read` / `inventory.material:read` / `inventory.stock:read` / `inventory.doc:read` → A E P G
- `inventory.warehouse:write` → A E
- `inventory.warehouse:delete` → A
- `inventory.material:write` / `inventory.material:enable_from_pdm` → A E
- `inventory.material:delete` → A
- `inventory.doc:write` / `inventory.doc:delete` / `inventory.doc:submit_withdraw_approve` → A E P
- `inventory.doc:post` → A E P `+inventory_keeper_or_admin`

### 用户看板 dashboard
- `dashboard:read` → A E P G
- `dashboard.folder:create` / `dashboard.folder:rename` / `dashboard.folder:delete` → A E P G `+dashboard_folder_editor`(共享时)
- `dashboard.item:add` / `dashboard.item:delete` → A E P G `+dashboard_folder_editor`(共享时)
- `dashboard.folder:share` / `dashboard.folder:unshare` → A E P G `+dashboard_folder_editor`(所有者)
- `dashboard:export_all` / `dashboard:import_all` → A

### AI 助手 assistant
- `assistant:chat` / `assistant:download_artifact` → A E P G

### 用户管理 users
- `users:read` → A E P G *(列表)*
- `users:read_detail` / `users:create` / `users:update` / `users:delete` / `users:reset_password` / `users:import_export` → A

### 操作日志 logs
- `logs:read` → A

### 自定义字段 / 系统设置 custom_fields + admin
- `custom_field.def:read` / `custom_field.def:write` / `custom_field.def:sort` → A
- `custom_field.value:read` → A E P G
- `custom_field.value:write` → A
- `custom_field:reset_data` → A
- `admin.soft_delete:read` / `admin.soft_delete:cleanup` → A

### 数据同步 sync
- `sync:read` → A E P G

### 前端导航可见性（仅前端 UI）
- `nav.admin_tools` → A E P
- `nav.settings` → A E *(engineer 仅见基础设置标签页)*

## 6. 不一致项裁决（已全部定案落实）

> 实施状态：5 项全部依照默认裁决落地，参见下方每个条目的「实施记录」。

| # | 现象 | 裁决 | 实施记录 |
| - | - | - | - |
| D1 | 矩阵「导入导出零件 Excel」含 P，但导入是写操作；按钮级「导入数据」用 `canEdit`(A E) | 拆为 `parts:export`(A E P) + `parts:import`(A E) | 已落地于 `permissions/permissions.json`；前端 `canDownload()` → `can('parts:export')`、`canEdit()` → `can('parts:create')` |
| D2 | `preview` 端点 docstring 称限制角色，代码未校验 | 预览对全角色开放（与矩阵一致），删除误导性 docstring | 已落地：5 个附件端点迁移为媒体令牌校验，角色门移至签发端点 `GET /{id}/media-token?action=preview`，通过 `attachments:preview`(A E P G) 校验；docstring 已清理 |
| D3 | 附件列表 `attachments:list` 后端为 A E，但 P 可下载/预览 | 列表保持 A E（与路由实际一致），下载/预览全角色 | 已落地于 `permissions/permissions.json`：`attachments:list`(A E)、`attachments:download`(A E P G)、`attachments:preview`(A E P G) |
| D4 | 库存 `canEdit()` 显示按钮 vs 后端 `MASTER_ROLES` | 二者一致(A E)，前端改用 `can('inventory.warehouse:write')` 表达 | `can()` 已就绪（Phase 3），库存路由已迁移为 `require_permission("inventory.warehouse:write")`；存量调用点维持 `canEdit()` 薄封装，增量逐批改造 |
| D5 | engineer 可见「系统设置」导航但自定义字段定义为 admin-only | `nav.settings` 对 E 可见但仅基础设置；字段定义操作仍 A-only | 已落地于 `permissions/permissions.json`：`nav.settings`(A E)、`custom_field.def:*`(A) |

## 7. 代码生成

`tools/gen_permissions.py`（纯 stdlib），读取 `permissions/permissions.json`，产出两份**提交入库**的产物：

- `backend/app/permissions/_generated.py` — `PERMISSIONS: dict[str, list[str]]`、`ROLES: list[str]`、`OBJECT_POLICIES: dict[str, str]`（perm → policy 名）。
- `frontend/src/constants/permissions.generated.ts` — `PERMISSIONS` 映射 + `Permission` 字符串字面量联合类型（`can('parts:delete')` 拼错即编译报错）。

**为何提交产物**: 后端通过 Docker volume 挂载 `./backend/app`，无构建步骤，生成的 `.py` 必须随源码提交。前端在 `package.json` 加 `pregen`/`prebuild` 钩子 + 文档化命令 `python tools/gen_permissions.py`。

**防漂移**: `backend/tests/test_permissions_sync.py` 在内存中重跑生成器，断言其输出与已提交的两份产物逐字节一致 —— 改了 JSON 忘记重生成 → 测试变红，结构上杜绝漂移。

## 8. 执行层重构

### 后端
新增 `backend/app/permissions/__init__.py`：
- `require_permission(perm: str)` — FastAPI 依赖，替代 `require_role([...])`；查 `PERMISSIONS[perm]`，`current_user.role not in allowed` 抛 403（detail 含 perm 名）。
- `has_permission(user, perm) -> bool` — 内联判断用。
- `enforce_object_policy(name, user, obj)` — 对象级策略注册表与执行入口；角色门通过后由 handler 显式调用，违反抛 403。

迁移全部 **209 处** `require_role([...])` → `require_permission("...")`；删除各路由的 `READ_ROLES`/`WRITE_ROLES`/`MASTER_ROLES` 局部常量；把内联创建者/审批人/保管人/分享检查替换为 `enforce_object_policy(...)`。

### 前端
- `frontend/src/stores/auth.ts` 新增 `can(perm: Permission): boolean` —— 用当前用户角色 × 生成的 `PERMISSIONS` 判定。
- `canEdit`/`canDownload`/`canPreview`/`isAdmin` 改为 `can(...)` 的薄封装（不强制一次性改完 94 处）；新代码与被触达的旧代码改用 `can('...')`。

## 9. 安全加固（选定 3 项）

### 9.1 JWT 过期统一 + 刷新
- 收敛为单一配置：访问令牌 **8 小时**（即现有 480，修复登录处 60 分钟的不一致）。
- 新增 `POST /api/auth/refresh`：用较长寿命刷新令牌（约 7 天）换取新访问令牌。
- 前端 axios 拦截器：收到 401 时自动调用 `/auth/refresh` 重试，避免会话中途被登出。

### 9.2 收紧 `?token=` 查询参数
- 新增「媒体令牌」：由经过 `require_permission` 校验的已认证端点签发短寿命（约 5 分钟）令牌，**作用域绑定 `{attachment_id, action}`**。
- 5 个附件端点（`preview`/`direct-download`/`gltf`/`archive-tree`/`extract-file`）改为校验**媒体令牌**（而非会话 JWT），校验作用域 + TTL + action 匹配。
- 顺带修复 `gltf`/`archive` 排除 guest 的缺失校验（在签发媒体令牌时通过 `require_permission` 完成）。

### 9.3 角色值校验 + 密钥加固
- `UserCreate`/`UserUpdate` 加 Pydantic 校验：`role` 必须 ∈ 生成的 `ROLES`，否则 422。
- 后端启动时若 `JWT_SECRET` 未设置或等于弱默认值 → 拒绝启动（fail fast）。

## 10. 测试

- `test_permissions_sync.py` — 生成物漂移守卫。
- `test_require_permission.py` — 表驱动：遍历每个 permission，断言四角色各自得到 200/403 与矩阵一致。
- `test_object_policies.py` — 5 个对象级策略的单元测试。
- 安全项：刷新令牌流程、媒体令牌作用域/TTL、角色 422 校验、密钥 fail-fast。
- 现有后端测试套件须全部保持绿（行为保持）。

## 11. 迁移 / 上线策略

**增量、行为保持**：矩阵种子完全复刻当前行为，因此重构是机械的、受测试守护的替换，**逐路由迁移**（每个路由由表驱动测试验证四角色 200/403）。安全 3 项各自独立提交。不采用大爆炸式重写。

建议提交顺序：
1. `permissions.json` + 生成器 + 生成物 + 同步守卫测试。
2. 后端 `require_permission`/对象策略骨架 + 表驱动测试。
3. 逐路由迁移（19 个路由，分多次提交）。
4. 前端 `can()` + 薄封装改造。
5. 安全加固 9.1 / 9.2 / 9.3（各自独立提交）。
6. 更新 `项目说明/用户权限说明.md` 与 `AGENTS.md` 的权限章节，使文档与生成矩阵一致。

## 12. 风险与缓解

| 风险 | 缓解 |
| - | - |
| 209 处迁移遗漏/写错 perm 名 | `Permission` 联合类型（前端编译期）；后端表驱动测试覆盖每路由 |
| 生成物与定义漂移 | 同步守卫测试 |
| 媒体令牌改造影响 3D/PDF 预览既有体验 | 保持端点 URL 形态，仅替换令牌种类；前端预览/下载封装集中改造 + 手动验证 |
| 刷新令牌引入会话语义变化 | 访问令牌寿命不变(8h)，刷新仅作为续期；可灰度（先后端就绪，前端拦截器后接） |
