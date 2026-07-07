# 自定义字段增强 — 统一存储 & 构型项支持 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一自定义字段为关系表存储，后端新增 iteration_id 支持签出迭代，前端新增构型项支持和 multiselect 控件。

**Architecture:** 全部实体走 `custom_field_values` 关系表 + 新增 `iteration_id` 列（可空）。零部件签出时复制上一迭代字段值到新迭代。前端提取统一 `CustomFieldInput` 组件，构型项编辑/详情页新增自定义字段。

**Tech Stack:** Python FastAPI + SQLAlchemy，React TypeScript + Tailwind CSS

---

### Task 1: 后端 — 模型新增 iteration_id

**Files:**
- Modify: `backend/app/models.py:96-107` (CustomFieldValue 类)

- [ ] **Step 1: 修改 CustomFieldValue 模型**

在 `CustomFieldValue` 类中，`value_json` 之后、`created_at` 之前新增 `iteration_id` 列：

```python
class CustomFieldValue(Base):
    """自定义字段值表"""
    __tablename__ = "custom_field_values"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(UUID(as_uuid=True), ForeignKey('custom_field_definitions.id', ondelete='CASCADE'), nullable=False)
    entity_type = Column(String(32), nullable=False)  # 'part' / 'document' / 'configuration_item'
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    value_text = Column(Text, nullable=True)
    value_number = Column(Numeric(12, 4), nullable=True)
    value_json = Column(JSONB, nullable=True)
    iteration_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 2: 提交**

```powershell
git add backend/app/models.py
git commit -m "feat: CustomFieldValue 模型新增 iteration_id 列"
```

---

### Task 2: 后端 — Schema 新增 iteration_id

**Files:**
- Modify: `backend/app/schemas.py:217-233` (CustomFieldValueItem, CustomFieldValueResponse)

- [ ] **Step 1: 修改 CustomFieldValueItem**

```python
class CustomFieldValueItem(BaseSchema):
    id: Optional[uuid.UUID] = None
    field_id: uuid.UUID
    value: Optional[Any] = None
    iteration_id: Optional[uuid.UUID] = None  # 新增
```

- [ ] **Step 2: 修改 CustomFieldValueResponse**

```python
class CustomFieldValueResponse(BaseSchema):
    field_id: uuid.UUID
    field_key: Optional[str] = None
    field_name: Optional[str] = None
    field_type: Optional[str] = None
    value: Optional[Any] = None
    iteration_id: Optional[uuid.UUID] = None  # 新增
```

- [ ] **Step 3: 提交**

```powershell
git add backend/app/schemas.py
git commit -m "feat: CustomFieldValue Schema 新增 iteration_id"
```

---

### Task 3: 后端 — 数据库迁移脚本

**Files:**
- Create: `initdb/migrations/007_custom_fields_unify.sql`

- [ ] **Step 1: 编写迁移 DDL**

```sql
-- 007_custom_fields_unify.sql
-- 自定义字段统一：新增 iteration_id 列，后续步骤迁移 JSONB 数据后删除 part_iterations.custom_fields 列

-- 1. custom_field_values 新增 iteration_id
ALTER TABLE custom_field_values ADD COLUMN IF NOT EXISTS iteration_id UUID;
CREATE INDEX IF NOT EXISTS idx_cf_val_iter ON custom_field_values(iteration_id);

-- 2. （由 Python 迁移脚本执行）将 part_iterations.custom_fields JSONB 数据迁移到 custom_field_values
-- 3. （由 Python 迁移脚本执行）ALTER TABLE part_iterations DROP COLUMN IF EXISTS custom_fields
```

- [ ] **Step 2: 提交**

```powershell
git add initdb/migrations/007_custom_fields_unify.sql
git commit -m "feat: 数据库迁移脚本 007 — iteration_id 列"
```

---

### Task 4: 后端 — 路由 entity_type 白名单扩展

**Files:**
- Modify: `backend/app/routers/custom_fields.py:153,171,186` (三处白名单)

- [ ] **Step 1: 修改 get_values_batch（第153行）**

```python
# Before:
if type not in ('part', 'document'):
    raise HTTPException(status_code=400, detail="type 必须为 part 或 document")

# After:
if type not in ('part', 'document', 'configuration_item'):
    raise HTTPException(status_code=400, detail="type 必须为 part / document / configuration_item")
```

- [ ] **Step 2: 修改 get_values（第171行）**

```python
# Before:
if entity_type not in ('part', 'document'):
    raise HTTPException(status_code=400, detail="entity_type 必须为 part 或 document")

# After:
if entity_type not in ('part', 'document', 'configuration_item'):
    raise HTTPException(status_code=400, detail="entity_type 必须为 part / document / configuration_item")
```

- [ ] **Step 3: 修改 set_values（第186行）**

```python
# Before:
if entity_type not in ('part', 'document'):
    raise HTTPException(status_code=400, detail="entity_type 必须为 part 或 document")

# After:
if entity_type not in ('part', 'document', 'configuration_item'):
    raise HTTPException(status_code=400, detail="entity_type 必须为 part / document / configuration_item")
```

- [ ] **Step 4: 提交**

```powershell
git add backend/app/routers/custom_fields.py
git commit -m "feat: 自定义字段路由 entity_type 白名单新增 configuration_item"
```

---

### Task 5: 后端 — CRUD 新增 _copy_iteration_custom_fields & set_values 支持 iteration_id

**Files:**
- Modify: `backend/app/crud.py:354-402` (set_custom_field_values)
- Modify: `backend/app/crud.py:420-447` 附近（新增函数）

- [ ] **Step 1: 修改 set_custom_field_values — 查询已有值时增加 iteration_id 过滤**

修改 `set_custom_field_values` 函数签名和逻辑，新增可选参数 `iteration_id`：

```python
def set_custom_field_values(db, entity_type, entity_id, values, iteration_id=None):
    """批量设置实体的自定义字段值"""
    for item in values:
        field_def = get_custom_field_definition(db, item.field_id)
        if not field_def:
            continue
        
        # 查找已有值（加入 iteration_id 匹配）
        query = db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.field_id == item.field_id,
            models.CustomFieldValue.entity_type == entity_type,
            models.CustomFieldValue.entity_id == entity_id
        )
        if iteration_id is not None:
            query = query.filter(models.CustomFieldValue.iteration_id == iteration_id)
        else:
            query = query.filter(models.CustomFieldValue.iteration_id.is_(None))
        existing = query.first()

        value_text, value_number, value_json = None, None, None
        if field_def.field_type == 'text':
            value_text = str(item.value) if item.value is not None else None
        elif field_def.field_type == 'number':
            try:
                value_number = float(item.value) if item.value is not None else None
            except (ValueError, TypeError):
                value_number = None
        elif field_def.field_type == 'select':
            value_text = str(item.value) if item.value is not None else None
        elif field_def.field_type == 'multiselect':
            value_json = item.value if isinstance(item.value, list) else None

        if existing:
            existing.value_text = value_text
            existing.value_number = value_number
            existing.value_json = value_json
            from datetime import datetime
            existing.updated_at = datetime.utcnow()
        else:
            new_val = models.CustomFieldValue(
                field_id=item.field_id,
                entity_type=entity_type,
                entity_id=entity_id,
                value_text=value_text,
                value_number=value_number,
                value_json=value_json,
                iteration_id=iteration_id,
            )
            if item.id:
                new_val.id = item.id
            db.add(new_val)
    db.commit()
    return True
```

- [ ] **Step 2: 在 crud.py 末尾（_copy_custom_field_values 之后）新增 _copy_iteration_custom_fields**

```python
def _copy_iteration_custom_fields(db, source_iteration_id, target_iteration_id):
    """复制迭代的自定义字段值到目标迭代（签出时调用）"""
    source_values = db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.iteration_id == source_iteration_id
    ).all()
    for sv in source_values:
        new_val = models.CustomFieldValue(
            field_id=sv.field_id,
            entity_type=sv.entity_type,
            entity_id=sv.entity_id,
            value_text=sv.value_text,
            value_number=sv.value_number,
            value_json=sv.value_json,
            iteration_id=target_iteration_id,
        )
        db.add(new_val)
    db.flush()
```

- [ ] **Step 3: 提交**

```powershell
git add backend/app/crud.py
git commit -m "feat: set_values 支持 iteration_id，新增 _copy_iteration_custom_fields"
```

---

### Task 6: 后端 — checkout 签出时复制自定义字段

**Files:**
- Modify: `backend/app/crud_parts.py:317-353` (checkout_part)
- Modify: `backend/app/crud_parts.py:257-263` (_copy_iteration_data)

- [ ] **Step 1: 修改 checkout_part — 签出后复制字段值**

在 `checkout_part` 中，`db.flush()` 之后、`revision.latest_iteration = new_iteration_num` 之前，新增复制调用：

```python
def checkout_part(db: Session, revision_id: UUID, user_id: UUID):
    # ... 已有逻辑 (创建 new_iter) ...

    db.add(new_iter)
    db.flush()

    if prev_iter:
        _copy_iteration_data(db, prev_iter, new_iter)
        # 新增：复制自定义字段值到新迭代
        from .. import crud as crud_common
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id)

    revision.latest_iteration = new_iteration_num
    # ... 后续逻辑 ...
```

- [ ] **Step 2: 修改 _copy_iteration_data — 移除 custom_fields JSONB 赋值**

删除第260行：
```python
# 删除这行：
new_iter.custom_fields = source_iter.custom_fields or {}
```

- [ ] **Step 3: 提交**

```powershell
git add backend/app/crud_parts.py
git commit -m "feat: 签出时复制迭代自定义字段值到关系表"
```

---

### Task 7: 后端 — 移除 PartIteration JSONB 及 update_current_iteration 中的 custom_fields

**Files:**
- Modify: `backend/app/models_parts.py:59` (移除 custom_fields)
- Modify: `backend/app/schemas_parts.py:72` (移除 custom_fields)
- Modify: `backend/app/routers/parts.py:302-327` (update_current_iteration)

- [ ] **Step 1: 移除 PartIteration 模型中的 custom_fields**

删除 `models_parts.py` 第59行：
```python
# 删除：
custom_fields = Column(JSONB, default={})
```

- [ ] **Step 2: 移除 PartIterationResponse 中的 custom_fields**

删除 `schemas_parts.py` 约第72行：
```python
# 删除：
custom_fields: Optional[Dict[str, Any]] = {}
```

- [ ] **Step 3: 修改 update_current_iteration — 仅保留 remark**

```python
@router.put("/revisions/{revision_id}/iterations/current")
def update_current_iteration(
    revision_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    """更新当前迭代的可变数据（remark）"""
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(400, "当前迭代不存在")
    if str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(400, "请先签出后再编辑")

    updated = {}
    if "remark" in data and data["remark"] is not None:
        iteration.remark = data["remark"]
        updated["remark"] = data["remark"]
    if updated:
        db.commit()
    return {"detail": "已保存", "updated": updated}
```

- [ ] **Step 4: 提交**

```powershell
git add backend/app/models_parts.py backend/app/schemas_parts.py backend/app/routers/parts.py
git commit -m "feat: 移除 PartIteration.custom_fields JSONB 列"
```

---

### Task 8: 后端 — 编写 JSONB→关系表数据迁移脚本

**Files:**
- Create: `tools/migrate_custom_fields_jsonb.py`

- [ ] **Step 1: 编写迁移脚本**

```python
"""
将 PartIteration.custom_fields JSONB 数据迁移到 custom_field_values 关系表
用法: python tools/migrate_custom_fields_jsonb.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from app.database import SessionLocal
from app import models_parts, models
from app.models import CustomFieldValue, CustomFieldDefinition
from sqlalchemy import text

def migrate():
    db = SessionLocal()
    try:
        # 1. 加载所有字段定义（按 field_key 索引）
        defs = db.query(CustomFieldDefinition).all()
        key_to_def = {d.field_key: d for d in defs}

        # 2. 查找所有有自定义字段的迭代
        iterations = db.query(models_parts.PartIteration).filter(
            models_parts.PartIteration.custom_fields.isnot(None),
            models_parts.PartIteration.custom_fields != text("'{}'::jsonb")
        ).all()

        migrated = 0
        skipped = []

        for it in iterations:
            cf = dict(it.custom_fields or {})
            revision = db.query(models_parts.PartRevision).filter(
                models_parts.PartRevision.id == it.revision_id
            ).first()
            if not revision:
                continue

            for field_key, value in cf.items():
                field_def = key_to_def.get(field_key)
                if not field_def:
                    skipped.append(f"iteration={it.id} key={field_key}")
                    continue

                existing = db.query(CustomFieldValue).filter(
                    CustomFieldValue.field_id == field_def.id,
                    CustomFieldValue.entity_type == 'part',
                    CustomFieldValue.entity_id == revision.id,
                    CustomFieldValue.iteration_id == it.id,
                ).first()
                if existing:
                    continue

                new_val = CustomFieldValue(
                    field_id=field_def.id,
                    entity_type='part',
                    entity_id=revision.id,
                    iteration_id=it.id,
                )
                if field_def.field_type in ('text', 'select'):
                    new_val.value_text = str(value) if value is not None else None
                elif field_def.field_type == 'number':
                    try:
                        new_val.value_number = float(value)
                    except (ValueError, TypeError):
                        skipped.append(f"iteration={it.id} key={field_key} bad_number={value}")
                        continue
                elif field_def.field_type == 'multiselect':
                    new_val.value_json = value if isinstance(value, list) else None

                db.add(new_val)
                migrated += 1

        db.commit()
        print(f"迁移完成: {migrated} 条记录")
        if skipped:
            print(f"跳过 {len(skipped)} 条:")
            for s in skipped:
                print(f"  {s}")

        # 3. 确认无误后删列（需手动确认）
        print("\n迁移成功。确认无误后执行:")
        print("ALTER TABLE part_iterations DROP COLUMN IF EXISTS custom_fields;")

    finally:
        db.close()

if __name__ == '__main__':
    migrate()
```

- [ ] **Step 2: 提交**

```powershell
git add tools/migrate_custom_fields_jsonb.py
git commit -m "feat: JSONB→关系表数据迁移脚本"
```

---

### Task 9: 前端 — 类型定义新增 iteration_id

**Files:**
- Modify: `frontend/src/types/index.ts:221-227` (CustomFieldValue)

- [ ] **Step 1: 修改 CustomFieldValue 接口**

```typescript
export interface CustomFieldValue {
  field_id: string;
  field_key: string;
  field_name: string;
  field_type: string;
  value: string | number | string[] | null;
  iteration_id?: string | null;  // 新增
}
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/types/index.ts
git commit -m "feat: CustomFieldValue 类型新增 iteration_id"
```

---

### Task 10: 前端 — 新建 CustomFieldInput 统一组件

**Files:**
- Create: `frontend/src/components/CustomFieldInput.tsx`

- [ ] **Step 1: 编写组件**

```tsx
import type { CustomFieldDefinition } from '../types';

interface Props {
  def: CustomFieldDefinition;
  value: any;
  onChange: (val: any) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export default function CustomFieldInput({ def, value, onChange, disabled, readOnly }: Props) {
  const baseClass = "w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500";

  // 只读态
  if (readOnly) {
    if (def.field_type === 'multiselect') {
      const selected = Array.isArray(value) ? value : [];
      if (selected.length === 0) return <span className="text-sm text-gray-400">-</span>;
      const display = selected.length > 2
        ? `${selected.slice(0, 2).join('、')} +${selected.length - 2}`
        : selected.join('、');
      return <span className="text-sm text-gray-700">{display}</span>;
    }
    return <span className="text-sm text-gray-700">{value ?? '-'}</span>;
  }

  // 编辑态 — multiselect
  if (def.field_type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-2 py-1">
        {(def.options || []).map(opt => {
          const checked = selected.includes(opt);
          return (
            <label key={opt} className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border cursor-pointer
              ${checked ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="checkbox" checked={checked} disabled={disabled}
                onChange={() => {
                  if (checked) onChange(selected.filter(v => v !== opt));
                  else onChange([...selected, opt]);
                }}
                className="w-3 h-3" />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  // 编辑态 — select
  if (def.field_type === 'select') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass}>
        <option value="">请选择</option>
        {(def.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  // 编辑态 — number
  if (def.field_type === 'number') {
    return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass} />;
  }

  // 编辑态 — text (默认)
  return <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass} />;
}
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/components/CustomFieldInput.tsx
git commit -m "feat: 新建 CustomFieldInput 统一自定义字段输入组件"
```

---

### Task 11: 前端 — EntityEditModal 替换为 CustomFieldInput

**Files:**
- Modify: `frontend/src/components/EntityEditModal.tsx:297-314` (renderCustomFieldInput)

- [ ] **Step 1: 引入并使用 CustomFieldInput**

替换 `renderCustomFieldInput` 函数（第297-314行）：

```tsx
import CustomFieldInput from './CustomFieldInput';

// 删除整个 renderCustomFieldInput 函数（第297-314行）
// 在渲染处（约第359-379行）改为：

{customFieldDefs.map(def => (
  <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
    <label className="block text-xs text-gray-500 mb-0.5">
      {def.name}
      {def.is_required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <CustomFieldInput
      def={def}
      value={customFieldValues[def.id]}
      onChange={(val) => setCustomFieldValues(prev => ({ ...prev, [def.id]: val }))}
      disabled={locked}
    />
  </div>
))}
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/components/EntityEditModal.tsx
git commit -m "feat: EntityEditModal 使用 CustomFieldInput 统一组件"
```

---

### Task 12: 前端 — Settings.tsx 新增构型项和多选类型

**Files:**
- Modify: `frontend/src/pages/Settings.tsx` (ENTITY_TYPES, FIELD_TYPES 常量)

- [ ] **Step 1: 修改常量定义**

找到 `ENTITY_TYPES`（约第19行）和 `FIELD_TYPES`（约第14行）：

```tsx
const FIELD_TYPES = [
  { value: 'text', label: '单行文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
  { value: 'multiselect', label: '多选' },  // 新增
];

const ENTITY_TYPES = [
  { value: 'component', label: '零部件' },
  { value: 'document', label: '图文档' },
  { value: 'configuration_item', label: '构型项' },  // 新增
];
```

- [ ] **Step 2: 修改表单类型 — FormData 接口 field_type 加入 multiselect**

```tsx
interface FieldFormData {
  name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'select' | 'multiselect';  // 扩展
  options: string;
  is_required: boolean;
  applies_to: string[];
  sort_order: number;
}
```

- [ ] **Step 3: 修改创建模态框 options 字段显示条件**

找到 options textarea 的渲染条件（约第900行附近），将仅 `field_type === 'select'` 的条件扩展为也包含 `multiselect`：

```tsx
// Before:
{form.field_type === 'select' && (
  // options textarea
)}

// After:
{(form.field_type === 'select' || form.field_type === 'multiselect') && (
  // options textarea
)}
```

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/pages/Settings.tsx
git commit -m "feat: 设置页自定义字段增加构型项和多选类型"
```

---

### Task 13: 前端 — ConfigurationCreateModal 新增自定义字段编辑

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationCreateModal.tsx`

- [ ] **Step 1: 新增 imports 和状态**

在文件顶部 import：

```tsx
import { customFieldsApi } from '../../services/api';
import { useDataStore } from '../../stores/data';
import CustomFieldInput from '../CustomFieldInput';
import type { CustomFieldDefinition } from '../../types';
```

在组件内（`const [error, setError]` 之后）新增状态：

```tsx
const [cfDefs, setCfDefs] = useState<CustomFieldDefinition[]>([]);
const [cfValues, setCfValues] = useState<Record<string, any>>({});
```

- [ ] **Step 2: useEffect 加载定义（在现有 useEffect 中追加）**

在组件挂载时加载构型项自定义字段定义（在已有的 `useEffect(() => { if (open) { ... } })` 函数体末尾追加）：

```tsx
// 加载构型项自定义字段定义
const allDefs = useDataStore.getState().customFieldDefs;
const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('configuration_item'));
setCfDefs(defs);
if (item?.id && defs.length > 0) {
  customFieldsApi.getValues('configuration_item', item.id).then(r => {
    const vals: Record<string, any> = {};
    (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
    setCfValues(vals);
  }).catch(() => {});
}
```

- [ ] **Step 3: handleSubmit 中保存自定义字段**

在 `handleSubmit` 函数中，`onSaved()` 之前（约第170行）：

```tsx
// 保存自定义字段值
if (cfDefs.length > 0) {
  const fieldValues = cfDefs.map(def => ({
    field_id: def.id,
    value: cfValues[def.id] ?? null,
  })).filter(fv => fv.value !== null && fv.value !== '');
  if (fieldValues.length > 0) {
    await customFieldsApi.setValues('configuration_item', configId, fieldValues);
  }
}
```

- [ ] **Step 4: 在表单中渲染自定义字段（备注区域之后、关联零部件之前）**

在 `{/* 备注 */}` 那行代码后（约第421行 `</div>` 之后）、`{/* 关联零部件 */}` 之前（约第423行）插入：

```tsx
{/* 自定义字段 */}
{cfDefs.length > 0 && (
  <div className="border-t pt-4">
    <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cfDefs.map(def => (
        <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <label className="block text-xs text-gray-500 mb-0.5">
            {def.name}
            {def.is_required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <CustomFieldInput
            def={def}
            value={cfValues[def.id]}
            onChange={(val) => setCfValues(prev => ({ ...prev, [def.id]: val }))}
          />
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 5: 提交**

```powershell
git add frontend/src/components/Configuration/ConfigurationCreateModal.tsx
git commit -m "feat: 构型项编辑弹窗新增自定义字段"
```

---

### Task 14: 前端 — ConfigurationDetailModal 新增自定义字段展示

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationDetailModal.tsx`

- [ ] **Step 1: 新增状态加载**

在组件内（`const [loading, setLoading]` 附近）新增：

```tsx
const [cfDefs, setCfDefs] = useState<CustomFieldDefinition[]>([]);
const [cfValues, setCfValues] = useState<Record<string, any>>({});
```

- [ ] **Step 2: 在 useEffect 中加载字段值**

在已有的 `useEffect(() => { if (!itemId) return; ... })` 中，`setData(d)` 之后追加：

```tsx
// 加载自定义字段
const allDefs = useDataStore.getState().customFieldDefs;
const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('configuration_item'));
setCfDefs(defs);
if (defs.length > 0) {
  customFieldsApi.getValues('configuration_item', itemId).then(res => {
    const vals: Record<string, any> = {};
    (res.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
    setCfValues(vals);
  }).catch(() => {});
}
```

- [ ] **Step 3: 在基本信息卡片之后渲染自定义字段**

在基本信息 `</div>` 之后、`{/* 关联零部件 */}` 之前（约第310行之后）：

```tsx
{/* 自定义字段 */}
{cfDefs.length > 0 && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    {cfDefs.map(def => {
      const val = cfValues[def.id];
      return (
        <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <label className="block text-xs text-gray-500 mb-0.5">{def.name}</label>
          <CustomFieldInput def={def} value={val} onChange={() => {}} readOnly />
        </div>
      );
    })}
  </div>
)}
```

注意需要在文件顶部引入 `CustomFieldInput`：
```tsx
import CustomFieldInput from '../CustomFieldInput';
```

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/components/Configuration/ConfigurationDetailModal.tsx
git commit -m "feat: 构型项详情弹窗新增自定义字段展示"
```

---

### Task 15: 前端 — ConfigurationList 实现 cf_ 自定义字段搜索

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationList.tsx:56-71` (filteredData)

- [ ] **Step 1: 加载所有构型项的自定义字段值**

在组件顶部新增状态（`const [items, setItems]` 之后）：

```tsx
const [cfValuesMap, setCfValuesMap] = useState<Record<string, Record<string, any>>>({});
```

在 `load()` 函数中，加载完成后批量获取自定义字段值：

```tsx
// 在 load() 中 setItems 之后追加:
if (configCustomDefs.length > 0) {
  const itemIds = (res.data.items || []).map((i: ConfigurationItem) => i.id);
  customFieldsApi.getValuesBatch({ type: 'configuration_item', ids: itemIds.join(',') }).then(res => {
    setCfValuesMap(res.data || {});
  }).catch(() => {});
}
```

- [ ] **Step 2: 修改 filteredData 增加 cf_ 搜索过滤**

```tsx
const filteredData = useMemo(() => {
  if (!search) return items;
  const keyword = search.toLowerCase();
  const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);

  return items.filter(item => {
    if (searchField === 'all') {
      // 基础字段匹配
      if (match(item.code) || match(item.name) || match(item.spec) || match(item.remark)) return true;
      // 自定义字段值匹配
      const cfVals = cfValuesMap[item.id] || {};
      return Object.values(cfVals).some(v => {
        if (v === null || v === undefined) return false;
        if (Array.isArray(v)) return v.some(s => String(s).toLowerCase().includes(keyword));
        return String(v).toLowerCase().includes(keyword);
      });
    }
    if (searchField.startsWith('cf_')) {
      const fieldId = searchField.slice(3);
      const cfVals = cfValuesMap[item.id] || {};
      const v = cfVals[fieldId];
      if (v === null || v === undefined) return false;
      if (Array.isArray(v)) return v.some(s => String(s).toLowerCase().includes(keyword));
      return String(v).toLowerCase().includes(keyword);
    }
    if (searchField === 'code') return match(item.code);
    if (searchField === 'name') return match(item.name);
    if (searchField === 'spec') return match(item.spec);
    if (searchField === 'remark') return match(item.remark);
    return true;
  });
}, [items, search, searchField, cfValuesMap]);
```

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/components/Configuration/ConfigurationList.tsx
git commit -m "feat: 构型项列表支持自定义字段搜索"
```

---

### Task 16: 前端 — PartDetailModal 改用关系表 API

**Files:**
- Modify: `frontend/src/components/PartDetailModal.tsx`

- [ ] **Step 1: 移除 JSONB 读取逻辑，改用 customFieldsApi**

找到现有的 `cfDefs` 加载和 `editData.custom_fields` 读写逻辑（约第70-79行、473-558行），替换为：

在 `useEffect`（加载定义处，约第70行）改为：

```tsx
// 加载自定义字段定义
const allDefs = useDataStore.getState().customFieldDefs;
setCfDefs(allDefs.filter((d: any) => d.applies_to?.includes('part')));
```

新增状态替代 `editData`：
```tsx
const [cfEditValues, setCfEditValues] = useState<Record<string, any>>({});
```

加载时获取字段值（在 `loadPartDetail` 或对应 `useEffect` 中追加）：
```tsx
if (revisionId) {
  customFieldsApi.getValues('part', revisionId).then(r => {
    const vals: Record<string, any> = {};
    (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
    setCfEditValues(vals);
  }).catch(() => {});
}
```

保存时改用 `customFieldsApi.setValues`：
```tsx
const fieldValues = cfDefs.map((def: any) => ({
  field_id: def.id,
  value: cfEditValues[def.id] ?? null,
})).filter((fv: any) => fv.value !== null && fv.value !== '');
if (fieldValues.length > 0) {
  await customFieldsApi.setValues('part', revisionId, fieldValues);
}
```

- [ ] **Step 2: 渲染时使用 CustomFieldInput**

```tsx
{customFieldInputs.map(def => (
  <CustomFieldInput
    key={def.id}
    def={def}
    value={cfEditValues[def.id]}
    onChange={(val) => {
      const newVals = { ...cfEditValues, [def.id]: val };
      setCfEditValues(newVals);
      autoSave(newVals);
    }}
  />
))}
```

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/components/PartDetailModal.tsx
git commit -m "feat: PartDetailModal 改用关系表 API 读写自定义字段"
```

---

### Task 17: 前端 — Documents.tsx multiselect 适配

**Files:**
- Modify: `frontend/src/pages/Documents.tsx:624-662` (renderCustomFieldInput)

- [ ] **Step 1: 替换 renderCustomFieldInput 调用**

引入 `CustomFieldInput`，将 `renderCustomFieldInput(def)` 的调用替换为：

```tsx
<CustomFieldInput
  def={def}
  value={customFieldValues[def.id]}
  onChange={(val) => setCustomFieldValues(prev => ({ ...prev, [def.id]: val }))}
/>
```

删除原有的 `renderCustomFieldInput` 函数（第624-662行）。

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/pages/Documents.tsx
git commit -m "feat: 图文档页使用 CustomFieldInput 适配 multiselect"
```

---

### Task 18: 前端 — importExport.ts 兼容 configuration_item

**Files:**
- Modify: `frontend/src/services/importExport.ts` (导出/导入逻辑)

- [ ] **Step 1: 搜索 importExport.ts 中与自定义字段相关的逻辑**

在 `importExport.ts` 中找到处理 `entity_type` 切换的地方，确认导入导出已包含 `configuration_item`。如果没有，新增分支。

（具体改动视实际代码而定，此任务需要先阅读 importExport.ts 中的自定义字段相关代码后确定具体改动量。预期改动很小，可能无需修改——因为导出从 API 获取数据，导入走 API 保存，底层已支持。）

- [ ] **Step 2: 提交（如有改动）**

```powershell
git add frontend/src/services/importExport.ts
git commit -m "feat: 导入导出兼容 configuration_item 自定义字段"
```

---

### Task 19: 构建与验证

- [ ] **Step 1: 构建前端**

```powershell
cd frontend; npm run build
```

预期：无编译错误。

- [ ] **Step 2: 重启后端**

```powershell
docker restart bom_backend
```

- [ ] **Step 3: 功能验证清单**
  - [ ] 设置页：自定义字段管理能看到 `多选` 类型和 `构型项` 适用类型
  - [ ] 构型项编辑弹窗：能看到并编辑自定义字段（text/number/select/multiselect）
  - [ ] 构型项详情弹窗：自定义字段只读展示
  - [ ] 构型项列表：可按自定义字段搜索
  - [ ] 零部件编辑：EntityEditModal 支持 multiselect
  - [ ] 零部件详情：PartDetailModal 自定义字段正常读写（签出后编辑）
  - [ ] 图文档编辑：Documents.tsx 支持 multiselect
  - [ ] 图文档详情：自定义字段展示正常（回归确认无影响）

- [ ] **Step 4: 提交（如有 lint 修复）**

```powershell
git add -A
git commit -m "chore: 构建验证和 lint 修复"
```
