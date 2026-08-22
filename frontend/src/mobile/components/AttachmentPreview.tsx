import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { mediaApi } from '../../services/api';

/**
 * 移动端附件预览组件（只读）。
 * 按扩展名分流（对齐桌面版 utils/attachmentPreview.ts 的取 token 逻辑）：
 * - PDF          → mediaApi.token(id,'preview') + 新标签打开 /preview 内嵌预览
 * - 图片          → mediaApi.token(id,'preview') + <img> 直链内嵌显示
 * - Office       → mediaApi.token(id,'office-pdf') + 新标签打开 /office-pdf
 *                  （后端 office-pdf 端点同步 LibreOffice 转 PDF，命中缓存直接返回）
 * - STP/STEP     → mediaApi.token(id,'gltf') + SPA 跳转 /stp-viewer 三维预览
 * - Markdown     → 内嵌 react-markdown 渲染（md/markdown/qmd）
 * - 文本          → 内嵌纯文本显示（txt/csv/log/json/xml，json 自动美化）
 * - 其余          → 普通附件卡片（文件名+大小），不提示用电脑浏览器
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

/** JSON 内容美化（解析失败返回原文） */
function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function isPermissionError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'response' in e) {
    return (e as any).response?.status === 403;
  }
  return false;
}

export default function AttachmentPreview({ attachment }: { attachment: PreviewAttachment }) {
  const navigate = useNavigate();
  const fileName = attachment.file_name || '附件';
  const ext = extOf(fileName);
  const isImage = IMAGE_EXTS.includes(ext);
  const isPdf = ext === 'pdf';
  const isOffice = OFFICE_EXTS.includes(ext);
  const isStp = STP_EXTS.includes(ext);
  const isMd = MD_EXTS.includes(ext);
  const isText = TEXT_EXTS.includes(ext);

  const [imgToken, setImgToken] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  // Markdown / 文本：内嵌内容
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textFailed, setTextFailed] = useState(false);

  // 文本/Markdown：挂载时取令牌并拉取内容（令牌 ttl 300s，足够本次浏览）
  useEffect(() => {
    if (!isText && !isMd) return;
    let alive = true;
    setTextLoading(true);
    setTextFailed(false);
    setTextContent(null);
    mediaApi
      .token(attachment.id, 'preview')
      .then(async (t) => {
        const resp = await fetch(
          `/api/v2/attachments/${attachment.id}/preview?token=${encodeURIComponent(t)}`,
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (alive) setTextContent(text);
      })
      .catch(() => {
        if (alive) setTextFailed(true);
      })
      .finally(() => {
        if (alive) setTextLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attachment.id, isText, isMd]);

  // 图片：挂载时取媒体令牌，<img> 直链内嵌显示（令牌 ttl 300s，足够本次浏览）
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    setError(null);
    setImgFailed(false);
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

  // STP/STEP：取 gltf 媒体令牌 → SPA 跳转移动端三维查看器（/stp-viewer）
  const openStp = async () => {
    setConverting(true);
    setError(null);
    try {
      const t = await mediaApi.token(attachment.id, 'gltf');
      navigate(`/stp-viewer?id=${encodeURIComponent(attachment.id)}&token=${encodeURIComponent(t)}&name=${encodeURIComponent(fileName)}`);
    } catch (e) {
      setError(isPermissionError(e) ? '无权限访问该附件' : '3D 预览失败，请重试');
    } finally {
      setConverting(false);
    }
  };

  if (!isImage && !isPdf && !isOffice && !isStp && !isMd && !isText) {
    // 无法预览的格式（如 CAD 源文件 .CATPart）：给出附件列表即可，不提示用电脑浏览器
    return (
      <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 break-all">{fileName}</div>
            {attachment.file_size != null && (
              <div className="text-xs text-gray-500 mt-0.5">{fmtSize(attachment.file_size)}</div>
            )}
          </div>
          <span className="shrink-0 text-xs text-gray-400">附件</span>
        </div>
      </div>
    );
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
        {isStp && (
          <button
            onClick={openStp}
            disabled={converting}
            className="shrink-0 min-h-10 px-3 rounded-lg bg-primary-600 text-white text-xs disabled:opacity-60"
          >
            {converting ? '加载中...' : '3D 预览'}
          </button>
        )}
      </div>

      {isImage && (
        <div className="mt-2">
          {error && <p className="text-xs text-red-500 py-2 text-center">{error}</p>}
          {!error && !imgToken && <p className="text-xs text-gray-400 py-2 text-center">加载中...</p>}
          {!error && imgToken && !imgFailed && (
            <img
              src={`/api/v2/attachments/${attachment.id}/preview?token=${encodeURIComponent(imgToken)}`}
              alt={fileName}
              onError={() => setImgFailed(true)}
              className="max-w-full max-h-72 rounded-lg border border-gray-100 bg-gray-50 object-contain"
            />
          )}
          {!error && imgToken && imgFailed && (
            <p className="text-xs text-red-500 py-2 text-center">图片加载失败，请重试</p>
          )}
        </div>
      )}

      {isPdf && error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {isOffice && !converting && error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {isStp && !converting && error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      {/* Markdown / 文本：内嵌内容 */}
      {(isMd || isText) && (
        <div className="mt-2">
          {textLoading && <p className="text-xs text-gray-400 py-2 text-center">加载中...</p>}
          {!textLoading && textFailed && (
            <p className="text-xs text-red-500 py-2 text-center">内容加载失败，请重试</p>
          )}
          {!textLoading && !textFailed && textContent != null && (
            isMd ? (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="prose prose-sm max-w-none prose-headings:font-semibold">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {textContent}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <pre className="max-h-80 overflow-y-auto text-xs text-gray-700 whitespace-pre-wrap break-words rounded-lg border border-gray-100 bg-gray-50 p-3">
                {ext === 'json' ? prettyJson(textContent) : textContent}
              </pre>
            )
          )}
        </div>
      )}
    </div>
  );
}
