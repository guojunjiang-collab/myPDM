import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props { children: string; }

/**
 * 统一的 Markdown 渲染：GFM（表格/删除线等）+ prose 排版。
 * 对表格补边框与紧凑间距，适配聊天窗的小尺寸。
 */
export default function Markdown({ children }: Props) {
  return (
    <div className="prose prose-sm max-w-none break-words
      prose-table:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5
      prose-pre:my-2 prose-ul:my-1.5 prose-ol:my-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
        {children}
      </ReactMarkdown>
    </div>
  );
}
