// frontend/src/utils/attachmentPreview.ts
import { mediaApi } from '../services/api';

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
export const TEXT_EXTS = ['txt', 'md', 'csv', 'log', 'json', 'xml'];
export const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'rar', '7z'];

const INLINE_EXTS = ['pdf', ...IMAGE_EXTS, ...TEXT_EXTS];

/** 前端可在线渲染的 Office 格式（仅 Excel，保真度可接受） */
export const FRONTEND_OFFICE_EXTS = ['xlsx', 'xls'];
/** 经后端 LibreOffice 转 PDF 预览的 Office 格式（前端渲染保真度差） */
export const BACKEND_PDF_OFFICE_EXTS = ['docx', 'doc', 'ppt', 'pptx'];

function _permissionError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'response' in e) {
    return (e as any).response?.status === 403;
  }
  return false;
}

/**
 * 统一的附件预览分发。
 * - pdf/图片/文本：媒体令牌 + 新窗口内嵌 /preview
 * - 压缩包：交给调用方弹窗（opts.onArchive）
 * - stp/step：新窗口三维预览
 * - xlsx/xls：媒体令牌 + 新标签页前端渲染（/office-reader）
 * - docx/doc/ppt/pptx：媒体令牌 + 新标签页内嵌后端转换的 PDF（/office-pdf）
 * - 其它：提示不支持
 */
export async function previewAttachment(
  attId: string,
  fileName: string,
  opts: {
    onArchive: (attId: string, fileName: string) => void;
  },
): Promise<void> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (INLINE_EXTS.includes(ext)) {
    try {
      const mt = await mediaApi.token(attId, 'preview');
      window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
    } catch (e) { alert(_permissionError(e) ? '无权限访问该附件' : '预览失败，请重试'); }
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
    } catch (e) { alert(_permissionError(e) ? '无权限访问该附件' : '预览失败，请重试'); }
    return;
  }

  if (FRONTEND_OFFICE_EXTS.includes(ext)) {
    try {
      const mt = await mediaApi.token(attId, 'preview');
      window.open(
        `/office-reader?id=${attId}&token=${encodeURIComponent(mt)}&name=${encodeURIComponent(fileName)}`,
        '_blank',
      );
    } catch (e) { alert(_permissionError(e) ? '无权限访问该附件' : '预览失败，请重试'); }
    return;
  }

  if (BACKEND_PDF_OFFICE_EXTS.includes(ext)) {
    try {
      const mt = await mediaApi.token(attId, 'office-pdf');
      window.open(`/api/v2/attachments/${attId}/office-pdf?token=${encodeURIComponent(mt)}`, '_blank');
    } catch (e) { alert(_permissionError(e) ? '无权限访问该附件' : '预览失败，请重试'); }
    return;
  }

  alert('该格式暂不支持预览');
}
