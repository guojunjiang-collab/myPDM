# 权限审计 17 项问题修复计划

> **来源**：`项目说明/用户权限说明.md` 第六章「发现的问题与改进建议」（v2.0 审计，2026-07-30）
> **范围**：P0 未认证 3 项 + P1 功能缺陷 4 项 + P2 设计不一致 6 项 + P3 冗余脱钩 4 项
> **原则**：`permissions/permissions.json` 是唯一事实源；改完必须 `python tools/gen_permissions.py` 重新生成；
> 每项都要有测试或实测证据，不留"改了但没验证"的项。

---

## 任务 0（前置）：修复既有 24 个失败测试

**现状**：`cd backend; pytest` 基线 **24 failed / 339 passed**。全部由 v3.1.3 的
`creator_id` 下移（Master/Revision → Iteration）造成，测试从未跟着改：

| 测试文件 | 失败数 | 原因 |
|---|---|---|
| `tests/test_deliverables.py` | 14 | `PartMaster(creator_id=…)` / `PartRevision(creator_id=…)` 已无该列 |
| `tests/test_document_content_access.py` | 6 | 用 `models.Document`（= DocumentRevision 别名）造带 `code`/`name`/`creator_id` 的对象 |
| `tests/test_user_groups_api.py` | 4 | 同上 `_doc()` 辅助函数 |

**为什么必须先做**：这批测试正好覆盖 #5 要改的图文档访问链路。基线不绿，
后面所有改动都无法用测试证明"没改坏"。

**做法**：把测试辅助函数改造为三层模型（Master → Revision → Iteration，
`creator_id` 写到 Iteration），不改被测代码。

**验收**：`pytest` 0 failed。

---

## P0：未认证端点（3 项）

### 任务 1 — #1/#2 零部件附件上传/删除端点补认证

**文件**：`backend/app/routers/parts.py`

| 端点 | 改动 |
|---|---|
| `POST /revisions/{revision_id}/attachments`（:922） | 加 `current_user: User = Depends(require_permission("attachments:upload"))` |
| `DELETE /revisions/{revision_id}/attachments/{attachment_id}`（:999） | 加 `require_permission("attachments:delete")`；新增 `_attachment_belongs_to_revision()` 校验（附件 → 迭代 → 版本 回溯），不匹配返回 404；补 `crud.create_log` 操作日志 |

**验收**：
- 无 token `DELETE` → **401**（当前是 404，即已进入处理函数）
- 无 token `POST` → 401
- guest token `DELETE` → 403
- 用 A 版本路径删 B 版本附件 → 404

### 任务 2 — #3 `/api/settings/cad-naming` 补认证

**文件**：`backend/app/routers/settings.py`
改动：挂 `require_permission("parts:read")`（全角色可读，仅要求登录）。不新增权限项，避免矩阵膨胀。

**验收**：无 token → 401；任意角色 token → 200。

---

## P1：功能性缺陷（4 项）

### 任务 3 — #4 `attachments:list` 放开到 production / guest

**文件**：`permissions/permissions.json`、`backend/app/routers/parts.py`

- `attachments:list`：`[admin, engineer]` → **全 4 角色**（与已全开的 `attachments:download` 对齐）
- `GET /parts/revisions/{id}/attachments/{aid}/file` 的门禁从 `attachments:list` 改为 `attachments:download`（该端点返回文件内容，语义应属下载）
- 写类不动：`attachments:upload` / `:delete` 仍为 admin+engineer

**风险**：guest 可列出零部件附件元数据。评估：guest 本来就有 `attachments:download`
可直接取内容，不构成新增暴露；零部件附件不受用户组管控（这是既有设计）。

**验收**：production/guest 打开零部件详情不再 403，能看到并下载生产附件；上传/删除按钮仍不可用。

### 任务 4 — #5 修复图文档「创建者始终可访问」失效

**文件**：`backend/app/permissions/policies.py`、`backend/app/crud_groups.py`

1. `_document_content_access` 签名改为显式接收 `creator_id=None`，**删掉**
   `getattr(document, "creator_id", None)`（DocumentMaster 上根本没这列，恒为 None）
2. `crud_groups` 新增 `get_document_creator_id(db, master_id)`：
   join `DocumentRevision → DocumentIteration`，按 `revision.created_at, iteration` 升序取首条 `creator_id`
3. 新增 `_access_ctx()` 统一组装策略入参，`document_is_accessible` /
   `enforce_document_content_access` 共用
4. **性能**：`creator_id` 仅在"未关联组"和"组交集非空"都不成立（即将被拒）时才查库。
   图文档列表页 `page_size=10000`，不能给每行都加一次查询

**验收**：
- 新增测试：创建者不在任何关联组内，仍可下载自己文档的附件
- 新增测试：非创建者非组员 → 403
- 测试用**真实 ORM 对象**，不再用 `SimpleNamespace`（这正是当初漏掉的原因）
- 列表接口 SQL 条数不增加（无组关联的常见场景不触发 creator 查询）

### 任务 5 — #6 `bom:delete_relation` 放开到 engineer

**文件**：`permissions/permissions.json`
改动：`[admin]` → `[admin, engineer]`。

**不做**：不加"仅草稿且本人签出"的对象策略。理由——`bom:create_relation`
（engineer 可用）也没有该前置条件，先保持增删对称；若要加，应作为独立任务同时加到增和删两侧。

**验收**：engineer 能删除自己签出草稿版本上的 BOM 行；guest/production 仍 403。

### 任务 6 — #7 库存单据补参与者门禁

**文件**：`backend/app/permissions/policies.py`、`backend/app/routers/inventory.py`、`permissions/permissions.json`

1. 新增策略 `inventory_doc_participant_or_admin`：admin / `creator_id` / `keeper_id` /
   `reviewers[].user_id` 之一 —— 与 `crud_inventory.list_documents` 的行级过滤同口径
2. `permissions.json` 在 `inventory.doc:write` / `:delete` / `:submit_withdraw_approve`
   上声明该策略（`:read` 不声明——列表端点没有单一对象）
3. 路由新增 `_enforce_doc_participant()`，在 8 个单据级端点调用：
   `GET/PUT/DELETE /documents/{id}`、`submit`、`withdraw`、`review`、`assign-keeper`、`cancel`
   （`post` 已有更严的 keeper 策略，不叠加）

**验收**：
- 新增测试：非参与者 production 用户拿到 UUID 后 `GET`/`PUT`/`DELETE` → 403
- 创建者 / 保管人 / 审批人 / admin 正常通过
- 列表接口行为不变

---

## P2：设计不一致（6 项）

### 任务 7 — #8/#9 配置方案审批与抄送用专属权限

**文件**：`permissions/permissions.json`、`backend/app/permissions/policies.py`、`backend/app/routers/configuration.py`

1. 新增 `profile:approve` = `[admin, engineer, production]` + 对象策略 `profile_approver_or_admin`
2. 新增 `profile:cc_manage` = 全 4 角色（对齐已有的 `ecr:cc_manage` / `eco:cc_manage`）
3. 新增策略 `profile_approver_or_admin`：admin 或 `profile.reviewers[].user_id` 命中
4. `POST /profiles/{id}/review`：`profile:read` → `profile:approve` + `enforce_object_policy`
5. `POST|DELETE /profiles/{id}/cc`：`profile:read` → `profile:cc_manage`
6. `crud.review_profile` 内的审批人校验**保留**（纵深防御）

**为什么 production 保留审批资格**（不完全照抄 ECR 的 admin+engineer）：
库存审批 `inventory.doc:submit_withdraw_approve` 已含 production，且现网可能已有
production 审批人；收紧到 admin+engineer 会让存量审批流卡死。**只排除 guest**。
—— 此处与 ECR 的差异需在权限说明文档中显式记录。

**验收**：guest 调 review → 403（角色门）；未被指定的 engineer → 403（对象策略）；
被指定审批人 → 通过。

### 任务 8 — #10 通知写操作拆出独立权限

**文件**：`permissions/permissions.json`、`backend/app/routers/notifications.py`
改动：新增 `notifications:manage_own`（全 4 角色）；`POST /{id}/read`、`POST /read-all`、
`DELETE /read` 从 `notifications:read` 改挂它；两个 GET 保持 `notifications:read`。
模块 docstring 说明"一律 self-scoped"。

**验收**：功能行为不变（4 角色都能标记自己的通知已读）；权限矩阵能表达读/写差异。

### 任务 9 — #11/#12 看板判定合并为单一路径

**文件**：`backend/app/permissions/policies.py`、`backend/app/routers/dashboard.py`

1. `_dashboard_folder_editor` 改签名：`(user, folder, *, owner_user_id=None, editor_user_ids=frozenset())`
   —— 不再读 `folder.owner_user_id`（模型无此列）、不再读 `folder.shares`（无法表达祖先继承）
2. `_check_folder_edit_permission` 成为**全模块唯一入口**：算出
   看板 owner + 「本文件夹 ∪ 全部祖先」上 `permission == "edit"` 的用户集合 → 调策略
3. 删除 4 处 `folder.owner_user_id = …; enforce_object_policy(…)` 的属性注入写法，
   统一改调 `_check_folder_edit_permission`
4. 顺带修一个撞见的既有 bug：`PUT /folders/{folder_id}/shares/{share_id}`
   里 `folder` 变量从未定义（原代码 `folder.owner_user_id = …` 就会 NameError → 500），
   补上 folder 查询

**验收**：
- 通过祖先共享获得 edit 的用户，改名与共享管理**行为一致**（之前改名可以、管共享 403）
- 更新共享权限端点不再 500
- 更新 `tests/test_object_policies.py` 改用新签名

### 任务 10 — #13 项目双层角色落到前端

**文件**：`backend/app/routers/projects.py`、`frontend/src/types/project.ts`、`frontend/src/pages/Project/Projects.tsx`

1. `_project_detail(db, p, user=None)` 增返 `is_manager`（复用 `_is_manager`）与 `my_role_in_project`
2. 三个调用点传入 `current_user`（create / get / update）
3. 前端 `Project` 类型加这两个可选字段
4. `Projects.tsx` 的 `isManager` 改为 `can('project.task:create') && currentProject?.is_manager === true`

**验收**：以「成员」身份进项目详情，「成员管理」「+ 新建顶层任务」「+子」按钮不再出现；
以「经理」身份正常出现；admin 在任何项目都出现。

---

## P3：冗余与脱钩（4 项）

### 任务 11 — #14 清理 10 个死权限

**文件**：`permissions/permissions.json`

删除（后端无门禁、前端 `can()` 也不用）：
`parts.bom:manage`、`parts.bom:export_single`、`parts.bom:import_export_all`、
`documents:import_export_all`、`documents.attachment:preview`、`configuration:export`、
`ecr:export_pdf`、`eco:export_pdf`、`users:reset_password`、`users:import_export`

**选择"删除"而非"恢复使用"的理由**：这些功能已下沉到前端生成（Excel/PDF）或改走别的
权限（重置密码 = `PUT /users/{id}` 的 `users:update`）。保留一个永不校验的权限项，
比没有它更糟——会让人误以为有后端保障。

**风险检查**：删前用 grep 确认 `frontend/src` 无 `can('…')` 引用（`permissions.generated.ts`
的 `Permission` 联合类型会因此收窄，若有引用会在 `tsc` 阶段直接报错，属安全网）。

### 任务 12 — #15 导航改用 `nav.*` 权限

**文件**：`permissions/permissions.json`、`frontend/src/components/Layout.tsx`

1. 删除 `nav.admin_tools`（对应的"管理工具"菜单早已不存在）
2. 新增 11 项与实际菜单一一对应：`nav.dashboard`、`nav.board`、`nav.configuration`、
   `nav.parts`、`nav.documents`、`nav.ec`、`nav.inventory`、`nav.projects`、
   `nav.users`、`nav.settings`、`nav.help`
3. `NavItem` 类型的 `roles: string[]` 改为 `perm: Permission`；过滤条件
   `item.roles.includes(userRole)` → `can(item.perm)`

**取值决定**（保持现有可见性，仅修两处不一致）：
- `nav.projects` = **全 4 角色**（原本排除 guest）。理由：`project:read` 给了 guest，
  且 `GET /projects/my-tasks` 被仪表盘调用；收紧 API 反而会让 guest 仪表盘报错。
  同时把 `project.task:comment` 的 guest 去掉 —— guest 应当只读，不应评论。
  这样"可见 = 可读、不可写"，两侧一致。
- `nav.users` = `[admin, engineer, production]`（guest 不再看到用户管理菜单）
- `nav.settings` = **全 4 角色**（含"修改密码"，所有角色都必须能进；原 json 写的
  admin+engineer 与实际不符）
- 其余 = 全 4 角色，与现状一致

### 任务 13 — #16 `canDownload()` 绑定真实权限

**文件**：`permissions/permissions.json`、`frontend/src/stores/auth.ts`
改动：新增 `parts:export` = `[admin, engineer, production]`；
`canDownload = () => can('parts:read')` → `can('parts:export')`，并加注释说明
"导出目前由前端生成，此判定仅为 UI 约束"。

**影响面**：`ECODetailModal` / `ECRDetailModal` / `Inventory/DocumentTab` 三处导出按钮
对 guest 隐藏（恢复 v1.3 的设计意图）。

### 任务 14 — #17 用户列表手机号脱敏

**文件**：`backend/app/routers/users.py`
改动：`GET /users/` 对非 admin 返回 `phone = None`（本人记录除外）。
`users:read` **保持全 4 角色** —— 看板共享选人、任务指派、审批人选择都依赖它，
收紧会连带破坏 guest 的看板共享功能。

**验收**：admin 看到手机号；engineer/production 看到自己的手机号、别人的为空；
用户管理页的部门/角色/状态列不受影响。

---

## 收尾任务

### 任务 15 — 加"策略声明未调用"防回归检查
新增测试：遍历 `OBJECT_POLICIES` 的每个 policy 名，断言
① 已在 `policies.py` 注册；② 在 `backend/app/routers/` 下至少有一处
`enforce_object_policy`/`check_object_policy` 调用。
—— 这正是 #11 那类"声明了却没人调用"能长期潜伏的原因。

### 任务 16 — 回写权限说明文档
`项目说明/用户权限说明.md`：矩阵用脚本重新生成；第六章 17 项逐条标注
「已修复 / 修复方式 / 与建议的偏差及原因」（任务 7 的 production 保留、
任务 5 的不加前置条件、任务 14 的不收紧 users:read 都要写清楚）；
第四章补 3 条新策略；附录 A 更新。

### 任务 17 — 验证与部署
1. `cd backend; pytest` → 期望 0 failed（基线 24 → 0）
2. `cd frontend; npm run build`（prebuild 自动 `gen_permissions.py`，顺带校验 json 合法）
3. 无 token 实测 3 个 P0 端点 → 401
4. 四个角色（admin/engineer/production/guest）各登录一次，走查：
   零部件附件列表、图文档下载、项目详情按钮、库存单据、导航菜单
5. `docker restart bom_backend`（backend/app 为 volume 挂载）
   + `docker-compose up -d --force-recreate nginx`
6. 提交

---

## 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 删权限项导致前端 `tsc` 失败 | 构建中断 | 属预期安全网；`tsc` 报错即说明有引用，逐个改 |
| 库存参与者门禁过严 | 现网用户打不开自己看得见的单据 | 门禁口径与 list 过滤**完全一致**，凡列表能看到的必然通过 |
| `project.task:comment` 去掉 guest | guest 无法评论 | 符合 guest = 只读定位；如需保留，只改这一行 |
| `canDownload` 收紧 | guest 少了导出按钮 | 恢复原设计意图；如需放开改回 `parts:read` |
| 任务 0 改测试掩盖真实缺陷 | 假绿 | 只改测试**辅助函数**造数据的方式，不改断言 |

**回滚**：所有改动集中在 `permissions/permissions.json` + 11 个后端文件 + 5 个前端文件，
单次提交，`git revert` 即可整体回退。

---

## 执行顺序

```
任务 0（测试基线）
  → 任务 1、2（P0，独立，可并行）
  → 任务 3、4、5、6（P1）
  → 任务 7、8、9、10（P2）
  → 任务 11、12、13、14（P3，都要动 permissions.json，串行避免冲突）
  → 任务 15（防回归）
  → 任务 16（文档）
  → 任务 17（验证部署）
```

---

## 附：本计划编写前已误提前实施的部分

计划前已改动的文件（未提交、未构建、未部署），内容与上述任务 1–14 一致，
但**任务 0 只做了一半**（`test_deliverables.py` 的 `_part()`），
且任务 15/16/17 完全未做：

```
permissions/permissions.json
backend/app/permissions/policies.py   backend/app/permissions/_generated.py（生成物）
backend/app/crud_groups.py
backend/app/routers/{parts,settings,inventory,configuration,notifications,dashboard,projects,users}.py
backend/tests/test_deliverables.py
frontend/src/{stores/auth.ts,components/Layout.tsx,types/project.ts,pages/Project/Projects.tsx}
frontend/src/constants/permissions.generated.ts（生成物）
```

当前测试状态：26 failed / 337 passed（基线 24 failed；新增 2 个失败为
`test_object_policies.py::test_dashboard_folder_editor_owner_and_share` 与
`test_document_group_policy.py::test_creator_always_allowed`，
两者都是用旧签名/`SimpleNamespace` 断言，属任务 0/4/9 待改内容）。

**待你决定**：
- **A** 保留这批改动，按计划从任务 0 继续补齐（测试、防回归、文档、验证部署）
- **B** `git checkout -- .` 全部回退，审定计划后从任务 0 重新开始
