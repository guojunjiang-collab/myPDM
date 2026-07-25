# 零部件详情「反查」Tab 设计方案

> 日期：2026-07-25
> 分支：dev
> 目标：在「零部件管理 → 零部件详情(PartDetailModal)」中新增一个 **反查(Where-Used)** Tab，
> 汇总展示当前零部件被三类对象引用的情况：父项零部件、构型项、项目任务。
>
> **前置依赖（2026-07-25 已完成）**：前置项目「构型模块版本级绑定改造」已实施并合入——
> `configuration_item_parts` 现存 `revision_id`（绑定具体零部件版本，允许同零件多版本）。
> 因此本方案构型段反查为 **版本级**（按 `revision_id` 查询），与 BOM/任务两段口径统一，
> 详情弹窗切换版本时三段结果同步随当前 `revisionId` 变化。

## 1. 背景与目标

现状：反查能力仅存在于 BOM 页(`BOMTracePanel`)——先搜索一个零部件，再反查其上级装配。
用户希望在零部件详情弹窗内直接看到"这个零部件被谁用了"，且覆盖面从单一的 BOM 上级，
扩展到 **构型项** 与 **项目任务** 两个额外维度。

详情弹窗打开时已知当前零部件的 `masterId` 与 `revisionId`，因此反查无需搜索框，直接对
当前对象反查即可。

## 2. 三类引用的关联粒度

前置的构型版本级绑定改造完成后，三个来源**均为 revision 级**，反查口径统一为「当前版本」：

| 引用来源 | 关联表 | 存储字段 | 反查口径 | 现有接口 |
|---------|--------|---------|---------|---------|
| 父项零部件 | BOM(`bom_items`) | `child_revision_id` = revision | **当前版本** | 有：`bomApi.trace('component', revisionId)` |
| 项目任务 | `project_task_links.entity_id` | **revision_id** | **当前版本** | 无反向查询，需新增 |
| 构型项 | `configuration_item_parts.revision_id` | **revision_id** | **当前版本** | 无反向查询，需新增 |

依据：
- `project_task_links`：`entity_type ∈ (part/assembly/component)`，`entity_id` 经
  `JOIN part_revisions pr ON pr.id = entity_id` 解析（见 `routers/projects.py` `_link_dict`）→ revision 级。
- `configuration_item_parts.revision_id`：FK→`part_revisions.id`，绑定具体零部件版本
  （2026-07-25 改造，见 `2026-07-25-config-part-version-binding-design.md`）→ revision 级。
  同一构型项内同一零件允许多版本（按 revision 区分），故反查按 `revision_id` 精确命中当前版本。

三段口径一致：详情弹窗切换零部件版本时，三段反查结果都随当前 `revisionId` 变化。

## 3. 范围

**做：**
- 详情弹窗新增「反查」Tab，三段堆叠布局（父项零部件 / 被构型项引用 / 被项目任务引用）。
- 新增 2 个后端反查端点（构型项、项目任务），复用 1 个已有端点（BOM 父项）。
- 行点击 → 弹出对应对象的详情弹窗（复用现有三个弹窗组件）。
- 抽取共享组件 `BomWhereUsedTree`，供新 Tab 与原 `BOMTracePanel` 复用，消除重复。

**不做（Non-goals）：**
- 不改动三类关联的写入侧逻辑（构型版本级绑定已作为独立前置项目完成）。
- 不做跨版本聚合（三段均按当前版本口径）。
- 不新增权限模型（复用现有读权限；见 §7）。
- **暂不**加入"被配置清单(Profile)引用"作为第四段。构型改造后
  `configuration_profile_items.part_revision_id` 已具备版本级反查条件，若后续需要可按同样
  模式扩展一段（`GET /parts/revisions/{revision_id}/where-used/profiles`），本轮不纳入。

## 4. 后端设计

### 4.1 端点一览

| 用途 | 方法 & 路径 | 输入 | 说明 |
|------|-----------|------|------|
| 父项（复用） | `GET /bom/trace/component/{revision_id}` | revision_id | 已有，返回多级上级装配树 |
| 构型项（新增） | `GET /parts/revisions/{revision_id}/where-used/configurations` | revision_id | 见 §4.2 |
| 项目任务（新增） | `GET /parts/revisions/{revision_id}/where-used/tasks` | revision_id | 见 §4.3 |

### 4.2 构型项反查（版本级）

查询：`configuration_item_parts` where `revision_id = :revision_id`（精确命中当前零部件版本）
→ `JOIN configuration_item_iterations it ON it.id = cip.iteration_id`
→ `JOIN configuration_item_revisions cir ON cir.id = it.revision_id`
→ `JOIN configuration_item_masters cim ON cim.id = cir.master_id`

- **口径**：只返回绑定了**当前版本**的构型项；构型绑定的是别的版本则不出现在本结果中
  （切到那个版本时才出现），与 BOM/任务一致。
- **去重**：同一构型项可能跨多个迭代引用同一零件版本；按 `构型项 revision_id` 去重，取代表迭代。
- **权限/软删**：过滤构型项 `deleted_at IS NULL`；沿用现有构型读权限。

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
> 注：因反查已按当前零部件 `revision_id` 精确命中，返回项无需再带"引用的零部件版本"
> （即当前详情版本本身）。构型项自身的 `version` 仍返回，用于列表展示与打开详情。

### 4.3 项目任务反查

查询：`project_task_links` where `entity_type IN ('part','assembly','component')` AND `entity_id = :revision_id`
→ `JOIN project_tasks t ON t.id = link.task_id`（过滤 `t.deleted_at IS NULL`）
→ `JOIN projects p ON p.id = t.project_id`

返回项直接使用 `ProjectTask` 兼容结构 + 项目信息（避免前端二次请求，`TaskEditModal` 需完整
task 对象 + `project_id`）：
```jsonc
{
  "project_id": "…",
  "project_name": "项目名称",
  "task": { /* ProjectTask 完整字段：id, name, status, assignee_id, start_date, due_date, parent_id, … */ }
}
```

### 4.4 Schema / CRUD

- `schemas_parts.py`（或就近）新增 `WhereUsedConfigItem`、`WhereUsedTask` 响应模型。
- 反查查询实现于对应 crud（构型→`crud_configuration.py`；任务→`crud_project.py`），
  路由挂在 `routers/parts.py`（保持「以零部件为主语」的 URL 语义）。

## 5. 前端设计

### 5.1 Tab 接入

`PartDetailModal.tsx` 的 `tabs` useMemo 数组新增：
```ts
{ key: 'whereused' as const, label: '反查', show: true },  // 位置：'bom' 之后
```
`activeTab` 联合类型追加 `'whereused'`。任何零部件都可能被引用，故 `show: true`。

### 5.2 内容：三段堆叠 + 懒加载

新增子组件 `PartWhereUsedTab`（`components/PartDetailModal/PartWhereUsedTab.tsx` 或同目录），
props：`{ revisionId, onOpenPart, onOpenConfig, onOpenTask }`。三段反查均以当前 `revisionId`
为输入（构型改造后不再需要 `masterId`）。

- 切到「反查」Tab 时首次挂载，三段 **并行懒加载**（各自 loading/empty/error 态）。
- 三段结构（每段：小标题 + 计数徽标 + 表格）：
  1. **父项零部件**：树形表格（层级/件号/名称/规格/版本/状态/用量）。用 `BomWhereUsedTree`（§5.3）。
  2. **被构型项引用**：平铺表格（构型项件号/名称/版本/状态/是否必需/用量）。
  3. **被项目任务引用**：平铺表格（项目/任务名/状态/负责人）。

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
| 项目任务 | 打开任务编辑弹窗 | `TaskEditModal` | `projectId` + 完整 `task` 对象（端点已返回） |

在 `PartWhereUsedTab`（或 `PartDetailModal`）内维护三个弹窗的开合 state。父项下钻沿用
`PartDetailModal` 现有底部嵌套渲染；构型/任务弹窗在本 Tab 内就地渲染。

## 6. 数据流

```
切到「反查」Tab（三段输入均为当前 revisionId）
  ├─ GET /bom/trace/component/{revisionId}                    → 父项树
  ├─ GET /parts/revisions/{revisionId}/where-used/configurations → 构型项列表
  └─ GET /parts/revisions/{revisionId}/where-used/tasks       → 任务列表
点击某行 → 打开对应详情弹窗（PartDetailModal / ConfigItemDetailModal / TaskEditModal）
切换详情版本（版本历史 Tab 切 revision）→ 三段反查均随当前 revisionId 重新拉取
```

## 7. 边界与权限

- **空态**：三段各自「暂无引用」提示；某段接口失败仅该段显示错误，不影响其他段。
- **权限**：三个反查端点均为只读查询，复用现有认证；构型/项目读权限若已有 code 级校验，
  沿用（查询不到即空列表，不额外报错）。
- **性能**：三段并行；构型/任务为单表 + 少量 JOIN，量级小，无需分页。
- **版本切换**：详情弹窗切换 revision 时，三段反查均依赖当前 `revisionId` 自动重查
  （构型改造后已统一为版本级）。

## 8. 测试

**后端：**
- 构型反查（版本级）：无引用→空；构型项绑定**当前版本**→命中；构型项绑定**同零件的其他版本**
  →**不**出现在当前版本结果（切到该版本才出现）；同构型项多迭代引用同一版本→按构型项 revision 去重；
  构型项软删→排除。
- 任务反查：无引用→空；part/assembly/component 三种 entity_type 命中；已删除任务(deleted_at)排除；
  返回 task 结构字段完整（可直接喂 TaskEditModal）。
- 越权/不存在 id → 空列表而非 500。

**前端：**
- Tab 出现且默认不加载，切入才请求。
- 三段空/有数据/错误态渲染正确。
- 三种行点击分别打开对应弹窗且入参正确。
- 详情切换版本后反查结果刷新。

## 9. 实现顺序（供后续计划参考）

1. 后端：构型反查端点 + 测试。
2. 后端：任务反查端点（返回 ProjectTask 结构）+ 测试。
3. 前端：抽取 `BomWhereUsedTree` 并重构 `BOMTracePanel`（保持原功能不回归）。
4. 前端：`PartWhereUsedTab` 三段堆叠 + 懒加载。
5. 前端：三种行点击 → 弹窗接线。
6. 联调（Docker 手测）：三类引用各造数据验证。
