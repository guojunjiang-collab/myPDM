# 项目管理模块 — 第 1 期设计(项目骨架 + WBS 任务)

> 日期: 2026-06-24
> 状态: 已确认,待编写实现计划
> 范围: 第 1 期(共规划 3 期)

## 背景与目标

myPDM(v1.5.1)围绕"物料数据"主线已很完整(零件/部件/BOM/图文档/版本/ECR-ECO/配置/库存/AI 助手),
但缺少"时间与人"维度的项目管理能力。本模块补齐这一空白。

整体规划为同一套数据骨架上的三期递进:

- **第 1 期(本文档):项目骨架 + WBS 任务管理** — 建项目、分层任务、派活、关联 PDM 对象、跟踪状态。
- **第 2 期:甘特图 / 进度** — 在已有任务上加依赖关系与时间轴视图、关键路径。
- **第 3 期:工时统计** — 在任务上记工时、出投入统计报表。

后两期复用第 1 期的同一套数据模型,本文档只详尽设计第 1 期。

## 核心模型概念

```
项目 (Project)                        ← 轻量容器:编号/名称/负责人/起止/状态/成员
  └─ 任务 (Task) — 自引用树,无限深度(parent_id 邻接表,与 BOM 树一致)
       ├─ task_type: 任务 | 里程碑 | 评审   ← 用类型字段区分,不设独立实体
       ├─ 统一字段(所有类型字段结构相同)
       ├─ 关联对象:零部件 / 构型项 / EC / 图文档(多对多,任务为中心,对象被挂入)
       └─ 子任务(递归)
```

关键决策记录:

- **不设阶段/里程碑/评审门独立实体**:里程碑、评审只是任务的 `task_type`,字段结构与普通任务相同。
- **任务是中心实体**:零部件/构型项/EC/图文档被"挂进"任务,而非反向。
- **不要进度百分比字段**:仅用状态识别进展;父任务状态由人手动设置,不从子任务自动汇总。
- **可见性 = 项目成员**:只有项目成员能看到该项目及其任务(不同于全员可见的零件/BOM)。
- **关联 ≠ 编辑**:把已存在对象挂到任务只需"能编辑任务 + 对该对象有读权限",不要求对象编辑权。
- **生产人员产出走任务附件(路 A)**:生产人员可被派任务、改自己任务状态;其产出(试制记录、
  检验报告、现场照片等)作为"任务附件"直接上传,复用现有附件系统,不需要图文档权限。
  正式"生产类图文档 + 窄权限"(路 B)留待后续期,届时可做"任务附件一键转正式图文档"。
- **第 1 期不做拖拽改层级/排序**:用 +子任务 / 上移下移 / 选择父任务实现,拖拽留待后续。

## 1. 数据模型(新增,放在 `models_project.py`)

### `projects`(项目容器)
- `id`
- `code` — 自动编号,如 `PRJ-001`
- `name` — 必填
- `owner_id` — 创建者 = 项目负责人
- `status` — 进行中 / 已完成 / 已暂停 / 已归档
- `planned_start` / `planned_end`
- `description`
- `created_at` / `updated_at` / `deleted_at`(软删除,沿用现有惯例)

### `project_members`(项目成员,决定可见性)
- `project_id` / `user_id`
- `role_in_project` — 经理 / 成员
- 约定:创建者自动成为"经理";"成员可见"靠这张表过滤

### `project_tasks`(任务,自引用树)
- `id` / `project_id` / `parent_id`(可空,无限深度)
- `code` — 如 `PRJ-001-007`
- `name`
- `task_type` — 任务 / 里程碑 / 评审
- `assignee_id` — 关联系统用户
- `status` — 未开始 / 进行中 / 已完成 / 挂起
- `priority` — 高 / 中 / 低
- `planned_start` / `planned_end` / `actual_start` / `actual_end`
- `sort_order` — 同级排序
- `description`
- `created_at` / `updated_at` / `deleted_at`

### `project_task_links`(任务关联 PDM 对象,多态多对多)
- `id` / `task_id`
- `entity_type` — part / assembly / config_item / ec / document
- `entity_id`
- 仅建引用,不改对象本身

### 任务附件
- 复用现有附件系统,`entity_type='project_task'`,无需新表、无需图文档权限。

> 存储方式:任务树用 `parent_id` 邻接表,与 BOM 树完全一致,前端可复用 `BOMTreeTable` 的展开/折叠逻辑。

## 2. 后端 API(新增 `routers/projects.py` + `crud_project.py` + `schemas_project.py`)

### 项目
- `GET /api/projects/` — 列表(只返回当前用户是成员的项目)
- `POST /api/projects/` — 创建(admin / engineer)
- `GET /api/projects/{id}` — 详情(需为成员)
- `PUT /api/projects/{id}` / `DELETE /api/projects/{id}` — 编辑/软删(项目经理或 admin)
- `GET/POST /api/projects/{id}/members` — 成员列表/新增
- `DELETE /api/projects/{id}/members/{user_id}` — 移除成员

### 任务
- `GET /api/projects/{id}/tasks` — 返回该项目整棵任务树(后端组装树形)
- `POST /api/projects/{id}/tasks` — 新建任务/子任务(传 `parent_id`)
- `PUT /api/projects/{id}/tasks/{task_id}` — 编辑
- `PATCH /api/projects/{id}/tasks/{task_id}/status` — 单独改状态端点(任务负责人即使只是成员也能调)
- `DELETE /api/projects/{id}/tasks/{task_id}` — 软删(连同子树)
- `POST /api/projects/{id}/tasks/{task_id}/move` — 改 parent_id / sort_order(上移下移/选父任务)

### 任务关联对象
- `GET /api/projects/{id}/tasks/{task_id}/links` — 关联对象列表(后端回填名称/件号)
- `POST .../links` — 新增关联(校验对象读权限即可)
- `DELETE .../links/{link_id}` — 解除关联

### 任务附件
- 直接走现有 `/api/v2/attachments/*`,`entity_type='project_task'`,无需新端点。

### 权限(`permissions/permissions.json` 新增,跑 `gen_permissions.py`)
- 角色权限:`projects:read` / `projects:create` / `projects:update` / `projects:delete`、
  `project_tasks:create` / `project_tasks:update` / `project_tasks:delete`
- 对象级策略(`policies.py` 新增):
  - `project_manager_or_admin` — 改项目 / 删任务
  - `task_assignee_or_manager` — 改任务状态(负责人可改自己任务)
  - 成员可见性过滤 — 列表与详情按 `project_members` 过滤
- 角色映射要点:
  - 创建项目:admin、engineer
  - 改状态:有编辑权者 + 该任务负责人(含成员身份的 production)
  - production:可被指派任务、更新自己任务状态、上传任务附件;不能新建图文档

## 3. 前端界面(新增 `pages/Project/`,菜单加"项目管理")

布局沿用现有构型管理 / BOM 页风格(primary-* 配色、共享 `Modal`、统一表格/工具栏)。

### ① 项目列表(模块首页)
- 列出"我参与的项目":编号/名称/负责人/状态/起止/成员数
- 工具栏:`+ 新建项目`(`can('projects:create')` 才显示)+ 搜索 + 状态筛选
- 点项目 → 进入该项目任务工作区

### ② 项目任务工作区(核心界面)
- 顶部:项目信息条(名称/状态/负责人/成员头像)+ `成员管理`、`编辑项目`
- 主体:WBS 任务树形表格(复用 `BOMTreeTable` 展开/折叠/缩进)
  - 列:任务编号 / 名称(类型图标:📋任务 🏁里程碑 🔎评审)/ 负责人 / 状态(彩色标签,可内联快速切换)/ 优先级 / 计划起止 / 关联数
  - 行操作:`+ 子任务`、`编辑`、`删除`、上移/下移
  - 工具栏:`+ 新建顶层任务`、按状态/负责人筛选、展开/折叠全部
  - 逾期视觉提示:计划完成 < 今天且未完成 → 行标红(前端计算,不存状态)

### ③ 任务编辑弹窗(复用 `Modal` + 现有 Picker)
- 基本字段表单(名称/类型/负责人/状态/优先级/计划与实际起止/描述)
- 关联对象区(4 组:零部件 / 构型项 / EC / 图文档)
  - 零部件复用 `AssemblyPartPicker`,图文档复用 `DocumentPicker`,构型项复用 `ConfigItemPicker`
  - EC 需新建轻量 `ECPicker`(现有没有,工作量小)
  - 已关联项列表 + 解除关联
- 任务附件区:复用现有附件上传/预览组件(生产人员在此传产出物)

### 状态与服务
- 新增 `stores/project.ts`(Zustand)
- 新增 `services/projectApi.ts`
- 权限按钮一律用 `can('...')` 控制显隐

## 第 1 期范围边界(明确不做)

- 甘特图、任务依赖、关键路径(第 2 期)
- 工时记录与统计(第 3 期)
- 任务进度百分比字段
- 阶段/评审门独立实体
- 任务树拖拽改层级
- 生产类正式图文档 + 窄权限(路 B);任务附件转正式图文档

## 测试要点

- 后端 pytest:项目/任务/成员/关联 CRUD;成员可见性过滤;对象级策略(经理/负责人/admin);
  自引用树组装与子树软删;改状态端点的负责人权限。
- 前端 vitest / build:任务树渲染与展开折叠;权限按钮显隐;逾期标红计算;Picker 关联交互。
```
