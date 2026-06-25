# 图文档分组权限 — 设计方案

> 日期: 2026-06-25
> 状态: 待评审
> 模块: 用户管理 / 图文档 / 权限

## 1. 背景与目标

为图文档增加**细粒度的内容访问控制**:在角色 RBAC 之上叠加一层**对象级、基于用户组**的访问限制。

权限规则:

- 文档**未关联**用户组 → 全员可见、全员可预览和下载。
- 文档**已关联**用户组 → 全员仍可见(列表照常显示),但**仅关联用户组的成员**可预览和下载。

特权绕过:

- **管理员(role=admin)** 始终可预览/下载。
- **文档创建者** 始终可访问自己创建的文档。

该控制与现有角色 RBAC **正交**:用户先要有角色赋予的 `attachments:download` / `attachments:preview` 等权限,再叠加本分组规则。

## 2. 范围

- 仅对**图文档(documents)**做分组权限管理(关联用户组在文档上设置)。
- 零件/部件通过 `document_links` 引用的图纸,**不**单独管控,但在**预览和下载这些被引用的图纸时,同样受本分组权限限制**。
  - 实现上天然满足:硬拦截放在附件内容入口(见 §5),零件/部件预览关联图纸最终也走这些入口。

## 3. 数据模型

### 3.1 新增三张表(SQLAlchemy 模型,声明即由启动自动建表)

```
user_groups                用户组
  id          UUID PK
  name        String(64)  UNIQUE NOT NULL
  description String(255)
  created_at  DateTime
  updated_at  DateTime

user_group_members         用户 ↔ 组(多对多)
  user_id   UUID FK users(id) ON DELETE CASCADE
  group_id  UUID FK user_groups(id) ON DELETE CASCADE
  PRIMARY KEY (user_id, group_id)

document_group_links       文档 ↔ 组(多对多)
  document_id UUID FK documents(id) ON DELETE CASCADE
  group_id    UUID FK user_groups(id) ON DELETE CASCADE
  PRIMARY KEY (document_id, group_id)
```

删除用户组时(真 DELETE),两张关联表记录经 FK CASCADE 级联清除;受影响文档随即回到"未关联=全员可访问"状态。

**删除文档的处理**(图文档是软删除):

- 日常删除文档 = 软删除(`documents.py:289` 仅置 `deleted_at`),行仍在表中,FK CASCADE **不触发**。但软删除时附件已被硬删(`documents.py:287`),文档已无任何可预览/下载内容,`document_group_links` 即便残留也是无害悬挂数据。
- 为保持整洁与一致(附件在软删除时即被硬删),在软删除处理里**显式删除该文档的 `document_group_links`**。
- admin 物理清理软删除数据时为真 DELETE,FK CASCADE 作为兜底自动清除残留链接。

### 3.2 documents 表新增列

- `creator_id UUID NULL` — 文档创建者。
  - 创建文档时写入 `current_user.id`。
  - 列可空,由启动时的"自动列对账"机制(`main.py:486`)自动 `ADD COLUMN`。

### 3.3 存量数据回填

一次性**幂等**脚本(置于 `tools/`,或启动迁移段落中只跑一次):

- 从 `operation_logs` 中 `action="创建图文档"`、`target_type="document"` 的记录,按 `target_id` 匹配文档,将最早一条日志的 `user_id` 回填到 `documents.creator_id`。
- 找不到对应日志的文档,`creator_id` 留空(不享有"创建者特权",但 admin 仍可访问,功能不受影响)。
- 已有 `creator_id` 的文档跳过(幂等)。

## 4. 权限判定(后端唯一真相)

单一判定函数,供所有内容入口共用。注册为 `permissions/policies.py` 中的对象策略 `document_content_access`,风格与现有 `enforce_object_policy` 一致。

```
def can_access_document_content(user, document, group_ids: set[UUID]) -> bool:
    if user.role == "admin":                 # 管理员始终放行
        return True
    if document.creator_id == user.id:        # 创建者始终放行
        return True
    if not group_ids:                         # 文档未关联组 → 全员可访问
        return True
    user_group_ids = 用户所属组集合
    return bool(user_group_ids & group_ids)   # 关联 → 仅交集非空(组成员)
```

- 该函数**只控制内容访问(预览/下载)**,**不影响列表可见性**——所有人照常看到文档(满足"全员仍可见")。
- 判定失败统一抛 `HTTPException(403)`。

## 5. 后端拦截点

判定必须在**所有能取得文件内容的入口**生效,缺一即可被绕过。代码核查发现两类入口,鉴权方式不同:

**A. 直连入口(自带 `current_user`)** — 逐个加判定:

| 文件 | 端点 |
|---|---|
| `routers/documents.py` | `GET /{doc_id}/attachments/{att_id}`(下载附件) |
| `routers/documents.py` | `GET /{doc_id}/attachments/`(列附件) |
| `routers/attachments_v2.py` | `GET /{attachment_id}`(返回 `file_data`) |
| `routers/attachments_v2.py` | `GET /{attachment_id}/download` |
| `routers/attachments_v2.py` | `GET /{attachment_id}/stream` |

**B. 媒体令牌入口(无 `current_user`,靠 `verify_media_token`)** — `preview` / `direct-download` / `gltf` / `office-pdf` / `archive-tree` / `extract-file` 六个端点都不带用户身份,**统一在令牌签发端点 `GET /{attachment_id}/media-token`(`issue_media_token`,自带 `current_user`)处判定**:不可访问则拒签令牌。无令牌即无法访问内容,是这一类的唯一收口点,DRY。

- A/B 两类都先用 `att.document_id` 回溯父文档;`documents.py` 入口直接有 `doc_id`。
- 若附件不挂任何文档,按"全员可访问"处理。
- 统一封装一个内容访问判定助手(见 §4),A 类各端点调用、B 类在 `media-token` 端点调用。

## 6. API 调整

### 6.1 用户组管理(新增 router,admin 权限)

- `GET  /user-groups` — 列出组(含成员数)
- `POST /user-groups` — 建组
- `PUT  /user-groups/{id}` — 改名/描述
- `DELETE /user-groups/{id}` — 删组(级联清关联)
- `GET  /user-groups/{id}/members` — 组成员列表
- `PUT  /user-groups/{id}/members` — 全量设置组成员(传 user_ids 数组)

新增权限 `user_groups:read`(admin)/ `user_groups:manage`(admin),写入 `permissions/permissions.json` 后跑 `tools/gen_permissions.py` 重新生成 `_generated.py`。

### 6.2 用户的组归属

为避免改动共享的 `UserResponse` 与创建/更新流程,用户的组归属用专属子资源读写(admin):

- `GET /users/{user_id}/groups` — 该用户所属组 id 列表
- `PUT /users/{user_id}/groups` — 全量设置该用户所属组(传 group_ids 数组)

这与 §6.1 的 `PUT /user-groups/{id}/members` 一起满足"两边都能改"。

### 6.3 文档接口

- `DocumentCreate` / `DocumentUpdate` 增加 `group_ids: list[UUID]` 字段;读取接口返回 `group_ids`。
- 文档列表接口为每条返回 `accessible: bool`(后端按 §4 算好),前端据此渲染锁图标/禁用按钮,**前端不重算权限逻辑**。

## 7. 前端

遵循项目现有页面风格(primary-* 配色、共享 Modal、统一表格/工具栏,见记忆 ui-style-consistency)。

### 7.1 用户管理页 `pages/Users.tsx`

- 顶部加「用户」「用户组」两个 Tab。
- 「用户组」Tab:组列表(名称/描述/成员数)+ 增删改;成员管理弹窗(从用户列表多选成员)。
- 「用户」Tab 的用户编辑弹窗:加「所属组」多选。
- **成员归属两边都能改**:既可在用户编辑弹窗设某用户的组,也可在组的成员管理弹窗设某组的成员。

### 7.2 图文档页 `pages/Documents.tsx`

- 新建/编辑弹窗:加「关联用户组」多选(空=全员可访问)。
- 列表:对 `accessible=false` 的行,预览/下载按钮置灰禁用 + 锁图标,悬停提示「需 XX 组权限」。

## 8. 迁移

- **建表/加列**:声明 SQLAlchemy 模型即可,启动时 `Base.metadata.create_all` 自动建新表、自动列对账补 `creator_id`(`main.py:486-542`),Docker 重启即生效。
- **creator_id 回填**:§3.3 的幂等脚本。
- **权限生成**:改 `permissions.json` 后跑 `gen_permissions.py`。

## 9. 测试

### 9.1 后端 pytest

- 判定函数 4 分支:admin 放行 / 创建者放行 / 未关联组全员放行 / 关联组命中成员放行、非成员拒绝。
- 内容入口拦截:A 类直连入口 5 个逐一 403;B 类令牌入口在 `media-token` 端点拒签(非成员拿不到令牌)。
- 用户组 CRUD 与成员设置接口。
- 回填脚本幂等性(重复执行结果一致)。

### 9.2 前端

- `npm run build` 通过。
- 手测:受限文档列表显示锁图标、按钮禁用;组成员可正常预览/下载;非成员 403;admin/创建者不受限。

## 10. 验收清单

- [ ] 未关联组的文档:全员可见、可预览、可下载。
- [ ] 关联组的文档:全员可见;组成员可预览/下载;非成员被拒(列表显示锁标识)。
- [ ] admin、创建者不受分组限制。
- [ ] 零件/部件引用的受限图纸,预览/下载同样被拦截。
- [ ] 用户组在用户管理页内可增删改、分配成员;成员归属两边可改。
- [ ] Docker 重启自动建表/加列;存量文档 creator_id 已尽力回填。
