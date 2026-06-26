# 项目管理模块 第2期 实施记录(甘特图 / 进度)— 以代码实现为准

> 状态:**已实现并部署(dev 分支)**。本文档原为 task-by-task 实施计划,现按实际代码更新为「实施记录」。
> 实现过程中在原计划基础上**新增**了:父任务日期汇总、里程碑单日、依赖自动排期、以及大量甘特交互(详见「超出原计划的实现」)。

**Goal:** 在已有 WBS 任务上叠加甘特能力:任务依赖(FS/SS/FF/SF + lag)、自研 SVG 时间轴可视化、关键路径(CPM)、甘特条拖拽改期/划设/平移、父任务汇总、依赖自动排期。

**Architecture:** 后端把 `project_tasks` 四个日期列从 `String(32)` 迁为真正 `Date`(启动时幂等迁移),新增 `project_task_deps` 表,以及依赖 CRUD、CPM、甘特数据、父任务汇总、自动排期等逻辑;前端在「项目视图」tab 内自研 `GanttView`(SVG),并在任务编辑弹窗加「依赖」区与关联对象详情。沿用既有领域模块模式与权限单一事实源。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + PostgreSQL(测试用 SQLite);React 18 + TypeScript + Vite + Tailwind + Zustand + Axios。

设计文档:`docs/superpowers/specs/2026-06-25-project-management-phase2-3-design.md`

---

## 文件结构总览(as-built)

**后端(修改)**
- `permissions/permissions.json` — 新增 `project.task:depend`(`object_policy: project_manager_or_admin`)
- `backend/app/models_project.py` — `ProjectTask` 四个日期列 `String(32)→Date`;新增 `ProjectTaskDep`
- `backend/app/migrations_project.py`(新增) — `parse_iso_date` + `migrate_task_dates_to_date`(Postgres varchar→date,幂等)
- `backend/app/main.py` — 启动迁移块调用日期迁移 + `crud_project.persist_rollup_all`(回填父任务汇总)
- `backend/app/schemas_project.py` — 任务日期字段改 `date` + `_blank_to_none` 校验器(空串→None);新增 `DepCreate`
- `backend/app/crud_project.py` — `_iso` 序列化;依赖 CRUD + DAG;`compute_schedule`(CPM)/`_violation`;`get_gantt_data`(树 DFS 序 + 父任务汇总显示);`rollup_dates`/`persist_rollup`/`persist_rollup_all`;`auto_schedule`;`_enforce_milestone_single_day`;create/update/move/reorder/delete 后触发汇总(及改期触发自动排期)
- `backend/app/routers/projects.py` — `/gantt`、`/auto-schedule`、`/deps`(GET 含 `is_violation`)
- `backend/app/routers/parts.py` — 修复 `get_part` 缺 `return d`(任务关联零件详情打不开)

**后端(测试)**
- `backend/tests/test_project_deps.py` — 依赖 CRUD/DAG、CPM、甘特数据与 DFS 序、`_violation` 单测、父任务汇总、里程碑单日、自动排期与级联
- `backend/tests/test_project_date_migration.py` — `parse_iso_date` 幂等与容错
- `backend/tests/test_project_crud.py` — 追加日期 isoformat 序列化、空串日期规整为 None

**前端(新增)**
- `frontend/src/pages/Project/gantt/ganttUtils.ts` — 类型/常量 + 时间轴/布局/日期数学
- `frontend/src/pages/Project/gantt/GanttView.tsx` — 自研 SVG 甘特(交互见下)

**前端(修改)**
- `frontend/src/types/project.ts` — `DepType`/`TaskDependency`/`GanttTask`/`GanttData`
- `frontend/src/services/projectApi.ts` — `getGantt`/`autoSchedule`/`listDeps`/`addDep`/`removeDep`
- `frontend/src/pages/Project/Projects.tsx` — 「项目视图」tab 渲染 `GanttView` + 行点击复用 `TaskEditModal`(`ganttKey` 刷新)
- `frontend/src/pages/Project/TaskEditModal.tsx` — 「依赖」区;关联对象行点击详情(零件/部件/图文档/构型项/ECR/ECO);压缩包附件预览;空日期保存修复

---

## 后端实现要点(以代码为准)

### 数据模型(`models_project.py`)
- `ProjectTask.planned_start/planned_end/actual_start/actual_end`: `Column(Date, nullable=True)`。
- `ProjectTaskDep`: `id / project_id / predecessor_id / successor_id / dep_type(String(2),默认 FS)/ lag_days(Integer,默认 0)/ created_at`,FK 均 `ondelete=CASCADE`。

### 日期迁移(`migrations_project.py` + `main.py`)
- 仅 Postgres:列仍为字符型时,先把非 `^\d{4}-\d{2}-\d{2}$` 的值置 NULL,再 `ALTER COLUMN ... TYPE date USING NULLIF(col,'')::date`;`data_type=='date'` 时幂等跳过。SQLite 测试库直接按模型新建。
- 启动迁移块末尾调用 `crud_project.persist_rollup_all(db)` 回填存量父任务汇总日期。

### Schemas(`schemas_project.py`)
- `TaskCreate`/`TaskEdit` 四个日期字段为 `Optional[date]`,并各带:
  ```python
  @field_validator("planned_start", "planned_end", "actual_start", "actual_end", mode="before")
  @classmethod
  def _blank_to_none(cls, v):
      return None if v == "" else v
  ```
  (前端未填日期发送 `''`,否则触发 422 使保存弹窗不关闭。)
- `DepCreate`: `predecessor_id / successor_id / dep_type(Literal FS/SS/FF/SF=FS)/ lag_days(int=0)`。

### 依赖 CRUD + DAG(`crud_project.py`)
- `list_deps` / `add_dep` / `remove_dep`;`add_dep` 校验:自依赖→400、跨项目/不存在→404、重复→400、`_would_create_cycle`(从 succ 出发能否到达 pred)→400。
- `delete_task` 软删子树后,硬删 `predecessor_id`/`successor_id` 命中被删 id 的依赖。

### CPM 关键路径(`compute_schedule`)
- 仅对**有完整计划日期的叶任务**计算;闭区间天序号(`EF = ES + 工期 - 1`),前后向约束一致:
  - 前向 `_es_lower_bound`、后向 `_lf_upper_bound`,FS/SS/FF/SF 各自公式;`slack(LS-ES)==0` 即关键路径。
  - 缺日期/成环→降级返回空集,不抛错。
- `_violation(dep, tasks_by_id)`:按实际计划日期判断依赖是否违反(供前端红线)。注:启用自动排期后真实违规会被即时消除,`_violation` 主要保留为检测逻辑。

### 父任务日期汇总(`rollup_dates` / `persist_rollup` / `persist_rollup_all`)
- `rollup_dates(tasks)`:叶=自身日期,父=子孙叶「最早开始~最晚结束」包络(post-order memo)。
- `persist_rollup(db, project_id)`:把父任务存储日期写为包络(仅父任务)。
- create/update/move/reorder/delete 后均调用 `persist_rollup`;启动时 `persist_rollup_all` 回填存量。
- `get_gantt_data` 另用 `rollup_dates` 做**显示**汇总(父任务条始终正确,不依赖存储)。

### 依赖自动排期(`auto_schedule`)
- 前向拓扑遍历:**有前置依赖且有工期**的任务,起止自动对齐到所有前置约束(保留工期),沿链级联;无前置或无工期者保留自身日期。
- 约束(保留工期 `d_len = (end-start).days`):
  - FS:`succ.start = pred.end + 1 + lag`
  - SS:`succ.start = pred.start + lag`
  - FF:`succ.start = pred.end + lag - d_len`
  - SF:`succ.start = pred.start + lag - d_len`(取各前置的 max)
- **触发**:`add_dep` 后、`update_task`(改期)后,各跟一次 `auto_schedule` + `persist_rollup`。
- 手动全量:`POST /auto-schedule` 端点。

### 里程碑单日(`_enforce_milestone_single_day`)
- `task_type=='里程碑'` 时 `planned_end=planned_start`(以开始为准),在 `create_task`/`update_task` 调用,保证任何保存路径里程碑为时间点。

### `get_gantt_data` 输出
- 任务按**树 DFS 前序**输出(与项目详情同序,带 `depth`),每项含:`id/parent_id/code/name/task_type/status/assignee_name/planned_start/planned_end(汇总后)/duration_days/is_critical/is_overdue/sort_order/depth`(日期经 `_iso`)。
- `deps`:含 `is_violation`;`range`:`min_date/max_date`。

### API 端点(`routers/projects.py`)
| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/projects/{id}/gantt` | `project:read` + 成员 |
| POST | `/api/projects/{id}/auto-schedule` | `project.task:depend` + `project_manager_or_admin` |
| GET | `/api/projects/{id}/deps`(返回 `is_violation`) | `project:read` + 成员 |
| POST | `/api/projects/{id}/deps` | `project.task:depend` + policy |
| DELETE | `/api/projects/{id}/deps/{dep_id}` | `project.task:depend` + policy |

---

## 前端实现要点(以代码为准)

### `ganttUtils.ts` 常量
`DAY_PX = {day:28, week:10, month:4}`、`ROW_H=36`、`BAR_H=12`、`CODE_W=120`、`ASSIGNEE_W=72`、`LEFT_W=460`、`INDENT=20`。`barBox` 任务条垂直居中(`y = row*ROW_H + (ROW_H-BAR_H)/2`);`depAnchors` 按 FS/SS/FF/SF 返回连线端点;`STATUS_FILL` 状态配色;`computeRange`/`ticks`/`parseDate`/`addDays`/`fmtISO` 等。

### `GanttView.tsx` 布局
- **左侧固定列(sticky left-0)**:任务编号(120,按 `depth*INDENT` 缩进)/ 任务名称(类型图标 + 名称,关键路径红字)/ 负责人(72)。
- **右侧时间轴**:日/周/月缩放、today 橙色虚线、表头日期刻度;**日历铺满可视宽度**(按 `viewportW - LEFT_W` 不足时补天数)。
- **任务条**:按 status 着色、逾期红填充、关键路径红描边;里程碑菱形;父任务(汇总)灰色括号条、不可拖。
- **依赖连线**:SVG 折线按类型连端点,违规红色加粗。

### `GanttView.tsx` 交互(`movedRef` 以 4px 阈值区分点击/拖拽)
- 任务条/里程碑:**点击→打开任务详情**;**拖动→平移改期**(里程碑保持单日)。
- 叶任务条左右边缘:拖动 resize 改工期。
- 无日期叶任务行:透明覆盖层,**点击→打开详情**;**拖动→划设计划起止**(里程碑落点单日)。
- 已排期任务空白行 / 表头:**点击(空白行)→打开详情**;**拖动→左右平移视图**(grab/grabbing)。
- 改期/划设释放后 `PUT updateTask` → 重载甘特(后端自动排期级联结果随之显示)。
- 工具栏:日/周/月 + **「自动排期」按钮**(`canEdit` 显示,调 `POST /auto-schedule` 全量重排并刷新;非编辑者显示「刷新」)。
- props:`projectId / canEdit / onTaskUpdated / onRowClick / refreshKey`。

### `Projects.tsx`「项目视图」tab
- 渲染 `GanttView`:`canEdit=can('project.task:depend')`、`refreshKey=ganttKey`、`onRowClick=(id)=>openEdit(findTaskById(tasks,id))`、`onTaskUpdated=()=>loadTasks(...)`。
- 同 tab 内挂共享 `TaskEditModal`,`onSaved` → `loadTasks` + `ganttKey++`(甘特重载)。

### `TaskEditModal.tsx` 增强
- **依赖区**:列出与本任务相关依赖(FS/SS/FF/SF 徽章 + lag + 违规红标),可新增(选关联任务/类型/lag,本任务作前置或后置)、删除;`can('project.task:depend')` 控制。
- **关联对象行点击详情**:零件/部件/图文档走对应 `*DetailContent`(嵌套 Modal),构型项走 `ConfigurationDetailModal`,**ECR/ECO** 先试 `ecrApi.get` 再回退 `ecoApi.detail` 判定类型弹 `ECRDetailModal`/`ECODetailModal`,**压缩包附件**经 `onArchivePreview` → `ArchiveTreeModal`。
- **保存修复**:空日期发送 `null`、`handleSave` 加 `try/catch` 弹错(此前 422 被静默吞、弹窗不关)。

---

## 超出原计划的实现(原计划标注「不做」或未涵盖)

| 增项 | 说明 | 相关提交 |
|---|---|---|
| 父任务日期汇总 | 显示 + 写回 + 启动回填 | `1b92fb4` |
| 里程碑单日 + 甘特可拖里程碑 | 后端强制 + 前端菱形拖动 | `cece023` |
| **依赖自动排期** | 原计划「不做自动级联排期」,现实现前向对齐 + 级联 | `30edacd` |
| 自动排期按钮 | 刷新按钮改为 `POST /auto-schedule` | `eef59b0` |
| 甘特行序改 DFS | 与项目详情树同序 | `9a120c2` |
| 甘特左侧三列 + 缩进移编号列 + 行高对齐详情 | UI | `c9e3897` `2b44f68` |
| 无日期任务拖拽划设 / 行点击编辑 / 铺满+平移 | 交互 | `ccf6572` `4b0a7ff` `bd6e0eb` `206ce37` |
| 弹窗 ECR/ECO + 压缩包预览 + 关联详情 | 复用变更/文档详情组件 | `37e634c` `ad9440f` |
| 修复 `get_part` 缺 return(500) | parts 详情既有 bug,影响关联零件预览 | `bf32743` |
| `/deps` 返回 `is_violation`、空日期 422 修复、日期 isoformat | 修复 | `a20f343` `6e56f09` `d6b0053` |

---

## 范围边界(更新后)

- ~~自动级联排期~~ → **已实现**(`auto_schedule`,前向对齐 + 级联;手动全量按钮)。
- 仍不做:资源/产能平衡与直方图、多基线(baseline)对比、进度百分比、工时(第 3 期)。
- 当前自动排期为「前向对齐」模式:后置任务起止由前置决定(拖后置会吸附回约束);如需「仅解决违规」模式可后续调整。

---

## 验证现状

- 后端 `pytest`:项目相关测试全绿;全量 `229+ passed`,仅 1 个**与本期无关**的历史失败 `test_documents_download_attachment_blocks_nonmember`(基线提交即失败)。
- 前端 `npm run build` 通过。
- Docker 部署手测中(日期迁移、父任务汇总回填、自动排期级联、各交互均已在运行容器验证)。

> 实施任务回顾:原计划 Task 1–14(权限/模型/迁移/schema/序列化/依赖CRUD/CPM/端点/前端类型服务/工具/GanttView/接入tab/依赖区/回归)均已完成;上表为其后按需求新增的能力。
