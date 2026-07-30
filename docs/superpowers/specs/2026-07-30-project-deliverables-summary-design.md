# 项目交付物汇总 设计方案

日期：2026-07-30
模块：项目管理 → 项目详情

## 1. 背景与目标

项目详情页当前只能看到任务表和甘特图。项目牵动的实际数据对象（构型项、零部件、图文档、变更）散落在各任务的关联里，没有一个地方能一次看全。

本功能在项目详情页新增「交付物汇总」弹窗，把项目下所有任务关联的对象按类型汇总成清单，既作为日常导航（可点击进详情、可搜索筛选），也作为结项/评审时的交付清单（可导出 Excel）。

## 2. 口径与范围

### 2.1 关联口径

汇总口径 = **项目下所有未删除任务的 `project_task_links` 去重聚合**。

```
projects → project_tasks (deleted_at IS NULL)
        → project_task_links
        → 按 entity_type 分流 JOIN 各自的 revision / master 表
```

**不做**结构性下钻（不会顺着构型项自动带出它的零部件和图文档），**不新增**项目级直接关联表。数据模型零改动，本功能是纯读取聚合。

理由：先用最小改动验证该视图的实际价值。若使用中发现漏对象，再决定是加下钻还是加 `project_links` 直接关联。

### 2.2 行粒度

**按版本（revision）去重**，一行 = 一个版本：

- 同一零件的 A 版、B 版被不同任务关联 → 两行
- 同一版本被 3 个任务关联 → 一行，「来源任务」列合并显示 3 个任务

变更（ECR/ECO）是单实例对象，去重键即 `entity_id`。

理由：版本是 PDM 的自然交付粒度（交付的是"B 版图纸"），且保留版本级状态，支撑结项检查。

### 2.3 过滤规则

- 软删除对象（`deleted_at IS NOT NULL`）不进汇总，任务软删同理
- **已作废（obsolete）状态的版本照常显示**，用状态标签标出 —— 否则结项检查会漏掉问题项
- `configuration_item_iterations` 无软删列，跟随其 revision 的软删状态

### 2.4 权限

接口使用 `require_permission("project:read")`，与查看项目详情同级。入口按钮对所有能看到项目详情的用户可见，**不限项目经理**（区别于「成员管理」按钮）。

行点击打开的各类详情弹窗，其可见性由各自详情接口的权限控制，本功能不额外收口。

## 3. 后端设计

### 3.1 接口

```
GET /api/projects/{project_id}/deliverables
权限: project:read
```

响应：

```json
{
  "counts": { "config_items": 3, "parts": 12, "documents": 8, "changes": 2 },
  "config_items": [ /* DeliverableItem */ ],
  "parts": [ /* DeliverableItem */ ],
  "documents": [ /* DeliverableItem */ ],
  "changes": [ /* DeliverableItem */ ]
}
```

`DeliverableItem` 四类统一形状，前端四个 TAB 共用一套渲染逻辑：

```json
{
  "entity_type": "part",
  "entity_id": "<revision_id>",
  "master_id": "<master_id>",
  "code": "P-001",
  "name": "支架",
  "version": "B",
  "status": "released",
  "creator_name": "张三",
  "extra": "零件",
  "tasks": [ { "id": "...", "code": "T-01", "name": "结构设计" } ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `entity_type` | `part` / `assembly` / `component` / `document` / `config_item` / `ec` |
| `entity_id` | 版本级 id（变更为 ECR/ECO 主键），详情弹窗入参 |
| `master_id` | 主数据 id，`PartDetailModal` 需要；变更为 `null` |
| `version` | 变更类恒为 `null`（ECR/ECO 无版本概念） |
| `creator_name` | 各对象的 `creator_id` 关联 `users.real_name`；无对应用户时为空串 |
| `extra` | 专属列的值，见 3.3 |
| `tasks` | 来源任务数组，按任务 `code` 升序 |

### 3.2 实现要点

- 新建 `backend/app/crud_deliverables.py` 承载聚合逻辑（约 150 行）。`crud_project.py` 已 796 行，该逻辑自成一体，单独成模块边界更清楚且便于单测。
- 路由挂在 `backend/app/routers/projects.py` 现有 router 下。
- **共 5 条 SQL**：构型项 1 条、零部件 1 条、图文档 1 条、ECR 1 条、ECO 1 条，均以 `project_tasks JOIN project_task_links` 起手，再 JOIN 各自 revision + master + users。不做 N+1 查询。
- **去重在 SQL 之后用 Python 做**：按 `entity_id` 聚成 dict，`tasks` 数组累加。原因是要保留任务 id 供前端使用，SQL 侧 `string_agg` 不便于带结构化数据。
- ECR 与 ECO 两条查询结果合并进 `changes`，`extra` 分别取 `"ECR"` / `"ECO"`。
- 各类内部按 `code` 升序排序，保证导出结果稳定。

### 3.3 各类型的 `extra` 取值与来源

| 类型 | `extra` 含义 | 数据来源 |
|---|---|---|
| 构型项 | 版本名称 | `configuration_item_iterations.version_name`，按 `revision.latest_iteration` 定位该迭代 |
| 零部件 | 零件 / 部件 | `part_masters.type`（`part` / `assembly`）映射为中文 |
| 图文档 | 备注 | `document_revisions.remark` |
| 变更 | ECR / ECO | 由来源查询决定 |

**已知的数据模型约束**（导致与初版设想不同）：

1. `ecrs` / `ecos` 无版本字段，因此变更 TAB 不显示版本列
2. `document_masters` 无文档类型/分类字段，因此图文档专属列用「备注」而非「文档类型」
3. 四类对象均只有 `creator_id`，无独立负责人字段，因此列名为「创建人」而非「负责人」，避免与项目负责人、任务负责人混淆

### 3.4 后端测试

新增 `backend/tests/test_deliverables.py`，覆盖：

- 空项目 → 四个空数组，`counts` 全 0
- 同一版本被两个任务关联 → 只出一行，`tasks` 长度为 2
- 同一主数据的两个版本 → 出两行，各自版本号与状态正确
- 软删任务的关联 → 不出现在结果中
- 软删对象的关联 → 不出现在结果中
- obsolete 状态的版本 → 仍然出现
- ECR 与 ECO 混合 → 合并在 `changes` 中，`extra` 正确区分
- 无权限用户请求 → 403

## 4. 前端设计

### 4.1 入口

项目详情页项目信息条上、「成员管理」按钮左侧新增「交付物汇总」按钮（`frontend/src/pages/Project/Projects.tsx` 约 610 行处）。沿用同样的灰底描边样式（`px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white`），不套 `isManager` 判断。

### 4.2 弹窗结构

新组件 `frontend/src/pages/Project/DeliverableModal.tsx`（预计约 320 行）：

```
Modal (width="3xl" height="75vh", headerAction=<导出 Excel 按钮>)
 ├─ TAB 条：构型项 3 | 零部件 12 | 图文档 8 | 变更 2   （角标为该类总数）
 ├─ 工具栏：搜索框(编号/名称) + 状态下拉
 └─ 表格（sticky 表头，纵向滚动）
```

复用共享 `frontend/src/components/Modal.tsx`，其 `headerAction` / `height` 参数正好承载导出按钮与固定高度滚动。

### 4.3 列定义

| TAB | 列 |
|---|---|
| 构型项 | 编号 / 名称 / 版本 / **版本名称** / 状态 / 创建人 / 来源任务 / 操作 |
| 零部件 | 编号 / 名称 / 版本 / **类型(零件/部件)** / 状态 / 创建人 / 来源任务 / 操作 |
| 图文档 | 编号 / 名称 / 版本 / **备注** / 状态 / 创建人 / 来源任务 / 操作 |
| 变更 | 编号 / 标题 / **类型(ECR/ECO)** / 状态 / 创建人 / 来源任务 / 操作 |

粗体为该 TAB 的专属列，统一渲染自 `extra` 字段。变更 TAB 隐藏版本列。

### 4.4 交互行为

- **一次加载，本地切换**：打开弹窗时请求一次 `/deliverables` 拿全四类；切 TAB、搜索、筛状态全在前端完成，不再发请求。关闭再打开重新拉取，保证数据新鲜。导出直接用这份数据，不二次请求。
- **一套表格渲染 + 列配置驱动**：四个 TAB 共用一个 `DeliverableTable` 组件，差异仅在一个 `columns` 配置数组。避免四份近乎重复的表格代码。
- **状态下拉动态生成**：从当前 TAB 数据中 distinct `status` 生成选项，不硬编码状态字典 —— 后续任何模块新增状态值都不需要改动本功能。状态中文标签复用 `frontend/src/constants/index.ts` 的 `STATUS_OPTIONS`；变更类复用 ECR/ECO 模块已有的状态映射；映射不到的原样显示。
- **来源任务列**：显示第一个任务的 `编号 名称`，超过一个时追加 `+N` 灰色角标，`title` 属性悬浮显示完整列表。**任务名可点击**，见 4.4.1。
- **行点击 → 嵌套详情弹窗**：照搬 `frontend/src/pages/Project/TaskEditModal.tsx` 约 702 行处的分发模式，按 `entity_type` 打开 `ConfigItemDetailModal` / `PartDetailModal` / `DocumentDetailModal` / `ECRDetailModal` / `ECODetailModal`。

#### 4.4.1 来源任务点击跳转

点击来源任务 → **不关闭交付物弹窗**，在其上层直接打开现有的 `TaskEditModal`；关闭任务弹窗后回到交付物清单，TAB / 搜索 / 筛选状态保持不变。

- 多任务时，`+N` 角标展开为一个下拉列表，每项可单独点击；单任务时直接点文字。
- `TaskEditModal` 接收的是 `ProjectTask` 对象而非 id，因此 `DeliverableModal` 只向上抛 `onOpenTask(taskId)`；由 `Projects.tsx` 用已有的 `findTaskById(tasks, taskId)` 解析，复用现有的 `editTask` / `editOpen` 状态打开弹窗。**`TaskEditModal` 本身零改动。**
- 解析不到任务时（极端情况：期间任务被他人删除）弹 toast「任务不存在或已被删除」，不做其他处理。
- 任务弹窗保存后（`onSaved`）除现有的 `reload()` 外，**同时触发交付物数据重新拉取** —— 用户可能在任务弹窗里增删了关联对象，清单必须同步。

**叠放层级**：不引入 `zIndex` 层级参数，全部沿用 `Modal` 默认的 `zIndex: 50`，叠放顺序由 portal 挂载顺序决定（后挂载者在上）。这与现有 `TaskEditModal → 各详情弹窗` 的做法完全一致。已验证覆盖各种打开顺序：交付物→任务、交付物→详情、交付物→任务→详情、以及关闭任务后再开详情，后开的弹窗均在上层。若改为显式 zIndex，则需要给 `Modal` 的每一层调用方逐级透传，成本远高于收益。
- **空态与加载态**：加载中显示「加载中...」；某类为空显示「暂无关联的XXX」，措辞与现有表格空态一致。

### 4.5 导出

新增 `frontend/src/services/deliverableExport.ts`，用 SheetJS（项目已依赖）生成单个 xlsx：

- 四个 sheet，名称 `构型项` / `零部件` / `图文档` / `变更`
- 表头与页面列一致，不含「操作」列
- 文件名 `项目交付物汇总_{项目编号}_{YYYYMMDD}.xlsx`
- **导出全量四类，不受当前 TAB 与搜索/筛选影响** —— 交付清单要求完整。此行为写入按钮 `title` 提示（"导出全部四类"）以免用户误解。

### 4.6 配套改动

- `frontend/src/services/projectApi.ts`：新增 `getDeliverables(projectId)`
- `frontend/src/types/project.ts`：新增 `DeliverableItem`、`DeliverableSummary` 类型

### 4.7 前端测试

纯逻辑抽到 `frontend/src/pages/Project/deliverableUtils.ts` 并配 vitest 用例：

- 搜索过滤（编号命中、名称命中、都不命中）
- 状态过滤与「全部状态」
- 状态选项去重与顺序
- 来源任务展示文案（单任务、多任务 `+N`、空任务数组）
- `findTaskById` 解析失败时的降级路径（返回 null → 提示而非崩溃）

表格渲染本身不做快照测试，与现有前端测试策略一致。

## 5. 不做的事（YAGNI）

- 不做结构性下钻（构型项 → 其零部件 → 其图文档）
- 不新增项目级直接关联表 `project_links`
- 不做 PDF 导出（`Modal.headerAction` 留有位置，后续按需追加）
- 不做「总览」混排 TAB（导出已覆盖看全量的需求）
- 不做来源任务筛选（任务视角在任务编辑弹窗中已有）

## 6. 影响面

**新增文件**

- `backend/app/crud_deliverables.py`
- `backend/tests/test_deliverables.py`
- `frontend/src/pages/Project/DeliverableModal.tsx`
- `frontend/src/pages/Project/deliverableUtils.ts`
- `frontend/src/pages/Project/deliverableUtils.test.ts`
- `frontend/src/services/deliverableExport.ts`

**修改文件**

- `backend/app/routers/projects.py`：新增一个 GET 路由
- `frontend/src/pages/Project/Projects.tsx`：新增按钮与弹窗挂载
- `frontend/src/services/projectApi.ts`：新增一个 API 方法
- `frontend/src/types/project.ts`：新增两个类型

**不改动**：数据库 schema、权限表、任务与甘特相关逻辑。
