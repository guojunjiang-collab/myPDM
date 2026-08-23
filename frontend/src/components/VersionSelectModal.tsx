import { useEffect, useState } from 'react';
import { partsApi, documentsApi } from '../services/api';
import { formatDateTime } from '../utils/date';
import { Modal, MODAL_Z } from './Modal';
import Badge from './ui/Badge';
import Button from './ui/Button';
import SortableTh from './ui/SortableTh';
import { useTableSort } from '../hooks/useTableSort';
import { compareVersions } from '../constants';

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
  entityType: 'part' | 'assembly' | 'component' | 'document';
  entityId: string;
  entityName?: string;
  currentVersionId?: string;
  onSelect: (versionId: string) => void;
  onClose: () => void;
}

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
      // 图文档走 documentsApi；零件/部件/零部件统一走 partsApi.revisions（entityId 为 master_id）
      if (entityType === 'document') {
        documentsApi.versions(entityId)
          .then((res: any) => setVersions(res.data || []))
          .catch(() => setVersions([]))
          .finally(() => setLoading(false));
      } else {
        partsApi.revisions(entityId)
          .then((rows: any) => setVersions(Array.isArray(rows) ? rows : (rows?.data || [])))
          .catch(() => setVersions([]))
          .finally(() => setLoading(false));
      }
    }
  }, [open, entityId, entityType]);

  const title = entityName ? `选择版本 - ${entityName}` : '选择版本';

  const { sortedData: sortedVersions, sortField, sortDirection, handleSort } = useTableSort<VersionItem>(versions, { fieldComparators: { version: (a, b) => compareVersions(String(a), String(b)) } });

  return (
    <Modal open={open} title={title} onClose={onClose} width="full" zIndex={MODAL_Z.overlay}>
      {loading ? (
        <div className="text-sm text-[var(--ui-text-secondary)] py-8 text-center">加载中...</div>
      ) : versions.length === 0 ? (
        <div className="text-sm text-[var(--ui-text-tertiary)] py-8 text-center">暂无可选版本</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-[var(--ui-bg-subtle)] border-b">
              <tr>
                <SortableTh sortKey="version" active={sortField === 'version'} direction={sortDirection} onSort={(k) => handleSort(k as keyof VersionItem)} className="text-left w-20 whitespace-nowrap">版本</SortableTh>
                <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k as keyof VersionItem)} className="text-left w-14 whitespace-nowrap">状态</SortableTh>
                <SortableTh sortKey="created_at" active={sortField === 'created_at'} direction={sortDirection} onSort={(k) => handleSort(k as keyof VersionItem)} className="text-left w-44 whitespace-nowrap">创建时间</SortableTh>
                <SortableTh className="text-left w-20 whitespace-nowrap">创建人</SortableTh>
                <SortableTh className="text-left">备注</SortableTh>
                <SortableTh className="text-center w-16 whitespace-nowrap">操作</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedVersions.map((v) => {
                const isCurrent = v.id === currentVersionId;
                const creator = v.revisions && v.revisions.length > 0 ? v.revisions[0].user : null;
                return (
                  <tr key={v.id} className={isCurrent ? 'bg-blue-50' : 'hover:bg-[var(--ui-bg-hover)]'}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-800'}`}>
                        {v.version}
                        {isCurrent && ' (当前)'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge status={v.status} />
                    </td>
                    <td className="px-3 py-2 text-[var(--ui-text-secondary)] whitespace-nowrap">{formatDateTime(v.created_at)}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-secondary)] whitespace-nowrap">{creator || '-'}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-secondary)] break-words whitespace-normal">{v.remark || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      {!isCurrent ? (
                        <Button
                          variant="link"
                          size="xs"
                          type="button"
                          onClick={() => onSelect(v.id)}
                        >
                          选择
                        </Button>
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
