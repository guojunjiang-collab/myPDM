import { authedDownload } from '../../../services/assistantApi';
interface Props { payload: { label?: string; url: string }; }
export default function DownloadCard({ payload }: Props) {
  return (
    <button onClick={() => authedDownload(payload.url)}
      className="my-2 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
      ⬇ {payload.label || '下载'}
    </button>
  );
}
