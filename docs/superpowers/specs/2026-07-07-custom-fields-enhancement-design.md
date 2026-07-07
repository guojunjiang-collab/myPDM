# 自定义字段增强 — 统一存储 & 构型项支持

> 状态：设计完成 | 日期：2026-07-07

---

## 一、背景与动机

当前自定义字段系统存在以下问题：

1. **双轨存储**：零部件自定义字段同时使用关系表（`custom_field_values`）和 `PartIteration.custom_fields` JSONB 内嵌列，数据分散，维护成本高
2. **构型项不支持**：`ConfigurationItem`（构型项）完全没有自定义字段能力
3. **multiselect 前端缺失**：后端定义了 `multiselect` 类型，但前端从未实现对应的表单控件
4. **entity_type 不一致**：`migrations_components.py` 已将 `part`/`assembly` 合并为 `component`，但自定义字段路由仍硬编码 `part`/`document`

## 二、目标

| 目标 | 描述 |
|------|------|
| 统一存储 | 全部实体走 `custom_field_values` 关系表，废弃 `PartIteration.custom_fields` JSONB 列 |
| 新增构型项 | `ConfigurationItem` 支持自定义字段的读写与展示 |
| multiselect 前端 | 实现多选字段的编辑态（checkbox 组）和只读态（逗号拼接/tag） |
| entity_type 一致 | 零部件继续保持 `part`，新增 `configuration_item` |

## 三、架构设计

### 3.1 存储方案

统一使用关系表，新增 `iteration_id` 支持签出/签入场景：

```
custom_field_definitions
    ├── applies_to: [part, document, configuration_item]

custom_field_values（新增 iteration_id）
    ├── entity_type = 'part'               → iteration_id = PartIteration.id
    ├── entity_type = 'document'            → iteration_id = NULL
    └── entity_type = 'configuration_item'  → iteration_id = NULL
```

### 3.2 实体类型

| entity_type | 对应实体 | 状态 |
|-------------|---------|------|
| `part` | 零部件（Component） | 已有，统一存储 |
| `document` | 图文档（Document） | 已有，不变 |
| `configuration_item` | 构型项（ConfigurationItem） | **新增** |

## 四、后端变更

### 4.1 数据库变更

**`custom_field_values` 表新增列**：
```sql
ALTER TABLE custom_field_values ADD COLUMN iteration_id UUID;
CREATE INDEX idx_cf_val_iter ON custom_field_values(iteration_id);
```

**`part_iterations` 表删列**（迁移完成后）：
```sql
ALTER TABLE part_iterations DROP COLUMN custom_fields;
```

### 4.2 路由 white-list 扩展

**文件**：`backend/app/routers/custom_fields.py`

`entity_type` 校验从 `('part', 'document')` 扩展为 `('part', 'document', 'configuration_item')`，影响以下端点：
- `GET /api/custom-fields/values/{entity_type}/{entity_id}`
- `PUT /api/custom-fields/values/{entity_type}/{entity_id}`
- `GET /api/custom-fields/values/batch?type=&ids=`

### 4.3 CRUD 变更

**`crud_parts.py` — checkout_part()**：
签出时调用新函数复制字段值到新迭代：
```python
_copy_iteration_custom_fields(db, source_iter.id, new_iter.id)
```

**`crud_parts.py` — _copy_iteration_data()**：
移除 `new_iter.custom_fields = source_iter.custom_fields` 行

**新增 `crud.py` — `_copy_iteration_custom_fields(db, source_iter_id, target_iter_id)`**：
```python
def _copy_iteration_custom_fields(db: Session, source_iter_id: UUID, target_iter_id: UUID):
    """复制迭代的自定义字段值到目标迭代"""
    source_values = db.query(CustomFieldValue).filter(
        CustomFieldValue.iteration_id == source_iter_id
    ).all()
    for sv in source_values:
        new_val = CustomFieldValue(
            field_id=sv.field_id,
            entity_type=sv.entity_type,
            entity_id=sv.entity_id,
            iteration_id=target_iter_id,
            value_text=sv.value_text,
            value_number=sv.value_number,
            value_json=sv.value_json,
        )
        db.add(new_val)
    db.flush()
```

### 4.4 签出/签入行为

| 操作 | 自定义字段行为 |
|------|-------------|
| 签出 (checkout) | 创建新迭代 → 复制上一迭代的 custom_field_values → iteration_id 指向新迭代 |
| 检入 (checkin) | 无需额外操作，字段值已绑定到当前迭代 |
| 撤销签出 (undocheckout) | 删除当前迭代 → custom_field_values 随迭代级联删除（iteration_id 外键需设置 ON DELETE CASCADE） |
| 强制签入 (force checkin) | 无需额外操作 |

### 4.5 级联操作

级联签出/撤销签出/签入的子零件同样适用上述规则——各自迭代的字段值随迭代复制或删除。

### 4.6 权限

无新增权限项。构型项自定义字段值读写沿用现有权限：
- `custom_field.value:read` — admin, engineer, production, guest
- `custom_field.value:write` — admin, engineer

## 五、数据迁移

### 5.1 迁移步骤

1. **新增列**：`ALTER TABLE custom_field_values ADD COLUMN iteration_id UUID`
2. **数据迁移**：遍历 `part_iterations` 中 `custom_fields IS NOT NULL AND custom_fields != '{}'` 的记录
3. 对每条 JSONB 数据的每个 key-value：
   - 查找 `custom_field_definitions.field_key = key` 的定义
   - 匹配成功 → 插入 `custom_field_values`（entity_type='part', entity_id=revision_id, iteration_id=该迭代ID）
   - 匹配失败 → 记录警告日志，跳过
4. **验证**：对比迁移前后的记录数，抽样检查数据正确性
5. **删列**：`ALTER TABLE part_iterations DROP COLUMN custom_fields`
6. **清理**：移除 `models_parts.py` 中 `PartIteration.custom_fields` 字段定义

### 5.2 回滚方案

保留迁移前的数据库备份（`pg_dump`），如迁移异常可回滚恢复。

## 六、前端变更

### 6.1 构型项自定义字段

**编辑态**（`ConfigurationCreateModal.tsx`）：
- 加载 `applies_to` 包含 `configuration_item` 的字段定义
- 在基本信息表单下方渲染自定义字段表单控件
- 保存时调用 `customFieldsApi.setValues('configuration_item', itemId, values)`

**只读态**（`ConfigurationDetailModal.tsx`）：
- 加载字段值，以 `PartDetailContent`/`AssemblyDetailContent` 同款 `grid-cols-4` 卡片布局展示

**列表搜索**（`ConfigurationList.tsx`）：
- 搜索下拉框增加 `cf_{def.id}` 自定义字段搜索选项
- 实现 `cf_` 前缀过滤逻辑（当前仅有 UI 选项，无实际过滤代码）

### 6.2 零部件自定义字段统一

**`PartDetailModal.tsx`**（旧详情弹窗）：
- 移除 `PartIteration.custom_fields` JSONB 读取逻辑
- 改为 `customFieldsApi.getValues('part', revisionId)` + 迭代过滤

**`EntityEditModal.tsx`**（编辑弹窗）：
- `cfType` 保持 `part`，不变

**API 调用统一**：
- 所有零部件的自定义字段读写统一通过 `/api/custom-fields/values/part/{entityId}`

### 6.3 multiselect 前端实现

| 场景 | 渲染方式 |
|------|---------|
| 编辑态 | 垂直排列的 `checkbox` 组，每个选项一个 checkbox |
| 只读态 | 选中值以逗号分隔文本展示；若值超过2个，多余项用 `+N` 折叠 |
| API 序列化 | 选中值数组 → `value_json` 列（JSONB，已有支持） |
| 控件复用 | 提取为 `CustomFieldInput.tsx` 组件，供所有页面共用 |

### 6.4 字段管理页面

**`Settings.tsx` 自定义字段标签页**：
- `ENTITY_TYPES` 常量增加 `{ value: 'configuration_item', label: '构型项' }`
- `FIELD_TYPES` 常量增加 `{ value: 'multiselect', label: '多选' }`
- 导入导出逻辑兼容 `configuration_item`

### 6.5 前端权限

无需变更，现有权限常量已覆盖 `custom_field.value:write`。

## 七、文件变更清单

### 后端

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `backend/app/models.py` | 修改 | `CustomFieldValue` 新增 `iteration_id` 列 |
| `backend/app/models_parts.py` | 修改 | 移除 `PartIteration.custom_fields` |
| `backend/app/schemas.py` | 修改 | 值 Schema 新增 `iteration_id` 字段 |
| `backend/app/schemas_parts.py` | 修改 | 移除 `PartIterationResponse.custom_fields` |
| `backend/app/crud.py` | 修改+新增 | `get_custom_field_values` 支持 iteration_id 过滤；新增 `_copy_iteration_custom_fields` |
| `backend/app/crud_parts.py` | 修改 | checkout 调用复制函数；移除 JSONB 相关逻辑 |
| `backend/app/routers/custom_fields.py` | 修改 | entity_type 白名单扩展 |
| `backend/app/routers/parts.py` | 修改 | 移除迭代更新端点中的 `custom_fields` 处理 |
| `initdb/migrations/` | 新增 | `007_custom_fields_unify.sql` 迁移脚本 |

### 前端

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `frontend/src/types/index.ts` | 修改 | `CustomFieldValue` 新增 `iteration_id` |
| `frontend/src/pages/Settings.tsx` | 修改 | ENTITY_TYPES 加 `configuration_item`，FIELD_TYPES 加 `multiselect` |
| `frontend/src/components/PartDetailModal.tsx` | 修改 | 改用关系表 API，不再读 JSONB |
| `frontend/src/components/Configuration/ConfigurationCreateModal.tsx` | 修改 | 新增自定义字段编辑区 |
| `frontend/src/components/Configuration/ConfigurationDetailModal.tsx` | 修改 | 新增自定义字段只读展示 |
| `frontend/src/components/Configuration/ConfigurationList.tsx` | 修改 | 实现 `cf_` 搜索过滤 |
| `frontend/src/pages/Documents.tsx` | 修改 | multiselect 控件适配 |
| `frontend/src/components/EntityEditModal.tsx` | 修改 | multiselect 控件适配 |
| `frontend/src/components/CustomFieldInput.tsx` | **新增** | 统一自定义字段输入控件（text/number/select/multiselect） |
| `frontend/src/services/importExport.ts` | 修改 | 导入导出兼容 `configuration_item` |

## 八、测试要点

### 后端

- [ ] 构型项创建/更新时自定义字段值正常存储和读取
- [ ] 零部件签出后新迭代的自定义字段值与上一迭代一致
- [ ] 零部件撤销签出后自定义字段值回退到上一迭代
- [ ] entity_type 白名单仅允许 part/document/configuration_item
- [ ] 迁移脚本正确转换 JSONB 数据，无数据丢失
- [ ] 图文档自定义字段读写不受影响（回归）

### 前端

- [ ] 构型项编辑弹窗能正常渲染和保存自定义字段
- [ ] 构型项详情弹窗能正常展示自定义字段值
- [ ] 构型项列表可按自定义字段搜索
- [ ] multiselect 编辑态 checkbox 交互正常
- [ ] multiselect 只读态展示正确（含 +N 折叠）
- [ ] PartDetailModal 签出编辑自定义字段后保存正确
- [ ] 图文档页面自定义字段功能不受影响（回归）

## 九、风险与注意事项

| 风险 | 缓解措施 |
|------|---------|
| JSONB 迁移数据量大 | 分批迁移，先 dry-run 验证。列出无法匹配 field_key 的记录 |
| 迁移后 PartDetailModal 读取失败 | 前端先做兼容：优先读关系表，fallback 读 JSONB，过渡期后移除 fallback |
| iteration_id 外键级联 | 只需 `ON DELETE CASCADE` 在应用层处理，避免数据库级外键依赖 `part_iterations` 表 |
| multiselect 选项变更后已有值不匹配 | 保持已有值不变（`value_json`），前端渲染时仅匹配存在的选项，未匹配的值灰显 |
