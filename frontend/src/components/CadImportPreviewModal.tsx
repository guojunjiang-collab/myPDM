import { Modal } from './Modal';
import type { MatchedFileItem } from '../types';

interface Props {
  open: boolean;
  items: MatchedFileItem[];
  unmatched: string[];
  summary: {
    total_files: number;
    matched_count: number;
    unmatched_count: number;
    will_overwrite_count: number;
    blocked_count: number;
  };
  onClose: () => void;
  onComplete: () => void;
}

const statusConfig: Record<string, { label: string; cls: string }> = {
  matched: { label: '匹配', cls: 'text-green-600' },
  overwrite: { label: '覆盖', cls: 'text-yellow-600' },
  blocked: { label: '未签出', cls: 'text-red-600' },
  unmatched: { label: '未匹配', cls: 'text-gray-400' },
};

function getItemStatus(item: MatchedFileItem): keyof typeof statusConfig {
  if (!item.can_upload) return 'blocked';
  if (item.existing_count > 0) return 'overwrite';
  return 'matched';
}

export default function CadImportPreviewModal({ open, items, unmatched, summary, onClose, onComplete }: Props) {

  const uploadableItems = items.filter((i) => i.can_upload);
  const blockedItems = items.filter((i) => !i.can_upload);

  const handleImport = () => {
    onClose();
    onComplete();
  };

  return (
    <Modal open={open} onClose={onClose} width="3xl">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">导入CAD附件 - 匹配预览</h2>

        <div className="flex gap-4 mb-4 text-sm flex-wrap">
          <span className="text-gray-500">文件夹文件总数: <b>{summary.total_files}</b></span>
          <span className="text-green-600">匹配: <b>{summary.matched_count}</b></span>
          <span className="text-gray-400">未匹配: <b>{summary.unmatched_count}</b></span>
          <span className="text-yellow-600">将覆盖: <b>{summary.will_overwrite_count}</b></span>
          <span className="text-red-600">不可上传: <b>{summary.blocked_count}</b></span>
        </div>

        <div className="max-h-80 overflow-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">文件名</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">零部件</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">件号</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => {
                const status = getItemStatus(item);
                const sc = statusConfig[status];
                return (
                  <tr key={`${item.revision_id}-${item.file_name}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-700">{item.file_name}</td>
                    <td className="px-3 py-2 text-gray-700">{item.name}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{item.code}</td>
                    <td className={`px-3 py-2 text-center ${sc.cls}`}>
                      {status === 'blocked' ? `${item.block_reason}` : sc.label}
                    </td>
                  </tr>
                );
              })}
              {unmatched.map((fname) => (
                <tr key={fname} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-400">{fname}</td>
                  <td className="px-3 py-2 text-gray-400">—</td>
                  <td className="px-3 py-2 text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">未匹配</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-sm text-gray-500">
          {blockedItems.length > 0 && (
            <p className="text-red-600 mb-1">
              已过滤 {blockedItems.length} 个不可上传项（未签出），将上传 {uploadableItems.length} 个文件
            </p>
          )}
          {uploadableItems.length === 0 && (
            <p className="text-gray-400">没有可上传的文件</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">取消</button>
          {uploadableItems.length > 0 && (
            <button
              onClick={handleImport}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              确认导入
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
