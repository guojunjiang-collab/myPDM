# 零部件检入检出 PDM 系统设计

> 版本: v1.0  
> 日期: 2026-07-06  
> 参考: DocDoku PLM (PartMaster/PartRevision/PartIteration 三层模型)

---

## 一、概述

将 myPDM 现有的单表 `components` 拆分为 DocDoku 风格的三层模型，并实现完整的签出/签入（Check-out/Check-in）机制，用于零部件的数据迭代版本管理。

### 设计目标

- **三层模型**：PartMaster（身份）→ PartRevision（版本）→ PartIteration（迭代）
- **签出/签入**：设计迭代阶段的协作锁机制，防止并发冲突
- **级联操作**：对 Assembly 的 BOM 树递归签出/签入
- **迭代快照**：每次签入保留完整数据快照，历史可追溯
- **兼容现有状态机**：draft → frozen → released → obsolete

### 服务对象

| 层 | 服务于 | 生命周期 | 核心职责 |
|----|--------|---------|---------|
| **PartMaster** | 全局标识 | 创建→软删除 | 件号/名称/规格/类型，永远不变 |
| **PartRevision** | 生产 | draft→frozen→released→obsolete | 版本形态+签出锁，发布后即固化 |
| **PartIteration** | 设计 | 签出时生，撤销时死，发布后冻结 | 设计师的实验空间，WIP 状态下的数据载体 |

---

## 二、数据模型

### 2.1 PartMaster（零件主数据）

```
part_masters
┌─────────────────────────┐
│ id          UUID PK     │
│ code        VARCHAR(64) │ ← 件号，唯一（软删除部分索引）
│ name        VARCHAR(255)│ ← 中文名称
│ spec        VARCHAR(255)│ ← 规格型号
│ type        VARCHAR(16) │ ← part / assembly
│ creator_id  UUID→users  │
│ created_at  TIMESTAMP   │
│ updated_at  TIMESTAMP   │
│ deleted_at  TIMESTAMP   │ ← 软删除
└─────────────────────────┘
```

**唯一约束**：`(code) WHERE deleted_at IS NULL`

### 2.2 PartRevision（版本）

```
part_revisions
┌──────────────────────────────┐
│ id                  UUID PK  │
│ master_id           UUID→part_masters  │
│ version             VARCHAR(32) │ ← A/B/C...（24进制不含I/O）
│ status              VARCHAR(32) │ ← draft / frozen / released / obsolete
│ revision_note       TEXT       │ ← 版本说明
│ check_out_user_id   UUID→users (nullable) │
│ check_out_date      TIMESTAMP (nullable) │
│ latest_iteration    INTEGER DEFAULT 0 │
│ revision_parent_id  UUID→part_revisions (nullable) │
│ creator_id          UUID→users  │
│ created_at          TIMESTAMP   │
│ updated_at          TIMESTAMP   │
│ deleted_at          TIMESTAMP   │
└──────────────────────────────┘
```

**唯一约束**：`(master_id, version) WHERE deleted_at IS NULL`

### 2.3 PartIteration（迭代）

```
part_iterations
┌──────────────────────────────┐
│ id               UUID PK     │
│ revision_id      UUID→part_revisions │
│ iteration        INTEGER     │ ← 从1开始
│ check_in_date    TIMESTAMP (nullable) │
│ check_in_note    TEXT        │ ← 签入说明
│ custom_fields    JSONB       │ ← 自定义字段值
│ document_links   JSONB       │ ← 关联图文档
│ remark           TEXT        │ ← 备注
│ created_at       TIMESTAMP   │
└──────────────────────────────┘
```

**唯一约束**：`(revision_id, iteration)`

### 2.4 BOMItem（BOM 关系）

BOM 关系随迭代快照，签出时复制，撤销时级联删除。

```
bom_items
┌──────────────────────────────┐
│ id                     UUID PK│
│ iteration_id           UUID→part_iterations │ ← 所属迭代
│ parent_revision_id     UUID→part_revisions │
│ child_revision_id      UUID→part_revisions │
│ quantity               INTEGER DEFAULT 1 │
│ sort_order             INTEGER │
│ created_at             TIMESTAMP │
│ updated_at             TIMESTAMP │
│ deleted_at             TIMESTAMP │
└──────────────────────────────┘
```

### 2.5 PartAttachment（附件）

```
part_attachments
┌──────────────────────────────┐
│ id               UUID PK     │
│ iteration_id     UUID→part_iterations │
│ category         VARCHAR(32) │ ← cad / production
│ file_name        VARCHAR(255)│
│ file_size        INTEGER     │
│ file_path        VARCHAR(512)│
│ file_hash        VARCHAR(64) │
│ created_at       TIMESTAMP   │
└──────────────────────────────┘
```

### 2.6 实体关系总览

```
PartMaster（件号/名称/规格/类型，永久不变）
  │
  ├── 1:N ──→ PartRevision（版本A/B/C，持有签出锁和状态）
  │              │
  │              └── 1:N ──→ PartIteration（迭代1/2/3，承载可变数据）
  │                             │
  │                             ├── 1:N ──→ PartAttachment（CAD/生产附件）
  │                             ├── 1:N ──→ BOMItem（BOM子项，parent通过revision; child指向子revision）
  │                             ├── custom_fields（JSONB）
  │                             ├── document_links（JSONB）
  │                             └── remark
  │
  └──（BOMItem.child_revision_id → PartRevision，版本级引用）
```

---

## 三、状态机

```
draft ──→ frozen ──→ released ──→ obsolete
  ↑         │
  └── 撤回解冻 ┘
```

| 转换 | 操作 | 条件 |
|------|------|------|
| draft → frozen | 冻结 | draft 状态 |
| frozen → released | 发布 | frozen 状态 |
| released → obsolete | 作废 | released 状态 |
| frozen → draft | 撤回解冻 | frozen 状态 |

### 签出约束

| 状态 | 可签出 | 说明 |
|------|:---:|------|
| draft | 是 | 设计迭代阶段 |
| frozen | 否 | ECO 审批中，锁定 |
| released | 否 | 已发布，只读（需走升版） |
| obsolete | 否 | 已作废（需走升版） |

---

## 四、核心业务流程

### 4.1 创建零件

```
1. 创建 PartMaster（code, name, spec, type）
2. 自动创建 PartRevision（version=A, status=draft）
3. 自动创建 PartIteration（iteration=1）
4. 返回 PartMaster + Revision + Iteration
```

### 4.2 签出（checkout）

```
前置条件:
  - revision.status == "draft"
  - revision.check_out_user_id IS NULL（未被他人签出）

操作:
  1. latest_iteration += 1 → 创建新 PartIteration
  2. 复制上一迭代的全部数据（custom_fields, document_links, remark, 附件引用, BOM关系）
  3. revision.check_out_user_id = current_user
  4. revision.check_out_date = now()

返回: revision + 新 iteration
```

### 4.3 签入（checkin）

```
前置条件:
  - revision.check_out_user_id == current_user（本人签出的）

操作:
  1. revision.check_out_user_id = NULL
  2. revision.check_out_date = NULL
  3. iteration.check_in_date = now()
  4. iteration.check_in_note = 用户填写

返回: revision + iteration
```

### 4.4 撤销签出（undocheckout）

```
前置条件:
  - revision.check_out_user_id == current_user
  - latest_iteration > 1（至少保留一个迭代）

操作:
  1. 删除最新 PartIteration（级联删除其附件引用）
  2. latest_iteration -= 1
  3. revision.check_out_user_id = NULL
  4. revision.check_out_date = NULL

返回: revision（回滚到上一迭代状态）
```

### 4.5 发布（release）

```
前置条件:
  - revision.status in ("draft", "frozen")
  - 未被签出

操作:
  revision.status = "released"

效果: 当前迭代数据即为最终生产数据，版本只读
```

### 4.6 冻结/解冻（freeze/unfreeze）

```
冻结: draft → frozen（ECO 提审时自动调用）
解冻: frozen → draft（ECO 撤回时调用）
```

### 4.7 升版（upgrade）

```
前置条件:
  - revision.status in ("released", "obsolete")

操作:
  1. 计算新版本号（24进制序列）
  2. 创建新 PartRevision（version=新版本, status=draft）
  3. 复制源版本当前迭代全部数据到新 Iteration 1
  4. 自动签出（check_out_user_id = current_user）

返回: 新 revision + iteration
```

### 4.8 管理员强制签入（force-checkin）

```
前置条件:
  - current_user.role == "admin"
  - revision.check_out_user_id IS NOT NULL

操作:
  1. 清除签出锁
  2. 保留当前迭代（不删除）

用途: 解决死锁（用户离职/长期未签入）
```

### 4.9 级联签出（cascade-checkout）

```
输入: 一个 assembly 的 revision_id

逻辑:
  1. 递归获取该 revision 的 BOM 树下所有子孙 revision
  2. 对每个子孙 revision:
     - 如果 status=draft 且 未签出 → 执行签出
     - 否则 → 跳过（记录失败原因）
  3. 独立事务，部分失败不影响其他

返回: { succeedCount, failedCount, failedItems[] }
```

级联签入、级联撤销签出同理。

### 4.10 签出权限矩阵

| 条件 | 签出 | 签入 | 撤销 | 强制签入 |
|------|:--:|:--:|:--:|:-----:|
| 未签出 + draft | **是** | — | — | — |
| 已签出 + 本人 | — | **是** | **是** | — |
| 已签出 + 他人 | — | — | — | **admin** |
| frozen / released / obsolete | — | — | — | — |

---

## 五、API 设计

### 5.1 PartMaster

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/parts/` | 零件主数据列表 |
| `POST` | `/api/parts/` | 创建新零件（含初始 Revision A + Iteration 1） |
| `GET` | `/api/parts/{master_id}` | 零件详情 |
| `PUT` | `/api/parts/{master_id}` | 更新主数据 |
| `DELETE` | `/api/parts/{master_id}` | 软删除（级联所有版本） |

### 5.2 PartRevision

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/parts/{master_id}/revisions` | 版本列表 |
| `GET` | `/api/parts/revisions/{revision_id}` | 版本详情 |
| `POST` | `/api/parts/revisions/{revision_id}/upgrade` | 升版 |
| `POST` | `/api/parts/revisions/{revision_id}/release` | 发布 |
| `POST` | `/api/parts/revisions/{revision_id}/freeze` | 冻结 |
| `POST` | `/api/parts/revisions/{revision_id}/unfreeze` | 解冻 |
| `POST` | `/api/parts/revisions/{revision_id}/obsolete` | 作废 |
| `DELETE` | `/api/parts/revisions/{revision_id}` | 软删除 |

### 5.3 签出/签入

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/parts/revisions/{revision_id}/checkout` | 签出 |
| `POST` | `/api/parts/revisions/{revision_id}/checkin` | 签入 |
| `POST` | `/api/parts/revisions/{revision_id}/undocheckout` | 撤销签出 |
| `POST` | `/api/parts/revisions/{revision_id}/force-checkin` | 管理员强制签入 |

### 5.4 PartIteration

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/parts/revisions/{revision_id}/iterations` | 迭代历史列表 |
| `GET` | `/api/parts/revisions/{revision_id}/iterations/{iter_id}` | 迭代详情 |

### 5.5 级联操作

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/parts/revisions/{revision_id}/cascade-checkout` | 级联签出 |
| `POST` | `/api/parts/revisions/{revision_id}/cascade-checkin` | 级联签入 |
| `POST` | `/api/parts/revisions/{revision_id}/cascade-undocheckout` | 级联撤销签出 |

### 5.6 BOM

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/parts/revisions/{revision_id}/bom` | 当前迭代的 BOM 树 |
| `POST` | `/api/parts/revisions/{revision_id}/bom/items` | 添加 BOM 子项 |
| `DELETE` | `/api/parts/revisions/{revision_id}/bom/items/{item_id}` | 删除 BOM 子项 |
| `PUT` | `/api/parts/revisions/{revision_id}/bom/items/{item_id}` | 修改 BOM 子项 |

### 5.7 关键 Schema

```python
class CheckinRequest(BaseModel):
    check_in_note: Optional[str] = None

class PartRevisionResponse(BaseModel):
    id: UUID
    master_id: UUID
    version: str
    status: str
    check_out_user: Optional[UserBrief]
    check_out_date: Optional[datetime]
    latest_iteration: int
    current_iteration: PartIterationResponse
    revision_parent_id: Optional[UUID]

class PartIterationResponse(BaseModel):
    id: UUID
    iteration: int
    check_in_date: Optional[datetime]
    check_in_note: Optional[str]
    custom_fields: dict
    document_links: list
    remark: Optional[str]
    created_at: datetime
```

---

## 六、前端 UI 设计

### 6.1 零件列表页

列表展示所有版本（同一件号多行），新增签出状态列：

| 件号 | 名称 | 版本 | 状态 | 签出状态 | 操作 |
|------|------|------|------|---------|------|
| BR-001 | 左支架 | C | 草稿 | 李工 07-06 | [详情] |
| BR-001 | 左支架 | B | 已发布 | — | [详情] |
| BR-002 | 底板 | A | 冻结 | — | [详情] |

### 6.2 零件详情页（TAB 形式）

顶部固定区域 + 6 个 TAB：

```
┌─────────────────────────────────────────────────────────────┐
│  ← 返回列表                                                  │
│  件号: BR-001  名号: 左支架  规格: Q345 t=3mm  类型: Part      │
│  创建人: 王工  创建时间: 2026-01-15                            │
│                                                              │
│  版本: [C ▼]  状态: 草稿  签出状态: 李工 07-06 10:30           │
│  [签出] [检入] [撤销签出]  [冻结] [发布] [升版] [作废]           │
│  ─────────────────────────────────────────────────────────── │
│  [基本信息] [BOM结构] [关联文档] [附件] [版本历史] [迭代历史]     │
└─────────────────────────────────────────────────────────────┘
```

#### TAB 描述

| TAB | 内容 | 备注 |
|-----|------|------|
| **基本信息** | 自定义字段 + 备注 + 当前迭代号/签入说明 | 签出后可编辑 |
| **BOM结构** | 树形 BOM 表格 + 级联操作按钮 | 仅 Assembly 显示 |
| **关联文档** | document_links 列表 + 增删 | 签出后可编辑 |
| **附件** | CAD/生产附件列表 + 上传/下载/预览 | 签出后可编辑 |
| **版本历史** | 同编码所有版本列表 + 切换 | 只读 |
| **迭代历史** | 当前版本的迭代列表 + 回看快照 | 只读 |

#### 迭代数据回看

- 点击历史迭代的「查看数据」→ 所有 TAB 切换到该迭代的快照（只读）
- 底部提示条：`正在查看 Iteration #2 的历史数据（只读） [返回当前迭代]`
- 签出/签入按钮隐藏

### 6.3 签出/签入按钮状态

| 状态 | 签出 | 签入 | 撤销签出 |
|------|:--:|:--:|:--:|
| 未签出 + draft | **可用** | 禁用 | 禁用 |
| 已签出 + 本人 | 禁用 | **可用** | **可用** |
| 已签出 + 他人 | 禁用 | 禁用 | 禁用 |
| frozen/released/obsolete | 隐藏 | 隐藏 | 隐藏 |

### 6.4 签入弹窗

```
┌──────────────────────────┐
│  签入说明（选填）           │
│  ┌──────────────────────┐│
│  │ 调整孔径从Φ10→Φ12     ││
│  └──────────────────────┘│
│       [取消]  [确认签入]   │
└──────────────────────────┘
```

### 6.5 级联操作确认弹窗（Assembly 专属）

BOM 结构 TAB 工具栏具备级联按钮，点击后弹窗预览影响范围：

```
┌───────────────────────────────────────┐
│  级联签出确认                          │
│  将对以下零件执行签出：                  │
│  ┌───────────────────────────────────┐│
│  │ ✓ BR-002 底板 (A, draft)         ││
│  │ ✓ BR-003 法兰盘 (A, draft)       ││
│  │ ✗ BR-004 垫片 (A, released)       ││
│  │ ✓ BR-005 螺栓 (A, draft)         ││
│  └───────────────────────────────────┘│
│  成功: 3  跳过: 1                      │
│           [取消]  [确认签出]            │
└───────────────────────────────────────┘
```

---

## 七、迁移策略

### 7.1 现有 components 表迁移

```
components（旧）
  ├── code → part_masters.code
  ├── name → part_masters.name
  ├── spec → part_masters.spec
  ├── 动态推断 type → part_masters.type
  ├── version → part_revisions.version
  ├── status → part_revisions.status
  ├── revisions (JSONB) → 按需生成 part_revisions 历史行
  ├── revision_parent_id → part_revisions.revision_parent_id
  ├── custom_fields 值 → part_iterations.custom_fields
  ├── document_links → part_iterations.document_links
  ├── remark → part_iterations.remark
  └── created_at → part_masters.created_at

旧 component_attachments → part_attachments（iteration_id 指向 iteration=1）
旧 bom_items → 新 bom_items（parent_id/child_id 改为 revision_id）
```

### 7.2 迁移脚本

启动时 `main.py` 自动检测并执行迁移，在 `initdb/migrations/` 保留历史记录。

---

## 八、权限

### 新增权限（permissions.json）

```json
{
  "parts:checkout": ["admin", "engineer"],
  "parts:checkin": ["admin", "engineer"],
  "parts:undocheckout": ["admin", "engineer"],
  "parts:force-checkin": ["admin"],
  "parts:upgrade": ["admin", "engineer"],
  "parts:release": ["admin", "engineer"],
  "parts:freeze": ["admin", "engineer"],
  "parts:unfreeze": ["admin"],
  "parts:obsolete": ["admin", "engineer"],
  "parts:cascade-checkout": ["admin", "engineer"],
  "parts:cascade-checkin": ["admin", "engineer"],
  "parts:cascade-undocheckout": ["admin", "engineer"]
}
```

### 对象级策略

- 签入/撤销签出：仅签出者本人可操作（或 admin 强制签入）
- 升版：revision 必须为 released/obsolete 状态
- freeze：ECO 提审时自动调用，系统级操作

---

## 九、实施范围

### 包含

- PartMaster/PartRevision/PartIteration 三层数据模型
- 签出/签入/撤销签出 核心流程
- 级联签出/签入/撤销签出（BOM 树递归）
- 管理员强制签入
- 升版/发布/冻结/解冻/作废
- 迭代历史回看
- TAB 式零件详情页
- 数据迁移脚本

### 不包含（本次设计范围外）

- 文档（Document）的签出签入（后续独立设计）
- 级联操作的路径选择器（DocDoku 的 path 参数）
- 并发冲突检测（多人同时编辑同一迭代的不同字段）
