# 图文档详情「反查」Tab 设计方案

> 日期：2026-07-26
> 分支：dev
> 目标：在「图文档详情(`DocumentDetailModal`)」新增一个 **反查(Where-Used)** Tab，参照已实现的
> 零部件反查，汇总展示当前图文档版本被五类对象引用的情况：构型项、零部件、项目任务、ECO、ECR。

## 1. 背景与目标

零部件详情已有「反查」Tab（四段）。图文档同样需要"这个图文档被谁用了"的能力——尤其定位到它被
挂在了哪些零部件/构型项、进了哪些变更单。图文档详情弹窗打开时已知当前 `revisionId`，反查无需
搜索框，直接对当前文档版本反查。

## 2. 关联粒度（数据定论：版本级）

各来源存的都是图文档的 **版本(revision) id**，故五段**均按当前文档 `revisionId` 反查**，口径统一。

数据佐证：抽取库中 `document_links` 的 `document_id` 值，0 条命中 `document_masters`、命中的均在
`document_revisions`（`DocumentDetailModal` 亦按 `revisionId` 打开）→ 版本级。

| 引用来源 | 关联机制 | 存储 | 反查依据 |
|---------|---------|------|---------|
| 构型项 | `configuration_item_iterations.document_links[]` | `{document_id = doc_revision_id}` | JSONB 数组含当前版本 |
| 零部件 | `part_iterations.document_links[]` 关联挂接 | `{document_id = doc_revision_id}` | JSONB 数组含当前版本 |
| 项目任务 | `project_task_links`（entity_type=`document`） | `entity_id = doc_revision_id` | 关系查询 |
| ECO | `ecos.document_links[]` | `{document_id = doc_revision_id}` | JSONB 数组含 |
| ECR | `ecrs.document_links[]` | `{document_id = doc_revision_id}` | JSONB 数组含 |

**JSONB 查询策略**：`document_links` 为 JSONB 数组，反查需判断数组是否含 `document_id == :rev`。
生产库(PostgreSQL)可用 `@>` 包含查询，但**测试库(SQLite)不支持** `@>`。为保持 SQLite 上的 TDD，
crud 采用**可移植的 Python 侧过滤**（查出候选行后在 Python 判断 `document_links` 是否含目标 id，
与现有 `routers/bom.py::get_document_references` 同一模式）。Postgres 端 JSONB GIN 索引优化留后续。

## 3. 范围

**做：**
- 图文档详情弹窗新增「反查」Tab，**五段堆叠**（构型项 / 零部件 / 项目任务 / ECO / ECR）。
- 新增 **5 个**后端反查端点，挂 `documents` 路由（前缀 `/documents`）。
- 行点击 → 弹出对应对象详情弹窗（复用现有五个弹窗组件）。
- 前端结构镜像 `PartWhereUsedTab`，复用其懒加载/空错态/行点击模式。

**不做（Non-goals）：**
- 不改动五类关联的写入侧逻辑。
- 不做跨版本聚合（五段均按当前文档版本口径）。
- ECO 与 ECR **各自独立成段**（不合并为「变更单」一段，用户确认）。
- 不新增权限模型（复用现有读权限）。
- 不引入 Postgres JSONB GIN 索引（性能优化留后续；当前用 Python 过滤，量级可接受）。

## 4. 后端设计

### 4.1 端点一览（均挂 `routers/documents.py`，前缀 `/documents`）

| 段 | 方法 & 路径 | 输入 |
|----|-----------|------|
| 构型项 | `GET /documents/revisions/{revision_id}/where-used/configurations` | revision_id |
| 零部件 | `GET /documents/revisions/{revision_id}/where-used/parts` | revision_id |
| 项目任务 | `GET /documents/revisions/{revision_id}/where-used/tasks` | revision_id |
| ECO | `GET /documents/revisions/{revision_id}/where-used/ecos` | revision_id |
| ECR | `GET /documents/revisions/{revision_id}/where-used/ecrs` | revision_id |

均复用只读认证；查询不到返回空数组（非 500）。

### 4.2 构型项反查

扫描 `configuration_item_iterations`（`document_links` 非空者），Python 过滤 `document_id == :rev`
→ `iteration → revision(cir) → master(cim)`；按构型项 `cir.id` 去重；过滤软删。返回：
```jsonc
{
  "config_item_master_id": "…",
  "config_item_revision_id": "…",   // 打开 ConfigItemDetailModal
  "code": "…", "name": "…", "version": "A", "status": "released"
}
```

### 4.3 零部件反查（新写，结构化）

**唯一路径**：图文档通过 `part_iterations.document_links` 挂接到零部件迭代（`BOMItem` 的子项
只能是零件版本，`child_revision_id` FK→`part_revisions`，**文档不作为 BOM 子项**）。

扫描 `part_iterations`（`document_links` 非空者），Python 过滤 `document_id == :rev`
→ `iteration → revision(pr) → master(pm)`；按 `零部件 master_id` 去重（同一零件多迭代命中取代表，
用其所属 revision 作为可打开的 `revision_id`）；过滤 `pm.deleted_at IS NULL`。返回：
```jsonc
{
  "master_id": "…",
  "revision_id": "…",     // 打开 PartDetailModal 需 master+revision
  "code": "…", "name": "…", "type": "part|assembly"
}
```
> 参考现有 `routers/bom.py::check_references`（document 分支即扫描 `PartIteration.document_links`），
> 但本端点返回结构化行（含可打开的 revision），与其他段风格统一。

### 4.4 项目任务反查

`project_task_links` where `entity_type='document' AND entity_id=:rev` → `JOIN project_tasks t`（软删过滤）
→ `JOIN projects p`（软删过滤）。复用 `routers/projects.py::_task_dict`。返回：
```jsonc
{ "project_id": "…", "project_name": "…", "task": { /* _task_dict 输出 */ } }
```

### 4.5 ECO / ECR 反查

分别扫描 `ecos` / `ecrs`（`document_links` 非空者），Python 过滤 `document_id == :rev`；按 id 去重。返回：
```jsonc
// ECO
{ "eco_id": "…", "eco_number": "ECO-0001", "title": "…", "status": "reviewing" }
// ECR
{ "ecr_id": "…", "ecr_number": "ECR-0001", "title": "…", "status": "draft" }
```

### 4.6 CRUD / 实现位置

- 构型项/文档相关 JSONB 扫描 → `crud_configuration.py`（构型段）、`crud_document.py` 或就近（零件段
  的 part_iterations 扫描与 BOM 子项查询）。
- 任务段 → `crud_project.py`（复用 §Task 已有的 `where_used_tasks` 思路，但 entity_type 固定 `document`）。
- ECO/ECR 段 → `crud_eco.py` / `crud_ecr.py`（或就近）。
- 端点集中在 `routers/documents.py`，各段在端点内函数级 import 对应 crud 与 `_task_dict`，
  避免 router 间循环引用。返回 dict 风格（与项目既有 `_task_dict`/`_link_dict` 一致）。

## 5. 前端设计

### 5.1 Tab 接入

`DocumentDetailModal.tsx` 的 `TabKey` 增加 `'whereused'`，`tabs` useMemo 数组新增
`{ key: 'whereused', label: '反查' }`（位置：版本历史之后或附件之后，视 UI 顺序）。

### 5.2 内容：五段堆叠 + 懒加载

新增 `DocWhereUsedTab`（`components/DocumentDetailModal/DocWhereUsedTab.tsx`），props：
`{ revisionId, onOpenConfig, onOpenPart, onOpenTask, onOpenEco, onOpenEcr }`。五段并行懒加载，
各自 loading/empty/error 态，镜像 `PartWhereUsedTab` 的 `useLazy` + `Section` 结构。

- 1) **被构型项引用**：构型项件号/名称/版本/状态。
- 2) **被零部件引用**：件号/名称/类型。
- 3) **被项目任务引用**：项目/任务/状态。
- 4) **被 ECO 引用**：ECO 编号/标题/状态。
- 5) **被 ECR 引用**：ECR 编号/标题/状态。

### 5.3 行点击 → 详情弹窗（复用现有组件）

| 段 | 复用组件 | 入参 |
|----|---------|------|
| 构型项 | `ConfigItemDetailModal` | `{ open, revisionId=config_item_revision_id, onClose }` |
| 零部件 | `PartDetailModal` | `{ masterId, revisionId }`（本 Tab 内就地渲染或走详情栈） |
| 项目任务 | `TaskEditModal` | `{ open, projectId, task, onClose }` |
| ECO | `ECODetailModal` | `{ ecoId, onClose, onRefresh }` |
| ECR | `ECRDetailModal` | `{ ecrId, onClose, onRefresh }` |

弹窗开合 state 维护在 `DocWhereUsedTab` 或 `DocumentDetailModal`。

### 5.4 API

`documentsApi` 新增 5 方法：`whereUsedConfigurations/whereUsedParts/whereUsedTasks/whereUsedEcos/
whereUsedEcrs`，均 `api.get('/documents/revisions/{revisionId}/where-used/...')`。

## 6. 数据流

```
切到「反查」Tab（五段输入均为当前 revisionId）
  ├─ GET /documents/revisions/{revisionId}/where-used/configurations → 构型项
  ├─ GET …/where-used/parts                                          → 零部件
  ├─ GET …/where-used/tasks                                          → 项目任务
  ├─ GET …/where-used/ecos                                           → ECO
  └─ GET …/where-used/ecrs                                           → ECR
点击某行 → 打开对应详情弹窗（ConfigItemDetailModal / PartDetailModal / TaskEditModal / ECODetailModal / ECRDetailModal）
切换文档版本（版本历史 Tab）→ 五段随当前 revisionId 重新拉取
```

## 7. 边界与权限

- **空态**：五段各自「暂无引用」；某段接口失败仅该段显示错误。
- **脏数据**：`document_links` 指向已删除/不存在的行 → JOIN/存在性校验后不计入。
- **权限**：只读查询复用现有认证；无权的关联对象查询不到即空，不额外报错。
- **性能**：JSONB 段用 Python 过滤（候选行数 = 有 document_links 的迭代/ECO/ECR 数，量级小）；
  如后续增长，加 Postgres GIN 索引 + `@>` 查询。
- **版本切换**：五段均依赖当前 `revisionId` 自动重查。

## 8. 测试

**后端（pytest / SQLite）：**
- 构型项：迭代 document_links 含当前版本→命中；含别的版本→不命中；多迭代→按构型项去重；软删排除。
- 零部件：零件迭代 document_links 含当前文档版本→命中；含别的版本→不命中；同一零件多迭代→按 master
  去重；返回可打开的 master+revision。
- 任务：entity_type=document 且 entity_id=当前版本→命中；已删除任务/项目→排除；task 结构完整。
- ECO/ECR：document_links 含当前版本→命中；含别的版本→不命中；按 id 去重。
- 不存在/无引用 id → 空数组非 500。

**前端：**
- Tab 出现且默认不加载，切入才请求；五段空/有数据/错误态渲染正确。
- 五种行点击分别打开对应弹窗且入参正确；切文档版本后五段刷新。

## 9. 实现顺序（供计划参考）

1. 后端：构型项反查端点 + 测试。
2. 后端：零部件反查端点（part_iterations.document_links）+ 测试。
3. 后端：任务反查端点（entity_type=document）+ 测试。
4. 后端：ECO、ECR 反查端点 + 测试。
5. 前端：`documentsApi` 5 方法。
6. 前端：`DocWhereUsedTab` 五段堆叠 + 懒加载。
7. 前端：接入 `DocumentDetailModal`（Tab + 五类点击弹窗）。
8. 联调（Docker 手测）：五类引用各造数据验证。
