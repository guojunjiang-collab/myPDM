# 一键下载部件及子项 CAD/生产附件 设计方案

> 版本 v1 | 2026-07-09

## 需求概述

零部件详情页附件 TAB 中，CAD 附件区和生产附件区标题右侧各增加一个下载按钮，点击后顺序下载该部件**及 BOM 树全部层级子孙件**的对应类别附件。

---

## 交互设计

- 按钮位置：附件 TAB 的「CAD 附件」和「生产附件」标题右侧。
- 点击后：
  1. 显示 loading 态，禁止重复点击。
  2. 后端查询、返回附件列表。
  3. 前端遍历列表，为每个附件获取媒体令牌，通过 `<a download>` 顺序触发浏览器下载。
  4. 下载完成（全部文件链接已点击）解除 loading；中途不阻塞用户操其他操作。
  5. 若列表为空，toast「该类别下无可下载附件」。

---

## 后端设计

### API 端点

```
GET /api/parts/revisions/{revision_id}/bom-attachments?category=cad|production
```

**权限**: `attachments:download`（admin / engineer / production / guest 均可）

**响应**:
```json
{
  "revision_id": "...",
  "category": "production",
  "count": 5,
  "items": [
    {"attachment_id": "...", "file_name": "件号.STEP", "part_code": "上夹头-V1.1"},
    ...
  ]
}
```

**逻辑** (`crud_parts.collect_bom_attachments`):
1. 从 `revision_id` 出发，BFS/DFS 走 BOMItem（`parent_revision_id → child_revision_id`，排除软删除）。
2. 用 `set` 去重 `child_revision_id`。
3. 对每个 revision、取 `latest_iteration`、查 `PartAttachment` 表（`iteration_id + category`）。
4. 组装返回列表（已去重，同一附件即使出现在多个 BOMItem 中只返回一次）。

**异常处理**:
- 无任何附件 → HTTP 404 `{"detail": "未找到该类别的附件"}`
- 查询异常 → HTTP 500

### 新增 CRUD 函数

`crud_parts.py`:

```python
def collect_bom_attachments(db, revision_id, category):
    """递归收集 BOM 树所有子孙+自身版本的指定 category 附件清单。"""
    # 收集所有 revision_id：含传入的根 revision 自身 + 全部层级子孙，去重
    rev_ids = set()
    _walk(revision_id, rev_ids)  # 递归，rev_ids 预置根自身

    items = []
    for rid in rev_ids:
        rev = get_part_revision(db, rid)
        if not rev: continue
        it = _current_iteration(db, rid)
        if not it: continue
        atts = db.query(PartAttachment).filter(
            PartAttachment.iteration_id == it.id,
            PartAttachment.category == category,
        ).all()
        for a in atts:
            items.append({...})
    return items
```

---

## 前端设计

### API 层

`frontend/src/services/api.ts`:

```typescript
getBomAttachments: (revisionId: string, category: 'cad' | 'production') =>
    api.get(`/parts/revisions/${revisionId}/bom-attachments`, { params: { category } }).then(r => r.data),
```

### 组件层

`PartDetailModal.tsx`:

- 新增 `handleDownloadAllAttachments(category: 'cad' | 'production')`：
  ```typescript
  const [downloadingCategory, setDownloadingCategory] = useState<string | null>(null);
  const handleDownloadAll = async (category: 'cad' | 'production') => {
    setDownloadingCategory(category);
    try {
      const data = await partsApi.getBomAttachments(revisionId!, category);
      if (!data.items.length) { toast.info('该类别下无可下载附件'); return; }
      for (const { attachment_id, file_name } of data.items) {
        const token = await mediaApi.token(attachment_id, 'direct-download');
        const a = document.createElement('a');
        a.href = `/api/v2/attachments/${attachment_id}/direct-download?token=${token}`;
        a.download = file_name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        await new Promise(r => setTimeout(r, 200)); // 防浏览器节流丢文件
      }
      toast.success(`已下载 ${data.count} 个附件`);
    } catch { toast.error('获取附件列表失败'); }
    finally { setDownloadingCategory(null); }
  };
  ```

- 按钮渲染（附件 TAB 标题右侧）：
  ```tsx
  <button onClick={() => handleDownloadAll('cad')} disabled={downloadingCategory === 'cad'}
    className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">
    {downloadingCategory === 'cad' ? '下载中...' : '一键下载'}
  </button>
  ```

### 平铺文件（按用户要求）
文件全部平铺，不同件的同名文件浏览器自动加 `(1)` `(2)` 后缀，无需前端处理。

---

## 测试要点

- BOM 树深度 0（单零件）→ 返回自身的附件
- BOM 树深度 2（装配 + 子装配 + 叶件）→ 返回全部附件
- 存在已删除的 BOMItem → 排除
- 某子件当前迭代无指定 category 附件 → 跳过
- 某附件磁盘文件不存在 → 只返回有有效 file_path 的附件
- 空 BOM → 404
- 权限不足（无 `attachments:download`）→ 403
