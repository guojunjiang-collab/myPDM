# 统一审批流引擎设计（组织链审批 + 角色流审批）

> 日期：2026-08-23
> 状态：已评审通过（架构 / 数据模型 / 解析与流转 / 前端 / 迁移权限测试 五部分均确认）
> 范围：ECR、ECO、库存单据三模块接入；引擎通用化，后续模块只加模板

---

## 1. 背景与现状问题

当前 ECR / ECO / 库存单据三模块使用同一套粗糙审批模式：

| 要素 | 现状 | 问题 |
|---|---|---|
| 审批人 | `reviewers` JSONB，**发起人手工指定**用户列表 | 不严谨，发起人可随意指定 |
| 会签/或签 | `review_mode` = `all`（会签）/ `any`（或签），同一批人**并行** | 无顺序、无层级 |
| 审批记录 | `XxxReviewRecord` 平铺表（reviewer_id / decision / comment） | 无"步骤"概念，无法体现流程 |
| 状态流 | draft → reviewing → approved/rejected → close | 无分支、无节点 |
| 组织数据 | `User.department` 仅为字符串 | **无部门树、无上下级关系**，无法按组织层层审批 |

**两个核心诉求：**

1. **按组织架构层层审批**（库存类表单）：如 制单人 → 主管 → 经理 → 总经理。
2. **按业务角色流审批**（ECR/ECO 变更）：设计（发起人）→ 校对 → 审核 → 批准。

**关键洞察**：两种诉求本质是同一件事——"有序步骤，每步由某种规则解析出审批人"。库存 = 步骤[主管→经理]；ECR/ECO = 步骤[校对→审核→批准]。差异只在步骤如何解析出人，因此可用**一个通用审批流引擎**统一覆盖。

---

## 2. 已确认的决策

| 决策点 | 结论 |
|---|---|
| 组织数据基础 | **用户直属上级链**：`User.manager_id` 新列，审批沿上级链逐级上报；轻量起步，后续可升级部门树 |
| ECR/ECO 角色落地 | **模板 + 解析规则，提交时自动解析**；发起人可微调（替换人，**不可新增**） |
| 库存层层审批形态 | 每类单据可配置**上报级数**，每级支持 1 人或**多人会签** |
| 实现路线 | **A：独立通用审批流引擎**（新表 + 通用解析器 + 模板管理），三模块统一接入 |
| 改造范围 | ECR + ECO + 库存单据；引擎通用化（构型概要等后续只加模板） |
| 驳回语义 | **驳回即退回发起人**，修改后重新提交，**重走全流程**（不做断点续批，v1） |

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│  审批流引擎 backend/app/workflow/                          │
│  ├── models_workflow.py    引擎表（模板/实例/任务）          │
│  ├── resolver.py           审批人解析器（按规则算出人）       │
│  ├── engine.py             流转核心（start / act / 判定）    │
│  ├── crud_workflow.py      模板与实例数据操作                │
│  └── routers/workflow.py   模板管理 API + 任务操作 API       │
├──────────────────────────────────────────────────────────┤
│  接入模块（各自保留 status 字段与状态日志，审批机制交给引擎）    │
│  ECR    submit → engine.start()                            │
│  ECO    approve/reject → engine.act() + 模块钩子           │
│  库存单据 钩子：冻结/解冻、过账等副作用留在模块代码             │
└──────────────────────────────────────────────────────────┘
```

**关键设计原则：**

1. **流程权威在引擎**：`workflow_instances` 中的步骤/任务/状态是唯一权威；各模块 `status` 由引擎回调驱动（reviewing/approved/rejected），不双写。
2. **模块副作用走钩子**：ECO 提交冻结零部件、驳回解冻、库存过账等，通过 `on_approved / on_rejected / on_withdrawn` 回调留在各模块原有代码，引擎不感知业务。
3. **审批记录统一**：`approval_tasks` 任务表本身就是留痕（每步每人一条，含决策/意见/时间），替代三张 `XxxReviewRecord` 的新写入；旧表只读保留历史。

---

## 4. 数据模型

### 4.1 新增表

**`workflow_templates` — 流程模板（管理员配置）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| code | String(64) unique | 模板编码 |
| name | String(128) | 模板名称 |
| entity_type | String(32) | ecr / eco / inventory_doc |
| entity_subtype | String(32) nullable | 库存单据细分：inbound/outbound/transfer/stocktake/adjustment |
| steps | JSONB | 步骤定义数组（见 4.3） |
| is_active | Boolean | 是否启用 |
| created_at / updated_at | DateTime | |

**`workflow_instances` — 一次提交流程实例**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| template_id | UUID FK | |
| entity_type / entity_id | | 关联业务单据 |
| entity_subtype | String(32) nullable | 冗余，便于查询 |
| title | String(255) | 单据标题冗余（待办/流程视图展示） |
| initiator_id | UUID FK users | 发起人 |
| status | String(16) | active / approved / rejected / withdrawn |
| current_step_index | Integer | 当前步骤下标 |
| steps | JSONB | **提交时解析快照**（固化，之后人员变动不影响本单） |
| started_at / finished_at | DateTime | |

**`approval_tasks` — 审批任务（兼审批记录）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| instance_id | UUID FK | |
| step_index | Integer | |
| step_name | String(64) | |
| approver_id | UUID FK users | |
| approver_name | String(64) | 冗余快照 |
| status | String(16) | pending / approved / rejected / skipped |
| comment | Text | 审批意见 |
| decided_at | DateTime | |
| created_at | DateTime | |

**`users.manager_id`（新列）**：直属上级，指向 users.id，可空（顶端）。

### 4.2 模板选择键

`entity_type + entity_subtype` 唯一确定模板。库存单据按 `doc_type` 细分；ECR/ECO 无 subtype。

### 4.3 模板 steps 结构（JSONB）

```json
[
  { "name": "主管审核", "resolvers": [{ "type": "manager_chain", "level": 1 }], "mode": "all" },
  { "name": "财务会签", "resolvers": [{ "type": "role", "role": "production" }], "mode": "all" },
  { "name": "批准", "resolvers": [{ "type": "initiator_choose", "candidates": { "roles": ["admin"] } }], "mode": "any" }
]
```

- `resolvers` 为数组：一个步骤可组合多个解析规则（如"仓库主管 + 财务"同层会签）。
- `mode`: `all` = 会签（全部通过才进下一步）；`any` = 或签（任一通过即进下一步，其余任务标 skipped）。

---

## 5. 解析规则（resolver type）

| type | 说明 | 适用 |
|---|---|---|
| `manager_chain` `level: N` | 发起人向上数第 N 级上级（level 1 = 直属上级） | 库存层层审批 |
| `role` | 按系统角色筛出全部候选（如 engineer） | ECR 校对/审核 |
| `group` | 按现有 UserGroup 用户组筛出候选 | 跨部门会签 |
| `user` | 模板中固定用户 | 固定审批人 |
| `initiator_choose` | 发起人从限定候选（roles/groups 过滤）中选人 | ECR/ECO 校对、审核 |

**解析与微调规则：**

- 提交时引擎逐步骤解析出具体审批人 → 固化快照到 instance.steps → 创建首步任务。
- 发起人可**替换**已解析的人选（如上级出差换人），**不可新增**（防绕过）。
- 替换操作通过实例快照前后对比留痕（前端流程视图可展示"发起人将 X 替换为 Y"），无需额外表。

---

## 6. 流转语义

### 6.1 提交 submit

1. 校验模板存在且 `is_active`；未配置模板 → **不允许提交**，提示管理员配置（严谨优先；存量类型预置种子模板兜底）。
2. 逐步骤解析审批人（含发起人微调）。
3. 创建 `workflow_instances` + 首步 `approval_tasks`。
4. 模块状态置 `reviewing`（引擎回调）。
5. 通知首步审批人（复用现有 `notifications.create_notifications` + `request-approval` 直达）。

### 6.2 审批 act

1. **任务级鉴权**：仅当"当前用户是该 pending 任务审批人"可审批（管理员兜底）。
2. 记录 decision / comment / decided_at。
3. 判定：
   - **驳回**（任一步任一驳回）→ 实例 `rejected` → 模块置 `rejected` → 通知发起人 → `on_rejected` 钩子（如 ECO 解冻）。
   - **通过**：
     - 步内 `all`：全部任务 approved 才进下一步；`any`：任一 approved 即进下一步，其余任务标 `skipped`。
     - 创建下一步任务并通知。
     - 最后一步通过 → 实例 `approved` → 模块置 `approved` → `on_approved` 钩子（如库存过账）。

### 6.3 撤回 withdraw / 重新提交

- 撤回：reviewing 中可撤回回 `draft`，实例标 `withdrawn`；重新提交创建**新实例**，从头走全流程。
- 驳回后修改重新提交：同样创建新实例从头走。

### 6.4 状态机汇总

```
draft ──submit──▶ reviewing ──全部通过──▶ approved
                     │                        │
                     ├──任一驳回──▶ rejected ◀─┤（退回发起人）
                     │                        │
                     └──撤回──────▶ draft（重新提交→新实例从头走）
```

---

## 7. 前端改造

| 视角 | 改动 |
|---|---|
| 发起人 | 通用组件 **`ApprovalFlowPicker`**：提交时展示流程预览（步骤卡片：步骤名/审批人/会签或签标签），可替换人（不可新增）。ECR/ECO/库存创建与编辑弹窗的提交按钮统一走该组件 |
| 审批人 | 通用组件 **`ApprovalFlowTimeline`**：垂直时间线展示每步每人状态（待办/通过/驳回/跳过）、会签或签标签、意见与时间。嵌入 ECR/ECO/库存单据详情审批区域 |
| 管理员 | 新增 **WorkflowTemplates 页面**：模板列表（按单据类型分组）+ 步骤编辑器（表单编辑，非 JSON）。用户管理页增加"直属上级"选择器 |
| 待办 | v1 复用现有通知 + 详情页审批；统一"我的待办"聚合面板留 v2 |

---

## 8. 迁移与兼容

1. **`users.manager_id` 新列**：启动自动迁移；用户管理页可配直属上级。
2. **种子模板**（数据库迁移预置，默认与现状行为近似，管理员可调）：
   - 库存 5 类（inbound/outbound/transfer/stocktake/adjustment）默认：`主管审核(manager_chain 1级) → 经理审批(manager_chain 2级)`
   - ECR 默认：`校对(initiator_choose 候选工程师) → 审核(initiator_choose 候选工程师/管理员) → 批准(role=admin)`
   - ECO 默认：同 ECR，末步 `批准(role=admin)`
3. **存量单据**：
   - 处于 `reviewing` 的：迁移脚本按现有 reviewers/review_mode 生成**单步实例**（mode 对应 all/any），审批可继续。
   - 已终态（approved/rejected/closed）：保留旧 `XxxReviewRecord` 数据只读展示，**不迁移**。
4. **旧 `XxxReviewRecord` 表**：保留，历史数据只读；新流程不再写入。

---

## 9. 权限

- **任务级鉴权**：审批动作仅"该 pending 任务审批人"可执行（比现有 `ecr:approve` 角色权限更精确）；现有对象策略 `ecr_approver_or_admin` 保留兜底。
- **模板管理**：新增权限项 `workflow:template:manage`（写入 `permissions/permissions.json` 并运行 `tools/gen_permissions.py` 重新生成），仅 admin。
- 查看权限与现状一致，不变。

---

## 10. 测试

| 层 | 用例 |
|---|---|
| resolver 单测 | manager_chain 各级；上级链断链（manager 为空）兜底策略；role/group/initiator_choose 候选过滤 |
| 引擎流转单测 | 会签全过、或签任一过、驳回、撤回、重提、替换人、未配模板拒绝提交 |
| 集成测试 | 三模块 submit→审批→终态全链路；ECO 冻结/解冻钩子；库存过账顺序；通知正确性 |

---

## 11. 非目标（v2 候选）

- 统一"我的待办"聚合面板
- 退回到指定节点（断点续批）
- 条件分支（金额/数量阈值决定流程走向）
- 完整部门树组织架构（manager_id 链可平滑升级）
- 加签/转办/委托/代理审批
- 模板多版本与生效时间

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| manager_id 未维护导致链断 | 解析时断链兜底（跳过该级或回退到最近有效上级，策略模板可配）；管理页引导补全 |
| 替换审批人绕过权限 | 替换仅允许"同解析候选范围"，且操作留痕 |
| 存量 reviewing 单据流程中断 | 迁移脚本生成单步实例，审批人不变 |
| 三模块接入回归 | 集成测试覆盖全链路 + 现有审批权限兜底保留 |
