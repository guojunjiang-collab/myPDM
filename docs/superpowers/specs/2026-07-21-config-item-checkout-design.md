# 构型项签入签出 — 三层模型重构

日期：2026-07-21
状态：已批准，待实现

## 背景

当前构型项（`ConfigurationItem`）是扁平模型，无版本控制和签入签出机制。用户要求参照零部件（PartMaster → PartRevision → PartIteration）三层架构，为构型项引入签入签出功能，前端去掉独立编辑弹窗，详情界面直接编辑。

## 决策（已与用户确认）

1. **模型**: Master → Revision → Iteration 三层，版本序列 A→B→...→ZZ（24进制不含I/O）
2. **签出**: 锁在 Revision 层，每次签出创建新 Iteration，签入后释放锁
3. **状态机**: draft → frozen → released → obsolete（同零部件）
4. **前端**: 详情弹窗顶部操作栏（签出/签入/撤销/强制签入/冻结/发布/升版），签出态可编辑，他人签出只读
5. **编辑模式**: 去掉独立编辑弹窗，详情弹窗直接编辑（签出态）
6. **版本历史**: 复用 VersionHistory 组件模式

## 改动详情

### 一、数据模型（`backend/app/models_configuration.py`）

#### 1.1 原表重命名

`configuration_items` → `configuration_item_masters`

#### 1.2 新增表

**configuration_item_masters**（主数据，不可变）：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | — |
| code | String(64) | 唯一索引(部分 WHERE deleted_at IS NULL) | 构型号 |
| name | String(255) | NOT NULL | 名称 |
| spec | String(255) | — | 规格型号 |
| remark | Text | — | 备注 |
| creator_id | UUID | — | 创建者 |
| created_at | DateTime | default=now | — |
| updated_at | DateTime | onupdate=now | — |
| deleted_at | DateTime | — | 软删除 |

**configuration_item_revisions**（版本层）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | — |
| master_id | UUID FK→masters | — |
| version | String(8) | 版本序列号 |
| status | String(32) | draft/frozen/released/obsolete |
| check_out_user_id | UUID, 可空 | 签出用户 |
| check_out_date | DateTime, 可空 | 签出时间 |
| latest_iteration | Integer | 最新迭代号，初始 1 |
| creator_id | UUID | — |
| created_at | DateTime | — |
| deleted_at | DateTime | — |

**configuration_item_iterations**（迭代层）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | — |
| revision_id | UUID FK→revisions | — |
| iteration | Integer | 迭代号 |
| check_in_note | Text | 签入说明 |
| version_spec | String(255) | 迭代时规格型号（从 Master 或上一迭代复制） |
| version_remark | Text | 迭代时备注 |
| version_name | String(255) | 迭代时名称（从 Master 或上一迭代复制） |
| document_links | JSONB | 关联图文档，默认 [] |
| created_at | DateTime | — |

#### 1.3 关联表改造

`configuration_item_parts`、`configuration_item_children`、`configuration_item_documents` 中的 `configuration_item_id` 引用改为 `iteration_id`（指向 configuration_item_iterations）。

### 二、API 端点（`backend/app/routers/configuration.py`）

路由前缀保持不变 `/api/configurations`。

#### 2.1 构型项 CRUD（重构）

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/items?master_id=` | GET | `configuration:read` | 列表（按 master 聚合，返回最新 revision 摘要） |
| `/items` | POST | `configuration:create` | 创建：同时建 Master + Revision(A) + Iteration(1) |
| `/items/{revision_id}` | GET | `configuration:read` | 详情（含当前迭代数据 + 零部件 + 子构型项） |
| `/items/{revision_id}` | PUT | `configuration:update` | 更新迭代层数据（需签出，仅签出者可写） |
| `/items/{revision_id}` | DELETE | `configuration:delete` | 软删除 Revision |

#### 2.2 签入签出

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/items/{revision_id}/checkout` | POST | `configuration:checkout` | 签出：创建新迭代(+1)，设置 check_out_user_id |
| `/items/{revision_id}/checkin` | POST | `configuration:checkin` | 签入：记录 note，清除签出锁 |
| `/items/{revision_id}/undocheckout` | POST | `configuration:undocheckout` | 撤销：删除最新迭代(-1)，清除签出锁 |
| `/items/{revision_id}/force-checkin` | POST | `configuration:force_checkin` | 管理员强制清除签出锁 |

#### 2.3 版本操作

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/items/{revision_id}/upgrade` | POST | `configuration:create` | 升版：status released/obsolete → 新 Revision，自动签出 |
| `/items/{revision_id}/freeze` | POST | `configuration:update` | 冻结：draft → frozen |
| `/items/{revision_id}/release` | POST | `configuration:update` | 发布：frozen → released |
| `/items/{revision_id}/obsolete` | POST | `configuration:update` | 作废 |
| `/items/{revision_id}/versions` | GET | `configuration:read` | 版本历史 |

#### 2.4 关联管理（改为 iteration_id）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/items/{revision_id}/iterations/{iteration_id}/parts` | POST/PUT/DELETE | 关联零部件 |
| `/items/{revision_id}/iterations/{iteration_id}/children` | POST/PUT/DELETE | 子构型项 |
| `/items/{revision_id}/iterations/{iteration_id}/documents` | GET/POST/PUT/DELETE | 图文档 |

#### 2.5 配置概要改造

`configuration_profiles` 关联的 `configuration_item_id` 改为 `configuration_item_revision_id`，`ConfigurationProfileItem` 和 `ConfigurationWorkingItem` 引用调整为 revision_id + iteration_id。

### 三、前端改造

#### 3.1 类型定义（`frontend/src/types/index.ts`）

新增：

```typescript
interface ConfigurationItemMaster {
  id: string; code: string; name: string; spec?: string; remark?: string;
  creator_id?: string; created_at?: string; updated_at?: string;
}

interface ConfigurationItemRevision {
  id: string; master_id: string;
  version: string;           // A/B/C/.../ZZ
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  check_out_user_id?: string; check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration: number;
  creator_id?: string; created_at?: string;
  // 当前迭代数据
  iteration_id: string;
  spec?: string; remark?: string; name?: string;
  document_links?: any[];
}

interface ConfigurationItemDetail {
  master: ConfigurationItemMaster;
  revision: ConfigurationItemRevision;
  parts: ConfigPartItem[];       // 关联零部件
  children: ConfigChildItem[];   // 子构型项
  documents: any[];              // 图文档
  versions: { id: string; version: string; status: string; created_at: string }[];
}
```

#### 3.2 列表页（`ConfigurationList.tsx`）

改动：
- 新增列：当前版本、签出状态（显示签出者姓名）
- 「编辑」按钮 → 「详情」（ComponentDetailModal 替代 ConfigurationDetailModal）
- 保留「新建」按钮、导入导出

#### 3.3 详情弹窗（重构 `ConfigurationDetailModal.tsx` 为 `ConfigItemDetailModal.tsx`）

**完全参照 `PartDetailModal` UI 模式：**

**标题栏**: Modal title="构型项详情"，`width="full"`（同 PartDetailModal）

**信息卡片区**（签出态 inline 编辑，非签出态只读）：
```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
  <InfoCard label="构型号" value={master.code} editable={canEdit} onSave={...} />
  <InfoCard label="中文名称" value={master.name} editable={canEdit} onSave={...} />
  <InfoCard label="规格型号" value={master.spec} editable={canEdit} onSave={...} />
  <InfoCard label="类型" value="构型项" readonly />
</div>
```
样式：`bg-gray-50 rounded-lg px-3 py-2 border border-gray-100`，标签 `text-xs text-gray-500`，值 `text-sm text-gray-900 font-medium`。编辑时切换为 `<input>` + 500ms 防抖自动保存 (`PATCH /items/{master_id}`)。

**版本/状态/操作栏**（同 PartDetailModal 模式）：
```tsx
<div className="bg-white rounded-lg border border-gray-200 p-3 shrink-0 mb-3">
  <div className="flex items-center justify-between flex-wrap gap-2">
    <div className="flex items-center gap-3">
      <span className="font-semibold text-sm">版本：{revision?.version}</span>
      <StatusBadge status={revision?.status} />
      {isCheckedOut && <span className="text-xs text-orange-600">已签出：{userName}</span>}
    </div>
    <div className="flex gap-1 flex-wrap items-center">
      {/* 3D预览组 */}
      <button className="px-3 py-1 bg-indigo-600 text-white rounded text-xs">3D预览</button>
      {/* | 竖线分隔 */}
      {(canCheckout || canCheckin || ...) && <span className="mx-1 text-gray-300">|</span>}
      {/* 生命周期组 */}
      {canCheckout && <button className="px-3 py-1 bg-primary-600 text-white rounded text-xs">签出</button>}
      {canCheckin && <button className="px-3 py-1 bg-primary-600 text-white rounded text-xs">签入</button>}
      {canUndo && <button className="px-3 py-1 bg-gray-500 text-white rounded text-xs">撤销签出</button>}
      {canFreeze && <button className="px-3 py-1 bg-blue-500 text-white rounded text-xs">冻结</button>}
      {canRelease && <button className="px-3 py-1 bg-primary-600 text-white rounded text-xs">发布</button>}
      {canUpgrade && <button className="px-3 py-1 bg-purple-600 text-white rounded text-xs">升版</button>}
      {canObsolete && <button className="px-3 py-1 bg-red-500 text-white rounded text-xs">作废</button>}
      {canForceCheckin && <button className="px-3 py-1 bg-red-600 text-white rounded text-xs">强制签入</button>}
    </div>
  </div>
</div>
```

按钮权限条件（参照 PartDetailModal 的 `canEdit` 逻辑）：
- `canCheckout` = `!isCheckedOut && (isDraft || isFrozen)`
- `canCheckin` = `isCheckedOutByMe`
- `canUndo` = `isCheckedOutByMe`
- `canFreeze` = `isDraft && !isCheckedOut`
- `canRelease` = `isFrozen && !isCheckedOut`
- `canUpgrade` = `(isReleased || isObsolete) && !isCheckedOut`
- `canObsolete` = `(isReleased || isFrozen) && !isCheckedOut`
- `canForceCheckin` = `isCheckedOut && isAdmin`
- `canEdit` = `isCheckedOutByMe && isDraft`

**Tab 导航**（同 PartDetailModal 下划线式）：
```tsx
const tabs = [
  { key: 'info', label: '基本信息' },
  { key: 'parts', label: '关联零部件' },
  { key: 'children', label: '子构型项' },
  { key: 'docs', label: '关联图文档' },
  { key: 'versions', label: '版本历史' },
];
```
活跃 `border-primary-600 text-primary-600`，非活跃 `border-transparent text-gray-500`。

**基本信息 Tab**：备注（`<textarea>`，签出态可编辑，500ms 防抖）+ 创建信息

**关联零部件/子构型项 Tab**：表格形式，签出态显示添加/移除操作按钮

**关联图文档 Tab**：复用 `EntityDocumentSection` 组件，签出态 `editable=true`

**版本历史 Tab**：表格（版本号/状态/创建时间/切换按钮），当前版本行 `bg-blue-50`

#### 3.4 新建弹窗（保留 `ConfigurationCreateModal.tsx`）

仅用于创建，输入 code/name/spec/remark，创建后自动签出。

### 四、权限

`permissions/permissions.json` 新增：

```json
"configuration:checkout": ["admin", "engineer"],
"configuration:checkin": ["admin", "engineer"],
"configuration:undocheckout": ["admin", "engineer"],
"configuration:force_checkin": ["admin"]
```

### 五、数据迁移

`initdb/migrations/` 新增迁移脚本：
1. 创建三张新表（masters/revisions/iterations）
2. 将原 `configuration_items` 数据迁移：
   - 每条 → 1 Master + 1 Revision (version='A', status='draft') + 1 Iteration(1)
3. 更新关联表外键（parts/children/documents/profiles → iteration_id 或 revision_id）
4. 删除或重命名旧表

### 六、不改动

- 构型配置（Profile）的审批流程保持不变（仅关联关系改为 revision_id）
- 零部件模型不做任何改动
- 图文档模型不做任何改动
- 3D 预览功能保持不变

## 验证

1. 迁移后原数据完整可访问
2. 创建构型项 → 自动生成 Master + Revision A + Iteration 1
3. 签出 → Iteration 2 创建，表单可编辑
4. 签入 → 锁释放，记录 note
5. 撤销签出 → Iteration 回退，锁释放
6. 他人签出 → 表单只读
7. 升版 → 新 Revision B 创建，自动签出
8. 前端编译通过，现有配置页面功能不受影响
