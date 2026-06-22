# 图文档附件预览扩展：图片 / 文本 / Office 设计文档

日期：2026-06-22
分支：dev

## 背景

图文档附件预览当前仅支持三类（见 `frontend/src/components/DocumentDetailContent.tsx` 与 `frontend/src/components/EntityDocumentSection.tsx` 中逐行重复的 `handlePreview`）：

- PDF：浏览器内嵌（后端 `/preview` 返回 `Content-Disposition: inline`）
- 压缩包（zip/tar/gz/tgz/rar/7z）：树形弹窗
- STP/STEP：三维预览（STP→glTF 转换 + 缓存）

其余格式一律弹出「该格式暂不支持预览」。常见图片、文本、Office 文档均无法预览，与「图文档」定位不符。

## 目标

新增三类预览能力：

| 类别 | 扩展名 |
|------|--------|
| 图片 | jpg · jpeg · png · gif · bmp · webp · svg |
| 文本/标记 | txt · md · csv · log · json · xml |
| Office | doc · docx · xls · xlsx · ppt · pptx |

同时消除两处重复的前端预览逻辑。

## 非目标

- 不做 Office 在线编辑、不做 Office Online / 公网 viewer（内网部署不可用）。
- 不引入前端 Office 渲染库（pptx 与旧版 .doc/.xls/.ppt 支持差、样式还原低）。
- 不改动现有 PDF / 压缩包 / STP 预览行为。

## 总体方案

复用现有「媒体令牌 + `/preview` 内嵌」机制。图片与文本浏览器可原生内嵌，仅需前端放开白名单 + 后端修正文本编码。Office 浏览器无法原生预览，后端用 LibreOffice 转 PDF 后复用 PDF 内嵌路径。

### 1. 前端：抽取共享预览逻辑

新增 `frontend/src/utils/attachmentPreview.ts`，集中维护格式白名单与分发逻辑：

```ts
export const IMAGE_EXTS = ['jpg','jpeg','png','gif','bmp','webp','svg'];
export const TEXT_EXTS  = ['txt','md','csv','log','json','xml'];
export const OFFICE_EXTS = ['doc','docx','xls','xlsx','ppt','pptx'];
export const ARCHIVE_EXTS = ['zip','tar','gz','tgz','rar','7z'];

// 取扩展名 → 分发
export async function previewAttachment(
  attId: string,
  fileName: string,
  opts: { onArchive: (attId: string, fileName: string) => void }
): Promise<void>
```

分发规则：

| 类别 | 处理 |
|------|------|
| pdf / 图片 / 文本 | 取 `preview` 令牌 → `window.open('/api/v2/attachments/{id}/preview?token=...')` |
| 压缩包 | `opts.onArchive(attId, fileName)` |
| stp / step | 取 `gltf` 令牌 → `window.open('/stp-viewer?id=...&token=...')` |
| Office | 取 `office-pdf` 令牌 → `window.open('/api/v2/attachments/{id}/office-pdf?token=...')` |
| 其它 | `alert('该格式暂不支持预览')` |

`DocumentDetailContent.tsx` 与 `EntityDocumentSection.tsx` 改为调用 `previewAttachment`，删除各自重复实现；压缩包仍由组件自身的 `archivePreview` 状态承接（通过 `opts.onArchive` 回调）。

### 2. 后端：文本编码修正

`GET /{id}/preview`（`attachments_v2.py`）对文本类扩展名强制：

```
media_type = "text/plain; charset=utf-8"
```

理由：md / log 无 mime 映射会落到 `application/octet-stream` 触发下载；csv 在部分浏览器也会下载；统一用 `text/plain; charset=utf-8` 保证内嵌显示且中文（UTF-8）不乱码。图片 / PDF 仍走现有 `mimetypes.guess_type`。`Content-Disposition: inline` 保持不变。

### 3. 后端：Office → PDF 转换（仿 STP 模式）

**Dockerfile**：`apt-get install` 行追加 `libreoffice`（headless 模式，依赖项随包安装）。

**新模块 `backend/app/office_converter.py`**（结构对齐 `stp_converter.py`）：

- `is_office_file(filename) -> bool`：扩展名属于 `OFFICE_EXTS`。
- PDF 缓存目录：`/app/uploads/pdf_cache/{图文档文件夹}/{stem}.pdf`（与 STP 的 glb_cache 同构，随 uploads 卷持久化）。
- `get_pdf_cache_path(attachment_id, file_path) -> Path`
- `get_pdf_path_for_attachment(attachment_id, file_path) -> Optional[str]`（仅查，不转）
- `convert_office_to_pdf(src_path, attachment_id, file_path) -> Optional[str]`：
  - `Semaphore(2)` 限制并发 `soffice` 进程
  - 命中缓存直接返回；排队期间二次检查缓存
  - `subprocess.run(['soffice','--headless','--convert-to','pdf','--outdir',tmpdir, src], timeout=120)`
  - 成功后将生成的 pdf `shutil.move` 到缓存路径
  - 失败 / 超时返回 None 并清理临时文件
- `delete_pdf_cache(attachment_id, file_path)`

**新接口 `GET /{id}/office-pdf`**（`attachments_v2.py`）：

- `verify_media_token(token, id, "office-pdf")`
- 取附件；非 Office 文件 → 400
- 命中缓存 → 直接 `FileResponse` 内嵌 PDF（`Content-Disposition: inline`）
- 未命中 → **同步阻塞**调用 `convert_office_to_pdf`（信号量 + 120s 超时）；成功返回内嵌 PDF，失败 500

> 与 STP 的 202 异步轮询不同：Office 转换快（数秒），同步阻塞可让前端逻辑与 PDF 完全一致、无需轮询，浏览器原生 loading 即覆盖等待。`window.open` 为浏览器直接导航，不受 axios 30s 超时限制。

**令牌**：`_ACTION_PERM` 增加 `"office-pdf": "attachments:preview"`，复用现有预览权限，**不新增权限项**。前端 `mediaApi.token` 的 action 联合类型补 `'office-pdf'`。

**删除附件**：`delete_attachment` 增加——若 `is_office_file` 则调用 `delete_pdf_cache`，与现有 STP glb 清理并列。

## 数据流

```
[预览按钮] → previewAttachment(attId, fileName)
   ├ pdf/图片/文本 → GET media-token(preview) → 新窗口 GET /preview        → 浏览器内嵌
   ├ 压缩包        → onArchive 回调 → ArchiveTreeModal
   ├ stp/step      → GET media-token(gltf)    → 新窗口 /stp-viewer
   └ office        → GET media-token(office-pdf) → 新窗口 GET /office-pdf
                         └ 命中缓存 → 内嵌 PDF
                         └ 未命中  → soffice 转 PDF（阻塞）→ 缓存 → 内嵌 PDF
```

## 错误处理

- 令牌缺失/不匹配：沿用 `verify_media_token`（401/403）。
- 文件不存在：404。
- 非 Office 文件请求 office-pdf：400。
- soffice 转换失败/超时：500，前端新窗口显示后端错误；预览按钮 `catch` 弹「预览失败，请重试」。
- 未知扩展名：前端 `alert('该格式暂不支持预览')`。

## 测试

后端（不依赖 soffice 二进制，可在 CI/本地跑）：

- `is_office_file` 各扩展名真值。
- `get_pdf_cache_path` / `get_pdf_path_for_attachment` 路径计算。
- `_ACTION_PERM` 含 `office-pdf` 且映射到 `attachments:preview`；`issue_media_token` 对 `office-pdf` 正常签发、无权限 403。
- `/preview` 对文本类返回 `text/plain; charset=utf-8`。

依赖 LibreOffice 的实际转换：Docker 重建后手测（doc/docx/xls/xlsx/ppt/pptx 各验一例 + 缓存命中）。

前端：`npm run build` 通过；两组件改用共享函数后预览各类型手测。

## 影响与取舍

- 后端镜像因 LibreOffice 增大约 300–500MB。
- 首次转换某 Office 文件有数秒等待，之后走缓存即时。
- 复用 `attachments:preview` 权限，不扩张权限模型。
- uploads 卷新增 `pdf_cache/` 子目录。

## 部署

- 重建后端镜像（含 LibreOffice）。
- 无数据库迁移、无新增权限项、无 .env 变更。
