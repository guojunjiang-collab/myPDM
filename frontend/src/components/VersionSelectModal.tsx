import { useEffect, useState } from 'react';
import { partsApi, assembliesApi, documentsApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import { Modal } from './Modal';

interface VersionItem {
  id: string;
  version: string;
  status: string;
  created_at?: string;
  remark?: string;
  revisions?: { user?: string }[];
}

interface VersionSelectModalProps {
  open: boolean;
  entityType: 'part' | 'assembly' | 'document';
  entityId: string;
  entityName?: string;
  currentVersionId?: string;
  onSelect: (versionId: string) => void;
  onClose: () => void;
}

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

export default function VersionSelectModal({
  open,
  entityType,
  entityId,
  entityName,
  currentVersionId,
  onSelect,
  onClose,
}: VersionSelectModalProps) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && entityId) {
      setLoading(true);
      const apiMap: Record<string, any> = { part: partsApi, assembly: assembliesApi, document: documentsApi };
      const api = apiMap[entityType];
      api.versions(entityId)
        .then((res: any) => setVersions(res.data || []))
        .catch(() => setVersions([]))
        .finally(() => setLoading(false));
    }
  }, [open, entityId, entityType]);

  const title = entityName ? `选择版本 - ${entityName}` : '选择版本';

  return (
    <Modal open={open} title={title} onClose={onClose} width="xl" zIndex={70}>
      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">加载中...</div>
      ) : versions.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">暂无可选版本</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-36">创建时间</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">创建人</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">备注</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {versions.map((v) => {
                const isCurrent = v.id === currentVersionId;
                const creator = v.revisions && v.revisions.length > 0 ? v.revisions[0].user : null;
                return (
                  <tr key={v.id} className={isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-800'}`}>
                        {v.version}
                        {isCurrent && ' (当前)'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${statusTag(v.status).cls}`}>
                        {statusTag(v.status).label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{formatDateTime(v.created_at)}</td>
                    <td className="px-3 py-2 text-gray-500">{creator || '-'}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-60 truncate">{v.remark || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      {!isCurrent ? (
                        <button
                          type="button"
                          onClick={() => onSelect(v.id)}
                          className="text-primary-600 hover:text-primary-800 text-xs"
                        >
                          选择
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">当前</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
