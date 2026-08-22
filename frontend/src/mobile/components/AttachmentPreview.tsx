import { useEffect, useState } from 'react';
import { mediaApi } from '../../services/api';

/**
 * 移动端附件预览组件（只读）。
 * 统一交互：附件卡片 + 「预览」按钮，点击后在新浏览器标签中打开：
 * - PDF          → mediaApi.token(id,'preview') + 新标签打开 /preview（浏览器内嵌 PDF）
 * - 图片          → 新标签打开 /preview（浏览器原生显示图片）
 * - Office       → mediaApi.token(id,'office-pdf') + 新标签打开 /office-pdf（LibreOffice 转 PDF）
 * - xlsx/xls     → mediaApi.token(id,'preview') + 新标签打开 /office-reader（前端渲染表格）
 * - STP/STEP     → mediaApi.token(id,'gltf') + 新标签打开 /stp-viewer（三维查看器）
 * - Markdown     → 新标签打开 /markdown-reader（react-markdown 渲染）
 * - 文本          → 新标签打开 /preview（浏览器原生显示纯文本）
 * - 其余          → 普通附件卡片（文件名+大小）
 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const STP_EXTS = ['stp', 'step'];
const MD_EXTS = ['md', 'markdown', 'qmd'];
const TEXT_EXTS = ['txt', 'csv', 'log', 'json', 'xml'];

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

export default function AttachmentPreview({ attachment }: { attachment: PreviewAttachment }) {
  const fileName = attachment.file_name || '附件';
  const ext = extOf(fileName);
  const isImage = IMAGE_EXTS.includes(ext);
  const isPdf = ext === 'pdf';
  const isOffice = OFFICE_EXTS.includes(ext);
  const isXlsx = ext === 'xls' || ext === 'xlsx';
  const isStp = STP_EXTS.includes(ext);
  const isMd = MD_EXTS.includes(ext);
  const isText = TEXT_EXTS.includes(ext);

  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  // 通用：取 preview 令牌 → 新标签打开（图片/文本/PDF/xlsx）
  const openPreviewUrl = async () => {
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'preview');
      window.open(
        `/api/v2/attachments/${attachment.id}/preview?token=${encodeURIComponent(t)}`,
        '_blank',
      );
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '预览失败，请重试');
    }
  };

  // PDF：新标签打开浏览器内嵌预览
  const openPdf = () => openPreviewUrl();

  // Office：提示转换中 → 取 office-pdf 令牌 → 新标签打开
  // 后端 /office-pdf 端点会同步调用 LibreOffice 转换（有缓存与 120s 超时），
  // 新标签页即转换触发点，转换完成后内嵌 PDF。
  const openOffice = async () => {
    setConverting(true);
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'office-pdf');
      window.open(
        `/api/v2/attachments/${attachment.id}/office-pdf?token=${encodeURIComponent(t)}`,
        '_blank',
      );
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '转换/预览失败，请重试');
    } finally {
      setConverting(false);
    }
  };

  // xlsx/xls：新标签打开前端渲染页面（/office-reader）
  const openOfficeReader = async () => {
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'preview');
      window.open(
        `/office-reader?id=${encodeURIComponent(attachment.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '预览失败，请重试');
    }
  };

  // STP/STEP：取 gltf 媒体令牌 → 新标签打开移动端三维查看器
  const openStp = async () => {
    setConverting(true);
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'gltf');
      window.open(
        `/stp-viewer?id=${encodeURIComponent(attachment.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '3D 预览失败，请重试');
    } finally {
      setConverting(false);
    }
  };

  // Markdown：新标签打开 /markdown-reader（react-markdown 渲染）
  const openMarkdown = async () => {
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'preview');
      window.open(
        `/markdown-reader?id=${encodeURIComponent(attachment.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '预览失败，请重试');
    }
  };

  const previewable = isImage || isPdf || isOffice || isStp || isMd || isText;

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
          <button
            onClick={
              isOffice && !isXlsx
                ? openOffice
                : isXlsx
                  ? openOfficeReader
                  : isStp
                    ? openStp
                    : isMd
                      ? openMarkdown
                      : openPreviewUrl
            }
            disabled={converting}
            className="shrink-0 min-h-10 px-3 rounded-lg bg-primary-600 text-white text-xs disabled:opacity-60"
          >
            {converting ? (isStp ? '加载中...' : '转换中...') : isStp ? '3D 预览' : '预览'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
