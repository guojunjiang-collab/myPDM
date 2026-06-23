# 前端 Office 在线阅读（只读 POC）设计文档

日期：2026-06-22
分支：dev

## 背景

图文档附件 Office 预览当前走「后端 LibreOffice → PDF → 浏览器内嵌」路径（已实现并合并：`backend/app/office_converter.py`、`GET /attachments/{id}/office-pdf`、`frontend/src/utils/attachmentPreview.ts` 的 office 分支）。该方案保真度高、格式覆盖全，但后端镜像因 LibreOffice 增大约 300–500MB，且首次转换有数秒等待。

本设计探索一条**纯前端渲染**的替代路径（只读，不可编辑），作为 POC 评估其效果，再决定是否替换后端方案。

## 目标

- 在前端（浏览器内）直接渲染 `.docx`、`.xlsx`/`.xls` 的只读视图，无需后端转换。
- `.pptx`、`.doc`、`.ppt` 降级为下载提示（纯 JS 方案弱/缺失）。
- **后端完全不动**：保留 `office-pdf` 接口、`office_converter.py`、Dockerfile 的 LibreOffice，作为对照随时可切回。

## 非目标

- 不做 Office 编辑（只读）。
- 不渲染 pptx / 旧版 .doc / .ppt（库不成熟，POC 不纳入）。
- 不删除/修改任何后端 Office 相关代码。
- 不追求与桌面 Office 像素级一致的保真度。

## 格式分工

| 扩展名 | 处理 |
|--------|------|
| docx | 前端 `docx-preview` 渲染（样式/表格/图片，保真度较高） |
| xlsx · xls | 前端 `SheetJS(xlsx)` 解析 → 多 sheet 标签页 + HTML 表格（只读，公式显示计算值） |
| pptx · doc · ppt | 弹「该格式暂不支持在线预览，请下载查看」 |

## 总体方案

复用现有 `preview` 媒体令牌取文件字节，前端用懒加载的库在弹窗内渲染。零后端改动。

### 1. 取文件字节（复用现有接口）

前端取 `preview` 媒体令牌 → `fetch('/api/v2/attachments/{id}/preview?token=...')` 读取 `arrayBuffer`。`/preview` 接口已存在；按 arrayBuffer 读取不受 `Content-Disposition: inline` 影响，无需任何后端改动。

> 注：`/preview` 对 docx/xlsx 这类未在 `_TEXT_PREVIEW_EXTS` 的扩展名，mime 仍走 `mimetypes.guess_type`（office mime 或 octet-stream），对 arrayBuffer 读取无影响。

### 2. 新组件 `frontend/src/components/OfficeReaderModal.tsx`

仿现有 `ArchiveTreeModal.tsx` 弹窗模式，复用共享 `Modal` 组件（props：`open` / `title` / `onClose` / `width`）。

Props：

```ts
interface OfficeReaderModalProps {
  open: boolean;
  onClose: () => void;
  attachmentId: string;
  fileName: string;
}
```

内部逻辑：

- `open && attachmentId` 时：取 `preview` 令牌 → fetch arrayBuffer → 按扩展名分支渲染。
- **动态 import 懒加载**渲染库，避免撑大主包：
  - docx：`const { renderAsync } = await import('docx-preview')` → `renderAsync(buffer, containerRef.current)`
  - xlsx/xls：`const XLSX = await import('xlsx')` → `XLSX.read(buffer, { type: 'array' })` → 遍历 `workbook.SheetNames` → `XLSX.utils.sheet_to_html(sheet)`，多 sheet 用标签页切换
- 状态：`loading` / `error`（渲染失败 → 提示「渲染失败，请下载查看」）/ 成功。
- docx 渲染目标是一个 `ref` 容器 `<div>`；xlsx 渲染为受控的 sheet 标签 + `dangerouslySetInnerHTML` 注入 `sheet_to_html` 结果（内容来自受信任的内部附件）。
- UI 沿用现有风格（primary 配色、`max-h-[60vh]` 滚动容器、与 ArchiveTreeModal 一致的加载/错误文案样式）。

### 3. 改 `frontend/src/utils/attachmentPreview.ts` 的 Office 分支

`opts` 增加 `onOffice` 回调（与现有 `onArchive` 同模式）：

```ts
opts: {
  onArchive: (attId: string, fileName: string) => void;
  onOffice: (attId: string, fileName: string) => void;
}
```

office 分支替换为：

```ts
const FRONTEND_OFFICE_EXTS = ['docx', 'xlsx', 'xls'];
const DOWNLOAD_ONLY_OFFICE_EXTS = ['pptx', 'doc', 'ppt'];

if (FRONTEND_OFFICE_EXTS.includes(ext)) {
  opts.onOffice(attId, fileName);
  return;
}
if (DOWNLOAD_ONLY_OFFICE_EXTS.includes(ext)) {
  alert('该格式暂不支持在线预览，请下载查看');
  return;
}
```

移除原 office 分支中 `window.open('/office-pdf')` 的调用（后端接口保留，但前端 POC 不再调用）。pdf/图片/文本/压缩包/stp 分支不变。

### 4. 宿主组件接入

三处宿主沿用它们托管 `archivePreview` 的同一写法，新增 `officeReader` 状态并渲染 `<OfficeReaderModal>`：

- `frontend/src/components/EntityDocumentSection.tsx`：已有 `archivePreview` state 与 ArchiveTreeModal，平行新增 `officeReader` state；`previewAttachment(...)` 调用补 `onOffice` 回调。
- `frontend/src/pages/Documents.tsx`：已有 `archivePreview` state 与 ArchiveTreeModal（约 95 / 1010 行），平行新增。
- `frontend/src/components/DocumentDetailContent.tsx`：仿现有 `onArchivePreview` prop，新增 `onOfficePreview?` prop 上抛；`handlePreview` 把 `onOffice` 接到该 prop。

### 5. 依赖

`frontend/package.json` 新增：

- `docx-preview`（最新稳定版；依赖 jszip）
- `xlsx`（SheetJS，锁定 npm `0.18.5`）

均纯浏览器、动态 import，不进主 bundle 首屏。

## 数据流

```
预览按钮 → previewAttachment(attId, fileName, {onArchive, onOffice})
  ├ docx/xlsx/xls → onOffice → OfficeReaderModal
  │     └ token(preview) → fetch /preview (arrayBuffer)
  │         ├ docx → docx-preview.renderAsync → 容器 div
  │         └ xlsx/xls → SheetJS.read → sheet_to_html → 标签页表格
  ├ pptx/doc/ppt → alert 下载提示
  └ （pdf/图片/文本/压缩包/stp 维持原行为）
```

## 错误处理

- 取令牌 / fetch 失败：弹窗内显示「加载失败，请重试」。
- 渲染库抛错（文件损坏/格式异常）：弹窗内显示「渲染失败，请下载查看」。
- 不支持的 office 扩展名（pptx/doc/ppt）：`alert` 下载提示，不开弹窗。

## 测试

- 前端 `npm run build` 通过（含动态 import 分包）。
- `attachmentPreview` 的 office 分发逻辑可单测：docx/xlsx/xls → 触发 `onOffice`；pptx/doc/ppt → 触发降级（不调用 `onOffice`/不 `window.open`）。
- docx/xlsx 实际渲染效果、多 sheet 切换、中文显示：浏览器手测。

## 影响与取舍

- docx/xlsx 渲染在弹窗内（DOM），不能像 PDF 那样 `window.open` 新标签——前端渲染必须在 React 内。
- xlsx 丢失部分格式（单元格颜色、合并单元格部分支持、公式显示结果值）；docx 复杂排版可能有偏差。
- 后端 Office 代码暂时变为「前端不调用」的死路径——POC 验证满意后，再单独决定是否移除后端 LibreOffice（届时镜像可减 300–500MB）。
- 引入两个较大的前端依赖，靠动态 import 控制首屏体积。

## 部署

- 仅前端构建变更，无后端改动、无数据库迁移、无新增权限、无 .env 变更。
