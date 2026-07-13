# CAD文件夹导入功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在零部件详情弹窗中支持以文件夹形式批量导入CAD附件，自动按件号匹配BOM树中所有子孙零部件并上传。

**Architecture:** 前后端协作方案 — 后端负责BOM树递归遍历和文件匹配，返回匹配预览；前端负责文件选择、预览弹窗和逐文件上传。在现有上传API增加 `overwrite` 参数处理覆盖逻辑。

**Tech Stack:** FastAPI + SQLAlchemy (后端), React 18 + TypeScript + Tailwind CSS (前端)

**Source spec:** `docs/superpowers/specs/2026-07-13-cad-folder-import-design.md`

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| Modify | `backend/app/schemas_parts.py` |
| Modify | `backend/app/crud_parts.py` |
| Modify | `backend/app/routers/parts.py` |
| Modify | `frontend/src/types/index.ts` |
| Modify | `frontend/src/services/api.ts` |
| **Create** | `frontend/src/components/CadImportPreviewModal.tsx` |
| Modify | `frontend/src/components/PartDetailModal.tsx` |

---

### Task 1: 后端 Schema — 添加导入预览的数据模型

**文件:** `backend/app/schemas_parts.py`

- [ ] **Step 1: 在文件末尾添加 Schema 类**

在 `schemas_parts.py` 文件末尾（第 181 行后）添加：

```python
# ===== CAD 文件夹导入预览 =====

class CadImportPreviewRequest(BaseModel):
    file_names: List[str]


class MatchedFileItem(BaseModel):
    file_name: str
    code: str
    name: str
    revision_id: str
    revision_version: str
    iteration_id: str
    existing_count: int
    can_upload: bool
    block_reason: Optional[str] = None


class CadImportPreviewResponse(BaseModel):
    matched: List[MatchedFileItem]
    unmatched: List[str]
    summary: dict
```

- [ ] **Step 2: 验证导入无报错**

```powershell
docker exec bom_backend python -c "from app.schemas_parts import CadImportPreviewRequest, MatchedFileItem, CadImportPreviewResponse; print('OK')"
```

- [ ] **Step 3: 提交**

```powershell
git add backend/app/schemas_parts.py; git commit -m "feat: 添加CAD导入预览Schema"
```

---

### Task 2: 后端 CRUD — 实现BOM子孙遍历和匹配逻辑

**文件:** `backend/app/crud_parts.py`

- [ ] **Step 1: 添加 `get_bom_descendants()` 函数**

在 `collect_bom_attachments` 函数之后（第 792 行左右），`# ====== BOM 操作 ======` 注释之前，添加：

```python
def get_bom_descendants(db: Session, revision_id: UUID) -> List[Dict[str, Any]]:
    """递归遍历BOM树，返回所有子孙零部件的展开清单（广度优先，按revision_id去重）"""
    from .. import models_parts as mp
    result: List[Dict[str, Any]] = []
    seen: set = set()
    queue = [revision_id]

    while queue:
        rid = queue.pop(0)
        if rid in seen:
            continue
        seen.add(rid)
        rev = get_part_revision(db, rid)
        if not rev:
            continue
        master = get_part_master(db, rev.master_id)
        if not master:
            continue
        it = _current_iteration(db, rid)
        result.append({
            "code": master.code,
            "name": master.name,
            "revision_id": str(rev.id),
            "revision_version": rev.version,
            "iteration_id": str(it.id) if it else None,
            "check_out_user_id": str(rev.check_out_user_id) if rev.check_out_user_id else None,
        })
        # 查询子项并入队
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rid,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            if bom.child_revision_id not in seen:
                queue.append(bom.child_revision_id)

    return result


def match_cad_files(
    db: Session,
    revision_id: UUID,
    file_names: List[str],
    current_user_id: UUID,
) -> Dict[str, Any]:
    """
    匹配文件夹文件名到BOM树零部件:
    1. 获取BOM子孙件列表
    2. 建立 code -> component_info 映射
    3. 遍历 file_names，去扩展名后匹配
    4. 对每个命中项检查签出状态、已有附件
    """
    from .. import models_parts as mp
    from ..schemas_parts import CadImportPreviewResponse, MatchedFileItem

    descendants = get_bom_descendants(db, revision_id)
    code_map: Dict[str, dict] = {}
    for item in descendants:
        code_map[item["code"]] = item

    matched: List[dict] = []
    unmatched: List[str] = []
    will_overwrite_count = 0
    blocked_count = 0

    for fname in file_names:
        # 去扩展名获取件号
        base = fname.rsplit(".", 1)[0] if "." in fname else fname
        info = code_map.get(base)

        if info is None:
            unmatched.append(fname)
            continue

        # 检查已有附件
        existing_count = 0
        if info.get("iteration_id"):
            existing_count = (
                db.query(mp.PartAttachment)
                .filter(
                    mp.PartAttachment.iteration_id == UUID(info["iteration_id"]),
                    mp.PartAttachment.category == "cad",
                    mp.PartAttachment.file_name == fname,
                )
                .count()
            )

        # 检查签出状态
        can_upload = True
        block_reason = None
        if info.get("check_out_user_id") != str(current_user_id):
            can_upload = False
            block_reason = "未签出"

        if can_upload and existing_count > 0:
            will_overwrite_count += 1
        if not can_upload:
            blocked_count += 1

        matched.append(MatchedFileItem(
            file_name=fname,
            code=info["code"],
            name=info["name"],
            revision_id=info["revision_id"],
            revision_version=info["revision_version"],
            iteration_id=info["iteration_id"] or "",
            existing_count=existing_count,
            can_upload=can_upload,
            block_reason=block_reason,
        ))

    return {
        "matched": matched,
        "unmatched": unmatched,
        "summary": {
            "total_files": len(file_names),
            "matched_count": len(matched),
            "unmatched_count": len(unmatched),
            "will_overwrite_count": will_overwrite_count,
            "blocked_count": blocked_count,
        },
    }
```

- [ ] **Step 2: 验证导入无报错**

```powershell
docker exec bom_backend python -c "from app.crud_parts import get_bom_descendants, match_cad_files; print('OK')"
```

- [ ] **Step 3: 提交**

```powershell
git add backend/app/crud_parts.py; git commit -m "feat: 添加BOM子孙遍历和CAD文件匹配逻辑"
```

---

### Task 3: 后端路由 — 添加导入预览端点 + 覆盖上传支持

**文件:** `backend/app/routers/parts.py`

- [ ] **Step 1: 导入新增的Schema**

在文件顶部导入区域（第 21 行 `from ..schemas_parts import MatchReport...` 之后），添加：

```python
from ..schemas_parts import CadImportPreviewRequest, CadImportPreviewResponse
```

- [ ] **Step 2: 添加 `cad/import-preview` 端点**

在 `import-assembly-step` 端点之前（第 1054 行附近），添加：

```python
@router.post("/revisions/{revision_id}/cad/import-preview", response_model=CadImportPreviewResponse)
def cad_import_preview(
    revision_id: UUID,
    body: CadImportPreviewRequest,
    current_user: User = Depends(require_permission("parts:update")),
    db: Session = Depends(get_db),
):
    """CAD文件夹导入预览：匹配文件名到BOM树零部件"""
    result = crud_parts.match_cad_files(
        db=db,
        revision_id=revision_id,
        file_names=body.file_names,
        current_user_id=current_user.id,
    )
    return CadImportPreviewResponse(**result)
```

- [ ] **Step 3: 修改 `add_attachment` 端点支持 `overwrite`**

在现有的 `add_attachment` 函数（第 852-862 行），添加 `overwrite` 参数：

修改前：
```python
@router.post("/revisions/{revision_id}/attachments")
async def add_attachment(
    revision_id: UUID,
    file: UploadFile = File(...),
    category: str = Form("cad"),
    db: Session = Depends(get_db),
):
    """上传附件到当前迭代（整包，适用于小文件）"""
    content = await file.read()
    att = _store_part_attachment(db, revision_id, file.filename, content, category)
    return {"id": str(att.id), "file_name": att.file_name, "file_size": att.file_size}
```

修改后：
```python
@router.post("/revisions/{revision_id}/attachments")
async def add_attachment(
    revision_id: UUID,
    file: UploadFile = File(...),
    category: str = Form("cad"),
    overwrite: bool = Form(False),
    db: Session = Depends(get_db),
):
    """上传附件到当前迭代（整包，适用于小文件）"""
    content = await file.read()
    if overwrite:
        _delete_existing_attachment(db, revision_id, file.filename, category)
    att = _store_part_attachment(db, revision_id, file.filename, content, category)
    return {"id": str(att.id), "file_name": att.file_name, "file_size": att.file_size}
```

同时在 `_store_part_attachment` 函数之前（第 795 行之前），添加辅助函数：

```python
def _delete_existing_attachment(db: Session, revision_id: UUID, filename: str, category: str):
    """覆盖模式：删除指定版本当前迭代下同名同类的旧附件"""
    import os
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        return
    _revision, iteration = result
    if not iteration:
        return
    existing = (
        db.query(crud_parts.models_parts.PartAttachment)
        .filter(
            crud_parts.models_parts.PartAttachment.iteration_id == iteration.id,
            crud_parts.models_parts.PartAttachment.category == category,
            crud_parts.models_parts.PartAttachment.file_name == filename,
        )
        .all()
    )
    for att in existing:
        if att.file_path and os.path.exists(att.file_path):
            os.remove(att.file_path)
        db.delete(att)
    if existing:
        db.commit()
```

- [ ] **Step 4: 重启后端并验证端点**

```powershell
docker restart bom_backend
Start-Sleep -Seconds 5
# 验证新端点可到达
curl -k -X POST "https://localhost:8080/api/parts/revisions/test/cad/import-preview" -H "Content-Type: application/json" -d '{"file_names":["test.stp"]}'
```

- [ ] **Step 5: 提交**

```powershell
git add backend/app/routers/parts.py; git commit -m "feat: 添加CAD导入预览端点和覆盖上传支持"
```

---

### Task 4: 前端类型定义

**文件:** `frontend/src/types/index.ts`

- [ ] **Step 1: 在 `PartAttachment` 类型之后添加新类型**

在第 130 行 `PartAttachment` 接口结束后添加：

```typescript
export interface CadImportPreviewRequest {
  file_names: string[];
}

export interface MatchedFileItem {
  file_name: string;
  code: string;
  name: string;
  revision_id: string;
  revision_version: string;
  iteration_id: string;
  existing_count: number;
  can_upload: boolean;
  block_reason: string | null;
}

export interface CadImportPreviewResponse {
  matched: MatchedFileItem[];
  unmatched: string[];
  summary: {
    total_files: number;
    matched_count: number;
    unmatched_count: number;
    will_overwrite_count: number;
    blocked_count: number;
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```powershell
cd frontend; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 10
```

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/types/index.ts; git commit -m "feat: 添加CAD导入预览前端类型定义"
```

---

### Task 5: 前端 API 客户端

**文件:** `frontend/src/services/api.ts`

- [ ] **Step 1: 在 `partsApi` 中添加 `cadImportPreview` 方法**

在 `partsApi` 对象中（第 178 行 `})` 之前），添加：

```typescript
  // CAD 文件夹导入
  cadImportPreview: (revisionId: string, fileNames: string[]) =>
    api.post(`/parts/revisions/${revisionId}/cad/import-preview`, { file_names: fileNames }).then((r) => r.data),
```

- [ ] **Step 2: 在现有附件上传调用中支持 `overwrite`**

无需修改 `PartAttachmentBucket.tsx` 本身的 API 调用，因为批量导入会直接在 `CadImportPreviewModal` 中通过 `FormData` 调用：

```typescript
// 在 CadImportPreviewModal 上传逻辑中:
const formData = new FormData();
formData.append('file', file);
formData.append('category', 'cad');
formData.append('overwrite', 'true');
await api.post(`/parts/revisions/${revisionId}/attachments`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```

- [ ] **Step 3: 验证编译**

```powershell
cd frontend; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 10
```

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/services/api.ts; git commit -m "feat: 添加CAD导入预览API方法"
```

---

### Task 6: 前端 — CadImportPreviewModal 组件

**文件:** Create `frontend/src/components/CadImportPreviewModal.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from 'react';
import { Modal } from './Modal';
import { toast } from './Toast';
import api from '../services/api';
import type { MatchedFileItem } from '../types';

interface Props {
  open: boolean;
  items: MatchedFileItem[];
  unmatched: string[];
  summary: { total_files: number; matched_count: number; unmatched_count: number; will_overwrite_count: number; blocked_count: number };
  revisionId: string;
  onClose: () => void;
  onComplete: () => void;
}

const statusConfig: Record<string, { label: string; cls: string }> = {
  matched: { label: '匹配', cls: 'text-green-600' },
  overwrite: { label: '覆盖', cls: 'text-yellow-600' },
  blocked: { label: '未签出', cls: 'text-red-600' },
  unmatched: { label: '未匹配', cls: 'text-gray-400' },
};

function getItemStatus(item: MatchedFileItem): keyof typeof statusConfig {
  if (!item.can_upload) return 'blocked';
  if (item.existing_count > 0) return 'overwrite';
  return 'matched';
}

export default function CadImportPreviewModal({ open, items, unmatched, summary, revisionId, onClose, onComplete }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '' });

  const uploadableItems = items.filter((i) => i.can_upload);
  const blockedItems = items.filter((i) => !i.can_upload);

  const handleImport = async () => {
    setUploading(true);
    onComplete();
  };

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">导入CAD附件 - 匹配预览</h2>

        <div className="flex gap-4 mb-4 text-sm">
          <span className="text-gray-500">文件夹文件总数: <b>{summary.total_files}</b></span>
          <span className="text-green-600">匹配: <b>{summary.matched_count}</b></span>
          <span className="text-gray-400">未匹配: <b>{summary.unmatched_count}</b></span>
          <span className="text-yellow-600">将覆盖: <b>{summary.will_overwrite_count}</b></span>
          <span className="text-red-600">不可上传: <b>{summary.blocked_count}</b></span>
        </div>

        <div className="max-h-80 overflow-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">文件名</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">零部件</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">件号</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => {
                const status = getItemStatus(item);
                const sc = statusConfig[status];
                return (
                  <tr key={`${item.revision_id}-${item.file_name}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-700">{item.file_name}</td>
                    <td className="px-3 py-2 text-gray-700">{item.name}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{item.code}</td>
                    <td className={`px-3 py-2 text-center ${sc.cls}`}>
                      {status === 'blocked' ? `⚠ ${item.block_reason}` : sc.label}
                    </td>
                  </tr>
                );
              })}
              {unmatched.map((fname) => (
                <tr key={fname} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-400">{fname}</td>
                  <td className="px-3 py-2 text-gray-400">—</td>
                  <td className="px-3 py-2 text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">未匹配</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-sm text-gray-500">
          {blockedItems.length > 0 && (
            <p className="text-red-600 mb-1">已过滤 {blockedItems.length} 个不可上传项（未签出），将上传 {uploadableItems.length} 个文件</p>
          )}
          {uploadableItems.length === 0 && (
            <p className="text-gray-400">没有可上传的文件</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">取消</button>
          {uploadableItems.length > 0 && (
            <button
              onClick={handleImport}
              disabled={uploading}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
            >
              确认导入
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证编译**

```powershell
cd frontend; npx tsc --noEmit --pretty 2>&1 | Select-Object -First 10
```

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/components/CadImportPreviewModal.tsx; git commit -m "feat: 创建CAD导入预览弹窗组件"
```

---

### Task 7: 前端 — PartDetailModal 集成

**文件:** `frontend/src/components/PartDetailModal.tsx`

- [ ] **Step 1: 添加导入和状态**

在文件顶部（第 9 行 `import PartAttachmentBucket` 之后），添加：

```tsx
import CadImportPreviewModal from './CadImportPreviewModal';
```

在组件内的状态声明区域（第 62 行 `assemblyFileRef` 之后），添加：

```tsx
const cadFolderInputRef = useRef<HTMLInputElement>(null);
const [cadImportPreview, setCadImportPreview] = useState<{
  open: boolean;
  items: any[];
  unmatched: string[];
  summary: any;
}>({ open: false, items: [], unmatched: [], summary: {} });
const [cadFolderFiles, setCadFolderFiles] = useState<FileList | null>(null);
const [isImporting, setIsImporting] = useState(false);
const [importProgress, setImportProgress] = useState({ current: 0, total: 0, name: '' });
```

- [ ] **Step 2: 添加文件夹选择处理函数**

在 `handleImportStep` 函数附近（约第 430 行），添加：

```tsx
const handleCadFolderSelect = () => {
  cadFolderInputRef.current?.click();
};

const handleCadFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const fileNames: string[] = [];
  // webkitRelativePath 格式: "folder/sub/file.ext"，我们只需要文件名
  const fileMap = new Map<string, File>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = f.webkitRelativePath ? f.webkitRelativePath.split('/').pop() || f.name : f.name;
    fileNames.push(name);
    fileMap.set(name, f);
  }

  if (!revisionId) return;

  try {
    const result = await partsApi.cadImportPreview(revisionId, fileNames);
    setCadImportPreview({ open: true, items: result.matched, unmatched: result.unmatched, summary: result.summary });
    setCadFolderFiles(files);
  } catch {
    toast.error('匹配失败，请重试');
  } finally {
    if (cadFolderInputRef.current) cadFolderInputRef.current.value = '';
  }
};

const handleCadImportExecute = async () => {
  if (!cadFolderFiles || cadFolderFiles.length === 0) return;

  setCadImportPreview({ open: false, items: [], unmatched: [], summary: {} });

  const items = cadImportPreview.items.filter((i: any) => i.can_upload);
  if (items.length === 0) return;

  // 建立 文件名 -> File 映射
  const fileMap = new Map<string, File>();
  for (let i = 0; i < cadFolderFiles.length; i++) {
    const f = cadFolderFiles[i];
    const name = f.webkitRelativePath ? f.webkitRelativePath.split('/').pop() || f.name : f.name;
    fileMap.set(name, f);
  }

  setIsImporting(true);
  setImportProgress({ current: 0, total: items.length, name: '' });

  let successCount = 0;
  let failCount = 0;
  const concurrency = 5;

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item: any) => {
      const file = fileMap.get(item.file_name);
      if (!file) return;
      setImportProgress((p) => ({ ...p, name: item.file_name }));
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', 'cad');
        formData.append('overwrite', 'true');
        await api.post(`/parts/revisions/${item.revision_id}/attachments`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        successCount++;
      } catch {
        failCount++;
      }
      setImportProgress((p) => ({ ...p, current: p.current + 1 }));
    });
    await Promise.all(promises);
  }

  setIsImporting(false);
  setCadFolderFiles(null);
  toast.success(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个`);
};
```

- [ ] **Step 3: 在 BOM 标签页添加「导入CAD文件夹」按钮**

在「导入装配STEP」按钮之前（第 493-498 行区域），即 `{canEdit && (` 块内部、`{isAssembly ? (` 块内部、`<>` 内部最前面，添加：

```tsx
<input ref={cadFolderInputRef} type="file"
  // @ts-ignore webkitdirectory is not in standard TS types
  webkitdirectory=""
  // @ts-ignore
  directory=""
  hidden
  onChange={handleCadFolderChange} />
<button onClick={handleCadFolderSelect}
  className="px-3 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">
  导入CAD文件夹
</button>
```

- [ ] **Step 4: 添加导入进度条和预览弹窗**

在组件 JSX 的附件标签页区域（第 749-754 行）的 `PartAttachmentBucket` 上方，添加上传进度显示：

在附件标签页内容的最前面（`<div className="space-y-4">` 内部、第一个 `PartAttachmentBucket` 之前）添加：

```tsx
{isImporting && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
    <div className="flex items-center gap-2 text-sm text-blue-700 mb-2">
      <span>上传中: {importProgress.name}</span>
      <span className="text-blue-500">{importProgress.current}/{importProgress.total}</span>
    </div>
    <div className="w-full bg-blue-200 rounded-full h-2">
      <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }} />
    </div>
  </div>
)}
```

在组件 JSX 的末尾（`</Modal>` 之前），添加：

```tsx
<CadImportPreviewModal
  open={cadImportPreview.open}
  items={cadImportPreview.items}
  unmatched={cadImportPreview.unmatched}
  summary={cadImportPreview.summary}
  revisionId={revisionId || ''}
  onClose={() => setCadImportPreview({ open: false, items: [], unmatched: [], summary: {} })}
  onComplete={handleCadImportExecute}
/>
```

- [ ] **Step 5: 构建前端并验证**

```powershell
cd frontend; npm run build
# 检查构建输出无错误
Write-Host "Build exit code: $LASTEXITCODE"
```

- [ ] **Step 6: 提交**

```powershell
git add frontend/src/components/PartDetailModal.tsx; git commit -m "feat: PartDetailModal集成CAD文件夹导入功能"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 重启后端确保新端点生效**

```powershell
docker restart bom_backend
Start-Sleep -Seconds 5
```

- [ ] **Step 2: 重新构建并重启 Nginx**

```powershell
cd frontend; npm run build; docker-compose up -d --force-recreate nginx
```

- [ ] **Step 3: 手动验证**

按以下步骤手动验证：
1. 打开浏览器访问系统，登录 engineer 账号
2. 进入零部件列表，找到一个有BOM子项的部件
3. 签出该部件
4. 点击展开详情，切换到 BOM结构 标签页
5. 确认「导入CAD文件夹」按钮在「导入装配STEP」左侧显示
6. 点击按钮，选择一个包含匹配文件的文件夹
7. 确认预览弹窗正确显示匹配/未匹配/覆盖/未签出项
8. 点击确认导入，观察进度条
9. 切换到附件标签页，确认文件已上传到对应的零部件

- [ ] **Step 4: 提交最终确认**

```powershell
git log --oneline -5
```
