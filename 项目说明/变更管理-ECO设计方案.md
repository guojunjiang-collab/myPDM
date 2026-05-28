# 变更管理 - ECO 设计方案

> **版本**: v1.8
> **日期**: 2026-05-28
> **状态**: 🟢 手动执行模式已完成

---

## 1. 业务背景

### 1.1 变更管理三段式模型

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     ECR      │ ──→ │     ECO      │ ──→ │     ECN      │
│  工程变更请求  │     │  工程变更指令  │     │  工程变更通知  │
└──────────────┘     └──────────────┘     └──────────────┘
```

| 阶段 | 核心职责 | 本系统 |
|------|---------|--------|
| **ECR** | 发起变更请求，描述问题/改进点，评估可行性，获得批准 | ✅ 已实施 |
| **ECO** | 下达变更指令，修改受影响的零件/部件/文档，执行 BOM 更新 | **本期开发** |
| **ECN** | 变更完成后通知全组织，发布正式变更结果 | 后续开发 |

### 1.2 ECO 核心业务场景

1. **从 ECR 创建**: 已批准的 ECR 可创建 ECO，将 ECR 中的变更方案逐项落地执行
2. **独立创建**: 支持不关联 ECR 直接创建 ECO（适用于首次发布新零部件、紧急变更等场景）
3. **新增零部件**: ECO 中可直接创建新的零件/部件（ECR 只评估现有零部件，不做新增）
4. **变更执行（手动模式）**: ECO 审批通过后，在 ECO 执行页面手动逐项执行零部件升版操作。由用户根据 ECR 评估结果自行判断，不再尝试全自动变更。
5. **多人会签审批**: ECO 拥有独立的审批流程（会签/或签），审批通过后方可执行
6. **逐项手动执行**: 点击"升版"克隆旧实体创建新版本，零件清空关联图文档，部件清空图文档但保留 BOM 子项
7. **误操还原**: 已升版的项可通过"还原"按钮删除新版实体，恢复为未执行状态
8. **知会**: 任何用户可将 ECO 知会其他用户，知会用户可查看该 ECO
9. **权限**: 每用户只看与自己相关的 ECO（创建人/审批人/执行人/知会人），管理员看全部

---

## 2. 数据模型

### 2.1 ECO 主表 `ecos`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID | PK | 主键 |
| `eco_number` | VARCHAR(32) | UNIQUE NOT NULL | ECO 编号，格式 `ECO-YYYY-XXXXX` |
| `ecr_id` | UUID | FK→ecrs，可空 | 来源 ECR（独立创建时为空） |
| `title` | VARCHAR(255) | NOT NULL | 标题 |
| `description` | TEXT | 可空 | 详细描述 |
| `reason` | VARCHAR(64) | NOT NULL | 变更原因 |
| `priority` | VARCHAR(16) | NOT NULL, DEFAULT 'normal' | 优先级：`urgent` / `high` / `normal` / `low` |
| `category` | VARCHAR(32) | 可空 | 变更类别：`design_change` / `process_change` / `material_change` / `new_release` / `other` |
| `status` | VARCHAR(16) | NOT NULL, DEFAULT 'draft' | 状态：`draft` / `reviewing` / `approved` / `rejected` / `executing` / `completed` / `closed` |
| `reviewers` | JSONB | NOT NULL, DEFAULT '[]' | 审批人列表 `[{"user_id","user_name","role","seq"}]` |
| `review_mode` | VARCHAR(8) | NOT NULL, DEFAULT 'all' | 审批模式：`all`=会签 / `any`=或签 |
| `creator_id` | UUID | FK→users, NOT NULL | 创建人 ID |
| `executor_id` | UUID | FK→users, 可空 | 执行负责人 ID |
| `document_links` | JSONB | NOT NULL, DEFAULT '[]' | 关联图文档 |
| `cc_users` | JSONB | NOT NULL, DEFAULT '[]' | 知会用户 `[{"user_id","user_name"}]` |
| `release_items` | JSONB | NOT NULL, DEFAULT '[]' | 工程预变更关联零部件 `[{entity_type, entity_id, entity_code, entity_name, entity_version, spec, status}]` |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 创建时间 |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | 更新时间 |
| `reviewed_at` | TIMESTAMPTZ | 可空 | 审批完成时间 |
| `executed_at` | TIMESTAMPTZ | 可空 | 执行完成时间 |
| `closed_at` | TIMESTAMPTZ | 可空 | 关闭时间 |

### 2.2 执行明细表 `eco_execution_items`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 主键 |
| `eco_id` | UUID FK→ecos ON DELETE CASCADE | 所属 ECO |
| `source` | VARCHAR(8) NOT NULL, DEFAULT 'ecr' | 来源：`ecr`=来自 ECR / `manual`=ECO 中手动添加 |
| `affected_item_id` | UUID FK→ecr_affected_items, 可空 | 关联 ECR 受影响对象（source=ecr 时有值） |
| `entity_type` | VARCHAR(16) NOT NULL | `'part'` 或 `'assembly'` |
| `entity_id` | UUID 可空 | 原实体 ID（action=create 时为空，执行后回填） |
| `entity_code` | VARCHAR(64) 可空 | 冗余编码 |
| `entity_name` | VARCHAR(255) NOT NULL | 实体名称 |
| `action` | VARCHAR(16) NOT NULL | 操作类型：`create` / `upgrade` / `qty_change` / `delete` / `no_change` |
| `status` | VARCHAR(16) NOT NULL, DEFAULT 'pending' | 执行状态：`pending` / `in_progress` / `completed` / `failed` / `skipped` |
| `detail` | JSONB | 执行详情（按 action 类型结构不同，见下方） |
| `new_entity_id` | UUID 可空 | 升版或新建后生成的实体 ID |
| `new_version` | VARCHAR(32) 可空 | 新版本号 |
| `parent_entity_id` | UUID 可空 | 父项实体 ID（qty_change / delete 时需要） |
| `parent_new_entity_id` | UUID 可空 | 父项升版后的新 ID |
| `error_message` | TEXT 可空 | 执行失败时的错误信息 |
| `sort_order` | INTEGER NOT NULL, DEFAULT 0 | 执行顺序 |
| `executed_at` | TIMESTAMPTZ 可空 | 执行完成时间 |

**`detail` JSONB 结构（按 action 类型）**:

```jsonc
// upgrade: 升版
{
  "old_version": "A",
  "new_version": "B",
  "new_entity_id": "uuid...",
  "cascade_upgraded_parents": ["uuid-of-parent", "uuid-of-grandparent"]
}

// qty_change: 数量变更
{
  "parent_type": "assembly",
  "parent_id": "uuid...",
  "parent_new_id": "uuid...",
  "old_quantity": 4,
  "new_quantity": 6
}

// delete: 删除 BOM 关系
{
  "parent_type": "assembly",
  "parent_id": "uuid...",
  "parent_new_id": "uuid...",
  "removed_child_id": "uuid...",
  "removed_quantity": 2
}

// create: 新建
{
  "code": "PRT-NEW",
  "name": "新零件",
  "version": "A",
  "new_entity_id": "uuid...",
  "parent_entity_id": "uuid-of-parent"  // 可选，若指定了父项
}

// no_change: 不变
{}
```

**`detail` 编辑态扩展字段**（ECO 编辑界面保存时写入，不参与执行逻辑）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `_targetQty` | number | 用户编辑的目标用量 |
| `_desc` | string | 用户编辑的说明备注 |
| `_affectedCode` | string | **所属受影响项的编码**，用作复合键区分不同组卡片中的同一 BOM 节点 |

> **设计要点**: `execution_items` 使用 `entity_id|_affectedCode` 复合键——同一物理实体出现在不同受影响项的分析卡片中时，各自独立保存操作和用量，互补影响。

### 2.3 审批记录表 `eco_review_records`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 主键 |
| `eco_id` | UUID FK→ecos ON DELETE CASCADE | 所属 ECO |
| `reviewer_id` | UUID FK→users, NOT NULL | 审批人 ID |
| `reviewer_name` | VARCHAR(64) | 审批人姓名 |
| `decision` | VARCHAR(16) NOT NULL | `approved` / `rejected` / `returned` |
| `comment` | TEXT 可空 | 审批意见 |
| `created_at` | TIMESTAMPTZ | 审批时间 |

### 2.4 状态变更日志表 `eco_status_logs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 主键 |
| `eco_id` | UUID FK→ecos ON DELETE CASCADE | 所属 ECO |
| `from_status` | VARCHAR(16) | 变更前状态 |
| `to_status` | VARCHAR(16) NOT NULL | 变更后状态 |
| `operator_id` | UUID FK→users, NOT NULL | 操作人 ID |
| `operator_name` | VARCHAR(64) | 操作人姓名 |
| `comment` | TEXT | 备注 |
| `created_at` | TIMESTAMPTZ | 操作时间 |

---

## 3. 状态机

### 3.1 状态流转图

```
                    ┌─────────┐
                    │  draft  │  草稿
                    └────┬────┘
                         │ 提交评审
                         ▼
                    ┌──────────┐
              ┌─────│reviewing │─────┐
              │     │ 评审中   │     │
              │     └──────────┘     │
              │ 全部通过             │ 驳回 / 退回
              ▼                     ▼
        ┌──────────┐          ┌──────────┐
        │ approved │          │ rejected │ (或退回 draft)
        │ 已批准   │          │ 已驳回   │
        └────┬─────┘          └────┬─────┘
             │ 开始执行             │ 关闭
             ▼                     ▼
        ┌───────────┐         ┌──────────┐
        │ executing │         │  closed  │
        │ 执行中    │         └──────────┘
        └─────┬─────┘
              │ 全部完成
              ▼
        ┌───────────┐
        │ completed │
        │ 已完成    │
        └─────┬─────┘
              │ 关闭
              ▼
        ┌───────────┐
        │  closed   │
        └───────────┘
```

### 3.2 状态转换规则

| 当前状态 | 目标状态 | 触发条件 | 权限 |
|---------|---------|---------|------|
| `draft` | `reviewing` | 提交评审 | 创建人 / 管理员 |
| `draft` | `closed` | 取消 | 创建人 / 管理员 |
| `reviewing` | `approved` | 全部审批通过 | 自动（会签）/ 任一人通过（或签） |
| `reviewing` | `rejected` | 任一审批人驳回 | 审批人 |
| `reviewing` | `draft` | 退回修改 / 撤回 | 审批人退回 / 创建人撤回 |
| `approved` | `executing` | 开始执行 | 执行负责人 / 管理员 |
| `approved` | `closed` | 取消执行 | 管理员 |
| `executing` | `completed` | 全部执行项完成 | 自动 |
| `executing` | `closed` | 强制关闭（放弃未完成项） | 管理员 |
| `completed` | `closed` | 归档关闭 | 管理员 |
| `rejected` | `closed` | 归档关闭 | 管理员 |

### 3.3 审批流程

1. 创建人提交 ECO（`draft → reviewing`）
2. 审批人逐一审批：`通过`、`驳回`、`退回`
3. 会签模式（`all`）：全部通过 → `approved`；或签模式（`any`）：任一通过 → `approved`
4. 退回时清空旧审批记录，重新提交后从零开始
5. 单人审批通过即时写入审批记录（状态不变）

---

## 4. 零件/部件版本与状态管理

这是 ECO 最核心的执行逻辑——变更操作如何影响零件的版本和状态。

### 4.1 升版触发规则

```
┌──────────────────────────────────────────────────────────────┐
│  规则1: 直接属性变更 → 该实体升版                              │
│  规则2: BOM 关系变更 → 直接父项装配件升版                        │
│  规则3: 升版范围 = ECR 向上溯源链中有变更的父项，不继续向上级联    │
│         未标记为受影响的父项保持不变，继续使用旧版零部件             │
│  规则4: 旧版本保持原状态不变，不自动作废                          │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 各 action 的升版行为

| action | 升版对象 | 说明 |
|--------|---------|------|
| `create` | 无（新建） | 直接创建，version=A，status=released（自动发布） |
| `upgrade` | 该实体 | 修改自身属性 → 自己升版；仅当父项在 ECR 受影响列表中时才升版父项 |
| `qty_change` | 直接父项装配件 | 改的是父项的 BOM → 父项升版；仅当更上层父项在 ECR 受影响列表中时才继续升版 |
| `delete` | 直接父项装配件 | 删的是父项的 BOM → 父项升版；仅当更上层父项在 ECR 受影响列表中时才继续升版 |
| `no_change` | 无 | 仅标记完成，不操作数据 |

### 4.3 级联升版示例

**场景**: 在底盘总成 (CHS) 中修改螺栓数量，CHS 在 ECR 受影响列表中，但顶层整车总成 (TOP) 不在受影响列表中。

```
变更前 BOM:
  整车总成 (TOP vA)
   └─ 底盘总成 (CHS vA)         ← ECR 受影响项
       ├─ 螺栓 PRT-005 ×4       ← qty_change
       └─ 底板 PRT-001

执行后:
  PRT-005: 不变（自身没改）
  CHS:     vA → vB（BOM 变了，升版）——在受影响列表中
  TOP:     保持 vA，不升版——不在受影响列表中，继续使用旧版
```

**场景**: 如果 TOP 也在 ECR 受影响列表中，则 TOP 也需要升版。

```
变更前 BOM:
  整车总成 (TOP vA)              ← ECR 受影响项（级联）
   └─ 底盘总成 (CHS vA)         ← ECR 受影响项
       ├─ 螺栓 PRT-005 ×4       ← qty_change
       └─ 底板 PRT-001

执行后:
  PRT-005: 不变
  CHS:     vA → vB
  TOP:     vA → vB（在受影响列表中，升版）
```

> **原则**: 升版只沿 ECR 向上溯源链中有变更标记的父项进行，不自动扩散到整个 BOM 树。未标记为受影响的父项保持不变。

### 4.4 零件/部件状态生命周期

ECO 执行时的状态行为：

```
ECO 执行时的行为:
  - 新建零件/部件: status = released（ECO 执行后自动发布）
  - 升版后新版本: status = released（ECO 执行后自动发布）
  - 旧版本: 保持原 status 不变（不自动作废）

实体完整状态生命周期:
  draft ──→ released ──→ obsolete
  草稿       已发布       已作废

  draft → released: ECO 执行自动完成（或用户在零件页面手动发布）
  released → obsolete: 用户手动操作（在零件/部件管理页面）
```

> **关键原则**: 
> - ECO 执行自动将新版本/新实体设为 `released`（已发布），因为通过审批的变更产物即为正式版本。
> - 旧版本实体保持原 status 不变，不自动作废——因为旧版本可能仍被其他装配件使用。

---

## 5. 执行逻辑详细说明

### 5.1 `create` — 新建零件/部件

**适用场景**: ECO 独立创建时新增零部件，或 ECO 中手动补充的新增项。

**创建阶段（ECO 编辑时）**:
- 用户只需填写最少信息：`code`（编码）和 `name`（名称）
- 其他详细信息（`spec`、`remark` 等）可在后续执行时或在零件管理页面补充

**执行阶段**:
```
步骤:
  1. 读取执行项中的实体信息（至少 code + name）
  2. INSERT 到 parts 或 assemblies 表:
     - code, name = 用户填写值
     - version = "A"
     - status = "released"（ECO 执行后自动发布）
     - spec, remark 等字段 = 用户填写值（可空）
  3. 如果执行项指定了 parent_entity_id:
     - 在 BOM 关系表中创建 BOMItem（parent=指定父项, child=新实体）
     - 注意: 新零件不对已有数据做 BOM 影响分析，因为新零件不会影响原有结构
  4. 回写 execution_item.new_entity_id
  5. 标记执行项 status = "completed"
```

### 5.2 `upgrade` — 升版

**适用场景**: 零件/部件自身属性需要变更（如 spec 修改、remark 修改等）。

```
步骤:
  1. 读取原实体数据（parts / assemblies 表）
  2. 计算新版本号（根据当前版本递增: A→B, B→C, ...）
  3. INSERT 新记录:
     - code 保持不变
     - version = 新版本号
     - revision_parent_id = 原记录 ID
     - revisions = 原记录 revisions + 本次变更记录
      - 复制其他字段（name, spec 等），status 设为 "released"
  4. 如果 ECR 向上溯源链中有受影响的父项，仅升版这些父项（不继续向上扩散）
  5. 级联升版过程中，更新 BOMItem 的 child_id 或 parent_id 指向新版本
  6. 回写 execution_item.new_entity_id, new_version
  7. 标记执行项 status = "completed"
```

### 5.3 `qty_change` — 数量变更

**适用场景**: 修改装配件中某个子项的使用数量。

```
步骤:
  1. 确定父项装配件（parent_entity_id）
  2. 父项升版（因为 BOM 变了）:
     - INSERT 父项新版本（遵守 upgrade 规则）
     - 复制旧版本的全部 BOMItem → 关联到新版本父项
  3. 修改目标 BOMItem 的 quantity 字段
  4. 如果 ECR 向上溯源链中有更上层受影响的父项，仅升版这些父项
  5. 回写 execution_item.parent_new_entity_id, detail
  6. 标记执行项 status = "completed"
```

### 5.4 `delete` — 删除 BOM 关系

**适用场景**: 从装配件中移除某个子项零件/部件。

```
步骤:
  1. 确定父项装配件（parent_entity_id）
  2. 父项升版（因为 BOM 变了）:
     - INSERT 父项新版本
     - 复制旧版本的全部 BOMItem → 排除被删除项
  3. 如果 ECR 向上溯源链中有更上层受影响的父项，仅升版这些父项
  4. 子项零件/部件不受影响（可能还被其他装配件使用）
  5. 回写 execution_item.parent_new_entity_id, detail
  6. 标记执行项 status = "completed"
```

### 5.5 `no_change` — 不变

```
步骤:
  1. 不执行任何数据操作
  2. 标记执行项 status = "completed"
```

### 5.6 执行顺序约束

执行项之间存在依赖关系，必须按顺序执行：

```
排序原则:
  1. create 先于 upgrade（先建后用）
  2. 子项变更先于父项变更（自底向上）
  3. qty_change / delete 在它们的父项升版之前
   4. 同一层级无依赖的可并行执行（但系统串行处理）
```

### 5.7 评估→执行完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                     ECO 生命周期                              │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │  草稿     │───→│  评审中   │───→│  已批准   │───→│ 执行中  │ │
│  │  draft   │    │ reviewing│    │ approved │    │executing│ │
│  └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│       │                                               │      │
│       │ 评估阶段                                       │ 自动  │
│       │ (ECOEditView)                                 ↓      │
│       │                                         ┌────────┐  │
│       ├─ 编辑各受影响项操作/用量                  │  已完成  │  │
│       ├─ 调整向上溯源链                          │completed│  │
│       ├─ 添加/删除向下子项                       └────────┘  │
│       └─ 保存→execution_items                            │   │
│           (entity_id|_affectedCode 复合键)                │   │
└─────────────────────────────────────────────────────────────┘
```

**两阶段模型**:

| 阶段 | 操作方 | 界面 | 输出 |
|------|--------|------|------|
| **评估** | 工程师（创建/编辑 ECO） | ECOEditView 分组卡片 | `execution_items[]`（操作+用量+说明） |
| **执行** | 执行负责人（批准后） | ECOExecutionPanel | 数据库实际写入（升版/BOM 更新/新建） |

### 5.8 执行流程总览

```
  execution_items[]（评估产物）
        │
        ▼
  ┌─────────────────────────────────────────┐
  │           执行引擎 (execute_all)          │
  │                                          │
  │  Phase 1: 新建 (create)                  │
  │    ├─ 新建零件/部件 → status=released     │
  │    └─ 有 parent 则创建 BOMItem            │
  │                                          │
  │  Phase 2: 升版 + BOM 变更（自底向上）      │
  │    ├─ upgrade:  复制实体→新版本→released   │
  │    │   └─ 更新 BOMItem child_id→新版本     │
  │    ├─ qty_change: 父项升版→改BOMItem.quantity│
  │    │   └─ 级联上层受影响父项               │
  │    ├─ delete:    父项升版→移除BOMItem      │
  │    │   └─ 级联上层受影响父项               │
  │    └─ add_existing: 父项升版→添加BOMItem   │
  │        └─ 子项已存在，仅建立关联           │
  │                                          │
  │  Phase 3: 完成检查 + 自动发布              │
  │    ├─ 全部执行项 completed → ECO=completed │
  │    └─ 所有新实体 status 已为 released      │
  └─────────────────────────────────────────┘
```

### 5.9 执行排序规则

执行项 `sort_order` 按以下规则自动编号，保证依赖正确：

```
规则 1（先建后用）:
  create < upgrade / qty_change / delete / add_existing

规则 2（自底向上）:
  向下子项先于向上溯源链（子项改完再改父项）
  BOM 层级: level 越大越先执行（叶子先于根）

规则 3（父项依赖）:
  qty_change / delete 的父项在子项之后

实际排序结果示例:
  sort_order | entity_code | action     | 说明
  -----------|-------------|------------|------
  1          | PART-NEW    | create     | 先建新实体
  2          | CHILD-A     | upgrade    | 子项升版（BOM level 2）
  3          | SUB-1       | qty_change | 子项数量变更
  4          | SUB-2       | delete     | 子项删除
  5          | ASS-TOP     | upgrade    | 父项升版（BOM level 0,向上溯源）
  6          | ASS-PARENT  | qty_change | 父项数量变更（级联）
```

### 5.10 级联升版规则（向上溯源链）

```
当执行项涉及 BOM 变更（qty_change / delete / add_existing）时：

  当前实体 (entity_id)
    └→ 查询 ECR 受影响对象分析 (ecr_affected_items.bom_impact)
       └→ 获取 upward_chain（向上溯源链）
          └→ 筛选有 change_type 标记的父项（is_change_target=true）
             └→ 仅对这些父项执行级联升版
                └→ 未标记的父项保持不变

  示例:
    受影响项: 螺栓 A → 向上溯源: 车轮总成 → 底盘总成 → 整车
    如果仅 "车轮总成" 被标记为受影响:
      - 执行 qty_change 后: 车轮总成升版，底盘总成和整车不变
    如果 "车轮总成" 和 "底盘总成" 都被标记:
      - 两者依次升版，整车不变
```

### 5.11 执行事务边界

| 粒度 | 策略 | 说明 |
|------|------|------|
| 单项执行 | 每项独立事务 | 单项失败不影响其他项；失败可重试 |
| 批量执行 | 串行+独立事务 | `execute_all` 按 sort_order 逐项执行，每项提交一次 |
| 状态转换 | 严格校验 | `pending/failed → in_progress → completed/failed` |
| 回滚策略 | 不回滚已完成项 | 某项失败时，后续项停止，已完成的保留 |

```
execute_all 伪代码:

for item in items.sorted_by(sort_order):
    try:
        item.status = "in_progress"; commit()
        result = dispatch(action):
            create:      INSERT parts/assemblies (status=released) + optional BOMItem
            upgrade:     clone_entity → new_version (status=released) → update BOMItem refs
            qty_change:  clone_parent → modify BOMItem.quantity → cascade_upgrade_parents
            delete:      clone_parent → remove BOMItem → cascade_upgrade_parents
            add_existing:clone_parent → add BOMItem → cascade_upgrade_parents
            no_change:   skip
        item.status = "completed"; commit()
    except Exception:
        item.status = "failed"; item.error_message = e; commit()
        break  // 停止后续执行

if all_completed:
    eco.status = "completed"; eco.executed_at = now(); commit()
```

### 5.12 执行项 `detail` 入参与出参对照

| action | 输入（评估阶段写入） | 输出（执行后回写） |
|--------|---------------------|-------------------|
| `create` | `{_targetQty, _desc, _affectedCode}` | `{code, name, version:"A", new_entity_id}` |
| `upgrade` | `{_targetQty, _desc, _affectedCode}` | `{old_version, new_version, new_entity_id, cascade_upgraded_parents[]}` |
| `qty_change` | `{_targetQty, _desc, _affectedCode}` | `{parent_type, parent_id, parent_new_id, old_quantity, new_quantity}` |
| `delete` | `{_targetQty, _desc, _affectedCode}` | `{parent_type, parent_id, parent_new_id, removed_child_id, removed_quantity}` |
| `add_existing` | `{_targetQty, _desc, _affectedCode}` | `{parent_type, parent_id, parent_new_id, added_child_id, quantity}` |
| `no_change` | `{}` | `{}` （无操作） |

> `_targetQty` / `_desc` / `_affectedCode` 为评估阶段编辑界面产生的字段，执行阶段不直接使用（仅用于 merge 回 UI）。

### 5.13 自动发布规则

```
ECO 执行完成后自动发布逻辑:

  create:
    新实体 INSERT 时 status 直接设为 "released"
    （不需要额外步骤）

  upgrade / qty_change / delete / add_existing:
    升版产生的新实体 INSERT 时 status 设为 "released"
    旧版本实体 status 保持不变（不自动设为 obsolete）

  no_change:
    无新实体产生，无 status 变更

  原则:
    - 通过 ECO 审批的变更产物 = 正式发布版本
    - 旧版本不自动作废（可能仍被其他装配件引用）
    - 用户可在零件/部件管理页面手动将旧版本设为 obsolete
```

### 5.14 执行后 clean-up

```
ECO 执行完成后:

  1. 所有执行项 status = "completed"
  2. ECO.status = "completed"; eco.executed_at = 当前时间
  3. execution_item 回写字段:
     - new_entity_id: 新实体 UUID
     - new_version: 新版本号
     - parent_new_entity_id: 父项新实体 UUID
     - detail: 完整执行结果详情
  4. 新实体 status = "released"，可在零件/部件管理页面查看
  5. BOM 树中:
     - 旧版本仍然存在（保留历史）
     - 新版本 BOMItem 指向新 child/parent
     - 级联升版的父项也指向新版本
```

---

## 6. API 设计

### 6.1 路由

- **文件**: `backend/app/routers/ecos.py`
- **前缀**: `/api/ecos`
- **注册**: `main.py` + `routers/__init__.py`

### 6.2 端点清单

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/ecos/` | ECO 列表（分页+筛选+权限过滤） | 所有登录用户 |
| `POST` | `/api/ecos/` | 创建 ECO（可关联 ECR 或独立创建） | admin / engineer |
| `GET` | `/api/ecos/{id}` | ECO 详情 | 所有登录用户（权限过滤） |
| `PUT` | `/api/ecos/{id}` | 更新 ECO（仅 draft 状态可编辑） | 创建人 / admin |
| `DELETE` | `/api/ecos/{id}` | 删除 ECO（仅 draft 状态） | 创建人 / admin |
| `POST` | `/api/ecos/{id}/submit` | 提交评审（draft→reviewing） | 创建人 / admin |
| `POST` | `/api/ecos/{id}/withdraw` | 撤回评审（reviewing→draft） | 创建人 / admin |
| `POST` | `/api/ecos/{id}/review` | 审批操作（通过/驳回/退回） | 指定审批人 / admin |
| `POST` | `/api/ecos/{id}/execute` | 开始执行（approved→executing） | 执行负责人 / admin |
| `POST` | `/api/ecos/{id}/execute-item/{itemId}` | 执行单项 | 执行负责人 / admin |
| `POST` | `/api/ecos/{id}/execute-all` | 一键执行全部（按 sort_order 排序） | 执行负责人 / admin |
| `POST` | `/api/ecos/{id}/close` | 关闭 ECO | 管理员 |
| `GET` | `/api/ecos/{id}/execution-items` | 执行明细列表 | 所有登录用户 |
| `POST` | `/api/ecos/{id}/execution-items` | 添加执行项（手动添加零件/部件） | admin / engineer |
| `PUT` | `/api/ecos/{id}/execution-items/{itemId}` | 编辑执行项 | admin / engineer |
| `DELETE` | `/api/ecos/{id}/execution-items/{itemId}` | 删除执行项 | admin / engineer |
| `GET` | `/api/ecos/{id}/status-logs` | 状态变更日志 | 所有登录用户 |
| `POST` | `/api/ecos/{id}/cc` | 添加知会用户 | 所有登录用户 |
| `DELETE` | `/api/ecos/{id}/cc/{userId}` | 取消知会 | 所有登录用户 |
| `POST` | `/api/ecos/{id}/bom-trace/{type}/{entityId}` | BOM 双向溯源 | 所有登录用户 |

### 6.3 ECO 编号规则

`ECO-{YYYY}-{5位序号}`，例 `ECO-2026-00001`，后端自动生成。

> **编号独立自增**——不依赖 ECR 编号。ECO 可独立创建，追溯关联通过 `ecr_id` 字段完成。

### 6.4 列表权限过滤

- **管理员**: 查看全部 ECO
- **非管理员**: 仅看自己创建的 / 被指定为审批人的 / 被指定为执行负责人的 / 被知会的 ECO

---

## 7. 前端设计

### 7.1 路由

- **路由**: `/ec`（复用现有变更管理页面）
- **页面**: `frontend/src/pages/EC.tsx`（TAB 容器：ECR / ECO / ECN）
- **ECO TAB**: 设为 `enabled: true`

### 7.2 组件清单

| 组件 | 文件 | 说明 |
|------|------|------|
| ECO 列表 | `ECOList.tsx` | 表格+搜索+状态筛选+分页+操作按钮 |
| 创建/编辑弹窗 | `ECOCreateModal.tsx` | 表单：来源ECR选择（可选）+基本信息+审批人+执行项+文档关联 |
| 详情弹窗 | `ECODetailModal.tsx` | 全信息展示+审批面板+执行面板+状态记录+知会 |
| 审批面板 | `ECOReviewPanel.tsx` | 多人审批卡片+操作区（可与 ECR 复用） |
| 执行面板 | `ECOExecutionPanel.tsx` | 执行项列表+逐项执行/一键执行+进度+结果展示 |
| 执行项编辑器 | `ECOExecutionItemEditor.tsx` | 手动添加零件/部件到执行清单 |
| 零件/部件选择器 | 复用现有 `AssemblyPartPicker` | 选择现有实体 |
| 状态/优先级标签 | `ECOStatusBadge.tsx` | 状态和优先级彩色标签 |

### 7.3 列表页字段

ECO 编号 | 标题 | 来源 | 优先级 | 状态 | 执行进度 | 创建人 | 创建时间 | 操作

- **来源**: 显示关联 ECR 编号，或"独立创建"
- **执行进度**: `已完成数 / 总数`（如 `5/12`）

### 7.4 详情页 TAB

1. **基本信息**: 标题、描述、来源ECR、变更原因、类别、优先级、创建人、审批人列表、执行负责人、时间线
2. **审批记录**: 审批人列表、审批状态、审批意见
3. **执行明细**: 表格展示每项——序号、实体编码、名称、操作类型、状态、执行结果、执行时间
4. **状态日志**: 状态变更时间线
5. **知会**: 知会用户列表

### 7.5 创建 ECO 流程

**方式一：从 ECR 创建**
1. 在 ECR 详情页点击"创建 ECO"
2. 自动带入 ECR 的受影响对象作为执行项
3. 用户可编辑/新增/删除执行项
4. 新增零件时只需填写 `code`（编码）和 `name`（名称），其他详情后续补充
5. 填写审批人、执行负责人等信息
6. 提交

**方式二：独立创建**
1. 在 ECO 列表页点击"创建 ECO"
2. 填写标题、原因、类别等基本信息
3. 手动添加执行项:
   - 选择现有实体: 通过零件/部件选择器
   - 新增零件/部件: 填写 `code` + `name`（最少信息），其他字段可在执行阶段或零件管理页面补充
4. 填写审批人、执行负责人
5. 提交

---

## 8. ECR 与 ECO 的关联关系

```
ECR (ecrs)                          ECO (ecos)
┌─────────────────┐                ┌─────────────────┐
│ id              │                │ id              │
│ ecr_number      │                │ eco_number      │
│ status          │ ←─── 1:N ───→ │ ecr_id (可空)    │
│ ...             │                │ status          │
│ eco_id (可空)    │                │ ...             │
└─────────────────┘                └─────────────────┘

ECR 的 eco_id: ECR 审批通过并创建 ECO 后回填（指向最新创建的 ECO）
ECO 的 ecr_id: ECO 创建时填入来源 ECR 的 ID
```

- 一个 ECR 可以对应多个 ECO（如果变更分阶段执行）
- 一个 ECO 可以不关联任何 ECR（独立创建）

---

## 9. 文件清单

### 9.1 后端新增/修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/models_eco.py` | **新增** | ECO 相关 ORM 模型（4 个表） |
| `backend/app/schemas_eco.py` | **新增** | ECO 相关 Pydantic schemas |
| `backend/app/crud_eco.py` | **新增** | ECO 数据库操作函数 |
| `backend/app/routers/ecos.py` | **新增** | ECO API 路由 |
| `backend/app/main.py` | 修改 | 注册 ecos 路由 |
| `backend/app/routers/__init__.py` | 修改 | 导出 ecos 路由 |

### 9.2 前端新增/修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/pages/EC.tsx` | 修改 | ECO TAB 设为 enabled |
| `frontend/src/components/ECO/ECOList.tsx` | **新增** | ECO 列表页 |
| `frontend/src/components/ECO/ECOCreateModal.tsx` | **新增** | 创建/编辑弹窗 |
| `frontend/src/components/ECO/ECODetailModal.tsx` | **新增** | 详情弹窗 |
| `frontend/src/components/ECO/ECOExecutionPanel.tsx` | **新增** | 执行面板 |
| `frontend/src/components/ECO/ECOStatusBadge.tsx` | **新增** | 状态/优先级标签 |
| `frontend/src/components/ECO/ECOCcPicker.tsx` | **新增** | ECO 知会用户选择器 |
| `frontend/src/components/ECO/ECOEditView.tsx` | **新增** | ECO 编辑页 - ECR 变更分析三表对照 + BOM 操作 |
| `frontend/src/types/index.ts` | 修改 | 新增 ECO 类型定义 |
| `frontend/src/services/api.ts` | 修改 | 新增 ECO API 调用函数 |
| `frontend/src/components/Modal.tsx` | 修改 | 新增 `3xl` 宽度选项 |
| `frontend/src/components/ECR/ECRDetailModal.tsx` | 修改 | 移除"创建ECO"按钮 |

---

## 10. 待确认问题

| # | 问题 | 最终方案 | 状态 |
|---|------|---------|------|
| 1 | ECO 编号规则 | 独立自增，格式 `ECO-YYYY-XXXXX` | ✅ 已确认 |
| 2 | 升版后旧版本状态 | 保持原 status 不变，不自动作废 | ✅ 已确认 |
| 3 | 独立创建 ECO | 支持 | ✅ 已确认 |
| 4 | 执行方式 | 逐项 + 一键批量都支持 | ✅ 已确认 |
| 5 | ECO 审批流程 | 完整多人会签/或签；退回后清空旧审批记录 | ✅ 已确认 |
| 6 | 知会功能 | 支持 | ✅ 已确认 |
| 7 | 新增零部件（create） | ECO 中支持；创建时只需填 code+name，spec 等后续补充 | ✅ 已确认 |
| 8 | 回滚机制 | 本期不做；由管理员对零件逐项手动处理 | ✅ 已确认 |
| 9 | 级联升版 | 仅升版 ECR 向上溯源链中有变更标记的父项；未标记的父项保持不变 | ✅ 已确认 |
| 10 | 执行完成后的状态 | 自动设为 released（已发布），无须用户手动发布 | ✅ 已确认 |
| 11 | create 的 BOM 影响分析 | 不做——新零件不影响已有数据结构 | ✅ 已确认 |
| 12 | 执行负责人 | 一个执行负责人（executor_id），admin 可代为执行 | ✅ 已确认 |

---

## 11. 开发计划

### 11.1 实施波次图

```
Wave 1 ──── 基础层（并行）────────────────────────┐
  T1: models_eco.py                               │
  T2: types/index.ts                              │
  T3: schemas_eco.py                              │
                                                  ▼
Wave 2 ──── 核心层（并行）────────────────────────┐
  T4: crud_eco.py           ← 依赖 T1, T3         │
  T5: services/api.ts       ← 依赖 T2             │
                                                  ▼
Wave 3 ──── 路由层（顺序）────────────────────────┐
  T6: routers/ecos.py       ← 依赖 T3, T4         │
  T7: 路由注册               ← 依赖 T6             │
                                                  ▼
Wave 4 ──── 前端组件层（并行）─────────────────────┐
  T8:  ECOStatusBadge.tsx                         │
  T9:  ECOList.tsx                                │
  T10: ECOCreateModal.tsx                         │
  T11: ECODetailModal.tsx                         │
  T12: ECOExecutionPanel.tsx                      │
                                                  ▼
Wave 5 ──── 集成 + 验证───────────────────────────┐
  T13: EC.tsx（启用ECO TAB）                       │
  T14: 构建验证（npm run build + LSP）              │
```

### 11.2 任务清单

| # | 任务 | 文件 | 类别 | 依赖 | 说明 |
|---|------|------|------|------|------|
| T1 | ORM 模型 | `backend/app/models_eco.py` | 后端 | — | 4 表：ECO / ECOExecutionItem / ECOReviewRecord / ECOStatusLog |
| T2 | 类型定义 | `frontend/src/types/index.ts` | 前端 | — | ECO 请求/响应类型、执行项类型、状态枚举 |
| T3 | Pydantic Schema | `backend/app/schemas_eco.py` | 后端 | — | Create/Edit/List/Detail/ExecutionItem/Review/Cc |
| T4 | CRUD + 执行逻辑 | `backend/app/crud_eco.py` | 后端 | T1, T3 | 编号生成、权限过滤、5 种执行逻辑、级联升版 |
| T5 | API 服务层 | `frontend/src/services/api.ts` | 前端 | T2 | ecoApi 对象，20 个端点函数 |
| T6 | API 路由 | `backend/app/routers/ecos.py` | 后端 | T3, T4 | 20 个端点，权限控制，状态机校验 |
| T7 | 路由注册 | `__init__.py` + `main.py` | 后端 | T6 | 导出 eco_router，include_router |
| T8 | 状态标签 | `ECOStatusBadge.tsx` | 前端 | — | ECO 专用状态/优先级彩色标签 |
| T9 | 列表页 | `ECOList.tsx` | 前端 | T5, T8 | 表格+搜索+筛选+分页+操作按钮+执行进度列 |
| T10 | 创建弹窗 | `ECOCreateModal.tsx` | 前端 | T5 | 表单：来源ECR选择+基本信息+审批人+执行项+文档 |
| T11 | 详情弹窗 | `ECODetailModal.tsx` | 前端 | T5, T12 | 全信息展示+审批记录+执行面板+状态日志+知会 |
| T12 | 执行面板 | `ECOExecutionPanel.tsx` | 前端 | T5 | 执行项列表+逐项执行+一键执行+进度+结果 |
| T13 | ECO TAB | `EC.tsx` | 前端 | T9 | 启用 ECO 标签页 |
| T14 | 构建验证 | — | 全栈 | T1–T13 | `npm run build` + LSP 诊断 |

### 11.3 Agent 分派方案

| 波次 | 任务 | Agent 类型 | 并行 |
|------|------|-----------|------|
| Wave 1 | T1 models | `deep` | 同时 |
| Wave 1 | T2 types | `deep` | 同时 |
| Wave 1 | T3 schemas | `deep` | 同时 |
| Wave 2 | T4 crud | `deep` | 同时 |
| Wave 2 | T5 api.ts | `quick` | 同时 |
| Wave 3 | T6 router | `deep` | — |
| Wave 3 | T7 registration | `quick` | — |
| Wave 4 | T8 badge | `visual-engineering` + `frontend-ui-ux` | 同时 |
| Wave 4 | T9 list | `visual-engineering` + `frontend-ui-ux` | 同时 |
| Wave 4 | T10 create | `visual-engineering` + `frontend-ui-ux` | 同时 |
| Wave 4 | T11 detail | `visual-engineering` + `frontend-ui-ux` | 同时 |
| Wave 4 | T12 execution | `visual-engineering` + `frontend-ui-ux` | 同时 |
| Wave 5 | T13 enable tab | `quick` | — |
| Wave 5 | T14 verify | 手动 | — |

---

## 12. 实施进度（2026-05-21）

### 12.1 已完成功能

#### 后端
| 模块 | 文件 | 行数 | 状态 |
|------|------|------|------|
| 4 ORM 模型 | `models_eco.py` | 88 | ✅ |
| Pydantic Schema | `schemas_eco.py` | 252 | ✅ |
| CRUD + 执行逻辑 | `crud_eco.py` | 915 | ✅ |
| 20 API 端点 | `routers/ecos.py` | 500 | ✅ |
| 路由注册 | `__init__.py` + `main.py` | — | ✅ |

#### 前端
| 组件 | 文件 | 说明 | 状态 |
|------|------|------|------|
| ECO 列表 | `ECOList.tsx` | 搜索/筛选/分页/操作/知会 | ✅ |
| 新建/编辑弹窗 | `ECOCreateModal.tsx` | 基本信息 + ECR关联 + 文档 + BOM分析 | ✅ |
| ECO 详情 | `ECODetailModal.tsx` | 全字段 + 审批 + 执行 + BOM分析 | ✅ |
| 状态标签 | `ECOStatusBadge.tsx` | 状态/优先级/操作/执行 标签 | ✅ |
| 执行面板 | `ECOExecutionPanel.tsx` | 逐项/一键执行 | ✅ |
| 知会选择器 | `ECOCcPicker.tsx` | ECR 风格知会弹窗 | ✅ |
| BOM 变更分析 | `ECOEditView.tsx` | 三表对照 + 可编辑 + 添加子项 | ✅ |

#### 核心业务功能
| 功能 | 说明 |
|------|------|
| ECO 创建/编辑/删除 | ✅ |
| ECR 关联（搜索+关联+解除） | ✅ |
| BOM 变更分析三表对照 | ✅ |
| 操作编辑（升版/数量/删除/不变/新增） | ✅ |
| 目标用量编辑 | ✅ |
| 添加子项（AssemblyPartPicker） | ✅ |
| 新增子项删除 | ✅ |
| 级联升版规则（向上溯源特殊处理） | ✅ |
| 审批流程（会签/或签/退回） | ✅ |
| 知会功能 | ✅ |
| 文档关联（添加/移除） | ✅ |
| 文档预览/下载 | ✅ |
| 自动批准（无审批人） | ✅ |
| BOM 修改持久化 | ✅ |
| 重新编辑恢复 BOM 修改 | ✅ |

### 12.2 当前实现细节

**编辑 ECO 界面结构**：
```
┌─ 基本信息 ───────────────────────────────────────┐
│ 标题 / 变更原因+类别 / 优先级 / 描述 / 审批模式     │
├─ 关联 ECR（仅编辑模式）───────────────────────────┤
│ 显示当前 ECR 编号 / +更换 / 解除   按钮            │
│ └─ ECR 变更分析（ECR 存在时展开）                  │
│    ┌─ 受影响物料表格 ───────────────────────────┐ │
│    │ 列出所有 ECR 受影响项                      │ │
│    └──────────────────────────────────────────┘ │
│    ┌─ 受影响项分组卡片（每个受影响项一个卡片）───┐ │
│    │ 📦 受影响项行: 编码 名称 版本 操作 目标用量 │ │
│    │ 📊 向上溯源链: 层级 编码 名称 版本 用量 操作│ │
│    │ 📋 向下子项:   编码 名称 版本 用量 [+添加] │ │
│    └──────────────────────────────────────────┘ │
├─ 关联图文档（仅编辑模式）─────────────────────────┤
│ + 关联图文档 / 表格列表                           │
├─ 工程预变更（仅编辑模式）─────────────────────────┤
│ 关联零部件 / 清空                                 │
│ ┌─ 关联零部件表格 ─────────────────────────────┐ │
│ │ 类型 | 件号 | 中文名称 | 规格型号 | 版本 | 状态│ │
│ │ 操作（移除）                                 │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**向上溯链和向下子项的可编辑列**：

| 列 | 可编辑性 | 说明 |
|---|---------|------|
| 层级 | 只读 | 树形缩进 |
| 编码 | 只读 | |
| 名称 | 只读 | |
| 版本 | 只读 | |
| 用量 | 只读 | ECR 原始用量 |
| 操作 | 下拉选择 | `不变`/`升版`/`数量`/`删除`（向上）、`不变`/`升版`/`数量`/`删除`/`新增`（向下） |
| 目标用量 | 条件可编辑 | 仅 `数量`（向上）和 `数量`/`新增`（向下）时可输入 |
| 说明 | 可编辑 | 自由文本 |
| 执行后编码 | 只读 | `resultRow()` 计算显示 |
| 执行后名称 | 只读 | |
| 执行后版本 | 只读 | `升版`显示 nextVer，其他显示原版本 |
| 执行后用量 | 只读 | `数量`/`新增`显示目标用量，`删除`显示 0，其他显示原用量 |

**变更分析数据流**：

```
ECR 数据（ecrApi.get）
  └→ cloneNodes(ecrData): up[], down[]        ← 每条节点带 _affectedCode, _targetQty
  └→ ← executionItems 合并                    ← 复合键 entity_id|_affectedCode 匹配
  └→ localUp[] / localDown[]                   ← 用户编辑
  └→ onBomChange → bomData{ up, down }         ← 通知父组件
  └→ handleSubmit: bomData → execution_items[] ← 按复合键生成，每 BOM 节点×受影响项一条
  └→ ecoApi.update → 后端 db 保存             ← 全量替换
```

**保存/恢复架构**（`entity_id|_affectedCode` 复合键）：

| 操作 | 键 | 说明 |
|------|---|------|
| SAVE 去重 | `n.entity_id\|n._affectedCode` | 同一 BOM 节点在不同组卡片中独立保存 |
| SAVE oldMap | `it.entity_id\|it.detail._affectedCode` | 从旧 execution_items 查找，保留 source/parent_entity_id |
| MERGE lookup | `n.entity_id\|n._affectedCode` → 回退 `n.entity_id` | 优先精确匹配，无 `_affectedCode` 的旧数据用 entity_id 兜底 |
| MERGE 手工项 | `ei.entity_id\|ei.detail._affectedCode` | 检查是否已在 BOM 分析中 |

### 12.2.1 工程预变更

**用途**：ECO 独立创建时，关联顶层零部件，预览 BOM 树结构，为后续审批发布做准备。

**数据存储**：`eco.release_items` JSONB 数组，每项包含：

```jsonc
{
  "entity_type": "assembly",     // part | assembly
  "entity_id": "uuid...",
  "entity_code": "ASS-4",
  "entity_name": "底盘总成",
  "entity_version": "B",
  "spec": "规格型号",
  "status": "draft"
}
```

**编辑页交互**：

| 操作 | 说明 |
|------|------|
| 关联零部件 | 复用 `AssemblyPartPicker` 选择器，查询零件/部件并添加到列表 |
| 清空 | 清除全部关联项 |
| 移除 | 单行移除 |
| 保存 | `release_items` 随 ECO 一起保存到后端 |

**详情页显示**：

| 列 | 说明 |
|---|------|
| 层级 | 从 0 开始，`-'.repeat(level)+level` 格式，与 BOM 树一致 |
| 类型 | 部件（蓝底）/ 零件（灰底）badge |
| 件号 | `entity_code` |
| 中文名称 | `entity_name` |
| 规格型号 | `spec` |
| 版本 | `entity_version` |
| 状态 | 草稿 / 冻结 / 发布 / 作废 |
| 用量 | `quantity` |

**递归展开**：

- 部件行显示 ▶/▼ 按钮，点击加载子项 BOM（`assemblyPartsApi.list`）
- 子项中的部件可继续展开，支持无限层级
- 点击任意行弹出嵌套详情弹窗（full 宽度）：零件→`PartDetailContent`，部件→`AssemblyDetailContent`

**详情数据流**：

```
ECO 详情加载
  └→ eco.release_items[]           ← 从后端获取
  └→ ReleaseItemsTable 渲染表格
     └→ 点击 ▶ 展开 → assemblyPartsApi.list → 子项列表
        └→ 子项部件可递归展开
     └→ 点击行 → partsApi/assembliesApi.get → 嵌套详情弹窗
```

**新增文件清单**：
- 后端: `models_eco.py`, `schemas_eco.py`, `crud_eco.py`, `routers/ecos.py`
- 前端: `ECOList.tsx`, `ECOCreateModal.tsx`, `ECODetailModal.tsx`, `ECOEditView.tsx`, `ECOStatusBadge.tsx`, `ECOExecutionPanel.tsx`, `ECOCcPicker.tsx`
- 修改: `main.py`, `routers/__init__.py`, `types/index.ts`, `services/api.ts`, `Modal.tsx`, `EC.tsx`, `ECRDetailModal.tsx`

### 12.3 待后续完善

| 项目 | 优先级 | 说明 |
|------|--------|------|
| ECO 提交评审时自动冻结关联零部件 | 🟡 中 | 发布逻辑已设计（draft→reviewing 冻结，reviewing→approved 发布） |
| ECO 审批通过后自动发布关联零部件 | 🟡 中 | 同上，两阶段联动 |
| 向上溯源链中同一实体多卡片编辑冲突提示 | 🟢 低 | 目前各自独立保存 |

### 12.4 关联功能

| 功能 | 文件 | 说明 |
|------|------|------|
| 编辑部件子项清单排序 | `Components.tsx` | 类型/件号/名称/规格/版本/状态/用量 可排序 |
| 添加子项搜索列表排序 | `AssemblyPartPicker.tsx` | 件号/名称/版本/状态 可排序 |

---

## 12. ECO 手动执行模式 (v1.8)

### 12.1 设计决策

自动执行（升版、数量变更、删除、级联升版）在真实业务场景中会遇到大量特殊情况（循环引用、部分变更、跨 BOM 树影响等），难以可靠处理。v1.8 改为**手动模式**：

- 用户在 ECO 执行页面逐项点击"升版"或"还原"
- 父项/子项的关联关系由用户根据 ECR 评估结果自行判断和手动维护
- 不再提供一键自动执行

### 12.2 执行流程

```
ECO 审批通过 (status=approved)
  → 发起人点击 ECO 列表的"开始执行"按钮 → ECO status=executing
  → 点击"执行"按钮打开 ECO 执行弹窗
  → 在 ECR 变更分析内容区逐项操作：
     受影响物料 / 向上溯源链 / 向下子项 各有独立的操作列
  → 点击"升版" → 克隆旧实体创建新版本
  → 点击"还原" → 删除新版本实体，恢复未执行状态
```

### 12.3 升版规则 (`_clone_entity`)

| 实体类型 | 沿用的内容 | 清空的内容 |
|---------|-----------|-----------|
| **零件** | 基础字段、自定义字段 | 关联图文档 (`document_links=[]`) |
| **部件** | 基础字段、自定义字段、BOM 子项列表 | 关联图文档 (`document_links=[]`) |

新版本初始状态为 `draft`（需用户在零部件管理界面手动发布）。

### 12.4 ECO 状态判断

ECO 状态从数据库实时读取，不存储在 `eco_execution_items` 表中：

| 新版实体状态 (`new_entity_status`) | ECO 执行状态 | 操作列 |
|---|---|---|
| 无新版数据（未升版） | **未执行** | [升版] |
| `draft` / `frozen` | **已升版** | [还原] |
| `released` | **已发布** | [还原] |

> 若新版实体在零部件管理中被删除，`new_entity_status` 变为 `null`，ECO 状态自动回退为"未执行"。

### 12.5 API 端点

| 端点 | 说明 |
|------|------|
| `POST /ecos/{id}/execution-items/{itemId}/upgrade` | 手动升版，克隆实体创建新版本 |
| `POST /ecos/{id}/execution-items/{itemId}/revert` | 手动还原，删除新版实体并清除 `new_entity_id` |

### 12.6 ECO 执行弹窗

- ECO 列表"执行中"状态的 ECO 显示"执行"按钮
- 点击后弹出 `ECODetailModal`（`executionMode=true`）
- 弹窗标题："ECO 执行"
- ECR 变更分析的三张表（受影响物料、向上溯源链、向下子项）均有 ECO 状态和操作列
- 普通查看模式（`executionMode=false`）不显示操作按钮

### 12.7 变更描述

执行项的变更描述来自 ECR 受影响项的 `change_description`，在 ECO 创建时写入 `detail._desc`，在 ECO 执行页面的"变更操作"列显示。

---

*文档版本: v1.8 | 2026-05-26*
