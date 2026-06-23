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
