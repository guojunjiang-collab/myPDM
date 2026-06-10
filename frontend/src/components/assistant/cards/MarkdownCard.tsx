import { authedDownload } from '../../../services/assistantApi';
import Markdown from '../Markdown';
interface Props { payload: { title?: string; preview: string; download_url: string }; }
export default function MarkdownCard({ payload }: Props) {
  return (
    <div className="border rounded-lg my-2">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
        <span className="text-sm font-medium">{payload.title || '文档'}</span>
        <div className="flex gap-2">
          <button onClick={() => navigator.clipboard.writeText(payload.preview)}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-100">复制</button>
          <button onClick={() => authedDownload(payload.download_url)}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">下载 .md</button>
        </div>
      </div>
      <div className="p-3 max-h-72 overflow-auto">
        <Markdown>{payload.preview}</Markdown>
      </div>
    </div>
  );
}
