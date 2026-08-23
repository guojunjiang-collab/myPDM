import { useState } from 'react';
import { mediaApi } from '../../services/api';
import Button from '../../components/ui/Button';

/**
 * 移动端附件预览（统一交互：预览按钮 → 新浏览器标签打开）：
 * - PDF          → /preview（浏览器内嵌 PDF）
 * - 图片          → /preview（浏览器原生显示图片）
 * - Office       → /office-pdf（LibreOffice 转 PDF）
 * - xlsx/xls     → /office-reader（前端渲染表格）
 * - STP/STEP     → /stp-viewer（三维查看器）
 * - Markdown     → /markdown-reader（react-markdown 渲染）
 * - 文本          → /preview（浏览器原生显示纯文本）
 * - HTML         → /preview（浏览器原生渲染网页）
 * - 其余          → 不可预览（仅附件卡片）
 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const STP_EXTS = ['stp', 'step'];
const MD_EXTS = ['md', 'markdown', 'qmd'];
const TEXT_EXTS = ['txt', 'csv', 'log', 'json', 'xml'];
const HTML_EXTS = ['html', 'htm'];

export interface PreviewAttachment {
  id: string;
  file_name?: string;
  file_size?: number;
}

function extOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function fmtSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPermissionError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'response' in e) {
    return (e as any).response?.status === 403;
  }
  return false;
}

/** 附件扩展名是否可预览 */
export function isAttachmentPreviewable(fileName?: string): boolean {
  const ext = extOf(fileName || '');
  return (
    IMAGE_EXTS.includes(ext) ||
    ext === 'pdf' ||
    OFFICE_EXTS.includes(ext) ||
    STP_EXTS.includes(ext) ||
    MD_EXTS.includes(ext) ||
    TEXT_EXTS.includes(ext) ||
    HTML_EXTS.includes(ext)
  );
}

/** 在新浏览器标签打开附件预览（按扩展名分流） */
export async function openAttachmentInNewTab(att: PreviewAttachment): Promise<void> {
  const fileName = att.file_name || '附件';
  const ext = extOf(fileName);
  try {
    if (STP_EXTS.includes(ext)) {
      const t = await mediaApi.token(att.id, 'gltf');
      window.open(
        `/stp-viewer?id=${encodeURIComponent(att.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } else if (OFFICE_EXTS.includes(ext) && ext !== 'xls' && ext !== 'xlsx') {
      const t = await mediaApi.token(att.id, 'office-pdf');
      window.open(
        `/api/v2/attachments/${att.id}/office-pdf?token=${encodeURIComponent(t)}`,
        '_blank',
      );
    } else if (ext === 'xls' || ext === 'xlsx') {
      const t = await mediaApi.token(att.id, 'preview');
      window.open(
        `/office-reader?id=${encodeURIComponent(att.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } else if (MD_EXTS.includes(ext)) {
      const t = await mediaApi.token(att.id, 'preview');
      window.open(
        `/markdown-reader?id=${encodeURIComponent(att.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } else {
      const t = await mediaApi.token(att.id, 'preview');
      window.open(
        `/api/v2/attachments/${att.id}/preview?token=${encodeURIComponent(t)}`,
        '_blank',
      );
    }
  } catch (e) {
    if (isPermissionError(e)) throw new Error('无权限访问该附件');
    throw new Error('预览失败，请重试');
  }
}

/** 附件卡片 + 预览按钮（统一交互，供附件 Tab 使用） */
export default function AttachmentPreview({ attachment }: { attachment: PreviewAttachment }) {
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const fileName = attachment.file_name || '附件';
  const previewable = isAttachmentPreviewable(fileName);
  const isStp = STP_EXTS.includes(extOf(fileName));

  const onPreview = async () => {
    setConverting(true);
    setError(null);
    try {
      await openAttachmentInNewTab(attachment);
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败，请重试');
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 break-all">{fileName}</div>
          {attachment.file_size != null && (
            <div className="text-xs text-gray-500 mt-0.5">{fmtSize(attachment.file_size)}</div>
          )}
        </div>
        {previewable && (
          <Button
            onClick={onPreview}
            disabled={converting}
            variant="primary"
            size="xs"
            className="shrink-0 min-h-10 px-3 rounded-lg"
          >
            {converting ? (isStp ? '加载中...' : '转换中...') : isStp ? '3D 预览' : '预览'}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
