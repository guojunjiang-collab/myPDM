# 图文档 HTML / QMD 上传与预览设计方案

> **版本**: v1.0
> **日期**: 2026-08-04
> **状态**: 🟡 设计中

---

## 一、需求概述

图文档管理模块扩展支持 **HTML (.html)** 和 **Quarto Markdown (.qmd)** 文件的上传与预览。

- **HTML**：上传后浏览器直接渲染网页效果
- **QMD**：上传后通过 Quarto CLI 渲染（含代码块执行结果），浏览器预览生成的 HTML

---

## 二、现状分析

### 2.1 现有上传白名单

`backend/app/file_storage.py:23-30`，30 类扩展名，**不含** `.html` 和 `.qmd`：

```python
ALLOWED_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.dwg', '.dxf', '.stp', '.step', '.igs', '.iges',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz',
    '.glb', '.gltf', '.obj',
    '.txt', '.csv', '.md', '.log', '.json', '.xml',
}
```

### 2.2 现有预览体系

前端 `attachmentPreview.ts` 统一分发，根据扩展名路由：

| 类型 | 扩展名 | 预览方式 |
|------|--------|---------|
| PDF/图片/文本 | pdf/jpg/png/txt/md/csv... | `/preview` + 媒体令牌 |
| Office | docx/xlsx/pptx | `/office-pdf` 或 `/office-reader` |
| 3D | stp/step | `/gltf`（异步转换 + 轮询） |
| 压缩包 | zip/tar/rar... | ArchiveTreeModal 弹窗 |
| 未知 | 其余 | alert 提示不支持 |

文本类预览端点（`/preview`）对 `.txt/.md/.csv/.log/.json/.xml` 统一返回 `text/plain; charset=utf-8`。

### 2.3 可复用的现有模式

- **异步转换+缓存**：STP→glTF 模式（`stp_converter.py` + `/gltf` 端点），上游触发转换返回 202，前端轮询。
- **同步转换+缓存**：Office→PDF 模式（`office_converter.py` + `/office-pdf` 端点），命中缓存直接返回，未命中同步转换。

---

## 三、设计方案

### 3.1 HTML 上传与预览

**前端路由**：`.html` 走现有 `/preview` 端点（复用，无需新建端点）

**后端改动**：

```
backend/app/routers/attachments_v2.py

_TEXT_PREVIEW_EXTS 集合中新增 '.html'，
但 _preview_media_type() 对 .html 返回 text/html 而非 text/plain
```

修改 `_preview_media_type()` 函数：对 `.html` 文件返回 `Content-Type: text/html; charset=utf-8`，浏览器自动渲染 HTML。

**前端改动**：

```
frontend/src/utils/attachmentPreview.ts

将 'html' 加入 INLINE_EXTS（或新建 HTML_EXTS 单独处理）
```

### 3.2 QMD 上传与预览

采用**同步转换+缓存**模式（与 Office→PDF 一致）。

```
用户点击 .qmd 预览
  → mediaApi.token(attId, 'qmd-preview')
  → window.open('/api/v2/attachments/{id}/qmd-preview?token=...')
  → 后端检查缓存 HTML
       ├─ 命中 → 直接返回 HTML (200, text/html)
       └─ 未命中 → 同步阻塞 quarto render（5-15 秒） → 返回 HTML
```

**新增文件**：

| 文件 | 说明 |
|------|------|
| `backend/app/qmd_converter.py` | QMD→HTML 转换服务 |
| （无前端新文件） | 改动在已有文件 |

**改动文件**：

| 文件 | 改动 |
|------|------|
| `backend/app/file_storage.py:23` | `ALLOWED_EXTENSIONS` 新增 `.html`、`.qmd` |
| `backend/app/routers/attachments_v2.py:37` | `_TEXT_PREVIEW_EXTS` 修改 `.html` 逻辑；新增 `/qmd-preview` 端点 |
| `backend/Dockerfile` | 安装 Quarto CLI |
| `frontend/src/utils/attachmentPreview.ts:5` | 新增 `.html` 和 `.qmd` 预览路由 |

### 3.3 qmd_converter.py 设计

模仿 `stp_converter.py` 的结构：

```
backend/app/qmd_converter.py

- QMD_CACHE_DIR = /app/uploads/qmd_cache/
- is_qmd_file(filename) → bool
- get_qmd_html_path(attachment_id, file_path) → Path | None
- convert_qmd_to_html(qmd_path, attachment_id) → 调用 quarto render
- delete_qmd_cache(attachment_id, file_path)
- 并发控制: threading.Semaphore(2)（quarto render CPU/内存密集）
```

转换逻辑：

```python
def convert_qmd_to_html(qmd_path: str, attachment_id: str):
    """
    调用 quarto render 将 QMD 转换为 HTML。
    - 输出到 QMD_CACHE_DIR/{attachment_id}/ 目录
    - quarto 会自动创建 {stem}.html 文件
    """
    output_dir = QMD_CACHE_DIR / attachment_id
    output_dir.mkdir(parents=True, exist_ok=True)
    
    subprocess.run(
        ["quarto", "render", qmd_path, "--to", "html", "--output-dir", str(output_dir)],
        capture_output=True, timeout=120, check=True
    )
```

### 3.4 /qmd-preview 端点设计

采用**同步转换+缓存**模式（与 Office→PDF 一致）。QMD 文件通常小，quarto render 5-15 秒即可完成，无需异步轮询。

```python
@router.get("/{attachment_id}/qmd-preview")
async def get_qmd_preview(attachment_id, token, db):
    """QMD 预览：同步转换 + 缓存，返回渲染后的 HTML"""
    verify_media_token(token, str(attachment_id), "qmd-preview")
    
    att, _ = _resolve_attachment(db, attachment_id)
    if not att: raise HTTPException(404)
    if not is_qmd_file(att.file_name): raise HTTPException(400)
    
    html_path = get_qmd_html_path(str(attachment_id), att.file_path)
    
    if not html_path:
        # 缓存未命中 → 同步阻塞转换（5-15 秒），在 executor 中执行避免阻塞事件循环
        qmd_full_path = file_storage.base_dir / att.file_path
        loop = asyncio.get_event_loop()
        html_path = await loop.run_in_executor(
            None, convert_qmd_to_html, str(qmd_full_path), str(attachment_id)
        )
    
    return FileResponse(str(html_path), media_type="text/html; charset=utf-8")
```

### 3.5 前端预览路由

`attachmentPreview.ts` 新增两段：

```typescript
// HTML：走 /preview 端点，后端返回 text/html 浏览器直接渲染
if (ext === 'html') {
  const mt = await mediaApi.token(attId, 'preview');
  window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
  return;
}

// QMD：走 /qmd-preview 端点，同步转换 + 缓存
if (ext === 'qmd') {
  const mt = await mediaApi.token(attId, 'qmd-preview');
  window.open(`/api/v2/attachments/${attId}/qmd-preview?token=${encodeURIComponent(mt)}`, '_blank');
  return;
}
```

#### 3.5.1 QMD 预览流程

同步转换模式：`window.open()` 打开端点后，后端缓存命中则直接返回 HTML，未命中则阻塞等待 quarto render 完成（约 5-15 秒，首次仅一次），之后缓存命中秒开。浏览器在等待期间显示加载状态，无需前端轮询。

### 3.6 Dockerfile 改动

Quarto CLI 通过官方 `.deb` 包安装（基于 Debian Bookworm）：

```dockerfile
# Quarto CLI（用于 QMD 渲染预览）
ARG QUARTO_VERSION=1.6.39
RUN curl -sLo /tmp/quarto.deb https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-amd64.deb && \
    dpkg -i /tmp/quarto.deb && \
    rm /tmp/quarto.deb
```

同时需在已有 `apt-get install` 行添加 `wget`（Debian slim 镜像默认不含），用于下载 Quarto deb 包。

### 3.7 media_token.py 改动

无需改动。`mint_media_token` 和 `verify_media_token` 已支持任意 `action` 字符串，传入 `"qmd-preview"` 即可。

---

## 四、文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `backend/app/file_storage.py` | `ALLOWED_EXTENSIONS` 加 `.html`、`.qmd` |
| 修改 | `backend/app/routers/attachments_v2.py` | `.html` 预览 Content-Type；新增 `/qmd-preview` 端点 |
| 新建 | `backend/app/qmd_converter.py` | QMD→HTML 转换服务 |
| 修改 | `backend/Dockerfile` | 安装 Quarto CLI |
| 修改 | `frontend/src/utils/attachmentPreview.ts` | 新增 `.html`、`.qmd` 预览路由 |

---

## 五、安全考虑

- **HTML 文件**：作为用户上传文件，前端渲染可能包含恶意脚本。由于系统为内网 PDM 且上传白名单严格，风险可控。不做沙箱化处理。
- **QMD 渲染**：quarto render 在沙箱化环境中执行，不暴露外部网络（可通过 `--execute-daemon=0` 限制）。
- **路径安全**：复用 `file_storage._validate_filename()` 的路径遍历防护。

---

## 六、测试要点

1. 上传 `.html` / `.qmd` 文件成功（后端白名单放行）
2. HTML 预览：新窗口正确渲染网页效果（非源码）
3. QMD 预览：首次转换慢（~5-15s），缓存命中秒开
4. QMD 代码块执行结果正确显示
5. 上传非白名单扩展名文件仍被拒绝
6. 预览非 `.html`/`.qmd` 文件不受影响（回归测试）
