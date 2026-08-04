import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import katex from 'katex';
import { load as yamlLoad } from 'js-yaml';
import 'katex/dist/katex.min.css';

interface MetaEntry { key: string; value: string; }

function parseFrontmatter(raw: string): { meta: MetaEntry[]; body: string } {
  const m = raw.match(/^---\n?([\s\S]*?)\n?---\s*\n/);
  if (!m) return { meta: [], body: raw };

  try {
    const parsed = yamlLoad(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries: MetaEntry[] = [];
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          entries.push({ key: k, value: String(v) });
        } else if (Array.isArray(v)) {
          entries.push({ key: k, value: v.filter(x => x != null).map(String).join(', ') });
        }
      }
      return { meta: entries, body: raw.slice(m[0].length) };
    }
  } catch {
    // YAML 解析失败则原样渲染
  }
  return { meta: [], body: raw };
}

/**
 * Markdown / QMD 预览页。
 * - 解析 YAML frontmatter 为文档元信息卡片
 * - KaTeX 渲染 $inline$ / $$display$$ 数学公式
 * - react-markdown + rehype-raw 渲染正文
 */
export default function MarkdownReader() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rawContent, setRawContent] = useState('');

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const token = params.get('token');
  const name = params.get('name') || '文档';

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
        const text = await resp.text();
        if (!cancelled) setRawContent(text);
      } catch (e) {
        console.error('Markdown 渲染失败', e);
        if (!cancelled) setError('渲染失败，请关闭后下载查看');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, token]);

  const { meta, bodyContent } = useMemo(() => {
    if (!rawContent) return { meta: [], bodyContent: '' };
    let result = rawContent;

    // $$display$$ → KaTeX display HTML
    result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_m: string, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), {
          displayMode: true, strict: false, throwOnError: false, trust: true,
        });
      } catch { return _m; }
    });

    // $inline$ → KaTeX inline HTML（排除 $$ 残留）
    result = result.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_m: string, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), {
          displayMode: false, strict: false, throwOnError: false, trust: true,
        });
      } catch { return _m; }
    });

    const { meta: fmMeta, body } = parseFrontmatter(result);
    return { meta: fmMeta, bodyContent: body };
  }, [rawContent]);

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-100">
      <div className="shrink-0 px-4 py-3 bg-white border-b border-gray-200">
        <h1 className="text-sm font-semibold text-gray-800 truncate">文档预览：{name}</h1>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">{error}</div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">加载中...</div>
      ) : (
        <div className="flex-1 overflow-auto p-6 bg-white">
          <div className="max-w-4xl mx-auto">
            {/* 文档元信息卡片 */}
            {meta.length > 0 && (
              <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/50 overflow-hidden">
                <div className="px-4 py-2 bg-blue-100/70 border-b border-blue-200">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">文档信息</span>
                </div>
                <div className="p-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                  {meta.map((entry) => (
                    <div key={entry.key} className="contents">
                      <span className="text-gray-500 font-medium text-right whitespace-nowrap">{entry.key}</span>
                      <span className="text-gray-800 break-words">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Markdown 正文 */}
            <div className="prose prose-sm max-w-none break-words
              prose-table:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2
              prose-pre:my-3 prose-ul:my-2 prose-ol:my-2">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  table: ({ node, ...props }) => (
                    <table className="border-collapse border border-gray-300" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="border border-gray-300 px-2 py-1 bg-gray-50" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="border border-gray-300 px-2 py-1" {...props} />
                  ),
                  a: ({ node, ...props }) => (
                    <a target="_blank" rel="noreferrer" {...props} />
                  ),
                }}
              >
                {bodyContent}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
