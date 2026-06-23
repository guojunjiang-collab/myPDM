import { useEffect, useRef, useState } from 'react';

/**
 * Office 文档只读阅读页（独立标签页）。
 * 通过 /office-reader?id=...&token=...&name=... 打开：
 * - 用 preview 媒体令牌 fetch 附件字节（arrayBuffer）
 * - docx 用 docx-preview 渲染；xlsx/xls 用 SheetJS 渲染为表格
 * 渲染库均动态 import，按需加载。
 */
export default function OfficeReader() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // xlsx 渲染结果：每个 sheet 的 name + html
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const docxRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const token = params.get('token');
  const name = params.get('name') || '文档';
  const ext = name.split('.').pop()?.toLowerCase() || '';

  useEffect(() => {
    document.title = `预览：${name}`;
  }, [name]);

  useEffect(() => {
    if (!id || !token) { setError('参数缺失，无法预览'); setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(
          `/api/v2/attachments/${id}/preview?token=${encodeURIComponent(token)}`,
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
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
          const result = wb.SheetNames.map((sheetName) => ({
            name: sheetName,
            html: XLSX.utils.sheet_to_html(wb.Sheets[sheetName]),
          }));
          if (cancelled) return;
          setSheets(result);
        } else {
          throw new Error(`不支持的格式: ${ext}`);
        }
      } catch (e) {
        console.error('Office 预览渲染失败', e);
        if (!cancelled) setError('渲染失败，请关闭后下载查看');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, token, ext]);

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-100">
      <div className="shrink-0 px-4 py-3 bg-white border-b border-gray-200">
        <h1 className="text-sm font-semibold text-gray-800 truncate">文档预览：{name}</h1>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">{error}</div>
      ) : ext === 'docx' ? (
        // docx 容器须始终挂载，否则 renderAsync 时 ref 为空导致渲染落空
        <div className="flex-1 overflow-auto p-6 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">加载中...</div>
          )}
          <div ref={docxRef} />
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">加载中...</div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {sheets.length > 1 && (
            <div className="shrink-0 flex gap-1 px-4 pt-2 border-b bg-white overflow-x-auto">
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
            className="flex-1 overflow-auto p-4 office-xlsx-table bg-white"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? '' }}
          />
        </div>
      )}
    </div>
  );
}
