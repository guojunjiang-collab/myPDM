# 构型项签入签出 — 三层模型重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task.

**Goal:** 将构型项从扁平模型重构为 Master→Revision→Iteration 三层架构，引入签入签出/版本管理，重构前端详情弹窗对齐 PartDetailModal UI 模式。

**Architecture:** 后端新建三个模型替换旧 ConfigurationItem，关联表 FK 改为 iteration_id。CRUD/签出函数参照 `crud_parts.py` 模式。前端详情弹窗完全参照 `PartDetailModal.tsx` 布局和交互。

**Tech Stack:** Python/SQLAlchemy 2.0（后端），React 18 + TypeScript（前端）

**Spec:** `docs/superpowers/specs/2026-07-21-config-item-checkout-design.md`

## Global Constraints

- 版本序列：A→B→...→ZZ，24进制不含 I/O（复用 `crud_parts.py` 中的版本号函数）
- 签出条件：status=draft → 创建新 Iteration(+1)，复制上一迭代数据
- 编辑权限：`isCheckedOutByMe && isDraft`（同 PartDetailModal）
- 前端 UI 完全参照 PartDetailModal：信息卡片网格、竖线分隔按钮组、下划线Tab、inline编辑+防抖
- 软删除：仅 Revision 层
- 权限：新增 `configuration:checkout/checkin/undocheckout/force_checkin`
- 不改动零部件模型、图文档模型、3D预览功能

---

### Task 1: 数据模型 + 迁移脚本

**Files:**
- Modify: `backend/app/models_configuration.py`
- Create: `initdb/migrations/007_config_item_three_tier.sql`

**Interfaces:**
- Produces: 四个新模型类 + 一个迁移 SQL 文件
- 新模型: `ConfigurationItemMaster`, `ConfigurationItemRevision`, `ConfigurationItemIteration`, 保留 `ConfigurationItemPart/Child/Document`（FK 改为 iteration_id 或 revision_id）

- [ ] **Step 1: 重写 models_configuration.py 中的构型项模型**

将现有的 `ConfigurationItem` 类替换为三个新类。在文件中将 `class ConfigurationItem(Base):` 到 `class ConfigurationItemChild(Base):` 部分替换为：

```python
class ConfigurationItemMaster(Base):
    """构型项主数据"""
    __tablename__ = "configuration_item_masters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    remark = Column(Text)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ConfigurationItemRevision(Base):
    """构型项版本"""
    __tablename__ = "configuration_item_revisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_masters.id"), nullable=False)
    version = Column(String(8), nullable=False)
    status = Column(String(32), nullable=False, default="draft")
    check_out_user_id = Column(UUID(as_uuid=True), nullable=True)
    check_out_date = Column(DateTime(timezone=True), nullable=True)
    latest_iteration = Column(Integer, nullable=False, default=1)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ConfigurationItemIteration(Base):
    """构型项迭代"""
    __tablename__ = "configuration_item_iterations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=False)
    iteration = Column(Integer, nullable=False)
    check_in_note = Column(Text)
    version_spec = Column(String(255))
    version_remark = Column(Text)
    version_name = Column(String(255))
    document_links = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 2: 更新关联表 FK**

将 `ConfigurationItemPart`、`ConfigurationItemChild` 的 `configuration_item_id` FK 改为 `iteration_id`（指向 `configuration_item_iterations`）。

`ConfigurationItemPart`:
```python
class ConfigurationItemPart(Base):
    __tablename__ = "configuration_item_parts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id", ondelete="CASCADE"), nullable=False)
    part_type = Column(String(16), nullable=False)
    part_id = Column(UUID(as_uuid=True), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

`ConfigurationItemChild`:
```python
class ConfigurationItemChild(Base):
    __tablename__ = "configuration_item_children"
    __table_args__ = (UniqueConstraint('parent_iteration_id', 'child_revision_id', name='uix_config_child'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id", ondelete="CASCADE"), nullable=False)
    child_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id", ondelete="CASCADE"), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

`ConfigurationProfile` 的 FK 改为 revision_id:
```python
configuration_item_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=True)
```

`ConfigurationProfileItem` 和 `ConfigurationWorkingItem` 的 `source_config_item_id` 改为 `source_config_item_revision_id`，添加 `source_config_item_iteration_id`。

- [ ] **Step 3: 创建迁移 SQL**

创建 `initdb/migrations/007_config_item_three_tier.sql`:

```sql
-- 1. 创建新表
CREATE TABLE configuration_item_masters (...);
CREATE TABLE configuration_item_revisions (...);
CREATE TABLE configuration_item_iterations (...);

-- 2. 迁移旧数据
INSERT INTO configuration_item_masters (id, code, name, spec, remark, creator_id, created_at, updated_at)
  SELECT id, code, name, spec, remark, creator_id, created_at, updated_at FROM configuration_items WHERE deleted_at IS NULL;

INSERT INTO configuration_item_revisions (id, master_id, version, status, creator_id, created_at)
  SELECT uuid_generate_v4(), id, 'A', 'draft', creator_id, created_at FROM configuration_item_masters;

INSERT INTO configuration_item_iterations (id, revision_id, iteration, version_spec, version_remark, version_name, document_links, created_at)
  SELECT uuid_generate_v4(), r.id, 1, m.spec, m.remark, m.name, ci.document_links, ci.created_at
  FROM configuration_items ci
  JOIN configuration_item_masters m ON ci.id = m.id
  JOIN configuration_item_revisions r ON r.master_id = m.id;

-- 3. 迁移关联表数据
-- configuration_item_parts: configuration_item_id → iteration_id
UPDATE configuration_item_parts p SET configuration_item_id = (
  SELECT i.id FROM configuration_item_revisions r
  JOIN configuration_item_iterations i ON i.revision_id = r.id
  WHERE r.master_id = p.configuration_item_id
);
ALTER TABLE configuration_item_parts RENAME COLUMN configuration_item_id TO iteration_id;
ALTER TABLE configuration_item_parts ADD CONSTRAINT fk_cip_iteration FOREIGN KEY (iteration_id) REFERENCES configuration_item_iterations(id);

-- 同理处理 configuration_item_children
-- 同理处理 configuration_profiles 的 configuration_item_id → configuration_item_revision_id
-- 同理处理 configuration_profile_items / configuration_working_items

-- 4. 删除旧表
DROP TABLE configuration_items;
```

- [ ] **Step 4: 更新 main.py 自动迁移逻辑**

在 `main.py` 中找到建表/迁移部分，确保新表在启动时自动创建。移除对旧 `configuration_items` 表的引用。

- [ ] **Step 5: 重启验证**

```powershell
docker restart bom_backend
docker logs bom_backend --tail 20
```

验证：新表创建成功，无启动错误。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models_configuration.py initdb/migrations/007_config_item_three_tier.sql
git commit -m "feat: config item three-tier model (master/revision/iteration) with migration"
```

---

### Task 2: CRUD 函数

**Files:**
- Modify: `backend/app/crud_configuration.py`

**Interfaces:**
- Consumes: Task 1 的模型类
- Produces: `create_config_item()`, `get_config_item_revision()`, `checkout_config_item()`, `checkin_config_item()`, `undocheckout_config_item()`, `force_checkin_config_item()`, `upgrade_config_item()`, `freeze_config_item()`, `release_config_item()`, `obsolete_config_item()`

- [ ] **Step 1: 添加创建函数**

```python
def create_config_item(db: Session, data: dict, user_id: UUID) -> tuple:
    """创建构型项：同时创建 Master + Revision(A) + Iteration(1)，自动签出"""
    master = ConfigurationItemMaster(
        code=data["code"], name=data["name"],
        spec=data.get("spec", ""), remark=data.get("remark", ""),
        creator_id=user_id,
    )
    db.add(master)
    db.flush()

    revision = ConfigurationItemRevision(
        master_id=master.id, version="A", status="draft",
        creator_id=user_id, latest_iteration=1,
        check_out_user_id=user_id, check_out_date=func.now(),
    )
    db.add(revision)
    db.flush()

    iteration = ConfigurationItemIteration(
        revision_id=revision.id, iteration=1,
        version_spec=master.spec, version_remark=master.remark,
        version_name=master.name, document_links=[],
    )
    db.add(iteration)
    db.commit()
    return master, revision, iteration
```

- [ ] **Step 2: 添加签出函数**

```python
def checkout_config_item(db: Session, revision_id: UUID, user_id: UUID) -> tuple:
    """签出：创建新迭代(+1)，设置签出锁"""
    rev = db.query(ConfigurationItemRevision).filter(
        ConfigurationItemRevision.id == revision_id,
        ConfigurationItemRevision.deleted_at.is_(None),
    ).first()
    if not rev:
        return None, "版本不存在"
    if rev.status not in ("draft", "frozen"):
        return None, f"当前状态 {rev.status} 不允许签出"
    if rev.check_out_user_id:
        return None, "该版本已被他人签出"

    # 从当前迭代复制数据到新迭代
    current_iter = db.query(ConfigurationItemIteration).filter(
        ConfigurationItemIteration.revision_id == revision_id,
        ConfigurationItemIteration.iteration == rev.latest_iteration,
    ).first()

    new_iter = ConfigurationItemIteration(
        revision_id=revision_id,
        iteration=rev.latest_iteration + 1,
        version_spec=(current_iter.version_spec if current_iter else rev.master.spec),
        version_remark=(current_iter.version_remark if current_iter else rev.master.remark),
        version_name=(current_iter.version_name if current_iter else rev.master.name),
        document_links=(current_iter.document_links if current_iter else []),
    )
    db.add(new_iter)

    rev.latest_iteration += 1
    rev.check_out_user_id = user_id
    rev.check_out_date = func.now()
    db.commit()
    return rev, None
```

- [ ] **Step 3: 添加签入/撤销签出/强制签入/升版/冻结/发布/作废函数**

参照 `crud_parts.py` 中对应函数：
- `checkin_config_item(db, revision_id, user_id, note)` → 记录 check_in_note，清除签出锁
- `undocheckout_config_item(db, revision_id, user_id)` → 删除最新迭代(-1)，清除签出锁
- `force_checkin_config_item(db, revision_id)` → 管理员清除签出锁
- `upgrade_config_item(db, revision_id, user_id)` → 生成新版本号，创建新 Revision(B/C/...)，自动签出
- `freeze_config_item(db, revision_id)` → draft→frozen
- `release_config_item(db, revision_id)` → frozen→released
- `obsolete_config_item(db, revision_id)` → released/frozen→obsolete

- [ ] **Step 4: 更新现有 CRUD 函数**

- `get_config_item()` → 改为 `get_config_item_revision(db, revision_id)` 返回 revision + 当前 iteration
- `get_config_item_list()` → 改为按 master 聚合，返回最新 revision 摘要
- `update_config_item()` → 改为更新 iteration 层字段（version_spec/version_remark/version_name/document_links），需签出校验

- [ ] **Step 5: 添加零部件/子构型项/文档关联的 CRUD（改为 iteration_id）**

```python
def add_part_to_iteration(db, iteration_id, part_type, part_id, is_required, quantity, sort_order):
def remove_part_from_iteration(db, link_id):
def add_child_to_iteration(db, parent_iteration_id, child_revision_id, is_required, quantity, sort_order):
def remove_child_from_iteration(db, link_id):
def add_document_to_iteration(db, iteration_id, document_id):
def remove_document_from_iteration(db, link_id):
```

- [ ] **Step 6: 验证（pytest）**

```powershell
cd backend; pytest tests/ -v -k "config" --tb=short
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/crud_configuration.py
git commit -m "feat: config item checkout/checkin/version CRUD functions"
```

---

### Task 3: API 路由 + Schema 重构

**Files:**
- Modify: `backend/app/routers/configuration.py`
- Modify: `backend/app/schemas_configuration.py`

**Interfaces:**
- Consumes: Task 2 的 CRUD 函数
- Produces: 重构后全部 /items 端点 + 新增签出端点

- [ ] **Step 1: 重写 schemas_configuration.py**

定义新的 Pydantic schemas：

```python
class ConfigItemCreate(BaseModel):
    code: str; name: str; spec: str = ""; remark: str = ""

class ConfigItemUpdate(BaseModel):
    spec: Optional[str] = None
    remark: Optional[str] = None
    name: Optional[str] = None

class ConfigItemCheckin(BaseModel):
    check_in_note: str = ""

class ConfigItemRevisionOut(BaseModel):
    id: str; master_id: str; version: str; status: str
    check_out_user_id: Optional[str]; check_out_user_name: Optional[str]
    check_out_date: Optional[str]; latest_iteration: int
    creator_id: Optional[str]; created_at: Optional[str]

class ConfigItemDetailOut(BaseModel):
    master: dict  # {id, code, name, spec, remark, creator_id, ...}
    revision: dict  # ConfigItemRevisionOut + current iteration data {iteration_id, spec, remark, name, document_links}
    parts: list; children: list; documents: list; versions: list
```

- [ ] **Step 2: 重写 /items CRUD 端点**

```python
@router.get("/items")
async def list_config_items(db, current_user, page, page_size, search, ...):
    """按 master 聚合，返回最新 revision 摘要"""
    # 查询 configuration_item_masters
    # JOIN configuration_item_revisions (latest version per master)
    # JOIN users (checkout user name)
    # 返回 {items: [{master_id, code, name, spec, version, status, check_out_user_id, check_out_user_name}], total}

@router.post("/items")
async def create_config_item(data: ConfigItemCreate, db, current_user):
    master, revision, iteration = crud.create_config_item(db, data.dict(), current_user.id)
    return {"id": str(revision.id), "master_id": str(master.id), "version": "A", ...}

@router.get("/items/{revision_id}")
async def get_config_item_detail(revision_id, db, current_user):
    """详情：master + revision + current iteration + parts + children + documents + versions"""
    # 返回 ConfigItemDetailOut

@router.put("/items/{revision_id}")
async def update_config_item(revision_id, data: ConfigItemUpdate, db, current_user):
    """更新迭代层数据（需签出校验）"""
    # 校验签出状态 → 423 if not checked out by current user
    # 更新 version_spec/version_remark/version_name

@router.delete("/items/{revision_id}")
async def delete_config_item(revision_id, db, current_user):
    """软删除 revision（需 permission configuration:delete）"""
```

- [ ] **Step 3: 添加签入签出版本操作端点**

```python
@router.post("/items/{revision_id}/checkout")
async def checkout_config_item(revision_id, db, current_user=Depends(require_permission("configuration:checkout"))):
    rev, err = crud.checkout_config_item(db, revision_id, current_user.id)
    if err: raise HTTPException(409 if "已被他人" in err else 400, detail=err)
    return {"ok": True}

@router.post("/items/{revision_id}/checkin")
async def checkin_config_item(revision_id, data: ConfigItemCheckin, db, current_user=Depends(require_permission("configuration:checkin"))):
    rev, err = crud.checkin_config_item(db, revision_id, current_user.id, data.check_in_note)
    if err: raise HTTPException(400, detail=err)
    return {"ok": True}

@router.post("/items/{revision_id}/undocheckout")
async def undocheckout_config_item(revision_id, db, current_user=Depends(require_permission("configuration:undocheckout"))):
    rev, err = crud.undocheckout_config_item(db, revision_id, current_user.id)
    if err: raise HTTPException(400, detail=err)
    return {"ok": True}

@router.post("/items/{revision_id}/force-checkin")
async def force_checkin_config_item(revision_id, db, current_user=Depends(require_permission("configuration:force_checkin"))):
    rev, err = crud.force_checkin_config_item(db, revision_id)
    if err: raise HTTPException(400, detail=err)
    return {"ok": True}

@router.post("/items/{revision_id}/upgrade")
async def upgrade_config_item(revision_id, db, current_user=Depends(require_permission("configuration:create"))):
    new_rev, err = crud.upgrade_config_item(db, revision_id, current_user.id)
    if err: raise HTTPException(400, detail=err)
    return {"id": str(new_rev.id), "version": new_rev.version}

@router.post("/items/{revision_id}/freeze")
async def freeze_config_item(revision_id, db, current_user=Depends(require_permission("configuration:update"))):
    rev, err = crud.freeze_config_item(db, revision_id)
    ...

@router.post("/items/{revision_id}/release")
async def release_config_item(revision_id, db, current_user=Depends(require_permission("configuration:update"))):
    ...

@router.post("/items/{revision_id}/obsolete")
async def obsolete_config_item(revision_id, db, current_user=Depends(require_permission("configuration:update"))):
    ...

@router.get("/items/{revision_id}/versions")
async def get_config_item_versions(revision_id, db, current_user):
    """版本历史列表"""
```

- [ ] **Step 4: 更新关联管理端点（改为 iteration_id）**

```python
@router.get("/items/{revision_id}/iterations/{iteration_id}/parts")
@router.post("/items/{revision_id}/iterations/{iteration_id}/parts")
@router.delete("/items/{revision_id}/iterations/{iteration_id}/parts/{part_link_id}")
# 同理 children, documents
```

- [ ] **Step 5: 更新配置概要端点**

`ConfigurationProfile.configuration_item_id` → `configuration_item_revision_id`:
- `POST /profiles` → body 接受 `configuration_item_revision_id`
- `GET /profiles/{id}` → 返回 revision_id
- `_build_config_tree()` → 适配新数据结构
- `preview-3d` → 适配

- [ ] **Step 6: 后端测试**

```powershell
cd backend; pytest tests/ -v -k "config" --tb=short
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/configuration.py backend/app/schemas_configuration.py backend/app/crud_configuration.py
git commit -m "feat: config item API rewrite with checkout/version endpoints"
```

---

### Task 4: 前端类型 + API service

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 更新 TypeScript 类型**

在 `types/index.ts` 中替换 `ConfigurationItem`，新增：

```typescript
export interface ConfigurationItemMaster {
  id: string; code: string; name: string; spec?: string; remark?: string;
  creator_id?: string; created_at?: string; updated_at?: string;
}

export interface ConfigurationItemRevision {
  id: string; master_id: string;
  version: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  check_out_user_id?: string; check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration: number;
  creator_id?: string; created_at?: string;
}

export interface ConfigurationItemDetail {
  master: ConfigurationItemMaster;
  revision: ConfigurationItemRevision & {
    iteration_id: string;
    spec?: string; remark?: string; name?: string;
    document_links?: any[];
  };
  parts: ConfigPartItem[];
  children: ConfigChildItem[];
  documents: any[];
  versions: ConfigurationItemRevision[];
}
```

- [ ] **Step 2: 更新 API service**

在 `api.ts` 中替换 `configurationApi`，新增：

```typescript
export const configurationApi = {
  list: (params?: Record<string, any>) =>
    api.get<{ items: ConfigurationItemRevision[]; total: number }>('/configurations/items', { params }).then(r => r.data),
  create: (data: { code: string; name: string; spec?: string; remark?: string }) =>
    api.post<{ id: string; master_id: string; version: string }>('/configurations/items', data).then(r => r.data),
  detail: (revisionId: string) =>
    api.get<ConfigurationItemDetail>(`/configurations/items/${revisionId}`).then(r => r.data),
  update: (revisionId: string, data: { spec?: string; remark?: string; name?: string }) =>
    api.put(`/configurations/items/${revisionId}`, data).then(r => r.data),
  delete: (revisionId: string) =>
    api.delete(`/configurations/items/${revisionId}`).then(r => r.data),
  checkout: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/checkout`).then(r => r.data),
  checkin: (revisionId: string, note: string) =>
    api.post(`/configurations/items/${revisionId}/checkin`, { check_in_note: note }).then(r => r.data),
  undocheckout: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/undocheckout`).then(r => r.data),
  forceCheckin: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/force-checkin`).then(r => r.data),
  upgrade: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/upgrade`).then(r => r.data),
  freeze: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/freeze`).then(r => r.data),
  release: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/release`).then(r => r.data),
  obsolete: (revisionId: string) =>
    api.post(`/configurations/items/${revisionId}/obsolete`).then(r => r.data),
  versions: (revisionId: string) =>
    api.get<ConfigurationItemRevision[]>(`/configurations/items/${revisionId}/versions`).then(r => r.data),
  updateMaster: (masterId: string, data: { code?: string; name?: string; spec?: string }) =>
    api.patch(`/configurations/items/${masterId}/master`, data).then(r => r.data),
};
```

- [ ] **Step 3: 验证编译**

```powershell
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: config item three-tier TypeScript types and API service"
```

---

### Task 5: ConfigItemDetailModal（重构）

**Files:**
- Create: `frontend/src/components/Configuration/ConfigItemDetailModal.tsx`
- (原 `ConfigurationDetailModal.tsx` 保留为历史，后续清理)

**UI 模式**: 完全参照 `PartDetailModal.tsx`

- [ ] **Step 1: 组件骨架**

创建新文件，参照 PartDetailModal 结构：

```tsx
export default function ConfigItemDetailModal({ revisionId, open, onClose }: Props) {
  const [detail, setDetail] = useState<ConfigurationItemDetail | null>(null);
  const [activeTab, setActiveTab] = useState('info');
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const canEdit = isCheckedOutByMe && isDraft;
  // ... canCheckout, canCheckin, canUndo, canFreeze, canRelease, canUpgrade, canObsolete, canForceCheckin

  // 加载数据
  useEffect(() => { if (open && revisionId) loadDetail(); }, [revisionId, open]);

  return (
    <Modal open={open} onClose={onClose} title="构型项详情" width="full">
      {/* 信息卡片网格 */}
      {/* 版本/状态/操作栏 */}
      {/* Tab 导航 */}
      {/* Tab 内容 */}
    </Modal>
  );
}
```

- [ ] **Step 2: 信息卡片网格**

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
  <InfoCard label="构型号" value={editCode} readonly={!canEdit}
    onChange={(v) => { setEditCode(v); autoSave({ code: v }); }} />
  <InfoCard label="中文名称" value={editName} readonly={!canEdit}
    onChange={(v) => { setEditName(v); autoSave({ name: v }); }} />
  <InfoCard label="规格型号" value={editSpec} readonly={!canEdit}
    onChange={(v) => { setEditSpec(v); autoSave({ spec: v }); }} />
  <InfoCard label="类型" value="构型项" readonly />
</div>
```

`InfoCard` 组件（内联或独立）：
```tsx
function InfoCard({ label, value, readonly, onChange }: { label: string; value: string; readonly: boolean; onChange?: (v: string) => void }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500">{label}</div>
      {readonly ? (
        <div className="text-sm text-gray-900 font-medium">{value || '—'}</div>
      ) : (
        <input value={value} onChange={(e) => onChange?.(e.target.value)}
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
      )}
    </div>
  );
}
```

自动保存函数（500ms 防抖）：
```typescript
const autoSave = (data: Record<string, string>) => {
  if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
  autoSaveRef.current = setTimeout(async () => {
    try {
      await configurationApi.updateMaster(detail!.master.id, data);
    } catch (e: any) { toast.error(e?.response?.data?.detail || '保存失败'); }
  }, 500);
};
```

- [ ] **Step 3: 版本/状态/操作栏**

```tsx
<div className="bg-white rounded-lg border border-gray-200 p-3 shrink-0 mb-3">
  <div className="flex items-center justify-between flex-wrap gap-2">
    <div className="flex items-center gap-3">
      <span className="font-semibold text-sm">版本：{revision?.version}</span>
      <span className={`px-2 py-1 text-xs rounded-full ${statusColor[revision?.status]}`}>
        {statusLabel[revision?.status]}
      </span>
      {isCheckedOut && (
        <span className="text-xs text-orange-600">
          已签出：{revision?.check_out_user_name || revision?.check_out_user_id}
        </span>
      )}
    </div>
    <div className="flex gap-1 flex-wrap items-center">
      {(canCheckout || canCheckin || canUndo || canFreeze || canRelease || canUpgrade || canObsolete || canForceCheckin) && (
        <span className="mx-1 text-gray-300 self-center select-none">|</span>
      )}
      {canCheckout && <button onClick={handleCheckout} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签出</button>}
      {canCheckin && <button onClick={handleCheckin} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签入</button>}
      {canUndo && <button onClick={handleUndo} className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>}
      {canFreeze && <button onClick={handleFreeze} className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>}
      {canRelease && <button onClick={handleRelease} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">发布</button>}
      {canUpgrade && <button onClick={handleUpgrade} className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>}
      {canObsolete && <button onClick={handleObsolete} className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>}
      {canForceCheckin && <button onClick={handleForceCheckin} className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>}
    </div>
  </div>
</div>
```

操作处理函数（inline 签入弹窗）：
```tsx
const [checkinOpen, setCheckinOpen] = useState(false);
const [checkinNote, setCheckinNote] = useState('');
const handleCheckin = async () => {
  await configurationApi.checkin(revisionId, checkinNote);
  setCheckinOpen(false); loadDetail();
};
// 签入弹窗: <Modal open={checkinOpen} title="签入说明"><textarea>...</Modal>
```

- [ ] **Step 4: Tab 导航 + 内容区**

```tsx
const tabs = [
  { key: 'info', label: '基本信息' },
  { key: 'parts', label: '关联零部件' },
  { key: 'children', label: '子构型项' },
  { key: 'docs', label: '关联图文档' },
  { key: 'versions', label: '版本历史' },
];
```

**基本信息 Tab**：备注 textarea（签出态可编辑）+ 创建信息

**关联零部件 Tab**：表格（件号/名称/版本/类型/必选/数量/操作），签出态显示添加/移除按钮

**子构型项 Tab**：表格（构型号/名称/必选/数量/操作），签出态显示添加/移除按钮

**关联图文档 Tab**：复用 `EntityDocumentSection`

**版本历史 Tab**：表格（版本号/状态/创建时间/切换），当前版本高亮 `bg-blue-50`

- [ ] **Step 5: 验证编译**

```powershell
cd frontend; npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Configuration/ConfigItemDetailModal.tsx
git commit -m "feat: ConfigItemDetailModal with checkout/version/tabs (PartDetailModal style)"
```

---

### Task 6: ConfigurationList + ConfigurationCreateModal 适配

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationList.tsx`
- Modify: `frontend/src/components/Configuration/ConfigurationCreateModal.tsx`

- [ ] **Step 1: ConfigurationList 适配新数据结构**

- 新增「当前版本」列、「签出状态」列（显示签出者姓名或 "—"）
- 「编辑」按钮改为「详情」（打开 ConfigItemDetailModal）
- API 调用从 `configurationApi.list()` 改为使用新接口（返回 `{ items: ConfigurationItemRevision[], total }`）
- 移除对旧 `ConfigurationItem` 类型的引用

- [ ] **Step 2: ConfigurationCreateModal 适配**

- 创建后 `onSuccess` 回调传递 `{ revisionId, masterId, ... }`
- 创建成功后可在列表刷新，无需打开详情弹窗

- [ ] **Step 3: Configuration.tsx 页面适配**

- `showDetail` 状态改为 `selectedRevisionId: string | null`
- 传递给 `ConfigItemDetailModal`

- [ ] **Step 4: 配置概要相关组件适配**

`ProfileEditModal` / `ConfigItemPicker` 中引用 `configuration_item_id` 的地方改为 `configuration_item_revision_id`。

- [ ] **Step 5: 验证编译 + 构建**

```powershell
cd frontend; npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Configuration/ConfigurationList.tsx frontend/src/components/Configuration/ConfigurationCreateModal.tsx frontend/src/pages/Configuration.tsx
git commit -m "feat: adapt ConfigurationList and CreateModal for three-tier model"
```

---

### Task 7: 权限生成 + 最终验证

**Files:**
- Modify: `permissions/permissions.json`

- [ ] **Step 1: 添加新权限**

在 `permissions/permissions.json` 中添加：

```json
"configuration:checkout": {"description": "签出构型项", "roles": ["admin", "engineer"]},
"configuration:checkin": {"description": "签入构型项", "roles": ["admin", "engineer"]},
"configuration:undocheckout": {"description": "撤销签出构型项", "roles": ["admin", "engineer"]},
"configuration:force_checkin": {"description": "强制签入构型项", "roles": ["admin"]}
```

- [ ] **Step 2: 生成权限代码**

```powershell
python tools/gen_permissions.py
```

- [ ] **Step 3: 完整构建 + 部署**

```powershell
cd frontend; npm run build
docker-compose up -d --force-recreate nginx
docker restart bom_backend
```

- [ ] **Step 4: 端到端验证**

1. 打开构型项列表 → 显示版本列和签出状态列 ✓
2. 新建构型项 → 创建成功，自动签出 ✓
3. 点击详情 → 信息卡片可编辑 ✓
4. 签入 → 锁释放，表单只读 ✓
5. 他人签出 → 表单只读，显示签出者 ✓
6. 升版 → 新版本 B 创建 ✓
7. 冻结/发布/作废 → 状态变更 ✓
8. 配置概要列表正常 ✓

- [ ] **Step 5: Commit**

```bash
git add permissions/permissions.json
git commit -m "feat: add config item checkout permissions"
```

---

## 验证清单

全部 Task 完成后：
1. `cd frontend; npm run build` 通过
2. 后端启动无错误（新表创建成功）
3. 旧数据迁移完整（原构型项可访问）
4. 签出/签入/撤销/升版/冻结/发布/作废 全流程正常
5. 配置概要（Profile）功能不受影响
6. 3D 预览功能不受影响
