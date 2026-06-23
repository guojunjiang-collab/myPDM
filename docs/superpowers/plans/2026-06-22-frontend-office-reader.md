# 前端 Office 在线阅读（只读 POC）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在前端弹窗内只读渲染 docx/xlsx/xls，pptx/doc/ppt 降级为下载提示，后端零改动。

**Architecture:** 复用现有 `preview` 媒体令牌 `fetch` 文件 arrayBuffer，用懒加载的 `docx-preview`（docx）与 `xlsx`/SheetJS（xlsx/xls）在新组件 `OfficeReaderModal` 内渲染。`attachmentPreview` 的 office 分支改为按格式分流到 `onOffice` 回调或下载提示。三处宿主组件仿现有 `archivePreview` 写法托管该弹窗。

**Tech Stack:** React + TypeScript + Vite + vitest；`docx-preview`（新增依赖）、`xlsx@^0.18.5`（已是依赖）。

参考 spec：`docs/superpowers/specs/2026-06-22-frontend-office-reader-design.md`

现状要点（已核对）：
- `xlsx@^0.18.5` 已在 `frontend/package.json` 且已安装；`docx-preview` 未安装，需新增。
- vitest 已配置，`frontend/src/**/*.test.ts(x)` 已有先例。
- `frontend/src/utils/attachmentPreview.ts` 现有 `previewAttachment(attId, fileName, { onArchive })`，office 分支当前是 `window.open('/office-pdf')`。
- 共享 `Modal`（`frontend/src/components/Modal.tsx`）props：`open/title/onClose/children/width('sm'|'md'|'lg'|'xl'|'full'|'3xl')/zIndex/headerAction`。
- 宿主：`EntityDocumentSection.tsx`（`archivePreview` state 在 66 行、ArchiveTreeModal 在 341 行、`previewAttachment` 调用在 165 行、`DocumentDetailContent` 用法在 321 行）；`Documents.tsx`（`archivePreview` 95 行、ArchiveTreeModal 1007 行、`DocumentDetailContent` 971 行）；`DocumentDetailContent.tsx`（`onArchivePreview` prop、`handlePreview` 69 行）。

---

## File Structure

- 新增 `frontend/src/components/OfficeReaderModal.tsx` — Office 只读渲染弹窗（取字节 + docx/xlsx 分支渲染 + 加载/错误态）。单一职责。
- 修改 `frontend/src/utils/attachmentPreview.ts` — office 分支分流：docx/xlsx/xls → `onOffice`；pptx/doc/ppt → 下载提示。
- 新增 `frontend/src/utils/attachmentPreview.test.ts` — office 分发逻辑单测。
- 修改 `frontend/src/components/DocumentDetailContent.tsx` — 新增 `onOfficePreview?` prop 上抛。
- 修改 `frontend/src/components/EntityDocumentSection.tsx` — 托管 `officeReader` state + 渲染弹窗 + 传 `onOffice`。
- 修改 `frontend/src/pages/Documents.tsx` — 同上。
- 修改 `frontend/package.json` — 新增 `docx-preview` 依赖。

---

## Task 1: 新增 docx-preview 依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 docx-preview**

Run:
```bash
cd frontend && npm install docx-preview
```
Expected: 安装成功，`package.json` 的 `dependencies` 出现 `"docx-preview"`，`node_modules/docx-preview` 存在。docx-preview 会带入 `jszip` 依赖。

- [ ] **Step 2: 验证已安装**

Run:
```bash
cd frontend && node -e "require.resolve('docx-preview'); console.log('ok')"
```
Expected: 输出 `ok`。

- [ ] **Step 3: 提交**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(frontend): 新增 docx-preview 依赖用于前端 docx 渲染"
```

---

## Task 2: attachmentPreview office 分支分流 + 单测

**Files:**
- Modify: `frontend/src/utils/attachmentPreview.ts`
- Test: `frontend/src/utils/attachmentPreview.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/utils/attachmentPreview.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewAttachment } from './attachmentPreview';

describe('previewAttachment office 分发', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  it('docx/xlsx/xls 触发 onOffice，不触发 onArchive', async () => {
    for (const name of ['a.docx', 'b.xlsx', 'c.xls', 'D.DOCX']) {
      const onOffice = vi.fn();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive, onOffice });
      expect(onOffice).toHaveBeenCalledWith('att-1', name);
      expect(onArchive).not.toHaveBeenCalled();
    }
  });

  it('pptx/doc/ppt 降级下载提示，不触发 onOffice', async () => {
    for (const name of ['a.pptx', 'b.doc', 'c.ppt']) {
      const onOffice = vi.fn();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive, onOffice });
      expect(onOffice).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('该格式暂不支持在线预览，请下载查看');
    }
  });

  it('压缩包仍触发 onArchive', async () => {
    const onOffice = vi.fn();
    const onArchive = vi.fn();
    await previewAttachment('att-1', 'x.zip', { onArchive, onOffice });
    expect(onArchive).toHaveBeenCalledWith('att-1', 'x.zip');
    expect(onOffice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd frontend && npx vitest run src/utils/attachmentPreview.test.ts
```
Expected: FAIL（`onOffice` 不是函数 / 类型不匹配 / docx 仍走 office-pdf 分支，断言不通过）

- [ ] **Step 3: 修改 attachmentPreview.ts**

将 `frontend/src/utils/attachmentPreview.ts` 整体替换为：

```ts
// frontend/src/utils/attachmentPreview.ts
import { mediaApi } from '../services/api';

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
export const TEXT_EXTS = ['txt', 'md', 'csv', 'log', 'json', 'xml'];
export const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
export const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'rar', '7z'];

const INLINE_EXTS = ['pdf', ...IMAGE_EXTS, ...TEXT_EXTS];

/** 前端可在线渲染的 Office 格式 */
export const FRONTEND_OFFICE_EXTS = ['docx', 'xlsx', 'xls'];
/** 暂不支持在线预览、仅可下载的 Office 格式 */
export const DOWNLOAD_ONLY_OFFICE_EXTS = ['pptx', 'doc', 'ppt'];

/**
 * 统一的附件预览分发。
 * - pdf/图片/文本：媒体令牌 + 新窗口内嵌 /preview
 * - 压缩包：交给调用方弹窗（opts.onArchive）
 * - stp/step：新窗口三维预览
 * - docx/xlsx/xls：交给调用方弹窗前端渲染（opts.onOffice）
 * - pptx/doc/ppt：暂不支持在线预览，提示下载
 * - 其它：提示不支持
 */
export async function previewAttachment(
  attId: string,
  fileName: string,
  opts: {
    onArchive: (attId: string, fileName: string) => void;
    onOffice: (attId: string, fileName: string) => void;
  },
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

  if (FRONTEND_OFFICE_EXTS.includes(ext)) {
    opts.onOffice(attId, fileName);
    return;
  }

  if (DOWNLOAD_ONLY_OFFICE_EXTS.includes(ext)) {
    alert('该格式暂不支持在线预览，请下载查看');
    return;
  }

  alert('该格式暂不支持预览');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd frontend && npx vitest run src/utils/attachmentPreview.test.ts
```
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/utils/attachmentPreview.ts frontend/src/utils/attachmentPreview.test.ts
git commit -m "feat(attachments): 预览 office 分支分流(docx/xlsx 前端渲染, 其余下载提示)"
```

---

## Task 3: OfficeReaderModal 组件

**Files:**
- Create: `frontend/src/components/OfficeReaderModal.tsx`

> 渲染库为运行时动态 import，实际渲染效果靠浏览器手测（Task 5）；本任务用 `npm run build` 与类型检查作为自动化关卡。

- [ ] **Step 1: 创建组件**

创建 `frontend/src/components/OfficeReaderModal.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { mediaApi } from '../services/api';

interface OfficeReaderModalProps {
  open: boolean;
  onClose: () => void;
  attachmentId: string;
  fileName: string;
}

/** 取附件原始字节（复用 preview 媒体令牌，按 arrayBuffer 读取） */
async function fetchAttachmentBytes(attId: string): Promise<ArrayBuffer> {
  const token = await mediaApi.token(attId, 'preview');
  const resp = await fetch(
    `/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(token)}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

export default function OfficeReaderModal({
  open, onClose, attachmentId, fileName,
}: OfficeReaderModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // xlsx 渲染结果：每个 sheet 的 name + html
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const docxRef = useRef<HTMLDivElement>(null);

  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  useEffect(() => {
    if (!open || !attachmentId) return;
    let cancelled = false;

    setLoading(true);
    setError('');
    setSheets([]);
    setActiveSheet(0);

    (async () => {
      try {
        const buf = await fetchAttachmentBytes(attachmentId);
        if (cancelled) return;

        if (ext === 'docx') {
          const { renderAsync } = await import('docx-preview');
          if (cancelled || !docxRef.current) return;
          docxRef.current.innerHTML = '';
          await renderAsync(buf, docxRef.current);
        } else if (ext === 'xlsx' || ext === 'xls') {
          const XLSX = await import('xlsx');
          if (cancelled) return;
          const wb = XLSX.read(buf, { type: 'array' });
          const result = wb.SheetNames.map((name) => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name]),
          }));
          if (cancelled) return;
          setSheets(result);
        } else {
          throw new Error(`不支持的格式: ${ext}`);
        }
      } catch (e) {
        if (!cancelled) setError('渲染失败，请下载查看');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, attachmentId, ext]);

  return (
    <Modal open={open} title={`文档预览：${fileName}`} onClose={onClose} width="3xl">
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-red-500">{error}</div>
      ) : ext === 'docx' ? (
        <div ref={docxRef} className="overflow-auto max-h-[70vh] bg-gray-100 p-4 rounded" />
      ) : (
        <div>
          {sheets.length > 1 && (
            <div className="flex gap-1 mb-2 border-b overflow-x-auto">
              {sheets.map((s, i) => (
                <button
                  key={s.name + i}
                  onClick={() => setActiveSheet(i)}
                  className={`px-3 py-1.5 text-sm whitespace-nowrap border-b-2 ${
                    i === activeSheet
                      ? 'border-primary-600 text-primary-600 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div
            className="overflow-auto max-h-[70vh] office-xlsx-table"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? '' }}
          />
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: 类型检查 + 构建确认**

Run:
```bash
cd frontend && npm run build
```
Expected: 构建成功，无 TS 错误（含 docx-preview / xlsx 动态 import 的类型解析）。

> 若 `xlsx` 缺少类型声明导致 `npm run build`（`tsc`）报错，在文件顶部 import 处使用 `import * as XLSX from 'xlsx'` 的动态形式已规避；如仍报 TS7016，可新增 `frontend/src/types/xlsx.d.ts` 内容 `declare module 'xlsx';`（仅在确有报错时）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/OfficeReaderModal.tsx
git commit -m "feat(attachments): OfficeReaderModal 前端只读渲染 docx/xlsx"
```

---

## Task 4: 三处宿主组件接入

**Files:**
- Modify: `frontend/src/components/DocumentDetailContent.tsx`
- Modify: `frontend/src/components/EntityDocumentSection.tsx`
- Modify: `frontend/src/pages/Documents.tsx`

- [ ] **Step 1: DocumentDetailContent 新增 onOfficePreview prop**

在 `frontend/src/components/DocumentDetailContent.tsx`：

(a) props 接口加一行（现有 `onArchivePreview?` 行下方）：

```ts
  onArchivePreview?: (attId: string, fileName: string) => void;
  onOfficePreview?: (attId: string, fileName: string) => void;
```

(b) 解构参数加入 `onOfficePreview`：

将
```ts
export default function DocumentDetailContent({ doc, customFieldDefs, customFieldValues, onArchivePreview }: DocumentDetailContentProps) {
```
改为
```ts
export default function DocumentDetailContent({ doc, customFieldDefs, customFieldValues, onArchivePreview, onOfficePreview }: DocumentDetailContentProps) {
```

(c) `handlePreview` 补 `onOffice` 回调：

将
```ts
  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, {
      onArchive: (id, name) => onArchivePreview?.(id, name),
    });
  };
```
改为
```ts
  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, {
      onArchive: (id, name) => onArchivePreview?.(id, name),
      onOffice: (id, name) => onOfficePreview?.(id, name),
    });
  };
```

- [ ] **Step 2: EntityDocumentSection 托管 officeReader**

在 `frontend/src/components/EntityDocumentSection.tsx`：

(a) 顶部 import 区新增（`ArchiveTreeModal` import 下方）：

```ts
import OfficeReaderModal from './OfficeReaderModal';
```

(b) `archivePreview` state 下方新增：

```ts
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const [officeReader, setOfficeReader] = useState<{ attId: string; fileName: string } | null>(null);
```

(c) `handlePreviewAttachment` 补 `onOffice`：

将
```ts
  const handlePreviewAttachment = (fileId: string, fileName: string) => {
    previewAttachment(fileId, fileName, {
      onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }),
    });
  };
```
改为
```ts
  const handlePreviewAttachment = (fileId: string, fileName: string) => {
    previewAttachment(fileId, fileName, {
      onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }),
      onOffice: (id, name) => setOfficeReader({ attId: id, fileName: name }),
    });
  };
```

(d) `DocumentDetailContent` 用法补 `onOfficePreview`：

将
```tsx
          <DocumentDetailContent
            doc={viewDoc}
            customFieldDefs={viewDocCustomDefs}
            customFieldValues={viewDocCustomValues}
            onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}
          />
```
改为
```tsx
          <DocumentDetailContent
            doc={viewDoc}
            customFieldDefs={viewDocCustomDefs}
            customFieldValues={viewDocCustomValues}
            onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}
            onOfficePreview={(attId, fileName) => setOfficeReader({ attId, fileName })}
          />
```

(e) 在 `archivePreview` 弹窗块（`{archivePreview && (...)}`）之后新增：

```tsx
      {officeReader && (
        <OfficeReaderModal
          open={!!officeReader}
          onClose={() => setOfficeReader(null)}
          attachmentId={officeReader.attId}
          fileName={officeReader.fileName}
        />
      )}
```

- [ ] **Step 3: Documents.tsx 托管 officeReader**

在 `frontend/src/pages/Documents.tsx`：

(a) 顶部 import 区新增（`ArchiveTreeModal` import 下方）：

```ts
import OfficeReaderModal from '../components/OfficeReaderModal';
```

(b) `archivePreview` state 下方新增：

```ts
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const [officeReader, setOfficeReader] = useState<{ attId: string; fileName: string } | null>(null);
```

(c) `DocumentDetailContent` 用法补 `onOfficePreview`：

将
```tsx
              <DocumentDetailContent
```
对应的元素中，紧接 `onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}` 之后新增一行：
```tsx
                onOfficePreview={(attId, fileName) => setOfficeReader({ attId, fileName })}
```

(d) 在 `archivePreview` 弹窗块（`{archivePreview && (...)}`）之后新增：

```tsx
      {officeReader && (
        <OfficeReaderModal
          open={!!officeReader}
          onClose={() => setOfficeReader(null)}
          attachmentId={officeReader.attId}
          fileName={officeReader.fileName}
        />
      )}
```

- [ ] **Step 4: 构建确认**

Run:
```bash
cd frontend && npm run build
```
Expected: 构建成功，无 TS 错误（`previewAttachment` 的 `opts` 现在要求 `onOffice`，三处调用方均已提供）。

- [ ] **Step 5: 运行前端单测确认无回归**

Run:
```bash
cd frontend && npm test
```
Expected: 全部通过（含新增 attachmentPreview 用例与既有测试）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/DocumentDetailContent.tsx frontend/src/components/EntityDocumentSection.tsx frontend/src/pages/Documents.tsx
git commit -m "feat(attachments): 宿主组件接入 OfficeReaderModal 前端 office 预览"
```

---

## Task 5: 浏览器手测（端到端验证）

**前置：** 已完成 Task 1–4 提交并能本地起前端（`cd frontend && npm run dev` 或经 docker-compose 起的前端）。

- [ ] **Step 1: docx 预览**

在图文档详情 / 实体文档区点一个 `.docx` 附件「预览」，确认弹窗内渲染出文档内容（标题/段落/表格/图片），中文正常，滚动可用。

- [ ] **Step 2: xlsx/xls 预览**

点一个多 sheet 的 `.xlsx`（及一个 `.xls`）「预览」，确认表格渲染、sheet 标签可切换、中文正常。

- [ ] **Step 3: 降级格式**

点 `.pptx` / `.doc` / `.ppt`「预览」，确认弹出「该格式暂不支持在线预览，请下载查看」，不打开弹窗。

- [ ] **Step 4: 回归既有预览**

确认 pdf/图片/文本/压缩包/stp 预览仍按原行为工作（PDF/图片/文本新标签内嵌、压缩包树、stp 三维）。

- [ ] **Step 5: 错误态**

对一个损坏或超大文件触发预览，确认弹窗显示「渲染失败，请下载查看」或「加载中...」后报错，不卡死页面。

---

## Self-Review

**Spec coverage：**
- 复用 preview 令牌取 arrayBuffer → Task 3 `fetchAttachmentBytes` ✅
- OfficeReaderModal（docx-preview / SheetJS / 加载/错误态 / 多 sheet）→ Task 3 ✅
- attachmentPreview office 分流（docx/xlsx/xls→onOffice；pptx/doc/ppt→下载提示）→ Task 2 ✅
- 三处宿主接入（DocumentDetailContent prop + EntityDocumentSection + Documents 托管弹窗）→ Task 4 ✅
- 依赖：docx-preview 新增、xlsx 复用 → Task 1（xlsx 已是依赖，无需再装）✅
- 后端零改动 → 全计划不含后端文件 ✅
- 测试（分发单测 + build + 手测）→ Task 2、3、4、5 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码；xlsx 类型声明的「仅在报错时」分支是明确的条件性补救，非占位。

**Type consistency：** `previewAttachment` 的 `opts` 在 Task 2 定为 `{ onArchive, onOffice }`，Task 4 三处调用均提供两者；`OfficeReaderModalProps`（open/onClose/attachmentId/fileName）在 Task 3 定义，Task 4 两处渲染按同名传入；`onOfficePreview` prop 在 Task 4 Step 1 定义、Step 2/3 使用，命名一致。
