import { useEffect, useState } from 'react';
import { mediaApi } from '../../services/api';
import DesktopOnlyCard from './DesktopOnlyCard';

/**
 * 移动端附件预览组件（只读）。
 * 按扩展名分流（对齐桌面版 utils/attachmentPreview.ts 的取 token 逻辑）：
 * - PDF          → mediaApi.token(id,'preview') + 新标签打开 /preview 内嵌预览
 * - 图片          → mediaApi.token(id,'preview') + <img> 直链内嵌显示
 * - Office       → mediaApi.token(id,'office-pdf') + 新标签打开 /office-pdf
 *                  （后端 office-pdf 端点同步 LibreOffice 转 PDF，命中缓存直接返回）
 * - 其余          → DesktopOnlyCard（暂不支持手机，请使用电脑浏览器）
 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

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

  const [imgToken, setImgToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  // 图片：挂载时取媒体令牌，<img> 直链内嵌显示（令牌 ttl 300s，足够本次浏览）
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    setError(null);
    mediaApi
      .token(attachment.id, 'preview')
      .then((t) => {
        if (alive) setImgToken(t);
      })
      .catch((e) => {
        if (alive) setError(isPermissionError(e) ? '无权限访问该附件' : '预览加载失败，请重试');
      });
    return () => {
      alive = false;
    };
  }, [attachment.id, isImage]);

  // PDF：新标签打开浏览器内嵌预览
  const openPdf = async () => {
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'preview');
      window.open(`/api/v2/attachments/${attachment.id}/preview?token=${encodeURIComponent(t)}`, '_blank');
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '预览失败，请重试');
    }
  };

  // Office：提示转换中 → 取 office-pdf 令牌 → 新标签打开
  // 后端 /office-pdf 端点会同步调用 LibreOffice 转换（有缓存与 120s 超时），
  // 新标签页即转换触发点，转换完成后内嵌 PDF。
  const openOffice = async () => {
    setConverting(true);
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'office-pdf');
      window.open(`/api/v2/attachments/${attachment.id}/office-pdf?token=${encodeURIComponent(t)}`, '_blank');
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '转换/预览失败，请重试');
    } finally {
      setConverting(false);
    }
  };

  if (!isImage && !isPdf && !isOffice) {
    return <DesktopOnlyCard feature={fileName} />;
  }

  return (
    <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 break-all">{fileName}</div>
          {attachment.file_size != null && (
            <div className="text-xs text-gray-500 mt-0.5">{fmtSize(attachment.file_size)}</div>
          )}
        </div>
        {isPdf && (
          <button
            onClick={openPdf}
            className="shrink-0 min-h-10 px-3 rounded-lg bg-primary-600 text-white text-xs"
          >
            预览
          </button>
        )}
        {isOffice && (
          <button
            onClick={openOffice}
            disabled={converting}
            className="shrink-0 min-h-10 px-3 rounded-lg bg-primary-600 text-white text-xs disabled:opacity-60"
          >
            {converting ? '转换中...' : '预览'}
          </button>
        )}
      </div>

      {isImage && (
        <div className="mt-2">
          {error && <p className="text-xs text-red-500 py-2 text-center">{error}</p>}
          {!error && !imgToken && <p className="text-xs text-gray-400 py-2 text-center">加载中...</p>}
          {!error && imgToken && (
            <img
              src={`/api/v2/attachments/${attachment.id}/preview?token=${encodeURIComponent(imgToken)}`}
              alt={fileName}
              className="max-w-full max-h-72 rounded-lg border border-gray-100 bg-gray-50 object-contain"
            />
          )}
        </div>
      )}

      {isPdf && error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {isOffice && !converting && error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
