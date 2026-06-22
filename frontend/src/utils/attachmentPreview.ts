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
