# 零部件详情「反查」Tab 设计方案

> 日期：2026-07-25（2026-07-26 增补构型配置段）
> 分支：dev
> 目标：在「零部件管理 → 零部件详情(PartDetailModal)」中新增一个 **反查(Where-Used)** Tab，
> 汇总展示当前零部件被四类对象引用的情况：父项零部件、构型项、项目任务、构型配置(Profile)。
>
> **前置依赖（2026-07-25 已完成）**：前置项目「构型模块版本级绑定改造」已实施并合入——
> `configuration_item_parts` 存 `revision_id`、`configuration_profile_items` 存 `part_revision_id`
> （均绑定具体零部件版本，允许同零件多版本）。因此四段反查**均为版本级**（按 `revision_id`
> 查询），口径统一，详情弹窗切换版本时四段结果同步随当前 `revisionId` 变化。

## 1. 背景与目标

现状：反查能力仅存在于 BOM 页(`BOMTracePanel`)——先搜索一个零部件，再反查其上级装配。
用户希望在零部件详情弹窗内直接看到"这个零部件被谁用了"，覆盖面从单一的 BOM 上级，扩展到
**构型项**、**项目任务**、**构型配置(Profile)** 三个额外维度——尤其能定位到零部件被用在了
哪个具体的构型配置里。

详情弹窗打开时已知当前零部件的 `revisionId`，因此反查无需搜索框，直接对当前版本反查即可。

## 2. 四类引用的关联粒度

构型版本级绑定改造完成后，四个来源**均为 revision 级**，反查口径统一为「当前版本」：

| 引用来源 | 关联表 | 存储字段 | 反查口径 | 现有接口 |
|---------|--------|---------|---------|---------|
| 父项零部件 | BOM(`bom_items`) | `child_revision_id` = revision | **当前版本** | 有：`bomApi.trace('component', revisionId)` |
| 项目任务 | `project_task_links.entity_id` | **revision_id** | **当前版本** | 无反向查询，需新增 |
| 构型项 | `configuration_item_parts.revision_id` | **revision_id** | **当前版本** | 无反向查询，需新增 |
| 构型配置(Profile) | `configuration_profile_items.part_revision_id` | **revision_id** | **当前版本** | 无反向查询，需新增 |

依据：
- `project_task_links`：`entity_type ∈ (part/assembly/component)`，`entity_id` 经
  `JOIN part_revisions pr ON pr.id = entity_id` 解析（见 `routers/projects.py` `_link_dict`）→ revision 级。
- `configuration_item_parts.revision_id`、`configuration_profile_items.part_revision_id`：均 FK/逻辑指向
  `part_revisions.id`，绑定具体零部件版本（2026-07-25 改造，见
  `2026-07-25-config-part-version-binding-design.md`）→ revision 级。同一零件允许多版本，故反查按
  `revision_id` 精确命中当前版本。

四段口径一致：详情弹窗切换零部件版本时，四段反查结果都随当前 `revisionId` 变化。

**构型项 vs 构型配置的区别**：构型项(Configuration Item)是配置的“来源模板”，构型配置(Profile)是
从构型项生成、经勾选/定版的“正式配置清单”。同一零件版本可能既被某构型项直接关联，又出现在若干
正式配置里——两段分别回答“哪个构型项模板用了它”和“它最终进了哪些配置”。

## 3. 范围

**做：**
- 详情弹窗新增「反查」Tab，**四段堆叠**布局（父项零部件 / 被构型项引用 / 被项目任务引用 / 被构型配置引用）。
- 新增 **3 个**后端反查端点（构型项、项目任务、构型配置），复用 1 个已有端点（BOM 父项）。
- 行点击 → 弹出对应对象的详情弹窗（复用现有四个弹窗组件）。
- 抽取共享组件 `BomWhereUsedTree`，供新 Tab 与原 `BOMTracePanel` 复用，消除重复。

**不做（Non-goals）：**
- 不改动四类关联的写入侧逻辑（构型版本级绑定已作为独立前置项目完成）。
- 不做跨版本聚合（四段均按当前版本口径）。
- 构型配置段基于**正式清单** `configuration_profile_items`（定版后的配置）；不含仅存于工作表
  (`configuration_working_items`) 的草稿态编辑项。
- 不新增权限模型（复用现有读权限；见 §7）。

## 4. 后端设计

### 4.1 端点一览

| 用途 | 方法 & 路径 | 输入 | 说明 |
|------|-----------|------|------|
| 父项（复用） | `GET /bom/trace/component/{revision_id}` | revision_id | 已有，返回多级上级装配树 |
| 构型项（新增） | `GET /parts/revisions/{revision_id}/where-used/configurations` | revision_id | 见 §4.2 |
| 项目任务（新增） | `GET /parts/revisions/{revision_id}/where-used/tasks` | revision_id | 见 §4.3 |
| 构型配置（新增） | `GET /parts/revisions/{revision_id}/where-used/profiles` | revision_id | 见 §4.4 |

### 4.2 构型项反查（版本级）

查询：`configuration_item_parts` where `revision_id = :revision_id`
→ `JOIN configuration_item_iterations it ON it.id = cip.iteration_id`
→ `JOIN configuration_item_revisions cir ON cir.id = it.revision_id`
→ `JOIN configuration_item_masters cim ON cim.id = cir.master_id`

- **去重**：同一构型项可能跨多个迭代引用同一零件版本；按 `构型项 revision_id`(cir.id) 去重。
- **软删**：过滤 `cim.deleted_at IS NULL AND cir.deleted_at IS NULL`。

返回项（数组）：
```jsonc
{
  "config_item_master_id": "…",
  "config_item_revision_id": "…",   // 用于点击打开 ConfigItemDetailModal
  "code": "构型项件号",
  "name": "构型项名称",
  "version": "A",                   // 构型项自身版本
  "status": "released",
  "is_required": true,
  "quantity": 2
}
```

### 4.3 项目任务反查

查询：`project_task_links` where `entity_type IN ('part','assembly','component')` AND `entity_id = :revision_id`
→ `JOIN project_tasks t ON t.id = link.task_id`（过滤 `t.deleted_at IS NULL`）
→ `JOIN projects p ON p.id = t.project_id`（过滤 `p.deleted_at IS NULL`）

返回项直接使用 `ProjectTask` 兼容结构（复用 `routers/projects.py::_task_dict`）+ 项目名（避免前端
二次请求，`TaskEditModal` 需完整 task 对象 + `project_id`）：
```jsonc
{
  "project_id": "…",
  "project_name": "项目名称",
  "task": { /* _task_dict 输出：id, project_id, parent_id, code, name, task_type,
              assignee_id, status, priority, planned_start/end, actual_start/end,
              sort_order, description */ }
}
```

### 4.4 构型配置(Profile)反查（版本级）

查询：`configuration_profile_items` where `part_revision_id = :revision_id`
→ `JOIN configuration_profiles p ON p.id = pi.profile_id`（过滤 `p.deleted_at IS NULL`）

- **去重**：同一配置可能多项引用同一零件版本；按 `profile_id` 去重。
- **口径**：仅正式清单（`configuration_profile_items`）；草稿工作表不计入。

返回项（数组）：
```jsonc
{
  "profile_id": "…",                // 用于点击打开 ProfileEditModal
  "code": "配置编号",
  "name": "配置名称",
  "status": "active",               // draft/reviewing/active/… 视 ConfigurationProfile.status
  "is_required": true,
  "quantity": 1
}
```

### 4.5 Schema / CRUD

- `schemas_parts.py`（或就近）可选新增 `WhereUsedConfigItem` / `WhereUsedTask` / `WhereUsedProfile`
  响应模型；或按项目既有习惯直接返回 dict（`routers/projects.py` `_task_dict`/`_link_dict` 即 dict 风格）。
- 反查查询实现于对应 crud（构型项/配置→`crud_configuration.py`；任务→`crud_project.py`），
  路由挂在 `routers/parts.py`（保持「以零部件为主语」的 URL 语义）。任务段格式化复用
  `_task_dict`（在端点内函数级 import，避免 router 间循环引用）。

## 5. 前端设计

### 5.1 Tab 接入

`PartDetailModal.tsx` 的 `tabs` useMemo 数组新增：
```ts
{ key: 'whereused' as const, label: '反查', show: true },  // 位置：'bom' 之后
```
`activeTab` 联合类型追加 `'whereused'`。任何零部件都可能被引用，故 `show: true`。

### 5.2 内容：四段堆叠 + 懒加载

新增子组件 `PartWhereUsedTab`（`components/PartDetailModal/PartWhereUsedTab.tsx`），
props：`{ revisionId, onOpenPart, onOpenConfig, onOpenTask, onOpenProfile }`。四段反查均以当前
`revisionId` 为输入。

- 切到「反查」Tab 时首次挂载，四段 **并行懒加载**（各自 loading/empty/error 态）。
- 四段结构（每段：小标题 + 计数徽标 + 表格）：
  1. **父项零部件**：树形表格（层级/件号/名称/规格/版本/状态/用量）。用 `BomWhereUsedTree`（§5.3）。
  2. **被构型项引用**：平铺表格（构型项件号/名称/版本/状态/是否必需/用量）。
  3. **被项目任务引用**：平铺表格（项目/任务名/状态/负责人）。
  4. **被构型配置引用**：平铺表格（配置编号/名称/状态/是否必需/用量）。

### 5.3 复用与重构

- 抽取 `BomWhereUsedTree`（放 `pages/BOM/` 或 `components/`）：吃 `revisionId` + 根节点信息，
  内部调用 `bomApi.trace`、`buildTraceTree/flattenTraceTree`（已存在），渲染结果树，
  暴露 `onViewEntity(masterId, revisionId)`。
- `BOMTracePanel` 重构为「搜索框 + `BomWhereUsedTree`」，避免树渲染逻辑重复。

### 5.4 行点击 → 详情弹窗（复用现有组件）

| 段 | 点击行为 | 复用组件 | 所需入参 |
|----|---------|---------|---------|
| 父项零部件 | 打开该上级装配详情 | `PartDetailModal`（嵌套，已有 `nestedMasterId/nestedRevisionId` 机制） | master_id, revision_id |
| 构型项 | 打开构型项详情 | `ConfigItemDetailModal` | `revisionId`（= config_item_revision_id） |
| 项目任务 | 打开任务编辑弹窗 | `TaskEditModal` | `open` + `projectId` + 完整 `task` 对象（端点已返回） |
| 构型配置 | 打开配置详情 | `ProfileEditModal` | `open` + `profileId` |

在 `PartWhereUsedTab`（或 `PartDetailModal`）内维护弹窗开合 state。父项下钻沿用
`PartDetailModal` 现有底部嵌套渲染；构型项/任务/配置弹窗在本 Tab 内就地渲染。

## 6. 数据流

```
切到「反查」Tab（四段输入均为当前 revisionId）
  ├─ GET /bom/trace/component/{revisionId}                       → 父项树
  ├─ GET /parts/revisions/{revisionId}/where-used/configurations → 构型项列表
  ├─ GET /parts/revisions/{revisionId}/where-used/tasks          → 任务列表
  └─ GET /parts/revisions/{revisionId}/where-used/profiles       → 构型配置列表
点击某行 → 打开对应详情弹窗（PartDetailModal / ConfigItemDetailModal / TaskEditModal / ProfileEditModal）
切换详情版本（版本历史 Tab 切 revision）→ 四段反查均随当前 revisionId 重新拉取
```

## 7. 边界与权限

- **空态**：四段各自「暂无引用」提示；某段接口失败仅该段显示错误，不影响其他段。
- **权限**：反查端点均为只读查询，复用现有认证（`require_permission("parts:read")`）；
  构型/项目读权限若已有 code 级校验，沿用（查询不到即空列表，不额外报错）。
- **性能**：四段并行；均为单表 + 少量 JOIN，量级小，无需分页。
- **版本切换**：详情弹窗切换 revision 时，四段反查均依赖当前 `revisionId` 自动重查。

## 8. 测试

**后端：**
- 构型项反查（版本级）：无引用→空；绑定**当前版本**→命中；绑定**同零件其他版本**→当前版本结果
  **不**含；同构型项多迭代引用→按构型项 revision 去重；构型项软删→排除。
- 任务反查：无引用→空；part/assembly/component 三种 entity_type 命中；已删除任务/项目排除；
  返回 task 结构字段完整（可直接喂 TaskEditModal）。
- 构型配置反查：无引用→空；正式清单绑定当前版本→命中；同配置多项引用→按 profile 去重；
  配置软删→排除；仅工作表(草稿)未定版→不出现。
- 越权/不存在 id → 空列表而非 500。

**前端：**
- Tab 出现且默认不加载，切入才请求。
- 四段空/有数据/错误态渲染正确。
- 四种行点击分别打开对应弹窗且入参正确。
- 详情切换版本后四段反查结果刷新。

## 9. 实现顺序（供后续计划参考）

1. 后端：构型项反查端点 + 测试。
2. 后端：项目任务反查端点（返回 ProjectTask 结构）+ 测试。
3. 后端：构型配置反查端点 + 测试。
4. 前端：抽取 `BomWhereUsedTree` 并重构 `BOMTracePanel`（保持原功能不回归）。
5. 前端：`PartWhereUsedTab` 四段堆叠 + 懒加载。
6. 前端：四种行点击 → 弹窗接线（PartDetailModal / ConfigItemDetailModal / TaskEditModal / ProfileEditModal）。
7. 联调（Docker 手测）：四类引用各造数据验证。
