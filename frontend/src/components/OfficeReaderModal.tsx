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
        console.error('Office 预览渲染失败', e);
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
          {/* sheet_to_html 生成的表格 HTML；内容来自受信任的内部附件，无脚本注入 */}
          <div
            className="overflow-auto max-h-[70vh] office-xlsx-table"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? '' }}
          />
        </div>
      )}
    </Modal>
  );
}
