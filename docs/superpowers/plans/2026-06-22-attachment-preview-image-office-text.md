# 图文档附件图片/文本/Office 预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为图文档附件预览新增图片、文本、Office 三类格式支持，并消除前端两处重复的预览逻辑。

**Architecture:** 复用现有「媒体令牌 + `/preview` 内嵌」机制。图片/文本浏览器原生内嵌（前端放开白名单 + 后端文本编码修正）；Office 用后端 LibreOffice 转 PDF 并缓存（仿 `stp_converter.py`），再走 PDF 内嵌路径。前端预览分发逻辑抽到共享 util。

**Tech Stack:** 后端 FastAPI / Python / subprocess+LibreOffice(soffice) / pytest；前端 React + TypeScript / Vite。

参考 spec：`docs/superpowers/specs/2026-06-22-attachment-preview-image-office-text-design.md`

---

## File Structure

**后端**
- 新增 `backend/app/office_converter.py` — Office→PDF 转换与 PDF 缓存（仿 `stp_converter.py`），单一职责。
- 修改 `backend/app/routers/attachments_v2.py` — `/preview` 文本编码修正、新增 `/office-pdf` 接口、`_ACTION_PERM` 增项、`delete_attachment` 清缓存、import office_converter。
- 修改 `backend/Dockerfile` — 安装 LibreOffice。
- 新增 `backend/tests/test_office_converter.py` — 不依赖 soffice 二进制的纯函数单测。
- 修改 `backend/tests/test_media_token.py` 不动；office-pdf 令牌作用域测试放入 `test_office_converter.py` 或新建；本计划放入 `backend/tests/test_office_preview.py`。

**前端**
- 新增 `frontend/src/utils/attachmentPreview.ts` — 格式白名单 + 预览分发函数。
- 修改 `frontend/src/services/api.ts` — `mediaApi.token` action 联合类型加 `'office-pdf'`。
- 修改 `frontend/src/components/DocumentDetailContent.tsx` — 改用共享函数。
- 修改 `frontend/src/components/EntityDocumentSection.tsx` — 改用共享函数。

---

## Task 1: 后端 — `office_converter.py` 纯函数（类型判断 + 缓存路径）

**Files:**
- Create: `backend/app/office_converter.py`
- Test: `backend/tests/test_office_converter.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_office_converter.py
from pathlib import Path
from app.office_converter import is_office_file, get_pdf_cache_path, get_pdf_path_for_attachment


def test_is_office_file_true():
    for name in ["a.doc", "a.docx", "a.xls", "a.xlsx", "a.ppt", "a.pptx", "A.DOCX"]:
        assert is_office_file(name) is True


def test_is_office_file_false():
    for name in ["a.pdf", "a.txt", "a.stp", "a.zip", "", "noext"]:
        assert is_office_file(name) is False


def test_get_pdf_cache_path_uses_folder_and_stem():
    p = get_pdf_cache_path("att-1", "documents/test-DOC_A/spec.docx")
    assert p.name == "spec.pdf"
    assert p.parent.name == "test-DOC_A"


def test_get_pdf_path_for_attachment_missing_returns_none():
    assert get_pdf_path_for_attachment("att-x", "documents/none/none.docx") is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_office_converter.py -v`
Expected: FAIL（`ModuleNotFoundError: app.office_converter`）

- [ ] **Step 3: 实现 office_converter.py（先实现纯函数，转换函数下一任务补）**

```python
# backend/app/office_converter.py
"""
Office 文档转 PDF 服务（用于浏览器内嵌预览）
- doc/docx/xls/xlsx/ppt/pptx 经 LibreOffice(soffice) 转 PDF
- PDF 缓存到 uploads/pdf_cache/{图文档文件夹}/{stem}.pdf（随 uploads 卷持久化）
- 删除 Office 附件时同步清理对应 PDF
- 使用 Semaphore 限制并发 soffice 进程
结构对齐 stp_converter.py。
"""
import shutil
import subprocess
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# PDF 缓存目录（容器内路径，对应宿主机 uploads/pdf_cache/）
PDF_CACHE_DIR = Path("/app/uploads/pdf_cache")

OFFICE_EXTS = (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")

# 并发控制：最多同时运行 2 个 soffice 进程
_office_semaphore = threading.Semaphore(2)


def is_office_file(filename: str) -> bool:
    """判断是否为受支持的 Office 文件"""
    if not filename:
        return False
    return Path(filename).suffix.lower() in OFFICE_EXTS


def get_pdf_cache_path(attachment_id: str, file_path: str = None) -> Path:
    """获取附件对应的 PDF 缓存路径（仿 get_glb_cache_path）"""
    if file_path:
        src = Path(file_path)
        folder_name = src.parent.name
        pdf_filename = src.stem + ".pdf"
        target_dir = PDF_CACHE_DIR / folder_name
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / pdf_filename
    PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return PDF_CACHE_DIR / f"{attachment_id}.pdf"


def get_pdf_path_for_attachment(attachment_id: str, file_path: str = None) -> Optional[str]:
    """获取附件对应 PDF 路径（不触发转换）"""
    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    return str(pdf_path) if pdf_path.exists() else None


def delete_pdf_cache(attachment_id: str, file_path: str = None):
    """删除附件对应的 PDF 缓存"""
    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    if pdf_path.exists():
        pdf_path.unlink()
        logger.info(f"已删除 PDF 缓存: {pdf_path}")
```

注意：`get_pdf_cache_path` 在测试环境会创建 `/app/uploads/pdf_cache/...` 目录。测试用的是相对子路径 `documents/test-DOC_A/...`，会在 `/app/uploads/pdf_cache/test-DOC_A` 下建目录——容器内可写。若在非容器本地运行测试且 `/app` 不可写，见 Step 4 备注。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_office_converter.py -v`
Expected: PASS（4 项）

> 备注：若本地非容器环境 `/app` 不可写导致 `mkdir` 报错，测试应在后端容器内运行：`docker compose exec backend python -m pytest tests/test_office_converter.py -v`（与项目既有 STP 测试一致的运行方式）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/office_converter.py backend/tests/test_office_converter.py
git commit -m "feat(attachments): office_converter 类型判断与 PDF 缓存路径"
```

---

## Task 2: 后端 — `convert_office_to_pdf` 转换函数

**Files:**
- Modify: `backend/app/office_converter.py`

> 实际转换依赖镜像内 LibreOffice，无法在纯单测验证；本任务只补实现，正确性由 Docker 手测（Task 8）确认。仍加一条「源文件不存在返回 None」的单测。

- [ ] **Step 1: 写失败测试**

```python
# 追加到 backend/tests/test_office_converter.py
from app.office_converter import convert_office_to_pdf


def test_convert_office_missing_source_returns_none():
    assert convert_office_to_pdf("/nonexistent/path/a.docx", "att-1", "documents/x/a.docx") is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_office_converter.py::test_convert_office_missing_source_returns_none -v`
Expected: FAIL（`ImportError: cannot import name 'convert_office_to_pdf'`）

- [ ] **Step 3: 实现 convert_office_to_pdf（追加到 office_converter.py 末尾）**

```python
def convert_office_to_pdf(src_path: str, attachment_id: str, file_path: str = None) -> Optional[str]:
    """
    将 Office 文件转换为 PDF。
    使用 _office_semaphore 限制并发 soffice 进程数（最多 2 个）。
    Returns: PDF 路径，失败返回 None。
    """
    src_file = Path(src_path)
    if not src_file.exists():
        logger.error(f"Office 源文件不存在: {src_path}")
        return None

    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    if pdf_path.exists():
        logger.info(f"PDF 缓存已存在: {pdf_path}")
        return str(pdf_path)

    logger.info(f"等待 Office 转换槽位: {src_path}")
    with _office_semaphore:
        # 排队期间可能已由其它任务生成
        if pdf_path.exists():
            logger.info(f"PDF 缓存已存在（排队期间生成）: {pdf_path}")
            return str(pdf_path)

        logger.info(f"开始转换 Office → PDF: {src_path}")
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                result = subprocess.run(
                    ["soffice", "--headless", "--convert-to", "pdf",
                     "--outdir", tmpdir, str(src_file)],
                    capture_output=True, text=True, timeout=120,
                )
                if result.returncode != 0:
                    logger.error(f"Office 转换失败 (exit={result.returncode}): {result.stderr}")
                    return None

                # soffice 输出文件名为 {源stem}.pdf
                out_pdf = Path(tmpdir) / (src_file.stem + ".pdf")
                if not out_pdf.exists():
                    logger.error("Office 转换完成但输出 PDF 不存在")
                    return None

                pdf_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(out_pdf), str(pdf_path))
                size_mb = pdf_path.stat().st_size / 1024 / 1024
                logger.info(f"Office 转换成功: {pdf_path} ({size_mb:.2f} MB)")
                return str(pdf_path)
            except subprocess.TimeoutExpired:
                logger.error(f"Office 转换超时 (120s): {src_path}")
                return None
            except Exception as e:
                logger.error(f"Office 转换异常: {e}")
                return None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_office_converter.py -v`
Expected: PASS（5 项）

- [ ] **Step 5: 提交**

```bash
git add backend/app/office_converter.py backend/tests/test_office_converter.py
git commit -m "feat(attachments): convert_office_to_pdf 转换实现"
```

---

## Task 3: 后端 — `_ACTION_PERM` 增加 office-pdf 令牌作用域

**Files:**
- Modify: `backend/app/routers/attachments_v2.py:485-491`（`_ACTION_PERM` 字典）
- Test: `backend/tests/test_office_preview.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_office_preview.py
from app.routers.attachments_v2 import _ACTION_PERM


def test_office_pdf_action_maps_to_preview_permission():
    assert _ACTION_PERM.get("office-pdf") == "attachments:preview"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_office_preview.py -v`
Expected: FAIL（`assert None == 'attachments:preview'`）

- [ ] **Step 3: 修改 _ACTION_PERM**

将 `backend/app/routers/attachments_v2.py` 中：

```python
_ACTION_PERM = {
    "preview": "attachments:preview",
    "direct-download": "attachments:direct_download",
    "gltf": "attachments:gltf",
    "archive-tree": "attachments:archive_browse",
    "extract-file": "attachments:archive_browse",
}
```

改为（新增最后一行）：

```python
_ACTION_PERM = {
    "preview": "attachments:preview",
    "direct-download": "attachments:direct_download",
    "gltf": "attachments:gltf",
    "archive-tree": "attachments:archive_browse",
    "extract-file": "attachments:archive_browse",
    "office-pdf": "attachments:preview",
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_office_preview.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/attachments_v2.py backend/tests/test_office_preview.py
git commit -m "feat(attachments): office-pdf 媒体令牌作用域复用 preview 权限"
```

---

## Task 4: 后端 — `/preview` 文本类强制 UTF-8 内嵌

**Files:**
- Modify: `backend/app/routers/attachments_v2.py:548-589`（`preview_attachment`）
- Test: `backend/tests/test_office_preview.py`

- [ ] **Step 1: 写失败测试（纯函数化 mime 选择，便于单测）**

先在 `preview_attachment` 引入一个模块级纯函数 `_preview_media_type(filename)`，测试它：

```python
# 追加到 backend/tests/test_office_preview.py
from app.routers.attachments_v2 import _preview_media_type


def test_preview_media_type_text_family_is_utf8_plain():
    for name in ["a.txt", "a.md", "a.csv", "a.log", "a.json", "a.xml", "A.MD"]:
        assert _preview_media_type(name) == "text/plain; charset=utf-8"


def test_preview_media_type_image_uses_guess():
    assert _preview_media_type("a.png") == "image/png"


def test_preview_media_type_pdf():
    assert _preview_media_type("a.pdf") == "application/pdf"


def test_preview_media_type_unknown_octet_stream():
    assert _preview_media_type("a.unknownext") == "application/octet-stream"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_office_preview.py -v`
Expected: FAIL（`ImportError: cannot import name '_preview_media_type'`）

- [ ] **Step 3: 实现 `_preview_media_type` 并在 preview_attachment 中使用**

在 `attachments_v2.py` 顶部 import 区下方（router 定义附近、模块级）新增：

```python
import mimetypes as _mimetypes

# 文本类扩展名：统一以 UTF-8 纯文本内嵌，避免 md/log 被当二进制下载、避免中文乱码
_TEXT_PREVIEW_EXTS = {".txt", ".md", ".csv", ".log", ".json", ".xml"}


def _preview_media_type(filename: str) -> str:
    """预览时的 Content-Type：文本类统一 UTF-8 纯文本，其余按扩展名猜测"""
    ext = Path(filename).suffix.lower()
    if ext in _TEXT_PREVIEW_EXTS:
        return "text/plain; charset=utf-8"
    return _mimetypes.guess_type(filename)[0] or "application/octet-stream"
```

然后修改 `preview_attachment` 内的 mime 计算。将原有：

```python
    import mimetypes
    from urllib.parse import quote
    
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    
    # RFC 5987 编码文件名（支持中文）
    encoded_filename = quote(att.file_name)
```

替换为：

```python
    from urllib.parse import quote

    mime_type = _preview_media_type(att.file_name)

    # RFC 5987 编码文件名（支持中文）
    encoded_filename = quote(att.file_name)
```

（注意用 `att.file_name` 而非 `file_path`，因为缓存/存储路径可能与原文件名扩展名一致，但统一以展示文件名判断更稳妥。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_office_preview.py -v`
Expected: PASS（含 Task 3 的 1 项 + 本任务 4 项）

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/attachments_v2.py backend/tests/test_office_preview.py
git commit -m "feat(attachments): 预览文本类强制 UTF-8 纯文本内嵌"
```

---

## Task 5: 后端 — 新增 `/office-pdf` 接口 + 删除时清缓存

**Files:**
- Modify: `backend/app/routers/attachments_v2.py`（import office_converter；新增 endpoint；`delete_attachment` 清缓存）

> 该接口端到端正确性依赖 LibreOffice，由 Docker 手测（Task 8）验证。本任务无新增自动化测试，仅确保 import 与既有测试不破。

- [ ] **Step 1: 增加 import**

在 `attachments_v2.py` 第 19 行（`from ..stp_converter import ...`）下方新增：

```python
from ..office_converter import (
    is_office_file, convert_office_to_pdf,
    get_pdf_path_for_attachment, delete_pdf_cache,
)
```

- [ ] **Step 2: 新增 `/office-pdf` 接口**

在 `get_gltf` 函数（约 641 行结束）之后、`delete_attachment` 之前插入：

```python
@router.get("/{attachment_id}/office-pdf")
async def get_office_pdf(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db),
):
    """获取 Office 文档转换后的 PDF（用于浏览器内嵌预览）

    认证: ?token= 媒体令牌（action=office-pdf）
    流程: 命中缓存直接返回内嵌 PDF；未命中则同步阻塞转换后返回。
    """
    verify_media_token(token, str(attachment_id), "office-pdf")

    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    if not is_office_file(att.file_name):
        raise HTTPException(status_code=400, detail="该附件不是 Office 文档")

    if not att.file_path:
        raise HTTPException(status_code=404, detail="附件文件路径为空")

    src_full = file_storage.base_dir / att.file_path
    if not src_full.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    pdf_path = get_pdf_path_for_attachment(str(attachment_id), att.file_path)
    if not pdf_path:
        # 同步阻塞转换（信号量 + 120s 超时在 converter 内部）
        pdf_path = convert_office_to_pdf(str(src_full), str(attachment_id), att.file_path)
        if not pdf_path:
            raise HTTPException(status_code=500, detail="Office 文档转换失败")

    from urllib.parse import quote
    encoded_filename = quote(Path(att.file_name).stem + ".pdf")
    return FileResponse(
        path=pdf_path,
        filename=Path(att.file_name).stem + ".pdf",
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"},
    )
```

- [ ] **Step 3: `delete_attachment` 增加清理 PDF 缓存**

在 `delete_attachment` 中，现有 STP 清理块：

```python
    # 删除对应的 glb 缓存
    if is_stp_file(att.file_name):
        delete_glb_cache(str(attachment_id), att.file_path)
```

之后新增：

```python
    # 删除对应的 PDF 缓存（Office 预览）
    if is_office_file(att.file_name):
        delete_pdf_cache(str(attachment_id), att.file_path)
```

- [ ] **Step 4: 运行全部后端测试确认无回归**

Run: `cd backend && python -m pytest -q`
Expected: PASS（既有全部测试 + 本特性新增测试通过，无 import 错误）

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/attachments_v2.py
git commit -m "feat(attachments): 新增 office-pdf 预览接口与删除时清理 PDF 缓存"
```

---

## Task 6: 后端 — Dockerfile 安装 LibreOffice

**Files:**
- Modify: `backend/Dockerfile:8-9`

- [ ] **Step 1: 修改 apt-get install 行加入 libreoffice**

将：

```dockerfile
    apt-get update && apt-get install -y libpq-dev gcc unrar xvfb libfuse2 \
        libfontconfig1 libgl1 libglib2.0-0 libxkbcommon0 libegl1 && \
```

改为（追加 `libreoffice`）：

```dockerfile
    apt-get update && apt-get install -y libpq-dev gcc unrar xvfb libfuse2 \
        libfontconfig1 libgl1 libglib2.0-0 libxkbcommon0 libegl1 libreoffice && \
```

- [ ] **Step 2: 提交（构建放到 Task 8 手测）**

```bash
git add backend/Dockerfile
git commit -m "build(backend): 安装 LibreOffice 以支持 Office 转 PDF 预览"
```

---

## Task 7: 前端 — 共享预览 util + 两组件接入

**Files:**
- Create: `frontend/src/utils/attachmentPreview.ts`
- Modify: `frontend/src/services/api.ts:253`（mediaApi action 联合类型）
- Modify: `frontend/src/components/DocumentDetailContent.tsx`
- Modify: `frontend/src/components/EntityDocumentSection.tsx`

- [ ] **Step 1: 扩展 mediaApi action 类型**

在 `frontend/src/services/api.ts` 将：

```ts
  token: (attId: string, action: 'preview' | 'direct-download' | 'gltf' | 'archive-tree' | 'extract-file') =>
```

改为：

```ts
  token: (attId: string, action: 'preview' | 'direct-download' | 'gltf' | 'archive-tree' | 'extract-file' | 'office-pdf') =>
```

- [ ] **Step 2: 创建共享 util**

```ts
// frontend/src/utils/attachmentPreview.ts
import { mediaApi } from '../services/api';

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
export const TEXT_EXTS = ['txt', 'md', 'csv', 'log', 'json', 'xml'];
export const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
export const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'rar', '7z'];

const INLINE_EXTS = ['pdf', ...IMAGE_EXTS, ...TEXT_EXTS];

/**
 * 统一的附件预览分发。
 * - pdf/图片/文本：媒体令牌 + 新窗口内嵌 /preview
 * - 压缩包：交给调用方弹窗（opts.onArchive）
 * - stp/step：新窗口三维预览
 * - Office：媒体令牌 + 新窗口 /office-pdf（后端转 PDF 内嵌）
 * - 其它：提示不支持
 */
export async function previewAttachment(
  attId: string,
  fileName: string,
  opts: { onArchive: (attId: string, fileName: string) => void },
): Promise<void> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (INLINE_EXTS.includes(ext)) {
    try {
      const mt = await mediaApi.token(attId, 'preview');
      window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
    } catch { alert('预览失败，请重试'); }
    return;
  }

  if (ARCHIVE_EXTS.includes(ext)) {
    opts.onArchive(attId, fileName);
    return;
  }

  if (ext === 'stp' || ext === 'step') {
    try {
      const mt = await mediaApi.token(attId, 'gltf');
      window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(mt)}`, '_blank');
    } catch { alert('预览失败，请重试'); }
    return;
  }

  if (OFFICE_EXTS.includes(ext)) {
    try {
      const mt = await mediaApi.token(attId, 'office-pdf');
      window.open(`/api/v2/attachments/${attId}/office-pdf?token=${encodeURIComponent(mt)}`, '_blank');
    } catch { alert('预览失败，请重试'); }
    return;
  }

  alert('该格式暂不支持预览');
}
```

- [ ] **Step 3: 改造 `DocumentDetailContent.tsx`**

删除组件内整段 `handlePreview` 函数（约 67-93 行），改为引入共享 util。

顶部 import 区新增：

```ts
import { previewAttachment } from '../utils/attachmentPreview';
```

将原 `handlePreview` 函数定义整体替换为：

```ts
  // 预览附件（统一分发）
  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, {
      onArchive: (id, name) => onArchivePreview?.(id, name),
    });
  };
```

（调用处 `onClick={() => handlePreview(att.id, att.file_name || 'preview')}` 不变。）

- [ ] **Step 4: 改造 `EntityDocumentSection.tsx`**

删除组件内整段 `handlePreviewAttachment` 函数（约 164-189 行），改为引入共享 util。

顶部 import 区新增：

```ts
import { previewAttachment } from '../utils/attachmentPreview';
```

将原 `handlePreviewAttachment` 函数定义整体替换为：

```ts
  const handlePreviewAttachment = (fileId: string, fileName: string) => {
    previewAttachment(fileId, fileName, {
      onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }),
    });
  };
```

（调用处 `handlePreviewAttachment(ed.document.file_id!, ed.document.file_name!)` 不变。）

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 类型错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/utils/attachmentPreview.ts frontend/src/services/api.ts frontend/src/components/DocumentDetailContent.tsx frontend/src/components/EntityDocumentSection.tsx
git commit -m "feat(attachments): 前端图片/文本/Office 预览 + 抽取共享预览逻辑"
```

---

## Task 8: Docker 手测（端到端验证）

**前置：** 已完成 Task 1–7 提交。

- [ ] **Step 1: 重建后端镜像并启动**

```bash
docker compose build backend && docker compose up -d backend frontend
```

- [ ] **Step 2: 容器内确认 soffice 可用**

```bash
docker compose exec backend soffice --version
```
Expected: 输出 LibreOffice 版本号。

- [ ] **Step 3: 容器内跑后端测试**

```bash
docker compose exec backend python -m pytest tests/test_office_converter.py tests/test_office_preview.py -v
```
Expected: 全部 PASS。

- [ ] **Step 4: 浏览器手测各格式预览**

逐一上传/选取图文档附件并点「预览」，确认：
- 图片（png/jpg/svg）：新窗口内嵌显示
- 文本（txt/md/csv/log/json/xml，含中文）：新窗口纯文本显示、无乱码、未触发下载
- Office（doc/docx/xls/xlsx/ppt/pptx）：首次数秒后新窗口显示 PDF；再次预览即时（缓存命中）
- 既有 pdf/压缩包/stp 预览仍正常

- [ ] **Step 5: 验证删除清缓存**

删除一个已预览过的 Office 附件，确认 `uploads/pdf_cache/{文件夹}/` 下对应 `.pdf` 被清除。

---

## Self-Review

**Spec coverage：**
- 共享 util 消重 → Task 7 ✅
- 图片/文本白名单 → Task 7（INLINE_EXTS）✅
- 文本 UTF-8 编码修正 → Task 4 ✅
- Office→PDF（converter/缓存/信号量）→ Task 1、2 ✅
- `/office-pdf` 接口（缓存命中/同步转换/400/500）→ Task 5 ✅
- `_ACTION_PERM` 复用 preview 权限 → Task 3 ✅
- mediaApi action 类型 → Task 7 Step 1 ✅
- 删除清 PDF 缓存 → Task 5 Step 3 ✅
- Dockerfile 装 LibreOffice → Task 6 ✅
- 测试（纯函数单测 + Docker 手测）→ Task 1–4、8 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency：** `is_office_file` / `convert_office_to_pdf` / `get_pdf_path_for_attachment` / `delete_pdf_cache` 在 Task 1–2 定义，Task 5 import 名称一致；前端 `previewAttachment(attId, fileName, {onArchive})` 签名在 Task 7 定义并被两组件按同签名调用；`office-pdf` action 字符串在后端 `_ACTION_PERM`、前端 union 类型、两处 `mediaApi.token` 调用中一致。
