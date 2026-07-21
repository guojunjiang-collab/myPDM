# 构型配置 3D 预览 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在构型配置详情页添加「3D 预览」按钮，新标签页中以统一 3D 场景展示正式配置清单中所有零部件的 STP 模型（单位矩阵、同坐标系）。

**Architecture:** 后端新增 `GET /api/configurations/profiles/{id}/preview-3d` 收集配置清单零件 → 查对应版本 STP 附件 → 生成 gltf URLs；前端扩展现有 `/stp-viewer` 路由支持 `?config-profile=` 参数，复用 `AssemblyModelLoader` 渲染（`applyZUp=false`，因单件 GLB 已是 Y-up）。

**Tech Stack:** Python/FastAPI/SQLAlchemy（后端），React Three Fiber / Three.js（前端）

**Spec:** `docs/superpowers/specs/2026-07-21-config-profile-3d-preview-design.md`

## Global Constraints

- 复用现有 `AssemblyModelLoader`、`ViewerCanvas`、`STPViewer` 页面组件，最小化新代码
- 后端权限 `profile:read`（与配置详情一致）
- 前端沿用现有 Tailwind CSS 样式风格
- 不改动现有装配体/单件预览流程
- 不改动公共 Modal 组件

---

### Task 1: 后端 — 新增 preview-3d 端点

**Files:**
- Modify: `backend/app/routers/configuration.py`（在 `get_profile` 之后添加新端点）

**Interfaces:**
- Produces: `GET /api/configurations/profiles/{profile_id}/preview-3d` → `ConfigProfilePreviewResponse`
  ```json
  {
    "profile_code": "str", "profile_name": "str",
    "total_count": int, "loaded_count": int,
    "instances": [{ "part_code": str, "part_name": str, "version": str, "revision_id": str, "glb_urls": { "coarse","normal","fine" }, "matrix": [16 floats] }],
    "missing": [{ "part_code": str, "part_name": str, "version": str }],
    "tree": [{ "bom_item_id": str, "part_code": str, "part_name": str, "version": str, "quantity": int, "instance_count": int, "is_leaf": bool, "children": [] }]
  }
  ```

- [ ] **Step 1: 在 imports 中添加缺失的模块引用**

在 `configuration.py` 顶部添加：

```python
# 在 from app import crud as core_crud 下面追加
from app.models_parts import PartIteration, PartAttachment
from app.stp_converter import is_stp_file
from app.media_token import mint_media_token
import os as _os
import logging
_logger = logging.getLogger(__name__)
```

- [ ] **Step 2: 添加辅助函数 `_resolve_part_stp_attachment`**

在文件末尾、`_build_config_tree` 函数之后添加：

```python
def _resolve_part_stp_attachment(db: Session, master_id: str, version: str) -> dict | None:
    """按 (master_id, version) 查找零部件 STP 附件，返回 glb_urls 或 None"""
    from uuid import UUID
    from app.crud_parts import get_part_revision
    from app.stp_converter import get_lod_glb_paths, get_glb_cache_path

    rev = db.query(PartRevision).filter(
        PartRevision.master_id == UUID(master_id),
        PartRevision.version == version,
        PartRevision.deleted_at.is_(None),
    ).first()
    if not rev:
        return None

    iteration = db.query(PartIteration).filter(
        PartIteration.revision_id == rev.id,
        PartIteration.iteration == rev.latest_iteration,
    ).first()
    if not iteration:
        return None

    atts = db.query(PartAttachment).filter(
        PartAttachment.iteration_id == iteration.id,
    ).all()
    att = next((a for a in atts if is_stp_file(a.file_name) and a.category == 'production'), None)
    if not att:
        att = next((a for a in atts if is_stp_file(a.file_name)), None)
    if not att:
        return None

    token = mint_media_token(str(att.id), "gltf", ttl=3600)
    paths = get_lod_glb_paths(str(att.id), att.file_path, is_part=True)
    glb_base = get_glb_cache_path(str(att.id), att.file_path, is_part=True)
    has_lod = all(_os.path.exists(p) for p in paths.values())
    urls = {}
    if has_lod:
        for tier, p in paths.items():
            urls[tier] = f"/api/parts/attachments/{att.id}/lod/{tier}?token={token}"
    elif _os.path.exists(glb_base):
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback
    else:
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback

    return {
        "revision_id": str(rev.id),
        "glb_urls": urls,
    }
```

- [ ] **Step 3: 添加辅助函数 `_collect_config_profile_parts`**

在 `_resolve_part_stp_attachment` 之后添加：

```python
def _collect_config_profile_parts(config_tree: dict) -> list[dict]:
    """递归遍历 config_tree，收集所有选中零部件（跳过构型项行）"""
    parts = []

    def walk(node: dict):
        if not node:
            return
        for p in node.get("parts", []):
            if p.get("is_selected") and p.get("item_type") != "config_item":
                parts.append({
                    "item_id": p.get("item_id"),
                    "item_code": p.get("item_code"),
                    "item_name": p.get("item_name"),
                    "item_version": p.get("item_version"),
                })
        for child in node.get("children", []):
            if child.get("is_selected"):
                walk(child)

    walk(config_tree)
    return parts
```

- [ ] **Step 4: 添加路由端点**

在 `get_profile` 函数之后（约第 595 行）添加：

```python
@router.get("/profiles/{profile_id}/preview-3d", response_model=dict)
async def get_profile_3d_preview(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置清单3D预览数据：收集所有选中零部件的STP模型"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if not profile.configuration_item_id:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    working_items = crud.get_working_items(db, profile_id)
    entity_map = _build_entity_map(db, working_items)
    config_tree = _build_config_tree(db, str(profile.configuration_item_id), working_items, entity_map)

    parts = _collect_config_profile_parts(config_tree)
    if not parts:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    instances = []
    missing = []
    identity_matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    for idx, p in enumerate(parts):
        ver = (p.get("item_version") or "").strip()
        if not ver:
            # fallback: 取最新版本
            from app.crud_parts import list_revisions_by_master
            revs = list_revisions_by_master(db, UUID(p["item_id"]))
            if revs:
                ver = revs[-1].version
            else:
                missing.append({
                    "part_code": p["item_code"],
                    "part_name": p["item_name"],
                    "version": "",
                })
                continue

        result = _resolve_part_stp_attachment(db, p["item_id"], ver)
        if result and result.get("glb_urls"):
            instances.append({
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
                "revision_id": result["revision_id"],
                "glb_urls": result["glb_urls"],
                "matrix": identity_matrix,
            })
        else:
            missing.append({
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
            })

    # 构建扁平树：仅包含有模型的零部件（与 AssemblyTreeNode 兼容）
    tree = []
    for idx, inst in enumerate(instances):
        tree.append({
            "bom_item_id": f"instance-{idx}",
            "part_code": inst["part_code"],
            "part_name": inst["part_name"],
            "version": inst["version"],
            "quantity": 1,
            "instance_count": 1,
            "is_leaf": True,
            "children": [],
        })

    return {
        "profile_code": profile.code,
        "profile_name": profile.name,
        "total_count": len(parts),
        "loaded_count": len(instances),
        "instances": instances,
        "missing": missing,
        "tree": tree,
    }
```

- [ ] **Step 5: 重启后端验证**

```powershell
docker restart bom_backend
```
验证：`curl https://localhost:8080/api/configurations/profiles/{valid_id}/preview-3d`（需带 JWT），返回结构含 `instances` + `tree`。

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/configuration.py
git commit -m "feat: add config profile 3D preview endpoint"
```

---

### Task 2: 前端 — API 类型与服务函数

**Files:**
- Modify: `frontend/src/services/api.ts`（在 `configurationProfileApi` 附近追加）

**Interfaces:**
- Produces: `ConfigProfilePreviewData` 类型, `configurationProfileApi.preview3d()` 函数

- [ ] **Step 1: 添加类型定义**

在 `api.ts` 中 `export const configurationProfileApi` 之前添加：

```typescript
export interface ConfigProfilePreviewData {
  profile_code: string;
  profile_name: string;
  total_count: number;
  loaded_count: number;
  instances: AssemblyInstance[];
  missing: { part_code: string; part_name: string; version: string }[];
  tree: AssemblyTreeNode[];
}
```

- [ ] **Step 2: 添加服务函数**

在 `configurationProfileApi` 对象内（约第 760 行）添加：

```typescript
preview3d: (profileId: string) =>
  api.get<ConfigProfilePreviewData>(`/configurations/profiles/${profileId}/preview-3d`).then((r) => r.data),
```

- [ ] **Step 3: 验证编译**

```powershell
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add config profile 3D preview API types and service"
```

---

### Task 3: 前端 — AssemblyModelLoader 添加 `applyZUp` prop

**Files:**
- Modify: `frontend/src/components/STPViewer/ViewerCanvas.tsx:17-19,42-44,77`
- Modify: `frontend/src/components/STPViewer/AssemblyModelLoader.tsx:48,50-53,76`

**Interfaces:**
- Consumes: 无
- Produces: `AssemblyModelLoader` 新增可选 prop `applyZUp?: boolean`（默认 `true`）；`ViewerSource` 的 `kind: 'assembly'` 分支新增 `applyZUp?: boolean`；`ViewerCanvas` 传递 `source.applyZUp`

- [ ] **Step 1: 修改 AssemblyModelLoader 接受 applyZUp prop**

`AssemblyModelLoader.tsx` 第 50 行附近，修改 Props 和组件逻辑：

```typescript
interface Props {
  instances: AssemblyInstance[];
  tree: AssemblyTreeNode[];
  applyZUp?: boolean; // 新增
}

export function AssemblyModelLoader({ instances, tree, applyZUp = true }: Props) {
  // ... useEffect 中第 76 行，改为条件应用:
  rootGroup.matrixAutoUpdate = false;
  if (applyZUp) {
    rootGroup.matrix.copy(Z_UP_TO_Y_UP);
  } else {
    rootGroup.matrix.identity();
  }
```

- [ ] **Step 2: 修改 ViewerSource 类型**

`ViewerCanvas.tsx` 第 17-19 行，扩展 `kind: 'assembly'` 分支：

```typescript
export type ViewerSource =
  | { kind: 'single'; url: string; code?: string; version?: string; name?: string }
  | { kind: 'assembly'; instances: AssemblyInstance[]; tree: AssemblyTreeNode[]; applyZUp?: boolean };
```

- [ ] **Step 3: 修改 ViewerCanvas 传递 applyZUp**

`ViewerCanvas.tsx` 第 77 行：

```tsx
<AssemblyModelLoader instances={source.instances} tree={source.tree} applyZUp={source.applyZUp ?? true} />
```

- [ ] **Step 4: 验证编译**

```powershell
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/STPViewer/AssemblyModelLoader.tsx frontend/src/components/STPViewer/ViewerCanvas.tsx
git commit -m "feat: add applyZUp prop to AssemblyModelLoader for non-assembly multi-model scenes"
```

---

### Task 4: 前端 — STPViewer 扩展 config-profile 模式

**Files:**
- Modify: `frontend/src/pages/STPViewer.tsx`

**Interfaces:**
- Consumes: `configurationProfileApi.preview3d()`, `ConfigProfilePreviewData`（Task 2）
- Produces: URL 参数 `?config-profile={profileId}` → 3D 场景渲染

**设计决策**：`tree` 仅包含有模型的零部件（后端已过滤），模型树面板无需修改。缺失零件通过 Toast 提示，不在模型树中显示。

- [ ] **Step 1: 添加 imports**

在 `STPViewer.tsx` 第 8 行（`assemblyViewerApi` 导入之后）追加：

```typescript
import { configurationProfileApi, type ConfigProfilePreviewData } from '../services/api';
import { toast } from '../components/Toast';
```

- [ ] **Step 2: 添加 URL 参数和状态变量**

在第 23 行（`params` 获取之后）添加 URL 参数：

```typescript
const configProfileId = params.get('config-profile');
```

在第 29 行（`asmError` 状态之后）添加 config 相关状态：

```typescript
const [configPreviewData, setConfigPreviewData] = useState<ConfigProfilePreviewData | null>(null);
const [configPreviewTitle, setConfigPreviewTitle] = useState('');
```

- [ ] **Step 3: 添加 config-profile 数据加载逻辑**

在 `useEffect`（第 46 行）中，现有 `if (assemblyRevId)` 分支的 `return;` 之后、`const id = params.get('id');` 之前，插入：

```typescript
if (configProfileId) {
  configurationProfileApi.preview3d(configProfileId)
    .then((data) => {
      setConfigPreviewData(data);
      setConfigPreviewTitle(`${data.profile_name}（${data.profile_code}）`);
      setState('ready');
      if (data.total_count > data.loaded_count) {
        setTimeout(() => {
          toast.info(`共 ${data.total_count} 个零部件，已加载 ${data.loaded_count} 个3D模型`, 5000);
        }, 800);
      }
    })
    .catch(() => { setState('error'); });
  return;
}
```

- [ ] **Step 4: 扩展 state 类型以包含 'loading-config'**

在 `useState<'checking' | 'converting' | 'loading' | 'ready' | 'error'>` 的类型联合中添加 `'loading-config'`，并在 useEffect 的 config 分支开头设置 `setState('loading-config')`。

完整修改（约第 12 行）：

```typescript
const [state, setState] = useState<'checking' | 'converting' | 'loading' | 'loading-config' | 'ready' | 'error'>('checking');
```

并在 config 分支 `configurationProfileApi.preview3d(...)` 调用前添加：

```typescript
setState('loading-config');
```

- [ ] **Step 5: 修改渲染区加载提示以支持 'loading-config' 状态**

在现有加载态渲染中（约第 112 行），在 `state === 'loading'` 分支旁添加 `state === 'loading-config'`：

```tsx
{state === 'loading-config' && (
  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-gray-900/20 backdrop-blur-sm">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-3" />
    <p className="text-sm text-white">正在加载配置清单3D模型...</p>
  </div>
)}
```

- [ ] **Step 6: 渲染 config-profile 模式的标题信息**

在 `return` 语句顶部（第 100 行附近），状态背景层之前，添加标题浮层：

```tsx
{configProfileId && configPreviewData && (
  <div className="absolute top-3 left-4 z-20 bg-white/85 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm font-medium shadow border border-gray-200 pointer-events-none select-none">
    配置清单 3D 预览 — {configPreviewTitle}（{configPreviewData.instances.length}/{configPreviewData.total_count} 个模型）
  </div>
)}
```

- [ ] **Step 7: 渲染 config-profile 模式的 ViewerCanvas**

在现有 `<ViewerCanvas` 渲染处（`assemblyRevId` 分支之后），添加 config-profile 分支。参照现有结构，在条件链中插入：

找到现有渲染 ViewerCanvas 的条件判断（约第 135-145 行），在该 `{...}` 块的条件中添加 config-profile 支持。当前结构大致为：

```tsx
{(state === 'ready' || state === 'loading') && (() => {
  if (assemblyRevId && asmInstances) return <ViewerCanvas source={{ kind: 'assembly', instances: asmInstances, tree: asmTree }} />;
  if (url) return <ViewerCanvas source={{ kind: 'single', url, code: partCode, version: partVersion, name: partName }} />;
  return null;
})()}
```

修改为追加 config-profile 分支：

```tsx
{(state === 'ready' || state === 'loading') && (() => {
  if (configProfileId && configPreviewData) return <ViewerCanvas source={{ kind: 'assembly', instances: configPreviewData.instances, tree: configPreviewData.tree, applyZUp: false }} />;
  if (assemblyRevId && asmInstances) return <ViewerCanvas source={{ kind: 'assembly', instances: asmInstances, tree: asmTree }} />;
  if (url) return <ViewerCanvas source={{ kind: 'single', url, code: partCode, version: partVersion, name: partName }} />;
  return null;
})()}
```

同时修改模型中树面板的显示条件（约第 152 行），让 config-profile 模式也显示模型树：

```tsx
{(asmTree.length > 0 || (configPreviewData && configPreviewData.tree.length > 0)) && (
  <ModelTreePanel width={treeWidth} onResizeDown={onResizeDown} />
)}
```

- [ ] **Step 8: 构建并验证**

```powershell
cd frontend; npm run build
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/STPViewer.tsx
git commit -m "feat: add config-profile 3D preview mode to STPViewer"
```

---

### Task 5: 前端 — ProfileEditModal 添加「3D 预览」按钮

**Files:**
- Modify: `frontend/src/components/Configuration/ProfileEditModal.tsx`

- [ ] **Step 1: 添加按钮**

在 `headerAction` 渲染区（约第 660 行），「导出PDF」按钮之后添加：

```tsx
<button
  type="button"
  onClick={() => {
    window.open(`/stp-viewer?config-profile=${profile.id}`, '_blank');
  }}
  className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700"
  title="在新标签页中3D预览配置清单中所有零部件"
>
  🧊 3D预览
</button>
```

- [ ] **Step 2: 构建并验证**

```powershell
cd frontend; npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Configuration/ProfileEditModal.tsx
git commit -m "feat: add 3D preview button to config profile detail"
```

---

## 验证清单

全部 Task 完成后执行：

1. `cd frontend; npm run build` 通过
2. 打开有多个零部件（部分含 STP 附件）的构型配置详情页 → 点「3D 预览」
3. 新标签页打开 STPViewer，顶部显示配置名称 + 零部件数量
4. 有 STP 附件的零部件正确渲染在同一 3D 场景中
5. 旋转/缩放/点击高亮等功能正常
6. 无 STP 附件的零部件提示出现在 Toast 中
7. guest 角色看不到按钮、API 返回 403
