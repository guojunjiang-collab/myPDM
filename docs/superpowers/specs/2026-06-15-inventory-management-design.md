# 库存管理模块 · 设计文档

- 日期：2026-06-15
- 状态：已实现（2026-06-15，dev 分支，后端 94 测试全绿、前端 build 通过；待 Docker 端到端手测）
- 分支建议：基于 `dev`
- 关联：复用现有 ECR/ECO 审批范式；与 PDM 零件/部件(Part/Assembly) 打通

---

## 1. 背景与目标

在现有 PDM 系统（FastAPI + SQLAlchemy + PostgreSQL；React + TS + Zustand + Tailwind）基础上新增**库存管理模块**，覆盖：

- 库存数量管理（多仓库、批次）
- 出库、入库、调拨、盘点、库存调整 5 类单据
- 单据审批闭环（审批通过后过账才影响账面库存）
- 发起人与库管员职责分离（指定库管员执行实物清点与过账）

`frontend/src/pages/Inventory.tsx` 当前为占位空壳，导航已有「库存管理（开发中）」入口，本模块将其落地。

## 2. 需求决策（已锁定）

| 维度 | 决定 |
|---|---|
| 记账粒度 | 数量 + 批次（序列号留二期）|
| 仓库 | 多仓库、无库位；支持仓间调拨 |
| 物料主数据 | 以 PDM 零件/部件为主，可登记非 PDM 物料（统一一张表）|
| 单据类型 | 入库、出库、调拨、盘点、库存调整（5 类）|
| 审批 | 全部单据审批通过后才过账，复用 ECR/ECO 审批范式 |
| 过账执行 | 审批通过后由**指定库管员**手动过账（两段式，仿 ECO「审批→执行」）|
| 角色 | 复用现有 `admin/engineer/production/guest`，审批人/库管员单据级指定 |

## 3. 架构方向（已确认）

- **库存存储**：「余额快照 + 流水台账」双表。`inventory_stock` 存当前余额（查询快）；`inventory_ledger` 不可变流水（审计/对账），过账时单事务内写流水 + 改余额。
- **单据建模**：统一单据表 + 统一过账引擎。5 类单据共用 `inventory_documents` + `inventory_document_lines` + 一套审批/过账逻辑，差异仅在「对库存的方向」和用到的仓库字段。

## 4. 数据模型

新建 `backend/app/models_inventory.py`，共 8 张表（沿用 UUID 主键、JSONB、软删除 `deleted_at`、`created_at/updated_at` 风格）。

### 4.1 主数据

**`warehouses`（仓库）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| code | String(64) 唯一 | 仓库编码 |
| name | String(255) | 仓库名称 |
| type | String(32) | 原料库/成品库/不良品库/通用… |
| default_keeper_id | UUID 可空 | 该仓默认库管员（建单时带出）|
| status | String(32) 默认 active | |
| remark | Text | |
| created_at / updated_at / deleted_at | | 软删除 |

**`inventory_materials`（物料主数据）** —— 统一管 PDM 件与非 PDM 物料

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| code | String(64) 唯一 | 物料编码 |
| name | String(255) | 名称 |
| spec | String(255) | 规格 |
| unit | String(32) | 计量单位（个/kg/m…）|
| source_type | String(16) | `part` / `assembly` / `standalone` |
| ref_entity_type | String(16) 可空 | `part` / `assembly`（standalone 为空）|
| ref_entity_id | UUID 可空 | 关联的 PDM 实体 id |
| track_mode | String(16) | `quantity`(数量) / `batch`(批次) |
| safety_stock | Numeric(14,4) 可空 | 安全库存下限（低于则预警）|
| status | String(32) 默认 active | |
| remark | Text | |
| created_at / updated_at / deleted_at | | |

> PDM 零件/部件「启用库存」→ 生成一条带 `ref_entity_*` 的 material（快照 code/name）；非 PDM 物料手工新建为 standalone。

### 4.2 库存账（架构核心）

**`inventory_stock`（库存余额·快照）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| material_id | UUID FK | |
| warehouse_id | UUID FK | |
| batch_no | String(64) 默认 `''` | 数量追踪物料用空串，保证唯一约束成立 |
| quantity | Numeric(14,4) 默认 0 | 当前余额 |
| updated_at | | |

唯一约束：`(material_id, warehouse_id, batch_no)`。

**`inventory_ledger`（库存流水·只追加不可改）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| material_id, warehouse_id, batch_no | | 变动落点 |
| direction | String(4) | `in` / `out` |
| quantity | Numeric(14,4) | 恒正 |
| balance_after | Numeric(14,4) | 该落点过账后余额（审计）|
| doc_id, doc_type, doc_number, doc_line_id | | 来源单据 |
| operator_id, operator_name | | 过账人 |
| created_at | | |

### 4.3 单据与审批（复用 ECR/ECO 范式）

**`inventory_documents`（单据主表·5 类共用）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| doc_number | String(32) 唯一 | 类型前缀 + 顺序号，见 6.3 |
| doc_type | String(16) | `inbound`/`outbound`/`transfer`/`stocktake`/`adjustment` |
| biz_type | String(32) 可空 | 业务子类（采购入库/完工入库/退货入库；生产领料/销售/报废…）|
| status | String(16) 默认 draft | `draft`/`reviewing`/`approved`/`posted`/`rejected`/`cancelled` |
| warehouse_id | UUID FK | 主仓（出库源仓/入库目标仓/盘点仓/调整仓）|
| to_warehouse_id | UUID FK 可空 | 仅调拨：目标仓 |
| reviewers | JSONB 默认 [] | 审批人列表（仿 ECO）|
| review_mode | String(8) 默认 all | `all`(会签) / `any`(或签) |
| keeper_id | UUID FK 可空 | 指定库管员（过账执行人）|
| keeper_name | String(64) 可空 | 快照 |
| creator_id | UUID FK | |
| document_links | JSONB 默认 [] | 附件（复用现有附件范式）|
| remark | Text | |
| reviewed_at, posted_at | | |
| created_at / updated_at / deleted_at | | |

**`inventory_document_lines`（单据明细行）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| doc_id | UUID FK (CASCADE) | |
| material_id | UUID FK | |
| batch_no | String(64) 默认 `''` | |
| quantity | Numeric(14,4) | 出入库/调拨数量；调整单为正数，方向由 `direction` 定 |
| direction | String(4) 可空 | 仅调整单：`in`(盘盈) / `out`(报损) |
| book_quantity | Numeric(14,4) 可空 | 仅盘点：账面数（创建时带出，过账时按实时账面重算）|
| counted_quantity | Numeric(14,4) 可空 | 仅盘点：实盘数（过账时由库管员填）|
| remark | Text | |
| sort_order | Integer 默认 0 | |

**`inventory_review_records`（审批记录）** —— 镜像 `ECOReviewRecord`

| 字段 | 说明 |
|---|---|
| id, doc_id(FK CASCADE), reviewer_id, reviewer_name, decision, comment, created_at | |

**`inventory_status_logs`（状态流转日志）** —— 镜像 `ECOStatusLog`

| 字段 | 说明 |
|---|---|
| id, doc_id(FK CASCADE), from_status, to_status, operator_id, operator_name, comment, created_at | |

## 5. 状态机与过账引擎

### 5.1 状态机（5 类共用）

```
draft ──提交──▶ reviewing ──全部/任一审批通过──▶ approved ──过账──▶ posted
  ▲                  │
  │                  ├──任一审批人退回──▶ draft（可改后重提）
  └──撤回────────────┘
                     └──拒绝──────────▶ rejected（终态）
draft/rejected ──删除──▶ 软删除          approved ──取消──▶ cancelled（过账前可取消）
```

- 审批：`reviewers` + `review_mode`（会签 all／或签 any）；每次审批写 `review_records`，每次状态变化写 `status_logs`。
- 无审批人时提交即自动 `approved`（与 ECO 一致）。
- `approved → posted` 的执行人锁定为 `keeper_id`（或 admin）。

### 5.2 库管员（过账人）指派

- `documents.keeper_id` + `keeper_name`；`warehouses.default_keeper_id` 为默认值。
- 新建单据时 `keeper_id` 自动带出主仓默认库管员，可改。
- 发起人创建时可指定；审批人审批时可改派；admin 随时可改——均**仅限过账前**。
- keeper 必须为有库存权限的角色（production/engineer/admin），guest 不可被指派。

### 5.3 过账引擎（单事务：写流水 + 改余额，任一行失败整单回滚）

| 单据 | 对库存的作用 | 流水条数 |
|---|---|---|
| 入库 | 每行 `+quantity` 到〔物料·主仓·批次〕 | 1（in）|
| 出库 | 每行 `−quantity` 从〔物料·主仓·批次〕，校验余额充足 | 1（out）|
| 调拨 | 每行源仓 `−`、目标仓 `+`，校验源仓充足 | 2（out+in）|
| 盘点 | 每行 `差异 = 实盘 − 账面`；正差 in、负差 out，校正余额到实盘 | 1 |
| 调整 | 每行按 `direction` 直接 `+/−`（盘盈/报损）| 1 |

### 5.4 校验与一致性

- 过账对涉及的 `inventory_stock` 行 `SELECT ... FOR UPDATE` 行锁，防并发出库导致负库存。
- 出库/调拨：源仓可用量 < 出库量则拒绝过账并提示（不允许负库存）。
- 盘点/调整：以**过账时实时账面**为基准计算差异，避免「创建时账面」过期。
- 过账幂等：`posted` 后单据冻结；重复过账被状态机拦截；流水带 `doc_line_id` 可追溯防重。

## 6. API 设计

新建 `backend/app/routers/inventory.py` + `crud_inventory.py` + `schemas_inventory.py`，挂载到 `main.py`，前缀 `/api/inventory`，沿用 `require_role`。

### 6.1 仓库 `/api/inventory/warehouses`

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/` 列表 | 全角色只读 |
| POST | `/` 新建 | admin/engineer |
| GET / PUT / DELETE | `/{id}` | 读=全角色；改/删=admin/engineer |

### 6.2 物料 `/api/inventory/materials`

| 方法 | 路径 | 说明/权限 |
|---|---|---|
| GET | `/` 列表 | 按 source_type/track_mode/关键词过滤；全角色只读 |
| POST | `/` 新建 standalone | admin/engineer |
| POST | `/enable-from-pdm` | 由 PDM 零件/部件一键启用库存；admin/engineer |
| GET / PUT / DELETE | `/{id}` | 读=全角色；改/删=admin/engineer |

### 6.3 库存查询 `/api/inventory/stock`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 当前余额列表，按物料/仓库/批次过滤，支持「低于安全库存」筛选 |
| GET | `/summary` | 按物料跨仓汇总（总量 + 各仓分布）|
| GET | `/ledger` | 库存流水，按物料/仓库/单据过滤 |

### 6.4 单据 `/api/inventory/documents`（5 类共用）

| 方法 | 路径 | 状态/权限 |
|---|---|---|
| GET | `/` 列表 | 按 doc_type/status/日期/关键词过滤；全角色只读 |
| POST | `/` 新建（含明细行）| 草稿；production/engineer/admin |
| GET | `/{id}` 详情 | 含明细行 + 审批记录 + 状态日志；全角色只读 |
| PUT | `/{id}` 编辑 | 仅 `draft`；创建人/admin |
| DELETE | `/{id}` | 仅 `draft`/`rejected` 软删；创建人/admin |
| POST | `/{id}/submit` 提交 | `draft→reviewing`（无审批人则自动 approved）|
| POST | `/{id}/withdraw` 撤回 | `reviewing→draft`；创建人/admin |
| POST | `/{id}/review` 审批 | approve/reject/return；**仅指定审批人**（仿 ECO）|
| POST | `/{id}/assign-keeper` 改派库管员 | 过账前；创建人/审批人/admin |
| POST | `/{id}/post` 过账 | `approved→posted`；**仅 keeper/admin**，跑过账引擎；盘点单在此提交实盘数 |
| POST | `/{id}/cancel` 取消 | `approved→cancelled`（过账前）|

单据号：类型前缀 + 日期 + 顺序号，`IN-20260615-0001` / `OUT-` / `TR-` / `PC-`(盘点) / `ADJ-`，crud 层生成（参考现有 ECO/ECR 编号逻辑）。

## 7. 前端设计

`Inventory.tsx` 改为带 4 个 Tab 的容器，子组件放 `components/Inventory/`，复用 `Modal`/`Toast`/用户选择器/附件区(`EntityDocumentSection`)。

### 7.1 Tab ① 库存查询（默认）
- 余额表：按物料汇总，可展开「各仓库 × 批次」；低于安全库存的行红色高亮。
- 过滤：物料关键词 / 仓库 / 仅看低库存。
- 点行 → 右侧抽屉显示该物料库存流水（来源单据、增减、过账后余额）。

### 7.2 Tab ② 单据（核心）
- 列表：按类型/状态/日期过滤，状态彩色徽章。
- 「新建」下拉选 5 种类型 → 类型自适应编辑弹窗：

| 类型 | 表单要点 |
|---|---|
| 入库 | 选目标仓 + 明细行（物料/批次/数量）|
| 出库 | 选源仓 + 明细行，每行实时显示该仓可用量 |
| 调拨 | 选源仓 + 目标仓 + 明细行（显示源仓可用量）|
| 盘点 | 选仓 + 选范围物料，自动带出账面数；实盘数留到过账时由库管员填 |
| 调整 | 选仓 + 明细行（方向：盘盈+/报损−、数量、原因）|

  公共区：业务子类、审批人（会签/或签）、指定库管员（默认带出仓库默认库管员）、附件、备注。

- 详情页：明细行 + 审批记录 + 状态流转时间线（复用 ECO 详情展示），底部按状态/角色显示操作：
  - 草稿：提交/编辑/删除
  - 审批中：审批人「通过/退回/拒绝」；创建人「撤回」
  - 已审批：库管员「过账」（盘点单进过账界面逐行填实盘数）、可「改派库管员」「取消」
  - 已过账：只读 + 关联流水链接

### 7.3 Tab ③ 物料主数据
- 列表 + 新建非 PDM 物料；「从 PDM 启用」（搜零件/部件 → 一键建 material）；编辑追踪方式/安全库存。

### 7.4 Tab ④ 仓库
- 仓库 CRUD，设类型与默认库管员。

### 7.5 前端代码落点
- `services/inventoryApi.ts`（仿 `syncApi.ts`/`assistantApi.ts`）
- `stores/inventory.ts`（缓存仓库/物料列表，仿 `stores/data.ts`）
- `components/Inventory/`：`StockTable` `LedgerDrawer` `DocumentList` `DocumentEditModal` `DocumentDetailContent` `MaterialPicker`（行内选料，含 PDM 件）`MaterialList/Edit` `WarehouseList/Edit`；审批人/库管员选择复用现有用户选择器。
- 导航 `Layout.tsx`：「库存管理（开发中）」→「库存管理」。

## 8. 权限矩阵

| 操作 | admin | engineer | production | guest |
|---|---|---|---|---|
| 查询库存/单据/流水 | ✅ | ✅ | ✅ | ✅只读 |
| 建/改/删单据 | ✅ | ✅ | ✅ | ✘ |
| 审批 | ✅ | ✅ | 仅当被指定为审批人 | ✘ |
| 过账 | ✅ | 仅当被指定为 keeper | 仅当被指定为 keeper | ✘ |
| 仓库/物料主数据维护 | ✅ | ✅ | ✘ | ✘ |

## 9. 操作日志

关键动作（创建/提交/审批/改派/过账/取消）写现有 `operation_logs`（复用 `OperationLog`），`target_type='inventory_document'`。

## 10. 数据库迁移

- **Fresh 库**：新表 DDL 追加到 `initdb/init.sql`。
- **已存在库**：启动时 `Base.metadata.create_all(bind=engine)`（幂等，只建缺失表）+ 现有列对账逻辑。需在 `main.py` 启动流程导入 `app.models_inventory` 并补一行 `create_all`（计划阶段核实当前是否已有等价 create 流程）。

## 11. AI 助手联动（本期可选小项）

现有 AI 助手只读网关白名单加入 `inventory/stock`、`inventory/documents`、`inventory/materials`、`inventory/warehouses` 等 GET 端点（`backend/app/assistant/api_gateway.py`），让助手能回答「某物料还有多少库存」「某入库单状态」。低成本，纳入本期。

## 12. 测试策略

pytest（仿 `backend/tests/`）：
- 过账引擎单测：5 类单据各自余额/流水结果；出库余额不足拒绝；调拨双边流水；盘点差异校正；调整正负。
- 状态机单测：非法流转被拒（未审批不能过账、非 keeper 不能过账、已过账不能改）。
- 并发出库不产生负库存（行锁）。
- API 集成：建单→提交→审批→改派→过账全链路。

## 13. 范围边界（本期明确不做，留二期）

- ❌ 序列号单件追溯
- ❌ 维修 / RMA（独立模块）
- ❌ 库位（货架/储位）
- ❌ 成本 / 计价 / 库存估值
- ❌ 出库预占 / 冻结库存
- ❌ 采购 / 销售订单对接
- ❌ 库存预警主动推送（仅页面高亮）

## 14. 交付物清单

**后端**
- `models_inventory.py`、`schemas_inventory.py`、`crud_inventory.py`、`routers/inventory.py`
- `main.py`：挂载路由 + 启动建表
- `initdb/init.sql`：新表 DDL
- `assistant/api_gateway.py`：白名单新增库存 GET 端点
- `tests/`：过账引擎 / 状态机 / API 集成

**前端**
- `services/inventoryApi.ts`、`stores/inventory.ts`
- `pages/Inventory.tsx`（Tab 容器）
- `components/Inventory/*`
- `components/Layout.tsx`：导航文案
