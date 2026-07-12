# 通知/消息中心 设计文档 (Notification Center)

> 日期：2026-07-12
> 范围：站内通知（铃铛 + 未读红点 + 下拉面板 + 通知中心页），覆盖 ECR/ECO/配置/库存/项目的知会类事件。不含邮件、不含订阅机制。
> 路线图来源：`docs/superpowers/specs/2026-07-12-pdm-completeness-roadmap.md` 的 A1 项。

---

## 1. 背景与目标

现状：ECR/ECO/配置概要有"知会人(cc_users)"字段，但**只存不推**——被知会的人无从感知。`my-todos` 已聚合"待我审批/被驳回"的行动类待办，但缺少"我关注/参与的东西发生了变化"的知会类事件流。

**目标**：建立纯站内通知系统，让知会类事件（状态变更、被加知会人、被指派任务等）主动触达相关用户。

**非目标**：
- 不做邮件/短信通知（User 表无 email，暂不扩展）。
- 不做订阅机制（用户主动订阅任意对象变更）。
- 不替代 my-todos（见 §2 分工）。
- 不做通知合并/去重（每事件一条，保留完整时间线）。

## 2. 通知 vs 待办的分工

| | my-todos（已有，保留） | 通知中心（本次新增） |
|---|---|---|
| 性质 | **行动类**：需要我处理 | **知会类**：告知我，无需动手 |
| 例子 | 待我审批、我发起被驳回待改 | 我的 ECR 已通过、被加为知会人、任务被指派给我 |
| 展示 | 仪表盘 MyTodosTile | 顶栏铃铛 + 下拉面板 + 通知中心页 |

**原则**："提交待审批"这类"待你处理"的行动类事件**不发通知**（归 my-todos）；通知专注知会类。二者互不重叠。

## 3. 数据模型

新增表 `notifications`（参照 OperationLog 的实体关联模式，走正规范式）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `recipient_id` | UUID, FK→users.id, indexed | 接收人 |
| `sender_id` | UUID, nullable | 触发者（系统事件可空） |
| `event_type` | String(48) | 事件类型，如 `ecr_approved`、`eco_rejected`、`cc_added`、`task_assigned` |
| `title` | String(255) | 通知标题，如 "ECR-2026-0007 审批通过" |
| `body` | String(512), nullable | 描述，如 "你发起的变更请求已通过全部审批" |
| `target_type` | String(32) | 关联实体类型：`ecr`/`eco`/`configuration_profile`/`inventory_document`/`project_task` |
| `target_id` | String(64) | 关联实体 ID（用于前端跳转） |
| `is_read` | Boolean, default False, indexed | 已读标记 |
| `read_at` | DateTime, nullable | 阅读时间 |
| `created_at` | DateTime, server_default now | |

索引：`(recipient_id, is_read)` 复合索引（未读计数与列表查询主路径）、`(recipient_id, created_at desc)`。

**扇出写入（fan-out）**：一个业务事件 → 对每个收件人各插入一行 notification，各自独立已读状态。

**保留策略**：永久保留 + 用户手动"清除已读"。不自动删除。

## 4. 后端设计

### 4.1 通知服务（集中埋点）

新增 `backend/app/notifications.py`：

```python
def create_notifications(db, *, recipient_ids, sender_id, event_type,
                         title, body, target_type, target_id) -> None:
    """对一组收件人扇出写入通知（去重 recipient，排除 sender 自己可选）。"""
```

**埋点位置**：在各模块状态变更的统一函数内调用，而非散落各路由：
- `crud_ecr.py::change_ecr_status` / ECR cc 端点
- `crud_eco.py::change_eco_status` / ECO cc 端点
- `crud_configuration.py::review_profile` / `archive_profile`
- `crud_inventory.py::review_document` / `post_document`
- `crud_project.py::create_task` / `update_task`（指派变化）

### 4.2 事件清单（初版覆盖）

| 模块 | 事件 | event_type | 收件人 |
|---|---|---|---|
| ECR | 审批通过 | `ecr_approved` | 创建人 + cc_users |
| ECR | 审批驳回 | `ecr_rejected` | 创建人 + cc_users |
| ECR | 关闭 | `ecr_closed` | cc_users |
| ECR | 被加为知会人 | `cc_added` | 被加的人 |
| ECO | 审批通过 | `eco_approved` | 创建人 + cc_users |
| ECO | 审批驳回 | `eco_rejected` | 创建人 + cc_users |
| ECO | 开始执行 | `eco_executing` | cc_users |
| ECO | 关闭 | `eco_closed` | cc_users |
| ECO | 被加为知会人 | `cc_added` | 被加的人 |
| 配置概要 | 审批通过 | `profile_approved` | 创建人 + cc_users |
| 配置概要 | 审批驳回 | `profile_rejected` | 创建人 + cc_users |
| 配置概要 | 归档 | `profile_archived` | 创建人 + cc_users |
| 库存单据 | 审批通过 | `inv_doc_approved` | 创建人 |
| 库存单据 | 审批驳回 | `inv_doc_rejected` | 创建人 |
| 库存单据 | 过账 | `inv_doc_posted` | 创建人 |
| 项目任务 | 被指派 | `task_assigned` | 被指派人 |

> **提交待审批**等行动类事件不发通知（归 my-todos）。收件人列表去重，并可排除操作者本人。

### 4.3 API 端点

新增 `backend/app/routers/notifications.py`（prefix `/notifications`）：

| 端点 | 说明 |
|---|---|
| `GET /api/notifications/` | 分页查询当前用户通知；支持 `is_read`、`target_type`、`page`/`page_size` 筛选 |
| `GET /api/notifications/unread-count` | 未读数（轮询调用，轻量） |
| `POST /api/notifications/{id}/read` | 单条标记已读 |
| `POST /api/notifications/read-all` | 全部标记已读 |
| `DELETE /api/notifications/read` | 清除（删除）当前用户所有已读通知 |

所有端点强制 `recipient_id == current_user.id`，用户只能访问自己的通知。

### 4.4 权限

`permissions.json` 新增：`notifications:read`（admin/engineer/production/guest 全部）。运行 `gen_permissions.py` 重新生成。

## 5. 前端设计

### 5.1 顶栏铃铛（Layout.tsx）

在顶栏右侧（同步指示器与用户名之间）加铃铛图标 + 未读红点角标。点击展开下拉面板。

### 5.2 下拉面板（图标卡片风格）

- 宽约 360px，展示最近约 10 条通知。
- 每条：左侧事件类型彩色图标（✅通过/↩️驳回/👁知会/📦归档/📥过账），右侧标题（粗）+ 描述 + 相对时间。
- 未读：浅蓝底 + 右侧蓝点。
- 顶部"全部已读"，底部"查看全部通知 →"跳转通知中心页。
- 点击单条：标记已读 + 跳转到对应实体详情。

### 5.3 通知中心页（/notifications）

- 顶部操作：全部标为已读、清除已读。
- 筛选标签：全部 / 未读 / 按模块（变更 ECR·ECO / 配置 / 库存 / 项目）。
- 按时间分组：今天 / 更早。
- 图标卡片列表（同下拉风格），未读高亮，点击跳转。
- 分页。

### 5.4 轮询与状态

- 复用现有 10 秒轮询：在 `syncService.poll()` 中附加调用 `unread-count`（或平行的轻量轮询），更新未读数。
- 新增 `notificationStore`（Zustand），持有未读数与下拉面板的最近通知列表。
- 打开下拉面板时拉取最近列表；标记已读后本地即时更新未读数，避免等待下一轮询。

### 5.5 跳转映射

`target_type` → 前端路由：`ecr`→EC 页(ECR tab)、`eco`→EC 页(ECO tab)、`configuration_profile`→配置页、`inventory_document`→库存页(单据)、`project_task`→项目页对应任务。

## 6. 测试

- 后端：`create_notifications` 扇出与去重、各端点权限（只能访问自己的）、未读计数、标记已读、清除已读；在 change_*_status 埋点后的事件→通知生成断言（表驱动覆盖事件清单）。
- 前端：铃铛未读角标渲染、下拉面板已读交互、通知中心筛选/分组、点击跳转。
- 权限同步守卫测试（`notifications:read` 生成一致）。

## 7. 实施顺序建议

1. 数据模型 + 迁移（notifications 表，启动自动建表）。
2. `notifications.py` 服务 + 路由 + 权限（`gen_permissions.py`）。
3. 各模块 change_*_status 埋点（分模块提交，表驱动测试守护）。
4. 前端 store + 轮询接入 + 铃铛/下拉面板。
5. 通知中心页 + 跳转映射。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 埋点散落导致遗漏事件 | 集中在 change_*_status 统一函数埋点；事件清单表驱动测试 |
| 扇出写入产生大量行 | 索引 `(recipient_id, is_read)`；提供"清除已读"；收件人去重 |
| 轮询增加后端负载 | `unread-count` 端点极轻量（单条 count 查询，有复合索引） |
| 收件人含操作者本人造成自我通知 | `create_notifications` 支持排除 sender |
