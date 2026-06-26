# 项目管理模块 — 第 2/3 期设计(甘特图 + 工时统计)

> 日期: 2026-06-25
> 状态: 已确认,待编写实现计划
> 范围: 第 2 期(甘特图/进度)+ 第 3 期(工时统计)
> 前置: 第 1 期(项目骨架 + WBS 任务)已实现并增强(顶栏 Tab 汇总/详情/视图、任务树、拖拽排序、关联对象、评论)

## 背景与目标

第 1 期补齐了"项目骨架 + WBS 任务树"。任务已带 `planned_start / planned_end /
actual_start / actual_end`、`status`、`priority`、`task_type`(任务/里程碑/评审),
前端"项目视图"tab 目前是占位("甘特图等功能即将上线")。

本文档设计后两期,二者复用第 1 期同一套数据骨架:

- **第 2 期:甘特图 / 进度** — 任务依赖(FS/SS/FF/SF)、时间轴可视化、关键路径(CPM)、甘特条拖拽改期。
- **第 3 期:工时统计** — 任务上记工时、估算工时、计划 vs 实际投入报表。

两期独立可分别实现,但按期次顺序先做第 2 期。日期迁移(见下)在第 2 期完成,第 3 期不依赖甘特。

## 关键决策记录

- **日期迁移为真正 DATE 列**:把 `project_tasks` 的四个日期字段从 `String(32)` 迁为
  SQLAlchemy `Date`,从数据库层保证格式,使甘特/CPM 可靠计算。含一次性幂等数据迁移。
- **自研 SVG/HTML 甘特**:不引第三方甘特库,复用现有 `primary-*` 配色与表格风格,左 WBS 列 + 右时间轴画布。
- **四种依赖全上**:Phase 2 即支持 FS/SS/FF/SF + lag;UI 默认新建 FS,可选其余三种。
- ~~**不做自动级联排期**~~ → **已实现自动排期**:有前置依赖的任务,其计划起止自动对齐到依赖约束(FS/SS/FF/SF + lag,保留工期),并沿依赖链级联;`add_dep` 与改期后自动触发,另提供「自动排期」按钮手动全量重排。(原计划标注不做,后按需求实现。)
- **不引进度百分比**:沿用 Phase 1 决策,甘特条按 `status` 着色;关键路径用红描边区分。
- **工时无审批**:任意项目成员在自己参与的任务上自由记工时,随记随生效;改/删限本人或项目经理/admin。
- **加估算工时字段**:任务加 `estimated_hours`,报表出"计划 vs 实际 vs 偏差"。
- **工时统计放进"项目视图"tab**:视图 tab 内做子切换(甘特 / 工时统计),不新增顶栏 tab,保持顶栏简洁。

---

# 第 2 期:甘特图 / 进度

> **实现状态:已完成并部署(dev 分支)。** 实施记录见 `docs/superpowers/plans/2026-06-25-project-management-phase2-gantt.md`。
> 相对本设计的主要增量:① 父任务计划日期按子孙叶**包络自动汇总**(显示 + 写回 + 启动回填);② 里程碑**强制单日**且甘特可拖;③ **依赖自动排期**(见上,原计划不做);④ 甘特交互扩展:树 DFS 行序、左侧三列(编号缩进/名称/负责人)、行高对齐详情、点击行打开详情、无日期行拖拽划设、时间轴铺满 + 左右平移;⑤ 任务弹窗关联对象行点击详情(零件/部件/图文档/构型项/ECR/ECO)+ 压缩包预览。

## 1. 数据模型

### 1.1 `project_tasks` 日期列迁移(String(32) → Date)

四列 `planned_start / planned_end / actual_start / actual_end` 改为 `Column(Date, nullable=True)`。

**迁移策略(幂等,启动时执行)**:在 `main.py` 启动迁移块新增一个 `_migrate_task_dates()`:
- 检测列类型;若仍是字符型(varchar),逐行读取,用 `datetime.strptime(v, "%Y-%m-%d").date()`
  解析,无法解析或空串置 `NULL`,再 `ALTER COLUMN ... TYPE date`(Postgres)。
- SQLite(测试库)直接建为 `Date`,无迁移分支(测试库每次新建)。
- 迁移失败不阻断启动:记录告警,保留原值为 NULL,人工排查。

> 项目管理尚未合并入生产主干,现存仅 dev/测试数据,迁移风险可控;迁移脚本仍按幂等+容错编写。

### 1.2 新表 `project_task_deps`(任务依赖)

| 列 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `project_id` | 所属项目(冗余,便于按项目批量查/校验) |
| `predecessor_id` | 前置任务 → `project_tasks.id` |
| `successor_id` | 后置任务 → `project_tasks.id` |
| `dep_type` | `FS`(完成-开始,默认)/ `SS`(开始-开始)/ `FF`(完成-完成)/ `SF`(开始-完成) |
| `lag_days` | 滞后/提前天数,默认 0,可负 |
| `created_at` | |

约束与校验:
- 唯一约束 `(predecessor_id, successor_id)`(同一对任务只允许一条依赖)。
- 禁止自环(`predecessor_id == successor_id` → 400)。
- 创建前做 **DAG 成环校验**:若加入该边会在依赖图中形成环 → 400。
- 删除任务(软删)时连带删除其相关依赖行(硬删依赖,依赖不软删)。

### 1.3 甘特着色与进度

不新增进度百分比字段。任务条颜色映射 `status`:未开始(灰)/ 进行中(蓝/primary)/
已完成(绿)/ 挂起(黄)。逾期(`planned_end < 今天` 且未完成)= 红色边或红条。
关键路径任务额外加红色描边。里程碑(`task_type=里程碑`)渲染为菱形而非条。

## 2. 后端 API

### 2.1 依赖管理(`routers/projects.py` + `crud_project.py`)
- `GET  /api/projects/{id}/deps` — 列出项目所有依赖(成员可见)。
- `POST /api/projects/{id}/deps` — 新建依赖(校验 DAG;权限 `project.task:depend` + object policy `project_manager_or_admin`)。
- `DELETE /api/projects/{id}/deps/{dep_id}` — 删除依赖(同上权限)。

请求体 `DepCreate`: `predecessor_id` / `successor_id` / `dep_type`(默认 FS)/ `lag_days`(默认 0)。

### 2.2 甘特数据端点
- `GET /api/projects/{id}/gantt` — 一次性返回甘特渲染所需全部数据(成员可见):
  - `tasks`: 扁平任务列表,每项含 `id / parent_id / code / name / task_type / status /
    assignee_name / planned_start / planned_end / duration_days / is_critical / is_overdue / sort_order / depth`
  - `deps`: `[{id, predecessor_id, successor_id, dep_type, lag_days, is_violation}]`
  - `range`: `{min_date, max_date}`(用于时间轴范围;无日期任务不参与范围)

### 2.3 CPM(关键路径)计算
- 在 `crud_project.py` 新增 `compute_schedule(db, project_id) -> dict`:
  - 仅对**叶任务**(无子任务)且有完整 `planned_start/planned_end` 的任务参与;工期 `duration = (end - start).days + 1`。
  - 前向遍历(拓扑序)算 ES/EF,后向遍历算 LS/LF,`slack = LS - ES`。
  - 依赖约束按类型:
    - FS: `succ.ES ≥ pred.EF + lag`
    - SS: `succ.ES ≥ pred.ES + lag`
    - FF: `succ.EF ≥ pred.EF + lag`
    - SF: `succ.EF ≥ pred.ES + lag`
  - `slack == 0` → `is_critical=True`。
  - 依赖违规检测:实际计划日期违反上述约束 → 该依赖 `is_violation=True`(供前端红色提示)。
  - 缺日期或成环导致无法计算时:降级——返回任务但 `is_critical=False`,不抛错。

### 2.4 改期
- 复用现有 `PUT /api/projects/{id}/tasks/{task_id}`,写 `planned_start/planned_end`。
  前端拖拽释放后调用此端点,再重新 `GET /gantt` 刷新(或本地乐观更新 + 重算)。

### 2.5 权限(`permissions.json` 新增,跑 `gen_permissions.py`)
- `project.task:depend` — `{ roles: [admin, engineer, production], object_policy: project_manager_or_admin }`(管依赖)。
- 读甘特复用 `project:read` + CRUD 层成员过滤。

## 3. 前端(填充"项目视图" tab)

"项目视图" tab 内顶部加子切换:**甘特图 | 工时统计**(工时统计见第 3 期)。

### 3.1 `GanttView` 组件(自研 SVG)
- 布局:左侧固定列(任务编号+名称,树形缩进,与详情 tab 一致)+ 右侧可横向滚动时间轴画布。
- 时间轴:**日 / 周 / 月** 三档缩放;表头日期刻度;`today` 竖线高亮。
- 任务条:
  - 汇总任务(有子任务):细括号条(起止 = 子任务包络),不可拖。
  - 叶任务:实心圆角条,按 `status` 着色;逾期红;关键路径红描边。
  - 里程碑:菱形;评审:可用不同图标/描边区分。
- 依赖连线:SVG 折线,按类型连不同端点:
  - FS: 前置右端 → 后置左端;SS: 前置左端 → 后置左端;
  - FF: 前置右端 → 后置右端;SF: 前置左端 → 后置右端。
  - `is_violation=True` 的连线红色加粗。
- 交互:
  - 拖条体 = 平移(改 `planned_start/planned_end`,工期不变)。
  - 拖左右边缘 = resize(改单边日期,改工期)。
  - 释放 → `PUT task` 回写 → 刷新甘特(含重算 CPM)。
  - **不做**自动级联推移后置任务(仅刷新后显示新的违规提示)。
- 新建/删除依赖:在甘特上从一个任务条拖到另一个任务条创建依赖(默认 FS),或在任务编辑弹窗的"依赖"区维护(选前置/后置 + 类型 + lag);右键/列表删除。

### 3.2 类型与服务
- `types/project.ts` 增 `TaskDependency`、`GanttTask`、`GanttData` 等类型。
- `services/projectApi.ts` 增 `getGantt / listDeps / addDep / removeDep`。
- 依赖编辑也可放入 `TaskEditModal` 新增"依赖"区(前置/后置 + 类型 + lag)。

## 4. 第 2 期范围边界(不做)
- ~~自动级联排期~~ → **已实现**(`auto_schedule`,前向对齐 + 级联;另有手动「自动排期」按钮)。当前为「前向对齐」模式:后置任务起止由前置决定。
- 资源/产能平衡、资源直方图。
- 多基线(baseline)对比、计划快照。
- 进度百分比。

---

# 第 3 期:工时统计

## 1. 数据模型

### 1.1 `project_tasks` 增列
- `estimated_hours` — `Column(Numeric(8, 2), nullable=True)`,估算工时(由"通用列对账"自动补列,无需手写迁移)。

### 1.2 新表 `project_task_worklogs`(工时记录)

| 列 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `project_id` | 所属项目(冗余,便于按项目聚合) |
| `task_id` | 所属任务 → `project_tasks.id` |
| `user_id` | 记录人 → `users.id` |
| `work_date` | `Date`,工时发生日期 |
| `hours` | `Numeric(6, 2)`,工时数(小时) |
| `description` | `Text`,可空,工作说明 |
| `created_at / updated_at / deleted_at` | 软删 |

## 2. 后端 API

### 2.1 工时记录 CRUD
- `GET  /api/projects/{id}/tasks/{task_id}/worklogs` — 该任务工时明细(成员可见;含记录人姓名)。
- `POST /api/projects/{id}/tasks/{task_id}/worklogs` — 记一笔(`work_date / hours / description`;权限 `project.task:worklog`,成员即可,记录人 = 当前用户)。
- `PUT  /api/projects/{id}/worklogs/{worklog_id}` — 改(限本人或项目经理/admin)。
- `DELETE /api/projects/{id}/worklogs/{worklog_id}` — 软删(限本人或项目经理/admin)。

### 2.2 估算工时
- 复用 `PUT task`,新增可写字段 `estimated_hours`。

### 2.3 工时统计报表
- `GET /api/projects/{id}/worklog-stats?group_by=user|task|date&date_from=&date_to=`
  - `group_by=user`: 每人合计工时(+ 占比)。
  - `group_by=task`: 每任务合计实际工时,并带该任务 `estimated_hours` 与偏差(实际-估算)。
  - `group_by=date`: 按日期/周汇总工时(投入趋势)。
  - 可选时间窗 `date_from/date_to` 过滤。
  - 顶层附 `totals`: 项目实际总工时、估算总工时、偏差。
  - 权限 `project.worklog:read`(成员可见本项目报表)。

### 2.4 权限(`permissions.json` 新增)
- `project.task:worklog` — `[admin, engineer, production]`(成员记/改本人工时;CRUD 层做成员校验)。
- `project.worklog:read` — `[admin, engineer, production, guest]`(成员看本项目报表,CRUD 层成员过滤)。

## 3. 前端

### 3.1 任务编辑弹窗"工时"区(`TaskEditModal`)
- 新增"工时"区:
  - 任务"估算工时"输入(与基本字段一起保存)。
  - 工时明细列表(日期 / 记录人 / 小时 / 说明),本人行可编辑/删除;经理可删他人。
  - "记一笔":日期(默认今天)/ 小时 / 说明。
  - 顶部汇总:实际累计 / 估算 / 偏差。

### 3.2 "项目视图" tab 内"工时统计"子视图
- 子切换:甘特图 | **工时统计**。
- 三种视角(切换):
  - 按人:成员工时排行 + 占比。
  - 按任务:任务树 / 列表的实际 vs 估算 vs 偏差(偏差条形)。
  - 按时段:日/周投入趋势。
- 时间窗筛选;**导出 Excel**(复用现有导出工具,实现计划中先核实现有导出封装)。

### 3.3 类型与服务
- `types/project.ts` 增 `Worklog`、`WorklogStats` 等类型;`ProjectTask` 增 `estimated_hours`。
- `services/projectApi.ts` 增 `listWorklogs / addWorklog / updateWorklog / deleteWorklog / getWorklogStats`。

## 4. 第 3 期范围边界(不做)
- 工时审批/工作流。
- 计时器(开始/停止打点);仅手工记录。
- 跨项目工时汇总、人力成本(费率×工时)报表。
- 与甘特进度自动联动(实际工时不自动改任务状态/日期)。

---

# 测试要点

**第 2 期(后端 pytest)**
- 日期迁移:字符串日期解析为 Date;非法/空值置 NULL;幂等(重复跑无副作用)。
- 依赖 CRUD:增删列;唯一约束;自环拒绝;DAG 成环拒绝;删任务连带删依赖。
- CPM:线性链关键路径;并行分支 slack 计算;四种依赖类型约束;缺日期降级不抛错;依赖违规标记。
- 甘特端点:扁平任务 + 依赖边 + 范围;成员可见性。
- 权限:`project.task:depend` 经理/admin 可、其他成员不可。

**第 2 期(前端 vitest/build)**
- 甘特条按 status 着色、逾期红、关键路径描边、里程碑菱形。
- 时间轴缩放(日/周/月)、today 线。
- 依赖连线四类端点;违规红线。
- 拖拽平移/resize 触发 PUT 与刷新。

**第 3 期(后端 pytest)**
- 工时 CRUD:记录人=当前用户;改/删限本人或经理;软删。
- 估算工时写入 task。
- 报表聚合:按人/任务/日期合计;偏差(实际-估算);时间窗过滤;totals。
- 权限:成员可记/可读本项目;非成员 403。

**第 3 期(前端 vitest/build)**
- 任务弹窗工时区:记一笔/编辑/删除;汇总与偏差。
- 工时统计三视角渲染;时间窗筛选;导出 Excel。

---

# 交付结构

- 本设计文档覆盖第 2、3 两期。
- 写**两份实现计划**:
  1. `docs/superpowers/plans/2026-06-25-project-management-phase2-gantt.md`(先做)
  2. `docs/superpowers/plans/2026-06-25-project-management-phase3-worklog.md`(后做)
- 各计划走 TDD + 分任务 commit,沿用第 1 期计划的写法与既有领域模块模式
  (`models_project.py` / `schemas_project.py` / `crud_project.py` / `routers/projects.py`;
  权限单一事实源 + `gen_permissions.py` + `policies.py`;前端 `pages/Project/` + `services/projectApi.ts`)。
