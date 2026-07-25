# 构型项零部件「版本级绑定」改造设计方案

> 日期：2026-07-25
> 分支：dev
> 目标：让构型项(Configuration Item)关联的零部件从当前的 **master 级**(整零部件、版本临时取最新)
> 改造为 **版本级绑定**(绑定到具体 revision，锁定基线)。
> 本项目是「零部件详情反查 Tab」的前置依赖——完成后反查的构型段将由 master 级升级为版本级。

## 1. 背景

构型模块用于锁定产品配置基线。现状缺陷：构型项关联零部件时，数据库
(`configuration_item_parts`)只存 `part_id`(= PartMaster.id)，**不记录版本**。界面显示的"版本"
是查询时临时取该零件的最新 revision（`order_by(created_at desc).first()`），并非锁定值——
零件升版后，构型显示的版本会跟着变，违背"配置基线锁定"的业务语义。

实测佐证（构型项 `CI_GD40-24200-000`）：关联 `part_id = 7d94eb98…` 命中 `part_masters`
(GD40-24200-000/电池5Ah)，在 `part_revisions` 无此 id → 确为 master 级。

前端 `AssemblyPartPicker` 已按 `show_all_versions: true` 把每个版本列为独立候选行
（`child_id` = revision_id），即**选版本的能力已存在**；但构型添加处理
(`ConfigItemDetailModal` 第 457–466 行)却 `getRevision → 只存 master_id`，把选中的版本丢弃。
改造核心即：**把已选中的 revision 存下来**。

## 2. 已确认的设计决策

| 项 | 决策 |
|----|------|
| 绑定语义 | **固定版本**：`revision_id` 指向具体版本，零件升版后构型不自动跟新 |
| 添加时选版本 | 复用现有 `AssemblyPartPicker`（已能按版本选，`child_id`=revision），添加时直接存该 revision |
| 存量数据迁移 | 回填 `revision_id` = 该 master **当前最新版本**（与现显示一致，无感切换） |
| 同一零件多版本 | **允许**：一个构型项内同一零件可绑定多个不同版本，按 `revision_id` 去重（同零件同版本才算重复） |

## 3. 范围

**做：**
- `configuration_item_parts` 加 `revision_id` 列 + 迁移回填。
- 添加/改版本时持久化 `revision_id`；显示读绑定版本。
- 下游（配置清单工作项、实体解析）改用绑定版本解析。
- 前端去重口径由 master 改为 revision。

**不做（Non-goals）：**
- 不引入"跟随最新"浮动语义（本次为固定版本）。
- 不改动构型项本身的三层(master/revision/iteration)模型。
- 不改 BOM / 项目任务模块（它们已是 revision 级）。

## 4. 数据模型与迁移

### 4.1 Schema

`ConfigurationItemPart`（`models_configuration.py`）新增：
```python
revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id"), nullable=True)
```
- 列级 `nullable=True`（迁移安全、兼容历史）；业务上新增行始终写入。
- **保留 `part_id`(master)**：用于按零件分组、`part_detail` 主数据(code/name)取用、以及跨版本聚合场景。
- 去重不再依赖唯一约束（现表本就无 part_id 唯一约束，见 §4.3）。

### 4.2 迁移（新增 `migrations_configuration.py`，挂 `main.py` 启动幂等迁移）

```sql
ALTER TABLE configuration_item_parts ADD COLUMN IF NOT EXISTS revision_id UUID;
-- 回填：每行取该 master 的最新 revision（未软删）
UPDATE configuration_item_parts cip
SET revision_id = (
  SELECT pr.id FROM part_revisions pr
  WHERE pr.master_id = cip.part_id AND pr.deleted_at IS NULL
  ORDER BY pr.created_at DESC LIMIT 1
)
WHERE cip.revision_id IS NULL;
-- 索引（反查/查询用）
CREATE INDEX IF NOT EXISTS ix_cip_revision_id ON configuration_item_parts(revision_id);
```
- 幂等：`ADD COLUMN IF NOT EXISTS` + `UPDATE ... WHERE revision_id IS NULL`。
- FK 约束按项目既有风格（多数为逻辑外键，不强加 DB FK 亦可）；索引必加。
- 回填后个别 master 无任何 revision 的行 `revision_id` 仍为 NULL → 视为脏数据，日志告警、不阻断。

### 4.3 约束现状

`configuration_item_parts` 现有约束仅 PK + `fk_cip_iteration`（无 `part_id` 唯一约束），
故"同零件多版本"无需改约束。

## 5. 后端

### 5.1 Schema（`schemas_configuration.py`）

- `ConfigPartCreate`：新增 `revision_id: uuid.UUID`（必填）。`part_id` 可保留（前端传）或由后端按 revision 反推 master。
- `ConfigPartUpdate`：新增 `revision_id: Optional[uuid.UUID]`（用于改版本）。
- `ConfigPartResponse` / `part_detail`：`version/status/revision_id` **改为按存储的 `revision_id` 解析**，不再取最新。

### 5.2 CRUD / Router

- `add_config_parts` / `add_part_to_iteration`：写入 `revision_id`；若前端只传 revision，则后端 `getRevision.master_id` 反推 `part_id` 落库。
- `update_config_part`：支持更新 `revision_id`。
- 构型项详情组装（`routers/configuration.py` 第 178–216 段）：`part_detail` 用
  `PartRevision.id == cip.revision_id` 直接取该版本；`PartMaster` 仍供 code/name。
- **下游（配置清单，本轮一并做）**：
  - `configuration_working_items` / `configuration_profile_items` 各加 `part_revision_id UUID`
    列（清单项快照绑定版本；`config_item` 行留空）。迁移回填 = 该 `item_id`(master) 最新版本。
  - 生成 `_generate_checklist`（`crud_configuration.py:925`）：working item 写入
    `part_revision_id = p.revision_id`。
  - 定版拷贝 working→profile（`crud_configuration.py:1101`）：`part_revision_id` 一并复制。
  - 清单项格式化 `_format_profile_item`（`configuration.py:1559`）：`item_version`/`item_status`
    改为**按 `part_revision_id` 解析**（现状从 `PartMaster` 取 `.version` 恒为空，因 master 无版本）。
    构建 revision_map（`PartRevision.id.in_(revision_ids)`）供解析。
  - 前端 `ProfileEditModal.tsx:516/597` 已渲染 `item_version`，无需改，本次起能显示锁定版本。

## 6. 前端

### 6.1 添加流（`ConfigItemDetailModal.tsx` / `ConfigurationCreateModal.tsx`）

- **不再** `getRevision → 只存 masterId`；直接以 `it.child_id`(revision) 作为绑定版本提交：
  `{ part_type, part_id: master, revision_id: it.child_id, is_required, quantity }`
  （master 可由 `getRevision` 补，或后端反推）。
- 去重口径由 master 改为 **revision**：
  - `ConfigItemDetailModal:452` `existingChildIds` 由 `p.part_id` → `p.revision_id`。
  - `:456/:465` 的 `parts.some(p => p.part_id === …)` → 按 `revision_id` 判重。
  - `ConfigurationCreateModal:749` 去重键 `${part_type}_${part_id}` → 含 `revision_id`。

### 6.2 改版本

- `VersionSelectModal` 的 `onSelect(versionId)`：由"仅改本地 `part_detail`"改为
  **调用 `configurationApi.updateConfigPart(..., { revision_id: versionId })` 持久化**，成功后刷新。

### 6.3 显示

- 构型项关联零部件列表的"版本/状态"以**存储的 revision** 为准（后端已按绑定版本返回）。
- 允许列表中同一零件出现多行（不同版本），行 key 用 `cip.id`（已是）。

## 7. 边界与兼容

- **历史数据**：迁移回填后等价于"锁定到当时最新版"，界面显示与改造前一致，无感。
- **脏数据**：master 无任何 revision 的关联行 `revision_id` 为空 → 前端显示"版本缺失"提示，不崩。
- **兼容**：`part_id` 保留，读取 master 主数据的旧代码不受影响。
- **反查联动**：本改造完成后，`part-detail-where-used` 方案 §4.2 构型反查改为
  `configuration_item_parts.revision_id = :revision_id` 查询（版本级）。

## 8. 测试

**后端：**
- 迁移幂等：重复执行不报错；回填正确取最新未软删 revision；无 revision 的 master 行留空且不报错。
- 添加：绑定指定版本落库；同零件不同版本可共存；同零件同版本判重。
- 改版本：`update_config_part` 改 `revision_id` 生效，详情返回新版本。
- 详情/清单：`part_detail` 与配置清单按绑定版本解析（零件升版后仍显示锁定版本，不跟新）。

**前端：**
- 添加子项选中某版本 → 列表显示该版本；再选同零件另一版本 → 新增一行。
- 改版本弹窗选新版 → 持久化并刷新。
- 历史构型项打开：版本显示与改造前一致。

## 9. 实现顺序（供计划参考）

1. 后端：Schema 加列 + `migrations_configuration.py` 回填 + 挂载 main.py。
2. 后端：`schemas`/`crud`/`router` 写入与解析改版本级 + 测试。
3. 后端：下游配置清单/实体解析按绑定版本。
4. 前端：添加流存 revision + 去重改 revision。
5. 前端：`VersionSelectModal` onSelect 持久化。
6. 联调（Docker 手测）：新增/改版/升版不跟新/多版本共存/历史兼容。
7. （后续项目）实施「零部件详情反查 Tab」，构型段接版本级查询。
