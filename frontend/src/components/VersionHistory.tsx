import { useEffect, useState } from 'react';
import { partsApi, documentsApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import Badge from './ui/Badge';

interface VersionItem {
  id: string;
  version: string;
  status: string;
  created_at?: string;
  remark?: string;
  revisions?: { user?: string }[];
}

interface VersionHistoryProps {
  entityType: 'part' | 'assembly' | 'component' | 'document';
  entityId: string;
  onViewVersion?: (id: string) => void;
}

export default function VersionHistory({ entityType, entityId, onViewVersion }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [entityId, entityType]);

  const loadVersions = async () => {
    setLoading(true);
    try {
      if (entityType === 'document') {
        const res = await documentsApi.versions(entityId);
        setVersions(res.data || []);
      } else {
        // 零件/部件/零部件：entityId 为 master_id，列出其所有版本
        const rows = await partsApi.revisions(entityId);
        setVersions(Array.isArray(rows) ? rows : (rows?.data || []));
      }
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 py-4 text-center">加载中...</div>;
  }

  if (versions.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">暂无版本历史</div>;
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap min-w-[5rem]">版本</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap min-w-[4rem]">状态</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap min-w-[9rem]">创建时间</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap min-w-[5rem]">创建人</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium">备注</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {versions.map((v) => {
            const isCurrent = v.id === entityId;
            const creator = (v.revisions && v.revisions.length > 0) ? v.revisions[0].user : null;
            return (
              <tr
                key={v.id}
                onClick={() => {
                  if (!isCurrent && onViewVersion) onViewVersion(v.id);
                }}
                className={`${isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50 cursor-pointer'}`}
              >
                <td className="px-3 py-2">
                  <span className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-800'}`}>
                    {v.version}
                    {isCurrent && ' (当前)'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge status={v.status} />
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {formatDateTime(v.created_at)}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {creator || '-'}
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-60 truncate">
                  {v.remark || '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
