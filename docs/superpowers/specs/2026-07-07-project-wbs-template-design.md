# 项目 WBS 模板功能设计方案

- **日期**：2026-07-07
- **模块**：项目管理（Project）
- **目标**：支持将现有项目的 WBS（工作分解结构）转存为可复用模板，并从模板一键生成新项目。

---

## 1. 背景与目标

现有项目管理模块已具备：`Project`（项目容器）→ `ProjectTask`（WBS 自引用树，含 任务/里程碑/评审）→ 任务依赖 `ProjectTaskDep`（FS/SS/FF/SF + lag_days）、成员、任务关联 PDM 对象、评论，以及完整的 CPM 排期引擎（`compute_schedule` 关键路径、`rollup_dates` 父任务日期上卷、`_es_lower_bound` 依赖约束）。

用户希望：
1. **从模板建项目**：选一个预设/已有的 WBS 模板，填项目名 + 开工日，一键铺出整棵任务树。
2. **项目转模板**：把跑得好的现有项目的 WBS 结构沉淀成模板，供以后复用。

> 注：需求澄清中确认是 **WBS**（任务分解结构），**不涉及任何 WPS/Office 文件解析或导入导出**。整个功能是系统内部的结构复制。

## 2. 需求边界（澄清结论）

| 决策点 | 结论 |
|---|---|
| 模板含义 | 内部模板 = 一套存起来的 WBS 结构（任务树 + 依赖 + 相对排期），存数据库 |
| 转模板时保留 | 任务树结构（名称/层级/类型/优先级/描述）✅、依赖关系 ✅、排期（转相对天数）✅ |
| 转模板时丢弃 | 成员分配/assignee ❌、任务关联 PDM 对象 ❌、评论 ❌、实际开始/结束日期 ❌、状态 ❌ |
| 排期方式 | 存**相对天数**（offset + duration），生成时按开工日自动推算，按**自然日**（不排周末/节假日） |
| 模板可见范围 | 公司共享（一个公共模板库，所有人可用来建项目） |
| 谁能建/改/删模板 | 项目经理及以上（`project_manager_or_admin` 策略）；任何能建项目的人可用模板生成 |
| 分类 | 加一个 `category` 字段（下拉字符串），初期不做复杂标签体系 |
| 存储方案 | 独立规范化表（方案①），与现有 `ProjectTask`/`ProjectTaskDep` 同构，前端可复用 WBS 树编辑器 |

**YAGNI 明确排除**：WPS/Office 文件导入导出、工作日历（排除周末/节假日）、角色占位符、模板版本管理、私有模板、标签体系。

## 3. 数据模型（3 张新表）

### 3.1 `project_templates`（模板容器）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| name | String(255) | 模板名 |
| category | String(64) nullable | 分类（下拉字符串） |
| description | Text nullable | 模板说明 |
| source_project_id | UUID FK→projects.id nullable | 溯源；预置/手建模板为空 |
| created_by | UUID FK→users.id | |
| created_at / updated_at | DateTime | |
| deleted_at | DateTime nullable | 软删除 |

### 3.2 `template_tasks`（模板任务树）

照搬 `ProjectTask` 去掉运行期字段，日期换成相对天数。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| template_id | UUID FK→project_templates.id (CASCADE) | |
| parent_id | UUID FK→template_tasks.id nullable | 自引用树 |
| name | String(255) | |
| task_type | String(8) default "任务" | 任务/里程碑/评审 |
| priority | String(4) default "中" | 高/中/低 |
| description | Text nullable | |
| sort_order | Integer default 0 | |
| **offset_start_days** | Integer nullable | 相对开工日的偏移天数（叶任务；父任务不存，靠上卷）。无日期则空 |
| **duration_days** | Integer nullable | 工期天数。里程碑=1（单日）。无日期则空 |

### 3.3 `template_task_deps`（模板依赖）

照搬 `ProjectTaskDep`，外键指向 `template_tasks`。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| template_id | UUID FK→project_templates.id (CASCADE) | |
| predecessor_id | UUID FK→template_tasks.id (CASCADE) | |
| successor_id | UUID FK→template_tasks.id (CASCADE) | |
| dep_type | String(2) default "FS" | FS/SS/FF/SF |
| lag_days | Integer default 0 | |

> 迁移方式对齐现有 `migrations_project.py` 的风格（建表 + 索引）。

## 4. 核心流程

### 4.1 流程 A —— 现有项目「存为模板」

**入口**：项目详情页 `[存为模板]` 按钮，仅 `project_manager_or_admin` 可见。弹窗填：模板名 / 分类 / 说明。

**后端 `create_template_from_project(db, project_id, name, category, description, created_by)`**：
1. 拉取该项目的任务树 + 依赖（复用 `get_task_tree` / `list_deps`）。
2. 算基准原点 `origin = min(planned_start for 叶任务 if planned_start)`；若无任何叶任务有日期，则所有 offset/duration 留空。
3. 逐任务复制结构（name / task_type / priority / description / 层级 parent 映射 / sort_order）：
   - 叶任务且有完整日期 → `offset = (planned_start - origin).days`，`duration = (planned_end - planned_start).days + 1`
   - 否则 offset/duration 留空
   - 父任务不存 offset/duration（生成后由 `rollup_dates` 上卷）
4. 依赖：按 `旧 ProjectTask.id → 新 template_task.id` 映射重建。
5. 丢弃 assignee / status / actual_start / actual_end / 评论 / 关联对象 / 成员 / code（模板任务不需要 code，生成时重排）。
6. 写入 `project_templates` + `template_tasks` + `template_task_deps`，`source_project_id = project_id`。

### 4.2 流程 B —— 「从模板新建项目」

**入口**：新建项目弹窗增加 `[从模板创建]` 选项 → 挑模板（可按 category 筛）→ 填 项目名 / 编号(自动) / 开工日 / owner(默认自己)。

**后端 `create_project_from_template(db, template_id, project_name, planned_start, owner_id)`**：
1. `create_project` 建项目容器（复用现有逻辑，code 用 `_next_project_code`）。
2. 遍历模板任务树，逐个 `create ProjectTask`：
   - 保留 层级(parent 映射) / sort_order / task_type / priority / description
   - code 重排（复用 `_next_task_code`）
   - assignee = 空，status = "未开始"，actual 日期为空
   - `offset_start_days` 有值 → `planned_start = 开工日 + offset`，`planned_end = planned_start + duration - 1`
   - offset 为空 → 计划日期留空
   - 里程碑复用 `_enforce_milestone_single_day` 校验
3. 依赖：按 `template_task.id → 新 ProjectTask.id` 映射重建 `ProjectTaskDep`。
4. 返回新项目，前端跳到项目详情页；甘特图/关键路径直接复用现有 `compute_schedule`，无需额外处理。

## 5. 模板库管理

- 新增**模板库页面**：列表 + 分类筛选 + 「编辑模板」（复用现有 WBS 树编辑器，指向 template_tasks）+ 软删除。
- 权限：`project_manager_or_admin` 建/改/删模板；任何能建项目的人可用模板生成项目。
- 手动新建空模板 + 逐任务编辑亦走同一套树编辑器（`source_project_id` 为空）。

## 6. 边界与错误处理

- 源项目/模板任务无日期 → offset/duration 留空 → 生成后计划日期留空，不报错。
- 依赖无环：源项目本身已通过 `_would_create_cycle` 禁环，模板天然无环；生成时按映射重建即可。
- 里程碑单日：转模板 duration=1；生成时复用 `_enforce_milestone_single_day`。
- 空模板（无任务）允许存在与生成，生成一个只有容器的空项目。
- 删除模板为软删除，不影响已由其生成的项目（两者无运行期外键关联，仅 `source_project_id` 溯源）。

## 7. 前后端改动清单

**后端**
- `models_project.py`：新增 `ProjectTemplate` / `TemplateTask` / `TemplateTaskDep`。
- `migrations_project.py`：新增 3 表建表 + 索引迁移。
- `schemas_project.py`：模板相关 Pydantic schema（Create/Edit/Out、任务树、生成入参）。
- `crud_project.py`：`create_template_from_project`、`create_project_from_template`、模板 CRUD + 任务/依赖编辑。
- `routers/projects.py`：模板 REST 路由（列表/详情/建/改/删、转模板、从模板生成）。
- `permissions/policies.py`：模板写操作复用 `project_manager_or_admin`。

**前端**
- `types/project.ts`、`services/projectApi.ts`：模板类型 + API。
- `stores/project.ts`：模板状态。
- 模板库页面（列表 + 分类筛选 + 树编辑器复用）。
- 项目详情页 `[存为模板]` 按钮 + 弹窗。
- 新建项目弹窗增加 `[从模板创建]` 分支。
- UI 沿用现有项目管理页面风格（primary-* 配色、共享 Modal、统一表格/工具栏）。

## 8. 测试要点

- `create_template_from_project`：offset/duration 计算正确、依赖映射正确、运行期字段被丢弃。
- `create_project_from_template`：日期按开工日推算正确、层级/依赖还原、里程碑单日、无日期任务留空。
- 权限：非 `project_manager_or_admin` 不能建/改/删模板。
- 边界：空模板、无日期任务、单任务模板。
